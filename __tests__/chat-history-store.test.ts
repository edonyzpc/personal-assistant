import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import type { Vault } from "obsidian";

class FakeIDBKeyRange {
    constructor(
        public readonly lower: unknown,
        public readonly upper: unknown,
        public readonly lowerOpen: boolean,
        public readonly upperOpen: boolean,
    ) {}

    static bound(lower: unknown, upper: unknown, lowerOpen = false, upperOpen = false): FakeIDBKeyRange {
        return new FakeIDBKeyRange(lower, upper, lowerOpen, upperOpen);
    }

    static only(value: unknown): FakeIDBKeyRange {
        return new FakeIDBKeyRange(value, value, false, false);
    }

    static lowerBound(value: unknown, open = false): FakeIDBKeyRange {
        return new FakeIDBKeyRange(value, undefined, open, false);
    }

    static upperBound(value: unknown, open = false): FakeIDBKeyRange {
        return new FakeIDBKeyRange(undefined, value, false, open);
    }
}

const originalIDBKeyRange = (globalThis as { IDBKeyRange?: unknown }).IDBKeyRange;

beforeAll(() => {
    if (typeof (globalThis as { IDBKeyRange?: unknown }).IDBKeyRange === "undefined") {
        Object.defineProperty(globalThis, "IDBKeyRange", {
            configurable: true,
            value: FakeIDBKeyRange,
        });
    }
});

afterAll(() => {
    if (originalIDBKeyRange === undefined) {
        Reflect.deleteProperty(globalThis, "IDBKeyRange");
    } else {
        Object.defineProperty(globalThis, "IDBKeyRange", {
            configurable: true,
            value: originalIDBKeyRange,
        });
    }
});
import {
    CHAT_HISTORY_IDB_VERSION,
    CHAT_HISTORY_SCHEMA_VERSION,
    IndexedDbChatHistoryStore,
    MemoryChatHistoryStore,
    UnavailableChatHistoryStore,
    buildTurnRecordKey,
    createChatHistoryStore,
    getChatHistoryDbName,
    type PersistedConversation,
    type PersistedTurn,
} from "../src/chat/chat-history-store";

function makeConversation(overrides: Partial<PersistedConversation> = {}): PersistedConversation {
    return {
        id: "conv-1",
        title: "First chat",
        createdAt: "2026-05-29T10:00:00.000Z",
        updatedAt: "2026-05-29T10:00:00.000Z",
        turnCount: 0,
        preview: "Hello",
        ...overrides,
    };
}

function makeTurn(overrides: Partial<PersistedTurn> = {}): PersistedTurn {
    return {
        conversationId: "conv-1",
        turnIndex: 0,
        user: { role: "user", content: "Hello" },
        assistant: { role: "assistant", content: "Hi there" },
        ...overrides,
    };
}

function createVault(basePath: string, configDir = ".obsidian"): Vault {
    return {
        configDir,
        adapter: { getBasePath: () => basePath },
    } as unknown as Vault;
}

