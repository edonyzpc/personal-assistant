/* Copyright 2023 edonyzpc */

/**
 * Pagelet v2 Orchestrator -- central integration layer.
 *
 * Connects Pet, Bubble, Preload, Hints, and Commands into a working
 * feature lifecycle. The orchestrator does NOT make LLM calls directly;
 * it delegates analysis to the PreloadEngine via an injected
 * AnalyzeCallback from the host.
 *
 * Communication with the plugin is mediated through the narrow
 * {@link PageletV2Host} interface, keeping the dependency inverted
 * (orchestrator -> host abstraction, not -> concrete plugin).
 *
 * Delivery phase: v2-alpha.1 (Pet, Bubble, Preload, Quick Review,
 * Periodic Summary).
 */

import { Notice } from "obsidian";
import type { App, EventRef, MarkdownView, WorkspaceLeaf } from "obsidian";

import { getPageletUiLanguage } from "../locales/pagelet";

import type { BubbleContent, BubbleFinding } from "./bubble/types";
import { BubbleView } from "./bubble/BubbleView";
import { buildEmptyContent, buildNudgeContent, buildQuickReviewContent, buildWritingAssistContent } from "./bubble/BubbleContent";
import { PanelView } from "./panel/PanelView";
import type { NoteConnection, PanelAction, PanelFinding, PanelLayoutType } from "./panel/types";
import { TabView } from "./tab/TabView";
import type { PageletV2CommandCallbacks } from "./commands";
import { ProactiveHints } from "./hints/ProactiveHints";
import type { PetCorner } from "./pet/types";
import { PetView } from "./pet/PetView";
import { PreloadBudget } from "./preload/PreloadBudget";
import { PreloadCache } from "./preload/PreloadCache";
import { PreloadEngine } from "./preload/PreloadEngine";
import type { AnalyzeCallback, PreloadEvent } from "./preload/types";
import { ReviewNoteGenerator } from "./output/ReviewNoteGenerator";
import { ReviewNoteWriter } from "./output/ReviewNoteWriter";
import type { GenerateCallback, GeneratedReviewNote } from "./output/types";
import { formatPageletDate } from "./pa-review-file-io";
import { ChangeDetector } from "./scope/ChangeDetector";
import { ScopeResolver } from "./scope/ScopeResolver";
import { getPageletOverlayRoot } from "./overlay-root";
import { PageletActionExecutor } from "./actions/ActionExecutor";
import type { PageletAction, ActionResult } from "./actions/types";

// ---------------------------------------------------------------------------
// Host interface
// ---------------------------------------------------------------------------

/**
 * Narrow host interface -- what the v2 orchestrator needs from the plugin.
 *
 * Deliberately thin: only the settings and methods the orchestrator
 * actually reads. Everything else stays behind the plugin boundary.
 */
export interface PageletV2Host {
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

    /** Factory for the LLM callback used by ReviewNoteGenerator. */
    createGenerateCallback(): GenerateCallback;

