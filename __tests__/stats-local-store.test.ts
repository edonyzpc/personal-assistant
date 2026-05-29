import { describe, expect, it } from "@jest/globals";
import {
    createStatsLocalStore,
    IndexedDbStatsLocalStore,
    MemoryStatsLocalStore,
    getStatsRecordKey,
    type FileCountCacheEntry,
    type StatsDailyDeviceRecord,
} from "../src/stats/stats-local-store";

function createRecord(overrides: Partial<StatsDailyDeviceRecord> = {}): StatsDailyDeviceRecord {
    const date = overrides.date ?? "2026-05-19";
    const deviceId = overrides.deviceId ?? "device-a";
    return {
        version: 3,
        vaultId: "vault-id",
        recordKey: getStatsRecordKey(date, deviceId),
        date,
        deviceId,
        revision: 1,
        updatedAt: "2026-05-19T00:00:00.000Z",
        activity: { words: 1, characters: 5, sentences: 1, pages: 0.1, footnotes: 0, citations: 0 },
        snapshot: {
            totalWords: 10,
            totalCharacters: 50,
            totalSentences: 5,
            totalFootnotes: 0,
            totalCitations: 0,
            totalPages: 1,
            files: 2,
        },
        ...overrides,
    };
}

describe("StatsLocalStore", () => {
    it("keeps memory records cloned by date and device", async () => {
        const store = new MemoryStatsLocalStore();
        const record = createRecord();

        await store.initialize();
        await store.upsertRecord(record);
        record.activity.words = 99;

        const stored = await store.getRecord("2026-05-19", "device-a");
        expect(stored?.activity.words).toBe(1);

        if (stored) stored.activity.words = 42;
        const allRecords = await store.getAllRecords();
        expect(allRecords).toHaveLength(1);
        expect(allRecords[0].activity.words).toBe(1);

        await expect(store.addRecordIfAbsent(createRecord())).resolves.toBe(false);
        await expect(store.addRecordIfAbsent(createRecord({
            date: "2026-05-20",
            recordKey: getStatsRecordKey("2026-05-20", "device-a"),
        }))).resolves.toBe(true);
    });

    it("opens IndexedDB, upserts, and reads through the wrapper", async () => {
        const fakeIndexedDb = new FakeIndexedDbFactory({ hasStore: false });
        const store = new IndexedDbStatsLocalStore("stats-test-db", fakeIndexedDb as unknown as IDBFactory);
        const first = createRecord();
        const second = createRecord({
            date: "2026-05-20",
            revision: 2,
            recordKey: getStatsRecordKey("2026-05-20", "device-a"),
        });

        await store.initialize();
        await store.upsertRecord(first);
        await store.upsertRecord(second);

        const stored = await store.getRecord("2026-05-20", "device-a");
        expect(stored?.revision).toBe(2);
        expect((await store.getAllRecords()).map((record) => record.date).sort()).toEqual([
            "2026-05-19",
            "2026-05-20",
        ]);
        expect(fakeIndexedDb.openCalls).toBe(1);
        expect(fakeIndexedDb.db.createObjectStoreCalls).toBe(3);
    });

    it("adds IndexedDB records only when absent", async () => {
        const fakeIndexedDb = new FakeIndexedDbFactory();
        const store = new IndexedDbStatsLocalStore("stats-test-db", fakeIndexedDb as unknown as IDBFactory);
        const record = createRecord();

        await store.initialize();

        await expect(store.addRecordIfAbsent(record)).resolves.toBe(true);
        await expect(store.addRecordIfAbsent({
            ...record,
            revision: 2,
            activity: { ...record.activity, words: 99 },
        })).resolves.toBe(false);

        const stored = await store.getRecord(record.date, record.deviceId);
        expect(stored?.revision).toBe(1);
        expect(stored?.activity.words).toBe(1);
    });

    it("stores migration metadata in IndexedDB", async () => {
        const fakeIndexedDb = new FakeIndexedDbFactory();
        const store = new IndexedDbStatsLocalStore("stats-test-db", fakeIndexedDb as unknown as IDBFactory);

        await store.initialize();
        await store.setMigrationMetadata({
            version: 1,
            v2ImportFingerprint: "fingerprint",
            validShardCount: 2,
            corruptShardCount: 0,
            importedRecordKeyCount: 2,
            aggregateHash: "aggregate",
            cleanupStatus: "not-started",
            importedAt: "2026-05-19T00:00:00.000Z",
        });

        await expect(store.getMigrationMetadata()).resolves.toEqual(expect.objectContaining({
            v2ImportFingerprint: "fingerprint",
            importedRecordKeyCount: 2,
            cleanupStatus: "not-started",
        }));
    });

    it("stores sync checkpoint state in IndexedDB", async () => {
        const fakeIndexedDb = new FakeIndexedDbFactory();
        const store = new IndexedDbStatsLocalStore("stats-test-db", fakeIndexedDb as unknown as IDBFactory);

        await store.initialize();
        await store.setSyncState({
            version: 1,
            records: {
                "2026-05-19\u0000device-a": {
                    revision: 2,
                    hash: "hash",
                    exportedAt: "2026-05-19T00:00:00.000Z",
                },
            },
        });

        const state = await store.getSyncState();
        expect(state?.records["2026-05-19\u0000device-a"]).toEqual({
            revision: 2,
            hash: "hash",
            exportedAt: "2026-05-19T00:00:00.000Z",
        });
        if (state) {
            state.records["2026-05-19\u0000device-a"].revision = 99;
        }
        await expect(store.getSyncState()).resolves.toEqual(expect.objectContaining({
            records: expect.objectContaining({
                "2026-05-19\u0000device-a": expect.objectContaining({ revision: 2 }),
            }),
        }));
    });

    it("reports an unavailable local store instead of silently using volatile runtime memory", async () => {
        const originalIndexedDb = globalThis.indexedDB;
        Object.defineProperty(globalThis, "indexedDB", {
            configurable: true,
            value: undefined,
        });
        try {
            const store = createStatsLocalStore({} as never, "vault-id");

            await expect(store.initialize()).rejects.toThrow("local app storage is not available");
        } finally {
            Object.defineProperty(globalThis, "indexedDB", {
                configurable: true,
                value: originalIndexedDb,
            });
        }
    });

    it("rejects when IndexedDB open fails", async () => {
        const fakeIndexedDb = new FakeIndexedDbFactory({ failOpen: true });
        const store = new IndexedDbStatsLocalStore("stats-test-db", fakeIndexedDb as unknown as IDBFactory);

        await expect(store.initialize()).rejects.toThrow("open failed");
    });

    it("rejects when IndexedDB upgrade is blocked", async () => {
        const fakeIndexedDb = new FakeIndexedDbFactory({ blockedOpen: true });
        const store = new IndexedDbStatsLocalStore("stats-test-db", fakeIndexedDb as unknown as IDBFactory);

        await expect(store.initialize()).rejects.toThrow("upgrade was blocked");
    });

    it("allows IndexedDB initialization to retry after a blocked open", async () => {
        const fakeIndexedDb = new FakeIndexedDbFactory({ blockedOpenCount: 1 });
        const store = new IndexedDbStatsLocalStore("stats-test-db", fakeIndexedDb as unknown as IDBFactory);

        await expect(store.initialize()).rejects.toThrow("upgrade was blocked");
        await expect(store.initialize()).resolves.toBeUndefined();

        expect(fakeIndexedDb.openCalls).toBe(2);
    });

    it("closes the IndexedDB connection on version changes", async () => {
        const fakeIndexedDb = new FakeIndexedDbFactory();
        const store = new IndexedDbStatsLocalStore("stats-test-db", fakeIndexedDb as unknown as IDBFactory);

        await store.initialize();
        fakeIndexedDb.db.onversionchange?.call(
            fakeIndexedDb.db as unknown as IDBDatabase,
            {} as IDBVersionChangeEvent,
        );

        expect(fakeIndexedDb.db.closeCalls).toBe(1);
    });

    it("rejects when an IndexedDB read request fails", async () => {
        const fakeIndexedDb = new FakeIndexedDbFactory({ failGetAll: true });
        const store = new IndexedDbStatsLocalStore("stats-test-db", fakeIndexedDb as unknown as IDBFactory);

        await store.initialize();

        await expect(store.getAllRecords()).rejects.toThrow("getAll failed");
    });

    it("rejects when an IndexedDB write transaction fails", async () => {
        const fakeIndexedDb = new FakeIndexedDbFactory({ failPut: "error" });
        const store = new IndexedDbStatsLocalStore("stats-test-db", fakeIndexedDb as unknown as IDBFactory);

        await store.initialize();

        await expect(store.upsertRecord(createRecord())).rejects.toThrow("put failed");
    });

    it("rejects when an IndexedDB write transaction aborts", async () => {
        const fakeIndexedDb = new FakeIndexedDbFactory({ failPut: "abort" });
        const store = new IndexedDbStatsLocalStore("stats-test-db", fakeIndexedDb as unknown as IDBFactory);

        await store.initialize();

        await expect(store.upsertRecord(createRecord())).rejects.toThrow("put aborted");
    });

    it("stores, lists, and clears file count cache entries via the memory store", async () => {
        const store = new MemoryStatsLocalStore();
        await store.initialize();
        const entries: FileCountCacheEntry[] = [
            createCacheEntry({ path: "a.md", wordCount: 10 }),
            createCacheEntry({ path: "b.md", wordCount: 20 }),
        ];
        await store.putFileCountEntries(entries);
        entries[0].wordCount = 999;

        const stored = await store.getAllFileCountEntries();
        expect(stored.map((entry) => [entry.path, entry.wordCount]).sort()).toEqual([
            ["a.md", 10],
            ["b.md", 20],
        ]);

        await store.deleteFileCountEntries(["a.md"]);
        const remaining = await store.getAllFileCountEntries();
        expect(remaining.map((entry) => entry.path)).toEqual(["b.md"]);

        await store.clearFileCountCache();
        await expect(store.getAllFileCountEntries()).resolves.toEqual([]);
    });

    it("persists file count cache entries through IndexedDB and round-trips them", async () => {
        const fakeIndexedDb = new FakeIndexedDbFactory({ hasStore: false });
        const store = new IndexedDbStatsLocalStore("stats-test-db", fakeIndexedDb as unknown as IDBFactory);
        await store.initialize();

        await store.putFileCountEntries([
            createCacheEntry({ path: "a.md", mtime: 100 }),
            createCacheEntry({ path: "b.md", mtime: 200 }),
        ]);

        const all = await store.getAllFileCountEntries();
        expect(all.map((entry) => entry.path).sort()).toEqual(["a.md", "b.md"]);

        await store.deleteFileCountEntries(["a.md"]);
        const remaining = await store.getAllFileCountEntries();
        expect(remaining.map((entry) => entry.path)).toEqual(["b.md"]);

        await store.clearFileCountCache();
        await expect(store.getAllFileCountEntries()).resolves.toEqual([]);
    });

    it("initializes daily stats when optional file count cache store is missing post-upgrade", async () => {
        const fakeIndexedDb = new FakeIndexedDbFactory({ hasStore: true, suppressCreateObjectStore: ["fileCountCache"] });
        const store = new IndexedDbStatsLocalStore("stats-test-db", fakeIndexedDb as unknown as IDBFactory);
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            await expect(store.initialize()).resolves.toBeUndefined();
            await expect(store.getAllRecords()).resolves.toEqual([]);
            await expect(store.getAllFileCountEntries()).resolves.toEqual([]);
        } finally {
            consoleError.mockRestore();
        }
    });

    it("UnavailableStatsLocalStore rejects file count cache methods", async () => {
        const originalIndexedDb = globalThis.indexedDB;
        Object.defineProperty(globalThis, "indexedDB", {
            configurable: true,
            value: undefined,
        });
        try {
            const store = createStatsLocalStore({} as never, "vault-id");
            await expect(store.getAllFileCountEntries()).rejects.toThrow("local app storage");
            await expect(store.putFileCountEntries([])).rejects.toThrow("local app storage");
            await expect(store.deleteFileCountEntries([])).rejects.toThrow("local app storage");
            await expect(store.clearFileCountCache()).rejects.toThrow("local app storage");
        } finally {
            Object.defineProperty(globalThis, "indexedDB", {
                configurable: true,
                value: originalIndexedDb,
            });
        }
    });
});

