import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { BaseMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { AIUtils } from "../src/ai-services/ai-utils";
import type { AiServiceHost } from "../src/ai-services/AiServiceHost";
import { PaAgentRuntime, type PaAgentRuntimeOptions, type PaAgentStreamOptions } from "../src/ai-services/pa-agent-runtime";
import { ChatService } from "../src/ai-services/chat-service";
import type { AgentEvent, LegacyAgentEvent } from "../src/ai-services/chat-types";
import type { ImageAssetService } from "../src/chat/image-assets";
import type { MessageImage } from "../src/chat/image-types";
import { createPaAgentPersistedTurn } from "../src/ai-services/pa-agent-history";
import { decodeWritingOutput, isWritingContinuationPrompt, isWritingRequestPrompt, readProviderCompletion } from "../src/ai-services/writing-output";

jest.mock("obsidian");
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; jest.restoreAllMocks(); });

const image = (n: number): MessageImage => ({ ref: { assetId: `image-${n}`, contentHash: String(n).repeat(64) }, ordinal: n, label: `Image ${n}` });
const envelope = (body = '正文："海风"\n🌊') => JSON.stringify({ kind: "pa.writing", version: 1, requestId: "writing-1", body, explanation: "参考当前材料" });
type RequestBody = { stream?: boolean; messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>; tools?: Array<{ function: { name: string } }> };
type Reply = { text?: string; finish?: string | null; tool?: { name: string; input: unknown }; error?: unknown; httpError?: { status: number; code: string; retryAfter?: string }; onEnd?: () => void };
const response = (body: RequestBody, reply: Reply): Response => {
    if (reply.error) throw reply.error;
    if (reply.httpError) return new Response(JSON.stringify({ error: { code: reply.httpError.code, message: "Request rejected; echoed data:image/jpeg;base64,SECRET" } }), {
        status: reply.httpError.status, headers: { "content-type": "application/json", ...(reply.httpError.retryAfter ? { "retry-after": reply.httpError.retryAfter } : {}) },
    });
    const common = { id: "fixture", created: 0, model: "fixture-model" };
    const message = reply.tool ? { role: "assistant", content: "", tool_calls: [{ id: "call-1", type: "function", function: { name: reply.tool.name, arguments: JSON.stringify(reply.tool.input) } }] }
        : { role: "assistant", content: reply.text ?? "ordinary answer" };
    const finish = reply.finish === undefined ? "stop" : reply.finish;
    if (!body.stream) { reply.onEnd?.(); return new Response(JSON.stringify({ ...common, object: "chat.completion", choices: [{ index: 0, message, finish_reason: finish }] }), { headers: { "content-type": "application/json" } }); }
    const frame = (delta: unknown, reason: string | null = null) => `data: ${JSON.stringify({ ...common, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`;
    const frames = reply.tool ? [frame({ ...message, tool_calls: message.tool_calls!.map((tool) => ({ ...tool, index: 0 })) })]
        : [(reply.text ?? "ordinary answer").slice(0, 9), (reply.text ?? "ordinary answer").slice(9, 37), (reply.text ?? "ordinary answer").slice(37)].map((content) => frame({ role: "assistant", content }));
    frames.push(frame({}, reply.tool ? "tool_calls" : finish));
    frames.push(`data: ${JSON.stringify({ ...common, object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\n`);
    reply.onEnd?.();
    return new Response(frames.join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
};

function fixture(replies: Reply[] | ((body: RequestBody, index: number) => Reply), runtimeOptions: PaAgentRuntimeOptions = {}, sdkRetries = 0) {
    const requests: RequestBody[] = [], observed: BaseMessage[][] = [], events: LegacyAgentEvent[] = [], lifecycle: AgentEvent[] = [];
    const sdkAttempts: Array<{ stream: boolean; retryCount: string | null }> = [];
    let beforeSdkDispatch: (() => void) | undefined;
    const host = {
        settings: { aiProvider: "openai", baseURL: "https://b129-runtime.invalid/v1", chatModelName: "fixture-model", embeddingModelName: "fixture-embedding", policyModelName: "",
            skillContextEnabled: false, enabledSkillIds: [], webSearchEnabled: false, memoryEnabled: false, licenseTier: "free", statisticsVaultId: "fixture-vault",
            retrievalOptimizationFlags: { lexicalProfile: false, strictReranker: false, graphPpr: false, relaxedRecovery: false } },
        app: { workspace: { getActiveViewOfType: () => null, getMostRecentLeaf: () => null, getLeavesOfType: () => [] },
            vault: { getMarkdownFiles: () => [], getAbstractFileByPath: () => null, cachedRead: async () => "" }, metadataCache: { getFileCache: () => null } },
        memorySearch: { ensureReadyForChat: async () => ({ decision: "answer-now" }), searchHybrid: async () => [], getChunksByPath: async () => [] },
        getAPIToken: async () => "synthetic-fixture-token", log: jest.fn(), isOperationsAgentEnabled: false,
        getMemoryExtractionPromptContext: jest.fn(() => undefined as Record<string, unknown> | undefined),
    };
    const originalCreate = AIUtils.prototype.createChatModel;
    jest.spyOn(AIUtils.prototype, "createChatModel").mockImplementation(async function (this: AIUtils, ...args) {
        const configured = await originalCreate.apply(this, args);
        // Keep AIUtils' actual admission wrapper and observe SDK attempts before
        // it. Only the dedicated regression enables OpenAI's internal retries;
        // ChatOpenAI's separate caller retry remains disabled in every fixture.
        const guardedFetch = configured.clientConfig.fetch!;
        const configuration = { ...configured.clientConfig, maxRetries: sdkRetries, fetch: ((input, init) => {
            sdkAttempts.push({ stream: JSON.parse(String(init?.body)).stream === true,
                retryCount: new Headers(init?.headers).get("x-stainless-retry-count") });
            return guardedFetch(input, init);
        }) as typeof fetch };
        const model = new ChatOpenAI({ model: configured.model, apiKey: "synthetic-fixture-token", configuration,
            temperature: configured.temperature, maxRetries: 0, ...(args[1]?.maxTokens ? { maxTokens: args[1].maxTokens } : {}) });
        const callbacks = [{ name: "b129-real-bound-observer", handleChatModelStart: (_serialized: unknown, batches: BaseMessage[][]) => { observed.push(...batches); beforeSdkDispatch?.(); } }];
        model.callbacks = callbacks;
        const originalBind = model.bindTools.bind(model);
        model.bindTools = ((...bindArgs: Parameters<typeof model.bindTools>) => {
            const bound = originalBind(...bindArgs); (bound as unknown as { callbacks: typeof callbacks }).callbacks = callbacks; return bound;
        }) as typeof model.bindTools;
        return model;
    });
    globalThis.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url) !== "https://b129-runtime.invalid/v1/chat/completions") throw new Error("Unexpected offline URL");
        const body: RequestBody = JSON.parse(String(init?.body)); const index = requests.length; requests.push(body);
        const reply = typeof replies === "function" ? replies(body, index) : replies[index];
        if (!reply) throw new Error("Unexpected extra fixture request");
        return response(body, reply);
    }) as typeof fetch;
    let sourceCurrent = true;
    const release = jest.fn();
    const service = {
        resolveVariant: jest.fn(async () => ({ blob: new Blob([new Uint8Array([255, 216, 255])]), mime: "image/jpeg", width: 1, height: 1, persistent: true, release })),
        verify: jest.fn(async () => ({ asset: {}, isCurrent: () => sourceCurrent })),
    };
    const runtime = new PaAgentRuntime(host as unknown as AiServiceHost, new AIUtils(host), { skillContextProvider: null, ...runtimeOptions });
    const run = async (options: Partial<PaAgentStreamOptions> = {}) => {
        try { await runtime.streamTurn({ prompt: "请描述图片", memoryMode: "auto", images: [image(1)], imageAssetService: service as unknown as ImageAssetService,
            onEvent: (event) => events.push(event), onLifecycleEvent: (event) => lifecycle.push(event), ...options }); }
        finally { runtime.dispose(); }
    };
    return { host, requests, observed, sdkAttempts, events, lifecycle, service, release, run, invalidate: () => { sourceCurrent = false; },
        beforeSdkDispatch: (callback: () => void) => { beforeSdkDispatch = callback; } };
}
const pixels = (request: RequestBody) => request.messages.flatMap((message) => Array.isArray(message.content) ? message.content.filter((part) => part.type === "image_url") : []);
const requestText = (request: RequestBody) => request.messages.map((message) => typeof message.content === "string" ? message.content : message.content.filter((part) => part.type === "text").map((part) => part.text).join("")).join("\n");

