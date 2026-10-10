import { AgentDebugService } from '../src/agent-debug/service';
import type { AgentDebugStore } from '../src/agent-debug/store';
import type { DebugBatch, DebugBudgets, DebugGeneration, DebugTracePage, DebugTraceQuery } from '../src/agent-debug/types';
import { buildTraceModel } from '../src/agent-debug/trace-model';

function setup(enabled = true, budgets?: Partial<DebugBudgets>, monotonicNow: () => number = () => 0, now: () => number = () => 1000) {
    const generation: DebugGeneration = { generation: 0, domains: {}, quarantined: false, sourceToken: 'token-a' };
    const batches: DebugBatch[] = [];
    const store = {
        initialize: jest.fn(async () => undefined), getOwners: jest.fn(async () => []), beginOwner: jest.fn(async () => false), endOwner: jest.fn(async () => undefined),
        getGeneration: jest.fn(async () => ({ ...generation, domains: { ...generation.domains } })),
        prune: jest.fn(async () => undefined), close: jest.fn(),
        writeBatch: jest.fn(async (batch: DebugBatch) => { batches.push(batch); return true; }),
        getContents: jest.fn(async (id: string) => batches.filter(batch => batch.run.captureId === id).flatMap(batch => batch.contents)),
        getEvents: jest.fn(async () => []), listRuns: jest.fn(async () => []),
        getTracePage: jest.fn(async (id: string, query: DebugTraceQuery = {}): Promise<DebugTracePage> => {
            const captures = batches.filter(batch => batch.run.captureId === id);
            const all = captures.flatMap(batch => batch.events).sort((left, right) => left.seq - right.seq);
            const run = captures.at(-1)?.run;
            const committed = all.at(-1)?.seq ?? 0;
            const through = Math.min(query.through ?? committed, committed);
            const candidates = all.filter(event => event.seq > (query.after ?? 0) && event.seq <= through);
            const events = candidates.slice(0, query.limit ?? 200);
            const hasMore = candidates.length > events.length;
            return { events, liveEvents: [], through, nextAfter: hasMore ? events.at(-1)!.seq : through, hasMore,
                run: run ? { ...run, lastCommittedSeq: committed } : null, availability: run ? 'available' : 'cleared' };
        }),
        getRun: jest.fn(async () => undefined),
        isRunAllowed: jest.fn(async () => true),
        clear: jest.fn(async () => { generation.generation++; batches.splice(0); generation.quarantined = false; }),
        invalidateConversation: jest.fn(async () => { batches.splice(0); }),
        revokeDomains: jest.fn(async () => { generation.domains.vault_notes = 1; batches.splice(0); }),
        applySourceToken: jest.fn(async (token: string) => { generation.sourceToken = token; }),
        status: jest.fn(async () => ({ available: true, recoveryReady: true, bytes: 0, limit: 1000 })),
    };
    const service = new AgentDebugService({ vaultKey: 'vault', enabled: () => enabled, recoveryReady: true,
        store: store as unknown as AgentDebugStore, now, monotonicNow, budgets });
    return { service, store, batches, generation };
}

