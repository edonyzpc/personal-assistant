import type {
    ChatToolResult,
    MemoryCandidate,
    MemorySearchRecoverySeed,
    MemorySearchResult,
    MemoryTemporalFilter,
    MemoryTemporalProjectionAudit,
    RerankOutcome,
} from "../src/ai-services/chat-types";
import {
    captureExplicitTemporalIntent,
    ChatMemoryRecoveryCoordinator,
    mergeMemorySearchResults,
    type MemoryRecoveryAttempt,
} from "../src/ai-services/retrieval-recovery-coordinator";
import type { RetrievalDiagnosticEventInput } from "../src/ai-services/retrieval-diagnostics";

describe("ChatMemoryRecoveryCoordinator", () => {
    it("keeps behavior unchanged when diagnostics are absent or throw", async () => {
        for (const recordDiagnostic of [
            undefined,
            () => { throw new Error("diagnostic sink failure"); },
        ]) {
            const coordinator = createCoordinator({ recordDiagnostic });
            const result = await coordinator.execute({
                query: "launch",
                signal: new AbortController().signal,
                executeAttempt: async () => asToolResult(
                    createEvidenceResult("launch", [candidate("hit.md", 0.9)]),
                ),
                revalidate: async (memory) => memory,
            });
            expect((result.content as MemorySearchResult).documents[0]?.source.path).toBe("hit.md");
        }
    });

    it("automatically runs exactly one hidden relaxed attempt for structured valid none", async () => {
        const coordinator = createCoordinator();
        const attempts: MemoryRecoveryAttempt[] = [];
        const result = await coordinator.execute({
            query: "launch",
            signal: new AbortController().signal,
            executeAttempt: async (attempt) => {
                attempts.push(attempt);
                return attempt.mode === "standard"
                    ? asToolResult(createNoneResult("launch"))
                    : asToolResult(createEvidenceResult("launch", [candidate("relaxed.md", 0.8)]));
            },
            revalidate: async (memory) => memory,
        });

        expect(attempts.map((attempt) => attempt.mode)).toEqual(["standard", "relaxed"]);
        expect((result.content as MemorySearchResult).documents).toHaveLength(1);
        expect((result.content as MemorySearchResult).documents[0]?.source.path).toBe("relaxed.md");
        expect((result.content as MemorySearchResult).recoverySeed).toBeUndefined();
        expect(coordinator.getState().token).toBe("consumed");
    });

    it("binds one run-local ordinal to the standard, hidden relaxed, and projection episode", async () => {
        const events: RetrievalDiagnosticEventInput[] = [];
        const attempts: MemoryRecoveryAttempt[] = [];
        const coordinator = createCoordinator({
            recordDiagnostic: (event) => events.push(event),
        });

        await coordinator.execute({
            query: "launch",
            signal: new AbortController().signal,
            executeAttempt: async (attempt) => {
                attempts.push(attempt);
                return attempt.mode === "standard"
                    ? asToolResult(createNoneResult("launch"))
                    : asToolResult(createEvidenceResult("launch", [candidate("relaxed.md", 0.8)]));
            },
            revalidate: async (memory) => memory,
        });
        await coordinator.execute({
            query: "follow-up",
            signal: new AbortController().signal,
            executeAttempt: async (attempt) => {
                attempts.push(attempt);
                return asToolResult(createEvidenceResult("follow-up", [candidate("follow-up.md", 0.9)]));
            },
            revalidate: async (memory) => memory,
        });

        expect(attempts.map((attempt) => [attempt.mode, attempt.invocationOrdinal])).toEqual([
            ["standard", 0],
            ["relaxed", 0],
            ["standard", 1],
        ]);
        expect(events.filter((event) => event.phase.startsWith("recovery_"))).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ phase: "recovery_standard", invocationOrdinal: 0 }),
                expect.objectContaining({ phase: "recovery_relaxed", invocationOrdinal: 0 }),
                expect.objectContaining({ phase: "recovery_projection", invocationOrdinal: 0 }),
                expect.objectContaining({ phase: "recovery_standard", invocationOrdinal: 1 }),
            ]),
        );
        expect(events.filter((event) => event.phase.startsWith("recovery_")).every(
            (event) => event.invocationOrdinal === 0 || event.invocationOrdinal === 1,
        )).toBe(true);
    });

    it("passes the frozen temporal range to projection and keeps its terminal audit fail-closed", async () => {
        const range = { since: 20, until: 40 };
        const standard = createNoneResult("launch");
        standard.recoverySeed!.lexicalPlan = {
            ...standard.recoverySeed!.lexicalPlan,
            temporalIntent: "range:2026-01-01..2026-12-31",
            temporalFilter: range,
        };
        const recorded: RetrievalDiagnosticEventInput[] = [];
        const coordinator = createCoordinator({
            recordDiagnostic: (event) => recorded.push(event),
        });
        const revalidate = jest.fn(async (
            memory: MemorySearchResult,
            _signal: AbortSignal,
            temporalFilter?: MemoryTemporalFilter | null,
            audit?: MemoryTemporalProjectionAudit,
        ) => {
            expect(temporalFilter).toEqual(range);
            if (audit) {
                audit.temporalFilterApplied = 1;
                audit.temporalViolationCount = 0;
            }
            return memory;
        });

        await coordinator.execute({
            query: "launch",
            signal: new AbortController().signal,
            executeAttempt: async (attempt) => attempt.mode === "standard"
                ? asToolResult(standard)
                : asToolResult(createEvidenceResult("launch", [candidate("current.md", 0.8)])),
            revalidate,
        });

        expect(revalidate).toHaveBeenCalledTimes(1);
        expect(recorded).toContainEqual(expect.objectContaining({
            phase: "recovery_projection",
            outcome: "completed",
            metrics: expect.objectContaining({
                temporalFilterApplied: 1,
                temporalViolationCount: 0,
            }),
        }));

        const ignoredAuditEvents: RetrievalDiagnosticEventInput[] = [];
        const ignoredAuditCoordinator = createCoordinator({
            recordDiagnostic: (event) => ignoredAuditEvents.push(event),
        });
        await ignoredAuditCoordinator.execute({
            query: "launch",
            signal: new AbortController().signal,
            executeAttempt: async (attempt) => attempt.mode === "standard"
                ? asToolResult(standard)
                : asToolResult(createEvidenceResult("launch", [candidate("current.md", 0.8)])),
            revalidate: async (memory) => memory,
        });
        expect(ignoredAuditEvents).toContainEqual(expect.objectContaining({
            phase: "recovery_projection",
            outcome: "completed",
            metrics: expect.objectContaining({
                temporalFilterApplied: 0,
                temporalViolationCount: 1,
            }),
        }));
    });

    it("retries only strict partial with needsMoreEvidence=true", async () => {
        for (const needsMoreEvidence of [false, true]) {
            const coordinator = createCoordinator();
            const attempts: string[] = [];
            await coordinator.execute({
                query: "launch",
                signal: new AbortController().signal,
                executeAttempt: async (attempt) => {
                    attempts.push(attempt.mode);
                    return attempt.mode === "standard"
                        ? asToolResult(createPartialResult("launch", needsMoreEvidence))
                        : asToolResult(createEvidenceResult("launch", [candidate("new.md", 0.9)]));
                },
                revalidate: async (memory) => memory,
            });
            expect(attempts).toEqual(needsMoreEvidence
                ? ["standard", "relaxed"]
                : ["standard"]);
        }
    });

    it.each([
        ["valid relevant", createEvidenceResult("launch", [candidate("hit.md", 0.9)])],
        ["fail-open relevant", createFailOpenResult("launch")],
        ["operational unavailable", createUnavailableResult("launch")],
    ])("does not retry %s", async (_name, standard) => {
        const coordinator = createCoordinator();
        const executeAttempt = jest.fn(async () => asToolResult(standard));
        await coordinator.execute({
            query: "launch",
            signal: new AbortController().signal,
            executeAttempt,
            revalidate: async (memory) => memory,
        });
        expect(executeAttempt).toHaveBeenCalledTimes(1);
    });

    it("omits unavailable standard counts while retaining a completed valid-none zero", async () => {
        const unavailableEvents: RetrievalDiagnosticEventInput[] = [];
        const unavailableCoordinator = createCoordinator({
            recordDiagnostic: (event) => unavailableEvents.push(event),
        });
        await unavailableCoordinator.execute({
            query: "launch",
            signal: new AbortController().signal,
            executeAttempt: async () => asToolResult(createUnavailableResult("launch")),
            revalidate: async (memory) => memory,
        });
        const unavailableTerminal = unavailableEvents.find((event) => (
            event.phase === "recovery_standard" && event.outcome !== "started"
        ));
        expect(unavailableTerminal).toMatchObject({
            outcome: "failed",
            reason: "standard_unavailable",
        });
        expect(unavailableTerminal?.metrics).not.toHaveProperty("documentCount");
        expect(unavailableEvents).toContainEqual(expect.objectContaining({
            phase: "recovery_relaxed",
            outcome: "skipped",
            reason: "standard_unavailable",
        }));

        const noneEvents: RetrievalDiagnosticEventInput[] = [];
        const noneCoordinator = createCoordinator({
            enabled: false,
            recordDiagnostic: (event) => noneEvents.push(event),
        });
        await noneCoordinator.execute({
            query: "launch",
            signal: new AbortController().signal,
            executeAttempt: async () => asToolResult(createNoneResult("launch")),
            revalidate: async (memory) => memory,
        });
        expect(noneEvents).toContainEqual(expect.objectContaining({
            phase: "recovery_standard",
            outcome: "completed",
            reason: "semantic_none",
            metrics: expect.objectContaining({ documentCount: 0 }),
        }));

        const legacyEvents: RetrievalDiagnosticEventInput[] = [];
        const legacyCoordinator = createCoordinator({
            enabled: false,
            recordDiagnostic: (event) => legacyEvents.push(event),
        });
        const legacyNone = createNoneResult("launch");
        delete legacyNone.memoryEvidenceState;
        await legacyCoordinator.execute({
            query: "launch",
            signal: new AbortController().signal,
            executeAttempt: async () => asToolResult(legacyNone),
            revalidate: async (memory) => memory,
        });
        const legacyTerminal = legacyEvents.find((event) => (
            event.phase === "recovery_standard" && event.outcome !== "started"
        ));
        expect(legacyTerminal).toMatchObject({ outcome: "completed" });
        expect(legacyTerminal).not.toHaveProperty("reason");
        expect(legacyTerminal?.metrics).not.toHaveProperty("documentCount");
    });

    it("omits an unavailable relaxed count instead of reporting semantic zero", async () => {
        const events: RetrievalDiagnosticEventInput[] = [];
        const coordinator = createCoordinator({
            recordDiagnostic: (event) => events.push(event),
        });
        await coordinator.execute({
            query: "launch",
            signal: new AbortController().signal,
            executeAttempt: async (attempt) => attempt.mode === "standard"
                ? asToolResult(createPartialResult("launch", true))
                : asToolResult(createUnavailableResult("launch")),
            revalidate: async (memory) => memory,
        });

        const relaxedTerminal = events.find((event) => (
            event.phase === "recovery_relaxed" && event.outcome !== "started"
        ));
        expect(relaxedTerminal).toMatchObject({
            outcome: "failed",
            reason: "source_unavailable",
        });
        expect(relaxedTerminal?.metrics).not.toHaveProperty("documentCount");
    });

    it("atomically grants one token across concurrent qualifying standard searches", async () => {
        const coordinator = createCoordinator();
        let relaxedCount = 0;
        const execute = (query: string) => coordinator.execute({
            query,
            signal: new AbortController().signal,
            executeAttempt: async (attempt) => {
                if (attempt.mode === "relaxed") {
                    relaxedCount += 1;
                    return asToolResult(createEvidenceResult(query, [candidate(`${query}.md`, 0.8)]));
                }
                return asToolResult(createNoneResult(query));
            },
            revalidate: async (memory) => memory,
        });

        await Promise.all([execute("first"), execute("second")]);
        expect(relaxedCount).toBe(1);
        expect(coordinator.getState().token).toBe("consumed");
    });

    it("keeps invocation ordinals in call-start order when concurrent calls finish in reverse", async () => {
        const events: RetrievalDiagnosticEventInput[] = [];
        const coordinator = createCoordinator({
            recordDiagnostic: (event) => events.push(event),
        });
        const firstGate = deferred<ChatToolResult<unknown>>();
        const secondGate = deferred<ChatToolResult<unknown>>();
        const attempts: Array<{ query: string; ordinal: number }> = [];
        const execute = (query: string, gate: ReturnType<typeof deferred<ChatToolResult<unknown>>>) => (
            coordinator.execute({
                query,
                signal: new AbortController().signal,
                executeAttempt: async (attempt) => {
                    attempts.push({ query, ordinal: attempt.invocationOrdinal });
                    return gate.promise;
                },
                revalidate: async (memory) => memory,
            })
        );

        const first = execute("first", firstGate);
        const second = execute("second", secondGate);
        await Promise.resolve();
        expect(attempts).toEqual([
            { query: "first", ordinal: 0 },
            { query: "second", ordinal: 1 },
        ]);

        secondGate.resolve(asToolResult(createEvidenceResult("second", [candidate("second.md", 0.9)])));
        await second;
        firstGate.resolve(asToolResult(createEvidenceResult("first", [candidate("first.md", 0.9)])));
        await first;

        expect(events.filter((event) => (
            event.phase === "recovery_standard" && event.outcome === "started"
        )).map((event) => event.invocationOrdinal)).toEqual([0, 1]);
        expect(events.filter((event) => (
            event.phase === "recovery_standard" && event.outcome === "completed"
        )).map((event) => event.invocationOrdinal)).toEqual([1, 0]);
    });

    it("does not start recovery when the finalization reserve would be consumed", async () => {
        const events: RetrievalDiagnosticEventInput[] = [];
        const coordinator = createCoordinator({
            now: () => 1_000,
            hardAt: 2_000,
            softAt: 1_600,
            toolAt: 1_600,
            minimumRelaxedBudgetMs: 400,
            projectionMarginMs: 300,
            recordDiagnostic: (event) => events.push(event),
        });
        const executeAttempt = jest.fn(async () => asToolResult(createNoneResult("launch")));
        const result = await coordinator.execute({
            query: "launch",
            signal: new AbortController().signal,
            executeAttempt,
            revalidate: async (memory) => memory,
        });
        expect(executeAttempt).toHaveBeenCalledTimes(1);
        expect((result.content as MemorySearchResult).recoveryReason).toBe("recovery_skipped_deadline");
        expect(coordinator.getState().token).toBe("available");
        const reserveEvent = events.find((event) => event.phase === "finalization_reserve");
        expect(reserveEvent).toBeDefined();
        expect(reserveEvent).toHaveProperty("invocationOrdinal", 0);
    });

    it("aborts active hidden work and closes the token on teardown", async () => {
        const coordinator = createCoordinator();
        let hiddenStarted!: () => void;
        const started = new Promise<void>((resolve) => { hiddenStarted = resolve; });
        const run = coordinator.execute({
            query: "launch",
            signal: new AbortController().signal,
            executeAttempt: async (attempt, signal) => {
                if (attempt.mode === "standard") return asToolResult(createNoneResult("launch"));
                hiddenStarted();
                return new Promise<ChatToolResult<unknown>>((_resolve, reject) => {
                    signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), {
                        name: "AbortError",
                    })), { once: true });
                });
            },
            revalidate: async (memory) => memory,
        });
        await started;
        coordinator.close();
        await expect(run).rejects.toMatchObject({ name: "AbortError" });
        expect(coordinator.getState()).toEqual({ token: "closed", closed: true, activeAttemptCount: 0 });
    });

    it("returns a recoverable Memory timeout when only the standard child deadline expires", async () => {
        jest.useFakeTimers();
        try {
            const startedAt = Date.now();
            const coordinator = createCoordinator({
                now: Date.now,
                hardAt: startedAt + 100,
                softAt: startedAt + 40,
                toolAt: startedAt + 40,
                projectionMarginMs: 5,
                hostSettlementMarginMs: 5,
            });
            const execution = coordinator.execute({
                query: "launch",
                signal: new AbortController().signal,
                executeAttempt: async (_attempt, signal) => new Promise<ChatToolResult<unknown>>((_resolve, reject) => {
                    signal.addEventListener("abort", () => reject(Object.assign(new Error("child deadline"), {
                        name: "AbortError",
                    })), { once: true });
                }),
                revalidate: async (memory) => memory,
            });

            await jest.advanceTimersByTimeAsync(40);
            await expect(execution).resolves.toMatchObject({
                ok: false,
                tool: "search_memory",
                content: null,
                error: expect.stringContaining("timed out"),
            });
            expect(coordinator.getState().token).toBe("available");
        } finally {
            jest.useRealTimers();
        }
    });

    it("binds standard settlement to the already-started outer 30s clock and discards a late result", async () => {
        jest.useFakeTimers();
        try {
            const startedAt = Date.now();
            const recorded: RetrievalDiagnosticEventInput[] = [];
            const attempts: MemoryRecoveryAttempt[] = [];
            const late = deferred<ChatToolResult<unknown>>();
            const coordinator = createCoordinator({
                now: Date.now,
                hardAt: startedAt + 60_000,
                softAt: startedAt + 50_000,
                toolAt: startedAt + 45_000,
                memoryEpisodeBudgetMs: 30_000,
                projectionMarginMs: 500,
                hostSettlementMarginMs: 250,
                recordDiagnostic: (event) => recorded.push(event),
            });
            // The dispatcher registered its absolute 30s timer before Host
            // validation/scheduling consumed 100ms.
            await jest.advanceTimersByTimeAsync(100);
            let settled = false;
            const execution = coordinator.execute({
                query: "launch",
                signal: new AbortController().signal,
                outerToolDeadlineAt: startedAt + 30_000,
                executeAttempt: async (attempt) => {
                    attempts.push(attempt);
                    return await late.promise;
                },
                revalidate: async (memory) => memory,
            });
            void execution.then(() => { settled = true; });
            await Promise.resolve();

            expect(attempts).toEqual([
                expect.objectContaining({
                    mode: "standard",
                    absoluteDeadlineMs: startedAt + 29_250,
                }),
            ]);
            expect(recorded).toContainEqual(expect.objectContaining({
                phase: "recovery_standard",
                outcome: "started",
                metrics: expect.objectContaining({ remainingMs: 29_150 }),
            }));

            await jest.advanceTimersByTimeAsync(29_149);
            expect(settled).toBe(false);
            await jest.advanceTimersByTimeAsync(1);
            const result = await execution;
            expect(result).toMatchObject({
                ok: false,
                tool: "search_memory",
                content: null,
                error: expect.stringContaining("timed out"),
            });
            expect(recorded).toContainEqual(expect.objectContaining({
                phase: "recovery_standard",
                outcome: "deadline",
                reason: "attempt_deadline",
                metrics: expect.objectContaining({ durationMs: 29_150 }),
            }));
            expect(coordinator.getState().activeAttemptCount).toBe(0);

            late.resolve(asToolResult(createEvidenceResult("launch", [candidate("late.md", 0.9)])));
            await Promise.resolve();
            await Promise.resolve();
            expect(recorded.filter((event) => (
                event.phase === "recovery_standard" && event.outcome !== "started"
            ))).toEqual([
                expect.objectContaining({ outcome: "deadline", reason: "attempt_deadline" }),
            ]);
            expect(result.content).toBeNull();
        } finally {
            jest.useRealTimers();
        }
    });

    it("keeps an earlier parent abort distinct from the child deadline and ignores late completion", async () => {
        const recorded: RetrievalDiagnosticEventInput[] = [];
        const parent = new AbortController();
        const attemptStarted = deferred<void>();
        const late = deferred<ChatToolResult<unknown>>();
        const coordinator = createCoordinator({
            recordDiagnostic: (event) => recorded.push(event),
        });
        const execution = coordinator.execute({
            query: "launch",
            signal: parent.signal,
            outerToolDeadlineAt: 30_000,
            executeAttempt: async () => {
                attemptStarted.resolve(undefined);
                return await late.promise;
            },
            revalidate: async (memory) => memory,
        });
        await attemptStarted.promise;

        parent.abort();
        await expect(execution).rejects.toMatchObject({ name: "AbortError" });
        expect(recorded.filter((event) => (
            event.phase === "recovery_standard" && event.outcome !== "started"
        ))).toEqual([
            expect.objectContaining({ outcome: "aborted", reason: "attempt_aborted" }),
        ]);

        late.resolve(asToolResult(createEvidenceResult("launch", [candidate("late.md", 0.9)])));
        await Promise.resolve();
        await Promise.resolve();
        expect(recorded.filter((event) => (
            event.phase === "recovery_standard" && event.outcome !== "started"
        ))).toHaveLength(1);
        expect(coordinator.getState().activeAttemptCount).toBe(0);
    });

    it("keeps a deterministic projection reserve inside a small Host budget", async () => {
        jest.useFakeTimers();
        try {
            const startedAt = Date.now();
            const recorded: RetrievalDiagnosticEventInput[] = [];
            const attempts: MemoryRecoveryAttempt[] = [];
            const projectionStarted = deferred<void>();
            const lateProjection = deferred<MemorySearchResult>();
            const standard = createPartialResult("launch", true);
            const coordinator = createCoordinator({
                now: Date.now,
                hardAt: startedAt + 100,
                softAt: startedAt + 100,
                toolAt: startedAt + 100,
                memoryEpisodeBudgetMs: 40,
                relaxedAttemptBudgetMs: 15,
                minimumRelaxedBudgetMs: 1,
                projectionMarginMs: 10,
                hostSettlementMarginMs: 5,
                recordDiagnostic: (event) => recorded.push(event),
            });
            await jest.advanceTimersByTimeAsync(5);
            let settled = false;
            const execution = coordinator.execute({
                query: "launch",
                signal: new AbortController().signal,
                outerToolDeadlineAt: startedAt + 40,
                executeAttempt: async (attempt) => {
                    attempts.push(attempt);
                    return attempt.mode === "standard"
                        ? asToolResult(standard)
                        : asToolResult(createEvidenceResult("launch", [candidate("relaxed.md", 0.9)]));
                },
                revalidate: async () => {
                    projectionStarted.resolve(undefined);
                    return await lateProjection.promise;
                },
            });
            void execution.then(() => { settled = true; });
            await projectionStarted.promise;

            expect(attempts.map((attempt) => attempt.absoluteDeadlineMs)).toEqual([
                startedAt + 25,
                startedAt + 20,
            ]);
            await jest.advanceTimersByTimeAsync(29);
            expect(settled).toBe(false);
            await jest.advanceTimersByTimeAsync(1);
            const result = await execution;
            expect(result.ok).toBe(true);
            expect((result.content as MemorySearchResult).documents[0]?.source.path).toBe("partial.md");
            expect(recorded).toContainEqual(expect.objectContaining({
                phase: "recovery_projection",
                outcome: "deadline",
                reason: "projection_deadline",
                metrics: expect.objectContaining({ durationMs: 30 }),
            }));

            lateProjection.resolve(createEvidenceResult("launch", [candidate("late.md", 0.9)]));
            await Promise.resolve();
            await Promise.resolve();
            expect(recorded.filter((event) => (
                event.phase === "recovery_projection" && event.outcome !== "started"
            ))).toEqual([
                expect.objectContaining({ outcome: "deadline", reason: "projection_deadline" }),
            ]);
            expect(coordinator.getState().activeAttemptCount).toBe(0);
        } finally {
            jest.useRealTimers();
        }
    });

    it("classifies a relaxed child deadline and preserves standard evidence", async () => {
        jest.useFakeTimers();
        try {
            const startedAt = Date.now();
            const recorded: RetrievalDiagnosticEventInput[] = [];
            const relaxedStarted = deferred<void>();
            const standard = createPartialResult("launch", true);
            const coordinator = createCoordinator({
                now: Date.now,
                hardAt: startedAt + 200,
                softAt: startedAt + 200,
                toolAt: startedAt + 200,
                relaxedAttemptBudgetMs: 40,
                minimumRelaxedBudgetMs: 1,
                projectionMarginMs: 5,
                hostSettlementMarginMs: 5,
                recordDiagnostic: (event) => recorded.push(event),
            });
            const execution = coordinator.execute({
                query: "launch",
                signal: new AbortController().signal,
                executeAttempt: async (attempt, signal) => {
                    if (attempt.mode === "standard") return asToolResult(standard);
                    relaxedStarted.resolve(undefined);
                    return await new Promise<ChatToolResult<unknown>>((_resolve, reject) => {
                        signal.addEventListener("abort", () => reject(Object.assign(new Error("child deadline"), {
                            name: "AbortError",
                        })), { once: true });
                    });
                },
                revalidate: async (memory) => memory,
            });

            await relaxedStarted.promise;
            await jest.advanceTimersByTimeAsync(40);
            const result = await execution;
            expect(result.ok).toBe(true);
            expect((result.content as MemorySearchResult).documents[0]?.source.path).toBe("partial.md");
            expect((result.content as MemorySearchResult).recoverySeed).toBeUndefined();
            expect(recorded).toContainEqual(expect.objectContaining({
                phase: "recovery_relaxed",
                outcome: "deadline",
                reason: "attempt_deadline",
                metrics: expect.objectContaining({ retryConsumed: 1 }),
            }));
            expect(recorded).not.toContainEqual(expect.objectContaining({
                phase: "recovery_relaxed",
                outcome: "failed",
                reason: "attempt_failed",
            }));
        } finally {
            jest.useRealTimers();
        }
    });

    it("does not misclassify an internal standard AbortError as a parent or user cancellation", async () => {
        const coordinator = createCoordinator();
        const result = await coordinator.execute({
            query: "launch",
            signal: new AbortController().signal,
            executeAttempt: async () => {
                throw Object.assign(new Error("backend operation stopped"), { name: "AbortError" });
            },
            revalidate: async (memory) => memory,
        });

        expect(result).toMatchObject({
            ok: false,
            tool: "search_memory",
            content: null,
            error: expect.stringContaining("unavailable"),
        });
        expect(coordinator.getState().token).toBe("available");
    });

    it("aborts slow cumulative revalidation at softAt and preserves standard evidence", async () => {
        const startedAt = Date.now();
        const coordinator = createCoordinator({
            now: Date.now,
            hardAt: startedAt + 120,
            softAt: startedAt + 70,
            toolAt: startedAt + 70,
            projectionMarginMs: 20,
            hostSettlementMarginMs: 5,
            minimumRelaxedBudgetMs: 1,
            relaxedAttemptBudgetMs: 30,
        });
        let projectionAborted = false;
        const standard = createPartialResult("launch", true);
        const result = await coordinator.execute({
            query: "launch",
            signal: new AbortController().signal,
            executeAttempt: async (attempt) => attempt.mode === "standard"
                ? asToolResult(standard)
                : asToolResult(createEvidenceResult("launch", [candidate("relaxed.md", 0.9)])),
            revalidate: (_memory, signal) => new Promise<MemorySearchResult>((_resolve, reject) => {
                signal.addEventListener("abort", () => {
                    projectionAborted = true;
                    reject(Object.assign(new Error("projection timeout"), { name: "AbortError" }));
                }, { once: true });
            }),
        });
        expect(projectionAborted).toBe(true);
        expect((result.content as MemorySearchResult).documents[0]?.source.path).toBe("partial.md");
        expect(Date.now() - startedAt).toBeLessThan(110);
    });

    it("keeps feature-off execution strictly standard", async () => {
        const coordinator = createCoordinator({ enabled: false });
        const attempts: MemoryRecoveryAttempt[] = [];
        const result = await coordinator.execute({
            query: "launch",
            signal: new AbortController().signal,
            executeAttempt: async (attempt) => {
                attempts.push(attempt);
                return asToolResult(createNoneResult("launch"));
            },
            revalidate: async (memory) => memory,
        });
        expect(attempts).toEqual([expect.objectContaining({ mode: "standard", captureRecoverySeed: false })]);
        expect((result.content as MemorySearchResult).recoveryReason).toBe("recovery_disabled");
    });

    it("lets an in-flight standard attempt finish but suppresses retry after live disable", async () => {
        let enabled = true;
        let policyEpoch = "policy-1";
        const listeners = new Set<() => void | Promise<void>>();
        const standard = deferred<ChatToolResult<unknown>>();
        const standardStarted = deferred<void>();
        let standardSignal: AbortSignal | undefined;
        const attempts: MemoryRecoveryAttempt[] = [];
        const coordinator = createCoordinator({
            policyEpoch,
            isEnabled: () => enabled,
            getPolicyEpoch: () => policyEpoch,
            onPolicyChanged: (listener) => {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
        });

        const pending = coordinator.execute({
            query: "launch",
            signal: new AbortController().signal,
            executeAttempt: async (attempt, signal) => {
                attempts.push(attempt);
                standardSignal = signal;
                standardStarted.resolve(undefined);
                return await standard.promise;
            },
            revalidate: async (memory) => memory,
        });
        await standardStarted.promise;

        enabled = false;
        policyEpoch = "policy-2";
        await Promise.all([...listeners].map((listener) => listener()));
        expect(standardSignal?.aborted).toBe(false);

        standard.resolve(asToolResult(createNoneResult("launch")));
        const completed = await pending;
        expect(attempts).toEqual([expect.objectContaining({ mode: "standard" })]);
        expect((completed.content as MemorySearchResult).recoveryReason).toBe("recovery_disabled");
        expect((completed.content as MemorySearchResult).recoverySeed).toBeUndefined();
    });

    it("aborts an in-flight relaxed attempt and discards its late result after live disable", async () => {
        let enabled = true;
        let policyEpoch = "policy-1";
        const listeners = new Set<() => void | Promise<void>>();
        const relaxed = deferred<ChatToolResult<unknown>>();
        const relaxedStarted = deferred<void>();
        let relaxedSignal: AbortSignal | undefined;
        const coordinator = createCoordinator({
            policyEpoch,
            isEnabled: () => enabled,
            getPolicyEpoch: () => policyEpoch,
            onPolicyChanged: (listener) => {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
        });

        const pending = coordinator.execute({
            query: "launch",
            signal: new AbortController().signal,
            executeAttempt: async (attempt, signal) => {
                if (attempt.mode === "standard") return asToolResult(createNoneResult("launch"));
                relaxedSignal = signal;
                relaxedStarted.resolve(undefined);
                return await relaxed.promise;
            },
            revalidate: async (memory) => memory,
        });
        await relaxedStarted.promise;

        enabled = false;
        policyEpoch = "policy-2";
        await Promise.all([...listeners].map((listener) => listener()));
        expect(relaxedSignal?.aborted).toBe(true);

        const completed = await pending;
        expect((completed.content as MemorySearchResult)).toMatchObject({
            documents: [],
            recoveryReason: "recovery_disabled",
        });
        relaxed.resolve(asToolResult(createEvidenceResult("launch", [candidate("late.md", 0.9)])));
        await Promise.resolve();
        expect((completed.content as MemorySearchResult).documents).toEqual([]);
        expect(listeners.size).toBe(0);
    });
});

