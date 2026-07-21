/* Copyright 2023 edonyzpc */

/**
 * Pagelet — structured output orchestration.
 *
 * Spec source: `docs/archive/review-assistant-sdd.md` §2.2 + §4 + D026.
 *
 * Responsibilities:
 *  - Take a `PageletReviewInput`, run the LLM, return a `PageletReviewOutcome`.
 *  - Happy path: `withStructuredOutput(zodSchema)` (D026.b — LangChain native).
 *  - Failure matrix (SDD §4.3, 8 rows): every row is handled here, NOT in
 *    UI/caller code. Each row is independently toggleable via
 *    `PageletReviewModelOptions` so the OQ002 spike can dial behavior per
 *    provider without rewriting orchestration.
 *
 * What this file does NOT do:
 *  - Create the underlying LangChain model — that's `AIUtils.createChatModel()`
 *    in `src/ai-services/`. We accept a factory so the Track A worktree
 *    (which owns ai-services) can swap providers without touching pagelet.
 *  - Render suggestions — B2 owns SuggestionCard.
 *  - File IO — B6 owns `.pagelet/` persistence.
 *  - Cost / rate limiting — B4 owns gating; the caller runs that BEFORE
 *    invoking `reviewNote`.
 *
 * Failure matrix coverage (SDD §4.3):
 *  | # | Failure mode               | Handler                                                         |
 *  |---|----------------------------|-----------------------------------------------------------------|
 *  | 1 | schema mismatch            | one corrective retry, then surface schema_invalid               |
 *  | 2 | missing source_id          | drop bad suggestions; if all drop, retry then surface           |
 *  | 3 | wrong field type           | included in #1 (zod surfaces typed issues)                      |
 *  | 4 | empty suggestions[]        | success with status="empty"                                     |
 *  | 5 | over length                | truncate via `truncateOverlongFields` + mark truncated          |
 *  | 6 | partial parse              | keep valid suggestions, drop rest, mark partial                 |
 *  | 7 | timeout                    | abort propagation + "timeout" errorCode                         |
 *  | 8 | parse error                | free-form fallback: extract JSON, lenient parse, validate       |
 *  +---+----------------------------+------------------------------------------------------------------+
 *
 * Bonus: when the model has no `withStructuredOutput` (e.g. older Bailian
 * deployment), we degrade to a prompt-engineering JSON-mode call without
 * losing schema validation — see `runWithJsonMode`.
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import {
    PageletReviewInputSchema,
    PageletReviewResultSchema,
    PageletSuggestionSchema,
    PageletStructuredReviewResultSchema,
    PAGELET_SCHEMA_VERSION,
    buildJsonModeSchemaHint,
    buildSystemPrompt,
    buildUserPrompt,
    extractJsonPayload,
    filterSuggestionsBySourceIds,
    resolvePageletTargetSuggestionCount,
    summarizeZodIssues,
    tolerantJsonParse,
    truncateOverlongFields,
    type PageletReviewInput,
    type PageletReviewResult,
    type PageletSuggestion,
} from "./pa-review-schemas";
import {
    estimateTokens,
    preCheckCost,
    type CostPreCheckDecision,
    type PageletCostBudget,
    type PageletCostEntry,
    type PageletCostTracker,
} from "./pa-review-cost";
import {
    type PageletRateLimiter,
    type RateLimitDecision,
} from "./pa-review-rate-limit";
import { pageletT, type PageletLocale } from "../locales/pagelet";
import { toError } from "../error-utils";
import { clearPlatformTimeout, setPlatformTimeout, type PlatformTimeoutHandle } from "../platform-dom";
import { PageletProviderCallControlError } from "./provider-call-admission";

// ---------------------------------------------------------------------------
// Minimal LangChain model surface.
//
// We deliberately re-declare the shape rather than importing
// `BaseChatModel` / `ChatOpenAI` because:
//   1. Importing ai-services would violate this worktree's file domain.
//   2. The actual LangChain types are heavy / break Jest mocks easily.
//   3. We only need .invoke + optional .withStructuredOutput.
// The factory parameter shape mirrors `AIUtils.createChatModel`, so the
// adapter in `pa-review-runtime.ts` (future B-task) can pass it through 1:1.
// ---------------------------------------------------------------------------

export interface PageletChatModelLike {
    invoke(input: unknown, options?: { signal?: AbortSignal }): Promise<{ content: unknown }>;
    /** Present on real ChatOpenAI; may be absent on hand-rolled providers. */
    withStructuredOutput?<TOut>(
        schema: unknown,
        options?: { name?: string; method?: string; strict?: boolean },
    ): {
        invoke(input: unknown, options?: { signal?: AbortSignal }): Promise<TOut>;
    };
}

/** Roughly equivalent to `AIUtils["createChatModel"]`. */
export type PageletChatModelFactory = (
    temperature: number,
    options?: { modelName?: string; transport?: string },
) => Promise<PageletChatModelLike>;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PageletReviewErrorCode =
    | "schema_invalid"
    | "parse_failed"
    | "timeout"
    | "provider_error"
    /** B4 cost-gate: requested input exceeds the user-configured input cap. */
    | "input_too_large"
    /** B4 cost-gate: input + reserved output budget exceeds the 36K hard cap (D018). */
    | "hard_cap_exceeded"
    /** B4 rate-limit: hourly call cap reached (D020 — 10/hr). */
    | "rate_limit_hourly"
    /** B4 rate-limit: daily call cap reached (D020 — 100/day). */
    | "rate_limit_daily";

export type PageletReviewPath =
    | "structured"
    | "structured_retry"
    | "free_form"
    | "json_mode"
    | "json_mode_retry";

