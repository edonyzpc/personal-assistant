import { describe, expect, it, jest } from "@jest/globals";
import { TFile } from "obsidian";

jest.mock("obsidian", () => ({
    TFile: class MockTFile {
        path: string;
        extension = "md";
        stat: { ctime: number; mtime: number; size: number };

        constructor(path: string) {
            this.path = path;
            this.stat = { ctime: 1, mtime: 1, size: 1 };
        }
    },
    Notice: class {},
    Modal: class {},
    Component: class {},
    ItemView: class {},
    MarkdownRenderer: {},
    Platform: {},
    setIcon: jest.fn(),
    normalizePath: (path: string) => path,
}));

import {
    PageletActionPluginIntegration,
    type PageletActionPluginIntegrationDependencies,
} from "../src/pagelet/plugin-pagelet-actions";
import type {
    MaintenanceMoveActionLogEntry,
    MaintenanceProposal,
    ReviewQueueItem,
} from "../src/pa";

const proposal: MaintenanceProposal = {
    id: "maint-1",
    category: "inbox_cleanup",
    actionType: "move",
    title: "Review inbox note destination",
    claim: "Inbox note should move",
    confidence: "medium",
    scope: { kind: "current_note", paths: ["Inbox/Untitled.md"] },
    sourceRefs: [{ path: "Inbox/Untitled.md", evidenceStrength: "medium" }],
    preview: {
        summary: "Preview move.",
        sourcePath: "Inbox/Untitled.md",
        affectedPaths: ["Inbox/Untitled.md", "Notes/Untitled.md"],
        oldPath: "Inbox/Untitled.md",
        newPath: "Notes/Untitled.md",
    },
    undoMetadata: {
        strategy: "move_back",
        affectedPaths: ["Inbox/Untitled.md", "Notes/Untitled.md"],
        oldPath: "Inbox/Untitled.md",
        newPath: "Notes/Untitled.md",
        reversible: true,
    },
    actionPlan: {
        actionType: "move",
        previewOnly: true,
        applyBoundary: "blocked_until_user_approval",
    },
    whyShown: ["Inbox note"],
    dataBoundarySnapshotId: "boundary",
    generatedAt: "2026-06-28T12:00:00.000Z",
};

const action: MaintenanceMoveActionLogEntry = {
    id: "action-1",
    proposalId: proposal.id,
    reviewQueueItemId: "queue-1",
    actionType: "move",
    status: "applied",
    oldPath: "Inbox/Untitled.md",
    newPath: "Notes/Untitled.md",
    appliedAt: "2026-06-28T12:00:00.000Z",
    sourceRefs: proposal.sourceRefs,
    dataBoundarySnapshotId: "boundary",
    undoStrategy: "move_back",
};

const createDependencies = (options: {
    actionLog?: MaintenanceMoveActionLogEntry[];
    appendMaintenanceActionLog?: (action: MaintenanceMoveActionLogEntry) => Promise<void>;
    replaceMaintenanceActionLog?: (action: MaintenanceMoveActionLogEntry) => Promise<void>;
} = {}) => {
    const paths = new Set(options.actionLog ? ["Notes", "Notes/Untitled.md"] : ["Inbox", "Inbox/Untitled.md"]);
    const renames: Array<[string, string]> = [];
    const FileCtor = TFile as unknown as { new(path: string): TFile };
    const fakeFile = (path: string) => {
        const file = new FileCtor(path);
        Object.defineProperty(file, "extension", { value: "txt" });
        return file;
    };
    const dependencies: PageletActionPluginIntegrationDependencies = {
        getLocale: () => "en",
        getSettings: () => ({
            dataBoundary: {
                excludedFolders: [],
                excludedTags: [],
                generatedNotePolicy: "exclude-generated",
                providerDisclosureReasons: [],
                cleanupGroups: [],
            },
            quickCaptureInboxPath: "Inbox/Inbox.md",
            maintenanceActionLog: options.actionLog ?? [],
        }),
        collectMaintenanceReviewFiles: jest.fn(() => []),
        readCached: jest.fn(async () => ""),
        getDataBoundaryTags: jest.fn(() => []),
        isGeneratedDataBoundaryFile: jest.fn(() => false),
        createReviewQueueItem: jest.fn(async (): Promise<{ ok: true; value: ReviewQueueItem }> => ({
            ok: true,
            value: {} as ReviewQueueItem,
        })),
        confirm: jest.fn(async () => true),
        findMaintenanceQueueItem: () => null,
        exists: jest.fn(async (path: string) => path.includes("/") ? paths.has(path) : true),
        rename: async (from: string, to: string) => {
            renames.push([from, to]);
            paths.delete(from);
            paths.add(to);
        },
        getFile: (path: string) => paths.has(path) ? fakeFile(path) as never : null,
        isMaintenanceMovePathAllowed: () => true,
        now: () => new Date("2026-06-28T12:00:00.000Z"),
        idFactory: () => "action-1",
        appendMaintenanceActionLog: options.appendMaintenanceActionLog
            ?? jest.fn(async (_action: MaintenanceMoveActionLogEntry): Promise<void> => undefined),
        replaceMaintenanceActionLog: options.replaceMaintenanceActionLog
            ?? jest.fn(async (_action: MaintenanceMoveActionLogEntry): Promise<void> => undefined),
        updateMaintenanceQueueStatus: jest.fn(async () => undefined),
        mintNonCollidingPageletPath: jest.fn(async (path: string) => path),
        captureReviewNoteWriter: jest.fn((): ReviewNoteWriter => async () => ({
            status: "ok",
            observation: { createdPath: "Notes/generated.md" },
        })),
        log: jest.fn(),
    };
    return { dependencies, renames };
};
type ReviewNoteWriter = ReturnType<PageletActionPluginIntegrationDependencies["captureReviewNoteWriter"]>;
type ReviewNoteOptions = Parameters<NonNullable<ReviewNoteWriter>>[0];

