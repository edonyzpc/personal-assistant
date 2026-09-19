/**
 * 9 `create*Tool` factories + per-tool `prepare*Arguments` helpers + alias
 * constants + `buildV1APlannerGuidance` + `normalizeQueryWithOptionalLimit`.
 *
 * Moved here from the original chat-tools.ts monolith as part of Phase 3.1
 * (docs/archive/sdd-chat-tools-split.md). Depends on Module A (types), Module B (constants),
 * Module E (execution helpers + `*Like` interfaces), Module F (validators),
 * and `chat-tool-prepare-helpers` sibling module.
 */

import type {
    ChatToolContext,
    ChatToolDefinition,
    CreateImageHostBinding,
    CreateImageToolInput,
    CurrentNoteContextInput,
    CurrentNoteContextOutput,
    ChatToolRegistryDefinition,
    ChatToolResult,
    InspectObsidianNoteInput,
    InspectObsidianNoteOutput,
    ListRecentNotesInput,
    ListRecentNotesOutput,
    ListVaultTagsInput,
    PrepareToolArgumentsContext,
    QueryNotesInput,
    QueryNotesOutput,
    ReadCanvasSummaryInput,
    ReadCanvasSummaryOutput,
    ReadNoteInput,
    ReadNoteOutput,
    ReadNoteOutlineInput,
    ReadNoteOutlineOutput,
    SearchMemoryInput,
    SearchVaultMetadataInput,
    SearchVaultMetadataOutput,
    SearchVaultSnippetsInput,
    VaultMetadataMatch,
    VaultSnippetSearchOutput,
    VaultTagsOutput,
} from "./chat-tool-types";
import { OBSIDIAN_OPERATIONS_V1A_MAX_OUTPUT_BUDGET_CHARS } from "./chat-tool-types";
import type { SourceRecord } from "./chat-types";
import { createSourceDedupKey } from "./source-store";
import { getPlatformCrypto } from "../platform-dom";
import { assertTaskSourceReadCurrent, isTaskSourcePathAllowed, type TaskSourceReadGuard } from "./task-source-read-guard";
import {
    CANVAS_MAX_READ_BYTES,
    CURRENT_NOTE_CONTENT_BUDGET_CHARS,
    CURRENT_NOTE_FULL_CONTENT_BUDGET_CHARS,
    INSPECT_NOTE_MAX_READ_BYTES,
    NOTE_STRUCTURE_BODY_UNAVAILABLE_SOURCE,
    NOTE_OUTLINE_MAX_HEADINGS,
    QUERY_NOTES_MAX_LIMIT,
    QUERY_NOTES_RESULT_JSON_BUDGET_CHARS,
    READ_NOTE_MAX_CHARS,
    READ_NOTE_MAX_READ_BYTES,
    READ_NOTE_RESULT_JSON_BUDGET_CHARS,
    RECENT_NOTES_MAX_LIMIT,
    SNIPPET_MAX_LIMIT,
    TAGS_MAX_LIMIT,
    VAULT_FILE_READ_SKIPPED_SIZE_SOURCE,
    VAULT_FILE_READ_UNAVAILABLE_SOURCE,
    VAULT_METADATA_MAX_LIMIT,
} from "./chat-tool-constants";
import {
    applyOutline,
    buildCanvasStructureSummary,
    buildMetadataQuerySignals,
    buildNoteStructureSummary,
    canReadVaultFiles,
    collectLinesWithinBudget,
    createCurrentNoteResult,
    createSkippedCanvasSummary,
    createToolFailureResult,
    createUnavailableCanvasSummary,
    extractHeadingsFromEditor,
    extractOutlineFromCache,
    extractOutlineFromFile,
    fileToRecentNote,
    findCurrentMarkdownView,
    findMarkdownFileByPath,
    findVaultFileByPath,
    getFileTitle,
    getHeadingSectionOrNearbyText,
    getLineCount,
    getMarkdownFiles,
    getMetadataCache,
    getOptionalMetadataCache,
    NoteStructureCacheMismatchError,
    listVaultTags,
    getUtf8ByteLength,
    readVaultFile,
    readVaultFileWithBudget,
    scoreMetadataMatch,
    truncate,
} from "./chat-tool-execution-helpers";
import {
    validateCurrentNoteContextInput,
    validateInspectObsidianNoteInput,
    validateListRecentNotesInput,
    validateListVaultTagsInput,
    validateQueryNotesInput,
    validateReadCanvasSummaryInput,
    validateReadNoteInput,
    validateReadNoteOutlineInput,
    validateSearchMemoryInput,
    validateSearchVaultMetadataInput,
    validateSearchVaultSnippetsInput,
} from "./chat-tool-guards";
import {
    extractInputPath,
    readFirstPositiveNumber,
    readFirstString,
    toInputRecord,
} from "./chat-tool-prepare-helpers";
import {
    buildObsidianOperationsPlannerGuidance,
    type ObsidianOperationsCatalogSectionId,
} from "./obsidian-operations-capability-catalog";
import { enforceToolOutputBudget } from "./chat-tool-registry";
import { throwIfAborted } from "./chat-utils";
import type { MemorySearchResult } from "./chat-types";
import { computeContentHash } from "../vss-helpers";
import {
    buildInspectObservationEvidence,
    buildQueryObservationEvidence,
    buildReadObservationEvidence,
    buildSnippetObservationEvidence,
    createVaultObservationId,
    projectInspectCache,
    projectInspectLinkFactsFromBacklinkEvaluation,
    type InspectBacklinkEvidenceFacts,
    type VaultObservationScope,
} from "./vault-observation-evidence";
import {
    ReadNoteFileIdentityRegistry,
    ReadNoteRangeUnavailableError,
    ReadNoteResultBudgetUnavailableError,
    buildReadNoteLineSpans,
    buildReadNoteSegment,
    decodeReadNoteCursor,
    getReadNotePartView,
    isReadNoteCodePointBoundary,
    resolveReadNoteSelection,
    type ReadNoteFileStatSnapshot,
} from "./read-note-tool-helpers";
import {
    QueryNotesCursorExpiredError,
    QueryNotesFileIdentityRegistry,
    QueryNotesResultBudgetUnavailableError,
    QueryNotesUnavailableError,
    executeQueryNotes,
} from "./query-notes-tool-helpers";
import {
    SequentialVaultSnippetIdentityRegistry,
    VaultSnippetCursorExpiredError,
    VaultSnippetResultBudgetUnavailableError,
    VaultSnippetSearchUnavailableError,
    executeVaultSnippetSearch,
} from "./vault-snippet-search-tool-helpers";

export interface VaultToolPathFilterOptions {
    /**
     * Optional fail-closed vault path boundary. When supplied, factories must
     * apply it before enumerating metadata or reading note content.
     */
    isPathAllowed?: (path: string) => boolean;
}

export interface QueryNotesToolOptions extends VaultToolPathFilterOptions {
    /** Query enumeration must fail closed when the public Vault API is absent. */
    failClosedMarkdownEnumeration?: boolean;
}

export type ReadNoteToolOptions = VaultToolPathFilterOptions;

let nextReadNoteToolInstance = 0;
let nextVaultSnippetSearchToolInstance = 0;
let nextVaultObservationInstance = 0;

function observationScope(context: ChatToolContext): VaultObservationScope {
    const scope = context.taskSourceReadGuard?.getNoteSearchScope?.();
    return {
        allowedPaths: scope?.allowedPaths == null ? null : [...scope.allowedPaths],
        excludedPaths: [...scope?.excludedPaths ?? []],
    };
}

export interface InspectObsidianNoteToolOptions extends VaultToolPathFilterOptions {
    /**
     * Host-owned fallback used by non-workspace runtimes (for example a frozen
     * Pagelet anchor). This is checked by `isPathAllowed` before lookup/read.
     */
    fallbackPath?: string;
    /**
     * Chat keeps the legacy active-note fallback by default. Read-only
     * background runtimes set this to false so workspace focus can never
     * redirect the read.
     */
    allowActiveNoteFallback?: boolean;
    /** Include bounded note text alongside structure for evidence gathering. */
    includeContentChars?: number;
}

function buildV1APlannerGuidance(
    catalogSections: readonly ObsidianOperationsCatalogSectionId[],
    toolSpecificGuidance: readonly string[],
): string[] {
    return [
        ...buildObsidianOperationsPlannerGuidance(catalogSections),
        ...toolSpecificGuidance,
    ];
}

export function createSearchMemoryTool(
    executeSearch: (input: SearchMemoryInput, context: ChatToolContext) => Promise<MemorySearchResult>,
): ChatToolDefinition<SearchMemoryInput, MemorySearchResult> {
    return {
        name: "search_memory",
        description: "Search Memory prepared from the user's notes.",
        plannerGuidance: [
            "Use for questions that need the user's prepared Memory or historical note context beyond currently supplied context.",
            "Do not use for general knowledge, pure rewriting, or agent-control requests.",
            "Use a concise query that preserves the user's important terms.",
        ],
        inputSchema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Search query for Memory prepared from the user's notes.",
                },
            },
            required: ["query"],
            additionalProperties: false,
        },
        permission: "read-only",
        cost: "ai-calls",
        outputBudgetChars: 8000,
        requiresConfirmation: false,
        failureBehavior: "recoverable",
        statusMessageText: "Searching memory",
        sourceBoundary: "memory",
        statusMessage: (input) => `Searching memory: ${input.query}`,
        prepareArguments: prepareSearchMemoryArguments,
        validateInput: validateSearchMemoryInput,
        execute: async (input, context) => {
            const result = await executeSearch(input, context);
            return {
                ok: true,
                tool: "search_memory",
                inputSummary: input.query,
                content: result,
                sources: result.sources,
            };
        },
    };
}

