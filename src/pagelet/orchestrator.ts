/* Copyright 2023 edonyzpc */

/**
 * Pagelet Orchestrator -- central integration layer.
 *
 * Coordinates Pet, Bubble, Panel, Tab, and foreground review. Delegates
 * analysis to {@link AnalysisSessionManager}, note-saving to
 * {@link ReviewNoteSaveFlow}, and bubble display to {@link BubbleCoordinator}.
 */

import {
    getFrontMatterInfo,
    MarkdownView,
    Notice,
    parseYaml,
    normalizePath,
} from "obsidian";
import type { WorkspaceLeaf } from "obsidian";

import { getPageletUiLanguage, pageletT } from "../locales/pagelet";
import { formatOperationsPreview } from "../ai-services/operations/operations-presentation";
import type {
    OperationsExecutionResult,
    OperationsIntent,
    UndoResult,
} from "../ai-services/operations/types";
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
} from "./panel/types";
import type { PageletCommandCallbacks } from "./commands";
import { ProactiveHints } from "./hints/ProactiveHints";
import type { PetCorner, PetTaskKind } from "./pet/types";
import { PetView } from "./pet/PetView";
import { PreloadBudget } from "./preload/PreloadBudget";
import { getPageletOverlayRoot } from "./overlay-root";
import { ResearchManager } from "./research";

import { AnalysisSessionManager } from "./AnalysisSessionManager";
import { BubbleCoordinator, NudgeOwner, type NudgeTicket } from "./BubbleCoordinator";
import { ReviewNoteSaveFlow } from "./ReviewNoteSaveFlow";
import type { PageletHost } from "./PageletHost";
import { serializePageletFindings } from "../share-card/share-card-markdown";
import { ShareCardModal } from "../share-card/share-card-modal";
import type { ShareCardData } from "../share-card/share-card-types";
import {
    pageletAgentCollectionToDeliveryCandidates,
} from "./agent/delivery-adapter";
import type { PageletAgentDeliveryCandidate } from "./agent/delivery-adapter";
import type { PageletDeepDiscoverControllerResult } from "./agent/types";
import { resolveRelatedMarkdownNote } from "./related-note";
import type { PageletDetailPayload } from "./tab/types";
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

type PageletInsightActionErrorKind =
    | "failed"
    | "stale"
    | "operations-unavailable"
    | "handoff-busy"
    | "handoff-draft"
    | "handoff-unavailable";

type PageletInsightActionState =
    | { kind: "idle" }
    | { kind: "staging"; candidateId: string }
    | { kind: "pending"; candidateId: string; intent: OperationsIntent }
    | { kind: "executing"; candidateId: string; intent: OperationsIntent }
    | { kind: "result"; candidateId: string; result: OperationsExecutionResult }
    | { kind: "undoing"; candidateId: string; result: OperationsExecutionResult }
    | { kind: "undone"; candidateId: string; results: readonly UndoResult[] }
    | { kind: "handoff-opening"; candidateId: string }
    | { kind: "error"; candidateId: string; error: PageletInsightActionErrorKind };

export class PageletOrchestrator {
    // ---- Components -------------------------------------------------------
    private petView: PetView | null = null;
    private bubbleView: BubbleView | null = null;
    private panelView: PanelView | null = null;
    private currentPanelLayout: PanelLayoutType | null = null;
    private preservePanelSessionOnClose = false;
    private readonly handleEscape: (e: KeyboardEvent) => void;
    private readonly handleQuietRecallShortcut: (e: KeyboardEvent) => void;
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
    private readonly agentInsightNudgeKeys = new Set<string>();
    private agentInsightActionState: PageletInsightActionState = { kind: "idle" };
    private agentInsightActionToken = 0;
    private agentInsightActionAbortController: AbortController | null = null;
    private onboardingNudge: OnboardingNudge | null = null;
    private onboardingNudgeAdmissionKey: string | null = null;
    get hasActiveOnboardingNudge(): boolean { return this.onboardingNudge !== null; }
    private patternDetectionNudge: PatternDetectionResult | null = null;
    private patternDetectionNudgeAdmissionKey: string | null = null;
    private lastQuietRecallCtrlKeydownAt = 0;
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
    private static readonly QUIET_RECALL_DOUBLE_CTRL_MS = 300;

