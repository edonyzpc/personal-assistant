import type { Vault } from "obsidian";
import { getVaultConfigDirStorageScope } from "../../obsidian-paths";
import { getPlatformIndexedDB } from "../../platform-dom";
import type { UserProfileRecord, UserProfileSnapshot } from "./type-a-extractor";

const USER_PROFILE_DB_VERSION = 1;
const PROFILE_STORE = "profile";
const PROFILE_KEY = "latest";
const PLUGIN_STORAGE_SCOPE = "personal-assistant-user-profile-v1";

export interface UserProfileStore {
    initialize(): Promise<void>;
    getProfile(): Promise<UserProfileSnapshot | null>;
    setProfile(snapshot: UserProfileSnapshot): Promise<void>;
    dispose(): Promise<void>;
}

export class MemoryUserProfileStore implements UserProfileStore {
    private snapshot: UserProfileSnapshot | null = null;

    async initialize(): Promise<void> {
        // Memory store is ready immediately.
    }

    async getProfile(): Promise<UserProfileSnapshot | null> {
        return this.snapshot ? cloneSnapshot(this.snapshot) : null;
    }

    async setProfile(snapshot: UserProfileSnapshot): Promise<void> {
        this.snapshot = cloneSnapshot(snapshot);
    }

    async dispose(): Promise<void> {
        // Nothing to close.
    }
}

export class IndexedDbUserProfileStore implements UserProfileStore {
    private db: IDBDatabase | null = null;
    private initializing: Promise<void> | null = null;

    constructor(private readonly dbName: string, private readonly indexedDb: IDBFactory) {}

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

    async getProfile(): Promise<UserProfileSnapshot | null> {
        const store = this.getStore("readonly");
        const entry = await requestToPromise<{ key: string; value: UserProfileSnapshot } | undefined>(
            store.get(PROFILE_KEY),
        );
        return entry ? cloneSnapshot(entry.value) : null;
    }

    async setProfile(snapshot: UserProfileSnapshot): Promise<void> {
        const transaction = this.getTransaction("readwrite");
        transaction.objectStore(PROFILE_STORE).put({
            key: PROFILE_KEY,
            value: cloneSnapshot(snapshot),
        });
        await transactionDone(transaction);
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
            const request = this.indexedDb.open(this.dbName, USER_PROFILE_DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(PROFILE_STORE)) {
                    db.createObjectStore(PROFILE_STORE, { keyPath: "key" });
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
            request.onerror = () => reject(request.error ?? new Error("User profile store failed to open."));
            request.onblocked = () =>
                reject(new Error("User profile store upgrade was blocked by another open connection."));
        });
    }

    private getStore(mode: IDBTransactionMode): IDBObjectStore {
        return this.getTransaction(mode).objectStore(PROFILE_STORE);
    }

    private getTransaction(mode: IDBTransactionMode): IDBTransaction {
        if (!this.db) {
            throw new Error("User profile store is not initialized.");
        }
        return this.db.transaction(PROFILE_STORE, mode);
    }
}

export function createUserProfileStore(
    vault: Vault,
    vaultId: string,
    pluginId: string,
): UserProfileStore {
    const indexedDb = getPlatformIndexedDB();
    if (!indexedDb) {
        return new MemoryUserProfileStore();
    }
    return new IndexedDbUserProfileStore(getUserProfileDbName(vault, vaultId, pluginId), indexedDb);
}

export function getUserProfileDbName(vault: Vault, vaultId: string, pluginId: string): string {
    const scopeSource = [
        pluginId || "personal-assistant",
        vaultId || "default-vault",
        getVaultConfigDirStorageScope(vault),
        getVaultLocalPath(vault) ?? "",
    ].join("\n");
    return `${PLUGIN_STORAGE_SCOPE}-${hashScope(scopeSource)}`;
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

function cloneSnapshot(snapshot: UserProfileSnapshot): UserProfileSnapshot {
    return {
        updatedAt: snapshot.updatedAt,
        markdown: snapshot.markdown,
        records: snapshot.records.map(cloneRecord),
    };
}

function cloneRecord(record: UserProfileRecord): UserProfileRecord {
    return {
        ...record,
        conversationIds: [...record.conversationIds],
    };
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
    });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
        transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    });
}

function hashScope(value: string): string {
    let hash = 5381;
    for (let i = 0; i < value.length; i++) {
        hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
    }
    return (hash >>> 0).toString(36);
}
