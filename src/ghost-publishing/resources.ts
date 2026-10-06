import type { TaskSourceReadGuard } from "../ai-services/task-source-read-guard";
import type { GhostClient, GhostRequestGate } from "./client";
import type { GhostStoredResource } from "./state-schema";
import type { ExportResourcePlan, GhostPublishingSourceFile } from "./types";

export const GHOST_MAX_RESOURCE_BYTES = 32 * 1024 * 1024;

const IMAGE_TYPES: Readonly<Record<string, string>> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", svg: "image/svg+xml", avif: "image/avif", bmp: "image/bmp",
};

export interface GhostResourceOptions {
    host: {
        vault: {
            getAbstractFileByPath(path: string): GhostPublishingSourceFile | null;
            readBinary(file: GhostPublishingSourceFile): Promise<ArrayBuffer>;
        };
    };
    client: Pick<GhostClient, "downloadImage">;
    isDesktop(): boolean;
    guard: TaskSourceReadGuard;
    /** The receipt captured when the export's source tree was loaded. */
    sourceValidity(): boolean;
    gate: GhostRequestGate;
    siteId: string;
    siteUrl: string;
}

export interface GhostPreparedResource {
    /** A URL is present only when the resource can already be reused. */
    metadata: GhostStoredResource;
    bytes: Uint8Array;
    filename: string;
}

export type GhostResourceErrorCode = "desktop-required" | "cancelled" | "source-revoked"
    | "context-revoked" | "web-denied" | "invalid-resource" | "unsupported-image"
    | "resource-too-large" | "read-failed" | "hash-failed";

export class GhostResourceError extends Error {
    constructor(readonly code: GhostResourceErrorCode) {
        // No original error, source URL, bytes, request payload or credentials.
        super(`Ghost resource: ${code}.`);
        this.name = "GhostResourceError";
    }
}

function fail(code: GhostResourceErrorCode): never {
    throw new GhostResourceError(code);
}

function validPath(path: string): boolean {
    return typeof path === "string" && path.length > 0 && path.length <= 4096
        && !path.startsWith("/") && !/[\\\0\r\n]/.test(path)
        && !path.split("/").some((part) => !part || part === "." || part === "..");
}

function webUrl(value: string): URL {
    try {
        const url = new URL(value);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) fail("invalid-resource");
        return url;
    } catch { return fail("invalid-resource"); }
}

function siteUrl(value: string): URL {
    const url = webUrl(value);
    if (url.search || url.hash) fail("invalid-resource");
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
    return url;
}

function directImageUrl(value: string, site: URL): string | undefined {
    const url = webUrl(value);
    if (url.origin !== site.origin || !url.pathname.startsWith(`${site.pathname}content/images/`)) return;
    try {
        // Encoded path separators must not turn the image prefix into another route.
        if (url.pathname.split("/").some((part) => /[\\/\0\r\n]/.test(decodeURIComponent(part))
            || [".", ".."].includes(decodeURIComponent(part)))) return;
    } catch { return; }
    if (url.pathname.endsWith("/")) return;
    url.hash = "";
    return url.href;
}

/** Reads only an explicit export resource; never uploads or changes durable state. */
export async function prepareGhostResource(
    plan: ExportResourcePlan, options: GhostResourceOptions,
): Promise<GhostPreparedResource> {
    try {
        return await prepareResource(plan, options);
    } catch (error) {
        if (error instanceof GhostResourceError) throw error;
        throw new GhostResourceError("invalid-resource");
    }
}

