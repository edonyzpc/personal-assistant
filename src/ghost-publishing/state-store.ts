import { getVaultConfigDirStorageScope } from "../obsidian-paths";
import { stableHash } from "../pa/helpers";
import { clearPlatformTimeout, getPlatformIndexedDB, setPlatformTimeout } from "../platform-dom";
import { GhostStateError, parsePreviewPointer, type GhostPreviewPointer } from "./state-schema";

const STORE_NAME = "previews";
const STORAGE_TIMEOUT = 10_000;

export function ghostDatabaseName(options: { pluginId: string; vaultId: string; configDir?: string; localPath: string }): string {
    if (!options.localPath) throw new GhostStateError("storage-unavailable");
    const scope = [options.pluginId, options.vaultId, getVaultConfigDirStorageScope(options), options.localPath].join("\n");
    return `personal-assistant-ghost-previews-v1-${stableHash(scope)}`;
}

/** Stores resource locations only. No candidate, operation, confirmation or history is persisted. */
export class GhostPreviewStore {
    private database?: IDBDatabase;
    private opening?: Promise<IDBDatabase>;
    private closed = false;

    constructor(private readonly options: { dbName: string; isDesktop: () => boolean; indexedDb?: IDBFactory }) {}

    private async open(): Promise<IDBDatabase> {
        if (!this.options.isDesktop()) throw new GhostStateError("desktop-required");
        if (this.closed) throw new GhostStateError("storage-unavailable");
        if (this.database) return this.database;
        if (this.opening) return this.opening;
        const factory = this.options.indexedDb ?? getPlatformIndexedDB();
        if (!factory) throw new GhostStateError("storage-unavailable");
        this.opening = new Promise<IDBDatabase>((resolve, reject) => {
            let settled = false;
            const finishError = () => {
                if (settled) return;
                settled = true;
                clearPlatformTimeout(timer);
                reject(new GhostStateError("storage-unavailable"));
            };
            const timer = setPlatformTimeout(finishError, STORAGE_TIMEOUT);
            let request: IDBOpenDBRequest;
            try { request = factory.open(this.options.dbName, 1); }
            catch { finishError(); return; }
            request.onupgradeneeded = (event) => {
                if (settled || this.closed || event.oldVersion !== 0) { request.transaction?.abort(); return; }
                request.result.createObjectStore(STORE_NAME);
            };
            request.onerror = finishError;
            request.onblocked = finishError;
            request.onsuccess = () => {
                const database = request.result;
                if (settled || this.closed || !database.objectStoreNames.contains(STORE_NAME)) {
                    database.close(); finishError(); return;
                }
                settled = true;
                clearPlatformTimeout(timer);
                database.onversionchange = () => { database.close(); this.database = undefined; };
                this.database = database;
                resolve(database);
            };
        });
        try { return await this.opening; }
        finally { this.opening = undefined; }
    }

    private async transact<T>(
        mode: IDBTransactionMode,
        action: (store: IDBObjectStore, result: (value: T) => void, fail: (error: unknown) => void) => void,
    ): Promise<T> {
        const database = await this.open();
        if (this.closed || !this.options.isDesktop()) throw new GhostStateError("storage-unavailable");
        return new Promise<T>((resolve, reject) => {
            let transaction: IDBTransaction;
            try { transaction = database.transaction(STORE_NAME, mode); }
            catch { reject(new GhostStateError("storage-unavailable")); return; }
            let value: T;
            let settled = false;
            const fail = (error: unknown) => {
                if (settled) return;
                settled = true;
                clearPlatformTimeout(timer);
                try { transaction.abort(); } catch { /* Already completed or aborted. */ }
                reject(error instanceof GhostStateError ? error : new GhostStateError("storage-unavailable"));
            };
            const timer = setPlatformTimeout(() => fail(new GhostStateError("storage-unavailable")), STORAGE_TIMEOUT);
            transaction.onerror = () => fail(new GhostStateError("storage-unavailable"));
            transaction.onabort = () => fail(new GhostStateError("storage-unavailable"));
            transaction.oncomplete = () => {
                if (settled) return;
                settled = true;
                clearPlatformTimeout(timer);
                resolve(value);
            };
            try { action(transaction.objectStore(STORE_NAME), (result) => { value = result; }, fail); }
            catch (error) { fail(error); }
        });
    }


    async read(siteId: string, postId: string): Promise<GhostPreviewPointer | undefined> {
        return this.transact("readonly", (store, result, fail) => {
            const request = store.get(`${siteId}/${postId}`);
            request.onsuccess = () => {
                try {
                    if (request.result === undefined) return result(undefined);
                    const pointer = parsePreviewPointer(request.result);
                    if (pointer.siteId !== siteId || pointer.postId !== postId) throw new GhostStateError("invalid-state");
                    result(pointer);
                } catch (error) { fail(error); }
            };
            request.onerror = () => fail(new GhostStateError("storage-unavailable"));
        });
    }

    async write(input: GhostPreviewPointer): Promise<void> {
        const pointer = parsePreviewPointer(input);
        return this.transact("readwrite", (store, result, fail) => {
            const request = store.put(pointer, `${pointer.siteId}/${pointer.postId}`);
            request.onsuccess = () => result(undefined);
            request.onerror = () => fail(new GhostStateError("storage-unavailable"));
        });
    }

    async remove(siteId: string, postId: string): Promise<void> {
        return this.transact("readwrite", (store, result, fail) => {
            const request = store.delete(`${siteId}/${postId}`);
            request.onsuccess = () => result(undefined);
            request.onerror = () => fail(new GhostStateError("storage-unavailable"));
        });
    }

    close(): void {
        this.closed = true;
        this.database?.close();
        this.database = undefined;
    }
}
