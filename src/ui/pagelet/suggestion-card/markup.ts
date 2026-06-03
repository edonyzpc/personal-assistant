/* Copyright 2023 edonyzpc */

/**
 * Pagelet (Review Assistant) v1 — SuggestionCard markup builder (pure).
 *
 * Spec source: `docs/review-assistant-sdd.md` §10.2 + `docs/pagelet-visual-spec.html` §③.
 *
 * Same testing rationale as `mascot/markup.ts`: keep all data shaping
 * in a pure builder so unit tests don't need jsdom, and the DOM
 * renderer becomes a thin "apply this descriptor" layer.
 *
 * Section structure (5 區塊):
 *  1. Header (`pa-pagelet-suggestion-card__header`)
 *      - kind badge (uses translated `pagelet.suggestion.kind.<kind>`)
 *      - diagnostics badges (truncated / partial / dropped)
 *  2. Source (`pa-pagelet-suggestion-card__source`)
 *      - label + clickable chip (callback wired in dom-renderer.ts)
 *  3. Rationale (`pa-pagelet-suggestion-card__rationale`)
 *  4. Proposed action (`pa-pagelet-suggestion-card__action`)
 *  5. Related notes (`pa-pagelet-suggestion-card__related`)
 *      - only present in markup when `related_notes` non-empty
 *  + Footer (`pa-pagelet-suggestion-card__footer`)
 *      - Accept / Dismiss buttons + cost line (when cost entry present).
 *      The footer is NOT one of the "5 區塊" per SDD §10.2 — it is
 *      action affordance rather than content — but it lives in the
 *      same card so we describe it here.
 *
 * Why we hard-code EN fallback labels for missing i18n keys:
 *  - B3 registered `pagelet.suggestion.source/rationale/proposedAction`
 *    but NOT `relatedLabel` or a "dropped" badge label. The task brief
 *    forbids touching `src/locales/pagelet/**`, so the renderer must
 *    fall through to a sensible default. The B3 follow-up issue will
 *    promote these into the dictionary (see B2 final report).
 */

import {
    PAGELET_SUGGESTION_KINDS,
    type PageletSuggestion,
    type PageletSuggestionKind,
} from "../../../pagelet/pa-review-schemas";
import { formatUsd, type PageletCostEntry } from "../../../pagelet/pa-review-cost";
import type {
    SuggestionBadgeKind,
    SuggestionCardProps,
    SuggestionCardTranslator,
} from "./types";

// ---------------------------------------------------------------------------
// Static design tokens
// ---------------------------------------------------------------------------

/**
 * Kind → i18n key. Re-exported so B5 a11y work / Track C wiring can
 * key off the same canonical mapping rather than reimplementing it.
 */
export const SUGGESTION_KIND_I18N_KEY: Readonly<Record<PageletSuggestionKind, string>> = Object.freeze({
    clarify: "pagelet.suggestion.kind.clarify",
    expand: "pagelet.suggestion.kind.expand",
    link: "pagelet.suggestion.kind.link",
    trim: "pagelet.suggestion.kind.trim",
    evidence: "pagelet.suggestion.kind.evidence",
});

/** Fallback EN strings used when the translator returns the key itself. */
const KIND_DEFAULT_TEXT: Readonly<Record<PageletSuggestionKind, string>> = Object.freeze({
    clarify: "Clarify",
    expand: "Expand",
    link: "Link",
    trim: "Trim",
    evidence: "Evidence",
});

/**
 * Section labels. Where B3 registered a key, we use it; where it did
 * NOT (related notes label, "dropped" badge), we fall back to the
 * literal EN string. Centralised so the B3 follow-up that adds the
 * missing keys is a 1-line change.
 */
const LABEL_I18N_KEYS = Object.freeze({
    source: "pagelet.suggestion.source",
    rationale: "pagelet.suggestion.rationale",
    action: "pagelet.suggestion.proposedAction",
    related: "pagelet.suggestion.related",
    accept: "pagelet.suggestion.accept",
    dismiss: "pagelet.suggestion.dismiss",
    acceptAria: "pagelet.a11y.acceptCardLabel",
    dismissAria: "pagelet.a11y.dismissCardLabel",
    badgeTruncated: "pagelet.suggestion.truncatedBadge",
    badgePartial: "pagelet.suggestion.partialBadge",
    badgeDropped: "pagelet.suggestion.droppedBadge",
    costLabel: "pagelet.cost.label",
});

