import { describe, expect, it, jest } from "@jest/globals";

import { CapabilityRegistry } from "../src/ai-services/capability-registry";
import { PolicyEngine } from "../src/ai-services/policy-engine";
import { PaAgentLoop } from "../src/ai-services/pa-agent-loop";
import { createAgentControlSnapshot } from "../src/ai-services/pa-agent-control-policy";
import type {
    PaAgentToolBatchPreparationInput,
    PaAgentToolExecutor,
    ParsedBufferedToolCall,
} from "../src/ai-services/pa-agent-types";
import {
    createOperationsAcknowledgementControlSnapshot,
    hasOperationsWriteIntent,
    isOperationsStagedAcknowledgement,
    OPERATIONS_STAGED_ACKNOWLEDGEMENT_INSTRUCTION,
    preserveOperationsActionsInControlSnapshot,
} from "../src/ai-services/pa-agent-runtime";
import {
    createOperationsStagingToolExecutor,
} from "../src/ai-services/operations/operations-tool-executor";
import {
    OPERATIONS_STAGED_MESSAGE,
    OperationsToolCapability,
    OperationsToolProvider,
} from "../src/ai-services/operations/operations-tool-provider";
import {
    MAX_FRONTMATTER_KEYS,
    MAX_FRONTMATTER_KEY_CHARS,
    MAX_OPERATION_SELECTOR_CHARS,
} from "../src/ai-services/operations/input-validation";
import {
    CORE_WRITE_TOOL_NAMES,
    type OperationsIntent,
    type StageOperationsIntentInput,
} from "../src/ai-services/operations/types";

jest.mock("obsidian");

