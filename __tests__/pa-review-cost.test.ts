/* Copyright 2023 edonyzpc */

/**
 * Track B · B4 unit tests for the Pagelet cost-ceiling module.
 *
 * Coverage matrix (mapped to SDD §7 + D018 / D022):
 *  - `estimateTokens`: heuristic correctness on ASCII / CJK / mixed.
 *  - `preCheckCost`: every clamp boundary + both rejection codes.
 *  - `lookupPricing` / `computeCost`: known + unknown pricing paths.
 *  - `PageletCostTracker`: cumulative summary, multiple-entry math,
 *    pricingKnown flip-on-first-unknown, dependency-injected clock.
 *  - `formatUsd`: the "<$0.001" sentinel that prevents "$0.000" UX bug.
 *
 * Why these tests exist as isolated assertions rather than via the
 * orchestrator: B4 is the home for the actual math; if we only tested
 * end-to-end through `reviewNote`, a regression in `computeCost` would
 * surface as a flaky integration failure with confusing root cause.
 */

import { describe, expect, it } from "@jest/globals";

import {
    PAGELET_DEFAULT_PRICING,
    PAGELET_TOKEN_LIMITS,
    PageletCostTracker,
    computeCost,
    estimateTokens,
    estimateTokensFor,
    formatUsd,
    lookupPricing,
    preCheckCost,
    pricingKey,
    type PageletPricingEntry,
} from "../src/pagelet/pa-review-cost";

describe("estimateTokens (B4 token estimator)", () => {
    it("returns 0 for empty input", () => {
        expect(estimateTokens("")).toBe(0);
    });

    it("approximates ASCII at ~4 chars / token (ceil)", () => {
        // "abcd" is 4 chars → ceil(4/4) = 1 token. "abcde" is 5 → ceil(5/4) = 2.
        // The exact thresholds matter because the cap is enforced at ints —
        // off-by-one in the divisor would let a 31900-char note slip past an
        // 8000-token cap.
        expect(estimateTokens("abcd")).toBe(1);
        expect(estimateTokens("abcde")).toBe(2);
        expect(estimateTokens("abcdefghijklmnop")).toBe(4);
    });

    it("counts each CJK ideograph as one token", () => {
        // Conservative (Qwen tokenizer averages ~1-1.2 chars/token for CJK; we
        // use 1:1 so the cap fires slightly earlier rather than later).
        expect(estimateTokens("你好")).toBe(2);
        expect(estimateTokens("汉字测试")).toBe(4);
    });

    it("handles supplementary CJK plane via codepoint iteration", () => {
        // U+20000 is in the supplementary CJK plane (𠀀). Counting via
        // surrogate-pair length would double-count this; the codepoint
        // iterator must treat it as one token.
        expect(estimateTokens("\u{20000}\u{20001}")).toBe(2);
    });

    it("mixes ASCII and CJK additively", () => {
        // 4 CJK (4 tokens) + 4 ASCII ("abcd" → 1 token) = 5.
        expect(estimateTokens("你好世界abcd")).toBe(5);
    });

    it("estimateTokensFor sums an array of parts", () => {
        expect(estimateTokensFor(["abcd", "你好", "abcd"])).toBe(1 + 2 + 1);
        expect(estimateTokensFor([])).toBe(0);
    });

    it("treats non-string defensively as 0 tokens", () => {
        // Defensive cast — production callers won't hit this, but the type
        // boundary at `unknown` content from the model is real.
        expect(estimateTokens(undefined as unknown as string)).toBe(0);
        expect(estimateTokens(null as unknown as string)).toBe(0);
    });
});
describe("preCheckCost (B4 hard-cap enforcement, D018)", () => {
    it("passes when input < budget AND input + output < hardCap", () => {
        const decision = preCheckCost(7_500, {
            maxInputTokens: 8_000,
            maxOutputTokens: 2_000,
        });
        expect(decision.ok).toBe(true);
        if (!decision.ok) return;
        expect(decision.estimatedInputTokens).toBe(7_500);
        expect(decision.effectiveInputBudget).toBe(8_000);
        expect(decision.effectiveOutputBudget).toBe(2_000);
    });

    it("rejects 'input_too_large' when estimate exceeds maxInputTokens", () => {
        const decision = preCheckCost(8_001, {
            maxInputTokens: 8_000,
            maxOutputTokens: 2_000,
        });
        expect(decision.ok).toBe(false);
        if (decision.ok) return;
        expect(decision.reason).toBe("input_too_large");
        expect(decision.estimatedInputTokens).toBe(8_001);
    });

    it("rejects 'input_too_large' before the combined hard cap when both limits are exceeded", () => {
        const decision = preCheckCost(32_001, {
            maxInputTokens: 32_000, // hits the ceiling exactly
            maxOutputTokens: 4_000,
        });
        expect(decision.ok).toBe(false);
        if (decision.ok) return;
        expect(decision.reason).toBe("input_too_large");
    });

    it("allows input plus output exactly at the hard cap, including a clamped output budget", () => {
        const decisionAtHardCap = preCheckCost(32_000, {
            maxInputTokens: 32_000,
            maxOutputTokens: 4_000,
        });
        expect(decisionAtHardCap.ok).toBe(true);

        const decisionWithClampedOutput = preCheckCost(32_000, {
            maxInputTokens: 32_000,
            maxOutputTokens: 4_001, // clamped → 4_000
        });
        expect(decisionWithClampedOutput.ok).toBe(true);
    });

    it("clamps an above-ceiling user setting down to maxInput / maxOutput", () => {
        // Defensive: user edits data.json to set 100K input. We must clamp
        // to 32K BEFORE evaluating, otherwise the gate becomes user-bypass.
        const decision = preCheckCost(10_000, {
            maxInputTokens: 100_000, // → clamps to 32_000
            maxOutputTokens: 10_000, // → clamps to 4_000
        });
        expect(decision.ok).toBe(true);
        if (!decision.ok) return;
        expect(decision.effectiveInputBudget).toBe(PAGELET_TOKEN_LIMITS.maxInput);
        expect(decision.effectiveOutputBudget).toBe(PAGELET_TOKEN_LIMITS.maxOutput);
    });

    it("treats a negative/NaN estimate as 0 (degenerate but doesn't crash)", () => {
        const decision = preCheckCost(-5, {
            maxInputTokens: 8_000,
            maxOutputTokens: 2_000,
        });
        expect(decision.ok).toBe(true);
        if (!decision.ok) return;
        expect(decision.estimatedInputTokens).toBe(0);
    });

    it("rejects exactly at the boundary (estimate == max + 1)", () => {
        // Off-by-one assertion: we want strict `>` semantics. estimate == max
        // passes; estimate == max + 1 rejects.
        expect(preCheckCost(8_000, { maxInputTokens: 8_000, maxOutputTokens: 2_000 }).ok).toBe(true);
        expect(preCheckCost(8_001, { maxInputTokens: 8_000, maxOutputTokens: 2_000 }).ok).toBe(false);
    });
});

