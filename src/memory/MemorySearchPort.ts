/* Copyright 2023 edonyzpc */

import type { MemoryDecisionResult } from "../memory-manager";
import type { VSS } from "../vss";

export type MemorySearchHybridOptions = Parameters<VSS["searchHybrid"]>[1];
export type MemorySearchHybridResult = Awaited<ReturnType<VSS["searchHybrid"]>>;
export type MemoryChunksByPathOptions = Parameters<VSS["getChunksByPath"]>[1];
export type MemoryChunksByPathResult = Awaited<ReturnType<VSS["getChunksByPath"]>>;

/**
 * Narrow Memory search port consumed by AI services.
 */
export interface MemorySearchPort {
    ensureReadyForChat(query?: string): Promise<MemoryDecisionResult>;
    searchHybrid(query: string, opts?: MemorySearchHybridOptions): Promise<MemorySearchHybridResult>;
    getChunksByPath(paths: string[], opts?: MemoryChunksByPathOptions): Promise<MemoryChunksByPathResult>;
}
