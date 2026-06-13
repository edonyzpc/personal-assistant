/* Copyright 2023 edonyzpc */

/**
 * Pagelet — output module barrel exports.
 *
 * Re-exports the Periodic Summary (Scenario 4) pipeline components:
 *  - Types: PeriodicSummaryInput, GeneratedReviewNote, GenerateCallback, WriteResult
 *  - ReviewNoteGenerator: generates a review note from scope-resolved files
 */

export { ReviewNoteGenerator } from "./ReviewNoteGenerator";
export type {
    GenerateCallback,
    GeneratedReviewNote,
    PeriodicSummaryInput,
    WriteResult,
} from "./types";
