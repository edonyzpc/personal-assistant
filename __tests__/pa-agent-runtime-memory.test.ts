import { describe, expect, it } from "@jest/globals";

import {
    normalizeSearchCandidates,
    parseRerankResponse,
    type RawSearchResult,
} from "../src/ai-services/pa-agent-runtime";
import {
    admitRerankCandidates,
    allocateMemoryDocumentsTwoPass,
    applyRerankOutcome,
    selectRerankModel,
} from "../src/ai-services/memory-search-tool";
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
        documents: [{ source: { path, chunkIndex: 0 }, content: `content of ${path}`, score }],
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

    it("accepts a valid relevant ordered subset", () => {
        const result = parseRerankResponse(
            '{"verdict":"relevant","ranking":[2,0],"needsMoreEvidence":false}',
            candidates,
        );
        expect(result).toMatchObject({
            kind: "valid",
            verdict: "relevant",
            needsMoreEvidence: false,
            modelCalled: true,
        });
        expect(result.candidates.map((candidate) => candidate.path)).toEqual(["c.md", "a.md"]);
    });

    it("accepts explicit partial and none outcomes", () => {
        const partial = parseRerankResponse(
            '{"verdict":"partially_relevant","ranking":[1,3],"needsMoreEvidence":true}',
            candidates,
        );
        const none = parseRerankResponse(
            '{"verdict":"none_relevant","ranking":[],"needsMoreEvidence":true}',
            candidates,
        );
        expect(partial).toMatchObject({
            kind: "valid",
            verdict: "partially_relevant",
            needsMoreEvidence: true,
        });
        expect(partial.candidates.map((candidate) => candidate.path)).toEqual(["b.md", "d.md"]);
        expect(none).toMatchObject({
            kind: "valid",
            verdict: "none_relevant",
            needsMoreEvidence: true,
            candidates: [],
        });
    });

    it("fails open for invalid JSON and missing envelope fields", () => {
        const result = parseRerankResponse("not json at all", candidates);
        const missing = parseRerankResponse('{"ranking":[0]}', candidates);
        expect(result).toMatchObject({ kind: "fail_open", reason: "malformed" });
        expect(result.candidates).toBe(candidates);
        expect(missing).toMatchObject({ kind: "fail_open", reason: "malformed" });
    });

    it("fails open for duplicate, non-integer, and out-of-range indices", () => {
        const duplicate = parseRerankResponse(
            '{"verdict":"relevant","ranking":[1,1],"needsMoreEvidence":false}',
            candidates,
        );
        const nonInteger = parseRerankResponse(
            '{"verdict":"relevant","ranking":[1.5],"needsMoreEvidence":false}',
            candidates,
        );
        const outOfRange = parseRerankResponse(
            '{"verdict":"relevant","ranking":[99],"needsMoreEvidence":false}',
            candidates,
        );
        expect(duplicate).toMatchObject({ kind: "fail_open", reason: "invalid_index" });
        expect(nonInteger).toMatchObject({ kind: "fail_open", reason: "invalid_index" });
        expect(outOfRange).toMatchObject({ kind: "fail_open", reason: "invalid_index" });
    });

    it("fails open for verdict/ranking/needsMoreEvidence contradictions", () => {
        const relevantEmpty = parseRerankResponse(
            '{"verdict":"relevant","ranking":[],"needsMoreEvidence":false}',
            candidates,
        );
        const noneRanked = parseRerankResponse(
            '{"verdict":"none_relevant","ranking":[0],"needsMoreEvidence":true}',
            candidates,
        );
        const relevantNeedsMore = parseRerankResponse(
            '{"verdict":"relevant","ranking":[0],"needsMoreEvidence":true}',
            candidates,
        );
        expect(relevantEmpty).toMatchObject({ kind: "fail_open", reason: "contradictory" });
        expect(noneRanked).toMatchObject({ kind: "fail_open", reason: "contradictory" });
        expect(relevantNeedsMore).toMatchObject({ kind: "fail_open", reason: "contradictory" });
    });

    it("does not accept fenced JSON or free-form prose", () => {
        const fenced = parseRerankResponse(
            '```json\n{"verdict":"relevant","ranking":[2,0],"needsMoreEvidence":false}\n```',
            candidates,
        );
        expect(fenced).toMatchObject({ kind: "fail_open", reason: "malformed" });
    });
});

