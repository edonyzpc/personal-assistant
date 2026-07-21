import { stableHash } from "./helpers";
import type {
    QuietRecallCandidate,
    QuietRecallRunResult,
} from "./quiet-recall";

export const QUIET_RECALL_MAX_EVALUATED_CANDIDATES = 5;
export const QUIET_RECALL_MAX_PROVIDER_CALLS_PER_ROUND = 10;
const DEFAULT_QUIET_RECALL_EVALUATION_CACHE_SIZE = 128;
const QUIET_RECALL_EVALUATION_FINGERPRINT_VERSION = "quiet-recall-evaluation-v1";

export type QuietRecallEvaluationAttemptKind = "initial" | "language_retry";

export type QuietRecallEvaluationBlockReason =
    | "provider_unavailable"
    | "budget"
    | "cooldown"
    | "round_call_cap"
    | "reserve_error"
    | "invalid_context";

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

export type QuietRecallEvaluationDecision =
    | { status: "accepted"; whyNow: string; cost?: QuietRecallEvaluationAttemptCost }
    | { status: "rejected"; reason?: QuietRecallEvaluationRejectionReason; cost?: QuietRecallEvaluationAttemptCost }
    | { status: "retry"; reason: "language_mismatch"; cost?: QuietRecallEvaluationAttemptCost };

export interface QuietRecallEvaluationAttempt {
    candidate: QuietRecallCandidate;
    candidateIndex: number;
    fingerprint: string;
    kind: QuietRecallEvaluationAttemptKind;
}

/** Provisional persisted slot committed only at the actual provider seam. */
export interface QuietRecallEvaluationProviderCallReservation {
    commit(): void;
    rollback(): void | PromiseLike<void>;
}

export type QuietRecallEvaluationReserveDecision =
    | {
        ok: true;
        limiterUsage?: QuietRecallEvaluationLimiterUsage;
        providerCallReservation?: QuietRecallEvaluationProviderCallReservation;
    }
    | { ok: false; reason: QuietRecallEvaluationBlockReason };

export type QuietRecallEvaluationReserve = (
    attempt: QuietRecallEvaluationAttempt,
) => QuietRecallEvaluationReserveDecision | Promise<QuietRecallEvaluationReserveDecision>;

export type QuietRecallEvaluator = (
    attempt: QuietRecallEvaluationAttempt,
    providerCallReservation?: QuietRecallEvaluationProviderCallReservation,
) => QuietRecallEvaluationDecision | Promise<QuietRecallEvaluationDecision>;

export interface QuietRecallEvaluationAttemptDiagnostic {
    candidateId: string;
    candidateIndex: number;
    fingerprint: string;
    kind: QuietRecallEvaluationAttemptKind;
    reserved: boolean;
    outcome: "accepted" | "rejected" | "language_mismatch" | "blocked" | "failed";
    reason?: QuietRecallEvaluationBlockReason | QuietRecallEvaluationRejectionReason;
    cost?: QuietRecallEvaluationAttemptCost;
    limiterUsage?: QuietRecallEvaluationLimiterUsage;
}

export interface QuietRecallEvaluationDiagnostics {
    roundId: string;
    startedAt: number;
    contextFingerprint: string;
    candidateCount: number;
    evaluatedCandidateCount: number;
    /** Evaluator-stage calls only (initial + language retry). */
    providerCalls: number;
    /** Cold semantic query-embedding calls made before evaluation. */
    semanticRetrievalCalls?: number;
    /** All actual Quiet Recall provider calls charged to the shared 10/50 bucket. */
    totalProviderCalls?: number;
    initialCalls: number;
    languageRetryCalls: number;
    cacheHits: number;
    inFlightHits: number;
    estimatedCost: number;
    pricingKnown: boolean;
    limiterUsage?: QuietRecallEvaluationLimiterUsage;
    blockedReason?: QuietRecallEvaluationBlockReason;
    attempts: QuietRecallEvaluationAttemptDiagnostic[];
}

