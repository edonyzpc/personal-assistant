import { useMemo, useState } from 'react';
import type { DebugContent, DebugEvent, DebugSessionDetail, DebugUsage } from '../types';
import { debugLabel as label, debugT as t, debugTime as time, nodeTitle } from './debug-format';

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
    return <><pre tabIndex={0}>{debugTextPrefix(parts, limit)}</pre>{length > limit
        && <button type="button" onClick={() => setLimit(value => value + TEXT_PAGE)}>{t('plugin.agentDebug.moreText')}</button>}</>;
}

export function NodeInspector({ event, contents, session, loading, failed, durationMs, onRetry }: {
    event: DebugEvent; contents: DebugContent[]; session: DebugSessionDetail[]; loading: boolean; failed: boolean; durationMs?: number; onRetry: () => void;
}) {
    const groups = useMemo(() => groupDebugContents(contents), [contents]);
    return <div className="pa-agent-debug-details">
        <h3>{nodeTitle(event)}</h3>
        <dl className="pa-agent-debug-facts">
            <dt>{t('plugin.agentDebug.nodeType')}</dt><dd>{event.nodeKind ? label('nodeKind', event.nodeKind) : t('plugin.agentDebug.legacyType')}</dd>
            <dt>{t('plugin.agentDebug.phase')}</dt><dd>{label('phase', event.kind)}</dd>
            <dt>{t('plugin.agentDebug.result')}</dt><dd>{event.status ? label('status', event.status) : t('plugin.agentDebug.unknown')}</dd>
            <dt>{t('plugin.agentDebug.time')}</dt><dd>{time(event.timestamp)}</dd>
            <dt>{t('plugin.agentDebug.duration')}</dt><dd>{durationMs !== undefined ? `${Math.round(durationMs)} ms` : t('plugin.agentDebug.unknown')}</dd>
            {(['turnId', 'callId', 'attemptId', 'toolCallId'] as const).map(key => event[key]
                ? <div className="pa-agent-debug-fact-row" key={key}><dt>{label('field', key)}</dt><dd>{event[key]}</dd></div> : null)}
        </dl>
        {(event.usage || event.callId || event.nodeKind === 'llm' || event.kind === 'llm') && <p><DebugUsageText usage={event.usage} /></p>}
        {event.details && Object.keys(event.details).length > 0 && <details>
            <summary>{t('plugin.agentDebug.parameters')}</summary>
            <dl className="pa-agent-debug-facts">{Object.entries(event.details).map(([key, value]) => <div className="pa-agent-debug-fact-row" key={key}>
                <dt>{label('field', key)}</dt><dd>{key === 'purpose' ? label('purpose', String(value)) : String(value)}</dd>
            </div>)}</dl>
        </details>}
        {event.availability && event.availability !== 'recorded' && <p className="pa-agent-debug-notice">{label('availability', event.availability)}</p>}
        {loading && contents.length === 0 && <p role="status">{t('plugin.agentDebug.detailsLoading')}</p>}
        {failed && <div role="status" className="pa-agent-debug-notice"><p>{t('plugin.agentDebug.detailsFailed')}</p>
            <button type="button" onClick={onRetry}>{t('plugin.agentDebug.retryRead')}</button></div>}
        {groups.map(group => <ContentDisclosure key={group.key} group={group} />)}
        {session.map((detail, index) => <details key={`${detail.kind}-${index}`}>
            <summary>{label('content', detail.kind)} · {t('plugin.agentDebug.sessionOnly')}</summary>
            <TextBlocks parts={[detail.text]} />
        </details>)}
        {!loading && !failed && contents.length === 0 && session.length === 0 && <p className="pa-agent-debug-muted">{t('plugin.agentDebug.noDetails')}</p>}
        <details><summary>{t('plugin.agentDebug.recordedFields')}</summary><pre tabIndex={0}>{JSON.stringify(event, null, 2)}</pre></details>
        <p className="pa-agent-debug-muted">{t('plugin.agentDebug.reasoningNotice')}</p>
    </div>;
}

function ContentDisclosure({ group }: { group: ReturnType<typeof groupDebugContents>[number] }) {
    // Uncontrolled disclosures and prefix state survive ordinary event/content refreshes.
    const [open, setOpen] = useState(group.kind === 'error');
    const title = group.kind === 'tool_output'
        ? t(`plugin.agentDebug.toolContent.${group.role ?? 'unknown'}`) : label('content', group.kind);
    return <details open={open} onToggle={event => setOpen(event.currentTarget.open)}>
        <summary>{title}</summary>
        {open && <>{group.redactions.length > 0 && <p className="pa-agent-debug-notice">{t('plugin.agentDebug.filteredFields')}: {group.redactions.join(', ')}</p>}
            <TextBlocks parts={group.parts} /></>}
    </details>;
}