describe('Agent Debug service', () => {
    it('persists the real assistant message identity on model-call events', async () => {
        const { service, batches } = setup();
        await service.initialize();
        const recorder = service.startRun({ prompt: 'question', provider: 'p', model: 'm' });
        recorder.bindRun('runtime-run-real');
        recorder.observe({
            nodeId: `${recorder.captureId}:llm:message-1`,
            parentId: 'turn-1',
            kind: 'llm',
            phase: 'answer',
            boundary: 'start',
            turnId: 'turn-1',
            messageId: 'message-1',
            callId: `${recorder.captureId}:llm:message-1`,
            purpose: 'answer',
        });
        await service.flush();
        expect(batches.flatMap(batch => batch.events).find(event => event.nodeKind === 'llm'))
            .toMatchObject({ turnId: 'turn-1', messageId: 'message-1' });
    });

    it('keeps a delayed early commit reachable after it leaves the 500 event live tail', async () => {
        const { service, store, batches } = setup();
        await service.initialize();
        let release!: () => void;
        const writing = new Promise<void>(resolve => { release = resolve; });
        store.writeBatch.mockImplementationOnce(async batch => { await writing; batches.push(batch); return true; });
        const recorder = service.startRun({ prompt: 'question', provider: 'p', model: 'm' });
        recorder.observe({ nodeId: 'early', kind: 'phase', phase: 'prepare', boundary: 'instant' });
        const flushing = service.flush();
        for (let index = 0; index < 605; index++) recorder.observe({ nodeId: `later-${index}`, kind: 'phase', phase: 'step' });
        const before = await service.getTracePage(recorder.captureId);
        expect(before.events).toEqual([]);
        expect(before).toMatchObject({ through: 0, nextAfter: 0, hasMore: false, availability: 'partial', reason: 'persistence_pending' });
        expect(before.run?.hasGap).toBe(false);
        expect(before.liveEvents).toHaveLength(500);
        expect(before.liveEvents.some(event => event.nodeId === 'early')).toBe(false);
        release(); await flushing; await service.flush();
        let page = await service.getTracePage(recorder.captureId);
        const through = page.through;
        const loaded = [...page.events];
        while (page.hasMore) {
            page = await service.getTracePage(recorder.captureId, { after: page.nextAfter, through });
            loaded.push(...page.events);
        }
        expect(loaded).toHaveLength(607);
        expect(loaded.some(event => event.nodeId === 'early')).toBe(true);
        expect(loaded.at(-1)?.nodeId).toBe('later-604');
        expect(page.nextAfter).toBe(607);
        expect(page.availability).toBe('available');
        expect(page.reason).toBeUndefined();
        await service.dispose();
    });

    it('records first Chat text as a stable child without changing the Run status or capture interval', async () => {
        let monotonic = 100;
        const { service, batches } = setup(true, undefined, () => monotonic);
        await service.initialize();
        const recorder = service.startRun({ prompt: 'question', provider: 'p', model: 'm' });
        recorder.bindRun('runtime');
        monotonic = 110;
        recorder.observe({ nodeId: recorder.captureId, kind: 'run', phase: 'agent_start', boundary: 'start', status: 'running' });
        monotonic = 120;
        service.recordTextCommitted('runtime');
        for (let index = 0; index < 505; index++) recorder.observe({ nodeId: `phase-${index}`, kind: 'phase', phase: 'step' });
        service.recordTextCommitted('runtime');
        await service.flush();
        const events = batches.flatMap(batch => batch.events);
        const interim = buildTraceModel(events);
        expect(interim.nodes.get(recorder.captureId)).toMatchObject({ startMs: 0,
            event: { nodeKind: 'run', kind: 'agent_start', status: 'running' } });
        expect(interim.nodes.get(recorder.captureId)?.endMs).toBeUndefined();
        const committed = events.filter(event => event.kind === 'first_chat_text_committed');
        expect(committed).toHaveLength(1);
        expect(committed[0]).toMatchObject({ nodeId: `${recorder.captureId}:first-chat-text-committed`, parentId: recorder.captureId,
            nodeKind: 'phase', boundary: 'instant', status: 'completed', elapsedMs: 20 });
        expect(interim.nodes.get(committed[0].nodeId)).toMatchObject({ startMs: 20, endMs: 20 });
        monotonic = 160; recorder.finish('completed'); await service.flush();
        const final = buildTraceModel(batches.flatMap(batch => batch.events));
        expect(final.nodes.get(recorder.captureId)).toMatchObject({ startMs: 0, endMs: 60, durationMs: 60,
            event: { nodeKind: 'run', status: 'completed' } });
        await service.dispose();
    });

    it('rejects an expired historical trace returned by a delayed store read without live state', async () => {
        let now = 1000;
        const { service, store } = setup(true, undefined, () => 0, () => now);
        await service.initialize();
        const run = { vaultKey: 'vault', captureId: 'historical', startedAt: 100, updatedAt: 100,
            expiresAt: 1050, status: 'completed' as const, collection: 'complete' as const,
            eventCount: 1, accountedBytes: 0, lastCommittedSeq: 1, hasGap: false };
        let release!: () => void;
        store.getTracePage.mockImplementationOnce(() => new Promise(resolve => {
            release = () => resolve({ events: [{ vaultKey: 'vault', captureId: 'historical', seq: 1, segment: 0,
                nodeId: 'history', timestamp: 100, kind: 'prompt', label: 'old title', contentIds: [] }],
            liveEvents: [], through: 1, nextAfter: 1, hasMore: false, availability: 'available', run });
        }));
        const reading = service.getTracePage('historical');
        await Promise.resolve();
        now = 1051; release();
        expect(await reading).toMatchObject({ run: null, events: [], liveEvents: [], availability: 'cleared' });
        await service.dispose();
    });

    it('reports safe node read errors and discards late failures after clear or expiry', async () => {
        const { service, store } = setup(); await service.initialize();
        const recorder = service.startRun({ prompt: 'question', provider: 'p', model: 'm' });
        await service.flush();
        store.getContents.mockRejectedValueOnce(new Error('Bearer private-provider-error'));
        await expect(service.getContents(recorder.captureId)).rejects.toThrow('storage_read_failed');
        for (const effect of ['clear', 'expiry']) {
            let now = 1000;
            const scenario = setup(true, { retentionMs: 50 }, () => 0, () => now);
            await scenario.service.initialize();
            const current = scenario.service.startRun({ prompt: 'question', provider: 'p', model: 'm' });
            await scenario.service.flush();
            let reject!: () => void;
            scenario.store.getContents.mockImplementationOnce(() => new Promise((_resolve, rejectRead) => {
                reject = () => rejectRead(new Error('private late error'));
            }));
            const reading = scenario.service.getContents(current.captureId);
            for (let index = 0; index < 8; index++) await Promise.resolve();
            if (effect === 'clear') await scenario.service.clearHistory(); else now = 1051;
            reject();
            expect(await reading).toEqual([]);
            await scenario.service.dispose();
        }
        await service.dispose();
    });

    it('returns canonical merged content references separately from the uncommitted overlay', async () => {
        const { service } = setup(); await service.initialize();
        const recorder = service.startRun({ prompt: 'question', provider: 'p', model: 'm' });
        recorder.observe({ nodeId: 'answer', kind: 'llm', phase: 'receiving', text: 'first' });
        recorder.observe({ nodeId: 'answer', kind: 'llm', phase: 'receiving', text: 'second' });
        await service.flush();
        const page = await service.getTracePage(recorder.captureId, { limit: 1 });
        expect(page).toMatchObject({ through: 3, nextAfter: 1, hasMore: true });
        expect(page.liveEvents.map(event => event.seq)).toEqual([1, 2, 3]);
        const end = await service.getTracePage(recorder.captureId, { after: page.nextAfter, through: page.through });
        expect(end.events).toHaveLength(1);
        expect(end.events[0]).toMatchObject({ seq: 3, contentIds: ['answer:output:0:2:0', 'answer:output:0:3:0'] });
        expect(end).toMatchObject({ nextAfter: 3, hasMore: false });
        await service.dispose();
    });

    it('preserves node provenance and filtered errors using one monotonic capture clock', async () => {
        let monotonic = 100;
        const { service, batches } = setup(true, undefined, () => monotonic);
        await service.initialize();
        const recorder = service.startRun({ prompt: 'question', provider: 'p', model: 'm' });
        monotonic = 110;
        recorder.observe({ nodeId: 'attempt', kind: 'attempt', phase: 'dispatch', boundary: 'start',
            timing: { event: 'dispatch', at: 108 } });
        monotonic = 140;
        recorder.observe({ nodeId: 'attempt', kind: 'attempt', phase: 'done', boundary: 'end',
            timing: { event: 'consumer_end', at: 138 }, error: { name: 'ProviderError', message: `Bearer secret-credential sk-123456789 ${'x'.repeat(900)}` } });
        recorder.observe({ nodeId: 'tool', kind: 'tool', phase: 'tool_result', contentRole: 'actual_tool_result', toolOutput: 'real result' });
        recorder.observe({ nodeId: 'tool', kind: 'tool', phase: 'tool_model_text', contentRole: 'model_tool_observation', toolOutput: 'model text' });
        await service.flush();
        const events = batches.flatMap(batch => batch.events);
        expect(events[0]).toMatchObject({ nodeKind: 'run', boundary: 'start', elapsedMs: 0, timestamp: 1000 });
        expect(events[1]).toMatchObject({ nodeKind: 'attempt', boundary: 'start', elapsedMs: 10, details: { 'timing.dispatch': 8 } });
        expect(events[2]).toMatchObject({ boundary: 'end', elapsedMs: 40, durationMs: 30, details: { 'timing.consumer_end': 38 } });
        expect(events[2].errorSummary).toContain('Bearer [filtered]');
        expect(events[2].errorSummary).not.toContain('secret-credential');
        expect(events[2].errorSummary).not.toContain('sk-123456789');
        expect(events[2].errorSummary!.length).toBeLessThanOrEqual(512);
        expect(events.slice(3).map(event => event.contentRole)).toEqual(['actual_tool_result', 'model_tool_observation']);
        expect(batches.flatMap(batch => batch.contents).filter(content => content.kind === 'tool_output')
            .map(content => [content.contentRole, content.text])).toEqual([['actual_tool_result', 'real result'], ['model_tool_observation', 'model text']]);
        await service.clearHistory();
        expect((await service.getTracePage(recorder.captureId)).liveEvents.some(event => event.errorSummary)).toBe(false);
        await service.dispose();
    });

    it('distinguishes failed reads and incomplete no-database tails from an empty complete trace', async () => {
        const { service, store } = setup(); await service.initialize();
        store.getTracePage.mockRejectedValueOnce(new Error('unprojected provider payload'));
        expect(await service.getTracePage('missing')).toMatchObject({ events: [], availability: 'unavailable', reason: 'storage_read_failed' });
        await service.dispose();
        const fallback = setup();
        fallback.store.initialize.mockRejectedValueOnce(new Error('no database'));
        await fallback.service.initialize();
        const recorder = fallback.service.startRun({ prompt: 'question', provider: 'p', model: 'm' });
        for (let index = 0; index < 605; index++) recorder.observe({ nodeId: `node-${index}`, kind: 'phase', phase: 'step' });
        const page = await fallback.service.getTracePage(recorder.captureId);
        expect(page).toMatchObject({ events: [], through: 0, nextAfter: 0, hasMore: false, availability: 'partial', reason: 'session_tail_incomplete' });
        expect(page.liveEvents).toHaveLength(500);
        await fallback.service.dispose();
    });

    it('rejects delayed trace pages after clear, temporary admission revocation or unload', async () => {
        for (const effect of ['clear', 'admission', 'unload']) {
            const { service, store } = setup(); await service.initialize();
            const recorder = service.startRun({ prompt: 'question', provider: 'p', model: 'm' });
            await service.flush();
            const oldPage = await service.getTracePage(recorder.captureId);
            let release!: () => void;
            store.getTracePage.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(oldPage); }));
            const reading = service.getTracePage(recorder.captureId);
            await Promise.resolve();
            if (effect === 'clear') await service.clearHistory();
            else if (effect === 'admission') { service.setRecoveryReady(false); service.setRecoveryReady(true); }
            else await service.dispose();
            release();
            expect(await reading).toMatchObject({ events: [], liveEvents: [], run: null, availability: 'cleared' });
            await service.dispose();
        }
    });

    it('does not reveal pages or node contents when a live run expires during the read', async () => {
        let now = 1000;
        const { service, store, batches } = setup(true, { retentionMs: 50 }, () => 0, () => now);
        await service.initialize();
        const recorder = service.startRun({ prompt: 'question', provider: 'p', model: 'm' });
        await service.flush();
        const oldPage = await service.getTracePage(recorder.captureId);
        const oldContents = batches.flatMap(batch => batch.contents);
        let releasePage!: () => void;
        let releaseContents!: () => void;
        store.getTracePage.mockImplementationOnce(() => new Promise(resolve => { releasePage = () => resolve(oldPage); }));
        store.getContents.mockImplementationOnce(() => new Promise(resolve => { releaseContents = () => resolve(oldContents); }));
        const page = service.getTracePage(recorder.captureId);
        const contents = service.getContents(recorder.captureId);
        for (let index = 0; index < 8; index++) await Promise.resolve();
        now = 1051;
        releasePage(); releaseContents();
        expect(await page).toMatchObject({ events: [], liveEvents: [], availability: 'cleared' });
        expect(await contents).toEqual([]);
        await service.dispose();
    });

    it('rejects metadata returned after history was cleared during an event read', async () => {
        const { service, store, batches } = setup();
        await service.initialize();
        const recorder = service.startRun({ prompt: 'question', provider: 'p', model: 'm' });
        await service.flush();
        const oldEvents = batches.flatMap(batch => batch.events);
        let release!: () => void;
        store.getEvents.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(oldEvents as never[]); }));
        const reading = service.getEvents(recorder.captureId);
        await Promise.resolve();
        await service.clearHistory();
        release();
        expect(await reading).toEqual([]);
        await service.dispose();
    });

    it('admits only one bounded oversized observation until its write settles', async () => {
        const { service, store, batches } = setup();
        await service.initialize();
        const recorder = service.startRun({ prompt: 'question', provider: 'p', model: 'm' });
        await service.flush();
        let finishWrite!: () => void;
        const writing = new Promise<void>(resolve => { finishWrite = resolve; });
        store.writeBatch.mockImplementationOnce(async batch => { await writing; batches.push(batch); return true; });
        const extracted = 'x'.repeat(2.5 * 1024 * 1024);
        recorder.observe({ nodeId: 'tool-first', kind: 'tool', phase: 'tool_result', toolOutput: extracted });
        const flushing = service.flush();
        recorder.observe({ nodeId: 'small', kind: 'phase', phase: 'tool_completed' });
        recorder.observe({ nodeId: 'tool-second', kind: 'tool', phase: 'tool_result', toolOutput: extracted });
        recorder.finish('completed');
        expect((await service.listRuns())[0].hasGap).toBe(true);
        finishWrite(); await flushing; await service.flush();
        const contents = batches.flatMap(batch => batch.contents).filter(content => content.kind === 'tool_output');
        expect(contents.map(content => content.text).join('')).toBe(extracted);
        expect(contents.every(content => content.contentId.startsWith('tool-first:'))).toBe(true);
        expect(batches.flatMap(batch => batch.events).some(event => event.nodeId === 'small')).toBe(true);
        expect(batches.at(-1)?.run.status).toBe('completed');
        recorder.observe({ nodeId: 'tool-after-settle', kind: 'tool', phase: 'tool_result', toolOutput: extracted });
        await service.flush();
        expect(batches.flatMap(batch => batch.contents).filter(content => content.kind === 'tool_output')
            .map(content => content.text).join('')).toBe(extracted + extracted);
        await service.dispose();
    });

    it('saves a normal ready burst of 4096 immutable reply deltas without a capacity gap', async () => {
        const { service, batches } = setup();
        await service.initialize();
        const recorder = service.startRun({ prompt: 'question', provider: 'p', model: 'm' });
        await service.flush();
        const delta = 'complete reply fragment content. ';
        for (let index = 0; index < 4096; index++) {
            recorder.observe({ nodeId: 'answer', kind: 'llm', phase: 'receiving', text: delta });
        }
        recorder.finish('completed'); await service.flush();
        const output = batches.flatMap(batch => batch.contents).filter(content => content.kind === 'output');
        expect(output.map(content => content.text).join('')).toBe(delta.repeat(4096));
        expect(output.every(content => content.text === delta)).toBe(true);
        expect((await service.listRuns())[0]).toMatchObject({ hasGap: false, collection: 'complete' });
        await service.dispose();
    });

    it('accounts drained and inflight bodies until a slow write settles', async () => {
        const { service, store, batches } = setup(true, { queueBytes: 4096 });
        await service.initialize();
        let finishWrite!: () => void;
        const writing = new Promise<void>(resolve => { finishWrite = resolve; });
        store.writeBatch.mockImplementationOnce(async batch => { await writing; batches.push(batch); return true; });
        const recorder = service.startRun({ prompt: 'question', provider: 'p', model: 'm' });
        const pending = [service.flush()];
        for (let index = 0; index < 12; index++) {
            recorder.observe({ nodeId: 'answer', kind: 'llm', phase: 'receiving', text: `${index}:${'x'.repeat(800)}` });
            pending.push(service.flush());
        }
        finishWrite(); await Promise.all(pending);
        // Successive drains must not release budget while their captured batches still wait.
        expect(batches.flatMap(batch => batch.contents).reduce((sum, content) => sum + content.accountedBytes, 0)).toBeLessThan(4096);
        expect(batches.flatMap(batch => batch.contents).filter(content => content.kind === 'output').length).toBeLessThan(3);
        expect((await service.listRuns())[0].hasGap).toBe(true);
        recorder.observe({ nodeId: 'answer', kind: 'llm', phase: 'receiving', text: 'after-write' });
        await service.flush();
        expect(batches.flatMap(batch => batch.contents).at(-1)?.text).toBe('after-write');
        await service.dispose();
    });

    it('splits full extracted text and reasoning at storage-block limits without truncation', async () => {
        const { service, batches } = setup(true, { contentBytes: 1024 });
        await service.initialize();
        const recorder = service.startRun({ prompt: 'question', provider: 'p', model: 'm' });
        const extracted = '提取内容😀'.repeat(1200);
        recorder.observe({ nodeId: 'tool', kind: 'tool', phase: 'tool_result', toolOutput: { extractedText: extracted, data: 'full nested result' } });
        recorder.observe({ nodeId: 'answer', kind: 'llm', phase: 'receiving', reasoning: extracted });
        await service.flush();
        const blocks = batches.flatMap(batch => batch.contents);
        expect(blocks.filter(block => block.kind === 'reasoning').map(block => block.text).join('')).toBe(extracted);
        expect(JSON.parse(blocks.filter(block => block.kind === 'tool_output').map(block => block.text).join(''))).toEqual({ extractedText: extracted, data: 'full nested result' });
        expect((await service.listRuns())[0].hasGap).toBe(false);
        await service.dispose();
    });

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

    it('persists observed reasoning and complete tools independently of later prompts and Debug toggles', async () => {
        const { service, batches } = setup(); await service.initialize();
        const recorder = service.startRun({ prompt: 'question', provider: 'p', model: 'm' });
        recorder.observe({ nodeId: 'call', kind: 'llm', phase: 'receiving', reasoning: 'REASONING', toolInput: { path: 'TOOL_ONLY' },
            prompt: JSON.stringify({ messages: [{ role: 'user', content: 'PROMPT' }] }) });
        await service.flush();
        expect(JSON.stringify(batches)).toContain('PROMPT');
        expect(JSON.stringify(batches)).toContain('REASONING');
        expect(JSON.stringify(batches)).toContain('TOOL_ONLY');
        expect(service.getSessionDetails(recorder.captureId, 'call')).toEqual([]);
        service.setEnabled(false);
        expect((await service.getContents(recorder.captureId)).map(content => content.kind)).toEqual(expect.arrayContaining(['reasoning', 'tool_input']));
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

    it('keeps two physical attempts separate from an unattributed logical update', async () => {
        const { service } = setup(); await service.initialize();
        const recorder = service.startRun({ prompt: 'question', provider: 'p', model: 'm' });
        recorder.observe({ nodeId: 'call', callId: 'call', kind: 'llm', phase: 'prepare', purpose: 'answer' });
        for (const [attemptId, totalTokens] of [['A', 4], ['A', 7], ['A', 7], ['B', 3]] as const) {
            recorder.observe({ nodeId: attemptId, callId: 'call', attemptId, kind: 'attempt',
                phase: 'usage', purpose: 'answer', usage: { totalTokens, updateKey: 'stream',
                    aggregation: 'cumulative' } });
        }
        recorder.observe({ nodeId: 'call', callId: 'call', kind: 'llm', phase: 'usage', purpose: 'answer',
            usage: { totalTokens: 10, updateKey: 'invoke', aggregation: 'cumulative' } });
        const run = (await service.listRuns())[0];
        expect(run.physicalUsage?.total).toBe(10);
        expect(run.logicalUsage?.total).toBe(10);
        expect(run.usage).toMatchObject({ total: 10, complete: false });
        await service.dispose();
    });

    it('marks a usage-bearing attempt partial when its consumer closes before EOF', async () => {
        const { service } = setup(); await service.initialize();
        const recorder = service.startRun({ prompt: 'question', provider: 'p', model: 'm' });
        recorder.observe({ nodeId: 'A', callId: 'call', attemptId: 'A', kind: 'attempt',
            phase: 'usage', purpose: 'answer', usage: { totalTokens: 7, complete: true } });
        recorder.observe({ nodeId: 'A', callId: 'call', attemptId: 'A', kind: 'attempt',
            phase: 'consumer_end', status: 'partial', missingReason: 'consumer_closed_before_eof' });
        expect((await service.listRuns())[0].usage).toMatchObject({ total: 7, complete: false });
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
        const { service, batches } = setup(true, { runEvents: 1, runBytes: 1, queueBytes: 1, queueEvents: 1 });
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
