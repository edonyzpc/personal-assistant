import type { PluginManager } from "../plugin";
import { BUILTIN_WEB_SEARCH_TOOL_NAME } from "./builtin-web-search-provider";
import type { CapabilityRegistry } from "./capability-registry";
import type { AgentRuntimePlatform } from "./capability-types";
import {
    type CurrentNoteContextInput,
    isCurrentNoteContextResult,
    isSearchMemoryResult,
} from "./chat-tools";
import type {
    ChatAgentSource,
    ChatContextUsedItem,
    ChatToolResult,
    SourceRecord,
} from "./chat-types";
import type {
    PaAgentToolCall,
    PaAgentToolExecutionInput,
    PaAgentToolExecutionResult,
    PaAgentToolExecutor,
} from "./pa-agent-loop";
import { isExplicitCurrentNoteOnlyRequest } from "./pa-agent-required-capability-policy";

const MAX_PREVIEW_CHARS = 1200;

export interface PaAgentCapabilityToolExecutorOptions {
    registry: CapabilityRegistry;
    plugin: PluginManager;
    platform?: AgentRuntimePlatform;
    onBeforeVssSearch?: () => void;
    onToolRunning?: (tool: string, message: string) => void;
    allowedToolNames?: ReadonlySet<string>;
    blockedToolNames?: ReadonlySet<string>;
}

export function createPaAgentCapabilityToolExecutor(
    options: PaAgentCapabilityToolExecutorOptions,
): PaAgentToolExecutor {
    return {
        execute: async (input: PaAgentToolExecutionInput): Promise<PaAgentToolExecutionResult> => {
            const normalizedToolCall = normalizeHostToolCallInput(input.toolCall, input.userInput);
            if (!isAllowedHostToolCall(normalizedToolCall.name, options)) {
                return {
                    outcome: "policy_rejected",
                    promptText: `Tool ${normalizedToolCall.name} was skipped because the user limited this request to different available context.`,
                    previewText: `Skipped ${normalizedToolCall.name}; outside the user-requested context scope.`,
                    metadata: {
                        outcome: "policy_rejected",
                        reason: "tool_outside_user_requested_scope",
                    },
                };
            }
            const result = await options.registry.execute(
                normalizedToolCall.name,
                normalizedToolCall.input,
                {
                    plugin: options.plugin,
                    turnId: input.turnId,
                    signal: input.signal,
                    platform: options.platform ?? "desktop",
                    onBeforeVssSearch: options.onBeforeVssSearch,
                    onToolRunning: options.onToolRunning,
                },
            );
            const canonicalResult = chatToolResultToPaAgentToolExecutionResult(normalizedToolCall, result);
            return {
                ...canonicalResult,
                sourceRecords: canonicalResult.sourceRecords?.map((record) => ({
                    ...record,
                    turnId: record.turnId ?? input.turnId,
                })),
            };
        },
    };
}

function isAllowedHostToolCall(toolName: string, options: PaAgentCapabilityToolExecutorOptions): boolean {
    if (options.allowedToolNames && !options.allowedToolNames.has(toolName)) return false;
    if (options.blockedToolNames?.has(toolName)) return false;
    return true;
}

function normalizeHostToolCallInput(toolCall: PaAgentToolCall, userInput: string): PaAgentToolCall {
    switch (toolCall.name) {
        case "search_memory":
            return {
                ...toolCall,
                input: normalizeSearchMemoryInput(toolCall.input, userInput),
            };
        case BUILTIN_WEB_SEARCH_TOOL_NAME:
            return {
                ...toolCall,
                input: normalizeWebSearchInput(toolCall.input, userInput),
            };
        case "get_current_note_context":
            return {
                ...toolCall,
                input: normalizeCurrentNoteContextInput(toolCall.input, userInput),
            };
        case "search_vault_metadata":
            return {
                ...toolCall,
                input: normalizeVaultMetadataInput(toolCall.input, userInput),
            };
        case "search_vault_snippets":
            return {
                ...toolCall,
                input: normalizeVaultSnippetsInput(toolCall.input, userInput),
            };
        case "read_note_outline":
            return {
                ...toolCall,
                input: normalizeReadNoteOutlineInput(toolCall.input, userInput),
            };
        case "inspect_obsidian_note":
            return {
                ...toolCall,
                input: normalizeInspectObsidianNoteInput(toolCall.input, userInput),
            };
        case "read_canvas_summary":
            return {
                ...toolCall,
                input: normalizeReadCanvasSummaryInput(toolCall.input, userInput),
            };
        default:
            return toolCall;
    }
}

