import { Document } from "@langchain/core/documents";

export const VSS_SCHEMA_VERSION = 2;
export const VSS_DEFAULT_DIMENSIONS = 1024;
export const VSS_DEFAULT_DISTANCE_METRIC: VSSDistanceMetric = "COSINE";

export type VSSDistanceMetric = "COSINE" | "L2";

export type VectorIndexStatus =
    | "uninitialized"
    | "initializing"
    | "ready"
    | "stale"
    | "missing-local-index"
    | "disabled"
    | "error";

export type VSSMemoryStatus =
    | "unknown"
    | "unprepared"
    | "ready"
    | "stale"
    | "error";

export type LexicalProfileState =
    | "ready"
    | "stale"
    | "awaiting_confirmation"
    | "rebuilding"
    | "failed"
    | "unavailable";

export interface LexicalProfileMarker {
    profileId: "char-phrase-v1";
    generation: number;
    sourceChunkEpoch: string;
    runtimeCanaryFingerprint: string;
    /** Fingerprint of the shared Data Boundary policy used to build this generation. */
    scopeFingerprint?: string;
    /** Number of rows expected in this scoped lexical generation. */
    eligibleRowCount?: number;
}

export interface LexicalIndexStatus {
    state: LexicalProfileState;
    marker?: LexicalProfileMarker;
    reason?: string;
    chunkCount: number;
    lexicalRowCount: number;
}

export interface LexicalRebuildStartResult {
    rebuildId: string;
    generation: number;
    sourceChunkEpoch: string;
    totalRows: number;
}

export interface LexicalRebuildScopeBatchResult {
    rebuildId: string;
    acceptedPaths: number;
    expectedPaths: number;
    sealed: boolean;
    totalRows: number;
}

export interface LexicalRebuildBatchResult {
    rebuildId: string;
    processedRows: number;
    totalRows: number;
    nextRowId: number;
    done: boolean;
}

export interface LexicalMaintenanceReceiptSnapshot {
    databaseInstanceId: string;
    profileId: "char-phrase-v1";
    generation: number;
    sourceChunkEpoch: string;
    chunkMutationEpoch: number;
    indexMutationEpoch: number;
    rebuildEpoch: number;
    lexicalMaintenanceEpoch: number;
    incrementalMaintenanceEpoch: number;
    sourceChunkRows: number;
    lexicalRows: number;
    totalLexicalRows: number;
}

export interface LexicalMaintenanceReceiptEffects {
    source: "indexed-chunks";
    pathCount: number;
    sourceChunkReads: number;
    sourceChunkWrites: 0;
    lexicalRowsDeleted: number;
    lexicalRowsInserted: number;
    markdownReads: 0;
    markdownWrites: 0;
    providerCalls: 0;
    embeddingCalls: 0;
    embeddingWrites: 0;
}

/** Worker-sampled SQLite allocation envelope for one maintenance operation. */
export interface LexicalMaintenanceResourceEnvelope {
    estimatedDbBytesBefore: number;
    estimatedDbBytesPeak: number;
    estimatedDbBytesAfter: number;
}

/**
 * Content-free proof emitted only by the diagnostics-only indexed-chunk
 * lexical refresh seam. The Worker owns every counter in this result.
 */
export interface LexicalIncrementalMaintenanceReceipt {
    kind: "indexed-chunks-incremental";
    status: "completed";
    operationId: string;
    scopeBindingSha256: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    state: "ready";
    before: LexicalMaintenanceReceiptSnapshot;
    after: LexicalMaintenanceReceiptSnapshot;
    effects: LexicalMaintenanceReceiptEffects & { pathCount: 1 };
    resourceEnvelope: LexicalMaintenanceResourceEnvelope;
}

/** Content-free proof for one diagnostics-only execution of the real rebuild path. */
export interface LexicalRebuildMaintenanceReceipt {
    kind: "rebuild";
    status: "completed";
    operationId: string;
    scopeBindingSha256: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    state: "ready";
    before: LexicalMaintenanceReceiptSnapshot;
    after: LexicalMaintenanceReceiptSnapshot;
    effects: LexicalMaintenanceReceiptEffects;
    resourceEnvelope: LexicalMaintenanceResourceEnvelope;
}

/** Worker-only wrapper that preserves the ordinary status cache atomically with its receipt. */
export interface LexicalRebuildFinalizeReceiptResult {
    status: LexicalIndexStatus;
    receipt: LexicalRebuildMaintenanceReceipt;
}

export interface LexicalSearchStatus {
    attempted: boolean;
    state: LexicalProfileState;
    reason?: string;
    durationMs?: number;
    matchedRows?: number;
}

export interface LexicalSearchBudget {
    /** Absolute wall-clock time at which provider inputs settled and the bounded local phase began. */
    startedAtMs: number;
    /** Absolute wall-clock deadline, including local query construction and VSS/index queue wait. */
    deadlineAtMs: number;
}

