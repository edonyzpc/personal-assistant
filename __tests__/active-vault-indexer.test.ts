import { describe, expect, it, jest } from "@jest/globals";

import {
    ActiveVaultIndexer,
    createRetrievalReplayRecord,
    createSourcesToCheckPlan,
    hasForbiddenPersistedTextFields,
    mapSearchResultsToRetrievalOutcome,
    resolveReplaySourceExcerpt,
    resolveSourcesToCheckPlanDecision,
    validateRetrievalOutcome,
} from "../src/pa";

describe("ActiveVaultIndexer", () => {
    it("maps existing VSS-style results into source and semantic RetrievalOutcome refs", () => {
        const result = mapSearchResultsToRetrievalOutcome([
            {
                score: 0.92,
                doc: {
                    pageContent: "Evidence excerpt that must not persist raw.",
                    metadata: {
                        path: "notes/source.md",
                        headingPath: ["Decision"],
                        contentHash: "abc123",
                    },
                },
            },
        ], {
            id: "avi-test-1",
            taskKind: "pagelet-related-notes",
            scope: "pagelet-current",
        });

        expect(result.outcome).toMatchObject({
            id: "avi-test-1",
            status: "evidence_found",
            taskKind: "pagelet-related-notes",
            scope: "pagelet-current",
            lanes: ["source", "semantic"],
        });
        expect(result.evidence).toEqual([
            expect.objectContaining({
                path: "notes/source.md",
                content: "Evidence excerpt that must not persist raw.",
                score: 0.92,
                headingPath: ["Decision"],
            }),
        ]);
        expect(result.outcome.sources[0]).toMatchObject({
            path: "notes/source.md",
            heading: "Decision",
            contentHash: "abc123",
            excerptHash: expect.any(String),
            evidenceStrength: "strong",
            retrievalOutcomeId: "avi-test-1",
        });
        expect(hasForbiddenPersistedTextFields(result.outcome)).toBe(false);
        expect(validateRetrievalOutcome(result.outcome)).toEqual({ ok: true });
    });

    it("returns no_evidence when VSS has no usable source result", () => {
        const result = mapSearchResultsToRetrievalOutcome([
            { score: 0.9, doc: { pageContent: "missing path", metadata: {} } },
        ], { id: "avi-empty" });

        expect(result.outcome.status).toBe("no_evidence");
        expect(result.outcome.sources).toEqual([]);
        expect(validateRetrievalOutcome(result.outcome)).toEqual({ ok: true });
    });

    it("keeps Data Boundary denied results out of evidence and records privacy skips", () => {
        const result = mapSearchResultsToRetrievalOutcome([
            {
                score: 0.8,
                doc: { pageContent: "allowed", metadata: { path: "notes/allowed.md" } },
            },
            {
                score: 0.7,
                doc: { pageContent: "private", metadata: { path: "private/secret.md" } },
            },
        ], {
            id: "avi-boundary",
            isPathAllowed: (path) => !path.startsWith("private/"),
        });

        expect(result.outcome.status).toBe("partial_evidence");
        expect(result.evidence.map((entry) => entry.path)).toEqual(["notes/allowed.md"]);
        expect(result.outcome.sources.map((source) => source.path)).toEqual(["notes/allowed.md"]);
        expect(result.outcome.skippedSources).toEqual([
            expect.objectContaining({
                path: "private/secret.md",
                skippedReason: "data_boundary",
                boundaryReason: "denied_by_data_boundary",
            }),
        ]);
        expect(hasForbiddenPersistedTextFields(result.outcome)).toBe(false);
    });

    it("returns blocked_by_privacy when all VSS evidence is denied", () => {
        const result = mapSearchResultsToRetrievalOutcome([
            {
                score: 0.7,
                doc: { pageContent: "private", metadata: { path: "private/secret.md" } },
            },
        ], {
            id: "avi-blocked",
            isPathAllowed: () => false,
        });

        expect(result.outcome.status).toBe("blocked_by_privacy");
        expect(result.outcome.sources).toEqual([]);
        expect(result.outcome.skippedSources).toHaveLength(1);
        expect(validateRetrievalOutcome(result.outcome)).toEqual({ ok: true });
    });

    it("adapts Pagelet related-note retrieval through RetrievalOutcome metadata", async () => {
        const searchHybrid = jest.fn(async (
            _query: string,
            _options?: { ftsQueryOverride?: string | null; signal?: AbortSignal },
        ) => [
            {
                score: 0.9,
                doc: { pageContent: "current note chunk", metadata: { path: "notes/current.md" } },
            },
            {
                score: 0.85,
                doc: { pageContent: "related note chunk", metadata: { path: "notes/related.md" } },
            },
        ]);
        const indexer = new ActiveVaultIndexer({ searchHybrid });

        const result = await indexer.retrieveSemantic("related query", {
            id: "avi-pagelet",
            taskKind: "pagelet-related-notes",
            scope: "pagelet-current",
            excludedPaths: ["notes/current.md"],
            ftsQueryOverride: null,
            limit: 6,
        });

        expect(searchHybrid).toHaveBeenCalledWith("related query", expect.objectContaining({
            ftsQueryOverride: null,
        }));
        expect(result.outcome).toMatchObject({
            id: "avi-pagelet",
            status: "evidence_found",
            taskKind: "pagelet-related-notes",
            scope: "pagelet-current",
        });
        expect(result.evidence.map((entry) => entry.path)).toEqual(["notes/related.md"]);
    });

    it("adds activity reasons without letting activity become evidence", () => {
        const current = mapSearchResultsToRetrievalOutcome([
            {
                score: 0.42,
                doc: { pageContent: "current context", metadata: { path: "notes/current.md" } },
            },
        ], {
            id: "avi-activity",
            activity: {
                currentPath: "notes/current.md",
                selectedPaths: ["notes/current.md"],
                recentEditPaths: ["notes/current.md"],
                changedPaths: ["notes/current.md"],
                scopeLabels: ["Current note"],
            },
        });

        expect(current.outcome.status).toBe("evidence_found");
        expect(current.outcome.lanes).toEqual(["source", "semantic", "activity"]);
        expect(current.outcome.sources[0].whyShown).toEqual([
            "Matched by content",
            "Current note context",
            "Selected note context",
            "Recently edited note",
            "Recently changed note",
            "Scope: Current note",
        ]);

        const activityOnly = mapSearchResultsToRetrievalOutcome([
            {
                score: 0,
                doc: { pageContent: "activity-only does not prove evidence", metadata: { path: "notes/current.md" } },
            },
        ], {
            id: "avi-activity-only",
            activity: { currentPath: "notes/current.md" },
        });

        expect(activityOnly.outcome.status).toBe("no_evidence");
        expect(activityOnly.outcome.sources).toEqual([]);
    });

    it("filters denied generated sources before activity or structure metadata is attached", () => {
        const result = mapSearchResultsToRetrievalOutcome([
            {
                score: 0.9,
                doc: {
                    pageContent: "generated private text",
                    metadata: {
                        path: ".pagelet/generated.md",
                        tags: ["project"],
                        links: ["notes/current.md"],
                    },
                },
            },
        ], {
            id: "avi-generated-denied",
            isPathAllowed: () => false,
            activity: { currentPath: ".pagelet/generated.md", scopeLabels: ["Generated"] },
            structureHints: { tags: ["project"], links: ["notes/current.md"] },
        });

        expect(result.outcome.status).toBe("blocked_by_privacy");
        expect(result.outcome.sources).toEqual([]);
        expect(result.outcome.skippedSources[0].whyShown).toEqual(["Excluded by Data Boundary"]);
        expect(result.outcome.skippedSources[0].whyShown).not.toContain("Current note context");
        expect(result.outcome.skippedSources[0].whyShown).not.toContain("Shared tag #project");
        expect(hasForbiddenPersistedTextFields(result.outcome)).toBe(false);
    });

    it("uses structure as a tie-breaker without outranking stronger source-backed evidence", () => {
        const equalStrength = mapSearchResultsToRetrievalOutcome([
            {
                score: 0.51,
                doc: {
                    pageContent: "same strength no structure",
                    metadata: { path: "notes/other.md", tags: ["other"] },
                },
            },
            {
                score: 0.51,
                doc: {
                    pageContent: "same strength with structure",
                    metadata: { path: "projects/pa/structured.md", tags: ["PA"], links: ["notes/current.md"] },
                },
            },
        ], {
            id: "avi-structure",
            structureHints: { folders: ["projects/pa"], tags: ["pa"], links: ["notes/current.md"] },
        });

        expect(equalStrength.evidence.map((entry) => entry.path)).toEqual([
            "projects/pa/structured.md",
            "notes/other.md",
        ]);
        expect(equalStrength.outcome.sources[0].whyShown).toEqual([
            "Matched by content",
            "Same folder",
            "Shared tag #pa",
            "Linked note context",
        ]);

        const weakStructured = mapSearchResultsToRetrievalOutcome([
            {
                score: 0.9,
                doc: { pageContent: "strong evidence", metadata: { path: "notes/strong.md" } },
            },
            {
                score: 0.1,
                doc: {
                    pageContent: "weak but structural",
                    metadata: { path: "projects/pa/weak.md", tags: ["pa"] },
                },
            },
        ], {
            id: "avi-structure-weak",
            structureHints: { folders: ["projects/pa"], tags: ["pa"] },
        });

        expect(weakStructured.evidence.map((entry) => entry.path)).toEqual([
            "notes/strong.md",
            "projects/pa/weak.md",
        ]);
        expect(weakStructured.outcome.status).toBe("evidence_found");
    });

    it("uses Retrieval Habit Profile only as an AVI near-tie signal", () => {
        const retrievalHabitProfile = {
            enabled: true,
            state: {
                aggregates: [{
                    key: "lane:structure",
                    signal: "retrieval_lane" as const,
                    counts: { accept: 1 },
                    updatedAt: "2026-06-29T12:00:00.000Z",
                    windowStart: "2026-06-29",
                    windowDays: 1 as const,
                }],
            },
        };
        const nearTie = mapSearchResultsToRetrievalOutcome([
            {
                score: 0.51,
                doc: { pageContent: "plain medium evidence", metadata: { path: "notes/plain.md" } },
            },
            {
                score: 0.5,
                doc: {
                    pageContent: "structured medium evidence",
                    metadata: { path: "projects/pa/structured.md", tags: ["pa"] },
                },
            },
        ], {
            id: "avi-habit",
            structureHints: { folders: ["projects/pa"], tags: ["pa"] },
            retrievalHabitProfile,
        });

        expect(nearTie.evidence.map((entry) => entry.path)).toEqual([
            "projects/pa/structured.md",
            "notes/plain.md",
        ]);
        expect(nearTie.outcome.sources[0].whyShown).toContain("Shown slightly higher by local recall preferences.");

        const evidenceCeiling = mapSearchResultsToRetrievalOutcome([
            {
                score: 0.9,
                doc: { pageContent: "strong evidence", metadata: { path: "notes/strong.md" } },
            },
            {
                score: 0.2,
                doc: {
                    pageContent: "weak structured evidence",
                    metadata: { path: "projects/pa/weak.md", tags: ["pa"] },
                },
            },
        ], {
            id: "avi-habit-ceiling",
            structureHints: { folders: ["projects/pa"], tags: ["pa"] },
            retrievalHabitProfile,
        });

        expect(evidenceCeiling.evidence.map((entry) => entry.path)).toEqual([
            "notes/strong.md",
            "projects/pa/weak.md",
        ]);

        const unitScaleCeiling = mapSearchResultsToRetrievalOutcome([
            {
                score: 0.69,
                doc: { pageContent: "stronger medium evidence", metadata: { path: "notes/medium.md" } },
            },
            {
                score: 0.25,
                doc: {
                    pageContent: "weaker structured medium evidence",
                    metadata: { path: "projects/pa/weaker.md", tags: ["pa"] },
                },
            },
        ], {
            id: "avi-habit-unit-scale-ceiling",
            structureHints: { folders: ["projects/pa"], tags: ["pa"] },
            retrievalHabitProfile,
        });

        expect(unitScaleCeiling.evidence.map((entry) => entry.path)).toEqual([
            "notes/medium.md",
            "projects/pa/weaker.md",
        ]);
    });

    it("classifies conflict, weak partial, no evidence, and privacy-blocked outcomes explicitly", () => {
        const conflict = mapSearchResultsToRetrievalOutcome([
            {
                score: 0.8,
                doc: {
                    pageContent: "claims status is approved",
                    metadata: { path: "notes/a.md", conflictKey: "status", conflictValue: "approved" },
                },
            },
            {
                score: 0.78,
                doc: {
                    pageContent: "claims status is rejected",
                    metadata: { path: "notes/b.md", conflictKey: "status", conflictValue: "rejected" },
                },
            },
        ], { id: "avi-conflict" });
        expect(conflict.outcome.status).toBe("conflict");
        expect(conflict.outcome.conflictingSources).toHaveLength(2);
        expect(validateRetrievalOutcome(conflict.outcome)).toEqual({ ok: true });

        const weak = mapSearchResultsToRetrievalOutcome([
            {
                score: 0.1,
                doc: { pageContent: "weak support", metadata: { path: "notes/weak.md" } },
            },
        ], { id: "avi-weak" });
        expect(weak.outcome.status).toBe("partial_evidence");

        const noSupport = mapSearchResultsToRetrievalOutcome([
            {
                score: 0,
                doc: { pageContent: "not supporting", metadata: { path: "notes/zero.md" } },
            },
        ], { id: "avi-no-support" });
        expect(noSupport.outcome.status).toBe("no_evidence");

        const privacy = mapSearchResultsToRetrievalOutcome([
            {
                score: 0.8,
                doc: { pageContent: "private", metadata: { path: "private/secret.md" } },
            },
        ], { id: "avi-privacy", isPathAllowed: () => false });
        expect(privacy.outcome.status).toBe("blocked_by_privacy");
    });

    it("builds sources-to-check plans and keeps cancel or adjust side-effect free", async () => {
        const plan = createSourcesToCheckPlan({
            id: "plan-1",
            taskKind: "broad-retrieval",
            scope: "vault",
            sources: [
                {
                    path: "notes/allowed.md",
                    groupLabel: "Notes",
                    decision: "include",
                    providerDisclosureReason: "broad_scope",
                    costNote: "May use AI credits",
                },
                {
                    path: "private/secret.md",
                    groupLabel: "Private",
                    decision: "exclude",
                    reason: "excluded_folder",
                    policySnapshotId: "policy-1",
                },
                {
                    path: ".pagelet/generated.md",
                    groupLabel: "Generated",
                    decision: "ask",
                    reason: "generated_note",
                },
            ],
        });
        const providerCall = jest.fn(async () => "provider-started");

        expect(plan.includedGroups).toEqual([
            expect.objectContaining({
                label: "Notes",
                paths: ["notes/allowed.md"],
                providerDisclosureReasons: ["broad_scope"],
                costNotes: ["May use AI credits"],
            }),
        ]);
        expect(plan.excludedGroups).toEqual([
            expect.objectContaining({
                label: "Private",
                paths: ["private/secret.md"],
                reasons: ["excluded_folder"],
                policySnapshotIds: ["policy-1"],
            }),
        ]);
        expect(plan.askGroups).toHaveLength(1);
        expect(plan.providerDisclosureRequired).toBe(true);
        expect(JSON.stringify(plan)).not.toContain("privateTitle");
        expect(JSON.stringify(plan)).not.toContain("excerpt");
        expect(hasForbiddenPersistedTextFields(plan)).toBe(false);

        await expect(resolveSourcesToCheckPlanDecision(plan, "cancel", providerCall))
            .resolves.toEqual({ decision: "cancel", confirmed: false });
        await expect(resolveSourcesToCheckPlanDecision(plan, "adjust", providerCall))
            .resolves.toEqual({ decision: "adjust", confirmed: false });
        expect(providerCall).not.toHaveBeenCalled();

        await expect(resolveSourcesToCheckPlanDecision(plan, "confirm", providerCall))
            .resolves.toEqual({ decision: "confirm", confirmed: true, result: "provider-started" });
        expect(providerCall).toHaveBeenCalledTimes(1);
    });

    it("creates text-free replay records and re-resolves source text only when allowed", async () => {
        const result = mapSearchResultsToRetrievalOutcome([
            {
                score: 0.86,
                doc: {
                    pageContent: "private current excerpt should only become a hash",
                    metadata: { path: "notes/source.md", contentHash: "content-1" },
                },
            },
        ], { id: "avi-replay" });

        const record = createRetrievalReplayRecord(result.outcome, {
            runId: "run-1",
            policySnapshotId: "policy-1",
            reasons: ["test replay"],
        });

        expect(record).toEqual({
            runId: "run-1",
            retrievalOutcomeId: "avi-replay",
            sourceRefs: [expect.objectContaining({
                path: "notes/source.md",
                contentHash: "content-1",
                excerptHash: expect.any(String),
            })],
            skippedSourceRefs: [],
            reasons: ["test replay"],
            policySnapshotId: "policy-1",
            dataBoundarySnapshotId: undefined,
        });
        expect(JSON.stringify(record)).not.toContain("private current excerpt");
        expect(hasForbiddenPersistedTextFields(record)).toBe(false);

        await expect(resolveReplaySourceExcerpt(
            record,
            "notes/source.md",
            (path) => `current vault content for ${path}`,
            () => true,
        )).resolves.toBe("current vault content for notes/source.md");
        await expect(resolveReplaySourceExcerpt(
            record,
            "notes/source.md",
            () => "denied content",
            () => false,
        )).resolves.toBeNull();
        await expect(resolveReplaySourceExcerpt(
            record,
            "notes/missing.md",
            () => "missing",
            () => true,
        )).resolves.toBeNull();
    });
});
