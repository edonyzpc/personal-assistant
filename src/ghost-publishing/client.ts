import type { GhostDesktopTransport } from "./desktop-transport";

export type GhostPostStatus = "draft" | "published" | "scheduled" | "sent";
export type GhostVisibility = "public" | "members" | "paid" | "tiers";

export interface GhostTag {
    id?: string;
    name: string;
    slug?: string;
    visibility?: "public" | "internal";
}

export interface GhostAuthor {
    id: string;
    name?: string;
    slug?: string;
}

/** Only fields needed for identity, rendering and the managed-content baseline. */
export interface GhostPost {
    id: string;
    uuid: string;
    status: GhostPostStatus;
    updated_at: string;
    created_at?: string;
    url: string;
    slug: string;
    title: string;
    lexical: string | null;
    tags: GhostTag[];
    authors: GhostAuthor[];
    visibility: GhostVisibility;
    custom_template: string | null;
    feature_image: string | null;
    feature_image_alt: string | null;
    feature_image_caption: string | null;
    custom_excerpt: string | null;
    meta_description?: string | null;
    codeinjection_head: string | null;
    codeinjection_foot: string | null;
    published_at: string | null;
}

/** Explicit projection: a remote response must never be spread into an update. */
export interface GhostPostWrite {
    title?: string;
    slug?: string;
    lexical?: string | null;
    status?: "draft" | "published";
    tags?: Array<{ id?: string; name?: string; slug?: string; visibility?: "public" | "internal" }>;
    authors?: Array<{ id: string }>;
    visibility?: GhostVisibility;
    custom_template?: string | null;
    feature_image?: string | null;
    feature_image_alt?: string | null;
    feature_image_caption?: string | null;
    custom_excerpt?: string | null;
    meta_description?: string | null;
    codeinjection_head?: string | null;
    codeinjection_foot?: string | null;
    published_at?: string | null;
}

export interface GhostRequestGate {
    /** Host rechecks source authority, identity, connection and cancellation after awaits. */
    beforeSend(): Promise<void>;
    /** Synchronous final check immediately before the transport calls request.end. */
    assertCurrent(): void;
    signal?: AbortSignal;
}

export type GhostClientErrorCode =
    | "unsupported-platform" | "invalid-input" | "invalid-credentials"
    | "gate-rejected" | "cancelled" | "timeout" | "network"
    | "response-too-large" | "invalid-response" | "redirect"
    | "http" | "conflict" | "post-not-found";

export class GhostClientError extends Error {
    constructor(
        readonly code: GhostClientErrorCode,
        readonly outcome: "not-sent" | "failed" | "unknown",
        readonly status?: number,
    ) {
        // Never attach transport errors/causes, URLs, response bodies or secrets.
        super(`Ghost request: ${code}${status === undefined ? "" : ` (HTTP ${status})`}`);
        this.name = "GhostClientError";
    }
}

export interface GhostTransportRequest {
    url: string;
    method: "GET" | "POST" | "PUT" | "DELETE";
    headers: Readonly<Record<string, string>>;
    body?: Uint8Array;
    gate: GhostRequestGate;
    timeoutMs: number;
    maxResponseBytes: number;
    /** Called synchronously just before request.end, never before the final gate. */
    onDispatch(): void;
}

export interface GhostTransportResponse {
    status: number;
    headers: Readonly<Record<string, string | undefined>>;
    body: Uint8Array;
}

export type GhostTransport = (request: GhostTransportRequest) => Promise<GhostTransportResponse>;

export interface GhostClientOptions {
    /** Fixed Host configuration, including an optional Ghost site subdirectory. */
    siteUrl: string;
    isDesktop(): boolean;
    getAdminKey(): Promise<string>;
    transport?: GhostTransport;
    timeoutMs?: number;
    maxResponseBytes?: number;
    maxImageBytes?: number;
}

export interface GhostImageUpload {
    bytes: Uint8Array;
    filename: string;
    mimeType: string;
}

export interface GhostDownloadedImage {
    bytes: Uint8Array;
    mimeType: string;
}

