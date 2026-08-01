export const CORE_WRITE_TOOL_NAMES = [
    "vault_create",
    "vault_append",
    "vault_process",
    "frontmatter_update",
] as const;

export type CoreWriteToolName = typeof CORE_WRITE_TOOL_NAMES[number];

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
}

export type CoreWriteInput = CoreWriteInputMap[CoreWriteToolName];

export interface OperationsToolCall {
    toolCallId: string;
    name: CoreWriteToolName;
    input: unknown;
}

export interface PreparedOperation {
    id: string;
    toolCallId: string;
    name: CoreWriteToolName;
    input: CoreWriteInput;
    path: string;
    expectedBefore: string | null;
    expectedAfter: string;
}

export type OperationsIntentState =
    | "pending"
    | "cancelled"
    | "executing"
    | "completed"
    | "partial"
    | "failed";

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
    | "audit_error"
    | "undo_unavailable"
    | "unknown";

export type OperationExecutionStatus = "succeeded" | "failed" | "stale" | "skipped";

export interface OperationExecutionResult {
    operationId: string;
    toolCallId: string;
    name: CoreWriteToolName;
    path: string;
    status: OperationExecutionStatus;
    failureCategory?: OperationsFailureCategory;
    message?: string;
    receiptId?: string;
    auditStatus?: "written" | "failed";
    auditError?: string;
    /** Retention cleanup failed even though the current audit write may have succeeded. */
    auditRetentionWarning?: string;
}

export interface OperationsExecutionResult {
    intentId: string;
    state: Extract<OperationsIntentState, "completed" | "partial" | "failed">;
    operations: readonly OperationExecutionResult[];
}

export interface UndoReceipt {
    id: string;
    intentId: string;
    operationId: string;
    path: string;
    kind: CoreWriteToolName;
    before: string | null;
    expectedAfter: string;
    createdAt: number;
    expiresAt: number;
}

export type UndoStatus = "undone" | "failed" | "stale" | "expired" | "unavailable";

export interface UndoResult {
    receiptId: string;
    operationId?: string;
    path?: string;
    status: UndoStatus;
    failureCategory?: OperationsFailureCategory;
    message?: string;
    auditStatus?: "written" | "failed";
    auditError?: string;
    /** Retention cleanup failed even though the current audit write may have succeeded. */
    auditRetentionWarning?: string;
}

export type ContentFreeAuditStatus =
    | "succeeded"
    | "failed"
    | "stale"
    | "undone"
    | "undo_failed";

export interface ContentFreeAuditRecord {
    version: 1;
    operationId: string;
    intentId: string;
    tool: CoreWriteToolName | "undo";
    targetPath: string;
    status: ContentFreeAuditStatus;
    startedAt: string;
    completedAt: string;
    errorCategory?: string;
}

export interface ContentAuditRecord extends ContentFreeAuditRecord {
    before: string | null;
    after: string | null;
}

export type OperationsAuditRecord = ContentFreeAuditRecord | ContentAuditRecord;

export interface OperationsAuditWriteInput extends ContentFreeAuditRecord {
    before?: string | null;
    after?: string | null;
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
