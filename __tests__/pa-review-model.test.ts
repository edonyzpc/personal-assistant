import { describe, it, expect, jest } from "@jest/globals";

import {
    PAGELET_FIELD_LIMITS,
    PAGELET_SCHEMA_VERSION,
    PageletReviewModel,
    reviewNote,
    type PageletChatModelFactory,
    type PageletChatModelLike,
    type PageletReviewInput,
    type PageletReviewOutcome,
} from "../src/pagelet";

// ---------------------------------------------------------------------------
// Test harness — three flavors of mock model:
//
//   makeStructuredModel: provider supports withStructuredOutput natively
//     (mirrors OpenAI-compatible + Qwen happy path expected by D026).
//
//   makeJsonModeOnlyModel: provider has no withStructuredOutput
//     (mirrors older Bailian / Qwen variants per OQ002 spike risk).
//
//   makeBrokenModel: invocation throws (provider down / network / etc).
//
// Each mock is a *scripted queue* — push as many step responses as a test
// needs, in order. This catches retry-loop ordering bugs that would slip past
// a single-shot mock.
// ---------------------------------------------------------------------------

type StructuredStep =
    | { kind: "ok"; payload: unknown }
    | { kind: "throw"; error: unknown };

type InvokeStep =
    | { kind: "ok"; content: unknown }
    | { kind: "throw"; error: unknown };

interface StructuredModelHarness {
    factory: PageletChatModelFactory;
    structuredInvocations: number;
    invokeInvocations: number;
    capturedStructuredInputs: unknown[];
    capturedInvokeInputs: unknown[];
}

function makeStructuredModel(steps: StructuredStep[]): StructuredModelHarness {
    const harness: StructuredModelHarness = {
        factory: async () => model,
        structuredInvocations: 0,
        invokeInvocations: 0,
        capturedStructuredInputs: [],
        capturedInvokeInputs: [],
    };

    const queue = [...steps];
    const model: PageletChatModelLike = {
        invoke: jest.fn(async (input: unknown) => {
            harness.invokeInvocations += 1;
            harness.capturedInvokeInputs.push(input);
            return { content: "" };
        }),
        withStructuredOutput: () => ({
            invoke: async (input: unknown) => {
                harness.structuredInvocations += 1;
                harness.capturedStructuredInputs.push(input);
                const step = queue.shift();
                if (!step) throw new Error("structured queue exhausted (test bug)");
                if (step.kind === "throw") throw step.error;
                return step.payload as never;
            },
        }),
    };

    harness.factory = (async () => model) as PageletChatModelFactory;
    return harness;
}

interface JsonModeHarness {
    factory: PageletChatModelFactory;
    invokeInvocations: number;
    capturedInvokeInputs: unknown[];
}

function makeJsonModeOnlyModel(steps: InvokeStep[]): JsonModeHarness {
    const queue = [...steps];
    const harness: JsonModeHarness = {
        factory: async () => model,
        invokeInvocations: 0,
        capturedInvokeInputs: [],
    };
    const model: PageletChatModelLike = {
        invoke: jest.fn(async (input: unknown) => {
            harness.invokeInvocations += 1;
            harness.capturedInvokeInputs.push(input);
            const step = queue.shift();
            if (!step) throw new Error("invoke queue exhausted (test bug)");
            if (step.kind === "throw") throw step.error;
            return { content: step.content };
        }),
        // NOTE: deliberately no withStructuredOutput — simulates provider gap.
    };
    harness.factory = (async () => model) as PageletChatModelFactory;
    return harness;
}

function makeBrokenFactory(error: unknown): PageletChatModelFactory {
    return async () => {
        throw error;
    };
}

// ---------------------------------------------------------------------------
// Standard inputs / fixtures
// ---------------------------------------------------------------------------

function defaultInput(overrides: Partial<PageletReviewInput> = {}): PageletReviewInput {
    return {
        notePath: "notes/concept-x.md",
        noteContent: "Concept X body…",
        detectedLanguage: "en",
        mode: "basic",
        segments: [
            { id: "seg-1", content: "Concept X is a method." },
            { id: "seg-2", content: "It originates from Zettelkasten." },
        ],
        ...overrides,
    };
}

