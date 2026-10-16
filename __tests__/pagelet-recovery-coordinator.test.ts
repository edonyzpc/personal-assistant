import { describe, expect, it, jest } from "@jest/globals";

import type { AiServiceHost } from "../src/ai-services/AiServiceHost";
import type {
    MemoryCandidate,
    MemorySearchDocument,
    MemorySearchResult,
    PaAgentMessage,
} from "../src/ai-services/chat-types";
import type { SearchMemoryInput } from "../src/ai-services/chat-tool-types";
import { createChatToolCapability } from "../src/ai-services/capability-adapter";
import { CapabilityRegistry } from "../src/ai-services/capability-registry";
import { createSearchMemoryTool } from "../src/ai-services/chat-tools";
import {
    PageletRecoveryCoordinator,
    type PageletRecoveryCoordinatorOptions,
} from "../src/pagelet/agent/pagelet-recovery-coordinator";
import { mergeMemorySearchResults } from "../src/ai-services/retrieval-recovery-coordinator";
import type { RetrievalDiagnosticEventInput } from "../src/ai-services/retrieval-diagnostics";

const host = { log: jest.fn() } as unknown as AiServiceHost;

function document(path: string, content = path): MemorySearchDocument {
    return {
        content,
        score: 0.8,
        source: { path, chunkIndex: 0, score: 0.8 },
        anchorMetadata: { contentHash: `${path}-hash` },
    };
}

function candidate(path: string): MemoryCandidate {
    const memoryDocument = document(path);
    return {
        candidateId: `candidate:${path}`,
        path,
        score: 0.8,
        documents: [memoryDocument],
        excerpt: memoryDocument.content,
    };
}

function result(
    verdict: "none_relevant" | "partially_relevant" | "relevant",
    paths: string[],
): MemorySearchResult {
    const documents = paths.map((path) => document(path));
    const candidates = paths.map((path) => candidate(path));
    const needsMoreEvidence = verdict !== "relevant";
    return {
        usedMemory: documents.length > 0,
        query: "host-owned-query",
        documents,
        sources: documents.map((item) => ({ ...item.source })),
        candidates,
        hasAnswerableContent: documents.length > 0,
        memoryEvidenceState: verdict === "partially_relevant"
            ? "partial"
            : verdict === "none_relevant" ? "none" : "evidence",
        rerankVerdict: verdict,
        needsMoreEvidence,
        rerankOutcome: {
            kind: "valid",
            verdict,
            needsMoreEvidence,
            candidates,
            origin: verdict === "none_relevant" ? "deterministic_empty" : "model",
            modelCalled: verdict !== "none_relevant",
        },
        recoverySeed: {
            query: "host-owned-query",
            lexicalPlan: {
                ftsQueryOverride: "frozen",
                temporalIntent: "none",
                temporalFilter: null,
            },
            rejectedEvidence: [],
        },
    };
}

function unavailableResult(): MemorySearchResult {
    return {
        ...result("none_relevant", []),
        memoryEvidenceState: "unavailable",
        rerankVerdict: "relevant",
        needsMoreEvidence: false,
        operationalReason: "current_source_unavailable",
        rerankOutcome: undefined,
        recoverySeed: undefined,
    };
}

function stageInput(_requestRelaxedRecovery = true) {
    return {
        insightMarkdown: [
            "## First verified risk",
            "`notes/anchor.md` conflicts with `notes/lead.md`, which increases release risk.",
        ].join("\n"),
        sourceIds: ["notes/anchor.md", "notes/lead.md"],
    };
}

function coordinator(options: {
    enabled?: boolean;
    policyEpoch?: string;
    isEnabled?: PageletRecoveryCoordinatorOptions["isEnabled"];
    getPolicyEpoch?: PageletRecoveryCoordinatorOptions["getPolicyEpoch"];
    onPolicyChanged?: PageletRecoveryCoordinatorOptions["onPolicyChanged"];
    standard?: MemorySearchResult;
    executeStandard?: PageletRecoveryCoordinatorOptions["executeStandard"];
    relaxed?: PageletRecoveryCoordinatorOptions["executeRelaxed"];
    revalidate?: (seed: MemorySearchResult) => Promise<MemorySearchResult>;
    prevalidateStaged?: PageletRecoveryCoordinatorOptions["prevalidateStaged"];
    validateStaged?: PageletRecoveryCoordinatorOptions["validateStaged"];
    now?: () => number;
    maxWallClockMs?: number;
    finalizationReserveMs?: number;
    recordDiagnostic?: PageletRecoveryCoordinatorOptions["recordDiagnostic"];
} = {}) {
    const standard = options.standard ?? result("partially_relevant", ["notes/lead.md"]);
    const executeRelaxed = jest.fn(options.relaxed ?? (async () => (
        result("relevant", ["notes/deep.md"])
    )));
    const instance = new PageletRecoveryCoordinator({
        enabled: options.enabled ?? true,
        anchorPath: "notes/anchor.md",
        policyEpoch: options.policyEpoch,
        isEnabled: options.isEnabled,
        getPolicyEpoch: options.getPolicyEpoch,
        onPolicyChanged: options.onPolicyChanged,
        startedAt: 0,
        runEpoch: "pagelet-test-run",
        maxWallClockMs: options.maxWallClockMs ?? 180_000,
        finalizationReserveMs: options.finalizationReserveMs ?? 30_000,
        recordDiagnostic: options.recordDiagnostic,
        now: options.now ?? (() => 1_000),
        executeStandard: options.executeStandard ?? (async () => standard),
        executeRelaxed,
        revalidate: options.revalidate ?? (async (seed) => seed),
        prevalidateStaged: options.prevalidateStaged ?? (() => undefined),
        validateStaged: options.validateStaged ?? (async (input) => ({
            accepted: true,
            verifiedSourceIds: [...input.sourceIds],
        })),
    });
    return { instance, executeRelaxed };
}

