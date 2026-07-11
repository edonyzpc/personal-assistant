import {
    MemoryAdmissionCoordinator,
    readTypeATargetGeneration,
    type GovernedMemoryAdmissionInput,
} from "../src/pa/memory-admission-coordinator";
import { MemoryGovernanceCoordinator } from "../src/pa/memory-governance-coordinator";
import { MemoryProfileProjectionWorker } from "../src/pa/memory-profile-projection-worker";
import {
    InMemoryMemoryGovernanceBackend,
    InMemoryMemoryGovernanceRepository,
    createEmptyDeviceMemoryGovernanceStateV1,
    type MemoryGovernanceRepository,
    type MemoryGovernanceTransaction,
} from "../src/pa/memory-governance-persistence";
import { checksumLegacyRollbackValue } from "../src/pa/memory-governance-rollback-checksum";
import { buildLegacyMemoryRollbackProjection } from "../src/pa/memory-governance-rollback";
import {
    createTypeATargetSuppressionFingerprint,
    LEGACY_TYPE_A_ADOPTION_RULE_FINGERPRINT,
    TYPE_A_TARGET_SUPPRESSION_RULE_FINGERPRINT,
} from "../src/pa/memory-governance-migration-coordinator";

const NOW = new Date("2026-07-11T08:00:00.000Z");
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60_000;
const VAULT_A_PARTITION = { kind: "vault" as const, key: "vault-a" };

