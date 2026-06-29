import type { PersistedSourceRef } from "./source-ref";

export const RETRIEVAL_OUTCOME_STATUSES = [
    "evidence_found",
    "partial_evidence",
    "needs_scope",
    "conflict",
    "no_evidence",
    "blocked_by_privacy",
] as const;

export type RetrievalOutcomeStatus = typeof RETRIEVAL_OUTCOME_STATUSES[number];

export const RETRIEVAL_LANES = ["source", "semantic", "structure", "activity"] as const;
export type RetrievalLane = typeof RETRIEVAL_LANES[number];

export interface SkippedSourceRef extends PersistedSourceRef {
    skippedReason: string;
    boundaryReason?: string;
    privateTitle?: string;
}

export interface RetrievalOutcome {
    id: string;
    status: RetrievalOutcomeStatus;
    taskKind?: string;
    scope?: string;
    sources: PersistedSourceRef[];
    skippedSources: SkippedSourceRef[];
    missingScopeHints?: string[];
    conflictingSources?: PersistedSourceRef[];
    conflictSummary?: string;
    whyShown?: string[];
    confidence?: number;
    recommendedNextAction?: string;
    dataBoundarySnapshotId?: string;
    lanes?: RetrievalLane[];
}

export type RetrievalOutcomeValidationResult =
    | { ok: true }
    | { ok: false; reason: string };

export function isNoAnswerOutcome(outcome: Pick<RetrievalOutcome, "status">): boolean {
    return outcome.status === "no_evidence" || outcome.status === "blocked_by_privacy" || outcome.status === "needs_scope";
}

export function isConflictOutcome(outcome: Pick<RetrievalOutcome, "status">): boolean {
    return outcome.status === "conflict";
}

export function validateRetrievalOutcome(outcome: RetrievalOutcome): RetrievalOutcomeValidationResult {
    if (outcome.status === "no_evidence" && outcome.sources.length > 0) {
        return { ok: false, reason: "no_evidence_has_sources" };
    }
    if (outcome.status === "blocked_by_privacy" && !outcome.skippedSources.some((ref) => ref.boundaryReason)) {
        return { ok: false, reason: "privacy_block_without_boundary_reason" };
    }
    if (outcome.status === "conflict") {
        const hasConflictingRefs = (outcome.conflictingSources?.length ?? 0) >= 2;
        const hasSummary = typeof outcome.conflictSummary === "string" && outcome.conflictSummary.trim().length > 0;
        if (!hasConflictingRefs && !hasSummary) return { ok: false, reason: "conflict_without_evidence" };
    }
    return { ok: true };
}
