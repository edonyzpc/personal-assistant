import type { VSSChunk, VSSFileState } from "./types";

const PATH_EVIDENCE_REPRESENTATION_VERSION = "path-evidence-v1";

/**
 * Query-independent generation of the complete ordered evidence inventory for
 * one path. Selection limits are deliberately absent: an unselected chunk
 * change must still invalidate exact-repeat suppression.
 */
export function computePathEvidenceGeneration(
    fileState: VSSFileState,
    chunks: readonly VSSChunk[],
): string {
    const inventory = [...chunks]
        .sort((left, right) => left.chunkIndex - right.chunkIndex)
        .map((chunk) => {
            const metadata = chunk.metadata ?? {};
            return {
                chunkIndex: chunk.chunkIndex,
                chunkContentHash: evidenceHash(chunk.content),
                contentHash: chunk.contentHash,
                anchorContentHash: stringValue(metadata.contentHash),
                startLine: finiteIntegerOrNull(metadata.startLine),
                endLine: finiteIntegerOrNull(metadata.endLine),
                headingPath: Array.isArray(metadata.headingPath)
                    ? metadata.headingPath.filter((value): value is string => typeof value === "string")
                    : [],
                indexVersion: stringValue(metadata.indexVersion),
            };
        });
    return `peg1-${evidenceHash(JSON.stringify({
        path: fileState.path,
        contentHash: fileState.contentHash,
        mtime: fileState.mtime,
        size: fileState.size,
        inventory,
        representationVersion: PATH_EVIDENCE_REPRESENTATION_VERSION,
    }))}`;
}

function finiteIntegerOrNull(value: unknown): number | null {
    const numberValue = Number(value);
    return Number.isInteger(numberValue) ? numberValue : null;
}

function stringValue(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function evidenceHash(value: string): string {
    // Four independent 32-bit lanes keep this synchronous inside the SQLite
    // transaction while avoiding the collision envelope of the UI-oriented
    // 32-bit stableHash helper. The generation is opaque and versioned.
    let a = 0x811c9dc5;
    let b = 0x9e3779b9;
    let c = 0x85ebca6b;
    let d = 0xc2b2ae35;
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        a = Math.imul(a ^ code, 0x01000193);
        b = Math.imul(b ^ code, 0x27d4eb2d);
        c = Math.imul(c ^ code, 0x165667b1);
        d = Math.imul(d ^ code, 0x9e3779b1);
    }
    return [a, b, c, d]
        .map((lane) => (lane >>> 0).toString(16).padStart(8, "0"))
        .join("");
}
