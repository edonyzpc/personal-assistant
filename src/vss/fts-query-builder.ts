import { buildCharPhraseFtsQuery } from "./lexical-normalizer.ts";
import type { RetrievalQueryMode } from "./retrieval-calibration.ts";

/**
 * Build a FTS5 MATCH expression from a raw query string.
 * Uses the exact versioned CHAR-PHRASE transform shared with the lexical index.
 * When grapheme segmentation is unavailable the caller treats the lexical leg
 * as unavailable and continues through vector retrieval.
 */
export function buildFtsQuery(
    query: string,
    mode: RetrievalQueryMode = "strict_AND",
): string | null {
    return buildCharPhraseFtsQuery(query, mode);
}
