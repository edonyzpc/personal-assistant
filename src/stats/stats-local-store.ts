import type { Vault } from "obsidian";
import type { ActivityCounts, SnapshotCounts } from "./stats-types";

const STATS_LOCAL_DB_VERSION = 3;
const DAILY_RECORDS_STORE = "dailyRecords";
const METADATA_STORE = "metadata";
const FILE_COUNT_CACHE_STORE = "fileCountCache";
const MIGRATION_METADATA_KEY = "migration";
const SYNC_STATE_KEY = "sync";
const PLUGIN_STORAGE_SCOPE = "personal-assistant-statistics-v3";

export interface StatsDailyDeviceRecord {
    version: 3;
    vaultId: string;
    recordKey: string;
    date: string;
    deviceId: string;
    revision: number;
    updatedAt: string;
    activity: ActivityCounts;
    snapshot: SnapshotCounts;
}

export interface FileCountCacheEntry {
    path: string;
    mtime: number;
    size: number;
    wordCount: number;
    charCount: number;
    sentenceCount: number;
    pageCount: number;
    footnoteCount: number;
    citationCount: number;
}

export class SchemaIntegrityError extends Error {
    constructor(public readonly missingStores: string[]) {
        super(`Statistics local store is missing required object stores: ${missingStores.join(", ")}`);
        this.name = "SchemaIntegrityError";
    }
}

export interface StatsLocalStore {
    initialize(): Promise<void>;
    getAllRecords(): Promise<StatsDailyDeviceRecord[]>;
    getRecord(date: string, deviceId: string): Promise<StatsDailyDeviceRecord | null>;
    upsertRecord(record: StatsDailyDeviceRecord): Promise<void>;
    addRecordIfAbsent(record: StatsDailyDeviceRecord): Promise<boolean>;
    getMigrationMetadata(): Promise<StatsMigrationMetadata | null>;
    setMigrationMetadata(metadata: StatsMigrationMetadata): Promise<void>;
    getSyncState(): Promise<StatsSyncState | null>;
    setSyncState(state: StatsSyncState): Promise<void>;
    getAllFileCountEntries(): Promise<FileCountCacheEntry[]>;
    putFileCountEntries(entries: FileCountCacheEntry[]): Promise<void>;
    deleteFileCountEntries(paths: string[]): Promise<void>;
    clearFileCountCache(): Promise<void>;
}

export interface StatsMigrationMetadata {
    version: 1;
    v2ImportFingerprint: string;
    validShardCount: number;
    corruptShardCount: number;
    duplicateEquivalentShardCount?: number;
    importedRecordKeyCount: number;
    aggregateHash: string;
    cleanupStatus: "not-started" | "complete" | "blocked" | "failed";
    importedAt: string;
    cleanupTimestamp?: string;
    cleanupError?: string;
    lastError?: string;
}

export interface StatsSyncState {
    version: 1;
    records: Record<string, StatsSyncRecordState>;
}

export interface StatsSyncRecordState {
    revision: number;
    hash: string;
    exportedAt: string;
}

export class MemoryStatsLocalStore implements StatsLocalStore {
    private readonly records = new Map<string, StatsDailyDeviceRecord>();
    private readonly fileCountEntries = new Map<string, FileCountCacheEntry>();

    async initialize(): Promise<void> {
        // Memory store is ready immediately.
    }

    async getAllRecords(): Promise<StatsDailyDeviceRecord[]> {
        return Array.from(this.records.values()).map(cloneRecord);
    }

    async getRecord(date: string, deviceId: string): Promise<StatsDailyDeviceRecord | null> {
        const record = this.records.get(getStatsRecordKey(date, deviceId));
        return record ? cloneRecord(record) : null;
    }

    async upsertRecord(record: StatsDailyDeviceRecord): Promise<void> {
        this.records.set(record.recordKey, cloneRecord(record));
    }

    async addRecordIfAbsent(record: StatsDailyDeviceRecord): Promise<boolean> {
        if (this.records.has(record.recordKey)) {
            return false;
        }
        this.records.set(record.recordKey, cloneRecord(record));
        return true;
    }

