/* Copyright 2023 edonyzpc */

/**
 * Pagelet — output module types.
 *
 * Defines the data shapes for the Periodic Summary (Scenario 4) pipeline:
 *   PeriodicSummaryInput  -> ReviewNoteGenerator -> GeneratedReviewNote
 *   GeneratedReviewNote   -> framework writer    -> WriteResult
 *
 * Design references:
 *  - `docs/pagelet-product-design.md` §Review Note Output
 *  - `docs/pagelet-sdd-guide.md` §Review Note Output
 *  - `docs/pagelet-product-design.md` §Periodic Summary Output
 */

import type { TFile } from "obsidian";

// ---------------------------------------------------------------------------
// Generator input
// ---------------------------------------------------------------------------

/** Input for generating a periodic summary review note (Scenario 4). */
export interface PeriodicSummaryInput {
    /** Files included in the summary scope. */
    files: TFile[];
    /** Human-readable time range (e.g., "2026-06-03 to 2026-06-10"). */
    rangeDescription: string;
    /** Scope in days (3, 7, or 14). */
    scopeDays: number;
    /** Optional VSS-discovered related notes for cross-note context enrichment. */
    relatedNotes?: Array<{ path: string; content: string }>;
}

// ---------------------------------------------------------------------------
// Generator output
// ---------------------------------------------------------------------------

/** Re-exported from contracts for backward compatibility. */
export type { GeneratedReviewNote } from "../../pa/contracts/generated-review-note";

// ---------------------------------------------------------------------------
// AI callback
// ---------------------------------------------------------------------------

/**
 * Callback for AI generation — injected by the caller so the output module
 * stays decoupled from the LLM provider / LangChain dependency tree.
 *
 * The caller (e.g., orchestrator or runtime) is responsible for constructing
 * the underlying chat model and wiring cost / rate-limit gates before
 * invoking the generator.
 */
export type GenerateCallback = (
    prompt: string,
    noteContents: Array<{ path: string; content: string }>,
    tokenBudget: { input: number; output: number },
) => Promise<{ text: string; tokenCost: { input: number; output: number } }>;

// ---------------------------------------------------------------------------
// Writer result
// ---------------------------------------------------------------------------

/** Result of writing a review note to the vault. */
export interface WriteResult {
    /** Whether the write succeeded. */
    success: boolean;
    /** Final vault-relative path the note was written to (on success). */
    filePath?: string;
    /** Error message (on failure). */
    error?: string;
}
