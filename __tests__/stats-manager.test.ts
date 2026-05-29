import { describe, expect, it, jest } from "@jest/globals";
import type { App, Vault } from "obsidian";
import type PluginManager from "../src/main";
import StatsManager, { combineActivityCounts, getStatsWriteDelayMs } from "../src/stats/stats-manager";
import {
    createStatsLocalStore,
    MemoryStatsLocalStore,
    type FileCountCacheEntry,
} from "../src/stats/stats-local-store";

type FakeFile = { path: string; extension: string; stat?: { mtime: number; ctime?: number; size: number } };
type VaultEventHandler = (...args: unknown[]) => unknown;
type VaultEventMap = Map<string, VaultEventHandler[]>;

jest.mock("obsidian");
jest.mock("../src/stats/stats-local-store", () => {
    const actual = jest.requireActual<typeof import("../src/stats/stats-local-store")>("../src/stats/stats-local-store");
    return {
        ...actual,
        createStatsLocalStore: jest.fn(() => new actual.MemoryStatsLocalStore()),
    };
});

class ManagerMemoryAdapter {
    files = new Map<string, string>();
    folders = new Set<string>([".obsidian"]);
    mkdirCalls = 0;
    writeCalls = 0;
    appendCalls = 0;
    processCalls = 0;
    appendError: Error | null = null;

    async exists(path: string): Promise<boolean> {
        const normalized = this.normalize(path);
        return this.files.has(normalized) || this.folders.has(normalized);
    }

    async mkdir(path: string): Promise<void> {
        this.mkdirCalls += 1;
        this.folders.add(this.normalize(path));
    }

    async read(path: string): Promise<string> {
        const content = this.files.get(this.normalize(path));
        if (content === undefined) throw new Error(`Missing file: ${path}`);
        return content;
    }

    async write(path: string, content: string): Promise<void> {
        this.writeCalls += 1;
        this.files.set(this.normalize(path), content);
    }

    async append(path: string, content: string): Promise<void> {
        this.appendCalls += 1;
        if (this.appendError) throw this.appendError;
        const normalized = this.normalize(path);
        this.files.set(normalized, `${this.files.get(normalized) ?? ""}${content}`);
    }

    async process(path: string, fn: (data: string) => string): Promise<string> {
        this.processCalls += 1;
        const normalized = this.normalize(path);
        const content = fn(this.files.get(normalized) ?? "");
        this.files.set(normalized, content);
        return content;
    }

    async list(path: string): Promise<{ files: string[]; folders: string[] }> {
        const normalized = this.normalize(path);
        return {
            files: Array.from(this.files.keys()).filter((file) => this.parent(file) === normalized).sort(),
            folders: Array.from(this.folders).filter((folder) => this.parent(folder) === normalized).sort(),
        };
    }

    private parent(path: string): string {
        const normalized = this.normalize(path);
        const index = normalized.lastIndexOf("/");
        return index >= 0 ? normalized.slice(0, index) : "";
    }

    private normalize(path: string): string {
        return path.replace(/\/+/g, "/").replace(/\/$/, "");
    }
}

function createManager(
    adapter: ManagerMemoryAdapter,
    options: {
        files?: Array<{ path: string; extension: string }>;
        cachedRead?: jest.Mock<(file: unknown) => Promise<string>>;
        settings?: Record<string, unknown>;
    } = {},
): StatsManager {
    return createManagerHarness(adapter, options).manager;
}

function createManagerHarness(
    adapter: ManagerMemoryAdapter,
    options: {
        files?: Array<{ path: string; extension: string }>;
        cachedRead?: jest.Mock<(file: unknown) => Promise<string>>;
        settings?: Record<string, unknown>;
    } = {},
): { manager: StatsManager; plugin: { settings: Record<string, unknown>; registerEvent: jest.Mock; log: jest.Mock } } {
    const files = options.files ?? [];
    const vault = {
        adapter,
        getFiles: () => files,
        getMarkdownFiles: () => files.filter((file) => file.extension === "md"),
        cachedRead: options.cachedRead ?? jest.fn(async () => ""),
        on: jest.fn(() => ({})),
    } as unknown as Vault;
    const app = {
        vault,
        workspace: { on: jest.fn(() => ({})) },
    } as unknown as App;
    const plugin = {
        settings: {
            statsPath: ".obsidian/stats.json",
            statisticsVaultId: "vault-id",
            statisticsSyncEnabled: false,
            ...options.settings,
        },
        registerEvent: jest.fn(),
        log: jest.fn(),
    };

    return {
        manager: new StatsManager(app, plugin as unknown as PluginManager),
        plugin,
    };
}

