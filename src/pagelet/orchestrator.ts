/* Copyright 2023 edonyzpc */

/**
 * Pagelet Orchestrator -- central integration layer.
 *
 * Coordinates Pet, Bubble, Panel, Tab, and foreground review. Delegates
 * analysis to {@link AnalysisSessionManager}, note-saving to
 * {@link ReviewNoteSaveFlow}, and bubble display to {@link BubbleCoordinator}.
 */

import {
    MarkdownView,
    Notice,
    normalizePath,
} from "obsidian";
import type { WorkspaceLeaf } from "obsidian";

import { getPageletUiLanguage, pageletT } from "../locales/pagelet";
import {
    clearPlatformTimeout,
    getPlatformDocument,
    setPlatformTimeout,
    type PlatformTimeoutHandle,
} from "../platform-dom";
import { isObsidianModalOpen } from "./dom-utils";

import { BubbleView } from "./bubble/BubbleView";
import type { DeliveryCandidate } from "./bubble/types";
import type { OnboardingNudge, OnboardingNudgeKind } from "./bubble/BubbleContent";
import {
    AttentionAwareDeliveryStore,
    type DeliveryReceipt,
} from "./attention";
import { PanelView } from "./panel/PanelView";
import { buildContextualGovernedMemoryState } from "./contextual-memory";
import type {
    PanelFinding,
    PanelLayoutType,
    PanelMemoryGovernanceState,
    PanelOpenExtra,
    PanelShareCardRequest,
    PageletReadingPosition,
    PageletReadingControls,
} from "./panel/types";
import type { PageletCommandCallbacks } from "./commands";
import { ProactiveHints } from "./hints/ProactiveHints";
import type { PetCorner, PetTaskKind } from "./pet/types";
import { PetView } from "./pet/PetView";
import { getPageletOverlayRoot } from "./overlay-root";
import { ResearchManager } from "./research";

import { AnalysisSessionManager } from "./AnalysisSessionManager";
import { BubbleCoordinator, NudgeOwner, type NudgeTicket } from "./BubbleCoordinator";
import { ReviewNoteSaveFlow } from "./ReviewNoteSaveFlow";
import type { PageletHost } from "./PageletHost";
import { serializePageletFindings } from "../share-card/share-card-markdown";
import { ShareCardModal } from "../share-card/share-card-modal";
import {
    createShareCardNoteData,
    createShareCardSelectionData,
} from "../share-card/share-card-source";
import type { ShareCardData } from "../share-card/share-card-types";
import {
    pageletAgentCollectionToDeliveryCandidates,
} from "./agent/delivery-adapter";
import type { PageletAgentDeliveryCandidate } from "./agent/delivery-adapter";
import { PAGELET_DEEP_DISCOVER_WEB_CACHE_TTL_MS, type PageletDeepDiscoverControllerResult } from "./agent/types";
import { resolveRelatedMarkdownNote } from "./related-note";
import type { PageletDetailPayload, PageletDetailReadingPayload } from "./tab/types";
import { splitReviewQueueForSections } from "./tab/review-queue-routing";
import {
    createContextPagerStateFromRetrievalOutcome,
    reviewQueueItemHasUserIntentOrDurableConsequence,
    toReplaySourceRef,
    type PersistedSourceRef,
    type PatternDetectionResult,
    type RetrievalOutcome,
} from "../pa";

// Re-export so existing `import { PageletHost } from "./orchestrator"` keeps working.
export type { PageletHost } from "./PageletHost";

type PageletInsightHandoffErrorKind =
    | "stale"
    | "handoff-busy"
    | "handoff-draft"
    | "handoff-unavailable";

type PageletInsightHandoffState =
    | { kind: "idle" }
    | { kind: "handoff-opening"; candidateId: string }
    | { kind: "error"; candidateId: string; error: PageletInsightHandoffErrorKind };

interface PageletRecentReading {
    anchorPath: string;
    candidates: PageletAgentDeliveryCandidate[];
    selectedId: string;
    positions: Record<string, PageletReadingPosition>;
    waitingRequestId: string | null;
    emptyReason?: string;
}

interface PageletDetailReadingSession {
    readonly payload: PageletDetailReadingPayload;
    isActive(): boolean;
    replaceCandidates(candidates: readonly PageletAgentDeliveryCandidate[]): void;
    setWaiting(emptyReason: string, waitingRequestId: string | null): void;
    acceptWaitingResult(requestId: string, candidates: readonly PageletAgentDeliveryCandidate[]): boolean;
}

export class PageletOrchestrator {
    // ---- Components -------------------------------------------------------
    private petView: PetView | null = null;
    private bubbleView: BubbleView | null = null;
    private panelView: PanelView | null = null;
    private currentPanelLayout: PanelLayoutType | null = null;
    private preservePanelSessionOnClose = false;
    private readonly handleEscape: (e: KeyboardEvent) => void;
    private readonly proactiveHints: ProactiveHints;
    private readonly researchManager: ResearchManager;
    private escapeListenerDocument: Document | null = null;

    // ---- Delegates --------------------------------------------------------
    private readonly sessionManager: AnalysisSessionManager;
    private readonly bubbleCoordinator: BubbleCoordinator;
    private readonly attentionStore: AttentionAwareDeliveryStore;
    private readonly saveFlow: ReviewNoteSaveFlow;

    // ---- State ------------------------------------------------------------
    private idleTimer: PlatformTimeoutHandle | null = null;
    private readonly activityDebounceTimers = new Map<string, PlatformTimeoutHandle>();
    private currentMarkdownAnchorPath: string | null = null;
    private agentInsightCandidate: PageletAgentDeliveryCandidate | null = null;
    private pendingAgentInsightCandidates: PageletAgentDeliveryCandidate[] = [];
    private agentInsightAnchorPath: string | null = null;
    private agentInsightPolicyIdentity: string | null = null;
    private openAgentInsightCandidate: PageletAgentDeliveryCandidate | null = null;
    private readonly recentReadings = new Map<string, PageletRecentReading>();
    private readonly availableAgentInsights = new Map<string, PageletAgentDeliveryCandidate[]>();
    private readonly detailReadingSessions = new Map<string, PageletDetailReadingSession[]>();
    private readonly detailReadingSessionsByPayload = new WeakMap<PageletDetailReadingPayload, PageletDetailReadingSession>();
    private readonly detailReadingOpenings = new Map<string, Promise<void>>();
    private readonly detailReadingAbortControllers = new Map<string, AbortController>();
    private panelReading: PageletRecentReading | null = null;
    private readingIntent = 0;
    private readingAbortController: AbortController | null = null;
    private readingRevalidationAbortController: AbortController | null = null;
    private readingExpiryTimer: PlatformTimeoutHandle | null = null;
    private readonly readingListeners = new Set<() => void>();
    private unsubscribeReadingActivity: (() => void) | undefined;
    private readonly agentInsightNudgeKeys = new Set<string>();
    private agentInsightHandoffState: PageletInsightHandoffState = { kind: "idle" };
    private agentInsightHandoffToken = 0;
    private agentInsightHandoffAbortController: AbortController | null = null;
    private onboardingNudge: OnboardingNudge | null = null;
    private onboardingNudgeAdmissionKey: string | null = null;
    get hasActiveOnboardingNudge(): boolean { return this.onboardingNudge !== null; }
    private patternDetectionNudge: PatternDetectionResult | null = null;
    private patternDetectionNudgeAdmissionKey: string | null = null;
    private foregroundRouteToken = 0;
    private backgroundDiscoveryEnabled: boolean;
    private backgroundDiscoveryEpoch = 0;
    private readonly activeForegroundTimers = new Set<ReturnType<typeof setTimeout>>();
    private destroyed = false;

    // ---- Constants --------------------------------------------------------
    /** 120 s ceiling for any single foreground provider-backed call. */
    private static readonly FOREGROUND_TIMEOUT_MS = 120_000;
    /** 10 minutes of no activity -> Pet enters resting state. */
    private static readonly IDLE_TIMEOUT_MS = 10 * 60 * 1000;
    /** 5 s debounce for note-activity detection (vault modify events). */
    private static readonly ACTIVITY_DEBOUNCE_MS = 5_000;

