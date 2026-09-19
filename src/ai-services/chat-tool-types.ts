/**
 * Type definitions, type guards, and v1A tool-name policy constants for chat tools.
 *
 * Moved here from the original chat-tools.ts monolith as part of Phase 3.1
 * (docs/archive/sdd-chat-tools-split.md). Leaf module — depends only on `./chat-types`
 * and the AI services host interface.
 *
 * NOTE: `*Like` (EditorLike/VaultFileLike/MarkdownFileLike/MarkdownViewLike/
 * VaultLike/MetadataCacheLike/FileCacheLike) intentionally live in
 * `./chat-tool-execution-helpers` (Module E) — not here — to avoid promoting
 * vault-adapter shapes to the public type surface.
 */

import type { AiServiceHost } from "./AiServiceHost";
import type {
    ChatToolName,
    ChatToolResult,
} from "./chat-types";

export type { ChatToolName, ChatToolResult, MemorySearchResult } from "./chat-types";

export interface ChatToolContext {
    host: AiServiceHost;
    taskSourceReadGuard?: import('./task-source-read-guard').TaskSourceReadGuard;
    signal?: AbortSignal;
    /** Host-only absolute boundary registered by the outer Tool dispatcher. */
    outerToolDeadlineAt?: number;
    onBeforeVssSearch?: () => void;
    onToolRunning?: (tool: string, message: string) => void;
    currentMemoryUsage?: () => import("./memory-management-types").MemoryManagementCurrentUsageInput | undefined;
    /** Host-only authority for the one live PA Agent request issuing a Memory action. */
    memoryActionRequest?: import("./memory-action-types").MemoryActionHostBinding;
}

export type ChatToolPermission = "read-only" | "network-read" | "memory-management" | "insight-management" | "image-generation";
export type ChatToolCost = "free" | "ai-calls" | "network-calls";
export type ChatToolFailureBehavior = "recoverable";
export type ChatToolSourceBoundary = "memory" | "current-note" | "read-only-tool" | "web" | "skill-context";

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
    type?: "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";
    description?: string;
    enum?: string[];
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    properties?: Record<string, ChatToolInputSchemaProperty>;
    required?: string[];
    additionalProperties?: boolean | ChatToolInputSchemaProperty;
    items?: ChatToolInputSchemaProperty;
    anyOf?: ChatToolInputSchemaProperty[];
    oneOf?: ChatToolInputSchemaProperty[];
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

export interface PrepareToolArgumentsContext {
    userInput: string;
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
    /**
     * Optional pre-validation transform for raw tool-call arguments from the model.
     * - Maps known aliases to canonical schema keys (e.g., `q` → `query`).
     * - MUST NOT throw on unrepairable input; return raw so validateInput throws with a model-actionable error.
     * - May read ctx.userInput when a tool has a documented host-context shim
     *   (currently only get_current_note_context for shouldUseFullCurrentNoteContext override).
     */
    prepareArguments?: (raw: unknown, ctx: PrepareToolArgumentsContext) => unknown;
    validateInput(input: unknown): Input;
    execute(input: Input, context: ChatToolContext): Promise<ChatToolResult<Output>>;
}

/** Only semantic choices are model-visible. Identity and source/cost admission belong to the host. */
export interface CreateImageToolInput {
    prompt: string;
    operation: "generate" | "reference" | "edit";
    count: number;
    /** One-based selector only for clearly separate image requests in the same user message. */
    subrequestIndex?: number;
    /** Stable opaque refs from this request's authorized images or conversation versions. */
    referenceImageRefs: string[];
    parentVersionId?: string;
}

export interface CreateImageHostBinding {
    conversationId: string;
    stableMessageId: string;
    operationId: string;
    /** Revalidates refs, user cost budget and the durable operation before paid dispatch. */
    submit(input: CreateImageToolInput): Promise<{ taskId: string }>;
}

/**
 * Phase 4 preflight metadata for capability prepareAndValidate.
 * Mirrors `PrepareCapabilityArgumentsRepair` in capability-types.ts so the same
 * audit shape flows through ChatToolCapability bridge into Capability layer.
 */
export interface PrepareAndValidateRepair {
    originalKeys: string;
    originalInputSummary: string;
    reason: string;
}

/**
 * Result of registry.prepareAndValidate — used by PA executor to validate
 * tool input BEFORE registry.execute. Failure → schema_invalid outcome.
 * On success, `repaired` is populated when prepareArguments mutated the input
 * (Phase 4 preflight metadata for audit / Phase B alias-usage analytics).
 */
export type PrepareAndValidateResult =
    | { ok: true; input: unknown; repaired?: PrepareAndValidateRepair }
    | { ok: false; error: Error };

export interface SearchMemoryInput {
    query: string;
}

export type CurrentNoteContextMode = "selection-or-nearby" | "outline" | "metadata" | "full";

