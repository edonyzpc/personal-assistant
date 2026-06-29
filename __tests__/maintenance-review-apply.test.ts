import {
    applyMaintenanceMoveProposal,
    hasForbiddenPersistedTextFields,
    scanMaintenanceReview,
    undoMaintenanceMoveAction,
    type MaintenanceMoveApplyHost,
    type MaintenanceProposal,
} from "../src/pa";

const fixedNow = new Date("2026-06-28T12:00:00.000Z");

type MaintenanceProposalOverrides = Partial<Omit<MaintenanceProposal, "preview" | "actionPlan">> & {
    preview?: Partial<MaintenanceProposal["preview"]>;
    actionPlan?: Partial<MaintenanceProposal["actionPlan"]>;
};

function moveProposal(overrides: MaintenanceProposalOverrides = {}): MaintenanceProposal {
    const result = scanMaintenanceReview([
        {
            path: "Inbox/Quick Capture.md",
            basename: "Quick Capture",
            content: "Loose capture about product launch sequencing.",
        },
    ], { now: fixedNow });
    const proposal = result.proposals.find((candidate) => candidate.actionType === "move");
    if (!proposal) throw new Error("Expected move proposal");
    return {
        ...proposal,
        ...overrides,
        preview: {
            ...proposal.preview,
            ...overrides.preview,
        },
        actionPlan: {
            ...proposal.actionPlan,
            ...overrides.actionPlan,
        },
    };
}

function fakeHost(paths: string[], options: { allowed?: (path: string) => boolean } = {}): MaintenanceMoveApplyHost & {
    paths: Set<string>;
} {
    const existing = new Set(paths);
    return {
        paths: existing,
        exists: async (path) => existing.has(path),
        rename: async (oldPath, newPath) => {
            if (!existing.has(oldPath)) throw new Error("source_missing");
            existing.delete(oldPath);
            existing.add(newPath);
        },
        isPathAllowed: options.allowed ?? (() => true),
        now: () => fixedNow,
        idFactory: () => "maint-action-1",
    };
}