    /** Persist current settings to disk. */
    saveSettings(): Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class PageletV2Orchestrator {
    // ---- Components -------------------------------------------------------
    private petView: PetView | null = null;
    private bubbleView: BubbleView | null = null;
    private panelView: PanelView | null = null;
    private tabView: TabView | null = null;
    private preloadEngine: PreloadEngine | null = null;
    private preloadUnsubscribe: (() => void) | null = null;
    private actionExecutor: PageletActionExecutor | null = null;
    private lastAnalysisFindings: PanelFinding[] = [];
    private pendingReviewNote: GeneratedReviewNote | null = null;
    private currentPanelLayout: PanelLayoutType | null = null;
    private readonly handleEscape: (e: KeyboardEvent) => void;
    private readonly preloadCache: PreloadCache;
    private readonly preloadBudget: PreloadBudget;
    private readonly changeDetector: ChangeDetector;
    private readonly scopeResolver: ScopeResolver;
    private readonly proactiveHints: ProactiveHints;

    // ---- State ------------------------------------------------------------
    private idleTimer: ReturnType<typeof setTimeout> | null = null;
    private activityDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    private destroyed = false;

    // ---- Constants --------------------------------------------------------
    /** 10 minutes of no activity -> Pet enters resting state. */
    private static readonly IDLE_TIMEOUT_MS = 10 * 60 * 1000;
    /** 5 s debounce for note-activity detection (vault modify events). */
    private static readonly ACTIVITY_DEBOUNCE_MS = 5_000;

    constructor(private readonly host: PageletV2Host) {
        const s = host.settings.pagelet;

        // Scope infrastructure
        this.preloadCache = new PreloadCache();
        this.preloadBudget = new PreloadBudget(
            s.preloadPerHourCap,
            s.preloadPerDayCap,
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

        // Bound Escape handler for cleanup
        this.handleEscape = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            if (this.tabView?.isOpen) { this.tabView.close(); e.stopImmediatePropagation(); return; }
            if (this.panelView?.isOpen) { this.panelView.close(); e.stopImmediatePropagation(); return; }
        };
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

        // 0. Create the action executor for Phase 4 write actions.
        this.actionExecutor = new PageletActionExecutor(
            this.host.app,
            (msg, ...args) => this.host.log(msg, ...args),
        );

        // 1. Resolve a single overlay mount root for Bubble/Panel/Tab.
        //    Mounting under workspace.containerEl (instead of
        //    document.body) ensures these fixed overlays never overlap
        //    Obsidian's titlebar drag region. Combined with each view's
        //    lazy mount/unmount, the workspace stays free of long-lived
        //    fixed overlays while idle (D037 progressive disclosure).
        const overlayRoot = getPageletOverlayRoot(this.host.app);

        // 1a. Create BubbleView (lazy-mounted on first show)
        this.bubbleView = new BubbleView({
            callbacks: {
                onExpandPanel: (type) => this.handleExpandPanel(type),
                onSourceClick: (link) => this.handleSourceClick(link),
                onDismiss: () => this.handleBubbleDismiss(),
            },
        });
        this.bubbleView.mount(overlayRoot);

        // 1b. Create PanelView (lazy-mounted on first open)
        this.panelView = new PanelView({
            callbacks: {
                onExpandToTab: () => this.expandPanelToTab(),
                onClose: () => { this.currentPanelLayout = null; this.host.log("Panel closed"); },
                onSourceClick: (link) => this.handleSourceClick(link),
                onSaveAsReviewNote: (findings) => { void this.saveFindingsAsReviewNote(findings); },
            },
        });
        this.panelView.mount(overlayRoot);

        // 1c. Create TabView (lazy-mounted on first open)
        this.tabView = new TabView(() => { this.host.log("Tab closed"); });
        this.tabView.mount(overlayRoot);

        // 1d. Centralized Escape handler (Tab > Panel > Bubble priority)
        document.addEventListener("keydown", this.handleEscape, true);

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
                    this.handleNoteActivity();
                }
            }),
        );

        // 4. Start preload engine (if enabled)
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
        document.removeEventListener("keydown", this.handleEscape, true);
        this.preloadUnsubscribe?.();
        this.preloadUnsubscribe = null;
        this.preloadEngine?.destroy();
        this.petView?.destroy();
        this.bubbleView?.destroy();
        this.panelView?.destroy();
        this.tabView?.destroy();
        this.preloadCache.clear();
        this.changeDetector.clear();

        this.preloadEngine = null;
        this.actionExecutor = null;
        this.petView = null;
        this.bubbleView = null;
        this.panelView = null;
        this.tabView = null;
    }

    // ======================================================================
    // Command callbacks -- returned to the command registrar
    // ======================================================================

    /**
     * Build the callback object expected by
     * `registerPageletV2Commands(host, callbacks, locale)`.
     */
    getCommandCallbacks(): PageletV2CommandCallbacks {
        return {
            onQuickReview: () => this.handlePetClick(),
            onDiscoverConnections: async () => {
                await this.analyzeCurrentNote();
                this.handleExpandPanel("discover");
            },
            onPeriodicSummary: () => {
                void this.runPeriodicSummary();
            },
            onToggleProactiveHints: () => {
                const newState = this.proactiveHints.toggle();
                if (this.petView) {
                    this.petView.stateMachine.proactiveHintsEnabled = newState;
                }
                this.host.settings.pagelet.proactiveHints = newState;
                void this.host.saveSettings();
            },
            onShowPreloadStatus: () => {
                this.showPreloadStatusNotice();
            },
            onMovePetCorner: () => {
                this.cyclePetCorner();
            },
            onTogglePetVisibility: () => {
                this.togglePetVisibility();
            },
        };
    }

    // ======================================================================
    // Write Action execution (Phase 4 / Operations Agent mode)
    // ======================================================================

    /**
     * Execute a pagelet write action via the ActionExecutor.
     *
     * Entry point for Operations Agent mode actions. The executor handles
     * preview, confirmation, the vault write, and audit logging.
     */
    async executeAction(action: PageletAction): Promise<ActionResult> {
        if (!this.actionExecutor) {
            return { success: false, error: "Action executor not initialized" };
        }
        this.host.log("[PageletAction] executing", action.type);
        const result = await this.actionExecutor.execute(action);
        if (!result.success) {
            this.host.log("[PageletAction] failed", action.type, result.error);
        }
        return result;
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
        if (!leaf || leaf.view?.getViewType() !== "markdown") return;
        if (!this.host.settings.pagelet.petVisible) return;

        const markdownView = leaf.view as MarkdownView;
        const containerEl = markdownView.contentEl;
        if (!containerEl) return;

        // Lazy-create Pet on first eligible leaf
        if (!this.petView) {
            this.petView = new PetView({
                corner: this.host.settings.pagelet.petCorner,
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
     * Show the Bubble with cached preload findings, or an empty state
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
            // No cached findings — try analyzing the current note (Scenario 2)
            const activeFile = this.host.app.workspace.getActiveFile?.();
            if (activeFile?.path.endsWith(".md")) {
                void this.analyzeCurrentNote();
                return;
            }
            content = buildEmptyContent(() => {
                void this.preloadEngine?.runCycle();
                new Notice("Analyzing notes…", 3000);
            }, locale);
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
    private async analyzeCurrentNote(): Promise<void> {
        const activeFile = this.host.app.workspace.getActiveFile?.();
        if (!activeFile || !activeFile.path.endsWith(".md")) return;

        this.petView?.stateMachine.transition("analysis-start");

        try {
            const analyzeCallback = this.host.createPreloadAnalyzeCallback();
            const result = await analyzeCallback(
                [activeFile],
                {
                    enabled: true,
                    intervalMinutes: 0,
                    perHourCap: 999,
                    perDayCap: 999,
                    tokenBudget: this.host.settings.pagelet.preloadTokenBudget,
                },
            );

            this.petView?.stateMachine.transition("analysis-done");

            // Cache results for Panel data flow
            this.lastAnalysisFindings = result.findings.map((f) => ({
                title: f.sourceTitle || f.sourceFile || "Untitled",
                description: f.text,
                sourceFile: f.sourceFile,
                sourceTitle: f.sourceTitle,
            }));

            const anchorEl = this.petView?.rootEl;
            if (!this.bubbleView || !anchorEl) return;
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
                const content = buildEmptyContent(() => {
                    void this.preloadEngine?.runCycle();
                    new Notice("Analyzing notes…", 3000);
                }, locale);
                this.bubbleView.show(content, anchorEl);
            }
        } catch (error) {
            this.petView?.stateMachine.transition("analysis-done");
            this.petView?.flashError();
            this.host.log("Current note analysis failed", error);
        }
    }

    // ======================================================================
    // Preload engine
    // ======================================================================

    /** Create and start the preload engine. */
    private startPreloadEngine(): void {
        const s = this.host.settings.pagelet;

        this.preloadEngine = new PreloadEngine(
            this.host.app,
            {
                enabled: s.preloadEnabled,
                intervalMinutes: s.preloadInterval,
                perHourCap: s.preloadPerHourCap,
                perDayCap: s.preloadPerDayCap,
                tokenBudget: { ...s.preloadTokenBudget },
            },
            this.preloadCache,
            this.preloadBudget,
            this.changeDetector,
            this.scopeResolver,
            this.host.createPreloadAnalyzeCallback(),
        );

        // Preload events drive the Pet state machine
        this.preloadUnsubscribe = this.preloadEngine.on((event: PreloadEvent) => {
            this.handlePreloadEvent(event);
        });

        this.preloadEngine.start();
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
            new Notice("No notes found in the selected time range.", 4000);
            return;
        }

        // 2. Show working state
        this.petView?.stateMachine.transition("analysis-start");
        new Notice(`Generating summary for ${scope.included.length} notes…`, 3000);

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
                s.preloadTokenBudget,
            );

            // 4. Show preview in Panel instead of writing immediately
            this.pendingReviewNote = note;
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
            new Notice(`Periodic summary failed: ${msg}`, 5000);
            this.host.log("Periodic summary error", error);
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
        this.activityDebounceTimer = setTimeout(() => {
            this.activityDebounceTimer = null;
            // Wake Pet from resting if it was asleep
            this.petView?.stateMachine.transition("note-activity");
            // Reset the idle countdown
            this.resetIdleTimer();
        }, PageletV2Orchestrator.ACTIVITY_DEBOUNCE_MS);
    }

    /** (Re)start the idle timer. When it fires, Pet enters resting. */
    private resetIdleTimer(): void {
        this.clearIdleTimer();
        this.idleTimer = setTimeout(() => {
            this.idleTimer = null;
            this.petView?.stateMachine.transition("long-idle");
        }, PageletV2Orchestrator.IDLE_TIMEOUT_MS);
    }

    private clearIdleTimer(): void {
        if (this.idleTimer !== null) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }

    private clearActivityDebounce(): void {
        if (this.activityDebounceTimer !== null) {
            clearTimeout(this.activityDebounceTimer);
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

    /** Toggle Pet visibility. Persist the setting so it survives leaf changes and restarts. */
    private togglePetVisibility(): void {
        if (this.petView) {
            this.petView.destroy();
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

    /** Show a Notice with preload engine diagnostics. */
    private showPreloadStatusNotice(): void {
        const status = this.preloadEngine?.status?.();
        if (!status) {
            new Notice("Preload engine is not running.", 4000);
            return;
        }
        const lastTime = status.lastCycleAt
            ? new Date(status.lastCycleAt).toLocaleTimeString()
            : "never";
        new Notice(
            `Preload: ${status.running ? "running" : "stopped"}\n` +
            `Last: ${lastTime}\n` +
            `Budget: ${status.budgetRemaining.hourly}h / ${status.budgetRemaining.daily}d\n` +
            `Cache: ${status.cacheHasResults ? "yes" : "no"}`,
            8000,
        );
    }

    // ======================================================================
    // Bubble callback implementations
    // ======================================================================

    /** Handle "expand" action from Bubble -> open Panel. */
    private handleExpandPanel(type?: string): void {
        this.bubbleView?.close();
        const layoutType = (type === "review" || type === "current" || type === "discover" || type === "summary")
            ? type : "review";
        this.currentPanelLayout = layoutType;
        // Use last analysis findings if available, otherwise fall back to preload cache
        let panelFindings = this.lastAnalysisFindings;
        if (panelFindings.length === 0) {
            panelFindings = this.preloadCache.getFindings().map((f) => ({
                title: f.sourceTitle || f.sourceFile || "Untitled",
                description: f.text,
                sourceFile: f.sourceFile,
                sourceTitle: f.sourceTitle,
            }));
        }

        // Attach Phase 4 action buttons to actionable findings
        panelFindings = panelFindings.map((f) => this.attachActionButtons(f));

        this.panelView?.open(layoutType, panelFindings);
    }

    /**
     * Attach Operations Agent mode action buttons to a panel finding.
     *
     * For each finding that has actionable content, add buttons for:
     *   - "Append to daily note" — creates an AppendToDailyAction
     *   - "Create task" — creates a CreateTaskAction
     */
    private attachActionButtons(finding: PanelFinding): PanelFinding {
        const actions: PanelAction[] = finding.actions ? [...finding.actions] : [];

        // "Append to daily note" — available for all findings with a description
        if (finding.description) {
            actions.push({
                label: "Append to daily note",
                callback: () => {
                    void this.executeAction({
                        type: "append-to-daily",
                        content: finding.description,
                    });
                },
            });
        }

        // "Create task" — available for all findings with a title
        if (finding.title) {
            actions.push({
                label: "Create task",
                callback: () => {
                    void this.executeAction({
                        type: "create-task",
                        taskText: finding.title,
                    });
                },
            });
        }

        return { ...finding, actions };
    }

    /** Expand current Panel content into a full Tab. */
    private expandPanelToTab(): void {
        this.panelView?.close();
        const title = "拾页 — 详细视图";
        const findings = this.lastAnalysisFindings.length > 0
            ? this.lastAnalysisFindings
            : this.preloadCache.getFindings().map((f) => ({
                title: f.sourceTitle || f.sourceFile || "Untitled",
                description: f.text,
                sourceFile: f.sourceFile,
                sourceTitle: f.sourceTitle,
            }));
        this.tabView?.open(title, findings);
    }

    /** Save Panel findings as a review note via the output module. */
    private async saveFindingsAsReviewNote(findings: PanelFinding[]): Promise<void> {
        // If we have a pre-generated note from periodic summary, write it directly
        if (this.pendingReviewNote) {
            this.petView?.stateMachine.transition("analysis-start");
            try {
                const writer = new ReviewNoteWriter(this.host.app);
                const result = await writer.write(this.pendingReviewNote);
                this.pendingReviewNote = null;
                this.petView?.stateMachine.transition("analysis-done");
                if (result.success) {
                    new Notice(`Review note created: ${result.filePath}`, 5000);
                } else {
                    new Notice(`Failed to create review note: ${result.error}`, 5000);
                    this.petView?.flashError();
                }
            } catch (error) {
                this.pendingReviewNote = null;
                this.petView?.stateMachine.transition("analysis-done");
                this.petView?.flashError();
                this.host.log("Save pending review note failed", error);
            }
            return;
        }

        // Fallback: build layout-specific review note from findings
        if (findings.length === 0) {
            new Notice("No findings to save.", 3000);
            return;
        }

        this.petView?.stateMachine.transition("analysis-start");

        try {
            const s = this.host.settings.pagelet;
            const now = new Date();
            const activeFile = this.host.app.workspace.getActiveFile?.();
            const layout = this.currentPanelLayout ?? "review";

            // Build markdown content based on layout type
            let markdown: string;
            let fileName: string;

            switch (layout) {
                case "discover": {
                    const connections = activeFile
                        ? this.buildConnectionsForDiscovery(activeFile.path)
                        : [];
                    const noteName = activeFile?.basename ?? "Unknown";
                    markdown = this.buildDiscoveryNoteMarkdown(noteName, findings, connections, now);
                    fileName = `pagelet-discovery-${noteName}-${formatPageletDate(now)}.md`;
                    break;
                }
                case "current": {
                    const noteName = activeFile?.basename ?? "Unknown";
                    markdown = this.buildCurrentNoteMarkdown(noteName, findings, now);
                    fileName = `pagelet-analysis-${noteName}-${formatPageletDate(now)}.md`;
                    break;
                }
                case "review":
                default: {
                    markdown = this.buildReviewNoteMarkdown(findings, now);
                    fileName = `pagelet-review-${formatPageletDate(now)}.md`;
                    break;
                }
            }

            // Write the note
            const targetFolder = s.reviewsFolder;
            const targetPath = `${targetFolder}/${fileName}`;
            const writer = new ReviewNoteWriter(this.host.app);
            const result = await writer.write({
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
                new Notice(`Review note created: ${result.filePath}`, 5000);
            } else {
                new Notice(`Failed: ${result.error}`, 5000);
                this.petView?.flashError();
            }
        } catch (error) {
            this.petView?.stateMachine.transition("analysis-done");
            this.petView?.flashError();
            this.host.log("Save findings failed", error);
        }
    }

    // ------------------------------------------------------------------
    // Layout-specific markdown builders
    // ------------------------------------------------------------------

    private buildDiscoveryNoteMarkdown(
        noteName: string, findings: PanelFinding[],
        connections: NoteConnection[], date: Date,
    ): string {
        const lines = [
            "---",
            "pagelet: true",
            `generated_at: "${date.toISOString()}"`,
            `sources: ["[[${noteName}]]"]`,
            "---",
            "",
            `# Connection Discovery — ${noteName}`,
            "",
            "## Connections",
            "",
        ];
        for (const c of connections) {
            lines.push(`- **${c.fromNote} ↔ ${c.toNote}** — ${c.strength}`);
            if (c.sharedConcepts.length > 0) {
                lines.push(`  Shared: ${c.sharedConcepts.join(", ")}`);
            }
        }
        if (findings.length > 0) {
            lines.push("", "## Insights", "");
            for (const f of findings) {
                lines.push(`- ${f.description}`);
            }
        }
        return lines.join("\n");
    }

    private buildCurrentNoteMarkdown(
        noteName: string, findings: PanelFinding[], date: Date,
    ): string {
        const lines = [
            "---",
            "pagelet: true",
            `generated_at: "${date.toISOString()}"`,
            `sources: ["[[${noteName}]]"]`,
            "---",
            "",
            `# Analysis of "${noteName}" — ${formatPageletDate(date)}`,
            "",
            "## Findings",
            "",
        ];
        for (const f of findings) {
            lines.push(`- ${f.description}`);
        }
        return lines.join("\n");
    }

    private buildReviewNoteMarkdown(
        findings: PanelFinding[], date: Date,
    ): string {
        const sources = [...new Set(findings.filter(f => f.sourceTitle).map(f => f.sourceTitle!))];
        const lines = [
            "---",
            "pagelet: true",
            `generated_at: "${date.toISOString()}"`,
            `sources: [${sources.map(s => `"[[${s}]]"`).join(", ")}]`,
            "---",
            "",
            `# Review — ${formatPageletDate(date)}`,
            "",
            "## Findings",
            "",
        ];
        for (const f of findings) {
            lines.push(`- ${f.description}`);
        }
        return lines.join("\n");
    }

    /**
     * Build connection data for the discovery layout by inspecting
     * preload cache findings that reference the given note path.
     */
    private buildConnectionsForDiscovery(notePath: string): NoteConnection[] {
        const cached = this.preloadCache.getFindings();
        const connections: NoteConnection[] = [];
        const baseName = notePath.replace(/\.md$/, "").split("/").pop() ?? notePath;

        for (const f of cached) {
            if (f.sourceFile && f.sourceFile !== notePath) {
                const targetName = (f.sourceTitle || f.sourceFile).replace(/\.md$/, "");
                connections.push({
                    fromNote: baseName,
                    toNote: targetName,
                    strength: "medium",
                    sharedConcepts: [],
                });
            }
        }
        return connections;
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

    /** Handle Bubble dismiss (close button / Escape). */
    private handleBubbleDismiss(): void {
        // No additional action required -- BubbleView handles its own
        // DOM cleanup. Hook exists for future telemetry.
    }
}
