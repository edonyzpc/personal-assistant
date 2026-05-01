import { describe, expect, it, jest } from "@jest/globals";
import { readFileSync } from "node:fs";
import type { Vault } from "obsidian";
import {
    STATS_DAILY_ROOT,
    StatsStore,
    createStatsShard,
    normalizeStatisticsView,
} from "../src/stats/stats-store";

jest.mock("obsidian");

class MemoryAdapter {
    files = new Map<string, string>();
    folders = new Set<string>([".obsidian"]);
    existsCalls = new Map<string, number>();

    constructor(initialFiles: Record<string, string> = {}) {
        for (const [path, content] of Object.entries(initialFiles)) {
            this.files.set(this.normalize(path), content);
            this.addParents(path);
        }
    }

    async exists(path: string): Promise<boolean> {
        const normalized = this.normalize(path);
        this.existsCalls.set(normalized, (this.existsCalls.get(normalized) ?? 0) + 1);
        return this.files.has(normalized) || this.folders.has(normalized);
    }

    async mkdir(path: string): Promise<void> {
        this.folders.add(this.normalize(path));
        this.addParents(path);
    }

    async read(path: string): Promise<string> {
        const content = this.files.get(this.normalize(path));
        if (content === undefined) throw new Error(`Missing file: ${path}`);
        return content;
    }

    async write(path: string, content: string): Promise<void> {
        const normalized = this.normalize(path);
        this.addParents(normalized);
        this.files.set(normalized, content);
    }

    async list(path: string): Promise<{ files: string[]; folders: string[] }> {
        const normalized = this.normalize(path);
        return {
            files: Array.from(this.files.keys()).filter((file) => this.parent(file) === normalized).sort(),
            folders: Array.from(this.folders).filter((folder) => this.parent(folder) === normalized).sort(),
        };
    }

    private addParents(path: string): void {
        let parent = this.parent(this.normalize(path));
        while (parent) {
            this.folders.add(parent);
            parent = this.parent(parent);
        }
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

function createVault(adapter: MemoryAdapter): Vault {
    return {
        adapter,
        getMarkdownFiles: () => [],
    } as unknown as Vault;
}

function readLegacyFixture() {
    return JSON.parse(readFileSync("test/.obsidian/stats.json", "utf8"));
}

describe("StatsStore", () => {
    it("migrates legacy stats into idempotent daily shards", async () => {
        const legacy = readLegacyFixture();
        const adapter = new MemoryAdapter({
            ".obsidian/stats.json": JSON.stringify(legacy),
        });
        const store = new StatsStore(createVault(adapter), ".obsidian/stats.json");

        const first = await store.readDashboardData();
        const secondStore = new StatsStore(createVault(adapter), ".obsidian/stats.json");
        const second = await secondStore.readDashboardData();

        expect(first.errors).toEqual([]);
        expect(second.errors).toEqual([]);
        expect(first.days).toHaveLength(Object.keys(legacy.history).length);
        expect(second.days).toHaveLength(first.days.length);
        expect(Array.from(adapter.files.keys()).filter((path) => path.endsWith("/legacy.json"))).toHaveLength(first.days.length);
    });

    it("preserves legacy activity and latest snapshot values", async () => {
        const legacy = readLegacyFixture();
        const adapter = new MemoryAdapter({
            ".obsidian/stats.json": JSON.stringify(legacy),
        });
        const store = new StatsStore(createVault(adapter), ".obsidian/stats.json");

        const data = await store.readDashboardData();
        const sampleDate = "2025-05-31";
        const may31 = data.days.find((day) => day.date === sampleDate);
        const latest = data.days[data.days.length - 1];
        const latestLegacy = legacy.history[latest.date];

        expect(may31?.words).toBe(legacy.history[sampleDate].words);
        expect(may31?.pages).toBeCloseTo(legacy.history[sampleDate].pages);
        expect(latest.totalWords).toBe(latestLegacy.totalWords);
        expect(latest.totalPages).toBeCloseTo(latestLegacy.totalPages);
    });

    it("sums activity across devices but uses the latest snapshot", async () => {
        const legacy = readLegacyFixture();
        const adapter = new MemoryAdapter({
            ".obsidian/stats.json": JSON.stringify(legacy),
        });
        const store = new StatsStore(createVault(adapter), ".obsidian/stats.json");
        await store.readDashboardData();

        await adapter.write(
            `${STATS_DAILY_ROOT}/2025-06-02/device-a.json`,
            JSON.stringify(createStatsShard(
                "2025-06-02",
                "device-a",
                { words: 10, characters: 20, sentences: 1, pages: 0.1, footnotes: 1, citations: 1 },
                { totalWords: 9999, totalCharacters: 10000, totalSentences: 200, totalFootnotes: 5, totalCitations: 6, totalPages: 33.3, files: 9 },
                "2025-06-02T23:59:59.000Z",
            )),
        );

        const data = await store.readDashboardData();
        const day = data.days.find((entry) => entry.date === "2025-06-02");
        const legacyDay = legacy.history["2025-06-02"];

        expect(day?.words).toBe(legacyDay.words + 10);
        expect(day?.pages).toBeCloseTo(legacyDay.pages + 0.1);
        expect(day?.totalWords).toBe(9999);
        expect(day?.files).toBe(9);
        expect(day?.deviceIds).toEqual(["device-a", "legacy"]);
    });

    it("reports corrupt JSON without overwriting it", async () => {
        const adapter = new MemoryAdapter({
            ".obsidian/stats.json": "<<<<<<< HEAD\n{}",
        });
        const store = new StatsStore(createVault(adapter), ".obsidian/stats.json");

        const data = await store.readDashboardData();

        expect(data.errors.length).toBeGreaterThan(0);
        expect(await adapter.read(".obsidian/stats.json")).toBe("<<<<<<< HEAD\n{}");
        expect(Array.from(adapter.files.keys()).filter((path) => path.endsWith("/legacy.json"))).toHaveLength(0);
    });

    it("caches folder checks for repeated writes to the same daily shard", async () => {
        const adapter = new MemoryAdapter();
        const store = new StatsStore(createVault(adapter), ".obsidian/stats.json");
        const shard = createStatsShard(
            "2026-05-01",
            store.getDeviceId(),
            { words: 1, characters: 1, sentences: 1, pages: 0, footnotes: 0, citations: 0 },
            { totalWords: 1, totalCharacters: 1, totalSentences: 1, totalFootnotes: 0, totalCitations: 0, totalPages: 0, files: 1 },
        );

        await store.writeOwnShard(shard);
        await store.writeOwnShard({ ...shard, activity: { ...shard.activity, words: 2 } });

        expect(adapter.existsCalls.get(`${STATS_DAILY_ROOT}/2026-05-01`)).toBe(1);
    });

    it("maps legacy statistics view names to dashboard views", () => {
        expect(normalizeStatisticsView("none")).toBe("overview");
        expect(normalizeStatisticsView("daily")).toBe("daily");
        expect(normalizeStatisticsView("total")).toBe("growth");
        expect(normalizeStatisticsView("composition")).toBe("composition");
    });
});