export interface PageletReviewDiagnostics {
    path: PageletReviewPath;
    attempts: number;
    truncated: boolean;
    partial: boolean;
    droppedSuggestionsCount: number;
    schemaErrors: string[];
    providerError?: string;
    /** ms spent in LLM invocations (sum across attempts). */
    elapsedMs: number;
    /** End-to-end reviewNote wall-clock duration, including gates and model setup. */
    totalElapsedMs?: number;
    /** Fine-grained timings for gates, model setup, paths, and per-attempt LLM calls. */
    timings?: PageletReviewTimingEntry[];
    /**
     * B4: pre-flight estimate of input tokens (system + user prompt). Always
     * populated when the orchestrator passes a `costBudget`; otherwise 0 so
     * downstream metrics can still aggregate without guarding for undefined.
     */
    estimatedInputTokens?: number;
    /**
     * B4: cost entry recorded after a successful call. Absent for error
     * outcomes and for B1-style tests that pass no cost tracker.
     */
    costEntry?: PageletCostEntry;
    /**
     * B4: when a rate-limit or cost cap rejected the call, this is set to
     * the gate's resume timestamp / detail. UI uses it to render
     * "available in N min".
     */
    gateRejection?:
        | { kind: "rate-limit"; reason: "hr-cap" | "day-cap"; resumeAt: number }
        | { kind: "cost"; reason: "input_too_large" | "hard_cap_exceeded"; detail: string };
}

export type PageletReviewOutcome =
    | {
          status: "ok";
          result: PageletReviewResult;
          diagnostics: PageletReviewDiagnostics;
      }
    | {
          status: "empty";
          result: PageletReviewResult;
          diagnostics: PageletReviewDiagnostics;
      }
    | {
          status: "error";
          errorCode: PageletReviewErrorCode;
          userMessage: string;
          diagnostics: PageletReviewDiagnostics;
      };

export interface PageletReviewTimingEntry {
    phase: string;
    elapsedMs: number;
    metadata?: Record<string, unknown>;
}

export type PageletReviewProgressPhase =
    | "cost_precheck"
    | "rate_limit"
    | "model_setup"
    | "structured_attempt"
    | "json_mode_attempt"
    | "json_mode_fallback";

export interface PageletReviewProgressEvent {
    phase: PageletReviewProgressPhase;
    path?: PageletReviewPath;
    attempt?: number;
    maxAttempts?: number;
    elapsedMs?: number;
}

export interface PageletReviewModelOptions {
    /** Max corrective retries after schema-invalid (failure-matrix row 1-3). Default 1. */
    maxRetries?: number;
    /**
     * Force-disable `withStructuredOutput` even when the model exposes it.
     * Set to `true` per provider once OQ002 spike confirms it's unreliable
     * (e.g. older Qwen variants where schema enforcement is best-effort).
     */
    disableStructuredOutput?: boolean;
    /**
     * Force-disable the free-form / JSON-mode fallback parser. Useful in
     * tests that want to assert schema_invalid surfacing.
     */
    disableFreeFormFallback?: boolean;
    /** Temperature for chat model creation. Default 0.2 (SDD §2.2). */
    temperature?: number;
    /** Override the chat model name (otherwise pulled from settings). */
    modelName?: string;
    /** Injectable clock for tests. */
    now?: () => number;
    /**
     * Locale used to render the user-facing `outcome.userMessage` string.
     * Follows UI language per D014 + D017 (mascot / settings are UI lang,
     * not note lang). Defaults to "en" so headless callers / tests get
     * stable copy without depending on a window global.
     */
    userMessageLocale?: PageletLocale;
    // -----------------------------------------------------------------
    // B4 dependency-injection seams (all OPTIONAL — when absent, the
    // orchestrator behaves exactly as in B1 so B1's test suite stays green
    // without re-mocking storage / clock / pricing).
    // -----------------------------------------------------------------
    /**
     * Cost budget — derived from `PageletSettings.maxInputTokens` /
     * `maxOutputTokens`. When set, `reviewNote()` runs a pre-flight token
     * check and rejects with `input_too_large` / `hard_cap_exceeded`
     * BEFORE issuing the LLM call (D018).
     */
    costBudget?: PageletCostBudget;
    /**
     * Cost tracker — accumulates per-call usage. When set, `reviewNote()`
     * records an entry on every successful call so the SuggestionCard
     * footer (B2) can display "this review used ~$0.003" (D022).
     */
    costTracker?: PageletCostTracker;
    /**
     * Rate limiter — enforces hourly / daily call caps (D020). When set,
     * `reviewNote()` calls `reserve()` before the LLM call and surfaces
     * `rate_limit_hourly` / `rate_limit_daily` if the gate rejects.
     */
    rateLimiter?: PageletRateLimiter;
    /**
     * Provider / model strings used as the pricing lookup composite key.
     * Pulled from settings in production. When omitted, the cost tracker
     * records the call as "pricing unknown" (D022 — explicit ~$? rather
     * than silently zero).
     */
    providerForPricing?: string;
    modelForPricing?: string;
    /**
     * Wrap every actual provider invocation after cost/rate admission.
     * Production uses this to share Pagelet first-use disclosure across
     * foreground Review and the other provider-backed Pagelet paths.
     */
    executeProviderCall?: <TResult>(
        invoke: () => Promise<TResult>,
        options: { signal: AbortSignal },
    ) => Promise<TResult>;
    /**
     * Declares that `executeProviderCall` performs the one rate-limit commit
     * for each actual invocation. Callers using this mode must omit
     * `rateLimiter`; otherwise one provider attempt could be double-counted.
     */
    providerCallOwnsRateLimitReservation?: boolean;
    /** Production wall-clock timeout for reviewNote. Omitted keeps legacy tests unbounded. */
    reviewTimeoutMs?: number;
    /** Emits user-visible progress hooks and testable progress telemetry. */
    onProgress?: (event: PageletReviewProgressEvent) => void;
}

