import { describe, expect, it, jest } from "@jest/globals";
import { combineActivityCounts } from "../src/stats/stats-manager";

jest.mock("obsidian");

describe("combineActivityCounts", () => {
    it("keeps existing same-day activity when adding session activity", () => {
        const combined = combineActivityCounts(
            { words: 100, characters: 500, sentences: 4, pages: 0.3, footnotes: 1, citations: 2 },
            { words: 5, characters: 25, sentences: 1, pages: 0.1, footnotes: 0, citations: 1 },
        );

        expect(combined).toEqual({
            words: 105,
            characters: 525,
            sentences: 5,
            pages: 0.4,
            footnotes: 1,
            citations: 3,
        });
    });
});
