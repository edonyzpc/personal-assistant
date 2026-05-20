import type { Vault } from "obsidian";
import type { ActivityCounts, SnapshotCounts, StatsDashboardData, StatsDashboardDay, StatsDeviceShard } from "./stats-types";
import type { StatsStoreError } from "./stats-types";
import {
    createEmptyDashboardData,
    emptyActivityCounts,
    emptySnapshotCounts,
    getDeviceId,
} from "./stats-store";
import {
    createStatsLocalStore,
    getStatsRecordKey,
    type StatsDailyDeviceRecord,
    type StatsLocalStore,
    type StatsMigrationMetadata,
} from "./stats-local-store";
import { importV2StatsHistory } from "./stats-migration";
import { StatsSyncStore } from "./stats-sync-store";

export interface StatsRepository {
    initialize(): Promise<void>;
    getDeviceId(): string;
    invalidateDashboardCache(): void;
    readDashboardData(): Promise<StatsDashboardData>;
    readLatestSnapshot(): Promise<SnapshotCounts | null>;
    readOwnShard(date: string): Promise<StatsDeviceShard | null>;
    writeOwnShard(shard: StatsDeviceShard): Promise<void>;
    checkpointSync(): Promise<void>;
    isStatsStorePath(path: string): boolean;
}

export class LocalStatsRepository implements StatsRepository {
    private readonly localStore: StatsLocalStore;
    private readonly deviceId: string;
    private dashboardCache: StatsDashboardData | null = null;
    private dashboardDirty = true;
    private writeChain: Promise<void> = Promise.resolve();
    private syncChain: Promise<void> = Promise.resolve();
    private initialized = false;
    private initializing: Promise<void> | null = null;
    private migrationErrors: StatsStoreError[] = [];
    private syncErrors: StatsStoreError[] = [];

    constructor(
        private readonly vault: Vault,
        private readonly vaultId: string,
        localStore: StatsLocalStore = createStatsLocalStore(vault, vaultId),
        private readonly legacyStatsPath = "",
        private readonly syncStore: StatsSyncStore | null = null,
        deviceId: string = getDeviceId(),
    ) {
        this.localStore = localStore;
        this.deviceId = deviceId;
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;
        if (this.initializing) return this.initializing;
        this.initializing = this.initializeOnce().catch((error) => {
            this.initializing = null;
            throw error;
        });
        return this.initializing;
    }

    private async initializeOnce(): Promise<void> {
        await this.localStore.initialize();
        const importResult = await importV2StatsHistory(this.vault, {
            legacyStatsPath: this.legacyStatsPath,
            vaultId: this.vaultId,
        });
        const existingMetadata = await this.localStore.getMigrationMetadata();
        this.migrationErrors = importResult.errors;
        for (const record of importResult.records) {
            await this.localStore.addRecordIfAbsent(record);
        }
        const mergedMetadata = mergeMigrationMetadata(existingMetadata, importResult.metadata);
        await this.localStore.setMigrationMetadata(mergedMetadata);
        await this.importSyncedRecords();
        this.dashboardDirty = true;
        this.initialized = true;
    }

    private async importSyncedRecords(): Promise<void> {
        if (!this.syncStore) return;
        const syncImport = await this.syncStore.importSyncedRecords();
        this.syncErrors = syncImport.errors;
        for (const record of syncImport.records) {
            const changed = await upsertRecordIfNewer(this.localStore, record);
            if (changed) {
                this.dashboardDirty = true;
            }
        }
    }

    getDeviceId(): string {
        return this.deviceId;
    }

    invalidateDashboardCache(): void {
        this.dashboardDirty = true;
    }

    async readDashboardData(): Promise<StatsDashboardData> {
        await this.initialize();
        if (this.syncStore) {
            await this.importSyncedRecords();
            this.dashboardDirty = true;
        }
        if (!this.dashboardDirty && this.dashboardCache) {
            return cloneDashboardData(this.dashboardCache);
        }
        const records = await this.localStore.getAllRecords();
        return this.cacheDashboardData(createDashboardData(records, this.deviceId, [
            ...this.migrationErrors,
            ...this.syncErrors,
        ]));
    }

