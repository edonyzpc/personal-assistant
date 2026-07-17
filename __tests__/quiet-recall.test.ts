import { describe, expect, it } from "@jest/globals";

import {
    buildQuietRecallCandidates,
    buildQuietRecallWithLlm,
    computeRecallScore,
    extractRecallDigest,
    evaluateRecallWithLlm,
    quietRecallGovernedClaimId,
    quietRecallCandidateToBubbleNudge,
    quietRecallCandidateToSavedInsightInput,
    quietRecallLinkTargetPath,
    type RecallRelevanceEvaluator,
    type RecallRelevanceResult,
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
        expect(result.candidates[0].whyNow).toContain(
            "A related note connects this source to what you are viewing.",
        );
        expect(result.candidates[0].whyNow.join(" ")).not.toContain("Memory search");
    });

    it("puts the actually matched Saved Insight source first", () => {
        const result = buildQuietRecallCandidates({
            now: new Date("2026-06-29T12:00:00.000Z"),
            currentNote: { path: "Projects/Alpha.md" },
            savedInsights: [makeInsight({
                sourceRefs: [
                    { path: "Archive/First.md", evidenceStrength: "medium" },
                    { path: "Projects/Alpha.md", evidenceStrength: "strong" },
                ],
            })],
        });

        expect(result.candidates[0].sourceRefs.map((ref) => ref.path)).toEqual([
            "Projects/Alpha.md",
            "Archive/First.md",
        ]);
        expect(result.candidates[0].title).toBe("Recall: Alpha");
    });

    it("keeps the matched current source first while selecting a distinct link target", () => {
        const result = buildQuietRecallCandidates({
            now: new Date("2026-06-29T12:00:00.000Z"),
            currentNote: { path: "Projects/Alpha.md" },
            savedInsights: [makeInsight({
                sourceRefs: [
                    { path: "Archive/First.md", evidenceStrength: "medium" },
                    { path: "Projects/Alpha.md", evidenceStrength: "strong" },
                ],
            })],
        });

        const candidate = result.candidates[0];
        expect(candidate.sourceRefs.map((ref) => ref.path)).toEqual([
            "Projects/Alpha.md",
            "Archive/First.md",
        ]);
        expect(quietRecallLinkTargetPath(candidate, "./Projects/Alpha.md"))
            .toBe("Archive/First.md");
        expect(quietRecallLinkTargetPath({
            sourceRefs: [{ path: "Projects/Alpha.md" }],
        }, "Projects/Alpha.md")).toBeNull();
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

    it("localizes generated recall copy for Chinese UI", () => {
        const result = buildQuietRecallCandidates({
            now: new Date("2026-06-29T12:00:00.000Z"),
            locale: "zh",
            currentNote: { path: "Projects/Alpha.md" },
            relatedNotes: [{ path: "Projects/Beta.md", score: 0.86 }],
            vaultNotes: [{
                path: "Projects/Beta.md",
                title: "Beta 计划",
                content: "# Beta\n\n这是一篇值得重新查看的计划笔记。",
                tags: ["项目", "计划"],
                modifiedAt: "2026-06-28T12:00:00.000Z",
            }],
        });

        const candidate = result.candidates[0];
        expect(candidate.title).toBe("回忆：Beta 计划");
        expect(candidate.summary).toBe("Beta 计划 可能再次对当前情境有用。标签：项目、计划。");
        expect(candidate.whyNow.join(" ")).toMatch(/[\u3400-\u9fff]/);
        expect(candidate.nextAction).toBe("打开来源笔记，看看这条联系现在是否仍然重要。");
        expect(JSON.stringify(candidate)).not.toContain("Memory search");
    });

    it("persists Chinese recall reasons without an English relation marker", () => {
        const result = buildQuietRecallCandidates({
            now: new Date("2026-06-29T12:00:00.000Z"),
            locale: "zh",
            currentNote: { path: "Projects/Alpha.md" },
            relatedNotes: [{ path: "Projects/Beta.md", score: 0.86 }],
            vaultNotes: [{
                path: "Projects/Beta.md",
                title: "Beta 计划",
                content: "# Beta\n\n这是一篇值得重新查看的计划笔记。",
            }],
        });

        const candidate = result.candidates[0];
        const input = quietRecallCandidateToSavedInsightInput(candidate);
        expect(input.whyShown).toEqual(candidate.whyNow);
        expect(input.whyShown.join(" ")).toMatch(/[\u3400-\u9fff]/);
        expect(JSON.stringify(input)).not.toContain("Quiet Recall relation");
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

describe("extractRecallDigest", () => {
    it("extracts title from path basename when no title provided", () => {
        const digest = extractRecallDigest({
            path: "Projects/My-Note.md",
            content: "Some content here.",
        });
        expect(digest.title).toBe("My-Note");
    });

    it("prefers explicit title over path-derived name", () => {
        const digest = extractRecallDigest({
            path: "Projects/My-Note.md",
            title: "My Custom Title",
            content: "Some content here.",
        });
        expect(digest.title).toBe("My Custom Title");
    });

    it("extracts ## headings from content", () => {
        const digest = extractRecallDigest({
            path: "note.md",
            content: "# Top heading\n\n## First section\n\nParagraph.\n\n## Second section\n\nMore text.\n\n### Sub-heading\n",
        });
        expect(digest.headings).toEqual(["First section", "Second section"]);
    });

    it("extracts the first non-empty paragraph skipping headings", () => {
        const digest = extractRecallDigest({
            path: "note.md",
            content: "# Title\n\n## Intro\n\nThis is the first real paragraph content.\nIt continues on the next line.\n\nSecond paragraph ignored.",
        });
        expect(digest.firstParagraph).toBe(
            "This is the first real paragraph content. It continues on the next line.",
        );
    });

    it("handles empty content gracefully", () => {
        const digest = extractRecallDigest({
            path: "empty.md",
        });
        expect(digest.title).toBe("empty");
        expect(digest.headings).toEqual([]);
        expect(digest.firstParagraph).toBe("");
    });

    it("handles content with only headings and no paragraphs", () => {
        const digest = extractRecallDigest({
            path: "headings-only.md",
            content: "# Title\n\n## Section A\n\n## Section B\n",
        });
        expect(digest.headings).toEqual(["Section A", "Section B"]);
        expect(digest.firstParagraph).toBe("");
    });
});

describe("evaluateRecallWithLlm", () => {
    it("returns the evaluator result on success", async () => {
        const mockEvaluator: RecallRelevanceEvaluator = async () => ({
            isConvincing: true,
            whyNow: "Your current note discusses caching; this old note has Redis benchmarks.",
        });

        const result = await evaluateRecallWithLlm(
            { title: "Current", headings: ["Caching"], firstParagraph: "Evaluating cache strategies." },
            { title: "Redis Perf", headings: ["Benchmarks"], firstParagraph: "Redis benchmark data." },
            "3 months",
            mockEvaluator,
        );

        expect(result.isConvincing).toBe(true);
        expect(result.whyNow).toBe("Your current note discusses caching; this old note has Redis benchmarks.");
    });

    it("returns silence on evaluator failure", async () => {
        const failingEvaluator: RecallRelevanceEvaluator = async () => {
            throw new Error("LLM timeout");
        };

        const result = await evaluateRecallWithLlm(
            { title: "A", headings: [], firstParagraph: "" },
            { title: "B", headings: [], firstParagraph: "" },
            "1 weeks",
            failingEvaluator,
        );

        expect(result.isConvincing).toBe(false);
        expect(result.whyNow).toBeNull();
    });
});

describe("buildQuietRecallWithLlm", () => {
    it("filters out candidates the LLM deems unconvincing", async () => {
        const evaluator: RecallRelevanceEvaluator = async ({ candidateDigest }) => {
            if (candidateDigest.title.includes("Beta")) {
                return { isConvincing: true, whyNow: "Beta is directly relevant to your current caching discussion." };
            }
            return { isConvincing: false, whyNow: null };
        };

        const result = await buildQuietRecallWithLlm({
            now: new Date("2026-06-29T12:00:00.000Z"),
            currentNote: { path: "Projects/Alpha.md", content: "# Alpha\n\nEvaluating cache strategies." },
            relatedNotes: [
                { path: "Projects/Beta.md", score: 0.86 },
                { path: "Projects/Gamma.md", score: 0.80 },
            ],
            vaultNotes: [
                {
                    path: "Projects/Beta.md",
                    title: "Beta plan",
                    content: "# Beta\n\n## Cache Design\n\nRedis benchmark data here.",
                    modifiedAt: "2026-06-20T12:00:00.000Z",
                },
                {
                    path: "Projects/Gamma.md",
                    title: "Gamma notes",
                    content: "# Gamma\n\nUnrelated meeting notes.",
                    modifiedAt: "2026-06-25T12:00:00.000Z",
                },
            ],
            savedInsights: [],
            evaluateRelevance: evaluator,
        });

        expect(result.candidates).toHaveLength(1);
        expect(result.candidates[0].whyNow).toEqual([
            "Beta is directly relevant to your current caching discussion.",
        ]);
    });

    it("replaces template whyNow with LLM reasoning", async () => {
        const evaluator: RecallRelevanceEvaluator = async () => ({
            isConvincing: true,
            whyNow: "LLM-generated specific reason.",
        });

        const result = await buildQuietRecallWithLlm({
            now: new Date("2026-06-29T12:00:00.000Z"),
            currentNote: { path: "Projects/Alpha.md", content: "# Alpha\n\nSome content." },
            relatedNotes: [{ path: "Projects/Beta.md", score: 0.9 }],
            vaultNotes: [{
                path: "Projects/Beta.md",
                title: "Beta",
                content: "# Beta\n\nRelated content.",
                modifiedAt: "2026-06-28T12:00:00.000Z",
            }],
            savedInsights: [],
            evaluateRelevance: evaluator,
        });

        expect(result.candidates[0].whyNow).toEqual(["LLM-generated specific reason."]);
    });

    it("skips LLM evaluation when no current note provided", async () => {
        let evaluatorCalled = false;
        const evaluator: RecallRelevanceEvaluator = async () => {
            evaluatorCalled = true;
            return { isConvincing: true, whyNow: "Should not be called." };
        };

        const result = await buildQuietRecallWithLlm({
            now: new Date("2026-06-29T12:00:00.000Z"),
            relatedNotes: [{ path: "Projects/Beta.md", score: 0.9 }],
            vaultNotes: [{
                path: "Projects/Beta.md",
                title: "Beta",
                content: "Content.",
                modifiedAt: "2026-06-28T12:00:00.000Z",
            }],
            savedInsights: [],
            evaluateRelevance: evaluator,
        });

        // Without a current note, LLM evaluation is skipped; base result returned as-is
        expect(evaluatorCalled).toBe(false);
        expect(result.candidates).toHaveLength(1);
    });

    it("gracefully handles LLM failure for individual candidates", async () => {
        let callCount = 0;
        const evaluator: RecallRelevanceEvaluator = async () => {
            callCount++;
            if (callCount === 1) throw new Error("Network error");
            return { isConvincing: true, whyNow: "Valid reason." };
        };

        const result = await buildQuietRecallWithLlm({
            now: new Date("2026-06-29T12:00:00.000Z"),
            currentNote: { path: "Projects/Alpha.md", content: "# Alpha\n\nContent." },
            relatedNotes: [
                { path: "Projects/Beta.md", score: 0.88 },
                { path: "Projects/Gamma.md", score: 0.85 },
            ],
            vaultNotes: [
                {
                    path: "Projects/Beta.md",
                    title: "Beta",
                    content: "# Beta\n\nFirst candidate.",
                    modifiedAt: "2026-06-27T12:00:00.000Z",
                },
                {
                    path: "Projects/Gamma.md",
                    title: "Gamma",
                    content: "# Gamma\n\nSecond candidate.",
                    modifiedAt: "2026-06-26T12:00:00.000Z",
                },
            ],
            savedInsights: [],
            evaluateRelevance: evaluator,
        });

        // First candidate fails (filtered out), second succeeds
        expect(result.candidates).toHaveLength(1);
        expect(result.candidates[0].whyNow).toEqual(["Valid reason."]);
    });

    it("passes candidate age to the evaluator", async () => {
        let receivedAge = "";
        const evaluator: RecallRelevanceEvaluator = async ({ candidateAge }) => {
            receivedAge = candidateAge;
            return { isConvincing: true, whyNow: "Reason." };
        };

        await buildQuietRecallWithLlm({
            now: new Date("2026-06-29T12:00:00.000Z"),
            currentNote: { path: "Projects/Alpha.md", content: "# Alpha\n\nContent." },
            relatedNotes: [{ path: "Projects/Beta.md", score: 0.9 }],
            vaultNotes: [{
                path: "Projects/Beta.md",
                title: "Beta",
                content: "# Beta\n\nContent.",
                modifiedAt: "2026-06-01T12:00:00.000Z",
            }],
            savedInsights: [],
            evaluateRelevance: evaluator,
        });

        expect(receivedAge).toBe("4 weeks");
    });
});
