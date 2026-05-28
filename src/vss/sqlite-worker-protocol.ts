import type {
    EmbeddingProfile,
    VectorIndexStatus,
    VectorSearchResult,
    VSSChunk,
    VSSFileRecord,
    VSSFileState,
    VSSIndexStats,
} from "./types";

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
        };
    }
    | { id: number; type: "upsertFile"; payload: { fileState: VSSFileState; chunks: VSSChunk[]; embeddings: number[][] } }
    | { id: number; type: "updateFileMetadata"; payload: { fileState: VSSFileState } }
    | { id: number; type: "deleteFile"; payload: { path: string } }
    | { id: number; type: "listFilePaths"; payload: Record<string, never> }
    | { id: number; type: "listFileRecords"; payload: Record<string, never> }
    | { id: number; type: "search"; payload: { queryEmbedding: number[]; k: number } }
    | { id: number; type: "searchHybrid"; payload: { queryEmbedding: number[]; ftsQuery: string | null; k: number; fusionTopK: number } }
    | { id: number; type: "getFileRecord"; payload: { path: string } }
    | { id: number; type: "getStats"; payload: Record<string, never> }
    | { id: number; type: "verify"; payload: Record<string, never> }
    | { id: number; type: "reset"; payload: Record<string, never> }
    | { id: number; type: "dispose"; payload: Record<string, never> };

export type SqliteWorkerSuccess =
    | { id: number; ok: true; result: VectorIndexStatus }
    | { id: number; ok: true; result: string[] }
    | { id: number; ok: true; result: VSSFileRecord[] }
    | { id: number; ok: true; result: VectorSearchResult[] }
    | { id: number; ok: true; result: VSSFileRecord | null }
    | { id: number; ok: true; result: VSSIndexStats }
    | { id: number; ok: true; result: null };

export interface SqliteWorkerFailure {
    id: number;
    ok: false;
    error: {
        code: string;
        message: string;
    };
}

export type SqliteWorkerResponse = SqliteWorkerSuccess | SqliteWorkerFailure;
