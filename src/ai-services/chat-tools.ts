import { MarkdownView, type Workspace } from "obsidian";

import type { PluginManager } from "../plugin";
import type {
    ChatAgentSource,
    ChatToolName,
    ChatToolResult,
    MemorySearchResult,
} from "./chat-types";
import { createAbortError, isAbortError, throwIfAborted } from "./chat-utils";

export type { ChatToolName, ChatToolResult } from "./chat-types";

export interface ChatToolContext {
    plugin: PluginManager;
    signal?: AbortSignal;
    onBeforeVssSearch?: () => void;
    onToolRunning?: (tool: string, message: string) => void;
}

export type ChatToolPermission = "read-only";
export type ChatToolCost = "free" | "ai-calls";
export type ChatToolFailureBehavior = "recoverable";
export type ChatToolSourceBoundary = "memory" | "current-note" | "read-only-tool";

export interface ChatToolInputSchemaProperty {
    type: "string" | "number" | "integer" | "boolean";
    description?: string;
    enum?: string[];
    minimum?: number;
    maximum?: number;
}

export interface ChatToolInputSchema {
    type: "object";
    properties: Record<string, ChatToolInputSchemaProperty>;
    required?: string[];
    additionalProperties: boolean;
}

export interface ChatToolRegistryDefinition {
    name: ChatToolName;
    description: string;
    inputSchema: ChatToolInputSchema;
    plannerGuidance: string[];
    permission: ChatToolPermission;
    cost: ChatToolCost;
    outputBudgetChars: number;
    requiresConfirmation: boolean;
    failureBehavior: ChatToolFailureBehavior;
    statusMessage: string;
    sourceBoundary: ChatToolSourceBoundary;
}

export interface ChatToolProviderSchema {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: ChatToolInputSchema;
    };
}

export interface ChatToolDefinition<Input, Output> {
    name: ChatToolName;
    description: string;
    inputSchema: ChatToolInputSchema;
    plannerGuidance: string[];
    permission: ChatToolPermission;
    cost: ChatToolCost;
    outputBudgetChars: number;
    requiresConfirmation: boolean;
    failureBehavior: ChatToolFailureBehavior;
    statusMessageText: string;
    sourceBoundary: ChatToolSourceBoundary;
    statusMessage(input: Input): string;
    validateInput(input: unknown): Input;
    execute(input: Input, context: ChatToolContext): Promise<ChatToolResult<Output>>;
}

interface RegisteredChatTool {
    name: ChatToolName;
    definition: ChatToolRegistryDefinition;
    validateInput(input: unknown): unknown;
    statusMessage(input: unknown): string;
    execute(input: unknown, context: ChatToolContext): Promise<ChatToolResult<unknown>>;
}

export interface SearchMemoryInput {
    query: string;
}

export type CurrentNoteContextMode = "selection-or-nearby" | "outline" | "metadata";

export interface CurrentNoteContextInput {
    mode: CurrentNoteContextMode;
}

export interface CurrentNoteContextOutput {
    path: string;
    title: string;
    mode: CurrentNoteContextMode;
    selection?: string;
    nearbyText?: string;
    headings?: string[];
    outlineTruncated?: boolean;
    scannedLineLimit?: number;
    totalLines?: number;
    maxHeadings?: number;
}

export interface SearchVaultMetadataInput {
    query: string;
    limit: number;
}

export interface VaultMetadataMatch {
    path: string;
    title: string;
    score: number;
    tags: string[];
    frontmatter: Record<string, string>;
    mtime?: number;
    ctime?: number;
}

export interface SearchVaultMetadataOutput {
    query: string;
    matches: VaultMetadataMatch[];
}

export interface ListRecentNotesInput {
    limit: number;
    order: "modified" | "created";
}

export interface RecentNoteItem {
    path: string;
    title: string;
    mtime?: number;
    ctime?: number;
    size?: number;
}

export interface ListRecentNotesOutput {
    order: "modified" | "created";
    notes: RecentNoteItem[];
}

export interface ReadNoteOutlineInput {
    path: string;
    maxHeadings: number;
}

export interface NoteOutlineHeading {
    level: number;
    text: string;
}

export interface ReadNoteOutlineOutput {
    path: string;
    title: string;
    headings: NoteOutlineHeading[];
    outlineTruncated: boolean;
    totalHeadings: number;
    maxHeadings: number;
}

