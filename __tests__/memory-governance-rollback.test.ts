import {
    MemoryGovernanceRollbackCoordinator,
    buildLegacyMemoryRollbackProjection,
    type LegacyMemoryRollbackProjection,
} from "../src/pa/memory-governance-rollback";
import { MemoryGovernanceCoordinator } from "../src/pa/memory-governance-coordinator";
import {
    checksumLegacyRollbackValue,
    MemoryGovernanceMigrationCoordinator,
    type ClassifiedLegacyTypeAAdoption,
} from "../src/pa/memory-governance-migration-coordinator";
import type { LegacyMemoryPayload } from "../src/pa/memory-governance-migration";
import {
    InMemoryMemoryGovernanceBackend,
    InMemoryMemoryGovernanceRepository,
    createEmptyDeviceMemoryGovernanceStateV1,
    type DeviceMemoryGovernanceStateV1,
    type LegacyRollbackValue,
    type MemoryGovernanceRepository,
    type MemoryGovernanceTransaction,
    type MemoryMigrationDelta,
    type MemoryRollbackPayloadEntry,
} from "../src/pa/memory-governance-persistence";
import type { ConfirmedMemoryRecord } from "../src/pa/memory-governance-store";
import type { ReviewQueueItem } from "../src/pa/review-queue-store";

const NOW = new Date("2026-07-10T08:00:00.000Z");
const EXPIRES = "2026-07-17T08:00:00.000Z";
const PARTITION = { kind: "vault" as const, key: "vault-a" };

function claim(id: string, summary = `Summary ${id}`): ConfirmedMemoryRecord {
    return {
        id,
        type: "preference",
        lifecycle: "active",
        sensitivity: "low",
        scope: { kind: "whole_vault", paths: undefined, tags: undefined },
        summary,
        sourceRefs: [{ path: `notes/${id}.md`, whyShown: undefined }],
        createdAt: "2026-07-01T08:00:00.000Z",
        updatedAt: "2026-07-09T08:00:00.000Z",
    };
}

function queueItem(id: string, title = id): ReviewQueueItem {
    return {
        id,
        type: "memory_candidate",
        title,
        claim: `Claim ${id}`,
        scope: { kind: "current_note", paths: [`notes/${id}.md`] },
        sourceRefs: [{ path: `notes/${id}.md`, whyShown: undefined }],
        originSurface: "pagelet",
        priority: "normal",
        status: "suggested",
        createdAt: "2026-07-01T08:00:00.000Z",
        updatedAt: "2026-07-01T08:00:00.000Z",
        whyShown: [],
        dataBoundarySnapshotId: "boundary",
        admissionReason: "memory_confirmation_required",
        metadata: {},
    };
}

function migrationPayload(
    recordId: string,
    confirmedMemoryCount: number,
    memoryAutoAcceptPaused: boolean,
): LegacyMemoryPayload {
    return {
        memoryGovernance: { records: [claim(recordId)] },
        reviewQueue: { enabled: true, items: [] },
        confirmedMemoryCount,
        memoryAutoAcceptPaused,
    };
}

function typeAAdoption(
    profileRecordId: string,
    summary: string,
): Extract<ClassifiedLegacyTypeAAdoption, { status: "adopt" }> {
    return {
        status: "adopt",
        profileRecordId,
        summary,
        applicability: { kind: "whole_vault" },
        authority: "explicit_user",
        provenance: [{
            kind: "conversation",
            conversationIds: [`conversation-${profileRecordId}`],
            observedAt: NOW.toISOString(),
        }],
        observedAt: NOW.toISOString(),
        profileProjectionState: "applied",
    };
}

function ids(prefix: string): () => string {
    let index = 0;
    return () => `${prefix}-${++index}`;
}

function payload(
    id: string,
    entityId: string,
    value: LegacyRollbackValue,
): MemoryRollbackPayloadEntry {
    return {
        id,
        migrationRunId: "run-a",
        partition: PARTITION,
        entityId,
        value,
        checksum: checksumLegacyRollbackValue(value),
        expiresAt: EXPIRES,
    };
}

function delta(
    sequence: number,
    kind: MemoryMigrationDelta["kind"],
    entityId: string,
    entry?: MemoryRollbackPayloadEntry,
): MemoryMigrationDelta {
    return {
        sequence,
        migrationRunId: "run-a",
        partition: PARTITION,
        committedAt: NOW.toISOString(),
        kind,
        entityId,
        ...(entry ? { payloadEntryId: entry.id, payloadChecksum: entry.checksum } : {}),
    };
}

