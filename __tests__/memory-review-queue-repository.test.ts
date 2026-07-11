import { buildLegacyMemoryRollbackProjection } from "../src/pa/memory-governance-rollback";
import { checksumLegacyRollbackValue } from "../src/pa/memory-governance-migration-coordinator";
import {
    MemoryReviewQueueRepositoryError,
    createMemoryReviewQueueRepository,
} from "../src/pa/memory-review-queue-repository";
import {
    InMemoryMemoryGovernanceBackend,
    InMemoryMemoryGovernanceRepository,
    createEmptyDeviceMemoryGovernanceStateV1,
    type DeviceMemoryGovernanceStateV1,
    type DeviceMemoryQueueItem,
    type LegacyRollbackValue,
    type MemoryGovernanceRepository,
    type MemoryMigrationState,
    type MemoryRollbackPayloadEntry,
} from "../src/pa/memory-governance-persistence";
import {
    CallbackReviewQueueRepository,
    ReviewQueueStore,
    type ReviewQueueCreateInput,
    type ReviewQueueItem,
    type ReviewQueueState,
} from "../src/pa/review-queue-store";

const NOW = new Date("2026-07-11T08:00:00.000Z");
const EXPIRES = "2026-07-18T08:00:00.000Z";

describe("MemoryReviewQueueRepository", () => {
    it("composes current-vault local Memory with live non-Memory settings and preserves another vault", async () => {
        const state = createCompatibilityState([
            deviceItem("memory-a", "vault-a", "memory_conflict"),
            deviceItem("memory-b", "vault-b"),
        ]);
        const repository = deviceRepository(state);
        const settings = new CallbackReviewQueueRepository([
            queueItem("settings-live", "evidence_insight"),
            queueItem("legacy-memory-ignored", "memory_candidate"),
        ]);
        const adapter = await createMemoryReviewQueueRepository({
            repository,
            settingsRepository: settings,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
        });

        expect(adapter.read().items.map((item) => item.id)).toEqual(["settings-live", "memory-a"]);
        const store = new ReviewQueueStore({ repository: adapter, now: () => NOW });
        await expect(store.updateStatus("memory-a", "accepted")).resolves.toMatchObject({
            ok: true,
            value: { status: "accepted" },
        });

        const persisted = await repository.initialize();
        expect(persisted.memoryQueueItems.find((item) => item.id === "memory-a")?.status).toBe("accepted");
        expect(persisted.memoryQueueItems.find((item) => item.id === "memory-b")?.status).toBe("suggested");
        expect(settings.read().items.map((item) => item.id)).toEqual([
            "settings-live",
            "legacy-memory-ignored",
        ]);
    });

    it("merges disjoint Memory item updates from adapters initialized against the same backend snapshot", async () => {
        const backend = new InMemoryMemoryGovernanceBackend(createCompatibilityState([
            deviceItem("memory-a", "vault-a"),
            deviceItem("memory-b", "vault-a"),
        ]));
        const firstRepository = new InMemoryMemoryGovernanceRepository(backend);
        const secondRepository = new InMemoryMemoryGovernanceRepository(backend);
        const first = await createMemoryReviewQueueRepository({
            repository: firstRepository,
            settingsRepository: new CallbackReviewQueueRepository(),
            opaqueVaultKey: "vault-a",
            now: () => NOW,
        });
        const second = await createMemoryReviewQueueRepository({
            repository: secondRepository,
            settingsRepository: new CallbackReviewQueueRepository(),
            opaqueVaultKey: "vault-a",
            now: () => NOW,
        });
        const firstNext = first.read();
        const secondNext = second.read();
        firstNext.items.find((item) => item.id === "memory-a")!.status = "accepted";
        secondNext.items.find((item) => item.id === "memory-b")!.status = "dismissed";

        await Promise.all([
            first.write(firstNext),
            second.write(secondNext),
        ]);

        const persisted = await firstRepository.initialize();
        expect(persisted.memoryQueueItems).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: "memory-a", status: "accepted" }),
            expect.objectContaining({ id: "memory-b", status: "dismissed" }),
        ]));
        expect(second.read().items).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: "memory-a", status: "accepted" }),
            expect.objectContaining({ id: "memory-b", status: "dismissed" }),
        ]));
        expect(persisted.migrationDeltas.map((delta) => delta.entityId)).toEqual([
            "memory-a",
            "memory-b",
        ]);
    });

    it("rejects divergent updates to the same Memory item from a stale adapter", async () => {
        const backend = new InMemoryMemoryGovernanceBackend(createCompatibilityState([
            deviceItem("memory-a", "vault-a"),
        ]));
        const firstRepository = new InMemoryMemoryGovernanceRepository(backend);
        const secondRepository = new InMemoryMemoryGovernanceRepository(backend);
        const first = await createMemoryReviewQueueRepository({
            repository: firstRepository,
            settingsRepository: new CallbackReviewQueueRepository(),
            opaqueVaultKey: "vault-a",
            now: () => NOW,
        });
        const second = await createMemoryReviewQueueRepository({
            repository: secondRepository,
            settingsRepository: new CallbackReviewQueueRepository(),
            opaqueVaultKey: "vault-a",
            now: () => NOW,
        });
        const firstNext = first.read();
        const secondNext = second.read();
        firstNext.items[0].status = "accepted";
        secondNext.items[0].status = "dismissed";

        const firstWrite = first.write(firstNext);
        const secondWrite = second.write(secondNext);
        await expect(firstWrite).resolves.toBeUndefined();
        await expect(secondWrite).rejects.toEqual(expect.objectContaining({
            code: "stale_queue_conflict",
        }));

        const persisted = await firstRepository.initialize();
        expect(persisted.memoryQueueItems).toEqual([
            expect.objectContaining({ id: "memory-a", status: "accepted" }),
        ]);
        expect(persisted.migrationDeltas).toHaveLength(1);
        expect(second.read().items).toEqual([
            expect.objectContaining({ id: "memory-a", status: "suggested" }),
        ]);
    });

    it("preserves a concurrent deletion while merging a disjoint addition after finalization", async () => {
        const backend = new InMemoryMemoryGovernanceBackend(createCompatibilityState([
            deviceItem("memory-a", "vault-a"),
            deviceItem("memory-b", "vault-a"),
        ], "finalized"));
        const firstRepository = new InMemoryMemoryGovernanceRepository(backend);
        const secondRepository = new InMemoryMemoryGovernanceRepository(backend);
        const first = await createMemoryReviewQueueRepository({
            repository: firstRepository,
            settingsRepository: new CallbackReviewQueueRepository(),
            opaqueVaultKey: "vault-a",
            now: () => NOW,
        });
        const second = await createMemoryReviewQueueRepository({
            repository: secondRepository,
            settingsRepository: new CallbackReviewQueueRepository(),
            opaqueVaultKey: "vault-a",
            now: () => NOW,
        });
        const afterDeletion = first.read();
        afterDeletion.items = afterDeletion.items.filter((item) => item.id !== "memory-a");
        const afterAddition = second.read();
        afterAddition.items.push(queueItem("memory-c", "memory_candidate"));

        await Promise.all([
            first.write(afterDeletion),
            second.write(afterAddition),
        ]);

        const persisted = await firstRepository.initialize();
        expect(persisted.memoryQueueItems.map((item) => item.id).sort()).toEqual([
            "memory-b",
            "memory-c",
        ]);
        expect(second.read().items.map((item) => item.id).sort()).toEqual([
            "memory-b",
            "memory-c",
        ]);
        expect(persisted.migrationDeltas).toEqual([]);
    });

    it("routes non-Memory mutations only to settings without Memory backflow", async () => {
        const repository = deviceRepository(createCompatibilityState([deviceItem("memory-a", "vault-a")]));
        const settingsWrites: ReviewQueueState[] = [];
        const settings = new CallbackReviewQueueRepository([
            queueItem("settings-live", "evidence_insight"),
            queueItem("legacy-memory", "memory_candidate"),
        ], async (state) => {
            settingsWrites.push(cloneState(state));
        });
        const adapter = await createMemoryReviewQueueRepository({
            repository,
            settingsRepository: settings,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
        });
        const store = new ReviewQueueStore({
            repository: adapter,
            idFactory: () => "settings-new",
            now: () => NOW,
        });
        const beforeDevice = await repository.initialize();

        await expect(store.create(createInput("evidence_insight"))).resolves.toMatchObject({
            ok: true,
            value: { id: "settings-new" },
        });

        expect(settingsWrites).toHaveLength(1);
        expect(settingsWrites[0].items.map((item) => item.id)).toEqual(["settings-new", "settings-live"]);
        expect(settingsWrites[0].items.some((item) => isMemoryType(item.type))).toBe(false);
        const afterDevice = await repository.initialize();
        expect(afterDevice.memoryQueueItems).toEqual(beforeDevice.memoryQueueItems);
        expect(afterDevice.migrationDeltas).toEqual(beforeDevice.migrationDeltas);
    });

    it("fails closed before either store changes when one write changes both partitions", async () => {
        const repository = deviceRepository(createCompatibilityState([deviceItem("memory-a", "vault-a")]));
        const settingsPersist = jest.fn(async () => undefined);
        const settings = new CallbackReviewQueueRepository(
            [queueItem("settings-live", "evidence_insight")],
            settingsPersist,
        );
        const adapter = await createMemoryReviewQueueRepository({
            repository,
            settingsRepository: settings,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
        });
        const before = adapter.read();
        const next = cloneState(before);
        next.items = next.items.map((item) => ({
            ...item,
            status: "accepted",
            updatedAt: NOW.toISOString(),
        }));
        const beforeDevice = await repository.initialize();

        await expect(adapter.write(next)).rejects.toEqual(expect.objectContaining({
            code: "cross_partition_write_not_atomic",
        }));
        expect(adapter.read()).toEqual(before);
        expect(settingsPersist).not.toHaveBeenCalled();
        expect(await repository.initialize()).toEqual(beforeDevice);
    });

    it("publishes caches only after settings and local commits succeed", async () => {
        const base = deviceRepository(createCompatibilityState([deviceItem("memory-a", "vault-a")]));
        let failSettings = true;
        const settings = new CallbackReviewQueueRepository(
            [queueItem("settings-live", "evidence_insight")],
            async () => {
                if (failSettings) throw new Error("settings failed");
            },
        );
        const adapter = await createMemoryReviewQueueRepository({
            repository: base,
            settingsRepository: settings,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
        });
        const store = new ReviewQueueStore({ repository: adapter, idFactory: () => "new-settings", now: () => NOW });
        const before = store.snapshot();

        await expect(store.create(createInput("evidence_insight"))).rejects.toThrow("settings failed");
        expect(store.snapshot()).toEqual(before);
        expect(adapter.read()).toEqual(before);
        failSettings = false;

        const failingLocal: MemoryGovernanceRepository = {
            initialize: () => base.initialize(),
            transact: async () => { throw new Error("local failed"); },
            subscribe: (listener) => base.subscribe(listener),
            dispose: () => Promise.resolve(),
        };
        const localAdapter = await createMemoryReviewQueueRepository({
            repository: failingLocal,
            settingsRepository: settings,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
        });
        const localStore = new ReviewQueueStore({ repository: localAdapter, now: () => NOW });
        const localBefore = localStore.snapshot();
        await expect(localStore.updateStatus("memory-a", "accepted")).rejects.toThrow("local failed");
        expect(localStore.snapshot()).toEqual(localBefore);
        expect(localAdapter.read()).toEqual(localBefore);
        expect((await base.initialize()).memoryQueueItems.find((item) => item.id === "memory-a")?.status)
            .toBe("suggested");
    });

    it("round-trips Memory create and status deltas through canonical rollback payloads", async () => {
        const repository = deviceRepository(createCompatibilityState([]));
        const settings = new CallbackReviewQueueRepository([queueItem("settings-live", "evidence_insight")]);
        const adapter = await createMemoryReviewQueueRepository({
            repository,
            settingsRepository: settings,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
        });
        const store = new ReviewQueueStore({
            repository: adapter,
            idFactory: () => "memory-new",
            now: () => NOW,
        });

        await expect(store.create(createInput("memory_candidate"))).resolves.toMatchObject({
            ok: true,
            value: { id: "memory-new", status: "suggested" },
        });
        await expect(store.updateStatus("memory-new", "accepted")).resolves.toMatchObject({
            ok: true,
            value: { status: "accepted" },
        });

        const state = await repository.initialize();
        expect(state.migrationDeltas).toEqual([
            expect.objectContaining({ sequence: 1, kind: "queue_changed", entityId: "memory-new" }),
            expect.objectContaining({ sequence: 2, kind: "queue_changed", entityId: "memory-new" }),
        ]);
        for (const delta of state.migrationDeltas) {
            const payload = state.rollbackPayloadEntries.find((entry) => entry.id === delta.payloadEntryId);
            expect(payload).toMatchObject({
                migrationRunId: "run-vault-a",
                partition: { kind: "vault", key: "vault-a" },
                entityId: "memory-new",
                expiresAt: EXPIRES,
            });
            expect(payload?.checksum).toBe(checksumLegacyRollbackValue(payload!.value));
        }
        expect(buildLegacyMemoryRollbackProjection(state, "vault-a", NOW)).toMatchObject({
            ok: true,
            lastDeltaSequence: 2,
            projection: {
                memoryQueueItems: [expect.objectContaining({ id: "memory-new", status: "accepted" })],
            },
        });
    });

    it("preserves a migrated legacy queue id across status-delta replay and restart", async () => {
        const local = deviceItem("local-memory", "vault-a");
        const state = createCompatibilityState([local]);
        const baseQueue = state.rollbackPayloadEntries.find((entry) => entry.entityId === local.id)!;
        baseQueue.value = { kind: "memory_queue", item: queueItem("legacy-memory", "memory_candidate") };
        baseQueue.checksum = checksumLegacyRollbackValue(baseQueue.value);
        const repository = deviceRepository(state);
        const settings = new CallbackReviewQueueRepository([queueItem("settings-live", "evidence_insight")]);
        const first = await createMemoryReviewQueueRepository({
            repository,
            settingsRepository: settings,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
        });
        const store = new ReviewQueueStore({ repository: first, now: () => NOW });

        await store.updateStatus("local-memory", "accepted");
        const restarted = await createMemoryReviewQueueRepository({
            repository,
            settingsRepository: settings,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
        });
        const returned = restarted.read();
        returned.items[0].claim = "mutated caller copy";

        const persisted = await repository.initialize();
        const delta = persisted.migrationDeltas.at(-1)!;
        const payload = persisted.rollbackPayloadEntries.find((entry) => entry.id === delta.payloadEntryId)!;
        expect(payload.value).toMatchObject({
            kind: "memory_queue",
            item: { id: "legacy-memory", status: "accepted" },
        });
        expect(restarted.read().items.find((item) => item.id === "local-memory")).toMatchObject({
            claim: local.claim,
            status: "accepted",
        });
        expect(buildLegacyMemoryRollbackProjection(persisted, "vault-a", NOW)).toMatchObject({
            ok: true,
            projection: {
                memoryQueueItems: [expect.objectContaining({ id: "legacy-memory", status: "accepted" })],
            },
        });
    });

    it("blocks Memory writes while migration is rolling back", async () => {
        const repository = deviceRepository(createCompatibilityState(
            [deviceItem("memory-a", "vault-a")],
            "rolling_back",
        ));
        const adapter = await createMemoryReviewQueueRepository({
            repository,
            settingsRepository: new CallbackReviewQueueRepository(),
            opaqueVaultKey: "vault-a",
            now: () => NOW,
        });
        const next = adapter.read();
        next.items[0].status = "accepted";

        await expect(adapter.write(next)).rejects.toEqual(expect.objectContaining({
            code: "memory_migration_rolling_back",
        }));
        expect(adapter.read().items[0].status).toBe("suggested");
    });

    it.each([
        ["finalized", NOW],
        ["compatibility", new Date("2026-07-19T08:00:00.000Z")],
    ] as const)("keeps governed Memory queue writable in %s after rollback journaling ends", async (phase, now) => {
        const repository = deviceRepository(createCompatibilityState(
            [deviceItem("memory-a", "vault-a")],
            phase,
        ));
        const before = await repository.initialize();
        const adapter = await createMemoryReviewQueueRepository({
            repository,
            settingsRepository: new CallbackReviewQueueRepository(),
            opaqueVaultKey: "vault-a",
            now: () => now,
        });
        const next = adapter.read();
        next.items[0].status = "accepted";

        await expect(adapter.write(next)).resolves.toBeUndefined();
        const after = await repository.initialize();
        expect(after.memoryQueueItems[0].status).toBe("accepted");
        expect(after.migrationDeltas).toEqual(before.migrationDeltas);
        expect(after.rollbackPayloadEntries).toEqual(before.rollbackPayloadEntries);
    });

    it("blocks Memory deletion because the rollback delta schema cannot represent it", async () => {
        const repository = deviceRepository(createCompatibilityState([deviceItem("memory-a", "vault-a")]));
        const adapter = await createMemoryReviewQueueRepository({
            repository,
            settingsRepository: new CallbackReviewQueueRepository(),
            opaqueVaultKey: "vault-a",
            now: () => NOW,
        });

        await expect(adapter.write({ items: [] })).rejects.toEqual(expect.objectContaining({
            code: "memory_queue_delete_not_representable",
        }));
        expect(adapter.read().items).toHaveLength(1);
        expect((await repository.initialize()).memoryQueueItems).toHaveLength(1);
    });

    it("exposes typed fail-closed diagnostics without queue content", () => {
        const error = new MemoryReviewQueueRepositoryError("memory_migration_not_writable");
        expect(error).toMatchObject({
            code: "memory_migration_not_writable",
            message: "Memory review queue repository failed: memory_migration_not_writable",
        });
    });
});