interface EditorLike {
    getSelection?: () => string;
    getValue?: () => string;
    getCursor?: () => { line: number; ch: number };
    lineCount?: () => number;
    getLine?: (line: number) => string;
}

interface MarkdownFileLike {
    path: string;
    basename?: string;
    name?: string;
    extension?: string;
    stat?: {
        mtime?: number;
        ctime?: number;
        size?: number;
    };
}

interface MarkdownViewLike {
    file: MarkdownFileLike;
    editor?: EditorLike;
}

interface VaultLike {
    getMarkdownFiles?: () => MarkdownFileLike[];
    getAbstractFileByPath?: (path: string) => unknown;
    cachedRead?: (file: MarkdownFileLike) => Promise<string>;
}

interface MetadataCacheLike {
    getFileCache?: (file: MarkdownFileLike) => FileCacheLike | null | undefined;
}

interface FileCacheLike {
    tags?: Array<{ tag?: string }>;
    frontmatter?: Record<string, unknown>;
    headings?: Array<{ heading?: string; level?: number }>;
}

const CURRENT_NOTE_CONTENT_BUDGET_CHARS = 3000;
const CURRENT_NOTE_MAX_HEADINGS = 30;
const CURRENT_NOTE_NEARBY_RADIUS_LINES = 12;
const CURRENT_NOTE_HEADING_SCAN_LINES = 200;
const CURRENT_NOTE_OUTLINE_SCAN_LINES = 5000;
const VAULT_METADATA_DEFAULT_LIMIT = 8;
const VAULT_METADATA_MAX_LIMIT = 12;
const RECENT_NOTES_DEFAULT_LIMIT = 8;
const RECENT_NOTES_MAX_LIMIT = 20;
const NOTE_OUTLINE_DEFAULT_HEADINGS = 30;
const NOTE_OUTLINE_MAX_HEADINGS = 50;
const NOTE_OUTLINE_SCAN_LINES = 5000;
const VAULT_METADATA_QUERY_MAX_CHARS = 240;
const NOTE_OUTLINE_PATH_MAX_CHARS = 1024;
const FRONTMATTER_PREVIEW_MAX_KEYS = 8;
const FRONTMATTER_VALUE_MAX_CHARS = 120;

export class ToolRegistry {
    private readonly tools = new Map<ChatToolName, RegisteredChatTool>();

    register<Input, Output>(definition: ChatToolDefinition<Input, Output>): void {
        this.tools.set(definition.name, {
            name: definition.name,
            definition: toRegistryDefinition(definition),
            validateInput: definition.validateInput,
            statusMessage: definition.statusMessage as (input: unknown) => string,
            execute: definition.execute as (input: unknown, context: ChatToolContext) => Promise<ChatToolResult<unknown>>,
        });
    }

    get(name: string): RegisteredChatTool | undefined {
        if (!isChatToolName(name)) return undefined;
        return this.tools.get(name);
    }

    getDefinition(name: string): ChatToolRegistryDefinition | undefined {
        return this.get(name)?.definition;
    }

    listDefinitions(): ChatToolRegistryDefinition[] {
        return [...this.tools.values()].map((tool) => cloneRegistryDefinition(tool.definition));
    }

    exportProviderSchemas(): ChatToolProviderSchema[] {
        return this.listDefinitions().map((definition) => ({
            type: "function",
            function: {
                name: definition.name,
                description: definition.description,
                parameters: definition.inputSchema,
            },
        }));
    }

    has(name: string): boolean {
        return Boolean(this.get(name));
    }

    async execute(name: string, input: unknown, context: ChatToolContext): Promise<ChatToolResult<unknown>> {
        throwIfAborted(context.signal);
        const tool = this.get(name);
        if (!tool) {
            context.plugin.log("Chat tool is not registered", { tool: name });
            return createToolFailureResult(name, describeToolInput(input), "Skipped an unavailable read-only tool.");
        }

        let validatedInput: unknown;
        try {
            validatedInput = tool.validateInput(input);
        } catch (error) {
            context.plugin.log("Chat tool input validation failed", { tool: name, error: getErrorMessage(error) });
            return createToolFailureResult(name, describeToolInput(input), "Skipped a read-only tool because its input was invalid.");
        }

        throwIfAborted(context.signal);
        context.onToolRunning?.(name, tool.statusMessage(validatedInput));
        try {
            const result = await tool.execute(validatedInput, context);
            throwIfAborted(context.signal);
            return result;
        } catch (error) {
            if (isAbortError(error, context.signal)) {
                throw context.signal?.aborted ? createAbortError() : error;
            }
            context.plugin.log("Chat tool execution failed", { tool: name, error: getErrorMessage(error) });
            return createToolFailureResult(name, tool.statusMessage(validatedInput), "Read-only tool was unavailable.");
        }
    }
}