function validResultPayload(overrides: Record<string, unknown> = {}) {
    return {
        schema_version: PAGELET_SCHEMA_VERSION,
        detected_language: "en",
        suggestions: [
            {
                source_id: "seg-1",
                kind: "clarify",
                rationale: "the opening line lacks a scope statement readers need",
                proposed_action: "after seg-1, append a sentence describing scope and a worked example",
            },
        ],
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PageletReviewModel — happy path (structured output, 3 provider personalities)", () => {
    it("provider A (OpenAI-compatible): withStructuredOutput returns a clean payload → status=ok", async () => {
        // Provider A models the OpenAI / Qwen happy path that D026 designates as the main route.
        // We assert the diagnostics carry the structured path so future telemetry hooks (§11) can
        // distinguish "we used the strong path" from "we degraded".
        const harness = makeStructuredModel([
            { kind: "ok", payload: validResultPayload() },
        ]);
        const outcome = await reviewNote(harness.factory, defaultInput());
        expect(outcome.status).toBe("ok");
        if (outcome.status !== "ok") return;
        expect(outcome.result.suggestions).toHaveLength(1);
        expect(outcome.diagnostics.path).toBe("structured");
        expect(outcome.diagnostics.attempts).toBe(1);
        expect(outcome.diagnostics.truncated).toBe(false);
        expect(outcome.diagnostics.partial).toBe(false);
    });

    it("provider B (Qwen/DashScope): payload missing schema_version → auto-stamped → still ok", async () => {
        // Real-world observation across early Qwen runs: the model occasionally drops constant
        // fields like schema_version. Our finalizer stamps the default so a clean otherwise-valid
        // payload doesn't get rejected. If this regresses, Qwen hit-rate drops noticeably.
        const payload = validResultPayload();
        delete (payload as Record<string, unknown>).schema_version;
        const harness = makeStructuredModel([{ kind: "ok", payload }]);
        const outcome = await reviewNote(harness.factory, defaultInput());
        expect(outcome.status).toBe("ok");
        if (outcome.status !== "ok") return;
        expect(outcome.result.schema_version).toBe(PAGELET_SCHEMA_VERSION);
    });

    it("provider C (Bailian without structured output): falls back to JSON-mode and parses ok", async () => {
        // Provider C models the OQ002 risk: structured output unsupported. The model must
        // recognise the absent method and switch to JSON-mode, NOT throw. The user gets a
        // working review either way; only `diagnostics.path` differs for telemetry.
        const harness = makeJsonModeOnlyModel([
            { kind: "ok", content: JSON.stringify(validResultPayload()) },
        ]);
        const outcome = await reviewNote(harness.factory, defaultInput());
        expect(outcome.status).toBe("ok");
        if (outcome.status !== "ok") return;
        expect(outcome.diagnostics.path).toBe("json_mode");
    });
});

