import { MemoryProfileProjectionWorker } from "../src/pa/memory-profile-projection-worker";
import { MemoryGovernanceCoordinator } from "../src/pa/memory-governance-coordinator";
import {
    InMemoryMemoryGovernanceBackend,
    InMemoryMemoryGovernanceRepository,
    createEmptyDeviceMemoryGovernanceStateV1,
} from "../src/pa/memory-governance-persistence";

const NOW = new Date("2026-07-11T08:00:00.000Z");

describe("MemoryProfileProjectionWorker", () => {
    it("applies an exact pending projection and marks the outbox only after success", async () => {
        const repository = repositoryFor(state());
        const applied: string[] = [];
        const worker = new MemoryProfileProjectionWorker({
            repository,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            applyProjection: async (input) => { applied.push(`${input.profileRecordId}:${input.summary}`); },
        });

        await expect(worker.resumePending()).resolves.toEqual({
            completed: ["claim-a"],
            pending: [],
        });
        expect(applied).toEqual(["profile-a:Corrected preference"]);
        expect((await repository.initialize()).pendingOperations[0]).toMatchObject({
            state: "applied",
            attemptCount: 1,
        });
    });

    it("keeps a failed exact projection durable for retry", async () => {
        const repository = repositoryFor(state());
        let fail = true;
        const worker = new MemoryProfileProjectionWorker({
            repository,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            applyProjection: async () => {
                if (fail) throw new Error("profile unavailable");
            },
        });

        await expect(worker.resumePending()).resolves.toEqual({ completed: [], pending: ["claim-a"] });
        expect((await repository.initialize()).pendingOperations[0]).toMatchObject({
            state: "pending",
            attemptCount: 1,
            lastErrorCode: "profile_projection_apply_failed",
        });

        fail = false;
        await expect(worker.resumePending()).resolves.toEqual({ completed: ["claim-a"], pending: [] });
    });

    it("never recreates a projection after Forget has blocked the claim", async () => {
        const initial = state();
        initial.claims[0].lifecycle = "forget_pending";
        const repository = repositoryFor(initial);
        const applyProjection = jest.fn();
        const worker = new MemoryProfileProjectionWorker({
            repository,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            applyProjection,
        });

        await expect(worker.resumePending()).resolves.toEqual({ completed: [], pending: ["claim-a"] });
        expect(applyProjection).not.toHaveBeenCalled();
    });

    it("removes an exact Profile projection and marks the durable outbox after success", async () => {
        const initial = removalState();
        const repository = repositoryFor(initial);
        const removeProjection = jest.fn(async () => undefined);
        const worker = new MemoryProfileProjectionWorker({
            repository,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            applyProjection: async () => undefined,
            removeProjection,
        });

        await expect(worker.resumePending()).resolves.toEqual({ completed: ["claim-a"], pending: [] });
        expect(removeProjection).toHaveBeenCalledWith(expect.objectContaining({
            claimId: "claim-a",
            profileRecordId: "profile-a",
        }));
        expect((await repository.initialize()).pendingOperations[0]).toMatchObject({
            action: "remove",
            projectionLinkId: "link-a",
            state: "applied",
            attemptCount: 1,
        });
        expect((await repository.initialize()).projectionLinks[0].state).toBe("redacted");
    });

    it("lets only the owning vault remove a device-wide claim's Profile copy", async () => {
        const initial = state();
        initial.claims[0].partition = { kind: "device_collaboration", key: "device" };
        initial.claims[0].effect = "collaboration_default";
        initial.pendingOperations = [{
            id: "operation-device-remove",
            kind: "profile_projection",
            action: "remove",
            claimId: "claim-a",
            profileRecordId: "profile-a",
            projectionLinkId: "link-a",
            ownerVaultKey: "vault-a",
            state: "pending",
            attemptCount: 0,
            createdAt: NOW.toISOString(),
            updatedAt: NOW.toISOString(),
        }];
        const repository = repositoryFor(initial);
        const removeFromB = jest.fn(async () => undefined);
        const workerB = new MemoryProfileProjectionWorker({
            repository,
            opaqueVaultKey: "vault-b",
            now: () => NOW,
            applyProjection: async () => undefined,
            removeProjection: removeFromB,
        });

        await expect(workerB.resumePending()).resolves.toEqual({ completed: [], pending: [] });
        expect(removeFromB).not.toHaveBeenCalled();
        expect((await repository.initialize()).pendingOperations[0]).toMatchObject({
            state: "pending",
            ownerVaultKey: "vault-a",
        });

        const removeFromA = jest.fn(async () => undefined);
        const workerA = new MemoryProfileProjectionWorker({
            repository,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            applyProjection: async () => undefined,
            removeProjection: removeFromA,
        });
        await expect(workerA.resumePending()).resolves.toEqual({ completed: ["claim-a"], pending: [] });
        expect(removeFromA).toHaveBeenCalledTimes(1);
        const final = await repository.initialize();
        expect(final.pendingOperations[0]).toMatchObject({ state: "applied" });
        expect(final.projectionLinks[0].state).toBe("redacted");
    });

    it("keeps a failed exact Profile removal pending for restart recovery", async () => {
        const repository = repositoryFor(removalState());
        const worker = new MemoryProfileProjectionWorker({
            repository,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            applyProjection: async () => undefined,
            removeProjection: async () => { throw new Error("profile unavailable"); },
        });

        await expect(worker.resumePending()).resolves.toEqual({ completed: [], pending: ["claim-a"] });
        expect((await repository.initialize()).pendingOperations[0]).toMatchObject({
            action: "remove",
            state: "pending",
            lastErrorCode: "profile_projection_remove_failed",
        });
    });

    it("does not let Forget or Add Undo overtake an in-flight Profile projection", async () => {
        const initial = automaticAddState();
        const repository = repositoryFor(initial);
        const started = deferred();
        const release = deferred();
        const worker = new MemoryProfileProjectionWorker({
            repository,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            applyProjection: async () => {
                started.resolve();
                await release.promise;
            },
        });
        const inFlight = worker.resumePending();
        await started.promise;

        const lifecycle = new MemoryGovernanceCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            idFactory: () => "lifecycle-id",
        });
        const before = await repository.initialize();

        await expect(lifecycle.forget({ claimId: "claim-a" })).resolves.toEqual({
            ok: false,
            reason: "claim_operation_pending",
        });
        await expect(lifecycle.undoRecentChange({ eventId: "add-event-a" })).resolves.toEqual({
            ok: false,
            reason: "claim_operation_pending",
        });

        const blocked = await repository.initialize();
        expect(blocked.commitSequence).toBe(before.commitSequence);
        expect(blocked.claims[0]).toEqual(before.claims[0]);
        expect(blocked.revisions).toEqual(before.revisions);
        expect(blocked.projectionLinks).toEqual(before.projectionLinks);
        expect(blocked.pendingOperations).toEqual([
            expect.objectContaining({
                id: "operation-a",
                kind: "profile_projection",
                state: "pending",
            }),
        ]);

        release.resolve();
        await expect(inFlight).resolves.toEqual({ completed: ["claim-a"], pending: [] });
        expect((await repository.initialize()).pendingOperations[0]).toMatchObject({
            id: "operation-a",
            state: "applied",
        });
    });
});

