import { describe, expect, it, jest } from "@jest/globals";
import { RunnableLambda } from "@langchain/core/runnables";
import type { AgentDebugCallScope, AgentDebugObservation, AgentDebugRunRecorder } from "../src/ai-services/agent-debug-port";
import { agentDebugError, observeAgentDebugCall, observeAgentDebugLifecycle, observeAgentDebugPhase, observeAgentDebugResponse, readAgentDebugUsage } from "../src/ai-services/agent-debug-observation";
import { traceProviderDispatch } from "../src/ai-services/obsidian-fetch";
import { streamWithInvokeFallback } from "../src/ai-services/pa-agent-runtime";
import { MemorySearchTool, type MemorySearchDebugScope } from "../src/ai-services/memory-search-tool";
import { ChatImageRequestScope } from "../src/ai-services/image-request";
import { projectDebugRequest } from "../src/agent-debug/projection";

jest.mock("obsidian");

function capture(enabled: () => boolean = () => true) {
    const events: AgentDebugObservation[] = [];
    const recorder: AgentDebugRunRecorder = {
        captureId: "capture", enabled, bindRun: jest.fn(), finish: jest.fn(),
        observe: event => { events.push(event); },
    };
    const call: AgentDebugCallScope = { recorder, callId: "answer", parentId: "turn", turnId: "turn", purpose: "answer" };
    return { events, recorder, call };
}

