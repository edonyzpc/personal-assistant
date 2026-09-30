import { ItemView, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';

import { getPluginUiLanguage, pluginT } from '../../locales/plugin';
import { OperationsReviewPanel } from './OperationsReviewPanel';
import { OPERATIONS_REVIEW_VIEW_TYPE, type OperationsReviewRouter } from './OperationsReviewRouter';

const REVIEW_ID_PATTERN = /^opr-[A-Za-z0-9_-]+$/;

export class OperationsReviewView extends ItemView {
    private root: Root | null = null;
    private routedReviewId: string | undefined;

    /** Runtime route identity for the router; workspace state still uses only the opaque ID. */
    get reviewId(): string | undefined {
        return this.routedReviewId;
    }

    constructor(
        leaf: WorkspaceLeaf,
        private readonly router: OperationsReviewRouter,
    ) {
        super(leaf);
    }

    getViewType(): string {
        return OPERATIONS_REVIEW_VIEW_TYPE;
    }

    getDisplayText(): string {
        return pluginT('plugin.chat.operations.review.title', getPluginUiLanguage());
    }

    getIcon(): string {
        return 'diff';
    }

    getState(): Record<string, unknown> {
        return this.routedReviewId ? { reviewId: this.routedReviewId } : {};
    }

    async setState(state: unknown, _result?: ViewStateResult): Promise<void> {
        const candidate = state && typeof state === 'object' && 'reviewId' in state
            ? state.reviewId
            : undefined;
        this.routedReviewId = typeof candidate === 'string' && REVIEW_ID_PATTERN.test(candidate)
            ? candidate
            : undefined;
        this.renderPanel();
    }

    async onOpen(): Promise<void> {
        const container = this.containerEl.querySelector('.view-content') ?? this.containerEl;
        this.root = createRoot(container);
        this.renderPanel();
    }

    async onClose(): Promise<void> {
        if (this.routedReviewId) this.router.detachLeaf(this.routedReviewId, this.leaf);
        this.root?.unmount();
        this.root = null;
    }

    private renderPanel(): void {
        this.root?.render(
            <OperationsReviewPanel session={this.routedReviewId ? this.router.get(this.routedReviewId) : null} />,
        );
    }
}
