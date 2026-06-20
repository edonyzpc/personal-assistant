import { normalizePath, type Vault } from "obsidian";
import { getVaultConfigDir, joinVaultConfigPath, LEGACY_CONFIG_DIR, uniqueNormalizedPaths } from "../obsidian-paths";
import type { StatsDeviceShard, StatsStoreError, VaultStatistics } from "./stats-types";
import {
    getStatsDailyRoot,
    LEGACY_STATS_PATH,
    legacyStatsDayToShard,
    parseStatsShard,
} from "./stats-store";
import {
    getStatsRecordKey,
    type StatsDailyDeviceRecord,
    type StatsMigrationMetadata,
} from "./stats-local-store";

export interface StatsMigrationImportResult {
    records: StatsDailyDeviceRecord[];
    errors: StatsStoreError[];
    metadata: StatsMigrationMetadata;
}

interface StatsMigrationImportOptions {
    legacyStatsPath: string;
    vaultId: string;
    importedAt?: string;
}

interface SourceFingerprint {
    path: string;
    hash: string;
}

export async function importV2StatsHistory(
    vault: Vault,
    options: StatsMigrationImportOptions,
): Promise<StatsMigrationImportResult> {
    const configDir = getVaultConfigDir(vault);
    const legacyStatsPaths = uniqueNormalizedPaths([
        options.legacyStatsPath,
        joinVaultConfigPath(configDir, "stats.json"),
        LEGACY_STATS_PATH,
    ].filter(Boolean));
    const dailyRoots = uniqueNormalizedPaths([configDir, LEGACY_CONFIG_DIR].map(getStatsDailyRoot));
    const records = new Map<string, StatsDailyDeviceRecord>();
    const errors: StatsStoreError[] = [];
    const sourceFingerprints: SourceFingerprint[] = [];
    let validShardCount = 0;
    let corruptShardCount = 0;
    let duplicateEquivalentShardCount = 0;

    for (const path of legacyStatsPaths) {
        const exists = await safeExists(vault, path, errors);
        if (exists === "error") {
            corruptShardCount += 1;
            continue;
        }
        if (exists === "missing") continue;
        const content = await safeRead(vault, path, errors);
        if (content === null) {
            corruptShardCount += 1;
            continue;
        }
        sourceFingerprints.push({ path, hash: hashString(content) });
        const parsed = parseJson(content, path, errors);
        if (parsed === undefined) {
            corruptShardCount += 1;
            continue;
        }
        if (!isLegacyStats(parsed)) {
            errors.push({
                path,
                message: "Legacy statistics file does not contain a valid history object.",
            });
            corruptShardCount += 1;
            continue;
        }
        for (const [date, day] of Object.entries(parsed.history)) {
            const shard = parseValidLegacyStatsDay(date, day);
            if (!shard) {
                errors.push({
                    path: `${path}#${date}`,
                    message: "Invalid legacy statistics day shape.",
                });
                corruptShardCount += 1;
                continue;
            }
            const importStatus = addRecord(records, shardToRecord(shard, options.vaultId));
            if (importStatus === "duplicate-same") {
                duplicateEquivalentShardCount += 1;
                validShardCount += 1;
                continue;
            }
            if (importStatus === "duplicate-conflict") {
                errors.push({
                    path: `${path}#${date}`,
                    message: "Duplicate statistics shard was not imported.",
                });
                corruptShardCount += 1;
                continue;
            }
            validShardCount += 1;
        }
    }

    for (const dailyRoot of dailyRoots) {
        const exists = await safeExists(vault, dailyRoot, errors);
        if (exists === "error") {
            corruptShardCount += 1;
            continue;
        }
        if (exists === "missing") continue;
        const rootList = await safeList(vault, dailyRoot, errors);
        if (!rootList) {
            corruptShardCount += 1;
            continue;
        }
        for (const dateFolder of [...rootList.folders].sort()) {
            const fileList = await safeList(vault, dateFolder, errors);
            if (!fileList) {
                corruptShardCount += 1;
                continue;
            }
            for (const file of fileList.files.filter((path) => path.endsWith(".json")).sort()) {
                const content = await safeRead(vault, file, errors);
                if (content === null) {
                    corruptShardCount += 1;
                    continue;
                }
                const contentHash = hashString(content);
                sourceFingerprints.push({ path: file, hash: contentHash });
                const parsed = parseJson(content, file, errors);
                if (parsed === undefined) {
                    corruptShardCount += 1;
                    continue;
                }
                const shard = parseValidV2Shard(parsed);
                if (!shard) {
                    errors.push({ path: file, message: "Invalid statistics shard shape." });
                    corruptShardCount += 1;
                    continue;
                }
                const importStatus = addRecord(records, shardToRecord(shard, options.vaultId));
                if (importStatus === "duplicate-same") {
                    duplicateEquivalentShardCount += 1;
                    validShardCount += 1;
                    continue;
                }
                if (importStatus === "duplicate-conflict") {
                    errors.push({
                        path: file,
                        message: "Duplicate statistics shard was not imported.",
                    });
                    corruptShardCount += 1;
                    continue;
                }
                validShardCount += 1;
            }
        }
    }

    const importedRecords = Array.from(records.values()).sort((left, right) =>
        left.recordKey.localeCompare(right.recordKey)
    );
    const firstError = errors[0];
    return {
        records: importedRecords,
        errors,
        metadata: {
            version: 1,
            v2ImportFingerprint: hashStable({
                sources: sourceFingerprints.sort((left, right) => left.path.localeCompare(right.path)),
                validShardCount,
                corruptShardCount,
                duplicateEquivalentShardCount,
            }),
            validShardCount,
            corruptShardCount,
            duplicateEquivalentShardCount,
            importedRecordKeyCount: importedRecords.length,
            aggregateHash: hashRecords(importedRecords),
            cleanupStatus: corruptShardCount > 0 ? "blocked" : "not-started",
            importedAt: options.importedAt ?? new Date().toISOString(),
            lastError: firstError ? `${firstError.path}: ${firstError.message}` : undefined,
        },
    };
}

