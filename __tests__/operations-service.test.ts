import { describe, expect, it, jest } from "@jest/globals";

import type { ProviderLoadContext } from "../src/ai-services/capability-types";
import { OperationsControllerError } from "../src/ai-services/operations/operations-intent-controller";
import { formatOperationsPreview } from "../src/ai-services/operations/operations-presentation";
import {
    OperationsService,
} from "../src/ai-services/operations/operations-service";
import { OperationsToolProvider } from "../src/ai-services/operations/operations-tool-provider";
import { ChatService } from "../src/ai-services/chat-service";
import { completeInputLineage } from "../src/ai-services/input-lineage";
import { type PaAgentActionState, applyOperationsExecutionResult } from "../src/ai-services/pa-agent-result-facts";
import { ChatHistoryManager } from "../src/chat/chat-history-manager";
import { MemoryChatHistoryStore } from "../src/chat/chat-history-store";
import type { TaskSourceReadGuard } from "../src/ai-services/task-source-read-guard";
import {
    EXECUTE_OPERATIONS_TOOL_NAME,
    type ExecuteCurrentOperationsIntentInput,
    type OperationsControllerEvent,
    type OperationsVault,
    type OperationsVaultFile,
    type PreparedMarkdownOperation,
    type PreparedOperation,
} from "../src/ai-services/operations/types";

class MemoryVault implements OperationsVault {
    readonly files = new Map<string, string>();
    readonly folders = new Set<string>(["notes"]);