function createCacheEntry(overrides: Partial<FileCountCacheEntry> = {}): FileCountCacheEntry {
    return {
        path: "note.md",
        mtime: 1,
        size: 10,
        wordCount: 1,
        charCount: 1,
        sentenceCount: 1,
        pageCount: 0.1,
        footnoteCount: 0,
        citationCount: 0,
        ...overrides,
    };
}

type FakeIndexedDbOptions = {
    hasStore?: boolean;
    failOpen?: boolean;
    blockedOpen?: boolean;
    blockedOpenCount?: number;
    failGetAll?: boolean;
    failPut?: "error" | "abort";
    suppressCreateObjectStore?: string[];
};

class FakeIndexedDbFactory {
    readonly db: FakeIdbDatabase;
    openCalls = 0;

    constructor(private readonly options: FakeIndexedDbOptions = {}) {
        this.db = new FakeIdbDatabase(options);
    }

    open(): IDBOpenDBRequest {
        this.openCalls += 1;
        const request = new FakeRequest(this.db) as unknown as IDBOpenDBRequest;
        queueMicrotask(() => {
            if (this.options.failOpen) {
                (request as unknown as FakeRequest<FakeIdbDatabase>).error = new DOMException("open failed");
                request.onerror?.({} as Event);
                return;
            }
            if (this.options.blockedOpen) {
                request.onblocked?.call(request, {} as IDBVersionChangeEvent);
                return;
            }
            if (this.options.blockedOpenCount && this.options.blockedOpenCount > 0) {
                this.options.blockedOpenCount -= 1;
                request.onblocked?.call(request, {} as IDBVersionChangeEvent);
                return;
            }
            request.onupgradeneeded?.({} as IDBVersionChangeEvent);
            request.onsuccess?.({} as Event);
        });
        return request;
    }
}