const DEFAULT_OPTIONS: Required<
    Pick<
        PageletReviewModelOptions,
        | "maxRetries"
        | "temperature"
        | "disableStructuredOutput"
        | "disableFreeFormFallback"
        | "userMessageLocale"
    >
> = {
    maxRetries: 1,
    temperature: 0.2,
    disableStructuredOutput: false,
    disableFreeFormFallback: false,
    // EN is a safer default than reading a window global at module load:
    // jest, storybook, and the Track A worktree all execute without a
    // configured Obsidian shell, and silently switching to a different
    // locale there would yield non-deterministic test output.
    userMessageLocale: "en",
};

type EffectiveReviewModelOptions = typeof DEFAULT_OPTIONS & PageletReviewModelOptions;

// ---------------------------------------------------------------------------
// Friendly error copy.
//
// Migrated to i18n keys in B3 (`src/locales/pagelet/{en,zh}.json`). The
// orchestrator looks up `pagelet.errors.<code>` via the shared loader and
// renders the result through `outcome.userMessage`. Callers that want to
// force a specific locale can pass `userMessageLocale` on the options
// bag — the default mirrors PA's UI language pick (D014 + D017).
//
// The map below is a translation table from internal error codes to i18n
// keys. Adding a new error code therefore requires THREE edits in lockstep:
//   1. extend `PageletReviewErrorCode` above
//   2. add the key here
//   3. add the localized string in en.json + zh.json
// The parity test in pa-locales-pagelet.test.ts guarantees (3) does not
// drift from (1).
// ---------------------------------------------------------------------------

const ERROR_MESSAGE_KEYS: Record<PageletReviewErrorCode, string> = {
    schema_invalid: "pagelet.errors.schema_invalid",
    parse_failed: "pagelet.errors.parse_failed",
    timeout: "pagelet.errors.timeout",
    provider_error: "pagelet.errors.provider_error",
    input_too_large: "pagelet.errors.input_too_large",
    hard_cap_exceeded: "pagelet.errors.hard_cap_exceeded",
    rate_limit_hourly: "pagelet.errors.rate_limit_hourly",
    rate_limit_daily: "pagelet.errors.rate_limit_daily",
};

/**
 * Best-effort English fallbacks for error codes whose i18n key isn't yet in
 * the locale dictionary. `pageletT` only returns the key name when no entry
 * is found anywhere — supplying a fallback here means the user reads a real
 * sentence, while the key-name surface still works for `console.warn` /
 * debug telemetry.
 *
 * Once B3 registers proper `pagelet.errors.input_too_large` /
 * `pagelet.errors.hard_cap_exceeded` strings (EN + ZH), these fallbacks
 * become dead branches — the dictionary hit takes precedence.
 */
