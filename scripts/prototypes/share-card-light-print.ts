import type { App } from "obsidian";
import {
    ShareCardRenderer,
    type ShareCardRenderHandle,
    type ShareCardRenderOptions,
    type ShareCardRendererOptions,
} from "../../src/share-card/share-card-renderer";
import type { CardPage } from "../../src/share-card/share-card-types";

export const SHARE_CARD_LIGHT_PRINT_FILTER_PREFIX = "pa-share-card-light-print";

export const SHARE_CARD_LIGHT_PRINT_PARAMETERS = {
    lowFrequency: "0.01 0.02",
    lowOctaves: 2,
    lowScale: 1.8,
    highFrequency: "1",
    highOctaves: 2,
    highScale: 0.5,
    seed: 0,
    filterBounds: { x: "-5%", y: "-15%", width: "110%", height: "130%" },
} as const;

export interface ShareCardLightPrintReport {
    filterId: string;
    headingCount: number;
    wrappedHeadingCount: number;
    wrappedRunCount: number;
}

export interface ShareCardLightPrintInspection {
    definitionCount: number;
    filterIds: string[];
    selectedCount: number;
    unresolvedReferences: string[];
}

const LOCAL_FILTER_REFERENCE = /^url\(\s*(?:"(#[^")\s]+)"|'(#[^')\s]+)'|(#[^'")\s]+))\s*\)$/u;

let nextLightPrintFilterSequence = 0;

function allocateShareCardLightPrintFilterId(): string {
    nextLightPrintFilterSequence += 1;
    return `${SHARE_CARD_LIGHT_PRINT_FILTER_PREFIX}-${nextLightPrintFilterSequence}`;
}

function isExcludedInlineRoot(node: ChildNode): boolean {
    if (node.nodeType !== 1) return false;
    const element = node as Element;
    const tagName = element.tagName.toLowerCase();
    if ([
        "canvas",
        "code",
        "img",
        "kbd",
        "picture",
        "pre",
        "samp",
        "svg",
    ].includes(tagName)) {
        return true;
    }
    // A safe formatting ancestor is visited recursively so its ordinary text
    // leaves can be selected without wrapping a protected descendant.
    return false;
}

function isLightPrintWrapper(node: ChildNode): boolean {
    return node.nodeType === 1
        && (node as Element).classList.contains("pa-share-card-light-print-text");
}

function setFilterReference(element: HTMLElement, filterId: string): void {
    element.style.setProperty("filter", `url(#${filterId})`);
}