const SEARCH_MEMORY_QUERY_ALIASES = [
    "query",
    "q",
    "searchQuery",
    "search_query",
    "keywords",
    "keyword",
    "input",
    "prompt",
    "question",
] as const;

function prepareSearchMemoryArguments(raw: unknown, _ctx: PrepareToolArgumentsContext): unknown {
    // SPEC-TCR-04 fail-loud: alias mapping only. Empty args → return raw → validateInput throws
    // → executor returns schema_invalid → HostPolicy corrective turn lets the model retry with valid args.
    if (typeof raw === "string") {
        const query = raw.trim();
        return query ? { query } : raw;
    }
    const record = toInputRecord(raw);
    if (!record) return raw;
    const query = readFirstString(record, SEARCH_MEMORY_QUERY_ALIASES);
    return query ? { query } : raw;
}

function prepareCurrentNoteContextArguments(raw: unknown, _ctx: PrepareToolArgumentsContext): unknown {
    const rawMode = raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>).mode
        : raw;
    const mode = typeof rawMode === "string"
        ? rawMode.trim().toLowerCase().replace(/[_\s]+/g, "-")
        : "";
    if (mode === "outline" || mode === "structure" || mode === "headings") {
        return { mode: "outline" };
    }
    if (mode === "metadata" || mode === "properties" || mode === "frontmatter") {
        return { mode: "metadata" };
    }
    if (mode === "full" || mode === "full-note" || mode === "full-current-note" || mode === "entire-note") {
        return { mode: "full" };
    }
    return { mode: "selection-or-nearby" };
}

const QUERY_LIMIT_ALIASES = [
    "limit",
    "count",
    "maxResults",
    "max_results",
    "maxMatches",
    "max_matches",
    "topK",
    "top_k",
] as const;

function normalizeQueryWithOptionalLimit(
    raw: unknown,
    queryAliases: readonly string[],
    options: { includeLimit?: boolean } = {},
): unknown {
    if (typeof raw === "string") {
        const query = raw.trim();
        return query ? { query } : raw;
    }
    const record = toInputRecord(raw);
    if (!record) return raw;
    const query = readFirstString(record, queryAliases);
    if (!query) return raw;
    const normalized: Record<string, unknown> = { query };
    if (options.includeLimit) {
        const limit = readFirstPositiveNumber(record, QUERY_LIMIT_ALIASES);
        if (limit !== undefined) normalized.limit = limit;
    }
    return normalized;
}

const VAULT_METADATA_QUERY_ALIASES = [
    "query",
    "q",
    "searchQuery",
    "search_query",
    "metadataQuery",
    "metadata_query",
    "filename",
    "fileName",
    "file_name",
    "path",
    "tag",
    "keyword",
    "keywords",
    "input",
] as const;

function prepareSearchVaultMetadataArguments(raw: unknown, _ctx: PrepareToolArgumentsContext): unknown {
    return normalizeQueryWithOptionalLimit(raw, VAULT_METADATA_QUERY_ALIASES, { includeLimit: true });
}

const VAULT_SNIPPETS_QUERY_ALIASES = [
    "query",
    "q",
    "searchQuery",
    "search_query",
    "snippetQuery",
    "snippet_query",
    "text",
    "term",
    "token",
    "prefix",
    "keyword",
    "keywords",
    "input",
] as const;

const VAULT_SNIPPETS_SCOPE_ALIASES = ["scope", "path", "folder", "file"] as const;

function prepareSearchVaultSnippetsArguments(raw: unknown, _ctx: PrepareToolArgumentsContext): unknown {
    if (typeof raw === "string") {
        return raw.trim() ? { query: raw } : raw;
    }
    const record = toInputRecord(raw);
    if (!record) return raw;
    const query = readFirstPreservedString(record, VAULT_SNIPPETS_QUERY_ALIASES);
    if (!query) return raw;
    const normalized: Record<string, unknown> = { query };
    const limit = readFirstPositiveNumber(record, QUERY_LIMIT_ALIASES);
    if (limit !== undefined) normalized.limit = limit;
    const scope = readFirstString(record, VAULT_SNIPPETS_SCOPE_ALIASES);
    if (scope) normalized.scope = scope;
    if (record.part !== undefined) normalized.part = record.part;
    if (record.caseSensitive !== undefined) normalized.caseSensitive = record.caseSensitive;
    if (record.cursor !== undefined) normalized.cursor = record.cursor;
    return normalized;
}

function readFirstPreservedString(value: Record<string, unknown>, keys: readonly string[]): string | undefined {
    for (const key of keys) {
        const candidate = value[key];
        if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
    const nestedInput = value.input;
    if (nestedInput && typeof nestedInput === "object" && !Array.isArray(nestedInput)) {
        return readFirstPreservedString(nestedInput as Record<string, unknown>, keys.filter(key => key !== "input"));
    }
    return undefined;
}

const NOTE_OUTLINE_MAX_HEADINGS_ALIASES = [
    "max_headings",
    "maxHeadings",
    "headingLimit",
    "heading_limit",
    "limit",
] as const;

function prepareReadNoteOutlineArguments(raw: unknown, _ctx: PrepareToolArgumentsContext): unknown {
    const path = extractInputPath(raw, [".md"]);
    if (!path) return raw;
    const record = toInputRecord(raw);
    const normalized: Record<string, unknown> = { path };
    const maxHeadings = record ? readFirstPositiveNumber(record, NOTE_OUTLINE_MAX_HEADINGS_ALIASES) : undefined;
    if (maxHeadings !== undefined) normalized.max_headings = maxHeadings;
    return normalized;
}

function prepareInspectObsidianNoteArguments(raw: unknown, _ctx: PrepareToolArgumentsContext): unknown {
    // wrinkle (c): inspect_obsidian_note permits empty input → reads current open note.
    // prepareArguments must NOT invent a path when none is supplied.
    const path = extractInputPath(raw, [".md"]);
    if (path) return { path };
    const record = toInputRecord(raw);
    if (!record) return {};
    // If `path` is present but empty/whitespace, normalize to `{}` so validateInput
    // doesn't reject an empty string as an invalid path.
    return typeof record.path === "string" && !record.path.trim() ? {} : raw;
}

function prepareReadCanvasSummaryArguments(raw: unknown, _ctx: PrepareToolArgumentsContext): unknown {
    const path = extractInputPath(raw, [".canvas"]);
    if (!path) return raw;
    return { path };
}

export function createCurrentNoteContextTool(): ChatToolDefinition<CurrentNoteContextInput, CurrentNoteContextOutput> {
    return withTaskSourceReadBoundary({
        name: "get_current_note_context",
        description: "Read the active Markdown note title, path, selection, nearby text, or outline.",
        plannerGuidance: [
            "Use when the user refers to the current note, selected text, this paragraph, nearby content, outline, full current note text, or current note metadata.",
            "Prefer selection-or-nearby for summary, explanation, rewrite, or local context questions.",
            "Use full when the user asks to find an exact token, prefix, phrase, or identifier anywhere in the current note.",
        ],
        inputSchema: {
            type: "object",
            properties: {
                mode: {
                    type: "string",
                    description: "Current note context mode.",
                    enum: ["selection-or-nearby", "outline", "metadata", "full"],
                },
            },
            required: ["mode"],
            additionalProperties: false,
        },
        permission: "read-only",
        cost: "free",
        outputBudgetChars: CURRENT_NOTE_FULL_CONTENT_BUDGET_CHARS,
        requiresConfirmation: false,
        failureBehavior: "recoverable",
        statusMessageText: "Reading current note",
        sourceBoundary: "current-note",
        statusMessage: () => "Reading current note",
        // Preserve legal model-selected modes while repairing common aliases.
        prepareArguments: prepareCurrentNoteContextArguments,
        validateInput: validateCurrentNoteContextInput,
        execute: async (input, context) => {
            throwIfAborted(context.signal);
            const view = findCurrentMarkdownView(context.host.app.workspace);
            if (!view?.file?.path) {
                return createToolFailureResult(
                    "get_current_note_context",
                    input.mode,
                    "No active Markdown note was available.",
                );
            }

            const file = view.file;
            if (!isTaskSourcePathAllowed(context.taskSourceReadGuard, file.path)) {
                return createToolFailureResult("get_current_note_context", "excluded path",
                    "The current note was not available in the permitted task scope.");
            }
            const editor = view.editor && context.taskSourceReadGuard
                ? new Proxy(view.editor, {
                    get(target, key, receiver) {
                        const assertEditorCurrent = () => {
                            assertTaskSourceReadCurrent(context.taskSourceReadGuard);
                            if (view.file?.path !== file.path || !isTaskSourcePathAllowed(context.taskSourceReadGuard, file.path)) {
                                throw new Error("Current editor is outside the permitted task scope.");
                            }
                        };
                        assertEditorCurrent();
                        const value = Reflect.get(target, key, receiver);
                        if (typeof value !== "function") return value;
                        return (...args: unknown[]) => {
                            assertEditorCurrent();
                            const result: unknown = value.apply(target, args);
                            assertEditorCurrent();
                            return result;
                        };
                    },
                }) : view.editor;
            const output: CurrentNoteContextOutput = {
                path: file.path,
                title: getFileTitle(file),
                mode: input.mode,
            };
            const source = [{ path: file.path }];

            if (input.mode === "metadata" || !editor) {
                return createCurrentNoteResult(input.mode, output, source);
            }

            if (input.mode === "outline") {
                applyOutline(output, extractHeadingsFromEditor(editor));
                return createCurrentNoteResult(input.mode, output, source);
            }

            if (input.mode === "full") {
                const fullText = editor.getValue?.() ?? collectLinesWithinBudget(
                    editor,
                    0,
                    getLineCount(editor) ?? 0,
                    CURRENT_NOTE_FULL_CONTENT_BUDGET_CHARS,
                );
                output.fullText = truncate(fullText, CURRENT_NOTE_FULL_CONTENT_BUDGET_CHARS);
                output.fullTextTruncated = output.fullText.length < fullText.length;
                applyOutline(output, extractHeadingsFromEditor(editor));
                return createCurrentNoteResult(input.mode, output, source);
            }

            const selection = editor.getSelection?.().trim();
            if (selection) {
                output.selection = truncate(selection, CURRENT_NOTE_CONTENT_BUDGET_CHARS);
                return createCurrentNoteResult("selection", output, source);
            }

            const nearbyText = getHeadingSectionOrNearbyText(editor);
            if (nearbyText) {
                output.nearbyText = truncate(nearbyText, CURRENT_NOTE_CONTENT_BUDGET_CHARS);
            }
            applyOutline(output, extractHeadingsFromEditor(editor));
            return createCurrentNoteResult("nearby", output, source);
        },
    });
}

export function createSearchVaultMetadataTool(
    options: VaultToolPathFilterOptions = {},
): ChatToolDefinition<SearchVaultMetadataInput, SearchVaultMetadataOutput> {
    return withTaskSourceReadBoundary({
        name: "search_vault_metadata",
        description: "Search Markdown note filenames, paths, tags, and frontmatter metadata.",
        plannerGuidance: [
            "Use when the user wants to find notes by title, path, tag, frontmatter, folder, or metadata keyword.",
            "This returns vault facts and note paths; it does not create Memory references or user preferences.",
        ],
        inputSchema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Filename, path, tag, or frontmatter search query.",
                },
                limit: {
                    type: "integer",
                    description: "Maximum number of matches to return.",
                    minimum: 1,
                    maximum: VAULT_METADATA_MAX_LIMIT,
                },
            },
            required: ["query"],
            additionalProperties: false,
        },
        permission: "read-only",
        cost: "free",
        outputBudgetChars: 5000,
        requiresConfirmation: false,
        failureBehavior: "recoverable",
        statusMessageText: "Searching note metadata",
        sourceBoundary: "read-only-tool",
        statusMessage: (input) => `Searching note metadata: ${input.query}`,
        prepareArguments: prepareSearchVaultMetadataArguments,
        validateInput: validateSearchVaultMetadataInput,
        execute: async (input, context) => {
            throwIfAborted(context.signal);
            const metadataCache = getMetadataCache(context.host);
            const querySignals = buildMetadataQuerySignals(input.query);
            const matches = getMarkdownFiles(context.host)
                .filter((file) => isAllowedPath(file.path, options.isPathAllowed))
                .map((file) => scoreMetadataMatch(file, metadataCache.getFileCache?.(file), querySignals))
                .filter((match): match is VaultMetadataMatch => match !== null)
                .sort((a, b) => b.score - a.score || (b.mtime ?? 0) - (a.mtime ?? 0) || a.path.localeCompare(b.path))
                .slice(0, input.limit);

            return {
                ok: true,
                tool: "search_vault_metadata",
                inputSummary: input.query,
                content: { query: input.query, matches },
                sources: matches.map((match) => ({ path: match.path })),
            };
        },
    }, options);
}

