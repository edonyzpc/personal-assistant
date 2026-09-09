import { MEMORY_GOVERNANCE_LOGICAL_STORES, type DeviceMemoryGovernanceStateV1 } from "../../src/pa/memory-governance-persistence";

export class FakeGovernanceIndexedDbFactory {
    readonly backend = new FakeGovernanceIndexedDbBackend();
    readonly openCalls: Array<{ name: string; version: number | undefined }> = [];
    readonly connections: FakeGovernanceDatabase[] = [];
    blockedOpenCount = 0;
    silentOpenCount = 0;

    open(name: string, version?: number): IDBOpenDBRequest {
        this.openCalls.push({ name, version });
        const connection = new FakeGovernanceDatabase(this.backend);
        this.connections.push(connection);
        const request = new FakeIdbRequest<FakeGovernanceDatabase>(connection) as unknown as IDBOpenDBRequest;
        queueMicrotask(() => {
            if (this.silentOpenCount > 0) {
                this.silentOpenCount -= 1;
                return;
            }
            if (this.blockedOpenCount > 0) {
                this.blockedOpenCount -= 1;
                request.onblocked?.call(request, {} as IDBVersionChangeEvent);
                return;
            }
            if (version !== undefined && version < this.backend.version) {
                Object.assign(request, { error: new DOMException('Old writer blocked', 'VersionError') });
                request.onerror?.call(request, {} as Event); return;
            }
            if (this.backend.version > 0 && version !== undefined && version > this.backend.version) {
                const upgrade = new FakeGovernanceTransaction(this.backend, [...this.backend.stores.keys()], 'readwrite');
                Object.assign(request, { transaction: upgrade });
                upgrade.oncomplete = () => { this.backend.version = version; request.onsuccess?.call(request, {} as Event); };
                upgrade.onabort = () => {
                    Object.assign(request, { error: upgrade.error }); request.onerror?.call(request, {} as Event);
                };
                request.onupgradeneeded?.call(request, { oldVersion: this.backend.version, newVersion: version } as IDBVersionChangeEvent);
                this.backend.acquireWrite(upgrade); return;
            }
            if (!this.backend.upgraded) {
                request.onupgradeneeded?.call(request, { oldVersion: 0, newVersion: version } as IDBVersionChangeEvent);
                this.backend.upgraded = true;
                this.backend.version = version ?? 1;
            }
            request.onsuccess?.call(request, {} as Event);
        });
        return request;
    }
}

class FakeGovernanceIndexedDbBackend {
    stores = new Map<string, Map<string, unknown>>();
    upgraded = false;
    version = 0;
    failNextWriteCommit = false;
    private writeTail: Promise<void> = Promise.resolve();

    getStore(name: string): Map<string, unknown> {
        let store = this.stores.get(name);
        if (!store) {
            store = new Map();
            this.stores.set(name, store);
        }
        return store;
    }

    acquireWrite(transaction: FakeGovernanceTransaction): void {
        let release: (() => void) | undefined;
        const previous = this.writeTail;
        this.writeTail = previous.then(() => new Promise<void>((resolve) => { release = resolve; }));
        void previous.then(() => transaction.activate(() => release?.()));
    }
}

// This transactional fake exercises production upgrade callbacks; host IndexedDB
// durability/VersionError behavior still needs the real Obsidian acceptance run.
export function seedLegacyFactory(factory: FakeGovernanceIndexedDbFactory, state: DeviceMemoryGovernanceStateV1): void {
    factory.backend.version = 1; factory.backend.upgraded = true;
    factory.backend.getStore('meta').set('device-state-v1', { schemaVersion: 1, commitSequence: state.commitSequence });
    for (const name of MEMORY_GOVERNANCE_LOGICAL_STORES) {
        const store = factory.backend.getStore(name), value = state[name];
        if (Array.isArray(value)) value.forEach((row, index) => store.set(String(index), cloneValue(row)));
        else for (const [key, entry] of Object.entries(value)) store.set(key, { key, value: cloneValue(entry) });
    }
}

class FakeGovernanceDatabase {
    onversionchange: ((this: IDBDatabase, ev: IDBVersionChangeEvent) => unknown) | null = null;
    closeCalls = 0;
    private closed = false;

    constructor(readonly backend: FakeGovernanceIndexedDbBackend) {}

    readonly objectStoreNames = {
        contains: (name: string) => this.backend.stores.has(name),
    };

    createObjectStore(name: string): IDBObjectStore {
        this.backend.getStore(name);
        return {} as IDBObjectStore;
    }

    transaction(storeNames: string | string[], mode: IDBTransactionMode = "readonly"): IDBTransaction {
        if (this.closed) throw new DOMException("Connection is closed", "InvalidStateError");
        const names = Array.isArray(storeNames) ? storeNames : [storeNames];
        const transaction = new FakeGovernanceTransaction(this.backend, names, mode);
        if (mode === "readwrite") this.backend.acquireWrite(transaction);
        else queueMicrotask(() => transaction.activate());
        return transaction as unknown as IDBTransaction;
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.closeCalls += 1;
    }
}

type FakeIdbOperation = (stores: Map<string, Map<string, unknown>>) => void;

