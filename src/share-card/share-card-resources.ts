/* Copyright 2023 edonyzpc */

import {
    requestUrl as obsidianRequestUrl,
    resolveSubpath as obsidianResolveSubpath,
    type App,
    type CachedMetadata,
    type RequestUrlParam,
    type TFile,
} from "obsidian";

export const DEFAULT_MAX_SHARE_CARD_RESOURCES = 32;
export const DEFAULT_MAX_SHARE_CARD_RESOURCE_BYTES = 6 * 1024 * 1024;
export const DEFAULT_MAX_SHARE_CARD_TOTAL_RESOURCE_BYTES = 20 * 1024 * 1024;
export const DEFAULT_SHARE_CARD_RESOURCE_TIMEOUT_MS = 10_000;
export const DEFAULT_SHARE_CARD_RESOURCE_SESSION_TIMEOUT_MS = 15_000;
export const DEFAULT_SHARE_CARD_RESOURCE_CONCURRENCY = 4;
export const DEFAULT_MAX_SHARE_CARD_EMBED_DEPTH = 4;
export const DEFAULT_MAX_SHARE_CARD_EMBEDDED_MARKDOWN_BYTES = 512 * 1024;
export const DEFAULT_MAX_SHARE_CARD_LOCALIZED_OUTPUT_BYTES = 32 * 1024 * 1024;

export type ShareCardResourceKind =
    | "markdown-image"
    | "wiki-image"
    | "html-image"
    | "svg-reference"
    | "css-image"
    | "vault-embed";

export type ShareCardResourceFailureReason =
    | "aborted"
    | "cycle"
    | "depth-exceeded"
    | "embedded-content-too-large"
    | "http-status"
    | "invalid-data-url"
    | "invalid-reference"
    | "localized-output-too-large"
    | "mime-mismatch"
    | "network"
    | "resource-count-limit"
    | "resource-not-found"
    | "resource-too-large"
    | "resource-total-limit"
    | "subpath-not-found"
    | "timeout"
    | "unsupported-mime"
    | "unsupported-scheme"
    | "unsafe-svg"
    | "vault-read";

export type ShareCardResourceStatus = "resolved" | "placeholder" | "failed";

export interface ShareCardResourceReportEntry {
    id: string;
    kind: ShareCardResourceKind;
    reference: string;
    status: ShareCardResourceStatus;
    mimeType?: string;
    byteLength?: number;
    failureReason?: ShareCardResourceFailureReason;
}

export interface ShareCardCompletenessReport {
    complete: boolean;
    resolvedCount: number;
    placeholderCount: number;
    failedCount: number;
    uniqueResourceCount: number;
    totalResolvedBytes: number;
    resources: ShareCardResourceReportEntry[];
}

export interface LocalizedShareCardResources {
    markdown: string;
    report: ShareCardCompletenessReport;
}

export interface ShareCardResourceLimits {
    maxResourceCount: number;
    maxSingleResourceBytes: number;
    maxTotalResourceBytes: number;
    timeoutMs: number;
    sessionTimeoutMs: number;
    maxConcurrency: number;
    maxEmbedDepth: number;
    maxEmbeddedMarkdownBytes: number;
    maxLocalizedOutputBytes: number;
}

export interface ShareCardRequestUrlResponse {
    status: number;
    headers: Record<string, string>;
    arrayBuffer: ArrayBuffer;
}

export type ShareCardRequestUrl = (
    request: RequestUrlParam,
) => Promise<ShareCardRequestUrlResponse>;

export interface ShareCardResourceContext {
    /** Invisible resolution context. It must never be reused as a visible label. */
    resourceBasePath?: string;
    signal?: AbortSignal;
    /** Reuse one cache for every preparation/capture operation owned by a Modal. */
    cache?: ShareCardResourceCache;
}

export interface ShareCardResourceLocalizerOptions {
    requestUrl?: ShareCardRequestUrl;
    limits?: Partial<ShareCardResourceLimits>;
    placeholderText?: (entry: {
        kind: ShareCardResourceKind;
        label: string;
        reason: ShareCardResourceFailureReason;
    }) => string;
    /** Test seam; production uses Obsidian's implementation. */
    resolveSubpath?: typeof obsidianResolveSubpath;
}

export interface ShareCardLocalizedResource {
    dataUrl: string;
    mimeType: string;
    byteLength: number;
}

interface ResolvedResource extends ShareCardLocalizedResource {
    cacheKey: string;
    dataUrlByteLength: number;
}

interface ResourceOccurrence {
    start: number;
    end: number;
    kind: ShareCardResourceKind;
    reference: string;
    label: string;
    replace: (dataUrl: string) => string;
}

interface LiteralRange {
    start: number;
    end: number;
}

interface ResourceResolution {
    allocation: OutputAllocation;
    resolvedResources: Map<string, ResolvedResource>;
    entries: ShareCardResourceReportEntry[];
    uniqueKeys: Set<string>;
    replacement: () => string;
    replacementByteLength: number;
    replacementAllocated: boolean;
}

type OutputScope = symbol;

interface OutputAllocation {
    fallbackByteLength: number;
    fallbackReplacement: string;
    scope: OutputScope;
}

interface InternalLocalizedShareCardResources extends LocalizedShareCardResources {
    resolvedResources: Map<string, ResolvedResource>;
    uniqueKeys: Set<string>;
}

interface ShareCardResourceSession {
    app: App;
    cache: ShareCardResourceCache;
    context: ShareCardResourceContext;
    deadline: number;
    limits: ShareCardResourceLimits;
    nextResourceId: number;
    outputBudget: ShareCardLocalizedOutputBudget;
    placeholderText: NonNullable<ShareCardResourceLocalizerOptions["placeholderText"]>;
    requestUrl: ShareCardRequestUrl;
    resolveSubpath: typeof obsidianResolveSubpath;
    scheduler: ShareCardResourceScheduler;
}

interface FenceState {
    marker: "`" | "~";
    length: number;
}

const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
    gif: "image/gif",
    jfif: "image/jpeg",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    svg: "image/svg+xml",
    webp: "image/webp",
};

