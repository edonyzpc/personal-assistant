import { CapabilityRegistry } from "../src/ai-services/capability-registry";
import { PolicyEngine } from "../src/ai-services/policy-engine";
import { TaskSourceConstraintState } from "../src/ai-services/task-source-constraint";
import type { TaskSourceReadGuard } from "../src/ai-services/task-source-read-guard";
import type { PaAgentToolBatchPreparationInput, PaAgentToolExecutor, ParsedBufferedToolCall } from "../src/ai-services/pa-agent-types";
import { OperationsIntentController } from "../src/ai-services/operations/operations-intent-controller";
import { createOperationsStagingToolExecutor } from "../src/ai-services/operations/operations-tool-executor";
import { OperationsToolProvider } from "../src/ai-services/operations/operations-tool-provider";
import type { OperationsVault, OperationsVaultFile } from "../src/ai-services/operations/types";

jest.mock("obsidian");

async function harness() {
    const files = new Map([["notes/a.md", "A"], ["notes/b.md", "private B"]]);
    const vault = {
        getAbstractFileByPath: jest.fn((path: string): OperationsVaultFile | null => (
            files.has(path) ? { path, extension: "md" } : path === "notes" ? { path, children: [] } : null
        )),
        cachedRead: jest.fn(async (file: OperationsVaultFile) => files.get(file.path) ?? ""),
        create: jest.fn(async (path: string, _content: string) => ({ path })),
        process: jest.fn(async (_file: OperationsVaultFile, _change: (text: string) => string) => undefined),
        adapter: { exists: jest.fn(async (path: string) => files.has(path) || path === "notes") },
    } satisfies OperationsVault;
    const controller = new OperationsIntentController({ vault, trashFile: async () => undefined });
    const registry = new CapabilityRegistry({ policyEngine: new PolicyEngine({
        runKind: "chat-with-actions", allowWrite: true, allowedActionPermissions: ["local-filesystem-write"],
    }) });
    const loaded = await new OperationsToolProvider().load({
        turnId: "turn", platform: "desktop", settings: { operationsAgentEnabled: true },
    });
    registry.registerMany(loaded.capabilities);
    const state = new TaskSourceConstraintState({
        runId: "run", userMessageId: "user", userText: "只用当前笔记，保存到新笔记。",
        noteHandles: new Map([["current", "note-a"], ["other", "note-b"]]), currentNoteHandle: "current",
    });
    const candidate = state.prepareDeclaration({ instructionQuote: "只用当前笔记", notes: "current_note", webAllowed: false });
    if (!candidate.ok || !state.commit(candidate.constraint)) throw new Error("Scope fixture did not commit");
    const guard = state.createReadGuard(candidate.constraint,
        path => path === "notes/a.md" ? "note-a" : path === "notes/b.md" ? "note-b" : undefined,
        () => true,
        path => path === "notes/new.md");
    const baseExecutor: PaAgentToolExecutor = { execute: jest.fn(async () => ({ outcome: "success" as const, promptText: "base" })) };
    const executor = createOperationsStagingToolExecutor({ baseExecutor, registry, controller });
    return { vault, controller, state, guard, baseExecutor, executor };
}

function call(id: string, name: string, input: unknown, index = 0): ParsedBufferedToolCall {
    return { type: "toolCall", id, name, input, index };
}

function batch(toolCalls: ParsedBufferedToolCall[], taskSourceReadGuard: TaskSourceReadGuard): PaAgentToolBatchPreparationInput {
    return { runId: "run", turnId: "turn", turnIndex: 0, userInput: "只用当前笔记，保存到新笔记。",
        toolCalls, taskSourceReadGuard, signal: new AbortController().signal };
}