export function createListRecentNotesTool(
    options: VaultToolPathFilterOptions = {},
): ChatToolDefinition<ListRecentNotesInput, ListRecentNotesOutput> {
    return withTaskSourceReadBoundary({
        name: "list_recent_notes",
        description: "List recently modified or created Markdown notes.",
        plannerGuidance: [
            "Use when the user asks what they recently wrote, modified, created, or worked on in the vault.",
            "This returns vault facts only; it does not establish long-term user preferences.",
        ],
        inputSchema: {
            type: "object",
            properties: {
                limit: {
                    type: "integer",
                    description: "Maximum number of notes to return.",
                    minimum: 1,
                    maximum: RECENT_NOTES_MAX_LIMIT,
                },
                order: {
                    type: "string",
                    description: "Sort by modified time or created time.",
                    enum: ["modified", "created"],
                },
            },
            required: ["order"],
            additionalProperties: false,
        },
        permission: "read-only",
        cost: "free",
        outputBudgetChars: 4000,
        requiresConfirmation: false,
        failureBehavior: "recoverable",
        statusMessageText: "Listing recent notes",
        sourceBoundary: "read-only-tool",
        statusMessage: (input) => `Listing recent ${input.order === "created" ? "created" : "modified"} notes`,
        validateInput: validateListRecentNotesInput,
        execute: async (input, context) => {
            throwIfAborted(context.signal);
            const statKey = input.order === "created" ? "ctime" : "mtime";
            const notes = getMarkdownFiles(context.host)
                .filter((file) => isAllowedPath(file.path, options.isPathAllowed))
                .map((file) => {
                    assertTaskSourceReadCurrent(context.taskSourceReadGuard);
                    if (!isTaskSourcePathAllowed(context.taskSourceReadGuard, file.path)) {
                        throw new Error("Recent note is outside the permitted task scope.");
                    }
                    return fileToRecentNote(file);
                })
                .sort((a, b) => (b[statKey] ?? 0) - (a[statKey] ?? 0) || a.path.localeCompare(b.path))
                .slice(0, input.limit);

            return {
                ok: true,
                tool: "list_recent_notes",
                inputSummary: `${input.order}:${input.limit}`,
                content: { order: input.order, notes },
                sources: notes.map((note) => ({ path: note.path })),
            };
        },
    }, options);
}

export function createReadNoteOutlineTool(
    options: VaultToolPathFilterOptions = {},
): ChatToolDefinition<ReadNoteOutlineInput, ReadNoteOutlineOutput> {
    return withTaskSourceReadBoundary({
        name: "read_note_outline",
        description: "Read the heading outline for a specific Markdown note path.",
        plannerGuidance: [
            "Use after a note path is known and the user needs heading structure, organization, or outline-level context.",
            "This returns read-only outline facts; it does not read full note bodies.",
        ],
        inputSchema: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: "Markdown note path to read.",
                },
                max_headings: {
                    type: "integer",
                    description: "Maximum number of headings to return.",
                    minimum: 1,
                    maximum: NOTE_OUTLINE_MAX_HEADINGS,
                },
            },
            required: ["path"],
            additionalProperties: false,
        },
        permission: "read-only",
        cost: "free",
        outputBudgetChars: 5000,
        requiresConfirmation: false,
        failureBehavior: "recoverable",
        statusMessageText: "Reading note outline",
        sourceBoundary: "read-only-tool",
        statusMessage: (input) => `Reading note outline: ${input.path}`,
        prepareArguments: prepareReadNoteOutlineArguments,
        validateInput: validateReadNoteOutlineInput,
        execute: async (input, context) => {
            throwIfAborted(context.signal);
            const normalizedPath = normalizeBoundaryPath(input.path);
            if (!normalizedPath || !isAllowedPath(normalizedPath, options.isPathAllowed)) {
                return createToolFailureResult(
                    "read_note_outline",
                    "excluded path",
                    "Requested Markdown note was not available in the permitted vault scope.",
                );
            }
            const file = findMarkdownFileByPath(context.host, normalizedPath);
            if (!file) {
                return createToolFailureResult(
                    "read_note_outline",
                    input.path,
                    "Requested Markdown note was not found.",
                );
            }

            const cache = getMetadataCache(context.host).getFileCache?.(file);
            const cachedHeadings = extractOutlineFromCache(cache, input.maxHeadings);
            const outline = cachedHeadings ?? await extractOutlineFromFile(context.host, file, input.maxHeadings);
            throwIfAborted(context.signal);

            return {
                ok: true,
                tool: "read_note_outline",
                inputSummary: file.path,
                content: {
                    path: file.path,
                    title: getFileTitle(file),
                    headings: outline.headings,
                    outlineTruncated: outline.outlineTruncated,
                    totalHeadings: outline.totalHeadings,
                    maxHeadings: input.maxHeadings,
                },
                sources: [{ path: file.path }],
            };
        },
    }, options);
}

const READ_NOTE_PATH_ALIASES = ["path", "notePath", "note_path", "file_path", "file"] as const;

function prepareReadNoteArguments(raw: unknown, _ctx: PrepareToolArgumentsContext): unknown {
    const extracted = extractInputPath(raw, [".md"]);
    if (extracted) return typeof raw === "string" ? { path: extracted } : { ...toInputRecord(raw)!, path: extracted };
    const record = toInputRecord(raw);
    if (!record) return raw;
    const path = readFirstString(record, READ_NOTE_PATH_ALIASES);
    return path ? { ...record, path } : raw;
}

