import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { getPluginUiLanguage, makePluginTranslator } from '../../locales/plugin';
import type { AgentDebugViewHost } from '../view';
import type { DebugContent, DebugEvent, DebugRun, DebugRunStatus, DebugSessionDetail, DebugStoreStatus, DebugUsage } from '../types';

const RUN_PAGE = 50;
const EVENT_PAGE = 200;
const TEXT_PAGE = 16_384;
const RUN_STATUSES: DebugRunStatus[] = ['running', 'completed', 'partial', 'failed', 'cancelled', 'interrupted', 'unknown'];
const t = makePluginTranslator(getPluginUiLanguage());
const label = (group: string, value: string) => t(`plugin.agentDebug.${group}.${value}`, undefined, value.replace(/_/g, ' '));
const time = (value: number) => new Date(value).toLocaleString();
const bytes = (value: number) => `${(value / (1024 * 1024)).toFixed(1)} MiB`;
const nodeTitle = (event: DebugEvent) => typeof event.details?.purpose === 'string'
    ? label('purpose', event.details.purpose) : event.label ?? label('phase', event.kind);

/** Repeated node updates retain causal identity, rather than becoming fake new calls. */
export function projectDebugNodes(events: readonly DebugEvent[]): DebugEvent[] {
    const nodes = new Map<string, DebugEvent>();
    for (const event of events) {
        const earlier = nodes.get(event.nodeId);
        // A later result payload need not repeat its already-observed terminal status.
        const defined = Object.fromEntries(Object.entries(event).filter(([, value]) => value !== undefined));
        const node: DebugEvent = earlier ? { ...earlier, ...defined,
            contentIds: [...new Set([...earlier.contentIds, ...event.contentIds])],
            details: { ...earlier.details, ...event.details },
        } : { ...event };
        const dispatch = node.details?.['timing.dispatch'];
        const consumerEnd = node.details?.['timing.consumer_end'];
        if (node.durationMs === undefined && typeof dispatch === 'number' && typeof consumerEnd === 'number'
            && Number.isFinite(dispatch) && Number.isFinite(consumerEnd) && consumerEnd >= dispatch) {
            node.durationMs = consumerEnd - dispatch;
        }
        nodes.set(event.nodeId, node);
    }
    return [...nodes.values()];
}

/** Keep source blocks ordered; joining only the visible prefix avoids copying a long transcript. */
export function groupDebugContents(contents: readonly DebugContent[]): Array<{
    key: string; kind: DebugContent['kind']; parts: string[]; redactions: string[];
}> {
    const groups = new Map<string, { key: string; kind: DebugContent['kind']; parts: string[]; redactions: string[] }>();
    const seen = new Set<string>();
    for (const content of contents) {
        const identity = JSON.stringify([content.captureId, content.contentId]);
        if (seen.has(identity)) continue;
        seen.add(identity);
        const key = JSON.stringify([content.captureId, content.kind]);
        const group = groups.get(key) ?? { key, kind: content.kind, parts: [], redactions: [] };
        group.parts.push(content.text);
        group.redactions = [...new Set([...group.redactions, ...content.redactions])];
        groups.set(key, group);
    }
    return [...groups.values()];
}

export function debugTextPrefix(parts: readonly string[], limit: number, separator = ''): string {
    const visible: string[] = [];
    let remaining = limit;
    for (let index = 0; index < parts.length && remaining > 0; index++) {
        if (index > 0 && separator) { const gap = separator.slice(0, remaining); visible.push(gap); remaining -= gap.length; }
        const part = parts[index].slice(0, remaining);
        visible.push(part); remaining -= part.length;
    }
    return visible.join('');
}

function Usage({ usage }: { usage?: DebugUsage }) {
    if (!usage) return <span>{t('plugin.agentDebug.tokensUnknown')}</span>;
    return <span>{t('plugin.agentDebug.tokens', {
        input: usage.input ?? '—', output: usage.output ?? '—', total: usage.total ?? '—',
    })}{!usage.complete && ` · ${t('plugin.agentDebug.incomplete')}`}
        {usage.cachedInput !== undefined && ` · ${t('plugin.agentDebug.cacheTokens', { count: usage.cachedInput })}`}
        {usage.reasoning !== undefined && ` · ${t('plugin.agentDebug.reasoningTokens', { count: usage.reasoning })}`}</span>;
}

