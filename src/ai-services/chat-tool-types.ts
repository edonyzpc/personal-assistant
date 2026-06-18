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
    signal?: AbortSignal;
    onBeforeVssSearch?: () => void;
    onToolRunning?: (tool: string, message: string) => void;
}

export type ChatToolPermission = "read-only" | "network-read";
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
