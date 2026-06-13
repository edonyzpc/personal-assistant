/* Copyright 2023 edonyzpc */

/**
 * Pagelet — SuggestionCard UI types.
 *
 * Spec source: `docs/review-assistant-sdd.md` §10.2 + `docs/pagelet-visual-spec.html` §③.
 *
 * The 5 區塊 / 5 sections the card renders (per B2 task brief):
 *   1. Header — Mascot icon + kind badge + diagnostics badges
 *      (truncated / partial / dropped).
 *   2. Source — `source_id` reference (click → caller-provided callback).
 *   3. Rationale (Why) — `rationale` paragraph.
 *   4. Proposed action — `proposed_action` paragraph.
 *   5. Related notes — `related_notes` list (only rendered when non-empty).
 *
 * Diagnostics fields consumed from B1 / B4:
 *   - `truncated`        → "Shortened by Pagelet" badge
 *   - `partial`          → "Partial" badge
 *   - `droppedSuggestionsCount > 0` → "<n> dropped" badge
 *   - `costEntry`        → footer "~$0.003" line (D022)
 *
 * Callback wiring:
 *   - Click on the source chip → `onSourceClick(source_id)`. Track C C1
 *     will wire this to "scroll-to-segment". For now the prop is just
 *     forwarded — no DOM-level scroll logic in this layer.
 *   - Accept / Dismiss buttons — declared in this contract so the
 *     scene matches the visual spec, but the actual write-side
 *     behaviour is Track C work. The callbacks here are pass-through.
 */

import type { PageletLocale } from "../../../locales/pagelet";
import type { PageletReviewDiagnostics } from "../../../pagelet/pa-review-model";
import type { PageletCostEntry } from "../../../pagelet/pa-review-cost";
import type {
    PageletSuggestion,
    PageletSuggestionKind,
} from "../../../pagelet/pa-review-schemas";

/**
 * The 3 diagnostic badges the card may surface. Treated as enum-like so
 * tests can iterate them and the renderer can branch in one place.
 *
 * NOTE: only the SHAPE is here; copy lives in markup.ts so it can be
 * looked up via the translator with EN fallbacks (B3 registered only 2
 * of the 3 badges; "dropped" gets a hard-coded EN fallback until B3
 * follow-up).
 */
export type SuggestionBadgeKind = "truncated" | "partial" | "dropped";

export const SUGGESTION_BADGE_KINDS: readonly SuggestionBadgeKind[] = [
    "truncated",
    "partial",
    "dropped",
] as const;

/**
 * Props the SuggestionCard renders from. Mirrors the shape SDD §10.2
 * suggests but extended with `diagnostics` so the badges can be
 * derived without a second prop drilldown.
 */
export interface SuggestionCardProps {
    /** The B1 schema-validated suggestion to render. */
    suggestion: PageletSuggestion;
    /**
     * Diagnostics from the review outcome. Optional because tests
     * sometimes render isolated suggestions without a full outcome.
     * When omitted, no badges render.
     */
    diagnostics?: Pick<
        PageletReviewDiagnostics,
        "truncated" | "partial" | "droppedSuggestionsCount" | "costEntry"
    >;
    /**
     * Click handler for the source chip. Receives the suggestion's
     * `source_id`. Track C C1 wires this to a scroll-to-segment
     * action. If omitted, the chip is rendered non-interactive
     * (no cursor change, no callback).
     */
    onSourceClick?: (sourceId: string) => void;
    /**
     * Accept handler (D006 B = 非侵入 — Track C will append to the
     * sidecar file, NOT mutate the original note).
     */
    onAccept?: (suggestion: PageletSuggestion) => void;
    /** Dismiss handler — marks the suggestion as "don't show again". */
    onDismiss?: (suggestion: PageletSuggestion) => void;
    /**
     * Related-note click handler. The card forwards the raw model string
     * (often a wikilink-looking value); the Pagelet panel decides how to
     * resolve it against Obsidian metadata.
     */
    onRelatedNoteClick?: (noteName: string, suggestion: PageletSuggestion) => void;
    /**
     * Research action handler. Rendered only for link/evidence suggestions
     * so review generation never performs automatic WebSearch.
     */
    onResearch?: (suggestion: PageletSuggestion) => void;
}

export interface SuggestionCardRendererOptions {
    /** UI locale for label lookups. Defaults to "en". */
    locale?: PageletLocale;
    /** Pluggable translator for tests; defaults to `pageletT`. */
    translator?: SuggestionCardTranslator;
}

/**
 * Translator narrowed to `(key, fallback) → string`. We do not use the
 * full `pageletT` signature here for the same reason as the mascot:
 * none of the labels interpolate params, and narrowing the seam keeps
 * tests trivial.
 */
export type SuggestionCardTranslator = (key: string, fallback?: string) => string;

/**
 * The card's external contract. Implementations:
 *   - `createSuggestionCardRenderer(parentEl, props, opts)` → real DOM
 *   - `createSuggestionCardRendererWithHost(...)` (test-only)
 *
 * `update(nextProps)` re-renders in place; useful when the cost entry
 * arrives a tick after the initial card (rare but happens during the
 * structured-then-cost-record happy path).
 */
export interface SuggestionCardRenderer {
    /** The currently-applied props. */
    readonly props: SuggestionCardProps;
    /** Re-render with new props (suggestion stays the same, badges may change). */
    update(nextProps: SuggestionCardProps): void;
    /** Tear down the card and release listeners. */
    destroy(): void;
}

// Re-export the schema-side types so callers don't have to import from
// two places.
export type {
    PageletReviewDiagnostics,
    PageletSuggestion,
    PageletSuggestionKind,
    PageletCostEntry,
};
