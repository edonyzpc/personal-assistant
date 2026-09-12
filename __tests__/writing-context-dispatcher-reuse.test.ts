import { AgentLifecycleEventEmitter } from '../src/ai-services/agent-runtime-primitives';
import { CapabilityRegistry } from '../src/ai-services/capability-registry';
import { createPaAgentCapabilityToolExecutor } from '../src/ai-services/pa-agent-host-tools';
import { ToolExecutionDispatcher } from '../src/ai-services/pa-agent-tool-dispatcher';
import { WritingContextRun } from '../src/ai-services/writing-context-run';
import { createWritingContextCapability } from '../src/ai-services/writing-context-tool';
import type { PaAgentMessage } from '../src/ai-services/chat-types';
import { WritingVersionService } from '../src/chat/writing-versions';
import { cloneWritingVersion, type WritingVersion } from '../src/chat/writing-types';

jest.mock('obsidian');

async function fixture() {
    const records = new Map<string, WritingVersion>();
    const versions = new WritingVersionService({ getWritingVersion: async id => records.get(id) ?? null,
        putWritingVersion: async value => { records.set(value.id, cloneWritingVersion(value)); },
        listWritingVersions: async () => [...records.values()] });
    const candidates = await Promise.all(['A', 'B'].map((text, index) => versions.create({
        requestId: text, conversationId: 'conversation', messageId: text, turnIndex: index, text, images: [],
    })));
    const state = { revision: 1, failNext: false, failDelivery: false };
    const prepare = jest.fn(async () => {
        if (state.failNext) { state.failNext = false; throw new Error('Temporary style failure'); }
        const revision = state.revision;
        return { context: `Style ${revision}`, revisionIds: [`style-${revision}`],
            isCurrent: () => state.revision === revision, isSourceCurrent: () => state.revision === revision };
    });
    const run = new WritingContextRun({ runId: 'run', conversationId: 'conversation', candidates, versions,
        styles: { prepare }, isCurrent: () => true, isParentCurrent: () => true,
        verifyImages: async () => ({ images: [], isCurrent: () => true }) });
    const registry = new CapabilityRegistry();
    registry.register(createWritingContextCapability(run, { outputBudgetChars: 10_000,
        onPrepared: () => { if (state.failDelivery) { state.failDelivery = false; throw new Error('Delivery preparation failed'); } },
        getBudget: () => ({ remainingTextChars: 10_000, remainingMemoryChars: 6000 }) }));
    const executor = createPaAgentCapabilityToolExecutor({ registry, host: { log: jest.fn() } as never,
        canReuseWritingContext: input => run.matchesCurrentSelection(input) });
    const ordinaryExecute = jest.fn(async () => ({ outcome: 'success' as const, promptText: 'ordinary' }));
    const originalExecute = executor.execute.bind(executor);
    executor.execute = input => input.toolCall.name === 'ordinary' ? ordinaryExecute() : originalExecute(input);
    const dispatcher = new ToolExecutionDispatcher({ toolExecutor: executor, toolExecutionMode: 'hybrid',
        runId: 'run', userInput: 'Compare the drafts', toolTimeoutMs: 1000, toolTimeoutOutcome: 'recoverable_error',
        toolAbortGraceMs: 1, maxToolCalls: 20, now: () => 1, isAborted: () => false,
        isWallClockExceeded: () => false, wallClockRemainingMs: () => 1000,
        events: new AgentLifecycleEventEmitter({ runId: 'run', now: () => 1 }),
        emitToolResult: (_turn, call, result) => ({ role: 'toolResult', id: `result-${call.id}`,
            toolCallId: call.id, toolName: call.name, timestamp: 1,
            isError: !['success', 'duplicate_skipped'].includes(result.outcome),
            content: { ...result, includeInNextPrompt: result.includeInNextPrompt ?? true },
        }) as Extract<PaAgentMessage, { role: 'toolResult' }>,
    });
    let sequence = 0;
    const select = async (index: number, name = 'get_writing_context') => {
        const id = `call-${++sequence}`;
        const input = { parentHandle: run.candidateDirectory()[index].handle, scene: null,
            currentInstructionConflicts: false, imageRefs: [] };
        const result = await dispatcher.executeBufferedToolCalls(id, sequence,
            [{ key: id, id, name, argsText: JSON.stringify(input), index: 0, partIndex: 0, hasStructuredInput: false }], 'normal', undefined);
        return result.toolResults[0];
    };
    return { run, state, prepare, ordinaryExecute, select, dispose: () => { run.dispose(); versions.dispose(); } };
}

describe('writing context dispatcher receipt reuse', () => {
    it('prepares A again after B replaces its handle', async () => {
        const f = await fixture();
        try {
            await f.select(0);
            const oldHandle = f.run.current()!.handle;
            await f.select(1);
            const reselected = await f.select(0);
            expect(reselected.content.metadata?.outcome).toBe('success');
            expect(f.prepare).toHaveBeenCalledTimes(3);
            expect(f.run.current()!.parent?.text).toBe('A');
            expect(f.run.current()!.handle).not.toBe(oldHandle);
        } finally { f.dispose(); }
    });

    it('does not prepare an identical still-valid receipt twice', async () => {
        const f = await fixture();
        try {
            await f.select(0);
            expect((await f.select(0)).content.metadata?.outcome).toBe('duplicate_skipped');
            expect(f.prepare).toHaveBeenCalledTimes(1);
        } finally { f.dispose(); }
    });

    it.each(['failed', 'invalidated', 'delivery-failed'] as const)('allows the same selection after a %s preparation', async reason => {
        const f = await fixture();
        try {
            if (reason === 'failed') f.state.failNext = true;
            if (reason === 'delivery-failed') f.state.failDelivery = true;
            await f.select(0);
            if (reason === 'invalidated') f.state.revision++;
            expect((await f.select(0)).content.metadata?.outcome).toBe('success');
            expect(f.prepare).toHaveBeenCalledTimes(2);
            expect(f.run.current()!.styleRevisionIds).toEqual([`style-${f.state.revision}`]);
        } finally { f.dispose(); }
    });

    it('preserves ordinary tool deduplication', async () => {
        const f = await fixture();
        try {
            await f.select(0, 'ordinary');
            expect((await f.select(0, 'ordinary')).content.metadata?.outcome).toBe('duplicate_skipped');
            expect(f.ordinaryExecute).toHaveBeenCalledTimes(1);
        } finally { f.dispose(); }
    });
});