function normalizeSearchMemoryInput(input: unknown, fallbackQuery: string): unknown {
    const fallback = fallbackQuery.trim();
    if (typeof input === "string") {
        const query = input.trim();
        return query ? { query } : (fallback ? { query: fallback } : input);
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return fallback ? { query: fallback } : input;
    }

    const value = input as Record<string, unknown>;
    const query = readFirstString(value, [
        "query",
        "q",
        "searchQuery",
        "search_query",
        "keywords",
        "keyword",
        "input",
        "prompt",
        "question",
    ]);
    const fallbackOrQuery = query ?? fallback;
    return fallbackOrQuery ? { query: fallbackOrQuery } : input;
}

function normalizeWebSearchInput(input: unknown, fallbackQuery: string): unknown {
    const fallback = fallbackQuery.trim();
    if (typeof input === "string") {
        const query = input.trim();
        return query ? { query } : (fallback ? { query: fallback } : input);
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return fallback ? { query: fallback } : input;
    }

    const value = input as Record<string, unknown>;
    const query = readFirstString(value, [
        "query",
        "q",
        "searchQuery",
        "search_query",
        "searchTerms",
        "search_terms",
        "keywords",
        "keyword",
        "input",
        "prompt",
        "question",
    ]);
    const fallbackOrQuery = query ?? fallback;
    if (!fallbackOrQuery) {
        return input;
    }

    const normalized: { query: string; limit?: number } = { query: fallbackOrQuery };
    const limit = readFirstPositiveNumber(value, [
        "limit",
        "count",
        "maxResults",
        "max_results",
        "numResults",
        "num_results",
        "topK",
        "top_k",
    ]);
    if (limit !== undefined) {
        normalized.limit = limit;
    }
    return normalized;
}

function readFirstString(value: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
        const candidate = value[key];
        if (typeof candidate === "string") {
            const trimmed = candidate.trim();
            if (trimmed) return trimmed;
        }
    }
    const nestedInput = value.input;
    if (nestedInput && typeof nestedInput === "object" && !Array.isArray(nestedInput)) {
        return readFirstString(nestedInput as Record<string, unknown>, keys.filter((key) => key !== "input"));
    }
    return undefined;
}

function readFirstPositiveNumber(value: Record<string, unknown>, keys: string[]): number | undefined {
    for (const key of keys) {
        const candidate = value[key];
        const numericValue = typeof candidate === "number"
            ? candidate
            : typeof candidate === "string"
                ? Number(candidate.trim())
                : Number.NaN;
        if (Number.isFinite(numericValue) && numericValue > 0) {
            return Math.floor(numericValue);
        }
    }
    const nestedInput = value.input;
    if (nestedInput && typeof nestedInput === "object" && !Array.isArray(nestedInput)) {
        return readFirstPositiveNumber(nestedInput as Record<string, unknown>, keys.filter((key) => key !== "input"));
    }
    return undefined;
}

