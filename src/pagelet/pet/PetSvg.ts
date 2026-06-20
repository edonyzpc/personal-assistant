/* Copyright 2023 edonyzpc */

/**
 * Pagelet Pet SVG builder and updater.
 *
 * SVG path data is copied verbatim from the Pagelet prototype.
 * Intentional ±0.1~0.3 jitter gives the Tldraw-like hand-drawn feel (D005).
 * Do NOT tidy the decimals.
 */

import type { PetState, PetTaskKind } from "./types";
import { getPlatformDocument } from "../../platform-dom";

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

const TASK_STROKE: Readonly<Record<PetTaskKind, string>> = {
    review: "#4f73e6",
    connection: "#14936b",
    summary: "#c77700",
    background: "#7c3aed",
};

function strokeColor(state: PetState, isLight: boolean, taskKind: PetTaskKind): string {
    if (state === "working") {
        return TASK_STROKE[taskKind];
    }
    return isLight ? LIGHT_STROKE[state] : DARK_STROKE[state];
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(
    tag: K,
): SVGElementTagNameMap[K] {
    return getPlatformDocument().createElementNS(SVG_NS, tag);
}

function createPath(d: string, sw: number, color: string): SVGPathElement {
    const path = createSvgElement("path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", color);
    path.setAttribute("stroke-width", String(sw));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    return path;
}

function createCircle(cx: number, cy: number, r: number, color: string, cls: string): SVGCircleElement {
    const circle = createSvgElement("circle");
    circle.setAttribute("cx", String(cx));
    circle.setAttribute("cy", String(cy));
    circle.setAttribute("r", String(r));
    circle.setAttribute("fill", color);
    circle.setAttribute("class", cls);
    return circle;
}

function createText(
    x: number,
    y: number,
    fontSize: number,
    color: string,
    opacity: string,
    cls: string,
    text: string,
): SVGTextElement {
    const textEl = createSvgElement("text");
    textEl.setAttribute("x", String(x));
    textEl.setAttribute("y", String(y));
    textEl.setAttribute("font-size", String(fontSize));
    textEl.setAttribute("fill", color);
    textEl.setAttribute("opacity", opacity);
    textEl.setAttribute("font-family", "monospace");
    textEl.setAttribute("class", cls);
    textEl.textContent = text;
    return textEl;
}

function replaceSvgChildren(svgEl: SVGElement, children: SVGElement[]): void {
    while (svgEl.firstChild) {
        svgEl.removeChild(svgEl.firstChild);
    }
    for (const child of children) {
        svgEl.appendChild(child);
    }
}

export function createPetSvgElement(state: PetState, taskKind: PetTaskKind = "review"): SVGSVGElement {
    const svg = createSvgElement("svg");
    svg.setAttribute("xmlns", SVG_NS);
    svg.setAttribute("viewBox", VIEWBOX);
    svg.setAttribute("width", "52");
    svg.setAttribute("height", "52");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    replaceSvgChildren(svg, buildInnerNodes(state, strokeColor(state, false, taskKind)));
    return svg;
}

function buildInnerNodes(state: PetState, color: string): SVGElement[] {
    const parts: SVGElement[] = [
        createPath(BODY_D, 1.6, color),
        createPath(FOLD_D, 1.6, color),
    ];

    switch (state) {
        case "resting": {
            parts.push(createPath(SLEEP_EYE_LEFT_D, 1.4, color));
            parts.push(createPath(SLEEP_EYE_RIGHT_D, 1.4, color));

            const zzz = createSvgElement("g");
            zzz.setAttribute("class", "pa-pagelet-pet-sleep-zzz");
            zzz.appendChild(createText(34, 12, 7, color, "0.4", "pa-pagelet-pet-zzz1", "z"));
            zzz.appendChild(createText(37, 7, 5, color, "0.25", "pa-pagelet-pet-zzz2", "z"));
            parts.push(zzz);
            break;
        }

        case "idle": {
            const left = createSvgElement("g");
            left.setAttribute("class", "pa-pagelet-pet-blink-group");
            left.appendChild(createPath(EYE_LEFT_D, 1.4, color));
            parts.push(left);

            const right = createSvgElement("g");
            right.setAttribute("class", "pa-pagelet-pet-blink-group");
            right.appendChild(createPath(EYE_RIGHT_D, 1.4, color));
            parts.push(right);
            break;
        }

        case "working": {
            parts.push(createPath(EYE_LEFT_D, 1.4, color));
            parts.push(createPath(EYE_RIGHT_D, 1.4, color));

            const dots = createSvgElement("g");
            dots.setAttribute("class", "pa-pagelet-pet-think-dots");
            DOTS.forEach((dot, i) => {
                dots.appendChild(createCircle(dot.cx, dot.cy, dot.r, color, `pa-pagelet-pet-dot pa-pagelet-pet-dot-${i + 1}`));
            });
            parts.push(dots);
            break;
        }

        case "nudge": {
            const left = createSvgElement("g");
            left.setAttribute("class", "pa-pagelet-pet-blink-group");
            left.appendChild(createPath(EYE_LEFT_D, 1.4, color));
            parts.push(left);

            const right = createSvgElement("g");
            right.setAttribute("class", "pa-pagelet-pet-blink-group");
            right.appendChild(createPath(EYE_RIGHT_D, 1.4, color));
            parts.push(right);
            parts.push(createPath(MOUTH_D, 1.4, color));
            break;
        }
    }

    return parts;
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
    taskKind: PetTaskKind = "review",
): void {
    const color = strokeColor(state, isLightTheme, taskKind);
    replaceSvgChildren(svgEl, buildInnerNodes(state, color));
}