class FakeIdbDatabase {
    readonly stores = new Map<string, Map<string, unknown>>();
    readonly storeNames = new Set<string>();
    onversionchange: ((this: IDBDatabase, ev: IDBVersionChangeEvent) => unknown) | null = null;
    createObjectStoreCalls = 0;
    closeCalls = 0;

    constructor(private readonly options: FakeIndexedDbOptions) {
        if (options.hasStore ?? true) {
            this.storeNames.add("dailyRecords");
            this.storeNames.add("metadata");
        }
    }

    readonly objectStoreNames = {
        contains: (name: string) => this.storeNames.has(name),
    };

    createObjectStore(name: string): IDBObjectStore {
        if (this.options.suppressCreateObjectStore?.includes(name)) {
            throw new Error(`Suppressed createObjectStore for ${name}`);
        }
        this.createObjectStoreCalls += 1;
        this.storeNames.add(name);
        return new FakeObjectStore(this.getStore(name), null, this.options) as unknown as IDBObjectStore;
    }

    transaction(storeName: string, _mode: IDBTransactionMode): IDBTransaction {
        const transaction = new FakeTransaction(this, storeName);
        return transaction.withOptions(this.options) as unknown as IDBTransaction;
    }

    getStore(name: string): Map<string, unknown> {
        let store = this.stores.get(name);
        if (!store) {
            store = new Map<string, unknown>();
            this.stores.set(name, store);
        }
        return store;
    }

