import { MarkdownView, type Workspace } from "obsidian";

import type { PluginManager } from "../plugin";
import type {
    ChatAgentSource,
    ChatToolName,
    ChatToolResult,
    MemorySearchResult,
} from "./chat-types";
import {
    buildObsidianOperationsPlannerGuidance,
    type ObsidianOperationsCatalogSectionId,
} from "./obsidian-operations-capability-catalog";
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

export const OBSIDIAN_OPERATIONS_V1A_MAX_OUTPUT_BUDGET_CHARS = 6000;

export const OBSIDIAN_OPERATIONS_V1A_TOOL_NAMES = [
    "inspect_obsidian_note",
    "read_canvas_summary",
    "search_vault_snippets",
    "list_vault_tags",
] as const satisfies readonly ChatToolName[];

export type ObsidianOperationsV1AToolName = typeof OBSIDIAN_OPERATIONS_V1A_TOOL_NAMES[number];

export function isObsidianOperationsV1AToolName(name: string): name is ObsidianOperationsV1AToolName {
    return (OBSIDIAN_OPERATIONS_V1A_TOOL_NAMES as readonly string[]).includes(name);
}

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

export type ChatToolProviderSchemaExportResult =
    | { ok: true; schemas: ChatToolProviderSchema[] }
    | { ok: false; schemas: []; error: string };

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

export interface InspectObsidianNoteInput {
    path?: string;
}

export interface ReadCanvasSummaryInput {
    path: string;
}

export interface SearchVaultSnippetsInput {
    query: string;
    limit: number;
    scope?: string;
}

export interface ListVaultTagsInput {
    limit: number;
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

export interface InspectObsidianNoteOutput {
    kind: "note-structure";
    path: string;
    title?: string;
    properties?: Record<string, unknown>;
    tags?: string[];
    headings?: unknown[];
    tasks?: unknown[];
    callouts?: unknown[];
    wikilinks?: string[];
    embeds?: string[];
    wikilinkTargets?: ObsidianLinkTarget[];
    embedTargets?: ObsidianLinkTarget[];
    outgoingLinks?: string[];
    backlinks?: string[];
    unresolvedLinks?: string[];
    links?: Record<string, unknown>;
    unavailableSources?: string[];
    skippedSources?: string[];
    truncated?: boolean;
    omittedCount?: number;
}

export interface ObsidianLinkTarget {
    raw: string;
    path?: string;
    subpath?: string;
    alias?: string;
    embedded?: boolean;
}

export interface CanvasDanglingEdge {
    id?: string;
    fromNode?: string;
    toNode?: string;
}

export interface CanvasGroupSummary {
    id: string;
    label?: string;
    color?: string;
}

export interface CanvasTextSnippet {
    id: string;
    type: string;
    text: string;
}

export interface ReadCanvasSummaryOutput {
    kind: "canvas-structure";
    path: string;
    nodeCount: number;
    edgeCount: number;
    duplicateIds?: string[];
    danglingEdges?: CanvasDanglingEdge[];
    isolatedNodes?: string[];
    groups?: CanvasGroupSummary[];
    snippets?: CanvasTextSnippet[];
    unavailableSources?: string[];
    skippedSources?: string[];
    truncated?: boolean;
    omittedCount?: number;
}

export interface VaultSnippetMatch {
    path: string;
    title: string;
    line: number;
    snippet: string;
}

export interface VaultSnippetSearchOutput {
    kind: "vault-snippets";
    query: string;
    scope?: string;
    matches: VaultSnippetMatch[];
    scannedFiles?: number;
    scannedBytes?: number;
    consideredFiles?: number;
    skippedFiles?: number;
    missingScope?: boolean;
    unsupportedScope?: boolean;
    unavailableSources?: string[];
    skippedSources?: string[];
    truncated?: boolean;
    omittedCount?: number;
}

export interface VaultTagsOutput {
    kind: "vault-tags";
    tags: Array<{
        tag: string;
        count: number;
        representativePaths?: string[];
    }>;
    unavailableSources?: string[];
    scannedFiles?: number;
    skippedFiles?: number;
    truncated?: boolean;
    omittedCount?: number;
}

interface EditorLike {
    getSelection?: () => string;
    getValue?: () => string;
    getCursor?: () => { line: number; ch: number };
    lineCount?: () => number;
    getLine?: (line: number) => string;
}

interface VaultFileLike {
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

type MarkdownFileLike = VaultFileLike;

interface MarkdownViewLike {
    file: MarkdownFileLike;
    editor?: EditorLike;
}

interface VaultLike {
    getMarkdownFiles?: () => MarkdownFileLike[];
    getAbstractFileByPath?: (path: string) => unknown;
    cachedRead?: (file: VaultFileLike) => Promise<string>;
}

interface MetadataCacheLike {
    getFileCache?: (file: MarkdownFileLike) => FileCacheLike | null | undefined;
    resolvedLinks?: Record<string, Record<string, number>>;
    unresolvedLinks?: Record<string, Record<string, number>>;
}

interface FileCacheLike {
    tags?: Array<{ tag?: string }>;
    frontmatter?: Record<string, unknown>;
    headings?: Array<{ heading?: string; level?: number }>;
    links?: Array<{ link?: string; original?: string; displayText?: string }>;
    embeds?: Array<{ link?: string; original?: string; displayText?: string }>;
    listItems?: Array<{
        task?: string;
        position?: {
            start?: { line?: number };
            end?: { line?: number };
        };
    }>;
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
const OBSIDIAN_TARGET_PATH_MAX_CHARS = 1024;
const INSPECT_NOTE_MAX_PROPERTIES = 16;
const INSPECT_NOTE_MAX_TAGS = 40;
const INSPECT_NOTE_MAX_HEADINGS = 50;
const INSPECT_NOTE_MAX_TASKS = 40;
const INSPECT_NOTE_MAX_CALLOUTS = 20;
const INSPECT_NOTE_MAX_LINKS = 60;
const INSPECT_NOTE_SCAN_LINES = 5000;
const INSPECT_NOTE_MAX_READ_BYTES = 300_000;
const CANVAS_MAX_DUPLICATE_IDS = 20;
const CANVAS_MAX_DANGLING_EDGES = 30;
const CANVAS_MAX_ISOLATED_NODES = 40;
const CANVAS_MAX_GROUPS = 30;
const CANVAS_MAX_SNIPPETS = 24;
const CANVAS_SNIPPET_MAX_CHARS = 180;
const CANVAS_MAX_READ_BYTES = 300_000;
const SNIPPET_QUERY_MAX_CHARS = 160;
const SNIPPET_DEFAULT_LIMIT = 5;
const SNIPPET_MAX_LIMIT = 10;
const SNIPPET_MAX_CANDIDATE_FILES = 400;
const SNIPPET_MAX_FILES = 80;
const SNIPPET_MAX_BYTES = 300_000;
const SNIPPET_MAX_FILE_BYTES = 100_000;
const SNIPPET_CONTEXT_CHARS = 80;
const SNIPPET_MAX_CHARS = 260;
const TAGS_DEFAULT_LIMIT = 40;
const TAGS_MAX_LIMIT = 80;
const TAG_REPRESENTATIVE_PATHS = 3;
const TAGS_SCAN_MAX_FILES = 3000;
const METADATA_CACHE_UNAVAILABLE_SOURCE = "metadata cache";
const VAULT_FILE_READ_UNAVAILABLE_SOURCE = "vault file read";
const VAULT_FILE_READ_SKIPPED_SIZE_SOURCE = "vault file read skipped for size";
const SNIPPET_SCOPE_UNAVAILABLE_SOURCE = "snippet scope not found";
const SNIPPET_SCOPE_UNSUPPORTED_SOURCE = "unsupported snippet scope";
const TOOL_VALIDATION_INPUT_SUMMARY_CHARS = 512;

function buildV1APlannerGuidance(
    catalogSections: readonly ObsidianOperationsCatalogSectionId[],
    toolSpecificGuidance: readonly string[],
): string[] {
    return [
        ...buildObsidianOperationsPlannerGuidance(catalogSections),
        ...toolSpecificGuidance,
    ];
}

export class ToolRegistry {
    private readonly tools = new Map<ChatToolName, RegisteredChatTool>();

