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

import type {
    BubbleContent,
    BubbleStateCallbacks,
    DeliveryCandidate,
    InlineContextHint,
} from "./bubble/types";
import type {
    AttentionExplanationKind,
    DeliveryReceipt,
} from "./attention";
import type { BubbleView } from "./bubble/BubbleView";
import { buildAgentInsightDeliveryContent, buildContextLimitedContent, buildIntentionallyQuietContent, buildNeedsSetupContent, buildOnboardingNudgeContent, buildPatternDetectionNudgeContent, buildPreparingContent, buildReadyEmptyContent, type OnboardingNudge } from "./bubble/BubbleContent";
import { resolveBubbleExplanationState } from "./bubble/state-resolver";
import type { ProactiveHints } from "./hints/ProactiveHints";
import type { PetView } from "./pet/PetView";
import type { PageletHost } from "./PageletHost";
import type { PatternDetectionResult } from "../pa";

// ---------------------------------------------------------------------------
// Callbacks the coordinator fires back at the orchestrator
// ---------------------------------------------------------------------------

export interface BubbleCoordinatorCallbacks {
    /** Provider-free reading of the active Markdown note. */
    onReadCurrentNote(): void;
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
    /** Return a one-time onboarding bridge nudge, if pending. */
    getOnboardingNudge(): OnboardingNudge | null;
    /** Dismiss a one-time onboarding bridge nudge. */
    onOnboardingNudgeDismiss(nudge: OnboardingNudge): void;
    getPatternDetectionNudge(): PatternDetectionResult | null;
    onPatternDetectionView(result: PatternDetectionResult): void;
    onPatternDetectionDismiss(result: PatternDetectionResult): void;
    /** Return the latest verified Deep Discover insight, if one is pending. */
    getAgentInsightCandidate?(): (DeliveryCandidate & { kind: "review" }) | null;
    /** Return only explicitly admitted proactive tickets; raw payloads stay separate. */
    getAdmittedNudgeTickets(): readonly NudgeTicket[];
    /** Open the verified free-form insight in the read-only Panel. */
    onAgentInsightView?(candidate: DeliveryCandidate & { kind: "review" }): void;
    /** Keep the insight in the in-memory cache without presenting it again now. */
    onAgentInsightLater?(candidate: DeliveryCandidate & { kind: "review" }): void;
    /** Commit one-shot presentation state only after Bubble.show succeeds. */
    onNudgePresented(ticket: NudgeTicket): void;
    /** Device-local consumption gate for proactive Recall/Recap/Agent insight delivery. */
    isDeliverySeen?(receipt: DeliveryReceipt): boolean;
    /** Commit only after the explanation Bubble actually became visible. */
    onExplanationVisible?(kind: AttentionExplanationKind, copyVersion: string): void;
}

export const READY_EMPTY_EXPLANATION_COPY_VERSION = "ready-empty-v1";
export const INTENTIONALLY_QUIET_EXPLANATION_COPY_VERSION = "intentionally-quiet-v1";

/** Explicit ownership for a renderable proactive nudge ticket. */
export enum NudgeOwner {
    AgentInsight = "agent-insight",
    Pattern = "pattern",
    Onboarding = "onboarding",
}

export type NudgeTicket =
    | {
        key: string;
        owner: NudgeOwner.AgentInsight;
        candidate: DeliveryCandidate & { kind: "review" };
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
    explanationAcknowledgement?: {
        kind: AttentionExplanationKind;
        copyVersion: string;
    };
}

interface MemoryReadinessRefreshRequest {
    bubbleView: BubbleView;
    expectedContent: BubbleContent;
    snapshotAtPresentation: boolean | null;
    epoch: number;
}

