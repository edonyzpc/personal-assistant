import { MarkdownRenderer, type App } from "obsidian";
import {
    applyShareCardPrintStyle,
    SHARE_CARD_BODY_LIGHT_PRINT_PARAMETERS,
    SHARE_CARD_HEADING_LIGHT_PRINT_PARAMETERS,
} from "../src/share-card/share-card-print-style";
import { assertShareCardElementIsSelfContained } from "../src/share-card/share-card-export";
import { ShareCardRenderer } from "../src/share-card/share-card-renderer";
import {
    ShareCardTestDocument,
    ShareCardTestElement,
    asDocument,
    asElement,
} from "./helpers/share-card-dom";

type PrintNode = PrintTestElement | PrintTestText;

class PrintTestClassList {
    private readonly values = new Set<string>();

    add(...classes: string[]): void {
        for (const value of classes) {
            this.values.add(value);
            this.syncAttribute();
        }
    }

    remove(...classes: string[]): void {
        for (const value of classes) {
            this.values.delete(value);
            this.syncAttribute();
        }
    }

    contains(value: string): boolean {
        return this.values.has(value);
    }

    private syncAttribute(): void {
        const owner = this.owner;
        const className = [...this.values].join(" ");
        if (className) owner.setAttribute("class", className);
        else owner.removeAttribute("class");
    }

    constructor(private readonly owner: PrintTestElement) {}
}

class PrintTestElement extends ShareCardTestElement {
    readonly nodeType = 1;
    private readonly printClasses: PrintTestClassList;

    constructor(tagName: string, ownerDocument: PrintTestDocument) {
        super(tagName, ownerDocument);
        this.printClasses = new PrintTestClassList(this);
        const style = this.style as typeof this.style & {
            getPropertyValue: (key: string) => string;
        };
        style.getPropertyValue = (key) => this.style.values.get(key) ?? "";
        (this as unknown as { classList: PrintTestClassList }).classList = this.printClasses;
    }

    override appendChild(child: PrintNode | ShareCardTestElement): ShareCardTestElement {
        const node = child as PrintNode;
        const previousParent = node.parentElement as unknown as PrintTestElement | null;
        if (previousParent) {
            const siblings = previousParent.children as unknown as PrintNode[];
            const siblingIndex = siblings.indexOf(node);
            if (siblingIndex >= 0) siblings.splice(siblingIndex, 1);
        }
        node.parentElement = this;
        this.children.push(child as unknown as PrintTestElement);
        this.setNodeConnected(node, this.isConnected);
        return child as ShareCardTestElement;
    }

    override removeChild(child: PrintNode | ShareCardTestElement): ShareCardTestElement {
        const index = this.children.indexOf(child as unknown as PrintTestElement);
        if (index >= 0) this.children.splice(index, 1);
        const node = child as PrintNode;
        node.parentElement = null;
        this.setNodeConnected(node, false);
        return child as ShareCardTestElement;
    }

    insertBefore(child: PrintTestElement, reference: PrintNode | null): PrintTestElement {
        child.parentElement?.removeChild(child);
            child.parentElement = this as unknown as PrintTestElement;
        if (!reference) {
            this.children.push(child);
        } else {
            const index = this.children.indexOf(reference as unknown as PrintTestElement);
            this.children.splice(index < 0 ? this.children.length : index, 0, child);
        }
        this.setNodeConnected(child, this.isConnected);
        return child;
    }

    cloneNode(deep = true): PrintTestElement {
        const ownerDocument = this.ownerDocument as PrintTestDocument;
        const clone = ownerDocument.createElement(this.tagName);
        for (const attributeName of this.getAttributeNames()) {
            clone.setAttribute(attributeName, this.getAttribute(attributeName) ?? "");
        }
        clone.disabled = this.disabled;
        clone.hidden = this.hidden;
        clone.id = this.id;
        clone.textContent = this.textContent;
        if (!deep) return clone;
        for (const child of this.children as unknown as readonly PrintNode[]) {
            clone.appendChild(child.cloneNode(true));
        }
        return clone;
    }

