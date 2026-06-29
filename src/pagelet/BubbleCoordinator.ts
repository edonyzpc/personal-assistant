/* Copyright 2023 edonyzpc */

/**
 * BubbleCoordinator -- owns the Pet-click -> Bubble display lifecycle.
 *
 * Extracted from {@link PageletOrchestrator} so Bubble content-selection
 * logic does not pollute the main coordination layer.
 *
 * Handles: handlePetClick, showBubble, showNudgeBubble.
 * The orchestrator delegates these calls and supplies the runtime
 * dependencies through the constructor.
 */

import { getPageletUiLanguage } from "../locales/pagelet";

import type { BubbleContent, BubbleFinding, BubbleQuickAccessCallbacks } from "./bubble/types";
import type { BubbleView } from "./bubble/BubbleView";
import { buildEmptyContent, buildNudgeContent, buildOnboardingContent, buildQuickReviewContent, buildQuietRecallNudgeContent, buildReviewQueueNudgeContent, buildWritingAssistContent } from "./bubble/BubbleContent";
import type { PreloadCache } from "./preload/PreloadCache";
import type { PreloadFinding } from "./preload/types";
import type { ProactiveHints } from "./hints/ProactiveHints";
import type { PetView } from "./pet/PetView";
import type { PageletHost } from "./PageletHost";
import { isReviewQueueBubbleReminderEligible, type QuietRecallBubbleNudge, type ReviewQueueStatus } from "../pa";

const REVIEW_QUEUE_BUBBLE_REMINDER_STATUSES = [
    "accepted",
    "edited",
    "snoozed",
] as const satisfies readonly ReviewQueueStatus[];

// ---------------------------------------------------------------------------
// Callbacks the coordinator fires back at the orchestrator
// ---------------------------------------------------------------------------

export interface BubbleCoordinatorCallbacks {
    /** Expand findings into the full Panel. */
    onExpandPanel(type: string): void;
    /** Navigate to a source note by vault path. */
    onSourceClick(link: string): void;
    /** Bubble dismissed (close / Escape). */
    onDismiss(): void;
    /** Trigger an immediate foreground review. */
    onReviewCurrentNote(): void;
    /** Trigger note-connection discovery. */
    onDiscoverConnections(): void;
    /** Generate a periodic summary. */
    onPeriodicSummary(): void;
    /** Return the current local Quiet Recall Bubble nudge candidate, if one is pending. */
    getQuietRecallNudge(): QuietRecallBubbleNudge | null;
    /** Open the existing Quiet Recall detail surface from the Bubble nudge. */
    onQuietRecallView(candidate: QuietRecallBubbleNudge): void;
    /** Suppress this Quiet Recall nudge candidate for the local session. */
    onQuietRecallDismiss(candidate: QuietRecallBubbleNudge): void;
    /** Snooze this Quiet Recall nudge candidate without saving or enqueuing it. */
    onQuietRecallLater(candidate: QuietRecallBubbleNudge): void;
}

// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------

export class BubbleCoordinator {
    constructor(
        private readonly host: PageletHost,
        private readonly preloadCache: PreloadCache,
        private readonly proactiveHints: ProactiveHints,
        private readonly callbacks: BubbleCoordinatorCallbacks,
    ) {}

    // ======================================================================
    // Pet-click entry point
    // ======================================================================

    /**
     * Handle a click/tap on the Pet element.
     * Toggles the Bubble, shows nudge content, or shows regular content.
     */
    handlePetClick(
        bubbleView: BubbleView | null,
        petView: PetView | null,
    ): void {
        if (!bubbleView) return;

        // If bubble is already visible, close it (toggle)
        if (bubbleView.bubbleState === "visible") {
            bubbleView.close();
            return;
        }

        // If Pet is in nudge state, show nudge-specific content
        if (petView?.stateMachine.state === "nudge") {
            this.showNudgeBubble(bubbleView, petView);
            petView.stateMachine.transition("user-interact");
            this.proactiveHints.onHintViewed();
            return;
        }

        // Otherwise, show regular bubble
        this.showBubble(bubbleView, petView);
    }

    // ======================================================================
    // Bubble content builders
    // ======================================================================

    private buildQuickAccessCallbacks(bubbleView: BubbleView): BubbleQuickAccessCallbacks {
        return {
            onExpandPanel: (type) => this.callbacks.onExpandPanel(type ?? ""),
            onSourceClick: (link) => this.callbacks.onSourceClick(link),
            onDismiss: () => {
                bubbleView.close();
                this.callbacks.onDismiss();
            },
            onReviewCurrentNote: () => {
                bubbleView.close();
                this.callbacks.onReviewCurrentNote();
            },
            onDiscoverConnections: () => {
                bubbleView.close();
                this.callbacks.onDiscoverConnections();
            },
            onPeriodicSummary: () => {
                bubbleView.close();
                this.callbacks.onPeriodicSummary();
            },
        };
    }

