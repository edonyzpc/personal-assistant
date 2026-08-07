import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SnapdomOptions, SnapdomPlugin } from "@zumer/snapdom";
import type { App, Vault } from "obsidian";
import {
    ShareCardClipboardUnavailableError,
    ShareCardExporter,
    assertShareCardElementIsSelfContained,
    canCopyShareCardImage,
    createSnapdomShareCardCapture,
    createShareCardBatchPaths,
    selectUniqueShareCardBatchPaths,
    type SnapdomLike,
} from "../src/share-card/share-card-export";
import {
    ShareCardRenderCancelledError,
    type ShareCardRenderer,
} from "../src/share-card/share-card-renderer";
import type { CardPage } from "../src/share-card/share-card-types";
import {
    ShareCardTestDocument,
    asDocument,
    asElement,
} from "./helpers/share-card-dom";

describe("Share Card export", () => {
    it("captures through SnapDOM with the audited fixed options", async () => {
        const document = new ShareCardTestDocument();
        const element = asElement(document.createElement("div"));
        const pngBlob = new Blob(["png"], { type: "image/png" });
        const toBlob = jest.fn(async () => pngBlob);
        const snapdom = jest.fn(async (_element: Element, _options?: SnapdomOptions) => ({
            toBlob,
        }));
        const snapdomLike = snapdom as unknown as SnapdomLike;

        await expect(createSnapdomShareCardCapture(snapdomLike)(element))
            .resolves.toBe(pngBlob);

        expect(snapdom).toHaveBeenCalledTimes(1);
        const options = snapdom.mock.calls[0]![1] as SnapdomOptions;
        expect(options).toMatchObject({
            scale: 2,
            dpr: 1,
            type: "png",
            useProxy: "",
            embedFonts: false,
            reconcile: false,
            outerShadows: false,
            resolvePicturePlaceholders: false,
            cache: "disabled",
        });
        expect(options.localFonts).toEqual([]);
        expect(options.plugins).toHaveLength(1);
        expect(options.plugins?.[0]).toEqual(expect.objectContaining({
            name: "pa-share-card-local-font-only",
            beforeSnap: expect.any(Function),
            beforeRender: expect.any(Function),
        }));
        expect(toBlob).toHaveBeenCalledWith({ type: "png" });
    });

    it("disables document font discovery before SnapDOM and injects only the bundled font", async () => {
        const document = new ShareCardTestDocument();
        const element = asElement(document.createElement("div"));
        const lifecycle: string[] = [];
        const snapdom = jest.fn(async (_element: Element, options?: SnapdomOptions) => {
            const plugin = options?.plugins?.[0] as SnapdomPlugin | undefined;
            expect(plugin?.name).toBe("pa-share-card-local-font-only");
            const runtimeOptions = { ...options } as SnapdomOptions;
            const context = {
                element,
                options: runtimeOptions,
                fontsCSS: "@font-face{src:url(https://example.com/remote.woff2)}",
            } as unknown as Parameters<NonNullable<SnapdomPlugin["beforeSnap"]>>[0]
                & { options: SnapdomOptions };

            // Safari font warm-up runs before beforeSnap, so the initial
            // options must already forbid document-wide discovery.
            if (context.options.embedFonts) lifecycle.push("document-font-warmup");
            await plugin?.beforeSnap?.(context);
            lifecycle.push("beforeSnap");
            expect(context.options.embedFonts).toBe(false);
            expect(context.options.localFonts).toEqual([]);

            if (context.options.embedFonts) lifecycle.push("document-font-discovery");
            await plugin?.beforeRender?.(context);
            lifecycle.push("beforeRender");
            expect(context.fontsCSS).toContain("font-family:\"PA Share Serif\"");
            expect(context.fontsCSS).toContain("data:font/woff2;base64,d09GMg==");
            expect(context.fontsCSS).not.toMatch(/https?:\/\//u);
            expect(context.fontsCSS?.match(/@font-face/gu)).toHaveLength(1);

            return {
                toBlob: async () => new Blob(["png"], { type: "image/png" }),
            };
        });

        await createSnapdomShareCardCapture(snapdom as unknown as SnapdomLike)(element);

        expect(lifecycle).toEqual(["beforeSnap", "beforeRender"]);
    });

    it("fails closed before SnapDOM when a capture resource is not self-contained", async () => {
        const document = new ShareCardTestDocument();
        const card = document.createElement("div");
        const image = document.createElement("img");
        image.setAttribute("src", "https://example.com/not-localized.png");
        card.appendChild(image);
        const snapdomLike = jest.fn(async () => ({
            toBlob: async () => new Blob(["png"], { type: "image/png" }),
        })) as unknown as SnapdomLike;

        expect(() => assertShareCardElementIsSelfContained(asElement(card)))
            .toThrow("external src resource");
        await expect(createSnapdomShareCardCapture(snapdomLike)(asElement(card)))
            .rejects.toThrow("external src resource");
        expect(snapdomLike).not.toHaveBeenCalled();

        image.setAttribute("src", "data:image/png;base64,AAAA");
        expect(() => assertShareCardElementIsSelfContained(asElement(card))).not.toThrow();
    });

    it("audits every computed and pseudo-element URL before invoking SnapDOM", async () => {
        const document = new ShareCardTestDocument();
        const card = document.createElement("div");
        const child = document.createElement("span");
        child.setAttribute("fill", "url(#paint)");
        card.appendChild(child);
        const getComputedStyle = jest.fn((_element: Element, pseudo: string | null) => {
            const values = pseudo === "::before"
                ? new Map([["filter", "url(https://example.com/filter.svg#blur)"]])
                : new Map([
                    ["fill", "url(#paint)"],
                    ["shape-outside", "none"],
                ]);
            const properties = [...values.keys()];
            return {
                length: properties.length,
                item: (index: number) => properties[index] ?? "",
                getPropertyValue: (property: string) => values.get(property) ?? "",
            } as unknown as CSSStyleDeclaration;
        });
        Object.assign(document.defaultView, { getComputedStyle });
        const snapdomLike = jest.fn(async () => ({
            toBlob: async () => new Blob(["png"], { type: "image/png" }),
        })) as unknown as SnapdomLike;

        expect(() => assertShareCardElementIsSelfContained(asElement(card)))
            .toThrow("external CSS resource");
        await expect(createSnapdomShareCardCapture(snapdomLike)(asElement(card)))
            .rejects.toThrow("external CSS resource");
        expect(getComputedStyle).toHaveBeenCalledWith(expect.anything(), "::before");
        expect(snapdomLike).not.toHaveBeenCalled();

        getComputedStyle.mockImplementation(() => {
            const values = new Map([["fill", "url(#paint)"]]);
            return {
                length: 1,
                item: () => "fill",
                getPropertyValue: (property: string) => values.get(property) ?? "",
            } as unknown as CSSStyleDeclaration;
        });
        child.setAttribute("filter", "url(https://example.com/filter.svg#blur)");
        expect(() => assertShareCardElementIsSelfContained(asElement(card)))
            .toThrow("external CSS resource");
    });

    it.each([
        "data:text/html,unsafe",
        "data:image/bmp;base64,AAAA",
        "data:image/svg+xml;base64,AAAA",
    ])("accepts only the approved capture data-image formats: %s", (source) => {
        const document = new ShareCardTestDocument();
        const image = document.createElement("img");
        image.setAttribute("src", source);

        if (source.includes("svg+xml")) {
            expect(() => assertShareCardElementIsSelfContained(asElement(image))).not.toThrow();
        } else {
            expect(() => assertShareCardElementIsSelfContained(asElement(image)))
                .toThrow("external src resource");
        }
    });

    it.each([
        ["empty", new Blob([], { type: "image/png" }), "empty PNG blob"],
        ["wrong MIME", new Blob(["jpeg"], { type: "image/jpeg" }), "image/jpeg"],
    ])("rejects a %s SnapDOM blob", async (_label, blob, message) => {
        const document = new ShareCardTestDocument();
        const element = asElement(document.createElement("div"));
        const snapdomLike = jest.fn(async () => ({
            toBlob: async () => blob,
        })) as unknown as SnapdomLike;
        const capture = createSnapdomShareCardCapture(snapdomLike);

        await expect(capture(element)).rejects.toThrow(message);
    });

    it("propagates SnapDOM and PNG conversion failures", async () => {
        const document = new ShareCardTestDocument();
        const element = asElement(document.createElement("div"));
        const snapError = new Error("snapshot failed");
        const blobError = new Error("PNG conversion failed");
        const captureFailure = createSnapdomShareCardCapture(
            jest.fn(async () => { throw snapError; }) as unknown as SnapdomLike,
        );
        const blobFailure = createSnapdomShareCardCapture(jest.fn(async () => ({
            toBlob: async () => { throw blobError; },
        })) as unknown as SnapdomLike);

        await expect(captureFailure(element)).rejects.toBe(snapError);
        await expect(blobFailure(element)).rejects.toBe(blobError);
    });

    it("keeps the plugin adapter free of owned runtime style nodes and HTML assignment", () => {
        const source = readFileSync(
            resolve(process.cwd(), "src/share-card/share-card-export.ts"),
            "utf8",
        );
        expect(source).toContain('import("@zumer/snapdom")');
        expect(source).not.toContain("XMLSerializer");
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

    it("reuses the chosen font size for copy and a new custom-folder save", async () => {
        const document = new ShareCardTestDocument();
        const write = jest.fn(async (items: unknown[]) => {
            const item = items[0] as { items: Record<string, Blob | PromiseLike<Blob>> };
            await item.items["image/png"];
        });
        document.defaultView.navigator.clipboard = { write };
        document.defaultView.ClipboardItem = class ClipboardItemMock {
            constructor(readonly items: Record<string, Blob | PromiseLike<Blob>>) {}
        } as unknown as typeof ClipboardItem;

        const cleanup = jest.fn();
        const renderPage = jest.fn(async (
            _page: CardPage,
            _appearance: { fontSize?: number },
        ) => ({
            cardEl: asElement(document.createElement("div")),
            cleanup,
        }));
        const renderer = { renderPage } as unknown as ShareCardRenderer;
        const createFolder = jest.fn(async () => undefined);
        const createBinary = jest.fn(async () => undefined);
        const vault = {
            getAbstractFileByPath: jest.fn(() => null),
            adapter: {
                exists: jest.fn(async () => false),
                stat: jest.fn(async () => null),
            },
            createFolder,
            createBinary,
        } as unknown as Vault;
        const capture = jest.fn(async () => new Blob(["page"], { type: "image/png" }));
        const exporter = new ShareCardExporter(
            { vault } as App,
            asDocument(document),
            renderer,
            { theme: "light", fontSize: 20 },
            { capture, now: () => new Date("2026-08-04T01:02:03.000Z") },
        );
        const page = { content: "one", pageIndex: 0, totalPages: 1 };

        await exporter.copyCurrentPage(page);
        await expect(exporter.savePages([page], "Cards/Shared")).resolves.toEqual({
            savedPaths: ["Cards/Shared/PA-Card-20260804-010203.png"],
            attempted: 1,
        });

        expect(renderPage).toHaveBeenCalledTimes(2);
        for (const [, appearance] of renderPage.mock.calls) {
            expect(appearance).toEqual(expect.objectContaining({ fontSize: 20 }));
        }
        expect(write).toHaveBeenCalledTimes(1);
        expect(createFolder).toHaveBeenCalledWith("Cards/Shared");
        expect(createBinary).toHaveBeenCalledWith(
            "Cards/Shared/PA-Card-20260804-010203.png",
            expect.any(ArrayBuffer),
        );
        expect(cleanup).toHaveBeenCalledTimes(2);
    });

    it("writes a Vault-root selection without creating a folder", async () => {
        const document = new ShareCardTestDocument();
        const renderer = {
            renderPage: jest.fn(async () => ({
                cardEl: asElement(document.createElement("div")),
                cleanup: jest.fn(),
            })),
        } as unknown as ShareCardRenderer;
        const createFolder = jest.fn(async () => undefined);
        const createBinary = jest.fn(async () => undefined);
        const vault = {
            getAbstractFileByPath: jest.fn(() => null),
            adapter: { exists: jest.fn(async () => false) },
            createFolder,
            createBinary,
        } as unknown as Vault;
        const exporter = new ShareCardExporter(
            { vault } as App,
            asDocument(document),
            renderer,
            { theme: "light", fontSize: 22 },
            {
                capture: async () => new Blob(["page"], { type: "image/png" }),
                now: () => new Date("2026-08-04T01:02:03.000Z"),
            },
        );

        await expect(exporter.savePages([
            { content: "one", pageIndex: 0, totalPages: 1 },
        ], "/")).resolves.toEqual({
            savedPaths: ["PA-Card-20260804-010203.png"],
            attempted: 1,
        });
        expect(createFolder).not.toHaveBeenCalled();
        expect(createBinary).toHaveBeenCalledWith(
            "PA-Card-20260804-010203.png",
            expect.any(ArrayBuffer),
        );
    });

    it("discards a late SnapDOM result after the render owner is cancelled", async () => {
        const document = new ShareCardTestDocument();
        const controller = new AbortController();
        const cleanup = jest.fn(() => controller.abort());
        const renderer = {
            renderPage: jest.fn(async () => ({
                cardEl: asElement(document.createElement("div")),
                signal: controller.signal,
                cleanup,
            })),
        } as unknown as ShareCardRenderer;
        let finishCapture!: (blob: Blob) => void;
        const capture = jest.fn(() => new Promise<Blob>((resolveCapture) => {
            finishCapture = resolveCapture;
        }));
        const createBinary = jest.fn(async () => undefined);
        const vault = {
            getAbstractFileByPath: jest.fn(() => null),
            adapter: { exists: jest.fn(async () => false) },
            createFolder: jest.fn(async () => undefined),
            createBinary,
        } as unknown as Vault;
        const exporter = new ShareCardExporter(
            { vault } as App,
            asDocument(document),
            renderer,
            { theme: "light" },
            { capture },
        );

        const pending = exporter.savePages([{ content: "one", pageIndex: 0, totalPages: 1 }]);
        for (let attempt = 0; attempt < 50 && !finishCapture; attempt += 1) {
            await Promise.resolve();
        }
        expect(finishCapture).toBeDefined();
        controller.abort();
        finishCapture(new Blob(["png"], { type: "image/png" }));

        await expect(pending).resolves.toEqual({
            savedPaths: [],
            attempted: 1,
            failedPageIndex: 0,
        });
        expect(createBinary).not.toHaveBeenCalled();
        expect(cleanup).toHaveBeenCalledTimes(1);
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

    it("performs no Vault reads or writes when a queued save is cancelled", async () => {
        const document = new ShareCardTestDocument();
        let releaseFirstCapture!: (blob: Blob) => void;
        let firstCaptureStarted!: () => void;
        const started = new Promise<void>((resolve) => {
            firstCaptureStarted = resolve;
        });
        let folderExists = true;
        const getAbstractFileByPath = jest.fn((path: string) => (
            path === "PA-Cards" && folderExists ? { path, children: [] } : null
        ));
        const adapterExists = jest.fn(async () => false);
        const createFolder = jest.fn(async () => {
            folderExists = true;
        });
        const createBinary = jest.fn(async () => undefined);
        const vault = {
            getAbstractFileByPath,
            adapter: { exists: adapterExists },
            createFolder,
            createBinary,
        } as unknown as Vault;
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
        const first = new ShareCardExporter(
            { vault } as App,
            asDocument(document),
            firstRenderer,
            { theme: "light" },
            {
                capture: () => new Promise<Blob>((resolve) => {
                    releaseFirstCapture = resolve;
                    firstCaptureStarted();
                }),
            },
        );
        const controller = new AbortController();
        const secondCapture = jest.fn(async () => new Blob(["second"], { type: "image/png" }));
        const second = new ShareCardExporter(
            { vault } as App,
            asDocument(document),
            secondRenderer,
            { theme: "light" },
            { capture: secondCapture, signal: controller.signal },
        );
        const page = { content: "one", pageIndex: 0, totalPages: 1 };

        const firstSave = first.savePages([page]);
        await started;
        const readsBeforeSecond = getAbstractFileByPath.mock.calls.length
            + adapterExists.mock.calls.length;
        const writesBeforeSecond = createFolder.mock.calls.length + createBinary.mock.calls.length;
        const secondSave = second.savePages([page]);
        controller.abort();
        releaseFirstCapture(new Blob(["first"], { type: "image/png" }));

        await expect(firstSave).resolves.toMatchObject({ attempted: 1 });
        await expect(secondSave).rejects.toBeInstanceOf(ShareCardRenderCancelledError);
        expect(getAbstractFileByPath.mock.calls.length + adapterExists.mock.calls.length)
            .toBe(readsBeforeSecond);
        expect(createFolder.mock.calls.length + createBinary.mock.calls.length)
            .toBe(writesBeforeSecond + 1);
        expect(secondRenderer.renderPage).not.toHaveBeenCalled();
        expect(secondCapture).not.toHaveBeenCalled();
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

    it("refuses to treat an existing file as a custom output folder", async () => {
        const document = new ShareCardTestDocument();
        const renderer = { renderPage: jest.fn() } as unknown as ShareCardRenderer;
        const createBinary = jest.fn();
        const vault = {
            getAbstractFileByPath: jest.fn(() => ({ path: "Cards/Shared" })),
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
        ], "Cards/Shared")).rejects.toThrow("occupied by a file");
        expect(vault.createFolder).not.toHaveBeenCalled();
        expect(createBinary).not.toHaveBeenCalled();
        expect(renderer.renderPage).not.toHaveBeenCalled();
    });
});
