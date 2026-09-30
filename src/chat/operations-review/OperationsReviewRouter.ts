import type { View, WorkspaceLeaf } from 'obsidian';

import type { OperationsReviewSession } from '../../ai-services/operations/operations-review-session';

export const OPERATIONS_REVIEW_VIEW_TYPE = 'pa-operations-review-view';

type RoutedView = View & { readonly reviewId?: string };

export interface OperationsReviewWorkspace {
    getLeavesOfType(viewType: string): WorkspaceLeaf[];
    getLeaf(kind: 'tab'): WorkspaceLeaf;
    revealLeaf(leaf: WorkspaceLeaf): Promise<void>;
}

/** Runtime-only route table. Workspace state receives only opaque review IDs. */
export class OperationsReviewRouter {
    private readonly sessions = new Map<string, OperationsReviewSession>();
    private readonly leaves = new Map<string, WorkspaceLeaf>();
    private readonly opening = new Map<string, Promise<void>>();

    register(session: OperationsReviewSession): void {
        this.sessions.set(session.reviewId, session);
    }

    get(reviewId: string): OperationsReviewSession | null {
        return this.sessions.get(reviewId) ?? null;
    }

    async open(reviewId: string, workspace: OperationsReviewWorkspace): Promise<void> {
        const session = this.sessions.get(reviewId);
        if (!session) throw new Error('Operations review is no longer available.');
        const alreadyOpening = this.opening.get(reviewId);
        if (alreadyOpening) return await alreadyOpening;

        const opening = this.openSession(reviewId, session, workspace)
            .finally(() => {
                if (this.opening.get(reviewId) === opening) this.opening.delete(reviewId);
            });
        this.opening.set(reviewId, opening);
        return await opening;
    }

    private async openSession(
        reviewId: string,
        session: OperationsReviewSession,
        workspace: OperationsReviewWorkspace,
    ): Promise<void> {
        const isRouteActive = () => this.sessions.get(reviewId) === session;
        const existing = workspace.getLeavesOfType(OPERATIONS_REVIEW_VIEW_TYPE)
            .find(leaf => (leaf.view as RoutedView | null)?.reviewId === reviewId);
        const leaf = existing ?? workspace.getLeaf('tab');
        if (!existing) {
            await leaf.setViewState({ type: OPERATIONS_REVIEW_VIEW_TYPE, active: true });
            if (!isRouteActive()) throw new Error('Operations review is no longer available.');
            await leaf.loadIfDeferred?.();
            if (!isRouteActive()) throw new Error('Operations review is no longer available.');
            const view = leaf.view as RoutedView | null;
            if (view) await view.setState({ reviewId }, { history: false });
            if (!isRouteActive()) throw new Error('Operations review is no longer available.');
        }
        await workspace.revealLeaf(leaf);
        if (!isRouteActive()) throw new Error('Operations review is no longer available.');
        this.leaves.set(reviewId, leaf);
    }

    detachLeaf(reviewId: string, leaf: WorkspaceLeaf): void {
        if (this.leaves.get(reviewId) === leaf) this.leaves.delete(reviewId);
    }

    invalidate(reviewId: string): void {
        this.sessions.delete(reviewId);
        this.leaves.delete(reviewId);
    }

    dispose(): void {
        this.sessions.clear();
        this.leaves.clear();
    }
}