function executeBoundSearch(
    instance: PageletRecoveryCoordinator,
    toolCallId: string,
    input: SearchMemoryInput | string = { query: "model query" },
    context: {
        signal?: AbortSignal;
        outerToolDeadlineAt?: number;
    } = {},
): Promise<MemorySearchResult> {
    return instance.withMemorySearchToolCall(
        toolCallId,
        () => instance.executeMemorySearch(
            typeof input === "string" ? { query: input } : input,
            { host, ...context },
        ),
    );
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

describe("Pagelet run-scoped retrieval recovery", () => {
    it.each(["none_relevant", "partially_relevant"] as const)("recovers eligible %s in the originating search without staging", async verdict => {
        const standard = result(verdict, verdict === "none_relevant" ? [] : ["notes/lead.md"]);
        const { instance, executeRelaxed } = coordinator({ standard });
        const recovered = await executeBoundSearch(instance, "originating-search");
        expect(recovered.sources.map(source => source.path)).toContain("notes/deep.md");
        expect(executeRelaxed).toHaveBeenCalledTimes(1);
        expect(executeRelaxed.mock.calls[0][0]).toBe(standard);
        expect(executeRelaxed.mock.calls[0][0].recoverySeed).toEqual(standard.recoverySeed);
        expect(instance.snapshot("NO_INSIGHT").diagnostics).toMatchObject({ stageControlCalled: false, relaxedTokenConsumed: true });
        const ordinary = await executeBoundSearch(instance, "ordinary-next-search", { query: "another allowed query" });
        expect(ordinary.sources).toEqual(standard.sources);
        expect(executeRelaxed).toHaveBeenCalledTimes(1);
    });

    it("stages multiple unchanged complete texts independently of the recovery flag and schema capacity guesses", async () => {
        const { instance } = coordinator({ enabled: false });
        const capability = instance.getStageCapability();
        expect(capability.toRegistryDefinition?.().inputSchema).toMatchObject({ required: ["insightMarkdown", "sourceIds"] });
        const fullText = ` \n## Ｆull text\n${"original ".repeat(2_100)}\n\n## Another section  \n`;
        const input = { insightMarkdown: fullText, sourceIds: ["notes/anchor.md", ...Array.from({ length: 20 }, (_, index) => `notes/source-${index}.md`)] };
        for (let index = 0; index < 3; index += 1) {
            const prepared = capability.prepareAndValidate?.({ ...input, insightMarkdown: `${fullText}${index}` }, { userInput: "" });
            if (!prepared?.ok) throw new Error("expected a complete valid staging input");
            await expect(capability.execute(prepared.input, { host })).resolves.toMatchObject({ status: "ok", observation: { status: "staged" } });
        }
        expect(instance.snapshot("final").drafts.map(draft => draft.body)).toEqual([`${fullText}0`, `${fullText}1`, `${fullText}2`, "final"]);
        expect(instance.snapshot("NO_INSIGHT").drafts).toHaveLength(3);
    });

    it("revalidates the original partial after failed relaxed recovery instead of reviving revoked evidence", async () => {
        const partial = result("partially_relevant", ["notes/lead.md"]);
        const revalidate = jest.fn(async (_candidate: MemorySearchResult, _signal?: AbortSignal) => unavailableResult());
        const { instance } = coordinator({ standard: partial, relaxed: async () => { throw new Error("relaxed failed"); }, revalidate });
        const observed = await executeBoundSearch(instance, "partial-fallback");
        expect(revalidate).toHaveBeenCalledWith(partial, expect.any(AbortSignal));
        expect(observed.memoryEvidenceState).toBe("unavailable");
        expect(observed.sources).toEqual([]);
    });

    it("falls back to a freshly validated original partial when recovered evidence is revoked", async () => {
        const partial = result("partially_relevant", ["notes/lead.md"]);
        const revalidate = jest.fn(async (candidate: MemorySearchResult) => candidate === partial ? partial : unavailableResult());
        const { instance } = coordinator({ standard: partial, revalidate });
        const observed = await executeBoundSearch(instance, "revoked-recovery");
        expect(revalidate).toHaveBeenCalledTimes(2);
        expect(revalidate.mock.calls[1][0]).toBe(partial);
        expect(observed.sources.map(source => source.path)).toEqual(["notes/lead.md"]);
    });

    it("preserves already staged text and stage availability when recovery policy is disabled live", async () => {
        let enabled = true;
        const listeners = new Set<() => void | Promise<void>>();
        const { instance } = coordinator({ isEnabled: () => enabled, onPolicyChanged: listener => { listeners.add(listener); return () => listeners.delete(listener); } });
        const capability = instance.getStageCapability();
        await capability.execute(stageInput(), { host });
        enabled = false;
        await Promise.all([...listeners].map(listener => listener()));
        await expect(capability.execute({ ...stageInput(), insightMarkdown: "another complete text" }, { host })).resolves.toMatchObject({ status: "ok" });
        expect(instance.snapshot("NO_INSIGHT").drafts.map(draft => draft.body)).toEqual([stageInput().insightMarkdown, "another complete text"]);
    });

    it("passes the complete registered Memory tool input to the standard recovery port", async () => {
        const inputs: SearchMemoryInput[] = [];
        const { instance } = coordinator({
            executeStandard: async input => {
                inputs.push(input);
                return {
                    ...result("partially_relevant", ["notes/lead.md"]),
                    query: input.query,
                };
            },
        });
        const input: SearchMemoryInput = {
            query: "不要限定最近30天",
            temporal: "none",
        };

        const searchResult = await executeBoundSearch(instance, "temporal-input-call", input);

        expect(inputs).toEqual([input]);
        expect(searchResult.query).toBe(input.query);
    });

    it("keeps temporal input intact through the registered Pagelet Memory capability", async () => {
        const inputs: SearchMemoryInput[] = [];
        const { instance } = coordinator({
            executeStandard: async input => {
                inputs.push(input);
                return result("relevant", ["notes/current.md"]);
            },
        });
        const registry = new CapabilityRegistry();
        registry.register(createChatToolCapability(
            createSearchMemoryTool(input => instance.executeMemorySearch(input, {
                host,
                signal: new AbortController().signal,
            })),
            { providerId: "pagelet-deep-discover-core" },
        ));

        const toolResult = await registry.execute("search_memory", {
            query: "不要限定最近30天的项目记录",
            temporal: "none",
        }, { host, signal: new AbortController().signal });

        expect(toolResult.ok).toBe(true);
        expect(inputs).toEqual([{ query: "不要限定最近30天的项目记录", temporal: "none" }]);
    });

    it("returns a stable content-free reason when asynchronous stage validation rejects", async () => {
        const { instance } = coordinator({
            validateStaged: async () => ({
                accepted: false,
                rejection: "first",
                subreason: "unsupported-source",
            }),
        });

        const capability = instance.getStageCapability();
        const prepared = capability.prepareAndValidate?.(stageInput(false), { userInput: "" });
        if (!prepared?.ok) throw new Error("expected schema-valid staged input");

        await expect(capability.execute(prepared.input, { host })).resolves.toMatchObject({
            status: "unavailable",
            unavailableReason: "pagelet_stage_first_rejected",
        });
        expect(instance.snapshot("NO_INSIGHT")).toMatchObject({
            drafts: [],
            diagnostics: {
                stageControlCalled: true,
                stageValidationSubreason: "unsupported-source",
            },
        });
        expect(instance.hasStagedInsight()).toBe(false);
    });

    it("caps stage validation by the same outer Tool deadline geometry", async () => {
        let validationControl: { runEpoch: string; absoluteDeadlineMs: number } | undefined;
        const { instance } = coordinator({
            now: () => 1_000,
            validateStaged: async (_input, _signal, control) => {
                validationControl = control;
                return {
                    accepted: true,
                    verifiedSourceIds: ["notes/anchor.md", "notes/lead.md"],
                    verifiedLeadSourceIds: ["notes/lead.md"],
                };
            },
        });

        const capability = instance.getStageCapability();
        const prepared = capability.prepareAndValidate?.(stageInput(false), { userInput: "" });
        if (!prepared?.ok) throw new Error("expected schema-valid staged input");

        await expect(capability.execute(prepared.input, {
            host,
            outerToolDeadlineAt: 9_000,
        })).resolves.toMatchObject({ status: "ok" });
        expect(validationControl).toEqual({
            runEpoch: "pagelet-test-run",
            absoluteDeadlineMs: 8_250,
        });
    });

    it("classifies a pre-aborted stage as aborted without validating or consuming recovery", async () => {
        const parent = new AbortController();
        parent.abort();
        const validateStaged = jest.fn(async () => ({ accepted: true }));
        const { instance, executeRelaxed } = coordinator({ validateStaged });

        const capability = instance.getStageCapability();
        const prepared = capability.prepareAndValidate?.(stageInput(), { userInput: "" });
        if (!prepared?.ok) throw new Error("expected schema-valid staged input");

        await expect(capability.execute(prepared.input, {
            host,
            signal: parent.signal,
            outerToolDeadlineAt: 9_000,
        })).rejects.toMatchObject({ name: "AbortError" });
        expect(validateStaged).not.toHaveBeenCalled();
        expect(executeRelaxed).not.toHaveBeenCalled();
        expect(instance.hasStagedInsight()).toBe(false);
        expect(instance.snapshot("NO_INSIGHT")).toMatchObject({
            drafts: [],
            diagnostics: {
                stageValidationSubreason: "aborted",
                relaxedTokenConsumed: false,
            },
        });
    });

    it.each(["resolve", "reject"] as const)(
        "keeps an internal stage deadline distinct and discards its late %s",
        async (lateOutcome) => {
            jest.useFakeTimers();
            try {
                jest.setSystemTime(1_000);
                const started = deferred<void>();
                const late = deferred<{
                    accepted: boolean;
                    verifiedSourceIds: string[];
                    verifiedLeadSourceIds: string[];
                }>();
                let childSignal: AbortSignal | undefined;
                const { instance, executeRelaxed } = coordinator({
                    now: Date.now,
                    validateStaged: async (_input, signal) => {
                        childSignal = signal;
                        started.resolve(undefined);
                        return await late.promise;
                    },
                });

                const capability = instance.getStageCapability();
                const prepared = capability.prepareAndValidate?.(stageInput(), { userInput: "" });
                if (!prepared?.ok) throw new Error("expected schema-valid staged input");

                const execution = capability.execute(prepared.input, {
                    host,
                    outerToolDeadlineAt: 9_000,
                });
                await started.promise;
                await jest.advanceTimersByTimeAsync(7_250);
                await expect(execution).resolves.toMatchObject({
                    status: "unavailable",
                    unavailableReason: "pagelet_stage_validation_deadline",
                });
                expect(childSignal?.aborted).toBe(true);
                expect(instance.hasStagedInsight()).toBe(false);
                expect(executeRelaxed).not.toHaveBeenCalled();
                expect(instance.snapshot("NO_INSIGHT")).toMatchObject({
                    drafts: [],
                    diagnostics: {
                        stageValidationSubreason: "deadline",
                        relaxedTokenConsumed: false,
                    },
                });

                if (lateOutcome === "resolve") {
                    late.resolve({
                        accepted: true,
                        verifiedSourceIds: ["notes/anchor.md", "notes/lead.md"],
                        verifiedLeadSourceIds: ["notes/lead.md"],
                    });
                } else {
                    late.reject(new Error("late stage validation failure"));
                }
                await Promise.resolve();
                await Promise.resolve();
                expect(instance.hasStagedInsight()).toBe(false);
                expect(executeRelaxed).not.toHaveBeenCalled();
                expect(instance.snapshot("NO_INSIGHT")).toMatchObject({
                    drafts: [],
                    diagnostics: {
                        stageValidationSubreason: "deadline",
                        relaxedTokenConsumed: false,
                    },
                });
            } finally {
                jest.useRealTimers();
            }
        },
    );

    it.each(["resolve", "reject"] as const)(
        "lets parent abort win the stage deadline race and discards its late %s",
        async (lateOutcome) => {
            jest.useFakeTimers();
            try {
                jest.setSystemTime(1_000);
                const parent = new AbortController();
                const started = deferred<void>();
                const late = deferred<{
                    accepted: boolean;
                    verifiedSourceIds: string[];
                    verifiedLeadSourceIds: string[];
                }>();
                const { instance, executeRelaxed } = coordinator({
                    now: Date.now,
                    validateStaged: async (_input, signal) => {
                        signal.addEventListener("abort", () => parent.abort(), { once: true });
                        started.resolve(undefined);
                        return await late.promise;
                    },
                });

                const capability = instance.getStageCapability();
                const prepared = capability.prepareAndValidate?.(stageInput(), { userInput: "" });
                if (!prepared?.ok) throw new Error("expected schema-valid staged input");

                const execution = capability.execute(prepared.input, {
                    host,
                    signal: parent.signal,
                    outerToolDeadlineAt: 9_000,
                });
                const rejection = expect(execution).rejects.toMatchObject({ name: "AbortError" });
                await started.promise;
                await jest.advanceTimersByTimeAsync(7_250);
                await rejection;
                expect(parent.signal.aborted).toBe(true);
                expect(instance.hasStagedInsight()).toBe(false);
                expect(executeRelaxed).not.toHaveBeenCalled();
                expect(instance.snapshot("NO_INSIGHT")).toMatchObject({
                    drafts: [],
                    diagnostics: {
                        stageValidationSubreason: "aborted",
                        relaxedTokenConsumed: false,
                    },
                });

                if (lateOutcome === "resolve") {
                    late.resolve({
                        accepted: true,
                        verifiedSourceIds: ["notes/anchor.md", "notes/lead.md"],
                        verifiedLeadSourceIds: ["notes/lead.md"],
                    });
                } else {
                    late.reject(new Error("late stage validation failure"));
                }
                await Promise.resolve();
                await Promise.resolve();
                expect(instance.hasStagedInsight()).toBe(false);
                expect(executeRelaxed).not.toHaveBeenCalled();
                expect(instance.snapshot("NO_INSIGHT")).toMatchObject({
                    drafts: [],
                    diagnostics: {
                        stageValidationSubreason: "aborted",
                        relaxedTokenConsumed: false,
                    },
                });
            } finally {
                jest.useRealTimers();
            }
        },
    );

    it("keeps a previously consumed one-shot token monotonic across pre-aborted staging", async () => {
        const parent = new AbortController();
        const { instance, executeRelaxed } = coordinator({
            standard: result("none_relevant", []),
        });
        await executeBoundSearch(instance, "consume-first-insight-token-call");
        expect(executeRelaxed).toHaveBeenCalledTimes(1);
        expect(instance.snapshot("NO_INSIGHT").diagnostics.relaxedTokenConsumed).toBe(true);

        const capability = instance.getStageCapability();
        const prepared = capability.prepareAndValidate?.(stageInput(), { userInput: "" });
        if (!prepared?.ok) throw new Error("expected schema-valid staged input");
        parent.abort();

        await expect(capability.execute(prepared.input, {
            host,
            signal: parent.signal,
        })).rejects.toMatchObject({ name: "AbortError" });
        expect(instance.hasStagedInsight()).toBe(false);
        expect(instance.snapshot("NO_INSIGHT")).toMatchObject({
            drafts: [],
            diagnostics: {
                stageValidationSubreason: "aborted",
                relaxedTokenConsumed: true,
            },
        });

        await executeBoundSearch(instance, "after-pre-aborted-stage-call");
        expect(executeRelaxed).toHaveBeenCalledTimes(1);
        expect(instance.snapshot("NO_INSIGHT").diagnostics.relaxedTokenConsumed).toBe(true);
    });

    it.each(["resolve", "reject"] as const)(
        "settles standard search before the outer Tool deadline and discards its late %s",
        async (lateOutcome) => {
            jest.useFakeTimers();
            try {
                jest.setSystemTime(1_000);
                const events: RetrievalDiagnosticEventInput[] = [];
                const started = deferred<void>();
                const late = deferred<MemorySearchResult>();
                let childControl: { runEpoch: string; absoluteDeadlineMs: number } | undefined;
                const { instance, executeRelaxed } = coordinator({
                    now: Date.now,
                    executeStandard: async (_query, _context, control) => {
                        childControl = control;
                        started.resolve(undefined);
                        return await late.promise;
                    },
                    recordDiagnostic: (event) => events.push(event),
                });

                let settled = false;
                const execution = executeBoundSearch(
                    instance,
                    "outer-deadline-standard-call",
                    "model query",
                    { outerToolDeadlineAt: 9_000 },
                );
                void execution.catch(() => undefined).finally(() => { settled = true; });
                await started.promise;
                expect(childControl).toEqual({
                    runEpoch: "pagelet-test-run",
                    absoluteDeadlineMs: 8_250,
                });
                expect(events).toContainEqual(expect.objectContaining({
                    phase: "recovery_standard",
                    outcome: "started",
                    metrics: expect.objectContaining({ remainingMs: 7_250 }),
                }));

                await jest.advanceTimersByTimeAsync(7_249);
                expect(settled).toBe(false);
                await jest.advanceTimersByTimeAsync(1);
                await expect(execution).rejects.toMatchObject({ name: "TimeoutError" });
                expect(events.filter((event) => (
                    event.phase === "recovery_standard" && event.outcome !== "started"
                ))).toEqual([
                    expect.objectContaining({
                        outcome: "deadline",
                        reason: "attempt_deadline",
                    }),
                ]);

                if (lateOutcome === "resolve") {
                    late.resolve(result("partially_relevant", ["notes/lead.md"]));
                } else {
                    late.reject(new Error("late standard failure"));
                }
                await Promise.resolve();
                await Promise.resolve();
                expect(events.filter((event) => (
                    event.phase === "recovery_standard" && event.outcome !== "started"
                ))).toHaveLength(1);
                expect(instance.snapshot("NO_INSIGHT").drafts).toEqual([]);
                if (lateOutcome === "resolve") {

                    const capability = instance.getStageCapability();
                    const prepared = capability.prepareAndValidate?.(
                        stageInput(),
                        { userInput: "" },
                    );
                    if (!prepared?.ok) throw new Error("expected schema-valid staged input");
                    await expect(capability.execute(prepared.input, { host }))
                        .resolves.toMatchObject({
                            status: "ok",
                            observation: { status: "staged" },
                        });
                    expect(executeRelaxed).not.toHaveBeenCalled();
                    expect(instance.snapshot("NO_INSIGHT").diagnostics.relaxedTokenConsumed)
                        .toBe(false);
                }
            } finally {
                jest.useRealTimers();
            }
        },
    );

    it.each(["resolve", "reject"] as const)(
        "classifies parent abort separately and discards the standard child's late %s",
        async (lateOutcome) => {
            const events: RetrievalDiagnosticEventInput[] = [];
            const parent = new AbortController();
            const started = deferred<void>();
            const late = deferred<MemorySearchResult>();
            const { instance } = coordinator({
                executeStandard: async () => {
                    started.resolve(undefined);
                    return await late.promise;
                },
                recordDiagnostic: (event) => events.push(event),
            });
            const execution = executeBoundSearch(
                instance,
                "parent-abort-standard-call",
                "model query",
                { signal: parent.signal, outerToolDeadlineAt: 31_000 },
            );
            await started.promise;

            parent.abort();
            await expect(execution).rejects.toMatchObject({ name: "AbortError" });
            expect(events.filter((event) => (
                event.phase === "recovery_standard" && event.outcome !== "started"
            ))).toEqual([
                expect.objectContaining({
                    outcome: "aborted",
                    reason: "attempt_aborted",
                }),
            ]);

            if (lateOutcome === "resolve") {
                late.resolve(result("relevant", ["notes/late.md"]));
            } else {
                late.reject(new Error("late standard failure"));
            }
            await Promise.resolve();
            await Promise.resolve();
            expect(events.filter((event) => (
                event.phase === "recovery_standard" && event.outcome !== "started"
            ))).toHaveLength(1);
            expect(instance.snapshot("NO_INSIGHT").drafts).toEqual([]);
        },
    );

    it("keeps behavior unchanged when diagnostics are absent or throw", async () => {
        for (const recordDiagnostic of [
            undefined,
            () => { throw new Error("diagnostic sink failure"); },
        ]) {
            const { instance } = coordinator({
                standard: result("relevant", ["notes/enough.md"]),
                recordDiagnostic,
            });
            await expect(executeBoundSearch(instance, "no-diagnostic-call"))
                .resolves.toMatchObject({ sources: [{ path: "notes/enough.md" }] });
        }
    });

    it("omits unavailable and deadline counts while preserving a completed valid-none zero", async () => {
        const unavailableEvents: RetrievalDiagnosticEventInput[] = [];
        const unavailable = coordinator({
            standard: unavailableResult(),
            recordDiagnostic: (event) => unavailableEvents.push(event),
        });
        await executeBoundSearch(unavailable.instance, "unavailable-standard-call");
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

        let clock = 0;
        const deadlineEvents: RetrievalDiagnosticEventInput[] = [];
        const deadline = coordinator({
            standard: result("none_relevant", []),
            maxWallClockMs: 5_000,
            finalizationReserveMs: 1_000,
            now: () => clock,
            relaxed: async () => {
                clock = 4_000;
                return result("relevant", ["notes/late.md"]);
            },
            recordDiagnostic: (event) => deadlineEvents.push(event),
        });
        await executeBoundSearch(deadline.instance, "deadline-relaxed-call");
        expect(deadlineEvents).toContainEqual(expect.objectContaining({
            phase: "recovery_standard",
            outcome: "completed",
            reason: "semantic_none",
            metrics: expect.objectContaining({ documentCount: 0 }),
        }));
        const deadlineTerminal = deadlineEvents.find((event) => (
            event.phase === "recovery_relaxed" && event.outcome === "deadline"
        ));
        expect(deadlineTerminal).toMatchObject({ reason: "attempt_deadline" });
        expect(deadlineTerminal?.metrics).not.toHaveProperty("documentCount");

        const legacyEvents: RetrievalDiagnosticEventInput[] = [];
        const legacyNone = result("none_relevant", []);
        delete legacyNone.memoryEvidenceState;
        const legacy = coordinator({
            enabled: false,
            standard: legacyNone,
            recordDiagnostic: (event) => legacyEvents.push(event),
        });
        await executeBoundSearch(legacy.instance, "legacy-none-call");
        const legacyTerminal = legacyEvents.find((event) => (
            event.phase === "recovery_standard" && event.outcome !== "started"
        ));
        expect(legacyTerminal).toMatchObject({ outcome: "completed" });
        expect(legacyTerminal).not.toHaveProperty("reason");
        expect(legacyTerminal?.metrics).not.toHaveProperty("documentCount");
    });

    it("automatically spends one token for eligible deterministic none and merges relaxed evidence", async () => {
        const { instance, executeRelaxed } = coordinator({
            standard: result("none_relevant", []),
        });
        const search = await executeBoundSearch(instance, "memory-call-1");

        expect(executeRelaxed).toHaveBeenCalledTimes(1);
        expect(search.sources.map((source) => source.path)).toEqual(["notes/deep.md"]);
        expect(instance.snapshot("NO_INSIGHT").diagnostics).toMatchObject({
            relaxedTokenConsumed: true,
            relaxedGoal: "first_insight",
        });

        await executeBoundSearch(instance, "memory-call-2", "another query");
        expect(executeRelaxed).toHaveBeenCalledTimes(1);
    });

    it("uses EC-03 candidate ordering and relaxed canonical-path replacement before allocation", () => {
        const standard = result("partially_relevant", ["notes/lead.md", "notes/standard-b.md"]);
        const relaxed = result("relevant", ["notes/deep.md", "notes/lead.md"]);
        const updatedLead = relaxed.candidates?.find((item) => item.path === "notes/lead.md");
        if (!updatedLead) throw new Error("expected relaxed lead candidate");
        updatedLead.excerpt = "relaxed-current-lead";
        updatedLead.documents[0] = document("notes/lead.md", "relaxed-current-lead");

        const validMerged = mergeMemorySearchResults(standard, relaxed);
        expect(validMerged.candidates?.map((item) => item.path)).toEqual([
            "notes/lead.md",
            "notes/deep.md",
            "notes/standard-b.md",
        ]);
        expect(validMerged.candidates?.[0]?.excerpt).toBe("relaxed-current-lead");
        expect(validMerged.documents.map((item) => item.source.path)).toEqual([
            "notes/lead.md",
            "notes/deep.md",
            "notes/standard-b.md",
        ]);

        const failOpenRelaxed = result("relevant", ["notes/deep.md", "notes/lead.md"]);
        const failOpenLead = failOpenRelaxed.candidates?.find((item) => item.path === "notes/lead.md");
        if (!failOpenLead) throw new Error("expected fail-open lead candidate");
        failOpenLead.excerpt = "fail-open-current-lead";
        failOpenLead.documents[0] = document("notes/lead.md", "fail-open-current-lead");
        failOpenRelaxed.rerankOutcome = {
            kind: "fail_open",
            verdict: "relevant",
            needsMoreEvidence: false,
            reason: "provider_error",
            candidates: failOpenRelaxed.candidates ?? [],
            origin: "fail_open",
            modelCalled: true,
        };
        const failOpenMerged = mergeMemorySearchResults(standard, failOpenRelaxed);
        expect(failOpenMerged.candidates?.map((item) => item.path)).toEqual([
            "notes/lead.md",
            "notes/standard-b.md",
            "notes/deep.md",
        ]);
        expect(failOpenMerged.candidates?.[0]?.excerpt).toBe("fail-open-current-lead");
    });

    it("consumes the token on relaxed failure and ignores attempts inside the finalization margin", async () => {
        const failing = coordinator({
            relaxed: async () => { throw new Error("provider failed"); },
        });
        await executeBoundSearch(failing.instance, "failing-call");
        const capability = failing.instance.getStageCapability();
        const prepared = capability.prepareAndValidate?.(stageInput(), { userInput: "" });
        if (!prepared?.ok) throw new Error("expected valid staged input");
        await expect(capability.execute(prepared.input, { host })).resolves.toMatchObject({
            status: "ok",
            observation: { status: "staged" },
        });
        expect(failing.instance.snapshot("NO_INSIGHT").diagnostics.relaxedTokenConsumed).toBe(true);

        const late = coordinator({
            maxWallClockMs: 4_000,
            finalizationReserveMs: 800,
            now: () => 1_000,
        });
        await executeBoundSearch(late.instance, "late-preflight-call");
        expect(late.executeRelaxed).not.toHaveBeenCalled();

        let clock = 0;
        const lateResult = coordinator({
            standard: result("none_relevant", []),
            maxWallClockMs: 5_000,
            finalizationReserveMs: 1_000,
            now: () => clock,
            relaxed: async () => {
                clock = 4_000;
                return result("relevant", ["notes/too-late.md"]);
            },
        });
        const ignored = await executeBoundSearch(lateResult.instance, "late-result-call");
        expect(lateResult.executeRelaxed).toHaveBeenCalledTimes(1);
        expect(ignored.sources).toEqual([]);
        expect(lateResult.instance.snapshot("NO_INSIGHT").diagnostics.relaxedTokenConsumed).toBe(true);
    });

    it("lets standard Memory finish but prevents Pagelet retry after live disable", async () => {
        let enabled = true;
        let policyEpoch = "policy-1";
        const listeners = new Set<() => void | Promise<void>>();
        const standard = deferred<MemorySearchResult>();
        const standardStarted = deferred<void>();
        let standardSignal: AbortSignal | undefined;
        const live = coordinator({
            policyEpoch,
            isEnabled: () => enabled,
            getPolicyEpoch: () => policyEpoch,
            onPolicyChanged: (listener) => {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
            executeStandard: async (_query, context) => {
                standardSignal = context.signal;
                standardStarted.resolve(undefined);
                return await standard.promise;
            },
        });

        const pending = executeBoundSearch(live.instance, "live-standard-call");
        await standardStarted.promise;
        enabled = false;
        policyEpoch = "policy-2";
        await Promise.all([...listeners].map((listener) => listener()));
        expect(standardSignal?.aborted).toBe(false);
        expect(live.instance.hasStagedInsight()).toBe(false);

        standard.resolve(result("none_relevant", []));
        await expect(pending).resolves.toMatchObject({ sources: [] });
        expect(live.executeRelaxed).not.toHaveBeenCalled();
        expect(() => live.instance.reserveStageControl(stageInput())).not.toThrow();
    });

    it("aborts in-flight Pagelet recovery and discards a late relaxed result after live disable", async () => {
        let enabled = true;
        let policyEpoch = "policy-1";
        const listeners = new Set<() => void | Promise<void>>();
        const relaxed = deferred<MemorySearchResult>();
        const relaxedStarted = deferred<void>();
        let relaxedSignal: AbortSignal | undefined;
        const live = coordinator({
            policyEpoch,
            isEnabled: () => enabled,
            getPolicyEpoch: () => policyEpoch,
            onPolicyChanged: (listener) => {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
            standard: result("none_relevant", []),
            relaxed: async (_seed, context) => {
                relaxedSignal = context.signal;
                relaxedStarted.resolve(undefined);
                return await relaxed.promise;
            },
        });

        const pending = executeBoundSearch(live.instance, "live-relaxed-call");
        await relaxedStarted.promise;
        enabled = false;
        policyEpoch = "policy-2";
        await Promise.all([...listeners].map((listener) => listener()));
        expect(relaxedSignal?.aborted).toBe(true);

        const completed = await pending;
        expect(completed.sources).toEqual([]);
        expect(live.instance.snapshot("NO_INSIGHT").drafts).toEqual([]);
        relaxed.resolve(result("relevant", ["notes/late.md"]));
        await Promise.resolve();
        expect(completed.sources).toEqual([]);
        expect(live.instance.snapshot("NO_INSIGHT").drafts).toEqual([]);
        expect(listeners.size).toBe(0);
    });

    it("settles on teardown even when a recovery child ignores abort and discards its late result", async () => {
        let childSignal: AbortSignal | undefined;
        let resolveLate: ((value: MemorySearchResult) => void) | undefined;
        let markStarted: (() => void) | undefined;
        const started = new Promise<void>((resolve) => { markStarted = resolve; });
        const late = new Promise<MemorySearchResult>((resolve) => { resolveLate = resolve; });
        const { instance } = coordinator({
            standard: result("none_relevant", []),
            relaxed: async (_seed, context) => {
                childSignal = context.signal;
                markStarted?.();
                return await late;
            },
        });

        const pending = executeBoundSearch(instance, "teardown-race-call");
        await started;
        instance.clear();
        await expect(pending).rejects.toMatchObject({ name: "AbortError" });
        expect(childSignal?.aborted).toBe(true);
        expect(instance.snapshot("NO_INSIGHT").drafts).toEqual([]);

        resolveLate?.(result("relevant", ["notes/late.md"]));
        await Promise.resolve();
        expect(instance.snapshot("NO_INSIGHT").drafts).toEqual([]);
    });

    it.each(["resolve", "reject"] as const)(
        "aborts standard search on teardown and discards its late %s",
        async (lateOutcome) => {
            const started = deferred<void>();
            const late = deferred<MemorySearchResult>();
            let childSignal: AbortSignal | undefined;
            let childControl: { runEpoch: string; absoluteDeadlineMs: number } | undefined;
            const { instance } = coordinator({
                executeStandard: async (_query, context, control) => {
                    childSignal = context.signal;
                    childControl = control;
                    started.resolve(undefined);
                    return await late.promise;
                },
            });

            const pending = executeBoundSearch(instance, "late-standard-call");
            await started.promise;
            instance.clear();

            await expect(pending).rejects.toMatchObject({ name: "AbortError" });
            expect(childSignal?.aborted).toBe(true);
            expect(childControl).toEqual({
                runEpoch: "pagelet-test-run",
                absoluteDeadlineMs: 30_250,
            });
            expect(instance.snapshot("NO_INSIGHT")).toMatchObject({
                drafts: [],
                diagnostics: {
                    stageControlCalled: false,
                    relaxedTokenConsumed: false,
                },
            });

            if (lateOutcome === "resolve") {
                late.resolve(result("partially_relevant", ["notes/late-partial.md"]));
            } else {
                late.reject(new Error("late standard failure"));
            }
            await Promise.resolve();
            await Promise.resolve();
            expect(instance.snapshot("NO_INSIGHT").drafts).toEqual([]);
        },
    );

    it.each(["resolve", "reject"] as const)(
        "aborts staged validation on teardown and discards its late %s",
        async (lateOutcome) => {
            const started = deferred<void>();
            const late = deferred<{
                accepted: boolean;
                verifiedSourceIds: string[];
                verifiedLeadSourceIds: string[];
            }>();
            let childSignal: AbortSignal | undefined;
            let childControl: { runEpoch: string; absoluteDeadlineMs: number } | undefined;
            const { instance } = coordinator({
                validateStaged: async (_input, signal, control) => {
                    childSignal = signal;
                    childControl = control;
                    started.resolve(undefined);
                    return await late.promise;
                },
            });
            const capability = instance.getStageCapability();
            const prepared = capability.prepareAndValidate?.(stageInput(false), { userInput: "" });
            if (!prepared?.ok) throw new Error("expected valid staged input");

            const pending = capability.execute(prepared.input, { host });
            await started.promise;
            instance.clear();

            await expect(pending).resolves.toMatchObject({ status: "unavailable" });
            expect(childSignal?.aborted).toBe(true);
            expect(childControl).toEqual({
                runEpoch: "pagelet-test-run",
                absoluteDeadlineMs: 30_250,
            });
            expect(instance.snapshot("NO_INSIGHT")).toMatchObject({
                drafts: [],
                diagnostics: { stageControlCalled: false },
            });

            if (lateOutcome === "resolve") {
                late.resolve({
                    accepted: true,
                    verifiedSourceIds: ["notes/anchor.md", "notes/lead.md"],
                    verifiedLeadSourceIds: ["notes/lead.md"],
                });
            } else {
                late.reject(new Error("late staged validation failure"));
            }
            await Promise.resolve();
            await Promise.resolve();
            expect(instance.snapshot("NO_INSIGHT").drafts).toEqual([]);
        },
    );
});