    async readLatestSnapshot(): Promise<SnapshotCounts | null> {
        await this.initialize();
        const records = await this.localStore.getAllRecords();
        const latest = records.sort(compareRecordsNewestFirst)[0];
        return latest ? { ...latest.snapshot } : null;
    }

    async readOwnShard(date: string): Promise<StatsDeviceShard | null> {
        await this.initialize();
        const record = await this.localStore.getRecord(date, this.deviceId);
        return record ? recordToShard(record) : null;
    }

    async writeOwnShard(shard: StatsDeviceShard): Promise<void> {
        const nextShard = cloneShard(shard);
        const previousWrite = this.writeChain;
        const currentWrite = previousWrite.catch(() => undefined).then(async () => {
            await this.initialize();
            const existing = await this.localStore.getRecord(nextShard.date, this.deviceId);
            if (existing && hasSameCounts(existing, nextShard)) {
                return;
            }
            const revision = (existing?.revision ?? 0) + 1;
            await this.localStore.upsertRecord(shardToRecord(nextShard, this.vaultId, this.deviceId, revision));
            this.dashboardDirty = true;
        });
        this.writeChain = currentWrite;
        try {
            await currentWrite;
        } finally {
            if (this.writeChain === currentWrite) {
                this.writeChain = Promise.resolve();
            }
        }
    }

    async checkpointSync(): Promise<void> {
        const syncStore = this.syncStore;
        if (!syncStore) return;
        const previousSync = this.syncChain;
        const currentSync = previousSync.catch(() => undefined).then(async () => {
            await this.initialize();
            await this.importSyncedRecords();
            const records = await this.localStore.getAllRecords();
            const result = await syncStore.checkpoint(records, await this.localStore.getSyncState());
            await this.localStore.setSyncState(result.state);
        });
        this.syncChain = currentSync;
        try {
            await currentSync;
        } finally {
            if (this.syncChain === currentSync) {
                this.syncChain = Promise.resolve();
            }
        }
    }

    isStatsStorePath(path: string): boolean {
        return this.syncStore?.isSyncPath(path) ?? false;
    }

    private cacheDashboardData(data: StatsDashboardData): StatsDashboardData {
        this.dashboardCache = cloneDashboardData(data);
        this.dashboardDirty = false;
        return cloneDashboardData(data);
    }
}

export function createStatsRepository(
    vault: Vault,
    options: { vaultId?: string; legacyStatsPath: string; syncEnabled?: boolean },
): StatsRepository {
    const vaultId = options.vaultId || "default-vault";
    const localStore = createStatsLocalStore(vault, vaultId);
    const deviceId = getDeviceId();
    const syncStore = options.syncEnabled ? new StatsSyncStore(vault, vaultId, deviceId) : null;
    return new LocalStatsRepository(vault, vaultId, localStore, options.legacyStatsPath, syncStore, deviceId);
}

