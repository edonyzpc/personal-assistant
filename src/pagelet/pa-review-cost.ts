/* Copyright 2023 edonyzpc */

/**
 * Pagelet — cost ceiling + accounting.
 *
 * Spec source:
 *  - `docs/review-assistant-sdd.md` §7 (Cost Ceiling)
 *  - `docs/review-assistant-decisions.md` D018 (token caps), D022 (cost display)
 *
 * Responsibilities:
 *  - Token estimation (input-size pre-flight + output post-mortem).
 *  - Hard-cap enforcement (D018):  input ≤ user setting ≤ 32K; input + output
 *    budget ≤ 36K. The hardCap is a non-negotiable upper bound the user CANNOT
 *    raise from settings — it protects against prompt-injection blow-ups.
 *  - Best-effort USD pricing per provider/model, with explicit "unknown" sentinel
 *    rather than silently zeroing out the figure (D022 — "事后基于实际更准" is
 *    only honest when we know the price).
 *  - In-memory cost accumulator (per-session) — surfaces totals to B2 UI badge
 *    and to a future telemetry hook (§11). Persistence is OUT OF SCOPE here;
 *    rate-limit counters live in `pa-review-rate-limit.ts` and use a separate
 *    storage interface.
 *
 * Why this module does NOT pull in tiktoken:
 *  - PA's existing chat path has no tokenizer dep; adding one for one feature
 *    bloats the bundle (~1MB) and doesn't materially improve the cap behaviour
 *    (we want to reject a 100K-char note, not haggle over ±5% on a 7K one).
 *  - The character-class heuristic below over-estimates English by a hair and
 *    matches CJK ~1:1 with Qwen / cl100k empirics — conservatively safe for a
 *    "stop the runaway request" gate.
 *
 * Dependency-injection seams (for tests and Track C):
 *  - `now` clock — every API takes an injectable clock so the accumulator's
 *    `at` timestamp and any future windowing logic are deterministic.
 *  - `pricing` table — `PageletCostTracker` accepts a custom pricing dict so
 *    a beta release with new model names doesn't require shipping a code patch.
 */

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/**
 * Approximate token count for a string.
 *
 * Heuristic (intentionally conservative — over-estimates rather than under
 * so a 7990-char note that's borderline gets gated EARLY rather than blowing
 * past 8K silently):
 *
 *   - CJK ideographs (U+3400-U+9FFF, U+20000-U+2A6DF): 1 token / char.
 *     (Real tokenizers usually split here 0.7-1.2 chars/token; 1:1 is safe.)
 *   - Everything else (ASCII, punctuation, whitespace): ~4 chars / token.
 *     (cl100k / Qwen English avg ≈ 4 chars/token; rounding up is conservative.)
 *
 * The function intentionally counts whitespace toward ASCII budget because the
 * encoded form retains a space-prefix for each token (real tokenizers behave
 * the same way; ignoring whitespace would systematically under-count by ~15%).
 */
export function estimateTokens(text: string): number {
    if (typeof text !== "string" || text.length === 0) return 0;
    let cjk = 0;
    let other = 0;
    // Iterate codepoints so surrogate-paired supplementary CJK ideographs
    // count as one token, not two.
    for (const ch of text) {
        const code = ch.codePointAt(0)!;
        if (
            (code >= 0x3400 && code <= 0x4DBF)
            || (code >= 0x4E00 && code <= 0x9FFF)
            || (code >= 0xF900 && code <= 0xFAFF)
            || (code >= 0x20000 && code <= 0x2A6DF)
            || (code >= 0x2A700 && code <= 0x2B73F)
            || (code >= 0x2B740 && code <= 0x2B81F)
            || (code >= 0x2B820 && code <= 0x2CEAF)
        ) {
            cjk += 1;
        } else {
            other += 1;
        }
    }
    return cjk + Math.ceil(other / 4);
}

/**
 * Sum estimateTokens over an arbitrary set of strings — useful for prompt
 * composition where the input may be assembled from multiple sources
 * (system prompt + few-shot + user prompt).
 */
