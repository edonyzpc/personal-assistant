import type { ReviewQueueScope } from "./contracts";

// Historical settings diagnostics; the Scope Recap generator has been retired.
export type ScopeRecapAttemptOutcome =
    | "success"
    | "insufficient_sources"
    | "provider_unavailable"
    | "provider_error"
    | "budget_blocked"
    | "timeout"
    | "empty"
    | "malformed"
    | "quality_rejected";

export interface ScopeRecapAttemptCost {
    inputTokens?: number;
    outputTokens?: number;
    estimatedCost?: number;
    currency?: "USD";
    pricingKnown?: boolean;
}

export interface ScopeRecapAttemptStatus {
    attemptedAt: string;
    outcome: ScopeRecapAttemptOutcome;
    scope: Pick<ReviewQueueScope, "kind">;
    sourceSnapshotId: string;
    dataBoundarySnapshotId: string;
    providerCallMade: boolean;
    includedSourceCount: number;
    cost?: ScopeRecapAttemptCost;
}
