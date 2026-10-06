export const GHOST_ID_PROPERTY = "GHOST_ID";

const POST_ID = /^[a-f\d]{24}$/i;

export type GhostBindingProperties =
    | { status: "none" }
    | { status: "invalid" }
    | { status: "bound"; postId: string };

/** Association is independent of publication content and ignores all old keys. */
export function ghostBindingProperties(frontmatter: Record<string, unknown>): GhostBindingProperties {
    if (!Object.prototype.hasOwnProperty.call(frontmatter, GHOST_ID_PROPERTY)) return { status: "none" };
    const postId = frontmatter[GHOST_ID_PROPERTY];
    return typeof postId === "string" && POST_ID.test(postId)
        ? { status: "bound", postId: postId.toLowerCase() }
        : { status: "invalid" };
}

export function writeGhostIdProperty(frontmatter: Record<string, unknown>, postId: string): void {
    frontmatter[GHOST_ID_PROPERTY] = postId;
}
