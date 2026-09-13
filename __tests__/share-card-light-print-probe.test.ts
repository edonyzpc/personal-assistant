import { MarkdownRenderer, type App } from "obsidian";

jest.mock("../src/share-card/share-card-font", () => ({
    registerShareCardFontFace: jest.fn().mockResolvedValue(undefined),
    unregisterShareCardFontFace: jest.fn(),
}));

import {
    installExternalCallAudit,
    ProbeShareCardModal,
    ShareCardLightPrintProbeController,
    visibleRelativeRect,
} from "../scripts/prototypes/share-card-light-print-obsidian";
import { registerShareCardFontFace } from "../src/share-card/share-card-font";
import {
    applyShareCardLightPrint,
    inspectShareCardLightPrint,
    SHARE_CARD_LIGHT_PRINT_PARAMETERS,
    ShareCardLightPrintModalRegistry,
    ShareCardLightPrintRenderer,
} from "../scripts/prototypes/share-card-light-print";
import {
    evaluateShareCardPixelComparison,
    type ShareCardPixelData,
    type ShareCardPixelRect,
} from "../scripts/prototypes/share-card-light-print-pixels";
import {
    ShareCardTestDocument,
    ShareCardTestElement,
    asDocument,
    asElement,
    flushShareCardTasks,
    type ShareCardTestElement as TestElement,
} from "./helpers/share-card-dom";

class LightPrintTestElement extends ShareCardTestElement {
    readonly nodeType = 1;

    constructor(tagName: string, ownerDocument: LightPrintTestDocument) {
        super(tagName, ownerDocument);
        const style = this.style as typeof this.style & {
            getPropertyValue: (key: string) => string;
        };
        style.getPropertyValue = (key) => this.style.values.get(key) ?? "";
    }

    insertBefore(
        child: LightPrintTestElement,
        reference: LightPrintTestElement | null,
    ): LightPrintTestElement {
        child.parentElement?.removeChild(child);
        child.parentElement = this;
        if (!reference) {
            this.children.push(child);
            return child;
        }
        const index = this.children.indexOf(reference);
        this.children.splice(index < 0 ? this.children.length : index, 0, child);
        return child;
    }

    override querySelectorAll(selector: string): TestElement[] {
        // The base helper predates Text nodes and assumes every child is an
        // element. Keep selector semantics DOM-correct for this document.
        return super.querySelectorAll(selector)
            .filter((node) => (node as unknown as { nodeType?: number }).nodeType === 1);
    }
}

class LightPrintTestText {
    readonly nodeType = 3;
    readonly childNodes: readonly ChildNode[] = [];
    readonly children: TestElement[] = [];
    readonly classList = { contains: () => false };
    tagName = "";
    parentElement: LightPrintTestElement | null = null;

    constructor(
        readonly ownerDocument: LightPrintTestDocument,
        readonly textContent: string,
    ) {}

    setConnected(): void {
        // Connectivity is not needed by the light-print selection contract.
    }

    getAttribute(): null {
        return null;
    }

    getAttributeNames(): string[] {
        return [];
    }

    cloneNode(): LightPrintTestText {
        return this.ownerDocument.createTextNode(this.textContent);
    }
}

class LightPrintTestDocument extends ShareCardTestDocument {
    override createElement(tagName: string): LightPrintTestElement {
        return new LightPrintTestElement(tagName, this);
    }

    createElementNS(_namespace: string, tagName: string): LightPrintTestElement {
        return this.createElement(tagName.toLowerCase());
    }

    createTextNode(text: string): LightPrintTestText {
        return new LightPrintTestText(this, text);
    }

    querySelectorAll(selector: string): TestElement[] {
        return this.body.querySelectorAll(selector);
    }
}

interface ProbeModalDiagnostic {
    contentEl: HTMLElement;
    onOpen(): void;
    onClose(): void;
    theme?: "light" | "dark";
    appearance?: { theme?: "light" | "dark" };
    renderer?: unknown;
    exporter?: { probeAppearance?: { theme?: "light" | "dark" } };
}

function setHostTheme(document: LightPrintTestDocument, dark: boolean): void {
    for (const element of [document.documentElement, document.body]) {
        if (dark) {
            element.classList.remove("theme-light");
            element.classList.add("theme-dark");
        } else {
            element.classList.remove("theme-dark");
            element.classList.add("theme-light");
        }
    }
}

