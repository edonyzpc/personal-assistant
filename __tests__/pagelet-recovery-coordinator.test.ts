import { describe, expect, it, jest } from "@jest/globals";

import type { AiServiceHost } from "../src/ai-services/AiServiceHost";
import type {
    MemoryCandidate,
    MemorySearchDocument,
    MemorySearchResult,
    PaAgentMessage,
} from "../src/ai-services/chat-types";
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

function stageInput(requestRelaxedRecovery = true) {
    return {
        insightMarkdown: [
            "## First verified risk",
            "`notes/anchor.md` conflicts with `notes/lead.md`, which increases release risk.",
        ].join("\n"),
        sourceIds: ["notes/anchor.md", "notes/lead.md"],
        unresolvedLead: {
            leadKey: "deployment rollback evidence",
            supportingSourceIds: ["notes/lead.md"],
            requestRelaxedRecovery,
        },
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
            verifiedLeadSourceIds: [...input.unresolvedLead.supportingSourceIds],
        })),
    });
    return { instance, executeRelaxed };
}

function executeBoundSearch(
    instance: PageletRecoveryCoordinator,
    toolCallId: string,
    query = "model query",
    context: {
        signal?: AbortSignal;
        outerToolDeadlineAt?: number;
    } = {},
): Promise<MemorySearchResult> {
    return instance.withMemorySearchToolCall(
        toolCallId,
        () => instance.executeMemorySearch(query, { host, ...context }),
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
    it("keeps the stage schema explicit about one terminal insight and disjoint lead evidence", () => {
        const { instance } = coordinator();
        const capability = instance.getStageCapability();
        const definition = capability.toRegistryDefinition();
        const schema = capability.toProviderSchema().function.parameters as unknown as {
            required?: string[];
            properties: {
                insightMarkdown: { description?: string };
                sourceIds: {
                    description?: string;
                    minItems?: number;
                    maxItems?: number;
                    uniqueItems?: boolean;
                };
                unresolvedLead: {
                    properties: {
                        supportingSourceIds: {
                            description?: string;
                            minItems?: number;
                            maxItems?: number;
                            uniqueItems?: boolean;
                        };
                        requestRelaxedRecovery: { description?: string };
                    };
                };
            };
        };

        expect(definition.description).toContain("terminal response may contain at most one insight");
        expect(definition.description).toContain("stage only the first");
        expect(schema.required).toEqual(["insightMarkdown", "sourceIds", "unresolvedLead"]);
        expect(schema.properties.insightMarkdown.description).toContain("Never bundle");
        expect(schema.properties.sourceIds.description).toContain("directly staged first insight");
        expect(schema.properties.sourceIds.description).toContain('"notes/anchor.md"');
        expect(schema.properties.sourceIds).toMatchObject({
            minItems: 2,
            maxItems: 16,
            uniqueItems: true,
        });
        expect(schema.properties.unresolvedLead.properties.supportingSourceIds.description)
            .toContain("may be disjoint");
        expect(schema.properties.unresolvedLead.properties.supportingSourceIds.description)
            .toContain("non-anchor");
        expect(schema.properties.unresolvedLead.properties.supportingSourceIds)
            .toMatchObject({
                minItems: 1,
                maxItems: 16,
                uniqueItems: true,
            });
        expect(schema.properties.unresolvedLead.properties.supportingSourceIds.description)
            .toContain("metadata or search-only paths are invalid");
        expect(schema.properties.unresolvedLead.properties.requestRelaxedRecovery.description)
            .toContain("False when current content evidence already completes the second insight");

        const disjoint = stageInput(false);
        disjoint.unresolvedLead.supportingSourceIds = ["notes/distinct-lead.md"];
        expect(capability.prepareAndValidate?.(disjoint, { userInput: "" }))
            .toMatchObject({ ok: true });

        const missingAnchor = stageInput(false);
        missingAnchor.sourceIds = ["notes/lead.md", "notes/other.md"];
        expect(capability.prepareAndValidate?.(missingAnchor, { userInput: "" }))
            .toMatchObject({
                ok: false,
                error: expect.objectContaining({
                    message: expect.stringContaining("must include the frozen anchor path"),
                }),
            });

        const anchorAsLead = stageInput(false);
        anchorAsLead.unresolvedLead.supportingSourceIds = ["notes/anchor.md"];
        expect(capability.prepareAndValidate?.(anchorAsLead, { userInput: "" }))
            .toMatchObject({
                ok: false,
                error: expect.objectContaining({
                    message: expect.stringContaining("only non-anchor paths"),
                }),
            });

        expect(capability.prepareAndValidate?.({
            unresolvedLead: stageInput(false).unresolvedLead,
        }, { userInput: "" })).toMatchObject({
            ok: false,
            error: expect.objectContaining({
                message: expect.stringContaining("insightMarkdown must be a non-empty string"),
            }),
        });
    });

    it("keeps deterministic stage prevalidation pure and does not consume the one-shot", async () => {
        let bindingValid = false;
        const prevalidateStaged = jest.fn(() => {
            if (!bindingValid) throw new Error("stage source binding is invalid");
        });
        const { instance } = coordinator({ prevalidateStaged });
        const capability = instance.getStageCapability();

        expect(capability.prepareAndValidate?.(stageInput(false), { userInput: "" }))
            .toMatchObject({
                ok: false,
                error: expect.objectContaining({ message: "stage source binding is invalid" }),
            });
        expect(instance.snapshot("NO_INSIGHT").diagnostics.stageControlCalled).toBe(false);

        bindingValid = true;
        const corrected = capability.prepareAndValidate?.(stageInput(false), { userInput: "" });
        if (!corrected?.ok) throw new Error("expected corrected deterministic binding");
        await expect(capability.execute(corrected.input, { host })).resolves.toMatchObject({
            status: "ok",
            observation: { status: "staged" },
        });
        expect(prevalidateStaged).toHaveBeenCalledTimes(3);
        expect(instance.snapshot("NO_INSIGHT").diagnostics.stageControlCalled).toBe(true);
    });

    it("uses the Host pending first while preserving the model-owned unresolved lead", async () => {
        const validatedInputs: ReturnType<typeof stageInput>[] = [];
        const pendingFirst = {
            body: [
                "## Host-owned first",
                "`notes/anchor.md` conflicts with `notes/lead.md`, creating release risk.",
            ].join("\n"),
            sourceIds: ["notes/anchor.md", "notes/lead.md"],
        };
        const { instance } = coordinator({
            prevalidateStaged: (input) => validatedInputs.push(input),
            validateStaged: async (input) => ({
                accepted: true,
                verifiedSourceIds: [...input.sourceIds],
                verifiedLeadSourceIds: [...input.unresolvedLead.supportingSourceIds],
            }),
        });
        instance.bindPendingFirstInsight(pendingFirst);
        const modelEcho = stageInput(false);
        modelEcho.insightMarkdown = "## Provider rewrite\n`notes/anchor.md` only names a path.";
        modelEcho.sourceIds = ["notes/anchor.md", "notes/other.md"];
        modelEcho.unresolvedLead.leadKey = "independent rollback readiness";

        const capability = instance.getStageCapability();
        const prepared = capability.prepareAndValidate?.(modelEcho, { userInput: "" });
        if (!prepared?.ok) throw new Error("expected Host-bound staged input");
        expect(prepared.input).toEqual({
            insightMarkdown: pendingFirst.body,
            sourceIds: pendingFirst.sourceIds,
            unresolvedLead: modelEcho.unresolvedLead,
        });
        await expect(capability.execute(prepared.input, { host })).resolves.toMatchObject({
            status: "ok",
            observation: { status: "staged" },
        });
        expect(validatedInputs).toHaveLength(2);
        expect(instance.hasPendingFirstInsight()).toBe(false);
        expect(instance.snapshot("NO_INSIGHT").drafts).toEqual([{
            body: pendingFirst.body,
            origin: "staged",
            declaredSourceIds: pendingFirst.sourceIds,
        }]);
    });

    it.each([
        ["omitted", {}],
        ["empty", { insightMarkdown: "", sourceIds: [] }],
        ["wrong-type", { insightMarkdown: 42, sourceIds: "not-an-array" }],
        ["over-limit", {
            insightMarkdown: "x".repeat(16_001),
            sourceIds: Array.from({ length: 17 }, (_, index) => `notes/echo-${index}.md`),
        }],
    ])("ignores %s Provider echo when a Host pending first exists", async (_label, echo) => {
        const pendingFirst = {
            body: stageInput(false).insightMarkdown,
            sourceIds: stageInput(false).sourceIds,
        };
        const validatedInputs: ReturnType<typeof stageInput>[] = [];
        const { instance } = coordinator({
            prevalidateStaged: (input) => validatedInputs.push(input),
        });
        const capability = instance.getStageCapability();
        const cachedSchema = capability.toProviderSchema().function.parameters;
        expect(cachedSchema.required).toEqual([
            "insightMarkdown",
            "sourceIds",
            "unresolvedLead",
        ]);

        instance.bindPendingFirstInsight(pendingFirst);
        expect(cachedSchema.required).toEqual(["unresolvedLead"]);
        expect(capability.toRegistryDefinition().inputSchema.required)
            .toEqual(["unresolvedLead"]);

        const raw = {
            ...echo,
            unresolvedLead: {
                ...stageInput(false).unresolvedLead,
                leadKey: "independent rollback readiness",
            },
        };
        const prepared = capability.prepareAndValidate?.(raw, { userInput: "" });
        if (!prepared?.ok) throw new Error("expected non-authoritative echo to be ignored");
        expect(prepared.input).toEqual({
            insightMarkdown: pendingFirst.body,
            sourceIds: pendingFirst.sourceIds,
            unresolvedLead: raw.unresolvedLead,
        });

        await expect(capability.execute(prepared.input, { host })).resolves.toMatchObject({
            status: "ok",
            observation: { status: "staged" },
        });
        expect(validatedInputs).toHaveLength(2);
        expect(instance.snapshot("NO_INSIGHT").drafts).toEqual([{
            body: pendingFirst.body,
            origin: "staged",
            declaredSourceIds: pendingFirst.sourceIds,
        }]);
    });

    it("returns a stable content-free reason when asynchronous stage validation rejects", async () => {
        const { instance } = coordinator({
            validateStaged: async () => ({
                accepted: false,
                rejection: "first",
                subreason: "unsupported-source",
            }),
        });
        instance.bindPendingFirstInsight({
            body: stageInput(false).insightMarkdown,
            sourceIds: stageInput(false).sourceIds,
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
        expect(instance.hasPendingFirstInsight()).toBe(true);
    });

    it("distinguishes the stage validation deadline without running validation", async () => {
        const validateStaged = jest.fn(async () => ({ accepted: true }));
        const { instance } = coordinator({
            now: () => 148_000,
            validateStaged,
        });
        instance.bindPendingFirstInsight({
            body: stageInput(false).insightMarkdown,
            sourceIds: stageInput(false).sourceIds,
        });
        const capability = instance.getStageCapability();
        const prepared = capability.prepareAndValidate?.(stageInput(false), { userInput: "" });
        if (!prepared?.ok) throw new Error("expected schema-valid staged input");

        await expect(capability.execute(prepared.input, { host })).resolves.toMatchObject({
            status: "unavailable",
            unavailableReason: "pagelet_stage_validation_deadline",
        });
        expect(validateStaged).not.toHaveBeenCalled();
        expect(instance.hasPendingFirstInsight()).toBe(true);
        expect(instance.snapshot("NO_INSIGHT").diagnostics).toMatchObject({
            stageValidationSubreason: "deadline",
        });
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
        instance.bindPendingFirstInsight({
            body: stageInput(false).insightMarkdown,
            sourceIds: stageInput(false).sourceIds,
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
        instance.bindPendingFirstInsight({
            body: stageInput().insightMarkdown,
            sourceIds: stageInput().sourceIds,
        });
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
        expect(instance.hasPendingFirstInsight()).toBe(false);
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
                instance.bindPendingFirstInsight({
                    body: stageInput().insightMarkdown,
                    sourceIds: stageInput().sourceIds,
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
                expect(instance.hasPendingFirstInsight()).toBe(true);
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
                expect(instance.hasPendingFirstInsight()).toBe(true);
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
                instance.bindPendingFirstInsight({
                    body: stageInput().insightMarkdown,
                    sourceIds: stageInput().sourceIds,
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
                expect(instance.hasPendingFirstInsight()).toBe(false);
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
                expect(instance.hasPendingFirstInsight()).toBe(false);
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

    it.each(["resolve", "reject"] as const)(
        "fails closed when parent aborts staged-episode revalidation and discards its late %s",
        async (lateOutcome) => {
            const parent = new AbortController();
            const started = deferred<void>();
            const late = deferred<MemorySearchResult>();
            const { instance, executeRelaxed } = coordinator({
                revalidate: async () => {
                    started.resolve(undefined);
                    return await late.promise;
                },
            });
            await executeBoundSearch(instance, "stage-revalidation-partial-call");
            instance.bindPendingFirstInsight({
                body: stageInput().insightMarkdown,
                sourceIds: stageInput().sourceIds,
            });
            const capability = instance.getStageCapability();
            const prepared = capability.prepareAndValidate?.(stageInput(), { userInput: "" });
            if (!prepared?.ok) throw new Error("expected schema-valid staged input");

            const execution = capability.execute(prepared.input, {
                host,
                signal: parent.signal,
            });
            await started.promise;
            parent.abort();
            await expect(execution).rejects.toMatchObject({ name: "AbortError" });
            expect(instance.hasPendingFirstInsight()).toBe(false);
            expect(executeRelaxed).not.toHaveBeenCalled();
            expect(instance.snapshot("NO_INSIGHT")).toMatchObject({
                drafts: [],
                diagnostics: {
                    stageValidationSubreason: "aborted",
                    relaxedTokenConsumed: false,
                },
            });

            if (lateOutcome === "resolve") {
                late.resolve(result("partially_relevant", ["notes/lead.md"]));
            } else {
                late.reject(new Error("late revalidation failure"));
            }
            await Promise.resolve();
            await Promise.resolve();
            expect(executeRelaxed).not.toHaveBeenCalled();
            expect(instance.snapshot("NO_INSIGHT")).toMatchObject({
                drafts: [],
                diagnostics: { relaxedTokenConsumed: false },
            });
        },
    );

    it("lets parent abort win a completed revalidation before the recovery token commit", async () => {
        const parent = new AbortController();
        const { instance, executeRelaxed } = coordinator({
            revalidate: async (seed) => {
                parent.abort();
                return seed;
            },
        });
        await executeBoundSearch(instance, "completed-revalidation-partial-call");
        instance.bindPendingFirstInsight({
            body: stageInput().insightMarkdown,
            sourceIds: stageInput().sourceIds,
        });
        const capability = instance.getStageCapability();
        const prepared = capability.prepareAndValidate?.(stageInput(), { userInput: "" });
        if (!prepared?.ok) throw new Error("expected schema-valid staged input");

        await expect(capability.execute(prepared.input, {
            host,
            signal: parent.signal,
        })).rejects.toMatchObject({ name: "AbortError" });
        expect(executeRelaxed).not.toHaveBeenCalled();
        expect(instance.hasPendingFirstInsight()).toBe(false);
        expect(instance.snapshot("NO_INSIGHT")).toMatchObject({
            drafts: [],
            diagnostics: {
                stageValidationSubreason: "aborted",
                relaxedTokenConsumed: false,
            },
        });
    });

    it.each(["resolve", "reject"] as const)(
        "clears staged output but preserves the consumed token when parent aborts relaxed recovery before late %s",
        async (lateOutcome) => {
            const parent = new AbortController();
            const started = deferred<void>();
            const late = deferred<MemorySearchResult>();
            const { instance, executeRelaxed } = coordinator({
                revalidate: async (seed) => seed,
                relaxed: async () => {
                    started.resolve(undefined);
                    return await late.promise;
                },
            });
            await executeBoundSearch(instance, "stage-relaxed-partial-call");
            instance.bindPendingFirstInsight({
                body: stageInput().insightMarkdown,
                sourceIds: stageInput().sourceIds,
            });
            const capability = instance.getStageCapability();
            const prepared = capability.prepareAndValidate?.(stageInput(), { userInput: "" });
            if (!prepared?.ok) throw new Error("expected schema-valid staged input");

            const execution = capability.execute(prepared.input, {
                host,
                signal: parent.signal,
            });
            await started.promise;
            expect(instance.snapshot("NO_INSIGHT").diagnostics.relaxedTokenConsumed).toBe(true);
            parent.abort();
            await expect(execution).rejects.toMatchObject({ name: "AbortError" });
            expect(executeRelaxed).toHaveBeenCalledTimes(1);
            expect(instance.hasPendingFirstInsight()).toBe(false);
            expect(instance.snapshot("NO_INSIGHT")).toMatchObject({
                drafts: [],
                diagnostics: {
                    stageValidationSubreason: "aborted",
                    relaxedTokenConsumed: true,
                },
            });

            if (lateOutcome === "resolve") {
                late.resolve(result("relevant", ["notes/late.md"]));
            } else {
                late.reject(new Error("late relaxed failure"));
            }
            await Promise.resolve();
            await Promise.resolve();
            expect(instance.snapshot("NO_INSIGHT")).toMatchObject({
                drafts: [],
                diagnostics: { relaxedTokenConsumed: true },
            });
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

        instance.bindPendingFirstInsight({
            body: stageInput().insightMarkdown,
            sourceIds: stageInput().sourceIds,
        });
        const capability = instance.getStageCapability();
        const prepared = capability.prepareAndValidate?.(stageInput(), { userInput: "" });
        if (!prepared?.ok) throw new Error("expected schema-valid staged input");
        parent.abort();

        await expect(capability.execute(prepared.input, {
            host,
            signal: parent.signal,
        })).rejects.toMatchObject({ name: "AbortError" });
        expect(instance.hasPendingFirstInsight()).toBe(false);
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
        "fails closed when live policy disable interrupts episode revalidation before late %s",
        async (lateOutcome) => {
            let enabled = true;
            let policyEpoch = "policy-1";
            const listeners = new Set<() => void | Promise<void>>();
            const started = deferred<void>();
            const late = deferred<MemorySearchResult>();
            const { instance, executeRelaxed } = coordinator({
                policyEpoch,
                isEnabled: () => enabled,
                getPolicyEpoch: () => policyEpoch,
                onPolicyChanged: (listener) => {
                    listeners.add(listener);
                    return () => listeners.delete(listener);
                },
                revalidate: async () => {
                    started.resolve(undefined);
                    return await late.promise;
                },
            });
            await executeBoundSearch(instance, "policy-disable-revalidation-partial-call");
            instance.bindPendingFirstInsight({
                body: stageInput().insightMarkdown,
                sourceIds: stageInput().sourceIds,
            });
            const capability = instance.getStageCapability();
            const prepared = capability.prepareAndValidate?.(stageInput(), { userInput: "" });
            if (!prepared?.ok) throw new Error("expected schema-valid staged input");

            const execution = capability.execute(prepared.input, { host });
            await started.promise;
            enabled = false;
            policyEpoch = "policy-2";
            await Promise.all([...listeners].map((listener) => listener()));
            await expect(execution).resolves.toMatchObject({
                status: "unavailable",
                unavailableReason: "pagelet_stage_control_unavailable",
            });
            expect(listeners.size).toBe(0);
            expect(instance.hasPendingFirstInsight()).toBe(false);
            expect(executeRelaxed).not.toHaveBeenCalled();
            expect(instance.snapshot("NO_INSIGHT")).toMatchObject({
                drafts: [],
                diagnostics: { relaxedTokenConsumed: false },
            });

            if (lateOutcome === "resolve") {
                late.resolve(result("partially_relevant", ["notes/lead.md"]));
            } else {
                late.reject(new Error("late policy-disabled revalidation failure"));
            }
            await Promise.resolve();
            await Promise.resolve();
            expect(executeRelaxed).not.toHaveBeenCalled();
            expect(instance.snapshot("NO_INSIGHT")).toMatchObject({
                drafts: [],
                diagnostics: { relaxedTokenConsumed: false },
            });
        },
    );

    it.each(["resolve", "reject"] as const)(
        "fails closed when live policy disable interrupts relaxed recovery before late %s",
        async (lateOutcome) => {
            let enabled = true;
            let policyEpoch = "policy-1";
            const listeners = new Set<() => void | Promise<void>>();
            const started = deferred<void>();
            const late = deferred<MemorySearchResult>();
            const { instance, executeRelaxed } = coordinator({
                policyEpoch,
                isEnabled: () => enabled,
                getPolicyEpoch: () => policyEpoch,
                onPolicyChanged: (listener) => {
                    listeners.add(listener);
                    return () => listeners.delete(listener);
                },
                revalidate: async (seed) => seed,
                relaxed: async () => {
                    started.resolve(undefined);
                    return await late.promise;
                },
            });
            await executeBoundSearch(instance, "policy-disable-relaxed-partial-call");
            instance.bindPendingFirstInsight({
                body: stageInput().insightMarkdown,
                sourceIds: stageInput().sourceIds,
            });
            const capability = instance.getStageCapability();
            const prepared = capability.prepareAndValidate?.(stageInput(), { userInput: "" });
            if (!prepared?.ok) throw new Error("expected schema-valid staged input");

            const execution = capability.execute(prepared.input, { host });
            await started.promise;
            expect(instance.snapshot("NO_INSIGHT").diagnostics.relaxedTokenConsumed).toBe(true);
            enabled = false;
            policyEpoch = "policy-2";
            await Promise.all([...listeners].map((listener) => listener()));
            await expect(execution).resolves.toMatchObject({
                status: "unavailable",
                unavailableReason: "pagelet_stage_control_unavailable",
            });
            expect(listeners.size).toBe(0);
            expect(instance.hasPendingFirstInsight()).toBe(false);
            expect(executeRelaxed).toHaveBeenCalledTimes(1);
            expect(instance.snapshot("NO_INSIGHT")).toMatchObject({
                drafts: [],
                diagnostics: { relaxedTokenConsumed: true },
            });

            if (lateOutcome === "resolve") {
                late.resolve(result("relevant", ["notes/late.md"]));
            } else {
                late.reject(new Error("late policy-disabled relaxed failure"));
            }
            await Promise.resolve();
            await Promise.resolve();
            expect(executeRelaxed).toHaveBeenCalledTimes(1);
            expect(instance.snapshot("NO_INSIGHT")).toMatchObject({
                drafts: [],
                diagnostics: { relaxedTokenConsumed: true },
            });
        },
    );

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
                    instance.bindPendingFirstInsight({
                        body: stageInput().insightMarkdown,
                        sourceIds: stageInput().sourceIds,
                    });
                    const capability = instance.getStageCapability();
                    const prepared = capability.prepareAndValidate?.(
                        stageInput(),
                        { userInput: "" },
                    );
                    if (!prepared?.ok) throw new Error("expected schema-valid staged input");
                    await expect(capability.execute(prepared.input, { host }))
                        .resolves.toMatchObject({
                            status: "ok",
                            observation: { recovery: "not-authorized" },
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

    it("records an unavailable cumulative projection without a semantic zero count", async () => {
        const events: RetrievalDiagnosticEventInput[] = [];
        let revalidationCount = 0;
        const { instance } = coordinator({
            revalidate: async (seed) => {
                revalidationCount += 1;
                return revalidationCount === 1 ? seed : unavailableResult();
            },
            recordDiagnostic: (event) => events.push(event),
        });
        await executeBoundSearch(instance, "projection-bound-call");
        const capability = instance.getStageCapability();
        const prepared = capability.prepareAndValidate?.(stageInput(), { userInput: "" });
        if (!prepared?.ok) throw new Error("expected valid staged input");
        const staged = await capability.execute(prepared.input, { host });
        if (staged.status !== "ok") throw new Error("expected successful stage");
        await instance.prepareTranscript([{
            role: "toolResult",
            id: "projection-stage-result",
            toolCallId: "projection-stage-call",
            toolName: "stage_pagelet_insight",
            content: {
                promptText: JSON.stringify(staged.observation),
                includeInNextPrompt: true,
                sourceRecords: staged.sourceRecords,
                contextUsed: [],
            },
            isError: false,
            timestamp: 1,
        }]);

        const projectionTerminal = events.find((event) => (
            event.phase === "recovery_projection" && event.outcome !== "started"
        ));
        expect(projectionTerminal).toMatchObject({
            outcome: "fallback",
            reason: "projection_unavailable",
        });
        expect(projectionTerminal?.metrics).not.toHaveProperty("documentCount");
    });

    it("records an explicit skipped reason for every deterministic no-relaxed branch", async () => {
        const events: Array<{ phase: string; outcome: string; reason?: string }> = [];
        const recorder = (event: { phase: string; outcome: string; reason?: string }) => events.push(event);

        const sufficient = coordinator({
            standard: result("relevant", ["notes/enough.md"]),
            recordDiagnostic: recorder,
        });
        await executeBoundSearch(sufficient.instance, "sufficient-call");

        const partial = coordinator({ recordDiagnostic: recorder });
        await executeBoundSearch(partial.instance, "partial-call");

        const token = coordinator({
            standard: result("none_relevant", []),
            recordDiagnostic: recorder,
        });
        await executeBoundSearch(token.instance, "token-first-call");
        await executeBoundSearch(token.instance, "token-second-call");

        const noLeadRequest = coordinator({ recordDiagnostic: recorder });
        await executeBoundSearch(noLeadRequest.instance, "no-lead-call");
        const noLeadCapability = noLeadRequest.instance.getStageCapability();
        const noLeadPrepared = noLeadCapability.prepareAndValidate?.(stageInput(false), { userInput: "" });
        if (!noLeadPrepared?.ok) throw new Error("expected valid no-lead staged input");
        await noLeadCapability.execute(noLeadPrepared.input, { host });

        const missingConcreteLead = coordinator({ recordDiagnostic: recorder });
        await executeBoundSearch(missingConcreteLead.instance, "missing-lead-call");
        const missingCapability = missingConcreteLead.instance.getStageCapability();
        const missingInput = stageInput();
        missingInput.sourceIds = ["notes/anchor.md", "notes/other.md"];
        missingInput.unresolvedLead.supportingSourceIds = ["notes/other.md"];
        const missingPrepared = missingCapability.prepareAndValidate?.(missingInput, { userInput: "" });
        if (!missingPrepared?.ok) throw new Error("expected valid missing-lead staged input");
        await missingCapability.execute(missingPrepared.input, { host });

        const skippedReasons = events
            .filter((event) => event.phase === "recovery_relaxed" && event.outcome === "skipped")
            .map((event) => event.reason);
        expect(skippedReasons).toEqual(expect.arrayContaining([
            "standard_sufficient",
            "partial_requires_stage",
            "token_consumed",
            "lead_not_requested",
            "concrete_lead_unavailable",
        ]));
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

    it("binds one-shot staging to the latest current partial source and hides query/episode state", async () => {
        const { instance, executeRelaxed } = coordinator();
        await executeBoundSearch(instance, "partial-call");
        const capability = instance.getStageCapability();
        const prepared = capability.prepareAndValidate?.(stageInput(), { userInput: "" });
        if (!prepared?.ok) throw new Error("expected valid staged input");
        const staged = await capability.execute(prepared.input, { host });

        expect(staged.status).toBe("ok");
        expect(executeRelaxed).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(staged.observation)).not.toContain("host-owned-query");
        expect(JSON.stringify(staged.observation)).not.toContain("lexicalPlan");
        expect(staged.observation).toMatchObject({
            status: "staged",
            recovery: "completed",
            evidence: {
                documents: expect.arrayContaining([
                    expect.objectContaining({ content: "notes/deep.md" }),
                    expect.objectContaining({ content: "notes/lead.md" }),
                ]),
            },
        });
        expect(instance.snapshot("NO_INSIGHT").drafts).toEqual([
            expect.objectContaining({ origin: "staged" }),
        ]);

        const secondPrepared = capability.prepareAndValidate?.(stageInput(), { userInput: "" });
        expect(secondPrepared).toMatchObject({ ok: true });
        if (!secondPrepared?.ok) throw new Error("expected pure validation to remain repeatable");
        await expect(capability.execute(secondPrepared.input, { host }))
            .resolves.toMatchObject({ status: "unavailable" });
    });

    it("replaces only the bound partial observation with one cumulative evidence projection", async () => {
        const standard = result("partially_relevant", ["notes/lead.md"]);
        const marker = "BOUND_PARTIAL_DOCUMENT_MARKER";
        standard.documents[0]!.content = marker;
        standard.candidates![0]!.documents[0]!.content = marker;
        standard.candidates![0]!.excerpt = marker;
        const { instance } = coordinator({ standard });
        await executeBoundSearch(instance, "bound-partial-call");
        const capability = instance.getStageCapability();
        const prepared = capability.prepareAndValidate?.(stageInput(), { userInput: "" });
        if (!prepared?.ok) throw new Error("expected valid staged input");
        const staged = await capability.execute(prepared.input, { host });
        if (staged.status !== "ok") throw new Error("expected successful stage");
        const transcript: PaAgentMessage[] = [
            {
                role: "toolResult",
                id: "bound-result",
                toolCallId: "bound-partial-call",
                toolName: "search_memory",
                content: {
                    promptText: JSON.stringify({ query: "host-owned-query", evidence: marker }),
                    includeInNextPrompt: true,
                    sourceRecords: [{
                        kind: "memory-reference",
                        dedupKey: "notes/lead.md",
                        path: "notes/lead.md",
                    }],
                    contextUsed: [],
                },
                isError: false,
                timestamp: 1,
            },
            {
                role: "toolResult",
                id: "unrelated-result",
                toolCallId: "unrelated-memory-call",
                toolName: "search_memory",
                content: {
                    promptText: "UNRELATED_MEMORY_EVIDENCE",
                    includeInNextPrompt: true,
                    sourceRecords: [],
                    contextUsed: [],
                },
                isError: false,
                timestamp: 2,
            },
            {
                role: "toolResult",
                id: "stage-result",
                toolCallId: "stage-call",
                toolName: "stage_pagelet_insight",
                content: {
                    promptText: JSON.stringify(staged.observation),
                    includeInNextPrompt: true,
                    sourceRecords: staged.sourceRecords,
                    contextUsed: [],
                },
                isError: false,
                timestamp: 3,
            },
        ];

        const projected = await instance.prepareTranscript(transcript);
        const serialized = JSON.stringify(projected);
        const bound = projected[0];
        expect(bound?.role === "toolResult" ? bound.content : null).toMatchObject({
            sourceRecords: [],
            contextUsed: [],
            metadata: { statusOnly: true },
        });
        expect(serialized.match(new RegExp(marker, "g"))).toHaveLength(1);
        expect(serialized).toContain("UNRELATED_MEMORY_EVIDENCE");
        expect(serialized).not.toContain("host-owned-query");
        expect(serialized).not.toContain("lexicalPlan");
        expect(serialized).not.toContain("episode");
    });

    it("does not authorize a mismatched lead and does not consume the token", async () => {
        const { instance, executeRelaxed } = coordinator();
        await executeBoundSearch(instance, "mismatched-call");
        const capability = instance.getStageCapability();
        const input = stageInput();
        input.sourceIds = ["notes/anchor.md", "notes/other.md"];
        input.unresolvedLead.supportingSourceIds = ["notes/other.md"];
        const prepared = capability.prepareAndValidate?.(input, { userInput: "" });
        if (!prepared?.ok) throw new Error("expected schema-valid staged input");
        const staged = await capability.execute(prepared.input, { host });

        expect(staged).toMatchObject({ status: "ok", observation: { recovery: "not-authorized" } });
        expect(executeRelaxed).not.toHaveBeenCalled();
        expect(instance.snapshot("NO_INSIGHT").diagnostics.relaxedTokenConsumed).toBe(false);
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
            observation: { recovery: "unavailable" },
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

    it("keeps the flag-off path single-result and clears provisional state on teardown", async () => {
        const disabled = coordinator({ enabled: false, standard: result("none_relevant", []) });
        await executeBoundSearch(disabled.instance, "disabled-call");
        expect(disabled.executeRelaxed).not.toHaveBeenCalled();
        expect(() => disabled.instance.reserveStageControl(stageInput())).toThrow("unavailable");

        const enabled = coordinator();
        enabled.instance.bindPendingFirstInsight({
            body: stageInput(false).insightMarkdown,
            sourceIds: stageInput(false).sourceIds,
        });
        expect(enabled.instance.hasPendingFirstInsight()).toBe(true);
        await executeBoundSearch(enabled.instance, "enabled-call");
        const capability = enabled.instance.getStageCapability();
        const prepared = capability.prepareAndValidate?.(stageInput(false), { userInput: "" });
        if (!prepared?.ok) throw new Error("expected valid staged input");
        await capability.execute(prepared.input, { host });
        expect(enabled.instance.snapshot("NO_INSIGHT").drafts).toHaveLength(1);
        enabled.instance.clear();
        expect(enabled.instance.snapshot("NO_INSIGHT").drafts).toHaveLength(0);
        expect(enabled.instance.hasPendingFirstInsight()).toBe(false);
        expect(() => enabled.instance.reserveStageControl(stageInput())).toThrow("unavailable");
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
        live.instance.bindPendingFirstInsight({
            body: stageInput(false).insightMarkdown,
            sourceIds: stageInput(false).sourceIds,
        });
        expect(live.instance.hasPendingFirstInsight()).toBe(true);

        const pending = executeBoundSearch(live.instance, "live-standard-call");
        await standardStarted.promise;
        enabled = false;
        policyEpoch = "policy-2";
        await Promise.all([...listeners].map((listener) => listener()));
        expect(standardSignal?.aborted).toBe(false);
        expect(live.instance.hasPendingFirstInsight()).toBe(false);

        standard.resolve(result("none_relevant", []));
        await expect(pending).resolves.toMatchObject({ sources: [] });
        expect(live.executeRelaxed).not.toHaveBeenCalled();
        expect(() => live.instance.reserveStageControl(stageInput())).toThrow("unavailable");
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
                absoluteDeadlineMs: 11_000,
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
