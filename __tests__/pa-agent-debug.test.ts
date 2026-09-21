import { describe, expect, it, jest } from '@jest/globals';
import { createAgentDebugLog, createAgentEventDebugObserver, describeAgentError, describeAgentText, traceAgentPhase } from '../src/ai-services/pa-agent-debug';
import { traceProviderDispatch, type ProviderRequestTrace } from '../src/ai-services/obsidian-fetch';
import type { AgentEvent } from '../src/ai-services/chat-types';

jest.mock('obsidian');

describe('PA Agent debug observation', () => {
    it.each(['done', 'idle', 'error', 'needs_follow_up', 'tool_results_ready', 'tool_batch_preflight_rejected',
        'reused_result', 'successful_result_reused', 'provider_attempt_timeout', 'provider_no_progress'])(
        'preserves the current host code %s', code => {
            const sink = jest.fn<(message: string, fields: Record<string, unknown>) => void>();
            const log = createAgentDebugLog(() => true, sink, {});
            log('test', { reason: code, outcome: code });
            expect(sink.mock.calls[0][1]).toMatchObject({ reason: code, outcome: code });
        });

    it('redacts unknown metadata codes and custom exception names', () => {
        const sink = jest.fn<(message: string, fields: Record<string, unknown>) => void>();
        const log = createAgentDebugLog(() => true, sink, {});
        log('test', { reason: { secret: 'PRIVATE' }, outcome: 'PRIVATE note path' });
        const error = new Error('PRIVATE'); error.name = 'PRIVATE';
        expect(describeAgentError(error)).toEqual({ errorType: 'unknown' });
        expect(sink.mock.calls[0][1]).toMatchObject({ reason: 'unknown', outcome: 'unknown' });
        expect(JSON.stringify(sink.mock.calls)).not.toContain('PRIVATE');
    });
    it('stays silent while disabled and cannot fail execution through a broken sink', async () => {
        const sink = jest.fn<(message: string, fields: Record<string, unknown>) => void>(() => { throw new Error('broken logger'); });
        let enabled = false;
        const log = createAgentDebugLog(() => enabled, sink, { runId: 'run' });
        expect(await traceAgentPhase(log, 'prepare', () => 42)).toBe(42);
        expect(sink).not.toHaveBeenCalled();
        enabled = true;
        expect(await traceAgentPhase(log, 'prepare', () => 43)).toBe(43);
        expect(sink).toHaveBeenCalledTimes(2);
        const error = new Error('Personal context changed before provider dispatch');
        await expect(traceAgentPhase(log, 'admission', () => { throw error; })).rejects.toBe(error);
        expect(sink.mock.calls.at(-1)?.[1]).toMatchObject({ phase: 'admission:error', localReason: 'personal_context_changed' });
    });

    it('distinguishes empty, whitespace, markup and real native tools without logging their content', () => {
        expect(describeAgentText(' \n')).toMatchObject({ chars: 2, visibleChars: 0, containsToolCallMarkup: false });
        const log = jest.fn();
        const observe = createAgentEventDebugObserver(log);
        const base = { version: 2, runId: 'run', turnId: 'turn_1', scope: 'turn', timestamp: 10, seq: 1 };
        observe({ ...base, type: 'message_end', message: {
            role: 'assistant', id: 'assistant', timestamp: 10, providerCompletion: 'stop', stopReason: 'stop',
            content: [{ type: 'text', text: 'PRIVATE <tool_calls>\n</tool_calls>' },
                { type: 'thinking', text: 'PRIVATE reasoning' },
                { type: 'toolCall', id: 'call', name: 'read_note', input: 'PRIVATE arguments', index: 0 }],
        } } as AgentEvent);
        expect(log).toHaveBeenCalledWith('message_end', expect.objectContaining({
            containsToolCallMarkup: true, providerCompletion: 'stop',
            toolCalls: [{ id: 'call', name: 'read_note', argumentChars: 17 }],
        }));
        expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE');
        const update = { ...base, type: 'message_update', messageId: 'assistant', update: { kind: 'text_delta', text: 'PRIVATE' } } as AgentEvent;
        observe(update); observe(update);
        expect(log.mock.calls.filter(([phase]) => phase === 'first_message_update')).toHaveLength(1);
    });

    it('retains refusal facts while excluding the tool payload and arbitrary metadata', () => {
        const log = jest.fn();
        createAgentEventDebugObserver(log)({ version: 2, runId: 'run', turnId: 'turn', scope: 'turn', timestamp: 1, seq: 2,
            type: 'message_end', message: { role: 'toolResult', id: 'result', timestamp: 1,
                toolCallId: 'call', toolName: 'read_note', isError: true,
                content: { promptText: 'PRIVATE observation', includeInNextPrompt: true,
                    metadata: { outcome: 'policy_rejected', reason: 'invalid_instruction_quote', preflightOnly: true,
                        batchPreflightRejected: true, payload: 'PRIVATE metadata' } },
            } });
        expect(log).toHaveBeenCalledWith('message_end', expect.objectContaining({ outcome: 'policy_rejected',
            reason: 'invalid_instruction_quote', preflightOnly: true, batchPreflightRejected: true }));
        expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE');
    });
});

