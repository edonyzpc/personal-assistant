import type { VSSRebuildRecoveryReason } from "./local-state-store";

declare const preparedRebuildHandleBrand: unique symbol;

/**
 * Identifies one in-memory deferred rebuild admission. Consumers must treat
 * this value as opaque and return it unchanged to admit or roll back that run.
 */
export type VSSPreparedRebuildHandle = string & {
    readonly [preparedRebuildHandleBrand]: true;
};

export const VSS_PARAMS = {
    quietWindow: 30 * 1000,
    maxDelay: 10 * 60 * 1000,
    maxPerMinute: 5,
    largeFileThreshold: 1_000_000,
    dirtyJournal: "dirty.json",
};

export interface VSSOperationSummary {
    aborted: boolean;
    updated: number;
    unchanged: number;
    removed: number;
    skipped: number;
    failed: number;
    metadataSynced: number;
    verificationQueued: number;
    verificationChecked: number;
    dirtyConfirmed: number;
    storagePersisted?: boolean;
    preparedRebuildHandle?: VSSPreparedRebuildHandle;
}

export type VSSProgressPhase =
    | "scanning"
    | "embedding"
    | "writing"
    | "retrying"
    | "lexical-rebuilding"
    | "finalizing"
    | "cancelling"
    | "ready";

export interface VSSProgressEvent {
    phase: VSSProgressPhase;
    filesTotal?: number;
    filesDone?: number;
    filesUpdated?: number;
    chunksTotal?: number;
    chunksEmbedded?: number;
    failed?: number;
    currentFile?: string;
    retryDelayMs?: number;
    lexicalRowsDone?: number;
    lexicalRowsTotal?: number;
}

export interface VSSOperationOptions {
    silent?: boolean;
    onProgress?: (event: VSSProgressEvent) => void;
    abortSignal?: AbortSignal;
    rebuildReason?: VSSRebuildRecoveryReason;
    deferAdmission?: boolean;
}

export interface VSSLexicalRebuildOptions extends VSSOperationOptions {
    signal?: AbortSignal;
    batchSize?: number;
}

export interface VSSLexicalRebuildSummary {
    aborted: boolean;
    rowsProcessed: number;
    rowsTotal: number;
    generation?: number;
    reason?: string;
}

export interface VSSFlushOptions extends VSSOperationOptions {
    force?: boolean;
    reason?: string;
    limit?: number;
}

export function createEmptyOperationSummary(): VSSOperationSummary {
    return {
        aborted: false,
        updated: 0,
        unchanged: 0,
        removed: 0,
        skipped: 0,
        failed: 0,
        metadataSynced: 0,
        verificationQueued: 0,
        verificationChecked: 0,
        dirtyConfirmed: 0,
    };
}
