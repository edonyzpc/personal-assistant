import { describe, expect, it } from "@jest/globals";
import type { Vault } from "obsidian";
import {
    createVSSIndexStateStore,
    getVSSLocalStateDbName,
    IndexedDbVSSIndexStateStore,
    MemoryVSSIndexStateStore,
} from "../src/vss/local-state-store";
import type { VSSIndexMarker } from "../src/vss/types";

function createMarker(overrides: Partial<VSSIndexMarker> = {}): VSSIndexMarker {
    return {
        schemaVersion: 1,
        deviceId: "device-a",
        indexId: "index-a",
        profileSignature: "openai||model|1024|COSINE",
        opfsScope: "Test_20Vault-scope",
        backend: "sqlite-wasm-opfs-sahpool",
        chunkCount: 2,
        fileCount: 1,
        builtAt: "2026-05-20T00:00:00.000Z",
        lastVerifiedAt: "2026-05-20T00:00:00.000Z",
        storagePersisted: true,
        ...overrides,
    };
}

function createVault(basePath: string, configDir = ".obsidian"): Vault {
    return {
        configDir,
        adapter: {
            getBasePath: () => basePath,
        },
    } as unknown as Vault;
}

describe("VSS local state store", () => {
    it("keeps memory marker, dirty journal, and migration metadata cloned", async () => {
        const store = new MemoryVSSIndexStateStore();
        const marker = createMarker();

        await store.initialize();
        await store.setMarker(marker);
        marker.chunkCount = 99;
        await expect(store.getMarker()).resolves.toMatchObject({ chunkCount: 2 });

        const dirty = new Map([["note.md", { first: 1, last: 2, epoch: 3 }]]);
        await store.setDirtyJournal(dirty);
        dirty.get("note.md")!.last = 99;
        const storedDirty = await store.getDirtyJournal();
        expect(storedDirty.get("note.md")).toEqual({ first: 1, last: 2, epoch: 3 });

        await store.setMigrationMetadata({ version: 1, ignoredLegacyDirtyAt: "2026-05-20T00:00:00.000Z" });
        const migration = await store.getMigrationMetadata();
        expect(migration).toEqual(expect.objectContaining({ ignoredLegacyDirtyAt: "2026-05-20T00:00:00.000Z" }));
        if (migration) migration.lastLegacyError = "changed";
        await expect(store.getMigrationMetadata()).resolves.not.toEqual(expect.objectContaining({ lastLegacyError: "changed" }));
    });

    it("opens IndexedDB and persists marker, dirty journal, and migration metadata", async () => {
        const fakeIndexedDb = new FakeIndexedDbFactory({ hasStore: false });
        const store = new IndexedDbVSSIndexStateStore("vss-test-db", fakeIndexedDb as unknown as IDBFactory);

        await store.initialize();
        expect(fakeIndexedDb.openCalls).toBe(1);
        expect(fakeIndexedDb.db.createObjectStoreCalls).toBe(1);

        await store.setMarker(createMarker({ indexId: "index-b" }));
        await expect(store.getMarker()).resolves.toMatchObject({ indexId: "index-b" });

        await store.setDirtyJournal(new Map([
            ["one.md", { first: 1, last: 2, epoch: 3 }],
            ["two.md", { first: 4, last: 5 }],
        ]));
        await expect(store.getDirtyJournal()).resolves.toEqual(new Map([
            ["one.md", { first: 1, last: 2, epoch: 3 }],
            ["two.md", { first: 4, last: 5, epoch: undefined }],
        ]));

        await store.setMigrationMetadata({ version: 1, importedLegacyMarkerAt: "2026-05-20T00:00:00.000Z" });
        await expect(store.getMigrationMetadata()).resolves.toMatchObject({ importedLegacyMarkerAt: "2026-05-20T00:00:00.000Z" });

        await store.clearDirtyJournal();
        await expect(store.getDirtyJournal()).resolves.toEqual(new Map());
        await store.removeMarker();
        await expect(store.getMarker()).resolves.toBeNull();
    });

    it("scopes IndexedDB by plugin id, vault id, config dir, and local vault path", () => {
        const base = getVSSLocalStateDbName(createVault("/vaults/work"), "vault-id", "personal-assistant");

        expect(base).toMatch(/^personal-assistant-vss-state-/);
        expect(getVSSLocalStateDbName(createVault("/vaults/work"), "other-vault", "personal-assistant")).not.toBe(base);
        expect(getVSSLocalStateDbName(createVault("/vaults/work", ".config"), "vault-id", "personal-assistant")).not.toBe(base);
        expect(getVSSLocalStateDbName(createVault("/vaults/copy"), "vault-id", "personal-assistant")).not.toBe(base);
        expect(getVSSLocalStateDbName(createVault("/vaults/work"), "vault-id", "other-plugin")).not.toBe(base);
    });

    it("reports unavailable instead of using volatile memory when IndexedDB is missing", async () => {
        const originalIndexedDb = globalThis.indexedDB;
        Object.defineProperty(globalThis, "indexedDB", {
            configurable: true,
            value: undefined,
        });
        try {
            const store = createVSSIndexStateStore(createVault("/vaults/work"), "vault-id", "personal-assistant");
            await expect(store.initialize()).rejects.toThrow("local app storage is not available");
        } finally {
            Object.defineProperty(globalThis, "indexedDB", {
                configurable: true,
                value: originalIndexedDb,
            });
        }
    });

    it("rejects IndexedDB open failures and blocked upgrades", async () => {
        await expect(
            new IndexedDbVSSIndexStateStore("vss-test-db", new FakeIndexedDbFactory({ failOpen: true }) as unknown as IDBFactory).initialize(),
        ).rejects.toThrow("open failed");

        await expect(
            new IndexedDbVSSIndexStateStore("vss-test-db", new FakeIndexedDbFactory({ blockedOpen: true }) as unknown as IDBFactory).initialize(),
        ).rejects.toThrow("upgrade was blocked");
    });

    it("allows IndexedDB initialization to retry after a blocked open", async () => {
        const fakeIndexedDb = new FakeIndexedDbFactory({ blockedOpenCount: 1 });
        const store = new IndexedDbVSSIndexStateStore("vss-test-db", fakeIndexedDb as unknown as IDBFactory);

        await expect(store.initialize()).rejects.toThrow("upgrade was blocked");
        await expect(store.initialize()).resolves.toBeUndefined();

        expect(fakeIndexedDb.openCalls).toBe(2);
    });

    it("closes and invalidates the IndexedDB connection on version changes", async () => {
        const fakeIndexedDb = new FakeIndexedDbFactory();
        const store = new IndexedDbVSSIndexStateStore("vss-test-db", fakeIndexedDb as unknown as IDBFactory);

        await store.initialize();
        fakeIndexedDb.db.onversionchange?.call(
            fakeIndexedDb.db as unknown as IDBDatabase,
            {} as IDBVersionChangeEvent,
        );

        expect(fakeIndexedDb.db.closeCalls).toBe(1);
        await expect(store.getMarker()).rejects.toThrow("not initialized");
    });
});

