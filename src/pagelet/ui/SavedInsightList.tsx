import { Component, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { useStore } from 'zustand';
import {
    defaultRangeExtractor, elementScroll, useVirtualizer,
    type Range, type VirtualItem,
} from '@tanstack/react-virtual';
import { pageletT, type PageletLocale } from '../../locales/pagelet';
import type { SavedInsight } from '../../pa/saved-insight-store';
import type { PageletUiStore } from './pagelet-ui-store';

export interface SavedInsightListProps {
    items: readonly SavedInsight[];
    locale: PageletLocale;
    scrollport: HTMLElement;
    store: PageletUiStore;
    isRestoring(): boolean;
    onLayout(): void;
}

export interface SavedInsightListHandle {
    update(props: SavedInsightListProps): void;
    notifyLayout(): void;
    rebindDocument(): void;
    unmount(): void;
}

interface ListLifetime {
    document: Document;
    isCurrent(): boolean;
    hasVisibleLayout(): boolean;
    sizes: Map<string, number>;
}

const ESTIMATED_ROW_HEIGHT = 180;
const suppressAdjustment = () => false;

function SavedInsightList(props: SavedInsightListProps & {
    lifetime: ListLifetime;
    layoutRevision: number;
}): ReactNode {
    const { items, scrollport, store, lifetime, layoutRevision, locale } = props;
    const visible = useStore(store, state => state.viewVisible);
    const active = visible && lifetime.hasVisibleLayout();
    const restoreTargetId = useStore(store, state => state.savedInsightRestoreTargetId);
    const listRef = useRef<HTMLDivElement>(null);
    const latest = useRef(props);
    latest.current = props;
    const [scrollMargin, setScrollMargin] = useState(0);
    const retainedLayout = useRef<{ rows: VirtualItem[]; size: number }>({ rows: [], size: 0 });
    const targetIndex = restoreTargetId === null ? -1 : items.findIndex(item => item.id === restoreTargetId);
    const getItemKey = useCallback((index: number) => items[index].id, [items]);
    const rangeExtractor = useCallback((range: Range) => {
        const indexes = defaultRangeExtractor(range);
        return targetIndex < 0 || indexes.includes(targetIndex)
            ? indexes : [...indexes, targetIndex].sort((a, b) => a - b);
    }, [targetIndex]);
    const canMeasure = () => lifetime.isCurrent()
        && store.getState().viewVisible
        && lifetime.hasVisibleLayout()
        && scrollport.ownerDocument === lifetime.document;

    const virtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
        count: items.length,
        getScrollElement: () => scrollport,
        // Re-enabling clears the library offset; the real body may still be scrolled.
        initialOffset: () => scrollport.scrollTop,
        getItemKey,
        estimateSize: index => lifetime.sizes.get(items[index].id) ?? ESTIMATED_ROW_HEIGHT,
        overscan: 3,
        scrollMargin,
        enabled: active,
        rangeExtractor,
        measureElement: (node, _entry, instance) => {
            // The library calls resizeItem immediately after this public callback.
            // Restore its own predicate outside explicit reading restoration.
            instance.shouldAdjustScrollPositionOnItemSizeChange = latest.current.isRestoring()
                ? suppressAdjustment : undefined;
            const id = node.dataset.insightId!;
            const previous = lifetime.sizes.get(id) ?? ESTIMATED_ROW_HEIGHT;
            if (!canMeasure()) return previous;
            const rect = node.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return previous;
            lifetime.sizes.set(id, rect.height);
            return rect.height;
        },
        scrollToFn: (offset, options, instance) => {
            if (canMeasure() && !latest.current.isRestoring()) elementScroll(offset, options, instance);
        },
    });
    const measuredRows = virtualizer.getVirtualItems();
    // Re-enabling observers has one commit before the real viewport arrives.
    // Keep existing keyed rows through that commit rather than unmounting them.
    const hasRange = active && (items.length === 0 || virtualizer.range !== null);
    const rows = hasRange ? measuredRows : retainedLayout.current.rows.flatMap(row => {
        const index = items.findIndex(item => item.id === row.key);
        return index < 0 ? [] : [{ ...row, index }];
    });
    const size = hasRange ? virtualizer.getTotalSize() : retainedLayout.current.size;
    if (hasRange) retainedLayout.current = { rows, size };

    useLayoutEffect(() => {
        const list = listRef.current;
        if (!list || !canMeasure()) return;
        const rect = scrollport.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || scrollport.clientHeight <= 0) return;
        const offset = list.getBoundingClientRect().top - rect.top - scrollport.clientTop + scrollport.scrollTop;
        setScrollMargin(previous => Math.abs(previous - offset) < 0.5 ? previous : offset);
        for (const row of Array.from(list.querySelectorAll<HTMLDivElement>('[data-insight-id]'))) {
            virtualizer.measureElement(row);
        }
    }, [active, layoutRevision, items, scrollport, lifetime, virtualizer]);

    useLayoutEffect(() => {
        if (!canMeasure()) return;
        latest.current.onLayout();
        const range = virtualizer.range;
        if (restoreTargetId !== null && !latest.current.isRestoring() && range
            && defaultRangeExtractor({ ...range, count: items.length,
                overscan: virtualizer.options.overscan, lanes: virtualizer.options.lanes }).includes(targetIndex)
            && store.getState().savedInsightRestoreTargetId === restoreTargetId) {
            store.getState().setSavedInsightRestoreTargetId(null);
        }
    });

    useLayoutEffect(() => {
        const ids = new Set(items.map(item => item.id));
        for (const id of lifetime.sizes.keys()) {
            if (!ids.has(id)) lifetime.sizes.delete(id);
        }
    }, [items, lifetime]);

    return <div className="pa-pagelet-saved-insight-list" ref={listRef} style={{ height: size }}>
        {rows.map(row => {
            const insight = items[row.index];
            return <div key={row.key} ref={virtualizer.measureElement}
                className="pa-pagelet-saved-insight-row" data-index={row.index}
                data-insight-id={insight.id} data-pa-reading-id={`saved-insight:${insight.id}`}
                style={{ transform: `translateY(${row.start - scrollMargin}px)` }}>
                <div className="pa-pagelet-tab-insight-card pa-pagelet-tab-saved-insight-card">
                    <h4>{pageletT(`pagelet.tab.savedInsights.type.${insight.type}`, locale)}</h4>
                    <p>{insight.text}</p>
                    <div className="pa-pagelet-tab-tag-row">
                        <span className="pa-pagelet-tab-tag-chip">{pageletT(`pagelet.tab.savedInsights.status.${insight.status}`, locale)}</span>
                        <span className="pa-pagelet-tab-tag-chip">{pageletT(`pagelet.tab.savedInsights.origin.${insight.origin}`, locale)}</span>
                        <span className="pa-pagelet-tab-tag-chip">{pageletT('pagelet.tab.savedInsights.influence.weakOnly', locale)}</span>
                        {insight.sourceRefs[0]?.path && <span className="pa-pagelet-tab-tag-chip">{insight.sourceRefs[0].path}</span>}
                    </div>
                </div>
            </div>;
        })}
    </div>;
}