    private migrationMetadata: StatsMigrationMetadata | null = null;

    async getMigrationMetadata(): Promise<StatsMigrationMetadata | null> {
        return this.migrationMetadata ? { ...this.migrationMetadata } : null;
    }

    async setMigrationMetadata(metadata: StatsMigrationMetadata): Promise<void> {
        this.migrationMetadata = { ...metadata };
    }

    private syncState: StatsSyncState | null = null;

    async getSyncState(): Promise<StatsSyncState | null> {
        return this.syncState ? cloneSyncState(this.syncState) : null;
    }

    async setSyncState(state: StatsSyncState): Promise<void> {
        this.syncState = cloneSyncState(state);
    }

    async getAllFileCountEntries(): Promise<FileCountCacheEntry[]> {
        return Array.from(this.fileCountEntries.values()).map(cloneFileCountEntry);
    }

    async putFileCountEntries(entries: FileCountCacheEntry[]): Promise<void> {
        for (const entry of entries) {
            this.fileCountEntries.set(entry.path, cloneFileCountEntry(entry));
        }
    }

    async deleteFileCountEntries(paths: string[]): Promise<void> {
        for (const path of paths) {
            this.fileCountEntries.delete(path);
        }
    }

    async clearFileCountCache(): Promise<void> {
        this.fileCountEntries.clear();
    }
}

export class IndexedDbStatsLocalStore implements StatsLocalStore {
    private db: IDBDatabase | null = null;
    private initializing: Promise<void> | null = null;

    constructor(private readonly dbName: string, private readonly indexedDb: IDBFactory) { }

    async initialize(): Promise<void> {
        if (this.db) return;
        if (!this.initializing) {
            this.initializing = this.openDatabase()
                .then((db) => {
                    const missing = REQUIRED_STORES.filter((store) => !db.objectStoreNames.contains(store));
                    if (missing.length > 0) {
                        db.close();
                        throw new SchemaIntegrityError(missing);
                    }
                    this.db = db;
                })
                .catch((error) => {
                    this.initializing = null;
                    throw error;
                });
        }
        await this.initializing;
    }

    async getAllRecords(): Promise<StatsDailyDeviceRecord[]> {
        const store = this.getStore(DAILY_RECORDS_STORE, "readonly");
        return (await requestToPromise<StatsDailyDeviceRecord[]>(store.getAll())).map(cloneRecord);
    }

    async getRecord(date: string, deviceId: string): Promise<StatsDailyDeviceRecord | null> {
        const store = this.getStore(DAILY_RECORDS_STORE, "readonly");
        const record = await requestToPromise<StatsDailyDeviceRecord | undefined>(
            store.get(getStatsRecordKey(date, deviceId)),
        );
        return record ? cloneRecord(record) : null;
    }

    async upsertRecord(record: StatsDailyDeviceRecord): Promise<void> {
        const transaction = this.getTransaction(DAILY_RECORDS_STORE, "readwrite");
        transaction.objectStore(DAILY_RECORDS_STORE).put(cloneRecord(record));
        await transactionDone(transaction);
    }

    async addRecordIfAbsent(record: StatsDailyDeviceRecord): Promise<boolean> {
        const transaction = this.getTransaction(DAILY_RECORDS_STORE, "readwrite");
        let added = false;
        const request = transaction.objectStore(DAILY_RECORDS_STORE).add(cloneRecord(record));
        request.onsuccess = () => {
            added = true;
        };
        request.onerror = (event) => {
            if (request.error?.name === "ConstraintError") {
                event.preventDefault();
                event.stopPropagation();
                added = false;
            }
        };
        await transactionDone(transaction);
        return added;
    }

