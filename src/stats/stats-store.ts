import { normalizePath, type Vault } from "obsidian";
import type {
    ActivityCounts,
    SnapshotCounts,
    StatsDashboardData,
    StatsDashboardDay,
    StatsDeviceShard,
    StatsStoreError,
    VaultStatistics,
} from "./stats-types";

export const STATS_STORE_VERSION = 2;
export const STATS_STORE_ROOT = ".obsidian/personal-assistant-stats/v2";
export const STATS_DAILY_ROOT = `${STATS_STORE_ROOT}/daily`;
const LEGACY_DEVICE_ID = "legacy";
const DEVICE_STORAGE_KEY = "personal-assistant.stats.deviceId.v2";

export type StatisticsView = "overview" | "daily" | "growth" | "composition";

export function normalizeStatisticsView(value: string | undefined): StatisticsView {
    if (value === "daily") return "daily";
    if (value === "total" || value === "growth") return "growth";
    if (value === "composition") return "composition";
    return "overview";
}

export function emptyActivityCounts(): ActivityCounts {
    return {
        words: 0,
        characters: 0,
        sentences: 0,
        pages: 0,
        footnotes: 0,
        citations: 0,
    };
}

export function emptySnapshotCounts(): SnapshotCounts {
    return {
        totalWords: 0,
        totalCharacters: 0,
        totalSentences: 0,
        totalFootnotes: 0,
        totalCitations: 0,
        totalPages: 0,
        files: 0,
    };
}

export function createEmptyDashboardData(deviceId = ""): StatsDashboardData {
    return {
        version: STATS_STORE_VERSION,
        generatedAt: new Date().toISOString(),
        deviceId,
        days: [],
        errors: [],
    };
}

export function createStatsShard(
    date: string,
    deviceId: string,
    activity: ActivityCounts,
    snapshot: SnapshotCounts,
    updatedAt = new Date().toISOString(),
): StatsDeviceShard {
    return {
        version: STATS_STORE_VERSION,
        date,
        deviceId,
        updatedAt,
        activity: {
            ...activity,
            pages: roundPages(activity.pages),
        },
        snapshot: {
            ...snapshot,
            totalPages: roundPages(snapshot.totalPages),
        },
    };
}

