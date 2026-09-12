import { describe, expect, it, jest } from "@jest/globals";
import { AIMessageChunk } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import type { App } from "obsidian";

import { AIUtils } from "../src/ai-services/ai-utils";
import { CapabilityRegistry } from "../src/ai-services/capability-registry";
import type { AgentEvent } from "../src/ai-services/chat-types";
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
    isOperationsStagedAcknowledgement,
    OPERATIONS_STAGED_ACKNOWLEDGEMENT_INSTRUCTION,
    PaAgentRuntime,
    preserveOperationsActionsInControlSnapshot,
} from "../src/ai-services/pa-agent-runtime";
import { OperationsIntentController } from "../src/ai-services/operations/operations-intent-controller";
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
    type OperationsVault,
    type OperationsVaultFile,
    type StageOperationsIntentInput,
} from "../src/ai-services/operations/types";
import { createAiServiceHost } from "../src/tests/factories/host-factory";

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

describe("Operations runtime task source declarations", () => {
    it("stages a declared create-then-append batch without reading old note text or performing writes", async () => {
        const prompt = "不要读取现有笔记。新建 notes/new.md，内容为 # Draft，然后追加 Final。";
        const fixture = operationsRuntimeFixture(prompt, [
            sourceDeclaration("不要读取现有笔记", "none"),
            toolCall("create", "vault_create", { path: "notes/new.md", content: "# Draft" }, 1),
            toolCall("append", "vault_append", { path: "notes/new.md", content: "Final" }, 2),
        ]);
        try {
            await fixture.run();

            expect(fixture.boundToolNames[0]).toEqual(expect.arrayContaining([
                "declare_source_scope", "vault_create", "vault_append",
            ]));
            expect(fixture.stageIntent).toHaveBeenCalledTimes(1);
            const [intent] = fixture.controller.listPendingIntents();
            expect(intent).toMatchObject({
                state: "pending",
                operations: [
                    { toolCallId: "create", expectedBefore: null, expectedAfter: "# Draft" },
                    { toolCallId: "append", expectedBefore: "# Draft", expectedAfter: "# Draft\nFinal" },
                ],
            });
            expect(intent).not.toHaveProperty("taskSourceReadGuard");
            expect(fixture.lifecycle).toEqual(expect.arrayContaining([
                expect.objectContaining({ type: "tool_execution_end", toolCallId: "scope", outcome: "control_applied" }),
                expect.objectContaining({ type: "tool_execution_end", toolCallId: "create", outcome: "success", metadata: expect.objectContaining({ contentMetadata: expect.objectContaining({ staged: true, wrote: false }) }) }),
                expect.objectContaining({ type: "tool_execution_end", toolCallId: "append", outcome: "success", metadata: expect.objectContaining({ contentMetadata: expect.objectContaining({ staged: true, wrote: false }) }) }),
                expect.objectContaining({ type: "agent_end", status: "completed" }),
            ]));
            expect(fixture.vault.adapter.exists).toHaveBeenCalledWith("notes/new.md");
            expectNoSourceReadsOrWrites(fixture);
        } finally {
            fixture.dispose();
        }
    });

    it("rejects the complete declared batch when append requires old text outside the current-note scope", async () => {
        const prompt = "只用当前笔记作为素材。新建 notes/new.md，并向 notes/other.md 追加结论。";
        const fixture = operationsRuntimeFixture(prompt, [
            sourceDeclaration("只用当前笔记作为素材", "current_note"),
            toolCall("create", "vault_create", { path: "notes/new.md", content: "Conclusion" }, 1),
            toolCall("append", "vault_append", { path: "notes/other.md", content: "Conclusion" }, 2),
        ]);
        try {
            await fixture.run();

            expect(fixture.stageIntent).not.toHaveBeenCalled();
            expect(fixture.controller.listPendingIntents()).toEqual([]);
            for (const toolCallId of ["scope", "create", "append"]) {
                expect(fixture.lifecycle).toContainEqual(expect.objectContaining({
                    type: "tool_execution_end", toolCallId, outcome: "policy_rejected",
                    metadata: expect.objectContaining({ contentMetadata: expect.objectContaining({ reason: "source_read_outside_scope" }) }),
                }));
            }
            expect(fixture.vault.adapter.exists).not.toHaveBeenCalled();
            expectNoSourceReadsOrWrites(fixture);
        } finally {
            fixture.dispose();
        }
    });

    it("publishes a returned context-used note handle and accepts a later selected-note narrowing", async () => {
        const prompt = "先使用整个知识库查阅 notes/other.md 的标题结构，然后只使用找到的这篇笔记，继续读取完整标题结构。";
        let discoveredHandle: string | undefined;
        const fixture = operationsRuntimeFixture(prompt, [
            sourceDeclaration("先使用整个知识库", "vault"),
            toolCall("outline-first", "read_note_outline", { path: "notes/other.md", max_headings: 1 }, 1),
        ], {
            outlineHeadings: [
                { level: 1, heading: "Returned outline fact" },
                { level: 2, heading: "Scoped follow-up fact" },
            ],
            nextToolCalls: (input, modelTurn) => {
                if (modelTurn !== 2) return undefined;
                discoveredHandle = readProviderNoteDirectory(input).notes
                    .find(note => note.path === "notes/other.md")?.handle;
                if (!discoveredHandle) return undefined;
                return [
                    {
                        type: "toolCall", id: "scope-selected", name: "declare_source_scope", index: 0,
                        input: {
                            instructionQuote: "然后只使用找到的这篇笔记", notes: "selected",
                            noteHandles: [discoveredHandle], webAllowed: false,
                        },
                    },
                    toolCall("outline-selected", "read_note_outline", { path: "notes/other.md", max_headings: 2 }, 1),
                ];
            },
            finalText: "这篇笔记包含 Returned outline fact 和 Scoped follow-up fact 两个标题。",
        });
        try {
            await fixture.run();

            expect(fixture.providerInputs).toHaveLength(3);
            const directories = fixture.providerInputs.map(readProviderNoteDirectory);
            expect(directories[0].notes.map(note => note.path)).toEqual(["notes/current.md"]);
            expect(discoveredHandle).toEqual(expect.any(String));
            expect(directories[1].notes).toContainEqual({ path: "notes/other.md", handle: discoveredHandle });
            expect(directories[2]).toEqual({
                currentNoteHandle: null, notes: [{ path: "notes/other.md", handle: discoveredHandle }],
            });

            const toolMessages = fixture.lifecycle.flatMap(event => (
                event.type === "message_end" && event.message.role === "toolResult" ? [event.message] : []
            ));
            const initialRead = toolMessages.find(message => message.toolCallId === "outline-first");
            const selectedRead = toolMessages.find(message => message.toolCallId === "outline-selected");
            expect(initialRead).toMatchObject({ isError: false, content: {
                includeInNextPrompt: true,
                sourceRecords: [{ kind: "context-used", path: "notes/other.md", citationEligible: false }],
            } });
            expect(initialRead?.content.promptText).toContain("Returned outline fact");
            expect(initialRead?.content.promptText).not.toContain("Scoped follow-up fact");
            expect(selectedRead).toMatchObject({ isError: false, content: {
                includeInNextPrompt: true,
                sourceRecords: [{ kind: "context-used", path: "notes/other.md", citationEligible: false }],
            } });
            expect(selectedRead?.content.promptText).toContain("Scoped follow-up fact");
            expect(toolMessages.find(message => message.toolCallId === "scope-selected")).toMatchObject({
                isError: false, content: { metadata: { outcome: "control_applied", scopeRevision: 2 } },
            });
            expect(fixture.getFileCache.mock.calls.map(([file]) => file.path)).toEqual([
                "notes/other.md", "notes/other.md",
            ]);
            expect(fixture.vault.getMarkdownFiles).not.toHaveBeenCalled();
            expect(fixture.vault.cachedRead).not.toHaveBeenCalled();
            expect(fixture.vault.read).not.toHaveBeenCalled();
            expect(fixture.stageIntent).not.toHaveBeenCalled();
            expect(fixture.executeIntent).not.toHaveBeenCalled();
            expect(fixture.vault.create).not.toHaveBeenCalled();
            expect(fixture.vault.process).not.toHaveBeenCalled();
            expect(fixture.trashFile).not.toHaveBeenCalled();
        } finally {
            fixture.dispose();
        }
    });
});

