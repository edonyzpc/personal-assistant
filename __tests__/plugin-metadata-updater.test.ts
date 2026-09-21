import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { TFile } from "obsidian";

import {
    MetadataUpdater,
    type MetadataUpdaterDependencies,
    type MetadataUpdaterSettings,
} from "../src/plugin/metadata-updater";

type WorkspaceOn = MetadataUpdaterDependencies["workspace"]["on"];
type GetCache = MetadataUpdaterDependencies["metadataCache"]["getCache"];
type ProcessFrontMatter = MetadataUpdaterDependencies["fileManager"]["processFrontMatter"];

const TestTFile = TFile as unknown as new (
    path: string,
    stat?: { mtime?: number; ctime?: number; size?: number },
) => TFile;

interface Harness {
    owner: MetadataUpdater;
    settings: MetadataUpdaterSettings;
    workspaceOn: jest.Mock<WorkspaceOn>;
    registerEvent: jest.Mock<MetadataUpdaterDependencies["registerEvent"]>;
    getCache: jest.Mock<GetCache>;
    processFrontMatter: jest.Mock<ProcessFrontMatter>;
    log: jest.Mock;
    activeChanges: boolean[];
    disabledNotices: string[];
    fileOpenListeners: Array<(file: TFile | null) => void>;
    openFile(file: TFile | null): void;
}

function createSettings(): MetadataUpdaterSettings {
    return {
        enableMetadataUpdating: true,
        metadataExcludePath: [],
        metadatas: [
            { key: "modified", value: "YYYY-MM-DD", t: "moment" },
            { key: "label", value: "synthetic", t: "string" },
            { key: "fallback", value: "fallback-value", t: "unknown" },
        ],
    };
}

function createHarness(): Harness {
    const settings = createSettings();
    const fileOpenListeners: Array<(file: TFile | null) => void> = [];
    const eventRefs: unknown[] = [];
    const workspaceOn = jest.fn<WorkspaceOn>((event, listener) => {
        if (event === "file-open") fileOpenListeners.push(listener);
        return { event, id: eventRefs.length };
    });
    const getCache = jest.fn<GetCache>(() => ({ frontmatter: {} }));
    const processFrontMatter = jest.fn<ProcessFrontMatter>(async (_file, mutate) => {
        mutate({});
    });
    const log = jest.fn();
    const activeChanges: boolean[] = [];
    const disabledNotices: string[] = [];
    const registerEvent = jest.fn<MetadataUpdaterDependencies["registerEvent"]>();
    const owner = new MetadataUpdater({
        workspace: {
            on: workspaceOn,
        },
        metadataCache: { getCache },
        fileManager: { processFrontMatter },
        getSettings: () => settings,
        log,
        setActive: (active) => { activeChanges.push(active); },
        notifyDisabled: () => { disabledNotices.push("metadata disabled"); },
        registerEvent,
    });

    return {
        owner,
        settings,
        workspaceOn,
        registerEvent,
        getCache,
        processFrontMatter,
        log,
        activeChanges,
        disabledNotices,
        fileOpenListeners,
        openFile: (file) => {
            const listener = fileOpenListeners[fileOpenListeners.length - 1];
            if (!listener) throw new Error("Metadata file-open listener is not installed.");
            listener(file);
        },
    };
}

afterEach(() => {
    jest.useRealTimers();
});

