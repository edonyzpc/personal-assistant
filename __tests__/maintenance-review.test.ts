import {
    ReviewQueueStore,
    hasForbiddenPersistedTextFields,
    maintenanceProposalToReviewQueueInput,
    scanMaintenanceReview,
    validateMaintenanceProposal,
    type MaintenanceProposal,
} from "../src/pa";

const fixedNow = new Date("2026-06-28T12:00:00.000Z");

function proposalFixture(): MaintenanceProposal {
    const result = scanMaintenanceReview([
        {
            path: "Inbox/Untitled.md",
            basename: "Untitled",
            content: "# Product launch plan\n\nCollect launch sequencing notes.",
        },
        {
            path: "Projects/Product Research.md",
            basename: "Product Research",
            content: "Product launch sequencing notes for the same workstream.",
        },
    ], { now: fixedNow });
    const proposal = result.proposals[0];
    if (!proposal) throw new Error("Expected fixture proposal");
    return proposal;
}

describe("Maintenance Review preview scanner", () => {
    it("creates manual preview proposals and keeps weekly scan disabled", () => {
        const result = scanMaintenanceReview([
            {
                path: "Inbox/Untitled.md",
                basename: "Untitled",
                content: "# Product launch plan\n\nCollect launch sequencing notes.",
            },
            {
                path: "Archive/outside.md",
                basename: "outside",
                content: "Product launch sequencing notes outside the selected scope.",
            },
        ], {
            now: fixedNow,
            scopePaths: ["Inbox/Untitled.md"],
            weeklyScanEnabled: true,
        });

        expect(result.generatedAt).toBe("2026-06-28T12:00:00.000Z");
        expect(result.previewOnly).toBe(true);
        expect(result.weeklyScanEnabled).toBe(false);
        expect(result.proposals.every((proposal) => proposal.preview.sourcePath === "Inbox/Untitled.md")).toBe(true);
        expect(result.proposals.some((proposal) => proposal.category === "inbox_cleanup")).toBe(true);
        expect(result.proposals.some((proposal) => proposal.category === "better_titles")).toBe(true);
        expect(result.proposals.some((proposal) => proposal.preview.affectedPaths.includes("Archive/outside.md"))).toBe(false);
    });

    it("detects inbox notes with source reasons and affected paths", () => {
        const result = scanMaintenanceReview([
            {
                path: "Inbox/Quick Capture.md",
                basename: "Quick Capture",
                content: "Loose capture about product launch sequencing.",
            },
        ], { now: fixedNow });
        const inboxProposal = result.proposals.find((proposal) => proposal.category === "inbox_cleanup");

        expect(inboxProposal).toMatchObject({
            actionType: "move",
            confidence: "medium",
            dataBoundarySnapshotId: "maintenance_scan_local_allow",
        });
        expect(inboxProposal?.sourceRefs[0]?.path).toBe("Inbox/Quick Capture.md");
        expect(inboxProposal?.whyShown[0]).toContain("inbox");
        expect(inboxProposal?.preview.affectedPaths).toEqual([
            "Inbox/Quick Capture.md",
            "Notes/Quick Capture.md",
        ]);
    });

    it("builds rename previews with old/new title and undo metadata", () => {
        const result = scanMaintenanceReview([
            {
                path: "Inbox/Untitled.md",
                basename: "Untitled",
                content: "# Product launch plan\n\nCollect launch sequencing notes.",
            },
        ], { now: fixedNow });
        const renameProposal = result.proposals.find((proposal) => proposal.actionType === "rename");

        expect(renameProposal?.preview.oldTitle).toBe("Untitled");
        expect(renameProposal?.preview.newTitle).toBe("Product launch plan");
        expect(renameProposal?.preview.oldPath).toBe("Inbox/Untitled.md");
        expect(renameProposal?.preview.newPath).toBe("Inbox/Product launch plan.md");
        expect(renameProposal?.undoMetadata).toMatchObject({
            strategy: "rename_back",
            oldPath: "Inbox/Untitled.md",
            newPath: "Inbox/Product launch plan.md",
            reversible: true,
        });
    });

    it("detects weak links without modifying source note content", () => {
        const source = {
            path: "Projects/Launch Plan.md",
            basename: "Launch Plan",
            content: "Product launch sequencing depends on messaging readiness.",
        };
        const target = {
            path: "Projects/Messaging Readiness.md",
            basename: "Messaging Readiness",
            content: "Messaging readiness affects product launch sequencing.",
        };
        const result = scanMaintenanceReview([source, target], { now: fixedNow, maxProposalsPerCategory: 1 });
        const linkProposal = result.proposals.find((proposal) => proposal.actionType === "add_link");

        expect(linkProposal?.preview.sourcePath).toBe("Projects/Launch Plan.md");
        expect(linkProposal?.preview.targetPath).toBe("Projects/Messaging Readiness.md");
        expect(linkProposal?.preview.linkText).toBe("[[Messaging Readiness]]");
        expect(linkProposal?.preview.affectedPaths).toEqual(["Projects/Launch Plan.md"]);
        expect(linkProposal?.actionPlan.previewOnly).toBe(true);
        expect(source.content).toBe("Product launch sequencing depends on messaging readiness.");
    });

    it("rejects hard delete and overwrite-merge proposals", () => {
        const base = proposalFixture();
        expect(validateMaintenanceProposal({
            ...base,
            actionType: "delete_candidate",
            actionPlan: {
                ...base.actionPlan,
                actionType: "delete_candidate",
                permanentDelete: true,
            },
        })).toEqual({ ok: false, reason: "permanent_delete_forbidden" });

        expect(validateMaintenanceProposal({
            ...base,
            actionType: "merge",
            actionPlan: {
                ...base.actionPlan,
                actionType: "merge",
                mergeStrategy: "overwrite_existing",
            },
        })).toEqual({ ok: false, reason: "merge_must_create_new_note" });

        expect(validateMaintenanceProposal({
            ...base,
            actionType: "merge",
            actionPlan: {
                ...base.actionPlan,
                actionType: "merge",
                mergeStrategy: "create_new_note",
            },
        })).toEqual({ ok: true });
    });

    it("converts preview proposals into active Review Queue items without raw text fields", async () => {
        const proposal = proposalFixture();
        const input = maintenanceProposalToReviewQueueInput(proposal, {
            admissionReason: "maintenance_action_ready",
        });
        const store = new ReviewQueueStore({
            now: () => fixedNow,
            idFactory: () => "rq-maintenance-1",
        });

        expect(input.type).toBe("maintenance_proposal");
        expect(input.originSurface).toBe("maintenance");
        expect(input.metadata).toMatchObject({
            maintenanceActionType: proposal.actionType,
            previewOnly: true,
            applyBoundary: "blocked_until_user_approval",
        });
        expect(hasForbiddenPersistedTextFields(input)).toBe(false);

        const result = await store.create(input);
        expect(result).toMatchObject({
            ok: true,
            value: {
                id: "rq-maintenance-1",
                type: "maintenance_proposal",
                status: "suggested",
            },
        });
    });
});
