import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { App, Vault } from "obsidian";
import {
    ShareCardClipboardUnavailableError,
    ShareCardExporter,
    canCopyShareCardImage,
    captureShareCardElement,
    createShareCardBatchPaths,
    selectUniqueShareCardBatchPaths,
} from "../src/share-card/share-card-export";
import {
    ShareCardRenderCancelledError,
    type ShareCardRenderer,
} from "../src/share-card/share-card-renderer";
import {
    ShareCardTestDocument,
    asDocument,
    asElement,
} from "./helpers/share-card-dom";

interface CaptureTestNode {
    nodeType: number;
    nodeValue: string | null;
    localName: string;
    childNodes: CaptureTestNode[];
    ownerDocument: Document;
    styles: Record<string, string>;
    getAttribute(name: string): string | null;
}

interface CaptureOutputNode {
    nodeType: number;
    nodeValue: string | null;
    namespaceURI: string | null;
    localName: string;
    childNodes: CaptureOutputNode[];
    attributes: Map<string, string>;
    style: {
        values: Map<string, string>;
        setProperty(name: string, value: string): void;
    };
    appendChild(child: CaptureOutputNode): CaptureOutputNode;
    setAttribute(name: string, value: string): void;
}

function createCaptureElement(
    ownerDocument: Document,
    localName: string,
    options: {
        attributes?: Record<string, string>;
        children?: CaptureTestNode[];
        styles?: Record<string, string>;
    } = {},
): CaptureTestNode {
    const attributes = options.attributes ?? {};
    return {
        nodeType: 1,
        nodeValue: null,
        localName,
        childNodes: options.children ?? [],
        ownerDocument,
        styles: options.styles ?? {},
        getAttribute: (name) => Object.prototype.hasOwnProperty.call(attributes, name)
            ? attributes[name]!
            : null,
    };
}

function createCaptureText(ownerDocument: Document, value: string): CaptureTestNode {
    return {
        nodeType: 3,
        nodeValue: value,
        localName: "",
        childNodes: [],
        ownerDocument,
        styles: {},
        getAttribute: () => null,
    };
}

function createCaptureOutputElement(namespaceURI: string, localName: string): CaptureOutputNode {
    const values = new Map<string, string>();
    const node: CaptureOutputNode = {
        nodeType: 1,
        nodeValue: null,
        namespaceURI,
        localName,
        childNodes: [],
        attributes: new Map(),
        style: {
            values,
            setProperty: (name, value) => values.set(name, value),
        },
        appendChild: (child) => {
            node.childNodes.push(child);
            return child;
        },
        setAttribute: (name, value) => node.attributes.set(name, value),
    };
    return node;
}

function createCaptureOutputText(value: string): CaptureOutputNode {
    return {
        nodeType: 3,
        nodeValue: value,
        namespaceURI: null,
        localName: "",
        childNodes: [],
        attributes: new Map(),
        style: {
            values: new Map(),
            setProperty: () => undefined,
        },
        appendChild: (child) => child,
        setAttribute: () => undefined,
    };
}

