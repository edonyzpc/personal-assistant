/**
 * Barrel re-export for the chat-tools module.
 *
 * The original 3043-line monolith has been split into six sub-modules
 * (see docs/sdd-chat-tools-split.md). External consumers continue to import
 * public registry, factories, types, and result guards from `"./chat-tools"`.
 * Internal vault I/O and parser helpers stay in their implementation modules.
 *
 * Do NOT add new logic here. Place it in the appropriate sub-module:
 *   - chat-tool-types.ts       (A) types, OBSIDIAN_OPERATIONS_V1A_* policy
 *   - chat-tool-constants.ts   (B) numeric/string budget constants
 *   - chat-tool-execution-helpers.ts (E) vault I/O, parsers, *Like shapes
 *   - chat-tool-guards.ts      (F) type guards + validators + isChatToolName
 *   - chat-tool-registry.ts    (C) ToolRegistry + budget enforcement
 *   - chat-tool-factories.ts   (D) 9 create*Tool factories + alias normalizers
 */

export * from "./chat-tool-types";
export * from "./chat-tool-registry";
export * from "./chat-tool-factories";
export {
    isChatToolName,
    isCurrentNoteContextResult,
    isInspectObsidianNoteResult,
    isListRecentNotesResult,
    isReadCanvasSummaryResult,
    isReadNoteOutlineResult,
    isSearchMemoryResult,
    isSearchVaultMetadataResult,
    isVaultSnippetSearchResult,
    isVaultTagsResult,
} from "./chat-tool-guards";