    close(): void {
        this.closeCalls += 1;
    }
}

class FakeTransaction {
    oncomplete: ((this: IDBTransaction, ev: Event) => unknown) | null = null;
    onerror: ((this: IDBTransaction, ev: Event) => unknown) | null = null;
    onabort: ((this: IDBTransaction, ev: Event) => unknown) | null = null;
    error: DOMException | null = null;
    private options: FakeIndexedDbOptions = {};

    constructor(private readonly db: FakeIdbDatabase, private readonly storeName: string) { }

    withOptions(options: FakeIndexedDbOptions): this {
        this.options = options;
        return this;
    }

    objectStore(name: string): IDBObjectStore {
        if (name !== this.storeName) {
            throw new Error(`Store ${name} is outside transaction scope ${this.storeName}.`);
        }
        return new FakeObjectStore(this.db.getStore(name), this, this.options) as unknown as IDBObjectStore;
    }

    complete(): void {
        this.oncomplete?.call(this as unknown as IDBTransaction, {} as Event);
    }

    fail(message: string): void {
        this.error = new DOMException(message);
        this.onerror?.call(this as unknown as IDBTransaction, {} as Event);
    }

    abort(message: string): void {
        this.error = new DOMException(message);
        this.onabort?.call(this as unknown as IDBTransaction, {} as Event);
    }
}

