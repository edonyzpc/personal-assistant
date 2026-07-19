import { describe, expect, it, jest } from "@jest/globals";

import {
    QUIET_RECALL_MAX_EVALUATED_CANDIDATES,
    QUIET_RECALL_MAX_PROVIDER_CALLS_PER_ROUND,
    QuietRecallEvaluationCoordinator,
    type QuietRecallCandidate,
    type QuietRecallEvaluationDecision,
    type QuietRecallEvaluationReserve,
    type QuietRecallEvaluator,
    type QuietRecallRunResult,
} from "../src/pa";

function makeCandidate(index: number): QuietRecallCandidate {
    return {
        id: `candidate-${index}`,
        title: `Recall ${index}`,
        summary: `Local summary ${index}`,
        sourceRefs: [{ path: `Archive/Source-${index}.md` }],
        whyNow: [`Local reason ${index}`],
        nextAction: "Open the source note.",
        relation: "related",
        score: 0.9 - index * 0.01,
        generatedAt: "2026-07-18T00:00:00.000Z",
        context: { kind: "note_retrieval" },
        evaluationProvenance: "local",
    };
}

function makeLocalResult(candidateCount: number): QuietRecallRunResult {
    const candidates = Array.from({ length: candidateCount }, (_, index) => makeCandidate(index));
    return {
        generatedAt: "2026-07-18T00:00:00.000Z",
        currentPath: "Projects/Current.md",
        totalCount: candidates.length,
        candidates,
    };
}

