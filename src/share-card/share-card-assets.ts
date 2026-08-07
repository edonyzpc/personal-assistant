/* Copyright 2023 edonyzpc */

const SVG_NS = "http://www.w3.org/2000/svg";

function createSvgElement(
    doc: Document,
    tagName: string,
    attributes: Readonly<Record<string, string>>,
): SVGElement {
    const element = typeof doc.createElementNS === "function"
        ? doc.createElementNS(SVG_NS, tagName)
        : doc.createElement(tagName) as unknown as SVGElement;
    for (const [name, value] of Object.entries(attributes)) {
        element.setAttribute(name, value);
    }
    return element;
}

function appendSvgChildren(parent: SVGElement, children: readonly SVGElement[]): void {
    for (const child of children) parent.appendChild(child);
}

/** Pagelet Detail icon (3-color dots + curves), scaled for card footer. */
export function createShareCardLogo(doc: Document): SVGSVGElement {
    const svg = createSvgElement(doc, "svg", {
        viewBox: "0 0 24 24",
        width: "16",
        height: "16",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "2.4",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "aria-hidden": "true",
    }) as SVGSVGElement;
    appendSvgChildren(svg, [
        createSvgElement(doc, "path", { d: "M3.8 19.25c3.3-7.45 8.5-12.95 16.3-14.8" }),
        createSvgElement(doc, "path", { d: "M7.05 18.75c5.15 1.55 10.1-1.05 13.55-7" }),
        createSvgElement(doc, "path", { d: "M9.45 12.65c3.05.7 6.1-.85 8.4-3.9" }),
        createSvgElement(doc, "circle", { cx: "4", cy: "19.3", r: "2.65", fill: "#2f9e44", stroke: "none" }),
        createSvgElement(doc, "circle", { cx: "11.25", cy: "12.7", r: "2.35", fill: "#1971c2", stroke: "none" }),
        createSvgElement(doc, "circle", { cx: "19.8", cy: "4.55", r: "2.55", fill: "#f08c00", stroke: "none" }),
    ]);
    return svg;
}

/** Minimal botanical vine ornament used in both card corners. */
export function createShareCardOrnament(doc: Document): SVGSVGElement {
    const svg = createSvgElement(doc, "svg", {
        viewBox: "0 0 60 60",
        width: "60",
        height: "60",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "0.8",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        opacity: "0.35",
        "aria-hidden": "true",
    }) as SVGSVGElement;
    appendSvgChildren(svg, [
        createSvgElement(doc, "path", { d: "M4 56C8 40 16 28 30 20" }),
        createSvgElement(doc, "path", { d: "M30 20c-6-2-12 1-14 6" }),
        createSvgElement(doc, "path", { d: "M30 20c-3 5-2 11 3 14" }),
        createSvgElement(doc, "path", { d: "M12 42c4-3 9-2 11 2" }),
        createSvgElement(doc, "path", { d: "M12 42c-1 4 1 8 5 9" }),
        createSvgElement(doc, "path", { d: "M22 30c3-2 7-1 8 3" }),
        createSvgElement(doc, "circle", { cx: "30", cy: "20", r: "1.5", fill: "currentColor", stroke: "none", opacity: "0.3" }),
        createSvgElement(doc, "circle", { cx: "12", cy: "42", r: "1.2", fill: "currentColor", stroke: "none", opacity: "0.25" }),
    ]);
    return svg;
}

/**
 * Pre-rendered 64x64 paper-fiber grain texture as a PNG data URI.
 * High-contrast grayscale noise with dark fiber specks to simulate
 * real paper surface under natural light.
 * Tiled via CSS background-repeat for full card coverage.
 */
export const SHARE_CARD_NOISE_DATA_URI =
    "data:image/png;base64,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";
