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
import { buildContextLimitedContent, buildEmptyContent, buildIntentionallyQuietContent, buildLocalDiscoveryClueContent, buildNeedsSetupContent, buildOnboardingNudgeContent, buildPatternDetectionNudgeContent, buildPreparedRecapDeliveryContent, buildPreparingContent, buildProactiveRecallDeliveryContent, buildRecallDeliveryStackContent, buildReadyEmptyContent, buildWritingAssistContent, type OnboardingNudge } from "./bubble/BubbleContent";
import { quietRecallCandidateToDeliveryCandidate, quietRecallCandidateToDiscoveryCandidate } from "./bubble/recall-card";
import { resolveBubbleExplanationState } from "./bubble/state-resolver";
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
    /** Keep this Quiet Recall candidate for later through the existing Review Queue. */
    onQuietRecallLater(candidate: QuietRecallBubbleNudge): void;
    getPatternDetectionNudge(): PatternDetectionResult | null;
    onPatternDetectionView(result: PatternDetectionResult): void;
    onPatternDetectionDismiss(result: PatternDetectionResult): void;
    getPreparedRecapCandidate(): (DeliveryCandidate & { kind: "recap" }) | null;
    /** Return only explicitly admitted proactive tickets; raw payloads stay separate. */
    getAdmittedNudgeTickets(): readonly NudgeTicket[];
    onPreparedRecapView(candidate: DeliveryCandidate & { kind: "recap" }): void;
    onPreparedRecapLater(candidate: DeliveryCandidate & { kind: "recap" }): void;
    /** Commit one-shot presentation state only after Bubble.show succeeds. */
    onNudgePresented(ticket: NudgeTicket): void;
    /** Return count of recall candidates that were evaluated but judged unconvincing by LLM. */
    getUnconvincingRecallCount(): number;
}

/** Explicit ownership for a renderable proactive nudge ticket. */
export enum NudgeOwner {
    PreparedRecap = "prepared-recap",
    QuietRecall = "quiet-recall",
    Pattern = "pattern",
    Onboarding = "onboarding",
}

export type NudgeTicket =
    | {
        key: string;
        owner: NudgeOwner.PreparedRecap;
        candidate: DeliveryCandidate & { kind: "recap" };
    }
    | {
        key: string;
        owner: NudgeOwner.QuietRecall;
        candidate: QuietRecallCandidate;
        deliveryCandidate: DeliveryCandidate & { kind: "recall" };
        nudge: QuietRecallBubbleNudge;
    }
    | {
        key: string;
        owner: NudgeOwner.Pattern;
        result: PatternDetectionResult;
    }
    | {
        key: string;
        owner: NudgeOwner.Onboarding;
        nudge: OnboardingNudge;
    };

interface BubblePresentation {
    content: BubbleContent;
    ticket: NudgeTicket | null;
}

// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------

export class BubbleCoordinator {
    constructor(
        private readonly host: PageletHost,
        private readonly proactiveHints: ProactiveHints,
        private readonly callbacks: BubbleCoordinatorCallbacks,
    ) {}

    private memoryReadySnapshot: boolean | null = null;
    private memoryReadinessRefreshInFlight = false;
    private lastAnchorEl: HTMLElement | null = null;
    private discoverRunId = 0;
    private discoverInFlightKey: string | null = null;
    private pendingNudgeTicket: NudgeTicket | null = null;
    private activeNudgeTicket: NudgeTicket | null = null;
    private readonly presentedNudgeKeys = new Set<string>();
    private nudgeWakeTimer: ReturnType<typeof setTimeout> | null = null;
    private nudgeWakeAt: number | null = null;
    private lastBubbleView: BubbleView | null = null;
    private lastPetView: PetView | null = null;

