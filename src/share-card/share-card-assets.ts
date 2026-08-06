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
 * Pre-rendered 32x32 paper noise texture as a PNG data URI.
 * Tiled via CSS background-repeat for full card coverage.
 */
export const SHARE_CARD_NOISE_DATA_URI =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0"
    + "AAABoUlEQVR4nMWXuw6EMAwEt6GhoaGh4Vv9+vDTIKU7IRAhNCddLNvj1So4MjNF"
    + "xFpVk7tvmTmb2R4RS1XJ3dfMnMxsi4i5qnZ3XzJTZrZGxFRVm7vPmbmb2RIRqqrV"
    + "3afM3Mxsjoi9qhZ3V2auZjZFxMafoxiHNCIBCIqNiDHhQQY1E3GIElV1UDMRCSiB"
    + "SlAzEcVQApVQkIlohBKohIKoSyOUQCUURF0gUAKV+DkOKQYECTRCcooBQQKNAKQY"
    + "EExEIwApBgTwNAKQwYAAnkYAMhgQwDM0gCQejYDgkASK0QgIAEmgGI2AAJBpKUYj"
    + "IAAEHk/QCAgAgWcwFAQCQOAZjKHVzEAjipEw0pifma/F1MwANRNxONKYamagGBAk"
    + "jDSmmhmA4JCEkcbU2S01wpj6ynwtprNbaoQxT2+pEcbU2S01wpi6+/nsbUx9Zb4W"
    + "093PZ29j6u7ns7cxdffz2duYXfa6J8bUl/sgMfXY654YUz32uifGVI+97okx9daD"
    + "46ox9eU+SOy1B8dVY+qtB8dVY+qtB8dVY2rkS/ifMfXlPkjsBzO6VrPH4GbzAAAA"
    + "AElFTkSuQmCC";
