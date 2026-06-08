/* Copyright 2023 edonyzpc */

/**
 * Pagelet (Review Assistant) — review orchestration logic.
 *
 * Extracted from `src/plugin.ts` (PluginManager) to honour the Single
 * Responsibility Principle. The orchestrator owns the full review
 * lifecycle — scope resolution, LLM review, Write-Action execution —
 * while the plugin retains runtime lifecycle, workspace management
 * and cross-cutting concerns (settings persistence, VSS, etc.).
 *
 * Communication with the plugin is mediated through the
 * {@link PageletOrchestratorHost} interface, keeping the dependency
 * inverted (orchestrator → host abstraction, not → concrete plugin).
 */

import { MarkdownView, Notice, Platform, TFile, normalizePath } from "obsidian";
import type { App, EventRef } from "obsidian";

import type { AgentCapabilityContext } from "../ai-services/capability-types";
import type { PreviewRenderer } from "../ai-services/write-action-framework";
import { getPageletUiLanguage, pageletT } from "../locales/pagelet";
import type { PageletOutputLanguageSetting } from "../settings/pagelet";

import {
    PAGELET_APPROX_CHARS_PER_TOKEN,
    PAGELET_DEFAULT_TARGET_SUGGESTIONS,
    PageletCostTracker,
    PageletRateLimiter,
    PageletReviewModel,
    buildPageletScopePlan,
    type PageletChatModelFactory,
    buildPageletScopeReviewBundle,
    isPageletEligibleView,
    mintNonCollidingReviewNotePath,
    type PageletReviewRange,
    type PageletReviewProgressEvent,
    type PageletReviewTimingEntry,
    type PageletScopeMetadataLike,
    type PageletScopePlan,
    type PageletScopeSelection,
    type PageletScopeSourceReference,
    type PageletSuggestion,
    type PaReviewRuntime,
} from "./index";
import { PageletView, type PageletDraftReviewSaveRequest } from "./view";

// ── Constants ────────────────────────────────────────────────────────────────

const PAGELET_REVIEW_TIMEOUT_MS = 90_000;
const PAGELET_PRODUCTION_MAX_RETRIES = 0;

function hasStringProperty<Key extends string>(
    value: unknown,
    key: Key,
): value is Record<Key, string> {
    return Boolean(value)
        && typeof value === "object"
        && typeof (value as Record<Key, unknown>)[key] === "string";
}

// ── Host interface ───────────────────────────────────────────────────────────

/**
 * The narrow surface the orchestrator requires from its host (the plugin).
 *
 * Keeping this as a structural interface rather than referencing
 * `PluginManager` directly prevents a circular-import at the value level
 * and lets tests provide a lightweight stub.
 */
export interface PageletOrchestratorHost {
    /** Obsidian application reference (vault, workspace, metadataCache …). */
    readonly app: App;

    /** Typed access to the settings the orchestrator reads. */
    readonly settings: {
        readonly debug: boolean;
        readonly pagelet: {
            readonly enabled: boolean;
            readonly reviewsFolder: string;
            readonly outputLanguage: PageletOutputLanguageSetting;
            readonly temperature: number;
            readonly maxInputTokens: number;
            readonly maxOutputTokens: number;
        };
        readonly chatModelName: string;
        readonly aiProvider: string;
        readonly previewLimits: number;
    };

    /**
     * Opaque plugin reference for the Write-Action executor's
     * {@link AgentCapabilityContext}. Typed through the capability
     * interface so the orchestrator never depends on the concrete
     * PluginManager class.
     */
    readonly capabilityPlugin: AgentCapabilityContext['plugin'];

    /**
     * Factory for creating a LangChain chat model (delegates to AIUtils
     * internally). Used by the Pagelet review pipeline.
     */
    createChatModel: PageletChatModelFactory;

    /** Structured debug log (no-op when `settings.debug` is false). */
    log(message: string, ...args: unknown[]): void;

    /** Lazy accessor for the Pagelet review runtime. */
    getOrCreatePageletRuntime(): PaReviewRuntime | null;

    /** Open (or reveal) the Pagelet side-panel and return the view. */
    activePageletView(): Promise<PageletView | null>;

    /** Return the already-open Pagelet view without revealing it, or null. */
    getOpenPageletView(): PageletView | null;

