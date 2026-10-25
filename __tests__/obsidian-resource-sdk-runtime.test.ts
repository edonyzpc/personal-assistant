import { readFile } from "node:fs/promises";
import { AIMessageChunk } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";

import { CapabilityRegistry } from "../src/ai-services/capability-registry";
import { createChatToolCapability } from "../src/ai-services/capability-adapter";
import { PolicyEngine } from "../src/ai-services/policy-engine";
import { createPaAgentCapabilityToolExecutor } from "../src/ai-services/pa-agent-host-tools";
import type {
    PaAgentToolExecutor,
    PaAgentToolExecutionResult,
    ParsedBufferedToolCall,
} from "../src/ai-services/pa-agent-types";
import { createTaskSourceConstrainedExecutor } from "../src/ai-services/task-source-executor";
import { TaskSourceRun } from "../src/ai-services/task-source-run";
import { TaskSourceResourceIdentities } from "../src/ai-services/task-source-resource-identities";
import { completeInputLineage, type InputLineage } from "../src/ai-services/input-lineage";
import { createOperationsStagingToolExecutor } from "../src/ai-services/operations/operations-tool-executor";
import { OperationsService } from "../src/ai-services/operations/operations-service";
import { createCreateImageTool } from "../src/ai-services/chat-tool-factories";
import { PaAgentRuntime } from "../src/ai-services/pa-agent-runtime";
import type { AiServiceHost } from "../src/ai-services/AiServiceHost";
import { createExecuteObsidianCodeRuntime } from "../src/ai-services/independent-computation/obsidian-code-runtime";
import { HostCallScheduler, OBSIDIAN_CODE_CALL_RESOURCE_LIMITS } from "../src/ai-services/independent-computation/obsidian-code-runtime";
import { runIndependentCode } from "../src/ai-services/independent-computation/browser-launcher";
import { projectPaAgentActionHistory } from "../src/ai-services/pa-agent-action-history";
import { collectPaAgentActionOwnerFacts } from "../src/ai-services/pa-agent-result-facts";
import {
    createExecuteObsidianCodeTool,
    EXECUTE_OBSIDIAN_CODE_TOOL_NAME,
} from "../src/ai-services/independent-computation/obsidian-code-capability";
import type { ObsidianSdkHost } from "../src/ai-services/independent-computation/obsidian-resource-sdk";
import { createObsidianSdkReadCapabilities } from "../src/ai-services/independent-computation/obsidian-sdk-tool-definitions";
import { inlineLauncher } from "../src/third_party/pi-codemode/runtime/inline";
import { MemoryChatHistoryStore } from "../src/chat/chat-history-store";
import { ChatService } from "../src/ai-services/chat-service";
import { createPaAgentPersistedTurn } from "../src/ai-services/pa-agent-history";
import type { AgentEvent, ChatMessage, PaAgentMessage } from "../src/ai-services/chat-types";
import { ImageGenerationService } from "../src/chat/image-generation-service";
import type { ImageAssetService } from "../src/chat/image-assets";
import type { WanImageProvider } from "../src/ai-services/wan-image-provider";

jest.mock("obsidian");

const quickJsWasm = (async () => WebAssembly.compile(
    await readFile("node_modules/quickjs-wasi/quickjs.wasm"),
))();

interface FileLike {
    path: string;
    extension?: string;
    children?: unknown[];
    content?: string;
}

class MockWorker {
    static instances: MockWorker[] = [];
    static responder: ((worker: MockWorker, message: unknown) => void) | undefined;
    readonly listeners = new Map<string, Array<(event: unknown) => void>>();
    terminated = false;

    constructor(
        readonly url: string,
        readonly options: WorkerOptions | undefined,
    ) {
        MockWorker.instances.push(this);
    }

    addEventListener(type: string, listener: (event: unknown) => void): void {
        this.listeners.set(type, [...this.listeners.get(type) ?? [], listener]);
    }

    removeEventListener(type: string, listener: (event: unknown) => void): void {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter(existing => existing !== listener));
    }

    postMessage(message: unknown): void {
        if (!this.terminated && MockWorker.responder) {
            queueMicrotask(() => MockWorker.responder?.(this, message));
        }
    }

    terminate(): void {
        this.terminated = true;
    }

    dispatch(type: string, event: unknown): void {
        for (const listener of [...this.listeners.get(type) ?? []]) listener(event);
    }
}

function makeSourceRun(files: Map<string, FileLike>, allowed = true, isCurrent = () => true) {
    const resourceIdentities = new TaskSourceResourceIdentities({
        runId: "run",
        getAbstractFileByPath: path => files.get(path),
    });
    return new TaskSourceRun({
        runId: "run",
        userMessageId: "user",
        userText: "organize synthetic notes",
        requestText: "organize synthetic notes",
        workspace: {
            getActiveViewOfType: () => null,
            getMostRecentLeaf: () => null,
            getLeavesOfType: () => [],
        } as never,
        getFileByPath: path => files.get(path),
        isCurrent,
        areSourcesCurrent: () => true,
        isPathAllowed: path => allowed || path !== "notes/excluded.md",
        resourceIdentities,
    });
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
    const deadline = Date.now() + 2_000;
    while (!condition() && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 1));
    }
    if (!condition()) throw new Error(message);
}

function wrapSourceExecutor(
    sourceRun: TaskSourceRun,
    baseExecutor: PaAgentToolExecutor,
    independentNames: ReadonlySet<string> = new Set(["create_image"]),
    sdkHost?: ObsidianSdkHost,
) {
    return createTaskSourceConstrainedExecutor({
        baseExecutor,
        state: sourceRun.state,
        resolveHostNoteId: sourceRun.resolveNoteId,
        isHostCurrent: sourceRun.isCurrent,
        isWebAllowed: sourceRun.isWebReadAllowed,
        isMemoryAllowed: sourceRun.isMemoryReadAllowed,
        prepareInputSourceAdmission: async (_calls, _signal, inputLineage) => {
            if (!inputLineage) return {
                isCurrent: sourceRun.isCurrent,
                sourceValidity: sourceRun.isCurrent,
                authorityValidity: sourceRun.isCurrent,
            };
            return await sourceRun.prepareLineageAdmission(inputLineage);
        },
        resolveReadPlans: calls => {
            const independent = calls.filter(call => independentNames.has(call.name));
            const independentIds = new Set(independent.map(call => call.id));
            const result = sourceRun.resolveReadPlansWithReason(
                calls.filter(call => !independentIds.has(call.id)),
                sdkHost,
            );
            if (!result.ok) return {
                rejectionReason: result.reason === 'source_excluded' ? 'source_excluded' as const : 'source_read_plan_unavailable' as const,
            };
            const plans = new Map(result.plans);
            for (const call of independent) plans.set(call.id, { reads: [] });
            return plans;
        },
    });
}

async function runObsidian(options: {
    registry: CapabilityRegistry;
    sourceRun: TaskSourceRun;
    executor: PaAgentToolExecutor;
    code: string;
    mode?: "apply" | "preview";
    parentToolCallId?: string;
    scheduler?: HostCallScheduler;
}) {
    const parentLineage = completeInputLineage([{ kind: "user-text", messageId: "user" }]);
    const runtime = createExecuteObsidianCodeRuntime({
        runId: "run",
        turnId: "turn",
        turnIndex: 0,
        userInput: "organize synthetic notes",
        parentToolCallId: options.parentToolCallId ?? "parent",
        parentAssistantId: "assistant",
        parentInputLineage: parentLineage,
        registry: options.registry,
        ...(options.scheduler ? { scheduler: options.scheduler } : {}),
        getExecutor: () => options.executor,
        launcher: inlineLauncher(await quickJsWasm, 1_000_000),
    });
    return await runtime.execute({
        code: options.code,
        mode: options.mode ?? "apply",
    }, {
        host: { log: () => undefined } as never,
        outerToolDeadlineAt: Date.now() + 10_000,
    });
}

function sdkReadFixture() {
    let current = true;
    const content = "PRIVATE_SAVED_TEXT";
    const file = { path: "notes/data.txt", content, stat: { mtime: 1, size: content.length } };
    const files = new Map<string, FileLike>([[file.path, file]]);
    const sourceRun = makeSourceRun(files, true, () => current);
    const readBinary = jest.fn(async () => new TextEncoder().encode(content).buffer);
    const host = { log: () => undefined, app: {
        vault: { getAbstractFileByPath: (path: string) => files.get(path) ?? null, readBinary },
        workspace: {}, metadataCache: {},
    } } as unknown as AiServiceHost;
    const sdkHost = { host, sourceRun };
    const registry = new CapabilityRegistry();
    registry.registerMany(createObsidianSdkReadCapabilities());
    const observations: Array<{ name: string; ok: boolean; content: unknown }> = [];
    const executor = wrapSourceExecutor(sourceRun, createPaAgentCapabilityToolExecutor({
        registry, host, obsidianSdkHost: sdkHost, platform: "desktop",
        onToolResult: result => observations.push({ name: result.toolName, ok: result.result.ok, content: result.result.content }),
    }), new Set(), sdkHost);
    return { registry, sourceRun, executor, readBinary, observations, withdraw: () => { current = false; } };
}

function readNoteCapability() {
    return createChatToolCapability({
        name: "read_note",
        description: "Read one synthetic note",
        inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
            additionalProperties: false,
        },
        plannerGuidance: [],
        permission: "read-only",
        cost: "free",
        outputBudgetChars: 100_000,
        requiresConfirmation: false,
        failureBehavior: "recoverable",
        statusMessageText: "Reading note",
        sourceBoundary: "vault",
        statusMessage: () => "Reading note",
        validateInput: raw => {
            const path = (raw as { path?: unknown })?.path;
            if (typeof path !== "string") throw new Error("path is required");
            return { path };
        },
        execute: async input => ({
            ok: true,
            tool: "read_note",
            inputSummary: input.path,
            content: { text: `TEXT:${input.path}` },
            sources: [{ path: input.path }],
        }),
    }, { providerId: "test-read" });
}

function syntheticBaseExecutor(
    calls: Array<{ path: string; guard: boolean }>,
    oversizedOutput = false,
): PaAgentToolExecutor {
    return {
        execute: async input => {
            const path = (input.toolCall.input as { path: string }).path;
            calls.push({ path, guard: Boolean(input.taskSourceReadGuard?.isPathAllowed(path)) });
            return {
                outcome: "success",
                promptText: JSON.stringify({
                    observation: { text: oversizedOutput ? "y".repeat(1_000_001) : `TEXT:${path}` },
                }),
                sourceRecords: [{
                    kind: "context-used",
                    dedupKey: `read:${path}`,
                    sourceBoundary: "vault",
                    path,
                    citationEligible: true,
                }],
            } satisfies PaAgentToolExecutionResult;
        },
    };
}

