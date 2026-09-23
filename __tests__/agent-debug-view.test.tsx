import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { EffectCallback, ReactElement, SetStateAction } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentDebugView, type AgentDebugViewHost } from '../src/agent-debug/view';
import { AgentDebugPanel, debugTextPrefix, groupDebugContents, projectDebugNodes } from '../src/agent-debug/components/AgentDebugPanel';
import type { DebugContent, DebugEvent, DebugRun } from '../src/agent-debug/types';

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
    onSelect?: (id: string) => void; nodes?: DebugEvent[]; event?: DebugEvent; contents?: DebugContent[] }>;
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
    constructor(readonly host: AgentDebugViewHost, private readonly element?: unknown) { this.render(); }
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
        this.tree = AgentDebugPanel({ host: this.host, conversationId: 'conversation' });
        this.pending.splice(0).forEach(effect => effect());
    }
    async settle(): Promise<void> {
        for (let index = 0; index < 6; index++) { await Promise.resolve(); await Promise.resolve(); this.render(); }
    }
    snapshot(): string { return JSON.stringify(this.cells); }
    unmount(): void { this.effects.forEach(effect => effect.cleanup?.()); }
}
function event(overrides: Partial<DebugEvent> = {}): DebugEvent {
    return { vaultKey: 'vault', captureId: 'new-run', seq: 1, segment: 0, nodeId: 'call', kind: 'llm', timestamp: 123, contentIds: [], ...overrides };
}
function run(captureId: string, startedAt: number): DebugRun {
    return { vaultKey: 'vault', captureId, conversationId: 'conversation', startedAt, updatedAt: startedAt,
        expiresAt: startedAt + 99999, status: 'running', collection: 'recording', eventCount: 1,
        accountedBytes: 100, lastCommittedSeq: 1, hasGap: false };
}
function fixture() {
    let listener: ((change?: { invalidated?: boolean }) => void) | undefined;
    const unsubscribe = jest.fn();
    const host = {
        enabled: () => true,
        listRuns: jest.fn<AgentDebugViewHost['listRuns']>(async () => [run('new-run', 200), run('older-run', 100)]),
        getEvents: jest.fn<AgentDebugViewHost['getEvents']>(async captureId => [event({ captureId })]),
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
        const historical = elements(renderer.tree).find(node => node.key === 'older-run');
        elements(historical).find(node => node.type === 'button')?.props.onClick?.();
        renderer.render(); await renderer.settle();
        notify(); jest.advanceTimersByTime(100); renderer.render(); await renderer.settle();
        expect(host.getEvents.mock.calls.at(-1)?.[0]).toBe('older-run');
        elements(renderer.tree).find(node => node.type === 'select')?.props.onChange?.({ target: { value: 'failed' } });
        renderer.render(); await renderer.settle();
        expect(host.listRuns).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed', conversationId: 'conversation' }));
        renderer.unmount();
    });

    it('holds the current tail page when selecting a node in a long run', async () => {
        const { host } = fixture();
        host.listRuns.mockResolvedValue([{ ...run('new-run', 200), eventCount: 450, lastCommittedSeq: 450 }]);
        host.getEvents.mockImplementation(async (_id, query) => [event({
            seq: (query.after ?? 0) + 1, nodeId: query.after ? 'late-node' : 'first-node',
        })]);
        const renderer = new PanelRenderer(host);
        await renderer.settle();
        const trace = elements(renderer.tree).find(node => node.props.nodes?.some(item => item.nodeId === 'late-node'));
        expect(trace).toBeDefined();
        trace?.props.onSelect?.('late-node');
        renderer.render(); await renderer.settle();
        expect(host.getEvents).toHaveBeenLastCalledWith('new-run', expect.objectContaining({ after: 250 }));
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
});
