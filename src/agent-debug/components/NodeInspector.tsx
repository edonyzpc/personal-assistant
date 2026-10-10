import { useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { DebugContent, DebugEvent, DebugSessionDetail, DebugUsage } from '../types';
import { DebugIcon } from './DebugIcon';
import { debugDuration, debugLabel as label, debugNodeIcon, debugStatusClass, debugT as t, debugTime as time, nodeTitle } from './debug-format';

const TEXT_PAGE = 16_384;
export function groupDebugContents(contents: readonly DebugContent[]): Array<{
    key: string; kind: DebugContent['kind']; role?: DebugContent['contentRole']; parts: string[]; redactions: string[];
}> {
    const groups = new Map<string, { key: string; kind: DebugContent['kind']; role?: DebugContent['contentRole']; parts: string[]; redactions: string[] }>();
    const seen = new Set<string>();
    for (const content of contents) {
        const identity = JSON.stringify([content.captureId, content.contentId]);
        if (seen.has(identity)) continue;
        seen.add(identity);
        const key = JSON.stringify([content.captureId, content.kind, content.contentRole]);
        const group = groups.get(key) ?? { key, kind: content.kind, role: content.contentRole, parts: [], redactions: [] };
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

export function DebugUsageText({ usage }: { usage?: DebugUsage }) {
    if (!usage) return <span>{t('plugin.agentDebug.tokensUnknown')}</span>;
    return <span>{t('plugin.agentDebug.tokens', {
        input: usage.input ?? '—', output: usage.output ?? '—', total: usage.total ?? '—',
    })}{!usage.complete && ` · ${t('plugin.agentDebug.incomplete')}`}
        {usage.cachedInput !== undefined && ` · ${t('plugin.agentDebug.cacheTokens', { count: usage.cachedInput })}`}
        {usage.reasoning !== undefined && ` · ${t('plugin.agentDebug.reasoningTokens', { count: usage.reasoning })}`}</span>;
}

function TextBlocks({ parts }: { parts: string[] }) {
    const [limit, setLimit] = useState(TEXT_PAGE);
    const length = parts.reduce((total, part) => total + part.length, 0);
    return <><pre className="pa-agent-debug-code" tabIndex={0}>{debugTextPrefix(parts, limit)}</pre>{length > limit
        && <button type="button" onClick={() => setLimit(value => value + TEXT_PAGE)}>{t('plugin.agentDebug.moreText')}</button>}</>;
}

const DETAIL_TABS = ['io', 'timing', 'raw'] as const;
type DetailTab = typeof DETAIL_TABS[number];
const TAB_LABELS: Record<DetailTab, string> = { io: 'tabIO', timing: 'tabTiming', raw: 'tabRaw' };
const CONTENT_ORDER: DebugContent['kind'][] = ['error', 'prompt', 'input', 'tool_input', 'output', 'tool_output', 'attachment', 'context', 'reasoning'];

export function NodeInspector({ event, contents, session, loading, failed, durationMs, startMs, endMs, ancestorTitles = [], onRetry, onTabChange }: {
    event: DebugEvent; contents: DebugContent[]; session: DebugSessionDetail[]; loading: boolean; failed: boolean;
    durationMs?: number; startMs?: number; endMs?: number; ancestorTitles?: string[]; onRetry: () => void; onTabChange?: () => void;
}) {
    const groups = useMemo(() => groupDebugContents(contents).sort((left, right) =>
        CONTENT_ORDER.indexOf(left.kind) - CONTENT_ORDER.indexOf(right.kind)), [contents]);
    const [tab, setTab] = useState<DetailTab>('io');
    const tabId = useId();
    const tabButtons = useRef<Array<HTMLButtonElement | null>>([]);
    const nodeType = event.nodeKind ? label('nodeKind', event.nodeKind) : t('plugin.agentDebug.legacyType');
    const timing = Object.entries(event.details ?? {}).filter(([key]) => key.startsWith('timing.'));
    const parameters = Object.entries(event.details ?? {}).filter(([key]) => !key.startsWith('timing.'));

    const selectTab = (next: DetailTab) => {
        if (next === tab) return;
        setTab(next);
        onTabChange?.();
    };
    const onTabKeyDown = (keyboardEvent: KeyboardEvent<HTMLButtonElement>, index: number) => {
        let next: number;
        if (keyboardEvent.key === 'ArrowRight') next = (index + 1) % DETAIL_TABS.length;
        else if (keyboardEvent.key === 'ArrowLeft') next = (index + DETAIL_TABS.length - 1) % DETAIL_TABS.length;
        else if (keyboardEvent.key === 'Home') next = 0;
        else if (keyboardEvent.key === 'End') next = DETAIL_TABS.length - 1;
        else return;
        keyboardEvent.preventDefault();
        selectTab(DETAIL_TABS[next]);
        tabButtons.current[next]?.focus();
    };

    return <div className="pa-agent-debug-details">
        <header className="pa-agent-debug-detail-hero">
            {ancestorTitles.length > 0 && <div className="pa-agent-debug-breadcrumb" title={ancestorTitles.join(' / ')}>{ancestorTitles.join(' / ')}</div>}
            <h3 className="pa-agent-debug-detail-title"><DebugIcon name={debugNodeIcon(event)} /><span>{nodeTitle(event)}</span></h3>
            <div className="pa-agent-debug-detail-subtitle">{nodeType} · {label('phase', event.kind)}</div>
            <div className="pa-agent-debug-detail-meta">
                <span className={`pa-agent-debug-status-chip ${debugStatusClass(event.status)}`}>{event.status ? label('status', event.status) : t('plugin.agentDebug.unknown')}</span>
                <span>{debugDuration(durationMs)}</span><span>{nodeType}</span>
            </div>
        </header>
        <div className="pa-agent-debug-tabs" role="tablist" aria-label={t('plugin.agentDebug.detailTabs')}>
            {DETAIL_TABS.map((value, index) => <button key={value} ref={button => { tabButtons.current[index] = button; }}
                className={`pa-agent-debug-tab${tab === value ? ' is-active' : ''}`} type="button" role="tab"
                id={`${tabId}-${value}-tab`} aria-controls={`${tabId}-${value}-panel`} aria-selected={tab === value}
                tabIndex={tab === value ? 0 : -1} onClick={() => selectTab(value)} onKeyDown={event => onTabKeyDown(event, index)}>
                {t(`plugin.agentDebug.${TAB_LABELS[value]}`)}
            </button>)}
        </div>
        <div className="pa-agent-debug-detail-content">
            {event.availability && event.availability !== 'recorded' && <p className="pa-agent-debug-notice">{label('availability', event.availability)}</p>}
            {/* Keep panels mounted so changing tabs does not reset loaded text or disclosures. */}
            <section className="pa-agent-debug-tab-panel" role="tabpanel" id={`${tabId}-io-panel`} aria-labelledby={`${tabId}-io-tab`} hidden={tab !== 'io'} tabIndex={0}>
                {loading && contents.length === 0 && <p role="status">{t('plugin.agentDebug.detailsLoading')}</p>}
                {failed && <div role="status" className="pa-agent-debug-notice"><p>{t('plugin.agentDebug.detailsFailed')}</p>
                    <button type="button" onClick={onRetry}>{t('plugin.agentDebug.retryRead')}</button></div>}
                {event.errorSummary && !groups.some(group => group.kind === 'error') && <section className="pa-agent-debug-content-group">
                    <h4 className="pa-agent-debug-content-heading">{label('content', 'error')}</h4><TextBlocks parts={[event.errorSummary]} />
                </section>}
                {groups.map(group => <ContentDisclosure key={group.key} group={group} />)}
                {session.map((detail, index) => <SessionContent key={`${detail.kind}-${index}`} detail={detail} />)}
                {!loading && !failed && contents.length === 0 && session.length === 0 && <p className="pa-agent-debug-muted">{t('plugin.agentDebug.noDetails')}</p>}
                <p className="pa-agent-debug-muted">{t('plugin.agentDebug.reasoningNotice')}</p>
            </section>
            <section className="pa-agent-debug-tab-panel" role="tabpanel" id={`${tabId}-timing-panel`} aria-labelledby={`${tabId}-timing-tab`} hidden={tab !== 'timing'} tabIndex={0}>
                <section className="pa-agent-debug-content-group">
                    <h4 className="pa-agent-debug-content-heading">{t('plugin.agentDebug.relativeTime')}</h4>
                    <dl className="pa-agent-debug-facts">
                        <dt>{t('plugin.agentDebug.startTime')}</dt><dd>{debugDuration(startMs)}</dd>
                        <dt>{t('plugin.agentDebug.endTime')}</dt><dd>{debugDuration(endMs)}</dd>
                        <dt>{t('plugin.agentDebug.duration')}</dt><dd>{debugDuration(durationMs)}</dd>
                        <dt>{t('plugin.agentDebug.time')}</dt><dd>{time(event.timestamp)}</dd>
                        {timing.map(([key, value]) => <div className="pa-agent-debug-fact-row" key={key}><dt>{label('field', key)}</dt><dd>{String(value)}</dd></div>)}
                    </dl>
                </section>
                <section className="pa-agent-debug-content-group"><h4 className="pa-agent-debug-content-heading">{t('plugin.agentDebug.usage')}</h4>
                    <DebugUsageText usage={event.usage} />
                </section>
            </section>
            <section className="pa-agent-debug-tab-panel" role="tabpanel" id={`${tabId}-raw-panel`} aria-labelledby={`${tabId}-raw-tab`} hidden={tab !== 'raw'} tabIndex={0}>
                <section className="pa-agent-debug-content-group"><h4 className="pa-agent-debug-content-heading">{t('plugin.agentDebug.recordedFields')}</h4>
                    <TextBlocks parts={[JSON.stringify(event, null, 2)]} />
                </section>
                {parameters.length > 0 && <details className="pa-agent-debug-content-group">
                    <summary className="pa-agent-debug-content-heading">{t('plugin.agentDebug.parameters')}</summary>
                    <dl className="pa-agent-debug-facts">{parameters.map(([key, value]) => <div className="pa-agent-debug-fact-row" key={key}>
                        <dt>{label('field', key)}</dt><dd>{key === 'purpose' ? label('purpose', String(value)) : String(value)}</dd>
                    </div>)}</dl>
                </details>}
            </section>
        </div>
    </div>;
}

function ContentDisclosure({ group }: { group: ReturnType<typeof groupDebugContents>[number] }) {
    const title = group.kind === 'tool_output'
        ? t(`plugin.agentDebug.toolContent.${group.role ?? 'unknown'}`) : label('content', group.kind);
    return <ContentSection title={title} parts={group.parts} secondary={group.kind === 'reasoning' || group.kind === 'context'} redactions={group.redactions} />;
}

function SessionContent({ detail }: { detail: DebugSessionDetail }) {
    return <ContentSection title={`${label('content', detail.kind)} · ${t('plugin.agentDebug.sessionOnly')}`}
        parts={[detail.text]} secondary={detail.kind === 'reasoning'} />;
}

function ContentSection({ title, parts, secondary, redactions = [] }: { title: string; parts: string[]; secondary: boolean; redactions?: string[] }) {
    const [open, setOpen] = useState(false);
    const body = <>{redactions.length > 0 && <p className="pa-agent-debug-notice">{t('plugin.agentDebug.filteredFields')}: {redactions.join(', ')}</p>}
        <TextBlocks parts={parts} /></>;
    if (secondary) return <details className="pa-agent-debug-content-group" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
        <summary className="pa-agent-debug-content-heading">{title}</summary>{open && body}
    </details>;
    return <section className="pa-agent-debug-content-group"><h4 className="pa-agent-debug-content-heading">{title}</h4>{body}</section>;
}