const POST_ID = /^[a-f\d]{24}$/i;
const POST_UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_REDIRECTS = 3;
const NULLABLE_FIELDS = [
    "custom_template", "feature_image", "feature_image_alt", "feature_image_caption",
    "custom_excerpt", "codeinjection_head", "codeinjection_foot", "published_at",
    "meta_description",
] as const;

function invalidInput(): never {
    throw new GhostClientError("invalid-input", "not-sent");
}

function object(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
}

function isTimestamp(value: unknown): value is string {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
        && Number.isFinite(Date.parse(value));
}

function isVisibility(value: unknown): value is GhostVisibility {
    return value === "public" || value === "members" || value === "paid" || value === "tiers";
}

function httpUrl(value: string): URL {
    try {
        const url = new URL(value);
        if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
            return invalidInput();
        }
        return url;
    } catch {
        return invalidInput();
    }
}

function limit(value: number | undefined, fallback: number): number {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || value <= 0 || value > fallback) return invalidInput();
    return value;
}

function postWrite(value: GhostPostWrite): GhostPostWrite {
    const input = object(value);
    if (!input) return invalidInput();
    const result: GhostPostWrite = {};
    for (const key of ["title", "slug"] as const) {
        if (input[key] !== undefined) {
            if (typeof input[key] !== "string" || !input[key]) return invalidInput();
            result[key] = input[key];
        }
    }
    for (const key of ["lexical", ...NULLABLE_FIELDS] as const) {
        const field = input[key];
        if (field !== undefined) {
            if (field !== null && typeof field !== "string") return invalidInput();
            if (key === "published_at" && field !== null && !isTimestamp(field)) return invalidInput();
            result[key] = field;
        }
    }
    if (input.status !== undefined) {
        if (input.status !== "draft" && input.status !== "published") return invalidInput();
        result.status = input.status;
    }
    if (input.visibility !== undefined) {
        if (!isVisibility(input.visibility)) return invalidInput();
        result.visibility = input.visibility;
    }
    if (input.tags !== undefined) {
        if (!Array.isArray(input.tags) || input.tags.length > 500) return invalidInput();
        result.tags = input.tags.map((raw) => {
            const tag = object(raw);
            if (!tag || !(typeof tag.name === "string" && tag.name.length > 0 || typeof tag.id === "string" && POST_ID.test(tag.id))) {
                return invalidInput();
            }
            const projected: NonNullable<GhostPostWrite["tags"]>[number] = {};
            for (const key of ["id", "name", "slug"] as const) {
                if (tag[key] !== undefined) {
                    if (typeof tag[key] !== "string" || !tag[key] || key === "id" && !POST_ID.test(tag[key])) return invalidInput();
                    projected[key] = tag[key];
                }
            }
            if (tag.visibility !== undefined) {
                if (tag.visibility !== "public" && tag.visibility !== "internal") return invalidInput();
                projected.visibility = tag.visibility;
            }
            return projected;
        });
    }
    if (input.authors !== undefined) {
        if (!Array.isArray(input.authors) || input.authors.length > 100) return invalidInput();
        result.authors = input.authors.map((raw) => {
            const author = object(raw);
            if (!author || typeof author.id !== "string" || !POST_ID.test(author.id)) return invalidInput();
            return { id: author.id };
        });
    }
    return result;
}

