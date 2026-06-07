/**
 * Numeric / string constants used across chat-tool sub-modules.
 *
 * Moved here from the original chat-tools.ts monolith as part of Phase 3.1
 * (docs/archive/sdd-chat-tools-split.md). Leaf module — zero internal dependencies.
 */

export const CURRENT_NOTE_CONTENT_BUDGET_CHARS = 3000;
export const CURRENT_NOTE_FULL_CONTENT_BUDGET_CHARS = 8000;
export const CURRENT_NOTE_MAX_HEADINGS = 30;
export const CURRENT_NOTE_NEARBY_RADIUS_LINES = 12;
export const CURRENT_NOTE_HEADING_SCAN_LINES = 200;
export const CURRENT_NOTE_OUTLINE_SCAN_LINES = 5000;
export const VAULT_METADATA_DEFAULT_LIMIT = 8;
export const VAULT_METADATA_MAX_LIMIT = 12;
export const RECENT_NOTES_DEFAULT_LIMIT = 8;
export const RECENT_NOTES_MAX_LIMIT = 20;
export const NOTE_OUTLINE_DEFAULT_HEADINGS = 30;
export const NOTE_OUTLINE_MAX_HEADINGS = 50;
export const NOTE_OUTLINE_SCAN_LINES = 5000;
export const VAULT_METADATA_QUERY_MAX_CHARS = 240;
export const NOTE_OUTLINE_PATH_MAX_CHARS = 1024;
export const FRONTMATTER_PREVIEW_MAX_KEYS = 8;
export const FRONTMATTER_VALUE_MAX_CHARS = 120;
export const OBSIDIAN_TARGET_PATH_MAX_CHARS = 1024;
export const INSPECT_NOTE_MAX_PROPERTIES = 16;
export const INSPECT_NOTE_MAX_TAGS = 40;
export const INSPECT_NOTE_MAX_HEADINGS = 50;
export const INSPECT_NOTE_MAX_TASKS = 40;
export const INSPECT_NOTE_MAX_CALLOUTS = 20;
export const INSPECT_NOTE_MAX_LINKS = 60;
export const INSPECT_NOTE_SCAN_LINES = 5000;
export const INSPECT_NOTE_MAX_READ_BYTES = 300_000;
export const CANVAS_MAX_DUPLICATE_IDS = 20;
export const CANVAS_MAX_DANGLING_EDGES = 30;
export const CANVAS_MAX_ISOLATED_NODES = 40;
export const CANVAS_MAX_GROUPS = 30;
export const CANVAS_MAX_SNIPPETS = 24;
export const CANVAS_SNIPPET_MAX_CHARS = 180;
export const CANVAS_MAX_READ_BYTES = 300_000;
export const SNIPPET_QUERY_MAX_CHARS = 160;
export const SNIPPET_DEFAULT_LIMIT = 5;
export const SNIPPET_MAX_LIMIT = 10;
export const SNIPPET_MAX_CANDIDATE_FILES = 400;
export const SNIPPET_MAX_FILES = 80;
export const SNIPPET_MAX_BYTES = 300_000;
export const SNIPPET_MAX_FILE_BYTES = 100_000;
export const SNIPPET_CONTEXT_CHARS = 80;
export const SNIPPET_MAX_CHARS = 260;
export const TAGS_DEFAULT_LIMIT = 40;
export const TAGS_MAX_LIMIT = 80;
export const TAG_REPRESENTATIVE_PATHS = 3;
export const TAGS_SCAN_MAX_FILES = 3000;
// P0-B yield cadence — pi pattern: cooperative yield + abort check every N synchronous iterations
// of a potentially long loop. 2048 keeps overhead negligible (≈1-2 yields per full TAGS_SCAN_MAX_FILES
// scan) while bounding worst-case main-thread occupancy well within a 16ms frame budget.
export const TAGS_SCAN_YIELD_INTERVAL = 2048;
export const METADATA_CACHE_UNAVAILABLE_SOURCE = "metadata cache";
export const VAULT_FILE_READ_UNAVAILABLE_SOURCE = "vault file read";
export const VAULT_FILE_READ_SKIPPED_SIZE_SOURCE = "vault file read skipped for size";
export const SNIPPET_SCOPE_UNAVAILABLE_SOURCE = "snippet scope not found";
export const SNIPPET_SCOPE_UNSUPPORTED_SOURCE = "unsupported snippet scope";
export const TOOL_VALIDATION_INPUT_SUMMARY_CHARS = 512;