export function estimateTokensFor(parts: readonly string[]): number {
    let total = 0;
    for (const p of parts) total += estimateTokens(p);
    return total;
}

// ---------------------------------------------------------------------------
// Hard limits (D018, frozen — DO NOT relax without an explicit decision)
// ---------------------------------------------------------------------------

/**
 * Pagelet-wide token boundaries. `hardCap` is the inviolable input + output
 * ceiling; `maxInput` / `maxOutput` are the maxima the user can raise to from
 * the default; the defaults reflect "covers 90% of notes < 5000 字" per D018.
 *
 * Frozen so tests can compare with `toBe` and downstream code cannot
 * accidentally mutate the constant (which would break the gate for the
 * whole session).
 */
export const PAGELET_TOKEN_LIMITS = Object.freeze({
    /** Defaults the user gets out of the box. */
    defaultInput: 8_000,
    defaultOutput: 2_000,
    /** Upper bounds settable from the Settings UI (B3 enforces). */
    maxInput: 32_000,
    maxOutput: 4_000,
    /**
     * The absolute ceiling. Even if a user manually edits data.json to
     * raise both fields, the gate still refuses inputs that exceed this.
     */
    hardCap: 36_000,
});

// ---------------------------------------------------------------------------
// Pre-flight cost check (D018 enforcement at the orchestrator entry point)
// ---------------------------------------------------------------------------

/**
 * Caller-supplied budget. Sourced from `PageletSettings` (B3) but the gate
 * keeps the input/output ceilings as the only fields it actually needs —
 * leaving the rest of the settings shape free to evolve without affecting
 * cost enforcement.
 */
export interface PageletCostBudget {
    /** Settings-derived input cap; clamped to maxInput. */
    maxInputTokens: number;
    /** Settings-derived output cap; clamped to maxOutput. */
    maxOutputTokens: number;
}

/**
 * Outcome of a pre-flight check. The "ok" path returns the (clamped) effective
 * budget so the caller can pass it to the underlying LLM call (and so tests can
 * assert the clamping behavior explicitly).
 */
export type CostPreCheckDecision =
    | {
          ok: true;
          estimatedInputTokens: number;
          effectiveInputBudget: number;
          effectiveOutputBudget: number;
      }
    | {
          ok: false;
          reason: "input_too_large" | "hard_cap_exceeded";
          estimatedInputTokens: number;
          effectiveInputBudget: number;
          effectiveOutputBudget: number;
          /**
           * Human-friendly diagnostic text. NOT a user-facing message — the
           * orchestrator wraps the rejection in a typed errorCode and looks up
           * the i18n string. This string is for telemetry / debug logs only.
           */
          detail: string;
      };

/**
 * Clamp the user's setting against PAGELET_TOKEN_LIMITS and decide whether
 * the requested `estimatedInputTokens` fits within both the input cap AND
 * the combined hard cap.
 *
 * The function is pure (no I/O, no clock, no random) so unit tests can
 * exhaustively cover every boundary cell.
 */