export interface VectorHybridSearchResult {
    results: VectorSearchResult[];
    lexical: LexicalSearchStatus;
    /** Canonical SQLite chunk generation observed by this serialized search. */
    sourceEpoch?: string;
}

export interface VectorHybridSearchOptions {
    /** Caller cancellation is fail-closed; queued work must not reach the Worker. */
    signal?: AbortSignal;
}

/** Caller-owned holder populated by one hybrid-search invocation only. */
export interface QueryEmbeddingOutput {
    value?: number[];
    /** Prevents replaying a same-dimension vector after provider/model settings change. */
    profileSignature?: string;
    /** Filled only by a ready SQLite hybrid result; required for graph ranking. */
    sourceEpoch?: string;
}

export interface QueryEmbeddingInput {
    value: readonly number[];
    profileSignature: string;
}

export interface RankedPathChunk {
    chunkIndex: number;
    score: number;
    doc: Document;
}

export interface RankedPathChunks {
    path: string;
    pathEvidenceGeneration: string;
    maxScore: number;
    chunks: RankedPathChunk[];
}

export interface RankedPathRequestControl {
    requestId: string;
    runEpoch: string;
    sourceEpoch: string;
    absoluteDeadlineMs: number;
    maxPathsPerBatch: number;
    /** Whole-request preflight cap; overflow fails the request without a prefix. */
    maxCandidatePaths: number;
    /** Whole-request row/cosine cap; overflow fails the request without a prefix. */
    maxChunksScanned: number;
}

export interface RankedPathRequestResult {
    requestId: string;
    runEpoch: string;
    sourceEpoch: string;
    paths: RankedPathChunks[];
    diagnostics?: {
        batchCount: number;
        chunkCount: number;
        workerDurationMs: number;
        maxBatchDurationMs: number;
        queueWaitMs?: number;
    };
}

export interface RankedPathRequestDiagnostic {
    state: "queued" | "dispatched" | "cancel_requested" | "cancel_observed" | "settled" | "late_discarded";
    queueWaitMs?: number;
    accepted?: 0 | 1;
}

export interface RankGraphCandidatesOptions {
    signal?: AbortSignal;
    /** Content-free, invocation-local lifecycle observations. */
    onDiagnostic?: (event: RankedPathRequestDiagnostic) => void;
}

export interface PathEvidenceGenerationRef {
    path: string;
    generation: string;
}

export interface IndexedPathEvidenceGeneration extends PathEvidenceGenerationRef {
    contentHash: string;
    mtime: number;
    size: number;
}

export type PathEvidenceCurrentnessReason =
    | "current"
    | "missing"
    | "generation_unavailable"
    | "dirty"
    | "verification_pending"
    | "source_revision_mismatch"
    | "boundary_denied";

export interface PathEvidenceGenerationStatus extends Partial<IndexedPathEvidenceGeneration> {
    path: string;
    current: boolean;
    reason: PathEvidenceCurrentnessReason;
}

export interface IndexedPathEvidenceGenerationResult {
    sourceEpoch: string;
    paths: IndexedPathEvidenceGeneration[];
}

export interface PathEvidenceGenerationLookupOptions {
    signal?: AbortSignal;
    maxPathsPerBatch?: number;
    /** Complete-inventory repair cap for legacy rows without a generation. */
    maxChunksScanned?: number;
}

/** Host-current proof paired with the exact SQLite source generation read. */
export interface PathEvidenceGenerationStatusResult {
    sourceEpoch: string;
    paths: PathEvidenceGenerationStatus[];
}

export interface VSSMemoryStatusSnapshot {
    status: VSSMemoryStatus;
    indexedDocumentCount?: number;
    dirtyCount: number;
    verificationPending: number;
    lastErrorCode?: string;
    lexicalProfileState?: LexicalProfileState;
    lexicalFallbackReason?: string;
    lexicalSearchAttempted?: boolean;
    lexicalSearchState?: LexicalProfileState;
    lexicalSearchReason?: string;
    lexicalSearchDurationMs?: number;
    lexicalSearchMatchedRows?: number;
}

export interface EmbeddingProfile {
    provider: string;
    baseURL: string;
    model: string;
    dimensions: number;
    distanceMetric: VSSDistanceMetric;
}

export interface VSSFileState {
    path: string;
    contentHash: string;
    mtime: number;
    size: number;
    /** Host-current Data Boundary decision used by the Worker fail-closed lexical write. */
    lexicalEligible?: boolean;
    /** Whether the active lexical generation may be changed by this vector write. */
    lexicalMaintenanceEnabled?: boolean;
    /** Host-current shared Data Boundary policy fingerprint. */
    lexicalBoundaryFingerprint?: string;
}

