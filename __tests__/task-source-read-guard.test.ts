import { TaskSourceConstraintState } from '../src/ai-services/task-source-constraint';
import { assertTaskSourceReadCurrent, isTaskSourcePathAllowed } from '../src/ai-services/task-source-read-guard';
import { createPaAgentCapabilityToolExecutor, MemoryEvidenceRegistry } from '../src/ai-services/pa-agent-host-tools';
import { CapabilityRegistry } from '../src/ai-services/capability-registry';
import { createCoreToolCapabilities } from '../src/ai-services/capability-adapter';
import { createCurrentNoteContextTool, createSearchMemoryTool } from '../src/ai-services/chat-tools';
import type { ChatMemoryRecoveryCoordinator } from '../src/ai-services/retrieval-recovery-coordinator';
import type { PaAgentToolExecutionInput } from '../src/ai-services/pa-agent-types';

jest.mock('obsidian');

function scoped() {
    const state = new TaskSourceConstraintState({ runId: 'r', userMessageId: 'u', userText: 'only current note',
        noteHandles: new Map([['active', 'file-object-a']]), currentNoteHandle: 'active' });
    const prepared = state.prepareDeclaration({ instructionQuote: 'only current note', notes: 'current_note', webAllowed: false });
    if (!prepared.ok) throw new Error(prepared.reason);
    let active = true;
    const files = new Map([['a.md', 'file-object-a'], ['b.md', 'file-object-b']]);
    const guard = state.createReadGuard(prepared.constraint, path => files.get(path), () => active);
    return { state, constraint: prepared.constraint, guard, files, invalidate: () => { active = false; } };
}

