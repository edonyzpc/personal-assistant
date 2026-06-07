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
    CurrentNoteContextInput,
    CurrentNoteContextOutput,
    InspectObsidianNoteInput,
    InspectObsidianNoteOutput,
    ListRecentNotesInput,
    ListRecentNotesOutput,
    ListVaultTagsInput,
    PrepareToolArgumentsContext,
    ReadCanvasSummaryInput,
    ReadCanvasSummaryOutput,
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
import {
    CANVAS_MAX_READ_BYTES,
    CURRENT_NOTE_CONTENT_BUDGET_CHARS,
    CURRENT_NOTE_FULL_CONTENT_BUDGET_CHARS,
    INSPECT_NOTE_MAX_READ_BYTES,
    NOTE_OUTLINE_MAX_HEADINGS,
    RECENT_NOTES_MAX_LIMIT,
    SNIPPET_MAX_LIMIT,
    TAGS_MAX_LIMIT,
    VAULT_FILE_READ_SKIPPED_SIZE_SOURCE,
    VAULT_FILE_READ_UNAVAILABLE_SOURCE,
    VAULT_METADATA_MAX_LIMIT,
} from "./chat-tool-constants";
import {
    type EditorLike,
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
    getUnavailableNoteStructureSources,
    listVaultTags,
    readVaultFileWithBudget,
    scoreMetadataMatch,
    searchVaultSnippets,
    truncate,
} from "./chat-tool-execution-helpers";
import {
    validateCurrentNoteContextInput,
    validateInspectObsidianNoteInput,
    validateListRecentNotesInput,
    validateListVaultTagsInput,
    validateReadCanvasSummaryInput,
    validateReadNoteOutlineInput,
    validateSearchMemoryInput,
    validateSearchVaultMetadataInput,
    validateSearchVaultSnippetsInput,
} from "./chat-tool-guards";
import {
    extractInputPath,
    readFirstPositiveNumber,
    readFirstString,
    shouldUseFullCurrentNoteContext,
    toInputRecord,
} from "./chat-tool-prepare-helpers";
import {
    buildObsidianOperationsPlannerGuidance,
    type ObsidianOperationsCatalogSectionId,
} from "./obsidian-operations-capability-catalog";
import { throwIfAborted } from "./chat-utils";
import type { MemorySearchResult } from "./chat-types";

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

