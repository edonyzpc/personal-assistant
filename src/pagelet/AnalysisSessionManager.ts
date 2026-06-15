/* Copyright 2023 edonyzpc */

/**
 * AnalysisSessionManager -- owns the foreground review lifecycle,
 * scope-plan resolution, and analysis-session state.
 *
 * Extracted from {@link PageletOrchestrator} to separate analysis
 * coordination from UI wiring.  Communicates back to the orchestrator
 * through a narrow {@link AnalysisSessionHost} callback interface.
 */

import { Notice } from "obsidian";
import type { App, TFile } from "obsidian";

import { getPageletUiLanguage, pageletT } from "../locales/pagelet";

import type { PanelFinding, PanelLayoutType, PanelOpenExtra, PanelScopeState } from "./panel/types";
import type { PreloadFinding } from "./preload/types";
import { PreloadBudget } from "./preload/PreloadBudget";
import {
    applyPageletScopeToggle,
    buildPageletScopePlan,
    selectPageletScope,
    type PageletReviewRange,
    type PageletScopePlan,
} from "./scope";

// ---------------------------------------------------------------------------
// Host interface -- narrow subset the manager needs from the orchestrator
// ---------------------------------------------------------------------------

/**
 * Callback surface the AnalysisSessionManager uses to drive the
 * orchestrator's remaining responsibilities (Pet transitions, Panel
 * updates, LLM invocations).
 */
export interface AnalysisSessionHost {
    readonly app: App;

    readonly settings: {
        pagelet: {
            foregroundPerHourCap: number;
            foregroundPerDayCap: number;
            maxInputTokens: number;
            maxOutputTokens: number;
            reviewsFolder: string;
            excludedFolders: string[];
            excludedTags: string[];
            excludedPatterns: string[];
        };
    };

    log(message: string, ...args: unknown[]): void;