export function preCheckCost(
    estimatedInputTokens: number,
    budget: PageletCostBudget,
): CostPreCheckDecision {
    // Defensive: a negative or non-finite estimate is a programmer error
    // (estimateTokens never returns it) but we clamp to 0 rather than
    // crashing — a 0-input note will be rejected downstream by the model
    // for a more informative reason.
    const inputEst = Number.isFinite(estimatedInputTokens) && estimatedInputTokens > 0
        ? Math.floor(estimatedInputTokens)
        : 0;

    const effectiveInputBudget = Math.max(
        1,
        Math.min(
            Math.floor(Number.isFinite(budget.maxInputTokens) ? budget.maxInputTokens : 0),
            PAGELET_TOKEN_LIMITS.maxInput,
        ),
    );
    const effectiveOutputBudget = Math.max(
        1,
        Math.min(
            Math.floor(Number.isFinite(budget.maxOutputTokens) ? budget.maxOutputTokens : 0),
            PAGELET_TOKEN_LIMITS.maxOutput,
        ),
    );

    if (inputEst > effectiveInputBudget) {
        return {
            ok: false,
            reason: "input_too_large",
            estimatedInputTokens: inputEst,
            effectiveInputBudget,
            effectiveOutputBudget,
            detail: `estimated input ${inputEst} > maxInput ${effectiveInputBudget}`,
        };
    }
    if (inputEst + effectiveOutputBudget > PAGELET_TOKEN_LIMITS.hardCap) {
        return {
            ok: false,
            reason: "hard_cap_exceeded",
            estimatedInputTokens: inputEst,
            effectiveInputBudget,
            effectiveOutputBudget,
            detail: `input ${inputEst} + output ${effectiveOutputBudget} > hardCap ${PAGELET_TOKEN_LIMITS.hardCap}`,
        };
    }
    return {
        ok: true,
        estimatedInputTokens: inputEst,
        effectiveInputBudget,
        effectiveOutputBudget,
    };
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/**
 * Per-model USD pricing. Numbers are dollars per 1,000 tokens.
 *
 * Sources (as of 2026-06; check pricing pages before bumping):
 *  - OpenAI gpt-4o-mini: $0.15 / 1M input, $0.60 / 1M output
 *  - DashScope qwen-plus: ~$0.40 / 1M input, $1.20 / 1M output (approx)
 *  - Bailian qwen-turbo: ~$0.05 / 1M input, $0.15 / 1M output (approx)
 *
 * "Approx" entries are vendor pricing-page snapshots, NOT contractual; we
 * display "~$X.YYY" downstream so users understand the inherent fuzziness.
 *
 * Keys are matched against a `${provider}:${model}` composite. Unknown
 * combinations fall back to {@link UNKNOWN_PRICING} — no silent zero.
 */
export const PAGELET_DEFAULT_PRICING: Readonly<Record<string, PageletPricingEntry>> = Object.freeze({
    "openai:gpt-4o-mini": Object.freeze({ inputPerKToken: 0.00015, outputPerKToken: 0.0006 }),
    "openai:gpt-4o": Object.freeze({ inputPerKToken: 0.0025, outputPerKToken: 0.01 }),
    "openai:gpt-4.1-mini": Object.freeze({ inputPerKToken: 0.0004, outputPerKToken: 0.0016 }),
    "dashscope:qwen-plus": Object.freeze({ inputPerKToken: 0.0004, outputPerKToken: 0.0012 }),
    "dashscope:qwen-turbo": Object.freeze({ inputPerKToken: 0.00005, outputPerKToken: 0.00015 }),
    "dashscope:qwen-max": Object.freeze({ inputPerKToken: 0.0024, outputPerKToken: 0.0096 }),
    "bailian:qwen-turbo": Object.freeze({ inputPerKToken: 0.00005, outputPerKToken: 0.00015 }),
    "bailian:qwen-plus": Object.freeze({ inputPerKToken: 0.0004, outputPerKToken: 0.0012 }),
});

export interface PageletPricingEntry {
    /** USD per 1000 input tokens. */
    inputPerKToken: number;
    /** USD per 1000 output tokens. */
    outputPerKToken: number;
}

/** Sentinel: pricing not in the table → 0 USD but flagged `pricingKnown=false`. */
const UNKNOWN_PRICING: PageletPricingEntry = Object.freeze({ inputPerKToken: 0, outputPerKToken: 0 });

/**
 * Provider-id alias map (canonical → pricing-table prefixes).
 *
 * The rest of PA uses canonical provider ids: `qwen`, `openai`, `anthropic`
 * (see `settings.ts` defaults, `ai-utils.ts`, `chat-service.ts`). The
 * pricing table above keys on the *vendor service* exposing the model
 * (`dashscope:*`, `bailian:*`, `openai:*`) because the same Qwen family of
 * models is sold through both DashScope and Bailian at different prices.
 *
 * Without this alias, a runtime that passes `provider = settings.aiProvider`
 * (i.e. `"qwen"`) into `lookupPricing` would always miss the table, fall
 * back to `UNKNOWN_PRICING`, and silently report $0/token — bypassing the
 * cost-display gate (D022) and the cost tracker's "unknown pricing" badge.
 *
 * Resolution order: direct key first, then each alias in declaration
 * order. `dashscope` is preferred over `bailian` because the Qwen-Plus /
 * Qwen-Turbo defaults shipped in `ai-utils.ts` resolve to DashScope.
 *
 * `openai` and `anthropic` need no alias — their canonical ids already
 * match the pricing-table prefix.
 */
const PROVIDER_ID_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
    qwen: Object.freeze(["dashscope", "bailian"]) as readonly string[],
});