function parsePost(raw: unknown): GhostPost {
    const value = object(raw);
    if (!value || typeof value.id !== "string" || !POST_ID.test(value.id)
        || typeof value.uuid !== "string" || !POST_UUID.test(value.uuid)
        || !["draft", "published", "scheduled", "sent"].includes(String(value.status))
        || !isTimestamp(value.updated_at) || (value.created_at !== undefined && !isTimestamp(value.created_at))
        || typeof value.title !== "string"
        || typeof value.slug !== "string" || !value.slug || typeof value.url !== "string"
        || !(value.lexical === null || typeof value.lexical === "string")
        || !isVisibility(value.visibility) || !Array.isArray(value.tags) || !Array.isArray(value.authors)) {
        throw new Error("Invalid post");
    }
    httpUrl(value.url);
    const nullable: Record<string, string | null> = {};
    for (const key of NULLABLE_FIELDS) {
        const field = value[key];
        if (field !== null && typeof field !== "string") throw new Error("Invalid post");
        if (key === "published_at" && field !== null && !isTimestamp(field)) throw new Error("Invalid post");
        nullable[key] = field;
    }
    const tags: GhostTag[] = value.tags.map((rawTag) => {
        const tag = object(rawTag);
        if (!tag || typeof tag.name !== "string" || !tag.name) throw new Error("Invalid tag");
        const projected: GhostTag = { name: tag.name };
        if (tag.id !== undefined) {
            if (typeof tag.id !== "string" || !POST_ID.test(tag.id)) throw new Error("Invalid tag");
            projected.id = tag.id;
        }
        if (tag.slug !== undefined) {
            if (typeof tag.slug !== "string") throw new Error("Invalid tag");
            projected.slug = tag.slug;
        }
        if (tag.visibility !== undefined) {
            if (tag.visibility !== "public" && tag.visibility !== "internal") throw new Error("Invalid tag");
            projected.visibility = tag.visibility;
        }
        return projected;
    });
    const authors: GhostAuthor[] = value.authors.map((rawAuthor) => {
        const author = object(rawAuthor);
        if (!author || typeof author.id !== "string" || !POST_ID.test(author.id)) throw new Error("Invalid author");
        const projected: GhostAuthor = { id: author.id };
        for (const key of ["name", "slug"] as const) {
            if (author[key] !== undefined) {
                if (typeof author[key] !== "string") throw new Error("Invalid author");
                projected[key] = author[key];
            }
        }
        return projected;
    });
    return {
        id: value.id, uuid: value.uuid, status: value.status as GhostPostStatus,
        updated_at: value.updated_at, url: value.url, title: value.title, slug: value.slug,
        ...(value.created_at !== undefined ? { created_at: value.created_at as string } : {}),
        lexical: value.lexical, visibility: value.visibility, tags, authors,
        custom_template: nullable.custom_template, feature_image: nullable.feature_image,
        feature_image_alt: nullable.feature_image_alt, feature_image_caption: nullable.feature_image_caption,
        custom_excerpt: nullable.custom_excerpt, meta_description: nullable.meta_description,
        codeinjection_head: nullable.codeinjection_head,
        codeinjection_foot: nullable.codeinjection_foot, published_at: nullable.published_at,
    };
}

export class GhostClient {
    readonly siteUrl: string;
    private readonly adminUrl: string;
    private readonly timeoutMs: number;
    private readonly maxResponseBytes: number;
    private readonly maxImageBytes: number;

    constructor(private readonly options: GhostClientOptions) {
        const site = httpUrl(options.siteUrl);
        if (site.search || site.hash || /%2f|%5c/i.test(site.pathname)) invalidInput();
        site.pathname = `${site.pathname.replace(/\/+$/, "")}/`;
        this.siteUrl = site.href;
        this.adminUrl = new URL("ghost/api/admin/", site).href;
        this.timeoutMs = limit(options.timeoutMs, 30_000);
        this.maxResponseBytes = limit(options.maxResponseBytes, MAX_JSON_BYTES);
        this.maxImageBytes = limit(options.maxImageBytes, MAX_IMAGE_BYTES);
    }

    async readPost(id: string, gate: GhostRequestGate): Promise<GhostPost> {
        this.checkId(id);
        const response = await this.admin("GET", `posts/${id}/`, gate);
        return this.onePost(response, false, id);
    }

    async createDraft(fields: GhostPostWrite, gate: GhostRequestGate): Promise<GhostPost> {
        const post = postWrite(fields);
        post.status = "draft";
        const response = await this.admin("POST", "posts/", gate, { posts: [post] });
        const result = this.onePost(response, true);
        if (result.status !== "draft") throw new GhostClientError("invalid-response", "unknown", response.status);
        return result;
    }

    async updatePost(id: string, updatedAt: string, fields: GhostPostWrite, gate: GhostRequestGate): Promise<GhostPost> {
        this.checkId(id);
        if (!isTimestamp(updatedAt)) invalidInput();
        const post = { ...postWrite(fields), updated_at: updatedAt };
        const response = await this.admin("PUT", `posts/${id}/`, gate, { posts: [post] });
        return this.onePost(response, true, id);
    }

