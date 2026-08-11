import { describe, expect, it } from "@jest/globals";

import { computePathEvidenceGeneration } from "../src/vss/path-evidence-generation";
import type { VSSChunk, VSSFileState } from "../src/vss/types";

const FILE: VSSFileState = {
    path: "note.md",
    contentHash: "whole-note",
    mtime: 100,
    size: 200,
};

function chunk(chunkIndex: number, content: string): VSSChunk {
    return {
        path: "note.md",
        chunkIndex,
        content,
        contentHash: `chunk-${chunkIndex}`,
        created: 1,
        lastModified: 2,
        metadata: {
            startLine: chunkIndex * 10,
            endLine: chunkIndex * 10 + 9,
            headingPath: [`Heading ${chunkIndex}`],
            indexVersion: "v1",
        },
    };
}

describe("path evidence generation", () => {
    it("is stable across input order but covers every chunk, including unselected chunks", () => {
        const all = [chunk(0, "selected"), chunk(1, "selected too"), chunk(2, "not selected")];
        const generation = computePathEvidenceGeneration(FILE, all);
        expect(computePathEvidenceGeneration(FILE, [...all].reverse())).toBe(generation);
        expect(computePathEvidenceGeneration(FILE, [
            all[0],
            all[1],
            { ...all[2], content: "changed outside the returned top chunks" },
        ])).not.toBe(generation);
    });

    it("changes for source revision, anchors, or representation inventory", () => {
        const chunks = [chunk(0, "body")];
        const generation = computePathEvidenceGeneration(FILE, chunks);
        expect(computePathEvidenceGeneration({ ...FILE, mtime: 101 }, chunks)).not.toBe(generation);
        expect(computePathEvidenceGeneration(FILE, [{
            ...chunks[0],
            metadata: { ...chunks[0].metadata, startLine: 1 },
        }])).not.toBe(generation);
    });
});
