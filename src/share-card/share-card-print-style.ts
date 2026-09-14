/* Copyright 2023 edonyzpc */

import type { ShareCardPrintStyle } from "./share-card-types";

export const SHARE_CARD_HEADING_LIGHT_PRINT_PARAMETERS = {
    lowFrequency: "0.01 0.02",
    lowOctaves: 2,
    lowScale: 1.8,
    highFrequency: "1",
    highOctaves: 2,
    highScale: 0.5,
    seed: 0,
    filterBounds: { x: "-5%", y: "-15%", width: "110%", height: "130%" },
} as const;

/**
 * Body text keeps the two-frequency texture while staying readable at
 * 14-22px: each stage is 33-40% of the approved heading stage and below one
 * displacement scale unit.
 */
export const SHARE_CARD_BODY_LIGHT_PRINT_PARAMETERS = {
    lowFrequency: "0.01 0.02",
    lowOctaves: 2,
    lowScale: 0.6,
    highFrequency: "1",
    highOctaves: 2,
    highScale: 0.2,
    seed: 0,
    filterBounds: { x: "-5%", y: "-15%", width: "110%", height: "130%" },
} as const;

export interface ShareCardPrintStyleReport {
    headingRunCount: number;
    bodyRunCount: number;
    filterIds: string[];
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const PROTECTED_TAGS = new Set([
    "canvas", "code", "img", "kbd", "picture", "pre", "samp", "svg",
]);
const PROTECTED_CLASSES = [
    "pa-share-card-resource-placeholder",
    "pa-share-card-visual-block",
    "block-language-mermaid",
    "internal-embed",
    "media-embed",
    "mermaid",
];

let nextShareCardPrintFilterSequence = 0;

function allocateFilterId(kind: "heading" | "body"): string {
    nextShareCardPrintFilterSequence += 1;
    return `pa-share-card-print-${kind}-${nextShareCardPrintFilterSequence}`;
}

function isProtectedElement(element: Element): boolean {
    if (PROTECTED_TAGS.has(element.tagName.toLowerCase())) return true;
    return PROTECTED_CLASSES.some((className) => element.classList.contains(className));
}

function isPrintWrapper(element: Element): boolean {
    return element.classList.contains("pa-share-card-print-text");
}

function appendFilterReference(element: HTMLElement, filterId: string): void {
    element.style.setProperty("filter", `url(#${filterId})`);
}

function appendTurbulence(
    filter: SVGElement,
    result: string,
    frequency: string,
    octaves: number,
    seed: number,
): void {
    const turbulence = createElement(filter.ownerDocument, "feTurbulence", {
        baseFrequency: frequency,
        numOctaves: String(octaves),
        result,
        seed: String(seed),
        stitchTiles: "noStitch",
        type: "turbulence",
    });
    filter.appendChild(turbulence);
}

function appendDisplacement(
    filter: SVGElement,
    input: string,
    noise: string,
    result: string,
    scale: number,
): void {
    const displacement = createElement(filter.ownerDocument, "feDisplacementMap", {
        in: input,
        in2: noise,
        result,
        scale: String(scale),
        xChannelSelector: "R",
        yChannelSelector: "G",
    });
    filter.appendChild(displacement);
}

function createElement(
    ownerDocument: Document,
    tagName: string,
    attributes: Readonly<Record<string, string>>,
): SVGElement {
    const element = typeof ownerDocument.createElementNS === "function"
        ? ownerDocument.createElementNS(SVG_NAMESPACE, tagName)
        : ownerDocument.createElement(tagName);
    for (const [name, value] of Object.entries(attributes)) {
        element.setAttribute(name, value);
    }
    return element as SVGElement;
}

function appendLightFilterDefinition(
    cardEl: HTMLElement,
    filterId: string,
    parameters: typeof SHARE_CARD_HEADING_LIGHT_PRINT_PARAMETERS
        | typeof SHARE_CARD_BODY_LIGHT_PRINT_PARAMETERS,
): void {
    const svg = createElement(cardEl.ownerDocument, "svg", {
        "aria-hidden": "true",
        "focusable": "false",
        "height": "0",
        "width": "0",
    });
    svg.classList.add("pa-share-card-print-defs");
    svg.style.setProperty("position", "absolute");
    svg.style.setProperty("width", "0");
    svg.style.setProperty("height", "0");
    svg.style.setProperty("pointer-events", "none");

    const defs = createElement(cardEl.ownerDocument, "defs", {});
    const filter = createElement(cardEl.ownerDocument, "filter", {
        id: filterId,
        "color-interpolation-filters": "sRGB",
        filterUnits: "objectBoundingBox",
        ...parameters.filterBounds,
    });
    appendTurbulence(
        filter,
        "lowNoise",
        parameters.lowFrequency,
        parameters.lowOctaves,
        parameters.seed,
    );
    appendDisplacement(
        filter,
        "SourceGraphic",
        "lowNoise",
        "lowDisplaced",
        parameters.lowScale,
    );
    appendTurbulence(
        filter,
        "highNoise",
        parameters.highFrequency,
        parameters.highOctaves,
        parameters.seed,
    );
    appendDisplacement(
        filter,
        "lowDisplaced",
        "highNoise",
        "grained",
        parameters.highScale,
    );
    defs.appendChild(filter);
    svg.appendChild(defs);
    cardEl.appendChild(svg);
}

function appendXeroxFilterDefinition(cardEl: HTMLElement, filterId: string): void {
    const svg = createElement(cardEl.ownerDocument, "svg", {
        "aria-hidden": "true",
        "focusable": "false",
        "height": "0",
        "width": "0",
    });
    svg.classList.add("pa-share-card-print-defs");
    svg.style.setProperty("position", "absolute");
    svg.style.setProperty("width", "0");
    svg.style.setProperty("height", "0");
    svg.style.setProperty("pointer-events", "none");

    const defs = createElement(cardEl.ownerDocument, "defs", {});
    const filter = createElement(cardEl.ownerDocument, "filter", {
        id: filterId,
        "color-interpolation-filters": "sRGB",
        filterUnits: "objectBoundingBox",
        x: "-10%",
        y: "-25%",
        width: "120%",
        height: "500%",
    });
    appendTurbulence(filter, "lowNoise", "0.01 0.02", 2, 0);
    appendDisplacement(filter, "SourceGraphic", "lowNoise", "warped", 4);
    const firstComposite = createElement(cardEl.ownerDocument, "feComposite", {
        in: "SourceGraphic",
        in2: "warped",
        operator: "atop",
        result: "mergedBase",
    });
    filter.appendChild(firstComposite);
    appendTurbulence(filter, "highNoise", "1", 2, 0);
    appendDisplacement(filter, "mergedBase", "highNoise", "grained", 1);
    const secondComposite = createElement(cardEl.ownerDocument, "feComposite", {
        in: "mergedBase",
        in2: "grained",
        operator: "atop",
        result: "offsetBase",
    });
    filter.appendChild(secondComposite);
    const offset = createElement(cardEl.ownerDocument, "feOffset", {
        in: "offsetBase",
        dx: "-3",
        dy: "-3",
    });
    filter.appendChild(offset);
    defs.appendChild(filter);
    svg.appendChild(defs);
    cardEl.appendChild(svg);
}

/**
 * Apply the selected print texture to one final card clone. Prepared Markdown
 * prototypes stay unstyled, so switching styles never reruns a processor.
 */
export function applyShareCardPrintStyle(
    cardEl: HTMLElement,
    bodyEl: HTMLElement,
    printStyle: ShareCardPrintStyle = "original",
): ShareCardPrintStyleReport {
    if (printStyle === "original") {
        return { headingRunCount: 0, bodyRunCount: 0, filterIds: [] };
    }
    if (bodyEl.querySelector(".pa-share-card-print-text")) {
        return { headingRunCount: 0, bodyRunCount: 0, filterIds: [] };
    }

    const headingFilterId = allocateFilterId("heading");
    const bodyFilterId = allocateFilterId("body");
    let headingRunCount = 0;
    let bodyRunCount = 0;

    const wrapTextRun = (
        parent: HTMLElement,
        run: readonly ChildNode[],
        isHeading: boolean,
    ): void => {
        const text = run.map((node) => node.textContent ?? "").join("");
        if (text.trim().length === 0) return;
        const wrapper = parent.ownerDocument.createElement("span");
        wrapper.classList.add("pa-share-card-print-text");
        wrapper.setAttribute(
            "data-pa-share-card-print-text",
            isHeading ? "heading" : "body",
        );
        parent.insertBefore(wrapper, run[0] ?? null);
        for (const node of run) wrapper.appendChild(node);
        appendFilterReference(wrapper, isHeading ? headingFilterId : bodyFilterId);
        if (isHeading) headingRunCount += 1;
        else bodyRunCount += 1;
    };

    const visit = (parent: HTMLElement, headingScope: boolean): void => {
        const children = Array.from(parent.childNodes);
        for (let index = 0; index < children.length; index += 1) {
            let end = index + 1;
            while (
                end < children.length
                && children[index].nodeType === 3
                && children[end].nodeType === 3
            ) end += 1;

            const node = children[index];
            if (node.nodeType === 3) {
                wrapTextRun(parent, children.slice(index, end), headingScope);
                index = end - 1;
                continue;
            }
            if (node.nodeType !== 1) continue;
            const element = node as HTMLElement;
            if (isProtectedElement(element) || isPrintWrapper(element)) continue;
            const tagName = element.tagName.toLowerCase();
            visit(element, headingScope || tagName === "h1" || tagName === "h2" || tagName === "h3");
        }
    };

    visit(bodyEl, false);
    const filterIds: string[] = [];
    if (headingRunCount > 0) {
        if (printStyle === "light-print") {
            appendLightFilterDefinition(
                cardEl,
                headingFilterId,
                SHARE_CARD_HEADING_LIGHT_PRINT_PARAMETERS,
            );
        } else {
            appendXeroxFilterDefinition(cardEl, headingFilterId);
        }
        filterIds.push(headingFilterId);
    }
    if (bodyRunCount > 0) {
        appendLightFilterDefinition(
            cardEl,
            bodyFilterId,
            SHARE_CARD_BODY_LIGHT_PRINT_PARAMETERS,
        );
        filterIds.push(bodyFilterId);
    }
    return { headingRunCount, bodyRunCount, filterIds };
}
