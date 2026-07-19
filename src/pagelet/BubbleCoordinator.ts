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

import { getPageletUiLanguage, pageletT } from "../locales/pagelet";

import type { BubbleContent, BubbleFinding, BubbleStateCallbacks, DeliveryCandidate, InlineContextHint } from "./bubble/types";
import type { BubbleView } from "./bubble/BubbleView";
import { buildContextLimitedContent, buildEmptyContent, buildIntentionallyQuietContent, buildLocalDiscoveryClueContent, buildNeedsSetupContent, buildOnboardingNudgeContent, buildPatternDetectionNudgeContent, buildPreparedRecapDeliveryContent, buildPreparingContent, buildQuietRecallNudgeContent, buildRecallDeliveryContent, buildRecallDeliveryStackContent, buildReadyEmptyContent, buildWritingAssistContent, type OnboardingNudge } from "./bubble/BubbleContent";
import { quietRecallCandidateToDeliveryCandidate, quietRecallCandidateToDiscoveryCandidate } from "./bubble/recall-card";
import { resolveBubbleExplanationState } from "./bubble/state-resolver";
import type { PreloadCache } from "./preload/PreloadCache";
import type { PreloadFinding } from "./preload/types";
import type { ProactiveHints } from "./hints/ProactiveHints";
import type { PetView } from "./pet/PetView";
import type { PageletHost } from "./PageletHost";
import {
    QUIET_RECALL_BUBBLE_MIN_SCORE,
    quietRecallLinkTargetPath,
    type PatternDetectionResult,
    type QuietRecallBubbleNudge,
    type QuietRecallCandidate,
} from "../pa";

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
    /** Open the exact local candidates behind the Discover-only Recall affordance. */
    onQuietRecallDiscoverOnly(): void;
    /** Return a one-time onboarding bridge nudge, if pending. */
    getOnboardingNudge(): OnboardingNudge | null;
    /** Dismiss a one-time onboarding bridge nudge. */
    onOnboardingNudgeDismiss(nudge: OnboardingNudge): void;
    /** Return the current local Quiet Recall Bubble nudge candidate, if one is pending. */
    getQuietRecallNudge(): QuietRecallBubbleNudge | null;
    /** Return the complete Quiet Recall candidate for delivery rendering, if available. */
    getQuietRecallCandidate(): QuietRecallCandidate | null;
    /** Open the existing Quiet Recall detail surface from the Bubble nudge. */
    onQuietRecallView(candidate: QuietRecallBubbleNudge): void;
    /** Link the current note and this Quiet Recall candidate. */
    onQuietRecallLink(candidate: QuietRecallBubbleNudge): void;
    /** Suppress this Quiet Recall nudge candidate for the local session. */
    onQuietRecallDismiss(candidate: QuietRecallBubbleNudge): void;
    /** Snooze this Quiet Recall nudge candidate without saving or enqueuing it. */
    onQuietRecallLater(candidate: QuietRecallBubbleNudge): void;
    getPatternDetectionNudge(): PatternDetectionResult | null;
    onPatternDetectionView(result: PatternDetectionResult): void;
    onPatternDetectionDismiss(result: PatternDetectionResult): void;
    getPreparedRecapCandidate(): (DeliveryCandidate & { kind: "recap" }) | null;
    /** Return a prepared Recap only when this specific high-value nudge is pending. */
    getPreparedRecapNudgeCandidate(): (DeliveryCandidate & { kind: "recap" }) | null;
    onPreparedRecapView(candidate: DeliveryCandidate & { kind: "recap" }): void;
    onPreparedRecapLater(candidate: DeliveryCandidate & { kind: "recap" }): void;
    /** Return count of recall candidates that were evaluated but judged unconvincing by LLM. */
    getUnconvincingRecallCount(): number;
}

// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------

export class BubbleCoordinator {
    constructor(
        private readonly host: PageletHost,
        _preloadCache: PreloadCache,
        private readonly proactiveHints: ProactiveHints,
        private readonly callbacks: BubbleCoordinatorCallbacks,
    ) {}

    private memoryReadySnapshot: boolean | null = null;
    private memoryReadinessRefreshInFlight = false;
    private lastAnchorEl: HTMLElement | null = null;
    private discoverRunId = 0;
    private discoverInFlightKey: string | null = null;

    destroy(): void {
        this.lastAnchorEl = null;
        this.discoverInFlightKey = null;
        this.memoryReadySnapshot = null;
    }

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
            this.invalidateDiscoverRun();
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

