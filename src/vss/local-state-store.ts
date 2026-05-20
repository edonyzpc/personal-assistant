import { type Vault } from "obsidian";
import type { DirtyTimestamps } from "../vss-helpers";
import type { VSSIndexMarker } from "./types";

const VSS_LOCAL_STATE_DB_VERSION = 1;
const STATE_STORE = "state";
const MARKER_KEY = "marker";
const DIRTY_JOURNAL_KEY = "dirtyJournal";
const MIGRATION_METADATA_KEY = "migration";
const PLUGIN_STORAGE_SCOPE = "personal-assistant-vss-state";

export interface VSSLocalStateMigrationMetadata {
    version: 1;
    importedLegacyMarkerAt?: string;
    ignoredLegacyDirtyAt?: string;
    lastLegacyError?: string;
}

export interface VSSIndexStateStore {
    initialize(): Promise<void>;
    getMarker(): Promise<VSSIndexMarker | null>;
    setMarker(marker: VSSIndexMarker): Promise<void>;
    removeMarker(): Promise<void>;
    getDirtyJournal(): Promise<Map<string, DirtyTimestamps>>;
    setDirtyJournal(dirty: Map<string, DirtyTimestamps>): Promise<void>;
    clearDirtyJournal(): Promise<void>;
    getMigrationMetadata(): Promise<VSSLocalStateMigrationMetadata | null>;
    setMigrationMetadata(metadata: VSSLocalStateMigrationMetadata): Promise<void>;
    dispose(): Promise<void>;
}

export class MemoryVSSIndexStateStore implements VSSIndexStateStore {
    private marker: VSSIndexMarker | null = null;
    private dirtyJournal = new Map<string, DirtyTimestamps>();
    private migrationMetadata: VSSLocalStateMigrationMetadata | null = null;

    async initialize(): Promise<void> {
        // Memory store is ready immediately.
    }

    async getMarker(): Promise<VSSIndexMarker | null> {
        return this.marker ? { ...this.marker } : null;
    }

    async setMarker(marker: VSSIndexMarker): Promise<void> {
        this.marker = { ...marker };
    }

    async removeMarker(): Promise<void> {
        this.marker = null;
    }

    async getDirtyJournal(): Promise<Map<string, DirtyTimestamps>> {
        return cloneDirtyMap(this.dirtyJournal);
    }

    async setDirtyJournal(dirty: Map<string, DirtyTimestamps>): Promise<void> {
        this.dirtyJournal = cloneDirtyMap(dirty);
    }

    async clearDirtyJournal(): Promise<void> {
        this.dirtyJournal.clear();
    }

    async getMigrationMetadata(): Promise<VSSLocalStateMigrationMetadata | null> {
        return this.migrationMetadata ? { ...this.migrationMetadata } : null;
    }

    async setMigrationMetadata(metadata: VSSLocalStateMigrationMetadata): Promise<void> {
        this.migrationMetadata = { ...metadata };
    }

    async dispose(): Promise<void> {
        // Nothing to close.
    }
}

export class UnavailableVSSIndexStateStore implements VSSIndexStateStore {
    private readonly error = new Error("Memory local state is unavailable because local app storage is not available.");

    async initialize(): Promise<void> {
        throw this.error;
    }

    async getMarker(): Promise<VSSIndexMarker | null> {
        throw this.error;
    }

    async setMarker(_marker: VSSIndexMarker): Promise<void> {
        throw this.error;
    }

    async removeMarker(): Promise<void> {
        throw this.error;
    }

    async getDirtyJournal(): Promise<Map<string, DirtyTimestamps>> {
        throw this.error;
    }

    async setDirtyJournal(_dirty: Map<string, DirtyTimestamps>): Promise<void> {
        throw this.error;
    }

    async clearDirtyJournal(): Promise<void> {
        throw this.error;
    }

    async getMigrationMetadata(): Promise<VSSLocalStateMigrationMetadata | null> {
        throw this.error;
    }

    async setMigrationMetadata(_metadata: VSSLocalStateMigrationMetadata): Promise<void> {
        throw this.error;
    }

    async dispose(): Promise<void> {
        // Nothing to close.
    }
}

export class IndexedDbVSSIndexStateStore implements VSSIndexStateStore {
    private db: IDBDatabase | null = null;
    private initializing: Promise<void> | null = null;

    constructor(private readonly dbName: string, private readonly indexedDb: IDBFactory) { }

    async initialize(): Promise<void> {
        if (this.db) return;
        if (!this.initializing) {
            this.initializing = this.openDatabase()
                .then((db) => {
                    this.db = db;
                })
                .catch((error) => {
                    this.initializing = null;
                    throw error;
                });
        }
        await this.initializing;
    }

    async getMarker(): Promise<VSSIndexMarker | null> {
        const value = await this.getEntry<VSSIndexMarker>(MARKER_KEY);
        return value ? { ...value } : null;
    }