    override querySelectorAll(selector: string): ShareCardTestElement[] {
        return super.querySelectorAll(selector)
            .filter((element) => (element as unknown as { nodeType?: number }).nodeType === 1);
    }

    private setNodeConnected(node: PrintNode, value: boolean): void {
        if (node.nodeType === 1) {
            const element = node as PrintTestElement;
            element.isConnected = value;
            for (const child of element.children as unknown as readonly PrintNode[]) {
                this.setNodeConnected(child, value);
            }
        } else {
            node.setConnected();
        }
    }
}

class PrintTestText {
    readonly nodeType = 3;
    readonly childNodes: readonly PrintNode[] = [];
    readonly children: readonly PrintTestElement[] = [];
    readonly classList = { contains: () => false };
    tagName = "";
    parentElement: PrintTestElement | null = null;

    constructor(
        readonly ownerDocument: PrintTestDocument,
        readonly textContent: string,
    ) {}

    setConnected(): void {
        // Connectivity is not needed for deterministic Text-run selection.
    }

    getAttribute(): null {
        return null;
    }

    getAttributeNames(): string[] {
        return [];
    }

    cloneNode(): PrintTestText {
        return this.ownerDocument.createTextNode(this.textContent);
    }
}

class PrintTestDocument extends ShareCardTestDocument {
    override createElement(tagName: string): PrintTestElement {
        return new PrintTestElement(tagName, this);
    }

    createElementNS(_namespace: string, tagName: string): PrintTestElement {
        return this.createElement(tagName);
    }

    createTextNode(text: string): PrintTestText {
        return new PrintTestText(this, text);
    }
}

function appendElement(parent: PrintTestElement, tagName: string): PrintTestElement {
    const element = (parent.ownerDocument as PrintTestDocument).createElement(tagName);
    parent.appendChild(element);
    return element;
}

function appendText(parent: PrintTestElement, text: string): PrintTestText {
    const node = (parent.ownerDocument as PrintTestDocument).createTextNode(text);
    parent.appendChild(node);
    return node;
}

function createPrintFixture(): {
    body: PrintTestElement;
    card: PrintTestElement;
} {
    const document = new PrintTestDocument();
    const card = document.createElement("div");
    const body = document.createElement("div");
    body.classList.add("pa-share-card-body");

    const heading = appendElement(body, "h1");
    appendText(heading, "Title ");
    appendElement(heading, "img");
    const emphasis = appendElement(heading, "em");
    appendText(emphasis, "ordinary ");
    const strong = appendElement(emphasis, "strong");
    appendText(strong, "heading");
    appendElement(strong, "code");

    const secondHeading = appendElement(body, "h2");
    appendText(secondHeading, "Second heading ");
    appendElement(secondHeading, "kbd");
    appendElement(body, "h4");
    appendText(body.children[body.children.length - 1] as PrintTestElement, "Subheading");

    const paragraph = appendElement(body, "p");
    appendText(paragraph, "plain ");
    appendText(paragraph, "run ");
    const link = appendElement(paragraph, "a");
    appendText(link, "link");

    const list = appendElement(body, "ul");
    const item = appendElement(list, "li");
    appendText(item, "list text");
    const quote = appendElement(body, "blockquote");
    const quoteParagraph = appendElement(quote, "p");
    appendText(quoteParagraph, "quote text");
    const table = appendElement(body, "table");
    const row = appendElement(table, "tr");
    appendText(appendElement(row, "th"), "head");
    appendText(appendElement(row, "td"), "cell");

    for (const tagName of ["pre", "picture", "svg", "canvas"]) {
        const protectedElement = appendElement(body, tagName);
        appendText(protectedElement, "protected");
    }
    const visualBlock = appendElement(body, "div");
    visualBlock.classList.add("pa-share-card-visual-block");
    appendText(visualBlock, "visual label");
    const placeholder = appendElement(body, "span");
    placeholder.classList.add("pa-share-card-resource-placeholder");
    appendText(placeholder, "placeholder");

    const footer = document.createElement("div");
    footer.classList.add("pa-share-card-footer");
    appendText(footer, "brand source page");
    card.appendChild(body);
    card.appendChild(footer);
    return { body, card };
}

