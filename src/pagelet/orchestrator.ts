/* Copyright 2023 edonyzpc */

/**
 * Pagelet Orchestrator -- central integration layer.
 *
 * Coordinates Pet, Bubble, Panel, Tab, background preparation,
 * and foreground review. Delegates analysis to
 * {@link AnalysisSessionManager}, note-saving to {@link ReviewNoteSaveFlow},
 * bubble display to {@link BubbleCoordinator}, background prep to
 * {@link BackgroundPreparationCoordinator}.
 */

import { Notice, TFile, normalizePath } from "obsidian";
import { MarkdownView } from "obsidian";
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
import { scopeRecapToDeliveryCandidate } from "./bubble/recap-card";
import { quietRecallCandidateToDeliveryCandidate } from "./bubble/recall-card";
import type { DeliveryCandidate } from "./bubble/types";
import type { OnboardingNudge, OnboardingNudgeKind } from "./bubble/BubbleContent";
import { PanelView } from "./panel/PanelView";
import { buildContextualGovernedMemoryState } from "./contextual-memory";
import type {
    DiscoveryResult,
    NoteConnection,
    PanelFinding,
    PanelLayoutType,
    PanelMemoryGovernanceState,
    PanelOpenExtra,
} from "./panel/types";
import type { PageletCommandCallbacks } from "./commands";
import { ProactiveHints } from "./hints/ProactiveHints";
import type { PetCorner, PetTaskKind } from "./pet/types";
import { PetView } from "./pet/PetView";
import { PreloadBudget } from "./preload/PreloadBudget";
import { PreloadCache } from "./preload/PreloadCache";
import { ChangeDetector } from "./scope/ChangeDetector";
import { ScopeResolver } from "./scope/ScopeResolver";
import {
    selectPageletScope,
    type PageletReviewRange,
    type PageletScopeSkippedReason,
} from "./scope";
import { getPageletOverlayRoot } from "./overlay-root";
import { ResearchManager } from "./research";

import { AnalysisSessionManager } from "./AnalysisSessionManager";
import { BackgroundPreparationCoordinator } from "./BackgroundPreparationCoordinator";
import { BubbleCoordinator, NudgeOwner, type NudgeTicket } from "./BubbleCoordinator";
import { ReviewNoteSaveFlow } from "./ReviewNoteSaveFlow";
import type { PageletHost } from "./PageletHost";
import { resolveRelatedMarkdownNote } from "./related-note";
import type { PageletDetailPayload, TabSection } from "./tab/types";
import { splitReviewQueueForSections } from "./tab/review-queue-routing";
import {
    QUIET_RECALL_BUBBLE_MIN_SCORE,
    createContextPagerStateFromRetrievalOutcome,
    quietRecallCandidateToBubbleNudge,
    quietRecallCandidateToReviewQueueInput,
    quietRecallLinkTargetPath,
    reviewQueueItemHasUserIntentOrDurableConsequence,
    evaluateScopeRecapProactiveQuality,
    evaluateScopeRecapArtifactCurrentness,
    toReplaySourceRef,
    type ContextDropReason,
    type PersistedSourceRef,
    type PatternDetectionResult,
    type QuietRecallBubbleNudge,
    type QuietRecallCandidate,
    type QuietRecallEvaluationDiagnostics,
    type QuietRecallRunResult,
    type RetrievalHabitFeedbackKind,
    type RetrievalOutcome,
    type ScopeRecapRunResult,
    type ScopeRecapAttemptStatus,
    type ScopeRecapLocalOverview,
    type ScopeRecapItem,
    type ScopeRecapPreparationResult,
} from "../pa";

// Re-export so existing `import { PageletHost } from "./orchestrator"` keeps working.
export type { PageletHost } from "./PageletHost";

export class PageletOrchestrator {
    // ---- Components -------------------------------------------------------
    private petView: PetView | null = null;
    private bubbleView: BubbleView | null = null;
    private panelView: PanelView | null = null;
    private currentPanelLayout: PanelLayoutType | null = null;
    private preservePanelSessionOnClose = false;
    private readonly handleEscape: (e: KeyboardEvent) => void;
    private readonly handleQuietRecallShortcut: (e: KeyboardEvent) => void;
    private readonly preloadCache: PreloadCache;
    private readonly preloadBudget: PreloadBudget;
    private readonly changeDetector: ChangeDetector;
    private readonly scopeResolver: ScopeResolver;
    private readonly proactiveHints: ProactiveHints;
    private readonly researchManager: ResearchManager;
    private escapeListenerDocument: Document | null = null;

    // ---- Delegates --------------------------------------------------------
    private readonly sessionManager: AnalysisSessionManager;
    private readonly backgroundPrep: BackgroundPreparationCoordinator;
    private readonly bubbleCoordinator: BubbleCoordinator;
    private readonly saveFlow: ReviewNoteSaveFlow;

    /** Proxy for scope range -- kept for test compat. */
    private get currentScopeRange(): PageletReviewRange {
        return this.sessionManager.scopeRange;
    }
    private set currentScopeRange(value: PageletReviewRange) {
        this.sessionManager.scopeRange = value;
    }

    // ---- State ------------------------------------------------------------
    private idleTimer: PlatformTimeoutHandle | null = null;
    private activityDebounceTimer: PlatformTimeoutHandle | null = null;
    private quietRecallNudgeCandidate: QuietRecallCandidate | null = null;
    private quietRecallBubbleNudge: QuietRecallBubbleNudge | null = null;
    private preparedRecapCandidate: (DeliveryCandidate & { kind: "recap" }) | null = null;
    private preparedRecapPayload: PageletDetailPayload | null = null;
    private preparedRecapArtifact: ScopeRecapRunResult | null = null;
    private preparedRecapScopeKey: string | null = null;
    private lastRecapAttempt: ScopeRecapAttemptStatus | null = null;
    private lastRecapLocalOverview: ScopeRecapLocalOverview | null = null;
    private preparedRecapNudgeFingerprint: string | null = null;
    private readonly shownRecapNudgeFingerprints = new Map<string, number>();
    private readonly snoozedRecapNudgeFingerprints = new Map<string, number>();
    private recapPreparationTimer: PlatformTimeoutHandle | null = null;
    private recapPreparationInFlight = false;
    private recapPreparationPendingReason: "pagelet-open" | "note-activity" | "idle" | null = null;
    private recapPreparationPromise: Promise<ScopeRecapPreparationResult> | null = null;
    private recapPreparationPromiseScopeKey: string | null = null;
    private recapPetWorkToken = 0;
    private activeRecapPetWork: { token: number; claimedPet: boolean } | null = null;
    private lastRecapPreparationAttemptAt = 0;
    private lastRecapPreparationScopeKey: string | null = null;
    private recapBackgroundFailureCount = 0;
    private recapBackgroundRetryAt = 0;
    private recapScopeRevision = 0;
    private recapRuntimeGateIdentity: string;
    private onboardingNudge: OnboardingNudge | null = null;
    private onboardingNudgeAdmissionKey: string | null = null;
    get hasActiveOnboardingNudge(): boolean { return this.onboardingNudge !== null; }
    private patternDetectionNudge: PatternDetectionResult | null = null;
    private patternDetectionNudgeAdmissionKey: string | null = null;
    private quietRecallNudgeRunId = 0;
    private quietRecallRuntimePolicyIdentity: string | null;
    private quietRecallNudgeInFlight = false;
    private quietRecallNudgePending = false;
    private lastQuietRecallCtrlKeydownAt = 0;
    private readonly quietRecallDismissedCandidateIds = new Set<string>();
    private readonly quietRecallSnoozedCandidateIds = new Map<string, number>();
    private unconvincingRecallCount = 0;
    private quietRecallDiscoverFallback: QuietRecallRunResult | null = null;
    private lastQuietRecallDiagnostics: QuietRecallEvaluationDiagnostics | null = null;
    private lastQuietRecallAcceptedCount = 0;
    private foregroundRouteToken = 0;
    private readonly activeForegroundTimers = new Set<ReturnType<typeof setTimeout>>();
    private destroyed = false;

    // ---- Constants --------------------------------------------------------
    /** 120 s ceiling for any single foreground provider-backed call. */
    private static readonly FOREGROUND_TIMEOUT_MS = 120_000;
    /** 10 minutes of no activity -> Pet enters resting state. */
    private static readonly IDLE_TIMEOUT_MS = 10 * 60 * 1000;
    /** 5 s debounce for note-activity detection (vault modify events). */
    private static readonly ACTIVITY_DEBOUNCE_MS = 5_000;
    /** Debounce for Quiet Recall after leaf change (avoids sync vault scan jank). */
    private static readonly QUIET_RECALL_LEAF_CHANGE_DEBOUNCE_MS = 250;
    /** Local UI snooze for the same Quiet Recall Bubble candidate. */
    private static readonly QUIET_RECALL_LATER_SNOOZE_MS = 24 * 60 * 60 * 1000;
    private static readonly QUIET_RECALL_DOUBLE_CTRL_MS = 300;
    private static readonly PREPARED_RECAP_LEAF_CHANGE_DEBOUNCE_MS = 1_500;
    private static readonly PREPARED_RECAP_NOTE_ACTIVITY_DEBOUNCE_MS = 5_000;
    private static readonly PREPARED_RECAP_MIN_INTERVAL_MS = 5 * 60 * 1000;
    private static readonly PREPARED_RECAP_LATER_SNOOZE_MS = 24 * 60 * 60 * 1000;
    private static readonly PREPARED_RECAP_FIRST_RETRY_MS = 5 * 60 * 1000;
    private static readonly PREPARED_RECAP_LATER_RETRY_MS = 30 * 60 * 1000;