    destroy(): void {
        this.lastAnchorEl = null;
        this.discoverInFlightKey = null;
        this.memoryReadySnapshot = null;
        this.pendingNudgeTicket = null;
        this.activeNudgeTicket = null;
        this.presentedNudgeKeys.clear();
        this.clearNudgeWakeTimer();
        this.lastBubbleView = null;
        this.lastPetView = null;
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
            // A failed/no-op show must not lose the still-pending ticket when
            // user-interact settles the Pet back to idle. Visible shows return
            // without forcing, so this does not create an immediate re-nudge.
            this.reconcileNudge(bubbleView, petView);
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

        const admittedTickets = this.sortNudgeTickets(
            this.collectAdmittedNudgeTickets().filter((ticket) => this.ticketRuntimeEnabled(ticket)),
        );
        let presentation: BubblePresentation;
        const preparedRecap = this.callbacks.getPreparedRecapCandidate();
        if (preparedRecap) {
            presentation = {
                content: buildPreparedRecapDeliveryContent(preparedRecap, {
                    onViewRecap: (candidate) => {
                        bubbleView.close();
                        this.callbacks.onPreparedRecapView(candidate);
                    },
                    onLater: (candidate) => {
                        bubbleView.close();
                        this.callbacks.onPreparedRecapLater(candidate);
                    },
                }, locale),
                ticket: admittedTickets.find((ticket) => (
                    ticket.owner === NudgeOwner.PreparedRecap
                    && ticket.candidate.id === preparedRecap.id
                )) ?? null,
            };
        } else {
            presentation = this.buildRegularBubbleContent(
                bubbleView,
                stateCallbacks,
                locale,
                admittedTickets,
            );
        }
        const { content, ticket } = presentation;
        this.applyInlineHint(content, locale);
        this.applyContextAction(content, bubbleView, locale);

        bubbleView.show(content, anchorEl, options);
        if (ticket && bubbleView.bubbleState === "visible") {
            this.recordNudgePresented(ticket);
        }
        this.acknowledgeIntentionallyQuietIfNeeded(content);
    }

    private buildRegularBubbleContent(
        bubbleView: BubbleView,
        callbacks: BubbleStateCallbacks,
        locale: ReturnType<typeof getPageletUiLanguage>,
        admittedTickets: NudgeTicket[],
    ): BubblePresentation {
        // Deterministic compatibility fallback for Tier-3 payloads without a
        // shared quality score: real delivery before the onboarding bridge.
        const quietRecallContent = this.buildQuietRecallNudgeContent(bubbleView, locale);
        if (quietRecallContent) {
            const nudge = this.callbacks.getQuietRecallNudge();
            return {
                content: quietRecallContent,
                ticket: admittedTickets.find((ticket) => (
                    ticket.owner === NudgeOwner.QuietRecall
                    && ticket.nudge.candidateId === nudge?.candidateId
                )) ?? null,
            };
        }
        const patternContent = this.buildPatternNudgeContent(callbacks, locale);
        if (patternContent) {
            const pattern = this.callbacks.getPatternDetectionNudge();
            return {
                content: patternContent,
                ticket: admittedTickets.find((ticket) => (
                    ticket.owner === NudgeOwner.Pattern
                    && ticket.result.generatedAt === pattern?.generatedAt
                )) ?? null,
            };
        }
        const onboardingContent = this.buildOnboardingNudgeContent(callbacks, locale);
        if (onboardingContent) {
            const onboarding = this.callbacks.getOnboardingNudge();
            return {
                content: onboardingContent,
                ticket: admittedTickets.find((ticket) => (
                    ticket.owner === NudgeOwner.Onboarding
                    && ticket.nudge.kind === onboarding?.kind
                    && ticket.nudge.generatedAt === onboarding?.generatedAt
                )) ?? null,
            };
        }
        return {
            content: this.buildExplanationContent(callbacks, locale),
            ticket: null,
        };
    }