describe("MetadataUpdater lifecycle", () => {
    it("keeps one listener across repeated toggles and ignores disabled-generation events", async () => {
        jest.useFakeTimers();
        const harness = createHarness();
        const frontmatter = {
            modified: "old",
            label: "old",
            fallback: "old",
        };
        harness.getCache.mockReturnValue({ frontmatter });
        harness.processFrontMatter.mockImplementation(async (
            _file: TFile,
            mutate: (frontmatter: Record<string, unknown>) => void,
        ) => {
            mutate(frontmatter);
        });
        const file = new TestTFile("Notes/Current.md", { mtime: Date.parse("2026-09-20T08:00:00.000Z") });

        harness.owner.toggle();
        harness.owner.toggle();
        harness.openFile(file);
        await jest.advanceTimersByTimeAsync(100);
        expect(harness.processFrontMatter).not.toHaveBeenCalled();

        harness.owner.toggle();
        harness.openFile(file);
        await jest.advanceTimersByTimeAsync(100);

        expect(harness.workspaceOn.mock.calls.filter(([event]) => event === "file-open")).toHaveLength(1);
        expect(harness.registerEvent).toHaveBeenCalledTimes(1);
        expect(harness.processFrontMatter).toHaveBeenCalledTimes(1);
        expect(frontmatter).toEqual({
            modified: "2026-05-18",
            label: "synthetic",
            fallback: "fallback-value",
        });
        expect(harness.activeChanges).toEqual([true, false, true]);
    });

    it("cancels work queued in the debounce window when metadata updating is stopped", async () => {
        jest.useFakeTimers();
        const harness = createHarness();
        const file = new TestTFile("Notes/Pending.md", { mtime: 1 });

        harness.owner.toggle();
        harness.openFile(file);
        harness.owner.toggle();
        await jest.advanceTimersByTimeAsync(1_000);
        harness.settings.enableMetadataUpdating = false;
        harness.openFile(file);
        harness.openFile(file);
        await jest.advanceTimersByTimeAsync(1_000);

        expect(harness.processFrontMatter).not.toHaveBeenCalled();
        expect(harness.activeChanges).toEqual([true, false]);
    });

    it("stops at the next file-open when live settings revoke permission", async () => {
        jest.useFakeTimers();
        const harness = createHarness();
        const file = new TestTFile("Notes/PermissionRevoked.md", { mtime: 1 });

        harness.owner.toggle();
        harness.settings.enableMetadataUpdating = false;
        harness.openFile(file);
        await jest.advanceTimersByTimeAsync(1_000);

        expect(harness.processFrontMatter).not.toHaveBeenCalled();
        expect(harness.activeChanges).toEqual([true, false]);
    });

    it("cancels pending work when live settings revoke permission before debounce execution", async () => {
        jest.useFakeTimers();
        const harness = createHarness();
        const file = new TestTFile("Notes/PendingPermission.md", { mtime: 1 });

        harness.owner.toggle();
        harness.openFile(file);
        harness.settings.enableMetadataUpdating = false;
        await jest.advanceTimersByTimeAsync(1_000);

        expect(harness.processFrontMatter).not.toHaveBeenCalled();
        expect(harness.activeChanges).toEqual([true, false]);
    });

    it("stops armed work and keeps disabled Notice when command sees revoked permission", async () => {
        jest.useFakeTimers();
        const harness = createHarness();
        const file = new TestTFile("Notes/CommandPermission.md", { mtime: 1 });

        harness.owner.toggle();
        harness.openFile(file);
        harness.settings.enableMetadataUpdating = false;
        harness.owner.toggle();
        await jest.advanceTimersByTimeAsync(1_000);

        expect(harness.processFrontMatter).not.toHaveBeenCalled();
        expect(harness.disabledNotices).toEqual(["metadata disabled"]);
        expect(harness.activeChanges).toEqual([true, false]);
    });

    it("cancels queued work when the owner is disposed", async () => {
        jest.useFakeTimers();
        const harness = createHarness();
        const file = new TestTFile("Notes/Unload.md", { mtime: 1 });

        harness.owner.toggle();
        const registeredEventRef = harness.registerEvent.mock.calls[0]?.[0];
        harness.openFile(file);
        harness.owner.dispose();
        await jest.advanceTimersByTimeAsync(1_000);
        harness.settings.enableMetadataUpdating = false;
        harness.openFile(file);
        harness.openFile(file);
        await jest.advanceTimersByTimeAsync(1_000);

        expect(harness.processFrontMatter).not.toHaveBeenCalled();
        expect(harness.registerEvent).toHaveBeenCalledWith(registeredEventRef);
        expect(harness.workspaceOn.mock.calls.filter(([event]) => event === "file-open")).toHaveLength(1);
        expect(harness.activeChanges).toEqual([true, false]);
    });

    it("lets a submitted write finish without letting its late callback cancel a new generation", async () => {
        jest.useFakeTimers();
        const harness = createHarness();
        const firstFrontmatter = { label: "old" };
        const secondFrontmatter = { label: "old" };
        let releaseFirstWrite!: () => void;
        harness.getCache.mockImplementation((path: string) => ({
            frontmatter: path === "Notes/First.md" ? firstFrontmatter : secondFrontmatter,
        }));
        harness.processFrontMatter.mockImplementation((
            file: TFile,
            mutate: (frontmatter: Record<string, unknown>) => void,
        ) => {
            if (file.path !== "Notes/First.md") {
                return Promise.resolve(mutate(secondFrontmatter));
            }
            return new Promise<void>((resolve) => {
                releaseFirstWrite = () => {
                    mutate(firstFrontmatter);
                    resolve();
                };
            });
        });

        harness.owner.toggle();
        harness.openFile(new TestTFile("Notes/First.md", { mtime: 1 }));
        await jest.advanceTimersByTimeAsync(100);
        expect(harness.processFrontMatter).toHaveBeenCalledTimes(1);

        harness.owner.toggle();
        releaseFirstWrite();
        await Promise.resolve();
        expect(firstFrontmatter.label).toBe("synthetic");

        harness.owner.toggle();
        harness.openFile(new TestTFile("Notes/Second.md", { mtime: 2 }));
        await jest.advanceTimersByTimeAsync(101);
        expect(harness.processFrontMatter).toHaveBeenCalledTimes(2);
        expect(secondFrontmatter.label).toBe("synthetic");
    });

    it("lets a submitted write finish after permission revocation without re-arming cleanup", async () => {
        jest.useFakeTimers();
        const harness = createHarness();
        const firstFrontmatter = { label: "old" };
        const secondFrontmatter = { label: "old" };
        let releaseFirstWrite!: () => void;
        harness.getCache.mockImplementation((path: string) => ({
            frontmatter: path === "Notes/PermissionFirst.md" ? firstFrontmatter : secondFrontmatter,
        }));
        harness.processFrontMatter.mockImplementation((
            file: TFile,
            mutate: (frontmatter: Record<string, unknown>) => void,
        ) => {
            if (file.path !== "Notes/PermissionFirst.md") {
                return Promise.resolve(mutate(secondFrontmatter));
            }
            return new Promise<void>((resolve) => {
                releaseFirstWrite = () => {
                    mutate(firstFrontmatter);
                    resolve();
                };
            });
        });

        harness.owner.toggle();
        harness.openFile(new TestTFile("Notes/PermissionFirst.md", { mtime: 1 }));
        await jest.advanceTimersByTimeAsync(100);
        expect(harness.processFrontMatter).toHaveBeenCalledTimes(1);

        harness.settings.enableMetadataUpdating = false;
        releaseFirstWrite();
        await Promise.resolve();
        expect(firstFrontmatter.label).toBe("synthetic");
        expect(harness.activeChanges).toEqual([true, false]);

        harness.settings.enableMetadataUpdating = true;
        harness.openFile(new TestTFile("Notes/PermissionSecond.md", { mtime: 2 }));
        await jest.advanceTimersByTimeAsync(101);
        expect(harness.processFrontMatter).toHaveBeenCalledTimes(1);
        expect(secondFrontmatter.label).toBe("old");

        harness.owner.toggle();
        harness.openFile(new TestTFile("Notes/PermissionSecond.md", { mtime: 2 }));
        await jest.advanceTimersByTimeAsync(100);
        expect(harness.processFrontMatter).toHaveBeenCalledTimes(2);
        expect(secondFrontmatter.label).toBe("synthetic");
        expect(harness.activeChanges).toEqual([true, false, true]);
    });

    it("does not let a queued first-generation cleanup cancel a second-generation update", async () => {
        jest.useFakeTimers();
        const harness = createHarness();
        const firstFrontmatter = { label: "old" };
        const secondFrontmatter = { label: "old" };
        harness.getCache.mockImplementation((path: string) => ({
            frontmatter: path === "Notes/CleanupFirst.md" ? firstFrontmatter : secondFrontmatter,
        }));
        harness.processFrontMatter.mockImplementation((
            file: TFile,
            mutate: (frontmatter: Record<string, unknown>) => void,
        ) => {
            mutate(file.path === "Notes/CleanupFirst.md" ? firstFrontmatter : secondFrontmatter);
            return Promise.resolve();
        });

        harness.owner.toggle();
        harness.openFile(new TestTFile("Notes/CleanupFirst.md", { mtime: 1 }));
        await jest.advanceTimersByTimeAsync(100);
        expect(firstFrontmatter.label).toBe("synthetic");

        harness.owner.toggle();
        harness.owner.toggle();
        harness.openFile(new TestTFile("Notes/CleanupSecond.md", { mtime: 2 }));
        await jest.advanceTimersByTimeAsync(100);

        expect(harness.processFrontMatter).toHaveBeenCalledTimes(2);
        expect(secondFrontmatter.label).toBe("synthetic");
    });

    it("lets a submitted write finish after disposal without accepting later events", async () => {
        jest.useFakeTimers();
        const harness = createHarness();
        const frontmatter = { label: "old" };
        let releaseWrite!: () => void;
        harness.getCache.mockReturnValue({ frontmatter });
        harness.processFrontMatter.mockImplementation(() => new Promise<void>((resolve) => {
            releaseWrite = () => {
                frontmatter.label = "synthetic";
                resolve();
            };
        }));

        harness.owner.toggle();
        harness.openFile(new TestTFile("Notes/Unload.md", { mtime: 1 }));
        await jest.advanceTimersByTimeAsync(100);
        harness.owner.dispose();
        releaseWrite();
        await Promise.resolve();
        await jest.advanceTimersByTimeAsync(1_000);
        harness.openFile(new TestTFile("Notes/Later.md", { mtime: 2 }));
        await jest.advanceTimersByTimeAsync(1_000);

        expect(frontmatter.label).toBe("synthetic");
        expect(harness.processFrontMatter).toHaveBeenCalledTimes(1);
    });
});

