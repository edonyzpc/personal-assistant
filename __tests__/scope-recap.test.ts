import { describe, expect, it } from "@jest/globals";

import {
    buildScopeRecap,
    buildScopeRecapGeneratedNote,
    buildScopeRecapMarkdown,
    buildScopeRecapWithLlm,
    extractNoteDigest,
    hasForbiddenPersistedTextFields,
    scopeRecapCanAnswerAsFact,
    scopeRecapToConfirmedMemory,
    type GenerateRecapInsightsCallback,
    type RecapLlmInsight,
    type ScopeRecapSourceNote,
} from "../src/pa";

function notes(): ScopeRecapSourceNote[] {
    return [
        {
            path: "Projects/PA/Alpha.md",
            title: "Alpha",
            content: "status: active\nDecision: ship source-backed recap.\nWhat should be verified before saving?",
            tags: ["pa", "review"],
        },
        {
            path: "Projects/PA/Beta.md",
            title: "Beta",
            content: "status: paused\nDecision: defer full graph UI.",
            tags: ["pa", "review"],
        },
        {
            path: "Projects/PA/Gamma.md",
            title: "Gamma",
            content: "Constraint: review before writing.",
            tags: ["pa", "memory"],
        },
    ];
}

describe("Scope Recap", () => {
    it("builds an on-demand source-backed recap with coverage and claim sourceRefs", () => {
        const recap = buildScopeRecap(notes(), {
            now: new Date("2026-06-29T12:00:00.000Z"),
            scope: { kind: "folder", label: "Projects/PA", paths: ["Projects/PA"] },
        });

        expect(recap.generatedAt).toBe("2026-06-29T12:00:00.000Z");
        expect(recap.scope).toMatchObject({ kind: "folder", label: "Projects/PA" });
        expect(recap.sourceCoverage).toEqual({
            totalSourceCount: 3,
            includedSourceCount: 3,
            skippedSourceCount: 0,
            coverageRatio: 1,
        });
        expect(recap.staleStatus).toBe("fresh");
        expect(recap.summary.sourceRefs.length).toBeGreaterThan(0);
        expect(recap.themes[0]).toMatchObject({
            section: "theme",
            generatedHelper: true,
            status: "candidate",
        });
        expect(recap.themes[0].sourceRefs.length).toBeGreaterThan(0);
        expect(recap.tensions[0].sourceRefs.length).toBeGreaterThan(1);
        expect(recap.openQuestions[0].sourceRefs.length).toBe(1);
        expect(hasForbiddenPersistedTextFields(recap)).toBe(false);
    });

    it("filters generated or denied sources and marks low coverage/boundary status", () => {
        const recap = buildScopeRecap([
            ...notes(),
            {
                path: ".pagelet/generated.md",
                content: "status: generated",
                tags: ["pa"],
                isGenerated: true,
            },
            {
                path: "Private/Secret.md",
                content: "status: secret",
                tags: ["pa"],
            },
        ], {
            now: new Date("2026-06-29T12:00:00.000Z"),
            isPathAllowed: (path) => !path.startsWith("Private/"),
        });

        expect(recap.sourceCoverage).toMatchObject({
            totalSourceCount: 5,
            includedSourceCount: 3,
            skippedSourceCount: 2,
        });
        expect(recap.staleStatus).toBe("boundary-changed");
        expect(recap.skippedSources).toEqual(expect.arrayContaining([
            expect.objectContaining({ reason: "generated_source", count: 1 }),
            expect.objectContaining({ reason: "data_boundary", count: 1 }),
        ]));
        expect(JSON.stringify(recap)).not.toContain("Private/Secret.md");

        const lowCoverage = buildScopeRecap([notes()[0]], {
            now: new Date("2026-06-29T12:00:00.000Z"),
        });
        expect(lowCoverage.staleStatus).toBe("low-coverage");
    });

    it("marks recaps stale when source paths changed", () => {
        const recap = buildScopeRecap(notes(), {
            now: new Date("2026-06-29T12:00:00.000Z"),
            changedSourcePaths: ["Projects/PA/Alpha.md"],
        });

        expect(recap.staleStatus).toBe("stale");
    });

    it("does not treat generated recap text as source truth or Confirmed Memory", () => {
        const recap = buildScopeRecap(notes(), {
            now: new Date("2026-06-29T12:00:00.000Z"),
        });

        expect(scopeRecapCanAnswerAsFact(recap)).toBe(false);
        expect(scopeRecapToConfirmedMemory()).toEqual({ ok: false, reason: "recap_not_source_truth" });
        expect(recap.summary.generatedHelper).toBe(true);
    });

    it("exports Markdown only for accepted source-backed items with confirmation metadata", () => {
        const recap = buildScopeRecap(notes(), {
            now: new Date("2026-06-29T12:00:00.000Z"),
            scope: { kind: "folder", label: "Projects/PA", paths: ["Projects/PA"] },
        });
        const acceptedIds = [recap.summary.id, recap.themes[0].id];
        const markdown = buildScopeRecapMarkdown(recap, acceptedIds);

        expect(markdown).toContain("pagelet: true");
        expect(markdown).toContain("generatedAt: 2026-06-29T12:00:00.000Z");
        expect(markdown).toContain("Coverage: 3/3 source notes");
        expect(markdown).toContain(recap.summary.title);
        expect(markdown).toContain(recap.themes[0].title);
        expect(markdown).not.toContain(recap.tensions[0].title);
        expect(markdown).toContain("[[Projects/PA/Alpha.md]]");

        expect(buildScopeRecapGeneratedNote(recap, [], ".pagelet")).toEqual({
            ok: false,
            reason: "no_accepted_items",
        });
        const note = buildScopeRecapGeneratedNote(recap, acceptedIds, ".pagelet");
        expect(note.ok).toBe(true);
        if (note.ok) {
            expect(note.note.targetPath).toBe(".pagelet/pagelet-scope-recap-2026-06-29.md");
            expect(note.note.confirmationPrompt?.message).toContain("accepted item");
            expect(note.note.markdown).not.toContain(recap.tensions[0].title);
            expect(note.note.sources).toEqual(expect.arrayContaining(["[[Projects/PA/Alpha.md]]"]));
        }
    });
});