export interface VectorIndexDeleteOptions {
    lexicalMaintenanceEnabled?: boolean;
    lexicalBoundaryFingerprint?: string;
}

export interface VSSChunk {
    path: string;
    chunkIndex: number;
    content: string;
    contentHash: string;
    created: number;
    lastModified: number;
    metadata: Record<string, unknown>;
}

export interface VectorSearchResult {
    score: number;
    distance?: number;
    doc: Document;
}

export interface VectorIndexPathLookupOptions {
    limitPerPath?: number;
    signal?: AbortSignal;
}

export interface VSSIndexStats {
    status: VectorIndexStatus;
    backend: string;
    initDurationMs?: number;
    lastRefreshDurationMs?: number;
    lastSearchDurationMs?: number;
    chunkCount: number;
    fileCount: number;
    estimatedDbBytes?: number;
    storageUsage?: number;
    storageQuota?: number;
    storagePersisted?: boolean;
    fallbackMode: boolean;
    lastErrorCode?: string;
    lastVerifiedAt?: string;
    databaseName?: string;
    opfsDirectory?: string;
    opfsVfsName?: string;
    /** Opaque random identity persisted inside the current SQLite database lifetime. */
    databaseInstanceId?: string;
    /** Device-local marker identity paired with the opened SQLite database. */
    indexId?: string;
    /** Stable marker creation time; changes when local marker continuity is lost. */
    indexBuiltAt?: string;
    /** Canonical persisted source/chunk mutation epoch. */
    chunkMutationEpoch?: number;
    /** Canonical persisted epoch for any indexed-data mutation, including metadata repair. */
    indexMutationEpoch?: number;
    /** Canonical persisted count of destructive database resets/rebuild starts. */
    rebuildEpoch?: number;
    /** Canonical persisted epoch for lexical shadow maintenance transactions. */
    lexicalMaintenanceEpoch?: number;
    /** Dedicated proof epoch advanced only by indexed-chunk incremental lexical refreshes. */
    lexicalIncrementalMaintenanceEpoch?: number;
    /** Last lexical maintenance transaction kind recorded by the Worker. */
    lastLexicalMaintenanceKind?: string;
    /** Present only when the last lexical maintenance transaction has a dedicated operation id. */
    lastLexicalMaintenanceOperationId?: string;
    lexicalProfileState?: LexicalProfileState;
    lexicalProfileId?: string;
    lexicalGeneration?: number;
    lexicalFallbackReason?: string;
    lexicalSearchAttempted?: boolean;
    lexicalSearchState?: LexicalProfileState;
    lexicalSearchReason?: string;
    lexicalSearchDurationMs?: number;
    lexicalSearchMatchedRows?: number;
}

export interface VSSFileRecord {
    path: string;
    contentHash: string;
    mtime: number;
    size: number;
    status: string;
    updatedAt: number;
}

export interface VectorIndex {
    initialize(profile: EmbeddingProfile): Promise<VectorIndexStatus>;
    upsertFile(fileState: VSSFileState, chunks: VSSChunk[], embeddings: number[][]): Promise<void>;
    updateFileMetadata(fileState: VSSFileState): Promise<void>;
    deleteFile(path: string, options?: VectorIndexDeleteOptions): Promise<void>;
    listFilePaths(): Promise<string[]>;
    listFileRecords(): Promise<VSSFileRecord[]>;
    search(queryEmbedding: number[], k: number): Promise<VectorSearchResult[]>;
    getChunksByPath(paths: string[], options?: VectorIndexPathLookupOptions): Promise<VectorSearchResult[]>;
    getFileRecord(path: string): Promise<VSSFileRecord | null>;
    getStats(): Promise<VSSIndexStats>;
    verify(): Promise<VectorIndexStatus>;
    reset(): Promise<void>;
    dispose(): Promise<void>;
}

export interface VSSIndexMarker {
    schemaVersion: number;
    deviceId: string;
    indexId: string;
    profileSignature: string;
    opfsScope?: string;
    backend: string;
    chunkCount: number;
    fileCount: number;
    builtAt: string;
    lastVerifiedAt: string;
    storagePersisted: boolean;
    estimatedDbBytes?: number;
    estimatedEmbeddingTokens?: number;
}

export function getEmbeddingProfileSignature(profile: EmbeddingProfile): string {
    return [
        profile.provider,
        profile.baseURL,
        profile.model,
        profile.dimensions,
        profile.distanceMetric,
    ].join("|");
}

export function scoreFromDistance(distance: number, metric: VSSDistanceMetric): number {
    if (!Number.isFinite(distance)) return 0;
    if (metric === "COSINE") {
        return Math.max(-1, Math.min(1, 1 - distance));
    }
    return 1 / (1 + Math.max(0, distance));
}