export function createReadNoteTool(
    options: ReadNoteToolOptions = {},
): ChatToolDefinition<ReadNoteInput, ReadNoteOutput> {
    const identities = new ReadNoteFileIdentityRegistry(`read-note-instance-${++nextReadNoteToolInstance}`);
    return withTaskSourceReadBoundary({
        name: "read_note",
        description: "Read saved Markdown note body text or raw frontmatter properties with bounded paging.",
        plannerGuidance: [
            "Use when an exact Markdown note path is known and the answer needs saved note content.",
            "Use properties for raw YAML evidence and body for Markdown content; a date in properties is not body evidence.",
            "Continue with nextCursor instead of guessing offsets. A completed requested range is not necessarily the end of the whole note.",
        ],
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Vault-relative Markdown note path." },
                part: { type: "string", enum: ["body", "properties"], description: "Note part to read; defaults to body on first read and inherits cursor.part on continuation." },
                startLine: { type: "integer", minimum: 1, description: "Inclusive original-file start line for body reads; supply with endLine." },
                endLine: { type: "integer", minimum: 1, description: "Inclusive original-file end line for body reads; supply with startLine." },
                maxChars: { type: "integer", minimum: 1, maximum: READ_NOTE_MAX_CHARS, description: "Maximum returned text characters." },
                cursor: { type: "string", description: "Opaque continuation cursor returned by this tool instance." },
            },
            required: ["path"],
            additionalProperties: false,
        },
        permission: "read-only",
        cost: "free",
        outputBudgetChars: READ_NOTE_RESULT_JSON_BUDGET_CHARS,
        requiresConfirmation: false,
        failureBehavior: "recoverable",
        statusMessageText: "Reading note",
        sourceBoundary: "read-only-tool",
        statusMessage: input => `Reading note: ${input.path}`,
        prepareArguments: prepareReadNoteArguments,
        validateInput: validateReadNoteInput,
        execute: async (input, context) => {
            throwIfAborted(context.signal);
            const normalizedPath = normalizeBoundaryPath(input.path);
            if (!normalizedPath) {
                return createToolFailureResult(
                    "read_note",
                    "excluded path",
                    "Requested Markdown note was not available in the permitted vault scope.",
                );
            }
            const sourcePath = normalizedPath;
            const isReadablePath = () => isAllowedPath(sourcePath, options.isPathAllowed)
                && isTaskSourcePathAllowed(context.taskSourceReadGuard, sourcePath);
            if (!isReadablePath()) {
                return createToolFailureResult(
                    "read_note",
                    "excluded path",
                    "Requested Markdown note was not available in the permitted vault scope.",
                );
            }

            const file = findMarkdownFileByPath(context.host, sourcePath);
            if (!file || file.path !== sourcePath) {
                return createToolFailureResult(
                    "read_note",
                    sourcePath,
                    "Requested Markdown note was not found.",
                );
            }
            const stat = captureReadNoteStat(file);
            if (!stat) {
                return createToolFailureResult(
                    "read_note",
                    sourcePath,
                    "Requested Markdown note has no valid mtime and size.",
                );
            }
            if (stat.size > READ_NOTE_MAX_READ_BYTES) {
                return createToolFailureResult(
                    "read_note",
                    sourcePath,
                    `Requested Markdown note exceeds the ${READ_NOTE_MAX_READ_BYTES}-byte read limit.`,
                );
            }
            if (!canReadVaultFiles(context.host)) {
                return createToolFailureResult(
                    "read_note",
                    sourcePath,
                    "Vault note reading is unavailable.",
                );
            }

            const content = await readVaultFile(context.host, file);
            throwIfAborted(context.signal);
            assertReadNoteSourceCurrent(context, sourcePath, file, stat, options);
            if (getUtf8ByteLength(content) > READ_NOTE_MAX_READ_BYTES) {
                throw new Error("Requested Markdown note grew beyond the read limit while it was being read.");
            }

            let sourceVersion: string;
            try {
                sourceVersion = await computeContentHash(content);
            } catch (error) {
                void error;
                return createToolFailureResult(
                    "read_note",
                    sourcePath,
                    "Note content hash is unavailable.",
                );
            }
            throwIfAborted(context.signal);
            assertReadNoteSourceCurrent(context, sourcePath, file, stat, options);

            const cursor = input.cursor ? decodeReadNoteCursor(input.cursor) : null;
            if (input.cursor && !cursor) {
                return createToolFailureResult("read_note", sourcePath, "read_note cursor is invalid or expired.");
            }
            const part = input.part ?? cursor?.part ?? "body";
            if (cursor && input.part !== undefined && cursor.part !== input.part) {
                return createToolFailureResult("read_note", sourcePath, "read_note cursor targets a different note part.");
            }
            if (cursor && cursor.path !== sourcePath) {
                return createToolFailureResult("read_note", sourcePath, "read_note cursor targets a different note part.");
            }
            if (cursor && cursor.sourceVersion !== sourceVersion) {
                return createToolFailureResult("read_note", sourcePath, "read_note cursor content version is no longer current.");
            }
            if (cursor && cursor.part === "properties" && (cursor.startLine !== undefined || cursor.endLine !== undefined)) {
                return createToolFailureResult("read_note", sourcePath, "read_note cursor has an invalid properties range.");
            }
            const view = getReadNotePartView(content, part);
            const lineSpans = buildReadNoteLineSpans(view);

            try {
                const selection = resolveReadNoteSelection(
                    view,
                    cursor ? cursor.startLine : input.startLine,
                    cursor ? cursor.endLine : input.endLine,
                    lineSpans,
                );
                const startOffset = cursor ? cursor.offset : selection.startOffset;
                if (startOffset < selection.startOffset || startOffset > selection.endOffset) {
                    return createToolFailureResult("read_note", sourcePath, "read_note cursor offset is outside its original range.");
                }
                if (cursor && !isReadNoteCodePointBoundary(view.text, startOffset)) {
                    return createToolFailureResult("read_note", sourcePath, "read_note cursor offset splits a Unicode character.");
                }
                const identity = cursor
                    ? identities.isValid(file, cursor.identity, stat)
                        ? cursor.identity
                        : null
                    : identities.register(file, stat);
                if (!identity) {
                    return createToolFailureResult("read_note", sourcePath, "read_note cursor file identity is no longer current.");
                }

                const segment = buildReadNoteSegment({
                    path: file.path,
                    part,
                    view,
                    selection,
                    startOffset,
                    maxChars: input.maxChars,
                    sourceVersion,
                    identity,
                    lineSpans,
                });
                assertReadNoteSourceCurrent(context, sourcePath, file, stat, options);
                const evidence = await buildReadObservationEvidence({
                    observationId: createVaultObservationId(`read-note-${++nextVaultObservationInstance}`),
                    scope: observationScope(context),
                    output: segment.content,
                    partitionContent: view.text,
                });
                return {
                    ok: true,
                    tool: "read_note",
                    inputSummary: file.path,
                    content: segment.content,
                    sources: [{ path: file.path }],
                    vaultObservationEvidence: evidence,
                    vaultObservationContractVersion: 1,
                };
            } catch (error) {
                if (error instanceof ReadNoteRangeUnavailableError) {
                    return createToolFailureResult("read_note", sourcePath, error.message);
                }
                if (error instanceof ReadNoteResultBudgetUnavailableError) {
                    return createToolFailureResult("read_note", sourcePath, error.message);
                }
                throw error;
            }
        },
    }, options);
}

