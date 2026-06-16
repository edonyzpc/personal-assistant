/* Copyright 2023 edonyzpc */

/**
 * Pagelet — Mascot markup builder (pure).
 *
 * Spec source: `docs/review-assistant-sdd.md` §10.1 + `docs/pagelet-visual-spec.html` §①.
 *
 * Why a pure builder (separate from the DOM renderer):
 *  - Without jsdom in the test setup, exercising real DOM calls
 *    requires either a heavy mock or pulling in a new dev dependency.
 *  - The bulk of mascot logic (state → color, state → SVG geometry,
 *    state → animation classes, state → i18n message) is data shaping.
 *    A pure data builder is far cheaper to test exhaustively than a
 *    DOM-side renderer.
 *  - The renderer becomes a thin "apply this descriptor to a parent"
 *    layer that does NOT branch on state — every state-specific
 *    decision lives here.
 *
 * Visual-spec parity:
 *  - Colors map 1:1 to the `--pagelet-*` CSS custom properties in the
 *    spec (`#e8e8e8`, `#7c9eff`, `#5dd39e`, `#ff6b6b`). The values are
 *    referenced via `var()` in the markup, NOT hard-coded, so a future
 *    theme tweak only touches one .pcss block.
 *  - SVG path data is copied verbatim from the visual spec to match
 *    "极简线稿 + Tldraw-like 手绘抖动" (D004 + D005) precisely. Editing
 *    any path here requires a corresponding update in the spec file.
 *  - Animation classes (`anim-blink`, `anim-float`, `anim-pulse-1..3`)
 *    mirror the spec's keyframe names. The spec already pairs them
 *    with `@media (prefers-reduced-motion: reduce)` so B5 a11y work
 *    only needs to add the media-query stylesheet, not refactor
 *    markup.
 */

import type { MascotState, MascotTranslator } from "./types";

// ---------------------------------------------------------------------------
// Static design tokens (no defaults dynamic at module load — D012 says the
// theme stays consistent across light/dark modes).
// ---------------------------------------------------------------------------

/**
 * State → CSS custom-property name used as `stroke` color.
 * Using `var()` (not hex) lets a theme override the color without
 * recompiling TS. The token names mirror `pagelet-visual-spec.html`.
 */
export const MASCOT_STATE_STROKE_VAR: Readonly<Record<MascotState, string>> = Object.freeze({
    idle: "--pa-pagelet-color-neutral",
    thinking: "--pa-pagelet-color-thinking",
    done: "--pa-pagelet-color-done",
    error: "--pa-pagelet-color-error",
});

/**
 * Default i18n key per state. Re-exported (vs. inlined) so a future
 * B-task that wants a custom key-mapping (e.g. "deeper" mode messages)
 * can patch this single table instead of editing every call site.
 */
export const MASCOT_STATE_I18N_KEY: Readonly<Record<MascotState, string>> = Object.freeze({
    idle: "pagelet.mascot.idle",
    thinking: "pagelet.mascot.thinking",
    done: "pagelet.mascot.done",
    error: "pagelet.mascot.error",
});

/**
 * Fallback EN strings — used when the translator returns the key name
 * itself (meaning no entry was found). These mirror what B3 actually
 * registered in en.json so the spec stays self-contained even when
 * the dictionary import fails in an edge environment.
 */
const MASCOT_STATE_DEFAULT_TEXT: Readonly<Record<MascotState, string>> = Object.freeze({
    idle: "Pagelet is watching.",
    thinking: "Let me take a look…",
    done: "Done — see what I noticed.",
    error: "Something went wrong. Try again or send feedback.",
});

/** Shared SVG viewBox per visual-spec convention (44×44 source, scaled by CSS). */
export const MASCOT_SVG_VIEWBOX = "0 0 44 44" as const;

// ---------------------------------------------------------------------------
// Data shapes — what the markup builder returns.
// ---------------------------------------------------------------------------

export interface MascotSvgPath {
    /** SVG `d=` value, hand-crafted with ±0.1~0.3 jitter (D005 手绘). */
    d: string;
    /** stroke-width: 1.6 for outlines, 1.4 for features (visual spec §②). */
    strokeWidth: number;
    /** Optional CSS animation class — when present, B5's reduce-motion will null it. */
    animClass?: string;
}

