import { normalizePath } from "obsidian";
import type {
    ActivityCounts,
    SnapshotCounts,
    StatsDashboardData,
    StatsDeviceShard,
} from "./stats-types";
import { joinVaultConfigPath, LEGACY_CONFIG_DIR } from "../obsidian-paths";
import { isRecord } from "../pa/helpers";
import { getPlatformCrypto, getPlatformLocalStorage } from "../platform-dom";

export const STATS_STORE_VERSION = 2;
const STATS_STORE_CHILD_PATH = "personal-assistant-stats/v2";
export const LEGACY_STATS_PATH = joinVaultConfigPath(LEGACY_CONFIG_DIR, "stats.json");
export const STATS_STORE_ROOT = joinVaultConfigPath(LEGACY_CONFIG_DIR, STATS_STORE_CHILD_PATH);
export const STATS_DAILY_ROOT = `${STATS_STORE_ROOT}/daily`;
export const LEGACY_DEVICE_ID = "legacy";
export const DEVICE_STORAGE_KEY = "personal-assistant.stats.deviceId.v2";

export type StatisticsView = "overview" | "daily" | "growth" | "composition";

export function normalizeStatisticsView(value: string | undefined): StatisticsView {
    if (value === "daily") return "daily";
    if (value === "total" || value === "growth") return "growth";
    if (value === "composition") return "composition";
    return "overview";
}

export function getStatsStoreRoot(configDir = LEGACY_CONFIG_DIR): string {
    return joinVaultConfigPath(configDir, STATS_STORE_CHILD_PATH);
}

export function getStatsDailyRoot(configDir = LEGACY_CONFIG_DIR): string {
    return normalizePath(`${getStatsStoreRoot(configDir)}/daily`);
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


function numberValue(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeActivity(value: unknown): ActivityCounts {
    const source = isRecord(value) ? value : {};
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
    const source = isRecord(value) ? value : {};
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

export function parseStatsShard(value: unknown): StatsDeviceShard | null {
    if (!isRecord(value)) return null;
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

export function legacyStatsDayToShard(date: string, day: unknown): StatsDeviceShard {
    const source = isRecord(day) ? day : {};
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

export function getDeviceId(): string {
    try {
        const storage = getPlatformLocalStorage();
        const existing = storage?.getItem(DEVICE_STORAGE_KEY);
        if (existing) return existing;
        const id = createDeviceId();
        storage?.setItem(DEVICE_STORAGE_KEY, id);
        return id;
    } catch {
        return createDeviceId();
    }
}

export function createDeviceId(): string {
    const cryptoApi = getPlatformCrypto() as (Crypto & { randomUUID?: () => string }) | undefined;
    if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
        return cryptoApi.randomUUID();
    }
    return `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