    readonly adapter = {
        exists: jest.fn(async (path: string) => this.files.has(path) || this.folders.has(path)),
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

    getAbstractFileByPath(path: string): OperationsVaultFile | null {
        if (this.files.has(path)) return { path, extension: "md" };
        if (this.folders.has(path)) return { path, children: [] };
        return null;
    }
}

function providerContext(enabled = true): ProviderLoadContext {
    return {
        turnId: "turn-1",
        platform: "desktop",
        settings: { operationsAgentEnabled: enabled },
    };
}

function appendInput(path: string, content: string) {
    return {
        runId: "run-1",
        turnId: "turn-1",
        operations: [
            { toolCallId: `call-${path}`, name: "vault_append" as const, input: { path, content } },
        ],
    };
}

function sourceGuard(options: {
    current?: boolean;
    noteDomain?: boolean;
    allowedPaths?: readonly string[];
} = {}): TaskSourceReadGuard {
    const current = () => options.current ?? true;
    return Object.freeze({
        isCurrent: current,
        isPathAllowed: (path: string) => current() && (options.allowedPaths ?? ["notes/a.md", "notes/b.md"]).includes(path),
        isNoteDomainAllowed: () => current() && (options.noteDomain ?? true),
    });
}

function agentExecutionInput(
    intentId: string,
    runId = "run-1",
    guard: TaskSourceReadGuard = sourceGuard(),
): ExecuteCurrentOperationsIntentInput {
    return { intentId, runId, taskSourceReadGuard: guard };
}

function pendingContext(intentId: string): PaAgentActionState {
    return { schemaVersion: 1, owner: "operations", operationId: intentId, phase: "pending", revision: 0,
        origin: { runId: "run-1", turnId: "canonical-turn", assistantId: "assistant-1", callId: "call-1", resultId: "result-1" },
        inputLineage: completeInputLineage([{ kind: "user-text", messageId: "user-1" }]),
        receipt: { kind: "operations-staged", intentId } };
}

function sharedChatServices(vault: MemoryVault, options: { now?: () => number; pendingTtlMs?: number } = {}) {
    const operations = new OperationsService({ vault, trashFile: async () => undefined,
        isOperationsAgentEnabled: () => true, ...options });
    const owner = operations.createSession({ surface: "chat-owner" });
    const reader = operations.createSession({ surface: "chat-reader" });
    const host = { app: { vault }, settings: {}, log: jest.fn() } as unknown as ConstructorParameters<typeof ChatService>[0];
    return { operations, owner, reader, a: new ChatService(host, owner), b: new ChatService(host, reader) };
}

describe("Operations context across Chat sessions", () => {
    it("preserves remaining Undo ability and current status when only one legacy operation is undone", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/a.md", "A");
        vault.files.set("notes/b.md", "B");
        const h = sharedChatServices(vault);
        try {
            const intent = await h.owner.stage({ runId: "run-1", turnId: "turn-1", operations: [
                { toolCallId: "call-1", name: "vault_append", input: { path: "notes/a.md", content: "first" } },
                { toolCallId: "call-2", name: "vault_append", input: { path: "notes/b.md", content: "second" } },
            ] });
            const executed = await h.a.confirmOperationsIntent(intent.id);
            const completed = h.a.refreshOperationsActionState(pendingContext(intent.id));
            await h.a.undoOperations([executed.operations[0].receiptId!]);
            const partial = h.a.refreshOperationsActionState(completed);
            expect(partial).toMatchObject({ phase: "partial", operationsUndoAvailable: true });
            expect(h.a.getVisibleOperationsStatus(intent.id, "run-1")).toMatchObject({ state: "partial", undoAvailable: true });
            expect(h.a.refreshOperationsActionState(partial)).toEqual(partial);
            await h.a.undoOperations([executed.operations[1].receiptId!]);
            const undone = h.a.refreshOperationsActionState(partial);
            expect(undone).toMatchObject({ phase: "undone", operationsUndoAvailable: false });
            expect(h.a.getVisibleOperationsStatus(intent.id, "run-1")).toMatchObject({ state: "undone", undoAvailable: false });
            expect(h.a.refreshOperationsActionState(undone)).toEqual(undone);
        } finally { h.a.dispose(); h.b.dispose(); h.operations.dispose(); }
    });

    it("reads the live original owner without granting another session confirmation or Undo", async () => {
        const vault = new MemoryVault(); vault.files.set("notes/a.md", "A");
        const h = sharedChatServices(vault);
        const store = new MemoryChatHistoryStore(), manager = new ChatHistoryManager({ store });
        try {
            await manager.initialize();
            const intent = await h.owner.stage({ runId: "run-1", turnId: "turn-1", operations: [
                { toolCallId: "call-1", name: "vault_append", input: { path: "notes/a.md", content: "B" } },
            ] });
            const pending = pendingContext(intent.id);
            const conversation = await manager.startConversation("Append B");
            const binding = { conversationId: conversation.id, turnIndex: 0, runId: pending.origin.runId, turnId: pending.origin.turnId };
            await store.appendTurn({ conversationId: conversation.id, turnIndex: 0,
                user: { role: "user", content: "Append B" }, assistant: { role: "assistant", content: "Review the proposal",
                    actionStateBinding: binding, actionStates: [pending] } });
            expect(await manager.updateActionStatesForOperation(conversation.id, pending.origin.runId, "operations", intent.id,
                states => states.map(state => h.b.refreshOperationsActionState(state)))).toEqual([pending]);
            const pendingWrites: Promise<unknown>[] = [];
            h.a.registerOperationsContextPersistence(intent.id, execution => {
                const write = manager.updateActionStatesForOperation(conversation.id, pending.origin.runId, "operations", intent.id,
                    states => states.map(state => execution ? applyOperationsExecutionResult(state, execution) ?? state
                        : h.a.refreshOperationsActionState(state)));
                pendingWrites.push(write);
                return write.then(() => undefined);
            });
            await expect(h.b.confirmOperationsIntent(intent.id)).rejects.toMatchObject({ category: "expired" });
            expect(() => h.b.cancelOperationsIntent(intent.id)).toThrow("Intent is missing or expired");
            expect(vault.process).not.toHaveBeenCalled();
            const result = await h.a.confirmOperationsIntent(intent.id);
            await Promise.all(pendingWrites);
            const completed = h.b.refreshOperationsActionState(pending);
            expect(completed).toMatchObject({ phase: "completed", actions: [{ phase: "applied", receiptId: result.operations[0].receiptId }] });
            expect(completed.inputLineage).toEqual(pending.inputLineage);
            expect((await store.getTurns(conversation.id))[0].assistant.actionStates).toEqual([expect.objectContaining({
                phase: "completed", origin: pending.origin, inputLineage: pending.inputLineage,
                operationsUndoAvailable: true })]);
            const receiptId = result.operations[0].receiptId!;
            expect((await h.b.undoOperations([receiptId]))[0].status).not.toBe("undone");
            expect(vault.files.get("notes/a.md")).toBe("A\nB");
            expect((await h.a.undoOperations([receiptId]))[0].status).toBe("undone");
            await Promise.all(pendingWrites);
            expect(h.b.refreshOperationsActionState(completed).phase).toBe("undone");
        } finally { h.a.dispose(); h.b.dispose(); h.operations.dispose(); await store.dispose(); }
    });

    it("corrects an existing lost observation from the latest stored revision, without reviving deleted turns", async () => {
        const vault = new MemoryVault(); vault.files.set("notes/a.md", "A");
        const h = sharedChatServices(vault), store = new MemoryChatHistoryStore();
        const manager = new ChatHistoryManager({ store });
        try {
            await manager.initialize();
            const intent = await h.owner.stage({ runId: "run-1", turnId: "turn-1", operations: [
                { toolCallId: "call-1", name: "vault_append", input: { path: "notes/a.md", content: "B" } },
            ] });
            const pending = pendingContext(intent.id), conversation = await manager.startConversation("Append B");
            const binding = { conversationId: conversation.id, turnIndex: 0, runId: pending.origin.runId, turnId: pending.origin.turnId };
            // Previously persisted by a reader that could only see its own session.
            const lost: PaAgentActionState = { ...pending, phase: "lost", revision: 1,
                receipt: { kind: "operations-terminal", intentId: intent.id, state: "lost" } };
            await store.appendTurn({ conversationId: conversation.id, turnIndex: 0,
                user: { role: "user", content: "Append B" },
                assistant: { role: "assistant", content: "Review the proposal", actionStateBinding: binding, actionStates: [lost] } });
            const result = await h.a.confirmOperationsIntent(intent.id);
            const stale = applyOperationsExecutionResult(pending, result)!;
            await expect(store.updateActionStates(binding, () => [stale])).rejects.toThrow("Conflicting action state revision");
            const updated = await manager.updateActionStatesForOperation(conversation.id, pending.origin.runId, "operations", intent.id,
                states => states.map(state => h.b.refreshOperationsActionState(state)));
            expect(updated).toEqual([expect.objectContaining({ phase: "completed", revision: 2, origin: pending.origin,
                inputLineage: pending.inputLineage })]);
            expect((await store.getTurns(conversation.id))[0].assistant.actionStates).toEqual(updated);
            expect(await manager.updateActionStatesForOperation("other-conversation", pending.origin.runId, "operations", intent.id, () => updated!))
                .toBeUndefined();
            await store.deleteTurn(conversation.id, 0);
            expect(await manager.updateActionStatesForOperation(conversation.id, pending.origin.runId, "operations", intent.id,
                states => states.map(state => h.a.refreshOperationsActionState(state)))).toBeUndefined();
            expect(await store.getTurns(conversation.id)).toEqual([]);
            expect(vault.process).toHaveBeenCalledTimes(1);
        } finally { h.a.dispose(); h.b.dispose(); h.operations.dispose(); await store.dispose(); }
    });

    it("keeps genuinely disposed owners lost and does not adopt a different run's result", async () => {
        const vault = new MemoryVault(); vault.files.set("notes/a.md", "A");
        const h = sharedChatServices(vault);
        try {
            const intent = await h.owner.stage({ runId: "run-1", turnId: "turn-1", operations: [
                { toolCallId: "call-1", name: "vault_append", input: { path: "notes/a.md", content: "B" } },
            ] });
            const pending = pendingContext(intent.id);
            await h.a.confirmOperationsIntent(intent.id);
            const completed = h.b.refreshOperationsActionState(pending);
            expect(completed.phase).toBe("completed");
            const foreign = { ...pending, origin: { ...pending.origin, runId: "other-run" } };
            expect(h.b.refreshOperationsActionState(foreign).phase).toBe("lost");
            h.a.dispose();
            expect(h.b.refreshOperationsActionState(pending).phase).toBe("lost");
            expect(h.b.refreshOperationsActionState(completed)).toEqual(completed);
        } finally { h.a.dispose(); h.b.dispose(); h.operations.dispose(); }
    });

    it.each(["cancelled", "expired"] as const)("reads the original owner's %s terminal without substituting a different run", async phase => {
        const vault = new MemoryVault(); vault.files.set("notes/a.md", "A");
        let now = 1_000;
        const h = sharedChatServices(vault, { now: () => now, pendingTtlMs: 1_000 });
        try {
            const intent = await h.owner.stage({ runId: "run-1", turnId: "turn-1", operations: [
                { toolCallId: "call-1", name: "vault_append", input: { path: "notes/a.md", content: "B" } },
            ] });
            if (phase === "cancelled") h.a.cancelOperationsIntent(intent.id);
            else now += 1_001;
            const pending = pendingContext(intent.id);
            expect(h.b.refreshOperationsActionState(pending).phase).toBe(phase);
            const lost: PaAgentActionState = { ...pending, phase: "lost", revision: 1,
                receipt: { kind: "operations-terminal", intentId: intent.id, state: "lost" } };
            expect(h.b.refreshOperationsActionState(lost)).toMatchObject({ phase, revision: 2 });
            expect(h.b.refreshOperationsActionState({ ...pending, origin: { ...pending.origin, runId: "other-run" } }).phase).toBe("lost");
            expect(vault.process).not.toHaveBeenCalled();
        } finally { h.a.dispose(); h.b.dispose(); h.operations.dispose(); }
    });
});

