import { HumanMessage } from "@langchain/core/messages";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Platform, requestUrl } from "obsidian";

import { AIUtils, DASHSCOPE_COMPATIBLE_BASE_URL } from "../src/ai-services/ai-utils";
import {
    createProviderRequestScope,
    obsidianFetch,
} from "../src/ai-services/obsidian-fetch";
import { PaAgentLoop } from "../src/ai-services/pa-agent-loop";
import {
    PaAgentRuntime,
    streamWithInvokeFallback,
} from "../src/ai-services/pa-agent-runtime";
import { resolveRequiredCapabilityClassification } from "../src/ai-services/pa-agent-required-capability-policy";
import { createHeadingAwareMarkdownChunks } from "../src/vss/markdown-chunker";

jest.mock("obsidian");

const mockedRequestUrl = requestUrl as unknown as jest.MockedFunction<
    (request: unknown) => Promise<unknown>
>;

const encode = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer;

const makeHost = (baseURL = DASHSCOPE_COMPATIBLE_BASE_URL) => ({
    settings: {
        aiProvider: "qwen",
        chatModelName: "deepseek-v4-pro",
        embeddingModelName: "text-embedding-v4",
        baseURL,
    },
    getAPIToken: jest.fn(async () => "test-token"),
    log: jest.fn(),
});

const responseFixture = (body: string, contentType: string) => ({
    status: 200,
    headers: { "content-type": contentType },
    arrayBuffer: encode(body),
    text: body,
    json: null,
});

const sse = (...events: Array<Record<string, unknown>>): string => (
    `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`
);

const completionChunk = (
    delta: Record<string, unknown>,
    finishReason: string | null,
    usage?: Record<string, number>,
) => ({
    id: "chatcmpl-ios-transport",
    object: "chat.completion.chunk",
    created: 1,
    model: "deepseek-v4-pro",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(usage ? { usage } : {}),
});

const flushMicrotasks = async (times = 20): Promise<void> => {
    for (let index = 0; index < times; index++) await Promise.resolve();
};

const makeRuntimeHost = (overrides: {
    policyModelName?: string;
    searchResults?: unknown[];
    latestMarkdown?: string;
} = {}) => {
    const latestMarkdown = overrides.latestMarkdown ?? "# Memory\n\nUseful current evidence.";
    const latestPath = "notes/memory.md";
    const latestMtime = 1_000;
    return {
        settings: {
            debug: false,
            aiProvider: "qwen",
            baseURL: DASHSCOPE_COMPATIBLE_BASE_URL,
            chatModelName: "deepseek-v4-pro",
            policyModelName: overrides.policyModelName ?? "",
            embeddingModelName: "text-embedding-v4",
            shareAnonymousCapabilityUsage: false,
            skillContextEnabled: false,
            enabledSkillIds: [],
            qwenThinkingEnabled: false,
            webSearchEnabled: false,
            licenseTier: "free",
            memoryEnabled: true,
            retrievalOptimizationFlags: {
                lexicalProfile: false,
                strictReranker: true,
                graphPpr: false,
                relaxedRecovery: false,
            },
            operationsAgentEnabled: false,
            operationsProactiveSaveSuggestionsEnabled: false,
            operationsAuditIncludeContent: false,
            operationsAuditRetentionDays: 30,
            statisticsVaultId: "test-vault",
        },
        app: {
            workspace: {
                getActiveViewOfType: jest.fn(() => null),
                getMostRecentLeaf: jest.fn(() => null),
                getLeavesOfType: jest.fn(() => []),
            },
            vault: {
                getMarkdownFiles: jest.fn(() => []),
                getAbstractFileByPath: jest.fn(() => null),
                cachedRead: jest.fn(async () => ""),
            },
            metadataCache: {
                getFileCache: jest.fn(() => null),
                resolvedLinks: {},
                unresolvedLinks: {},
            },
        },
        memorySearch: {
            ensureReadyForChat: jest.fn(async () => ({ decision: "use-memory" as const })),
            searchHybrid: jest.fn(async () => overrides.searchResults ?? []),
            getChunksByPath: jest.fn(async () => []),
            rankGraphCandidates: jest.fn(async () => ({
                requestId: "",
                runEpoch: "",
                sourceEpoch: "",
                paths: [],
            })),
            cancelGraphCandidateRank: jest.fn(),
            getPathEvidenceGenerations: jest.fn(async (paths: string[]) => ({
                sourceEpoch: "source-epoch-1",
                paths: paths.map((path) => ({
                    path,
                    current: true,
                    reason: "current",
                    generation: `generation:${path}`,
                })),
            })),
        },
        getMemoryEvidenceEpoch: jest.fn(() => "boundary-epoch-1"),
        isDataBoundaryAllowedPath: jest.fn(() => true),
        readLatestMemorySource: jest.fn(async (path: string) => path === latestPath ? ({
            path,
            markdown: latestMarkdown,
            mtime: latestMtime,
            size: latestMarkdown.length,
        }) : null),
        getAPIToken: jest.fn(async () => "test-token"),
        log: jest.fn(),
        isOperationsAgentEnabled: false,
        getMemoryExtractionPromptContext: jest.fn(() => undefined),
    };
};