    constructor(private readonly host: PageletHost) {
        const s = host.settings.pagelet;
        this.lastRecapAttempt = s.scopeRecapLastAttempt;
        this.lastQuietRecallDiagnostics = s.quietRecallLastDiagnostics;
        this.lastQuietRecallAcceptedCount = s.quietRecallLastAcceptedCount;
        this.recapRuntimeGateIdentity = this.currentRecapRuntimeGateIdentity();
        this.quietRecallRuntimePolicyIdentity = host.getQuietRecallEvaluationPolicySnapshotId?.() ?? null;
        for (const entry of s.scopeRecapNudgeSuppressions) {
            this.shownRecapNudgeFingerprints.set(entry.fingerprint, entry.shownAt);
            if (entry.snoozedUntil !== undefined) {
                this.snoozedRecapNudgeFingerprints.set(entry.fingerprint, entry.snoozedUntil);
            }
        }

        // Scope infrastructure
        this.preloadCache = new PreloadCache();
        this.preloadBudget = new PreloadBudget(
            s.preloadPerHourCap,
            s.preloadPerDayCap,
            Date.now,
            host.createPreloadBudgetStorage?.(),
        );
        const foregroundBudget = new PreloadBudget(
            s.foregroundPerHourCap,
            s.foregroundPerDayCap,
        );
        this.changeDetector = new ChangeDetector(host.createPreloadChangeDetectorStorage?.());
        this.scopeResolver = new ScopeResolver(host.app, {
            excludedFolders: [...s.excludedFolders],
            excludedTags: [...s.excludedTags],
            excludedPatterns: [...s.excludedPatterns],
            maxFileSizeBytes: 100 * 1024,
            reviewsFolder: s.reviewsFolder,
        });

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

        // Delegate: background preparation coordinator (after proactiveHints)
        this.backgroundPrep = new BackgroundPreparationCoordinator(
            host, this.preloadCache, this.preloadBudget,
            this.changeDetector, this.scopeResolver,
            {
                onPetTransition: (event) => this.transitionPet(event, "background"),
                onPetFlashError: () => this.petView?.flashError(),
            },
        );

        // Delegate: bubble coordinator (after proactiveHints)
        this.bubbleCoordinator = new BubbleCoordinator(host, this.proactiveHints, {
            onExpandPanel: (type) => this.handleExpandPanel(type),
            onSourceClick: (link) => this.handleSourceClick(link),
            onDismiss: () => this.handleBubbleDismiss(),
            onReviewCurrentNote: () => { void this.reviewCurrentNote({ preferPanel: true }); },
            onDiscoverConnections: () => { void this.discoverConnections(); },
            onQuietRecallDiscoverOnly: () => { void this.openQuietRecallDiscoverFallback(); },
            getOnboardingNudge: () => this.onboardingNudge,
            onOnboardingNudgeDismiss: (nudge) => this.handleOnboardingNudgeDismiss(nudge),
            getQuietRecallNudge: () => this.quietRecallBubbleNudge,
            getQuietRecallCandidate: () => this.quietRecallNudgeCandidate,
            onQuietRecallView: (candidate) => { void this.handleQuietRecallBubbleView(candidate); },
            onQuietRecallLink: (candidate) => { void this.handleQuietRecallBubbleLink(candidate); },
            onQuietRecallDismiss: (candidate) => { void this.handleQuietRecallBubbleDismiss(candidate); },
            onQuietRecallLater: (candidate) => { void this.handleQuietRecallBubbleLater(candidate); },
            getPatternDetectionNudge: () => this.patternDetectionNudge,
            onPatternDetectionView: (result) => { void this.handlePatternDetectionBubbleView(result); },
            onPatternDetectionDismiss: (result) => this.handlePatternDetectionBubbleDismiss(result),
            getPreparedRecapCandidate: () => this.currentPreparedRecapCandidate(),
            getAdmittedNudgeTickets: () => this.currentAdmittedNudgeTickets(),
            onPreparedRecapView: () => { void this.openPreparedRecapDelivery(); },
            onPreparedRecapLater: () => this.snoozePreparedRecapNudge(),
            onNudgePresented: (ticket) => this.handleNudgePresented(ticket),
            getUnconvincingRecallCount: () => this.unconvincingRecallCount,
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
            if (this.panelView?.isOpen) {
                this.panelView.close();
                e.stopPropagation();
                return;
            }
        };
        this.handleQuietRecallShortcut = (e: KeyboardEvent) => {
            if (e.key !== "Control" || e.repeat || e.metaKey || e.altKey || e.shiftKey) return;
            if (this.host.settings.focusMode || !this.host.settings.quietRecall.enabled) return;
            const now = Date.now();
            if (now - this.lastQuietRecallCtrlKeydownAt <= PageletOrchestrator.QUIET_RECALL_DOUBLE_CTRL_MS) {
                this.lastQuietRecallCtrlKeydownAt = 0;
                e.preventDefault();
                void this.runQuietRecall();
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
        const s = this.host.settings.pagelet;

        // 1. Overlay mount root (under workspace.containerEl to avoid titlebar overlap)
        const overlayRoot = getPageletOverlayRoot(this.host.app);

        // 1a. Create BubbleView (lazy-mounted on first show)
        this.bubbleView = new BubbleView({
            getLocale: getPageletUiLanguage,
            onClose: () => this.bubbleCoordinator.handleBubbleClosed(this.bubbleView, this.petView),
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
                onRunReview: () => this.reviewCurrentNote({ preferPanel: true }),
                onRunSelectedReview: () => this.reviewSelectedScope(),
                onScopeRangeChange: (range) => {
                    this.sessionManager.handleScopeRangeChange(range);
                    this.refreshReviewPanel();
                },
                onScopeCandidateToggle: (path, included) => {
                    this.sessionManager.handleScopeCandidateToggle(path, included);
                    this.refreshReviewPanel();
                },
                onRelatedNoteClick: (noteName, sourcePath) => this.handleRelatedNoteClick(noteName, sourcePath),
                onResearchFinding: (finding) => this.handleResearchFinding(finding),
                onToggleHints: () => this.toggleProactiveHints(),
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

        // 3. Vault events: markdown-only activity tracking + scope invalidation
        this.host.registerEvent(
            this.host.app.vault.on("modify", (file) => {
                if (file.path.endsWith(".md")) {
                    this.sessionManager.invalidateScopePlan();
                    if (this.pathTouchesCurrentRecapScope(file.path)) {
                        this.invalidatePreparedRecapScope();
                    }
                    if (this.pathTouchesCurrentQuietRecall(file.path)) {
                        this.invalidateQuietRecallBubbleNudge();
                    }
                    this.handleNoteActivity(file.path);
                }
            }),
        );
        this.host.registerEvent(
            this.host.app.vault.on("create", (file) => {
                if (file.path.endsWith(".md")) {
                    this.sessionManager.invalidateScopePlan();
                    this.invalidatePreparedRecapScope();
                    this.invalidateQuietRecallBubbleNudge();
                }
            }),
        );
        this.host.registerEvent(
            this.host.app.vault.on("delete", (file) => {
                if (file.path.endsWith(".md")) {
                    this.sessionManager.invalidateScopePlan();
                    this.invalidatePreparedRecapScope();
                    this.invalidateQuietRecallBubbleNudge();
                }
            }),
        );
        this.host.registerEvent(
            this.host.app.vault.on("rename", (file, oldPath) => {
                if (file.path.endsWith(".md") || oldPath.endsWith(".md")) {
                    this.sessionManager.invalidateScopePlan();
                    this.invalidatePreparedRecapScope();
                    this.invalidateQuietRecallBubbleNudge();
                }
            }),
        );

        // 4. Start background preparation engine (if enabled)
        if (s.preloadEnabled) {
            this.backgroundPrep.start();
        }

        // 5. Mount Pet on whatever leaf is currently active
        const initialLeaf = this.getCurrentWorkspaceLeaf();
        if (initialLeaf) {
            this.handleLeafChange(initialLeaf);
        }

        // 6. Begin idle tracking
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
        this.clearRecapPreparationTimer();
        this.recapPreparationPendingReason = null;
        for (const timer of this.activeForegroundTimers) clearTimeout(timer);
        this.activeForegroundTimers.clear();
        if (this.quietRecallLeafChangeTimer !== null) {
            clearTimeout(this.quietRecallLeafChangeTimer);
            this.quietRecallLeafChangeTimer = null;
        }
        this.escapeListenerDocument?.removeEventListener("keydown", this.handleEscape, true);
        this.escapeListenerDocument?.removeEventListener("keydown", this.handleQuietRecallShortcut, true);
        this.escapeListenerDocument = null;
        this.cancelRecapPetWork();
        this.backgroundPrep.destroy();
        this.bubbleCoordinator.destroy();
        this.petView?.destroy();
        this.bubbleView?.destroy();
        this.panelView?.destroy();
        this.preloadCache.clear();

        this.petView = null;
        this.bubbleView = null;
        this.panelView = null;
    }

    /** Apply latest settings to all runtime collaborators. */
    syncSettings(): void {
        if (this.destroyed) return;
        const s = this.host.settings.pagelet;
        const currentAuthorizationContextId = this.host.getScopeRecapAuthorizationContextId();
        if (
            s.scopeRecapBackgroundAuthorization === "authorized-v1"
            && s.scopeRecapAuthorizationContextId !== currentAuthorizationContextId
        ) {
            this.host.updatePageletSetting("scopeRecapBackgroundAuthorization", "pending");
            this.host.updatePageletSetting("scopeRecapAuthorizationContextId", null);
            this.clearPreparedRecapDelivery();
        }
        const recapRuntimeGateIdentity = this.currentRecapRuntimeGateIdentity();
        if (recapRuntimeGateIdentity !== this.recapRuntimeGateIdentity) {
            this.recapRuntimeGateIdentity = recapRuntimeGateIdentity;
            this.clearRecapPreparationTimer();
            this.invalidatePreparedRecapScope();
        }
        const quietRecallPolicyIdentity = this.host.getQuietRecallEvaluationPolicySnapshotId?.() ?? null;
        if (quietRecallPolicyIdentity !== this.quietRecallRuntimePolicyIdentity) {
            this.quietRecallRuntimePolicyIdentity = quietRecallPolicyIdentity;
            this.invalidateQuietRecallBubbleNudge();
        }

        this.preloadBudget.updateLimits(s.preloadPerHourCap, s.preloadPerDayCap);
        this.sessionManager.syncBudget();
        this.scopeResolver.updateConfig({
            excludedFolders: [...s.excludedFolders],
            excludedTags: [...s.excludedTags],
            excludedPatterns: [...s.excludedPatterns],
            maxFileSizeBytes: 100 * 1024,
            reviewsFolder: s.reviewsFolder,
        });
        this.sessionManager.invalidateScopePlan();
        this.proactiveHints.updateConfig({
            enabled: s.proactiveHints,
            cooldownMinutes: s.proactiveHintsCooldown,
            quietHours: s.proactiveHintsQuietHours,
        });
        if (!s.proactiveHints) this.clearGenericNudgeAdmissions();
        if (
            this.preparedRecapArtifact
            && this.preparedRecapArtifact.dataBoundarySnapshotId
                !== this.host.getScopeRecapDataBoundarySnapshotId()
        ) {
            this.clearPreparedRecapDelivery();
        }
        if (!s.scopeRecapHighValueHints) {
            const hadRecapNudge = this.preparedRecapNudgeFingerprint !== null;
            this.preparedRecapNudgeFingerprint = null;
            if (
                hadRecapNudge
                && this.petView?.stateMachine.state === "nudge"
                && !this.onboardingNudge
                && !this.patternDetectionNudge
                && !this.quietRecallBubbleNudge
            ) {
                this.petView.stateMachine.forceState("idle");
            }
        }
        if (
            s.scopeRecapPreparationEnabled
            && s.scopeRecapBackgroundAuthorization !== "declined-v1"
        ) {
            this.schedulePreparedRecap("pagelet-open", 0);
        }
        if (!this.canPrepareQuietRecallBubbleNudge()) {
            this.clearQuietRecallBubbleNudge();
        }
        if (this.petView) {
            this.petView.stateMachine.proactiveHintsEnabled = s.proactiveHints;
            this.petView.setCorner(s.petCorner);
        }
        this.syncPetVisibility();

        this.backgroundPrep.syncConfig();
        this.reconcilePetNudge();
    }

    // ======================================================================
    // Command callbacks
    // ======================================================================

    getCommandCallbacks(): PageletCommandCallbacks {
        return {
            onOpenPanel: () => this.openPanel(),
            onOpenPreparedReview: () => this.openPreparedReview(),
            onReviewCurrent: () => this.reviewCurrentNote(),
            onQuickReview: () => this.openQuickReview(),
            onDiscoverConnections: async () => {
                await this.discoverConnections();
            },
            onMaintenanceReview: () => this.runMaintenanceReview(),
            onQuietRecall: () => this.runQuietRecall(),
            onGraphDiscovery: () => this.runGraphDiscovery(),
            onScopeRecap: () => this.runScopeRecap(),
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
        this.handleExpandPanel("prepared");
    }

    openQuickReview(): void {
        if (this.petView?.rootEl && this.bubbleView) {
            this.showBubble();
            return;
        }
        this.openPanel();
    }

    clearScopeRecapCache(): void {
        this.invalidatePreparedRecapScope({ resetOperationalState: true });
        this.lastRecapPreparationAttemptAt = Date.now();
        this.lastRecapPreparationScopeKey = this.currentRecapScopeKey();
        this.host.updatePageletSetting("scopeRecapNudgeSuppressions", []);
        new Notice(this.t("pagelet.recap.cacheCleared"), 4000);
    }

    async reviewCurrentNote(options: { preferPanel?: boolean } = {}): Promise<void> {
        await this.analyzeCurrentNote(options);
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
        const expectedContextKey = this.currentActiveNoteSnapshotKey();
        const routeToken = this.beginForegroundRoute("current", "review", {
            reserveGenericBudget: false,
        });
        if (routeToken === null) return;
        try {
            const quietRecall = await this.withForegroundTimeout(this.host.runQuietRecall());
            this.recordQuietRecallDiagnostics(quietRecall);
            if (!this.isCurrentForegroundRoute(routeToken)) return;
            if (expectedContextKey !== this.currentActiveNoteSnapshotKey()) {
                this.host.log("Discarded stale Quiet Recall foreground result", {
                    expectedContextKey,
                    currentContextKey: this.currentActiveNoteSnapshotKey(),
                });
                this.settleForForegroundOwner(routeToken);
                return;
            }
            if (!this.quietRecallRunIsCurrent(quietRecall)) {
                this.host.log("Discarded stale Quiet Recall foreground result", {
                    reason: "source_or_policy_changed",
                });
                this.settleForForegroundOwner(routeToken);
                return;
            }
            this.transitionPet("analysis-done");
            const locale = getPageletUiLanguage();
            const aiCandidates = quietRecall.candidates.filter(
                (candidate) => (
                    candidate.evaluationProvenance === "ai"
                    && Boolean(candidate.evaluationFingerprint?.trim())
                ),
            );
            const discoverCandidates = quietRecall.discoverCandidates ?? quietRecall.candidates;
            const aiCandidatesById = new Map(aiCandidates.map((candidate) => [candidate.id, candidate]));
            const visibleCandidates = discoverCandidates.map(
                (candidate) => aiCandidatesById.get(candidate.id) ?? candidate,
            );
            const visibleCandidateIds = new Set(visibleCandidates.map((candidate) => candidate.id));
            for (const candidate of aiCandidates) {
                if (!visibleCandidateIds.has(candidate.id)) visibleCandidates.push(candidate);
            }
            const deliveryRecall = {
                ...quietRecall,
                totalCount: visibleCandidates.length,
                candidates: visibleCandidates,
                discoverCandidates,
            };
            const payload: PageletDetailPayload = {
                title: pageletT("pagelet.tab.recall.title", locale),
                content: [],
                locale,
                layoutType: "current",
                extra: { quietRecall: deliveryRecall },
                entryReason: "quiet-recall",
            };
            if (quietRecall.currentPath) payload.sourcePath = quietRecall.currentPath;
            await Promise.resolve(this.host.openPageletDetailView(payload));
        } catch (error) {
            if (!this.isCurrentForegroundRoute(routeToken)) return;
            this.transitionPet("analysis-done");
            this.petView?.flashError();
            this.host.log("Pagelet quiet recall failed", error);
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
        this.patternDetectionNudgeAdmissionKey = null;
        this.onboardingNudgeAdmissionKey = null;
    }

    async runScopeRecap(): Promise<void> {
        try {
            if (this.preparedRecapIsCurrent() && this.preparedRecapPayload) {
                this.preparedRecapNudgeFingerprint = null;
                await Promise.resolve(this.host.openPageletDetailView(this.preparedRecapPayload));
                return;
            }
            this.clearPreparedRecapDelivery();
            const overview = await this.host.buildScopeRecapLocalOverview();
            this.lastRecapLocalOverview = overview;
            await Promise.resolve(this.host.openPageletDetailView(
                this.buildScopeRecapExplanationPayload(overview),
            ));
        } catch (error) {
            this.host.log("Pagelet local Scope Recap overview failed", error);
            new Notice(this.t("pagelet.panel.status.error"), 4000);
        }
    }

    private async retryScopeRecap(overview: ScopeRecapLocalOverview): Promise<void> {
        if (!this.host.isScopeRecapProviderConfigured()) {
            this.host.openPageletSettings();
            new Notice(this.t("pagelet.recap.providerSetupRequired"), 5000);
            return;
        }
        const routeToken = this.beginForegroundRoute("summary", "review", {
            reserveGenericBudget: false,
        });
        if (routeToken === null) return;
        try {
            const requestOverview = await this.host.buildScopeRecapLocalOverview();
            if (!this.isCurrentForegroundRoute(routeToken)) return;
            const scopeKey = this.currentRecapScopeKey();
            const result = await this.withForegroundTimeout(this.runScopeRecapPreparation(
                scopeKey,
                "foreground-retry",
                requestOverview,
            ));
            this.recordScopeRecapAttempt(result.attempt);
            if (!this.isCurrentForegroundRoute(routeToken)) return;
            if (!await this.scopeRecapPreparationIsCurrent(result, scopeKey)) {
                const currentOverview = await this.host.buildScopeRecapLocalOverview();
                if (!this.isCurrentForegroundRoute(routeToken)) return;
                await Promise.resolve(this.host.openPageletDetailView(
                    this.buildScopeRecapExplanationPayload(currentOverview),
                ));
                return;
            }
            this.transitionPet("analysis-done");
            const payload = this.acceptScopeRecapPreparation(result, scopeKey, false);
            if (result.status === "ready" && payload) {
                await Promise.resolve(this.host.openPageletDetailView(payload));
                return;
            }
            const fallback = result.localOverview ?? overview;
            await Promise.resolve(this.host.openPageletDetailView(
                this.buildScopeRecapExplanationPayload(fallback),
            ));
            new Notice(this.t("pagelet.recap.retryFailed"), 5000);
        } catch (error) {
            if (!this.isCurrentForegroundRoute(routeToken)) return;
            this.transitionPet("analysis-done");
            this.petView?.flashError();
            this.host.log("Pagelet Scope Recap retry failed", error);
            await Promise.resolve(this.host.openPageletDetailView(
                this.buildScopeRecapExplanationPayload(overview),
            ));
            new Notice(this.t("pagelet.recap.retryFailed"), 5000);
        } finally {
            this.settleForForegroundOwner(routeToken);
            this.sessionManager.finishForegroundReviewRun();
        }
    }

    private async openPreparedRecapDelivery(): Promise<void> {
        if (!this.preparedRecapIsCurrent()) {
            this.clearPreparedRecapDelivery();
            await this.runScopeRecap();
            return;
        }
        this.preparedRecapNudgeFingerprint = null;
        const payload = this.preparedRecapPayload;
        if (!payload) return;
        await Promise.resolve(this.host.openPageletDetailView(payload));
    }

    private storePreparedRecap(
        recap: ScopeRecapRunResult,
        overview: ScopeRecapLocalOverview,
        options: { allowNudge?: boolean } = {},
        scopeKey = this.currentRecapScopeKey(),
    ): PageletDetailPayload {
        const payload = this.buildPreparedRecapPayload(recap);
        const candidate = scopeRecapToDeliveryCandidate(recap);
        if (!candidate) {
            throw new Error("Scope Recap ready result did not pass the delivery quality gate");
        }
        this.preparedRecapArtifact = recap;
        this.preparedRecapCandidate = candidate;
        this.preparedRecapPayload = payload;
        this.preparedRecapScopeKey = scopeKey;
        this.lastRecapLocalOverview = overview;
        if (options.allowNudge) this.maybeSurfacePreparedRecapNudge(recap);
        return payload;
    }

    private acceptScopeRecapPreparation(
        result: ScopeRecapPreparationResult,
        scopeKey: string | null,
        allowNudge: boolean,
    ): PageletDetailPayload | null {
        this.lastRecapLocalOverview = result.localOverview;
        if (result.status !== "ready") return null;
        return this.storePreparedRecap(result.artifact, result.localOverview, { allowNudge }, scopeKey);
    }

    private maybeSurfacePreparedRecapNudge(recap: ScopeRecapRunResult): void {
        if (
            this.host.settings.focusMode
            || !this.host.settings.pagelet.petVisible
            || !this.petView
            || !this.host.settings.pagelet.scopeRecapHighValueHints
        ) return;
        const quality = evaluateScopeRecapProactiveQuality(recap);
        if (!quality.eligible) return;
        const now = Date.now();
        const snoozedUntil = this.snoozedRecapNudgeFingerprints.get(quality.fingerprint);
        if (snoozedUntil !== undefined && snoozedUntil <= now) {
            this.snoozedRecapNudgeFingerprints.delete(quality.fingerprint);
        }
        if (
            this.shownRecapNudgeFingerprints.has(quality.fingerprint)
            || this.preparedRecapNudgeFingerprint === quality.fingerprint
            || (snoozedUntil !== undefined && snoozedUntil > now)
        ) return;
        if (!this.proactiveHints.onInsightsReady({ enabled: true })) return;
        this.preparedRecapNudgeFingerprint = quality.fingerprint;
        this.reconcilePetNudge();
    }

    private snoozePreparedRecapNudge(): void {
        const fingerprint = this.preparedRecapNudgeFingerprint
            ?? this.preparedRecapCandidate?.id;
        if (fingerprint) {
            const now = Date.now();
            if (!this.shownRecapNudgeFingerprints.has(fingerprint)) {
                this.shownRecapNudgeFingerprints.set(fingerprint, now);
            }
            this.snoozedRecapNudgeFingerprints.set(
                fingerprint,
                now + PageletOrchestrator.PREPARED_RECAP_LATER_SNOOZE_MS,
            );
            this.persistScopeRecapNudgeSuppressions();
        }
        this.preparedRecapNudgeFingerprint = null;
    }

    private currentPreparedRecapCandidate(): (DeliveryCandidate & { kind: "recap" }) | null {
        if (!this.preparedRecapIsCurrent()) {
            this.clearPreparedRecapDelivery();
            return null;
        }
        const candidate = this.preparedRecapCandidate;
        const snoozedUntil = candidate
            ? this.snoozedRecapNudgeFingerprints.get(candidate.id)
            : undefined;
        if (snoozedUntil !== undefined && snoozedUntil > Date.now()) return null;
        if (candidate && snoozedUntil !== undefined) {
            this.snoozedRecapNudgeFingerprints.delete(candidate.id);
            this.persistScopeRecapNudgeSuppressions();
        }
        return candidate;
    }

    private currentPreparedRecapNudgeCandidate(): (DeliveryCandidate & { kind: "recap" }) | null {
        const candidate = this.currentPreparedRecapCandidate();
        return candidate && candidate.id === this.preparedRecapNudgeFingerprint
            ? candidate
            : null;
    }

    private currentAdmittedNudgeTickets(): NudgeTicket[] {
        const tickets: NudgeTicket[] = [];
        const preparedRecap = this.currentPreparedRecapNudgeCandidate();
        if (preparedRecap) {
            tickets.push({
                key: `${NudgeOwner.PreparedRecap}:${preparedRecap.id}`,
                owner: NudgeOwner.PreparedRecap,
                candidate: preparedRecap,
            });
        }

        const quietRecallCandidate = this.quietRecallNudgeCandidate;
        const quietRecallNudge = this.quietRecallBubbleNudge;
        const quietRecallDelivery = quietRecallCandidate
            ? quietRecallCandidateToDeliveryCandidate(quietRecallCandidate)
            : null;
        if (
            quietRecallCandidate
            && quietRecallNudge
            && quietRecallDelivery
            && quietRecallCandidate.id === quietRecallNudge.candidateId
        ) {
            const stableIdentity = quietRecallCandidate.evaluationFingerprint?.trim()
                || quietRecallCandidate.id;
            tickets.push({
                key: `${NudgeOwner.QuietRecall}:${stableIdentity}`,
                owner: NudgeOwner.QuietRecall,
                candidate: quietRecallCandidate,
                deliveryCandidate: quietRecallDelivery,
                nudge: quietRecallNudge,
            });
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

    private preparedRecapIsCurrent(): boolean {
        return Boolean(
            this.preparedRecapArtifact
            && this.preparedRecapCandidate
            && this.preparedRecapPayload
            && this.preparedRecapScopeKey
            && this.preparedRecapScopeKey === this.currentRecapScopeKey()
            && this.preparedRecapArtifact.dataBoundarySnapshotId
                === this.host.getScopeRecapDataBoundarySnapshotId()
            && this.scopeRecapArtifactWithinTtl(this.preparedRecapArtifact)
        );
    }

    private scopeRecapArtifactWithinTtl(recap: ScopeRecapRunResult): boolean {
        const generatedAt = Date.parse(recap.generatedAt);
        const ttlMs = recap.ttlDays * 24 * 60 * 60 * 1000;
        return Number.isFinite(generatedAt)
            && Number.isFinite(ttlMs)
            && ttlMs > 0
            && Date.now() < generatedAt + ttlMs;
    }

    private buildPreparedRecapPayload(recap: ScopeRecapRunResult): PageletDetailPayload {
        const locale = getPageletUiLanguage();
        const items = this.orderedScopeRecapItems(recap);
        const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
            dateStyle: "medium",
            timeStyle: "short",
        });
        const localizedGeneratedAt = dateFormatter.format(new Date(recap.generatedAt));
        const scopeLabel = recap.scope.label ?? recap.scope.kind;
        const content: TabSection[] = [
            {
                title: pageletT("pagelet.recap.detail.observations", locale),
                cards: items.map((item) => ({
                    title: item.title,
                    body: item.whyItMatters
                        ? `${item.summary}\n\n${item.whyItMatters}`
                        : item.summary,
                    cardStyle: item.section === "tension" ? "comparison" : "insight",
                    sourceLinks: item.sourceRefs.map((ref) => ({ path: ref.path })),
                })),
            },
            {
                title: pageletT("pagelet.recap.detail.scope", locale),
                cards: [{
                    body: pageletT("pagelet.recap.detail.scopeInfo", locale, {
                        scope: scopeLabel,
                        generatedAt: localizedGeneratedAt,
                    }),
                }],
            },
            {
                title: pageletT("pagelet.recap.detail.sources", locale),
                cards: [{
                    body: "",
                    cardStyle: "source-list",
                    sourceLinks: recap.sourceRefs.map((ref) => ({ path: ref.path })),
                }],
            },
            {
                title: pageletT("pagelet.recap.detail.coverageTitle", locale),
                cards: [{
                    body: pageletT("pagelet.recap.detail.coverage", locale, {
                        included: recap.sourceCoverage.includedSourceCount,
                        total: recap.sourceCoverage.totalSourceCount,
                        skipped: recap.sourceCoverage.skippedSourceCount,
                    }),
                }],
            },
        ];
        return {
            title: pageletT("pagelet.tab.scopeRecap.title", locale),
            content,
            locale,
            layoutType: "review",
            extra: { scopeRecap: recap },
            sourcePath: recap.scope.paths?.[0],
            entryReason: "scope-recap",
        };
    }

    private orderedScopeRecapItems(recap: ScopeRecapRunResult): ScopeRecapItem[] {
        return [
            ...recap.tensions,
            ...recap.openQuestions,
            ...recap.themes,
        ];
    }

    private buildScopeRecapExplanationPayload(overview: ScopeRecapLocalOverview): PageletDetailPayload {
        const locale = getPageletUiLanguage();
        const firstSource = overview.includedSources[0];
        const changedSources = overview.includedSources.filter((source) => source.changed);
        const content: TabSection[] = [{
            title: pageletT("pagelet.recap.explanation.title", locale),
            cards: [{
                body: pageletT("pagelet.recap.explanation.body", locale, {
                    scope: overview.scope.label ?? overview.scope.kind,
                    included: overview.sourceCoverage.includedSourceCount,
                    skipped: overview.sourceCoverage.skippedSourceCount,
                }),
            }, {
                title: pageletT("pagelet.recap.explanation.retryTitle", locale),
                body: pageletT("pagelet.recap.explanation.retryBody", locale),
                cardStyle: "action",
                actionLabel: pageletT("pagelet.recap.explanation.retry", locale),
                actionCallback: () => { void this.retryScopeRecap(overview); },
            }],
        }];
        if (changedSources.length > 0) {
            const changedTimes = changedSources
                .map((source) => source.modifiedAt ? Date.parse(source.modifiedAt) : Number.NaN)
                .filter(Number.isFinite)
                .sort((left, right) => left - right);
            const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
                dateStyle: "medium",
            });
            const range = changedTimes.length > 0
                ? pageletT("pagelet.recap.explanation.recentChangesRange", locale, {
                    from: dateFormatter.format(changedTimes[0]),
                    to: dateFormatter.format(changedTimes[changedTimes.length - 1]),
                })
                : pageletT("pagelet.recap.explanation.recentChangesNoRange", locale);
            content.push({
                title: pageletT("pagelet.recap.explanation.recentChangesTitle", locale),
                cards: [{
                    body: pageletT("pagelet.recap.explanation.recentChangesBody", locale, {
                        count: changedSources.length,
                        range,
                    }),
                    cardStyle: "source-list",
                    sourceLinks: changedSources.map((source) => ({
                        path: source.path,
                        title: source.title,
                    })),
                }],
            });
        }
        if (overview.includedSources.length > 0) {
            content.push({
                title: pageletT("pagelet.recap.detail.sources", locale),
                cards: [{
                    body: "",
                    cardStyle: "source-list",
                    sourceLinks: overview.includedSources.map((source) => ({
                        path: source.path,
                        title: source.title,
                    })),
                }, ...(firstSource ? [{
                    title: pageletT("pagelet.recap.explanation.viewSourcesTitle", locale),
                    body: pageletT("pagelet.recap.explanation.viewSourcesBody", locale),
                    cardStyle: "action" as const,
                    actionLabel: pageletT("pagelet.recap.explanation.viewSources", locale),
                    actionCallback: () => this.handleSourceClick(firstSource.path),
                }] : [])],
            });
        }
        return {
            title: pageletT("pagelet.tab.scopeRecap.title", locale),
            content,
            locale,
            layoutType: "review",
            sourcePath: firstSource?.path,
            entryReason: "scope-recap",
        };
    }

    private schedulePreparedRecap(
        reason: "pagelet-open" | "note-activity" | "idle",
        delayMs: number,
    ): void {
        if (this.destroyed) return;
        if (!this.host.settings.pagelet.enabled) return;
        const settings = this.host.settings.pagelet;
        if (settings.scopeRecapBackgroundAuthorization === "declined-v1") return;
        if (!settings.scopeRecapPreparationEnabled) return;
        this.clearRecapPreparationTimer();
        this.recapPreparationTimer = setPlatformTimeout(() => {
            this.recapPreparationTimer = null;
            void this.prepareRecapDelivery(reason);
        }, delayMs);
    }

    private async prepareRecapDelivery(reason: "pagelet-open" | "note-activity" | "idle"): Promise<void> {
        if (this.destroyed) return;
        if (this.recapPreparationInFlight || this.recapPreparationPromise) {
            this.recapPreparationPendingReason = reason;
            return;
        }
        const authorizedOverview = await this.ensureScopeRecapBackgroundAuthorization();
        if (!authorizedOverview) return;
        if (
            !this.host.settings.pagelet.enabled
            || !this.host.settings.pagelet.scopeRecapPreparationEnabled
            || this.host.settings.focusMode
            || !this.host.isScopeRecapProviderConfigured()
        ) return;
        const scopeKey = this.currentRecapScopeKey();
        if (!scopeKey) return;
        if (this.preparedRecapMatchesOverview(authorizedOverview, scopeKey)) {
            this.lastRecapLocalOverview = authorizedOverview;
            return;
        }
        const now = Date.now();
        if (now < this.recapBackgroundRetryAt) return;
        if (this.lastRecapPreparationScopeKey === scopeKey
            && now - this.lastRecapPreparationAttemptAt < PageletOrchestrator.PREPARED_RECAP_MIN_INTERVAL_MS) return;
        this.lastRecapPreparationAttemptAt = now;
        this.lastRecapPreparationScopeKey = scopeKey;
        this.recapPreparationInFlight = true;
        const petWorkToken = this.beginRecapPetWork();
        try {
            const result = await this.runScopeRecapPreparation(scopeKey, "background", authorizedOverview);
            this.recordScopeRecapAttempt(result.attempt);
            if (!await this.scopeRecapPreparationIsCurrent(result, scopeKey)) return;
            this.acceptScopeRecapPreparation(result, scopeKey, result.status === "ready");
            if (result.status === "ready") {
                this.recapBackgroundFailureCount = 0;
                this.recapBackgroundRetryAt = 0;
            } else {
                this.recordScopeRecapBackgroundFailure();
            }
        } catch (error) {
            this.host.log(`Pagelet prepared recap skipped (${reason})`, error);
            this.recordScopeRecapBackgroundFailure();
        } finally {
            this.settleRecapPetWork(petWorkToken);
            this.recapPreparationInFlight = false;
            const pendingReason = this.recapPreparationPendingReason;
            this.recapPreparationPendingReason = null;
            if (pendingReason && !this.destroyed) {
                this.schedulePreparedRecap(pendingReason, 0);
            }
        }
    }

    /** SG-06: standard bounded Recap uses the capability toggle directly. */
    private async ensureScopeRecapBackgroundAuthorization(): Promise<ScopeRecapLocalOverview | null> {
        const settings = this.host.settings.pagelet;
        if (!settings.enabled || this.host.settings.focusMode) return null;
        if (!this.host.isScopeRecapProviderConfigured()) return null;
        if (!settings.scopeRecapPreparationEnabled) return null;
        if (settings.scopeRecapBackgroundAuthorization === "declined-v1") return null;

        const overview = await this.host.buildScopeRecapLocalOverview();
        this.lastRecapLocalOverview = overview;
        if (overview.sourceCoverage.includedSourceCount < 2) return null;
        return overview;
    }

    private recordScopeRecapBackgroundFailure(): void {
        this.recapBackgroundFailureCount += 1;
        const delay = this.recapBackgroundFailureCount === 1
            ? PageletOrchestrator.PREPARED_RECAP_FIRST_RETRY_MS
            : PageletOrchestrator.PREPARED_RECAP_LATER_RETRY_MS;
        this.recapBackgroundRetryAt = Date.now() + delay;
    }

    private currentRecapScopeKey(): string | null {
        const activeFile = this.host.app.workspace.getActiveFile?.();
        if (!activeFile || !activeFile.path.endsWith(".md")) return null;
        const mtime = typeof activeFile.stat?.mtime === "number" ? activeFile.stat.mtime : 0;
        const size = typeof activeFile.stat?.size === "number" ? activeFile.stat.size : 0;
        return `${activeFile.path}:${mtime}:${size}:${this.recapScopeRevision}:${this.host.getScopeRecapAuthorizationContextId()}`;
    }

    private currentRecapRuntimeGateIdentity(): string {
        const settings = this.host.settings.pagelet;
        return JSON.stringify({
            pageletEnabled: settings.enabled,
            focusMode: this.host.settings.focusMode,
            currentAuthorizationContextId: this.host.getScopeRecapAuthorizationContextId(),
            preparationEnabled: settings.scopeRecapPreparationEnabled,
        });
    }

    private clearRecapPreparationTimer(): void {
        if (this.recapPreparationTimer !== null) {
            clearPlatformTimeout(this.recapPreparationTimer);
            this.recapPreparationTimer = null;
        }
    }

    private clearPreparedRecapDelivery(options: { resetOperationalState?: boolean } = {}): void {
        this.preparedRecapArtifact = null;
        this.preparedRecapCandidate = null;
        this.preparedRecapPayload = null;
        this.preparedRecapScopeKey = null;
        this.preparedRecapNudgeFingerprint = null;
        this.lastRecapPreparationScopeKey = null;
        if (options.resetOperationalState) {
            this.lastRecapAttempt = null;
            this.host.updatePageletSetting("scopeRecapLastAttempt", null);
            this.lastRecapLocalOverview = null;
            this.shownRecapNudgeFingerprints.clear();
            this.snoozedRecapNudgeFingerprints.clear();
            this.recapBackgroundFailureCount = 0;
            this.recapBackgroundRetryAt = 0;
        }
    }

    private invalidatePreparedRecapScope(options: { resetOperationalState?: boolean } = {}): void {
        this.recapScopeRevision += 1;
        this.cancelRecapPetWork();
        this.clearPreparedRecapDelivery(options);
        this.host.clearScopeRecapDetailSessionCache?.();
        this.reconcilePetNudge();
    }

    private runScopeRecapPreparation(
        scopeKey: string | null,
        mode: "background" | "foreground-retry",
        overview: ScopeRecapLocalOverview,
    ): Promise<ScopeRecapPreparationResult> {
        if (
            this.recapPreparationPromise
            && this.recapPreparationPromiseScopeKey === scopeKey
        ) return this.recapPreparationPromise;
        if (this.recapPreparationPromise) {
            const previous = this.recapPreparationPromise;
            return previous.catch(() => undefined).then(() => {
                if (this.destroyed || scopeKey !== this.currentRecapScopeKey()) {
                    throw new Error("Scope Recap request became stale before it started");
                }
                return this.runScopeRecapPreparation(scopeKey, mode, overview);
            });
        }
        const promise = this.host.runScopeRecap({
            mode,
            expectedSourceSnapshotId: overview.sourceSnapshotId,
            expectedDataBoundarySnapshotId: overview.dataBoundarySnapshotId,
            expectedAuthorizationContextId: this.host.getScopeRecapAuthorizationContextId(),
        });
        this.recapPreparationPromise = promise;
        this.recapPreparationPromiseScopeKey = scopeKey;
        promise.then(
            () => {
                if (this.recapPreparationPromise === promise) {
                    this.recapPreparationPromise = null;
                    this.recapPreparationPromiseScopeKey = null;
                }
            },
            () => {
                if (this.recapPreparationPromise === promise) {
                    this.recapPreparationPromise = null;
                    this.recapPreparationPromiseScopeKey = null;
                }
            },
        );
        return promise;
    }

    private async scopeRecapPreparationIsCurrent(
        result: ScopeRecapPreparationResult,
        scopeKey: string | null,
    ): Promise<boolean> {
        if (
            !this.host.settings.pagelet.enabled
            || !this.host.settings.pagelet.scopeRecapPreparationEnabled
            || this.host.settings.focusMode
        ) return false;
        if (this.destroyed || !scopeKey || scopeKey !== this.currentRecapScopeKey()) return false;
        const currentOverview = await this.host.buildScopeRecapLocalOverview();
        if (this.destroyed || scopeKey !== this.currentRecapScopeKey()) return false;
        if (
            result.localOverview.sourceSnapshotId !== currentOverview.sourceSnapshotId
            || result.localOverview.dataBoundarySnapshotId !== currentOverview.dataBoundarySnapshotId
        ) return false;
        if (result.status !== "ready") return true;
        return evaluateScopeRecapArtifactCurrentness(result.artifact, {
            scope: currentOverview.scope,
            sourceSnapshotId: currentOverview.sourceSnapshotId,
            dataBoundarySnapshotId: currentOverview.dataBoundarySnapshotId,
        }).current;
    }

    private preparedRecapMatchesOverview(
        overview: ScopeRecapLocalOverview,
        scopeKey: string,
    ): boolean {
        if (
            !this.preparedRecapArtifact
            || !this.preparedRecapCandidate
            || !this.preparedRecapPayload
            || this.preparedRecapScopeKey !== scopeKey
        ) return false;
        return evaluateScopeRecapArtifactCurrentness(this.preparedRecapArtifact, {
            scope: overview.scope,
            sourceSnapshotId: overview.sourceSnapshotId,
            dataBoundarySnapshotId: overview.dataBoundarySnapshotId,
        }).current;
    }

    private recordScopeRecapAttempt(attempt: ScopeRecapAttemptStatus): void {
        this.lastRecapAttempt = attempt;
        this.host.updatePageletSetting("scopeRecapLastAttempt", attempt);
    }

    private persistScopeRecapNudgeSuppressions(): void {
        const suppressions = [...this.shownRecapNudgeFingerprints.entries()]
            .map(([fingerprint, shownAt]) => ({
                fingerprint,
                shownAt,
                ...(this.snoozedRecapNudgeFingerprints.has(fingerprint)
                    ? { snoozedUntil: this.snoozedRecapNudgeFingerprints.get(fingerprint) }
                    : {}),
            }))
            .sort((left, right) => left.shownAt - right.shownAt)
            .slice(-200);
        this.host.updatePageletSetting("scopeRecapNudgeSuppressions", suppressions);
    }

    private setPetTaskKind(taskKind: PetTaskKind): void {
        this.petView?.setTaskKind?.(taskKind);
    }

    /** A background Recap owns the Pet only when no task or nudge already owns it. */
    private beginRecapPetWork(): number {
        const token = ++this.recapPetWorkToken;
        const canTransition = typeof (this.petView?.stateMachine as { transition?: unknown } | undefined)?.transition === "function";
        const claimedPet = Boolean(
            this.petView
            && canTransition
            && !this.sessionManager.isForegroundRunInProgress
            && this.petView.stateMachine.state !== "working"
            && this.petView.stateMachine.state !== "nudge",
        );
        this.activeRecapPetWork = { token, claimedPet };
        if (claimedPet) this.transitionPet("analysis-start", "summary");
        return token;
    }

    private settleRecapPetWork(token: number): void {
        const owner = this.activeRecapPetWork;
        if (!owner || owner.token !== token) return;
        this.activeRecapPetWork = null;
        if (
            owner.claimedPet
            && !this.sessionManager.isForegroundRunInProgress
            && this.petView?.stateMachine.state === "working"
            && this.petView.taskKind === "summary"
        ) {
            this.transitionPet("analysis-done");
        }
    }

    private cancelRecapPetWork(): void {
        const owner = this.activeRecapPetWork;
        if (!owner) return;
        this.activeRecapPetWork = null;
        this.recapPetWorkToken += 1;
        if (
            owner.claimedPet
            && !this.sessionManager.isForegroundRunInProgress
            && this.petView?.stateMachine.state === "working"
            && this.petView.taskKind === "summary"
        ) {
            this.transitionPet("analysis-done");
        }
    }

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
        this.saveFlow.clearPending();
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
        this.bubbleCoordinator.reconcileNudge(this.bubbleView, this.petView);
    }

    private async reviewSelectedScope(): Promise<void> {
        const plan = this.sessionManager.ensureScopePlan();
        if (!plan) {
            new Notice(this.t("pagelet.notice.noNotesInRange"), 4000);
            return;
        }
        const selection = selectPageletScope(plan);
        const files = selection.paths
            .map((path) => this.host.app.vault.getAbstractFileByPath(path))
            .filter((file): file is TFile => Boolean(file && "extension" in file && file.extension === "md"));

        if (files.length === 0) {
            new Notice(this.t("pagelet.notice.noNotesInRange"), 4000);
            return;
        }

        await this.analyzeFiles(files, {
            preferPanel: true,
            panelLayout: "review",
            range: selection.range,
            expectedActivePath: selection.range === "current" ? plan.activePath : undefined,
        });
    }

    private refreshReviewPanel(): void {
        this.currentPanelLayout = "review";
        this.saveFlow.clearPending();
        this.panelView?.open(
            "review",
            this.sessionManager.defaultReviewPanelFindings(this.currentPanelLayout),
            this.panelExtraForLayout("review"),
        );
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
        const addSkippedPath = (path: string, reason: ContextDropReason): void => {
            const normalized = normalizePath(path);
            if (!normalized || skipped.has(normalized)) return;
            skipped.set(normalized, {
                ...toReplaySourceRef({ path: normalized, whyShown: [reason] }),
                skippedReason: reason,
                boundaryReason: reason === "privacy excluded" ? "data_boundary" : undefined,
            });
        };

        for (const candidate of extra?.scope?.candidates ?? []) {
            if (candidate.included) {
                addUsedPath(candidate.path, [
                    pageletT(`pagelet.panel.scope.reason.${candidate.reason}`, getPageletUiLanguage()),
                ]);
            } else {
                addSkippedPath(candidate.path, contextDropReasonForScopeSkip(candidate.skippedReason));
            }
        }

        if (extra?.sourcePath) addUsedPath(extra.sourcePath, ["Current Pagelet source"]);
        for (const connection of extra?.connections ?? []) {
            addUsedPath(connection.fromNote, ["Connection discovery source"]);
            addUsedPath(connection.toNote, ["Related source"]);
        }
        if (used.size === 0 && layoutType === "current") {
            const activePath = this.host.app.workspace.getActiveFile?.()?.path;
            if (activePath) addUsedPath(activePath, ["Current note"]);
        }
        if (used.size === 0 && skipped.size === 0) return null;

        const skippedSources = [...skipped.values()];
        return {
            id: `${Date.now().toString(36)}-${layoutType}`,
            status: used.size > 0
                ? skippedSources.length > 0 ? "partial_evidence" : "evidence_found"
                : "blocked_by_privacy",
            taskKind: `pagelet_${layoutType}`,
            scope: extra?.scope?.range ?? layoutType,
            sources: [...used.values()],
            skippedSources,
            missingScopeHints: extra?.scope && extra.scope.skippedCount > 0
                ? [`${extra.scope.skippedCount} notes skipped by current scope`]
                : undefined,
            whyShown: ["Pagelet selected visible sources for this review"],
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
        for (const candidate of extra?.scope?.candidates ?? []) {
            if (candidate.included) paths.add(normalizePath(candidate.path));
        }
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

    // ======================================================================
    // Pet lifecycle
    // ======================================================================

    /** Re-mount Pet on leaf change. */
    private handleLeafChange(leaf: WorkspaceLeaf | null): void {
        // Always unmount from previous location
        this.petView?.unmount();
        this.bubbleView?.close();
        this.invalidateQuietRecallBubbleNudge();

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
                    onReviewCurrentNote: () => { void this.reviewCurrentNote(); },
                    onDiscoverConnections: () => { void this.discoverConnections(); },
                },
            });
            // Sync proactive-hints flag into state machine
            this.petView.stateMachine.proactiveHintsEnabled =
                this.host.settings.pagelet.proactiveHints;
        }

        this.petView.mount(containerEl);
        if (this.canPrepareQuietRecallBubbleNudge()) {
            this.scheduleQuietRecallAfterLeafChange(
                PageletOrchestrator.QUIET_RECALL_LEAF_CHANGE_DEBOUNCE_MS);
        }
        this.schedulePreparedRecap(
            "pagelet-open",
            PageletOrchestrator.PREPARED_RECAP_LEAF_CHANGE_DEBOUNCE_MS,
        );
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

    /** Show the Bubble via the BubbleCoordinator. Suppressed by Focus Mode. */
    private showBubble(): void {
        if (this.host.settings.focusMode) return;
        this.bubbleCoordinator.showBubble(this.bubbleView, this.petView);
    }

    /** Analyze the current note (Scenario 2: Writing Assistance). */
    private async analyzeCurrentNote(options: { preferPanel?: boolean } = {}): Promise<void> {
        const activeFile = this.host.app.workspace.getActiveFile?.();
        if (!activeFile || !activeFile.path.endsWith(".md")) return;

        await this.analyzeFiles([activeFile], {
            preferPanel: options.preferPanel,
            panelLayout: "current",
            range: "current",
            expectedActivePath: activeFile.path,
        });
    }

    private async discoverConnections(): Promise<void> {
        const activeFile = this.host.app.workspace.getActiveFile?.();
        if (!activeFile || !activeFile.path.endsWith(".md")) return;
        if (!this.host.isPathAllowedForPagelet(activeFile.path)) return;
        const expectedActivePath = activeFile.path;
        // Local explicit-link results must remain zero-cost. Provider-backed
        // retrieval/generation reserve only at their actual invocation seams.
        if (!this.sessionManager.beginForegroundReviewRun({ reserveBudget: false })) return;
        const routeToken = ++this.foregroundRouteToken;

        let petFinished = false;
        const finishPet = (): void => {
            if (petFinished) return;
            petFinished = true;
            this.transitionPet("analysis-done");
        };
        this.transitionPet("analysis-start", "connection");

        try {
            const content = await this.host.app.vault.cachedRead(activeFile);
            if (
                !this.activePathStillMatches(expectedActivePath, routeToken)
                || !this.host.isPathAllowedForPagelet(activeFile.path)
            ) return;
            const currentNote = { path: activeFile.path, content };
            const noteContents = [{ path: activeFile.path, content }];

            const explicitRelatedNotes = await this.findExplicitLinkedNotes(activeFile, [activeFile.path]);
            const explicitConnections = this.buildExplicitLinkConnections(activeFile.path, explicitRelatedNotes);
            let memoryRelatedNotes: Awaited<ReturnType<PageletHost["findRelatedNotes"]>>;
            try {
                memoryRelatedNotes = await this.host.findRelatedNotes(
                    activeFile.path,
                    noteContents,
                    [activeFile.path],
                );
            } catch (error) {
                if (explicitConnections.length === 0) throw error;
                finishPet();
                this.host.log("Discovery Memory retrieval failed; showing explicit wikilinks", error);
                if (!this.activePathStillMatches(expectedActivePath, routeToken)) return;
                this.openDiscoveryResult(activeFile.path, explicitConnections);
                return;
            }
            const relatedNotes = [...new Map(
                [...explicitRelatedNotes, ...memoryRelatedNotes].map((note) => [note.path, note]),
            ).values()];

            if (relatedNotes.length === 0) {
                const locale = getPageletUiLanguage();
                finishPet();
                if (!this.activePathStillMatches(expectedActivePath, routeToken)) return;
                const isMemoryReady = await this.host.isMemoryReadyForPageletDiscovery();
                if (!this.activePathStillMatches(expectedActivePath, routeToken)) return;
                const titleKey = isMemoryReady
                    ? "pagelet.discover.noResults.title"
                    : "pagelet.discover.vssNotReady.title";
                const descKey = isMemoryReady
                    ? "pagelet.discover.noResults.desc"
                    : "pagelet.discover.vssNotReady.desc";
                this.openDiscoveryPanel([{
                    title: pageletT(titleKey, locale),
                    description: pageletT(descKey, locale),
                    insightText: pageletT(descKey, locale),
                    sourceFile: "",
                    sourceTitle: "",
                }], { sourcePath: activeFile.path });
                return;
            }

            if (
                !this.activePathStillMatches(expectedActivePath, routeToken)
                || !this.host.isPathAllowedForPagelet(activeFile.path)
                || relatedNotes.some((note) => !this.host.isPathAllowedForPagelet(note.path))
            ) return;
            let result: DiscoveryResult | null;
            try {
                result = await this.withForegroundTimeout(
                    this.host.discoverConnections(currentNote, relatedNotes),
                );
            } catch (error) {
                if (explicitConnections.length === 0) throw error;
                finishPet();
                this.host.log("Discovery AI analysis failed; showing explicit wikilinks", error);
                if (!this.activePathStillMatches(expectedActivePath, routeToken)) return;
                this.openDiscoveryResult(activeFile.path, explicitConnections);
                return;
            }
            finishPet();

            const connections = mergeDiscoveryConnections(explicitConnections, result?.connections ?? []);

            if (!result && connections.length === 0) {
                this.handleExpandPanel("discover");
                return;
            }

            if (!this.activePathStillMatches(expectedActivePath, routeToken)) return;
            this.openDiscoveryResult(activeFile.path, connections, result?.gaps ?? []);
        } catch (error) {
            finishPet();
            this.petView?.flashError();
            this.host.log("Discovery analysis failed", error);
            new Notice(pageletT("pagelet.panel.status.actionFailed", getPageletUiLanguage()), 5000);
        } finally {
            this.sessionManager.finishForegroundReviewRun();
        }
    }

    private activePathStillMatches(expectedPath: string, routeToken: number): boolean {
        if (!this.isCurrentForegroundRoute(routeToken)) return false;
        return this.host.app.workspace.getActiveFile?.()?.path === expectedPath;
    }

    private openDiscoveryResult(
        sourcePath: string,
        connections: readonly NoteConnection[],
        gaps: DiscoveryResult["gaps"] = [],
    ): void {
        const findings: PanelFinding[] = [
            ...connections.map((c) => ({
                title: c.sharedConcepts[0] ?? "",
                description: c.sharedConcepts.join("; "),
                insightText: c.sharedConcepts.join("; "),
                sourceFile: c.toNote,
                sourceTitle: noteTitleFromPath(c.toNote),
            })),
            ...gaps.map((g) => ({
                title: g.topic,
                description: g.description,
                insightText: g.description,
                sourceFile: sourcePath,
                sourceTitle: g.topic,
            })),
        ];

        this.openDiscoveryPanel(findings, {
            connections: [...connections],
            sourcePath,
        });
    }

    private async findExplicitLinkedNotes(
        sourceFile: TFile,
        excludedPaths: readonly string[],
    ): Promise<Array<{ path: string; content: string }>> {
        const cache = this.host.app.metadataCache.getFileCache?.(sourceFile);
        const links = [
            ...((cache as { links?: Array<{ link?: string }> } | null | undefined)?.links ?? []),
            ...((cache as { embeds?: Array<{ link?: string }> } | null | undefined)?.embeds ?? []),
        ];
        if (links.length === 0) return [];

        const excluded = new Set(excludedPaths.map((path) => normalizePath(path)));
        const seen = new Set<string>();
        const related: Array<{ path: string; content: string }> = [];

        for (const link of links) {
            if (typeof link.link !== "string" || !link.link.trim()) continue;
            const file = resolveRelatedMarkdownNote(this.host.app, link.link, sourceFile.path);
            if (!file) continue;
            const path = normalizePath(file.path);
            if (excluded.has(path) || seen.has(path)) continue;
            if (!this.host.isPathAllowedForPagelet(path)) continue;
            const scopeResult = this.scopeResolver.resolveCurrentNote(file);
            if (scopeResult.included.length === 0) continue;
            seen.add(path);

            try {
                related.push({
                    path,
                    content: (await this.host.app.vault.cachedRead(file)).slice(0, 1200),
                });
            } catch (error) {
                this.host.log("Pagelet explicit related-note read skipped", { path, error });
            }
            if (related.length >= 6) break;
        }

        return related;
    }

    private buildExplicitLinkConnections(
        sourcePath: string,
        relatedNotes: ReadonlyArray<{ path: string }>,
    ): NoteConnection[] {
        if (relatedNotes.length === 0) return [];
        const locale = getPageletUiLanguage();
        return relatedNotes.map((note) => ({
            fromNote: sourcePath,
            toNote: note.path,
            strength: "strong" as const,
            sharedConcepts: [pageletT("pagelet.panel.discovery.explicitWikilink", locale)],
        }));
    }

    private async analyzeFiles(
        files: TFile[],
        options: {
            preferPanel?: boolean;
            panelLayout: PanelLayoutType;
            range: PageletReviewRange;
            expectedActivePath?: string;
        },
    ): Promise<void> {
        if (files.length === 0) return;
        // Review provider-call budgets are reserved at the actual invocation
        // seam, after any multi-note per-run confirmation.
        if (!this.sessionManager.beginForegroundReviewRun({ reserveBudget: false })) return;
        ++this.foregroundRouteToken;

        this.transitionPet("analysis-start", "review");

        try {
            const result = await this.sessionManager.analyzeFiles(
                files,
                {
                    range: options.range,
                    expectedActivePath: options.expectedActivePath,
                },
                () => this.destroyed,
            );

            if (!result) {
                // Run was stale/superseded/destroyed
                this.transitionPet("analysis-done");
                return;
            }

            this.transitionPet("analysis-done");

            if (options.preferPanel) {
                this.currentPanelLayout = options.panelLayout;
                this.panelView?.open(
                    options.panelLayout,
                    result.findings,
                    this.panelExtraForLayout(options.panelLayout),
                );
                return;
            }

            if (!this.bubbleView || !this.petView?.rootEl) {
                this.handleExpandPanel(options.panelLayout);
                return;
            }
            this.bubbleCoordinator.showAnalysisResults(
                this.bubbleView, this.petView, result.rawFindings,
            );
        } catch (error) {
            this.transitionPet("analysis-done");
            this.petView?.flashError();
            this.host.log("Current note analysis failed", error);
            const message = error instanceof Error ? error.message : String(error);
            if (options.preferPanel) {
                this.currentPanelLayout = options.panelLayout;
                this.panelView?.showReviewError(message || this.t("pagelet.panel.status.actionFailed"));
            }
            new Notice(message || this.t("pagelet.panel.status.actionFailed"), 5000);
        } finally {
            this.sessionManager.finishForegroundReviewRun();
        }
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
        this.clearActivityDebounce();
        this.activityDebounceTimer = setPlatformTimeout(() => {
            this.activityDebounceTimer = null;
            this.petView?.stateMachine.transition("note-activity");
            this.backgroundPrep.noteActivity();
            void this.prepareQuietRecallBubbleNudge();
            if (!modifiedPath || this.pathTouchesCurrentRecapScope(modifiedPath)) {
                if (this.preparedRecapArtifact) this.invalidatePreparedRecapScope();
                this.schedulePreparedRecap(
                    "note-activity",
                    PageletOrchestrator.PREPARED_RECAP_NOTE_ACTIVITY_DEBOUNCE_MS,
                );
            }
            this.resetIdleTimer();
        }, PageletOrchestrator.ACTIVITY_DEBOUNCE_MS);
    }

    private pathTouchesCurrentRecapScope(path: string): boolean {
        const activePath = this.host.app.workspace.getActiveFile?.()?.path;
        if (!activePath || !activePath.endsWith(".md")) return false;
        const folder = (value: string): string => {
            const normalized = normalizePath(value);
            const slash = normalized.lastIndexOf("/");
            return slash >= 0 ? normalized.slice(0, slash) : "";
        };
        return folder(path) === folder(activePath);
    }

    private pathTouchesCurrentQuietRecall(path: string): boolean {
        const normalized = normalizePath(path);
        const activePath = this.host.app.workspace.getActiveFile?.()?.path;
        if (activePath && normalizePath(activePath) === normalized) return true;
        return this.quietRecallNudgeCandidate?.sourceRefs.some(
            (ref) => normalizePath(ref.path) === normalized,
        ) ?? false;
    }

    private currentActiveNoteSnapshotKey(): string | null {
        const activeFile = this.host.app.workspace.getActiveFile?.();
        if (!activeFile || !activeFile.path.endsWith(".md")) return null;
        const mtime = typeof activeFile.stat?.mtime === "number" ? activeFile.stat.mtime : 0;
        const size = typeof activeFile.stat?.size === "number" ? activeFile.stat.size : 0;
        return `${activeFile.path}:${mtime}:${size}`;
    }

    /** (Re)start the idle timer. When it fires, Pet enters resting. */
    private resetIdleTimer(): void {
        this.clearIdleTimer();
        this.idleTimer = setPlatformTimeout(() => {
            this.idleTimer = null;
            this.petView?.stateMachine.transition("long-idle");
            this.schedulePreparedRecap("idle", 0);
        }, PageletOrchestrator.IDLE_TIMEOUT_MS);
    }

    private clearIdleTimer(): void {
        if (this.idleTimer !== null) {
            clearPlatformTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }

    private clearActivityDebounce(): void {
        if (this.activityDebounceTimer !== null) {
            clearPlatformTimeout(this.activityDebounceTimer);
            this.activityDebounceTimer = null;
        }
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

    /** Show a Notice with background preparation diagnostics. */
    private async showBackgroundPreparationStatusNotice(): Promise<void> {
        const status = this.backgroundPrep.status();
        const reviewLine = status
            ? this.t("pagelet.preload.status.notice", {
                state: this.t(status.running ? "pagelet.preload.status.running" : "pagelet.preload.status.stopped"),
                last: status.lastCycleAt
                    ? new Date(status.lastCycleAt).toLocaleTimeString()
                    : this.t("pagelet.preload.status.never"),
                hourly: status.budgetRemaining.hourly,
                daily: status.budgetRemaining.daily,
                cache: this.t(status.cacheHasResults ? "pagelet.preload.status.cacheYes" : "pagelet.preload.status.cacheNo"),
                findings: status.cachedFindingCount,
            })
            : this.t("pagelet.preload.status.notRunning");
        const recapState = this.preparedRecapIsCurrent()
            ? this.t("pagelet.recap.status.ready")
            : this.lastRecapAttempt
                ? this.t("pagelet.recap.status.notReady")
                : this.t("pagelet.recap.status.never");
        const recapOperationallyEnabled = this.host.settings.pagelet.scopeRecapBackgroundAuthorization !== "declined-v1"
            && this.host.settings.pagelet.scopeRecapPreparationEnabled
            && this.host.isScopeRecapProviderConfigured();
        const recapCost = this.lastRecapAttempt?.cost;
        const recapLine = this.t("pagelet.recap.status.notice", {
            enabled: this.t(recapOperationallyEnabled
                ? "pagelet.preload.status.running"
                : "pagelet.preload.status.stopped"),
            state: recapState,
            included: this.lastRecapAttempt?.includedSourceCount ?? 0,
            tokens: (this.lastRecapAttempt?.cost?.inputTokens ?? 0)
                + (this.lastRecapAttempt?.cost?.outputTokens ?? 0),
            outcome: this.lastRecapAttempt?.outcome ?? this.t("pagelet.status.none"),
            attemptedAt: this.lastRecapAttempt
                ? new Date(this.lastRecapAttempt.attemptedAt).toLocaleTimeString()
                : this.t("pagelet.status.none"),
            scope: this.lastRecapAttempt?.scope.kind ?? this.t("pagelet.status.none"),
            callMade: this.lastRecapAttempt
                ? this.t(this.lastRecapAttempt.providerCallMade ? "pagelet.status.yes" : "pagelet.status.no")
                : this.t("pagelet.status.none"),
            cost: recapCost
                ? recapCost.pricingKnown === false
                    ? this.t("pagelet.status.unknown")
                    : `$${(recapCost.estimatedCost ?? 0).toFixed(6)}`
                : this.t("pagelet.status.none"),
        });
        const recallDiagnostics = this.lastQuietRecallDiagnostics;
        const recallLine = this.t("pagelet.recall.status.notice", {
            round: recallDiagnostics?.roundId.slice(0, 8) ?? this.t("pagelet.status.none"),
            startedAt: recallDiagnostics
                ? new Date(recallDiagnostics.startedAt).toLocaleTimeString()
                : this.t("pagelet.status.none"),
            calls: recallDiagnostics?.totalProviderCalls
                ?? recallDiagnostics?.providerCalls
                ?? 0,
            accepted: this.lastQuietRecallAcceptedCount,
            outcome: recallDiagnostics?.blockedReason ?? this.t("pagelet.status.none"),
            cost: recallDiagnostics
                ? recallDiagnostics.pricingKnown
                    ? `$${recallDiagnostics.estimatedCost.toFixed(6)}`
                    : this.t("pagelet.status.unknown")
                : this.t("pagelet.status.none"),
            hourlyRemaining: recallDiagnostics?.limiterUsage?.hourlyRemaining
                ?? this.t("pagelet.status.none"),
            dailyRemaining: recallDiagnostics?.limiterUsage?.dailyRemaining
                ?? this.t("pagelet.status.none"),
        });
        let limitsLine = this.t("pagelet.featureLimits.status.unavailable");
        if (this.host.getPageletFeatureRateLimitStatus) {
            try {
                const limits = await this.host.getPageletFeatureRateLimitStatus();
                limitsLine = this.t("pagelet.featureLimits.status.notice", {
                    recapHourUsed: limits.scopeRecap.hourlyUsed,
                    recapHourCap: limits.scopeRecap.hourlyCap,
                    recapDayUsed: limits.scopeRecap.dailyUsed,
                    recapDayCap: limits.scopeRecap.dailyCap,
                    recallHourUsed: limits.quietRecall.hourlyUsed,
                    recallHourCap: limits.quietRecall.hourlyCap,
                    recallDayUsed: limits.quietRecall.dailyUsed,
                    recallDayCap: limits.quietRecall.dailyCap,
                });
            } catch (error) {
                this.host.log("Pagelet feature usage status unavailable", error);
            }
        }
        new Notice(`${reviewLine}\n${recapLine}\n${recallLine}\n${limitsLine}`, 12_000);
    }

    // ======================================================================
    // Bubble / Panel callbacks
    // ======================================================================

    private handleNudgePresented(ticket: NudgeTicket): void {
        switch (ticket.owner) {
            case NudgeOwner.PreparedRecap:
                if (this.preparedRecapNudgeFingerprint === ticket.candidate.id) {
                    this.preparedRecapNudgeFingerprint = null;
                }
                this.shownRecapNudgeFingerprints.set(ticket.candidate.id, Date.now());
                this.persistScopeRecapNudgeSuppressions();
                return;
            case NudgeOwner.QuietRecall:
                if (
                    ticket.nudge.onboardingExplanation
                    && !this.host.settings.pagelet.quietRecallExplained
                ) {
                    this.host.updatePageletSetting("quietRecallExplained", true);
                }
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
    private canPrepareQuietRecallBubbleNudge(): boolean {
        return !this.host.settings.focusMode
            && this.host.settings.pagelet.enabled
            && this.host.settings.pagelet.petVisible
            && this.host.settings.quietRecall.enabled
            && this.host.settings.quietRecall.quietRecallMode === "on";
    }

    private quietRecallLeafChangeTimer: ReturnType<typeof setTimeout> | null = null;

    private scheduleQuietRecallAfterLeafChange(delayMs = PageletOrchestrator.QUIET_RECALL_LEAF_CHANGE_DEBOUNCE_MS): void {
        if (this.quietRecallLeafChangeTimer !== null) {
            clearTimeout(this.quietRecallLeafChangeTimer);
        }
        if (delayMs <= 0) {
            this.quietRecallLeafChangeTimer = null;
            if (!this.destroyed && this.canPrepareQuietRecallBubbleNudge()) {
                void this.prepareQuietRecallBubbleNudge();
            }
            return;
        }
        this.quietRecallLeafChangeTimer = setTimeout(() => {
            this.quietRecallLeafChangeTimer = null;
            if (!this.destroyed && this.canPrepareQuietRecallBubbleNudge()) {
                void this.prepareQuietRecallBubbleNudge();
            }
        }, delayMs);
    }

    private clearQuietRecallBubbleNudge(
        options: { preserveDiscoverFallback?: boolean } = {},
    ): void {
        this.quietRecallNudgeCandidate = null;
        this.quietRecallBubbleNudge = null;
        if (!options.preserveDiscoverFallback) {
            this.quietRecallDiscoverFallback = null;
            this.unconvincingRecallCount = 0;
        }
        this.reconcilePetNudge();
    }

    private invalidateQuietRecallBubbleNudge(): void {
        if (this.quietRecallLeafChangeTimer !== null) {
            clearTimeout(this.quietRecallLeafChangeTimer);
            this.quietRecallLeafChangeTimer = null;
        }
        this.quietRecallNudgeRunId += 1;
        this.quietRecallNudgePending = false;
        this.clearQuietRecallBubbleNudge();
    }

    private isQuietRecallCandidateSuppressed(candidateId: string, now = Date.now()): boolean {
        if (this.quietRecallDismissedCandidateIds.has(candidateId)) return true;
        const snoozedUntil = this.quietRecallSnoozedCandidateIds.get(candidateId);
        if (snoozedUntil === undefined) return false;
        if (snoozedUntil > now) return true;
        this.quietRecallSnoozedCandidateIds.delete(candidateId);
        return false;
    }

    private async prepareQuietRecallBubbleNudge(): Promise<void> {
        const runId = ++this.quietRecallNudgeRunId;
        if (this.quietRecallNudgeInFlight) {
            this.quietRecallNudgePending = true;
            return;
        }
        if (!this.canPrepareQuietRecallBubbleNudge()) {
            this.clearQuietRecallBubbleNudge();
            return;
        }
        this.quietRecallNudgeInFlight = true;
        try {
            const recall = await this.host.runQuietRecall();
            this.recordQuietRecallDiagnostics(recall);
            if (runId !== this.quietRecallNudgeRunId || this.destroyed) return;
            if (!this.canPrepareQuietRecallBubbleNudge() || !this.quietRecallRunIsCurrent(recall)) {
                this.clearQuietRecallBubbleNudge();
                return;
            }
            const now = Date.now();
            const candidate = recall.candidates.find((item) => (
                item.evaluationProvenance === "ai"
                && Boolean(item.evaluationFingerprint?.trim())
                && item.score >= QUIET_RECALL_BUBBLE_MIN_SCORE
                && !this.isQuietRecallCandidateSuppressed(item.id, now)
            ));
            const acceptedCandidates = recall.candidates.filter(
                (item) => (
                    item.evaluationProvenance === "ai"
                    && Boolean(item.evaluationFingerprint?.trim())
                ),
            );
            const acceptedIds = new Set(acceptedCandidates.map((item) => item.id));
            const discoverOnlyCandidates = (recall.discoverCandidates ?? recall.candidates)
                .filter((item) => !acceptedIds.has(item.id));
            this.unconvincingRecallCount = discoverOnlyCandidates.length;
            this.quietRecallDiscoverFallback = discoverOnlyCandidates.length > 0
                ? {
                    ...recall,
                    totalCount: discoverOnlyCandidates.length,
                    candidates: discoverOnlyCandidates,
                    discoverCandidates: discoverOnlyCandidates,
                }
                : null;
            if (!candidate) {
                this.clearQuietRecallBubbleNudge({ preserveDiscoverFallback: true });
                return;
            }
            this.quietRecallNudgeCandidate = candidate;
            const showOnboardingExplanation = !this.host.settings.pagelet.quietRecallExplained;
            this.quietRecallBubbleNudge = {
                ...quietRecallCandidateToBubbleNudge(candidate, { currentPath: recall.currentPath }),
                ...(showOnboardingExplanation ? { onboardingExplanation: true } : {}),
            };
            // Quiet Recall owns its quality and per-candidate gates. Reuse only
            // the shared quiet-hours schedule; generic hint cooldown/pending
            // state must not suppress or be consumed by this nudge.
            if (!this.proactiveHints.quietHoursActive) {
                this.reconcilePetNudge();
            }
        } catch (error) {
            if (runId === this.quietRecallNudgeRunId) {
                this.clearQuietRecallBubbleNudge();
            }
            this.host.log("Quiet Recall Bubble nudge skipped", error);
        } finally {
            this.quietRecallNudgeInFlight = false;
            if (this.quietRecallNudgePending && !this.destroyed) {
                this.quietRecallNudgePending = false;
                void this.prepareQuietRecallBubbleNudge();
            }
        }
    }

    private async openQuietRecallDiscoverFallback(): Promise<void> {
        const recall = this.quietRecallDiscoverFallback;
        if (!recall || !this.quietRecallRunIsCurrent(recall)) {
            this.clearQuietRecallBubbleNudge();
            return;
        }
        const activePath = this.host.app.workspace.getActiveFile?.()?.path;
        if (recall.currentPath && activePath !== recall.currentPath) {
            this.clearQuietRecallBubbleNudge();
            return;
        }
        const locale = getPageletUiLanguage();
        await Promise.resolve(this.host.openPageletDetailView({
            title: pageletT("pagelet.tab.recall.title", locale),
            content: [],
            locale,
            layoutType: "current",
            ...(recall.currentPath ? { sourcePath: recall.currentPath } : {}),
            extra: { quietRecall: recall },
            entryReason: "quiet-recall",
        }));
    }

    private quietRecallCandidateForNudge(nudge: QuietRecallBubbleNudge): QuietRecallCandidate | null {
        const candidate = this.quietRecallNudgeCandidate;
        return candidate && candidate.id === nudge.candidateId ? candidate : null;
    }

    private recordQuietRecallDiagnostics(result: QuietRecallRunResult): void {
        this.lastQuietRecallDiagnostics = result.evaluationDiagnostics ?? null;
        this.lastQuietRecallAcceptedCount = result.candidates.filter((candidate) => (
            candidate.evaluationProvenance === "ai"
            && Boolean(candidate.evaluationFingerprint?.trim())
        )).length;
        this.host.updatePageletSetting(
            "quietRecallLastDiagnostics",
            this.lastQuietRecallDiagnostics,
        );
        this.host.updatePageletSetting(
            "quietRecallLastAcceptedCount",
            this.lastQuietRecallAcceptedCount,
        );
    }

    private quietRecallRunIsCurrent(result: QuietRecallRunResult): boolean {
        if (
            result.dataBoundarySnapshotId
            && result.dataBoundarySnapshotId !== this.host.getScopeRecapDataBoundarySnapshotId()
        ) return false;
        return this.host.isQuietRecallRunCurrent?.(result) ?? true;
    }

    private recordQuietRecallFeedback(
        candidate: QuietRecallCandidate | null,
        feedback: RetrievalHabitFeedbackKind,
    ): void {
        if (!candidate) return;
        void this.host.recordQuietRecallFeedback(candidate, feedback).catch((error) => {
            this.host.log("Quiet Recall feedback skipped", error);
        });
    }

    /**
     * F-05 / SG-02: View opens Tab with existing candidates. Does NOT re-run provider.
     */
    private async handleQuietRecallBubbleView(nudge: QuietRecallBubbleNudge): Promise<void> {
        const candidate = this.quietRecallCandidateForNudge(nudge);
        this.bubbleView?.close();
        this.recordQuietRecallFeedback(candidate, "view");

        // Use existing candidates — no additional provider call
        const discoverFallback = this.quietRecallDiscoverFallback;
        const existingCandidates = candidate
            ? [candidate, ...(discoverFallback?.candidates ?? []).filter((c) => c.id !== candidate.id)]
            : discoverFallback?.candidates ?? [];

        const locale = getPageletUiLanguage();
        const recall: QuietRecallRunResult = {
            generatedAt: new Date().toISOString(),
            ...(discoverFallback ?? {}),
            currentPath: nudge.currentPath,
            candidates: existingCandidates,
            totalCount: existingCandidates.length,
        };
        const payload: PageletDetailPayload = {
            title: pageletT("pagelet.tab.recall.title", locale),
            content: [],
            locale,
            layoutType: "current",
            extra: { quietRecall: recall },
            entryReason: "quiet-recall",
        };
        if (recall.currentPath) payload.sourcePath = recall.currentPath;
        this.clearQuietRecallBubbleNudge();
        await Promise.resolve(this.host.openPageletDetailView(payload));
    }

    private async handleQuietRecallBubbleLink(nudge: QuietRecallBubbleNudge): Promise<void> {
        const candidate = this.quietRecallCandidateForNudge(nudge);
        const activeFile = this.host.app.workspace.getActiveFile();
        const currentPath = nudge.currentPath ? normalizePath(nudge.currentPath).replace(/^\.\//, "") : "";
        const candidatePath = quietRecallLinkTargetPath(candidate, currentPath);
        if (
            !currentPath
            || !(activeFile instanceof TFile)
            || activeFile.extension !== "md"
            || activeFile.path !== currentPath
        ) {
            new Notice(pageletT("pagelet.tab.recall.linkNoActiveNote", getPageletUiLanguage()), 4000);
            return;
        }
        if (!candidatePath) {
            new Notice(pageletT("pagelet.tab.recall.linkNoDistinctSource", getPageletUiLanguage()), 4000);
            return;
        }
        const result = await this.host.linkRecallCandidate(currentPath, candidatePath);
        if (result.ok) {
            this.clearQuietRecallBubbleNudge();
            // The shared Link host owns successful acceptance feedback for all
            // entry points; recording here would double-count Bubble actions.
        } else {
            new Notice(result.message, 5000);
        }
        this.bubbleView?.close();
    }

    private handleQuietRecallBubbleDismiss(nudge: QuietRecallBubbleNudge): void {
        const candidate = this.quietRecallCandidateForNudge(nudge);
        this.quietRecallDismissedCandidateIds.add(nudge.candidateId);
        this.clearQuietRecallBubbleNudge();
        this.bubbleView?.close();
        this.recordQuietRecallFeedback(candidate, "dismiss");
    }

    /**
     * F-05 / SG-04: Later = enter Review Queue instead of 24h snooze.
     */
    private async handleQuietRecallBubbleLater(nudge: QuietRecallBubbleNudge): Promise<void> {
        const candidate = this.quietRecallCandidateForNudge(nudge);
        if (!candidate) {
            this.host.log("Quiet Recall Later → Review Queue failed", {
                candidateId: nudge.candidateId,
                reason: "candidate_unavailable",
            });
            new Notice(this.t("pagelet.panel.status.actionFailed"), 4000);
            return;
        }

        try {
            const result = await this.host.createReviewQueueItem(
                quietRecallCandidateToReviewQueueInput(candidate, {
                    admissionReason: "user_kept_for_later",
                }),
            );
            if (!result.ok) {
                this.host.log("Quiet Recall Later → Review Queue failed", {
                    candidateId: candidate.id,
                    reason: result.reason,
                });
                new Notice(this.t("pagelet.panel.status.actionFailed"), 4000);
                return;
            }

            if (this.quietRecallCandidateForNudge(nudge) === candidate) {
                this.clearQuietRecallBubbleNudge();
                this.bubbleView?.close();
            }
            this.recordQuietRecallFeedback(candidate, "later");
        } catch (error) {
            this.host.log("Quiet Recall Later → Review Queue failed", {
                candidateId: candidate.id,
                error,
            });
            new Notice(this.t("pagelet.panel.status.actionFailed"), 4000);
        }
    }

    /** Expand Bubble -> Panel. */
    private handleExpandPanel(type?: string): void {
        const requestedType = type === "writing" ? "current" : type;
        const usePreparedFindings = requestedType === "prepared";
        // An explicit cache miss is informational only. Preflight before
        // closing or mutating any currently visible Bubble/Panel session.
        if (usePreparedFindings && this.preloadCache.getFindings().length === 0) {
            new Notice(this.t("pagelet.preload.status.noCachedFindings"), 4000);
            return;
        }

        this.bubbleView?.close();
        const isKnownLayout = requestedType === "review"
            || requestedType === "current"
            || requestedType === "discover"
            || requestedType === "summary";
        let layoutType: PanelLayoutType = "review";
        if (!usePreparedFindings && isKnownLayout) {
            layoutType = requestedType;
        }
        this.currentPanelLayout = layoutType;
        if (layoutType !== "summary") {
            this.saveFlow.clearPending();
        }
        let panelFindings = usePreparedFindings
            ? []
            : this.sessionManager.currentAnalysisFindings();
        if (panelFindings.length === 0 && (usePreparedFindings || layoutType !== "review")) {
            panelFindings = this.sessionManager.toPanelFindings(this.preloadCache.getFindings());
        }

        this.panelView?.open(
            layoutType,
            panelFindings,
            usePreparedFindings
                ? {
                    preparedReadOnly: true,
                    usedGovernedMemoryClaimIds: this.preloadCache
                        .getUsedGovernedMemoryClaimIds(),
                }
                : this.panelExtraForLayout(layoutType),
        );
    }

    /** Expand Panel -> Tab. */
    private expandPanelToTab(): void {
        if (this.panelView?.currentPanelExtra?.preparedReadOnly) return;
        const layoutType = this.panelView?.currentLayoutType ?? this.currentPanelLayout ?? "review";
        const panelFindings = this.panelView?.currentVisibleFindings ?? [];
        const panelExtra = this.panelView?.currentPanelExtra;
        const summarySaveNote = layoutType === "summary"
            ? this.saveFlow.pending ?? undefined
            : undefined;
        const sourcePath = layoutType === "summary"
            ? summarySaveNote?.targetPath
            : panelExtra?.sourcePath;
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
            const currentFindings = this.sessionManager.currentAnalysisFindings();
            findings = currentFindings.length > 0
                ? currentFindings
                : this.sessionManager.toPanelFindings(this.preloadCache.getFindings());
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
        if (summarySaveNote) {
            payload.summarySaveNote = summarySaveNote;
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

    /** Save Panel findings as review note. */
    private async saveFindingsAsReviewNote(findings: PanelFinding[]): Promise<void> {
        if (this.panelView?.currentPanelExtra?.preparedReadOnly) return;
        await this.saveFlow.saveFindingsAsReviewNote(findings, this.currentPanelLayout);
    }

    private openDiscoveryPanel(findings: PanelFinding[], extra: PanelOpenExtra = {}): void {
        this.currentPanelLayout = "discover";
        this.saveFlow.clearPending();
        this.panelView?.open("discover", findings, this.withContextPagerExtra(extra, "discover"));
    }

    private clearPanelSession(): void {
        if (this.preservePanelSessionOnClose) return;
        if (this.saveFlow.isSaveInProgress) return;
        this.currentPanelLayout = null;
        this.saveFlow.clearPending();
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

function noteTitleFromPath(path: string): string {
    const normalized = path.trim();
    if (!normalized) return "";
    return normalized.split("/").pop()?.replace(/\.md$/i, "") ?? normalized;
}

function contextDropReasonForScopeSkip(reason: PageletScopeSkippedReason | undefined): ContextDropReason {
    switch (reason) {
        case "excluded-folder":
        case "excluded-frontmatter":
        case "excluded-tag":
        case "excluded-pattern":
        case "hidden-folder":
            return "privacy excluded";
        case "overflow":
            return "budget limit";
        case "unchecked":
            return "user excluded";
        case "outside-range":
            return "scope mismatch";
        case "missing-file":
        case "empty-note":
        default:
            return "not relevant";
    }
}

function mergeDiscoveryConnections(
    preferred: readonly NoteConnection[],
    discovered: readonly NoteConnection[],
): NoteConnection[] {
    const merged: NoteConnection[] = [];
    const indexes = new Map<string, number>();
    const add = (connection: NoteConnection): void => {
        const from = normalizePath(connection.fromNote);
        const to = normalizePath(connection.toNote);
        const key = [from, to].sort().join("\0");
        if (!from || !to || from === to) return;
        const existingIndex = indexes.get(key);
        if (existingIndex !== undefined) {
            const existing = merged[existingIndex];
            existing.strength = strongestDiscoveryStrength(existing.strength, connection.strength);
            existing.sharedConcepts = mergeDiscoveryConcepts(existing.sharedConcepts, connection.sharedConcepts);
            return;
        }
        indexes.set(key, merged.length);
        merged.push({
            ...connection,
            fromNote: from,
            toNote: to,
            sharedConcepts: mergeDiscoveryConcepts(connection.sharedConcepts),
        });
    };

    preferred.forEach(add);
    discovered.forEach(add);
    return merged;
}

function mergeDiscoveryConcepts(...conceptGroups: readonly string[][]): string[] {
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const concept of conceptGroups.flat()) {
        const normalized = concept.trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        merged.push(normalized);
    }
    return merged;
}

function strongestDiscoveryStrength(
    first: NoteConnection["strength"],
    second: NoteConnection["strength"],
): NoteConnection["strength"] {
    const ranks: Record<NoteConnection["strength"], number> = {
        weak: 0,
        medium: 1,
        strong: 2,
    };
    return ranks[second] > ranks[first] ? second : first;
}
