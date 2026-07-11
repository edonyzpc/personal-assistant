import type { Vault } from "obsidian";
import {
    IndexedDbExistingUserProfileReader,
    createExistingUserProfileReader,
    getUserProfileDbName,
} from "../src/ai-services/memory-extraction/profile-store";
import type { UserProfileSnapshot } from "../src/ai-services/memory-extraction/type-a-extractor";

const DB_NAME = "existing-profile-test";

const SNAPSHOT: UserProfileSnapshot = {
    updatedAt: "2026-07-10T08:00:00.000Z",
    markdown: "- Prefers concise Chinese replies",
    records: [{
        key: "reply-style",
        text: "Prefers concise Chinese replies",
        kind: "user_explicit",
        confidence: "high",
        conversationId: "conversation-1",
        observedAt: "2026-07-10T07:00:00.000Z",
        occurrences: 1,
        conversationIds: ["conversation-1"],
        confirmed: true,
    }],
};

describe("IndexedDbExistingUserProfileReader", () => {
    it("does not open or create a database when enumeration proves it is absent", async () => {
        const factory = new FakeIndexedDbFactory({ databaseExists: false });
        const reader = createReader(factory);

        await expect(reader.read()).resolves.toEqual({ state: "not_present" });
        expect(factory.openCalls).toEqual([]);
        expect(factory.db.activeConnections).toBe(0);
    });

    it("opens an existing database without a version and closes it after a successful read", async () => {
        const factory = new FakeIndexedDbFactory({ snapshot: SNAPSHOT });
        const reader = createReader(factory);

        const result = await reader.read();

        expect(result).toEqual({ state: "ready", snapshot: SNAPSHOT });
        expect(factory.openCalls).toEqual([{ name: DB_NAME, version: undefined }]);
        expect(factory.db.closeCalls).toBe(1);
        expect(factory.db.activeConnections).toBe(0);
        if (result.state === "ready" && result.snapshot) {
            result.snapshot.records[0].conversationIds.push("mutated");
        }
        expect(SNAPSHOT.records[0].conversationIds).toEqual(["conversation-1"]);
    });

    it("returns unavailable when IDBFactory.databases is unsupported", async () => {
        const factory = new FakeIndexedDbFactory({ databasesUnsupported: true });

        await expect(createReader(factory).read()).resolves.toEqual({ state: "unavailable" });
        expect(factory.openCalls).toEqual([]);
    });

    it("returns unknown when database enumeration fails", async () => {
        const factory = new FakeIndexedDbFactory({ enumerationFails: true });

        await expect(createReader(factory).read()).resolves.toEqual({ state: "unknown" });
        expect(factory.openCalls).toEqual([]);
    });

    it("aborts an unexpected upgrade and closes the transient connection", async () => {
        const factory = new FakeIndexedDbFactory({ openOutcome: "upgrade" });

        await expect(createReader(factory).read()).resolves.toEqual({ state: "unknown" });
        expect(factory.openCalls).toEqual([{ name: DB_NAME, version: undefined }]);
        expect(factory.upgradeTransaction.abortCalls).toBe(1);
        expect(factory.db.closeCalls).toBe(1);
        expect(factory.db.activeConnections).toBe(0);
    });

    it("closes any exposed connection when opening is blocked", async () => {
        const factory = new FakeIndexedDbFactory({ openOutcome: "blocked" });

        await expect(createReader(factory).read()).resolves.toEqual({ state: "blocked" });
        expect(factory.db.closeCalls).toBe(1);
        expect(factory.db.activeConnections).toBe(0);
    });

    it("closes any exposed connection when opening fails", async () => {
        const factory = new FakeIndexedDbFactory({ openOutcome: "error" });

        await expect(createReader(factory).read()).resolves.toEqual({
            state: "error",
            errorCode: "profile_db_open_failed",
        });
        expect(factory.db.closeCalls).toBe(1);
        expect(factory.db.activeConnections).toBe(0);
    });

    it("closes the database after a profile request error", async () => {
        const factory = new FakeIndexedDbFactory({ readOutcome: "error" });

        await expect(createReader(factory).read()).resolves.toEqual({
            state: "error",
            errorCode: "profile_read_failed",
        });
        expect(factory.db.closeCalls).toBe(1);
        expect(factory.db.activeConnections).toBe(0);
    });

    it("closes the database after a read transaction abort", async () => {
        const factory = new FakeIndexedDbFactory({ readOutcome: "abort" });

        await expect(createReader(factory).read()).resolves.toEqual({
            state: "error",
            errorCode: "profile_read_failed",
        });
        expect(factory.db.closeCalls).toBe(1);
        expect(factory.db.activeConnections).toBe(0);
    });
});