function createProbeModal(
    document: LightPrintTestDocument,
    theme: "light" | "dark",
    controller: { modalClosed(modal: unknown): void },
): ProbeModalDiagnostic {
    const modal = new ProbeShareCardModal(
        {} as App,
        {
            content: "# Probe",
            source: "note",
            sourceLabel: "Light print probe",
        },
        true,
        theme,
        controller as ShareCardLightPrintProbeController,
    );
    const contentEl = document.createElement("div");
    const modalEl = document.createElement("div");
    modalEl.appendChild(contentEl);
    document.body.appendChild(modalEl);
    (modal as unknown as { contentEl: HTMLElement }).contentEl = asElement(contentEl);
    (modal as unknown as { modalEl: HTMLElement }).modalEl = asElement(modalEl);
    return modal as unknown as ProbeModalDiagnostic;
}

async function waitForProbePreparation(modal: ProbeModalDiagnostic): Promise<void> {
    for (let attempt = 0; attempt < 100 && modal.appearance == null; attempt += 1) {
        await flushShareCardTasks();
    }
    expect(modal.appearance).not.toBeNull();
}

function useHTMLInputElement(): () => void {
    const globals = globalThis as { HTMLInputElement?: unknown };
    const previous = globals.HTMLInputElement;
    globals.HTMLInputElement = class {};
    return () => {
        if (previous === undefined) {
            delete globals.HTMLInputElement;
        } else {
            globals.HTMLInputElement = previous;
        }
    };
}

function appendTextNode(parent: TestElement, text: string): ChildNode {
    const document = parent.ownerDocument as LightPrintTestDocument;
    const node = document.createTextNode(text);
    parent.appendChild(node as unknown as TestElement);
    return node as unknown as ChildNode;
}

function appendElement(parent: TestElement, tagName: string, text = ""): TestElement {
    const element = (parent.ownerDocument as LightPrintTestDocument).createElement(tagName);
    if (text) appendTextNode(element, text);
    parent.appendChild(element);
    return element;
}

function childNodesOf(element: TestElement): readonly ChildNode[] {
    return Array.from(element.childNodes) as unknown as readonly ChildNode[];
}

function collectText(nodes: readonly ChildNode[]): string {
    return nodes.map((node) => (
        node.nodeType === 3
            ? node.textContent ?? ""
            : collectText(Array.from(
                (node as unknown as { childNodes: ChildNode[] }).childNodes,
            ))
    )).join("");
}

function createProbeDom(): {
    body: TestElement;
    card: TestElement;
    heading: TestElement;
} {
    const document = new LightPrintTestDocument();
    const card = document.createElement("div");
    const body = document.createElement("div");

    const heading = document.createElement("h1");
    appendTextNode(heading, "Title ");
    appendElement(heading, "img");
    const emphasis = appendElement(heading, "em");
    appendTextNode(emphasis, "ordinary ");
    const strong = appendElement(emphasis, "strong");
    appendTextNode(strong, "heading");
    appendElement(strong, "code");
    body.appendChild(heading);

    const secondHeading = document.createElement("h2");
    appendTextNode(secondHeading, "Second heading ");
    appendElement(secondHeading, "kbd");
    body.appendChild(secondHeading);

    appendElement(body, "h4", "Not selected");
    appendElement(body, "p", "ordinary paragraph");
    appendElement(body, "pre", "ordinary block");
    card.appendChild(body);
    return { body, card, heading };
}

function hasFilteredAncestor(element: TestElement): boolean {
    let current = element.parentElement;
    while (current) {
        if (current.getAttribute("data-pa-share-card-light-print") === "heading-text") return true;
        current = current.parentElement;
    }
    return false;
}

function pixelData(bytes: readonly number[]): ShareCardPixelData {
    return {
        data: new Uint8ClampedArray(bytes),
        width: 2,
        height: 2,
    };
}

function changePixel(
    bytes: readonly number[],
    index: number,
): ShareCardPixelData {
    const next = [...bytes];
    next[index] ^= 1;
    return pixelData(next);
}

