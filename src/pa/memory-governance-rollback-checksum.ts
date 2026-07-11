import { hashLegacyMemoryPayload } from "./memory-governance-migration";
import type { LegacyRollbackValue } from "./memory-governance-persistence";

/** Stable checksum shared by migration, compatibility journals, and rollback. */
export function checksumLegacyRollbackValue(value: LegacyRollbackValue): string {
    const canonical = cloneJson(value);
    return hashLegacyMemoryPayload({
        memoryGovernance: canonical.kind === "claim" ? { records: [canonical.record] } : undefined,
        reviewQueue: canonical.kind === "memory_queue" ? { items: [canonical.item] } : undefined,
        confirmedMemoryCount: canonical.kind === "policy" ? canonical.confirmedMemoryCount : undefined,
        memoryAutoAcceptPaused: canonical.kind === "policy" ? canonical.memoryAutoAcceptPaused : undefined,
    });
}

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}
