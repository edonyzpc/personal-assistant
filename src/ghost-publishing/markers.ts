import { stableHash } from "../pa/helpers";

/** Stable ownership of one preview resource, independent of any historical operation. */
export function ghostPreviewMarker(siteId: string, postId: string): string {
    return `#PA Preview ${stableHash(siteId)}-${postId}`;
}