describe("OperationsSession current-request execution", () => {
    it("executes only the owning request, repeats terminal facts, and observes an executing intent", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/a.md", "A");
        const service = new OperationsService({
            vault,
            trashFile: async () => undefined,
            isOperationsAgentEnabled: () => true,
        });
        const session = service.createSession({ surface: "chat" });
        const intent = await session.stage(appendInput("notes/a.md", "B"));

        await expect(session.executeCurrentIntent(agentExecutionInput(intent.id, "other-run")))
            .rejects.toMatchObject({ category: "expired" });
        expect(vault.process).not.toHaveBeenCalled();

        let releaseProcess!: () => void;
        vault.process.mockImplementationOnce(async () => {
            await new Promise<void>(resolve => { releaseProcess = resolve; });
            vault.files.set("notes/a.md", "A\nB");
            return "A\nB";
        });
        const executing = session.executeCurrentIntent(agentExecutionInput(intent.id));
        const inProgress = await session.executeCurrentIntent(agentExecutionInput(intent.id));
        expect(inProgress).toMatchObject({ intentId: intent.id, state: "executing", operations: [] });
        releaseProcess();
        const result = await executing;
        expect(result.state).toBe("completed");
        const repeated = await session.executeCurrentIntent(agentExecutionInput(intent.id));
        expect(repeated).toMatchObject({ intentId: intent.id, state: "completed" });
        expect(repeated.resultFact).toEqual(result.resultFact);
        expect(vault.process).toHaveBeenCalledTimes(1);
        expect(vault.files.get("notes/a.md")).toBe("A\nB");
        service.dispose();
    });

    it("lets another session observe but not execute the original pending intent", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/a.md", "A");
        const service = new OperationsService({
            vault,
            trashFile: async () => undefined,
            isOperationsAgentEnabled: () => true,
        });
        const owner = service.createSession({ surface: "chat-owner" });
        const observer = service.createSession({ surface: "chat-reader" });
        const intent = await owner.stage(appendInput("notes/a.md", "B"));

        expect(observer.getContextResult(intent.id, "run-1")).toMatchObject({ pending: true });
        await expect(observer.executeCurrentIntent(agentExecutionInput(intent.id)))
            .rejects.toMatchObject({ category: "expired" });
        expect(await owner.executeCurrentIntent(agentExecutionInput(intent.id))).toMatchObject({ state: "completed" });
        expect(vault.process).toHaveBeenCalledTimes(1);
        service.dispose();
    });

    it.each([
        ["revoked source scope", sourceGuard({ current: false })],
        ["web-only source scope", sourceGuard({ noteDomain: false })],
        ["target outside source scope", sourceGuard({ allowedPaths: ["notes/other.md"] })],
    ])("rejects execution before a write when the %s changed", async (_label, guard) => {
        const vault = new MemoryVault();
        vault.files.set("notes/a.md", "A");
        const service = new OperationsService({
            vault,
            trashFile: async () => undefined,
            isOperationsAgentEnabled: () => true,
        });
        const session = service.createSession({ surface: "chat" });
        const stageGuard = _label === "target outside source scope"
            ? sourceGuard({ allowedPaths: ["notes/a.md"] })
            : sourceGuard();
        const intent = await session.stage({
            ...appendInput("notes/a.md", "B"),
            taskSourceReadGuard: stageGuard,
        });

        await expect(session.executeCurrentIntent(agentExecutionInput(intent.id, "run-1", guard)))
            .rejects.toMatchObject({ category: "boundary_denied" });
        expect(vault.process).not.toHaveBeenCalled();
        service.dispose();
    });

    it("rejects a cancelled current-request intent without rewriting it", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/a.md", "A");
        const service = new OperationsService({
            vault,
            trashFile: async () => undefined,
            isOperationsAgentEnabled: () => true,
        });
        const session = service.createSession({ surface: "chat" });
        const intent = await session.stage(appendInput("notes/a.md", "B"));
        session.cancel(intent.id);
        expect(session.getContextResult(intent.id, "run-1")).toMatchObject({ terminal: "cancelled" });

        const error = await session.executeCurrentIntent(agentExecutionInput(intent.id))
            .catch(reason => reason as OperationsControllerError);
        expect(error).toMatchObject({ category: "cancelled", message: "The Operations intent is cancelled." });
        expect(vault.process).not.toHaveBeenCalled();
        service.dispose();
    });
});

