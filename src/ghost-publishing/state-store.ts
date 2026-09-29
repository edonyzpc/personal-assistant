import { getVaultConfigDirStorageScope } from "../obsidian-paths";
import { stableHash } from "../pa/helpers";
import { clearPlatformTimeout, getPlatformIndexedDB, setPlatformTimeout } from "../platform-dom";
import {
    decodeCompletedRecord, encodeCompletedRecord, ghostOperationKey, ghostRecordPath,
    GhostStateError, isGhostPublicationActive, parseCompletedRecord, parseLocalOperation,
    type GhostCompletedRecord, type GhostLocalOperation,
} from "./state-schema";

const STORE_NAME = "operations";
const STORAGE_TIMEOUT = 10_000;

export function ghostDatabaseName(options: { pluginId: string; vaultId: string; configDir?: string; localPath: string }): string {
    if (!options.localPath) throw new GhostStateError("storage-unavailable");
    const scope = [options.pluginId, options.vaultId, getVaultConfigDirStorageScope(options), options.localPath].join("\n");
    return `personal-assistant-ghost-publishing-v1-${stableHash(scope)}`;
}

export class GhostOperationStore {
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

    async list(siteId: string, noteUid: string): Promise<GhostLocalOperation[]> {
        return this.transact("readonly", (store, result, fail) => {
            const request = store.getAll();
            request.onsuccess = () => {
                try {
                    result(request.result.map(parseLocalOperation).filter((operation) => operation.siteId === siteId && operation.noteUid === noteUid));
                } catch (error) { fail(error); }
            };
            request.onerror = () => fail(new GhostStateError("storage-unavailable"));
        });
    }

    async save(input: GhostLocalOperation, expectedRevision: number): Promise<void> {
        const operation = parseLocalOperation(input);
        if (operation.revision !== expectedRevision + 1) throw new GhostStateError("operation-conflict");
        return this.transact("readwrite", (store, result, fail) => {
            const request = store.getAll();
            request.onsuccess = () => {
                try {
                    const previous = request.result.map(parseLocalOperation)
                        .filter((entry) => entry.siteId === operation.siteId && entry.noteUid === operation.noteUid);
                    const current = previous.find((entry) => entry.operationId === operation.operationId);
                    if ((current?.revision ?? 0) !== expectedRevision
                        || isGhostPublicationActive(operation) && previous.some((entry) => entry.operationId !== operation.operationId && isGhostPublicationActive(entry))) {
                        throw new GhostStateError("operation-conflict");
                    }
                    for (const entry of previous) {
                        // A retained or pending cleanup still identifies an old preview as ours.
                        // Ordinary completed operations can be discarded when the next one starts.
                        if (entry.operationId !== operation.operationId && entry.state === "terminal" && !entry.cleanup) {
                            store.delete(ghostOperationKey(entry));
                        }
                    }
                    store.put(operation, ghostOperationKey(operation));
                    result(undefined);
                } catch (error) { fail(error); }
            };
            request.onerror = () => fail(new GhostStateError("storage-unavailable"));
        });
    }

    close(): void {
        this.closed = true;
        this.database?.close();
        this.database = undefined;
    }
}