function state(): DeviceMemoryGovernanceStateV1 {
    const base = createEmptyDeviceMemoryGovernanceStateV1();
    const baseClaim = payload("base-claim", "entity-1", { kind: "claim", record: claim("legacy-1") });
    const forgottenClaim = payload("base-forget", "entity-forget", { kind: "claim", record: claim("legacy-forget") });
    const baseQueue = payload("base-queue", "queue-1", { kind: "memory_queue", item: queueItem("queue-1") });
    const basePolicy = payload("base-policy", "policy-a", {
        kind: "policy",
        confirmedMemoryCount: 30,
        memoryAutoAcceptPaused: false,
    });
    return {
        ...base,
        commitSequence: 5,
        policyStates: {
            "vault-a": {
                version: 1,
                mode: "legacy_threshold",
                contextProjectionMode: "governed",
                legacyBaseline: {
                    confirmedCount: 30,
                    threshold: 30,
                    autoAcceptPaused: false,
                    importedFromSourceHash: "source",
                },
            },
        },
        migrationStates: {
            "vault-a": {
                migrationRunId: "run-a",
                phase: "compatibility",
                sourceHash: "source",
                cutoverSequence: 3,
                rollbackExpiresAt: EXPIRES,
                lastAppliedDeltaSequence: 0,
            },
        },
        rollbackPayloadEntries: [baseClaim, forgottenClaim, baseQueue, basePolicy],
    };
}