describe('B-135 per-call read guard', () => {
    it('cannot read with a prepared candidate and revokes after scope or host lifetime changes', () => {
        const h = scoped();
        expect(isTaskSourcePathAllowed(h.guard, 'a.md')).toBe(false);
        expect(() => assertTaskSourceReadCurrent(h.guard)).toThrow('no longer current');
        h.state.commit(h.constraint);
        expect(isTaskSourcePathAllowed(h.guard, 'a.md')).toBe(true);
        expect(isTaskSourcePathAllowed(h.guard, 'b.md')).toBe(false);
        h.files.set('a.md', 'recreated-file-object');
        expect(isTaskSourcePathAllowed(h.guard, 'a.md')).toBe(false);
        h.files.set('a.md', 'file-object-a');
        h.invalidate();
        expect(isTaskSourcePathAllowed(h.guard, 'a.md')).toBe(false);
        expect(h.guard.isCurrent()).toBe(false);
    });

    it('invalidates previously captured guards on a new committed revision', () => {
        const h = scoped(); h.state.commit(h.constraint);
        const prepared = h.state.prepareDeclaration({ instructionQuote: 'only current note', notes: 'none', webAllowed: false });
        if (!prepared.ok) throw new Error(prepared.reason);
        h.state.commit(prepared.constraint);
        expect(h.guard.isCurrent()).toBe(false);
    });

    it('can inspect an admitted output target without authorizing its existing body as material', () => {
        const h = scoped(); h.state.commit(h.constraint);
        const guard = h.state.createReadGuard(h.constraint, path => h.files.get(path), () => true,
            path => path === 'new-output.md');
        expect(isTaskSourcePathAllowed(guard, 'new-output.md', 'output_target_exists')).toBe(true);
        expect(isTaskSourcePathAllowed(guard, 'new-output.md', 'task_material')).toBe(false);
        expect(isTaskSourcePathAllowed(guard, 'other-output.md', 'output_target_exists')).toBe(false);
        expect(isTaskSourcePathAllowed(guard, 'a.md')).toBe(true);
    });

    it('denies a failed host boundary check without falling back to unrestricted reads', () => {
        expect(isTaskSourcePathAllowed({ isCurrent: () => true, isPathAllowed: () => { throw new Error('unavailable'); } }, 'a.md')).toBe(false);
        expect(isTaskSourcePathAllowed(undefined, 'a.md')).toBe(true);
    });

    function execution(guard: ReturnType<typeof scoped>['guard']): PaAgentToolExecutionInput {
        return { runId: 'r', turnId: 't', turnIndex: 0, userInput: 'only current note',
            taskSourceReadGuard: guard, signal: new AbortController().signal,
            toolCall: { type: 'toolCall', id: 'call', index: 0, name: 'get_current_note_context', input: { mode: 'metadata' } } };
    }

    it('passes the exact host guard through the real executor, registry and adapter', async () => {
        const h = scoped(); h.state.commit(h.constraint);
        const definition = createCurrentNoteContextTool();
        const observe = jest.fn(async (_input, context) => {
            expect(context.taskSourceReadGuard).toBe(h.guard);
            return { ok: true as const, tool: 'get_current_note_context' as const, inputSummary: 'a.md',
                content: { path: 'a.md', title: 'A', mode: 'metadata' as const }, sources: [{ path: 'a.md' }] };
        });
        definition.execute = observe;
        const registry = new CapabilityRegistry(); registry.registerMany(createCoreToolCapabilities([definition]));
        const host = { settings: {}, log: jest.fn() } as never;
        const result = await createPaAgentCapabilityToolExecutor({ registry, host }).execute(execution(h.guard));
        expect(observe).toHaveBeenCalledTimes(1);
        expect(result.outcome).toBe('success');
        expect(JSON.stringify(result)).not.toContain('taskSourceReadGuard');
    });

    it('does not prepare stale input or return observations revoked during capability execution', async () => {
        const h = scoped(); h.state.commit(h.constraint);
        const definition = createCurrentNoteContextTool();
        const observe = jest.fn(async () => {
            h.invalidate();
            return { ok: true as const, tool: 'get_current_note_context' as const, inputSummary: 'a.md',
                content: { path: 'a.md', title: 'revoked body', mode: 'metadata' as const }, sources: [{ path: 'a.md' }] };
        });
        definition.execute = observe;
        const registry = new CapabilityRegistry(); registry.registerMany(createCoreToolCapabilities([definition]));
        const executor = createPaAgentCapabilityToolExecutor({ registry, host: { settings: {}, log: jest.fn() } as never });
        await expect(executor.execute(execution(h.guard))).rejects.toThrow('no longer current');
        const prepare = jest.spyOn(registry, 'prepareAndValidate');
        await expect(executor.execute(execution(h.guard))).rejects.toThrow('no longer current');
        expect(prepare).not.toHaveBeenCalled();
        expect(observe).toHaveBeenCalledTimes(1);
    });

    it('rechecks after outer recovery revalidation before capturing evidence', async () => {
        const h = scoped(); h.state.commit(h.constraint);
        const registry = new CapabilityRegistry();
        registry.registerMany(createCoreToolCapabilities([createSearchMemoryTool(async () => ({
            usedMemory: false, query: 'q', documents: [], sources: [],
        }))]));
        const evidence = new MemoryEvidenceRegistry(async result => result);
        const capture = jest.spyOn(evidence, 'capture');
        const executeRecovery: ChatMemoryRecoveryCoordinator['execute'] = async input => {
            const result = await input.executeAttempt({ mode: 'standard', invocationOrdinal: 1,
                temporalIntent: 'none', captureRecoverySeed: false, runEpoch: 'r', absoluteDeadlineMs: Date.now() + 1000 }, input.signal);
            await input.revalidate({ usedMemory: false, query: 'q', documents: [], sources: [] }, input.signal, null);
            return result;
        };
        const executor = createPaAgentCapabilityToolExecutor({ registry, host: { settings: {}, log: jest.fn() } as never,
            memoryEvidenceRegistry: evidence,
            memoryRecoveryCoordinator: { execute: executeRecovery } as ChatMemoryRecoveryCoordinator,
            revalidateMemorySearch: async result => { h.invalidate(); return result; } });
        const input = execution(h.guard);
        input.toolCall = { type: 'toolCall', id: 'memory', index: 0, name: 'search_memory', input: { query: 'q' } };
        await expect(executor.execute(input)).rejects.toThrow('no longer current');
        expect(capture).not.toHaveBeenCalled();
    });

    it('keeps concurrent calls on one executor bound to their own guard', async () => {
        const a = scoped(); a.state.commit(a.constraint);
        const b = scoped(); b.state.commit(b.constraint);
        let release!: () => void;
        const pending = new Promise<void>(resolve => { release = resolve; });
        let ready!: () => void;
        const started = new Promise<void>(resolve => { ready = resolve; });
        let calls = 0;
        const definition = createCurrentNoteContextTool();
        definition.execute = async (_input, context) => {
            expect([a.guard, b.guard]).toContain(context.taskSourceReadGuard);
            if (++calls === 2) ready();
            await pending;
            return { ok: true, tool: 'get_current_note_context', inputSummary: 'a.md',
                content: { path: 'a.md', title: 'A', mode: 'metadata' }, sources: [{ path: 'a.md' }] };
        };
        const registry = new CapabilityRegistry(); registry.registerMany(createCoreToolCapabilities([definition]));
        const executor = createPaAgentCapabilityToolExecutor({ registry, host: { settings: {}, log: jest.fn() } as never });
        const results = Promise.allSettled([executor.execute(execution(a.guard)), executor.execute(execution(b.guard))]);
        await started;
        a.invalidate(); release();
        const [first, second] = await results;
        expect(first.status).toBe('rejected');
        expect(second).toMatchObject({ status: 'fulfilled', value: { outcome: 'success' } });
    });
});