function TextBlock({ text }: { text: string }) {
    return <TextBlocks parts={[text]} />;
}

function TextBlocks({ parts, separator = '' }: { parts: string[]; separator?: string }) {
    const [limit, setLimit] = useState(TEXT_PAGE);
    const length = parts.reduce((total, part) => total + part.length, 0) + Math.max(0, parts.length - 1) * separator.length;
    return <><pre tabIndex={0}>{debugTextPrefix(parts, limit, separator)}</pre>{length > limit
        && <button type="button" onClick={() => setLimit(value => value + TEXT_PAGE)}>{t('plugin.agentDebug.moreText')}</button>}</>;
}

function NodeDetails({ event, contents, session }: { event: DebugEvent; contents: DebugContent[]; session: DebugSessionDetail[] }) {
    const contentGroups = useMemo(() => groupDebugContents(contents), [contents]);
    return <div className="pa-agent-debug-details">
        <h3>{nodeTitle(event)}</h3>
        <dl className="pa-agent-debug-facts">
            <dt>{t('plugin.agentDebug.phase')}</dt><dd>{label('phase', event.kind)}</dd>
            <dt>{t('plugin.agentDebug.result')}</dt><dd>{event.status ? label('status', event.status) : t('plugin.agentDebug.unknown')}</dd>
            <dt>{t('plugin.agentDebug.time')}</dt><dd>{time(event.timestamp)}</dd>
            {event.durationMs !== undefined && <><dt>{t('plugin.agentDebug.duration')}</dt><dd>{Math.round(event.durationMs)} ms</dd></>}
            {(['turnId', 'callId', 'attemptId', 'toolCallId'] as const).map(key => event[key]
                ? <div className="pa-agent-debug-fact-row" key={key}><dt>{label('field', key)}</dt><dd>{event[key]}</dd></div> : null)}
        </dl>
        {(event.usage || event.callId || event.kind === 'llm') && <p><Usage usage={event.usage} /></p>}
        {event.details && Object.keys(event.details).length > 0 && <details open>
            <summary>{t('plugin.agentDebug.parameters')}</summary>
            <dl className="pa-agent-debug-facts">{Object.entries(event.details).map(([key, value]) => <div className="pa-agent-debug-fact-row" key={key}>
                <dt>{label('field', key)}</dt><dd>{key === 'purpose' ? label('purpose', String(value)) : String(value)}</dd>
            </div>)}</dl>
        </details>}
        {event.availability && event.availability !== 'recorded'
            && <p className="pa-agent-debug-notice">{label('availability', event.availability)}</p>}
        {contentGroups.map(group => <details key={group.key} open={group.kind === 'error'}>
            <summary>{label('content', group.kind)}</summary>
            {group.redactions.length > 0 && <p className="pa-agent-debug-notice">{t('plugin.agentDebug.filteredFields')}: {group.redactions.join(', ')}</p>}
            <TextBlocks parts={group.parts} separator={group.kind === 'output' ? '' : '\n\n'} />
        </details>)}
        {session.map((detail, index) => <details key={`${detail.kind}-${index}`}>
            <summary>{label('content', detail.kind)} · {t('plugin.agentDebug.sessionOnly')}</summary>
            <TextBlock text={detail.text} />
        </details>)}
        {contents.length === 0 && session.length === 0 && <p className="pa-agent-debug-muted">{t('plugin.agentDebug.noDetails')}</p>}
        <p className="pa-agent-debug-muted">{t('plugin.agentDebug.reasoningNotice')}</p>
    </div>;
}

function TraceNodes({ nodes, selectedId, onSelect }: { nodes: DebugEvent[]; selectedId?: string; onSelect: (nodeId: string) => void }) {
    const knownIds = new Set(nodes.map(node => node.nodeId));
    const roots = nodes.filter(node => !node.parentId || !knownIds.has(node.parentId) || node.parentId === node.nodeId);
    const visited = new Set<string>();
    const renderNode = (node: DebugEvent, ancestors: Set<string>): JSX.Element => {
        visited.add(node.nodeId);
        const seen = new Set(ancestors).add(node.nodeId);
        const children = nodes.filter(candidate => candidate.parentId === node.nodeId && !seen.has(candidate.nodeId));
        return <li key={node.nodeId}>
            <button type="button" className="pa-agent-debug-node" aria-pressed={selectedId === node.nodeId}
                onClick={() => onSelect(node.nodeId)}>
                <span className="pa-agent-debug-node-title">{nodeTitle(node)}</span>
                <span className="pa-agent-debug-muted">{node.status ? label('status', node.status) : label('phase', node.kind)}
                    {node.durationMs !== undefined && ` · ${Math.round(node.durationMs)} ms`}</span>
            </button>
            {children.length > 0 && <ol className="pa-agent-debug-branches">{children.map(child => renderNode(child, seen))}</ol>}
        </li>;
    };
    // Cyclic or incomplete provider parents never hide an observed event.
    const branches = roots.map(node => renderNode(node, new Set()));
    for (const node of nodes) if (!visited.has(node.nodeId)) branches.push(renderNode(node, new Set()));
    return <ol className="pa-agent-debug-trace">{branches}</ol>;
}