/**
 * Build the composite key used to look up pricing. Provider + model live as
 * separate fields in `PageletSettings` so they're case-normalised here to
 * tolerate display-string drift (e.g. `OpenAI` vs `openai`).
 */
export function pricingKey(provider: string | undefined, model: string | undefined): string {
    const p = (provider ?? "").toLowerCase().trim();
    const m = (model ?? "").toLowerCase().trim();
    return `${p}:${m}`;
}

export function lookupPricing(
    provider: string | undefined,
    model: string | undefined,
    table: Readonly<Record<string, PageletPricingEntry>> = PAGELET_DEFAULT_PRICING,
): { entry: PageletPricingEntry; known: boolean } {
    const key = pricingKey(provider, model);
    const entry = table[key];
    if (entry) return { entry, known: true };
    // Canonical-id alias resolution: try the vendor prefixes that ship
    // the same model. See PROVIDER_ID_ALIASES for the rationale.
    const normalizedProvider = (provider ?? "").toLowerCase().trim();
    const aliases = PROVIDER_ID_ALIASES[normalizedProvider];
    if (aliases) {
        for (const alias of aliases) {
            const aliasEntry = table[pricingKey(alias, model)];
            if (aliasEntry) return { entry: aliasEntry, known: true };
        }
    }
    return { entry: UNKNOWN_PRICING, known: false };
}

/** Compute a USD figure for a given usage tuple. Always returns a finite number. */
export function computeCost(
    usage: { inputTokens: number; outputTokens: number },
    provider: string | undefined,
    model: string | undefined,
    table: Readonly<Record<string, PageletPricingEntry>> = PAGELET_DEFAULT_PRICING,
): { usd: number; pricingKnown: boolean } {
    const { entry, known } = lookupPricing(provider, model, table);
    const inputUsd = (Math.max(0, usage.inputTokens) / 1000) * entry.inputPerKToken;
    const outputUsd = (Math.max(0, usage.outputTokens) / 1000) * entry.outputPerKToken;
    const usd = inputUsd + outputUsd;
    return { usd: Number.isFinite(usd) ? usd : 0, pricingKnown: known };
}

// ---------------------------------------------------------------------------
// Cost accumulator
// ---------------------------------------------------------------------------

/**
 * A single recorded LLM-call cost entry. B2 will render the most recent one
 * inside the SuggestionCard footer; the running total feeds the mascot
 * tooltip.
 */
export interface PageletCostEntry {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCost: number;
    /** USD always — we don't render localized currencies in the current UI. */
    currency: "USD";
    pricingKnown: boolean;
    provider?: string;
    model?: string;
    /** Recorded via the injected `now()` clock so tests are deterministic. */
    at: number;
}

/**
 * Aggregate view returned by `getSummary()`. The shape mirrors what B2's
 * cost badge component consumes, so a refactor here ripples one level out.
 */
export interface PageletCostSummary {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCost: number;
    currency: "USD";
    pricingKnown: boolean;
    entries: readonly PageletCostEntry[];
}

/** Input to `record()` — kept narrow so callers can't accidentally inject `at`. */
export interface PageletCostRecordInput {
    inputTokens: number;
    outputTokens: number;
    provider?: string;
    model?: string;
}

