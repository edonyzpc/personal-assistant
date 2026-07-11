import { checksumLegacyRollbackValue } from "../src/pa/memory-governance-migration-coordinator";
import {
    DeviceMemoryGovernanceRecordRepositoryError,
    createDeviceMemoryGovernanceRecordRepository,
} from "../src/pa/memory-governance-record-repository";
import {
    InMemoryMemoryGovernanceBackend,
    InMemoryMemoryGovernanceRepository,
    createEmptyDeviceMemoryGovernanceStateV1,
    type DeviceMemoryGovernanceStateV1,
    type LegacyRollbackValue,
    type MemoryGovernanceRepository,
    type MemoryRollbackPayloadEntry,
} from "../src/pa/memory-governance-persistence";
import {
    MemoryGovernanceStore,
    type ConfirmedMemoryRecord,
} from "../src/pa/memory-governance-store";

const NOW = new Date("2026-07-11T08:00:00.000Z");
const EXPIRES = "2026-07-18T08:00:00.000Z";

describe("DeviceMemoryGovernanceRecordRepository", () => {
    it("preserves current MemoryGovernanceStore behavior and metadata across restart", async () => {
        const backend = new InMemoryMemoryGovernanceBackend(createCompatibilityState([
            record("legacy-a", { validFrom: "2026-07-01", updatePolicy: "manual-only" }),
        ]));
        const device = new InMemoryMemoryGovernanceRepository(backend);
        const adapter = await createAdapter(device, "vault-a", "source-a");
        const store = new MemoryGovernanceStore({ repository: adapter, now: () => NOW });

        await expect(store.archive("legacy-a")).resolves.toMatchObject({
            ok: true,
            value: expect.objectContaining({ lifecycle: "archived" }),
        });
        expect(adapter.read().records[0]).toMatchObject({
            id: "legacy-a",
            lifecycle: "archived",
            validFrom: "2026-07-01",
            updatePolicy: "manual-only",
        });

        adapter.dispose();
        const restarted = await createAdapter(device, "vault-a", "source-a");
        expect(restarted.read().records[0]).toMatchObject({
            id: "legacy-a",
            lifecycle: "archived",
            validFrom: "2026-07-01",
            updatePolicy: "manual-only",
        });
        const state = await device.initialize();
        const claim = state.claims.find((entry) => entry.partition.kind === "vault" && entry.partition.key === "vault-a");
        expect(claim).toMatchObject({ lifecycle: "archived", effect: "stored_not_in_use" });
        expect(state.revisions.filter((entry) => entry.claimId === claim?.id)).toHaveLength(2);
        restarted.dispose();
    });

    it("maps an add to a vault claim/revision and only creates an exact queue-origin link", async () => {
        const initial = createCompatibilityState([]);
        initial.memoryQueueItems.push(memoryQueueItem("queue-exact", "vault-a"));
        const device = new InMemoryMemoryGovernanceRepository(new InMemoryMemoryGovernanceBackend(initial));
        const adapter = await createAdapter(device, "vault-a", "source-a");
        const added = record("new-a", {
            originReviewQueueItemId: "queue-exact",
            confirmationStrength: "auto",
            confirmationSource: "chat",
            updatePolicy: "suggest-update-on-conflict",
        });

        await adapter.write({ records: [added] });

        const state = await device.initialize();
        const claim = state.claims.find((entry) => entry.partition.kind === "vault"
            && entry.partition.key === "vault-a" && entry.memoryType === added.type);
        expect(claim).toMatchObject({
            effect: "stored_not_in_use",
            lifecycle: "active",
            partition: { kind: "vault", key: "vault-a" },
        });
        expect(state.revisions.find((entry) => entry.id === claim?.activeRevisionId)).toMatchObject({
            summary: added.summary,
            authority: "pa_inference",
        });
        expect(state.projectionLinks).toContainEqual(expect.objectContaining({
            claimId: claim?.id,
            target: { kind: "review_queue", itemId: "queue-exact" },
            relation: "origin",
        }));
        expect(adapter.read().records[0]).toMatchObject({
            confirmationSource: "chat",
            updatePolicy: "suggest-update-on-conflict",
        });
        adapter.dispose();
    });

    it("fails closed instead of fuzzy-linking a missing origin queue id", async () => {
        const device = repositoryWithState(createCompatibilityState([]));
        const adapter = await createAdapter(device, "vault-a", "source-a");

        await expect(adapter.write({
            records: [record("new-a", { originReviewQueueItemId: "similar-but-missing" })],
        })).rejects.toMatchObject({ code: "origin_queue_item_missing" });
        expect(adapter.read().records).toEqual([]);
        expect((await device.initialize()).claims).toEqual([]);
        adapter.dispose();
    });

    it("forgets without leaving revision, source, link, undo, or rollback content", async () => {
        const initial = createCompatibilityState([record("legacy-a")]);
        const claimId = initial.claims[0].id;
        const revisionId = initial.revisions[0].id;
        initial.projectionLinks.push({
            id: "link-a",
            claimId,
            target: { kind: "prompt_projection", projectionId: "prompt-a" },
            relation: "derived_copy",
            state: "active",
            createdAt: NOW.toISOString(),
        });
        initial.changeEvents.push({
            id: "event-a",
            claimId,
            kind: "correct",
            scopeKey: "vault-a",
            effect: "stored_not_in_use",
            occurredAt: NOW.toISOString(),
            undoSnapshotId: "undo-a",
        });
        initial.undoSnapshots.push({
            id: "undo-a",
            claimId,
            eventId: "event-a",
            partition: { kind: "vault", key: "vault-a" },
            claim: { ...initial.claims[0] },
            revisions: [{ ...initial.revisions[0], provenance: [...initial.revisions[0].provenance] }],
            projectionLinks: [],
            createdAt: NOW.toISOString(),
            expiresAt: EXPIRES,
        });
        const prior = rollbackEntry("delta-prior", "run-vault-a", "vault-a", claimId, {
            kind: "claim",
            record: record("legacy-a", { summary: "Earlier private summary" }),
        });
        initial.rollbackPayloadEntries.push(prior);
        initial.migrationDeltas.push({
            sequence: 1,
            migrationRunId: "run-vault-a",
            partition: { kind: "vault", key: "vault-a" },
            committedAt: NOW.toISOString(),
            kind: "claim_changed",
            entityId: claimId,
            payloadEntryId: prior.id,
            payloadChecksum: prior.checksum,
        });
        const device = repositoryWithState(initial);
        const adapter = await createAdapter(device, "vault-a", "source-a");
        const store = new MemoryGovernanceStore({ repository: adapter, now: () => NOW });

        await expect(store.forget("legacy-a")).resolves.toMatchObject({ ok: true });

        const state = await device.initialize();
        expect(state.claims.find((entry) => entry.id === claimId)).toMatchObject({
            lifecycle: "forgotten_tombstone",
            effect: "none",
        });
        expect(state.claims.find((entry) => entry.id === claimId)).not.toHaveProperty("activeRevisionId");
        expect(state.revisions.some((entry) => entry.claimId === claimId)).toBe(false);
        expect(state.projectionLinks.some((entry) => entry.claimId === claimId)).toBe(false);
        expect(state.undoSnapshots.some((entry) => entry.claimId === claimId)).toBe(false);
        expect(state.rollbackPayloadEntries.some((entry) => entry.entityId === claimId
            || (entry.value.kind === "claim" && entry.value.record.id === "legacy-a"))).toBe(false);
        const claimDeltas = state.migrationDeltas.filter((entry) => entry.entityId === claimId);
        expect(claimDeltas).toHaveLength(2);
        expect(claimDeltas.every((entry) => entry.kind === "claim_forgotten"
            && !entry.payloadEntryId && !entry.payloadChecksum)).toBe(true);
        expect(state.changeEvents.find((entry) => entry.id === "event-a")).toMatchObject({
            effect: "none",
        });
        expect(state.changeEvents.find((entry) => entry.id === "event-a"))
            .not.toHaveProperty("undoSnapshotId");
        expect(adapter.read().records).toEqual([]);
        expect(state.revisions.some((entry) => entry.id === revisionId)).toBe(false);
        adapter.dispose();
    });

    it("keeps the legacy store writable after its in-memory tombstone is no longer projected", async () => {
        const device = repositoryWithState(createCompatibilityState([record("legacy-a")]));
        const adapter = await createAdapter(device, "vault-a", "source-a");
        const store = new MemoryGovernanceStore({
            repository: adapter,
            now: () => NOW,
            idFactory: () => "after-forget",
        });

        await expect(store.forget("legacy-a")).resolves.toMatchObject({ ok: true });
        await expect(store.confirmCandidate({
            id: "candidate-a",
            type: "preference",
            lifecycle: "candidate",
            sensitivity: "low",
            scope: "notes/source.md",
            sourceRefs: [{ path: "notes/source.md" }],
            createdAt: NOW.toISOString(),
            summary: "A new confirmed preference",
        }, {
            scope: { kind: "current_note", paths: ["notes/source.md"] },
        })).resolves.toMatchObject({ ok: true });

        expect(adapter.read().records.map((entry) => entry.id)).toEqual(["after-forget"]);
        adapter.dispose();
        const restarted = await createAdapter(device, "vault-a", "source-a");
        expect(restarted.read().records.map((entry) => entry.id)).toEqual(["after-forget"]);
        restarted.dispose();
    });

    it("refreshes stale state before writes, preserves unrelated concurrent adds, and rejects same-record conflicts", async () => {
        const device = repositoryWithState(createCompatibilityState([record("base")]));
        const first = await createAdapter(device, "vault-a", "source-a");
        const second = await createAdapter(device, "vault-a", "source-a");

        await first.write({ records: [...first.read().records, record("from-first")] });
        expect(second.isStale()).toBe(true);
        await second.write({ records: [...second.read().records, record("from-second")] });
        expect(second.read().records.map((entry) => entry.id).sort()).toEqual([
            "base",
            "from-first",
            "from-second",
        ]);

        const firstBase = first.read();
        const secondBase = second.read();
        await first.write({ records: firstBase.records.map((entry) => entry.id === "base"
            ? { ...entry, summary: "First update", updatedAt: "2026-07-11T09:00:00.000Z" }
            : entry) });
        await expect(second.write({ records: secondBase.records.map((entry) => entry.id === "base"
            ? { ...entry, summary: "Second update", updatedAt: "2026-07-11T09:01:00.000Z" }
            : entry) })).rejects.toMatchObject({ code: "stale_record_conflict" });

        const refreshed = await second.refresh();
        expect(refreshed.records.find((entry) => entry.id === "base")?.summary).toBe("First update");
        first.dispose();
        second.dispose();
    });

    it("isolates two vault adapters sharing one device repository", async () => {
        const combined = createCompatibilityState([record("a")], "vault-a", "source-a");
        mergeCompatibilityState(combined, createCompatibilityState([record("b")], "vault-b", "source-b"));
        const device = repositoryWithState(combined);
        const vaultA = await createAdapter(device, "vault-a", "source-a");
        const vaultB = await createAdapter(device, "vault-b", "source-b");

        await vaultA.write({ records: [{ ...vaultA.read().records[0], summary: "A changed" }] });

        expect((await vaultB.refresh()).records).toEqual([record("b")]);
        expect(vaultA.read().records[0].summary).toBe("A changed");
        vaultA.dispose();
        vaultB.dispose();
    });

    it("does not advance cache when persistence fails", async () => {
        const underlying = repositoryWithState(createCompatibilityState([record("base")]));
        const failing: MemoryGovernanceRepository = {
            initialize: () => underlying.initialize(),
            transact: async () => { throw new Error("disk failed"); },
            subscribe: (listener) => underlying.subscribe(listener),
            dispose: () => Promise.resolve(),
        };
        const adapter = await createAdapter(failing, "vault-a", "source-a");

        await expect(adapter.write({ records: [record("base"), record("new")] })).rejects.toThrow("disk failed");
        expect(adapter.read().records).toEqual([record("base")]);
        adapter.dispose();
    });

    it("writes canonical checksummed recovery payloads that round-trip all metadata", async () => {
        const device = repositoryWithState(createCompatibilityState([record("base")]));
        const adapter = await createAdapter(device, "vault-a", "source-a");
        const updated = record("base", {
            summary: "Updated",
            validUntil: "2027-01-01",
            lastVerified: "2026-07-11",
            confirmationStrength: "special",
        });

        await adapter.write({ records: [updated] });

        const state = await device.initialize();
        const delta = state.migrationDeltas.at(-1)!;
        const payload = state.rollbackPayloadEntries.find((entry) => entry.id === delta.payloadEntryId)!;
        expect(payload.checksum).toBe(checksumLegacyRollbackValue(payload.value));
        expect(delta.payloadChecksum).toBe(payload.checksum);
        expect((payload.value as Extract<LegacyRollbackValue, { kind: "claim" }>).record).toEqual(updated);
        expect(state.migrationStates["vault-a"].lastAppliedDeltaSequence).toBe(0);
        adapter.dispose();
    });

    it.each(["rolling_back", "rolled_back", "finalized"] as const)(
        "fails closed during migration phase %s",
        async (phase) => {
            const state = createCompatibilityState([record("base")]);
            state.migrationStates["vault-a"].phase = phase;
            await expect(createAdapter(repositoryWithState(state), "vault-a", "source-a"))
                .rejects.toBeInstanceOf(DeviceMemoryGovernanceRecordRepositoryError);
        },
    );

    it("fails closed when the compatibility source hash differs", async () => {
        await expect(createAdapter(
            repositoryWithState(createCompatibilityState([record("base")])),
            "vault-a",
            "different-source",
        )).rejects.toMatchObject({ code: "migration_source_mismatch" });
    });

    it("fails closed when compatibility has a recorded migration error", async () => {
        const state = createCompatibilityState([record("base")]);
        state.migrationStates["vault-a"].lastErrorCode = "migration_readback_mismatch";
        await expect(createAdapter(repositoryWithState(state), "vault-a", "source-a"))
            .rejects.toMatchObject({ code: "migration_phase_blocked" });
    });

    it("returns clone-safe reads", async () => {
        const adapter = await createAdapter(
            repositoryWithState(createCompatibilityState([record("base")])),
            "vault-a",
            "source-a",
        );
        const first = adapter.read();
        first.records[0].scope.paths!.push("mutated.md");
        first.records[0].sourceRefs[0].whyShown!.push("mutated");
        expect(adapter.read()).toEqual({ records: [record("base")] });
        adapter.dispose();
    });
});

