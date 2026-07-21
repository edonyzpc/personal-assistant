import { describe, expect, it, jest } from "@jest/globals";

import {
    RetrievalHabitProfileStore,
    applyRetrievalHabitProfileToEvidence,
    applyRetrievalHabitProfileToRecallCandidates,
    normalizeRetrievalHabitProfileSettings,
    type QuietRecallCandidate,
    type RetrievalHabitEvidenceInput,
    type RetrievalHabitProfileSettings,
} from "../src/pa";

function makeCandidate(overrides: Partial<QuietRecallCandidate> = {}): QuietRecallCandidate {
    return {
        id: "qr-ins-alpha",
        title: "Recall: Alpha",
        summary: "Small weekly rituals help old project context stay usable.",
        sourceInsightId: "ins-alpha",
        sourceRefs: [{
            path: "Projects/Alpha.md",
            evidenceStrength: "medium",
            sourceId: "data_boundary:allowed_by_policy",
        }],
        whyNow: ["Source appears near the current note in Memory search."],
        nextAction: "Open the source note and decide whether the connection still matters.",
        relation: "related",
        score: 48,
        generatedAt: "2026-06-29T12:00:00.000Z",
        ...overrides,
    };
}

describe("RetrievalHabitProfileStore", () => {
    it("does not collect feedback while disabled", async () => {
        const persist = jest.fn((_settings: RetrievalHabitProfileSettings) => undefined);
        const settings: RetrievalHabitProfileSettings = {
            enabled: false,
            state: { aggregates: [] },
        };
        const store = new RetrievalHabitProfileStore({ settings, persist });

        const result = await store.recordRecallFeedback(makeCandidate(), "dismiss");

        expect(result).toEqual({ ok: false, reason: "disabled" });
        expect(settings.state.aggregates).toEqual([]);
        expect(persist).not.toHaveBeenCalled();
    });

    it("keeps dismiss as a weak exact-candidate signal without source or relation generalization", async () => {
        const settings: RetrievalHabitProfileSettings = {
            enabled: true,
            state: { aggregates: [] },
        };
        const store = new RetrievalHabitProfileStore({
            settings,
            now: new Date("2026-06-29T12:00:00.000Z"),
        });
        const dismissed = makeCandidate({
            id: "qr-ins-dismissed",
            title: "Recall: Dismissed",
            score: 48,
        });
        const similar = makeCandidate({
            id: "qr-ins-similar",
            title: "Recall: Similar",
            score: 48,
        });

        const result = await store.recordRecallFeedback(dismissed, "dismiss");

        expect(result.ok).toBe(true);
        expect(settings.state.aggregates).toHaveLength(1);
        expect(settings.state.aggregates[0]).toEqual(expect.objectContaining({
            signal: "quiet_recall_candidate",
            key: expect.stringMatching(/^candidate:[0-9a-f]{8}$/),
            counts: { dismiss: 1 },
        }));
        expect(settings.state.aggregates).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ signal: "quiet_recall_relation" }),
            expect.objectContaining({ signal: "quiet_recall_source" }),
            expect.objectContaining({ signal: "quiet_recall_strength" }),
        ]));
        expect(JSON.stringify(settings.state)).not.toContain(dismissed.id);

        const ranked = applyRetrievalHabitProfileToRecallCandidates([dismissed, similar], settings);
        expect(ranked[0].id).toBe(similar.id);
        expect(ranked.find((candidate) => candidate.id === similar.id)?.score).toBe(similar.score);
        expect(ranked.find((candidate) => candidate.id === dismissed.id)?.score).toBeLessThan(dismissed.score);
    });

    it("stores enabled recall feedback as aggregate-only local signals", async () => {
        const settings: RetrievalHabitProfileSettings = {
            enabled: true,
            state: { aggregates: [] },
        };
        const store = new RetrievalHabitProfileStore({
            settings,
            now: new Date("2026-06-29T12:00:00.000Z"),
        });

        const result = await store.recordRecallFeedback(makeCandidate(), "view");

        expect(result.ok).toBe(true);
        expect(settings.state.aggregates).toEqual(expect.arrayContaining([
            expect.objectContaining({
                key: "relation:related",
                signal: "quiet_recall_relation",
                counts: { view: 1 },
                windowStart: "2026-06-29",
                windowDays: 1,
            }),
            expect.objectContaining({
                signal: "quiet_recall_source",
                key: expect.stringMatching(/^source:[0-9a-f]{8}$/),
                counts: { view: 1 },
                windowStart: "2026-06-29",
            }),
            expect.objectContaining({
                key: "strength:medium",
                signal: "quiet_recall_strength",
                counts: { view: 1 },
                windowStart: "2026-06-29",
            }),
        ]));
        expect(settings.state.aggregates).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ signal: "quiet_recall_candidate" }),
        ]));
        const serialized = JSON.stringify(settings.state);
        expect(serialized).not.toContain("Projects/Alpha.md");
        expect(serialized).not.toContain("Recall: Alpha");
        expect(serialized).not.toContain("Small weekly rituals");
        expect(serialized).not.toContain("data_boundary:allowed_by_policy");
        expect(serialized).not.toContain("query");
        expect(serialized).not.toContain("providerOutput");
        expect(serialized).not.toContain("sensitive");
    });

    it("keeps only 90 days of aggregate buckets and decays older local signals", async () => {
        const settings: RetrievalHabitProfileSettings = {
            enabled: true,
            state: {
                aggregates: [
                    {
                        key: "relation:related",
                        signal: "quiet_recall_relation",
                        counts: { accept: 1 },
                        updatedAt: "2026-03-30T12:00:00.000Z",
                        windowStart: "2026-03-30",
                        windowDays: 1,
                    },
                    {
                        key: "relation:far",
                        signal: "quiet_recall_relation",
                        counts: { accept: 1 },
                        updatedAt: "2026-04-01T12:00:00.000Z",
                        windowStart: "2026-04-01",
                        windowDays: 1,
                    },
                ],
            },
        };
        const store = new RetrievalHabitProfileStore({
            settings,
            now: new Date("2026-06-29T12:00:00.000Z"),
        });

        await store.recordRecallFeedback(makeCandidate(), "view");

        expect(settings.state.aggregates).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ windowStart: "2026-03-30" }),
        ]));
        expect(settings.state.aggregates).toEqual(expect.arrayContaining([
            expect.objectContaining({ key: "relation:far", windowStart: "2026-04-01" }),
            expect.objectContaining({ key: "relation:related", windowStart: "2026-06-29" }),
        ]));
    });

    it("does not learn from excluded source scopes", async () => {
        const settings: RetrievalHabitProfileSettings = {
            enabled: true,
            state: { aggregates: [] },
        };
        const store = new RetrievalHabitProfileStore({
            settings,
            isSourceAllowed: (ref) => !ref.path.startsWith("Private/"),
        });

        const result = await store.recordRecallFeedback(makeCandidate({
            sourceRefs: [{ path: "Private/Alpha.md", evidenceStrength: "strong" }],
        }), "not_relevant");

        expect(result).toEqual({ ok: false, reason: "excluded_scope" });
        expect(settings.state.aggregates).toEqual([]);
    });

    it("rejects raw query, path-like, prompt, provider output, and sensitive signal shapes", async () => {
        const settings: RetrievalHabitProfileSettings = {
            enabled: true,
            state: { aggregates: [] },
        };
        const store = new RetrievalHabitProfileStore({ settings });

        await expect(store.recordSignals([
            { signal: "query_type", key: "query:Private/Raw Query" },
        ], "view")).resolves.toEqual({ ok: false, reason: "invalid_source" });

        await expect(store.recordSignals([
            { signal: "retrieval_scope", key: "scope:tag" },
        ], "view", [{
            path: "Notes/Allowed.md",
            providerOutput: "raw provider text",
        } as never])).resolves.toEqual({ ok: false, reason: "unsafe_source" });

        expect(settings.state.aggregates).toEqual([]);
        const serialized = JSON.stringify(settings.state);
        expect(serialized).not.toContain("Private/Raw Query");
        expect(serialized).not.toContain("raw provider text");
    });

    it("uses aggregate feedback only as weak local near-tie ranking influence", async () => {
        const settings: RetrievalHabitProfileSettings = {
            enabled: true,
            state: { aggregates: [] },
        };
        const store = new RetrievalHabitProfileStore({
            settings,
            now: new Date("2026-06-29T12:00:00.000Z"),
        });
        const accepted = makeCandidate({
            id: "qr-ins-accepted",
            title: "Recall: Accepted",
            sourceInsightId: "ins-accepted",
            relation: "related",
            score: 42.6,
        });
        const neutral = makeCandidate({
            id: "qr-ins-neutral",
            title: "Recall: Neutral",
            sourceInsightId: "ins-neutral",
            relation: "far",
            sourceRefs: [{ path: "Archive/Neutral.md", evidenceStrength: "strong" }],
            score: 42,
        });
        const farBetter = makeCandidate({
            id: "qr-ins-far-better",
            title: "Recall: Far Better",
            sourceInsightId: "ins-far-better",
            relation: "far",
            sourceRefs: [{ path: "Archive/Far Better.md", evidenceStrength: "medium" }],
            score: 46,
        });

        await store.recordRecallFeedback(accepted, "accept");
        const influenced = applyRetrievalHabitProfileToRecallCandidates([neutral, accepted], settings);

        expect(influenced[0].id).toBe("qr-ins-neutral");
        expect(influenced[0].sourceRefs[0].evidenceStrength).toBe("strong");

        const nearTie = applyRetrievalHabitProfileToRecallCandidates([
            { ...neutral, sourceRefs: [{ path: "Archive/Neutral.md", evidenceStrength: "medium" }], score: 42.9 },
            accepted,
        ], settings);
        expect(nearTie[0].id).toBe("qr-ins-accepted");
        expect(nearTie[0].score - accepted.score).toBeLessThanOrEqual(0.75);
        expect(nearTie[0].whyNow).toContain("Shown slightly higher by local recall preferences.");

        const outsideTieWindow = applyRetrievalHabitProfileToRecallCandidates([farBetter, accepted], settings);
        expect(outsideTieWindow[0].id).toBe("qr-ins-far-better");

        await store.clear();
        const cleared = applyRetrievalHabitProfileToRecallCandidates([neutral, accepted], settings);
        expect(cleared[0].id).toBe("qr-ins-neutral");

        settings.enabled = false;
        await store.recordRecallFeedback(accepted, "accept");
        expect(settings.state.aggregates).toEqual([]);
    });

    it("applies the same weak ceiling to generic retrieval evidence", async () => {
        const settings: RetrievalHabitProfileSettings = {
            enabled: true,
            state: { aggregates: [] },
        };
        const store = new RetrievalHabitProfileStore({
            settings,
            now: new Date("2026-06-29T12:00:00.000Z"),
        });
        await store.recordSignals([
            { signal: "retrieval_lane", key: "lane:structure" },
        ], "accept", [{ path: "Projects/Favored.md", evidenceStrength: "medium" }]);
        const favored: RetrievalHabitEvidenceInput = {
            score: 40.8,
            evidenceStrength: "medium",
            lanes: ["source", "semantic", "structure"],
            sourceRef: { path: "Projects/Favored.md", evidenceStrength: "medium" },
            whyShown: ["Matched by content"],
        };
        const neutral: RetrievalHabitEvidenceInput = {
            score: 41,
            evidenceStrength: "medium",
            lanes: ["source", "semantic"],
            sourceRef: { path: "Projects/Neutral.md", evidenceStrength: "medium" },
            whyShown: ["Matched by content"],
        };
        const strong: RetrievalHabitEvidenceInput = {
            score: 39,
            evidenceStrength: "strong",
            lanes: ["source", "semantic"],
            sourceRef: { path: "Projects/Strong.md", evidenceStrength: "strong" },
            whyShown: ["Matched by content"],
        };

        const nearTie = applyRetrievalHabitProfileToEvidence([neutral, favored], settings);
        expect(nearTie[0].sourceRef.path).toBe("Projects/Favored.md");
        expect(nearTie[0].whyShown).toContain("Shown slightly higher by local recall preferences.");

        const evidenceCeiling = applyRetrievalHabitProfileToEvidence([favored, strong], settings);
        expect(evidenceCeiling[0].sourceRef.path).toBe("Projects/Strong.md");
    });

    it("keeps VSS 0-1 evidence scores evidence-first outside a unit-scale near tie", async () => {
        const settings: RetrievalHabitProfileSettings = {
            enabled: true,
            state: { aggregates: [] },
        };
        const store = new RetrievalHabitProfileStore({
            settings,
            now: new Date("2026-06-29T12:00:00.000Z"),
        });
        await store.recordSignals([
            { signal: "retrieval_lane", key: "lane:structure" },
        ], "accept", [{ path: "Projects/Favored.md", evidenceStrength: "medium" }]);
        const stronger: RetrievalHabitEvidenceInput = {
            score: 0.69,
            evidenceStrength: "medium",
            lanes: ["source", "semantic"],
            sourceRef: { path: "Projects/Stronger.md", evidenceStrength: "medium" },
            whyShown: ["Matched by content"],
        };
        const favored: RetrievalHabitEvidenceInput = {
            score: 0.25,
            evidenceStrength: "medium",
            lanes: ["source", "semantic", "structure"],
            sourceRef: { path: "Projects/Favored.md", evidenceStrength: "medium" },
            whyShown: ["Matched by content"],
        };
        const nearTieNeutral: RetrievalHabitEvidenceInput = {
            ...stronger,
            score: 0.51,
            sourceRef: { path: "Projects/Near Tie.md", evidenceStrength: "medium" },
        };
        const nearTieFavored: RetrievalHabitEvidenceInput = {
            ...favored,
            score: 0.5,
        };

        expect(applyRetrievalHabitProfileToEvidence([stronger, favored], settings)[0].sourceRef.path)
            .toBe("Projects/Stronger.md");
        expect(applyRetrievalHabitProfileToEvidence([nearTieNeutral, nearTieFavored], settings)[0].sourceRef.path)
            .toBe("Projects/Favored.md");
    });

    it("drops unsafe persisted aggregate keys during normalization", () => {
        const normalized = normalizeRetrievalHabitProfileSettings({
            enabled: true,
            state: {
                aggregates: [
                    {
                        key: "Projects/Alpha.md",
                        signal: "quiet_recall_source",
                        counts: { view: 1 },
                        updatedAt: "2026-06-29T12:00:00.000Z",
                    },
                    {
                        key: "source:1234abcd",
                        signal: "quiet_recall_source",
                        sourceId: "AlphaPlan",
                        counts: { view: 1 },
                        updatedAt: "2026-06-29T12:00:00.000Z",
                    },
                ],
            },
        });

        expect(normalized.state.aggregates).toEqual([
            expect.objectContaining({
                key: "source:1234abcd",
                signal: "quiet_recall_source",
            }),
        ]);
        expect(JSON.stringify(normalized)).not.toContain("Projects/Alpha.md");
        expect(JSON.stringify(normalized)).not.toContain("AlphaPlan");
    });
});
