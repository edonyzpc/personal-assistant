import type {
    PanelMemoryGovernanceRecord,
    PanelMemoryGovernanceState,
} from "./panel/types";

/**
 * Build the narrow Pagelet projection for claims proven to have participated
 * in the current result. The selection is deliberately all-or-nothing: stale,
 * duplicate, malformed, or unknown IDs expose no durable Memory details.
 */
export function buildContextualGovernedMemoryState(
    state: PanelMemoryGovernanceState,
    rawClaimIds: unknown,
): PanelMemoryGovernanceState {
    const empty: PanelMemoryGovernanceState = {
        governanceMode: "effect_based",
        contextual: true,
        records: [],
        totalCount: 0,
    };
    if (state.governanceMode !== "effect_based") return empty;
    const claimIds = readExactGovernedMemoryClaimIds(rawClaimIds);
    if (!claimIds || claimIds.length === 0) return empty;

    const recordsById = new Map<string, PanelMemoryGovernanceRecord | null>();
    for (const record of state.records) {
        const id = typeof record?.id === "string" ? record.id : "";
        if (!id || id !== id.trim()) continue;
        recordsById.set(id, recordsById.has(id) ? null : record);
    }

    const records: PanelMemoryGovernanceRecord[] = [];
    for (const claimId of claimIds) {
        const record = recordsById.get(claimId);
        if (!record
            || typeof record.summary !== "string"
            || !record.summary.trim()
            || record.lifecycle === "forgotten_tombstone"
            || !record.actionPolicy
            || record.effect === undefined
            || record.useStatus === undefined
            || record.durableUseStatus === undefined) return empty;
        records.push({
            ...record,
            scope: {
                ...record.scope,
                paths: record.scope.paths ? [...record.scope.paths] : undefined,
                tags: record.scope.tags ? [...record.scope.tags] : undefined,
            },
            sourceRefs: record.sourceRefs.map((sourceRef) => ({
                ...sourceRef,
                whyShown: sourceRef.whyShown ? [...sourceRef.whyShown] : undefined,
            })),
            actionPolicy: {
                correct: record.actionPolicy.correct === true,
                pause: false,
                resume: false,
                forget: false,
            },
        });
    }
    return {
        governanceMode: "effect_based",
        contextual: true,
        records,
        totalCount: records.length,
    };
}

export function readExactGovernedMemoryClaimIds(value: unknown): string[] | null {
    if (!Array.isArray(value)) return null;
    const seen = new Set<string>();
    const claimIds: string[] = [];
    for (const candidate of value) {
        if (typeof candidate !== "string") return null;
        if (!candidate || candidate !== candidate.trim() || seen.has(candidate)) return null;
        seen.add(candidate);
        claimIds.push(candidate);
    }
    return claimIds;
}
