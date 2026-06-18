import type { VSSOperationSummary } from "./vss-maintenance";

export const VSS_RECONCILE_BATCH_SIZE = 250;
export const VSS_RECONCILE_MAX_METADATA_PER_RUN = 2_000;
export const VSS_ROLLING_HASH_VERIFY_LIMIT = 50;
export const VSS_DESKTOP_VERIFY_MAX_FILES = 20;
export const VSS_DESKTOP_VERIFY_MAX_BYTES = 5 * 1024 * 1024;
export const VSS_DESKTOP_VERIFY_MAX_WALL_CLOCK_MS = 500;
export const VSS_DESKTOP_CHAT_VERIFY_MAX_FILES = 5;
export const VSS_DESKTOP_CHAT_VERIFY_MAX_BYTES = 1 * 1024 * 1024;
export const VSS_DESKTOP_CHAT_VERIFY_MAX_WALL_CLOCK_MS = 100;
export const VSS_MOBILE_VERIFY_MAX_FILES = 3;
export const VSS_MOBILE_VERIFY_MAX_BYTES = 512 * 1024;
export const VSS_MOBILE_VERIFY_MAX_WALL_CLOCK_MS = 100;
export const VSS_MOBILE_CHAT_VERIFY_MAX_FILES = 1;
export const VSS_MOBILE_CHAT_VERIFY_MAX_BYTES = 512 * 1024;
export const VSS_MOBILE_CHAT_VERIFY_MAX_WALL_CLOCK_MS = 100;

export interface VSSReconcileOptions {
    reason?: string;
    batchSize?: number;
    maxMetadataItems?: number;
    verifyHashLimit?: number;
}

export interface VSSReconcileSummary extends VSSOperationSummary {
    scanned: number;
    markedDirty: number;
    verified: number;
    hasMore: boolean;
}

export interface VSSVerifyOptions {
    reason?: string;
    maxFiles?: number;
    maxBytes?: number;
    maxWallClockMs?: number;
    fastPath?: boolean;
}

export interface VSSVerifySummary extends VSSOperationSummary {
    markedDirty: number;
    hasMore: boolean;
    bytesReadEstimate: number;
}

export type VerifyReason = "metadata-drift" | "file-open" | "rolling-check";

export interface VerifyRecord {
    path: string;
    first: number;
    last: number;
    reason: VerifyReason;
    observedMtime: number;
    observedSize: number;
    contentHash: string;
}

export function rotateByCursor<T>(items: T[], cursor: number): T[] {
    if (items.length === 0) return [];
    const normalized = Math.max(0, Math.min(items.length - 1, cursor % items.length));
    return normalized === 0
        ? items
        : items.slice(normalized).concat(items.slice(0, normalized));
}
