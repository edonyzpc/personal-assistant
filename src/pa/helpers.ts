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
