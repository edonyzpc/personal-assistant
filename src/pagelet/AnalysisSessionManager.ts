/* Copyright 2023 edonyzpc */

/**
 * AnalysisSessionManager -- owns the foreground review lifecycle,
 * scope-plan resolution, and analysis-session state.
 *
 * Extracted from {@link PageletOrchestrator} to separate analysis
 * coordination from UI wiring.  Communicates back to the orchestrator
 * through a narrow {@link AnalysisSessionHost} callback interface.
 */

import { Notice, TFile, type App } from "obsidian";

import { getPageletUiLanguage, pageletT } from "../locales/pagelet";

import type { PanelFinding, PanelLayoutType, PanelOpenExtra } from "./panel/types";
import type { PreloadFinding, PreloadResult } from "./preload/types";
import { PreloadBudget } from "./preload/PreloadBudget";
import type { PageletReviewRange } from "./scope";

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
    ) => Promise<PreloadResult>;
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class AnalysisSessionManager {
    // -- analysis session state -------------------------------------------------
    private lastAnalysisFindings: PanelFinding[] = [];
    private lastAnalysisSourcePath: string | null = null;
    private lastUsedGovernedMemoryClaimIds: string[] = [];

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

    // ======================================================================
    // Foreground run lifecycle
    // ======================================================================

    beginForegroundReviewRun(options: { reserveBudget?: boolean } = {}): boolean {
        if (this.foregroundRunInProgress) {
            new Notice(this.t("pagelet.notice.alreadyReviewing"), 4000);
            return false;
        }
        if (options.reserveBudget !== false && !this.reserveForegroundCall()) return false;
        this.foregroundRunInProgress = true;
        return true;
    }

    beginForegroundRouteRun(): void {
        this.foregroundRunInProgress = true;
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
        this.lastUsedGovernedMemoryClaimIds = Array.isArray(result.usedGovernedMemoryClaimIds)
            ? [...result.usedGovernedMemoryClaimIds]
            : [];

        return {
            findings: this.lastAnalysisFindings,
            rawFindings: result.findings,
        };
    }

    // ======================================================================
    // Panel helpers
    // ======================================================================

    panelExtraForLayout(layoutType: PanelLayoutType): PanelOpenExtra | undefined {
        if (layoutType !== "review") return undefined;
        return {
            usedGovernedMemoryClaimIds: [...this.lastUsedGovernedMemoryClaimIds],
        };
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
        this.lastUsedGovernedMemoryClaimIds = [];
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

    reserveForegroundCall(): boolean {
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

}
