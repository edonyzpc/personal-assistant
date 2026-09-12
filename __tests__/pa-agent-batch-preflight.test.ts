import { describe, expect, it, jest } from '@jest/globals';
import { AgentLifecycleEventEmitter } from '../src/ai-services/agent-runtime-primitives';
import { createAgentControlSnapshot } from '../src/ai-services/pa-agent-control-policy';
import { ToolExecutionDispatcher } from '../src/ai-services/pa-agent-tool-dispatcher';
import { PaAgentLoop } from '../src/ai-services/pa-agent-loop';
import type { AgentEvent, PaAgentMessage } from '../src/ai-services/chat-types';
import type { BufferedToolCall, PaAgentToolExecutor, PaAgentToolExecutionResult } from '../src/ai-services/pa-agent-types';
import type { TaskSourceReadGuard } from '../src/ai-services/task-source-read-guard';

const denied: PaAgentToolExecutionResult = {
    outcome: 'policy_rejected', promptText: 'Choose one allowed source scope for the entire batch.',
    metadata: { reason: 'source_scope_mismatch' },
};

function call(id: string, name = 'search_memory', argsText = '{"query":"same"}', index = 0): BufferedToolCall {
    return { key: id, id, name, argsText, index, partIndex: index, hasStructuredInput: false };
}

function setup(preflightBatch?: PaAgentToolExecutor['preflightBatch'], maxToolCalls = 20) {
    const execute = jest.fn<PaAgentToolExecutor['execute']>(async () => ({ outcome: 'success', promptText: 'Read result' }));
    const canonical = jest.fn<NonNullable<PaAgentToolExecutor['getCanonicalToolCallKey']>>(() => undefined);
    const prepare = jest.fn<NonNullable<PaAgentToolExecutor['prepareBatch']>>(async () => undefined);
    const mode = jest.fn<NonNullable<PaAgentToolExecutor['getExecutionMode']>>(() => 'parallel');
    const executor: PaAgentToolExecutor = { execute, getCanonicalToolCallKey: canonical, prepareBatch: prepare,
        getExecutionMode: mode, ...(preflightBatch ? { preflightBatch } : {}) };
    let aborted = false;
    let expired = false;
    const results: PaAgentToolExecutionResult[] = [];
    const events = new AgentLifecycleEventEmitter({ runId: 'run', now: () => 1 });
    const dispatcher = new ToolExecutionDispatcher({ toolExecutor: executor, toolExecutionMode: 'hybrid',
        runId: 'run', userInput: 'Write with these sources', toolTimeoutMs: 1000,
        toolTimeoutOutcome: 'recoverable_error', toolAbortGraceMs: 1, maxToolCalls,
        now: () => 1, isAborted: () => aborted, isWallClockExceeded: () => expired,
        wallClockRemainingMs: () => 1000, events,
        emitToolResult: (_turnId, toolCall, result) => {
            results.push(result);
            return { role: 'toolResult', id: `result-${results.length}`, toolCallId: toolCall.id,
                toolName: toolCall.name, timestamp: 1, isError: !['success', 'control_applied', 'duplicate_skipped'].includes(result.outcome),
                content: { promptText: result.promptText, metadata: result.metadata,
                    includeInNextPrompt: result.includeInNextPrompt ?? true } } as Extract<PaAgentMessage, { role: 'toolResult' }>;
        },
    });
    return { dispatcher, executor, execute, canonical, prepare, mode, results,
        abort: () => { aborted = true; }, expire: () => { expired = true; } };
}