    register<Input, Output>(definition: ChatToolDefinition<Input, Output>): void {
        assertObsidianOperationsV1AToolPolicy(definition);
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

    exportProviderSchemasSafe(): ChatToolProviderSchemaExportResult {
        try {
            return { ok: true, schemas: this.exportProviderSchemas() };
        } catch (error) {
            return {
                ok: false,
                schemas: [],
                error: getErrorMessage(error),
            };
        }
    }

    has(name: string): boolean {
        return Boolean(this.get(name));
    }

    async execute(name: string, input: unknown, context: ChatToolContext): Promise<ChatToolResult<unknown>> {
        throwIfAborted(context.signal);
        const tool = this.get(name);
        if (!tool) {
            context.plugin.log("Chat tool is not registered", { tool: name });
            return createToolFailureResult(name, "unregistered tool", "Skipped an unavailable read-only tool.");
        }

        let validatedInput: unknown;
        try {
            validatedInput = tool.validateInput(input);
        } catch (error) {
            context.plugin.log("Chat tool input validation failed", { tool: name, errorType: getErrorType(error) });
            return createToolFailureResult(
                name,
                summarizeInvalidToolInput(input),
                sanitizeToolErrorMessage(error, "Skipped a read-only tool because its input was invalid."),
            );
        }

        throwIfAborted(context.signal);
        context.onToolRunning?.(name, tool.statusMessage(validatedInput));
        try {
            const result = await tool.execute(validatedInput, context);
            throwIfAborted(context.signal);
            return enforceToolOutputBudget(tool.definition, result);
        } catch (error) {
            if (isAbortError(error, context.signal)) {
                throw context.signal?.aborted ? createAbortError() : error;
            }
            context.plugin.log("Chat tool execution failed", { tool: name, errorType: getErrorType(error) });
            return createToolFailureResult(name, "execution failed", "Read-only tool was unavailable.");
        }
    }
}

export function assertObsidianOperationsV1AToolPolicy<Input, Output>(
    definition: ChatToolDefinition<Input, Output>,
): void {
    if (!isObsidianOperationsV1AToolName(definition.name)) return;

    const errors: string[] = [];
    if (definition.permission !== "read-only") {
        errors.push("permission must be read-only");
    }
    if (definition.cost !== "free") {
        errors.push("cost must be free");
    }
    if (!Number.isFinite(definition.outputBudgetChars) || definition.outputBudgetChars <= 0) {
        errors.push("outputBudgetChars must be positive");
    } else if (definition.outputBudgetChars > OBSIDIAN_OPERATIONS_V1A_MAX_OUTPUT_BUDGET_CHARS) {
        errors.push(`outputBudgetChars must be <= ${OBSIDIAN_OPERATIONS_V1A_MAX_OUTPUT_BUDGET_CHARS}`);
    }
    if (definition.requiresConfirmation !== false) {
        errors.push("requiresConfirmation must be false");
    }
    if (definition.failureBehavior !== "recoverable") {
        errors.push("failureBehavior must be recoverable");
    }
    if (definition.sourceBoundary !== "read-only-tool") {
        errors.push("sourceBoundary must be read-only-tool");
    }

    if (errors.length > 0) {
        throw new Error(`Invalid Obsidian Operations v1A tool policy for ${definition.name}: ${errors.join("; ")}`);
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

function enforceToolOutputBudget(
    definition: ChatToolRegistryDefinition,
    result: ChatToolResult<unknown>,
): ChatToolResult<unknown> {
    if (!result.ok || !result.content || !isObsidianOperationsV1AToolName(definition.name)) {
        return result;
    }
    const serialized = JSON.stringify(result.content);
    if (serialized.length <= definition.outputBudgetChars) {
        return result;
    }
    return {
        ...result,
        content: fitV1AToolContentToBudget(definition.name, result.content, definition.outputBudgetChars),
    };
}

function fitV1AToolContentToBudget(
    tool: ObsidianOperationsV1AToolName,
    content: unknown,
    maxLength: number,
): unknown {
    const next = cloneJsonValue(content);
    if (!next || typeof next !== "object" || Array.isArray(next)) {
        return content;
    }

    markBudgetTruncated(next as Record<string, unknown>);
    let serialized = JSON.stringify(next);
    for (let attempt = 0; attempt < 200 && serialized.length > maxLength; attempt++) {
        const trimResult = trimLargestJsonPayload(next, serialized.length - maxLength);
        if (!trimResult.trimmed) break;
        if (trimResult.omitted > 0) {
            incrementOmittedCount(next as Record<string, unknown>, trimResult.omitted);
        }
        markBudgetTruncated(next as Record<string, unknown>);
        serialized = JSON.stringify(next);
    }

    if (serialized.length <= maxLength) {
        return next;
    }

    return createMinimalBudgetedV1AContent(tool, content);
}

function cloneJsonValue(value: unknown): unknown {
    return JSON.parse(JSON.stringify(value)) as unknown;
}

function markBudgetTruncated(value: Record<string, unknown>): void {
    value.truncated = true;
}

function incrementOmittedCount(value: Record<string, unknown>, amount: number): void {
    const current = typeof value.omittedCount === "number" && Number.isFinite(value.omittedCount)
        ? value.omittedCount
        : 0;
    value.omittedCount = current + amount;
}

type JsonContainer = Record<string, unknown> | unknown[];

type JsonTrimTarget =
    | { kind: "string"; parent: JsonContainer; key: string | number; value: string; size: number }
    | { kind: "array"; value: unknown[]; size: number };

function trimLargestJsonPayload(value: unknown, overflow: number): { trimmed: boolean; omitted: number } {
    const target = findLargestJsonTrimTarget(value);
    if (!target) return { trimmed: false, omitted: 0 };
    if (target.kind === "array") {
        target.value.pop();
        return { trimmed: true, omitted: 1 };
    }

    const nextLength = Math.max(0, target.value.length - Math.max(16, overflow + 8));
    const nextValue = truncateToExactLength(target.value, nextLength);
    if (Array.isArray(target.parent)) {
        target.parent[target.key as number] = nextValue;
    } else {
        target.parent[target.key as string] = nextValue;
    }
    return { trimmed: true, omitted: 0 };
}

function findLargestJsonTrimTarget(value: unknown): JsonTrimTarget | null {
    let target: JsonTrimTarget | null = null;
    const visit = (current: unknown, parent?: JsonContainer, key?: string | number) => {
        if (typeof current === "string") {
            if (parent !== undefined && key !== undefined && current.length > 32) {
                const candidate: JsonTrimTarget = {
                    kind: "string",
                    parent,
                    key,
                    value: current,
                    size: current.length,
                };
                if (!target || candidate.size > target.size) target = candidate;
            }
            return;
        }
        if (Array.isArray(current)) {
            if (current.length > 0) {
                const candidate: JsonTrimTarget = {
                    kind: "array",
                    value: current,
                    size: JSON.stringify(current).length,
                };
                if (!target || candidate.size > target.size) target = candidate;
            }
            current.forEach((item, index) => visit(item, current, index));
            return;
        }
        if (!current || typeof current !== "object") return;
        for (const [childKey, childValue] of Object.entries(current as Record<string, unknown>)) {
            if (childKey === "kind") continue;
            visit(childValue, current as Record<string, unknown>, childKey);
        }
    };
    visit(value);
    return target;
}

function truncateToExactLength(value: string, maxLength: number): string {
    if (maxLength <= 0) return "";
    if (value.length <= maxLength) return value;
    if (maxLength <= 3) return value.slice(0, maxLength);
    return `${value.slice(0, maxLength - 3)}...`;
}

function createMinimalBudgetedV1AContent(tool: ObsidianOperationsV1AToolName, content: unknown): unknown {
    const record = content && typeof content === "object" ? content as Record<string, unknown> : {};
    const omittedCount = typeof record.omittedCount === "number" && Number.isFinite(record.omittedCount)
        ? record.omittedCount + 1
        : 1;
    if (tool === "inspect_obsidian_note") {
        return {
            kind: "note-structure",
            path: typeof record.path === "string" ? record.path : "",
            title: typeof record.title === "string" ? record.title : undefined,
            truncated: true,
            omittedCount,
        } satisfies InspectObsidianNoteOutput;
    }
    if (tool === "read_canvas_summary") {
        return {
            kind: "canvas-structure",
            path: typeof record.path === "string" ? record.path : "",
            nodeCount: typeof record.nodeCount === "number" ? record.nodeCount : 0,
            edgeCount: typeof record.edgeCount === "number" ? record.edgeCount : 0,
            truncated: true,
            omittedCount,
        } satisfies ReadCanvasSummaryOutput;
    }
    if (tool === "search_vault_snippets") {
        return {
            kind: "vault-snippets",
            query: typeof record.query === "string" ? record.query : "",
            scope: typeof record.scope === "string" ? record.scope : undefined,
            matches: [],
            unsupportedScope: record.unsupportedScope === true ? true : undefined,
            missingScope: record.missingScope === true ? true : undefined,
            scannedFiles: typeof record.scannedFiles === "number" ? record.scannedFiles : undefined,
            scannedBytes: typeof record.scannedBytes === "number" ? record.scannedBytes : undefined,
            truncated: true,
            omittedCount,
        } satisfies VaultSnippetSearchOutput;
    }
    return {
        kind: "vault-tags",
        tags: [],
        scannedFiles: typeof record.scannedFiles === "number" ? record.scannedFiles : undefined,
        truncated: true,
        omittedCount,
    } satisfies VaultTagsOutput;
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
            const result = listVaultTags(context.plugin, input.limit);
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

export function isInspectObsidianNoteResult(content: unknown): content is InspectObsidianNoteOutput {
    return Boolean(
        content
        && typeof content === "object"
        && (content as Record<string, unknown>).kind === "note-structure"
        && typeof (content as Record<string, unknown>).path === "string",
    );
}

export function isReadCanvasSummaryResult(content: unknown): content is ReadCanvasSummaryOutput {
    return Boolean(
        content
        && typeof content === "object"
        && (content as Record<string, unknown>).kind === "canvas-structure"
        && typeof (content as Record<string, unknown>).path === "string"
        && typeof (content as Record<string, unknown>).nodeCount === "number"
        && typeof (content as Record<string, unknown>).edgeCount === "number",
    );
}

export function isVaultSnippetSearchResult(content: unknown): content is VaultSnippetSearchOutput {
    return Boolean(
        content
        && typeof content === "object"
        && (content as Record<string, unknown>).kind === "vault-snippets"
        && typeof (content as Record<string, unknown>).query === "string"
        && Array.isArray((content as Record<string, unknown>).matches),
    );
}

export function isVaultTagsResult(content: unknown): content is VaultTagsOutput {
    return Boolean(
        content
        && typeof content === "object"
        && (content as Record<string, unknown>).kind === "vault-tags"
        && Array.isArray((content as Record<string, unknown>).tags),
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

function validateInspectObsidianNoteInput(input: unknown): InspectObsidianNoteInput {
    if (!input || typeof input !== "object") {
        throw new Error("note structure input must be an object.");
    }
    const value = input as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(value, "path")) {
        return {};
    }
    if (typeof value.path !== "string" || !value.path.trim()) {
        throw new Error("note path must be a non-empty string when supplied.");
    }
    return { path: validateVaultRelativeTargetPath(value.path.trim(), [".md"], "note path") };
}

function validateReadCanvasSummaryInput(input: unknown): ReadCanvasSummaryInput {
    if (!input || typeof input !== "object") {
        throw new Error("canvas summary input must be an object.");
    }
    const value = input as Record<string, unknown>;
    const path = typeof value.path === "string" ? value.path.trim() : "";
    if (!path) {
        throw new Error("canvas path must be a non-empty string.");
    }
    return {
        path: validateVaultRelativeTargetPath(path, [".canvas"], "canvas path"),
    };
}

function validateSearchVaultSnippetsInput(input: unknown): SearchVaultSnippetsInput {
    if (!input || typeof input !== "object") {
        throw new Error("snippet search input must be an object.");
    }
    const value = input as Record<string, unknown>;
    const query = typeof value.query === "string" ? value.query.trim() : "";
    if (!query) {
        throw new Error("snippet query must be a non-empty string.");
    }
    const rawScope = typeof value.scope === "string" ? value.scope.trim() : "";
    const scope = rawScope
        ? validateVaultRelativeTargetPath(rawScope, [".md"], "snippet scope", { allowFolder: true })
        : undefined;
    return {
        query: limitInputText(query, SNIPPET_QUERY_MAX_CHARS),
        limit: normalizeLimit(value.limit, SNIPPET_DEFAULT_LIMIT, SNIPPET_MAX_LIMIT),
        scope,
    };
}

function validateListVaultTagsInput(input: unknown): ListVaultTagsInput {
    if (!input || typeof input !== "object") {
        return { limit: TAGS_DEFAULT_LIMIT };
    }
    const value = input as Record<string, unknown>;
    return {
        limit: normalizeLimit(value.limit, TAGS_DEFAULT_LIMIT, TAGS_MAX_LIMIT),
    };
}

export function isChatToolName(name: string): name is ChatToolName {
    return name === "search_memory"
        || name === "get_current_note_context"
        || name === "search_vault_metadata"
        || name === "list_recent_notes"
        || name === "read_note_outline"
        || isObsidianOperationsV1AToolName(name);
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

function getOptionalMetadataCache(plugin: PluginManager): MetadataCacheLike | undefined {
    const metadataCache = plugin.app.metadataCache as unknown;
    return metadataCache && typeof metadataCache === "object"
        ? metadataCache as MetadataCacheLike
        : undefined;
}

function getMarkdownFiles(plugin: PluginManager): MarkdownFileLike[] {
    return getVault(plugin).getMarkdownFiles?.() ?? [];
}

async function readVaultFile(plugin: PluginManager, file: VaultFileLike): Promise<string> {
    return await getVault(plugin).cachedRead?.(file) ?? "";
}

interface BudgetedVaultRead {
    content: string;
    truncated: boolean;
    skippedForSize: boolean;
    knownSize?: number;
}

async function readVaultFileWithBudget(
    plugin: PluginManager,
    file: VaultFileLike,
    maxBytes: number,
): Promise<BudgetedVaultRead> {
    const knownSize = getKnownFileSize(file);
    if (knownSize !== undefined && knownSize > maxBytes) {
        return {
            content: "",
            truncated: true,
            skippedForSize: true,
            knownSize,
        };
    }

    const content = await readVaultFile(plugin, file);
    const contentBytes = getUtf8ByteLength(content);
    if (contentBytes <= maxBytes) {
        return {
            content,
            truncated: false,
            skippedForSize: false,
            knownSize,
        };
    }

    return {
        content: truncateToUtf8ByteLength(content, maxBytes),
        truncated: true,
        skippedForSize: false,
        knownSize,
    };
}

function getKnownFileSize(file: VaultFileLike): number | undefined {
    const size = file.stat?.size;
    return typeof size === "number" && Number.isFinite(size) && size >= 0 ? size : undefined;
}

function canReadVaultFiles(plugin: PluginManager): boolean {
    return typeof getVault(plugin).cachedRead === "function";
}

function getUtf8ByteLength(value: string): number {
    return new TextEncoder().encode(value).length;
}

function truncateToUtf8ByteLength(value: string, maxBytes: number): string {
    if (maxBytes <= 0) return "";
    const encoder = new TextEncoder();
    if (encoder.encode(value).length <= maxBytes) return value;

    let best = "";
    let low = 0;
    let high = value.length;
    while (low <= high) {
        const midpoint = Math.floor((low + high) / 2);
        const candidate = value.slice(0, midpoint);
        if (encoder.encode(candidate).length <= maxBytes) {
            best = candidate;
            low = midpoint + 1;
        } else {
            high = midpoint - 1;
        }
    }
    return best;
}

function getUnavailableNoteStructureSources(
    plugin: PluginManager,
    metadataCache: MetadataCacheLike | undefined,
): string[] {
    const unavailableSources: string[] = [];
    if (!metadataCache || typeof metadataCache.getFileCache !== "function") {
        unavailableSources.push(METADATA_CACHE_UNAVAILABLE_SOURCE);
    }
    if (!canReadVaultFiles(plugin)) {
        unavailableSources.push(VAULT_FILE_READ_UNAVAILABLE_SOURCE);
    }
    return unavailableSources;
}

function findMarkdownFileByPath(plugin: PluginManager, path: string): MarkdownFileLike | null {
    const byPath = getVault(plugin).getAbstractFileByPath?.(path);
    if (isMarkdownFileLike(byPath)) {
        return byPath;
    }
    return getMarkdownFiles(plugin).find((file) => file.path === path) ?? null;
}

function findVaultFileByPath(plugin: PluginManager, path: string): VaultFileLike | null {
    const byPath = getVault(plugin).getAbstractFileByPath?.(path);
    if (isVaultFileLike(byPath)) {
        return byPath;
    }
    return getMarkdownFiles(plugin).find((file) => file.path === path) ?? null;
}

function isVaultFileLike(value: unknown): value is VaultFileLike {
    return Boolean(value && typeof value === "object" && typeof (value as VaultFileLike).path === "string");
}

function isMarkdownFileLike(value: unknown): value is MarkdownFileLike {
    return Boolean(
        value
        && typeof value === "object"
        && typeof (value as MarkdownFileLike).path === "string"
        && (value as MarkdownFileLike).path.toLowerCase().endsWith(".md"),
    );
}

function validateVaultRelativeTargetPath(
    rawPath: string,
    allowedExtensions: string[],
    fieldName: string,
    options: { allowFolder?: boolean } = {},
): string {
    const path = rawPath.replace(/\\/g, "/").trim();
    if (!path) {
        throw new Error(`${fieldName} must be a non-empty vault-relative path.`);
    }
    if (path.length > OBSIDIAN_TARGET_PATH_MAX_CHARS) {
        throw new Error(`${fieldName} is too long.`);
    }
    if (
        path.startsWith("/")
        || path.startsWith("~")
        || /^[a-zA-Z]:\//.test(path)
        || path.includes("\0")
        || /\$(?:\{[^}]+\}|[A-Za-z_][A-Za-z0-9_]*)|%[A-Za-z_][A-Za-z0-9_]*%/.test(path)
    ) {
        throw new Error(`${fieldName} must be a vault-relative path.`);
    }
    const segments = path.split("/").filter((segment) => segment.length > 0);
    if (segments.some((segment) => segment === "." || segment === "..")) {
        throw new Error(`${fieldName} must not contain path traversal.`);
    }

    const lower = path.toLowerCase();
    if (allowedExtensions.some((extension) => lower.endsWith(extension))) {
        return path;
    }
    if (options.allowFolder) {
        return path.replace(/\/+$/, "");
    }
    throw new Error(`${fieldName} has an unsupported file type.`);
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
    const tags = collectCacheTags(cache);
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

function collectCacheTags(cache: FileCacheLike | null | undefined): string[] {
    return mergeUnique([
        ...normalizeInlineTags(cache?.tags),
        ...normalizeFrontmatterTags(cache?.frontmatter),
    ]);
}

function normalizeInlineTags(tags: FileCacheLike["tags"]): string[] {
    if (!Array.isArray(tags)) return [];
    return mergeUnique(tags
        .map((entry) => typeof entry.tag === "string" ? normalizeTagName(entry.tag) : "")
        .filter((tag) => tag.length > 0));
}

function normalizeFrontmatterTags(frontmatter: Record<string, unknown> | undefined): string[] {
    if (!frontmatter || typeof frontmatter !== "object") return [];
    return mergeUnique([
        ...normalizeFrontmatterTagValue(frontmatter.tags),
        ...normalizeFrontmatterTagValue(frontmatter.tag),
    ]);
}

function normalizeFrontmatterTagValue(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.flatMap(normalizeFrontmatterTagValue);
    }
    if (typeof value !== "string") return [];
    return value
        .split(/[\s,]+/)
        .map(normalizeTagName)
        .filter((tag) => tag.length > 0);
}

function normalizeTagName(value: string): string {
    return value.replace(/^#/, "").trim();
}

function previewFrontmatter(
    frontmatter: Record<string, unknown> | undefined,
    maxKeys = FRONTMATTER_PREVIEW_MAX_KEYS,
): Record<string, string> {
    if (!frontmatter || typeof frontmatter !== "object") return {};
    const preview: Record<string, string> = {};
    for (const [key, value] of Object.entries(frontmatter).slice(0, maxKeys)) {
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

function buildNoteStructureSummary(
    file: MarkdownFileLike,
    cache: FileCacheLike | null | undefined,
    content: string,
    metadataCache: MetadataCacheLike | undefined,
    unavailableSources: string[] = [],
    options: { truncated?: boolean; skippedSources?: string[]; omittedCount?: number } = {},
): InspectObsidianNoteOutput {
    let omittedCount = options.omittedCount ?? 0;
    const countOmitted = (count: number) => {
        omittedCount += count;
    };
    const parsed = parseMarkdownStructure(content);
    const headingCandidates = extractNoteHeadings(cache, parsed.headings);
    const tags = takeWithOmitted(mergeUnique([...collectCacheTags(cache), ...parsed.tags]), INSPECT_NOTE_MAX_TAGS, countOmitted);
    const headings = takeWithOmitted(headingCandidates, INSPECT_NOTE_MAX_HEADINGS, countOmitted);
    const tasks = takeWithOmitted(parsed.tasks, INSPECT_NOTE_MAX_TASKS, countOmitted);
    const callouts = takeWithOmitted(parsed.callouts, INSPECT_NOTE_MAX_CALLOUTS, countOmitted);
    const wikilinks = takeWithOmitted(mergeUnique([...extractCacheLinks(cache?.links), ...parsed.wikilinks]), INSPECT_NOTE_MAX_LINKS, countOmitted);
    const embeds = takeWithOmitted(mergeUnique([...extractCacheLinks(cache?.embeds), ...parsed.embeds]), INSPECT_NOTE_MAX_LINKS, countOmitted);
    const wikilinkTargets = takeWithOmitted(mergeUniqueLinkTargets([
        ...extractCacheLinkTargets(cache?.links),
        ...parsed.wikilinkTargets,
    ]), INSPECT_NOTE_MAX_LINKS, countOmitted);
    const embedTargets = takeWithOmitted(mergeUniqueLinkTargets([
        ...extractCacheLinkTargets(cache?.embeds, true),
        ...parsed.embedTargets,
    ]), INSPECT_NOTE_MAX_LINKS, countOmitted);
    const outgoingLinks = takeWithOmitted(mergeUnique([
        ...wikilinks,
        ...embeds,
        ...Object.keys(metadataCache?.resolvedLinks?.[file.path] ?? {}),
    ]), INSPECT_NOTE_MAX_LINKS, countOmitted);
    const backlinks = takeWithOmitted(findBacklinksForPath(file.path, metadataCache?.resolvedLinks), INSPECT_NOTE_MAX_LINKS, countOmitted);
    const unresolvedLinks = takeWithOmitted(Object.keys(metadataCache?.unresolvedLinks?.[file.path] ?? {}), INSPECT_NOTE_MAX_LINKS, countOmitted);
    const output: InspectObsidianNoteOutput = {
        kind: "note-structure",
        path: file.path,
        title: getFileTitle(file),
        properties: previewFrontmatter(cache?.frontmatter, INSPECT_NOTE_MAX_PROPERTIES),
        tags,
        headings,
        tasks,
        callouts,
        wikilinks,
        embeds,
        wikilinkTargets,
        embedTargets,
        outgoingLinks,
        backlinks,
        unresolvedLinks,
        links: {
            outgoing: outgoingLinks,
            backlinks,
            unresolved: unresolvedLinks,
        },
    };
    if (unavailableSources.length > 0) {
        output.unavailableSources = unavailableSources;
    }
    if (options.skippedSources && options.skippedSources.length > 0) {
        output.skippedSources = options.skippedSources;
    }
    if (omittedCount > 0 || options.truncated) {
        output.truncated = true;
        if (omittedCount > 0) {
            output.omittedCount = omittedCount;
        }
    }
    return output;
}

function extractNoteHeadings(
    cache: FileCacheLike | null | undefined,
    fallback: NoteOutlineHeading[],
): NoteOutlineHeading[] {
    if (!Array.isArray(cache?.headings)) return fallback;
    return cache.headings
        .map((heading) => ({
            level: normalizeHeadingLevel(heading.level),
            text: typeof heading.heading === "string" ? heading.heading.trim() : "",
        }))
        .filter((heading) => heading.text.length > 0);
}

interface ParsedMarkdownStructure {
    headings: NoteOutlineHeading[];
    tasks: Array<{ line: number; text: string; status: string; checked: boolean }>;
    callouts: Array<{ line: number; type: string; title?: string }>;
    wikilinks: string[];
    embeds: string[];
    wikilinkTargets: ObsidianLinkTarget[];
    embedTargets: ObsidianLinkTarget[];
    tags: string[];
}

function parseMarkdownStructure(content: string): ParsedMarkdownStructure {
    const lines = content.split(/\r?\n/).slice(0, INSPECT_NOTE_SCAN_LINES);
    const headings: NoteOutlineHeading[] = [];
    const tasks: ParsedMarkdownStructure["tasks"] = [];
    const callouts: ParsedMarkdownStructure["callouts"] = [];
    const wikilinks: string[] = [];
    const embeds: string[] = [];
    const wikilinkTargets: ObsidianLinkTarget[] = [];
    const embedTargets: ObsidianLinkTarget[] = [];
    const tags: string[] = [];
    let fence: { marker: "`" | "~"; length: number } | null = null;

    lines.forEach((line, index) => {
        const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
        if (fenceMatch) {
            const marker = fenceMatch[1][0] as "`" | "~";
            const length = fenceMatch[1].length;
            if (!fence) {
                fence = { marker, length };
            } else if (marker === fence.marker && length >= fence.length) {
                fence = null;
            }
            return;
        }
        if (fence) return;

        const heading = parseHeading(line);
        if (heading) {
            headings.push({ level: heading.level, text: heading.text.replace(/^#{1,6}\s+/, "") });
        }
        const task = line.match(/^\s*[-*+]\s+\[([^\]\r\n])\]\s+(.+)$/);
        if (task) {
            tasks.push({
                line: index + 1,
                text: truncate(task[2].trim(), FRONTMATTER_VALUE_MAX_CHARS),
                status: task[1],
                checked: task[1].toLowerCase() === "x",
            });
        }
        const callout = line.match(/^\s*>\s*\[!([^\]\s+-]+)[^\]]*\]\s*(.*)$/);
        if (callout) {
            const title = callout[2].trim();
            callouts.push({
                line: index + 1,
                type: callout[1],
                title: title ? truncate(title, FRONTMATTER_VALUE_MAX_CHARS) : undefined,
            });
        }
        for (const match of line.matchAll(/(!?)\[\[([^\]]+)]]/g)) {
            const embedded = match[1] === "!";
            const parsedTarget = parseWikiTarget(match[2], embedded);
            if (!parsedTarget) continue;
            const target = parsedTarget.path ?? "";
            if (match[1] === "!") {
                if (target) embeds.push(target);
                embedTargets.push(parsedTarget);
            } else {
                if (target) wikilinks.push(target);
                wikilinkTargets.push(parsedTarget);
            }
        }
        for (const match of line.matchAll(/(^|[\s([{])#([A-Za-z0-9_/-]+)/g)) {
            tags.push(match[2]);
        }
    });

    return {
        headings,
        tasks,
        callouts,
        wikilinks: mergeUnique(wikilinks),
        embeds: mergeUnique(embeds),
        wikilinkTargets: mergeUniqueLinkTargets(wikilinkTargets),
        embedTargets: mergeUniqueLinkTargets(embedTargets),
        tags: mergeUnique(tags),
    };
}

function parseWikiTarget(value: string, embedded = false): ObsidianLinkTarget | null {
    const raw = value.trim();
    if (!raw) return null;
    const [targetPart, ...aliasParts] = raw.split("|");
    const alias = aliasParts.join("|").trim();
    const hashIndex = targetPart.indexOf("#");
    const path = hashIndex >= 0 ? targetPart.slice(0, hashIndex).trim() : targetPart.trim();
    const subpath = hashIndex >= 0 ? targetPart.slice(hashIndex).trim() : "";
    return {
        raw,
        path: path || undefined,
        subpath: subpath || undefined,
        alias: alias || undefined,
        embedded: embedded || undefined,
    };
}

function extractCacheLinks(links: FileCacheLike["links"] | FileCacheLike["embeds"]): string[] {
    if (!Array.isArray(links)) return [];
    return mergeUnique(links.map((entry) => parseWikiTarget(entry.link ?? "")?.path ?? "").filter(Boolean));
}

function extractCacheLinkTargets(
    links: FileCacheLike["links"] | FileCacheLike["embeds"],
    embedded = false,
): ObsidianLinkTarget[] {
    if (!Array.isArray(links)) return [];
    return mergeUniqueLinkTargets(links
        .map((entry) => {
            const originalTarget = parseOriginalWikiTarget(entry.original, embedded);
            if (originalTarget) return originalTarget;
            const target = parseWikiTarget(entry.link ?? "", embedded);
            if (!target) return null;
            const alias = typeof entry.displayText === "string" && entry.displayText.trim()
                ? entry.displayText.trim()
                : target.alias;
            return { ...target, alias };
        })
        .filter((target): target is ObsidianLinkTarget => target !== null));
}

function parseOriginalWikiTarget(original: unknown, embedded: boolean): ObsidianLinkTarget | null {
    if (typeof original !== "string") return null;
    const match = original.match(/!?\[\[([^\]]+)]]/);
    if (!match) return null;
    return parseWikiTarget(match[1], embedded || original.trim().startsWith("!"));
}

function findBacklinksForPath(
    targetPath: string,
    resolvedLinks: Record<string, Record<string, number>> | undefined,
): string[] {
    if (!resolvedLinks) return [];
    return Object.entries(resolvedLinks)
        .filter(([, targets]) => targets && typeof targets === "object" && targetPath in targets)
        .map(([sourcePath]) => sourcePath)
        .sort((a, b) => a.localeCompare(b));
}

function buildCanvasStructureSummary(file: VaultFileLike, content: string): ReadCanvasSummaryOutput | null {
    const parsed = parseCanvasJson(content);
    if (!parsed) return null;
    const nodes = parsed.nodes.filter(isCanvasNode);
    const edges = parsed.edges.filter(isCanvasEdge);
    const nodeIds = nodes.map((node) => node.id);
    const nodeIdSet = new Set(nodeIds);
    const duplicateIds = findDuplicateValues(nodeIds);
    const connectedIds = new Set<string>();
    const danglingEdges = edges
        .filter((edge) => !nodeIdSet.has(edge.fromNode) || !nodeIdSet.has(edge.toNode))
        .map((edge) => ({
            id: edge.id,
            fromNode: nodeIdSet.has(edge.fromNode) ? undefined : edge.fromNode,
            toNode: nodeIdSet.has(edge.toNode) ? undefined : edge.toNode,
        }));
    for (const edge of edges) {
        if (nodeIdSet.has(edge.fromNode) && nodeIdSet.has(edge.toNode)) {
            connectedIds.add(edge.fromNode);
            connectedIds.add(edge.toNode);
        }
    }
    const isolatedNodes = nodeIds.filter((id) => !connectedIds.has(id));
    const groups = nodes
        .filter((node) => node.type === "group")
        .map((node) => ({
            id: node.id,
            label: typeof node.label === "string" ? truncate(node.label, FRONTMATTER_VALUE_MAX_CHARS) : undefined,
            color: typeof node.color === "string" ? node.color : undefined,
        }));
    const snippets = nodes
        .map(canvasNodeToSnippet)
        .filter((snippet): snippet is CanvasTextSnippet => snippet !== null);
    let omittedCount = 0;
    const countOmitted = (count: number) => {
        omittedCount += count;
    };
    const output: ReadCanvasSummaryOutput = {
        kind: "canvas-structure",
        path: file.path,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        duplicateIds: takeWithOmitted(duplicateIds, CANVAS_MAX_DUPLICATE_IDS, countOmitted),
        danglingEdges: takeWithOmitted(danglingEdges, CANVAS_MAX_DANGLING_EDGES, countOmitted),
        isolatedNodes: takeWithOmitted(isolatedNodes, CANVAS_MAX_ISOLATED_NODES, countOmitted),
        groups: takeWithOmitted(groups, CANVAS_MAX_GROUPS, countOmitted),
        snippets: takeWithOmitted(snippets, CANVAS_MAX_SNIPPETS, countOmitted),
    };
    if (omittedCount > 0) {
        output.truncated = true;
        output.omittedCount = omittedCount;
    }
    return output;
}

function createUnavailableCanvasSummary(file: VaultFileLike, unavailableSource: string): ReadCanvasSummaryOutput {
    return {
        kind: "canvas-structure",
        path: file.path,
        nodeCount: 0,
        edgeCount: 0,
        unavailableSources: [unavailableSource],
        truncated: true,
        omittedCount: 1,
    };
}

function createSkippedCanvasSummary(file: VaultFileLike, skippedSource: string): ReadCanvasSummaryOutput {
    return {
        kind: "canvas-structure",
        path: file.path,
        nodeCount: 0,
        edgeCount: 0,
        skippedSources: [skippedSource],
        truncated: true,
        omittedCount: 1,
    };
}

function parseCanvasJson(content: string): { nodes: unknown[]; edges: unknown[] } | null {
    try {
        const parsed = JSON.parse(content) as unknown;
        if (!parsed || typeof parsed !== "object") return null;
        const record = parsed as Record<string, unknown>;
        return {
            nodes: Array.isArray(record.nodes) ? record.nodes : [],
            edges: Array.isArray(record.edges) ? record.edges : [],
        };
    } catch {
        return null;
    }
}

interface CanvasNodeLike {
    id: string;
    type?: string;
    text?: string;
    label?: string;
    file?: string;
    color?: string;
}

interface CanvasEdgeLike {
    id?: string;
    fromNode: string;
    toNode: string;
}

function isCanvasNode(value: unknown): value is CanvasNodeLike {
    return Boolean(value && typeof value === "object" && typeof (value as CanvasNodeLike).id === "string");
}

function isCanvasEdge(value: unknown): value is CanvasEdgeLike {
    return Boolean(
        value
        && typeof value === "object"
        && typeof (value as CanvasEdgeLike).fromNode === "string"
        && typeof (value as CanvasEdgeLike).toNode === "string",
    );
}

function canvasNodeToSnippet(node: CanvasNodeLike): CanvasTextSnippet | null {
    const rawText = typeof node.text === "string"
        ? node.text
        : typeof node.label === "string"
            ? node.label
            : typeof node.file === "string"
                ? node.file
                : "";
    const text = rawText.replace(/\s+/g, " ").trim();
    if (!text) return null;
    return {
        id: node.id,
        type: node.type ?? "unknown",
        text: truncate(text, CANVAS_SNIPPET_MAX_CHARS),
    };
}

function findDuplicateValues(values: string[]): string[] {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const value of values) {
        if (seen.has(value)) {
            duplicates.add(value);
        }
        seen.add(value);
    }
    return [...duplicates].sort((a, b) => a.localeCompare(b));
}

async function searchVaultSnippets(
    plugin: PluginManager,
    input: SearchVaultSnippetsInput,
    signal: AbortSignal | undefined,
): Promise<VaultSnippetSearchOutput> {
    if (!canReadVaultFiles(plugin)) {
        return {
            kind: "vault-snippets",
            query: input.query,
            scope: input.scope,
            matches: [],
            scannedFiles: 0,
            scannedBytes: 0,
            unavailableSources: [VAULT_FILE_READ_UNAVAILABLE_SOURCE],
        };
    }

    if (input.scope && !snippetScopeHasReadableMarkdown(plugin, input.scope)) {
        const unsupportedScope = isUnsupportedSnippetFileScope(plugin, input.scope);
        return {
            kind: "vault-snippets",
            query: input.query,
            scope: input.scope,
            matches: [],
            scannedFiles: 0,
            scannedBytes: 0,
            consideredFiles: 0,
            missingScope: unsupportedScope ? undefined : true,
            unsupportedScope: unsupportedScope || undefined,
            unavailableSources: [unsupportedScope ? SNIPPET_SCOPE_UNSUPPORTED_SOURCE : SNIPPET_SCOPE_UNAVAILABLE_SOURCE],
        };
    }

    const normalizedQuery = normalizeSearchText(input.query);
    const matches: VaultSnippetMatch[] = [];
    let consideredFiles = 0;
    let scannedFiles = 0;
    let scannedBytes = 0;
    let skippedFiles = 0;
    let omittedCount = 0;
    let truncated = false;

    for (const file of getMarkdownFiles(plugin)) {
        if (!isFileWithinSnippetScope(file.path, input.scope)) continue;
        throwIfAborted(signal);
        if (consideredFiles >= SNIPPET_MAX_CANDIDATE_FILES) {
            truncated = true;
            omittedCount++;
            break;
        }
        consideredFiles++;
        if (scannedFiles >= SNIPPET_MAX_FILES || scannedBytes >= SNIPPET_MAX_BYTES) {
            truncated = true;
            omittedCount++;
            break;
        }
        const remainingByteBudget = SNIPPET_MAX_BYTES - scannedBytes;
        const knownSize = getKnownFileSize(file);
        if (
            knownSize !== undefined
            && (knownSize > SNIPPET_MAX_FILE_BYTES || knownSize > remainingByteBudget)
        ) {
            skippedFiles++;
            truncated = true;
            omittedCount++;
            continue;
        }

        const contentBudget = Math.min(SNIPPET_MAX_FILE_BYTES, remainingByteBudget);
        const readResult = await readVaultFileWithBudget(plugin, file, contentBudget);
        if (readResult.skippedForSize) {
            skippedFiles++;
            truncated = true;
            omittedCount++;
            continue;
        }
        const content = readResult.content;
        scannedFiles++;
        scannedBytes += getUtf8ByteLength(content);
        if (readResult.truncated || scannedBytes > SNIPPET_MAX_BYTES) {
            truncated = true;
            omittedCount++;
        }
        const match = findSnippetMatch(file, content, normalizedQuery);
        if (!match) continue;
        if (matches.length >= input.limit) {
            truncated = true;
            omittedCount++;
            continue;
        }
        matches.push(match);
    }

    return {
        kind: "vault-snippets",
        query: input.query,
        scope: input.scope,
        matches,
        scannedFiles,
        scannedBytes,
        consideredFiles,
        skippedFiles: skippedFiles || undefined,
        skippedSources: skippedFiles > 0 ? [VAULT_FILE_READ_SKIPPED_SIZE_SOURCE] : undefined,
        truncated: truncated || undefined,
        omittedCount: omittedCount || undefined,
    };
}

function snippetScopeHasReadableMarkdown(plugin: PluginManager, scope: string): boolean {
    if (scope.toLowerCase().endsWith(".md")) {
        return Boolean(findMarkdownFileByPath(plugin, scope));
    }
    return getMarkdownFiles(plugin).some((file) => isFileWithinSnippetScope(file.path, scope));
}

function isUnsupportedSnippetFileScope(plugin: PluginManager, scope: string): boolean {
    if (scope.toLowerCase().endsWith(".md")) return false;
    const abstractFile = getVault(plugin).getAbstractFileByPath?.(scope);
    if (!isVaultFileLike(abstractFile)) return false;
    const extension = typeof abstractFile.extension === "string" ? abstractFile.extension.toLowerCase() : "";
    if (extension) return extension !== "md";
    return hasKnownUnsupportedFileExtension(abstractFile.path);
}

function hasKnownUnsupportedFileExtension(path: string): boolean {
    return /\.(?:canvas|txt|pdf|png|jpe?g|gif|webp|json|ya?ml|csv|tsv|js|ts|css|html?|docx?|xlsx?|pptx?|zip)$/i.test(path);
}

function isFileWithinSnippetScope(path: string, scope: string | undefined): boolean {
    if (!scope) return true;
    if (scope.toLowerCase().endsWith(".md")) {
        return path === scope;
    }
    const prefix = scope.endsWith("/") ? scope : `${scope}/`;
    return path.startsWith(prefix);
}

function findSnippetMatch(
    file: MarkdownFileLike,
    content: string,
    normalizedQuery: string,
): VaultSnippetMatch | null {
    const normalizedContent = normalizeSearchText(content);
    const index = normalizedContent.indexOf(normalizedQuery);
    if (index < 0) return null;
    const start = Math.max(0, index - SNIPPET_CONTEXT_CHARS);
    const end = Math.min(content.length, index + normalizedQuery.length + SNIPPET_CONTEXT_CHARS);
    const line = content.slice(0, index).split(/\r?\n/).length;
    const snippet = content.slice(start, end).replace(/\s+/g, " ").trim();
    return {
        path: file.path,
        title: getFileTitle(file),
        line,
        snippet: truncate(snippet, SNIPPET_MAX_CHARS),
    };
}

function listVaultTags(plugin: PluginManager, limit: number): VaultTagsOutput {
    const metadataCache = getOptionalMetadataCache(plugin);
    if (!metadataCache || typeof metadataCache.getFileCache !== "function") {
        return {
            kind: "vault-tags",
            tags: [],
            unavailableSources: [METADATA_CACHE_UNAVAILABLE_SOURCE],
        };
    }

    const files = getMarkdownFiles(plugin);
    const byTag = new Map<string, { count: number; representativePaths: string[] }>();
    let scannedFiles = 0;
    for (const file of files) {
        if (scannedFiles >= TAGS_SCAN_MAX_FILES) break;
        scannedFiles++;
        const tags = collectCacheTags(metadataCache.getFileCache?.(file));
        for (const tag of tags) {
            const displayTag = tag.startsWith("#") ? tag : `#${tag}`;
            const entry = byTag.get(displayTag) ?? { count: 0, representativePaths: [] };
            entry.count++;
            if (entry.representativePaths.length < TAG_REPRESENTATIVE_PATHS) {
                entry.representativePaths.push(file.path);
            }
            byTag.set(displayTag, entry);
        }
    }
    const skippedFiles = Math.max(0, files.length - scannedFiles);
    const allTags = [...byTag.entries()]
        .map(([tag, entry]) => ({ tag, count: entry.count, representativePaths: entry.representativePaths }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    const tags = allTags.slice(0, limit);
    return {
        kind: "vault-tags",
        tags,
        scannedFiles,
        skippedFiles: skippedFiles || undefined,
        truncated: allTags.length > limit || skippedFiles > 0 || undefined,
        omittedCount: allTags.length > limit ? allTags.length - limit : undefined,
    };
}

function mergeUnique(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function mergeUniqueLinkTargets(values: ObsidianLinkTarget[]): ObsidianLinkTarget[] {
    const seen = new Set<string>();
    const result: ObsidianLinkTarget[] = [];
    for (const value of values) {
        const key = [
            value.raw,
            value.path ?? "",
            value.subpath ?? "",
            value.alias ?? "",
            value.embedded ? "embedded" : "link",
        ].join("\u0000");
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(value);
    }
    return result;
}

function takeWithOmitted<T>(values: T[], limit: number, onOmitted: (count: number) => void): T[] {
    if (values.length <= limit) return values;
    onOmitted(values.length - limit);
    return values.slice(0, limit);
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

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function sanitizeToolErrorMessage(error: unknown, fallback: string): string {
    const message = getErrorMessage(error).replace(/\s+/g, " ").trim();
    return message ? truncate(message, TOOL_VALIDATION_INPUT_SUMMARY_CHARS) : fallback;
}

function summarizeInvalidToolInput(input: unknown): string {
    try {
        const serialized = JSON.stringify(input);
        if (typeof serialized === "string") {
            return truncate(serialized, TOOL_VALIDATION_INPUT_SUMMARY_CHARS);
        }
    } catch {
        // Fall through to String(input).
    }
    return truncate(String(input), TOOL_VALIDATION_INPUT_SUMMARY_CHARS);
}

function getErrorType(error: unknown): string {
    return error instanceof Error ? error.name : typeof error;
}

function truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength)}...`;
}
