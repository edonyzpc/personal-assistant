import { describe, expect, it } from "@jest/globals";

import {
    buildRecapInsightsPrompt,
    buildRecallRelevancePrompt,
    detectLanguageMismatch,
    parseRecapInsightsResponse,
    parseRecallRelevanceResponse,
} from "../src/pa";
import { buildPreloadPrompt } from "../src/pagelet/llm";
import { estimateTokens } from "../src/pagelet/pa-review-cost";

describe("buildPreloadPrompt", () => {
    it("keeps a long CJK prompt inside the actual input-token envelope", () => {
        const prompt = buildPreloadPrompt([{
            path: "notes/中文长笔记.md",
            content: "中".repeat(20_000),
        }], { input: 4_000, output: 1_000 });
        const fullPrompt = `${prompt.systemPrompt}\n\n${prompt.userPrompt}`;

        expect(estimateTokens(fullPrompt)).toBeLessThanOrEqual(4_000);
        expect(fullPrompt).toContain("[...truncated]");
    });
});

describe("buildRecapInsightsPrompt", () => {
    it("includes all note digests in output", () => {
        const prompt = buildRecapInsightsPrompt({
            scope: { kind: "selected_notes", paths: ["a.md", "b.md"] },
            noteDigests: [
                { title: "Note A", digest: "Title: Note A\nFirst paragraph: Hello", tags: ["tag1"] },
                { title: "Note B", digest: "Title: Note B\nFirst paragraph: World", tags: [] },
            ],
        });
        expect(prompt).toContain('Note 1: "Note A"');
        expect(prompt).toContain('Note 2: "Note B"');
        expect(prompt).toContain("Tags: tag1");
        expect(prompt).toContain("Tags: none");
    });

    it("includes quality gate instructions", () => {
        const prompt = buildRecapInsightsPrompt({
            scope: { kind: "current_note", paths: ["x.md"] },
            noteDigests: [{ title: "X", digest: "content", tags: [] }],
        });
        expect(prompt).toContain("Quality gate");
        expect(prompt).toContain("NOT an insight");
        expect(prompt).toContain("Return []");
    });
});

describe("parseRecapInsightsResponse", () => {
    it("parses valid JSON array", () => {
        const result = parseRecapInsightsResponse(JSON.stringify([
            { title: "T1", summary: "S1", whyItMatters: "W1", sourceNoteTitles: ["A", "B"], section: "theme" },
            { title: "T2", summary: "S2", whyItMatters: "W2", sourceNoteTitles: ["B", "C"], section: "tension" },
        ]));
        expect(result).toHaveLength(2);
        expect(result![0].title).toBe("T1");
        expect(result![1].section).toBe("tension");
    });

    it("strips markdown code fences", () => {
        const result = parseRecapInsightsResponse(
            '```json\n[{"title":"T","summary":"S","whyItMatters":"W","sourceNoteTitles":["A","B"],"section":"open_question"}]\n```',
        );
        expect(result).toHaveLength(1);
        expect(result![0].section).toBe("open_question");
    });

    it("accepts one attributed source for explicit click-to-view Recap", () => {
        expect(parseRecapInsightsResponse(JSON.stringify([{
            title: "T",
            summary: "S",
            whyItMatters: "This affects the next decision.",
            sourceNoteTitles: ["A"],
            section: "open_question",
        }]))).toEqual([expect.objectContaining({ sourceNoteTitles: ["A"] })]);
    });

    it("returns null for non-array JSON", () => {
        expect(parseRecapInsightsResponse('{"not":"array"}')).toBeNull();
    });

    it("returns null for invalid JSON", () => {
        expect(parseRecapInsightsResponse("not json at all")).toBeNull();
    });

    it("rejects a mixed-validity array instead of silently accepting a partial schema", () => {
        const result = parseRecapInsightsResponse(JSON.stringify([
            { title: "Valid", summary: "S", whyItMatters: "W", sourceNoteTitles: ["A", "B"], section: "theme" },
            { title: "Missing section", summary: "S", sourceNoteTitles: ["A"] },
            { summary: "Missing title", sourceNoteTitles: ["A"], section: "theme" },
        ]));
        expect(result).toBeNull();
    });

    it("returns empty array for empty JSON array", () => {
        expect(parseRecapInsightsResponse("[]")).toEqual([]);
    });
});