export function AgentDebugPanel({ host, conversationId }: { host: AgentDebugViewHost; conversationId?: string }) {
    const rootRef = useRef<HTMLDivElement>(null);
    const generation = useRef(0);
    const visible = useRef(true);
    const [revision, setRevision] = useState(0);
    const [runs, setRuns] = useState<DebugRun[]>([]);
    const [status, setStatus] = useState<DebugStoreStatus>();
    const [resultFilter, setResultFilter] = useState<DebugRunStatus | ''>('');
    const [currentConversationOnly, setCurrentConversationOnly] = useState(Boolean(conversationId));
    const [before, setBefore] = useState<number>();
    const [moreRuns, setMoreRuns] = useState(false);
    const [captureId, setCaptureId] = useState<string>();
    const [events, setEvents] = useState<DebugEvent[]>([]);
    const [eventAfter, setEventAfter] = useState<number>();
    const [moreEvents, setMoreEvents] = useState(false);
    const [nodeId, setNodeId] = useState<string>();
    const [following, setFollowing] = useState(true);
    const [contents, setContents] = useState<DebugContent[]>([]);
    const [session, setSession] = useState<DebugSessionDetail[]>([]);
    const [detailsKey, setDetailsKey] = useState<string>();
    const [error, setError] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [confirmClear, setConfirmClear] = useState(false);
    const [cleared, setCleared] = useState(false);
    const nodes = useMemo(() => projectDebugNodes(events), [events]);
    const selected = nodes.find(node => node.nodeId === nodeId);
    const selectedRun = runs.find(run => run.captureId === captureId);
    const latestAfter = following && selectedRun
        ? Math.max(0, Math.max(selectedRun.eventCount, selectedRun.lastCommittedSeq) - EVENT_PAGE) : undefined;
    const turnGroups = useMemo(() => {
        const groups = new Map<string, DebugEvent[]>();
        for (const node of nodes) { const key = node.turnId === '__run__' ? '' : node.turnId ?? ''; groups.set(key, [...(groups.get(key) ?? []), node]); }
        return [...groups.entries()];
    }, [nodes]);

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
            // Cross-window fallback checks only the lightweight permission epoch/status.
            // The service emits invalidated when that epoch changes; only then refresh content.
            void host.getStatus().then(next => {
                if (!mounted || !visible.current || epoch !== generation.current) return;
                setStatus(prior => prior && prior.available === next.available
                    && prior.recoveryReady === next.recoveryReady && prior.bytes === next.bytes
                    && prior.limit === next.limit && prior.reason === next.reason ? prior : next);
            }).catch(() => {
                if (mounted && visible.current && epoch === generation.current) setError(true);
            }).finally(() => {
                checkingStatus = false;
                if (mounted && visible.current && statusTimer === undefined) {
                    statusTimer = setTimeout(() => { statusTimer = undefined; checkStatus(); }, 1000);
                }
            });
        };
        const checkVisibility = () => {
            const wasVisible = visible.current;
            visible.current = document?.visibilityState !== 'hidden'
                && (rootRef.current?.getClientRects().length ?? 1) > 0;
            if (!visible.current) {
                if (statusTimer) clearTimeout(statusTimer);
                if (timer) clearTimeout(timer);
                statusTimer = undefined; timer = undefined;
            }
            if (visible.current && dirty) refresh();
            if (visible.current && !wasVisible) checkStatus();
        };
        const onFocus = () => { checkVisibility(); checkStatus(); };
        const unsubscribe = host.subscribe(change => {
            if (change?.invalidated) {
                generation.current++;
                // Privacy invalidation is synchronous, including while the leaf is hidden.
                flushSync(() => { setDetailsKey(undefined); setContents([]); setSession([]); setEvents([]); setRuns([]); });
            }
            refresh();
        });
        document?.addEventListener('visibilitychange', checkVisibility);
        document?.defaultView?.addEventListener('focus', onFocus);
        const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(checkVisibility);
        if (rootRef.current) observer?.observe(rootRef.current);
        checkVisibility();
        checkStatus();
        return () => {
            mounted = false;
            generation.current++;
            unsubscribe(); observer?.disconnect();
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
            if (following) setCaptureId(next[0]?.captureId);
        }).catch(() => { if (!cancelled && epoch === generation.current) setError(true); });
        return () => { cancelled = true; };
    }, [host, revision, before, resultFilter, currentConversationOnly, conversationId, following]);

    useEffect(() => {
        let cancelled = false;
        const epoch = generation.current;
        if (!captureId) { setEvents([]); return; }
        void host.getEvents(captureId, { limit: EVENT_PAGE + 1, after: eventAfter ?? latestAfter }).then(page => {
            if (cancelled || epoch !== generation.current) return;
            const next = page.slice(0, EVENT_PAGE);
            setEvents(next); setMoreEvents(page.length > EVENT_PAGE);
            if (following) setNodeId(next[next.length - 1]?.nodeId);
        }).catch(() => { if (!cancelled && epoch === generation.current) setError(true); });
        return () => { cancelled = true; };
    }, [host, captureId, eventAfter, latestAfter, revision, following]);

    useEffect(() => {
        let cancelled = false;
        const epoch = generation.current;
        // A normal event refresh must not unmount the currently open detail disclosures.
        // A different selection is hidden by detailsKey until its query completes.
        if (detailsKey !== JSON.stringify([captureId, nodeId])) { setContents([]); setSession([]); }
        if (!captureId || !nodeId) return;
        void host.getContents(captureId, nodeId).then(content => {
            if (cancelled || epoch !== generation.current) return;
            setContents(content); setSession(host.getSessionDetails(captureId, nodeId));
            setDetailsKey(JSON.stringify([captureId, nodeId]));
        }).catch(() => { if (!cancelled && epoch === generation.current) setError(true); });
        return () => { cancelled = true; };
    }, [host, captureId, nodeId, revision]);

    const latest = () => { setBefore(undefined); setEventAfter(undefined); setFollowing(true); setRevision(value => value + 1); };
    const clear = async () => {
        generation.current++;
        setClearing(true); setConfirmClear(false); setContents([]); setSession([]); setEvents([]); setRuns([]); setCleared(false);
        try { await host.clearHistory(); setCaptureId(undefined); setNodeId(undefined); setCleared(true); latest(); }
        catch { setError(true); }
        finally { setClearing(false); }
    };
    return <div className="pa-agent-debug-view" ref={rootRef}>
        <header className="pa-agent-debug-header"><h2>{t('plugin.agentDebug.title')}</h2>
            <span>{host.enabled() ? t('plugin.agentDebug.captureOn') : t('plugin.agentDebug.captureOff')}</span></header>
        <p className="pa-agent-debug-muted">{t('plugin.agentDebug.retention')}</p>
        {status && <p className="pa-agent-debug-muted">{t('plugin.agentDebug.storage', { used: bytes(status.bytes), limit: bytes(status.limit) })}
            {!status.recoveryReady && ` · ${t('plugin.agentDebug.recovering')}`}
            {!status.available && ` · ${t('plugin.agentDebug.sessionFallback')}`}</p>}
        {status?.reason === 'recovery_unverified' && status.recoveryReady && runs.length > 0
            && <p className="pa-agent-debug-notice">{t('plugin.agentDebug.availability.recovery_unverified')}</p>}
        <div className="pa-agent-debug-toolbar">
            {conversationId && <label><input type="checkbox" checked={currentConversationOnly} onChange={event => {
                setCurrentConversationOnly(event.target.checked); latest();
            }} />{t('plugin.agentDebug.thisConversation')}</label>}
            <label>{t('plugin.agentDebug.result')} <select value={resultFilter} onChange={event => {
                setResultFilter(event.target.value as DebugRunStatus | ''); latest();
            }}><option value="">{t('plugin.agentDebug.allResults')}</option>{RUN_STATUSES.map(value => <option key={value} value={value}>{label('status', value)}</option>)}</select></label>
            <button type="button" onClick={latest}>{t('plugin.agentDebug.latest')}</button>
            <button type="button" disabled={clearing} onClick={() => setConfirmClear(true)}>{t('plugin.agentDebug.clear')}</button>
        </div>
        {confirmClear && <div className="pa-agent-debug-notice" role="group" aria-label={t('plugin.agentDebug.clear')}>
            <p>{t('plugin.agentDebug.clearConfirm')}</p><button type="button" onClick={() => { void clear(); }}>{t('plugin.agentDebug.clear')}</button>{' '}
            <button type="button" onClick={() => setConfirmClear(false)}>{t('plugin.agentDebug.cancel')}</button>
        </div>}
        {(error || cleared || clearing) && <p role="status" className="pa-agent-debug-notice">{error ? t('plugin.agentDebug.loadFailed') : clearing ? t('plugin.agentDebug.clearing') : t('plugin.agentDebug.cleared')}</p>}
        <section aria-label={t('plugin.agentDebug.runs')}>
            <h3>{t('plugin.agentDebug.runs')}</h3>
            {runs.length === 0 ? <p>{t('plugin.agentDebug.empty')}</p> : <ol className="pa-agent-debug-runs">{runs.map(run => <li key={run.captureId}>
                <button type="button" aria-pressed={captureId === run.captureId} onClick={() => {
                    setFollowing(false); setCaptureId(run.captureId); setEventAfter(undefined); setNodeId(undefined); setEvents([]); setContents([]); setSession([]);
                }}><span>{time(run.startedAt)} · {label('status', run.status)}</span>
                    <span className="pa-agent-debug-muted">{run.model ?? t('plugin.agentDebug.modelUnknown')} · {label('collection', run.collection)}</span></button>
            </li>)}</ol>}
            {moreRuns && <button type="button" onClick={() => {
                setBefore(runs[runs.length - 1]?.startedAt); setFollowing(true); setEventAfter(undefined);
            }}>{t('plugin.agentDebug.olderRuns')}</button>}
        </section>
        {selectedRun && <div className="pa-agent-debug-summary">
            <p>{selectedRun.provider} {selectedRun.model} · <Usage usage={selectedRun.usage} /></p>
            <p>{label('status', selectedRun.status)} · {label('collection', selectedRun.collection)}
                {selectedRun.endedAt !== undefined && ` · ${Math.max(0, selectedRun.endedAt - selectedRun.startedAt)} ms`}</p>
            {selectedRun.hasGap && <p className="pa-agent-debug-notice">{t('plugin.agentDebug.gap')}</p>}
        </div>}
        <details className="pa-agent-debug-section" open><summary>{t('plugin.agentDebug.trajectory')}</summary>
            {turnGroups.length === 0 ? <p>{t('plugin.agentDebug.noEvents')}</p> : turnGroups.map(([turnId, group]) => <div key={turnId}>
                <h4>{turnId ? t('plugin.agentDebug.turn', { id: turnId }) : t('plugin.agentDebug.runStages')}</h4>
                <TraceNodes nodes={group} selectedId={nodeId} onSelect={id => {
                    // Freeze the currently displayed tail window before disabling auto-follow.
                    const cursor = eventAfter ?? latestAfter;
                    setEventAfter(cursor && cursor > 0 ? cursor : undefined);
                    setNodeId(id); setFollowing(false);
                }} />
            </div>)}
            {(eventAfter !== undefined || (latestAfter ?? 0) > 0 || moreEvents) && <div className="pa-agent-debug-toolbar">
                {(eventAfter !== undefined || (latestAfter ?? 0) > 0) && <button type="button" onClick={() => { setFollowing(false); setEventAfter(undefined); }}>{t('plugin.agentDebug.firstEvents')}</button>}
                {moreEvents && <button type="button" onClick={() => { setFollowing(false); setEventAfter(events[events.length - 1]?.seq); setNodeId(undefined); }}>{t('plugin.agentDebug.moreEvents')}</button>}
            </div>}
        </details>
        <details className="pa-agent-debug-section" open><summary>{t('plugin.agentDebug.details')}</summary>
            {selected ? <NodeDetails event={selected}
                contents={detailsKey === JSON.stringify([captureId, nodeId]) ? contents : []}
                session={detailsKey === JSON.stringify([captureId, nodeId]) ? session : []} /> : <p>{t('plugin.agentDebug.selectNode')}</p>}
        </details>
    </div>;
}