    /** Open (or reveal) the Chat side-panel and return its view. */
    activeChatView(): Promise<{ prefillComposer(text: string): boolean } | null>;

    /**
     * Register an Obsidian EventRef so the plugin can detach it on unload.
     * Delegates to `Plugin.registerEvent`.
     */
    registerEvent(ref: EventRef): void;

    /** Cost tracker shared across all reviews in this plugin session. */
    readonly pageletCostTracker: PageletCostTracker;

    /** Rate limiter shared across all reviews in this plugin session. */
    readonly pageletRateLimiter: PageletRateLimiter;
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export class PageletReviewOrchestrator {
    private pageletReviewInFlight = false;

    constructor(private readonly host: PageletOrchestratorHost) {}

    // ── PreviewRenderer factory (used by runtime init) ───────────────────

    createPageletPanelPreviewRenderer(): PreviewRenderer {
        return {
            show: async (spec, options) => {
                const pageletView =
                    this.host.getOpenPageletView() ?? (await this.host.activePageletView());
                if (!pageletView) {
                    return { outcome: "cancelled" };
                }
                return pageletView.showWritePreview(spec, options);
            },
        };
    }

    // ── Public entry-points (delegated from plugin) ──────────────────────

    async refreshPageletScope(
        range: PageletReviewRange,
        preferredActivePath?: string,
    ): Promise<void> {
        const anchor =
            this.resolvePageletAnchorMarkdownFile(preferredActivePath) ??
            this.getPageletAnchorMarkdownFile();
        const pageletView = await this.host.activePageletView();
        if (!pageletView || !anchor) return;
        pageletView.showScopePlan(await this.createPageletScopePlan(range, anchor));
    }

    async runPageletReviewForActiveNote(): Promise<void> {
        const locale = this.getPageletLocale();
        if (!this.reservePageletReview(locale)) return;
        const activeMarkdownView = this.getStrictActivePageletMarkdownView();
        if (!activeMarkdownView) {
            this.pageletReviewInFlight = false;
            return;
        }
        const file = activeMarkdownView.file;
        if (!file || file.extension.toLowerCase() !== "md") {
            this.pageletReviewInFlight = false;
            return;
        }
        await this.runPageletReviewForFiles({
            primaryFile: file,
            files: [file],
            range: "current",
            abortOnActiveViewChange: { view: activeMarkdownView, path: file.path },
        });
    }

    async runPageletReviewForPageletScope(): Promise<void> {
        const locale = this.getPageletLocale();
        if (!this.reservePageletReview(locale)) return;
        let pageletView = this.host.getOpenPageletView();
        let selection = pageletView?.getScopeSelection();
        const anchor =
            this.resolvePageletAnchorMarkdownFile(selection?.activePath) ??
            this.getPageletAnchorMarkdownFile();
        if (!anchor) {
            this.pageletReviewInFlight = false;
            new Notice(pageletT("pagelet.trigger.noActiveNote", locale), 3000);
            return;
        }
        pageletView = pageletView ?? (await this.host.activePageletView());
        if (!pageletView) {
            this.pageletReviewInFlight = false;
            return;
        }
        selection = selection ?? pageletView.getScopeSelection();
        if (selection.paths.length === 0) {
            const plan = await this.createPageletScopePlan(selection.range, anchor);
            pageletView.showScopePlan(plan);
            selection = pageletView.getScopeSelection();
        }
        const primaryFile = this.resolvePageletAnchorMarkdownFile(selection.activePath) ?? anchor;
        const files = this.resolvePageletScopeFiles(selection);
        if (files.length === 0) {
            this.pageletReviewInFlight = false;
            new Notice(pageletT("pagelet.trigger.emptyNote", locale), 3000);
            return;
        }
        await this.runPageletReviewForFiles({
            primaryFile,
            files,
            range: selection.range,
        });
    }

    async openPageletSourceReference(
        reference: PageletScopeSourceReference,
    ): Promise<boolean> {
        const abstractFile = this.host.app.vault.getAbstractFileByPath(
            normalizePath(reference.path),
        );
        if (!(abstractFile instanceof TFile)) return false;
        await this.host.app.workspace.getLeaf("tab").openFile(abstractFile);
        return true;
    }

    async openPageletRelatedNote(
        noteName: string,
        sourcePath: string,
    ): Promise<boolean> {
        const linkpath = noteName
            .replace(/^\[\[/, "")
            .replace(/\]\]$/, "")
            .split("|")[0]
            .trim();
        if (!linkpath) return false;
        const destination = this.host.app.metadataCache.getFirstLinkpathDest(
            linkpath,
            sourcePath,
        );
        if (!destination) return false;
        await this.host.app.workspace.getLeaf("tab").openFile(destination);
        return true;
    }

    async preparePageletResearchPrompt(
        suggestion: PageletSuggestion,
    ): Promise<boolean> {
        const locale = this.getPageletLocale();
        const sanitize = (text: string) => text.replace(/[\n\r]+/g, " ").slice(0, 500);
        const prompt = [
            pageletT("pagelet.research.prompt.search", locale),
            "",
            pageletT("pagelet.research.prompt.task", locale),
            `${pageletT("pagelet.research.prompt.kind", locale)}: ${sanitize(suggestion.kind)}`,
            `${pageletT("pagelet.research.prompt.action", locale)}: ${sanitize(suggestion.proposed_action)}`,
            "",
            pageletT("pagelet.research.prompt.output", locale),
        ].join("\n");
        const chatView = await this.host.activeChatView();
        if (!chatView) return false;
        return chatView.prefillComposer(prompt);
    }

    async savePageletDraftReview(
        request: PageletDraftReviewSaveRequest,
    ): Promise<void> {
        const locale = this.getPageletLocale();
        const pageletView =
            this.host.getOpenPageletView() ?? (await this.host.activePageletView());
        const runtime = this.host.getOrCreatePageletRuntime();
        if (!runtime) {
            pageletView?.showReviewSaveError(
                pageletT("pagelet.mascot.error", locale),
                request.sourcePath,
            );
            new Notice(pageletT("pagelet.mascot.error", locale), 3000);
            return;
        }

        try {
            const date = new Date();
            const writeResult = await runtime.actionExecutor.execute(
                runtime.toolProvider.capability,
                {
                    sourcePath: request.sourcePath,
                    reviewResult: request.result,
                    mode: request.mode,
                    detectedLanguage: request.detectedLanguage,
                    ...(request.targetPath ? { targetPath: request.targetPath } : {}),
                    dateOverride: date,
                    ...(request.diagnostics.costEntry
                        ? {
                              costUsd:
                                  request.diagnostics.costEntry.estimatedCost,
                          }
                        : {}),
                    ...(this.host.settings.aiProvider
                        ? { provider: this.host.settings.aiProvider }
                        : {}),
                    ...(this.host.settings.chatModelName
                        ? { model: this.host.settings.chatModelName }
                        : {}),
                },
                {
                    plugin: this.host.capabilityPlugin,
                    turnId: `pagelet-save-${date.getTime()}`,
                    platform: Platform.isMobile ? "mobile" : "desktop",
                },
            );
            if (writeResult.status === "ok") {
                const observation = writeResult.observation;
                const createdPath = hasStringProperty(observation, "createdPath")
                    ? observation.createdPath
                    : request.targetPath ?? request.sourcePath;
                pageletView?.showReviewSaved(
                    createdPath,
                    this.host.pageletCostTracker.getSummary(),
                );
                new Notice(
                    pageletT("pagelet.mascot.done", locale),
                    4000,
                );
                return;
            }
            if (writeResult.error?.includes("user did not confirm")) {
                pageletView?.showReviewNotSaved();
                return;
            }
            pageletView?.showReviewSaveError(
                writeResult.userSafeMessage ??
                    pageletT("pagelet.trigger.writeFailed", locale),
                request.sourcePath,
            );
            new Notice(
                writeResult.userSafeMessage ??
                    pageletT("pagelet.trigger.writeFailed", locale),
                6000,
            );
        } catch (error) {
            this.host.log("Pagelet draft save failed", error);
            pageletView?.showReviewSaveError(
                pageletT("pagelet.mascot.error", locale),
                request.sourcePath,
            );
            new Notice(pageletT("pagelet.mascot.error", locale), 6000);
        }
    }

    // ── Private helpers ──────────────────────────────────────────────────

    private getPageletLocale(): "zh" | "en" {
        return getPageletUiLanguage();
    }

    private reservePageletReview(locale: "zh" | "en"): boolean {
        if (this.pageletReviewInFlight) {
            new Notice(pageletT("pagelet.trigger.alreadyRunning", locale), 2500);
            return false;
        }
        this.pageletReviewInFlight = true;
        return true;
    }

    private async createPageletScopePlan(
        range: PageletReviewRange,
        anchor: TFile,
    ): Promise<PageletScopePlan> {
        return buildPageletScopePlan({
            files: this.host.app.vault.getMarkdownFiles(),
            activePath: anchor.path,
            range,
            reviewsFolder: this.host.settings.pagelet.reviewsFolder,
            reviewOutputCount:
                range === "current" ? 0 : await this.countPageletReviewOutputNotes(),
            getMetadata: (path) => this.getPageletScopeMetadata(path),
        });
    }

    private async countPageletReviewOutputNotes(): Promise<number> {
        const reviewsFolder = normalizePath(
            this.host.settings.pagelet.reviewsFolder,
        );
        try {
            const listing = await this.host.app.vault.adapter.list(reviewsFolder);
            return listing.files
                .filter((path) =>
                    normalizePath(path).toLowerCase().endsWith(".md"),
                )
                .length;
        } catch {
            return 0;
        }
    }

    private resolvePageletAnchorMarkdownFile(path?: string): TFile | null {
        if (!path) return null;
        const abstractFile = this.host.app.vault.getAbstractFileByPath(
            normalizePath(path),
        );
        if (
            abstractFile instanceof TFile &&
            abstractFile.extension.toLowerCase() === "md"
        ) {
            return abstractFile;
        }
        return null;
    }

    private getPageletScopeMetadata(
        path: string,
    ): PageletScopeMetadataLike | undefined {
        const file = this.resolvePageletAnchorMarkdownFile(path);
        if (!file) return undefined;
        const cache = this.host.app.metadataCache.getFileCache(file);
        return {
            frontmatter: cache?.frontmatter,
            tags: cache?.tags,
        };
    }

    private async readPageletScopeEntries(
        files: readonly TFile[],
    ): Promise<Array<{ path: string; content: string }>> {
        const entries: Array<{ path: string; content: string }> = [];
        const maxChars = Math.max(
            1,
            Math.floor(this.host.settings.pagelet.maxInputTokens || 1) *
                PAGELET_APPROX_CHARS_PER_TOKEN,
        );
        let remaining = maxChars;
        const multiNote = files.length > 1;
        for (const file of files) {
            const prefixLength = multiNote
                ? `Source note: ${file.path}\n`.length
                : 0;
            if (remaining <= prefixLength) break;
            const content = await this.host.app.vault.cachedRead(file);
            const trimmedLength = content.trim().length;
            entries.push({ path: file.path, content });
            if (trimmedLength > 0) {
                remaining -= Math.min(remaining, trimmedLength + prefixLength);
            }
            if (remaining <= 0) break;
        }
        return entries;
    }

    private resolvePageletScopeFiles(
        selection: PageletScopeSelection,
    ): TFile[] {
        const files: TFile[] = [];
        for (const path of selection.paths) {
            const abstractFile = this.host.app.vault.getAbstractFileByPath(
                normalizePath(path),
            );
            if (
                abstractFile instanceof TFile &&
                abstractFile.extension.toLowerCase() === "md"
            ) {
                files.push(abstractFile);
            }
        }
        return files;
    }

    private getStrictActivePageletMarkdownView(): MarkdownView | null {
        const activeMarkdownView =
            this.host.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeMarkdownView || !isPageletEligibleView(activeMarkdownView))
            return null;
        return activeMarkdownView;
    }