describe("B-161 live Operations execution", () => {
    function deferred() {
        let resolve!: () => void;
        const promise = new Promise<void>(done => { resolve = done; });
        return { promise, resolve };
    }

    function executionFixture() {
        const vault = new MemoryVault();
        vault.files.set("notes/a.md", "A");
        vault.files.set("notes/b.md", "B");
        const access = { current: true, enabled: true };
        const abort = new AbortController();
        const service = new OperationsService({ vault, trashFile: async () => undefined,
            isOperationsAgentEnabled: () => access.enabled });
        const session = service.createSession({ surface: "chat" });
        const input = (intentId: string) => ({ ...agentExecutionInput(intentId, "run-1", sourceGuard(access)), signal: abort.signal });
        const revoke = (kind: string) => {
            if (kind === "cancel") abort.abort();
            else if (kind === "source revoke") access.current = false;
            else access.enabled = false;
        };
        return { vault, service, session, input, revoke };
    }

    it.each(["cancel", "source revoke", "disable"])("does not create after %s while target lookup is pending", async kind => {
        const h = executionFixture();
        try {
            const intent = await h.session.stage({ runId: "run-1", turnId: "turn-1", operations: [
                { toolCallId: "create", name: "vault_create", input: { path: "notes/new.md", content: "New" } },
            ] });
            const started = deferred(), release = deferred();
            h.vault.adapter.exists.mockImplementationOnce(async () => {
                started.resolve();
                await release.promise;
                return false;
            });
            const executing = h.session.executeCurrentIntent(h.input(intent.id));
            await started.promise;
            h.revoke(kind);
            release.resolve();
            expect(await executing).toMatchObject({ state: "failed", operations: [{ status: "failed" }] });
            expect(h.vault.create).not.toHaveBeenCalled();
            expect(h.vault.files.has("notes/new.md")).toBe(false);
        } finally { h.service.dispose(); }
    });

    it.each(["cancel", "source revoke", "disable"])("does not mutate when %s precedes the atomic process callback", async kind => {
        const h = executionFixture();
        try {
            const intent = await h.session.stage(appendInput("notes/a.md", "changed"));
            const started = deferred(), release = deferred();
            h.vault.process.mockImplementationOnce(async (file, change) => {
                started.resolve();
                await release.promise;
                const next = change(h.vault.files.get(file.path)!);
                h.vault.files.set(file.path, next);
                return next;
            });
            const executing = h.session.executeCurrentIntent(h.input(intent.id));
            await started.promise;
            h.revoke(kind);
            release.resolve();
            expect(await executing).toMatchObject({ state: "failed", operations: [{ status: "failed" }] });
            expect(h.vault.files.get("notes/a.md")).toBe("A");
        } finally { h.service.dispose(); }
    });

    it.each(["cancel", "source revoke", "disable"])("preserves a native write in progress on %s and skips the next operation", async kind => {
        const h = executionFixture();
        try {
            const intent = await h.session.stage({ ...appendInput("notes/a.md", "changed"), operations: [
                ...appendInput("notes/a.md", "changed").operations,
                ...appendInput("notes/b.md", "changed").operations,
            ] });
            const started = deferred(), release = deferred();
            h.vault.process.mockImplementationOnce(async (file, change) => {
                const next = change(h.vault.files.get(file.path)!);
                started.resolve();
                await release.promise;
                h.vault.files.set(file.path, next);
                return next;
            });
            const executing = h.session.executeCurrentIntent(h.input(intent.id));
            await started.promise;
            h.revoke(kind);
            release.resolve();
            expect(await executing).toMatchObject({ state: "partial", operations: [
                { status: "succeeded" }, { status: "skipped" },
            ] });
            expect(h.vault.process).toHaveBeenCalledTimes(1);
            expect(h.vault.files.get("notes/a.md")).toBe("A\nchanged");
            expect(h.vault.files.get("notes/b.md")).toBe("B");
        } finally { h.service.dispose(); }
    });

    it("persists the original conversation's real partial result after its ChatService is disposed", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/a.md", "A");
        vault.files.set("notes/b.md", "B");
        const h = sharedChatServices(vault);
        const store = new MemoryChatHistoryStore(), manager = new ChatHistoryManager({ store });
        try {
            await manager.initialize();
            const intent = await h.owner.stage({ ...appendInput("notes/a.md", "changed"), operations: [
                { ...appendInput("notes/a.md", "changed").operations[0], toolCallId: "call-1" },
                ...appendInput("notes/b.md", "changed").operations,
            ] });
            const pending = pendingContext(intent.id), conversation = await manager.startConversation("Apply both changes");
            const binding = { conversationId: conversation.id, turnIndex: 0,
                runId: pending.origin.runId, turnId: pending.origin.turnId };
            await store.appendTurn({ conversationId: conversation.id, turnIndex: 0,
                user: { role: "user", content: "Apply both changes" },
                assistant: { role: "assistant", content: "", actionStateBinding: binding, actionStates: [pending] } });
            const persistence = jest.fn(async (execution?: Parameters<typeof applyOperationsExecutionResult>[1]) => {
                await manager.updateActionStatesForOperation(conversation.id, pending.origin.runId, "operations", intent.id,
                    states => states.map(state => execution ? applyOperationsExecutionResult(state, execution) ?? state
                        : h.a.refreshOperationsActionState(state)));
            });
            h.a.registerOperationsContextPersistence(intent.id, persistence);
            const events: OperationsControllerEvent[] = [];
            h.owner.subscribe(event => events.push(event));
            const started = deferred(), release = deferred();
            vault.process.mockImplementationOnce(async (file, change) => {
                const next = change(vault.files.get(file.path)!);
                started.resolve();
                await release.promise;
                vault.files.set(file.path, next);
                return next;
            });
            const executing = h.a.executeOperationsIntentFromAgent(agentExecutionInput(intent.id));
            await started.promise;
            h.a.dispose();
            release.resolve();
            expect(await executing).toMatchObject({ state: "partial", operations: [
                { status: "succeeded", undoAvailable: false }, { status: "skipped", undoAvailable: false },
            ] });
            expect(vault.files.get("notes/a.md")).toBe("A\nchanged");
            expect(vault.files.get("notes/b.md")).toBe("B");
            expect(vault.process).toHaveBeenCalledTimes(1);
            expect(persistence).toHaveBeenCalledWith(expect.objectContaining({ state: "partial" }));
            expect((await store.getTurns(conversation.id))[0].assistant.actionStates).toEqual([
                expect.objectContaining({ phase: "partial", origin: pending.origin,
                    inputLineage: pending.inputLineage, operationsUndoAvailable: false }),
            ]);
            const disposedIndex = events.findIndex(event => event.type === "disposed");
            expect(disposedIndex).toBeGreaterThanOrEqual(0);
            expect(events.slice(disposedIndex + 1)).toEqual([]);
        } finally { h.a.dispose(); h.b.dispose(); h.operations.dispose(); await store.dispose(); }
    });

    it("retains an unknown native write result and does not replay the intent", async () => {
        const h = executionFixture();
        try {
            const intent = await h.session.stage(appendInput("notes/a.md", "changed"));
            h.vault.process.mockImplementationOnce(async (file, change) => {
                h.vault.files.set(file.path, change(h.vault.files.get(file.path)!));
                throw new Error("Native completion acknowledgement lost");
            });
            expect(await h.session.executeCurrentIntent(h.input(intent.id))).toMatchObject({
                state: "unknown", operations: [{ status: "unknown" }],
            });
            expect(await h.session.executeCurrentIntent(h.input(intent.id))).toMatchObject({ state: "unknown" });
            h.revoke("disable");
            h.revoke("cancel");
            expect(await h.session.executeCurrentIntent(h.input(intent.id))).toMatchObject({ state: "unknown" });
            expect(h.vault.process).toHaveBeenCalledTimes(1);
            expect(h.vault.files.get("notes/a.md")).toBe("A\nchanged");
        } finally { h.service.dispose(); }
    });
});

