import {
    MEMORY_GOVERNANCE_LOGICAL_STORES,
    IndexedDbMemoryGovernanceRepository,
    InMemoryMemoryGovernanceBackend,
    InMemoryMemoryGovernanceRepository,
    createEmptyDeviceMemoryGovernanceStateV1,
    getMemoryGovernanceDeviceDbName,
    normalizeDeviceMemoryGovernanceStateV1,
    validateDeviceMemoryGovernanceStateV1,
    type DeviceMemoryGovernanceStateV1,
} from "../src/pa/memory-governance-persistence";

describe("Memory governance V1 state", () => {
    it("creates a complete clone-safe empty schema", () => {
        const first = createEmptyDeviceMemoryGovernanceStateV1();
        expect(first).toEqual({
            schemaVersion: 1,
            commitSequence: 0,
            claims: [],
            revisions: [],
            memoryQueueItems: [],
            projectionLinks: [],
            changeEvents: [],
            undoSnapshots: [],
            suppressionMarkers: [],
            pendingOperations: [],
            policyStates: {},
            migrationStates: {},
            migrationDeltas: [],
            rollbackPayloadEntries: [],
        });

        first.claims.push({} as never);
        expect(createEmptyDeviceMemoryGovernanceStateV1().claims).toEqual([]);
    });

    it("normalizes a complete state without exposing mutable nested values", () => {
        const source = createCompleteState();
        const normalized = normalizeDeviceMemoryGovernanceStateV1(source);

        expect(normalized).not.toBeNull();
        expect(validateDeviceMemoryGovernanceStateV1(source)).toEqual({ ok: true });
        normalized!.claims[0].applicability.paths!.push("mutated.md");
        normalized!.revisions[0].provenance[0].kind === "note"
            && normalized!.revisions[0].provenance[0].sourceRef.whyShown?.push("mutated");
        expect(source.claims[0].applicability.paths).toEqual(["notes/source.md"]);
        const noteProvenance = source.revisions[0].provenance[0];
        expect(noteProvenance.kind === "note" && noteProvenance.sourceRef.whyShown).toEqual(["source"]);
    });

    it("fails closed for invalid references and forbidden persisted text", () => {
        const missingRevision = createCompleteState();
        missingRevision.claims[0].activeRevisionId = "missing";
        expect(validateDeviceMemoryGovernanceStateV1(missingRevision)).toEqual({
            ok: false,
            reason: "claim_active_revision_missing",
        });

        const forbiddenMarker = createCompleteState() as unknown as Record<string, unknown>;
        (forbiddenMarker.suppressionMarkers as Array<Record<string, unknown>>)[0].rawMemoryText = "secret";
        expect(validateDeviceMemoryGovernanceStateV1(forbiddenMarker)).toEqual({
            ok: false,
            reason: "invalid_suppression_marker",
        });
        expect(normalizeDeviceMemoryGovernanceStateV1(forbiddenMarker)).toBeNull();
    });

    it("round-trips a text-free automatic-add Undo snapshot with exact links", () => {
        const source = createCompleteState();
        source.changeEvents[0].kind = "add";
        source.undoSnapshots = [{
            id: "undo-1",
            claimId: "claim-1",
            eventId: "event-1",
            partition: { kind: "vault", key: "vault" },
            restoreMode: "remove_added_claim",
            revisions: [],
            projectionLinks: [source.projectionLinks[0]],
            createdAt: "2026-07-10T08:00:00.000Z",
            expiresAt: "2026-07-17T08:00:00.000Z",
        }];

        const normalized = normalizeDeviceMemoryGovernanceStateV1(source);
        expect(normalized?.undoSnapshots[0]).toMatchObject({
            restoreMode: "remove_added_claim",
            projectionLinks: [expect.objectContaining({ id: "link-1" })],
        });

        const invalid = JSON.parse(JSON.stringify(source));
        invalid.undoSnapshots[0].claim = source.claims[0];
        expect(normalizeDeviceMemoryGovernanceStateV1(invalid)).toBeNull();
    });

    it("requires text-free removal deltas and a content payload for every other delta", () => {
        const removal = createCompleteState();
        removal.migrationDeltas = [{
            sequence: 1,
            migrationRunId: "migration-1",
            partition: { kind: "vault", key: "vault" },
            committedAt: "2026-07-10T08:00:00.000Z",
            kind: "claim_removed",
            entityId: "claim-1",
        }];
        removal.rollbackPayloadEntries = [];
        expect(normalizeDeviceMemoryGovernanceStateV1(removal)).not.toBeNull();

        const removalWithPayload = JSON.parse(JSON.stringify(removal));
        removalWithPayload.migrationDeltas[0].payloadEntryId = "payload";
        removalWithPayload.migrationDeltas[0].payloadChecksum = "checksum";
        expect(normalizeDeviceMemoryGovernanceStateV1(removalWithPayload)).toBeNull();

        const changedWithoutPayload = JSON.parse(JSON.stringify(removal));
        changedWithoutPayload.migrationDeltas[0].kind = "claim_changed";
        expect(normalizeDeviceMemoryGovernanceStateV1(changedWithoutPayload)).toBeNull();
    });
});

