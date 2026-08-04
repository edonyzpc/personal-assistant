import type { PersistedSourceRef, ReviewQueueScope } from "./contracts";

export function normalizeVaultPath(path: string): string {
    return String(path ?? "")
        .trim()
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
        .replace(/\/+/g, "/")
        .replace(/\/$/g, "");
}

export function stableHash(text: string): string {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function includesString<T extends readonly string[]>(
    values: T,
    value: unknown,
): value is T[number] {
    return typeof value === "string" && (values as readonly string[]).includes(value);
}

export function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

export function normalizeTag(tag: string): string {
    return tag.trim().replace(/^#+/, "").toLowerCase();
}

export function parentFolder(path: string): string {
    const normalized = normalizeVaultPath(path);
    const lastSlash = normalized.lastIndexOf("/");
    return lastSlash > 0 ? normalized.slice(0, lastSlash) : "";
}

export function basenameFromPath(path: string): string {
    const name = normalizeVaultPath(path).split("/").pop() ?? path;
    return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}

export function noteTitleFromPath(path: string): string {
    return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}

export function uniqueStrings(values: readonly string[]): string[] {
    return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

export const UNDO_RETENTION_MS = 7 * 24 * 60 * 60_000;

export function cloneSourceRef(ref: PersistedSourceRef): PersistedSourceRef {
    return {
        ...ref,
        whyShown: ref.whyShown ? [...ref.whyShown] : undefined,
    };
}

export function cloneScope(scope: ReviewQueueScope): ReviewQueueScope {
    return {
        ...scope,
        paths: scope.paths ? [...scope.paths] : undefined,
        tags: scope.tags ? [...scope.tags] : undefined,
    };
}
