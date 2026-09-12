import { PaAgentLoop } from '../src/ai-services/pa-agent-loop';
import { createTaskSourceConstrainedExecutor, DECLARE_SOURCE_SCOPE, TaskSourceReadPlan } from '../src/ai-services/task-source-executor';
import { TaskSourceConstraintState } from '../src/ai-services/task-source-constraint';
import { CapabilityRegistry } from '../src/ai-services/capability-registry';
import { createCoreToolCapabilities } from '../src/ai-services/capability-adapter';
import { createCurrentNoteContextTool } from '../src/ai-services/chat-tools';
import { createPaAgentCapabilityToolExecutor } from '../src/ai-services/pa-agent-host-tools';
import type { PaAgentToolExecutor, ParsedBufferedToolCall } from '../src/ai-services/pa-agent-types';
import { createAgentControlSnapshot } from '../src/ai-services/pa-agent-control-policy';

jest.mock('obsidian');

const userInput = '只用当前笔记';
const declaration = { instructionQuote: userInput, notes: 'current_note', webAllowed: false };
function call(id: string, name: string, input: Record<string, unknown> = {}): ParsedBufferedToolCall {
    return { type: 'toolCall', id, name, input, index: 0 };
}
const declare = () => call('scope', DECLARE_SOURCE_SCOPE, declaration);
const read = () => call('read', 'get_current_note_context', { mode: 'full' });

function setup(baseOverride?: PaAgentToolExecutor) {
    let active = true;
    const files = new Map([['a.md', 'note-a'], ['b.md', 'note-b']]);
    const state = new TaskSourceConstraintState({ runId: 'r', userMessageId: 'u', userText: userInput,
        currentNoteHandle: 'active', noteHandles: new Map([['active', 'note-a'], ['other', 'note-b']]) });
    const file = { path: 'a.md', name: 'a.md', basename: 'a', extension: 'md', stat: { size: 15, ctime: 1, mtime: 1 } };
    const editor = { getValue: jest.fn(() => '# Actual editor'), getSelection: jest.fn(() => ''),
        lineCount: jest.fn(() => 1), getLine: jest.fn(() => '# Actual editor'), getCursor: jest.fn(() => ({ line: 0, ch: 0 })) };
    const host = { settings: {}, log: jest.fn(), app: {
        workspace: { getActiveViewOfType: () => ({ file, editor }) },
        vault: { getAbstractFileByPath: () => file, getMarkdownFiles: () => [file] },
        metadataCache: { getFileCache: () => ({}) },
    } } as never;
    const registry = new CapabilityRegistry();
    registry.registerMany(createCoreToolCapabilities([createCurrentNoteContextTool()]));
    const base = baseOverride ?? createPaAgentCapabilityToolExecutor({ registry, host });
    const execute = jest.spyOn(base, 'execute');
    const executor = createTaskSourceConstrainedExecutor({ baseExecutor: base, state,
        resolveHostNoteId: path => files.get(path), isHostCurrent: () => active,
        resolveReadPlan: tool => {
            if (tool.name === 'get_current_note_context') return { reads: [{ kind: 'note', noteId: 'note-a' }] };
            if (tool.name === 'read_other') return { reads: [{ kind: 'note', noteId: 'note-b' }] };
            if (tool.name === 'create_output') return { reads: [{ kind: 'none' }], outputTargetPaths: ['new.md'] };
            return undefined;
        },
    });
    const preflight = (toolCalls: ParsedBufferedToolCall[], overrides = {}) => executor.preflightBatch!({
        runId: 'r', turnId: 't', turnIndex: 0, userInput, toolCalls, ...overrides,
    });
    return { state, executor, execute, preflight, editor, files, revoke: () => { active = false; } };
}

