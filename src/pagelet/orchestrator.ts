/* Copyright 2023 edonyzpc */

/**
 * Pagelet Orchestrator -- central integration layer.
 *
 * Connects Pet, Bubble, Preload, Hints, and Commands into a working
 * feature lifecycle. The orchestrator does NOT make LLM calls directly;
 * it delegates analysis to the PreloadEngine via an injected
 * AnalyzeCallback from the host.
 *
 * Communication with the plugin is mediated through the narrow
 * {@link PageletHost} interface, keeping the dependency inverted
 * (orchestrator -> host abstraction, not -> concrete plugin).
 *
 * Coordinates Pet, Bubble, Panel, Tab, background preparation,
 * foreground review, and periodic summary.
 */

import { Notice } from "obsidian";
import type { App, EventRef, MarkdownView, TFile, WorkspaceLeaf } from "obsidian";

import { getPageletUiLanguage, pageletT } from "../locales/pagelet";
import {
    clearPlatformTimeout,
    eventPathContainsSelector,
    getOptionalPlatformDocument,
    getPlatformDocument,
    setPlatformTimeout,
    type PlatformTimeoutHandle,
} from "../platform-dom";

import type { BubbleContent, BubbleFinding } from "./bubble/types";
import { BubbleView } from "./bubble/BubbleView";
import { buildEmptyContent, buildNudgeContent, buildQuickReviewContent, buildWritingAssistContent } from "./bubble/BubbleContent";
import { PanelView } from "./panel/PanelView";
import type { PanelFinding, PanelLayoutType, PanelOpenExtra, PanelScopeState } from "./panel/types";
import type { PageletCommandCallbacks } from "./commands";
import { ProactiveHints } from "./hints/ProactiveHints";
import type { PetCorner } from "./pet/types";
import { PetView } from "./pet/PetView";
import { PreloadBudget } from "./preload/PreloadBudget";
import { PreloadCache } from "./preload/PreloadCache";
import { PreloadEngine } from "./preload/PreloadEngine";
import type { AnalyzeCallback, PreloadEvent, PreloadFinding } from "./preload/types";
import { ReviewNoteGenerator } from "./output/ReviewNoteGenerator";
import type { GenerateCallback, GeneratedReviewNote } from "./output/types";
import type { WriteResult } from "./output/types";
import {
    assembleReviewNote,
    buildReviewMetadata,
    formatPageletDate,
    formatPageletIsoTimestamp,
} from "./pa-review-file-io";
import { PAGELET_SCHEMA_VERSION, type PageletReviewResult } from "./pa-review-schemas";
import { ChangeDetector } from "./scope/ChangeDetector";
import { ScopeResolver } from "./scope/ScopeResolver";
import {
    applyPageletScopeToggle,
    buildPageletScopePlan,
    selectPageletScope,
    type PageletReviewRange,
    type PageletScopePlan,
} from "./scope";
import { getPageletOverlayRoot } from "./overlay-root";
import { ResearchManager } from "./research";
import type { PageletDetailPayload } from "./tab/types";

// ---------------------------------------------------------------------------
// Host interface
// ---------------------------------------------------------------------------

/**
 * Narrow host interface -- what the Pagelet orchestrator needs from the plugin.
 *
 * Deliberately thin: only the settings and methods the orchestrator
 * actually reads. Everything else stays behind the plugin boundary.
 */
export interface PageletHost {
    readonly app: App;

    readonly settings: {
        pagelet: {
            enabled: boolean;
            petVisible: boolean;
            petCorner: PetCorner;
            proactiveHints: boolean;
            proactiveHintsCooldown: number;
            proactiveHintsQuietHours: {
                enabled: boolean;
                start: string;
                end: string;
            };
            preloadEnabled: boolean;
            preloadInterval: number;
            preloadPerHourCap: number;
            preloadPerDayCap: number;
            preloadTokenBudget: { input: number; output: number };
            outputLanguage: "auto" | "zh" | "en";
            temperature: number;
            foregroundPerHourCap: number;
            foregroundPerDayCap: number;
            maxInputTokens: number;
            maxOutputTokens: number;
            reviewsFolder: string;
            periodicSummaryScope: "3d" | "7d" | "14d";
            excludedFolders: string[];
            excludedTags: string[];
            excludedPatterns: string[];
        };
    };

    /** Structured debug log (no-op when debug is false). */
    log(message: string, ...args: unknown[]): void;

    /**
     * Register an Obsidian EventRef so the plugin can detach it on unload.
     * Delegates to `Plugin.registerEvent`.
     */
    registerEvent(ref: EventRef): void;

    /**
     * Factory for the LLM callback used by PreloadEngine.
     * The host MUST enforce `allowWrite=false` on the returned callback.
     */
    createPreloadAnalyzeCallback(): AnalyzeCallback;

    /** Factory for the LLM callback used by foreground review commands. */
    createForegroundAnalyzeCallback(): AnalyzeCallback;

