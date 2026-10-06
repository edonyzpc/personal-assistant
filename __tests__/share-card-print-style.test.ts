import { MarkdownRenderer, type App } from "obsidian";
import {
    applyShareCardPrintStyle,
    SHARE_CARD_BODY_XEROX_PARAMETERS,
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

        const report = applyShareCardPrintStyle(asElement(card), asElement(body));

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

    it("keeps the approved Xerox heading displacement and adds a quiet registration ghost", () => {
        const { body, card } = createPrintFixture();
        const report = applyShareCardPrintStyle(asElement(card), asElement(body));
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
            "feComponentTransfer",
            "feComposite",
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
            expect.objectContaining({
                in: "offsetBase", dx: "-3", dy: "-3", result: "shiftedInk",
            }),
            expect.objectContaining({
                in: "SourceGraphic", result: "registrationGhost",
            }),
            expect.objectContaining({
                in: "shiftedInk", in2: "registrationGhost", operator: "over",
            }),
        ]);
        expect(attributes(headingFilter.children[7]!.children[0]!)).toEqual({
            type: "linear", slope: "0.28",
        });
        expect(bodyFilter.children[1]!.getAttribute("scale")).toBe(
            String(SHARE_CARD_BODY_XEROX_PARAMETERS.lowScale),
        );
        expect(bodyFilter.children[3]!.getAttribute("scale")).toBe(
            String(SHARE_CARD_BODY_XEROX_PARAMETERS.highScale),
        );
        expect(report.filterIds).toHaveLength(2);
    });

    it("makes a body-only Xerox card visibly distinct while preserving its text", () => {
        const fixtures = [createPrintFixture(), createPrintFixture()];
        for (const fixture of fixtures) {
            for (const heading of fixture.body.querySelectorAll("h1, h2")) heading.remove();
        }
        const [first, second] = fixtures;
        const beforeText = collectText(second.body);
        const report = applyShareCardPrintStyle(asElement(second.card), asElement(second.body));

        expect(report.headingRunCount).toBe(0);
        expect(report.bodyRunCount).toBeGreaterThan(0);
        expect(collectText(second.body)).toBe(beforeText);
        expect(collectText(first.body)).toBe(beforeText);
        expect(first.card.querySelectorAll(".pa-share-card-print-defs")).toHaveLength(0);
        const xeroxFilter = filterElement(second.card
            .querySelectorAll(".pa-share-card-print-defs")[0]!);
        expect(childTags(xeroxFilter)).toEqual([
            "feTurbulence", "feDisplacementMap", "feTurbulence", "feDisplacementMap",
            "feOffset", "feComponentTransfer", "feComposite",
        ]);
        expect(attributes(xeroxFilter)).toEqual(expect.objectContaining({
            ...SHARE_CARD_BODY_XEROX_PARAMETERS.filterBounds,
        }));
        expect(attributes(xeroxFilter.children[1]!)).toEqual(expect.objectContaining({
            scale: String(SHARE_CARD_BODY_XEROX_PARAMETERS.lowScale),
        }));
        expect(attributes(xeroxFilter.children[3]!)).toEqual(expect.objectContaining({
            scale: String(SHARE_CARD_BODY_XEROX_PARAMETERS.highScale),
        }));
        expect(attributes(xeroxFilter.children[4]!)).toEqual(expect.objectContaining({
            dx: String(SHARE_CARD_BODY_XEROX_PARAMETERS.echoDx),
            dy: String(SHARE_CARD_BODY_XEROX_PARAMETERS.echoDy),
        }));
        expect(attributes(xeroxFilter.children[5]!.children[0]!)).toEqual({
            type: "linear", slope: String(SHARE_CARD_BODY_XEROX_PARAMETERS.echoOpacity),
        });
        expect(attributes(xeroxFilter.children[6]!)).toEqual({
            in: "grained", in2: "faintEcho", operator: "over",
        });
    });

    it("allocates unique card-local filters for concurrent cards", () => {
        const first = createPrintFixture();
        const second = createPrintFixture();
        const repeat = createPrintFixture();
        const firstReport = applyShareCardPrintStyle(asElement(first.card), asElement(first.body));
        const secondReport = applyShareCardPrintStyle(asElement(second.card), asElement(second.body));
        const repeatReport = applyShareCardPrintStyle(asElement(repeat.card), asElement(repeat.body));

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
        expect(filterSignature(repeat)).toEqual(filterSignature(first));
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

        const implicitXerox = await renderer.renderPage(page, { theme: "light" });
        const explicitXerox = await renderer.renderPage(page, {
            theme: "light",
            printStyle: "xerox",
        });
        const fitsAt14px = await renderer.fits(page.content, 0, {
            theme: "light",
            fontSize: 14,
            printStyle: "xerox",
        });
        expect(renderMock).toHaveBeenCalledTimes(1);
        expect(fitsAt14px).toBe(true);
        expect(implicitXerox.bodyEl.querySelectorAll(".pa-share-card-print-text").length)
            .toBeGreaterThan(0);
        expect(implicitXerox.cardEl.querySelectorAll(".pa-share-card-print-defs")).toHaveLength(2);
        expect(explicitXerox.bodyEl.querySelectorAll(".pa-share-card-print-text").length)
            .toBeGreaterThan(0);
        expect(explicitXerox.cardEl.querySelectorAll(".pa-share-card-print-defs")).toHaveLength(2);
        expect(() => assertShareCardElementIsSelfContained(explicitXerox.cardEl)).not.toThrow();
        expect(document.documentElement.classList.contains("theme-dark")).toBe(true);

        implicitXerox.cleanup();
        explicitXerox.cleanup();
        expect(implicitXerox.cardEl.isConnected).toBe(false);
        expect(explicitXerox.cardEl.isConnected).toBe(false);
        expect(document.body.querySelectorAll(".pa-share-card-capture-host")).toHaveLength(0);
        renderer.cleanup();
    });
});
