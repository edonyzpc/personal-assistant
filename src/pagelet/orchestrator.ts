/* Copyright 2023 edonyzpc */

/**
 * Pagelet Orchestrator -- central integration layer.
 *
 * Coordinates Pet, Bubble, Panel, Tab, background preparation,
 * foreground review, and periodic summary. Delegates analysis to
 * {@link AnalysisSessionManager}, note-saving to {@link ReviewNoteSaveFlow},
 * bubble display to {@link BubbleCoordinator}, background prep to
 * {@link BackgroundPreparationCoordinator}, and periodic summary to
 * {@link PeriodicSummaryFlow}.
 */

import { Notice, normalizePath } from "obsidian";
import type { MarkdownView, TFile, WorkspaceLeaf } from "obsidian";

import { getPageletUiLanguage, pageletT } from "../locales/pagelet";
import {
    clearPlatformTimeout,
    getPlatformDocument,
    setPlatformTimeout,
    type PlatformTimeoutHandle,
} from "../platform-dom";
import { isObsidianModalOpen } from "./dom-utils";

import { BubbleView } from "./bubble/BubbleView";
import { PanelView } from "./panel/PanelView";
import type { DiscoveryResult, NoteConnection, PanelFinding, PanelLayoutType, PanelOpenExtra } from "./panel/types";
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
import { BubbleCoordinator } from "./BubbleCoordinator";
import { PeriodicSummaryFlow } from "./PeriodicSummaryFlow";
import { ReviewNoteSaveFlow } from "./ReviewNoteSaveFlow";
import type { PageletHost } from "./PageletHost";
import { resolveRelatedMarkdownNote } from "./related-note";
import type { PageletDetailPayload } from "./tab/types";
import {
    createContextPagerStateFromRetrievalOutcome,
    quietRecallCandidateToBubbleNudge,
    reviewQueueItemHasUserIntentOrDurableConsequence,
    buildScopeRecapMarkdown,
    toReplaySourceRef,
    type ContextDropReason,
    type PersistedSourceRef,
    type QuietRecallBubbleNudge,
    type QuietRecallCandidate,
    type RetrievalHabitFeedbackKind,
    type RetrievalOutcome,
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
    private readonly periodicSummary: PeriodicSummaryFlow;
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
    private quietRecallNudgeRunId = 0;
    private readonly quietRecallDismissedCandidateIds = new Set<string>();
    private readonly quietRecallSnoozedCandidateIds = new Map<string, number>();
    private foregroundRouteToken = 0;
    private destroyed = false;

    // ---- Constants --------------------------------------------------------
    /** 60 s ceiling for any single foreground LLM call. */
    private static readonly FOREGROUND_TIMEOUT_MS = 60_000;
    /** 10 minutes of no activity -> Pet enters resting state. */
    private static readonly IDLE_TIMEOUT_MS = 10 * 60 * 1000;
    /** 5 s debounce for note-activity detection (vault modify events). */
    private static readonly ACTIVITY_DEBOUNCE_MS = 5_000;
    /** Local UI snooze for the same Quiet Recall Bubble candidate. */
    private static readonly QUIET_RECALL_LATER_SNOOZE_MS = 24 * 60 * 60 * 1000;

    constructor(private readonly host: PageletHost) {
        const s = host.settings.pagelet;

        // Scope infrastructure
        this.preloadCache = new PreloadCache();
        this.preloadBudget = new PreloadBudget(
            s.preloadPerHourCap,
            s.preloadPerDayCap,
        );
        const foregroundBudget = new PreloadBudget(
            s.foregroundPerHourCap,
            s.foregroundPerDayCap,
        );
        this.changeDetector = new ChangeDetector();
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
                onInsightsReady: () => this.proactiveHints.onInsightsReady(),
            },
        );

        // Delegate: bubble coordinator (after proactiveHints)
        this.bubbleCoordinator = new BubbleCoordinator(host, this.preloadCache, this.proactiveHints, {
            onExpandPanel: (type) => this.handleExpandPanel(type),
            onSourceClick: (link) => this.handleSourceClick(link),
            onDismiss: () => this.handleBubbleDismiss(),
            onReviewCurrentNote: () => { void this.reviewCurrentNote(); },
            onDiscoverConnections: () => { void this.discoverConnections(); },
            onPeriodicSummary: () => { void this.runPeriodicSummary(); },
            getQuietRecallNudge: () => this.quietRecallBubbleNudge,
            onQuietRecallView: (candidate) => { void this.handleQuietRecallBubbleView(candidate); },
            onQuietRecallDismiss: (candidate) => { void this.handleQuietRecallBubbleDismiss(candidate); },
            onQuietRecallLater: (candidate) => { void this.handleQuietRecallBubbleLater(candidate); },
        });

        // Delegate: periodic summary flow
        this.periodicSummary = new PeriodicSummaryFlow(host, this.scopeResolver, {
            petTransition: (event) => this.transitionPet(event, "summary"),
            petFlashError: () => this.petView?.flashError(),
            beginForegroundReviewRun: () => this.sessionManager.beginForegroundReviewRun(),
            finishForegroundReviewRun: () => this.sessionManager.finishForegroundReviewRun(),
            setPendingNote: (note) => this.saveFlow.setPending(note),
            openSummaryPanel: (findings, extra) => {
                this.currentPanelLayout = "summary";
                this.panelView?.open("summary", findings, extra);
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
            if (this.panelView?.isOpen) {
                this.panelView.close();
                e.stopPropagation();
                return;
            }
        };
    }

    private t(key: string, params?: Readonly<Record<string, string | number>>): string {
        return pageletT(key, getPageletUiLanguage(), params);
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
            callbacks: {
                onExpandPanel: (type) => this.handleExpandPanel(type),
                onSourceClick: (link) => this.handleSourceClick(link),
                onDismiss: () => this.handleBubbleDismiss(),
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

        // 2. Workspace event: re-mount Pet when the active leaf changes
        this.host.registerEvent(
            this.host.app.workspace.on("active-leaf-change", (leaf) => {
                this.handleLeafChange(leaf);
            }),
        );

        // 3. Vault events: markdown-only activity tracking + scope invalidation
        this.host.registerEvent(
            this.host.app.vault.on("modify", (file) => {
                if (file.path.endsWith(".md")) {
                    this.sessionManager.invalidateScopePlan();
                    this.handleNoteActivity();
                }
            }),
        );
        this.host.registerEvent(
            this.host.app.vault.on("create", (file) => {
                if (file.path.endsWith(".md")) this.sessionManager.invalidateScopePlan();
            }),
        );
        this.host.registerEvent(
            this.host.app.vault.on("delete", (file) => {
                if (file.path.endsWith(".md")) this.sessionManager.invalidateScopePlan();
            }),
        );
        this.host.registerEvent(
            this.host.app.vault.on("rename", (file, oldPath) => {
                if (file.path.endsWith(".md") || oldPath.endsWith(".md")) {
                    this.sessionManager.invalidateScopePlan();
                }
            }),
        );

        // 4. Start background preparation engine (if enabled)
        if (s.preloadEnabled) {
            this.backgroundPrep.start();
        }

        // 5. Mount Pet on whatever leaf is currently active
        const activeLeaf = this.host.app.workspace.getMostRecentLeaf();
        if (activeLeaf) {
            this.handleLeafChange(activeLeaf);
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
        this.escapeListenerDocument?.removeEventListener("keydown", this.handleEscape, true);
        this.escapeListenerDocument = null;
        this.backgroundPrep.destroy();
        this.petView?.destroy();
        this.bubbleView?.destroy();
        this.panelView?.destroy();
        this.preloadCache.clear();
        this.changeDetector.clear();

        this.petView = null;
        this.bubbleView = null;
        this.panelView = null;
    }

    /** Apply latest settings to all runtime collaborators. */
    syncSettings(): void {
        if (this.destroyed) return;
        const s = this.host.settings.pagelet;

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
        if (!this.canPrepareQuietRecallBubbleNudge()) {
            this.clearQuietRecallBubbleNudge();
        }
        if (this.petView) {
            this.petView.stateMachine.proactiveHintsEnabled = s.proactiveHints;
            this.petView.setCorner(s.petCorner);
        }
        this.syncPetVisibility();

        this.backgroundPrep.syncConfig();
    }

    // ======================================================================
    // Command callbacks
    // ======================================================================

    getCommandCallbacks(): PageletCommandCallbacks {
        return {
            onOpenPanel: () => this.openPanel(),
            onReviewCurrent: () => this.reviewCurrentNote(),
            onQuickReview: () => this.openQuickReview(),
            onDiscoverConnections: async () => {
                await this.discoverConnections();
            },
            onPeriodicSummary: () => {
                void this.runPeriodicSummary();
            },
            onMaintenanceReview: () => this.runMaintenanceReview(),
            onWeeklyReview: () => this.runWeeklyReview(),
            onQuietRecall: () => this.runQuietRecall(),
            onGraphDiscovery: () => this.runGraphDiscovery(),
            onScopeRecap: () => this.runScopeRecap(),
            onToggleProactiveHints: () => this.toggleProactiveHints(),
            onShowBackgroundPreparationStatus: () => {
                this.showBackgroundPreparationStatusNotice();
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

    openQuickReview(): void {
        if (this.petView?.rootEl && this.bubbleView) {
            this.showBubble();
            return;
        }
        this.openPanel();
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
        }
    }

    async runWeeklyReview(): Promise<void> {
        const routeToken = this.beginForegroundRoute("review", "review");
        if (routeToken === null) return;
        try {
            const weeklyReview = await this.withForegroundTimeout(this.host.runWeeklyReview());
            if (!this.isCurrentForegroundRoute(routeToken)) return;
            this.transitionPet("analysis-done");
            const locale = getPageletUiLanguage();
            const extra = this.withGlobalLedgerExtra(
                this.withGlobalReviewQueueExtra({ weeklyReview }),
            );
            const payload: PageletDetailPayload = {
                title: pageletT("pagelet.tab.weekly.title", locale),
                content: [],
                locale,
                layoutType: "review",
            };
            const detailExtra = this.detailExtraForTab(extra);
            if (detailExtra) payload.extra = detailExtra;
            await Promise.resolve(this.host.openPageletDetailView(payload));
        } catch (error) {
            if (!this.isCurrentForegroundRoute(routeToken)) return;
            this.transitionPet("analysis-done");
            this.petView?.flashError();
            this.host.log("Pagelet weekly review failed", error);
            new Notice(this.t("pagelet.panel.status.error"), 4000);
        }
    }

    async runQuietRecall(): Promise<void> {
        const routeToken = this.beginForegroundRoute("current", "review");
        if (routeToken === null) return;
        try {
            const quietRecall = await this.withForegroundTimeout(this.host.runQuietRecall());
            if (!this.isCurrentForegroundRoute(routeToken)) return;
            this.transitionPet("analysis-done");
            const locale = getPageletUiLanguage();
            const payload: PageletDetailPayload = {
                title: pageletT("pagelet.tab.recall.title", locale),
                content: [],
                locale,
                layoutType: "current",
                extra: { quietRecall },
            };
            if (quietRecall.currentPath) payload.sourcePath = quietRecall.currentPath;
            await Promise.resolve(this.host.openPageletDetailView(payload));
        } catch (error) {
            if (!this.isCurrentForegroundRoute(routeToken)) return;
            this.transitionPet("analysis-done");
            this.petView?.flashError();
            this.host.log("Pagelet quiet recall failed", error);
            new Notice(this.t("pagelet.panel.status.error"), 4000);
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
        }
    }

    async runScopeRecap(): Promise<void> {
        const routeToken = this.beginForegroundRoute("summary", "review");
        if (routeToken === null) return;
        try {
            const recap = await this.withForegroundTimeout(this.host.runScopeRecap());
            if (!this.isCurrentForegroundRoute(routeToken)) return;
            this.transitionPet("analysis-done");
            const markdown = buildScopeRecapMarkdown(recap, [recap.summary.id]);
            const locale = getPageletUiLanguage();
            const payload: PageletDetailPayload = {
                title: pageletT("pagelet.tab.scopeRecap.title", locale),
                content: [],
                locale,
                layoutType: "summary",
                extra: { markdown },
                sourcePath: recap.scope.paths?.[0],
            };
            await Promise.resolve(this.host.openPageletDetailView(payload));
        } catch (error) {
            if (!this.isCurrentForegroundRoute(routeToken)) return;
            this.transitionPet("analysis-done");
            this.petView?.flashError();
            this.host.log("Pagelet scope recap failed", error);
            new Notice(this.t("pagelet.panel.status.error"), 4000);
        }
    }

    private setPetTaskKind(taskKind: PetTaskKind): void {
        this.petView?.setTaskKind?.(taskKind);
    }

    private beginForegroundRoute(layout: "summary" | "discover" | "current" | "review", taskKind: PetTaskKind): number | null {
        if (!this.sessionManager.reserveForegroundCall()) return null;
        const routeToken = ++this.foregroundRouteToken;
        this.currentPanelLayout = layout;
        this.saveFlow.clearPending();
        this.transitionPet("analysis-start", taskKind);
        return routeToken;
    }

    private isCurrentForegroundRoute(routeToken: number): boolean {
        return !this.destroyed && routeToken === this.foregroundRouteToken;
    }

    private withForegroundTimeout<T>(promise: Promise<T>): Promise<T> {
        let timer: ReturnType<typeof setTimeout>;
        return Promise.race([
            promise.finally(() => clearTimeout(timer)),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error("Foreground LLM call timed out")),
                    PageletOrchestrator.FOREGROUND_TIMEOUT_MS);
            }),
        ]);
    }

    private transitionPet(event: "analysis-start" | "analysis-done" | "insights-ready", taskKind?: PetTaskKind): void {
        if (event === "analysis-start" && taskKind) {
            this.setPetTaskKind(taskKind);
        }
        this.petView?.stateMachine.transition(event);
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
                },
            });
            // Sync proactive-hints flag into state machine
            this.petView.stateMachine.proactiveHintsEnabled =
                this.host.settings.pagelet.proactiveHints;
        }

        this.petView.mount(containerEl);
    }

    /** Handle a click/tap on the Pet element. */
    private handlePetClick(): void {
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
        ++this.foregroundRouteToken;

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
        const expectedActivePath = activeFile.path;
        if (!this.sessionManager.beginForegroundReviewRun()) return;
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
            const currentNote = { path: activeFile.path, content };
            const noteContents = [{ path: activeFile.path, content }];

            const explicitRelatedNotes = await this.findExplicitLinkedNotes(activeFile, [activeFile.path]);
            const relatedNotes = [
                ...explicitRelatedNotes,
                ...await this.host.findRelatedNotes(
                    activeFile.path,
                    noteContents,
                    [activeFile.path, ...explicitRelatedNotes.map((note) => note.path)],
                ),
            ];

            const explicitConnections = this.buildExplicitLinkConnections(activeFile.path, explicitRelatedNotes);

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

            let result: DiscoveryResult | null = null;
            try {
                result = await this.host.discoverConnections(currentNote, relatedNotes);
            } catch (error) {
                if (explicitConnections.length === 0) throw error;
                finishPet();
                if (!this.activePathStillMatches(expectedActivePath, routeToken)) return;
                this.host.log("Discovery AI analysis failed; showing explicit wikilinks", error);
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
        if (!this.sessionManager.beginForegroundReviewRun()) return;

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
            new Notice(message || this.t("pagelet.panel.status.actionFailed"), 5000);
        } finally {
            this.sessionManager.finishForegroundReviewRun();
        }
    }

    private async runPeriodicSummary(): Promise<void> {
        await this.periodicSummary.run();
    }

    private syncPetVisibility(): void {
        if (!this.host.settings.pagelet.petVisible) {
            this.petView?.destroy();
            this.petView = null;
            this.bubbleView?.close();
            return;
        }

        const activeLeaf = this.host.app.workspace.getMostRecentLeaf();
        if (activeLeaf) {
            this.handleLeafChange(activeLeaf);
        }
    }

    // ======================================================================
    // Idle timer + note activity
    // ======================================================================

    /** Debounced note-activity handler. */
    private handleNoteActivity(): void {
        this.clearActivityDebounce();
        this.activityDebounceTimer = setPlatformTimeout(() => {
            this.activityDebounceTimer = null;
            this.petView?.stateMachine.transition("note-activity");
            this.backgroundPrep.noteActivity();
            void this.prepareQuietRecallBubbleNudge();
            this.resetIdleTimer();
        }, PageletOrchestrator.ACTIVITY_DEBOUNCE_MS);
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
        if (this.petView) {
            this.petView.stateMachine.proactiveHintsEnabled = newState;
        }
        this.host.updatePageletSetting("proactiveHints", newState);
    }

    /** Toggle Pet visibility (persisted). */
    private togglePetVisibility(): void {
        if (this.host.settings.pagelet.petVisible) {
            this.petView?.destroy();
            this.petView = null;
            this.bubbleView?.close();
            this.host.updatePageletSetting("petVisible", false);
        } else {
            this.host.updatePageletSetting("petVisible", true);
            const activeLeaf = this.host.app.workspace.getMostRecentLeaf();
            if (activeLeaf) {
                this.handleLeafChange(activeLeaf);
            }
        }
    }

    /** Show a Notice with background preparation diagnostics. */
    private showBackgroundPreparationStatusNotice(): void {
        const status = this.backgroundPrep.status();
        if (!status) {
            new Notice(this.t("pagelet.preload.status.notRunning"), 4000);
            return;
        }
        const lastTime = status.lastCycleAt
            ? new Date(status.lastCycleAt).toLocaleTimeString()
            : this.t("pagelet.preload.status.never");
        new Notice(this.t("pagelet.preload.status.notice", {
            state: this.t(status.running ? "pagelet.preload.status.running" : "pagelet.preload.status.stopped"),
            last: lastTime,
            hourly: status.budgetRemaining.hourly,
            daily: status.budgetRemaining.daily,
            cache: this.t(status.cacheHasResults ? "pagelet.preload.status.cacheYes" : "pagelet.preload.status.cacheNo"),
            findings: status.cachedFindingCount,
        }), 8000);
    }

    // ======================================================================
    // Bubble / Panel callbacks
    // ======================================================================

    private canPrepareQuietRecallBubbleNudge(): boolean {
        return this.host.settings.pagelet.enabled
            && this.host.settings.pagelet.petVisible
            && this.host.settings.pagelet.proactiveHints
            && this.host.settings.quietRecall.enabled
            && this.host.settings.quietRecall.bubbleNudgesEnabled;
    }

    private clearQuietRecallBubbleNudge(): void {
        this.quietRecallNudgeCandidate = null;
        this.quietRecallBubbleNudge = null;
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
        if (!this.canPrepareQuietRecallBubbleNudge()) {
            this.clearQuietRecallBubbleNudge();
            return;
        }
        const runId = ++this.quietRecallNudgeRunId;
        try {
            const recall = await this.host.runQuietRecall();
            if (runId !== this.quietRecallNudgeRunId || this.destroyed) return;
            const now = Date.now();
            const candidate = recall.candidates.find((item) => !this.isQuietRecallCandidateSuppressed(item.id, now));
            if (!candidate) {
                this.clearQuietRecallBubbleNudge();
                return;
            }
            this.quietRecallNudgeCandidate = candidate;
            this.quietRecallBubbleNudge = quietRecallCandidateToBubbleNudge(candidate);
            if (this.proactiveHints.onInsightsReady()) {
                this.petView?.stateMachine.forceState("nudge");
            }
        } catch (error) {
            if (runId === this.quietRecallNudgeRunId) {
                this.clearQuietRecallBubbleNudge();
            }
            this.host.log("Quiet Recall Bubble nudge skipped", error);
        }
    }

    private quietRecallCandidateForNudge(nudge: QuietRecallBubbleNudge): QuietRecallCandidate | null {
        const candidate = this.quietRecallNudgeCandidate;
        return candidate && candidate.id === nudge.candidateId ? candidate : null;
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

    private async handleQuietRecallBubbleView(nudge: QuietRecallBubbleNudge): Promise<void> {
        const candidate = this.quietRecallCandidateForNudge(nudge);
        this.clearQuietRecallBubbleNudge();
        this.bubbleView?.close();
        this.recordQuietRecallFeedback(candidate, "view");
        await this.runQuietRecall();
    }

    private handleQuietRecallBubbleDismiss(nudge: QuietRecallBubbleNudge): void {
        const candidate = this.quietRecallCandidateForNudge(nudge);
        this.quietRecallDismissedCandidateIds.add(nudge.candidateId);
        this.clearQuietRecallBubbleNudge();
        this.bubbleView?.close();
        this.recordQuietRecallFeedback(candidate, "dismiss");
    }

    private handleQuietRecallBubbleLater(nudge: QuietRecallBubbleNudge): void {
        const candidate = this.quietRecallCandidateForNudge(nudge);
        this.quietRecallSnoozedCandidateIds.set(
            nudge.candidateId,
            Date.now() + PageletOrchestrator.QUIET_RECALL_LATER_SNOOZE_MS,
        );
        this.clearQuietRecallBubbleNudge();
        this.bubbleView?.close();
        this.recordQuietRecallFeedback(candidate, "later");
    }

    /** Expand Bubble -> Panel. */
    private handleExpandPanel(type?: string): void {
        this.bubbleView?.close();
        const requestedType = type === "writing" ? "current" : type;
        const usePreparedFindings = requestedType === "prepared";
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
        // Prepared findings come from the background cache and may not belong
        // to the active note. Keep them in the generic review layout rather
        // than presenting them as current-note analysis.
        if (usePreparedFindings && this.preloadCache.getFindings().length === 0) {
            new Notice(this.t("pagelet.preload.status.noCachedFindings"), 4000);
            return;
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
            usePreparedFindings ? undefined : this.panelExtraForLayout(layoutType),
        );
    }

    /** Expand Panel -> Tab. */
    private expandPanelToTab(): void {
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
            || Boolean(tabExtra?.reviewQueue && tabExtra.reviewQueue.items.length > 0)
            || Boolean(tabExtra?.contextPager)
            || Boolean(tabExtra?.savedInsights && tabExtra.savedInsights.items.length > 0)
            || Boolean(tabExtra?.memoryGovernance && tabExtra.memoryGovernance.records.length > 0)
            || Boolean(tabExtra?.maintenanceReview)
            || Boolean(tabExtra?.graphDiscovery)
            || Boolean(tabExtra?.weeklyReview)
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
        const memories = this.host.listConfirmedMemories();
        if (savedInsights.length === 0 && memories.length === 0) return extra;
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
                    records: memories,
                    totalCount: memories.length,
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
        if (extra.reviewQueue) {
            detailExtra.reviewQueue = extra.reviewQueue;
        }
        if (extra.contextPager) {
            detailExtra.contextPager = extra.contextPager;
        }
        if (extra.savedInsights) {
            detailExtra.savedInsights = extra.savedInsights;
        }
        if (extra.memoryGovernance) {
            detailExtra.memoryGovernance = extra.memoryGovernance;
        }
        if (extra.maintenanceReview) {
            detailExtra.maintenanceReview = extra.maintenanceReview;
        }
        if (extra.graphDiscovery) {
            detailExtra.graphDiscovery = extra.graphDiscovery;
        }
        if (extra.weeklyReview) {
            detailExtra.weeklyReview = extra.weeklyReview;
        }
        if (extra.quietRecall) {
            detailExtra.quietRecall = extra.quietRecall;
        }
        return detailExtra.connections || detailExtra.markdown !== undefined || detailExtra.reviewQueue || detailExtra.contextPager || detailExtra.savedInsights || detailExtra.memoryGovernance || detailExtra.maintenanceReview || detailExtra.graphDiscovery || detailExtra.weeklyReview || detailExtra.quietRecall
            ? detailExtra
            : undefined;
    }

    /** Save Panel findings as review note. */
    private async saveFindingsAsReviewNote(findings: PanelFinding[]): Promise<void> {
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
