import { act } from 'react';
import { mountSavedInsightList, type SavedInsightListHandle, type SavedInsightListProps } from '../src/pagelet/ui/SavedInsightList';
import { createPageletUiStore } from '../src/pagelet/ui/pagelet-ui-store';
import type { SavedInsight } from '../src/pa/saved-insight-store';

const { JSDOM } = require('jsdom') as {
    JSDOM: new (html: string, options: { url: string; pretendToBeVisual: boolean }) => {
        window: Window & { close(): void };
    };
};

function insight(id: string): SavedInsight {
    return { id, type: 'observation', text: `Complete insight ${id}.`, origin: 'user-authored',
        status: 'active', influencePolicy: 'weak-only', sourceRefs: [{ path: `notes/${id}.md`, evidenceStrength: 'medium' }],
        whyShown: [], scope: { kind: 'current_note', paths: ['notes/current.md'] },
        createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z' };
}

describe('Saved Insights real React list', () => {
    let dom: { window: Window & { close(): void } };
    let port: HTMLElement;
    let host: HTMLElement;
    let props: SavedInsightListProps;
    let handle: SavedInsightListHandle | undefined;
    let prefix: number;
    let hidden: boolean;
    let restoring: boolean;
    const heights = new Map<string, number>();
    const observers: TestResizeObserver[] = [];
    const target = globalThis as unknown as Record<string, unknown>;
    const originals = new Map<string, PropertyDescriptor | undefined>();
    const keys = ['window', 'self', 'document', 'navigator', 'HTMLElement', 'Element', 'Node',
        'Text', 'Comment', 'Event', 'MouseEvent', 'DocumentFragment', 'IS_REACT_ACT_ENVIRONMENT'];

    class TestResizeObserver {
        readonly nodes = new Set<Element>();
        constructor(readonly callback: ResizeObserverCallback) { observers.push(this); }
        observe(node: Element): void { this.nodes.add(node); }
        unobserve(node: Element): void { this.nodes.delete(node); }
        disconnect(): void { this.nodes.clear(); }
        deliver(nodes = [...this.nodes]): void {
            const entries: ResizeObserverEntry[] = nodes.map(node => {
                const contentRect = node.getBoundingClientRect();
                const size = { blockSize: contentRect.height, inlineSize: contentRect.width };
                return { target: node, contentRect, borderBoxSize: [size],
                    contentBoxSize: [size], devicePixelContentBoxSize: [size] };
            });
            this.callback(entries, this as unknown as ResizeObserver);
        }
    }

    function rect(top: number, height: number, width = 480): DOMRect {
        return { top, bottom: top + height, left: 0, right: width, width, height, x: 0, y: top,
            toJSON: () => ({}) };
    }

    function installGeometry(win: Window): void {
        Object.defineProperty(win, 'ResizeObserver', { configurable: true, value: TestResizeObserver });
        const prototype = (win as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement.prototype;
        Object.defineProperty(prototype, 'getBoundingClientRect', { configurable: true, value: function (this: HTMLElement) {
            if (this === port) return rect(20, 240);
            if (hidden) return rect(0, 0, 0);
            const listTop = 20 + 2 + prefix - port.scrollTop;
            if (this === host) return rect(listTop, Number.parseFloat(host.firstElementChild?.getAttribute('style')?.match(/height: ([\d.]+)/)?.[1] ?? '0'));
            if (this.classList.contains('pa-pagelet-saved-insight-list')) {
                return rect(listTop, Number.parseFloat(this.style.height) || 0);
            }
            if (this.dataset.insightId) {
                const offset = Number(this.style.transform.match(/translateY\(([-\d.]+)px\)/)?.[1] ?? 0);
                return rect(listTop + offset, heights.get(this.dataset.insightId) ?? 100);
            }
            return rect(listTop, 100);
        } });
    }

    beforeAll(() => {
        dom = new JSDOM('<!doctype html><html><body></body></html>', {
            url: 'https://localhost/', pretendToBeVisual: true,
        });
        const source = dom.window as unknown as Record<string, unknown>;
        for (const key of keys) {
            originals.set(key, Object.getOwnPropertyDescriptor(target, key));
            Object.defineProperty(target, key, { configurable: true, writable: true,
                value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : source[key] });
        }
        installGeometry(dom.window);
    });

    beforeEach(() => {
        prefix = 280;
        hidden = false;
        restoring = false;
        heights.clear();
        observers.length = 0;
        port = document.createElement('div');
        host = document.createElement('div');
        port.appendChild(document.createElement('section'));
        port.appendChild(host);
        port.appendChild(document.createElement('section'));
        document.body.appendChild(port);
        Object.defineProperties(port, {
            clientWidth: { configurable: true, value: 480 },
            clientHeight: { configurable: true, value: 240 },
            clientTop: { configurable: true, value: 2 },
            scrollHeight: { configurable: true, get: () => prefix
                + (Number.parseFloat((host.firstElementChild as HTMLElement | null)?.style.height ?? '0') || 0) + 400 },
            scrollTo: { configurable: true, value: jest.fn(({ top }: ScrollToOptions) => {
                if (top !== undefined) port.scrollTop = top;
            }) },
        });
        props = { items: Array.from({ length: 40 }, (_, i) => insight(`item-${i}`)), locale: 'en',
            scrollport: port, store: createPageletUiStore(), isRestoring: () => restoring, onLayout: jest.fn() };
    });

    afterEach(async () => {
        await act(async () => handle?.unmount());
        handle = undefined;
        expect(observers.every(observer => observer.nodes.size === 0)).toBe(true);
        port.remove();
        jest.restoreAllMocks();
    });

    afterAll(() => {
        dom.window.close();
        for (const [key, descriptor] of originals) {
            if (descriptor) Object.defineProperty(target, key, descriptor);
            else delete target[key];
        }
    });

    async function mount(): Promise<void> {
        await act(async () => { handle = mountSavedInsightList(host, props); });
    }

    function row(id = 'item-0'): HTMLElement {
        const node = host.querySelector<HTMLElement>(`[data-insight-id="${id}"]`);
        if (!node) throw new Error(`Missing row ${id}`);
        return node;
    }

    async function resize(node: HTMLElement): Promise<void> {
        await act(async () => {
            for (const observer of observers) if (observer.nodes.has(node)) observer.deliver([node]);
        });
    }

    it('keeps complete card content, stable keys and the existing body with sections on both sides', async () => {
        props.items = [insight('item-0'), insight('item-1')];
        await mount();
        const first = row();
        expect(first.textContent).toContain('Complete insight item-0.');
        expect(first.textContent).toContain('notes/item-0.md');
        expect(first.textContent).toContain('Observation');
        expect(first.textContent).toContain('active');
        expect(first.textContent).toContain('user-authored');
        expect(first.textContent).toContain('recall only');
        expect(first.dataset.paReadingId).toBe('saved-insight:item-0');
        const updated = { ...props.items[0], text: 'All updated text remains visible, including the ending.' };
        await act(async () => handle!.update({ ...props, items: [updated, props.items[1]] }));
        expect(row()).toBe(first);
        expect(first.textContent).toContain(updated.text);
        expect(host.previousElementSibling?.tagName).toBe('SECTION');
        expect(host.nextElementSibling?.tagName).toBe('SECTION');
        expect(host.querySelector('[style*="overflow"]')).toBeNull();
    });

    it('remeasures through ResizeObserver, retains positive sizes and DOM while hidden, then publishes the latest rows', async () => {
        await mount();
        const first = row();
        heights.set('item-0', 175);
        await resize(first);
        expect(row('item-1').style.transform).toBe('translateY(175px)');
        await act(async () => {
            port.scrollTop = 888;
            port.dispatchEvent(new Event('scroll'));
        });
        const upperRow = row('item-4');
        await resize(upperRow);
        const anchor = row('item-5');
        const savedTop = port.scrollTop;
        const savedOffset = anchor.getBoundingClientRect().top - port.getBoundingClientRect().top;
        expect(savedTop).toBeGreaterThan(0);
        const size = (host.firstElementChild as HTMLElement).style.height;
        const pendingObserver = observers.find(observer => observer.nodes.has(upperRow))!;
        await act(async () => {
            hidden = true;
            props.store.getState().setViewVisible(false);
        });
        const latestItems = props.items.map(item => item.id === 'item-4'
            ? { ...item, text: 'Latest hidden update' } : item);
        await act(async () => {
            handle!.update({ ...props, items: latestItems });
            pendingObserver.deliver([upperRow]);
        });
        expect(row('item-5')).toBe(anchor);
        expect(upperRow.textContent).not.toContain('Latest hidden update');
        expect((host.firstElementChild as HTMLElement).style.height).toBe(size);
        heights.set('item-4', 600);
        await act(async () => {
            restoring = true;
            props.store.getState().setSavedInsightRestoreTargetId('item-5');
            hidden = false;
            props.store.getState().setViewVisible(true);
        });
        expect(row('item-5')).toBe(anchor);
        expect(upperRow.textContent).toContain('Latest hidden update');
        expect(port.scrollTop).toBe(savedTop);
        expect(props.store.getState().savedInsightRestoreTargetId).toBe('item-5');
        expect(host.querySelector('[data-insight-id="item-0"]')).toBeNull();
        expect(anchor.getBoundingClientRect().top - port.getBoundingClientRect().top).toBe(savedOffset + 500);
        await act(async () => {
            // Only the shared reading owner restores the saved relative offset.
            port.scrollTop = savedTop + 500;
            port.dispatchEvent(new Event('scroll'));
        });
        expect(anchor.getBoundingClientRect().top - port.getBoundingClientRect().top).toBe(savedOffset);
        expect(props.store.getState().savedInsightRestoreTargetId).toBe('item-5');
        await act(async () => { restoring = false; handle!.notifyLayout(); });
        expect(props.store.getState().savedInsightRestoreTargetId).toBeNull();
        // Section overflow can hide the list while its enclosing view stays displayed.
        await act(async () => { hidden = true; handle!.notifyLayout(); });
        await act(async () => pendingObserver.deliver([upperRow]));
        expect(row('item-5')).toBe(anchor);
        await act(async () => { hidden = false; handle!.notifyLayout(); });
        expect(row('item-5')).toBe(anchor);
        expect(row('item-4').getBoundingClientRect().height).toBe(600);
    });

    it('tracks the actual body offset and temporarily renders an offscreen restore anchor without scrolling it', async () => {
        restoring = true;
        props.store.getState().setSavedInsightRestoreTargetId('item-30');
        await mount();
        expect(row('item-30').dataset.paReadingId).toBe('saved-insight:item-30');
        expect(host.querySelectorAll('[data-insight-id]').length).toBeLessThan(props.items.length);
        expect(port.scrollTo).not.toHaveBeenCalled();
        expect(props.onLayout).toHaveBeenCalled();
        expect(row().getBoundingClientRect().top).toBe(302);
        prefix = 440;
        await act(async () => handle!.notifyLayout());
        expect(row().style.transform).toBe('translateY(0px)');
        expect(row().getBoundingClientRect().top).toBe(462);
        const targetTop = row('item-30').getBoundingClientRect().top - 22;
        await act(async () => {
            // This write represents the shared reading owner, not the list.
            port.scrollTop = targetTop;
            port.dispatchEvent(new Event('scroll'));
        });
        expect(props.store.getState().savedInsightRestoreTargetId).toBe('item-30');
        expect(row('item-30')).toBeDefined();
        expect(port.scrollTo).not.toHaveBeenCalled();
        await act(async () => { restoring = false; handle!.notifyLayout(); });
        expect(props.store.getState().savedInsightRestoreTargetId).toBeNull();
        await act(async () => {
            props.store.getState().setSavedInsightRestoreTargetId('item-0');
        });
        expect(row('item-0')).toBeDefined();
        await act(async () => props.store.getState().setSavedInsightRestoreTargetId(null));
        expect(host.querySelector('[data-insight-id="item-0"]')).toBeNull();
    });

    it('rebinds observers to an adopted document and ignores callbacks from the old generation', async () => {
        await mount();
        const oldRow = row();
        const oldObserver = observers.find(observer => observer.nodes.has(oldRow))!;
        const other = new JSDOM('<!doctype html><html><body></body></html>', {
            url: 'https://other.localhost/', pretendToBeVisual: true,
        });
        installGeometry(other.window);
        other.window.document.body.appendChild(other.window.document.adoptNode(port));
        await act(async () => handle!.rebindDocument());
        expect(row().ownerDocument).toBe(other.window.document);
        expect(oldObserver.nodes.size).toBe(0);
        expect(observers.some(observer => observer.nodes.has(port))).toBe(true);
        const layoutCalls = (props.onLayout as jest.Mock).mock.calls.length;
        await act(async () => oldObserver.deliver([oldRow]));
        expect((props.onLayout as jest.Mock).mock.calls.length).toBe(layoutCalls);
        await act(async () => handle!.unmount());
        other.window.close();
    });

    it('retries only the failed list with the same view store and current domain input', async () => {
        const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const broken = insight('item-0');
        Object.defineProperty(broken, 'text', { get: () => { throw new Error('render failure'); } });
        props.items = [broken];
        props.store.getState().setSectionsExpanded(true);
        props.store.getState().setSavedInsightRestoreTargetId('unavailable');
        await mount();
        expect(host.querySelector('[role="status"]')).not.toBeNull();
        expect(errors).toHaveBeenCalled();
        await act(async () => handle!.update({ ...props, items: [insight('item-0')] }));
        await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
        expect(row().textContent).toContain('Complete insight item-0.');
        expect(props.store.getState().sectionsExpanded).toBe(true);
        expect(props.store.getState().savedInsightRestoreTargetId).toBe('unavailable');
        expect(host.querySelector('[role="status"]')).toBeNull();
    });
});