describe('physical provider traces', () => {
    it('keeps HTTP timing separate from run timing through the scoped logger', async () => {
        const time = jest.spyOn(Date, 'now');
        try {
            time.mockReturnValue(100);
            const sink = jest.fn<(message: string, fields: Record<string, unknown>) => void>();
            const log = createAgentDebugLog(() => true, sink, { runId: 'run' });
            time.mockReturnValue(1000);
            let resolve!: (value: { status: number }) => void;
            const pending = new Promise<{ status: number }>(done => { resolve = done; });
            const result = traceProviderDispatch(() => pending, 'native', event => log(event.phase, { ...event }));
            time.mockReturnValue(1250);
            resolve({ status: 200 }); await result;
            expect(sink.mock.calls[1][1]).toMatchObject({ phase: 'http_response', elapsedMs: 250, runElapsedMs: 1150, timestamp: 1250 });
        } finally { time.mockRestore(); }
    });

    it('skips body parsing and observation after debug is disabled', async () => {
        const parse = jest.spyOn(JSON, 'parse');
        try {
            const observer = jest.fn();
            const pending = Promise.resolve({ status: 200 });
            expect(traceProviderDispatch(() => pending, 'native', observer, '{"messages":[]}', () => false)).toBe(pending);
            await pending;
            expect(parse).not.toHaveBeenCalled();
            expect(observer).not.toHaveBeenCalled();
        } finally { parse.mockRestore(); }
    });

    it('records dispatch immediately and headers separately, preserving the original promise and body privacy', async () => {
        let resolve!: (value: { status: number }) => void;
        const request = new Promise<{ status: number }>(done => { resolve = done; });
        const events: ProviderRequestTrace[] = [];
        const returned = traceProviderDispatch(() => request, 'native', event => events.push(event),
            JSON.stringify({ messages: [{ content: 'PRIVATE' }], tools: [{ name: 'PRIVATE' }] }));
        expect(returned).toBe(request);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ phase: 'http_dispatch', messageCount: 1, toolCount: 1 });
        resolve({ status: 200 }); await returned;
        expect(events[1]).toMatchObject({ phase: 'http_response', status: 200, requestId: events[0].requestId });
        expect(JSON.stringify(events)).not.toContain('PRIVATE');
    });

    it('preserves failures and consumes the observation branch even when the observer throws', async () => {
        const error = new Error('PRIVATE transport error');
        const events: ProviderRequestTrace[] = [];
        const request = Promise.reject<{ status: number }>(error);
        await expect(traceProviderDispatch(() => request, 'obsidian', event => {
            events.push(event); throw new Error('logger failed');
        })).rejects.toBe(error);
        expect(events.map(event => event.phase)).toEqual(['http_dispatch', 'http_error']);
        expect(JSON.stringify(events)).not.toContain('PRIVATE');
    });
});