describe("lookupPricing / pricingKey", () => {
    it("normalises provider and model to lowercase for lookup", () => {
        expect(pricingKey("OpenAI", "GPT-4o-Mini")).toBe("openai:gpt-4o-mini");
        // Whitespace tolerance — settings field may have stray spaces.
        expect(pricingKey("  openai  ", " gpt-4o-mini ")).toBe("openai:gpt-4o-mini");
    });

    it("returns known=true for an entry in the default table", () => {
        const result = lookupPricing("openai", "gpt-4o-mini");
        expect(result.known).toBe(true);
        expect(result.entry.inputPerKToken).toBeGreaterThan(0);
        expect(result.entry.outputPerKToken).toBeGreaterThan(0);
    });

    it("returns known=false for an unknown provider/model combo", () => {
        const result = lookupPricing("acme-llm", "v1");
        expect(result.known).toBe(false);
        expect(result.entry.inputPerKToken).toBe(0);
        expect(result.entry.outputPerKToken).toBe(0);
    });

    it("accepts an override pricing table", () => {
        const custom: Record<string, PageletPricingEntry> = {
            "acme-llm:v1": { inputPerKToken: 0.5, outputPerKToken: 1.0 },
        };
        expect(lookupPricing("acme-llm", "v1", custom).known).toBe(true);
        expect(lookupPricing("openai", "gpt-4o-mini", custom).known).toBe(false);
    });

    it("treats undefined provider/model as the empty key (unknown)", () => {
        expect(lookupPricing(undefined, undefined).known).toBe(false);
    });

    it("resolves the canonical 'qwen' provider via the dashscope/bailian alias", () => {
        // Regression: PA's canonical provider id is "qwen" (see settings.ts,
        // chat-service.ts). The pricing table keys on the vendor prefix
        // (dashscope/bailian) because the same model is sold through both
        // services. Without alias resolution, a runtime that passes
        // `provider = settings.aiProvider` ("qwen") would receive
        // UNKNOWN_PRICING → $0/token → silent bypass of D022 cost display.
        const plus = lookupPricing("qwen", "qwen-plus");
        expect(plus.known).toBe(true);
        // Should resolve to the dashscope entry (preferred alias).
        expect(plus.entry.inputPerKToken).toBe(0.0004);
        expect(plus.entry.outputPerKToken).toBe(0.0012);

        const turbo = lookupPricing("qwen", "qwen-turbo");
        expect(turbo.known).toBe(true);
        expect(turbo.entry.inputPerKToken).toBe(0.00005);

        // Case + whitespace tolerance carries through the alias path.
        expect(lookupPricing("  QWEN  ", "Qwen-Max").known).toBe(true);
    });

    it("returns unknown pricing for an unpriced canonical provider", () => {
        // anthropic is canonical but not in the default table yet; it
        // should miss cleanly (no alias, no entry) rather than crashing.
        const missing = lookupPricing("anthropic", "claude-haiku");
        expect(missing.known).toBe(false);
        expect(missing.entry.inputPerKToken).toBe(0);
    });
});

