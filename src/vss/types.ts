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

export interface VSSMemoryStatusSnapshot {
    status: VSSMemoryStatus;
    indexedDocumentCount?: number;
    dirtyCount: number;
    verificationPending: number;
    lastErrorCode?: string;
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
    deleteFile(path: string): Promise<void>;
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

export function estimateVectorMemoryBytes(chunkCount: number, dimensions: number): number {
    const vectorBytes = chunkCount * dimensions * Float32Array.BYTES_PER_ELEMENT;
    const metadataOverheadBytes = chunkCount * 512;
    return vectorBytes + metadataOverheadBytes;
}