export function createQueryNotesTool(
    options: QueryNotesToolOptions = {},
): ChatToolDefinition<QueryNotesInput, QueryNotesOutput> {
    const randomUUID = getPlatformCrypto()?.randomUUID?.();
    if (!randomUUID) throw new Error("Query notes tool instance identity is unavailable.");
    const instancePrefix = randomUUID.replace(/-/g, "");
    const identities = new QueryNotesFileIdentityRegistry(instancePrefix);
    return withTaskSourceReadBoundary({
        name: "query_notes",
        description: "Query permitted Markdown notes by explicit path, folder, tags, properties, and date metadata.",
        plannerGuidance: [
            "Use for precise note-list questions with explicit conditions; choose the date field and timezone from context, explain the interpretation, and ask when genuinely ambiguous.",
            "Date intervals are half-open; ctime/mtime require timestamp boundaries with an explicit UTC offset, and calendar-date is only for property dates in YYYY-MM-DD form.",
            "Path is exact, folder is recursive, tags are all-of exact matches, and property conditions combine with AND.",
            "Check coverage and matchCountKind before calling a partial result complete; continue only with nextCursor.",
        ],
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Exact vault-relative Markdown path." },
                folder: { type: "string", description: "Recursive vault-relative folder; empty string means the vault root." },
                tags: {
                    type: "array",
                    items: { type: "string" },
                    description: "All-of tag conditions; each entry may omit one leading #.",
                },
                properties: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            key: { type: "string" },
                            operator: { type: "string", enum: ["exists", "equals", "contains"] },
                            value: {
                                description: "JSON scalar for equals or contains; omitted for exists.",
                                anyOf: [
                                    { type: "string" },
                                    { type: "number" },
                                    { type: "boolean" },
                                    { type: "null" },
                                ],
                            },
                        },
                        required: ["key", "operator"],
                        additionalProperties: false,
                    },
                },
                date: {
                    type: "object",
                    description: "Half-open date interval; from is inclusive and to is exclusive.",
                    properties: {
                        field: {
                            type: "string",
                            enum: ["ctime", "mtime", "property"],
                            description: "ctime/mtime require timestamp semantics; property requires property.",
                        },
                        property: { type: "string", description: "Required only when field is property." },
                        kind: {
                            type: "string",
                            enum: ["timestamp", "calendar-date"],
                            description: "timestamp uses ISO boundaries with an explicit UTC offset; calendar-date is only valid for property.",
                        },
                        from: {
                            type: "string",
                            description: "Inclusive start: timestamp uses an ISO timestamp with a UTC offset; property calendar-date uses YYYY-MM-DD.",
                        },
                        to: {
                            type: "string",
                            description: "Exclusive end: timestamp uses an ISO timestamp with a UTC offset; property calendar-date uses YYYY-MM-DD.",
                        },
                    },
                    required: ["field", "kind", "from", "to"],
                    additionalProperties: false,
                },
                sort: {
                    type: "object",
                    properties: {
                        field: { type: "string", enum: ["path", "ctime", "mtime"] },
                        direction: { type: "string", enum: ["asc", "desc"] },
                    },
                    required: ["field", "direction"],
                    additionalProperties: false,
                },
                limit: { type: "integer", minimum: 1, maximum: QUERY_NOTES_MAX_LIMIT },
                cursor: { type: "string", description: "Opaque continuation cursor from this tool instance." },
            },
            additionalProperties: false,
        },
        permission: "read-only",
        cost: "free",
        outputBudgetChars: QUERY_NOTES_RESULT_JSON_BUDGET_CHARS,
        requiresConfirmation: false,
        failureBehavior: "recoverable",
        statusMessageText: "Querying notes",
        sourceBoundary: "read-only-tool",
        statusMessage: () => "Querying permitted note metadata",
        validateInput: validateQueryNotesInput,
        execute: async (input, context) => {
            throwIfAborted(context.signal);
            const dependencyPaths = new Set<string>();
            try {
                const result = await executeQueryNotes({
                    input,
                    host: context.host,
                    instancePrefix,
                    identities,
                    signal: context.signal,
                    dependencyPaths,
                    isPathReadable: path => isAllowedPath(path, options.isPathAllowed)
                        && isTaskSourcePathAllowed(context.taskSourceReadGuard, path),
                    assertCurrent: () => {
                        throwIfAborted(context.signal);
                        assertTaskSourceReadCurrent(context.taskSourceReadGuard);
                    },
                    onMetadataDependency: path => dependencyPaths.add(path),
                });
                const evidence = await buildQueryObservationEvidence({
                    observationId: createVaultObservationId(`query-notes-${++nextVaultObservationInstance}`),
                    scope: observationScope(context),
                    output: result.content,
                    candidatePaths: result.evidence.candidatePaths,
                    metadataSnapshots: result.evidence.metadataSnapshots,
                    matchMetadataSnapshots: result.evidence.matchMetadataSnapshots,
                });
                return {
                    ok: true,
                    tool: "query_notes",
                    inputSummary: `limit:${input.limit}`,
                    content: result.content,
                    sources: result.matches.map(match => ({ path: match.path })),
                    sourceRecords: createMetadataDependencyRecords("query_notes", dependencyPaths),
                    vaultObservationEvidence: evidence,
                    vaultObservationContractVersion: 1,
                };
            } catch (error) {
                if (error instanceof QueryNotesUnavailableError
                    || error instanceof QueryNotesCursorExpiredError
                    || error instanceof QueryNotesResultBudgetUnavailableError) {
                    return createToolFailureResult("query_notes", "metadata query", error.message);
                }
                throw error;
            }
        },
    }, { ...options, failClosedMarkdownEnumeration: true });
}

function captureReadNoteStat(file: { stat?: { mtime?: unknown; size?: unknown } }): ReadNoteFileStatSnapshot | null {
    const { mtime, size } = file.stat ?? {};
    if (typeof mtime !== "number" || !Number.isFinite(mtime)
        || typeof size !== "number" || !Number.isFinite(size) || size < 0) {
        return null;
    }
    return { mtime, size };
}

function assertReadNoteSourceCurrent(
    context: ChatToolContext,
    path: string,
    file: NonNullable<ReturnType<typeof findMarkdownFileByPath>>,
    stat: ReadNoteFileStatSnapshot,
    options: VaultToolPathFilterOptions,
): void {
    throwIfAborted(context.signal);
    assertTaskSourceReadCurrent(context.taskSourceReadGuard);
    if (!isAllowedPath(path, options.isPathAllowed)
        || !isTaskSourcePathAllowed(context.taskSourceReadGuard, path)) {
        throw new Error("Task source path is no longer permitted.");
    }
    const currentFile = findMarkdownFileByPath(context.host, path);
    if (currentFile !== file || currentFile?.path !== path) {
        throw new Error("Note source changed while it was being read.");
    }
    const currentStat = captureReadNoteStat(currentFile);
    if (!currentStat || currentStat.mtime !== stat.mtime || currentStat.size !== stat.size) {
        throw new Error("Note source stat changed while it was being read.");
    }
}