    constructor(private readonly host: PageletHost) {
        const s = host.settings.pagelet;
        this.backgroundDiscoveryEnabled = s.backgroundDiscoveryEnabled;
        this.attentionStore = new AttentionAwareDeliveryStore({
            storage: host.createPageletAttentionStorage?.(),
            onDiagnostic: (diagnostic) => {
                host.log("Pagelet attention delivery storage fallback", diagnostic);
            },
        });
        // Delegate: analysis session manager
        this.sessionManager = new AnalysisSessionManager();

        // Delegate: review note save flow
        this.saveFlow = new ReviewNoteSaveFlow(host, {
            petTransition: (event) => this.transitionPet(event, "review"),
            petFlashError: () => this.petView?.flashError(),
            closePanel: () => this.panelView?.close(),
        });

        // Proactive hints
        this.proactiveHints = new ProactiveHints({
            enabled: s.proactiveHints,
            cooldownMinutes: s.proactiveHintsCooldown,
            quietHours: s.proactiveHintsQuietHours,
        });

        // Delegate: bubble coordinator (after proactiveHints)
        this.bubbleCoordinator = new BubbleCoordinator(host, this.proactiveHints, {
            onReadCurrentNote: () => { void this.openReadingDetail(); },
            onExpandPanel: (type) => this.handleExpandPanel(type),
            onSourceClick: (link) => this.handleSourceClick(link),
            onDismiss: () => this.handleBubbleDismiss(),
            onReviewCurrentNote: () => { void this.runExplicitDeepDiscover(); },
            onDiscoverConnections: () => { void this.runExplicitDeepDiscover(); },
            getOnboardingNudge: () => this.onboardingNudge,
            onOnboardingNudgeDismiss: (nudge) => this.handleOnboardingNudgeDismiss(nudge),
            getPatternDetectionNudge: () => this.patternDetectionNudge,
            onPatternDetectionView: (result) => { void this.handlePatternDetectionBubbleView(result); },
            onPatternDetectionDismiss: (result) => this.handlePatternDetectionBubbleDismiss(result),
            getAgentInsightCandidate: () => this.currentAgentInsightCandidate(),
            getAdmittedNudgeTickets: () => this.currentAdmittedNudgeTickets(),
            onAgentInsightView: (candidate) => this.openAgentInsightPanel(
                candidate as PageletAgentDeliveryCandidate,
            ),
            onAgentInsightLater: (candidate) => this.dismissAgentInsightNudge(
                candidate as PageletAgentDeliveryCandidate,
            ),
            onNudgePresented: (ticket) => this.handleNudgePresented(ticket),
            isDeliverySeen: (receipt) => this.attentionStore.isSeen(receipt),
            onExplanationVisible: (kind, copyVersion) => {
                this.attentionStore.acknowledgeExplanation(kind, copyVersion);
            },
        });
        this.unsubscribeReadingActivity = host.subscribeDeepDiscoverActivity?.(path => this.handleReadingActivity(path));

        this.researchManager = new ResearchManager(host.app, {
            onResearchComplete: () => undefined,
            onResearchError: (error) => {
                this.host.log("Pagelet research failed", error);
                new Notice(this.t("pagelet.panel.status.actionFailed"), 4000);
            },
        });

        // Bound Escape handler for cleanup
        this.handleEscape = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            if (this.saveFlow.isSaveInProgress || isObsidianModalOpen(e)) return;
            if (this.petView?.actionRingOpen) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.petView.dismissActionRingFromEscape();
                return;
            }
            if (this.panelView?.isOpen) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.panelView.close();
                return;
            }
        };
    }

    private t(key: string, params?: Readonly<Record<string, string | number>>): string {
        return pageletT(key, getPageletUiLanguage(), params);
    }

    /** Prefer the focused leaf; Pagelet detail can remain the "most recent" leaf after navigation. */
    private getCurrentWorkspaceLeaf(): WorkspaceLeaf | null {
        return this.host.app.workspace.activeLeaf
            ?? this.host.app.workspace.getMostRecentLeaf();
    }

    // ======================================================================
    // Public lifecycle
    // ======================================================================

    /**
     * Initialize all components and start the feature lifecycle.
     * Call from `plugin.onload()` after the workspace is ready.
     */
    initialize(): void {
        if (this.destroyed) return;
        const featureScope = this.host.pageletFeatureScope;
        if (!this.host.isFeatureScopeCurrent(featureScope)) return;

        // 1. Overlay mount root (under workspace.containerEl to avoid titlebar overlap)
        const overlayRoot = getPageletOverlayRoot(this.host.app);

        // 1a. Create BubbleView (lazy-mounted on first show)
        this.bubbleView = new BubbleView({
            getLocale: getPageletUiLanguage,
            onClose: () => this.bubbleCoordinator.handleBubbleClosed(this.bubbleView, this.petView),
            onDeliveryVisible: (receipt) => {
                this.attentionStore.markSeen(receipt, "bubble");
            },
            callbacks: {
                onExpandPanel: (type) => this.handleExpandPanel(type),
                onSourceClick: (link) => this.handleSourceClick(link),
                onDismiss: () => this.handleBubbleDismiss(),
            },
            // F-09: Clamp Bubble to active leaf bounds on desktop
            getActiveLeafBounds: () => {
                const view = this.host.app.workspace.getActiveViewOfType(MarkdownView);
                return view?.contentEl?.getBoundingClientRect() ?? null;
            },
        });
        this.bubbleView.mount(overlayRoot);

        // 1b. Create PanelView (lazy-mounted on first open)
        this.panelView = new PanelView({
            app: this.host.app,
            getLocale: () => getPageletUiLanguage(),
            callbacks: {
                onExpandToTab: () => this.expandPanelToTab(),
                onClose: () => {
                    this.clearPanelSession();
                    this.host.log("Panel closed");
                },
                onSourceClick: (link) => this.handleSourceClick(link),
                onSaveAsReviewNote: (findings) => { void this.saveFindingsAsReviewNote(findings); },
                onReviewQueueItemDismiss: (id) => { void this.dismissReviewQueueItem(id); },
                onRunReview: () => this.runExplicitDeepDiscover(),
                onRelatedNoteClick: (noteName, sourcePath) => this.handleRelatedNoteClick(noteName, sourcePath),
                onResearchFinding: (finding) => this.handleResearchFinding(finding),
                onToggleHints: () => this.toggleProactiveHints(),
                onShareAsCard: (request) => this.sharePanelAsCard(request),
            },
        });
        this.panelView.mount(overlayRoot);

        // 1c. Escape handler (Panel > Bubble priority)
        this.escapeListenerDocument = getPlatformDocument();
        this.escapeListenerDocument.addEventListener("keydown", this.handleEscape, true);

        // 2. Workspace event: re-mount Pet when the active leaf changes
        this.host.registerEvent(
            this.host.app.workspace.on("active-leaf-change", (leaf) => {
                if (!this.isFeatureEventCurrent(featureScope)) return;
                this.handleLeafChange(leaf);
            }),
        );
        this.host.registerEvent(
            this.host.app.workspace.on("file-open", () => {
                if (!this.isFeatureEventCurrent(featureScope)) return;
                this.handleFileOpen();
            }),
        );

        // 3. Vault events: markdown-only activity tracking
        this.host.registerEvent(
            this.host.app.vault.on("modify", (file) => {
                if (!this.isFeatureEventCurrent(featureScope)) return;
                if (file.path.endsWith(".md")) {
                    this.handleMarkdownModify(file.path);
                }
            }),
        );
        this.host.registerEvent(
            this.host.app.vault.on("create", (file) => {
                if (!this.isFeatureEventCurrent(featureScope)) return;
                if (file.path.endsWith(".md")) this.invalidateAgentInsightForPaths([file.path]);
            }),
        );
        this.host.registerEvent(
            this.host.app.vault.on("delete", (file) => {
                if (!this.isFeatureEventCurrent(featureScope)) return;
                if (file.path.endsWith(".md")) {
                    this.invalidateAgentInsightForPaths([file.path]);
                }
            }),
        );
        this.host.registerEvent(
            this.host.app.vault.on("rename", (file, oldPath) => {
                if (!this.isFeatureEventCurrent(featureScope)) return;
                if (file.path.endsWith(".md") || oldPath.endsWith(".md")) {
                    this.invalidateAgentInsightForPaths([oldPath, file.path]);
                }
            }),
        );
        this.host.registerEvent(
            this.host.app.metadataCache.on("changed", (file) => {
                if (!this.isFeatureEventCurrent(featureScope) || !file.path.endsWith(".md")) return;
                // Tag-based exclusions may only become visible after vault.modify.
                if (!this.host.isPathAllowedForPagelet(file.path)) {
                    this.invalidateAgentInsightForPaths([file.path]);
                } else {
                    for (const listener of this.readingListeners) listener();
                    void this.revalidateOpenReading();
                }
            }),
        );

        // 4. Mount Pet on whatever leaf is currently active. Deep Discover
        // owns all provider-backed background work; legacy preload stays dormant.
        const initialLeaf = this.getCurrentWorkspaceLeaf();
        if (initialLeaf) {
            if (this.isFeatureEventCurrent(featureScope)) this.handleLeafChange(initialLeaf);
        }

        // 5. Begin idle tracking
        if (this.isFeatureEventCurrent(featureScope)) this.resetIdleTimer();
    }

    /**
     * Tear down all components. Call from `plugin.onunload()`.
     * Safe to call multiple times.
     */
    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;

        this.clearIdleTimer();
        this.clearActivityDebounce();
        for (const timer of this.activeForegroundTimers) clearTimeout(timer);
        this.activeForegroundTimers.clear();
        this.escapeListenerDocument?.removeEventListener("keydown", this.handleEscape, true);
        this.escapeListenerDocument = null;
        this.host.cancelDeepDiscover?.();
        this.unsubscribeReadingActivity?.();
        this.unsubscribeReadingActivity = undefined;
        for (const controller of this.detailReadingAbortControllers.values()) controller.abort();
        this.detailReadingAbortControllers.clear();
        this.detailReadingOpenings.clear();
        this.detailReadingSessions.clear();
        this.readingAbortController?.abort();
        this.readingRevalidationAbortController?.abort();
        this.clearReadingExpiry();
        this.cancelAgentInsightHandoff();
        this.clearAgentInsight();
        this.readingListeners.clear();
        this.bubbleCoordinator.destroy();
        this.petView?.destroy();
        this.bubbleView?.destroy();
        this.panelView?.destroy();

        this.petView = null;
        this.bubbleView = null;
        this.panelView = null;
    }

    private isFeatureEventCurrent(featureScope: object): boolean {
        return !this.destroyed && this.host.isFeatureScopeCurrent(featureScope);
    }

    /** Apply latest settings to all runtime collaborators. */
    syncSettings(): void {
        if (this.destroyed) return;
        const s = this.host.settings.pagelet;
        if (this.backgroundDiscoveryEnabled !== s.backgroundDiscoveryEnabled) {
            this.backgroundDiscoveryEnabled = s.backgroundDiscoveryEnabled;
            this.backgroundDiscoveryEpoch += 1;
        }
        this.proactiveHints.updateConfig({
            enabled: s.proactiveHints,
            cooldownMinutes: s.proactiveHintsCooldown,
            quietHours: s.proactiveHintsQuietHours,
        });
        if (!s.proactiveHints) this.clearGenericNudgeAdmissions();
        if (!s.enabled) {
            this.host.cancelDeepDiscover?.();
            this.clearAgentInsight({ closePanel: true });
        } else {
            this.invalidateAgentInsightIfPolicyChanged();
        }
        if (this.petView) {
            this.petView.stateMachine.proactiveHintsEnabled = s.proactiveHints;
            this.petView.setCorner(s.petCorner);
        }
        this.syncPetVisibility();

        this.reconcilePetNudge();
    }

    // ======================================================================
    // Command callbacks
    // ======================================================================

    getCommandCallbacks(): PageletCommandCallbacks {
        return {
            onOpenPanel: () => this.openPanel(),
            onDiscoverConnections: () => this.runExplicitDeepDiscover(),
            onMaintenanceReview: () => this.runMaintenanceReview(),
            onGraphDiscovery: () => this.runGraphDiscovery(),
            onToggleProactiveHints: () => this.toggleProactiveHints(),
            onShowBackgroundPreparationStatus: () => {
                void this.showBackgroundPreparationStatusNotice();
            },
            onMovePetCorner: () => {
                this.cyclePetCorner();
            },
            onTogglePetVisibility: () => {
                this.togglePetVisibility();
            },
        };
    }

    async openPanel(): Promise<void> {
        const path = this.host.app.workspace.getActiveFile?.()?.path;
        if (!path?.endsWith(".md")) return;
        await this.openReadingForPath(path);
    }

    handlePageletDetailClosed(path: string): void {
        if (this.destroyed || path !== this.currentMarkdownAnchorPath) return;
        this.reconcilePetNudge();
    }

    private async openReadingDetail(): Promise<void> {
        const path = this.host.app.workspace.getActiveFile?.()?.path;
        if (!path?.endsWith(".md")) return;
        await this.openReadingDetailForPath(path);
    }

    private async openReadingDetailForPath(path: string): Promise<void> {
        if (this.host.getPageletDetailPathState?.(path) === "live") {
            try {
                if (await this.host.revealPageletDetailViewForPath?.(path)) return;
            } catch (error) {
                this.host.log("Failed to reveal Pagelet detail view", error);
                new Notice(this.t("pagelet.panel.status.error"), 4000);
                return;
            }
        }

        const pending = this.detailReadingOpenings.get(path);
        if (pending) {
            await pending;
            return;
        }

        const opening = this.openReadingDetailLeaf(path);
        this.detailReadingOpenings.set(path, opening);
        try {
            await opening;
        } finally {
            if (this.detailReadingOpenings.get(path) === opening) {
                this.detailReadingOpenings.delete(path);
            }
        }
    }

    private async openReadingDetailLeaf(path: string): Promise<void> {
        this.invalidateAgentInsightIfPolicyChanged();
        this.detailReadingAbortControllers.get(path)?.abort();
        const controller = new AbortController();
        this.detailReadingAbortControllers.set(path, controller);
        const reading = this.recentReadings.get(path) ?? this.createReading(path);
        const policyIdentity = this.agentInsightPolicyIdentity;
        const isReadCurrent = (): boolean => !this.destroyed
            && !controller.signal.aborted
            && this.detailReadingAbortControllers.get(path) === controller
            && this.recentReadings.get(path) === reading;

        if (!this.host.isPathAllowedForPagelet(path)) {
            reading.emptyReason = "stale";
            reading.waitingRequestId = null;
        } else {
            reading.emptyReason = "checking";
            const activity = this.host.getDeepDiscoverActivity?.(path);
            reading.waitingRequestId = reading.candidates.length === 0 && activity && activity.phase !== "idle"
                ? activity.requestId
                : null;
        }

        const payload = this.detailReadingPayload(reading);
        const session = this.detailReadingSessionsByPayload.get(payload);
        if (!session) throw new Error("Expected a registered Pagelet Detail reading session");

        let payloadDelivered = false;
        try {
            await this.host.openPageletDetailView({
                title: pageletT("pagelet.tab.title", getPageletUiLanguage()),
                content: [],
                locale: getPageletUiLanguage(),
                layoutType: "discover",
                sourcePath: path,
                reading: payload,
            }, { noteReading: true, hydrateRestoredFromState: true });
            payloadDelivered = true;
            const candidates = await this.readReadingCandidates(path, reading, controller.signal, policyIdentity);
            if (candidates === null || !isReadCurrent()) return;
            if (candidates.length > 0) {
                session.replaceCandidates(candidates);
                return;
            }
            const activity = this.host.getDeepDiscoverActivity?.(path);
            session.setWaiting(
                reading.emptyReason === "checking" ? "empty" : reading.emptyReason ?? "empty",
                activity && activity.phase !== "idle" ? activity.requestId : null,
            );
        } catch (error) {
            if (!isReadCurrent()) return;
            reading.emptyReason = "unavailable";
            reading.waitingRequestId = null;
            session.setWaiting("unavailable", null);
            this.host.log("Failed to open Pagelet detail reading", error);
            if (!payloadDelivered) new Notice(this.t("pagelet.panel.status.error"), 4000);
        } finally {
            if (this.detailReadingAbortControllers.get(path) === controller) {
                this.detailReadingAbortControllers.delete(path);
            }
            if (!payloadDelivered) this.removeDetailReadingSession(path, payload);
        }
    }

    private rememberPanelReadingPosition(): void {
        const reading = this.panelReading;
        const candidate = this.openAgentInsightCandidate;
        if (!reading || !candidate) return;
        const position = this.panelView?.getReadingPosition?.();
        if (position) reading.positions[candidate.id] = position;
    }

    private createReading(path: string): PageletRecentReading {
        this.agentInsightPolicyIdentity = this.host.getDeepDiscoverPolicyIdentity?.() ?? null;
        const reading: PageletRecentReading = {
            anchorPath: path, candidates: [], selectedId: "", positions: {}, waitingRequestId: null,
        };
        this.recentReadings.set(path, reading);
        return reading;
    }

    private async openReadingForPath(path: string): Promise<void> {
        this.invalidateAgentInsightIfPolicyChanged();
        this.rememberPanelReadingPosition();
        this.clearReadingExpiry();
        this.readingAbortController?.abort();
        this.readingRevalidationAbortController?.abort();
        const controller = new AbortController();
        this.readingAbortController = controller;
        const intent = ++this.readingIntent;
        this.cancelAgentInsightHandoff();
        const reading = this.recentReadings.get(path) ?? this.createReading(path);
        const policyIdentity = this.agentInsightPolicyIdentity;
        // Expansion keeps the read alive for Detail; only the original intent
        // may still render a Panel. Closing or choosing another reading aborts it.
        const isReadCurrent = (): boolean => !this.destroyed && !controller.signal.aborted
            && this.recentReadings.get(path) === reading;
        this.panelReading = reading;
        this.openAgentInsightCandidate = null;
        reading.emptyReason = this.host.isPathAllowedForPagelet(path) ? "checking" : "stale";
        this.renderReadingShell(reading);
        if (reading.emptyReason === "stale") return;
        try {
            const candidates = await this.readReadingCandidates(path, reading, controller.signal, policyIdentity);
            if (candidates === null || !isReadCurrent()) return;
            reading.candidates = candidates;
            if (candidates.length > 0) {
                const selected = candidates.find(candidate => candidate.id === reading.selectedId) ?? candidates[0];
                reading.selectedId = selected.id;
                reading.emptyReason = undefined;
                reading.waitingRequestId = null;
                if (this.readingIntentIsCurrent(reading, intent)) this.openAgentInsightPanel(selected, reading);
            } else {
                reading.selectedId = "";
                if (reading.emptyReason === "checking") reading.emptyReason = "empty";
                const activity = this.host.getDeepDiscoverActivity?.(path);
                reading.waitingRequestId = activity && activity.phase !== "idle" ? activity.requestId : null;
                if (this.readingIntentIsCurrent(reading, intent)) this.renderReadingShell(reading);
            }
            for (const listener of this.readingListeners) listener();
        } catch {
            if (!isReadCurrent()) return;
            reading.emptyReason = "unavailable";
            if (this.readingIntentIsCurrent(reading, intent)) this.renderReadingShell(reading);
            for (const listener of this.readingListeners) listener();
        }
    }

    private async readReadingCandidates(
        path: string,
        reading: PageletRecentReading,
        signal: AbortSignal,
        policyIdentity: string | null,
    ): Promise<PageletAgentDeliveryCandidate[] | null> {
        let candidates = await this.validateReadingCandidates(reading.candidates, signal, true);
        if (signal.aborted) return null;
        if (candidates.length === 0) {
            const available = this.availableAgentInsights.get(path) ?? [];
            candidates = await this.validateReadingCandidates(available, signal);
            if (signal.aborted) return null;
        }
        if (candidates.length > 0 || !this.host.readDeepDiscover) return candidates;

        const availableBeforeRead = this.availableAgentInsights.get(path) ?? [];
        const finishSupersededRead = (): boolean => {
            // Source events may filter into a new array without accepting new
            // results. Only newly admitted candidate objects supersede this read.
            const latest = this.availableAgentInsights.get(path) ?? [];
            if (!latest.some(candidate => !availableBeforeRead.includes(candidate))) return false;
            return true;
        };
        const result = await this.host.readDeepDiscover({ path, signal });
        if (signal.aborted) return null;
        if (finishSupersededRead()) return null;
        if (result.status !== "cache-hit") {
            reading.emptyReason = result.status;
            return [];
        }

        const cacheIsCurrent = (): boolean => policyIdentity === (this.host.getDeepDiscoverPolicyIdentity?.() ?? null)
            && this.host.isPathAllowedForPagelet(path)
            && this.host.isDeepDiscoverCommitSealCurrent?.(result.commitSeal, result.collection) === true;
        if (cacheIsCurrent()) {
            candidates = await this.validateReadingCandidates(
                pageletAgentCollectionToDeliveryCandidates(result.collection, getPageletUiLanguage()),
                signal,
            );
        }
        if (signal.aborted) return null;
        if (finishSupersededRead()) return null;
        if (cacheIsCurrent()) this.availableAgentInsights.set(path, candidates);
        else candidates = [];
        if (candidates.length === 0) reading.emptyReason = "stale";
        return candidates;
    }

    private readingIntentIsCurrent(reading: PageletRecentReading, intent: number): boolean {
        return !this.destroyed && this.readingIntent === intent && this.panelReading === reading;
    }

    private async validateReadingCandidates(
        candidates: readonly PageletAgentDeliveryCandidate[], signal: AbortSignal, preserveStale = false,
    ): Promise<PageletAgentDeliveryCandidate[]> {
        const valid: PageletAgentDeliveryCandidate[] = [];
        for (const candidate of candidates) {
            if (signal.aborted) return [];
            try {
                const current = await this.validateAgentInsight(candidate, signal);
                if (current || (preserveStale && candidate.staleStatus === "stale")) valid.push(candidate);
            } catch { /* Fail closed per text. */ }
        }
        return valid;
    }

    private readingActivityLabel(path: string): string {
        const activity = this.host.getDeepDiscoverActivity?.(path);
        if (!activity) return "";
        if (activity.phase !== "idle") return this.t(`pagelet.reading.${activity.phase}`);
        const terminal = activity.terminal;
        if (!terminal || terminal.status === "cache-hit" || terminal.status === "verified") return "";
        if (terminal.status === "quiet") {
            return this.t(terminal.reason === "no-insight" ? "pagelet.deepDiscover.noInsight"
                : terminal.reason === "aborted" ? "pagelet.deepDiscover.cancelled"
                    : terminal.reason === "duplicate" || terminal.reason === "seen" ? "pagelet.deepDiscover.noNewResults"
                        : "pagelet.deepDiscover.incomplete");
        }
        return this.t(terminal.status === "stale" ? "pagelet.deepDiscover.stale"
            : terminal.status === "denied" ? "pagelet.deepDiscover.boundaryDenied"
                : terminal.status === "limit" ? "pagelet.deepDiscover.limitReached" : "pagelet.panel.status.error");
    }

    private readingControls(reading: PageletRecentReading, surface: "panel" | "detail" = "panel"): PageletReadingControls {
        const latest = this.availableAgentInsights.get(reading.anchorPath) ?? [];
        const hasNew = latest.length > 0
            && JSON.stringify(latest.map(candidate => [candidate.id, candidate.preparedAt]))
                !== JSON.stringify(reading.candidates.map(candidate => [candidate.id, candidate.preparedAt]));
        const activityLabel = this.readingActivityLabel(reading.anchorPath);
        const emptyLabel = reading.emptyReason === "checking" ? "pagelet.reading.checking"
            : reading.emptyReason === "stale" ? "pagelet.deepDiscover.stale"
                : reading.emptyReason === "unavailable" ? "pagelet.reading.unavailable" : "pagelet.reading.empty";
        const label = [activityLabel, hasNew ? this.t("pagelet.reading.newResults") : "",
            !activityLabel && !hasNew && (reading.candidates.length === 0 || reading.emptyReason === "checking") ? this.t(emptyLabel) : ""].filter(Boolean).join(" ");
        return {
            anchorPath: reading.anchorPath,
            label,
            actions: [
                ...(hasNew && surface === "panel" ? [{ label: this.t("pagelet.reading.showNew"), callback: () => { void this.selectLatestReading(reading); } }] : []),
                { label: this.t("pagelet.reading.discover"), callback: () => { void this.runExplicitDeepDiscover(reading.anchorPath, surface); } },
            ],
        };
    }

    private renderReadingShell(reading: PageletRecentReading): void {
        this.currentPanelLayout = "discover";
        this.panelView?.open("discover", [], { sourcePath: reading.anchorPath, reading: this.readingControls(reading) });
    }

    private detailReadingPayload(reading: PageletRecentReading): PageletDetailReadingPayload {
        const payload: PageletDetailReadingPayload = {
            anchorPath: reading.anchorPath,
            candidates: [...reading.candidates],
            selectedId: reading.selectedId,
            positions: reading.positions,
            onSelect: () => undefined,
            onPositionChange: (id, position) => { reading.positions[id] = position; },
            validate: (candidate, signal) => this.validateAgentInsight(candidate, signal),
            discuss: async (candidate, signal) => {
                if (!await this.validateAgentInsight(candidate, signal) || signal.aborted) return { status: "invalid" };
                return await this.host.openPageletChatHandoff?.(candidate.pageletAgent.handoff, signal)
                    ?? { status: "unavailable" };
            },
            getReadingControls: () => this.readingControls({
                ...reading, candidates: [...payload.candidates], selectedId: payload.selectedId,
            }, "detail"),
            subscribe: () => () => undefined,
            getLatestCandidates: () => this.availableAgentInsights.get(reading.anchorPath) ?? [],
        };
        let activeReadingViews = 0;
        const notifyReadingListeners = (): void => {
            for (const listener of this.readingListeners) listener();
        };
        const replaceCandidates = (candidates: readonly PageletAgentDeliveryCandidate[]): void => {
            reading.candidates = [...candidates];
            const selected = candidates.find(candidate => candidate.id === reading.selectedId) ?? candidates[0];
            reading.selectedId = selected?.id ?? "";
            reading.emptyReason = undefined;
            reading.waitingRequestId = null;
            payload.candidates = [...candidates];
            payload.selectedId = reading.selectedId;
            notifyReadingListeners();
        };
        const setWaiting = (emptyReason: string, waitingRequestId: string | null): void => {
            reading.emptyReason = emptyReason;
            reading.waitingRequestId = waitingRequestId;
            reading.selectedId = "";
            payload.candidates = [];
            payload.selectedId = "";
            notifyReadingListeners();
        };
        const session: PageletDetailReadingSession = {
            payload,
            isActive: () => activeReadingViews > 0,
            replaceCandidates,
            setWaiting,
            acceptWaitingResult: (requestId, candidates) => {
                if (
                    reading.candidates.length > 0
                    || reading.waitingRequestId !== requestId
                ) return false;
                replaceCandidates(candidates);
                return true;
            },
        };
        payload.onSelect = (candidate, acceptedCandidates) => {
            if (acceptedCandidates) {
                reading.candidates = [...acceptedCandidates];
                payload.candidates = [...acceptedCandidates];
            }
            reading.selectedId = candidate.id;
            payload.selectedId = candidate.id;
            if (candidate.deliveryReceipt) this.attentionStore.markSeen(candidate.deliveryReceipt, "detail");
            this.agentInsightNudgeKeys.delete(this.agentInsightTicketKey(candidate));
            const latest = this.availableAgentInsights.get(reading.anchorPath) ?? [];
            const acceptedIdentity = JSON.stringify(reading.candidates.map(item => [item.id, item.preparedAt]));
            const latestIdentity = JSON.stringify(latest.map(item => [item.id, item.preparedAt]));
            if (latest.length > 0 && acceptedIdentity === latestIdentity) {
                this.host.markPageletDetailNewResults?.(reading.anchorPath, false);
            }
            this.reconcilePetNudge();
        };
        payload.subscribe = listener => {
            const refresh = (): void => {
                for (const candidate of payload.candidates) {
                    if (!this.readingBoundaryIsCurrent(candidate)) candidate.staleStatus = "boundary-changed";
                }
                listener();
            };
            activeReadingViews += 1;
            this.readingListeners.add(refresh);
            return () => {
                activeReadingViews -= 1;
                this.readingListeners.delete(refresh);
                if (activeReadingViews === 0) {
                    this.removeDetailReadingSession(reading.anchorPath, payload);
                }
            };
        };
        this.detailReadingSessionsByPayload.set(payload, session);
        const sessions = this.detailReadingSessions.get(reading.anchorPath) ?? [];
        this.detailReadingSessions.set(reading.anchorPath, [
            ...sessions.filter(item => item !== session && item.isActive()),
            session,
        ]);
        return payload;
    }

    private removeDetailReadingSession(
        path: string,
        payload: PageletDetailReadingPayload,
    ): void {
        const sessions = this.detailReadingSessions.get(path);
        if (!sessions?.some(session => session.payload === payload)) return;
        const remaining = sessions.filter(session => session.payload !== payload);
        if (remaining.length === 0) this.detailReadingSessions.delete(path);
        else this.detailReadingSessions.set(path, remaining);
    }

    private async selectLatestReading(reading: PageletRecentReading): Promise<void> {
        const intent = ++this.readingIntent;
        this.readingAbortController?.abort();
        this.readingRevalidationAbortController?.abort();
        const controller = new AbortController();
        this.readingAbortController = controller;
        const candidates = await this.validateReadingCandidates(this.availableAgentInsights.get(reading.anchorPath) ?? [], controller.signal);
        if (!this.readingIntentIsCurrent(reading, intent) || candidates.length === 0) return;
        this.rememberPanelReadingPosition();
        reading.candidates = candidates;
        this.availableAgentInsights.set(reading.anchorPath, candidates);
        reading.positions = Object.fromEntries(Object.entries(reading.positions).filter(([id]) => candidates.some(candidate => candidate.id === id)));
        reading.selectedId = candidates[0].id;
        this.openAgentInsightPanel(candidates[0], reading);
    }

    private handleReadingActivity(path: string): void {
        for (const listener of this.readingListeners) listener();
        const reading = this.panelReading;
        if (!reading || reading.anchorPath !== path || !this.panelView?.isOpen) return;
        this.panelView.updateReadingControls?.(this.readingControls(reading));
        // A terminal activity does not identify which request produced the cache.
        // Only the accepted result carrying this waiting request may fill its reader.
    }

    async runMaintenanceReview(): Promise<void> {
        const routeToken = this.beginForegroundRoute("review", "review");
        if (routeToken === null) return;
        try {
            const maintenanceReview = await this.withForegroundTimeout(this.host.runMaintenanceReview({ enqueueProposals: false }));
            if (!this.isCurrentForegroundRoute(routeToken)) return;
            this.transitionPet("analysis-done");
            const locale = getPageletUiLanguage();
            const extra = this.withGlobalLedgerExtra(
                this.withGlobalReviewQueueExtra({ maintenanceReview }),
            );
            const payload: PageletDetailPayload = {
                title: pageletT("pagelet.tab.maintenance.title", locale),
                content: [],
                locale,
                layoutType: "review",
                entryReason: "maintenance",
            };
            const detailExtra = this.detailExtraForTab(extra);
            if (detailExtra) payload.extra = detailExtra;
            await Promise.resolve(this.host.openPageletDetailView(payload));
        } catch (error) {
            if (!this.isCurrentForegroundRoute(routeToken)) return;
            this.transitionPet("analysis-done");
            this.petView?.flashError();
            this.host.log("Pagelet maintenance review failed", error);
            new Notice(this.t("pagelet.panel.status.error"), 4000);
        } finally {
            this.sessionManager.finishForegroundReviewRun();
        }
    }

    async runGraphDiscovery(): Promise<void> {
        const routeToken = this.beginForegroundRoute("review", "connection");
        if (routeToken === null) return;
        try {
            const graphDiscovery = await this.withForegroundTimeout(this.host.runGraphDiscovery({ enqueueItems: false }));
            if (!this.isCurrentForegroundRoute(routeToken)) return;
            this.transitionPet("analysis-done");
            const locale = getPageletUiLanguage();
            const extra = this.withGlobalLedgerExtra(
                this.withGlobalReviewQueueExtra({ graphDiscovery }),
            );
            const payload: PageletDetailPayload = {
                title: pageletT("pagelet.tab.graphDiscovery.title", locale),
                content: [],
                locale,
                layoutType: "review",
                entryReason: "graph-discovery",
            };
            const detailExtra = this.detailExtraForTab(extra);
            if (detailExtra) payload.extra = detailExtra;
            await Promise.resolve(this.host.openPageletDetailView(payload));
            if (graphDiscovery.totalCount === 0) {
                new Notice(pageletT("pagelet.graphDiscovery.none", locale), 4000);
            }
        } catch (error) {
            if (!this.isCurrentForegroundRoute(routeToken)) return;
            this.transitionPet("analysis-done");
            this.petView?.flashError();
            this.host.log("Pagelet graph discovery failed", error);
            new Notice(this.t("pagelet.panel.status.error"), 4000);
        } finally {
            this.sessionManager.finishForegroundReviewRun();
        }
    }

    setPatternDetectionNudge(result: PatternDetectionResult | null): void {
        const next = result && result.totalCount > 0 ? result : null;
        if (next && this.patternDetectionNudge?.generatedAt === next.generatedAt) {
            this.patternDetectionNudge = next;
            this.reconcilePetNudge();
            return;
        }
        this.patternDetectionNudge = next;
        this.patternDetectionNudgeAdmissionKey = null;
        if (this.patternDetectionNudge && this.canAdmitGenericNudge()) {
            const key = `${NudgeOwner.Pattern}:${this.patternDetectionNudge.generatedAt}`;
            if (this.proactiveHints.onInsightsReady()) {
                this.patternDetectionNudgeAdmissionKey = key;
            }
        }
        this.reconcilePetNudge();
    }

    setOnboardingNudge(kind: OnboardingNudgeKind | null): boolean {
        if (!kind) {
            this.onboardingNudge = null;
            this.onboardingNudgeAdmissionKey = null;
            this.reconcilePetNudge();
            return true;
        }
        if (this.onboardingNudge?.kind === kind) {
            this.reconcilePetNudge();
            return this.onboardingNudgeAdmissionKey !== null;
        }
        this.onboardingNudge = { kind, generatedAt: new Date().toISOString() };
        this.onboardingNudgeAdmissionKey = null;
        if (this.canAdmitGenericNudge() && this.proactiveHints.onInsightsReady()) {
            this.onboardingNudgeAdmissionKey = `${NudgeOwner.Onboarding}:${kind}:${this.onboardingNudge.generatedAt}`;
        }
        this.reconcilePetNudge();
        return this.onboardingNudgeAdmissionKey !== null;
    }

    private canAdmitGenericNudge(): boolean {
        return Boolean(
            this.host.settings.pagelet.enabled
            && this.host.settings.pagelet.petVisible
            && this.host.settings.pagelet.proactiveHints
            && !this.host.settings.focusMode
            && this.petView,
        );
    }

    private clearGenericNudgeAdmissions(): void {
        this.agentInsightNudgeKeys.clear();
        this.patternDetectionNudgeAdmissionKey = null;
        this.onboardingNudgeAdmissionKey = null;
    }















    private deliveryCandidateIsSeen(
        candidate: Pick<DeliveryCandidate, "deliveryReceipt"> | null | undefined,
    ): boolean {
        return this.deliveryReceiptIsSeen(candidate?.deliveryReceipt);
    }

    private deliveryReceiptIsSeen(receipt: DeliveryReceipt | null | undefined): boolean {
        return Boolean(receipt && this.attentionStore.isSeen(receipt));
    }

    private agentInsightTicketKey(candidate: Pick<PageletAgentDeliveryCandidate, "id">): string {
        return `${NudgeOwner.AgentInsight}:${candidate.id}`;
    }

    private dismissAgentInsightNudge(candidate: PageletAgentDeliveryCandidate): void {
        this.agentInsightNudgeKeys.delete(this.agentInsightTicketKey(candidate));
        this.reconcilePetNudge();
    }

    private currentAgentInsightCandidate(): PageletAgentDeliveryCandidate | null {
        this.invalidateAgentInsightIfPolicyChanged();
        let candidate = this.agentInsightCandidate;
        if (
            candidate
            && this.deliveryCandidateIsSeen(candidate)
            && this.pendingAgentInsightCandidates.length > 0
        ) {
            this.agentInsightNudgeKeys.delete(this.agentInsightTicketKey(candidate));
            this.agentInsightCandidate = this.pendingAgentInsightCandidates.shift() ?? null;
            candidate = this.agentInsightCandidate;
        }
        return candidate && !this.deliveryCandidateIsSeen(candidate) ? candidate : null;
    }

    private clearAgentInsight(options: { closePanel?: boolean } = {}): void {
        this.readingRevalidationAbortController?.abort();
        for (const controller of this.detailReadingAbortControllers.values()) controller.abort();
        this.detailReadingAbortControllers.clear();
        this.detailReadingSessions.clear();
        for (const reading of this.recentReadings.values()) {
            for (const candidate of reading.candidates) candidate.staleStatus = "boundary-changed";
            if (reading.candidates.length === 0) reading.emptyReason = "stale";
        }
        if (this.openAgentInsightCandidate) this.openAgentInsightCandidate.staleStatus = "boundary-changed";
        this.cancelAgentInsightHandoff();
        this.agentInsightCandidate = null;
        this.pendingAgentInsightCandidates = [];
        this.agentInsightAnchorPath = null;
        this.agentInsightPolicyIdentity = null;
        this.agentInsightNudgeKeys.clear();
        this.recentReadings.clear();
        this.availableAgentInsights.clear();
        for (const listener of this.readingListeners) listener();
        if (options.closePanel && (this.openAgentInsightCandidate || this.panelReading)) {
            this.openAgentInsightCandidate = null;
            this.panelReading = null;
            this.readingIntent += 1;
            this.readingAbortController?.abort();
            this.clearReadingExpiry();
            this.panelView?.close();
        }
    }

    private invalidateAgentInsightIfPolicyChanged(): void {
        if (
            !this.agentInsightCandidate
            && this.pendingAgentInsightCandidates.length === 0
            && !this.openAgentInsightCandidate
            && this.recentReadings.size === 0
            && this.availableAgentInsights.size === 0
        ) return;
        const current = this.host.getDeepDiscoverPolicyIdentity?.() ?? null;
        if (current === this.agentInsightPolicyIdentity) return;
        this.clearAgentInsight({ closePanel: true });
    }

    private invalidateAgentInsightForPaths(paths: readonly string[]): void {
        const changed = new Set(paths.map((path) => normalizePath(path)));
        const touches = (
            candidate: PageletAgentDeliveryCandidate | null,
        ): boolean => Boolean(candidate && this.readingSourcePaths(candidate)
            .some(path => changed.has(normalizePath(path))));
        for (const [path, candidates] of this.availableAgentInsights) {
            this.availableAgentInsights.set(path, candidates.filter(candidate => !touches(candidate)));
        }
        for (const reading of this.recentReadings.values()) {
            for (const candidate of reading.candidates) {
                if (touches(candidate)) candidate.staleStatus = this.readingBoundaryIsCurrent(candidate) ? "stale" : "boundary-changed";
            }
            reading.candidates = reading.candidates.filter(candidate => candidate.staleStatus !== "boundary-changed");
            if (!reading.candidates.some(candidate => candidate.id === reading.selectedId)) reading.selectedId = "";
        }
        if (touches(this.openAgentInsightCandidate) && this.openAgentInsightCandidate) {
            this.openAgentInsightCandidate.staleStatus = this.readingBoundaryIsCurrent(this.openAgentInsightCandidate)
                ? "stale" : "boundary-changed";
        }
        for (const listener of this.readingListeners) listener();
        const invalidatesCurrent = touches(this.agentInsightCandidate);
        const invalidatesOpen = touches(this.openAgentInsightCandidate);
        const invalidatedCandidates = [
            ...(invalidatesCurrent && this.agentInsightCandidate
                ? [this.agentInsightCandidate]
                : []),
            ...this.pendingAgentInsightCandidates.filter(touches),
        ];
        const pendingBefore = this.pendingAgentInsightCandidates.length;
        this.pendingAgentInsightCandidates = this.pendingAgentInsightCandidates.filter((candidate) => (
            !touches(candidate)
        ));
        const invalidatesPending = pendingBefore !== this.pendingAgentInsightCandidates.length;
        for (const candidate of invalidatedCandidates) {
            this.agentInsightNudgeKeys.delete(this.agentInsightTicketKey(candidate));
        }
        if (invalidatesCurrent || invalidatesOpen) {
            this.cancelAgentInsightHandoff();
        }
        if (invalidatesCurrent) {
            this.agentInsightCandidate = this.pendingAgentInsightCandidates.shift() ?? null;
            if (!this.agentInsightCandidate) this.agentInsightAnchorPath = null;
        }
        if (invalidatesOpen) {
            if (this.openAgentInsightCandidate?.staleStatus === "boundary-changed") {
                this.openAgentInsightCandidate = null;
                this.panelView?.close();
            } else {
                this.refreshOpenAgentInsightPanel();
            }
        }
        // Aggregate and no-match observations may depend on a changed path that
        // is absent from the displayed citations. Their owner revalidates them.
        void this.revalidateOpenReading();
        if (
            !this.agentInsightCandidate
            && this.pendingAgentInsightCandidates.length === 0
            && !this.openAgentInsightCandidate
            && this.recentReadings.size === 0
            && this.availableAgentInsights.size === 0
        ) {
            this.agentInsightPolicyIdentity = null;
        }
        if (invalidatesCurrent || invalidatesOpen || invalidatesPending) this.reconcilePetNudge();
    }

    private handleMarkdownModify(path: string): void {
        this.invalidateAgentInsightForPaths([path]);
        this.handleNoteActivity(path);
    }



    private currentAdmittedNudgeTickets(): NudgeTicket[] {
        const tickets: NudgeTicket[] = [];
        this.currentAgentInsightCandidate();
        const returnedCandidates = this.admitReturnedAgentInsightsForCurrentNote();
        for (const agentInsight of [
            this.agentInsightCandidate,
            ...this.pendingAgentInsightCandidates,
            ...returnedCandidates,
        ]) {
            if (!agentInsight || this.deliveryCandidateIsSeen(agentInsight)) continue;
            const anchorPath = agentInsight.pageletAgent.handoff.anchor.path;
            if (
                (
                    this.currentMarkdownAnchorPath !== null
                    && anchorPath !== this.currentMarkdownAnchorPath
                )
                || this.host.getPageletDetailPathState?.(anchorPath) === "live"
            ) continue;
            const key = this.agentInsightTicketKey(agentInsight);
            if (this.agentInsightNudgeKeys.has(key)) {
                tickets.push({
                    key,
                    owner: NudgeOwner.AgentInsight,
                    candidate: agentInsight,
                });
            }
        }
        const pattern = this.patternDetectionNudge;
        if (pattern) {
            const key = `${NudgeOwner.Pattern}:${pattern.generatedAt}`;
            if (this.patternDetectionNudgeAdmissionKey === key) {
                tickets.push({ key, owner: NudgeOwner.Pattern, result: pattern });
            }
        }

        const onboarding = this.onboardingNudge;
        if (onboarding) {
            const key = `${NudgeOwner.Onboarding}:${onboarding.kind}:${onboarding.generatedAt}`;
            if (this.onboardingNudgeAdmissionKey === key) {
                tickets.push({ key, owner: NudgeOwner.Onboarding, nudge: onboarding });
            }
        }
        return tickets;
    }

    private admitReturnedAgentInsightsForCurrentNote(): PageletAgentDeliveryCandidate[] {
        const path = this.currentMarkdownAnchorPath;
        if (
            !path
            || !this.host.settings.pagelet.petVisible
            || this.host.settings.focusMode
            || !this.host.isPathAllowedForPagelet(path)
            || this.host.getPageletDetailPathState?.(path) === "live"
        ) return [];

        const candidates = (this.availableAgentInsights.get(path) ?? [])
            .filter(candidate => (
                !this.deliveryCandidateIsSeen(candidate)
                && candidate.pageletAgent.handoff.triggerReason !== "explicit"
            ));
        const admitted: PageletAgentDeliveryCandidate[] = [];
        for (const candidate of candidates) {
            const key = this.agentInsightTicketKey(candidate);
            if (this.agentInsightNudgeKeys.has(key)) {
                admitted.push(candidate);
                continue;
            }
            if (!this.proactiveHints.onInsightsReady()) break;
            this.agentInsightNudgeKeys.add(key);
            admitted.push(candidate);
        }
        return admitted;
    }















    /** SG-06: standard bounded Recap uses the capability toggle directly. */
























    private setPetTaskKind(taskKind: PetTaskKind): void {
        this.petView?.setTaskKind?.(taskKind);
    }

    /** A background Recap owns the Pet only when no task or nudge already owns it. */






    private beginForegroundRoute(
        layout: "summary" | "discover" | "current" | "review",
        taskKind: PetTaskKind,
    ): number | null {
        if (this.sessionManager.isForegroundRunInProgress) {
            new Notice(this.t("pagelet.notice.alreadyReviewing"), 4000);
            return null;
        }
        this.sessionManager.beginForegroundRouteRun();
        const routeToken = ++this.foregroundRouteToken;
        this.currentPanelLayout = layout;
        this.transitionPet("analysis-start", taskKind);
        return routeToken;
    }

    private isCurrentForegroundRoute(routeToken: number): boolean {
        return !this.destroyed && routeToken === this.foregroundRouteToken;
    }

    /**
     * F-06: Settle Pet to idle/nudge when a foreground route completes or
     * becomes stale. Only acts if the given routeToken is still the current
     * foreground owner. Stale owners are silently ignored.
     */
    private settleForForegroundOwner(routeToken: number): void {
        if (!this.isCurrentForegroundRoute(routeToken)) return;
        if (this.petView?.stateMachine?.state === "working") {
            this.transitionPet("analysis-done");
        }
    }

    private withForegroundTimeout<T>(promise: Promise<T>): Promise<T> {
        let timer: ReturnType<typeof setTimeout>;
        const cleanup = (): void => { clearTimeout(timer); this.activeForegroundTimers.delete(timer); };
        return Promise.race([
            promise.finally(cleanup),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => { cleanup(); reject(new Error("Foreground LLM call timed out")); },
                    PageletOrchestrator.FOREGROUND_TIMEOUT_MS);
                this.activeForegroundTimers.add(timer);
            }),
        ]);
    }

    private transitionPet(event: "analysis-start" | "analysis-done" | "insights-ready", taskKind?: PetTaskKind): void {
        if (event === "analysis-start" && taskKind) {
            this.setPetTaskKind(taskKind);
        }
        this.petView?.stateMachine.transition(event);
        if (event !== "analysis-start") this.reconcilePetNudge();
    }

    private reconcilePetNudge(): void {
        if (this.destroyed) return;
        this.bubbleCoordinator.reconcileNudge(this.bubbleView, this.petView);
    }

    private panelExtraForLayout(layoutType: PanelLayoutType): PanelOpenExtra | undefined {
        return this.withReviewQueueExtra(
            this.withContextPagerExtra(undefined, layoutType),
        );
    }

    private withContextPagerExtra(extra: PanelOpenExtra | undefined, layoutType: PanelLayoutType): PanelOpenExtra | undefined {
        if (!this.host.settings.contextPager.enabled) return extra;
        if (extra?.contextPager) return extra;
        const outcome = this.contextPagerOutcomeForPanel(extra, layoutType);
        if (!outcome) return extra;
        return {
            ...(extra ?? {}),
            contextPager: createContextPagerStateFromRetrievalOutcome(outcome, {
                runId: `pagelet-${layoutType}-${outcome.id}`,
                skippedScopes: outcome.missingScopeHints ?? [],
            }),
        };
    }

    private contextPagerOutcomeForPanel(
        extra: PanelOpenExtra | undefined,
        layoutType: PanelLayoutType,
    ): RetrievalOutcome | null {
        const used = new Map<string, PersistedSourceRef>();
        const skipped = new Map<string, RetrievalOutcome["skippedSources"][number]>();
        const addUsedPath = (path: string, whyShown: string[]): void => {
            const normalized = normalizePath(path);
            if (!normalized || used.has(normalized)) return;
            used.set(normalized, toReplaySourceRef({ path: normalized, whyShown }));
        };
        const addSkippedPath = (path: string, reason: "privacy excluded"): void => {
            const normalized = normalizePath(path);
            if (!normalized || skipped.has(normalized)) return;
            skipped.set(normalized, {
                ...toReplaySourceRef({ path: normalized, whyShown: [reason] }),
                skippedReason: reason,
                boundaryReason: "data_boundary",
            });
        };
        if (extra?.sourcePath) addUsedPath(extra.sourcePath, ["Current Pagelet source"]);
        for (const connection of extra?.connections ?? []) {
            addUsedPath(connection.fromNote, ["Connection discovery source"]);
            addUsedPath(connection.toNote, ["Related source"]);
        }
        if (used.size === 0 && (layoutType === "review" || layoutType === "current")) {
            const activePath = this.host.app.workspace.getActiveFile?.()?.path;
            if (activePath?.endsWith(".md")) {
                if (this.host.isPathAllowedForPagelet(activePath)) {
                    addUsedPath(activePath, ["Current note"]);
                } else {
                    addSkippedPath(activePath, "privacy excluded");
                }
            }
        }
        if (used.size === 0 && skipped.size === 0) return null;

        const skippedSources: RetrievalOutcome["skippedSources"] = [];
        skippedSources.push(...skipped.values());
        return {
            id: `${Date.now().toString(36)}-${layoutType}`,
            status: used.size > 0
                ? skippedSources.length > 0 ? "partial_evidence" : "evidence_found"
                : "blocked_by_privacy",
            taskKind: `pagelet_${layoutType}`,
            scope: layoutType,
            sources: [...used.values()],
            skippedSources,
            whyShown: [used.size > 0
                ? "Pagelet used the active anchor and its returned sources"
                : "Pagelet kept the excluded active note outside the request"],
            dataBoundarySnapshotId: "current-policy",
            lanes: ["source", "activity"],
        };
    }

    private withReviewQueueExtra(extra: PanelOpenExtra | undefined): PanelOpenExtra | undefined {
        const scopePaths = this.reviewQueueScopePaths(extra);
        if (scopePaths.length === 0) return extra;
        const items = this.host.listReviewQueueItems({
            scopePaths,
            statuses: ["suggested", "accepted", "edited", "snoozed", "failed"],
        }).filter(reviewQueueItemHasUserIntentOrDurableConsequence);
        if (items.length === 0) return extra;
        return {
            ...(extra ?? {}),
            reviewQueue: {
                items,
                totalCount: items.length,
            },
        };
    }

    private reviewQueueScopePaths(extra: PanelOpenExtra | undefined): string[] {
        const paths = new Set<string>();
        if (extra?.sourcePath) paths.add(normalizePath(extra.sourcePath));
        const activePath = this.host.app.workspace.getActiveFile?.()?.path;
        if (activePath) paths.add(normalizePath(activePath));
        return [...paths];
    }

    private async dismissReviewQueueItem(id: string): Promise<void> {
        const result = await this.host.dismissReviewQueueItem(id);
        if (!result.ok) {
            this.host.log("Failed to dismiss Review Queue item", result.reason);
            return;
        }
        if (this.panelView?.isOpen) {
            const layoutType = this.panelView.currentLayoutType ?? this.currentPanelLayout ?? "review";
            this.panelView.open(
                layoutType,
                this.panelView.currentVisibleFindings,
                this.panelExtraForLayout(layoutType),
            );
        }
    }

    private async runAutomaticDeepDiscover(
        path: string,
        triggerReason: "leave-note" | "edit-idle" | "open-changed-note",
    ): Promise<void> {
        if (
            this.destroyed
            || !this.host.settings.pagelet.enabled
            || !this.host.settings.pagelet.backgroundDiscoveryEnabled
            || !this.host.runDeepDiscover
            || !path.endsWith(".md")
            || !this.host.isPathAllowedForPagelet(path)
        ) return;
        const automaticEpoch = this.backgroundDiscoveryEpoch;
        try {
            const result = await this.host.runDeepDiscover({ path, triggerReason });
            if (
                this.destroyed
                || !this.host.settings.pagelet.enabled
                || !this.host.settings.pagelet.backgroundDiscoveryEnabled
                || automaticEpoch !== this.backgroundDiscoveryEpoch
            ) {
                this.host.discardDeepDiscoverResult?.(result);
                return;
            }
            this.acceptDeepDiscoverResult(result, { path, proactive: true });
        } catch (error) {
            this.host.log("Pagelet Deep Discover background run failed", {
                triggerReason,
                error: error instanceof Error ? error.name : "unknown",
            });
        }
    }

    private async runExplicitDeepDiscover(readingAnchorPath?: string, surface: "panel" | "detail" = "panel"): Promise<void> {
        const activeFile = this.host.app.workspace.getActiveFile?.();
        const path = readingAnchorPath ?? activeFile?.path;
        if (!path?.endsWith(".md")) return;
        if (!this.host.settings.pagelet.enabled || !this.host.runDeepDiscover) {
            new Notice(this.t("pagelet.deepDiscover.unavailable"), 5000);
            return;
        }
        if (!this.host.isPathAllowedForPagelet(path)) {
            new Notice(this.t("pagelet.deepDiscover.boundaryDenied"), 5000);
            return;
        }

        this.invalidateAgentInsightIfPolicyChanged();
        if (surface === "panel" && !this.panelReading && !this.openAgentInsightCandidate) {
            const reading = this.recentReadings.get(path) ?? this.createReading(path);
            this.panelReading = reading;
            this.readingIntent += 1;
            this.renderReadingShell(reading);
        }
        const openingIntent = this.readingIntent;
        const waitingReading = surface === "panel" && this.panelReading?.anchorPath === path && !this.openAgentInsightCandidate
            ? this.panelReading : null;
        const routeToken = ++this.foregroundRouteToken;
        const modelPolicyIdentity = this.host.getDeepDiscoverPolicyIdentity?.();
        this.transitionPet("analysis-start", "connection");
        let result: PageletDeepDiscoverControllerResult | undefined;
        try {
            const pending = this.host.runDeepDiscover({
                path,
                triggerReason: "explicit",
                force: true,
            });
            if (waitingReading) waitingReading.waitingRequestId = this.host.getDeepDiscoverActivity?.(path).requestId ?? null;
            result = await pending;
            if (!this.isCurrentForegroundRoute(routeToken)) {
                this.host.discardDeepDiscoverResult?.(result);
                return;
            }
            let acceptedCandidates: readonly PageletAgentDeliveryCandidate[] = [];
            const accepted = this.acceptDeepDiscoverResult(
                result,
                { path, proactive: false },
                (candidates) => { acceptedCandidates = candidates; },
            );
            if (!this.isCurrentForegroundRoute(routeToken)) {
                this.host.discardDeepDiscoverResult?.(result);
                return;
            }
            if (
                !accepted
                && (result.status === "verified" || result.status === "cache-hit")
            ) return;
            this.host.acknowledgeDeepDiscoverResult?.(result, acceptedCandidates);
            if (accepted) {
                if (waitingReading && this.readingIntentIsCurrent(waitingReading, openingIntent) && !this.openAgentInsightCandidate
                    && (!waitingReading.waitingRequestId || result.requestId === waitingReading.waitingRequestId)) {
                    waitingReading.candidates = [...acceptedCandidates];
                    this.openAgentInsightPanel(accepted, waitingReading);
                } else {
                    this.handleReadingActivity(path);
                }
                return;
            }
            if (result.status === "limit") {
                new Notice(this.t(
                    result.reason === "limit"
                        ? "pagelet.deepDiscover.limitReached"
                        : "pagelet.deepDiscover.unavailable",
                ), 5000);
            } else if (result.status === "denied") {
                new Notice(this.t("pagelet.deepDiscover.boundaryDenied"), 5000);
            } else if (result.status === "error") {
                new Notice(this.t(result.reason === "function-calling-unsupported"
                    ? "pagelet.deepDiscover.functionCallingUnsupported"
                    : "pagelet.panel.status.error"), 5000);
            } else if (
                result.status === "quiet"
                && result.reason === "runtime-incomplete"
                && (result.metrics?.modelTurns ?? 0) > 0
                && result.metrics?.toolCalls === 0
            ) {
                if (this.host.getDeepDiscoverPolicyIdentity?.() !== modelPolicyIdentity) return;
                const capability = await this.host.getDeepDiscoverFunctionCallingCapability?.()
                    .catch(() => "unknown") ?? "unknown";
                if (
                    !this.isCurrentForegroundRoute(routeToken)
                    || this.host.getDeepDiscoverPolicyIdentity?.() !== modelPolicyIdentity
                ) return;
                new Notice(this.t(capability === "unsupported"
                    ? "pagelet.deepDiscover.functionCallingUnsupported"
                    : "pagelet.deepDiscover.noToolCalls"), 5000);
            } else if (result.status === "quiet") {
                const key = result.reason === "no-insight"
                    ? "pagelet.deepDiscover.noInsight"
                    : result.reason === "duplicate" || result.reason === "seen"
                        ? "pagelet.deepDiscover.noNewResults"
                        : result.reason === "aborted"
                            ? "pagelet.deepDiscover.cancelled"
                            : "pagelet.deepDiscover.incomplete";
                new Notice(this.t(key), 5000);
            } else if (result.status === "stale") {
                new Notice(this.t("pagelet.deepDiscover.stale"), 5000);
            }
        } catch (error) {
            if (result) this.host.discardDeepDiscoverResult?.(result);
            if (!this.isCurrentForegroundRoute(routeToken)) return;
            this.host.log("Pagelet Deep Discover foreground run failed", {
                error: error instanceof Error ? error.name : "unknown",
            });
            this.petView?.flashError();
            new Notice(this.t("pagelet.panel.status.error"), 5000);
        } finally {
            this.settleForForegroundOwner(routeToken);
        }
    }

    private acceptDeepDiscoverResult(
        result: PageletDeepDiscoverControllerResult,
        options: { path: string; proactive: boolean },
        onAccepted?: (candidates: readonly PageletAgentDeliveryCandidate[]) => void,
    ): PageletAgentDeliveryCandidate | null {
        if (result.status !== "verified" && result.status !== "cache-hit") return null;
        if (
            result.insight.anchor.path !== options.path
            || this.host.isDeepDiscoverCommitSealCurrent?.(
                result.commitSeal,
                result.collection,
            ) !== true
        ) {
            this.host.discardDeepDiscoverResult?.(result);
            return null;
        }
        const policyIdentity = this.host.getDeepDiscoverPolicyIdentity?.() ?? null;
        if (
            (
                this.agentInsightCandidate
                || this.pendingAgentInsightCandidates.length > 0
                || this.openAgentInsightCandidate
            )
            && this.agentInsightPolicyIdentity !== policyIdentity
        ) {
            this.clearAgentInsight({ closePanel: true });
        }
        const candidates = pageletAgentCollectionToDeliveryCandidates(
            result.collection,
            getPageletUiLanguage(),
        ).map((candidate) => ({
            ...candidate,
            pageletAgent: {
                ...candidate.pageletAgent,
                runIncomplete: result.status === "verified"
                    && result.runtimeCompletion !== undefined
                    && result.runtimeCompletion.loopStatus !== "completed",
            },
        }));
        const candidate = candidates[0];
        if (!candidate) return null;
        const previousAvailable = this.availableAgentInsights.get(options.path) ?? [];
        const collectionIdentity = (value: readonly PageletAgentDeliveryCandidate[]): string => JSON.stringify(
            value.map(item => [item.id, item.preparedAt]),
        );
        const isSameCollection = collectionIdentity(previousAvailable) === collectionIdentity(candidates);
        this.availableAgentInsights.set(options.path, candidates);
        const actionCandidateId = "candidateId" in this.agentInsightHandoffState
            ? this.agentInsightHandoffState.candidateId
            : null;
        if (
            !this.openAgentInsightCandidate
            && !candidates.some((next) => next.id === this.agentInsightCandidate?.id)
            && !candidates.some((next) => next.id === this.openAgentInsightCandidate?.id)
            && !candidates.some((next) => next.id === actionCandidateId)
        ) {
            this.cancelAgentInsightHandoff();
        }
        this.agentInsightCandidate = candidate;
        this.pendingAgentInsightCandidates = candidates.slice(1);
        this.agentInsightAnchorPath = result.insight.anchor.path;
        this.agentInsightPolicyIdentity = policyIdentity;
        this.agentInsightNudgeKeys.clear();

        const canAdmitAtCompletion = (
            this.currentMarkdownAnchorPath === null
            || this.currentMarkdownAnchorPath === options.path
        ) && this.host.getPageletDetailPathState?.(options.path) !== "live";
        const admissionCandidates = options.proactive
            && this.host.settings.pagelet.petVisible
            && !this.host.settings.focusMode
            && canAdmitAtCompletion
            ? candidates.filter((next) => !this.deliveryCandidateIsSeen(next))
            : [];
        for (const next of admissionCandidates) {
            if (this.proactiveHints.onInsightsReady()) {
                this.agentInsightNudgeKeys.add(this.agentInsightTicketKey(next));
            }
        }
        if (this.agentInsightNudgeKeys.size > 0) {
            this.transitionPet("insights-ready");
        } else {
            this.reconcilePetNudge();
        }
        onAccepted?.(candidates);
        if (result.requestId) {
            const currentActivityRequestId = this.host.getDeepDiscoverActivity?.(options.path)?.requestId;
            if (currentActivityRequestId === result.requestId) {
                for (const session of [...this.detailReadingSessions.get(options.path) ?? []]) {
                    session.acceptWaitingResult(result.requestId, candidates);
                }
            }
        }
        if (
            !isSameCollection
            && this.host.getPageletDetailPathState?.(options.path) === "live"
        ) {
            this.host.markPageletDetailNewResults?.(options.path, true);
        }
        const reading = this.panelReading;
        if (reading?.anchorPath === options.path && reading.candidates.length === 0
            && reading.waitingRequestId && this.panelView?.isOpen
            && result.requestId === reading.waitingRequestId
            && this.host.getDeepDiscoverActivity?.(options.path).requestId === reading.waitingRequestId) {
            reading.candidates = candidates;
            this.openAgentInsightPanel(candidate, reading);
        }
        this.handleReadingActivity(options.path);
        return candidate;
    }

    private openAgentInsightPanel(
        candidate: PageletAgentDeliveryCandidate,
        reading?: PageletRecentReading,
    ): void {
        this.readingRevalidationAbortController?.abort();
        if (!reading) {
            this.readingIntent += 1;
            this.readingAbortController?.abort();
            this.readingAbortController = null;
        }
        this.bubbleView?.close();
        this.rememberPanelReadingPosition();
        const path = candidate.pageletAgent.handoff.anchor.path;
        const previous = this.recentReadings.get(path);
        const record = reading ?? (previous?.candidates.some(item => item.id === candidate.id)
            ? previous : this.createReading(path));
        if (!record.candidates.some(item => item.id === candidate.id)) {
            const latest = this.availableAgentInsights.get(path) ?? [];
            record.candidates = latest.some(item => item.id === candidate.id) ? latest : [candidate];
        }
        record.selectedId = candidate.id;
        record.waitingRequestId = null;
        record.emptyReason = undefined;
        this.panelReading = record;
        this.recentReadings.set(path, record);
        this.openAgentInsightCandidate = candidate;
        this.renderAgentInsightPanel(candidate);
        this.scheduleReadingExpiry(candidate);
        const position = record.positions[candidate.id];
        if (position) this.panelView?.restoreReadingPosition?.(position);
        if (!this.panelView?.isOpen) this.openAgentInsightCandidate = null;
        if (this.panelView?.isOpen && candidate.deliveryReceipt) {
            this.attentionStore.markSeen(candidate.deliveryReceipt, "detail");
        }
        this.agentInsightNudgeKeys.delete(this.agentInsightTicketKey(candidate));
        this.reconcilePetNudge();
    }

    private renderAgentInsightPanel(candidate: PageletAgentDeliveryCandidate): void {
        const integration = this.buildAgentInsightFindingIntegration(candidate);
        const reading = this.panelReading;
        const index = reading?.candidates.findIndex(item => item.id === candidate.id) ?? -1;
        const previous = index > 0 ? reading?.candidates[index - 1] : undefined;
        const next = index >= 0 ? reading?.candidates[index + 1] : undefined;
        if (reading && (previous || next)) {
            integration.actions = [
                ...(integration.actions ?? []),
                ...[previous, next].flatMap((target, targetIndex) => target ? [{
                    label: this.t(targetIndex === 0 ? "pagelet.reading.previous" : "pagelet.panel.agentInsight.nextResult"),
                    callback: () => { void this.selectReadingCandidate(reading, target); },
                }] : []),
            ];
        }
        if (candidate.pageletAgent.runIncomplete) {
            integration.actionStatus = {
                ...(integration.actionStatus ?? { label: this.t("pagelet.deepDiscover.incomplete") }),
                detail: this.t("pagelet.deepDiscover.partialResults"),
            };
        }
        const findings: PanelFinding[] = candidate.sourceRefs.length > 0
            ? candidate.sourceRefs.map((source, index) => ({
                title: index === 0 ? candidate.title : (source.title ?? source.path),
                description: index === 0 ? candidate.body : source.path,
                ...(index === 0 ? {
                    insightText: candidate.body,
                    ...integration,
                } : {}),
                sourceFile: source.path,
                sourceTitle: source.title ?? source.path,
            }))
            : [{
                title: candidate.title,
                description: candidate.body,
                insightText: candidate.body,
                ...integration,
        }];
        this.currentPanelLayout = "discover";
        this.panelView?.open("discover", findings, {
            entityId: candidate.id,
            sourcePath: candidate.pageletAgent.handoff.anchor.path,
            ...(reading ? { reading: this.readingControls(reading) } : {}),
        });
    }

    private async selectReadingCandidate(reading: PageletRecentReading, candidate: PageletAgentDeliveryCandidate): Promise<void> {
        const intent = ++this.readingIntent;
        this.readingAbortController?.abort();
        this.readingRevalidationAbortController?.abort();
        this.readingAbortController = new AbortController();
        const signal = this.readingAbortController.signal;
        const valid = await this.validateAgentInsight(candidate, signal).catch(() => false);
        if (signal.aborted || !this.readingIntentIsCurrent(reading, intent)) return;
        if (!valid && candidate.staleStatus !== "stale") {
            reading.candidates = reading.candidates.filter(item => item.id !== candidate.id);
            const latest = this.availableAgentInsights.get(reading.anchorPath);
            if (latest) this.availableAgentInsights.set(reading.anchorPath, latest.filter(item => item.id !== candidate.id));
            new Notice(this.t("pagelet.deepDiscover.stale"), 4000);
            this.refreshOpenAgentInsightPanel();
            return;
        }
        this.cancelAgentInsightHandoff();
        this.openAgentInsightPanel(candidate, reading);
    }

    private refreshOpenAgentInsightPanel(): void {
        const candidate = this.openAgentInsightCandidate;
        if (!candidate || !this.panelView?.isOpen) return;
        this.renderAgentInsightPanel(candidate);
    }

    private buildAgentInsightFindingIntegration(
        candidate: PageletAgentDeliveryCandidate,
    ): Pick<PanelFinding, "actionStatus" | "actions"> {
        if (candidate.staleStatus === "stale") {
            return {
                actionStatus: { label: this.t("pagelet.reading.stale"), tone: "neutral" },
                actions: [{
                    label: this.t("pagelet.panel.agentInsight.discuss"),
                    disabled: true,
                    callback: () => undefined,
                }],
            };
        }
        const state = "candidateId" in this.agentInsightHandoffState
            && this.agentInsightHandoffState.candidateId === candidate.id
            ? this.agentInsightHandoffState
            : ({ kind: "idle" } as const);
        const discussAction = {
            label: this.t("pagelet.panel.agentInsight.discuss"),
            callback: () => { void this.openAgentInsightInChat(candidate); },
        };

        switch (state.kind) {
            case "idle":
                return { actions: [discussAction] };
            case "handoff-opening":
                return {
                    actionStatus: {
                        label: this.t("pagelet.panel.agentInsight.handoffOpening"),
                        busy: true,
                    },
                    actions: [{ ...discussAction, busy: true }],
                };
            case "error":
                return {
                    actionStatus: {
                        label: this.t(agentInsightHandoffErrorLocaleKey(state.error)),
                        tone: "error",
                    },
                    actions: state.error === "stale" ? [] : [discussAction],
                };
        }
    }

    private async openAgentInsightInChat(candidate: PageletAgentDeliveryCandidate): Promise<void> {
        if (!this.isOpenAgentInsight(candidate) || candidate.staleStatus === "stale"
            || candidate.staleStatus === "boundary-changed" || !this.host.openPageletChatHandoff) return;
        const active = this.agentInsightHandoffState;
        if (
            "candidateId" in active
            && active.candidateId === candidate.id
            && active.kind === "handoff-opening"
        ) return;
        const { token, signal } = this.beginAgentInsightHandoff(candidate);
        try {
            if (!await this.validateAgentInsight(candidate, signal)) {
                this.finishAgentInsightHandoffError(candidate, token, "stale");
                return;
            }
            const result = await this.host.openPageletChatHandoff(
                candidate.pageletAgent.handoff,
                signal,
            );
            if (!this.agentInsightHandoffIsCurrent(candidate, token)) return;
            if (result.status === "prepared") {
                this.panelView?.close();
                return;
            }
            const error: PageletInsightHandoffErrorKind = result.status === "busy"
                ? "handoff-busy"
                : result.status === "draft-conflict"
                    ? "handoff-draft"
                    : "handoff-unavailable";
            this.finishAgentInsightHandoffError(candidate, token, error);
        } catch {
            this.finishAgentInsightHandoffError(candidate, token, "handoff-unavailable");
        } finally {
            if (this.agentInsightHandoffToken === token) this.agentInsightHandoffAbortController = null;
        }
    }

    private beginAgentInsightHandoff(
        candidate: PageletAgentDeliveryCandidate,
    ): { token: number; signal: AbortSignal } {
        this.agentInsightHandoffAbortController?.abort();
        const controller = new AbortController();
        this.agentInsightHandoffAbortController = controller;
        const token = ++this.agentInsightHandoffToken;
        this.agentInsightHandoffState = { kind: "handoff-opening", candidateId: candidate.id };
        this.refreshOpenAgentInsightPanel();
        return { token, signal: controller.signal };
    }

    private async validateAgentInsight(
        candidate: PageletAgentDeliveryCandidate,
        signal: AbortSignal,
    ): Promise<boolean> {
        if (!this.readingBoundaryIsCurrent(candidate)) {
            candidate.staleStatus = "boundary-changed";
            return false;
        }
        const valid = await this.host.validateDeepDiscoverInsight?.(
            candidate.pageletAgent.validationIdentity,
            signal,
        ) === true;
        if (signal.aborted) return false;
        candidate.staleStatus = !this.readingBoundaryIsCurrent(candidate) ? "boundary-changed" : valid ? "fresh" : "stale";
        return valid && candidate.staleStatus === "fresh";
    }

    private readingSourcePaths(candidate: PageletAgentDeliveryCandidate): string[] {
        const identity = candidate.pageletAgent.validationIdentity;
        const evidence = identity.inputEvidence;
        return [...new Set([
            identity.cacheIdentity.anchor.path,
            ...identity.cacheIdentity.sources.map(source => source.path),
            ...(evidence?.sourceSnapshots.map(source => source.path) ?? []),
            ...(evidence?.lineage.dependencies.flatMap(dependency => dependency.kind === "vault" ? [dependency.path] : []) ?? []),
            ...(evidence?.vaultObservations.flatMap(observation => observation.items.map(item => item.path)) ?? []),
        ])];
    }

    private readingBoundaryIsCurrent(candidate: PageletAgentDeliveryCandidate): boolean {
        if (this.destroyed || candidate.staleStatus === "boundary-changed"
            || (this.host.getDeepDiscoverPolicyIdentity?.() ?? null) !== this.agentInsightPolicyIdentity) return false;
        return this.readingSourcePaths(candidate).every(path => {
            // A removed source makes the reading out of date; an existing source
            // excluded by current permissions must no longer be displayed.
            return !this.host.app.vault.getAbstractFileByPath(path) || this.host.isPathAllowedForPagelet(path);
        });
    }

    private async revalidateOpenReading(): Promise<void> {
        const candidate = this.openAgentInsightCandidate;
        if (!candidate || !this.panelView?.isOpen) return;
        this.readingRevalidationAbortController?.abort();
        const controller = new AbortController();
        this.readingRevalidationAbortController = controller;
        const intent = this.readingIntent;
        const valid = await this.validateAgentInsight(candidate, controller.signal).catch(() => false);
        if (controller.signal.aborted || intent !== this.readingIntent || this.openAgentInsightCandidate !== candidate) return;
        if (candidate.staleStatus === "boundary-changed") {
            this.panelView?.close();
            return;
        }
        if (!valid) {
            candidate.staleStatus = "stale";
            this.cancelAgentInsightHandoff();
        }
        this.refreshOpenAgentInsightPanel();
    }

    private clearReadingExpiry(): void {
        if (this.readingExpiryTimer !== null) clearPlatformTimeout(this.readingExpiryTimer);
        this.readingExpiryTimer = null;
    }

    private scheduleReadingExpiry(candidate: PageletAgentDeliveryCandidate): void {
        this.clearReadingExpiry();
        const identity = candidate.pageletAgent.validationIdentity;
        if (candidate.staleStatus !== "fresh" || (!identity.webObservations.length
            && !identity.inputEvidence?.lineage.dependencies.some(dependency => dependency.kind === "web"))) return;
        const expiresAt = identity.preparedAt + PAGELET_DEEP_DISCOVER_WEB_CACHE_TTL_MS;
        this.readingExpiryTimer = setPlatformTimeout(() => {
            this.readingExpiryTimer = null;
            if (this.openAgentInsightCandidate === candidate) void this.revalidateOpenReading();
        }, Math.max(0, expiresAt - Date.now()));
    }

    private finishAgentInsightHandoffError(
        candidate: PageletAgentDeliveryCandidate,
        token: number,
        error: PageletInsightHandoffErrorKind,
    ): void {
        if (!this.agentInsightHandoffIsCurrent(candidate, token)) return;
        this.agentInsightHandoffState = { kind: "error", candidateId: candidate.id, error };
        this.refreshOpenAgentInsightPanel();
    }

    private agentInsightHandoffIsCurrent(
        candidate: PageletAgentDeliveryCandidate,
        token: number,
    ): boolean {
        return this.agentInsightHandoffToken === token && this.isOpenAgentInsight(candidate);
    }

    private isOpenAgentInsight(candidate: PageletAgentDeliveryCandidate): boolean {
        return this.openAgentInsightCandidate?.id === candidate.id && this.panelView?.isOpen === true;
    }

    private cancelAgentInsightHandoff(): void {
        this.agentInsightHandoffAbortController?.abort();
        this.agentInsightHandoffAbortController = null;
        this.agentInsightHandoffToken += 1;
        this.agentInsightHandoffState = { kind: "idle" };
    }

    // ======================================================================
    // Pet lifecycle
    // ======================================================================

    /** Re-mount Pet on leaf change. */
    private handleLeafChange(leaf: WorkspaceLeaf | null): void {
        const previousPath = this.currentMarkdownAnchorPath;
        const detailAnchorPath = leaf ? this.host.getPageletDetailLeafAnchorPath?.(leaf) ?? null : null;
        const nextPath = leaf?.view?.getViewType() === "markdown"
            ? (leaf.view as MarkdownView).file?.path ?? null
            : detailAnchorPath;
        const sameNoteReadingTransition = Boolean(previousPath && previousPath === nextPath);
        if (previousPath && previousPath !== nextPath) {
            void this.runAutomaticDeepDiscover(previousPath, "leave-note");
        }
        this.currentMarkdownAnchorPath = nextPath;
        if (nextPath && !sameNoteReadingTransition) {
            void this.runAutomaticDeepDiscover(nextPath, "open-changed-note");
        }

        // Always unmount from previous location
        this.petView?.unmount();
        this.bubbleView?.close();

        // Only mount on markdown views (D029/R1)
        if (!leaf || leaf.view?.getViewType() !== "markdown") return;
        if (!this.host.settings.pagelet.petVisible) return;

        const markdownView = leaf.view as MarkdownView;
        const containerEl = markdownView.contentEl;
        if (!containerEl) return;

        // Lazy-create Pet on first eligible leaf
        if (!this.petView) {
            this.petView = new PetView({
                corner: this.host.settings.pagelet.petCorner,
                getLocale: getPageletUiLanguage,
                callbacks: {
                    onToggleBubble: () => this.handlePetClick(),
                    onQuickCaptureOpen: () => this.host.openQuickCapture(),
                    onReviewCurrentNote: () => { void this.runExplicitDeepDiscover(); },
                    onDiscoverConnections: () => { void this.runExplicitDeepDiscover(); },
                    onShareCard: () => this.shareActiveNoteOrSelectionAsCard(),
                    onActionRingWillOpen: () => {
                        this.bubbleView?.close({ restoreFocus: false });
                    },
                    onActionRingClosed: () => this.handleActionRingClosed(),
                },
            });
            // Sync proactive-hints flag into state machine
            this.petView.stateMachine.proactiveHintsEnabled =
                this.host.settings.pagelet.proactiveHints;
        }

        this.petView.mount(containerEl);
        this.reconcilePetNudge();
    }

    private handleFileOpen(): void {
        const activeLeaf = this.getCurrentWorkspaceLeaf();
        this.handleLeafChange(activeLeaf ?? null);
    }

    /** Handle a click/tap on the Pet element. Suppressed by Focus Mode. */
    private handlePetClick(): void {
        if (this.host.settings.focusMode) return;
        this.bubbleCoordinator.handlePetClick(this.bubbleView, this.petView);
    }

    private handleActionRingClosed(): void {
        // Closing never steals focus on the action path, but a delivery that
        // arrived while the Ring was open must regain Pet ownership after
        // both passive and action closes.
        this.reconcilePetNudge();
    }

    private shareActiveNoteOrSelectionAsCard(): void {
        const view = this.host.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file) {
            new Notice(this.t("pagelet.notice.shareCardNoMarkdown"), 4000);
            this.petView?.rootEl?.focus();
            return;
        }
        const data = this.projectShareCardData(view);
        if (!data) {
            new Notice(this.t("pagelet.notice.shareCardEmpty"), 4000);
            view.editor?.focus();
            return;
        }
        new ShareCardModal(this.host.app, data).open();
    }

    private projectShareCardData(view: MarkdownView): ShareCardData | null {
        const file = view.file;
        if (!file) return null;
        const editor = view.editor;
        const rawSelection = editor?.getSelection?.() ?? "";
        const basePath = file.path;
        const selectionData = createShareCardSelectionData(rawSelection, basePath);
        if (selectionData) return selectionData;
        const rawNote = editor?.getValue?.() ?? "";
        return createShareCardNoteData(rawNote, file.basename, basePath);
    }

    private syncPetVisibility(): void {
        if (!this.host.settings.pagelet.petVisible) {
            this.petView?.destroy();
            this.petView = null;
            this.bubbleView?.close();
            this.reconcilePetNudge();
            return;
        }

        const activeLeaf = this.getCurrentWorkspaceLeaf();
        if (activeLeaf) {
            this.handleLeafChange(activeLeaf);
        }
    }

    // ======================================================================
    // Idle timer + note activity
    // ======================================================================

    /** Debounced note-activity handler. */
    private handleNoteActivity(modifiedPath?: string): void {
        const debounceKey = modifiedPath ? normalizePath(modifiedPath) : "__pagelet_activity__";
        this.clearActivityDebounce(debounceKey);
        const timer = setPlatformTimeout(() => {
            this.activityDebounceTimers.delete(debounceKey);
            this.petView?.stateMachine.transition("note-activity");
            if (modifiedPath) {
                void this.runAutomaticDeepDiscover(modifiedPath, "edit-idle");
            }
            this.resetIdleTimer();
        }, PageletOrchestrator.ACTIVITY_DEBOUNCE_MS);
        this.activityDebounceTimers.set(debounceKey, timer);
    }







    /** (Re)start the idle timer. When it fires, Pet enters resting. */
    private resetIdleTimer(): void {
        this.clearIdleTimer();
        this.idleTimer = setPlatformTimeout(() => {
            this.idleTimer = null;
            this.petView?.stateMachine.transition("long-idle");
        }, PageletOrchestrator.IDLE_TIMEOUT_MS);
    }

    private clearIdleTimer(): void {
        if (this.idleTimer !== null) {
            clearPlatformTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }

    private clearActivityDebounce(path?: string): void {
        if (path !== undefined) {
            const timer = this.activityDebounceTimers.get(path);
            if (timer !== undefined) {
                clearPlatformTimeout(timer);
                this.activityDebounceTimers.delete(path);
            }
            return;
        }
        for (const timer of this.activityDebounceTimers.values()) {
            clearPlatformTimeout(timer);
        }
        this.activityDebounceTimers.clear();
    }

    // ======================================================================
    // Command helpers
    // ======================================================================

    /** Cycle Pet corner: BR -> BL -> TR -> TL -> BR. */
    private cyclePetCorner(): void {
        const corners: PetCorner[] = [
            "bottom-right",
            "bottom-left",
            "top-right",
            "top-left",
        ];
        const currentIdx = corners.indexOf(
            this.petView?.corner ?? "bottom-right",
        );
        const nextCorner = corners[(currentIdx + 1) % corners.length];
        this.petView?.setCorner(nextCorner);
        this.bubbleView?.close();
        this.host.updatePageletSetting("petCorner", nextCorner);
    }

    private toggleProactiveHints(): void {
        const newState = this.proactiveHints.toggle();
        if (!newState) this.clearGenericNudgeAdmissions();
        if (this.petView) {
            this.petView.stateMachine.proactiveHintsEnabled = newState;
        }
        this.host.updatePageletSetting("proactiveHints", newState);
        this.reconcilePetNudge();
    }

    /** Toggle Pet visibility (persisted). */
    private togglePetVisibility(): void {
        if (this.host.settings.pagelet.petVisible) {
            this.petView?.destroy();
            this.petView = null;
            this.bubbleView?.close();
            this.host.updatePageletSetting("petVisible", false);
            this.reconcilePetNudge();
        } else {
            this.host.updatePageletSetting("petVisible", true);
            const activeLeaf = this.getCurrentWorkspaceLeaf();
            if (activeLeaf) {
                this.handleLeafChange(activeLeaf);
            }
            this.reconcilePetNudge();
        }
    }

    /** Preserve the stable command while reporting the unified Agent lane. */
    private async showBackgroundPreparationStatusNotice(): Promise<void> {
        if (!this.host.getDeepDiscoverUsage) {
            new Notice(this.t("pagelet.deepDiscover.usageUnavailable"), 5000);
            return;
        }
        try {
            const usage = await this.host.getDeepDiscoverUsage();
            new Notice(this.t("pagelet.settings.deepDiscover.usage.value", {
                runs: usage.runs,
                dailyCap: usage.dailyCap,
                modelTurns: usage.modelTurns,
                toolCalls: usage.toolCalls,
            }), 8000);
        } catch (error) {
            this.host.log("Pagelet Deep Discover usage unavailable", error);
            new Notice(this.t("pagelet.deepDiscover.usageUnavailable"), 5000);
        }
    }

    // ======================================================================
    // Bubble / Panel callbacks
    // ======================================================================

    private handleNudgePresented(ticket: NudgeTicket): void {
        switch (ticket.owner) {
            case NudgeOwner.AgentInsight:
                this.agentInsightNudgeKeys.delete(ticket.key);
                return;
            case NudgeOwner.Pattern:
                if (this.patternDetectionNudgeAdmissionKey === ticket.key) {
                    this.patternDetectionNudgeAdmissionKey = null;
                    if (this.patternDetectionNudge?.generatedAt === ticket.result.generatedAt) {
                        this.patternDetectionNudge = null;
                    }
                }
                return;
            case NudgeOwner.Onboarding:
                if (this.onboardingNudgeAdmissionKey === ticket.key) {
                    this.onboardingNudgeAdmissionKey = null;
                    if (this.onboardingNudge?.generatedAt === ticket.nudge.generatedAt) {
                        this.onboardingNudge = null;
                    }
                }
                if (
                    ticket.nudge.kind === "maintenance_scan"
                    && !this.host.settings.pagelet.maintenanceScanSuggested
                ) {
                    this.host.updatePageletSetting("maintenanceScanSuggested", true);
                }
                if (
                    ticket.nudge.kind === "quick_capture"
                    && !this.host.settings.pagelet.quickCaptureExplained
                ) {
                    this.host.updatePageletSetting("quickCaptureExplained", true);
                }
        }
    }

    /** Expand Bubble -> Panel. */
    private handleExpandPanel(type?: string): void {
        const requestedType = type === "writing" ? "current" : type;

        this.bubbleView?.close();
        const isKnownLayout = requestedType === "review"
            || requestedType === "current"
            || requestedType === "discover"
            || requestedType === "summary";
        let layoutType: PanelLayoutType = "review";
        if (isKnownLayout) {
            layoutType = requestedType;
        }
        this.currentPanelLayout = layoutType;
        this.panelView?.open(
            layoutType,
            [],
            this.panelExtraForLayout(layoutType),
        );
    }

    /** Expand Panel -> Tab. */
    private async expandPanelToTab(): Promise<void> {
        this.rememberPanelReadingPosition();
        const reading = this.panelReading;
        const intent = this.readingIntent;
        const layoutType = this.panelView?.currentLayoutType ?? this.currentPanelLayout ?? "review";
        const panelFindings = this.panelView?.currentVisibleFindings ?? [];
        const panelExtra = this.panelView?.currentPanelExtra;
        const sourcePath = panelExtra?.sourcePath;
        const tabExtra = this.withGlobalLedgerExtra(
            this.withGlobalReviewQueueExtra(panelExtra ?? this.panelExtraForLayout(layoutType)),
        );
        const locale = getPageletUiLanguage();
        const title = pageletT("pagelet.tab.title", locale);
        const hasPanelContent = panelFindings.length > 0
            || Boolean(tabExtra?.connections && tabExtra.connections.length > 0)
            || Boolean(tabExtra?.markdown)
            || Boolean(tabExtra?.contextPager)
            || Boolean(tabExtra?.savedInsights && tabExtra.savedInsights.items.length > 0)
            || Boolean(tabExtra?.memoryGovernance && (tabExtra.memoryGovernance.records.length > 0 || (tabExtra.memoryGovernance.candidates?.length ?? 0) > 0 || (tabExtra.memoryGovernance.routedItems?.length ?? 0) > 0))
            || Boolean(tabExtra?.maintenanceReview)
            || Boolean(tabExtra?.graphDiscovery);
        const findings = hasPanelContent ? panelFindings : [];
        const detailExtra = this.detailExtraForTab(tabExtra);
        const payload: PageletDetailPayload = {
            title,
            content: findings,
            locale,
            layoutType,
            entryReason: "panel-expand",
            ...(reading ? { reading: this.detailReadingPayload(reading) } : {}),
        };
        if (detailExtra) {
            payload.extra = detailExtra;
        }
        if (sourcePath) {
            payload.sourcePath = sourcePath;
        }
        try {
            const opened = this.host.openPageletDetailView(payload);
            if (opened) await opened;
            if (this.readingIntent !== intent) return;
            this.preservePanelSessionOnClose = true;
            try { this.panelView?.close(); } finally { this.preservePanelSessionOnClose = false; }
            this.cancelAgentInsightHandoff();
            this.panelReading = null;
            this.openAgentInsightCandidate = null;
            this.readingRevalidationAbortController?.abort();
            this.clearReadingExpiry();
            this.readingIntent += 1;
        } catch (error: unknown) {
            this.host.log("Failed to open Pagelet detail view", error);
            new Notice(this.t("pagelet.panel.status.error"), 4000);
        }
    }

    private withGlobalReviewQueueExtra(extra: PanelOpenExtra | undefined): PanelOpenExtra | undefined {
        const items = this.host.listReviewQueueItems({
            statuses: ["suggested", "accepted", "edited", "snoozed", "applied", "dismissed", "expired", "failed", "undone"],
        });
        if (items.length === 0) return extra;
        return {
            ...(extra ?? {}),
            reviewQueue: {
                items,
                totalCount: items.length,
            },
        };
    }

    private withGlobalLedgerExtra(extra: PanelOpenExtra | undefined): PanelOpenExtra | undefined {
        const savedInsights = this.host.listSavedInsights();
        const rawMemoryState: PanelMemoryGovernanceState = this.host.getMemoryGovernancePanelState?.()
            ?? (() => {
                const records = this.host.listConfirmedMemories();
                return { records, totalCount: records.length };
            })();
        const memoryState: PanelMemoryGovernanceState = rawMemoryState.governanceMode === "effect_based"
            ? buildContextualGovernedMemoryState(
                rawMemoryState,
                extra?.usedGovernedMemoryClaimIds,
            )
            : rawMemoryState;
        const memories = memoryState.records;
        const memoryCandidates = this.host.listReviewQueueItems({
            types: ["memory_candidate", "memory_conflict"],
            statuses: ["suggested", "edited", "snoozed"],
        });
        if (savedInsights.length === 0
            && memories.length === 0
            && memoryCandidates.length === 0
            && (memoryState.recentChanges?.length ?? 0) === 0) return extra;
        return {
            ...(extra ?? {}),
            ...(savedInsights.length > 0 ? {
                savedInsights: {
                    items: savedInsights,
                    totalCount: savedInsights.length,
                },
            } : {}),
            ...(memories.length > 0 ? {
                memoryGovernance: {
                    ...memoryState,
                    records: memories,
                    ...(memoryCandidates.length > 0 ? { candidates: memoryCandidates } : {}),
                    totalCount: memories.length + memoryCandidates.length,
                    ...(memoryState.governanceMode !== "effect_based"
                        && memoryState.governanceMode !== "unavailable" ? {
                        confirmedMemoryCount: this.host.settings.confirmedMemoryCount ?? 0,
                    } : {}),
                },
            } : memoryCandidates.length > 0 || (memoryState.recentChanges?.length ?? 0) > 0 ? {
                memoryGovernance: {
                    ...memoryState,
                    records: [],
                    ...(memoryCandidates.length > 0 ? { candidates: memoryCandidates } : {}),
                    totalCount: memoryCandidates.length,
                    ...(memoryState.governanceMode !== "effect_based"
                        && memoryState.governanceMode !== "unavailable" ? {
                        confirmedMemoryCount: this.host.settings.confirmedMemoryCount ?? 0,
                    } : {}),
                },
            } : {}),
        };
    }

    private detailExtraForTab(extra: PanelOpenExtra | undefined): PageletDetailPayload["extra"] | undefined {
        if (!extra) return undefined;
        const detailExtra: PageletDetailPayload["extra"] = {};
        if (extra.connections && extra.connections.length > 0) {
            detailExtra.connections = extra.connections;
        }
        if (typeof extra.markdown === "string") {
            detailExtra.markdown = extra.markdown;
        }
        if (extra.memoryGovernance) {
            detailExtra.memoryGovernance = extra.memoryGovernance;
        }
        if (extra.maintenanceReview) {
            detailExtra.maintenanceReview = extra.maintenanceReview;
        }
        if (extra.reviewQueue) {
            const { memory, maintenance } = splitReviewQueueForSections(extra.reviewQueue.items);
            if (memory.length > 0) {
                detailExtra.memoryGovernance = {
                    ...(detailExtra.memoryGovernance ?? { records: [], totalCount: 0 }),
                    routedItems: memory,
                };
                detailExtra.memoryGovernance.totalCount = (detailExtra.memoryGovernance.totalCount ?? 0) + memory.length;
            }
            if (maintenance.length > 0) {
                detailExtra.maintenanceReview = {
                    ...(detailExtra.maintenanceReview ?? { proposals: [], categories: [], totalCount: 0, generatedAt: "", previewOnly: true as const, weeklyScanEnabled: false as const }),
                    routedItems: maintenance,
                };
            }
        }
        if (extra.contextPager) {
            detailExtra.contextPager = extra.contextPager;
        }
        if (extra.savedInsights) {
            detailExtra.savedInsights = extra.savedInsights;
        }
        if (extra.graphDiscovery) {
            detailExtra.graphDiscovery = extra.graphDiscovery;
        }
        if (extra.patternDetection) {
            detailExtra.patternDetection = extra.patternDetection;
        }
        return detailExtra.connections || detailExtra.markdown !== undefined || detailExtra.contextPager || detailExtra.savedInsights || detailExtra.memoryGovernance || detailExtra.maintenanceReview || detailExtra.graphDiscovery || detailExtra.patternDetection
            ? detailExtra
            : undefined;
    }

    /** Share only the Panel findings that are still visible. */
    private sharePanelAsCard(request: PanelShareCardRequest): void {
        const panelView = this.panelView;
        if (!panelView) return;

        const visibleFindings = new Set(panelView.currentShareCardFindings);
        const findings = request.findings.filter((finding) => visibleFindings.has(finding));
        if (findings.length === 0) return;

        const content = serializePageletFindings(findings);
        if (content.trim().length === 0) return;

        new ShareCardModal(this.host.app, {
            content,
            source: "pagelet",
            sourceLabel: "PA Pagelet",
            ...(panelView.currentPanelExtra?.sourcePath
                ? { resourceContext: { basePath: panelView.currentPanelExtra.sourcePath } }
                : {}),
        }).open();
    }

    /** Save Panel findings as review note. */
    private async saveFindingsAsReviewNote(findings: PanelFinding[]): Promise<void> {
        await this.saveFlow.saveFindingsAsReviewNote(findings, this.currentPanelLayout);
    }

    private clearPanelSession(): void {
        if (this.preservePanelSessionOnClose) return;
        if (this.saveFlow.isSaveInProgress) return;
        this.rememberPanelReadingPosition();
        this.cancelAgentInsightHandoff();
        this.readingIntent += 1;
        this.readingAbortController?.abort();
        this.readingAbortController = null;
        this.readingRevalidationAbortController?.abort();
        this.readingRevalidationAbortController = null;
        this.clearReadingExpiry();
        this.panelReading = null;
        this.openAgentInsightCandidate = null;
        this.currentPanelLayout = null;
    }

    /** Navigate to a source note by vault path. */
    private handleSourceClick(link: string): void {
        const file = this.host.app.vault.getAbstractFileByPath(link);
        if (!file) return;
        const leaf = this.host.app.workspace.getMostRecentLeaf();
        if (leaf) void leaf.openFile(file as Parameters<WorkspaceLeaf["openFile"]>[0]);
    }

    private handleRelatedNoteClick(noteName: string, sourcePath?: string): void {
        const file = resolveRelatedMarkdownNote(this.host.app, noteName, sourcePath);
        if (!file) {
            new Notice(this.t("pagelet.panel.status.relatedMissing"), 3000);
            return;
        }
        const leaf = this.host.app.workspace.getMostRecentLeaf();
        if (!leaf) return;
        void leaf.openFile(file).then(() => {
            new Notice(this.t("pagelet.panel.status.relatedOpened"), 2500);
        });
    }

    private async handleResearchFinding(finding: PanelFinding): Promise<void> {
        const suggestion = finding.suggestion;
        const findingText = suggestion
            ? `${suggestion.rationale}\n${suggestion.proposed_action}`
            : finding.description || finding.insightText || finding.title;
        await this.researchManager.research({
            findingText,
            sourceFile: finding.sourceFile,
            sourceTitle: finding.sourceTitle || finding.title,
        });
    }

    private async handlePatternDetectionBubbleView(result: PatternDetectionResult): Promise<void> {
        this.patternDetectionNudge = null;
        this.patternDetectionNudgeAdmissionKey = null;
        const locale = getPageletUiLanguage();
        const payload: PageletDetailPayload = {
            title: pageletT("pagelet.tab.patterns.title", locale),
            content: [],
            locale,
            layoutType: "review",
            extra: { patternDetection: result },
            entryReason: "pattern-detection",
        };
        await Promise.resolve(this.host.openPageletDetailView(payload));
    }

    private handlePatternDetectionBubbleDismiss(result: PatternDetectionResult): void {
        if (!this.patternDetectionNudge || this.patternDetectionNudge.generatedAt === result.generatedAt) {
            this.patternDetectionNudge = null;
            this.patternDetectionNudgeAdmissionKey = null;
        }
    }

    private handleOnboardingNudgeDismiss(nudge: OnboardingNudge): void {
        if (!this.onboardingNudge || this.onboardingNudge.generatedAt === nudge.generatedAt) {
            this.onboardingNudge = null;
            this.onboardingNudgeAdmissionKey = null;
        }
    }

    /** Handle Bubble dismiss. Hook exists for future telemetry. */
    private handleBubbleDismiss(): void { /* no-op */ }
}

function agentInsightHandoffErrorLocaleKey(error: PageletInsightHandoffErrorKind): string {
    switch (error) {
        case "stale":
            return "pagelet.panel.agentInsight.stale";
        case "handoff-busy":
            return "pagelet.panel.agentInsight.handoffBusy";
        case "handoff-draft":
            return "pagelet.panel.agentInsight.handoffDraft";
        case "handoff-unavailable":
            return "pagelet.panel.agentInsight.handoffUnavailable";
    }
}
