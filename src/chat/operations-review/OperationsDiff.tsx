import { useState, type ReactNode } from 'react';

import type {
    OperationsReviewDiffLine,
    OperationsReviewFileGroup,
    OperationsReviewModel,
} from '../../ai-services/operations/operations-review-model';
import { pluginT, getPluginUiLanguage } from '../../locales/plugin';

export interface OperationsDiffProps {
    model: OperationsReviewModel;
    mode: 'compact' | 'full';
    activeGroupIndex?: number;
}

const COMPACT_MAX_CHANGED_ROWS = 24;
const t = (key: string, params?: Record<string, string | number>) => pluginT(key, getPluginUiLanguage(), params);

export function OperationsDiff({ model, mode, activeGroupIndex }: OperationsDiffProps): ReactNode {
    const compactVisibility = mode === 'compact' ? getOperationsCompactVisibility(model) : null;
    const groups = mode === 'compact'
        ? model.groups.slice(0, 2)
        : activeGroupIndex === undefined
            ? model.groups
            : model.groups.slice(activeGroupIndex, activeGroupIndex + 1);
    const shownLimit = mode === 'compact' ? COMPACT_MAX_CHANGED_ROWS : Number.POSITIVE_INFINITY;
    const renderedGroups = groups.map((group, index) => {
        return (
            <OperationsGroupDiff
                key={group.id}
                group={group}
                mode={mode}
                maxChangedRows={compactVisibility?.limits[index] ?? shownLimit}
            />
        );
    });
    const omittedChanges = compactVisibility?.omittedChanges ?? 0;

    return (
        <div className={`pa-operations-diff pa-operations-diff--${mode}`} data-mode={mode}>
            {mode === 'compact' && omittedChanges > 0 && (
                <div className="pa-operations-diff__omitted" role="status">
                    {t('plugin.chat.operations.review.omitted', { count: omittedChanges })}
                </div>
            )}
            {renderedGroups}
        </div>
    );
}

interface OperationsGroupDiffProps {
    group: OperationsReviewFileGroup;
    mode: 'compact' | 'full';
    maxChangedRows: number;
}

function OperationsGroupDiff({ group, mode, maxChangedRows }: OperationsGroupDiffProps): ReactNode {
    const [activeBlock, setActiveBlock] = useState(0);
    const [showAllContext, setShowAllContext] = useState(false);
    const [showCompleteBefore, setShowCompleteBefore] = useState(false);
    const [showCompleteAfter, setShowCompleteAfter] = useState(false);
    const block = group.blocks[Math.min(activeBlock, Math.max(0, group.blocks.length - 1))];
    const compactLimitReached = mode === 'compact' && maxChangedRows <= 0;
    let rows: readonly OperationsReviewDiffLine[] = [];
    if (!compactLimitReached) {
        if (showAllContext && mode === 'full') rows = group.lines;
        else if (block) rows = group.lines.slice(block.startIndex, block.endIndex + 1);
        else rows = group.lines.slice(0, mode === 'compact' ? 12 : group.lines.length);
        if (mode === 'compact' && maxChangedRows < Number.POSITIVE_INFINITY) {
            const rowsToKeep: OperationsReviewDiffLine[] = [];
            let changes = 0;
            for (const row of rows) {
                if (row.kind !== 'context') {
                    if (changes >= maxChangedRows) break;
                    changes += 1;
                }
                rowsToKeep.push(row);
            }
            rows = rowsToKeep;
        }
    }

    return (
        <section className="pa-operations-diff__group" aria-label={group.path}>
            <header className="pa-operations-diff__group-header">
                <div className="pa-operations-diff__path-row">
                    <span className="pa-operations-diff__file-name">{fileName(group.path)}</span>
                    <code className="pa-operations-diff__path">{group.path}</code>
                    <span className="pa-operations-diff__file-state">
                        {group.created
                            ? t('plugin.chat.operations.review.created')
                            : t('plugin.chat.operations.review.existing')}
                    </span>
                </div>
                <div className="pa-operations-diff__meta">
                    {group.netZeroTextChange && t('plugin.chat.operations.review.netZero')}
                    {group.diffDegraded && (
                        <span className="pa-operations-diff__degraded">
                            {t('plugin.chat.operations.review.degraded')}
                        </span>
                    )}
                </div>
            </header>

            {mode === 'full' && group.blocks.length > 1 && (
                <nav className="pa-operations-diff__block-nav" aria-label={group.path}>
                    {group.blocks.map((candidate, index) => (
                        <button
                            key={candidate.id}
                            type="button"
                            className="pa-operations-review-secondary-button"
                            aria-current={index === activeBlock}
                            onClick={() => {
                                setActiveBlock(index);
                                setShowAllContext(false);
                            }}
                        >
                            {t('plugin.chat.operations.review.expandBlock', { index: index + 1 })}
                        </button>
                    ))}
                </nav>
            )}

            {!compactLimitReached && (
                <div className="pa-operations-diff__rows" role="table" aria-label={group.path}>
                    {rows.map((row, index) => (
                        <OperationsDiffRow
                            key={row.id}
                            row={row}
                            mode={mode}
                            eolChangeLabel={getOperationsEolChangeLabel(row, rows[index + 1])
                                ?? getOperationsEolChangeLabel(row, rows[index - 1])}
                        />
                    ))}
                </div>
            )}

            {mode === 'full' && (
                <div className="pa-operations-diff__full-controls">
                    {!showAllContext && (
                        <button
                            type="button"
                            className="pa-operations-review-secondary-button"
                            onClick={() => setShowAllContext(true)}
                        >
                            {t('plugin.chat.operations.review.expandContext')}
                        </button>
                    )}
                    <button
                        type="button"
                        className="pa-operations-review-secondary-button"
                        aria-expanded={showCompleteBefore}
                        onClick={() => setShowCompleteBefore(value => !value)}
                    >
                        {t('plugin.chat.operations.review.completeBefore')}
                    </button>
                    <button
                        type="button"
                        className="pa-operations-review-secondary-button"
                        aria-expanded={showCompleteAfter}
                        onClick={() => setShowCompleteAfter(value => !value)}
                    >
                        {t('plugin.chat.operations.review.completeAfter')}
                    </button>
                </div>
            )}
            {showCompleteBefore && (
                <pre className="pa-operations-diff__complete" aria-label={t('plugin.chat.operations.review.before')}>
                    {group.before}
                </pre>
            )}
            {showCompleteAfter && (
                <pre className="pa-operations-diff__complete" aria-label={t('plugin.chat.operations.review.after')}>
                    {group.after}
                </pre>
            )}
        </section>
    );
}

