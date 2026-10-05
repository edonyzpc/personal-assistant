import { describe, expect, it } from "@jest/globals";

import {
    buildRecapInsightsPrompt,
    parseRecapInsightsResponse,
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