    private openDatabase(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = this.indexedDb.open(this.dbName, STATS_LOCAL_DB_VERSION);
            request.onupgradeneeded = (event) => {
                const db = request.result;
                const oldVersion = (event as IDBVersionChangeEvent).oldVersion ?? 0;
                try {
                    if (oldVersion < 2) {
                        if (!db.objectStoreNames.contains(DAILY_RECORDS_STORE)) {
                            db.createObjectStore(DAILY_RECORDS_STORE, { keyPath: "recordKey" });
                        }
                        if (!db.objectStoreNames.contains(METADATA_STORE)) {
                            db.createObjectStore(METADATA_STORE, { keyPath: "key" });
                        }
                    }
                    if (oldVersion < 3) {
                        if (!db.objectStoreNames.contains(FILE_COUNT_CACHE_STORE)) {
                            db.createObjectStore(FILE_COUNT_CACHE_STORE, { keyPath: "path" });
                        }
                    }
                } catch (error) {
                    // Do not throw — let onsuccess fire and let init-time integrity check
                    // detect the missing store and fall back to UnavailableStatsLocalStore.
                    // Throwing here would abort the upgrade transaction, which is acceptable,
                    // but logging + delegating to the init-time guard keeps a single recovery path.
                    // eslint-disable-next-line no-console
                    console.error("[stats-local-store] schema upgrade failed:", error);
                }
            };
            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => {
                    db.close();
                    if (this.db === db) {
                        this.db = null;
                        this.initializing = null;
                    }
                };
                resolve(db);
            };
            request.onerror = () => reject(request.error ?? new Error("Failed to open Statistics local store."));
            request.onblocked = () => reject(new Error("Statistics local store upgrade was blocked by another open connection."));
        });
    }

    private getStore(storeName: string, mode: IDBTransactionMode): IDBObjectStore {
        return this.getTransaction(storeName, mode).objectStore(storeName);
    }

    private getTransaction(storeName: string, mode: IDBTransactionMode): IDBTransaction {
        if (!this.db) {
            throw new Error("Statistics local store is not initialized.");
        }
        return this.db.transaction(storeName, mode);
    }

    async getMigrationMetadata(): Promise<StatsMigrationMetadata | null> {
        const store = this.getStore(METADATA_STORE, "readonly");
        const entry = await requestToPromise<{ key: string; value: StatsMigrationMetadata } | undefined>(
            store.get(MIGRATION_METADATA_KEY),
        );
        return entry ? { ...entry.value } : null;
    }

    async setMigrationMetadata(metadata: StatsMigrationMetadata): Promise<void> {
        const transaction = this.getTransaction(METADATA_STORE, "readwrite");
        transaction.objectStore(METADATA_STORE).put({
            key: MIGRATION_METADATA_KEY,
            value: { ...metadata },
        });
        await transactionDone(transaction);
    }

    async getSyncState(): Promise<StatsSyncState | null> {
        const store = this.getStore(METADATA_STORE, "readonly");
        const entry = await requestToPromise<{ key: string; value: StatsSyncState } | undefined>(
            store.get(SYNC_STATE_KEY),
        );
        return entry ? cloneSyncState(entry.value) : null;
    }

    async setSyncState(state: StatsSyncState): Promise<void> {
        const transaction = this.getTransaction(METADATA_STORE, "readwrite");
        transaction.objectStore(METADATA_STORE).put({
            key: SYNC_STATE_KEY,
            value: cloneSyncState(state),
        });
        await transactionDone(transaction);
    }

    async getAllFileCountEntries(): Promise<FileCountCacheEntry[]> {
        const store = this.getStore(FILE_COUNT_CACHE_STORE, "readonly");
        const entries = await requestToPromise<FileCountCacheEntry[]>(store.getAll());
        return entries.map(cloneFileCountEntry);
    }

    async putFileCountEntries(entries: FileCountCacheEntry[]): Promise<void> {
        if (entries.length === 0) return;
        const transaction = this.getTransaction(FILE_COUNT_CACHE_STORE, "readwrite");
        const objectStore = transaction.objectStore(FILE_COUNT_CACHE_STORE);
        for (const entry of entries) {
            objectStore.put(cloneFileCountEntry(entry));
        }
        await transactionDone(transaction);
    }

    async deleteFileCountEntries(paths: string[]): Promise<void> {
        if (paths.length === 0) return;
        const transaction = this.getTransaction(FILE_COUNT_CACHE_STORE, "readwrite");
        const objectStore = transaction.objectStore(FILE_COUNT_CACHE_STORE);
        for (const path of paths) {
            objectStore.delete(path);
        }
        await transactionDone(transaction);
    }

    async clearFileCountCache(): Promise<void> {
        const transaction = this.getTransaction(FILE_COUNT_CACHE_STORE, "readwrite");
        transaction.objectStore(FILE_COUNT_CACHE_STORE).clear();
        await transactionDone(transaction);
    }
}