describe("MemoryAdmissionCoordinator", () => {
    it("atomically admits a safe Type-A effect with event, exact links, and durable Profile outbox", async () => {
        const repository = repositoryForReadyState();
        const coordinator = createCoordinator(repository);

        await expect(coordinator.admit(typeAInput())).resolves.toMatchObject({
            ok: true,
            value: { decision: "silent_durable", claimId: expect.any(String) },
        });
        const state = await repository.initialize();
        expect(state.claims).toHaveLength(1);
        expect(state.claims[0]).toMatchObject({
            effect: "future_answers",
            lifecycle: "active",
            partition: { kind: "vault", key: "vault-a" },
        });
        expect(state.changeEvents).toEqual([
            expect.objectContaining({
                kind: "add",
                claimId: state.claims[0].id,
                undoSnapshotId: expect.any(String),
            }),
        ]);
        expect(state.undoSnapshots).toEqual([
            expect.objectContaining({
                restoreMode: "remove_added_claim",
                claimId: state.claims[0].id,
                revisions: [],
                projectionLinks: expect.arrayContaining([
                    expect.objectContaining({ target: expect.objectContaining({ kind: "prompt_projection" }) }),
                    expect.objectContaining({ target: expect.objectContaining({ kind: "type_a_profile" }) }),
                ]),
            }),
        ]);
        expect(state.projectionLinks).toEqual(expect.arrayContaining([
            expect.objectContaining({
                target: { kind: "prompt_projection", projectionId: `prompt:${state.claims[0].id}` },
                sourceFingerprintId: "source-type-a",
                ruleFingerprint: "type-a-admission-v1",
            }),
            expect.objectContaining({
                target: { kind: "type_a_profile", profileRecordId: "profile-a" },
            }),
        ]));
        expect(state.pendingOperations).toEqual([
            expect.objectContaining({
                kind: "profile_projection",
                claimId: state.claims[0].id,
                profileRecordId: "profile-a",
                state: "pending",
            }),
        ]);
        expect(state.memoryQueueItems).toHaveLength(0);
    });

    it("treats an exact Type-A source/rule replay as already committed despite a new extraction timestamp", async () => {
        const repository = repositoryForReadyState();
        const coordinator = createCoordinator(repository);
        const first = await coordinator.admit(typeAInput());
        expect(first).toMatchObject({ ok: true, value: { decision: "silent_durable" } });
        await markProfileProjectionApplied(repository);
        const beforeReplay = await repository.initialize();
        const replay = typeAInput();
        replay.summary = "Nondeterministic alternate wording from the same turn.";
        replay.provenance = [{
            kind: "conversation",
            conversationIds: ["conversation-a"],
            observedAt: "2026-07-11T09:00:00.000Z",
        }];
        replay.expectedTargetState = readTypeATargetGeneration(
            beforeReplay,
            "profile-a",
            VAULT_A_PARTITION,
        );

        await expect(coordinator.admit(replay)).resolves.toEqual(first);
        const afterReplay = await repository.initialize();
        expect(afterReplay.revisions).toEqual(beforeReplay.revisions);
        expect(afterReplay.changeEvents).toEqual(beforeReplay.changeEvents);
        expect(afterReplay.undoSnapshots).toEqual(beforeReplay.undoSnapshots);
        expect(afterReplay.pendingOperations).toEqual(beforeReplay.pendingOperations);
    });

    it("routes an unsafe silent candidate to prior review, then confirms queue and claim in one transaction", async () => {
        const repository = repositoryForReadyState();
        const coordinator = createCoordinator(repository);
        const input = memoryCandidateInput({ conflict: "present" });

        const queued = await coordinator.admit(input);
        expect(queued).toMatchObject({
            ok: true,
            value: {
                decision: "require_prior_review",
                queueItem: expect.objectContaining({ status: "suggested" }),
            },
        });
        let state = await repository.initialize();
        expect(state.claims).toHaveLength(0);
        expect(state.memoryQueueItems).toHaveLength(1);

        const queueItemId = state.memoryQueueItems[0].id;
        const confirmation = await coordinator.confirmQueueItem({
            queueItemId,
            dataBoundaryAllowed: true,
        });
        expect(confirmation).toMatchObject({
            ok: true,
            value: {
                claimId: expect.any(String),
                queueItem: expect.objectContaining({ id: queueItemId, status: "applied" }),
            },
        });
        await expect(coordinator.confirmQueueItem({
            queueItemId,
            dataBoundaryAllowed: true,
        })).resolves.toEqual(confirmation);
        state = await repository.initialize();
        expect(state.memoryQueueItems[0].status).toBe("applied");
        expect(state.claims).toHaveLength(1);
        expect(state.revisions[0].authority).toBe("explicit_user");
        expect(state.changeEvents[0].kind).toBe("add");
        expect(state.changeEvents[0].undoSnapshotId).toBeUndefined();
        expect(state.undoSnapshots).toHaveLength(0);
        expect(state.projectionLinks).toEqual(expect.arrayContaining([
            expect.objectContaining({ target: { kind: "review_queue", itemId: queueItemId } }),
            expect.objectContaining({ target: expect.objectContaining({ kind: "prompt_projection" }) }),
        ]));
    });

    it("persists a text-free rejection marker and blocks only unchanged source/rule admission", async () => {
        const repository = repositoryForReadyState();
        const coordinator = createCoordinator(repository);
        const input = memoryCandidateInput({ conflict: "present" });
        const queued = await coordinator.admit(input);
        if (!queued.ok || !queued.value.queueItem) throw new Error("queue setup failed");

        const dismissal = await coordinator.dismissQueueItem({
            queueItemId: queued.value.queueItem.id,
        });
        expect(dismissal).toMatchObject({
            ok: true,
            value: { queueItem: expect.objectContaining({ status: "dismissed" }) },
        });
        await expect(coordinator.dismissQueueItem({
            queueItemId: queued.value.queueItem.id,
        })).resolves.toEqual(dismissal);
        let state = await repository.initialize();
        expect(state.suppressionMarkers).toEqual([
            expect.objectContaining({
                sourceFingerprintId: input.sourceFingerprintId,
                ruleFingerprint: input.ruleFingerprint,
                reason: "rejected",
            }),
        ]);
        expect(JSON.stringify(state.suppressionMarkers)).not.toContain(input.summary);
        await expect(coordinator.admit(input)).resolves.toEqual({
            ok: true,
            value: { decision: "reject" },
        });

        const changed = memoryCandidateInput({ conflict: "present" });
        changed.sourceFingerprintId = "source-note-b";
        changed.admissionKey = "memory-candidate-source-b";
        changed.provenance = [{ kind: "note", sourceRef: { path: "notes/source.md", sourceId: "source-b" } }];
        await expect(coordinator.admit(changed)).resolves.toMatchObject({
            ok: true,
            value: { decision: "require_prior_review" },
        });
        state = await repository.initialize();
        expect(state.memoryQueueItems.filter((item) => item.status === "suggested")).toHaveLength(1);
    });

    it("rechecks suppression inside the transaction and persists nothing", async () => {
        const initial = readyState();
        initial.suppressionMarkers.push({
            id: "marker-a",
            partition: { kind: "vault", key: "vault-a" },
            sourceFingerprintId: "source-type-a",
            ruleFingerprint: "type-a-admission-v1",
            reason: "forgotten",
            createdAt: NOW.toISOString(),
            updatedAt: NOW.toISOString(),
        });
        const repository = new InMemoryMemoryGovernanceRepository(
            new InMemoryMemoryGovernanceBackend(initial),
        );
        const coordinator = createCoordinator(repository);

        await expect(coordinator.admit(typeAInput())).resolves.toEqual({
            ok: true,
            value: { decision: "reject" },
        });
        const state = await repository.initialize();
        expect(state.claims).toHaveLength(0);
        expect(state.memoryQueueItems).toHaveLength(0);
        expect(state.changeEvents).toHaveLength(0);
    });

    it("is idempotent across restart and a later timestamp for the same exact admission", async () => {
        const repository = repositoryForReadyState();
        const first = createCoordinator(repository);
        await first.admit(typeAInput());
        const second = new MemoryAdmissionCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            now: () => new Date("2026-07-11T09:00:00.000Z"),
            idFactory: () => "restart-id-that-must-not-be-used",
        });

        await expect(second.admit(await typeAInputForCurrentState(repository))).resolves.toMatchObject({
            ok: true,
            value: { decision: "silent_durable", claimId: expect.any(String) },
        });
        const state = await repository.initialize();
        expect(state.claims).toHaveLength(1);
        expect(state.revisions).toHaveLength(1);
        expect(state.changeEvents).toHaveLength(1);
        expect(state.pendingOperations).toHaveLength(1);
    });

    it("returns the same prior-review queue row when the producer retries later", async () => {
        const repository = repositoryForReadyState();
        await createCoordinator(repository).admit(memoryCandidateInput({ conflict: "present" }));
        const restarted = new MemoryAdmissionCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            now: () => new Date("2026-07-11T10:00:00.000Z"),
        });

        await expect(restarted.admit(memoryCandidateInput({ conflict: "present" }))).resolves.toMatchObject({
            ok: true,
            value: {
                decision: "require_prior_review",
                queueItem: expect.objectContaining({ status: "suggested" }),
            },
        });
        expect((await repository.initialize()).memoryQueueItems).toHaveLength(1);
    });

    it("replaces the same exact Type-A projection without resuming a paused claim", async () => {
        const repository = repositoryForReadyState();
        const coordinator = createCoordinator(repository);
        await coordinator.admit(typeAInput());
        await repository.transact((draft) => {
            draft.claims[0].lifecycle = "paused";
            for (const operation of draft.pendingOperations) {
                if (operation.kind === "profile_projection") operation.state = "applied";
            }
        });

        const next = typeAInput();
        next.expectedTargetState = readTypeATargetGeneration(
            await repository.initialize(),
            "profile-a",
            VAULT_A_PARTITION,
        );
        next.summary = "Prefers concise answers with a short evidence list.";
        next.sourceFingerprintId = "source-type-a-updated";
        next.admissionKey = "type-a-profile-a-updated";
        next.provenance = [{
            kind: "conversation",
            conversationIds: ["conversation-a", "conversation-b"],
            observedAt: NOW.toISOString(),
        }];
        await expect(coordinator.admit(next)).resolves.toMatchObject({
            ok: true,
            value: { decision: "silent_durable" },
        });

        const state = await repository.initialize();
        expect(state.claims).toHaveLength(1);
        expect(state.claims[0].lifecycle).toBe("paused");
        expect(state.revisions).toHaveLength(2);
        expect(state.changeEvents.map((event) => event.kind)).toEqual(["add", "replace"]);
        expect(state.undoSnapshots).toHaveLength(1);
        expect(state.pendingOperations.filter((operation) => (
            operation.kind === "profile_projection" && operation.state === "pending"
        ))).toHaveLength(1);
    });

    it("preserves an existing user-authoritative revision from inferred replacement", async () => {
        const repository = repositoryForReadyState();
        const coordinator = createCoordinator(repository);
        await coordinator.admit(typeAInput());

        const inferred = typeAInput();
        inferred.expectedTargetState = readTypeATargetGeneration(
            await repository.initialize(),
            "profile-a",
            VAULT_A_PARTITION,
        );
        inferred.authority = "pa_inference";
        inferred.policy = {
            ...inferred.policy,
            authority: "pa_inference",
        };
        inferred.summary = "Inferred replacement";
        await expect(coordinator.admit(inferred)).resolves.toEqual({
            ok: false,
            reason: "user_authority_preserved",
        });
        const state = await repository.initialize();
        expect(state.revisions).toHaveLength(1);
        expect(state.revisions[0].summary).toBe("Prefers concise answers.");
    });

    it("rejects a stale Type-A target generation after a newer user correction", async () => {
        const repository = repositoryForReadyState();
        const admission = createCoordinator(repository);
        await admission.admit(typeAInput());
        await repository.transact((draft) => {
            for (const operation of draft.pendingOperations) {
                if (operation.kind === "profile_projection") operation.state = "applied";
            }
        });
        const staleTarget = readTypeATargetGeneration(
            await repository.initialize(),
            "profile-a",
            VAULT_A_PARTITION,
        );
        const lifecycle = new MemoryGovernanceCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            idFactory: (() => {
                let id = 0;
                return () => `correction-id-${++id}`;
            })(),
        });
        const claimId = (await repository.initialize()).claims[0].id;
        await expect(lifecycle.correct({
            claimId,
            summary: "Always keep the final answer concise.",
            scopeAllowed: true,
            dataBoundaryAllowed: true,
        })).resolves.toMatchObject({ ok: true });
        const afterCorrection = await repository.initialize();
        const stale = typeAInput();
        stale.summary = "Old extraction result";
        stale.sourceFingerprintId = "source-stale";
        stale.expectedTargetState = staleTarget;

        await expect(admission.admit(stale)).resolves.toEqual({
            ok: false,
            reason: "stale_type_a_batch",
        });
        const afterStale = await repository.initialize();
        expect(afterStale.revisions).toEqual(afterCorrection.revisions);
        expect(afterStale.changeEvents).toEqual(afterCorrection.changeEvents);
        expect(afterStale.pendingOperations).toEqual(afterCorrection.pendingOperations);

        await repository.transact((draft) => {
            for (const operation of draft.pendingOperations) {
                if (operation.kind === "profile_projection") operation.state = "applied";
            }
        });

        const laterExplicit = typeAInput();
        laterExplicit.summary = "Use concise answers with a one-line conclusion.";
        laterExplicit.sourceFingerprintId = "source-later-explicit";
        laterExplicit.expectedTargetState = readTypeATargetGeneration(
            await repository.initialize(),
            "profile-a",
            VAULT_A_PARTITION,
        );
        await expect(admission.admit(laterExplicit)).resolves.toMatchObject({
            ok: true,
            value: { decision: "silent_durable", claimId },
        });
        expect((await repository.initialize()).revisions.at(-1)?.summary)
            .toBe("Use concise answers with a one-line conclusion.");
    });

    it("does not relearn a forgotten migrated Type-A target from unchanged legacy evidence", async () => {
        const repository = repositoryForReadyState();
        await repository.transact((draft) => {
            draft.claims.push({
                id: "migrated-type-a-claim",
                partition: VAULT_A_PARTITION,
                memoryType: "preference",
                sensitivity: "low",
                applicability: { kind: "whole_vault" },
                activeRevisionId: "migrated-type-a-revision",
                effect: "future_answers",
                lifecycle: "active",
                createdAt: NOW.toISOString(),
                updatedAt: NOW.toISOString(),
            });
            draft.revisions.push({
                id: "migrated-type-a-revision",
                claimId: "migrated-type-a-claim",
                summary: "Prefers concise answers.",
                provenance: [{
                    kind: "conversation",
                    conversationIds: ["conversation-a"],
                    observedAt: NOW.toISOString(),
                }],
                authority: "explicit_user",
                createdAt: NOW.toISOString(),
            });
            for (const [id, target, relation] of [
                ["migrated-profile-link", { kind: "type_a_profile", profileRecordId: "profile-a" }, "origin"],
                ["migrated-prompt-link", { kind: "prompt_projection", projectionId: "prompt:migrated-type-a-claim" }, "derived_copy"],
            ] as const) {
                draft.projectionLinks.push({
                    id,
                    claimId: "migrated-type-a-claim",
                    target,
                    relation,
                    state: "active",
                    sourceFingerprintId: "migrated-type-a-claim",
                    ruleFingerprint: LEGACY_TYPE_A_ADOPTION_RULE_FINGERPRINT,
                    createdAt: NOW.toISOString(),
                });
            }
        });
        const lifecycle = new MemoryGovernanceCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            projectionCleanupPort: { cleanupExactProjection: async () => undefined },
            now: () => NOW,
            idFactory: (() => {
                let id = 0;
                return () => `legacy-forget-${++id}`;
            })(),
        });
        await expect(lifecycle.forget({ claimId: "migrated-type-a-claim" }))
            .resolves.toMatchObject({ ok: true });
        const forgotten = await repository.initialize();
        expect(forgotten.suppressionMarkers).toEqual(expect.arrayContaining([
            expect.objectContaining({
                reason: "forgotten",
                sourceFingerprintId: createTypeATargetSuppressionFingerprint("vault-a", "profile-a"),
                ruleFingerprint: TYPE_A_TARGET_SUPPRESSION_RULE_FINGERPRINT,
            }),
        ]));

        const replay = typeAInput();
        replay.sourceFingerprintId = "new-governed-evidence-fingerprint";
        replay.ruleFingerprint = "type-a-effect-admission-v1";
        replay.expectedTargetState = readTypeATargetGeneration(
            forgotten,
            "profile-a",
            VAULT_A_PARTITION,
        );
        await expect(createCoordinator(repository).admit(replay)).resolves.toEqual({
            ok: true,
            value: { decision: "reject" },
        });
        const afterReplay = await repository.initialize();
        expect(afterReplay.claims).toHaveLength(1);
        expect(afterReplay.revisions).toEqual([]);
        expect(afterReplay.changeEvents.filter((event) => event.kind === "add")).toEqual([]);
    });

    it("does not reject a Type-A baseline when only unrelated state changed", async () => {
        const repository = repositoryForReadyState();
        const baseline = typeAInput();
        await repository.transact((draft) => {
            draft.policyStates["vault-a"].typeAProcessedTurns = { unrelated: 7 };
        });

        await expect(createCoordinator(repository).admit(baseline)).resolves.toMatchObject({
            ok: true,
            value: { decision: "silent_durable" },
        });
    });

    it.each([
        ["vault-a", "vault-b"],
        ["vault-b", "vault-a"],
    ])("isolates the same vault-local Profile ID when links were inserted as %s then %s", async (
        firstVault,
        secondVault,
    ) => {
        const initial = readyState();
        initial.policyStates["vault-b"] = {
            version: 1,
            mode: "effect_based",
            contextProjectionMode: "governed",
        };
        const backend = new InMemoryMemoryGovernanceBackend(initial);
        const repositoryA = new InMemoryMemoryGovernanceRepository(backend);
        const repositoryB = new InMemoryMemoryGovernanceRepository(backend);
        const coordinatorByVault: Record<string, MemoryAdmissionCoordinator> = {
            "vault-a": new MemoryAdmissionCoordinator({
                repository: repositoryA,
                opaqueVaultKey: "vault-a",
                now: () => NOW,
                idFactory: (() => {
                    let id = 0;
                    return () => `vault-a-id-${++id}`;
                })(),
            }),
            "vault-b": new MemoryAdmissionCoordinator({
                repository: repositoryB,
                opaqueVaultKey: "vault-b",
                now: () => NOW,
                idFactory: (() => {
                    let id = 0;
                    return () => `vault-b-id-${++id}`;
                })(),
            }),
        };
        for (const vaultKey of [firstVault, secondVault]) {
            const input = typeAInput();
            input.summary = `Initial ${vaultKey}`;
            input.sourceFingerprintId = `source-${vaultKey}`;
            await expect(coordinatorByVault[vaultKey].admit(input)).resolves.toMatchObject({
                ok: true,
                value: { decision: "silent_durable" },
            });
        }
        await repositoryA.transact((draft) => {
            for (const operation of draft.pendingOperations) {
                if (operation.kind === "profile_projection") operation.state = "applied";
            }
        });

        const beforeUpdate = await repositoryA.initialize();
        const updateA = typeAInput();
        updateA.summary = "Updated only in vault-a";
        updateA.sourceFingerprintId = "source-vault-a-updated";
        updateA.expectedTargetState = readTypeATargetGeneration(
            beforeUpdate,
            "profile-a",
            VAULT_A_PARTITION,
        );
        await expect(coordinatorByVault["vault-a"].admit(updateA)).resolves.toMatchObject({
            ok: true,
            value: { decision: "silent_durable" },
        });

        const state = await repositoryA.initialize();
        const summariesByVault = Object.fromEntries(state.claims.map((claim) => {
            const revision = state.revisions.find((candidate) => candidate.id === claim.activeRevisionId);
            return [claim.partition.key, revision?.summary];
        }));
        expect(summariesByVault).toEqual({
            "vault-a": "Updated only in vault-a",
            "vault-b": "Initial vault-b",
        });
    });

    it("blocks a newer Profile revision while an older cross-connection projection write is in flight", async () => {
        const backend = new InMemoryMemoryGovernanceBackend(readyState());
        const repositoryA = new InMemoryMemoryGovernanceRepository(backend);
        const repositoryB = new InMemoryMemoryGovernanceRepository(backend);
        let idA = 0;
        let idB = 0;
        const admissionA = new MemoryAdmissionCoordinator({
            repository: repositoryA,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            idFactory: () => `connection-a-${++idA}`,
        });
        const admissionB = new MemoryAdmissionCoordinator({
            repository: repositoryB,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            idFactory: () => `connection-b-${++idB}`,
        });
        await expect(admissionA.admit(typeAInput())).resolves.toMatchObject({ ok: true });

        const started = createDeferred();
        const release = createDeferred();
        const profile = new Map<string, string>();
        const workerA = new MemoryProfileProjectionWorker({
            repository: repositoryA,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            applyProjection: async (input) => {
                started.resolve();
                await release.promise;
                profile.set(input.profileRecordId, input.summary);
            },
        });
        const oldProjection = workerA.resumePending();
        await started.promise;

        const replacement = typeAInput();
        replacement.summary = "Newest preference";
        replacement.sourceFingerprintId = "source-newest";
        replacement.expectedTargetState = readTypeATargetGeneration(
            await repositoryB.initialize(),
            "profile-a",
            VAULT_A_PARTITION,
        );
        await expect(admissionB.admit(replacement)).resolves.toEqual({
            ok: false,
            reason: "claim_operation_pending",
        });

        release.resolve();
        await expect(oldProjection).resolves.toMatchObject({ pending: [] });
        expect(profile.get("profile-a")).toBe("Prefers concise answers.");

        await expect(admissionB.admit(replacement)).resolves.toMatchObject({
            ok: true,
            value: { decision: "silent_durable" },
        });
        const workerB = new MemoryProfileProjectionWorker({
            repository: repositoryB,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            applyProjection: async (input) => {
                profile.set(input.profileRecordId, input.summary);
            },
        });
        await expect(workerB.resumePending()).resolves.toMatchObject({ pending: [] });
        expect(profile.get("profile-a")).toBe("Newest preference");
    });

    it("derives runtime guarantees internally instead of trusting producer capability claims", async () => {
        const repository = repositoryForReadyState();
        const coordinator = createCoordinator(repository);
        const input = typeAInput();
        (input.policy as unknown as Record<string, unknown>).recoverySupport = "unavailable";

        await expect(coordinator.admit(input)).resolves.toMatchObject({
            ok: true,
            value: { decision: "silent_durable" },
        });
        const state = await repository.initialize();
        expect(state.claims).toHaveLength(1);
    });

    it("undoes an automatic addition to a text-free tombstone with exact cleanup and suppression", async () => {
        const repository = repositoryForReadyState();
        const admission = createCoordinator(repository);
        const admitted = await admission.admit(typeAInput());
        if (!admitted.ok || !admitted.value.claimId) throw new Error("admission failed");
        await markProfileProjectionApplied(repository);
        const stateBefore = await repository.initialize();
        const addEvent = stateBefore.changeEvents[0];
        const lifecycle = new MemoryGovernanceCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            idFactory: (() => {
                let id = 0;
                return () => `undo-id-${++id}`;
            })(),
        });

        const firstUndo = await lifecycle.undoRecentChange({ eventId: addEvent.id });
        expect(firstUndo).toMatchObject({ ok: true, value: { claimId: admitted.value.claimId } });
        const restartedLifecycle = new MemoryGovernanceCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            now: () => new Date(NOW.getTime() + 60_000),
            idFactory: () => "response-loss-retry-id",
        });
        await expect(restartedLifecycle.undoRecentChange({ eventId: addEvent.id })).resolves.toEqual(firstUndo);
        const state = await repository.initialize();
        expect(state.claims[0]).toMatchObject({
            id: admitted.value.claimId,
            lifecycle: "undone_add_tombstone",
            effect: "none",
        });
        expect(state.claims[0].activeRevisionId).toBeUndefined();
        expect(state.revisions).toHaveLength(0);
        expect(state.projectionLinks.every((link) => link.state === "redacted")).toBe(true);
        expect(state.undoSnapshots).toHaveLength(0);
        expect(state.changeEvents.map((event) => event.kind)).toEqual(["add", "undo"]);
        expect(state.changeEvents.filter((event) => event.kind === "undo")).toHaveLength(1);
        expect(state.suppressionMarkers).toEqual([
            expect.objectContaining({
                sourceFingerprintId: "source-type-a",
                ruleFingerprint: "type-a-admission-v1",
                reason: "rejected",
            }),
        ]);
        expect(JSON.stringify(state.suppressionMarkers)).not.toContain("Prefers concise answers");
        expect(state.pendingOperations).toEqual([
            expect.objectContaining({
                kind: "profile_projection",
                action: "remove",
                claimId: admitted.value.claimId,
                profileRecordId: "profile-a",
                projectionLinkId: expect.any(String),
                state: "pending",
            }),
        ]);
        await expect(admission.admit(await typeAInputForCurrentState(repository))).resolves.toEqual({
            ok: true,
            value: { decision: "reject" },
        });

        const removeProjection = jest.fn(async () => undefined);
        const removalWorker = new MemoryProfileProjectionWorker({
            repository,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            applyProjection: async () => undefined,
            removeProjection,
        });
        await expect(removalWorker.resumePending()).resolves.toEqual({
            completed: [admitted.value.claimId],
            pending: [],
        });
        expect(removeProjection).toHaveBeenCalledWith(expect.objectContaining({
            claimId: admitted.value.claimId,
            profileRecordId: "profile-a",
        }));
        const changed = typeAInput();
        changed.expectedTargetState = readTypeATargetGeneration(
            await repository.initialize(),
            "profile-a",
            VAULT_A_PARTITION,
        );
        changed.summary = "Prefers concise answers with evidence.";
        changed.sourceFingerprintId = "source-type-a-new-turn";
        changed.provenance = [{
            kind: "conversation",
            conversationIds: ["conversation-a", "conversation-b"],
            observedAt: NOW.toISOString(),
        }];
        await expect(admission.admit(changed)).resolves.toMatchObject({
            ok: true,
            value: { decision: "silent_durable", claimId: admitted.value.claimId },
        });
        const readmitted = await repository.initialize();
        expect(readmitted.claims[0]).toMatchObject({
            id: admitted.value.claimId,
            lifecycle: "active",
            effect: "future_answers",
        });
        expect(readmitted.revisions).toEqual([
            expect.objectContaining({ summary: "Prefers concise answers with evidence." }),
        ]);
        expect(readmitted.changeEvents.map((event) => event.kind)).toEqual(["add", "undo", "add"]);
        expect(readmitted.undoSnapshots).toEqual([
            expect.objectContaining({ restoreMode: "remove_added_claim" }),
        ]);
    });

    it("journals Type-A Add Undo as a text-free removal and rollback does not revive the claim", async () => {
        const repository = repositoryForCompatibilityState();
        const admission = createCoordinator(repository);
        const admitted = await admission.admit(typeAInput());
        if (!admitted.ok || !admitted.value.claimId) throw new Error("admission failed");
        await markProfileProjectionApplied(repository);
        const addEvent = (await repository.initialize()).changeEvents[0];
        const lifecycle = createLifecycleCoordinator(repository, NOW);

        await expect(lifecycle.undoRecentChange({ eventId: addEvent.id })).resolves.toMatchObject({ ok: true });
        const state = await repository.initialize();
        expect(state.migrationDeltas.map((delta) => delta.sequence)).toEqual([1, 2]);
        expect(state.migrationDeltas.map((delta) => delta.kind)).toEqual([
            "claim_added",
            "claim_removed",
        ]);
        const removals = state.migrationDeltas.filter((delta) => delta.kind === "claim_removed");
        expect(removals).toEqual([
            expect.objectContaining({
                entityId: admitted.value.claimId,
            }),
        ]);
        expect(removals.every((delta) => (
            delta.payloadEntryId === undefined && delta.payloadChecksum === undefined
        ))).toBe(true);
        expect(JSON.stringify(removals)).not.toContain("Prefers concise answers");

        const rollback = buildLegacyMemoryRollbackProjection(state, "vault-a", NOW);
        expect(rollback).toMatchObject({
            ok: true,
            projection: { records: [], memoryQueueItems: [] },
            lastDeltaSequence: 2,
        });
    });

    it("journals Memory Candidate Add Undo with queue/claim removals and rollback revives neither", async () => {
        const repository = repositoryForCompatibilityState();
        const admission = createCoordinator(repository);
        const admitted = await admission.admit(memoryCandidateInput());
        if (!admitted.ok || !admitted.value.claimId || !admitted.value.queueItem) {
            throw new Error("admission failed");
        }
        const addEvent = (await repository.initialize()).changeEvents[0];
        const lifecycle = createLifecycleCoordinator(repository, NOW);

        await expect(lifecycle.undoRecentChange({ eventId: addEvent.id })).resolves.toMatchObject({ ok: true });
        const state = await repository.initialize();
        expect(state.migrationDeltas.map((delta) => delta.sequence)).toEqual([1, 2, 3, 4]);
        expect(state.migrationDeltas.map((delta) => delta.kind)).toEqual([
            "queue_changed",
            "claim_added",
            "queue_removed",
            "claim_removed",
        ]);
        const removals = state.migrationDeltas.filter((delta) => (
            delta.kind === "claim_removed" || delta.kind === "queue_removed"
        ));
        expect(removals).toEqual([
            expect.objectContaining({
                kind: "queue_removed",
                entityId: admitted.value.queueItem.id,
            }),
            expect.objectContaining({
                kind: "claim_removed",
                entityId: admitted.value.claimId,
            }),
        ]);
        expect(removals.every((delta) => (
            delta.payloadEntryId === undefined && delta.payloadChecksum === undefined
        ))).toBe(true);
        expect(JSON.stringify(removals)).not.toContain("Prefers concise release notes");

        const rollback = buildLegacyMemoryRollbackProjection(state, "vault-a", NOW);
        expect(rollback).toMatchObject({
            ok: true,
            projection: { records: [], memoryQueueItems: [] },
            lastDeltaSequence: 4,
        });
    });

    it("keeps automatic Add Undo available through the inclusive seven-day boundary only", async () => {
        const inclusiveRepository = repositoryForCompatibilityState();
        await createCoordinator(inclusiveRepository).admit(typeAInput());
        await markProfileProjectionApplied(inclusiveRepository);
        const inclusiveEvent = (await inclusiveRepository.initialize()).changeEvents[0];
        await expect(createLifecycleCoordinator(
            inclusiveRepository,
            new Date(NOW.getTime() + SEVEN_DAYS_MS),
        ).undoRecentChange({ eventId: inclusiveEvent.id })).resolves.toMatchObject({ ok: true });

        const expiredRepository = repositoryForCompatibilityState();
        await createCoordinator(expiredRepository).admit(typeAInput());
        await markProfileProjectionApplied(expiredRepository);
        const expiredEvent = (await expiredRepository.initialize()).changeEvents[0];
        await expect(createLifecycleCoordinator(
            expiredRepository,
            new Date(NOW.getTime() + SEVEN_DAYS_MS + 1),
        ).undoRecentChange({ eventId: expiredEvent.id })).resolves.toEqual({
            ok: false,
            reason: "undo_expired",
        });
        const expiredState = await expiredRepository.initialize();
        expect(expiredState.claims[0].lifecycle).toBe("active");
        expect(expiredState.changeEvents.map((event) => event.kind)).toEqual(["add"]);
    });

    it("commits one Add Undo after the transaction callback is replayed by a CAS conflict", async () => {
        const repository = repositoryForCompatibilityState();
        const admitted = await createCoordinator(repository).admit(typeAInput());
        if (!admitted.ok || !admitted.value.claimId) throw new Error("admission failed");
        await markProfileProjectionApplied(repository);
        const addEvent = (await repository.initialize()).changeEvents[0];
        const replayingRepository = replayFirstTransactionAfterUnrelatedCommit(repository);
        const lifecycle = createLifecycleCoordinator(replayingRepository, NOW);

        await expect(lifecycle.undoRecentChange({ eventId: addEvent.id })).resolves.toMatchObject({ ok: true });
        const state = await repository.initialize();
        expect(state.policyStates["vault-a"].typeAProcessedTurns).toEqual({ unrelated: 7 });
        expect(state.changeEvents.map((event) => event.kind)).toEqual(["add", "undo"]);
        expect(state.suppressionMarkers).toHaveLength(1);
        expect(state.pendingOperations.filter((operation) => (
            operation.kind === "profile_projection" && operation.action === "remove"
        ))).toHaveLength(1);
        expect(state.migrationDeltas.map((delta) => delta.kind)).toEqual([
            "claim_added",
            "claim_removed",
        ]);
        expect(buildLegacyMemoryRollbackProjection(state, "vault-a", NOW)).toMatchObject({
            ok: true,
            projection: { records: [], memoryQueueItems: [] },
        });
    });

    it("removes only the exact automatic Memory Candidate queue row on Add Undo", async () => {
        const repository = repositoryForReadyState();
        const admission = createCoordinator(repository);
        const admitted = await admission.admit(memoryCandidateInput());
        expect(admitted).toMatchObject({ ok: true, value: { decision: "silent_durable" } });
        await repository.transact((draft) => {
            draft.memoryQueueItems.push({
                ...draft.memoryQueueItems[0],
                id: "unrelated-queue",
                claim: "Unrelated candidate",
                governanceAdmission: {
                    ...draft.memoryQueueItems[0].governanceAdmission!,
                    admissionKey: "unrelated",
                },
            });
        });
        const addEvent = (await repository.initialize()).changeEvents[0];
        const lifecycle = new MemoryGovernanceCoordinator({
            repository,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            idFactory: (() => {
                let id = 0;
                return () => `queue-undo-id-${++id}`;
            })(),
        });

        await expect(lifecycle.undoRecentChange({ eventId: addEvent.id })).resolves.toMatchObject({ ok: true });
        const state = await repository.initialize();
        expect(state.memoryQueueItems.map((item) => item.id)).toEqual(["unrelated-queue"]);
        expect(state.projectionLinks.filter((link) => link.target.kind === "review_queue"))
            .toEqual([expect.objectContaining({ state: "redacted" })]);
    });
});

