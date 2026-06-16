/* Copyright 2023 edonyzpc */

/**
 * PeriodicSummaryFlow -- owns the Scenario 4 periodic summary lifecycle.
 *
 * Extracted from {@link PageletOrchestrator} so the multi-step
 * scope -> generate -> preview pipeline does not pollute the main
 * coordination layer.
 */

import { Notice } from "obsidian";

import { getPageletUiLanguage, pageletT } from "../locales/pagelet";

import type { PanelFinding } from "./panel/types";
import { ReviewNoteGenerator } from "./output/ReviewNoteGenerator";
import { formatPageletDate } from "./pa-review-file-io";
import type { ScopeResolver } from "./scope/ScopeResolver";
import type { PageletHost } from "./PageletHost";

// ---------------------------------------------------------------------------
// Callbacks the flow fires back at the orchestrator
// ---------------------------------------------------------------------------

export interface PeriodicSummaryCallbacks {
    /** Transition the Pet state machine. */
    petTransition(event: "analysis-start" | "analysis-done"): void;
    /** Flash an error on the Pet. */
    petFlashError(): void;
    /** Guard: begin a foreground review run (returns false if already in progress). */
    beginForegroundReviewRun(): boolean;
    /** Release the foreground run guard. */
    finishForegroundReviewRun(): void;
    /** Set the pending review note for later save. */
    setPendingNote(note: { fileName: string; markdown: string; targetFolder: string; targetPath: string; sources: string[]; tokenCost: { input: number; output: number } }): void;
    /** Open the Panel to show the summary preview. */
    openSummaryPanel(findings: PanelFinding[], extra: { markdown: string }): void;
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

export class PeriodicSummaryFlow {
    constructor(
        private readonly host: PageletHost,
        private readonly scopeResolver: ScopeResolver,
        private readonly callbacks: PeriodicSummaryCallbacks,
    ) {}

    /**
     * Run the periodic summary: scope -> generate -> preview in Panel.
     * The actual write happens when the user clicks "Save" in the Panel.
     */
    async run(): Promise<void> {
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

        if (!this.callbacks.beginForegroundReviewRun()) return;

        // 2. Show working state
        this.callbacks.petTransition("analysis-start");
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
                this.host.createGenerateCallback(),
                this.foregroundTokenBudget(),
            );

            // 4. Show preview in Panel instead of writing immediately
            this.callbacks.setPendingNote(note);
            this.callbacks.petTransition("analysis-done");
            this.callbacks.openSummaryPanel(
                [{ title: note.fileName, description: note.markdown }],
                { markdown: note.markdown },
            );

            // The actual write happens when user clicks "Save" in the Panel
            // (via onSaveAsReviewNote callback -> saveFindingsAsReviewNote)
        } catch (error) {
            this.callbacks.petTransition("analysis-done");
            this.callbacks.petFlashError();
            const msg = error instanceof Error ? error.message : String(error);
            new Notice(this.t("pagelet.periodicSummary.failedWithError", { error: msg }), 5000);
            this.host.log("Periodic summary error", error);
        } finally {
            this.callbacks.finishForegroundReviewRun();
        }
    }

    /** Token budget for the foreground LLM call. */
    foregroundTokenBudget(): { input: number; output: number } {
        const s = this.host.settings.pagelet;
        return {
            input: s.maxInputTokens,
            output: s.maxOutputTokens,
        };
    }

    // ======================================================================
    // Private
    // ======================================================================

    private t(key: string, params?: Readonly<Record<string, string | number>>): string {
        return pageletT(key, getPageletUiLanguage(), params);
    }
}
