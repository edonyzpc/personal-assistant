import { describe, expect, it } from "@jest/globals";

import {
    buildQuietRecallCandidates,
    quietRecallCandidateToBubbleNudge,
    quietRecallCandidateToSavedInsightInput,
    type SavedInsight,
} from "../src/pa";

function makeInsight(overrides: Partial<SavedInsight> = {}): SavedInsight {
    const now = "2026-06-29T12:00:00.000Z";
    return {
        id: "ins-current",
        type: "theme",
        text: "Small weekly rituals help old project context stay usable.",
        origin: "pa-generated",
        sourceRefs: [{ path: "Projects/Alpha.md", evidenceStrength: "medium" }],
        whyShown: ["Saved from a prior review."],
        scope: { kind: "current_note", paths: ["Projects/Alpha.md"] },
        status: "active",
        influencePolicy: "weak-only",
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

describe("buildQuietRecallCandidates", () => {
    it("prefers explicit current-note relevance over far association", () => {
        const result = buildQuietRecallCandidates({
            now: new Date("2026-06-29T12:00:00.000Z"),
            currentNote: { path: "Projects/Alpha.md" },
            savedInsights: [
                makeInsight({
                    id: "ins-current",
                    sourceRefs: [{ path: "Projects/Alpha.md", evidenceStrength: "medium" }],
                    text: "Current source insight.",
                }),
                makeInsight({
                    id: "ins-far",
                    sourceRefs: [{ path: "Archive/Far.md", evidenceStrength: "strong" }],
                    text: "Far association.",
                }),
            ],
        });

        expect(result.candidates).toHaveLength(2);
        expect(result.candidates[0]).toEqual(expect.objectContaining({
            sourceInsightId: "ins-current",
            relation: "current",
        }));
        expect(result.candidates[0].score).toBeGreaterThan(result.candidates[1].score);
    });

    it("uses related-note evidence but filters weak unrelated signals", () => {
        const result = buildQuietRecallCandidates({
            now: new Date("2026-06-29T12:00:00.000Z"),
            currentNote: { path: "Projects/Alpha.md" },
            relatedNotes: [{ path: "Projects/Beta.md", score: 0.9 }],
            savedInsights: [
                makeInsight({
                    id: "ins-related",
                    sourceRefs: [{ path: "Projects/Beta.md", evidenceStrength: "medium" }],
                    text: "Related source insight.",
                }),
                makeInsight({
                    id: "ins-weak",
                    sourceRefs: [{ path: "Archive/Weak.md", evidenceStrength: "weak" }],
                    text: "Weak unrelated signal.",
                }),
            ],
        });

        expect(result.candidates).toHaveLength(1);
        expect(result.candidates[0]).toEqual(expect.objectContaining({
            sourceInsightId: "ins-related",
            relation: "related",
        }));
        expect(result.candidates[0].whyNow.join(" ")).toContain("Memory search");
    });

    it("does not produce stale recall candidates", () => {
        const result = buildQuietRecallCandidates({
            now: new Date("2026-06-29T12:00:00.000Z"),
            currentNote: { path: "Projects/Alpha.md" },
            savedInsights: [
                makeInsight({
                    id: "ins-stale",
                    updatedAt: "2025-01-01T00:00:00.000Z",
                    sourceRefs: [{ path: "Projects/Alpha.md", evidenceStrength: "strong" }],
                }),
            ],
        });

        expect(result.candidates).toHaveLength(0);
    });

    it("maps a recall candidate to a Saved Insight input without raw source text", () => {
        const result = buildQuietRecallCandidates({
            now: new Date("2026-06-29T12:00:00.000Z"),
            currentNote: { path: "Projects/Alpha.md" },
            savedInsights: [makeInsight()],
        });

        const input = quietRecallCandidateToSavedInsightInput(result.candidates[0]);

        expect(input).toEqual(expect.objectContaining({
            type: "observation",
            origin: "pa-recommended",
            replayRef: "qr-ins-current",
        }));
        expect(JSON.stringify(input)).not.toContain("excerpt");
        expect(input.sourceRefs[0].path).toBe("Projects/Alpha.md");
    });

    it("maps a recall candidate to a route-only Bubble nudge", () => {
        const result = buildQuietRecallCandidates({
            now: new Date("2026-06-29T12:00:00.000Z"),
            currentNote: { path: "Projects/Alpha.md" },
            savedInsights: [makeInsight()],
        });

        const nudge = quietRecallCandidateToBubbleNudge(result.candidates[0]);

        expect(nudge).toEqual({
            candidateId: "qr-ins-current",
            sourceInsightId: "ins-current",
            relation: "current",
            generatedAt: "2026-06-29T12:00:00.000Z",
        });
        expect(JSON.stringify(nudge)).not.toContain("Projects/Alpha.md");
        expect(JSON.stringify(nudge)).not.toContain("Small weekly rituals");
    });
});