describe("Maintenance Review move apply", () => {
    it("applies one move proposal and records reversible audit metadata", async () => {
        const proposal = moveProposal();
        const host = fakeHost(["Inbox", "Notes", "Inbox/Quick Capture.md"]);

        const result = await applyMaintenanceMoveProposal(proposal, host, {
            reviewQueueItemId: "rq-1",
        });

        expect(result).toMatchObject({
            ok: true,
            action: {
                id: "maint-action-1",
                proposalId: proposal.id,
                reviewQueueItemId: "rq-1",
                actionType: "move",
                status: "applied",
                oldPath: "Inbox/Quick Capture.md",
                newPath: "Notes/Quick Capture.md",
                appliedAt: "2026-06-28T12:00:00.000Z",
                dataBoundarySnapshotId: proposal.dataBoundarySnapshotId,
                undoStrategy: "move_back",
            },
        });
        expect(host.paths.has("Inbox/Quick Capture.md")).toBe(false);
        expect(host.paths.has("Notes/Quick Capture.md")).toBe(true);
        if (!result.ok) throw new Error("Expected success");
        expect(result.action.sourceRefs[0]?.path).toBe("Inbox/Quick Capture.md");
        expect(hasForbiddenPersistedTextFields(result.action)).toBe(false);
    });

    it("rejects non-move actions and generated targets without writing", async () => {
        const host = fakeHost(["Inbox", "Notes", "Inbox/Quick Capture.md"]);

        const nonMove = await applyMaintenanceMoveProposal(moveProposal({
            actionType: "rename",
            actionPlan: {
                actionType: "rename",
                previewOnly: true,
                applyBoundary: "blocked_until_user_approval",
            },
        }), host);
        expect(nonMove).toMatchObject({ ok: false, reason: "unsupported_action" });

        const generatedTarget = await applyMaintenanceMoveProposal(moveProposal({
            preview: {
                newPath: ".pagelet/Quick Capture.md",
                affectedPaths: ["Inbox/Quick Capture.md", ".pagelet/Quick Capture.md"],
            },
        }), host);
        expect(generatedTarget).toMatchObject({ ok: false, reason: "target_forbidden_dotfolder" });

        const unsourced = await applyMaintenanceMoveProposal(moveProposal({
            sourceRefs: [],
        }), host);
        expect(unsourced).toMatchObject({ ok: false, reason: "missing_source_ref" });
        expect(host.paths.has("Inbox/Quick Capture.md")).toBe(true);
    });

    it("re-reads stale source and target state before moving", async () => {
        const proposal = moveProposal();

        await expect(applyMaintenanceMoveProposal(proposal, fakeHost(["Inbox", "Notes"])))
            .resolves.toMatchObject({ ok: false, reason: "source_missing" });

        await expect(applyMaintenanceMoveProposal(proposal, fakeHost([
            "Inbox",
            "Notes",
            "Inbox/Quick Capture.md",
            "Notes/Quick Capture.md",
        ]))).resolves.toMatchObject({ ok: false, reason: "target_name_collision" });

        await expect(applyMaintenanceMoveProposal(proposal, fakeHost([
            "Inbox",
            "Inbox/Quick Capture.md",
        ]))).resolves.toMatchObject({ ok: false, reason: "target_folder_missing" });
    });

    it("respects the current Data Boundary for source and target paths", async () => {
        const proposal = moveProposal();
        const host = fakeHost(["Inbox", "Notes", "Inbox/Quick Capture.md"], {
            allowed: (path) => path !== "Inbox/Quick Capture.md",
        });

        await expect(applyMaintenanceMoveProposal(proposal, host))
            .resolves.toMatchObject({ ok: false, reason: "source_denied" });
        expect(host.paths.has("Inbox/Quick Capture.md")).toBe(true);
        expect(host.paths.has("Notes/Quick Capture.md")).toBe(false);
    });

    it("rejects inbox move targets outside the declared maintenance destination", async () => {
        const proposal = moveProposal({
            preview: {
                newPath: "Projects/Quick Capture.md",
                affectedPaths: ["Inbox/Quick Capture.md", "Projects/Quick Capture.md"],
            },
            undoMetadata: {
                strategy: "move_back",
                newPath: "Projects/Quick Capture.md",
                oldPath: "Inbox/Quick Capture.md",
                affectedPaths: ["Inbox/Quick Capture.md", "Projects/Quick Capture.md"],
                reversible: true,
            },
        });
        const host = fakeHost(["Inbox", "Notes", "Projects", "Inbox/Quick Capture.md"]);

        const result = await applyMaintenanceMoveProposal(proposal, host);

        expect(result).toMatchObject({ ok: false, reason: "target_outside_allowlist" });
        expect(host.paths.has("Inbox/Quick Capture.md")).toBe(true);
        expect(host.paths.has("Projects/Quick Capture.md")).toBe(false);
    });

    it("converts apply and undo adapter rename failures into structured results", async () => {
        const proposal = moveProposal();
        const applyHost = fakeHost(["Inbox", "Notes", "Inbox/Quick Capture.md"]);
        applyHost.rename = async () => {
            throw new Error("adapter failed");
        };

        await expect(applyMaintenanceMoveProposal(proposal, applyHost))
            .resolves.toMatchObject({ ok: false, reason: "rename_failed" });
        expect(applyHost.paths.has("Inbox/Quick Capture.md")).toBe(true);

        const undoHost = fakeHost(["Inbox", "Notes", "Notes/Quick Capture.md"]);
        const entry = {
            id: "maint-action-1",
            proposalId: proposal.id,
            actionType: "move" as const,
            status: "applied" as const,
            oldPath: "Inbox/Quick Capture.md",
            newPath: "Notes/Quick Capture.md",
            appliedAt: "2026-06-28T12:00:00.000Z",
            sourceRefs: proposal.sourceRefs,
            dataBoundarySnapshotId: proposal.dataBoundarySnapshotId,
            undoStrategy: "move_back" as const,
        };
        undoHost.rename = async () => {
            throw new Error("adapter failed");
        };

        await expect(undoMaintenanceMoveAction(entry, undoHost))
            .resolves.toMatchObject({ ok: false, reason: "rename_failed" });
        expect(undoHost.paths.has("Notes/Quick Capture.md")).toBe(true);
        expect(undoHost.paths.has("Inbox/Quick Capture.md")).toBe(false);
    });

    it("undoes an applied move and refuses to overwrite the original path", async () => {
        const proposal = moveProposal();
        const host = fakeHost(["Inbox", "Notes", "Inbox/Quick Capture.md"]);
        const applied = await applyMaintenanceMoveProposal(proposal, host);
        if (!applied.ok) throw new Error(`Expected success: ${applied.message}`);

        const undone = await undoMaintenanceMoveAction(applied.action, host);
        expect(undone).toMatchObject({
            ok: true,
            action: {
                id: "maint-action-1",
                status: "undone",
                oldPath: "Inbox/Quick Capture.md",
                newPath: "Notes/Quick Capture.md",
                undoneAt: "2026-06-28T12:00:00.000Z",
            },
        });
        expect(host.paths.has("Inbox/Quick Capture.md")).toBe(true);
        expect(host.paths.has("Notes/Quick Capture.md")).toBe(false);

        const blockedHost = fakeHost(["Inbox", "Notes", "Inbox/Quick Capture.md", "Notes/Quick Capture.md"]);
        await expect(undoMaintenanceMoveAction(applied.action, blockedHost))
            .resolves.toMatchObject({ ok: false, reason: "target_name_collision" });
    });
});