export function createInspectObsidianNoteTool(
    options: InspectObsidianNoteToolOptions = {},
): ChatToolDefinition<InspectObsidianNoteInput, InspectObsidianNoteOutput> {
    const allowActiveNoteFallback = options.allowActiveNoteFallback ?? true;
    const hasHostFallback = Boolean(options.fallbackPath);
    const budgetDefinition: ChatToolRegistryDefinition = {
        name: "inspect_obsidian_note",
        description: "Read a bounded Obsidian Markdown note structure summary.",
        inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
        },
        plannerGuidance: [],
        permission: "read-only",
        cost: "free",
        outputBudgetChars: OBSIDIAN_OPERATIONS_V1A_MAX_OUTPUT_BUDGET_CHARS,
        requiresConfirmation: false,
        failureBehavior: "recoverable",
        statusMessage: "Reading note structure",
        sourceBoundary: "read-only-tool",
    };
    return withTaskSourceReadBoundary({
        name: "inspect_obsidian_note",
        description: "Read a bounded Obsidian Markdown note structure summary.",
        plannerGuidance: buildV1APlannerGuidance(["markdown", "safety"], [
            "Use when the user asks about note properties, tags, headings, tasks, callouts, embeds, links, backlinks, or unresolved links.",
            hasHostFallback
                ? "Use a vault-relative .md path when known; an omitted path resolves only to the host-provided frozen anchor."
                : allowActiveNoteFallback
                    ? "Use without a path for the active Markdown note; use a vault-relative .md path when a target note is known."
                    : "Always provide a vault-relative .md path; there is no active-note fallback.",
            "This returns structure and short facts only; it must not return full note bodies.",
        ]),
        inputSchema: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: "Optional vault-relative Markdown note path. Omit to inspect the active note.",
                },
            },
            additionalProperties: false,
        },
        permission: "read-only",
        cost: "free",
        outputBudgetChars: OBSIDIAN_OPERATIONS_V1A_MAX_OUTPUT_BUDGET_CHARS,
        requiresConfirmation: false,
        failureBehavior: "recoverable",
        statusMessageText: "Reading note structure",
        sourceBoundary: "read-only-tool",
        statusMessage: (input) => input.path ? `Reading note structure: ${input.path}` : "Reading current note structure",
        prepareArguments: prepareInspectObsidianNoteArguments,
        validateInput: validateInspectObsidianNoteInput,
        execute: async (input, context) => {
            throwIfAborted(context.signal);
            const host = options.isPathAllowed
                ? createPathFilteredHost(context.host, options.isPathAllowed)
                : context.host;
            const requestedPath = input.path ?? options.fallbackPath;
            const normalizedPath = requestedPath ? normalizeBoundaryPath(requestedPath) : undefined;
            if (
                requestedPath
                && (!normalizedPath || !isAllowedPath(normalizedPath, options.isPathAllowed))
            ) {
                return createToolFailureResult(
                    "inspect_obsidian_note",
                    "excluded path",
                    "Requested Markdown note was not available in the permitted vault scope.",
                );
            }
            const activeFile = !requestedPath && allowActiveNoteFallback
                ? findCurrentMarkdownView(host.app.workspace)?.file ?? null
                : null;
            if (activeFile && (!isAllowedPath(activeFile.path, options.isPathAllowed)
                || !isTaskSourcePathAllowed(context.taskSourceReadGuard, activeFile.path))) {
                return createToolFailureResult(
                    "inspect_obsidian_note",
                    "excluded path",
                    "Requested Markdown note was not available in the permitted vault scope.",
                );
            }
            const file = normalizedPath
                ? findMarkdownFileByPath(host, normalizedPath)
                : activeFile;
            if (!file) {
                return createToolFailureResult(
                    "inspect_obsidian_note",
                    requestedPath ? "requested note" : "current note",
                    requestedPath
                        ? "Requested Markdown note was not found."
                        : allowActiveNoteFallback
                            ? "No active Markdown note was available."
                            : "A Markdown note path or frozen anchor was required.",
                );
            }

            const fileStat = captureReadNoteStat(file);
            const primaryPath = file.path;

            const metadataCache = getOptionalMetadataCache(host);
            const cache = metadataCache?.getFileCache?.(file);
            const canReadNoteBody = canReadVaultFiles(host);
            const cacheKnown = cache !== null && cache !== undefined;
            const hasCachedTasks = Array.isArray(cache?.listItems)
                && cache.listItems.some(item => typeof item.task === "string");
            const hasCalloutCandidates = Array.isArray(cache?.sections)
                && cache.sections.some(section =>
                    section.type === "callout" || section.type === "blockquote" || section.type === "list",
                );
            const includeContentChars = normalizeContentCharLimit(options.includeContentChars);
            const bodyRequired = !cacheKnown || hasCachedTasks || hasCalloutCandidates || includeContentChars > 0;
            if (bodyRequired && canReadNoteBody && !fileStat) {
                return createToolFailureResult(
                    "inspect_obsidian_note",
                    file.path,
                    "Requested Markdown note has no valid mtime and size.",
                );
            }
            const readResult = bodyRequired && canReadNoteBody
                ? await readVaultFileWithBudget(host, file, INSPECT_NOTE_MAX_READ_BYTES)
                : { content: "", truncated: false, skippedForSize: false };
            if (bodyRequired && canReadNoteBody) {
                assertReadNoteSourceCurrent(context, primaryPath, file, fileStat!, options);
            }
            const bodyRead = bodyRequired && canReadNoteBody && !readResult.skippedForSize && !readResult.truncated;
            throwIfAborted(context.signal);
            const unavailableSources = !metadataCache || typeof metadataCache.getFileCache !== "function"
                ? ["metadata cache"]
                : [];
            const dependencyPaths = new Set<string>();
            let backlinkEvaluation: InspectBacklinkEvidenceFacts | undefined;
            let structure: InspectObsidianNoteOutput;
            try {
                structure = buildNoteStructureSummary(file, cache, bodyRead ? readResult.content : "", metadataCache, unavailableSources, {
                    truncated: bodyRequired && (readResult.truncated || readResult.skippedForSize),
                    skippedSources: bodyRequired && (!canReadNoteBody || readResult.skippedForSize || readResult.truncated)
                        ? [!canReadNoteBody
                            ? NOTE_STRUCTURE_BODY_UNAVAILABLE_SOURCE
                            : VAULT_FILE_READ_SKIPPED_SIZE_SOURCE]
                        : [],
                    omittedCount: bodyRequired && (readResult.truncated || readResult.skippedForSize) ? 1 : 0,
                    onSourceRead: path => dependencyPaths.add(path),
                    bodyRead,
                    bodyRequired,
                    captureBacklinkEvaluation: facts => {
                        backlinkEvaluation = {
                            scannedSources: [...facts.scannedSources],
                            evaluatedSources: facts.evaluatedSources,
                            capExceeded: facts.capExceeded,
                            backlinks: [...facts.backlinks],
                        };
                    },
                });
            } catch (error) {
                if (error instanceof NoteStructureCacheMismatchError) {
                    return createToolFailureResult(
                        "inspect_obsidian_note",
                        file.path,
                        "Note structure cache is not synchronized with the current note text; retry after the cache updates.",
                    );
                }
                throw error;
            }
            const content = includeContentChars > 0 && bodyRead
                ? {
                    ...structure,
                    fullText: truncate(readResult.content, includeContentChars),
                    fullTextTruncated: readResult.truncated || readResult.content.length > includeContentChars,
                } as InspectObsidianNoteOutput
                : structure;
            const initialResult: ChatToolResult<InspectObsidianNoteOutput> = {
                ok: true,
                tool: "inspect_obsidian_note",
                inputSummary: file.path,
                content,
                sources: [{ path: file.path }],
                sourceRecords: createMetadataDependencyRecords("inspect_obsidian_note", dependencyPaths),
            };
            const budgetedResult = enforceToolOutputBudget(budgetDefinition, initialResult) as ChatToolResult<InspectObsidianNoteOutput>;
            const coverageRestoredResult = budgetedResult.content?.coverage
                ? budgetedResult
                : enforceToolOutputBudget(budgetDefinition, {
                    ...budgetedResult,
                    content: { ...budgetedResult.content, coverage: structure.coverage },
                }) as ChatToolResult<InspectObsidianNoteOutput>;
            if (!coverageRestoredResult.ok || !coverageRestoredResult.content) {
                throw new Error("inspect_obsidian_note budget enforcement removed its successful result.");
            }
            const frozenCacheProjection = projectInspectCache(cache);
            if (!backlinkEvaluation) throw new Error("inspect_obsidian_note did not capture its backlink scan domain.");
            const frozenLinkFacts = projectInspectLinkFactsFromBacklinkEvaluation(
                file.path,
                backlinkEvaluation,
                metadataCache,
            );
            const evidence = await buildInspectObservationEvidence({
                observationId: createVaultObservationId(`inspect-note-${++nextVaultObservationInstance}`),
                scope: observationScope(context),
                output: coverageRestoredResult.content,
                cacheProjection: frozenCacheProjection,
                linkFacts: frozenLinkFacts,
                ...(bodyRead ? { bodyContent: readResult.content } : {}),
            });
            return {
                ...coverageRestoredResult,
                vaultObservationEvidence: evidence,
                vaultObservationContractVersion: 1,
            };
        },
    }, options);
}

export function createReadCanvasSummaryTool(): ChatToolDefinition<ReadCanvasSummaryInput, ReadCanvasSummaryOutput> {
    return withTaskSourceReadBoundary({
        name: "read_canvas_summary",
        description: "Read a bounded JSON Canvas structure summary.",
        plannerGuidance: buildV1APlannerGuidance(["canvas", "safety"], [
            "Use when the user asks about a .canvas file's nodes, edges, groups, duplicate ids, dangling edges, isolated nodes, or short node text snippets.",
            "Only accept vault-relative .canvas paths. Do not use for Markdown notes.",
            "This returns Canvas structure and bounded snippets only; it must not return full Canvas text content.",
        ]),
        inputSchema: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: "Vault-relative .canvas path to summarize.",
                },
            },
            required: ["path"],
            additionalProperties: false,
        },
        permission: "read-only",
        cost: "free",
        outputBudgetChars: OBSIDIAN_OPERATIONS_V1A_MAX_OUTPUT_BUDGET_CHARS,
        requiresConfirmation: false,
        failureBehavior: "recoverable",
        statusMessageText: "Reading canvas structure",
        sourceBoundary: "read-only-tool",
        statusMessage: (input) => `Reading canvas structure: ${input.path}`,
        prepareArguments: prepareReadCanvasSummaryArguments,
        validateInput: validateReadCanvasSummaryInput,
        execute: async (input, context) => {
            throwIfAborted(context.signal);
            const file = findVaultFileByPath(context.host, input.path);
            if (!file || !file.path.toLowerCase().endsWith(".canvas")) {
                return createToolFailureResult("read_canvas_summary", input.path, "Requested Canvas file was not found.");
            }

            if (!canReadVaultFiles(context.host)) {
                return {
                    ok: true,
                    tool: "read_canvas_summary",
                    inputSummary: file.path,
                    content: createUnavailableCanvasSummary(file, VAULT_FILE_READ_UNAVAILABLE_SOURCE),
                    sources: [{ path: file.path }],
                };
            }

            const readResult = await readVaultFileWithBudget(context.host, file, CANVAS_MAX_READ_BYTES);
            throwIfAborted(context.signal);
            if (readResult.truncated) {
                return {
                    ok: true,
                    tool: "read_canvas_summary",
                    inputSummary: file.path,
                    content: createSkippedCanvasSummary(file, readResult.skippedForSize
                        ? VAULT_FILE_READ_SKIPPED_SIZE_SOURCE
                        : "vault file read truncated for size"),
                    sources: [{ path: file.path }],
                };
            }

            const summary = buildCanvasStructureSummary(file, readResult.content);
            if (!summary) {
                return createToolFailureResult("read_canvas_summary", input.path, "Requested Canvas file could not be parsed.");
            }
            return {
                ok: true,
                tool: "read_canvas_summary",
                inputSummary: file.path,
                content: summary,
                sources: [{ path: file.path }],
            };
        },
    });
}