function createCompatibilityState(
    items: DeviceMemoryQueueItem[],
    phase: MemoryMigrationState["phase"] = "compatibility",
): DeviceMemoryGovernanceStateV1 {
    const state = createEmptyDeviceMemoryGovernanceStateV1();
    state.memoryQueueItems = items;
    for (const vaultKey of new Set(items.map((item) => item.partition.kind === "vault" ? item.partition.key : ""))) {
        if (vaultKey) addVaultMigration(state, vaultKey, phase);
    }
    if (!state.migrationStates["vault-a"]) addVaultMigration(state, "vault-a", phase);
    for (const item of items) {
        if (item.partition.kind !== "vault") continue;
        state.rollbackPayloadEntries.push(rollbackEntry(
            `base-queue-${item.partition.key}-${item.id}`,
            `run-${item.partition.key}`,
            item.partition.key,
            item.id,
            { kind: "memory_queue", item: withoutPartition(item) },
        ));
    }
    return state;
}

function addVaultMigration(
    state: DeviceMemoryGovernanceStateV1,
    vaultKey: string,
    phase: MemoryMigrationState["phase"],
): void {
    const runId = `run-${vaultKey}`;
    state.migrationStates[vaultKey] = {
        migrationRunId: runId,
        phase,
        sourceHash: `source-${vaultKey}`,
        cutoverSequence: 1,
        rollbackExpiresAt: EXPIRES,
    };
    state.policyStates[vaultKey] = {
        version: 1,
        mode: "legacy_threshold",
        contextProjectionMode: "governed",
        legacyBaseline: {
            confirmedCount: 0,
            threshold: 30,
            autoAcceptPaused: false,
            importedFromSourceHash: `source-${vaultKey}`,
        },
    };
    state.rollbackPayloadEntries.push(rollbackEntry(
        `base-policy-${vaultKey}`,
        runId,
        vaultKey,
        `policy-${vaultKey}`,
        { kind: "policy", confirmedMemoryCount: 0, memoryAutoAcceptPaused: false },
    ));
}