const ERROR_MESSAGE_FALLBACKS: Partial<Record<PageletReviewErrorCode, string>> = {
    input_too_large:
        "Pagelet refused this review: the note exceeds the configured input token limit. Try splitting the note or lowering it under the cap.",
    hard_cap_exceeded:
        "Pagelet refused this review: input plus reserved output budget exceeds the 36K hard cap. Lower max input or max output tokens in settings.",
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Stateless orchestrator. Caller is expected to instantiate once and reuse
 * for many `reviewNote` calls — no per-call mutable state is kept.
 */
export class PageletReviewModel {
    private readonly factory: PageletChatModelFactory;
    private readonly options: PageletReviewModelOptions;

    constructor(
        factory: PageletChatModelFactory,
        options: PageletReviewModelOptions = {},
    ) {
        this.factory = factory;
        this.options = options;
    }

    async reviewNote(
        rawInput: PageletReviewInput,
        signal?: AbortSignal,
    ): Promise<PageletReviewOutcome> {
        // Validate input shape up front — bad inputs are programmer errors,
        // not LLM errors, and should fail loud rather than surface as
        // "provider_error" later.
        const parsedInput = PageletReviewInputSchema.parse(rawInput);
        const effectiveOpts = { ...DEFAULT_OPTIONS, ...this.options };
        if (effectiveOpts.providerCallOwnsRateLimitReservation && effectiveOpts.rateLimiter) {
            throw new Error(
                "Pagelet provider-call wrapper and model cannot both own rate-limit reservation",
            );
        }
        const now = this.options.now ?? Date.now;
        const reviewStartedAt = now();

        const diagnostics: PageletReviewDiagnostics = {
            path: "structured",
            attempts: 0,
            truncated: false,
            partial: false,
            droppedSuggestionsCount: 0,
            schemaErrors: [],
            elapsedMs: 0,
        };
        if (signal?.aborted) {
            return finalizeReviewOutcome(
                errorOutcome("timeout", diagnostics, effectiveOpts.userMessageLocale),
                diagnostics,
                reviewStartedAt,
                now,
            );
        }
        const deadline = new PageletReviewDeadline(signal, this.options.reviewTimeoutMs);

        try {
            const validSegmentIds = parsedInput.segments.map((s) => s.id);
            const outputLanguage = parsedInput.outputLanguageOverride ?? parsedInput.detectedLanguage;
            const targetSuggestionCount = resolvePageletTargetSuggestionCount(
                parsedInput.targetSuggestionCount,
            );
            const promptStartedAt = now();
            const systemPrompt = buildSystemPrompt(outputLanguage);
            const userPrompt = buildUserPrompt(parsedInput);
            recordPageletTiming(diagnostics, "prompt_build", now() - promptStartedAt, {
                segmentCount: parsedInput.segments.length,
                mode: parsedInput.mode,
                targetSuggestionCount,
            });

            // ---- B4 gate 1: cost pre-flight (D018) ----------------------------
            // Pre-flight FIRST because we don't want to burn a rate-limit slot
            // on a request we'd reject for size. The order is:
            //   1. estimate input tokens
            //   2. preCheckCost → may return input_too_large / hard_cap_exceeded
            //   3. rateLimiter.reserve → may return rate_limit_*
            //   4. factory + LLM
            //   5. cost record on success
            effectiveOpts.onProgress?.({ phase: "cost_precheck" });
            const costStartedAt = now();
            const costGateResult = this.runCostPreCheck(
                systemPrompt,
                userPrompt,
                diagnostics,
                effectiveOpts,
            );
            recordPageletTiming(diagnostics, "cost_precheck", now() - costStartedAt, {
                inputEstimateCount: diagnostics.estimatedInputTokens ?? 0,
                rejected: Boolean(costGateResult),
            });
            if (costGateResult) {
                return finalizeReviewOutcome(costGateResult, diagnostics, reviewStartedAt, now);
            }

            // ---- B4 gate 2: rate-limit pre-flight (D020) ---------------------
            effectiveOpts.onProgress?.({ phase: "rate_limit" });
            const ratePeekStartedAt = now();
            const ratePeekResult = await this.runRateLimitPeek(diagnostics, effectiveOpts, deadline);
            recordPageletTiming(diagnostics, "rate_limit_peek", now() - ratePeekStartedAt, {
                rejected: Boolean(ratePeekResult),
            });
            if (ratePeekResult) {
                return finalizeReviewOutcome(ratePeekResult, diagnostics, reviewStartedAt, now);
            }

            let model: PageletChatModelLike;
            try {
                effectiveOpts.onProgress?.({ phase: "model_setup" });
                const factoryStartedAt = now();
                model = await deadline.race(this.factory(effectiveOpts.temperature, {
                    modelName: effectiveOpts.modelName,
                }));
                recordPageletTiming(diagnostics, "model_factory", now() - factoryStartedAt, {
                    modelName: effectiveOpts.modelName,
                });
            } catch (err) {
                diagnostics.providerError = errorMessage(err);
                const code = deadline.isDeadlineError(err) || isAbortError(err) ? "timeout" : "provider_error";
                return finalizeReviewOutcome(
                    errorOutcome(code, diagnostics, effectiveOpts.userMessageLocale),
                    diagnostics,
                    reviewStartedAt,
                    now,
                );
            }

            const canUseStructured =
                !effectiveOpts.disableStructuredOutput
                && typeof model.withStructuredOutput === "function";

            // Path A: structured output. Provider supports schema enforcement.
            if (canUseStructured) {
                const structuredStartedAt = now();
                const structuredOutcome = await this.runStructured(
                    model,
                    systemPrompt,
                    userPrompt,
                    validSegmentIds,
                    parsedInput,
                    effectiveOpts,
                    diagnostics,
                    now,
                    deadline,
                );
                recordPageletTiming(diagnostics, "structured_path", now() - structuredStartedAt, {
                    returnedOutcome: Boolean(structuredOutcome),
                    maxRetries: effectiveOpts.maxRetries,
                });
                if (structuredOutcome) {
                    this.maybeRecordCost(structuredOutcome, diagnostics, effectiveOpts);
                    return finalizeReviewOutcome(structuredOutcome, diagnostics, reviewStartedAt, now);
                }
                // structuredOutcome returns null when we should fall through to JSON mode.
            }

            // Path B: JSON mode (prompt-engineered) — fires either when the
            // provider has no withStructuredOutput, or when the structured path
            // exhausted retries AND free-form fallback is allowed.
            if (effectiveOpts.disableFreeFormFallback) {
                return finalizeReviewOutcome(
                    errorOutcome(
                        diagnostics.schemaErrors.length > 0 ? "schema_invalid" : "parse_failed",
                        diagnostics,
                        effectiveOpts.userMessageLocale,
                    ),
                    diagnostics,
                    reviewStartedAt,
                    now,
                );
            }

            effectiveOpts.onProgress?.({ phase: "json_mode_fallback" });
            const jsonModeStartedAt = now();
            const jsonModeOutcome = await this.runWithJsonMode(
                model,
                systemPrompt,
                userPrompt,
                validSegmentIds,
                parsedInput,
                effectiveOpts,
                diagnostics,
                now,
                deadline,
            );
            recordPageletTiming(diagnostics, "json_mode_path", now() - jsonModeStartedAt, {
                maxRetries: effectiveOpts.maxRetries,
            });
            this.maybeRecordCost(jsonModeOutcome, diagnostics, effectiveOpts);
            return finalizeReviewOutcome(jsonModeOutcome, diagnostics, reviewStartedAt, now);
        } catch (err) {
            if (deadline.isDeadlineError(err) || isAbortError(err)) {
                return finalizeReviewOutcome(
                    errorOutcome("timeout", diagnostics, effectiveOpts.userMessageLocale),
                    diagnostics,
                    reviewStartedAt,
                    now,
                );
            }
            throw err;
        } finally {
            deadline.dispose();
        }
    }

    // ----- B4 gate helpers ---------------------------------------------------

    /**
     * Estimate input tokens, run pre-flight cost check, and (if rejected)
     * return a terminal error outcome. Stores the estimate on diagnostics
     * regardless of outcome so telemetry can see what the size looked like.
     */
    private runCostPreCheck(
        systemPrompt: string,
        userPrompt: string,
        diagnostics: PageletReviewDiagnostics,
        opts: EffectiveReviewModelOptions,
    ): PageletReviewOutcome | null {
        const budget = opts.costBudget;
        if (!budget) return null;
        const estimated = estimateTokens(systemPrompt) + estimateTokens(userPrompt);
        diagnostics.estimatedInputTokens = estimated;
        const decision: CostPreCheckDecision = preCheckCost(estimated, budget);
        if (decision.ok) return null;
        diagnostics.gateRejection = {
            kind: "cost",
            reason: decision.reason,
            detail: decision.detail,
        };
        return errorOutcome(decision.reason, diagnostics, opts.userMessageLocale);
    }

    /**
     * Reserve a slot from the rate limiter. On `ok` returns null (the
     * caller proceeds); on rejection, surfaces the corresponding error
     * code AND stamps gateRejection so the UI can render "available in
     * N min" without re-querying the limiter.
     */
    private async runRateLimitGate(
        diagnostics: PageletReviewDiagnostics,
        opts: EffectiveReviewModelOptions,
        deadline?: PageletReviewDeadline,
    ): Promise<PageletReviewOutcome | null> {
        const limiter = opts.rateLimiter;
        if (!limiter) return null;
        const decision: RateLimitDecision = deadline
            ? await deadline.race(limiter.reserve())
            : await limiter.reserve();
        if (decision.ok) return null;
        diagnostics.gateRejection = {
            kind: "rate-limit",
            reason: decision.reason,
            resumeAt: decision.resumeAt,
        };
        const code: PageletReviewErrorCode =
            decision.reason === "hr-cap" ? "rate_limit_hourly" : "rate_limit_daily";
        return errorOutcome(code, diagnostics, opts.userMessageLocale);
    }

    private async runRateLimitPeek(
        diagnostics: PageletReviewDiagnostics,
        opts: EffectiveReviewModelOptions,
        deadline?: PageletReviewDeadline,
    ): Promise<PageletReviewOutcome | null> {
        const limiter = opts.rateLimiter;
        if (!limiter) return null;
        const decision: RateLimitDecision = deadline
            ? await deadline.race(limiter.peek())
            : await limiter.peek();
        if (decision.ok) return null;
        diagnostics.gateRejection = {
            kind: "rate-limit",
            reason: decision.reason,
            resumeAt: decision.resumeAt,
        };
        const code: PageletReviewErrorCode =
            decision.reason === "hr-cap" ? "rate_limit_hourly" : "rate_limit_daily";
        return errorOutcome(code, diagnostics, opts.userMessageLocale);
    }

    /**
     * Record cost on a successful outcome (`ok` or `empty`). Errors don't
     * record because the LLM may have produced no usable tokens — we don't
     * want a 401 to show up as "$0.000" in the cost history.
     *
     * Output-token estimation is best-effort:
     *   - structured path: stringify the result to approximate the model's
     *     emitted JSON length.
     *   - empty path: same approach; an empty `suggestions: []` still costs
     *     a few tokens of envelope.
     */
    private maybeRecordCost(
        outcome: PageletReviewOutcome,
        diagnostics: PageletReviewDiagnostics,
        opts: EffectiveReviewModelOptions,
    ): void {
        const tracker = opts.costTracker;
        if (!tracker) return;
        if (outcome.status !== "ok" && outcome.status !== "empty") return;
        const inputTokens = (diagnostics.estimatedInputTokens ?? 0) * Math.max(1, diagnostics.attempts);
        const outputTokens = estimateTokens(safeStringify(outcome.result));
        const entry = tracker.record({
            inputTokens,
            outputTokens,
            provider: opts.providerForPricing,
            model: opts.modelForPricing,
        });
        diagnostics.costEntry = entry;
    }

    // ----- Structured path ---------------------------------------------------

    /**
     * Returns:
     *   - PageletReviewOutcome → terminal (success/empty or surfaced error)
     *   - null → caller should fall through to JSON-mode fallback
     */
    private async runStructured(
        model: PageletChatModelLike,
        systemPrompt: string,
        userPrompt: string,
        validSegmentIds: string[],
        input: PageletReviewInput,
        opts: EffectiveReviewModelOptions,
        diagnostics: PageletReviewDiagnostics,
        now: () => number,
        deadline: PageletReviewDeadline,
    ): Promise<PageletReviewOutcome | null> {
        // Cast through unknown so we don't lock into a specific zod->Runnable
        // overload signature that may shift between LangChain releases.
        const structured = model.withStructuredOutput!<unknown>(
            PageletStructuredReviewResultSchema as unknown,
            { name: "pagelet_review", method: "jsonSchema", strict: true },
        );

        let attempt = 0;
        let lastZodErrors: string[] = [];
        let currentUserPrompt = userPrompt;

        // 1 attempt + N retries
        while (attempt <= opts.maxRetries) {
            diagnostics.path = attempt === 0 ? "structured" : "structured_retry";
            opts.onProgress?.({
                phase: "structured_attempt",
                path: diagnostics.path,
                attempt: attempt + 1,
                maxAttempts: opts.maxRetries + 1,
            });
            const rateGateResult = await this.runRateLimitGate(diagnostics, opts, deadline);
            if (rateGateResult) return rateGateResult;
            diagnostics.attempts += 1;
            const started = now();
            let raw: unknown;
            try {
                const invoke = () => {
                    if (deadline.signal.aborted) return Promise.reject(createPageletAbortError());
                    return structured.invoke(
                        buildMessages(systemPrompt, currentUserPrompt),
                        { signal: deadline.signal },
                    );
                };
                if (deadline.signal.aborted) throw createPageletAbortError();
                raw = await deadline.race(
                    opts.executeProviderCall
                        ? opts.executeProviderCall(invoke, { signal: deadline.signal })
                        : invoke(),
                );
            } catch (err) {
                if (err instanceof PageletProviderCallControlError) throw err;
                const elapsedMs = Math.max(0, now() - started);
                diagnostics.elapsedMs += elapsedMs;
                if (deadline.isDeadlineError(err) || isAbortError(err)) {
                    recordPageletTiming(diagnostics, "llm_attempt", elapsedMs, {
                        path: diagnostics.path,
                        attempt: attempt + 1,
                        outcome: "timeout",
                    });
                    return errorOutcome("timeout", diagnostics, opts.userMessageLocale);
                }
                // withStructuredOutput throws on schema validation failure;
                // treat the throw as a schema-invalid signal and either
                // retry or fall through to free-form fallback.
                lastZodErrors = summarizeZodIssues(err);
                diagnostics.schemaErrors = lastZodErrors;
                diagnostics.providerError = errorMessage(err);
                recordPageletTiming(diagnostics, "llm_attempt", elapsedMs, {
                    path: diagnostics.path,
                    attempt: attempt + 1,
                    outcome: "schema_invalid",
                    error: diagnostics.providerError,
                });
                if (attempt === opts.maxRetries) break;
                currentUserPrompt = appendRetryHint(userPrompt, lastZodErrors);
                attempt += 1;
                continue;
            }
            const elapsedMs = Math.max(0, now() - started);
            diagnostics.elapsedMs += elapsedMs;

            const finalized = finalizeStructuredPayload(raw, validSegmentIds, diagnostics);
            if (finalized.ok) {
                recordPageletTiming(diagnostics, "llm_attempt", elapsedMs, {
                    path: diagnostics.path,
                    attempt: attempt + 1,
                    outcome: finalized.outcome.status,
                    suggestionCount: "result" in finalized.outcome
                        ? finalized.outcome.result.suggestions.length
                        : 0,
                });
                return finalized.outcome;
            }

            lastZodErrors = finalized.errors;
            diagnostics.schemaErrors = lastZodErrors;
            recordPageletTiming(diagnostics, "llm_attempt", elapsedMs, {
                path: diagnostics.path,
                attempt: attempt + 1,
                outcome: "schema_invalid",
                errorCount: lastZodErrors.length,
            });
            if (attempt === opts.maxRetries) break;
            currentUserPrompt = appendRetryHint(userPrompt, lastZodErrors);
            attempt += 1;
        }

        // Structured path exhausted. Caller decides whether to try JSON mode
        // (controlled by disableFreeFormFallback).
        return null;
    }

    // ----- JSON-mode (free-form fallback) path -------------------------------

    private async runWithJsonMode(
        model: PageletChatModelLike,
        systemPrompt: string,
        userPrompt: string,
        validSegmentIds: string[],
        input: PageletReviewInput,
        opts: EffectiveReviewModelOptions,
        diagnostics: PageletReviewDiagnostics,
        now: () => number,
        deadline: PageletReviewDeadline,
    ): Promise<PageletReviewOutcome> {
        const augmentedSystem = `${systemPrompt}${buildJsonModeSchemaHint()}`;
        let attempt = 0;
        let currentUserPrompt = userPrompt;
        let lastErrorCode: PageletReviewErrorCode = "parse_failed";
        let lastZodErrors: string[] = [];

        while (attempt <= opts.maxRetries) {
            diagnostics.path = attempt === 0 ? "json_mode" : "json_mode_retry";
            opts.onProgress?.({
                phase: "json_mode_attempt",
                path: diagnostics.path,
                attempt: attempt + 1,
                maxAttempts: opts.maxRetries + 1,
            });
            const rateGateResult = await this.runRateLimitGate(diagnostics, opts, deadline);
            if (rateGateResult) return rateGateResult;
            diagnostics.attempts += 1;
            const started = now();
            let response: { content: unknown };
            try {
                const invoke = () => {
                    if (deadline.signal.aborted) return Promise.reject(createPageletAbortError());
                    return model.invoke(
                        buildMessages(augmentedSystem, currentUserPrompt),
                        { signal: deadline.signal },
                    );
                };
                if (deadline.signal.aborted) throw createPageletAbortError();
                response = await deadline.race(
                    opts.executeProviderCall
                        ? opts.executeProviderCall(invoke, { signal: deadline.signal })
                        : invoke(),
                );
            } catch (err) {
                if (err instanceof PageletProviderCallControlError) throw err;
                const elapsedMs = Math.max(0, now() - started);
                diagnostics.elapsedMs += elapsedMs;
                if (deadline.isDeadlineError(err) || isAbortError(err)) {
                    recordPageletTiming(diagnostics, "llm_attempt", elapsedMs, {
                        path: diagnostics.path,
                        attempt: attempt + 1,
                        outcome: "timeout",
                    });
                    return errorOutcome("timeout", diagnostics, opts.userMessageLocale);
                }
                diagnostics.providerError = errorMessage(err);
                recordPageletTiming(diagnostics, "llm_attempt", elapsedMs, {
                    path: diagnostics.path,
                    attempt: attempt + 1,
                    outcome: "provider_error",
                    error: diagnostics.providerError,
                });
                return errorOutcome("provider_error", diagnostics, opts.userMessageLocale);
            }
            const elapsedMs = Math.max(0, now() - started);
            diagnostics.elapsedMs += elapsedMs;

            const text = coerceTextContent(response.content);
            const payloadStr = extractJsonPayload(text);
            if (!payloadStr) {
                lastErrorCode = "parse_failed";
                recordPageletTiming(diagnostics, "llm_attempt", elapsedMs, {
                    path: diagnostics.path,
                    attempt: attempt + 1,
                    outcome: "parse_failed",
                });
                if (attempt === opts.maxRetries) break;
                currentUserPrompt = appendParseRetryHint(userPrompt);
                attempt += 1;
                continue;
            }

            const parsed = tolerantJsonParse(payloadStr);
            if (parsed == null) {
                lastErrorCode = "parse_failed";
                recordPageletTiming(diagnostics, "llm_attempt", elapsedMs, {
                    path: diagnostics.path,
                    attempt: attempt + 1,
                    outcome: "parse_failed",
                });
                if (attempt === opts.maxRetries) break;
                currentUserPrompt = appendParseRetryHint(userPrompt);
                attempt += 1;
                continue;
            }

            const finalized = finalizeStructuredPayload(parsed, validSegmentIds, diagnostics);
            if (finalized.ok) {
                recordPageletTiming(diagnostics, "llm_attempt", elapsedMs, {
                    path: diagnostics.path,
                    attempt: attempt + 1,
                    outcome: finalized.outcome.status,
                    suggestionCount: "result" in finalized.outcome
                        ? finalized.outcome.result.suggestions.length
                        : 0,
                });
                return finalized.outcome;
            }

            lastZodErrors = finalized.errors;
            lastErrorCode = "schema_invalid";
            diagnostics.schemaErrors = lastZodErrors;
            recordPageletTiming(diagnostics, "llm_attempt", elapsedMs, {
                path: diagnostics.path,
                attempt: attempt + 1,
                outcome: "schema_invalid",
                errorCount: lastZodErrors.length,
            });
            if (attempt === opts.maxRetries) break;
            currentUserPrompt = appendRetryHint(userPrompt, lastZodErrors);
            attempt += 1;
        }

        return errorOutcome(lastErrorCode, diagnostics, opts.userMessageLocale);
    }
}

// ---------------------------------------------------------------------------
// Convenience top-level API — keeps callers' import surface flat.
// ---------------------------------------------------------------------------

/**
 * One-shot helper for callers that don't need to keep a model around.
 *
 * Most production callers will construct a `PageletReviewModel` once during
 * adapter setup; this helper exists for tests and for ad-hoc commands.
 */
export async function reviewNote(
    factory: PageletChatModelFactory,
    input: PageletReviewInput,
    options: PageletReviewModelOptions = {},
    signal?: AbortSignal,
): Promise<PageletReviewOutcome> {
    return new PageletReviewModel(factory, options).reviewNote(input, signal);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function buildMessages(systemPrompt: string, userPrompt: string) {
    return [new SystemMessage(systemPrompt), new HumanMessage(userPrompt)];
}

/**
 * Take a parsed-payload candidate (from either structured output or
 * free-form fallback) and run it through:
 *   1. over-length truncation (row 5)
 *   2. zod validation
 *   3. source_id filtering (row 2 + row 6 partial)
 *   4. empty-suggestions handling (row 4)
 *
 * Returns either a finalized outcome OR a list of zod error strings the
 * caller can feed back into a corrective-retry prompt.
 */
type FinalizeResult =
    | { ok: true; outcome: PageletReviewOutcome }
    | { ok: false; errors: string[] };

function finalizeStructuredPayload(
    raw: unknown,
    validSegmentIds: string[],
    diagnostics: PageletReviewDiagnostics,
): FinalizeResult {
    // Some LangChain versions wrap the result in `{ parsed, raw }` when
    // includeRaw=true; we never request that, but be defensive anyway.
    const candidate =
        raw && typeof raw === "object" && "parsed" in raw && "raw" in raw
            ? (raw as { parsed: unknown }).parsed
            : raw;

    // Some models forget the schema_version. Stamp it before validation so
    // an otherwise-valid suggestion list isn't thrown out for a missing
    // literal — this is intentional schema repair, not laxness; the field
    // is a constant.
    const normalizedCandidate = normalizePageletReviewPayload(candidate);
    const stampedCandidate = stampDefaultSchemaVersion(normalizedCandidate);
    const truncation = truncateOverlongFields(stampedCandidate);
    if (truncation.truncated) diagnostics.truncated = true;

    const parseResult = PageletReviewResultSchema.safeParse(truncation.payload);
    if (!parseResult.success) {
        return { ok: false, errors: summarizeZodIssues(parseResult.error) };
    }

    const filtered = filterSuggestionsBySourceIds(parseResult.data.suggestions, validSegmentIds);
    if (filtered.droppedCount > 0) {
        diagnostics.droppedSuggestionsCount += filtered.droppedCount;
        diagnostics.partial = true;
    }
    if (parseResult.data.suggestions.length > 0 && filtered.suggestions.length === 0) {
        return {
            ok: false,
            errors: ["every suggestion.source_id referenced an unknown segment id"],
        };
    }

    const finalized: PageletReviewResult = {
        ...parseResult.data,
        suggestions: filtered.suggestions,
    };

    if (finalized.suggestions.length === 0) {
        return {
            ok: true,
            outcome: { status: "empty", result: finalized, diagnostics },
        };
    }
    return { ok: true, outcome: { status: "ok", result: finalized, diagnostics } };
}

function stampDefaultSchemaVersion(payload: unknown): unknown {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
    const obj = payload as Record<string, unknown>;
    if (obj.schema_version == null) {
        return { ...obj, schema_version: PAGELET_SCHEMA_VERSION };
    }
    return obj;
}

function normalizePageletReviewPayload(payload: unknown): unknown {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
    const root = payload as Record<string, unknown>;
    const suggestions = Array.isArray(root.suggestions)
        ? root.suggestions.map((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return item;
            const suggestion = item as Record<string, unknown>;
            return {
                ...suggestion,
                related_notes: Array.isArray(suggestion.related_notes)
                    ? suggestion.related_notes
                    : [],
            };
        })
        : root.suggestions;
    return {
        ...root,
        suggestions,
        overall_remark: typeof root.overall_remark === "string"
            ? root.overall_remark
            : "",
    };
}

function coerceTextContent(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .map((chunk) => {
                if (typeof chunk === "string") return chunk;
                if (chunk && typeof chunk === "object" && "text" in chunk) {
                    const text = (chunk as { text?: unknown }).text;
                    return typeof text === "string" ? text : "";
                }
                return "";
            })
            .join("");
    }
    if (content == null) return "";
    return String(content);
}

function isAbortError(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    const name = (err as { name?: unknown }).name;
    const code = (err as { code?: unknown }).code;
    return name === "AbortError" || code === "ABORT_ERR";
}

const PAGELET_REVIEW_TIMEOUT_ERROR_NAME = "PageletReviewTimeoutError";

function createPageletReviewTimeoutError(): Error {
    const error = new Error("Pagelet review timed out.");
    error.name = PAGELET_REVIEW_TIMEOUT_ERROR_NAME;
    return error;
}

function createPageletAbortError(): Error {
    const error = new Error("Pagelet review aborted.");
    error.name = "AbortError";
    return error;
}

class PageletReviewDeadline {
    private readonly controller = new AbortController();
    private timeoutId: PlatformTimeoutHandle | null = null;
    private timedOut = false;
    private readonly onExternalAbort = () => {
        this.controller.abort();
    };

    constructor(
        private readonly externalSignal: AbortSignal | undefined,
        timeoutMs: number | undefined,
    ) {
        if (externalSignal?.aborted) {
            this.controller.abort();
        } else {
            externalSignal?.addEventListener("abort", this.onExternalAbort, { once: true });
        }

        if (timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs > 0) {
            this.timeoutId = setPlatformTimeout(() => {
                this.timedOut = true;
                this.controller.abort();
            }, timeoutMs);
        }
    }

    get signal(): AbortSignal {
        return this.controller.signal;
    }

    dispose(): void {
        if (this.timeoutId !== null) {
            clearPlatformTimeout(this.timeoutId);
            this.timeoutId = null;
        }
        this.externalSignal?.removeEventListener("abort", this.onExternalAbort);
    }

    isDeadlineError(error: unknown): boolean {
        return error instanceof Error && error.name === PAGELET_REVIEW_TIMEOUT_ERROR_NAME;
    }

    race<T>(promise: PromiseLike<T>): Promise<T> {
        if (this.timedOut) {
            return Promise.reject(createPageletReviewTimeoutError());
        }
        if (this.signal.aborted) {
            return Promise.reject(createPageletAbortError());
        }
        return new Promise<T>((resolve, reject) => {
            const cleanup = () => this.signal.removeEventListener("abort", onAbort);
            const onAbort = () => {
                cleanup();
                reject(this.timedOut
                    ? createPageletReviewTimeoutError()
                    : createPageletAbortError());
            };
            this.signal.addEventListener("abort", onAbort, { once: true });
            Promise.resolve(promise).then(
                (value) => {
                    cleanup();
                    resolve(value);
                },
                (error) => {
                    cleanup();
                    reject(toError(error));
                },
            );
        });
    }
}

function recordPageletTiming(
    diagnostics: PageletReviewDiagnostics,
    phase: string,
    elapsedMs: number,
    metadata?: Record<string, unknown>,
): void {
    const entry: PageletReviewTimingEntry = {
        phase,
        elapsedMs: Math.max(0, Math.round(elapsedMs)),
        ...(metadata ? { metadata } : {}),
    };
    (diagnostics.timings ??= []).push(entry);
}

function finalizeReviewOutcome(
    outcome: PageletReviewOutcome,
    diagnostics: PageletReviewDiagnostics,
    startedAt: number,
    now: () => number,
): PageletReviewOutcome {
    diagnostics.totalElapsedMs = Math.max(0, Math.round(now() - startedAt));
    return outcome;
}

function errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    try {
        return JSON.stringify(err);
    } catch {
        return "unknown error";
    }
}

