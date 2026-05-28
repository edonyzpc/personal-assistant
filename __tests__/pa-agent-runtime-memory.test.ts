import { describe, expect, it } from "@jest/globals";

import {
    normalizeSearchCandidates,
    type RawSearchResult,
} from "../src/ai-services/pa-agent-runtime";

function makeResult(score: unknown, path: string, chunkIndex = 0): RawSearchResult {
    return {
        score,
        doc: {
            pageContent: `content for ${path} chunk ${chunkIndex}`,
            metadata: { path, chunkIndex },
        },
    };
}

// RRF score reference: single-source rank-1 ≈ 0.01639, dual rank-1 ≈ 0.03279
// MIN_MEMORY_SCORE = 0.01 (filters noise below single-source rank-8)

describe("normalizeSearchCandidates score filtering", () => {
    it("filters out results below MIN_MEMORY_SCORE (0.01)", () => {
        const results = [
            makeResult(0.030, "high.md"),
            makeResult(0.005, "low.md"),
            makeResult(0.002, "noise.md"),
        ];
        const candidates = normalizeSearchCandidates(results);
        const paths = candidates.map(c => c.path);
        expect(paths).toContain("high.md");
        expect(paths).not.toContain("low.md");
        expect(paths).not.toContain("noise.md");
    });

    it("keeps results at exactly the threshold", () => {
        const results = [makeResult(0.01, "boundary.md")];
        const candidates = normalizeSearchCandidates(results);
        expect(candidates).toHaveLength(1);
        expect(candidates[0].path).toBe("boundary.md");
    });

    it("returns empty when all results are below threshold", () => {
        const results = [
            makeResult(0.005, "a.md"),
            makeResult(0.003, "b.md"),
        ];
        expect(normalizeSearchCandidates(results)).toEqual([]);
    });

    it("returns empty for empty input", () => {
        expect(normalizeSearchCandidates([])).toEqual([]);
    });

    it("filters out NaN, undefined, and null scores", () => {
        const results: RawSearchResult[] = [
            makeResult(NaN, "nan.md"),
            makeResult(undefined, "undef.md"),
            makeResult(null, "null.md"),
            makeResult(0.020, "good.md"),
        ];
        const candidates = normalizeSearchCandidates(results);
        expect(candidates).toHaveLength(1);
        expect(candidates[0].path).toBe("good.md");
    });

    it("keeps typical RRF single-source results", () => {
        const results = [
            makeResult(0.01639, "rank1.md"),
            makeResult(0.01538, "rank5.md"),
            makeResult(0.01471, "rank8.md"),
        ];
        const candidates = normalizeSearchCandidates(results);
        expect(candidates).toHaveLength(3);
    });

    it("keeps typical RRF dual-source overlap results", () => {
        const results = [
            makeResult(0.03279, "overlap-rank1.md"),
            makeResult(0.02500, "overlap-mid.md"),
        ];
        const candidates = normalizeSearchCandidates(results);
        expect(candidates).toHaveLength(2);
    });
});
