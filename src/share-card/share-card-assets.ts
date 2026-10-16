/* Copyright 2023 edonyzpc */

function createSvgElement(
    doc: Document,
    tagName: keyof SVGElementTagNameMap,
    attributes: Readonly<Record<string, string>>,
): SVGElement {
    const element = doc.win.createSvg(tagName);
    for (const [name, value] of Object.entries(attributes)) {
        element.setAttribute(name, value);
    }
    return element;
}

function appendSvgChildren(parent: SVGElement, children: readonly SVGElement[]): void {
    for (const child of children) parent.appendChild(child);
}

/** PA mark with three colored nodes, optically balanced for the 16px footer. */
export function createShareCardLogo(doc: Document): SVGSVGElement {
    const svg = createSvgElement(doc, "svg", {
        viewBox: "0 0 24 24",
        width: "16",
        height: "16",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "2.2",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "aria-hidden": "true",
    }) as SVGSVGElement;
    appendSvgChildren(svg, [
        createSvgElement(doc, "path", { d: "M3.8 19.25c3.3-7.45 8.5-12.95 16.3-14.8" }),
        createSvgElement(doc, "path", { d: "M7.05 18.75c5.15 1.55 10.1-1.05 13.55-7" }),
        createSvgElement(doc, "path", { d: "M10.8 12.2 C13 12.6 15.6 11.4 17.5 9.2" }),
        createSvgElement(doc, "circle", { cx: "4", cy: "19.3", r: "2.4", fill: "#2f9e44", stroke: "none" }),
        createSvgElement(doc, "circle", { cx: "11.9", cy: "11.95", r: "2.4", fill: "#1971c2", stroke: "none" }),
        createSvgElement(doc, "circle", { cx: "19.8", cy: "4.55", r: "2.4", fill: "#f08c00", stroke: "none" }),
    ]);
    return svg;
}

/** User-approved EZ handwriting mark used as the default Share Card signature. */
export function createShareCardSharerMark(doc: Document): SVGSVGElement {
    const svg = createSvgElement(doc, "svg", {
        viewBox: "63.5 25.125 224 168",
        width: "32",
        height: "24",
        "aria-hidden": "true",
    }) as SVGSVGElement;
    const group = createSvgElement(doc, "g", {
        fill: "none",
        stroke: "currentColor",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
    });
    appendSvgChildren(group, [
        createSvgElement(doc, "path", {
            d: "M90 77 C108 66 128 65 145 71",
            "stroke-width": "23",
        }),
        createSvgElement(doc, "path", {
            d: "M88 110 C109 102 129 103 146 108",
            "stroke-width": "19",
        }),
        createSvgElement(doc, "path", {
            d: "M89 141 C110 140 132 144 153 150",
            "stroke-width": "20",
        }),
        createSvgElement(doc, "path", {
            d: "M188 78 C210 71 233 72 254 79",
            "stroke-width": "20",
        }),
        createSvgElement(doc, "path", {
            d: "M249 83 C228 100 206 119 185 140",
            "stroke-width": "24",
        }),
        createSvgElement(doc, "path", {
            d: "M182 144 C208 142 236 146 262 152",
            "stroke-width": "21",
        }),
    ]);
    svg.appendChild(group);
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
