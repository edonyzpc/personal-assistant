import {
    checksumLegacyRollbackValue,
    MemoryGovernanceMigrationCoordinator,
    type ClassifiedLegacyTypeAAdoption,
} from "../src/pa/memory-governance-migration-coordinator";
import {
    fingerprintLegacyMemoryEntityId,
    hashLegacyMemoryPayload,
    type LegacyMemoryPayload,
} from "../src/pa/memory-governance-migration";
import type { ConfirmedMemoryRecord } from "../src/pa/memory-governance-store";
import { MemoryGovernanceCoordinator } from "../src/pa/memory-governance-coordinator";
import { buildLegacyMemoryRollbackProjection } from "../src/pa/memory-governance-rollback";
import { createMemoryReviewQueueRepository } from "../src/pa/memory-review-queue-repository";
import {
    InMemoryMemoryGovernanceBackend,
    InMemoryMemoryGovernanceRepository,
    type DeviceMemoryGovernanceStateV1,
    type MemoryGovernanceRepository,
    type MemoryGovernanceTransaction,
} from "../src/pa/memory-governance-persistence";
import {
    CallbackReviewQueueRepository,
    ReviewQueueStore,
    type ReviewQueueItem,
} from "../src/pa/review-queue-store";

const NOW = new Date("2026-07-10T08:00:00.000Z");
const EXPIRES_AT = "2026-07-17T08:00:00.000Z";

function makeClaim(
    id: string,
    overrides: Partial<ConfirmedMemoryRecord> = {},
): ConfirmedMemoryRecord {
    return {
        id,
        type: "preference",
        lifecycle: "active",
        sensitivity: "low",
        sourceRefs: [{ path: `Notes/${id}.md`, whyShown: ["Explicit evidence"] }],
        summary: `Summary for ${id}`,
        scope: { kind: "current_note", paths: [`Notes/${id}.md`] },
        createdAt: "2026-07-01T08:00:00.000Z",
        updatedAt: "2026-07-09T08:00:00.000Z",
        confirmedAt: "2026-07-02T08:00:00.000Z",
        confirmationStrength: "explicit",
        ...overrides,
    };
}

function makeQueueItem(
    id: string,
    type: ReviewQueueItem["type"] = "memory_candidate",
    overrides: Partial<ReviewQueueItem> = {},
): ReviewQueueItem {
    return {
        id,
        type,
        title: `Title for ${id}`,
        claim: `Claim for ${id}`,
        scope: { kind: "current_note", paths: [`Notes/${id}.md`] },
        sourceRefs: [{ path: `Notes/${id}.md` }],
        originSurface: "pagelet",
        priority: "normal",
        status: "suggested",
        createdAt: "2026-07-03T08:00:00.000Z",
        updatedAt: "2026-07-03T08:00:00.000Z",
        whyShown: ["Relevant now"],
        dataBoundarySnapshotId: "boundary:v1",
        admissionReason: type === "memory_candidate" || type === "memory_conflict"
            ? "memory_confirmation_required"
            : "task_confirmation_required",
        ...overrides,
    };
}

function makePayload(overrides: Partial<LegacyMemoryPayload> = {}): LegacyMemoryPayload {
    return {
        memoryGovernance: { records: [] },
        reviewQueue: { enabled: true, items: [] },
        confirmedMemoryCount: 0,
        memoryAutoAcceptPaused: false,
        ...overrides,
    };
}

function makeTypeAAdoption(
    profileRecordId: string,
    overrides: Partial<Extract<ClassifiedLegacyTypeAAdoption, { status: "adopt" }>> = {},
): Extract<ClassifiedLegacyTypeAAdoption, { status: "adopt" }> {
    return {
        status: "adopt",
        profileRecordId,
        summary: "Prefer concise Chinese replies.",
        applicability: { kind: "whole_vault" },
        authority: "explicit_user",
        provenance: [{
            kind: "conversation",
            conversationIds: ["conversation-1"],
            observedAt: "2026-07-04T08:00:00.000Z",
        }],
        observedAt: "2026-07-04T08:00:00.000Z",
        profileProjectionState: "applied",
        ...overrides,
    };
}