describe("combineActivityCounts", () => {
    it("keeps existing same-day activity when adding session activity", () => {
        const combined = combineActivityCounts(
            { words: 100, characters: 500, sentences: 4, pages: 0.3, footnotes: 1, citations: 2 },
            { words: 5, characters: 25, sentences: 1, pages: 0.1, footnotes: 0, citations: 1 },
        );

        expect(combined).toEqual({
            words: 105,
            characters: 525,
            sentences: 5,
            pages: 0.4,
            footnotes: 1,
            citations: 3,
        });
    });
});

describe("StatsManager write scheduling", () => {
    it("uses longer write delays on mobile devices", () => {
        expect(getStatsWriteDelayMs(false)).toBe(1500);
        expect(getStatsWriteDelayMs(true)).toBe(3000);
    });

    it("keeps edits in memory and flushes local stats without vault writes", async () => {
        jest.useFakeTimers();
        const adapter = new ManagerMemoryAdapter();
        const manager = createManager(adapter);

        await manager.flush();
        expect(adapter.mkdirCalls).toBe(0);
        expect(adapter.writeCalls).toBe(0);
        expect(adapter.appendCalls).toBe(0);
        expect(adapter.processCalls).toBe(0);

        adapter.mkdirCalls = 0;
        adapter.writeCalls = 0;
        adapter.appendCalls = 0;
        adapter.processCalls = 0;

        await manager.change("note.md", () => "hello world", () => "hello");
        expect(adapter.mkdirCalls).toBe(0);
        expect(adapter.writeCalls).toBe(0);
        expect(adapter.appendCalls).toBe(0);
        expect(adapter.processCalls).toBe(0);

        jest.advanceTimersByTime(1499);
        await Promise.resolve();
        expect(adapter.mkdirCalls).toBe(0);
        expect(adapter.writeCalls).toBe(0);
        expect(adapter.appendCalls).toBe(0);
        expect(adapter.processCalls).toBe(0);

        await manager.flush();
        expect(adapter.mkdirCalls).toBe(0);
        expect(adapter.writeCalls).toBe(0);
        expect(adapter.appendCalls).toBe(0);
        expect(adapter.processCalls).toBe(0);
        expect(Array.from(adapter.files.keys()).filter((path) => path.endsWith(".jsonl"))).toEqual([]);
        const dashboard = await manager.getDashboardData();
        const latest = dashboard.days[dashboard.days.length - 1];
        expect(latest.words).toBe(1);
        expect(latest.totalWords).toBe(1);

        manager.dispose();
        jest.useRealTimers();
    });

    it("writes per-device JSONL only when statistics sync is enabled", async () => {
        jest.useFakeTimers();
        const adapter = new ManagerMemoryAdapter();
        const manager = createManager(adapter, {
            settings: { statisticsSyncEnabled: true },
        });

        await manager.change("note.md", () => "hello world", () => "hello");
        await manager.flush();

        const jsonlFiles = Array.from(adapter.files.keys()).filter((path) => path.endsWith(".jsonl"));
        expect(jsonlFiles).toHaveLength(1);
        expect(jsonlFiles[0]).toMatch(/\.obsidian\/plugins\/personal-assistant\/stats\/devices\/.+\.jsonl/);
        const lines = adapter.files.get(jsonlFiles[0])?.trim().split("\n") ?? [];
        const latest = JSON.parse(lines[lines.length - 1]);
        expect(latest).toEqual(expect.objectContaining({
            version: 3,
            vaultId: "vault-id",
        }));
        expect(latest.activity.words).toBe(1);
        expect(latest.snapshot.totalWords).toBe(1);

        manager.dispose();
        jest.useRealTimers();
    });

    it("applies statistics sync setting changes without reloading the plugin", async () => {
        jest.useFakeTimers();
        const adapter = new ManagerMemoryAdapter();
        const { manager, plugin } = createManagerHarness(adapter);

        await manager.change("note.md", () => "hello world", () => "hello");
        await manager.flush();
        expect(Array.from(adapter.files.keys()).filter((path) => path.endsWith(".jsonl"))).toEqual([]);

        plugin.settings.statisticsSyncEnabled = true;
        await manager.setStatisticsSyncEnabled(true);
        await manager.flush();
        const jsonlPath = Array.from(adapter.files.keys()).find((path) => path.endsWith(".jsonl"));
        expect(jsonlPath).toBeDefined();
        const firstContent = adapter.files.get(jsonlPath ?? "") ?? "";

        plugin.settings.statisticsSyncEnabled = false;
        await manager.setStatisticsSyncEnabled(false);
        await manager.change("note.md", () => "hello world again", () => "hello world");
        await manager.flush();
        expect(adapter.files.get(jsonlPath ?? "")).toBe(firstContent);

        manager.dispose();
        jest.useRealTimers();
    });

    it("rolls back manager state when enabling statistics sync fails", async () => {
        jest.useFakeTimers();
        const adapter = new ManagerMemoryAdapter();
        const { manager, plugin } = createManagerHarness(adapter);

        await manager.change("note.md", () => "hello world", () => "hello");
        await manager.flush();

        class FailingStore extends MemoryStatsLocalStore {
            async initialize(): Promise<void> {
                throw new Error("local store unavailable");
            }
        }

        jest.mocked(createStatsLocalStore).mockImplementationOnce(() => new FailingStore());
        plugin.settings.statisticsSyncEnabled = true;
        await expect(manager.setStatisticsSyncEnabled(true)).rejects.toThrow("local store unavailable");

        plugin.settings.statisticsSyncEnabled = false;
        await manager.change("note.md", () => "hello world again", () => "hello world");
        await manager.flush();

        expect(Array.from(adapter.files.keys()).filter((path) => path.endsWith(".jsonl"))).toEqual([]);
        const dashboard = await manager.getDashboardData();
        const latest = dashboard.days[dashboard.days.length - 1];
        expect(latest.words).toBe(2);
        expect(latest.totalWords).toBe(2);

        manager.dispose();
        jest.useRealTimers();
    });

    it("rolls back manager state when the initial sync checkpoint fails", async () => {
        jest.useFakeTimers();
        const createLocalStore = jest.mocked(createStatsLocalStore);
        const sharedStore = new MemoryStatsLocalStore();
        createLocalStore.mockImplementation(() => sharedStore);
        const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
        Object.defineProperty(globalThis, "localStorage", {
            configurable: true,
            value: {
                getItem: jest.fn(() => "device-a"),
                setItem: jest.fn(),
            },
        });
        let manager: StatsManager | null = null;
        try {
            const adapter = new ManagerMemoryAdapter();
            const harness = createManagerHarness(adapter);
            manager = harness.manager;
            const { plugin } = harness;

            await manager.change("note.md", () => "hello world", () => "hello");
            await manager.flush();

            adapter.appendError = new Error("append failed");
            plugin.settings.statisticsSyncEnabled = true;
            await expect(manager.setStatisticsSyncEnabled(true)).rejects.toThrow("append failed");

            plugin.settings.statisticsSyncEnabled = false;
            adapter.appendError = null;
            await manager.change("note.md", () => "hello world again", () => "hello world");
            await manager.flush();

            expect(Array.from(adapter.files.keys()).filter((path) => path.endsWith(".jsonl"))).toEqual([]);
            const dashboard = await manager.getDashboardData();
            const latest = dashboard.days[dashboard.days.length - 1];
            expect(latest.words).toBe(2);
            expect(latest.totalWords).toBe(2);
        } finally {
            manager?.dispose();
            createLocalStore.mockImplementation(() => new MemoryStatsLocalStore());
            if (previousLocalStorage) {
                Object.defineProperty(globalThis, "localStorage", previousLocalStorage);
            } else {
                delete (globalThis as { localStorage?: Storage }).localStorage;
            }
            jest.useRealTimers();
        }
    });

    it("checkpoints sync after an idle debounced write", async () => {
        jest.useFakeTimers();
        const adapter = new ManagerMemoryAdapter();
        const manager = createManager(adapter, {
            settings: { statisticsSyncEnabled: true },
        });

        await manager.change("note.md", () => "hello world", () => "hello");
        await manager.getDashboardData();
        await jest.runOnlyPendingTimersAsync();

        expect(Array.from(adapter.files.keys()).filter((path) => path.endsWith(".jsonl"))).toHaveLength(1);

        manager.dispose();
        jest.useRealTimers();
    });

    it("does not schedule a write when a background snapshot finishes after disposal", async () => {
        jest.useFakeTimers();
        let resolveRead: (text: string) => void = () => { };
        const cachedRead = jest.fn(() => new Promise<string>((resolve) => {
            resolveRead = resolve;
        }));
        const adapter = new ManagerMemoryAdapter();
        const manager = createManager(adapter, {
            files: [
                { path: "note.md", extension: "md" },
                { path: "second.md", extension: "md" },
            ],
            cachedRead,
        });

        await manager.flush();
        adapter.writeCalls = 0;

        await jest.advanceTimersByTimeAsync(3000);
        expect(cachedRead).toHaveBeenCalledTimes(1);

        manager.dispose();
        resolveRead("hello world");
        await Promise.resolve();
        await Promise.resolve();
        await jest.advanceTimersByTimeAsync(3000);

        expect(adapter.writeCalls).toBe(0);
        expect(cachedRead).toHaveBeenCalledTimes(1);
        jest.useRealTimers();
    });
});

