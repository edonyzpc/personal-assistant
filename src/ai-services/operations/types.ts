import type { TaskSourceReadGuard } from "../task-source-read-guard";
import type { ResourceTarget, WorkspaceSnapshotBinding, SdkResult, ResolvedObsidianResource, ReadSnapshotBinding } from "../independent-computation/obsidian-resource-sdk";
import type { PaAgentToolBatchPreparationInput } from "../pa-agent-types";
import type { InputLineage } from "../input-lineage";

export const RESOURCE_OPERATION_TOOL_NAMES = [
    "obsidian.vault.createText", "obsidian.vault.replaceText", "obsidian.vault.mkdir",
    "obsidian.vault.move", "obsidian.vault.trash", "obsidian.workspace.open",
    "obsidian.workspace.applyEdits", "obsidian.operations.undo", "vault_create_folder", "vault_trash",
] as const;
export type ResourceOperationToolName = typeof RESOURCE_OPERATION_TOOL_NAMES[number];
export interface SnapshotEdit { from: number; to: number; text: string }
export interface OperationsResourceContext {
    registerCreatedResource?(file: OperationsVaultFile, text?: string, receiptId?: string): void;
    resolveTarget(target: ResourceTarget, guard?: TaskSourceReadGuard, signal?: AbortSignal):
        ResolvedObsidianResource | undefined | Promise<ResolvedObsidianResource | undefined>;
    getReadSnapshot(version: string, target: ResourceTarget, guard?: TaskSourceReadGuard, signal?: AbortSignal):
        ReadSnapshotBinding | undefined | Promise<ReadSnapshotBinding | undefined>;
    resolveWorkspaceSnapshot(id: string, guard?: TaskSourceReadGuard, signal?: AbortSignal): WorkspaceSnapshotBinding | undefined;
    openResource(target: ResourceTarget, position?: { line: number; ch: number }, guard?: TaskSourceReadGuard,
        signal?: AbortSignal): Promise<SdkResult<unknown>>;
}
export type ResourceOperationInput = {
    mode: OperationsMode; path?: string; target?: ResourceTarget; source?: ResourceTarget; to?: string;
    text?: string; expectedVersion?: string; parents?: boolean; recursive?: boolean;
    snapshotId?: string; edits?: SnapshotEdit[]; receiptId?: string; position?: { line: number; ch: number };
};
export interface ResourceTreeEntry {
    path: string; file: OperationsVaultFile; kind: "file" | "folder";
    stat?: { ctime?: number; mtime: number; size: number }; bytes?: ArrayBuffer;
    contentHash?: string;
}
export type ResourcePreparedData =
    | { action: "create"; parent: OperationsVaultFile | null; text: string; context?: OperationsResourceContext }
    | { action: "replace"; file: OperationsVaultFile; before: string; text: string }
    | { action: "mkdir"; paths: string[]; parents: Array<{ path: string; file: OperationsVaultFile }>; context?: OperationsResourceContext }
    | { action: "move"; file: OperationsVaultFile; to: string; tree: ResourceTreeEntry[]; resourceRef?: string }
    | { action: "trash"; tree: ResourceTreeEntry[] }
    | { action: "editor"; binding: WorkspaceSnapshotBinding; before: string; after: string; edits: SnapshotEdit[] }
    | { action: "open"; context: OperationsResourceContext; target: ResourceTarget; position?: { line: number; ch: number } }
    | { action: "undo"; receiptId: string };
export interface PreparedResourceOperation {
    readonly kind: "resource"; readonly id: string; readonly toolCallId: string;
    readonly name: ResourceOperationToolName; readonly input: ResourceOperationInput; readonly path: string;
    readonly expectedBefore: string | null; readonly expectedAfter: string;
    /** Host-only native objects and bindings; never included in domain observations. */
    readonly resource: ResourcePreparedData;
}
export type ResourceUndoData =
    | { action: "create"; file: OperationsVaultFile }
    | { action: "replace"; file: OperationsVaultFile }
    | { action: "move"; file: OperationsVaultFile; originalPath: string; tree: ResourceTreeEntry[] }
    | { action: "mkdir"; folders: Array<{ path: string; file: OperationsVaultFile }>; removed: Set<string> }
    | { action: "trash"; tree: ResourceTreeEntry[]; restored: Map<string, OperationsVaultFile>; release(): void }
    | { action: "editor"; binding: WorkspaceSnapshotBinding };
export interface ResourceEffectFacts {
    kind: "create" | "replace" | "mkdir" | "move" | "trash" | "editor" | "open" | "undo";
    paths?: readonly string[]; scope?: "editor-buffer"; saved?: "unknown"; restoredAsNewObjects?: boolean;
    fromPath?: string; toPath?: string; resourceRef?: string;
    opened?: boolean; undoStatus?: UndoStatus; viewId?: string; viewType?: string;
    undoUnavailableReason?: "recovery_capacity";
    position?: { requested: { line: number; ch: number }; applied: boolean; actual?: { line: number; ch: number }; reason?: string };
}

