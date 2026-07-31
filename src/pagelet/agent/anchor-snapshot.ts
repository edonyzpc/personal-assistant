import type { AiServiceHost } from "../../ai-services/AiServiceHost";
import { getPlatformCrypto } from "../../platform-dom";
import { normalizeVaultPath, stableHash } from "../../pa/helpers";
import type {
    PageletAgentSourceMaterial,
    PageletAgentSourceSnapshot,
    PageletAnchorSnapshot,
    PageletAnchorSnapshotIdentity,
} from "./types";

interface SnapshotCaptureOptions {
    host: AiServiceHost;
    path: string;
    isPathAllowed?: (path: string) => boolean;
    now?: () => number;
    signal?: AbortSignal;
}

interface VaultFileLike {
    path: string;
    stat?: {
        mtime?: number;
        size?: number;
    };
}

interface VaultLike {
    getAbstractFileByPath?: (path: string) => unknown;
    getMarkdownFiles?: () => VaultFileLike[];
    cachedRead?: (file: VaultFileLike) => Promise<string>;
}

export async function capturePageletAnchorSnapshot(
    options: SnapshotCaptureOptions,
): Promise<PageletAnchorSnapshot | null> {
    const material = await capturePageletSourceMaterial(options);
    if (!material) return null;
    return {
        path: material.path,
        content: material.content,
        mtime: material.mtime,
        size: material.size,
        contentHash: material.contentHash,
        capturedAt: material.capturedAt,
    };
}

export async function capturePageletSourceMaterial(
    options: SnapshotCaptureOptions,
): Promise<PageletAgentSourceMaterial | null> {
    throwIfAborted(options.signal);
    const path = normalizeSnapshotPath(options.path);
    if (!path || !path.toLowerCase().endsWith(".md")) return null;
    if (!isAllowed(path, options.isPathAllowed)) return null;

    const vault = options.host.app.vault as unknown as VaultLike;
    if (typeof vault.cachedRead !== "function") return null;
    const file = findMarkdownFile(vault, path);
    if (!file) return null;
    const before = readStat(file);
    if (!before) return null;

    const content = await vault.cachedRead(file);
    throwIfAborted(options.signal);
    const afterFile = findMarkdownFile(vault, path);
    if (afterFile !== file || afterFile.path !== path) return null;
    const after = readStat(afterFile);
    if (!after || before.mtime !== after.mtime || before.size !== after.size) return null;

    const contentHash = await hashPageletContent(content);
    throwIfAborted(options.signal);
    const finalFile = findMarkdownFile(vault, path);
    if (finalFile !== file || finalFile.path !== path) return null;
    const finalStat = readStat(finalFile);
    if (!finalStat || after.mtime !== finalStat.mtime || after.size !== finalStat.size) return null;
    if (!isAllowed(path, options.isPathAllowed)) return null;

    return {
        path,
        content,
        mtime: finalStat.mtime,
        size: finalStat.size,
        contentHash,
        capturedAt: (options.now ?? Date.now)(),
    };
}

export async function capturePageletSourceSnapshot(
    options: SnapshotCaptureOptions,
): Promise<PageletAgentSourceSnapshot | null> {
    const material = await capturePageletSourceMaterial(options);
    return material ? sourceSnapshotIdentity(material) : null;
}

export function anchorSnapshotIdentity(
    snapshot: PageletAnchorSnapshot,
): PageletAnchorSnapshotIdentity {
    return {
        path: snapshot.path,
        mtime: snapshot.mtime,
        size: snapshot.size,
        contentHash: snapshot.contentHash,
    };
}

export function sourceSnapshotIdentity(
    snapshot: PageletAgentSourceMaterial | PageletAnchorSnapshot,
): PageletAgentSourceSnapshot {
    return {
        path: snapshot.path,
        mtime: snapshot.mtime,
        size: snapshot.size,
        contentHash: snapshot.contentHash,
    };
}

export function sameSourceSnapshot(
    left: PageletAgentSourceSnapshot | PageletAnchorSnapshotIdentity,
    right: PageletAgentSourceSnapshot | PageletAnchorSnapshotIdentity,
): boolean {
    return left.path === right.path
        && left.mtime === right.mtime
        && left.size === right.size
        && left.contentHash === right.contentHash;
}

export function normalizeSnapshotPath(path: string): string | null {
    const normalized = normalizeVaultPath(path);
    if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return null;
    const segments = normalized.split("/");
    if (segments.some((segment) => segment === ".." || segment === "")) return null;
    return segments.filter((segment) => segment !== ".").join("/");
}

export async function hashPageletContent(content: string): Promise<string> {
    const subtle = getPlatformCrypto()?.subtle;
    if (subtle) {
        const digest = await subtle.digest("SHA-256", new TextEncoder().encode(content));
        return Array.from(new Uint8Array(digest))
            .map((value) => value.toString(16).padStart(2, "0"))
            .join("");
    }
    return [
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
        "g",
        "h",
    ].map((salt) => stableHash(`${salt}\u0000${content}`)).join("");
}

function findMarkdownFile(vault: VaultLike, path: string): VaultFileLike | null {
    const direct = vault.getAbstractFileByPath?.(path);
    if (isMarkdownFile(direct)) return direct;
    return (vault.getMarkdownFiles?.() ?? []).find((candidate) => candidate.path === path) ?? null;
}

function isMarkdownFile(value: unknown): value is VaultFileLike {
    return Boolean(
        value
        && typeof value === "object"
        && typeof (value as VaultFileLike).path === "string"
        && (value as VaultFileLike).path.toLowerCase().endsWith(".md"),
    );
}

function readStat(file: VaultFileLike): { mtime: number; size: number } | null {
    const mtime = file.stat?.mtime;
    const size = file.stat?.size;
    if (!Number.isFinite(mtime) || !Number.isFinite(size)) return null;
    return { mtime: mtime!, size: size! };
}

function isAllowed(path: string, predicate: SnapshotCaptureOptions["isPathAllowed"]): boolean {
    if (!predicate) return true;
    try {
        return predicate(path) === true;
    } catch {
        return false;
    }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
    if (!signal?.aborted) return;
    const error = new Error("Aborted");
    error.name = "AbortError";
    throw error;
}
