import type { Vault } from "obsidian";
import { getVaultConfigDirStorageScope } from "../../obsidian-paths";
import {
    clearPlatformTimeout,
    getPlatformIndexedDB,
    setPlatformTimeout,
} from "../../platform-dom";
import type { UserProfileRecord, UserProfileSnapshot } from "./type-a-extractor";
import { cloneChatMemoryCandidateEvidence } from "../../pa/chat-memory-admission";

const USER_PROFILE_DB_VERSION = 1;
const PROFILE_STORE = "profile";
const PROFILE_KEY = "latest";
const PLUGIN_STORAGE_SCOPE = "personal-assistant-user-profile-v1";
const GOVERNED_PROFILE_STORAGE_SCOPE = "personal-assistant-governed-user-profile-v1";

const IDB_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setPlatformTimeout(() => reject(new Error(`IndexedDB ${label} timed out after ${ms}ms`)), ms);
        promise.then(
            (value) => { clearPlatformTimeout(timer); resolve(value); },
            (error) => { clearPlatformTimeout(timer); reject(error); },
        );
    });
}

export type ProfileWriteGuard = (() => void) & { signal?: AbortSignal };

export function assertProfileWriteCurrent(guard?: ProfileWriteGuard): void {
    if (guard?.signal?.aborted) throw new Error("Profile write source is no longer current.");
    guard?.();
    if (guard?.signal?.aborted) throw new Error("Profile write source is no longer current.");
}

export interface UserProfileStore {
    initialize(): Promise<void>;
    getProfile(): Promise<UserProfileSnapshot | null>;
    setProfile(snapshot: UserProfileSnapshot, guard?: ProfileWriteGuard): Promise<void>;
    dispose(): Promise<void>;
}

export type UserProfileReadResult =
    | { state: "not_present" | "unknown" | "blocked" | "unavailable" }
    | { state: "ready"; snapshot: UserProfileSnapshot | null }
    | { state: "error"; errorCode: string };

export interface ExistingUserProfileReader {
    read(): Promise<UserProfileReadResult>;
    acquireReadLease?(options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<ExistingUserProfileReadLease>;
}

/** A short read lock for an already existing Profile DB. It never creates or repairs storage. */
export interface ExistingUserProfileReadLease {
    result: UserProfileReadResult;
    /** Aborts if the held source becomes unavailable before the guarded commit completes. */
    signal?: AbortSignal;
    isCurrent(): boolean;
    release(): void;
}

export class MemoryUserProfileStore implements UserProfileStore {
    private snapshot: UserProfileSnapshot | null = null;

    async initialize(): Promise<void> {
        // Memory store is ready immediately.
    }

    async getProfile(): Promise<UserProfileSnapshot | null> {
        return this.snapshot ? cloneSnapshot(this.snapshot) : null;
    }