export interface CurrentNoteContextInput {
    mode: CurrentNoteContextMode;
}

export interface CurrentNoteContextOutput {
    path: string;
    title: string;
    mode: CurrentNoteContextMode;
    selection?: string;
    nearbyText?: string;
    fullText?: string;
    fullTextTruncated?: boolean;
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

export type ReadNotePart = "body" | "properties";

export interface ReadNoteInput {
    path: string;
    part?: ReadNotePart;
    startLine?: number;
    endLine?: number;
    maxChars: number;
    cursor?: string;
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
    part?: SearchVaultSnippetPart;
    caseSensitive?: boolean;
    cursor?: string;
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

export interface ReadNoteRange {
    startLine: number;
    endLine: number;
    /** Code-unit offsets within the selected body or raw-properties part. */
    startOffset: number;
    endOffset: number;
    partialLine: boolean;
}

export interface ReadNoteOutput {
    path: string;
    part: ReadNotePart;
    contentKind: "markdown-body" | "raw-frontmatter";
    text: string;
    sourceVersion: string;
    range: ReadNoteRange;
    truncated: boolean;
    complete: boolean;
    endOfPart: boolean;
    nextCursor?: string;
}

export type QueryNotesSortField = "path" | "ctime" | "mtime";
export type QueryNotesSortDirection = "asc" | "desc";

export interface QueryNotesSort {
    field: QueryNotesSortField;
    direction: QueryNotesSortDirection;
}

export type QueryNotesPropertyOperator = "exists" | "equals" | "contains";
export type QueryNotesPropertyValue = string | number | boolean | null;

export interface QueryNotesPropertyCondition {
    key: string;
    operator: QueryNotesPropertyOperator;
    value?: QueryNotesPropertyValue;
}

export interface QueryNotesDateFilter {
    field: "ctime" | "mtime" | "property";
    property?: string;
    kind: "timestamp" | "calendar-date";
    from: string;
    to: string;
}

export interface QueryNotesInput {
    path?: string;
    folder?: string;
    tags?: string[];
    properties?: QueryNotesPropertyCondition[];
    date?: QueryNotesDateFilter;
    sort: QueryNotesSort;
    limit: number;
    cursor?: string;
}

export interface QueryNotesMatch {
    path: string;
    title: string;
    ctime?: number;
    mtime?: number;
}

export interface QueryNotesCoverage {
    state: "complete" | "partial";
    scannedPermittedNotes: number;
    evaluatedCandidates: number;
    candidateCapExceeded?: boolean;
    projectionBudgetExceeded?: boolean;
    cacheUnknown?: boolean;
}

export interface QueryNotesOutput {
    query: Omit<QueryNotesInput, "limit" | "cursor">;
    matches: QueryNotesMatch[];
    matchCount: number;
    matchCountKind: "exact" | "lower-bound";
    sort: QueryNotesSort;
    coverage: QueryNotesCoverage;
    partialResultGuidance?: string;
    nextCursor?: string;
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
    coverage?: InspectNoteCoverage;
    unavailableSources?: string[];
    skippedSources?: string[];
    truncated?: boolean;
    omittedCount?: number;
}

export interface InspectNoteCoverage {
    state: "complete" | "partial";
    cacheState: "known" | "unknown";
    bodyRead: boolean;
    bodyRequired: boolean;
    evaluatedBacklinkSources: number;
    cacheCoverage?: "existing-items-only";
    backlinkScanCapExceeded?: boolean;
    outputTruncated?: boolean;
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
    part: SearchVaultSnippetPart;
    sourceVersion: string;
    range: VaultSnippetRange;
}

export interface VaultSnippetSearchOutput {
    kind: "vault-snippets";
    query: string;
    scope?: string;
    part: SearchVaultSnippetPart;
    caseSensitive: boolean;
    matches: VaultSnippetMatch[];
    matchCount: number;
    matchCountKind: "exact" | "lower-bound";
    page: VaultSnippetPage;
    coverage: VaultSnippetCoverage;
    partialResultGuidance?: string;
    nextCursor?: string;
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

export type SearchVaultSnippetPart = "body" | "properties" | "all";

export interface VaultSnippetRange {
    startOffset: number;
    endOffset: number;
    startLine: number;
    endLine: number;
    startColumn: number;
    endColumn: number;
}

export interface VaultSnippetPage {
    startIndex: number;
    returnedCount: number;
    requestedLimit: number;
    hasMore: boolean;
    outputBudgetExceeded?: boolean;
}

export interface VaultSnippetCoverage {
    state: "complete" | "partial";
    scannedPermittedNotes: number;
    evaluatedCandidates: number;
    readNotes: number;
    readBytes: number;
    evaluatedBytes: number;
    skippedFiles?: number;
    candidateCapExceeded?: boolean;
    fileCapExceeded?: boolean;
    byteCapExceeded?: boolean;
    unknownFileSize?: boolean;
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