class FakeObjectStore {
    constructor(
        private readonly records: Map<string, unknown>,
        private readonly transaction: FakeTransaction | null,
        private readonly options: FakeIndexedDbOptions,
    ) { }

    getAll(): IDBRequest<unknown[]> {
        if (this.options.failGetAll) {
            return createFailedRequest("getAll failed");
        }
        return createAsyncRequest(Array.from(this.records.values()).map(cloneValue));
    }

    get(key: IDBValidKey): IDBRequest<unknown | undefined> {
        const record = this.records.get(String(key));
        return createAsyncRequest(record ? cloneValue(record) : undefined);
    }

    put(record: { key?: string; recordKey?: string; path?: string }): IDBRequest<IDBValidKey> {
        const key = record.recordKey ?? record.key ?? record.path;
        if (!key) throw new Error("Missing fake IndexedDB key.");
        this.records.set(key, cloneValue(record));
        queueMicrotask(() => {
            if (this.options.failPut === "error") {
                this.transaction?.fail("put failed");
                return;
            }
            if (this.options.failPut === "abort") {
                this.transaction?.abort("put aborted");
                return;
            }
            this.transaction?.complete();
        });
        return createAsyncRequest(key);
    }

    delete(key: IDBValidKey): IDBRequest<undefined> {
        this.records.delete(String(key));
        queueMicrotask(() => this.transaction?.complete());
        return createAsyncRequest(undefined);
    }

    clear(): IDBRequest<undefined> {
        this.records.clear();
        queueMicrotask(() => this.transaction?.complete());
        return createAsyncRequest(undefined);
    }

    add(record: { key?: string; recordKey?: string; path?: string }): IDBRequest<IDBValidKey> {
        const key = record.recordKey ?? record.key ?? record.path;
        if (!key) throw new Error("Missing fake IndexedDB key.");
        const request = new FakeRequest(key) as unknown as IDBRequest<IDBValidKey>;
        queueMicrotask(() => {
            if (this.records.has(key)) {
                (request as unknown as FakeRequest<IDBValidKey>).error = new DOMException("Key already exists", "ConstraintError");
                const event = createFakeEvent();
                request.onerror?.(event as Event);
                if (!event.defaultPrevented) {
                    this.transaction?.abort("constraint failed");
                    return;
                }
                this.transaction?.complete();
                return;
            }
            this.records.set(key, cloneValue(record));
            request.onsuccess?.({} as Event);
            this.transaction?.complete();
        });
        return request;
    }
}

class FakeRequest<T> {
    onsuccess: ((this: IDBRequest<T>, ev: Event) => unknown) | null = null;
    onerror: ((this: IDBRequest<T>, ev: Event) => unknown) | null = null;
    onblocked: ((this: IDBOpenDBRequest, ev: Event) => unknown) | null = null;
    error: DOMException | null = null;

    constructor(public result: T) { }
}

function createAsyncRequest<T>(result: T): IDBRequest<T> {
    const request = new FakeRequest(result) as unknown as IDBRequest<T>;
    queueMicrotask(() => request.onsuccess?.({} as Event));
    return request;
}

function createFailedRequest<T>(message: string): IDBRequest<T> {
    const request = new FakeRequest<T>(undefined as T) as unknown as IDBRequest<T>;
    queueMicrotask(() => {
        (request as unknown as FakeRequest<T>).error = new DOMException(message);
        request.onerror?.({} as Event);
    });
    return request;
}

function createFakeEvent(): Event & { defaultPrevented: boolean } {
    let defaultPrevented = false;
    return {
        get defaultPrevented() {
            return defaultPrevented;
        },
        preventDefault: () => {
            defaultPrevented = true;
        },
        stopPropagation: () => undefined,
    } as Event & { defaultPrevented: boolean };
}

function cloneRecord(record: StatsDailyDeviceRecord): StatsDailyDeviceRecord {
    return {
        ...record,
        activity: { ...record.activity },
        snapshot: { ...record.snapshot },
    };
}

function cloneValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}
