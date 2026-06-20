import { normalizePath, type Vault } from "obsidian";
import { getVaultConfigDir, joinVaultConfigPath } from "../obsidian-paths";
import type { ActivityCounts, SnapshotCounts, StatsStoreError } from "./stats-types";
import {
    getStatsRecordKey,
    type StatsDailyDeviceRecord,
    type StatsSyncState,
} from "./stats-local-store";

const SYNC_CHILD_PATH = "plugins/personal-assistant/stats/devices";

export interface StatsSyncImportResult {
    records: StatsDailyDeviceRecord[];
    errors: StatsStoreError[];
}

export interface StatsSyncCheckpointResult {
    state: StatsSyncState;
    exportedRecordCount: number;
}

export class StatsSyncStore {
    private readonly syncRoot: string;

    constructor(
        private readonly vault: Vault,
        private readonly vaultId: string,
        private readonly deviceId: string,
        configDir = getVaultConfigDir(vault),
    ) {
        this.syncRoot = getStatsSyncRoot(configDir);
    }

    getOwnSyncFilePath(): string {
        return getStatsSyncDevicePath(this.syncRoot, this.deviceId);
    }

    isSyncPath(path: string): boolean {
        const normalized = normalizePath(path);
        return normalized === this.syncRoot || normalized.startsWith(`${this.syncRoot}/`);
    }

    async importSyncedRecords(): Promise<StatsSyncImportResult> {
        const errors: StatsStoreError[] = [];
        if (!(await safeExists(this.vault, this.syncRoot, errors))) {
            return { records: [], errors };
        }
        const listed = await safeList(this.vault, this.syncRoot, errors);
        if (!listed) {
            return { records: [], errors };
        }
        const records = new Map<string, StatsDailyDeviceRecord>();
        for (const file of listed.files.filter((path) => path.endsWith(".jsonl")).sort()) {
            const content = await safeRead(this.vault, file, errors);
            if (content === null) continue;
            const lines = content.split(/\r?\n/);
            lines.forEach((line, index) => {
                const trimmed = line.trim();
                if (!trimmed) return;
                const path = `${file}:${index + 1}`;
                if (isConflictMarker(trimmed)) {
                    errors.push({ path, message: "Skipped sync conflict marker." });
                    return;
                }
                const parsed = parseJson(trimmed, path, errors);
                if (parsed === undefined) return;
                if (isObject(parsed) && typeof parsed.vaultId === "string" && parsed.vaultId !== this.vaultId) {
                    return;
                }
                const record = parseSyncRecord(parsed, this.vaultId);
                if (!record) {
                    errors.push({ path, message: "Invalid statistics sync record." });
                    return;
                }
                mergeRecord(records, record);
            });
        }
        return {
            records: Array.from(records.values()).sort((left, right) => left.recordKey.localeCompare(right.recordKey)),
            errors,
        };
    }

    async checkpoint(records: StatsDailyDeviceRecord[], state: StatsSyncState | null): Promise<StatsSyncCheckpointResult> {
        const nextState: StatsSyncState = state ? cloneSyncState(state) : { version: 1, records: {} };
        const ownRecords = records
            .filter((record) => record.vaultId === this.vaultId && record.deviceId === this.deviceId)
            .sort((left, right) => left.recordKey.localeCompare(right.recordKey));
        const syncFileExists = await safeExists(this.vault, this.getOwnSyncFilePath(), []);
        if (syncFileExists) {
            await this.seedExportedStateFromOwnSyncFile(nextState);
        }
        const changedRecords: StatsDailyDeviceRecord[] = [];

        for (const record of ownRecords) {
            const hash = getStatsSyncRecordHash(record);
            const exported = nextState.records[record.recordKey];
            const exportedMatches = Boolean(exported
                && exported.revision === record.revision
                && (exported.hash === hash || exported.hash === getLegacyStatsSyncRecordHash(record)));
            if (!syncFileExists || !exportedMatches) {
                changedRecords.push(record);
            }
            if (!exported || exported.revision !== record.revision || exported.hash !== hash) {
                nextState.records[record.recordKey] = {
                    revision: record.revision,
                    hash,
                    exportedAt: new Date().toISOString(),
                };
            }
        }

        if (changedRecords.length > 0) {
            await ensureFolder(this.vault, this.syncRoot);
            const payload = changedRecords.map((record) => JSON.stringify(recordToSyncLine(record))).join("\n") + "\n";
            await this.vault.adapter.append(this.getOwnSyncFilePath(), payload);
        }

        return {
            state: nextState,
            exportedRecordCount: changedRecords.length,
        };
    }

    private async seedExportedStateFromOwnSyncFile(state: StatsSyncState): Promise<void> {
        const errors: StatsStoreError[] = [];
        const content = await safeRead(this.vault, this.getOwnSyncFilePath(), errors);
        if (content === null) return;
        const records = new Map<string, StatsDailyDeviceRecord>();
        content.split(/\r?\n/).forEach((line, index) => {
            const trimmed = line.trim();
            if (!trimmed || isConflictMarker(trimmed)) return;
            const parsed = parseJson(trimmed, `${this.getOwnSyncFilePath()}:${index + 1}`, errors);
            const record = parseSyncRecord(parsed, this.vaultId);
            if (!record || record.deviceId !== this.deviceId) return;
            mergeRecord(records, record);
        });
        for (const record of records.values()) {
            const existing = state.records[record.recordKey];
            if (!existing || existing.revision <= record.revision) {
                state.records[record.recordKey] = {
                    revision: record.revision,
                    hash: getStatsSyncRecordHash(record),
                    exportedAt: existing?.exportedAt ?? record.updatedAt,
                };
            }
        }
    }
}