describe("PageletActionPluginIntegration", () => {
    it("rolls back an applied maintenance move when action-log persistence fails", async () => {
        const appendMaintenanceActionLog = jest.fn(async () => {
            throw new Error("disk unavailable");
        });
        const { dependencies, renames } = createDependencies({ appendMaintenanceActionLog });
        const owner = new PageletActionPluginIntegration(dependencies);

        const result = await owner.applyMaintenanceProposal(proposal);

        expect(result).toMatchObject({ ok: false, reason: "action_log_persist_failed" });
        expect(renames).toEqual([
            ["Inbox/Untitled.md", "Notes/Untitled.md"],
            ["Notes/Untitled.md", "Inbox/Untitled.md"],
        ]);
    });

    it("rolls back an undone maintenance move when action-log replacement fails", async () => {
        const replaceMaintenanceActionLog = jest.fn(async () => {
            throw new Error("disk unavailable");
        });
        const { dependencies, renames } = createDependencies({
            actionLog: [action],
            replaceMaintenanceActionLog,
        });
        const owner = new PageletActionPluginIntegration(dependencies);

        const result = await owner.undoMaintenanceMove(action.id);

        expect(result).toMatchObject({ ok: false, reason: "action_log_persist_failed" });
        expect(renames).toEqual([
            ["Notes/Untitled.md", "Inbox/Untitled.md"],
            ["Inbox/Untitled.md", "Notes/Untitled.md"],
        ]);
    });

    it("delegates review-note writing with a minted non-colliding target", async () => {
        const { dependencies } = createDependencies();
        const writer = jest.fn(async (_options: ReviewNoteOptions) => ({
            status: "ok" as const,
            observation: { createdPath: "Notes/generated.md" },
        }));
        dependencies.captureReviewNoteWriter = jest.fn(() => writer);
        const owner = new PageletActionPluginIntegration(dependencies);
        const result = await owner.writeReviewNote({
            targetPath: "Notes/generated.md",
        } as never);

        expect(result).toEqual({
            success: true,
            filePath: "Notes/generated.md",
        });
        expect(dependencies.mintNonCollidingPageletPath).toHaveBeenCalledWith("Notes/generated.md");
        expect(writer).toHaveBeenCalledWith(expect.objectContaining({
            generatedNote: expect.objectContaining({
                targetFolder: "Notes",
                fileName: "generated.md",
            }),
            targetPath: "Notes/generated.md",
        }));
    });

    it("captures the review writer before target minting and returns early when unavailable", async () => {
        const available = createDependencies();
        const writer = jest.fn(async (_options: ReviewNoteOptions) => ({
            status: "ok" as const,
            observation: { createdPath: "Notes/generated.md" },
        }));
        const capture = jest.fn(() => writer);
        available.dependencies.captureReviewNoteWriter = capture;
        jest.mocked(available.dependencies.mintNonCollidingPageletPath).mockImplementation(async () => {
            expect(capture).toHaveBeenCalledTimes(1);
            return "Notes/generated.md";
        });
        await new PageletActionPluginIntegration(available.dependencies).writeReviewNote({
            targetPath: "Notes/generated.md",
        } as never);
        expect(capture).toHaveBeenCalledTimes(1);
        expect(writer).toHaveBeenCalledTimes(1);

        const unavailable = createDependencies();
        unavailable.dependencies.captureReviewNoteWriter = () => null;
        const result = await new PageletActionPluginIntegration(unavailable.dependencies)
            .writeReviewNote({ targetPath: "Notes/generated.md" } as never);

        expect(result).toEqual({ success: false, error: "Pagelet write runtime is unavailable." });
        expect(unavailable.dependencies.mintNonCollidingPageletPath).not.toHaveBeenCalled();
    });
});