type FakeIndexedDbOptions = {
    hasStore?: boolean;
    failOpen?: boolean;
    blockedOpen?: boolean;
    blockedOpenCount?: number;
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
            this.storeNames.add("state");
        }
    }

    readonly objectStoreNames = {
        contains: (name: string) => this.storeNames.has(name),
    };

    createObjectStore(name: string): IDBObjectStore {
        this.createObjectStoreCalls += 1;
        this.storeNames.add(name);
        return new FakeObjectStore(this.getStore(name), null) as unknown as IDBObjectStore;
    }

    transaction(storeName: string, _mode: IDBTransactionMode): IDBTransaction {
        return new FakeTransaction(this, storeName) as unknown as IDBTransaction;
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

    constructor(private readonly db: FakeIdbDatabase, private readonly storeName: string) { }

    objectStore(name: string): IDBObjectStore {
        if (name !== this.storeName) {
            throw new Error(`Store ${name} is outside transaction scope ${this.storeName}.`);
        }
        return new FakeObjectStore(this.db.getStore(name), this) as unknown as IDBObjectStore;
    }

    complete(): void {
        this.oncomplete?.call(this as unknown as IDBTransaction, {} as Event);
    }
}

class FakeObjectStore {
    constructor(
        private readonly records: Map<string, unknown>,
        private readonly transaction: FakeTransaction | null,
    ) { }

    get(key: IDBValidKey): IDBRequest<unknown | undefined> {
        const record = this.records.get(String(key));
        return createAsyncRequest<unknown>(record ? cloneValue(record) : undefined);
    }

    put(record: { key?: string }): IDBRequest<IDBValidKey> {
        const key = record.key;
        if (!key) throw new Error("Missing fake IndexedDB key.");
        this.records.set(key, cloneValue(record));
        queueMicrotask(() => this.transaction?.complete());
        return createAsyncRequest<IDBValidKey>(key);
    }

    delete(key: IDBValidKey): IDBRequest<undefined> {
        this.records.delete(String(key));
        queueMicrotask(() => this.transaction?.complete());
        return createAsyncRequest(undefined);
    }
}

class FakeRequest<T> {
    onsuccess: ((this: IDBRequest<T>, ev: Event) => unknown) | null = null;
    onerror: ((this: IDBRequest<T>, ev: Event) => unknown) | null = null;
    onblocked: ((this: IDBOpenDBRequest, ev: Event) => unknown) | null = null;
    onupgradeneeded: ((this: IDBOpenDBRequest, ev: IDBVersionChangeEvent) => unknown) | null = null;
    error: DOMException | null = null;

    constructor(public result: T) { }
}

function createAsyncRequest<T>(result: T): IDBRequest<T> {
    const request = new FakeRequest(result) as unknown as IDBRequest<T>;
    queueMicrotask(() => request.onsuccess?.({} as Event));
    return request;
}

function cloneValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}