export interface MascotSvgCircle {
    cx: number;
    cy: number;
    r: number;
    /** Optional CSS animation class — pulse for the thinking dots. */
    animClass?: string;
}

export interface MascotSvgShapes {
    paths: MascotSvgPath[];
    circles?: MascotSvgCircle[];
}

/**
 * Markup descriptor returned by `buildMascotMarkup`. The DOM renderer
 * walks this once on mount and re-applies just the state-dependent
 * bits (root class list, stroke color, SVG shapes, message text) on
 * each `setState` call.
 */
export interface MascotMarkup {
    state: MascotState;
    /** CSS classes to apply on the root element. */
    rootClassList: string[];
    /** Resolved message text (post-i18n, post-override). */
    message: string;
    /** Aria-label applied to the root. */
    ariaLabel: string;
    /** Inline CSS custom property value (so themes can override stroke color). */
    strokeCssVar: string;
    /** `var(--name)` expression used as stroke color in the SVG. */
    strokeColor: string;
    /** SVG viewBox attribute. Constant but exposed for tests. */
    svgViewBox: string;
    /** SVG shapes describing the mascot for this state. */
    svgShapes: MascotSvgShapes;
}

export interface BuildMascotMarkupOptions {
    /** Translator for the default state message. */
    translator: MascotTranslator;
    /** Optional override text — bypasses i18n lookup. */
    messageOverride?: string;
    /** Optional override for the root's aria-label (B5 may pass richer copy). */
    ariaLabel?: string;
    /**
     * B5 / D007.4 — when `true`, strip every `animClass` from the SVG
     * descriptor AND append `pa-pagelet-mascot--reduce-motion` to the
     * root class list. Defaults to `false` (animations on).
     *
     * Why strip animClasses at the markup layer (not in CSS only):
     *  - CSS `@media (prefers-reduced-motion)` covers most cases, BUT
     *    some Obsidian themes override the media query (intentionally,
     *    for kiosk-style displays). Surfacing the decision in the
     *    markup descriptor lets a no-CSS environment also honor user
     *    intent.
     *  - The modifier class on the root remains the canonical hook for
     *    CSS to suppress any keyframes the bare `animClass` removal
     *    misses (e.g. ambient float on the root).
     */
    reducedMotion?: boolean;
}

// ---------------------------------------------------------------------------
// Pure builders
// ---------------------------------------------------------------------------

/**
 * Compose the markup descriptor for the given state.
 *
 * Pure: same input → same output. No `Date.now`, no DOM access. The
 * renderer is the only place that mutates anything.
 *
 * Resolution order for the message:
 *   1. `options.messageOverride` (caller-supplied, highest priority)
 *   2. `translator(MASCOT_STATE_I18N_KEY[state])`
 *   3. EN-language hard-coded default (covers the "missing key" case)
 *
 * Rationale for the 3rd step: `pageletT` surfaces the literal key name
 * when no entry is found anywhere. That's useful in dev (loud failure)
 * but jarring in production. Falling through to the spec default means
 * end users always read a sentence, while dev still notices the key
 * miss via the absent translation (the key string IS the fallback in
 * `pageletT`, which we detect by exact-key match).
 */
export function buildMascotMarkup(
    state: MascotState,
    options: BuildMascotMarkupOptions,
): MascotMarkup {
    const i18nKey = MASCOT_STATE_I18N_KEY[state];
    const fallbackText = MASCOT_STATE_DEFAULT_TEXT[state];
    const rawMessage = options.messageOverride
        ?? options.translator(i18nKey, fallbackText);
    // pageletT returns the key itself when no entry is found AND no
    // fallback is supplied. Defensively treat that case as a miss so
    // we still surface the EN spec text.
    const message = rawMessage === i18nKey ? fallbackText : rawMessage;

    const ariaLabel = options.ariaLabel
        ?? options.translator("pagelet.a11y.mascotLabel", "Pagelet status indicator");

    const strokeCssVar = MASCOT_STATE_STROKE_VAR[state];
    const strokeColor = `var(${strokeCssVar})`;

    const baseClassList = [
        "pa-pagelet-mascot",
        `pa-pagelet-mascot--${state}`,
    ];
    const rootClassList = options.reducedMotion
        ? [...baseClassList, "pa-pagelet-mascot--reduce-motion"]
        : baseClassList;

    const svgShapes = options.reducedMotion
        ? stripAnimClasses(SVG_SHAPES_BY_STATE[state])
        : SVG_SHAPES_BY_STATE[state];

    return {
        state,
        rootClassList,
        message,
        ariaLabel,
        strokeCssVar,
        strokeColor,
        svgViewBox: MASCOT_SVG_VIEWBOX,
        svgShapes,
    };
}