describe("createExistingUserProfileReader", () => {
    it("returns a non-creating unavailable reader when IndexedDB is missing", async () => {
        const originalIndexedDb = globalThis.indexedDB;
        Object.defineProperty(globalThis, "indexedDB", {
            configurable: true,
            value: undefined,
        });
        try {
            const reader = createExistingUserProfileReader(
                createVault("/vaults/work"),
                "vault-id",
                "personal-assistant",
            );

            await expect(reader.read()).resolves.toEqual({ state: "unavailable" });
        } finally {
            Object.defineProperty(globalThis, "indexedDB", {
                configurable: true,
                value: originalIndexedDb,
            });
        }
    });

    it("uses the scoped database name without initializing the write store", async () => {
        const vault = createVault("/vaults/work");
        const dbName = getUserProfileDbName(vault, "vault-id", "personal-assistant");
        const factory = new FakeIndexedDbFactory({ dbName, snapshot: SNAPSHOT });
        const originalIndexedDb = globalThis.indexedDB;
        Object.defineProperty(globalThis, "indexedDB", {
            configurable: true,
            value: factory,
        });
        try {
            const reader = createExistingUserProfileReader(vault, "vault-id", "personal-assistant");

            await expect(reader.read()).resolves.toEqual({ state: "ready", snapshot: SNAPSHOT });
            expect(factory.openCalls).toEqual([{ name: dbName, version: undefined }]);
            expect(factory.db.closeCalls).toBe(1);
        } finally {
            Object.defineProperty(globalThis, "indexedDB", {
                configurable: true,
                value: originalIndexedDb,
            });
        }
    });
});

type OpenOutcome = "success" | "upgrade" | "blocked" | "error";
type ReadOutcome = "success" | "error" | "abort";

interface FakeIndexedDbOptions {
    databaseExists?: boolean;
    databasesUnsupported?: boolean;
    dbName?: string;
    enumerationFails?: boolean;
    openOutcome?: OpenOutcome;
    readOutcome?: ReadOutcome;
    snapshot?: UserProfileSnapshot | null;
}

class FakeIndexedDbFactory {
    databases?: () => Promise<IDBDatabaseInfo[]>;
    readonly db: FakeDatabase;
    readonly upgradeTransaction = new FakeUpgradeTransaction();
    readonly openCalls: Array<{ name: string; version: number | undefined }> = [];

    constructor(private readonly options: FakeIndexedDbOptions = {}) {
        this.db = new FakeDatabase(options.readOutcome ?? "success", options.snapshot ?? null);
        if (!options.databasesUnsupported) {
            this.databases = async () => {
                if (this.options.enumerationFails) throw new Error("enumeration failed");
                if (this.options.databaseExists === false) return [];
                return [{ name: this.options.dbName ?? DB_NAME, version: 1 }];
            };
        }
    }

    open(name: string, version?: number): IDBOpenDBRequest {
        this.openCalls.push({ name, version });
        const request = new FakeOpenRequest(this.db, this.upgradeTransaction);
        queueMicrotask(() => {
            this.db.markConnectionOpened();
            switch (this.options.openOutcome ?? "success") {
                case "upgrade":
                    request.onupgradeneeded?.call(
                        request as unknown as IDBOpenDBRequest,
                        {} as IDBVersionChangeEvent,
                    );
                    break;
                case "blocked":
                    request.onblocked?.call(request as unknown as IDBOpenDBRequest, {} as Event);
                    break;
                case "error":
                    request.onerror?.call(request as unknown as IDBOpenDBRequest, {} as Event);
                    break;
                default:
                    request.onsuccess?.call(request as unknown as IDBOpenDBRequest, {} as Event);
            }
        });
        return request as unknown as IDBOpenDBRequest;
    }
}

