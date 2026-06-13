/* Copyright 2023 edonyzpc */

/**
 * Pagelet -- research module barrel exports.
 *
 * Re-exports the "Research this finding" action components:
 *  - Types: ResearchRequest, ResearchResult, ResearchFinding, ResearchCallbacks
 *  - ResearchManager: builds research prompts and routes to Chat view
 */

export { ResearchManager } from "./ResearchManager";
export type {
    ResearchCallbacks,
    ResearchFinding,
    ResearchRequest,
    ResearchResult,
} from "./types";