describe("InMemoryMemoryGovernanceRepository", () => {
    it("serializes cross-connection writes with monotonic commitSequence", async () => {
        const backend = new InMemoryMemoryGovernanceBackend();
        const first = new InMemoryMemoryGovernanceRepository(backend);
        const second = new InMemoryMemoryGovernanceRepository(backend);
        const seen: number[] = [];
        first.subscribe((sequence) => seen.push(sequence));
        await Promise.all([first.initialize(), second.initialize()]);

        await Promise.all(Array.from({ length: 20 }, (_, index) => {
            const repository = index % 2 === 0 ? first : second;
            return repository.transact(async (draft) => {
                const current = draft.policyStates.vault?.legacyBaseline?.confirmedCount ?? 0;
                await Promise.resolve();
                draft.policyStates.vault = createPolicyState(current + 1);
            });
        }));

        const snapshot = await second.initialize();
        expect(snapshot.commitSequence).toBe(20);
        expect(snapshot.policyStates.vault.legacyBaseline?.confirmedCount).toBe(20);
        expect(seen).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    });

    it("commits only after a valid operation succeeds and returns clone-safe state", async () => {
        const backend = new InMemoryMemoryGovernanceBackend();
        const repository = new InMemoryMemoryGovernanceRepository(backend);
        const notifications: number[] = [];
        repository.subscribe((sequence) => notifications.push(sequence));

        await expect(repository.transact((draft) => {
            draft.policyStates.vault = createPolicyState(1);
            throw new Error("operation failed");
        })).rejects.toThrow("operation failed");
        expect((await repository.initialize()).commitSequence).toBe(0);
        expect(notifications).toEqual([]);

        await expect(repository.transact((draft) => {
            (draft as unknown as { schemaVersion: number }).schemaVersion = 99;
            draft.policyStates.vault = createPolicyState(1);
        })).resolves.toBeUndefined();
        const first = await repository.initialize();
        expect(first.schemaVersion).toBe(1);
        expect(first.commitSequence).toBe(1);
        first.policyStates.vault.legacyBaseline!.confirmedCount = 99;
        expect((await repository.initialize()).policyStates.vault.legacyBaseline?.confirmedCount).toBe(1);
    });

    it("rejects new work after dispose", async () => {
        const repository = new InMemoryMemoryGovernanceRepository();
        await repository.initialize();
        await repository.dispose();

        await expect(repository.initialize()).rejects.toMatchObject({ code: "repository_disposed" });
        await expect(repository.transact(() => undefined)).rejects.toMatchObject({ code: "repository_disposed" });
        expect(() => repository.subscribe(() => undefined)).toThrow(expect.objectContaining({
            code: "repository_disposed",
        }));
    });
});