    async setProfile(snapshot: UserProfileSnapshot, guard?: ProfileWriteGuard): Promise<void> {
        assertProfileWriteCurrent(guard);
        const next = cloneSnapshot(snapshot);
        assertProfileWriteCurrent(guard);
        this.snapshot = next;
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

    async setProfile(snapshot: UserProfileSnapshot, guard?: ProfileWriteGuard): Promise<void> {
        assertProfileWriteCurrent(guard);
        const transaction = this.getTransaction("readwrite");
        const completion = transactionDone(transaction);
        const abort = () => {
            try { transaction.abort(); } catch { /* The transaction has already finished. */ }
        };
        guard?.signal?.addEventListener("abort", abort, { once: true });
        try {
            const value = cloneSnapshot(snapshot);
            assertProfileWriteCurrent(guard);
            transaction.objectStore(PROFILE_STORE).put({ key: PROFILE_KEY, value });
            await completion;
            assertProfileWriteCurrent(guard);
        } catch (error) {
            abort();
            await completion.catch(() => undefined);
            throw error;
        } finally {
            guard?.signal?.removeEventListener("abort", abort);
        }
    }

    async dispose(): Promise<void> {
        if (this.db) {
            this.db.close();
            this.db = null;
            this.initializing = null;
        }
    }

    private openDatabase(): Promise<IDBDatabase> {
        return withTimeout(
            new Promise<IDBDatabase>((resolve, reject) => {
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
            }),
            IDB_TIMEOUT_MS,
            "open",
        );
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

type ExistingDatabaseOpenResult =
    | { state: "opened"; db: IDBDatabase }
    | { state: "unknown" | "blocked" }
    | { state: "error"; errorCode: string };

export class IndexedDbExistingUserProfileReader implements ExistingUserProfileReader {
    constructor(private readonly dbName: string, private readonly indexedDb: IDBFactory) {}

    async acquireReadLease(options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<ExistingUserProfileReadLease> {
        const inactive = (result: UserProfileReadResult): ExistingUserProfileReadLease => ({
            result, isCurrent: () => false, release: () => undefined,
        });
        if (options.signal?.aborted) return inactive({ state: "blocked" });
        // Enumerate first: opening an absent database would itself create storage.
        let infos: IDBDatabaseInfo[];
        try {
            if (typeof this.indexedDb.databases !== "function") return inactive({ state: "unavailable" });
            infos = await withTimeout(this.indexedDb.databases(), IDB_TIMEOUT_MS, "database enumeration");
        } catch { return inactive({ state: "unknown" }); }
        if (!Array.isArray(infos)) return inactive({ state: "unknown" });
        if (!infos.some((info) => info.name === this.dbName)) return inactive({ state: "not_present" });
        const opened = await openExistingDatabase(this.indexedDb, this.dbName);
        if (opened.state !== "opened") return inactive(opened);
        const db = opened.db;
        if (options.signal?.aborted || !db.objectStoreNames.contains(PROFILE_STORE)) {
            db.close();
            return inactive({ state: "blocked" });
        }
        return new Promise<ExistingUserProfileReadLease>((resolve) => {
            const invalidated = new AbortController();
            let active = true;
            let settled = false;
            let transaction: IDBTransaction;
            let timer: ReturnType<typeof setPlatformTimeout> | undefined;
            const release = (): void => {
                if (!active) return;
                active = false;
                invalidated.abort();
                if (timer !== undefined) clearPlatformTimeout(timer);
                options.signal?.removeEventListener("abort", release);
                try { transaction?.abort(); } catch { /* Already completed. */ }
                db.close();
                if (!settled) { settled = true; resolve(inactive({ state: "blocked" })); }
            };
            try {
                transaction = db.transaction(PROFILE_STORE, "readonly");
                const store = transaction.objectStore(PROFILE_STORE);
                transaction.onabort = release;
                transaction.onerror = release;
                transaction.oncomplete = release;
                db.onversionchange = release;
                options.signal?.addEventListener("abort", release, { once: true });
                timer = setPlatformTimeout(release, Math.min(2500, Math.max(1, options.timeoutMs ?? 2500)));
                // A readonly IDB transaction otherwise auto-commits while awaiting a
                // different database. Keep one content-free request pending, only
                // for this bounded final commit window; queued old writers wait.
                const keepAlive = (): void => {
                    if (!active) return;
                    try { store.count().onsuccess = keepAlive; } catch { release(); }
                };
                const request = store.get(PROFILE_KEY);
                request.onsuccess = () => {
                    if (!active) return;
                    try {
                        const entry = request.result as { value: UserProfileSnapshot } | undefined;
                        const result: UserProfileReadResult = { state: "ready", snapshot: entry ? cloneSnapshot(entry.value) : null };
                        keepAlive();
                        settled = true;
                        resolve({ result, signal: invalidated.signal, isCurrent: () => active && !options.signal?.aborted, release });
                    } catch { release(); }
                };
                request.onerror = release;
            } catch { release(); }
        });
    }

    async read(): Promise<UserProfileReadResult> {
        let databases: IDBFactory["databases"];
        try {
            databases = this.indexedDb.databases;
        } catch {
            return { state: "unknown" };
        }
        if (typeof databases !== "function") {
            return { state: "unavailable" };
        }

        let databaseInfos: IDBDatabaseInfo[];
        try {
            databaseInfos = await withTimeout(
                Promise.resolve().then(() => databases.call(this.indexedDb)),
                IDB_TIMEOUT_MS,
                "database enumeration",
            );
        } catch {
            return { state: "unknown" };
        }
        if (!Array.isArray(databaseInfos)) {
            return { state: "unknown" };
        }
        if (!databaseInfos.some((info) => info.name === this.dbName)) {
            return { state: "not_present" };
        }

        const opened = await openExistingDatabase(this.indexedDb, this.dbName);
        if (opened.state !== "opened") return opened;

        const db = opened.db;
        try {
            if (!db.objectStoreNames.contains(PROFILE_STORE)) {
                return { state: "error", errorCode: "profile_store_missing" };
            }
            const transaction = db.transaction(PROFILE_STORE, "readonly");
            const entryRequest = transaction.objectStore(PROFILE_STORE).get(PROFILE_KEY);
            const [entry] = await Promise.all([
                requestToPromise<{ key: string; value: UserProfileSnapshot } | undefined>(entryRequest),
                transactionDone(transaction),
            ]);
            return {
                state: "ready",
                snapshot: entry ? cloneSnapshot(entry.value) : null,
            };
        } catch {
            return { state: "error", errorCode: "profile_read_failed" };
        } finally {
            db.close();
        }
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

export function createExistingUserProfileReader(
    vault: Vault,
    vaultId: string,
    pluginId: string,
): ExistingUserProfileReader {
    const indexedDb = getPlatformIndexedDB();
    if (!indexedDb) {
        return {
            read: async () => ({ state: "unavailable" }),
        };
    }
    return new IndexedDbExistingUserProfileReader(
        getUserProfileDbName(vault, vaultId, pluginId),
        indexedDb,
    );
}

/** Governed projections never share a database with the legacy compatibility Profile. */
export function createGovernedUserProfileStore(vault: Vault, vaultId: string, pluginId: string): UserProfileStore {
    const indexedDb = getPlatformIndexedDB();
    if (!indexedDb) return new MemoryUserProfileStore();
    return new IndexedDbUserProfileStore(getGovernedUserProfileDbName(vault, vaultId, pluginId), indexedDb);
}

export function createExistingGovernedUserProfileReader(
    vault: Vault,
    vaultId: string,
    pluginId: string,
): ExistingUserProfileReader {
    const indexedDb = getPlatformIndexedDB();
    if (!indexedDb) return { read: async () => ({ state: "unavailable" }) };
    return new IndexedDbExistingUserProfileReader(getGovernedUserProfileDbName(vault, vaultId, pluginId), indexedDb);
}

export function getGovernedUserProfileDbName(vault: Vault, vaultId: string, pluginId: string): string {
    return `${GOVERNED_PROFILE_STORAGE_SCOPE}-${getProfileScopeHash(vault, vaultId, pluginId)}`;
}

export function getUserProfileDbName(vault: Vault, vaultId: string, pluginId: string): string {
    return `${PLUGIN_STORAGE_SCOPE}-${getProfileScopeHash(vault, vaultId, pluginId)}`;
}

function getProfileScopeHash(vault: Vault, vaultId: string, pluginId: string): string {
    const scopeSource = [
        pluginId || "personal-assistant",
        vaultId || "default-vault",
        getVaultConfigDirStorageScope(vault),
        getVaultLocalPath(vault) ?? "",
    ].join("\n");
    return hashScope(scopeSource);
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
        ...(record.chatEvidence ? { chatEvidence: cloneChatMemoryCandidateEvidence(record.chatEvidence) } : {}),
        conversationIds: [...record.conversationIds],
    };
}

function openExistingDatabase(indexedDb: IDBFactory, dbName: string): Promise<ExistingDatabaseOpenResult> {
    return new Promise<ExistingDatabaseOpenResult>((resolve) => {
        let request: IDBOpenDBRequest;
        try {
            request = indexedDb.open(dbName);
        } catch {
            resolve({ state: "error", errorCode: "profile_db_open_failed" });
            return;
        }

        let settled = false;
        let timer: ReturnType<typeof setPlatformTimeout> | null = null;

        const finish = (result: ExistingDatabaseOpenResult): void => {
            if (settled) {
                if (result.state === "opened") result.db.close();
                return;
            }
            settled = true;
            if (timer !== null) clearPlatformTimeout(timer);
            resolve(result);
        };

        timer = setPlatformTimeout(() => {
            finish({ state: "error", errorCode: "profile_db_open_timeout" });
        }, IDB_TIMEOUT_MS);

        request.onupgradeneeded = () => {
            try {
                request.transaction?.abort();
            } catch {
                // The request still resolves to a non-ready state below.
            }
            closeOpenRequestResult(request);
            finish({ state: "unknown" });
        };
        request.onsuccess = () => finish({ state: "opened", db: request.result });
        request.onerror = () => {
            closeOpenRequestResult(request);
            finish({ state: "error", errorCode: "profile_db_open_failed" });
        };
        request.onblocked = () => {
            closeOpenRequestResult(request);
            finish({ state: "blocked" });
        };
    });
}

function closeOpenRequestResult(request: IDBOpenDBRequest): void {
    try {
        request.result.close();
    } catch {
        // A blocked or failed request may not expose a database result.
    }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return withTimeout(
        new Promise<T>((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
        }),
        IDB_TIMEOUT_MS,
        "request",
    );
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
    return withTimeout(
        new Promise<void>((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
            transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
        }),
        IDB_TIMEOUT_MS,
        "transaction",
    );
}

function hashScope(value: string): string {
    let hash = 5381;
    for (let i = 0; i < value.length; i++) {
        hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
    }
    return (hash >>> 0).toString(36);
}