    /** Service must first GET and verify exact task ownership, draft status and version. */
    async deleteDraft(id: string, gate: GhostRequestGate): Promise<void> {
        this.checkId(id);
        const response = await this.admin("DELETE", `posts/${id}/`, gate);
        if (response.status !== 204 || response.body.length !== 0) {
            throw new GhostClientError("invalid-response", "unknown", response.status);
        }
    }

    async uploadImage(image: GhostImageUpload, gate: GhostRequestGate): Promise<{ url: string }> {
        this.checkGate(gate);
        if (!(image.bytes instanceof Uint8Array) || !image.bytes.length || image.bytes.length > this.maxImageBytes
            || !/^image\/[a-z\d.+-]+$/i.test(image.mimeType) || typeof image.filename !== "string"
            || !image.filename || image.filename.length > 255 || /[\r\n\0"\\/]/.test(image.filename)) invalidInput();
        const desktop = await this.desktop();
        const multipart = await desktop.createImageMultipart(image);
        const response = await this.admin("POST", "images/upload/", gate, undefined, undefined, multipart);
        return this.parseResponse(response, true, (body) => {
            if (!Array.isArray(body.images) || body.images.length !== 1) throw new Error("Invalid images");
            const image = object(body.images[0]);
            if (!image || typeof image.url !== "string") throw new Error("Invalid image URL");
            return { url: httpUrl(image.url).href };
        });
    }

    async downloadImage(value: string, gate: GhostRequestGate): Promise<GhostDownloadedImage> {
        this.checkGate(gate);
        let url = httpUrl(value);
        url.hash = "";
        const desktop = await this.desktop();
        for (let hop = 0; hop <= MAX_IMAGE_REDIRECTS; hop++) {
            const response = await this.send({
                url: url.href, method: "GET", headers: { Accept: "image/*" },
                gate, maxResponseBytes: this.maxImageBytes,
            }, desktop, false);
            if (response.status >= 300 && response.status < 400) {
                const location = response.headers.location;
                if (!location || hop === MAX_IMAGE_REDIRECTS) throw new GhostClientError("redirect", "failed", response.status);
                try {
                    url = httpUrl(new URL(location, url).href);
                    url.hash = "";
                } catch {
                    throw new GhostClientError("redirect", "failed", response.status);
                }
                continue;
            }
            this.checkStatus(response, false);
            const mimeType = response.headers["content-type"]?.split(";")[0].trim().toLowerCase();
            if (!mimeType || !/^image\/[a-z\d.+-]+$/.test(mimeType) || !response.body.length) {
                throw new GhostClientError("invalid-response", "failed", response.status);
            }
            return { bytes: response.body, mimeType };
        }
        throw new GhostClientError("redirect", "failed");
    }

    private checkId(id: string): void {
        if (!POST_ID.test(id)) invalidInput();
    }

    private checkGate(gate: GhostRequestGate): void {
        if (!this.options.isDesktop()) throw new GhostClientError("unsupported-platform", "not-sent");
        if (!gate || typeof gate.beforeSend !== "function" || typeof gate.assertCurrent !== "function") {
            throw new GhostClientError("gate-rejected", "not-sent");
        }
        if (gate.signal?.aborted) throw new GhostClientError("cancelled", "not-sent");
        try {
            gate.assertCurrent();
        } catch {
            throw new GhostClientError("gate-rejected", "not-sent");
        }
    }

    private async desktop(): Promise<GhostDesktopTransport> {
        if (!this.options.isDesktop()) throw new GhostClientError("unsupported-platform", "not-sent");
        try {
            // No Node builtins (including crypto) are loaded by the mobile branch.
            return await import("./desktop-transport");
        } catch {
            throw new GhostClientError("unsupported-platform", "not-sent");
        }
    }

    private async admin(
        method: GhostTransportRequest["method"], path: string, gate: GhostRequestGate,
        data?: unknown, query?: URLSearchParams, multipart?: { body: Uint8Array; contentType: string },
    ): Promise<GhostTransportResponse> {
        this.checkGate(gate);
        const url = new URL(path, this.adminUrl);
        if (query) url.search = query.toString();
        if (path.startsWith("posts/") && method !== "DELETE") url.searchParams.set("formats", "lexical");
        const body = multipart?.body ?? (data === undefined ? undefined : new TextEncoder().encode(JSON.stringify(data)));
        if (!multipart && body && body.length > this.maxResponseBytes) invalidInput();
        const desktop = await this.desktop();
        let token: string;
        try {
            const key = await this.options.getAdminKey();
            token = await desktop.createAdminToken(key);
        } catch {
            throw new GhostClientError("invalid-credentials", "not-sent");
        }
        const response = await this.send({
            url: url.href, method, body, gate, maxResponseBytes: this.maxResponseBytes,
            headers: {
                Accept: "application/json", "Accept-Version": "v6.0", Authorization: `Ghost ${token}`,
                ...(body ? { "Content-Type": multipart?.contentType ?? "application/json" } : {}),
            },
        }, desktop, method !== "GET");
        this.checkStatus(response, method !== "GET", method === "GET" && /^posts\/[a-f\d]{24}\/$/i.test(path));
        const expectedStatus = method === "POST" ? 201 : method === "DELETE" ? 204 : 200;
        if (response.status !== expectedStatus) {
            throw new GhostClientError("invalid-response", method === "GET" ? "failed" : "unknown", response.status);
        }
        return response;
    }

    private async send(
        request: Omit<GhostTransportRequest, "timeoutMs" | "onDispatch">,
        desktop: GhostDesktopTransport, write: boolean,
    ): Promise<GhostTransportResponse> {
        let sent = false;
        const originalGate = request.gate;
        const gate: GhostRequestGate = {
            signal: originalGate.signal,
            beforeSend: async () => {
                this.checkGate(originalGate);
                try {
                    await originalGate.beforeSend();
                } catch {
                    throw new GhostClientError("gate-rejected", "not-sent");
                }
            },
            assertCurrent: () => this.checkGate(originalGate),
        };
        try {
            return await (this.options.transport ?? desktop.sendDesktopRequest)({
                ...request, gate, timeoutMs: this.timeoutMs, onDispatch: () => { sent = true; },
            });
        } catch (error) {
            const code = error instanceof GhostClientError ? error.code : "network";
            throw new GhostClientError(code, write && sent ? "unknown" : sent ? "failed" : "not-sent");
        }
    }

    private checkStatus(response: GhostTransportResponse, write: boolean, exactPostRead = false): void {
        if (response.status >= 200 && response.status < 300) return;
        if (response.status === 409) throw new GhostClientError("conflict", "failed", 409);
        if (exactPostRead && response.status === 404) {
            // A route/proxy HTML 404 is not evidence that this exact post is absent.
            try {
                const body = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.body)));
                const errors = body?.errors;
                if (Array.isArray(errors) && errors.length === 1 && object(errors[0])?.type === "NotFoundError") {
                    throw new GhostClientError("post-not-found", "failed", 404);
                }
            } catch (error) {
                if (error instanceof GhostClientError) throw error;
            }
        }
        const redirect = response.status >= 300 && response.status < 400;
        // A proxy/request timeout is not proof the upstream rejected a write.
        const knownFailure = [400, 401, 403, 404, 405, 406, 410, 411, 413, 414, 415, 422, 429].includes(response.status);
        throw new GhostClientError(redirect ? "redirect" : "http", write && !knownFailure ? "unknown" : "failed", response.status);
    }

    private parseResponse<T>(response: GhostTransportResponse, write: boolean, parse: (body: Record<string, unknown>) => T): T {
        try {
            const body = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.body)));
            if (!body) throw new Error("Invalid body");
            return parse(body);
        } catch {
            throw new GhostClientError("invalid-response", write ? "unknown" : "failed", response.status);
        }
    }

    private onePost(response: GhostTransportResponse, write: boolean, expectedId?: string): GhostPost {
        return this.parseResponse(response, write, (body) => {
            if (!Array.isArray(body.posts) || body.posts.length !== 1) throw new Error("Invalid posts");
            const post = parsePost(body.posts[0]);
            if (expectedId !== undefined && post.id !== expectedId) throw new Error("Identity mismatch");
            return post;
        });
    }
}