type AddRecordResult = "added" | "duplicate-same" | "duplicate-conflict";

function addRecord(records: Map<string, StatsDailyDeviceRecord>, record: StatsDailyDeviceRecord): AddRecordResult {
    const existing = records.get(record.recordKey);
    if (!existing) {
        records.set(record.recordKey, record);
        return "added";
    }
    if (!hasSameCounts(existing, record)) {
        return "duplicate-conflict";
    }
    if (isNewerRecord(record, existing)) {
        records.set(record.recordKey, record);
    }
    return "duplicate-same";
}

function hasSameCounts(left: StatsDailyDeviceRecord, right: StatsDailyDeviceRecord): boolean {
    return JSON.stringify(left.activity) === JSON.stringify(right.activity)
        && JSON.stringify(left.snapshot) === JSON.stringify(right.snapshot);
}

function isNewerRecord(left: StatsDailyDeviceRecord, right: StatsDailyDeviceRecord): boolean {
    return left.updatedAt.localeCompare(right.updatedAt) > 0;
}

function shardToRecord(shard: StatsDeviceShard, vaultId: string): StatsDailyDeviceRecord {
    return {
        version: 3,
        vaultId,
        recordKey: getStatsRecordKey(shard.date, shard.deviceId),
        date: shard.date,
        deviceId: shard.deviceId,
        revision: 1,
        updatedAt: shard.updatedAt,
        activity: { ...shard.activity },
        snapshot: { ...shard.snapshot },
    };
}

function isLegacyStats(value: unknown): value is VaultStatistics {
    return isObject(value) && isObject(value.history);
}

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJson(content: string, path: string, errors: StatsStoreError[]): unknown {
    try {
        return JSON.parse(content);
    } catch (error) {
        errors.push({
            path,
            message: error instanceof Error ? error.message : String(error),
        });
        return undefined;
    }
}

function parseValidV2Shard(value: unknown): StatsDeviceShard | null {
    if (!isObject(value) || !isObject(value.activity) || !isObject(value.snapshot)) {
        return null;
    }
    if (typeof value.updatedAt !== "string" || Number.isNaN(Date.parse(value.updatedAt))) {
        return null;
    }
    if (!allFiniteNumbers(value.activity, ["words", "characters", "sentences", "pages", "footnotes", "citations"])) {
        return null;
    }
    if (!allFiniteNumbers(value.snapshot, [
        "totalWords",
        "totalCharacters",
        "totalSentences",
        "totalFootnotes",
        "totalCitations",
        "totalPages",
        "files",
    ])) {
        return null;
    }
    return parseStatsShard(value);
}

function parseValidLegacyStatsDay(date: string, value: unknown): StatsDeviceShard | null {
    if (!isObject(value)) {
        return null;
    }
    if (!allFiniteNumbers(value, [
        "words",
        "characters",
        "sentences",
        "pages",
        "footnotes",
        "citations",
        "totalWords",
        "totalCharacters",
        "totalSentences",
        "totalFootnotes",
        "totalCitations",
        "totalPages",
        "files",
    ])) {
        return null;
    }
    return legacyStatsDayToShard(date, value);
}

function allFiniteNumbers(source: Record<string, unknown>, keys: string[]): boolean {
    return keys.every((key) => typeof source[key] === "number" && Number.isFinite(source[key]));
}

async function safeExists(
    vault: Vault,
    path: string,
    errors: StatsStoreError[],
): Promise<"exists" | "missing" | "error"> {
    try {
        return await vault.adapter.exists(normalizePath(path)) ? "exists" : "missing";
    } catch (error) {
        errors.push({
            path,
            message: error instanceof Error ? error.message : String(error),
        });
        return "error";
    }
}

async function safeRead(vault: Vault, path: string, errors: StatsStoreError[]): Promise<string | null> {
    try {
        return await vault.adapter.read(normalizePath(path));
    } catch (error) {
        errors.push({
            path,
            message: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

async function safeList(
    vault: Vault,
    path: string,
    errors: StatsStoreError[],
): Promise<{ files: string[]; folders: string[] } | null> {
    try {
        return await vault.adapter.list(normalizePath(path));
    } catch (error) {
        errors.push({
            path,
            message: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

function hashRecords(records: StatsDailyDeviceRecord[]): string {
    return hashStable([...records].sort((left, right) => left.recordKey.localeCompare(right.recordKey)).map((record) => ({
        recordKey: record.recordKey,
        activity: record.activity,
        snapshot: record.snapshot,
        updatedAt: record.updatedAt,
    })));
}

function hashStable(value: unknown): string {
    return hashString(JSON.stringify(value));
}

function hashString(value: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}