describe("IndexedDbMemoryGovernanceRepository", () => {
    it("creates the complete logical schema under one device-shared database name", async () => {
        const factory = new FakeGovernanceIndexedDbFactory();
        const repository = createIndexedRepository(factory);

        await expect(repository.initialize()).resolves.toEqual(createEmptyDeviceMemoryGovernanceStateV1());

        expect(factory.openCalls).toEqual([{
            name: getMemoryGovernanceDeviceDbName("personal-assistant"),
            version: 1,
        }]);
        expect([...factory.backend.stores.keys()].sort()).toEqual([
            "meta",
            ...MEMORY_GOVERNANCE_LOGICAL_STORES,
        ].sort());
        await repository.dispose();
    });

    it("uses IndexedDB CAS/retry across connections without losing writes", async () => {
        const factory = new FakeGovernanceIndexedDbFactory();
        const first = createIndexedRepository(factory);
        const second = createIndexedRepository(factory);
        const firstSeen: number[] = [];
        const secondSeen: number[] = [];
        first.subscribe((sequence) => firstSeen.push(sequence));
        second.subscribe((sequence) => secondSeen.push(sequence));
        await Promise.all([first.initialize(), second.initialize()]);

        await Promise.all(Array.from({ length: 12 }, (_, index) => {
            const repository = index % 2 === 0 ? first : second;
            return repository.transact(async (draft) => {
                const count = draft.policyStates.vault?.legacyBaseline?.confirmedCount ?? 0;
                await Promise.resolve();
                draft.policyStates.vault = createPolicyState(count + 1);
            });
        }));

        const state = await first.initialize();
        expect(state.commitSequence).toBe(12);
        expect(state.policyStates.vault.legacyBaseline?.confirmedCount).toBe(12);
        expect(firstSeen).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
        expect(secondSeen).toEqual(firstSeen);
        await Promise.all([first.dispose(), second.dispose()]);
    });

    it("does not publish or advance in-memory state when the atomic write fails", async () => {
        const factory = new FakeGovernanceIndexedDbFactory();
        const repository = createIndexedRepository(factory);
        const seen: number[] = [];
        repository.subscribe((sequence) => seen.push(sequence));
        await repository.initialize();
        factory.backend.failNextWriteCommit = true;

        await expect(repository.transact((draft) => {
            draft.policyStates.vault = createPolicyState(1);
        })).rejects.toMatchObject({ code: "database_write_failed" });

        const state = await repository.initialize();
        expect(state.commitSequence).toBe(0);
        expect(state.policyStates).toEqual({});
        expect(seen).toEqual([]);
        await repository.dispose();
    });

    it("closes a stale connection on versionchange and reopens on the next read", async () => {
        const factory = new FakeGovernanceIndexedDbFactory();
        const repository = createIndexedRepository(factory);
        await repository.initialize();
        const firstConnection = factory.connections[0];

        firstConnection.onversionchange?.call(firstConnection as unknown as IDBDatabase, {} as IDBVersionChangeEvent);
        expect(firstConnection.closeCalls).toBe(1);

        await repository.initialize();
        expect(factory.openCalls).toHaveLength(2);
        expect(factory.connections[1]).not.toBe(firstConnection);
        await repository.dispose();
    });

    it("fails a blocked open closed and permits a later retry", async () => {
        const factory = new FakeGovernanceIndexedDbFactory();
        factory.blockedOpenCount = 1;
        const repository = createIndexedRepository(factory);

        await expect(repository.initialize()).rejects.toMatchObject({ code: "database_open_blocked" });
        await expect(repository.initialize()).resolves.toMatchObject({ schemaVersion: 1, commitSequence: 0 });
        expect(factory.openCalls).toHaveLength(2);
        await repository.dispose();
    });

    it("disposes without waiting for a caller-owned suspended transaction callback", async () => {
        const factory = new FakeGovernanceIndexedDbFactory();
        const repository = createIndexedRepository(factory);
        await repository.initialize();
        let releaseOperation: (() => void) | undefined;
        let markStarted: (() => void) | undefined;
        const started = new Promise<void>((resolve) => { markStarted = resolve; });
        const blocker = new Promise<void>((resolve) => { releaseOperation = resolve; });
        const transaction = repository.transact(async (draft) => {
            markStarted?.();
            await blocker;
            draft.policyStates.vault = createPolicyState(1);
        });
        await started;

        await expect(repository.dispose()).resolves.toBeUndefined();
        expect(factory.connections[0].closeCalls).toBe(1);
        releaseOperation?.();
        await expect(transaction).rejects.toMatchObject({ code: "repository_disposed" });

        const replacement = createIndexedRepository(factory);
        expect((await replacement.initialize()).commitSequence).toBe(0);
        await replacement.dispose();
    });

    it("times out a silent open and closes a late connection", async () => {
        jest.useFakeTimers();
        try {
            const factory = new FakeGovernanceIndexedDbFactory();
            factory.silentOpenCount = 1;
            const repository = createIndexedRepository(factory, { openTimeoutMs: 5 });
            const opening = repository.initialize();

            jest.advanceTimersByTime(5);
            await expect(opening).rejects.toMatchObject({ code: "database_open_timeout" });
            await repository.dispose();
        } finally {
            jest.useRealTimers();
        }
    });

    it("fails closed instead of dropping corrupted persisted entities", async () => {
        const factory = new FakeGovernanceIndexedDbFactory();
        const repository = createIndexedRepository(factory);
        await repository.initialize();
        factory.backend.getStore("claims").set("broken", { id: "broken" });

        await expect(repository.initialize()).rejects.toMatchObject({ code: "invalid_state" });
        await repository.dispose();
    });
});