    private buildStateCallbacks(bubbleView: BubbleView): BubbleStateCallbacks {
        return {
            onExpandPanel: (type) => this.callbacks.onExpandPanel(type ?? ""),
            onSourceClick: (link) => this.callbacks.onSourceClick(link),
            onDismiss: () => {
                this.invalidateDiscoverRun();
                bubbleView.close();
                this.callbacks.onDismiss();
            },
            onReviewCurrentNote: () => {
                bubbleView.close();
                this.callbacks.onReviewCurrentNote();
            },
            onDiscoverConnections: () => {
                void this.handleDiscoverFromBubble(bubbleView);
            },
            onPrepareMemory: () => {
                bubbleView.close();
                void Promise.resolve(this.host.prepareMemoryForPagelet()).catch((error) => {
                    this.host.log("Pagelet Memory preparation failed", error);
                });
            },
            onQuickCapture: () => {
                bubbleView.close();
                this.host.openQuickCapture();
            },
            onOpenSettings: () => {
                bubbleView.close();
                this.host.openPageletSettings();
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
        options: { preserveFocus?: boolean } = {},
    ): void {
        const anchorEl = petView?.rootEl;
        if (!bubbleView || !anchorEl) return;
        this.invalidateDiscoverRun();
        this.lastAnchorEl = anchorEl;

        const locale = getPageletUiLanguage();
        const stateCallbacks = this.buildStateCallbacks(bubbleView);
        this.refreshMemoryReadinessSnapshot(bubbleView, petView);

        let content: BubbleContent;
        const preparedRecap = this.callbacks.getPreparedRecapCandidate();
        if (preparedRecap) {
            content = buildPreparedRecapDeliveryContent(preparedRecap, {
                onViewRecap: (candidate) => {
                    bubbleView.close();
                    this.callbacks.onPreparedRecapView(candidate);
                },
                onLater: (candidate) => {
                    bubbleView.close();
                    this.callbacks.onPreparedRecapLater(candidate);
                },
            }, locale);
        } else {
            content = this.buildRegularBubbleContent(bubbleView, stateCallbacks, locale);
        }
        this.applyInlineHint(content, locale);
        this.applyContextAction(content, bubbleView, locale);

        bubbleView.show(content, anchorEl, options);
        this.acknowledgeIntentionallyQuietIfNeeded(content);
    }

    private buildRegularBubbleContent(
        bubbleView: BubbleView,
        callbacks: BubbleStateCallbacks,
        locale: ReturnType<typeof getPageletUiLanguage>,
    ): BubbleContent {
        const onboardingContent = buildOnboardingNudgeContent({
            pageletEnabled: this.host.settings.pagelet.enabled,
            proactiveHints: this.host.settings.pagelet.proactiveHints,
            quietHoursActive: this.proactiveHints.quietHoursActive,
            nudge: this.callbacks.getOnboardingNudge(),
        }, {
            onDismiss: (nudge) => {
                callbacks.onDismiss();
                this.callbacks.onOnboardingNudgeDismiss(nudge);
            },
        }, locale);

        if (onboardingContent) return onboardingContent;

        const quietRecallCandidate = this.callbacks.getQuietRecallCandidate();
        const quietRecallNudge = this.callbacks.getQuietRecallNudge();
        const quietRecallDeliveryCandidate = quietRecallCandidate
            ? quietRecallCandidateToDeliveryCandidate(quietRecallCandidate)
            : null;
        const eligibleQuietRecallNudge = quietRecallDeliveryCandidate
            ? quietRecallNudge
            : null;
        if (
            quietRecallDeliveryCandidate
            && eligibleQuietRecallNudge
            && this.host.settings.pagelet.enabled
            && this.host.settings.quietRecall.enabled
            && this.host.settings.quietRecall.bubbleNudgesEnabled
            && this.host.settings.pagelet.proactiveHints
            && !this.proactiveHints.quietHoursActive
        ) {
            const linkTargetPath = quietRecallLinkTargetPath(
                quietRecallCandidate,
                eligibleQuietRecallNudge.currentPath,
            );
            const quietRecallContent = buildRecallDeliveryContent(quietRecallDeliveryCandidate, {
                onOpen: () => {
                    bubbleView.close();
                    this.callbacks.onQuietRecallView(eligibleQuietRecallNudge);
                },
                ...(linkTargetPath ? {
                    onLinkToCurrent: () => {
                        bubbleView.close();
                        this.callbacks.onQuietRecallLink(eligibleQuietRecallNudge);
                    },
                } : {}),
                onLater: () => {
                    bubbleView.close();
                    this.callbacks.onQuietRecallLater(eligibleQuietRecallNudge);
                },
            }, locale);
            if (eligibleQuietRecallNudge.onboardingExplanation) {
                quietRecallContent.inlineHint = {
                    text: quietRecallContent.inlineHint?.text
                        ?? pageletT("pagelet.onboarding.quietRecall", locale),
                    icon: "info",
                };
            }
            return quietRecallContent;
        }

        const quietRecallContent = buildQuietRecallNudgeContent({
            pageletEnabled: this.host.settings.pagelet.enabled,
            quietRecallEnabled: this.host.settings.quietRecall.enabled,
            bubbleNudgesEnabled: this.host.settings.quietRecall.bubbleNudgesEnabled,
            proactiveHints: this.host.settings.pagelet.proactiveHints,
            quietHoursActive: this.proactiveHints.quietHoursActive,
            candidate: eligibleQuietRecallNudge,
        }, {
            onView: (candidate) => {
                bubbleView.close();
                this.callbacks.onQuietRecallView(candidate);
            },
            ...(quietRecallLinkTargetPath(quietRecallCandidate, quietRecallNudge?.currentPath) ? {
                onLink: (candidate: QuietRecallBubbleNudge) => {
                    bubbleView.close();
                    this.callbacks.onQuietRecallLink(candidate);
                },
            } : {}),
            onDismiss: (candidate) => {
                bubbleView.close();
                this.callbacks.onQuietRecallDismiss(candidate);
            },
            onLater: (candidate) => {
                bubbleView.close();
                this.callbacks.onQuietRecallLater(candidate);
            },
        }, locale);

        if (quietRecallContent) return quietRecallContent;

        const patternContent = buildPatternDetectionNudgeContent({
            pageletEnabled: this.host.settings.pagelet.enabled,
            proactiveHints: this.host.settings.pagelet.proactiveHints,
            quietHoursActive: this.proactiveHints.quietHoursActive,
            result: this.callbacks.getPatternDetectionNudge(),
        }, {
            onView: (result) => {
                callbacks.onDismiss();
                this.callbacks.onPatternDetectionView(result);
            },
            onDismiss: (result) => {
                callbacks.onDismiss();
                this.callbacks.onPatternDetectionDismiss(result);
            },
        }, locale);

        return patternContent ?? this.buildExplanationContent(callbacks, locale);
    }

    private buildExplanationContent(
        callbacks: BubbleStateCallbacks,
        locale: ReturnType<typeof getPageletUiLanguage>,
    ): BubbleContent {
        const state = resolveBubbleExplanationState(this.buildStateContext());
        switch (state) {
            case "needs-setup":
                return buildNeedsSetupContent(callbacks, locale);
            case "preparing":
                return buildPreparingContent(this.memoryPreparationProgress(), locale);
            case "context-limited-short":
                return buildContextLimitedContent("short", callbacks, locale);
            case "context-limited-boundary":
                return buildContextLimitedContent("boundary", callbacks, locale);
            case "intentionally-quiet":
                return buildIntentionallyQuietContent(
                    callbacks,
                    this.host.settings.pagelet.quietAcknowledged,
                    locale,
                );
            case "ready-empty":
            default:
                return buildReadyEmptyContent(callbacks, locale);
        }
    }

    private buildStateContext(): Parameters<typeof resolveBubbleExplanationState>[0] {
        const activeFile = this.host.app?.workspace?.getActiveFile?.() as
            | { path?: string; extension?: string; stat?: { size?: number } }
            | null
            | undefined;
        const path = typeof activeFile?.path === "string" ? activeFile.path : "";
        const isMarkdownNote = activeFile?.extension === "md";
        const preparationStatus = this.host.getMemoryPreparationStatus?.() ?? null;
        return {
            memoryReady: this.memoryReadySnapshot ?? false,
            memoryPreparing: Boolean(preparationStatus),
            proactiveHintsEnabled: this.host.settings.pagelet.proactiveHints,
            isMarkdownNote,
            noteContentLength: typeof activeFile?.stat?.size === "number" ? activeFile.stat.size : 0,
            isDataBoundaryExcluded: isMarkdownNote && path.length > 0
                ? !this.host.isPathAllowedForPagelet(path)
                : false,
            pageletEnabled: this.host.settings.pagelet.enabled,
        };
    }

    private memoryPreparationProgress(): { current: number; total: number } | null {
        const status = this.host.getMemoryPreparationStatus?.() ?? null;
        if (!status) return null;
        const total = status.filesTotal ?? status.chunksTotal;
        const current = status.filesDone ?? status.chunksEmbedded;
        if (typeof total !== "number" || total <= 0) return null;
        if (typeof current !== "number" || current < 0) return null;
        return { current, total };
    }

    private applyInlineHint(
        content: BubbleContent,
        locale: ReturnType<typeof getPageletUiLanguage>,
    ): void {
        if (!this.isDeliveryContent(content)) return;
        if (!this.host.getMemoryPreparationStatus?.()) return;
        if (content.inlineHint) return;
        content.inlineHint = this.memoryPreparingInlineHint(locale);
    }

    private isDeliveryContent(content: BubbleContent): boolean {
        return content.type === "recall-delivery"
            || content.type === "recap-delivery"
            || content.type === "pattern-delivery"
            || content.type === "quick-review";
    }

    private memoryPreparingInlineHint(locale: ReturnType<typeof getPageletUiLanguage>): InlineContextHint {
        return {
            text: pageletT("pagelet.bubble.inlineHint.preparing", locale),
            icon: "info",
        };
    }

    private applyContextAction(
        content: BubbleContent,
        bubbleView: BubbleView,
        locale: ReturnType<typeof getPageletUiLanguage>,
    ): void {
        const unconvincingCount = this.callbacks.getUnconvincingRecallCount();
        if (unconvincingCount <= 0) return;
        content.contextAction = {
            label: pageletT(
                unconvincingCount === 1
                    ? "pagelet.bubble.contextAction.relatedNote"
                    : "pagelet.bubble.contextAction.relatedNotes",
                locale,
                { count: unconvincingCount },
            ),
            action: "discover",
            callback: () => {
                bubbleView.close();
                this.callbacks.onQuietRecallDiscoverOnly();
            },
        };
    }

    private acknowledgeIntentionallyQuietIfNeeded(content: BubbleContent): void {
        if (content.type !== "intentionally-quiet") return;
        if (this.host.settings.pagelet.quietAcknowledged) return;
        this.host.updatePageletSetting("quietAcknowledged", true);
    }

    private refreshMemoryReadinessSnapshot(
        bubbleView: BubbleView,
        petView: PetView | null,
    ): void {
        if (this.memoryReadinessRefreshInFlight) return;
        this.memoryReadinessRefreshInFlight = true;
        void this.host.isMemoryReadyForPageletDiscovery()
            .then((ready) => {
                const changed = this.memoryReadySnapshot !== ready;
                this.memoryReadySnapshot = ready;
                if (changed && bubbleView.bubbleState === "visible") {
                    this.showBubble(bubbleView, petView, { preserveFocus: true });
                }
            })
            .catch((error) => {
                this.host.log("Pagelet Memory readiness refresh failed", error);
            })
            .finally(() => {
                this.memoryReadinessRefreshInFlight = false;
            });
    }

    private async handleDiscoverFromBubble(bubbleView: BubbleView): Promise<void> {
        const anchorEl = this.currentBubbleAnchor();
        if (!anchorEl) {
            this.callbacks.onDiscoverConnections();
            return;
        }
        const expectedPath = this.currentActivePath();
        const runKey = expectedPath ?? "__no-active-path__";
        const locale = getPageletUiLanguage();
        bubbleView.show({
            type: "ready-empty",
            findings: [{ text: pageletT("pagelet.bubble.discover.loading", locale) }],
            actions: [],
        }, anchorEl);

        if (this.discoverInFlightKey === runKey) return;

        const runId = ++this.discoverRunId;
        this.discoverInFlightKey = runKey;
        const canPublish = (): boolean => {
            if (runId !== this.discoverRunId) return false;
            if (bubbleView.bubbleState !== "visible") return false;
            return !expectedPath || this.currentActivePath() === expectedPath;
        };
        const closeIfStale = (): void => {
            if (runId !== this.discoverRunId) return;
            if (bubbleView.bubbleState === "visible") bubbleView.close();
        };

        try {
            const recall = await this.host.runQuietRecall();
            if (!canPublish() || this.host.isQuietRecallRunCurrent?.(recall) === false) {
                closeIfStale();
                return;
            }
            const aiCandidates = recall.candidates
                .flatMap((candidate) => {
                    const delivery = quietRecallCandidateToDeliveryCandidate(candidate);
                    return delivery ? [delivery] : [];
                })
                .slice(0, 3);
            const localCandidate = aiCandidates.length === 0
                ? (recall.discoverCandidates ?? recall.candidates)
                    .filter((candidate) => (
                        candidate.score >= QUIET_RECALL_BUBBLE_MIN_SCORE
                        && candidate.sourceRefs.length > 0
                    ))
                    .map((candidate) => quietRecallCandidateToDiscoveryCandidate(candidate))
                    .find((candidate) => candidate !== null) ?? null
                : null;
            if (aiCandidates.length === 0 && !localCandidate) {
                if (!canPublish()) {
                    closeIfStale();
                    return;
                }
                bubbleView.show({
                    type: "ready-empty",
                    findings: [{ text: pageletT("pagelet.bubble.discover.noResults", locale) }],
                    actions: [buildReadyEmptyContent(this.buildStateCallbacks(bubbleView), locale).actions[0]],
                }, anchorEl);
                return;
            }
            const content = localCandidate
                ? buildLocalDiscoveryClueContent(localCandidate, {
                    onOpen: (candidate) => {
                        const sourcePath = candidate.sourceRefs[0]?.path;
                        bubbleView.close();
                        if (sourcePath) this.callbacks.onSourceClick(sourcePath);
                    },
                    onLinkToCurrent: (candidate) => {
                        const currentPath = expectedPath;
                        const linkTargetPath = quietRecallLinkTargetPath(candidate, currentPath);
                        if (currentPath && linkTargetPath) {
                            bubbleView.close();
                            void this.host.linkRecallCandidate(currentPath, linkTargetPath).catch((error) => {
                                this.host.log("Pagelet Bubble local clue link failed", error);
                            });
                        }
                    },
                    canLinkToCurrent: (candidate) => (
                        quietRecallLinkTargetPath(candidate, expectedPath) !== null
                    ),
                    onLater: () => {
                        bubbleView.close();
                    },
                }, locale)
                : buildRecallDeliveryStackContent(aiCandidates, {
                    onOpen: (candidate) => {
                        const sourcePath = candidate.sourceRefs[0]?.path;
                        bubbleView.close();
                        if (sourcePath) this.callbacks.onSourceClick(sourcePath);
                    },
                    onLinkToCurrent: (candidate) => {
                        const currentPath = expectedPath;
                        const linkTargetPath = quietRecallLinkTargetPath(candidate, currentPath);
                        if (currentPath && linkTargetPath) {
                            bubbleView.close();
                            void this.host.linkRecallCandidate(currentPath, linkTargetPath).catch((error) => {
                                this.host.log("Pagelet Bubble recall link failed", error);
                            });
                        }
                    },
                    canLinkToCurrent: (candidate) => (
                        quietRecallLinkTargetPath(candidate, expectedPath) !== null
                    ),
                    onLater: () => {
                        bubbleView.close();
                    },
                }, locale);
            this.applyInlineHint(content, locale);
            if (!canPublish()) {
                closeIfStale();
                return;
            }
            bubbleView.show(content, anchorEl);
        } catch (error) {
            if (!canPublish()) {
                closeIfStale();
                return;
            }
            this.host.log("Pagelet Bubble discover recall failed", error);
            this.callbacks.onDiscoverConnections();
        } finally {
            if (runId === this.discoverRunId) {
                this.discoverInFlightKey = null;
            }
        }
    }

    private currentBubbleAnchor(): HTMLElement | null {
        return this.lastAnchorEl;
    }

    private invalidateDiscoverRun(): void {
        this.discoverRunId += 1;
        this.discoverInFlightKey = null;
    }

    private currentActivePath(): string | null {
        const file = this.host.app?.workspace?.getActiveFile?.() as { path?: string } | null | undefined;
        return typeof file?.path === "string" ? file.path : null;
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
        this.invalidateDiscoverRun();
        this.lastAnchorEl = anchorEl;

        const locale = getPageletUiLanguage();
        const stateCallbacks = this.buildStateCallbacks(bubbleView);
        this.refreshMemoryReadinessSnapshot(bubbleView, petView);
        const preparedRecap = this.callbacks.getPreparedRecapNudgeCandidate();
        const content = preparedRecap
            ? buildPreparedRecapDeliveryContent(preparedRecap, {
                onViewRecap: (candidate) => {
                    bubbleView.close();
                    this.callbacks.onPreparedRecapView(candidate);
                },
                onLater: (candidate) => {
                    bubbleView.close();
                    this.callbacks.onPreparedRecapLater(candidate);
                },
            }, locale)
            : this.buildRegularBubbleContent(bubbleView, stateCallbacks, locale);
        this.applyInlineHint(content, locale);

        bubbleView.show(content, anchorEl);
        this.acknowledgeIntentionallyQuietIfNeeded(content);
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
        this.lastAnchorEl = anchorEl;

        const locale = getPageletUiLanguage();
        const stateCallbacks = this.buildStateCallbacks(bubbleView);

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
            const content = buildEmptyContent(stateCallbacks, locale);
            bubbleView.show(content, anchorEl);
        }
    }
}