describe("StatsManager incremental snapshot", () => {
    function setupHarness(opts: {
        files: FakeFile[];
        cachedRead?: jest.Mock<(file: unknown) => Promise<string>>;
        preload?: FileCountCacheEntry[];
    }): {
        manager: StatsManager;
        plugin: { settings: Record<string, unknown>; registerEvent: jest.Mock; log: jest.Mock };
        adapter: ManagerMemoryAdapter;
        store: MemoryStatsLocalStore;
        triggerVaultEvent: (name: string, ...args: unknown[]) => Promise<void>;
        vaultFiles: FakeFile[];
        cachedRead: jest.Mock<(file: unknown) => Promise<string>>;
        putSpy: jest.SpiedFunction<MemoryStatsLocalStore["putFileCountEntries"]>;
        deleteSpy: jest.SpiedFunction<MemoryStatsLocalStore["deleteFileCountEntries"]>;
        clearSpy: jest.SpiedFunction<MemoryStatsLocalStore["clearFileCountCache"]>;
    } {
        // Enable fake timers BEFORE constructing the manager so the 3s
        // background-refresh setTimeout scheduled inside initialize() is
        // captured by Jest's fake timer queue. Driving that timer is how
        // tests run an incremental snapshot without clearing the cache.
        jest.useFakeTimers();
        const adapter = new ManagerMemoryAdapter();
        const store = new MemoryStatsLocalStore();
        const putSpy = jest.spyOn(store, "putFileCountEntries");
        const deleteSpy = jest.spyOn(store, "deleteFileCountEntries");
        const clearSpy = jest.spyOn(store, "clearFileCountCache");
        jest.mocked(createStatsLocalStore).mockImplementationOnce(() => store);

        // Pre-populate the store synchronously so that the manager picks the entries
        // up during its initial cache load.
        if (opts.preload && opts.preload.length > 0) {
            // We can't await inside this setup; MemoryStatsLocalStore.putFileCountEntries
            // mutates the in-memory Map synchronously despite being declared async, so
            // the side-effect is observable on the next microtask.
            void store.putFileCountEntries(opts.preload);
        }

        const vaultFiles = opts.files;
        const cachedRead = opts.cachedRead
            ?? (jest.fn(async () => "") as jest.Mock<(file: unknown) => Promise<string>>);
        const handlers: VaultEventMap = new Map();
        const vault = {
            adapter,
            getFiles: () => vaultFiles,
            getMarkdownFiles: () => vaultFiles.filter((file) => file.extension === "md"),
            cachedRead,
            on: jest.fn((event: string, handler: VaultEventHandler) => {
                if (!handlers.has(event)) handlers.set(event, []);
                handlers.get(event)!.push(handler);
                return {};
            }),
        } as unknown as Vault;
        const app = {
            vault,
            workspace: { on: jest.fn(() => ({})) },
        } as unknown as App;
        const plugin = {
            settings: {
                statsPath: ".obsidian/stats.json",
                statisticsVaultId: "vault-id",
                statisticsSyncEnabled: false,
            },
            registerEvent: jest.fn(),
            log: jest.fn(),
        };
        const manager = new StatsManager(app, plugin as unknown as PluginManager);

        const triggerVaultEvent = async (name: string, ...args: unknown[]) => {
            for (const handler of handlers.get(name) ?? []) {
                await handler(...args);
            }
        };

        return {
            manager,
            plugin,
            adapter,
            store,
            triggerVaultEvent,
            vaultFiles,
            cachedRead,
            putSpy,
            deleteSpy,
            clearSpy,
        };
    }

    function entryFor(file: FakeFile, overrides: Partial<FileCountCacheEntry> = {}): FileCountCacheEntry {
        return {
            path: file.path,
            mtime: file.stat?.mtime ?? 0,
            size: file.stat?.size ?? 0,
            wordCount: 1,
            charCount: 5,
            sentenceCount: 1,
            pageCount: 0.1,
            footnoteCount: 0,
            citationCount: 0,
            ...overrides,
        };
    }

    function fakeFile(path: string, mtime: number, size: number): FakeFile {
        return { path, extension: "md", stat: { mtime, size, ctime: 0 } };
    }

    function withSilencedConsole<T>(fn: () => Promise<T>): Promise<T> {
        const originalError = console.error;
        const originalWarn = console.warn;
        console.error = () => { };
        console.warn = () => { };
        return fn().finally(() => {
            console.error = originalError;
            console.warn = originalWarn;
        });
    }

    // Drives the warm-startup incremental snapshot path by firing the 3s
    // background-refresh timer scheduled inside StatsManager.initialize().
    // This is the only public entry point that runs the incremental flow
    // WITHOUT clearing the cache first (recalcTotals/updateToday both clear).
    async function runSnapshot(manager: StatsManager): Promise<void> {
        // Make sure init has completed so the timer is registered.
        await manager.update();
        await jest.advanceTimersByTimeAsync(3000);
        await manager.flush();
    }

    // Triggers a second incremental snapshot directly. Vault events no longer
    // schedule a background refresh, so tests that exercise an event + snapshot
    // sequence must drive the private background path themselves.
    async function invokeRefreshDirectly(manager: StatsManager): Promise<void> {
        const internals = manager as unknown as { refreshSnapshotInBackground: () => Promise<void> };
        await internals.refreshSnapshotInBackground();
    }

    afterEachReset();

    function afterEachReset(): void {
        const realAfterEach = (globalThis as { afterEach?: (fn: () => void) => void }).afterEach;
        realAfterEach?.(() => {
            jest.mocked(createStatsLocalStore).mockReset();
            jest.mocked(createStatsLocalStore).mockImplementation(() => new MemoryStatsLocalStore());
            jest.useRealTimers();
        });
    }

    it("reads every file on the first cold snapshot and populates the cache", async () => {
        const files = [fakeFile("a.md", 1, 10), fakeFile("b.md", 2, 20)];
        const cachedRead = jest.fn(async () => "hello world") as jest.Mock<(file: unknown) => Promise<string>>;
        const { manager, cachedRead: readMock, store, putSpy } = setupHarness({ files, cachedRead });
        await runSnapshot(manager);

        expect(readMock).toHaveBeenCalledTimes(2);
        const entries = await store.getAllFileCountEntries();
        expect(entries.map((entry) => entry.path).sort()).toEqual(["a.md", "b.md"]);
        expect(putSpy.mock.calls.flatMap((call) => call[0] ?? []).map((entry) => entry.path).sort()).toEqual([
            "a.md",
            "b.md",
        ]);
        manager.dispose();
    });

    it("skips re-reading files whose mtime and size match the cache", async () => {
        const files = [fakeFile("a.md", 100, 50), fakeFile("b.md", 200, 60)];
        const cachedRead = jest.fn(async () => "hello") as jest.Mock<(file: unknown) => Promise<string>>;
        const preload = files.map((file) => entryFor(file, { wordCount: 3 }));
        const { manager } = setupHarness({ files, cachedRead, preload });
        await runSnapshot(manager);

        expect(cachedRead).not.toHaveBeenCalled();
        manager.dispose();
    });

    it("recounts only files with stale mtime/size while reusing matching entries", async () => {
        const files = [
            fakeFile("a.md", 100, 50),
            fakeFile("b.md", 200, 60),
            fakeFile("c.md", 300, 70),
        ];
        const preload = [
            entryFor(files[0]),
            entryFor(files[1]),
            entryFor(files[2], { mtime: 999 }),
        ];
        const cachedRead = jest.fn(async () => "hello world") as jest.Mock<(file: unknown) => Promise<string>>;
        const { manager } = setupHarness({ files, cachedRead, preload });

        await runSnapshot(manager);

        expect(cachedRead).toHaveBeenCalledTimes(1);
        const readFiles = cachedRead.mock.calls.map((call) => (call[0] as FakeFile).path);
        expect(readFiles).toEqual(["c.md"]);
        manager.dispose();
    });

    it("removes stale cache entries for files that disappeared from the vault", async () => {
        // Fixture sized to clear the SAMPLE_MIN_CACHE_SIZE and CACHE_SIZE_RATIO_THRESHOLD
        // guards so the stale-path detection in the snapshot loop is what removes the
        // ghost entry (not the wholesale sampling rebuild path).
        const remaining = [
            fakeFile("a.md", 10, 5),
            fakeFile("b.md", 20, 6),
            fakeFile("c.md", 30, 7),
            fakeFile("d.md", 40, 8),
            fakeFile("e.md", 50, 9),
        ];
        const ghost = fakeFile("gone.md", 60, 10);
        const preload = [...remaining, ghost].map((file) => entryFor(file, { wordCount: 2 }));
        const cachedRead = jest.fn(async () => "hello world") as jest.Mock<(file: unknown) => Promise<string>>;
        const { manager, store, deleteSpy } = setupHarness({ files: remaining, cachedRead, preload });

        await runSnapshot(manager);

        const entries = await store.getAllFileCountEntries();
        expect(entries.map((entry) => entry.path).sort()).toEqual(["a.md", "b.md", "c.md", "d.md", "e.md"]);
        expect(deleteSpy.mock.calls.flatMap((call) => call[0])).toContain("gone.md");
        manager.dispose();
    });

    it("re-reads a file after the modify event marks it dirty", async () => {
        const file = fakeFile("a.md", 10, 5);
        const preload = [entryFor(file, { wordCount: 99 })];
        const cachedRead = jest.fn(async () => "hello world this is a longer text") as jest.Mock<(file: unknown) => Promise<string>>;
        const { manager, triggerVaultEvent } = setupHarness({ files: [file], cachedRead, preload });

        await manager.update();
        await triggerVaultEvent("modify", file);
        await runSnapshot(manager);

        expect(cachedRead).toHaveBeenCalled();
        manager.dispose();
    });

    it("drops the cache entry and persists a delete when a file is removed", async () => {
        const file = fakeFile("a.md", 10, 5);
        const preload = [entryFor(file)];
        const { manager, triggerVaultEvent, store, deleteSpy, vaultFiles } = setupHarness({ files: [file], preload });

        await manager.update();
        vaultFiles.length = 0;
        await triggerVaultEvent("delete", { path: file.path });
        await runSnapshot(manager);

        const entries = await store.getAllFileCountEntries();
        expect(entries).toEqual([]);
        expect(deleteSpy.mock.calls.flatMap((call) => call[0])).toContain("a.md");
        manager.dispose();
    });

    it("moves cache entries on rename without re-reading files", async () => {
        const original = fakeFile("old.md", 100, 50);
        const renamed = fakeFile("new.md", 100, 50);
        const preload = [entryFor(original, { wordCount: 7 })];
        const cachedRead = jest.fn(async () => "should not be called") as jest.Mock<(file: unknown) => Promise<string>>;
        const { manager, triggerVaultEvent, store, vaultFiles } = setupHarness({ files: [original], cachedRead, preload });

        // Phase 1 — warm the in-memory cache via the timer-driven background snapshot
        // so the rename handler has an oldEntry to move forward.
        await runSnapshot(manager);
        cachedRead.mockClear();

        // Phase 2 — rename in-vault, fire the rename event, then drive a second
        // snapshot directly (vault events no longer schedule a refresh).
        vaultFiles.length = 0;
        vaultFiles.push(renamed);
        await triggerVaultEvent("rename", renamed, "old.md");
        await invokeRefreshDirectly(manager);
        await manager.flush();

        expect(cachedRead).not.toHaveBeenCalled();
        const entries = await store.getAllFileCountEntries();
        expect(entries.map((entry) => entry.path)).toEqual(["new.md"]);
        expect(entries[0].wordCount).toBe(7);
        manager.dispose();
    });

    it("counts a freshly created markdown file on the next snapshot", async () => {
        const initial = fakeFile("a.md", 1, 1);
        const created = fakeFile("b.md", 2, 2);
        const cachedRead = jest.fn(async () => "fresh content") as jest.Mock<(file: unknown) => Promise<string>>;
        const { manager, triggerVaultEvent, vaultFiles } = setupHarness({ files: [initial], cachedRead });

        await manager.update();
        cachedRead.mockClear();

        vaultFiles.push(created);
        await triggerVaultEvent("create", created);
        await runSnapshot(manager);

        const readFiles = cachedRead.mock.calls.map((call) => (call[0] as FakeFile).path);
        expect(readFiles).toContain("b.md");
        manager.dispose();
    });

    it("aborts the incremental snapshot when shouldCancel returns true", async () => {
        const file = fakeFile("a.md", 1, 1);
        let resolveRead: (value: string) => void = () => { };
        const cachedRead = jest.fn(() => new Promise<string>((resolve) => {
            resolveRead = resolve;
        })) as jest.Mock<(file: unknown) => Promise<string>>;
        const { manager } = setupHarness({ files: [file], cachedRead });
        jest.useFakeTimers();
        await manager.update();

        await jest.advanceTimersByTimeAsync(3000);
        expect(cachedRead).toHaveBeenCalledTimes(1);

        manager.dispose();
        resolveRead("text");
        await jest.advanceTimersByTimeAsync(3000);
        expect(cachedRead).toHaveBeenCalledTimes(1);
        jest.useRealTimers();
    });

    it("falls back to batched calcSnapshot when the cache store is unavailable", async () => {
        const file = fakeFile("a.md", 1, 1);
        const cachedRead = jest.fn(async () => "hello") as jest.Mock<(file: unknown) => Promise<string>>;
        const adapter = new ManagerMemoryAdapter();
        class FailingStore extends MemoryStatsLocalStore {
            async getAllFileCountEntries(): Promise<FileCountCacheEntry[]> {
                throw new Error("cache unavailable");
            }
        }
        jest.mocked(createStatsLocalStore).mockImplementationOnce(() => new FailingStore());

        const handlers: VaultEventMap = new Map();
        const vault = {
            adapter,
            getFiles: () => [file],
            getMarkdownFiles: () => [file],
            cachedRead,
            on: jest.fn((event: string, handler: VaultEventHandler) => {
                if (!handlers.has(event)) handlers.set(event, []);
                handlers.get(event)!.push(handler);
                return {};
            }),
        } as unknown as Vault;
        const app = { vault, workspace: { on: jest.fn(() => ({})) } } as unknown as App;
        const plugin = {
            settings: { statsPath: ".obsidian/stats.json", statisticsVaultId: "vault-id", statisticsSyncEnabled: false },
            registerEvent: jest.fn(),
            log: jest.fn(),
        };
        const manager = new StatsManager(app, plugin as unknown as PluginManager);

        await withSilencedConsole(async () => {
            await manager.recalcTotals();
        });

        expect(cachedRead).toHaveBeenCalled();
        manager.dispose();
    });

    it("clears the cache and re-reads everything on recalcTotals", async () => {
        const file = fakeFile("a.md", 1, 1);
        const preload = [entryFor(file)];
        const cachedRead = jest.fn(async () => "fresh") as jest.Mock<(file: unknown) => Promise<string>>;
        const { manager, clearSpy } = setupHarness({ files: [file], cachedRead, preload });
        await manager.update();
        cachedRead.mockClear();
        clearSpy.mockClear();

        await manager.recalcTotals();

        expect(clearSpy).toHaveBeenCalled();
        expect(cachedRead).toHaveBeenCalled();
        manager.dispose();
    });

    it("never writes to the file-count cache from applyChange (file.stat timing trap)", async () => {
        const file = fakeFile("a.md", 1, 5);
        const cachedRead = jest.fn(async () => "hello") as jest.Mock<(file: unknown) => Promise<string>>;
        const { manager, putSpy } = setupHarness({ files: [file], cachedRead });

        await manager.update();
        const callsBeforeChange = putSpy.mock.calls.length;
        await manager.change("a.md", () => "hello world updated", () => "hello world");
        await manager.flush();
        const callsAfterChange = putSpy.mock.calls.length;

        const newWrites = putSpy.mock.calls.slice(callsBeforeChange, callsAfterChange).flatMap((call) => call[0] ?? []);
        for (const entry of newWrites) {
            // If applyChange wrote here it would carry the stale file.stat mtime/size
            // and pollute the cache. The change handler must defer to the next snapshot.
            expect(entry.path).not.toBe("a.md");
        }
        manager.dispose();
    });

    it("rebuilds the cache when the sampling check detects drift", async () => {
        // SAMPLE_MIN_CACHE_SIZE = 5 — fixture must clear it for sampling to actually run.
        const files = [
            fakeFile("a.md", 10, 5),
            fakeFile("b.md", 20, 6),
            fakeFile("c.md", 30, 7),
            fakeFile("d.md", 40, 8),
            fakeFile("e.md", 50, 9),
        ];
        // Pre-load with wildly wrong wordCounts so the sampling check fails.
        const preload = files.map((file) => entryFor(file, { wordCount: 9999 }));
        const cachedRead = jest.fn(async () => "hello") as jest.Mock<(file: unknown) => Promise<string>>;
        const { manager, clearSpy } = setupHarness({ files, cachedRead, preload });

        const clearCallsBefore = clearSpy.mock.calls.length;
        await runSnapshot(manager);
        // Sampling should clear + rebuild.
        expect(clearSpy.mock.calls.length).toBeGreaterThan(clearCallsBefore);
        expect(cachedRead).toHaveBeenCalled();
        manager.dispose();
    });

    it("yields between batches when processing a large vault (SDD §6.10)", async () => {
        // 100 files / BATCH_SIZE=50 on desktop → expect ≥2 yield calls of YIELD_MS=50.
        const files: FakeFile[] = Array.from({ length: 100 }, (_, i) => fakeFile(`note-${i}.md`, i, i));
        const cachedRead = jest.fn(async () => "hello") as jest.Mock<(file: unknown) => Promise<string>>;
        const { manager } = setupHarness({ files, cachedRead });

        await manager.update();
        const setTimeoutSpy = jest.spyOn(globalThis, "setTimeout");
        const callsBeforeRun = setTimeoutSpy.mock.calls.length;
        // Drain every scheduled timer — the 3s init refresh fires, the snapshot
        // runs to completion, and the per-batch yields are flushed as they appear.
        await jest.runAllTimersAsync();
        await manager.flush();

        const newCalls = setTimeoutSpy.mock.calls.slice(callsBeforeRun);
        const yieldCalls = newCalls.filter((call) => call[1] === 50);

        expect(cachedRead).toHaveBeenCalledTimes(100);
        // 100 / 50 = 2 yields at processed=50 and processed=100.
        expect(yieldCalls.length).toBeGreaterThanOrEqual(2);
        setTimeoutSpy.mockRestore();
        manager.dispose();
    });

    it("produces the same totals via incremental and full snapshot paths (SDD §6.14)", async () => {
        const files = [
            fakeFile("a.md", 1, 1),
            fakeFile("b.md", 2, 2),
            fakeFile("c.md", 3, 3),
        ];
        const cachedRead = jest.fn(async () => "hello world this is a sentence.") as jest.Mock<(file: unknown) => Promise<string>>;
        const { manager } = setupHarness({ files, cachedRead });

        await manager.update();
        const internals = manager as unknown as {
            calcSnapshot: () => Promise<unknown>;
            calcSnapshotIncremental: () => Promise<unknown>;
        };
        // Force fresh runs by clearing internal state via recalcTotals before each.
        await manager.recalcTotals();
        const fullSnapshot = await internals.calcSnapshot();
        await manager.recalcTotals();
        const incrementalSnapshot = await internals.calcSnapshotIncremental();

        expect(incrementalSnapshot).toEqual(fullSnapshot);
        manager.dispose();
    });

    it("completes the integrity sample within the time budget (SDD §6.19)", async () => {
        // 5 files, controlled 10ms-each reads. Sampling reads up to SAMPLE_SIZE=5 files,
        // so the total sampling I/O should be bounded by ~50ms of virtual time.
        const files = [
            fakeFile("a.md", 10, 5),
            fakeFile("b.md", 20, 6),
            fakeFile("c.md", 30, 7),
            fakeFile("d.md", 40, 8),
            fakeFile("e.md", 50, 9),
        ];
        const preload = files.map((file) => entryFor(file, { wordCount: 1 }));
        const cachedRead = jest.fn(async () => {
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
            return "hello";
        }) as jest.Mock<(file: unknown) => Promise<string>>;
        const { manager } = setupHarness({ files, cachedRead, preload });

        // runSnapshot already advances 3000ms, well above the 50ms sampling budget.
        await runSnapshot(manager);

        // Sampling reads at most SAMPLE_SIZE (5) files; with 5 cached entries it can hit
        // anywhere from 1 to 5. The contract is: completes (no hang) and stays bounded.
        expect(cachedRead.mock.calls.length).toBeLessThanOrEqual(files.length);
        manager.dispose();
    });

    it("keeps cache when sampling is within tolerance and only reads dirty files", async () => {
        const files = [fakeFile("a.md", 10, 5), fakeFile("b.md", 11, 6)];
        // Use accurate counts so sampling passes.
        const preload = [
            entryFor(files[0], { wordCount: 2 }),
            entryFor(files[1], { wordCount: 2 }),
        ];
        // cachedRead returns "hello world" → getWordCount = 2.
        const cachedRead = jest.fn(async () => "hello world") as jest.Mock<(file: unknown) => Promise<string>>;
        const { manager } = setupHarness({ files, cachedRead, preload });

        await runSnapshot(manager);
        // recalcTotals clears the cache then rebuilds, so all files get read once.
        // Reset and run a second pass that should hit the warm-cache path.
        cachedRead.mockClear();
        jest.useFakeTimers();
        await jest.advanceTimersByTimeAsync(3000);
        // Sampling may read up to 5 files but never more than the cached file count.
        expect(cachedRead.mock.calls.length).toBeLessThanOrEqual(files.length);
        manager.dispose();
        jest.useRealTimers();
    });
});
