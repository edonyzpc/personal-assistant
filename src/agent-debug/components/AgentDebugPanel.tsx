import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { AgentDebugViewHost } from '../view';
import type { DebugContent, DebugRun, DebugRunStatus, DebugSessionDetail, DebugStoreStatus } from '../types';
import { buildTraceModel, focusNode, traceAncestors, visibleTraceRows } from '../trace-model';
import { NodeInspector, DebugUsageText } from './NodeInspector';
import { TraceTree } from './TraceTree';
import { DebugDialog } from './DebugDialog';
import { useTracePages } from './useTracePages';
import { debugLabel as label, debugT as t, debugTime as time, nodeTitle } from './debug-format';

export { projectDebugNodes } from '../trace-model';
export { groupDebugContents, debugTextPrefix } from './NodeInspector';
const RUN_PAGE = 50;
const RUN_STATUSES: DebugRunStatus[] = ['running', 'completed', 'partial', 'failed', 'cancelled', 'interrupted', 'unknown'];
const bytes = (value: number) => `${(value / (1024 * 1024)).toFixed(1)} MiB`;

export function AgentDebugPanel({ host, conversationId }: { host: AgentDebugViewHost; conversationId?: string }) {
    const rootRef = useRef<HTMLDivElement>(null);
    const traceScroll = useRef<HTMLDivElement>(null);
    const inspectorScroll = useRef<HTMLDivElement>(null);
    const generation = useRef(0);
    const visible = useRef(true);
    const returnAnchor = useRef({ top: 0, nodeId: undefined as string | undefined, changed: false });
    const priorPage = useRef({ narrow: false, detailPage: false });
    const pendingLocation = useRef<string>();
    const [revision, setRevision] = useState(0);
    const [runs, setRuns] = useState<DebugRun[]>([]);
    const [status, setStatus] = useState<DebugStoreStatus>();
    const [resultFilter, setResultFilter] = useState<DebugRunStatus | ''>('');
    const [currentConversationOnly, setCurrentConversationOnly] = useState(Boolean(conversationId));
    const [before, setBefore] = useState<number>();
    const [moreRuns, setMoreRuns] = useState(false);
    const [captureId, setCaptureId] = useState<string>();
    const [nodeId, setNodeId] = useState<string>();
    const [following, setFollowing] = useState(true);
    const [query, setQuery] = useState('');
    const [overrides, setOverrides] = useState(new Map<string, boolean>());
    const [contents, setContents] = useState<DebugContent[]>([]);
    const [session, setSession] = useState<DebugSessionDetail[]>([]);
    const [detailsKey, setDetailsKey] = useState<string>();
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [detailsFailed, setDetailsFailed] = useState(false);
    const [detailRevision, setDetailRevision] = useState(0);
    const [error, setError] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [confirmClear, setConfirmClear] = useState(false);
    const [cleared, setCleared] = useState(false);
    const [narrow, setNarrow] = useState(false);
    const [detailPage, setDetailPage] = useState(false);
    const [navigation, setNavigation] = useState<string[]>([]);
    const [modal, setModal] = useState<'history' | 'turns'>();
    const [historyOpen, setHistoryOpen] = useState(false);
    const [split, setSplit] = useState(54);
    const { load, invalidate } = useTracePages(host, captureId, revision, generation, visible);
    const model = useMemo(() => buildTraceModel(load.events), [load.events]);
    const selected = nodeId ? model.nodes.get(nodeId) : undefined;
    const selectedRun = load.run ?? runs.find(run => run.captureId === captureId);
    const view = useMemo(() => visibleTraceRows(model, nodeId, overrides, query, nodeTitle), [model, nodeId, overrides, query]);
    const navigationIds = navigation.filter(id => model.nodes.has(id));
    const navigationIndex = nodeId ? navigationIds.indexOf(nodeId) : -1;
    const turns = useMemo(() => {
        const entries = new Map<string, { id: string; name: string }>();
        for (const id of model.ordered) {
            const event = model.nodes.get(id)!.event;
            const isTurn = event.nodeKind === 'turn' || event.kind === 'turn' || /^turn_(start|end)$/.test(event.kind);
            const turnId = event.turnId && event.turnId !== '__run__' ? event.turnId : isTurn ? id : undefined;
            if (!turnId) continue;
            if (!entries.has(turnId) || isTurn) entries.set(turnId, { id, name: t('plugin.agentDebug.turn', { id: turnId }) });
        }
        return [...entries.values()];
    }, [model]);
    const resetReading = () => {
        setNodeId(undefined); setQuery(''); setOverrides(new Map()); setDetailsKey(undefined);
        setContents([]); setSession([]); setNavigation([]); setDetailPage(false); setModal(undefined);
        returnAnchor.current = { top: 0, nodeId: undefined, changed: false };
        pendingLocation.current = undefined;
    };
    const invalidateViewer = () => { invalidate(); resetReading(); setRuns([]); };
    const pause = () => setFollowing(false);
    const locate = (id?: string) => {
        const row = Array.from(traceScroll.current?.querySelectorAll<HTMLElement>('[data-node-id]') ?? [])
            .find(element => element.dataset.nodeId === id);
        row?.scrollIntoView({ block: 'nearest' });
    };
    const select = (id: string) => {
        pause(); setNodeId(id);
        if (narrow) {
            returnAnchor.current = { top: traceScroll.current?.scrollTop ?? 0, nodeId: id, changed: false };
            setNavigation(view.rows.map(row => row.id)); setDetailPage(true);
        }
    };
    const jump = (id: string) => {
        pause(); setQuery(''); setNodeId(id); setModal(undefined);
        setOverrides(previous => {
            const next = new Map(previous);
            for (const ancestor of traceAncestors(model, id)) next.set(ancestor, true);
            return next;
        });
        setDetailPage(false); returnAnchor.current = { top: 0, nodeId: id, changed: true };
        pendingLocation.current = id;
    };

    useEffect(() => {
        const element = rootRef.current;
        const resize = () => { if (element) setNarrow(element.clientWidth < 760); };
        const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize);
        if (element) { observer?.observe(element); resize(); }
        return () => observer?.disconnect();
    }, []);

    useEffect(() => {
        if (!selectedRun) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const expire = () => {
            const remaining = selectedRun.expiresAt - Date.now();
            if (remaining > 0) {
                // Retention can exceed the native timer's signed 32-bit delay.
                timer = setTimeout(expire, Math.min(remaining, 2_147_483_647));
                return;
            }
            generation.current++;
            flushSync(invalidateViewer);
        };
        expire();
        return () => { if (timer !== undefined) clearTimeout(timer); };
    }, [captureId, selectedRun?.expiresAt]);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let statusTimer: ReturnType<typeof setTimeout> | undefined;
        let checkingStatus = false;
        let mounted = true;
        let dirty = false;
        const refresh = () => {
            dirty = true;
            if (!visible.current || timer) return;
            timer = setTimeout(() => { timer = undefined; dirty = false; setRevision(value => value + 1); }, 100);
        };
        const document = rootRef.current?.ownerDocument;
        const checkStatus = () => {
            if (!mounted || !visible.current || checkingStatus) return;
            checkingStatus = true;
            const epoch = generation.current;
            void host.getStatus().then(next => {
                if (!mounted || !visible.current || epoch !== generation.current) return;
                setStatus(prior => prior && prior.available === next.available && prior.recoveryReady === next.recoveryReady
                    && prior.bytes === next.bytes && prior.limit === next.limit && prior.reason === next.reason ? prior : next);
            }).catch(() => { if (mounted && visible.current && epoch === generation.current) setError(true); }).finally(() => {
                checkingStatus = false;
                if (mounted && visible.current && statusTimer === undefined) statusTimer = setTimeout(() => { statusTimer = undefined; checkStatus(); }, 1000);
            });
        };
        const checkVisibility = () => {
            const wasVisible = visible.current;
            visible.current = document?.visibilityState !== 'hidden' && (rootRef.current?.getClientRects().length ?? 1) > 0;
            if (!visible.current) {
                if (statusTimer) clearTimeout(statusTimer);
                if (timer) clearTimeout(timer);
                statusTimer = undefined; timer = undefined;
            }
            if (visible.current && (dirty || !wasVisible)) refresh();
            if (visible.current && !wasVisible) checkStatus();
        };
        const onFocus = () => { checkVisibility(); checkStatus(); };
        const unsubscribe = host.subscribe(change => {
            if (change?.invalidated) {
                generation.current++;
                // Privacy invalidation removes metadata and reading snapshots even in hidden leaves.
                flushSync(invalidateViewer);
            }
            refresh();
        });
        document?.addEventListener('visibilitychange', checkVisibility);
        document?.defaultView?.addEventListener('focus', onFocus);
        const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(checkVisibility);
        if (rootRef.current) observer?.observe(rootRef.current);
        checkVisibility(); checkStatus();
        return () => {
            mounted = false; generation.current++; unsubscribe(); observer?.disconnect();
            document?.removeEventListener('visibilitychange', checkVisibility);
            document?.defaultView?.removeEventListener('focus', onFocus);
            if (timer) clearTimeout(timer);
            if (statusTimer) clearTimeout(statusTimer);
        };
    }, [host]);

    useEffect(() => {
        let cancelled = false;
        const epoch = generation.current;
        void Promise.all([host.listRuns({ limit: RUN_PAGE + 1, before,
            conversationId: currentConversationOnly ? conversationId : undefined,
            status: resultFilter || undefined }), host.getStatus()]).then(([page, storage]) => {
            if (cancelled || epoch !== generation.current) return;
            const next = page.slice(0, RUN_PAGE);
            setRuns(next); setStatus(storage); setMoreRuns(page.length > RUN_PAGE); setError(false);
            if (following && next[0]?.captureId !== captureId) { resetReading(); setCaptureId(next[0]?.captureId); }
        }).catch(() => { if (!cancelled && epoch === generation.current) setError(true); });
        return () => { cancelled = true; };
    }, [host, revision, before, resultFilter, currentConversationOnly, conversationId, following, captureId]);

    useEffect(() => {
        if ((!following && nodeId) || query || detailPage) return;
        const latest = focusNode(model);
        if (latest) setNodeId(latest);
    }, [model, following, query, detailPage, nodeId]);
    useEffect(() => { if (following && !detailPage) locate(nodeId); }, [nodeId, load.events, following, detailPage]);
    useEffect(() => {
        const returning = priorPage.current.narrow && priorPage.current.detailPage && (!narrow || !detailPage);
        priorPage.current = { narrow, detailPage };
        if (returning) {
            if (returnAnchor.current.changed) locate(nodeId ?? returnAnchor.current.nodeId);
            else if (traceScroll.current) traceScroll.current.scrollTop = returnAnchor.current.top;
        }
        if (pendingLocation.current && (!narrow || !detailPage)) {
            locate(pendingLocation.current); pendingLocation.current = undefined;
        }
    }, [detailPage, narrow, nodeId, view.rows]);

    useEffect(() => {
        let cancelled = false;
        const epoch = generation.current;
        const key = JSON.stringify([captureId, nodeId]);
        if (detailsKey !== key) { setContents([]); setSession([]); }
        if (!captureId || !nodeId || !selected) { setDetailsLoading(false); return; }
        setDetailsLoading(true); setDetailsFailed(false);
        void host.getContents(captureId, nodeId).then(content => {
            if (cancelled || epoch !== generation.current) return;
            setContents(content); setSession(host.getSessionDetails(captureId, nodeId)); setDetailsKey(key); setDetailsLoading(false);
        }).catch(() => { if (!cancelled && epoch === generation.current) { setDetailsLoading(false); setDetailsFailed(true); } });
        return () => { cancelled = true; };
    }, [host, captureId, nodeId, revision, detailRevision]);

    const latest = () => {
        const target = focusNode(model);
        setOverrides(previous => {
            const next = new Map(previous);
            for (const ancestor of traceAncestors(model, target)) next.set(ancestor, true);
            return next;
        });
        pendingLocation.current = target;
        setBefore(undefined); setQuery(''); setFollowing(true); setDetailPage(false); setRevision(value => value + 1);
    };
    const clear = async () => {
        generation.current++; setClearing(true); setConfirmClear(false); setCleared(false); invalidateViewer();
        try { await host.clearHistory(); setCaptureId(undefined); setCleared(true); latest(); }
        catch { setError(true); }
        finally { setClearing(false); }
    };
    const history = <>
        <div className="pa-agent-debug-toolbar">
            {conversationId && <label><input type="checkbox" checked={currentConversationOnly} onChange={event => {
                setCurrentConversationOnly(event.target.checked); latest();
            }} />{t('plugin.agentDebug.thisConversation')}</label>}
            <label>{t('plugin.agentDebug.result')} <select value={resultFilter} onChange={event => {
                setResultFilter(event.target.value as DebugRunStatus | ''); latest();
            }}><option value="">{t('plugin.agentDebug.allResults')}</option>{RUN_STATUSES.map(value => <option key={value} value={value}>{label('status', value)}</option>)}</select></label>
        </div>
        {runs.length === 0 ? <p>{t('plugin.agentDebug.empty')}</p> : <ol className="pa-agent-debug-runs">{runs.map(run => <li key={run.captureId}>
            <button type="button" aria-pressed={captureId === run.captureId} onClick={() => { pause(); resetReading(); setCaptureId(run.captureId); }}>
                <span>{time(run.startedAt)} · {label('status', run.status)}</span>
                <span className="pa-agent-debug-muted">{run.model ?? t('plugin.agentDebug.modelUnknown')} · {label('collection', run.collection)}</span>
            </button>
        </li>)}</ol>}
        {moreRuns && <button type="button" onClick={() => { pause(); setBefore(runs[runs.length - 1]?.startedAt); }}>{t('plugin.agentDebug.olderRuns')}</button>}
    </>;
    const detailContents = selected && detailsKey === JSON.stringify([captureId, nodeId])
        ? contents.map(content => ({ ...content, contentRole: content.contentRole ?? selected.contentRoles.get(content.contentId) })) : [];
    return <div className={`pa-agent-debug-view${narrow ? ' is-narrow' : ''}${narrow && detailPage ? ' is-detail-page' : ''}`} ref={rootRef}>
        <div className="pa-agent-debug-content">
            <header className="pa-agent-debug-header"><h2>{t('plugin.agentDebug.title')}</h2>
                <span>{host.enabled() ? t('plugin.agentDebug.captureOn') : t('plugin.agentDebug.captureOff')}</span>
                <button type="button" onClick={() => { pause(); if (narrow) setModal('history'); else setHistoryOpen(value => !value); }} aria-expanded={!narrow && historyOpen}>{t('plugin.agentDebug.runs')}</button>
                <button type="button" disabled={clearing} onClick={() => setConfirmClear(true)}>{t('plugin.agentDebug.clear')}</button>
            </header>
            <details className="pa-agent-debug-storage"><summary>{t('plugin.agentDebug.retention')}</summary>
                {status && <p>{t('plugin.agentDebug.storage', { used: bytes(status.bytes), limit: bytes(status.limit) })}{!status.recoveryReady && ` · ${t('plugin.agentDebug.recovering')}`}{!status.available && ` · ${t('plugin.agentDebug.sessionFallback')}`}</p>}
            </details>
            {historyOpen && !narrow && <section className="pa-agent-debug-history" aria-label={t('plugin.agentDebug.runs')}>{history}</section>}
            {confirmClear && <div className="pa-agent-debug-notice" role="group" aria-label={t('plugin.agentDebug.clear')}>
                <p>{t('plugin.agentDebug.clearConfirm')}</p><button type="button" onClick={() => { void clear(); }}>{t('plugin.agentDebug.clear')}</button>{' '}
                <button type="button" onClick={() => setConfirmClear(false)}>{t('plugin.agentDebug.cancel')}</button>
            </div>}
            {(error || cleared || clearing) && <p role="status" className="pa-agent-debug-notice">{error ? t('plugin.agentDebug.loadFailed') : clearing ? t('plugin.agentDebug.clearing') : t('plugin.agentDebug.cleared')}</p>}
            {selectedRun && <div className="pa-agent-debug-summary">
                <span>{label('status', selectedRun.status)} · {label('collection', selectedRun.collection)} · {selectedRun.provider} {selectedRun.model}</span>
                <span><DebugUsageText usage={selectedRun.usage} /></span>
                {selectedRun.hasGap && <p className="pa-agent-debug-notice">{t('plugin.agentDebug.gap')}</p>}
                {selectedRun.contentVersion !== 2 && <p className="pa-agent-debug-muted">{t('plugin.agentDebug.legacyDetails')}</p>}
            </div>}
            <div className="pa-agent-debug-workspace" style={{ gridTemplateColumns: narrow ? undefined : `${split}% 8px minmax(0, 1fr)` }}>
                <section className="pa-agent-debug-track-pane" aria-label={t('plugin.agentDebug.trajectory')} hidden={narrow && detailPage}>
                    <div className="pa-agent-debug-trace-tools">
                        <input type="search" value={query} aria-label={t('plugin.agentDebug.search')} placeholder={t('plugin.agentDebug.search')} onChange={event => { pause(); setQuery(event.target.value); }} />
                        <button type="button" onClick={() => { pause(); setOverrides(new Map(model.ordered.map(id => [id, true]))); }}>{t('plugin.agentDebug.expandAll')}</button>
                        <button type="button" onClick={() => { pause(); setOverrides(new Map()); }}>{t('plugin.agentDebug.focusPath')}</button>
                    </div>
                    <div className="pa-agent-debug-load-state" role="status">
                        {load.state === 'loading' && t('plugin.agentDebug.traceLoading')}
                        {load.state === 'saving' && t('plugin.agentDebug.traceSaving')}
                        {load.state === 'ready' && t('plugin.agentDebug.traceReady', { count: model.nodes.size })}
                        {load.state === 'partial' && t('plugin.agentDebug.tracePartial')}
                        {load.state === 'cleared' && t('plugin.agentDebug.availability.cleared')}
                        {load.state === 'error' && <><span>{t('plugin.agentDebug.traceFailed')}</span><button type="button" onClick={() => setRevision(value => value + 1)}>{t('plugin.agentDebug.retryRead')}</button></>}
                        {query.trim() && <span>{view.matches > 0 ? t('plugin.agentDebug.searchMatches', { count: view.matches }) : t('plugin.agentDebug.noMatches')}{(load.state === 'loading' || load.state === 'saving') && ` · ${t('plugin.agentDebug.searchIncomplete')}`}</span>}
                    </div>
                    {model.nodes.size === 0 && load.state === 'ready' && <p>{captureId ? t('plugin.agentDebug.noEvents') : t('plugin.agentDebug.empty')}</p>}
                    <TraceTree model={model} rows={view.rows} selectedId={nodeId} onSelect={select} scrollRef={traceScroll} onBrowse={pause}
                        onToggle={(id, expanded) => { pause(); setOverrides(previous => new Map(previous).set(id, expanded)); }} />
                    <footer className="pa-agent-debug-bottom-bar">
                        <button type="button" onClick={() => { pause(); setModal('turns'); }}>{t('plugin.agentDebug.turns')}</button>
                        <button type="button" onClick={latest} aria-pressed={following}>{t('plugin.agentDebug.followLatest')}</button>
                        <span>{following ? t('plugin.agentDebug.following') : t('plugin.agentDebug.followPaused')}</span>
                    </footer>
                </section>
                {!narrow && <div className="pa-agent-debug-splitter" role="separator" aria-label={t('plugin.agentDebug.resizePanels')}
                    aria-orientation="vertical" aria-valuemin={35} aria-valuemax={65} aria-valuenow={split} tabIndex={0}
                    onKeyDown={event => {
                        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setSplit(value => Math.max(35, Math.min(65, value + (event.key === 'ArrowRight' ? 2 : -2)))); }
                    }} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); }}
                    onPointerMove={event => {
                        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                        const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
                        setSplit(Math.max(35, Math.min(65, (event.clientX - bounds.left) / bounds.width * 100)));
                    }} onPointerUp={event => { event.currentTarget.releasePointerCapture(event.pointerId); }} />}
                <section className="pa-agent-debug-inspector-pane" aria-label={t('plugin.agentDebug.details')} hidden={narrow && !detailPage}>
                    {narrow && <header className="pa-agent-debug-detail-header"><button type="button" onClick={() => setDetailPage(false)}>{t('plugin.agentDebug.backToTrace')}</button><span>{selected ? nodeTitle(selected.event) : t('plugin.agentDebug.details')}</span></header>}
                    <div className="pa-agent-debug-inspector-scroll" ref={inspectorScroll} onWheel={pause} onTouchStart={pause}
                        onKeyDown={event => { if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) pause(); }} onClick={pause}>
                        {selected ? <NodeInspector key={JSON.stringify([captureId, nodeId])} event={selected.event} durationMs={selected.durationMs}
                            contents={detailContents} session={detailsKey === JSON.stringify([captureId, nodeId]) ? session : []}
                            loading={detailsLoading} failed={detailsFailed} onRetry={() => setDetailRevision(value => value + 1)} /> : <p>{t('plugin.agentDebug.selectNode')}</p>}
                    </div>
                    {narrow && <footer className="pa-agent-debug-bottom-bar">
                        <button type="button" disabled={navigationIndex <= 0} onClick={() => { pause(); returnAnchor.current.changed = true; setNodeId(navigationIds[navigationIndex - 1]); }}>{t('plugin.agentDebug.previousNode')}</button>
                        <span>{Math.max(0, navigationIndex + 1)} / {navigationIds.length}</span>
                        <button type="button" disabled={navigationIndex < 0 || navigationIndex >= navigationIds.length - 1} onClick={() => { pause(); returnAnchor.current.changed = true; setNodeId(navigationIds[navigationIndex + 1]); }}>{t('plugin.agentDebug.nextNode')}</button>
                    </footer>}
                </section>
            </div>
        </div>
        {modal && <DebugDialog title={t(modal === 'history' ? 'plugin.agentDebug.runs' : 'plugin.agentDebug.turns')} onClose={() => setModal(undefined)}>
            {modal === 'history' ? history : <ol className="pa-agent-debug-runs">{turns.map(turn => <li key={turn.id}><button type="button" onClick={() => jump(turn.id)}>
                {query.trim() ? t('plugin.agentDebug.clearSearchView', { name: turn.name }) : turn.name}
            </button></li>)}</ol>}
        </DebugDialog>}
    </div>;
}
