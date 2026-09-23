import { AgentDebugService } from '../src/agent-debug/service';
import type { AgentDebugStore } from '../src/agent-debug/store';
import type { DebugBatch, DebugBudgets, DebugGeneration } from '../src/agent-debug/types';

function setup(enabled = true, budgets?: Partial<DebugBudgets>) {
    const generation: DebugGeneration = { generation: 0, domains: {}, quarantined: false, sourceToken: 'token-a' };
    const batches: DebugBatch[] = [];
    const store = {
        initialize: jest.fn(async () => undefined), getOwners: jest.fn(async () => []), beginOwner: jest.fn(async () => false), endOwner: jest.fn(async () => undefined),
        getGeneration: jest.fn(async () => ({ ...generation, domains: { ...generation.domains } })),
        prune: jest.fn(async () => undefined), close: jest.fn(),
        writeBatch: jest.fn(async (batch: DebugBatch) => { batches.push(batch); return true; }),
        getContents: jest.fn(async (id: string) => batches.filter(batch => batch.run.captureId === id).flatMap(batch => batch.contents)),
        getEvents: jest.fn(async () => []), listRuns: jest.fn(async () => []),
        getRun: jest.fn(async () => undefined),
        isRunAllowed: jest.fn(async () => true),
        clear: jest.fn(async () => { generation.generation++; batches.splice(0); generation.quarantined = false; }),
        invalidateConversation: jest.fn(async () => { batches.splice(0); }),
        revokeDomains: jest.fn(async () => { generation.domains.vault_notes = 1; batches.splice(0); }),
        applySourceToken: jest.fn(async (token: string) => { generation.sourceToken = token; }),
        status: jest.fn(async () => ({ available: true, recoveryReady: true, bytes: 0, limit: 1000 })),
    };
    const service = new AgentDebugService({ vaultKey: 'vault', enabled: () => enabled, recoveryReady: true,
        store: store as unknown as AgentDebugStore, now: () => 1000, budgets });
    return { service, store, batches, generation };
}