function sourceDeclaration(
    instructionQuote: string,
    notes: "current_note" | "none" | "vault",
): ParsedBufferedToolCall {
    return {
        type: "toolCall", id: "scope", name: "declare_source_scope", index: 0,
        input: { instructionQuote, notes, webAllowed: false },
    };
}

interface OperationsRuntimeFixtureOptions {
    outlineHeadings?: Array<{ level: number; heading: string }>;
    nextToolCalls?: (input: unknown, modelTurn: number) => readonly ParsedBufferedToolCall[] | undefined;
    finalText?: string;
}

function operationsRuntimeFixture(
    prompt: string,
    calls: readonly ParsedBufferedToolCall[],
    fixtureOptions: OperationsRuntimeFixtureOptions = {},
) {
    const currentFile = { path: "notes/current.md", extension: "md" };
    const otherFile = { path: "notes/other.md", extension: "md" };
    const fileObjects = new Map<string, OperationsVaultFile>([
        [currentFile.path, currentFile], [otherFile.path, otherFile],
        ["notes", { path: "notes", children: [] }],
    ]);
    const oldContents = new Map([
        [currentFile.path, "PRIVATE CURRENT NOTE BODY"],
        [otherFile.path, "PRIVATE OTHER NOTE BODY"],
    ]);
    const vault = {
        getAbstractFileByPath: jest.fn((path: string) => fileObjects.get(path) ?? null),
        getMarkdownFiles: jest.fn(() => [currentFile, otherFile]),
        cachedRead: jest.fn(async (file: OperationsVaultFile) => oldContents.get(file.path) ?? ""),
        read: jest.fn(async (file: OperationsVaultFile) => oldContents.get(file.path) ?? ""),
        create: jest.fn(async (path: string, _content: string) => ({ path })),
        process: jest.fn(async (_file: OperationsVaultFile, _change: (text: string) => string) => undefined),
        adapter: { exists: jest.fn(async (path: string) => fileObjects.has(path)) },
    } satisfies OperationsVault & { getMarkdownFiles(): OperationsVaultFile[] };
    const trashFile = jest.fn(async (_file: OperationsVaultFile) => undefined);
    const controller = new OperationsIntentController({ vault, trashFile });
    const stageIntent = jest.spyOn(controller, "stageIntent");
    const executeIntent = jest.spyOn(controller, "executeIntent");
    const getFileCache = jest.fn((_file: OperationsVaultFile) => fixtureOptions.outlineHeadings
        ? { headings: fixtureOptions.outlineHeadings }
        : null);
    const host = createAiServiceHost({
        settings: { memoryEnabled: false, operationsAgentEnabled: true },
        app: {
            vault,
            workspace: {
                getActiveViewOfType: () => ({ file: currentFile }),
                getMostRecentLeaf: () => null,
                getLeavesOfType: () => [],
            },
            metadataCache: { getFileCache },
        } as unknown as App,
        isDataBoundaryAllowedPath: () => true,
    });
    const aiUtils = new AIUtils(host);
    const boundToolNames: string[][] = [];
    const providerInputs: unknown[] = [];
    let modelTurn = 0;
    const createModel = jest.spyOn(aiUtils, "createChatModel").mockImplementation(async (_temperature, options) => {
        const model = RunnableLambda.from(async function* (input: unknown) {
            options?.onProviderRequestStart?.();
            providerInputs.push(input);
            modelTurn += 1;
            const turnCalls = modelTurn === 1 ? calls : fixtureOptions.nextToolCalls?.(input, modelTurn);
            if (turnCalls) {
                yield new AIMessageChunk({ content: "", tool_call_chunks: turnCalls.map(call => ({
                    id: call.id, name: call.name, index: call.index, args: JSON.stringify(call.input),
                })) });
                yield new AIMessageChunk({ content: "", response_metadata: { finish_reason: "tool_calls" } });
                return;
            }
            yield new AIMessageChunk({ content: fixtureOptions.finalText ?? (controller.listPendingIntents().length
                ? "请确认这份修改提案；尚未写入笔记。"
                : "当前取材范围不允许读取该笔记，未暂存或执行修改。") });
            yield new AIMessageChunk({ content: "", response_metadata: { finish_reason: "stop" } });
        });
        Object.assign(model, { bindTools: (schemas: Array<{ function: { name: string } }>) => {
            boundToolNames.push(schemas.map(schema => schema.function.name));
            return model;
        } });
        return model as unknown as Awaited<ReturnType<AIUtils["createChatModel"]>>;
    });
    const lifecycle: AgentEvent[] = [];
    const runtime = new PaAgentRuntime(host, aiUtils, {
        skillContextProvider: null, operationsIntentController: controller, maxModelTurns: 3,
    });
    return {
        vault, trashFile, controller, stageIntent, executeIntent, getFileCache,
        boundToolNames, providerInputs, lifecycle,
        run: () => runtime.streamTurn({
            prompt, memoryMode: "auto", onLifecycleEvent: event => lifecycle.push(event),
        }),
        dispose: () => {
            runtime.dispose();
            controller.dispose();
            createModel.mockRestore();
            stageIntent.mockRestore();
            executeIntent.mockRestore();
        },
    };
}