function createAdapter(repository: MemoryGovernanceRepository, vaultKey: string, sourceHash: string) {
    return createDeviceMemoryGovernanceRecordRepository({
        repository,
        opaqueVaultKey: vaultKey,
        expectedSourceHash: sourceHash,
        now: () => NOW,
    });
}

function repositoryWithState(state: DeviceMemoryGovernanceStateV1): InMemoryMemoryGovernanceRepository {
    return new InMemoryMemoryGovernanceRepository(new InMemoryMemoryGovernanceBackend(state));
}

function record(id: string, overrides: Partial<ConfirmedMemoryRecord> = {}): ConfirmedMemoryRecord {
    return {
        id,
        type: "preference",
        lifecycle: "active",
        sensitivity: "low",
        scope: { kind: "selected_notes", paths: [`notes/${id}.md`] },
        sourceRefs: [{ path: `notes/${id}.md`, whyShown: ["source"] }],
        summary: `Summary ${id}`,
        createdAt: "2026-07-01T08:00:00.000Z",
        updatedAt: "2026-07-10T08:00:00.000Z",
        confirmedAt: "2026-07-01T08:00:00.000Z",
        confirmationSource: "pagelet",
        confirmationStrength: "explicit",
        ...overrides,
    };
}

function createCompatibilityState(
    records: ConfirmedMemoryRecord[],
    vaultKey = "vault-a",
    sourceHash = "source-a",
): DeviceMemoryGovernanceStateV1 {
    const state = createEmptyDeviceMemoryGovernanceStateV1();
    const runId = `run-${vaultKey}`;
    const partition = { kind: "vault" as const, key: vaultKey };
    state.policyStates[vaultKey] = {
        version: 1,
        mode: "legacy_threshold",
        contextProjectionMode: "legacy",
        legacyBaseline: {
            confirmedCount: 0,
            threshold: 30,
            autoAcceptPaused: false,
            importedFromSourceHash: sourceHash,
        },
    };
    state.migrationStates[vaultKey] = {
        migrationRunId: runId,
        phase: "compatibility",
        sourceHash,
        cutoverSequence: 1,
        rollbackExpiresAt: EXPIRES,
        lastAppliedDeltaSequence: 0,
    };
    state.rollbackPayloadEntries.push(rollbackEntry(
        `base-policy-${vaultKey}`,
        runId,
        vaultKey,
        `policy-${vaultKey}`,
        { kind: "policy", confirmedMemoryCount: 0, memoryAutoAcceptPaused: false },
    ));
    for (const item of records) {
        const claimId = `claim-${vaultKey}-${item.id}`;
        const revisionId = `revision-${vaultKey}-${item.id}`;
        state.claims.push({
            id: claimId,
            partition,
            memoryType: item.type,
            sensitivity: item.sensitivity,
            applicability: clone(item.scope),
            activeRevisionId: revisionId,
            effect: "stored_not_in_use",
            lifecycle: item.lifecycle === "archived" ? "archived" : item.lifecycle === "stale" ? "stale" : "active",
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
        });
        state.revisions.push({
            id: revisionId,
            claimId,
            summary: item.summary,
            provenance: item.sourceRefs.map((sourceRef) => ({ kind: "note", sourceRef: clone(sourceRef) })),
            authority: item.confirmationStrength === "auto" ? "pa_inference" : "explicit_user",
            createdAt: item.confirmedAt ?? item.createdAt,
        });
        state.rollbackPayloadEntries.push(rollbackEntry(
            `base-${vaultKey}-${item.id}`,
            runId,
            vaultKey,
            claimId,
            { kind: "claim", record: clone(item) },
        ));
    }
    return state;
}