function appendLightPrintFilterDefinition(
    cardEl: HTMLElement,
    filterId: string,
): SVGElement {
    const ownerDocument = cardEl.ownerDocument;
    const svgNamespace = "http://www.w3.org/2000/svg";
    const createElement = (
        tagName: string,
        attributes: Readonly<Record<string, string>>,
    ): SVGElement => {
        const element = typeof ownerDocument.createElementNS === "function"
            ? ownerDocument.createElementNS(svgNamespace, tagName)
            : ownerDocument.createElement(tagName);
        for (const [name, value] of Object.entries(attributes)) {
            element.setAttribute(name, value);
        }
        return element as SVGElement;
    };

    const svg = createElement("svg", {
        "aria-hidden": "true",
        "focusable": "false",
        "height": "0",
        "width": "0",
    });
    svg.classList.add("pa-share-card-light-print-defs");
    svg.style.position = "absolute";
    svg.style.width = "0";
    svg.style.height = "0";
    svg.style.pointerEvents = "none";

    const defs = createElement("defs", {});
    const filter = createElement("filter", {
        id: filterId,
        "color-interpolation-filters": "sRGB",
        "filterUnits": "objectBoundingBox",
        ...SHARE_CARD_LIGHT_PRINT_PARAMETERS.filterBounds,
    });
    filter.appendChild(createElement("feTurbulence", {
        baseFrequency: SHARE_CARD_LIGHT_PRINT_PARAMETERS.lowFrequency,
        numOctaves: String(SHARE_CARD_LIGHT_PRINT_PARAMETERS.lowOctaves),
        result: "lowNoise",
        seed: String(SHARE_CARD_LIGHT_PRINT_PARAMETERS.seed),
        stitchTiles: "noStitch",
        type: "turbulence",
    }));
    filter.appendChild(createElement("feDisplacementMap", {
        in: "SourceGraphic",
        in2: "lowNoise",
        result: "lowDisplaced",
        scale: String(SHARE_CARD_LIGHT_PRINT_PARAMETERS.lowScale),
        xChannelSelector: "R",
        yChannelSelector: "G",
    }));
    filter.appendChild(createElement("feTurbulence", {
        baseFrequency: SHARE_CARD_LIGHT_PRINT_PARAMETERS.highFrequency,
        numOctaves: String(SHARE_CARD_LIGHT_PRINT_PARAMETERS.highOctaves),
        result: "highNoise",
        seed: String(SHARE_CARD_LIGHT_PRINT_PARAMETERS.seed),
        stitchTiles: "noStitch",
        type: "turbulence",
    }));
    filter.appendChild(createElement("feDisplacementMap", {
        in: "lowDisplaced",
        in2: "highNoise",
        scale: String(SHARE_CARD_LIGHT_PRINT_PARAMETERS.highScale),
        xChannelSelector: "R",
        yChannelSelector: "G",
    }));
    defs.appendChild(filter);
    svg.appendChild(defs);
    cardEl.appendChild(svg);
    return svg;
}

export function applyShareCardLightPrint(
    cardEl: HTMLElement,
    bodyEl: HTMLElement,
    filterId: string,
): ShareCardLightPrintReport {
    if (bodyEl.querySelector("[data-pa-share-card-light-print=\"heading-text\"]")) {
        return {
            filterId,
            headingCount: 0,
            wrappedHeadingCount: 0,
            wrappedRunCount: 0,
        };
    }

    const headings = Array.from(bodyEl.querySelectorAll("h1,h2,h3"));
    let wrappedHeadingCount = 0;
    let wrappedRunCount = 0;

    for (const heading of headings) {
        let wrappedCurrentHeading = false;
        const wrapTextRun = (parent: HTMLElement, run: readonly ChildNode[]): void => {
            const text = run.map((node) => node.textContent ?? "").join("");
            if (text.trim().length === 0) return;
            const wrapper = heading.ownerDocument.createElement("span");
            wrapper.classList.add("pa-share-card-light-print-text");
            wrapper.setAttribute("data-pa-share-card-light-print", "heading-text");
            parent.insertBefore(wrapper, run[0]);
            for (const node of run) wrapper.appendChild(node);
            setFilterReference(wrapper, filterId);
            wrappedRunCount += 1;
            wrappedCurrentHeading = true;
        };

        // Adjacent Text nodes form one inline run in the source DOM. Selecting
        // them together preserves whitespace and avoids inserting a wrapper at
        // every glyph boundary; every element remains a hard run boundary.
        const visit = (parent: HTMLElement): void => {
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
                    wrapTextRun(parent, children.slice(index, end));
                    index = end - 1;
                    continue;
                }
                if (node.nodeType !== 1 || isExcludedInlineRoot(node) || isLightPrintWrapper(node)) {
                    continue;
                }
                const element = node as HTMLElement;
                visit(element);
            }
        };

        visit(heading as HTMLElement);
        if (wrappedCurrentHeading) wrappedHeadingCount += 1;
    }

    if (wrappedRunCount > 0) appendLightPrintFilterDefinition(cardEl, filterId);
    return {
        filterId,
        headingCount: headings.length,
        wrappedHeadingCount,
        wrappedRunCount,
    };
}

