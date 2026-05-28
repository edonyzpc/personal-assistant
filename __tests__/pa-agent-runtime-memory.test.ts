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

describe("normalizeSearchCandidates score filtering", () => {
    it("filters out results below MIN_MEMORY_SCORE (0.30)", () => {
        const results = [
            makeResult(0.80, "high.md"),
            makeResult(0.10, "low.md"),
            makeResult(0.05, "noise.md"),
        ];
        const candidates = normalizeSearchCandidates(results);
        const paths = candidates.map(c => c.path);
        expect(paths).toContain("high.md");
        expect(paths).not.toContain("low.md");
        expect(paths).not.toContain("noise.md");
    });

    it("keeps results at exactly the threshold", () => {
        const results = [makeResult(0.30, "boundary.md")];
        const candidates = normalizeSearchCandidates(results);
        expect(candidates).toHaveLength(1);
        expect(candidates[0].path).toBe("boundary.md");
    });

    it("returns empty when all results are below threshold", () => {
        const results = [
            makeResult(0.20, "a.md"),
            makeResult(0.15, "b.md"),
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
            makeResult(0.50, "good.md"),
        ];
        const candidates = normalizeSearchCandidates(results);
        expect(candidates).toHaveLength(1);
        expect(candidates[0].path).toBe("good.md");
    });
});