function rollbackEntry(
    id: string,
    runId: string,
    vaultKey: string,
    entityId: string,
    value: LegacyRollbackValue,
): MemoryRollbackPayloadEntry {
    return {
        id,
        migrationRunId: runId,
        partition: { kind: "vault", key: vaultKey },
        entityId,
        value,
        checksum: checksumLegacyRollbackValue(value),
        expiresAt: EXPIRES,
    };
}

function memoryQueueItem(id: string, vaultKey: string) {
    return {
        id,
        type: "memory_candidate" as const,
        partition: { kind: "vault" as const, key: vaultKey },
        title: "Candidate",
        claim: "Candidate claim",
        scope: { kind: "current_note" as const, paths: ["notes/source.md"] },
        sourceRefs: [{ path: "notes/source.md" }],
        originSurface: "pagelet" as const,
        priority: "normal" as const,
        status: "suggested" as const,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
        whyShown: [],
        dataBoundarySnapshotId: "boundary",
        admissionReason: "memory_confirmation_required" as const,
    };
}

function mergeCompatibilityState(
    target: DeviceMemoryGovernanceStateV1,
    source: DeviceMemoryGovernanceStateV1,
): void {
    target.claims.push(...source.claims);
    target.revisions.push(...source.revisions);
    target.memoryQueueItems.push(...source.memoryQueueItems);
    target.projectionLinks.push(...source.projectionLinks);
    target.changeEvents.push(...source.changeEvents);
    target.undoSnapshots.push(...source.undoSnapshots);
    target.suppressionMarkers.push(...source.suppressionMarkers);
    target.pendingOperations.push(...source.pendingOperations);
    Object.assign(target.policyStates, source.policyStates);
    Object.assign(target.migrationStates, source.migrationStates);
    target.migrationDeltas.push(...source.migrationDeltas);
    target.rollbackPayloadEntries.push(...source.rollbackPayloadEntries);
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}