describe("extractNoteDigest", () => {
    it("extracts title, headings, and first paragraph", () => {
        const note: ScopeRecapSourceNote = {
            path: "Projects/PA/Design.md",
            title: "Design Doc",
            content: [
                "# Design Doc",
                "",
                "This is the opening paragraph that explains the project goals.",
                "",
                "## Architecture",
                "",
                "Details about the architecture.",
                "",
                "## Implementation",
                "",
                "Steps for implementation.",
            ].join("\n"),
            tags: ["design", "pa"],
        };

        const digest = extractNoteDigest(note);
        expect(digest).toContain("Title: Design Doc");
        expect(digest).toContain("Headings: ## Architecture | ## Implementation");
        expect(digest).toContain("First paragraph: This is the opening paragraph that explains the project goals.");
    });

    it("handles notes with no headings", () => {
        const note: ScopeRecapSourceNote = {
            path: "Notes/Quick.md",
            title: "Quick Note",
            content: "Just a simple line of text.\nAnd another line.",
        };

        const digest = extractNoteDigest(note);
        expect(digest).toContain("Title: Quick Note");
        expect(digest).not.toContain("Headings:");
        expect(digest).toContain("First paragraph: Just a simple line of text. And another line.");
    });

    it("derives title from filename when title is missing", () => {
        const note: ScopeRecapSourceNote = {
            path: "Notes/my-thoughts.md",
            content: "",
        };

        const digest = extractNoteDigest(note);
        expect(digest).toContain("Title: my-thoughts");
    });

    it("handles empty content gracefully", () => {
        const note: ScopeRecapSourceNote = {
            path: "Empty.md",
            title: "Empty",
            content: "",
        };

        const digest = extractNoteDigest(note);
        expect(digest).toBe("Title: Empty");
    });

    it("skips heading lines when finding first paragraph", () => {
        const note: ScopeRecapSourceNote = {
            path: "Notes/Headed.md",
            title: "Headed",
            content: "# Main Title\n## Section\nActual paragraph content here.",
        };

        const digest = extractNoteDigest(note);
        expect(digest).toContain("First paragraph: Actual paragraph content here.");
        expect(digest).toContain("Headings: ## Section");
    });
});