const LABEL_DEFAULT_TEXT = Object.freeze({
    source: "Source",
    rationale: "Why",
    action: "Suggested action",
    related: "Related notes",
    accept: "Accept",
    dismiss: "Dismiss",
    acceptAria: "Accept this suggestion",
    dismissAria: "Dismiss this suggestion",
    badgeTruncated: "Shortened by Pagelet",
    badgePartial: "Partial",
    badgeDropped: "Dropped {count}",
    costLabel: "Cost",
});

// ---------------------------------------------------------------------------
// Data shapes — what the markup builder returns.
//
// The DOM renderer walks this once per `update()` and applies the diff.
// ---------------------------------------------------------------------------

export interface SuggestionBadgeMarkup {
    kind: SuggestionBadgeKind;
    /** CSS class on the badge element (state-specific suffix). */
    className: string;
    /** Resolved badge label (post-i18n). */
    label: string;
}

export interface SuggestionRelatedItemMarkup {
    /** Raw note name as returned by the model. */
    name: string;
}

export interface SuggestionCostMarkup {
    /** Resolved cost label (translated). */
    label: string;
    /** Formatted USD string (e.g. "$0.003", "<$0.001", "$0.000"). */
    usd: string;
    /** Whether the price was known (false → "~$?"-style indeterminate). */
    pricingKnown: boolean;
}

export interface SuggestionCardMarkup {
    rootClassList: string[];
    /** Header section markup. */
    header: {
        /** Translated kind badge text (e.g. "Clarify"). */
        kindLabel: string;
        /** The raw kind (used as data-attribute + extra CSS modifier). */
        kind: PageletSuggestionKind;
        kindBadgeClassList: string[];
        /** Diagnostics badges (order is fixed for stable visual layout). */
        badges: SuggestionBadgeMarkup[];
    };
    /** Source chip section. `interactive=false` when no callback supplied. */
    source: {
        label: string;
        sourceId: string;
        interactive: boolean;
        chipClassList: string[];
    };
    /** Rationale section. */
    rationale: {
        label: string;
        text: string;
    };
    /** Proposed action section. */
    action: {
        label: string;
        text: string;
    };
    /** Related notes section — `null` when none to render. */
    related: {
        label: string;
        items: SuggestionRelatedItemMarkup[];
    } | null;
    /** Footer with buttons + optional cost line. */
    footer: {
        acceptLabel: string;
        acceptAriaLabel: string;
        dismissLabel: string;
        dismissAriaLabel: string;
        showAccept: boolean;
        showDismiss: boolean;
        cost: SuggestionCostMarkup | null;
    };
}

export interface BuildSuggestionCardMarkupOptions {
    translator: SuggestionCardTranslator;
}

// ---------------------------------------------------------------------------
// Pure builders
// ---------------------------------------------------------------------------

export function buildSuggestionCardMarkup(
    props: SuggestionCardProps,
    options: BuildSuggestionCardMarkupOptions,
): SuggestionCardMarkup {
    const { suggestion, diagnostics, onSourceClick, onAccept, onDismiss } = props;
    const t = makeFallbackTranslator(options.translator);

    const kindLabel = t(
        SUGGESTION_KIND_I18N_KEY[suggestion.kind],
        KIND_DEFAULT_TEXT[suggestion.kind],
    );

    const badges = buildBadges(diagnostics, t);

    const related = (suggestion.related_notes && suggestion.related_notes.length > 0)
        ? {
            label: t(LABEL_I18N_KEYS.related, LABEL_DEFAULT_TEXT.related),
            items: suggestion.related_notes.map((name) => ({ name })),
        }
        : null;

    const cost = buildCostMarkup(diagnostics?.costEntry, t);

    return {
        rootClassList: [
            "pa-pagelet-suggestion-card",
            `pa-pagelet-suggestion-card--kind-${suggestion.kind}`,
        ],
        header: {
            kindLabel,
            kind: suggestion.kind,
            kindBadgeClassList: [
                "pa-pagelet-suggestion-card__kind",
                `pa-pagelet-suggestion-card__kind--${suggestion.kind}`,
            ],
            badges,
        },
        source: {
            label: t(LABEL_I18N_KEYS.source, LABEL_DEFAULT_TEXT.source),
            sourceId: suggestion.source_id,
            interactive: typeof onSourceClick === "function",
            chipClassList: [
                "pa-pagelet-suggestion-card__source-chip",
                typeof onSourceClick === "function"
                    ? "pa-pagelet-suggestion-card__source-chip--interactive"
                    : "pa-pagelet-suggestion-card__source-chip--static",
            ],
        },
        rationale: {
            label: t(LABEL_I18N_KEYS.rationale, LABEL_DEFAULT_TEXT.rationale),
            text: suggestion.rationale,
        },
        action: {
            label: t(LABEL_I18N_KEYS.action, LABEL_DEFAULT_TEXT.action),
            text: suggestion.proposed_action,
        },
        related,
        footer: {
            acceptLabel: t(LABEL_I18N_KEYS.accept, LABEL_DEFAULT_TEXT.accept),
            acceptAriaLabel: t(LABEL_I18N_KEYS.acceptAria, LABEL_DEFAULT_TEXT.acceptAria),
            dismissLabel: t(LABEL_I18N_KEYS.dismiss, LABEL_DEFAULT_TEXT.dismiss),
            dismissAriaLabel: t(LABEL_I18N_KEYS.dismissAria, LABEL_DEFAULT_TEXT.dismissAria),
            showAccept: typeof onAccept === "function",
            showDismiss: typeof onDismiss === "function",
            cost,
        },
    };
}