async function prepareResource(plan: ExportResourcePlan, options: GhostResourceOptions): Promise<GhostPreparedResource> {
    const { guard, gate, sourceValidity, isDesktop, siteId } = options;
    const { id, source, resolvedPath, kind } = plan;
    const ownerPaths = [...new Set(plan.occurrences.map((occurrence) => occurrence.path))];
    const network = kind === "remote";
    let assertFileCurrent = (): void => undefined;
    const assertCurrent = (): void => {
        if (isDesktop() !== true) fail("desktop-required");
        if (gate?.signal?.aborted) fail("cancelled");
        try {
            if (!guard || guard.isCurrent() !== true || typeof sourceValidity !== "function" || sourceValidity() !== true
                || guard.isNoteDomainAllowed?.() === false
                || ownerPaths.some((path) => !validPath(path) || guard.isPathAllowed(path, "task_material") !== true)
                || (kind === "local" && (!resolvedPath || !validPath(resolvedPath)
                    || guard.isPathAllowed(resolvedPath, "task_material") !== true))) fail("source-revoked");
        } catch { fail("source-revoked"); }
        try {
            if (network && guard.isWebAllowed?.() !== true) fail("web-denied");
        } catch { fail("web-denied"); }
        try {
            if (!gate || typeof gate.beforeSend !== "function" || typeof gate.assertCurrent !== "function") fail("context-revoked");
            gate.assertCurrent();
        } catch { fail("context-revoked"); }
        assertFileCurrent();
    };
    const readGate: GhostRequestGate = {
        signal: gate?.signal,
        assertCurrent,
        beforeSend: async () => {
            assertCurrent();
            try { await gate.beforeSend(); } catch { fail("context-revoked"); }
            assertCurrent();
        },
    };
    assertCurrent();
    if (!id || typeof source !== "string" || !source || !ownerPaths.length || !["local", "remote"].includes(kind)) fail("invalid-resource");
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(siteId)) fail("invalid-resource");
    const site = siteUrl(options.siteUrl);
    let bytes: Uint8Array;
    let mimeType: string;
    if (kind === "local") {
        const path = resolvedPath as string;
        const extension = path.split(".").pop()?.toLowerCase() ?? "";
        mimeType = IMAGE_TYPES[extension];
        if (typeof mimeType !== "string") fail("unsupported-image");
        await readGate.beforeSend();
        const file = options.host.vault.getAbstractFileByPath(path);
        if (!file || file.path !== path || file.extension.toLowerCase() !== extension) fail("invalid-resource");
        if (file.stat?.size !== undefined && file.stat.size > GHOST_MAX_RESOURCE_BYTES) fail("resource-too-large");
        const beforeStat = { ...file.stat };
        assertFileCurrent = () => {
            const currentFile = options.host.vault.getAbstractFileByPath(path);
            for (const candidate of [file, currentFile]) {
                if (!candidate || candidate.path !== path || candidate.extension.toLowerCase() !== extension
                    || candidate.stat?.mtime !== beforeStat.mtime || candidate.stat?.ctime !== beforeStat.ctime
                    || candidate.stat?.size !== beforeStat.size) fail("source-revoked");
            }
        };
        assertCurrent();
        let binary: ArrayBuffer;
        try { binary = await options.host.vault.readBinary(file); }
        catch { assertCurrent(); return fail("read-failed"); }
        assertCurrent();
        if (!(binary instanceof ArrayBuffer)) fail("invalid-resource");
        if (binary.byteLength > GHOST_MAX_RESOURCE_BYTES) fail("resource-too-large");
        bytes = new Uint8Array(binary.slice(0));
    } else {
        webUrl(source);
        let downloaded;
        try { downloaded = await options.client.downloadImage(source, readGate); }
        catch { assertCurrent(); return fail("read-failed"); }
        assertCurrent();
        if (!(downloaded.bytes instanceof Uint8Array)) fail("invalid-resource");
        if (downloaded.bytes.byteLength > GHOST_MAX_RESOURCE_BYTES) fail("resource-too-large");
        bytes = new Uint8Array(downloaded.bytes);
        mimeType = downloaded.mimeType;
    }
    if (!bytes.byteLength) fail("invalid-resource");
    const extension = Object.keys(IMAGE_TYPES).find((key) => IMAGE_TYPES[key] === mimeType);
    if (!extension) fail("unsupported-image");
    let byteHash: string;
    try {
        const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
        byteHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    } catch { assertCurrent(); return fail("hash-failed"); }
    assertCurrent();
    const url = network ? directImageUrl(source, site) : undefined;
    return {
        metadata: { id, source, ...(kind === "local" ? { resolvedPath } : {}), byteHash, byteLength: bytes.byteLength, mimeType, ...(url ? { url } : {}) },
        bytes,
        // A deterministic safe upload name avoids leaking vault paths into multipart headers.
        filename: `${byteHash}.${extension}`,
    };
}
