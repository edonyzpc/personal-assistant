/* Copyright 2023 edonyzpc */

/**
 * Pet v2 SVG builder and updater.
 *
 * SVG path data is copied verbatim from `docs/pagelet-v2-prototype.html`.
 * Intentional ±0.1~0.3 jitter gives the Tldraw-like hand-drawn feel (D005).
 * Do NOT tidy the decimals.
 */

import type { PetState } from "./types";

// ---------------------------------------------------------------------------
// SVG geometry constants
// ---------------------------------------------------------------------------

const VIEWBOX = "0 0 44 44";
const SVG_NS = "http://www.w3.org/2000/svg";

const BODY_D = "M10.2 8.3 L30 8 L36.1 14.2 L36 37.8 L10 38.1 Z";
const FOLD_D = "M30 8.1 L29.9 14.2 L36 14";

const EYE_LEFT_D = "M16.8 22.1 Q19 22.9 21.2 21.8";
const EYE_RIGHT_D = "M24.8 22 Q27 23 29.1 21.9";

const SLEEP_EYE_LEFT_D = "M16 22.5 L21 22.5";
const SLEEP_EYE_RIGHT_D = "M25 22.5 L30 22.5";

const MOUTH_D = "M19 28 Q23 31 27 28";

const DOTS = [
    { cx: 18, cy: 28, r: 1.2 },
    { cx: 23, cy: 28, r: 1.2 },
    { cx: 28, cy: 28, r: 1.2 },
] as const;

// ---------------------------------------------------------------------------
// Color maps
// ---------------------------------------------------------------------------

const DARK_STROKE: Readonly<Record<PetState, string>> = {
    resting: "#d0d0d0",
    idle: "#e8e8e8",
    working: "#7c9eff",
    nudge: "#5dd39e",
};

const LIGHT_STROKE: Readonly<Record<PetState, string>> = {
    resting: "#a0a0a0",
    idle: "#666666",
    working: "#5a7de6",
    nudge: "#3dba82",
};

function strokeColor(state: PetState, isLight: boolean): string {
    return isLight ? LIGHT_STROKE[state] : DARK_STROKE[state];
}

// ---------------------------------------------------------------------------
// Pure SVG string builder
// ---------------------------------------------------------------------------

function pathStr(d: string, sw: number, color: string, extra = ""): string {
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
}

function circleStr(cx: number, cy: number, r: number, color: string, cls: string): string {
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" class="${cls}"/>`;
}

/**
 * Build a complete Pet SVG string for the given state (dark theme assumed).
 * Use `updatePetSvgState` for in-place DOM updates with theme awareness.
 */
export function buildPetSvg(state: PetState): string {
    const color = DARK_STROKE[state];
    const inner = buildInnerMarkup(state, color);
    return [
        `<svg xmlns="${SVG_NS}" viewBox="${VIEWBOX}" width="52" height="52" aria-hidden="true" focusable="false">`,
        inner,
        "</svg>",
    ].join("");
}

function buildInnerMarkup(state: PetState, color: string): string {
    const parts: string[] = [];

    // Body + fold (always present)
    parts.push(pathStr(BODY_D, 1.6, color));
    parts.push(pathStr(FOLD_D, 1.6, color));

    switch (state) {
        case "resting":
            // Closed eyes (horizontal lines)
            parts.push(pathStr(SLEEP_EYE_LEFT_D, 1.4, color));
            parts.push(pathStr(SLEEP_EYE_RIGHT_D, 1.4, color));
            // Zzz text
            parts.push(
                `<g class="pa-pagelet-pet-sleep-zzz">`,
                `<text x="34" y="12" font-size="7" fill="${color}" opacity="0.4" font-family="monospace" class="pa-pagelet-pet-zzz1">z</text>`,
                `<text x="37" y="7" font-size="5" fill="${color}" opacity="0.25" font-family="monospace" class="pa-pagelet-pet-zzz2">z</text>`,
                `</g>`,
            );
            break;

        case "idle":
            // Arc eyes with blink animation
            parts.push(
                `<g class="pa-pagelet-pet-blink-group">`,
                pathStr(EYE_LEFT_D, 1.4, color),
                `</g>`,
            );
            parts.push(
                `<g class="pa-pagelet-pet-blink-group">`,
                pathStr(EYE_RIGHT_D, 1.4, color),
                `</g>`,
            );
            break;

        case "working":
            // Normal eyes (no blink during work)
            parts.push(pathStr(EYE_LEFT_D, 1.4, color));
            parts.push(pathStr(EYE_RIGHT_D, 1.4, color));
            // Three pulsing dots
            parts.push(`<g class="pa-pagelet-pet-think-dots">`);
            DOTS.forEach((dot, i) => {
                parts.push(circleStr(dot.cx, dot.cy, dot.r, color, `pa-pagelet-pet-dot pa-pagelet-pet-dot-${i + 1}`));
            });
            parts.push(`</g>`);
            break;

        case "nudge":
            // Normal eyes + smile mouth
            parts.push(
                `<g class="pa-pagelet-pet-blink-group">`,
                pathStr(EYE_LEFT_D, 1.4, color),
                `</g>`,
            );
            parts.push(
                `<g class="pa-pagelet-pet-blink-group">`,
                pathStr(EYE_RIGHT_D, 1.4, color),
                `</g>`,
            );
            parts.push(pathStr(MOUTH_D, 1.4, color));
            break;
    }

    return parts.join("\n");
}

// ---------------------------------------------------------------------------
// DOM updater — mutates an existing SVG element in place
// ---------------------------------------------------------------------------

/**
 * Update an existing SVG element to reflect the given state and theme.
 * Replaces all children (cheap — max ~10 nodes). This avoids state-leak
 * where e.g. the nudge mouth lingers after switching to idle.
 */
export function updatePetSvgState(
    svgEl: SVGElement,
    state: PetState,
    isLightTheme: boolean,
): void {
    const color = strokeColor(state, isLightTheme);
    // Replace inner content atomically
    svgEl.innerHTML = buildInnerMarkup(state, color);
}