export interface QuietRecallEvaluationInput {
    localResult: QuietRecallRunResult;
    contextFingerprint: string;
    startedAt?: number;
    evaluator: QuietRecallEvaluator;
    reserve?: QuietRecallEvaluationReserve;
    blockedReason?: QuietRecallEvaluationBlockReason;
    fingerprintCandidate?: (
        contextFingerprint: string,
        candidate: QuietRecallCandidate,
    ) => string;
}

export interface QuietRecallEvaluationCoordinatorOptions {
    maxCacheEntries?: number;
}

type CachedCandidateDecision =
    | { status: "accepted"; whyNow: string }
    | { status: "rejected"; reason: QuietRecallEvaluationRejectionReason };

interface CandidateEvaluationResult {
    decision: CachedCandidateDecision | null;
    stopRound: boolean;
    cacheable: boolean;
}

type CandidateDecisionSource = "evaluated" | "cache" | "in_flight";

interface CandidateDecisionResolution {
    result: CandidateEvaluationResult;
    source: CandidateDecisionSource;
}

interface MutableRoundState {
    diagnostics: QuietRecallEvaluationDiagnostics;
}

/**
 * Session-owned coordinator for independent Quiet Recall candidate evaluation.
 *
 * The coordinator caches only accepted or deterministic quality-rejected
 * decisions. Provider failures, timeouts, cooldowns, and budget blocks are
 * never cached. Callers should own one instance per plugin/vault session and
 * clear it during teardown or a relevant policy/provider reset.
 */
export class QuietRecallEvaluationCoordinator {
    private readonly maxCacheEntries: number;
    private readonly completed = new Map<string, CachedCandidateDecision>();
    private readonly inFlight = new Map<string, Promise<CandidateEvaluationResult>>();

    constructor(options: QuietRecallEvaluationCoordinatorOptions = {}) {
        const requestedMaxCacheEntries = options.maxCacheEntries
            ?? DEFAULT_QUIET_RECALL_EVALUATION_CACHE_SIZE;
        this.maxCacheEntries = Math.max(
            1,
            Number.isFinite(requestedMaxCacheEntries)
                ? Math.floor(requestedMaxCacheEntries)
                : DEFAULT_QUIET_RECALL_EVALUATION_CACHE_SIZE,
        );
    }

    async evaluate(input: QuietRecallEvaluationInput): Promise<QuietRecallRunResult> {
        const contextFingerprint = input.contextFingerprint.trim();
        const startedAt = Number.isFinite(input.startedAt) && (input.startedAt ?? 0) >= 0
            ? Math.floor(input.startedAt ?? 0)
            : Date.now();
        const localCandidates = input.localResult.candidates
            .slice(0, QUIET_RECALL_MAX_EVALUATED_CANDIDATES)
            .map(asLocalCandidate);
        const diagnostics: QuietRecallEvaluationDiagnostics = {
            roundId: stableHash(`${contextFingerprint}:${startedAt}`),
            startedAt,
            contextFingerprint,
            candidateCount: localCandidates.length,
            evaluatedCandidateCount: 0,
            providerCalls: 0,
            initialCalls: 0,
            languageRetryCalls: 0,
            cacheHits: 0,
            inFlightHits: 0,
            estimatedCost: 0,
            pricingKnown: true,
            attempts: [],
        };

        if (!contextFingerprint) {
            diagnostics.blockedReason = "invalid_context";
            return evaluationRunResult(input.localResult, [], localCandidates, diagnostics);
        }

        const accepted: QuietRecallCandidate[] = [];
        const round: MutableRoundState = { diagnostics };
        for (let candidateIndex = 0; candidateIndex < localCandidates.length; candidateIndex += 1) {
            const candidate = localCandidates[candidateIndex];
            const fingerprint = input.fingerprintCandidate?.(contextFingerprint, candidate)
                ?? buildQuietRecallEvaluationFingerprint(contextFingerprint, candidate);
            const resolution = await this.resolveCandidate(
                fingerprint,
                () => this.evaluateCandidate(input, candidate, candidateIndex, fingerprint, round),
            );
            if (resolution.source === "cache") diagnostics.cacheHits += 1;
            if (resolution.source === "in_flight") diagnostics.inFlightHits += 1;
            if (resolution.source !== "evaluated" && resolution.result.decision) {
                diagnostics.evaluatedCandidateCount += 1;
            }

            const decision = resolution.result.decision;
            if (decision?.status === "accepted") {
                accepted.push({
                    ...candidate,
                    whyNow: [decision.whyNow],
                    evaluationProvenance: "ai",
                    evaluationFingerprint: fingerprint,
                });
            }
            if (resolution.result.stopRound) break;
        }

        return evaluationRunResult(input.localResult, accepted, localCandidates, diagnostics);
    }