export function inspectShareCardLightPrint(
    cardEl: HTMLElement,
    bodyEl: HTMLElement,
): ShareCardLightPrintInspection {
    const definitions = Array.from(cardEl.querySelectorAll(".pa-share-card-light-print-defs"))
        .flatMap((svg) => Array.from(svg.querySelectorAll("filter")));
    const filterIds = new Set(definitions
        .map((element) => element.getAttribute("id") ?? "")
        .filter(Boolean));
    const selected = Array.from(bodyEl.querySelectorAll("*"))
        .filter((element) => element.getAttribute("data-pa-share-card-light-print") === "heading-text");
    const unresolvedReferences: string[] = [];
    for (const element of selected) {
        const htmlElement = element as HTMLElement;
        const filterValue = htmlElement.style.getPropertyValue("filter").trim();
        const match = LOCAL_FILTER_REFERENCE.exec(filterValue);
        const fragmentId = match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
        // Chromium serializes a local CSS URL with double quotes. A valid
        // reference must still name a definition in this card; other URL forms
        // remain unresolved so capture cannot silently fall back to external SVG.
        if (!fragmentId?.startsWith("#") || !filterIds.has(fragmentId.slice(1))) {
            unresolvedReferences.push(filterValue);
        }
    }
    return {
        definitionCount: definitions.length,
        filterIds: [...filterIds],
        selectedCount: selected.length,
        unresolvedReferences,
    };
}

/**
 * Wrap the existing Share Card renderer rather than duplicating Markdown,
 * pagination, sanitization, preview, or SnapDOM export behavior.
 */
export class ShareCardLightPrintRenderer extends ShareCardRenderer {
    constructor(
        app: App,
        ownerDocument: Document,
        private readonly options: ShareCardRendererOptions = {},
        private readonly enabled = true,
    ) {
        super(app, ownerDocument, options);
    }

    override async renderPage(
        page: CardPage,
        options: ShareCardRenderOptions,
    ): Promise<ShareCardRenderHandle> {
        if (!this.enabled) return await super.renderPage(page, options);

        // Allocate before the first await so concurrent renderer instances cannot collide.
        const filterId = allocateShareCardLightPrintFilterId();
        const render = await super.renderPage(page, options);
        try {
            applyShareCardLightPrint(render.cardEl, render.bodyEl, filterId);
            return render;
        } catch (error) {
            render.cleanup();
            throw error;
        }
    }
}

export interface ShareCardLightPrintModalLike {
    close(): void;
}

/**
 * Owns probe-modal lifetime so closing one of several modals cannot restore a
 * theme still used by another modal. Close callbacks and restore are idempotent.
 */
export class ShareCardLightPrintModalRegistry {
    private readonly entries = new Map<ShareCardLightPrintModalLike, () => void>();
    private restoreCallCount = 0;
    private closed = false;
    private restoreCompleted = false;

    constructor(private readonly restoreChrome: () => void) {}

    add(modal: ShareCardLightPrintModalLike, onClosed: () => void): void {
        if (this.closed) throw new Error("The light-print modal registry is already closed.");
        // A new modal starts a new occupied lifecycle after the previous empty
        // cycle restored chrome. Without this reset, only the first cycle is
        // ever restored even though applyTheme will activate chrome again.
        this.restoreCompleted = false;
        this.entries.set(modal, onClosed);
    }

    handleClosed(modal: ShareCardLightPrintModalLike): void {
        if (!this.entries.delete(modal)) return;
        if (this.entries.size === 0) this.restore();
    }

    closeAll(): void {
        this.closed = true;
        for (const [modal, onClosed] of [...this.entries]) {
            if (!this.entries.delete(modal)) continue;
            try {
                onClosed();
                modal.close();
            } catch (error) {
                console.error("PA Light Print Probe modal close failed.", error);
            }
        }
        this.restore();
    }

    get openCount(): number {
        return this.entries.size;
    }

    get restoreCount(): number {
        return this.restoreCallCount;
    }

    private restore(): void {
        if (this.entries.size > 0) return;
        if (this.restoreCompleted) return;
        this.restoreCompleted = true;
        this.restoreCallCount += 1;
        this.restoreChrome();
    }
}