describe("PageletReviewModel — failure matrix (SDD §4.3, 8 rows)", () => {
    it("row 1: schema mismatch → one retry → success", async () => {
        // Row 1 is the most common failure: model emits a key with wrong shape. We expect:
        //   (a) the first attempt fails (structured.invoke throws zod-shaped error),
        //   (b) we retry once with a corrective hint in the prompt,
        //   (c) the second attempt yields a valid payload.
        // Asserting `attempts === 2` + `path === structured_retry` ensures we don't silently
        // surface the bad first response or burn budget on extra retries.
        const harness = makeStructuredModel([
            { kind: "throw", error: schemaError([{ path: ["suggestions", 0, "rationale"], message: "Required" }]) },
            { kind: "ok", payload: validResultPayload() },
        ]);
        const outcome = await reviewNote(harness.factory, defaultInput());
        expect(outcome.status).toBe("ok");
        if (outcome.status !== "ok") return;
        expect(outcome.diagnostics.attempts).toBe(2);
        expect(outcome.diagnostics.path).toBe("structured_retry");
        // The retry-augmented prompt must surface the original validation errors so the model
        // can act on them — a generic "try again" hint historically regresses Qwen recovery.
        const retryMessages = harness.capturedStructuredInputs[1] as { content: string }[];
        const userText = retryMessages.find((m) => /Previous output/i.test(String(m.content)));
        expect(userText).toBeDefined();
    });

    it("row 1 escalated: schema mismatch persists past retry → surfaces schema_invalid", async () => {
        // The flip side of the retry: if the second attempt also fails AND free-form fallback
        // is disabled (testing isolation knob), we surface `schema_invalid` rather than masking
        // it as success. This protects against future "always-success" regressions.
        const harness = makeStructuredModel([
            { kind: "throw", error: schemaError([{ path: ["x"], message: "bad" }]) },
            { kind: "throw", error: schemaError([{ path: ["x"], message: "still bad" }]) },
        ]);
        const outcome = await reviewNote(harness.factory, defaultInput(), { disableFreeFormFallback: true } as never);
        // disableFreeFormFallback shortcut: cast through never because the option set is private to
        // PageletReviewModel.constructor; we pass it via the convenience `reviewNote` helper.
        const result = await assertOutcomeMatches(outcome, { disableFreeFormFallback: true });
        expect(result.status).toBe("error");
        if (result.status !== "error") return;
        expect(result.errorCode).toBe("schema_invalid");
    });

    it("row 2: missing source_id → suggestion dropped → diagnostics.partial=true", async () => {
        // Row 2: the LLM cites a source id we never gave it. Per SDD §4.1 we drop just that
        // suggestion (not the whole result) and surface `partial=true` so the UI can hint
        // about the discard rather than pretending nothing happened.
        const harness = makeStructuredModel([
            {
                kind: "ok",
                payload: validResultPayload({
                    suggestions: [
                        {
                            source_id: "seg-1",
                            kind: "clarify",
                            rationale: "valid suggestion with real source id",
                            proposed_action: "do something about the first segment",
                        },
                        {
                            source_id: "seg-ghost",
                            kind: "evidence",
                            rationale: "this one cites a non-existent segment id",
                            proposed_action: "should be dropped by the source-id filter",
                        },
                    ],
                }),
            },
        ]);
        const outcome = await reviewNote(harness.factory, defaultInput());
        expect(outcome.status).toBe("ok");
        if (outcome.status !== "ok") return;
        expect(outcome.result.suggestions).toHaveLength(1);
        expect(outcome.result.suggestions[0].source_id).toBe("seg-1");
        expect(outcome.diagnostics.partial).toBe(true);
        expect(outcome.diagnostics.droppedSuggestionsCount).toBe(1);
    });

    it("row 3: wrong field type → zod surfaces error → corrective retry path", async () => {
        // Row 3 funnels through the same retry as row 1 (zod doesn't distinguish "wrong type"
        // from "missing"). We assert the retry HAPPENS, not the specific error reason.
        const harness = makeStructuredModel([
            { kind: "throw", error: schemaError([{ path: ["suggestions", 0, "kind"], message: "expected string" }]) },
            { kind: "ok", payload: validResultPayload() },
        ]);
        const outcome = await reviewNote(harness.factory, defaultInput());
        expect(outcome.status).toBe("ok");
        if (outcome.status !== "ok") return;
        expect(outcome.diagnostics.attempts).toBe(2);
    });

    it("row 4: empty suggestions[] → status=empty (NOT an error)", async () => {
        // Row 4 is the "your note is fine" state. The UI renders an empty-state badge; we
        // do NOT retry or treat this as a parse failure. The schema explicitly allows zero
        // suggestions, so this assertion guards against an over-eager "must have at least one"
        // refactor sneaking back in.
        const harness = makeStructuredModel([
            { kind: "ok", payload: validResultPayload({ suggestions: [] }) },
        ]);
        const outcome = await reviewNote(harness.factory, defaultInput());
        expect(outcome.status).toBe("empty");
        if (outcome.status !== "empty") return;
        expect(outcome.result.suggestions).toEqual([]);
    });

    it("row 5: over-length suggestion → truncated → diagnostics.truncated=true", async () => {
        // Row 5: rather than rejecting an otherwise-valid suggestion for a long rationale,
        // we trim and flag. Trimming inside the validator keeps the SuggestionCard renderer
        // free of length assertions, and the diagnostics flag lets us surface a "shortened
        // by Pagelet" badge once B2 lands.
        const harness = makeStructuredModel([
            {
                kind: "ok",
                payload: validResultPayload({
                    suggestions: [
                        {
                            source_id: "seg-1",
                            kind: "clarify",
                            rationale: "z".repeat(PAGELET_FIELD_LIMITS.rationaleMax + 50),
                            proposed_action: "p".repeat(PAGELET_FIELD_LIMITS.proposedActionMax + 50),
                        },
                    ],
                }),
            },
        ]);
        const outcome = await reviewNote(harness.factory, defaultInput());
        expect(outcome.status).toBe("ok");
        if (outcome.status !== "ok") return;
        expect(outcome.diagnostics.truncated).toBe(true);
        expect(outcome.result.suggestions[0].rationale.length).toBe(PAGELET_FIELD_LIMITS.rationaleMax);
        expect(outcome.result.suggestions[0].proposed_action.length).toBe(
            PAGELET_FIELD_LIMITS.proposedActionMax,
        );
    });

    it("row 6: partial parse — some suggestions valid, some invalid source_id → render valid, mark partial", async () => {
        // Row 6 is similar to row 2 but exercises the "1 of N drop" path explicitly:
        // 3 suggestions come in, 1 valid + 2 with ghost ids. We must keep 1, mark partial,
        // and count droppedSuggestionsCount=2. Catches off-by-one bugs in the filter loop.
        const harness = makeStructuredModel([
            {
                kind: "ok",
                payload: validResultPayload({
                    suggestions: [
                        {
                            source_id: "seg-1",
                            kind: "clarify",
                            rationale: "valid suggestion referencing real segment id",
                            proposed_action: "act on seg-1 by appending a scope sentence to clarify",
                        },
                        {
                            source_id: "seg-ghost-1",
                            kind: "expand",
                            rationale: "invalid id should be filtered out by our defence",
                            proposed_action: "this proposed_action should never reach the UI layer",
                        },
                        {
                            source_id: "seg-ghost-2",
                            kind: "trim",
                            rationale: "another invalid id, should also be discarded",
                            proposed_action: "and this one too should be filtered out",
                        },
                    ],
                }),
            },
        ]);
        const outcome = await reviewNote(harness.factory, defaultInput());
        expect(outcome.status).toBe("ok");
        if (outcome.status !== "ok") return;
        expect(outcome.result.suggestions).toHaveLength(1);
        expect(outcome.diagnostics.droppedSuggestionsCount).toBe(2);
        expect(outcome.diagnostics.partial).toBe(true);
    });

    it("row 7: abort signal → outcome.errorCode='timeout'", async () => {
        // Row 7 is the timeout path. The PaAgentLoop owns the wall-clock budget (SDD §4.3 row 7),
        // we just need to propagate AbortError → "timeout" surface so the UI shows a friendly
        // "review timed out" rather than a stack trace.
        const harness = makeStructuredModel([
            { kind: "throw", error: abortError() },
        ]);
        const outcome = await reviewNote(harness.factory, defaultInput());
        expect(outcome.status).toBe("error");
        if (outcome.status !== "error") return;
        expect(outcome.errorCode).toBe("timeout");
    });

    it("row 8: parse error in free-form fallback → recovers via tolerant JSON parse", async () => {
        // Row 8: when free-form fallback is the path (no withStructuredOutput), the model may
        // emit JSON wrapped in ```json fences AND/OR with trailing commas. The fallback parser
        // (`extractJsonPayload` + `tolerantJsonParse`) handles both. The two artefacts together
        // model the worst-case "messy assistant output" seen in early Qwen runs.
        const valid = JSON.stringify(validResultPayload());
        // Surgically inject ONE trailing comma right before the outermost `}` so the JSON is
        // unrecoverable by strict JSON.parse but trivially fixable by the tolerant pass.
        // (A blanket regex would produce double-broken JSON that not even the tolerant parser
        //  can handle; one targeted edit keeps the test honest.)
        const withTrailingComma = valid.slice(0, -1) + ",}";
        const messyPayload = "```json\n" + withTrailingComma + "\n```";
        const factory: PageletChatModelFactory = async () => ({
            invoke: jest.fn(async () => ({ content: messyPayload })),
            withStructuredOutput: () => ({
                invoke: async () => {
                    throw new Error("should not be called when disableStructuredOutput");
                },
            }),
        });
        const outcome = await reviewNote(factory, defaultInput(), { disableStructuredOutput: true });
        expect(outcome.status).toBe("ok");
        if (outcome.status !== "ok") return;
        expect(outcome.diagnostics.path).toBe("json_mode");
    });
});

