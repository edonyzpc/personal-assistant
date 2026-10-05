import type { TaskSourceReadGuard } from "../task-source-read-guard";

export const REMOVE_NOTE_IMAGE_TOOL_NAME = "remove_note_image" as const;
export type NoteImageRemovalAttachmentAction = "keep" | "delete";

export interface RemoveNoteImageInput {
    notePath: string;
    /** Exact source reference selected by the user; never a filename guess. */
    imageReference: string;
    attachmentAction: NoteImageRemovalAttachmentAction;
}

export const MARKDOWN_WRITE_TOOL_NAMES = [
    "vault_create",
    "vault_append",
    "vault_process",
    "frontmatter_update",
] as const;

export type MarkdownWriteToolName = typeof MARKDOWN_WRITE_TOOL_NAMES[number];

export const CORE_WRITE_TOOL_NAMES = [
    "vault_create",
    "vault_append",
    "vault_process",
    "frontmatter_update",
    REMOVE_NOTE_IMAGE_TOOL_NAME,
] as const;

export type CoreWriteToolName = typeof CORE_WRITE_TOOL_NAMES[number];
export const EXECUTE_OPERATIONS_TOOL_NAME = "execute_operations";

export type JsonLikeValue =
    | null
    | boolean
    | number
    | string
    | JsonLikeValue[]
    | { [key: string]: JsonLikeValue };

export interface VaultCreateInput {
    path: string;
    content: string;
}

export interface VaultAppendInput {
    path: string;
    content: string;
}

export type VaultProcessInput = {
    path: string;
    operation: "replace";
    params: {
        search: string;
        replace: string;
        occurrence?: "first" | "all";
    };
} | {
    path: string;
    operation: "insert";
    params: {
        anchor: { heading: string } | { line: number };
        position: "before" | "after";
        content: string;
    };
} | {
    path: string;
    operation: "delete";
    params: { section: string } | { from: number; to: number };
};

export interface FrontmatterUpdateInput {
    path: string;
    set?: Record<string, JsonLikeValue>;
    delete?: string[];
}

export interface CoreWriteInputMap {
    vault_create: VaultCreateInput;
    vault_append: VaultAppendInput;
    vault_process: VaultProcessInput;
    frontmatter_update: FrontmatterUpdateInput;
    remove_note_image: RemoveNoteImageInput;
}

export type CoreWriteInput = CoreWriteInputMap[CoreWriteToolName];
export type MarkdownWriteInput = CoreWriteInputMap[MarkdownWriteToolName];

export interface NoteImageRemovalFileIdentity {
    readonly path: string;
    readonly extension: string;
    /** Live host file object; used only for identity, never serialized. */
    readonly file: object;
    readonly version: { readonly mtime: number; readonly size: number };
}

export interface NoteImageRemovalSourceScope {
    readonly allowedPaths: readonly string[] | null;
    readonly excludedPaths: readonly string[];
}

export type NoteImageRemovalEffectStatus =
    | "not_started"
    | "applied"
    | "removed"
    | "failed"
    | "unknown"
    | "restored";

export interface NoteImageRemovalPreparedEffects {
    readonly note: {
        readonly path: string;
        readonly status: Extract<NoteImageRemovalEffectStatus, "not_started">;
    };
    readonly attachment: {
        readonly path: string;
        readonly action: NoteImageRemovalAttachmentAction;
        readonly plannedAction: "retain" | "remove";
        readonly status: Extract<NoteImageRemovalEffectStatus, "not_started">;
    };
}

export interface NoteImageRemovalCoverage {
    readonly kind: "current_note" | "scoped_vault_search";
    readonly complete: boolean;
    readonly candidateCount?: number;
    readonly readCount?: number;
    readonly excludedCount?: number;
    readonly canvasCount?: number;
    readonly reason?: string;
}

export interface PreparedMarkdownOperation {
    /** Existing Markdown operations predate the internal discriminated union. */
    readonly kind?: "markdown";
    readonly id: string;
    readonly toolCallId: string;
    readonly name: MarkdownWriteToolName;
    readonly input: MarkdownWriteInput;
    readonly path: string;
    readonly expectedBefore: string | null;
    readonly expectedAfter: string;
}

export interface PreparedNoteImageRemovalOperation {
    readonly kind: "note_image_removal";
    readonly id: string;
    readonly toolCallId: string;
    readonly name: typeof REMOVE_NOTE_IMAGE_TOOL_NAME;
    readonly input: RemoveNoteImageInput;
    readonly path: string;
    readonly expectedBefore: string;
    readonly expectedAfter: string;
    readonly effects: NoteImageRemovalPreparedEffects;
    readonly coverage: NoteImageRemovalCoverage;
    readonly undoLimitation: "markdown-only" | "temporary-attachment-and-note";
    /** Complete, authorized shared-reference evidence; this proposal cannot be confirmed. */
    readonly block?: {
        readonly reason: "shared_reference";
        readonly conflicts: readonly import("./note-image-removal").NoteImageRemovalConflict[];
    };
}