export function createSearchVaultSnippetsTool(
    options: VaultToolPathFilterOptions = {},
): ChatToolDefinition<SearchVaultSnippetsInput, VaultSnippetSearchOutput> {
    const instancePrefix = `vault-snippets-instance-${++nextVaultSnippetSearchToolInstance}`;
    const identities = new SequentialVaultSnippetIdentityRegistry(instancePrefix);
    return withTaskSourceReadBoundary({
        name: "search_vault_snippets",
        description: "Search bounded Markdown snippets in the vault.",
        plannerGuidance: buildV1APlannerGuidance(["markdown", "safety"], [
            "Use when the user asks to find note passages or short snippets by text query.",
            "Use an optional vault-relative Markdown file or folder scope when supplied by the user.",
            "Return short snippets only. Do not return full note bodies.",
        ]),
        inputSchema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Text to search for in Markdown notes.",
                },
                limit: {
                    type: "integer",
                    description: "Maximum snippet matches to return.",
                    minimum: 1,
                    maximum: SNIPPET_MAX_LIMIT,
                },
                scope: {
                    type: "string",
                    description: "Optional vault-relative Markdown file or folder scope.",
                },
                part: {
                    type: "string",
                    enum: ["body", "properties", "all"],
                    description: "Note part to search; defaults to all saved Markdown text.",
                },
                caseSensitive: {
                    type: "boolean",
                    description: "Use a literal case-sensitive match; defaults to Unicode case-insensitive matching.",
                },
                cursor: {
                    type: "string",
                    description: "Opaque continuation cursor from this tool instance.",
                },
            },
            required: ["query"],
            additionalProperties: false,
        },
        permission: "read-only",
        cost: "free",
        outputBudgetChars: OBSIDIAN_OPERATIONS_V1A_MAX_OUTPUT_BUDGET_CHARS,
        requiresConfirmation: false,
        failureBehavior: "recoverable",
        statusMessageText: "Searching note snippets",
        sourceBoundary: "read-only-tool",
        statusMessage: (input) => input.scope
            ? `Searching note snippets: ${input.query} in ${input.scope}`
            : `Searching note snippets: ${input.query}`,
        prepareArguments: prepareSearchVaultSnippetsArguments,
        validateInput: validateSearchVaultSnippetsInput,
        execute: async (input, context) => {
            throwIfAborted(context.signal);
            const normalizedScope = input.scope ? normalizeBoundaryPath(input.scope) : undefined;
            if (
                input.scope
                && (!normalizedScope || (
                    normalizedScope.toLowerCase().endsWith(".md")
                    && !isAllowedPath(normalizedScope, options.isPathAllowed)
                ))
            ) {
                return createToolFailureResult(
                    "search_vault_snippets",
                    "excluded scope",
                    "Requested snippet scope was not available in the permitted vault scope.",
                );
            }
            const scopedInput = normalizedScope ? { ...input, scope: normalizedScope } : input;
            const filteredHost = options.isPathAllowed
                ? createPathFilteredHost(context.host, options.isPathAllowed)
                : context.host;
            const dependencyPaths = new Set<string>();
            try {
                const result = await executeVaultSnippetSearch({
                    input: scopedInput,
                    host: filteredHost,
                    instancePrefix,
                    identities,
                    signal: context.signal,
                    dependencyPaths,
                    isPathReadable: path => isAllowedPath(path, options.isPathAllowed)
                        && isTaskSourcePathAllowed(context.taskSourceReadGuard, path),
                    assertCurrent: () => {
                        throwIfAborted(context.signal);
                        assertTaskSourceReadCurrent(context.taskSourceReadGuard);
                    },
                });
                const evidence = await buildSnippetObservationEvidence({
                    observationId: createVaultObservationId(`vault-snippets-${++nextVaultObservationInstance}`),
                    scope: observationScope(context),
                    output: result.content,
                    candidatePaths: result.evidence.candidatePaths,
                    scannedVersions: result.evidence.scannedVersions,
                });
                return {
                    ok: true,
                    tool: "search_vault_snippets",
                    inputSummary: scopedInput.scope ? `${input.query} in ${scopedInput.scope}` : input.query,
                    content: result.content,
                    sources: result.matchPaths.map(path => ({ path })),
                    sourceRecords: createMetadataDependencyRecords("search_vault_snippets", dependencyPaths),
                    vaultObservationEvidence: evidence,
                    vaultObservationContractVersion: 1,
                };
            } catch (error) {
                if (error instanceof VaultSnippetSearchUnavailableError
                    || error instanceof VaultSnippetCursorExpiredError
                    || error instanceof VaultSnippetResultBudgetUnavailableError) {
                    return createToolFailureResult("search_vault_snippets", input.query, error.message);
                }
                throw error;
            }
        },
    }, { ...options, failClosedMarkdownEnumeration: true });
}

/** Bind the tool's real read methods to this call's Host-owned source lifetime. */
function withTaskSourceReadBoundary<Input, Output>(
    definition: ChatToolDefinition<Input, Output>,
    options: VaultToolPathFilterOptions & { failClosedMarkdownEnumeration?: boolean } = {},
): ChatToolDefinition<Input, Output> {
    const execute = definition.execute;
    return {
        ...definition,
        execute: async (input, context) => {
            const guard = context.taskSourceReadGuard;
            if (!guard) return execute(input, context);
            assertTaskSourceReadCurrent(guard);
            const admittedPaths = new Set<string>();
            const host = createPathFilteredHost(context.host,
                (path) => {
                    const allowed = isAllowedPath(path, options.isPathAllowed) && isTaskSourcePathAllowed(guard, path);
                    if (allowed) admittedPaths.add(path);
                    return allowed;
                }, guard, options.failClosedMarkdownEnumeration);
            const result = await execute(input, { ...context, host });
            assertTaskSourceReadCurrent(guard);
            for (const path of admittedPaths) {
                if (!isAllowedPath(path, options.isPathAllowed) || !isTaskSourcePathAllowed(guard, path)) {
                    throw new Error("Task source path is no longer permitted.");
                }
            }
            for (const source of result.sources ?? []) {
                if (!isTaskSourcePathAllowed(guard, source.path)) throw new Error("Task source path is no longer permitted.");
            }
            return result;
        },
    };
}

function normalizeBoundaryPath(path: string): string | undefined {
    const normalized = String(path ?? "")
        .trim()
        .replace(/\\/g, "/")
        .replace(/^\.\/+/, "")
        .replace(/\/+/g, "/")
        .replace(/\/$/g, "");
    if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return undefined;
    const segments = normalized.split("/");
    if (segments.some((segment) => segment === ".." || segment === "")) return undefined;
    return segments.filter((segment) => segment !== ".").join("/");
}

function isAllowedPath(
    path: string,
    isPathAllowed: VaultToolPathFilterOptions["isPathAllowed"],
): boolean {
    if (!isPathAllowed) return true;
    const normalized = normalizeBoundaryPath(path);
    if (!normalized) return false;
    try {
        return isPathAllowed(normalized) === true;
    } catch {
        return false;
    }
}

function normalizeContentCharLimit(value: number | undefined): number {
    if (!Number.isFinite(value) || (value ?? 0) <= 0) return 0;
    return Math.min(Math.floor(value!), 8_000);
}

function createPathFilteredHost(
    host: ChatToolContext["host"],
    isPathAllowed: (path: string) => boolean,
    guard?: TaskSourceReadGuard,
    failClosedMarkdownEnumeration = false,
): ChatToolContext["host"] {
    const assertAllowed = (path: string) => {
        assertTaskSourceReadCurrent(guard);
        if (!isAllowedPath(path, isPathAllowed)) throw new Error("Vault path is outside the permitted scope.");
    };
    const sourceVault = host.app.vault as unknown as {
        getMarkdownFiles?: () => Array<{ path: string }>;
        getAbstractFileByPath?: (path: string) => unknown;
        cachedRead?: (file: { path: string }) => Promise<string>;
    };
    const filteredVault: {
        getMarkdownFiles: () => Array<{ path: string }>;
        getAbstractFileByPath: (path: string) => unknown;
        cachedRead?: (file: { path: string }) => Promise<string>;
    } = {
        getMarkdownFiles: () => {
            assertTaskSourceReadCurrent(guard);
            if (typeof sourceVault.getMarkdownFiles !== "function" && failClosedMarkdownEnumeration) {
                throw new QueryNotesUnavailableError("Vault getMarkdownFiles is unavailable.");
            }
            const files = (sourceVault.getMarkdownFiles?.() ?? [])
                .filter((file) => isAllowedPath(file.path, isPathAllowed));
            assertTaskSourceReadCurrent(guard);
            return files;
        },
        getAbstractFileByPath: (path: string) => {
            assertTaskSourceReadCurrent(guard);
            const normalized = normalizeBoundaryPath(path);
            const file = normalized && isAllowedPath(normalized, isPathAllowed)
                ? sourceVault.getAbstractFileByPath?.(normalized) ?? null
                : null;
            assertTaskSourceReadCurrent(guard);
            if (file && typeof file === "object" && "path" in file) assertAllowed(String(file.path));
            return file;
        },
    };
    if (typeof sourceVault.cachedRead === "function") {
        filteredVault.cachedRead = async (file: { path: string }) => {
            try {
                assertAllowed(file.path);
                const cachedRead = sourceVault.cachedRead;
                if (typeof cachedRead !== "function") {
                    throw new Error("Vault cachedRead is unavailable.");
                }
                const content = await cachedRead.call(sourceVault, file);
                if (typeof content !== "string") {
                    throw new Error("Vault cachedRead did not return a string.");
                }
                assertAllowed(file.path);
                return content;
            } catch (error) {
                throw new VaultSnippetSearchUnavailableError(
                    error instanceof Error ? error.message : "Vault cachedRead failed.",
                );
            }
        };
    }
    const filteredApp = Object.create(host.app) as ChatToolContext["host"]["app"];
    Object.defineProperty(filteredApp, "vault", {
        configurable: true,
        enumerable: true,
        value: filteredVault,
    });
    const metadata = getOptionalMetadataCache(host);
    if (metadata) {
        const filteredMetadata = Object.create(metadata) as typeof metadata;
        if (typeof metadata.getFileCache === "function") {
            Object.defineProperty(filteredMetadata, "getFileCache", { value: (file: Parameters<NonNullable<typeof metadata.getFileCache>>[0]) => {
                assertAllowed(file.path);
                const cache = metadata.getFileCache!(file);
                assertAllowed(file.path);
                return cache;
            } });
        }
        for (const name of ["resolvedLinks", "unresolvedLinks"] as const) {
            Object.defineProperty(filteredMetadata, name, { get: () => {
                assertTaskSourceReadCurrent(guard);
                const source = metadata[name];
                if (!source) return source;
                const links: Record<string, Record<string, number>> = Object.create(null);
                // Enumerate paths, but never inspect the link facts of an excluded source.
                for (const path of Object.keys(source)) {
                    if (!isAllowedPath(path, isPathAllowed)) continue;
                    assertAllowed(path);
                    Object.defineProperty(links, path, {
                        enumerable: true,
                        get: () => {
                            assertAllowed(path);
                            return source[path];
                        },
                    });
                }
                assertTaskSourceReadCurrent(guard);
                return links;
            } });
        }
        Object.defineProperty(filteredApp, "metadataCache", { value: filteredMetadata });
    }
    const filteredHost = Object.create(host) as ChatToolContext["host"];
    Object.defineProperty(filteredHost, "app", {
        configurable: true,
        enumerable: true,
        value: filteredApp,
    });
    return filteredHost;
}