describe("buildRecallRelevancePrompt", () => {
    it("includes current and candidate note info", () => {
        const prompt = buildRecallRelevancePrompt({
            currentDigest: { title: "Current Note", headings: ["Intro", "Method"], firstParagraph: "Exploring caching." },
            candidateDigest: { title: "Old Note", headings: ["Results"], firstParagraph: "Redis benchmark data." },
            candidateAge: "3 months",
        });
        expect(prompt).toContain('"Current Note"');
        expect(prompt).toContain("Intro / Method");
        expect(prompt).toContain('"Old Note"');
        expect(prompt).toContain("3 months");
        expect(prompt).toContain("Redis benchmark data.");
    });

    it("handles empty headings", () => {
        const prompt = buildRecallRelevancePrompt({
            currentDigest: { title: "A", headings: [], firstParagraph: "text" },
            candidateDigest: { title: "B", headings: [], firstParagraph: "text2" },
            candidateAge: "1 week",
        });
        expect(prompt).toContain("Headings: none");
    });

    it("includes language instruction", () => {
        const prompt = buildRecallRelevancePrompt({
            currentDigest: { title: "A", headings: [], firstParagraph: "" },
            candidateDigest: { title: "B", headings: [], firstParagraph: "" },
            candidateAge: "unknown",
        });
        expect(prompt).toContain("Respond in the same language as the current note");
    });
});

describe("parseRecallRelevanceResponse", () => {
    it("parses convincing result", () => {
        const result = parseRecallRelevanceResponse(
            '{"isConvincing":true,"whyNow":"Your note asks about caching; this has benchmarks."}',
        );
        expect(result.isConvincing).toBe(true);
        expect(result.whyNow).toBe("Your note asks about caching; this has benchmarks.");
    });

    it("parses unconvincing result", () => {
        const result = parseRecallRelevanceResponse('{"isConvincing":false,"whyNow":null}');
        expect(result.isConvincing).toBe(false);
        expect(result.whyNow).toBeNull();
    });

    it("strips markdown fences", () => {
        const result = parseRecallRelevanceResponse('```json\n{"isConvincing":true,"whyNow":"reason"}\n```');
        expect(result.isConvincing).toBe(true);
    });

    it("returns safe default on parse failure", () => {
        const result = parseRecallRelevanceResponse("garbage");
        expect(result.isConvincing).toBe(false);
        expect(result.whyNow).toBeNull();
    });

    it("treats non-true isConvincing as false", () => {
        const result = parseRecallRelevanceResponse('{"isConvincing":"yes","whyNow":"reason"}');
        expect(result.isConvincing).toBe(false);
    });
});

describe("detectLanguageMismatch", () => {
    it("detects English whyNow for Chinese notes", () => {
        expect(detectLanguageMismatch(
            "Both notes discuss architecture",
            "这篇笔记讨论了项目架构的选择",
        )).toBe(true);
    });

    it("no mismatch when both are Chinese", () => {
        expect(detectLanguageMismatch(
            "当前笔记讨论了缓存策略，这篇旧笔记有相关测试数据",
            "这篇笔记探讨了 Redis 和 Postgres 的缓存方案",
        )).toBe(false);
    });

    it("no mismatch when notes are English", () => {
        expect(detectLanguageMismatch(
            "Both discuss caching strategies",
            "This note explores Redis and Postgres caching approaches",
        )).toBe(false);
    });

    it("no mismatch for mixed content with CJK in both", () => {
        expect(detectLanguageMismatch(
            "笔记A和B都讨论了缓存",
            "关于缓存的讨论 and some English",
        )).toBe(false);
    });
});