describe("PageletReviewModel — provider degradation paths", () => {
    it("structured exhausted + JSON mode recovers → success via json_mode", async () => {
        // Defensive sequence: structured fails twice, but if the user hasn't disabled free-form
        // fallback we should fall through and succeed via JSON mode. Otherwise the user would
        // see a parse error for a recoverable failure — bad UX.
        const factory: PageletChatModelFactory = async () => model;
        const structuredQueue: StructuredStep[] = [
            { kind: "throw", error: schemaError([{ path: ["x"], message: "bad" }]) },
            { kind: "throw", error: schemaError([{ path: ["x"], message: "still bad" }]) },
        ];
        const model: PageletChatModelLike = {
            invoke: jest.fn(async () => ({ content: JSON.stringify(validResultPayload()) })),
            withStructuredOutput: () => ({
                invoke: async () => {
                    const step = structuredQueue.shift();
                    if (!step) throw new Error("queue empty");
                    if (step.kind === "throw") throw step.error;
                    return step.payload as never;
                },
            }),
        };
        const outcome = await reviewNote(factory, defaultInput());
        expect(outcome.status).toBe("ok");
        if (outcome.status !== "ok") return;
        expect(outcome.diagnostics.path).toBe("json_mode");
    });

    it("provider throws non-abort error → outcome.errorCode='provider_error'", async () => {
        // A non-abort throw from the factory itself (e.g. API key invalid) must NOT propagate;
        // it must be surfaced as `provider_error` so the UI can show settings instead of a stack
        // trace. The structured path is never reached.
        const outcome = await reviewNote(makeBrokenFactory(new Error("HTTP 401 unauthorized")), defaultInput());
        expect(outcome.status).toBe("error");
        if (outcome.status !== "error") return;
        expect(outcome.errorCode).toBe("provider_error");
        expect(outcome.diagnostics.providerError).toMatch(/401/);
    });

    it("AbortSignal aborted before structured invoke → 'timeout' surfaced", async () => {
        // Real-world: user cancels review (closes panel) mid-call. The underlying model should
        // throw AbortError, which we convert to a friendly "timeout" surface. This catches a
        // regression where we mistakenly classify AbortError as provider_error.
        const factory: PageletChatModelFactory = async () => ({
            invoke: jest.fn(async () => ({ content: "" })),
            withStructuredOutput: () => ({
                invoke: async () => {
                    throw abortError();
                },
            }),
        });
        const outcome = await reviewNote(factory, defaultInput());
        expect(outcome.status).toBe("error");
        if (outcome.status !== "error") return;
        expect(outcome.errorCode).toBe("timeout");
    });

    it("JSON-mode parse fails twice → outcome.errorCode='parse_failed'", async () => {
        // Free-form fallback exhausted: model emits unparseable garbage on both attempts.
        // We surface "parse_failed" (NOT schema_invalid) because we never got far enough to
        // run zod. The distinction matters for telemetry — schema vs parse failures point at
        // different prompt-engineering remediations.
        const harness = makeJsonModeOnlyModel([
            { kind: "ok", content: "not json at all" },
            { kind: "ok", content: "still not json" },
        ]);
        const outcome = await reviewNote(harness.factory, defaultInput());
        expect(outcome.status).toBe("error");
        if (outcome.status !== "error") return;
        expect(outcome.errorCode).toBe("parse_failed");
        expect(outcome.diagnostics.attempts).toBe(2);
    });

    it("disableStructuredOutput=true on a capable model still uses JSON mode", async () => {
        // OQ002 dial: even if a model exposes withStructuredOutput, per-provider config can
        // force us to ignore it. This test guarantees the option actually wires through —
        // a regression would silently re-enable the structured path for misbehaving providers.
        const harness = makeJsonModeOnlyModel([
            { kind: "ok", content: JSON.stringify(validResultPayload()) },
        ]);
        const capable: PageletChatModelLike = {
            invoke: harness.factory ? ((async (input: unknown) => {
                // Borrow harness queue logic by delegating to the model the harness constructed.
                const innerModel = await harness.factory(0);
                return innerModel.invoke(input);
            }) as PageletChatModelLike["invoke"]) : ((async () => ({ content: "" })) as PageletChatModelLike["invoke"]),
            withStructuredOutput: () => ({
                invoke: async () => {
                    throw new Error("withStructuredOutput must not run when disabled");
                },
            }),
        };
        const factory: PageletChatModelFactory = async () => capable;
        const outcome = await reviewNote(factory, defaultInput(), { disableStructuredOutput: true });
        expect(outcome.status).toBe("ok");
        if (outcome.status !== "ok") return;
        expect(outcome.diagnostics.path).toBe("json_mode");
    });
});

