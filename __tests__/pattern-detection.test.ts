import { describe, expect, it } from "@jest/globals";

import { detectCrossNotePatterns, type PatternDetectionInput } from "../src/pa";

function note(overrides: Partial<PatternDetectionInput> & { path: string }): PatternDetectionInput {
    return {
        content: "Working note.",
        tags: [],
        links: [],
        backlinks: [],
        modifiedAt: "2026-07-01T12:00:00.000Z",
        ...overrides,
    };
}

describe("detectCrossNotePatterns", () => {
    it("detects recurring tags across recent active notes", () => {
        const result = detectCrossNotePatterns([
            note({ path: "Projects/A.md", tags: ["#project-x"] }),
            note({ path: "Projects/B.md", tags: ["project-x"] }),
            note({ path: "Projects/C.md", tags: ["#project-x"] }),
            note({ path: "Projects/D.md", tags: ["#other"] }),
            note({ path: "Projects/E.md", tags: ["#other"] }),
        ], { now: new Date("2026-07-02T12:00:00.000Z") });

        expect(result.totalCount).toBeGreaterThanOrEqual(1);
        expect(result.patterns[0]).toEqual(expect.objectContaining({
            patternType: "recurring_tag",
            title: "Recurring tag: #project-x",
        }));
        expect(result.patterns[0].sourceRefs.map((ref) => ref.path)).toEqual([
            "Projects/A.md",
            "Projects/B.md",
            "Projects/C.md",
        ]);
    });

    it("detects repeated questions only after the active-note threshold is met", () => {
        const belowThreshold = detectCrossNotePatterns([
            note({ path: "Q/A.md", content: "What should happen next?" }),
            note({ path: "Q/B.md", content: "Why does this matter?" }),
        ], { now: new Date("2026-07-02T12:00:00.000Z") });
        const result = detectCrossNotePatterns([
            note({ path: "Q/A.md", content: "What should happen next?" }),
            note({ path: "Q/B.md", content: "Why does this matter?" }),
            note({ path: "Q/C.md" }),
            note({ path: "Q/D.md" }),
            note({ path: "Q/E.md" }),
        ], { now: new Date("2026-07-02T12:00:00.000Z") });

        expect(belowThreshold.patterns).toHaveLength(0);
        expect(result.patterns.some((pattern) => pattern.patternType === "repeated_question")).toBe(true);
    });

    it("detects orphan clusters with valid source refs", () => {
        const result = detectCrossNotePatterns([
            note({ path: "Inbox/A.md", folder: "Inbox" }),
            note({ path: "Inbox/B.md", folder: "Inbox" }),
            note({ path: "Inbox/C.md", folder: "Inbox" }),
            note({ path: "Linked/D.md", links: ["Linked/E.md"] }),
            note({ path: "Linked/E.md", backlinks: ["Linked/D.md"] }),
        ], { now: new Date("2026-07-02T12:00:00.000Z") });

        const cluster = result.patterns.find((pattern) => pattern.patternType === "orphan_cluster");
        expect(cluster).toEqual(expect.objectContaining({
            title: "Unlinked cluster: Inbox",
        }));
        expect(cluster?.sourceRefs.every((ref) => ref.path.endsWith(".md"))).toBe(true);
        expect(cluster?.whyShown.join(" ")).toContain("no links");
    });
});
