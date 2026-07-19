import { describe, expect, it } from "@jest/globals";

import {
    buildScopeRecap,
    buildScopeRecapInsightFingerprint,
    buildScopeRecapLocalOverview,
    buildScopeRecapGeneratedNote,
    buildScopeRecapMarkdown,
    buildScopeRecapSourceSnapshotId,
    buildScopeRecapWithLlm,
    evaluateScopeRecapArtifactCurrentness,
    evaluateScopeRecapProactiveQuality,
    extractNoteDigest,
    hasForbiddenPersistedTextFields,
    prepareScopeRecapWithLlm,
    selectStrongestConcreteScopeRecapInsight,
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

    it("filters generated or denied sources without treating normal exclusions as a boundary change", () => {
        const sourceNotes = [
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
        ];
        const recap = buildScopeRecap(sourceNotes, {
            now: new Date("2026-06-29T12:00:00.000Z"),
            isPathAllowed: (path) => !path.startsWith("Private/"),
        });

        expect(recap.sourceCoverage).toMatchObject({
            totalSourceCount: 5,
            includedSourceCount: 3,
            skippedSourceCount: 2,
        });
        expect(recap.staleStatus).toBe("fresh");
        expect(recap.skippedSources).toEqual(expect.arrayContaining([
            expect.objectContaining({ reason: "generated_source", count: 1 }),
            expect.objectContaining({ reason: "data_boundary", count: 1 }),
        ]));
        expect(JSON.stringify(recap)).not.toContain("Private/Secret.md");

        const lowCoverage = buildScopeRecap([notes()[0]], {
            now: new Date("2026-06-29T12:00:00.000Z"),
        });
        expect(lowCoverage.staleStatus).toBe("low-coverage");

        const invalidated = buildScopeRecap(sourceNotes, {
            now: new Date("2026-06-29T12:00:00.000Z"),
            isPathAllowed: (path) => !path.startsWith("Private/"),
            dataBoundaryChanged: true,
        });
        expect(invalidated.staleStatus).toBe("boundary-changed");
    });

    it("marks recaps stale when source paths changed", () => {
        const recap = buildScopeRecap(notes(), {
            now: new Date("2026-06-29T12:00:00.000Z"),
            changedSourcePaths: ["Projects/PA/Alpha.md"],
        });

        expect(recap.staleStatus).toBe("stale");
    });

    it("uses full content and mtime in a generation-time-independent source snapshot", () => {
        const scope = { kind: "selected_notes" as const, paths: ["Projects/PA/Beta.md", "./Projects/PA/Alpha.md"] };
        const sourceNotes = [
            { ...notes()[0], content: "same-A", modifiedAt: "2026-07-01T00:00:00.000Z" },
            { ...notes()[1], content: "same-B", modifiedAt: "2026-07-02T00:00:00.000Z" },
        ];
        const first = buildScopeRecapSourceSnapshotId(scope, sourceNotes);
        const reordered = buildScopeRecapSourceSnapshotId(
            { ...scope, paths: [...scope.paths].reverse() },
            [...sourceNotes].reverse(),
        );
        const sameLengthEdit = buildScopeRecapSourceSnapshotId(scope, [
            { ...sourceNotes[0], content: "same-Z" },
            sourceNotes[1],
        ]);
        const mtimeEdit = buildScopeRecapSourceSnapshotId(scope, [
            { ...sourceNotes[0], modifiedAt: "2026-07-03T00:00:00.000Z" },
            sourceNotes[1],
        ]);

        expect(reordered).toBe(first);
        expect(sameLengthEdit).not.toBe(first);
        expect(mtimeEdit).not.toBe(first);

        const earlier = buildScopeRecap(sourceNotes, { scope, now: new Date("2026-07-04T00:00:00.000Z") });
        const later = buildScopeRecap(sourceNotes, { scope, now: new Date("2026-07-05T00:00:00.000Z") });
        expect(earlier.sourceSnapshotId).toBe(later.sourceSnapshotId);
        expect(earlier.sourceRefs[0].contentHash).not.toBe(
            buildScopeRecap([{ ...sourceNotes[0], content: "same-Z" }], { scope }).sourceRefs[0].contentHash,
        );
    });

    it("builds a bounded explanation-only local overview", () => {
        const overview = buildScopeRecapLocalOverview(notes(), {
            now: new Date("2026-07-04T00:00:00.000Z"),
            scope: { kind: "folder", label: "Projects/PA", paths: notes().map((note) => note.path) },
            changedSourcePaths: [notes()[1].path],
            maxSources: 2,
        });

        expect(overview.kind).toBe("local_scope_overview");
        expect(overview.includedSources).toHaveLength(2);
        expect(overview.includedSources[1].changed).toBe(true);
        expect(overview.sourceCoverage.includedSourceCount).toBe(3);
        expect(overview).not.toHaveProperty("themes");
        expect(overview).not.toHaveProperty("summary");
        expect(overview).not.toHaveProperty("nextReviewActions");
    });

    it("validates TTL, normalized scope, source snapshot, and Data Boundary together", () => {
        const recap = buildScopeRecap(notes(), {
            now: new Date("2026-07-04T00:00:00.000Z"),
            ttlDays: 7,
            scope: { kind: "folder", label: "Projects/PA", paths: notes().map((note) => note.path) },
            dataBoundarySnapshotId: "boundary-1",
        });
        const current = {
            scope: { ...recap.scope, paths: [...(recap.scope.paths ?? [])].reverse() },
            sourceSnapshotId: recap.sourceSnapshotId!,
            dataBoundarySnapshotId: "boundary-1",
            now: new Date("2026-07-10T23:59:59.000Z"),
        };

        expect(evaluateScopeRecapArtifactCurrentness(recap, current)).toEqual({ current: true });
        expect(evaluateScopeRecapArtifactCurrentness(recap, {
            ...current,
            sourceSnapshotId: "other-snapshot",
        })).toEqual({ current: false, reason: "source_snapshot_mismatch" });
        expect(evaluateScopeRecapArtifactCurrentness(recap, {
            ...current,
            dataBoundarySnapshotId: "boundary-2",
        })).toEqual({ current: false, reason: "data_boundary_mismatch" });
        expect(evaluateScopeRecapArtifactCurrentness(recap, {
            ...current,
            now: new Date("2026-07-11T00:00:00.000Z"),
        })).toEqual({ current: false, reason: "expired" });
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
                whyItMatters: "The release decision cannot be trusted until the conflicting intent is resolved.",
                sourceNoteTitles: ["Alpha", "Beta"],
                section: "tension",
            },
            {
                title: "Review-first pattern",
                summary: "Multiple notes emphasize reviewing before acting, suggesting a core principle.",
                whyItMatters: "This principle should govern the next implementation choice.",
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
        expect(evaluateScopeRecapProactiveQuality(recap).eligible).toBe(true);
    });

    it("falls back to silence when LLM returns null", async () => {
        const generateInsights: GenerateRecapInsightsCallback = async () => null;

        const recap = await buildScopeRecapWithLlm(testNotes(), generateInsights, {
            now: new Date("2026-07-01T10:00:00.000Z"),
        });

        expect(recap.themes).toHaveLength(0);
        expect(recap.tensions).toHaveLength(0);
        expect(recap.openQuestions).toHaveLength(0);
        expect(evaluateScopeRecapProactiveQuality(recap)).toEqual({
            eligible: false,
            reason: "no_concrete_insight",
        });
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
        expect(evaluateScopeRecapProactiveQuality(recap).eligible).toBe(false);
    });

    it("keeps a matched single-source insight for click-to-view but not proactive delivery", async () => {
        const mockInsights: RecapLlmInsight[] = [
            {
                title: "Ghost reference",
                summary: "References notes that do not exist.",
                whyItMatters: "The relationship would matter if the sources existed.",
                sourceNoteTitles: ["NonExistent", "AlsoMissing"],
                section: "theme",
            },
            {
                title: "Valid insight",
                summary: "This one has real sources.",
                whyItMatters: "Without resolving this question, the next release decision could use the wrong constraint.",
                sourceNoteTitles: ["Alpha"],
                section: "open_question",
            },
        ];

        const generateInsights: GenerateRecapInsightsCallback = async () => mockInsights;

        const preparation = await prepareScopeRecapWithLlm(testNotes(), generateInsights, {
            now: new Date("2026-07-01T10:00:00.000Z"),
        });

        expect(preparation.status).toBe("ready");
        if (preparation.status !== "ready") throw new Error("expected ready single-source Recap");
        expect(preparation.artifact.openQuestions).toEqual([
            expect.objectContaining({
                title: "Valid insight",
                sourceRefs: [expect.objectContaining({ path: "Projects/PA/Alpha.md" })],
            }),
        ]);
        expect(evaluateScopeRecapProactiveQuality(preparation.artifact)).toEqual({
            eligible: false,
            reason: "insufficient_distinct_sources",
        });
    });

    it("allows explicit single-note Recap generation without making it proactive", async () => {
        let called = false;
        const generateInsights: GenerateRecapInsightsCallback = async () => {
            called = true;
            return [{
                title: "A decision is still unresolved",
                summary: "Alpha records a release decision that still lacks a final owner.",
                whyItMatters: "Until an owner decides, the next release step could contradict this note.",
                sourceNoteTitles: ["Alpha"],
                section: "open_question",
            }];
        };

        const result = await prepareScopeRecapWithLlm([testNotes()[0]], generateInsights, {
            now: new Date("2026-07-01T10:00:00.000Z"),
        });

        expect(called).toBe(true);
        expect(result.status).toBe("ready");
        if (result.status !== "ready") throw new Error("expected ready single-note Recap");
        expect(result.artifact.staleStatus).toBe("fresh");
        expect(evaluateScopeRecapProactiveQuality(result.artifact).eligible).toBe(false);
    });

    it.each([
        ["null", async (): Promise<unknown> => null, "provider_unavailable"],
        ["throw", async (): Promise<unknown> => { throw new Error("offline"); }, "provider_error"],
        ["empty", async (): Promise<unknown> => [], "empty"],
        ["non-array", async (): Promise<unknown> => ({ insight: true }), "malformed"],
        ["malformed item", async (): Promise<unknown> => [{ title: "Missing fields" }], "malformed"],
    ] as const)("keeps %s generation outside the artifact path", async (_name, callback, outcome) => {
        const result = await prepareScopeRecapWithLlm(testNotes(), callback, {
            now: new Date("2026-07-01T10:00:00.000Z"),
        });

        expect(result.status).toBe("no_reliable_insight");
        expect(result.artifact).toBeNull();
        expect(result.attempt.outcome).toBe(outcome);
        expect(result.localOverview.kind).toBe("local_scope_overview");
    });

    it.each([
        ["English placeholder", "Alpha commits to shipping while Beta pauses the same work.", "IMPORTANT!"],
        ["Chinese placeholder", "Alpha commits to shipping while Beta pauses the same work.", "很重要。"],
        [
            "generic attention placeholder with impact keywords",
            "Alpha commits to shipping while Beta pauses the same work.",
            "This needs more attention before acting.",
        ],
        [
            "generic importance placeholder with a relationship keyword",
            "Alpha commits to shipping while Beta pauses the same work.",
            "This makes it important.",
        ],
        [
            "repeated summary",
            "Alpha commits to shipping while Beta pauses the same work.",
            " alpha commits to shipping while beta pauses the same work! ",
        ],
        [
            "summary-prefixed repeated summary",
            "Alpha commits to shipping while Beta pauses the same work.",
            "Summary: Alpha commits to shipping while Beta pauses the same work.",
        ],
        [
            "why-it-matters-prefixed repeated summary",
            "Alpha commits to shipping while Beta pauses the same work.",
            "Why it matters: Alpha commits to shipping while Beta pauses the same work.",
        ],
        [
            "reason without a concrete relationship or impact",
            "Alpha commits to shipping while Beta pauses the same work.",
            "A concise observation drawn from the available notes.",
        ],
    ])("rejects %s as whyItMatters", async (_name, summary, whyItMatters) => {
        const result = await prepareScopeRecapWithLlm(testNotes(), async () => [{
            title: "Ship decision remains unresolved",
            summary,
            whyItMatters,
            sourceNoteTitles: ["Alpha", "Beta"],
            section: "tension",
        }], {
            now: new Date("2026-07-01T10:00:00.000Z"),
        });

        expect(result.status).toBe("no_reliable_insight");
        expect(result.artifact).toBeNull();
        expect(result.attempt.outcome).toBe("quality_rejected");
    });

    it("returns a ready artifact only for a concrete cross-note insight", async () => {
        const result = await prepareScopeRecapWithLlm(testNotes(), async () => [{
            title: "Ship decision remains unresolved",
            summary: "Alpha commits to shipping while Beta pauses the same work, so the release decision needs review now.",
            whyItMatters: "Shipping now could contradict the documented pause decision.",
            sourceNoteTitles: ["Alpha", "Beta"],
            section: "tension",
        }], {
            now: new Date("2026-07-01T10:00:00.000Z"),
            scope: {
                kind: "folder",
                label: "Projects/PA",
                paths: testNotes().map((note) => note.path),
                tags: ["pa", "review"],
            },
            dataBoundarySnapshotId: "boundary-current",
        });

        expect(result.status).toBe("ready");
        if (result.status !== "ready") throw new Error("expected ready recap");
        const strongest = selectStrongestConcreteScopeRecapInsight(result.artifact);
        expect(strongest?.summary).toContain("release decision");
        expect(strongest?.sourceRefs.map((ref) => ref.path)).toEqual([
            "Projects/PA/Alpha.md",
            "Projects/PA/Beta.md",
        ]);
        expect(result.attempt).toMatchObject({ outcome: "success", providerCallMade: true });
        expect(result.attempt.scope).toEqual({ kind: "folder" });
        expect(result.attempt.scope).not.toHaveProperty("paths");
        expect(result.attempt.scope).not.toHaveProperty("tags");
        expect(result.attempt.scope).not.toHaveProperty("label");
        expect(JSON.stringify(result.attempt)).not.toMatch(/Projects\/PA|Alpha|Beta/);
    });

    it("accepts a concrete Chinese impact reason", async () => {
        const result = await prepareScopeRecapWithLlm(testNotes(), async () => [{
            title: "发布决定仍有冲突",
            summary: "Alpha 要求发布，而 Beta 记录了暂停决定。",
            whyItMatters: "如果现在发布，可能会违背 Beta 记录的暂停决定。",
            sourceNoteTitles: ["Alpha", "Beta"],
            section: "tension",
        }], {
            now: new Date("2026-07-01T10:00:00.000Z"),
        });

        expect(result.status).toBe("ready");
        if (result.status !== "ready") throw new Error("expected ready recap");
        expect(selectStrongestConcreteScopeRecapInsight(result.artifact)?.whyItMatters).toContain("违背");
    });

    it("can prepare a fresh artifact when the current boundary normally excludes other notes", async () => {
        const result = await prepareScopeRecapWithLlm([
            ...testNotes(),
            { path: "Private/Secret.md", title: "Secret", content: "Not in the approved boundary." },
        ], async () => [{
            title: "Ship decision remains unresolved",
            summary: "Alpha commits to shipping while Beta pauses the same work, so the release decision needs review now.",
            whyItMatters: "The conflict must be resolved before the release proceeds.",
            sourceNoteTitles: ["Alpha", "Beta"],
            section: "tension",
        }], {
            now: new Date("2026-07-01T10:00:00.000Z"),
            isPathAllowed: (path) => !path.startsWith("Private/"),
        });

        expect(result.status).toBe("ready");
        if (result.status !== "ready") throw new Error("expected ready recap");
        expect(result.artifact.staleStatus).toBe("fresh");
        expect(result.artifact.skippedSources).toContainEqual(expect.objectContaining({
            reason: "data_boundary",
            count: 1,
        }));
    });

    it("keeps insight fingerprints stable across timestamps, ids, and source ordering", async () => {
        const build = (now: string, sourceTitles: string[]) => prepareScopeRecapWithLlm(testNotes(), async () => [{
            title: "  Ship decision remains unresolved  ",
            summary: "Alpha and Beta disagree on the release decision.",
            whyItMatters: "The release owner needs one current decision before acting.",
            sourceNoteTitles: sourceTitles,
            section: "tension",
        }], {
            now: new Date(now),
            scope: { kind: "folder", label: "Projects/PA", paths: testNotes().map((note) => note.path) },
        });
        const first = await build("2026-07-01T10:00:00.000Z", ["Alpha", "Beta"]);
        const second = await build("2026-07-02T10:00:00.000Z", ["Beta", "Alpha"]);
        if (first.status !== "ready" || second.status !== "ready") throw new Error("expected ready recaps");
        const firstInsight = selectStrongestConcreteScopeRecapInsight(first.artifact)!;
        const secondInsight = selectStrongestConcreteScopeRecapInsight(second.artifact)!;

        expect(buildScopeRecapInsightFingerprint(first.artifact.scope, firstInsight)).toBe(
            buildScopeRecapInsightFingerprint(second.artifact.scope, secondInsight),
        );
        expect(evaluateScopeRecapProactiveQuality(first.artifact)).toMatchObject({
            eligible: true,
            fingerprint: buildScopeRecapInsightFingerprint(first.artifact.scope, firstInsight),
        });
    });
});