describe("Share Card export", () => {
    it("captures a self-contained 1080 x 1440 PNG through SVG foreignObject and Canvas", async () => {
        const pngBlob = new Blob(["png"], { type: "image/png" });
        const drawImage = jest.fn();
        const canvas = {
            width: 0,
            height: 0,
            getContext: jest.fn(() => ({ drawImage })),
            toBlob: jest.fn((callback: BlobCallback, type?: string) => callback(
                type === "image/png" ? pngBlob : null,
            )),
        };
        const image = { onload: null, onerror: null } as unknown as HTMLImageElement;
        let imageSource = "";
        Object.defineProperty(image, "src", {
            set: (value: string) => {
                imageSource = value;
                image.onload?.(new Event("load"));
            },
        });
        const createObjectURL = jest.fn(() => {
            throw new Error("foreignObject capture must not use a blob URL");
        });
        let serializedSvg: CaptureOutputNode | null = null;
        class CaptureXMLSerializer {
            serializeToString(node: CaptureOutputNode): string {
                serializedSvg = node;
                return '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 540 720"><foreignObject /></svg>';
            }
        }
        const ownerDocument = {
            defaultView: {
                URL: { createObjectURL },
                XMLSerializer: CaptureXMLSerializer,
                getComputedStyle: (element: CaptureTestNode) => ({
                    getPropertyValue: (property: string) => element.styles[property] ?? "",
                }),
            },
            createElementNS: jest.fn((namespaceURI: string, localName: string) => (
                createCaptureOutputElement(namespaceURI, localName)
            )),
            createTextNode: jest.fn((value: string) => createCaptureOutputText(value)),
            createElement: jest.fn((tagName: string) => {
                if (tagName === "img") return image;
                if (tagName === "canvas") return canvas;
                throw new Error(`Unexpected capture element: ${tagName}`);
            }),
        } as unknown as Document;
        const text = createCaptureText(ownerDocument, "A & <B>");
        const omittedImage = createCaptureElement(ownerDocument, "img", {
            attributes: { src: "https://remote.example/pixel.png" },
        });
        const paragraph = createCaptureElement(ownerDocument, "p", {
            attributes: { href: "https://remote.example/link" },
            children: [text, omittedImage],
            styles: {
                color: "rgb(59, 48, 40)",
                "background-image": "url(https://remote.example/background.png)",
            },
        });
        const element = createCaptureElement(ownerDocument, "div", {
            children: [paragraph],
            styles: {
                display: "flex",
                width: "540px",
                height: "720px",
                "background-image": "linear-gradient(#fff, #eee)",
            },
        });

        await expect(captureShareCardElement(element as unknown as HTMLElement))
            .resolves.toBe(pngBlob);

        expect(canvas.width).toBe(1080);
        expect(canvas.height).toBe(1440);
        expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 1080, 1440);
        expect(createObjectURL).not.toHaveBeenCalled();
        expect(imageSource).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
        const encodedSvg = imageSource.slice(imageSource.indexOf(",") + 1);
        expect(decodeURIComponent(encodedSvg)).toContain("<foreignObject");
        expect(decodeURIComponent(encodedSvg)).toContain('width="1080"');
        expect(decodeURIComponent(encodedSvg)).toContain('height="1440"');
        expect(decodeURIComponent(encodedSvg)).toContain('viewBox="0 0 540 720"');
        expect(serializedSvg).not.toBeNull();
        const svg = serializedSvg as unknown as CaptureOutputNode;
        expect(svg.localName).toBe("svg");
        expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
        expect(svg.attributes.get("width")).toBe("1080");
        expect(svg.attributes.get("height")).toBe("1440");
        expect(svg.attributes.get("viewBox")).toBe("0 0 540 720");
        const foreignObject = svg.childNodes[0]!;
        expect(foreignObject.localName).toBe("foreignObject");
        const wrapper = foreignObject.childNodes[0]!;
        expect(wrapper.namespaceURI).toBe("http://www.w3.org/1999/xhtml");
        const clonedCard = wrapper.childNodes[0]!;
        expect(clonedCard.style.values.get("background-image"))
            .toBe("linear-gradient(#fff, #eee)");
        const clonedParagraph = clonedCard.childNodes[0]!;
        expect(clonedParagraph.attributes.has("href")).toBe(false);
        expect(clonedParagraph.style.values.get("background-image")).toBeUndefined();
        expect(clonedParagraph.style.values.get("color")).toBe("rgb(59, 48, 40)");
        expect(clonedParagraph.childNodes).toHaveLength(1);
        expect(clonedParagraph.childNodes[0]?.nodeValue).toBe("A & <B>");
    });

    it("keeps the capture implementation free of runtime style nodes and HTML assignment", () => {
        const source = readFileSync(
            resolve(process.cwd(), "src/share-card/share-card-export.ts"),
            "utf8",
        );
        expect(source).not.toContain("@zumer/snapdom");
        expect(source).not.toMatch(/createElement\(\s*["']style["']\s*\)/);
        expect(source).not.toMatch(/\.(?:innerHTML|outerHTML)\s*=/);
    });

    it("starts the owner-window clipboard write before async capture settles", async () => {
        const document = new ShareCardTestDocument();
        const order: string[] = [];
        const write = jest.fn(async (items: unknown[]) => {
            order.push("write");
            const item = items[0] as { items: Record<string, Blob | PromiseLike<Blob>> };
            await item.items["image/png"];
        });
        const ClipboardItemCtor = jest.fn(function ClipboardItem(
            this: { items: Record<string, Blob | PromiseLike<Blob>> },
            items: Record<string, Blob | PromiseLike<Blob>>,
        ) {
            this.items = items;
        });
        document.defaultView.navigator.clipboard = { write };
        document.defaultView.ClipboardItem = ClipboardItemCtor as unknown as typeof ClipboardItem;

        const cardEl = asElement(document.createElement("div"));
        const cleanup = jest.fn();
        const renderer = {
            renderPage: jest.fn(async () => {
                order.push("render");
                return { cardEl, cleanup };
            }),
        } as unknown as ShareCardRenderer;
        const createBinary = jest.fn();
        const app = { vault: { createBinary } } as unknown as App;
        const blob = new Blob(["page"], { type: "image/png" });
        let resolveCapture!: (value: Blob) => void;
        const capture = jest.fn(() => {
            order.push("capture");
            return new Promise<Blob>((resolvePromise) => {
                resolveCapture = resolvePromise;
            });
        });
        const exporter = new ShareCardExporter(
            app,
            asDocument(document),
            renderer,
            { theme: "light" },
            { capture },
        );

        expect(canCopyShareCardImage(asDocument(document))).toBe(true);
        const copyPromise = exporter.copyCurrentPage({ content: "one", pageIndex: 0, totalPages: 1 });

        expect(order).toEqual(["render", "write"]);
        expect(write).toHaveBeenCalledTimes(1);
        expect(ClipboardItemCtor).toHaveBeenCalledTimes(1);
        const clipboardValue = ClipboardItemCtor.mock.calls[0]![0]["image/png"];
        expect(clipboardValue).toBeInstanceOf(Promise);
        await Promise.resolve();
        expect(order).toEqual(["render", "write", "capture"]);
        resolveCapture(blob);
        await copyPromise;
        await expect(Promise.resolve(clipboardValue)).resolves.toBe(blob);
        expect(createBinary).not.toHaveBeenCalled();
        expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it("rejects copy before capture when the current owner window lacks capability", async () => {
        const document = new ShareCardTestDocument();
        const capture = jest.fn(async () => new Blob());
        const renderer = { renderPage: jest.fn() } as unknown as ShareCardRenderer;
        const exporter = new ShareCardExporter(
            {} as App,
            asDocument(document),
            renderer,
            { theme: "light" },
            { capture },
        );

        await expect(exporter.copyCurrentPage({ content: "one", pageIndex: 0, totalPages: 1 }))
            .rejects.toBeInstanceOf(ShareCardClipboardUnavailableError);
        expect(capture).not.toHaveBeenCalled();
        expect(renderer.renderPage).not.toHaveBeenCalled();
    });

    it("observes a background capture rejection when clipboard write throws synchronously", async () => {
        const document = new ShareCardTestDocument();
        const clipboardError = new Error("clipboard gesture expired");
        const write = jest.fn(() => {
            throw clipboardError;
        });
        const ClipboardItemCtor = jest.fn(function ClipboardItem(
            this: { items: Record<string, Blob | PromiseLike<Blob>> },
            items: Record<string, Blob | PromiseLike<Blob>>,
        ) {
            this.items = items;
        });
        document.defaultView.navigator.clipboard = { write };
        document.defaultView.ClipboardItem = ClipboardItemCtor as unknown as typeof ClipboardItem;

        const cleanup = jest.fn();
        const renderer = {
            renderPage: jest.fn(async () => ({
                cardEl: asElement(document.createElement("div")),
                cleanup,
            })),
        } as unknown as ShareCardRenderer;
        const captureError = new Error("capture failed after clipboard rejection");
        const exporter = new ShareCardExporter(
            {} as App,
            asDocument(document),
            renderer,
            { theme: "light" },
            { capture: async () => { throw captureError; } },
        );

        await expect(exporter.copyCurrentPage({ content: "one", pageIndex: 0, totalPages: 1 }))
            .rejects.toBe(clipboardError);
        await Promise.resolve();
        await Promise.resolve();
        expect(write).toHaveBeenCalledTimes(1);
        expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it("selects one unique name for the whole batch", async () => {
        const existing = new Set([
            "PA-Cards/PA-Card-20260804-010203-page-01.png",
        ]);
        const vault = {
            getAbstractFileByPath: jest.fn(() => null),
            adapter: { exists: jest.fn(async (path: string) => existing.has(path)) },
        } as unknown as Vault;

        const paths = await selectUniqueShareCardBatchPaths(
            vault,
            2,
            new Date("2026-08-04T01:02:03.000Z"),
        );

        expect(paths).toEqual([
            "PA-Cards/PA-Card-20260804-010203-2-page-01.png",
            "PA-Cards/PA-Card-20260804-010203-2-page-02.png",
        ]);
        expect(createShareCardBatchPaths("batch", 1)).toEqual(["PA-Cards/batch.png"]);
    });

    it("saves sequentially and returns truthful partial progress", async () => {
        const document = new ShareCardTestDocument();
        const cleanup = jest.fn();
        const renderPage = jest.fn(async () => ({
            cardEl: asElement(document.createElement("div")),
            cleanup,
        }));
        const renderer = { renderPage } as unknown as ShareCardRenderer;
        const createBinary = jest.fn(async () => undefined)
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error("disk full"));
        const vault = {
            getAbstractFileByPath: jest.fn(() => null),
            adapter: { exists: jest.fn(async () => false) },
            createFolder: jest.fn(async () => undefined),
            createBinary,
        } as unknown as Vault;
        const capture = jest.fn(async () => new Blob(["page"], { type: "image/png" }));
        const exporter = new ShareCardExporter(
            { vault } as App,
            asDocument(document),
            renderer,
            { theme: "dark" },
            { capture, now: () => new Date("2026-08-04T01:02:03.000Z") },
        );
        const pages = [0, 1, 2].map((pageIndex) => ({
            content: `page ${pageIndex + 1}`,
            pageIndex,
            totalPages: 3,
        }));

        await expect(exporter.savePages(pages)).resolves.toEqual({
            savedPaths: ["PA-Cards/PA-Card-20260804-010203-page-01.png"],
            attempted: 3,
            failedPageIndex: 1,
        });
        expect(renderPage).toHaveBeenCalledTimes(2);
        expect(capture).toHaveBeenCalledTimes(2);
        expect(createBinary).toHaveBeenCalledTimes(2);
        expect(cleanup).toHaveBeenCalledTimes(2);
    });

    it("serializes save batches per Vault across exporter instances", async () => {
        const document = new ShareCardTestDocument();
        const storedPaths = new Set<string>();
        let folderExists = false;
        const createFolder = jest.fn(async () => {
            folderExists = true;
        });
        const createBinary = jest.fn(async (path: string) => {
            if (storedPaths.has(path)) throw new Error(`already exists: ${path}`);
            storedPaths.add(path);
        });
        const vault = {
            getAbstractFileByPath: jest.fn((path: string) => (
                path === "PA-Cards" && folderExists ? { path, children: [] } : null
            )),
            adapter: {
                exists: jest.fn(async (path: string) => (
                    path === "PA-Cards" ? folderExists : storedPaths.has(path)
                )),
                stat: jest.fn(async () => folderExists ? { type: "folder" } : null),
            },
            createFolder,
            createBinary,
        } as unknown as Vault;
        const page = { content: "one", pageIndex: 0, totalPages: 1 };
        let releaseFirstCapture: ((blob: Blob) => void) | undefined;
        let announceFirstCapture: (() => void) | undefined;
        const firstCaptureStarted = new Promise<void>((resolve) => {
            announceFirstCapture = resolve;
        });
        const firstCapture = jest.fn(() => new Promise<Blob>((resolve) => {
            releaseFirstCapture = resolve;
            announceFirstCapture?.();
        }));
        const secondCapture = jest.fn(async () => new Blob(["second"], { type: "image/png" }));
        const firstRenderer = {
            renderPage: jest.fn(async () => ({
                cardEl: asElement(document.createElement("div")),
                cleanup: jest.fn(),
            })),
        } as unknown as ShareCardRenderer;
        const secondRenderer = {
            renderPage: jest.fn(async () => ({
                cardEl: asElement(document.createElement("div")),
                cleanup: jest.fn(),
            })),
        } as unknown as ShareCardRenderer;
        const now = () => new Date("2026-08-04T01:02:03.000Z");
        const firstExporter = new ShareCardExporter(
            { vault } as App,
            asDocument(document),
            firstRenderer,
            { theme: "light" },
            { capture: firstCapture, now },
        );
        const secondExporter = new ShareCardExporter(
            { vault } as App,
            asDocument(document),
            secondRenderer,
            { theme: "light" },
            { capture: secondCapture, now },
        );

        const firstSave = firstExporter.savePages([page]);
        await firstCaptureStarted;
        const secondSave = secondExporter.savePages([page]);
        await Promise.resolve();

        expect(secondRenderer.renderPage).not.toHaveBeenCalled();
        expect(secondCapture).not.toHaveBeenCalled();
        expect(createFolder).toHaveBeenCalledTimes(1);

        releaseFirstCapture?.(new Blob(["first"], { type: "image/png" }));
        await expect(Promise.all([firstSave, secondSave])).resolves.toEqual([
            {
                savedPaths: ["PA-Cards/PA-Card-20260804-010203.png"],
                attempted: 1,
            },
            {
                savedPaths: ["PA-Cards/PA-Card-20260804-010203-2.png"],
                attempted: 1,
            },
        ]);
        expect(createFolder).toHaveBeenCalledTimes(1);
        expect(secondRenderer.renderPage).toHaveBeenCalledTimes(1);
        expect(createBinary).toHaveBeenCalledTimes(2);
    });

    it("continues the per-Vault queue after an earlier transaction rejects", async () => {
        const document = new ShareCardTestDocument();
        let folderExists = false;
        const createFolder = jest.fn()
            .mockRejectedValueOnce(new Error("temporary folder failure"))
            .mockImplementationOnce(async () => {
                folderExists = true;
            });
        const createBinary = jest.fn(async () => undefined);
        const vault = {
            getAbstractFileByPath: jest.fn((path: string) => (
                path === "PA-Cards" && folderExists ? { path, children: [] } : null
            )),
            adapter: {
                exists: jest.fn(async (path: string) => path === "PA-Cards" && folderExists),
                stat: jest.fn(async () => folderExists ? { type: "folder" } : null),
            },
            createFolder,
            createBinary,
        } as unknown as Vault;
        const renderer = {
            renderPage: jest.fn(async () => ({
                cardEl: asElement(document.createElement("div")),
                cleanup: jest.fn(),
            })),
        } as unknown as ShareCardRenderer;
        const options = {
            capture: async () => new Blob(["page"], { type: "image/png" }),
            now: () => new Date("2026-08-04T01:02:03.000Z"),
        };
        const first = new ShareCardExporter(
            { vault } as App,
            asDocument(document),
            renderer,
            { theme: "light" },
            options,
        );
        const second = new ShareCardExporter(
            { vault } as App,
            asDocument(document),
            renderer,
            { theme: "light" },
            options,
        );
        const page = { content: "one", pageIndex: 0, totalPages: 1 };

        const firstSave = first.savePages([page]);
        const secondSave = second.savePages([page]);

        await expect(firstSave).rejects.toThrow("temporary folder failure");
        await expect(secondSave).resolves.toEqual({
            savedPaths: ["PA-Cards/PA-Card-20260804-010203.png"],
            attempted: 1,
        });
        expect(createFolder).toHaveBeenCalledTimes(2);
        expect(createBinary).toHaveBeenCalledTimes(1);
    });

    it("does not capture or write a page whose renderer was cancelled", async () => {
        const document = new ShareCardTestDocument();
        const capture = jest.fn(async () => new Blob(["page"], { type: "image/png" }));
        const renderer = {
            renderPage: jest.fn(async () => {
                throw new ShareCardRenderCancelledError();
            }),
        } as unknown as ShareCardRenderer;
        const createBinary = jest.fn();
        const vault = {
            getAbstractFileByPath: jest.fn((path: string) => (
                path === "PA-Cards" ? { path, children: [] } : null
            )),
            adapter: { exists: jest.fn(async () => false) },
            createBinary,
        } as unknown as Vault;
        const exporter = new ShareCardExporter(
            { vault } as App,
            asDocument(document),
            renderer,
            { theme: "light" },
            { capture },
        );

        await expect(exporter.savePages([
            { content: "one", pageIndex: 0, totalPages: 1 },
        ])).resolves.toEqual({
            savedPaths: [],
            attempted: 1,
            failedPageIndex: 0,
        });
        expect(capture).not.toHaveBeenCalled();
        expect(createBinary).not.toHaveBeenCalled();
    });

    it("selects a fresh batch when retrying after a partial save", async () => {
        const document = new ShareCardTestDocument();
        const storedPaths = new Set<string>();
        let failSecondPageOnce = true;
        const createBinary = jest.fn(async (path: string) => {
            if (path.endsWith("page-02.png") && failSecondPageOnce) {
                failSecondPageOnce = false;
                throw new Error("temporary disk failure");
            }
            if (storedPaths.has(path)) throw new Error(`already exists: ${path}`);
            storedPaths.add(path);
        });
        const vault = {
            getAbstractFileByPath: jest.fn((path: string) => (
                path === "PA-Cards" ? { path, children: [] } : null
            )),
            adapter: {
                exists: jest.fn(async (path: string) => storedPaths.has(path)),
                stat: jest.fn(async () => ({ type: "folder" })),
            },
            createFolder: jest.fn(),
            createBinary,
        } as unknown as Vault;
        const renderer = {
            renderPage: jest.fn(async () => ({
                cardEl: asElement(document.createElement("div")),
                cleanup: jest.fn(),
            })),
        } as unknown as ShareCardRenderer;
        const exporter = new ShareCardExporter(
            { vault } as App,
            asDocument(document),
            renderer,
            { theme: "light" },
            {
                capture: async () => new Blob(["page"], { type: "image/png" }),
                now: () => new Date("2026-08-04T01:02:03.000Z"),
            },
        );
        const pages = [0, 1].map((pageIndex) => ({
            content: `page ${pageIndex + 1}`,
            pageIndex,
            totalPages: 2,
        }));

        await expect(exporter.savePages(pages)).resolves.toEqual({
            savedPaths: ["PA-Cards/PA-Card-20260804-010203-page-01.png"],
            attempted: 2,
            failedPageIndex: 1,
        });
        await expect(exporter.savePages(pages)).resolves.toEqual({
            savedPaths: [
                "PA-Cards/PA-Card-20260804-010203-2-page-01.png",
                "PA-Cards/PA-Card-20260804-010203-2-page-02.png",
            ],
            attempted: 2,
        });
        expect(storedPaths).toEqual(new Set([
            "PA-Cards/PA-Card-20260804-010203-page-01.png",
            "PA-Cards/PA-Card-20260804-010203-2-page-01.png",
            "PA-Cards/PA-Card-20260804-010203-2-page-02.png",
        ]));
    });

    it("refuses to treat an existing file as the output folder", async () => {
        const document = new ShareCardTestDocument();
        const renderer = { renderPage: jest.fn() } as unknown as ShareCardRenderer;
        const createBinary = jest.fn();
        const vault = {
            getAbstractFileByPath: jest.fn(() => ({ path: "PA-Cards" })),
            adapter: { exists: jest.fn(async () => true), stat: jest.fn() },
            createFolder: jest.fn(),
            createBinary,
        } as unknown as Vault;
        const exporter = new ShareCardExporter(
            { vault } as App,
            asDocument(document),
            renderer,
            { theme: "light" },
        );

        await expect(exporter.savePages([
            { content: "one", pageIndex: 0, totalPages: 1 },
        ])).rejects.toThrow("occupied by a file");
        expect(vault.createFolder).not.toHaveBeenCalled();
        expect(createBinary).not.toHaveBeenCalled();
        expect(renderer.renderPage).not.toHaveBeenCalled();
    });
});