export const REMOVE_NOTE_IMAGE_TOOL_NAME = "remove_note_image" as const;
export const VAULT_MOVE_TOOL_NAME = "vault_move" as const;
export type OperationsMode = "apply" | "preview";
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
    VAULT_MOVE_TOOL_NAME,
    ...RESOURCE_OPERATION_TOOL_NAMES,
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

export interface VaultMoveInput {
    sourcePath: string;
    targetPath: string;
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
    vault_move: VaultMoveInput;
    "obsidian.vault.createText": ResourceOperationInput;
    "obsidian.vault.replaceText": ResourceOperationInput;
    "obsidian.vault.mkdir": ResourceOperationInput;
    "obsidian.vault.move": ResourceOperationInput;
    "obsidian.vault.trash": ResourceOperationInput;
    "obsidian.workspace.open": ResourceOperationInput;
    "obsidian.workspace.applyEdits": ResourceOperationInput;
    "obsidian.operations.undo": ResourceOperationInput;
    vault_create_folder: ResourceOperationInput;
    vault_trash: ResourceOperationInput;
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

export interface PreparedMoveOperation {
    readonly kind: "move";
    readonly id: string;
    readonly toolCallId: string;
    readonly name: typeof VAULT_MOVE_TOOL_NAME;
    readonly input: VaultMoveInput;
    readonly path: string;
    readonly sourcePath: string;
    readonly targetPath: string;
    /** Host identity is private and never part of model-visible results. */
    readonly fileIdentity: OperationsVaultFile;
    readonly fileVersion?: { readonly mtime: number; readonly size: number };
    readonly expectedBefore: string;
    readonly expectedAfter: string;
}

export interface NoteImageRemovalEffectResult {
    readonly key: "note" | "attachment";
    readonly status: NoteImageRemovalEffectStatus;
    readonly failureCategory?: OperationsFailureCategory;
    readonly message?: string;
    readonly checkpoint?: "attachment-restored";
}

export type PreparedOperation = PreparedMarkdownOperation | PreparedNoteImageRemovalOperation | PreparedMoveOperation | PreparedResourceOperation;

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
    /** Missing only on legacy internal proposals; they cannot enter direct apply. */
    mode?: OperationsMode;
    /** Host-only original parent and admitted child ancestry for Chat persistence. */
    hostParentBinding?: PaAgentToolBatchPreparationInput["hostParentBinding"];
    inputLineage?: InputLineage;
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

export type OperationExecutionStatus = "succeeded" | "unchanged" | "failed" | "stale" | "skipped" | "partial" | "unknown";

export interface OperationExecutionResult {
    operationId: string;
    toolCallId: string;
    name: CoreWriteToolName | typeof REMOVE_NOTE_IMAGE_TOOL_NAME;
    path: string;
    targetPath?: string;
    status: OperationExecutionStatus;
    failureCategory?: OperationsFailureCategory;
    message?: string;
    receiptId?: string;
    effects?: readonly NoteImageRemovalEffectResult[];
    undoAvailable?: boolean;
    resourceEffect?: ResourceEffectFacts;
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
    /** Populated only for native move recovery; no reference snapshots. */
    move?: {
        originalPath: string;
        fileIdentity: OperationsVaultFile;
        fileVersion?: { readonly mtime: number; readonly size: number };
    };
    resource?: ResourceUndoData;
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
    stat?: { ctime?: number; mtime: number; size: number };
}

export interface OperationsVault {
    getAbstractFileByPath(path: string): OperationsVaultFile | null;
    cachedRead?(file: OperationsVaultFile): Promise<string>;
    read?(file: OperationsVaultFile): Promise<string>;
    create(path: string, content: string): Promise<OperationsVaultFile>;
    process(file: OperationsVaultFile, fn: (current: string) => string): Promise<unknown>;
    readBinary?(file: OperationsVaultFile): Promise<ArrayBuffer>;
    createBinary?(path: string, bytes: ArrayBuffer, options?: { ctime?: number; mtime?: number }): Promise<OperationsVaultFile>;
    createFolder?(path: string): Promise<OperationsVaultFile>;
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
    mode?: OperationsMode;
    /** Host-owned staging read boundary; never copied into the retained intent. */
    taskSourceReadGuard?: TaskSourceReadGuard;
    resourceContext?: OperationsResourceContext;
    /** These facts come from the executor context, never domain tool arguments. */
    hostParentBinding?: PaAgentToolBatchPreparationInput["hostParentBinding"];
    inputLineage?: InputLineage;
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