describe("OperationsToolProvider shared identity", () => {
    it("returns the same five staging objects and execution object across repeated loads", async () => {
        const provider = new OperationsToolProvider();
        const first = await provider.load(providerContext());
        const second = await provider.load(providerContext());

        expect(first.status).toBe("available");
        expect(second.status).toBe("available");
        expect(first.capabilities.map(capability => capability.name)).toEqual([
            "vault_create",
            "vault_append",
            "vault_process",
            "frontmatter_update",
            "remove_note_image",
            EXECUTE_OPERATIONS_TOOL_NAME,
        ]);
        expect(second.capabilities).toHaveLength(6);
        first.capabilities.forEach((capability, index) => {
            expect(second.capabilities[index]).toBe(capability);
        });
    });
});

describe("OperationsService", () => {
    it("shares provider and policy configuration while isolating surface state", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/chat.md", "Chat");
        vault.files.set("notes/pagelet.md", "Pagelet");
        let enabled = true;
        const chatSelfWrite = jest.fn();
        const pageletSelfWrite = jest.fn();
        const service = new OperationsService({
            vault,
            trashFile: async () => undefined,
            isOperationsAgentEnabled: () => enabled,
            isPathAllowed: (path) => path.startsWith("notes/"),
        });
        const chat = service.createSession({ surface: "chat", markSelfWrite: chatSelfWrite });
        const pagelet = service.createSession({ surface: "pagelet", markSelfWrite: pageletSelfWrite });
        const chatEvents: OperationsControllerEvent[] = [];
        const pageletEvents: OperationsControllerEvent[] = [];
        chat.subscribe((event) => chatEvents.push(event));
        pagelet.subscribe((event) => pageletEvents.push(event));

        expect(chat.provider).toBe(service.provider);
        expect(pagelet.provider).toBe(service.provider);
        expect(chat.capabilityProvider).toBe(pagelet.capabilityProvider);

        const chatIntent = await chat.stage(appendInput("notes/chat.md", "chat staged"));
        const pageletIntent = await pagelet.stageIntent(appendInput("notes/pagelet.md", "pagelet confirmed"));
        chat.cancelPending();
        const result = await pagelet.confirm(pageletIntent.id);

        expect(result.state).toBe("completed");
        expect(vault.files.get("notes/chat.md")).toBe("Chat");
        expect(vault.files.get("notes/pagelet.md")).toBe("Pagelet\npagelet confirmed");
        expect(chatEvents).toContainEqual(expect.objectContaining({
            type: "intent-cancelled",
            intent: expect.objectContaining({ id: chatIntent.id }),
        }));
        expect(pageletEvents.some((event) => event.type === "intent-result")).toBe(true);
        expect(chatSelfWrite).not.toHaveBeenCalled();
        expect(pageletSelfWrite).toHaveBeenCalledWith("notes/pagelet.md");

        enabled = false;
        service.dispose();
    });

    it("fails closed before staging when Operations is disabled", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/a.md", "A");
        const service = new OperationsService({
            vault,
            trashFile: async () => undefined,
            isOperationsAgentEnabled: () => false,
        });
        const session = service.createSession({ surface: "pagelet" });

        await expect(session.stage(appendInput("notes/a.md", "blocked"))).rejects.toMatchObject({
            category: "cancelled",
        });
        expect(vault.cachedRead).not.toHaveBeenCalled();
        expect(vault.process).not.toHaveBeenCalled();
        service.dispose();
    });

    it("cancels a proposal when Operations is disabled during staging", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/a.md", "A");
        let enabled = true;
        vault.cachedRead.mockImplementationOnce(async (file) => {
            enabled = false;
            return vault.files.get(file.path) ?? "";
        });
        const service = new OperationsService({
            vault,
            trashFile: async () => undefined,
            isOperationsAgentEnabled: () => enabled,
        });
        const session = service.createSession({ surface: "pagelet" });
        const events: OperationsControllerEvent[] = [];
        session.subscribe((event) => events.push(event));

        await expect(session.stage(appendInput("notes/a.md", "blocked"))).rejects.toThrow(
            "Operations is no longer enabled",
        );
        expect(events.map((event) => event.type)).toEqual(["intent-staged", "intent-cancelled"]);
        expect(vault.process).not.toHaveBeenCalled();
        service.dispose();
    });

    it("cancels pending confirmation when Operations is disabled", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/a.md", "A");
        let enabled = true;
        const service = new OperationsService({
            vault,
            trashFile: async () => undefined,
            isOperationsAgentEnabled: () => enabled,
        });
        const session = service.createSession({ surface: "chat" });
        const events: OperationsControllerEvent[] = [];
        session.subscribe((event) => events.push(event));
        const intent = await session.stage(appendInput("notes/a.md", "blocked"));

        enabled = false;
        await expect(session.confirm(intent.id)).rejects.toThrow("Nothing was written");
        expect(events).toContainEqual(expect.objectContaining({
            type: "intent-cancelled",
            intent: expect.objectContaining({ id: intent.id }),
        }));
        expect(vault.process).not.toHaveBeenCalled();
        service.dispose();
    });

    it("shares the Data Boundary across sessions without audit storage", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/a.md", "A");
        vault.files.set("private.md", "Private");
        const service = new OperationsService({
            vault,
            trashFile: async () => undefined,
            isOperationsAgentEnabled: () => true,
            isPathAllowed: (path) => path.startsWith("notes/"),
        });
        const chat = service.createSession({ surface: "chat" });
        const pagelet = service.createSession({ surface: "pagelet" });

        await expect(chat.stage(appendInput("private.md", "blocked"))).rejects.toMatchObject({
            category: "boundary_denied",
        });
        const intent = await pagelet.stage(appendInput("notes/a.md", "ok"));
        await pagelet.confirm(intent.id);

        expect(vault.adapter.exists).not.toHaveBeenCalledWith(".obsidian/plugins/personal-assistant/audit");
        service.dispose();
    });

    it("disposes all sessions and rejects later staging", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/a.md", "A");
        const service = new OperationsService({
            vault,
            trashFile: async () => undefined,
            isOperationsAgentEnabled: () => true,
        });
        const session = service.createSession({ surface: "chat" });
        service.dispose();

        await expect(session.stage(appendInput("notes/a.md", "blocked"))).rejects.toBeInstanceOf(
            OperationsControllerError,
        );
        expect(() => service.createSession({ surface: "pagelet" })).toThrow("service is disposed");
    });
});

