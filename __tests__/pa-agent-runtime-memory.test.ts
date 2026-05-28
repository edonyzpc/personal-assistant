import { describe, expect, it } from "@jest/globals";

import {
    normalizeSearchCandidates,
    parseRerankResponse,
    type RawSearchResult,
} from "../src/ai-services/pa-agent-runtime";
import type { MemoryCandidate } from "../src/ai-services/chat-types";

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

function makeCandidate(path: string, score: number): MemoryCandidate {
    return {
        candidateId: path,
        path,
        score,
        documents: [{ source: path, content: `content of ${path}`, metadata: { path, chunkIndex: 0 } }],
        excerpt: `excerpt of ${path}`,
    };
}

describe("parseRerankResponse", () => {
    const candidates = [
        makeCandidate("a.md", 0.03),
        makeCandidate("b.md", 0.025),
        makeCandidate("c.md", 0.02),
        makeCandidate("d.md", 0.015),
    ];

    it("reorders candidates according to ranking", () => {
        const result = parseRerankResponse('{"ranking":[2,0,3,1]}', candidates);
        expect(result.map(c => c.path)).toEqual(["c.md", "a.md", "d.md", "b.md"]);
    });

    it("returns subset when ranking omits indices", () => {
        const result = parseRerankResponse('{"ranking":[1,3]}', candidates);
        expect(result.map(c => c.path)).toEqual(["b.md", "d.md"]);
    });

    it("returns original order for invalid JSON", () => {
        const result = parseRerankResponse("not json at all", candidates);
        expect(result).toBe(candidates);
    });

    it("returns original order for empty ranking array", () => {
        const result = parseRerankResponse('{"ranking":[]}', candidates);
        expect(result).toBe(candidates);
    });

    it("returns original order when missing ranking field", () => {
        const result = parseRerankResponse('{"scores":[0.9,0.8]}', candidates);
        expect(result).toBe(candidates);
    });

    it("ignores out-of-bounds indices", () => {
        const result = parseRerankResponse('{"ranking":[0,99,2,-1]}', candidates);
        expect(result.map(c => c.path)).toEqual(["a.md", "c.md"]);
    });

    it("deduplicates repeated indices", () => {
        const result = parseRerankResponse('{"ranking":[1,1,0,1]}', candidates);
        expect(result.map(c => c.path)).toEqual(["b.md", "a.md"]);
    });

    it("handles JSON with extra whitespace", () => {
        const result = parseRerankResponse('  { "ranking" : [ 3 , 1 ] }  ', candidates);
        expect(result.map(c => c.path)).toEqual(["d.md", "b.md"]);
    });

    it("extracts from markdown code fences", () => {
        const result = parseRerankResponse('```json\n{"ranking":[2,0]}\n```', candidates);
        expect(result.map(c => c.path)).toEqual(["c.md", "a.md"]);
    });
});