    private getPageletAnchorMarkdownFile(): TFile | null {
        const strictView = this.getStrictActivePageletMarkdownView();
        if (strictView?.file instanceof TFile) return strictView.file;

        const mostRecentLeaf =
            this.host.app.workspace.getMostRecentLeaf?.();
        const mostRecentView = mostRecentLeaf?.view;
        if (
            mostRecentView instanceof MarkdownView &&
            isPageletEligibleView(mostRecentView) &&
            mostRecentView.file instanceof TFile
        ) {
            return mostRecentView.file;
        }

        for (const leaf of this.host.app.workspace.getLeavesOfType(
            "markdown",
        )) {
            const view = leaf.view as
                | (MarkdownView & { file?: TFile | null })
                | undefined;
            if (view?.file instanceof TFile) return view.file;
        }
        return null;
    }

    private formatPageletReviewProgress(
        event: PageletReviewProgressEvent,
        locale: "zh" | "en",
    ): string {
        const PHASE_STEP: Record<string, number> = {
            cost_precheck: 1,
            rate_limit: 2,
            model_setup: 3,
            structured_attempt: 4,
            json_mode_attempt: 5,
            json_mode_fallback: 6,
        };
        const step = PHASE_STEP[event.phase] ?? 4;
        const prefix = `[${step}/6] `;
        switch (event.phase) {
            case "cost_precheck":
                return (
                    prefix +
                    pageletT("pagelet.panel.status.checkingLimits", locale)
                );
            case "rate_limit":
                return (
                    prefix +
                    pageletT(
                        "pagelet.panel.status.checkingRateLimit",
                        locale,
                    )
                );
            case "model_setup":
                return (
                    prefix +
                    pageletT(
                        "pagelet.panel.status.settingUpModel",
                        locale,
                    )
                );
            case "structured_attempt":
                return (
                    prefix +
                    pageletT(
                        "pagelet.panel.status.generatingAttempt",
                        locale,
                        {
                            attempt: event.attempt ?? 1,
                            max: event.maxAttempts ?? 1,
                        },
                    )
                );
            case "json_mode_attempt":
                return (
                    prefix +
                    pageletT(
                        "pagelet.panel.status.generatingFallbackAttempt",
                        locale,
                        {
                            attempt: event.attempt ?? 1,
                            max: event.maxAttempts ?? 1,
                        },
                    )
                );
            case "json_mode_fallback":
                return (
                    prefix +
                    pageletT(
                        "pagelet.panel.status.generatingFallback",
                        locale,
                    )
                );
            default:
                return prefix + event.phase;
        }
    }