describe("formatOperationsPreview", () => {
    it("preserves create, append, frontmatter, and before/after semantics", () => {
        expect(formatOperationsPreview(operation({
            name: "vault_create",
            input: { path: "notes/new.md", content: "Created" },
            expectedBefore: null,
            expectedAfter: "Created",
        }))).toBe("Created");
        expect(formatOperationsPreview(operation({
            name: "vault_append",
            input: { path: "notes/a.md", content: "Added" },
            expectedBefore: "A",
            expectedAfter: "A\nAdded",
        }))).toBe("+ Added");
        expect(formatOperationsPreview(operation({
            name: "frontmatter_update",
            input: { path: "notes/a.md", set: { status: "done" }, delete: ["old"] },
            expectedBefore: "---\n---",
            expectedAfter: "---\nstatus: done\n---",
        }))).toBe('Set status: "done"\nRemove old');
        expect(formatOperationsPreview(operation({
            name: "vault_process",
            input: {
                path: "notes/a.md",
                operation: "replace",
                params: { search: "Before", replace: "After" },
            },
            expectedBefore: "Before value",
            expectedAfter: "After value",
        }))).toBe("Before\nBefore value\n\nAfter\nAfter value");
    });

    it("keeps complete replacement ranges while bounding only unchanged context", () => {
        const before = `OLD-START-${"O".repeat(1_800)}-OLD-END`;
        const after = `NEW-START-${"N".repeat(1_800)}-NEW-END`;
        const preview = formatOperationsPreview(operation({
            name: "vault_process",
            input: {
                path: "notes/a.md",
                operation: "replace",
                params: { search: "A", replace: "B" },
            },
            expectedBefore: before,
            expectedAfter: after,
        }));

        expect(preview).toContain("OLD-START-");
        expect(preview).toContain("-OLD-END");
        expect(preview).toContain("NEW-START-");
        expect(preview).toContain("-NEW-END");
        expect(preview).not.toContain("…");
    });

    it("keeps replacement text visible when Before exceeds the legacy preview limit", () => {
        const before = `unchanged prefix\n${"B".repeat(1_800)}\nunchanged suffix`;
        const after = "unchanged prefix\nNEW-START replacement that must remain reachable NEW-END\nunchanged suffix";
        const preview = formatOperationsPreview(operation({
            name: "vault_process",
            input: {
                path: "notes/a.md",
                operation: "replace",
                params: { search: before, replace: after },
            },
            expectedBefore: before,
            expectedAfter: after,
        }));

        expect(preview).toContain("After");
        expect(preview).toContain("NEW-START");
        expect(preview).toContain("NEW-END");
    });
});

function operation(
    input: Pick<PreparedMarkdownOperation, "name" | "input" | "expectedBefore" | "expectedAfter">,
): PreparedOperation {
    return {
        kind: "markdown",
        id: "operation-1",
        toolCallId: "call-1",
        path: input.input.path,
        ...input,
    };
}