describe("Operations executor task source read boundary", () => {
    it("rejects an expired batch before any base or argument preparation", async () => {
        const h = await harness();
        const prepare = jest.fn(async () => undefined);
        h.baseExecutor.prepareBatch = prepare;
        try {
            const narrowed = h.state.prepareDeclaration({ instructionQuote: "只用当前笔记", notes: "none", webAllowed: false });
            if (!narrowed.ok || !h.state.commit(narrowed.constraint)) throw new Error("Fixture did not narrow");
            const result = await h.executor.prepareBatch!(batch([
                call("append", "vault_append", { path: "notes/a.md", content: "after" }),
            ], h.guard));
            expect(result?.toolResults.get("append")).toMatchObject({ outcome: "policy_rejected", metadata: { reason: "task_source_scope_changed" } });
            expect(prepare).not.toHaveBeenCalled();
            expect(h.vault.getAbstractFileByPath).not.toHaveBeenCalled();
            expect(h.controller.listPendingIntents()).toEqual([]);
        } finally { h.controller.dispose(); }
    });

    it("passes the host guard into the real controller and rejects a mixed-scope phase before any target read", async () => {
        const h = await harness();
        const stage = jest.spyOn(h.controller, "stageIntent");
        try {
            const input = batch([
                call("allowed", "vault_append", { path: "notes/a.md", content: "after" }),
                call("excluded", "vault_append", { path: "notes/b.md", content: "after" }, 1),
            ], h.guard);
            const result = await h.executor.prepareBatch!(input);
            expect(stage).toHaveBeenCalledWith(expect.objectContaining({ taskSourceReadGuard: h.guard }), input.signal);
            expect(result?.toolResults.get("allowed")).toMatchObject({ metadata: { staged: false, wrote: false } });
            expect(result?.toolResults.get("excluded")).toMatchObject({ metadata: { staged: false, wrote: false } });
            expect(h.vault.getAbstractFileByPath).not.toHaveBeenCalled();
            expect(h.vault.cachedRead).not.toHaveBeenCalled();
            expect(h.vault.adapter.exists).not.toHaveBeenCalled();
            expect(h.controller.listPendingIntents()).toEqual([]);
        } finally {
            h.controller.dispose();
        }
    });

    it("uses the current-note boundary for material while admitting the separately planned new output target", async () => {
        const h = await harness();
        try {
            expect(h.guard.isPathAllowed("notes/new.md", "task_material")).toBe(false);
            const result = await h.executor.prepareBatch!(batch([
                call("create", "vault_create", { path: "notes/new.md", content: "from the current note" }),
                call("append", "vault_append", { path: "notes/new.md", content: "a generated addition" }, 1),
            ], h.guard));
            expect(result?.toolResults.get("create")).toMatchObject({ outcome: "success", metadata: { staged: true, wrote: false } });
            expect(result?.toolResults.get("append")).toMatchObject({ outcome: "success", metadata: { staged: true, wrote: false } });
            const [intent] = h.controller.listPendingIntents();
            expect(intent?.operations[1]?.expectedBefore).toBe("from the current note");
            expect(intent).not.toHaveProperty("taskSourceReadGuard");
            expect(h.vault.adapter.exists).toHaveBeenCalledWith("notes/new.md");
            expect(h.vault.cachedRead).not.toHaveBeenCalled();
            expect(h.vault.create).not.toHaveBeenCalled();
            expect(h.baseExecutor.execute).not.toHaveBeenCalled();
        } finally {
            h.controller.dispose();
        }
    });

    it("rechecks the host constraint after an awaited base preparation", async () => {
        const h = await harness();
        let releasePrepare!: () => void;
        h.baseExecutor.prepareBatch = () => new Promise<void>(resolve => { releasePrepare = resolve; });
        try {
            const preparation = h.executor.prepareBatch!(batch([
                call("append", "vault_append", { path: "notes/a.md", content: "after" }),
            ], h.guard));
            const narrowed = h.state.prepareDeclaration({ instructionQuote: "只用当前笔记", notes: "none", webAllowed: false });
            if (!narrowed.ok || !h.state.commit(narrowed.constraint)) throw new Error("Narrowing fixture did not commit");
            releasePrepare();
            const result = await preparation;
            expect(result?.toolResults.get("append")).toMatchObject({ metadata: { staged: false, wrote: false } });
            expect(h.vault.getAbstractFileByPath).not.toHaveBeenCalled();
            expect(h.vault.cachedRead).not.toHaveBeenCalled();
            expect(h.controller.listPendingIntents()).toEqual([]);
        } finally {
            h.controller.dispose();
        }
    });

    it("rejects a model-supplied read guard in action arguments", async () => {
        const h = await harness();
        const stage = jest.spyOn(h.controller, "stageIntent");
        try {
            const result = await h.executor.prepareBatch!(batch([
                call("append", "vault_append", { path: "notes/b.md", content: "after",
                    taskSourceReadGuard: { isCurrent: true, isPathAllowed: true } }),
            ], h.guard));
            expect(result?.toolResults.get("append")?.outcome).toBe("schema_invalid");
            expect(stage).not.toHaveBeenCalled();
            expect(h.vault.getAbstractFileByPath).not.toHaveBeenCalled();
            expect(h.vault.cachedRead).not.toHaveBeenCalled();
        } finally {
            h.controller.dispose();
        }
    });
});