function createCoordinator(repository: InMemoryMemoryGovernanceRepository): MemoryAdmissionCoordinator {
    let id = 0;
    return new MemoryAdmissionCoordinator({
        repository,
        opaqueVaultKey: "vault-a",
        now: () => NOW,
        idFactory: () => `admission-id-${++id}`,
    });
}

function repositoryForReadyState(): InMemoryMemoryGovernanceRepository {
    return new InMemoryMemoryGovernanceRepository(
        new InMemoryMemoryGovernanceBackend(readyState()),
    );
}

function repositoryForCompatibilityState(): InMemoryMemoryGovernanceRepository {
    return new InMemoryMemoryGovernanceRepository(
        new InMemoryMemoryGovernanceBackend(compatibilityState()),
    );
}

function readyState() {
    const state = createEmptyDeviceMemoryGovernanceStateV1();
    state.policyStates["vault-a"] = {
        version: 1,
        mode: "effect_based",
        contextProjectionMode: "governed",
    };
    return state;
}

function compatibilityState() {
    const state = readyState();
    const rollbackExpiresAt = new Date(NOW.getTime() + SEVEN_DAYS_MS).toISOString();
    const policyValue = {
        kind: "policy" as const,
        confirmedMemoryCount: 0,
        memoryAutoAcceptPaused: false,
    };
    state.migrationStates["vault-a"] = {
        migrationRunId: "migration-vault-a",
        phase: "compatibility",
        sourceHash: "legacy-source-vault-a",
        cutoverSequence: 0,
        rollbackExpiresAt,
    };
    state.rollbackPayloadEntries.push({
        id: "rollback-policy-vault-a",
        migrationRunId: "migration-vault-a",
        partition: { kind: "vault", key: "vault-a" },
        entityId: "policy-vault-a",
        value: policyValue,
        checksum: checksumLegacyRollbackValue(policyValue),
        expiresAt: rollbackExpiresAt,
    });
    return state;
}