describe("retrieval recovery merge and temporal scope", () => {
    it("interleaves valid attempt rankings, prefers relaxed same-path representation, and caps at eight", () => {
        const standardCandidates = [candidate("same.md", 1, "old"), ...rangeCandidates("s", 5)];
        const relaxedCandidates = [candidate("same.md", 0.9, "new"), ...rangeCandidates("r", 5)];
        const merged = mergeMemorySearchResults(
            createEvidenceResult("q", standardCandidates),
            createEvidenceResult("q", relaxedCandidates),
        );
        expect(merged.documents).toHaveLength(8);
        expect(merged.candidates?.map((entry) => entry.path).slice(0, 4)).toEqual([
            "same.md",
            "s-0.md",
            "r-0.md",
            "s-1.md",
        ]);
        expect(merged.candidates?.[0]?.documents[0]?.content).toBe("new");
        expect(new Set(merged.documents.map((document) => `${document.source.path}#${document.source.chunkIndex}`)).size)
            .toBe(8);
    });

    it("keeps standard candidates first when relaxed reranking fails open", () => {
        const standard = createEvidenceResult("q", [candidate("standard.md", 1)]);
        const relaxed = createFailOpenResult("q", [candidate("relaxed.md", 0.9)]);
        const merged = mergeMemorySearchResults(standard, relaxed);
        expect(merged.candidates?.map((entry) => entry.path)).toEqual(["standard.md", "relaxed.md"]);
    });

    it("keeps the cumulative result explicitly partial when the relaxed evidence is still partial", () => {
        const merged = mergeMemorySearchResults(
            createPartialResult("q", true),
            createPartialResult("q", true),
        );
        expect(merged).toMatchObject({
            memoryEvidenceState: "partial",
            rerankVerdict: "partially_relevant",
            needsMoreEvidence: true,
        });
    });

    it.each([
        ["last 7 days", "recent_7d"],
        ["最近30天的项目记录", "recent_30d"],
        ["from 2026-01-01 to 2026-02-03", "range:2026-01-01..2026-02-03"],
        ["notes on 2026-01-01", "range:2026-01-01..2026-01-01"],
        ["仅使用 2026 年的记录说明当前时间边界信号", "range:2026-01-01..2026-12-31"],
        ["仅使用2026年的记录说明时间边界信号", "range:2026-01-01..2026-12-31"],
        ["仅使用2026年度的记录说明时间边界信号", "range:2026-01-01..2026-12-31"],
        ["2026年Q1计划", "range:2026-01-01..2026-12-31"],
        ["2026年度OKR", "range:2026-01-01..2026-12-31"],
        ["2026年AI项目", "range:2026-01-01..2026-12-31"],
        ["notes from 2026", "range:2026-01-01..2026-12-31"],
        ["7401", "none"],
        ["只从我的笔记中查找错误码 ERR_RETRIEVAL_LANTERN_7401", "none"],
        ["find release_2026 notes", "none"],
        ["find HTTP-2026 notes", "none"],
        ["find ERR_2026年 notes", "none"],
        ["find 2026年_release notes", "none"],
        ["错误码2026", "none"],
        ["型号2026版", "none"],
        ["第2026号事项", "none"],
        ["today's notes", "recent_30d"],
        ["yesterday's notes", "recent_7d"],
        ["当前工作记录", "recent_30d"],
        ["current work notes", "recent_30d"],
        ["当前架构", "none"],
        ["current architecture", "none"],
        ["old notes without a time filter", "none"],
    ])("captures immutable explicit temporal intent from %s", (query, expected) => {
        expect(captureExplicitTemporalIntent(query)).toBe(expected);
    });
});

