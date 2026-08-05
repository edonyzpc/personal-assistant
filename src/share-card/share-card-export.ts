/* Copyright 2023 edonyzpc */

import type { SnapdomOptions } from "@zumer/snapdom";
import { normalizePath, type App, type Vault } from "obsidian";
import { type CardPage, type ShareCardSaveResult } from "./share-card-types";
import {
    ShareCardRenderCancelledError,
    ShareCardRenderer,
    type ShareCardRenderOptions,
} from "./share-card-renderer";

export const SHARE_CARD_FOLDER = "PA-Cards";

type ClipboardItemConstructor = new (
    items: Record<string, Blob | PromiseLike<Blob>>,
) => ClipboardItem;

type ShareCardWindow = Window & {
    ClipboardItem?: ClipboardItemConstructor;
};

export type ShareCardCapture = (element: HTMLElement) => Promise<Blob>;

export interface SnapdomCaptureResultLike {
    toBlob(options?: { type?: "png" }): Promise<Blob>;
}

export type SnapdomLike = (
    element: Element,
    options?: SnapdomOptions,
) => Promise<SnapdomCaptureResultLike>;

export interface ShareCardExporterOptions {
    capture?: ShareCardCapture;
    now?: () => Date;
    signal?: AbortSignal;
}

export type ShareCardExportAppearance = Omit<ShareCardRenderOptions, "host">;

export class ShareCardClipboardUnavailableError extends Error {
    constructor() {
        super("Share Card image clipboard is unavailable.");
        this.name = "ShareCardClipboardUnavailableError";
    }
}

const shareCardSaveTails = new WeakMap<Vault, Promise<void>>();

const SNAPDOM_SHARE_CARD_OPTIONS = Object.freeze({
    scale: 2,
    dpr: 1,
    type: "png",
    useProxy: "",
    embedFonts: false,
    reconcile: false,
    outerShadows: false,
    resolvePicturePlaceholders: false,
    cache: "disabled",
} satisfies SnapdomOptions);