describe("iOS DashScope chat transport", () => {
    beforeEach(() => {
        mockedRequestUrl.mockReset();
        Platform.isDesktop = true;
        Platform.isMobile = false;
        Platform.isIosApp = false;
    });

    it("routes requested native ChatOpenAI calls through requestUrl only for iOS DashScope", async () => {
        Platform.isDesktop = false;
        Platform.isMobile = true;
        Platform.isIosApp = true;

        const iosDashScopeModel = await new AIUtils(makeHost()).createChatModel(0, {
            transport: "native",
        });
        const iosOpenAIModel = await new AIUtils(makeHost("https://api.openai.com/v1")).createChatModel(0, {
            transport: "native",
        });

        expect(iosDashScopeModel.clientConfig.fetch).toBe(obsidianFetch);
        expect(iosOpenAIModel.clientConfig.fetch).toBeUndefined();

        Platform.isDesktop = true;
        Platform.isMobile = false;
        Platform.isIosApp = false;
        const desktopDashScopeModel = await new AIUtils(makeHost()).createChatModel(0, {
            transport: "native",
        });

        expect(desktopDashScopeModel.clientConfig.fetch).toBeUndefined();
    });

    it("completes an iOS DashScope invoke through the proven requestUrl bridge", async () => {
        Platform.isDesktop = false;
        Platform.isMobile = true;
        Platform.isIosApp = true;
        mockedRequestUrl.mockResolvedValue(responseFixture(JSON.stringify({
            id: "chatcmpl-ios-invoke",
            object: "chat.completion",
            created: 1,
            model: "deepseek-v4-pro",
            choices: [{
                index: 0,
                message: { role: "assistant", content: "READY" },
                finish_reason: "stop",
            }],
            usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
        }), "application/json"));

        const model = await new AIUtils(makeHost()).createChatModel(0, { transport: "native" });
        const response = await model.invoke([new HumanMessage("Reply READY")]);

        expect(response.content).toBe("READY");
        expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
        const request = mockedRequestUrl.mock.calls[0][0] as { body: string };
        expect(JSON.parse(request.body)).toMatchObject({
            model: "deepseek-v4-pro",
            stream: false,
        });
    });

    it("completes the shared PA/Pagelet stream adapter with empty DashScope tool ids and usage", async () => {
        Platform.isDesktop = false;
        Platform.isMobile = true;
        Platform.isIosApp = true;
        mockedRequestUrl.mockResolvedValue(responseFixture(sse(
            completionChunk({
                role: "assistant",
                content: "",
                tool_calls: [{
                    index: 0,
                    id: "",
                    type: "function",
                    function: { name: "search_memory", arguments: '{"query":' },
                }],
            }, null),
            completionChunk({
                tool_calls: [{
                    index: 0,
                    id: "",
                    type: "function",
                    function: { name: "", arguments: '"PFS-731"}' },
                }],
            }, null),
            completionChunk({}, "tool_calls", {
                prompt_tokens: 10,
                completion_tokens: 2,
                total_tokens: 12,
            }),
        ), "text/event-stream"));

        const model = await new AIUtils(makeHost()).createChatModel(0, { transport: "native" });
        const runnable = model.bindTools([{
            type: "function",
            function: {
                name: "search_memory",
                description: "Search Memory",
                parameters: {
                    type: "object",
                    properties: { query: { type: "string" } },
                    required: ["query"],
                    additionalProperties: false,
                },
            },
        }]);
        const chunks = [];
        for await (const chunk of streamWithInvokeFallback({
            chain: runnable,
            input: [new HumanMessage("Find PFS-731")],
        })) {
            chunks.push(chunk);
        }

        const toolDeltas = chunks.filter((chunk) => chunk.type === "toolcall_delta");
        expect(toolDeltas).toEqual([
            {
                type: "toolcall_delta",
                name: "search_memory",
                index: 0,
                argsText: '{"query":',
            },
            {
                type: "toolcall_delta",
                name: "search_memory",
                index: 0,
                argsText: '"PFS-731"}',
            },
        ]);
        expect(chunks).toContainEqual({
            type: "diagnostic",
            diagnostic: {
                type: "provider_usage",
                usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
            },
        });
        expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
    });

    it("executes an empty-id tool call and completes the next PA turn without an idle timeout", async () => {
        Platform.isDesktop = false;
        Platform.isMobile = true;
        Platform.isIosApp = true;
        mockedRequestUrl
            .mockResolvedValueOnce(responseFixture(sse(
                completionChunk({
                    role: "assistant",
                    content: "",
                    tool_calls: [{
                        index: 0,
                        id: "",
                        type: "function",
                        function: { name: "search_memory", arguments: '{"query":"PFS-731"}' },
                    }],
                }, null),
                completionChunk({}, "tool_calls", {
                    prompt_tokens: 10,
                    completion_tokens: 2,
                    total_tokens: 12,
                }),
            ), "text/event-stream"))
            .mockResolvedValueOnce(responseFixture(sse(
                completionChunk({ role: "assistant", content: "READY" }, null),
                completionChunk({}, "stop", {
                    prompt_tokens: 15,
                    completion_tokens: 1,
                    total_tokens: 16,
                }),
            ), "text/event-stream"));

        const aiUtils = new AIUtils(makeHost());
        const transport = aiUtils.resolveChatTransport("native");
        const model = await aiUtils.createChatModel(0, { transport: "native" });
        const runnable = model.bindTools([{
            type: "function",
            function: {
                name: "search_memory",
                description: "Search Memory",
                parameters: {
                    type: "object",
                    properties: { query: { type: "string" } },
                    required: ["query"],
                    additionalProperties: false,
                },
            },
        }]);
        const executedToolCalls: Array<{ id: string; name: string; input: unknown }> = [];
        const ids = new Map<string, number>();
        const loop = new PaAgentLoop({
            runId: "run-ios-dashscope",
            userInput: "Find PFS-731",
            model: {
                stream: async function* (input) {
                    yield* streamWithInvokeFallback({
                        chain: runnable,
                        input: [new HumanMessage(input.userInput)],
                        signal: input.signal,
                    });
                },
            },
            toolExecutor: {
                execute: async ({ toolCall }) => {
                    executedToolCalls.push({
                        id: toolCall.id,
                        name: toolCall.name,
                        input: toolCall.input,
                    });
                    return { outcome: "success", promptText: "Memory evidence" };
                },
            },
            hostPolicy: {
                afterTurn: (summary) => summary.status === "tool_results_ready"
                    ? { action: "continue", reason: "tool_results_ready" }
                    : { action: "stop", status: "completed", reason: "done" },
            },
            providerResponseDelivery: transport.responseDelivery,
            createId: (prefix) => {
                const next = (ids.get(prefix) ?? 0) + 1;
                ids.set(prefix, next);
                return `${prefix}-${next}`;
            },
        });

        const result = await loop.run();

        expect(result.status).toBe("completed");
        expect(result.committedFinalText).toBe("READY");
        expect(result.turns).toHaveLength(2);
        expect(result.transcript
            .filter((message) => message.role === "assistant")
            .map((message) => message.stopReason))
            .toEqual(["tool_calls", "stop"]);
        expect(result.turns.flatMap((turn) => turn.diagnostics)).not.toContainEqual(
            expect.objectContaining({ type: "assistant_idle_timeout" }),
        );
        expect(executedToolCalls).toEqual([{
            id: "tool_call-1",
            name: "search_memory",
            input: { query: "PFS-731" },
        }]);
        expect(mockedRequestUrl).toHaveBeenCalledTimes(2);
    });

    it("lets a buffered iOS response exceed the incremental idle limit while preserving the hard deadline", async () => {
        jest.useFakeTimers();
        try {
            Platform.isDesktop = false;
            Platform.isMobile = true;
            Platform.isIosApp = true;
            let markRequestStarted!: () => void;
            const requestStarted = new Promise<void>((resolve) => {
                markRequestStarted = resolve;
            });
            mockedRequestUrl.mockImplementation(() => {
                markRequestStarted();
                return new Promise((resolve) => {
                    setTimeout(() => resolve(responseFixture(sse(
                        completionChunk({ role: "assistant", content: "READY" }, null),
                        completionChunk({}, "stop", {
                            prompt_tokens: 3,
                            completion_tokens: 1,
                            total_tokens: 4,
                        }),
                    ), "text/event-stream")), 61_000);
                });
            });

            const aiUtils = new AIUtils(makeHost());
            const transport = aiUtils.resolveChatTransport("native");
            const loop = new PaAgentLoop({
                runId: "run-ios-buffered-idle",
                userInput: "Reply READY",
                model: {
                    stream: async function* (input) {
                        const model = await aiUtils.createChatModel(0, {
                            transport: "native",
                            onProviderRequestStart: input.notifyProviderRequestStarted,
                        });
                        yield* streamWithInvokeFallback({
                            chain: model,
                            input: [new HumanMessage(input.userInput)],
                            signal: input.signal,
                        });
                    },
                },
                providerResponseDelivery: transport.responseDelivery,
                assistantIdleTimeoutMs: 60_000,
                maxWallClockMs: 120_000,
                finalizationReserveMs: 10_000,
            });

            let settled = false;
            const pending = loop.run().finally(() => {
                settled = true;
            });
            await requestStarted;
            await jest.advanceTimersByTimeAsync(60_000);
            expect(settled).toBe(false);
            await jest.advanceTimersByTimeAsync(1_000);

            const result = await pending;
            expect(result.status).toBe("completed");
            expect(result.committedFinalText).toBe("READY");
            expect(result.turns.flatMap((turn) => turn.diagnostics)).not.toContainEqual(
                expect.objectContaining({ type: "assistant_idle_timeout" }),
            );
            expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
        } finally {
            jest.useRealTimers();
        }
    });

    it("uses the hard wall clock without starting an overlapping finalization request", async () => {
        jest.useFakeTimers();
        try {
            Platform.isDesktop = false;
            Platform.isMobile = true;
            Platform.isIosApp = true;
            let markRequestStarted!: () => void;
            const requestStarted = new Promise<void>((resolve) => {
                markRequestStarted = resolve;
            });
            mockedRequestUrl.mockImplementation(() => {
                markRequestStarted();
                return new Promise(() => { /* the native request may outlive the local turn */ });
            });

            const aiUtils = new AIUtils(makeHost());
            const transport = aiUtils.resolveChatTransport("native");
            const loop = new PaAgentLoop({
                runId: "run-ios-buffered-deadline",
                userInput: "Reply READY",
                model: {
                    stream: async function* (input) {
                        const model = await aiUtils.createChatModel(0, {
                            transport: "native",
                            onProviderRequestStart: input.notifyProviderRequestStarted,
                        });
                        yield* streamWithInvokeFallback({
                            chain: model,
                            input: [new HumanMessage(input.userInput)],
                            signal: input.signal,
                        });
                    },
                },
                providerResponseDelivery: transport.responseDelivery,
                assistantIdleTimeoutMs: 10,
                maxWallClockMs: 100,
                finalizationReserveMs: 50,
            });

            const pending = loop.run();
            await requestStarted;
            await jest.advanceTimersByTimeAsync(100);
            const result = await pending;

            expect(result.status).toBe("incomplete");
            expect(result.endPayload).toMatchObject({ reason: "wall_clock_exceeded" });
            expect(result.turns).toHaveLength(1);
            expect(result.turns[0]?.diagnostics).toContainEqual({
                type: "wall_clock_exceeded",
                maxWallClockMs: 100,
            });
            expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
        } finally {
            jest.useRealTimers();
        }
    });

    it("aborts locally without retrying the uncancellable requestUrl operation", async () => {
        Platform.isDesktop = false;
        Platform.isMobile = true;
        Platform.isIosApp = true;
        let markRequestStarted!: () => void;
        const requestStarted = new Promise<void>((resolve) => {
            markRequestStarted = resolve;
        });
        let completeUnderlyingRequest!: (value: unknown) => void;
        const underlyingRequest = new Promise<unknown>((resolve) => {
            completeUnderlyingRequest = resolve;
        });
        mockedRequestUrl.mockImplementation(() => {
            markRequestStarted();
            return underlyingRequest;
        });

        const controller = new AbortController();
        const model = await new AIUtils(makeHost()).createChatModel(0, { transport: "native" });
        const pending = model.invoke([new HumanMessage("Reply READY")], { signal: controller.signal });
        await requestStarted;
        controller.abort();

        await expect(pending).rejects.toThrow(/abort/i);
        completeUnderlyingRequest(responseFixture(JSON.stringify({
            id: "chatcmpl-late",
            object: "chat.completion",
            created: 1,
            model: "deepseek-v4-pro",
            choices: [{
                index: 0,
                message: { role: "assistant", content: "LATE" },
                finish_reason: "stop",
            }],
        }), "application/json"));
        await Promise.resolve();
        expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
    });

    it("drains an aborted installed ChatOpenAI request before a same-run invoke dispatches", async () => {
        Platform.isDesktop = false;
        Platform.isMobile = true;
        Platform.isIosApp = true;
        let completeFirstRequest!: (value: unknown) => void;
        const firstRequest = new Promise<unknown>((resolve) => {
            completeFirstRequest = resolve;
        });
        let markFirstStarted!: () => void;
        const firstStarted = new Promise<void>((resolve) => {
            markFirstStarted = resolve;
        });
        mockedRequestUrl
            .mockImplementationOnce(() => {
                markFirstStarted();
                return firstRequest;
            })
            .mockResolvedValueOnce(responseFixture(JSON.stringify({
                id: "chatcmpl-second",
                object: "chat.completion",
                created: 2,
                model: "deepseek-v4-pro",
                choices: [{
                    index: 0,
                    message: { role: "assistant", content: "SECOND" },
                    finish_reason: "stop",
                }],
            }), "application/json"));

        const providerRequestScope = createProviderRequestScope();
        const onProviderRequestStart = jest.fn();
        const model = await new AIUtils(makeHost()).createChatModel(0, {
            transport: "native",
            providerRequestScope,
            onProviderRequestStart,
        });
        const firstController = new AbortController();
        const first = model.invoke(
            [new HumanMessage("First")],
            { signal: firstController.signal },
        );
        await firstStarted;
        firstController.abort();
        await expect(first).rejects.toThrow(/abort/i);

        const second = model.invoke([new HumanMessage("Second")]);
        await Promise.resolve();
        await Promise.resolve();
        expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
        expect(onProviderRequestStart).toHaveBeenCalledTimes(1);

        completeFirstRequest(responseFixture(JSON.stringify({
            id: "chatcmpl-late",
            object: "chat.completion",
            created: 1,
            model: "deepseek-v4-pro",
            choices: [{
                index: 0,
                message: { role: "assistant", content: "LATE" },
                finish_reason: "stop",
            }],
        }), "application/json"));

        await expect(second).resolves.toMatchObject({ content: "SECOND" });
        expect(mockedRequestUrl).toHaveBeenCalledTimes(2);
        expect(onProviderRequestStart).toHaveBeenCalledTimes(2);
    });

    it("drains a timed-out capability classifier before the same PA run dispatches its main answer", async () => {
        jest.useFakeTimers();
        try {
            Platform.isDesktop = false;
            Platform.isMobile = true;
            Platform.isIosApp = true;
            let completeClassifier!: (value: unknown) => void;
            const classifierRequest = new Promise<unknown>((resolve) => {
                completeClassifier = resolve;
            });
            let markClassifierStarted!: () => void;
            const classifierStarted = new Promise<void>((resolve) => {
                markClassifierStarted = resolve;
            });
            mockedRequestUrl
                .mockImplementationOnce(() => {
                    markClassifierStarted();
                    return classifierRequest;
                })
                .mockResolvedValueOnce(responseFixture(JSON.stringify({
                    id: "chatcmpl-main",
                    object: "chat.completion",
                    created: 2,
                    model: "deepseek-v4-pro",
                    choices: [{
                        index: 0,
                        message: { role: "assistant", content: "READY" },
                        finish_reason: "stop",
                    }],
                }), "application/json"));

            const host = makeRuntimeHost({ policyModelName: "deepseek-v4-pro" });
            const aiUtils = new AIUtils(host as never);
            const providerRequestScope = createProviderRequestScope();
            const classifierModel = await aiUtils.createChatModel(0, {
                transport: "obsidian",
                modelName: "deepseek-v4-pro",
                providerRequestScope,
            });
            const classifierPending = resolveRequiredCapabilityClassification({
                userInput: "Reply READY",
                classifier: {
                    classify: async ({ userInput, signal }) => (
                        await classifierModel.invoke(
                            [new HumanMessage(userInput)],
                            { signal },
                        )
                    ).content,
                },
            });

            await classifierStarted;
            await jest.advanceTimersByTimeAsync(800);
            await expect(classifierPending).resolves.toEqual({ items: [] });
            expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
            expect(JSON.parse((mockedRequestUrl.mock.calls[0][0] as { body: string }).body)).toMatchObject({
                stream: false,
            });

            const mainModel = await aiUtils.createChatModel(0, {
                transport: "native",
                providerRequestScope,
            });
            const mainPending = mainModel.invoke([new HumanMessage("Reply READY")]);
            await flushMicrotasks();
            expect(mockedRequestUrl).toHaveBeenCalledTimes(1);

            completeClassifier(responseFixture(JSON.stringify({
                id: "chatcmpl-classifier-late",
                object: "chat.completion",
                created: 1,
                model: "qwen-policy",
                choices: [{
                    index: 0,
                    message: { role: "assistant", content: '{"items":[]}' },
                    finish_reason: "stop",
                }],
            }), "application/json"));

            await expect(mainPending).resolves.toMatchObject({ content: "READY" });
            expect(mockedRequestUrl).toHaveBeenCalledTimes(2);
            const requests = mockedRequestUrl.mock.calls.map(([request]) => (
                JSON.parse((request as { body: string }).body) as { model: string; stream: boolean }
            ));
            expect(requests).toEqual([
                expect.objectContaining({ model: "deepseek-v4-pro", stream: false }),
                expect.objectContaining({ model: "deepseek-v4-pro", stream: false }),
            ]);
        } finally {
            jest.useRealTimers();
        }
    });

    it("drains a timed-out Memory reranker before the same PA run dispatches its next answer turn", async () => {
        jest.useFakeTimers();
        try {
            Platform.isDesktop = false;
            Platform.isMobile = true;
            Platform.isIosApp = true;
            const markdown = "# Memory\n\nUseful current evidence.";
            const searchResults: unknown[] = [];
            const host = makeRuntimeHost({
                policyModelName: "",
                latestMarkdown: markdown,
                searchResults,
            });
            const aiUtils = new AIUtils(host as never);
            const cleaned = aiUtils.cleanMarkdownContent(markdown);
            const contentHash = await aiUtils.hashContent(cleaned);
            const [chunk] = createHeadingAwareMarkdownChunks({
                path: "notes/memory.md",
                markdown: cleaned,
                contentHash,
                created: 1_000,
                lastModified: 1_000,
            });
            searchResults.push({
                score: 0.99,
                doc: {
                    pageContent: chunk.content,
                    metadata: {
                        path: chunk.path,
                        chunkIndex: chunk.chunkIndex,
                        contentHash: chunk.metadata.contentHash,
                        startLine: chunk.metadata.startLine,
                        endLine: chunk.metadata.endLine,
                        headingPath: chunk.metadata.headingPath,
                        indexVersion: "ios-drain-test",
                        pathEvidenceGeneration: "generation:notes/memory.md",
                    },
                },
            });

            let completeReranker!: (value: unknown) => void;
            const rerankerRequest = new Promise<unknown>((resolve) => {
                completeReranker = resolve;
            });
            let markRerankerStarted!: () => void;
            const rerankerStarted = new Promise<void>((resolve) => {
                markRerankerStarted = resolve;
            });
            mockedRequestUrl
                .mockResolvedValueOnce(responseFixture(sse(
                    completionChunk({
                        role: "assistant",
                        content: "",
                        tool_calls: [{
                            index: 0,
                            id: "",
                            type: "function",
                            function: { name: "search_memory", arguments: '{"query":"memory"}' },
                        }],
                    }, null),
                    completionChunk({}, "tool_calls"),
                ), "text/event-stream"))
                .mockImplementationOnce(() => {
                    markRerankerStarted();
                    return rerankerRequest;
                })
                .mockResolvedValueOnce(responseFixture(sse(
                    completionChunk({ role: "assistant", content: "READY" }, null),
                    completionChunk({}, "stop", {
                        prompt_tokens: 12,
                        completion_tokens: 1,
                        total_tokens: 13,
                    }),
                ), "text/event-stream"));

            const runtime = new PaAgentRuntime(host as never, aiUtils, {
                runtimePlatform: "mobile",
                providerResponseDelivery: "buffered",
                skillContextProvider: null,
                maxWallClockMs: 90_000,
                finalizationReserveMs: 10_000,
            });
            const pending = runtime.streamTurn({
                prompt: "Search my notes for memory",
                memoryMode: "use-memory",
            });

            await rerankerStarted;
            await jest.advanceTimersByTimeAsync(30_000);
            await flushMicrotasks(40);
            expect(mockedRequestUrl).toHaveBeenCalledTimes(2);

            completeReranker(responseFixture(JSON.stringify({
                id: "chatcmpl-reranker-late",
                object: "chat.completion",
                created: 2,
                model: "deepseek-v4-pro",
                choices: [{
                    index: 0,
                    message: {
                        role: "assistant",
                        content: '{"verdict":"relevant","ranking":[0],"needsMoreEvidence":false}',
                    },
                    finish_reason: "stop",
                }],
            }), "application/json"));

            await pending;
            expect(mockedRequestUrl).toHaveBeenCalledTimes(3);
            const requests = mockedRequestUrl.mock.calls.map(([request]) => (
                JSON.parse((request as { body: string }).body) as { stream: boolean }
            ));
            expect(requests.map((request) => request.stream)).toEqual([true, false, true]);
            runtime.dispose();
        } finally {
            jest.useRealTimers();
        }
    });
});