function createLifecycleCoordinator(
    repository: MemoryGovernanceRepository,
    now: Date,
): MemoryGovernanceCoordinator {
    let id = 0;
    return new MemoryGovernanceCoordinator({
        repository,
        opaqueVaultKey: "vault-a",
        now: () => now,
        idFactory: () => `lifecycle-id-${++id}`,
    });
}

function replayFirstTransactionAfterUnrelatedCommit(
    repository: InMemoryMemoryGovernanceRepository,
): MemoryGovernanceRepository {
    let replayed = false;
    return {
        initialize: () => repository.initialize(),
        async transact<T>(operation: MemoryGovernanceTransaction<T>): Promise<T> {
            if (!replayed) {
                replayed = true;
                const discardedDraft = await repository.initialize();
                await operation(discardedDraft);
                await repository.transact((draft) => {
                    draft.policyStates["vault-a"].typeAProcessedTurns = { unrelated: 7 };
                });
            }
            return repository.transact(operation);
        },
        subscribe: (listener) => repository.subscribe(listener),
        dispose: () => Promise.resolve(),
    };
}

async function markProfileProjectionApplied(
    repository: InMemoryMemoryGovernanceRepository,
): Promise<void> {
    await repository.transact((draft) => {
        for (const operation of draft.pendingOperations) {
            if (operation.kind === "profile_projection" && operation.state === "pending") {
                operation.state = "applied";
            }
        }
    });
}

