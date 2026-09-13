/* Copyright 2023 edonyzpc */

import { describe, expect, it } from "@jest/globals";

import {
    buildPageletScopeReviewBundle,
} from "../src/pagelet/scope";
import { PAGELET_DEFAULT_TARGET_SUGGESTIONS } from "../src/pagelet/pa-review-schemas";

describe("buildPageletScopeReviewBundle", () => {
    it("builds multi-note source ids and references", () => {
        const bundle = buildPageletScopeReviewBundle({
            entries: [
                { path: "a.md", content: "Alpha note has a missing citation." },
                { path: "b.md", content: "Beta note needs a clearer recommendation." },
            ],
            primarySourcePath: "a.md",
            settings: {
                maxInputTokens: 1000,
                outputLanguage: "auto",
            },
            uiLanguage: "en",
        });

        expect(bundle).not.toBeNull();
        expect(bundle!.input.notePath).toBe("Selected notes (2)");
        expect(bundle!.input.targetSuggestionCount).toBe(PAGELET_DEFAULT_TARGET_SUGGESTIONS);
        expect(bundle!.input.segments.map((segment) => segment.id)).toEqual([
            "note-1-seg-1",
            "note-2-seg-1",
        ]);
        expect(bundle!.sourceReferences).toEqual([
            { sourceId: "note-1-seg-1", path: "a.md", segmentIndex: 0, label: "a.md #1" },
            { sourceId: "note-2-seg-1", path: "b.md", segmentIndex: 0, label: "b.md #1" },
        ]);
    });

    it("returns null when every selected note is empty", () => {
        const bundle = buildPageletScopeReviewBundle({
            entries: [{ path: "empty.md", content: "   " }],
            primarySourcePath: "empty.md",
            settings: {
                maxInputTokens: 1000,
                outputLanguage: "auto",
            },
            uiLanguage: "en",
        });

        expect(bundle).toBeNull();
    });

    it("keeps multi-note segments inside the approximate input budget", () => {
        const bundle = buildPageletScopeReviewBundle({
            entries: [
                { path: "a.md", content: "A".repeat(20) },
                { path: "b.md", content: "B".repeat(20) },
            ],
            primarySourcePath: "a.md",
            settings: {
                maxInputTokens: 10,
                outputLanguage: "auto",
            },
            uiLanguage: "en",
        });

        expect(bundle).not.toBeNull();
        const totalChars = bundle!.input.segments
            .reduce((sum, segment) => sum + segment.content.length, 0);
        expect(totalChars).toBeLessThanOrEqual(40);
        expect(bundle!.sourcePaths).toEqual(["a.md"]);
        expect(bundle!.input.notePath).toBe("a.md");
    });

    it("passes through a lower target suggestion count", () => {
        const bundle = buildPageletScopeReviewBundle({
            entries: [{ path: "a.md", content: "Alpha note has a missing citation." }],
            primarySourcePath: "a.md",
            settings: {
                maxInputTokens: 1000,
                outputLanguage: "auto",
            },
            uiLanguage: "en",
            targetSuggestionCount: 1,
        });

        expect(bundle).not.toBeNull();
        expect(bundle!.input.targetSuggestionCount).toBe(1);
    });
});