describe("B-129 production runtime with real ChatOpenAI/bindTools and offline transport", () => {
    it("sends image-only current input as real image blocks, with no image bytes in canonical events or diagnostics", async () => {
        const f = fixture([{}]); await f.run({ prompt: "" });
        expect(f.requests).toHaveLength(1); expect(pixels(f.requests[0])).toEqual([{ type: "image_url", image_url: { url: "data:image/jpeg;base64,/9j/" } }]);
        expect(f.observed[0][1]._getType()).toBe("human"); expect(f.observed[0][1].content).toHaveLength(2);
        expect(JSON.stringify([f.events, f.lifecycle, f.host.log.mock.calls])).not.toMatch(/data:image|base64|synthetic-fixture-token/);
        expect(f.lifecycle.some((event) => event.type === "message_end" && event.message.role === "user" && event.message.images?.[0].ref.assetId === "image-1")).toBe(true);
        expect(f.release).toHaveBeenCalledTimes(1);
    });

    it("registers old image refs through the real tool executor and carries ordered pixels into the next turn", async () => {
        const f = fixture([{ tool: { name: "resolve_chat_images", input: { refs: [image(2).ref] } } }, {}]);
        await f.run({ chatHistory: [{ role: "user", content: "old material", images: [image(2)] }, { role: "assistant", content: "prior answer" }] });
        expect(f.requests).toHaveLength(2); expect(pixels(f.requests[0])).toHaveLength(1); expect(pixels(f.requests[1])).toHaveLength(2);
        expect(requestText(f.requests[0])).toContain(image(2).ref.contentHash); expect(requestText(f.requests[1])).toContain("registered_for_request");
        expect(f.service.resolveVariant).toHaveBeenCalledTimes(2); expect(f.release).toHaveBeenCalledTimes(2);
    });

    it.each(["artifact", "recovery"])("retains a tool-resolved historical image in the host writing %s receipt", async (kind) => {
        const body = envelope();
        const f = fixture([{ tool: { name: "resolve_chat_images", input: { refs: [image(3).ref] } } },
            { text: kind === "artifact" ? body : `\u0060\u0060\u0060json\n${body}\n\u0060\u0060\u0060\nAdditional explanation` }]);
        await f.run({ images: [], prompt: "继续刚才的文案任务：请重新查看第3张图片", writingRequest: { requestId: "writing-1" },
            chatHistory: [{ role: "user", content: "unrelated image question", images: [image(1)] },
                { role: "assistant", content: "answer" }, { role: "user", content: "write about this", images: [image(3)] }] });
        expect(pixels(f.requests[0])).toHaveLength(0); expect(pixels(f.requests[1])).toHaveLength(1);
        expect(f.events.find((event) => event.kind === `writing-${kind}`)).toMatchObject({ associatedImages: [image(3)] });
        expect(f.events.some((event) => event.kind === (kind === "artifact" ? "writing-recovery" : "writing-artifact"))).toBe(false);
    });

    it("retries streaming as invoke with the same pixels and requestId, then emits only the validated body", async () => {
        const f = fixture([{ error: new Error("setup failed with data:image/jpeg;base64,SECRET") }, { text: envelope() }]);
        await f.run({ writingRequest: { requestId: "writing-1" } });
        expect(f.requests.map((request) => request.stream === true)).toEqual([true, false]); expect(pixels(f.requests[0])).toEqual(pixels(f.requests[1]));
        expect(f.service.resolveVariant).toHaveBeenCalledTimes(1); expect(f.service.verify.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(f.events.find((event) => event.kind === "writing-artifact")).toMatchObject({ body: '正文："海风"\n🌊', requestId: "writing-1" });
        expect(f.events.filter((event) => event.kind === "answer-snapshot")).toEqual([expect.objectContaining({ snapshot: '正文："海风"\n🌊' })]);
        expect(JSON.stringify([f.events, f.lifecycle, f.host.log.mock.calls])).not.toContain("SECRET");
    });

    it("keeps images and final JSON instructions in a reserved final turn with no bound tools", async () => {
        const f = fixture([{ text: envelope() }], { maxWallClockMs: 10_000, finalizationReserveMs: 10_000 });
        await f.run({ writingRequest: { requestId: "writing-1" } });
        expect(f.requests).toHaveLength(1); expect(f.requests[0].tools ?? []).toHaveLength(0); expect(pixels(f.requests[0])).toHaveLength(1);
        expect(requestText(f.requests[0])).toContain('"requestId":"writing-1"');
        expect(f.events.some((event) => event.kind === "writing-artifact")).toBe(true);
    });

    it.each(["length", "content_filter", null, "other-reason"])("does not promote legal JSON with provider completion %s", async (finish) => {
        const f = fixture([{ text: envelope(), finish }]); await f.run({ writingRequest: { requestId: "writing-1" } });
        expect(f.events.some((event) => event.kind === "writing-artifact" || event.kind === "answer-snapshot")).toBe(false);
        expect(f.events.find((event) => event.kind === "writing-recovery")).toMatchObject({ rawText: envelope(), reason: "provider_incomplete" });
    });

    it.each(['completed', 'provider_incomplete', 'source_changed'] as const)('keeps the host completion and source guards for a single JSON fence: %s', async (state) => {
        const exactBody = '  正文："海风"\r\n🌊\n```\n';
        const rawText = ` \r\n\u0060\u0060\u0060JSON\r\n${envelope(exactBody)}\r\n\u0060\u0060\u0060\n `;
        const f = fixture([{ text: rawText, finish: state === 'provider_incomplete' ? 'length' : 'stop',
            onEnd: () => { if (state === 'source_changed') f.invalidate(); } }]);
        await f.run({ writingRequest: { requestId: 'writing-1' } });
        expect(f.requests).toHaveLength(1);
        if (state === 'completed') {
            expect(f.events.find((event) => event.kind === 'writing-artifact')).toMatchObject({
                requestId: 'writing-1', body: exactBody, associatedImages: [image(1)],
            });
            expect(f.events.filter((event) => event.kind === 'answer-snapshot')).toEqual([
                expect.objectContaining({ snapshot: exactBody }),
            ]);
            expect(f.events.some((event) => event.kind === 'writing-recovery')).toBe(false);
        } else {
            expect(f.events.some((event) => event.kind === 'writing-artifact' || event.kind === 'answer-snapshot')).toBe(false);
            expect(f.events.find((event) => event.kind === 'writing-recovery')).toMatchObject({ rawText, reason: state });
        }
    });

    it("ordinary text that happens to be an envelope never becomes a writing version", async () => {
        const f = fixture([{ text: envelope() }]); await f.run({ images: [] });
        expect(f.events.some((event) => event.kind.startsWith("writing-"))).toBe(false);
        expect(f.events.find((event) => event.kind === "answer-snapshot")).toMatchObject({ snapshot: envelope() });
        expect(f.service.verify).not.toHaveBeenCalled(); expect(f.service.resolveVariant).not.toHaveBeenCalled();
    });

    it("rejects a source changed during SDK formatting before real native fetch", async () => {
        const f = fixture([{}]);
        // The real post-bind model observer runs AFTER prompt formatting and
        // the runtime's chain guard, but BEFORE native HTTP dispatch.
        f.beforeSdkDispatch(() => f.invalidate());
        await expect(f.run({ writingRequest: { requestId: "writing-1" } })).rejects.toThrow();
        expect(f.requests).toHaveLength(0); expect(f.release).toHaveBeenCalledTimes(1);
        expect(f.events.some((event) => event.kind === "writing-artifact")).toBe(false);
    });

    it("rechecks source changes before invoke fallback and does not silently retry as text", async () => {
        const f = fixture((_request, index) => { if (index === 0) f.invalidate(); return { error: new Error("transport failed") }; });
        await expect(f.run()).rejects.toThrow(); expect(f.requests).toHaveLength(1); expect(pixels(f.requests[0])).toHaveLength(1); expect(f.release).toHaveBeenCalledTimes(1);
    });

    it.each(["image", "style"] as const)("blocks a real SDK internal 429 retry after %s currentness is revoked", async (source) => {
        let styleCurrent = true;
        const f = fixture((_request, index) => {
            if (index !== 0) throw new Error("Revoked input reached a second physical fetch");
            queueMicrotask(() => { if (source === "image") f.invalidate(); else styleCurrent = false; });
            return { httpError: { status: 429, code: "rate_limit_exceeded", retryAfter: "0.001" } };
        }, {}, 1);
        await expect(f.run({ writingRequest: { requestId: "writing-1" }, prepareWritingStyle: async () => ({
            context: "<writing_style>sample</writing_style>", revisionIds: ["style-1"], isCurrent: () => styleCurrent,
        }) })).rejects.toThrow();
        // Both attempts belong to the same stream. The SDK's own retry header
        // distinguishes the second attempt from the runtime's invoke fallback.
        expect(f.sdkAttempts).toEqual([{ stream: true, retryCount: "0" }, { stream: true, retryCount: "1" }]);
        expect(f.requests).toHaveLength(1); expect(pixels(f.requests[0])).toHaveLength(1);
        expect(f.service.resolveVariant).toHaveBeenCalledTimes(1); expect(f.release).toHaveBeenCalledTimes(1);
        expect(f.events.some((event) => event.kind === "writing-artifact" || event.kind === "answer-snapshot")).toBe(false);
        expect(JSON.stringify([f.events, f.lifecycle, f.host.log.mock.calls])).not.toMatch(/SECRET|data:image|base64/);
    });

    it("uses host parent text and bounded style preparation, invalidating cancellation before submission", async () => {
        const f = fixture([{ text: envelope() }]); let current = true;
        f.host.getMemoryExtractionPromptContext.mockReturnValue({ memoryContextMode: "governed", governedMemoryContext: "ordinary preference" });
        const prepareWritingStyle = jest.fn(async (_input: { remainingTextChars: number; remainingMemoryChars: number }) => ({ context: '<writing_style context_only="true">sample</writing_style>', revisionIds: ["style-1"], isCurrent: () => current }));
        await f.run({ writingRequest: { requestId: "writing-1" }, writingContext: { parentVersionId: "v2", text: "本地修改的 V2，不能退回 V1", textHash: "a".repeat(64), associatedImages: [image(1)] }, prepareWritingStyle });
        expect(requestText(f.requests[0])).toContain("本地修改的 V2"); expect(requestText(f.requests[0])).toContain("<writing_style");
        expect(prepareWritingStyle.mock.calls[0][0].remainingMemoryChars).toBeLessThan(6000);
        expect(f.events.find((event) => event.kind === "writing-artifact")).toMatchObject({ styleRevisionIds: ["style-1"] });
        current = false;
        const canonical = f.lifecycle.filter((event) => event.type === "message_end").map((event) => (event as Extract<AgentEvent, { type: "message_end" }>).message);
        const persisted = createPaAgentPersistedTurn({ runId: "r", turnId: "t", messages: canonical, committedFinalText: '正文："海风"\n🌊' });
        expect(JSON.stringify(persisted.messages)).not.toContain("pa.writing");
        expect(persisted.messages.find((message) => message.role === "assistant")).toMatchObject({ content: [{ type: "text", text: '正文："海风"\n🌊' }], providerCompletion: "stop", writingRequestId: "writing-1" });
    });

    it("does not submit if a style is cancelled while the provider responds", async () => {
        let current = true;
        const f = fixture([{ text: envelope(), onEnd: () => { current = false; } }]);
        await f.run({ writingRequest: { requestId: "writing-1" }, prepareWritingStyle: async () => ({ context: "<writing_style>sample</writing_style>", revisionIds: ["style-1"], isCurrent: () => current }) });
        expect(f.events.find((event) => event.kind === "writing-recovery")).toMatchObject({ reason: "source_changed" });
        expect(f.events.some((event) => event.kind === "writing-artifact")).toBe(false);
    });

    it("ChatService exposes capability evidence and a configuration switch clears it", async () => {
        const f = fixture([{}]); const service = new ChatService(f.host as unknown as AiServiceHost);
        expect(service.getImageCapability()).toBe("unknown");
        try { await service.streamLLM("", () => undefined, undefined, [], { images: [image(1)], imageAssetService: f.service as unknown as ImageAssetService }); }
        finally { service.dispose(); }
        expect(service.getImageCapability()).toBe("supported"); f.host.settings.chatModelName = "different";
        expect(service.getImageCapability()).toBe("unknown");
    });

    it("ChatService preserves failed-task material while dispatching only the requested subset", async () => {
        const f = fixture([{ text: envelope() }]); const service = new ChatService(f.host as unknown as AiServiceHost);
        const events: LegacyAgentEvent[] = [];
        try { await service.streamLLM('只用第二张，改短一点', () => undefined, undefined, [], {
            writingRequest: { requestId: 'writing-1' }, writingMaterialContext: { requestId: 'failed-task', associatedImages: [image(1), image(2)] },
            imageAssetService: f.service as unknown as ImageAssetService, onEvent: (event) => events.push(event),
        }); } finally { service.dispose(); }
        expect(pixels(f.requests[0])).toHaveLength(1);
        expect(events.find((event) => event.kind === 'writing-artifact')).toMatchObject({ associatedImages: [image(1), image(2)] });
    });

    it("learns only structured image incompatibility and blocks a repeat before derivative IO", async () => {
        const f = fixture([{ httpError: { status: 400, code: "image_input_not_supported" } }]);
        const service = new ChatService(f.host as unknown as AiServiceHost); const events: LegacyAgentEvent[] = [];
        const send = () => service.streamLLM("describe", () => undefined, undefined, [], { images: [image(1)], imageAssetService: f.service as unknown as ImageAssetService, onEvent: (event) => events.push(event) });
        try {
            await expect(send()).rejects.toThrow(); expect(service.getImageCapability()).toBe("unsupported");
            const processed = f.service.resolveVariant.mock.calls.length;
            await expect(send()).rejects.toThrow(); expect(f.service.resolveVariant).toHaveBeenCalledTimes(processed);
            expect(f.requests).toHaveLength(1); expect(JSON.stringify([events, f.host.log.mock.calls])).not.toContain("SECRET");
        } finally { service.dispose(); }
    });
});

describe("B-129 strict writing protocol and intent", () => {
    it.each(["```json\n" + envelope() + "\n```\nExplanation", envelope() + " tail", envelope().replace('"version":1', '"version":2'), envelope().replace('"writing-1"', '"wrong"'), envelope().replace('{"kind"', '{"sourceMessageIds":[],"kind"')])("rejects an invalid whole response", (text) => {
        expect(decodeWritingOutput(text, { requestId: "writing-1" }, 10_000)).toBeUndefined();
    });
    it("counts full text, preserves exact body and never overwrites completion with a usage-only tail", () => {
        expect(decodeWritingOutput(envelope(), { requestId: "writing-1" }, envelope().length)?.body).toBe('正文："海风"\n🌊');
        expect(decodeWritingOutput(envelope(), { requestId: "writing-1" }, envelope().length - 1)).toBeUndefined();
        expect(readProviderCompletion({ response_metadata: { finish_reason: "stop" } })).toBe("stop");
        expect(readProviderCompletion({ response_metadata: {}, usage_metadata: {} })).toBeUndefined();
    });
    it.each(["短一点", "改写这版", "继续上段", "继续刚才的文案任务：请重新查看第3张图片", "重试上一轮配文", "make it shorter", "rewrite this", "continue the previous writing task"])("recognizes an explicit continuation: %s", (text) => {
        expect(isWritingContinuationPrompt(text)).toBe(true); expect(isWritingRequestPrompt(text, true)).toBe(true);
    });
    it.each(["换个话题，写一封工作邮件", "new topic: write a caption", "这张图是什么", "继续"])("does not inherit material for %s", (text) => {
        expect(isWritingContinuationPrompt(text)).toBe(false);
    });
    it.each(["换个话题，写一封工作邮件", "new topic: write a caption", "帮我写一篇文章", "draft an email"])("recognizes a new writing task without inheriting old material: %s", (text) => {
        expect(isWritingRequestPrompt(text)).toBe(true); expect(isWritingContinuationPrompt(text)).toBe(false);
    });
});