    async setMarker(marker: VSSIndexMarker): Promise<void> {
        await this.setEntry(MARKER_KEY, { ...marker });
    }

    async removeMarker(): Promise<void> {
        await this.removeEntry(MARKER_KEY);
    }

    async getDirtyJournal(): Promise<Map<string, DirtyTimestamps>> {
        const value = await this.getEntry<Record<string, Partial<DirtyTimestamps>>>(DIRTY_JOURNAL_KEY);
        return dirtyRecordToMap(value ?? {});
    }

    async setDirtyJournal(dirty: Map<string, DirtyTimestamps>): Promise<void> {
        await this.setEntry(DIRTY_JOURNAL_KEY, dirtyMapToRecord(dirty));
    }

    async clearDirtyJournal(): Promise<void> {
        await this.removeEntry(DIRTY_JOURNAL_KEY);
    }

    async getMigrationMetadata(): Promise<VSSLocalStateMigrationMetadata | null> {
        const value = await this.getEntry<VSSLocalStateMigrationMetadata>(MIGRATION_METADATA_KEY);
        return value ? { ...value } : null;
    }

    async setMigrationMetadata(metadata: VSSLocalStateMigrationMetadata): Promise<void> {
        await this.setEntry(MIGRATION_METADATA_KEY, { ...metadata });
    }

    async dispose(): Promise<void> {
        if (this.db) {
            this.db.close();
            this.db = null;
            this.initializing = null;
        }
    }

    private openDatabase(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = this.indexedDb.open(this.dbName, VSS_LOCAL_STATE_DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(STATE_STORE)) {
                    db.createObjectStore(STATE_STORE, { keyPath: "key" });
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
            request.onerror = () => reject(request.error ?? new Error("Memory local state store failed to open."));
            request.onblocked = () => reject(new Error("Memory local state store upgrade was blocked by another open connection."));
        });
    }

    private async getEntry<T>(key: string): Promise<T | null> {
        const store = this.getStore("readonly");
        const entry = await requestToPromise<{ key: string; value: T } | undefined>(store.get(key));
        return entry ? entry.value : null;
    }

    private async setEntry<T>(key: string, value: T): Promise<void> {
        const transaction = this.getTransaction("readwrite");
        transaction.objectStore(STATE_STORE).put({ key, value });
        await transactionDone(transaction);
    }

    private async removeEntry(key: string): Promise<void> {
        const transaction = this.getTransaction("readwrite");
        transaction.objectStore(STATE_STORE).delete(key);
        await transactionDone(transaction);
    }

    private getStore(mode: IDBTransactionMode): IDBObjectStore {
        return this.getTransaction(mode).objectStore(STATE_STORE);
    }

    private getTransaction(mode: IDBTransactionMode): IDBTransaction {
        if (!this.db) {
            throw new Error("Memory local state store is not initialized.");
        }
        return this.db.transaction(STATE_STORE, mode);
    }
}

export function createVSSIndexStateStore(vault: Vault, vaultId: string, pluginId: string): VSSIndexStateStore {
    const indexedDb = globalThis.indexedDB;
    if (!indexedDb) {
        return new UnavailableVSSIndexStateStore();
    }
    return new IndexedDbVSSIndexStateStore(getVSSLocalStateDbName(vault, vaultId, pluginId), indexedDb);
}

export function getVSSLocalStateDbName(vault: Vault, vaultId: string, pluginId: string): string {
    const scopeSource = [
        pluginId || "personal-assistant",
        vaultId || "default-vault",
        getVaultConfigDir(vault),
        getVaultLocalPath(vault) ?? "",
    ].join("\n");
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

function cloneDirtyMap(dirty: Map<string, DirtyTimestamps>): Map<string, DirtyTimestamps> {
    return new Map(Array.from(dirty, ([path, timestamps]) => [
        path,
        { ...timestamps },
    ]));
}

function dirtyRecordToMap(record: Record<string, Partial<DirtyTimestamps>>): Map<string, DirtyTimestamps> {
    const dirty = new Map<string, DirtyTimestamps>();
    for (const [path, value] of Object.entries(record)) {
        const first = typeof value.first === "number" ? value.first : undefined;
        const last = typeof value.last === "number" ? value.last : undefined;
        const epoch = typeof value.epoch === "number" ? value.epoch : undefined;
        if (first !== undefined && last !== undefined) {
            dirty.set(path, { first, last, epoch });
        }
    }
    return dirty;
}

function dirtyMapToRecord(dirty: Map<string, DirtyTimestamps>): Record<string, DirtyTimestamps> {
    return Object.fromEntries(Array.from(dirty, ([path, timestamps]) => [
        path,
        { first: timestamps.first, last: timestamps.last, epoch: timestamps.epoch },
    ]));
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Memory local state store request failed."));
    });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("Memory local state store transaction failed."));
        transaction.onabort = () => reject(transaction.error ?? new Error("Memory local state store transaction aborted."));
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