describe('Agent Debug service', () => {
    it('waits for in-flight writes but does not write or notify when repeatedly reading settled details', async () => {
        jest.useFakeTimers();
        const { service, store, batches } = setup();
        try {
            await service.initialize();
            let finishWrite!: () => void;
            const writing = new Promise<void>(resolve => { finishWrite = resolve; });
            store.writeBatch.mockImplementationOnce(async batch => { await writing; batches.push(batch); return true; });
            const recorder = service.startRun({ prompt: 'question', provider: 'p', model: 'm' });
            const flushing = service.flush();
            const reading = service.getContents(recorder.captureId);
            await Promise.resolve();
            expect(store.getContents).not.toHaveBeenCalled();
            finishWrite();
            await flushing;
            expect(await reading).toHaveLength(1);

            const changed = jest.fn(); service.subscribe(changed);
            const writes = store.writeBatch.mock.calls.length;
            for (let index = 0; index < 3; index++) expect(await service.getContents(recorder.captureId)).toHaveLength(1);
            await jest.advanceTimersByTimeAsync(200);
            expect(changed).not.toHaveBeenCalled();
            expect(store.writeBatch).toHaveBeenCalledTimes(writes);
        } finally {
            await service.dispose();
            jest.useRealTimers();
        }
    });

    it('keeps detailed fields in memory only and removes them when Debug turns off', async () => {
        const { service, batches } = setup(); await service.initialize();
        const recorder = service.startRun({ prompt: 'question', provider: 'p', model: 'm' });
        recorder.observe({ nodeId: 'call', kind: 'llm', phase: 'receiving', reasoning: 'REASONING', toolInput: { path: 'TOOL_ONLY' },
            prompt: JSON.stringify({ messages: [{ role: 'user', content: 'PROMPT' }] }) });
        await service.flush();
        expect(JSON.stringify(batches)).toContain('PROMPT');
        expect(JSON.stringify(batches)).not.toContain('REASONING');
        expect(JSON.stringify(batches)).not.toContain('TOOL_ONLY');
        expect(service.getSessionDetails(recorder.captureId, 'call')).toHaveLength(2);
        service.setEnabled(false);
        expect(service.getSessionDetails(recorder.captureId, 'call')).toEqual([]);
        await service.dispose();
    });

    it('does not construct request projections while Debug is off', async () => {
        const { service, store } = setup(false);
        const recorder = service.startRun({ prompt: 'HIDDEN', provider: 'p', model: 'm' });
        recorder.observe({ nodeId: 'x', kind: 'llm', phase: 'sent', prompt: 'HIDDEN' });
        await service.flush(); expect(store.writeBatch).not.toHaveBeenCalled();
        service.setEnabled(true);
        recorder.observe({ nodeId: 'x', kind: 'llm', phase: 'sent', text: 'visible now' });
        await service.flush(); expect(store.writeBatch).toHaveBeenCalled();
        expect(JSON.stringify(store.writeBatch.mock.calls)).not.toContain('HIDDEN');
        await service.dispose();
    });

    it('replaces cumulative usage and sums stream/invoke attempts without double counting', async () => {
        const { service } = setup(); await service.initialize();
        const recorder = service.startRun({ prompt: 'question', provider: 'p', model: 'm' });
        for (const totalTokens of [4, 7, 7]) recorder.observe({ nodeId: 'call', callId: 'call', kind: 'llm', phase: 'usage',
            usage: { totalTokens, updateKey: 'stream', aggregation: 'cumulative' } });
        recorder.observe({ nodeId: 'call', callId: 'call', kind: 'llm', phase: 'usage',
            usage: { totalTokens: 3, updateKey: 'invoke', aggregation: 'cumulative' } });
        expect((await service.listRuns())[0].usage?.total).toBe(10);
        await service.dispose();
    });

    it('invalidates visible content before awaiting deletion and blocks late old details', async () => {
        const { service } = setup(); await service.initialize();
        const recorder = service.startRun({ conversationId: 'c', prompt: 'question', provider: 'p', model: 'm' });
        recorder.observe({ nodeId: 'call', kind: 'llm', phase: 'receiving', reasoning: 'sensitive' });
        const changed = jest.fn(); service.subscribe(changed);
        const deleting = service.invalidateConversation('c', { permanent: true });
        expect(changed).toHaveBeenCalledWith({ invalidated: true });
        expect(service.getSessionDetails(recorder.captureId, 'call')).toEqual([]);
        await deleting;
        recorder.observe({ nodeId: 'call', kind: 'llm', phase: 'receiving', reasoning: 'late' });
        expect(service.getSessionDetails(recorder.captureId, 'call')).toEqual([]);
        await service.dispose();
    });

    it('does not revoke an active capture for an unchanged source token', async () => {
        const { service, store } = setup(); await service.initialize();
        const changed = jest.fn(); service.subscribe(changed);
        await service.applySourceToken('token-a');
        expect(store.applySourceToken).not.toHaveBeenCalled();
        expect(changed).not.toHaveBeenCalled();
        await service.dispose();
    });

    it('marks a run usage incomplete when another observed call has no token evidence', async () => {
        const { service } = setup(); await service.initialize();
        const recorder = service.startRun({ prompt: 'question', provider: 'p', model: 'm' });
        recorder.observe({ nodeId: 'answer', callId: 'answer', kind: 'llm', phase: 'usage', usage: { totalTokens: 10 } });
        recorder.observe({ nodeId: 'rewrite', callId: 'rewrite', kind: 'llm', phase: 'failed', status: 'failed' });
        expect((await service.listRuns())[0].usage).toMatchObject({ total: 10, complete: false });
        await service.dispose();
    });

    it('does not convert stopped collection to a known completed run while Debug is off', async () => {
        const { service, batches } = setup(); await service.initialize();
        const recorder = service.startRun({ prompt: 'question', provider: 'p', model: 'm' });
        service.setEnabled(false); recorder.finish('completed'); await service.flush();
        expect(batches.at(-1)?.run.collection).toBe('stopped');
        expect(batches.at(-1)?.run.status).toBe('unknown');
        expect(batches.at(-1)?.run.endedAt).toBe(1000);
        await service.dispose();
    });

    it('continues an active run with metadata only after history is cleared', async () => {
        const { service, batches } = setup(); await service.initialize();
        const recorder = service.startRun({ prompt: 'old body', provider: 'p', model: 'm' });
        await service.flush(); await service.clearHistory();
        recorder.observe({ nodeId: 'later', kind: 'llm', phase: 'receiving', text: 'late old output', reasoning: 'late old reasoning' });
        recorder.finish('completed'); await service.flush();
        expect(batches.at(-1)?.generation.generation).toBe(1);
        expect(batches.at(-1)?.run.status).toBe('completed');
        expect(batches.flatMap(batch => batch.contents)).toEqual([]);
        expect(service.getSessionDetails(recorder.captureId, 'later')).toEqual([]);
        expect((await service.listRuns())[0].collection).toBe('partial');
        await service.dispose();
    });

    it('removes remote-deleted live runs and session detail after control revision changes', async () => {
        const { service, store, generation } = setup(); await service.initialize();
        const recorder = service.startRun({ conversationId: 'c', prompt: 'old', provider: 'p', model: 'm' });
        recorder.observe({ nodeId: 'call', kind: 'llm', phase: 'receiving', reasoning: 'old reasoning' });
        generation.revision = 1; store.isRunAllowed.mockResolvedValue(false);
        await service.refreshGeneration();
        expect(await service.listRuns()).toEqual([]);
        expect(service.getSessionDetails(recorder.captureId, 'call')).toEqual([]);
        recorder.observe({ nodeId: 'call', kind: 'llm', phase: 'receiving', reasoning: 'late reasoning' });
        expect(service.getSessionDetails(recorder.captureId, 'call')).toEqual([]);
        await service.dispose();
    });

    it('commits terminal metadata when both the event and queue budget are exhausted', async () => {
        const { service, batches } = setup(true, { runEvents: 1, queueBytes: 1, queueEvents: 1 });
        await service.initialize();
        const recorder = service.startRun({ prompt: 'body exceeds queue', provider: 'p', model: 'm' });
        recorder.finish('failed'); await service.flush();
        expect(batches.at(-1)?.run).toMatchObject({ status: 'failed', collection: 'partial', hasGap: true });
        expect(batches.flatMap(batch => batch.contents)).toEqual([]);
        await service.dispose();
    });

    it('keeps content hidden after a failed cleanup until that cleanup succeeds', async () => {
        const { service, store } = setup(); await service.initialize();
        const recorder = service.startRun({ prompt: 'old body', provider: 'p', model: 'm' });
        await service.flush();
        expect(await service.getContents(recorder.captureId)).not.toEqual([]);
        store.clear.mockRejectedValueOnce(new Error('transaction failed'));
        await expect(service.clearHistory()).rejects.toThrow('transaction failed');
        expect(await service.getContents(recorder.captureId)).toEqual([]);
        expect((await service.getStatus()).recoveryReady).toBe(false);
        await service.clearHistory();
        expect((await service.getStatus()).recoveryReady).toBe(true);
        await service.dispose();
    });

    it('keeps the main model while recording auxiliary purpose and distinct observable timings', async () => {
        const { service } = setup(); await service.initialize();
        const recorder = service.startRun({ prompt: 'question', provider: 'main', model: 'main-model' });
        recorder.observe({ nodeId: 'rewrite', callId: 'rewrite', kind: 'llm', phase: 'dispatch', purpose: 'query_rewrite',
            provider: 'helper', model: 'small-model', timing: { event: 'dispatch', at: 1 } });
        recorder.observe({ nodeId: 'rewrite', callId: 'rewrite', kind: 'llm', phase: 'finished', purpose: 'query_rewrite',
            timing: { event: 'consumer_end', at: 4 } });
        expect((await service.listRuns())[0]).toMatchObject({ provider: 'main', model: 'main-model' });
        const events = await service.getEvents(recorder.captureId);
        expect(events[1].details).toMatchObject({ purpose: 'query_rewrite', provider: 'helper', model: 'small-model', 'timing.dispatch': 1 });
        expect(events[2]).toMatchObject({ durationMs: 3, details: { 'timing.consumer_end': 4 } });
        await service.dispose();
    });
});
