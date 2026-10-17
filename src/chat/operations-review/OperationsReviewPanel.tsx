import { useEffect, useState, type ReactNode } from 'react';

import type {
    OperationsReviewSession,
    OperationsReviewSnapshot,
} from '../../ai-services/operations/operations-review-session';
import { getPluginUiLanguage, pluginT } from '../../locales/plugin';
import { OperationsDiff } from './OperationsDiff';

export interface OperationsReviewPanelProps {
    session: OperationsReviewSession | null;
}

export interface OperationsReviewResultRow {
    operationResult: OperationsReviewSnapshot["operationResults"][number];
    undoResult?: OperationsReviewSnapshot["undoResults"][number];
    status: string;
    message: string;
    pathOperationNumber: number;
}

const t = (key: string, params?: Record<string, string | number>) => pluginT(key, getPluginUiLanguage(), params);

export function OperationsReviewPanel({ session }: OperationsReviewPanelProps): ReactNode {
    const [snapshot, setSnapshot] = useState(session?.getSnapshot() ?? null);
    const [activeGroupIndex, setActiveGroupIndex] = useState(0);

    useEffect(() => {
        setSnapshot(session?.getSnapshot() ?? null);
        setActiveGroupIndex(0);
        return session?.subscribe(setSnapshot);
    }, [session]);

    if (!session || !snapshot?.model) {
        return (
            <div className="pa-operations-review-view__empty" role="status">
                {t('plugin.chat.operations.review.unavailable')}
            </div>
        );
    }

    const hasUndoHistory = snapshot.scope === 'request' && snapshot.historicalModel !== null
        && snapshot.undoResults.some(result => result.status === 'undone');
    const model = hasUndoHistory && snapshot.status === 'undone' && snapshot.historicalModel
        ? snapshot.historicalModel
        : snapshot.model;
    const groupCount = model.groups.length;
    const activeIndex = Math.min(activeGroupIndex, Math.max(0, groupCount - 1));
    const isRequestScope = snapshot.scope === 'request';
    const previewGroups = isRequestScope ? snapshot.model.previewGroups ?? [] : [];
    const previewAttachments = isRequestScope ? snapshot.model.previewAttachments ?? [] : [];
    const hasRequestPreview = previewGroups.length > 0 || previewAttachments.length > 0;
    const requestBlocking = [...snapshot.undoResults].reverse().find(result => result.status !== 'undone');
    const requestRemaining = isRequestScope ? session.activeReceiptIds().length : 0;

    return (
        <div className="pa-operations-review-view">
            <header className="pa-operations-review-view__header">
                <h2>{t('plugin.chat.operations.review.title')}</h2>
                <div role="status" aria-live="polite">{snapshot.status === 'completed' && snapshot.operationResults.length > 0
                    && snapshot.operationResults.every(result => result.status === 'unchanged')
                    ? t('plugin.chat.operations.intent.unchanged') : statusText(snapshot.status)}</div>
            </header>

            {groupCount > 1 && (
                <nav className="pa-operations-review-view__nav" aria-label={t('plugin.chat.operations.review.title')}>
                    <button
                        type="button"
                        className="pa-operations-review-secondary-button"
                        disabled={activeIndex === 0}
                        onClick={() => setActiveGroupIndex(Math.max(0, activeIndex - 1))}
                    >
                        {t('plugin.chat.operations.review.previous')}
                    </button>
                    <span aria-current="true">{activeIndex + 1} / {groupCount}</span>
                    <button
                        type="button"
                        className="pa-operations-review-secondary-button"
                        disabled={activeIndex >= groupCount - 1}
                        onClick={() => setActiveGroupIndex(Math.min(groupCount - 1, activeIndex + 1))}
                    >
                        {t('plugin.chat.operations.review.next')}
                    </button>
                </nav>
            )}

            <main className="pa-operations-review-view__content">
                <OperationsDiff model={model} mode="full" activeGroupIndex={activeIndex} />
                {(model.attachments?.length ?? 0) > 0 && (
                    <section className="pa-operations-review-results">
                        {(model.attachments ?? []).map(attachment => (
                            <div key={attachment.id} className="pa-operations-review-result">
                                <div className="pa-operations-review-result__target">
                                    <span>{t('plugin.chat.operations.intent.image')}</span>
                                    <code>{attachment.path}</code>
                                </div>
                                <span>
                                    {attachment.outcome === 'unknown'
                                        ? t('plugin.chat.operations.intent.unknown')
                                        : attachment.blocked
                                            ? t('plugin.chat.operations.intent.attachmentDeleteBlocked')
                                            : attachment.action === 'delete'
                                            ? t('plugin.chat.operations.intent.attachmentDelete')
                                            : t('plugin.chat.operations.intent.attachmentKeep')}
                                </span>
                            </div>
                        ))}
                    </section>
                )}
                {hasRequestPreview && (
                    <section
                        className="pa-operations-review-results"
                        aria-label={t('plugin.chat.operations.request.preview')}
                    >
                        <div className="pa-operations-review-result">
                            <span>{t('plugin.chat.operations.request.preview')}</span>
                        </div>
                        {previewGroups.length > 0 && (
                            <OperationsDiff model={{ ...snapshot.model, groups: previewGroups }} mode="request" />
                        )}
                        {previewAttachments.length > 0 && (
                            <div className="pa-operations-review-results">
                                {previewAttachments.map(attachment => (
                                    <div key={attachment.id} className="pa-operations-review-result">
                                        <div className="pa-operations-review-result__target">
                                            <span>{t('plugin.chat.operations.intent.image')}</span>
                                            <code>{attachment.path}</code>
                                        </div>
                                        <span>
                                            {attachment.blocked
                                                ? t('plugin.chat.operations.intent.attachmentDeleteBlocked')
                                                : attachment.action === 'delete'
                                                ? t('plugin.chat.operations.intent.attachmentDelete')
                                                : t('plugin.chat.operations.intent.attachmentKeep')}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                )}
                {snapshot.operationResults.length > 0 && (
                    <section className="pa-operations-review-results">
                        {projectOperationsReviewResultRows(snapshot).map(row => (
                            <div
                                key={row.operationResult.operationId}
                                className="pa-operations-review-result"
                                data-status={row.status}
                            >
                                <div className="pa-operations-review-result__target">
                                    <span>{operationKindText(row.operationResult.name)} · {row.pathOperationNumber}</span>
                                    <code>{row.operationResult.targetPath
                                        ? `${row.operationResult.path} → ${row.operationResult.targetPath}`
                                        : row.operationResult.path}</code>
                                </div>
                                <span>{row.message}</span>
                                {!isRequestScope
                                    && row.operationResult.receiptId
                                    && row.operationResult.undoAvailable !== false
                                    && row.undoResult?.status !== "undone" && (
                                    <button
                                        type="button"
                                        className="pa-operations-review-secondary-button"
                                        disabled={!session.canUndo() || snapshot.actionInFlight !== null}
                                        onClick={() => { void session.undo([row.operationResult.receiptId!]); }}
                                    >
                                        {t('plugin.chat.operations.intent.undo')}
                                    </button>
                                )}
                            </div>
                        ))}
                    </section>
                )}
                {hasUndoHistory && snapshot.status !== 'undone' && snapshot.historicalModel && (
                    <section className="pa-operations-review-results" aria-label={t('plugin.chat.operations.request.history')}>
                        <div className="pa-operations-review-result">
                            <span>{t('plugin.chat.operations.request.history')}</span>
                        </div>
                        <OperationsDiff model={snapshot.historicalModel} mode="request" />
                    </section>
                )}
            </main>

            <footer className="pa-operations-review-view__actions">
                {isRequestScope ? (snapshot.status !== 'preview' && (
                    <button
                        type="button"
                        className="pa-operations-review-secondary-button"
                        disabled={!session.canUndo() || snapshot.actionInFlight !== null}
                        onClick={() => { void session.undoRequest(); }}
                    >
                        {snapshot.actionInFlight !== null
                            ? t('plugin.chat.operations.request.undoing')
                            : t('plugin.chat.operations.request.undo')}
                    </button>
                )) : session.canUndo() && (
                    <button
                        type="button"
                        className="pa-operations-review-secondary-button"
                        disabled={snapshot.actionInFlight !== null}
                        onClick={() => { void session.undoAll(); }}
                    >
                        {t('plugin.chat.operations.intent.undoAll')}
                    </button>
                )}
            </footer>
            {isRequestScope && snapshot.status === 'undone' && (
                <div className="pa-operations-review-result" role="status">
                    {t('plugin.chat.operations.request.undoneAll')}
                </div>
            )}
            {isRequestScope && requestBlocking && (
                <div className="pa-operations-review-error" role="alert">
                    {[
                        requestBlocking.failureCategory === 'stale_target'
                            ? t('plugin.chat.operations.request.conflict')
                            : requestBlocking.failureCategory === 'expired'
                                ? t('plugin.chat.operations.request.recoveryExpired')
                                : requestBlocking.failureCategory === 'unknown'
                                    ? t('plugin.chat.operations.request.confirming')
                                    : t('plugin.chat.operations.intent.undoFailed'),
                        ...(requestRemaining > 0
                            ? [t('plugin.chat.operations.request.remaining', { count: requestRemaining })] : []),
                    ].join(' · ')}
                </div>
            )}
            {snapshot.error && <div className="pa-operations-review-error" role="alert">{snapshot.error}</div>}
        </div>
    );
}

function statusText(status: string): string {
    switch (status) {
        case 'preview': return t('plugin.chat.operations.intent.preview');
        case 'pending': return t('plugin.chat.operations.intent.pending');
        case 'executing': return t('plugin.chat.operations.intent.executing');
        case 'completed': return t('plugin.chat.operations.intent.completed');
        case 'partial': return t('plugin.chat.operations.intent.partial');
        case 'failed': return t('plugin.chat.operations.intent.failed');
        case 'unknown': return t('plugin.chat.operations.intent.unknown');
        case 'undone': return t('plugin.chat.operations.intent.undone');
        case 'cancelled': return t('plugin.chat.operations.intent.cancelled');
        case 'discarded': return t('plugin.chat.operations.intent.discarded');
        case 'expired': return t('plugin.chat.operations.intent.expired');
        default: return t('plugin.chat.operations.review.unavailable');
    }
}

function operationStatusText(status: string): string {
    switch (status) {
        case 'unchanged': return t('plugin.chat.operations.intent.unchanged');
        case 'succeeded': return t('plugin.chat.operations.intent.succeeded');
        case 'stale': return t('plugin.chat.operations.intent.stale');
        case 'skipped': return t('plugin.chat.operations.intent.skipped');
        case 'unknown': return t('plugin.chat.operations.intent.unknown');
        case 'partial': return t('plugin.chat.operations.intent.partial');
        default: return t('plugin.chat.operations.intent.failed');
    }
}

function operationKindText(name: string): string {
    switch (name) {
        case 'vault_move': return t('plugin.chat.operations.intent.move');
        case 'vault_create': return t('plugin.chat.operations.intent.create');
        case 'vault_append': return t('plugin.chat.operations.intent.append');
        case 'frontmatter_update': return t('plugin.chat.operations.intent.properties');
        case 'remove_note_image': return t('plugin.chat.operations.intent.image');
        default: return t('plugin.chat.operations.intent.edit');
    }
}

export function projectOperationsReviewResultRows(
    snapshot: OperationsReviewSnapshot,
): OperationsReviewResultRow[] {
    return snapshot.operationResults.map(result => {
        const undoResult = (result.receiptId
            ? snapshot.undoResults.find(candidate => candidate.receiptId === result.receiptId)
            : undefined)
            ?? snapshot.undoResults.find(candidate => candidate.operationId === result.operationId);
        const pathOperationNumber = snapshot.operationResults
            .filter(candidate => candidate.path === result.path)
            .findIndex(candidate => candidate.operationId === result.operationId) + 1;
        const effects = undoResult?.effects ?? result.effects;
        const failedCategoryText = result.failureCategory
            && result.status !== 'succeeded' && result.status !== 'unchanged'
            ? operationFailureText(result)
            : undefined;
        // A successful restore never carries failure text; the category map
        // applies only to a non-undone recovery result.
        const undoFailure = undoResult && undoResult.status !== 'undone'
            ? undoFailureText(undoResult)
            : undefined;
        // A restored compound effect must not retain the original failure
        // prose; the restore facts above already describe the outcome.
        const resultDetail = undoResult?.status === 'undone'
            ? undefined
            : undoFailure ?? failedCategoryText ?? result.message;
        const message = effects?.length
            ? [
                effects.map(effect => effectText(effect)).join('; '),
                resultDetail,
                undoResult?.checkpoint ? t('plugin.chat.operations.intent.attachmentRestored') : undefined,
            ].filter(Boolean).join('; ')
            : undoResult
                ? undoResult.status === 'undone'
                    ? t('plugin.chat.operations.intent.undone')
                    : [
                        undoFailure ?? t('plugin.chat.operations.intent.undoFailed'),
                        ...(undoResult.checkpoint
                            ? [t('plugin.chat.operations.intent.attachmentRestored')] : []),
                    ].join(' ')
                : failedCategoryText ?? result.message ?? operationStatusText(result.status);
        return {
            operationResult: result,
            ...(undoResult ? { undoResult } : {}),
            status: undoResult?.status ?? result.status,
            message,
            pathOperationNumber,
        };
    });
}

function undoFailureText(undoResult: OperationsReviewSnapshot["undoResults"][number]): string {
    switch (undoResult.failureCategory) {
        case 'stale_target': return t('plugin.chat.operations.request.conflict');
        case 'expired': return t('plugin.chat.operations.request.recoveryExpired');
        case 'unknown': return t('plugin.chat.operations.request.confirming');
        default: return t('plugin.chat.operations.intent.undoFailed');
    }
}

function operationFailureText(result: OperationsReviewSnapshot["operationResults"][number]): string {
    // An attempted restoration is never a zero-write preview fact; expired or
    // cancelled SDK Undo keeps recovery semantics.
    if (result.resourceEffect?.kind === 'undo'
        && (result.failureCategory === 'expired' || result.failureCategory === 'cancelled')) {
        return result.failureCategory === 'expired'
            ? t('plugin.chat.operations.request.recoveryExpired')
            : t('plugin.chat.operations.intent.undoFailed');
    }
    const category = result.failureCategory;
    switch (category) {
        case 'stale_target': return t('plugin.chat.operations.intent.stale');
        case 'expired': return t('plugin.chat.operations.intent.expired');
        case 'cancelled': return t('plugin.chat.operations.intent.cancelled');
        case 'unknown': return t('plugin.chat.operations.intent.unknown');
        case 'undo_unavailable': return t('plugin.chat.operations.intent.undoFailed');
        default: return t('plugin.chat.operations.intent.failed');
    }
}

function effectText(effect: NonNullable<OperationsReviewSnapshot["operationResults"][number]["effects"]>[number]): string {
    const target = effect.key === 'note'
        ? t('plugin.chat.operations.intent.noteEffect')
        : t('plugin.chat.operations.intent.attachmentEffect');
    const status = effect.status === 'applied' || effect.status === 'removed'
        ? t('plugin.chat.operations.intent.succeeded')
        : effect.status === 'unknown'
            ? t('plugin.chat.operations.intent.unknown')
            : effect.status === 'restored'
                ? t('plugin.chat.operations.intent.undone')
                : effect.status === 'not_started'
                    ? t('plugin.chat.operations.intent.effectNotStarted')
                    : t('plugin.chat.operations.intent.failed');
    return `${target}: ${status}`;
}