function createFilterReferenceDom(reference: string): {
    body: TestElement;
    card: TestElement;
} {
    const document = new LightPrintTestDocument();
    const card = document.createElement("div");
    const body = document.createElement("div");
    const heading = document.createElement("h1");
    const selected = document.createElement("span");
    const svg = document.createElement("svg");
    const defs = document.createElement("defs");
    const filter = document.createElement("filter");

    svg.classList.add("pa-share-card-light-print-defs");
    selected.classList.add("pa-share-card-light-print-text");
    selected.setAttribute("data-pa-share-card-light-print", "heading-text");
    selected.style.setProperty("filter", reference);
    heading.appendChild(selected);
    filter.setAttribute("id", "probe-filter");
    defs.appendChild(filter);
    svg.appendChild(defs);
    body.appendChild(heading);
    card.appendChild(body);
    card.appendChild(svg);
    return { body, card };
}

function geometryElement(
    rect: { x: number; y: number; width: number; height: number },
    overflow: { x: string; y: string } = { x: "visible", y: "visible" },
): HTMLElement {
    const element = {
        parentElement: null as HTMLElement | null,
        ownerDocument: {
            defaultView: {
                getComputedStyle: () => ({
                    overflowX: overflow.x,
                    overflowY: overflow.y,
                }),
            },
        },
        getBoundingClientRect: () => ({
            ...rect,
            left: rect.x,
            top: rect.y,
            right: rect.x + rect.width,
            bottom: rect.y + rect.height,
        }),
    };
    return element as unknown as HTMLElement;
}

function appendGeometryElement(parent: HTMLElement, child: HTMLElement): void {
    (child as unknown as { parentElement: HTMLElement | null }).parentElement = parent;
}