export class UnavailableStatsLocalStore implements StatsLocalStore {
    private readonly error = new Error("Statistics history is unavailable because local app storage is not available.");

    async initialize(): Promise<void> {
        throw this.error;
    }

    async getAllRecords(): Promise<StatsDailyDeviceRecord[]> {
        throw this.error;
    }

    async getRecord(_date: string, _deviceId: string): Promise<StatsDailyDeviceRecord | null> {
        throw this.error;
    }

    async upsertRecord(_record: StatsDailyDeviceRecord): Promise<void> {
        throw this.error;
    }

    async addRecordIfAbsent(_record: StatsDailyDeviceRecord): Promise<boolean> {
        throw this.error;
    }

    async getMigrationMetadata(): Promise<StatsMigrationMetadata | null> {
        throw this.error;
    }

    async setMigrationMetadata(_metadata: StatsMigrationMetadata): Promise<void> {
        throw this.error;
    }

    async getSyncState(): Promise<StatsSyncState | null> {
        throw this.error;
    }

    async setSyncState(_state: StatsSyncState): Promise<void> {
        throw this.error;
    }

    async getAllFileCountEntries(): Promise<FileCountCacheEntry[]> {
        throw this.error;
    }

    async putFileCountEntries(_entries: FileCountCacheEntry[]): Promise<void> {
        throw this.error;
    }

    async deleteFileCountEntries(_paths: string[]): Promise<void> {
        throw this.error;
    }

    async clearFileCountCache(): Promise<void> {
        throw this.error;
    }
}

export function createStatsLocalStore(vault: Vault, vaultId: string): StatsLocalStore {
    const indexedDb = globalThis.indexedDB;
    if (!indexedDb) {
        return new UnavailableStatsLocalStore();
    }
    return new IndexedDbStatsLocalStore(getStatsLocalDbName(vault, vaultId), indexedDb);
}

export function getStatsRecordKey(date: string, deviceId: string): string {
    return `${date}\0${deviceId}`;
}

const REQUIRED_STORES = [DAILY_RECORDS_STORE, METADATA_STORE];

function getStatsLocalDbName(vault: Vault, vaultId: string): string {
    const scopeSource = `${vaultId}\n${getVaultConfigDir(vault)}\n${getVaultLocalPath(vault) ?? ""}`;
    return `${PLUGIN_STORAGE_SCOPE}-${hashScope(scopeSource)}`;
}

function getVaultConfigDir(vault: Vault): string {
    return (vault as { configDir?: string }).configDir?.trim() || ".obsidian";
}

function getVaultLocalPath(vault: Vault): string | undefined {
    const adapter = vault.adapter as {
        getBasePath?: () => string;
        getFullPath?: (path: string) => string;
    };
    try {
        if (typeof adapter.getBasePath === "function") {
            return adapter.getBasePath();
        }
        if (typeof adapter.getFullPath === "function") {
            return adapter.getFullPath("");
        }
    } catch {
        return undefined;
    }
    return undefined;
}

function cloneRecord(record: StatsDailyDeviceRecord): StatsDailyDeviceRecord {
    return {
        ...record,
        activity: { ...record.activity },
        snapshot: { ...record.snapshot },
    };
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

function cloneFileCountEntry(entry: FileCountCacheEntry): FileCountCacheEntry {
    return { ...entry };
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Statistics local store request failed."));
    });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("Statistics local store transaction failed."));
        transaction.onabort = () => reject(transaction.error ?? new Error("Statistics local store transaction aborted."));
    });
}

function hashScope(value: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}