function readProviderNoteDirectory(input: unknown): {
    currentNoteHandle: string | null;
    notes: Array<{ path: string; handle: string }>;
} {
    const directory = String(input).split("\n").find(line => line.startsWith('{"currentNoteHandle":'));
    if (!directory) throw new Error("Provider input did not contain the host note directory.");
    return JSON.parse(directory);
}

function expectNoSourceReadsOrWrites(fixture: ReturnType<typeof operationsRuntimeFixture>): void {
    expect(fixture.vault.cachedRead).not.toHaveBeenCalled();
    expect(fixture.vault.read).not.toHaveBeenCalled();
    expect(fixture.getFileCache).not.toHaveBeenCalled();
    expect(fixture.executeIntent).not.toHaveBeenCalled();
    expect(fixture.vault.create).not.toHaveBeenCalled();
    expect(fixture.vault.process).not.toHaveBeenCalled();
    expect(fixture.trashFile).not.toHaveBeenCalled();
    expect(JSON.stringify(fixture.providerInputs)).not.toContain("PRIVATE CURRENT NOTE BODY");
    expect(JSON.stringify(fixture.providerInputs)).not.toContain("PRIVATE OTHER NOTE BODY");
}

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
    name: "vault_create" | "vault_append" | "frontmatter_update" | "read_note_outline",
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