function createPolicyState(confirmedCount: number) {
    return {
        version: 1 as const,
        mode: "legacy_threshold" as const,
        contextProjectionMode: "legacy" as const,
        legacyBaseline: {
            confirmedCount,
            threshold: 30 as const,
            autoAcceptPaused: false,
            importedFromSourceHash: "source-hash",
        },
    };
}

function createCompleteState(): DeviceMemoryGovernanceStateV1 {
    const partition = { kind: "vault" as const, key: "vault" };
    const sourceRef = {
        path: "notes/source.md",
        generatedAt: "2026-07-10T08:00:00.000Z",
        whyShown: ["source"],
    };
    return {
        schemaVersion: 1,
        commitSequence: 7,
        claims: [{
            id: "claim-1",
            partition,
            memoryType: "preference",
            sensitivity: "low",
            applicability: { kind: "selected_notes", paths: ["notes/source.md"] },
            activeRevisionId: "revision-1",
            effect: "future_answers",
            lifecycle: "active",
            createdAt: "2026-07-10T08:00:00.000Z",
            updatedAt: "2026-07-10T08:00:00.000Z",
        }],
        revisions: [{
            id: "revision-1",
            claimId: "claim-1",
            summary: "Prefer concise replies",
            provenance: [{ kind: "note", sourceRef }],
            authority: "explicit_user",
            createdAt: "2026-07-10T08:00:00.000Z",
        }],
        memoryQueueItems: [],
        projectionLinks: [{
            id: "link-1",
            claimId: "claim-1",
            target: { kind: "prompt_projection", projectionId: "projection-1" },
            relation: "derived_copy",
            state: "active",
            sourceFingerprintId: "source-fingerprint",
            ruleFingerprint: "rule-fingerprint",
            createdAt: "2026-07-10T08:00:00.000Z",
        }],
        changeEvents: [{
            id: "event-1",
            claimId: "claim-1",
            kind: "replace",
            scopeKey: "vault",
            effect: "future_answers",
            occurredAt: "2026-07-10T08:00:00.000Z",
            undoSnapshotId: "undo-1",
        }],
        undoSnapshots: [{
            id: "undo-1",
            claimId: "claim-1",
            eventId: "event-1",
            partition,
            claim: {
                id: "claim-1",
                partition,
                memoryType: "preference",
                sensitivity: "low",
                applicability: { kind: "selected_notes", paths: ["notes/source.md"] },
                activeRevisionId: "revision-1",
                effect: "future_answers",
                lifecycle: "active",
                createdAt: "2026-07-10T08:00:00.000Z",
                updatedAt: "2026-07-10T08:00:00.000Z",
            },
            revisions: [{
                id: "revision-1",
                claimId: "claim-1",
                summary: "Prefer concise replies",
                provenance: [{ kind: "note", sourceRef }],
                authority: "explicit_user",
                createdAt: "2026-07-10T08:00:00.000Z",
            }],
            projectionLinks: [],
            createdAt: "2026-07-10T08:00:00.000Z",
            expiresAt: "2026-07-17T08:00:00.000Z",
        }],
        suppressionMarkers: [{
            id: "marker-1",
            partition,
            sourceFingerprintId: "source-fingerprint",
            ruleFingerprint: "rule-fingerprint",
            reason: "forgotten",
            createdAt: "2026-07-10T08:00:00.000Z",
            updatedAt: "2026-07-10T08:00:00.000Z",
        }],
        pendingOperations: [{
            id: "profile-op-1",
            kind: "profile_projection",
            claimId: "claim-1",
            profileRecordId: "profile-1",
            targetRevisionId: "revision-1",
            state: "pending",
            attemptCount: 0,
            createdAt: "2026-07-10T08:00:00.000Z",
            updatedAt: "2026-07-10T08:00:00.000Z",
        }],
        policyStates: { vault: createPolicyState(30) },
        migrationStates: {
            vault: {
                migrationRunId: "migration-1",
                phase: "cutover_ready",
                sourceHash: "source-hash",
                cutoverSequence: 7,
                rollbackExpiresAt: "2026-07-17T08:00:00.000Z",
                lastAppliedDeltaSequence: 1,
            },
        },
        migrationDeltas: [{
            sequence: 1,
            migrationRunId: "migration-1",
            partition,
            committedAt: "2026-07-10T08:00:00.000Z",
            kind: "claim_added",
            entityId: "claim-1",
            payloadEntryId: "rollback-1",
            payloadChecksum: "checksum",
        }],
        rollbackPayloadEntries: [{
            id: "rollback-1",
            migrationRunId: "migration-1",
            partition,
            entityId: "claim-1",
            value: {
                kind: "policy",
                confirmedMemoryCount: 30,
                memoryAutoAcceptPaused: false,
            },
            checksum: "checksum",
            expiresAt: "2026-07-17T08:00:00.000Z",
        }],
    };
}

function createIndexedRepository(
    factory: FakeGovernanceIndexedDbFactory,
    options: { openTimeoutMs?: number } = {},
): IndexedDbMemoryGovernanceRepository {
    return new IndexedDbMemoryGovernanceRepository(
        getMemoryGovernanceDeviceDbName("personal-assistant"),
        factory as unknown as IDBFactory,
        { ...options, broadcastChannelFactory: null },
    );
}

class FakeGovernanceIndexedDbFactory {
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
            if (!this.backend.upgraded) {
                request.onupgradeneeded?.call(request, {} as IDBVersionChangeEvent);
                this.backend.upgraded = true;
            }
            request.onsuccess?.call(request, {} as Event);
        });
        return request;
    }
}

class FakeGovernanceIndexedDbBackend {
    stores = new Map<string, Map<string, unknown>>();
    upgraded = false;
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

function cloneStores(source: Map<string, Map<string, unknown>>): Map<string, Map<string, unknown>> {
    return new Map([...source].map(([name, records]) => [
        name,
        new Map([...records].map(([key, value]) => [key, cloneValue(value)])),
    ]));
}

function cloneValue<T>(value: T): T {
    return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}
