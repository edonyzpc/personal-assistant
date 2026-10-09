import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { EffectCallback, ReactElement, SetStateAction } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentDebugView, type AgentDebugViewHost } from '../src/agent-debug/view';
import { AgentDebugPanel, debugTextPrefix, groupDebugContents, projectDebugNodes } from '../src/agent-debug/components/AgentDebugPanel';
import { DebugDialog } from '../src/agent-debug/components/DebugDialog';
import type { DebugContent, DebugEvent, DebugRun } from '../src/agent-debug/types';
import { emptyDebugLineage } from '../src/agent-debug/types';

jest.mock('obsidian');
jest.mock('react-dom/client', () => ({ createRoot: jest.fn() }));
jest.mock('react-dom', () => ({ flushSync: (callback: () => void) => callback() }));

// Exercise actual component effects/handlers using the repository's lightweight hook pattern.
let mockHooks: PanelRenderer;
jest.mock('react', () => ({
    ...jest.requireActual<typeof import('react')>('react'),
    useState: <T,>(initial: T | (() => T)) => mockHooks.useState(initial),
    useRef: <T,>(initial: T) => mockHooks.useRef(initial),
    useEffect: (effect: EffectCallback, deps?: readonly unknown[]) => mockHooks.useEffect(effect, deps),
    useMemo: <T,>(factory: () => T) => factory(),
}));

type Node = ReactElement<{ children?: unknown; onClick?: () => void; onChange?: (event: { target: { value: string } }) => void;
    onSelect?: (id: string) => void; onBrowse?: () => void; model?: { nodes: Map<string, unknown> }; rows?: { id: string }[];
    nodes?: DebugEvent[]; event?: DebugEvent; contents?: DebugContent[]; hidden?: boolean; disabled?: boolean;
    onRetry?: () => void; failed?: boolean; 'aria-label'?: string }>;
function elements(tree: unknown): Node[] {
    if (Array.isArray(tree)) return tree.flatMap(elements);
    if (!tree || typeof tree !== 'object' || !('props' in tree)) return [];
    const node = tree as Node;
    return [node, ...elements(node.props.children)];
}
class PanelRenderer {
    private cells: unknown[] = [];
    private cursor = 0;
    private effects: Array<{ deps?: readonly unknown[]; cleanup?: () => void }> = [];
    private pending: Array<() => void> = [];
    tree: unknown;
    constructor(readonly host: AgentDebugViewHost, private readonly element?: unknown, private readonly component?: () => unknown) { this.render(); }
    useState<T>(initial: T | (() => T)): [T, (next: SetStateAction<T>) => void] {
        const index = this.cursor++;
        if (!(index in this.cells)) this.cells[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
        return [this.cells[index] as T, next => {
            this.cells[index] = typeof next === 'function' ? (next as (value: T) => T)(this.cells[index] as T) : next;
        }];
    }
    useRef<T>(initial: T): { current: T } {
        const index = this.cursor++;
        if (!(index in this.cells)) this.cells[index] = { current: index === 0 && this.element ? this.element : initial };
        return this.cells[index] as { current: T };
    }
    useEffect(effect: EffectCallback, deps?: readonly unknown[]): void {
        const index = this.cursor++;
        const prior = this.effects[index];
        if (prior && deps?.length === prior.deps?.length && deps?.every((value, key) => Object.is(value, prior.deps?.[key]))) return;
        this.pending.push(() => {
            prior?.cleanup?.();
            const cleanup = effect();
            this.effects[index] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined };
        });
    }
    render(): void {
        mockHooks = this; this.cursor = 0;
        this.tree = this.component ? this.component() : AgentDebugPanel({ host: this.host, conversationId: 'conversation' });
        this.pending.splice(0).forEach(effect => effect());
    }
    async settle(): Promise<void> {
        for (let index = 0; index < 10; index++) { await Promise.resolve(); await Promise.resolve(); jest.advanceTimersByTime(0); this.render(); }
    }
    snapshot(): string { return JSON.stringify(this.cells); }
    unmount(): void { this.effects.forEach(effect => effect.cleanup?.()); }
}
function event(overrides: Partial<DebugEvent> = {}): DebugEvent {
    return { vaultKey: 'vault', captureId: 'new-run', seq: 1, segment: 0, nodeId: 'call', kind: 'llm', timestamp: 123, contentIds: [], ...overrides };
}
function run(captureId: string, startedAt: number): DebugRun {
    return { vaultKey: 'vault', captureId, conversationId: 'conversation', startedAt, updatedAt: startedAt,
        expiresAt: Date.now() + 99999, status: 'running', collection: 'recording', eventCount: 1,
        accountedBytes: 100, lastCommittedSeq: 1, hasGap: false };
}
function fixture() {
    let listener: ((change?: { invalidated?: boolean }) => void) | undefined;
    const unsubscribe = jest.fn();
    const host = {
        enabled: () => true,
        listRuns: jest.fn<AgentDebugViewHost['listRuns']>(async () => [run('new-run', 200), run('older-run', 100)]),
        getEvents: jest.fn<AgentDebugViewHost['getEvents']>(async captureId => [event({ captureId })]),
        getTracePage: jest.fn<AgentDebugViewHost['getTracePage']>(async captureId => ({ events: [event({ captureId })], liveEvents: [],
            through: 1, nextAfter: 1, hasMore: false, run: run(captureId, 200), availability: 'available' })),
        getContents: jest.fn<AgentDebugViewHost['getContents']>(async () => []),
        getSessionDetails: () => [],
        getStatus: jest.fn<AgentDebugViewHost['getStatus']>(async () => ({ available: true, recoveryReady: true, bytes: 100, limit: 1000 })),
        subscribe: (callback: (change?: { invalidated?: boolean }) => void) => { listener = callback; return unsubscribe; },
        clearHistory: async () => undefined,
    } satisfies AgentDebugViewHost;
    return { host, unsubscribe, notify: (invalidated = false) => listener?.({ invalidated }) };
}

