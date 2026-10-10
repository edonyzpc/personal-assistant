import type { CSSProperties, RefObject } from 'react';
import { traceInterval, type TraceModel, type TraceRow } from '../trace-model';
import { debugDuration, debugLabel as label, debugNodeIcon, debugStatusClass, debugT as t, nodeTitle } from './debug-format';
import { DebugIcon } from './DebugIcon';

export function TraceTree({ model, rows, selectedId, onSelect, onToggle, scrollRef, onBrowse }: {
    model: TraceModel; rows: TraceRow[]; selectedId?: string; onSelect: (id: string) => void; onToggle: (id: string, expanded: boolean) => void;
    scrollRef: RefObject<HTMLDivElement>; onBrowse: () => void;
}) {
    return <div className="pa-agent-debug-trace-scroll" ref={scrollRef} onWheel={onBrowse} onTouchStart={onBrowse}
        onKeyDown={event => { if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) onBrowse(); }}>
        <div className="pa-agent-debug-time-axis">
            <span>{t('plugin.agentDebug.node')}</span>
            <div className="pa-agent-debug-time-ticks">{model.extentMs === undefined
                ? <span>{t('plugin.agentDebug.unknown')}</span>
                : [0, 1, 2, 3].map(tick => <span key={tick}>{debugDuration(model.extentMs! * tick / 3)}</span>)}</div>
            <span className="pa-agent-debug-duration">{t('plugin.agentDebug.duration')}</span>
            <span className="pa-agent-debug-sr">{t('plugin.agentDebug.result')}</span>
        </div>
        <ol className="pa-agent-debug-trace" aria-label={t('plugin.agentDebug.trajectory')}>
            {rows.map(row => {
                const node = model.nodes.get(row.id)!;
                const interval = traceInterval(node, model.extentMs);
                const statusClass = debugStatusClass(node.event.status);
                const status = node.event.status ? label('status', node.event.status) : t('plugin.agentDebug.unknown');
                const statusIcon = statusClass === 'is-success' ? 'check' : statusClass === 'is-error' ? 'x'
                    : statusClass === 'is-running' ? 'loader-circle' : statusClass === 'is-warning' ? 'circle-alert' : 'minus';
                const group = node.event.nodeKind === 'run' || node.event.nodeKind === 'turn';
                return <li key={row.id} data-node-id={row.id} data-node-kind={node.event.nodeKind}
                    data-selected={selectedId === row.id} className={`pa-agent-debug-trace-row ${statusClass}${group ? ' is-group' : ''}${row.match ? ' is-match' : ''}`}
                    style={{ '--pa-debug-depth': Math.min(row.depth, 8) } as CSSProperties} onClick={() => onSelect(row.id)}>
                    <div className="pa-agent-debug-row-main">
                        {node.children.length > 0 ? <button type="button" className="pa-agent-debug-collapse" aria-expanded={row.expanded}
                            aria-label={t(row.expanded ? 'plugin.agentDebug.collapseNode' : 'plugin.agentDebug.expandNode', { name: nodeTitle(node.event) })}
                            onClick={event => { event.stopPropagation(); onToggle(row.id, !row.expanded); }}>
                            <DebugIcon name={row.expanded ? 'chevron-down' : 'chevron-right'} /></button>
                            : <span className="pa-agent-debug-collapse-space" />}
                        <button type="button" className="pa-agent-debug-node" aria-pressed={selectedId === row.id}
                            title={nodeTitle(node.event)} onClick={event => { event.stopPropagation(); onSelect(row.id); }} onKeyDown={event => {
                                if (event.key === 'ArrowRight' && node.children.length) { event.preventDefault(); onToggle(row.id, true); }
                                if (event.key === 'ArrowLeft' && node.children.length) { event.preventDefault(); onToggle(row.id, false); }
                            }}>
                            <DebugIcon name={debugNodeIcon(node.event)} className="pa-agent-debug-node-icon" />
                            <span className="pa-agent-debug-sr">{node.event.nodeKind ? label('nodeKind', node.event.nodeKind) : t('plugin.agentDebug.legacyType')}{' · '}</span>
                            <span className="pa-agent-debug-node-title">{nodeTitle(node.event)}</span>
                            {!row.expanded && node.children.length > 0 && (node.anomalies.failed + node.anomalies.retries + node.anomalies.gaps > 0) && <span className="pa-agent-debug-anomalies">
                                {([{ key: 'failed', icon: 'circle-x', text: 'failedCount' }, { key: 'retries', icon: 'rotate-ccw', text: 'retryCount' },
                                    { key: 'gaps', icon: 'triangle-alert', text: 'gapCount' }] as const).map(anomaly => node.anomalies[anomaly.key] > 0
                                    && <span key={anomaly.key} title={t(`plugin.agentDebug.${anomaly.text}`, { count: node.anomalies[anomaly.key] })}>
                                        <DebugIcon name={anomaly.icon} />{node.anomalies[anomaly.key]}
                                        <span className="pa-agent-debug-sr">{t(`plugin.agentDebug.${anomaly.text}`, { count: node.anomalies[anomaly.key] })}</span>
                                    </span>)}</span>}
                            {row.match && <span className="pa-agent-debug-sr">{t('plugin.agentDebug.match')}</span>}
                        </button>
                    </div>
                    <button type="button" className="pa-agent-debug-timeline" tabIndex={-1}
                        aria-label={`${nodeTitle(node.event)} · ${t(interval ? 'plugin.agentDebug.recordedInterval' : 'plugin.agentDebug.intervalUnknown')}`}
                        onClick={event => { event.stopPropagation(); onSelect(row.id); }}>
                        {interval ? <span className={`pa-agent-debug-time-bar${interval.running ? ' is-running' : ''}${node.event.kind.includes('retry_wait') ? ' is-wait' : ''}`}
                            style={{ left: `${interval.left}%`, width: `${Math.max(interval.width, 0.4)}%` }} /> : <span className="pa-agent-debug-muted">—</span>}
                    </button>
                    <span className="pa-agent-debug-duration">{debugDuration(node.durationMs)}</span>
                    <span className={`pa-agent-debug-node-state ${statusClass}`} title={status}>
                        <DebugIcon name={statusIcon} /><span className="pa-agent-debug-sr">{status}</span>
                    </span>
                </li>;
            })}
        </ol>
    </div>;
}