describe("buildScopeRecapWithLlm", () => {
    function testNotes(): ScopeRecapSourceNote[] {
        return [
            {
                path: "Projects/PA/Alpha.md",
                title: "Alpha",
                content: "status: active\nDecision: ship source-backed recap.\nWhat should be verified?",
                tags: ["pa", "review"],
            },
            {
                path: "Projects/PA/Beta.md",
                title: "Beta",
                content: "status: paused\nDecision: defer full graph UI.",
                tags: ["pa", "review"],
            },
            {
                path: "Projects/PA/Gamma.md",
                title: "Gamma",
                content: "Constraint: review before writing.",
                tags: ["pa", "memory"],
            },
        ];
    }

    it("maps LLM insights to ScopeRecapItems with correct sections", async () => {
        const mockInsights: RecapLlmInsight[] = [
            {
                title: "Conflicting ship decisions",
                summary: "Alpha wants to ship while Beta defers, indicating an unresolved priority.",
                sourceNoteTitles: ["Alpha", "Beta"],
                section: "tension",
            },
            {
                title: "Review-first pattern",
                summary: "Multiple notes emphasize reviewing before acting, suggesting a core principle.",
                sourceNoteTitles: ["Alpha", "Gamma"],
                section: "theme",
            },
        ];

        const generateInsights: GenerateRecapInsightsCallback = async () => mockInsights;

        const recap = await buildScopeRecapWithLlm(testNotes(), generateInsights, {
            now: new Date("2026-07-01T10:00:00.000Z"),
            scope: { kind: "folder", label: "Projects/PA", paths: ["Projects/PA"] },
        });

        expect(recap.tensions).toHaveLength(1);
        expect(recap.tensions[0].title).toBe("Conflicting ship decisions");
        expect(recap.tensions[0].sourceRefs.length).toBe(2);
        expect(recap.tensions[0].section).toBe("tension");

        expect(recap.themes).toHaveLength(1);
        expect(recap.themes[0].title).toBe("Review-first pattern");
        expect(recap.themes[0].section).toBe("theme");

        expect(recap.providerInfo).toEqual({ provider: "llm", model: "scope-recap-insights" });
    });

    it("falls back to silence when LLM returns null", async () => {
        const generateInsights: GenerateRecapInsightsCallback = async () => null;

        const recap = await buildScopeRecapWithLlm(testNotes(), generateInsights, {
            now: new Date("2026-07-01T10:00:00.000Z"),
        });

        expect(recap.themes).toHaveLength(0);
        expect(recap.tensions).toHaveLength(0);
        expect(recap.openQuestions).toHaveLength(0);
    });

    it("falls back to silence when LLM throws", async () => {
        const generateInsights: GenerateRecapInsightsCallback = async () => {
            throw new Error("LLM unavailable");
        };

        const recap = await buildScopeRecapWithLlm(testNotes(), generateInsights, {
            now: new Date("2026-07-01T10:00:00.000Z"),
        });

        expect(recap.themes).toHaveLength(0);
        expect(recap.tensions).toHaveLength(0);
        expect(recap.openQuestions).toHaveLength(0);
        expect(recap.staleStatus).toBe("fresh");
    });

    it("skips insights whose sourceNoteTitles do not match any included note", async () => {
        const mockInsights: RecapLlmInsight[] = [
            {
                title: "Ghost reference",
                summary: "References notes that do not exist.",
                sourceNoteTitles: ["NonExistent", "AlsoMissing"],
                section: "theme",
            },
            {
                title: "Valid insight",
                summary: "This one has real sources.",
                sourceNoteTitles: ["Alpha"],
                section: "open_question",
            },
        ];

        const generateInsights: GenerateRecapInsightsCallback = async () => mockInsights;

        const recap = await buildScopeRecapWithLlm(testNotes(), generateInsights, {
            now: new Date("2026-07-01T10:00:00.000Z"),
        });

        expect(recap.themes).toHaveLength(0);
        expect(recap.openQuestions).toHaveLength(1);
        expect(recap.openQuestions[0].title).toBe("Valid insight");
    });

    it("does not call LLM when fewer than 2 notes are included", async () => {
        let called = false;
        const generateInsights: GenerateRecapInsightsCallback = async () => {
            called = true;
            return [];
        };

        await buildScopeRecapWithLlm([testNotes()[0]], generateInsights, {
            now: new Date("2026-07-01T10:00:00.000Z"),
        });

        expect(called).toBe(false);
    });
});