function createCoordinator(
    overrides: Partial<ConstructorParameters<typeof ChatMemoryRecoveryCoordinator>[0]> = {},
): ChatMemoryRecoveryCoordinator {
    return new ChatMemoryRecoveryCoordinator({
        runId: "run-1",
        runEpoch: "epoch-1",
        hardAt: 60_000,
        softAt: 50_000,
        toolAt: 45_000,
        enabled: true,
        temporalIntent: "none",
        now: () => 0,
        ...overrides,
    });
}

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function recoverySeed(query: string): MemorySearchRecoverySeed {
    return {
        query,
        lexicalPlan: {
            ftsQueryOverride: "launch",
            temporalIntent: "none",
            temporalFilter: null,
        },
        rejectedEvidence: [],
        queryEmbedding: {
            value: [0.1, 0.2],
            profileSignature: "profile",
        },
    };
}

function createNoneResult(query: string): MemorySearchResult {
    const rerankOutcome: RerankOutcome = {
        kind: "valid",
        verdict: "none_relevant",
        needsMoreEvidence: true,
        candidates: [],
        origin: "deterministic_empty",
        modelCalled: false,
    };
    return {
        usedMemory: false,
        query,
        documents: [],
        sources: [],
        candidates: [],
        hasAnswerableContent: false,
        memoryEvidenceState: "none",
        rerankVerdict: "none_relevant",
        needsMoreEvidence: true,
        rerankOutcome,
        recoverySeed: recoverySeed(query),
    };
}

