/* Copyright 2023 edonyzpc */

/**
 * Pagelet v2 — output module barrel exports.
 *
 * Re-exports the Periodic Summary (Scenario 4) pipeline components:
 *  - Types: PeriodicSummaryInput, GeneratedReviewNote, GenerateCallback, WriteResult
 *  - ReviewNoteGenerator: generates a review note from scope-resolved files
 *  - ReviewNoteWriter: writes the generated note to the vault
 */

export { ReviewNoteGenerator } from "./ReviewNoteGenerator";
export { ReviewNoteWriter } from "./ReviewNoteWriter";
export type {
    GenerateCallback,
    GeneratedReviewNote,
    PeriodicSummaryInput,
    WriteResult,
} from "./types";