    /**
     * Show the Bubble with cached background preparation findings, or an
     * empty state that offers to trigger an immediate analysis cycle.
     */
    showBubble(
        bubbleView: BubbleView | null,
        petView: PetView | null,
    ): void {
        const anchorEl = petView?.rootEl;
        if (!bubbleView || !anchorEl) return;

        const locale = getPageletUiLanguage();
        const cachedFindings = this.preloadCache.getFindings();
        const quickAccessCallbacks = this.buildQuickAccessCallbacks(bubbleView);

        if (!this.host.settings.pagelet.onboardingShown && cachedFindings.length === 0) {
            const content = buildOnboardingContent(() => {
                this.host.updatePageletSetting("onboardingShown", true);
                bubbleView.close();
            }, locale);
            bubbleView.show(content, anchorEl);
            return;
        }

        if (!this.host.settings.pagelet.onboardingShown) {
            this.host.updatePageletSetting("onboardingShown", true);
        }

        let content: BubbleContent;
        if (cachedFindings.length > 0) {
            const findings: BubbleFinding[] = cachedFindings.map((f) => ({
                text: f.text,
                sourceLink: f.sourceFile,
                sourceTitle: f.sourceTitle,
            }));
            content = buildQuickReviewContent(findings, quickAccessCallbacks, locale);
        } else {
            const queueCount = this.keptReviewQueueItemCount();
            content = queueCount > 0
                ? buildReviewQueueNudgeContent(queueCount, quickAccessCallbacks, locale)
                : buildEmptyContent(quickAccessCallbacks, locale);
        }

        bubbleView.show(content, anchorEl);
    }

    private buildReviewQueueAwareNudge(
        cachedFindings: PreloadFinding[],
        callbacks: ReturnType<BubbleCoordinator["buildQuickAccessCallbacks"]>,
        locale: ReturnType<typeof getPageletUiLanguage>,
    ): BubbleContent {
        if (cachedFindings.length > 0) {
            const findings: BubbleFinding[] = cachedFindings.map((f) => ({
                text: f.text,
                sourceLink: f.sourceFile,
                sourceTitle: f.sourceTitle,
            }));
            return buildNudgeContent(findings, callbacks, locale);
        }
        const queueCount = this.keptReviewQueueItemCount();
        if (queueCount > 0) {
            return buildReviewQueueNudgeContent(queueCount, callbacks, locale);
        }

        const quietRecallContent = buildQuietRecallNudgeContent({
            pageletEnabled: this.host.settings.pagelet.enabled,
            quietRecallEnabled: this.host.settings.quietRecall.enabled,
            bubbleNudgesEnabled: this.host.settings.quietRecall.bubbleNudgesEnabled,
            proactiveHints: this.host.settings.pagelet.proactiveHints,
            quietHoursActive: this.proactiveHints.quietHoursActive,
            candidate: this.callbacks.getQuietRecallNudge(),
        }, {
            onView: (candidate) => {
                callbacks.onDismiss();
                this.callbacks.onQuietRecallView(candidate);
            },
            onDismiss: (candidate) => {
                callbacks.onDismiss();
                this.callbacks.onQuietRecallDismiss(candidate);
            },
            onLater: (candidate) => {
                callbacks.onDismiss();
                this.callbacks.onQuietRecallLater(candidate);
            },
        }, locale);

        return quietRecallContent ?? buildEmptyContent(callbacks, locale);
    }

    private keptReviewQueueItemCount(): number {
        return this.host.listReviewQueueItems({
            statuses: REVIEW_QUEUE_BUBBLE_REMINDER_STATUSES,
        }).filter(isReviewQueueBubbleReminderEligible).length;
    }

    /**
     * Show nudge-specific content when Pet is in nudge state.
     */
    showNudgeBubble(
        bubbleView: BubbleView | null,
        petView: PetView | null,
    ): void {
        const anchorEl = petView?.rootEl;
        if (!bubbleView || !anchorEl) return;

        const locale = getPageletUiLanguage();
        const quickAccessCallbacks = this.buildQuickAccessCallbacks(bubbleView);
        const cachedFindings = this.preloadCache.getFindings();
        if (cachedFindings.length === 0) {
            const content = this.buildReviewQueueAwareNudge(cachedFindings, quickAccessCallbacks, locale);
            bubbleView.show(content, anchorEl);
            return;
        }
        const findings: BubbleFinding[] = cachedFindings.map((f) => ({
            text: f.text,
            sourceLink: f.sourceFile,
            sourceTitle: f.sourceTitle,
        }));

        const content = buildNudgeContent(findings, quickAccessCallbacks, locale);

        bubbleView.show(content, anchorEl);
    }

    /**
     * Show foreground analysis results in the Bubble.
     * Called from analyzeFiles when results should go to Bubble rather than Panel.
     */
    showAnalysisResults(
        bubbleView: BubbleView | null,
        petView: PetView | null,
        rawFindings: PreloadFinding[],
    ): void {
        const anchorEl = petView?.rootEl;
        if (!bubbleView || !anchorEl) return;

        const locale = getPageletUiLanguage();
        const quickAccessCallbacks = this.buildQuickAccessCallbacks(bubbleView);

        if (rawFindings.length > 0) {
            const findings: BubbleFinding[] = rawFindings.map((f) => ({
                text: f.text,
                sourceLink: f.sourceFile,
                sourceTitle: f.sourceTitle,
            }));
            const content = buildWritingAssistContent(findings, {
                onExpandPanel: (type) => this.callbacks.onExpandPanel(type ?? ""),
                onSourceClick: (link) => this.callbacks.onSourceClick(link),
                onDismiss: () => {
                    bubbleView.close();
                    this.callbacks.onDismiss();
                },
            }, locale);
            bubbleView.show(content, anchorEl);
        } else {
            const content = buildEmptyContent(quickAccessCallbacks, locale);
            bubbleView.show(content, anchorEl);
        }
    }
}
