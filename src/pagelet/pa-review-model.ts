/* Copyright 2023 edonyzpc */

/**
 * Pagelet (Review Assistant) v1 — structured output orchestration.
 *
 * Spec source: `docs/review-assistant-sdd.md` §2.2 + §4 + D026.
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
    PAGELET_SCHEMA_VERSION,
    buildJsonModeSchemaHint,
    buildSystemPrompt,
    buildUserPrompt,
    extractJsonPayload,
    filterSuggestionsBySourceIds,
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
    // B4 — the four new error codes deliberately reuse `pagelet.cost.*` keys
    // that B3 already registered. Mapping rationale:
    //   - rate_limit_hourly / rate_limit_daily reuse `pagelet.cost.limitReached`
    //     because the user-facing copy ("Pagelet hit the daily call limit. It
    //     will resume tomorrow.") is close enough for both cases. A future
    //     B3 follow-up may split these into distinct hourly vs daily strings;
    //     the codes already exist so that split is purely a translation edit.
    //   - input_too_large / hard_cap_exceeded fall through to the key itself
    //     for now — the `pageletT` loader surfaces the key string, which is
    //     loudly visible during the v1 beta so missing translations get
    //     caught in user feedback rather than silently degrading. The
    //     `ERROR_MESSAGE_FALLBACKS` below provides a sane English fallback
    //     so end users still get a readable sentence.
    input_too_large: "pagelet.errors.input_too_large",
    hard_cap_exceeded: "pagelet.errors.hard_cap_exceeded",
    rate_limit_hourly: "pagelet.cost.limitReached",
    rate_limit_daily: "pagelet.cost.limitReached",
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
        const now = this.options.now ?? Date.now;

        const diagnostics: PageletReviewDiagnostics = {
            path: "structured",
            attempts: 0,
            truncated: false,
            partial: false,
            droppedSuggestionsCount: 0,
            schemaErrors: [],
            elapsedMs: 0,
        };

        const validSegmentIds = parsedInput.segments.map((s) => s.id);
        const systemPrompt = buildSystemPrompt(parsedInput.detectedLanguage);
        const userPrompt = buildUserPrompt(parsedInput);

        // ---- B4 gate 1: cost pre-flight (D018) ----------------------------
        // Pre-flight FIRST because we don't want to burn a rate-limit slot
        // on a request we'd reject for size. The order is:
        //   1. estimate input tokens
        //   2. preCheckCost → may return input_too_large / hard_cap_exceeded
        //   3. rateLimiter.reserve → may return rate_limit_*
        //   4. factory + LLM
        //   5. cost record on success
        const costGateResult = this.runCostPreCheck(
            systemPrompt,
            userPrompt,
            diagnostics,
            effectiveOpts,
        );
        if (costGateResult) return costGateResult;

        // ---- B4 gate 2: rate-limit reservation (D020) ---------------------
        const rateGateResult = await this.runRateLimitGate(diagnostics, effectiveOpts);
        if (rateGateResult) return rateGateResult;

        let model: PageletChatModelLike;
        try {
            model = await this.factory(effectiveOpts.temperature, {
                modelName: effectiveOpts.modelName,
            });
        } catch (err) {
            diagnostics.providerError = errorMessage(err);
            return errorOutcome("provider_error", diagnostics, effectiveOpts.userMessageLocale);
        }

        const canUseStructured =
            !effectiveOpts.disableStructuredOutput
            && typeof model.withStructuredOutput === "function";

        // Path A: structured output. Provider supports schema enforcement.
        if (canUseStructured) {
            const structuredOutcome = await this.runStructured(
                model,
                systemPrompt,
                userPrompt,
                validSegmentIds,
                parsedInput,
                effectiveOpts,
                diagnostics,
                now,
                signal,
            );
            if (structuredOutcome) {
                this.maybeRecordCost(structuredOutcome, diagnostics, effectiveOpts);
                return structuredOutcome;
            }
            // structuredOutcome returns null when we should fall through to JSON mode.
        }

        // Path B: JSON mode (prompt-engineered) — fires either when the
        // provider has no withStructuredOutput, or when the structured path
        // exhausted retries AND free-form fallback is allowed.
        if (effectiveOpts.disableFreeFormFallback) {
            return errorOutcome(
                diagnostics.schemaErrors.length > 0 ? "schema_invalid" : "parse_failed",
                diagnostics,
                effectiveOpts.userMessageLocale,
            );
        }

        const jsonModeOutcome = await this.runWithJsonMode(
            model,
            systemPrompt,
            userPrompt,
            validSegmentIds,
            parsedInput,
            effectiveOpts,
            diagnostics,
            now,
            signal,
        );
        this.maybeRecordCost(jsonModeOutcome, diagnostics, effectiveOpts);
        return jsonModeOutcome;
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
        opts: typeof DEFAULT_OPTIONS & PageletReviewModelOptions,
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
        opts: typeof DEFAULT_OPTIONS & PageletReviewModelOptions,
    ): Promise<PageletReviewOutcome | null> {
        const limiter = opts.rateLimiter;
        if (!limiter) return null;
        const decision: RateLimitDecision = await limiter.reserve();
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
        opts: typeof DEFAULT_OPTIONS & PageletReviewModelOptions,
    ): void {
        const tracker = opts.costTracker;
        if (!tracker) return;
        if (outcome.status !== "ok" && outcome.status !== "empty") return;
        const inputTokens = diagnostics.estimatedInputTokens ?? 0;
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
        opts: typeof DEFAULT_OPTIONS,
        diagnostics: PageletReviewDiagnostics,
        now: () => number,
        signal?: AbortSignal,
    ): Promise<PageletReviewOutcome | null> {
        // Cast through unknown so we don't lock into a specific zod->Runnable
        // overload signature that may shift between LangChain releases.
        const structured = model.withStructuredOutput!<unknown>(
            PageletReviewResultSchema as unknown,
            { name: "pagelet_review", method: "json_schema", strict: true },
        );

        let attempt = 0;
        let lastZodErrors: string[] = [];
        let currentUserPrompt = userPrompt;

        // 1 attempt + N retries
        while (attempt <= opts.maxRetries) {
            diagnostics.path = attempt === 0 ? "structured" : "structured_retry";
            diagnostics.attempts += 1;
            const started = now();
            let raw: unknown;
            try {
                raw = await structured.invoke(
                    buildMessages(systemPrompt, currentUserPrompt),
                    signal ? { signal } : undefined,
                );
            } catch (err) {
                diagnostics.elapsedMs += Math.max(0, now() - started);
                if (isAbortError(err)) return errorOutcome("timeout", diagnostics, opts.userMessageLocale);
                // withStructuredOutput throws on schema validation failure;
                // treat the throw as a schema-invalid signal and either
                // retry or fall through to free-form fallback.
                lastZodErrors = summarizeZodIssues(err);
                diagnostics.schemaErrors = lastZodErrors;
                diagnostics.providerError = errorMessage(err);
                if (attempt === opts.maxRetries) break;
                currentUserPrompt = appendRetryHint(userPrompt, lastZodErrors);
                attempt += 1;
                continue;
            }
            diagnostics.elapsedMs += Math.max(0, now() - started);

            const finalized = finalizeStructuredPayload(raw, validSegmentIds, diagnostics);
            if (finalized.ok) return finalized.outcome;

            lastZodErrors = finalized.errors;
            diagnostics.schemaErrors = lastZodErrors;
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
        opts: typeof DEFAULT_OPTIONS,
        diagnostics: PageletReviewDiagnostics,
        now: () => number,
        signal?: AbortSignal,
    ): Promise<PageletReviewOutcome> {
        const augmentedSystem = `${systemPrompt}${buildJsonModeSchemaHint()}`;
        let attempt = 0;
        let currentUserPrompt = userPrompt;
        let lastErrorCode: PageletReviewErrorCode = "parse_failed";
        let lastZodErrors: string[] = [];

        while (attempt <= opts.maxRetries) {
            diagnostics.path = attempt === 0 ? "json_mode" : "json_mode_retry";
            diagnostics.attempts += 1;
            const started = now();
            let response: { content: unknown };
            try {
                response = await model.invoke(
                    buildMessages(augmentedSystem, currentUserPrompt),
                    signal ? { signal } : undefined,
                );
            } catch (err) {
                diagnostics.elapsedMs += Math.max(0, now() - started);
                if (isAbortError(err)) return errorOutcome("timeout", diagnostics, opts.userMessageLocale);
                diagnostics.providerError = errorMessage(err);
                return errorOutcome("provider_error", diagnostics, opts.userMessageLocale);
            }
            diagnostics.elapsedMs += Math.max(0, now() - started);

            const text = coerceTextContent(response.content);
            const payloadStr = extractJsonPayload(text);
            if (!payloadStr) {
                lastErrorCode = "parse_failed";
                if (attempt === opts.maxRetries) break;
                currentUserPrompt = appendParseRetryHint(userPrompt);
                attempt += 1;
                continue;
            }

            const parsed = tolerantJsonParse(payloadStr);
            if (parsed == null) {
                lastErrorCode = "parse_failed";
                if (attempt === opts.maxRetries) break;
                currentUserPrompt = appendParseRetryHint(userPrompt);
                attempt += 1;
                continue;
            }

            const finalized = finalizeStructuredPayload(parsed, validSegmentIds, diagnostics);
            if (finalized.ok) return finalized.outcome;

            lastZodErrors = finalized.errors;
            lastErrorCode = "schema_invalid";
            diagnostics.schemaErrors = lastZodErrors;
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
    const stampedCandidate = stampDefaultSchemaVersion(candidate);
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
