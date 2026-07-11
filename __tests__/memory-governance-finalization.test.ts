import {
    MemoryGovernanceFinalizationCoordinator,
    previewMemoryGovernanceFinalization,
} from "../src/pa/memory-governance-finalization";
import {
    MemoryGovernanceMigrationCoordinator,
    checksumLegacyRollbackValue,
} from "../src/pa/memory-governance-migration-coordinator";
import {
    InMemoryMemoryGovernanceRepository,
    type DeviceMemoryGovernanceStateV1,
    type MemoryGovernanceRepository,
    type MemoryGovernanceTransaction,
} from "../src/pa/memory-governance-persistence";
import type { LegacyMemoryRollbackProjection } from "../src/pa/memory-governance-rollback";

const NOW = new Date("2026-07-10T08:00:00.000Z");

async function migratedRepository(): Promise<InMemoryMemoryGovernanceRepository> {
    const repository = new InMemoryMemoryGovernanceRepository();
    await new MemoryGovernanceMigrationCoordinator({
        repository,
        opaqueVaultKey: "vault-a",
        payload: {
            memoryGovernance: {
                records: [{
                    id: "legacy-1",
                    type: "preference",
                    lifecycle: "active",
                    sensitivity: "low",
                    scope: { kind: "whole_vault" },
                    summary: "Prefer concise replies.",
                    sourceRefs: [{ path: "notes/source.md" }],
                    createdAt: "2026-07-01T08:00:00.000Z",
                    updatedAt: "2026-07-01T08:00:00.000Z",
                }],
            },
            reviewQueue: { items: [] },
            confirmedMemoryCount: 30,
            memoryAutoAcceptPaused: true,
        },
        typeAAdoptions: [],
        now: () => NOW,
    }).run();
    return repository;
}

function emptyProjection(): LegacyMemoryRollbackProjection {
    return {
        records: [],
        memoryQueueItems: [],
        confirmedMemoryCount: 0,
        memoryAutoAcceptPaused: false,
    };
}

function nonEmptyProjection(): LegacyMemoryRollbackProjection {
    return {
        records: [{}] as unknown as LegacyMemoryRollbackProjection["records"],
        memoryQueueItems: [],
        confirmedMemoryCount: 30,
        memoryAutoAcceptPaused: true,
    };
}

async function expireRestoreProof(repository: MemoryGovernanceRepository): Promise<void> {
    await repository.transact((draft) => {
        const migration = draft.migrationStates["vault-a"];
        const runId = migration.migrationRunId;
        delete migration.rollbackExpiresAt;
        delete migration.lastAppliedDeltaSequence;
        draft.rollbackPayloadEntries = draft.rollbackPayloadEntries
            .filter((entry) => entry.migrationRunId !== runId);
        draft.migrationDeltas = draft.migrationDeltas
            .filter((delta) => delta.migrationRunId !== runId);
    });
}

function sourceReader(
    repository: MemoryGovernanceRepository,
    readProjection: () => LegacyMemoryRollbackProjection | Promise<LegacyMemoryRollbackProjection>,
): () => Promise<{ sourceHash: string; projection: LegacyMemoryRollbackProjection }> {
    return async () => ({
        sourceHash: (await repository.initialize()).migrationStates["vault-a"].sourceHash!,
        projection: await readProjection(),
    });
}