    clear(): void {
        this.completed.clear();
        this.inFlight.clear();
    }

    get cacheSize(): number {
        return this.completed.size;
    }

    get inFlightSize(): number {
        return this.inFlight.size;
    }

    private async resolveCandidate(
        fingerprint: string,
        runner: () => Promise<CandidateEvaluationResult>,
    ): Promise<CandidateDecisionResolution> {
        const cached = this.completed.get(fingerprint);
        if (cached) {
            // Refresh insertion order so the bounded map behaves as an LRU.
            this.completed.delete(fingerprint);
            this.completed.set(fingerprint, cached);
            return {
                result: { decision: cached, stopRound: false, cacheable: true },
                source: "cache",
            };
        }

        const existing = this.inFlight.get(fingerprint);
        if (existing) {
            return { result: await existing, source: "in_flight" };
        }

        const promise = runner();
        this.inFlight.set(fingerprint, promise);
        try {
            const result = await promise;
            if (result.cacheable && result.decision) {
                this.remember(fingerprint, result.decision);
            }
            return { result, source: "evaluated" };
        } finally {
            if (this.inFlight.get(fingerprint) === promise) {
                this.inFlight.delete(fingerprint);
            }
        }
    }

    private async evaluateCandidate(
        input: QuietRecallEvaluationInput,
        candidate: QuietRecallCandidate,
        candidateIndex: number,
        fingerprint: string,
        round: MutableRoundState,
    ): Promise<CandidateEvaluationResult> {
        if (input.blockedReason) {
            round.diagnostics.blockedReason = input.blockedReason;
            round.diagnostics.attempts.push({
                ...attemptDiagnosticBase({
                    candidate,
                    candidateIndex,
                    fingerprint,
                    kind: "initial",
                }),
                reserved: false,
                outcome: "blocked",
                reason: input.blockedReason,
            });
            return {
                decision: null,
                stopRound: false,
                cacheable: false,
            };
        }
        round.diagnostics.evaluatedCandidateCount += 1;
        const initial = await this.invokeAttempt(
            input,
            { candidate, candidateIndex, fingerprint, kind: "initial" },
            round,
        );
        if (initial.stopRound || initial.decision.status !== "retry") {
            return finalizeAttemptDecision(initial);
        }

        const retry = await this.invokeAttempt(
            input,
            { candidate, candidateIndex, fingerprint, kind: "language_retry" },
            round,
        );
        if (retry.decision.status === "retry") {
            return {
                decision: { status: "rejected", reason: "language_mismatch" },
                stopRound: retry.stopRound,
                cacheable: !retry.stopRound,
            };
        }
        return finalizeAttemptDecision(retry);
    }