    private logPageletReviewTiming(
        sourceLabel: string,
        options: {
            files: readonly TFile[];
            range: PageletReviewRange;
        },
        timings: readonly PageletReviewTimingEntry[],
        diagnostics:
            | {
                  timings?: readonly PageletReviewTimingEntry[];
                  elapsedMs?: number;
                  totalElapsedMs?: number;
                  attempts?: number;
                  path?: string;
              }
            | undefined,
        startedAt: number,
        stage = "final",
    ): void {
        this.host.log("Pagelet review timing", {
            stage,
            sourceLabel,
            range: options.range,
            fileCount: options.files.length,
            totalElapsedMs: Math.max(0, Date.now() - startedAt),
            llmElapsedMs: diagnostics?.elapsedMs,
            modelTotalElapsedMs: diagnostics?.totalElapsedMs,
            attempts: diagnostics?.attempts,
            path: diagnostics?.path,
            timings: diagnostics?.timings ?? timings,
        });
    }

    // ── Core review pipeline ─────────────────────────────────────────────

    private async runPageletReviewForFiles(options: {
        primaryFile: TFile;
        files: readonly TFile[];
        range: PageletReviewRange;
        abortOnActiveViewChange?: { view: MarkdownView; path: string };
    }): Promise<void> {
        const locale = this.getPageletLocale();
        const file = options.primaryFile;
        const pageletView = await this.host.activePageletView();
        const firstName =
            options.files[0]?.basename ?? options.files[0]?.path ?? "note";
        const sourceLabel =
            options.files.length === 1
                ? options.files[0].path
                : `${firstName} (+${options.files.length - 1})`;
        const runStartedAt = Date.now();
        const timings: PageletReviewTimingEntry[] = [];
        const abortController = new AbortController();
        const abortReview = (reason: "user" | "source_changed") => {
            abortController.abort(reason);
        };
        const recordTiming = (
            phase: string,
            startedAt: number,
            metadata?: Record<string, unknown>,
        ) => {
            timings.push({
                phase,
                elapsedMs: Math.max(0, Date.now() - startedAt),
                metadata: {
                    source: "plugin",
                    ...(metadata ?? {}),
                },
            });
        };
        const mergeOutcomeTimings = (diagnostics: {
            timings?: PageletReviewTimingEntry[];
        }) => {
            diagnostics.timings = [
                ...timings,
                ...(diagnostics.timings ?? []).filter(
                    (entry) =>
                        (entry.metadata as { source?: unknown } | undefined)
                            ?.source !== "plugin",
                ),
            ];
        };
        pageletView?.showReviewStarted(sourceLabel, {
            onCancel: () => abortReview("user"),
        });
        const abortIfSourceViewChanged = () => {
            if (!options.abortOnActiveViewChange) return;
            const currentView =
                this.host.app.workspace.getActiveViewOfType(MarkdownView);
            if (
                currentView !== options.abortOnActiveViewChange.view ||
                currentView.file?.path !==
                    options.abortOnActiveViewChange.path
            ) {
                abortReview("source_changed");
            }
        };
        // registerEvent: safety net — auto-cleanup on plugin unload.
        // offref in finally: eager cleanup when the review completes normally.
        const activeLeafRef = this.host.app.workspace.on(
            "active-leaf-change",
            abortIfSourceViewChanged,
        );
        this.host.registerEvent(activeLeafRef);
        const fileOpenRef = this.host.app.workspace.on(
            "file-open",
            abortIfSourceViewChanged,
        );
        this.host.registerEvent(fileOpenRef);
        const runtime = this.host.getOrCreatePageletRuntime();
        if (!runtime) {
            this.host.app.workspace.offref(activeLeafRef);
            this.host.app.workspace.offref(fileOpenRef);
            pageletView?.showReviewError(
                pageletT("pagelet.mascot.error", locale),
                file.path,
            );
            new Notice(pageletT("pagelet.mascot.error", locale), 3000);
            this.pageletReviewInFlight = false;
            return;
        }

        new Notice(pageletT("pagelet.mascot.thinking", locale), 2000);

        try {
            pageletView?.showReviewProgress(
                pageletT("pagelet.panel.status.reading", locale),
            );
            const readStartedAt = Date.now();
            const entries = await this.readPageletScopeEntries(options.files);
            recordTiming("read_scope_entries", readStartedAt, {
                requestedFileCount: options.files.length,
                loadedEntryCount: entries.length,
            });
            if (abortController.signal.aborted) {
                recordTiming("aborted", runStartedAt, {
                    reason: abortController.signal.reason ?? "user",
                });
                this.logPageletReviewTiming(
                    sourceLabel,
                    options,
                    timings,
                    undefined,
                    runStartedAt,
                );
                pageletView?.showReviewAborted(file.path);
                return;
            }
            pageletView?.showReviewProgress(
                pageletT("pagelet.panel.status.preparing", locale),
            );
            const bundleStartedAt = Date.now();
            const bundle = buildPageletScopeReviewBundle({
                entries,
                primarySourcePath: file.path,
                range: options.range,
                settings: this.host.settings.pagelet,
                uiLanguage: locale,
                targetSuggestionCount: Math.min(
                    PAGELET_DEFAULT_TARGET_SUGGESTIONS,
                    this.host.settings.previewLimits,
                ),
            });
            recordTiming("build_scope_bundle", bundleStartedAt, {
                hasBundle: Boolean(bundle),
                range: options.range,
            });
            if (abortController.signal.aborted) {
                recordTiming("aborted", runStartedAt, {
                    reason: abortController.signal.reason ?? "user",
                });
                this.logPageletReviewTiming(
                    sourceLabel,
                    options,
                    timings,
                    undefined,
                    runStartedAt,
                );
                pageletView?.showReviewAborted(file.path);
                return;
            }
            if (!bundle) {
                pageletView?.showReviewEmpty(file.path);
                new Notice(
                    pageletT("pagelet.trigger.emptyNote", locale),
                    3000,
                );
                return;
            }

            const pageletSettings = this.host.settings.pagelet;
            const reviewModel = new PageletReviewModel(
                (temperature, options) =>
                    this.host.createChatModel(temperature, {
                        modelName: options?.modelName,
                    }),
                {
                    temperature: pageletSettings.temperature,
                    modelName: this.host.settings.chatModelName,
                    costBudget: {
                        maxInputTokens: pageletSettings.maxInputTokens,
                        maxOutputTokens: pageletSettings.maxOutputTokens,
                    },
                    costTracker: this.host.pageletCostTracker,
                    rateLimiter: this.host.pageletRateLimiter,
                    providerForPricing: this.host.settings.aiProvider,
                    modelForPricing: this.host.settings.chatModelName,
                    userMessageLocale: locale,
                    reviewTimeoutMs: PAGELET_REVIEW_TIMEOUT_MS,
                    maxRetries: PAGELET_PRODUCTION_MAX_RETRIES,
                    onProgress: (event) => {
                        pageletView?.showReviewProgress(
                            this.formatPageletReviewProgress(event, locale),
                        );
                    },
                },
            );
            const llmStartedAt = Date.now();
            const outcome = await reviewModel.reviewNote(
                bundle.input,
                abortController.signal,
            );
            recordTiming("llm_review", llmStartedAt, {
                status: outcome.status,
                path: outcome.diagnostics.path,
                attempts: outcome.diagnostics.attempts,
                modelElapsedMs: outcome.diagnostics.elapsedMs,
                timeoutMs: PAGELET_REVIEW_TIMEOUT_MS,
                maxRetries: PAGELET_PRODUCTION_MAX_RETRIES,
            });
            mergeOutcomeTimings(outcome.diagnostics);
            if (abortController.signal.aborted) {
                this.logPageletReviewTiming(
                    sourceLabel,
                    options,
                    timings,
                    outcome.diagnostics,
                    runStartedAt,
                );
                pageletView?.showReviewAborted(file.path);
                return;
            }
            if (outcome.status === "error") {
                this.logPageletReviewTiming(
                    sourceLabel,
                    options,
                    timings,
                    outcome.diagnostics,
                    runStartedAt,
                );
                pageletView?.showReviewError(
                    outcome.userMessage,
                    file.path,
                );
                new Notice(outcome.userMessage, 6000);
                return;
            }
            if (outcome.status === "empty") {
                this.logPageletReviewTiming(
                    sourceLabel,
                    options,
                    timings,
                    outcome.diagnostics,
                    runStartedAt,
                );
                pageletView?.showReviewEmpty(file.path);
                new Notice(
                    pageletT("pagelet.trigger.noSuggestions", locale),
                    4000,
                );
                return;
            }
            if (abortController.signal.aborted) {
                pageletView?.showReviewAborted(file.path);
                return;
            }

            const date = new Date();
            const targetPathStartedAt = Date.now();
            const targetPath = await mintNonCollidingReviewNotePath({
                adapter: this.host.app.vault.adapter,
                sourcePath: file.path,
                settings: pageletSettings,
                date,
            });
            recordTiming("mint_target_path", targetPathStartedAt, {
                targetPath,
            });
            mergeOutcomeTimings(outcome.diagnostics);
            this.logPageletReviewTiming(
                sourceLabel,
                options,
                timings,
                outcome.diagnostics,
                runStartedAt,
                "suggestions_ready",
            );
            pageletView?.showReviewResult({
                sourcePath: bundle.sourceLabel,
                primarySourcePath: file.path,
                targetPath,
                result: outcome.result,
                diagnostics: outcome.diagnostics,
                costSummary: this.host.pageletCostTracker.getSummary(),
                detectedLanguage: bundle.detectedLanguage,
                mode: bundle.input.mode,
                sourceReferences: bundle.sourceReferences,
                sourcePaths: bundle.sourcePaths,
            });
        } catch (error) {
            if (abortController.signal.aborted) {
                recordTiming("aborted", runStartedAt, {
                    reason: abortController.signal.reason,
                });
                this.logPageletReviewTiming(
                    sourceLabel,
                    options,
                    timings,
                    undefined,
                    runStartedAt,
                );
                pageletView?.showReviewAborted(file.path);
                return;
            }
            this.host.log("Pagelet review failed", error);
            this.logPageletReviewTiming(
                sourceLabel,
                options,
                timings,
                undefined,
                runStartedAt,
            );
            pageletView?.showReviewError(
                pageletT("pagelet.mascot.error", locale),
                file.path,
            );
            new Notice(pageletT("pagelet.mascot.error", locale), 6000);
        } finally {
            this.host.app.workspace.offref(activeLeafRef);
            this.host.app.workspace.offref(fileOpenRef);
            this.pageletReviewInFlight = false;
            if (abortController.signal.aborted) {
                void this.refreshPageletScope(options.range);
            }
        }
    }
}