describe("buildLegacyMemoryRollbackProjection", () => {
    it("replays add/change/forget/queue/policy deltas in sequence", () => {
        const input = state();
        const changed = payload("delta-change", "entity-1", {
            kind: "claim",
            record: claim("legacy-1", "Corrected summary"),
        });
        const added = payload("delta-add", "entity-2", {
            kind: "claim",
            record: claim("legacy-2"),
        });
        const queueChanged = payload("delta-queue", "queue-1", {
            kind: "memory_queue",
            item: queueItem("queue-1", "Updated queue"),
        });
        const policyChanged = payload("delta-policy", "policy-a", {
            kind: "policy",
            confirmedMemoryCount: 31,
            memoryAutoAcceptPaused: true,
        });
        input.rollbackPayloadEntries.push(changed, added, queueChanged, policyChanged);
        input.migrationDeltas = [
            delta(1, "claim_changed", "entity-1", changed),
            delta(2, "claim_added", "entity-2", added),
            delta(3, "claim_forgotten", "entity-forget"),
            delta(4, "queue_changed", "queue-1", queueChanged),
            delta(5, "policy_changed", "policy-a", policyChanged),
        ];

        expect(buildLegacyMemoryRollbackProjection(input, "vault-a", NOW)).toEqual({
            ok: true,
            lastDeltaSequence: 5,
            projection: {
                records: [claim("legacy-1", "Corrected summary"), claim("legacy-2")],
                memoryQueueItems: [queueItem("queue-1", "Updated queue")],
                confirmedMemoryCount: 31,
                memoryAutoAcceptPaused: true,
            },
        });
    });

    it("replays Add Undo removal deltas to the exact prior absence", () => {
        const input = state();
        const addedClaim = payload("delta-add", "entity-2", {
            kind: "claim",
            record: claim("legacy-2"),
        });
        const addedQueue = payload("delta-queue-add", "queue-2", {
            kind: "memory_queue",
            item: queueItem("queue-2"),
        });
        input.rollbackPayloadEntries.push(addedClaim, addedQueue);
        input.migrationDeltas = [
            delta(1, "claim_added", "entity-2", addedClaim),
            delta(2, "queue_changed", "queue-2", addedQueue),
            delta(3, "queue_removed", "queue-2"),
            delta(4, "claim_removed", "entity-2"),
        ];

        expect(buildLegacyMemoryRollbackProjection(input, "vault-a", NOW)).toMatchObject({
            ok: true,
            projection: {
                records: [claim("legacy-1"), claim("legacy-forget")],
                memoryQueueItems: [queueItem("queue-1")],
            },
        });
    });

    it.each([
        ["blocked", "pending"],
        ["claim_redacted", "pending"],
        ["linked_copies_redacted", "done"],
    ] as const)(
        "does not restore a claim or its exact Queue copy while Forget is %s",
        (phase, targetState) => {
            const input = state();
            input.suppressionMarkers.push({
                id: "forget-marker",
                partition: PARTITION,
                sourceFingerprintId: "forget-source",
                ruleFingerprint: "forget-rule",
                reason: "forgotten",
                createdAt: NOW.toISOString(),
                updatedAt: NOW.toISOString(),
            });
            input.projectionLinks.push({
                id: "forget-queue-link",
                claimId: "entity-forget",
                target: { kind: "review_queue", itemId: "queue-1" },
                relation: "origin",
                state: targetState === "done" ? "redacted" : "active",
                sourceFingerprintId: "forget-source",
                ruleFingerprint: "forget-rule",
                createdAt: NOW.toISOString(),
            });
            input.pendingOperations.push({
                id: "forget-operation",
                kind: "forget",
                claimId: "entity-forget",
                partition: PARTITION,
                suppressionMarkerIds: ["forget-marker"],
                targets: [{ projectionLinkId: "forget-queue-link", state: targetState }],
                phase,
                attemptCount: 0,
                createdAt: NOW.toISOString(),
                updatedAt: NOW.toISOString(),
            });

            expect(buildLegacyMemoryRollbackProjection(input, "vault-a", NOW)).toEqual({
                ok: true,
                lastDeltaSequence: 0,
                projection: {
                    records: [claim("legacy-1")],
                    memoryQueueItems: [],
                    confirmedMemoryCount: 30,
                    memoryAutoAcceptPaused: false,
                },
            });
        },
    );

    it("fails closed for missing, mismatched, expired, or non-contiguous recovery data", () => {
        const missing = state();
        missing.migrationDeltas = [delta(1, "claim_changed", "entity-1")];
        expect(buildLegacyMemoryRollbackProjection(missing, "vault-a", NOW)).toEqual({
            ok: false,
            reason: "rollback_delta_payload_missing",
        });

        const corrupted = state();
        corrupted.rollbackPayloadEntries[0].checksum = "wrong";
        expect(buildLegacyMemoryRollbackProjection(corrupted, "vault-a", NOW)).toEqual({
            ok: false,
            reason: "rollback_payload_checksum_mismatch",
        });

        const expired = state();
        expect(buildLegacyMemoryRollbackProjection(expired, "vault-a", new Date("2026-07-18T00:00:00.000Z")))
            .toEqual({ ok: false, reason: "rollback_window_expired" });

        const reconciliationPending = state();
        reconciliationPending.migrationStates["vault-a"].pendingLegacySourceHash = "new-source";
        expect(buildLegacyMemoryRollbackProjection(reconciliationPending, "vault-a", NOW)).toEqual({
            ok: false,
            reason: "legacy_source_reconciliation_required",
        });

        const gap = state();
        gap.migrationDeltas = [delta(2, "claim_forgotten", "entity-forget")];
        expect(buildLegacyMemoryRollbackProjection(gap, "vault-a", NOW)).toEqual({
            ok: false,
            reason: "rollback_delta_sequence_invalid",
        });
    });

    it("isolates the selected vault and rejects cross-partition run data", () => {
        const input = state();
        input.rollbackPayloadEntries.push({
            ...payload("other", "other", { kind: "claim", record: claim("other") }),
            partition: { kind: "vault", key: "vault-b" },
        });

        expect(buildLegacyMemoryRollbackProjection(input, "vault-a", NOW)).toEqual({
            ok: false,
            reason: "rollback_payload_partition_mismatch",
        });
    });
});