describe("MemoryGovernanceMigrationCoordinator", () => {
    it("imports deterministic vault-local entities, verifies readback, and cuts over once", async () => {
        const repository = new InMemoryMemoryGovernanceRepository();
        const memoryQueueItem = makeQueueItem("queue-memory");
        const linkedClaim = makeClaim("claim-linked", {
            originReviewQueueItemId: memoryQueueItem.id,
        });
        const unlinkedClaim = makeClaim("claim-unlinked", {
            originReviewQueueItemId: "missing-exact-origin",
            confirmationStrength: "auto",
        });
        const nonMemoryItem = makeQueueItem("task-stays-legacy", "task_suggestion");
        const payload = makePayload({
            memoryGovernance: { records: [linkedClaim, unlinkedClaim] },
            reviewQueue: { enabled: true, items: [nonMemoryItem, memoryQueueItem] },
            confirmedMemoryCount: 29,
            memoryAutoAcceptPaused: true,
        });
        const coordinator = new MemoryGovernanceMigrationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            payload,
            typeAAdoptions: [makeTypeAAdoption("profile-1")],
            now: () => NOW,
        });

        const result = await coordinator.run();
        const state = await repository.initialize();

        expect(result).toMatchObject({
            ok: true,
            phase: "compatibility",
            alreadyMigrated: false,
            contextProjectionMode: "governed",
            counts: {
                acceptedClaims: 2,
                acceptedMemoryQueueItems: 1,
                adoptedTypeA: 1,
                rejected: 0,
            },
        });
        expect(state.commitSequence).toBe(4);
        expect(state.migrationStates["vault-a"]).toMatchObject({
            phase: "compatibility",
            sourceHash: result.sourceHash,
            migrationRunId: result.migrationRunId,
            cutoverSequence: 3,
            rollbackExpiresAt: EXPIRES_AT,
        });
        expect(state.policyStates["vault-a"]).toEqual({
            version: 1,
            mode: "effect_based",
            contextProjectionMode: "governed",
            legacyBaseline: {
                confirmedCount: 29,
                threshold: 30,
                autoAcceptPaused: true,
                importedFromSourceHash: result.sourceHash,
            },
        });

        const vaultClaims = state.claims.filter((claim) => claim.partition.kind === "vault"
            && claim.partition.key === "vault-a");
        expect(vaultClaims).toHaveLength(3);
        const legacyClaims = vaultClaims.filter((claim) => claim.effect === "stored_not_in_use");
        expect(legacyClaims).toHaveLength(2);
        expect(legacyClaims.every((claim) => claim.lifecycle === "active")).toBe(true);
        const profileClaim = vaultClaims.find((claim) => claim.effect === "future_answers");
        expect(profileClaim).toBeDefined();
        expect(state.revisions).toHaveLength(3);
        expect(state.revisions.find((revision) => revision.claimId === legacyClaims
            .find((claim) => state.projectionLinks.some((link) => link.claimId === claim.id
                && link.target.kind === "review_queue"))?.id)?.authority).toBe("explicit_user");
        expect(state.revisions.find((revision) => revision.claimId === legacyClaims
            .find((claim) => !state.projectionLinks.some((link) => link.claimId === claim.id
                && link.target.kind === "review_queue"))?.id)?.authority)
            .toBe("pa_inference");

        expect(state.memoryQueueItems).toHaveLength(1);
        expect(state.memoryQueueItems[0]).toMatchObject({
            type: "memory_candidate",
            partition: { kind: "vault", key: "vault-a" },
        });
        expect(state.memoryQueueItems[0].id).not.toBe(memoryQueueItem.id);
        const exactQueueLink = state.projectionLinks.find((link) => link.target.kind === "review_queue");
        expect(exactQueueLink).toMatchObject({
            relation: "origin",
            state: "active",
            ruleFingerprint: "legacy-confirmed-memory-v1",
            target: { kind: "review_queue", itemId: state.memoryQueueItems[0].id },
        });
        expect(state.projectionLinks.filter((link) => link.target.kind === "prompt_projection"))
            .toHaveLength(3);
        expect(state.projectionLinks.filter((link) => link.target.kind === "review_queue")).toHaveLength(1);
        expect(state.projectionLinks).toEqual(expect.arrayContaining([
            expect.objectContaining({
                claimId: profileClaim?.id,
                target: { kind: "type_a_profile", profileRecordId: "profile-1" },
                relation: "origin",
            }),
            expect.objectContaining({
                claimId: profileClaim?.id,
                target: { kind: "prompt_projection", projectionId: `prompt:${profileClaim?.id}` },
                relation: "derived_copy",
            }),
        ]));
        expect(state.pendingOperations).toEqual([
            expect.objectContaining({
                kind: "profile_projection",
                claimId: profileClaim?.id,
                profileRecordId: "profile-1",
                state: "applied",
            }),
        ]);
        expect(state.changeEvents).toEqual([]);
        expect(state.migrationDeltas).toEqual([]);

        expect(state.rollbackPayloadEntries).toHaveLength(4);
        expect(state.rollbackPayloadEntries.every((entry) => (
            entry.migrationRunId === result.migrationRunId
            && entry.partition.kind === "vault"
            && entry.partition.key === "vault-a"
            && entry.expiresAt === EXPIRES_AT
            && entry.checksum === checksumLegacyRollbackValue(entry.value)
        ))).toBe(true);
        expect(state.rollbackPayloadEntries.map((entry) => entry.value.kind).sort())
            .toEqual(["claim", "claim", "memory_queue", "policy"]);

        const beforeRepeat = JSON.parse(JSON.stringify(state)) as DeviceMemoryGovernanceStateV1;
        const repeated = await new MemoryGovernanceMigrationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            payload,
            typeAAdoptions: [makeTypeAAdoption("profile-1")],
            now: () => new Date("2026-07-11T08:00:00.000Z"),
        }).run();
        expect(repeated).toMatchObject({ ok: true, alreadyMigrated: true });
        expect(await repository.initialize()).toEqual(beforeRepeat);
    });

    it("accepts a same-source restart after a post-cutover queue delta without replaying the import plan", async () => {
        const repository = new InMemoryMemoryGovernanceRepository();
        const payload = makePayload({
            reviewQueue: { items: [makeQueueItem("legacy-queue")] },
        });
        await new MemoryGovernanceMigrationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            payload,
            now: () => NOW,
        }).run();
        const imported = await repository.initialize();
        const localQueueId = imported.memoryQueueItems[0].id;
        const queueRepository = await createMemoryReviewQueueRepository({
            repository,
            settingsRepository: new CallbackReviewQueueRepository(),
            opaqueVaultKey: "vault-a",
            now: () => new Date("2026-07-11T08:00:00.000Z"),
        });
        const queueStore = new ReviewQueueStore({
            repository: queueRepository,
            now: () => new Date("2026-07-11T08:00:00.000Z"),
        });
        await expect(queueStore.updateStatus(localQueueId, "accepted")).resolves.toMatchObject({
            ok: true,
            value: { status: "accepted" },
        });
        const mutated = await repository.initialize();
        expect(mutated.migrationDeltas).toEqual([
            expect.objectContaining({
                sequence: 1,
                kind: "queue_changed",
                entityId: localQueueId,
            }),
        ]);
        expect(mutated.rollbackPayloadEntries).toHaveLength(3);

        const restarted = await new MemoryGovernanceMigrationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            payload,
            // Compatibility may persist after rollback eligibility expires.
            now: () => new Date("2026-07-18T08:00:00.000Z"),
        }).run();

        expect(restarted).toMatchObject({
            ok: true,
            phase: "compatibility",
            alreadyMigrated: true,
            contextProjectionMode: "legacy",
        });
        expect(await repository.initialize()).toEqual(mutated);
    });

    it("keeps the governed reader authoritative when restart cannot verify rollback recovery", async () => {
        const repository = new InMemoryMemoryGovernanceRepository();
        const payload = makePayload({
            memoryGovernance: { records: [makeClaim("restart-corrupt")] },
        });
        await new MemoryGovernanceMigrationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            payload,
            typeAAdoptions: [makeTypeAAdoption("profile-1")],
            now: () => NOW,
        }).run();
        await repository.transact((draft) => {
            draft.rollbackPayloadEntries[0].checksum = "corrupted";
        });

        const restarted = await new MemoryGovernanceMigrationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            payload,
            typeAAdoptions: [makeTypeAAdoption("profile-1")],
            now: () => new Date("2026-07-11T08:00:00.000Z"),
        }).run();
        const state = await repository.initialize();

        expect(restarted).toMatchObject({
            ok: false,
            phase: "compatibility",
            reason: "rollback_payload_checksum_mismatch",
        });
        expect(state.migrationStates["vault-a"]).toMatchObject({
            phase: "compatibility",
        });
        expect(state.migrationStates["vault-a"].lastErrorCode).toBeUndefined();
        expect(state.policyStates["vault-a"].contextProjectionMode).toBe("governed");
    });

    it.each([
        { call: 1, failureMode: "before", expectedPhase: undefined },
        { call: 1, failureMode: "after", expectedPhase: "source_captured" },
        { call: 2, failureMode: "before", expectedPhase: "source_captured" },
        { call: 2, failureMode: "after", expectedPhase: "local_verifying" },
        { call: 3, failureMode: "before", expectedPhase: "local_verifying" },
        { call: 3, failureMode: "after", expectedPhase: "cutover_ready" },
        { call: 4, failureMode: "before", expectedPhase: "cutover_ready" },
        { call: 4, failureMode: "after", expectedPhase: "compatibility" },
    ] as const)(
        "resumes idempotently after transaction $call fails $failureMode commit",
        async ({ call, failureMode, expectedPhase }) => {
            const base = new InMemoryMemoryGovernanceRepository();
            const repository = new FailOnceTransactionRepository(base, call, failureMode);
            const payload = makePayload({
                memoryGovernance: { records: [makeClaim("restart-claim")] },
                reviewQueue: { items: [makeQueueItem("restart-queue")] },
                confirmedMemoryCount: 30,
                memoryAutoAcceptPaused: true,
            });
            const options = {
                repository: repository as MemoryGovernanceRepository,
                opaqueVaultKey: "restart-vault",
                payload,
                now: () => NOW,
            };

            await expect(new MemoryGovernanceMigrationCoordinator(options).run())
                .rejects.toThrow(`injected_${failureMode}_commit`);
            const interrupted = await base.initialize();
            expect(interrupted.migrationStates["restart-vault"]?.phase).toBe(expectedPhase);

            const recovered = await new MemoryGovernanceMigrationCoordinator({
                ...options,
                repository: base,
            }).run();
            const state = await base.initialize();
            expect(recovered).toMatchObject({ ok: true, phase: "compatibility" });
            expect(state.claims).toHaveLength(1);
            expect(state.revisions).toHaveLength(1);
            expect(state.memoryQueueItems).toHaveLength(1);
            expect(state.rollbackPayloadEntries).toHaveLength(3);
            expect(new Set(state.claims.map((entry) => entry.id)).size).toBe(state.claims.length);
            expect(new Set(state.revisions.map((entry) => entry.id)).size).toBe(state.revisions.length);
            expect(new Set(state.memoryQueueItems.map((entry) => entry.id)).size)
                .toBe(state.memoryQueueItems.length);
        },
    );

    it("keeps governed authority and local deltas while a changed legacy source awaits reconciliation", async () => {
        const repository = new InMemoryMemoryGovernanceRepository();
        const memoryQueueItem = makeQueueItem("source-queue");
        const firstPayload = makePayload({
            memoryGovernance: { records: [makeClaim("source-a")] },
            reviewQueue: { items: [memoryQueueItem] },
            confirmedMemoryCount: 29,
        });
        const first = await new MemoryGovernanceMigrationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            payload: firstPayload,
            typeAAdoptions: [makeTypeAAdoption("profile-1")],
            now: () => NOW,
        }).run();
        expect(first.ok).toBe(true);
        const imported = await repository.initialize();
        const localQueueId = imported.memoryQueueItems[0].id;
        const queueRepository = await createMemoryReviewQueueRepository({
            repository,
            settingsRepository: new CallbackReviewQueueRepository(),
            opaqueVaultKey: "vault-a",
            now: () => new Date("2026-07-11T08:00:00.000Z"),
        });
        const queueStore = new ReviewQueueStore({
            repository: queueRepository,
            now: () => new Date("2026-07-11T08:00:00.000Z"),
        });
        await queueStore.updateStatus(localQueueId, "accepted");
        const beforeSourceChange = await repository.initialize();
        const changedPayload = { ...firstPayload, confirmedMemoryCount: 30 };

        const changed = await new MemoryGovernanceMigrationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            payload: changedPayload,
            typeAAdoptions: [makeTypeAAdoption("profile-1")],
            now: () => new Date("2026-07-11T08:00:00.000Z"),
        }).run();
        const pending = await repository.initialize();

        expect(changed).toMatchObject({
            ok: true,
            phase: "compatibility",
            sourceHash: first.sourceHash,
            contextProjectionMode: "governed",
            reconciliationRequired: "legacy_source_changed",
        });
        expect(pending.migrationStates["vault-a"]).toMatchObject({
            sourceHash: first.sourceHash,
            phase: "compatibility",
            pendingLegacySourceHash: hashLegacyMemoryPayload(changedPayload),
        });
        expect(pending.migrationStates["vault-a"].lastErrorCode).toBeUndefined();
        expect(pending.policyStates["vault-a"].contextProjectionMode).toBe("governed");
        expect(pending.memoryQueueItems.find((item) => item.id === localQueueId)?.status)
            .toBe("accepted");
        expect(pending.migrationDeltas).toEqual(beforeSourceChange.migrationDeltas);
        expect(pending.rollbackPayloadEntries).toEqual(beforeSourceChange.rollbackPayloadEntries);
        expect(buildLegacyMemoryRollbackProjection(
            pending,
            "vault-a",
            new Date("2026-07-11T08:00:00.000Z"),
        )).toEqual({
            ok: false,
            reason: "legacy_source_reconciliation_required",
        });

        const beforeRestart = await repository.initialize();
        const restarted = await new MemoryGovernanceMigrationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            payload: changedPayload,
            typeAAdoptions: [makeTypeAAdoption("profile-1")],
            now: () => new Date("2026-07-12T08:00:00.000Z"),
        }).run();
        expect(restarted).toMatchObject({
            ok: false,
            phase: "compatibility",
            reason: "legacy_source_reconciliation_required",
        });
        expect(await repository.initialize()).toEqual(beforeRestart);
    });

    it("deterministically accepts a source change outside the governed Memory projection", async () => {
        const repository = new InMemoryMemoryGovernanceRepository();
        const memoryItem = makeQueueItem("memory-stable");
        const firstPayload = makePayload({
            reviewQueue: {
                items: [memoryItem, makeQueueItem("task-a", "task_suggestion")],
            },
        });
        const first = await new MemoryGovernanceMigrationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            payload: firstPayload,
            now: () => NOW,
        }).run();
        const changedPayload = makePayload({
            reviewQueue: {
                items: [memoryItem, makeQueueItem("task-b", "task_suggestion")],
            },
        });

        const reconciled = await new MemoryGovernanceMigrationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            payload: changedPayload,
            now: () => new Date("2026-07-11T08:00:00.000Z"),
        }).run();
        const state = await repository.initialize();

        expect(reconciled).toMatchObject({
            ok: true,
            sourceHash: first.sourceHash,
            alreadyMigrated: true,
        });
        expect(reconciled).not.toHaveProperty("reconciliationRequired");
        expect(state.migrationStates["vault-a"].pendingLegacySourceHash).toBeUndefined();
    });

    it("rejects Memory content that reappears after explicit finalization", async () => {
        const repository = new InMemoryMemoryGovernanceRepository();
        const first = await new MemoryGovernanceMigrationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            payload: makePayload({ memoryGovernance: { records: [makeClaim("legacy-a")] } }),
            typeAAdoptions: [],
            now: () => NOW,
        }).run();
        expect(first.ok).toBe(true);
        await repository.transact((draft) => {
            draft.migrationStates["vault-a"].phase = "finalized";
            delete draft.migrationStates["vault-a"].rollbackExpiresAt;
            draft.rollbackPayloadEntries = [];
            draft.migrationDeltas = [];
        });

        const reappeared = await new MemoryGovernanceMigrationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            payload: makePayload({ memoryGovernance: { records: [makeClaim("legacy-from-device-b")] } }),
            typeAAdoptions: [],
            now: () => new Date("2026-07-12T08:00:00.000Z"),
        }).run();

        expect(reappeared).toMatchObject({
            ok: false,
            phase: "failed",
            reason: "legacy_source_changed",
        });
        expect((await repository.initialize()).migrationStates["vault-a"].phase).toBe("finalized");
    });

    it.each([
        { confirmedMemoryCount: 29, paused: false },
        { confirmedMemoryCount: 30, paused: true },
    ])("preserves the exact legacy 30-threshold baseline %#", async ({ confirmedMemoryCount, paused }) => {
        const repository = new InMemoryMemoryGovernanceRepository();
        const result = await new MemoryGovernanceMigrationCoordinator({
            repository,
            opaqueVaultKey: `vault-${confirmedMemoryCount}`,
            payload: makePayload({
                confirmedMemoryCount,
                memoryAutoAcceptPaused: paused,
            }),
            now: () => NOW,
        }).run();
        const policy = (await repository.initialize()).policyStates[`vault-${confirmedMemoryCount}`];

        expect(result.ok).toBe(true);
        expect(policy).toMatchObject({
            mode: "legacy_threshold",
            contextProjectionMode: "legacy",
            legacyBaseline: {
                confirmedCount: confirmedMemoryCount,
                threshold: 30,
                autoAcceptPaused: paused,
            },
        });
    });

    it("reports rejected legacy inputs without counting or importing them as migrated", async () => {
        const repository = new InMemoryMemoryGovernanceRepository();
        const result = await new MemoryGovernanceMigrationCoordinator({
            repository,
            opaqueVaultKey: "vault-rejected",
            payload: makePayload({
                memoryGovernance: { records: [makeClaim("valid-claim"), { id: "invalid-claim" }] },
                reviewQueue: {
                    items: [
                        makeQueueItem("valid-queue"),
                        { id: "invalid-queue", type: "memory_candidate" },
                    ],
                },
                confirmedMemoryCount: "not-a-count",
            }),
            now: () => NOW,
        }).run();
        const state = await repository.initialize();

        expect(result).toMatchObject({
            ok: true,
            counts: {
                acceptedClaims: 1,
                acceptedMemoryQueueItems: 1,
                rejected: 3,
            },
        });
        expect(state.claims).toHaveLength(1);
        expect(state.memoryQueueItems).toHaveLength(1);
        expect(state.policyStates["vault-rejected"].legacyBaseline?.confirmedCount).toBe(0);
    });

    it("retains the exact origin fingerprint when the matching raw Memory queue item is malformed", async () => {
        const repository = new InMemoryMemoryGovernanceRepository();
        const originId = "malformed-private-origin";
        const result = await new MemoryGovernanceMigrationCoordinator({
            repository,
            opaqueVaultKey: "vault-malformed-origin",
            payload: makePayload({
                memoryGovernance: {
                    records: [makeClaim("claim-with-malformed-origin", {
                        originReviewQueueItemId: originId,
                    })],
                },
                reviewQueue: {
                    items: [{
                        id: originId,
                        type: "memory_candidate",
                        claim: "Private raw queue content that must not be silently retained.",
                    }],
                },
            }),
            now: () => NOW,
        }).run();
        const state = await repository.initialize();

        expect(result).toMatchObject({
            ok: true,
            counts: { acceptedClaims: 1, acceptedMemoryQueueItems: 0, rejected: 1 },
        });
        expect(state.claims).toHaveLength(1);
        expect(state.claims[0].legacyCompatibility).toEqual({
            recordIdFingerprints: [
                fingerprintLegacyMemoryEntityId("record", "claim-with-malformed-origin"),
            ],
            memoryQueueItemIdFingerprints: [
                fingerprintLegacyMemoryEntityId("memory_queue", originId),
            ],
        });
        expect(state.memoryQueueItems).toEqual([]);
        expect(state.projectionLinks.some((link) => link.target.kind === "review_queue"))
            .toBe(false);
    });

    it("isolates two vault migrations sharing one device repository", async () => {
        const backend = new InMemoryMemoryGovernanceBackend();
        const firstRepository = new InMemoryMemoryGovernanceRepository(backend);
        const secondRepository = new InMemoryMemoryGovernanceRepository(backend);
        const payload = makePayload({
            memoryGovernance: { records: [makeClaim("shared-legacy-id")] },
            reviewQueue: { items: [makeQueueItem("shared-queue-id")] },
            confirmedMemoryCount: 30,
        });

        await Promise.all([
            new MemoryGovernanceMigrationCoordinator({
                repository: firstRepository,
                opaqueVaultKey: "vault-a",
                payload,
                now: () => NOW,
            }).run(),
            new MemoryGovernanceMigrationCoordinator({
                repository: secondRepository,
                opaqueVaultKey: "vault-b",
                payload,
                now: () => NOW,
            }).run(),
        ]);
        const state = await firstRepository.initialize();

        expect(Object.keys(state.migrationStates).sort()).toEqual(["vault-a", "vault-b"]);
        expect(Object.keys(state.policyStates).sort()).toEqual(["vault-a", "vault-b"]);
        expect(state.claims).toHaveLength(2);
        expect(state.memoryQueueItems).toHaveLength(2);
        expect(new Set(state.claims.map((claim) => claim.id)).size).toBe(2);
        expect(new Set(state.memoryQueueItems.map((item) => item.id)).size).toBe(2);
        expect(state.claims.map((claim) => claim.partition)).toEqual(expect.arrayContaining([
            { kind: "vault", key: "vault-a" },
            { kind: "vault", key: "vault-b" },
        ]));
        expect(state.claims.some((claim) => claim.partition.kind === "device_collaboration")).toBe(false);
    });

    it("coalesces concurrent migration attempts for the same vault and source", async () => {
        const backend = new InMemoryMemoryGovernanceBackend();
        const firstRepository = new InMemoryMemoryGovernanceRepository(backend);
        const secondRepository = new InMemoryMemoryGovernanceRepository(backend);
        const payload = makePayload({
            memoryGovernance: { records: [makeClaim("concurrent-claim")] },
            reviewQueue: { items: [makeQueueItem("concurrent-queue")] },
        });
        const options = {
            opaqueVaultKey: "same-vault",
            payload,
            typeAAdoptions: [makeTypeAAdoption("concurrent-profile")],
            now: () => NOW,
        };

        const results = await Promise.all([
            new MemoryGovernanceMigrationCoordinator({ ...options, repository: firstRepository }).run(),
            new MemoryGovernanceMigrationCoordinator({ ...options, repository: secondRepository }).run(),
        ]);
        const state = await firstRepository.initialize();

        expect(results.every((result) => result.ok)).toBe(true);
        expect(state.migrationStates["same-vault"].phase).toBe("compatibility");
        expect(state.claims).toHaveLength(2);
        expect(state.revisions).toHaveLength(2);
        expect(state.memoryQueueItems).toHaveLength(1);
        expect(state.pendingOperations).toHaveLength(1);
        expect(state.rollbackPayloadEntries).toHaveLength(3);
    });

    it("stages eligible Type-A records but keeps the prompt projection fully legacy when any record is blocked", async () => {
        const repository = new InMemoryMemoryGovernanceRepository();
        const adoptions: ClassifiedLegacyTypeAAdoption[] = [
            makeTypeAAdoption("profile-allowed"),
            {
                status: "adoption_blocked",
                profileRecordId: "profile-blocked",
                reason: "unknown_sensitivity",
            },
        ];

        const result = await new MemoryGovernanceMigrationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            payload: makePayload(),
            typeAAdoptions: adoptions,
            now: () => NOW,
        }).run();
        const state = await repository.initialize();

        expect(result).toMatchObject({
            ok: true,
            contextProjectionMode: "legacy",
            counts: { adoptedTypeA: 1, blockedTypeA: 1 },
        });
        expect(state.policyStates["vault-a"].contextProjectionMode).toBe("legacy");
        expect(state.claims).toHaveLength(1);
        expect(state.projectionLinks).toEqual([
            expect.objectContaining({
                target: { kind: "type_a_profile", profileRecordId: "profile-allowed" },
            }),
        ]);
        expect(state.projectionLinks.some((link) => link.target.kind === "prompt_projection")).toBe(false);
        expect(state.changeEvents).toEqual([]);
    });

    it("keeps legacy context until every immutable Profile projection is verified", async () => {
        const repository = new InMemoryMemoryGovernanceRepository();
        const result = await new MemoryGovernanceMigrationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            payload: makePayload(),
            typeAAdoptions: [makeTypeAAdoption("profile-pending", {
                profileProjectionState: "pending",
            })],
            now: () => NOW,
        }).run();
        const state = await repository.initialize();

        expect(result).toMatchObject({
            ok: true,
            contextProjectionMode: "legacy",
        });
        expect(state.policyStates["vault-a"].contextProjectionMode).toBe("legacy");
        expect(state.pendingOperations).toEqual([
            expect.objectContaining({
                kind: "profile_projection",
                profileRecordId: "profile-pending",
                state: "pending",
            }),
        ]);
    });

    it("fails corrupted readback closed without exposing a partial governed projection", async () => {
        const base = new InMemoryMemoryGovernanceRepository();
        const repository = new CorruptBeforeTransactionRepository(base, 3);
        const result = await new MemoryGovernanceMigrationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            payload: makePayload({ memoryGovernance: { records: [makeClaim("verify-me")] } }),
            typeAAdoptions: [makeTypeAAdoption("profile-1")],
            now: () => NOW,
        }).run();
        const state = await base.initialize();

        expect(result).toMatchObject({
            ok: false,
            reason: "migration_readback_mismatch",
            phase: "failed",
        });
        expect(state.migrationStates["vault-a"]).toMatchObject({
            phase: "failed",
            lastErrorCode: "migration_readback_mismatch",
        });
        expect(state.policyStates["vault-a"].contextProjectionMode).toBe("legacy");
    });

    it("retains expired proof while blocked Type-A keeps compatibility on the legacy reader", async () => {
        const repository = new InMemoryMemoryGovernanceRepository();
        const payload = makePayload({
            memoryGovernance: { records: [makeClaim("legacy-reader-proof")] },
        });
        const typeAAdoptions: ClassifiedLegacyTypeAAdoption[] = [{
            status: "adoption_blocked",
            profileRecordId: "profile-blocked",
            reason: "unknown_sensitivity",
        }];
        const initial = await new MemoryGovernanceMigrationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            payload,
            typeAAdoptions,
            now: () => NOW,
        }).run();
        expect(initial).toMatchObject({
            ok: true,
            contextProjectionMode: "legacy",
        });
        const beforeGc = await repository.initialize();
        const proofIds = beforeGc.rollbackPayloadEntries.map((entry) => entry.id);

        await expect(new MemoryGovernanceCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            now: () => new Date("2026-07-18T08:00:00.001Z"),
        }).collectGarbage()).resolves.toEqual({
            ok: true,
            value: { removedSnapshotIds: [] },
        });
        const afterGc = await repository.initialize();
        expect(afterGc.migrationStates["vault-a"].rollbackExpiresAt).toBe(EXPIRES_AT);
        expect(afterGc.rollbackPayloadEntries.map((entry) => entry.id)).toEqual(proofIds);

        await expect(new MemoryGovernanceMigrationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            payload,
            typeAAdoptions,
            now: () => new Date("2026-07-20T08:00:00.000Z"),
        }).run()).resolves.toMatchObject({
            ok: true,
            alreadyMigrated: true,
            contextProjectionMode: "legacy",
        });
    });

    it("restarts governed compatibility after the expired restore proof was garbage-collected", async () => {
        const repository = new InMemoryMemoryGovernanceRepository();
        const payload = makePayload({
            memoryGovernance: { records: [makeClaim("survives-proof-gc")] },
            confirmedMemoryCount: 1,
        });
        const initial = await new MemoryGovernanceMigrationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            payload,
            typeAAdoptions: [],
            now: () => NOW,
        }).run();
        expect(initial).toMatchObject({ ok: true, contextProjectionMode: "governed" });
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

        const restarted = await new MemoryGovernanceMigrationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            payload,
            typeAAdoptions: [],
            now: () => new Date("2026-07-20T08:00:00.000Z"),
        }).run();
        expect(restarted).toMatchObject({
            ok: true,
            alreadyMigrated: true,
            contextProjectionMode: "governed",
            sourceHash: initial.sourceHash,
            migrationRunId: initial.migrationRunId,
        });
        expect((await repository.initialize()).migrationStates["vault-a"]).toMatchObject({
            phase: "compatibility",
            sourceHash: initial.sourceHash,
        });

        const changedPayload = makePayload({
            memoryGovernance: {
                records: [makeClaim("survives-proof-gc", { summary: "Changed on another device." })],
            },
            confirmedMemoryCount: 1,
        });
        const changed = await new MemoryGovernanceMigrationCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            payload: changedPayload,
            typeAAdoptions: [],
            now: () => new Date("2026-07-20T08:01:00.000Z"),
        }).run();
        expect(changed).toMatchObject({
            ok: true,
            alreadyMigrated: true,
            contextProjectionMode: "governed",
            reconciliationRequired: "legacy_source_changed",
        });
        expect((await repository.initialize()).migrationStates["vault-a"].pendingLegacySourceHash)
            .toBe(hashLegacyMemoryPayload(changedPayload));
    });
});

