/* Copyright 2023 edonyzpc */

import type { MemoryDecisionResult } from "../memory-manager";
import type { VSS } from "../vss";

export type MemorySearchHybridOptions = Parameters<VSS["searchHybrid"]>[1];
export type MemorySearchHybridResult = Awaited<ReturnType<VSS["searchHybrid"]>>;
export type MemoryChunksByPathOptions = Parameters<VSS["getChunksByPath"]>[1];
export type MemoryChunksByPathResult = Awaited<ReturnType<VSS["getChunksByPath"]>>;
export type MemoryRankGraphCandidatesArgs = Parameters<VSS["rankGraphCandidates"]>;
export type MemoryRankGraphCandidatesResult = Awaited<ReturnType<VSS["rankGraphCandidates"]>>;
export type MemoryPathEvidenceOptions = Parameters<VSS["getPathEvidenceGenerations"]>[1];
export type MemoryPathEvidenceResult = Awaited<ReturnType<VSS["getPathEvidenceGenerations"]>>;

/**
 * Narrow Memory search port consumed by AI services.
 */
export interface MemorySearchPort {
    ensureReadyForChat(
        query?: string,
        signal?: AbortSignal,
        preparationOwnerSignal?: AbortSignal,
    ): Promise<MemoryDecisionResult>;
    searchHybrid(query: string, opts?: MemorySearchHybridOptions): Promise<MemorySearchHybridResult>;
    getChunksByPath(paths: string[], opts?: MemoryChunksByPathOptions): Promise<MemoryChunksByPathResult>;
    rankGraphCandidates(...args: MemoryRankGraphCandidatesArgs): Promise<MemoryRankGraphCandidatesResult>;
    cancelGraphCandidateRank(requestId: string, runEpoch: string): void;
    getPathEvidenceGenerations(paths: string[], opts?: MemoryPathEvidenceOptions): Promise<MemoryPathEvidenceResult>;
}
