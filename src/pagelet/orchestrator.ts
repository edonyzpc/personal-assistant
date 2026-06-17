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

import { Notice } from "obsidian";
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
import type { PanelFinding, PanelLayoutType } from "./panel/types";
import type { PageletCommandCallbacks } from "./commands";
import { ProactiveHints } from "./hints/ProactiveHints";
import type { PetCorner } from "./pet/types";
import { PetView } from "./pet/PetView";
import { PreloadBudget } from "./preload/PreloadBudget";
import { PreloadCache } from "./preload/PreloadCache";
import { ChangeDetector } from "./scope/ChangeDetector";
import { ScopeResolver } from "./scope/ScopeResolver";
import {
    selectPageletScope,
    type PageletReviewRange,
} from "./scope";
import { getPageletOverlayRoot } from "./overlay-root";
import { ResearchManager } from "./research";

import { AnalysisSessionManager } from "./AnalysisSessionManager";
import { BackgroundPreparationCoordinator } from "./BackgroundPreparationCoordinator";
import { BubbleCoordinator } from "./BubbleCoordinator";
import { PeriodicSummaryFlow } from "./PeriodicSummaryFlow";
import { ReviewNoteSaveFlow } from "./ReviewNoteSaveFlow";
import type { PageletHost } from "./PageletHost";

// Re-export so existing `import { PageletHost } from "./orchestrator"` keeps working.
export type { PageletHost } from "./PageletHost";

export class PageletOrchestrator {
    // ---- Components -------------------------------------------------------
    private petView: PetView | null = null;
    private bubbleView: BubbleView | null = null;
    private panelView: PanelView | null = null;
    private currentPanelLayout: PanelLayoutType | null = null;
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
    private destroyed = false;