function toRegistryDefinition<Input, Output>(
    definition: ChatToolDefinition<Input, Output>,
): ChatToolRegistryDefinition {
    return {
        name: definition.name,
        description: definition.description,
        inputSchema: cloneInputSchema(definition.inputSchema),
        plannerGuidance: [...definition.plannerGuidance],
        permission: definition.permission,
        cost: definition.cost,
        outputBudgetChars: definition.outputBudgetChars,
        requiresConfirmation: definition.requiresConfirmation,
        failureBehavior: definition.failureBehavior,
        statusMessage: definition.statusMessageText,
        sourceBoundary: definition.sourceBoundary,
    };
}

function cloneRegistryDefinition(definition: ChatToolRegistryDefinition): ChatToolRegistryDefinition {
    return {
        ...definition,
        inputSchema: cloneInputSchema(definition.inputSchema),
        plannerGuidance: [...definition.plannerGuidance],
    };
}

function cloneInputSchema(schema: ChatToolInputSchema): ChatToolInputSchema {
    return {
        ...schema,
        properties: Object.fromEntries(Object.entries(schema.properties).map(([name, property]) => [
            name,
            { ...property, enum: property.enum ? [...property.enum] : undefined },
        ])),
        required: schema.required ? [...schema.required] : undefined,
    };
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

export function createCurrentNoteContextTool(): ChatToolDefinition<CurrentNoteContextInput, CurrentNoteContextOutput> {
    return {
        name: "get_current_note_context",
        description: "Read the active Markdown note title, path, selection, nearby text, or outline.",
        plannerGuidance: [
            "Use when the user refers to the current note, selected text, this paragraph, nearby content, outline, or current note metadata.",
            "Prefer selection-or-nearby for summary, explanation, rewrite, or local context questions.",
        ],
        inputSchema: {
            type: "object",
            properties: {
                mode: {
                    type: "string",
                    description: "Current note context mode.",
                    enum: ["selection-or-nearby", "outline", "metadata"],
                },
            },
            required: ["mode"],
            additionalProperties: false,
        },
        permission: "read-only",
        cost: "free",
        outputBudgetChars: CURRENT_NOTE_CONTENT_BUDGET_CHARS,
        requiresConfirmation: false,
        failureBehavior: "recoverable",
        statusMessageText: "Reading current note",
        sourceBoundary: "current-note",
        statusMessage: () => "Reading current note",
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

function findCurrentMarkdownView(workspace: Workspace): MarkdownViewLike | null {
    const activeView = workspace.getActiveViewOfType(MarkdownView);
    if (isMarkdownViewLike(activeView)) {
        return activeView;
    }

    const recentLeaf = workspace.getMostRecentLeaf?.();
    if (isMarkdownViewLike(recentLeaf?.view)) {
        return recentLeaf.view;
    }

    const markdownLeaf = workspace.getLeavesOfType?.("markdown")
        .find((leaf) => isMarkdownViewLike(leaf.view));
    return isMarkdownViewLike(markdownLeaf?.view) ? markdownLeaf.view : null;
}

function isMarkdownViewLike(view: unknown): view is MarkdownViewLike {
    if (
        !view
        || typeof view !== "object"
        || !("file" in view)
        || typeof (view as MarkdownViewLike).file?.path !== "string"
    ) {
        return false;
    }

    const getViewType = (view as { getViewType?: unknown }).getViewType;
    return typeof getViewType !== "function" || getViewType.call(view) === "markdown";
}

export function isSearchMemoryResult(content: unknown): content is MemorySearchResult {
    return Boolean(
        content
        && typeof content === "object"
        && "query" in content
        && "documents" in content
        && "sources" in content,
    );
}

export function isCurrentNoteContextResult(content: unknown): content is CurrentNoteContextOutput {
    const mode = content && typeof content === "object"
        ? (content as Record<string, unknown>).mode
        : undefined;
    return Boolean(
        content
        && typeof content === "object"
        && "path" in content
        && typeof (content as Record<string, unknown>).path === "string"
        && "title" in content
        && typeof (content as Record<string, unknown>).title === "string"
        && (mode === "selection-or-nearby" || mode === "outline" || mode === "metadata"),
    );
}

export function isSearchVaultMetadataResult(content: unknown): content is SearchVaultMetadataOutput {
    return Boolean(
        content
        && typeof content === "object"
        && "query" in content
        && "matches" in content
        && Array.isArray((content as Record<string, unknown>).matches),
    );
}

export function isListRecentNotesResult(content: unknown): content is ListRecentNotesOutput {
    return Boolean(
        content
        && typeof content === "object"
        && "notes" in content
        && Array.isArray((content as Record<string, unknown>).notes),
    );
}

export function isReadNoteOutlineResult(content: unknown): content is ReadNoteOutlineOutput {
    return Boolean(
        content
        && typeof content === "object"
        && "path" in content
        && "headings" in content
        && Array.isArray((content as Record<string, unknown>).headings),
    );
}

function validateSearchMemoryInput(input: unknown): SearchMemoryInput {
    if (!input || typeof input !== "object") {
        throw new Error("search_memory input must be an object.");
    }
    const value = input as Record<string, unknown>;
    const query = typeof value.query === "string" ? value.query.trim() : "";
    if (!query) {
        throw new Error("search_memory input.query must be a non-empty string.");
    }
    return { query };
}

function validateCurrentNoteContextInput(input: unknown): CurrentNoteContextInput {
    if (!input || typeof input !== "object") {
        throw new Error("get_current_note_context input must be an object.");
    }
    const mode = (input as Record<string, unknown>).mode;
    if (mode === "selection-or-nearby" || mode === "outline" || mode === "metadata") {
        return { mode };
    }
    throw new Error("get_current_note_context input.mode is invalid.");
}

function validateSearchVaultMetadataInput(input: unknown): SearchVaultMetadataInput {
    if (!input || typeof input !== "object") {
        throw new Error("search_vault_metadata input must be an object.");
    }
    const value = input as Record<string, unknown>;
    const query = typeof value.query === "string" ? value.query.trim() : "";
    if (!query) {
        throw new Error("search_vault_metadata input.query must be a non-empty string.");
    }
    return {
        query: limitInputText(query, VAULT_METADATA_QUERY_MAX_CHARS),
        limit: normalizeLimit(value.limit, VAULT_METADATA_DEFAULT_LIMIT, VAULT_METADATA_MAX_LIMIT),
    };
}

function validateListRecentNotesInput(input: unknown): ListRecentNotesInput {
    if (!input || typeof input !== "object") {
        throw new Error("list_recent_notes input must be an object.");
    }
    const value = input as Record<string, unknown>;
    const order = value.order === "created" ? "created" : "modified";
    return {
        order,
        limit: normalizeLimit(value.limit, RECENT_NOTES_DEFAULT_LIMIT, RECENT_NOTES_MAX_LIMIT),
    };
}

function validateReadNoteOutlineInput(input: unknown): ReadNoteOutlineInput {
    if (!input || typeof input !== "object") {
        throw new Error("read_note_outline input must be an object.");
    }
    const value = input as Record<string, unknown>;
    const path = typeof value.path === "string" ? value.path.trim() : "";
    if (!path) {
        throw new Error("read_note_outline input.path must be a non-empty string.");
    }
    if (path.length > NOTE_OUTLINE_PATH_MAX_CHARS) {
        throw new Error("read_note_outline input.path is too long.");
    }
    return {
        path,
        maxHeadings: normalizeLimit(value.max_headings ?? value.maxHeadings, NOTE_OUTLINE_DEFAULT_HEADINGS, NOTE_OUTLINE_MAX_HEADINGS),
    };
}

function isChatToolName(name: string): name is ChatToolName {
    return name === "search_memory"
        || name === "get_current_note_context"
        || name === "search_vault_metadata"
        || name === "list_recent_notes"
        || name === "read_note_outline";
}

function createToolFailureResult<Output = unknown>(tool: string, inputSummary: string, error: string): ChatToolResult<Output> {
    return {
        ok: false,
        tool,
        inputSummary,
        content: null,
        sources: [],
        error,
    };
}

function createCurrentNoteResult(
    inputSummary: string,
    content: CurrentNoteContextOutput,
    sources: ChatAgentSource[],
): ChatToolResult<CurrentNoteContextOutput> {
    return {
        ok: true,
        tool: "get_current_note_context",
        inputSummary,
        content,
        sources,
    };
}

function getFileTitle(file: { basename?: string; name?: string; path: string }): string {
    if (file.basename) return file.basename;
    if (file.name) return file.name.replace(/\.md$/i, "");
    const lastSegment = file.path.split("/").pop() ?? file.path;
    return lastSegment.replace(/\.md$/i, "");
}

function getVault(plugin: PluginManager): VaultLike {
    return plugin.app.vault as unknown as VaultLike;
}

function getMetadataCache(plugin: PluginManager): MetadataCacheLike {
    return plugin.app.metadataCache as unknown as MetadataCacheLike;
}

function getMarkdownFiles(plugin: PluginManager): MarkdownFileLike[] {
    return getVault(plugin).getMarkdownFiles?.() ?? [];
}

function findMarkdownFileByPath(plugin: PluginManager, path: string): MarkdownFileLike | null {
    const byPath = getVault(plugin).getAbstractFileByPath?.(path);
    if (isMarkdownFileLike(byPath)) {
        return byPath;
    }
    return getMarkdownFiles(plugin).find((file) => file.path === path) ?? null;
}

function isMarkdownFileLike(value: unknown): value is MarkdownFileLike {
    return Boolean(
        value
        && typeof value === "object"
        && typeof (value as MarkdownFileLike).path === "string"
        && (value as MarkdownFileLike).path.toLowerCase().endsWith(".md"),
    );
}

function normalizeLimit(value: unknown, defaultLimit: number, maxLimit: number): number {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) return defaultLimit;
    return Math.min(Math.max(Math.floor(numeric), 1), maxLimit);
}

function limitInputText(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;
    return value.slice(0, maxLength).trim();
}

interface MetadataQuerySignals {
    normalizedQuery: string;
    tokens: string[];
}

function buildMetadataQuerySignals(query: string): MetadataQuerySignals {
    const normalizedQuery = normalizeSearchText(query);
    const rawTokens = normalizedQuery.match(/[a-z0-9_-]+|[\u3400-\u9fff]+/g) ?? [];
    const tokens = rawTokens.flatMap((token) => {
        if (/^[\u3400-\u9fff]+$/.test(token) && token.length > 2) {
            const bigrams: string[] = [];
            for (let index = 0; index < token.length - 1; index++) {
                bigrams.push(token.slice(index, index + 2));
            }
            return [token, ...bigrams];
        }
        return [token];
    });
    return {
        normalizedQuery,
        tokens: [...new Set(tokens.filter((token) => token.length > 0))],
    };
}

function scoreMetadataMatch(
    file: MarkdownFileLike,
    cache: FileCacheLike | null | undefined,
    query: MetadataQuerySignals,
): VaultMetadataMatch | null {
    const title = getFileTitle(file);
    const tags = normalizeTags(cache?.tags);
    const frontmatter = previewFrontmatter(cache?.frontmatter);
    const searchableFrontmatter = indexFrontmatter(cache?.frontmatter);
    const indexedFields = [
        file.path,
        title,
        ...tags,
        ...Object.keys(searchableFrontmatter),
        ...Object.values(searchableFrontmatter),
    ].map(normalizeSearchText);

    let score = 0;
    if (normalizeSearchText(file.path).includes(query.normalizedQuery)) score += 8;
    if (normalizeSearchText(title).includes(query.normalizedQuery)) score += 6;

    for (const token of query.tokens) {
        if (normalizeSearchText(title).includes(token)) score += 4;
        if (normalizeSearchText(file.path).includes(token)) score += 3;
        if (tags.some((tag) => normalizeSearchText(tag).includes(token))) score += 3;
        if (Object.entries(searchableFrontmatter).some(([key, value]) => (
            normalizeSearchText(key).includes(token) || normalizeSearchText(value).includes(token)
        ))) score += 2;
        if (indexedFields.some((field) => field.includes(token))) score += 1;
    }

    if (score <= 0) return null;
    return {
        path: file.path,
        title,
        score,
        tags,
        frontmatter,
        mtime: file.stat?.mtime,
        ctime: file.stat?.ctime,
    };
}

function normalizeTags(tags: FileCacheLike["tags"]): string[] {
    if (!Array.isArray(tags)) return [];
    return [...new Set(tags
        .map((entry) => typeof entry.tag === "string" ? entry.tag.replace(/^#/, "").trim() : "")
        .filter((tag) => tag.length > 0))]
        .slice(0, 20);
}

function previewFrontmatter(frontmatter: Record<string, unknown> | undefined): Record<string, string> {
    if (!frontmatter || typeof frontmatter !== "object") return {};
    const preview: Record<string, string> = {};
    for (const [key, value] of Object.entries(frontmatter).slice(0, FRONTMATTER_PREVIEW_MAX_KEYS)) {
        const rendered = renderFrontmatterValue(value);
        if (rendered) {
            preview[key] = truncate(rendered, FRONTMATTER_VALUE_MAX_CHARS);
        }
    }
    return preview;
}

function indexFrontmatter(frontmatter: Record<string, unknown> | undefined): Record<string, string> {
    if (!frontmatter || typeof frontmatter !== "object") return {};
    const indexed: Record<string, string> = {};
    for (const [key, value] of Object.entries(frontmatter)) {
        const rendered = renderFrontmatterValue(value);
        if (key.trim() || rendered) {
            indexed[key] = rendered;
        }
    }
    return indexed;
}

function renderFrontmatterValue(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) {
        return value
            .map(renderFrontmatterValue)
            .filter((entry) => entry.length > 0)
            .join(", ");
    }
    return "";
}

function normalizeSearchText(value: string): string {
    return value.toLowerCase().normalize("NFKC");
}

function fileToRecentNote(file: MarkdownFileLike): RecentNoteItem {
    return {
        path: file.path,
        title: getFileTitle(file),
        mtime: file.stat?.mtime,
        ctime: file.stat?.ctime,
        size: file.stat?.size,
    };
}

interface ExtractedOutline {
    headings: NoteOutlineHeading[];
    outlineTruncated: boolean;
    totalHeadings: number;
}

function extractOutlineFromCache(cache: FileCacheLike | null | undefined, maxHeadings: number): ExtractedOutline | null {
    if (!Array.isArray(cache?.headings)) return null;
    const allHeadings = cache.headings
        .map((heading) => ({
            level: normalizeHeadingLevel(heading.level),
            text: typeof heading.heading === "string" ? heading.heading.trim() : "",
        }))
        .filter((heading) => heading.text.length > 0);
    return {
        headings: allHeadings.slice(0, maxHeadings),
        outlineTruncated: allHeadings.length > maxHeadings,
        totalHeadings: allHeadings.length,
    };
}

async function extractOutlineFromFile(
    plugin: PluginManager,
    file: MarkdownFileLike,
    maxHeadings: number,
): Promise<ExtractedOutline> {
    const content = await getVault(plugin).cachedRead?.(file) ?? "";
    const allLines = content.split(/\r?\n/);
    const lines = allLines.slice(0, NOTE_OUTLINE_SCAN_LINES);
    const allHeadings: NoteOutlineHeading[] = [];
    for (const line of lines) {
        const heading = parseHeading(line);
        if (heading) {
            allHeadings.push({ level: heading.level, text: heading.text.replace(/^#{1,6}\s+/, "") });
        }
    }
    return {
        headings: allHeadings.slice(0, maxHeadings),
        outlineTruncated: allLines.length > NOTE_OUTLINE_SCAN_LINES || allHeadings.length > maxHeadings,
        totalHeadings: allHeadings.length,
    };
}

function normalizeHeadingLevel(level: unknown): number {
    return typeof level === "number" && Number.isFinite(level)
        ? Math.min(Math.max(Math.floor(level), 1), 6)
        : 1;
}

interface CurrentNoteOutline {
    headings: string[];
    outlineTruncated: boolean;
    scannedLineLimit: number;
    totalLines: number;
    maxHeadings: number;
}

function applyOutline(output: CurrentNoteContextOutput, outline: CurrentNoteOutline): void {
    output.headings = outline.headings;
    output.outlineTruncated = outline.outlineTruncated;
    output.scannedLineLimit = outline.scannedLineLimit;
    output.totalLines = outline.totalLines;
    output.maxHeadings = outline.maxHeadings;
}

function extractHeadingsFromEditor(editor: EditorLike): CurrentNoteOutline {
    const lineCount = getLineCount(editor);
    if (lineCount === undefined || !editor.getLine) {
        return {
            headings: [],
            outlineTruncated: false,
            scannedLineLimit: 0,
            totalLines: 0,
            maxHeadings: CURRENT_NOTE_MAX_HEADINGS,
        };
    }
    const headings: string[] = [];
    const maxScanLine = Math.min(lineCount, CURRENT_NOTE_OUTLINE_SCAN_LINES);
    for (let index = 0; index < maxScanLine && headings.length < CURRENT_NOTE_MAX_HEADINGS; index++) {
        const heading = parseHeading(editor.getLine(index));
        if (heading) {
            headings.push(heading.text);
        }
    }
    return {
        headings,
        outlineTruncated: lineCount > maxScanLine || headings.length >= CURRENT_NOTE_MAX_HEADINGS,
        scannedLineLimit: maxScanLine,
        totalLines: lineCount,
        maxHeadings: CURRENT_NOTE_MAX_HEADINGS,
    };
}

function getHeadingSectionOrNearbyText(editor: EditorLike): string {
    const lineCount = getLineCount(editor);
    if (lineCount === undefined || !editor.getLine) return "";
    if (lineCount === 0) return "";
    const cursor = editor.getCursor?.();
    const currentLine = clampLine(cursor?.line ?? 0, lineCount);
    const section = getCurrentHeadingSection(editor, currentLine, lineCount);
    if (section) return section;

    const start = Math.max(0, currentLine - CURRENT_NOTE_NEARBY_RADIUS_LINES);
    const end = Math.min(lineCount, currentLine + CURRENT_NOTE_NEARBY_RADIUS_LINES + 1);
    return collectLinesWithinBudget(editor, start, end).trim();
}

function getCurrentHeadingSection(editor: EditorLike, cursorLine: number, lineCount: number): string | null {
    if (!editor.getLine) return null;
    let start = -1;
    let level = 0;
    const minScanLine = Math.max(0, cursorLine - CURRENT_NOTE_HEADING_SCAN_LINES);
    for (let index = cursorLine; index >= minScanLine; index--) {
        const heading = parseHeading(editor.getLine(index));
        if (heading) {
            start = index;
            level = heading.level;
            break;
        }
    }
    if (start < 0) return null;

    let end = lineCount;
    const maxScanLine = Math.min(lineCount, start + CURRENT_NOTE_HEADING_SCAN_LINES + 1);
    for (let index = start + 1; index < maxScanLine; index++) {
        const heading = parseHeading(editor.getLine(index));
        if (heading && heading.level <= level) {
            end = index;
            break;
        }
    }
    return collectLinesWithinBudget(editor, start, end).trim();
}

function collectLinesWithinBudget(editor: EditorLike, start: number, end: number): string {
    if (!editor.getLine) return "";
    const lines: string[] = [];
    let used = 0;
    for (let index = start; index < end; index++) {
        const line = editor.getLine(index);
        const nextUsed = used + line.length + (lines.length > 0 ? 1 : 0);
        if (nextUsed > CURRENT_NOTE_CONTENT_BUDGET_CHARS) {
            const remaining = CURRENT_NOTE_CONTENT_BUDGET_CHARS - used;
            if (remaining > 0) {
                lines.push(line.slice(0, remaining));
            }
            break;
        }
        lines.push(line);
        used = nextUsed;
    }
    return lines.join("\n");
}

function parseHeading(line: string): { level: number; text: string } | null {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (!match) return null;
    return {
        level: match[1].length,
        text: `${match[1]} ${match[2].trim()}`,
    };
}

function getLineCount(editor: EditorLike): number | undefined {
    const lineCount = editor.lineCount?.();
    return typeof lineCount === "number" && Number.isFinite(lineCount)
        ? Math.max(0, Math.floor(lineCount))
        : undefined;
}

function clampLine(line: number, lineCount: number): number {
    if (!Number.isFinite(line)) return 0;
    return Math.min(Math.max(Math.floor(line), 0), Math.max(lineCount - 1, 0));
}

function describeToolInput(input: unknown): string {
    if (typeof input === "string") return input;
    if (!input || typeof input !== "object") return String(input);
    try {
        return JSON.stringify(input);
    } catch {
        return "[unserializable input]";
    }
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength)}...`;
}