class FailOnceTransactionRepository implements MemoryGovernanceRepository {
    private callCount = 0;
    private failed = false;

    constructor(
        private readonly delegate: MemoryGovernanceRepository,
        private readonly failOnCall: number,
        private readonly mode: "before" | "after",
    ) {}

    initialize(): Promise<DeviceMemoryGovernanceStateV1> {
        return this.delegate.initialize();
    }

    async transact<T>(operation: MemoryGovernanceTransaction<T>): Promise<T> {
        this.callCount++;
        if (!this.failed && this.callCount === this.failOnCall && this.mode === "before") {
            this.failed = true;
            throw new Error("injected_before_commit");
        }
        const result = await this.delegate.transact(operation);
        if (!this.failed && this.callCount === this.failOnCall && this.mode === "after") {
            this.failed = true;
            throw new Error("injected_after_commit");
        }
        return result;
    }

    subscribe(listener: (commitSequence: number) => void): () => void {
        return this.delegate.subscribe(listener);
    }

    dispose(): Promise<void> {
        return Promise.resolve();
    }
}

class CorruptBeforeTransactionRepository implements MemoryGovernanceRepository {
    private callCount = 0;

    constructor(
        private readonly delegate: MemoryGovernanceRepository,
        private readonly corruptOnCall: number,
    ) {}

    initialize(): Promise<DeviceMemoryGovernanceStateV1> {
        return this.delegate.initialize();
    }

    transact<T>(operation: MemoryGovernanceTransaction<T>): Promise<T> {
        this.callCount++;
        if (this.callCount !== this.corruptOnCall) return this.delegate.transact(operation);
        return this.delegate.transact((draft) => {
            if (draft.claims[0]) draft.claims[0].effect = "future_answers";
            return operation(draft);
        });
    }

    subscribe(listener: (commitSequence: number) => void): () => void {
        return this.delegate.subscribe(listener);
    }

    dispose(): Promise<void> {
        return Promise.resolve();
    }
}