describe("MemoryChatHistoryStore", () => {
    it("supports conversation CRUD and active-conversation tracking", async () => {
        const store = new MemoryChatHistoryStore();
        await store.initialize();

        const a = makeConversation({ id: "a", updatedAt: "2026-05-29T10:00:00.000Z" });
        const b = makeConversation({ id: "b", updatedAt: "2026-05-29T11:00:00.000Z", title: "Second" });
        await store.upsertConversation(a);
        await store.upsertConversation(b);
        await expect(store.listConversations()).resolves.toHaveLength(2);

        await expect(store.getConversation("a")).resolves.toMatchObject({ id: "a", title: "First chat" });
        await store.upsertConversation({ ...a, title: "Renamed" });
        await expect(store.getConversation("a")).resolves.toMatchObject({ title: "Renamed" });

        await store.setActiveConversationId("a");
        await expect(store.getActiveConversationId()).resolves.toBe("a");
        await store.deleteConversation("a");
        await expect(store.getConversation("a")).resolves.toBeNull();
        await expect(store.getActiveConversationId()).resolves.toBeNull();
    });

    it("preserves turn order and supports per-turn deletion", async () => {
        const store = new MemoryChatHistoryStore();
        await store.initialize();
        await store.upsertConversation(makeConversation({ id: "conv" }));

        for (const turnIndex of [2, 0, 1]) {
            await store.appendTurn(makeTurn({ conversationId: "conv", turnIndex, user: { role: "user", content: `q${turnIndex}` } }));
        }
        const turns = await store.getTurns("conv");
        expect(turns.map((t) => t.turnIndex)).toEqual([0, 1, 2]);

        await store.deleteTurn("conv", 1);
        const afterDelete = await store.getTurns("conv");
        expect(afterDelete.map((t) => t.turnIndex)).toEqual([0, 2]);
    });

    it("prunes oldest conversations by updatedAt", async () => {
        const store = new MemoryChatHistoryStore();
        await store.initialize();
        for (let i = 0; i < 5; i++) {
            const id = `c-${i}`;
            await store.upsertConversation(makeConversation({
                id,
                updatedAt: `2026-05-29T${String(10 + i).padStart(2, "0")}:00:00.000Z`,
            }));
            await store.appendTurn(makeTurn({ conversationId: id, turnIndex: 0 }));
        }
        const removed = await store.pruneOldConversations(3);
        expect(removed.sort()).toEqual(["c-0", "c-1"]);
        const remaining = await store.listConversations();
        expect(remaining.map((c) => c.id).sort()).toEqual(["c-2", "c-3", "c-4"]);
        for (const removedId of removed) {
            await expect(store.getTurns(removedId)).resolves.toHaveLength(0);
        }
    });

    it("cascade deletes turns when deleteTurnsForConversation is called", async () => {
        const store = new MemoryChatHistoryStore();
        await store.initialize();
        await store.upsertConversation(makeConversation({ id: "a" }));
        await store.upsertConversation(makeConversation({ id: "b" }));
        await store.appendTurn(makeTurn({ conversationId: "a", turnIndex: 0 }));
        await store.appendTurn(makeTurn({ conversationId: "a", turnIndex: 1 }));
        await store.appendTurn(makeTurn({ conversationId: "b", turnIndex: 0 }));

        await store.deleteTurnsForConversation("a");
        await expect(store.getTurns("a")).resolves.toHaveLength(0);
        await expect(store.getTurns("b")).resolves.toHaveLength(1);
    });

    it("persists the schema version independently of records", async () => {
        const store = new MemoryChatHistoryStore();
        await expect(store.getSchemaVersion()).resolves.toBeNull();
        await store.setSchemaVersion(CHAT_HISTORY_SCHEMA_VERSION);
        await expect(store.getSchemaVersion()).resolves.toBe(CHAT_HISTORY_SCHEMA_VERSION);
    });

    it("returns deep copies so mutating the caller's object does not affect the store", async () => {
        const store = new MemoryChatHistoryStore();
        const conversation = makeConversation();
        await store.upsertConversation(conversation);
        conversation.title = "Mutated";
        const stored = await store.getConversation(conversation.id);
        expect(stored?.title).toBe("First chat");
    });
});

describe("UnavailableChatHistoryStore", () => {
    it("rejects every read/write with a stable error", async () => {
        const store = new UnavailableChatHistoryStore();
        await expect(store.initialize()).rejects.toThrow("local app storage is not available");
        await expect(store.listConversations()).rejects.toThrow("local app storage is not available");
        await expect(store.appendTurn(makeTurn())).rejects.toThrow();
        await expect(store.getSchemaVersion()).rejects.toThrow();
        await expect(store.dispose()).resolves.toBeUndefined();
    });
});