function isMissing(error: unknown): boolean {
    return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

// Only serialize local record writes. This is not a vault-sync or device lock.
const recordWrites = new Map<string, Promise<unknown>>();

export class GhostCompletedRecordStore {
    constructor(private readonly options: { vaultPath: string; isDesktop: () => boolean }) {}

    private async file(siteId: string, noteUid: string) {
        if (!this.options.isDesktop()) throw new GhostStateError("desktop-required");
        const relative = ghostRecordPath(siteId, noteUid);
        // Obsidian's desktop renderer provides Node builtins through require rather than node: dynamic import.
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- Never loaded by the mobile runtime.
        const fs: typeof import("node:fs/promises") = require("node:fs/promises");
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- Never loaded by the mobile runtime.
        const path: typeof import("node:path") = require("node:path");
        if (!this.options.isDesktop()) throw new GhostStateError("desktop-required");
        const root = await fs.realpath(this.options.vaultPath);
        return { fs, path, root, target: path.join(root, relative) };
    }

    async read(siteId: string, noteUid: string): Promise<GhostCompletedRecord | null> {
        const { fs, path, root, target } = await this.file(siteId, noteUid);
        try {
            const parent = await fs.realpath(path.dirname(target));
            if (!parent.startsWith(`${root}${path.sep}`)) throw new GhostStateError("record-conflict");
            const stat = await fs.lstat(target);
            if (!stat.isFile() || stat.isSymbolicLink()) throw new GhostStateError("record-conflict");
            return decodeCompletedRecord(await fs.readFile(target, "utf8"), siteId, noteUid);
        } catch (error) {
            if (isMissing(error)) return null;
            if (error instanceof GhostStateError) throw error;
            throw new GhostStateError("storage-unavailable");
        }
    }

    async write(input: GhostCompletedRecord, expectedChecksum: string | null): Promise<void> {
        const record = parseCompletedRecord(input);
        const { siteId, noteUid } = record.binding;
        const files = await this.file(siteId, noteUid);
        const previous = recordWrites.get(files.target) ?? Promise.resolve();
        const current = previous.catch(() => undefined).then(() => this.writeAtomic(record, expectedChecksum, files));
        recordWrites.set(files.target, current);
        try { await current; }
        finally { if (recordWrites.get(files.target) === current) recordWrites.delete(files.target); }
    }

    private async writeAtomic(
        record: GhostCompletedRecord,
        expectedChecksum: string | null,
        { fs, path, root, target }: Awaited<ReturnType<GhostCompletedRecordStore["file"]>>,
    ): Promise<void> {
        const { siteId, noteUid } = record.binding;
        const directory = path.dirname(target);
        let temporary: string | undefined;
        try {
            const old = await this.read(siteId, noteUid);
            if ((old?.checksum ?? null) !== expectedChecksum || record.revision !== (old?.revision ?? 0) + 1
                || (old && (old.binding.postId !== record.binding.postId || old.binding.site !== record.binding.site))) {
                throw new GhostStateError("record-conflict");
            }
            let parent = root;
            for (const segment of path.relative(root, directory).split(path.sep)) {
                parent = path.join(parent, segment);
                try { await fs.mkdir(parent); }
                catch (error) { if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error; }
                const stat = await fs.lstat(parent);
                if (!stat.isDirectory() || stat.isSymbolicLink()) throw new GhostStateError("record-conflict");
            }
            if (!this.options.isDesktop()) throw new GhostStateError("desktop-required");
            // eslint-disable-next-line @typescript-eslint/no-require-imports -- Never loaded by the mobile runtime.
            const { randomUUID }: typeof import("node:crypto") = require("node:crypto");
            temporary = path.join(directory, `.${noteUid}.${randomUUID()}.tmp`);
            const handle = await fs.open(temporary, "wx", 0o600);
            try { await handle.writeFile(encodeCompletedRecord(record), "utf8"); await handle.sync(); }
            finally { await handle.close(); }
            const latest = await this.read(siteId, noteUid);
            if ((latest?.checksum ?? null) !== expectedChecksum) throw new GhostStateError("record-conflict");
            if (!this.options.isDesktop()) throw new GhostStateError("desktop-required");
            if (old === null) await fs.link(temporary, target); // Atomic creation must not replace an occupied path.
            else await fs.rename(temporary, target);
        } catch (error) {
            if (error instanceof GhostStateError) throw error;
            if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") throw new GhostStateError("record-conflict");
            throw new GhostStateError("storage-unavailable");
        } finally {
            if (temporary) await fs.unlink(temporary).catch(() => undefined);
        }
    }
}