function prepareCurrentNoteContextArguments(raw: unknown, ctx: PrepareToolArgumentsContext): unknown {
    if (shouldUseFullCurrentNoteContext(ctx.userInput)) {
        return { mode: "full" };
    }
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
    const normalized = normalizeQueryWithOptionalLimit(raw, VAULT_SNIPPETS_QUERY_ALIASES, { includeLimit: true });
    const record = toInputRecord(raw);
    const scope = record ? readFirstString(record, VAULT_SNIPPETS_SCOPE_ALIASES) : undefined;
    if (scope && normalized && typeof normalized === "object" && !Array.isArray(normalized)) {
        return { ...(normalized as Record<string, unknown>), scope };
    }
    return normalized;
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
    return {
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
        // host-context shim: shouldUseFullCurrentNoteContext OVERRIDES any model-picked
        // mode when user phrasing matches "current note only + find/exact/搜索/全文" etc.
        // This is host-policy behavior; candidate to move into runtime instruction in Phase B/C.
        prepareArguments: prepareCurrentNoteContextArguments,
        validateInput: validateCurrentNoteContextInput,
        execute: async (input, context) => {
            throwIfAborted(context.signal);
            const view = findCurrentMarkdownView(context.plugin.app.workspace);
            if (!view?.file?.path) {
                return createToolFailureResult(
                    "get_current_note_context",
                    input.mode,
                    "No active Markdown note was available.",
                );
            }

            const file = view.file;
            const editor = view.editor as EditorLike | undefined;
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
    };
}

export function createSearchVaultMetadataTool(): ChatToolDefinition<SearchVaultMetadataInput, SearchVaultMetadataOutput> {
    return {
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
            const metadataCache = getMetadataCache(context.plugin);
            const querySignals = buildMetadataQuerySignals(input.query);
            const matches = getMarkdownFiles(context.plugin)
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
    };
}

export function createListRecentNotesTool(): ChatToolDefinition<ListRecentNotesInput, ListRecentNotesOutput> {
    return {
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
            const notes = getMarkdownFiles(context.plugin)
                .map(fileToRecentNote)
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
    };
}

export function createReadNoteOutlineTool(): ChatToolDefinition<ReadNoteOutlineInput, ReadNoteOutlineOutput> {
    return {
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
            const file = findMarkdownFileByPath(context.plugin, input.path);
            if (!file) {
                return createToolFailureResult(
                    "read_note_outline",
                    input.path,
                    "Requested Markdown note was not found.",
                );
            }

            const cache = getMetadataCache(context.plugin).getFileCache?.(file);
            const cachedHeadings = extractOutlineFromCache(cache, input.maxHeadings);
            const outline = cachedHeadings ?? await extractOutlineFromFile(context.plugin, file, input.maxHeadings);
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
    };
}

export function createInspectObsidianNoteTool(): ChatToolDefinition<InspectObsidianNoteInput, InspectObsidianNoteOutput> {
    return {
        name: "inspect_obsidian_note",
        description: "Read a bounded Obsidian Markdown note structure summary.",
        plannerGuidance: buildV1APlannerGuidance(["markdown", "safety"], [
            "Use when the user asks about note properties, tags, headings, tasks, callouts, embeds, links, backlinks, or unresolved links.",
            "Use without a path for the active Markdown note; use a vault-relative .md path when a target note is known.",
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
            const file = input.path
                ? findMarkdownFileByPath(context.plugin, input.path)
                : findCurrentMarkdownView(context.plugin.app.workspace)?.file ?? null;
            if (!file) {
                return createToolFailureResult(
                    "inspect_obsidian_note",
                    input.path ?? "current note",
                    input.path ? "Requested Markdown note was not found." : "No active Markdown note was available.",
                );
            }

            const metadataCache = getOptionalMetadataCache(context.plugin);
            const cache = metadataCache?.getFileCache?.(file);
            const readResult = await readVaultFileWithBudget(context.plugin, file, INSPECT_NOTE_MAX_READ_BYTES);
            throwIfAborted(context.signal);
            const unavailableSources = getUnavailableNoteStructureSources(context.plugin, metadataCache);
            const structure = buildNoteStructureSummary(file, cache, readResult.content, metadataCache, unavailableSources, {
                truncated: readResult.truncated,
                skippedSources: readResult.skippedForSize ? [VAULT_FILE_READ_SKIPPED_SIZE_SOURCE] : [],
                omittedCount: readResult.truncated ? 1 : 0,
            });
            return {
                ok: true,
                tool: "inspect_obsidian_note",
                inputSummary: file.path,
                content: structure,
                sources: [{ path: file.path }],
            };
        },
    };
}

export function createReadCanvasSummaryTool(): ChatToolDefinition<ReadCanvasSummaryInput, ReadCanvasSummaryOutput> {
    return {
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
            const file = findVaultFileByPath(context.plugin, input.path);
            if (!file || !file.path.toLowerCase().endsWith(".canvas")) {
                return createToolFailureResult("read_canvas_summary", input.path, "Requested Canvas file was not found.");
            }

            if (!canReadVaultFiles(context.plugin)) {
                return {
                    ok: true,
                    tool: "read_canvas_summary",
                    inputSummary: file.path,
                    content: createUnavailableCanvasSummary(file, VAULT_FILE_READ_UNAVAILABLE_SOURCE),
                    sources: [{ path: file.path }],
                };
            }

            const readResult = await readVaultFileWithBudget(context.plugin, file, CANVAS_MAX_READ_BYTES);
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
    };
}

export function createSearchVaultSnippetsTool(): ChatToolDefinition<SearchVaultSnippetsInput, VaultSnippetSearchOutput> {
    return {
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
            const result = await searchVaultSnippets(context.plugin, input, context.signal);
            return {
                ok: true,
                tool: "search_vault_snippets",
                inputSummary: input.scope ? `${input.query} in ${input.scope}` : input.query,
                content: result,
                sources: result.matches.map((match) => ({ path: match.path })),
            };
        },
    };
}

export function createListVaultTagsTool(): ChatToolDefinition<ListVaultTagsInput, VaultTagsOutput> {
    return {
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
            const result = await listVaultTags(context.plugin, input.limit, context.signal);
            return {
                ok: true,
                tool: "list_vault_tags",
                inputSummary: `limit:${input.limit}`,
                content: result,
                sources: [],
            };
        },
    };
}