class FakeGovernanceTransaction {
    oncomplete: ((this: IDBTransaction, ev: Event) => unknown) | null = null;
    onerror: ((this: IDBTransaction, ev: Event) => unknown) | null = null;
    onabort: ((this: IDBTransaction, ev: Event) => unknown) | null = null;
    error: DOMException | null = null;
    private readonly operations: FakeIdbOperation[] = [];
    private active = false;
    private finishing = false;
    private release: (() => void) | undefined;
    private workingStores: Map<string, Map<string, unknown>> | null = null;

    constructor(
        private readonly backend: FakeGovernanceIndexedDbBackend,
        private readonly storeNames: string[],
        private readonly mode: IDBTransactionMode,
    ) {}

    objectStore(name: string): IDBObjectStore {
        if (!this.storeNames.includes(name)) throw new DOMException("Store not in transaction", "NotFoundError");
        return new FakeGovernanceObjectStore(this, name) as unknown as IDBObjectStore;
    }

    abort(): void {
        if (!this.active) return;
        this.fail(new DOMException("transaction aborted", "AbortError"));
    }

    activate(release?: () => void): void {
        this.release = release;
        this.workingStores = this.mode === "readwrite"
            ? cloneStores(this.backend.stores)
            : this.backend.stores;
        this.active = true;
        this.drain();
    }

    enqueue(operation: FakeIdbOperation): void {
        this.operations.push(operation);
        if (this.active && !this.finishing) queueMicrotask(() => this.drain());
    }

    private drain(): void {
        if (!this.active || this.finishing) return;
        const operation = this.operations.shift();
        if (operation) {
            try {
                operation(this.workingStores!);
            } catch (error) {
                this.fail(error);
                return;
            }
            queueMicrotask(() => this.drain());
            return;
        }
        this.finishing = true;
        queueMicrotask(() => {
            this.finishing = false;
            if (this.operations.length > 0) {
                this.drain();
                return;
            }
            if (this.mode === "readwrite" && this.backend.failNextWriteCommit) {
                this.backend.failNextWriteCommit = false;
                this.fail(new DOMException("write failed", "AbortError"));
                return;
            }
            if (this.mode === "readwrite") this.backend.stores = this.workingStores!;
            this.active = false;
            this.oncomplete?.call(this as unknown as IDBTransaction, {} as Event);
            this.release?.();
        });
    }

    private fail(error: unknown): void {
        this.active = false;
        this.error = error instanceof DOMException ? error : new DOMException("transaction failed");
        this.onabort?.call(this as unknown as IDBTransaction, {} as Event);
        this.release?.();
    }
}

class FakeGovernanceObjectStore {
    constructor(private readonly transaction: FakeGovernanceTransaction, private readonly storeName: string) {}

    get(key: IDBValidKey): IDBRequest<unknown | undefined> {
        const request = new FakeIdbRequest<unknown | undefined>(undefined);
        this.transaction.enqueue((stores) => {
            request.result = cloneValue(stores.get(this.storeName)?.get(String(key)));
            request.onsuccess?.call(request as unknown as IDBRequest, {} as Event);
        });
        return request as unknown as IDBRequest<unknown | undefined>;
    }

    getAll(): IDBRequest<unknown[]> {
        const request = new FakeIdbRequest<unknown[]>([]);
        this.transaction.enqueue((stores) => {
            request.result = [...(stores.get(this.storeName)?.values() ?? [])].map(cloneValue);
            request.onsuccess?.call(request as unknown as IDBRequest, {} as Event);
        });
        return request as unknown as IDBRequest<unknown[]>;
    }

    put(value: unknown, key?: IDBValidKey): IDBRequest<IDBValidKey> {
        const request = new FakeIdbRequest<IDBValidKey>(key ?? "");
        this.transaction.enqueue((stores) => {
            if (key === undefined) throw new DOMException("Missing key", "DataError");
            stores.get(this.storeName)?.set(String(key), cloneValue(value));
            request.onsuccess?.call(request as unknown as IDBRequest, {} as Event);
        });
        return request as unknown as IDBRequest<IDBValidKey>;
    }

    clear(): IDBRequest<undefined> {
        const request = new FakeIdbRequest<undefined>(undefined);
        this.transaction.enqueue((stores) => {
            stores.get(this.storeName)?.clear();
            request.onsuccess?.call(request as unknown as IDBRequest, {} as Event);
        });
        return request as unknown as IDBRequest<undefined>;
    }
}

class FakeIdbRequest<T> {
    onsuccess: ((this: IDBRequest<T>, ev: Event) => unknown) | null = null;
    onerror: ((this: IDBRequest<T>, ev: Event) => unknown) | null = null;
    onblocked: ((this: IDBOpenDBRequest, ev: Event) => unknown) | null = null;
    onupgradeneeded: ((this: IDBOpenDBRequest, ev: IDBVersionChangeEvent) => unknown) | null = null;
    error: DOMException | null = null;

    constructor(public result: T) {}
}

export function cloneStores(source: Map<string, Map<string, unknown>>): Map<string, Map<string, unknown>> {
    return new Map([...source].map(([name, records]) => [
        name,
        new Map([...records].map(([key, value]) => [key, cloneValue(value)])),
    ]));
}

function cloneValue<T>(value: T): T {
    return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}
