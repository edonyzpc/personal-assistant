import {
    OPERATIONS_AUDIT_DIRECTORY,
    OperationsAuditStore,
} from "../src/ai-services/operations/operations-audit-store";
import { OperationsUndoStore } from "../src/ai-services/operations/operations-undo-store";

class MemoryAuditAdapter {
    readonly files = new Map<string, string>();
    readonly folders = new Set<string>([
        ".obsidian",
        ".obsidian/plugins",
        ".obsidian/plugins/personal-assistant",
    ]);
    readonly exists = jest.fn(async (path: string) => this.files.has(path) || this.folders.has(path));
    readonly mkdir = jest.fn(async (path: string) => { this.folders.add(path); });
    readonly write = jest.fn(async (path: string, content: string) => { this.files.set(path, content); });
    readonly read = jest.fn(async (path: string) => {
        const content = this.files.get(path);
        if (content === undefined) throw new Error("missing");
        return content;
    });
    readonly list = jest.fn(async (path: string) => ({
        files: [...this.files.keys()].filter((file) => file.startsWith(`${path}/`)),
        folders: [],
    }));
    readonly remove = jest.fn(async (path: string) => { this.files.delete(path); });
}

const auditInput = {
    version: 1 as const,
    operationId: "operation-1",
    intentId: "intent-1",
    tool: "vault_append" as const,
    targetPath: "notes/a.md",
    status: "succeeded" as const,
    startedAt: "2026-08-01T00:00:00.000Z",
    completedAt: "2026-08-01T00:00:01.000Z",
    before: "private before",
    after: "private after",
};

describe("OperationsAuditStore", () => {
    it("writes a unique strict content-free allowlist by default", async () => {
        const adapter = new MemoryAuditAdapter();
        const store = new OperationsAuditStore({ adapter }, { now: () => Date.parse("2026-08-01T00:00:01.000Z") });
        const first = await store.write(auditInput);
        const second = await store.write(auditInput);
        expect(first.ok).toBe(true);
        expect(second.ok).toBe(true);
        expect(first.path).not.toBe(second.path);
        expect(adapter.files.size).toBe(2);
        const record = JSON.parse(adapter.files.get(first.path!)!);
        expect(record).toEqual({
            version: 1,
            operationId: "operation-1",
            intentId: "intent-1",
            tool: "vault_append",
            targetPath: "notes/a.md",
            status: "succeeded",
            startedAt: "2026-08-01T00:00:00.000Z",
            completedAt: "2026-08-01T00:00:01.000Z",
        });
        expect(JSON.stringify(record)).not.toContain("private");
        expect(adapter.folders.has(OPERATIONS_AUDIT_DIRECTORY)).toBe(true);
        expect(adapter.list).not.toHaveBeenCalled();
    });

    it("adds exact snapshots only after explicit opt-in", async () => {
        const adapter = new MemoryAuditAdapter();
        const store = new OperationsAuditStore({ adapter }, { includeContent: true });
        const written = await store.write(auditInput);
        const record = JSON.parse(adapter.files.get(written.path!)!);
        expect(record.before).toBe("private before");
        expect(record.after).toBe("private after");
    });

    it("honors content-audit privacy changes without recreating the chat service", async () => {
        const adapter = new MemoryAuditAdapter();
        let includeContent = true;
        const store = new OperationsAuditStore({ adapter }, { includeContent: () => includeContent });
        const first = await store.write(auditInput);
        expect(JSON.parse(adapter.files.get(first.path!)!).before).toBe("private before");

        includeContent = false;
        const second = await store.write({ ...auditInput, operationId: "operation-2" });
        expect(JSON.parse(adapter.files.get(second.path!)!)).not.toHaveProperty("before");
    });

    it("cleans only owned expired JSON records and runs cleanup once per store", async () => {
        const adapter = new MemoryAuditAdapter();
        adapter.folders.add(OPERATIONS_AUDIT_DIRECTORY);
        const old = `${OPERATIONS_AUDIT_DIRECTORY}/old.json`;
        const recent = `${OPERATIONS_AUDIT_DIRECTORY}/recent.json`;
        const unrelated = `${OPERATIONS_AUDIT_DIRECTORY}/keep.txt`;
        adapter.files.set(old, JSON.stringify({ version: 1, operationId: "old", completedAt: "2026-06-01T00:00:00.000Z" }));
        adapter.files.set(recent, JSON.stringify({ version: 1, operationId: "recent", completedAt: "2026-07-20T00:00:00.000Z" }));
        adapter.files.set(unrelated, "do not remove");
        const store = new OperationsAuditStore({ adapter }, {
            retentionDays: 30,
            now: () => Date.parse("2026-08-01T00:00:00.000Z"),
        });
        expect(await store.cleanupOnce()).toEqual({ attempted: true, deleted: 1 });
        expect(await store.cleanupOnce()).toEqual({ attempted: false, deleted: 0 });
        expect(adapter.files.has(old)).toBe(false);
        expect(adapter.files.has(recent)).toBe(true);
        expect(adapter.files.has(unrelated)).toBe(true);
        expect(adapter.list).toHaveBeenCalledTimes(1);
    });

    it("reports audit failure without throwing into the confirmed vault result", async () => {
        const adapter = new MemoryAuditAdapter();
        adapter.write.mockRejectedValueOnce(new Error("disk full"));
        const store = new OperationsAuditStore({ adapter });
        await expect(store.write(auditInput)).resolves.toEqual({ ok: false, error: "disk full" });
    });

    it("reports retention cleanup failure separately from a successful current write", async () => {
        const adapter = new MemoryAuditAdapter();
        adapter.folders.add(OPERATIONS_AUDIT_DIRECTORY);
        adapter.list.mockRejectedValueOnce(new Error("retention cleanup unavailable"));
        const store = new OperationsAuditStore({ adapter });

        const result = await store.write(auditInput);

        expect(result).toMatchObject({
            ok: true,
            retentionWarning: "retention cleanup unavailable",
        });
        expect(result.path && adapter.files.has(result.path)).toBe(true);
    });
});

describe("OperationsUndoStore", () => {
    it("keeps snapshots in memory with expiry and one-time consumption", () => {
        let now = 1_000;
        const store = new OperationsUndoStore({ now: () => now, ttlMs: 100, createId: () => "receipt" });
        store.create({
            intentId: "intent",
            operationId: "operation",
            path: "notes/a.md",
            kind: "vault_append",
            before: "before",
            expectedAfter: "after",
        });
        expect(store.get("receipt")).toMatchObject({ ok: true });
        store.markUsed("receipt");
        expect(store.get("receipt")).toEqual({ ok: false, reason: "used" });

        store.create({
            id: "expires",
            intentId: "intent",
            operationId: "operation-2",
            path: "notes/b.md",
            kind: "vault_create",
            before: null,
            expectedAfter: "new",
        });
        now += 101;
        expect(store.get("expires")).toEqual({ ok: false, reason: "expired" });
    });
});