const ALLOWED_IMAGE_MIME_TYPES = new Set(Object.values(IMAGE_MIME_BY_EXTENSION));
const FORBIDDEN_SVG_ELEMENTS = new Set([
    "animate", "animatemotion", "animatetransform", "audio", "discard", "embed",
    "foreignobject", "handler", "iframe", "link", "object", "script", "set", "video",
]);
const SVG_RESOURCE_ATTRIBUTES = new Set(["href", "src"]);
const XLINK_NAMESPACE_URI = "http://www.w3.org/1999/xlink";
const UNSAFE_SVG_MARKUP_RE = /<!DOCTYPE\b|<\?xml-stylesheet\b|javascript\s*:|@import\b|expression\s*\(|(?:-webkit-)?image-set\s*\(/i;
const SVG_ELEMENT_RE = /<\s*([a-z][a-z0-9:.-]*)\b([^>]*)>/gi;
const SVG_ATTRIBUTE_RE = /\s([a-z_:][a-z0-9_.:-]*)\s*=\s*(?:(["'])([\s\S]*?)\2|([^\s"'=<>`]+))/gi;
const SVG_RESOURCE_URL_RE = /url\(\s*(["']?)(.*?)\1\s*\)/gi;
const DATA_URL_RE = /^data:([^;,]+)?((?:;[^,]*)*),([\s\S]*)$/i;

const DEFAULT_LIMITS: ShareCardResourceLimits = {
    maxResourceCount: DEFAULT_MAX_SHARE_CARD_RESOURCES,
    maxSingleResourceBytes: DEFAULT_MAX_SHARE_CARD_RESOURCE_BYTES,
    maxTotalResourceBytes: DEFAULT_MAX_SHARE_CARD_TOTAL_RESOURCE_BYTES,
    timeoutMs: DEFAULT_SHARE_CARD_RESOURCE_TIMEOUT_MS,
    sessionTimeoutMs: DEFAULT_SHARE_CARD_RESOURCE_SESSION_TIMEOUT_MS,
    maxConcurrency: DEFAULT_SHARE_CARD_RESOURCE_CONCURRENCY,
    maxEmbedDepth: DEFAULT_MAX_SHARE_CARD_EMBED_DEPTH,
    maxEmbeddedMarkdownBytes: DEFAULT_MAX_SHARE_CARD_EMBEDDED_MARKDOWN_BYTES,
    maxLocalizedOutputBytes: DEFAULT_MAX_SHARE_CARD_LOCALIZED_OUTPUT_BYTES,
};

export class ShareCardResourceError extends Error {
    constructor(
        readonly reason: ShareCardResourceFailureReason,
        message: string,
    ) {
        super(message);
        this.name = "ShareCardResourceError";
    }
}

export class ShareCardResourceAbortedError extends ShareCardResourceError {
    constructor() {
        super("aborted", "Share Card resource preparation was cancelled.");
        this.name = "ShareCardResourceAbortedError";
    }
}

function utf8ByteLength(value: string): number {
    let byteLength = 0;
    for (let index = 0; index < value.length; index += 1) {
        const codeUnit = value.charCodeAt(index);
        if (codeUnit <= 0x7f) {
            byteLength += 1;
        } else if (codeUnit <= 0x7ff) {
            byteLength += 2;
        } else if (
            codeUnit >= 0xd800
            && codeUnit <= 0xdbff
            && value.charCodeAt(index + 1) >= 0xdc00
            && value.charCodeAt(index + 1) <= 0xdfff
        ) {
            byteLength += 4;
            index += 1;
        } else {
            byteLength += 3;
        }
    }
    return byteLength;
}

function normalizedKnownByteLength(value: number | undefined): number {
    return value !== undefined && Number.isFinite(value) && value >= 0
        ? Math.ceil(value)
        : 0;
}

function knownVaultFileByteLength(file: TFile): number | undefined {
    const size = file.stat?.size;
    return size !== undefined && Number.isFinite(size) && size >= 0
        ? Math.ceil(size)
        : undefined;
}

class ShareCardLocalizedOutputBudget {
    private readonly scopes = new Map<OutputScope, {
        bytes: number;
        parent?: OutputScope;
    }>();
    private totalBytes = 0;

    constructor(private readonly limit: number) {}

    createScope(parent?: OutputScope): OutputScope {
        const scope = Symbol("share-card-output");
        this.scopes.set(scope, { bytes: 0, parent });
        return scope;
    }

    resize(scope: OutputScope, byteLength: number): void {
        const record = this.scopes.get(scope);
        if (!record) throw new Error("Share Card output scope is unavailable.");
        const normalized = normalizedKnownByteLength(byteLength);
        const nextTotal = this.totalBytes - record.bytes + normalized;
        if (nextTotal > this.limit) {
            throw new ShareCardResourceError(
                "localized-output-too-large",
                `Share Card localized output exceeds ${this.limit} bytes.`,
            );
        }
        this.totalBytes = nextTotal;
        record.bytes = normalized;
    }

    releaseDescendants(parent: OutputScope): void {
        const descendants = [...this.scopes.keys()].filter((scope) => (
            scope !== parent && this.isDescendantOf(scope, parent)
        ));
        for (const scope of descendants) {
            const record = this.scopes.get(scope);
            if (!record) continue;
            this.totalBytes -= record.bytes;
            this.scopes.delete(scope);
        }
    }

    private isDescendantOf(scope: OutputScope, ancestor: OutputScope): boolean {
        let parent = this.scopes.get(scope)?.parent;
        while (parent) {
            if (parent === ancestor) return true;
            parent = this.scopes.get(parent)?.parent;
        }
        return false;
    }
}

/** Per-Modal deduplication and aggregate byte/count budget. */
export class ShareCardResourceCache {
    private readonly entries = new Map<string, Promise<ResolvedResource>>();
    private readonly manifestKeys = new Set<string>();
    private readonly markdownEntries = new Map<string, Promise<string>>();
    private readonly reservedKeys = new Set<string>();
    private reservedBinaryBytes = 0;
    private reservedEmbeddedMarkdownBytes = 0;
    private resolvedBytes = 0;
    private resolvedEmbeddedMarkdownBytes = 0;

    get uniqueResourceCount(): number {
        return this.reservedKeys.size;
    }

    get totalResolvedBytes(): number {
        return this.resolvedBytes;
    }

    get totalEmbeddedMarkdownBytes(): number {
        return this.resolvedEmbeddedMarkdownBytes;
    }

    reserveExplicitReference(
        manifestKey: string,
        limits: ShareCardResourceLimits,
    ): void {
        if (this.manifestKeys.has(manifestKey)) return;
        if (this.manifestKeys.size >= limits.maxResourceCount) {
            throw new ShareCardResourceError(
                "resource-count-limit",
                `Share Card resource count exceeds ${limits.maxResourceCount}.`,
            );
        }
        this.manifestKeys.add(manifestKey);
    }

    private reserve(cacheKey: string, limits: ShareCardResourceLimits): void {
        if (this.reservedKeys.has(cacheKey)) return;
        if (this.reservedKeys.size >= limits.maxResourceCount) {
            throw new ShareCardResourceError(
                "resource-count-limit",
                `Share Card resource count exceeds ${limits.maxResourceCount}.`,
            );
        }
        this.reservedKeys.add(cacheKey);
    }

    resolve(
        cacheKey: string,
        limits: ShareCardResourceLimits,
        loader: () => Promise<ShareCardLocalizedResource>,
        knownByteLength?: number,
    ): Promise<ResolvedResource> {
        const cached = this.entries.get(cacheKey);
        if (cached) return cached;
        try {
            this.reserve(cacheKey, limits);
        } catch (error) {
            return Promise.reject(error);
        }

        const reservation = normalizedKnownByteLength(knownByteLength);
        if (reservation > limits.maxSingleResourceBytes) {
            const rejected = Promise.reject<ResolvedResource>(new ShareCardResourceError(
                "resource-too-large",
                `Share Card resource exceeds ${limits.maxSingleResourceBytes} bytes.`,
            ));
            this.entries.set(cacheKey, rejected);
            return rejected;
        }
        if (
            this.resolvedBytes + this.reservedBinaryBytes + reservation
            > limits.maxTotalResourceBytes
        ) {
            const rejected = Promise.reject<ResolvedResource>(new ShareCardResourceError(
                "resource-total-limit",
                `Share Card resources exceed ${limits.maxTotalResourceBytes} bytes.`,
            ));
            this.entries.set(cacheKey, rejected);
            return rejected;
        }
        this.reservedBinaryBytes += reservation;

        const pending = (async (): Promise<ResolvedResource> => {
            try {
                const loaded = await loader();
                if (loaded.byteLength > limits.maxSingleResourceBytes) {
                    throw new ShareCardResourceError(
                        "resource-too-large",
                        `Share Card resource exceeds ${limits.maxSingleResourceBytes} bytes.`,
                    );
                }
                if (
                    this.resolvedBytes
                    + (this.reservedBinaryBytes - reservation)
                    + loaded.byteLength
                    > limits.maxTotalResourceBytes
                ) {
                    throw new ShareCardResourceError(
                        "resource-total-limit",
                        `Share Card resources exceed ${limits.maxTotalResourceBytes} bytes.`,
                    );
                }
                this.resolvedBytes += loaded.byteLength;
                return {
                    ...loaded,
                    cacheKey,
                    dataUrlByteLength: utf8ByteLength(loaded.dataUrl),
                };
            } finally {
                this.reservedBinaryBytes -= reservation;
            }
        })();
        this.entries.set(cacheKey, pending);
        return pending;
    }

    resolveMarkdown(
        cacheKey: string,
        limits: ShareCardResourceLimits,
        loader: () => Promise<string>,
        knownByteLength?: number,
    ): Promise<string> {
        const cached = this.markdownEntries.get(cacheKey);
        if (cached) return cached;
        try {
            this.reserve(cacheKey, limits);
        } catch (error) {
            return Promise.reject(error);
        }

        const reservation = normalizedKnownByteLength(knownByteLength);
        if (
            this.resolvedEmbeddedMarkdownBytes
            + this.reservedEmbeddedMarkdownBytes
            + reservation
            > limits.maxEmbeddedMarkdownBytes
        ) {
            const rejected = Promise.reject<string>(new ShareCardResourceError(
                "embedded-content-too-large",
                `Share Card embedded Markdown exceeds ${limits.maxEmbeddedMarkdownBytes} bytes.`,
            ));
            this.markdownEntries.set(cacheKey, rejected);
            return rejected;
        }
        this.reservedEmbeddedMarkdownBytes += reservation;

        const pending = (async (): Promise<string> => {
            try {
                const markdown = await loader();
                const byteLength = utf8ByteLength(markdown);
                if (
                    this.resolvedEmbeddedMarkdownBytes
                    + (this.reservedEmbeddedMarkdownBytes - reservation)
                    + byteLength
                    > limits.maxEmbeddedMarkdownBytes
                ) {
                    throw new ShareCardResourceError(
                        "embedded-content-too-large",
                        `Share Card embedded Markdown exceeds ${limits.maxEmbeddedMarkdownBytes} bytes.`,
                    );
                }
                this.resolvedEmbeddedMarkdownBytes += byteLength;
                return markdown;
            } finally {
                this.reservedEmbeddedMarkdownBytes -= reservation;
            }
        })();
        this.markdownEntries.set(cacheKey, pending);
        return pending;
    }
}

class ShareCardResourceScheduler {
    private active = 0;
    private circuitError: ShareCardResourceError | null = null;
    private readonly queue: Array<{
        reject: (reason: unknown) => void;
        resolve: (value: unknown) => void;
        task: () => Promise<unknown>;
    }> = [];

    constructor(
        private readonly maxConcurrency: number,
        private readonly signal: AbortSignal | undefined,
        private readonly deadline: number,
    ) {}

    run<T>(task: () => Promise<T>): Promise<T> {
        try {
            this.assertActive();
        } catch (error) {
            return Promise.reject(error);
        }
        return new Promise<T>((resolve, reject) => {
            this.queue.push({
                task,
                resolve: resolve as (value: unknown) => void,
                reject,
            });
            this.drain();
        });
    }

    private drain(): void {
        while (this.active < this.maxConcurrency && this.queue.length > 0) {
            const next = this.queue.shift()!;
            try {
                this.assertActive();
            } catch (error) {
                next.reject(error);
                continue;
            }
            this.active += 1;
            let pending: Promise<unknown>;
            try {
                pending = next.task();
            } catch (error) {
                pending = Promise.reject(error);
            }
            void pending
                .then(next.resolve, (error: unknown) => {
                    if (error instanceof ShareCardResourceError && error.reason === "timeout") {
                        this.tripCircuit(error);
                    }
                    next.reject(error);
                })
                .finally(() => {
                    this.active -= 1;
                    this.drain();
                });
        }
    }

    private assertActive(): void {
        throwIfAborted(this.signal);
        if (this.circuitError) throw this.circuitError;
        if (Date.now() >= this.deadline) {
            throw new ShareCardResourceError(
                "timeout",
                "Share Card resource preparation exceeded its shared deadline.",
            );
        }
    }

    private tripCircuit(error: ShareCardResourceError): void {
        if (this.circuitError) return;
        this.circuitError = error;
        let queued = this.queue.shift();
        while (queued) {
            queued.reject(error);
            queued = this.queue.shift();
        }
    }
}

export function createShareCardResourceCache(): ShareCardResourceCache {
    return new ShareCardResourceCache();
}

function normalizeLimits(overrides?: Partial<ShareCardResourceLimits>): ShareCardResourceLimits {
    const limits = { ...DEFAULT_LIMITS, ...overrides };
    for (const [name, value] of Object.entries(limits)) {
        if (!Number.isFinite(value) || value < 0) {
            throw new TypeError(`Invalid Share Card resource limit: ${name}.`);
        }
    }
    for (const name of ["maxResourceCount", "maxConcurrency", "maxEmbedDepth"] as const) {
        if (!Number.isInteger(limits[name]) || (name === "maxConcurrency" && limits[name] < 1)) {
            throw new TypeError(`Invalid Share Card resource limit: ${name}.`);
        }
    }
    return limits;
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new ShareCardResourceAbortedError();
}

function remainingOperationTimeout(session: ShareCardResourceSession): number {
    throwIfAborted(session.context.signal);
    const remaining = session.deadline - Date.now();
    if (remaining <= 0) {
        throw new ShareCardResourceError(
            "timeout",
            "Share Card resource preparation exceeded its shared deadline.",
        );
    }
    if (!Number.isFinite(remaining)) return session.limits.timeoutMs;
    return session.limits.timeoutMs > 0
        ? Math.min(session.limits.timeoutMs, remaining)
        : remaining;
}

function withTimeoutAndAbort<T>(
    pending: Promise<T>,
    signal: AbortSignal | undefined,
    timeoutMs: number,
): Promise<T> {
    throwIfAborted(signal);
    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const finish = (callback: () => void): void => {
            if (settled) return;
            settled = true;
            if (timer !== undefined) clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            callback();
        };
        const onAbort = (): void => finish(() => reject(new ShareCardResourceAbortedError()));
        const timer = timeoutMs > 0
            ? setTimeout(() => finish(() => reject(new ShareCardResourceError(
                "timeout",
                `Share Card resource did not resolve within ${timeoutMs} ms.`,
            ))), timeoutMs)
            : undefined;
        signal?.addEventListener("abort", onAbort, { once: true });
        pending.then(
            (value) => finish(() => resolve(value)),
            (error: unknown) => finish(() => reject(error)),
        );
    });
}

function contentType(headers: Record<string, string>): string | undefined {
    const header = Object.entries(headers).find(([name]) => name.toLowerCase() === "content-type")?.[1];
    return header?.split(";", 1)[0]?.trim().toLowerCase() || undefined;
}

function extensionFromReference(reference: string): string {
    const withoutQuery = reference.split(/[?#]/, 1)[0] ?? reference;
    const fileName = withoutQuery.split("/").pop() ?? withoutQuery;
    const extension = fileName.includes(".") ? fileName.split(".").pop() : undefined;
    return extension?.toLowerCase() ?? "";
}

function mimeFromReference(reference: string): string | undefined {
    return IMAGE_MIME_BY_EXTENSION[extensionFromReference(reference)];
}

function normalizeImageMime(mimeType: string | undefined, reference: string): string {
    const normalized = mimeType?.trim().toLowerCase();
    if (normalized && normalized !== "application/octet-stream") {
        if (ALLOWED_IMAGE_MIME_TYPES.has(normalized)) return normalized;
        throw new ShareCardResourceError(
            "unsupported-mime",
            `Unsupported Share Card resource MIME type: ${normalized}.`,
        );
    }
    const inferred = mimeFromReference(reference);
    if (inferred) return inferred;
    throw new ShareCardResourceError(
        "unsupported-mime",
        "Share Card resource did not provide a supported image MIME type.",
    );
}

function encodeArrayBufferBase64(arrayBuffer: ArrayBuffer): string {
    const bytes = new Uint8Array(arrayBuffer);
    const chunks: string[] = [];
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
        chunks.push(String.fromCharCode(...chunk));
    }
    const encoder = typeof globalThis.btoa === "function" ? globalThis.btoa.bind(globalThis) : undefined;
    if (!encoder) {
        throw new ShareCardResourceError(
            "invalid-data-url",
            "Base64 encoding is unavailable for Share Card resources.",
        );
    }
    return encoder(chunks.join(""));
}

function unsafeSvg(): never {
    throw new ShareCardResourceError(
        "unsafe-svg",
        "SVG contains executable or external resource content.",
    );
}

function decodeXmlCharacterReferences(value: string): string {
    return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|amp|apos|gt|lt|quot);/gi, (entity, decimal, hex) => {
        if (decimal || hex) {
            const codePoint = Number.parseInt(decimal ?? hex, hex ? 16 : 10);
            if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) unsafeSvg();
            return String.fromCodePoint(codePoint);
        }
        const named = entity.toLowerCase();
        if (named === "&amp;") return "&";
        if (named === "&apos;") return "'";
        if (named === "&gt;") return ">";
        if (named === "&lt;") return "<";
        return '"';
    });
}

function decodeCssEscapes(value: string): string {
    const decoded = value.replace(
        /\\([0-9a-f]{1,6})(?:[ \t\r\n\f])?|\\([^\r\n\f])/gi,
        (_escape, hexadecimal: string | undefined, escaped: string | undefined) => {
            if (escaped !== undefined) return escaped;
            const codePoint = Number.parseInt(hexadecimal ?? "", 16);
            if (
                !Number.isFinite(codePoint)
                || codePoint <= 0
                || codePoint > 0x10ffff
                || (codePoint >= 0xd800 && codePoint <= 0xdfff)
            ) {
                unsafeSvg();
            }
            return String.fromCodePoint(codePoint);
        },
    );
    if (decoded.includes("\\")) unsafeSvg();
    return decoded;
}

function validateSvgCssReferences(css: string): void {
    const normalized = decodeCssEscapes(
        decodeXmlCharacterReferences(css).replace(/\/\*[\s\S]*?\*\//g, ""),
    );
    if (UNSAFE_SVG_MARKUP_RE.test(normalized)) unsafeSvg();
    SVG_RESOURCE_URL_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SVG_RESOURCE_URL_RE.exec(normalized)) !== null) {
        const reference = decodeXmlCharacterReferences(match[2] ?? "").trim();
        if (!reference.startsWith("#")) unsafeSvg();
    }
}

function validateSvgElement(element: Element): void {
    const tagName = element.localName.toLowerCase();
    if (FORBIDDEN_SVG_ELEMENTS.has(tagName)) unsafeSvg();
    for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase();
        const localName = attribute.localName.toLowerCase();
        const value = attribute.value.trim();
        if (name.startsWith("on") || name === "xml:base") unsafeSvg();
        const isXlinkHref = attribute.namespaceURI === XLINK_NAMESPACE_URI && localName === "href";
        if ((SVG_RESOURCE_ATTRIBUTES.has(name) || isXlinkHref) && !value.startsWith("#")) unsafeSvg();
        validateSvgCssReferences(value);
    }
    if (tagName === "style") validateSvgCssReferences(element.textContent ?? "");
}

function validateSvgWithDomParser(markup: string): boolean {
    const Parser = globalThis.DOMParser;
    if (typeof Parser !== "function") return false;
    const document = new Parser().parseFromString(markup, "image/svg+xml");
    if (
        document.querySelector("parsererror")
        || document.documentElement.localName.toLowerCase() !== "svg"
    ) {
        unsafeSvg();
    }
    validateSvgElement(document.documentElement);
    for (const element of Array.from(document.documentElement.querySelectorAll("*"))) {
        validateSvgElement(element);
    }
    return true;
}

function validateSvgWithoutDomParser(markup: string): void {
    const decoded = decodeXmlCharacterReferences(markup);
    SVG_ELEMENT_RE.lastIndex = 0;
    let sawRoot = false;
    let elementMatch: RegExpExecArray | null;
    while ((elementMatch = SVG_ELEMENT_RE.exec(decoded)) !== null) {
        const tagName = (elementMatch[1]?.split(":").pop() ?? "").toLowerCase();
        if (!sawRoot) {
            if (tagName !== "svg") unsafeSvg();
            sawRoot = true;
        }
        if (FORBIDDEN_SVG_ELEMENTS.has(tagName)) unsafeSvg();
        if (/(?:^|\s)[^\s"'=<>`]+:href\s*=/i.test(elementMatch[2] ?? "")) unsafeSvg();
        SVG_ATTRIBUTE_RE.lastIndex = 0;
        let attributeMatch: RegExpExecArray | null;
        while ((attributeMatch = SVG_ATTRIBUTE_RE.exec(elementMatch[2] ?? "")) !== null) {
            const name = attributeMatch[1]?.toLowerCase() ?? "";
            const value = (attributeMatch[3] ?? attributeMatch[4] ?? "").trim();
            if (name.startsWith("on") || name === "xml:base") unsafeSvg();
            if (/^[a-z_][a-z0-9_.-]*:href$/i.test(name)) unsafeSvg();
            if (SVG_RESOURCE_ATTRIBUTES.has(name) && !value.startsWith("#")) unsafeSvg();
            validateSvgCssReferences(value);
        }
    }
    if (!sawRoot) unsafeSvg();
    for (const style of decoded.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
        validateSvgCssReferences(style[1] ?? "");
    }
}

function validateSvgMarkup(markup: string): void {
    if (UNSAFE_SVG_MARKUP_RE.test(markup)) unsafeSvg();
    if (!validateSvgWithDomParser(markup)) validateSvgWithoutDomParser(markup);
}

function hasBytes(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
    return expected.every((value, index) => bytes[offset + index] === value);
}

function validateRasterSignature(arrayBuffer: ArrayBuffer, mimeType: string): void {
    const bytes = new Uint8Array(arrayBuffer);
    const valid = mimeType === "image/png"
        ? hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        : mimeType === "image/jpeg"
            ? hasBytes(bytes, 0, [0xff, 0xd8, 0xff])
            : mimeType === "image/gif"
                ? hasBytes(bytes, 0, [0x47, 0x49, 0x46, 0x38])
                    && (bytes[4] === 0x37 || bytes[4] === 0x39)
                    && bytes[5] === 0x61
                : mimeType === "image/webp"
                    ? hasBytes(bytes, 0, [0x52, 0x49, 0x46, 0x46])
                        && hasBytes(bytes, 8, [0x57, 0x45, 0x42, 0x50])
                    : false;
    if (!valid) {
        throw new ShareCardResourceError(
            "mime-mismatch",
            `Share Card resource bytes do not match ${mimeType}.`,
        );
    }
}

function validateImageBytes(arrayBuffer: ArrayBuffer, mimeType: string): void {
    if (mimeType === "image/svg+xml") {
        validateSvgMarkup(new TextDecoder().decode(arrayBuffer));
    } else {
        validateRasterSignature(arrayBuffer, mimeType);
    }
}

function binaryToDataUrl(
    arrayBuffer: ArrayBuffer,
    mimeType: string,
): ShareCardLocalizedResource {
    validateImageBytes(arrayBuffer, mimeType);
    return {
        dataUrl: `data:${mimeType};base64,${encodeArrayBufferBase64(arrayBuffer)}`,
        mimeType,
        byteLength: arrayBuffer.byteLength,
    };
}

function decodeBase64Data(payload: string): Uint8Array {
    const normalized = payload.replace(/\s+/g, "");
    if (!/^[a-z0-9+/]*={0,2}$/i.test(normalized) || normalized.length % 4 === 1) {
        throw new ShareCardResourceError("invalid-data-url", "Invalid base64 image data URL.");
    }
    const decoder = typeof globalThis.atob === "function" ? globalThis.atob.bind(globalThis) : undefined;
    if (!decoder) {
        throw new ShareCardResourceError(
            "invalid-data-url",
            "Base64 decoding is unavailable for an image data URL.",
        );
    }
    try {
        const binary = decoder(normalized);
        return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    } catch {
        throw new ShareCardResourceError("invalid-data-url", "Invalid base64 image data URL.");
    }
}

function validateDataUrl(reference: string): ShareCardLocalizedResource {
    const match = DATA_URL_RE.exec(reference);
    if (!match) {
        throw new ShareCardResourceError("invalid-data-url", "Invalid image data URL.");
    }
    const mimeType = normalizeImageMime(match[1], reference);
    const metadata = match[2] ?? "";
    const payload = match[3] ?? "";
    let bytes: Uint8Array;
    if (/;base64(?:;|$)/i.test(metadata)) {
        bytes = decodeBase64Data(payload);
    } else if (mimeType === "image/svg+xml") {
        try {
            bytes = new TextEncoder().encode(decodeURIComponent(payload));
        } catch {
            throw new ShareCardResourceError("invalid-data-url", "Invalid encoded SVG data URL.");
        }
    } else {
        throw new ShareCardResourceError(
            "invalid-data-url",
            "Raster image data URLs must use base64 encoding.",
        );
    }
    validateImageBytes(bytes.buffer, mimeType);
    return { dataUrl: reference, mimeType, byteLength: bytes.byteLength };
}

function splitVaultReference(reference: string): { linkpath: string; subpath: string } {
    let decoded = reference.trim();
    try {
        decoded = decodeURIComponent(decoded);
    } catch {
        // Keep the literal Vault linkpath; MetadataCache may still resolve it.
    }
    decoded = decoded.replace(/^\/+/, "");
    const subpathIndex = decoded.search(/[\^#]/);
    if (subpathIndex < 0) return { linkpath: decoded.trim(), subpath: "" };
    const subpath = decoded.slice(subpathIndex).trim();
    return {
        linkpath: decoded.slice(0, subpathIndex).trim(),
        subpath: subpath.startsWith("^") ? `#${subpath}` : subpath,
    };
}

function splitReferenceFragment(reference: string): { resource: string; fragment: string } {
    if (/^data:/i.test(reference)) return { resource: reference, fragment: "" };
    const hashIndex = reference.indexOf("#");
    if (hashIndex <= 0) return { resource: reference, fragment: "" };
    return {
        resource: reference.slice(0, hashIndex),
        fragment: reference.slice(hashIndex),
    };
}

function explicitManifestKey(reference: string, resourceBasePath: string): string {
    const trimmed = reference.trim();
    if (/^data:/i.test(trimmed)) return `data:${trimmed}`;
    const { resource } = splitReferenceFragment(trimmed);
    if (/^https?:\/\//i.test(resource) || /^\/\//.test(resource)) {
        const remote = resource.startsWith("//") ? `https:${resource}` : resource;
        return `remote:${remote.replace(/^https?:/i, (scheme) => scheme.toLowerCase())}`;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(resource)) {
        const separator = resource.indexOf(":");
        return `scheme:${resource.slice(0, separator).toLowerCase()}:${resource.slice(separator + 1)}`;
    }
    const { linkpath, subpath } = splitVaultReference(resource);
    const target = linkpath || (subpath ? resourceBasePath : "");
    return `vault:${resourceBasePath}:${target}`;
}

function reportReference(reference: string): string {
    if (/^data:/i.test(reference)) {
        const mimeType = DATA_URL_RE.exec(reference)?.[1] ?? "image";
        return `data:${mimeType}`;
    }
    return reference;
}

function defaultPlaceholderText(entry: {
    label: string;
}): string {
    return entry.label ? `Image unavailable: ${entry.label}` : "Image unavailable";
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function placeholderDataUrl(text: string): string {
    const visibleText = text.replace(/\s+/g, " ").trim().slice(0, 80) || "Image unavailable";
    const svg = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">',
        '<rect width="640" height="360" rx="18" fill="#eee8df"/>',
        '<path d="M190 243l72-83 53 55 38-38 97 104H190z" fill="#c2b8aa"/>',
        '<circle cx="251" cy="112" r="24" fill="#c2b8aa"/>',
        `<text x="320" y="321" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#6f675e">${escapeXml(visibleText)}</text>`,
        "</svg>",
    ].join("");
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function asResourceError(
    error: unknown,
    fallbackReason: ShareCardResourceFailureReason,
    fallbackMessage: string,
): ShareCardResourceError {
    if (error instanceof ShareCardResourceError) return error;
    return new ShareCardResourceError(
        fallbackReason,
        error instanceof Error ? error.message : fallbackMessage,
    );
}

async function loadRemoteResource(
    reference: string,
    session: ShareCardResourceSession,
): Promise<ShareCardLocalizedResource> {
    let response: ShareCardRequestUrlResponse;
    try {
        response = await withTimeoutAndAbort(session.requestUrl({
            url: reference,
            method: "GET",
            throw: false,
        }), session.context.signal, remainingOperationTimeout(session));
    } catch (error) {
        if (error instanceof ShareCardResourceAbortedError) throw error;
        throw asResourceError(error, "network", "Remote Share Card resource request failed.");
    }
    if (response.status < 200 || response.status >= 300) {
        throw new ShareCardResourceError(
            "http-status",
            `Remote Share Card resource returned HTTP ${response.status}.`,
        );
    }
    const mimeType = normalizeImageMime(contentType(response.headers), reference);
    if (response.arrayBuffer.byteLength > session.limits.maxSingleResourceBytes) {
        throw new ShareCardResourceError(
            "resource-too-large",
            `Share Card resource exceeds ${session.limits.maxSingleResourceBytes} bytes.`,
        );
    }
    return binaryToDataUrl(response.arrayBuffer, mimeType);
}

function resolveVaultFile(
    app: App,
    reference: string,
    basePath: string,
): TFile {
    const { linkpath, subpath } = splitVaultReference(reference);
    if (!linkpath && subpath && basePath) {
        const current = app.vault.getAbstractFileByPath(basePath);
        if (current && "extension" in current) return current as TFile;
    }
    if (!linkpath) {
        throw new ShareCardResourceError("invalid-reference", "Vault image linkpath is empty.");
    }
    const file: TFile | null = app.metadataCache.getFirstLinkpathDest(linkpath, basePath);
    if (!file) {
        throw new ShareCardResourceError(
            "resource-not-found",
            `Vault image was not found: ${linkpath}.`,
        );
    }
    return file;
}

async function loadResolvedVaultFile(
    file: TFile,
    session: ShareCardResourceSession,
): Promise<ShareCardLocalizedResource> {
    const mimeType = normalizeImageMime(IMAGE_MIME_BY_EXTENSION[file.extension.toLowerCase()], file.path);
    const knownByteLength = knownVaultFileByteLength(file);
    if (
        knownByteLength !== undefined
        && knownByteLength > session.limits.maxSingleResourceBytes
    ) {
        throw new ShareCardResourceError(
            "resource-too-large",
            `Share Card resource exceeds ${session.limits.maxSingleResourceBytes} bytes.`,
        );
    }
    let arrayBuffer: ArrayBuffer;
    try {
        arrayBuffer = await withTimeoutAndAbort(
            session.app.vault.readBinary(file),
            session.context.signal,
            remainingOperationTimeout(session),
        );
    } catch (error) {
        if (error instanceof ShareCardResourceAbortedError) throw error;
        throw asResourceError(error, "vault-read", "Vault image read failed.");
    }
    if (arrayBuffer.byteLength > session.limits.maxSingleResourceBytes) {
        throw new ShareCardResourceError(
            "resource-too-large",
            `Share Card resource exceeds ${session.limits.maxSingleResourceBytes} bytes.`,
        );
    }
    return binaryToDataUrl(arrayBuffer, mimeType);
}

async function resolveExplicitResource(
    reference: string,
    session: ShareCardResourceSession,
    resourceBasePath = session.context.resourceBasePath ?? "",
    onCacheKey?: (cacheKey: string) => void,
): Promise<ResolvedResource> {
    throwIfAborted(session.context.signal);
    const trimmed = reference.trim();
    if (!trimmed) {
        throw new ShareCardResourceError("invalid-reference", "Share Card image reference is empty.");
    }
    if (trimmed.startsWith("#")) {
        throw new ShareCardResourceError(
            "invalid-reference",
            "A local document fragment is not an image resource.",
        );
    }

    const { resource, fragment } = splitReferenceFragment(trimmed);
    let cacheKey: string;
    let loader: () => Promise<ShareCardLocalizedResource>;
    if (/^data:/i.test(resource)) {
        cacheKey = `data:${resource}`;
        loader = async () => validateDataUrl(resource);
    } else if (/^https?:\/\//i.test(resource) || /^\/\//.test(resource)) {
        const remoteUrl = resource.startsWith("//") ? `https:${resource}` : resource;
        cacheKey = `remote:${remoteUrl}`;
        loader = () => session.scheduler.run(() => loadRemoteResource(remoteUrl, session));
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(resource)) {
        throw new ShareCardResourceError(
            "unsupported-scheme",
            `Unsupported Share Card resource scheme: ${resource.split(":", 1)[0]}.`,
        );
    } else {
        const file = resolveVaultFile(session.app, resource, resourceBasePath);
        cacheKey = `vault-file:${file.path}`;
        loader = () => session.scheduler.run(() => loadResolvedVaultFile(file, session));
        onCacheKey?.(cacheKey);
        const resolved = await session.cache.resolve(
            cacheKey,
            session.limits,
            loader,
            knownVaultFileByteLength(file),
        );
        throwIfAborted(session.context.signal);
        return fragment
            ? {
                ...resolved,
                dataUrl: `${resolved.dataUrl}${fragment}`,
                dataUrlByteLength: resolved.dataUrlByteLength + utf8ByteLength(fragment),
            }
            : resolved;
    }

    onCacheKey?.(cacheKey);
    const resolved = await session.cache.resolve(cacheKey, session.limits, loader);
    throwIfAborted(session.context.signal);
    return fragment
        ? {
            ...resolved,
            dataUrl: `${resolved.dataUrl}${fragment}`,
            dataUrlByteLength: resolved.dataUrlByteLength + utf8ByteLength(fragment),
        }
        : resolved;
}

function lineEndWithoutNewline(line: string): number {
    if (line.endsWith("\r\n")) return line.length - 2;
    if (line.endsWith("\n") || line.endsWith("\r")) return line.length - 1;
    return line.length;
}

function containerContentStart(content: string): number {
    let cursor = 0;
    let leadingSpaces = 0;
    while (content.charAt(cursor) === " " && leadingSpaces < 3) {
        cursor += 1;
        leadingSpaces += 1;
    }
    let sawContainer = false;
    while (cursor < content.length) {
        if (content.charAt(cursor) === ">") {
            sawContainer = true;
            cursor += 1;
            if (content.charAt(cursor) === " " || content.charAt(cursor) === "\t") cursor += 1;
            continue;
        }
        const list = /^(?:[-+*]|\d{1,9}[.)])[ \t]/.exec(content.slice(cursor));
        if (!list) break;
        sawContainer = true;
        cursor += list[0].length;
    }
    return sawContainer ? cursor : 0;
}

function fenceAtLineStart(line: string): { marker: "`" | "~"; length: number; rest: string } | null {
    const content = line.slice(0, lineEndWithoutNewline(line));
    let cursor = containerContentStart(content);
    if (cursor === 0) {
        while (content.charAt(cursor) === " " && cursor < 3) cursor += 1;
    }
    const markerMatch = /^(`{3,}|~{3,})(.*)$/.exec(content.slice(cursor));
    if (!markerMatch) return null;
    const marker = markerMatch[1].charAt(0) as "`" | "~";
    const rest = markerMatch[2] ?? "";
    if (marker === "`" && rest.includes("`")) return null;
    return { marker, length: markerMatch[1].length, rest };
}

function mergeRanges(ranges: LiteralRange[]): LiteralRange[] {
    const sorted = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end);
    const merged: LiteralRange[] = [];
    for (const range of sorted) {
        const previous = merged[merged.length - 1];
        if (previous && range.start <= previous.end) {
            previous.end = Math.max(previous.end, range.end);
        } else {
            merged.push({ ...range });
        }
    }
    return merged;
}

function rangeContaining(index: number, ranges: LiteralRange[]): LiteralRange | undefined {
    return ranges.find((range) => index >= range.start && index < range.end);
}

const RAW_TEXT_HTML_TAGS = [
    "code",
    "iframe",
    "noembed",
    "noframes",
    "plaintext",
    "pre",
    "script",
    "style",
    "template",
    "textarea",
    "title",
    "xmp",
] as const;

function collectRawTextHtmlRanges(markdown: string): LiteralRange[] {
    const ranges: LiteralRange[] = [];
    for (const match of markdown.matchAll(/<!--[\s\S]*?(?:-->|$)/g)) {
        if (match.index !== undefined) {
            ranges.push({ start: match.index, end: match.index + match[0].length });
        }
    }

    const tagNames = RAW_TEXT_HTML_TAGS.join("|");
    const openingTag = new RegExp(`<\\s*(${tagNames})\\b`, "gi");
    let match: RegExpExecArray | null;
    while ((match = openingTag.exec(markdown)) !== null) {
        const start = match.index;
        const openingEnd = rawTagEnd(markdown, start);
        if (openingEnd < 0) {
            ranges.push({ start, end: markdown.length });
            break;
        }
        const tagName = match[1].toLowerCase();
        if (tagName === "plaintext") {
            ranges.push({ start, end: markdown.length });
            break;
        }
        const closingTag = new RegExp(`<\\/\\s*${tagName}\\s*>`, "gi");
        closingTag.lastIndex = openingEnd;
        const closingMatch = closingTag.exec(markdown);
        const end = closingMatch ? closingMatch.index + closingMatch[0].length : markdown.length;
        ranges.push({ start, end });
        openingTag.lastIndex = end;
    }
    return ranges;
}

function collectCodeSpanRanges(markdown: string, excluded: LiteralRange[]): LiteralRange[] {
    const ranges: LiteralRange[] = [];
    let cursor = 0;
    while (cursor < markdown.length) {
        const excludedRange = rangeContaining(cursor, excluded);
        if (excludedRange) {
            cursor = excludedRange.end;
            continue;
        }
        if (markdown.charAt(cursor) !== "`" || isEscapedAt(markdown, cursor)) {
            cursor += 1;
            continue;
        }
        let openingEnd = cursor + 1;
        while (markdown.charAt(openingEnd) === "`") openingEnd += 1;
        const markerLength = openingEnd - cursor;
        let candidate = openingEnd;
        let closingEnd = -1;
        while (candidate < markdown.length) {
            const next = markdown.indexOf("`", candidate);
            if (next < 0) break;
            const blocked = rangeContaining(next, excluded);
            if (blocked) {
                candidate = blocked.end;
                continue;
            }
            let runEnd = next + 1;
            while (markdown.charAt(runEnd) === "`") runEnd += 1;
            if (runEnd - next === markerLength && !isEscapedAt(markdown, next)) {
                closingEnd = runEnd;
                break;
            }
            candidate = runEnd;
        }
        if (closingEnd >= 0) {
            ranges.push({ start: cursor, end: closingEnd });
            cursor = closingEnd;
        } else {
            cursor = openingEnd;
        }
    }
    return ranges;
}

function findLiteralRanges(markdown: string): LiteralRange[] {
    const ranges: LiteralRange[] = [];
    let offset = 0;
    let fence: FenceState | null = null;
    for (const match of markdown.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
        const line = match[0];
        if (line.length === 0) continue;
        const marker = fenceAtLineStart(line);
        if (fence) {
            ranges.push({ start: offset, end: offset + line.length });
            if (
                marker
                && marker.marker === fence.marker
                && marker.length >= fence.length
                && marker.rest.trim().length === 0
            ) {
                fence = null;
            }
        } else if (marker) {
            ranges.push({ start: offset, end: offset + line.length });
            fence = { marker: marker.marker, length: marker.length };
        } else if (/^(?: {4}|\t)/.test(line.slice(containerContentStart(
            line.slice(0, lineEndWithoutNewline(line)),
        )))) {
            ranges.push({ start: offset, end: offset + line.length });
        }
        offset += line.length;
    }

    ranges.push(...collectRawTextHtmlRanges(markdown));
    const structuralRanges = mergeRanges(ranges);
    return mergeRanges([...structuralRanges, ...collectCodeSpanRanges(markdown, structuralRanges)]);
}

function overlapsLiteral(start: number, end: number, ranges: LiteralRange[]): boolean {
    return ranges.some((range) => start < range.end && end > range.start);
}

function isEscapedAt(text: string, index: number): boolean {
    let slashes = 0;
    for (let cursor = index - 1; cursor >= 0 && text.charAt(cursor) === "\\"; cursor -= 1) {
        slashes += 1;
    }
    return slashes % 2 === 1;
}

function findClosingBracket(text: string, contentStart: number): number {
    let depth = 1;
    for (let cursor = contentStart; cursor < text.length; cursor += 1) {
        if (isEscapedAt(text, cursor)) continue;
        const character = text.charAt(cursor);
        if (character === "[") depth += 1;
        if (character !== "]") continue;
        depth -= 1;
        if (depth === 0) return cursor;
    }
    return -1;
}

function findClosingParenthesis(text: string, opening: number): number {
    let depth = 1;
    let quote = "";
    let insideAngle = false;
    for (let cursor = opening + 1; cursor < text.length; cursor += 1) {
        const character = text.charAt(cursor);
        if (isEscapedAt(text, cursor)) continue;
        if (quote) {
            if (character === quote) quote = "";
            continue;
        }
        if (insideAngle) {
            if (character === ">") insideAngle = false;
            continue;
        }
        if (character === "<" && depth === 1) {
            insideAngle = true;
        } else if ((character === "\"" || character === "'") && depth === 1) {
            quote = character;
        } else if (character === "(") {
            depth += 1;
        } else if (character === ")") {
            depth -= 1;
            if (depth === 0) return cursor;
        }
    }
    return -1;
}

function normalizeReferenceLabel(label: string): string {
    return label.replace(/\s+/g, " ").trim().toLowerCase();
}

function unescapeLabel(label: string): string {
    return label.replace(/\\([\\[\]])/g, "$1").replace(/\s+/g, " ").trim();
}

function escapeMarkdownAlt(label: string): string {
    return label.replace(/[\r\n]+/g, " ").replace(/\\/g, "\\\\").replace(/]/g, "\\]");
}

function labelFromWikiEmbed(target: string, alias: string): string {
    const explicitAlias = alias.trim();
    if (explicitAlias && !/^\d+(?:x\d+)?$/i.test(explicitAlias)) return explicitAlias;
    const fileName = target.split("/").pop() ?? target;
    return fileName.replace(/\.[a-z0-9]{1,8}$/i, "").trim();
}

function collectReferenceDefinitions(
    markdown: string,
    literalRanges: LiteralRange[],
): Map<string, string> {
    const definitions = new Map<string, string>();
    let offset = 0;
    for (const line of markdown.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? []) {
        if (line.length === 0) continue;
        if (!overlapsLiteral(offset, offset + line.length, literalRanges)) {
            const match = /^ {0,3}\[([^\]\r\n]+)\]:[ \t]*(?:<([^>\r\n]+)>|(\S+))/.exec(line);
            const reference = match?.[2] ?? match?.[3];
            if (match && reference) definitions.set(normalizeReferenceLabel(match[1]), reference);
        }
        offset += line.length;
    }
    return definitions;
}

function collectWikiEmbeds(
    markdown: string,
    literalRanges: LiteralRange[],
): ResourceOccurrence[] {
    const occurrences: ResourceOccurrence[] = [];
    for (const match of markdown.matchAll(/!\[\[([^\]\r\n]+)\]\]/g)) {
        if (match.index === undefined) continue;
        const start = match.index;
        const end = start + match[0].length;
        if (overlapsLiteral(start, end, literalRanges)) continue;
        const [rawTarget = "", rawAlias = ""] = match[1].split("|", 2);
        const target = rawTarget.trim();
        const { linkpath, subpath } = splitVaultReference(target);
        if (!linkpath && !subpath) continue;
        const label = labelFromWikiEmbed(linkpath || subpath, rawAlias);
        const explicitExtension = extensionFromReference(linkpath);
        occurrences.push({
            start,
            end,
            kind: explicitExtension && explicitExtension in IMAGE_MIME_BY_EXTENSION
                ? "wiki-image"
                : "vault-embed",
            reference: target,
            label,
            replace: (dataUrl) => `![${escapeMarkdownAlt(label)}](${dataUrl})`,
        });
    }
    return occurrences;
}

function inlineDestinationRange(
    markdown: string,
    openingParenthesis: number,
    closingParenthesis: number,
): { start: number; end: number; reference: string } | null {
    let cursor = openingParenthesis + 1;
    while (cursor < closingParenthesis && /[ \t\r\n]/.test(markdown.charAt(cursor))) cursor += 1;
    if (cursor >= closingParenthesis) return null;
    if (markdown.charAt(cursor) === "<") {
        const end = markdown.indexOf(">", cursor + 1);
        if (end < 0 || end > closingParenthesis) return null;
        return { start: cursor + 1, end, reference: markdown.slice(cursor + 1, end) };
    }
    const start = cursor;
    let nestedParentheses = 0;
    while (cursor < closingParenthesis) {
        const character = markdown.charAt(cursor);
        if (isEscapedAt(markdown, cursor)) {
            cursor += 1;
            continue;
        }
        if (character === "(") nestedParentheses += 1;
        if (character === ")" && nestedParentheses > 0) nestedParentheses -= 1;
        if (nestedParentheses === 0 && /[ \t\r\n]/.test(character)) break;
        cursor += 1;
    }
    if (cursor <= start) return null;
    return { start, end: cursor, reference: markdown.slice(start, cursor) };
}

function collectMarkdownImages(
    markdown: string,
    literalRanges: LiteralRange[],
    definitions: Map<string, string>,
): ResourceOccurrence[] {
    const occurrences: ResourceOccurrence[] = [];
    let cursor = 0;
    while (cursor < markdown.length) {
        const start = markdown.indexOf("![", cursor);
        if (start < 0) break;
        if (isEscapedAt(markdown, start) || overlapsLiteral(start, start + 2, literalRanges)) {
            cursor = start + 2;
            continue;
        }
        const altEnd = findClosingBracket(markdown, start + 2);
        if (altEnd < 0 || overlapsLiteral(start, altEnd + 1, literalRanges)) {
            cursor = start + 2;
            continue;
        }
        const alt = unescapeLabel(markdown.slice(start + 2, altEnd));
        const next = markdown.charAt(altEnd + 1);
        if (next === "(") {
            const closing = findClosingParenthesis(markdown, altEnd + 1);
            if (closing < 0) {
                cursor = altEnd + 1;
                continue;
            }
            const destination = inlineDestinationRange(markdown, altEnd + 1, closing);
            if (destination && !overlapsLiteral(destination.start, destination.end, literalRanges)) {
                occurrences.push({
                    start: destination.start,
                    end: destination.end,
                    kind: "markdown-image",
                    reference: destination.reference.replace(/\\([()])/g, "$1"),
                    label: alt,
                    replace: (dataUrl) => dataUrl,
                });
            }
            cursor = closing + 1;
            continue;
        }

        let referenceLabel = alt;
        let imageEnd = altEnd + 1;
        if (next === "[") {
            const referenceEnd = findClosingBracket(markdown, altEnd + 2);
            if (referenceEnd < 0) {
                cursor = altEnd + 1;
                continue;
            }
            referenceLabel = markdown.slice(altEnd + 2, referenceEnd) || alt;
            imageEnd = referenceEnd + 1;
        }
        const reference = definitions.get(normalizeReferenceLabel(referenceLabel));
        if (reference) {
            occurrences.push({
                start,
                end: imageEnd,
                kind: "markdown-image",
                reference,
                label: alt,
                replace: (dataUrl) => `![${escapeMarkdownAlt(alt)}](${dataUrl})`,
            });
        }
        cursor = imageEnd;
    }
    return occurrences;
}

interface RawAttribute {
    name: string;
    value: string;
    start: number;
    end: number;
}

function rawTagEnd(markdown: string, start: number): number {
    let quote = "";
    for (let cursor = start + 1; cursor < markdown.length; cursor += 1) {
        const character = markdown.charAt(cursor);
        if (quote) {
            if (character === quote) quote = "";
            continue;
        }
        if (character === "\"" || character === "'") {
            quote = character;
        } else if (character === ">") {
            return cursor + 1;
        }
    }
    return -1;
}

function rawAttributes(rawTag: string, tagOffset: number): RawAttribute[] {
    const attributes: RawAttribute[] = [];
    const re = /\s([a-z_:][a-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
    for (const match of rawTag.matchAll(re)) {
        if (match.index === undefined) continue;
        const rawValue = match[2] ?? match[3] ?? match[4] ?? "";
        const value = match[4] && rawValue.endsWith("/") ? rawValue.slice(0, -1) : rawValue;
        const relativeValueStart = match.index + match[0].lastIndexOf(rawValue);
        attributes.push({
            name: match[1].toLowerCase(),
            value,
            start: tagOffset + relativeValueStart,
            end: tagOffset + relativeValueStart + value.length,
        });
    }
    return attributes;
}

function collectCssUrls(attribute: RawAttribute): ResourceOccurrence[] {
    const occurrences: ResourceOccurrence[] = [];
    const re = /url\(\s*(?:(["'])(.*?)\1|([^)]*?))\s*\)/gi;
    for (const match of attribute.value.matchAll(re)) {
        if (match.index === undefined) continue;
        const rawReference = match[2] ?? match[3] ?? "";
        const reference = rawReference.trim();
        if (!reference || reference.startsWith("#")) continue;
        const withinMatch = match[0].indexOf(rawReference) + rawReference.indexOf(reference);
        const start = attribute.start + match.index + withinMatch;
        occurrences.push({
            start,
            end: start + reference.length,
            kind: "css-image",
            reference,
            label: "background image",
            replace: (dataUrl) => dataUrl,
        });
    }
    return occurrences;
}

function collectSrcsetUrls(attribute: RawAttribute): ResourceOccurrence[] {
    const occurrences: ResourceOccurrence[] = [];
    const re = /(?:^|,)\s*([^\s,]+)(?:\s+[^,]+)?/g;
    for (const match of attribute.value.matchAll(re)) {
        if (match.index === undefined || !match[1]) continue;
        const relative = match.index + match[0].indexOf(match[1]);
        occurrences.push({
            start: attribute.start + relative,
            end: attribute.start + relative + match[1].length,
            kind: "html-image",
            reference: match[1],
            label: "image",
            replace: (dataUrl) => dataUrl,
        });
    }
    return occurrences;
}

function collectRawHtmlResources(
    markdown: string,
    literalRanges: LiteralRange[],
): ResourceOccurrence[] {
    const occurrences: ResourceOccurrence[] = [];
    let cursor = 0;
    while (cursor < markdown.length) {
        const start = markdown.indexOf("<", cursor);
        if (start < 0) break;
        const end = rawTagEnd(markdown, start);
        if (end < 0) break;
        cursor = end;
        if (overlapsLiteral(start, end, literalRanges)) continue;
        const rawTag = markdown.slice(start, end);
        const tagName = /^<\s*([a-z][a-z0-9:-]*)/i.exec(rawTag)?.[1]?.toLowerCase();
        if (!tagName) continue;
        for (const attribute of rawAttributes(rawTag, start)) {
            if (attribute.name === "style") {
                occurrences.push(...collectCssUrls(attribute));
                continue;
            }
            if (tagName === "img" && attribute.name === "src") {
                occurrences.push({
                    start: attribute.start,
                    end: attribute.end,
                    kind: "html-image",
                    reference: attribute.value,
                    label: "image",
                    replace: (dataUrl) => dataUrl,
                });
                continue;
            }
            if (tagName === "img" && attribute.name === "srcset") {
                occurrences.push(...collectSrcsetUrls(attribute));
                continue;
            }
            if (
                (tagName === "image" || tagName === "use")
                && (attribute.name === "href" || attribute.name === "xlink:href")
                && !attribute.value.trim().startsWith("#")
            ) {
                occurrences.push({
                    start: attribute.start,
                    end: attribute.end,
                    kind: "svg-reference",
                    reference: attribute.value,
                    label: "SVG image",
                    replace: (dataUrl) => dataUrl,
                });
            }
        }
    }
    return occurrences;
}

function deduplicateOverlappingOccurrences(occurrences: ResourceOccurrence[]): ResourceOccurrence[] {
    const sorted = [...occurrences].sort((left, right) => (
        left.start - right.start || right.end - left.end
    ));
    const result: ResourceOccurrence[] = [];
    for (const occurrence of sorted) {
        const previous = result[result.length - 1];
        if (previous && occurrence.start < previous.end) continue;
        result.push(occurrence);
    }
    return result;
}

function replacementByteLength(
    occurrence: ResourceOccurrence,
    value: string,
    valueByteLength = utf8ByteLength(value),
): number {
    return utf8ByteLength(occurrence.replace("")) + valueByteLength;
}

function outputFallback(
    occurrence: ResourceOccurrence,
    session: ShareCardResourceSession,
): string {
    const text = session.placeholderText({
        kind: occurrence.kind,
        label: occurrence.label,
        reason: "localized-output-too-large",
    });
    return occurrence.replace(placeholderDataUrl(text));
}

function createOutputAllocation(
    occurrence: ResourceOccurrence,
    parentScope: OutputScope,
    session: ShareCardResourceSession,
): OutputAllocation {
    const scope = session.outputBudget.createScope(parentScope);
    const fallbackReplacement = outputFallback(occurrence, session);
    const fallbackByteLength = utf8ByteLength(fallbackReplacement);
    session.outputBudget.resize(scope, fallbackByteLength);
    return { fallbackByteLength, fallbackReplacement, scope };
}

function placeholderResolution(
    occurrence: ResourceOccurrence,
    id: string,
    uniqueKey: string,
    reason: ShareCardResourceFailureReason,
    allocation: OutputAllocation,
    session: ShareCardResourceSession,
): ResourceResolution {
    const text = session.placeholderText({
        kind: occurrence.kind,
        label: occurrence.label,
        reason,
    });
    const dataUrl = placeholderDataUrl(text);
    return {
        allocation,
        resolvedResources: new Map(),
        uniqueKeys: new Set([uniqueKey]),
        replacement: () => occurrence.replace(dataUrl),
        replacementByteLength: replacementByteLength(occurrence, dataUrl),
        replacementAllocated: false,
        entries: [{
            id,
            kind: occurrence.kind,
            reference: reportReference(occurrence.reference),
            status: "placeholder",
            failureReason: reason,
        }],
    };
}

async function resolveOccurrence(
    occurrence: ResourceOccurrence,
    session: ShareCardResourceSession,
    resourceBasePath: string,
    depth: number,
    ancestors: ReadonlySet<string>,
    parentOutputScope: OutputScope,
): Promise<ResourceResolution> {
    const id = `resource-${session.nextResourceId++}`;
    let uniqueKey = `reference:${occurrence.reference.trim()}`;
    const allocation = createOutputAllocation(occurrence, parentOutputScope, session);
    try {
        session.cache.reserveExplicitReference(
            explicitManifestKey(occurrence.reference, resourceBasePath),
            session.limits,
        );
        if (occurrence.kind === "vault-embed") {
            const file = resolveVaultFile(session.app, occurrence.reference, resourceBasePath);
            if (file.extension.toLowerCase() !== "md") {
                uniqueKey = `vault-file:${file.path}`;
                const resource = await session.cache.resolve(
                    uniqueKey,
                    session.limits,
                    () => session.scheduler.run(() => loadResolvedVaultFile(file, session)),
                    knownVaultFileByteLength(file),
                );
                return {
                    allocation,
                    resolvedResources: new Map([[resource.cacheKey, resource]]),
                    uniqueKeys: new Set([uniqueKey]),
                    replacement: () => occurrence.replace(resource.dataUrl),
                    replacementByteLength: replacementByteLength(
                        occurrence,
                        resource.dataUrl,
                        resource.dataUrlByteLength,
                    ),
                    replacementAllocated: false,
                    entries: [{
                        id,
                        kind: "vault-embed",
                        reference: reportReference(occurrence.reference),
                        status: "resolved",
                        mimeType: resource.mimeType,
                        byteLength: resource.byteLength,
                    }],
                };
            }

            uniqueKey = `vault-markdown:${file.path}`;
            const nextDepth = depth + 1;
            if (nextDepth > session.limits.maxEmbedDepth) {
                throw new ShareCardResourceError(
                    "depth-exceeded",
                    `Share Card note embeds exceed depth ${session.limits.maxEmbedDepth}.`,
                );
            }
            if (ancestors.has(file.path)) {
                throw new ShareCardResourceError(
                    "cycle",
                    `Share Card note embed cycle includes ${file.path}.`,
                );
            }
            const embeddedMarkdown = await readEmbeddedMarkdown(file, session);
            const projectedMarkdown = projectEmbeddedMarkdown(
                embeddedMarkdown,
                file,
                splitVaultReference(occurrence.reference).subpath,
                session,
            );
            const nestedAncestors = new Set(ancestors);
            nestedAncestors.add(file.path);
            const nested = await localizeShareCardResourcesInternal(
                projectedMarkdown,
                file.path,
                nextDepth,
                nestedAncestors,
                session,
                allocation.scope,
            );
            const byteLength = utf8ByteLength(projectedMarkdown);
            return {
                allocation,
                resolvedResources: nested.resolvedResources,
                uniqueKeys: new Set([uniqueKey, ...nested.uniqueKeys]),
                replacement: () => `\n\n${nested.markdown}\n\n`,
                replacementByteLength: 4,
                replacementAllocated: true,
                entries: [{
                    id,
                    kind: "vault-embed",
                    reference: reportReference(occurrence.reference),
                    status: "resolved",
                    mimeType: "text/markdown",
                    byteLength,
                }, ...nested.report.resources],
            };
        }
        const resource = await resolveExplicitResource(
            occurrence.reference,
            session,
            resourceBasePath,
            (cacheKey) => {
                uniqueKey = cacheKey;
            },
        );
        return {
            allocation,
            resolvedResources: new Map([[resource.cacheKey, resource]]),
            uniqueKeys: new Set([resource.cacheKey]),
            replacement: () => occurrence.replace(resource.dataUrl),
            replacementByteLength: replacementByteLength(
                occurrence,
                resource.dataUrl,
                resource.dataUrlByteLength,
            ),
            replacementAllocated: false,
            entries: [{
                id,
                kind: occurrence.kind,
                reference: reportReference(occurrence.reference),
                status: "resolved",
                mimeType: resource.mimeType,
                byteLength: resource.byteLength,
            }],
        };
    } catch (error) {
        if (error instanceof ShareCardResourceAbortedError || session.context.signal?.aborted) {
            throw new ShareCardResourceAbortedError();
        }
        const resourceError = asResourceError(
            error,
            "invalid-reference",
            "Share Card resource could not be resolved.",
        );
        session.outputBudget.releaseDescendants(allocation.scope);
        return placeholderResolution(
            occurrence,
            id,
            uniqueKey,
            resourceError.reason,
            allocation,
            session,
        );
    }
}

async function readEmbeddedMarkdown(
    file: TFile,
    session: ShareCardResourceSession,
): Promise<string> {
    return session.cache.resolveMarkdown(
        `vault-markdown:${file.path}`,
        session.limits,
        () => session.scheduler.run(async () => {
            try {
                return await withTimeoutAndAbort(
                    session.app.vault.cachedRead(file),
                    session.context.signal,
                    remainingOperationTimeout(session),
                );
            } catch (error) {
                if (error instanceof ShareCardResourceAbortedError) throw error;
                throw asResourceError(error, "vault-read", "Vault note read failed.");
            }
        }),
        knownVaultFileByteLength(file),
    );
}

function projectEmbeddedMarkdown(
    markdown: string,
    file: TFile,
    subpath: string,
    session: ShareCardResourceSession,
): string {
    const cache: CachedMetadata | null = session.app.metadataCache.getFileCache(file);
    if (!subpath) {
        const frontmatter = cache?.frontmatterPosition;
        if (frontmatter) {
            const start = frontmatter.start.offset;
            const end = frontmatter.end.offset;
            if (
                Number.isInteger(start)
                && Number.isInteger(end)
                && start === 0
                && end >= start
                && end <= markdown.length
            ) {
                return markdown.slice(end).replace(/^(?:\r\n|\r|\n)/, "");
            }
        }
        const yamlFrontmatter = /^---[ \t]*(?:\r\n|\r|\n)[\s\S]*?(?:\r\n|\r|\n)(?:---|\.\.\.)[ \t]*(?:(?:\r\n|\r|\n)|$)/.exec(markdown);
        return yamlFrontmatter ? markdown.slice(yamlFrontmatter[0].length) : markdown;
    }
    if (!cache) {
        throw new ShareCardResourceError(
            "subpath-not-found",
            `Vault metadata is unavailable for ${file.path}${subpath}.`,
        );
    }
    const projection = session.resolveSubpath(cache, subpath);
    if (!projection) {
        throw new ShareCardResourceError(
            "subpath-not-found",
            `Vault subpath was not found: ${file.path}${subpath}.`,
        );
    }
    const start = projection.start.offset;
    const end = projection.end?.offset ?? markdown.length;
    if (
        !Number.isInteger(start)
        || !Number.isInteger(end)
        || start < 0
        || end < start
        || end > markdown.length
    ) {
        throw new ShareCardResourceError(
            "subpath-not-found",
            `Vault subpath range is invalid: ${file.path}${subpath}.`,
        );
    }
    return markdown.slice(start, end);
}

function retainedMarkdownByteLength(
    markdown: string,
    occurrences: readonly ResourceOccurrence[],
): number {
    let retained = utf8ByteLength(markdown);
    for (const occurrence of occurrences) {
        retained -= utf8ByteLength(markdown.slice(occurrence.start, occurrence.end));
    }
    return retained;
}

function materializeResolution(
    resolution: ResourceResolution,
    session: ShareCardResourceSession,
): string {
    if (resolution.replacementAllocated) return resolution.replacement();
    try {
        session.outputBudget.resize(
            resolution.allocation.scope,
            resolution.replacementByteLength,
        );
        resolution.replacementAllocated = true;
        return resolution.replacement();
    } catch (error) {
        if (
            !(error instanceof ShareCardResourceError)
            || error.reason !== "localized-output-too-large"
        ) {
            throw error;
        }
        if (resolution.entries[0]?.status === "resolved") {
            const primary = resolution.entries[0];
            resolution.entries = [{
                id: primary.id,
                kind: primary.kind,
                reference: primary.reference,
                status: "placeholder",
                failureReason: "localized-output-too-large",
            }];
            resolution.resolvedResources.clear();
            const primaryKey = resolution.uniqueKeys.values().next().value as string | undefined;
            resolution.uniqueKeys = primaryKey ? new Set([primaryKey]) : new Set();
        }
        resolution.replacement = () => resolution.allocation.fallbackReplacement;
        resolution.replacementByteLength = resolution.allocation.fallbackByteLength;
        resolution.replacementAllocated = true;
        return resolution.allocation.fallbackReplacement;
    }
}

async function localizeShareCardResourcesInternal(
    markdown: string,
    resourceBasePath: string,
    depth: number,
    ancestors: ReadonlySet<string>,
    session: ShareCardResourceSession,
    parentOutputScope?: OutputScope,
): Promise<InternalLocalizedShareCardResources> {
    throwIfAborted(session.context.signal);
    const literalRanges = findLiteralRanges(markdown);
    const definitions = collectReferenceDefinitions(markdown, literalRanges);
    const occurrences = deduplicateOverlappingOccurrences([
        ...collectWikiEmbeds(markdown, literalRanges),
        ...collectMarkdownImages(markdown, literalRanges, definitions),
        ...collectRawHtmlResources(markdown, literalRanges),
    ]);
    const outputScope = session.outputBudget.createScope(parentOutputScope);
    session.outputBudget.resize(
        outputScope,
        retainedMarkdownByteLength(markdown, occurrences),
    );
    if (occurrences.length === 0) {
        return {
            markdown,
            resolvedResources: new Map(),
            uniqueKeys: new Set(),
            report: {
                complete: true,
                resolvedCount: 0,
                placeholderCount: 0,
                failedCount: 0,
                uniqueResourceCount: 0,
                totalResolvedBytes: 0,
                resources: [],
            },
        };
    }
    const resolutions = await Promise.all(occurrences.map((occurrence) => resolveOccurrence(
        occurrence,
        session,
        resourceBasePath,
        depth,
        ancestors,
        outputScope,
    )));

    let localized = "";
    let copyFrom = 0;
    for (let index = 0; index < occurrences.length; index += 1) {
        const occurrence = occurrences[index];
        localized += markdown.slice(copyFrom, occurrence.start);
        localized += materializeResolution(resolutions[index], session);
        copyFrom = occurrence.end;
    }
    localized += markdown.slice(copyFrom);

    const resources = resolutions.flatMap(({ entries }) => entries);
    const resolvedResources = new Map<string, ResolvedResource>();
    const uniqueKeys = new Set<string>();
    for (const resolution of resolutions) {
        for (const [key, resource] of resolution.resolvedResources) {
            resolvedResources.set(key, resource);
        }
        for (const key of resolution.uniqueKeys) uniqueKeys.add(key);
    }
    const resolvedCount = resources.filter(({ status }) => status === "resolved").length;
    const placeholderCount = resources.filter(({ status }) => status === "placeholder").length;
    const failedCount = resources.filter(({ status }) => status === "failed").length;
    return {
        markdown: localized,
        resolvedResources,
        uniqueKeys,
        report: {
            complete: placeholderCount === 0 && failedCount === 0,
            resolvedCount,
            placeholderCount,
            failedCount,
            uniqueResourceCount: uniqueKeys.size,
            totalResolvedBytes: [...resolvedResources.values()].reduce(
                (total, resource) => total + resource.byteLength,
                0,
            ),
            resources,
        },
    };
}

/**
 * Localize only resources explicitly referenced by the supplied Markdown.
 * Literal inline/fenced/indented code is never inspected. The caller owns the
 * AbortSignal and should reuse one cache for the lifetime of a Share Card Modal.
 */
export async function localizeShareCardResources(
    app: App,
    markdown: string,
    context: ShareCardResourceContext = {},
    options: ShareCardResourceLocalizerOptions = {},
): Promise<LocalizedShareCardResources> {
    throwIfAborted(context.signal);
    const limits = normalizeLimits(options.limits);
    const cache = context.cache ?? createShareCardResourceCache();
    const requestUrl: ShareCardRequestUrl = options.requestUrl
        ?? ((request) => obsidianRequestUrl(request));
    const placeholderText = options.placeholderText ?? defaultPlaceholderText;
    const deadline = limits.sessionTimeoutMs > 0
        ? Date.now() + limits.sessionTimeoutMs
        : Number.POSITIVE_INFINITY;
    const session: ShareCardResourceSession = {
        app,
        cache,
        context,
        deadline,
        limits,
        nextResourceId: 1,
        outputBudget: new ShareCardLocalizedOutputBudget(limits.maxLocalizedOutputBytes),
        placeholderText,
        requestUrl,
        resolveSubpath: options.resolveSubpath ?? obsidianResolveSubpath,
        scheduler: new ShareCardResourceScheduler(limits.maxConcurrency, context.signal, deadline),
    };
    const ancestors = new Set<string>();
    if (context.resourceBasePath) ancestors.add(context.resourceBasePath);
    const localized = await localizeShareCardResourcesInternal(
        markdown,
        context.resourceBasePath ?? "",
        0,
        ancestors,
        session,
    );
    return {
        markdown: localized.markdown,
        report: localized.report,
    };
}