describe("buildTurnRecordKey", () => {
    it("zero-pads turnIndex so lexicographic order matches numeric order", () => {
        expect(buildTurnRecordKey("conv", 0)).toBe("conv 0000000000");
        expect(buildTurnRecordKey("conv", 9)).toBe("conv 0000000009");
        expect(buildTurnRecordKey("conv", 10)).toBe("conv 0000000010");
        const ordered = [12, 1, 100, 0]
            .map((n) => buildTurnRecordKey("conv", n))
            .sort();
        expect(ordered).toEqual([
            "conv 0000000000",
            "conv 0000000001",
            "conv 0000000012",
            "conv 0000000100",
        ]);
    });
});

describe("getChatHistoryDbName", () => {
    it("scopes the IndexedDB name by plugin id, vault id, config dir, and base path", () => {
        const base = getChatHistoryDbName(createVault("/vaults/work"), "vault-id", "personal-assistant");
        expect(base).toMatch(/^personal-assistant-chat-history-v1-/);
        expect(getChatHistoryDbName(createVault("/vaults/work"), "other-vault", "personal-assistant")).not.toBe(base);
        expect(getChatHistoryDbName(createVault("/vaults/work", ".config"), "vault-id", "personal-assistant")).not.toBe(base);
        expect(getChatHistoryDbName(createVault("/vaults/other"), "vault-id", "personal-assistant")).not.toBe(base);
        expect(getChatHistoryDbName(createVault("/vaults/work"), "vault-id", "other-plugin")).not.toBe(base);
    });

    it("preserves trim-only configDir semantics for existing IndexedDB scopes", () => {
        const normalized = getChatHistoryDbName(createVault("/vaults/work", ".obsidian"), "vault-id", "personal-assistant");

        expect(getChatHistoryDbName(createVault("/vaults/work", " .obsidian "), "vault-id", "personal-assistant")).toBe(normalized);
        expect(getChatHistoryDbName(createVault("/vaults/work", ".obsidian/"), "vault-id", "personal-assistant")).not.toBe(normalized);
        expect(getChatHistoryDbName(createVault("/vaults/work", ".\\.obsidian"), "vault-id", "personal-assistant")).not.toBe(normalized);
    });
});

describe("createChatHistoryStore", () => {
    it("returns UnavailableChatHistoryStore when indexedDB is missing", async () => {
        const originalIndexedDb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
        Object.defineProperty(globalThis, "indexedDB", {
            configurable: true,
            value: undefined,
        });
        try {
            const store = createChatHistoryStore(createVault("/vaults/work"), "vault-id", "personal-assistant");
            await expect(store.initialize()).rejects.toThrow("local app storage is not available");
        } finally {
            Object.defineProperty(globalThis, "indexedDB", {
                configurable: true,
                value: originalIndexedDb,
            });
        }
    });
});

