import { describe, expect, it } from "@jest/globals";

import {
    buildQuietRecallCandidates,
    computeRecallScore,
    quietRecallGovernedClaimId,
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
    it("requires an exact governed claim trace before exposing a Memory target", () => {
        const base = buildQuietRecallCandidates({
            now: new Date("2026-06-29T12:00:00.000Z"),
            currentNote: { path: "Projects/Alpha.md" },
            savedInsights: [makeInsight()],
        }).candidates[0];
        expect(quietRecallGovernedClaimId(base)).toBeNull();
        expect(quietRecallGovernedClaimId({
            ...base,
            context: { kind: "governed_claim", claimId: "claim-exact" },
        })).toBe("claim-exact");
        expect(quietRecallGovernedClaimId({
            ...base,
            context: { kind: "governed_claim", claimId: " claim-exact " },
        })).toBeNull();
    });

    it("scores semantic relevance as the dominant vault-note signal", () => {
        const highSemanticOld = computeRecallScore({
            semanticRelevance: 0.9,
            timeFreshness: 0.1,
            connectionDensity: 0.1,
            noteRichness: 0.1,
            userFeedback: 0.5,
        });
        const lowSemanticFresh = computeRecallScore({
            semanticRelevance: 0.25,
            timeFreshness: 1,
            connectionDensity: 1,
            noteRichness: 1,
            userFeedback: 1,
        });
        const freshTieBreaker = computeRecallScore({
            semanticRelevance: 0.9,
            timeFreshness: 1,
            connectionDensity: 0.1,
            noteRichness: 0.1,
            userFeedback: 0.5,
        });

        expect(highSemanticOld).toBeGreaterThan(lowSemanticFresh);
        expect(freshTieBreaker).toBeGreaterThan(highSemanticOld);
        expect(computeRecallScore({
            semanticRelevance: 0,
            timeFreshness: 0,
            connectionDensity: 0,
            noteRichness: 0,
            userFeedback: 0,
        })).toBe(0);
    });

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
            context: { kind: "note_retrieval" },
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

    it("builds vault-note candidates without sourceInsightId", () => {
        const result = buildQuietRecallCandidates({
            now: new Date("2026-06-29T12:00:00.000Z"),
            currentNote: { path: "Projects/Alpha.md" },
            relatedNotes: [{ path: "Projects/Beta.md", score: 0.86 }],
            vaultNotes: [{
                path: "Projects/Beta.md",
                title: "Beta plan",
                content: "# Beta\n\nThis note has enough planning detail to revisit.",
                tags: ["#project-x"],
                links: ["Projects/Gamma.md"],
                backlinks: ["Projects/Alpha.md"],
                modifiedAt: "2026-06-28T12:00:00.000Z",
            }],
            savedInsights: [],
        });

        expect(result.candidates).toHaveLength(1);
        expect(result.candidates[0]).toEqual(expect.objectContaining({
            id: expect.stringMatching(/^qr-vault-/),
            title: "Recall: Beta plan",
            relation: "related",
            context: { kind: "note_retrieval" },
        }));
        expect(result.candidates[0].sourceInsightId).toBeUndefined();
        expect(result.candidates[0].sourceRefs[0]).toEqual(expect.objectContaining({
            path: "Projects/Beta.md",
        }));

        const nudge = quietRecallCandidateToBubbleNudge(result.candidates[0]);
        expect(nudge).toEqual({
            candidateId: result.candidates[0].id,
            relation: "related",
            generatedAt: "2026-06-29T12:00:00.000Z",
        });
    });

    it("lets vault notes coexist with saved insight candidates", () => {
        const result = buildQuietRecallCandidates({
            now: new Date("2026-06-29T12:00:00.000Z"),
            currentNote: { path: "Projects/Alpha.md" },
            relatedNotes: [{ path: "Projects/Beta.md", score: 0.92 }],
            savedInsights: [makeInsight()],
            vaultNotes: [{
                path: "Projects/Beta.md",
                title: "Beta plan",
                content: "Related beta planning note.",
                tags: ["#project-x"],
                modifiedAt: "2026-06-28T12:00:00.000Z",
            }],
        });

        expect(result.candidates).toHaveLength(2);
        expect(result.candidates.map((candidate) => candidate.sourceInsightId)).toContain("ins-current");
        expect(result.candidates.some((candidate) => candidate.id.startsWith("qr-vault-"))).toBe(true);
    });

    it("applies path filtering to vault-note candidates", () => {
        const result = buildQuietRecallCandidates({
            now: new Date("2026-06-29T12:00:00.000Z"),
            currentNote: { path: "Projects/Alpha.md" },
            relatedNotes: [{ path: "Private/Hidden.md", score: 0.95 }],
            vaultNotes: [{
                path: "Private/Hidden.md",
                title: "Hidden",
                content: "Private note.",
                modifiedAt: "2026-06-28T12:00:00.000Z",
            }],
            isPathAllowed: (path) => !path.startsWith("Private/"),
        });

        expect(result.candidates).toHaveLength(0);
    });

    it("keeps insight-only and vault-only paths independent", () => {
        const insightOnly = buildQuietRecallCandidates({
            now: new Date("2026-06-29T12:00:00.000Z"),
            currentNote: { path: "Projects/Alpha.md" },
            savedInsights: [makeInsight()],
            vaultNotes: [],
        });
        const vaultOnly = buildQuietRecallCandidates({
            now: new Date("2026-06-29T12:00:00.000Z"),
            currentNote: { path: "Projects/Alpha.md" },
            relatedNotes: [{ path: "Projects/Beta.md", score: 0.8 }],
            savedInsights: [],
            vaultNotes: [{ path: "Projects/Beta.md", title: "Beta", content: "Related note." }],
        });

        expect(insightOnly.candidates).toHaveLength(1);
        expect(insightOnly.candidates[0].sourceInsightId).toBe("ins-current");
        expect(vaultOnly.candidates).toHaveLength(1);
        expect(vaultOnly.candidates[0].sourceInsightId).toBeUndefined();
    });

    it("uses richness, connections, and feedback as secondary score signals", () => {
        const shortScore = buildQuietRecallCandidates({
            now: new Date("2026-06-29T12:00:00.000Z"),
            currentNote: { path: "Projects/Alpha.md" },
            relatedNotes: [
                { path: "Projects/Short.md", score: 0.7 },
                { path: "Projects/Rich.md", score: 0.7 },
            ],
            vaultNotes: [
                {
                    path: "Projects/Short.md",
                    title: "Short",
                    content: "Tiny note.",
                    modifiedAt: "2026-06-01T12:00:00.000Z",
                },
                {
                    path: "Projects/Rich.md",
                    title: "Rich",
                    content: "# Plan\n\n" + "Detailed note. ".repeat(120),
                    backlinks: ["A.md", "B.md", "C.md", "D.md", "E.md"],
                    modifiedAt: "2026-06-01T12:00:00.000Z",
                },
            ],
        });

        expect(shortScore.candidates[0].title).toBe("Recall: Rich");
        expect(computeRecallScore({
            semanticRelevance: 0.8,
            timeFreshness: 0.8,
            connectionDensity: 0.8,
            noteRichness: 0.8,
            userFeedback: 0,
        })).toBeLessThan(computeRecallScore({
            semanticRelevance: 0.8,
            timeFreshness: 0.8,
            connectionDensity: 0.8,
            noteRichness: 0.8,
            userFeedback: 1,
        }));
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
