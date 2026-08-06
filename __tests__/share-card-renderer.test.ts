import { Component, MarkdownRenderer, type App } from "obsidian";
import {
    appendShareCardStaticDomRange,
    auditVisualResourceUris,
    createShareCardVirtualDomBoundaries,
    locateShareCardSentinelTextRange,
    removeShareCardEmptySpans,
    resolveShareCardListItemStartDomBoundary,
    sanitizeShareCardContent,
    ShareCardRenderer,
    ShareCardRenderCancelledError,
    ShareCardRenderReadinessError,
    type ShareCardStaticDomBoundary,
} from "../src/share-card/share-card-renderer";
import { paginateShareCardMarkdown } from "../src/share-card/share-card-paginator";
import {
    ShareCardTestDocument,
    type ShareCardTestElement,
    asDocument,
    asElement,
} from "./helpers/share-card-dom";

function withoutShareCardBoundaryMarkers(markdown: string): string {
    return markdown
        .replace(
            /<span data-pa-share-boundary="pa-share-static-boundary-\d+(?:-\d+)+"><\/span>/gu,
            "",
        )
        .replace(/\uE000pa-share-static-boundary-\d+(?:-\d+)+\uE001\n?/gu, "");
}

type SemanticNodeList = SemanticNode[] & { item(index: number): SemanticNode | null };

function createSemanticNodeList(): SemanticNodeList {
    const nodes = [] as unknown as SemanticNodeList;
    nodes.item = (index) => nodes[index] ?? null;
    return nodes;
}

class SemanticNode {
    readonly childNodes = createSemanticNodeList();
    parentNode: SemanticNode | null = null;

    constructor(
        readonly tagName: string,
        readonly nodeType = 1,
        private ownText = "",
    ) {}

    get textContent(): string {
        return this.ownText + this.childNodes.map((child) => child.textContent).join("");
    }

    get parentElement(): SemanticNode | null {
        return this.parentNode?.nodeType === 1 ? this.parentNode : null;
    }

    appendChild(child: SemanticNode): SemanticNode {
        if (child.nodeType === 11) {
            for (const nested of [...child.childNodes]) this.appendChild(nested);
            return child;
        }
        child.parentNode?.removeChild(child);
        child.parentNode = this;
        this.childNodes.push(child);
        return child;
    }

    removeChild(child: SemanticNode): void {
        const index = this.childNodes.indexOf(child);
        if (index >= 0) this.childNodes.splice(index, 1);
        child.parentNode = null;
    }

    cloneNode(deep: boolean): SemanticNode {
        const clone = new SemanticNode(this.tagName, this.nodeType, this.ownText);
        if (deep) {
            for (const child of this.childNodes) clone.appendChild(child.cloneNode(true));
        }
        return clone;
    }

    querySelector(tagName: string): SemanticNode | null {
        for (const child of this.childNodes) {
            if (child.tagName === tagName) return child;
            const nested = child.querySelector(tagName);
            if (nested) return nested;
        }
        return null;
    }
}

class SemanticRange {
    private startNode: SemanticNode | null = null;
    private startOffset = 0;
    private endNode: SemanticNode | null = null;
    private endOffset = 0;

    get commonAncestorContainer(): SemanticNode {
        if (!this.startNode || !this.endNode) throw new Error("Test range is incomplete.");
        const endAncestors = new Set<SemanticNode>();
        let end: SemanticNode | null = this.endNode;
        while (end) {
            endAncestors.add(end);
            end = end.parentNode;
        }
        let start: SemanticNode | null = this.startNode;
        while (start && !endAncestors.has(start)) start = start.parentNode;
        if (!start) throw new Error("Test range has no common container.");
        return start;
    }

    setStart(node: SemanticNode, offset: number): void {
        this.startNode = node;
        this.startOffset = offset;
    }

    setEnd(node: SemanticNode, offset: number): void {
        this.endNode = node;
        this.endOffset = offset;
    }

    cloneContents(): SemanticNode {
        const common = this.commonAncestorContainer;
        const fragment = new SemanticNode("#fragment", 11);
        if (!this.startNode || !this.endNode) return fragment;
        const start = semanticLeafOffset(common, this.startNode, this.startOffset);
        const end = semanticLeafOffset(common, this.endNode, this.endOffset);
        const cursor = { value: 0 };
        for (const child of common.childNodes) {
            const clone = cloneSemanticLeafRange(child, start, end, cursor);
            if (clone) fragment.appendChild(clone);
        }
        return fragment;
    }

    detach(): void {}
}

function semanticContains(root: SemanticNode, target: SemanticNode): boolean {
    if (root === target) return true;
    return root.childNodes.some((child) => semanticContains(child, target));
}

function semanticLeafCount(node: SemanticNode): number {
    if (node.childNodes.length === 0) return 1;
    return node.childNodes.reduce((total, child) => total + semanticLeafCount(child), 0);
}

function semanticLeafOffset(
    root: SemanticNode,
    pointNode: SemanticNode,
    pointOffset: number,
): number {
    if (root === pointNode) {
        return root.childNodes.slice(0, pointOffset)
            .reduce((total, child) => total + semanticLeafCount(child), 0);
    }
    let offset = 0;
    for (const child of root.childNodes) {
        if (semanticContains(child, pointNode)) {
            return offset + semanticLeafOffset(child, pointNode, pointOffset);
        }
        offset += semanticLeafCount(child);
    }
    throw new Error("Test range point is outside its common container.");
}

function cloneSemanticLeafRange(
    node: SemanticNode,
    start: number,
    end: number,
    cursor: { value: number },
): SemanticNode | null {
    if (node.childNodes.length === 0) {
        const selected = cursor.value >= start && cursor.value < end;
        cursor.value += 1;
        return selected ? node.cloneNode(true) : null;
    }
    const clone = node.cloneNode(false);
    for (const child of node.childNodes) {
        const childClone = cloneSemanticLeafRange(child, start, end, cursor);
        if (childClone) clone.appendChild(childClone);
    }
    return clone.childNodes.length > 0 ? clone : null;
}

