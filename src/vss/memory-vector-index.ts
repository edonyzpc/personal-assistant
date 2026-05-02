import { Document } from "@langchain/core/documents";
import {
    scoreFromDistance,
    type EmbeddingProfile,
    type VectorIndex,
    type VectorIndexStatus,
    type VectorSearchResult,
    type VSSChunk,
    type VSSFileRecord,
    type VSSFileState,
    type VSSIndexStats,
} from "./types";

interface MemoryVectorRecord {
    fileState: VSSFileState;
    chunk: VSSChunk;
    embedding: number[];
}

export class MemoryVectorIndex implements VectorIndex {
    private profile: EmbeddingProfile | null = null;
    private readonly records = new Map<string, MemoryVectorRecord[]>();
    private status: VectorIndexStatus = "uninitialized";
    private lastSearchDurationMs: number | undefined;

    async initialize(profile: EmbeddingProfile): Promise<VectorIndexStatus> {
        this.profile = profile;
        this.status = "fallback";
        return this.status;
    }

    async upsertFile(fileState: VSSFileState, chunks: VSSChunk[], embeddings: number[][]): Promise<void> {
        if (chunks.length !== embeddings.length) {
            throw new Error(`Chunk count ${chunks.length} does not match embedding count ${embeddings.length}.`);
        }
        this.records.set(fileState.path, chunks.map((chunk, index) => ({
            fileState,
            chunk,
            embedding: embeddings[index],
        })));
    }

    async deleteFile(path: string): Promise<void> {
        this.records.delete(path);
    }

    async listFilePaths(): Promise<string[]> {
        return Array.from(this.records.keys());
    }

    async search(queryEmbedding: number[], k: number): Promise<VectorSearchResult[]> {
        const startedAt = performance.now();
        const metric = this.profile?.distanceMetric ?? "COSINE";
        const scored: VectorSearchResult[] = [];

        for (const fileRecords of this.records.values()) {
            for (const record of fileRecords) {
                const distance = metric === "COSINE"
                    ? cosineDistance(queryEmbedding, record.embedding)
                    : l2Distance(queryEmbedding, record.embedding);
                scored.push({
                    distance,
                    score: scoreFromDistance(distance, metric),
                    doc: new Document({
                        pageContent: record.chunk.content,
                        metadata: record.chunk.metadata,
                    }),
                });
            }
        }

        scored.sort((a, b) => a.distance - b.distance);
        this.lastSearchDurationMs = performance.now() - startedAt;
        return scored.slice(0, k);
    }

    async getFileRecord(path: string): Promise<VSSFileRecord | null> {
        const records = this.records.get(path);
        const first = records?.[0];
        if (!first) return null;
        return {
            path,
            contentHash: first.fileState.contentHash,
            mtime: first.fileState.mtime,
            size: first.fileState.size,
            status: "ready",
            updatedAt: Date.now(),
        };
    }

    async getStats(): Promise<VSSIndexStats> {
        let chunkCount = 0;
        for (const records of this.records.values()) {
            chunkCount += records.length;
        }
        return {
            status: this.status,
            backend: "memory",
            chunkCount,
            fileCount: this.records.size,
            fallbackMode: true,
            lastSearchDurationMs: this.lastSearchDurationMs,
        };
    }

    async verify(): Promise<VectorIndexStatus> {
        return this.status;
    }

    async reset(): Promise<void> {
        this.records.clear();
        this.status = this.profile ? "fallback" : "uninitialized";
    }

    async dispose(): Promise<void> {
        this.records.clear();
        this.status = "uninitialized";
    }
}

function cosineDistance(left: number[], right: number[]): number {
    const length = Math.min(left.length, right.length);
    if (length === 0) return 1;
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (let i = 0; i < length; i++) {
        dot += left[i] * right[i];
        leftNorm += left[i] * left[i];
        rightNorm += right[i] * right[i];
    }
    if (leftNorm === 0 || rightNorm === 0) return 1;
    return 1 - dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function l2Distance(left: number[], right: number[]): number {
    const length = Math.min(left.length, right.length);
    let sum = 0;
    for (let i = 0; i < length; i++) {
        const delta = left[i] - right[i];
        sum += delta * delta;
    }
    return Math.sqrt(sum);
}