describe("Chat scoped Debug observation", () => {
    it("leaves one-sided token usage incomplete instead of manufacturing a total", () => {
        expect(readAgentDebugUsage({ usage_metadata: { input_tokens: 12 } }))
            .toMatchObject({ inputTokens: 12, totalTokens: undefined, complete: false, aggregation: "cumulative" });
        expect(readAgentDebugUsage({ usage_metadata: { input_tokens: 12, output_tokens: 5,
            input_token_details: { cache_read: 4 }, output_token_details: { reasoning: 2 } } }))
            .toMatchObject({ totalTokens: 17, complete: true, cacheReadTokens: 4, reasoningTokens: 2 });
    });

    it("does not invoke provider getters or inspect payloads while disabled", () => {
        const getter = jest.fn(() => { throw new Error("getter must never run"); });
        const response = Object.defineProperty({}, "content", { get: getter });
        const { call, events } = capture(() => false);
        observeAgentDebugResponse(call, response);
        expect(events).toEqual([]);
        expect(agentDebugError(Object.defineProperty({}, "message", { get: getter }))).toEqual({ name: "Error" });
        expect(getter).not.toHaveBeenCalled();
    });

    it("does not backfill a cumulative assistant message at message_end", () => {
        const { recorder, events } = capture();
        observeAgentDebugLifecycle(recorder, {
            version: 2, runId: "run", turnId: "turn", scope: "turn", seq: 10, timestamp: 0,
            type: "message_end", message: { role: "assistant", id: "message", timestamp: 0,
                content: [{ type: "text", text: "BEFORE_DEBUG" }, { type: "thinking", text: "OLD_REASONING" }] },
        });
        expect(events).toEqual([]);
    });

    it("does not label an aborted attempt or stream phase as a provider failure", async () => {
        const { recorder, call, events } = capture();
        await traceProviderDispatch(() => Promise.resolve({ status: 200 }), "native", undefined,
            '{"messages":[]}', () => true, { call });
        observeAgentDebugCall(call, { phase: "error", status: "cancelled", error: { name: "AbortError" } });
        observeAgentDebugPhase(recorder, "llm_stream:error", { turnId: "turn", status: "cancelled" });
        expect(events.filter(event => event.phase === "error" && event.attemptId).at(-1)?.status).toBe("cancelled");
        expect(events.find(event => event.phase === "llm_stream:error")?.status).toBe("cancelled");
    });

    it("dispatches the unchanged body first, parses once, and shares attempt identity with diagnostics", async () => {
        const { call, events } = capture();
        const body = '{"model":"actual-model","messages":[{"role":"user","content":"hello"}],"max_tokens":16}';
        const parse = jest.spyOn(JSON, "parse");
        const diagnostic = jest.fn();
        try {
            const pending = Promise.resolve({ status: 200 });
            const returned = traceProviderDispatch(() => {
                expect(parse).not.toHaveBeenCalled();
                return pending;
            }, "native", undefined, body, () => true, { call, diagnostic });
            expect(returned).toBe(pending);
            await returned;
            expect(parse).toHaveBeenCalledTimes(1);
            const dispatched = events.find(event => event.phase === "dispatch")!;
            expect(dispatched).toMatchObject({ callId: "answer", parentId: "answer", model: "actual-model",
                prompt: { messages: [{ content: "hello" }] } });
            expect(projectDebugRequest(dispatched.prompt).text).toContain("hello");
            expect(parse).toHaveBeenCalledTimes(1);
            expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({ requestId: dispatched.attemptId, maxTokens: 16 }));
            expect(events.find(event => event.phase === "response")?.attemptId).toBe(dispatched.attemptId);
        } finally { parse.mockRestore(); }
    });

    it("supports enabling after dispatch without pretending the input was collected", async () => {
        let enabled = false;
        const { call, events } = capture(() => enabled);
        call.getAttachments = jest.fn(() => []);
        let resolve!: (response: { status: number }) => void;
        const pending = new Promise<{ status: number }>(done => { resolve = done; });
        const parse = jest.spyOn(JSON, "parse");
        try {
            const returned = traceProviderDispatch(() => pending, "obsidian", undefined, '{"messages":[]}', () => enabled, { call });
            expect(events).toEqual([]);
            expect(parse).not.toHaveBeenCalled();
            expect(call.getAttachments).not.toHaveBeenCalled();
            enabled = true;
            resolve({ status: 200 });
            await returned;
            expect(events).toHaveLength(1);
            expect(events[0]).toMatchObject({ phase: "response", transport: "buffered", missingReason: "dispatch_not_collected" });
            expect(events[0].prompt).toBeUndefined();
        } finally { parse.mockRestore(); }
    });

    it("uses only already prepared attachment metadata at dispatch without reading media again", async () => {
        const ref = { assetId: "selected", contentHash: "a".repeat(64) };
        const arrayBuffer = jest.fn(async () => Uint8Array.from([1, 2, 3]).buffer);
        const resolveVariant = jest.fn(async () => ({ mime: "image/jpeg", width: 20, height: 10,
            blob: { size: 3, arrayBuffer }, persistent: true, release: jest.fn() }));
        const scope = new ChatImageRequestScope({ prompt: "Describe this image",
            images: [{ ref, ordinal: 1, label: "PRIVATE_LABEL" }],
            history: [{ role: "user", content: "earlier", images: [{ ref: { assetId: "unselected", contentHash: "b".repeat(64) }, ordinal: 2, label: "older" }] }],
            service: { resolveVariant, verify: async () => ({ isCurrent: () => true }) } as never,
        });
        expect(scope.debugAttachments()).toEqual([]);
        await scope.prepare();
        arrayBuffer.mockClear(); resolveVariant.mockClear();
        const { call, events } = capture();
        call.getAttachments = () => scope.debugAttachments();
        await traceProviderDispatch(() => Promise.resolve({ status: 200 }), "native", undefined, '{"messages":[]}', () => true, { call });
        const attachments = events.find(event => event.phase === "dispatch")?.attachments;
        expect(attachments).toEqual([{ kind: "image", ...ref, ordinal: 1, mime: "image/jpeg", width: 20,
            height: 10, byteLength: 3, availability: "provided" }]);
        expect(JSON.stringify(attachments)).not.toMatch(/PRIVATE_LABEL|unselected|data:|blob/);
        expect(arrayBuffer).not.toHaveBeenCalled(); expect(resolveVariant).not.toHaveBeenCalled();
        scope.dispose();
    });

    it("keeps stream and invoke usage distinct and does not read the completion tail for Debug", async () => {
        const { call, events } = capture();
        const invoke = jest.fn(async () => ({ content: "answer", usage_metadata: { input_tokens: 5, output_tokens: 2 } }));
        const chunks = [];
        for await (const chunk of streamWithInvokeFallback({ input: {}, debugCall: call,
            chain: { stream: async function* () {
                yield { usage_metadata: { input_tokens: 3, output_tokens: 0 } };
                throw new Error("Streaming unavailable");
            }, invoke },
        })) chunks.push(chunk);
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(events.filter(event => event.usage).map(event => [event.usage?.updateKey, event.usage?.totalTokens]))
            .toEqual([["stream", 3], ["invoke", 7]]);
        expect(chunks).toContainEqual({ type: "text_delta", text: "answer" });

        let tailReads = 0;
        const iterator = streamWithInvokeFallback({ input: {}, debugCall: call, chain: {
            stream: async function* () {
                yield { content: "complete", response_metadata: { finish_reason: "stop" } };
                tailReads++;
                yield { usage_metadata: { input_tokens: 100, output_tokens: 100 } };
            }, invoke,
        } });
        await iterator.next();
        expect((await iterator.next()).value).toEqual({ type: "provider_completion", completion: "stop" });
        await iterator.return();
        expect(tailReads).toBe(0);
    });

    it("observes auxiliary response usage before rewrite converts it to text, preserving fail-open", async () => {
        const { recorder, events } = capture();
        const debugScope: MemorySearchDebugScope = { recorder, parentId: "memory-tool", turnId: "turn" };
        const createChatModel = jest.fn(async () => RunnableLambda.from(async () => ({
            content: '{"keywords":"source;planning","temporal":"none"}',
            usage_metadata: { input_tokens: 17, output_tokens: 4 },
        })));
        const tool = new MemorySearchTool({ settings: { debug: true, aiProvider: "test" } } as never, { createChatModel } as never);
        const invokeRewrite = tool as unknown as { rewriteQueryWithTimeout(query: string, model: string, signal?: AbortSignal,
            options?: { debugScope: MemorySearchDebugScope }): Promise<{ keywords: string | null }> };
        expect(await invokeRewrite.rewriteQueryWithTimeout("please find the planning sources", "policy", undefined, { debugScope }))
            .toMatchObject({ keywords: "source;planning" });
        expect(events.find(event => event.usage)).toMatchObject({ parentId: "memory-tool", purpose: "query_rewrite", usage: { totalTokens: 21 } });
        createChatModel.mockRejectedValueOnce(new Error("provider failure"));
        expect(await invokeRewrite.rewriteQueryWithTimeout("please find the planning sources", "policy", undefined, { debugScope }))
            .toMatchObject({ keywords: null });
        expect(events.find(event => event.phase === "error")).toMatchObject({ status: "failed", error: { message: "provider failure" } });
        tool.dispose();
    });
});
