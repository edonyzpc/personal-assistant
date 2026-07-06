/* Copyright 2023 edonyzpc */

/**
 * ReviewNoteSaveFlow -- owns the "save findings as review note" lifecycle.
 *
 * Extracted from {@link PageletOrchestrator} so note-persistence logic
 * does not pollute the main coordination layer.
 */

import { Notice } from "obsidian";
import type { App } from "obsidian";

import { getPageletUiLanguage, pageletT } from "../locales/pagelet";

import type { PanelFinding, PanelLayoutType } from "./panel/types";
import type { GeneratedReviewNote, WriteResult } from "./output/types";
import {
    assembleReviewNote,
    buildReviewMetadata,
    formatPageletDate,
    formatPageletIsoTimestamp,
} from "./pa-review-file-io";
import { PAGELET_SCHEMA_VERSION, type PageletReviewResult } from "./pa-review-schemas";

// ---------------------------------------------------------------------------
// Host interface
// ---------------------------------------------------------------------------

/**
 * Narrow callback surface for the save flow.
 * The orchestrator (or any future caller) implements this.
 */
export interface ReviewNoteSaveHost {
    readonly app: App;

    readonly settings: {
        pagelet: {
            reviewsFolder: string;
        };
    };

    log(message: string, ...args: unknown[]): void;
    writeReviewNote(note: GeneratedReviewNote): Promise<WriteResult>;
}

// ---------------------------------------------------------------------------
// Callbacks the save flow fires back at the orchestrator
// ---------------------------------------------------------------------------

/** Subset of PetEvent that the save flow uses. */
type SaveFlowPetEvent = "analysis-start" | "analysis-done";

export interface ReviewNoteSaveCallbacks {
    /** Transition the Pet state machine (e.g. "analysis-start"). */
    petTransition(event: SaveFlowPetEvent): void;
    /** Flash an error indicator on the Pet. */
    petFlashError(): void;
    /** Close the panel after a successful write. */
    closePanel(): void;
    /** Get the current analysis source path (for stale-guard). */
    getAnalysisSourcePath(): string | null;
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

export class ReviewNoteSaveFlow {
    private saveInProgress = false;
    private pendingReviewNote: GeneratedReviewNote | null = null;

    constructor(
        private readonly host: ReviewNoteSaveHost,
        private readonly callbacks: ReviewNoteSaveCallbacks,
    ) {}

    // ======================================================================
    // Public accessors
    // ======================================================================

    get isSaveInProgress(): boolean {
        return this.saveInProgress;
    }

    get pending(): GeneratedReviewNote | null {
        return this.pendingReviewNote;
    }

    setPending(note: GeneratedReviewNote | null): void {
        this.pendingReviewNote = note;
    }

    clearPending(): void {
        this.pendingReviewNote = null;
    }

    // ======================================================================
    // Main save entry point
    // ======================================================================

    async saveFindingsAsReviewNote(
        findings: PanelFinding[],
        currentPanelLayout: PanelLayoutType | null,
    ): Promise<void> {
        if (this.saveInProgress) {
            new Notice(this.t("pagelet.panel.status.saving"), 3000);
            return;
        }
        this.saveInProgress = true;

        // If we have a pre-generated review note, write it directly.
        if (currentPanelLayout === "summary" && this.pendingReviewNote) {
            this.callbacks.petTransition("analysis-start");
            try {
                const result = await this.host.writeReviewNote(this.pendingReviewNote);
                this.callbacks.petTransition("analysis-done");
                if (result.success) {
                    this.pendingReviewNote = null;
                    this.callbacks.closePanel();
                    new Notice(this.t("pagelet.reviewNote.created", { path: result.filePath ?? "" }), 5000);
                } else {
                    new Notice(this.t("pagelet.reviewNote.createFailed", { error: result.error ?? "" }), 5000);
                    this.callbacks.petFlashError();
                }
            } catch (error) {
                this.callbacks.petTransition("analysis-done");
                this.callbacks.petFlashError();
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

        this.callbacks.petTransition("analysis-start");

        try {
            const s = this.host.settings.pagelet;
            const now = new Date();
            const activeFile = this.host.app.workspace.getActiveFile?.();
            const layout = currentPanelLayout ?? "review";

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

            this.callbacks.petTransition("analysis-done");
            if (result.success) {
                this.callbacks.closePanel();
                new Notice(this.t("pagelet.reviewNote.created", { path: result.filePath ?? "" }), 5000);
            } else {
                new Notice(this.t("pagelet.reviewNote.failed", { error: result.error ?? "" }), 5000);
                this.callbacks.petFlashError();
            }
        } catch (error) {
            this.callbacks.petTransition("analysis-done");
            this.callbacks.petFlashError();
            this.host.log("Save findings failed", error);
        } finally {
            this.saveInProgress = false;
        }
    }

    // ======================================================================
    // Markdown builders
    // ======================================================================

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

    private resolveReviewSourcePath(findings: PanelFinding[], activePath?: string): string {
        const active = activePath ?? null;
        const analysisSourcePath = this.callbacks.getAnalysisSourcePath();
        if (analysisSourcePath && active === analysisSourcePath) {
            return analysisSourcePath;
        }
        return findings.find((finding) => finding.sourceFile)?.sourceFile
            ?? activePath
            ?? "pagelet";
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

    // ======================================================================
    // Private helpers
    // ======================================================================

    private t(key: string, params?: Readonly<Record<string, string | number>>): string {
        return pageletT(key, getPageletUiLanguage(), params);
    }
}