/**
 * Stringify a value for output-token estimation, swallowing circular-ref
 * errors. The fallback uses `String(value)` which gives a meaningful
 * approximation (`[object Object]` is ~16 chars, ~4 tokens) so cost
 * accounting degrades gracefully on pathological payloads.
 */
function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value) ?? "";
    } catch {
        return String(value);
    }
}

function errorOutcome(
    code: PageletReviewErrorCode,
    diagnostics: PageletReviewDiagnostics,
    locale: PageletLocale = "en",
): PageletReviewOutcome {
    return {
        status: "error",
        errorCode: code,
        userMessage: resolveErrorMessage(code, locale),
        diagnostics,
    };
}

/**
 * Resolve the i18n key for an error code into a user-facing string.
 *
 * Tested behaviour: a missing key (e.g. translator forgot ZH) falls back
 * to the EN dictionary, and a missing EN entry surfaces as the literal
 * i18n key so the regression is loud at runtime and trivially greppable.
 * See `pageletT` in `src/locales/pagelet/index.ts`.
 */
function resolveErrorMessage(code: PageletReviewErrorCode, locale: PageletLocale): string {
    return pageletT(ERROR_MESSAGE_KEYS[code], locale, undefined, ERROR_MESSAGE_FALLBACKS[code]);
}

function appendRetryHint(originalUserPrompt: string, errors: readonly string[]): string {
    const errorList = errors.length > 0 ? errors.join("; ") : "schema mismatch";
    return [
        originalUserPrompt,
        "",
        "Previous output did not match the schema; fix ONLY the malformed fields and re-emit valid JSON.",
        `Validation errors: ${errorList}`,
        "Remember: every suggestion.source_id MUST equal a provided segment id.",
    ].join("\n");
}

function appendParseRetryHint(originalUserPrompt: string): string {
    return [
        originalUserPrompt,
        "",
        "Previous output could not be parsed as JSON. Re-emit a SINGLE JSON object only — no code fences, no commentary, no trailing commas.",
    ].join("\n");
}

// Re-export schema types for convenience (callers usually want both).
export type {
    PageletReviewInput,
    PageletReviewResult,
    PageletSuggestion,
};
export { PageletReviewInputSchema, PageletReviewResultSchema, PageletSuggestionSchema };