describe("QuietRecallEvaluationCoordinator", () => {
    it("evaluates at most five candidates serially and reserves before every provider call", async () => {
        const coordinator = new QuietRecallEvaluationCoordinator();
        const events: string[] = [];
        let activeEvaluations = 0;
        let maxActiveEvaluations = 0;
        const reserve: QuietRecallEvaluationReserve = async (attempt) => {
            events.push(`reserve:${attempt.candidateIndex}:${attempt.kind}`);
            return { ok: true };
        };
        const evaluator: QuietRecallEvaluator = async (attempt) => {
            events.push(`evaluate:${attempt.candidateIndex}:${attempt.kind}`);
            activeEvaluations += 1;
            maxActiveEvaluations = Math.max(maxActiveEvaluations, activeEvaluations);
            await Promise.resolve();
            activeEvaluations -= 1;
            return { status: "accepted", whyNow: `AI reason ${attempt.candidateIndex}` };
        };

        const result = await coordinator.evaluate({
            localResult: makeLocalResult(7),
            contextFingerprint: "context-a",
            reserve,
            evaluator,
        });

        expect(result.candidates).toHaveLength(QUIET_RECALL_MAX_EVALUATED_CANDIDATES);
        expect(result.discoverCandidates).toHaveLength(QUIET_RECALL_MAX_EVALUATED_CANDIDATES);
        expect(result.candidates.every(
            (candidate) => candidate.evaluationProvenance === "ai",
        )).toBe(true);
        expect(result.discoverCandidates?.every(
            (candidate) => candidate.evaluationProvenance === "local",
        )).toBe(true);
        expect(maxActiveEvaluations).toBe(1);
        expect(events).toEqual(Array.from({ length: 5 }, (_, index) => [
            `reserve:${index}:initial`,
            `evaluate:${index}:initial`,
        ]).flat());
        expect(result.evaluationDiagnostics).toEqual(expect.objectContaining({
            candidateCount: 5,
            evaluatedCandidateCount: 5,
            providerCalls: 5,
            initialCalls: 5,
            languageRetryCalls: 0,
        }));
    });

    it("associates content-free cost and limiter usage with the exact evaluation round and attempt", async () => {
        const startedAt = Date.parse("2026-07-18T08:30:00.000Z");
        const result = await new QuietRecallEvaluationCoordinator().evaluate({
            localResult: makeLocalResult(1),
            contextFingerprint: "context-diagnostics",
            startedAt,
            reserve: async () => ({
                ok: true,
                limiterUsage: {
                    hourlyUsed: 3,
                    hourlyCap: 10,
                    hourlyRemaining: 7,
                    dailyUsed: 8,
                    dailyCap: 50,
                    dailyRemaining: 42,
                },
            }),
            evaluator: async () => ({
                status: "accepted",
                whyNow: "This is useful now.",
                cost: {
                    inputTokens: 120,
                    outputTokens: 18,
                    estimatedCost: 0.00012,
                    currency: "USD",
                    pricingKnown: true,
                },
            }),
        });

        expect(result.evaluationDiagnostics).toEqual(expect.objectContaining({
            roundId: expect.any(String),
            startedAt,
            providerCalls: 1,
            estimatedCost: 0.00012,
            pricingKnown: true,
            limiterUsage: expect.objectContaining({
                hourlyRemaining: 7,
                dailyRemaining: 42,
            }),
        }));
        expect(result.evaluationDiagnostics?.attempts[0]).toEqual(expect.objectContaining({
            candidateId: "candidate-0",
            kind: "initial",
            reserved: true,
            outcome: "accepted",
            cost: expect.objectContaining({ estimatedCost: 0.00012 }),
            limiterUsage: expect.objectContaining({ hourlyUsed: 3, dailyUsed: 8 }),
        }));
    });

    it("isolates individual provider failures and continues with later candidates", async () => {
        const evaluator: QuietRecallEvaluator = async ({ candidateIndex }) => {
            if (candidateIndex === 0) throw new Error("provider failed");
            if (candidateIndex === 1) return { status: "rejected", reason: "not_convincing" };
            return { status: "accepted", whyNow: "The third candidate is useful now." };
        };

        const result = await new QuietRecallEvaluationCoordinator().evaluate({
            localResult: makeLocalResult(3),
            contextFingerprint: "context-failure-isolation",
            evaluator,
        });

        expect(result.candidates.map((candidate) => candidate.id)).toEqual(["candidate-2"]);
        expect(result.evaluationDiagnostics?.providerCalls).toBe(3);
        expect(result.evaluationDiagnostics?.attempts.map((attempt) => attempt.outcome)).toEqual([
            "failed",
            "rejected",
            "accepted",
        ]);
    });

    it("retries only language mismatch and never more than once per candidate", async () => {
        const attempts: string[] = [];
        const evaluator: QuietRecallEvaluator = async ({ candidateIndex, kind }) => {
            attempts.push(`${candidateIndex}:${kind}`);
            if (candidateIndex === 0 && kind === "initial") {
                return { status: "retry", reason: "language_mismatch" };
            }
            if (candidateIndex === 0) {
                return { status: "accepted", whyNow: "The retry matches the requested language." };
            }
            return { status: "rejected", reason: "not_convincing" };
        };

        const result = await new QuietRecallEvaluationCoordinator().evaluate({
            localResult: makeLocalResult(2),
            contextFingerprint: "context-language-retry",
            evaluator,
        });

        expect(attempts).toEqual(["0:initial", "0:language_retry", "1:initial"]);
        expect(result.candidates.map((candidate) => candidate.id)).toEqual(["candidate-0"]);
        expect(result.evaluationDiagnostics).toEqual(expect.objectContaining({
            providerCalls: 3,
            initialCalls: 2,
            languageRetryCalls: 1,
        }));
    });

    it("enforces the ten-call round cap across five language retries", async () => {
        const evaluator: QuietRecallEvaluator = async () => ({
            status: "retry",
            reason: "language_mismatch",
        });

        const result = await new QuietRecallEvaluationCoordinator().evaluate({
            localResult: makeLocalResult(5),
            contextFingerprint: "context-call-cap",
            evaluator,
        });

        expect(result.candidates).toHaveLength(0);
        expect(result.evaluationDiagnostics).toEqual(expect.objectContaining({
            providerCalls: QUIET_RECALL_MAX_PROVIDER_CALLS_PER_ROUND,
            initialCalls: 5,
            languageRetryCalls: 5,
        }));
        expect(result.evaluationDiagnostics?.attempts).toHaveLength(10);
    });

    it("stops before invoking the evaluator when reservation blocks a call", async () => {
        let reservationCount = 0;
        const reserve: QuietRecallEvaluationReserve = async () => {
            reservationCount += 1;
            return reservationCount <= 2
                ? { ok: true }
                : { ok: false, reason: "budget" };
        };
        const evaluator = jest.fn<QuietRecallEvaluator>(async ({ candidateIndex }) => ({
            status: "accepted",
            whyNow: `AI reason ${candidateIndex}`,
        }));

        const result = await new QuietRecallEvaluationCoordinator().evaluate({
            localResult: makeLocalResult(5),
            contextFingerprint: "context-budget",
            reserve,
            evaluator,
        });

        expect(evaluator).toHaveBeenCalledTimes(2);
        expect(result.candidates).toHaveLength(2);
        expect(result.discoverCandidates).toHaveLength(5);
        expect(result.evaluationDiagnostics).toEqual(expect.objectContaining({
            providerCalls: 2,
            blockedReason: "budget",
        }));
        expect(result.evaluationDiagnostics?.attempts.at(-1)).toEqual(expect.objectContaining({
            reserved: false,
            outcome: "blocked",
            reason: "budget",
        }));
    });

    it.each(["provider_unavailable", "budget", "cooldown"] as const)(
        "returns Discover-only local candidates when evaluation is blocked by %s",
        async (blockedReason) => {
            const evaluator = jest.fn<QuietRecallEvaluator>(async () => ({
                status: "accepted",
                whyNow: "Must not be synthesized while blocked.",
            }));
            const reserve = jest.fn<QuietRecallEvaluationReserve>(async () => ({ ok: true }));

            const result = await new QuietRecallEvaluationCoordinator().evaluate({
                localResult: makeLocalResult(2),
                contextFingerprint: `context-${blockedReason}`,
                blockedReason,
                reserve,
                evaluator,
            });

            expect(evaluator).not.toHaveBeenCalled();
            expect(reserve).not.toHaveBeenCalled();
            expect(result.candidates).toHaveLength(0);
            expect(result.discoverCandidates?.map((candidate) => candidate.whyNow)).toEqual([
                ["Local reason 0"],
                ["Local reason 1"],
            ]);
            expect(result.evaluationDiagnostics?.blockedReason).toBe(blockedReason);
        },
    );

    it("reuses a completed decision only for the same context-candidate fingerprint", async () => {
        const coordinator = new QuietRecallEvaluationCoordinator();
        const evaluator = jest.fn<QuietRecallEvaluator>(async () => ({
            status: "accepted",
            whyNow: "Context-sensitive reason.",
        }));
        const localResult = makeLocalResult(1);

        const first = await coordinator.evaluate({
            localResult,
            contextFingerprint: "context-a",
            evaluator,
        });
        const cached = await coordinator.evaluate({
            localResult,
            contextFingerprint: "context-a",
            evaluator,
        });
        const changedContext = await coordinator.evaluate({
            localResult,
            contextFingerprint: "context-b",
            evaluator,
        });

        expect(evaluator).toHaveBeenCalledTimes(2);
        expect(cached.evaluationDiagnostics).toEqual(expect.objectContaining({
            cacheHits: 1,
            providerCalls: 0,
        }));
        expect(first.candidates[0].evaluationFingerprint)
            .not.toBe(changedContext.candidates[0].evaluationFingerprint);
    });

    it("lets cooldown reuse exact cached judgments while blocking uncached work", async () => {
        const coordinator = new QuietRecallEvaluationCoordinator();
        const evaluator = jest.fn<QuietRecallEvaluator>(async () => ({
            status: "accepted",
            whyNow: "Exact cached reason.",
        }));
        const localResult = makeLocalResult(1);
        await coordinator.evaluate({
            localResult,
            contextFingerprint: "context-cached",
            evaluator,
        });

        const cached = await coordinator.evaluate({
            localResult,
            contextFingerprint: "context-cached",
            blockedReason: "cooldown",
            evaluator,
        });
        const miss = await coordinator.evaluate({
            localResult,
            contextFingerprint: "context-new",
            blockedReason: "cooldown",
            evaluator,
        });

        expect(cached.candidates).toHaveLength(1);
        expect(cached.evaluationDiagnostics).toEqual(expect.objectContaining({
            cacheHits: 1,
            providerCalls: 0,
        }));
        expect(miss.candidates).toHaveLength(0);
        expect(miss.evaluationDiagnostics?.blockedReason).toBe("cooldown");
        expect(evaluator).toHaveBeenCalledTimes(1);
    });

    it("deduplicates concurrent evaluation for the same fingerprint", async () => {
        const coordinator = new QuietRecallEvaluationCoordinator();
        let releaseEvaluation: ((decision: QuietRecallEvaluationDecision) => void) | undefined;
        const pendingDecision = new Promise<QuietRecallEvaluationDecision>((resolve) => {
            releaseEvaluation = resolve;
        });
        const evaluator = jest.fn<QuietRecallEvaluator>(() => pendingDecision);
        const input = {
            localResult: makeLocalResult(1),
            contextFingerprint: "context-concurrent",
            evaluator,
        };

        const firstPromise = coordinator.evaluate(input);
        const secondPromise = coordinator.evaluate(input);
        expect(evaluator).toHaveBeenCalledTimes(1);

        releaseEvaluation?.({ status: "accepted", whyNow: "Shared evaluation result." });
        const [first, second] = await Promise.all([firstPromise, secondPromise]);

        expect(first.candidates).toHaveLength(1);
        expect(second.candidates).toHaveLength(1);
        expect(second.evaluationDiagnostics).toEqual(expect.objectContaining({
            inFlightHits: 1,
            providerCalls: 0,
        }));
        expect(coordinator.inFlightSize).toBe(0);
    });

    it("keeps the session cache bounded and does not cache provider failures", async () => {
        const coordinator = new QuietRecallEvaluationCoordinator({ maxCacheEntries: 2 });
        const acceptedEvaluator = jest.fn<QuietRecallEvaluator>(async () => ({
            status: "accepted",
            whyNow: "Deterministic accepted result.",
        }));
        const localResult = makeLocalResult(1);

        for (const contextFingerprint of ["context-1", "context-2", "context-3"]) {
            await coordinator.evaluate({ localResult, contextFingerprint, evaluator: acceptedEvaluator });
        }
        expect(coordinator.cacheSize).toBe(2);
        await coordinator.evaluate({
            localResult,
            contextFingerprint: "context-1",
            evaluator: acceptedEvaluator,
        });
        expect(acceptedEvaluator).toHaveBeenCalledTimes(4);

        const failingEvaluator = jest.fn<QuietRecallEvaluator>(async () => {
            throw new Error("transient provider failure");
        });
        await coordinator.evaluate({
            localResult,
            contextFingerprint: "context-failure",
            evaluator: failingEvaluator,
        });
        await coordinator.evaluate({
            localResult,
            contextFingerprint: "context-failure",
            evaluator: failingEvaluator,
        });
        expect(failingEvaluator).toHaveBeenCalledTimes(2);
    });
});
