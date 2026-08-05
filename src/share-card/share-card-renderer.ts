/* Copyright 2023 edonyzpc */

import { Component, MarkdownRenderer, type App } from "obsidian";
import {
    applyShareCardReferenceDefinitionContext,
    createShareCardFragmentBoundaryPlan,
    createShareCardReferenceDefinitionContext,
    isPureShareCardVisualBlock,
    type ShareCardFitContext,
    type ShareCardFitPredicate,
} from "./share-card-paginator";
import {
    attachShareCardRenderPlan,
    type CardPage,
    type ShareCardRenderPlan,
    type ShareCardRenderPlanSegment,
    type ShareCardTheme,
} from "./share-card-types";

const HARD_REMOVED_SELECTOR = ["script", "style", "link", "base", "meta"].join(",");
const PLACEHOLDER_SELECTOR = [
    "iframe",
    "object",
    "embed",
    "audio",
    "video",
    "button",
    "input",
    "select",
    "textarea",
].join(",");

const SAFE_HTML_ELEMENTS = new Set([
    "a", "abbr", "b", "bdi", "bdo", "blockquote", "br", "canvas", "code",
    "col", "colgroup", "dd", "del", "div", "dl", "dt", "em", "figure",
    "figcaption", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img",
    "kbd", "li", "mark", "ol", "p", "picture", "pre", "q", "s", "samp",
    "small", "source", "span", "strong", "sub", "sup", "table", "tbody", "td",
    "tfoot", "th", "thead", "time", "tr", "u", "ul", "var", "wbr",
]);

const SAFE_SVG_ELEMENTS = new Set([
    "a", "circle", "clipPath", "defs", "desc", "ellipse", "feBlend",
    "feColorMatrix", "feComponentTransfer", "feComposite", "feConvolveMatrix",
    "feDiffuseLighting", "feDisplacementMap", "feDistantLight", "feDropShadow",
    "feFlood", "feFuncA", "feFuncB", "feFuncG", "feFuncR", "feGaussianBlur",
    "feImage", "feMerge", "feMergeNode", "feMorphology", "feOffset",
    "fePointLight", "feSpecularLighting", "feSpotLight", "feTile", "feTurbulence",
    "filter", "foreignObject", "g", "image", "line", "linearGradient", "marker", "mask", "metadata",
    "path", "pattern", "polygon", "polyline", "radialGradient", "rect", "stop",
    "svg", "symbol", "text", "textPath", "title", "tspan", "use", "view",
].map((tagName) => tagName.toLowerCase()));