describe("Operations Agent runtime discovery and staging", () => {
    it("loads exactly the four approved action capabilities behind persisted opt-in", async () => {
        const provider = new OperationsToolProvider();

        await expect(provider.load(providerContext(false))).resolves.toMatchObject({
            status: "unavailable",
            capabilities: [],
        });
        const loaded = await provider.load(providerContext(true));

        expect(loaded.status).toBe("available");
        expect(loaded.capabilities.map((capability) => capability.name)).toEqual(CORE_WRITE_TOOL_NAMES);
        expect(loaded.capabilities.every((capability) => (
            capability.kind === "action"
            && capability.permission === "local-filesystem-write"
            && capability.requiresConfirmation === true
        ))).toBe(true);
        expect(loaded.capabilities.map((capability) => capability.name)).not.toContain("append_to_current_note");
        expect(loaded.capabilities.map((capability) => capability.name)).not.toContain("replace_selection");
        await expect(loaded.capabilities[0].execute({}, {
            host: {} as never,
        })).rejects.toThrow("cannot execute directly");
    });

    it("keeps actions undiscoverable unless the current run explicitly includes them", async () => {
        const registry = await operationsRegistry();

        expect(registry.listDefinitions()).toEqual([]);
        expect(registry.exportProviderSchemas()).toEqual([]);
        expect(registry.listDefinitions({ includeActions: true }).map((definition) => definition.name))
            .toEqual(CORE_WRITE_TOOL_NAMES);
        expect(registry.exportProviderSchemas({ includeActions: true }).map((schema) => schema.function.name))
            .toEqual(CORE_WRITE_TOOL_NAMES);
    });

    it("publishes the same provider bounds enforced by runtime validation", () => {
        const frontmatter = new OperationsToolCapability("frontmatter_update").inputSchema;
        const setSchema = frontmatter.properties.set as unknown as {
            maxProperties: number;
            propertyNames: { maxLength: number };
        };
        const deleteSchema = frontmatter.properties.delete as unknown as {
            maxItems: number;
            items: { maxLength: number };
        };
        expect(setSchema.maxProperties).toBe(MAX_FRONTMATTER_KEYS);
        expect(setSchema.propertyNames.maxLength).toBe(MAX_FRONTMATTER_KEY_CHARS);
        expect(deleteSchema.maxItems).toBe(MAX_FRONTMATTER_KEYS);
        expect(deleteSchema.items.maxLength).toBe(MAX_FRONTMATTER_KEY_CHARS);

        const process = new OperationsToolCapability("vault_process").inputSchema;
        const params = process.properties.params as unknown as {
            oneOf: Array<{ properties?: { anchor?: { oneOf?: Array<{ properties?: { heading?: { maxLength?: number } } }> } }; oneOf?: Array<{ properties?: { section?: { maxLength?: number } } }> }>;
        };
        expect(params.oneOf[1].properties?.anchor?.oneOf?.[0].properties?.heading?.maxLength)
            .toBe(MAX_OPERATION_SELECTOR_CHARS);
        expect(params.oneOf[2].oneOf?.[0].properties?.section?.maxLength)
            .toBe(MAX_OPERATION_SELECTOR_CHARS);
    });

    it("detects only latest-message write intent, including the Save suggestion request", () => {
        for (const input of [
            "把你上一条回答中的结论保存到我的知识库。",
            "保存",
            "Save it",
            "请把这个方案追加到 notes/plan.md",
            "请追加‘X’到 operations-agent-step2-dogfood-secondary.md 末尾。",
            "请向 operations-agent-step2-dogfood-secondary.md 末尾追加‘X’。",
            "Save the conclusion from your previous answer to my vault.",
            "Use the current note only and save this conclusion to this note.",
            "Update the status property in project.md",
            "保存到 projects/plan.md",
            "Append this to projects/plan.md",
            "Update projects/plan.md",
            "In projects/plan.md, append the result.",
            "Write this conclusion to the current note.",
            "Show me what you'll save, then save it to the current note.",
            "Don't summarize it; just save it to the current note.",
            "Don't create a new note; append this to projects/plan.md instead.",
            "Append this to projects/plan.md, but don't create a new note.",
            "Only append this to the current note.",
            "Don't create a new note, only append this to the current note.",
            "Save this to the current note without changing anything else.",
            "Insert this text into the current note.",
            "Replace ORIGINAL_MARKER with UPDATED_MARKER in the current note.",
            "Delete the Archive section from the current note.",
            "In the current note, replace A with B.",
            "In project.md after Summary, insert this text.",
            "Create a note for this decision.",
            "Edit the current note.",
            "把结论记录到项目笔记",
            "把结论加到 projects/plan.md",
            "把当前笔记中的 ORIGINAL_MARKER 替换为 UPDATED_MARKER",
            "删除当前笔记中的 Archive 章节",
            "在当前笔记中把 A 替换为 B",
            "在当前笔记的 Summary 后插入这段文字",
            "在 project.md 的 Summary 标题后插入这段文字",
            "只追加到当前笔记",
            "不要新建笔记，只追加到当前笔记",
        ]) {
            expect({ input, detected: hasOperationsWriteIntent(input) }).toEqual({ input, detected: true });
        }
        for (const input of [
            "总结一下这个方案",
            "How should I organize my vault?",
            "不要保存，只在这里回答",
            "Explain how note saving works",
            "Explain how to save a note.",
            "Explain how to create a note.",
            "Explain how to edit project.md safely.",
            "Explain how to replace text in a note.",
            "Explain how to create a note, then save time by using a template.",
            "Can you explain why I should not delete the status property in project.md?",
            "What is the best way to create a note?",
            "How do I create a note, then save it to my vault?",
            "Show me how to create a note, then save it to my vault.",
            "Tell me how to edit a note, then append the result to project.md.",
            "No need to create a note.",
            "Do not, under any circumstances, save this to the current note.",
            "In project.md, explain how to update the status property.",
            "Translate \"Save this to the current note\" into Chinese.",
            "Write an explanation of how Markdown notes work.",
            "Edit this sentence so it mentions a note.",
            "Describe how frontmatter properties work.",
            "How do I create a note?",
            "如何创建一篇笔记？",
            "不要记录到项目笔记",
            "不要新建笔记。",
            "不要在任何情况下，创建一篇笔记。",
            "告诉我怎么创建笔记，然后保存到知识库。",
            "翻译“保存到当前笔记”这句话。",
            "请把“向 operations-agent-step2-dogfood-secondary.md 末尾追加‘X’”翻译成英文。",
            "Don't add this to projects/plan.md",
            "Don't delete the Archive section from the current note.",
        ]) {
            expect({ input, detected: hasOperationsWriteIntent(input) }).toEqual({ input, detected: false });
        }
    });

    it("stages all action calls in a model phase as one intent and never direct-executes them", async () => {
        const registry = await operationsRegistry();
        const stageIntent = jest.fn(async (
            input: StageOperationsIntentInput,
            _signal?: AbortSignal,
        ) => fakeIntent(input));
        const baseExecute = jest.fn(async () => ({
            outcome: "success" as const,
            promptText: "base",
        }));
        const executor = createOperationsStagingToolExecutor({
            baseExecutor: { execute: baseExecute },
            registry,
            controller: { stageIntent },
        });
        const batch = batchInput([
            toolCall("call-1", "vault_create", { path: "0.unsorted/result.md", content: "# Result" }, 0),
            toolCall("call-2", "frontmatter_update", { path: "projects/a.md", set: { status: "done" } }, 1),
        ]);

        const prepared = await executor.prepareBatch?.(batch);

        expect(stageIntent).toHaveBeenCalledTimes(1);
        expect(stageIntent).toHaveBeenCalledWith(
            expect.objectContaining({
                runId: "run-1",
                turnId: "turn-1",
                operations: [
                    expect.objectContaining({ toolCallId: "call-1", name: "vault_create" }),
                    expect.objectContaining({ toolCallId: "call-2", name: "frontmatter_update" }),
                ],
            }),
            batch.signal,
        );
        expect(prepared?.toolResults.get("call-1")?.promptText).toBe(OPERATIONS_STAGED_MESSAGE);
        expect(OPERATIONS_STAGED_MESSAGE).toContain("latest user request");
        expect(OPERATIONS_STAGED_MESSAGE).toContain("no write has occurred");
        expect(OPERATIONS_STAGED_MESSAGE).toContain("does not report the state of any earlier proposal");
        expect(prepared?.toolResults.get("call-2")?.metadata).toMatchObject({
            intentId: "intent-1",
            operationCount: 2,
            staged: true,
            wrote: false,
        });
        expect(baseExecute).not.toHaveBeenCalled();

        const direct = await executor.execute({
            runId: "run-1",
            turnId: "turn-1",
            turnIndex: 0,
            userInput: "save",
            toolCall: batch.toolCalls[0],
            signal: batch.signal,
        });
        expect(direct).toMatchObject({
            outcome: "policy_rejected",
            metadata: { reason: "operations_batch_required", wrote: false },
        });
        expect(baseExecute).not.toHaveBeenCalled();
    });

    it("invokes prepareBatch once before individual dispatch and consumes staged results", async () => {
        const execute = jest.fn<PaAgentToolExecutor["execute"]>(async () => {
            throw new Error("prepared action must not execute individually");
        });
        const prepareBatch = jest.fn<NonNullable<PaAgentToolExecutor["prepareBatch"]>>(async (input) => ({
            toolResults: new Map(input.toolCalls.map((call) => [call.id, {
                outcome: "success" as const,
                promptText: OPERATIONS_STAGED_MESSAGE,
                metadata: { staged: true, wrote: false },
            }])),
        }));
        const loop = new PaAgentLoop({
            runId: "run-1",
            userInput: "save these changes",
            model: {
                stream: async function* () {
                    yield { type: "toolcall_delta", id: "call-1", name: "vault_create", input: { path: "0.unsorted/a.md", content: "A" }, index: 0 } as const;
                    yield { type: "toolcall_delta", id: "call-2", name: "vault_append", input: { path: "b.md", content: "B" }, index: 1 } as const;
                },
            },
            toolExecutor: { execute, prepareBatch, getExecutionMode: () => "sequential" },
            toolExecutionMode: "hybrid",
            hostPolicy: { afterTurn: () => ({ action: "stop", status: "completed", reason: "test" }) },
            now: () => 100,
        });

        const result = await loop.run();

        expect(prepareBatch).toHaveBeenCalledTimes(1);
        expect(prepareBatch.mock.calls[0][0].toolCalls.map((call) => call.id)).toEqual(["call-1", "call-2"]);
        expect(execute).not.toHaveBeenCalled();
        expect(result.turns[0].toolResults.map((message) => message.content.metadata?.staged))
            .toEqual([true, true]);
    });

    it("keeps only the four Operations actions when a non-final control snapshot narrows tools", () => {
        const narrowed = createAgentControlSnapshot({
            exposureMode: "follow-up",
            sourceScope: "notes",
            allowedToolNames: new Set(["search_vault_snippets"]),
        });

        const preserved = preserveOperationsActionsInControlSnapshot(narrowed, true);

        expect([...preserved.allowedToolNames!].sort()).toEqual([
            ...CORE_WRITE_TOOL_NAMES,
            "search_vault_snippets",
        ].sort());
        expect(preserved.allowedToolNames).not.toContain("list_recent_notes");

        const finalOnly = createAgentControlSnapshot({
            toolMode: "final_answer_only",
            allowedToolNames: new Set(["search_vault_snippets"]),
        });
        expect(preserveOperationsActionsInControlSnapshot(finalOnly, true)).toBe(finalOnly);
    });

    it("uses a tool-free normal acknowledgement after staging and omits stale chat history", () => {
        const previous = createAgentControlSnapshot({
            exposureMode: "answer-ready",
            sourceScope: "notes",
            allowedToolNames: new Set([...CORE_WRITE_TOOL_NAMES, "search_vault_snippets"]),
        });

        const acknowledgement = createOperationsAcknowledgementControlSnapshot(previous);

        expect(acknowledgement.toolMode).toBe("normal");
        expect(acknowledgement.exposureMode).toBe("answer-ready");
        expect(acknowledgement.sourceScope).toBe("notes");
        expect([...acknowledgement.allowedToolNames!]).toEqual([]);
        expect(acknowledgement.runtimeInstruction).toBe(OPERATIONS_STAGED_ACKNOWLEDGEMENT_INSTRUCTION);
        expect(acknowledgement.runtimeInstruction).not.toContain("finalization turn");
        expect(acknowledgement.runtimeInstruction).toContain("earlier proposal");
        expect(isOperationsStagedAcknowledgement(acknowledgement.runtimeInstruction)).toBe(true);
        expect(isOperationsStagedAcknowledgement("ordinary continuation")).toBe(false);
    });

    it("aborts batch staging at the tool timeout before an intent can be stored", async () => {
        const registry = await operationsRegistry();
        let stagingSignal: AbortSignal | undefined;
        const stageIntent = jest.fn((_input: StageOperationsIntentInput, signal?: AbortSignal) => {
            stagingSignal = signal;
            return new Promise<OperationsIntent>((_resolve, reject) => {
                signal?.addEventListener("abort", () => {
                    const error = new Error("staging aborted");
                    error.name = "AbortError";
                    reject(error);
                }, { once: true });
            });
        });
        const baseExecute = jest.fn(async () => ({
            outcome: "success" as const,
            promptText: "base",
        }));
        const executor = createOperationsStagingToolExecutor({
            baseExecutor: { execute: baseExecute },
            registry,
            controller: { stageIntent },
        });
        const loop = new PaAgentLoop({
            runId: "run-timeout",
            userInput: "save this conclusion",
            model: {
                stream: async function* () {
                    yield {
                        type: "toolcall_delta",
                        id: "call-timeout",
                        name: "vault_create",
                        input: { path: "0.unsorted/timeout.md", content: "pending" },
                        index: 0,
                    } as const;
                },
            },
            toolExecutor: executor,
            toolExecutionMode: "hybrid",
            toolTimeoutMs: 5,
            hostPolicy: { afterTurn: () => ({ action: "stop", status: "completed", reason: "test" }) },
        });

        const result = await loop.run();

        expect(stageIntent).toHaveBeenCalledTimes(1);
        expect(stagingSignal?.aborted).toBe(true);
        expect(baseExecute).not.toHaveBeenCalled();
        expect(result.turns[0].diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: "tool_batch_prepare_timeout", timeoutMs: 5 }),
        ]));
        expect(result.turns[0].toolResults[0].content.metadata).toMatchObject({
            reason: "operations_batch_required",
            wrote: false,
        });
    });

    it("propagates user abort into batch staging and stops before individual dispatch", async () => {
        const registry = await operationsRegistry();
        const abortController = new AbortController();
        let stagingSignal: AbortSignal | undefined;
        let markStagingStarted: (() => void) | undefined;
        const stagingStarted = new Promise<void>((resolve) => {
            markStagingStarted = resolve;
        });
        const stageIntent = jest.fn((_input: StageOperationsIntentInput, signal?: AbortSignal) => {
            stagingSignal = signal;
            markStagingStarted?.();
            return new Promise<OperationsIntent>((_resolve, reject) => {
                signal?.addEventListener("abort", () => {
                    const error = new Error("staging aborted");
                    error.name = "AbortError";
                    reject(error);
                }, { once: true });
            });
        });
        const baseExecute = jest.fn(async () => ({
            outcome: "success" as const,
            promptText: "base",
        }));
        const loop = new PaAgentLoop({
            runId: "run-abort",
            userInput: "save this conclusion",
            model: {
                stream: async function* () {
                    yield {
                        type: "toolcall_delta",
                        id: "call-abort",
                        name: "vault_create",
                        input: { path: "0.unsorted/abort.md", content: "pending" },
                        index: 0,
                    } as const;
                },
            },
            toolExecutor: createOperationsStagingToolExecutor({
                baseExecutor: { execute: baseExecute },
                registry,
                controller: { stageIntent },
            }),
            toolExecutionMode: "hybrid",
            toolTimeoutMs: 1_000,
            signal: abortController.signal,
        });

        const running = loop.run();
        await stagingStarted;
        abortController.abort();
        const result = await running;

        expect(result.status).toBe("aborted");
        expect(stagingSignal?.aborted).toBe(true);
        expect(baseExecute).not.toHaveBeenCalled();
        expect(result.turns[0].diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: "tool_batch_prepare_aborted" }),
        ]));
    });
});

