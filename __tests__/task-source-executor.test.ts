import { createTaskSourceConstrainedExecutor, type TaskSourceReadPlan } from '../src/ai-services/task-source-executor';
import { TaskSourceConstraintState } from '../src/ai-services/task-source-constraint';
import type { PaAgentToolExecutor, ParsedBufferedToolCall } from '../src/ai-services/pa-agent-types';

const userInput = '只用当前笔记回答';
function call(id: string, name: string): ParsedBufferedToolCall {
    return { type: 'toolCall', id, name, input: {}, index: 0 };
}

function setup(base: PaAgentToolExecutor = { execute: jest.fn() }) {
    let active = true;
    const ids = new Map([['a.md', 'note-a'], ['b.md', 'note-b']]);
    const originalIds = new Map(ids);
    const state = new TaskSourceConstraintState({ runId: 'run', userMessageId: 'user', userText: userInput,
        noteHandles: new Map([['current', 'note-a']]) });
    const executor = createTaskSourceConstrainedExecutor({ baseExecutor: base, state,
        resolveHostNoteId: path => ids.get(path) === originalIds.get(path) ? ids.get(path) : undefined,
        isHostCurrent: () => active,
        resolveReadPlan: tool => {
            if (tool.name === 'read_note') return { reads: [{ kind: 'note', noteId: 'note-a' }] };
            if (tool.name === 'create_output') return { reads: [], outputTargetPaths: ['new.md'] };
            return undefined;
        } });
    const preflight = (toolCalls: ParsedBufferedToolCall[], user = userInput) => executor.preflightBatch!({
        runId: 'run', turnId: 'turn', turnIndex: 0, userInput: user, toolCalls,
    });
    return { state, ids, preflight, revoke: () => { active = false; } };
}

describe('Task source Host batch admission', () => {
    it('admits an ordinary read without a model declaration and binds real identities', () => {
        const h = setup();
        const admitted = h.preflight([call('read', 'read_note')]);
        if (!admitted || !('kind' in admitted)) throw new Error('expected admission');
        const guard = admitted.taskSourceReadGuard!;
        expect(guard.isPathAllowed('a.md')).toBe(true);
        h.ids.set('a.md', 'replacement');
        expect(guard.isPathAllowed('a.md')).toBe(false);
    });

    it.each(['declare_source_scope', 'request_source_decision'])(
        'rejects retired %s together with a read before any base action', retired => {
            const base = { execute: jest.fn(), preflightBatch: jest.fn() };
            const h = setup(base);
            expect(h.preflight([call('old', retired), call('read', 'read_note')])).toMatchObject({
                outcome: 'policy_rejected', metadata: { reason: 'source_control_unavailable' },
            });
            expect(base.preflightBatch).not.toHaveBeenCalled();
            expect(base.execute).not.toHaveBeenCalled();
        });

    it('does not expose an excluded note or suggest a path bypass', () => {
        const h = setup();
        const executor = createTaskSourceConstrainedExecutor({ baseExecutor: { execute: jest.fn() }, state: h.state,
            resolveHostNoteId: path => h.ids.get(path), isHostCurrent: () => true,
            resolveReadPlans: () => ({ rejectionReason: 'source_excluded' }) });
        const rejected = executor.preflightBatch!({ runId: 'run', turnId: 'turn', turnIndex: 0,
            userInput, toolCalls: [call('read', 'read_note')] });
        expect(rejected).toMatchObject({ outcome: 'policy_rejected', metadata: { reason: 'source_excluded' } });
        if (!rejected || 'kind' in rejected) throw new Error('expected rejection');
        expect(rejected.promptText).toContain('Supplying a path or reopening the note cannot override');
    });

    it('requires a complete read plan for every call before base preflight', () => {
        const h = setup();
        const base = { execute: jest.fn(), preflightBatch: jest.fn() };
        const readPlan: TaskSourceReadPlan = { reads: [{ kind: 'note', noteId: 'note-a' }] };
        const executor = createTaskSourceConstrainedExecutor({ baseExecutor: base, state: h.state,
            resolveHostNoteId: path => h.ids.get(path), isHostCurrent: () => true,
            resolveReadPlans: () => new Map([['read', readPlan]]) });
        expect(executor.preflightBatch!({ runId: 'run', turnId: 'turn', turnIndex: 0,
            userInput, toolCalls: [call('read', 'read_note'), call('missing', 'read_note')] })).toMatchObject({
            outcome: 'policy_rejected', metadata: { reason: 'source_read_plan_unavailable' },
        });
        expect(base.preflightBatch).not.toHaveBeenCalled();
    });

    it('allows an output-target existence check without permitting its old body', () => {
        const h = setup();
        const admitted = h.preflight([call('create', 'create_output')]);
        if (!admitted || !('kind' in admitted)) throw new Error('expected admission');
        const guard = admitted.taskSourceReadGuard!;
        expect(guard.isPathAllowed('new.md', 'output_target_exists')).toBe(true);
        expect(guard.isPathAllowed('new.md')).toBe(false);
        h.revoke();
        expect(guard.isCurrent()).toBe(false);
        expect(guard.isPathAllowed('new.md', 'output_target_exists')).toBe(false);
    });

    it('honors an independent Host denial and rechecks lifetime after it', () => {
        const denied = setup({ execute: jest.fn(), preflightBatch: () => ({
            outcome: 'policy_rejected', promptText: 'Host denied',
        }) });
        expect(denied.preflight([call('read', 'read_note')])).toMatchObject({ promptText: 'Host denied' });
        let revoke = () => {};
        const h = setup({ execute: jest.fn(), preflightBatch: () => { revoke(); return undefined; } });
        revoke = h.revoke;
        expect(h.preflight([call('read', 'read_note')])).toMatchObject({
            outcome: 'policy_rejected', metadata: { reason: 'source_run_changed' },
        });
    });
});