describe("Memory governance finalization", () => {
    it("fails closed until governed cutover is complete", async () => {
        const repository = new InMemoryMemoryGovernanceRepository();
        await new MemoryGovernanceMigrationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            payload: {
                memoryGovernance: { records: [] },
                reviewQueue: { items: [] },
                confirmedMemoryCount: 0,
                memoryAutoAcceptPaused: false,
            },
            now: () => NOW,
        }).run();

        expect(previewMemoryGovernanceFinalization(
            await repository.initialize(),
            "vault-a",
            NOW,
        )).toMatchObject({
            eligible: false,
            blockedReason: "governed_cutover_incomplete",
        });
    });

    it("fails closed while a changed legacy source still needs reconciliation", async () => {
        const repository = await migratedRepository();
        await repository.transact((draft) => {
            draft.migrationStates["vault-a"].pendingLegacySourceHash = "changed-source";
        });
        const clear = jest.fn(async () => undefined);
        const coordinator = new MemoryGovernanceFinalizationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            clearLegacyMemorySlices: clear,
            readLegacySourceSnapshot: sourceReader(repository, () => emptyProjection()),
            now: () => NOW,
        });

        const preview = await coordinator.preview();
        expect(preview).toMatchObject({
            eligible: false,
            blockedReason: "legacy_source_reconciliation_required",
        });
        await expect(coordinator.run("stale-token")).resolves.toMatchObject({
            ok: false,
            reason: "legacy_source_reconciliation_required",
        });
        expect(clear).not.toHaveBeenCalled();
    });

    it("offers a read-only cross-device warning only after restore proof", async () => {
        const repository = await migratedRepository();
        const before = await repository.initialize();
        const preview = previewMemoryGovernanceFinalization(before, "vault-a", NOW);

        expect(preview).toMatchObject({
            eligible: true,
            legacyRecordCount: 1,
            legacyMemoryQueueCount: 0,
            warningCode: "other_devices_may_still_depend_on_legacy_data",
            confirmationToken: expect.stringMatching(/^finalize-[a-f0-9]{32}$/),
        });
        expect(await repository.initialize()).toEqual(before);
    });

    it("does nothing when the explicit preview token is stale", async () => {
        const repository = await migratedRepository();
        const clear = jest.fn(async () => undefined);
        const coordinator = new MemoryGovernanceFinalizationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            clearLegacyMemorySlices: clear,
            readLegacySourceSnapshot: sourceReader(repository, () => emptyProjection()),
            now: () => NOW,
        });

        await expect(coordinator.run("stale-token")).resolves.toEqual({
            ok: false,
            phase: "compatibility",
            reason: "finalization_confirmation_stale",
        });
        expect(clear).not.toHaveBeenCalled();
        expect((await repository.initialize()).migrationStates["vault-a"].phase).toBe("compatibility");
    });

    it("clears legacy slices, verifies readback, then removes recovery payload", async () => {
        const repository = await migratedRepository();
        let legacy = { records: [{}], memoryQueueItems: [{}], confirmedMemoryCount: 30, memoryAutoAcceptPaused: true };
        const coordinator = new MemoryGovernanceFinalizationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            clearLegacyMemorySlices: async () => { legacy = emptyProjection() as typeof legacy; },
            readLegacySourceSnapshot: sourceReader(
                repository,
                () => legacy as LegacyMemoryRollbackProjection,
            ),
            now: () => NOW,
        });
        const preview = await coordinator.preview();

        await expect(coordinator.run(preview.confirmationToken!)).resolves.toEqual({
            ok: true,
            phase: "finalized",
        });
        const state = await repository.initialize();
        expect(state.migrationStates["vault-a"]).toMatchObject({ phase: "finalized" });
        expect(state.rollbackPayloadEntries).toEqual([]);
        expect(state.migrationDeltas).toEqual([]);
    });

    it("retains restore data and resumes after a cleanup failure", async () => {
        const repository = await migratedRepository();
        let fail = true;
        let legacy = {
            records: [{}],
            memoryQueueItems: [],
            confirmedMemoryCount: 30,
            memoryAutoAcceptPaused: true,
        } as unknown as LegacyMemoryRollbackProjection;
        const coordinator = new MemoryGovernanceFinalizationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            clearLegacyMemorySlices: async () => {
                if (fail) throw new Error("write failed");
                legacy = emptyProjection();
            },
            readLegacySourceSnapshot: sourceReader(repository, () => legacy),
            now: () => NOW,
        });
        const preview = await coordinator.preview();

        await expect(coordinator.run(preview.confirmationToken!)).resolves.toEqual({
            ok: false,
            phase: "finalizing",
            reason: "finalization_cleanup_failed",
        });
        let state = await repository.initialize();
        expect(state.migrationStates["vault-a"].phase).toBe("finalizing");
        expect(state.rollbackPayloadEntries.length).toBeGreaterThan(0);

        fail = false;
        const resumedPreview = await coordinator.preview();
        expect(resumedPreview.confirmationToken).toBe(preview.confirmationToken);
        await expect(coordinator.run(resumedPreview.confirmationToken!)).resolves.toMatchObject({ ok: true });
        state = await repository.initialize();
        expect(state.migrationStates["vault-a"].phase).toBe("finalized");
    });

    it("keeps finalization retryable when the destructive external write never settles", async () => {
        jest.useFakeTimers();
        try {
            const repository = await migratedRepository();
            const legacy = nonEmptyProjection();
            const coordinator = new MemoryGovernanceFinalizationCoordinator({
                repository,
                opaqueVaultKey: "vault-a",
                clearLegacyMemorySlices: () => new Promise<boolean | void>(() => undefined),
                readLegacySourceSnapshot: sourceReader(repository, () => legacy),
                now: () => NOW,
                externalOperationTimeoutMs: 25,
            });
            const preview = await coordinator.preview();

            const result = coordinator.run(preview.confirmationToken!);
            await jest.advanceTimersByTimeAsync(25);

            await expect(result).resolves.toEqual({
                ok: false,
                phase: "finalizing",
                reason: "finalization_cleanup_failed",
            });
            const state = await repository.initialize();
            expect(state.migrationStates["vault-a"]).toMatchObject({
                phase: "finalizing",
                lastErrorCode: "finalization_cleanup_failed",
            });
            expect(state.rollbackPayloadEntries.length).toBeGreaterThan(0);
        } finally {
            jest.useRealTimers();
        }
    });

    it("returns a typed retryable result when the terminal commit fails after legacy cleanup", async () => {
        const base = await migratedRepository();
        const expectedSourceHash = (await base.initialize()).migrationStates["vault-a"].sourceHash!;
        const repository = new FailOnceAtTransactionRepository(base, 2);
        let legacy = nonEmptyProjection();
        let liveSourceHash = expectedSourceHash;
        const coordinator = new MemoryGovernanceFinalizationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            clearLegacyMemorySlices: async () => {
                legacy = emptyProjection();
                liveSourceHash = "legacy-v1:cleared";
            },
            readLegacySourceSnapshot: async () => ({
                sourceHash: liveSourceHash,
                projection: legacy,
            }),
            now: () => NOW,
        });
        const preview = await coordinator.preview();

        await expect(coordinator.run(preview.confirmationToken!)).resolves.toEqual({
            ok: false,
            phase: "finalizing",
            reason: "finalization_commit_failed",
        });
        let state = await base.initialize();
        expect(state.migrationStates["vault-a"]).toMatchObject({
            phase: "finalizing",
            lastErrorCode: "finalization_commit_failed",
        });
        expect(legacy).toEqual(emptyProjection());
        expect(state.rollbackPayloadEntries.length).toBeGreaterThan(0);

        const retry = await coordinator.preview();
        await expect(coordinator.run(retry.confirmationToken!)).resolves.toEqual({
            ok: true,
            phase: "finalized",
        });
        state = await base.initialize();
        expect(state.migrationStates["vault-a"].phase).toBe("finalized");
    });

    it("keeps an explicitly started finalization recoverable after the rollback window expires", async () => {
        const repository = await migratedRepository();
        let currentTime = NOW;
        let fail = true;
        let legacy = {
            records: [{}],
            memoryQueueItems: [],
            confirmedMemoryCount: 30,
            memoryAutoAcceptPaused: true,
        } as unknown as LegacyMemoryRollbackProjection;
        const coordinator = new MemoryGovernanceFinalizationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            clearLegacyMemorySlices: async () => {
                if (fail) throw new Error("write failed");
                legacy = emptyProjection();
            },
            readLegacySourceSnapshot: sourceReader(repository, () => legacy),
            now: () => currentTime,
        });
        const preview = await coordinator.preview();
        await expect(coordinator.run(preview.confirmationToken!)).resolves.toMatchObject({
            ok: false,
            phase: "finalizing",
        });
        const expiry = Date.parse(
            (await repository.initialize()).migrationStates["vault-a"].rollbackExpiresAt!,
        );
        currentTime = new Date(expiry + 24 * 60 * 60 * 1000);

        const resumed = await coordinator.preview();

        expect(resumed).toMatchObject({
            eligible: true,
            confirmationToken: preview.confirmationToken,
        });
        fail = false;
        await expect(coordinator.run(resumed.confirmationToken!)).resolves.toEqual({
            ok: true,
            phase: "finalized",
        });
    });

    it("revalidates the preview token inside the finalizing transaction", async () => {
        const base = await migratedRepository();
        const preview = previewMemoryGovernanceFinalization(await base.initialize(), "vault-a", NOW);
        const repository = new InjectBeforeFinalizationLockRepository(base, async () => {
            await base.transact((draft) => {
                const migration = draft.migrationStates["vault-a"];
                const value = {
                    kind: "policy" as const,
                    confirmedMemoryCount: 31,
                    memoryAutoAcceptPaused: true,
                };
                const checksum = checksumLegacyRollbackValue(value);
                draft.rollbackPayloadEntries.push({
                    id: "race-policy-payload",
                    migrationRunId: migration.migrationRunId,
                    partition: { kind: "vault", key: "vault-a" },
                    entityId: "race-policy",
                    value,
                    checksum,
                    expiresAt: migration.rollbackExpiresAt!,
                });
                draft.migrationDeltas.push({
                    sequence: 1,
                    migrationRunId: migration.migrationRunId,
                    partition: { kind: "vault", key: "vault-a" },
                    committedAt: NOW.toISOString(),
                    kind: "policy_changed",
                    entityId: "race-policy",
                    payloadEntryId: "race-policy-payload",
                    payloadChecksum: checksum,
                });
            });
        });
        const clear = jest.fn(async () => undefined);
        const coordinator = new MemoryGovernanceFinalizationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            clearLegacyMemorySlices: clear,
            readLegacySourceSnapshot: sourceReader(repository, () => emptyProjection()),
            now: () => NOW,
        });

        await expect(coordinator.run(preview.confirmationToken!)).resolves.toEqual({
            ok: false,
            phase: "compatibility",
            reason: "finalization_confirmation_stale",
        });
        expect(clear).not.toHaveBeenCalled();
        expect((await base.initialize()).migrationStates["vault-a"].phase).toBe("compatibility");
    });

    it("creates a fresh seven-day restore proof after the previous proof was garbage-collected", async () => {
        const repository = await migratedRepository();
        const previousRunId = (await repository.initialize()).migrationStates["vault-a"].migrationRunId;
        await expireRestoreProof(repository);
        let legacy = nonEmptyProjection();
        const coordinator = new MemoryGovernanceFinalizationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            clearLegacyMemorySlices: async () => {
                const locked = await repository.initialize();
                expect(locked.migrationStates["vault-a"]).toMatchObject({
                    phase: "finalizing",
                    rollbackExpiresAt: "2026-07-17T08:00:00.000Z",
                });
                expect(locked.migrationStates["vault-a"].migrationRunId).not.toBe(previousRunId);
                expect(locked.rollbackPayloadEntries.length).toBeGreaterThan(0);
                legacy = emptyProjection();
            },
            readLegacySourceSnapshot: sourceReader(repository, () => legacy),
            now: () => NOW,
        });

        const preview = await coordinator.preview();
        expect(preview).toMatchObject({
            eligible: true,
            requiresFreshRestoreProof: true,
            confirmationToken: expect.stringMatching(/^finalize-fresh-[a-f0-9]{32}$/),
            legacyRecordCount: 1,
        });

        await expect(coordinator.run(preview.confirmationToken!)).resolves.toEqual({
            ok: true,
            phase: "finalized",
        });
        const state = await repository.initialize();
        expect(state.migrationStates["vault-a"].phase).toBe("finalized");
        expect(state.rollbackPayloadEntries).toEqual([]);
        expect(state.migrationDeltas).toEqual([]);
    });

    it("retains a fresh restore proof across a failed cleanup and resumes from it", async () => {
        const repository = await migratedRepository();
        await expireRestoreProof(repository);
        let legacy = nonEmptyProjection();
        let fail = true;
        const coordinator = new MemoryGovernanceFinalizationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            clearLegacyMemorySlices: async () => {
                if (fail) throw new Error("write failed");
                legacy = emptyProjection();
            },
            readLegacySourceSnapshot: sourceReader(repository, () => legacy),
            now: () => NOW,
        });
        const preview = await coordinator.preview();

        await expect(coordinator.run(preview.confirmationToken!)).resolves.toMatchObject({
            ok: false,
            phase: "finalizing",
        });
        let state = await repository.initialize();
        expect(state.migrationStates["vault-a"].phase).toBe("finalizing");
        expect(state.rollbackPayloadEntries.length).toBeGreaterThan(0);

        const retry = await coordinator.preview();
        expect(retry).toMatchObject({ eligible: true });
        expect(retry.requiresFreshRestoreProof).toBeUndefined();
        fail = false;
        await expect(coordinator.run(retry.confirmationToken!)).resolves.toMatchObject({ ok: true });
        state = await repository.initialize();
        expect(state.migrationStates["vault-a"].phase).toBe("finalized");
    });

    it("binds a fresh confirmation token to corrected content, not just entity counts", async () => {
        const repository = await migratedRepository();
        await expireRestoreProof(repository);
        const preview = await new MemoryGovernanceFinalizationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            clearLegacyMemorySlices: async () => undefined,
            readLegacySourceSnapshot: sourceReader(repository, () => nonEmptyProjection()),
            now: () => NOW,
        }).preview();
        await repository.transact((draft) => {
            draft.revisions[0].summary = "Prefer detailed replies after correction.";
            draft.claims[0].updatedAt = "2026-07-10T08:01:00.000Z";
        });
        const clear = jest.fn(async () => undefined);
        const coordinator = new MemoryGovernanceFinalizationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            clearLegacyMemorySlices: clear,
            readLegacySourceSnapshot: sourceReader(repository, () => nonEmptyProjection()),
            now: () => NOW,
        });

        await expect(coordinator.run(preview.confirmationToken!)).resolves.toMatchObject({
            ok: false,
            reason: "finalization_confirmation_stale",
        });
        expect(clear).not.toHaveBeenCalled();
    });

    it("unwinds a newly installed proof when the persisted legacy source changes before cleanup", async () => {
        const repository = await migratedRepository();
        await expireRestoreProof(repository);
        const before = await repository.initialize();
        const oldRunId = before.migrationStates["vault-a"].migrationRunId;
        const expectedSourceHash = before.migrationStates["vault-a"].sourceHash!;
        let readCount = 0;
        const clear = jest.fn(async () => undefined);
        const coordinator = new MemoryGovernanceFinalizationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            clearLegacyMemorySlices: clear,
            readLegacySourceSnapshot: async () => ({
                sourceHash: readCount++ === 0 ? expectedSourceHash : "legacy-v1:changed-source",
                projection: nonEmptyProjection(),
            }),
            now: () => NOW,
        });
        const preview = await coordinator.preview();

        await expect(coordinator.run(preview.confirmationToken!)).resolves.toEqual({
            ok: false,
            phase: "compatibility",
            reason: "legacy_source_reconciliation_required",
        });
        expect(clear).not.toHaveBeenCalled();
        const state = await repository.initialize();
        expect(state.migrationStates["vault-a"]).toMatchObject({
            phase: "compatibility",
            migrationRunId: oldRunId,
            pendingLegacySourceHash: "legacy-v1:changed-source",
        });
        expect(state.migrationStates["vault-a"].rollbackExpiresAt).toBeUndefined();
        expect(state.rollbackPayloadEntries).toEqual([]);
        expect(state.migrationDeltas).toEqual([]);
    });

    it("blocks finalization while an exact-vault Profile projection is still pending", async () => {
        const repository = await migratedRepository();
        await repository.transact((draft) => {
            const claim = draft.claims[0];
            draft.pendingOperations.push({
                id: "pending-profile-projection",
                kind: "profile_projection",
                claimId: claim.id,
                profileRecordId: "profile-pending",
                targetRevisionId: claim.activeRevisionId!,
                state: "pending",
                attemptCount: 0,
                createdAt: NOW.toISOString(),
                updatedAt: NOW.toISOString(),
            });
        });

        expect(previewMemoryGovernanceFinalization(
            await repository.initialize(),
            "vault-a",
            NOW,
        )).toMatchObject({
            eligible: false,
            blockedReason: "finalization_pending_operations",
        });
    });

    it("excludes unchanged migrated Type-A adoption from a fresh legacy proof", async () => {
        const repository = await migratedRepository();
        await expireRestoreProof(repository);
        await repository.transact((draft) => {
            draft.claims.push({
                id: "type-a-claim",
                partition: { kind: "vault", key: "vault-a" },
                memoryType: "preference",
                sensitivity: "low",
                applicability: { kind: "whole_vault" },
                activeRevisionId: "type-a-revision",
                effect: "future_answers",
                lifecycle: "active",
                createdAt: NOW.toISOString(),
                updatedAt: NOW.toISOString(),
            });
            draft.revisions.push({
                id: "type-a-revision",
                claimId: "type-a-claim",
                summary: "Prefer concise replies.",
                provenance: [{
                    kind: "conversation",
                    conversationIds: ["conversation-1"],
                    observedAt: NOW.toISOString(),
                }],
                authority: "explicit_user",
                createdAt: NOW.toISOString(),
            });
            draft.projectionLinks.push({
                id: "type-a-link",
                claimId: "type-a-claim",
                target: { kind: "type_a_profile", profileRecordId: "profile-1" },
                relation: "origin",
                state: "active",
                sourceFingerprintId: "type-a-source",
                ruleFingerprint: "legacy-type-a-adoption-v1",
                createdAt: NOW.toISOString(),
            });
        });

        let preview = previewMemoryGovernanceFinalization(await repository.initialize(), "vault-a", NOW);
        expect(preview).toMatchObject({
            eligible: true,
            requiresFreshRestoreProof: true,
            legacyRecordCount: 1,
        });

        await repository.transact((draft) => {
            const claim = draft.claims.find((candidate) => candidate.id === "type-a-claim");
            if (claim) claim.updatedAt = "2026-07-10T08:02:00.000Z";
            draft.changeEvents.push({
                id: "type-a-corrected",
                claimId: "type-a-claim",
                kind: "correct",
                scopeKey: "vault-a",
                effect: "future_answers",
                occurredAt: "2026-07-10T08:02:00.000Z",
            });
        });
        preview = previewMemoryGovernanceFinalization(await repository.initialize(), "vault-a", NOW);
        expect(preview).toMatchObject({
            eligible: true,
            requiresFreshRestoreProof: true,
            legacyRecordCount: 2,
        });
    });
});

class InjectBeforeFinalizationLockRepository implements MemoryGovernanceRepository {
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
