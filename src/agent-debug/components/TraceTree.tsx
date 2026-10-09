import type { CSSProperties, RefObject } from 'react';
import { traceInterval, type TraceModel, type TraceRow } from '../trace-model';
import { debugLabel as label, debugT as t, nodeTitle } from './debug-format';

export function TraceTree({ model, rows, selectedId, onSelect, onToggle, scrollRef, onBrowse }: {
    model: TraceModel; rows: TraceRow[]; selectedId?: string; onSelect: (id: string) => void; onToggle: (id: string, expanded: boolean) => void;
    scrollRef: RefObject<HTMLDivElement>; onBrowse: () => void;
}) {
    return <div className="pa-agent-debug-trace-scroll" ref={scrollRef} onWheel={onBrowse} onTouchStart={onBrowse}
        onKeyDown={event => { if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) onBrowse(); }}>
        <div className="pa-agent-debug-time-axis"><span>{t('plugin.agentDebug.trajectory')}</span><span>0 — {model.extentMs === undefined ? t('plugin.agentDebug.unknown') : `${Math.round(model.extentMs)} ms`}</span></div>
        <ol className="pa-agent-debug-trace" aria-label={t('plugin.agentDebug.trajectory')}>
            {rows.map(row => {
                const node = model.nodes.get(row.id)!;
                const interval = traceInterval(node, model.extentMs);
                return <li key={row.id} data-node-id={row.id} className={`pa-agent-debug-trace-row${row.match ? ' is-match' : ''}`}
                    style={{ '--pa-debug-depth': Math.min(row.depth, 8) } as CSSProperties}>
                    <div className="pa-agent-debug-row-main">
                        {node.children.length > 0 ? <button type="button" className="pa-agent-debug-collapse" aria-expanded={row.expanded}
                            aria-label={t(row.expanded ? 'plugin.agentDebug.collapseNode' : 'plugin.agentDebug.expandNode', { name: nodeTitle(node.event) })}
                            onClick={() => onToggle(row.id, !row.expanded)}>{row.expanded ? '▾' : '▸'}</button>
                            : <span className="pa-agent-debug-collapse-space" />}
                        <button type="button" className="pa-agent-debug-node" aria-pressed={selectedId === row.id}
                            onClick={() => onSelect(row.id)} onKeyDown={event => {
                                if (event.key === 'ArrowRight' && node.children.length) { event.preventDefault(); onToggle(row.id, true); }
                                if (event.key === 'ArrowLeft' && node.children.length) { event.preventDefault(); onToggle(row.id, false); }
                            }}>
                            <span className="pa-agent-debug-node-title">{node.event.nodeKind && <span className="pa-agent-debug-kind">{label('nodeKind', node.event.nodeKind)}</span>}{nodeTitle(node.event)}</span>
                            <span className="pa-agent-debug-node-state">{node.event.status ? label('status', node.event.status) : t('plugin.agentDebug.unknown')}
                                {' · '}{node.durationMs === undefined ? t('plugin.agentDebug.unknown') : `${Math.round(node.durationMs)} ms`}</span>
                            {(node.anomalies.failed + node.anomalies.retries + node.anomalies.gaps > 0) && <span className="pa-agent-debug-anomalies">
                                {node.anomalies.failed > 0 && t('plugin.agentDebug.failedCount', { count: node.anomalies.failed })}{' '}
                                {node.anomalies.retries > 0 && t('plugin.agentDebug.retryCount', { count: node.anomalies.retries })}{' '}
                                {node.anomalies.gaps > 0 && t('plugin.agentDebug.gapCount', { count: node.anomalies.gaps })}</span>}
                            {row.match && <span className="pa-agent-debug-match-label">{t('plugin.agentDebug.match')}</span>}
                        </button>
                    </div>
                    <div className="pa-agent-debug-timeline" aria-label={interval ? t('plugin.agentDebug.recordedInterval') : t('plugin.agentDebug.intervalUnknown')}>
                        {interval ? <span className={`pa-agent-debug-time-bar${interval.running ? ' is-running' : ''}`}
                            style={{ left: `${interval.left}%`, width: `${Math.max(interval.width, 0.4)}%` }} /> : <span className="pa-agent-debug-muted">—</span>}
                    </div>
                </li>;
            })}
        </ol>
    </div>;
}
