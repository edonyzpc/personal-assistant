/** Persisted historical Quiet Recall diagnostics types.
 *
 * The retired evaluator/coordinator is not a production path. These shapes
 * remain public so existing settings records can still be read safely.
 */

export type QuietRecallEvaluationRejectionReason =
    | "not_convincing"
    | "malformed"
    | "language_mismatch"
    | "provider_unavailable"
    | "provider_error"
    | "timeout"
    | "cancelled";

export interface QuietRecallEvaluationAttemptCost {
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
    currency: "USD";
    pricingKnown: boolean;
}

export interface QuietRecallEvaluationLimiterUsage {
    hourlyUsed: number;
    hourlyCap: number;
    hourlyRemaining: number;
    dailyUsed: number;
    dailyCap: number;
    dailyRemaining: number;
}

export interface QuietRecallEvaluationAttemptDiagnostic {
    candidateId: string;
    candidateIndex: number;
    fingerprint: string;
    kind: "initial" | "language_retry";
    reserved: boolean;
    outcome: "accepted" | "rejected" | "language_mismatch" | "blocked" | "failed";
    reason?:
        | "provider_unavailable"
        | "budget"
        | "cooldown"
        | "round_call_cap"
        | "reserve_error"
        | "invalid_context"
        | QuietRecallEvaluationRejectionReason;
    cost?: QuietRecallEvaluationAttemptCost;
    limiterUsage?: QuietRecallEvaluationLimiterUsage;
}

export interface QuietRecallEvaluationDiagnostics {
    roundId: string;
    startedAt: number;
    contextFingerprint: string;
    candidateCount: number;
    evaluatedCandidateCount: number;
    providerCalls: number;
    semanticRetrievalCalls?: number;
    totalProviderCalls?: number;
    initialCalls: number;
    languageRetryCalls: number;
    cacheHits: number;
    inFlightHits: number;
    estimatedCost: number;
    pricingKnown: boolean;
    limiterUsage?: QuietRecallEvaluationLimiterUsage;
    blockedReason?:
        | "provider_unavailable"
        | "budget"
        | "cooldown"
        | "round_call_cap"
        | "reserve_error"
        | "invalid_context";
    attempts: QuietRecallEvaluationAttemptDiagnostic[];
}