    private buildOnboardingNudgeContent(
        callbacks: BubbleStateCallbacks,
        locale: ReturnType<typeof getPageletUiLanguage>,
    ): BubbleContent | null {
        return buildOnboardingNudgeContent({
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
    }

    private eligibleQuietRecallNudge(): {
        candidate: QuietRecallCandidate;
        deliveryCandidate: DeliveryCandidate & { kind: "recall" };
        nudge: QuietRecallBubbleNudge;
    } | null {
        const candidate = this.callbacks.getQuietRecallCandidate();
        const nudge = this.callbacks.getQuietRecallNudge();
        const deliveryCandidate = candidate
            ? quietRecallCandidateToDeliveryCandidate(candidate)
            : null;
        if (
            !candidate
            || !deliveryCandidate
            || !nudge
            || !this.host.settings.pagelet.enabled
            || !this.host.settings.quietRecall.enabled
            || this.host.settings.quietRecall.quietRecallMode !== "on"
            || this.proactiveHints.quietHoursActive
        ) return null;
        return { candidate, deliveryCandidate, nudge };
    }

    private buildQuietRecallNudgeContent(
        bubbleView: BubbleView,
        locale: ReturnType<typeof getPageletUiLanguage>,
    ): BubbleContent | null {
        const eligible = this.eligibleQuietRecallNudge();
        if (!eligible) return null;
        const content = buildProactiveRecallDeliveryContent(eligible.deliveryCandidate, {
            onView: () => {
                bubbleView.close();
                this.callbacks.onQuietRecallView(eligible.nudge);
            },
            onLater: () => {
                this.callbacks.onQuietRecallLater(eligible.nudge);
            },
            onDismiss: () => {
                bubbleView.close();
                this.callbacks.onQuietRecallDismiss(eligible.nudge);
            },
        }, locale);
        if (eligible.nudge.onboardingExplanation) {
            content.inlineHint = {
                text: content.inlineHint?.text
                    ?? pageletT("pagelet.onboarding.quietRecall", locale),
                icon: "info",
            };
        }
        return content;
    }

    private buildPatternNudgeContent(
        callbacks: BubbleStateCallbacks,
        locale: ReturnType<typeof getPageletUiLanguage>,
    ): BubbleContent | null {
        return buildPatternDetectionNudgeContent({
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
    ): NudgeOwner | null {
        const anchorEl = petView?.rootEl;
        if (!bubbleView || !anchorEl) return null;
        this.invalidateDiscoverRun();
        this.lastAnchorEl = anchorEl;
        this.reconcileNudge(bubbleView, petView);

        const locale = getPageletUiLanguage();
        const stateCallbacks = this.buildStateCallbacks(bubbleView);
        let ticket = this.pendingNudgeTicket;
        if (!ticket || !this.currentNudgeTickets().some((candidate) => candidate.key === ticket?.key)) {
            this.pendingNudgeTicket = null;
            this.reconcileNudge(bubbleView, petView);
            ticket = this.pendingNudgeTicket;
        }
        if (!ticket) return null;
        const content = this.buildTicketContent(ticket, bubbleView, stateCallbacks, locale);
        if (!content) {
            this.pendingNudgeTicket = null;
            this.reconcileNudge(bubbleView, petView);
            return null;
        }
        this.applyInlineHint(content, locale);
        bubbleView.show(content, anchorEl);
        if (bubbleView.bubbleState !== "visible") return null;

        this.recordNudgePresented(ticket);
        return ticket.owner;
    }

    /** Single accounting seam for nudge-click and command/regular presentation. */
    private recordNudgePresented(ticket: NudgeTicket): void {
        if (this.presentedNudgeKeys.has(ticket.key)) return;
        if (this.pendingNudgeTicket?.key === ticket.key) this.pendingNudgeTicket = null;
        this.activeNudgeTicket = ticket;
        this.presentedNudgeKeys.add(ticket.key);
        if (this.usesSharedCooldown(ticket.owner)) {
            // Admission ownership lives outside the old global pending bit, so
            // presentation must advance the clock even if a generic toggle
            // cleared that bit after this ticket was admitted.
            this.proactiveHints.recordHintPresented();
        }
        this.callbacks.onNudgePresented(ticket);
    }

    /** Reconcile renderable tickets without pre-empting work or a visible Bubble. */
    reconcileNudge(
        bubbleView: BubbleView | null,
        petView: PetView | null,
    ): void {
        if (bubbleView) this.lastBubbleView = bubbleView;
        if (!this.nudgeSurfaceAvailable(petView)) {
            if (petView?.rootEl && petView.stateMachine.state === "nudge") {
                petView.stateMachine.forceState("idle");
            }
            this.lastPetView = null;
            this.pendingNudgeTicket = null;
            this.activeNudgeTicket = null;
            this.clearNudgeWakeTimer();
            return;
        }
        if (!petView) return;
        this.lastPetView = petView;
        const tickets = this.currentNudgeTickets();
        this.scheduleDeferredSharedWake();

        const currentPending = this.pendingNudgeTicket
            ? tickets.find((ticket) => ticket.key === this.pendingNudgeTicket?.key) ?? null
            : null;
        const preferred = tickets[0] ?? null;
        if (!currentPending) {
            this.pendingNudgeTicket = preferred;
        } else if (
            currentPending.owner === NudgeOwner.Onboarding
            && preferred
            && preferred.owner !== NudgeOwner.Onboarding
        ) {
            // A real delivery may replace an unpresented onboarding bridge.
            this.pendingNudgeTicket = preferred;
        } else {
            this.pendingNudgeTicket = currentPending;
        }

        if (bubbleView?.bubbleState === "visible" || this.activeNudgeTicket) return;
        if (!this.pendingNudgeTicket) {
            if (petView.stateMachine.state === "nudge") petView.stateMachine.forceState("idle");
            return;
        }
        if (petView.stateMachine.state === "working") return;
        if (petView.stateMachine.state !== "nudge") petView.stateMachine.forceState("nudge");
    }

    /** Called by BubbleView's single close seam after any visible close path. */
    handleBubbleClosed(
        bubbleView: BubbleView | null,
        petView: PetView | null,
    ): void {
        this.activeNudgeTicket = null;
        this.reconcileNudge(bubbleView, petView);
    }

    private currentNudgeTickets(): NudgeTicket[] {
        const admitted = this.collectAdmittedNudgeTickets();
        const shared = admitted.filter((ticket) => (
            this.usesSharedCooldown(ticket.owner)
            && this.ticketRuntimeEnabled(ticket)
        ));
        const sharedDelay = this.sharedPresentationDelay(shared);
        return this.sortNudgeTickets(admitted.filter((ticket) => {
            if (!this.ticketRuntimeEnabled(ticket)) return false;
            if (!this.usesSharedCooldown(ticket.owner)) {
                return !this.proactiveHints.quietHoursActive;
            }
            return sharedDelay === 0;
        }));
    }

    private collectAdmittedNudgeTickets(): NudgeTicket[] {
        const seen = new Set<string>();
        return this.callbacks.getAdmittedNudgeTickets().filter((ticket) => {
            if (seen.has(ticket.key) || this.presentedNudgeKeys.has(ticket.key)) return false;
            seen.add(ticket.key);
            if (ticket.owner === NudgeOwner.QuietRecall) {
                return ticket.candidate.id === ticket.nudge.candidateId
                    && ticket.deliveryCandidate.id === ticket.candidate.id;
            }
            if (ticket.owner === NudgeOwner.Pattern) return ticket.result.totalCount > 0;
            return true;
        });
    }

    private sortNudgeTickets(tickets: NudgeTicket[]): NudgeTicket[] {
        // Deterministic compatibility fallback while Tier-3 candidates have no
        // cross-type quality score. This is not a fixed product priority.
        const compatibilityOrder: Record<NudgeOwner, number> = {
            [NudgeOwner.PreparedRecap]: 0,
            [NudgeOwner.QuietRecall]: 1,
            [NudgeOwner.Pattern]: 2,
            [NudgeOwner.Onboarding]: 3,
        };
        return [...tickets].sort(
            (left, right) => compatibilityOrder[left.owner] - compatibilityOrder[right.owner],
        );
    }

    private ticketRuntimeEnabled(ticket: NudgeTicket): boolean {
        if (!this.host.settings.pagelet.enabled || this.host.settings.focusMode) return false;
        if (this.host.settings.pagelet.petVisible === false) return false;
        switch (ticket.owner) {
            case NudgeOwner.PreparedRecap:
                return this.host.settings.pagelet.scopeRecapHighValueHints !== false;
            case NudgeOwner.QuietRecall:
                return this.host.settings.quietRecall.enabled
                    && this.host.settings.quietRecall.quietRecallMode === "on";
            case NudgeOwner.Pattern:
            case NudgeOwner.Onboarding:
                return this.host.settings.pagelet.proactiveHints && this.proactiveHints.enabled;
        }
    }

    private nudgeSurfaceAvailable(petView: PetView | null): boolean {
        return Boolean(
            petView?.rootEl
            && this.host.settings.pagelet.enabled
            && this.host.settings.pagelet.petVisible !== false
            && !this.host.settings.focusMode,
        );
    }

    private sharedPresentationDelay(tickets: NudgeTicket[]): number | null {
        if (tickets.length === 0) return null;
        const enabled = tickets.some((ticket) => ticket.owner === NudgeOwner.PreparedRecap)
            || (this.host.settings.pagelet.proactiveHints && this.proactiveHints.enabled);
        return this.proactiveHints.delayUntilEligibleMs({ enabled });
    }

    private buildTicketContent(
        ticket: NudgeTicket,
        bubbleView: BubbleView,
        callbacks: BubbleStateCallbacks,
        locale: ReturnType<typeof getPageletUiLanguage>,
    ): BubbleContent | null {
        switch (ticket.owner) {
            case NudgeOwner.PreparedRecap:
                return buildPreparedRecapDeliveryContent(ticket.candidate, {
                    onViewRecap: (candidate) => {
                        bubbleView.close();
                        this.callbacks.onPreparedRecapView(candidate);
                    },
                    onLater: (candidate) => {
                        bubbleView.close();
                        this.callbacks.onPreparedRecapLater(candidate);
                    },
                }, locale);
            case NudgeOwner.QuietRecall: {
                const content = buildProactiveRecallDeliveryContent(ticket.deliveryCandidate, {
                    onView: () => {
                        bubbleView.close();
                        this.callbacks.onQuietRecallView(ticket.nudge);
                    },
                    onLater: () => {
                        this.callbacks.onQuietRecallLater(ticket.nudge);
                    },
                    onDismiss: () => {
                        bubbleView.close();
                        this.callbacks.onQuietRecallDismiss(ticket.nudge);
                    },
                }, locale);
                if (ticket.nudge.onboardingExplanation) {
                    content.inlineHint = {
                        text: content.inlineHint?.text
                            ?? pageletT("pagelet.onboarding.quietRecall", locale),
                        icon: "info",
                    };
                }
                return content;
            }
            case NudgeOwner.Pattern:
                return buildPatternDetectionNudgeContent({
                    pageletEnabled: true,
                    proactiveHints: true,
                    quietHoursActive: false,
                    result: ticket.result,
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
            case NudgeOwner.Onboarding:
                return buildOnboardingNudgeContent({
                    pageletEnabled: true,
                    proactiveHints: true,
                    quietHoursActive: false,
                    nudge: ticket.nudge,
                }, {
                    onDismiss: (nudge) => {
                        callbacks.onDismiss();
                        this.callbacks.onOnboardingNudgeDismiss(nudge);
                    },
                }, locale);
        }
    }

    private usesSharedCooldown(owner: NudgeOwner): boolean {
        return owner !== NudgeOwner.QuietRecall;
    }

    private scheduleDeferredSharedWake(): void {
        if (!this.nudgeSurfaceAvailable(this.lastPetView)) {
            this.clearNudgeWakeTimer();
            return;
        }
        const deferred = this.collectAdmittedNudgeTickets().filter((ticket) => (
            this.usesSharedCooldown(ticket.owner)
            && this.ticketRuntimeEnabled(ticket)
        ));
        if (deferred.length === 0) {
            this.clearNudgeWakeTimer();
            return;
        }
        const delay = this.sharedPresentationDelay(deferred);
        if (delay === null || delay <= 0) {
            this.clearNudgeWakeTimer();
            return;
        }
        const wakeAt = Date.now() + Math.max(1, delay);
        if (this.nudgeWakeTimer !== null && this.nudgeWakeAt !== null && this.nudgeWakeAt <= wakeAt) {
            return;
        }
        this.clearNudgeWakeTimer();
        this.nudgeWakeAt = wakeAt;
        this.nudgeWakeTimer = setTimeout(() => {
            this.nudgeWakeTimer = null;
            this.nudgeWakeAt = null;
            this.reconcileNudge(this.lastBubbleView, this.lastPetView);
        }, Math.max(1, delay));
    }

    private clearNudgeWakeTimer(): void {
        if (this.nudgeWakeTimer !== null) clearTimeout(this.nudgeWakeTimer);
        this.nudgeWakeTimer = null;
        this.nudgeWakeAt = null;
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