function collectText(element: PrintTestElement): string {
    return (element.children as unknown as readonly PrintNode[])
        .map((node) => node.nodeType === 3
            ? node.textContent
            : collectText(node as PrintTestElement))
        .join("");
}

function attributes(element: ShareCardTestElement): Record<string, string> {
    return Object.fromEntries(element.getAttributeNames().map((name) => [
        name,
        element.getAttribute(name) ?? "",
    ]));
}

function childTags(element: ShareCardTestElement): string[] {
    return element.children.map((child) => child.tagName);
}

function filterElement(definition: ShareCardTestElement): ShareCardTestElement {
    return definition.children[0]!.children[0]!;
}

describe("Share Card print styles", () => {
    it("selects nested heading and body runs while protecting visual content", () => {
        const { body, card } = createPrintFixture();
        const beforeText = collectText(body);

        const report = applyShareCardPrintStyle(
            asElement(card),
            asElement(body),
            "light-print",
        );

        const wrappers = body.querySelectorAll(".pa-share-card-print-text");
        expect(report.headingRunCount).toBe(4);
        expect(report.bodyRunCount).toBe(7);
        expect(wrappers).toHaveLength(report.headingRunCount + report.bodyRunCount);
        expect(collectText(body)).toBe(beforeText);
        expect(wrappers.filter((wrapper) => (
            wrapper.getAttribute("data-pa-share-card-print-text") === "heading"
        ))).toHaveLength(4);
        expect(wrappers.some((wrapper) => (
            wrapper.parentElement?.tagName === "a"
            || wrapper.parentElement?.tagName === "li"
            || wrapper.parentElement?.tagName === "td"
        ))).toBe(true);

        const protectedTags = new Set(["code", "img", "kbd", "pre", "picture", "svg", "canvas"]);
        expect(body.querySelectorAll("*").some((element) => (
            protectedTags.has(element.tagName)
            && element.parentElement?.classList.contains("pa-share-card-print-text")
        ))).toBe(false);
        expect(body.querySelectorAll(".pa-share-card-visual-block")
            .every((element) => element.querySelectorAll(".pa-share-card-print-text").length === 0))
            .toBe(true);
        expect(card.querySelectorAll(".pa-share-card-footer")[0]
            .querySelectorAll(".pa-share-card-print-text")).toHaveLength(0);
    });

    it("keeps original cards unwrapped and definition-free", () => {
        const { body, card } = createPrintFixture();
        const elementCount = body.querySelectorAll("*").length;

        const report = applyShareCardPrintStyle(
            asElement(card),
            asElement(body),
            "original",
        );

        expect(report).toEqual({ headingRunCount: 0, bodyRunCount: 0, filterIds: [] });
        expect(body.querySelectorAll("*")).toHaveLength(elementCount);
        expect(body.querySelectorAll(".pa-share-card-print-text")).toHaveLength(0);
        expect(card.querySelectorAll(".pa-share-card-print-defs")).toHaveLength(0);
    });

    it("uses the exact light heading chain and a reduced shared body chain", () => {
        const { body, card } = createPrintFixture();
        const report = applyShareCardPrintStyle(
            asElement(card),
            asElement(body),
            "light-print",
        );
        const definitions = card.querySelectorAll(".pa-share-card-print-defs");
        expect(definitions).toHaveLength(2);
        const headingFilter = filterElement(definitions[0]!);
        const bodyFilter = filterElement(definitions[1]!);
        expect(childTags(headingFilter)).toEqual([
            "feTurbulence",
            "feDisplacementMap",
            "feTurbulence",
            "feDisplacementMap",
        ]);
        expect(attributes(headingFilter)).toEqual(expect.objectContaining({
            "color-interpolation-filters": "sRGB",
            filterUnits: "objectBoundingBox",
            ...SHARE_CARD_HEADING_LIGHT_PRINT_PARAMETERS.filterBounds,
        }));
        expect(headingFilter.children.map((child) => attributes(child))).toEqual([
            expect.objectContaining({
                baseFrequency: "0.01 0.02",
                numOctaves: "2",
                result: "lowNoise",
                seed: "0",
                type: "turbulence",
            }),
            expect.objectContaining({
                in: "SourceGraphic",
                in2: "lowNoise",
                result: "lowDisplaced",
                scale: "1.8",
                xChannelSelector: "R",
                yChannelSelector: "G",
            }),
            expect.objectContaining({
                baseFrequency: "1",
                numOctaves: "2",
                result: "highNoise",
                seed: "0",
            }),
            expect.objectContaining({
                in: "lowDisplaced",
                in2: "highNoise",
                scale: "0.5",
            }),
        ]);
        expect(attributes(bodyFilter)).toEqual(expect.objectContaining({
            ...SHARE_CARD_BODY_LIGHT_PRINT_PARAMETERS.filterBounds,
        }));
        expect(bodyFilter.children[1]!.getAttribute("scale")).toBe(
            String(SHARE_CARD_BODY_LIGHT_PRINT_PARAMETERS.lowScale),
        );
        expect(bodyFilter.children[3]!.getAttribute("scale")).toBe(
            String(SHARE_CARD_BODY_LIGHT_PRINT_PARAMETERS.highScale),
        );

        const filterIds = new Set(report.filterIds);
        const references = body.querySelectorAll(".pa-share-card-print-text")
            .map((wrapper) => wrapper.style.values.get("filter"));
        expect(references).toHaveLength(report.headingRunCount + report.bodyRunCount);
        expect(references.every((reference) => {
            const match = /^url\(#([^)]+)\)$/u.exec(reference ?? "");
            return match && filterIds.has(match[1]!);
        })).toBe(true);
    });

    it("uses the exact Xerox heading chain and shared body-light parameters", () => {
        const { body, card } = createPrintFixture();
        const report = applyShareCardPrintStyle(asElement(card), asElement(body), "xerox");
        const definitions = card.querySelectorAll(".pa-share-card-print-defs");
        expect(definitions).toHaveLength(2);
        const headingFilter = filterElement(definitions[0]!);
        const bodyFilter = filterElement(definitions[1]!);

        expect(attributes(headingFilter)).toEqual(expect.objectContaining({
            x: "-10%",
            y: "-25%",
            width: "120%",
            height: "500%",
        }));
        expect(childTags(headingFilter)).toEqual([
            "feTurbulence",
            "feDisplacementMap",
            "feComposite",
            "feTurbulence",
            "feDisplacementMap",
            "feComposite",
            "feOffset",
        ]);
        expect(headingFilter.children.map((child) => attributes(child))).toEqual([
            expect.objectContaining({
                baseFrequency: "0.01 0.02",
                numOctaves: "2",
                seed: "0",
                type: "turbulence",
            }),
            expect.objectContaining({
                in: "SourceGraphic",
                in2: "lowNoise",
                result: "warped",
                scale: "4",
            }),
            expect.objectContaining({
                in: "SourceGraphic",
                in2: "warped",
                operator: "atop",
                result: "mergedBase",
            }),
            expect.objectContaining({
                baseFrequency: "1",
                numOctaves: "2",
                seed: "0",
            }),
            expect.objectContaining({
                in: "mergedBase",
                in2: "highNoise",
                result: "grained",
                scale: "1",
            }),
            expect.objectContaining({
                in: "mergedBase",
                in2: "grained",
                operator: "atop",
                result: "offsetBase",
            }),
            expect.objectContaining({ in: "offsetBase", dx: "-3", dy: "-3" }),
        ]);
        expect(bodyFilter.children[1]!.getAttribute("scale")).toBe("0.6");
        expect(bodyFilter.children[3]!.getAttribute("scale")).toBe("0.2");
        expect(report.filterIds).toHaveLength(2);
    });

    it("allocates unique card-local filters for concurrent cards", () => {
        const first = createPrintFixture();
        const second = createPrintFixture();
        const repeatLight = createPrintFixture();
        const firstReport = applyShareCardPrintStyle(
            asElement(first.card),
            asElement(first.body),
            "light-print",
        );
        const secondReport = applyShareCardPrintStyle(
            asElement(second.card),
            asElement(second.body),
            "xerox",
        );
        const repeatReport = applyShareCardPrintStyle(
            asElement(repeatLight.card),
            asElement(repeatLight.body),
            "light-print",
        );

        const ids = [
            ...firstReport.filterIds,
            ...secondReport.filterIds,
            ...repeatReport.filterIds,
        ];
        expect(new Set(ids).size).toBe(ids.length);
        const filterSignature = (fixture: typeof first) => fixture.card
            .querySelectorAll(".pa-share-card-print-defs")
            .map((definition) => filterElement(definition).children.map((child) => ({
                tag: child.tagName,
                attributes: attributes(child),
            })));
        expect(filterSignature(repeatLight)).toEqual(filterSignature(first));
        for (const fixture of [first, second]) {
            const localIds = new Set(
                fixture.card.querySelectorAll(".pa-share-card-print-defs")
                    .map((definition) => filterElement(definition).getAttribute("id")),
            );
            const references = fixture.body.querySelectorAll(".pa-share-card-print-text")
                .map((wrapper) => wrapper.style.values.get("filter"));
            expect(references.every((reference) => {
                const match = /^url\(#([^)]+)\)$/u.exec(reference ?? "");
                return match && localIds.has(match[1]!);
            })).toBe(true);
        }
    });

    it("renders final clones without rerunning Markdown and cleans definitions with the card", async () => {
        const renderMock = MarkdownRenderer.render as jest.MockedFunction<
            typeof MarkdownRenderer.render
        >;
        renderMock.mockReset();
        renderMock.mockImplementation(async (_app, _markdown, element) => {
            const target = element as unknown as PrintTestElement;
            const ownerDocument = target.ownerDocument as PrintTestDocument;
            const heading = ownerDocument.createElement("h1");
            appendText(heading, "Title");
            target.appendChild(heading);
            const paragraph = ownerDocument.createElement("p");
            appendText(paragraph, "Body");
            target.appendChild(paragraph);
        });
        const document = new PrintTestDocument();
        document.documentElement.classList.add("theme-dark");
        const renderer = new ShareCardRenderer({} as App, asDocument(document), {
            waitForFrame: async () => undefined,
        });
        const page = { content: "# Title\n\nBody", pageIndex: 0, totalPages: 1 };

        const original = await renderer.renderPage(page, { theme: "light" });
        const light = await renderer.renderPage(page, { theme: "light", printStyle: "light-print" });
        const fitsAt14px = await renderer.fits(page.content, 0, {
            theme: "light",
            fontSize: 14,
            printStyle: "light-print",
        });
        expect(renderMock).toHaveBeenCalledTimes(1);
        expect(fitsAt14px).toBe(true);
        expect(original.bodyEl.querySelectorAll(".pa-share-card-print-text")).toHaveLength(0);
        expect(original.cardEl.querySelectorAll(".pa-share-card-print-defs")).toHaveLength(0);
        expect(light.bodyEl.querySelectorAll(".pa-share-card-print-text").length).toBeGreaterThan(0);
        expect(light.cardEl.querySelectorAll(".pa-share-card-print-defs")).toHaveLength(2);
        expect(() => assertShareCardElementIsSelfContained(light.cardEl)).not.toThrow();
        expect(document.documentElement.classList.contains("theme-dark")).toBe(true);

        original.cleanup();
        light.cleanup();
        expect(original.cardEl.isConnected).toBe(false);
        expect(light.cardEl.isConnected).toBe(false);
        expect(document.body.querySelectorAll(".pa-share-card-capture-host")).toHaveLength(0);
        renderer.cleanup();
    });
});