    createForegroundAnalyzeCallback(): (
        files: TFile[],
        config: {
            enabled: boolean;
            intervalMinutes: number;
            perHourCap: number;
            perDayCap: number;
            tokenBudget: { input: number; output: number };
            range: PageletReviewRange;
        },
    ) => Promise<{
        findings: PreloadFinding[];
        analyzedFiles: string[];
        analyzedAt: number;
        tokenCost: { input: number; output: number };
    }>;
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class AnalysisSessionManager {
    // -- analysis session state -------------------------------------------------
    private lastAnalysisFindings: PanelFinding[] = [];
    private lastAnalysisSourcePath: string | null = null;
    private currentScopeRange: PageletReviewRange = "current";
    private currentScopePlan: PageletScopePlan | null = null;

    // -- foreground run guard ---------------------------------------------------
    private foregroundRunInProgress = false;
    private foregroundRunSeq = 0;
    private readonly foregroundBudget: PreloadBudget;

    constructor(
        private readonly host: AnalysisSessionHost,
        foregroundBudget: PreloadBudget,
    ) {
        this.foregroundBudget = foregroundBudget;
    }

    // ======================================================================
    // Accessors for orchestrator
    // ======================================================================

    get isForegroundRunInProgress(): boolean {
        return this.foregroundRunInProgress;
    }

    get scopeRange(): PageletReviewRange {
        return this.currentScopeRange;
    }

    set scopeRange(value: PageletReviewRange) {
        this.currentScopeRange = value;
    }

    // ======================================================================
    // Foreground run lifecycle
    // ======================================================================

    beginForegroundReviewRun(): boolean {
        if (this.foregroundRunInProgress) {
            new Notice(this.t("pagelet.notice.alreadyReviewing"), 4000);
            return false;
        }
        if (!this.reserveForegroundReviewCall()) return false;
        this.foregroundRunInProgress = true;
        return true;
    }

    finishForegroundReviewRun(): void {
        this.foregroundRunInProgress = false;
    }

    // ======================================================================
    // Core analysis flow
    // ======================================================================

    /**
     * Run foreground analysis on one or more files.
     *
     * Returns the panel-ready findings on success, or `null` when the
     * run was stale / superseded / destroyed.
     */
    async analyzeFiles(
        files: TFile[],
        options: {
            range: PageletReviewRange;
            expectedActivePath?: string;
        },
        destroyed: () => boolean,
    ): Promise<{
        findings: PanelFinding[];
        rawFindings: PreloadFinding[];
    } | null> {
        if (files.length === 0) return null;

        const runSeq = ++this.foregroundRunSeq;

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

        if (destroyed() || runSeq !== this.foregroundRunSeq) return null;
        if (
            options.expectedActivePath
            && this.host.app.workspace.getActiveFile?.()?.path !== options.expectedActivePath
        ) {
            this.host.log("Discarded stale Pagelet foreground result", {
                expectedActivePath: options.expectedActivePath,
                activePath: this.host.app.workspace.getActiveFile?.()?.path ?? null,
            });
            this.clearAnalysisSession();
            return null;
        }

        // Cache results for Panel data flow.
        this.lastAnalysisSourcePath = options.expectedActivePath ?? files[0]?.path ?? null;
        this.lastAnalysisFindings = this.toPanelFindings(result.findings);

        return {
            findings: this.lastAnalysisFindings,
            rawFindings: result.findings,
        };
    }

    // ======================================================================
    // Scope plan
    // ======================================================================

    ensureScopePlan(): PageletScopePlan | null {
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

    buildScopePlan(range: PageletReviewRange): PageletScopePlan | null {
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

    invalidateScopePlan(): void {
        this.currentScopePlan = null;
    }

    handleScopeRangeChange(range: PageletReviewRange): void {
        this.currentScopeRange = range;
        this.currentScopePlan = this.buildScopePlan(range);
        this.clearAnalysisSession();
    }

    handleScopeCandidateToggle(path: string, included: boolean): void {
        const plan = this.ensureScopePlan();
        if (!plan) return;
        this.currentScopePlan = applyPageletScopeToggle(plan, path, included);
        this.clearAnalysisSession();
    }

    // ======================================================================
    // Panel helpers
    // ======================================================================

    panelExtraForLayout(layoutType: PanelLayoutType): PanelOpenExtra | undefined {
        if (layoutType !== "review") return undefined;
        const plan = this.ensureScopePlan();
        if (!plan) return undefined;
        return { scope: this.toPanelScope(plan) };
    }

    defaultReviewPanelFindings(currentPanelLayout: PanelLayoutType | null): PanelFinding[] {
        const current = currentPanelLayout === "review" ? this.currentAnalysisFindings() : [];
        if (current.length > 0) return current;
        return [];
    }

    toPanelFindings(findings: PreloadFinding[]): PanelFinding[] {
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

    // ======================================================================
    // Session state
    // ======================================================================

    currentAnalysisFindings(): PanelFinding[] {
        const activePath = this.host.app.workspace.getActiveFile?.()?.path ?? null;
        if (!this.lastAnalysisSourcePath) return this.lastAnalysisFindings;
        return activePath === this.lastAnalysisSourcePath ? this.lastAnalysisFindings : [];
    }

    clearAnalysisSession(): void {
        this.lastAnalysisFindings = [];
        this.lastAnalysisSourcePath = null;
    }

    discardAnalysisSessionIfStale(activePath: string | null): boolean {
        if (!this.lastAnalysisSourcePath) return false;
        if (activePath === this.lastAnalysisSourcePath) return false;
        this.clearAnalysisSession();
        return true;
    }

    /** Update budget limits from settings. Called by syncSettings(). */
    syncBudget(): void {
        const s = this.host.settings.pagelet;
        this.foregroundBudget.updateLimits(s.foregroundPerHourCap, s.foregroundPerDayCap);
    }

    /**
     * The source path recorded for the last analysis run.
     * Used by the save flow to guard against stale saves.
     */
    get analysisSourcePath(): string | null {
        return this.lastAnalysisSourcePath;
    }

    // ======================================================================
    // Private helpers
    // ======================================================================

    private t(key: string, params?: Readonly<Record<string, string | number>>): string {
        return pageletT(key, getPageletUiLanguage(), params);
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
}

function displayFileName(path: string): string {
    return path.split("/").pop()?.replace(/\.md$/i, "") || path;
}