function providerContext(enabled: boolean) {
    return {
        turnId: "turn-1",
        platform: "desktop" as const,
        settings: { operationsAgentEnabled: enabled },
    };
}

async function operationsRegistry(): Promise<CapabilityRegistry> {
    const registry = new CapabilityRegistry({
        policyEngine: new PolicyEngine({
            platform: "desktop",
            runKind: "chat-with-actions",
            allowWrite: true,
            allowedActionPermissions: ["local-filesystem-write"],
        }),
    });
    const loaded = await new OperationsToolProvider().load(providerContext(true));
    registry.registerMany(loaded.capabilities);
    return registry;
}

function toolCall(
    id: string,
    name: "vault_create" | "vault_append" | "frontmatter_update",
    input: unknown,
    index: number,
): ParsedBufferedToolCall {
    return { type: "toolCall", id, name, input, index };
}

function batchInput(toolCalls: ParsedBufferedToolCall[]): PaAgentToolBatchPreparationInput {
    return {
        runId: "run-1",
        turnId: "turn-1",
        turnIndex: 0,
        userInput: "save this conclusion",
        toolCalls,
        signal: new AbortController().signal,
    };
}

function fakeIntent(input: StageOperationsIntentInput): OperationsIntent {
    return {
        id: "intent-1",
        runId: input.runId,
        turnId: input.turnId,
        createdAt: 1,
        expiresAt: 2,
        state: "pending",
        operations: input.operations.map((operation, index) => ({
            id: `op-${index + 1}`,
            toolCallId: operation.toolCallId,
            name: operation.name,
            input: operation.input as never,
            path: (operation.input as { path: string }).path,
            expectedBefore: null,
            expectedAfter: "",
        })),
    };
}