// ---------------------------------------------------------------------------
// Sub-builders
// ---------------------------------------------------------------------------

function buildBadges(
    diagnostics: SuggestionCardProps["diagnostics"],
    t: SuggestionCardTranslator,
): SuggestionBadgeMarkup[] {
    if (!diagnostics) return [];
    const badges: SuggestionBadgeMarkup[] = [];

    if (diagnostics.truncated) {
        badges.push({
            kind: "truncated",
            className: "pa-pagelet-suggestion-card__badge pa-pagelet-suggestion-card__badge--truncated",
            label: t(LABEL_I18N_KEYS.badgeTruncated, LABEL_DEFAULT_TEXT.badgeTruncated),
        });
    }
    if (diagnostics.partial) {
        badges.push({
            kind: "partial",
            className: "pa-pagelet-suggestion-card__badge pa-pagelet-suggestion-card__badge--partial",
            label: t(LABEL_I18N_KEYS.badgePartial, LABEL_DEFAULT_TEXT.badgePartial),
        });
    }
    if (diagnostics.droppedSuggestionsCount > 0) {
        const template = t(LABEL_I18N_KEYS.badgeDropped, LABEL_DEFAULT_TEXT.badgeDropped);
        badges.push({
            kind: "dropped",
            className: "pa-pagelet-suggestion-card__badge pa-pagelet-suggestion-card__badge--dropped",
            label: template.replace("{count}", String(diagnostics.droppedSuggestionsCount)),
        });
    }

    return badges;
}

function buildCostMarkup(
    entry: PageletCostEntry | undefined,
    t: SuggestionCardTranslator,
): SuggestionCostMarkup | null {
    if (!entry) return null;
    const usd = entry.pricingKnown ? formatUsd(entry.estimatedCost) : "~$?";
    return {
        label: t(LABEL_I18N_KEYS.costLabel, LABEL_DEFAULT_TEXT.costLabel),
        usd,
        pricingKnown: entry.pricingKnown,
    };
}

/**
 * Wrap a translator so a "key returned literally" miss falls through
 * to the caller-supplied EN default. Mirrors the mascot's same trick.
 *
 * Why this exists: `pageletT(key, locale, undefined, fallback)`
 * returns the fallback only when NO entry is found anywhere. But the
 * card-level `SuggestionCardTranslator` shape is the narrowed
 * `(key, fallback) → string` — and some tests stub it with a passthrough
 * that returns the key when no fallback is supplied. Wrapping here
 * means the markup builder ALWAYS reads a meaningful string regardless
 * of how the translator implements its "miss" semantics.
 */
function makeFallbackTranslator(translator: SuggestionCardTranslator): SuggestionCardTranslator {
    return (key, fallback) => {
        const value = translator(key, fallback);
        // Defensive: some translators (including pageletT's "no fallback"
        // branch) surface the raw key on a miss. Coerce to the supplied
        // fallback so end users never see "pagelet.suggestion.related"
        // bleeding into the UI.
        if (value === key && fallback !== undefined) return fallback;
        return value;
    };
}

// ---------------------------------------------------------------------------
// Re-exports for the spec
// ---------------------------------------------------------------------------

export const SUGGESTION_KIND_VALUES = PAGELET_SUGGESTION_KINDS;