describe("Phase 1 candidate and document allocation", () => {
    it("selects policy first, then Chat, without a second model", () => {
        expect(selectRerankModel({ policyModelName: " policy ", chatModelName: "chat" })).toEqual({
            kind: "policy",
            modelName: "policy",
        });
        expect(selectRerankModel({ policyModelName: "", chatModelName: " chat " })).toEqual({
            kind: "chat",
            modelName: "chat",
        });
        expect(selectRerankModel({ policyModelName: " ", chatModelName: " " })).toBeUndefined();
    });

    it("keeps strict parsing but rolls back valid-none hiding when the flag is off", () => {
        const input = [makeCandidate("a.md", 1)];
        const outcome = parseRerankResponse(
            '{"verdict":"none_relevant","ranking":[],"needsMoreEvidence":true}',
            input,
        );
        expect(applyRerankOutcome(outcome, input, true)).toMatchObject({
            candidates: [],
            verdict: "none_relevant",
            needsMoreEvidence: true,
        });
        expect(applyRerankOutcome(outcome, input, false)).toMatchObject({
            candidates: input,
            verdict: "relevant",
            needsMoreEvidence: false,
        });
    });

    it("caps direct at 12 and graph at 6 unique paths, with direct winning", () => {
        const direct = Array.from({ length: 14 }, (_, index) => ({
            ...makeCandidate(`direct-${index}.md`, 1 - index / 100),
            origin: "direct" as const,
        }));
        const graph = Array.from({ length: 8 }, (_, index) => ({
            ...makeCandidate(index === 0 ? "direct-0.md" : `graph-${index}.md`, 0.5),
            origin: "graph" as const,
        }));
        const admitted = admitRerankCandidates([...graph, ...direct]);
        expect(admitted).toHaveLength(18);
        expect(admitted.slice(0, 12).every((candidate) => candidate.origin === "direct")).toBe(true);
        expect(admitted.filter((candidate) => candidate.path === "direct-0.md")).toHaveLength(1);
        expect(admitted.filter((candidate) => candidate.origin === "graph")).toHaveLength(6);
    });

    it("keeps direct hybrid order, then orders graph candidates by their own score and path", () => {
        const direct = [
            { ...makeCandidate("direct-b.md", 0.7), origin: "direct" as const },
            { ...makeCandidate("direct-a.md", 0.9), origin: "direct" as const },
        ];
        const graph = [
            { ...makeCandidate("graph-z.md", 0.4), origin: "graph" as const },
            { ...makeCandidate("graph-b.md", 0.8), origin: "graph" as const },
            { ...makeCandidate("graph-a.md", 0.8), origin: "graph" as const },
        ];

        expect(admitRerankCandidates([...graph, ...direct]).map((candidate) => candidate.path)).toEqual([
            "direct-b.md",
            "direct-a.md",
            "graph-a.md",
            "graph-b.md",
            "graph-z.md",
        ]);
    });

    it("allocates two chunks per candidate before third-chunk backfill", () => {
        const withChunks = (path: string): MemoryCandidate => ({
            ...makeCandidate(path, 1),
            documents: [0, 1, 2].map((chunkIndex) => ({
                content: `${path}-${chunkIndex}`,
                score: 1,
                source: { path, chunkIndex, score: 1 },
            })),
        });
        const documents = allocateMemoryDocumentsTwoPass([
            withChunks("a.md"),
            withChunks("b.md"),
            withChunks("c.md"),
            withChunks("d.md"),
        ]);
        expect(documents.map((document) => `${document.source.path}#${document.source.chunkIndex}`)).toEqual([
            "a.md#0", "a.md#1",
            "b.md#0", "b.md#1",
            "c.md#0", "c.md#1",
            "d.md#0", "d.md#1",
        ]);
    });
});