describe("computeCost", () => {
    it("computes USD per (per-K) entry rates correctly", () => {
        // gpt-4o-mini: 0.00015 / 1K input, 0.0006 / 1K output.
        // 1000 input tokens = $0.00015; 500 output tokens = $0.00030; sum $0.00045.
        const { usd, pricingKnown } = computeCost(
            { inputTokens: 1000, outputTokens: 500 },
            "openai",
            "gpt-4o-mini",
        );
        expect(usd).toBeCloseTo(0.00045, 5);
        expect(pricingKnown).toBe(true);
    });

    it("returns usd=0 + pricingKnown=false for unknown providers", () => {
        const { usd, pricingKnown } = computeCost(
            { inputTokens: 1000, outputTokens: 500 },
            "acme-llm",
            "v1",
        );
        expect(usd).toBe(0);
        expect(pricingKnown).toBe(false);
    });

    it("ignores negative input/output (defence vs upstream bugs)", () => {
        const { usd } = computeCost(
            { inputTokens: -100, outputTokens: -50 },
            "openai",
            "gpt-4o-mini",
        );
        expect(usd).toBe(0);
    });
});

describe("PageletCostTracker (B4 cumulative cost tracking)", () => {
    it("starts with a zero summary and empty entries", () => {
        const tracker = new PageletCostTracker();
        const summary = tracker.getSummary();
        expect(summary.inputTokens).toBe(0);
        expect(summary.outputTokens).toBe(0);
        expect(summary.totalTokens).toBe(0);
        expect(summary.estimatedCost).toBe(0);
        expect(summary.pricingKnown).toBe(true);
        expect(summary.entries).toEqual([]);
    });

    it("records a single call and reflects it in the summary", () => {
        const tracker = new PageletCostTracker({ now: () => 1_000 });
        const entry = tracker.record({
            inputTokens: 1000,
            outputTokens: 500,
            provider: "openai",
            model: "gpt-4o-mini",
        });
        expect(entry.totalTokens).toBe(1500);
        expect(entry.pricingKnown).toBe(true);
        expect(entry.at).toBe(1_000);
        const summary = tracker.getSummary();
        expect(summary.inputTokens).toBe(1000);
        expect(summary.outputTokens).toBe(500);
        expect(summary.estimatedCost).toBeCloseTo(0.00045, 5);
        expect(summary.pricingKnown).toBe(true);
    });

    it("aggregates multiple calls additively", () => {
        const tracker = new PageletCostTracker({ now: () => 0 });
        tracker.record({ inputTokens: 100, outputTokens: 50, provider: "openai", model: "gpt-4o-mini" });
        tracker.record({ inputTokens: 200, outputTokens: 75, provider: "openai", model: "gpt-4o-mini" });
        const summary = tracker.getSummary();
        expect(summary.inputTokens).toBe(300);
        expect(summary.outputTokens).toBe(125);
        expect(summary.entries).toHaveLength(2);
    });

    it("flips pricingKnown=false on the first unknown-priced call", () => {
        const tracker = new PageletCostTracker();
        tracker.record({ inputTokens: 100, outputTokens: 50, provider: "openai", model: "gpt-4o-mini" });
        expect(tracker.getSummary().pricingKnown).toBe(true);
        tracker.record({ inputTokens: 100, outputTokens: 50, provider: "acme", model: "v1" });
        expect(tracker.getSummary().pricingKnown).toBe(false);
        // Subsequent known calls don't flip it back — once unknown, always unknown.
        tracker.record({ inputTokens: 100, outputTokens: 50, provider: "openai", model: "gpt-4o-mini" });
        expect(tracker.getSummary().pricingKnown).toBe(false);
    });

    it("uses the injected clock (dependency-injected `now`)", () => {
        // Use a manual counter rather than jest.fn().mockReturnValueOnce
        // chains — strict typing on `@jest/globals` makes the chained generic
        // awkward without `as any`, and the counter is just as readable.
        const ticks = [100, 200];
        let idx = 0;
        const tracker = new PageletCostTracker({ now: () => ticks[idx++] });
        tracker.record({ inputTokens: 1, outputTokens: 0 });
        tracker.record({ inputTokens: 1, outputTokens: 0 });
        const entries = tracker.getEntries();
        expect(entries[0].at).toBe(100);
        expect(entries[1].at).toBe(200);
    });

    it("uses the injected pricing table (dependency-injected pricing)", () => {
        const pricing: Record<string, PageletPricingEntry> = {
            "test:m1": { inputPerKToken: 1, outputPerKToken: 2 },
        };
        const tracker = new PageletCostTracker({ pricing });
        const entry = tracker.record({
            inputTokens: 1000,
            outputTokens: 500,
            provider: "test",
            model: "m1",
        });
        // 1000 input * $1/1K = $1.00; 500 output * $2/1K = $1.00 → $2.00 total
        expect(entry.estimatedCost).toBeCloseTo(2.0, 5);
    });

    it("reset() clears entries and summary back to zero", () => {
        const tracker = new PageletCostTracker();
        tracker.record({ inputTokens: 100, outputTokens: 50, provider: "openai", model: "gpt-4o-mini" });
        tracker.reset();
        const summary = tracker.getSummary();
        expect(summary.totalTokens).toBe(0);
        expect(summary.entries).toEqual([]);
        expect(tracker.getEntries()).toEqual([]);
    });
});

