/* Copyright 2023 edonyzpc */

/**
 * Pagelet v2 — Write Action types for Operations Agent mode (Phase 4).
 *
 * Defines the action discriminated union and result shape for write
 * operations that go through the PageletActionExecutor. These actions
 * sit on top of the Write Action Framework v1 (D025, D030) but are
 * managed independently — see `docs/pagelet-v2-product-design.md`
 * §Phase 4 for the product boundary.
 *
 * Three action families:
 *   - append-to-daily: Append content to a daily note.
 *   - apply-suggestion: Replace text in a source note (diff-style).
 *   - create-task: Create a Tasks-plugin-compatible task entry.
 */

import type { TFile } from "obsidian";

// ---------------------------------------------------------------------------
// Action type discriminant
// ---------------------------------------------------------------------------

export type PageletActionType = "append-to-daily" | "apply-suggestion" | "create-task";

// ---------------------------------------------------------------------------
// Individual action shapes
// ---------------------------------------------------------------------------

/** Append free-form content to a daily note. */
export interface AppendToDailyAction {
    type: "append-to-daily";
    /** Markdown content to append. */
    content: string;
    /** Target date in YYYY-MM-DD format. Defaults to today when omitted. */
    targetDate?: string;
}

/** Apply a text replacement suggestion back to a source note. */
export interface ApplySuggestionAction {
    type: "apply-suggestion";
    /** The file containing the text to replace. */
    sourceFile: TFile;
    /** Exact text span to find in the source file. */
    originalText: string;
    /** Replacement text. */
    suggestedText: string;
}

/** Create a task entry in a target file (or daily note as fallback). */
export interface CreateTaskAction {
    type: "create-task";
    /** Human-readable task description. */
    taskText: string;
    /** Optional due date in YYYY-MM-DD format. */
    dueDate?: string;
    /** File to append the task to. Defaults to the daily note when omitted. */
    targetFile?: TFile;
}

// ---------------------------------------------------------------------------
// Union + result
// ---------------------------------------------------------------------------

/** Discriminated union of all pagelet write actions. */
export type PageletAction = AppendToDailyAction | ApplySuggestionAction | CreateTaskAction;

/** Outcome of executing a pagelet write action. */
export interface ActionResult {
    /** Whether the write succeeded. */
    success: boolean;
    /** Vault-relative path of the file that was written (on success). */
    filePath?: string;
    /** Error message (on failure). */
    error?: string;
}