export function createListVaultTagsTool(): ChatToolDefinition<ListVaultTagsInput, VaultTagsOutput> {
    return withTaskSourceReadBoundary({
        name: "list_vault_tags",
        description: "List vault tag counts and representative note paths.",
        plannerGuidance: buildV1APlannerGuidance(["markdown", "safety"], [
            "Use when the user asks what tags exist, which tags are common, or where a tag appears.",
            "This returns metadata-only tag counts and representative paths.",
        ]),
        inputSchema: {
            type: "object",
            properties: {
                limit: {
                    type: "integer",
                    description: "Maximum tags to return.",
                    minimum: 1,
                    maximum: TAGS_MAX_LIMIT,
                },
            },
            additionalProperties: false,
        },
        permission: "read-only",
        cost: "free",
        outputBudgetChars: 5000,
        requiresConfirmation: false,
        failureBehavior: "recoverable",
        statusMessageText: "Reading vault tags",
        sourceBoundary: "read-only-tool",
        statusMessage: () => "Reading vault tags",
        validateInput: validateListVaultTagsInput,
        execute: async (input, context) => {
            throwIfAborted(context.signal);
            const dependencyPaths = new Set<string>();
            const result = await listVaultTags(context.host, input.limit, context.signal, path => dependencyPaths.add(path));
            return {
                ok: true,
                tool: "list_vault_tags",
                inputSummary: `limit:${input.limit}`,
                content: result,
                sources: [],
                sourceRecords: createMetadataDependencyRecords("list_vault_tags", dependencyPaths),
            };
        },
    });
}

/** Host-only lifetime dependencies; never add these paths to the visible source list. */
function createMetadataDependencyRecords(capabilityName: string, paths: ReadonlySet<string>): SourceRecord[] {
    return [...paths].map(path => ({
        kind: "context-used",
        dedupKey: createSourceDedupKey(path),
        capabilityName,
        sourceBoundary: "read-only-tool",
        path,
        statusOnly: true,
        redacted: true,
        citationEligible: false,
        metadata: { sourceDependency: true },
    }));
}

/** Each host-admitted subrequest can submit at most once, even if the model calls the tool again. */
export function createCreateImageTool(binding: CreateImageHostBinding): ChatToolDefinition<
    CreateImageToolInput,
    { status: "accepted" | "already_accepted"; taskId: string; message?: string }
> {
    const submitted = new Map<number, { receipt: Promise<{ taskId: string }>; input: CreateImageToolInput }>();
    return {
        name: "create_image",
        description: "Start an image creation or edit requested by the user. Returns an accepted background task, not a completed image.",
        plannerGuidance: [
            "Use for an explicit image creation or edit request, including @CreateImage. Merely discussing images or attaching an image is not a generation request.",
            "Choose generate for text-only creation, reference for inspiration from authorized images, or edit for changing a specific image. Preserve the user's requested subject and constraints.",
            "Use only exact registered image ref tokens and version IDs visible in this conversation. The host rechecks access and costs; never invent a path, URL, credential or provider endpoint.",
            "Default to one image. Do not call again to silently retry or choose the best paid result. An accepted task continues in the background; do not claim its pixels are ready or viewed.",
            "Only when the user explicitly asks for separately described images in one message, use distinct one-based subrequestIndex values. The host enforces their shared image budget.",
        ],
        inputSchema: {
            type: "object",
            properties: {
                prompt: { type: "string", description: "Description of the requested image or change, retaining the user's constraints.", minLength: 1, maxLength: 10000 },
                operation: { type: "string", enum: ["generate", "reference", "edit"], description: "Creation from text, reference-based creation, or modification of a specific image." },
                count: { type: "integer", minimum: 1, maximum: 8, description: "Number of images explicitly requested by the user; omit for one." },
                subrequestIndex: { type: "integer", minimum: 1, maximum: 4, description: "Distinct requested image part, only for explicit separate descriptions; omit for one request." },
                referenceImageRefs: { type: "array", description: "Exact opaque refs for authorized chat images; no paths or URLs.", items: { type: "string", maxLength: 256 } },
                parentVersionId: { type: "string", description: "Exact generated version ID when editing a previous result.", maxLength: 256 },
            },
            required: ["prompt", "operation"],
            additionalProperties: false,
        },
        permission: "image-generation",
        cost: "ai-calls",
        outputBudgetChars: 400,
        requiresConfirmation: false,
        failureBehavior: "recoverable",
        statusMessageText: "Starting image creation",
        sourceBoundary: "read-only-tool",
        statusMessage: () => "Starting image creation",
        validateInput: (raw) => {
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("create_image input must be an object.");
            const value = raw as Record<string, unknown>;
            const allowed = new Set(["prompt", "operation", "count", "subrequestIndex", "referenceImageRefs", "parentVersionId"]);
            if (Object.keys(value).some(key => !allowed.has(key))) throw new Error("create_image has unsupported arguments.");
            const prompt = typeof value.prompt === "string" ? value.prompt.trim() : "";
            if (!prompt || prompt.length > 10000) throw new Error("create_image requires a valid prompt.");
            const operation = value.operation;
            if (operation !== "generate" && operation !== "reference" && operation !== "edit") {
                throw new Error("create_image requires a valid operation.");
            }
            const count = value.count === undefined ? 1 : value.count;
            if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 8) {
                throw new Error("create_image count is out of range.");
            }
            const subrequestIndex = value.subrequestIndex;
            if (subrequestIndex !== undefined && (!Number.isInteger(subrequestIndex)
                || (subrequestIndex as number) < 1 || (subrequestIndex as number) > 4)) {
                throw new Error("create_image subrequest index is out of range.");
            }
            const refs = value.referenceImageRefs === undefined ? [] : value.referenceImageRefs;
            if (!Array.isArray(refs) || refs.length > 8
                || refs.some(ref => typeof ref !== "string" || !/^[A-Za-z0-9:_-]{1,256}$/.test(ref))
                || new Set(refs).size !== refs.length) {
                throw new Error("create_image image refs are invalid.");
            }
            const parentVersionId = value.parentVersionId;
            if (parentVersionId !== undefined
                && (typeof parentVersionId !== "string" || !/^[A-Za-z0-9:_-]{1,256}$/.test(parentVersionId))) {
                throw new Error("create_image parent version is invalid.");
            }
            return { prompt, operation, count: count as number, referenceImageRefs: refs,
                ...(subrequestIndex === undefined ? {} : { subrequestIndex: subrequestIndex as number }),
                ...(parentVersionId ? { parentVersionId } : {}) };
        },
        execute: async (input) => {
            const index = input.subrequestIndex ?? 1;
            const prior = submitted.get(index);
            const alreadySubmitted = prior !== undefined;
            const entry = prior ?? { input, receipt: Promise.resolve().then(() => binding.submit(input)) };
            if (!prior) submitted.set(index, entry);
            const inputSummary = `${entry.input.operation}; count:${entry.input.count}`;
            try {
                const accepted = await entry.receipt;
                if (!accepted || typeof accepted.taskId !== "string" || !accepted.taskId) {
                    throw new Error("Image task receipt missing.");
                }
                return { ok: true, tool: "create_image", inputSummary,
                    content: alreadySubmitted
                        ? { status: "already_accepted", taskId: accepted.taskId,
                            message: "This user request already has an image task. Changes require a new user request." }
                        : { status: "accepted", taskId: accepted.taskId },
                    sources: [] };
            } catch (error) {
                const reason = error instanceof Error ? error.message : '';
                const message = reason.includes('image_generation:connection_unavailable')
                    ? 'Image generation needs a compatible Wan connection in Settings.'
                    : reason.includes('image_generation:credential_unavailable')
                        ? 'The image service key is unavailable. Check the image connection settings.'
                        : reason.includes('image_generation:count_exceeds_provider_limit')
                            ? 'Wan supports up to 4 images in one request. Ask the user to choose 1–4 images.'
                        : reason.includes('image_generation:count_needs_confirmation')
                            ? 'The image count is not explicit. Ask the user before creating more than one image.'
                            : 'Could not confirm the image request. Check its card before trying again.';
                return { ok: false, tool: "create_image", inputSummary,
                    content: null, sources: [], error: message };
            }
        },
    };
}