async function typeAInputForCurrentState(
    repository: InMemoryMemoryGovernanceRepository,
): Promise<GovernedMemoryAdmissionInput> {
    const input = typeAInput();
    input.expectedTargetState = readTypeATargetGeneration(
        await repository.initialize(),
        "profile-a",
        VAULT_A_PARTITION,
    );
    return input;
}

function typeAInput(): GovernedMemoryAdmissionInput {
    return {
        policy: silentPolicy("type_a"),
        summary: "Prefers concise answers.",
        memoryType: "preference",
        sensitivity: "low",
        authority: "explicit_user",
        effect: "future_answers",
        applicability: { kind: "whole_vault" },
        provenance: [{
            kind: "conversation",
            conversationIds: ["conversation-a"],
            observedAt: NOW.toISOString(),
        }],
        sourceFingerprintId: "source-type-a",
        ruleFingerprint: "type-a-admission-v1",
        admissionKey: "type-a-profile-a",
        profileRecordId: "profile-a",
        expectedTargetState: { state: "absent", profileRecordId: "profile-a" },
        queueInput: {
            type: "memory_candidate",
            title: "Review learned preference",
            claim: "Prefers concise answers.",
            scope: { kind: "whole_vault" },
            sourceRefs: [],
            originSurface: "memory",
            admissionReason: "memory_confirmation_required",
            dataBoundarySnapshotId: "boundary-a",
        },
    };
}

