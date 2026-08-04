/* Copyright 2023 edonyzpc */

import { normalizePath, type App, type Vault } from "obsidian";
import {
    CARD_HEIGHT,
    CARD_OUTPUT_HEIGHT,
    CARD_OUTPUT_WIDTH,
    CARD_WIDTH,
    type CardPage,
    type ShareCardSaveResult,
} from "./share-card-types";
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
    XMLSerializer?: typeof XMLSerializer;
};

export type ShareCardCapture = (element: HTMLElement) => Promise<Blob>;

export interface ShareCardExporterOptions {
    capture?: ShareCardCapture;
    now?: () => Date;
}

export type ShareCardExportAppearance = Omit<ShareCardRenderOptions, "host">;

export class ShareCardClipboardUnavailableError extends Error {
    constructor() {
        super("Share Card image clipboard is unavailable.");
        this.name = "ShareCardClipboardUnavailableError";
    }
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const shareCardSaveTails = new WeakMap<Vault, Promise<void>>();

const OMITTED_CAPTURE_ELEMENTS = new Set([
    "audio",
    "base",
    "button",
    "canvas",
    "embed",
    "form",
    "iframe",
    "img",
    "input",
    "link",
    "meta",
    "noscript",
    "object",
    "picture",
    "script",
    "select",
    "source",
    "style",
    "svg",
    "template",
    "textarea",
    "video",
]);

const VOID_CAPTURE_ELEMENTS = new Set([
    "area",
    "br",
    "col",
    "hr",
    "wbr",
]);

const SAFE_CAPTURE_ELEMENTS = new Set([
    "a",
    "abbr",
    "address",
    "article",
    "aside",
    "b",
    "bdi",
    "bdo",
    "blockquote",
    "br",
    "caption",
    "center",
    "cite",
    "code",
    "col",
    "colgroup",
    "dd",
    "del",
    "details",
    "dfn",
    "div",
    "dl",
    "dt",
    "em",
    "figcaption",
    "figure",
    "footer",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hr",
    "i",
    "ins",
    "kbd",
    "label",
    "li",
    "main",
    "mark",
    "nav",
    "ol",
    "p",
    "pre",
    "q",
    "rp",
    "rt",
    "ruby",
    "s",
    "samp",
    "section",
    "small",
    "span",
    "strong",
    "sub",
    "summary",
    "sup",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "time",
    "tr",
    "u",
    "ul",
    "var",
    "wbr",
]);

/**
 * Computed properties needed by the fixed Share Card layout. Keeping this an
 * allowlist makes the SVG self-contained and prevents resource-bearing CSS
 * outside the card contract from crossing into the image document.
 */
const CAPTURE_STYLE_PROPERTIES = [
    "align-content",
    "align-items",
    "align-self",
    "background-attachment",
    "background-blend-mode",
    "background-clip",
    "background-color",
    "background-image",
    "background-origin",
    "background-position-x",
    "background-position-y",
    "background-repeat-x",
    "background-repeat-y",
    "background-size",
    "border-bottom-color",
    "border-bottom-left-radius",
    "border-bottom-right-radius",
    "border-bottom-style",
    "border-bottom-width",
    "border-left-color",
    "border-left-style",
    "border-left-width",
    "border-right-color",
    "border-right-style",
    "border-right-width",
    "border-top-color",
    "border-top-left-radius",
    "border-top-right-radius",
    "border-top-style",
    "border-top-width",
    "bottom",
    "box-decoration-break",
    "box-shadow",
    "box-sizing",
    "clear",
    "color",
    "column-gap",
    "direction",
    "display",
    "flex-basis",
    "flex-direction",
    "flex-grow",
    "flex-shrink",
    "flex-wrap",
    "float",
    "font-family",
    "font-feature-settings",
    "font-kerning",
    "font-optical-sizing",
    "font-size",
    "font-stretch",
    "font-style",
    "font-synthesis",
    "font-variant",
    "font-variant-numeric",
    "font-weight",
    "grid-auto-columns",
    "grid-auto-flow",
    "grid-auto-rows",
    "grid-column-end",
    "grid-column-start",
    "grid-row-end",
    "grid-row-start",
    "grid-template-columns",
    "grid-template-rows",
    "height",
    "hyphens",
    "isolation",
    "justify-content",
    "justify-items",
    "justify-self",
    "left",
    "letter-spacing",
    "line-height",
    "list-style-position",
    "list-style-type",
    "margin-bottom",
    "margin-left",
    "margin-right",
    "margin-top",
    "max-height",
    "max-width",
    "min-height",
    "min-width",
    "opacity",
    "order",
    "overflow-wrap",
    "overflow-x",
    "overflow-y",
    "padding-bottom",
    "padding-left",
    "padding-right",
    "padding-top",
    "position",
    "right",
    "row-gap",
    "tab-size",
    "text-align",
    "text-decoration-color",
    "text-decoration-line",
    "text-decoration-style",
    "text-decoration-thickness",
    "text-emphasis-color",
    "text-emphasis-style",
    "text-indent",
    "text-overflow",
    "text-rendering",
    "text-shadow",
    "text-transform",
    "text-underline-offset",
    "top",
    "transform",
    "transform-origin",
    "unicode-bidi",
    "vertical-align",
    "visibility",
    "white-space",
    "width",
    "word-break",
    "word-spacing",
    "writing-mode",
    "z-index",
] as const;

const RESOURCE_BEARING_CSS_RE = /(?:url|image(?:-set)?|-webkit-image-set|cross-fade|paint)\s*\(/i;

/** Capture a self-contained, fixed-size Share Card without runtime style nodes. */
export async function captureShareCardElement(element: HTMLElement): Promise<Blob> {
    try {
        const ownerDocument = element.ownerDocument;
        const ownerWindow = ownerDocument.defaultView;
        if (!ownerWindow) throw new Error("Share Card owner window is unavailable.");

        const svg = createShareCardSvg(element, ownerDocument, ownerWindow);
        const XMLSerializerCtor = (ownerWindow as ShareCardWindow).XMLSerializer;
        if (!XMLSerializerCtor) throw new Error("Share Card SVG serializer is unavailable.");
        const svgMarkup = new XMLSerializerCtor().serializeToString(svg);
        // WebKit only treats SVG foreignObject content as same-origin when the
        // image is loaded from a self-contained data URL. A blob URL can taint
        // the canvas and make the following PNG export throw SecurityError.
        const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
        const image = await loadLocalSvgImage(ownerDocument, svgDataUrl);
        const canvas = ownerDocument.createElement("canvas");
        canvas.width = CARD_OUTPUT_WIDTH;
        canvas.height = CARD_OUTPUT_HEIGHT;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Share Card canvas context is unavailable.");
        context.drawImage(image, 0, 0, CARD_OUTPUT_WIDTH, CARD_OUTPUT_HEIGHT);
        return await canvasToPngBlob(canvas);
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

    constructor(
        private readonly app: App,
        private readonly ownerDocument: Document,
        private readonly renderer: ShareCardRenderer,
        private readonly appearance: ShareCardExportAppearance,
        options: ShareCardExporterOptions = {},
    ) {
        this.capture = options.capture ?? captureShareCardElement;
        this.now = options.now ?? (() => new Date());
    }

    canCopyImage(): boolean {
        return canCopyShareCardImage(this.ownerDocument);
    }

    async copyCurrentPage(page: CardPage): Promise<void> {
        if (!this.canCopyImage()) throw new ShareCardClipboardUnavailableError();
        const blobPromise = this.capturePage(page);
        void blobPromise.catch(() => undefined);
        await copyShareCardBlob(blobPromise, this.ownerDocument);
    }

    async savePages(pages: readonly CardPage[]): Promise<ShareCardSaveResult> {
        const attempted = pages.length;
        if (attempted === 0) return { savedPaths: [], attempted: 0 };

        return enqueueShareCardSave(this.app.vault, async () => {
            await ensureShareCardFolder(this.app.vault);
            const paths = await selectUniqueShareCardBatchPaths(
                this.app.vault,
                pages.length,
                this.now(),
            );
            const savedPaths: string[] = [];

            for (let index = 0; index < pages.length; index += 1) {
                const page = pages[index]!;
                try {
                    const blob = await this.capturePage(page);
                    await this.app.vault.createBinary(paths[index]!, await blob.arrayBuffer());
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
        const render = await this.renderer.renderPage(page, this.appearance);
        try {
            return await this.capture(render.cardEl);
        } finally {
            render.cleanup();
        }
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

function createShareCardSvg(
    element: HTMLElement,
    ownerDocument: Document,
    ownerWindow: Window,
): SVGSVGElement {
    const svg = ownerDocument.createElementNS(SVG_NAMESPACE, "svg");
    svg.setAttribute("width", String(CARD_OUTPUT_WIDTH));
    svg.setAttribute("height", String(CARD_OUTPUT_HEIGHT));
    svg.setAttribute("viewBox", `0 0 ${CARD_WIDTH} ${CARD_HEIGHT}`);

    const foreignObject = ownerDocument.createElementNS(SVG_NAMESPACE, "foreignObject");
    foreignObject.setAttribute("x", "0");
    foreignObject.setAttribute("y", "0");
    foreignObject.setAttribute("width", String(CARD_WIDTH));
    foreignObject.setAttribute("height", String(CARD_HEIGHT));

    const wrapper = ownerDocument.createElementNS(XHTML_NAMESPACE, "div") as HTMLElement;
    wrapper.style.setProperty("width", `${CARD_WIDTH}px`);
    wrapper.style.setProperty("height", `${CARD_HEIGHT}px`);
    wrapper.style.setProperty("overflow", "hidden");
    const clonedCard = cloneCaptureNode(element, ownerDocument, ownerWindow);
    if (!clonedCard) throw new Error("Share Card capture root could not be cloned.");
    wrapper.appendChild(clonedCard);
    foreignObject.appendChild(wrapper);
    svg.appendChild(foreignObject);
    return svg;
}

function cloneCaptureNode(
    node: Node,
    ownerDocument: Document,
    ownerWindow: Window,
): Node | null {
    if (node.nodeType === 3) {
        return ownerDocument.createTextNode(sanitizeXmlText(node.nodeValue ?? ""));
    }
    if (node.nodeType !== 1) return null;

    const source = node as Element;
    const localName = source.localName.toLowerCase();
    if (OMITTED_CAPTURE_ELEMENTS.has(localName)) return null;
    const tagName = SAFE_CAPTURE_ELEMENTS.has(localName) ? localName : "span";
    const clone = ownerDocument.createElementNS(XHTML_NAMESPACE, tagName) as HTMLElement;
    copySafeCaptureAttributes(source, clone);
    copyComputedStyles(source, clone, ownerWindow);
    if (!VOID_CAPTURE_ELEMENTS.has(tagName)) {
        for (const child of Array.from(node.childNodes)) {
            const clonedChild = cloneCaptureNode(child, ownerDocument, ownerWindow);
            if (clonedChild) clone.appendChild(clonedChild);
        }
    }
    return clone;
}

function copySafeCaptureAttributes(source: Element, target: Element): void {
    const dir = source.getAttribute("dir");
    if (dir && /^(?:auto|ltr|rtl)$/i.test(dir)) target.setAttribute("dir", dir.toLowerCase());

    const lang = source.getAttribute("lang");
    if (lang) target.setAttribute("lang", lang);

    for (const name of ["start", "value", "colspan", "rowspan"] as const) {
        const value = source.getAttribute(name);
        if (value && /^-?\d+$/.test(value)) target.setAttribute(name, value);
    }
    for (const name of ["open", "reversed"] as const) {
        if (source.getAttribute(name) !== null) target.setAttribute(name, "");
    }
}

function copyComputedStyles(source: Element, target: HTMLElement, ownerWindow: Window): void {
    const computed = ownerWindow.getComputedStyle(source);
    for (const property of CAPTURE_STYLE_PROPERTIES) {
        const value = computed.getPropertyValue(property).trim();
        if (!value || RESOURCE_BEARING_CSS_RE.test(value)) continue;
        target.style.setProperty(property, value);
    }
}

function sanitizeXmlText(value: string): string {
    return Array.from(value, (character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        const valid = codePoint === 0x09
            || codePoint === 0x0A
            || codePoint === 0x0D
            || (codePoint >= 0x20 && codePoint <= 0xD7FF)
            || (codePoint >= 0xE000 && codePoint <= 0xFFFD)
            || (codePoint >= 0x10000 && codePoint <= 0x10FFFF);
        return valid ? character : "\uFFFD";
    }).join("");
}

function loadLocalSvgImage(ownerDocument: Document, objectUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = ownerDocument.createElement("img");
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Share Card SVG could not be decoded."));
        image.src = objectUrl;
    });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        try {
            canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error("Share Card capture returned no PNG blob."));
            }, "image/png");
        } catch (error) {
            reject(error);
        }
    });
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
): Promise<string[]> {
    const timestampBase = createShareCardBatchBaseName(now);
    for (let attempt = 1; attempt <= 10_000; attempt += 1) {
        const baseName = attempt === 1 ? timestampBase : `${timestampBase}-${attempt}`;
        const paths = createShareCardBatchPaths(baseName, pageCount);
        const occupied = await Promise.all(paths.map((path) => vaultPathExists(vault, path)));
        if (!occupied.some(Boolean)) return paths;
    }
    throw new Error("Could not select a unique Share Card batch name.");
}

async function ensureShareCardFolder(vault: Vault): Promise<void> {
    const normalizedFolder = normalizePath(SHARE_CARD_FOLDER);
    const existing = vault.getAbstractFileByPath(normalizedFolder);
    if (existing) {
        if ("children" in existing) return;
        throw new Error("Share Card output folder path is occupied by a file.");
    }
    if (await vault.adapter.exists(normalizedFolder)) {
        const stat = await vault.adapter.stat(normalizedFolder);
        if (stat?.type === "folder") return;
        throw new Error("Share Card output folder path is occupied by a file.");
    }
    await vault.createFolder(normalizedFolder);
}

async function vaultPathExists(vault: Vault, path: string): Promise<boolean> {
    if (vault.getAbstractFileByPath(path)) return true;
    return vault.adapter.exists(path);
}
