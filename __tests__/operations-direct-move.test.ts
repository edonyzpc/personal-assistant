import { CapabilityRegistry } from "../src/ai-services/capability-registry";
import { PolicyEngine } from "../src/ai-services/policy-engine";
import { OperationsService } from "../src/ai-services/operations/operations-service";
import { createOperationsStagingToolExecutor } from "../src/ai-services/operations/operations-tool-executor";
import type { OperationsVault, OperationsVaultFile } from "../src/ai-services/operations/types";
import type { PaAgentToolBatchPreparationInput } from "../src/ai-services/pa-agent-types";

class MoveVault implements OperationsVault {
    readonly contents = new Map([["notes/a.md", "A"], ["notes/b.md", "B"]]);
    readonly identities = new Map<string, OperationsVaultFile>([
        ["notes/a.md", { path: "notes/a.md", extension: "md" }],
        ["notes/b.md", { path: "notes/b.md", extension: "md" }],
    ]);
    readonly adapter = { exists: async (path: string) => this.identities.has(path) || path === "notes" || path === "archive" };
    readonly read = jest.fn(async (file: OperationsVaultFile) => {
        const text = this.contents.get(file.path);
        if (text === undefined) throw new Error("missing");
        return text;
    });
    readonly create = jest.fn(async (path: string, content: string) => {
        if (this.identities.has(path)) throw new Error("collision");
        const file = { path, extension: "md" };
        this.contents.set(path, content); this.identities.set(path, file);
        return file;
    });
    readonly process = jest.fn(async (file: OperationsVaultFile, fn: (current: string) => string) => {
        const content = fn(await this.read(file)); this.contents.set(file.path, content); return content;
    });
    readonly renameFile = jest.fn(async (file: OperationsVaultFile, path: string) => {
        if (this.identities.has(path) && this.identities.get(path) !== file) throw new Error("collision");
        const content = await this.read(file);
        this.identities.delete(file.path); this.contents.delete(file.path);
        file.path = path;
        this.identities.set(path, file); this.contents.set(path, content);
    });
    getAbstractFileByPath(path: string): OperationsVaultFile | null {
        return this.identities.get(path) ?? (path === "notes" || path === "archive" ? { path, children: [] } : null);
    }
}

async function fixture() {
    const vault = new MoveVault();
    const service = new OperationsService({ vault, trashFile: async () => undefined,
        renameFile: vault.renameFile, isOperationsAgentEnabled: () => true });
    const session = service.createSession({ surface: "test" });
    const registry = new CapabilityRegistry({ policyEngine: new PolicyEngine({ runKind: "chat-with-actions", allowWrite: true,
        allowedActionPermissions: ["local-filesystem-write"] }) });
    registry.registerMany((await service.provider.load({} as never)).capabilities);
    const executor = createOperationsStagingToolExecutor({ baseExecutor: { execute: async () => { throw new Error("unexpected base execution"); } },
        registry, controller: session, intentExecutor: input => session.executeCurrentIntent(input) });
    const guard = { isCurrent: () => true, isNoteDomainAllowed: () => true, isPathAllowed: () => true };
    const batch = (calls: PaAgentToolBatchPreparationInput["toolCalls"], turnId = "turn"): PaAgentToolBatchPreparationInput => ({
        runId: "run", turnId, turnIndex: 1, userInput: "Apply the requested changes", toolCalls: calls,
        signal: new AbortController().signal, taskSourceReadGuard: guard,
    });
    const call = async (input: PaAgentToolBatchPreparationInput, index = 0) => executor.execute({ ...input, toolCall: input.toolCalls[index] });
    return { vault, service, session, executor, batch, call };
}

const append = (id: string, path: string, content: string, mode: "apply" | "preview" = "apply") => ({
    type: "toolCall" as const, id, index: 0, name: "vault_append", input: { mode, path, content },
});
const move = (sourcePath = "notes/a.md", targetPath = "archive/a.md") => ({
    type: "toolCall" as const, id: "move", index: 0, name: "vault_move", input: { mode: "apply", sourcePath, targetPath },
});