describe("MemoryGovernanceRollbackCoordinator", () => {
    it("blocks rollback while a Forget saga is pending", async () => {
        const input = state();
        input.claims.push({
            id: "entity-1",
            partition: PARTITION,
            memoryType: "preference",
            sensitivity: "low",
            applicability: { kind: "whole_vault" },
            effect: "future_answers",
            lifecycle: "forget_pending",
            createdAt: NOW.toISOString(),
            updatedAt: NOW.toISOString(),
        });
        input.projectionLinks.push({
            id: "link-entity-1",
            claimId: "entity-1",
            target: { kind: "prompt_projection", projectionId: "entity-1" },
            relation: "derived_copy",
            state: "active",
            sourceFingerprintId: "source-1",
            ruleFingerprint: "rule-1",
            createdAt: NOW.toISOString(),
        });
        input.suppressionMarkers.push({
            id: "marker-entity-1",
            partition: PARTITION,
            sourceFingerprintId: "source-1",
            ruleFingerprint: "rule-1",
            reason: "forgotten",
            createdAt: NOW.toISOString(),
            updatedAt: NOW.toISOString(),
        });
        input.pendingOperations.push({
            id: "forget-entity-1",
            kind: "forget",
            claimId: "entity-1",
            partition: PARTITION,
            suppressionMarkerIds: ["marker-entity-1"],
            targets: [{ projectionLinkId: "link-entity-1", state: "pending" }],
            phase: "blocked",
            attemptCount: 0,
            createdAt: NOW.toISOString(),
            updatedAt: NOW.toISOString(),
        });
        const writeLegacyProjection = jest.fn(async () => undefined);
        const repository = new InMemoryMemoryGovernanceRepository(
            new InMemoryMemoryGovernanceBackend(input),
        );
        const coordinator = new MemoryGovernanceRollbackCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            writeLegacyProjection,
            readLegacyProjection: jest.fn(),
            now: () => NOW,
        });

        await expect(coordinator.run()).resolves.toEqual({
            ok: false,
            phase: "compatibility",
            reason: "rollback_pending_operations",
        });
        expect(writeLegacyProjection).not.toHaveBeenCalled();
        expect((await repository.initialize()).migrationStates["vault-a"].phase)
            .toBe("compatibility");
    });

    it("does not overwrite legacy state while a changed source needs reconciliation", async () => {
        const initial = state();
        initial.migrationStates["vault-a"].pendingLegacySourceHash = "new-source";
        const repository = new InMemoryMemoryGovernanceRepository(
            new InMemoryMemoryGovernanceBackend(initial),
        );
        const writeLegacyProjection = jest.fn(async () => undefined);
        const coordinator = new MemoryGovernanceRollbackCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            writeLegacyProjection,
            readLegacyProjection: async () => { throw new Error("must not read"); },
            now: () => NOW,
        });

        await expect(coordinator.run()).resolves.toEqual({
            ok: false,
            phase: "compatibility",
            reason: "legacy_source_reconciliation_required",
        });
        expect(writeLegacyProjection).not.toHaveBeenCalled();
        expect((await repository.initialize()).migrationStates["vault-a"].phase).toBe("compatibility");
    });

    it("releases the rollback lock when the guarded raw write discovers a changed source", async () => {
        const repository = new InMemoryMemoryGovernanceRepository(
            new InMemoryMemoryGovernanceBackend(state()),
        );
        const writeLegacyProjection = jest.fn(async () => ({
            ok: false as const,
            reason: "legacy_source_changed" as const,
            sourceHash: "legacy-v1:changed-during-write",
        }));
        const coordinator = new MemoryGovernanceRollbackCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            writeLegacyProjection,
            readLegacyProjection: async () => { throw new Error("must not read"); },
            now: () => NOW,
        });

        await expect(coordinator.run()).resolves.toEqual({
            ok: false,
            phase: "compatibility",
            reason: "legacy_source_reconciliation_required",
        });
        expect(writeLegacyProjection).toHaveBeenCalledTimes(1);
        expect((await repository.initialize()).migrationStates["vault-a"]).toMatchObject({
            phase: "compatibility",
            pendingLegacySourceHash: "legacy-v1:changed-during-write",
        });
        expect((await repository.initialize()).policyStates["vault-a"].contextProjectionMode)
            .toBe("governed");
    });

    it("writes and verifies legacy state before switching reader mode", async () => {
        const repository = new InMemoryMemoryGovernanceRepository(
            new InMemoryMemoryGovernanceBackend(state()),
        );
        let persisted: LegacyMemoryRollbackProjection | null = null;
        const coordinator = new MemoryGovernanceRollbackCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            writeLegacyProjection: async (projection) => {
                const duringWrite = await repository.initialize();
                expect(duringWrite.migrationStates["vault-a"].phase).toBe("rolling_back");
                expect(duringWrite.policyStates["vault-a"].contextProjectionMode).toBe("governed");
                persisted = projection;
            },
            readLegacyProjection: async () => persisted!,
            now: () => NOW,
        });

        await expect(coordinator.run()).resolves.toEqual({
            ok: true,
            phase: "rolled_back",
            lastDeltaSequence: 0,
        });
        const finalState = await repository.initialize();
        expect(finalState.migrationStates["vault-a"].phase).toBe("rolled_back");
        expect(finalState.policyStates["vault-a"].contextProjectionMode).toBe("legacy");
    });

    it("round-trips post-cutover Pause, Resume, and Change Scope through the legacy rollback contract", async () => {
        const repository = new InMemoryMemoryGovernanceRepository();
        const legacyPayload = migrationPayload("legacy-cutover", 29, true);
        const migration = await new MemoryGovernanceMigrationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            payload: legacyPayload,
            typeAAdoptions: [typeAAdoption("profile-cutover", "Prefer evidence-backed replies.")],
            now: () => NOW,
        }).run();
        expect(migration).toMatchObject({
            ok: true,
            phase: "compatibility",
            contextProjectionMode: "governed",
        });
        if (!migration.ok) throw new Error("migration failed");

        const cutover = await repository.initialize();
        const profileClaim = cutover.claims.find((entry) => (
            entry.partition.kind === "vault"
            && entry.partition.key === "vault-a"
            && entry.effect === "future_answers"
        ));
        if (!profileClaim) throw new Error("migrated profile claim missing");
        const coordinator = new MemoryGovernanceCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            idFactory: ids("lifecycle"),
        });

        await expect(coordinator.pauseUse({ claimId: profileClaim.id }))
            .resolves.toMatchObject({ ok: true });
        await expect(coordinator.resumeUse({
            claimId: profileClaim.id,
            scopeAllowed: true,
            dataBoundaryAllowed: true,
        })).resolves.toMatchObject({ ok: true });
        await expect(coordinator.changeScope({
            claimId: profileClaim.id,
            applicability: { kind: "current_note", paths: ["Notes/scoped.md"] },
            scopeAllowed: true,
            dataBoundaryAllowed: true,
        })).resolves.toMatchObject({ ok: true });

        const mutated = await repository.initialize();
        const deltas = mutated.migrationDeltas.filter(
            (entry) => entry.migrationRunId === migration.migrationRunId,
        );
        expect(deltas.map((entry) => [entry.sequence, entry.kind])).toEqual([
            [1, "claim_changed"],
            [2, "claim_changed"],
            [3, "claim_changed"],
        ]);
        const lifecycleRecords = deltas.map((entry) => mutated.rollbackPayloadEntries.find(
            (payloadEntry) => payloadEntry.id === entry.payloadEntryId,
        )?.value).map((value) => value?.kind === "claim" ? value.record : undefined);
        expect(lifecycleRecords.map((record) => record?.lifecycle)).toEqual([
            "archived",
            "active",
            "active",
        ]);
        expect(lifecycleRecords.at(-1)?.scope).toEqual({
            kind: "current_note",
            paths: ["Notes/scoped.md"],
            tags: undefined,
        });

        const preview = buildLegacyMemoryRollbackProjection(mutated, "vault-a", NOW);
        expect(preview).toMatchObject({
            ok: true,
            lastDeltaSequence: 3,
            projection: {
                confirmedMemoryCount: 29,
                memoryAutoAcceptPaused: true,
            },
        });
        let persisted: LegacyMemoryRollbackProjection | null = null;
        const rollback = new MemoryGovernanceRollbackCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            writeLegacyProjection: async (projection) => { persisted = projection; },
            readLegacyProjection: async () => {
                if (!persisted) throw new Error("legacy projection was not written");
                return persisted;
            },
            now: () => NOW,
        });

        await expect(rollback.run()).resolves.toEqual({
            ok: true,
            phase: "rolled_back",
            lastDeltaSequence: 3,
        });
        expect(persisted).toMatchObject({
            confirmedMemoryCount: 29,
            memoryAutoAcceptPaused: true,
            records: expect.arrayContaining([
                expect.objectContaining({ id: "legacy-cutover", lifecycle: "active" }),
                expect.objectContaining({
                    id: profileClaim.id,
                    lifecycle: "active",
                    scope: { kind: "current_note", paths: ["Notes/scoped.md"] },
                }),
            ]),
        });
        const final = await repository.initialize();
        expect(final.migrationStates["vault-a"]).toMatchObject({
            phase: "rolled_back",
            lastAppliedDeltaSequence: 3,
        });
        expect(final.policyStates["vault-a"]).toMatchObject({
            mode: "effect_based",
            contextProjectionMode: "legacy",
            legacyBaseline: { confirmedCount: 29, autoAcceptPaused: true },
        });
    });

    it("rolls back two opaque vault runs concurrently without crossing payload, delta, policy, or legacy state", async () => {
        const backend = new InMemoryMemoryGovernanceBackend();
        const repositoryA = new InMemoryMemoryGovernanceRepository(backend);
        const repositoryB = new InMemoryMemoryGovernanceRepository(backend);
        const [migrationA, migrationB] = await Promise.all([
            new MemoryGovernanceMigrationCoordinator({
                repository: repositoryA,
                opaqueVaultKey: "vault-a",
                payload: migrationPayload("legacy-vault-a", 11, true),
                typeAAdoptions: [typeAAdoption("profile-a", "Profile summary A")],
                now: () => NOW,
            }).run(),
            new MemoryGovernanceMigrationCoordinator({
                repository: repositoryB,
                opaqueVaultKey: "vault-b",
                payload: migrationPayload("legacy-vault-b", 22, false),
                typeAAdoptions: [typeAAdoption("profile-b", "Profile summary B")],
                now: () => NOW,
            }).run(),
        ]);
        expect(migrationA.ok).toBe(true);
        expect(migrationB.ok).toBe(true);
        if (!migrationA.ok || !migrationB.ok) throw new Error("migration failed");
        expect(migrationA.migrationRunId).not.toBe(migrationB.migrationRunId);

        const cutover = await repositoryA.initialize();
        const profileClaim = (vaultKey: string) => cutover.claims.find((entry) => (
            entry.partition.kind === "vault"
            && entry.partition.key === vaultKey
            && entry.effect === "future_answers"
        ));
        const claimA = profileClaim("vault-a");
        const claimB = profileClaim("vault-b");
        if (!claimA || !claimB) throw new Error("profile claims missing");
        const coordinatorA = new MemoryGovernanceCoordinator({
            repository: repositoryA,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            idFactory: ids("vault-a"),
        });
        const coordinatorB = new MemoryGovernanceCoordinator({
            repository: repositoryB,
            opaqueVaultKey: "vault-b",
            now: () => NOW,
            idFactory: ids("vault-b"),
        });
        const [pausedA, resumedB] = await Promise.all([
            coordinatorA.pauseUse({ claimId: claimA.id }),
            (async () => {
                const paused = await coordinatorB.pauseUse({ claimId: claimB.id });
                if (!paused.ok) return paused;
                return coordinatorB.resumeUse({
                    claimId: claimB.id,
                    scopeAllowed: true,
                    dataBoundaryAllowed: true,
                });
            })(),
        ]);
        expect(pausedA.ok).toBe(true);
        expect(resumedB.ok).toBe(true);

        const beforeRollback = await repositoryA.initialize();
        const deltasA = beforeRollback.migrationDeltas.filter(
            (entry) => entry.migrationRunId === migrationA.migrationRunId,
        );
        const deltasB = beforeRollback.migrationDeltas.filter(
            (entry) => entry.migrationRunId === migrationB.migrationRunId,
        );
        expect(deltasA.map((entry) => entry.sequence)).toEqual([1]);
        expect(deltasB.map((entry) => entry.sequence)).toEqual([1, 2]);
        expect(deltasA.every((entry) => entry.partition.kind === "vault"
            && entry.partition.key === "vault-a")).toBe(true);
        expect(deltasB.every((entry) => entry.partition.kind === "vault"
            && entry.partition.key === "vault-b")).toBe(true);

        const persisted: {
            a: LegacyMemoryRollbackProjection | null;
            b: LegacyMemoryRollbackProjection | null;
        } = { a: null, b: null };
        const writeA = jest.fn(async (projection: LegacyMemoryRollbackProjection) => {
            await Promise.resolve();
            persisted.a = projection;
        });
        const writeB = jest.fn(async (projection: LegacyMemoryRollbackProjection) => {
            await Promise.resolve();
            persisted.b = projection;
        });
        const [rollbackA, rollbackB] = await Promise.all([
            new MemoryGovernanceRollbackCoordinator({
                repository: repositoryA,
                opaqueVaultKey: "vault-a",
                writeLegacyProjection: writeA,
                readLegacyProjection: async () => {
                    if (!persisted.a) throw new Error("vault-a projection missing");
                    return persisted.a;
                },
                now: () => NOW,
            }).run(),
            new MemoryGovernanceRollbackCoordinator({
                repository: repositoryB,
                opaqueVaultKey: "vault-b",
                writeLegacyProjection: writeB,
                readLegacyProjection: async () => {
                    if (!persisted.b) throw new Error("vault-b projection missing");
                    return persisted.b;
                },
                now: () => NOW,
            }).run(),
        ]);

        expect(rollbackA).toEqual({ ok: true, phase: "rolled_back", lastDeltaSequence: 1 });
        expect(rollbackB).toEqual({ ok: true, phase: "rolled_back", lastDeltaSequence: 2 });
        expect(writeA).toHaveBeenCalledTimes(1);
        expect(writeB).toHaveBeenCalledTimes(1);
        expect(persisted.a).toMatchObject({
            confirmedMemoryCount: 11,
            memoryAutoAcceptPaused: true,
            records: expect.arrayContaining([
                expect.objectContaining({ id: "legacy-vault-a" }),
                expect.objectContaining({ id: claimA.id, lifecycle: "archived" }),
            ]),
        });
        expect(persisted.b).toMatchObject({
            confirmedMemoryCount: 22,
            memoryAutoAcceptPaused: false,
            records: expect.arrayContaining([
                expect.objectContaining({ id: "legacy-vault-b" }),
                expect.objectContaining({ id: claimB.id, lifecycle: "active" }),
            ]),
        });
        expect(JSON.stringify(persisted.a)).not.toContain("Profile summary B");
        expect(JSON.stringify(persisted.b)).not.toContain("Profile summary A");

        const final = await repositoryA.initialize();
        expect(final.migrationStates["vault-a"]).toMatchObject({
            migrationRunId: migrationA.migrationRunId,
            phase: "rolled_back",
            lastAppliedDeltaSequence: 1,
        });
        expect(final.migrationStates["vault-b"]).toMatchObject({
            migrationRunId: migrationB.migrationRunId,
            phase: "rolled_back",
            lastAppliedDeltaSequence: 2,
        });
        expect(final.policyStates["vault-a"]).toMatchObject({
            contextProjectionMode: "legacy",
            legacyBaseline: { confirmedCount: 11, autoAcceptPaused: true },
        });
        expect(final.policyStates["vault-b"]).toMatchObject({
            contextProjectionMode: "legacy",
            legacyBaseline: { confirmedCount: 22, autoAcceptPaused: false },
        });
        const payloadsA = final.rollbackPayloadEntries.filter(
            (entry) => entry.migrationRunId === migrationA.migrationRunId,
        );
        const payloadsB = final.rollbackPayloadEntries.filter(
            (entry) => entry.migrationRunId === migrationB.migrationRunId,
        );
        expect(payloadsA.length).toBeGreaterThan(0);
        expect(payloadsB.length).toBeGreaterThan(0);
        expect(payloadsA.every((entry) => entry.partition.kind === "vault"
            && entry.partition.key === "vault-a")).toBe(true);
        expect(payloadsB.every((entry) => entry.partition.kind === "vault"
            && entry.partition.key === "vault-b")).toBe(true);
    });

    it("keeps rolling_back on write failure and resumes idempotently", async () => {
        const repository = new InMemoryMemoryGovernanceRepository(
            new InMemoryMemoryGovernanceBackend(state()),
        );
        let fail = true;
        let persisted: LegacyMemoryRollbackProjection | null = null;
        const options = {
            repository,
            opaqueVaultKey: "vault-a",
            writeLegacyProjection: async (projection: LegacyMemoryRollbackProjection) => {
                if (fail) throw new Error("disk unavailable");
                persisted = projection;
            },
            readLegacyProjection: async () => persisted!,
            now: () => NOW,
        };

        await expect(new MemoryGovernanceRollbackCoordinator(options).run()).resolves.toEqual({
            ok: false,
            phase: "rolling_back",
            reason: "rollback_legacy_write_failed",
        });
        expect((await repository.initialize()).migrationStates["vault-a"]).toMatchObject({
            phase: "rolling_back",
            lastErrorCode: "rollback_legacy_write_failed",
        });

        fail = false;
        await expect(new MemoryGovernanceRollbackCoordinator(options).run()).resolves.toMatchObject({
            ok: true,
            phase: "rolled_back",
        });
    });

    it("returns a typed retryable result when the terminal reader-mode commit fails", async () => {
        const base = new InMemoryMemoryGovernanceRepository(
            new InMemoryMemoryGovernanceBackend(state()),
        );
        const repository = new FailOnceAtTransactionRepository(base, 2);
        let persisted: LegacyMemoryRollbackProjection | null = null;
        const options = {
            repository,
            opaqueVaultKey: "vault-a",
            writeLegacyProjection: async (projection: LegacyMemoryRollbackProjection) => {
                persisted = projection;
            },
            readLegacyProjection: async () => persisted!,
            now: () => NOW,
        };

        await expect(new MemoryGovernanceRollbackCoordinator(options).run()).resolves.toEqual({
            ok: false,
            phase: "rolling_back",
            reason: "rollback_commit_failed",
        });
        expect((await base.initialize()).migrationStates["vault-a"]).toMatchObject({
            phase: "rolling_back",
            lastErrorCode: "rollback_commit_failed",
        });
        expect((await base.initialize()).policyStates["vault-a"].contextProjectionMode)
            .toBe("governed");

        await expect(new MemoryGovernanceRollbackCoordinator(options).run()).resolves.toEqual({
            ok: true,
            phase: "rolled_back",
            lastDeltaSequence: 0,
        });
        expect((await base.initialize()).policyStates["vault-a"].contextProjectionMode)
            .toBe("legacy");
    });

    it("does not switch mode when legacy readback differs", async () => {
        const repository = new InMemoryMemoryGovernanceRepository(
            new InMemoryMemoryGovernanceBackend(state()),
        );
        const coordinator = new MemoryGovernanceRollbackCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            writeLegacyProjection: async () => undefined,
            readLegacyProjection: async () => ({
                records: [],
                memoryQueueItems: [],
                confirmedMemoryCount: 0,
                memoryAutoAcceptPaused: false,
            }),
            now: () => NOW,
        });

        await expect(coordinator.run()).resolves.toEqual({
            ok: false,
            phase: "rolling_back",
            reason: "rollback_readback_mismatch",
        });
        const finalState = await repository.initialize();
        expect(finalState.migrationStates["vault-a"].phase).toBe("rolling_back");
        expect(finalState.policyStates["vault-a"].contextProjectionMode).toBe("governed");
    });

    it("locks rolling_back and rebuilds from the authoritative journal head", async () => {
        const base = new InMemoryMemoryGovernanceRepository(
            new InMemoryMemoryGovernanceBackend(state()),
        );
        const addedPayload = payload("race-add", "entity-race", {
            kind: "claim",
            record: claim("legacy-race"),
        });
        const repository = new InjectBeforeRollbackLockRepository(base, async () => {
            await base.transact((draft) => {
                draft.rollbackPayloadEntries.push(addedPayload);
                draft.migrationDeltas.push(delta(1, "claim_added", "entity-race", addedPayload));
            });
        });
        let persisted: LegacyMemoryRollbackProjection | null = null;
        const coordinator = new MemoryGovernanceRollbackCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            writeLegacyProjection: async (projection) => { persisted = projection; },
            readLegacyProjection: async () => persisted!,
            now: () => NOW,
        });

        await expect(coordinator.run()).resolves.toMatchObject({ ok: true, lastDeltaSequence: 1 });
        expect(persisted!.records.map((record) => record.id)).toEqual([
            "legacy-1",
            "legacy-forget",
            "legacy-race",
        ]);
    });
});