const SAFE_GLOBAL_ATTRIBUTES = new Set([
    "aria-hidden", "aria-label", "dir", "lang", "role", "title",
]);
const SAFE_HTML_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
    canvas: new Set(["height", "width"]),
    col: new Set(["span"]),
    colgroup: new Set(["span"]),
    img: new Set(["alt", "decoding", "height", "src", "width"]),
    li: new Set(["value"]),
    ol: new Set(["reversed", "start", "type"]),
    source: new Set(["height", "media", "src", "type", "width"]),
    td: new Set(["colspan", "rowspan"]),
    th: new Set(["colspan", "rowspan", "scope"]),
    time: new Set(["datetime"]),
};
const SAFE_VISUAL_CLASSES = [
    "block-language-mermaid",
    "image-embed",
    "internal-embed",
    "media-embed",
    "mermaid",
];
const RESOURCE_ATTRIBUTE_NAMES = new Set([
    "background", "href", "imagesrcset", "poster", "src", "srcset", "xlink:href",
]);
const URL_FUNCTION_RE = /url\(\s*(["']?)(.*?)\1\s*\)/gi;
const SAFE_IMAGE_DATA_URI_RE = /^data:image\/(?:gif|jpeg|png|svg\+xml|webp)(?:;[^,]*)?,/i;

const DEFAULT_FIT_TOLERANCE = 1;
const DEFAULT_READINESS_TIMEOUT_MS = 5_000;
const MAX_LAYOUT_SETTLE_FRAMES = 4;
const MAX_PROTOTYPE_CACHE_ENTRIES = 32;

export interface ShareCardRenderOptions {
    theme: ShareCardTheme;
    sourceLabel?: string;
    sourcePath?: string;
    host?: HTMLElement;
}

export type ShareCardSanitizationReason =
    | "decode-failed"
    | "external-resource-remains"
    | "unsafe-canvas"
    | "unsafe-element"
    | "unsafe-style";

export interface ShareCardSanitizationIssue {
    tagName: string;
    reason: ShareCardSanitizationReason;
}

export interface ShareCardRenderHandle {
    readonly cardEl: HTMLElement;
    readonly bodyEl: HTMLElement;
    readonly signal: AbortSignal;
    readonly sanitizationIssues: readonly ShareCardSanitizationIssue[];
    readonly usedPlainTextFallback: boolean;
    fits(tolerance?: number): boolean;
    cleanup(): void;
}

export interface ShareCardPreparedCompletenessSummary {
    sanitizationIssueCount: number;
    usedPlainTextFallback: boolean;
}

export interface ShareCardRendererOptions {
    waitForFrame?: (ownerDocument: Document) => Promise<void>;
    createComponent?: () => Component;
    readinessTimeoutMs?: number;
}

interface ShareCardRenderPrototype {
    bodyEl: HTMLElement;
    component: Component | null;
    sanitizationIssues: ShareCardSanitizationIssue[];
    usedPlainTextFallback: boolean;
    sourceBoundaries: ReadonlyMap<number, ShareCardStaticDomBoundary>;
    sourceOnlyTestFallback: boolean;
}

interface PreparedShareCardBlock {
    source: string;
    prototype: ShareCardRenderPrototype;
}

export interface ShareCardStaticDomBoundary {
    nodePath: readonly number[];
    offset: number;
}

export interface ShareCardVirtualDomBoundary {
    edge: "start" | "end";
    sourceOffset: number;
}

interface ShareCardBoundarySentinel {
    insertionOffset: number;
    kind: "element" | "literal";
    marker: string;
    snap?: "list-item-start";
    sourceOffset: number;
    token: string;
}

interface ShareCardBoundaryInstrumentation {
    markdown: string;
    sentinels: readonly ShareCardBoundarySentinel[];
    virtualBoundaries: readonly ShareCardVirtualDomBoundary[];
}

interface ShareCardPrototypeLease {
    prototype: ShareCardRenderPrototype;
    release(): void;
}

interface LayoutSize {
    clientHeight: number;
    clientWidth: number;
    scrollHeight: number;
}

export class ShareCardRenderCancelledError extends Error {
    constructor() {
        super("Share Card render was cancelled.");
        this.name = "ShareCardRenderCancelledError";
    }
}

export class ShareCardRenderReadinessError extends Error {
    constructor(message = "Share Card visual readiness timed out.") {
        super(message);
        this.name = "ShareCardRenderReadinessError";
    }
}

export class ShareCardUnsafeResourceError extends Error {
    constructor() {
        super("Share Card contains a non-local visual resource.");
        this.name = "ShareCardUnsafeResourceError";
    }
}

/**
 * Owns the stabilized visual prototypes and fixed-size card clones created by
 * one Modal. A prototype is rendered exactly once for a content/appearance key;
 * pagination probes, preview and export clone it without rerunning processors.
 */
export class ShareCardRenderer {
    private readonly activeRenders = new Set<ShareCardRenderHandle>();
    private readonly prototypeCache = new Map<string, Promise<ShareCardRenderPrototype>>();
    private readonly ownedPrototypes = new Set<ShareCardRenderPrototype>();
    private preparedBlocks: PreparedShareCardBlock[] | null = null;
    private preparedAppearanceKey: string | null = null;
    private preparedFinalPageUsedPlainTextFallback = false;
    private readonly constrainedPreparedPages = new Set<string>();
    private readonly waitForFrame: (ownerDocument: Document) => Promise<void>;
    private readonly createComponent: () => Component;
    private readonly readinessTimeoutMs: number;
    private readonly lifecycleController = new AbortController();
    private readonly cancelled: Promise<false>;
    private cancelPending = (): void => undefined;
    private destroyed = false;

    constructor(
        private readonly app: App,
        private readonly ownerDocument: Document,
        options: ShareCardRendererOptions = {},
    ) {
        this.waitForFrame = options.waitForFrame ?? waitForOwnerDocumentFrame;
        this.createComponent = options.createComponent ?? (() => new Component());
        this.readinessTimeoutMs = options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
        this.cancelled = new Promise<false>((resolve) => {
            this.cancelPending = () => resolve(false);
        });
    }

    async renderPage(
        page: CardPage,
        options: ShareCardRenderOptions,
    ): Promise<ShareCardRenderHandle> {
        this.assertActive();
        const preparedPrototype = this.createPreparedPagePrototype(page, options);
        const lease = preparedPrototype
            ? { prototype: preparedPrototype, release: () => undefined }
            : await this.acquirePrototype(page, options);
        const prototype = lease.prototype;
        this.assertActive();

        const ownsHost = !options.host;
        const host = options.host ?? this.createCaptureHost();
        let bodyEl: HTMLElement;
        try {
            bodyEl = cloneElement(prototype.bodyEl, this.ownerDocument);
        } finally {
            lease.release();
        }
        // Defence in depth: only a previously audited, self-contained clone is
        // allowed to enter the Modal document.
        if (auditVisualResourceUris(bodyEl).length > 0) {
            if (ownsHost) host.remove();
            throw new ShareCardUnsafeResourceError();
        }
        const cardEl = this.createCardElement(page, options, bodyEl);
        const handleController = new AbortController();
        let cleaned = false;
        const handle: ShareCardRenderHandle = {
            cardEl,
            bodyEl,
            signal: handleController.signal,
            sanitizationIssues: [...prototype.sanitizationIssues],
            usedPlainTextFallback: prototype.usedPlainTextFallback,
            fits(tolerance = DEFAULT_FIT_TOLERANCE) {
                return bodyEl.scrollHeight <= bodyEl.clientHeight + tolerance;
            },
            cleanup: () => {
                if (cleaned) return;
                cleaned = true;
                handleController.abort();
                cardEl.remove();
                if (ownsHost) host.remove();
                this.activeRenders.delete(handle);
            },
        };
        this.activeRenders.add(handle);
        if (this.destroyed) {
            handle.cleanup();
            throw new ShareCardRenderCancelledError();
        }
        host.appendChild(cardEl);
        return handle;
    }

    async fits(
        content: string,
        pageIndex: number,
        options: Omit<ShareCardRenderOptions, "host">,
        tolerance = DEFAULT_FIT_TOLERANCE,
        renderPlan?: ShareCardRenderPlan,
    ): Promise<boolean> {
        const page = {
            content,
            pageIndex,
            totalPages: Math.max(1, pageIndex + 1),
        };
        if (renderPlan) attachShareCardRenderPlan(page, renderPlan);
        const handle = await this.renderPage(page, options);
        try {
            if (handle.fits(tolerance)) return true;
            if (
                this.hasPreparedAppearance(options)
                && this.isPreparedSingleVisual(page)
            ) {
                markVisualBlockOwners(handle.bodyEl);
                await this.waitForFrame(this.ownerDocument);
                this.assertActive();
                if (handle.fits(tolerance)) {
                    this.constrainedPreparedPages.add(preparedPageKey(page));
                    return true;
                }
            }
            return false;
        } finally {
            handle.cleanup();
        }
    }

    /**
     * Render every semantic input block once, then retain only inert static DOM.
     * Pagination, preview and export compose clones from this bounded input set.
     */
    createPreparedFitPredicate(
        blocks: readonly string[],
        options: Omit<ShareCardRenderOptions, "host">,
    ): ShareCardFitPredicate {
        const preparation = this.prepareBlocks(blocks, options);
        void preparation.catch(() => undefined);
        return async (content, pageIndex, context?: ShareCardFitContext) => {
            await preparation;
            return this.fits(
                content,
                pageIndex,
                options,
                DEFAULT_FIT_TOLERANCE,
                context?.renderPlan,
            );
        };
    }

    /** Read-only aggregate over the once-rendered semantic prototypes. */
    getPreparedCompletenessSummary(): ShareCardPreparedCompletenessSummary {
        const blocks = this.preparedBlocks;
        if (!blocks) {
            return { sanitizationIssueCount: 0, usedPlainTextFallback: false };
        }
        return blocks.reduce<ShareCardPreparedCompletenessSummary>((summary, block) => ({
            sanitizationIssueCount: summary.sanitizationIssueCount
                + block.prototype.sanitizationIssues.length,
            usedPlainTextFallback: summary.usedPlainTextFallback
                || block.prototype.usedPlainTextFallback,
        }), {
            sanitizationIssueCount: 0,
            usedPlainTextFallback: this.preparedFinalPageUsedPlainTextFallback,
        });
    }

    /** Record final static page compositions without rerunning Markdown processors. */
    recordPreparedFinalPages(
        pages: readonly CardPage[],
        options: Omit<ShareCardRenderOptions, "host">,
    ): void {
        this.preparedFinalPageUsedPlainTextFallback = false;
        if (!this.hasPreparedAppearance(options)) return;
        for (const page of pages) {
            const prototype = this.createPreparedPagePrototype(page, options);
            if (!prototype) continue;
            this.preparedFinalPageUsedPlainTextFallback ||= prototype.usedPlainTextFallback;
            prototype.bodyEl.remove();
        }
    }

    async prepareBlocks(
        blocks: readonly string[],
        options: Omit<ShareCardRenderOptions, "host">,
    ): Promise<void> {
        this.assertActive();
        this.releasePreparedBlocks();
        const semanticBlocks = blocks.filter((block) => block.trim().length > 0);
        const referenceContext = createShareCardReferenceDefinitionContext(semanticBlocks);
        const sentinelPrefix = createCollisionFreeSentinelPrefix(semanticBlocks);
        const prepared: PreparedShareCardBlock[] = [];
        try {
            for (let blockIndex = 0; blockIndex < semanticBlocks.length; blockIndex += 1) {
                const source = semanticBlocks[blockIndex]!;
                this.assertActive();
                const contextualMarkdown = applyShareCardReferenceDefinitionContext(
                    source,
                    referenceContext,
                );
                const boundaryPlan = createShareCardFragmentBoundaryPlan(
                    source,
                    semanticBlocks[blockIndex - 1],
                );
                const instrumentation = instrumentShareCardBoundaries(
                    contextualMarkdown,
                    boundaryPlan,
                    `${sentinelPrefix}${blockIndex}-`,
                );
                const prototype = await this.createPrototype({
                    content: instrumentation.markdown,
                    pageIndex: 0,
                    totalPages: 1,
                }, options, false, source, instrumentation);
                prepared.push({ source, prototype });
            }
        } catch (error) {
            for (const block of prepared) this.disposePrototype(block.prototype);
            throw error;
        }
        this.preparedBlocks = prepared;
        this.preparedAppearanceKey = appearanceKey(options);
        this.constrainedPreparedPages.clear();
    }

    cleanup(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.lifecycleController.abort();
        this.cancelPending();
        for (const render of [...this.activeRenders]) render.cleanup();
        this.preparedBlocks = null;
        this.preparedAppearanceKey = null;
        this.preparedFinalPageUsedPlainTextFallback = false;
        for (const prototype of [...this.ownedPrototypes]) this.disposePrototype(prototype);
        this.ownedPrototypes.clear();
        this.prototypeCache.clear();
    }

    private async acquirePrototype(
        page: CardPage,
        options: ShareCardRenderOptions,
    ): Promise<ShareCardPrototypeLease> {
        const key = JSON.stringify([
            page.content,
            options.theme,
            options.sourceLabel ?? "",
            options.sourcePath ?? "",
        ]);
        const cached = this.prototypeCache.get(key);
        if (cached) {
            return { prototype: await cached, release: () => undefined };
        }

        if (this.prototypeCache.size >= MAX_PROTOTYPE_CACHE_ENTRIES) {
            const prototype = await this.createPrototype(page, options);
            return {
                prototype,
                release: () => this.disposePrototype(prototype),
            };
        }

        const pending = this.createPrototype(page, options);
        this.prototypeCache.set(key, pending);
        void pending.catch(() => {
            if (this.prototypeCache.get(key) === pending) this.prototypeCache.delete(key);
        });
        return { prototype: await pending, release: () => undefined };
    }

    private async createPrototype(
        page: CardPage,
        options: ShareCardRenderOptions,
        retainComponent = true,
        plainTextFallbackContent = page.content,
        boundaryInstrumentation?: ShareCardBoundaryInstrumentation,
    ): Promise<ShareCardRenderPrototype> {
        const deadline = Date.now() + this.readinessTimeoutMs;
        const host = this.createCaptureHost();
        const bodyEl = this.ownerDocument.createElement("div");
        bodyEl.classList.add("pa-share-card-body", "pa-share-card-static");
        const cardEl = this.createCardElement(page, options, bodyEl);
        const renderComponent = this.createComponent();
        const prototypeController = new AbortController();
        let component: Component | null = renderComponent;
        let usedPlainTextFallback = false;
        const sanitizationIssues: ShareCardSanitizationIssue[] = [];
        const connectedMermaidStage = isSafeStandaloneMermaidMarkdown(
            plainTextFallbackContent,
        );
        let sourceBoundaries = new Map<number, ShareCardStaticDomBoundary>();
        let sourceOnlyTestFallback = false;

        try {
            renderComponent.load();
            if (connectedMermaidStage) host.appendChild(cardEl);
            try {
                await this.awaitActive(MarkdownRenderer.render(
                    this.app,
                    page.content,
                    bodyEl,
                    options.sourcePath ?? "",
                    renderComponent,
                ), deadline);
            } catch (error) {
                if (
                    error instanceof ShareCardRenderCancelledError
                    || error instanceof ShareCardRenderReadinessError
                ) {
                    throw error;
                }
                if (markdownContainsApprovedVisual(page.content)) {
                    throw new ShareCardRenderReadinessError(
                        "Share Card visual Markdown could not be rendered.",
                    );
                }
                renderComponent.unload();
                component = null;
                clearElement(bodyEl);
                const fallbackEl = this.ownerDocument.createElement("pre");
                fallbackEl.classList.add("pa-share-card-body-fallback");
                fallbackEl.textContent = plainTextFallbackContent;
                bodyEl.appendChild(fallbackEl);
                usedPlainTextFallback = true;
            }

            const elementSentinels = boundaryInstrumentation
                ? captureBoundarySentinelElements(bodyEl, boundaryInstrumentation)
                : new Map<number, Element>();
            sanitizationIssues.push(...sanitizeShareCardContent(bodyEl));
            if (boundaryInstrumentation) {
                const extraction = extractShareCardBoundaries(
                    bodyEl,
                    boundaryInstrumentation,
                    elementSentinels,
                    this.ownerDocument,
                );
                sourceBoundaries = extraction.boundaries;
                sourceOnlyTestFallback = extraction.sourceOnlyTestFallback;
            }
            if (auditVisualResourceUris(bodyEl).length > 0) {
                throw new ShareCardUnsafeResourceError();
            }
            this.assertActive();
            if (!connectedMermaidStage) host.appendChild(cardEl);
            await this.waitForImages(
                bodyEl,
                sanitizationIssues,
                deadline,
                prototypeController.signal,
            );
            await this.waitForFonts(deadline);
            await this.waitForStableLayout(bodyEl, deadline);
            this.assertActive();

            const prototypeBodyEl = retainComponent
                ? bodyEl
                : cloneElement(bodyEl, this.ownerDocument);
            if (!retainComponent && auditVisualResourceUris(prototypeBodyEl).length > 0) {
                throw new ShareCardUnsafeResourceError();
            }
            if (!retainComponent) {
                component?.unload();
                component = null;
            }
            const prototype: ShareCardRenderPrototype = {
                bodyEl: prototypeBodyEl,
                component,
                sanitizationIssues,
                usedPlainTextFallback,
                sourceBoundaries,
                sourceOnlyTestFallback,
            };
            component = null;
            cardEl.remove();
            this.ownedPrototypes.add(prototype);
            return prototype;
        } finally {
            prototypeController.abort();
            component?.unload();
            cardEl.remove();
            host.remove();
        }
    }

    private async waitForImages(
        bodyEl: HTMLElement,
        issues: ShareCardSanitizationIssue[],
        deadline: number,
        signal: AbortSignal,
    ): Promise<void> {
        const images = Array.from(bodyEl.querySelectorAll("img")) as HTMLImageElement[];
        await Promise.all(images.map(async (image) => {
            try {
                if (typeof image.decode === "function") {
                    await this.awaitActive(image.decode(), deadline);
                } else if (image.complete === false) {
                    await this.awaitActive(waitForImageLoad(image, signal), deadline);
                }
            } catch (error) {
                if (
                    error instanceof ShareCardRenderCancelledError
                    || error instanceof ShareCardRenderReadinessError
                ) {
                    throw error;
                }
                issues.push({ tagName: "img", reason: "decode-failed" });
                replaceWithPlaceholder(image, "Image unavailable");
            }
        }));
    }

    private async waitForFonts(deadline: number): Promise<void> {
        const fonts = this.ownerDocument.fonts;
        if (fonts?.ready) await this.awaitActive(fonts.ready.then(() => undefined), deadline);
    }

    private async waitForStableLayout(bodyEl: HTMLElement, deadline: number): Promise<void> {
        await this.awaitActive(this.waitForFrame(this.ownerDocument), deadline);
        let previous = measureLayout(bodyEl);
        for (let frame = 1; frame < MAX_LAYOUT_SETTLE_FRAMES; frame += 1) {
            await this.awaitActive(this.waitForFrame(this.ownerDocument), deadline);
            const next = measureLayout(bodyEl);
            if (sameLayout(previous, next)) return;
            previous = next;
        }
        throw new ShareCardRenderReadinessError("Share Card visual layout did not stabilize.");
    }

    private async awaitActive<T>(pending: PromiseLike<T> | T, deadline: number): Promise<T> {
        this.assertActive();
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new ShareCardRenderReadinessError();

        let timer: ReturnType<typeof setTimeout> | undefined;
        const timedOut = new Promise<"timeout">((resolve) => {
            timer = setTimeout(() => resolve("timeout"), remaining);
        });
        try {
            const result = await Promise.race([
                Promise.resolve(pending).then((value) => ({ type: "done" as const, value })),
                this.cancelled.then(() => ({ type: "cancelled" as const })),
                timedOut.then(() => ({ type: "timeout" as const })),
            ]);
            if (result.type === "cancelled") throw new ShareCardRenderCancelledError();
            if (result.type === "timeout") throw new ShareCardRenderReadinessError();
            return result.value;
        } finally {
            if (timer !== undefined) clearTimeout(timer);
        }
    }

    private assertActive(): void {
        if (this.destroyed || this.lifecycleController.signal.aborted) {
            throw new ShareCardRenderCancelledError();
        }
    }

    private hasPreparedAppearance(options: Omit<ShareCardRenderOptions, "host">): boolean {
        return this.preparedBlocks !== null
            && this.preparedAppearanceKey === appearanceKey(options);
    }

    private isPreparedSingleVisual(page: CardPage): boolean {
        const segments = page.renderPlan?.segments;
        if (segments) {
            if (segments.length !== 1) return false;
            const segment = segments[0]!;
            const block = this.preparedBlocks?.[segment.blockIndex];
            return Boolean(
                block
                && segment.sourceStart === 0
                && segment.sourceEnd === block.source.length
                && isPureShareCardVisualBlock(block.source),
            );
        }
        return this.preparedBlocks?.some((block) => (
            block.source === page.content && isPureShareCardVisualBlock(block.source)
        )) ?? false;
    }

    private createPreparedPagePrototype(
        page: CardPage,
        options: ShareCardRenderOptions,
    ): ShareCardRenderPrototype | null {
        if (!this.hasPreparedAppearance(options)) return null;
        const blocks = this.preparedBlocks ?? [];
        const bodyEl = this.ownerDocument.createElement("div");
        bodyEl.classList.add("pa-share-card-body", "pa-share-card-static");
        const sanitizationIssues: ShareCardSanitizationIssue[] = [];
        let usedPlainTextFallback = false;

        if (page.renderPlan) {
            const summarizedBlocks = new Set<number>();
            for (const segment of page.renderPlan.segments) {
                const block = blocks[segment.blockIndex];
                if (
                    !block
                    || segment.sourceStart < 0
                    || segment.sourceEnd <= segment.sourceStart
                    || segment.sourceEnd > block.source.length
                ) {
                    throw new ShareCardRenderReadinessError(
                        "Share Card static render plan is invalid.",
                    );
                }
                if (!appendStaticSourceRange(
                    bodyEl,
                    block,
                    segment,
                    this.ownerDocument,
                )) {
                    throw new ShareCardRenderReadinessError(
                        "Share Card static source boundary is unavailable.",
                    );
                }
                usedPlainTextFallback ||= block.prototype.sourceOnlyTestFallback
                    && (
                        segment.sourceStart !== 0
                        || segment.sourceEnd !== block.source.length
                    );
                if (summarizedBlocks.has(segment.blockIndex)) continue;
                summarizedBlocks.add(segment.blockIndex);
                sanitizationIssues.push(...block.prototype.sanitizationIssues);
                usedPlainTextFallback ||= block.prototype.usedPlainTextFallback;
            }
        } else {
            const exactBlocks = findPreparedBlockSequence(blocks, page.content);
            if (exactBlocks) {
                for (const block of exactBlocks) {
                    appendStaticBodyContents(bodyEl, block.prototype.bodyEl, this.ownerDocument);
                    sanitizationIssues.push(...block.prototype.sanitizationIssues);
                    usedPlainTextFallback ||= block.prototype.usedPlainTextFallback;
                }
            } else if (page.content.length > 0) {
                const fallbackEl = this.ownerDocument.createElement("pre");
                fallbackEl.classList.add("pa-share-card-body-fallback");
                fallbackEl.textContent = page.content;
                bodyEl.appendChild(fallbackEl);
                usedPlainTextFallback = true;
            }
        }

        if (this.constrainedPreparedPages.has(preparedPageKey(page))) {
            markVisualBlockOwners(bodyEl);
        }
        return {
            bodyEl,
            component: null,
            sanitizationIssues,
            usedPlainTextFallback,
            sourceBoundaries: new Map(),
            sourceOnlyTestFallback: false,
        };
    }

    private releasePreparedBlocks(): void {
        for (const block of this.preparedBlocks ?? []) {
            this.disposePrototype(block.prototype);
        }
        this.preparedBlocks = null;
        this.preparedAppearanceKey = null;
        this.preparedFinalPageUsedPlainTextFallback = false;
        this.constrainedPreparedPages.clear();
    }

    private disposePrototype(prototype: ShareCardRenderPrototype): void {
        if (!this.ownedPrototypes.delete(prototype)) return;
        prototype.component?.unload();
        prototype.bodyEl.remove();
    }

    private createCardElement(
        page: CardPage,
        options: ShareCardRenderOptions,
        bodyEl: HTMLElement,
    ): HTMLElement {
        const cardEl = this.ownerDocument.createElement("div");
        cardEl.classList.add(
            "pa-share-card",
            "pa-share-card-static",
            options.theme === "dark" ? "is-dark" : "is-light",
        );

        if (options.sourceLabel) {
            const sourceEl = this.ownerDocument.createElement("div");
            sourceEl.classList.add("pa-share-card-source");
            sourceEl.textContent = options.sourceLabel;
            cardEl.appendChild(sourceEl);
        }
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
        return cardEl;
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

function preparedPageKey(page: CardPage): string {
    return page.renderPlan
        ? JSON.stringify(page.renderPlan.segments.map((segment) => [
            segment.blockIndex,
            segment.sourceStart,
            segment.sourceEnd,
        ]))
        : `content:${page.content}`;
}

function appearanceKey(options: Omit<ShareCardRenderOptions, "host">): string {
    return JSON.stringify([
        options.theme,
        options.sourceLabel ?? "",
        options.sourcePath ?? "",
    ]);
}

function findPreparedBlockSequence(
    blocks: readonly PreparedShareCardBlock[],
    content: string,
): PreparedShareCardBlock[] | null {
    if (content.length === 0) return [];
    for (let start = 0; start < blocks.length; start += 1) {
        if (!content.startsWith(blocks[start]!.source)) continue;
        let candidate = "";
        for (let end = start; end < blocks.length; end += 1) {
            candidate = candidate.length > 0
                ? `${candidate}\n\n${blocks[end]!.source}`
                : blocks[end]!.source;
            if (candidate === content) return blocks.slice(start, end + 1);
            if (candidate.length >= content.length) break;
        }
    }
    return null;
}

function appendStaticBodyContents(
    destination: HTMLElement,
    source: HTMLElement,
    ownerDocument: Document,
): void {
    const sourceNodes = Array.from(source.childNodes);
    if (sourceNodes.length > 0 && sourceNodes.every((node) => (
        typeof (node as Node).cloneNode === "function"
    ))) {
        for (const node of sourceNodes) destination.appendChild(node.cloneNode(true));
        return;
    }

    // Focused test DOMs have element children but no Node.cloneNode/text nodes.
    if (source.children.length > 0) {
        for (const child of Array.from(source.children)) {
            destination.appendChild(cloneElement(child as HTMLElement, ownerDocument));
        }
    }
    const text = source.textContent ?? "";
    if (text && typeof (destination as unknown as { cloneNode?: unknown }).cloneNode !== "function") {
        destination.textContent = destination.textContent
            ? `${destination.textContent}\n\n${text}`
            : text;
    }
}

function appendStaticSourceRange(
    destination: HTMLElement,
    block: PreparedShareCardBlock,
    segment: ShareCardRenderPlanSegment,
    ownerDocument: Document,
): boolean {
    if (
        segment.sourceStart === 0
        && segment.sourceEnd === block.source.length
    ) {
        appendStaticBodyContents(destination, block.prototype.bodyEl, ownerDocument);
        return true;
    }
    if (block.prototype.sourceOnlyTestFallback) {
        destination.textContent = destination.textContent
            ? `${destination.textContent}\n\n${segment.markdown}`
            : segment.markdown;
        return true;
    }
    return appendShareCardStaticDomRange(
        destination,
        block.prototype.bodyEl,
        block.prototype.sourceBoundaries,
        segment.sourceStart,
        segment.sourceEnd,
        block.source.length,
        ownerDocument,
    );
}

function createCollisionFreeSentinelPrefix(blocks: readonly string[]): string {
    let attempt = 0;
    while (true) {
        const prefix = `pa-share-static-boundary-${attempt}-`;
        if (blocks.every((block) => !block.includes(prefix))) return prefix;
        attempt += 1;
    }
}

function instrumentShareCardBoundaries(
    markdown: string,
    plan: ReturnType<typeof createShareCardFragmentBoundaryPlan>,
    prefix: string,
): ShareCardBoundaryInstrumentation {
    if (!plan) return { markdown, sentinels: [], virtualBoundaries: [] };
    const insertions = plan.insertions
        .filter(({ insertionOffset, sourceOffset }) => (
            insertionOffset >= 0
            && insertionOffset <= markdown.length
            && sourceOffset >= 0
        ))
        .sort((left, right) => left.sourceOffset - right.sourceOffset);
    const sentinels = insertions.map<ShareCardBoundarySentinel>((insertion, index) => {
        const token = `${prefix}${index}`;
        const kind = insertion.kind;
        const literal = `\uE000${token}\uE001`;
        return {
            kind,
            insertionOffset: insertion.insertionOffset,
            sourceOffset: insertion.sourceOffset,
            token,
            marker: kind === "element"
                ? `<span data-pa-share-boundary="${token}"></span>`
                : literal,
            snap: insertion.snap,
        };
    });
    let instrumented = markdown;
    for (const sentinel of [...sentinels].reverse()) {
        instrumented = instrumented.slice(0, sentinel.insertionOffset)
            + sentinel.marker
            + instrumented.slice(sentinel.insertionOffset);
    }
    return {
        markdown: instrumented,
        sentinels,
        virtualBoundaries: plan.virtualBoundaries ?? [],
    };
}

function captureBoundarySentinelElements(
    bodyEl: HTMLElement,
    instrumentation: ShareCardBoundaryInstrumentation,
): Map<number, Element> {
    const byToken = new Map<string, Element>();
    for (const element of Array.from(bodyEl.querySelectorAll("span"))) {
        const token = element.getAttribute("data-pa-share-boundary");
        if (token) byToken.set(token, element);
    }
    const result = new Map<number, Element>();
    for (const sentinel of instrumentation.sentinels) {
        if (sentinel.kind !== "element") continue;
        const element = byToken.get(sentinel.token);
        if (element) result.set(sentinel.sourceOffset, element);
    }
    return result;
}

function extractShareCardBoundaries(
    bodyEl: HTMLElement,
    instrumentation: ShareCardBoundaryInstrumentation,
    elementSentinels: ReadonlyMap<number, Element>,
    ownerDocument: Document,
): {
    boundaries: Map<number, ShareCardStaticDomBoundary>;
    sourceOnlyTestFallback: boolean;
} {
    if (
        instrumentation.sentinels.length === 0
        && instrumentation.virtualBoundaries.length === 0
    ) {
        return { boundaries: new Map(), sourceOnlyTestFallback: false };
    }
    if (
        typeof ownerDocument.createRange !== "function"
        || typeof ownerDocument.createTreeWalker !== "function"
    ) {
        for (const element of elementSentinels.values()) element.remove();
        let text = bodyEl.textContent ?? "";
        for (const sentinel of instrumentation.sentinels) {
            text = text.split(sentinel.marker).join("");
        }
        bodyEl.textContent = text;
        return { boundaries: new Map(), sourceOnlyTestFallback: true };
    }

    const liveBoundaries = new Map<number, { node: Node; offset: number }>();
    const snappedBoundaries = new Map<number, ShareCardStaticDomBoundary>();
    for (const sentinel of instrumentation.sentinels) {
        if (sentinel.kind === "element") {
            const element = elementSentinels.get(sentinel.sourceOffset);
            const parent = element?.parentNode;
            if (!element || !parent || !nodeIsWithin(bodyEl, parent)) {
                throw new ShareCardRenderReadinessError(
                    "Share Card Markdown boundary marker was not preserved.",
                );
            }
            const snapped = sentinel.snap === "list-item-start"
                ? resolveShareCardListItemStartDomBoundary(bodyEl, element)
                : null;
            if (sentinel.snap && !snapped) {
                throw new ShareCardRenderReadinessError(
                    "Share Card task boundary could not be mapped to its list item.",
                );
            }
            const offset = Array.from(parent.childNodes).indexOf(element);
            if (offset < 0) {
                throw new ShareCardRenderReadinessError(
                    "Share Card Markdown boundary marker was detached.",
                );
            }
            element.remove();
            if (snapped) {
                snappedBoundaries.set(sentinel.sourceOffset, snapped);
                continue;
            }
            const boundary = canonicalizeDomBoundary(bodyEl, parent, offset);
            if (!boundary) {
                throw new ShareCardRenderReadinessError(
                    "Share Card Markdown boundary could not be normalized.",
                );
            }
            liveBoundaries.set(sentinel.sourceOffset, boundary);
            continue;
        }

        const boundary = removeLiteralBoundarySentinel(
            bodyEl,
            sentinel.marker,
            ownerDocument,
        );
        if (!boundary) {
            throw new ShareCardRenderReadinessError(
                "Share Card code boundary marker was not preserved.",
            );
        }
        const canonical = canonicalizeDomBoundary(
            bodyEl,
            boundary.node,
            boundary.offset,
        );
        if (!canonical) {
            throw new ShareCardRenderReadinessError(
                "Share Card code boundary could not be normalized.",
            );
        }
        liveBoundaries.set(sentinel.sourceOffset, canonical);
    }

    const boundaries = new Map<number, ShareCardStaticDomBoundary>(snappedBoundaries);
    for (const [sourceOffset, boundary] of liveBoundaries) {
        const nodePath = pathFromRoot(bodyEl, boundary.node);
        if (!nodePath) {
            throw new ShareCardRenderReadinessError(
                "Share Card static boundary left the rendered block.",
            );
        }
        boundaries.set(sourceOffset, { nodePath, offset: boundary.offset });
    }
    for (const [sourceOffset, boundary] of createShareCardVirtualDomBoundaries(
        bodyEl,
        instrumentation.virtualBoundaries,
    )) {
        boundaries.set(sourceOffset, boundary);
    }
    for (const sentinel of instrumentation.sentinels) {
        if ((bodyEl.textContent ?? "").includes(sentinel.token)) {
            throw new ShareCardRenderReadinessError(
                "Share Card boundary marker cleanup was incomplete.",
            );
        }
    }
    return { boundaries, sourceOnlyTestFallback: false };
}

/** @internal Map fence-body edges without changing Markdown processor input. */
export function createShareCardVirtualDomBoundaries(
    bodyEl: HTMLElement,
    virtualBoundaries: readonly ShareCardVirtualDomBoundary[],
): Map<number, ShareCardStaticDomBoundary> {
    const boundaries = new Map<number, ShareCardStaticDomBoundary>();
    for (const boundary of virtualBoundaries) {
        boundaries.set(boundary.sourceOffset, {
            nodePath: [],
            offset: boundary.edge === "start" ? 0 : bodyEl.childNodes.length,
        });
    }
    return boundaries;
}

function boundaryBeforeListItem(
    root: HTMLElement,
    marker: Element,
): { node: Node; offset: number } | null {
    let listItem: Element | null = marker;
    while (
        listItem
        && listItem !== root
        && listItem.tagName.toLowerCase() !== "li"
    ) {
        listItem = listItem.parentElement;
    }
    if (!listItem || listItem === root || !listItem.parentNode) return null;
    const parent = listItem.parentNode;
    if (!nodeIsWithin(root, parent)) return null;
    const offset = Array.from(parent.childNodes).indexOf(listItem);
    return offset >= 0 ? { node: parent, offset } : null;
}

/** @internal Resolve a list split and lift empty-container edges to the body. */
export function resolveShareCardListItemStartDomBoundary(
    root: HTMLElement,
    marker: Element,
): ShareCardStaticDomBoundary | null {
    const beforeListItem = boundaryBeforeListItem(root, marker);
    if (!beforeListItem) return null;
    const canonical = canonicalizeDomBoundary(
        root,
        beforeListItem.node,
        beforeListItem.offset,
    );
    if (!canonical) return null;
    const nodePath = pathFromRoot(root, canonical.node);
    return nodePath ? { nodePath, offset: canonical.offset } : null;
}

function canonicalizeDomBoundary(
    root: Node,
    initialNode: Node,
    initialOffset: number,
): { node: Node; offset: number } | null {
    let node = initialNode;
    let offset = initialOffset;
    while (node !== root) {
        const length = node.nodeType === 3
            ? (node as Text).data.length
            : node.childNodes.length;
        if (offset !== 0 && offset !== length) break;
        const parent = node.parentNode;
        if (!parent) return null;
        const nodeIndex = Array.from(parent.childNodes).indexOf(node as ChildNode);
        if (nodeIndex < 0) return null;
        offset = offset === 0 ? nodeIndex : nodeIndex + 1;
        node = parent;
    }
    return nodeIsWithin(root, node) ? { node, offset } : null;
}

function removeLiteralBoundarySentinel(
    root: HTMLElement,
    marker: string,
    ownerDocument: Document,
): { node: Node; offset: number } | null {
    const nodeFilter = ownerDocument.defaultView?.NodeFilter?.SHOW_TEXT ?? 4;
    const walker = ownerDocument.createTreeWalker(root, nodeFilter);
    const textNodes: Text[] = [];
    let node = walker.nextNode();
    while (node) {
        const textNode = node as Text;
        textNodes.push(textNode);
        node = walker.nextNode();
    }
    const located = locateShareCardSentinelTextRange(
        textNodes.map((textNode) => textNode.data),
        marker,
    );
    if (!located) return null;
    const start = {
        node: textNodes[located.startNodeIndex]!,
        offset: located.startOffset,
    };
    const end = {
        node: textNodes[located.endNodeIndex]!,
        offset: located.endOffset,
    };
    if (!start || !end || typeof ownerDocument.createComment !== "function") return null;

    const range = ownerDocument.createRange();
    const anchor = ownerDocument.createComment("pa-share-boundary");
    try {
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        range.deleteContents();
        range.collapse(true);
        range.insertNode(anchor);
        liftAnchorOutOfEmptySpans(anchor, root);
        removeEmptyTextNodes(root);
        removeEmptySpans(root);
        const parent = anchor.parentNode;
        if (!parent) return null;
        const offset = Array.from(parent.childNodes).indexOf(anchor);
        if (offset < 0) return null;
        anchor.remove();
        return { node: parent, offset };
    } finally {
        range.detach();
        anchor.remove();
    }
}

/** @internal Exact collision-free sentinel lookup across syntax-highlighter spans. */
export function locateShareCardSentinelTextRange(
    textSegments: readonly string[],
    marker: string,
): {
    startNodeIndex: number;
    startOffset: number;
    endNodeIndex: number;
    endOffset: number;
} | null {
    const text = textSegments.join("");
    const markerStart = text.indexOf(marker);
    if (markerStart < 0 || markerStart !== text.lastIndexOf(marker)) return null;
    const start = locateLinearTextPoint(textSegments, markerStart);
    const end = locateLinearTextPoint(textSegments, markerStart + marker.length);
    return start && end
        ? {
            startNodeIndex: start.nodeIndex,
            startOffset: start.offset,
            endNodeIndex: end.nodeIndex,
            endOffset: end.offset,
        }
        : null;
}

function locateLinearTextPoint(
    segments: readonly string[],
    requestedOffset: number,
): { nodeIndex: number; offset: number } | null {
    let consumed = 0;
    for (let nodeIndex = 0; nodeIndex < segments.length; nodeIndex += 1) {
        const segment = segments[nodeIndex]!;
        if (requestedOffset <= consumed + segment.length) {
            return { nodeIndex, offset: requestedOffset - consumed };
        }
        consumed += segment.length;
    }
    return null;
}

function liftAnchorOutOfEmptySpans(anchor: Comment, root: HTMLElement): void {
    let parent = anchor.parentElement;
    while (
        parent
        && parent !== root
        && parent.tagName.toLowerCase() === "span"
        && (parent.textContent ?? "").length === 0
    ) {
        const grandparent = parent.parentNode;
        if (!grandparent) return;
        grandparent.insertBefore(anchor, parent);
        parent.remove();
        parent = anchor.parentElement;
    }
}

function removeEmptyTextNodes(root: HTMLElement): void {
    const ownerDocument = root.ownerDocument;
    const nodeFilter = ownerDocument.defaultView?.NodeFilter?.SHOW_TEXT ?? 4;
    const walker = ownerDocument.createTreeWalker(root, nodeFilter);
    const empty: Text[] = [];
    let node = walker.nextNode();
    while (node) {
        const text = node as Text;
        if (text.data.length === 0) empty.push(text);
        node = walker.nextNode();
    }
    for (const text of empty) text.remove();
}

function removeEmptySpans(root: HTMLElement): void {
    const spans = Array.from(root.querySelectorAll("span")).reverse();
    for (const span of spans) {
        if ((span.textContent ?? "").length === 0 && span.childNodes.length === 0) {
            span.remove();
        }
    }
}

function nodeIsWithin(root: Node, node: Node): boolean {
    let current: Node | null = node;
    while (current) {
        if (current === root) return true;
        current = current.parentNode;
    }
    return false;
}

function pathFromRoot(root: Node, node: Node): number[] | null {
    const reversed: number[] = [];
    let current: Node | null = node;
    while (current && current !== root) {
        const parent: Node | null = current.parentNode;
        if (!parent) return null;
        const index = Array.from(parent.childNodes).indexOf(current as ChildNode);
        if (index < 0) return null;
        reversed.push(index);
        current = parent;
    }
    return current === root ? reversed.reverse() : null;
}

function resolveNodePath(root: Node, path: readonly number[]): Node | null {
    let current: Node = root;
    for (const index of path) {
        const child = current.childNodes.item(index);
        if (!child) return null;
        current = child;
    }
    return current;
}

/** @internal Deterministic DOM-range clone used by prepared pagination pages. */
export function appendShareCardStaticDomRange(
    destination: HTMLElement,
    sourceBody: HTMLElement,
    boundaries: ReadonlyMap<number, ShareCardStaticDomBoundary>,
    sourceStart: number,
    sourceEnd: number,
    sourceLength: number,
    ownerDocument: Document,
): boolean {
    if (typeof ownerDocument.createRange !== "function") return false;
    const start = resolveStaticBoundary(
        sourceBody,
        boundaries,
        sourceStart,
        sourceLength,
    );
    const end = resolveStaticBoundary(
        sourceBody,
        boundaries,
        sourceEnd,
        sourceLength,
    );
    if (!start || !end) return false;

    const range = ownerDocument.createRange();
    try {
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        let fragment: Node = range.cloneContents();
        let common: Node | null = range.commonAncestorContainer;
        if (common.nodeType === 3) common = common.parentNode;
        while (common && common !== sourceBody) {
            if (common.nodeType !== 1) return false;
            const wrapper = common.cloneNode(false);
            wrapper.appendChild(fragment);
            fragment = wrapper;
            common = common.parentNode;
        }
        if (common !== sourceBody) return false;
        destination.appendChild(fragment);
        return true;
    } catch {
        return false;
    } finally {
        range.detach();
    }
}

function resolveStaticBoundary(
    sourceBody: HTMLElement,
    boundaries: ReadonlyMap<number, ShareCardStaticDomBoundary>,
    sourceOffset: number,
    sourceLength: number,
): { node: Node; offset: number } | null {
    if (sourceOffset === 0) return { node: sourceBody, offset: 0 };
    if (sourceOffset === sourceLength) {
        return { node: sourceBody, offset: sourceBody.childNodes.length };
    }
    const boundary = boundaries.get(sourceOffset);
    if (!boundary) return null;
    const node = resolveNodePath(sourceBody, boundary.nodePath);
    if (!node) return null;
    const limit = node.nodeType === 3
        ? (node as Text).data.length
        : node.childNodes.length;
    return boundary.offset >= 0 && boundary.offset <= limit
        ? { node, offset: boundary.offset }
        : null;
}

function isSafeStandaloneMermaidMarkdown(markdown: string): boolean {
    const lines = markdown.trim().replace(/\r\n?/gu, "\n").split("\n");
    if (lines.length < 3) return false;
    const opening = /^ {0,3}(`{3,}|~{3,})[ \t]*mermaid[ \t]*$/iu.exec(lines[0] ?? "");
    if (!opening) return false;
    const marker = opening[1]!;
    const closing = new RegExp(`^ {0,3}${marker.charAt(0)}{${marker.length},} *$`, "u");
    if (!closing.test(lines[lines.length - 1] ?? "")) return false;
    const body = lines.slice(1, -1).join("\n");
    return !/(?:\b(?:https?|file|ftp|obsidian):|url\s*\(|<\s*\/?\s*(?:iframe|object|embed|video|audio|img|picture|source|style|link|script|base|meta)\b)/iu
        .test(body);
}

/** Sanitize a rendered card subtree without discarding approved static visuals. */
export function sanitizeShareCardContent(bodyEl: HTMLElement): ShareCardSanitizationIssue[] {
    const issues: ShareCardSanitizationIssue[] = [];
    preserveTaskListState(bodyEl);

    for (const element of Array.from(bodyEl.querySelectorAll(HARD_REMOVED_SELECTOR))) {
        element.remove();
    }
    for (const button of Array.from(bodyEl.querySelectorAll("button"))) {
        if (button.classList.contains("copy-code-button")) button.remove();
    }
    for (const element of Array.from(bodyEl.querySelectorAll(PLACEHOLDER_SELECTOR))) {
        if (!element.parentElement) continue;
        issues.push({ tagName: element.tagName.toLowerCase(), reason: "unsafe-element" });
        replaceWithPlaceholder(element, `${readableTagName(element)} unavailable`);
    }
    for (const form of Array.from(bodyEl.querySelectorAll("form"))) {
        issues.push({ tagName: "form", reason: "unsafe-element" });
        form.replaceWith(...Array.from(form.childNodes));
    }
    for (const foreignObject of Array.from(bodyEl.querySelectorAll("foreignObject"))) {
        if (hasMermaidAncestor(foreignObject)) continue;
        issues.push({ tagName: "foreignobject", reason: "unsafe-element" });
        foreignObject.remove();
    }

    for (const element of Array.from(bodyEl.querySelectorAll("*"))) {
        if (!element.parentElement) continue;
        const tagName = element.tagName.toLowerCase();
        const insideMermaidForeignObject = hasForeignObjectAncestor(element)
            && hasMermaidAncestor(element);
        const insideSvg = !insideMermaidForeignObject
            && (tagName === "svg" || hasSvgAncestor(element));
        const isSafe = insideSvg ? SAFE_SVG_ELEMENTS.has(tagName) : SAFE_HTML_ELEMENTS.has(tagName);
        if (!isSafe) {
            issues.push({ tagName, reason: "unsafe-element" });
            element.replaceWith(...Array.from(element.childNodes));
            continue;
        }

        if (tagName === "canvas") {
            if (!replaceCanvasWithStaticImage(element as HTMLCanvasElement)) {
                issues.push({ tagName, reason: "unsafe-canvas" });
                replaceWithPlaceholder(element, "Canvas unavailable");
            }
            continue;
        }

        if (tagName === "source") {
            // Localized Markdown has a data-backed img fallback. Dropping
            // srcset avoids browser candidate selection and capture-time loads.
            element.remove();
            continue;
        }

        const invalidVisualResource = sanitizeElementAttributes(
            element,
            insideSvg,
            hasMermaidAncestor(element),
            issues,
        );
        if (invalidVisualResource && (tagName === "img" || tagName === "image")) {
            replaceWithPlaceholder(element, "Image unavailable");
        }
    }
    return issues;
}

/** Backward-compatible name retained for existing callers/tests. */
export const pruneNonTextContent = sanitizeShareCardContent;

/** Return every residual active resource reference. A valid card returns `[]`. */
export function auditVisualResourceUris(bodyEl: HTMLElement): string[] {
    const invalid: string[] = [];
    for (const element of Array.from(bodyEl.querySelectorAll("*"))) {
        for (const attributeName of element.getAttributeNames()) {
            const normalizedName = attributeName.toLowerCase();
            const value = element.getAttribute(attributeName) ?? "";
            if (normalizedName === "srcset" || normalizedName === "imagesrcset") {
                invalid.push(normalizedName);
                continue;
            }
            if (normalizedName === "style" || value.toLowerCase().includes("url(")) {
                if (!hasOnlySafeCssResources(value)) invalid.push(normalizedName);
                continue;
            }
            if (
                RESOURCE_ATTRIBUTE_NAMES.has(normalizedName)
                && normalizedName !== "href"
                && !isAllowedVisualResourceUri(value)
            ) {
                invalid.push(normalizedName);
            }
            if (
                (normalizedName === "href" || normalizedName === "xlink:href")
                && element.tagName.toLowerCase() !== "a"
                && !isAllowedVisualResourceUri(value)
            ) {
                invalid.push(normalizedName);
            }
        }
    }
    return invalid;
}

function sanitizeElementAttributes(
    element: Element,
    insideSvg: boolean,
    insideMermaid: boolean,
    issues: ShareCardSanitizationIssue[],
): boolean {
    const tagName = element.tagName.toLowerCase();
    const htmlAllowlist = SAFE_HTML_ATTRIBUTES[tagName];
    let invalidVisualResource = false;

    for (const attributeName of element.getAttributeNames()) {
        const normalizedName = attributeName.toLowerCase();
        const value = element.getAttribute(attributeName) ?? "";
        if (normalizedName.startsWith("on")) {
            element.removeAttribute(attributeName);
            continue;
        }
        if (normalizedName === "class") {
            const safeClasses = insideSvg || insideMermaid
                ? value.split(/\s+/).filter((className) => /^[a-z0-9_-]+$/i.test(className))
                : SAFE_VISUAL_CLASSES.filter((className) => (
                    element.classList.contains(className)
                ));
            element.removeAttribute(attributeName);
            if (safeClasses.length > 0) element.setAttribute("class", safeClasses.join(" "));
            continue;
        }
        if (normalizedName === "style") {
            if (!isSafeStyle(value)) {
                element.removeAttribute(attributeName);
                issues.push({ tagName, reason: "unsafe-style" });
            }
            continue;
        }
        if (tagName === "a" && (normalizedName === "href" || normalizedName === "target")) {
            element.removeAttribute(attributeName);
            continue;
        }
        if (normalizedName === "srcset" || normalizedName === "imagesrcset") {
            const fallback = firstSafeDataUrl(value);
            element.removeAttribute(attributeName);
            if (tagName === "img" && !element.getAttribute("src") && fallback) {
                element.setAttribute("src", fallback);
            } else if (!fallback) {
                invalidVisualResource = true;
                issues.push({ tagName, reason: "external-resource-remains" });
            }
            continue;
        }
        if (RESOURCE_ATTRIBUTE_NAMES.has(normalizedName)) {
            if (!isAllowedVisualResourceUri(value)) {
                element.removeAttribute(attributeName);
                invalidVisualResource = true;
                issues.push({ tagName, reason: "external-resource-remains" });
            }
            continue;
        }
        if (value.toLowerCase().includes("url(") && !hasOnlySafeCssResources(value)) {
            element.removeAttribute(attributeName);
            invalidVisualResource = true;
            issues.push({ tagName, reason: "external-resource-remains" });
            continue;
        }
        if (insideSvg) continue;
        if (!SAFE_GLOBAL_ATTRIBUTES.has(normalizedName) && !htmlAllowlist?.has(normalizedName)) {
            element.removeAttribute(attributeName);
        }
    }
    return invalidVisualResource;
}

function isAllowedVisualResourceUri(value: string): boolean {
    const normalized = value.trim();
    return normalized.startsWith("#") || SAFE_IMAGE_DATA_URI_RE.test(normalized);
}

function firstSafeDataUrl(value: string): string | null {
    return /data:image\/(?:gif|jpeg|png|svg\+xml|webp)(?:;[^,\s]*)?,[^\s,]+/i.exec(value)?.[0]
        ?? null;
}

function isSafeStyle(value: string): boolean {
    if (/@import|expression\s*\(|javascript\s*:/i.test(value)) return false;
    return hasOnlySafeCssResources(value);
}

function hasOnlySafeCssResources(value: string): boolean {
    URL_FUNCTION_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = URL_FUNCTION_RE.exec(value))) {
        if (!isAllowedVisualResourceUri(match[2] ?? "")) return false;
    }
    return true;
}

function replaceCanvasWithStaticImage(element: HTMLCanvasElement): boolean {
    if (typeof element.toDataURL !== "function") return false;
    try {
        const dataUrl = element.toDataURL("image/png");
        if (!SAFE_IMAGE_DATA_URI_RE.test(dataUrl)) return false;
        const image = element.ownerDocument.createElement("img");
        image.setAttribute("src", dataUrl);
        image.setAttribute("alt", element.getAttribute("aria-label") ?? "Canvas");
        for (const dimension of ["width", "height"]) {
            const explicit = element.getAttribute(dimension);
            const intrinsic = dimension === "width" ? element.width : element.height;
            const value = explicit ?? (Number.isFinite(intrinsic) && intrinsic > 0
                ? String(intrinsic)
                : "");
            if (value) image.setAttribute(dimension, value);
        }
        element.replaceWith(image);
        return true;
    } catch {
        return false;
    }
}

function hasSvgAncestor(element: Element): boolean {
    let parent = element.parentElement;
    while (parent) {
        if (parent.tagName.toLowerCase() === "svg") return true;
        parent = parent.parentElement;
    }
    return false;
}

function hasForeignObjectAncestor(element: Element): boolean {
    let parent = element.parentElement;
    while (parent) {
        if (parent.tagName.toLowerCase() === "foreignobject") return true;
        parent = parent.parentElement;
    }
    return false;
}

function hasMermaidAncestor(element: Element): boolean {
    let current: Element | null = element;
    while (current) {
        if (
            current.classList.contains("mermaid")
            || current.classList.contains("block-language-mermaid")
        ) {
            return true;
        }
        current = current.parentElement;
    }
    return false;
}

function readableTagName(element: Element): string {
    const tagName = element.tagName.toLowerCase();
    return tagName.charAt(0).toUpperCase() + tagName.slice(1);
}

function markVisualBlockOwners(bodyEl: HTMLElement): void {
    const visualElements = Array.from(bodyEl.querySelectorAll([
        "img",
        "picture",
        "svg",
        ".block-language-mermaid",
        ".mermaid",
    ].join(",")));
    for (const visual of visualElements) {
        let owner = visual as HTMLElement;
        while (owner.parentElement && owner.parentElement !== bodyEl) {
            owner = owner.parentElement;
        }
        owner.classList.add("pa-share-card-visual-block");
    }
}

function replaceWithPlaceholder(element: Element, label: string): void {
    const placeholder = element.ownerDocument.createElement("span");
    placeholder.classList.add("pa-share-card-resource-placeholder");
    placeholder.setAttribute("aria-label", label);
    placeholder.textContent = `[${label}]`;
    element.replaceWith(placeholder);
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

/**
 * Detect approved visual syntax while excluding literal fenced, indented and
 * inline code. This is intentionally only the fallback gate; explicit resource
 * discovery remains owned by the resource session.
 */
function markdownContainsApprovedVisual(markdown: string): boolean {
    const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
    let fence: { character: string; length: number } | null = null;

    for (const line of lines) {
        const containerStripped = line.replace(/^(?:(?: {0,3}> ?)|(?: {0,3}(?:[*+-]|\d+[.)]) +))*/, "");
        if (fence) {
            const closing = new RegExp(`^ {0,3}${fence.character}{${fence.length},} *$`);
            if (closing.test(containerStripped)) fence = null;
            continue;
        }

        const opening = /^ {0,3}(`{3,}|~{3,})([^`]*)$/.exec(containerStripped);
        if (opening) {
            const info = opening[2].trim().toLowerCase();
            if (info === "mermaid") return true;
            fence = { character: opening[1].charAt(0), length: opening[1].length };
            continue;
        }
        if (/^(?: {4}|\t)/.test(containerStripped)) continue;

        const ordinary = stripInlineCode(containerStripped);
        if (
            /!\[\[|!\[[^\]]*\](?:\(|\[)|<(?:canvas|img|picture|svg)\b/i.test(ordinary)
        ) {
            return true;
        }
    }
    return false;
}

function stripInlineCode(line: string): string {
    let output = "";
    let cursor = 0;
    while (cursor < line.length) {
        const start = line.indexOf("`", cursor);
        if (start < 0) return output + line.slice(cursor);
        let markerEnd = start + 1;
        while (line.charAt(markerEnd) === "`") markerEnd += 1;
        const marker = line.slice(start, markerEnd);
        const end = line.indexOf(marker, markerEnd);
        output += line.slice(cursor, start);
        if (end < 0) return output + line.slice(start);
        cursor = end + marker.length;
    }
    return output;
}

function waitForImageLoad(image: HTMLImageElement, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const cleanup = (): void => {
            image.removeEventListener("load", onLoad);
            image.removeEventListener("error", onError);
            signal.removeEventListener("abort", onAbort);
        };
        const onLoad = (): void => {
            cleanup();
            resolve();
        };
        const onError = (): void => {
            cleanup();
            reject(new Error("Share Card image failed to load."));
        };
        const onAbort = (): void => {
            cleanup();
            reject(new ShareCardRenderCancelledError());
        };
        if (signal.aborted) {
            onAbort();
            return;
        }
        image.addEventListener("load", onLoad, { once: true });
        image.addEventListener("error", onError, { once: true });
        signal.addEventListener("abort", onAbort, { once: true });
    });
}

function cloneElement(source: HTMLElement, ownerDocument: Document): HTMLElement {
    if (typeof source.cloneNode === "function") return source.cloneNode(true) as HTMLElement;

    // Lightweight DOM doubles used by focused tests do not implement
    // cloneNode. Keep the fallback structural and side-effect free.
    const clone = ownerDocument.createElement(source.tagName.toLowerCase());
    clone.textContent = source.textContent;
    for (const attributeName of source.getAttributeNames()) {
        clone.setAttribute(attributeName, source.getAttribute(attributeName) ?? "");
    }
    for (const className of [
        "pa-share-card-body",
        "pa-share-card-body-fallback",
        "pa-share-card-resource-placeholder",
        "pa-share-card-static",
        "pa-share-card-visual-block",
        ...SAFE_VISUAL_CLASSES,
    ]) {
        if (source.classList.contains(className)) clone.classList.add(className);
    }
    for (const child of Array.from(source.children)) {
        clone.appendChild(cloneElement(child as HTMLElement, ownerDocument));
    }
    return clone;
}

function clearElement(element: HTMLElement): void {
    while (element.firstChild) element.removeChild(element.firstChild);
}

function measureLayout(element: HTMLElement): LayoutSize {
    return {
        clientHeight: element.clientHeight,
        clientWidth: element.clientWidth,
        scrollHeight: element.scrollHeight,
    };
}

function sameLayout(left: LayoutSize, right: LayoutSize): boolean {
    return left.clientHeight === right.clientHeight
        && left.clientWidth === right.clientWidth
        && left.scrollHeight === right.scrollHeight;
}

function waitForOwnerDocumentFrame(ownerDocument: Document): Promise<void> {
    const ownerWindow = ownerDocument.defaultView;
    if (ownerWindow && typeof ownerWindow.requestAnimationFrame === "function") {
        return new Promise((resolve) => ownerWindow.requestAnimationFrame(() => resolve()));
    }
    return Promise.resolve();
}
