import { describe, expect, it } from "@jest/globals";

import {
    buildQuietRecallCandidates,
    buildWeeklyReview,
    buildWeeklyReviewGeneratedNote,
    buildWeeklyReviewMarkdown,
    calculateWeeklyReviewRange,
    filterWeeklyReviewAcceptedItemIds,
    type ReviewQueueItem,
    type SavedInsight,
} from "../src/pa";

function makeQueueItem(overrides: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
    const now = "2026-06-29T12:00:00.000Z";
    const type = overrides.type ?? "memory_candidate";
    return {
        id: "rq-memory",
        type,
        title: "Remember Alpha cadence",
        claim: "Alpha planning happens every Friday.",
        scope: { kind: "current_note", paths: ["Projects/Alpha.md"] },
        sourceRefs: [{ path: "Projects/Alpha.md", evidenceStrength: "medium" }],
        originSurface: "pagelet",
        priority: "normal",
        status: "suggested",
        createdAt: now,
        updatedAt: now,
        whyShown: ["Candidate from review."],
        dataBoundarySnapshotId: "boundary",
        admissionReason: overrides.admissionReason
            ?? (type === "maintenance_proposal"
                ? "maintenance_action_ready"
                : type === "task_suggestion"
                    ? "task_confirmation_required"
                    : "memory_confirmation_required"),
        ...overrides,
    };
}

function makeInsight(overrides: Partial<SavedInsight> = {}): SavedInsight {
    const now = "2026-06-29T12:00:00.000Z";
    return {
        id: "ins-1",
        type: "theme",
        text: "Weekly reviews work best when they stay source-backed.",
        origin: "pa-generated",
        sourceRefs: [{ path: "Projects/Alpha.md", evidenceStrength: "medium" }],
        whyShown: ["Saved from Pagelet."],
        scope: { kind: "current_note", paths: ["Projects/Alpha.md"] },
        status: "active",
        influencePolicy: "weak-only",
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

describe("calculateWeeklyReviewRange", () => {
    it("uses a stable seven-day inclusive range", () => {
        expect(calculateWeeklyReviewRange(new Date("2026-06-29T12:00:00.000Z"))).toEqual({
            startDate: "2026-06-23",
            endDate: "2026-06-29",
            days: 7,
            label: "2026-06-23 to 2026-06-29",
        });
    });
});

describe("buildWeeklyReview", () => {
    it("keeps empty sections restrained while preserving section counts", () => {
        const review = buildWeeklyReview({
            now: new Date("2026-06-29T12:00:00.000Z"),
        });

        expect(review.sections).toHaveLength(5);
        expect(review.totalCount).toBe(0);
        expect(review.sections.every((section) => section.items.length === 0)).toBe(true);
    });

    it("populates only source-backed active sections", () => {
        const quietRecall = buildQuietRecallCandidates({
            now: new Date("2026-06-29T12:00:00.000Z"),
            currentNote: { path: "Projects/Alpha.md" },
            savedInsights: [makeInsight({ id: "ins-recall" })],
        });
        const review = buildWeeklyReview({
            now: new Date("2026-06-29T12:00:00.000Z"),
            notes: [
                {
                    path: "Projects/Alpha.md",
                    title: "Alpha",
                    modifiedAt: "2026-06-28T09:00:00.000Z",
                },
                {
                    path: "Projects/Old.md",
                    title: "Old",
                    modifiedAt: "2026-06-01T09:00:00.000Z",
                },
            ],
            savedInsights: [
                makeInsight(),
                makeInsight({ id: "ins-unsourced", sourceRefs: [], origin: "user-authored" }),
                makeInsight({ id: "ins-archived", status: "archived" }),
            ],
            reviewQueueItems: [
                makeQueueItem(),
                makeQueueItem({ id: "rq-dismissed", status: "dismissed" }),
                makeQueueItem({ id: "rq-unsourced", sourceRefs: [] }),
                makeQueueItem({
                    id: "rq-maintenance",
                    type: "maintenance_proposal",
                    title: "Move inbox note",
                    claim: "Inbox note can move to Notes.",
                    originSurface: "maintenance",
                }),
            ],
            quietRecall,
        });

        expect(review.totalCount).toBe(5);
        expect(review.sections.find((section) => section.type === "noteworthy_notes")?.items).toHaveLength(1);
        expect(review.sections.find((section) => section.type === "saved_insights")?.items).toHaveLength(1);
        expect(review.sections.find((section) => section.type === "memory_candidates")?.items).toHaveLength(1);
        expect(review.sections.find((section) => section.type === "maintenance_proposals")?.items).toHaveLength(1);
        expect(review.sections.find((section) => section.type === "quiet_recall_candidates")?.items).toHaveLength(1);
    });

    it("writes accepted-only Markdown with generatedAt and source refs", () => {
        const review = buildWeeklyReview({
            now: new Date("2026-06-29T12:00:00.000Z"),
            savedInsights: [makeInsight()],
            reviewQueueItems: [makeQueueItem()],
        });
        const acceptedId = review.sections.find((section) => section.type === "saved_insights")?.items[0]?.id ?? "";
        const dismissedId = review.sections.find((section) => section.type === "memory_candidates")?.items[0]?.id ?? "";

        const markdown = buildWeeklyReviewMarkdown(review, [acceptedId]);

        expect(markdown).toContain("pagelet: true");
        expect(markdown).toContain("pa_type: weekly_review");
        expect(markdown).toContain("generatedAt: 2026-06-29T12:00:00.000Z");
        expect(markdown).toContain("Weekly reviews work best");
        expect(markdown).toContain("[[Projects/Alpha]]");
        expect(markdown).not.toContain("Alpha planning happens every Friday");
        expect(markdown).not.toContain(dismissedId);
    });

    it("builds a generated note for the Pagelet write path", () => {
        const review = buildWeeklyReview({
            now: new Date("2026-06-29T12:00:00.000Z"),
            savedInsights: [makeInsight()],
        });
        const acceptedId = review.sections[1].items[0].id;

        const note = buildWeeklyReviewGeneratedNote(review, [acceptedId], ".pagelet");

        expect(note.fileName).toBe("pagelet-weekly-review-2026-06-29.md");
        expect(note.targetPath).toBe(".pagelet/pagelet-weekly-review-2026-06-29.md");
        expect(note.sources).toEqual(["[[Projects/Alpha]]"]);
        expect(JSON.stringify(note)).not.toContain("fullProviderOutput");
    });

    it("filters stale accepted ids before counting or writing weekly review notes", () => {
        const review = buildWeeklyReview({
            now: new Date("2026-06-29T12:00:00.000Z"),
            savedInsights: [makeInsight()],
        });
        const acceptedId = review.sections[1].items[0].id;

        expect(filterWeeklyReviewAcceptedItemIds(review, ["stale-id", acceptedId, acceptedId]))
            .toEqual([acceptedId]);
        const note = buildWeeklyReviewGeneratedNote(review, ["stale-id"], ".pagelet");

        expect(note.sources).toEqual([]);
        expect(note.markdown).toContain("acceptedItems: 0");
        expect(note.markdown).toContain("No accepted items.");
    });
});