type NudgeBubbleShowResult =
    | { status: "shown"; owner: NudgeOwner }
    | { status: "unavailable" }
    | { status: "not-visible" };

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
    private pendingMemoryReadinessRefresh: MemoryReadinessRefreshRequest | null = null;
    private memoryReadinessRefreshEpoch = 0;
    private pendingNudgeTicket: NudgeTicket | null = null;
    private activeNudgeTicket: NudgeTicket | null = null;
    private readonly presentedNudgeKeys = new Set<string>();
    private nudgeWakeTimer: ReturnType<typeof setTimeout> | null = null;
    private nudgeWakeAt: number | null = null;
    private lastBubbleView: BubbleView | null = null;
    private lastPetView: PetView | null = null;
    private suppressNudgeStateForce = false;

    destroy(): void {
        this.memoryReadinessRefreshEpoch += 1;
        this.pendingMemoryReadinessRefresh = null;
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
        this.memoryReadinessRefreshEpoch += 1;
        this.pendingMemoryReadinessRefresh = null;
        petView?.closeActionRing?.(false, "action");
        bubbleView?.close();
        petView?.stateMachine.transition("user-interact");
        this.callbacks.onReadCurrentNote();
    }

    // ======================================================================
    // Bubble content builders
    // ======================================================================

    private buildStateCallbacks(bubbleView: BubbleView): BubbleStateCallbacks {
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
                this.handleDiscoverFromBubble(bubbleView);
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
     * Show the available insight, nudge, or preparation state.
     */
    showBubble(
        bubbleView: BubbleView | null,
        petView: PetView | null,
        options: { preserveFocus?: boolean } = {},
    ): void {
        const anchorEl = petView?.rootEl;
        if (!bubbleView || !anchorEl) return;
        petView.closeActionRing?.(false, "action");

        const locale = getPageletUiLanguage();
        const stateCallbacks = this.buildStateCallbacks(bubbleView);

        const admittedTickets = this.sortNudgeTickets(
            this.collectAdmittedNudgeTickets().filter((ticket) => this.ticketRuntimeEnabled(ticket)),
        );
        let presentation: BubblePresentation;
        const agentInsight = this.callbacks.getAgentInsightCandidate?.() ?? null;
        if (agentInsight) {
            presentation = {
                content: buildAgentInsightDeliveryContent(agentInsight, {
                    onView: (candidate) => {
                        bubbleView.close();
                        this.callbacks.onAgentInsightView?.(candidate);
                    },
                    onLater: (candidate) => {
                        bubbleView.close();
                        this.callbacks.onAgentInsightLater?.(candidate);
                    },
                }, locale),
                ticket: admittedTickets.find((ticket) => (
                    ticket.owner === NudgeOwner.AgentInsight
                    && ticket.candidate.id === agentInsight.id
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
        const { content, ticket, explanationAcknowledgement } = presentation;
        this.applyInlineHint(content, locale);
        bubbleView.show(content, anchorEl, options);
        if (ticket && bubbleView.bubbleState === "visible") {
            this.recordNudgePresented(ticket);
        }
        this.acknowledgeExplanationIfNeeded(explanationAcknowledgement, bubbleView);
        this.refreshMemoryReadinessSnapshot(bubbleView, content);
    }

    private buildRegularBubbleContent(
        bubbleView: BubbleView,
        callbacks: BubbleStateCallbacks,
        locale: ReturnType<typeof getPageletUiLanguage>,
        admittedTickets: NudgeTicket[],
    ): BubblePresentation {
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
        return this.buildExplanationPresentation(callbacks, locale);
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

    private buildExplanationPresentation(
        callbacks: BubbleStateCallbacks,
        locale: ReturnType<typeof getPageletUiLanguage>,
    ): BubblePresentation {
        const state = resolveBubbleExplanationState(this.buildStateContext());
        switch (state) {
            case "needs-setup":
                return {
                    content: buildNeedsSetupContent(callbacks, locale),
                    ticket: null,
                };
            case "preparing":
                return {
                    content: buildPreparingContent(this.memoryPreparationProgress(), locale),
                    ticket: null,
                };
            case "context-limited-short":
                return {
                    content: buildContextLimitedContent("short", callbacks, locale),
                    ticket: null,
                };
            case "context-limited-boundary":
                return {
                    content: buildContextLimitedContent("boundary", callbacks, locale),
                    ticket: null,
                };
            case "intentionally-quiet":
                return {
                    content: buildIntentionallyQuietContent(
                        callbacks,
                        false,
                        locale,
                    ),
                    ticket: null,
                    explanationAcknowledgement: {
                        kind: "intentionally-quiet",
                        copyVersion: INTENTIONALLY_QUIET_EXPLANATION_COPY_VERSION,
                    },
                };
            case "ready-empty":
            default:
                return {
                    content: buildReadyEmptyContent(callbacks, locale),
                    ticket: null,
                    explanationAcknowledgement: {
                        kind: "ready-empty",
                        copyVersion: READY_EMPTY_EXPLANATION_COPY_VERSION,
                    },
                };
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
        return content.type === "review-delivery"
            || content.type === "pattern-delivery";
    }

    private isExplanationContent(content: BubbleContent): boolean {
        return content.type === "needs-setup"
            || content.type === "preparing"
            || content.type === "ready-empty"
            || content.type === "intentionally-quiet"
            || content.type === "context-limited";
    }

    private memoryPreparingInlineHint(locale: ReturnType<typeof getPageletUiLanguage>): InlineContextHint {
        return {
            text: pageletT("pagelet.bubble.inlineHint.preparing", locale),
            icon: "info",
        };
    }

    private acknowledgeExplanationIfNeeded(
        acknowledgement: BubblePresentation["explanationAcknowledgement"],
        bubbleView: BubbleView,
    ): void {
        if (!acknowledgement || bubbleView.bubbleState !== "visible") return;
        this.callbacks.onExplanationVisible?.(
            acknowledgement.kind,
            acknowledgement.copyVersion,
        );
    }

    private refreshMemoryReadinessSnapshot(
        bubbleView: BubbleView,
        expectedContent: BubbleContent,
    ): void {
        const request: MemoryReadinessRefreshRequest = {
            bubbleView,
            expectedContent,
            snapshotAtPresentation: this.memoryReadySnapshot,
            epoch: this.memoryReadinessRefreshEpoch,
        };
        if (this.memoryReadinessRefreshInFlight) {
            // A later Bubble presentation supersedes any older queued one.
            // Re-check it after the active readiness probe settles instead of
            // dropping a newer presentation.
            this.pendingMemoryReadinessRefresh = request;
            return;
        }
        this.runMemoryReadinessRefresh(request);
    }

    private runMemoryReadinessRefresh(
        request: MemoryReadinessRefreshRequest,
    ): void {
        this.memoryReadinessRefreshInFlight = true;
        void this.host.isMemoryReadyForPageletDiscovery()
            .then((ready) => {
                if (request.epoch !== this.memoryReadinessRefreshEpoch) return;
                const presentationIsStale = request.snapshotAtPresentation !== ready;
                this.memoryReadySnapshot = ready;
                const stillShowingExpectedContent = (
                    request.bubbleView.isShowingContent?.(request.expectedContent)
                    ?? request.bubbleView.bubbleState === "visible"
                );
                if (
                    presentationIsStale
                    && stillShowingExpectedContent
                    && this.isExplanationContent(request.expectedContent)
                ) {
                    request.bubbleView.close();
                    this.callbacks.onReadCurrentNote();
                }
            })
            .catch((error) => {
                this.host.log("Pagelet Memory readiness refresh failed", error);
            })
            .finally(() => {
                this.memoryReadinessRefreshInFlight = false;
                const pending = this.pendingMemoryReadinessRefresh;
                this.pendingMemoryReadinessRefresh = null;
                if (pending && pending.epoch === this.memoryReadinessRefreshEpoch) {
                    this.runMemoryReadinessRefresh(pending);
                }
            });
    }

    private handleDiscoverFromBubble(bubbleView: BubbleView): void {
        bubbleView.close();
        this.callbacks.onDiscoverConnections();
    }

    /**
     * Show nudge-specific content when Pet is in nudge state.
     */
    showNudgeBubble(
        bubbleView: BubbleView | null,
        petView: PetView | null,
    ): NudgeBubbleShowResult {
        const anchorEl = petView?.rootEl;
        if (!bubbleView || !anchorEl) return { status: "unavailable" };
        petView?.closeActionRing?.(false, "action");
        this.suppressNudgeStateForce = true;
        try { this.reconcileNudge(bubbleView, petView); }
        finally { this.suppressNudgeStateForce = false; }

        const locale = getPageletUiLanguage();
        const stateCallbacks = this.buildStateCallbacks(bubbleView);
        const ticket = this.pendingNudgeTicket;
        if (!ticket) return { status: "unavailable" };
        const content = this.buildTicketContent(ticket, bubbleView, stateCallbacks, locale);
        if (!content) {
            this.pendingNudgeTicket = null;
            return { status: "unavailable" };
        }
        this.applyInlineHint(content, locale);
        bubbleView.show(content, anchorEl);
        if (bubbleView.bubbleState !== "visible") return { status: "not-visible" };

        this.recordNudgePresented(ticket);
        return { status: "shown", owner: ticket.owner };
    }

    /** Single accounting seam for nudge-click and command/regular presentation. */
    private recordNudgePresented(ticket: NudgeTicket): void {
        if (this.presentedNudgeKeys.has(ticket.key)) return;
        if (this.pendingNudgeTicket?.key === ticket.key) this.pendingNudgeTicket = null;
        this.activeNudgeTicket = ticket;
        this.presentedNudgeKeys.add(ticket.key);
        // Admission ownership lives outside the old global pending bit, so
        // presentation must advance the clock even if a generic toggle
        // cleared that bit after this ticket was admitted.
        this.proactiveHints.recordHintPresented();
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

        if (
            bubbleView?.bubbleState === "visible"
            || this.activeNudgeTicket
            || petView.actionRingOpen
        ) return;
        if (!this.pendingNudgeTicket) {
            if (!this.suppressNudgeStateForce && petView.stateMachine.state === "nudge") {
                petView.stateMachine.forceState("idle");
            }
            return;
        }
        if (petView.stateMachine.state === "working") return;
        if (!this.suppressNudgeStateForce && petView.stateMachine.state !== "nudge") {
            petView.stateMachine.forceState("nudge");
        }
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
        const shared = admitted.filter((ticket) => this.ticketRuntimeEnabled(ticket));
        const sharedDelay = this.sharedPresentationDelay(shared);
        return this.sortNudgeTickets(admitted.filter((ticket) => {
            return this.ticketRuntimeEnabled(ticket) && sharedDelay === 0;
        }));
    }

    private collectAdmittedNudgeTickets(): NudgeTicket[] {
        const seen = new Set<string>();
        return this.callbacks.getAdmittedNudgeTickets().filter((ticket) => {
            if (seen.has(ticket.key) || this.presentedNudgeKeys.has(ticket.key)) return false;
            seen.add(ticket.key);
            if (
                ticket.owner === NudgeOwner.AgentInsight
                && this.deliveryIsSeen(ticket.candidate)
            ) {
                return false;
            }
            if (ticket.owner === NudgeOwner.Pattern) return ticket.result.totalCount > 0;
            return true;
        });
    }

    private sortNudgeTickets(tickets: NudgeTicket[]): NudgeTicket[] {
        // Deterministic compatibility fallback while Tier-3 candidates have no
        // cross-type quality score. This is not a fixed product priority.
        const compatibilityOrder: Record<NudgeOwner, number> = {
            [NudgeOwner.AgentInsight]: 0,
            [NudgeOwner.Pattern]: 1,
            [NudgeOwner.Onboarding]: 2,
        };
        return [...tickets].sort(
            (left, right) => compatibilityOrder[left.owner] - compatibilityOrder[right.owner],
        );
    }

    private ticketRuntimeEnabled(ticket: NudgeTicket): boolean {
        if (!this.host.settings.pagelet.enabled || this.host.settings.focusMode) return false;
        if (this.host.settings.pagelet.petVisible === false) return false;
        switch (ticket.owner) {
            case NudgeOwner.AgentInsight:
                return true;
            case NudgeOwner.Pattern:
            case NudgeOwner.Onboarding:
                return this.host.settings.pagelet.proactiveHints && this.proactiveHints.enabled;
        }
    }

    private deliveryIsSeen(candidate: DeliveryCandidate | null): boolean {
        return Boolean(
            candidate?.deliveryReceipt
            && (this.callbacks.isDeliverySeen?.(candidate.deliveryReceipt) ?? false),
        );
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
        const enabled = tickets.some((ticket) => (
            ticket.owner === NudgeOwner.AgentInsight
        ))
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
            case NudgeOwner.AgentInsight:
                return buildAgentInsightDeliveryContent(ticket.candidate, {
                    onView: (candidate) => {
                        bubbleView.close();
                        this.callbacks.onAgentInsightView?.(candidate);
                    },
                    onLater: (candidate) => {
                        bubbleView.close();
                        this.callbacks.onAgentInsightLater?.(candidate);
                    },
                }, locale);
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

    private scheduleDeferredSharedWake(): void {
        if (!this.nudgeSurfaceAvailable(this.lastPetView)) {
            this.clearNudgeWakeTimer();
            return;
        }
        const deferred = this.collectAdmittedNudgeTickets()
            .filter((ticket) => this.ticketRuntimeEnabled(ticket));
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
}