describe("IndexedDbChatHistoryStore", () => {
    it("persists conversation, turn, and metadata records across reads", async () => {
        const factory = new FakeIndexedDbFactory();
        const store = new IndexedDbChatHistoryStore("chat-history-test", factory as unknown as IDBFactory);
        await store.initialize();
        expect(factory.openCalls).toBe(1);
        // 3 stores: conversations, turns, metadata
        expect(factory.db.createObjectStoreCalls).toBe(3);

        await store.upsertConversation(makeConversation({ id: "c1", title: "Topic A" }));
        await store.upsertConversation(makeConversation({ id: "c2", title: "Topic B", updatedAt: "2026-05-29T11:00:00.000Z" }));
        await expect(store.listConversations()).resolves.toHaveLength(2);

        await store.appendTurn(makeTurn({ conversationId: "c1", turnIndex: 0 }));
        await store.appendTurn(makeTurn({ conversationId: "c1", turnIndex: 1, user: { role: "user", content: "Q2" } }));
        await store.appendTurn(makeTurn({ conversationId: "c2", turnIndex: 0 }));
        const c1Turns = await store.getTurns("c1");
        expect(c1Turns.map((t) => t.turnIndex)).toEqual([0, 1]);
        await expect(store.getTurns("c2")).resolves.toHaveLength(1);

        await store.deleteTurn("c1", 0);
        await expect(store.getTurns("c1")).resolves.toHaveLength(1);

        await store.setActiveConversationId("c2");
        await expect(store.getActiveConversationId()).resolves.toBe("c2");
        await store.setActiveConversationId(null);
        await expect(store.getActiveConversationId()).resolves.toBeNull();

        await store.setSchemaVersion(CHAT_HISTORY_SCHEMA_VERSION);
        await expect(store.getSchemaVersion()).resolves.toBe(CHAT_HISTORY_SCHEMA_VERSION);

        await store.deleteConversation("c1");
        await expect(store.getConversation("c1")).resolves.toBeNull();
    });

    it("clears the active conversation pointer if it matches the conversation being deleted", async () => {
        const factory = new FakeIndexedDbFactory();
        const store = new IndexedDbChatHistoryStore("chat-history-test", factory as unknown as IDBFactory);
        await store.initialize();
        await store.upsertConversation(makeConversation({ id: "c1" }));
        await store.setActiveConversationId("c1");
        await store.deleteConversation("c1");
        await expect(store.getActiveConversationId()).resolves.toBeNull();
    });

    it("uses the documented IDB physical version when opening", async () => {
        const factory = new FakeIndexedDbFactory();
        const store = new IndexedDbChatHistoryStore("chat-history-test", factory as unknown as IDBFactory);
        await store.initialize();
        expect(factory.lastVersion).toBe(CHAT_HISTORY_IDB_VERSION);
    });

    it("appendTurnAndUpdateConversation writes both records inside a single multi-store transaction", async () => {
        const factory = new FakeIndexedDbFactory();
        const store = new IndexedDbChatHistoryStore("chat-history-test", factory as unknown as IDBFactory);
        await store.initialize();
        await store.upsertConversation(makeConversation({ id: "c1", turnCount: 0 }));
        const callsBefore = factory.db.transactionCalls.length;
        await store.appendTurnAndUpdateConversation(
            makeTurn({ conversationId: "c1", turnIndex: 0 }),
            makeConversation({ id: "c1", turnCount: 1, updatedAt: "2026-05-29T12:00:00.000Z" }),
        );
        const newCalls = factory.db.transactionCalls.slice(callsBefore);
        // Exactly one transaction was opened, and it spans both stores.
        expect(newCalls).toHaveLength(1);
        expect(new Set(newCalls[0])).toEqual(new Set(["turns", "conversations"]));
        // Both records reflect the atomic write.
        await expect(store.getTurns("c1")).resolves.toHaveLength(1);
        const updated = await store.getConversation("c1");
        expect(updated?.turnCount).toBe(1);
        expect(updated?.updatedAt).toBe("2026-05-29T12:00:00.000Z");
    });
});

type FakeIndexedDbOptions = {
    hasStores?: boolean;
};

class FakeIndexedDbFactory {
    readonly db: FakeIdbDatabase;
    openCalls = 0;
    lastVersion = 0;

    constructor(private readonly options: FakeIndexedDbOptions = {}) {
        this.db = new FakeIdbDatabase(options);
    }