export function getStatsSyncRoot(configDir: string): string {
    return joinVaultConfigPath(configDir, SYNC_CHILD_PATH);
}

export function getStatsSyncDevicePath(syncRoot: string, deviceId: string): string {
    return normalizePath(`${syncRoot}/${sanitizeFileName(deviceId)}.jsonl`);
}

function parseSyncRecord(value: unknown, vaultId: string): StatsDailyDeviceRecord | null {
    if (!isObject(value) || value.version !== 3 || value.vaultId !== vaultId) {
        return null;
    }
    if (typeof value.date !== "string"
        || typeof value.deviceId !== "string"
        || typeof value.updatedAt !== "string"
        || Number.isNaN(Date.parse(value.updatedAt))
        || typeof value.revision !== "number"
        || !Number.isFinite(value.revision)
        || !isObject(value.activity)
        || !isObject(value.snapshot)) {
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
    return {
        version: 3,
        vaultId,
        recordKey: getStatsRecordKey(value.date, value.deviceId),
        date: value.date,
        deviceId: value.deviceId,
        revision: value.revision,
        updatedAt: value.updatedAt,
        activity: pickActivity(value.activity),
        snapshot: pickSnapshot(value.snapshot),
    };
}

function mergeRecord(records: Map<string, StatsDailyDeviceRecord>, record: StatsDailyDeviceRecord): void {
    const existing = records.get(record.recordKey);
    if (!existing || compareRecordFreshness(record, existing) > 0) {
        records.set(record.recordKey, record);
    }
}

function compareRecordFreshness(left: StatsDailyDeviceRecord, right: StatsDailyDeviceRecord): number {
    return left.revision - right.revision
        || left.updatedAt.localeCompare(right.updatedAt)
        || left.deviceId.localeCompare(right.deviceId);
}

function recordToSyncLine(record: StatsDailyDeviceRecord): Omit<StatsDailyDeviceRecord, "recordKey"> {
    return {
        version: 3,
        vaultId: record.vaultId,
        date: record.date,
        deviceId: record.deviceId,
        revision: record.revision,
        updatedAt: record.updatedAt,
        activity: { ...record.activity },
        snapshot: { ...record.snapshot },
    };
}

function getStatsSyncRecordHash(record: StatsDailyDeviceRecord): string {
    return hashString(JSON.stringify({
        version: record.version,
        vaultId: record.vaultId,
        date: record.date,
        deviceId: record.deviceId,
        revision: record.revision,
        activity: record.activity,
        snapshot: record.snapshot,
    }));
}

function getLegacyStatsSyncRecordHash(record: StatsDailyDeviceRecord): string {
    return hashString(JSON.stringify(recordToSyncLine(record)));
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

function isConflictMarker(line: string): boolean {
    return line.startsWith("<<<<<<<") || line.startsWith("=======") || line.startsWith(">>>>>>>");
}

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function allFiniteNumbers(source: Record<string, unknown>, keys: string[]): boolean {
    return keys.every((key) => typeof source[key] === "number" && Number.isFinite(source[key]));
}

function pickActivity(source: Record<string, unknown>): ActivityCounts {
    return {
        words: source.words as number,
        characters: source.characters as number,
        sentences: source.sentences as number,
        pages: source.pages as number,
        footnotes: source.footnotes as number,
        citations: source.citations as number,
    };
}

function pickSnapshot(source: Record<string, unknown>): SnapshotCounts {
    return {
        totalWords: source.totalWords as number,
        totalCharacters: source.totalCharacters as number,
        totalSentences: source.totalSentences as number,
        totalFootnotes: source.totalFootnotes as number,
        totalCitations: source.totalCitations as number,
        totalPages: source.totalPages as number,
        files: source.files as number,
    };
}

async function ensureFolder(vault: Vault, path: string): Promise<void> {
    const parts = normalizePath(path).split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        if (!(await vault.adapter.exists(current))) {
            await vault.adapter.mkdir(current);
        }
    }
}

async function safeExists(vault: Vault, path: string, errors: StatsStoreError[]): Promise<boolean> {
    try {
        return await vault.adapter.exists(normalizePath(path));
    } catch (error) {
        errors.push({
            path,
            message: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}

async function safeList(vault: Vault, path: string, errors: StatsStoreError[]): Promise<{ files: string[]; folders: string[] } | null> {
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

function cloneSyncState(state: StatsSyncState): StatsSyncState {
    return {
        version: state.version,
        records: Object.fromEntries(Object.entries(state.records).map(([key, value]) => [
            key,
            { ...value },
        ])),
    };
}

function sanitizeFileName(value: string): string {
    return value.replace(/[^A-Za-z0-9._-]/g, "_") || "device";
}

function hashString(value: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}
