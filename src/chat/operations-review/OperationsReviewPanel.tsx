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

    const groupCount = snapshot.model.groups.length;
    const activeIndex = Math.min(activeGroupIndex, Math.max(0, groupCount - 1));
    const decisionVisible = snapshot.status === 'pending';

    return (
        <div className="pa-operations-review-view">
            <header className="pa-operations-review-view__header">
                <h2>{t('plugin.chat.operations.review.title')}</h2>
                <div role="status" aria-live="polite">{statusText(snapshot.status)}</div>
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
                <OperationsDiff model={snapshot.model} mode="full" activeGroupIndex={activeIndex} />
                {(snapshot.model.attachments?.length ?? 0) > 0 && (
                    <section className="pa-operations-review-results">
                        {(snapshot.model.attachments ?? []).map(attachment => (
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
                                <span>{t('plugin.chat.operations.intent.temporaryUndo')}</span>
                            </div>
                        ))}
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
                                    <code>{row.operationResult.path}</code>
                                </div>
                                <span>{row.message}</span>
                                {row.operationResult.receiptId
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
            </main>

            <footer className="pa-operations-review-view__actions">
                {decisionVisible && (
                    <>
                        <button
                            type="button"
                            className="pa-operations-review-primary-button"
                            disabled={!session.canConfirm()}
                            onClick={() => { void session.confirm(); }}
                        >
                            {t('plugin.chat.operations.intent.confirm')}
                        </button>
                        <button
                            type="button"
                            className="pa-operations-review-secondary-button"
                            disabled={!session.canCancel()}
                            onClick={() => session.cancel()}
                        >
                            {t('plugin.chat.operations.intent.cancel')}
                        </button>
                    </>
                )}
                {session.canUndo() && (
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
            {snapshot.error && <div className="pa-operations-review-error" role="alert">{snapshot.error}</div>}
        </div>
    );
}

function statusText(status: string): string {
    switch (status) {
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
        const message = effects?.length
            ? [
                effects.map(effect => effectText(effect)).join('; '),
                undoResult?.message ?? (undoResult ? undefined : result.message),
                undoResult?.checkpoint ? t('plugin.chat.operations.intent.attachmentRestored') : undefined,
            ].filter(Boolean).join('; ')
            : undoResult
                ? undoResult.status === 'undone'
                    ? t('plugin.chat.operations.intent.undone')
                    : [
                        undoResult.message ?? t('plugin.chat.operations.intent.undoFailed'),
                        ...(undoResult.checkpoint
                            ? [t('plugin.chat.operations.intent.attachmentRestored')] : []),
                    ].join(' ')
                : result.message ?? operationStatusText(result.status);
        return {
            operationResult: result,
            ...(undoResult ? { undoResult } : {}),
            status: undoResult?.status ?? result.status,
            message,
            pathOperationNumber,
        };
    });
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
