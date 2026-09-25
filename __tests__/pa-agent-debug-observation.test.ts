import { describe, expect, it, jest } from "@jest/globals";
import { RunnableLambda } from "@langchain/core/runnables";
import type { AgentDebugCallScope, AgentDebugObservation, AgentDebugRunRecorder } from "../src/ai-services/agent-debug-port";
import { agentDebugError, observeAgentDebugCall, observeAgentDebugLifecycle, observeAgentDebugPhase, observeAgentDebugResponse, readAgentDebugUsage } from "../src/ai-services/agent-debug-observation";
import { PaAgentRunUsageLedger } from '../src/ai-services/agent-usage-ledger';
import { traceProviderDispatch } from "../src/ai-services/obsidian-fetch";
import { streamWithInvokeFallback } from "../src/ai-services/pa-agent-runtime";
import { MemorySearchTool, type MemorySearchDebugScope } from "../src/ai-services/memory-search-tool";
import { ChatImageRequestScope } from "../src/ai-services/image-request";
import { projectDebugRequest } from "../src/agent-debug/projection";
import { createPaRuntimeEvalRequestBudget } from "../src/pa/eval/runtime-runner";

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
    it('accounts only uniquely proven response attempts even while Debug is disabled', async () => {
        const ledger = new PaAgentRunUsageLedger();
        const { recorder } = capture(() => false);
        const call: AgentDebugCallScope = { recorder, usageLedger: ledger,
            callId: 'answer', parentId: 'turn', purpose: 'answer' };
        const dispatch = async (status: number) => traceProviderDispatch(
            () => Promise.resolve({ status }), 'native', undefined, '{"messages":[]}', () => false, { call });
        await dispatch(500);
        await dispatch(200);
        observeAgentDebugResponse(call, { usage_metadata: { input_tokens: 5, output_tokens: 2 } }, 'delta', 'stream');
        observeAgentDebugResponse(call, { usage_metadata: { input_tokens: 5, output_tokens: 2 } }, 'delta', 'stream');
        const first = ledger.snapshot();
        expect(first.attempts).toHaveLength(2);
        expect(first.knownPhysicalTokens).toBe(7);
        expect(first.physicalTotalTokens).toBeNull(); // failed attempt has unknown cost
        expect(first.logicalCalls[0].totalTokens).toBeUndefined();
        await dispatch(200);
        observeAgentDebugResponse(call, { usage_metadata: { input_tokens: 3, output_tokens: 1 } }, 'replace', 'stream');
        const ambiguous = ledger.snapshot();
        expect(ambiguous.knownPhysicalTokens).toBe(7);
        expect(ambiguous.logicalCalls[0].totalTokens).toBeUndefined();
        expect(ambiguous.logicalCalls[0].complete).toBe(false);
        expect(ambiguous.physicalAttribution).toBe('incomplete');
    });

    it('does not mark an observed logical-only call as physically complete', () => {
        const ledger = new PaAgentRunUsageLedger();
        ledger.dispatch('A', 'answer', 'http-A');
        ledger.response('A', 'answer', 'http-A', 200);
        ledger.record('A', 'answer', { totalTokens: 7, complete: true, aggregation: 'cumulative' }, 'stream');
        ledger.finishResponsePhase('A', 'completed');
        ledger.record('B', 'query_rewrite', { totalTokens: 3, complete: true,
            aggregation: 'cumulative' }, 'provider-usage');
        expect(ledger.snapshot()).toMatchObject({ knownPhysicalTokens: 7,
            physicalTotalTokens: null, physicalAttribution: 'incomplete',
            logicalTotalTokens: null, knownUnassignedLogicalTokens: 3 });
    });

    it('counts a rejected pre-dispatch call as zero physical cost', () => {
        const ledger = new PaAgentRunUsageLedger();
        ledger.dispatch('A', 'answer', 'http-A');
        ledger.response('A', 'answer', 'http-A', 200);
        ledger.record('A', 'answer', { totalTokens: 10, complete: true }, 'provider-usage');
        ledger.finishResponsePhase('A', 'completed');
        ledger.beginResponsePhase('B', 'context_summary');
        expect(ledger.snapshot()).toMatchObject({ physicalAttribution: 'complete', physicalTotalTokens: 10,
            knownUnassignedLogicalTokens: null, logicalTotalTokens: null,
            logicalCalls: [{ totalTokens: 10, basis: 'physical_derived' },
                { totalTokens: 0, complete: true, basis: 'no_dispatch' }] });
    });

    it.each(['native', 'obsidian'] as const)('does not invent an %s attempt when transport setup throws synchronously', transport => {
        const ledger = new PaAgentRunUsageLedger();
        ledger.dispatch('A', 'answer', 'http-A');
        ledger.response('A', 'answer', 'http-A', 200);
        ledger.record('A', 'answer', { totalTokens: 10, complete: true }, 'provider-usage');
        ledger.finishResponsePhase('A', 'completed');
        const { recorder, events } = capture();
        const call: AgentDebugCallScope = { recorder, usageLedger: ledger,
            callId: 'B', parentId: 'turn', purpose: 'context_summary' };
        ledger.beginResponsePhase('B', 'context_summary');
        const trace = jest.fn();
        expect(() => traceProviderDispatch((): Promise<{ status: number }> => {
            throw new Error('synchronous transport setup failure');
        }, transport, trace, '{"messages":[]}', () => true, { call })).toThrow('synchronous transport setup failure');
        expect(ledger.snapshot()).toMatchObject({ physicalAttribution: 'complete', physicalTotalTokens: 10,
            logicalCalls: [{ basis: 'physical_derived', totalTokens: 10 },
                { basis: 'no_dispatch', totalTokens: 0 }] });
        expect(ledger.snapshot().attempts).toHaveLength(1);
        expect(events.filter(event => event.kind === 'attempt')).toHaveLength(0);
        expect(trace).not.toHaveBeenCalled();
    });

    it('matches admitted physical requests when the eval request budget rejects the next fetch synchronously', async () => {
        const ledger = new PaAgentRunUsageLedger();
        const { recorder, events } = capture();
        const admittedFetch = jest.fn(async () => ({ status: 200 }) as Response) as unknown as typeof fetch;
        const budget = createPaRuntimeEvalRequestBudget(admittedFetch, 1);
        const first: AgentDebugCallScope = { recorder, usageLedger: ledger,
            callId: 'A', parentId: 'turn', purpose: 'answer' };
        await traceProviderDispatch(() => budget.fetch('https://b149-offline.invalid/first'),
            'native', undefined, '{"messages":[]}', () => true, { call: first });
        observeAgentDebugResponse(first, { usage_metadata: { input_tokens: 7, output_tokens: 3 } });
        observeAgentDebugCall(first, { phase: 'consumer_end', status: 'completed' });
        const priorDebugAttempts = events.filter(event => event.kind === 'attempt').length;
        const second: AgentDebugCallScope = { recorder, usageLedger: ledger,
            callId: 'B', parentId: 'turn', purpose: 'context_summary' };
        ledger.beginResponsePhase('B', 'context_summary');
        expect(() => traceProviderDispatch(() => budget.fetch('https://b149-offline.invalid/second'),
            'native', undefined, '{"messages":[]}', () => true, { call: second }))
            .toThrow('B149_EVAL_PHYSICAL_REQUEST_LIMIT:1');
        expect(budget.count()).toBe(1);
        expect(admittedFetch).toHaveBeenCalledTimes(1);
        expect(ledger.snapshot()).toMatchObject({ physicalTotalTokens: 10, physicalAttribution: 'complete',
            logicalCalls: [{ basis: 'physical_derived', totalTokens: 10 }, { basis: 'no_dispatch', totalTokens: 0 }] });
        expect(ledger.snapshot().attempts).toHaveLength(budget.count());
        expect(events.filter(event => event.kind === 'attempt')).toHaveLength(priorDebugAttempts);
    });

    it.each(['cancelled', 'failed', 'partial'] as const)('keeps known usage on a unique response after %s terminal', outcome => {
        const ledger = new PaAgentRunUsageLedger();
        ledger.dispatch('A', 'answer', 'http-A');
        ledger.response('A', 'answer', 'http-A', 200);
        if (outcome === 'partial') ledger.finishResponsePhase('A', 'partial');
        else ledger.fail('http-A', outcome === 'cancelled');
        expect(ledger.record('A', 'answer', { inputTokens: 5, outputTokens: 2,
            totalTokens: 7, complete: true, aggregation: 'cumulative' }, 'provider-usage')).toBe('http-A');
        expect(ledger.snapshot()).toMatchObject({ knownPhysicalTokens: 7,
            physicalTotalTokens: null, physicalAttribution: 'incomplete',
            knownUnassignedLogicalTokens: null,
            attempts: [{ attemptId: 'http-A', status: outcome, totalTokens: 7, complete: false }],
            logicalCalls: [{ basis: 'unknown', complete: false }] });
    });

    it('derives a logical call from two complete physical attempts without adding it twice', () => {
        const ledger = new PaAgentRunUsageLedger();
        ledger.dispatch('A', 'answer', 'http-A', { tokens: 11, method: 'cjk_json_messages' });
        ledger.response('A', 'answer', 'http-A', 200);
        ledger.record('A', 'answer', { inputTokens: 5, outputTokens: 2, totalTokens: 7,
            complete: true, aggregation: 'cumulative' }, 'stream');
        ledger.finishResponsePhase('A', 'completed');
        ledger.beginResponsePhase('A', 'answer');
        ledger.dispatch('A', 'answer', 'http-B', { tokens: 12, method: 'cjk_json_messages' });
        ledger.response('A', 'answer', 'http-B', 200);
        ledger.record('A', 'answer', { inputTokens: 2, outputTokens: 1, totalTokens: 3,
            complete: true, aggregation: 'cumulative' }, 'stream');
        ledger.finishResponsePhase('A', 'completed');
        expect(ledger.snapshot()).toMatchObject({ physicalAttribution: 'complete', physicalTotalTokens: 10,
            logicalTotalTokens: null, logicalCalls: [{ totalTokens: 10, complete: true, basis: 'physical_derived' }],
            attempts: [{ estimatedPromptTokens: 11, measuredPromptTokens: 5 },
                { estimatedPromptTokens: 12, measuredPromptTokens: 2 }] });
    });

    it('keeps an early complete usage update incomplete after consumer truncation', async () => {
        const ledger = new PaAgentRunUsageLedger();
        const { recorder } = capture();
        const call: AgentDebugCallScope = { recorder, usageLedger: ledger,
            callId: 'answer', parentId: 'turn', purpose: 'answer' };
        await traceProviderDispatch(() => Promise.resolve({ status: 200 }), 'native', undefined,
            '{"messages":[]}', () => false, { call });
        observeAgentDebugResponse(call, { usage_metadata: { input_tokens: 5, output_tokens: 2 } });
        observeAgentDebugCall(call, { phase: 'consumer_end', status: 'partial',
            missingReason: 'consumer_closed_before_eof' });
        expect(ledger.snapshot()).toMatchObject({ knownPhysicalTokens: 7,
            physicalTotalTokens: null, physicalAttribution: 'incomplete',
            attempts: [{ status: 'partial', complete: false }] });
    });

    it('keeps invoke response usage if cancellation lands before content delivery', async () => {
        const ledger = new PaAgentRunUsageLedger();
        const { recorder, events } = capture();
        const call: AgentDebugCallScope = { recorder, usageLedger: ledger,
            callId: 'answer', parentId: 'turn', purpose: 'answer' };
        const controller = new AbortController();
        const consuming = async () => {
            for await (const _chunk of streamWithInvokeFallback({ input: {}, signal: controller.signal,
                debugCall: call, chain: {
                    stream: async function* () { throw new Error('stream setup failed'); },
                    invoke: async () => {
                        await traceProviderDispatch(() => Promise.resolve({ status: 200 }), 'native', undefined,
                            '{"messages":[]}', () => false, { call });
                        controller.abort();
                        return { content: 'MUST_NOT_DELIVER', additional_kwargs: { reasoning_content: 'MUST_NOT_REASON' },
                            usage_metadata: { input_tokens: 5, output_tokens: 2 } };
                    },
                } })) {
                throw new Error('Cancelled invoke delivered content');
            }
        };
        await expect(consuming()).rejects.toThrow();
        expect(ledger.snapshot()).toMatchObject({ knownPhysicalTokens: 7,
            physicalTotalTokens: null, physicalAttribution: 'incomplete',
            attempts: [{ purpose: 'answer', totalTokens: 7, status: 'cancelled', complete: false }] });
        expect(events.some(event => event.text?.includes('MUST_NOT_DELIVER')
            || event.reasoning?.includes('MUST_NOT_REASON'))).toBe(false);
    });

    it('keeps a returned stream usage chunk when cancellation arrives before chunk delivery', async () => {
        const ledger = new PaAgentRunUsageLedger();
        const { recorder, events } = capture();
        const call: AgentDebugCallScope = { recorder, usageLedger: ledger,
            callId: 'answer', parentId: 'turn', purpose: 'answer' };
        const controller = new AbortController();
        const invoke = jest.fn(async () => ({ content: 'MUST_NOT_INVOKE' }));
        const delivered: unknown[] = [];
        const consuming = async () => {
            for await (const chunk of streamWithInvokeFallback({ input: {}, signal: controller.signal,
                debugCall: call, chain: {
                    stream: async function* () {
                        await traceProviderDispatch(() => Promise.resolve({ status: 200 }), 'native', undefined,
                            '{"messages":[]}', () => false, { call });
                        controller.abort();
                        yield { content: 'MUST_NOT_DELIVER', additional_kwargs: { reasoning_content: 'MUST_NOT_REASON' },
                            usage_metadata: { input_tokens: 5, output_tokens: 2 } };
                    },
                    invoke,
                } })) delivered.push(chunk);
        };
        await expect(consuming()).rejects.toThrow();
        expect(delivered).toEqual([]);
        expect(invoke).not.toHaveBeenCalled();
        expect(ledger.snapshot()).toMatchObject({ knownPhysicalTokens: 7,
            physicalTotalTokens: null, physicalAttribution: 'incomplete',
            attempts: [{ purpose: 'answer', totalTokens: 7, status: 'cancelled', complete: false }] });
        expect(events.some(event => event.text?.includes('MUST_NOT_DELIVER')
            || event.reasoning?.includes('MUST_NOT_REASON'))).toBe(false);
    });

    it.each(['stream', 'invoke'] as const)('keeps %s usage but hides stale answer content from Debug', async path => {
        const ledger = new PaAgentRunUsageLedger();
        const { recorder, events } = capture();
        const call: AgentDebugCallScope = { recorder, usageLedger: ledger,
            callId: 'answer', parentId: 'turn', purpose: 'answer' };
        let current = true;
        const response = { content: 'STALE_ANSWER_CONTENT',
            additional_kwargs: { reasoning_content: 'STALE_ANSWER_REASON' },
            usage_metadata: { input_tokens: 5, output_tokens: 2 } };
        const invoke = jest.fn(async () => {
            await traceProviderDispatch(() => Promise.resolve({ status: 200 }), 'native', undefined,
                '{"messages":[]}', () => false, { call });
            current = false;
            return response;
        });
        const delivered: unknown[] = [];
        const consuming = async () => {
            for await (const chunk of streamWithInvokeFallback({ input: {}, debugCall: call,
                isDebugContentCurrent: () => current,
                chain: { stream: async function* () {
                    if (path === 'invoke') throw new Error('stream setup failed');
                    await traceProviderDispatch(() => Promise.resolve({ status: 200 }), 'native', undefined,
                        '{"messages":[]}', () => false, { call });
                    current = false;
                    yield response;
                }, invoke },
            })) delivered.push(chunk);
        };
        await consuming();
        expect(delivered.length).toBeGreaterThan(0); // The caller's final source guard owns delivery/recovery.
        expect(invoke).toHaveBeenCalledTimes(path === 'invoke' ? 1 : 0);
        expect(ledger.snapshot()).toMatchObject({ knownPhysicalTokens: 7,
            attempts: [{ purpose: 'answer', totalTokens: 7 }] });
        expect(events.some(event => event.text?.includes('STALE_ANSWER_CONTENT')
            || event.reasoning?.includes('STALE_ANSWER_REASON'))).toBe(false);
    });

    it('records rerank usage without exposing a response after candidate identity changes', async () => {
        const ledger = new PaAgentRunUsageLedger();
        const { recorder, events } = capture();
        let current = true;
        const aiUtils = { createChatModel: jest.fn(async (_temperature: number,
            options: { agentDebugCall?: AgentDebugCallScope }) => RunnableLambda.from(async () => {
            await traceProviderDispatch(() => Promise.resolve({ status: 200 }), 'native', undefined,
                '{"messages":[]}', () => false, { call: options.agentDebugCall });
            current = false;
            return { content: 'STALE_RERANK_CONTENT', additional_kwargs: { reasoning_content: 'STALE_RERANK_REASON' },
                usage_metadata: { input_tokens: 5, output_tokens: 2 } };
        })) };
        const tool = new MemorySearchTool({ settings: { aiProvider: 'openai', chatModelName: 'fixture-model',
            retrievalOptimizationFlags: {} } } as never, aiUtils as never);
        const prepared = await (tool as any).prepareReranker({ kind: 'chat', modelName: 'fixture-model' },
            new AbortController().signal, Date.now() + 5_000,
            { debugScope: { recorder, usageLedger: ledger, parentId: 'turn' } });
        try {
            await prepared.invoke('query', [{ candidateId: 'candidate', path: 'notes/current.md',
                score: 0.9, documents: [], excerpt: 'Current evidence' }], async () => current);
            expect(ledger.snapshot()).toMatchObject({ knownPhysicalTokens: 7,
                physicalTotalTokens: null, physicalAttribution: 'incomplete',
                attempts: [{ purpose: 'rerank', totalTokens: 7, status: 'failed', complete: false }] });
            expect(events.some(event => event.text?.includes('STALE_RERANK_CONTENT')
                || event.reasoning?.includes('STALE_RERANK_REASON'))).toBe(false);
        } finally {
            prepared.dispose();
            tool.dispose();
        }
    });

    it('keeps query rewrite usage but hides a response after its source scope changes', async () => {
        const ledger = new PaAgentRunUsageLedger();
        const { recorder, events } = capture();
        let current = true;
        const aiUtils = { createChatModel: jest.fn(async (_temperature: number,
            options: { agentDebugCall?: AgentDebugCallScope }) => RunnableLambda.from(async () => {
            await traceProviderDispatch(() => Promise.resolve({ status: 200 }), 'native', undefined,
                '{"messages":[]}', () => false, { call: options.agentDebugCall });
            current = false;
            return { content: '{"keywords":"STALE_REWRITE_CONTENT"}',
                additional_kwargs: { reasoning_content: 'STALE_REWRITE_REASON' },
                usage_metadata: { input_tokens: 5, output_tokens: 2 } };
        })) };
        const tool = new MemorySearchTool({ settings: { aiProvider: 'openai', chatModelName: 'fixture-model',
            debug: false } } as never, aiUtils as never, 'chat', {
            isCurrent: () => current, isMemoryAllowed: () => true, isPathAllowed: () => true,
        });
        try {
            const result = await (tool as any).rewriteQueryWithTimeout('Find the detailed launch requirements',
                'fixture-model', undefined, { debugScope: { recorder, usageLedger: ledger, parentId: 'turn' } });
            expect(result.keywords).toBeNull();
            expect(ledger.snapshot()).toMatchObject({ knownPhysicalTokens: 7,
                physicalTotalTokens: null, physicalAttribution: 'incomplete',
                attempts: [{ purpose: 'query_rewrite', totalTokens: 7, status: 'failed', complete: false }] });
            expect(events.some(event => event.text?.includes('STALE_REWRITE_CONTENT')
                || event.reasoning?.includes('STALE_REWRITE_REASON'))).toBe(false);
        } finally { tool.dispose(); }
    });

    it('separates response usage from approved Debug content without billing twice', async () => {
        const ledger = new PaAgentRunUsageLedger();
        const { recorder, events } = capture();
        const call: AgentDebugCallScope = { recorder, usageLedger: ledger,
            callId: 'summary', parentId: 'turn', purpose: 'context_summary' };
        await traceProviderDispatch(() => Promise.resolve({ status: 200 }), 'native', undefined,
            '{"messages":[]}', () => false, { call });
        const response = { content: 'APPROVED_SUMMARY', additional_kwargs: { reasoning_content: 'APPROVED_REASON' },
            usage_metadata: { input_tokens: 5, output_tokens: 2 } };
        observeAgentDebugResponse(call, response, 'replace', 'provider-usage', 'usage_only');
        expect(events.some(event => event.text || event.reasoning)).toBe(false);
        observeAgentDebugResponse(call, response, 'replace', 'provider-usage', 'content_only');
        observeAgentDebugCall(call, { phase: 'consumer_end', status: 'completed' });
        expect(ledger.snapshot()).toMatchObject({ knownPhysicalTokens: 7,
            physicalTotalTokens: 7, physicalAttribution: 'complete' });
        expect(events.filter(event => event.phase === 'usage' && event.kind === 'attempt')).toHaveLength(1);
        expect(events.filter(event => event.text === 'APPROVED_SUMMARY'
            && event.reasoning === 'APPROVED_REASON')).toHaveLength(1);
    });
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
        call.usageLedger = new PaAgentRunUsageLedger();
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

    it('does not invent a provider total from one-sided usage', async () => {
        const chunks = [];
        for await (const chunk of streamWithInvokeFallback({ input: {}, chain: {
            stream: async function* () { yield { usage_metadata: { output_tokens: 10 } }; },
            invoke: async () => ({ content: '' }),
        } })) chunks.push(chunk);
        expect(chunks).toContainEqual({ type: 'diagnostic', diagnostic: {
            type: 'provider_usage', usage: { completionTokens: 10 },
        } });
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