describe("ShareCardRenderer", () => {
    const renderMock = MarkdownRenderer.render as jest.MockedFunction<typeof MarkdownRenderer.render>;

    beforeEach(() => {
        renderMock.mockReset();
        renderMock.mockImplementation(async (_app, markdown, element) => {
            element.textContent = markdown;
        });
    });

    it("locates one literal boundary marker split across syntax-highlighter spans", () => {
        const marker = "\uE000pa-share-static-boundary-0-7\uE001\n";
        const range = locateShareCardSentinelTextRange([
            "const before = 1;\n\uE000pa-",
            "share-static-",
            "boundary-0-7",
            "\uE001\nconst after = 2;",
        ], marker);

        expect(range).toEqual({
            startNodeIndex: 0,
            startOffset: "const before = 1;\n".length,
            endNodeIndex: 3,
            endOffset: "\uE001\n".length,
        });
        expect(locateShareCardSentinelTextRange([marker, marker], marker)).toBeNull();
    });

    it("preserves pending empty boundary markers while pruning other empty spans", () => {
        const document = new ShareCardTestDocument();
        const root = document.createElement("div");
        const markerWrapper = document.createElement("span");
        const pendingMarker = document.createElement("span");
        const emptySpan = document.createElement("span");
        const nonEmptySpan = document.createElement("span");
        const emptyWrapper = document.createElement("span");
        const nestedEmptySpan = document.createElement("span");

        markerWrapper.appendChild(pendingMarker);
        emptyWrapper.appendChild(nestedEmptySpan);
        nonEmptySpan.textContent = "keep";
        root.appendChild(markerWrapper);
        root.appendChild(emptySpan);
        root.appendChild(nonEmptySpan);
        root.appendChild(emptyWrapper);

        removeShareCardEmptySpans(
            asElement(root),
            new Set<Element>([pendingMarker as unknown as Element]),
        );

        expect(pendingMarker.parentElement).toBe(markerWrapper);
        expect(markerWrapper.parentElement).toBe(root);
        expect(emptySpan.parentElement).toBeNull();
        expect(nonEmptySpan.parentElement).toBe(root);
        expect(nestedEmptySpan.parentElement).toBeNull();
        expect(emptyWrapper.parentElement).toBeNull();
    });

    it("materializes Mermaid computed styles before removing its runtime style element", () => {
        const document = new ShareCardTestDocument();
        const body = document.createElement("div");
        const mermaid = document.createElement("div");
        const runtimeStyle = document.createElement("style");
        const svg = document.createElement("svg");
        const node = document.createElement("rect");
        const edge = document.createElement("path");
        const foreignObject = document.createElement("foreignObject");
        const label = document.createElement("span");

        mermaid.classList.add("mermaid");
        label.classList.add("nodeLabel");
        node.setAttribute("style", "background:url(https://example.com/node.png)");
        svg.appendChild(node);
        svg.appendChild(edge);
        foreignObject.appendChild(label);
        svg.appendChild(foreignObject);
        mermaid.appendChild(runtimeStyle);
        mermaid.appendChild(svg);
        body.appendChild(mermaid);
        document.body.appendChild(body);

        Object.assign(document.defaultView, {
            getComputedStyle: (element: Element) => {
                const styled = runtimeStyle.parentElement !== null;
                const values = new Map<string, string>();
                if (element === node as unknown as Element) {
                    values.set("fill", styled ? "rgb(236, 236, 255)" : "rgb(0, 0, 0)");
                    values.set("stroke", styled ? "rgb(147, 112, 219)" : "none");
                    values.set("display", styled ? "block" : "inline");
                }
                if (element === edge as unknown as Element) {
                    values.set("fill", styled ? "url(https://example.com/fill.svg)" : "none");
                    values.set("marker-end", styled ? "url(#arrowhead)" : "none");
                    values.set("clip-path", styled ? "url(#clip)" : "none");
                    values.set("filter", styled ? "url(https://example.com/filter.svg)" : "none");
                }
                if (element === label as unknown as Element) {
                    values.set("color", styled ? "rgb(51, 51, 51)" : "rgb(15, 15, 15)");
                    values.set("display", styled ? "inline-block" : "inline");
                    values.set("margin-top", styled ? "2px" : "0px");
                    values.set("padding-left", styled ? "4px" : "0px");
                    values.set("text-align", styled ? "center" : "start");
                }
                return {
                    getPropertyPriority: () => "",
                    getPropertyValue: (property: string) => values.get(property) ?? "",
                } as unknown as CSSStyleDeclaration;
            },
        });

        const issues = sanitizeShareCardContent(asElement(body));
        expect(issues).toHaveLength(4);
        expect(issues).toEqual(expect.arrayContaining([
            { tagName: "path", reason: "unsafe-style" },
            { tagName: "path", reason: "external-resource-remains" },
            { tagName: "rect", reason: "unsafe-style" },
        ]));
        expect(issues.filter((issue) => (
            issue.tagName === "path" && issue.reason === "external-resource-remains"
        ))).toHaveLength(2);
        expect(runtimeStyle.parentElement).toBeNull();
        expect(node.getAttribute("style")).toContain("fill: rgb(236, 236, 255)");
        expect(node.getAttribute("style")).toContain("stroke: rgb(147, 112, 219)");
        expect(node.getAttribute("style")).not.toContain("display");
        expect(edge.getAttribute("style")).toContain("marker-end: url(#arrowhead)");
        expect(edge.getAttribute("style")).not.toContain("fill");
        expect(edge.getAttribute("style")).not.toContain("clip-path");
        expect(edge.getAttribute("style")).not.toContain("https://example.com");
        expect(label.getAttribute("style")).toContain("color: rgb(51, 51, 51)");
        expect(label.getAttribute("style")).not.toContain("font-family");
        expect(label.getAttribute("style")).toContain("display: inline-block");
        expect(label.getAttribute("style")).toContain("margin-top: 2px");
        expect(label.getAttribute("style")).toContain("padding-left: 4px");
        expect(label.getAttribute("style")).toContain("text-align: center");
        expect(auditVisualResourceUris(asElement(body))).toEqual([]);
    });

    it("removes content-owned font declarations so every card uses one bundled family", () => {
        const document = new ShareCardTestDocument();
        const body = document.createElement("div");
        const paragraph = document.createElement("p");
        paragraph.setAttribute(
            "style",
            "color: rgb(10, 20, 30); font-family: Remote Serif; font: 12px Remote Serif",
        );
        const svg = document.createElement("svg");
        const label = document.createElement("text");
        label.setAttribute("font-family", "Remote Sans");
        svg.appendChild(label);
        body.appendChild(paragraph);
        body.appendChild(svg);

        expect(sanitizeShareCardContent(asElement(body))).toEqual([]);

        expect(paragraph.getAttribute("style")).toBe("color: rgb(10, 20, 30)");
        expect(label.getAttribute("font-family")).toBeNull();
    });

    it("renders the fixed card structure, measures overflow and aborts its handle", async () => {
        const document = new ShareCardTestDocument();
        const unload = jest.spyOn(Component.prototype, "unload");
        const waitForFrame = jest.fn(async () => undefined);
        const renderer = new ShareCardRenderer({} as App, asDocument(document), { waitForFrame });

        const render = await renderer.renderPage({
            content: "# 安静且可信",
            pageIndex: 1,
            totalPages: 3,
        }, {
            theme: "dark",
            sourceLabel: "PA Chat",
            sourcePath: "notes/source.md",
            fontSize: 15,
        });

        expect(render.cardEl.classList.contains("pa-share-card")).toBe(true);
        expect(render.cardEl.classList.contains("is-dark")).toBe(true);
        expect((render.cardEl as unknown as ShareCardTestElement).style.values.get(
            "--pa-share-card-font-size",
        )).toBe("15px");
        expect(render.cardEl.querySelector(".pa-share-card-source-hint")?.textContent).toBe("· PA Chat");
        expect(render.cardEl.querySelector(".pa-share-card-brand-row")).toBeTruthy();
        expect(render.cardEl.querySelector(".pa-share-card-brand-row")?.querySelector("svg"))
            .toBeTruthy();
        expect(render.cardEl.querySelector(".pa-share-card-brand-name")?.textContent)
            .toBe("Personal Assistant");
        expect(render.cardEl.querySelector(".pa-share-card-page-number")?.textContent).toBe("2 / 3");
        expect(renderMock).toHaveBeenCalledTimes(1);
        expect(renderMock.mock.calls[0]?.[1]).toBe("# 安静且可信");
        expect(renderMock.mock.calls[0]?.[3]).toBe("notes/source.md");
        expect(waitForFrame).toHaveBeenCalledTimes(2);

        const captureHost = document.body.querySelector(".pa-share-card-capture-host")!;
        expect(captureHost.getAttribute("aria-hidden")).toBe("true");
        expect(captureHost.getAttribute("inert")).toBe("");
        Object.defineProperties(render.bodyEl, {
            scrollHeight: { configurable: true, value: 501 },
            clientHeight: { configurable: true, value: 500 },
        });
        expect(render.fits()).toBe(true);
        expect(render.fits(0)).toBe(false);
        expect(render.signal.aborted).toBe(false);

        render.cleanup();
        render.cleanup();
        expect(render.signal.aborted).toBe(true);
        expect(document.body.querySelector(".pa-share-card-capture-host")).toBeNull();
        // Cached processor ownership lasts for the renderer/session, not a page clone.
        expect(unload).not.toHaveBeenCalled();
        renderer.cleanup();
        expect(unload).toHaveBeenCalledTimes(1);
        unload.mockRestore();
    });

    it("falls back to plain text only when the content contains no approved visual", async () => {
        renderMock.mockRejectedValueOnce(new Error("renderer failed"));
        const document = new ShareCardTestDocument();
        const unload = jest.spyOn(Component.prototype, "unload");
        const renderer = new ShareCardRenderer({} as App, asDocument(document), {
            waitForFrame: async () => undefined,
        });

        const render = await renderer.renderPage({
            content: "raw **markdown** and `![literal](https://example.com/code.png)`",
            pageIndex: 0,
            totalPages: 1,
        }, { theme: "light" });

        expect(render.usedPlainTextFallback).toBe(true);
        expect(render.bodyEl.querySelector(".pa-share-card-body-fallback")?.textContent)
            .toBe("raw **markdown** and `![literal](https://example.com/code.png)`");
        expect(unload).toHaveBeenCalledTimes(1);
        render.cleanup();
        renderer.cleanup();
        expect(unload).toHaveBeenCalledTimes(1);
        unload.mockRestore();
    });

    it.each([
        "![chart](data:image/png;base64,AA)",
        "![[assets/chart.png]]",
        "```mermaid\ngraph TD\n```",
        "<svg><path d=\"M0 0\" /></svg>",
        "<canvas></canvas>",
    ])("returns a typed retryable error instead of a visual plain-text fallback: %s", async (content) => {
        renderMock.mockRejectedValueOnce(new Error("renderer failed"));
        const document = new ShareCardTestDocument();
        const renderer = new ShareCardRenderer({} as App, asDocument(document), {
            waitForFrame: async () => undefined,
        });

        await expect(renderer.renderPage({
            content,
            pageIndex: 0,
            totalPages: 1,
        }, { theme: "light" })).rejects.toBeInstanceOf(ShareCardRenderReadinessError);
        renderer.cleanup();
    });

    it("keeps localized images, safe SVG, Canvas pixels and Mermaid static output", async () => {
        const document = new ShareCardTestDocument();
        let connectedDuringRender: boolean | undefined;
        let canvasToDataUrl!: jest.Mock<string, [string?]>;
        renderMock.mockImplementationOnce(async (_app, _markdown, element) => {
            const body = element as unknown as ShareCardTestElement;
            connectedDuringRender = body.isConnected;

            const image = document.createElement("img");
            image.setAttribute("src", "data:image/png;base64,AAAA");
            image.setAttribute("alt", "Localized chart");
            image.setAttribute("width", "2400");
            image.setAttribute("height", "3200");
            const imageParagraph = document.createElement("p");
            imageParagraph.appendChild(image);
            body.appendChild(imageParagraph);

            const canvas = document.createElement("canvas") as unknown as HTMLCanvasElement;
            canvas.setAttribute("width", "20");
            canvas.setAttribute("height", "10");
            canvasToDataUrl = jest.fn(() => "data:image/png;base64,CANVAS");
            Object.assign(canvas, { toDataURL: canvasToDataUrl });
            body.appendChild(canvas as unknown as ShareCardTestElement);

            const mermaid = document.createElement("div");
            mermaid.classList.add("mermaid");
            const svg = document.createElement("svg");
            const node = document.createElement("g");
            node.classList.add("node", "default");
            node.setAttribute("class", "node default");
            const path = document.createElement("path");
            path.setAttribute("d", "M0 0L10 10");
            node.appendChild(path);
            const foreignObject = document.createElement("foreignObject");
            const label = document.createElement("span");
            label.classList.add("nodeLabel");
            label.setAttribute("class", "nodeLabel");
            label.textContent = "Decision";
            foreignObject.appendChild(label);
            svg.appendChild(node);
            svg.appendChild(foreignObject);
            mermaid.appendChild(svg);
            body.appendChild(mermaid);
        });
        const renderer = new ShareCardRenderer({} as App, asDocument(document), {
            waitForFrame: async () => undefined,
        });

        const first = await renderer.renderPage({
            content: "visuals",
            pageIndex: 0,
            totalPages: 1,
        }, { theme: "light" });

        expect(connectedDuringRender).toBe(false);
        expect(first.bodyEl.querySelectorAll("img")).toHaveLength(2);
        expect(Array.from(first.bodyEl.querySelectorAll("img"), (image) => image.getAttribute("src")))
            .toEqual(expect.arrayContaining([
                "data:image/png;base64,AAAA",
                "data:image/png;base64,CANVAS",
            ]));
        expect(first.bodyEl.querySelector("canvas")).toBeNull();
        expect(first.bodyEl.querySelector("p")?.classList.contains("pa-share-card-visual-block"))
            .toBe(false);
        expect(first.bodyEl.querySelector("svg")).not.toBeNull();
        expect(first.bodyEl.querySelector("g")?.getAttribute("class")).toBe("node default");
        expect(first.bodyEl.querySelector("foreignObject")?.querySelector("span")?.textContent)
            .toBe("Decision");
        expect(first.bodyEl.querySelector("foreignObject")?.querySelector("span")?.getAttribute("class"))
            .toBe("nodeLabel");
        expect(canvasToDataUrl).toHaveBeenCalledWith("image/png");

        first.cleanup();
        const clone = await renderer.renderPage({
            content: "visuals",
            pageIndex: 0,
            totalPages: 1,
        }, { theme: "light" });
        expect(renderMock).toHaveBeenCalledTimes(1);
        expect(canvasToDataUrl).toHaveBeenCalledTimes(1);
        expect(clone.bodyEl.querySelector("img")?.getAttribute("src"))
            .toBe("data:image/png;base64,AAAA");
        expect(Array.from(clone.bodyEl.querySelectorAll("img"), (image) => image.getAttribute("src")))
            .toContain("data:image/png;base64,CANVAS");
        clone.cleanup();
        renderer.cleanup();
    });

    it("prepares each semantic block once and reuses static clones across root font sizes", async () => {
        const document = new ShareCardTestDocument();
        const unload = jest.spyOn(Component.prototype, "unload");
        const connectedDuringRender: boolean[] = [];
        renderMock.mockImplementation(async (_app, markdown, element) => {
            connectedDuringRender.push((element as unknown as ShareCardTestElement).isConnected);
            element.textContent = markdown;
        });
        const renderer = new ShareCardRenderer({} as App, asDocument(document), {
            waitForFrame: async () => undefined,
        });
        const blocks = ["before", "![chart](data:image/png;base64,AAAA)", "after"];
        const prepareOptions = { theme: "light" as const, fontSize: 16 };
        const finalOptions = { theme: "light" as const, fontSize: 15 };

        await renderer.prepareBlocks(blocks, prepareOptions);
        const fits = renderer.createPreparedFitPredicate(finalOptions);
        await expect(fits(blocks.join("\n\n"), 0)).resolves.toBe(true);
        const preview = await renderer.renderPage({
            content: blocks.join("\n\n"),
            pageIndex: 0,
            totalPages: 1,
        }, finalOptions);
        expect((preview.cardEl as unknown as ShareCardTestElement).style.values.get(
            "--pa-share-card-font-size",
        )).toBe("15px");
        expect(preview.fits()).toBe(true);
        preview.cleanup();
        const exportRender = await renderer.renderPage({
            content: blocks.join("\n\n"),
            pageIndex: 0,
            totalPages: 1,
        }, finalOptions);
        expect(exportRender.fits()).toBe(true);
        exportRender.cleanup();

        expect(renderMock).toHaveBeenCalledTimes(blocks.length);
        expect(connectedDuringRender).toEqual([false, false, false]);
        expect(unload).toHaveBeenCalledTimes(blocks.length);
        renderer.cleanup();
        expect(unload).toHaveBeenCalledTimes(blocks.length);
        unload.mockRestore();
    });

    it("summarizes prepared sanitization and fallback completeness without another render", async () => {
        const document = new ShareCardTestDocument();
        renderMock
            .mockImplementationOnce(async (_app, _markdown, element) => {
                const button = document.createElement("button");
                button.textContent = "Run";
                (element as unknown as ShareCardTestElement).appendChild(button);
            })
            .mockRejectedValueOnce(new Error("plain text renderer failed"));
        const renderer = new ShareCardRenderer({} as App, asDocument(document), {
            waitForFrame: async () => undefined,
        });

        expect(renderer.getPreparedCompletenessSummary()).toEqual({
            sanitizationIssueCount: 0,
            usedPlainTextFallback: false,
        });
        await renderer.prepareBlocks(["button", "plain text"], { theme: "light" });
        expect(renderer.getPreparedCompletenessSummary()).toEqual({
            sanitizationIssueCount: 1,
            usedPlainTextFallback: true,
        });
        expect(renderMock).toHaveBeenCalledTimes(2);
        renderer.cleanup();
    });

    it("records final static-composition fallback without rerunning processors", async () => {
        const document = new ShareCardTestDocument();
        const renderer = new ShareCardRenderer({} as App, asDocument(document), {
            waitForFrame: async () => undefined,
        });
        const options = { theme: "light" as const };
        await renderer.prepareBlocks(["known source"], options);
        expect(renderer.getPreparedCompletenessSummary().usedPlainTextFallback).toBe(false);

        renderer.recordPreparedFinalPages([{
            content: "unmapped safe fragment",
            pageIndex: 0,
            totalPages: 1,
        }], options);

        expect(renderer.getPreparedCompletenessSummary().usedPlainTextFallback).toBe(true);
        expect(renderMock).toHaveBeenCalledTimes(1);
        renderer.cleanup();
    });

    it("renders separate reference definitions as invisible static context exactly once", async () => {
        const document = new ShareCardTestDocument();
        const linkUse = "Read [quietly][ref]";
        const imageUse = "![chart][image]";
        const codeLiteral = "`[literal][ref]`";
        const linkDefinition = "[ref]: https://example.com/reference";
        const imageDefinition = "[image]: data:image/png;base64,AAAA";
        const blocks = [linkUse, imageUse, codeLiteral, linkDefinition, imageDefinition];
        renderMock.mockImplementation(async (_app, markdown, element) => {
            const body = element as unknown as ShareCardTestElement;
            const sourceMarkdown = withoutShareCardBoundaryMarkers(markdown);
            if (sourceMarkdown.startsWith(linkUse)) {
                expect(sourceMarkdown).toContain(linkDefinition);
                const paragraph = document.createElement("p");
                const link = document.createElement("a");
                link.setAttribute("href", "https://example.com/reference");
                link.textContent = "Read quietly";
                paragraph.appendChild(link);
                body.appendChild(paragraph);
                return;
            }
            if (sourceMarkdown.startsWith(imageUse)) {
                expect(sourceMarkdown).toContain(imageDefinition);
                const image = document.createElement("img");
                image.setAttribute("src", "data:image/png;base64,AAAA");
                image.setAttribute("alt", "chart");
                body.appendChild(image);
                return;
            }
            if (sourceMarkdown === codeLiteral) {
                const code = document.createElement("code");
                code.textContent = "[literal][ref]";
                body.appendChild(code);
            }
        });
        const renderer = new ShareCardRenderer({} as App, asDocument(document), {
            waitForFrame: async () => undefined,
        });
        const options = { theme: "light" as const };

        await renderer.prepareBlocks(blocks, options);
        const page = { content: blocks.join("\n\n"), pageIndex: 0, totalPages: 1 };
        const preview = await renderer.renderPage(page, options);
        expect(preview.bodyEl.querySelector("a")?.textContent).toBe("Read quietly");
        expect(preview.bodyEl.querySelector("a")?.getAttribute("href")).toBeNull();
        expect(preview.bodyEl.querySelector("img")?.getAttribute("src"))
            .toBe("data:image/png;base64,AAAA");
        expect(preview.bodyEl.querySelector("code")?.textContent).toBe("[literal][ref]");
        expect(Array.from(preview.bodyEl.querySelectorAll("*")).some((element) => (
            (element.textContent ?? "").includes("[ref]:")
            || (element.textContent ?? "").includes("[image]:")
        ))).toBe(false);
        preview.cleanup();

        const exportRender = await renderer.renderPage(page, options);
        exportRender.cleanup();
        expect(renderMock).toHaveBeenCalledTimes(blocks.length);
        const codeRender = renderMock.mock.calls.find(([, markdown]) => (
            withoutShareCardBoundaryMarkers(markdown) === codeLiteral
        ));
        expect(codeRender).toBeDefined();
        renderer.cleanup();
    });

    it("paginates oversized pure text from static DOM without rerunning processors", async () => {
        const document = new ShareCardTestDocument();
        const createElement = document.createElement.bind(document);
        document.createElement = ((tagName: string) => {
            const element = createElement(tagName);
            if (tagName.toLowerCase() === "div") {
                Object.defineProperties(element, {
                    clientHeight: { configurable: true, value: 80 },
                    scrollHeight: {
                        configurable: true,
                        get: () => Math.max(1, element.textContent.length),
                    },
                });
            }
            return element;
        }) as typeof document.createElement;
        const unload = jest.spyOn(Component.prototype, "unload");
        const renderer = new ShareCardRenderer({} as App, asDocument(document), {
            waitForFrame: async () => undefined,
        });
        const content = Array.from({ length: 80 }, (_, index) => `word-${index}`).join(" ");
        const options = { theme: "light" as const };
        await renderer.prepareBlocks([content], options);
        const fits = renderer.createPreparedFitPredicate(options);

        const pages = await paginateShareCardMarkdown([content], fits);
        expect(pages.length).toBeGreaterThan(1);
        for (const page of pages) {
            const render = await renderer.renderPage(page, options);
            expect(render.fits()).toBe(true);
            render.cleanup();
        }
        expect(renderMock).toHaveBeenCalledTimes(1);
        expect(unload).toHaveBeenCalledTimes(1);
        renderer.cleanup();
        expect(unload).toHaveBeenCalledTimes(1);
        unload.mockRestore();
    });

    it("does not apply the crop constraint to text surrounding an inline image", async () => {
        const document = new ShareCardTestDocument();
        const originalCreateElement = document.createElement.bind(document);
        document.createElement = ((tagName: string) => {
            const element = originalCreateElement(tagName);
            if (tagName.toLowerCase() === "div") {
                Object.defineProperties(element, {
                    clientHeight: { configurable: true, value: 100 },
                    scrollHeight: {
                        configurable: true,
                        get: () => element.querySelector(".pa-share-card-visual-block")
                            ? 50
                            : 200,
                    },
                });
            }
            return element;
        }) as typeof document.createElement;
        renderMock.mockImplementation(async (_app, _markdown, element) => {
            const paragraph = document.createElement("p");
            paragraph.textContent = "before after";
            const image = document.createElement("img");
            image.setAttribute("src", "data:image/png;base64,AAAA");
            paragraph.appendChild(image);
            (element as unknown as ShareCardTestElement).appendChild(paragraph);
        });
        const renderer = new ShareCardRenderer({} as App, asDocument(document), {
            waitForFrame: async () => undefined,
        });
        const content = `${"before ".repeat(30)}![chart](data:image/png;base64,AAAA) ${"after ".repeat(30)}`;
        const options = { theme: "light" as const };

        await renderer.prepareBlocks([content], options);
        await expect(renderer.fits(content, 0, options)).resolves.toBe(false);
        const rendered = await renderer.renderPage({
            content,
            pageIndex: 0,
            totalPages: 1,
        }, options);
        expect(rendered.bodyEl.querySelector("p")?.classList.contains(
            "pa-share-card-visual-block",
        )).toBe(false);
        rendered.cleanup();
        renderer.cleanup();
    });

    it("keeps repeated emphasis, link and code text tied to exact source ranges", async () => {
        const document = new ShareCardTestDocument();
        const renderer = new ShareCardRenderer({} as App, asDocument(document), {
            waitForFrame: async () => undefined,
        });
        const content = [
            "**repeat**",
            "middle ".repeat(12),
            "*repeat*",
            "[repeat](https://example.com/reference)",
            "`repeat`",
        ].join(" ");
        const options = { theme: "light" as const };

        await renderer.prepareBlocks([content], options);
        const pages = await paginateShareCardMarkdown(
            [content],
            (markdown) => markdown.length <= 48,
        );
        const plannedSegments = pages.flatMap((page) => page.renderPlan?.segments ?? []);
        expect(plannedSegments.length).toBe(pages.length);
        expect(plannedSegments.every((segment) => segment.blockIndex === 0)).toBe(true);
        expect(plannedSegments.map((segment) => segment.sourceStart))
            .toEqual([...plannedSegments.map((segment) => segment.sourceStart)].sort((a, b) => a - b));
        expect(JSON.stringify(pages)).not.toContain("renderPlan");

        const italicPage = pages.find((page) => (
            page.content.includes("*repeat*") && !page.content.includes("**repeat**")
        ));
        const linkPage = pages.find((page) => page.content.includes(
            "](https://example.com/reference)",
        ));
        const codePage = pages.find((page) => page.content.includes("`repeat`"));
        expect(italicPage).toBeDefined();
        expect(linkPage).toBeDefined();
        expect(codePage).toBeDefined();

        for (const page of pages) {
            const rendered = await renderer.renderPage(page, options);
            expect(rendered.bodyEl.textContent).toBe(page.content);
            rendered.cleanup();
        }
        expect(renderMock).toHaveBeenCalledTimes(1);
        renderer.cleanup();
    });

    it("clones repeated text from exact DOM boundaries without crossing semantics", () => {
        const body = new SemanticNode("body");
        const paragraph = new SemanticNode("p");
        paragraph.appendChild(new SemanticNode("strong", 1, "repeat"));
        paragraph.appendChild(new SemanticNode("em", 1, "repeat"));
        paragraph.appendChild(new SemanticNode("a", 1, "repeat"));
        paragraph.appendChild(new SemanticNode("code", 1, "repeat"));
        body.appendChild(paragraph);
        const boundaries = new Map<number, ShareCardStaticDomBoundary>([
            [1, { nodePath: [0], offset: 0 }],
            [2, { nodePath: [0], offset: 1 }],
            [3, { nodePath: [0], offset: 1 }],
            [4, { nodePath: [0], offset: 2 }],
            [5, { nodePath: [0], offset: 2 }],
            [6, { nodePath: [0], offset: 3 }],
            [7, { nodePath: [0], offset: 3 }],
            [8, { nodePath: [0], offset: 4 }],
        ]);
        const ownerDocument = {
            createRange: () => new SemanticRange(),
        } as unknown as Document;

        for (const [start, end, expected] of [
            [1, 2, "strong"],
            [3, 4, "em"],
            [5, 6, "a"],
            [7, 8, "code"],
        ] as const) {
            const destination = new SemanticNode("body");
            expect(appendShareCardStaticDomRange(
                destination as unknown as HTMLElement,
                body as unknown as HTMLElement,
                boundaries,
                start,
                end,
                10,
                ownerDocument,
            )).toBe(true);
            expect(destination.querySelector(expected)?.textContent).toBe("repeat");
            for (const other of ["strong", "em", "a", "code"]) {
                expect(destination.querySelector(other) !== null).toBe(other === expected);
            }
        }
    });

    it("maps fenced first, middle and last fragments through static DOM Range boundaries", () => {
        const body = new SemanticNode("body");
        const pre = new SemanticNode("pre");
        const code = new SemanticNode("code");
        code.appendChild(new SemanticNode("span", 1, "first\n"));
        code.appendChild(new SemanticNode("span", 1, "middle\n"));
        code.appendChild(new SemanticNode("span", 1, "last\n"));
        pre.appendChild(code);
        body.appendChild(pre);

        const bodyStart = 6;
        const firstEnd = 12;
        const middleEnd = 19;
        const bodyEnd = 24;
        const boundaries = createShareCardVirtualDomBoundaries(
            body as unknown as HTMLElement,
            [
                { edge: "start", sourceOffset: bodyStart },
                { edge: "end", sourceOffset: bodyEnd },
            ],
        );
        boundaries.set(firstEnd, { nodePath: [0, 0], offset: 1 });
        boundaries.set(middleEnd, { nodePath: [0, 0], offset: 2 });
        expect(boundaries.get(bodyStart)).toEqual({ nodePath: [], offset: 0 });
        expect(boundaries.get(bodyEnd)).toEqual({ nodePath: [], offset: 1 });

        const ownerDocument = {
            createRange: () => new SemanticRange(),
        } as unknown as Document;
        for (const [start, end, expected] of [
            [bodyStart, firstEnd, "first\n"],
            [firstEnd, middleEnd, "middle\n"],
            [middleEnd, bodyEnd, "last\n"],
        ] as const) {
            const destination = new SemanticNode("body");
            expect(appendShareCardStaticDomRange(
                destination as unknown as HTMLElement,
                body as unknown as HTMLElement,
                boundaries,
                start,
                end,
                30,
                ownerDocument,
            )).toBe(true);
            expect(destination.textContent).toBe(expected);
            expect(destination.querySelector("pre")).not.toBeNull();
            expect(destination.querySelector("code")).not.toBeNull();
        }
    });

    it("keeps ordinary inline-code preparation literal and clones its static code range", async () => {
        const document = new ShareCardTestDocument();
        const source = `before \`${"code ".repeat(18)}\` after`;
        renderMock.mockImplementationOnce(async (_app, markdown, element) => {
            const inlineCode = /`([^`]*)`/u.exec(markdown)?.[1] ?? "";
            expect(inlineCode).toContain("\uE000pa-share-static-boundary-");
            expect(inlineCode).not.toContain("<span data-pa-share-boundary=");
            element.textContent = markdown;
        });
        const renderer = new ShareCardRenderer({} as App, asDocument(document), {
            waitForFrame: async () => undefined,
        });

        await expect(renderer.prepareBlocks([source], { theme: "light" })).resolves.toBeUndefined();
        expect(renderMock).toHaveBeenCalledTimes(1);

        const body = new SemanticNode("body");
        const paragraph = new SemanticNode("p");
        const code = new SemanticNode("code");
        code.appendChild(new SemanticNode("span", 1, "first "));
        code.appendChild(new SemanticNode("span", 1, "middle "));
        code.appendChild(new SemanticNode("span", 1, "last"));
        paragraph.appendChild(code);
        body.appendChild(paragraph);
        const destination = new SemanticNode("body");
        expect(appendShareCardStaticDomRange(
            destination as unknown as HTMLElement,
            body as unknown as HTMLElement,
            new Map([
                [10, { nodePath: [0, 0], offset: 1 }],
                [20, { nodePath: [0, 0], offset: 2 }],
            ]),
            10,
            20,
            30,
            { createRange: () => new SemanticRange() } as unknown as Document,
        )).toBe(true);
        expect(destination.querySelector("code")?.textContent).toBe("middle ");
        renderer.cleanup();
    });

    it("keeps each task checkbox on its own page at a snapped list-item Range boundary", () => {
        const first = "- [ ] first task";
        const second = "- [x] second task";
        const source = `${first}\n${second}`;
        const secondStart = first.length + 1;
        const body = new SemanticNode("body");
        const list = new SemanticNode("ul");
        const firstItem = new SemanticNode("li");
        firstItem.appendChild(new SemanticNode("span", 1, "[ ] "));
        firstItem.appendChild(new SemanticNode("span", 1, "first task"));
        const secondItem = new SemanticNode("li");
        secondItem.appendChild(new SemanticNode("span", 1, "[x] "));
        secondItem.appendChild(new SemanticNode("span", 1, "second task"));
        list.appendChild(firstItem);
        list.appendChild(secondItem);
        body.appendChild(list);
        const boundaries = new Map<number, ShareCardStaticDomBoundary>([
            [secondStart, { nodePath: [0], offset: 1 }],
        ]);
        const ownerDocument = {
            createRange: () => new SemanticRange(),
        } as unknown as Document;

        const firstPage = new SemanticNode("body");
        const secondPage = new SemanticNode("body");
        expect(appendShareCardStaticDomRange(
            firstPage as unknown as HTMLElement,
            body as unknown as HTMLElement,
            boundaries,
            0,
            secondStart,
            source.length,
            ownerDocument,
        )).toBe(true);
        expect(appendShareCardStaticDomRange(
            secondPage as unknown as HTMLElement,
            body as unknown as HTMLElement,
            boundaries,
            secondStart,
            source.length,
            source.length,
            ownerDocument,
        )).toBe(true);
        expect(firstPage.textContent).toBe("[ ] first task");
        expect(firstPage.textContent).not.toContain("[x]");
        expect(secondPage.textContent).toBe("[x] second task");
        expect(secondPage.textContent).not.toContain("[ ]");
    });

    it("lifts a new list's first-item boundary so the previous page has no empty list", () => {
        const body = new SemanticNode("body");
        body.appendChild(new SemanticNode("p", 1, "intro"));
        const list = new SemanticNode("ul");
        const item = new SemanticNode("li");
        const marker = new SemanticNode("span");
        item.appendChild(marker);
        item.appendChild(new SemanticNode("span", 1, "first item"));
        list.appendChild(item);
        body.appendChild(list);
        const boundary = resolveShareCardListItemStartDomBoundary(
            body as unknown as HTMLElement,
            marker as unknown as Element,
        );
        expect(boundary).toEqual({ nodePath: [], offset: 1 });
        item.removeChild(marker);

        const boundaries = new Map<number, ShareCardStaticDomBoundary>([[6, boundary!]]);
        const ownerDocument = {
            createRange: () => new SemanticRange(),
        } as unknown as Document;
        const firstPage = new SemanticNode("body");
        const secondPage = new SemanticNode("body");
        expect(appendShareCardStaticDomRange(
            firstPage as unknown as HTMLElement,
            body as unknown as HTMLElement,
            boundaries,
            0,
            6,
            16,
            ownerDocument,
        )).toBe(true);
        expect(appendShareCardStaticDomRange(
            secondPage as unknown as HTMLElement,
            body as unknown as HTMLElement,
            boundaries,
            6,
            16,
            16,
            ownerDocument,
        )).toBe(true);
        expect(firstPage.textContent).toBe("intro");
        expect(firstPage.querySelector("ul")).toBeNull();
        expect(secondPage.textContent).toBe("first item");
        expect(secondPage.querySelector("ul")).not.toBeNull();
    });

    it("bounds the fallback prototype cache and unloads every transient owner once", async () => {
        const document = new ShareCardTestDocument();
        const unload = jest.spyOn(Component.prototype, "unload");
        const renderer = new ShareCardRenderer({} as App, asDocument(document), {
            waitForFrame: async () => undefined,
        });

        for (let index = 0; index < 40; index += 1) {
            await renderer.fits(`candidate-${index}`, 0, { theme: "light" });
        }
        await renderer.fits("candidate-0", 1, { theme: "light" });
        expect(renderMock).toHaveBeenCalledTimes(40);
        expect(unload).toHaveBeenCalledTimes(8);

        renderer.cleanup();
        expect(unload).toHaveBeenCalledTimes(40);
        unload.mockRestore();
    });

    it("connects only a source-neutral standalone Mermaid stage before processors run", async () => {
        const document = new ShareCardTestDocument();
        const connectionStates: boolean[] = [];
        const processorInputs: string[] = [];
        renderMock.mockImplementation(async (_app, markdown, element) => {
            const body = element as unknown as ShareCardTestElement;
            connectionStates.push(body.isConnected);
            processorInputs.push(markdown);
            const output = document.createElement("div");
            output.classList.add("mermaid");
            output.appendChild(document.createElement("svg"));
            body.appendChild(output);
        });
        const renderer = new ShareCardRenderer({} as App, asDocument(document), {
            waitForFrame: async () => undefined,
        });

        const sources = [
            "```mermaid\ngraph TD\nA-->B\n```",
            "```mermaid\ngraph TD\nclick A https://example.com\n```",
        ];
        await renderer.prepareBlocks(sources, { theme: "light" });

        expect(connectionStates).toEqual([true, false]);
        expect(processorInputs).toEqual(sources);
        expect(renderMock).toHaveBeenCalledTimes(sources.length);
        renderer.cleanup();
    });

    it("keeps raw active resources detached until sanitization makes them inert", async () => {
        const document = new ShareCardTestDocument();
        const connectedDuringRender: boolean[] = [];
        renderMock.mockImplementationOnce(async (_app, _markdown, element) => {
            const body = element as unknown as ShareCardTestElement;
            connectedDuringRender.push(body.isConnected);
            const iframe = document.createElement("iframe");
            iframe.setAttribute("src", "https://example.com/frame");
            const video = document.createElement("video");
            video.setAttribute("poster", "https://example.com/poster.png");
            const styled = document.createElement("div");
            styled.setAttribute("style", "background:url(https://example.com/bg.png)");
            body.appendChild(iframe);
            body.appendChild(video);
            body.appendChild(styled);
        });
        const renderer = new ShareCardRenderer({} as App, asDocument(document), {
            waitForFrame: async () => undefined,
        });

        const render = await renderer.renderPage({
            content: "<iframe src=\"https://example.com/frame\"></iframe>\n\n"
                + "<video poster=\"https://example.com/poster.png\"></video>\n\n"
                + "<div style=\"background:url(https://example.com/bg.png)\">x</div>",
            pageIndex: 0,
            totalPages: 1,
        }, { theme: "light" });

        expect(connectedDuringRender).toEqual([false]);
        expect(render.bodyEl.querySelector("iframe")).toBeNull();
        expect(render.bodyEl.querySelector("video")).toBeNull();
        expect(render.bodyEl.querySelector("div")?.getAttribute("style")).toBeNull();
        render.cleanup();
        renderer.cleanup();
    });

    it("silently removes Obsidian's code-copy button but reports a user button", async () => {
        const document = new ShareCardTestDocument();
        renderMock.mockImplementationOnce(async (_app, _markdown, element) => {
            const body = element as unknown as ShareCardTestElement;
            const builtIn = document.createElement("button");
            builtIn.classList.add("copy-code-button");
            const userButton = document.createElement("button");
            userButton.textContent = "Run";
            body.appendChild(builtIn);
            body.appendChild(userButton);
        });
        const renderer = new ShareCardRenderer({} as App, asDocument(document), {
            waitForFrame: async () => undefined,
        });

        const render = await renderer.renderPage({
            content: "button test",
            pageIndex: 0,
            totalPages: 1,
        }, { theme: "light" });

        expect(render.bodyEl.querySelector("button")).toBeNull();
        expect(render.sanitizationIssues.filter((issue) => issue.tagName === "button"))
            .toHaveLength(1);
        expect(render.bodyEl.querySelector(".pa-share-card-resource-placeholder")?.textContent)
            .toBe("[Button unavailable]");
        render.cleanup();
        renderer.cleanup();
    });

    it("makes unsafe and external resources inert before the card is connected", async () => {
        const document = new ShareCardTestDocument();
        const unsafeContainer = document.createElement("div");
        unsafeContainer.textContent = "safe text";
        unsafeContainer.setAttribute("class", "remote-bg");
        unsafeContainer.setAttribute("style", "background:url(https://example.com/bg.png)");
        unsafeContainer.setAttribute("onclick", "fetch('https://example.com/click')");
        renderMock.mockImplementationOnce(async (_app, _markdown, element) => {
            const body = element as unknown as ShareCardTestElement;
            const remoteImage = document.createElement("img");
            remoteImage.setAttribute("src", "https://example.com/private.png");
            remoteImage.setAttribute("alt", "Private");
            body.appendChild(remoteImage);
            const responsiveImage = document.createElement("img");
            responsiveImage.setAttribute(
                "srcset",
                "data:image/png;base64,SAFE 1x, https://example.com/private-2x.png 2x",
            );
            body.appendChild(responsiveImage);
            for (const checked of [true, false]) {
                const task = document.createElement("li");
                task.classList.add("task-list-item");
                const checkbox = document.createElement("input") as unknown as HTMLInputElement;
                checkbox.classList.add("task-list-item-checkbox");
                checkbox.setAttribute("type", "checkbox");
                checkbox.checked = checked;
                task.appendChild(checkbox as unknown as ShareCardTestElement);
                body.appendChild(task);
            }
            for (const tagName of [
                "iframe", "video", "audio", "object", "embed", "button", "input",
            ]) {
                body.appendChild(document.createElement(tagName));
            }
            for (const tagName of ["script", "style", "link", "base", "meta"]) {
                body.appendChild(document.createElement(tagName));
            }
            const rawSvg = document.createElement("svg");
            rawSvg.appendChild(document.createElement("foreignObject"));
            body.appendChild(rawSvg);
            body.appendChild(unsafeContainer);
            const link = document.createElement("a");
            link.textContent = "readable label";
            link.setAttribute("href", "https://example.com/private");
            link.setAttribute("target", "_blank");
            body.appendChild(link);
        });
        const waitForFrame = jest.fn(async () => {
            expect(unsafeContainer.isConnected).toBe(true);
            expect(unsafeContainer.getAttribute("style")).toBeNull();
            expect(unsafeContainer.getAttribute("onclick")).toBeNull();
        });
        const renderer = new ShareCardRenderer({} as App, asDocument(document), { waitForFrame });

        const render = await renderer.renderPage({
            content: "unsafe",
            pageIndex: 0,
            totalPages: 1,
        }, { theme: "light", host: asElement(document.body) });

        expect(render.bodyEl.querySelectorAll("img")).toHaveLength(1);
        expect(render.bodyEl.querySelector("img")?.getAttribute("src"))
            .toBe("data:image/png;base64,SAFE");
        expect(render.bodyEl.querySelector("img")?.getAttribute("srcset")).toBeNull();
        expect(render.bodyEl.querySelector("foreignObject")).toBeNull();
        expect(render.bodyEl.querySelectorAll("script,style,link,base,meta")).toHaveLength(0);
        expect(render.bodyEl.querySelectorAll("iframe,video,audio,object,embed,button,input"))
            .toHaveLength(0);
        expect(render.bodyEl.querySelectorAll(".pa-share-card-resource-placeholder").length)
            .toBeGreaterThan(0);
        expect(render.bodyEl.querySelector("a")?.textContent).toBe("readable label");
        expect(render.bodyEl.querySelector("a")?.getAttribute("href")).toBeNull();
        expect(Array.from(render.bodyEl.querySelectorAll("span"), (span) => span.textContent))
            .toEqual(expect.arrayContaining(["[x] ", "[ ] "]));
        expect(render.sanitizationIssues).toEqual(expect.arrayContaining([
            { tagName: "img", reason: "external-resource-remains" },
            { tagName: "iframe", reason: "unsafe-element" },
            { tagName: "div", reason: "unsafe-style" },
        ]));
        expect(auditVisualResourceUris(render.bodyEl)).toEqual([]);
        render.cleanup();
        renderer.cleanup();
    });

    it("waits for image decode, fonts and two stable frames only once per cache key", async () => {
        const document = new ShareCardTestDocument();
        const decode = jest.fn(async () => undefined);
        const loadFont = jest.fn(async () => ([{} as FontFace]));
        Object.assign(document, { fonts: { load: loadFont } });
        renderMock.mockImplementationOnce(async (_app, _markdown, element) => {
            const image = document.createElement("img") as unknown as HTMLImageElement;
            image.setAttribute("src", "data:image/webp;base64,AAAA");
            Object.assign(image, { decode, complete: true });
            (element as unknown as ShareCardTestElement)
                .appendChild(image as unknown as ShareCardTestElement);
        });
        const waitForFrame = jest.fn(async () => undefined);
        const renderer = new ShareCardRenderer({} as App, asDocument(document), { waitForFrame });

        await expect(renderer.fits("same", 0, { theme: "dark" })).resolves.toBe(true);
        await expect(renderer.fits("same", 1, { theme: "dark" })).resolves.toBe(true);
        const preview = await renderer.renderPage({
            content: "same",
            pageIndex: 0,
            totalPages: 2,
        }, { theme: "dark" });

        expect(renderMock).toHaveBeenCalledTimes(1);
        expect(decode).toHaveBeenCalledTimes(1);
        expect(loadFont).toHaveBeenCalledTimes(1);
        expect(loadFont).toHaveBeenCalledWith('400 16px "PA Share Serif"', "PA");
        expect(waitForFrame).toHaveBeenCalledTimes(2);
        preview.cleanup();
        renderer.cleanup();
    });

    it("cleans an offscreen render when final layout settling fails", async () => {
        const document = new ShareCardTestDocument();
        const renderer = new ShareCardRenderer({} as App, asDocument(document), {
            waitForFrame: async () => {
                throw new Error("frame failed");
            },
        });

        await expect(renderer.renderPage({
            content: "safe text",
            pageIndex: 0,
            totalPages: 1,
        }, { theme: "light" })).rejects.toThrow("frame failed");
        expect(document.body.querySelector(".pa-share-card-capture-host")).toBeNull();
        renderer.cleanup();
    });

    it("cancels a render closed while Markdown rendering is pending", async () => {
        const document = new ShareCardTestDocument();
        let finishMarkdown!: () => void;
        renderMock.mockImplementationOnce((_app, _markdown, element) => {
            element.textContent = "rendered before async completion";
            return new Promise<void>((resolve) => {
                finishMarkdown = resolve;
            });
        });
        const waitForFrame = jest.fn(async () => undefined);
        const renderer = new ShareCardRenderer({} as App, asDocument(document), { waitForFrame });

        const pending = renderer.renderPage({
            content: "safe text",
            pageIndex: 0,
            totalPages: 1,
        }, { theme: "light" });
        await Promise.resolve();
        renderer.cleanup();

        await expect(pending).rejects.toBeInstanceOf(ShareCardRenderCancelledError);
        expect(waitForFrame).not.toHaveBeenCalled();
        expect(document.body.querySelector(".pa-share-card-capture-host")).toBeNull();
        finishMarkdown();
    });

    it("cancels a render closed while final layout settling is pending", async () => {
        const document = new ShareCardTestDocument();
        let finishFrame!: () => void;
        const waitForFrame = jest.fn(() => new Promise<void>((resolve) => {
            finishFrame = resolve;
        }));
        const renderer = new ShareCardRenderer({} as App, asDocument(document), { waitForFrame });

        const pending = renderer.renderPage({
            content: "safe text",
            pageIndex: 0,
            totalPages: 1,
        }, { theme: "light" });
        for (let index = 0; index < 30 && waitForFrame.mock.calls.length === 0; index += 1) {
            await Promise.resolve();
        }
        expect(waitForFrame).toHaveBeenCalledTimes(1);
        renderer.cleanup();

        await expect(pending).rejects.toBeInstanceOf(ShareCardRenderCancelledError);
        expect(document.body.querySelector(".pa-share-card-capture-host")).toBeNull();
        finishFrame();
    });

    it("removes pending image readiness listeners when the renderer closes", async () => {
        const document = new ShareCardTestDocument();
        let image!: ShareCardTestElement;
        renderMock.mockImplementationOnce(async (_app, _markdown, element) => {
            image = document.createElement("img");
            image.setAttribute("src", "data:image/png;base64,AAAA");
            Object.assign(image, { complete: false });
            (element as unknown as ShareCardTestElement).appendChild(image);
        });
        const renderer = new ShareCardRenderer({} as App, asDocument(document), {
            waitForFrame: async () => undefined,
        });

        const pending = renderer.renderPage({
            content: "![chart](data:image/png;base64,AAAA)",
            pageIndex: 0,
            totalPages: 1,
        }, { theme: "light" });
        for (let index = 0; index < 30 && !(image?.listeners.get("load")?.length); index += 1) {
            await Promise.resolve();
        }
        expect(image.listeners.get("load")).toHaveLength(1);
        expect(image.listeners.get("error")).toHaveLength(1);
        renderer.cleanup();

        await expect(pending).rejects.toBeInstanceOf(ShareCardRenderCancelledError);
        expect(image.listeners.get("load")).toHaveLength(0);
        expect(image.listeners.get("error")).toHaveLength(0);
    });
});