function memoryCandidateInput(
    policyOverrides: Partial<GovernedMemoryAdmissionInput["policy"]> = {},
): GovernedMemoryAdmissionInput {
    return {
        policy: silentPolicy("memory_candidate", policyOverrides),
        summary: "Prefers concise release notes.",
        memoryType: "preference",
        sensitivity: "low",
        authority: "pa_inference",
        effect: "future_answers",
        applicability: { kind: "current_note", paths: ["notes/source.md"] },
        provenance: [{ kind: "note", sourceRef: { path: "notes/source.md", sourceId: "source-a" } }],
        sourceFingerprintId: "source-note-a",
        ruleFingerprint: "memory-candidate-admission-v1",
        admissionKey: "memory-candidate-source-a",
        queueInput: {
            type: "memory_candidate",
            title: "Remember release-note preference",
            claim: "Prefers concise release notes.",
            scope: { kind: "current_note", paths: ["notes/source.md"] },
            sourceRefs: [{ path: "notes/source.md", sourceId: "source-a" }],
            originSurface: "pagelet",
            admissionReason: "memory_confirmation_required",
            dataBoundarySnapshotId: "boundary-a",
            metadata: { memoryType: "preference", sensitivity: "low" },
        },
    };
}

function silentPolicy(
    origin: "type_a" | "memory_candidate",
    overrides: Partial<GovernedMemoryAdmissionInput["policy"]> = {},
): GovernedMemoryAdmissionInput["policy"] {
    return {
        origin,
        memoryType: "preference",
        authority: origin === "type_a" ? "explicit_user" : "pa_inference",
        persistenceIntent: "durable",
        effect: "future_answers",
        provenanceValidity: "valid",
        sourceBacking: "source_backed",
        sensitivity: "low",
        scope: "current_vault",
        conflict: "absent",
        durableTaskConstraint: "absent",
        dataBoundary: "allowed",
        writeAuthority: "none",
        networkAuthority: "none",
        externalActionAuthority: "none",
        policyCompliance: "allowed",
        ephemeralContextEligibility: "eligible",
        ...overrides,
    };
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((next) => {
        resolve = () => next();
    });
    return { promise, resolve };
}
