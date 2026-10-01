import type { GhostNoteBinding } from "./binding";

export const NATIVE_BINDING_KEYS = {
    uid: "pa_ghost",
    site: "pa_ghost_site",
    postId: "pa_ghost_post_id",
    postUrl: "pa_ghost_post_url",
} as const;

const BINDING_KEYS = new Set(["note_uid", "site", "post_id", "post_url"]);
const IDENTITY = /^[a-zA-Z0-9_-]{1,128}$/;

export type GhostBindingProperties =
    | { status: "none" }
    | { status: "invalid" }
    | { status: "bound"; value: Omit<GhostNoteBinding, "site"> & { site: string } };

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
}

function has(frontmatter: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(frontmatter, key);
}

function structuralBinding(noteUid: unknown, site: unknown, postId: unknown, postUrl: unknown): GhostBindingProperties {
    if (typeof noteUid !== "string" || noteUid === ""
        || typeof site !== "string" || site === "") return { status: "invalid" };
    const hasPostId = postId !== undefined;
    const hasPostUrl = postUrl !== undefined;
    if (hasPostId !== hasPostUrl || hasPostId && (typeof postId !== "string" || postId === "" || typeof postUrl !== "string" || postUrl === "")) {
        return { status: "invalid" };
    }
    return {
        status: "bound",
        value: {
            note_uid: noteUid,
            site,
            ...(hasPostId ? { post_id: postId as string, post_url: postUrl as string } : {}),
        },
    };
}

/** Shared structural semantics for the old object and native Text Properties. */
export function ghostBindingProperties(frontmatter: Record<string, unknown>): GhostBindingProperties {
    const uid = frontmatter[NATIVE_BINDING_KEYS.uid];
    const hasUid = has(frontmatter, NATIVE_BINDING_KEYS.uid);
    const hasSite = has(frontmatter, NATIVE_BINDING_KEYS.site);
    const hasPostId = has(frontmatter, NATIVE_BINDING_KEYS.postId);
    const hasPostUrl = has(frontmatter, NATIVE_BINDING_KEYS.postUrl);
    const hasCompanion = hasSite || hasPostId || hasPostUrl;
    if (!hasUid && !hasCompanion) return { status: "none" };

    if (typeof uid === "string") {
        if (!hasSite) return { status: "invalid" };
        return structuralBinding(uid, frontmatter[NATIVE_BINDING_KEYS.site],
            frontmatter[NATIVE_BINDING_KEYS.postId], frontmatter[NATIVE_BINDING_KEYS.postUrl]);
    }

    const legacy = record(uid);
    if (!legacy || Object.keys(legacy).some((key) => !BINDING_KEYS.has(key))) return { status: "invalid" };
    if (hasCompanion) {
        // A copied/mixed identity is migratable only when every native companion
        // is present and exactly matches the old object.
        if (!hasSite || !hasPostId || !hasPostUrl) return { status: "invalid" };
        if (legacy.site !== frontmatter[NATIVE_BINDING_KEYS.site]
            || legacy.post_id !== frontmatter[NATIVE_BINDING_KEYS.postId]
            || legacy.post_url !== frontmatter[NATIVE_BINDING_KEYS.postUrl]) return { status: "invalid" };
    }
    return structuralBinding(legacy.note_uid, legacy.site, legacy.post_id, legacy.post_url);
}

export function ghostBindingIdentity(frontmatter: Record<string, unknown> | null | undefined): string | null {
    if (!frontmatter) return null;
    const value = frontmatter[NATIVE_BINDING_KEYS.uid];
    if (typeof value === "string") return IDENTITY.test(value) ? value : null;
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const noteUid = (value as Record<string, unknown>).note_uid;
    return typeof noteUid === "string" && IDENTITY.test(noteUid) ? noteUid : null;
}

export function writeNativeBindingProperties(
    frontmatter: Record<string, unknown>,
    value: GhostNoteBinding,
): void {
    frontmatter[NATIVE_BINDING_KEYS.uid] = value.note_uid;
    frontmatter[NATIVE_BINDING_KEYS.site] = value.site;
    if (value.post_id === undefined || value.post_url === undefined) {
        delete frontmatter[NATIVE_BINDING_KEYS.postId];
        delete frontmatter[NATIVE_BINDING_KEYS.postUrl];
        return;
    }
    frontmatter[NATIVE_BINDING_KEYS.postId] = value.post_id;
    frontmatter[NATIVE_BINDING_KEYS.postUrl] = value.post_url;
}