    open(_name: string, version?: number): IDBOpenDBRequest {
        this.openCalls += 1;
        this.lastVersion = version ?? 0;
        const request = new FakeRequest(this.db) as unknown as IDBOpenDBRequest;
        queueMicrotask(() => {
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
    readonly transactionCalls: string[][] = [];

    constructor(private readonly options: FakeIndexedDbOptions) {
        if (options.hasStores) {
            this.storeNames.add("conversations");
            this.storeNames.add("turns");
            this.storeNames.add("metadata");
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

    transaction(storeNames: string | string[], _mode: IDBTransactionMode): IDBTransaction {
        const allowed = Array.isArray(storeNames) ? storeNames : [storeNames];
        this.transactionCalls.push([...allowed]);
        return new FakeTransaction(this, allowed) as unknown as IDBTransaction;
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
    private completed = false;
    private pendingOperations = 0;

    constructor(private readonly db: FakeIdbDatabase, private readonly allowedStoreNames: string[]) {
        queueMicrotask(() => this.maybeComplete());
    }

    objectStore(name: string): IDBObjectStore {
        if (!this.allowedStoreNames.includes(name)) {
            throw new Error(`Store ${name} is outside transaction scope ${this.allowedStoreNames.join(",")}.`);
        }
        return new FakeObjectStore(this.db.getStore(name), this) as unknown as IDBObjectStore;
    }

    beginOperation(): void {
        this.pendingOperations += 1;
    }

    endOperation(): void {
        this.pendingOperations = Math.max(0, this.pendingOperations - 1);
        if (this.pendingOperations === 0) {
            queueMicrotask(() => this.maybeComplete());
        }
    }

    private maybeComplete(): void {
        if (this.completed) return;
        if (this.pendingOperations > 0) return;
        this.completed = true;
        this.oncomplete?.call(this as unknown as IDBTransaction, {} as Event);
    }
}

class FakeObjectStore {
    constructor(
        private readonly records: Map<string, unknown>,
        private readonly transaction: FakeTransaction | null,
    ) {}

    private trackOperation<T>(value: T): IDBRequest<T> {
        this.transaction?.beginOperation();
        const request = new FakeRequest(value) as unknown as IDBRequest<T>;
        queueMicrotask(() => {
            request.onsuccess?.({} as Event);
            this.transaction?.endOperation();
        });
        return request;
    }

    get(key: IDBValidKey): IDBRequest<unknown | undefined> {
        const record = this.records.get(String(key));
        return this.trackOperation<unknown>(record ? cloneValue(record) : undefined);
    }

    getAll(range?: IDBKeyRange): IDBRequest<unknown[]> {
        const results: unknown[] = [];
        for (const [key, value] of this.records) {
            if (!range || keyInRange(range, key)) {
                results.push(cloneValue(value));
            }
        }
        return this.trackOperation(results);
    }

    put(record: { key?: string; id?: string }): IDBRequest<IDBValidKey> {
        const key = (record.key ?? record.id) as string | undefined;
        if (!key) throw new Error("Missing fake IndexedDB key.");
        this.records.set(key, cloneValue(record));
        return this.trackOperation<IDBValidKey>(key);
    }

    delete(target: IDBValidKey | IDBKeyRange): IDBRequest<undefined> {
        if (target && typeof target === "object" && "lower" in target) {
            const range = target as IDBKeyRange;
            for (const key of Array.from(this.records.keys())) {
                if (keyInRange(range, key)) {
                    this.records.delete(key);
                }
            }
        } else {
            this.records.delete(String(target));
        }
        return this.trackOperation(undefined);
    }
}

function keyInRange(range: IDBKeyRange, key: string): boolean {
    const lower = range.lower as string | undefined;
    const upper = range.upper as string | undefined;
    if (lower !== undefined) {
        if (range.lowerOpen ? key <= lower : key < lower) return false;
    }
    if (upper !== undefined) {
        if (range.upperOpen ? key >= upper : key > upper) return false;
    }
    return true;
}

class FakeRequest<T> {
    onsuccess: ((this: IDBRequest<T>, ev: Event) => unknown) | null = null;
    onerror: ((this: IDBRequest<T>, ev: Event) => unknown) | null = null;
    onblocked: ((this: IDBOpenDBRequest, ev: Event) => unknown) | null = null;
    onupgradeneeded: ((this: IDBOpenDBRequest, ev: IDBVersionChangeEvent) => unknown) | null = null;
    error: DOMException | null = null;

    constructor(public result: T) {}
}

function cloneValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}