describe("MetadataUpdater update admission", () => {
    it("applies moment, string, and default rules after the hundred-millisecond debounce", async () => {
        jest.useFakeTimers();
        const harness = createHarness();
        const frontmatter = {
            modified: "old",
            label: "old",
            fallback: "old",
        };
        const file = new TestTFile("Notes/Normal.md", { mtime: Date.parse("2026-09-20T08:00:00.000Z") });
        harness.getCache.mockReturnValue({ frontmatter });
        harness.processFrontMatter.mockImplementation(async (
            _file: TFile,
            mutate: (frontmatter: Record<string, unknown>) => void,
        ) => {
            mutate(frontmatter);
        });

        harness.owner.toggle();
        harness.openFile(file);
        await jest.advanceTimersByTimeAsync(99);
        expect(harness.processFrontMatter).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(1);

        expect(harness.processFrontMatter).toHaveBeenCalledTimes(1);
        expect(frontmatter).toEqual({
            modified: "2026-05-18",
            label: "synthetic",
            fallback: "fallback-value",
        });
    });

    it("reads exclusions from live settings and skips the excluded file", async () => {
        jest.useFakeTimers();
        const harness = createHarness();
        harness.getCache.mockImplementation((path: string) => (
            path === "" ? null : { frontmatter: {} }
        ));

        harness.owner.toggle();
        harness.settings.metadataExcludePath = ["Private/"];
        harness.openFile(new TestTFile("Private/Diary.md", { mtime: 1 }));
        await jest.advanceTimersByTimeAsync(100);

        expect(harness.getCache).toHaveBeenCalledWith("");
        expect(harness.processFrontMatter).not.toHaveBeenCalled();
        expect(harness.log).toHaveBeenCalledWith("filtered Private/Diary.md in Private/");
    });

    it("requires a Markdown TFile with frontmatter", async () => {
        jest.useFakeTimers();
        const harness = createHarness();

        harness.owner.toggle();
        harness.openFile({ path: "Notes/Plain.md", extension: "md" } as TFile);
        await jest.advanceTimersByTimeAsync(100);
        expect(harness.getCache).not.toHaveBeenCalled();

        harness.openFile(new TestTFile("Assets/Attachment.png", { mtime: 1 }));
        await jest.advanceTimersByTimeAsync(100);
        expect(harness.getCache).not.toHaveBeenCalled();

        harness.getCache.mockReturnValue(null);
        harness.openFile(new TestTFile("Notes/NoFrontmatter.md", { mtime: 1 }));
        await jest.advanceTimersByTimeAsync(100);

        expect(harness.getCache).toHaveBeenCalledTimes(1);
        expect(harness.getCache).toHaveBeenCalledWith("Notes/NoFrontmatter.md");
        expect(harness.processFrontMatter).not.toHaveBeenCalled();
    });

    it("keeps the setting-disabled Notice when the command is invoked", () => {
        const harness = createHarness();
        harness.settings.enableMetadataUpdating = false;

        harness.owner.toggle();

        expect(harness.disabledNotices).toEqual(["metadata disabled"]);
        expect(harness.workspaceOn).not.toHaveBeenCalled();
        expect(harness.activeChanges).toEqual([]);
    });

    it("logs processFrontMatter failures without changing settings", async () => {
        jest.useFakeTimers();
        const harness = createHarness();
        const failure = new Error("frontmatter unavailable");
        harness.getCache.mockReturnValue({ frontmatter: { label: "old" } });
        harness.processFrontMatter.mockRejectedValue(failure);

        harness.owner.toggle();
        harness.openFile(new TestTFile("Notes/Failing.md", { mtime: 1 }));
        await jest.advanceTimersByTimeAsync(100);

        expect(harness.log).toHaveBeenCalledWith("Failed to update metadata frontmatter", failure);
    });
});