    /** Factory for the LLM callback used by ReviewNoteGenerator. */
    createGenerateCallback(): GenerateCallback;

    /** Write a review note through the Pagelet write framework. */
    writeReviewNote(note: GeneratedReviewNote): Promise<WriteResult>;

    /** Persist current settings to disk. */
    saveSettings(): Promise<void> | void;

    /** Open Pagelet detail results in a native Obsidian workspace leaf. */
    openPageletDetailView(payload: PageletDetailPayload): Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class PageletOrchestrator {
    // ---- Components -------------------------------------------------------
    private petView: PetView | null = null;
    private bubbleView: BubbleView | null = null;
    private panelView: PanelView | null = null;
    private preloadEngine: PreloadEngine | null = null;
    private preloadUnsubscribe: (() => void) | null = null;
    private lastAnalysisFindings: PanelFinding[] = [];
    private lastAnalysisSourcePath: string | null = null;
    private currentScopeRange: PageletReviewRange = "current";
    private currentScopePlan: PageletScopePlan | null = null;
    private pendingReviewNote: GeneratedReviewNote | null = null;
    private currentPanelLayout: PanelLayoutType | null = null;
    private readonly handleEscape: (e: KeyboardEvent) => void;
    private readonly preloadCache: PreloadCache;
    private readonly preloadBudget: PreloadBudget;
    private readonly foregroundBudget: PreloadBudget;
    private foregroundRunInProgress = false;
    private readonly changeDetector: ChangeDetector;
    private readonly scopeResolver: ScopeResolver;
    private readonly proactiveHints: ProactiveHints;
    private readonly researchManager: ResearchManager;
    private saveInProgress = false;
    private foregroundRunSeq = 0;
    private escapeListenerDocument: Document | null = null;

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
        this.foregroundBudget = new PreloadBudget(
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

        // Proactive hints
        this.proactiveHints = new ProactiveHints({
            enabled: s.proactiveHints,
            cooldownMinutes: s.proactiveHintsCooldown,
            quietHours: s.proactiveHintsQuietHours,
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
            if (this.saveInProgress || isObsidianModalOpen(e)) return;
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

        // 1. Resolve a single overlay mount root for Bubble/Panel/Tab.
        //    Mounting under workspace.containerEl (instead of the page body)
        //    ensures these fixed overlays never overlap
        //    Obsidian's titlebar drag region. Combined with each view's
        //    lazy mount/unmount, the workspace stays free of long-lived
        //    fixed overlays while idle (D037 progressive disclosure).
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
            locale: getPageletUiLanguage(),
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
                onScopeRangeChange: (range) => this.handleScopeRangeChange(range),
                onScopeCandidateToggle: (path, included) => this.handleScopeCandidateToggle(path, included),
                onRelatedNoteClick: (noteName) => this.handleRelatedNoteClick(noteName),
                onResearchFinding: (finding) => this.handleResearchFinding(finding),
                onToggleHints: () => this.toggleProactiveHints(),
            },
        });
        this.panelView.mount(overlayRoot);

        // 1c. Centralized Escape handler (Panel > Bubble priority).
        // Native Pagelet detail leaves are closed by Obsidian's tab chrome.
        this.escapeListenerDocument = getPlatformDocument();
        this.escapeListenerDocument.addEventListener("keydown", this.handleEscape, true);

        // 2. Workspace event: re-mount Pet when the active leaf changes
        this.host.registerEvent(
            this.host.app.workspace.on("active-leaf-change", (leaf) => {
                this.handleLeafChange(leaf);
            }),
        );

        // 3. Vault event: detect note modifications for idle/activity tracking
        //    Filter to markdown files only (Perf: vault.on("modify") fires for ALL file types)
        this.host.registerEvent(
            this.host.app.vault.on("modify", (file) => {
                if (file.path.endsWith(".md")) {
                    this.invalidateScopePlan();
                    this.handleNoteActivity();
                }
            }),
        );
        this.host.registerEvent(
            this.host.app.vault.on("create", (file) => {
                if (file.path.endsWith(".md")) this.invalidateScopePlan();
            }),
        );
        this.host.registerEvent(
            this.host.app.vault.on("delete", (file) => {
                if (file.path.endsWith(".md")) this.invalidateScopePlan();
            }),
        );
        this.host.registerEvent(
            this.host.app.vault.on("rename", (file, oldPath) => {
                if (file.path.endsWith(".md") || oldPath.endsWith(".md")) {
                    this.invalidateScopePlan();
                }
            }),
        );

        // 4. Start background preparation engine (if enabled)
        if (s.preloadEnabled) {
            this.startPreloadEngine();
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
        this.preloadUnsubscribe?.();
        this.preloadUnsubscribe = null;
        this.preloadEngine?.destroy();
        this.petView?.destroy();
        this.bubbleView?.destroy();
        this.panelView?.destroy();
        this.preloadCache.clear();
        this.changeDetector.clear();

        this.preloadEngine = null;
        this.petView = null;
        this.bubbleView = null;
        this.panelView = null;
    }

    /**
     * Apply the latest Pagelet settings to long-lived runtime collaborators.
     * Called after settings saves so background preparation and exclusion rules
     * take effect without requiring a plugin reload.
     */
    syncSettings(): void {
        if (this.destroyed) return;
        const s = this.host.settings.pagelet;

        this.preloadBudget.updateLimits(s.preloadPerHourCap, s.preloadPerDayCap);
        this.foregroundBudget.updateLimits(s.foregroundPerHourCap, s.foregroundPerDayCap);
        this.scopeResolver.updateConfig({
            excludedFolders: [...s.excludedFolders],
            excludedTags: [...s.excludedTags],
            excludedPatterns: [...s.excludedPatterns],
            maxFileSizeBytes: 100 * 1024,
            reviewsFolder: s.reviewsFolder,
        });
        this.invalidateScopePlan();
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

        if (!s.preloadEnabled) {
            this.preloadEngine?.updateConfig(this.buildPreloadConfig());
            return;
        }
        if (!this.preloadEngine) {
            this.startPreloadEngine();
            return;
        }
        this.preloadEngine.updateConfig(this.buildPreloadConfig());
    }

    // ======================================================================
    // Command callbacks -- returned to the command registrar
    // ======================================================================

    /**
     * Build the callback object expected by
     * `registerPageletCommands(host, callbacks, locale)`.
     */
    getCommandCallbacks(): PageletCommandCallbacks {
        return {
            onOpenPanel: () => this.openPanel(),
            onReviewCurrent: () => this.reviewCurrentNote(),
            onQuickReview: () => this.openQuickReview(),
            onDiscoverConnections: async () => {
                await this.analyzeCurrentNote();
                this.handleExpandPanel("discover");
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
        const plan = this.ensureScopePlan();
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

    private handleScopeRangeChange(range: PageletReviewRange): void {
        this.currentScopeRange = range;
        this.currentScopePlan = this.buildScopePlan(range);
        this.clearAnalysisSession();
        this.refreshReviewPanel();
    }

    private handleScopeCandidateToggle(path: string, included: boolean): void {
        const plan = this.ensureScopePlan();
        if (!plan) return;
        this.currentScopePlan = applyPageletScopeToggle(plan, path, included);
        this.clearAnalysisSession();
        this.refreshReviewPanel();
    }

    private refreshReviewPanel(): void {
        this.currentPanelLayout = "review";
        this.pendingReviewNote = null;
        this.panelView?.open("review", this.defaultReviewPanelFindings(), this.panelExtraForLayout("review"));
    }

    // ======================================================================
    // Pet lifecycle
    // ======================================================================

    /**
     * Handle an active-leaf-change event: unmount Pet from the previous
     * leaf, and re-mount on the new one if it is a markdown view.
     */
    private handleLeafChange(leaf: WorkspaceLeaf | null): void {
        // Always unmount from previous location
        this.petView?.unmount();
        this.bubbleView?.close();

        // Only mount on markdown views (D029/R1)
        if (!leaf || leaf.view?.getViewType() !== "markdown") {
            const discarded = this.discardAnalysisSessionIfStale(null);
            if (discarded && this.panelView?.isOpen) {
                this.panelView.close();
            }
            return;
        }
        if (!this.host.settings.pagelet.petVisible) return;

        const markdownView = leaf.view as MarkdownView;
        const discarded = this.discardAnalysisSessionIfStale(markdownView.file?.path ?? null);
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
        if (!this.bubbleView) return;

        const bubbleState = this.bubbleView.bubbleState;

        // If bubble is degraded (semi-transparent), restore it
        if (bubbleState === "degraded") {
            this.bubbleView.restore();
            return;
        }

        // If bubble is already visible, close it (toggle)
        if (bubbleState === "visible") {
            this.bubbleView.close();
            return;
        }

        // If Pet is in nudge state, show nudge-specific content
        if (this.petView?.stateMachine.state === "nudge") {
            this.showNudgeBubble();
            this.petView.stateMachine.transition("user-interact");
            this.proactiveHints.onHintViewed();
            return;
        }

        // Otherwise, show regular bubble
        this.showBubble();
    }

    /**
     * Show the Bubble with cached background preparation findings, or an empty state
     * that offers to trigger an immediate analysis cycle.
     */
    private showBubble(): void {
        const anchorEl = this.petView?.rootEl;
        if (!this.bubbleView || !anchorEl) return;

        const locale = getPageletUiLanguage();
        const cachedFindings = this.preloadCache.getFindings();

        let content: BubbleContent;
        if (cachedFindings.length > 0) {
            const findings: BubbleFinding[] = cachedFindings.map((f) => ({
                text: f.text,
                sourceLink: f.sourceFile,
                sourceTitle: f.sourceTitle,
            }));
            content = buildQuickReviewContent(findings, {
                onExpandPanel: (type) => this.handleExpandPanel(type),
                onSourceClick: (link) => this.handleSourceClick(link),
                onDismiss: () => this.handleBubbleDismiss(),
            }, locale);
        } else {
            content = buildEmptyContent(() => { void this.reviewCurrentNote(); }, locale);
        }

        this.bubbleView.show(content, anchorEl);
    }

    /** Show nudge-specific content when Pet is in nudge state. */
    private showNudgeBubble(): void {
        const anchorEl = this.petView?.rootEl;
        if (!this.bubbleView || !anchorEl) return;

        const locale = getPageletUiLanguage();
        const cachedFindings = this.preloadCache.getFindings();
        const findings: BubbleFinding[] = cachedFindings.map((f) => ({
            text: f.text,
            sourceLink: f.sourceFile,
            sourceTitle: f.sourceTitle,
        }));

        const content = buildNudgeContent(findings, {
            onExpandPanel: (type) => this.handleExpandPanel(type),
            onSourceClick: (link) => this.handleSourceClick(link),
            onDismiss: () => this.handleBubbleDismiss(),
        }, locale);

        this.bubbleView.show(content, anchorEl);
    }

    /**
     * Scenario 2: Writing Assistance — analyze the current note and
     * show context-relevant suggestions in the Bubble.
     */
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
        if (!this.beginForegroundReviewRun()) return;

        const runSeq = ++this.foregroundRunSeq;
        this.petView?.stateMachine.transition("analysis-start");

        try {
            const analyzeCallback = this.host.createForegroundAnalyzeCallback();
            const result = await analyzeCallback(
                files,
                {
                    enabled: true,
                    intervalMinutes: 0,
                    perHourCap: this.host.settings.pagelet.foregroundPerHourCap,
                    perDayCap: this.host.settings.pagelet.foregroundPerDayCap,
                    tokenBudget: this.foregroundTokenBudget(),
                    range: options.range,
                },
            );

            if (this.destroyed || runSeq !== this.foregroundRunSeq) return;
            if (
                options.expectedActivePath
                && this.host.app.workspace.getActiveFile?.()?.path !== options.expectedActivePath
            ) {
                this.host.log("Discarded stale Pagelet foreground result", {
                    expectedActivePath: options.expectedActivePath,
                    activePath: this.host.app.workspace.getActiveFile?.()?.path ?? null,
                });
                this.clearAnalysisSession();
                return;
            }

            this.petView?.stateMachine.transition("analysis-done");

            // Cache results for Panel data flow. The source path guards
            // against showing or saving stale findings after the user changes
            // the active note.
            this.lastAnalysisSourcePath = options.expectedActivePath ?? files[0]?.path ?? null;
            this.lastAnalysisFindings = this.toPanelFindings(result.findings);

            if (options.preferPanel) {
                this.currentPanelLayout = options.panelLayout;
                this.panelView?.open(
                    options.panelLayout,
                    this.lastAnalysisFindings,
                    this.panelExtraForLayout(options.panelLayout),
                );
                return;
            }

            const anchorEl = this.petView?.rootEl;
            if (!this.bubbleView || !anchorEl) {
                this.handleExpandPanel(options.panelLayout);
                return;
            }
            const locale = getPageletUiLanguage();

            if (result.findings.length > 0) {
                const findings: BubbleFinding[] = result.findings.map((f) => ({
                    text: f.text,
                    sourceLink: f.sourceFile,
                    sourceTitle: f.sourceTitle,
                }));

                const content = buildWritingAssistContent(findings, {
                    onExpandPanel: (type) => this.handleExpandPanel(type),
                    onSourceClick: (link) => this.handleSourceClick(link),
                    onDismiss: () => this.handleBubbleDismiss(),
                }, locale);

                this.bubbleView.show(content, anchorEl);
            } else {
                const content = buildEmptyContent(() => { void this.reviewCurrentNote(); }, locale);
                this.bubbleView.show(content, anchorEl);
            }
        } catch (error) {
            this.petView?.stateMachine.transition("analysis-done");
            this.petView?.flashError();
            this.host.log("Current note analysis failed", error);
            const message = error instanceof Error ? error.message : String(error);
            new Notice(message || this.t("pagelet.panel.status.actionFailed"), 5000);
        } finally {
            this.finishForegroundReviewRun();
        }
    }

    // ======================================================================
    // Background preparation engine
    // ======================================================================

    /** Create and start the background preparation engine. */
    private startPreloadEngine(): void {
        if (this.preloadEngine) {
            this.preloadEngine.updateConfig(this.buildPreloadConfig());
            return;
        }

        this.preloadEngine = new PreloadEngine(
            this.host.app,
            this.buildPreloadConfig(),
            this.preloadCache,
            this.preloadBudget,
            this.changeDetector,
            this.scopeResolver,
            this.host.createPreloadAnalyzeCallback(),
        );

        // Background preparation events drive the Pet state machine
        this.preloadUnsubscribe = this.preloadEngine.on((event: PreloadEvent) => {
            this.handlePreloadEvent(event);
        });

        this.preloadEngine.start();
    }

    private buildPreloadConfig() {
        const s = this.host.settings.pagelet;
        return {
            enabled: s.preloadEnabled,
            intervalMinutes: s.preloadInterval,
            perHourCap: s.preloadPerHourCap,
            perDayCap: s.preloadPerDayCap,
            tokenBudget: { ...s.preloadTokenBudget },
        };
    }

    private ensureScopePlan(): PageletScopePlan | null {
        const activePath = this.host.app.workspace.getActiveFile?.()?.path ?? null;
        if (
            this.currentScopePlan
            && activePath === this.currentScopePlan.activePath
            && this.currentScopePlan.range === this.currentScopeRange
        ) {
            return this.currentScopePlan;
        }
        this.currentScopePlan = this.buildScopePlan(this.currentScopeRange);
        return this.currentScopePlan;
    }

    private buildScopePlan(range: PageletReviewRange): PageletScopePlan | null {
        const activeFile = this.host.app.workspace.getActiveFile?.();
        if (!activeFile || !activeFile.path.endsWith(".md")) return null;
        const s = this.host.settings.pagelet;
        return buildPageletScopePlan({
            files: this.host.app.vault.getMarkdownFiles(),
            activePath: activeFile.path,
            range,
            reviewsFolder: s.reviewsFolder,
            excludedFolders: s.excludedFolders,
            excludedTags: s.excludedTags,
            excludedPatterns: s.excludedPatterns,
            getMetadata: (path) => {
                const file = this.host.app.vault.getAbstractFileByPath(path);
                if (!file || !("extension" in file) || file.extension !== "md") return undefined;
                return this.host.app.metadataCache.getFileCache(file as TFile) ?? undefined;
            },
        });
    }

    private invalidateScopePlan(): void {
        this.currentScopePlan = null;
    }

    private panelExtraForLayout(layoutType: PanelLayoutType): PanelOpenExtra | undefined {
        if (layoutType !== "review") return undefined;
        const plan = this.ensureScopePlan();
        if (!plan) return undefined;
        return { scope: this.toPanelScope(plan) };
    }

    private toPanelScope(plan: PageletScopePlan): PanelScopeState {
        const candidates = plan.candidates.map((candidate) => ({
            path: candidate.path,
            title: displayFileName(candidate.path),
            reason: candidate.reason,
            included: candidate.included,
            locked: candidate.locked,
            skippedReason: candidate.skippedReason,
        }));
        return {
            range: plan.range,
            candidates,
            includedCount: candidates.filter((candidate) => candidate.included).length,
            skippedCount: candidates.filter((candidate) => !candidate.included).length,
            excludedReviewOutputCount: plan.excludedReviewOutputCount,
            estimatedInputTokens: plan.estimatedInputTokens,
        };
    }

    private toPanelFindings(findings: PreloadFinding[]): PanelFinding[] {
        return findings.map((f) => {
            const suggestion = f.suggestion;
            const title = suggestion
                ? pageletT(`pagelet.suggestion.kind.${suggestion.kind}`, getPageletUiLanguage())
                : f.sourceTitle || f.sourceFile || "Untitled";
            return {
                title,
                description: suggestion?.proposed_action ?? f.text,
                insightText: suggestion?.rationale,
                sourceFile: f.sourceFile,
                sourceTitle: f.sourceTitle,
                sourceId: suggestion?.source_id,
                suggestion,
                diagnostics: f.diagnostics,
            };
        });
    }

    private defaultReviewPanelFindings(): PanelFinding[] {
        const current = this.currentPanelLayout === "review" ? this.currentAnalysisFindings() : [];
        if (current.length > 0) return current;
        return [];
    }

    /** Map preload lifecycle events to Pet state transitions. */
    private handlePreloadEvent(event: PreloadEvent): void {
        switch (event.type) {
            case "cycle-start":
                this.petView?.stateMachine.transition("analysis-start");
                break;

            case "cycle-complete":
                if (this.proactiveHints.onInsightsReady()) {
                    // Hints are enabled and cooldown has elapsed -> nudge
                    this.petView?.stateMachine.transition("insights-ready");
                } else {
                    // No nudge: return to idle quietly
                    this.petView?.stateMachine.transition("analysis-done");
                }
                break;

            case "cycle-error":
                this.petView?.stateMachine.transition("analysis-done");
                this.petView?.flashError();
                this.host.log("Preload cycle error", event.error);
                break;

            case "cycle-skip":
                // Skips are silent -- no state change, no user notification
                break;
        }
    }

    /** Run the Scenario 4 periodic summary flow: scope → generate → write */
    private async runPeriodicSummary(): Promise<void> {
        const s = this.host.settings.pagelet;
        const scopeDays = s.periodicSummaryScope === "3d" ? 3
            : s.periodicSummaryScope === "14d" ? 14
                : 7;

        // 1. Resolve scope
        const scope = this.scopeResolver.resolveTimeRange(scopeDays);
        if (scope.included.length === 0) {
            new Notice(this.t("pagelet.notice.noNotesInRange"), 4000);
            return;
        }

        if (!this.beginForegroundReviewRun()) return;

        // 2. Show working state
        this.petView?.stateMachine.transition("analysis-start");
        new Notice(this.t("pagelet.periodicSummary.generatingForNotes", { count: scope.included.length }), 3000);

        try {
            // 3. Generate review note
            const generator = new ReviewNoteGenerator(this.host.app);
            const now = new Date();
            const rangeStart = new Date(now.getTime() - scopeDays * 86400000);
            const rangeDesc = `${formatPageletDate(rangeStart)} to ${formatPageletDate(now)}`;

            const note = await generator.generate(
                {
                    files: scope.included.map(c => c.file),
                    rangeDescription: rangeDesc,
                    scopeDays,
                },
                { reviewsFolder: s.reviewsFolder },
                this.host.createGenerateCallback(), // reuse the LLM callback
                this.foregroundTokenBudget(),
            );

            // 4. Show preview in Panel instead of writing immediately
            this.pendingReviewNote = note;
            this.currentPanelLayout = "summary";
            this.petView?.stateMachine.transition("analysis-done");
            this.panelView?.open("summary", [{
                title: note.fileName,
                description: note.markdown,
            }], { markdown: note.markdown });

            // The actual write happens when user clicks "Save" in the Panel
            // (via onSaveAsReviewNote callback -> saveFindingsAsReviewNote)
        } catch (error) {
            this.petView?.stateMachine.transition("analysis-done");
            this.petView?.flashError();
            const msg = error instanceof Error ? error.message : String(error);
            new Notice(this.t("pagelet.periodicSummary.failedWithError", { error: msg }), 5000);
            this.host.log("Periodic summary error", error);
        } finally {
            this.finishForegroundReviewRun();
        }
    }

    private beginForegroundReviewRun(): boolean {
        if (this.foregroundRunInProgress) {
            new Notice(this.t("pagelet.notice.alreadyReviewing"), 4000);
            return false;
        }
        if (!this.reserveForegroundReviewCall()) return false;
        this.foregroundRunInProgress = true;
        return true;
    }

    private finishForegroundReviewRun(): void {
        this.foregroundRunInProgress = false;
    }

    private reserveForegroundReviewCall(): boolean {
        const s = this.host.settings.pagelet;
        this.foregroundBudget.updateLimits(s.foregroundPerHourCap, s.foregroundPerDayCap);
        if (!this.foregroundBudget.canRun()) {
            new Notice(this.t("pagelet.notice.foregroundLimit"), 5000);
            return false;
        }
        this.foregroundBudget.recordCall();
        return true;
    }

    private foregroundTokenBudget(): { input: number; output: number } {
        const s = this.host.settings.pagelet;
        return {
            input: s.maxInputTokens,
            output: s.maxOutputTokens,
        };
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
    // Idle timer + note activity detection
    // ======================================================================

    /**
     * Called on every vault `modify` event. Debounced so rapid saves
     * during typing do not flood the state machine.
     */
    private handleNoteActivity(): void {
        this.clearActivityDebounce();
        this.activityDebounceTimer = setPlatformTimeout(() => {
            this.activityDebounceTimer = null;
            this.petView?.stateMachine.transition("note-activity");
            this.preloadEngine?.noteActivity();
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
    // Command callback implementations
    // ======================================================================

    /** Cycle Pet through the 4 corners: BR -> BL -> TR -> TL -> BR */
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
        this.host.settings.pagelet.petCorner = nextCorner;
        void this.host.saveSettings();
    }

    private toggleProactiveHints(): void {
        const newState = this.proactiveHints.toggle();
        if (this.petView) {
            this.petView.stateMachine.proactiveHintsEnabled = newState;
        }
        this.host.settings.pagelet.proactiveHints = newState;
        void this.host.saveSettings();
    }

    /** Toggle Pet visibility. Persist the setting so it survives leaf changes and restarts. */
    private togglePetVisibility(): void {
        if (this.host.settings.pagelet.petVisible) {
            this.petView?.destroy();
            this.petView = null;
            this.bubbleView?.close();
            this.host.settings.pagelet.petVisible = false;
        } else {
            this.host.settings.pagelet.petVisible = true;
            const activeLeaf = this.host.app.workspace.getMostRecentLeaf();
            if (activeLeaf) {
                this.handleLeafChange(activeLeaf);
            }
        }
        void this.host.saveSettings();
    }

    /** Show a Notice with background preparation diagnostics. */
    private showBackgroundPreparationStatusNotice(): void {
        const status = this.preloadEngine?.status?.();
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
    // Bubble callback implementations
    // ======================================================================

    /** Handle "expand" action from Bubble -> open Panel. */
    private handleExpandPanel(type?: string): void {
        this.bubbleView?.close();
        const requestedType = type === "writing" ? "current" : type;
        const layoutType = (requestedType === "review" || requestedType === "current" || requestedType === "discover" || requestedType === "summary")
            ? requestedType : "review";
        this.currentPanelLayout = layoutType;
        if (layoutType !== "summary") {
            this.pendingReviewNote = null;
        }
        // Use current-note analysis findings only while they still match the
        // active note; otherwise fall back to background preparation cache.
        let panelFindings = this.currentAnalysisFindings();
        if (panelFindings.length === 0 && layoutType !== "review") {
            panelFindings = this.toPanelFindings(this.preloadCache.getFindings());
        }

        this.panelView?.open(layoutType, panelFindings, this.panelExtraForLayout(layoutType));
    }

    /** Expand current Panel content into a full Tab. */
    private expandPanelToTab(): void {
        this.panelView?.close();
        const locale = getPageletUiLanguage();
        const title = pageletT("pagelet.tab.title", locale);
        const currentFindings = this.currentAnalysisFindings();
        const findings = currentFindings.length > 0
            ? currentFindings
            : this.toPanelFindings(this.preloadCache.getFindings());
        void Promise.resolve(this.host.openPageletDetailView({
            title,
            content: findings,
            locale,
        })).catch((error: unknown) => {
            this.host.log("Failed to open Pagelet detail view", error);
            new Notice(this.t("pagelet.panel.status.error"), 4000);
        });
    }

    /** Save Panel findings as a review note via the output module. */
    private async saveFindingsAsReviewNote(findings: PanelFinding[]): Promise<void> {
        if (this.saveInProgress) {
            new Notice(this.t("pagelet.panel.status.saving"), 3000);
            return;
        }
        this.saveInProgress = true;
        // If we have a pre-generated note from periodic summary, write it directly
        if (this.currentPanelLayout === "summary" && this.pendingReviewNote) {
            this.petView?.stateMachine.transition("analysis-start");
            try {
                const result = await this.host.writeReviewNote(this.pendingReviewNote);
                this.petView?.stateMachine.transition("analysis-done");
                if (result.success) {
                    this.pendingReviewNote = null;
                    this.panelView?.close();
                    new Notice(this.t("pagelet.reviewNote.created", { path: result.filePath ?? "" }), 5000);
                } else {
                    new Notice(this.t("pagelet.reviewNote.createFailed", { error: result.error ?? "" }), 5000);
                    this.petView?.flashError();
                }
            } catch (error) {
                this.petView?.stateMachine.transition("analysis-done");
                this.petView?.flashError();
                this.host.log("Save pending review note failed", error);
            } finally {
                this.saveInProgress = false;
            }
            return;
        }

        // Fallback: build layout-specific review note from findings
        if (findings.length === 0) {
            new Notice(this.t("pagelet.notice.noFindingsToSave"), 3000);
            this.saveInProgress = false;
            return;
        }

        this.petView?.stateMachine.transition("analysis-start");

        try {
            const s = this.host.settings.pagelet;
            const now = new Date();
            const activeFile = this.host.app.workspace.getActiveFile?.();
            const layout = this.currentPanelLayout ?? "review";

            let markdown: string;
            let fileName: string;
            const reviewResult = this.buildReviewResultFromFindings(findings);
            const sourcePath = this.resolveReviewSourcePath(findings, activeFile?.path);

            switch (layout) {
                case "discover": {
                    const noteName = activeFile?.basename ?? "Unknown";
                    markdown = this.buildCanonicalReviewMarkdown(sourcePath, reviewResult, now);
                    fileName = `pagelet-discovery-${noteName}-${formatPageletDate(now)}.md`;
                    break;
                }
                case "current": {
                    const noteName = activeFile?.basename ?? "Unknown";
                    markdown = this.buildCanonicalReviewMarkdown(sourcePath, reviewResult, now);
                    fileName = `pagelet-analysis-${noteName}-${formatPageletDate(now)}.md`;
                    break;
                }
                case "review":
                default: {
                    markdown = this.buildCanonicalReviewMarkdown(sourcePath, reviewResult, now);
                    fileName = `pagelet-review-${formatPageletDate(now)}.md`;
                    break;
                }
            }

            // Write the note
            const targetFolder = s.reviewsFolder;
            const targetPath = `${targetFolder}/${fileName}`;
            const result = await this.host.writeReviewNote({
                markdown,
                fileName,
                targetFolder,
                targetPath,
                sources: findings.filter(f => f.sourceFile).map(f => `[[${f.sourceTitle || f.sourceFile}]]`),
                tokenCost: { input: 0, output: 0 },
            });

            this.petView?.stateMachine.transition("analysis-done");
            if (result.success) {
                this.panelView?.close();
                new Notice(this.t("pagelet.reviewNote.created", { path: result.filePath ?? "" }), 5000);
            } else {
                new Notice(this.t("pagelet.reviewNote.failed", { error: result.error ?? "" }), 5000);
                this.petView?.flashError();
            }
        } catch (error) {
            this.petView?.stateMachine.transition("analysis-done");
            this.petView?.flashError();
            this.host.log("Save findings failed", error);
        } finally {
            this.saveInProgress = false;
        }
    }

    private clearPanelSession(): void {
        if (this.saveInProgress) return;
        this.currentPanelLayout = null;
        this.pendingReviewNote = null;
    }

    private clearAnalysisSession(): void {
        this.lastAnalysisFindings = [];
        this.lastAnalysisSourcePath = null;
    }

    private discardAnalysisSessionIfStale(activePath: string | null): boolean {
        if (!this.lastAnalysisSourcePath) return false;
        if (activePath === this.lastAnalysisSourcePath) return false;
        this.clearAnalysisSession();
        return true;
    }

    private currentAnalysisFindings(): PanelFinding[] {
        const activePath = this.host.app.workspace.getActiveFile?.()?.path ?? null;
        if (!this.lastAnalysisSourcePath) return this.lastAnalysisFindings;
        return activePath === this.lastAnalysisSourcePath ? this.lastAnalysisFindings : [];
    }

    private resolveReviewSourcePath(findings: PanelFinding[], activePath?: string): string {
        const active = activePath ?? null;
        if (this.lastAnalysisSourcePath && active === this.lastAnalysisSourcePath) {
            return this.lastAnalysisSourcePath;
        }
        return findings.find((finding) => finding.sourceFile)?.sourceFile
            ?? activePath
            ?? "pagelet";
    }

    // ------------------------------------------------------------------
    // Layout-specific markdown builders
    // ------------------------------------------------------------------

    private buildCanonicalReviewMarkdown(
        sourcePath: string,
        reviewResult: PageletReviewResult,
        date: Date,
    ): string {
        const metadata = buildReviewMetadata({
            sourcePath,
            mode: "basic",
            detectedLanguage: reviewResult.detected_language,
            createdAtIso: formatPageletIsoTimestamp(date),
        });
        return assembleReviewNote(metadata, reviewResult);
    }

    private buildReviewResultFromFindings(findings: PanelFinding[]): PageletReviewResult {
        const detectedLanguage = getPageletUiLanguage();
        return {
            schema_version: PAGELET_SCHEMA_VERSION,
            detected_language: detectedLanguage,
            suggestions: findings.slice(0, 8).map((finding, index) => {
                if (finding.suggestion) {
                    return finding.suggestion;
                }
                return {
                    source_id: finding.sourceId || `finding-${index + 1}`,
                    kind: "expand",
                    rationale: this.normalizeReviewField(
                        finding.title || finding.sourceTitle || finding.sourceFile,
                        detectedLanguage === "zh" ? "拾页发现了一个可改进点。" : "Pagelet found a review point.",
                        280,
                    ),
                    proposed_action: this.normalizeReviewField(
                        finding.description || finding.insightText || finding.title,
                        detectedLanguage === "zh" ? "请根据这条发现继续完善笔记。" : "Use this finding to improve the note.",
                        500,
                    ),
                    related_notes: finding.sourceTitle ? [finding.sourceTitle] : [],
                };
            }),
        };
    }

    private normalizeReviewField(
        value: string | undefined,
        fallback: string,
        maxLength: number,
    ): string {
        const normalized = (value ?? "").trim() || fallback;
        const minLength = 8;
        const padded = normalized.length >= minLength ? normalized : fallback;
        return padded.length > maxLength ? padded.slice(0, maxLength) : padded;
    }

    /** Handle a source-link click inside the Bubble. */
    private handleSourceClick(link: string): void {
        const file = this.host.app.vault.getAbstractFileByPath(link);
        if (file) {
            // TFile is the concrete subclass but we avoid importing it
            // to keep the orchestrator free of heavy imports.
            const leaf = this.host.app.workspace.getMostRecentLeaf();
            if (leaf) {
                void leaf.openFile(file as Parameters<WorkspaceLeaf["openFile"]>[0]);
            }
        }
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
        const basename = directPath.replace(/\.md$/i, "").split("/").pop()?.toLowerCase();
        if (!basename) return null;
        return this.host.app.vault.getMarkdownFiles().find((file) => {
            return file.path.toLowerCase() === directPath.toLowerCase()
                || file.basename.toLowerCase() === basename;
        }) ?? null;
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

    /** Handle Bubble dismiss (close button / Escape). */
    private handleBubbleDismiss(): void {
        // No additional action required -- BubbleView handles its own
        // DOM cleanup. Hook exists for future telemetry.
    }
}

function displayFileName(path: string): string {
    return path.split("/").pop()?.replace(/\.md$/i, "") || path;
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

const OBSIDIAN_MODAL_SELECTOR = ".modal-container, .modal";

function isObsidianModalOpen(event?: Event): boolean {
    if (event?.defaultPrevented) return true;
    if (event && eventPathContainsSelector(event, OBSIDIAN_MODAL_SELECTOR)) return true;
    const doc = getOptionalPlatformDocument();
    return Boolean(doc?.body?.querySelector(OBSIDIAN_MODAL_SELECTOR));
}
