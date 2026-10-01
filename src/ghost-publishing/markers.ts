import type { GhostClient, GhostPost, GhostRequestGate } from "./client";
import type { GhostLocalOperation } from "./state-schema";

export type GhostMarkerCarrier = Pick<GhostLocalOperation, "operationId" | "noteUid" | "kind">
    & Partial<Pick<GhostLocalOperation, "markerVersion">>;

export const GHOST_INTERNAL_MARKER = /^(?:#pa-ghost-(?:op|preview)-[a-zA-Z0-9_-]{1,128}|#PA (?:Draft|Note|Preview) [a-zA-Z0-9_-]{1,128})$/i;

export function ghostOperationMarkers(operation: GhostMarkerCarrier): [string, string] {
    if (operation.markerVersion === 2) {
        return [
            `#PA Draft ${operation.operationId}`,
            operation.kind === "create"
                ? `#PA Note ${operation.noteUid}`
                : `#PA Preview ${operation.noteUid}`,
        ];
    }
    return [
        `#pa-ghost-op-${operation.operationId}`,
        `#pa-ghost-${operation.kind === "create" ? "op" : "preview"}-${operation.noteUid}`,
    ];
}

export function ghostSourceNoteMarkers(noteUid: string): string[] {
    return [
        `#PA Note ${noteUid}`,
        `#PA Preview ${noteUid}`,
        `#pa-ghost-op-${noteUid}`,
        `#pa-ghost-preview-${noteUid}`,
    ];
}

export async function findPostsBySourceMarkers(options: {
    client: Pick<GhostClient, "findPostsByMarker">;
    noteUid: string;
    gate: GhostRequestGate;
}): Promise<GhostPost[]> {
    const markers = ghostSourceNoteMarkers(options.noteUid);
    const byId = new Map<string, GhostPost>();
    for (const marker of markers) {
        const posts = await options.client.findPostsByMarker(marker, options.gate, true);
        for (const post of posts) byId.set(post.id, post);
    }
    return [...byId.values()];
}