export interface NoteImageRemovalEffectResult {
    readonly key: "note" | "attachment";
    readonly status: NoteImageRemovalEffectStatus;
    readonly failureCategory?: OperationsFailureCategory;
    readonly message?: string;
    readonly checkpoint?: "attachment-restored";
}

export type PreparedOperation = PreparedMarkdownOperation | PreparedNoteImageRemovalOperation;

export function getOperationsBlockedReason(
    operations: readonly PreparedOperation[],
): "shared_reference" | undefined {
    return operations.some(operation => operation.kind === "note_image_removal" && operation.block)
        ? "shared_reference" : undefined;
}

export interface OperationsToolCall {
    toolCallId: string;
    name: CoreWriteToolName | typeof REMOVE_NOTE_IMAGE_TOOL_NAME;
    input: unknown;
}

export type OperationsIntentState =
    | "pending"
    | "cancelled"
    | "executing"
    | "completed"
    | "partial"
    | "failed"
    | "unknown";

export interface OperationsIntent {
    id: string;
    runId: string;
    turnId: string;
    createdAt: number;
    expiresAt: number;
    operations: readonly PreparedOperation[];
    state: OperationsIntentState;
}

export type OperationsFailureCategory =
    | "schema_invalid"
    | "path_rejected"
    | "boundary_denied"
    | "target_missing"
    | "target_collision"
    | "parent_missing"
    | "stale_target"
    | "transform_failed"
    | "expired"
    | "cancelled"
    | "already_executed"
    | "fs_error"
    | "undo_unavailable"
    | "unknown";

export type OperationExecutionStatus = "succeeded" | "failed" | "stale" | "skipped" | "partial" | "unknown";

export interface OperationExecutionResult {
    operationId: string;
    toolCallId: string;
    name: CoreWriteToolName | typeof REMOVE_NOTE_IMAGE_TOOL_NAME;
    path: string;
    status: OperationExecutionStatus;
    failureCategory?: OperationsFailureCategory;
    message?: string;
    receiptId?: string;
    effects?: readonly NoteImageRemovalEffectResult[];
    undoAvailable?: boolean;
    checkpoint?: "attachment-restored";
}

export interface OperationsExecutionResult {
    intentId: string;
    state: Extract<OperationsIntentState, "executing" | "completed" | "partial" | "failed" | "unknown">;
    operations: readonly OperationExecutionResult[];
    /** Issued only after actual confirm execution, from operation receipts. */
    resultFact?: import("../pa-agent-result-facts").PaAgentResultFact;
}

export interface UndoReceipt {
    id: string;
    intentId: string;
    operationId: string;
    path: string;
    kind: CoreWriteToolName | typeof REMOVE_NOTE_IMAGE_TOOL_NAME;
    before: string | null;
    expectedAfter: string;
    createdAt: number;
    expiresAt: number;
}

export type UndoStatus = "undone" | "failed" | "stale" | "expired" | "unavailable" | "unknown";

export interface UndoResult {
    receiptId: string;
    operationId?: string;
    path?: string;
    status: UndoStatus;
    failureCategory?: OperationsFailureCategory;
    message?: string;
    effects?: readonly NoteImageRemovalEffectResult[];
    checkpoint?: "attachment-restored";
    undoAvailable?: boolean;
}

export interface OperationsVaultFile {
    path: string;
    extension?: string;
    children?: unknown;
}

export interface OperationsVault {
    getAbstractFileByPath(path: string): OperationsVaultFile | null;
    cachedRead?(file: OperationsVaultFile): Promise<string>;
    read?(file: OperationsVaultFile): Promise<string>;
    create(path: string, content: string): Promise<OperationsVaultFile>;
    process(file: OperationsVaultFile, fn: (current: string) => string): Promise<unknown>;
    adapter: {
        exists(path: string): Promise<boolean>;
        mkdir?(path: string): Promise<void>;
        write?(path: string, content: string): Promise<void>;
        read?(path: string): Promise<string>;
        list?(path: string): Promise<{ files: string[]; folders: string[] }>;
        remove?(path: string): Promise<void>;
    };
}

export interface StageOperationsIntentInput {
    runId: string;
    turnId: string;
    operations: readonly OperationsToolCall[];
    /** Host-owned staging read boundary; never copied into the retained intent. */
    taskSourceReadGuard?: TaskSourceReadGuard;
}

export interface ExecuteCurrentOperationsIntentInput {
    intentId: string;
    /** Runtime-captured user request identity; never accepted from model arguments. */
    runId: string;
    signal?: AbortSignal;
    /** Live boundary for the executing model turn; never copied into the intent. */
    taskSourceReadGuard: import("../task-source-read-guard").TaskSourceReadGuard;
}

export type OperationsControllerEvent =
    | { type: "intent-staged"; intent: OperationsIntent }
    | { type: "intent-state-changed"; intent: OperationsIntent }
    | { type: "operation-result"; intentId: string; result: OperationExecutionResult }
    | { type: "intent-result"; result: OperationsExecutionResult }
    | { type: "intent-cancelled"; intent: OperationsIntent }
    | { type: "intent-expired"; intentId: string }
    | { type: "undo-result"; result: UndoResult }
    | { type: "disposed" };

export type OperationsEventListener = (event: OperationsControllerEvent) => void;