class FakeOpenRequest {
    onsuccess: ((this: IDBRequest<IDBDatabase>, ev: Event) => unknown) | null = null;
    onerror: ((this: IDBRequest<IDBDatabase>, ev: Event) => unknown) | null = null;
    onblocked: ((this: IDBOpenDBRequest, ev: Event) => unknown) | null = null;
    onupgradeneeded: ((this: IDBOpenDBRequest, ev: IDBVersionChangeEvent) => unknown) | null = null;
    error: DOMException | null = null;

    constructor(
        readonly result: FakeDatabase,
        readonly transaction: FakeUpgradeTransaction,
    ) {}
}

class FakeUpgradeTransaction {
    abortCalls = 0;

    abort(): void {
        this.abortCalls += 1;
    }
}

class FakeDatabase {
    activeConnections = 0;
    closeCalls = 0;
    private readonly entry: { key: string; value: UserProfileSnapshot } | undefined;

    constructor(
        private readonly readOutcome: ReadOutcome,
        snapshot: UserProfileSnapshot | null,
    ) {
        this.entry = snapshot ? { key: "latest", value: cloneValue(snapshot) } : undefined;
    }

    readonly objectStoreNames = {
        contains: (name: string) => name === "profile",
    };

    markConnectionOpened(): void {
        this.activeConnections += 1;
    }

    transaction(storeName: string, mode: IDBTransactionMode): IDBTransaction {
        if (storeName !== "profile" || mode !== "readonly") {
            throw new Error(`Unexpected transaction: ${storeName}/${mode}`);
        }
        return new FakeReadTransaction(this.readOutcome, this.entry) as unknown as IDBTransaction;
    }

    close(): void {
        this.closeCalls += 1;
        this.activeConnections = Math.max(0, this.activeConnections - 1);
    }
}

class FakeReadTransaction {
    oncomplete: ((this: IDBTransaction, ev: Event) => unknown) | null = null;
    onerror: ((this: IDBTransaction, ev: Event) => unknown) | null = null;
    onabort: ((this: IDBTransaction, ev: Event) => unknown) | null = null;
    error: DOMException | null = null;

    constructor(
        private readonly readOutcome: ReadOutcome,
        private readonly entry: { key: string; value: UserProfileSnapshot } | undefined,
    ) {}

    objectStore(name: string): IDBObjectStore {
        if (name !== "profile") throw new Error(`Unexpected store: ${name}`);
        return {
            get: (key: IDBValidKey) => {
                if (key !== "latest") throw new Error(`Unexpected key: ${String(key)}`);
                const request = new FakeReadRequest(this.entry ? cloneValue(this.entry) : undefined);
                queueMicrotask(() => {
                    if (this.readOutcome === "error") {
                        request.error = new DOMException("profile read failed");
                        this.error = request.error;
                        request.onerror?.call(request as unknown as IDBRequest, {} as Event);
                        this.onerror?.call(this as unknown as IDBTransaction, {} as Event);
                        return;
                    }
                    request.onsuccess?.call(request as unknown as IDBRequest, {} as Event);
                    if (this.readOutcome === "abort") {
                        this.error = new DOMException("profile read aborted");
                        this.onabort?.call(this as unknown as IDBTransaction, {} as Event);
                    } else {
                        this.oncomplete?.call(this as unknown as IDBTransaction, {} as Event);
                    }
                });
                return request as unknown as IDBRequest;
            },
        } as unknown as IDBObjectStore;
    }
}

class FakeReadRequest<T> {
    onsuccess: ((this: IDBRequest<T>, ev: Event) => unknown) | null = null;
    onerror: ((this: IDBRequest<T>, ev: Event) => unknown) | null = null;
    error: DOMException | null = null;

    constructor(readonly result: T) {}
}

function createReader(factory: FakeIndexedDbFactory): IndexedDbExistingUserProfileReader {
    return new IndexedDbExistingUserProfileReader(DB_NAME, factory as unknown as IDBFactory);
}

function createVault(basePath: string): Vault {
    return {
        configDir: ".obsidian",
        adapter: {
            getBasePath: () => basePath,
        },
    } as unknown as Vault;
}

function cloneValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}