describe("Obsidian Resource SDK runtime", () => {
    it.each(["before-submit", "before-delivery"] as const)("carries dynamic source revocation into the persistent image owner %s", async phase => {
        const files = new Map<string, FileLike>([["notes/a.md", { path: "notes/a.md" }]]);
        const sourceRun = makeSourceRun(files);
        const store = new MemoryChatHistoryStore();
        await store.upsertConversation({ id: "conversation_one", title: "Synthetic image", createdAt: "2026-10-13T00:00:00.000Z",
            updatedAt: "2026-10-13T00:00:00.000Z", turnCount: 0, preview: "" });
        let releaseToken!: () => void;
        const tokenGate = new Promise<void>(resolve => { releaseToken = resolve; });
        let finishQuery!: (value: { taskId: string; status: "SUCCEEDED"; imageUrls: string[] }) => void;
        const queryGate = new Promise<{ taskId: string; status: "SUCCEEDED"; imageUrls: string[] }>(resolve => { finishQuery = resolve; });
        const provider = { submit: jest.fn(async () => ({ taskId: "wan-pending", status: "PENDING", imageUrls: [] })),
            query: jest.fn(() => queryGate), cancel: jest.fn(async () => ({ cancellationAccepted: false })) };
        const download = jest.fn(async () => new ArrayBuffer(0));
        const importFile = jest.fn(async () => ({ ref: { assetId: "unexpected", contentHash: "a".repeat(64) } }));
        const baseURL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
        const service = new ImageGenerationService({ store, assets: { importFile } as unknown as ImageAssetService,
            resolveConnection: () => ({ mode: "dedicated-wan", baseURL, synchronousEndpoint: "unused", asynchronousEndpoint: "unused",
                tasksEndpoint: "unused", credentialSlot: "image-token", revision: 1 }),
            getToken: async () => { if (phase === "before-submit") await tokenGate; return "synthetic-token"; },
            providerFactory: () => provider as unknown as WanImageProvider, download,
        });
        const registry = new CapabilityRegistry();
        registry.register(readNoteCapability());
        registry.register(createChatToolCapability(createCreateImageTool({ conversationId: "conversation_one", stableMessageId: "message_one",
            operationId: "operation_one", submit: async (input, _isSourceCurrent, requestLineage) => {
                expect(requestLineage?.dependencies).toContainEqual({ kind: "vault", path: "notes/a.md", via: "note" });
                return await service.submit({ conversationId: "conversation_one", stableMessageId: "message_one", operationId: "operation_one",
                    userPrompt: input.prompt, submittedPrompt: input.prompt, operation: "generate", count: 1, inputRefs: [],
                    isSourceCurrent: sourceRun.captureImageTaskSourceValidity(requestLineage) });
            },
        }), { providerId: "test-image" }));
        const executor = wrapSourceExecutor(sourceRun, createPaAgentCapabilityToolExecutor({ registry,
            host: { log: () => undefined } as never, platform: "desktop" }));
        try {
            const result = await runObsidian({ registry, sourceRun, executor, code: `
                const read = await tools.read_note({path:"notes/a.md"});
                return await tools.create_image({prompt:read.observation.text,operation:"generate"});
            ` });
            const taskId = result.actionStates![0].operationId;
            expect((await service.get(taskId))?.requiresSourceReceipt).toBe(true);
            if (phase === "before-delivery") await waitFor(() => provider.query.mock.calls.length > 0, "image query did not begin");
            files.set("notes/a.md", { path: "notes/a.md" });
            releaseToken();
            finishQuery({ taskId: "wan-pending", status: "SUCCEEDED", imageUrls: ["https://oss-cn-beijing.aliyuncs.com/result.png"] });
            for (let index = 0; index < 30; index++) {
                if (["not_submitted", "stopped"].includes((await service.get(taskId))?.state ?? "")) break;
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            expect((await service.get(taskId))?.state).toBe(phase === "before-submit" ? "not_submitted" : "stopped");
            if (phase === "before-submit") expect(provider.submit).not.toHaveBeenCalled();
            expect(download).not.toHaveBeenCalled();
            expect(importFile).not.toHaveBeenCalled();
            expect(result.actionStates![0].operationId).toBe(taskId);
        } finally { releaseToken(); service.dispose(); }
    });

    it.each(["unchanged", "excluded", "replacement", "closed-owner", "mixed-move"] as const)("preserves original SDK effect facts across two new runtimes without restoring old resource authority: %s", async scenario => {
        const path = "notes/a.md";
        let denied = false;
        let body = "PRIVATE_OLD_BODY";
        let file = { path, extension: "md", stat: { mtime: 1, size: body.length } };
        const readBinary = jest.fn(async () => new TextEncoder().encode(body).buffer);
        const process = jest.fn(async (_file: unknown, change: (text: string) => string) => {
            body = change(body); file.stat.size = body.length; file.stat.mtime++; return body;
        });
        const folder = { path: "notes", children: [] };
        const vault = { getAbstractFileByPath: (target: string) => target === file.path ? file : target === folder.path ? folder : null,
            getMarkdownFiles: () => [file], cachedRead: async () => body, read: async () => body, readBinary, process,
            adapter: { exists: async (target: string) => target === file.path || target === folder.path }, create: async () => { throw new Error("unexpected create"); } };
        const rename = jest.fn(async (_file: unknown, to: string) => { file.path = to; });
        const service = new OperationsService({ vault: vault as never, trashFile: async () => undefined,
            renameFile: rename, isOperationsAgentEnabled: () => true, isPathAllowed: () => !denied });
        const session = service.createSession({ surface: "test" });
        const host = { settings: { debug: false, aiProvider: "qwen", baseURL: "https://example.invalid", chatModelName: "test-model",
            policyModelName: "", embeddingModelName: "", shareAnonymousCapabilityUsage: false, qwenThinkingEnabled: false,
            webSearchEnabled: true, memoryEnabled: false, licenseTier: "paid" },
            app: { vault, workspace: { getActiveViewOfType: () => null, getMostRecentLeaf: () => null, getLeavesOfType: () => [] },
                metadataCache: { getFileCache: () => null, getCache: () => null } },
            memorySearch: { ensureReadyForChat: async () => ({ decision: "answer-now" }), searchHybrid: async () => [] },
            isDataBoundaryAllowedPath: () => !denied, getMemoryEvidenceEpoch: () => "synthetic",
            getTaskSourceAuthorityEpoch: () => "authority", getTaskSourceConfigurationEpoch: () => "configuration",
            getAPIToken: async () => "synthetic-token", log: () => undefined, isOperationsAgentEnabled: true,
            getMemoryExtractionPromptContext: () => undefined,
        } as unknown as AiServiceHost;
        const chat = new ChatService(host, session);
        const providerInputs: unknown[] = [];
        const model = (execute: boolean) => {
            let turns = 0;
            const bound = RunnableLambda.from(async function* (input: unknown) {
                providerInputs.push(input);
                if (execute && ++turns === 1) yield new AIMessageChunk({ content: "", tool_call_chunks: [{ id: "sdk-parent", index: 0,
                    name: EXECUTE_OBSIDIAN_CODE_TOOL_NAME, args: JSON.stringify({ code: "return 1", mode: "apply" }) }] });
                else yield new AIMessageChunk({ content: "Stopped effects remain recorded." });
                yield new AIMessageChunk({ content: "", response_metadata: { finish_reason: execute && turns === 1 ? "tool_calls" : "stop" } });
            });
            return { bindTools: () => bound };
        };
        const makeRuntime = (execute: boolean) => {
            const runtimeModel = model(execute);
            return new PaAgentRuntime(host, { createChatModel: async () => runtimeModel } as never, {
                skillContextProvider: null, operationsIntentController: session, operationsToolProvider: service.provider,
                operationsIntentExecutor: input => chat.executeOperationsIntentFromAgent(input),
            });
        };
        const first = makeRuntime(true), second = makeRuntime(false);
        const originalWorker = globalThis.Worker;
        globalThis.Worker = MockWorker as unknown as typeof Worker;
        MockWorker.instances = [];
        let originalRef: string | undefined;
        MockWorker.responder = (worker, message) => {
            const packet = message as { type?: string; id?: number; payload?: string };
            if (packet.type === "start") worker.dispatch("message", { data: { type: "call", id: 1, target: "global",
                name: "obsidian.vault.readText", args: JSON.stringify({ target: { path } }) } });
            else if (packet.type === "result" && packet.id === 1) {
                const read = JSON.parse(String(packet.payload));
                originalRef = read.value.resourceRef;
                worker.dispatch("message", { data: scenario === "mixed-move"
                    ? { type: "call", id: 2, target: "tool", name: "read_note", args: JSON.stringify({ path }) }
                    : { type: "call", id: 2, target: "global", name: "obsidian.vault.replaceText",
                        args: JSON.stringify({ target: { resourceRef: originalRef }, expectedVersion: read.value.sourceVersion, text: "Green" }) } });
            } else if (packet.type === "result" && packet.id === 2 && scenario === "mixed-move") {
                worker.dispatch("message", { data: { type: "call", id: 3, target: "global", name: "obsidian.vault.move",
                    args: JSON.stringify({ source: { resourceRef: originalRef }, to: "notes/moved.md" }) } });
            } else if (packet.type === "result") worker.dispatch("message", { data: { type: "done", ok: true, value: "1", writes: "[]" } });
        };
        const lifecycle: AgentEvent[] = [];
        try {
            await first.streamTurn({ prompt: `Replace ${path}`, userText: `Replace ${path}`, memoryMode: "skip-memory", conversationId: "conversation",
                runSourceSelection: { schemaVersion: 1, scope: "notes", selectionId: "first", userMessageId: "first-user" },
                onLifecycleEvent: event => lifecycle.push(event) });
            expect(process).toHaveBeenCalledTimes(scenario === "mixed-move" ? 0 : 1);
            expect(rename).toHaveBeenCalledTimes(scenario === "mixed-move" ? 1 : 0);
            expect(body).toBe(scenario === "mixed-move" ? "PRIVATE_OLD_BODY" : "Green");
            if (scenario === "mixed-move") expect(file.path).toBe("notes/moved.md");
            const messages = lifecycle.flatMap(event => event.type === "message_end" ? [event.message] : []) as PaAgentMessage[];
            const parent = messages.find(message => message.role === "toolResult" && message.toolName === EXECUTE_OBSIDIAN_CODE_TOOL_NAME);
            if (!parent || parent.role !== "toolResult" || !parent.actionStates?.length) throw new Error("Missing original SDK effect");
            expect(parent.content.metadata?.reason).not.toBe("task_source_changed_after_execution");
            const original = chat.refreshOperationsActionState(parent.actionStates[0]);
            expect(original.operationsUndoAvailable).toBe(true);
            const intentId = original.operationId, receiptId = original.actions![0].receiptId!;
            expect(session.getOwnedContextResult(intentId, original.origin.runId).execution?.state).toBe("completed");
            if (scenario === "excluded") denied = true;
            if (scenario === "replacement") file = { ...file, stat: { ...file.stat } };
            if (scenario === "closed-owner") session.dispose();
            const current = chat.refreshOperationsActionState(original);
            const canonical = createPaAgentPersistedTurn({ runId: current.origin.runId, turnId: current.origin.turnId,
                status: "aborted", messages });
            canonical.actionStates = [current];
            const history: ChatMessage[] = [{ role: "user", content: `Replace ${path}`, hostProvenance: {
                version: 1, kind: "ordinary_user_statement", messageId: "first-user" } },
            { role: "assistant", content: "PRIVATE_OLD_PROSE", inputLineage: current.inputLineage, actionStates: [current], canonicalTurn: canonical,
                actionStateBinding: { conversationId: "conversation", turnIndex: 0, runId: current.origin.runId, turnId: current.origin.turnId } }];
            const readsBefore = readBinary.mock.calls.length;
            providerInputs.length = 0;
            await second.streamTurn({ prompt: "Explain the stopped operation without replay", userText: "Explain the stopped operation without replay",
                memoryMode: "skip-memory", conversationId: "conversation", chatHistory: history,
                runSourceSelection: { schemaVersion: 1, scope: "notes", selectionId: "second", userMessageId: "second-user" } });
            const wire = String(providerInputs[0]);
            expect(wire).toContain(intentId);
            expect(wire).toContain(receiptId);
            expect(wire).toMatch(/"phase"\s*:\s*"completed"/);
            expect(wire).toMatch(new RegExp(`"operationsUndoAvailable"\\s*:\\s*${scenario !== "closed-owner"}`));
            // Historical prose remains usable under unchanged source permission;
            // runtime-local refs remain unavailable as new execution targets.
            if (scenario === "excluded" || scenario === "mixed-move") expect(wire).not.toContain("PRIVATE_OLD_PROSE");
            else expect(wire).toContain("PRIVATE_OLD_PROSE");
            expect(wire).not.toContain("PRIVATE_OLD_BODY");
            const oldRef = current.inputLineage.dependencies.find(dependency => dependency.kind === "vault" && dependency.resourceRef);
            if (!oldRef || oldRef.kind !== "vault") throw new Error("Missing original resource ancestry");
            expect(wire).not.toContain(oldRef.resourceRef);
            if (scenario === "excluded" || scenario === "mixed-move") expect(wire).not.toMatch(/"resourceEffect"\s*:\s*\{[^}]*"paths"/);
            expect(process).toHaveBeenCalledTimes(scenario === "mixed-move" ? 0 : 1);
            expect(rename).toHaveBeenCalledTimes(scenario === "mixed-move" ? 1 : 0);
            expect(readBinary).toHaveBeenCalledTimes(readsBefore);
        } finally {
            first.dispose(); second.dispose(); chat.dispose(); service.dispose();
            globalThis.Worker = originalWorker; MockWorker.responder = undefined;
        }
    });

    it("keeps unfinished native owner permits across two actual PaAgentRuntime requests", async () => {
        let releaseRead!: () => void;
        const firstRead = new Promise<void>(resolve => { releaseRead = resolve; });
        let reads = 0;
        const limit = OBSIDIAN_CODE_CALL_RESOURCE_LIMITS.maxInflightCalls;
        const read = async () => { if (++reads <= limit) await firstRead; return "A"; };
        const file = { path: "notes/a.md", extension: "md", stat: { mtime: 0, size: 1 } };
        const host = { settings: { debug: false, aiProvider: "qwen", baseURL: "https://example.invalid", chatModelName: "test-model",
            policyModelName: "", embeddingModelName: "", shareAnonymousCapabilityUsage: false, qwenThinkingEnabled: false,
            webSearchEnabled: true, memoryEnabled: false, licenseTier: "paid" },
            app: { workspace: { getActiveViewOfType: () => null, getMostRecentLeaf: () => null, getLeavesOfType: () => [] },
                vault: { getMarkdownFiles: () => [file], getAbstractFileByPath: (path: string) => path === file.path ? file : null,
                    cachedRead: read, read }, metadataCache: { getFileCache: () => null, getCache: () => null } },
            memorySearch: { ensureReadyForChat: async () => ({ decision: "answer-now" }), searchHybrid: async () => [] },
            getMemoryEvidenceEpoch: () => "synthetic", getAPIToken: async () => "synthetic-token", log: () => undefined,
            isOperationsAgentEnabled: () => false, getMemoryExtractionPromptContext: () => undefined,
        } as unknown as AiServiceHost;
        const makeModel = () => {
            let turns = 0;
            const bound = RunnableLambda.from(async function* () {
                if (++turns === 1) yield new AIMessageChunk({ content: "", tool_call_chunks: [{ id: "parent", index: 0,
                    name: EXECUTE_OBSIDIAN_CODE_TOOL_NAME, args: JSON.stringify({ code: "return 1", mode: "apply" }) }] });
                else yield new AIMessageChunk({ content: "Done." });
                yield new AIMessageChunk({ content: "", response_metadata: { finish_reason: turns === 1 ? "tool_calls" : "stop" } });
            });
            return { bindTools: () => bound };
        };
        const firstModel = makeModel(), secondModel = makeModel();
        const firstRuntime = new PaAgentRuntime(host, { createChatModel: async () => firstModel } as never, { skillContextProvider: null });
        const secondRuntime = new PaAgentRuntime(host, { createChatModel: async () => secondModel } as never, { skillContextProvider: null });
        MockWorker.instances = [];
        MockWorker.responder = (worker, message) => {
            const packet = message as { type?: string };
            if (packet.type === "start") {
                const count = worker === MockWorker.instances[0] ? limit : 1;
                for (let id = 1; id <= count; id++) worker.dispatch("message", { data: { type: "call", id, target: "tool", name: "read_note",
                    args: JSON.stringify({ path: "notes/a.md" }) } });
            }
            else if (packet.type === "result") worker.dispatch("message", { data: { type: "done", ok: true, value: "1", writes: "[]" } });
        };
        const originalWorker = globalThis.Worker;
        globalThis.Worker = MockWorker as unknown as typeof Worker;
        const controller = new AbortController();
        const secondController = new AbortController();
        const request = { prompt: "Read the synthetic note", userText: "Read the synthetic note", memoryMode: "skip-memory" as const };
        let first: Promise<void> | undefined;
        let second: Promise<void> | undefined;
        let firstDone = false;
        let secondDone = false;
        try {
            first = firstRuntime.streamTurn({ ...request, signal: controller.signal }).catch(() => undefined)
                .finally(() => { firstDone = true; });
            await waitFor(() => reads === limit, "first request did not fill the native owner permits");
            controller.abort();
            await waitFor(() => firstDone, "first actual runtime did not return after Stop");
            second = secondRuntime.streamTurn({ ...request, signal: secondController.signal })
                .finally(() => { secondDone = true; });
            await waitFor(() => MockWorker.instances.length === 2, "second actual runtime did not launch");
            await new Promise(resolve => setTimeout(resolve, 20));
            expect(reads).toBe(limit);
            releaseRead();
            await waitFor(() => secondDone, `second native owner did not finish (reads=${reads})`);
            await second;
            expect(reads).toBe(limit + 1);
        } finally {
            controller.abort(); secondController.abort();
            releaseRead();
            await Promise.allSettled([first, second].filter((value): value is Promise<void> => Boolean(value)));
            firstRuntime.dispose(); secondRuntime.dispose(); globalThis.Worker = originalWorker; MockWorker.responder = undefined;
        }
    }, 15_000);

    it.each([false, true])("delivers prior read snapshots after trash and optional same-path recreation; recreate=%s", async recreate => {
        const first = { path: "notes/a.md", extension: "md", content: "READ_BEFORE_TRASH", stat: { mtime: 1, size: 17 } };
        const second = { path: "notes/b.md", extension: "md", content: "READ_AFTER_TRASH", stat: { mtime: 1, size: 16 } };
        const folder = { path: "notes", children: [first, second] as FileLike[] };
        const files = new Map<string, FileLike>([[first.path, first], [second.path, second], [folder.path, folder]]);
        let epoch = 0;
        const vault = { getAbstractFileByPath: (path: string) => files.get(path) ?? null,
            getMarkdownFiles: () => [...files.values()].filter(file => file.extension === "md"),
            read: async (file: FileLike) => file.content ?? "", cachedRead: async (file: FileLike) => file.content ?? "",
            readBinary: async (file: FileLike) => new TextEncoder().encode(file.content ?? "").buffer,
            create: async (path: string, content: string) => {
                const file = { path, content, stat: { mtime: 2, size: content.length } };
                files.set(path, file); folder.children.push(file); epoch++;
                return file;
            },
            adapter: { exists: async (path: string) => files.has(path) } };
        const trash = jest.fn(async (file: { path: string }) => {
            files.delete(file.path);
            folder.children = folder.children.filter(child => child !== file);
            epoch++;
        });
        const host = { settings: { debug: false, aiProvider: "qwen", baseURL: "https://example.invalid", chatModelName: "test-model",
            policyModelName: "", embeddingModelName: "", shareAnonymousCapabilityUsage: false, qwenThinkingEnabled: false,
            webSearchEnabled: true, memoryEnabled: false, licenseTier: "paid" },
            app: { vault, workspace: { getActiveViewOfType: () => null, getMostRecentLeaf: () => null, getLeavesOfType: () => [] },
                metadataCache: { getFileCache: () => null, getCache: () => null } },
            memorySearch: { ensureReadyForChat: async () => ({ decision: "answer-now" }), searchHybrid: async () => [] },
            isDataBoundaryAllowedPath: () => true,
            getMemoryEvidenceEpoch: () => `graph-${epoch}`, getTaskSourceAuthorityEpoch: () => `authority-${epoch}`,
            getTaskSourceConfigurationEpoch: () => "configuration-1",
            getAPIToken: async () => "synthetic-token", log: () => undefined, isOperationsAgentEnabled: true,
            getMemoryExtractionPromptContext: () => undefined,
        } as unknown as AiServiceHost;
        const service = new OperationsService({ vault: vault as never, trashFile: trash, trashResource: trash,
            isOperationsAgentEnabled: () => true });
        const session = service.createSession({ surface: "test" });
        const chat = new ChatService(host, session);
        let turns = 0;
        const program = `const a=await obsidian.vault.readText({target:{path:"notes/a.md"}});
            const trash=await obsidian.vault.trash({target:{resourceRef:a.value.resourceRef}});
            ${recreate ? 'const created=await obsidian.vault.createText({path:"notes/a.md",text:"NEW_A"});' : ''}
            const b=await obsidian.vault.readText({target:{path:"notes/b.md"}}); return {a,trash,b};`;
        const providerInputs: unknown[] = [];
        const bound = RunnableLambda.from(async function* (input: unknown) {
            providerInputs.push(input);
            if (++turns === 1) yield new AIMessageChunk({ content: "", tool_call_chunks: [{ id: "trash-parent", index: 0,
                name: EXECUTE_OBSIDIAN_CODE_TOOL_NAME, args: JSON.stringify({ code: program, mode: "apply" }) }] });
            else yield new AIMessageChunk({ content: "The original source was trashed and both snapshots remain available." });
            yield new AIMessageChunk({ content: "", response_metadata: { finish_reason: turns === 1 ? "tool_calls" : "stop" } });
        });
        const runtime = new PaAgentRuntime(host, { createChatModel: async () => ({ bindTools: () => bound }) } as never, {
            skillContextProvider: null, operationsIntentController: session, operationsToolProvider: service.provider,
            operationsIntentExecutor: input => chat.executeOperationsIntentFromAgent(input),
        });
        const lifecycle: AgentEvent[] = [];
        let firstRead: { ok: boolean; value: { resourceRef: string; text: string } } | undefined;
        let trashed: { ok: boolean; value: { intentId: string } } | undefined;
        let created: { ok: boolean } | undefined;
        const originalWorker = globalThis.Worker;
        globalThis.Worker = MockWorker as unknown as typeof Worker;
        MockWorker.instances = [];
        MockWorker.responder = (worker, packet) => {
            const message = packet as { type?: string; id?: number; payload?: string };
            if (message.type === "start") worker.dispatch("message", { data: { type: "call", id: 1, target: "global",
                name: "obsidian.vault.readText", args: JSON.stringify({ target: { path: first.path } }) } });
            else if (message.type === "result" && message.id === 1) {
                firstRead = JSON.parse(String(message.payload));
                worker.dispatch("message", { data: { type: "call", id: 2, target: "global", name: "obsidian.vault.trash",
                    args: JSON.stringify({ target: { resourceRef: firstRead!.value.resourceRef } }) } });
            } else if (message.type === "result" && message.id === 2) {
                trashed = JSON.parse(String(message.payload));
                worker.dispatch("message", { data: recreate
                    ? { type: "call", id: 3, target: "global", name: "obsidian.vault.createText",
                        args: JSON.stringify({ path: first.path, text: "NEW_A" }) }
                    : { type: "call", id: 3, target: "global", name: "obsidian.vault.readText",
                        args: JSON.stringify({ target: { path: second.path } }) } });
            } else if (message.type === "result" && message.id === 3 && recreate) {
                created = JSON.parse(String(message.payload));
                worker.dispatch("message", { data: { type: "call", id: 4, target: "global", name: "obsidian.vault.readText",
                    args: JSON.stringify({ target: { path: second.path } }) } });
            } else if (message.type === "result" && message.id === (recreate ? 4 : 3)) {
                worker.dispatch("message", { data: { type: "done", ok: true,
                    value: JSON.stringify({ a: firstRead, trash: trashed, b: JSON.parse(String(message.payload)) }), writes: "[]" } });
            }
        };
        try {
            await runtime.streamTurn({ prompt: "Read A, trash A, then read B", userText: "Read A, trash A, then read B",
                memoryMode: "skip-memory", conversationId: "conversation",
                runSourceSelection: { schemaVersion: 1, scope: "notes", selectionId: "trash", userMessageId: "trash-user" },
                onLifecycleEvent: event => lifecycle.push(event) });
            expect(trash).toHaveBeenCalledTimes(1);
            expect(files.has(first.path)).toBe(recreate);
            if (recreate) {
                expect(created?.ok).toBe(true);
                expect(files.get(first.path)?.content).toBe("NEW_A");
            }
            expect(trashed?.ok).toBe(true);
            const parent = lifecycle.find(event => event.type === "message_end" && event.message.role === "toolResult"
                && event.message.toolName === EXECUTE_OBSIDIAN_CODE_TOOL_NAME);
            if (!parent || parent.type !== "message_end" || parent.message.role !== "toolResult") throw new Error("Missing parent result");
            expect(parent.message.content.metadata?.reason).not.toBe("task_source_changed_after_execution");
            expect(JSON.parse(parent.message.content.promptText).observation.value).toMatchObject({
                a: { ok: true, value: { text: first.content } }, b: { ok: true, value: { text: second.content } }, trash: { ok: true },
            });
            expect(session.getOwnedContextResult(trashed!.value.intentId, parent.runId).execution).toMatchObject({ state: "completed" });
            expect(String(providerInputs.at(-1))).toContain(first.content);
            expect(String(providerInputs.at(-1))).toContain(second.content);
        } finally {
            runtime.dispose(); chat.dispose(); service.dispose(); globalThis.Worker = originalWorker; MockWorker.responder = undefined;
        }
    });

    it("creates, verifies, opens and undoes its own Web output without reading existing notes", async () => {
        const privateNote = { path: "notes/private.md", extension: "md", content: "PRIVATE_NOTE", stat: { mtime: 1, size: 12 } };
        const folder = { path: "notes", children: [privateNote] as FileLike[] };
        const files = new Map<string, FileLike>([[privateNote.path, privateNote], [folder.path, folder]]);
        let epoch = 0;
        const readBinary = jest.fn(async (file: FileLike) => new TextEncoder().encode(file.content ?? "").buffer);
        const create = jest.fn(async (path: string, content: string) => {
            const file = { path, content, stat: { mtime: 1, size: content.length } };
            files.set(path, file); epoch++;
            return file;
        });
        const createFolder = jest.fn(async (path: string) => {
            const file = { path, children: [] };
            files.set(path, file); epoch++;
            return file;
        });
        const openedLeaf = { view: { file: undefined as FileLike | undefined, getViewType: () => "markdown" },
            openFile: jest.fn(async (file: FileLike) => { openedLeaf.view.file = file; }) };
        const trashResource = jest.fn(async (file: { path: string }) => { files.delete(file.path); epoch++; });
        const vault = { getAbstractFileByPath: (path: string) => files.get(path) ?? null,
            getMarkdownFiles: () => [privateNote], read: async (file: FileLike) => file.content ?? "",
            cachedRead: async (file: FileLike) => file.content ?? "", readBinary, create, createFolder,
            adapter: { exists: async (path: string) => files.has(path) } };
        const host = { settings: { debug: false, aiProvider: "qwen", baseURL: "https://example.invalid", chatModelName: "test-model",
            policyModelName: "", embeddingModelName: "", shareAnonymousCapabilityUsage: false, qwenThinkingEnabled: false,
            webSearchEnabled: true, memoryEnabled: false, licenseTier: "paid" },
            app: { vault, workspace: { getActiveViewOfType: () => null, getMostRecentLeaf: () => null, getLeavesOfType: () => [],
                getLeaf: () => openedLeaf, iterateAllLeaves: (visit: (leaf: unknown) => void) => visit(openedLeaf) },
                metadataCache: { getFileCache: () => null, getCache: () => null } },
            memorySearch: { ensureReadyForChat: async () => ({ decision: "answer-now" }), searchHybrid: async () => [] },
            isDataBoundaryAllowedPath: () => true,
            getMemoryEvidenceEpoch: () => `graph-${epoch}`, getTaskSourceAuthorityEpoch: () => `authority-${epoch}`,
            getTaskSourceConfigurationEpoch: () => "configuration-1",
            getAPIToken: async () => "synthetic-token", log: () => undefined, isOperationsAgentEnabled: true,
            getMemoryExtractionPromptContext: () => undefined,
        } as unknown as AiServiceHost;
        const service = new OperationsService({ vault: vault as never, trashFile: async () => undefined, trashResource,
            isOperationsAgentEnabled: () => true });
        const session = service.createSession({ surface: "test" });
        const chat = new ChatService(host, session);
        let turns = 0;
        const steps = [
            { name: "obsidian.vault.mkdir", args: { path: "notes/research" } },
            { name: "obsidian.vault.createText", args: { path: "notes/research/answer.md", text: "PUBLIC_WEB_SUMMARY" } },
            { name: "obsidian.vault.readText", args: { target: { path: "notes/research/answer.md" } } },
            { name: "obsidian.workspace.open", args: { target: { path: "notes/research/answer.md" } } },
            { name: "obsidian.operations.undo", args: { receiptId: "created-receipt" } },
            { name: "obsidian.vault.readText", args: { target: { path: privateNote.path } } },
        ];
        const program = steps.map((step, index) => `const r${index}=await ${step.name}(${step.name === "obsidian.operations.undo"
            ? "{receiptId:r1.value.operations[0].receiptId}" : JSON.stringify(step.args)});`).join("\n")
            + "return [r0,r1,r2,r3,r4,r5];";
        const providerInputs: unknown[] = [];
        const bound = RunnableLambda.from(async function* (input: unknown) {
            providerInputs.push(input);
            if (++turns === 1) yield new AIMessageChunk({ content: "", tool_call_chunks: [{ id: "web-output-parent", index: 0,
                name: EXECUTE_OBSIDIAN_CODE_TOOL_NAME, args: JSON.stringify({ code: program, mode: "apply" }) }] });
            else yield new AIMessageChunk({ content: "Saved the public summary." });
            yield new AIMessageChunk({ content: "", response_metadata: { finish_reason: turns === 1 ? "tool_calls" : "stop" } });
        });
        const runtime = new PaAgentRuntime(host, { createChatModel: async () => ({ bindTools: () => bound }) } as never, {
            skillContextProvider: null, operationsIntentController: session, operationsToolProvider: service.provider,
            operationsIntentExecutor: input => chat.executeOperationsIntentFromAgent(input),
        });
        const lifecycle: AgentEvent[] = [];
        const replies: Array<{ ok: boolean; value?: { operations?: Array<{ receiptId?: string }>; text?: string } }> = [];
        const originalWorker = globalThis.Worker;
        globalThis.Worker = MockWorker as unknown as typeof Worker;
        MockWorker.instances = [];
        MockWorker.responder = (worker, packet) => {
            const message = packet as { type?: string; id?: number; payload?: string };
            if (message.type === "result") replies.push(JSON.parse(String(message.payload)));
            if (message.type !== "start" && message.type !== "result") return;
            const step = steps[replies.length];
            if (step) worker.dispatch("message", { data: { type: "call", id: replies.length + 1, target: "global",
                name: step.name, args: JSON.stringify(step.name === "obsidian.operations.undo"
                    ? { receiptId: replies[1].value?.operations?.[0].receiptId } : step.args) } });
            else worker.dispatch("message", { data: { type: "done", ok: true, value: JSON.stringify(replies), writes: "[]" } });
        };
        try {
            await runtime.streamTurn({ prompt: "Save the public web summary in a new research folder",
                userText: "Save the public web summary in a new research folder", memoryMode: "skip-memory", conversationId: "conversation",
                runSourceSelection: { schemaVersion: 1, scope: "web", selectionId: "web-output", userMessageId: "web-user" },
                onLifecycleEvent: event => lifecycle.push(event) });
            expect(replies.map(reply => reply.ok)).toEqual([true, true, true, true, true, false]);
            expect(createFolder).toHaveBeenCalledTimes(1);
            expect(create).toHaveBeenCalledTimes(1);
            expect(replies[2].value?.text).toBe("PUBLIC_WEB_SUMMARY");
            expect(openedLeaf.openFile).toHaveBeenCalledTimes(1);
            expect(trashResource).toHaveBeenCalledTimes(1);
            expect(files.has("notes/research/answer.md")).toBe(false);
            expect(readBinary.mock.calls.some(([file]) => file === privateNote)).toBe(false);
            const parent = lifecycle.find(event => event.type === "message_end" && event.message.role === "toolResult"
                && event.message.toolName === EXECUTE_OBSIDIAN_CODE_TOOL_NAME);
            if (!parent || parent.type !== "message_end" || parent.message.role !== "toolResult") throw new Error("Missing parent result");
            expect(parent.message.isError).toBe(false);
            expect(JSON.parse(parent.message.content.promptText).observation.value).toEqual(replies);
            expect(String(providerInputs.at(-1))).not.toContain("PRIVATE_NOTE");
        } finally {
            runtime.dispose(); chat.dispose(); service.dispose(); globalThis.Worker = originalWorker; MockWorker.responder = undefined;
        }
    });

    it.each(["self-write", "excluded", "parent-revoked", "replacement", "cancelled"] as const)("refreshes the composed parent proof after native create and preserves original effects under %s", async scenario => {
        const source = { path: "notes/source.md", extension: "md", content: "Source", stat: { mtime: 1, size: 6 } };
        const folder = { path: "notes", children: [source] as FileLike[] };
        const files = new Map<string, FileLike>([[source.path, source], [folder.path, folder]]);
        const createdPath = "notes/created.txt", createdText = "CREATED_VALUE";
        let authorityEpoch = 0;
        let configurationEpoch = 0;
        let excluded = false;
        const isPathAllowed = (path: string) => !(excluded
            && (path === createdPath || scenario === "parent-revoked" && path === source.path));
        const readBinary = jest.fn(async (target: FileLike) => new TextEncoder().encode(target.content ?? "").buffer);
        const create = jest.fn(async (path: string, content: string) => {
            const file = { path, content, stat: { mtime: 1, ctime: 1, size: content.length } };
            files.set(path, file); folder.children.push(file); authorityEpoch++;
            return file;
        });
        const vault = { getAbstractFileByPath: (path: string) => files.get(path) ?? null, getMarkdownFiles: () => [source],
            read: async (target: FileLike) => target.content ?? "", cachedRead: async (target: FileLike) => target.content ?? "",
            readBinary, create, adapter: { exists: async (path: string) => files.has(path) } };
        const host = { settings: { debug: false, aiProvider: "qwen", baseURL: "https://example.invalid", chatModelName: "test-model",
            policyModelName: "", embeddingModelName: "", shareAnonymousCapabilityUsage: false, qwenThinkingEnabled: false,
            webSearchEnabled: true, memoryEnabled: false, licenseTier: "paid" },
            app: { vault, workspace: { getActiveViewOfType: () => null, getMostRecentLeaf: () => null, getLeavesOfType: () => [] },
                metadataCache: { getFileCache: () => null, getCache: () => null } },
            memorySearch: { ensureReadyForChat: async () => ({ decision: "answer-now" }), searchHybrid: async () => [] },
            isDataBoundaryAllowedPath: isPathAllowed,
            getMemoryEvidenceEpoch: () => `graph-${authorityEpoch}`, getTaskSourceAuthorityEpoch: () => `authority-${authorityEpoch}`,
            getTaskSourceConfigurationEpoch: () => `configuration-${configurationEpoch}`,
            getAPIToken: async () => "synthetic-token", log: () => undefined, isOperationsAgentEnabled: true,
            getMemoryExtractionPromptContext: () => undefined,
        } as unknown as AiServiceHost;
        const service = new OperationsService({ vault: vault as never, trashFile: async () => undefined, renameFile: async () => undefined,
            isOperationsAgentEnabled: () => true, isPathAllowed });
        const session = service.createSession({ surface: "test" });
        const chat = new ChatService(host, session);
        let modelTurns = 0;
        const program = `const create = await obsidian.vault.createText({path:${JSON.stringify(createdPath)},text:${JSON.stringify(createdText)}});\n`
            + `const read = await obsidian.vault.readText({target:{path:${JSON.stringify(createdPath)}}}); return {create,read};`;
        const providerInputs: unknown[] = [];
        const bound = RunnableLambda.from(async function* (input: unknown) {
            providerInputs.push(input);
            if (++modelTurns === 1) yield new AIMessageChunk({ content: "", tool_call_chunks: [{ id: "epoch-read", index: 0,
                name: "read_note", args: JSON.stringify({ path: source.path }) }] });
            else if (modelTurns === 2) yield new AIMessageChunk({ content: "", tool_call_chunks: [{ id: "epoch-parent", index: 0,
                name: EXECUTE_OBSIDIAN_CODE_TOOL_NAME, args: JSON.stringify({ code: program, mode: "apply" }) }] });
            else yield new AIMessageChunk({ content: "The original effects are recorded." });
            yield new AIMessageChunk({ content: "", response_metadata: { finish_reason: modelTurns <= 2 ? "tool_calls" : "stop" } });
        });
        const model = { bindTools: () => bound };
        const runtime = new PaAgentRuntime(host, { createChatModel: async () => model } as never, {
            skillContextProvider: null, operationsIntentController: session, operationsToolProvider: service.provider,
            operationsIntentExecutor: input => chat.executeOperationsIntentFromAgent(input),
        });
        const lifecycle: AgentEvent[] = [];
        const controller = new AbortController();
        let createReply: { ok: boolean; value: { intentId: string; operations: Array<{ receiptId: string }> } } | undefined;
        const originalWorker = globalThis.Worker;
        globalThis.Worker = MockWorker as unknown as typeof Worker;
        MockWorker.instances = [];
        MockWorker.responder = (worker, packet) => {
            const message = packet as { type?: string; id?: number; payload?: string };
            if (message.type === "start") worker.dispatch("message", { data: { type: "call", id: 1, target: "global",
                name: "obsidian.vault.createText", args: JSON.stringify({ path: createdPath, text: createdText }) } });
            else if (message.type === "result" && message.id === 1) {
                createReply = JSON.parse(String(message.payload));
                worker.dispatch("message", { data: { type: "call", id: 2, target: "global", name: "obsidian.vault.readText",
                    args: JSON.stringify({ target: { path: createdPath } }) } });
            } else if (message.type === "result" && message.id === 2) {
                const read = JSON.parse(String(message.payload));
                expect(read).toMatchObject({ ok: true, value: { text: createdText } });
                if (scenario === "excluded" || scenario === "parent-revoked") { excluded = true; configurationEpoch++; authorityEpoch++; }
                if (scenario === "replacement") files.set(createdPath, { path: createdPath, content: createdText });
                if (scenario === "cancelled") controller.abort();
                else worker.dispatch("message", { data: { type: "done", ok: true,
                    value: JSON.stringify({ create: createReply, read }), writes: "[]" } });
            }
        };
        try {
            const request = runtime.streamTurn({ prompt: `Create ${createdPath} using ${source.path} as context`,
                userText: `Create ${createdPath} using ${source.path} as context`, memoryMode: "skip-memory", conversationId: "conversation",
                runSourceSelection: { schemaVersion: 1, scope: "notes", selectionId: "epoch", userMessageId: "epoch-user" },
                signal: controller.signal, onLifecycleEvent: event => lifecycle.push(event) });
            if (scenario === "cancelled") await request.catch(error => { expect(error.name).toBe("AbortError"); });
            else await request;
            expect(create).toHaveBeenCalledTimes(1);
            expect(authorityEpoch).toBeGreaterThan(0);
            expect(createReply?.ok).toBe(true);
            const intentId = createReply!.value.intentId, receiptId = createReply!.value.operations[0].receiptId;
            const states = lifecycle.flatMap(event => event.type === "message_end" && event.message.role === "toolResult"
                ? event.message.actionStates ?? [] : []);
            if (scenario !== "cancelled") expect(states).toEqual(expect.arrayContaining([expect.objectContaining({ operationId: intentId, phase: "completed",
                actions: [expect.objectContaining({ receiptId, phase: "applied" })] })]));
            const parent = lifecycle.find(event => event.type === "message_end" && event.message.role === "toolResult"
                && event.message.toolName === EXECUTE_OBSIDIAN_CODE_TOOL_NAME);
            if (scenario === "self-write" || scenario === "replacement") {
                if (!parent || parent.type !== "message_end" || parent.message.role !== "toolResult") throw new Error("Missing parent result");
                expect(parent.message.content.metadata?.reason).not.toBe("task_source_changed_after_execution");
                expect(JSON.parse(parent.message.content.promptText).observation.value.read).toMatchObject({ ok: true, value: { text: createdText } });
            } else {
                if (parent && parent.type === "message_end") expect(JSON.stringify(parent.message)).not.toContain(createdText);
                expect(session.getOwnedContextResult(intentId, states[0]?.origin.runId
                    ?? lifecycle.find(event => event.type === "agent_start")!.runId).execution).toMatchObject({ state: "completed",
                    operations: [expect.objectContaining({ receiptId })] });
            }
            if (scenario !== "cancelled") {
                const nextProvider = String(providerInputs.at(-1));
                expect(nextProvider).toContain(intentId);
                expect(nextProvider).toContain(receiptId);
            }
        } finally { runtime.dispose(); chat.dispose(); service.dispose(); globalThis.Worker = originalWorker; MockWorker.responder = undefined; }
    });

    it("dynamically admits a read and keeps the pure guest boundary closed", async () => {
        const file = { path: "notes/a.md", stat: { mtime: 0, size: 1 } };
        const files = new Map<string, FileLike>([["notes/a.md", file]]);
        const sourceRun = makeSourceRun(files);
        const registry = new CapabilityRegistry();
        const calls: Array<{ path: string; guard: boolean }> = [];
        registry.register(readNoteCapability());
        const executor = wrapSourceExecutor(sourceRun, syntheticBaseExecutor(calls), new Set());
        const result = await runObsidian({
            registry,
            sourceRun,
            executor,
            code: `
                const read = await tools.read_note({ path: "notes/a.md" });
                return {
                    text: read.observation.text,
                    toolNames: Object.keys(tools),
                    obsidian: typeof obsidian,
                    app: typeof app,
                    require: typeof require,
                    fetch: typeof fetch
                };
            `,
        });

        expect(result.ok).toBe(true);
        expect(result.content?.value).toEqual({
            text: "TEXT:notes/a.md",
            toolNames: ["read_note"],
            obsidian: "undefined",
            app: "undefined",
            require: "undefined",
            fetch: "undefined",
        });
        expect(calls).toEqual([{ path: "notes/a.md", guard: true }]);
        expect(result.sourceRecords?.map(record => record.path)).toEqual(["notes/a.md"]);
        expect(result.inputLineage?.dependencies).toContainEqual({
            kind: "vault", path: "notes/a.md", via: "note",
        });

        const programResult = await runObsidian({
            registry, sourceRun, executor,
            code: `return "z".repeat(1_000_001);`,
        });
        expect(programResult.ok).toBe(false);
        expect(programResult.error).toContain("composed-execution payload budget");
        expect(() => createExecuteObsidianCodeTool().validateInput({
            code: "x".repeat(1_000_001), mode: "apply",
        })).toThrow("code exceeds the composed-execution payload budget");
    });

    it("rejects an excluded dynamic target before the domain read", async () => {
        const files = new Map<string, FileLike>([
            ["notes/a.md", { path: "notes/a.md" }],
            ["notes/excluded.md", { path: "notes/excluded.md" }],
        ]);
        const sourceRun = makeSourceRun(files, false);
        const registry = new CapabilityRegistry();
        const calls: Array<{ path: string; guard: boolean }> = [];
        registry.register(readNoteCapability());
        const executor = wrapSourceExecutor(sourceRun, syntheticBaseExecutor(calls), new Set());
        const result = await runObsidian({
            registry,
            sourceRun,
            executor,
            code: `return await tools.read_note({ path: "notes/excluded.md" });`,
        });

        expect(result.ok).toBe(true);
        const value = result.content?.value as { error: { code: string } };
        expect(value.error.code).toBe("source_excluded");
        expect(calls).toEqual([]);
    });

    it("preserves an admitted SDK stale_target through the real registry, Host executor and QuickJS without changing direct facade failure", async () => {
        const h = sdkReadFixture();
        const result = await runObsidian({ ...h, code: `
            const sdk = await obsidian.vault.readText({target:{path:"notes/data.txt"},cursor:"expired-cursor"});
            const facade = await tools.list_vault_entries({target:{path:"notes/data.txt"},cursor:"expired-cursor"});
            return {sdk,facade};
        ` });
        expect(result.ok).toBe(true);
        expect(result.content?.value).toMatchObject({
            sdk: { ok: false, error: { code: "stale_target", message: "The continuation is expired or belongs to another query." } },
            facade: { ok: false, status: "unavailable", error: { code: "recoverable_error" } },
        });
        expect((result.content?.value as { sdk: object }).sdk).not.toHaveProperty("value");
        expect(h.observations).toEqual([
            { name: "obsidian.vault.readText", ok: true, content: expect.objectContaining({ ok: false, error: expect.objectContaining({ code: "stale_target" }) }) },
            { name: "list_vault_entries", ok: false, content: null },
        ]);
        expect(h.readBinary).not.toHaveBeenCalled();
        expect(JSON.stringify(result.content?.value)).not.toContain("PRIVATE_SAVED_TEXT");
    });

    it("keeps the original Host source fence closed after native IO despite SDK result transport", async () => {
        const h = sdkReadFixture();
        h.readBinary.mockImplementationOnce(async () => {
            h.withdraw();
            return new TextEncoder().encode("PRIVATE_SAVED_TEXT").buffer;
        });
        const result = await runObsidian({ ...h, code: `return await obsidian.vault.readText({target:{path:"notes/data.txt"}});` });
        expect(result.content?.value).toMatchObject({ ok: false, error: { code: "composed_child_owner_exception" } });
        expect(result.content?.value).not.toHaveProperty("value");
        expect(JSON.stringify(result.content?.value)).not.toContain("PRIVATE_SAVED_TEXT");
        expect(h.readBinary).toHaveBeenCalledTimes(1);
        expect(result.sourceRecords).toEqual([]);
    });

    it("revives base64 wire bytes to a guest Uint8Array", async () => {
        const result = await runIndependentCode({
            code: `
                const result = await obsidian.vault.readBinary();
                return {
                    constructor: result.value.bytes.constructor.name,
                    byteLength: result.value.bytes.byteLength,
                    values: [...result.value.bytes]
                };
            `,
            timeoutMs: 10_000,
            globals: [{
                name: "obsidian.vault.readBinary",
                binaryResult: true,
                execute: async () => ({
                    ok: true, value: { bytes: { __bytesBase64: "AAAPvw==" } },
                }),
            }],
            launcher: inlineLauncher(await quickJsWasm, 1_000_000),
            maxCallPayloadChars: 1_000_000,
        });
        expect(result).toMatchObject({
            ok: true,
            value: { constructor: "Uint8Array", byteLength: 4, values: [0, 0, 15, 191] },
        });
    });

    it("keeps a preview parent zero-submit for an effect owner without preview support", async () => {
        const files = new Map<string, FileLike>([["notes/a.md", { path: "notes/a.md" }]]);
        const sourceRun = makeSourceRun(files);
        const registry = new CapabilityRegistry();
        const submitted: string[] = [];
        registry.register(createChatToolCapability({
            name: "create_image",
            description: "Synthetic non-Operations effect",
            inputSchema: {
                type: "object",
                properties: { prompt: { type: "string" } },
                required: ["prompt"],
                additionalProperties: false,
            },
            plannerGuidance: [],
            permission: "image-generation",
            cost: "ai-calls",
            outputBudgetChars: 10_000,
            requiresConfirmation: false,
            failureBehavior: "recoverable",
            statusMessageText: "Effect",
            sourceBoundary: "read-only-tool",
            statusMessage: () => "Effect",
            validateInput: raw => {
                const prompt = (raw as { prompt?: unknown })?.prompt;
                if (typeof prompt !== "string") throw new Error("prompt required");
                return { prompt };
            },
            execute: async input => {
                submitted.push(input.prompt);
                return {
                    ok: true,
                    tool: "create_image",
                    inputSummary: "generate; count:1",
                    content: { status: "accepted", taskId: "must-not-happen" },
                    sources: [],
                    resultFact: { kind: "accepted", action: "image", operationId: "must-not-happen" },
                };
            },
        }, { providerId: "test-preview-effect" }));
        const executor = wrapSourceExecutor(sourceRun, createPaAgentCapabilityToolExecutor({
            registry,
            host: { log: () => undefined } as never,
            platform: "desktop",
        }));
        const result = await runObsidian({
            registry, sourceRun, executor, mode: "preview",
            code: `return await tools.create_image({ prompt: "preview effect" });`,
        });

        expect(result.ok).toBe(true);
        expect(result.content?.value).toEqual({
            ok: false,
            error: {
                code: "preview_unsupported",
                message: "This effect capability has no preview implementation; it was not executed.",
                executionState: "not_started",
            },
        });
        expect(submitted).toEqual([]);
        expect(result.actionStates).toEqual([]);

        const oversized = await runObsidian({
            registry, sourceRun, executor, mode: "preview",
            code: `
                try {
                    return await tools.create_image({ prompt: "x".repeat(1_000_001) });
                } catch (error) {
                    return { ok: false, error: { code: "host_call_rejected", message: String(error) } };
                }
            `,
        });
        const oversizedValue = oversized.content?.value as { error: { code: string; message: string } };
        expect(oversizedValue.error.code).toBe("host_call_rejected");
        expect(oversizedValue.error.message).toContain("RPC byte budget");
        expect(submitted).toEqual([]);
    });

    it("keeps an accepted aggregate snapshot usable after ordinary vault epoch changes", async () => {
        const files = new Map<string, FileLike>([["notes/a.md", { path: "notes/a.md" }]]);
        let sourceRunActive = true;
        let epoch = "epoch-1";
        const sourceRun = new TaskSourceRun({
            runId: "run",
            userMessageId: "user",
            userText: "query then continue",
            requestText: "query then continue",
            workspace: {
                getActiveViewOfType: () => null,
                getMostRecentLeaf: () => null,
                getLeavesOfType: () => [],
            } as never,
            getFileByPath: path => files.get(path),
            isCurrent: () => sourceRunActive,
            areSourcesCurrent: () => sourceRunActive,
            getMemoryEvidenceEpoch: () => epoch,
            getTaskSourceConfigurationEpoch: () => "configuration-1",
        });
        const registry = new CapabilityRegistry();
        const queries: string[] = [];
        registry.register(createChatToolCapability({
            name: "query_notes",
            description: "Pathless synthetic query",
            inputSchema: {
                type: "object",
                properties: { query: { type: "string" } },
                required: ["query"],
                additionalProperties: false,
            },
            plannerGuidance: [],
            permission: "read-only",
            cost: "free",
            outputBudgetChars: 100_000,
            requiresConfirmation: false,
            failureBehavior: "recoverable",
            statusMessageText: "Query",
            sourceBoundary: "vault",
            statusMessage: () => "Query",
            validateInput: raw => {
                const query = (raw as { query?: unknown })?.query;
                if (typeof query !== "string") throw new Error("query required");
                return { query };
            },
            execute: async input => {
                queries.push(input.query);
                return {
                    ok: true,
                    tool: "query_notes",
                    inputSummary: input.query,
                    content: { query: input.query, matches: [] },
                    sources: [],
                    resultFact: { kind: "no_match", search: "metadata" },
                };
            },
        }, { providerId: "test-query" }));
        const executor = wrapSourceExecutor(
            sourceRun,
            createPaAgentCapabilityToolExecutor({
                registry,
                host: { log: () => undefined } as never,
                platform: "desktop",
            }),
            new Set(["query_notes"]),
        );
        const run = async (query: string) => {
            const runtime = createExecuteObsidianCodeRuntime({
                runId: "run",
                turnId: "turn",
                turnIndex: 0,
                userInput: "query then continue",
                parentToolCallId: `query-${query}`,
                parentAssistantId: "assistant",
                parentInputLineage: completeInputLineage([{ kind: "user-text", messageId: "user" }]),
                registry,
                beginInputLineageObservation: () => {
                    const epoch = sourceRun.currentNotesObservationEpoch();
                    return result => result.outcome === "success"
                        ? sourceRun.captureRunNotesObservationLineage("vault", epoch) : undefined;
                },
                acceptInputLineage: lineage => sourceRun.acceptExecutionLineage(lineage),
                getExecutor: () => executor,
                launcher: inlineLauncher(await quickJsWasm, 1_000_000),
            });
            return await runtime.execute({ code: `return await tools.query_notes({ query: ${JSON.stringify(query)} });`, mode: "apply" }, {
                host: { log: () => undefined } as never,
                outerToolDeadlineAt: Date.now() + 10_000,
            });
        };

        const first = await run("first");
        expect(first.content?.value).toMatchObject({ observation: { query: "first", matches: [] } });
        expect(first.inputLineage?.dependencies).toContainEqual({
            kind: "run-notes-observation", runId: "run", owner: "vault", sourceEpoch: "epoch-1",
        });
        epoch = "epoch-after-self-write";
        const second = await run("second");
        expect(second.content?.value).toMatchObject({ observation: { query: "second", matches: [] } });
        expect(queries).toEqual(["first", "second"]);
        sourceRunActive = false;
        const rejected = await run("third");
        const rejectedValue = rejected.content?.value as { error: { code: string } };
        expect(rejectedValue.error.code).toBe("source_run_changed");
        expect(queries).toEqual(["first", "second"]);
    });

    it("bounds the guest copy of an oversized owner observation without dropping its source", async () => {
        const files = new Map<string, FileLike>([["notes/a.md", { path: "notes/a.md" }]]);
        const sourceRun = makeSourceRun(files);
        const registry = new CapabilityRegistry();
        const calls: Array<{ path: string; guard: boolean }> = [];
        registry.register(readNoteCapability());
        const executor = wrapSourceExecutor(
            sourceRun,
            syntheticBaseExecutor(calls, true),
            new Set(),
        );
        const result = await runObsidian({
            registry, sourceRun, executor,
            code: `return await tools.read_note({ path: "notes/a.md" });`,
        });

        expect(result.content?.value).toEqual({
            ok: false,
            error: {
                code: "output_budget_exceeded",
                message: "The tool result exceeds the composed-execution payload budget.",
            },
        });
        expect(calls).toEqual([{ path: "notes/a.md", guard: true }]);
        expect(result.sourceRecords?.map(record => record.path)).toEqual(["notes/a.md"]);
        expect(result.inputLineage?.dependencies).toContainEqual({
            kind: "vault", path: "notes/a.md", via: "note",
        });
    });

    it("uses real Operations preview/apply owners and rejects guest-forged receipts", async () => {
        const files = new Map<string, FileLike>([
            ["notes/a.md", { path: "notes/a.md", extension: "md" }],
        ]);
        const sourceRun = makeSourceRun(files);
        const service = new OperationsService({
            vault: {
                getAbstractFileByPath: (path: string) => files.get(path) ?? null,
                adapter: { exists: async (path: string) => files.has(path) },
                read: async (file: { path: string }) => file.path === "notes/a.md" ? "A" : "",
                create: async () => { throw new Error("unexpected create"); },
                process: async (file: { path: string }, change: (current: string) => string) => {
                    const content = change(file.path === "notes/a.md" ? "A" : "");
                    files.set(file.path, { ...file, content });
                    return content;
                },
                renameFile: async () => undefined,
            } as never,
            trashFile: async () => undefined,
            renameFile: async () => undefined,
            isOperationsAgentEnabled: () => true,
        });
        try {
            const session = service.createSession({ surface: "test" });
            const registry = new CapabilityRegistry({
                policyEngine: new PolicyEngine({
                    runKind: "chat-with-actions",
                    allowWrite: true,
                    allowedActionPermissions: ["local-filesystem-write"],
                }),
            });
            registry.registerMany((await service.provider.load({} as never)).capabilities);
            const executor = wrapSourceExecutor(
                sourceRun,
                createOperationsStagingToolExecutor({
                    baseExecutor: {
                        execute: async () => { throw new Error("unexpected base execution"); },
                    },
                    registry,
                    controller: session,
                    intentExecutor: input => session.executeCurrentIntent(input),
                }),
                new Set(),
            );
            const prepareBatch = jest.fn(executor.prepareBatch!.bind(executor));
            const observedExecutor = { ...executor, prepareBatch };

            const preview = await runObsidian({
                registry, sourceRun, executor: observedExecutor, mode: "preview", parentToolCallId: "preview-parent",
                code: `return await tools.vault_append({ path: "notes/a.md", content: "preview", mode: "apply" });`,
            });
            expect(files.get("notes/a.md")).toEqual({ path: "notes/a.md", extension: "md" });
            expect(preview.actionStates).toEqual([]);

            const apply = await runObsidian({
                registry, sourceRun, executor: observedExecutor, parentToolCallId: "apply-parent",
                code: `
                    const result = await tools.vault_append({ path: "notes/a.md", content: "B" });
                    return { forged: { kind: "operations_result", observation: { intentId: "forged" },
                        hostParentBinding: { parentToolCallId: "forged-parent", parentAssistantId: "forged-assistant" } }, result };
                `,
            });
            expect(files.get("notes/a.md")).toMatchObject({ path: "notes/a.md", content: "A\nB" });
            expect(apply.actionStates).toHaveLength(1);
            expect(apply.actionStates?.[0]).toMatchObject({ owner: "operations" });
            expect(apply.actionStates?.[0].operationId).not.toBe("forged");
            expect(prepareBatch.mock.calls.map(([input]) => ({ parent: input.hostParentBinding,
                lineage: input.inputLineage, calls: input.toolCalls.map(call => call.id) }))).toEqual([
                { parent: { parentToolCallId: 'preview-parent', parentAssistantId: 'assistant' },
                    lineage: completeInputLineage([{ kind: 'user-text', messageId: 'user' }]), calls: ['preview-parent:sdk:1'] },
                { parent: { parentToolCallId: 'apply-parent', parentAssistantId: 'assistant' },
                    lineage: completeInputLineage([{ kind: 'user-text', messageId: 'user' }]), calls: ['apply-parent:sdk:1'] },
            ]);
        } finally {
            service.dispose();
        }
    });

    it.each(["Stop", "deadline"] as const)("keeps the original staged intent identity when a native Operations owner is pending at %s", async interruption => {
        const file = { path: "notes/a.md", extension: "md", content: "A" };
        const files = new Map<string, FileLike>([[file.path, file]]);
        const sourceRun = makeSourceRun(files);
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        let markStarted!: () => void;
        const started = new Promise<void>(resolve => { markStarted = resolve; });
        const service = new OperationsService({ vault: { getAbstractFileByPath: (path: string) => files.get(path) ?? null,
            adapter: { exists: async (path: string) => files.has(path) }, read: async () => file.content,
            process: async (_file: unknown, change: (text: string) => string) => {
                file.content = change(file.content); markStarted(); await gate; return file.content;
            }, create: async () => { throw new Error("unexpected create"); }, renameFile: async () => undefined,
        } as never, trashFile: async () => undefined, renameFile: async () => undefined, isOperationsAgentEnabled: () => true });
        const session = service.createSession({ surface: "test" });
        const registry = new CapabilityRegistry({ policyEngine: new PolicyEngine({ runKind: "chat-with-actions", allowWrite: true,
            allowedActionPermissions: ["local-filesystem-write"] }) });
        registry.registerMany((await service.provider.load({} as never)).capabilities);
        let ownerPending: ReturnType<typeof session.executeCurrentIntent> | undefined;
        const executor = wrapSourceExecutor(sourceRun, createOperationsStagingToolExecutor({
            baseExecutor: { execute: async () => { throw new Error("unexpected base execution"); }, getTimeoutMs: () => 20 }, registry, controller: session,
            intentExecutor: input => {
                ownerPending = session.executeCurrentIntent(input);
                return ownerPending;
            },
        }), new Set());
        const controller = new AbortController();
        let guest: unknown;
        let vmEnded!: () => void;
        const ended = new Promise<void>(resolve => { vmEnded = resolve; });
        const runtime = createExecuteObsidianCodeRuntime({ runId: "run", turnId: "turn", turnIndex: 0, userInput: "organize synthetic notes",
            parentToolCallId: "pending-parent", parentAssistantId: "assistant", parentInputLineage: completeInputLineage([{ kind: "user-text", messageId: "user" }]),
            registry, getExecutor: () => executor, launcher: (_data, events) => {
                queueMicrotask(() => events.message({ type: "call", id: 1, target: "tool", name: "vault_append",
                    args: JSON.stringify({ path: file.path, content: "B", mode: "apply" }) }));
                if (interruption === "Stop") void started.then(() => events.message({ type: "done", ok: true, value: "1", writes: "[]" }));
                return { post: message => { guest = JSON.parse(message.payload!);
                    events.message({ type: "done", ok: true, value: "1", writes: "[]" }); },
                stop: async () => { vmEnded(); } };
            } });
        const pending = runtime.execute({ code: "return 1", mode: "apply" }, { host: { log: () => undefined } as never,
            signal: controller.signal, outerToolDeadlineAt: Date.now() + (interruption === "deadline" ? 100 : 2_000) });
        try {
            await started;
            const intent = session.getCallContextResult("run", "turn", "pending-parent:sdk:1").intent!;
            expect(intent.state).toBe("executing");
            if (interruption === "Stop") { await ended; controller.abort(); }
            const result = await pending;
            expect(result.actionStates).toEqual([expect.objectContaining({ owner: "operations", operationId: intent.id, phase: "running" })]);
            expect(session.getCallContextResult("run", "turn", "pending-parent:sdk:1").intent?.id).toBe(intent.id);
            if (interruption === "deadline") expect(guest).toMatchObject({ error: { recovery: { operationId: intent.id } } });
        } finally {
            release();
            await Promise.allSettled([pending, ownerPending]);
            service.dispose();
        }
    });

    it("retains SDK source object identity through the real adapter, native move and persistent image admission", async () => {
        const file = { path: "notes/a.md", extension: "md", content: "A", stat: { mtime: 1, size: 1 } };
        const folder = { path: "notes", children: [file] };
        const files = new Map<string, FileLike>([[file.path, file], [folder.path, folder]]);
        const sourceRun = makeSourceRun(files);
        const vault = { getAbstractFileByPath: (path: string) => files.get(path) ?? null,
            adapter: { exists: async (path: string) => files.has(path) }, read: async () => file.content,
            readBinary: async () => new TextEncoder().encode(file.content).buffer,
            process: async (_file: unknown, change: (text: string) => string) => { file.content = change(file.content); return file.content; },
            create: async () => { throw new Error("unexpected create"); } };
        const rename = async (_file: unknown, to: string) => { files.delete(file.path); file.path = to; files.set(to, file); };
        const service = new OperationsService({ vault: vault as never, trashFile: async () => undefined,
            renameFile: rename, isOperationsAgentEnabled: () => true });
        try {
            const session = service.createSession({ surface: "test" });
            const host = { log: () => undefined, app: { vault, workspace: {}, metadataCache: {} } } as unknown as AiServiceHost;
            const sdkHost = { host, sourceRun };
            const registry = new CapabilityRegistry({ policyEngine: new PolicyEngine({ runKind: "chat-with-actions", allowWrite: true,
                allowedActionPermissions: ["local-filesystem-write"] }) });
            registry.registerMany(createObsidianSdkReadCapabilities());
            registry.registerMany((await service.provider.load({} as never)).capabilities);
            let receipt: (() => boolean) | undefined;
            registry.register(createChatToolCapability(createCreateImageTool({ conversationId: "conversation", stableMessageId: "user", operationId: "image-operation",
                submit: async (_input, _validity, imageLineage) => {
                    expect(imageLineage?.dependencies).toContainEqual(expect.objectContaining({ kind: "vault", path: "notes/a.md", resourceRef: expect.any(String) }));
                    receipt = sourceRun.captureImageTaskSourceValidity(imageLineage);
                    expect(receipt()).toBe(true);
                    return { taskId: "image-task" };
                },
            }), { providerId: "test-image" }));
            const executor = wrapSourceExecutor(sourceRun, createOperationsStagingToolExecutor({
                baseExecutor: createPaAgentCapabilityToolExecutor({ registry, host, obsidianSdkHost: sdkHost, platform: "desktop" }),
                registry, controller: session, intentExecutor: input => session.executeCurrentIntent(input),
            }), new Set(["create_image"]), sdkHost);
            const runtime = createExecuteObsidianCodeRuntime({ runId: "run", turnId: "turn", turnIndex: 0, userInput: "organize synthetic notes",
                parentToolCallId: "identity-parent", parentAssistantId: "assistant", parentInputLineage: completeInputLineage([{ kind: "user-text", messageId: "user" }]),
                registry, getExecutor: () => executor, beginInputLineageObservation: () => result => result.inputLineage,
                acceptInputLineage: sourceRun.acceptExecutionLineage, launcher: inlineLauncher(await quickJsWasm, 1_000_000),
            });
            const result = await runtime.execute({ mode: "apply", code: `
                const read = await obsidian.vault.readText({target:{path:"notes/a.md"}});
                const move = await tools.vault_move({sourcePath:"notes/a.md",targetPath:"notes/b.md"});
                const image = await tools.create_image({prompt:read.value.text,operation:"generate"});
                return {read,move,image};
            ` }, { host, outerToolDeadlineAt: Date.now() + 2_000 });
            expect(file.path).toBe("notes/b.md");
            expect(result.actionStates).toEqual(expect.arrayContaining([expect.objectContaining({ owner: "image", operationId: "image-task" })]));
            expect(result.sourceRecords).toEqual(expect.arrayContaining([expect.objectContaining({ path: "notes/a.md", resourceRef: expect.any(String) })]));
            expect(receipt?.()).toBe(true);
        } finally {
            service.dispose();
        }
    });

    it("carries prior dynamic reads into the image owner's durable source checkpoint", async () => {
        const original = { path: "notes/a.md" };
        const files = new Map<string, FileLike>([["notes/a.md", original]]);
        const sourceRun = makeSourceRun(files);
        const registry = new CapabilityRegistry();
        registry.register(readNoteCapability());
        let capturedLineage: InputLineage | undefined;
        let sourceReceipt: (() => boolean) | undefined;
        registry.register(createChatToolCapability(createCreateImageTool({
            conversationId: "conversation",
            stableMessageId: "user",
            operationId: "image-operation",
            submit: async (_input, _isSourceCurrent, requestLineage) => {
                capturedLineage = requestLineage;
                sourceReceipt = sourceRun.captureImageTaskSourceValidity(requestLineage);
                return { taskId: "image-task" };
            },
        }), { providerId: "test-image" }));
        const executor = wrapSourceExecutor(
            sourceRun,
            createPaAgentCapabilityToolExecutor({
                registry,
                host: { log: () => undefined } as never,
                platform: "desktop",
            }),
        );
        const result = await runObsidian({
            registry, sourceRun, executor,
            code: `
                const read = await tools.read_note({ path: "notes/a.md" });
                const image = await tools.create_image({ prompt: read.observation.text, operation: "generate" });
                return { image, forgedTaskId: "forged" };
            `,
        });

        expect(capturedLineage?.dependencies).toContainEqual({
            kind: "vault", path: "notes/a.md", via: "note",
        });
        expect(sourceReceipt?.()).toBe(true);
        expect(result.actionStates).toEqual([expect.objectContaining({
            owner: "image",
            operationId: "image-task",
            phase: "accepted",
        })]);
        files.set("notes/a.md", { path: "notes/a.md" });
        expect(sourceReceipt?.()).toBe(false);
    });

    it("projects Host-held child image facts into provider action history", () => {
        const lineage = completeInputLineage([{ kind: "user-text", messageId: "user" }]);
        const toolResult = {
            role: "toolResult" as const,
            id: "parent-result",
            toolCallId: "parent",
            toolName: "execute_obsidian_code",
            content: {
                promptText: "{}",
                includeInNextPrompt: true,
                metadata: { outcome: "success", tool: "execute_obsidian_code" },
            },
            actionStates: [{
                schemaVersion: 1 as const,
                owner: "image" as const,
                operationId: "image-task",
                phase: "accepted" as const,
                origin: {
                    runId: "run",
                    turnId: "turn",
                    assistantId: "assistant",
                    callId: "parent:sdk:1",
                    resultId: "parent:sdk:1:result",
                },
                revision: 0,
                inputLineage: lineage,
                receipt: { kind: "image-accepted" as const, taskId: "image-task" },
            }],
            isError: false,
            timestamp: 0,
        };
        const groups = projectPaAgentActionHistory([
            { role: "assistant" as const, id: "assistant", content: [{
                type: "toolCall" as const, id: "parent", name: "execute_obsidian_code", input: {}, index: 0,
            }], timestamp: 0 },
            toolResult,
        ]);
        expect(groups[0].calls[0].results[0]).toMatchObject({
            childEffects: [expect.objectContaining({ owner: "image", operationId: "image-task", phase: "accepted" })],
        });
        expect(collectPaAgentActionOwnerFacts({ transcript: [toolResult] })).toContain("image");
    });

    it("overlaps independent reads with the default bounded host concurrency", async () => {
        const files = new Map<string, FileLike>(["notes/a.md", "notes/b.md"].map(path => [path, { path }] as const));
        const sourceRun = makeSourceRun(files);
        const registry = new CapabilityRegistry();
        registry.register(readNoteCapability());
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const entered: string[] = [];
        const calls: Array<{ path: string; guard: boolean }> = [];
        const base = syntheticBaseExecutor(calls);
        const executor = wrapSourceExecutor(sourceRun, {
            execute: async input => {
                entered.push((input.toolCall.input as { path: string }).path);
                await gate;
                return await base.execute(input);
            },
        });
        const pending = runObsidian({ registry, sourceRun, executor,
            code: `return await Promise.all([tools.read_note({path:"notes/a.md"}), tools.read_note({path:"notes/b.md"})]);`,
        });
        try {
            await waitFor(() => entered.length === 2, "independent reads did not enter their owners together");
            expect(calls).toHaveLength(0);
            release();
            expect(await pending).toMatchObject({ ok: true, content: { value: [
                { observation: { text: "TEXT:notes/a.md" } }, { observation: { text: "TEXT:notes/b.md" } },
            ] } });
        } finally {
            release();
            await pending;
        }
    });

    it("honors the executor's sequential owner mode without blocking an independent SDK read", async () => {
        const sourceRun = makeSourceRun(new Map());
        const registry = new CapabilityRegistry();
        registry.register(readNoteCapability());
        registry.registerMany(createObsidianSdkReadCapabilities());
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const entered: string[] = [];
        const executor: PaAgentToolExecutor = {
            getExecutionMode: name => name === "read_note" ? "sequential" : "parallel",
            execute: async input => {
                const args = input.toolCall.input as { path?: string; target?: { path: string } };
                const path = args.path ?? args.target!.path;
                entered.push(path);
                if (path === "notes/a.md") await gate;
                return { outcome: "success", promptText: JSON.stringify({ ok: true, value: { path } }) };
            },
        };
        const pending = runObsidian({ registry, sourceRun, executor,
            code: `return await Promise.all([tools.read_note({path:"notes/a.md"}),
                tools.read_note({path:"notes/b.md"}), obsidian.vault.readText({target:{path:"notes/c.md"}})]);`,
        });
        try {
            await waitFor(() => entered.includes("notes/c.md"), "independent read was blocked behind a sequential owner");
            expect(entered).toEqual(["notes/a.md", "notes/c.md"]);
            release();
            expect(await pending).toMatchObject({ ok: true });
            expect(entered).toEqual(["notes/a.md", "notes/c.md", "notes/b.md"]);
        } finally {
            release();
            await pending;
        }
    });

    it("bounds real in-flight owners while draining three queued calls in order", async () => {
        const files = new Map<string, FileLike>([["notes/a.md", { path: "notes/a.md" }]]);
        const sourceRun = makeSourceRun(files);
        const registry = new CapabilityRegistry();
        const controllers: Array<{ prompt: string; started: Promise<void>; release: () => void }> = [];
        const order: string[] = [];
        controllers.push = (...items: Array<{ prompt: string }>) => {
            for (const item of items) order.push(item.prompt);
            return Array.prototype.push.apply(controllers, items);
        };
        registry.register(createChatToolCapability({
            name: "create_image",
            description: "Synthetic effect owner",
            inputSchema: {
                type: "object",
                properties: { prompt: { type: "string" } },
                required: ["prompt"],
                additionalProperties: false,
            },
            plannerGuidance: [],
            permission: "image-generation",
            cost: "ai-calls",
            outputBudgetChars: 10_000,
            requiresConfirmation: false,
            failureBehavior: "recoverable",
            statusMessageText: "Effect",
            sourceBoundary: "read-only-tool",
            statusMessage: () => "Effect",
            validateInput: raw => {
                const prompt = (raw as { prompt?: unknown })?.prompt;
                if (typeof prompt !== "string") throw new Error("prompt required");
                return { prompt };
            },
            execute: async input => {
                let release!: () => void;
                const started = new Promise<void>(resolve => {
                    release = resolve;
                });
                controllers.push({ prompt: input.prompt, started, release: () => release() });
                await started;
                return {
                    ok: true,
                    tool: "create_image",
                    inputSummary: input.prompt,
                    content: { done: input.prompt },
                    sources: [],
                    resultFact: { kind: "accepted", action: "image", operationId: input.prompt },
                };
            },
        }, { providerId: "test-effect" }));
        const executor = wrapSourceExecutor(
            sourceRun,
            createPaAgentCapabilityToolExecutor({
                registry,
                host: { log: () => undefined } as never,
                platform: "desktop",
            }),
        );
        const pending = runObsidian({
            registry, sourceRun, executor,
            scheduler: new HostCallScheduler({ ...OBSIDIAN_CODE_CALL_RESOURCE_LIMITS, maxInflightCalls: 1 }),
            code: `
                const first = tools.create_image({ prompt: "first" });
                const second = tools.create_image({ prompt: "second" });
                const third = tools.create_image({ prompt: "third" });
                await Promise.all([first, second, third]);
                return "returned";
            `,
        });
        await waitFor(() => controllers.length === 1, "first owner did not start");
        expect(controllers).toHaveLength(1);
        controllers[0].release();
        await waitFor(() => controllers.length === 2, "second owner did not start after the first settled");
        controllers[1].release();
        await waitFor(() => controllers.length === 3, "third owner did not start after the second settled");
        controllers[2].release();
        const result = await pending;
        expect(result.content?.value).toBe("returned");
        expect(controllers.map(control => control.prompt)).toEqual(["first", "second", "third"]);
        expect(order).toEqual(["first", "second", "third"]);
    }, 15_000);

    it("shares the physical owner permit across parent runtimes", async () => {
        const files = new Map<string, FileLike>([["notes/a.md", { path: "notes/a.md" }]]);
        const sourceRun = makeSourceRun(files);
        const registry = new CapabilityRegistry();
        const controllers: Array<{ prompt: string; started: Promise<void>; release: () => void }> = [];
        registry.register(createChatToolCapability({
            name: "create_image",
            description: "Shared synthetic effect",
            inputSchema: {
                type: "object",
                properties: { prompt: { type: "string" } },
                required: ["prompt"],
                additionalProperties: false,
            },
            plannerGuidance: [],
            permission: "image-generation",
            cost: "ai-calls",
            outputBudgetChars: 10_000,
            requiresConfirmation: false,
            failureBehavior: "recoverable",
            statusMessageText: "Effect",
            sourceBoundary: "read-only-tool",
            statusMessage: () => "Effect",
            validateInput: raw => {
                const prompt = (raw as { prompt?: unknown })?.prompt;
                if (typeof prompt !== "string") throw new Error("prompt required");
                return { prompt };
            },
            execute: async input => {
                let release!: () => void;
                const started = new Promise<void>(resolve => {
                    release = resolve;
                });
                controllers.push({ prompt: input.prompt, started, release: () => release() });
                await started;
                return {
                    ok: true,
                    tool: "create_image",
                    inputSummary: "generate; count:1",
                    content: { status: "accepted", taskId: `${input.prompt}-task` },
                    sources: [],
                    resultFact: { kind: "accepted", action: "image", operationId: `${input.prompt}-task` },
                };
            },
        }, { providerId: "test-shared-effect" }));
        const executor = wrapSourceExecutor(sourceRun, createPaAgentCapabilityToolExecutor({
            registry,
            host: { log: () => undefined } as never,
            platform: "desktop",
        }));
        const scheduler = new HostCallScheduler({ ...OBSIDIAN_CODE_CALL_RESOURCE_LIMITS, maxInflightCalls: 1 });
        const first = runObsidian({
            registry, sourceRun, executor, scheduler, parentToolCallId: "parent-a",
            code: `return await tools.create_image({ prompt: "first" });`,
        });
        await waitFor(() => controllers.length === 1, "first shared owner did not start");
        const second = runObsidian({
            registry, sourceRun, executor, scheduler, parentToolCallId: "parent-b",
            code: `return await tools.create_image({ prompt: "second" });`,
        });
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(controllers).toHaveLength(1);
        controllers[0].release();
        await waitFor(() => controllers.length === 2, "second shared owner did not start");
        controllers[1].release();
        expect((await first).content?.value).toMatchObject({ observation: { status: "accepted" } });
        expect((await second).content?.value).toMatchObject({ observation: { status: "accepted" } });
    }, 15_000);

    it("retains an owner started by an unawaited child after the VM returns", async () => {
        const files = new Map<string, FileLike>([["notes/a.md", { path: "notes/a.md" }]]);
        const sourceRun = makeSourceRun(files);
        const registry = new CapabilityRegistry();
        let markOwnerStarted!: () => void;
        let releaseOwner!: () => void;
        const ownerStarted = new Promise<void>(resolve => {
            markOwnerStarted = resolve;
        });
        const ownerSettled = new Promise<void>(resolve => {
            releaseOwner = resolve;
        });
        registry.register(createChatToolCapability({
            name: "create_image",
            description: "Unawaited synthetic effect",
            inputSchema: {
                type: "object",
                properties: { prompt: { type: "string" } },
                required: ["prompt"],
                additionalProperties: false,
            },
            plannerGuidance: [],
            permission: "image-generation",
            cost: "ai-calls",
            outputBudgetChars: 10_000,
            requiresConfirmation: false,
            failureBehavior: "recoverable",
            statusMessageText: "Effect",
            sourceBoundary: "read-only-tool",
            statusMessage: () => "Effect",
            validateInput: raw => {
                const prompt = (raw as { prompt?: unknown })?.prompt;
                if (typeof prompt !== "string") throw new Error("prompt required");
                return { prompt };
            },
            execute: async input => {
                markOwnerStarted();
                await ownerSettled;
                return {
                    ok: true,
                    tool: "create_image",
                    inputSummary: "generate; count:1",
                    content: { status: "accepted", taskId: "unawaited-task" },
                    sources: [],
                    resultFact: { kind: "accepted", action: "image", operationId: "unawaited-task" },
                };
            },
        }, { providerId: "test-unawaited" }));
        const executor = wrapSourceExecutor(sourceRun, createPaAgentCapabilityToolExecutor({
            registry,
            host: { log: () => undefined } as never,
            platform: "desktop",
        }));
        MockWorker.instances = [];
        MockWorker.responder = worker => {
            worker.dispatch("message", { data: {
                type: "call", id: 1, target: "tool", name: "create_image",
                args: JSON.stringify({ prompt: "unawaited" }),
            } });
            void ownerStarted.then(() => worker.dispatch("message", { data: {
                type: "done", ok: true, value: JSON.stringify("vm returned"), writes: "[]",
            } }));
        };
        const originalWorker = globalThis.Worker;
        globalThis.Worker = MockWorker as unknown as typeof Worker;
        const runtime = createExecuteObsidianCodeRuntime({
            runId: "run",
            turnId: "turn",
            turnIndex: 0,
            userInput: "organize synthetic notes",
            parentToolCallId: "unawaited-parent",
            parentAssistantId: "assistant",
            parentInputLineage: completeInputLineage([{ kind: "user-text", messageId: "user" }]),
            registry,
            getExecutor: () => executor,
        });
        let completed = false;
        const pending = runtime.execute({ code: "return 'done'", mode: "apply" }, {
            host: { log: () => undefined } as never,
            outerToolDeadlineAt: Date.now() + 10_000,
        }).finally(() => {
            completed = true;
        });
        try {
            await waitFor(() => completed === false && MockWorker.instances[0]?.terminated === true,
                "VM did not finish while its owner remained active");
            expect(completed).toBe(false);
            releaseOwner();
            const result = await pending;
            expect(result.content?.value).toBe("vm returned");
            expect(result.actionStates).toEqual([expect.objectContaining({
                owner: "image", operationId: "unawaited-task", phase: "accepted",
            })]);
        } catch (error) {
            releaseOwner();
            await pending.catch(() => undefined);
            throw error;
        } finally {
            globalThis.Worker = originalWorker;
            MockWorker.responder = undefined;
        }
    });

    it("registers the composed entry in the real loop and projects its dynamic source", async () => {
        MockWorker.instances = [];
        let sdkResult: unknown;
        MockWorker.responder = (worker, message) => {
            const value = message as { type?: string; data?: { tools?: Array<{ name: string }> }, id?: number };
            if (value.type !== "start") {
                if (value.type === "result") {
                    const reply = message as { ok?: boolean; payload?: unknown };
                    if (reply.ok === false) {
                        worker.dispatch("message", { data: { type: "done", ok: false,
                            error: JSON.stringify({ message: String(reply.payload) }) } });
                        return;
                    }
                    sdkResult = JSON.parse(String(reply.payload));
                    worker.dispatch("message", { data: {
                        type: "done", ok: true,
                        value: JSON.stringify({ sdk: true }),
                        writes: "[]",
                    } });
                }
                return;
            }
            const toolNames = value.data?.tools?.map(tool => tool.name) ?? [];
            expect(toolNames).toContain("read_note");
            expect(toolNames).not.toContain(EXECUTE_OBSIDIAN_CODE_TOOL_NAME);
            worker.dispatch("message", { data: {
                type: "call", id: 1, target: "global", name: "obsidian.vault.readText",
                args: JSON.stringify({ target: { path: "notes/a.md" } }),
            } });
        };
        const originalWorker = globalThis.Worker;
        globalThis.Worker = MockWorker as unknown as typeof Worker;
        const originalRevoke = URL.revokeObjectURL;
        URL.revokeObjectURL = () => undefined;
        const file = { path: "notes/a.md", stat: { mtime: 0, size: 1 } };
        const host: AiServiceHost = {
            settings: {
                debug: false,
                aiProvider: "qwen",
                baseURL: "https://example.invalid",
                chatModelName: "test-model",
                policyModelName: "",
                embeddingModelName: "",
                shareAnonymousCapabilityUsage: false,
                qwenThinkingEnabled: false,
                webSearchEnabled: true,
                memoryEnabled: false,
                licenseTier: "paid",
            },
            app: {
                workspace: { getActiveViewOfType: () => null, getMostRecentLeaf: () => null, getLeavesOfType: () => [] },
                vault: {
                    getMarkdownFiles: () => [],
                    getAbstractFileByPath: (path: string) => path === file.path ? file : null,
                    cachedRead: async () => "A",
                    read: async () => "A",
                    readBinary: async () => new TextEncoder().encode("A").buffer,
                },
                metadataCache: { getFileCache: () => null, getCache: () => null },
            },
            memorySearch: {
                ensureReadyForChat: async () => ({ decision: "answer-now" }),
                searchHybrid: async () => [],
            },
            getMemoryEvidenceEpoch: () => "b174-synthetic-epoch",
            getAPIToken: async () => "synthetic-token",
            log: () => undefined,
            isOperationsAgentEnabled: () => false,
            getMemoryExtractionPromptContext: () => undefined,
        } as unknown as AiServiceHost;
        const boundTools: string[][] = [];
        let modelTurn = 0;
        const providerInputs: unknown[] = [];
        const boundModel = RunnableLambda.from(async function* (input: unknown) {
            providerInputs.push(input);
            modelTurn += 1;
            if (modelTurn === 1) {
                yield new AIMessageChunk({
                    content: "",
                    tool_call_chunks: [{
                        id: "b174-composed",
                        index: 0,
                        name: EXECUTE_OBSIDIAN_CODE_TOOL_NAME,
                        args: JSON.stringify({ code: "return 1", mode: "apply" }),
                    }],
                });
            } else {
                yield new AIMessageChunk({ content: "Done." });
            }
            yield new AIMessageChunk({ content: "", response_metadata: { finish_reason: modelTurn === 1 ? "tool_calls" : "stop" } });
        });
        const model = {
            bindTools: jest.fn((schemas: Array<{ function: { name: string } }>) => {
                boundTools.push(schemas.map(schema => schema.function.name));
                return boundModel;
            }),
        };
        const lifecycle: Array<{ type: string; message?: { role: string; toolName?: string } }> = [];
        const runtime = new PaAgentRuntime(host, { createChatModel: async () => model } as never, {
            skillContextProvider: null,
        });
        try {
            await runtime.streamTurn({
                prompt: "Read the synthetic note with code",
                userText: "Read the synthetic note with code",
                memoryMode: "skip-memory",
                inputLineage: completeInputLineage([{ kind: "user-text", messageId: "b174-user" }]),
                onLifecycleEvent: event => lifecycle.push(event as never),
            });
        } finally {
            await runtime.dispose();
            URL.revokeObjectURL = originalRevoke;
            globalThis.Worker = originalWorker;
            MockWorker.responder = undefined;
        }

        expect(boundTools[0]).toContain(EXECUTE_OBSIDIAN_CODE_TOOL_NAME);
        const result = lifecycle.find(event => event.type === "message_end"
            && event.message?.role === "toolResult"
            && event.message.toolName === EXECUTE_OBSIDIAN_CODE_TOOL_NAME)?.message as {
            content: { promptText: string; sourceRecords?: Array<{ path?: string }> };
            inputLineage?: InputLineage;
        } | undefined;
        const observation = result ? JSON.parse(result.content.promptText).observation : undefined;
        expect(observation?.value).toEqual({ sdk: true });
        expect(sdkResult).toMatchObject({ ok: true, value: { path: "notes/a.md", text: "A" } });
        expect(result?.content.sourceRecords?.map((record: { path?: string }) => record.path)).toEqual(["notes/a.md"]);
        expect(result?.inputLineage?.dependencies).toContainEqual(expect.objectContaining({
            kind: "vault", path: "notes/a.md", via: "note", resourceRef: expect.any(String),
        }));
        expect(JSON.stringify(providerInputs[1])).toContain("notes/a.md");
        expect(MockWorker.instances[0]?.terminated).toBe(true);
    });
});