function roundPages(value: number): number {
    return Number(value.toFixed(1));
}

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberValue(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeActivity(value: unknown): ActivityCounts {
    const source = isObject(value) ? value : {};
    return {
        words: numberValue(source.words),
        characters: numberValue(source.characters),
        sentences: numberValue(source.sentences),
        pages: numberValue(source.pages),
        footnotes: numberValue(source.footnotes),
        citations: numberValue(source.citations),
    };
}

function normalizeSnapshot(value: unknown): SnapshotCounts {
    const source = isObject(value) ? value : {};
    return {
        totalWords: numberValue(source.totalWords),
        totalCharacters: numberValue(source.totalCharacters),
        totalSentences: numberValue(source.totalSentences),
        totalFootnotes: numberValue(source.totalFootnotes),
        totalCitations: numberValue(source.totalCitations),
        totalPages: numberValue(source.totalPages),
        files: numberValue(source.files),
    };
}

function parseShard(value: unknown): StatsDeviceShard | null {
    if (!isObject(value)) return null;
    if (value.version !== STATS_STORE_VERSION) return null;
    if (typeof value.date !== "string" || typeof value.deviceId !== "string") {
        return null;
    }
    return createStatsShard(
        value.date,
        value.deviceId,
        normalizeActivity(value.activity),
        normalizeSnapshot(value.snapshot),
        typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
    );
}

function dayToLegacyShard(date: string, day: unknown): StatsDeviceShard {
    const source = isObject(day) ? day : {};
    return createStatsShard(
        date,
        LEGACY_DEVICE_ID,
        {
            words: numberValue(source.words),
            characters: numberValue(source.characters),
            sentences: numberValue(source.sentences),
            pages: numberValue(source.pages),
            footnotes: numberValue(source.footnotes),
            citations: numberValue(source.citations),
        },
        {
            totalWords: numberValue(source.totalWords),
            totalCharacters: numberValue(source.totalCharacters),
            totalSentences: numberValue(source.totalSentences),
            totalFootnotes: numberValue(source.totalFootnotes),
            totalCitations: numberValue(source.totalCitations),
            totalPages: numberValue(source.totalPages),
            files: numberValue(source.files),
        },
        `${date}T00:00:00.000Z`,
    );
}

function getDeviceId(): string {
    try {
        const storage = globalThis.localStorage;
        const existing = storage?.getItem(DEVICE_STORAGE_KEY);
        if (existing) return existing;
        const id = createDeviceId();
        storage?.setItem(DEVICE_STORAGE_KEY, id);
        return id;
    } catch {
        return createDeviceId();
    }
}

function createDeviceId(): string {
    const cryptoApi = globalThis.crypto as (Crypto & { randomUUID?: () => string }) | undefined;
    if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
        return cryptoApi.randomUUID();
    }
    return `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class StatsStore {
    private readonly vault: Vault;
    private readonly legacyStatsPath: string;
    private readonly deviceId: string;
    private initialized = false;
    private initializing: Promise<void> | null = null;
    private writeChain: Promise<void> = Promise.resolve();
    private ensuredFolders = new Set<string>();
    private migrationErrors: StatsStoreError[] = [];
    private dashboardCache: StatsDashboardData | null = null;
    private dashboardDirty = true;

    constructor(vault: Vault, legacyStatsPath: string) {
        this.vault = vault;
        this.legacyStatsPath = normalizePath(legacyStatsPath);
        this.deviceId = getDeviceId();
    }

    getDeviceId(): string {
        return this.deviceId;
    }

    invalidateDashboardCache(): void {
        this.dashboardDirty = true;
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;
        if (this.initializing) return this.initializing;

        this.initializing = (async () => {
            this.migrationErrors = [];
            await this.ensureFolder(STATS_DAILY_ROOT);
            await this.migrateLegacyStats();
            this.initialized = true;
        })();

        return this.initializing;
    }

    async readDashboardData(): Promise<StatsDashboardData> {
        await this.initialize();

        if (!this.dashboardDirty && this.dashboardCache) {
            return this.cloneDashboardData(this.dashboardCache);
        }

        const errors = [...this.migrationErrors];
        const byDate = new Map<string, {
            activity: ActivityCounts;
            snapshot: SnapshotCounts;
            updatedAt: string;
            deviceIds: Set<string>;
        }>();

        const dailyExists = await this.safeExists(STATS_DAILY_ROOT);
        if (!dailyExists) {
            return this.cacheDashboardData({
                ...createEmptyDashboardData(this.deviceId),
                errors,
            });
        }

        const dailyList = await this.safeList(STATS_DAILY_ROOT, errors);
        for (const dateFolder of dailyList.folders) {
            const fileList = await this.safeList(dateFolder, errors);
            for (const file of fileList.files.filter((path) => path.endsWith(".json"))) {
                const shard = await this.readShard(file, errors);
                if (!shard) continue;
                const entry = byDate.get(shard.date) ?? {
                    activity: emptyActivityCounts(),
                    snapshot: emptySnapshotCounts(),
                    updatedAt: "",
                    deviceIds: new Set<string>(),
                };
                entry.activity.words += shard.activity.words;
                entry.activity.characters += shard.activity.characters;
                entry.activity.sentences += shard.activity.sentences;
                entry.activity.pages += shard.activity.pages;
                entry.activity.footnotes += shard.activity.footnotes;
                entry.activity.citations += shard.activity.citations;
                entry.deviceIds.add(shard.deviceId);
                if (!entry.updatedAt || shard.updatedAt >= entry.updatedAt) {
                    entry.updatedAt = shard.updatedAt;
                    entry.snapshot = shard.snapshot;
                }
                byDate.set(shard.date, entry);
            }
        }

        const days: StatsDashboardDay[] = Array.from(byDate.entries())
            .map(([date, entry]) => ({
                date,
                ...entry.activity,
                pages: roundPages(entry.activity.pages),
                ...entry.snapshot,
                totalPages: roundPages(entry.snapshot.totalPages),
                updatedAt: entry.updatedAt,
                deviceIds: Array.from(entry.deviceIds).sort(),
            }))
            .sort((a, b) => a.date.localeCompare(b.date));

        return this.cacheDashboardData({
            version: STATS_STORE_VERSION,
            generatedAt: new Date().toISOString(),
            deviceId: this.deviceId,
            days,
            errors,
        });
    }

    async readLatestSnapshot(): Promise<SnapshotCounts | null> {
        await this.initialize();

        if (!this.dashboardDirty && this.dashboardCache && this.dashboardCache.days.length > 0) {
            return this.snapshotFromDashboardDay(this.dashboardCache.days[this.dashboardCache.days.length - 1]);
        }

        if (!(await this.safeExists(STATS_DAILY_ROOT))) return null;

        const errors: StatsStoreError[] = [];
        const dailyList = await this.safeList(STATS_DAILY_ROOT, errors);
        const folders = [...dailyList.folders].sort().reverse();

        for (const folder of folders) {
            const fileList = await this.safeList(folder, errors);
            let latest: StatsDeviceShard | null = null;
            for (const file of fileList.files.filter((path) => path.endsWith(".json"))) {
                const shard = await this.readShard(file, errors);
                if (shard && (!latest || shard.updatedAt >= latest.updatedAt)) {
                    latest = shard;
                }
            }
            if (latest) return latest.snapshot;
        }

        return null;
    }

    async readOwnShard(date: string): Promise<StatsDeviceShard | null> {
        await this.initialize();
        const path = this.getShardPath(date, this.deviceId);
        const errors: StatsStoreError[] = [];
        if (!(await this.safeExists(path))) return null;
        const shard = await this.readShard(path, errors);
        if (errors.length > 0) {
            throw new Error(`${path}: ${errors[0].message}`);
        }
        return shard;
    }

    async writeOwnShard(shard: StatsDeviceShard): Promise<void> {
        await this.initialize();
        const path = this.getShardPath(shard.date, this.deviceId);
        await this.ensureFolder(this.getDateFolder(shard.date));
        const previousWrite = this.writeChain;
        const currentWrite = previousWrite.catch(() => undefined).then(() =>
            this.vault.adapter.write(path, JSON.stringify(shard, null, 2))
        );
        this.writeChain = currentWrite;
        try {
            await currentWrite;
            this.dashboardDirty = true;
        } finally {
            if (this.writeChain === currentWrite) {
                this.writeChain = Promise.resolve();
            }
        }
    }

    private getDateFolder(date: string): string {
        return normalizePath(`${STATS_DAILY_ROOT}/${date}`);
    }

    private getShardPath(date: string, deviceId: string): string {
        return normalizePath(`${this.getDateFolder(date)}/${deviceId}.json`);
    }

    private cacheDashboardData(data: StatsDashboardData): StatsDashboardData {
        this.dashboardCache = this.cloneDashboardData(data);
        this.dashboardDirty = false;
        return this.cloneDashboardData(data);
    }

    private cloneDashboardData(data: StatsDashboardData): StatsDashboardData {
        return {
            ...data,
            errors: data.errors.map((error) => ({ ...error })),
            days: data.days.map((day) => ({
                ...day,
                deviceIds: [...day.deviceIds],
            })),
        };
    }

    private snapshotFromDashboardDay(day: StatsDashboardDay): SnapshotCounts {
        return {
            totalWords: day.totalWords,
            totalCharacters: day.totalCharacters,
            totalSentences: day.totalSentences,
            totalFootnotes: day.totalFootnotes,
            totalCitations: day.totalCitations,
            totalPages: day.totalPages,
            files: day.files,
        };
    }

    private async migrateLegacyStats(): Promise<void> {
        if (!(await this.safeExists(this.legacyStatsPath))) return;

        let legacy: VaultStatistics;
        try {
            legacy = JSON.parse(await this.vault.adapter.read(this.legacyStatsPath));
        } catch (error) {
            this.migrationErrors.push({
                path: this.legacyStatsPath,
                message: error instanceof Error ? error.message : String(error),
            });
            return;
        }

        if (!legacy || !isObject(legacy) || !isObject(legacy.history)) {
            this.migrationErrors.push({
                path: this.legacyStatsPath,
                message: "Legacy statistics file does not contain a valid history object.",
            });
            return;
        }

        for (const [date, day] of Object.entries(legacy.history)) {
            const folder = this.getDateFolder(date);
            const path = this.getShardPath(date, LEGACY_DEVICE_ID);
            await this.ensureFolder(folder);
            if (await this.safeExists(path)) continue;
            await this.vault.adapter.write(path, JSON.stringify(dayToLegacyShard(date, day), null, 2));
        }
    }

    private async readShard(path: string, errors: StatsStoreError[]): Promise<StatsDeviceShard | null> {
        if (!(await this.safeExists(path))) return null;
        try {
            const parsed = JSON.parse(await this.vault.adapter.read(path));
            const shard = parseShard(parsed);
            if (!shard) {
                errors.push({ path, message: "Invalid statistics shard shape." });
                return null;
            }
            return shard;
        } catch (error) {
            errors.push({
                path,
                message: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    private async ensureFolder(path: string): Promise<void> {
        const normalized = normalizePath(path);
        if (this.ensuredFolders.has(normalized)) return;

        const parts = normalized.split("/").filter(Boolean);
        let current = "";
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            if (this.ensuredFolders.has(current)) continue;
            if (!(await this.safeExists(current))) {
                await this.vault.adapter.mkdir(current);
            }
            this.ensuredFolders.add(current);
        }
    }

    private async safeExists(path: string): Promise<boolean> {
        try {
            return await this.vault.adapter.exists(normalizePath(path));
        } catch {
            return false;
        }
    }

    private async safeList(path: string, errors: StatsStoreError[]) {
        try {
            return await this.vault.adapter.list(normalizePath(path));
        } catch (error) {
            errors.push({
                path,
                message: error instanceof Error ? error.message : String(error),
            });
            return { files: [], folders: [] };
        }
    }
}