function rollbackEntry(
    id: string,
    migrationRunId: string,
    vaultKey: string,
    entityId: string,
    value: LegacyRollbackValue,
): MemoryRollbackPayloadEntry {
    return {
        id,
        migrationRunId,
        partition: { kind: "vault", key: vaultKey },
        entityId,
        value,
        checksum: checksumLegacyRollbackValue(value),
        expiresAt: EXPIRES,
    };
}

function deviceRepository(state: DeviceMemoryGovernanceStateV1): InMemoryMemoryGovernanceRepository {
    return new InMemoryMemoryGovernanceRepository(new InMemoryMemoryGovernanceBackend(state));
}

function deviceItem(
    id: string,
    vaultKey: string,
    type: DeviceMemoryQueueItem["type"] = "memory_candidate",
): DeviceMemoryQueueItem {
    return {
        ...queueItem(id, type),
        type,
        partition: { kind: "vault", key: vaultKey },
    };
}

function queueItem(
    id: string,
    type: ReviewQueueItem["type"],
): ReviewQueueItem {
    return {
        id,
        type,
        title: `Title ${id}`,
        claim: `Claim ${id}`,
        scope: { kind: "current_note", paths: [`notes/${id}.md`] },
        sourceRefs: [{ path: `notes/${id}.md` }],
        originSurface: "pagelet",
        priority: "normal",
        status: "suggested",
        createdAt: "2026-07-11T07:00:00.000Z",
        updatedAt: "2026-07-11T07:00:00.000Z",
        whyShown: [],
        dataBoundarySnapshotId: "boundary",
        admissionReason: isMemoryType(type)
            ? "memory_confirmation_required"
            : "user_kept_for_later",
        metadata: {},
    };
}

function createInput(type: "memory_candidate" | "evidence_insight"): ReviewQueueCreateInput {
    const input: ReviewQueueCreateInput = {
        type,
        title: `New ${type}`,
        claim: `Claim ${type}`,
        scope: { kind: "current_note" as const, paths: ["notes/new.md"] },
        sourceRefs: [{ path: "notes/new.md" }],
        originSurface: "pagelet" as const,
        dataBoundarySnapshotId: "boundary",
        admissionReason: type === "memory_candidate"
            ? "memory_confirmation_required" as const
            : "user_kept_for_later" as const,
    };
    if (type === "memory_candidate") {
        input.metadata = { memoryType: "preference", sensitivity: "low" };
    }
    return input;
}

function isMemoryType(type: ReviewQueueItem["type"]): boolean {
    return type === "memory_candidate" || type === "memory_conflict";
}

function cloneState(state: ReviewQueueState): ReviewQueueState {
    return JSON.parse(JSON.stringify(state)) as ReviewQueueState;
}

function withoutPartition(item: DeviceMemoryQueueItem): ReviewQueueItem {
    const value = JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
    delete value.partition;
    return value as unknown as ReviewQueueItem;
}
