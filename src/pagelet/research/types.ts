/* Copyright 2023 edonyzpc */

/**
 * Pagelet -- research module types.
 *
 * Defines the data shapes for the "Research this finding" action that
 * prepares a web-research prompt and routes it to the Chat view.
 *
 * The research flow is a prompt-preparation feature, not a full search
 * engine. It mirrors the research prompt pattern but operates on
 * Panel findings instead of PageletSuggestion objects.
 *
 * Design references:
 *  - `docs/pagelet-product-design.md` -- WebSearch off until clicked
 *  - `src/pagelet/orchestrator.ts` -- research prompt pattern
 *  - `src/locales/pagelet/{en,zh}.json` -- `pagelet.research.prompt.*` keys
 */

// ---------------------------------------------------------------------------
// Research request -- what the caller passes in
// ---------------------------------------------------------------------------

/** Input for a single research action on a finding. */
export interface ResearchRequest {
    /** The finding text to research (e.g., a suggestion or insight). */
    findingText: string;
    /** Vault-relative path of the source note, if available. */
    sourceFile?: string;
    /** Display title of the source note, if available. */
    sourceTitle?: string;
}

// ---------------------------------------------------------------------------
// Research result -- returned after research completes
// ---------------------------------------------------------------------------

/** Aggregated result from a research action. */
export interface ResearchResult {
    /** The search query / prompt that was used. */
    query: string;
    /** Individual findings from the research. */
    findings: ResearchFinding[];
    /** Unix timestamp (ms) when the research completed. */
    timestamp: number;
}

/** A single piece of external evidence from research. */
export interface ResearchFinding {
    /** Title or headline of the finding. */
    title: string;
    /** Brief excerpt or summary. */
    snippet: string;
    /** Source URL, if available. */
    url?: string;
    /** How relevant this finding is to the original request. */
    relevance: "high" | "medium" | "low";
}

// ---------------------------------------------------------------------------
// Callbacks -- wired by the orchestrator
// ---------------------------------------------------------------------------

/** Callbacks for research lifecycle events. */
export interface ResearchCallbacks {
    /** Called when research completes successfully. */
    onResearchComplete: (result: ResearchResult) => void;
    /** Called when research encounters an error. */
    onResearchError: (error: Error) => void;
}
