import { describe, expect, it, jest } from "@jest/globals";
import type { App, Vault } from "obsidian";
import type PluginManager from "../src/main";
import StatsManager, { combineActivityCounts, getStatsWriteDelayMs } from "../src/stats/stats-manager";
import { createStatsLocalStore, MemoryStatsLocalStore } from "../src/stats/stats-local-store";

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
    const vault = {
        adapter,
        getFiles: () => options.files ?? [],
        getMarkdownFiles: () => [],
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

        jest.advanceTimersByTime(3000);
        await Promise.resolve();
        expect(cachedRead).toHaveBeenCalledTimes(1);

        manager.dispose();
        resolveRead("hello world");
        await Promise.resolve();
        await Promise.resolve();
        jest.advanceTimersByTime(3000);
        await Promise.resolve();

        expect(adapter.writeCalls).toBe(0);
        expect(cachedRead).toHaveBeenCalledTimes(1);
        jest.useRealTimers();
    });
});