function createPartialResult(query: string, needsMoreEvidence: boolean): MemorySearchResult {
    const candidates = [candidate("partial.md", 0.9)];
    const rerankOutcome: RerankOutcome = {
        kind: "valid",
        verdict: "partially_relevant",
        needsMoreEvidence,
        candidates,
        origin: "model",
        modelCalled: true,
    };
    return {
        ...createEvidenceResult(query, candidates),
        memoryEvidenceState: "partial",
        rerankVerdict: "partially_relevant",
        needsMoreEvidence,
        rerankOutcome,
        recoverySeed: recoverySeed(query),
    };
}

function createEvidenceResult(query: string, candidates: MemoryCandidate[]): MemorySearchResult {
    const documents = candidates.flatMap((entry) => entry.documents).slice(0, 8);
    return {
        usedMemory: documents.length > 0,
        query,
        documents,
        sources: documents.map((document) => ({ ...document.source })),
        candidates,
        hasAnswerableContent: documents.length > 0,
        memoryEvidenceState: "evidence",
        rerankVerdict: "relevant",
        needsMoreEvidence: false,
        rerankOutcome: {
            kind: "valid",
            verdict: "relevant",
            needsMoreEvidence: false,
            candidates,
            origin: "model",
            modelCalled: true,
        },
    };
}