    private async invokeAttempt(
        input: QuietRecallEvaluationInput,
        attempt: QuietRecallEvaluationAttempt,
        round: MutableRoundState,
    ): Promise<{
        decision: QuietRecallEvaluationDecision;
        stopRound: boolean;
        infrastructureFailure: boolean;
    }> {
        const diagnostics = round.diagnostics;
        if (diagnostics.providerCalls >= QUIET_RECALL_MAX_PROVIDER_CALLS_PER_ROUND) {
            diagnostics.blockedReason = "round_call_cap";
            diagnostics.attempts.push({
                ...attemptDiagnosticBase(attempt),
                reserved: false,
                outcome: "blocked",
                reason: "round_call_cap",
            });
            return {
                decision: { status: "rejected", reason: "cancelled" },
                stopRound: true,
                infrastructureFailure: true,
            };
        }

        let reservation: QuietRecallEvaluationReserveDecision;
        try {
            reservation = input.reserve
                ? await input.reserve(attempt)
                : { ok: true };
        } catch {
            reservation = { ok: false, reason: "reserve_error" };
        }
        if (!reservation.ok) {
            diagnostics.blockedReason = reservation.reason;
            diagnostics.attempts.push({
                ...attemptDiagnosticBase(attempt),
                reserved: false,
                outcome: "blocked",
                reason: reservation.reason,
            });
            return {
                decision: { status: "rejected", reason: "cancelled" },
                stopRound: true,
                infrastructureFailure: true,
            };
        }
        if (reservation.limiterUsage) {
            diagnostics.limiterUsage = { ...reservation.limiterUsage };
        }

        const provisional = reservation.providerCallReservation;
        let providerInvoked = provisional === undefined;
        let reservationSettled = provisional === undefined;
        const trackedReservation = provisional
            ? {
                commit: () => {
                    provisional.commit();
                    providerInvoked = true;
                    reservationSettled = true;
                },
                rollback: async () => {
                    if (reservationSettled) return;
                    await provisional.rollback();
                    reservationSettled = true;
                },
            }
            : undefined;
        const recordActualProviderCall = (): void => {
            diagnostics.providerCalls += 1;
            if (attempt.kind === "initial") diagnostics.initialCalls += 1;
            else diagnostics.languageRetryCalls += 1;
        };
        const recordNoCallBlock = async (): Promise<{
            decision: QuietRecallEvaluationDecision;
            stopRound: boolean;
            infrastructureFailure: boolean;
        }> => {
            await trackedReservation?.rollback();
            diagnostics.blockedReason = "invalid_context";
            diagnostics.attempts.push({
                ...attemptDiagnosticBase(attempt),
                reserved: false,
                outcome: "blocked",
                reason: "invalid_context",
            });
            return {
                decision: { status: "rejected", reason: "cancelled" },
                stopRound: true,
                infrastructureFailure: true,
            };
        };

        try {
            const decision = normalizeDecision(await input.evaluator(attempt, trackedReservation));
            if (!providerInvoked) return await recordNoCallBlock();
            recordActualProviderCall();
            if (decision.cost) {
                diagnostics.estimatedCost += decision.cost.estimatedCost;
                diagnostics.pricingKnown = diagnostics.pricingKnown && decision.cost.pricingKnown;
            }
            diagnostics.attempts.push(diagnosticForDecision(
                attempt,
                decision,
                reservation.limiterUsage,
            ));
            return { decision, stopRound: false, infrastructureFailure: false };
        } catch {
            if (!providerInvoked) {
                try {
                    return await recordNoCallBlock();
                } catch {
                    diagnostics.blockedReason = "reserve_error";
                    diagnostics.attempts.push({
                        ...attemptDiagnosticBase(attempt),
                        reserved: false,
                        outcome: "blocked",
                        reason: "reserve_error",
                    });
                    return {
                        decision: { status: "rejected", reason: "cancelled" },
                        stopRound: true,
                        infrastructureFailure: true,
                    };
                }
            }
            recordActualProviderCall();
            diagnostics.attempts.push({
                ...attemptDiagnosticBase(attempt),
                reserved: true,
                outcome: "failed",
                reason: "provider_error",
                ...(reservation.limiterUsage ? {
                    limiterUsage: { ...reservation.limiterUsage },
                } : {}),
            });
            return {
                decision: { status: "rejected", reason: "provider_error" },
                stopRound: false,
                infrastructureFailure: true,
            };
        }
    }

    private remember(fingerprint: string, decision: CachedCandidateDecision): void {
        this.completed.delete(fingerprint);
        this.completed.set(fingerprint, decision);
        while (this.completed.size > this.maxCacheEntries) {
            const oldest = this.completed.keys().next().value as string | undefined;
            if (!oldest) break;
            this.completed.delete(oldest);
        }
    }
}

export function buildQuietRecallEvaluationFingerprint(
    contextFingerprint: string,
    candidate: QuietRecallCandidate,
): string {
    return stableHash(JSON.stringify({
        version: QUIET_RECALL_EVALUATION_FINGERPRINT_VERSION,
        contextFingerprint,
        candidate: {
            id: candidate.id,
            title: candidate.title,
            summary: candidate.summary,
            relation: candidate.relation,
            sourceInsightId: candidate.sourceInsightId ?? null,
            sourceRefs: candidate.sourceRefs.map((ref) => ({
                path: ref.path,
                sourceId: ref.sourceId ?? null,
                evidenceStrength: ref.evidenceStrength ?? null,
                whyShown: ref.whyShown ?? [],
            })),
        },
    }));
}