describe("Share Card light-print prototype", () => {
    const registerFont = jest.mocked(registerShareCardFontFace);

    beforeEach(() => {
        registerFont.mockReset().mockResolvedValue(undefined);
    });

    const renderMock = MarkdownRenderer.render as jest.MockedFunction<
        typeof MarkdownRenderer.render
    >;

    beforeEach(() => {
        renderMock.mockReset();
        renderMock.mockImplementation(async (_app, markdown, element) => {
            const body = element as unknown as TestElement;
            const document = body.ownerDocument as LightPrintTestDocument;
            const heading = document.createElement("h2");
            const text = document.createTextNode(markdown);
            const code = document.createElement("code");
            code.textContent = "code()";
            heading.appendChild(text as unknown as TestElement);
            heading.appendChild(code);
            body.appendChild(heading);
        });
    });

    it("wraps only safe heading text leaves and never protected descendants", () => {
        const { body, card, heading } = createProbeDom();
        const beforeText = collectText(
            Array.from(heading.childNodes) as unknown as readonly ChildNode[],
        );
        const report = applyShareCardLightPrint(
            asElement(card),
            asElement(body),
            "probe-filter",
        );

        expect(report).toEqual({
            filterId: "probe-filter",
            headingCount: 2,
            wrappedHeadingCount: 2,
            wrappedRunCount: 4,
        });
        expect(collectText(
            Array.from(heading.childNodes) as unknown as readonly ChildNode[],
        )).toBe(beforeText);

        const wrappers = body.querySelectorAll(".pa-share-card-light-print-text");
        expect(wrappers).toHaveLength(4);
        for (const wrapper of wrappers) {
            expect(wrapper.style.values.get("filter")).toBe("url(#probe-filter)");
            expect(["h1", "h2", "h3", "em", "strong"]).toContain(wrapper.parentElement?.tagName);
        }

        for (const tag of ["img", "code", "kbd"]) {
            for (const protectedElement of body.querySelectorAll(tag)) {
                expect(hasFilteredAncestor(protectedElement)).toBe(false);
                expect(protectedElement.style.values.get("filter")).toBeUndefined();
            }
        }
        expect(body.querySelector("h4")!.style.values.get("filter")).toBeUndefined();
        expect(body.querySelector("p")!.style.values.get("filter")).toBeUndefined();
        expect(body.querySelector("pre")!.style.values.get("filter")).toBeUndefined();

        expect(body.querySelectorAll("img")).toHaveLength(1);
        expect(body.querySelectorAll("code")).toHaveLength(1);
        expect(card.querySelectorAll("filter")).toHaveLength(1);
        expect(inspectShareCardLightPrint(asElement(card), asElement(body))).toEqual({
            definitionCount: 1,
            filterIds: ["probe-filter"],
            selectedCount: 4,
            unresolvedReferences: [],
        });
    });

    it("groups actual adjacent one-character Text nodes beside code", () => {
        const document = new LightPrintTestDocument();
        const card = document.createElement("div");
        const body = document.createElement("div");
        const heading = document.createElement("h2");
        heading.setAttribute("dir", "auto");
        for (const character of "Light print probe ") {
            appendTextNode(heading, character);
        }
        const code = appendElement(heading, "code", "headingCode");
        body.appendChild(heading);
        card.appendChild(body);
        const beforeText = collectText(childNodesOf(heading).slice(0, 18));
        expect(heading.childNodes).toHaveLength(19);
        expect(childNodesOf(heading).slice(0, 18).every((node) => node.nodeType === 3)).toBe(true);

        const report = applyShareCardLightPrint(
            asElement(card),
            asElement(body),
            "probe-filter",
        );

        expect(report).toEqual({
            filterId: "probe-filter",
            headingCount: 1,
            wrappedHeadingCount: 1,
            wrappedRunCount: 1,
        });
        expect(heading.childNodes).toHaveLength(2);
        const wrapper = heading.childNodes[0] as TestElement;
        expect(wrapper.tagName).toBe("span");
        expect(wrapper.parentElement).toBe(heading);
        expect(wrapper.childNodes).toHaveLength(18);
        expect(childNodesOf(wrapper).every((node) => node.nodeType === 3)).toBe(true);
        expect(collectText(childNodesOf(wrapper))).toBe(beforeText);
        expect(wrapper.classList.contains("pa-share-card-light-print-text")).toBe(true);
        expect(wrapper.getAttribute("data-pa-share-card-light-print")).toBe("heading-text");
        expect(wrapper.style.values.get("filter")).toBe("url(#probe-filter)");
        expect(heading.childNodes[1]).toBe(code);
        expect(hasFilteredAncestor(code)).toBe(false);
        expect(inspectShareCardLightPrint(asElement(card), asElement(body))).toEqual({
            definitionCount: 1,
            filterIds: ["probe-filter"],
            selectedCount: 1,
            unresolvedReferences: [],
        });
    });

    it("preserves text order and whitespace across boundaries and is idempotent", () => {
        const document = new LightPrintTestDocument();
        const card = document.createElement("div");
        const body = document.createElement("div");
        const heading = document.createElement("h2");
        appendTextNode(heading, "Before ");
        appendTextNode(heading, "mid ");
        const emphasis = appendElement(heading, "em");
        appendTextNode(emphasis, "inner ");
        appendTextNode(emphasis, "tail ");
        const code = appendElement(heading, "code", "protected");
        appendTextNode(heading, " after");
        const image = appendElement(heading, "img");
        appendTextNode(heading, " final");
        body.appendChild(heading);
        card.appendChild(body);
        const beforeText = collectText(childNodesOf(heading));

        const first = applyShareCardLightPrint(
            asElement(card),
            asElement(body),
            "first-filter",
        );

        expect(first).toEqual({
            filterId: "first-filter",
            headingCount: 1,
            wrappedHeadingCount: 1,
            wrappedRunCount: 4,
        });
        const wrappers = body.querySelectorAll(".pa-share-card-light-print-text");
        expect(wrappers.map((wrapper) => collectText(childNodesOf(wrapper))))
            .toEqual(["Before mid ", "inner tail ", " after", " final"]);
        expect(wrappers.map((wrapper) => wrapper.parentElement?.tagName))
            .toEqual(["h2", "em", "h2", "h2"]);
        expect(collectText(childNodesOf(heading))).toBe(beforeText);
        expect(childNodesOf(heading).map((node) => (
            node.nodeType === 3
                ? `text:${node.textContent}`
                : (node as unknown as TestElement).tagName
        ) as string)).toEqual(["span", "em", "code", "span", "img", "span"]);
        expect(emphasis.childNodes.map((node) => node.tagName)).toEqual(["span"]);
        for (const protectedElement of [code, image]) {
            expect(hasFilteredAncestor(protectedElement)).toBe(false);
            expect(protectedElement.style.values.get("filter")).toBeUndefined();
        }

        const second = applyShareCardLightPrint(
            asElement(card),
            asElement(body),
            "second-filter",
        );
        expect(second).toEqual({
            filterId: "second-filter",
            headingCount: 1,
            wrappedHeadingCount: 0,
            wrappedRunCount: 0,
        });
        expect(body.querySelectorAll(".pa-share-card-light-print-text")).toHaveLength(4);
        expect(card.querySelectorAll("filter")).toHaveLength(1);
        for (const wrapper of body.querySelectorAll(".pa-share-card-light-print-text")) {
            expect(wrapper.style.values.get("filter")).toBe("url(#first-filter)");
        }
    });

    it("leaves content without selected headings unchanged", () => {
        const document = new LightPrintTestDocument();
        const card = document.createElement("div");
        const body = document.createElement("div");
        appendElement(body, "p", "no heading");
        appendElement(body, "code", "inline()");
        appendElement(body, "img");
        card.appendChild(body);

        const report = applyShareCardLightPrint(asElement(card), asElement(body), "probe-filter");

        expect(report).toEqual({
            filterId: "probe-filter",
            headingCount: 0,
            wrappedHeadingCount: 0,
            wrappedRunCount: 0,
        });
        expect(card.querySelectorAll("svg")).toHaveLength(0);
        expect(body.querySelectorAll("span")).toHaveLength(0);
        expect(inspectShareCardLightPrint(asElement(card), asElement(body))).toEqual({
            definitionCount: 0,
            filterIds: [],
            selectedCount: 0,
            unresolvedReferences: [],
        });
        const pixels = pixelData([1, 2, 3, 4]);
        expect(evaluateShareCardPixelComparison(pixels, pixels, [], [], false)).toEqual({
            changedPixelCount: 0,
            selectedRegionChangedPixelCount: 0,
            protectedRegionChangedPixelCount: 0,
            outsideSelectedChangedPixelCount: 0,
            pass: true,
        });
    });

    it.each([
        ["unquoted", "url(#probe-filter)"],
        ["single-quoted", "url('#probe-filter')"],
        ["double-quoted", 'url("#probe-filter")'],
    ])("accepts a %s Chromium-style local filter reference", (_name, reference) => {
        const { body, card } = createFilterReferenceDom(reference);

        expect(inspectShareCardLightPrint(asElement(card), asElement(body)).unresolvedReferences)
            .toEqual([]);
    });

    it.each([
        ["missing definition", "url(#missing-filter)"],
        ["external URL", "url(https://example.test/filter.svg#probe-filter)"],
        ["external quoted URL", 'url("https://example.test/filter.svg#probe-filter")'],
        ["malformed URL", "url(#probe-filter"],
        ["non-local fragment", "url(probe-filter)"],
    ])("rejects a %s filter reference", (_name, reference) => {
        const { body, card } = createFilterReferenceDom(reference);

        expect(inspectShareCardLightPrint(asElement(card), asElement(body)).unresolvedReferences)
            .toEqual([reference]);
    });

    it("evaluates identical, selected, protected, and ordinary pixel changes", () => {
        const bytes = [
            255, 0, 0, 255, 0, 255, 0, 255,
            0, 0, 255, 255, 255, 255, 0, 255,
        ];
        const selectedRect: ShareCardPixelRect = { x: 0, y: 0, width: 1, height: 1 };
        const protectedRect: ShareCardPixelRect = { x: 1, y: 1, width: 1, height: 1 };
        const baseline = pixelData(bytes);

        expect(evaluateShareCardPixelComparison(
            baseline,
            baseline,
            [selectedRect],
            [protectedRect],
            false,
        )).toEqual(expect.objectContaining({
            changedPixelCount: 0,
            protectedRegionChangedPixelCount: 0,
            outsideSelectedChangedPixelCount: 0,
            pass: true,
        }));

        expect(evaluateShareCardPixelComparison(
            baseline,
            changePixel(bytes, 0),
            [selectedRect],
            [protectedRect],
            true,
        )).toEqual(expect.objectContaining({
            selectedRegionChangedPixelCount: 1,
            protectedRegionChangedPixelCount: 0,
            outsideSelectedChangedPixelCount: 0,
            pass: true,
        }));

        expect(evaluateShareCardPixelComparison(
            baseline,
            changePixel(bytes, 12),
            [selectedRect],
            [protectedRect],
            true,
        )).toEqual(expect.objectContaining({
            protectedRegionChangedPixelCount: 1,
            pass: false,
        }));

        expect(evaluateShareCardPixelComparison(
            baseline,
            changePixel(bytes, 4),
            [selectedRect],
            [protectedRect],
            true,
        )).toEqual(expect.objectContaining({
            outsideSelectedChangedPixelCount: 1,
            pass: false,
        }));
    });

    it("clips protected geometry to visible ancestors without losing visible code coverage", () => {
        const card = geometryElement({ x: 0, y: 0, width: 1080, height: 1440 });
        const body = geometryElement({ x: 0, y: 0, width: 1080, height: 1440 });
        const pre = geometryElement(
            { x: 90, y: 1085, width: 900, height: 84 },
            { x: "hidden", y: "hidden" },
        );
        const nestedCode = geometryElement({
            x: 120,
            y: 1125,
            width: 634.25,
            height: 130,
        });
        const heading = geometryElement({ x: 90, y: 471, width: 398.21875, height: 62 });
        const inlineCode = geometryElement({ x: 90, y: 471, width: 398.21875, height: 62 });
        appendGeometryElement(card, body);
        appendGeometryElement(body, pre);
        appendGeometryElement(pre, nestedCode);
        appendGeometryElement(body, heading);
        appendGeometryElement(heading, inlineCode);

        expect(visibleRelativeRect(nestedCode, card)).toEqual({
            x: 240,
            y: 2250,
            width: 1268.5,
            height: 88,
        });
        expect(visibleRelativeRect(pre, card)).toEqual({
            x: 180,
            y: 2170,
            width: 1800,
            height: 168,
        });
        expect(visibleRelativeRect(inlineCode, card)).toEqual({
            x: 180,
            y: 942,
            width: 796.4375,
            height: 124,
        });

        const bytes = new Uint8ClampedArray(4 * 4 * 4);
        const baseline: ShareCardPixelData = { data: bytes, width: 4, height: 4 };
        const changeAt = (x: number, y: number): ShareCardPixelData => {
            const next = new Uint8ClampedArray(bytes);
            next[(y * 4 + x) * 4 + 3] = 1;
            return { data: next, width: 4, height: 4 };
        };
        const selectedHeading: ShareCardPixelRect = { x: 3, y: 3, width: 1, height: 1 };
        const protectedRects = [
            { x: 1, y: 1, width: 1, height: 1 },
            { x: 0, y: 0, width: 1, height: 1 },
            { x: 2, y: 2, width: 1, height: 1 },
        ];

        expect(evaluateShareCardPixelComparison(
            baseline,
            changeAt(3, 3),
            [selectedHeading],
            protectedRects,
            true,
        )).toEqual(expect.objectContaining({
            selectedRegionChangedPixelCount: 1,
            protectedRegionChangedPixelCount: 0,
            pass: true,
        }));
        for (const [x, y] of [[1, 1], [0, 0], [2, 2]] as const) {
            expect(evaluateShareCardPixelComparison(
                baseline,
                changeAt(x, y),
                [selectedHeading],
                protectedRects,
                true,
            )).toEqual(expect.objectContaining({
                protectedRegionChangedPixelCount: 1,
                pass: false,
            }));
        }
    });

    it("keeps the host theme isolated while the requested theme reaches rendering and export", async () => {
        for (const [hostDark, requestedTheme] of [
            [true, "light"],
            [false, "dark"],
        ] as const) {
            const document = new LightPrintTestDocument();
            setHostTheme(document, hostDark);
            const closed: unknown[] = [];
            const modal = createProbeModal(document, requestedTheme, {
                modalClosed: (closedModal) => closed.push(closedModal),
            });
            const restoreInputElement = useHTMLInputElement();
            try {
                modal.onOpen();
                await waitForProbePreparation(modal);

                expect(modal.theme).toBe(requestedTheme);
                expect(modal.appearance).toEqual(expect.objectContaining({ theme: requestedTheme }));
                expect(modal.renderer).toBeDefined();
                expect(modal.exporter?.probeAppearance).toBe(modal.appearance);
                const card = modal.contentEl.querySelector(".pa-share-card");
                expect(card?.classList.contains(`is-${requestedTheme}`)).toBe(true);
                expect(card?.classList.contains(
                    `is-${requestedTheme === "light" ? "dark" : "light"}`,
                )).toBe(false);

                modal.onClose();
                expect(closed).toEqual([modal]);
                for (const element of [document.documentElement, document.body]) {
                    expect(element.classList.contains("theme-dark")).toBe(hostDark);
                    expect(element.classList.contains("theme-light")).toBe(!hostDark);
                }
            }
            finally {
                restoreInputElement();
            }
        }
    });

    it("keeps concurrent card themes local across an external host theme change", async () => {
        const document = new LightPrintTestDocument();
        setHostTheme(document, true);
        const first = createProbeModal(document, "light", { modalClosed: () => undefined });
        const second = createProbeModal(document, "dark", { modalClosed: () => undefined });
        const restoreInputElement = useHTMLInputElement();
        try {
            first.onOpen();
            second.onOpen();
            await waitForProbePreparation(first);
            await waitForProbePreparation(second);
            expect(first.theme).toBe("light");
            expect(second.theme).toBe("dark");
            expect(first.contentEl.querySelector(".pa-share-card")?.classList.contains("is-light"))
                .toBe(true);
            expect(second.contentEl.querySelector(".pa-share-card")?.classList.contains("is-dark"))
                .toBe(true);

            setHostTheme(document, false);
            first.onClose();
            for (const element of [document.documentElement, document.body]) {
                expect(element.classList.contains("theme-dark")).toBe(false);
                expect(element.classList.contains("theme-light")).toBe(true);
            }

            second.onClose();
            for (const element of [document.documentElement, document.body]) {
                expect(element.classList.contains("theme-dark")).toBe(false);
                expect(element.classList.contains("theme-light")).toBe(true);
            }
        } finally {
            restoreInputElement();
        }
    });

    it("does not restore or overwrite an externally changed host theme during modal cleanup", async () => {
        const document = new LightPrintTestDocument();
        const previousDocument = (globalThis as { document?: Document }).document;
        (globalThis as { document?: Document }).document = asDocument(document);
        try {
            const root = document.documentElement;
            const body = document.body;
            const app = {
                vault: { getName: () => "test" },
            } as unknown as App;
            const controller = new ShareCardLightPrintProbeController(app);
            const first: { close(): void } = {
                close: () => controller.modalClosed(first),
            };
            const second: { close(): void } = {
                close: () => controller.modalClosed(second),
            };
            controller.modalRegistry.add(first, jest.fn());
            controller.modalRegistry.add(second, jest.fn());
            expect(controller.status().chromeSnapshotActive).toBe(false);

            root.classList.add("theme-dark");
            body.classList.add("theme-dark");
            first.close();
            expect(root.classList.contains("theme-dark")).toBe(true);
            expect(body.classList.contains("theme-dark")).toBe(true);

            root.classList.remove("theme-dark");
            body.classList.remove("theme-dark");
            second.close();
            await controller.cleanup();
            expect(root.classList.contains("theme-dark")).toBe(false);
            expect(body.classList.contains("theme-dark")).toBe(false);
            expect(controller.status().chromeSnapshotActive).toBe(false);
        } finally {
            if (previousDocument === undefined) {
                delete (globalThis as { document?: Document }).document;
            } else {
                (globalThis as { document?: Document }).document = previousDocument;
            }
        }
    });

    it("uses the renderer seam for preview/export renders and cleans definitions with the card", async () => {
        const document = new LightPrintTestDocument();
        const host = document.createElement("div");
        document.body.appendChild(host);
        const first = new ShareCardLightPrintRenderer(
            {} as App,
            asDocument(document),
            { waitForFrame: async () => undefined },
        );
        const second = new ShareCardLightPrintRenderer(
            {} as App,
            asDocument(document),
            { waitForFrame: async () => undefined },
        );
        const options = { theme: "light" as const };
        const page = { content: "# title", pageIndex: 0, totalPages: 1 };
        const firstRender = await first.renderPage(page, { ...options, host: asElement(host) });
        const secondRender = await second.renderPage(page, options);

        const firstInspection = inspectShareCardLightPrint(
            asElement(firstRender.cardEl as unknown as TestElement),
            asElement(firstRender.bodyEl as unknown as TestElement),
        );
        const secondInspection = inspectShareCardLightPrint(
            asElement(secondRender.cardEl as unknown as TestElement),
            asElement(secondRender.bodyEl as unknown as TestElement),
        );
        expect(firstInspection.definitionCount).toBe(1);
        expect(secondInspection.definitionCount).toBe(1);
        expect(firstInspection.filterIds[0]).not.toBe(secondInspection.filterIds[0]);
        expect(firstInspection.unresolvedReferences).toEqual([]);
        expect(secondInspection.unresolvedReferences).toEqual([]);

        firstRender.cleanup();
        secondRender.cleanup();
        first.cleanup();
        second.cleanup();
        expect(document.body.querySelectorAll(".pa-share-card-light-print-defs")).toHaveLength(0);
        expect(host.children).toHaveLength(0);
    });

    it("restores probe chrome only after all registered modals close", () => {
        let restoreCount = 0;
        const registry = new ShareCardLightPrintModalRegistry(() => {
            restoreCount += 1;
        });
        const first = { close: jest.fn() };
        const second = { close: jest.fn() };
        const firstClosed = jest.fn();
        const secondClosed = jest.fn();
        registry.add(first, firstClosed);
        registry.add(second, secondClosed);

        registry.handleClosed(first);
        expect(registry.openCount).toBe(1);
        expect(restoreCount).toBe(0);
        expect(first.close).not.toHaveBeenCalled();
        expect(firstClosed).not.toHaveBeenCalled();

        registry.handleClosed(second);
        expect(registry.openCount).toBe(0);
        expect(restoreCount).toBe(1);

        registry.handleClosed(second);
        registry.closeAll();
        expect(registry.openCount).toBe(0);
        expect(restoreCount).toBe(1);
        expect(first.close).not.toHaveBeenCalled();
        expect(second.close).not.toHaveBeenCalled();
    });

    it("closes each remaining registered modal once and restores once", () => {
        let restoreCount = 0;
        const registry = new ShareCardLightPrintModalRegistry(() => {
            restoreCount += 1;
        });
        interface ClosingModal { close(): void }
        const first: ClosingModal = { close: jest.fn(() => registry.handleClosed(first)) };
        const second: ClosingModal = { close: jest.fn(() => registry.handleClosed(second)) };
        registry.add(first, jest.fn());
        registry.add(second, jest.fn());

        registry.closeAll();
        registry.closeAll();
        expect(first.close).toHaveBeenCalledTimes(1);
        expect(second.close).toHaveBeenCalledTimes(1);
        expect(restoreCount).toBe(1);
    });

    it("restores chrome once for each new occupied close cycle", () => {
        let restoreCount = 0;
        const registry = new ShareCardLightPrintModalRegistry(() => {
            restoreCount += 1;
        });
        const first = { close: jest.fn() };
        const second = { close: jest.fn() };

        registry.add(first, jest.fn());
        registry.handleClosed(first);
        expect(registry.openCount).toBe(0);
        expect(restoreCount).toBe(1);

        registry.add(second, jest.fn());
        registry.handleClosed(second);
        expect(registry.openCount).toBe(0);
        expect(restoreCount).toBe(2);

        registry.closeAll();
        expect(registry.openCount).toBe(0);
        expect(first.close).not.toHaveBeenCalled();
        expect(second.close).not.toHaveBeenCalled();
        expect(restoreCount).toBe(2);
    });

    it("observes external fetch and XHR calls live while restoring the original hooks", async () => {
        const globals = globalThis as unknown as {
            window?: { fetch: typeof fetch };
            XMLHttpRequest?: typeof XMLHttpRequest;
        };
        const fetchStub = jest.fn(() => Promise.resolve({} as Response));
        const openStub = jest.fn();
        const XMLHttpRequestStub = class {};
        (XMLHttpRequestStub.prototype as unknown as {
            open: (...args: unknown[]) => void;
        }).open = openStub;
        const previousWindow = globals.window;
        const previousXMLHttpRequest = globals.XMLHttpRequest;
        globals.window = { fetch: fetchStub as unknown as typeof fetch };
        globals.XMLHttpRequest = XMLHttpRequestStub as unknown as typeof XMLHttpRequest;

        try {
            const audit = installExternalCallAudit();
            expect(audit.observations).toEqual([]);
            expect(window.fetch).not.toBe(fetchStub);
            expect(XMLHttpRequest.prototype.open).not.toBe(openStub);

            await window.fetch("https://collector.test/fetch");
            const request = new XMLHttpRequest();
            request.open("GET", new URL("https://collector.test/xhr"));
            await window.fetch("data:text/plain,local");
            request.open("GET", "blob:collector.test/local");

            expect([...audit.observations].sort()).toEqual([
                "https://collector.test/fetch",
                "https://collector.test/xhr",
            ]);

            audit.restore();
            expect(window.fetch).toBe(fetchStub);
            expect(XMLHttpRequest.prototype.open).toBe(openStub);

            await window.fetch("https://collector.test/after-restore");
            expect(audit.observations).toHaveLength(2);
        } finally {
            if (previousWindow === undefined) delete globals.window;
            else globals.window = previousWindow;
            if (previousXMLHttpRequest === undefined) delete globals.XMLHttpRequest;
            else globals.XMLHttpRequest = previousXMLHttpRequest;
        }
    });
});