function createFailOpenResult(
    query: string,
    candidates: MemoryCandidate[] = [candidate("fallback.md", 0.7)],
): MemorySearchResult {
    return {
        ...createEvidenceResult(query, candidates),
        rerankOutcome: {
            kind: "fail_open",
            verdict: "relevant",
            needsMoreEvidence: false,
            reason: "provider_error",
            candidates,
            origin: "fail_open",
            modelCalled: true,
        },
    };
}

function createUnavailableResult(query: string): MemorySearchResult {
    return {
        usedMemory: false,
        query,
        documents: [],
        sources: [],
        candidates: [],
        memoryEvidenceState: "unavailable",
        rerankVerdict: "relevant",
        needsMoreEvidence: false,
        operationalReason: "current_source_unavailable",
    };
}

function asToolResult(content: MemorySearchResult): ChatToolResult<unknown> {
    return {
        ok: true,
        tool: "search_memory",
        inputSummary: content.query,
        content,
        sources: content.sources,
        sourceRecords: content.sources.map((source) => ({
            kind: "memory-reference",
            dedupKey: source.path,
            sourceBoundary: "memory",
            path: source.path,
            chunkIndex: source.chunkIndex,
        })),
    };
}

function candidate(path: string, score: number, content = path): MemoryCandidate {
    return {
        candidateId: path,
        path,
        score,
        excerpt: content,
        origin: "direct",
        documents: [{
            content,
            score,
            source: { path, chunkIndex: 0, score },
            anchorMetadata: {
                contentHash: `hash-${content}`,
                startLine: 0,
                endLine: 1,
                headingPath: [],
                indexVersion: "v1",
            },
        }],
        anchor: {
            candidateId: path,
            path,
            chunkIndex: 0,
            score,
            indexedSnippet: content,
            indexedContentHash: `hash-${content}`,
            startLine: 0,
            endLine: 1,
            headingPath: [],
            indexVersion: "v1",
        },
        sourceSnapshot: { epoch: "1:1", bodyHash: `body-${content}` },
    };
}

function rangeCandidates(prefix: string, count: number): MemoryCandidate[] {
    return Array.from({ length: count }, (_, index) => candidate(`${prefix}-${index}.md`, 0.8 - index / 100));
}