function asLocalCandidate(candidate: QuietRecallCandidate): QuietRecallCandidate {
    const local: QuietRecallCandidate = {
        ...candidate,
        sourceRefs: candidate.sourceRefs.map((ref) => ({
            ...ref,
            whyShown: ref.whyShown ? [...ref.whyShown] : undefined,
        })),
        whyNow: [...candidate.whyNow],
        evaluationProvenance: "local",
    };
    delete local.evaluationFingerprint;
    return local;
}

function evaluationRunResult(
    localResult: QuietRecallRunResult,
    accepted: QuietRecallCandidate[],
    localCandidates: QuietRecallCandidate[],
    diagnostics: QuietRecallEvaluationDiagnostics,
): QuietRecallRunResult {
    return {
        ...localResult,
        totalCount: accepted.length,
        candidates: accepted,
        discoverCandidates: localCandidates,
        evaluationDiagnostics: diagnostics,
    };
}

function normalizeDecision(decision: QuietRecallEvaluationDecision): QuietRecallEvaluationDecision {
    if (decision.status !== "accepted") return decision;
    const whyNow = decision.whyNow.trim();
    return whyNow
        ? { ...decision, whyNow }
        : { status: "rejected", reason: "malformed", ...(decision.cost ? { cost: decision.cost } : {}) };
}

function finalizeAttemptDecision(input: {
    decision: QuietRecallEvaluationDecision;
    stopRound: boolean;
    infrastructureFailure: boolean;
}): CandidateEvaluationResult {
    if (input.decision.status === "accepted") {
        return {
            decision: { status: "accepted", whyNow: input.decision.whyNow },
            stopRound: input.stopRound,
            cacheable: !input.infrastructureFailure,
        };
    }
    if (input.decision.status === "retry") {
        return {
            decision: { status: "rejected", reason: "language_mismatch" },
            stopRound: input.stopRound,
            cacheable: !input.infrastructureFailure,
        };
    }
    const reason = input.decision.reason ?? "not_convincing";
    return {
        decision: { status: "rejected", reason },
        stopRound: input.stopRound,
        cacheable: !input.infrastructureFailure && isDeterministicRejection(reason),
    };
}

function isDeterministicRejection(reason: QuietRecallEvaluationRejectionReason): boolean {
    return reason === "not_convincing"
        || reason === "malformed"
        || reason === "language_mismatch";
}

function attemptDiagnosticBase(attempt: QuietRecallEvaluationAttempt): Pick<
    QuietRecallEvaluationAttemptDiagnostic,
    "candidateId" | "candidateIndex" | "fingerprint" | "kind"
> {
    return {
        candidateId: attempt.candidate.id,
        candidateIndex: attempt.candidateIndex,
        fingerprint: attempt.fingerprint,
        kind: attempt.kind,
    };
}

function diagnosticForDecision(
    attempt: QuietRecallEvaluationAttempt,
    decision: QuietRecallEvaluationDecision,
    limiterUsage?: QuietRecallEvaluationLimiterUsage,
): QuietRecallEvaluationAttemptDiagnostic {
    const diagnostics = {
        ...(decision.cost ? { cost: { ...decision.cost } } : {}),
        ...(limiterUsage ? { limiterUsage: { ...limiterUsage } } : {}),
    };
    if (decision.status === "accepted") {
        return {
            ...attemptDiagnosticBase(attempt),
            reserved: true,
            outcome: "accepted",
            ...diagnostics,
        };
    }
    if (decision.status === "retry") {
        return {
            ...attemptDiagnosticBase(attempt),
            reserved: true,
            outcome: "language_mismatch",
            reason: decision.reason,
            ...diagnostics,
        };
    }
    return {
        ...attemptDiagnosticBase(attempt),
        reserved: true,
        outcome: "rejected",
        reason: decision.reason ?? "not_convincing",
        ...diagnostics,
    };
}