function createDashboardData(
    records: StatsDailyDeviceRecord[],
    deviceId: string,
    errors: StatsStoreError[] = [],
): StatsDashboardData {
    if (records.length === 0) {
        return {
            ...createEmptyDashboardData(deviceId),
            errors: errors.map((error) => ({ ...error })),
        };
    }

    const byDate = new Map<string, {
        activity: ActivityCounts;
        snapshot: SnapshotCounts;
        latestRecord: Pick<StatsDailyDeviceRecord, "date" | "updatedAt" | "deviceId"> | null;
        updatedAt: string;
        deviceIds: Set<string>;
    }>();

    for (const record of records) {
        const entry = byDate.get(record.date) ?? {
            activity: emptyActivityCounts(),
            snapshot: emptySnapshotCounts(),
            latestRecord: null,
            updatedAt: "",
            deviceIds: new Set<string>(),
        };
        entry.activity.words += record.activity.words;
        entry.activity.characters += record.activity.characters;
        entry.activity.sentences += record.activity.sentences;
        entry.activity.pages += record.activity.pages;
        entry.activity.footnotes += record.activity.footnotes;
        entry.activity.citations += record.activity.citations;
        entry.deviceIds.add(record.deviceId);
        if (!entry.latestRecord || compareRecordsNewestFirst(record, entry.latestRecord) < 0) {
            entry.latestRecord = {
                date: record.date,
                deviceId: record.deviceId,
                updatedAt: record.updatedAt,
            };
            entry.updatedAt = record.updatedAt;
            entry.snapshot = { ...record.snapshot };
        }
        byDate.set(record.date, entry);
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

    return {
        version: 2,
        generatedAt: new Date().toISOString(),
        deviceId,
        days,
        errors: errors.map((error) => ({ ...error })),
    };
}

function shardToRecord(
    shard: StatsDeviceShard,
    vaultId: string,
    deviceId: string,
    revision: number,
): StatsDailyDeviceRecord {
    return {
        version: 3,
        vaultId,
        recordKey: getStatsRecordKey(shard.date, deviceId),
        date: shard.date,
        deviceId,
        revision,
        updatedAt: shard.updatedAt,
        activity: { ...shard.activity },
        snapshot: { ...shard.snapshot },
    };
}

function recordToShard(record: StatsDailyDeviceRecord): StatsDeviceShard {
    return {
        version: 2,
        date: record.date,
        deviceId: record.deviceId,
        updatedAt: record.updatedAt,
        activity: { ...record.activity },
        snapshot: { ...record.snapshot },
    };
}

function cloneShard(shard: StatsDeviceShard): StatsDeviceShard {
    return {
        ...shard,
        activity: { ...shard.activity },
        snapshot: { ...shard.snapshot },
    };
}

function compareRecordsNewestFirst(left: Pick<StatsDailyDeviceRecord, "date" | "updatedAt" | "deviceId">, right: Pick<StatsDailyDeviceRecord, "date" | "updatedAt" | "deviceId">): number {
    return right.date.localeCompare(left.date)
        || right.updatedAt.localeCompare(left.updatedAt)
        || right.deviceId.localeCompare(left.deviceId);
}

function hasSameCounts(record: StatsDailyDeviceRecord, shard: StatsDeviceShard): boolean {
    return JSON.stringify(record.activity) === JSON.stringify(shard.activity)
        && JSON.stringify(record.snapshot) === JSON.stringify(shard.snapshot);
}

async function upsertRecordIfNewer(localStore: StatsLocalStore, incoming: StatsDailyDeviceRecord): Promise<boolean> {
    const existing = await localStore.getRecord(incoming.date, incoming.deviceId);
    if (existing && compareRecordFreshness(incoming, existing) <= 0) {
        return false;
    }
    await localStore.upsertRecord(incoming);
    return true;
}

function compareRecordFreshness(left: StatsDailyDeviceRecord, right: StatsDailyDeviceRecord): number {
    return left.revision - right.revision
        || left.updatedAt.localeCompare(right.updatedAt)
        || left.deviceId.localeCompare(right.deviceId);
}

function mergeMigrationMetadata(
    existing: StatsMigrationMetadata | null,
    next: StatsMigrationMetadata,
): StatsMigrationMetadata {
    if (!existing) {
        return next;
    }
    if (existing.v2ImportFingerprint === next.v2ImportFingerprint) {
        return {
            ...next,
            importedAt: existing.importedAt,
        };
    }
    return next;
}

function roundPages(value: number): number {
    return Number(value.toFixed(1));
}

function cloneDashboardData(data: StatsDashboardData): StatsDashboardData {
    return {
        ...data,
        errors: data.errors.map((error) => ({ ...error })),
        days: data.days.map((day) => ({
            ...day,
            deviceIds: [...day.deviceIds],
        })),
    };
}
