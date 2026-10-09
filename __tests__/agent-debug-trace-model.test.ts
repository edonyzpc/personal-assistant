import { describe, expect, it } from '@jest/globals';
import { buildTraceModel, TraceAccumulator, traceInterval, visibleTraceRows } from '../src/agent-debug/trace-model';
import type { DebugEvent, DebugTracePage } from '../src/agent-debug/types';

function event(seq: number, nodeId: string, overrides: Partial<DebugEvent> = {}): DebugEvent {
    return { vaultKey: 'vault', captureId: 'run', seq, nodeId, segment: 0, timestamp: 1000 + seq,
        kind: 'stage', contentIds: [], ...overrides };
}
function page(events: DebugEvent[], overrides: Partial<DebugTracePage> = {}): DebugTracePage {
    return { events, liveEvents: [], through: 900, nextAfter: 900, hasMore: false, run: null, availability: 'available', ...overrides };
}

describe('complete Debug trace model', () => {
    it('keeps early, middle and live nodes while enumerating fixed persistent high water with sparse seq', () => {
        const accumulator = new TraceAccumulator();
        const all = Array.from({ length: 700 }, (_, index) => event(index + 1, `node-${index + 1}`));
        accumulator.apply(page(all.slice(0, 500), { through: 700, nextAfter: 500, hasMore: true,
            liveEvents: [event(850, 'live-node')] }), 0);
        expect(accumulator.completedThrough).toBe(0);
        accumulator.apply(page(all.slice(500), { through: 700, nextAfter: 700, liveEvents: [event(850, 'live-node')] }), 500);
        accumulator.apply(page([event(900, 'sparse-node')], { liveEvents: [event(1000, 'new-live')] }), 700);
        const model = buildTraceModel(accumulator.events());
        expect(model.nodes.size).toBe(702);
        expect(model.nodes.has('node-1')).toBe(true);
        expect(model.nodes.has('node-550')).toBe(true);
        expect(model.nodes.has('new-live')).toBe(true);
        expect(model.nodes.has('live-node')).toBe(false);
        expect(model.nodes.get('sparse-node')?.anomalies.gaps).toBe(0);
        expect(accumulator.completedThrough).toBe(900);
    });

    it('replaces an overlay only when its canonical range has been loaded and drops obsolete content refs', () => {
        const accumulator = new TraceAccumulator();
        accumulator.apply(page([event(1, 'receive')], { through: 10, nextAfter: 1, hasMore: true,
            liveEvents: [event(8, 'model', { contentIds: ['obsolete'] }), event(12, 'pending')] }), 0);
        expect(buildTraceModel(accumulator.events()).nodes.get('model')?.event.contentIds).toEqual(['obsolete']);
        accumulator.apply(page([event(10, 'model', { contentIds: ['canonical-a', 'canonical-b'] })], { through: 10, nextAfter: 10,
            liveEvents: [event(8, 'model', { contentIds: ['obsolete'] }), event(12, 'pending')] }), 1);
        expect(buildTraceModel(accumulator.events()).nodes.get('model')?.event.contentIds).toEqual(['canonical-a', 'canonical-b']);
        expect(buildTraceModel(accumulator.events()).nodes.has('pending')).toBe(true);
        accumulator.clear(); expect(accumulator.events()).toEqual([]);
    });

    it('keeps stable first-observed order, distinct occurrences, failed attempts and absent-field status', () => {
        const model = buildTraceModel([event(1, 'prepare-1'), event(2, 'call', { usage: { total: 100, complete: true } }),
            event(3, 'attempt-1', { parentId: 'call', status: 'failed', usage: { total: 40, complete: true } }),
            event(4, 'prepare-2'), event(5, 'attempt-2', { parentId: 'call', status: 'completed', usage: { total: 60, complete: true } }),
            event(6, 'call', { status: 'completed', usage: { total: 100, complete: true } }),
            event(7, 'attempt-1', { contentIds: ['error'] })]);
        expect(model.ordered).toEqual(['prepare-1', 'call', 'attempt-1', 'prepare-2', 'attempt-2']);
        expect(model.nodes.get('attempt-1')?.event.status).toBe('failed');
        expect(model.nodes.get('call')?.event.usage?.total).toBe(100);
        expect(model.nodes.get('call')?.anomalies.failed).toBe(1);
    });

    it('retains missing-parent and cyclic records, then attaches a late parent without changing identity', () => {
        const child = event(1, 'child', { parentId: 'parent' });
        expect(buildTraceModel([child]).roots).toEqual(['child']);
        const model = buildTraceModel([child, event(2, 'parent'), event(3, 'cycle-a', { parentId: 'cycle-b' }),
            event(4, 'cycle-b', { parentId: 'cycle-a' })]);
        expect(model.nodes.get('parent')?.children).toEqual(['child']);
        expect(visibleTraceRows(model, 'child', new Map(model.ordered.map(id => [id, true])), '').rows).toHaveLength(4);
        expect(model.nodes.get('cycle-a')?.structureIssue).toBe(true);
    });

    it('uses one monotonic run scale for serial and parallel boundaries without deriving legacy intervals', () => {
        const model = buildTraceModel([event(1, 'first', { boundary: 'start', elapsedMs: 0 }),
            event(2, 'parallel', { boundary: 'start', elapsedMs: 20 }),
            event(3, 'first', { boundary: 'end', elapsedMs: 80, status: 'completed' }),
            event(4, 'parallel', { boundary: 'end', elapsedMs: 100, status: 'completed' }),
            event(5, 'duration-only', { durationMs: 32 }), event(6, 'legacy', { details: { 'timing.dispatch': 10, 'timing.consumer_end': 60 } })]);
        expect(traceInterval(model.nodes.get('first')!, model.extentMs)).toEqual({ left: 0, width: 80, running: false });
        expect(traceInterval(model.nodes.get('parallel')!, model.extentMs)).toEqual({ left: 20, width: 80, running: false });
        expect(model.nodes.get('duration-only')?.durationMs).toBe(32);
        expect(traceInterval(model.nodes.get('duration-only')!, model.extentMs)).toBeUndefined();
        expect(model.nodes.get('legacy')?.durationMs).toBe(50);
        expect(traceInterval(model.nodes.get('legacy')!, model.extentMs)).toBeUndefined();
    });

    it('does not create completed intervals from an update or overwrite owner duration with child totals', () => {
        const model = buildTraceModel([event(1, 'owner', { boundary: 'start', elapsedMs: 5, durationMs: 15 }),
            event(2, 'owner', { boundary: 'update', elapsedMs: 30, status: 'completed' }),
            event(3, 'child', { parentId: 'owner', durationMs: 100 })]);
        expect(model.nodes.get('owner')?.durationMs).toBe(15);
        expect(traceInterval(model.nodes.get('owner')!, model.extentMs)).toBeUndefined();
    });

    it('searches the full metadata index with ancestors and restores manual collapse after search clears', () => {
        const model = buildTraceModel([event(1, 'run', { nodeKind: 'run' }), event(2, 'turn-1', { nodeKind: 'turn', parentId: 'run' }),
            event(3, 'early', { parentId: 'turn-1', label: 'Prepare context' }), event(800, 'turn-9', { nodeKind: 'turn', parentId: 'run' }),
            event(900, 'late', { parentId: 'turn-9', errorSummary: 'Provider quota unavailable' })]);
        const overrides = new Map([['run', true], ['turn-1', false], ['turn-9', false]]);
        expect(visibleTraceRows(model, 'late', overrides, 'quota').rows.map(row => row.id)).toEqual(['run', 'turn-9', 'late']);
        expect(visibleTraceRows(model, 'late', overrides, 'context').rows.map(row => row.id)).toEqual(['run', 'turn-1', 'early']);
        expect(visibleTraceRows(model, 'late', overrides, '').rows.map(row => row.id)).toEqual(['run', 'turn-1', 'turn-9']);
        expect(visibleTraceRows(model, 'late', overrides, 'unknown text').matches).toBe(0);
    });

    it('preserves content provenance by immutable content reference', () => {
        const model = buildTraceModel([event(1, 'tool', { contentRole: 'actual_tool_result', contentIds: ['raw'] }),
            event(2, 'tool', { contentRole: 'model_tool_observation', contentIds: ['model'] })]);
        expect([...model.nodes.get('tool')!.contentRoles]).toEqual([['raw', 'actual_tool_result'], ['model', 'model_tool_observation']]);
    });

    it('keeps the Run start and full duration when first Chat text is recorded as an independent instant', () => {
        const events = [event(1, 'run', { nodeKind: 'run', boundary: 'start', elapsedMs: 0, status: 'running' }),
            event(2, 'chat-committed', { nodeKind: 'phase', parentId: 'run', kind: 'first_chat_text_committed',
                boundary: 'instant', elapsedMs: 40, status: 'completed' }),
            event(3, 'tool', { nodeKind: 'tool', parentId: 'run', boundary: 'start', elapsedMs: 60, status: 'running' })];
        const active = buildTraceModel(events);
        expect(active.nodes.get('run')?.event.status).toBe('running');
        expect(active.nodes.get('run')?.startMs).toBe(0);
        expect(active.nodes.get('run')?.endMs).toBeUndefined();
        const finished = buildTraceModel([...events, event(4, 'run', { nodeKind: 'run', boundary: 'end', elapsedMs: 100, status: 'completed' })]);
        expect(finished.nodes.get('run')?.durationMs).toBe(100);
        expect(finished.nodes.get('chat-committed')?.durationMs).toBe(0);
    });

    it('searches earlier tool names and phases when a legitimate later payload changes the node label', () => {
        const model = buildTraceModel([event(1, 'turn', { nodeKind: 'turn' }),
            event(2, 'tool', { parentId: 'turn', kind: 'tool_end', label: 'B167_LONG_TOOL', status: 'completed' }),
            event(3, 'tool', { parentId: 'turn', kind: 'tool_observation', label: 'tool_observation', contentIds: ['body'] })]);
        expect(model.nodes.get('tool')?.event.label).toBe('tool_observation');
        expect(model.nodes.get('tool')?.event.status).toBe('completed');
        expect(visibleTraceRows(model, undefined, new Map(), 'B167_LONG_TOOL').rows.map(row => row.id)).toEqual(['turn', 'tool']);
        expect(visibleTraceRows(model, undefined, new Map(), 'tool_end').matches).toBe(1);
        expect(visibleTraceRows(model, undefined, new Map(), 'tool_observation').matches).toBe(1);
    });

    it('removes historical search terms when an overlay is replaced canonically or the capture is cleared', () => {
        const accumulator = new TraceAccumulator();
        accumulator.apply(page([], { through: 0, nextAfter: 0, liveEvents: [event(2, 'tool', { label: 'temporary old name' })] }), 0);
        expect(visibleTraceRows(buildTraceModel(accumulator.events()), undefined, new Map(), 'temporary old name').matches).toBe(1);
        accumulator.apply(page([event(3, 'tool', { label: 'canonical name' })], { through: 3, nextAfter: 3 }), 0);
        const replaced = buildTraceModel(accumulator.events());
        expect(visibleTraceRows(replaced, undefined, new Map(), 'temporary old name').matches).toBe(0);
        expect(visibleTraceRows(replaced, undefined, new Map(), 'canonical name').matches).toBe(1);
        accumulator.clear();
        expect(visibleTraceRows(buildTraceModel(accumulator.events()), undefined, new Map(), 'canonical name').matches).toBe(0);
    });
});