describe('complete tool batch Host preflight', () => {
    const control: PaAgentToolExecutionResult = { outcome: 'control_applied', promptText: 'Source scope established.' };
    function admitted(guard?: TaskSourceReadGuard) {
        return { kind: 'admitted' as const, taskSourceReadGuard: guard,
            controlResults: new Map([['declare', control]]) };
    }

    it('consumes a declaration before preparation, passes the exact batch guard, and preserves result order', async () => {
        const guard = { isCurrent: () => true, isPathAllowed: () => true };
        const f = setup(() => admitted(guard));
        const output = await f.dispatcher.executeBufferedToolCalls('turn', 0,
            [call('declare', 'declare_source_scope', '{}', 0), call('read', 'vault_read', '{"path":"a.md"}', 1)], 'normal', undefined);
        expect(f.canonical.mock.calls.every(([entry]) => entry.name === 'vault_read')).toBe(true);
        expect(f.mode.mock.calls.map(([name]) => name)).toEqual(['vault_read']);
        expect(f.prepare).toHaveBeenCalledTimes(1);
        expect(f.prepare.mock.calls[0][0]).toMatchObject({ taskSourceReadGuard: guard });
        expect(f.prepare.mock.calls[0][0].toolCalls.map((entry) => entry.id)).toEqual(['read']);
        expect(f.execute).toHaveBeenCalledTimes(1);
        expect(f.execute.mock.calls[0][0].taskSourceReadGuard).toBe(guard);
        expect(output.toolResults.map((result) => result.toolCallId)).toEqual(['declare', 'read']);
        expect(f.results[0]).toMatchObject({ outcome: 'control_applied', includeInNextPrompt: true,
            metadata: { sourceScopeControl: true, preflightOnly: true } });
        expect(f.dispatcher.toolCallCount).toBe(2);
        expect(JSON.stringify(output)).not.toContain('taskSourceReadGuard');
    });

    it.each(['unknown', 'ordinary', 'duplicate-id', 'malformed', 'unconsumed'] as const)(
        'rejects invalid %s control consumption before any tool callback', async (invalid) => {
            const controls = new Map([[invalid === 'unknown' ? 'missing' : invalid === 'ordinary' ? 'read' : 'declare', control]]);
            if (invalid === 'unconsumed') controls.clear();
            const f = setup(() => ({ kind: 'admitted', controlResults: controls }));
            await f.dispatcher.executeBufferedToolCalls('turn', 0, [
                call('declare', 'declare_source_scope', invalid === 'malformed' ? '{bad' : '{}'),
                call(invalid === 'duplicate-id' ? 'declare' : 'read', 'vault_read', '{"path":"a.md"}', 1),
            ], 'normal', undefined);
            for (const callback of [f.canonical, f.prepare, f.mode, f.execute]) expect(callback).not.toHaveBeenCalled();
            expect(f.results.map((entry) => entry.outcome)).toEqual(['policy_rejected', 'policy_rejected']);
            expect(f.dispatcher.toolCallCount).toBe(2);
        },
    );

    it('strips source observations from control receipts and never labels them source success', async () => {
        const f = setup(() => ({ kind: 'admitted', controlResults: new Map([['declare', {
            outcome: 'success', promptText: 'Scope established', sourceRecords: [], contextUsed: [],
            metadata: { outcome: 'success', sourceScopeControl: false, preflightOnly: false },
        }]]) }));
        await f.dispatcher.executeBufferedToolCalls('turn', 0, [call('declare', 'declare_source_scope')], 'normal', undefined);
        expect(f.results[0]).toMatchObject({ outcome: 'control_applied',
            metadata: { outcome: 'control_applied', sourceScopeControl: true, preflightOnly: true } });
        expect(f.results[0]).not.toHaveProperty('sourceRecords');
        expect(f.results[0]).not.toHaveProperty('contextUsed');
        expect(f.execute).not.toHaveBeenCalled();
    });

    it('reserves budget for consumed declarations before deciding which source calls may prepare', async () => {
        const f = setup(() => admitted(), 1);
        await f.dispatcher.executeBufferedToolCalls('turn', 0,
            [call('declare', 'declare_source_scope', '{}', 0), call('read', 'vault_read', '{"path":"a.md"}', 1)], 'normal', undefined);
        expect(f.prepare).not.toHaveBeenCalled();
        expect(f.execute).not.toHaveBeenCalled();
        expect(f.results.map((entry) => entry.outcome)).toEqual(['control_applied', 'budget_exceeded']);
        expect(f.dispatcher.toolCallCount).toBe(1);
    });

    it.each(['sequential', 'parallel'] as const)('reserves the last call for a trailing declaration in %s mode before any source preparation', async (mode) => {
        const f = setup(() => admitted(), 1);
        f.mode.mockReturnValue(mode);
        const result = await f.dispatcher.executeBufferedToolCalls('turn', 0,
            [call('read', 'vault_read', '{"path":"a.md"}', 0), call('declare', 'declare_source_scope', '{}', 1)], 'normal', undefined);
        expect(f.canonical).not.toHaveBeenCalled();
        expect(f.prepare).not.toHaveBeenCalled();
        expect(f.execute).not.toHaveBeenCalled();
        expect(result.toolResults.map((entry) => entry.toolCallId)).toEqual(['read', 'declare']);
        expect(f.results.map((entry) => entry.outcome)).toEqual(['budget_exceeded', 'control_applied']);
        expect(f.dispatcher.toolCallCount).toBe(1);
    });

    it('rejects excess admitted controls as a complete batch before any partial source preparation', async () => {
        const f = setup(() => ({ kind: 'admitted', controlResults: new Map([['declare', control], ['second-declare', control]]) }), 1);
        await f.dispatcher.executeBufferedToolCalls('turn', 0, [
            call('read', 'vault_read', '{"path":"a.md"}', 0),
            call('declare', 'declare_source_scope', '{}', 1), call('second-declare', 'declare_source_scope', '{}', 2),
        ], 'normal', undefined);
        for (const callback of [f.canonical, f.prepare, f.mode, f.execute]) expect(callback).not.toHaveBeenCalled();
        expect(f.results.map((entry) => entry.outcome)).toEqual(['policy_rejected', 'budget_exceeded', 'budget_exceeded']);
        expect(f.dispatcher.toolCallCount).toBe(1);
    });

    it.each(['preflight', 'canonical', 'preparation', 'preparation-error'] as const)(
        'rejects the complete admitted batch when its guard fails at %s', async (phase) => {
            let current = phase !== 'preflight';
            const guard = { isCurrent: () => current, isPathAllowed: () => true };
            const f = setup(() => admitted(guard));
            if (phase === 'canonical') f.canonical.mockImplementationOnce(() => { current = false; return undefined; });
            if (phase === 'preparation') f.prepare.mockImplementationOnce(async () => {
                await Promise.resolve(); current = false;
            });
            if (phase === 'preparation-error') f.prepare.mockRejectedValueOnce(new Error('Cannot prepare safely'));
            await f.dispatcher.executeBufferedToolCalls('turn', 0,
                [call('declare', 'declare_source_scope'), call('read', 'vault_read', '{"path":"a.md"}', 1)], 'normal', undefined);
            expect(f.execute).not.toHaveBeenCalled();
            expect(f.mode).not.toHaveBeenCalled();
            expect(f.results.map((entry) => entry.outcome)).toEqual(['policy_rejected', 'policy_rejected']);
            if (phase === 'preflight' || phase === 'canonical') expect(f.prepare).not.toHaveBeenCalled();
        },
    );

    it('rechecks at actual execution and discards parallel results when one call revokes the batch guard', async () => {
        let current = true;
        const guard = { isCurrent: () => current, isPathAllowed: () => true };
        const f = setup(() => ({ kind: 'admitted', taskSourceReadGuard: guard }));
        f.execute.mockImplementationOnce(async () => {
            current = false;
            return { outcome: 'success', promptText: 'Revoked secret' };
        });
        const result = await f.dispatcher.executeBufferedToolCalls('turn', 0,
            [call('first', 'vault_read', '{"path":"a.md"}', 0), call('second', 'vault_read', '{"path":"b.md"}', 1)], 'normal', undefined);
        expect(f.execute).toHaveBeenCalledTimes(1);
        expect(f.results.map((entry) => entry.outcome)).toEqual(['policy_rejected', 'policy_rejected']);
        expect(JSON.stringify(result)).not.toContain('Revoked secret');
    });

    it('keeps read guards local when two admitted batches overlap during preparation', async () => {
        const guards = [
            { isCurrent: () => true, isPathAllowed: (path: string) => path === 'a.md' },
            { isCurrent: () => true, isPathAllowed: (path: string) => path === 'b.md' },
        ];
        const f = setup((input) => ({ kind: 'admitted', taskSourceReadGuard: guards[input.turnIndex] }));
        let release!: () => void;
        let entered!: () => void;
        const started = new Promise<void>((resolve) => { entered = resolve; });
        f.prepare.mockImplementationOnce(async () => {
            entered(); await new Promise<void>((resolve) => { release = resolve; });
        });
        const first = f.dispatcher.executeBufferedToolCalls('a', 0, [call('a', 'vault_read', '{"path":"a.md"}')], 'normal', undefined);
        await started;
        await f.dispatcher.executeBufferedToolCalls('b', 1, [call('b', 'vault_read', '{"path":"b.md"}')], 'normal', undefined);
        release(); await first;
        expect(f.prepare.mock.calls.map(([input]) => input.taskSourceReadGuard)).toEqual(guards);
        expect(f.execute.mock.calls.map(([input]) => input.taskSourceReadGuard)).toEqual([guards[1], guards[0]]);
    });

    it('emits a real loop control receipt as non-error without presenting source success', async () => {
        const loop = new PaAgentLoop({ runId: 'control-only', userInput: 'Only current note', maxTurns: 1,
            model: { stream: async function* () {
                yield { type: 'toolcall_delta', id: 'declare', name: 'declare_source_scope', input: {}, index: 0 } as const;
            } }, toolExecutor: { preflightBatch: () => admitted(), execute: async () => { throw new Error('Must not execute'); } },
        });
        const result = await loop.run();
        expect(result.turns[0].toolResults[0]).toMatchObject({ isError: false,
            content: { includeInNextPrompt: true, metadata: { outcome: 'control_applied', sourceScopeControl: true, preflightOnly: true } } });
        expect(result.turns[0].toolResults.some((entry) => entry.content.metadata?.outcome === 'success')).toBe(false);
    });

    it('sees every parsed entry before policy filtering, duplicates, canonical keys or preparation', async () => {
        const preflight = jest.fn<NonNullable<PaAgentToolExecutor['preflightBatch']>>(() => denied);
        const f = setup(preflight);
        const snapshot = createAgentControlSnapshot({ blockedToolNames: new Set(['search_memory']) });
        const output = await f.dispatcher.executeBufferedToolCalls('turn', 2, [
            call('bad-json', 'vault_read', '{bad', 3), call('duplicate-2', 'search_memory', undefined, 2),
            call('placeholder', 'search_memory', '{}', 0), call('duplicate-1', 'search_memory', undefined, 1),
        ], 'normal', snapshot);
        expect(preflight).toHaveBeenCalledTimes(1);
        const input = preflight.mock.calls[0][0];
        expect(input).toMatchObject({ runId: 'run', turnId: 'turn', turnIndex: 2, userInput: 'Write with these sources' });
        expect(input.controlSnapshot).toBe(snapshot);
        expect(input).not.toHaveProperty('signal');
        expect(input.toolCalls.map((entry) => entry.id)).toEqual(['placeholder', 'duplicate-1', 'duplicate-2', 'bad-json']);
        expect(input.toolCalls[3].parseError).toEqual(expect.any(String));
        expect(input.toolCalls[1].input).toEqual(input.toolCalls[2].input);
        expect(f.canonical).not.toHaveBeenCalled();
        expect(f.prepare).not.toHaveBeenCalled();
        expect(f.mode).not.toHaveBeenCalled();
        expect(f.execute).not.toHaveBeenCalled();
        expect(output.toolResults).toHaveLength(4);
        expect(f.results.every((result) => result.outcome === 'policy_rejected' && result.promptText === denied.promptText)).toBe(true);
        expect(output.diagnostics).toEqual([{ type: 'tool_batch_preflight_rejected', toolCallCount: 4 }]);
        expect(f.dispatcher.toolCallCount).toBe(4);
    });

    it.each(['throw', 'promise', 'invalid'] as const)('fails closed on %s without any other executor callback', async (failure) => {
        const preflight = (() => {
            if (failure === 'throw') throw new TypeError('Sensitive host fact');
            if (failure === 'promise') return Promise.reject(new Error('Invalid async preflight'));
            return null;
        }) as unknown as PaAgentToolExecutor['preflightBatch'];
        const f = setup(preflight);
        const output = await f.dispatcher.executeBufferedToolCalls('turn', 0, [call('one'), call('two')], 'normal', undefined);
        expect(output.diagnostics).toEqual([{ type: 'tool_batch_preflight_failed', errorType: failure === 'throw' ? 'TypeError' : 'Error' }]);
        expect(output.toolResults).toHaveLength(2);
        expect(f.results.every((result) => result.outcome === 'policy_rejected' && result.includeInNextPrompt)).toBe(true);
        expect(JSON.stringify(output)).not.toContain('Sensitive host fact');
        for (const callback of [f.canonical, f.prepare, f.mode, f.execute]) expect(callback).not.toHaveBeenCalled();
    });

    it('normalizes a rejection into corrective failure without source observations or successful progress', async () => {
        const f = setup(() => ({ outcome: 'success', promptText: denied.promptText, includeInNextPrompt: false,
            sourceRecords: [], contextUsed: [], metadata: { outcome: 'success', preflightOnly: false } }));
        await f.dispatcher.executeBufferedToolCalls('turn', 0, [call('one')], 'normal', undefined);
        expect(f.results[0]).toMatchObject({ outcome: 'policy_rejected', includeInNextPrompt: true,
            metadata: { outcome: 'policy_rejected', preflightOnly: true, batchPreflightRejected: true } });
        expect(f.results[0]).not.toHaveProperty('sourceRecords');
        expect(f.results[0]).not.toHaveProperty('contextUsed');
    });

    it('charges repeated denied batches to the existing call cap and skips the hook after exhaustion', async () => {
        const preflight = jest.fn<NonNullable<PaAgentToolExecutor['preflightBatch']>>(() => denied);
        const f = setup(preflight, 3);
        for (let index = 0; index < 3; index++) {
            await f.dispatcher.executeBufferedToolCalls(`turn-${index}`, index, [call('one'), call('two')], 'normal', undefined);
        }
        expect(f.results.map((result) => result.outcome)).toEqual([
            'policy_rejected', 'policy_rejected', 'policy_rejected', 'budget_exceeded', 'budget_exceeded', 'budget_exceeded',
        ]);
        expect(f.dispatcher.toolCallCount).toBe(3);
        expect(preflight).toHaveBeenCalledTimes(2);
        expect(f.execute).not.toHaveBeenCalled();
    });

    it('allows a corrected retry without treating the denied batch as executed duplicates', async () => {
        const preflight = jest.fn<NonNullable<PaAgentToolExecutor['preflightBatch']>>()
            .mockReturnValueOnce(denied).mockReturnValue(undefined);
        const f = setup(preflight);
        await f.dispatcher.executeBufferedToolCalls('first', 0, [call('one')], 'normal', undefined);
        await f.dispatcher.executeBufferedToolCalls('second', 1, [call('one')], 'normal', undefined);
        expect(f.execute).toHaveBeenCalledTimes(1);
        expect(f.dispatcher.toolCallCount).toBe(2);
        expect(f.results.map((result) => result.outcome)).toEqual(['policy_rejected', 'success']);
    });

    it.each(['aborted', 'wall_clock_exceeded', 'final_answer_only'] as const)('preserves the %s gate before the new hook', async (gate) => {
        const preflight = jest.fn<NonNullable<PaAgentToolExecutor['preflightBatch']>>(() => undefined);
        const f = setup(preflight);
        if (gate === 'aborted') f.abort();
        if (gate === 'wall_clock_exceeded') f.expire();
        const output = await f.dispatcher.executeBufferedToolCalls('turn', 0, [call('one')],
            gate === 'final_answer_only' ? gate : 'normal', undefined);
        expect(preflight).not.toHaveBeenCalled();
        expect(f.execute).not.toHaveBeenCalled();
        if (gate === 'final_answer_only') expect(f.results[0].metadata?.reason).toBe('final_answer_only_violation');
        else expect(output.stoppedBy).toBe(gate);
    });

    it.each(['aborted', 'wall_clock_exceeded'] as const)('rechecks %s after a successful synchronous preflight before preparation', async (gate) => {
        const preflight = jest.fn<NonNullable<PaAgentToolExecutor['preflightBatch']>>(() => {
            if (gate === 'aborted') f.abort();
            else f.expire();
            return undefined;
        });
        const f = setup(preflight);
        const output = await f.dispatcher.executeBufferedToolCalls('turn', 0, [call('one')], 'normal', undefined);
        expect(preflight).toHaveBeenCalledTimes(1);
        expect(output).toEqual({ toolResults: [], diagnostics: [], stoppedBy: gate });
        for (const callback of [f.canonical, f.prepare, f.mode, f.execute]) expect(callback).not.toHaveBeenCalled();
        expect(f.dispatcher.toolCallCount).toBe(0);
    });

    it.each([false, true])('preserves duplicate and policy filtering when optional preflight passes or is absent: %s', async (withHook) => {
        const f = setup(withHook ? () => undefined : undefined);
        await f.dispatcher.executeBufferedToolCalls('turn', 0, [call('one'), call('two'), call('blocked', 'vault_write')],
            'normal', createAgentControlSnapshot({ blockedToolNames: new Set(['vault_write']) }));
        expect(f.prepare.mock.calls[0][0].toolCalls.map((entry) => entry.id)).toEqual(['one']);
        expect(f.execute).toHaveBeenCalledTimes(1);
        expect(f.results.map((result) => result.outcome)).toEqual(['success', 'duplicate_skipped', 'policy_rejected']);
    });

    it('feeds real loop corrective failures and bounded retries through ordinary lifecycle accounting', async () => {
        const events: AgentEvent[] = [];
        const execute = jest.fn<PaAgentToolExecutor['execute']>(async () => ({ outcome: 'success', promptText: 'unused' }));
        const loop = new PaAgentLoop({ runId: 'bounded-preflight', userInput: 'Use current note',
            maxTurns: 3, maxToolCalls: 2,
            model: { stream: async function* () {
                yield { type: 'toolcall_delta', id: 'repeated', name: 'search_memory', input: { query: 'same' }, index: 0 } as const;
            } }, toolExecutor: { execute, preflightBatch: () => denied },
            hostPolicy: { afterTurn: () => ({ action: 'continue', reason: 'corrective_turn' }) },
            onEvent: (event) => events.push(event),
        });
        const result = await loop.run();
        expect(execute).not.toHaveBeenCalled();
        expect(result.turns).toHaveLength(3);
        expect(result.turns.flatMap((turn) => turn.toolResults).map((message) => message.content.metadata?.outcome))
            .toEqual(['policy_rejected', 'policy_rejected', 'budget_exceeded']);
        expect(result.turns.flatMap((turn) => turn.toolResults).every((message) => message.isError)).toBe(true);
        expect(events.filter((event) => event.type === 'tool_execution_end')).toEqual([
            expect.objectContaining({ outcome: 'policy_rejected', metadata: expect.objectContaining({ preflightOnly: true }) }),
            expect.objectContaining({ outcome: 'policy_rejected', metadata: expect.objectContaining({ preflightOnly: true }) }),
            expect.objectContaining({ outcome: 'budget_exceeded', metadata: expect.objectContaining({ preflightOnly: true }) }),
        ]);
    });
});
