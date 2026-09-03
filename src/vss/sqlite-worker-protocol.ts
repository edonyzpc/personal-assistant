import type {
    EmbeddingProfile,
    LexicalIncrementalMaintenanceReceipt,
    LexicalIndexStatus,
    LexicalRebuildFinalizeReceiptResult,
    LexicalSearchBudget,
    LexicalRebuildBatchResult,
    LexicalRebuildScopeBatchResult,
    LexicalRebuildStartResult,
    IndexedPathEvidenceGenerationResult,
    PathEvidenceGenerationRequestControl,
    PathEvidenceGenerationRef,
    RankedPathRequestControl,
    RankedPathRequestResult,
    VectorHybridSearchResult,
    VectorIndexStatus,
    VectorSearchResult,
    VSSChunk,
    VSSFileRecord,
    VSSFileState,
    VSSIndexStats,
    VectorIndexDeleteOptions,
} from "./types";
import type { RetrievalSearchRuntimeParameters } from "./retrieval-calibration";

export type SqliteWorkerRequest =
    | {
        id: number;
        type: "initialize";
        payload: {
            profile: EmbeddingProfile;
            databaseName: string;
            wasmUrl?: string;
            opfsDirectory?: string;
            legacyOpfsDirectory?: string;
            opfsVfsName?: string;
            lexicalProfileEnabled?: boolean;
            lexicalBoundaryFingerprint?: string;
        };
    }
    | { id: number; type: "upsertFile"; payload: { fileState: VSSFileState; chunks: VSSChunk[]; embeddings: number[][] } }
    | { id: number; type: "updateFileMetadata"; payload: { fileState: VSSFileState } }
    | { id: number; type: "deleteFile"; payload: { path: string; options?: VectorIndexDeleteOptions } }
    | { id: number; type: "listFilePaths"; payload: Record<string, never> }
    | { id: number; type: "listFileRecords"; payload: Record<string, never> }
    | { id: number; type: "search"; payload: { queryEmbedding: number[]; k: number } }
    | { id: number; type: "getChunksByPath"; payload: { paths: string[]; limitPerPath?: number } }
    | {
        id: number;
        type: "searchHybrid";
        payload: {
            queryEmbedding: number[];
            ftsQuery: string | null;
            /** Legacy aliases retained for old callers and fixture requests. */
            k: number;
            fusionTopK: number;
            /** Versioned EC-02 parameters. Production sends this when selected. */
            retrieval?: RetrievalSearchRuntimeParameters;
            temporalFilter?: { since?: number; until?: number };
            lexicalSkipReason?: string;
            lexicalBoundaryFingerprint?: string;
            lexicalBudget?: LexicalSearchBudget;
            excludedPathGenerations?: PathEvidenceGenerationRef[];
        };
    }
    | {
        id: number;
        type: "getPathEvidenceGenerations";
        payload: {
            paths: string[];
            maxPathsPerBatch: number;
            maxChunksScanned: number;
            control: PathEvidenceGenerationRequestControl;
        };
    }
    | {
        id: number;
        type: "rankGraphCandidates";
        payload: {
            queryEmbedding: number[];
            paths: string[];
            control: RankedPathRequestControl;
        };
    }
    | { id: number; type: "getFileRecord"; payload: { path: string } }
    | { id: number; type: "getLexicalStatus"; payload: Record<string, never> }
    | {
        id: number;
        type: "refreshLexicalPathFromIndexedChunks";
        payload: { path: string; lexicalBoundaryFingerprint: string };
    }
    | {
        id: number;
        type: "beginLexicalRebuild";
        payload: {
            profileId: "char-phrase-v1";
            runtimeCanaryFingerprint: string;
            scopeFingerprint: string;
            expectedPathCount: number;
        };
    }
    | {
        id: number;
        type: "beginLexicalRebuildWithReceipt";
        payload: {
            profileId: "char-phrase-v1";
            runtimeCanaryFingerprint: string;
            scopeFingerprint: string;
            expectedPathCount: number;
        };
    }
    | {
        id: number;
        type: "appendLexicalScopeBatch";
        payload: { rebuildId: string; paths: string[] };
    }
    | {
        id: number;
        type: "appendLexicalRebuildBatch";
        payload: { rebuildId: string; afterRowId: number; limit: number };
    }
    | { id: number; type: "finalizeLexicalRebuild"; payload: { rebuildId: string } }
    | { id: number; type: "finalizeLexicalRebuildWithReceipt"; payload: { rebuildId: string } }
    | {
        id: number;
        type: "abortLexicalRebuild";
        payload: { rebuildId: string; failureReason?: string };
    }
    | { id: number; type: "getStats"; payload: Record<string, never> }
    | { id: number; type: "verify"; payload: Record<string, never> }
    | { id: number; type: "reset"; payload: Record<string, never> }
    | { id: number; type: "dispose"; payload: Record<string, never> }
    | { id: number; type: "clusterVectors"; payload: { maxClusters: number } };

/** Immediate control messages bypass the Worker's serialized data queue. */
export type SqliteWorkerControlMessage =
    | {
        type: "cancelGraphRank";
        payload: Pick<RankedPathRequestControl, "requestId" | "runEpoch">;
    }
    | {
        type: "cancelPathEvidenceGeneration";
        payload: Pick<PathEvidenceGenerationRequestControl, "requestId" | "runEpoch">;
    };

export type SqliteWorkerMessage = SqliteWorkerRequest | SqliteWorkerControlMessage;

export type SqliteWorkerSuccess =
    | { id: number; ok: true; result: VectorIndexStatus }
    | { id: number; ok: true; result: string[] }
    | { id: number; ok: true; result: VSSFileRecord[] }
    | { id: number; ok: true; result: VectorSearchResult[] }
    | { id: number; ok: true; result: VSSFileRecord | null }
    | { id: number; ok: true; result: VSSIndexStats }
    | { id: number; ok: true; result: LexicalIndexStatus }
    | { id: number; ok: true; result: LexicalIncrementalMaintenanceReceipt }
    | { id: number; ok: true; result: LexicalRebuildStartResult }
    | { id: number; ok: true; result: LexicalRebuildScopeBatchResult }
    | { id: number; ok: true; result: LexicalRebuildBatchResult }
    | { id: number; ok: true; result: LexicalRebuildFinalizeReceiptResult }
    | { id: number; ok: true; result: VectorHybridSearchResult }
    | { id: number; ok: true; result: RankedPathRequestResult }
    | { id: number; ok: true; result: IndexedPathEvidenceGenerationResult }
    | { id: number; ok: true; result: null }
    | { id: number; ok: true; result: Array<{ clusterId: number; label: string; paths: string[] }> };

export interface SqliteWorkerFailure {
    id: number;
    ok: false;
    error: {
        code: string;
        message: string;
    };
}

export type SqliteWorkerResponse = SqliteWorkerSuccess | SqliteWorkerFailure;