describe('B-135 complete scope declaration admission', () => {
    it.each(['complete', 'missing', 'extra', 'wrong-id', 'unavailable'] as const)(
        'validates the entire ordered batch plan before source preparation (%s)', variant => {
            const h = setup();
            const create = call('create', 'vault_create', { path: 'new.md', content: 'new' });
            const append = call('append', 'vault_append', { path: 'new.md', content: 'more' });
            const outputPlan: TaskSourceReadPlan = { reads: [], outputTargetPaths: ['new.md'] };
            const plans = new Map([['create', outputPlan], ['append', outputPlan]]);
            if (variant === 'missing') plans.delete('append');
            if (variant === 'extra') plans.set('extra', outputPlan);
            if (variant === 'wrong-id') { plans.delete('append'); plans.set('other', outputPlan); }
            const resolveReadPlans = jest.fn(() => variant === 'unavailable' ? undefined : plans);
            const base = { execute: jest.fn(), prepareBatch: jest.fn(), preflightBatch: jest.fn() };
            const executor = createTaskSourceConstrainedExecutor({
                baseExecutor: base, state: h.state, resolveReadPlans,
                resolveHostNoteId: path => h.files.get(path), isHostCurrent: () => true,
            });
            const result = executor.preflightBatch!({ runId: 'r', turnId: 't', turnIndex: 0,
                userInput, toolCalls: [create, declare(), append] });
            expect(resolveReadPlans).toHaveBeenCalledTimes(1);
            expect(resolveReadPlans).toHaveBeenCalledWith([create, append]);
            expect(base.prepareBatch).not.toHaveBeenCalled();
            expect(base.execute).not.toHaveBeenCalled();
            if (variant === 'complete') {
                expect(result).toMatchObject({ kind: 'admitted' });
                expect(h.state.snapshot()).toBeDefined();
                if (!result || !('kind' in result)) throw new Error('expected admission');
                expect(result.taskSourceReadGuard!.isPathAllowed('new.md', 'output_target_exists')).toBe(true);
                expect(result.taskSourceReadGuard!.isPathAllowed('new.md')).toBe(false);
            } else {
                expect(result).toMatchObject({ outcome: 'policy_rejected', metadata: { reason: 'source_read_plan_unavailable' } });
                expect(h.state.snapshot()).toBeUndefined();
                expect(base.preflightBatch).not.toHaveBeenCalled();
            }
        });

    it('consumes a declaration and reads the real editor in the same model phase', async () => {
        const h = setup();
        const loop = new PaAgentLoop({ runId: 'r', userInput, maxTurns: 1,
            toolExecutionMode: 'hybrid', toolExecutor: h.executor,
            model: { stream: async function* () {
                for (const [index, tool] of [declare(), read()].entries()) {
                    yield { type: 'toolcall_delta', id: tool.id, name: tool.name, input: tool.input, index } as const;
                }
            } } });
        const result = await loop.run();
        expect(h.state.snapshot()?.allowedNoteIds).toEqual(['note-a']);
        expect(h.execute).toHaveBeenCalledTimes(1);
        expect(h.execute.mock.calls[0][0].toolCall.name).toBe('get_current_note_context');
        expect(h.editor.getValue).toHaveBeenCalledTimes(1);
        const receipts = result.turns[0].toolResults;
        expect(receipts.map(receipt => receipt.content.metadata?.outcome)).toEqual(['control_applied', 'success']);
        expect(receipts[0].content.sourceRecords).toBeUndefined();
        expect(receipts[0].content.contextUsed).toBeUndefined();
        expect(JSON.stringify(receipts[1])).toContain('Actual editor');
    });

    it('rejects a mixed out-of-scope batch before committing or touching the editor', async () => {
        const h = setup();
        const loop = new PaAgentLoop({ runId: 'r', userInput, maxTurns: 1, toolExecutor: h.executor,
            model: { stream: async function* () {
                for (const [index, tool] of [declare(), read(), call('other', 'read_other')].entries()) {
                    yield { type: 'toolcall_delta', id: tool.id, name: tool.name, input: tool.input, index } as const;
                }
            } } });
        const result = await loop.run();
        expect(result.turns[0].toolResults.every(receipt => receipt.content.metadata?.outcome === 'policy_rejected')).toBe(true);
        expect(h.state.snapshot()).toBeUndefined();
        expect(h.execute).not.toHaveBeenCalled();
        expect(h.editor.getValue).not.toHaveBeenCalled();
    });

    it.each([
        [read()],
        [declare(), call('unknown', 'unknown_tool')],
        [declare(), call('scope', 'get_current_note_context')],
        [declare(), call('second', DECLARE_SOURCE_SCOPE, declaration)],
        [call('scope', DECLARE_SOURCE_SCOPE, { ...declaration, notes: 'selected', noteHandles: ['invented'] })],
        [declare(), { ...read(), parseError: 'bad JSON' }],
    ])('rejects an incomplete or malformed phase without committing (%j)', (...toolCalls) => {
        const h = setup();
        expect(h.preflight(toolCalls)).toMatchObject({ outcome: 'policy_rejected' });
        expect(h.state.snapshot()).toBeUndefined();
    });

    it.each([{ runId: 'other' }, { userInput: 'use every note' }])('binds admission to the actual run and user message (%j)', overrides => {
        const h = setup();
        expect(h.preflight([declare(), read()], overrides)).toMatchObject({ outcome: 'policy_rejected' });
        expect(h.state.snapshot()).toBeUndefined();
    });

    it('allows later reads under the committed scope and refuses widening', () => {
        const h = setup();
        expect(h.preflight([declare(), read()])).toMatchObject({ kind: 'admitted' });
        const original = h.state.snapshot();
        expect(h.preflight([read()])).toMatchObject({ kind: 'admitted' });
        expect(h.preflight([call('wide', DECLARE_SOURCE_SCOPE, { ...declaration, notes: 'vault' })]))
            .toMatchObject({ outcome: 'policy_rejected' });
        expect(h.state.snapshot()).toBe(original);
    });

    it.each([
        { blockedToolNames: new Set([DECLARE_SOURCE_SCOPE]) },
        { allowedToolNames: new Set(['get_current_note_context']) },
    ])('does not commit a declaration disabled by current host controls (%j)', controls => {
        const h = setup();
        expect(h.preflight([declare(), read()], { controlSnapshot: createAgentControlSnapshot(controls) }))
            .toMatchObject({ outcome: 'policy_rejected', metadata: { reason: 'source_declaration_disabled' } });
        expect(h.state.snapshot()).toBeUndefined();
        expect(h.execute).not.toHaveBeenCalled();
    });

    it('admits an output-only plan without a declaration but grants no material reads', () => {
        const h = setup();
        const admitted = h.preflight([call('create', 'create_output')]);
        if (!admitted || !('kind' in admitted)) throw new Error('expected admission');
        const guard = admitted.taskSourceReadGuard!;
        expect(guard.isPathAllowed('new.md', 'output_target_exists')).toBe(true);
        expect(guard.isPathAllowed('new.md')).toBe(false);
        expect(guard.isPathAllowed('a.md')).toBe(false);
        expect(h.state.snapshot()).toBeUndefined();
        h.revoke();
        expect(guard.isCurrent()).toBe(false);
        expect(guard.isPathAllowed('new.md', 'output_target_exists')).toBe(false);
    });

    it('does not commit before an existing host gate has accepted the batch', () => {
        const h = setup({ execute: jest.fn(), preflightBatch: () => ({ outcome: 'policy_rejected', promptText: 'Host denied' }) });
        expect(h.preflight([declare(), read()])).toMatchObject({ promptText: 'Host denied' });
        expect(h.state.snapshot()).toBeUndefined();
    });

    it('revalidates the host after the underlying gate and revokes path identities after admission', () => {
        let revoke = () => {};
        const first = setup({ execute: jest.fn(), preflightBatch: () => { revoke(); return undefined; } });
        revoke = first.revoke;
        expect(first.preflight([declare(), read()])).toMatchObject({ outcome: 'policy_rejected' });
        expect(first.state.snapshot()).toBeUndefined();
        const h = setup();
        const admitted = h.preflight([declare(), read()]);
        if (!admitted || !('kind' in admitted)) throw new Error('expected admission');
        expect(admitted.taskSourceReadGuard!.isPathAllowed('a.md')).toBe(true);
        h.files.set('a.md', 'recreated-note');
        expect(admitted.taskSourceReadGuard!.isPathAllowed('a.md')).toBe(false);
    });
});
