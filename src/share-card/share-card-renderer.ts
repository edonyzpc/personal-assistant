/* Copyright 2023 edonyzpc */

import { Component, MarkdownRenderer, type App } from "obsidian";
import type { CardPage, ShareCardTheme } from "./share-card-types";

const PRUNED_SELECTOR = [
    "img",
    "picture",
    "source",
    "iframe",
    "video",
    "audio",
    "canvas",
    "svg",
    "object",
    "embed",
    "script",
    "style",
    "link",
    "base",
    "meta",
    "button",
    "input",
    "select",
    "textarea",
    ".internal-embed",
    ".media-embed",
    ".block-language-mermaid",
    ".mermaid",
].join(",");

const TEXT_ELEMENT_ALLOWLIST = new Set([
    "a",
    "abbr",
    "b",
    "bdi",
    "bdo",
    "blockquote",
    "br",
    "code",
    "col",
    "colgroup",
    "dd",
    "del",
    "div",
    "dl",
    "dt",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "i",
    "kbd",
    "li",
    "mark",
    "ol",
    "p",
    "pre",
    "q",
    "s",
    "samp",
    "small",
    "span",
    "strong",
    "sub",
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

const GLOBAL_ATTRIBUTE_ALLOWLIST = new Set(["dir", "lang"]);
const ELEMENT_ATTRIBUTE_ALLOWLIST: Readonly<Record<string, ReadonlySet<string>>> = {
    col: new Set(["span"]),
    colgroup: new Set(["span"]),
    li: new Set(["value"]),
    ol: new Set(["reversed", "start", "type"]),
    td: new Set(["colspan", "rowspan"]),
    th: new Set(["colspan", "rowspan", "scope"]),
    time: new Set(["datetime"]),
};

const DEFAULT_FIT_TOLERANCE = 1;

export interface ShareCardRenderOptions {
    theme: ShareCardTheme;
    sourceLabel?: string;
    sourcePath?: string;
    host?: HTMLElement;
}

export interface ShareCardRenderHandle {
    readonly cardEl: HTMLElement;
    readonly bodyEl: HTMLElement;
    readonly usedPlainTextFallback: boolean;
    fits(tolerance?: number): boolean;
    cleanup(): void;
}

export interface ShareCardRendererOptions {
    waitForFrame?: (ownerDocument: Document) => Promise<void>;
    createComponent?: () => Component;
}

export class ShareCardRenderCancelledError extends Error {
    constructor() {
        super("Share Card render was cancelled.");
        this.name = "ShareCardRenderCancelledError";
    }
}

/**
 * Owns every fixed-size Share Card render created by one Modal. Render handles
 * are independent so capture never observes a later page mutating the same DOM.
 */
export class ShareCardRenderer {
    private readonly activeRenders = new Set<ShareCardRenderHandle>();
    private readonly waitForFrame: (ownerDocument: Document) => Promise<void>;
    private readonly createComponent: () => Component;
    private destroyed = false;

    constructor(
        private readonly app: App,
        private readonly ownerDocument: Document,
        options: ShareCardRendererOptions = {},
    ) {
        this.waitForFrame = options.waitForFrame ?? waitForOwnerDocumentFrame;
        this.createComponent = options.createComponent ?? (() => new Component());
    }

    async renderPage(
        page: CardPage,
        options: ShareCardRenderOptions,
    ): Promise<ShareCardRenderHandle> {
        if (this.destroyed) throw new Error("Share Card renderer is closed.");

        const ownsHost = !options.host;
        const host = options.host ?? this.createCaptureHost();
        const cardEl = this.ownerDocument.createElement("div");
        cardEl.classList.add("pa-share-card", options.theme === "dark" ? "is-dark" : "is-light");

        if (options.sourceLabel) {
            const sourceEl = this.ownerDocument.createElement("div");
            sourceEl.classList.add("pa-share-card-source");
            sourceEl.textContent = options.sourceLabel;
            cardEl.appendChild(sourceEl);
        }

        const bodyEl = this.ownerDocument.createElement("div");
        bodyEl.classList.add("pa-share-card-body");
        cardEl.appendChild(bodyEl);

        const footerEl = this.ownerDocument.createElement("div");
        footerEl.classList.add("pa-share-card-footer");
        const dividerEl = this.ownerDocument.createElement("div");
        dividerEl.classList.add("pa-share-card-divider");
        footerEl.appendChild(dividerEl);
        const brandEl = this.ownerDocument.createElement("div");
        brandEl.classList.add("pa-share-card-brand");
        brandEl.textContent = "PA · Personal Assistant";
        footerEl.appendChild(brandEl);
        if (page.totalPages > 1) {
            const pageNumberEl = this.ownerDocument.createElement("div");
            pageNumberEl.classList.add("pa-share-card-page-number");
            pageNumberEl.textContent = `${page.pageIndex + 1} / ${page.totalPages}`;
            footerEl.appendChild(pageNumberEl);
        }
        cardEl.appendChild(footerEl);

        const renderComponent = this.createComponent();
        let component: Component | null = renderComponent;
        let usedPlainTextFallback = false;
        let cleaned = false;
        let cancelPending = (): void => undefined;
        const cancelled = new Promise<false>((resolve) => {
            cancelPending = () => resolve(false);
        });
        const awaitWhileActive = async (pending: void | PromiseLike<void>): Promise<void> => {
            const completed = await Promise.race([
                Promise.resolve(pending).then(() => true as const),
                cancelled,
            ]);
            if (!completed) throw new ShareCardRenderCancelledError();
        };
        const handle: ShareCardRenderHandle = {
            cardEl,
            bodyEl,
            get usedPlainTextFallback() {
                return usedPlainTextFallback;
            },
            fits(tolerance = DEFAULT_FIT_TOLERANCE) {
                return bodyEl.scrollHeight <= bodyEl.clientHeight + tolerance;
            },
            cleanup: () => {
                if (cleaned) return;
                cleaned = true;
                cancelPending();
                component?.unload();
                component = null;
                cardEl.remove();
                if (ownsHost) host.remove();
                this.activeRenders.delete(handle);
            },
        };
        this.activeRenders.add(handle);

        const assertActive = (): void => {
            if (this.destroyed || cleaned) throw new ShareCardRenderCancelledError();
        };

        try {
            renderComponent.load();
            try {
                await awaitWhileActive(MarkdownRenderer.render(
                    this.app,
                    page.content,
                    bodyEl,
                    options.sourcePath ?? "",
                    renderComponent,
                ));
                assertActive();
            } catch {
                if (this.destroyed || cleaned) throw new ShareCardRenderCancelledError();
                if (component === renderComponent) {
                    renderComponent.unload();
                    component = null;
                }
                clearElement(bodyEl);
                const fallbackEl = this.ownerDocument.createElement("pre");
                fallbackEl.classList.add("pa-share-card-body-fallback");
                fallbackEl.textContent = page.content;
                bodyEl.appendChild(fallbackEl);
                usedPlainTextFallback = true;
            }

            // Keep untrusted rendered content detached until every element and
            // resource-bearing attribute has been made inert.
            pruneNonTextContent(bodyEl);
            assertActive();
            host.appendChild(cardEl);
            await awaitWhileActive(this.waitForFrame(this.ownerDocument));
            assertActive();
            return handle;
        } catch (error) {
            handle.cleanup();
            throw error;
        }
    }

    async fits(
        content: string,
        pageIndex: number,
        options: Omit<ShareCardRenderOptions, "host">,
        tolerance = DEFAULT_FIT_TOLERANCE,
    ): Promise<boolean> {
        const handle = await this.renderPage({
            content,
            pageIndex,
            totalPages: Math.max(1, pageIndex + 1),
        }, options);
        try {
            return handle.fits(tolerance);
        } finally {
            handle.cleanup();
        }
    }

    cleanup(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        for (const render of [...this.activeRenders]) render.cleanup();
    }

    private createCaptureHost(): HTMLElement {
        const host = this.ownerDocument.createElement("div");
        host.classList.add("pa-share-card-capture-host");
        host.setAttribute("aria-hidden", "true");
        host.setAttribute("inert", "");
        const parent = this.ownerDocument.body ?? this.ownerDocument.documentElement;
        if (!parent) throw new Error("Share Card owner document has no mount point.");
        parent.appendChild(host);
        return host;
    }
}

export function pruneNonTextContent(bodyEl: HTMLElement): void {
    preserveTaskListState(bodyEl);

    // Class-based processors such as embeds and diagrams must be recognized
    // before the attribute allowlist removes their identifying class names.
    for (const element of Array.from(bodyEl.querySelectorAll(PRUNED_SELECTOR))) {
        element.remove();
    }

    for (const element of Array.from(bodyEl.querySelectorAll("*"))) {
        const tagName = element.tagName.toLowerCase();
        if (!TEXT_ELEMENT_ALLOWLIST.has(tagName)) {
            element.replaceWith(...Array.from(element.childNodes));
            continue;
        }

        const elementAllowlist = ELEMENT_ATTRIBUTE_ALLOWLIST[tagName];
        for (const attributeName of element.getAttributeNames()) {
            const normalizedName = attributeName.toLowerCase();
            if (
                !GLOBAL_ATTRIBUTE_ALLOWLIST.has(normalizedName)
                && !elementAllowlist?.has(normalizedName)
            ) {
                element.removeAttribute(attributeName);
            }
        }
    }
}

function preserveTaskListState(bodyEl: HTMLElement): void {
    for (const element of Array.from(bodyEl.querySelectorAll("input"))) {
        const input = element as HTMLInputElement;
        const type = (input.getAttribute("type") ?? input.type).toLowerCase();
        const isTaskCheckbox = type === "checkbox" && (
            input.classList.contains("task-list-item-checkbox")
            || input.parentElement?.classList.contains("task-list-item")
        );
        if (!isTaskCheckbox) continue;

        const marker = bodyEl.ownerDocument.createElement("span");
        marker.textContent = input.checked || input.getAttribute("checked") !== null
            ? "[x] "
            : "[ ] ";
        input.replaceWith(marker);
    }
}

function clearElement(element: HTMLElement): void {
    while (element.firstChild) element.removeChild(element.firstChild);
}

function waitForOwnerDocumentFrame(ownerDocument: Document): Promise<void> {
    const ownerWindow = ownerDocument.defaultView;
    if (ownerWindow && typeof ownerWindow.requestAnimationFrame === "function") {
        return new Promise((resolve) => ownerWindow.requestAnimationFrame(() => resolve()));
    }
    return Promise.resolve();
}