const CAPTURE_RESOURCE_ATTRIBUTES = new Set([
    "background",
    "poster",
    "src",
    "srcset",
    "xlink:href",
]);
const CSS_URL_RE = /url\(\s*(["']?)(.*?)\1\s*\)/giu;
const SAFE_CAPTURE_IMAGE_DATA_URI_RE = /^data:image\/(?:gif|jpeg|png|svg\+xml|webp)(?:;[^,]*)?,/iu;

/** Defense in depth: SnapDOM must never become Share Card's resource loader. */
export function assertShareCardElementIsSelfContained(element: HTMLElement): void {
    const elements = [element, ...Array.from(element.querySelectorAll("*"))];
    for (const current of elements) {
        for (const attributeName of current.getAttributeNames()) {
            const normalizedName = attributeName.toLowerCase();
            const value = current.getAttribute(attributeName)?.trim() ?? "";
            if (value.toLowerCase().includes("url(")) {
                assertSelfContainedCssUrls(value);
            }
            if (normalizedName === "href") {
                const isSvgReference = current.namespaceURI === "http://www.w3.org/2000/svg";
                if (isSvgReference && !isSelfContainedResourceValue(value, true)) {
                    throw new Error("Share Card capture contains an external SVG reference.");
                }
                continue;
            }
            if (normalizedName === "style") {
                assertSelfContainedCssUrls(value);
                continue;
            }
            if (!CAPTURE_RESOURCE_ATTRIBUTES.has(normalizedName)) continue;
            if (normalizedName === "srcset" && value.length > 0) {
                throw new Error("Share Card capture contains a srcset resource.");
            }
            if (!isSelfContainedResourceValue(value, normalizedName === "xlink:href")) {
                throw new Error(`Share Card capture contains an external ${normalizedName} resource.`);
            }
        }

        const ownerWindow = current.ownerDocument.defaultView;
        if (!ownerWindow || typeof ownerWindow.getComputedStyle !== "function") continue;
        for (const pseudoElement of [null, "::before", "::after"] as const) {
            const computed = ownerWindow.getComputedStyle(current, pseudoElement);
            for (let index = 0; index < computed.length; index += 1) {
                const propertyName = computed.item(index);
                if (propertyName) {
                    assertSelfContainedCssUrls(computed.getPropertyValue(propertyName));
                }
            }
        }
    }
}

function isSelfContainedResourceValue(value: string, allowFragment = false): boolean {
    if (value.length === 0) return true;
    if (SAFE_CAPTURE_IMAGE_DATA_URI_RE.test(value)) return true;
    if (allowFragment && value.startsWith("#")) return true;
    return false;
}

function assertSelfContainedCssUrls(cssValue: string): void {
    CSS_URL_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CSS_URL_RE.exec(cssValue)) !== null) {
        const value = match[2]?.trim() ?? "";
        if (!isSelfContainedResourceValue(value, true)) {
            throw new Error("Share Card capture contains an external CSS resource.");
        }
    }
}

/** Bind the audited SnapDOM capture contract behind an injectable test seam. */
export function createSnapdomShareCardCapture(snapdomLike: SnapdomLike): ShareCardCapture {
    return async (element) => {
        assertShareCardElementIsSelfContained(element);
        const result = await snapdomLike(element, SNAPDOM_SHARE_CARD_OPTIONS);
        const blob = await result.toBlob({ type: "png" });
        if (blob.type !== "image/png") {
            throw new Error(`Share Card capture returned ${blob.type || "an unknown MIME type"}.`);
        }
        if (blob.size < 1) {
            throw new Error("Share Card capture returned an empty PNG blob.");
        }
        return blob;
    };
}

/** Capture the prepared, self-contained Share Card with exact SnapDOM 2.23.2 options. */
export async function captureShareCardElement(element: HTMLElement): Promise<Blob> {
    try {
        const { snapdom } = await import("@zumer/snapdom");
        return await createSnapdomShareCardCapture(snapdom)(element);
    } catch (error) {
        console.error("Share Card local PNG capture failed.", error);
        throw error;
    }
}

export function canCopyShareCardImage(ownerDocument: Document): boolean {
    const ownerWindow = ownerDocument.defaultView as ShareCardWindow | null;
    return Boolean(
        ownerWindow
        && typeof ownerWindow.ClipboardItem === "function"
        && typeof ownerWindow.navigator?.clipboard?.write === "function",
    );
}

export async function copyShareCardBlob(
    blob: Blob | PromiseLike<Blob>,
    ownerDocument: Document,
): Promise<void> {
    const ownerWindow = ownerDocument.defaultView as ShareCardWindow | null;
    const ClipboardItemCtor = ownerWindow?.ClipboardItem;
    const clipboard = ownerWindow?.navigator?.clipboard;
    if (!ClipboardItemCtor || typeof clipboard?.write !== "function") {
        throw new ShareCardClipboardUnavailableError();
    }
    await clipboard.write([
        new ClipboardItemCtor({ "image/png": blob }),
    ]);
}

export class ShareCardExporter {
    private readonly capture: ShareCardCapture;
    private readonly now: () => Date;
    private readonly signal?: AbortSignal;

    constructor(
        private readonly app: App,
        private readonly ownerDocument: Document,
        private readonly renderer: ShareCardRenderer,
        private readonly appearance: ShareCardExportAppearance,
        options: ShareCardExporterOptions = {},
    ) {
        this.capture = options.capture ?? captureShareCardElement;
        this.now = options.now ?? (() => new Date());
        this.signal = options.signal;
    }

    canCopyImage(): boolean {
        return canCopyShareCardImage(this.ownerDocument);
    }

    async copyCurrentPage(page: CardPage): Promise<void> {
        this.assertActive();
        if (!this.canCopyImage()) throw new ShareCardClipboardUnavailableError();
        const blobPromise = this.capturePage(page);
        void blobPromise.catch(() => undefined);
        await copyShareCardBlob(blobPromise, this.ownerDocument);
    }

    async savePages(pages: readonly CardPage[]): Promise<ShareCardSaveResult> {
        this.assertActive();
        const attempted = pages.length;
        if (attempted === 0) return { savedPaths: [], attempted: 0 };

        return enqueueShareCardSave(this.app.vault, async () => {
            this.assertActive();
            await ensureShareCardFolder(this.app.vault, () => this.assertActive());
            this.assertActive();
            const paths = await selectUniqueShareCardBatchPaths(
                this.app.vault,
                pages.length,
                this.now(),
                () => this.assertActive(),
            );
            this.assertActive();
            const savedPaths: string[] = [];

            for (let index = 0; index < pages.length; index += 1) {
                const page = pages[index]!;
                try {
                    this.assertActive();
                    const blob = await this.capturePage(page);
                    const contents = await blob.arrayBuffer();
                    this.assertActive();
                    await this.app.vault.createBinary(paths[index]!, contents);
                    savedPaths.push(paths[index]!);
                } catch (error) {
                    if (!(error instanceof ShareCardRenderCancelledError)) {
                        console.error("Share Card local page save failed.", {
                            pageIndex: page.pageIndex,
                            error,
                        });
                    }
                    return {
                        savedPaths,
                        attempted,
                        failedPageIndex: page.pageIndex,
                    };
                }
            }

            return { savedPaths, attempted };
        });
    }

    private async capturePage(page: CardPage): Promise<Blob> {
        this.assertActive();
        const render = await this.renderer.renderPage(page, this.appearance);
        try {
            const blob = await this.capture(render.cardEl);
            if (render.signal?.aborted) throw new ShareCardRenderCancelledError();
            this.assertActive();
            return blob;
        } finally {
            render.cleanup();
        }
    }

    private assertActive(): void {
        if (this.signal?.aborted) throw new ShareCardRenderCancelledError();
    }
}

function enqueueShareCardSave<T>(vault: Vault, operation: () => Promise<T>): Promise<T> {
    const previous = shareCardSaveTails.get(vault) ?? Promise.resolve();
    const result = previous.then(operation);
    const tail = result.then(() => undefined, () => undefined);
    shareCardSaveTails.set(vault, tail);
    void tail.finally(() => {
        if (shareCardSaveTails.get(vault) === tail) shareCardSaveTails.delete(vault);
    });
    return result;
}

export function createShareCardBatchBaseName(now: Date): string {
    const iso = now.toISOString();
    const compact = `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}`;
    return `PA-Card-${compact}`;
}

export function createShareCardBatchPaths(
    baseName: string,
    pageCount: number,
): string[] {
    if (!Number.isInteger(pageCount) || pageCount < 1) return [];
    if (pageCount === 1) {
        return [normalizePath(`${SHARE_CARD_FOLDER}/${baseName}.png`)];
    }
    const width = Math.max(2, String(pageCount).length);
    return Array.from({ length: pageCount }, (_, pageIndex) => normalizePath(
        `${SHARE_CARD_FOLDER}/${baseName}-page-${String(pageIndex + 1).padStart(width, "0")}.png`,
    ));
}

export async function selectUniqueShareCardBatchPaths(
    vault: Vault,
    pageCount: number,
    now: Date,
    assertActive: () => void = () => undefined,
): Promise<string[]> {
    const timestampBase = createShareCardBatchBaseName(now);
    for (let attempt = 1; attempt <= 10_000; attempt += 1) {
        assertActive();
        const baseName = attempt === 1 ? timestampBase : `${timestampBase}-${attempt}`;
        const paths = createShareCardBatchPaths(baseName, pageCount);
        const occupied = await Promise.all(paths.map(async (path) => {
            assertActive();
            const exists = await vaultPathExists(vault, path);
            assertActive();
            return exists;
        }));
        assertActive();
        if (!occupied.some(Boolean)) return paths;
    }
    throw new Error("Could not select a unique Share Card batch name.");
}

async function ensureShareCardFolder(
    vault: Vault,
    assertActive: () => void = () => undefined,
): Promise<void> {
    assertActive();
    const normalizedFolder = normalizePath(SHARE_CARD_FOLDER);
    const existing = vault.getAbstractFileByPath(normalizedFolder);
    if (existing) {
        if ("children" in existing) return;
        throw new Error("Share Card output folder path is occupied by a file.");
    }
    assertActive();
    const exists = await vault.adapter.exists(normalizedFolder);
    assertActive();
    if (exists) {
        const stat = await vault.adapter.stat(normalizedFolder);
        assertActive();
        if (stat?.type === "folder") return;
        throw new Error("Share Card output folder path is occupied by a file.");
    }
    assertActive();
    await vault.createFolder(normalizedFolder);
    assertActive();
}

async function vaultPathExists(vault: Vault, path: string): Promise<boolean> {
    if (vault.getAbstractFileByPath(path)) return true;
    return vault.adapter.exists(path);
}