export interface PageletCostTrackerOptions {
    /** Injectable clock; defaults to `Date.now`. */
    now?: () => number;
    /** Override the pricing table — useful for tests and for staged price updates. */
    pricing?: Readonly<Record<string, PageletPricingEntry>>;
}

/**
 * In-memory cost accumulator. One instance lives per Pagelet session (the
 * Track C adapter constructs it during runtime setup); the orchestrator
 * passes it into `reviewNote()` via options.
 *
 * Persistence across plugin restarts is intentionally NOT a current baseline feature —
 * D022 says "事后展示" but does not promise lifetime totals. If that becomes
 * a follow-up requirement, the persistence layer should sit in front of this
 * (record-to-storage), not inside it.
 */
export class PageletCostTracker {
    private readonly now: () => number;
    private readonly pricing: Readonly<Record<string, PageletPricingEntry>>;
    private readonly _entries: PageletCostEntry[] = [];
    private _summary: PageletCostSummary = emptySummary();

    constructor(options: PageletCostTrackerOptions = {}) {
        this.now = options.now ?? Date.now;
        this.pricing = options.pricing ?? PAGELET_DEFAULT_PRICING;
    }

    /**
     * Record one LLM call's usage. Returns the persisted entry so the caller
     * can render it immediately (avoids a round-trip via `getSummary()`).
     */
    record(usage: PageletCostRecordInput): PageletCostEntry {
        const inputTokens = Math.max(0, Math.floor(Number.isFinite(usage.inputTokens) ? usage.inputTokens : 0));
        const outputTokens = Math.max(0, Math.floor(Number.isFinite(usage.outputTokens) ? usage.outputTokens : 0));
        const { usd, pricingKnown } = computeCost(
            { inputTokens, outputTokens },
            usage.provider,
            usage.model,
            this.pricing,
        );
        const entry: PageletCostEntry = {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
            estimatedCost: usd,
            currency: "USD",
            pricingKnown,
            provider: usage.provider,
            model: usage.model,
            at: this.now(),
        };
        this._entries.push(entry);
        this._summary = recomputeSummary(this._entries);
        return entry;
    }

    /** Aggregate snapshot — safe to hand to UI directly (frozen-by-shape). */
    getSummary(): PageletCostSummary {
        return this._summary;
    }

    /** All entries in insertion order. Returned readonly so B2 can't mutate. */
    getEntries(): readonly PageletCostEntry[] {
        return this._entries;
    }

    /** Reset session state — used by the Settings "reset usage" affordance (B5). */
    reset(): void {
        this._entries.length = 0;
        this._summary = emptySummary();
    }
}

function emptySummary(): PageletCostSummary {
    return {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCost: 0,
        currency: "USD",
        // A summary over zero entries is trivially "all prices known" — there's
        // nothing unknown to flag. Once a single unknown-priced call lands this
        // flips false until a `reset()`.
        pricingKnown: true,
        entries: [],
    };
}

function recomputeSummary(entries: readonly PageletCostEntry[]): PageletCostSummary {
    let inputTokens = 0;
    let outputTokens = 0;
    let estimatedCost = 0;
    let pricingKnown = true;
    for (const e of entries) {
        inputTokens += e.inputTokens;
        outputTokens += e.outputTokens;
        estimatedCost += e.estimatedCost;
        if (!e.pricingKnown) pricingKnown = false;
    }
    return {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        estimatedCost,
        currency: "USD",
        pricingKnown,
        entries,
    };
}

// ---------------------------------------------------------------------------
// Formatting helpers (consumed by B2; co-located to keep the locale-free
// numeric format in one place — UI just decides where to put the label)
// ---------------------------------------------------------------------------

/**
 * Format a USD figure to 3 decimal places (D022: `~$0.003`). Numbers below
 * one tenth of a cent show as `<$0.001` rather than `$0.000` so users
 * don't think the call was free.
 */
export function formatUsd(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return "$0.000";
    if (value < 0.001) return "<$0.001";
    return `$${value.toFixed(3)}`;
}
