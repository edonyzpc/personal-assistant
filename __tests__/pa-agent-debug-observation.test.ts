import { describe, expect, it, jest } from "@jest/globals";
import { RunnableLambda } from "@langchain/core/runnables";
import type { AgentDebugCallScope, AgentDebugObservation, AgentDebugRunRecorder } from "../src/ai-services/agent-debug-port";
import { agentDebugError, createAgentDebugCall, observeAgentDebugCall, observeAgentDebugLifecycle, observeAgentDebugPhase, observeAgentDebugResponse, observeAgentDebugToolResult, readAgentDebugUsage } from "../src/ai-services/agent-debug-observation";
import { createAgentDebugLog, createAgentEventDebugObserver, traceAgentPhase, type AgentDebugFields } from "../src/ai-services/pa-agent-debug";
import { PaAgentLoop } from "../src/ai-services/pa-agent-loop";
import { createPaAgentHostPolicy } from "../src/ai-services/pa-agent-host-policy";
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
    it('pairs repeated and concurrent real phases by their execution identity', async () => {
        const { events, recorder } = capture();
        const log = createAgentDebugLog(() => true,
            (_message, fields) => observeAgentDebugPhase(recorder, String(fields.phase), fields), {});
        let finishFirst!: () => void;
        let finishSecond!: () => void;
        const first = traceAgentPhase(log, 'prepare', () => new Promise<void>(resolve => { finishFirst = resolve; }), { turnId: 'turn' });
        const second = traceAgentPhase(log, 'prepare', () => new Promise<void>(resolve => { finishSecond = resolve; }), { turnId: 'turn' });
        finishSecond(); await second;
        finishFirst(); await first;
        await traceAgentPhase(log, 'prepare', () => undefined, { turnId: 'turn' });
        expect(events.map(event => event.boundary)).toEqual(['start', 'start', 'end', 'end', 'start', 'end']);
        expect(events[0].nodeId).toBe(events[3].nodeId);
        expect(events[1].nodeId).toBe(events[2].nodeId);
        expect(events[4].nodeId).toBe(events[5].nodeId);
        expect(new Set(events.map(event => event.nodeId)).size).toBe(3);
        log('recovery', { turnId: 'turn' }); log('recovery', { turnId: 'turn' });
        expect(events.slice(-2).every(event => event.boundary === 'instant')).toBe(true);
        expect(events.at(-1)?.nodeId).not.toBe(events.at(-2)?.nodeId);
    });

    it('records an aborted real preparation phase as cancelled', async () => {
        const { recorder, events } = capture();
        const log = createAgentDebugLog(() => true,
            (_message, fields) => observeAgentDebugPhase(recorder, String(fields.phase), fields), {});
        const error = Object.assign(new Error('cancelled preparation'), { name: 'AbortError' });
        await expect(traceAgentPhase(log, 'host_context', () => { throw error; })).rejects.toBe(error);
        expect(events.map(event => event.boundary)).toEqual(['start', 'end']);
        expect(events[0].nodeId).toBe(events[1].nodeId);
        expect(events[1].status).toBe('cancelled');
    });

    it.each(['completed', 'failed', 'cancelled'] as const)(
        'measures actual model waiting separately from preparation when the model is %s', async outcome => {
            const { recorder, events } = capture();
            let monotonic = 0;
            let businessClock = 1000;
            const monotonicClock = jest.spyOn(performance, 'now').mockImplementation(() => monotonic);
            const abort = new AbortController();
            try {
                const log = createAgentDebugLog(() => true,
                    (_message, fields) => observeAgentDebugPhase(recorder, String(fields.phase), fields), {});
                const result = await new PaAgentLoop({
                    runId: 'timed-run', userInput: 'Return the controlled result', maxTurns: 1,
                    now: () => businessClock, signal: abort.signal,
                    prepareModelInput: async input => {
                        await Promise.resolve();
                        monotonic += 100;
                        businessClock += 100;
                        return input;
                    },
                    model: { stream: async function* () {
                        monotonic += 25;
                        businessClock += 25;
                        if (outcome === 'failed') throw new Error('controlled model failure');
                        if (outcome === 'cancelled') {
                            abort.abort();
                            return;
                        }
                        yield { type: 'text_delta', text: 'Controlled result.' } as const;
                        yield { type: 'provider_completion', completion: 'stop' } as const;
                    } },
                    onDebug: log,
                }).run();
                const waiting = events.filter(event => event.phase.startsWith('model_wait:'));
                expect(waiting.map(event => event.boundary)).toEqual(['start', 'end']);
                expect(waiting[0].nodeId).toBe(waiting[1].nodeId);
                expect(waiting[1]).toMatchObject({ durationMs: 25, status: outcome });
                // The existing business metric includes request preparation.
                expect(result.turns[0].timing.modelElapsedMs).toBe(125);
            } finally {
                monotonicClock.mockRestore();
            }
        });

    it('observes a multi-turn parallel-tool loop once through the lifecycle and console chain', async () => {
        const { events, recorder } = capture();
        const consoleLog = jest.fn<(message: string, fields: AgentDebugFields) => void>();
        const log = createAgentDebugLog(() => true, (message, fields) => {
            observeAgentDebugPhase(recorder, String(fields.phase), fields);
            consoleLog(message, fields);
        }, {});
        const logLifecycle = createAgentEventDebugObserver(log);
        let modelTurns = 0;
        const result = await new PaAgentLoop({
            runId: 'observed-run', userInput: 'Read both notes', maxTurns: 2, toolExecutionMode: 'hybrid',
            hostPolicy: createPaAgentHostPolicy(),
            prepareModelInput: input => input,
            model: { stream: async function* () {
                if (++modelTurns === 1) {
                    yield { type: 'toolcall_delta', id: 'a', name: 'read_note', input: { path: 'a.md' }, index: 0 } as const;
                    yield { type: 'toolcall_delta', id: 'b', name: 'read_note', input: { path: 'b.md' }, index: 1 } as const;
                    yield { type: 'provider_completion', completion: 'tool_calls' } as const;
                } else {
                    yield { type: 'text_delta', text: 'Both notes read.' } as const;
                    yield { type: 'provider_completion', completion: 'stop' } as const;
                }
            } },
            toolExecutor: { getRetrySafety: () => 'read_only', execute: async () => ({ outcome: 'success', promptText: 'note read' }) },
            onDebug: log,
            onEvent: event => { observeAgentDebugLifecycle(recorder, event); logLifecycle(event); },
        }).run();
        expect(result.status).toBe('completed');
        expect(modelTurns).toBe(2);
        const turns = events.filter(event => event.kind === 'turn');
        expect(turns.map(event => event.boundary)).toEqual(['start', 'end', 'start', 'end']);
        expect(new Set(turns.map(event => event.nodeId)).size).toBe(2);
        expect(events.filter(event => event.kind === 'tool' && event.boundary === 'start')).toHaveLength(2);
        expect(events.filter(event => event.kind === 'tool' && event.boundary === 'end')).toHaveLength(2);
        expect(events.filter(event => event.kind === 'phase').some(event =>
            ['agent_start', 'agent_end', 'turn_start', 'turn_end', 'message_end', 'tool_execution_start', 'tool_execution_end'].includes(event.phase))).toBe(false);
        expect(consoleLog.mock.calls.some(([, fields]) => fields.phase === 'turn_start')).toBe(true);
        for (const phase of ['loop_input_prepare', 'model_wait']) {
            const phases = events.filter(event => event.phase.startsWith(`${phase}:`));
            expect(phases.map(event => event.boundary)).toEqual(['start', 'end', 'start', 'end']);
            expect(phases[0].nodeId).toBe(phases[1].nodeId);
            expect(phases[2].nodeId).toBe(phases[3].nodeId);
            expect(phases[0].nodeId).not.toBe(phases[2].nodeId);
        }
    });

    it('retains executed tool results separately from the text presented to the model', () => {
        const { recorder, events } = capture();
        observeAgentDebugToolResult(recorder, { turnId: 'turn', toolCallId: 'call', toolName: 'read_note',
            result: { data: 'complete result' }, toolInput: { path: 'a.md' } });
        observeAgentDebugLifecycle(recorder, { version: 2, runId: 'run', turnId: 'turn', scope: 'turn', timestamp: 1, seq: 3,
            type: 'message_end', message: { role: 'toolResult', id: 'result', timestamp: 1, toolCallId: 'call',
                toolName: 'read_note', isError: false, content: { promptText: 'trimmed observation', includeInNextPrompt: true } } });
        expect(events.map(event => event.contentRole)).toEqual(['actual_tool_result', 'model_tool_observation']);
        expect(events[0].nodeId).toBe(events[1].nodeId);
        expect(events.map(event => event.toolOutput)).toEqual([{ data: 'complete result' }, 'trimmed observation']);
        expect(events.every(event => event.boundary === 'update')).toBe(true);
    });

    it('does not reopen a terminal call when content or usage arrives later', () => {
        const { recorder, events } = capture();
        const call = createAgentDebugCall(recorder, { callId: 'call', parentId: 'turn', turnId: 'turn', purpose: 'answer' });
        observeAgentDebugCall(call, { phase: 'consumer_end', status: 'completed' });
        observeAgentDebugResponse(call, { content: 'late content', usage_metadata: { input_tokens: 2, output_tokens: 1 } });
        expect(events[0]).toMatchObject({ boundary: 'start', status: 'running' });
        expect(events[1]).toMatchObject({ boundary: 'end', status: 'completed' });
        expect(events[2]).toMatchObject({ boundary: 'update', text: 'late content', usage: { totalTokens: 3 } });
        expect(events[2].status).toBeUndefined();
    });

    it.each(['native', 'obsidian'] as const)('keeps %s HTTP console events out of phase nodes while preserving actual attempts', async transport => {
        const { recorder, call, events } = capture();
        const log = createAgentDebugLog(() => true,
            (_message, fields) => observeAgentDebugPhase(recorder, String(fields.phase), fields), {});
        await traceProviderDispatch(() => Promise.resolve({ status: 200 }), transport,
            event => log(event.phase, { ...event, observationSource: 'transport' }), '{"messages":[]}', () => true, { call });
        observeAgentDebugCall(call, { phase: 'consumer_end', status: 'completed' });
        const attempts = events.filter(event => event.kind === 'attempt');
        expect(attempts.map(event => event.boundary)).toEqual(['start', transport === 'obsidian' ? 'end' : 'update']);
        expect(new Set(attempts.map(event => event.nodeId)).size).toBe(1);
        expect(events.some(event => event.kind === 'phase')).toBe(false);
    });

    it('keeps major phase duration without persisting detailed per-source probes', () => {
        const { events, recorder } = capture();
        observeAgentDebugPhase(recorder, 'provider_source_prepare:end', { turnId: 'turn', durationMs: 137512,
            sourceVisits: 100000, arbitrary: 'private detail' });
        expect(events[0]).toMatchObject({ phase: 'provider_source_prepare:end', durationMs: 137512, status: 'completed' });
        expect(events[0]).not.toHaveProperty('sourceVisits');
        expect(events[0]).not.toHaveProperty('arbitrary');
        observeAgentDebugPhase(recorder, 'runtime_startup_total', { elapsedMs: 42 });
        expect(events[1]).toMatchObject({ phase: 'runtime_startup_total', durationMs: 42 });
    });

    it('records every actually observed provider text block without a separate 256-block cutoff', () => {
        const { events, call } = capture();
        observeAgentDebugResponse(call, { content: Array.from({ length: 300 }, (_, index) => ({ type: 'text', text: `block-${index};` })) });
        expect(events[0].text).toContain('block-299;');
        expect(events[0].missingReason).toBeUndefined();
    });
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

    it.each(['stream', 'invoke'] as const)('keeps %s usage and actual content when sources change during generation', async path => {
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
        expect(current).toBe(false);
        expect(delivered.length).toBeGreaterThan(0);
        expect(invoke).toHaveBeenCalledTimes(path === 'invoke' ? 1 : 0);
        expect(ledger.snapshot()).toMatchObject({ knownPhysicalTokens: 7,
            attempts: [{ purpose: 'answer', totalTokens: 7 }] });
        expect(events.some(event => event.text?.includes('STALE_ANSWER_CONTENT'))).toBe(true);
        expect(events.some(event => event.reasoning?.includes('STALE_ANSWER_REASON'))).toBe(true);
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