    // ---- Constants --------------------------------------------------------
    /** 10 minutes of no activity -> Pet enters resting state. */
    private static readonly IDLE_TIMEOUT_MS = 10 * 60 * 1000;
    /** 5 s debounce for note-activity detection (vault modify events). */
    private static readonly ACTIVITY_DEBOUNCE_MS = 5_000;

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
            petTransition: (event) => this.petView?.stateMachine.transition(event),
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
                onPetTransition: (event) => this.petView?.stateMachine.transition(event),
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
        });

        // Delegate: periodic summary flow
        this.periodicSummary = new PeriodicSummaryFlow(host, this.scopeResolver, {
            petTransition: (event) => this.petView?.stateMachine.transition(event),
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
                onRelatedNoteClick: (noteName) => this.handleRelatedNoteClick(noteName),
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
            this.sessionManager.panelExtraForLayout("review"),
        );
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

    /** Show the Bubble via the BubbleCoordinator. */
    private showBubble(): void {
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

        const content = await this.host.app.vault.cachedRead(activeFile);
        const currentNote = { path: activeFile.path, content };
        const noteContents = [{ path: activeFile.path, content }];

        this.petView?.stateMachine.transition("analysis-start");

        try {
            const relatedNotes = await this.host.findRelatedNotes(
                activeFile.path, noteContents, [activeFile.path],
            );

            if (relatedNotes.length === 0) {
                const locale = getPageletUiLanguage();
                this.petView?.stateMachine.transition("analysis-done");
                const isVssReady = this.host.settings.pagelet.enabled;
                const titleKey = isVssReady
                    ? "pagelet.discover.noResults.title"
                    : "pagelet.discover.vssNotReady.title";
                const descKey = isVssReady
                    ? "pagelet.discover.noResults.desc"
                    : "pagelet.discover.vssNotReady.desc";
                this.panelView?.open("discover", [{
                    title: pageletT(titleKey, locale),
                    description: pageletT(descKey, locale),
                    insightText: pageletT(descKey, locale),
                    sourceFile: "",
                    sourceTitle: "",
                }], {});
                return;
            }

            const result = await this.host.discoverConnections(currentNote, relatedNotes);
            this.petView?.stateMachine.transition("analysis-done");

            if (!result) {
                this.handleExpandPanel("discover");
                return;
            }

            const findings: PanelFinding[] = [
                ...result.connections.map((c) => ({
                    title: c.sharedConcepts[0] ?? "",
                    description: c.sharedConcepts.join("; "),
                    insightText: c.sharedConcepts.join("; "),
                    sourceFile: c.fromNote,
                    sourceTitle: c.toNote.split("/").pop()?.replace(/\.md$/, "") ?? c.toNote,
                })),
                ...result.gaps.map((g) => ({
                    title: g.topic,
                    description: g.description,
                    insightText: g.description,
                    sourceFile: activeFile.path,
                    sourceTitle: g.topic,
                })),
            ];

            this.panelView?.open("discover", findings, { connections: result.connections });
        } catch (error) {
            this.petView?.stateMachine.transition("analysis-done");
            this.petView?.flashError();
            this.host.log("Discovery analysis failed", error);
            new Notice(pageletT("pagelet.panel.status.actionFailed", getPageletUiLanguage()), 5000);
        }
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

        this.petView?.stateMachine.transition("analysis-start");

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
                return;
            }

            this.petView?.stateMachine.transition("analysis-done");

            if (options.preferPanel) {
                this.currentPanelLayout = options.panelLayout;
                this.panelView?.open(
                    options.panelLayout,
                    result.findings,
                    this.sessionManager.panelExtraForLayout(options.panelLayout),
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
            this.petView?.stateMachine.transition("analysis-done");
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
        }), 8000);
    }

    // ======================================================================
    // Bubble / Panel callbacks
    // ======================================================================

    /** Expand Bubble -> Panel. */
    private handleExpandPanel(type?: string): void {
        this.bubbleView?.close();
        const requestedType = type === "writing" ? "current" : type;
        const layoutType = (requestedType === "review" || requestedType === "current" || requestedType === "discover" || requestedType === "summary")
            ? requestedType : "review";
        this.currentPanelLayout = layoutType;
        if (layoutType !== "summary") {
            this.saveFlow.clearPending();
        }
        // Use current-note analysis findings only while they still match the
        // active note; otherwise fall back to background preparation cache.
        let panelFindings = this.sessionManager.currentAnalysisFindings();
        if (panelFindings.length === 0 && layoutType !== "review") {
            panelFindings = this.sessionManager.toPanelFindings(this.preloadCache.getFindings());
        }

        this.panelView?.open(layoutType, panelFindings, this.sessionManager.panelExtraForLayout(layoutType));
    }

    /** Expand Panel -> Tab. */
    private expandPanelToTab(): void {
        this.panelView?.close();
        const locale = getPageletUiLanguage();
        const title = pageletT("pagelet.tab.title", locale);
        const currentFindings = this.sessionManager.currentAnalysisFindings();
        const findings = currentFindings.length > 0
            ? currentFindings
            : this.sessionManager.toPanelFindings(this.preloadCache.getFindings());
        void Promise.resolve(this.host.openPageletDetailView({
            title,
            content: findings,
            locale,
        })).catch((error: unknown) => {
            this.host.log("Failed to open Pagelet detail view", error);
            new Notice(this.t("pagelet.panel.status.error"), 4000);
        });
    }

    /** Save Panel findings as review note. */
    private async saveFindingsAsReviewNote(findings: PanelFinding[]): Promise<void> {
        await this.saveFlow.saveFindingsAsReviewNote(findings, this.currentPanelLayout);
    }

    private clearPanelSession(): void {
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

    private handleRelatedNoteClick(noteName: string): void {
        const file = this.findRelatedNote(noteName);
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

    private findRelatedNote(noteName: string): TFile | null {
        const normalized = normalizeRelatedNoteName(noteName);
        if (!normalized) return null;
        const directPath = normalized.endsWith(".md") ? normalized : `${normalized}.md`;
        const direct = this.host.app.vault.getAbstractFileByPath(directPath);
        if (direct && "extension" in direct && direct.extension === "md") return direct as TFile;
        const basename = directPath.replace(/\.md$/i, "").split("/").pop() ?? "";
        if (!basename) return null;
        const resolved = this.host.app.metadataCache.getFirstLinkpathDest(basename, "");
        if (resolved && resolved.extension === "md") return resolved;
        return null;
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

function normalizeRelatedNoteName(noteName: string): string {
    let value = noteName.trim();
    if (value.startsWith("[[") && value.endsWith("]]")) {
        value = value.slice(2, -2);
    }
    const pipe = value.indexOf("|");
    if (pipe >= 0) value = value.slice(0, pipe);
    const heading = value.indexOf("#");
    if (heading >= 0) value = value.slice(0, heading);
    return value.trim();
}
