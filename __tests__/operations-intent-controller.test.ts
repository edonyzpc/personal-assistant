import {
    OperationsControllerError,
    OperationsIntentController,
} from "../src/ai-services/operations/operations-intent-controller";
import { MAX_OPERATION_RESULT_GROWTH_CHARS } from "../src/ai-services/operations/input-validation";
import { OperationsUndoStore } from "../src/ai-services/operations/operations-undo-store";
import type {
    AuditWriteResult,
    OperationsAuditStore,
} from "../src/ai-services/operations/operations-audit-store";
import type {
    OperationsControllerEvent,
    OperationsVault,
    OperationsVaultFile,
} from "../src/ai-services/operations/types";

class MemoryVault implements OperationsVault {
    readonly files = new Map<string, string>();
    readonly folders = new Set<string>(["notes", "0.unsorted"]);

    readonly adapter = {
        exists: jest.fn(async (path: string) => this.files.has(path) || this.folders.has(path)),
        read: jest.fn(async (path: string) => {
            const content = this.files.get(path);
            if (content === undefined) throw new Error("missing");
            return content;
        }),
    };

    readonly cachedRead = jest.fn(async (file: OperationsVaultFile) => {
        const content = this.files.get(file.path);
        if (content === undefined) throw new Error("missing");
        return content;
    });

    readonly create = jest.fn(async (path: string, content: string) => {
        if (this.files.has(path) || this.folders.has(path)) throw new Error("collision");
        this.files.set(path, content);
        return { path };
    });

    readonly process = jest.fn(async (file: OperationsVaultFile, fn: (current: string) => string) => {
        const current = this.files.get(file.path);
        if (current === undefined) throw new Error("missing");
        const next = fn(current);
        this.files.set(file.path, next);
        return next;
    });

    readonly trashFile = jest.fn(async (file: OperationsVaultFile) => {
        this.files.delete(file.path);
    });

    getAbstractFileByPath(path: string): OperationsVaultFile | null {
        if (this.files.has(path)) return { path, extension: "md" };
        if (this.folders.has(path)) return { path, children: [] };
        return null;
    }
}

function makeController(
    vault: MemoryVault,
    options: Partial<ConstructorParameters<typeof OperationsIntentController>[0]> = {},
): OperationsIntentController {
    let id = 0;
    return new OperationsIntentController({
        vault,
        trashFile: async (file) => await vault.trashFile(file),
        createId: () => `id-${++id}`,
        ...options,
    });
}

function makeAuditStore(result: AuditWriteResult = { ok: true, path: "audit.json" }): {
    store: OperationsAuditStore;
    write: jest.Mock<Promise<AuditWriteResult>, [unknown]>;
} {
    const write = jest.fn(async (_input: unknown) => result);
    return {
        store: { write } as unknown as OperationsAuditStore,
        write,
    };
}