describe('Agent Debug view', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    it('merges updates by explicit node identity while preserving distinct request attempts', () => {
        const projected = projectDebugNodes([event({ status: 'running', contentIds: ['input'] }),
            event({ nodeId: 'attempt-1', parentId: 'call', attemptId: 'attempt-1', seq: 2 }),
            event({ seq: 3, status: 'completed', contentIds: ['output'] }),
            event({ nodeId: 'attempt-2', parentId: 'call', attemptId: 'attempt-2', seq: 4 })]);
        expect(projected).toHaveLength(3);
        expect(projected[0]).toMatchObject({ status: 'completed', contentIds: ['input', 'output'] });
        expect(projected.slice(1).map(node => node.attemptId)).toEqual(['attempt-1', 'attempt-2']);
    });

    it('retains known tool outcomes and independent timing evidence when later payload fields are absent', () => {
        const [node] = projectDebugNodes([
            event({ status: 'completed', details: { purpose: 'answer', provider: 'test', model: 'test-model', 'timing.dispatch': 10 } }),
            event({ status: undefined, kind: 'message_end', details: { 'timing.first_provider_text': 25 } }),
            event({ status: undefined, details: { 'timing.consumer_end': 60 } }),
        ]);
        expect(node.status).toBe('completed');
        expect(node.durationMs).toBe(50);
        expect(node.details).toMatchObject({ purpose: 'answer', 'timing.dispatch': 10, 'timing.first_provider_text': 25, 'timing.consumer_end': 60 });
        expect(projectDebugNodes([event({ details: { 'timing.consumer_end': 60 } })])[0].durationMs).toBeUndefined();
    });

    it('groups ordered output blocks without duplicating references or joining hidden text eagerly', () => {
        const block = (contentId: string, kind: DebugContent['kind'], text: string) => ({
            captureId: 'run', contentId, kind, text, redactions: [],
        }) as unknown as DebugContent;
        const groups = groupDebugContents([block('a', 'output', 'Hello '), block('prompt', 'prompt', '{"model":"test"}'),
            block('b', 'output', 'world'), block('a', 'output', 'Hello ')]);
        expect(groups).toHaveLength(2);
        expect(groups[0].parts).toEqual(['Hello ', 'world']);
        expect(debugTextPrefix(groups[0].parts, 8)).toBe('Hello wo');
        expect(debugTextPrefix(['a', 'b'], 20, '\n\n')).toBe('a\n\nb');
    });

    it('keeps only a route in workspace state and unmounts its React root', async () => {
        const { host } = fixture();
        const unmount = jest.fn();
        const render = jest.fn();
        jest.mocked(createRoot).mockReturnValue({ render, unmount });
        const view = new AgentDebugView({ containerEl: { querySelector: () => ({}) } } as never, host);
        await view.setState({ conversationId: 'conversation-1', prompt: 'must not persist' });
        await view.onOpen();
        expect(view.getState()).toEqual({ conversationId: 'conversation-1' });
        view.revealConversation('conversation-2');
        expect(render).toHaveBeenCalledTimes(2);
        await view.onClose();
        expect(unmount).toHaveBeenCalledTimes(1);
        await view.setState({ conversationId: '<private title>' });
        expect(view.getState()).toEqual({});
    });

    it('rejects a late content query after synchronous governance invalidation and releases its subscription', async () => {
        const { host, notify, unsubscribe } = fixture();
        let resolve!: (contents: DebugContent[]) => void;
        host.getContents.mockImplementation(() => new Promise(result => { resolve = result; }));
        const renderer = new PanelRenderer(host);
        await renderer.settle();
        expect(host.getContents).toHaveBeenCalled();
        notify(true);
        renderer.render();
        resolve([{ contentId: 'revoked', text: 'private revoked text' } as DebugContent]);
        await renderer.settle();
        expect(renderer.snapshot()).not.toContain('private revoked text');
        renderer.unmount();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('keeps selected details mounted across an ordinary refresh but clears them on invalidation', async () => {
        const { host, notify } = fixture();
        const block = { contentId: 'visible', text: 'debug detail' } as DebugContent;
        host.getContents.mockResolvedValue([block]);
        const renderer = new PanelRenderer(host);
        await renderer.settle();
        const details = () => elements(renderer.tree).find(node => node.props.event?.nodeId === 'call');
        expect(details()?.props.contents).toEqual([block]);

        host.getContents.mockImplementation(() => new Promise(() => undefined));
        notify(); jest.advanceTimersByTime(100); renderer.render(); renderer.render();
        expect(details()?.props.contents).toEqual([block]);

        notify(true); renderer.render();
        expect(details()?.props.contents ?? []).toEqual([]);
        renderer.unmount();
    });

    it('keeps the selected historical run as fresh events arrive and passes filters to storage', async () => {
        const { host, notify } = fixture();
        const renderer = new PanelRenderer(host);
        await renderer.settle();
        elements(renderer.tree).find(node => node.type === 'button' && node.props.children === 'Runs')?.props.onClick?.();
        renderer.render();
        const historical = elements(renderer.tree).find(node => node.key === 'older-run');
        elements(historical).find(node => node.type === 'button')?.props.onClick?.();
        renderer.render(); await renderer.settle();
        notify(); jest.advanceTimersByTime(100); renderer.render(); await renderer.settle();
        expect(host.getTracePage.mock.calls.at(-1)?.[0]).toBe('older-run');
        elements(renderer.tree).find(node => node.type === 'select')?.props.onChange?.({ target: { value: 'failed' } });
        renderer.render(); await renderer.settle();
        expect(host.listRuns).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed', conversationId: 'conversation' }));
        renderer.unmount();
    });

    it('accumulates the complete long run and preserves selection as new metadata arrives', async () => {
        const { host } = fixture();
        host.listRuns.mockResolvedValue([{ ...run('new-run', 200), eventCount: 450, lastCommittedSeq: 450 }]);
        host.getTracePage.mockImplementation(async (_id, query) => ({ events: [event({
            seq: query.after ? 450 : 1, nodeId: query.after ? 'late-node' : 'first-node',
        })], liveEvents: [], through: 450, nextAfter: query.after ? 450 : 1, hasMore: !query.after,
            run: run('new-run', 200), availability: 'available' }));
        const renderer = new PanelRenderer(host);
        await renderer.settle();
        const trace = elements(renderer.tree).find(node => node.props.model?.nodes.has('late-node'));
        expect(trace).toBeDefined();
        trace?.props.onSelect?.('late-node');
        renderer.render(); await renderer.settle();
        expect(host.getTracePage).toHaveBeenCalledWith('new-run', expect.objectContaining({ after: 0, through: undefined }));
        expect(host.getTracePage).toHaveBeenCalledWith('new-run', expect.objectContaining({ after: 1, through: 450 }));
        expect(trace?.props.model?.nodes.has('first-node')).toBe(true);
        expect(elements(renderer.tree).some(node => node.props.event?.nodeId === 'late-node')).toBe(true);
        renderer.unmount();
    });

    it('polls only lightweight status while visible, checks focus immediately, and stops while hidden or closed', async () => {
        const { host } = fixture();
        const listeners = new Map<string, () => void>();
        const eventTarget = {
            addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
            removeEventListener: (name: string) => listeners.delete(name),
        };
        const document = { ...eventTarget, visibilityState: 'visible', defaultView: eventTarget };
        const renderer = new PanelRenderer(host, { ownerDocument: document, getClientRects: () => [{}] });
        await renderer.settle();
        const contentQueries = host.getContents.mock.calls.length;
        const statusQueries = host.getStatus.mock.calls.length;
        jest.advanceTimersByTime(1000); await renderer.settle();
        expect(host.getStatus).toHaveBeenCalledTimes(statusQueries + 1);
        expect(host.getContents).toHaveBeenCalledTimes(contentQueries);
        listeners.get('focus')?.(); await renderer.settle();
        expect(host.getStatus).toHaveBeenCalledTimes(statusQueries + 2);
        document.visibilityState = 'hidden'; listeners.get('visibilitychange')?.();
        jest.advanceTimersByTime(5000); await renderer.settle();
        expect(host.getStatus).toHaveBeenCalledTimes(statusQueries + 2);
        document.visibilityState = 'visible'; listeners.get('visibilitychange')?.(); await renderer.settle();
        expect(host.getStatus).toHaveBeenCalledTimes(statusQueries + 3);
        renderer.unmount();
        expect(listeners.size).toBe(0);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('searches metadata without reading body and restores the collapsed outline after clearing search', async () => {
        const { host } = fixture();
        host.getTracePage.mockResolvedValue({ events: [event({ nodeId: 'turn', nodeKind: 'turn' }),
            event({ seq: 2, nodeId: 'early', parentId: 'turn', label: 'Early context' }),
            event({ seq: 900, nodeId: 'late', parentId: 'turn', errorSummary: 'quota exhausted' })],
            liveEvents: [], through: 900, nextAfter: 900, hasMore: false, run: run('new-run', 200), availability: 'available' });
        const renderer = new PanelRenderer(host); await renderer.settle();
        const trace = () => elements(renderer.tree).find(node => node.props.model);
        (trace()?.props as unknown as { onToggle: (id: string, expanded: boolean) => void }).onToggle('turn', false);
        renderer.render(); await renderer.settle();
        const reads = host.getContents.mock.calls.length;
        elements(renderer.tree).find(node => node.type === 'input' && node.props['aria-label'])?.props.onChange?.({ target: { value: 'quota' } });
        renderer.render(); await renderer.settle();
        expect(trace()?.props.rows?.map(row => row.id)).toEqual(['turn', 'late']);
        expect(host.getContents).toHaveBeenCalledTimes(reads);
        elements(renderer.tree).find(node => node.type === 'input' && node.props['aria-label'])?.props.onChange?.({ target: { value: '' } });
        renderer.render(); await renderer.settle();
        expect(trace()?.props.rows?.map(row => row.id)).toEqual(['turn']);
        renderer.unmount();
    });

    it('pauses following on manual browsing and updates facts without replacing the selected node', async () => {
        const { host, notify } = fixture();
        const renderer = new PanelRenderer(host); await renderer.settle();
        const trace = () => elements(renderer.tree).find(node => node.props.model);
        trace()?.props.onBrowse?.(); renderer.render();
        host.getTracePage.mockResolvedValue({ events: [event({ seq: 2, nodeId: 'new-node', status: 'running' })], liveEvents: [],
            through: 2, nextAfter: 2, hasMore: false, run: run('new-run', 200), availability: 'available' });
        notify(); jest.advanceTimersByTime(100); renderer.render(); await renderer.settle();
        expect(trace()?.props.model?.nodes.has('new-node')).toBe(true);
        expect(elements(renderer.tree).some(node => node.props.event?.nodeId === 'call')).toBe(true);
        elements(renderer.tree).find(node => node.type === 'button' && node.props.children === 'Follow latest')?.props.onClick?.();
        renderer.render(); await renderer.settle();
        expect(elements(renderer.tree).some(node => node.props.event?.nodeId === 'new-node')).toBe(true);
        renderer.unmount();
    });

    it('keeps narrow detail navigation fixed to the entered visible sequence as live nodes arrive', async () => {
        const { host, notify } = fixture();
        host.getTracePage.mockResolvedValue({ events: [event({ nodeId: 'first' }), event({ seq: 2, nodeId: 'second' })], liveEvents: [],
            through: 2, nextAfter: 2, hasMore: false, run: run('new-run', 200), availability: 'available' });
        const renderer = new PanelRenderer(host, { clientWidth: 360, getClientRects: () => [{}] }); await renderer.settle();
        elements(renderer.tree).find(node => node.props.model)?.props.onSelect?.('first'); renderer.render(); await renderer.settle();
        expect(elements(renderer.tree).find(node => node.type === 'button' && node.props.children === 'Previous')?.props.disabled).toBe(true);
        host.getTracePage.mockResolvedValue({ events: [event({ seq: 3, nodeId: 'third' })], liveEvents: [],
            through: 3, nextAfter: 3, hasMore: false, run: run('new-run', 200), availability: 'available' });
        notify(); jest.advanceTimersByTime(100); renderer.render(); await renderer.settle();
        elements(renderer.tree).find(node => node.type === 'button' && node.props.children === 'Next')?.props.onClick?.();
        renderer.render(); await renderer.settle();
        expect(elements(renderer.tree).some(node => node.props.event?.nodeId === 'second')).toBe(true);
        expect(elements(renderer.tree).find(node => node.type === 'button' && node.props.children === 'Next')?.props.disabled).toBe(true);
        elements(renderer.tree).find(node => node.type === 'button' && node.props.children === 'Back to trace')?.props.onClick?.(); renderer.render();
        const track = elements(renderer.tree).find(node => node.type === 'section' && node.props['aria-label'] === 'Execution trace');
        expect(track?.props.hidden).toBe(false);
        renderer.unmount();
    });

    it('synchronously removes metadata and rejects a late trace page after clearing', async () => {
        const { host, notify } = fixture();
        const renderer = new PanelRenderer(host); await renderer.settle();
        let resolve!: (value: Awaited<ReturnType<AgentDebugViewHost['getTracePage']>>) => void;
        host.getTracePage.mockImplementation(() => new Promise(result => { resolve = result; }));
        notify(); jest.advanceTimersByTime(100); renderer.render(); await renderer.settle();
        notify(true); renderer.render();
        resolve({ events: [event({ label: 'revoked private metadata' })], liveEvents: [], through: 10, nextAfter: 10,
            hasMore: false, run: run('new-run', 200), availability: 'available' });
        await renderer.settle();
        expect(renderer.snapshot()).not.toContain('revoked private metadata');
        expect(elements(renderer.tree).find(node => node.props.model)?.props.model?.nodes.size).toBe(0);
        renderer.unmount(); expect(jest.getTimerCount()).toBe(0);
    });

    it('separates actual tool output, text supplied to the model and old output of unknown origin', () => {
        const block = (contentId: string, role?: DebugContent['contentRole']): DebugContent => ({ vaultKey: 'vault', captureId: 'run', contentId,
            kind: 'tool_output', text: contentId, redactions: [], contentRole: role, lineage: emptyDebugLineage(),
            generation: 0, domainGenerations: {}, accountedBytes: contentId.length });
        const groups = groupDebugContents([block('actual', 'actual_tool_result'), block('model', 'model_tool_observation'), block('old')]);
        expect(groups.map(group => [group.role, group.parts])).toEqual([
            ['actual_tool_result', ['actual']], ['model_tool_observation', ['model']], [undefined, ['old']],
        ]);
    });

    it.each(['close', 'escape', 'cancel'] as const)('restores trigger focus after the dialog %s lifecycle', action => {
        const { host } = fixture();
        const order: string[] = [];
        const trigger = { isConnected: true, focus: () => order.push('trigger-focused') };
        const dialog = { ownerDocument: { activeElement: trigger }, showModal: () => order.push('modal-opened'),
            close: () => order.push('modal-closed') };
        let closed = false;
        const renderer = new PanelRenderer(host, dialog, () => DebugDialog({ title: 'Turns', onClose: () => { closed = true; }, children: 'turns' }));
        if (action === 'close') elements(renderer.tree).find(node => node.type === 'button')?.props.onClick?.();
        else if (action === 'escape') {
            const preventDefault = jest.fn();
            const stopPropagation = jest.fn();
            (elements(renderer.tree)[0].props as unknown as { onKeyDown: (event: { key: string; preventDefault: () => void; stopPropagation: () => void }) => void })
                .onKeyDown({ key: 'Escape', preventDefault, stopPropagation });
            expect(preventDefault).toHaveBeenCalledTimes(1);
            expect(stopPropagation).toHaveBeenCalledTimes(1);
        } else {
            const preventDefault = jest.fn();
            (elements(renderer.tree)[0].props as unknown as { onCancel: (event: { preventDefault: () => void }) => void }).onCancel({ preventDefault });
            expect(preventDefault).toHaveBeenCalledTimes(1);
        }
        expect(closed).toBe(true);
        renderer.unmount();
        expect(order).toEqual(['modal-opened', 'modal-closed', 'trigger-focused']);
    });

    it('preserves a wide trace scroll position when selecting a different node', async () => {
        const { host } = fixture();
        host.getTracePage.mockResolvedValue({ events: [event({ nodeId: 'early' }), event({ seq: 2, nodeId: 'late' })], liveEvents: [],
            through: 2, nextAfter: 2, hasMore: false, run: run('new-run', 200), availability: 'available' });
        const renderer = new PanelRenderer(host, { clientWidth: 1000, getClientRects: () => [{}] }); await renderer.settle();
        const trace = elements(renderer.tree).find(node => node.props.model)!;
        const scroll = { scrollTop: 640, querySelectorAll: () => [] };
        (trace.props as unknown as { scrollRef: { current: unknown } }).scrollRef.current = scroll;
        trace.props.onSelect?.('early'); renderer.render(); await renderer.settle();
        expect(scroll.scrollTop).toBe(640);
        expect(elements(renderer.tree).some(node => node.props.event?.nodeId === 'early')).toBe(true);
        renderer.unmount();
    });

    it('explicit following opens the target ancestors while preserving unrelated manual collapse', async () => {
        const { host } = fixture();
        host.getTracePage.mockResolvedValue({ events: [event({ nodeId: 'root', nodeKind: 'run' }),
            event({ seq: 2, nodeId: 'turn-current', parentId: 'root', nodeKind: 'turn' }),
            event({ seq: 3, nodeId: 'model-current', parentId: 'turn-current', nodeKind: 'llm', status: 'running' }),
            event({ seq: 4, nodeId: 'turn-old', parentId: 'root', nodeKind: 'turn' }),
            event({ seq: 5, nodeId: 'old-tool', parentId: 'turn-old' })], liveEvents: [],
            through: 5, nextAfter: 5, hasMore: false, run: run('new-run', 200), availability: 'available' });
        const renderer = new PanelRenderer(host, { clientWidth: 1000, getClientRects: () => [{}] }); await renderer.settle();
        const trace = () => elements(renderer.tree).find(node => node.props.model)!;
        const toggle = (id: string, expanded: boolean) => (trace().props as unknown as { onToggle: (id: string, expanded: boolean) => void }).onToggle(id, expanded);
        toggle('turn-old', false); toggle('root', false); renderer.render(); await renderer.settle();
        expect(trace().props.rows?.map(row => row.id)).toEqual(['root']);
        const scrollIntoView = jest.fn();
        (trace().props as unknown as { scrollRef: { current: unknown } }).scrollRef.current = { scrollTop: 640,
            querySelectorAll: () => [{ dataset: { nodeId: 'model-current' }, scrollIntoView }] };
        elements(renderer.tree).find(node => node.type === 'button' && node.props.children === 'Follow latest')?.props.onClick?.();
        renderer.render(); await renderer.settle();
        expect(trace().props.rows?.map(row => row.id)).toEqual(['root', 'turn-current', 'model-current', 'turn-old']);
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
        renderer.unmount();
    });

    it('removes a loaded expired Run and details without requiring another Agent event', async () => {
        const { host } = fixture();
        const expiring = { ...run('new-run', 200), expiresAt: Date.now() + 20 };
        host.listRuns.mockResolvedValue([expiring]);
        host.getTracePage.mockResolvedValue({ events: [event({ label: 'short lived trace' })], liveEvents: [],
            through: 1, nextAfter: 1, hasMore: false, run: expiring, availability: 'available' });
        host.getContents.mockResolvedValue([{ contentId: 'short', text: 'short lived body' } as DebugContent]);
        const renderer = new PanelRenderer(host); await renderer.settle();
        expect(renderer.snapshot()).toContain('short lived body');
        jest.advanceTimersByTime(21); renderer.render(); await renderer.settle();
        expect(renderer.snapshot()).not.toContain('short lived body');
        expect(renderer.snapshot()).not.toContain('short lived trace');
        expect(elements(renderer.tree).find(node => node.props.model)?.props.model?.nodes.size).toBe(0);
        renderer.unmount(); expect(jest.getTimerCount()).toBe(0);
    });

    it('shows a failed detail read and retries the same node successfully with an explicit action', async () => {
        const { host } = fixture();
        host.getContents.mockRejectedValueOnce(new Error('storage_read_failed')).mockResolvedValueOnce([{ contentId: 'restored', text: 'recovered details' } as DebugContent]);
        const renderer = new PanelRenderer(host); await renderer.settle();
        const inspector = () => elements(renderer.tree).find(node => node.props.event?.nodeId === 'call');
        expect(inspector()?.props.failed).toBe(true);
        const traceReads = host.getTracePage.mock.calls.length;
        inspector()?.props.onRetry?.(); renderer.render(); await renderer.settle();
        expect(host.getContents).toHaveBeenCalledTimes(2);
        expect(host.getTracePage).toHaveBeenCalledTimes(traceReads);
        expect(inspector()?.props.failed).toBe(false);
        expect(inspector()?.props.contents?.[0].text).toBe('recovered details');
        renderer.unmount();
    });

    it('reports a pending saved prefix accurately, then reads committed pages to restore the complete trace', async () => {
        const { host, notify } = fixture();
        const all = Array.from({ length: 607 }, (_, index) => event({ seq: index + 1, nodeId: `node-${index + 1}`,
            label: index === 0 ? 'Early prefix node' : `Stage ${index + 1}` }));
        let committed = false;
        const metadata = { ...run('new-run', 200), eventCount: 607, lastCommittedSeq: 0, contentVersion: 2 as const };
        host.listRuns.mockResolvedValue([metadata]);
        host.getTracePage.mockImplementation(async (_captureId, query) => committed
            ? { events: all.slice(query.after ?? 0, (query.after ?? 0) + 500), liveEvents: all.slice(-500),
                through: 607, nextAfter: query.after ? 607 : 500, hasMore: !query.after,
                run: { ...metadata, lastCommittedSeq: 607 }, availability: 'available' }
            : { events: [], liveEvents: all.slice(-500), through: 0, nextAfter: 0, hasMore: false,
                run: metadata, availability: 'partial', reason: 'persistence_pending' });
        const renderer = new PanelRenderer(host); await renderer.settle();
        expect(JSON.stringify(renderer.tree)).toContain('Recorded activity is still being saved');
        expect(JSON.stringify(renderer.tree)).not.toContain('All recorded metadata loaded');
        expect(elements(renderer.tree).find(node => node.props.model)?.props.model?.nodes.size).toBe(500);
        elements(renderer.tree).find(node => node.type === 'input' && node.props['aria-label'])?.props.onChange?.({ target: { value: 'Early prefix' } });
        renderer.render(); await renderer.settle();
        expect(JSON.stringify(renderer.tree)).toContain('Search range is still loading');
        committed = true; notify(); jest.advanceTimersByTime(100); renderer.render(); await renderer.settle();
        expect(host.getTracePage).toHaveBeenCalledWith('new-run', expect.objectContaining({ after: 0, through: undefined }));
        expect(host.getTracePage).toHaveBeenCalledWith('new-run', expect.objectContaining({ after: 500, through: 607 }));
        expect(elements(renderer.tree).find(node => node.props.model)?.props.model?.nodes.size).toBe(607);
        expect(elements(renderer.tree).find(node => node.props.model)?.props.rows?.map(row => row.id)).toEqual(['node-1']);
        expect(JSON.stringify(renderer.tree)).toContain('All recorded metadata loaded');
        expect(JSON.stringify(renderer.tree)).not.toContain('Recorded activity is still being saved');
        renderer.unmount();
    });

    it('finds the recorded tool name after a later observation relabels its node and clears the index on invalidation', async () => {
        const { host, notify } = fixture();
        host.getTracePage.mockResolvedValue({ events: [event({ nodeId: 'turn', nodeKind: 'turn' }),
            event({ seq: 2, nodeId: 'tool', parentId: 'turn', kind: 'tool_end', label: 'B167_LONG_TOOL', status: 'completed' }),
            event({ seq: 3, nodeId: 'tool', parentId: 'turn', kind: 'tool_observation', label: 'tool_observation' })],
            liveEvents: [], through: 3, nextAfter: 3, hasMore: false, run: run('new-run', 200), availability: 'available' });
        const renderer = new PanelRenderer(host); await renderer.settle();
        const bodyReads = host.getContents.mock.calls.length;
        elements(renderer.tree).find(node => node.type === 'input' && node.props['aria-label'])?.props.onChange?.({ target: { value: 'B167_LONG_TOOL' } });
        renderer.render(); await renderer.settle();
        expect(elements(renderer.tree).find(node => node.props.model)?.props.rows?.map(row => row.id)).toEqual(['turn', 'tool']);
        expect(host.getContents).toHaveBeenCalledTimes(bodyReads);
        notify(true); renderer.render(); await renderer.settle();
        expect(elements(renderer.tree).find(node => node.props.model)?.props.model?.nodes.size).toBe(0);
        expect(renderer.snapshot()).not.toContain('B167_LONG_TOOL');
        renderer.unmount();
    });
});