    constructor(private readonly host: PageletHost) {
        const s = host.settings.pagelet;
        this.backgroundDiscoveryEnabled = s.backgroundDiscoveryEnabled;
        this.attentionStore = new AttentionAwareDeliveryStore({
            storage: host.createPageletAttentionStorage?.(),
            onDiagnostic: (diagnostic) => {
                host.log("Pagelet attention delivery storage fallback", diagnostic);
            },
        });
        // Scope infrastructure
        const foregroundBudget = new PreloadBudget(
            s.foregroundPerHourCap,
            s.foregroundPerDayCap,
        );
        // Delegate: analysis session manager
        this.sessionManager = new AnalysisSessionManager(host, foregroundBudget);

        // Delegate: review note save flow
        this.saveFlow = new ReviewNoteSaveFlow(host, {
            petTransition: (event) => this.transitionPet(event, "review"),
            petFlashError: () => this.petView?.flashError(),
            closePanel: () => this.panelView?.close(),
            getAnalysisSourcePath: () => this.sessionManager.analysisSourcePath,
        });

        // Proactive hints
        this.proactiveHints = new ProactiveHints({
            enabled: s.proactiveHints,
            cooldownMinutes: s.proactiveHintsCooldown,
            quietHours: s.proactiveHintsQuietHours,
        });

        // Delegate: bubble coordinator (after proactiveHints)
        this.bubbleCoordinator = new BubbleCoordinator(host, this.proactiveHints, {
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
            isExplanationAcknowledged: (kind, copyVersion) => (
                this.attentionStore.isExplanationAcknowledged(kind, copyVersion)
            ),
            onExplanationVisible: (kind, copyVersion) => {
                this.attentionStore.acknowledgeExplanation(kind, copyVersion);
            },
        });

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
        this.handleQuietRecallShortcut = (e: KeyboardEvent) => {
            if (e.key !== "Control" || e.repeat || e.metaKey || e.altKey || e.shiftKey) return;
            if (this.host.settings.focusMode || !this.host.settings.pagelet.enabled) return;
            const now = Date.now();
            if (now - this.lastQuietRecallCtrlKeydownAt <= PageletOrchestrator.QUIET_RECALL_DOUBLE_CTRL_MS) {
                this.lastQuietRecallCtrlKeydownAt = 0;
                e.preventDefault();
                void this.runExplicitDeepDiscover();
                return;
            }
            this.lastQuietRecallCtrlKeydownAt = now;
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
                onRunReview: () => this.reviewCurrentNote(),
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
        this.escapeListenerDocument.addEventListener("keydown", this.handleQuietRecallShortcut, true);

        // 2. Workspace event: re-mount Pet when the active leaf changes
        this.host.registerEvent(
            this.host.app.workspace.on("active-leaf-change", (leaf) => {
                this.handleLeafChange(leaf);
            }),
        );
        this.host.registerEvent(
            this.host.app.workspace.on("file-open", () => {
                this.handleFileOpen();
            }),
        );

        // 3. Vault events: markdown-only activity tracking
        this.host.registerEvent(
            this.host.app.vault.on("modify", (file) => {
                if (file.path.endsWith(".md")) {
                    this.handleMarkdownModify(file.path);
                }
            }),
        );
        this.host.registerEvent(
            this.host.app.vault.on("delete", (file) => {
                if (file.path.endsWith(".md")) {
                    this.invalidateAgentInsightForPaths([file.path]);
                }
            }),
        );
        this.host.registerEvent(
            this.host.app.vault.on("rename", (file, oldPath) => {
                if (file.path.endsWith(".md") || oldPath.endsWith(".md")) {
                    this.invalidateAgentInsightForPaths([oldPath, file.path]);
                }
            }),
        );

        // 4. Mount Pet on whatever leaf is currently active. Deep Discover
        // owns all provider-backed background work; legacy preload stays dormant.
        const initialLeaf = this.getCurrentWorkspaceLeaf();
        if (initialLeaf) {
            this.handleLeafChange(initialLeaf);
        }

        // 5. Begin idle tracking
        this.resetIdleTimer();
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
        this.escapeListenerDocument?.removeEventListener("keydown", this.handleQuietRecallShortcut, true);
        this.escapeListenerDocument = null;
        this.host.cancelDeepDiscover?.();
        this.cancelPendingAgentInsightAction();
        this.clearAgentInsight();
        this.bubbleCoordinator.destroy();
        this.petView?.destroy();
        this.bubbleView?.destroy();
        this.panelView?.destroy();

        this.petView = null;
        this.bubbleView = null;
        this.panelView = null;
    }

    /** Apply latest settings to all runtime collaborators. */
    syncSettings(): void {
        if (this.destroyed) return;
        const s = this.host.settings.pagelet;
        if (this.backgroundDiscoveryEnabled !== s.backgroundDiscoveryEnabled) {
            this.backgroundDiscoveryEnabled = s.backgroundDiscoveryEnabled;
            this.backgroundDiscoveryEpoch += 1;
        }
        this.sessionManager.syncBudget();
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
        const operationsAvailable = this.operationsAvailable();
        if (!operationsAvailable && this.agentInsightActionState.kind === "pending") {
            this.cancelPendingAgentInsightAction();
            this.refreshOpenAgentInsightPanel();
        } else if (
            this.agentInsightActionState.kind === "idle"
            || this.agentInsightActionState.kind === "error"
        ) {
            if (
                operationsAvailable
                && this.agentInsightActionState.kind === "error"
                && this.agentInsightActionState.error === "operations-unavailable"
            ) {
                this.agentInsightActionState = { kind: "idle" };
            }
            // Settings are live. Re-project idle/error actions so an already-open
            // Panel never keeps a stale enabled or disabled Operations control.
            this.refreshOpenAgentInsightPanel();
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
            onOpenPreparedReview: () => this.openPreparedReview(),
            onReviewCurrent: () => this.runExplicitDeepDiscover(),
            onQuickReview: () => this.runExplicitDeepDiscover(),
            onDiscoverConnections: () => this.runExplicitDeepDiscover(),
            onMaintenanceReview: () => this.runMaintenanceReview(),
            onQuietRecall: () => this.runExplicitDeepDiscover(),
            onGraphDiscovery: () => this.runGraphDiscovery(),
            onScopeRecap: () => this.runExplicitDeepDiscover(),
            onClearScopeRecapCache: () => this.clearScopeRecapCache(),
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

    openPanel(): void {
        this.handleExpandPanel("review");
    }

    openPreparedReview(): void {
        void this.runExplicitDeepDiscover();
    }

    openQuickReview(): void {
        void this.runExplicitDeepDiscover();
    }

    clearScopeRecapCache(): void {
        this.host.clearScopeRecapDetailSessionCache?.();
        this.host.updatePageletSetting("scopeRecapNudgeSuppressions", []);
        new Notice(this.t("pagelet.recap.cacheCleared"), 4000);
    }

    async reviewCurrentNote(): Promise<void> {
        await this.runExplicitDeepDiscover();
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

    async runQuietRecall(): Promise<void> {
        await this.runExplicitDeepDiscover();
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

    async runScopeRecap(): Promise<void> {
        await this.runExplicitDeepDiscover();
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
        this.cancelPendingAgentInsightAction();
        this.agentInsightCandidate = null;
        this.pendingAgentInsightCandidates = [];
        this.agentInsightAnchorPath = null;
        this.agentInsightPolicyIdentity = null;
        this.agentInsightNudgeKeys.clear();
        if (options.closePanel && this.openAgentInsightCandidate) {
            this.openAgentInsightCandidate = null;
            this.panelView?.close();
        }
    }

    private invalidateAgentInsightIfPolicyChanged(): void {
        if (
            !this.agentInsightCandidate
            && this.pendingAgentInsightCandidates.length === 0
            && !this.openAgentInsightCandidate
        ) return;
        const current = this.host.getDeepDiscoverPolicyIdentity?.() ?? null;
        if (current === this.agentInsightPolicyIdentity) return;
        this.clearAgentInsight({ closePanel: true });
    }

    private invalidateAgentInsightForPaths(paths: readonly string[]): void {
        const changed = new Set(paths.map((path) => normalizePath(path)));
        const touches = (
            candidate: PageletAgentDeliveryCandidate | null,
        ): boolean => Boolean(candidate && [
            candidate.pageletAgent.validationIdentity.cacheIdentity.anchor,
            ...candidate.pageletAgent.validationIdentity.cacheIdentity.sources,
        ].some((source) => changed.has(normalizePath(source.path))));
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
        if (invalidatesCurrent || invalidatesOpen) this.cancelPendingAgentInsightAction();
        if (invalidatesCurrent) {
            this.agentInsightCandidate = this.pendingAgentInsightCandidates.shift() ?? null;
            if (!this.agentInsightCandidate) this.agentInsightAnchorPath = null;
        }
        if (invalidatesOpen) {
            this.openAgentInsightCandidate = null;
            this.panelView?.close();
        }
        if (
            !this.agentInsightCandidate
            && this.pendingAgentInsightCandidates.length === 0
            && !this.openAgentInsightCandidate
        ) {
            this.agentInsightPolicyIdentity = null;
        }
        if (invalidatesCurrent || invalidatesOpen || invalidatesPending) this.reconcilePetNudge();
    }

    private handleMarkdownModify(path: string): void {
        const ownPageletWrite = this.host.consumePageletOperationsSelfWrite?.(path) === true;
        if (!ownPageletWrite) this.invalidateAgentInsightForPaths([path]);
        this.handleNoteActivity(path);
    }



    private currentAdmittedNudgeTickets(): NudgeTicket[] {
        const tickets: NudgeTicket[] = [];
        this.currentAgentInsightCandidate();
        for (const agentInsight of [
            this.agentInsightCandidate,
            ...this.pendingAgentInsightCandidates,
        ]) {
            if (!agentInsight || this.deliveryCandidateIsSeen(agentInsight)) continue;
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















    /** SG-06: standard bounded Recap uses the capability toggle directly. */
























    private setPetTaskKind(taskKind: PetTaskKind): void {
        this.petView?.setTaskKind?.(taskKind);
    }

    /** A background Recap owns the Pet only when no task or nudge already owns it. */






    private beginForegroundRoute(
        layout: "summary" | "discover" | "current" | "review",
        taskKind: PetTaskKind,
        options: { reserveGenericBudget?: boolean } = {},
    ): number | null {
        if (this.sessionManager.isForegroundRunInProgress) {
            new Notice(this.t("pagelet.notice.alreadyReviewing"), 4000);
            return null;
        }
        if (options.reserveGenericBudget !== false && !this.sessionManager.reserveForegroundCall()) return null;
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
            this.withContextPagerExtra(this.sessionManager.panelExtraForLayout(layoutType), layoutType),
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

    private async runExplicitDeepDiscover(): Promise<void> {
        const activeFile = this.host.app.workspace.getActiveFile?.();
        if (!activeFile || !activeFile.path.endsWith(".md")) return;
        if (!this.host.settings.pagelet.enabled || !this.host.runDeepDiscover) {
            new Notice(this.t("pagelet.deepDiscover.unavailable"), 5000);
            return;
        }
        if (!this.host.isPathAllowedForPagelet(activeFile.path)) {
            new Notice(this.t("pagelet.deepDiscover.boundaryDenied"), 5000);
            return;
        }

        const path = activeFile.path;
        this.invalidateAgentInsightIfPolicyChanged();
        const existingCandidate = this.agentInsightCandidate;
        if (existingCandidate && this.agentInsightAnchorPath === path) {
            this.openAgentInsightPanel(existingCandidate);
            return;
        }
        const routeToken = ++this.foregroundRouteToken;
        const modelPolicyIdentity = this.host.getDeepDiscoverPolicyIdentity?.();
        this.transitionPet("analysis-start", "connection");
        let result: PageletDeepDiscoverControllerResult | undefined;
        try {
            result = await this.host.runDeepDiscover({
                path,
                triggerReason: "explicit",
                force: true,
            });
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
                this.openAgentInsightPanel(accepted);
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
        );
        const candidate = candidates[0];
        if (!candidate) return null;
        const actionCandidateId = "candidateId" in this.agentInsightActionState
            ? this.agentInsightActionState.candidateId
            : null;
        if (
            !candidates.some((next) => next.id === this.agentInsightCandidate?.id)
            && !candidates.some((next) => next.id === this.openAgentInsightCandidate?.id)
            && !candidates.some((next) => next.id === actionCandidateId)
            && !this.agentInsightActionMustRemainReachable()
        ) {
            this.cancelPendingAgentInsightAction();
        }
        this.agentInsightCandidate = candidate;
        this.pendingAgentInsightCandidates = candidates.slice(1);
        this.agentInsightAnchorPath = result.insight.anchor.path;
        this.agentInsightPolicyIdentity = policyIdentity;
        this.agentInsightNudgeKeys.clear();

        const admissionCandidates = options.proactive
            && this.host.settings.pagelet.petVisible
            && !this.host.settings.focusMode
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
        return candidate;
    }

    private openAgentInsightPanel(
        candidate: PageletAgentDeliveryCandidate,
    ): void {
        this.bubbleView?.close();
        this.openAgentInsightCandidate = candidate;
        this.renderAgentInsightPanel(candidate);
        if (!this.panelView?.isOpen) this.openAgentInsightCandidate = null;
        if (this.panelView?.isOpen && candidate.deliveryReceipt) {
            this.attentionStore.markSeen(candidate.deliveryReceipt, "detail");
        }
        this.agentInsightNudgeKeys.delete(this.agentInsightTicketKey(candidate));
        this.reconcilePetNudge();
    }

    private renderAgentInsightPanel(candidate: PageletAgentDeliveryCandidate): void {
        const integration = this.buildAgentInsightFindingIntegration(candidate);
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
            sourcePath: candidate.pageletAgent.handoff.anchor.path,
        });
    }

    private refreshOpenAgentInsightPanel(): void {
        const candidate = this.openAgentInsightCandidate;
        if (!candidate || !this.panelView?.isOpen) return;
        this.renderAgentInsightPanel(candidate);
    }

    private buildAgentInsightFindingIntegration(
        candidate: PageletAgentDeliveryCandidate,
    ): Pick<PanelFinding, "actionStatus" | "actions"> {
        const state = "candidateId" in this.agentInsightActionState
            && this.agentInsightActionState.candidateId === candidate.id
            ? this.agentInsightActionState
            : ({ kind: "idle" } as const);
        const discussAction = {
            label: this.t("pagelet.panel.agentInsight.discuss"),
            callback: () => { void this.openAgentInsightInChat(candidate); },
        };
        const direct = candidate.pageletAgent.directAction;
        const directAction = direct ? {
            label: direct.label,
            primary: true,
            callback: () => { void this.stageAgentInsightDirectAction(candidate); },
        } : null;

        switch (state.kind) {
            case "idle": {
                const available = this.operationsAvailable();
                return {
                    ...(direct && !available ? {
                        actionStatus: {
                            label: this.t("pagelet.panel.agentInsight.operationsUnavailable"),
                            tone: "neutral" as const,
                        },
                    } : {}),
                    actions: [
                        ...(directAction ? [{ ...directAction, disabled: !available }] : []),
                        discussAction,
                    ],
                };
            }
            case "staging":
                return {
                    actionStatus: {
                        label: this.t("pagelet.panel.agentInsight.staging"),
                        busy: true,
                    },
                    actions: directAction ? [{ ...directAction, busy: true }] : [],
                };
            case "pending":
                return {
                    actionStatus: {
                        label: this.t("pagelet.panel.agentInsight.pending"),
                        detail: this.t("pagelet.panel.agentInsight.previewTarget", {
                            path: state.intent.operations[0]?.path ?? candidate.pageletAgent.handoff.anchor.path,
                        }),
                        preview: state.intent.operations
                            .map((operation) => formatOperationsPreview(operation, {
                                formatFrontmatterSet: (key, value) => this.t(
                                    "pagelet.panel.agentInsight.previewSet",
                                    { key, value },
                                ),
                                formatFrontmatterRemove: (key) => this.t(
                                    "pagelet.panel.agentInsight.previewRemove",
                                    { key },
                                ),
                            }))
                            .join("\n\n"),
                    },
                    actions: [
                        {
                            label: this.t("pagelet.panel.agentInsight.confirm"),
                            primary: true,
                            callback: () => { void this.confirmAgentInsightDirectAction(candidate); },
                        },
                        {
                            label: this.t("pagelet.panel.agentInsight.cancel"),
                            callback: () => this.cancelAgentInsightDirectAction(candidate),
                        },
                    ],
                };
            case "executing":
                return {
                    actionStatus: {
                        label: this.t("pagelet.panel.agentInsight.executing"),
                        busy: true,
                    },
                    actions: [{
                        label: this.t("pagelet.panel.agentInsight.confirm"),
                        busy: true,
                        callback: () => undefined,
                    }],
                };
            case "result": {
                const receiptIds = successfulReceiptIds(state.result);
                const stale = state.result.operations.some((operation) => operation.status === "stale");
                const succeeded = operationsResultSucceeded(state.result);
                return {
                    actionStatus: {
                        label: this.t(stale
                            ? "pagelet.panel.agentInsight.stale"
                            : succeeded
                                ? "pagelet.panel.agentInsight.succeeded"
                                : "pagelet.panel.agentInsight.failed"),
                        tone: succeeded ? "success" : "error",
                    },
                    actions: [
                        ...(receiptIds.length > 0 ? [{
                            label: this.t("pagelet.panel.agentInsight.undo"),
                            primary: true,
                            callback: () => { void this.undoAgentInsightDirectAction(candidate); },
                        }] : [discussAction]),
                    ],
                };
            }
            case "undoing":
                return {
                    actionStatus: {
                        label: this.t("pagelet.panel.agentInsight.undoing"),
                        busy: true,
                    },
                    actions: [{
                        label: this.t("pagelet.panel.agentInsight.undo"),
                        busy: true,
                        callback: () => undefined,
                    }],
                };
            case "undone": {
                const succeeded = state.results.length > 0
                    && state.results.every((result) => result.status === "undone");
                const stale = state.results.some((result) => result.status === "stale");
                return {
                    actionStatus: {
                        label: this.t(
                            succeeded
                                ? "pagelet.panel.agentInsight.undone"
                                : stale
                                    ? "pagelet.panel.agentInsight.undoStale"
                                    : "pagelet.panel.agentInsight.failed",
                        ),
                        tone: succeeded ? "success" : "error",
                    },
                    actions: [discussAction],
                };
            }
            case "handoff-opening":
                return {
                    actionStatus: {
                        label: this.t("pagelet.panel.agentInsight.handoffOpening"),
                        busy: true,
                    },
                    actions: [{ ...discussAction, busy: true }],
                };
            case "error": {
                const key = agentInsightErrorLocaleKey(state.error);
                const stale = state.error === "stale";
                return {
                    actionStatus: {
                        label: this.t(key),
                        tone: "error",
                    },
                    actions: [
                        ...(!stale && directAction && this.operationsAvailable() ? [directAction] : []),
                        ...(!stale ? [discussAction] : []),
                    ],
                };
            }
        }
    }

    private operationsAvailable(): boolean {
        return this.host.isOperationsAvailable?.() === true
            && typeof this.host.stagePageletInsightLink === "function"
            && typeof this.host.confirmPageletOperationsIntent === "function"
            && typeof this.host.cancelPageletOperationsIntent === "function"
            && typeof this.host.undoPageletOperationsReceipts === "function";
    }

    private async stageAgentInsightDirectAction(
        candidate: PageletAgentDeliveryCandidate,
    ): Promise<void> {
        const direct = candidate.pageletAgent.directAction;
        if (!direct || !this.isOpenAgentInsight(candidate)) return;
        if (!this.operationsAvailable() || !this.host.stagePageletInsightLink) {
            this.setAgentInsightActionError(candidate, "operations-unavailable");
            return;
        }
        if (this.agentInsightActionState.kind !== "idle"
            && this.agentInsightActionState.kind !== "error") return;

        const { token, signal } = this.beginAgentInsightAction(candidate, "staging");
        try {
            if (!await this.validateAgentInsight(candidate, signal)) {
                this.finishAgentInsightActionError(candidate, token, "stale");
                return;
            }
            const intent = await this.host.stagePageletInsightLink({
                candidateId: direct.candidateId,
                anchorPath: direct.anchorPath,
                sourcePath: direct.sourcePath,
            }, signal);
            if (!this.agentInsightActionIsCurrent(candidate, token)) {
                this.host.cancelPageletOperationsIntent?.(intent.id);
                return;
            }
            this.agentInsightActionState = { kind: "pending", candidateId: candidate.id, intent };
            this.refreshOpenAgentInsightPanel();
        } catch (error) {
            this.finishAgentInsightActionError(
                candidate,
                token,
                operationsErrorKind(error, this.operationsAvailable()),
            );
        } finally {
            if (this.agentInsightActionToken === token) this.agentInsightActionAbortController = null;
        }
    }

    private async confirmAgentInsightDirectAction(
        candidate: PageletAgentDeliveryCandidate,
    ): Promise<void> {
        const state = this.agentInsightActionState;
        if (
            state.kind !== "pending"
            || state.candidateId !== candidate.id
            || !this.isOpenAgentInsight(candidate)
            || !this.host.confirmPageletOperationsIntent
        ) return;
        const token = ++this.agentInsightActionToken;
        this.agentInsightActionState = {
            kind: "executing",
            candidateId: candidate.id,
            intent: state.intent,
        };
        this.refreshOpenAgentInsightPanel();
        try {
            const result = await this.host.confirmPageletOperationsIntent(state.intent.id);
            if (operationsResultSucceeded(result)) {
                this.retireAgentInsightCandidate(candidate.id);
            }
            if (!this.startedAgentInsightActionIsCurrent(candidate, token, "executing")) return;
            this.agentInsightActionState = { kind: "result", candidateId: candidate.id, result };
            this.refreshOpenAgentInsightPanel();
        } catch (error) {
            if (this.startedAgentInsightActionIsCurrent(candidate, token, "executing")) {
                this.agentInsightActionState = {
                    kind: "error",
                    candidateId: candidate.id,
                    error: operationsErrorKind(error, this.operationsAvailable()),
                };
                this.refreshOpenAgentInsightPanel();
            }
        }
    }

    private cancelAgentInsightDirectAction(candidate: PageletAgentDeliveryCandidate): void {
        const state = this.agentInsightActionState;
        if (state.kind !== "pending" || state.candidateId !== candidate.id) return;
        try {
            this.host.cancelPageletOperationsIntent?.(state.intent.id);
        } catch {
            // Expired and already-terminal intents are already fail-closed.
        }
        this.agentInsightActionToken += 1;
        this.agentInsightActionState = { kind: "idle" };
        this.refreshOpenAgentInsightPanel();
    }

    private retireAgentInsightCandidate(candidateId: string): void {
        this.agentInsightNudgeKeys.delete(`${NudgeOwner.AgentInsight}:${candidateId}`);
        if (this.agentInsightCandidate?.id === candidateId) {
            this.agentInsightCandidate = this.pendingAgentInsightCandidates.shift() ?? null;
        } else {
            const before = this.pendingAgentInsightCandidates.length;
            this.pendingAgentInsightCandidates = this.pendingAgentInsightCandidates.filter((candidate) => (
                candidate.id !== candidateId
            ));
            if (before === this.pendingAgentInsightCandidates.length) return;
        }
        if (!this.agentInsightCandidate) this.agentInsightAnchorPath = null;
        this.reconcilePetNudge();
    }

    private async undoAgentInsightDirectAction(
        candidate: PageletAgentDeliveryCandidate,
    ): Promise<void> {
        const state = this.agentInsightActionState;
        if (
            state.kind !== "result"
            || state.candidateId !== candidate.id
            || !this.host.undoPageletOperationsReceipts
        ) return;
        const receiptIds = successfulReceiptIds(state.result);
        if (receiptIds.length === 0) return;
        const token = ++this.agentInsightActionToken;
        this.agentInsightActionState = {
            kind: "undoing",
            candidateId: candidate.id,
            result: state.result,
        };
        this.refreshOpenAgentInsightPanel();
        try {
            const results = await this.host.undoPageletOperationsReceipts(receiptIds);
            if (!this.startedAgentInsightActionIsCurrent(candidate, token, "undoing")) return;
            this.agentInsightActionState = { kind: "undone", candidateId: candidate.id, results };
            this.refreshOpenAgentInsightPanel();
        } catch (error) {
            if (this.startedAgentInsightActionIsCurrent(candidate, token, "undoing")) {
                this.agentInsightActionState = {
                    kind: "error",
                    candidateId: candidate.id,
                    error: operationsErrorKind(error, this.operationsAvailable()),
                };
                this.refreshOpenAgentInsightPanel();
            }
        }
    }

    private async openAgentInsightInChat(candidate: PageletAgentDeliveryCandidate): Promise<void> {
        if (!this.isOpenAgentInsight(candidate) || !this.host.openPageletChatHandoff) return;
        const active = this.agentInsightActionState;
        if (
            "candidateId" in active
            && active.candidateId === candidate.id
            && active.kind !== "error"
            && active.kind !== "undone"
            && !(active.kind === "result" && successfulReceiptIds(active.result).length === 0)
        ) return;
        const { token, signal } = this.beginAgentInsightAction(candidate, "handoff-opening");
        try {
            if (!await this.validateAgentInsight(candidate, signal)) {
                this.finishAgentInsightActionError(candidate, token, "stale");
                return;
            }
            const result = await this.host.openPageletChatHandoff(
                candidate.pageletAgent.handoff,
                signal,
            );
            if (!this.agentInsightActionIsCurrent(candidate, token)) return;
            if (result.status === "prepared") {
                this.panelView?.close();
                return;
            }
            const error: PageletInsightActionErrorKind = result.status === "busy"
                ? "handoff-busy"
                : result.status === "draft-conflict"
                    ? "handoff-draft"
                    : "handoff-unavailable";
            this.finishAgentInsightActionError(candidate, token, error);
        } catch {
            this.finishAgentInsightActionError(candidate, token, "handoff-unavailable");
        } finally {
            if (this.agentInsightActionToken === token) this.agentInsightActionAbortController = null;
        }
    }

    private beginAgentInsightAction(
        candidate: PageletAgentDeliveryCandidate,
        kind: "staging" | "handoff-opening",
    ): { token: number; signal: AbortSignal } {
        this.agentInsightActionAbortController?.abort();
        const controller = new AbortController();
        this.agentInsightActionAbortController = controller;
        const token = ++this.agentInsightActionToken;
        this.agentInsightActionState = { kind, candidateId: candidate.id };
        this.refreshOpenAgentInsightPanel();
        return { token, signal: controller.signal };
    }

    private async validateAgentInsight(
        candidate: PageletAgentDeliveryCandidate,
        signal: AbortSignal,
    ): Promise<boolean> {
        return await this.host.validateDeepDiscoverInsight?.(
            candidate.pageletAgent.validationIdentity,
            signal,
        ) === true;
    }

    private finishAgentInsightActionError(
        candidate: PageletAgentDeliveryCandidate,
        token: number,
        error: PageletInsightActionErrorKind,
    ): void {
        if (!this.agentInsightActionIsCurrent(candidate, token)) return;
        this.agentInsightActionState = { kind: "error", candidateId: candidate.id, error };
        this.refreshOpenAgentInsightPanel();
    }

    private setAgentInsightActionError(
        candidate: PageletAgentDeliveryCandidate,
        error: PageletInsightActionErrorKind,
    ): void {
        this.agentInsightActionState = { kind: "error", candidateId: candidate.id, error };
        this.refreshOpenAgentInsightPanel();
    }

    private agentInsightActionIsCurrent(
        candidate: PageletAgentDeliveryCandidate,
        token: number,
    ): boolean {
        return this.agentInsightActionToken === token && this.isOpenAgentInsight(candidate);
    }

    private startedAgentInsightActionIsCurrent(
        candidate: PageletAgentDeliveryCandidate,
        token: number,
        kind: "executing" | "undoing",
    ): boolean {
        const state = this.agentInsightActionState;
        return this.agentInsightActionToken === token
            && state.kind === kind
            && state.candidateId === candidate.id;
    }

    private agentInsightActionMustRemainReachable(): boolean {
        const state = this.agentInsightActionState;
        return state.kind === "executing"
            || state.kind === "undoing"
            || (state.kind === "result" && successfulReceiptIds(state.result).length > 0);
    }

    private isOpenAgentInsight(candidate: PageletAgentDeliveryCandidate): boolean {
        return this.openAgentInsightCandidate?.id === candidate.id && this.panelView?.isOpen === true;
    }

    private cancelPendingAgentInsightAction(options: { preserveStarted?: boolean } = {}): void {
        if (
            options.preserveStarted
            && (
                this.agentInsightActionState.kind === "executing"
                || this.agentInsightActionState.kind === "undoing"
            )
        ) return;
        this.agentInsightActionAbortController?.abort();
        this.agentInsightActionAbortController = null;
        this.agentInsightActionToken += 1;
        const state = this.agentInsightActionState;
        if (state.kind === "pending") {
            try {
                this.host.cancelPageletOperationsIntent?.(state.intent.id);
            } catch {
                // Expired and already-terminal intents are already fail-closed.
            }
        }
        this.agentInsightActionState = { kind: "idle" };
    }

    // ======================================================================
    // Pet lifecycle
    // ======================================================================

    /** Re-mount Pet on leaf change. */
    private handleLeafChange(leaf: WorkspaceLeaf | null): void {
        const previousPath = this.currentMarkdownAnchorPath;
        const nextPath = leaf?.view?.getViewType() === "markdown"
            ? (leaf.view as MarkdownView).file?.path ?? null
            : null;
        if (previousPath && previousPath !== nextPath) {
            void this.runAutomaticDeepDiscover(previousPath, "leave-note");
        }
        this.currentMarkdownAnchorPath = nextPath;
        if (nextPath) {
            void this.runAutomaticDeepDiscover(nextPath, "open-changed-note");
        }

        // Always unmount from previous location
        this.petView?.unmount();
        this.bubbleView?.close();

        // Only mount on markdown views (D029/R1)
        if (!leaf || leaf.view?.getViewType() !== "markdown") {
            const discarded = this.sessionManager.discardAnalysisSessionIfStale(null);
            if (discarded && this.panelView?.isOpen) {
                this.panelView.close();
            }
            return;
        }
        if (!this.host.settings.pagelet.petVisible) return;

        const markdownView = leaf.view as MarkdownView;
        const discarded = this.sessionManager.discardAnalysisSessionIfStale(markdownView.file?.path ?? null);
        if (discarded && this.panelView?.isOpen) {
            this.panelView.close();
        }
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
        if (rawSelection.trim().length > 0) {
            return {
                content: rawSelection,
                source: "selection",
                ...(basePath ? { resourceContext: { basePath } } : {}),
            };
        }

        const rawNote = editor?.getValue?.() ?? "";
        const content = stripValidYamlFrontmatter(rawNote);
        if (content.trim().length === 0) return null;
        return {
            content,
            source: "note",
            sourceLabel: file.basename,
            ...(basePath ? { resourceContext: { basePath } } : {}),
        };
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

    /**
     * F-07 / SG-01: simplified to check quietRecallMode === "on".
     * Quality gate, quiet hours, Focus Mode, per-candidate-once remain.
     */




















    /**
     * F-05 / SG-02: View opens Tab with existing candidates. Does NOT re-run provider.
     */






    /**
     * F-05 / SG-04: Later = enter Review Queue instead of 24h snooze.
     */


    /** Expand Bubble -> Panel. */
    private handleExpandPanel(type?: string): void {
        const requestedType = type === "writing" ? "current" : type;
        if (requestedType === "prepared") {
            // The generic preparation cache is retired; keep the stable Bubble
            // action honest instead of opening an empty result panel.
            new Notice(this.t("pagelet.preload.status.noCachedFindings"), 4000);
            return;
        }

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
        const panelFindings = this.sessionManager.currentAnalysisFindings();

        this.panelView?.open(
            layoutType,
            panelFindings,
            this.panelExtraForLayout(layoutType),
        );
    }

    /** Expand Panel -> Tab. */
    private expandPanelToTab(): void {
        const layoutType = this.panelView?.currentLayoutType ?? this.currentPanelLayout ?? "review";
        const panelFindings = this.panelView?.currentVisibleFindings ?? [];
        const panelExtra = this.panelView?.currentPanelExtra;
        const sourcePath = panelExtra?.sourcePath;
        const tabExtra = this.withGlobalLedgerExtra(
            this.withGlobalReviewQueueExtra(panelExtra ?? this.panelExtraForLayout(layoutType)),
        );
        this.preservePanelSessionOnClose = true;
        try {
            this.panelView?.close();
        } finally {
            this.preservePanelSessionOnClose = false;
        }
        const locale = getPageletUiLanguage();
        const title = pageletT("pagelet.tab.title", locale);
        const hasPanelContent = panelFindings.length > 0
            || Boolean(tabExtra?.connections && tabExtra.connections.length > 0)
            || Boolean(tabExtra?.markdown)
            || Boolean(tabExtra?.contextPager)
            || Boolean(tabExtra?.savedInsights && tabExtra.savedInsights.items.length > 0)
            || Boolean(tabExtra?.memoryGovernance && (tabExtra.memoryGovernance.records.length > 0 || (tabExtra.memoryGovernance.candidates?.length ?? 0) > 0 || (tabExtra.memoryGovernance.routedItems?.length ?? 0) > 0))
            || Boolean(tabExtra?.maintenanceReview)
            || Boolean(tabExtra?.graphDiscovery)
            || Boolean(tabExtra?.quietRecall);
        let findings = panelFindings;
        if (!hasPanelContent) {
            findings = this.sessionManager.currentAnalysisFindings();
        }
        const detailExtra = this.detailExtraForTab(tabExtra);
        const payload: PageletDetailPayload = {
            title,
            content: findings,
            locale,
            layoutType,
            entryReason: "panel-expand",
        };
        if (detailExtra) {
            payload.extra = detailExtra;
        }
        if (sourcePath) {
            payload.sourcePath = sourcePath;
        }
        void Promise.resolve(this.host.openPageletDetailView(payload)).catch((error: unknown) => {
            this.host.log("Failed to open Pagelet detail view", error);
            new Notice(this.t("pagelet.panel.status.error"), 4000);
        });
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
        if (extra.quietRecall) {
            detailExtra.quietRecall = extra.quietRecall;
        }
        return detailExtra.connections || detailExtra.markdown !== undefined || detailExtra.contextPager || detailExtra.savedInsights || detailExtra.memoryGovernance || detailExtra.maintenanceReview || detailExtra.graphDiscovery || detailExtra.patternDetection || detailExtra.quietRecall
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
        if (
            this.openAgentInsightCandidate
            && (
                this.agentInsightActionState.kind === "executing"
                || this.agentInsightActionState.kind === "undoing"
            )
        ) {
            // A confirmed write/Undo cannot be cancelled. Keep its receipt UI
            // reachable by immediately restoring the busy Panel until it settles.
            this.renderAgentInsightPanel(this.openAgentInsightCandidate);
            return;
        }
        this.cancelPendingAgentInsightAction({ preserveStarted: true });
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

function stripValidYamlFrontmatter(markdown: string): string {
    const info = getFrontMatterInfo(markdown);
    if (!info.exists) return markdown;
    try {
        parseYaml(info.frontmatter);
    } catch {
        return markdown;
    }
    const contentStart = Math.min(
        markdown.length,
        Math.max(0, info.contentStart ?? 0),
    );
    return markdown.slice(contentStart);
}

function successfulReceiptIds(result: OperationsExecutionResult): string[] {
    return result.operations.flatMap((operation) => (
        operation.status === "succeeded" && operation.receiptId ? [operation.receiptId] : []
    ));
}

function operationsResultSucceeded(result: OperationsExecutionResult): boolean {
    return result.state === "completed"
        && result.operations.length > 0
        && result.operations.every((operation) => operation.status === "succeeded");
}

function operationsErrorKind(
    error: unknown,
    operationsAvailable: boolean,
): PageletInsightActionErrorKind {
    if (!operationsAvailable) return "operations-unavailable";
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    return /stale|changed|expired|source|boundary|policy/.test(message) ? "stale" : "failed";
}

function agentInsightErrorLocaleKey(error: PageletInsightActionErrorKind): string {
    switch (error) {
        case "stale":
            return "pagelet.panel.agentInsight.stale";
        case "operations-unavailable":
            return "pagelet.panel.agentInsight.operationsUnavailable";
        case "handoff-busy":
            return "pagelet.panel.agentInsight.handoffBusy";
        case "handoff-draft":
            return "pagelet.panel.agentInsight.handoffDraft";
        case "handoff-unavailable":
            return "pagelet.panel.agentInsight.handoffUnavailable";
        case "failed":
        default:
            return "pagelet.panel.agentInsight.failed";
    }
}