function state() {
    const state = createEmptyDeviceMemoryGovernanceStateV1();
    state.claims.push({
        id: "claim-a",
        partition: { kind: "vault", key: "vault-a" },
        memoryType: "preference",
        sensitivity: "low",
        applicability: { kind: "whole_vault" },
        activeRevisionId: "revision-a",
        effect: "future_answers",
        lifecycle: "active",
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
    });
    state.revisions.push({
        id: "revision-a",
        claimId: "claim-a",
        summary: "Corrected preference",
        provenance: [{
            kind: "conversation",
            conversationIds: ["conversation-a"],
            observedAt: NOW.toISOString(),
        }],
        authority: "user_correction",
        createdAt: NOW.toISOString(),
    });
    state.projectionLinks.push({
        id: "link-a",
        claimId: "claim-a",
        target: { kind: "type_a_profile", profileRecordId: "profile-a" },
        relation: "origin",
        state: "active",
        sourceFingerprintId: "claim-a",
        ruleFingerprint: "type-a-v1",
        createdAt: NOW.toISOString(),
    });
    state.pendingOperations.push({
        id: "operation-a",
        kind: "profile_projection",
        claimId: "claim-a",
        profileRecordId: "profile-a",
        targetRevisionId: "revision-a",
        state: "pending",
        attemptCount: 0,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
    });
    return state;
}

function removalState(): ReturnType<typeof state> {
    const result = state();
    delete result.claims[0].activeRevisionId;
    result.claims[0].effect = "none";
    result.claims[0].lifecycle = "undone_add_tombstone";
    result.revisions = [];
    result.projectionLinks[0].state = "redacted";
    result.pendingOperations = [{
        id: "operation-remove-a",
        kind: "profile_projection",
        action: "remove",
        claimId: "claim-a",
        profileRecordId: "profile-a",
        projectionLinkId: "link-a",
        state: "pending",
        attemptCount: 0,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
    }];
    return result;
}

function automaticAddState(): ReturnType<typeof state> {
    const result = state();
    result.policyStates["vault-a"] = {
        version: 1,
        mode: "effect_based",
        contextProjectionMode: "governed",
    };
    result.changeEvents.push({
        id: "add-event-a",
        claimId: "claim-a",
        kind: "add",
        scopeKey: "vault-a",
        effect: "future_answers",
        occurredAt: NOW.toISOString(),
        undoSnapshotId: "add-snapshot-a",
    });
    result.undoSnapshots.push({
        id: "add-snapshot-a",
        claimId: "claim-a",
        eventId: "add-event-a",
        partition: { kind: "vault", key: "vault-a" },
        restoreMode: "remove_added_claim",
        revisions: [],
        projectionLinks: result.projectionLinks.map((link) => ({
            ...link,
            target: { ...link.target },
        })),
        createdAt: NOW.toISOString(),
        expiresAt: "2026-07-18T08:00:00.000Z",
    });
    return result;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}

function repositoryFor(initial: ReturnType<typeof state>): InMemoryMemoryGovernanceRepository {
    return new InMemoryMemoryGovernanceRepository(new InMemoryMemoryGovernanceBackend(initial));
}