function normalizeCurrentNoteContextInput(input: unknown, userInput: string): CurrentNoteContextInput {
    if (shouldUseFullCurrentNoteContext(userInput)) {
        return { mode: "full" };
    }

    const rawMode = input && typeof input === "object" && !Array.isArray(input)
        ? (input as Record<string, unknown>).mode
        : input;
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

function shouldUseFullCurrentNoteContext(userInput: string): boolean {
    if (!isExplicitCurrentNoteOnlyRequest(userInput)) return false;
    return /\b(token|prefix|exact|identifier|id|find|search|contains?|match|full token|whole token)\b/i.test(userInput)
        || /查找|寻找|搜索|精确|完整\s*token|全文|前缀/.test(userInput);
}

function normalizeVaultMetadataInput(input: unknown, userInput: string): unknown {
    const fallbackQuery = extractQueryFromUserInput(userInput, "search_vault_metadata");
    return normalizeQueryObjectInput(input, fallbackQuery, [
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
    ], { includeLimit: true });
}

function normalizeVaultSnippetsInput(input: unknown, userInput: string): unknown {
    const fallbackQuery = extractQueryFromUserInput(userInput, "search_vault_snippets");
    const normalized = normalizeQueryObjectInput(input, fallbackQuery, [
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
    ], { includeLimit: true });
    const inputRecord = toInputRecord(input);
    const scope = inputRecord ? readFirstString(inputRecord, ["scope", "path", "folder", "file"]) : undefined;
    if (scope && normalized && typeof normalized === "object" && !Array.isArray(normalized)) {
        return { ...(normalized as Record<string, unknown>), scope };
    }
    return normalized;
}

function normalizeReadNoteOutlineInput(input: unknown, userInput: string): unknown {
    return normalizePathObjectInput(input, userInput, [".md"], {
        pathKeys: ["path", "notePath", "note_path", "filePath", "file_path", "file", "note", "target", "input"],
        includeMaxHeadings: true,
    });
}

function normalizeInspectObsidianNoteInput(input: unknown, userInput: string): unknown {
    const path = extractInputPath(input, [".md"]) ?? extractPathFromUserInput(userInput, [".md"]);
    if (path) return { path };
    const inputRecord = toInputRecord(input);
    if (!inputRecord) return {};
    return typeof inputRecord.path === "string" && !inputRecord.path.trim() ? {} : input;
}

function normalizeReadCanvasSummaryInput(input: unknown, userInput: string): unknown {
    return normalizePathObjectInput(input, userInput, [".canvas"], {
        pathKeys: ["path", "canvasPath", "canvas_path", "filePath", "file_path", "file", "canvas", "target", "input"],
    });
}

function normalizeQueryObjectInput(
    input: unknown,
    fallbackQuery: string | undefined,
    queryKeys: string[],
    options: { includeLimit?: boolean } = {},
): unknown {
    if (typeof input === "string") {
        const query = input.trim() || fallbackQuery;
        return query ? { query } : input;
    }
    const inputRecord = toInputRecord(input);
    if (!inputRecord) {
        return fallbackQuery ? { query: fallbackQuery } : input;
    }
    const query = readFirstString(inputRecord, queryKeys) ?? fallbackQuery;
    if (!query) return input;

    const normalized: Record<string, unknown> = { query };
    if (options.includeLimit) {
        const limit = readFirstPositiveNumber(inputRecord, [
            "limit",
            "count",
            "maxResults",
            "max_results",
            "maxMatches",
            "max_matches",
            "topK",
            "top_k",
        ]);
        if (limit !== undefined) normalized.limit = limit;
    }
    return normalized;
}

function normalizePathObjectInput(
    input: unknown,
    userInput: string,
    extensions: readonly string[],
    options: {
        pathKeys: string[];
        includeMaxHeadings?: boolean;
    },
): unknown {
    const path = extractInputPath(input, extensions) ?? extractPathFromUserInput(userInput, extensions);
    if (!path) return input;
    const inputRecord = toInputRecord(input);
    const normalized: Record<string, unknown> = { path };
    if (options.includeMaxHeadings) {
        const maxHeadings = inputRecord
            ? readFirstPositiveNumber(inputRecord, ["max_headings", "maxHeadings", "headingLimit", "heading_limit", "limit"])
            : undefined;
        normalized.max_headings = maxHeadings ?? extractMaxHeadingsFromUserInput(userInput);
    }
    return normalized;
}

function extractInputPath(input: unknown, extensions: readonly string[]): string | undefined {
    if (typeof input === "string") {
        const candidate = input.trim();
        return hasAllowedExtension(candidate, extensions) ? candidate : undefined;
    }
    const inputRecord = toInputRecord(input);
    if (!inputRecord) return undefined;
    const path = readFirstString(inputRecord, [
        "path",
        "notePath",
        "note_path",
        "canvasPath",
        "canvas_path",
        "filePath",
        "file_path",
        "file",
        "note",
        "canvas",
        "target",
        "input",
    ]);
    return path && hasAllowedExtension(path, extensions) ? path : undefined;
}

function toInputRecord(input: unknown): Record<string, unknown> | undefined {
    return input && typeof input === "object" && !Array.isArray(input)
        ? input as Record<string, unknown>
        : undefined;
}

type QueryToolName = "search_vault_metadata" | "search_vault_snippets";

function extractQueryFromUserInput(userInput: string, tool: QueryToolName): string | undefined {
    const queryFromExplicitLabel = cleanExtractedQuery(matchFirst(userInput, [
        /\bquery\s+string\s*[:=]\s*["'`]?(.+?)(?=$|[\n.;]|,\s*(?:reply|return|do not)\b)/i,
        /\bquery\s*[:=]\s*["'`]?(.+?)(?=$|[\n.;]|,\s*(?:reply|return|do not)\b)/i,
        /\bwith\s+query\s+["'`]?(.+?)(?=$|[\n.;]|,\s*(?:reply|return|do not)\b)/i,
    ]));
    if (queryFromExplicitLabel) return queryFromExplicitLabel;

    if (tool === "search_vault_metadata") {
        return cleanExtractedQuery(matchFirst(userInput, [
            /\bsearch_vault_metadata\s+(?:with\s+)?(?:query\s+)?["'`]?(.+?)(?=$|[\n.;]|,\s*(?:reply|return|do not)\b)/i,
            /\bmetadata\s+(?:for|matching|query)\s+["'`]?(.+?)(?=$|[\n.;]|,\s*(?:reply|return|do not)\b)/i,
        ]));
    }

    return cleanExtractedQuery(matchFirst(userInput, [
        /\bsearch_vault_snippets\s+(?:with\s+)?(?:query\s+)?["'`]?(.+?)(?=$|[\n.;]|,\s*(?:reply|return|do not)\b)/i,
        /\bsearch\s+(?:note\s+)?snippets?\s+for\s+["'`]?(.+?)(?=$|[\n.;]|,\s*(?:reply|return|do not)\b)/i,
        /\bfind\s+(?:note\s+)?snippets?\s+for\s+["'`]?(.+?)(?=$|[\n.;]|,\s*(?:reply|return|do not)\b)/i,
        /\bexact\s+token\s+["'`]?([A-Za-z0-9_.:/#@-]+)/i,
        /\bprefix\s+(?:is\s+)?["'`]?([A-Za-z0-9_.:/#@-]+)/i,
    ]));
}

function extractPathFromUserInput(userInput: string, extensions: readonly string[]): string | undefined {
    const extensionPattern = extensions
        .map((extension) => extension.replace(/^\./, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|");
    const pathPattern = new RegExp(
        `(^|[\\s"'\\\`])((?:[A-Za-z0-9_.@#()+-]+\\/)*[A-Za-z0-9_.@#()+-]+\\.(${extensionPattern}))(?=$|[\\s"'\\\`,.;)])`,
        "i",
    );
    const match = userInput.match(pathPattern);
    return match?.[2]?.trim();
}

function extractMaxHeadingsFromUserInput(userInput: string): number | undefined {
    const direct = userInput.match(/\b(?:first|top)\s+(\d{1,2})\s+headings?\b/i);
    if (direct?.[1]) return Number(direct[1]);
    const word = userInput.match(/\b(?:first|top)\s+(one|two|three|four|five|six|seven|eight|nine|ten)\s+headings?\b/i)?.[1];
    if (!word) return undefined;
    return {
        one: 1,
        two: 2,
        three: 3,
        four: 4,
        five: 5,
        six: 6,
        seven: 7,
        eight: 8,
        nine: 9,
        ten: 10,
    }[word.toLowerCase() as "one" | "two" | "three" | "four" | "five" | "six" | "seven" | "eight" | "nine" | "ten"];
}

function hasAllowedExtension(value: string, extensions: readonly string[]): boolean {
    const normalized = value.trim().toLowerCase();
    return extensions.some((extension) => normalized.endsWith(extension.toLowerCase()));
}

function matchFirst(value: string, patterns: RegExp[]): string | undefined {
    for (const pattern of patterns) {
        const match = value.match(pattern);
        const candidate = match?.[1]?.trim();
        if (candidate) return candidate;
    }
    return undefined;
}

function cleanExtractedQuery(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const cleaned = value
        .replace(/\s+\b(?:and\s+)?(?:reply|return|respond|tell|list|do not|don't|without)\b[\s\S]*$/i, "")
        .replace(/^[:"'`\s]+|[."'`,;:\s]+$/g, "")
        .trim();
    return cleaned || undefined;
}

export function chatToolResultToPaAgentToolExecutionResult(
    toolCall: PaAgentToolCall,
    result: ChatToolResult<unknown>,
): PaAgentToolExecutionResult {
    const outcome = result.ok ? "success" : "recoverable_error";
    const promptText = serializeToolObservation(result);
    const sourceRecords = cloneSourceRecords(result.sourceRecords ?? []);
    const contextUsed = buildContextUsed(result, sourceRecords);
    return {
        outcome,
        promptText,
        previewText: truncate(result.error ?? promptText, MAX_PREVIEW_CHARS),
        sourceRecords,
        contextUsed,
        metadata: {
            outcome,
            tool: result.tool,
            toolCallId: toolCall.id,
            inputSummary: result.inputSummary,
            ok: result.ok,
            sourceRecordCount: sourceRecords.length,
            contextUsedCount: contextUsed.length,
        },
    };
}

function serializeToolObservation(result: ChatToolResult<unknown>): string {
    return safeStringify({
        tool: result.tool,
        status: result.ok ? "ok" : "unavailable",
        input: result.inputSummary,
        ...(result.ok ? { observation: result.content } : { error: result.error ?? "Tool unavailable." }),
    });
}

function buildContextUsed(
    result: ChatToolResult<unknown>,
    sourceRecords: SourceRecord[],
): ChatContextUsedItem[] {
    if (!result.ok) {
        return [createUnavailableContextUsed(result)];
    }
    if (result.tool === "search_memory") {
        return [createMemoryContextUsed(result)];
    }
    if (result.tool === "get_current_note_context") {
        return [createCurrentNoteContextUsed(result)];
    }
    if (result.tool === BUILTIN_WEB_SEARCH_TOOL_NAME) {
        return [createWebSearchContextUsed(result, sourceRecords)];
    }
    return [createReadOnlyToolContextUsed(result)];
}

function createMemoryContextUsed(result: ChatToolResult<unknown>): ChatContextUsedItem {
    const memory = isSearchMemoryResult(result.content) ? result.content : undefined;
    const sources = dedupeSources(result.sources);
    const sourceCount = sources.length;
    return {
        category: "memory",
        label: "Selected Memory",
        detail: memory?.skipReason
            ?? (sourceCount === 1 ? "1 selected note" : `${sourceCount} selected notes`),
        sources,
        citationEligible: true,
        ...(sourceCount === 0 ? { statusOnly: true } : {}),
    };
}

function createCurrentNoteContextUsed(result: ChatToolResult<unknown>): ChatContextUsedItem {
    const currentNote = isCurrentNoteContextResult(result.content) ? result.content : undefined;
    return {
        category: "current-note",
        label: "Current note",
        detail: currentNote?.mode
            ? `Read-only current note context (${currentNote.mode})`
            : "Read-only current note context",
        sources: dedupeSources(result.sources),
        citationEligible: false,
    };
}

function createWebSearchContextUsed(
    result: ChatToolResult<unknown>,
    sourceRecords: SourceRecord[],
): ChatContextUsedItem {
    const webSourceCount = sourceRecords.filter((record) => record.kind === "web-source").length;
    return {
        category: "read-only-tool",
        label: "WebSearch",
        detail: webSourceCount === 1 ? "1 normalized web source" : `${webSourceCount} normalized web sources`,
        citationEligible: false,
        ...(webSourceCount === 0 ? { statusOnly: true } : {}),
    };
}

function createReadOnlyToolContextUsed(result: ChatToolResult<unknown>): ChatContextUsedItem {
    const info = getReadOnlyToolContextInfo(result.tool);
    return {
        ...info,
        sources: dedupeSources(result.sources),
        citationEligible: false,
    };
}

function createUnavailableContextUsed(result: ChatToolResult<unknown>): ChatContextUsedItem {
    const info = getReadOnlyToolContextInfo(result.tool);
    return {
        category: "tool-unavailable",
        label: `${info.label} unavailable`,
        detail: result.error ?? "Tool was unavailable for this turn.",
        citationEligible: false,
        statusOnly: true,
    };
}

function getReadOnlyToolContextInfo(
    tool: string,
): Pick<ChatContextUsedItem, "category" | "label" | "detail"> {
    if (tool === "search_memory") {
        return {
            category: "memory",
            label: "Selected Memory",
            detail: "Memory search",
        };
    }
    if (tool === "get_current_note_context") {
        return {
            category: "current-note",
            label: "Current note",
            detail: "Read-only current note context",
        };
    }
    if (tool === BUILTIN_WEB_SEARCH_TOOL_NAME) {
        return {
            category: "read-only-tool",
            label: "WebSearch",
            detail: "External web search",
        };
    }
    if (tool === "search_vault_metadata") {
        return {
            category: "vault-metadata",
            label: "Vault metadata",
            detail: "Read-only metadata search results",
        };
    }
    if (tool === "list_recent_notes") {
        return {
            category: "recent-notes",
            label: "Recent notes",
            detail: "Read-only recent note list",
        };
    }
    if (tool === "read_note_outline") {
        return {
            category: "note-outline",
            label: "Note outline",
            detail: "Read-only note outline",
        };
    }
    if (tool === "inspect_obsidian_note") {
        return {
            category: "read-only-tool",
            label: "Note structure",
            detail: "Read-only note structure, links/backlinks, tasks, and properties",
        };
    }
    if (tool === "read_canvas_summary") {
        return {
            category: "read-only-tool",
            label: "Canvas structure",
            detail: "Read-only canvas structure",
        };
    }
    if (tool === "search_vault_snippets") {
        return {
            category: "read-only-tool",
            label: "Note snippets",
            detail: "Bounded note snippet search results",
        };
    }
    if (tool === "list_vault_tags") {
        return {
            category: "read-only-tool",
            label: "Vault tags",
            detail: "Read-only vault tag counts",
        };
    }
    return {
        category: "read-only-tool",
        label: "Read-only tool",
        detail: `${tool} output`,
    };
}

function dedupeSources(sources: readonly ChatAgentSource[]): ChatAgentSource[] {
    const seen = new Set<string>();
    const result: ChatAgentSource[] = [];
    for (const source of sources) {
        if (!source.path) continue;
        const key = `${source.path}:${source.chunkIndex ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ ...source });
    }
    return result;
}

function cloneSourceRecords(records: readonly SourceRecord[]): SourceRecord[] {
    return records.map((record) => ({
        ...record,
        metadata: record.metadata ? { ...record.metadata } : undefined,
    }));
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function truncate(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}
