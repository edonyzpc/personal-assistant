import { describe, expect, it, jest } from "@jest/globals";
import type { App, Vault } from "obsidian";
import type PluginManager from "../src/main";
import StatsManager, { combineActivityCounts, getStatsWriteDelayMs } from "../src/stats/stats-manager";

jest.mock("obsidian");

class ManagerMemoryAdapter {
    files = new Map<string, string>();
    folders = new Set<string>([".obsidian"]);
    writeCalls = 0;

    async exists(path: string): Promise<boolean> {
        const normalized = this.normalize(path);
        return this.files.has(normalized) || this.folders.has(normalized);
    }

    async mkdir(path: string): Promise<void> {
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
    } = {},
): StatsManager {
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
        settings: { statsPath: ".obsidian/stats.json" },
        registerEvent: jest.fn(),
        log: jest.fn(),
    };

    return new StatsManager(app, plugin as unknown as PluginManager);
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

    it("keeps edits in memory and flushes debounced shard writes", async () => {
        jest.useFakeTimers();
        const adapter = new ManagerMemoryAdapter();
        const manager = createManager(adapter);

        await manager.flush();
        adapter.writeCalls = 0;

        await manager.change("note.md", () => "hello world", () => "hello");
        expect(adapter.writeCalls).toBe(0);

        jest.advanceTimersByTime(1499);
        await Promise.resolve();
        expect(adapter.writeCalls).toBe(0);

        await manager.flush();
        expect(adapter.writeCalls).toBe(1);

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