describe("direct Operations and native move", () => {
    it("executes one ordered prepared batch and returns each original call's result without replay", async () => {
        const h = await fixture();
        try {
            const input = h.batch([append("one", "notes/a.md", "first"), append("two", "notes/a.md", "second")]);
            expect((await h.executor.prepareBatch!(input))?.toolResults.size).toBe(0);
            expect(h.vault.contents.get("notes/a.md")).toBe("A");
            const first = await h.call(input);
            const second = await h.call(input, 1);
            expect(h.vault.contents.get("notes/a.md")).toBe("A\nfirst\nsecond");
            expect(JSON.parse(first.promptText).operations.map((operation: { toolCallId: string }) => operation.toolCallId)).toEqual(["one"]);
            expect(JSON.parse(second.promptText).operations.map((operation: { toolCallId: string }) => operation.toolCallId)).toEqual(["two"]);
            await h.executor.prepareBatch!(input); await h.call(input);
            expect(h.vault.contents.get("notes/a.md")).toBe("A\nfirst\nsecond");
            expect(h.vault.process).toHaveBeenCalledTimes(2);
        } finally { h.service.dispose(); }
    });

    it("keeps preview zero-write and prepares a later apply from the actual new baseline", async () => {
        const h = await fixture();
        try {
            const preview = await h.executor.prepareBatch!(h.batch([append("preview", "notes/a.md", "B", "preview")]));
            expect(preview?.toolResults.get("preview")).toMatchObject({ executionState: "not_started" });
            expect(preview?.toolResults.get("preview")?.resultFact).toBeUndefined();
            const id = preview?.toolResults.get("preview")?.metadata?.intentId as string;
            await expect(h.session.executeCurrentIntent({ intentId: id, runId: "run", taskSourceReadGuard: {
                isCurrent: () => true, isPathAllowed: path => path === "notes/a.md",
            } })).rejects.toMatchObject({ category: "boundary_denied" });
            expect(h.vault.contents.get("notes/a.md")).toBe("A");
            h.vault.contents.set("notes/a.md", "User edit");
            const apply = h.batch([append("apply", "notes/a.md", "B")], "later");
            await h.executor.prepareBatch!(apply); await h.call(apply);
            expect(h.vault.contents.get("notes/a.md")).toBe("User edit\nB");
        } finally { h.service.dispose(); }
    });

    it("isolates prepared child batches that share a run and turn", async () => {
        const h = await fixture();
        try {
            const first = h.batch([
                append("a1", "notes/a.md", "A-effect"),
                append("a2", "notes/b.md", "B-effect"),
            ]);
            const second = h.batch([append("b1", "notes/b.md", "preview", "preview")]);
            const preparedFirst = await h.executor.prepareBatch!(first);
            const firstIntentId = h.session.getBatchContextResult("run", "turn", ["a1", "a2"])?.intent?.id;
            const preparedSecond = await h.executor.prepareBatch!(second);
            const secondPreview = preparedSecond?.toolResults.get("b1");
            const firstResult = await h.call(first);
            const secondResult = preparedFirst?.toolResults.get("a2") ?? await h.call(first, 1);
            const secondB = preparedSecond?.toolResults.get("b1");

            expect([...preparedSecond!.toolResults.keys()]).toEqual(["b1"]);
            expect(secondB).toBe(secondPreview);
            expect(secondB).toMatchObject({ executionState: "not_started", metadata: { mode: "preview", wrote: false } });
            expect(secondB?.resultFact).toBeUndefined();
            expect(firstResult.metadata?.intentId).toBe(firstIntentId);
            expect(secondResult.metadata?.intentId).toBe(firstIntentId);
            expect(JSON.parse(firstResult.promptText).operations[0].toolCallId).toBe("a1");
            expect(JSON.parse(secondResult.promptText).operations[0].toolCallId).toBe("a2");
            expect(h.vault.contents.get("notes/a.md")).toBe("A\nA-effect");
            expect(h.vault.contents.get("notes/b.md")).toBe("B\nB-effect");
            expect(h.vault.process).toHaveBeenCalledTimes(2);
        } finally { h.service.dispose(); }
    });

    it("isolates prepared batches when providers reuse a call id across turns", async () => {
        const h = await fixture();
        try {
            const first = h.batch([append("same-id", "notes/a.md", "apply")], "turn-a");
            const second = h.batch([append("same-id", "notes/b.md", "preview", "preview")], "turn-b");
            const preparedFirst = await h.executor.prepareBatch!(first);
            const preparedSecond = await h.executor.prepareBatch!(second);
            const secondPreview = preparedSecond?.toolResults.get("same-id");
            const firstResult = await h.call(first);
            const secondResult = preparedSecond?.toolResults.get("same-id");

            expect(JSON.parse(firstResult.promptText)).toMatchObject({ state: "completed" });
            expect(secondResult).toBe(secondPreview);
            expect(secondResult).toMatchObject({
                executionState: "not_started",
                metadata: { mode: "preview", wrote: false },
            });
            expect(preparedFirst?.toolResults.get("same-id")).toEqual(firstResult);
            expect(h.vault.contents.get("notes/a.md")).toBe("A\napply");
            expect(h.vault.contents.get("notes/b.md")).toBe("B");
        } finally { h.service.dispose(); }
    });

    it("rejects mixed modes and a later known destination collision before the first effect", async () => {
        const h = await fixture();
        try {
            const mixed = await h.executor.prepareBatch!(h.batch([append("one", "notes/a.md", "B"), append("two", "notes/b.md", "C", "preview")]));
            expect(mixed?.toolResults.get("one")?.metadata?.reason).toBe("operations_mixed_modes");
            const collision = await h.executor.prepareBatch!(h.batch([append("one", "notes/a.md", "B"), move("notes/b.md", "notes/a.md")], "collision"));
            expect(collision?.toolResults.get("one")?.executionState).toBe("not_started");
            expect(h.vault.contents.get("notes/a.md")).toBe("A");
            expect(h.vault.process).not.toHaveBeenCalled(); expect(h.vault.renameFile).not.toHaveBeenCalled();
        } finally { h.service.dispose(); }
    });

    it("moves the same Host file and uses native post-move content for Undo without rewriting it", async () => {
        const h = await fixture();
        try {
            const native = h.vault.renameFile.getMockImplementation()!;
            h.vault.renameFile.mockImplementation(async (file, path) => {
                await native(file, path); h.vault.contents.set(path, `Native links at ${path}`);
            });
            const identity = h.vault.identities.get("notes/a.md");
            const input = h.batch([move()]); await h.executor.prepareBatch!(input);
            const result = await h.call(input);
            const receipt = JSON.parse(result.promptText).operations[0].receiptId;
            expect(JSON.parse(result.promptText)).toMatchObject({ state: "completed", undoAvailable: true });
            expect(h.vault.getAbstractFileByPath("notes/a.md")).toBeNull();
            expect(h.vault.getAbstractFileByPath("archive/a.md")).toBe(identity);
            expect(await h.session.undoMany([receipt])).toMatchObject([{ status: "undone" }]);
            expect(h.vault.getAbstractFileByPath("notes/a.md")).toBe(identity);
            expect(h.vault.contents.get("notes/a.md")).toBe("Native links at notes/a.md");
            expect(h.vault.process).not.toHaveBeenCalled(); expect(h.vault.create).not.toHaveBeenCalled();
        } finally { h.service.dispose(); }
    });

    it("rejects move followed by a guessed content baseline before any write", async () => {
        const h = await fixture();
        try {
            const input = h.batch([move(), append("after", "archive/a.md", "B")]);
            const result = await h.executor.prepareBatch!(input);
            expect(result?.toolResults.get("move")?.executionState).toBe("not_started");
            expect(h.vault.contents.get("notes/a.md")).toBe("A"); expect(h.vault.renameFile).not.toHaveBeenCalled();
        } finally { h.service.dispose(); }
    });

    it("protects a same-content replacement identity and a later occupied destination", async () => {
        const h = await fixture();
        try {
            const input = h.batch([move()]); await h.executor.prepareBatch!(input);
            h.vault.identities.set("notes/a.md", { path: "notes/a.md", extension: "md" });
            expect(JSON.parse((await h.call(input)).promptText).operations[0]).toMatchObject({ status: "stale" });
            const fresh = h.batch([move()], "fresh"); await h.executor.prepareBatch!(fresh);
            h.vault.identities.set("archive/a.md", { path: "archive/a.md", extension: "md" }); h.vault.contents.set("archive/a.md", "Other");
            expect(JSON.parse((await h.call(fresh)).promptText).operations[0]).toMatchObject({ status: "failed", failureCategory: "target_collision" });
            expect(h.vault.contents.get("notes/a.md")).toBe("A"); expect(h.vault.contents.get("archive/a.md")).toBe("Other");
        } finally { h.service.dispose(); }
    });

    it("retains a proven path success when its Undo baseline read fails", async () => {
        const h = await fixture();
        try {
            const input = h.batch([move()]); await h.executor.prepareBatch!(input);
            const read = h.vault.read.getMockImplementation()!;
            h.vault.read.mockImplementation(async file => { if (file.path === "archive/a.md") throw new Error("read failed"); return read(file); });
            const result = JSON.parse((await h.call(input)).promptText);
            expect(result).toMatchObject({ state: "completed", undoAvailable: false, operations: [{ status: "succeeded", failureCategory: "undo_unavailable" }] });
            expect(h.vault.getAbstractFileByPath("notes/a.md")).toBeNull();
            expect(h.vault.contents.get("archive/a.md")).toBe("A");
            await h.call(input); expect(h.vault.renameFile).toHaveBeenCalledTimes(1);
        } finally { h.service.dispose(); }
    });

    it("protects later edits and occupied original paths during Undo", async () => {
        const h = await fixture();
        try {
            const input = h.batch([move()]); await h.executor.prepareBatch!(input);
            const receipt = JSON.parse((await h.call(input)).promptText).operations[0].receiptId;
            h.vault.contents.set("archive/a.md", "User edit");
            expect(await h.session.undoMany([receipt])).toMatchObject([{ status: "stale", failureCategory: "stale_target" }]);
            expect(h.vault.contents.get("archive/a.md")).toBe("User edit");
            h.vault.contents.set("archive/a.md", "A");
            h.vault.identities.set("notes/a.md", { path: "notes/a.md", extension: "md" }); h.vault.contents.set("notes/a.md", "Other");
            expect(await h.session.undoMany([receipt])).toMatchObject([{ status: "failed", failureCategory: "target_collision" }]);
            expect(h.vault.contents.get("notes/a.md")).toBe("Other"); expect(h.vault.contents.get("archive/a.md")).toBe("A");
        } finally { h.service.dispose(); }
    });

    it("rechecks content drift while destination lookup is pending before native Undo", async () => {
        const h = await fixture();
        try {
            const input = h.batch([move()]); await h.executor.prepareBatch!(input);
            const receipt = JSON.parse((await h.call(input)).promptText).operations[0].receiptId;
            let release!: () => void, started!: () => void;
            const waiting = new Promise<void>(resolve => { started = resolve; });
            const originalExists = h.vault.adapter.exists;
            h.vault.adapter.exists = async path => {
                if (path === "notes/a.md") { started(); await new Promise<void>(resolve => { release = resolve; }); }
                return originalExists(path);
            };
            const undo = h.session.undoMany([receipt]);
            await waiting; h.vault.contents.set("archive/a.md", "Edit during lookup"); release();
            expect(await undo).toMatchObject([{ status: "stale", failureCategory: "stale_target" }]);
            expect(h.vault.contents.get("archive/a.md")).toBe("Edit during lookup");
            expect(h.vault.getAbstractFileByPath("notes/a.md")).toBeNull();
        } finally { h.service.dispose(); }
    });

    it("reports an unchanged native path without an effect receipt or Undo", async () => {
        const h = await fixture();
        try {
            const input = h.batch([move("notes/a.md", "notes/a.md")]); await h.executor.prepareBatch!(input);
            const result = JSON.parse((await h.call(input)).promptText);
            expect(result).toMatchObject({ state: "completed", undoAvailable: false, operations: [{ status: "unchanged" }] });
            expect(result.operations[0].receiptId).toBeUndefined(); expect(h.vault.renameFile).not.toHaveBeenCalled();
        } finally { h.service.dispose(); }
    });
});