describe("PageletReviewModel — input validation", () => {
    it("throws when input fails schema validation (programmer error)", async () => {
        // Bad inputs (e.g. zero segments) are a caller bug; they MUST throw rather than
        // surface as a provider error, because the LLM never gets a chance to misbehave.
        // Throwing keeps the bug visible during development instead of masquerading as an
        // intermittent failure later.
        const harness = makeStructuredModel([{ kind: "ok", payload: validResultPayload() }]);
        await expect(
            reviewNote(harness.factory, { ...defaultInput(), segments: [] }),
        ).rejects.toThrow();
        expect(harness.structuredInvocations).toBe(0);
    });
});

describe("PageletReviewModel class — reuse semantics", () => {
    it("can be constructed once and called multiple times with different inputs", async () => {
        // The class form is the production shape (adapter constructs once during setup,
        // calls reviewNote per command invocation). This test guarantees no per-call state
        // leakage between invocations.
        const harness = makeStructuredModel([
            { kind: "ok", payload: validResultPayload() },
            { kind: "ok", payload: validResultPayload({ detected_language: "zh" }) },
        ]);
        const model = new PageletReviewModel(harness.factory);
        const first = await model.reviewNote(defaultInput());
        const second = await model.reviewNote(defaultInput({ detectedLanguage: "zh" }));
        expect(first.status).toBe("ok");
        expect(second.status).toBe("ok");
        if (first.status !== "ok" || second.status !== "ok") return;
        expect(first.result.detected_language).toBe("en");
        expect(second.result.detected_language).toBe("zh");
    });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mimics a ZodError shape — `summarizeZodIssues` reads the `issues` array. */
function schemaError(issues: Array<{ path: (string | number)[]; message: string }>) {
    const err = new Error("zod validation failed");
    (err as unknown as { issues: typeof issues }).issues = issues;
    return err;
}

function abortError() {
    const err = new Error("Aborted by signal");
    err.name = "AbortError";
    return err;
}

/**
 * Tiny adapter that re-narrows a heterogeneous Promise<PageletReviewOutcome>.
 * Most tests narrow inline; this helper exists for the few that intentionally
 * pass options that the typedef doesn't expose at the top-level helper.
 */
async function assertOutcomeMatches(
    outcomePromise: PageletReviewOutcome | Promise<PageletReviewOutcome>,
    _opts: { disableFreeFormFallback?: boolean },
): Promise<PageletReviewOutcome> {
    return Promise.resolve(outcomePromise);
}