/**
 * Return a copy of `shapes` with every `animClass` stripped. The
 * frozen base tables are kept untouched — we always emit a fresh
 * object so the renderer can mutate freely without poisoning the
 * shared descriptor.
 */
function stripAnimClasses(shapes: MascotSvgShapes): MascotSvgShapes {
    const paths = shapes.paths.map((p) => {
        if (!p.animClass) return { ...p };
        const { animClass: _omit, ...rest } = p;
        void _omit;
        return rest;
    });
    if (!shapes.circles) return { paths };
    const circles = shapes.circles.map((c) => {
        if (!c.animClass) return { ...c };
        const { animClass: _omit, ...rest } = c;
        void _omit;
        return rest;
    });
    return { paths, circles };
}

// ---------------------------------------------------------------------------
// SVG geometry tables — copied verbatim from `docs/pagelet-visual-spec.html`.
//
// Path strings include intentional ±0.1~0.3 jitter (Tldraw-like 手绘 per
// D005); do NOT "tidy" the decimals — they are the visual signature.
// ---------------------------------------------------------------------------

/** Shared outline (notepad body + folded corner) used by all 4 states. */
const NOTEPAD_BODY_D = "M10.2 8.3 L30 8 L36.1 14.2 L36 37.8 L10 38.1 Z";
const NOTEPAD_FOLD_D = "M30 8.1 L29.9 14.2 L36 14";

const SVG_SHAPES_BY_STATE: Readonly<Record<MascotState, MascotSvgShapes>> = Object.freeze({
    idle: {
        paths: [
            { d: NOTEPAD_BODY_D, strokeWidth: 1.6 },
            { d: NOTEPAD_FOLD_D, strokeWidth: 1.6 },
            // Two arc "eyes" — squint-style, blink animation
            { d: "M16.8 22.1 Q19 22.9 21.2 21.8", strokeWidth: 1.4, animClass: "pa-pagelet-anim-blink" },
            { d: "M24.8 22 Q27 23 29.1 21.9", strokeWidth: 1.4, animClass: "pa-pagelet-anim-blink" },
        ],
    },
    thinking: {
        paths: [
            { d: NOTEPAD_BODY_D, strokeWidth: 1.6 },
            { d: NOTEPAD_FOLD_D, strokeWidth: 1.6 },
        ],
        // Three pulsing dots, staggered by animation-delay (handled via class)
        circles: [
            { cx: 18, cy: 24, r: 1.2, animClass: "pa-pagelet-anim-pulse-1" },
            { cx: 23, cy: 24, r: 1.2, animClass: "pa-pagelet-anim-pulse-2" },
            { cx: 28, cy: 24, r: 1.2, animClass: "pa-pagelet-anim-pulse-3" },
        ],
    },
    done: {
        paths: [
            { d: NOTEPAD_BODY_D, strokeWidth: 1.6 },
            { d: NOTEPAD_FOLD_D, strokeWidth: 1.6 },
            // "^^" eyes — happy / approving
            { d: "M16 21.2 L19.1 24 L22 21", strokeWidth: 1.4 },
            { d: "M24 21 L27 24 L30 21.2", strokeWidth: 1.4 },
        ],
    },
    error: {
        paths: [
            { d: NOTEPAD_BODY_D, strokeWidth: 1.6 },
            { d: NOTEPAD_FOLD_D, strokeWidth: 1.6 },
            // "x x" eyes — failure, then a frown mouth
            { d: "M16 21.1 L20 25 M20 21 L16 25.1", strokeWidth: 1.4 },
            { d: "M25 21 L29 25 M29 21.1 L25 25", strokeWidth: 1.4 },
            { d: "M18 31 Q22 28 26 31", strokeWidth: 1.4 },
        ],
    },
});
