/* Copyright 2023 edonyzpc */

/**
 * Pagelet — output module types.
 *
 * Defines the data shapes for generated Pagelet review notes routed through
 * the write framework.
 *
 * Design references:
 *  - `docs/product/pagelet-product-design.md` §Review Note Output
 *  - `docs/development/workflows/pagelet-sdd-guide.md` §Review Note Output
 */

// ---------------------------------------------------------------------------
// Generator output
// ---------------------------------------------------------------------------

/** Re-exported from contracts for backward compatibility. */
export type { GeneratedReviewNote } from "../../pa/contracts/generated-review-note";

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