function OperationsDiffRow({
    row,
    mode,
    eolChangeLabel,
}: {
    row: OperationsReviewDiffLine;
    mode: 'compact' | 'full';
    eolChangeLabel: string | null;
}): ReactNode {
    const marker = row.kind === 'delete' ? '-' : row.kind === 'insert' ? '+' : '';
    const segments = row.kind === 'delete' ? row.oldSegments : row.newSegments;
    const compactText = limitCompactText(row.text);
    const displayText = mode === 'compact' ? compactText.text : row.text;
    const displaySegments = mode === 'compact' && compactText.truncated
        ? [{ text: compactText.text, changed: row.kind !== 'context' }]
        : segments;
    return (
        <div className={`pa-operations-diff__row pa-operations-diff__row--${row.kind}`} role="row">
            <span className="pa-operations-diff__line-number" role="gridcell">{row.oldNumber ?? ''}</span>
            <span className="pa-operations-diff__line-number" role="gridcell">{row.newNumber ?? ''}</span>
            <span className="pa-operations-diff__marker" role="gridcell" aria-label={row.kind === 'delete'
                ? t('plugin.chat.operations.review.deleted')
                : row.kind === 'insert'
                    ? t('plugin.chat.operations.review.added')
                    : undefined}>{marker}</span>
            <span className="pa-operations-diff__text" role="gridcell">
                {displayText === '' && !row.newline ? '\u00a0' : (displaySegments ?? [{ text: displayText, changed: false }]).map(
                    (segment, index) => segment.changed
                        ? <mark key={index} className="pa-operations-diff__highlight">{segment.text}</mark>
                        : <span key={index}>{segment.text}</span>,
                )}
                {mode === 'compact' && compactText.truncated && (
                    <span className="pa-operations-diff__content-omitted">
                        {t('plugin.chat.operations.review.contentOmitted')}
                    </span>
                )}
                {row.newline === null && row.text !== '' && (
                    <span className="pa-operations-diff__newline-marker" aria-label={t('plugin.chat.operations.review.noNewline')}>
                        {'\\n?'}
                    </span>
                )}
                {eolChangeLabel && (
                    <span
                        className="pa-operations-diff__eol-change"
                        aria-label={t('plugin.chat.operations.review.eolChange')}
                    >
                        {eolChangeLabel}
                    </span>
                )}
            </span>
        </div>
    );
}

export interface OperationsCompactVisibility {
    limits: number[];
    omittedChanges: number;
}

export function getOperationsCompactVisibility(model: OperationsReviewModel): OperationsCompactVisibility {
    let remaining = COMPACT_MAX_CHANGED_ROWS;
    const limits: number[] = [];
    let omittedChanges = 0;

    for (const group of model.groups.slice(0, 2)) {
        const block = group.blocks[0];
        const blockChanges = block
            ? group.lines
                .slice(block.startIndex, block.endIndex + 1)
                .filter(row => row.kind !== 'context').length
            : 0;
        const visible = Math.min(blockChanges, remaining);
        limits.push(visible);
        remaining -= visible;
        omittedChanges += group.changeCount - visible;
    }

    for (const group of model.groups.slice(2)) {
        omittedChanges += group.changeCount;
    }
    return { limits, omittedChanges };
}

export function getOperationsEolChangeLabel(
    row: OperationsReviewDiffLine,
    adjacentRow: OperationsReviewDiffLine | undefined,
): string | null {
    if (
        row.kind === 'context'
        || !adjacentRow
        || adjacentRow.kind === 'context'
        || row.kind === adjacentRow.kind
        || row.text !== adjacentRow.text
        || row.newline === adjacentRow.newline
    ) return null;
    if (row.newline === '\r\n') return 'CRLF';
    if (row.newline === '\n') return 'LF';
    if (row.newline === '\r') return 'CR';
    return t('plugin.chat.operations.review.noNewline');
}

function fileName(path: string): string {
    return path.split('/').pop() || path;
}

function limitCompactText(value: string, maxCharacters = 360): { text: string; truncated: boolean } {
    const characters = Array.from(value);
    if (characters.length <= maxCharacters) return { text: value, truncated: false };
    return { text: `${characters.slice(0, maxCharacters).join('')}…`, truncated: true };
}