class SavedInsightErrorBoundary extends Component<{ locale: PageletLocale; children: ReactNode }, { failed: boolean }> {
    state = { failed: false };

    static getDerivedStateFromError(): { failed: boolean } {
        return { failed: true };
    }

    render(): ReactNode {
        if (!this.state.failed) return this.props.children;
        return <div className="pa-pagelet-saved-insight-error" role="status">
            <p>{pageletT('pagelet.ui.renderFailed', this.props.locale)}</p>
            <button type="button" onClick={() => this.setState({ failed: false })}>
                {pageletT('pagelet.ui.retry', this.props.locale)}
            </button>
        </div>;
    }
}

export function mountSavedInsightList(container: HTMLElement, initialProps: SavedInsightListProps): SavedInsightListHandle {
    const root = createRoot(container);
    let mounted = true;
    let latestProps = initialProps;
    let displayedProps = initialProps;
    let ownerDocument = container.ownerDocument;
    let documentGeneration = 0;
    let layoutRevision = 0;
    const sizes = new Map<string, number>();
    const hasVisibleLayout = () => {
        const port = latestProps.scrollport;
        const rect = port.getBoundingClientRect();
        return container.isConnected && container.getBoundingClientRect().width > 0
            && rect.width > 0 && rect.height > 0 && port.clientHeight > 0;
    };
    const createLifetime = (): ListLifetime => {
        const generation = documentGeneration;
        return { document: ownerDocument, sizes, hasVisibleLayout,
            isCurrent: () => mounted && generation === documentGeneration };
    };
    let lifetime = createLifetime();
    const render = () => {
        if (!mounted) return;
        if (latestProps.store.getState().viewVisible && hasVisibleLayout()) displayedProps = latestProps;
        root.render(<SavedInsightErrorBoundary locale={displayedProps.locale}>
            <SavedInsightList key={documentGeneration} {...displayedProps}
                lifetime={lifetime} layoutRevision={layoutRevision} />
        </SavedInsightErrorBoundary>);
    };
    const unsubscribe = initialProps.store.subscribe((state, previous) => {
        if (state.viewVisible !== previous.viewVisible) render();
    });
    render();
    return {
        update(props) {
            latestProps = props;
            if (props.store.getState().viewVisible) render();
        },
        notifyLayout() {
            layoutRevision += 1;
            if (latestProps.store.getState().viewVisible) render();
        },
        rebindDocument() {
            if (!mounted) return;
            if (ownerDocument !== container.ownerDocument) {
                ownerDocument = container.ownerDocument;
                documentGeneration += 1;
                lifetime = createLifetime();
            }
            layoutRevision += 1;
            render();
        },
        unmount() {
            if (!mounted) return;
            mounted = false;
            unsubscribe();
            root.unmount();
            sizes.clear();
        },
    };
}