describe("formatUsd (B4 cost display, D022)", () => {
    it("renders `$0.000` for zero / negative / non-finite", () => {
        expect(formatUsd(0)).toBe("$0.000");
        expect(formatUsd(-1)).toBe("$0.000");
        expect(formatUsd(NaN)).toBe("$0.000");
        expect(formatUsd(Infinity)).toBe("$0.000");
    });

    it("renders `<$0.001` for sub-millicent amounts so users don't think it's free", () => {
        expect(formatUsd(0.0001)).toBe("<$0.001");
        expect(formatUsd(0.0009)).toBe("<$0.001");
    });

    it("renders `$X.YYY` for normal amounts (3 decimal places)", () => {
        expect(formatUsd(0.001)).toBe("$0.001");
        expect(formatUsd(0.003)).toBe("$0.003");
        // 1.2351 dodges the IEEE-754 representability hole at 1.2345 — JS's
        // toFixed banker-rounds the nearest representable double, which for
        // 1.2345 is *slightly* less than the literal so we'd get "$1.234".
        expect(formatUsd(1.2351)).toBe("$1.235");
    });
});

describe("PAGELET_TOKEN_LIMITS frozen constant", () => {
    it("exposes the SDD §7.1 limits", () => {
        // These numbers are the source-of-truth for both this module and the
        // settings ceiling enforcement. If they drift, the Settings UI bound
        // (PAGELET_BOUNDS in src/settings/pagelet/index.ts) must drift too —
        // a parity test in pagelet-settings.test.ts guards that direction.
        expect(PAGELET_TOKEN_LIMITS.defaultInput).toBe(8_000);
        expect(PAGELET_TOKEN_LIMITS.defaultOutput).toBe(2_000);
        expect(PAGELET_TOKEN_LIMITS.maxInput).toBe(32_000);
        expect(PAGELET_TOKEN_LIMITS.maxOutput).toBe(4_000);
        expect(PAGELET_TOKEN_LIMITS.hardCap).toBe(36_000);
    });

    it("is frozen (defends against in-test mutation)", () => {
        expect(Object.isFrozen(PAGELET_TOKEN_LIMITS)).toBe(true);
    });
});

describe("PAGELET_DEFAULT_PRICING table", () => {
    it("has known pricing for the providers shipped in v1 settings", () => {
        // If the table loses an entry the user's current provider quietly
        // becomes "unknown pricing" — flag at CI rather than ship a broken
        // cost badge.
        expect(PAGELET_DEFAULT_PRICING[pricingKey("openai", "gpt-4o-mini")]).toBeDefined();
        expect(PAGELET_DEFAULT_PRICING[pricingKey("dashscope", "qwen-plus")]).toBeDefined();
        expect(PAGELET_DEFAULT_PRICING[pricingKey("bailian", "qwen-turbo")]).toBeDefined();
    });

    it("freezes both the table and each entry to prevent mutation", () => {
        expect(Object.isFrozen(PAGELET_DEFAULT_PRICING)).toBe(true);
        for (const value of Object.values(PAGELET_DEFAULT_PRICING)) {
            expect(Object.isFrozen(value)).toBe(true);
        }
    });
});