class InjectBeforeRollbackLockRepository implements MemoryGovernanceRepository {
    private injected = false;

    constructor(
        private readonly delegate: MemoryGovernanceRepository,
        private readonly inject: () => Promise<void>,
    ) {}

    async initialize(): Promise<DeviceMemoryGovernanceStateV1> {
        const stale = await this.delegate.initialize();
        if (!this.injected) {
            this.injected = true;
            await this.inject();
        }
        return stale;
    }

    transact<T>(operation: MemoryGovernanceTransaction<T>): Promise<T> {
        return this.delegate.transact(operation);
    }

    subscribe(listener: (commitSequence: number) => void): () => void {
        return this.delegate.subscribe(listener);
    }

    dispose(): Promise<void> {
        return this.delegate.dispose();
    }
}

class FailOnceAtTransactionRepository implements MemoryGovernanceRepository {
    private transactionCount = 0;
    private failed = false;

    constructor(
        private readonly delegate: MemoryGovernanceRepository,
        private readonly failAt: number,
    ) {}

    initialize(): Promise<DeviceMemoryGovernanceStateV1> {
        return this.delegate.initialize();
    }

    transact<T>(operation: MemoryGovernanceTransaction<T>): Promise<T> {
        this.transactionCount += 1;
        if (!this.failed && this.transactionCount === this.failAt) {
            this.failed = true;
            return Promise.reject(new Error("device store temporarily unavailable"));
        }
        return this.delegate.transact(operation);
    }

    subscribe(listener: (commitSequence: number) => void): () => void {
        return this.delegate.subscribe(listener);
    }

    dispose(): Promise<void> {
        return this.delegate.dispose();
    }
}