describe("OperationsIntentController", () => {
    it("stages one immutable intent with ordered virtual baselines and performs no write", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/a.md", "A");
        const events: OperationsControllerEvent[] = [];
        const controller = makeController(vault, { onEvent: (event) => events.push(event) });

        const intent = await controller.stageIntent({
            runId: "run-1",
            turnId: "turn-1",
            operations: [
                { toolCallId: "call-1", name: "vault_append", input: { path: "notes/a.md", content: "B" } },
                {
                    toolCallId: "call-2",
                    name: "vault_process",
                    input: {
                        path: "notes/a.md",
                        operation: "replace",
                        params: { search: "B", replace: "C" },
                    },
                },
            ],
        });

        expect(intent.state).toBe("pending");
        expect(intent.operations[0]).toMatchObject({ expectedBefore: "A", expectedAfter: "A\nB" });
        expect(intent.operations[1]).toMatchObject({ expectedBefore: "A\nB", expectedAfter: "A\nC" });
        expect(Object.isFrozen(intent)).toBe(true);
        expect(Object.isFrozen(intent.operations)).toBe(true);
        expect(Object.isFrozen(intent.operations[0]!.input)).toBe(true);
        expect(vault.process).not.toHaveBeenCalled();
        expect(vault.create).not.toHaveBeenCalled();
        expect(vault.files.get("notes/a.md")).toBe("A");
        expect(events[0]?.type).toBe("intent-staged");

        const result = await controller.executeIntent(intent.id);
        expect(result.state).toBe("completed");
        expect(result.operations.map((row) => row.status)).toEqual(["succeeded", "succeeded"]);
        expect(vault.process).toHaveBeenCalledTimes(2);
        expect(vault.files.get("notes/a.md")).toBe("A\nC");
        controller.dispose();
    });

    it("performs stale equality inside vault.process and preserves the user's edit", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/a.md", "before");
        const controller = makeController(vault);
        const intent = await controller.stageIntent({
            runId: "run",
            turnId: "turn",
            operations: [
                { toolCallId: "call", name: "vault_append", input: { path: "notes/a.md", content: "planned" } },
            ],
        });
        vault.files.set("notes/a.md", "user edit");

        const result = await controller.executeIntent(intent.id);
        expect(result.state).toBe("failed");
        expect(result.operations[0]).toMatchObject({ status: "stale", failureCategory: "stale_target" });
        expect(vault.process).toHaveBeenCalledTimes(1);
        expect(vault.files.get("notes/a.md")).toBe("user edit");
        controller.dispose();
    });

    it("stops after a partial failure, keeps completed rows, and selectively undoes the completed subset", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/existing.md", "old");
        vault.files.set("notes/later.md", "later");
        const controller = makeController(vault);
        const intent = await controller.stageIntent({
            runId: "run",
            turnId: "turn",
            operations: [
                { toolCallId: "create", name: "vault_create", input: { path: "notes/new.md", content: "new" } },
                { toolCallId: "stale", name: "vault_append", input: { path: "notes/existing.md", content: "append" } },
                { toolCallId: "later", name: "vault_append", input: { path: "notes/later.md", content: "append" } },
            ],
        });
        vault.files.set("notes/existing.md", "changed");

        const result = await controller.executeIntent(intent.id);
        expect(result.state).toBe("partial");
        expect(result.operations.map((row) => row.status)).toEqual(["succeeded", "stale", "skipped"]);
        expect(vault.files.get("notes/new.md")).toBe("new");
        expect(vault.files.get("notes/later.md")).toBe("later");

        const undone = await controller.undoCompleted(result);
        expect(undone).toHaveLength(1);
        expect(undone[0]?.status).toBe("undone");
        expect(vault.trashFile).toHaveBeenCalledWith(expect.objectContaining({ path: "notes/new.md" }));
        expect(vault.files.has("notes/new.md")).toBe(false);
        controller.dispose();
    });

    it("fails closed when a create target collides at staging or confirmation", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/existing.md", "user");
        const controller = makeController(vault);
        await expect(controller.stageIntent({
            runId: "run",
            turnId: "turn",
            operations: [
                { toolCallId: "call", name: "vault_create", input: { path: "notes/existing.md", content: "model" } },
            ],
        })).rejects.toMatchObject({ category: "target_collision" });
        expect(vault.files.get("notes/existing.md")).toBe("user");

        const intent = await controller.stageIntent({
            runId: "run-2",
            turnId: "turn-2",
            operations: [
                { toolCallId: "call-2", name: "vault_create", input: { path: "notes/race.md", content: "model" } },
            ],
        });
        vault.files.set("notes/race.md", "user won race");
        const result = await controller.executeIntent(intent.id);
        expect(result.operations[0]).toMatchObject({ status: "failed", failureCategory: "target_collision" });
        expect(vault.files.get("notes/race.md")).toBe("user won race");
        controller.dispose();
    });

    it("cancels without a write and expires pending baselines", async () => {
        const vault = new MemoryVault();
        let now = 1_000;
        const controller = makeController(vault, { now: () => now, pendingTtlMs: 100 });
        const cancelled = await controller.stageIntent({
            runId: "run",
            turnId: "turn",
            operations: [
                { toolCallId: "call", name: "vault_create", input: { path: "notes/cancel.md", content: "x" } },
            ],
        });
        expect(controller.cancelIntent(cancelled.id).state).toBe("cancelled");
        await expect(controller.executeIntent(cancelled.id)).rejects.toMatchObject({ category: "cancelled" });
        expect(vault.create).not.toHaveBeenCalled();

        const expiring = await controller.stageIntent({
            runId: "run-2",
            turnId: "turn-2",
            operations: [
                { toolCallId: "call-2", name: "vault_create", input: { path: "notes/expire.md", content: "x" } },
            ],
        });
        now += 101;
        await expect(controller.executeIntent(expiring.id)).rejects.toMatchObject({ category: "expired" });
        expect(vault.files.has("notes/expire.md")).toBe(false);
        controller.dispose();
    });

    it("keeps Undo memory-only and restores only an unchanged expected-after snapshot", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/a.md", "before");
        const controller = makeController(vault);
        const first = await controller.stageIntent({
            runId: "run",
            turnId: "turn",
            operations: [
                { toolCallId: "call", name: "vault_append", input: { path: "notes/a.md", content: "after" } },
            ],
        });
        const firstResult = await controller.executeIntent(first.id);
        const firstReceipt = firstResult.operations[0]!.receiptId!;
        expect((await controller.undo(firstReceipt)).status).toBe("undone");
        expect(vault.files.get("notes/a.md")).toBe("before");
        expect((await controller.undo(firstReceipt)).status).toBe("unavailable");

        const second = await controller.stageIntent({
            runId: "run-2",
            turnId: "turn-2",
            operations: [
                { toolCallId: "call-2", name: "vault_append", input: { path: "notes/a.md", content: "after" } },
            ],
        });
        const secondResult = await controller.executeIntent(second.id);
        vault.files.set("notes/a.md", "later user edit");
        expect(await controller.undo(secondResult.operations[0]!.receiptId!)).toMatchObject({
            status: "stale",
            failureCategory: "stale_target",
        });
        expect(vault.files.get("notes/a.md")).toBe("later user edit");
        controller.dispose();
    });

    it("checks Data Boundary before preview and again before execute without auditing a denied target", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/a.md", "before");
        let allowed = false;
        const audit = makeAuditStore();
        const controller = makeController(vault, {
            isPathAllowed: () => allowed,
            auditStore: audit.store,
        });
        await expect(controller.stageIntent({
            runId: "run",
            turnId: "turn",
            operations: [
                { toolCallId: "call", name: "vault_append", input: { path: "notes/a.md", content: "x" } },
            ],
        })).rejects.toMatchObject({ category: "boundary_denied" });

        allowed = true;
        const intent = await controller.stageIntent({
            runId: "run-2",
            turnId: "turn-2",
            operations: [
                { toolCallId: "call-2", name: "vault_append", input: { path: "notes/a.md", content: "x" } },
            ],
        });
        allowed = false;
        const result = await controller.executeIntent(intent.id);
        expect(result.operations[0]).toMatchObject({ status: "failed", failureCategory: "boundary_denied" });
        expect(vault.files.get("notes/a.md")).toBe("before");
        expect(audit.write).not.toHaveBeenCalled();
        controller.dispose();
    });

    it("does not audit an Undo target denied by the current Data Boundary", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/a.md", "before");
        let allowed = true;
        const audit = makeAuditStore();
        const controller = makeController(vault, {
            isPathAllowed: () => allowed,
            auditStore: audit.store,
        });
        const intent = await controller.stageIntent({
            runId: "run",
            turnId: "turn",
            operations: [
                { toolCallId: "call", name: "vault_append", input: { path: "notes/a.md", content: "after" } },
            ],
        });
        const execution = await controller.executeIntent(intent.id);
        const receiptId = execution.operations[0]!.receiptId!;
        expect(audit.write).toHaveBeenCalledTimes(1);
        audit.write.mockClear();

        allowed = false;
        expect(await controller.undo(receiptId)).toMatchObject({
            status: "failed",
            failureCategory: "boundary_denied",
        });
        expect(audit.write).not.toHaveBeenCalled();
        expect(vault.files.get("notes/a.md")).toBe("before\nafter");
        controller.dispose();
    });

    it("uses a fresh read for create Undo and preserves a changed created note", async () => {
        const vault = new MemoryVault();
        const controller = makeController(vault);
        const intent = await controller.stageIntent({
            runId: "run",
            turnId: "turn",
            operations: [
                { toolCallId: "call", name: "vault_create", input: { path: "notes/new.md", content: "created" } },
            ],
        });
        const execution = await controller.executeIntent(intent.id);
        vault.files.set("notes/new.md", "user edit");
        vault.cachedRead.mockResolvedValueOnce("created");

        expect(await controller.undo(execution.operations[0]!.receiptId!)).toMatchObject({
            status: "stale",
            failureCategory: "stale_target",
        });
        expect(vault.cachedRead).not.toHaveBeenCalled();
        expect(vault.adapter.read).toHaveBeenCalledWith("notes/new.md");
        expect(vault.trashFile).not.toHaveBeenCalled();
        expect(vault.files.get("notes/new.md")).toBe("user edit");
        controller.dispose();
    });

    it("does not retain a staged intent when aborted or disposed during an awaited read", async () => {
        for (const stop of ["abort", "dispose"] as const) {
            const vault = new MemoryVault();
            vault.files.set("notes/a.md", "before");
            let resolveRead!: (value: string) => void;
            vault.cachedRead.mockImplementationOnce(async () => await new Promise<string>((resolve) => {
                resolveRead = resolve;
            }));
            const events: OperationsControllerEvent[] = [];
            const controller = makeController(vault, { onEvent: (event) => events.push(event) });
            const abortController = new AbortController();
            const staged = controller.stageIntent({
                runId: "run",
                turnId: "turn",
                operations: [
                    { toolCallId: "call", name: "vault_append", input: { path: "notes/a.md", content: "after" } },
                ],
            }, abortController.signal);
            await Promise.resolve();
            if (stop === "abort") abortController.abort();
            else controller.dispose();
            resolveRead("before");

            await expect(staged).rejects.toMatchObject({ category: "cancelled" });
            expect(events.some((event) => event.type === "intent-staged")).toBe(false);
            expect(controller.listPendingIntents()).toEqual([]);
            controller.dispose();
        }
    });

    it("stops remaining writes and does not recreate Undo state when disposed during confirmation", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/a.md", "A");
        vault.files.set("notes/b.md", "B");
        let finishFirstWrite!: () => void;
        let signalFirstWriteStarted!: () => void;
        const firstWriteStarted = new Promise<void>((resolve) => {
            signalFirstWriteStarted = resolve;
        });
        vault.process.mockImplementationOnce(async (file, fn) => {
            const next = fn(vault.files.get(file.path)!);
            signalFirstWriteStarted();
            await new Promise<void>((resolve) => {
                finishFirstWrite = () => {
                    vault.files.set(file.path, next);
                    resolve();
                };
            });
            return next;
        });
        const undoStore = new OperationsUndoStore();
        const createReceipt = jest.spyOn(undoStore, "create");
        const events: OperationsControllerEvent[] = [];
        const controller = makeController(vault, { undoStore, onEvent: (event) => events.push(event) });
        const intent = await controller.stageIntent({
            runId: "run",
            turnId: "turn",
            operations: [
                { toolCallId: "call-a", name: "vault_append", input: { path: "notes/a.md", content: "after" } },
                { toolCallId: "call-b", name: "vault_append", input: { path: "notes/b.md", content: "after" } },
            ],
        });

        const execution = controller.executeIntent(intent.id);
        await firstWriteStarted;
        controller.dispose();
        finishFirstWrite();

        await expect(execution).rejects.toMatchObject({ category: "cancelled" });
        expect(vault.process).toHaveBeenCalledTimes(1);
        expect(createReceipt).not.toHaveBeenCalled();
        const disposedIndex = events.findIndex((event) => event.type === "disposed");
        expect(disposedIndex).toBeGreaterThanOrEqual(0);
        expect(events.slice(disposedIndex + 1)).toEqual([]);
    });

    it("caps actual generated replacement text across the complete intent", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/a.md", ["A", "B", "C", "D", "E"]
            .map((token) => token.repeat(100))
            .join("|"));
        const controller = makeController(vault);
        const replacement = "x".repeat(500);

        await expect(controller.stageIntent({
            runId: "run",
            turnId: "turn",
            operations: ["A", "B", "C", "D", "E"].map((search, index) => ({
                toolCallId: `call-${index}`,
                name: "vault_process" as const,
                input: {
                    path: "notes/a.md",
                    operation: "replace",
                    params: { search, replace: replacement, occurrence: "all" },
                },
            })),
        })).rejects.toMatchObject({ category: "schema_invalid" });
        expect(vault.process).not.toHaveBeenCalled();
        expect(controller.listPendingIntents()).toEqual([]);
        controller.dispose();
    });

    it("rejects an unexpectedly amplified expected-after snapshot", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/a.md", "Body");
        const controller = makeController(vault, {
            frontmatterCodec: {
                parse: () => ({}),
                stringify: () => "x".repeat(MAX_OPERATION_RESULT_GROWTH_CHARS + 1),
            },
        });

        await expect(controller.stageIntent({
            runId: "run",
            turnId: "turn",
            operations: [{
                toolCallId: "call",
                name: "frontmatter_update",
                input: { path: "notes/a.md", set: { status: "done" } },
            }],
        })).rejects.toMatchObject({ category: "transform_failed" });
        expect(controller.listPendingIntents()).toEqual([]);
        controller.dispose();
    });

    it("propagates audit retention warnings separately from current-write success", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/a.md", "before");
        const audit = makeAuditStore({
            ok: true,
            path: "audit.json",
            retentionWarning: "cleanup failed",
        });
        const controller = makeController(vault, { auditStore: audit.store });
        const intent = await controller.stageIntent({
            runId: "run",
            turnId: "turn",
            operations: [
                { toolCallId: "call", name: "vault_append", input: { path: "notes/a.md", content: "after" } },
            ],
        });

        const result = await controller.executeIntent(intent.id);

        expect(result.operations[0]).toMatchObject({
            status: "succeeded",
            auditStatus: "written",
            auditRetentionWarning: "cleanup failed",
        });
        controller.dispose();
    });

    it("omits planned content from content-enabled audit records when execution or Undo fails", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/a.md", "before");
        const audit = makeAuditStore();
        const controller = makeController(vault, { auditStore: audit.store });
        const staleIntent = await controller.stageIntent({
            runId: "run-stale",
            turnId: "turn-stale",
            operations: [
                { toolCallId: "call-stale", name: "vault_append", input: { path: "notes/a.md", content: "planned" } },
            ],
        });
        vault.files.set("notes/a.md", "user edit");

        await controller.executeIntent(staleIntent.id);

        const staleAudit = audit.write.mock.calls[0]![0] as Record<string, unknown>;
        expect(staleAudit).not.toHaveProperty("before");
        expect(staleAudit).not.toHaveProperty("after");

        audit.write.mockClear();
        const successfulIntent = await controller.stageIntent({
            runId: "run-success",
            turnId: "turn-success",
            operations: [
                { toolCallId: "call-success", name: "vault_append", input: { path: "notes/a.md", content: "written" } },
            ],
        });
        const execution = await controller.executeIntent(successfulIntent.id);
        expect(audit.write.mock.calls[0]![0]).toMatchObject({
            before: "user edit",
            after: "user edit\nwritten",
        });
        const receiptId = execution.operations[0]!.receiptId!;
        vault.files.set("notes/a.md", "later edit");
        audit.write.mockClear();

        await controller.undo(receiptId);

        const undoAudit = audit.write.mock.calls[0]![0] as Record<string, unknown>;
        expect(undoAudit).not.toHaveProperty("before");
        expect(undoAudit).not.toHaveProperty("after");
        controller.dispose();
    });

    it("requires an existing parent and an existing target for non-create tools", async () => {
        const vault = new MemoryVault();
        const controller = makeController(vault);
        await expect(controller.stageIntent({
            runId: "run",
            turnId: "turn",
            operations: [
                { toolCallId: "call", name: "vault_create", input: { path: "missing/new.md", content: "x" } },
            ],
        })).rejects.toMatchObject({ category: "parent_missing" });
        await expect(controller.stageIntent({
            runId: "run-2",
            turnId: "turn-2",
            operations: [
                { toolCallId: "call-2", name: "vault_append", input: { path: "notes/missing.md", content: "x" } },
            ],
        })).rejects.toMatchObject({ category: "target_missing" });
        controller.dispose();
    });

    it("requires a create parent to remain a folder at staging and confirmation", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/parent.md", "not a folder");
        const controller = makeController(vault);

        await expect(controller.stageIntent({
            runId: "run-file-parent",
            turnId: "turn-file-parent",
            operations: [
                { toolCallId: "call-file-parent", name: "vault_create", input: { path: "notes/parent.md/child.md", content: "x" } },
            ],
        })).rejects.toMatchObject({ category: "parent_missing" });

        const intent = await controller.stageIntent({
            runId: "run-race",
            turnId: "turn-race",
            operations: [
                { toolCallId: "call-race", name: "vault_create", input: { path: "notes/new.md", content: "x" } },
            ],
        });
        vault.folders.delete("notes");
        vault.files.set("notes", "now a file");

        const result = await controller.executeIntent(intent.id);

        expect(result.operations[0]).toMatchObject({ status: "failed", failureCategory: "parent_missing" });
        expect(vault.create).not.toHaveBeenCalled();
        controller.dispose();
    });

    it("reports controller errors with stable categories", () => {
        expect(new OperationsControllerError("schema_invalid", "bad")).toMatchObject({
            name: "OperationsControllerError",
            category: "schema_invalid",
            message: "bad",
        });
    });
});
