import {
    MemoryGovernanceCoordinator,
    type ExactMemoryProjectionCleanupPort,
} from "../src/pa/memory-governance-coordinator";
import { checksumLegacyRollbackValue } from "../src/pa/memory-governance-migration-coordinator";
import {
    InMemoryMemoryGovernanceBackend,
    InMemoryMemoryGovernanceRepository,
    createEmptyDeviceMemoryGovernanceStateV1,
    type DeviceMemoryGovernanceStateV1,
    type DeviceMemoryQueueItem,
    type GovernedMemoryClaim,
    type LegacyRollbackValue,
    type MemoryClaimRevision,
    type MemoryGovernanceRepository,
    type MemoryMigrationDelta,
    type MemoryPartitionKey,
    type MemoryProjectionLink,
    type MemoryRollbackPayloadEntry,
} from "../src/pa/memory-governance-persistence";
import { selectGovernedMemoryUse } from "../src/pa/memory-use-projection";
import type { ConfirmedMemoryRecord } from "../src/pa/memory-governance-store";
import type { ReviewQueueItem } from "../src/pa/review-queue-store";

const NOW = new Date("2026-07-11T08:00:00.000Z");
const ROLLBACK_EXPIRES = "2026-07-18T08:00:00.000Z";
const VAULT_A = { kind: "vault" as const, key: "vault-a" };
const VAULT_B = { kind: "vault" as const, key: "vault-b" };

function revision(
    claimId: string,
    summary = `Summary ${claimId}`,
    authority: MemoryClaimRevision["authority"] = "explicit_user",
    sourcePath = `notes/${claimId}.md`,
): MemoryClaimRevision {
    return {
        id: `revision-${claimId}`,
        claimId,
        summary,
        provenance: [{ kind: "note", sourceRef: { path: sourcePath } }],
        authority,
        createdAt: "2026-07-01T08:00:00.000Z",
    };
}

function claim(
    id: string,
    partition: MemoryPartitionKey = VAULT_A,
    options: Partial<GovernedMemoryClaim> = {},
): GovernedMemoryClaim {
    return {
        id,
        partition,
        memoryType: "preference",
        sensitivity: "low",
        applicability: { kind: "whole_vault" },
        activeRevisionId: `revision-${id}`,
        effect: "future_answers",
        lifecycle: "active",
        createdAt: "2026-07-01T08:00:00.000Z",
        updatedAt: "2026-07-01T08:00:00.000Z",
        ...options,
    };
}

function queueItem(
    id: string,
    partition: MemoryPartitionKey = VAULT_A,
    content = `Queue claim ${id}`,
): DeviceMemoryQueueItem {
    return {
        id,
        type: "memory_candidate",
        partition,
        title: `Queue ${id}`,
        claim: content,
        scope: { kind: "current_note", paths: [`notes/${id}.md`] },
        sourceRefs: [{ path: `notes/${id}.md` }],
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

function legacyQueueItem(item: DeviceMemoryQueueItem): ReviewQueueItem {
    return {
        id: item.id,
        type: item.type,
        title: item.title,
        claim: item.claim,
        scope: item.scope,
        sourceRefs: item.sourceRefs,
        originSurface: item.originSurface,
        priority: item.priority,
        status: item.status,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        whyShown: item.whyShown,
        dataBoundarySnapshotId: item.dataBoundarySnapshotId,
        ...(item.admissionReason ? { admissionReason: item.admissionReason } : {}),
        ...(item.replayRef ? { replayRef: item.replayRef } : {}),
        ...(item.metadata ? { metadata: item.metadata } : {}),
        ...(item.snoozedUntil ? { snoozedUntil: item.snoozedUntil } : {}),
    };
}

function legacyClaimRecord(
    currentClaim: GovernedMemoryClaim,
    currentRevision: MemoryClaimRevision,
): ConfirmedMemoryRecord {
    return {
        id: `legacy-${currentClaim.id}`,
        type: currentClaim.memoryType,
        lifecycle: currentClaim.lifecycle === "stale" ? "stale" : "active",
        sensitivity: currentClaim.sensitivity,
        scope: currentClaim.applicability,
        summary: currentRevision.summary,
        sourceRefs: currentRevision.provenance.flatMap((entry) => (
            entry.kind === "note" ? [entry.sourceRef] : []
        )),
        createdAt: currentClaim.createdAt,
        updatedAt: currentClaim.updatedAt,
        confirmedAt: currentRevision.createdAt,
    };
}

function rollbackEntry(
    id: string,
    entityId: string,
    value: LegacyRollbackValue,
    partition: MemoryPartitionKey = VAULT_A,
): MemoryRollbackPayloadEntry {
    return {
        id,
        migrationRunId: "run-a",
        partition,
        entityId,
        value,
        checksum: checksumLegacyRollbackValue(value),
        expiresAt: ROLLBACK_EXPIRES,
    };
}

function createState(options: {
    claims?: GovernedMemoryClaim[];
    revisions?: MemoryClaimRevision[];
    compatibility?: boolean;
} = {}): DeviceMemoryGovernanceStateV1 {
    const state = createEmptyDeviceMemoryGovernanceStateV1();
    state.claims = options.claims ?? [claim("claim-a")];
    state.revisions = options.revisions ?? state.claims.map((entry) => revision(entry.id));
    state.policyStates["vault-a"] = {
        version: 1,
        mode: "effect_based",
        contextProjectionMode: "governed",
    };
    state.policyStates["vault-b"] = {
        version: 1,
        mode: "effect_based",
        contextProjectionMode: "governed",
    };
    if (options.compatibility) {
        state.migrationStates["vault-a"] = {
            migrationRunId: "run-a",
            phase: "compatibility",
            sourceHash: "source-a",
            cutoverSequence: 1,
            rollbackExpiresAt: ROLLBACK_EXPIRES,
            lastAppliedDeltaSequence: 0,
        };
        for (const currentClaim of state.claims.filter(
            (candidate) => candidate.partition.kind === "vault" && candidate.partition.key === "vault-a",
        )) {
            const currentRevision = state.revisions.find(
                (candidate) => candidate.id === currentClaim.activeRevisionId,
            );
            if (!currentRevision) continue;
            state.rollbackPayloadEntries.push(rollbackEntry(
                `base-${currentClaim.id}`,
                currentClaim.id,
                { kind: "claim", record: legacyClaimRecord(currentClaim, currentRevision) },
            ));
        }
    }
    return state;
}

function repository(state: DeviceMemoryGovernanceStateV1): InMemoryMemoryGovernanceRepository {
    return new InMemoryMemoryGovernanceRepository(new InMemoryMemoryGovernanceBackend(state));
}

function ids(prefix = "id"): () => string {
    let index = 0;
    return () => `${prefix}-${++index}`;
}

function useProjection(
    state: DeviceMemoryGovernanceStateV1,
    vaultScopeKey = "vault-a",
    fingerprintOverrides: Record<string, { sourceFingerprintId: string; ruleFingerprint: string }> = {},
) {
    const marker = state.suppressionMarkers[0];
    const claimSuppressionFingerprints = Object.fromEntries(state.claims.map((currentClaim) => [
        currentClaim.id,
        fingerprintOverrides[currentClaim.id] ?? (currentClaim.id === "claim-a" && marker ? {
            sourceFingerprintId: marker.sourceFingerprintId,
            ruleFingerprint: marker.ruleFingerprint,
        } : {
            sourceFingerprintId: `source-${currentClaim.id}`,
            ruleFingerprint: `rule-${currentClaim.id}`,
        }),
    ]));
    return selectGovernedMemoryUse({
        vaultScopeKey,
        currentScope: { tags: [] },
        claims: state.claims,
        revisions: state.revisions,
        suppressionMarkers: state.suppressionMarkers,
        pendingOperations: state.pendingOperations,
        claimSuppressionFingerprints,
        includeVaultInsights: false,
        vaultInsights: null,
        currentDataBoundaryFingerprint: "boundary",
        dataBoundaryAllowed: () => true,
    });
}

describe("MemoryGovernanceCoordinator", () => {
    it("writes user-authoritative Correct lineage, undo recovery, and normalized compatibility delta atomically", async () => {
        const initial = createState({ compatibility: true });
        initial.suppressionMarkers.push({
            id: "marker-existing",
            partition: VAULT_A,
            sourceFingerprintId: "source-existing",
            ruleFingerprint: "rule-existing",
            reason: "rejected",
            createdAt: NOW.toISOString(),
            updatedAt: NOW.toISOString(),
        });
        const repo = repository(initial);
        const coordinator = new MemoryGovernanceCoordinator({
            repository: repo,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            idFactory: ids("correct"),
        });

        const corrected = await coordinator.correct({
            claimId: "claim-a",
            summary: "Use concise Chinese answers",
            scopeAllowed: true,
            dataBoundaryAllowed: true,
        });
        expect(corrected).toEqual({
            ok: true,
            value: {
                claimId: "claim-a",
                eventId: "correct-2",
                undoExpiresAt: ROLLBACK_EXPIRES,
            },
        });

        let state = await repo.initialize();
        const active = state.revisions.find((entry) => entry.id === state.claims[0].activeRevisionId)!;
        expect(active).toMatchObject({
            summary: "Use concise Chinese answers",
            authority: "user_correction",
            supersedesRevisionId: "revision-claim-a",
        });
        expect(useProjection(state).usedClaimIds).toEqual([]);
        for (const operation of state.pendingOperations) {
            if (operation.kind === "profile_projection") operation.state = "applied";
        }
        const correctedUse = useProjection(state, "vault-a", {
            "claim-a": {
                sourceFingerprintId: "memory-user-correction-current",
                ruleFingerprint: "user-correction-v1",
            },
        });
        expect(correctedUse.usedClaimIds).toContain("claim-a");
        expect(correctedUse.boundedContext).toContain("Use concise Chinese answers");
        expect(correctedUse.boundedContext).not.toContain("Summary claim-a");
        expect(state.changeEvents[0]).toMatchObject({
            id: "correct-2",
            kind: "correct",
            undoSnapshotId: "correct-3",
        });
        expect("claim" in state.undoSnapshots[0]
            ? state.undoSnapshots[0].claim.activeRevisionId
            : undefined).toBe("revision-claim-a");
        expect(state.undoSnapshots[0].revisions).toHaveLength(1);
        expect(state.migrationDeltas).toHaveLength(1);
        const delta = state.migrationDeltas[0];
        const payload = state.rollbackPayloadEntries.find((entry) => entry.id === delta.payloadEntryId)!;
        expect(delta).toMatchObject({
            sequence: 1,
            kind: "claim_changed",
            payloadEntryId: "correct-4",
            payloadChecksum: payload.checksum,
        });
        expect(payload.checksum).toBe(checksumLegacyRollbackValue(payload.value));
        expect(payload.value.kind).toBe("claim");
        if (payload.value.kind === "claim") {
            expect(payload.value.record.scope).toEqual({
                kind: "whole_vault",
                paths: undefined,
                tags: undefined,
            });
            expect(payload.value.record.sourceRefs[0]).toEqual({
                path: "notes/claim-a.md",
                whyShown: undefined,
            });
        }
        expect(state.migrationStates["vault-a"].lastAppliedDeltaSequence).toBe(0);

        const undone = await coordinator.undoRecentChange({ eventId: "correct-2" });
        expect(undone.ok).toBe(true);
        state = await repo.initialize();
        expect(state.claims[0].activeRevisionId).toBe("revision-claim-a");
        expect(state.revisions.filter((entry) => entry.claimId === "claim-a")).toEqual([
            expect.objectContaining({ id: "revision-claim-a", summary: "Summary claim-a" }),
        ]);
        expect(state.changeEvents.map((entry) => entry.kind)).toEqual(["correct", "undo"]);
        expect(state.changeEvents[0].undoSnapshotId).toBeUndefined();
        expect(state.undoSnapshots).toHaveLength(0);
        expect(state.suppressionMarkers).toEqual([expect.objectContaining({ id: "marker-existing" })]);
        expect(state.migrationDeltas.map((entry) => entry.sequence)).toEqual([1, 2]);
        expect(state.migrationStates["vault-a"].lastAppliedDeltaSequence).toBe(0);
    });

    it("suppresses the rejected exact lineage after Correct and removes only that marker on Undo", async () => {
        const initial = createState();
        initial.projectionLinks.push({
            id: "prompt-link-a",
            claimId: "claim-a",
            target: { kind: "prompt_projection", projectionId: "prompt:claim-a" },
            relation: "derived_copy",
            state: "active",
            sourceFingerprintId: "source-before-correction",
            ruleFingerprint: "rule-before-correction",
            createdAt: NOW.toISOString(),
        });
        const repo = repository(initial);
        const coordinator = new MemoryGovernanceCoordinator({
            repository: repo,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            idFactory: ids("correction-marker"),
        });

        const corrected = await coordinator.correct({
            claimId: "claim-a",
            summary: "Corrected preference",
            scopeAllowed: true,
            dataBoundaryAllowed: true,
        });
        expect(corrected.ok).toBe(true);
        let state = await repo.initialize();
        expect(state.suppressionMarkers).toEqual([
            expect.objectContaining({
                reason: "corrected",
                sourceFingerprintId: "source-before-correction",
                ruleFingerprint: "rule-before-correction",
            }),
        ]);
        expect(state.projectionLinks[0]).toMatchObject({
            sourceFingerprintId: expect.stringMatching(/^memory-user-correction-/),
            ruleFingerprint: "user-correction-v1",
        });

        if (!corrected.ok) throw new Error("correction unexpectedly failed");
        await expect(coordinator.undoRecentChange({ eventId: corrected.value.eventId }))
            .resolves.toMatchObject({ ok: true });
        state = await repo.initialize();
        expect(state.suppressionMarkers).toEqual([]);
        expect(state.projectionLinks[0]).toMatchObject({
            sourceFingerprintId: "source-before-correction",
            ruleFingerprint: "rule-before-correction",
        });
    });

    it("excludes Pause from the actual governed prompt path and restores it on Resume", async () => {
        const repo = repository(createState());
        const coordinator = new MemoryGovernanceCoordinator({
            repository: repo,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            idFactory: ids("pause"),
        });
        expect(useProjection(await repo.initialize()).usedClaimIds).toEqual(["claim-a"]);

        await expect(coordinator.pauseUse({ claimId: "claim-a" })).resolves.toMatchObject({ ok: true });
        let state = await repo.initialize();
        expect(state.claims[0].lifecycle).toBe("paused");
        expect(useProjection(state)).toEqual({ boundedContext: "", usedClaimIds: [] });

        await expect(coordinator.resumeUse({
            claimId: "claim-a",
            scopeAllowed: true,
            dataBoundaryAllowed: true,
        })).resolves.toMatchObject({ ok: true });
        state = await repo.initialize();
        expect(state.claims[0].lifecycle).toBe("active");
        expect(useProjection(state).usedClaimIds).toEqual(["claim-a"]);
        expect(state.changeEvents.map((entry) => entry.kind)).toEqual(["pause", "resume"]);
    });

    it("auto-removes an unchanged active revision reversibly without using Forget semantics", async () => {
        const repo = repository(createState());
        const coordinator = new MemoryGovernanceCoordinator({
            repository: repo,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            idFactory: ids("auto-remove"),
        });

        const removed = await coordinator.autoRemove({
            claimId: "claim-a",
            expectedActiveRevisionId: "revision-claim-a",
        });
        expect(removed).toEqual({
            ok: true,
            value: {
                claimId: "claim-a",
                eventId: "auto-remove-1",
                undoExpiresAt: ROLLBACK_EXPIRES,
            },
        });

        let state = await repo.initialize();
        expect(state.claims[0]).toMatchObject({
            lifecycle: "paused",
            activeRevisionId: "revision-claim-a",
        });
        expect(state.revisions).toEqual([
            expect.objectContaining({ id: "revision-claim-a", summary: "Summary claim-a" }),
        ]);
        expect(state.changeEvents).toEqual([
            expect.objectContaining({
                id: "auto-remove-1",
                kind: "auto_remove",
                undoSnapshotId: "auto-remove-2",
            }),
        ]);
        expect(state.undoSnapshots).toEqual([
            expect.objectContaining({
                id: "auto-remove-2",
                eventId: "auto-remove-1",
                claim: expect.objectContaining({
                    lifecycle: "active",
                    activeRevisionId: "revision-claim-a",
                }),
            }),
        ]);
        expect(state.suppressionMarkers).toEqual([]);
        expect(useProjection(state)).toEqual({ boundedContext: "", usedClaimIds: [] });

        await expect(coordinator.undoRecentChange({ eventId: "auto-remove-1" }))
            .resolves.toMatchObject({ ok: true });

        state = await repo.initialize();
        expect(state.claims[0]).toMatchObject({
            lifecycle: "active",
            activeRevisionId: "revision-claim-a",
        });
        expect(state.revisions).toEqual([
            expect.objectContaining({ id: "revision-claim-a", summary: "Summary claim-a" }),
        ]);
        expect(state.changeEvents.map((entry) => entry.kind)).toEqual(["auto_remove", "undo"]);
        expect(state.changeEvents[0].undoSnapshotId).toBeUndefined();
        expect(state.undoSnapshots).toEqual([]);
        expect(state.suppressionMarkers).toEqual([]);
        expect(useProjection(state).usedClaimIds).toEqual(["claim-a"]);
    });

    it("rejects auto-remove when the expected active revision became stale", async () => {
        const repo = repository(createState());
        const coordinator = new MemoryGovernanceCoordinator({
            repository: repo,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            idFactory: ids("stale-auto-remove"),
        });
        await expect(coordinator.correct({
            claimId: "claim-a",
            summary: "Newer user correction",
            scopeAllowed: true,
            dataBoundaryAllowed: true,
        })).resolves.toMatchObject({ ok: true });

        await expect(coordinator.autoRemove({
            claimId: "claim-a",
            expectedActiveRevisionId: "revision-claim-a",
        })).resolves.toEqual({
            ok: false,
            reason: "stale_automatic_change",
        });

        const state = await repo.initialize();
        const current = state.claims[0];
        expect(current).toMatchObject({
            lifecycle: "active",
            activeRevisionId: "stale-auto-remove-1",
        });
        expect(state.revisions.find((entry) => entry.id === current.activeRevisionId)).toMatchObject({
            summary: "Newer user correction",
            authority: "user_correction",
        });
        expect(state.changeEvents.map((entry) => entry.kind)).toEqual(["correct"]);
        expect(state.changeEvents.some((entry) => entry.kind === "auto_remove")).toBe(false);
        expect(useProjection(state).usedClaimIds).toEqual(["claim-a"]);
    });

    it("requires explicit device scope and keeps vault-local claims isolated", async () => {
        const claimA = claim("claim-a", VAULT_A);
        const claimB = claim("claim-b", VAULT_B);
        const collaborationRevision = revision("claim-a", "Answer in Chinese", "explicit_user");
        collaborationRevision.provenance = [{
            kind: "conversation",
            conversationIds: ["conversation-a"],
            observedAt: NOW.toISOString(),
        }];
        const repo = repository(createState({
            claims: [claimA, claimB],
            revisions: [
                collaborationRevision,
                revision("claim-b"),
            ],
        }));
        const coordinator = new MemoryGovernanceCoordinator({
            repository: repo,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            idFactory: ids("scope"),
        });

        await expect(coordinator.pauseUse({ claimId: "claim-b" })).resolves.toEqual({
            ok: false,
            reason: "claim_not_in_scope",
        });
        await expect(coordinator.changeScope({
            claimId: "claim-a",
            applicability: { kind: "whole_vault" },
            partition: { kind: "device_collaboration", key: "device" },
            scopeAllowed: true,
            dataBoundaryAllowed: true,
        })).resolves.toEqual({ ok: false, reason: "explicit_device_scope_required" });

        await expect(coordinator.changeScope({
            claimId: "claim-a",
            applicability: { kind: "whole_vault" },
            partition: { kind: "device_collaboration", key: "device" },
            explicitDeviceScope: true,
            scopeAllowed: true,
            dataBoundaryAllowed: true,
        })).resolves.toEqual({ ok: false, reason: "device_scope_not_ready" });
        await repo.transact((draft) => {
            draft.migrationStates["vault-a"] = {
                migrationRunId: "finalized-scope-run",
                phase: "finalized",
                sourceHash: "finalized-scope-source",
                cutoverSequence: 1,
            };
        });
        await expect(coordinator.changeScope({
            claimId: "claim-a",
            applicability: { kind: "whole_vault" },
            partition: { kind: "device_collaboration", key: "device" },
            explicitDeviceScope: true,
            scopeAllowed: true,
            dataBoundaryAllowed: true,
        })).resolves.toMatchObject({ ok: true });
        const state = await repo.initialize();
        expect(state.claims.find((entry) => entry.id === "claim-a")).toMatchObject({
            partition: { kind: "device_collaboration", key: "device" },
            effect: "collaboration_default",
            activeRevisionId: expect.any(String),
        });
        expect(state.revisions.find((entry) => entry.id === state.claims[0].activeRevisionId))
            .toMatchObject({ authority: "user_correction" });
        expect(state.claims.find((entry) => entry.id === "claim-b")).toEqual(claimB);
        expect(useProjection(state, "vault-b").usedClaimIds).toContain("claim-a");

        await expect(coordinator.changeScope({
            claimId: "claim-a",
            applicability: { kind: "whole_vault" },
            partition: VAULT_A,
            scopeAllowed: true,
            dataBoundaryAllowed: true,
        })).resolves.toMatchObject({ ok: true });
        const narrowed = await repo.initialize();
        expect(narrowed.claims.find((entry) => entry.id === "claim-a")).toMatchObject({
            partition: VAULT_A,
            effect: "future_answers",
        });
        expect(useProjection(narrowed, "vault-b").usedClaimIds).not.toContain("claim-a");
    });

    it("never widens note-derived understanding into the device collaboration partition", async () => {
        const repo = repository(createState({
            claims: [claim("claim-a")],
            revisions: [revision("claim-a", "Note-derived preference", "explicit_user")],
        }));
        const coordinator = new MemoryGovernanceCoordinator({
            repository: repo,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            idFactory: ids("scope-note"),
        });

        await expect(coordinator.changeScope({
            claimId: "claim-a",
            applicability: { kind: "whole_vault" },
            partition: { kind: "device_collaboration", key: "device" },
            explicitDeviceScope: true,
            scopeAllowed: true,
            dataBoundaryAllowed: true,
        })).resolves.toEqual({ ok: false, reason: "explicit_device_scope_required" });
        expect((await repo.initialize()).claims[0]).toMatchObject({
            partition: VAULT_A,
            effect: "future_answers",
        });
    });

    it("blocks device-wide scope while legacy compatibility copies still exist", async () => {
        const interactionRevision = revision("claim-a", "Explicit preference", "explicit_user");
        interactionRevision.provenance = [{
            kind: "conversation",
            conversationIds: ["conversation-a"],
            observedAt: NOW.toISOString(),
        }];
        const repo = repository(createState({
            revisions: [interactionRevision],
            compatibility: true,
        }));
        const coordinator = new MemoryGovernanceCoordinator({
            repository: repo,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            idFactory: ids("scope-compatibility"),
        });

        await expect(coordinator.changeScope({
            claimId: "claim-a",
            applicability: { kind: "whole_vault" },
            partition: { kind: "device_collaboration", key: "device" },
            explicitDeviceScope: true,
            scopeAllowed: true,
            dataBoundaryAllowed: true,
        })).resolves.toEqual({ ok: false, reason: "device_scope_not_ready" });
        expect((await repo.initialize()).claims[0].partition).toEqual(VAULT_A);
    });

    it("uses an owner-bound outbox when a Profile-backed preference moves across vaults", async () => {
        const interactionRevision = revision("claim-a", "Explicit preference", "explicit_user");
        interactionRevision.provenance = [{
            kind: "conversation",
            conversationIds: ["conversation-a"],
            observedAt: NOW.toISOString(),
        }];
        const initial = createState({ revisions: [interactionRevision] });
        initial.migrationStates["vault-a"] = {
            migrationRunId: "finalized-profile-scope-run",
            phase: "finalized",
            sourceHash: "finalized-profile-scope-source",
            cutoverSequence: 1,
        };
        initial.projectionLinks.push({
            id: "profile-link-a",
            claimId: "claim-a",
            target: { kind: "type_a_profile", profileRecordId: "profile-a" },
            relation: "origin",
            state: "active",
            sourceFingerprintId: "source-a",
            ruleFingerprint: "type-a-v1",
            createdAt: NOW.toISOString(),
        });
        const repo = repository(initial);
        const coordinator = new MemoryGovernanceCoordinator({
            repository: repo,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            idFactory: ids("scope-profile"),
        });

        const widened = await coordinator.changeScope({
            claimId: "claim-a",
            applicability: { kind: "whole_vault" },
            partition: { kind: "device_collaboration", key: "device" },
            explicitDeviceScope: true,
            scopeAllowed: true,
            dataBoundaryAllowed: true,
        });
        expect(widened).toMatchObject({ ok: true });
        let state = await repo.initialize();
        expect(state.pendingOperations).toEqual([
            expect.objectContaining({
                kind: "profile_projection",
                action: "remove",
                claimId: "claim-a",
                profileRecordId: "profile-a",
                projectionLinkId: "profile-link-a",
                ownerVaultKey: "vault-a",
                state: "pending",
            }),
        ]);
        await expect(coordinator.changeScope({
            claimId: "claim-a",
            applicability: { kind: "whole_vault" },
            partition: VAULT_A,
            scopeAllowed: true,
            dataBoundaryAllowed: true,
        })).resolves.toEqual({ ok: false, reason: "claim_operation_pending" });

        await repo.transact((draft) => {
            const operation = draft.pendingOperations[0];
            if (operation.kind === "profile_projection") operation.state = "applied";
            draft.projectionLinks[0].state = "redacted";
        });
        await expect(coordinator.changeScope({
            claimId: "claim-a",
            applicability: { kind: "whole_vault" },
            partition: VAULT_A,
            scopeAllowed: true,
            dataBoundaryAllowed: true,
        })).resolves.toMatchObject({ ok: true });

        state = await repo.initialize();
        expect(state.projectionLinks[0].state).toBe("active");
        expect(state.pendingOperations).toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: "profile_projection",
                claimId: "claim-a",
                profileRecordId: "profile-a",
                targetRevisionId: expect.any(String),
                state: "pending",
            }),
        ]));
    });

    it("does not treat missing provenance as explicit device-wide intent", async () => {
        const emptyRevision = revision("claim-a", "Explicit preference", "explicit_user");
        emptyRevision.provenance = [];
        const repo = repository(createState({ revisions: [emptyRevision] }));
        const coordinator = new MemoryGovernanceCoordinator({
            repository: repo,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            idFactory: ids("scope-empty-provenance"),
        });

        await expect(coordinator.changeScope({
            claimId: "claim-a",
            applicability: { kind: "whole_vault" },
            partition: { kind: "device_collaboration", key: "device" },
            explicitDeviceScope: true,
            scopeAllowed: true,
            dataBoundaryAllowed: true,
        })).resolves.toEqual({ ok: false, reason: "claim_not_governable" });
    });

    it("uses an inclusive seven-day Undo boundary and garbage-collects only expired snapshots", async () => {
        let now = new Date(NOW);
        const state = createState({
            claims: [claim("claim-a"), claim("claim-b")],
            revisions: [revision("claim-a"), revision("claim-b")],
        });
        state.suppressionMarkers.push({
            id: "durable-marker",
            partition: VAULT_A,
            sourceFingerprintId: "source",
            ruleFingerprint: "rule",
            reason: "rejected",
            createdAt: NOW.toISOString(),
            updatedAt: NOW.toISOString(),
        });
        const repo = repository(state);
        const coordinator = new MemoryGovernanceCoordinator({
            repository: repo,
            opaqueVaultKey: "vault-a",
            now: () => now,
            idFactory: ids("undo"),
        });
        const first = await coordinator.pauseUse({ claimId: "claim-a" });
        const second = await coordinator.pauseUse({ claimId: "claim-b" });
        expect(first.ok && second.ok).toBe(true);
        const firstEventId = first.ok ? first.value.eventId : "";
        const secondEventId = second.ok ? second.value.eventId : "";

        now = new Date("2026-07-18T08:00:00.000Z");
        await expect(coordinator.undoRecentChange({ eventId: firstEventId }))
            .resolves.toMatchObject({ ok: true });
        now = new Date("2026-07-18T08:00:00.001Z");
        await expect(coordinator.undoRecentChange({ eventId: secondEventId })).resolves.toEqual({
            ok: false,
            reason: "undo_expired",
        });
        await expect(coordinator.collectGarbage()).resolves.toEqual({
            ok: true,
            value: {
                removedSnapshotIds: [expect.any(String)],
                removedChangeEventCount: 1,
            },
        });
        const final = await repo.initialize();
        expect(final.undoSnapshots).toHaveLength(0);
        expect(final.changeEvents.find((entry) => entry.id === secondEventId)?.undoSnapshotId)
            .toBeUndefined();
        expect(final.suppressionMarkers).toEqual([expect.objectContaining({ id: "durable-marker" })]);
    });

    it("bounds completed change history and applied Profile outbox rows", async () => {
        const state = createState();
        state.changeEvents.push({
            id: "event-old",
            claimId: "claim-a",
            kind: "pause",
            scopeKey: "vault-a",
            effect: "future_answers",
            occurredAt: "2026-07-01T08:00:00.000Z",
        });
        state.pendingOperations.push({
            id: "profile-applied-old",
            kind: "profile_projection",
            action: "upsert",
            claimId: "claim-a",
            profileRecordId: "profile-a",
            targetRevisionId: "revision-claim-a",
            state: "applied",
            attemptCount: 1,
            createdAt: "2026-07-01T08:00:00.000Z",
            updatedAt: "2026-07-01T08:00:00.000Z",
        });
        const repo = repository(state);
        const coordinator = new MemoryGovernanceCoordinator({
            repository: repo,
            opaqueVaultKey: "vault-a",
            now: () => new Date("2026-07-10T08:00:00.001Z"),
        });

        await expect(coordinator.collectGarbage()).resolves.toEqual({
            ok: true,
            value: {
                removedSnapshotIds: [],
                removedChangeEventCount: 1,
                removedAppliedProfileOperationCount: 1,
            },
        });
        const final = await repo.initialize();
        expect(final.changeEvents).toEqual([]);
        expect(final.pendingOperations).toEqual([]);
        expect(final.claims).toHaveLength(1);
        expect(final.revisions).toHaveLength(1);
    });

    it("compacts a large completed-history state without touching authoritative claims", async () => {
        const state = createState();
        for (let index = 0; index < 1_000; index += 1) {
            state.changeEvents.push({
                id: `event-old-${index}`,
                claimId: "claim-a",
                kind: "pause",
                scopeKey: "vault-a",
                effect: "future_answers",
                occurredAt: "2026-06-01T08:00:00.000Z",
            });
            state.pendingOperations.push({
                id: `profile-applied-old-${index}`,
                kind: "profile_projection",
                action: "upsert",
                claimId: "claim-a",
                profileRecordId: `profile-${index}`,
                targetRevisionId: "revision-claim-a",
                state: "applied",
                attemptCount: 1,
                createdAt: "2026-06-01T08:00:00.000Z",
                updatedAt: "2026-06-01T08:00:00.000Z",
            });
        }
        const beforeSize = JSON.stringify(state).length;
        const repo = repository(state);
        const coordinator = new MemoryGovernanceCoordinator({
            repository: repo,
            opaqueVaultKey: "vault-a",
            now: () => new Date("2026-07-10T08:00:00.000Z"),
        });

        await expect(coordinator.collectGarbage()).resolves.toMatchObject({
            ok: true,
            value: {
                removedChangeEventCount: 1_000,
                removedAppliedProfileOperationCount: 1_000,
            },
        });
        const final = await repo.initialize();
        expect(final.claims).toEqual(state.claims);
        expect(final.revisions).toEqual(state.revisions);
        expect(JSON.stringify(final).length).toBeLessThan(beforeSize / 10);
    });

    it("garbage-collects expired content-bearing rollback recovery while keeping governed state", async () => {
        const state = createState({ compatibility: true });
        state.migrationDeltas.push({
            sequence: 1,
            migrationRunId: "run-a",
            partition: VAULT_A,
            committedAt: NOW.toISOString(),
            kind: "claim_forgotten",
            entityId: "old-claim",
        });
        const repo = repository(state);
        const coordinator = new MemoryGovernanceCoordinator({
            repository: repo,
            opaqueVaultKey: "vault-a",
            now: () => new Date("2026-07-18T08:00:00.001Z"),
        });

        await expect(coordinator.collectGarbage()).resolves.toMatchObject({
            ok: true,
            value: {
                removedRollbackPayloadEntryIds: [expect.any(String)],
                removedMigrationDeltaCount: 1,
            },
        });
        const final = await repo.initialize();
        expect(final.rollbackPayloadEntries).toEqual([]);
        expect(final.migrationDeltas).toEqual([]);
        expect(final.migrationStates["vault-a"].rollbackExpiresAt).toBeUndefined();
        expect(final.claims[0].activeRevisionId).toBe("revision-claim-a");
    });

    it("fails closed for blocked migration phases, legacy context, and claims with no prompt effect", async () => {
        for (const [phase, reason] of [
            ["rolling_back", "migration_rolling_back"],
            ["local_verifying", "migration_phase_blocks_mutation"],
        ] as const) {
            const state = createState({ compatibility: true });
            state.migrationStates["vault-a"].phase = phase;
            const repo = repository(state);
            const coordinator = new MemoryGovernanceCoordinator({
                repository: repo,
                opaqueVaultKey: "vault-a",
                now: () => NOW,
                idFactory: ids(phase),
            });
            await expect(coordinator.pauseUse({ claimId: "claim-a" })).resolves.toEqual({
                ok: false,
                reason,
            });
            expect((await repo.initialize()).commitSequence).toBe(0);
        }

        const legacy = createState();
        legacy.policyStates["vault-a"].contextProjectionMode = "legacy";
        const legacyCoordinator = new MemoryGovernanceCoordinator({
            repository: repository(legacy),
            opaqueVaultKey: "vault-a",
            now: () => NOW,
        });
        await expect(legacyCoordinator.pauseUse({ claimId: "claim-a" })).resolves.toEqual({
            ok: false,
            reason: "governed_context_required",
        });

        const noEffect = createState({
            claims: [claim("claim-a", VAULT_A, { effect: "stored_not_in_use" })],
        });
        const noEffectRepo = repository(noEffect);
        const noEffectCoordinator = new MemoryGovernanceCoordinator({
            repository: noEffectRepo,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
        });
        await expect(noEffectCoordinator.pauseUse({ claimId: "claim-a" })).resolves.toEqual({
            ok: false,
            reason: "no_effect",
        });
        await expect(noEffectCoordinator.correct({
            claimId: "claim-a",
            summary: "Corrected stored understanding",
            scopeAllowed: true,
            dataBoundaryAllowed: true,
        })).resolves.toMatchObject({ ok: true });
        expect((await noEffectRepo.initialize()).revisions.at(-1)).toMatchObject({
            summary: "Corrected stored understanding",
            authority: "user_correction",
        });
    });

    it("does not leave claim/event/snapshot/delta fragments when repository commit fails", async () => {
        const base = repository(createState({ compatibility: true }));
        const rejecting: MemoryGovernanceRepository = {
            initialize: () => base.initialize(),
            transact: async <T>(operation: (draft: DeviceMemoryGovernanceStateV1) => T | Promise<T>) => {
                const draft = await base.initialize();
                await operation(draft);
                throw new Error("commit failed");
            },
            subscribe: (listener) => base.subscribe(listener),
            dispose: () => base.dispose(),
        };
        const coordinator = new MemoryGovernanceCoordinator({
            repository: rejecting,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            idFactory: ids("failed"),
        });

        await expect(coordinator.correct({
            claimId: "claim-a",
            summary: "Never partially commit this",
            scopeAllowed: true,
            dataBoundaryAllowed: true,
        })).rejects.toThrow("commit failed");
        const state = await base.initialize();
        expect(state.claims[0].activeRevisionId).toBe("revision-claim-a");
        expect(state.revisions).toHaveLength(1);
        expect(state.changeEvents).toHaveLength(0);
        expect(state.undoSnapshots).toHaveLength(0);
        expect(state.migrationDeltas).toHaveLength(0);
        expect(state.rollbackPayloadEntries).toHaveLength(1);
    });

    it("appends after mixed Queue deltas without treating rollback replay cursor as journal head", async () => {
        const state = createState({ compatibility: true });
        const queue = queueItem("queue-a");
        const value: LegacyRollbackValue = { kind: "memory_queue", item: legacyQueueItem(queue) };
        const payload = rollbackEntry("queue-delta-payload", queue.id, value);
        const delta: MemoryMigrationDelta = {
            sequence: 1,
            migrationRunId: "run-a",
            partition: VAULT_A,
            committedAt: NOW.toISOString(),
            kind: "queue_changed",
            entityId: queue.id,
            payloadEntryId: payload.id,
            payloadChecksum: payload.checksum,
        };
        state.rollbackPayloadEntries.push(payload);
        state.migrationDeltas.push(delta);
        state.migrationStates["vault-a"].lastAppliedDeltaSequence = 0;
        const repo = repository(state);
        const coordinator = new MemoryGovernanceCoordinator({
            repository: repo,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            idFactory: ids("mixed"),
        });

        await expect(coordinator.pauseUse({ claimId: "claim-a" })).resolves.toMatchObject({ ok: true });
        const final = await repo.initialize();
        expect(final.migrationDeltas.map((entry) => [entry.sequence, entry.kind])).toEqual([
            [1, "queue_changed"],
            [2, "claim_changed"],
        ]);
        expect(final.migrationStates["vault-a"].lastAppliedDeltaSequence).toBe(0);
        const lifecyclePayload = final.rollbackPayloadEntries.find(
            (entry) => entry.id === final.migrationDeltas[1].payloadEntryId,
        )!;
        expect(lifecyclePayload.checksum).toBe(checksumLegacyRollbackValue(lifecyclePayload.value));
    });

    it("keeps lifecycle control available after the rollback window expires", async () => {
        const state = createState({ compatibility: true });
        const repo = repository(state);
        const coordinator = new MemoryGovernanceCoordinator({
            repository: repo,
            opaqueVaultKey: "vault-a",
            now: () => new Date("2026-07-19T08:00:00.000Z"),
            idFactory: ids("expired-window"),
        });

        await expect(coordinator.pauseUse({ claimId: "claim-a" })).resolves.toMatchObject({ ok: true });

        const final = await repo.initialize();
        expect(final.claims[0].lifecycle).toBe("paused");
        expect(final.changeEvents).toHaveLength(1);
        expect(final.undoSnapshots).toHaveLength(1);
        expect(final.migrationDeltas).toHaveLength(0);
        expect(final.rollbackPayloadEntries).toHaveLength(1);
    });

    it("keeps lifecycle control available after explicit legacy finalization", async () => {
        const state = createState({ compatibility: true });
        state.migrationStates["vault-a"].phase = "finalized";
        delete state.migrationStates["vault-a"].rollbackExpiresAt;
        state.rollbackPayloadEntries = [];
        const repo = repository(state);
        const coordinator = new MemoryGovernanceCoordinator({
            repository: repo,
            opaqueVaultKey: "vault-a",
            now: () => NOW,
            idFactory: ids("finalized"),
        });

        await expect(coordinator.pauseUse({ claimId: "claim-a" })).resolves.toMatchObject({ ok: true });

        const final = await repo.initialize();
        expect(final.claims[0].lifecycle).toBe("paused");
        expect(final.migrationDeltas).toEqual([]);
    });

    it("retries Forget by exact links and succeeds only after content-bearing recovery is irreversibly removed", async () => {
        const secretBefore = "A deeply private preference";
        const secretAfter = "A corrected deeply private preference";
        const secretPath = "private/secret.md";
        const claimA = claim("claim-a", VAULT_A, {
            applicability: { kind: "current_note", paths: [secretPath] },
        });
        const claimB = claim("claim-b");
        const state = createState({
            claims: [claimA, claimB],
            revisions: [
                revision("claim-a", secretBefore, "explicit_user", secretPath),
                revision("claim-b", "Unrelated content"),
            ],
            compatibility: true,
        });
        state.memoryQueueItems = [
            queueItem("queue-target", VAULT_A, secretBefore),
            queueItem("queue-other", VAULT_A, "Unrelated queue content"),
        ];
        state.rollbackPayloadEntries.push(rollbackEntry(
            "base-queue-target",
            "queue-target",
            { kind: "memory_queue", item: legacyQueueItem(state.memoryQueueItems[0]) },
        ));
        const links: MemoryProjectionLink[] = [
            {
                id: "link-profile-target",
                claimId: "claim-a",
                target: { kind: "type_a_profile", profileRecordId: "profile-target" },
                relation: "derived_copy",
                state: "active",
                sourceFingerprintId: "exact-source-fingerprint",
                ruleFingerprint: "exact-rule-fingerprint",
                createdAt: NOW.toISOString(),
            },
            {
                id: "link-queue-target",
                claimId: "claim-a",
                target: { kind: "review_queue", itemId: "queue-target" },
                relation: "origin",
                state: "active",
                sourceFingerprintId: "exact-source-fingerprint",
                ruleFingerprint: "exact-rule-fingerprint",
                createdAt: NOW.toISOString(),
            },
            {
                id: "link-unrelated",
                claimId: "claim-b",
                target: { kind: "review_queue", itemId: "queue-other" },
                relation: "origin",
                state: "active",
                createdAt: NOW.toISOString(),
            },
        ];
        state.projectionLinks = links;
        const repo = repository(state);
        const cleanupCalls: string[] = [];
        let profileFailurePending = true;
        const cleanupPort: ExactMemoryProjectionCleanupPort = {
            cleanupExactProjection: async ({ projectionLink }) => {
                cleanupCalls.push(projectionLink.id);
                if (projectionLink.id === "link-profile-target" && profileFailurePending) {
                    profileFailurePending = false;
                    throw new Error("profile unavailable");
                }
            },
        };
        const coordinator = new MemoryGovernanceCoordinator({
            repository: repo,
            opaqueVaultKey: "vault-a",
            projectionCleanupPort: cleanupPort,
            now: () => NOW,
            idFactory: ids("forget"),
        });
        await expect(coordinator.correct({
            claimId: "claim-a",
            summary: secretAfter,
            scopeAllowed: true,
            dataBoundaryAllowed: true,
        })).resolves.toMatchObject({ ok: true });
        await repo.transact((draft) => {
            for (const operation of draft.pendingOperations) {
                if (operation.kind === "profile_projection") operation.state = "applied";
            }
        });

        await expect(coordinator.forget({
            claimId: "claim-a",
        })).resolves.toEqual({
            ok: false,
            reason: "projection_cleanup_failed",
            pending: true,
        });
        const interrupted = await repo.initialize();
        expect(interrupted.claims.find((entry) => entry.id === "claim-a")?.lifecycle)
            .toBe("forget_pending");
        expect(interrupted.claims.find((entry) => entry.id === "claim-a")?.applicability)
            .toEqual({ kind: "whole_vault" });
        expect(interrupted.revisions.some((entry) => entry.claimId === "claim-a")).toBe(false);
        expect(interrupted.undoSnapshots.some((entry) => entry.claimId === "claim-a")).toBe(false);
        expect(interrupted.rollbackPayloadEntries.some((entry) => (
            entry.entityId === "claim-a" || entry.entityId === "queue-target"
        ))).toBe(false);
        expect(interrupted.migrationDeltas.filter((entry) => (
            entry.entityId === "claim-a" || entry.entityId === "queue-target"
        )).every((entry) => (
            entry.payloadEntryId === undefined && entry.payloadChecksum === undefined
        ))).toBe(true);
        expect(interrupted.pendingOperations).toEqual([
            expect.objectContaining({
                kind: "forget",
                claimId: "claim-a",
                phase: "claim_redacted",
                targets: [
                    { projectionLinkId: "link-profile-target", state: "pending" },
                    { projectionLinkId: "link-queue-target", state: "done" },
                ],
            }),
        ]);
        expect(interrupted.suppressionMarkers).toEqual(expect.arrayContaining([
            expect.objectContaining({
                sourceFingerprintId: "exact-source-fingerprint",
                ruleFingerprint: "exact-rule-fingerprint",
                reason: "corrected",
            }),
            expect.objectContaining({
                sourceFingerprintId: expect.stringMatching(/^memory-user-correction-/),
                ruleFingerprint: "user-correction-v1",
                reason: "forgotten",
            }),
        ]));
        expect(interrupted.projectionLinks.filter((entry) => entry.claimId === "claim-a"))
            .toEqual(expect.arrayContaining([
                expect.objectContaining({
                    sourceFingerprintId: expect.stringMatching(/^memory-user-correction-/),
                    ruleFingerprint: "user-correction-v1",
                }),
            ]));
        expect(useProjection(interrupted).usedClaimIds).not.toContain("claim-a");
        expect(useProjection(interrupted).usedClaimIds).toContain("claim-b");
        const interruptedSerialized = JSON.stringify(interrupted);
        expect(interruptedSerialized).not.toContain(secretBefore);
        expect(interruptedSerialized).not.toContain(secretAfter);
        expect(interruptedSerialized).not.toContain(secretPath);

        const restarted = new MemoryGovernanceCoordinator({
            repository: repo,
            opaqueVaultKey: "vault-a",
            projectionCleanupPort: cleanupPort,
            now: () => NOW,
            idFactory: ids("restart"),
        });
        await expect(restarted.resumePendingForgets()).resolves.toEqual({
            ok: true,
            value: { completed: ["claim-a"], pending: [] },
        });

        const final = await repo.initialize();
        const tombstone = final.claims.find((entry) => entry.id === "claim-a")!;
        expect(tombstone).toMatchObject({
            lifecycle: "forgotten_tombstone",
            applicability: { kind: "whole_vault" },
        });
        expect(tombstone.activeRevisionId).toBeUndefined();
        expect(final.revisions.some((entry) => entry.claimId === "claim-a")).toBe(false);
        expect(final.undoSnapshots.some((entry) => entry.claimId === "claim-a")).toBe(false);
        expect(final.rollbackPayloadEntries.some((entry) => entry.entityId === "claim-a")).toBe(false);
        expect(final.rollbackPayloadEntries.some((entry) => entry.entityId === "queue-target")).toBe(false);
        const forgottenDeltas = final.migrationDeltas.filter((entry) => entry.entityId === "claim-a");
        expect(forgottenDeltas.every((entry) => entry.kind === "claim_forgotten"
            && entry.payloadEntryId === undefined
            && entry.payloadChecksum === undefined)).toBe(true);
        expect(final.migrationDeltas.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
        expect(final.migrationStates["vault-a"].lastAppliedDeltaSequence).toBe(0);
        const forgetEvent = final.changeEvents.find((entry) => entry.kind === "forget")!;
        expect(forgetEvent).toEqual({
            id: expect.stringMatching(/^forget-event:/),
            claimId: "claim-a",
            kind: "forget",
            scopeKey: "vault-a",
            effect: "future_answers",
            occurredAt: NOW.toISOString(),
        });
        expect(final.pendingOperations).toHaveLength(0);
        expect(final.projectionLinks.find((entry) => entry.id === "link-queue-target")?.state)
            .toBe("redacted");
        expect(final.projectionLinks.find((entry) => entry.id === "link-profile-target")?.state)
            .toBe("redacted");
        expect(final.projectionLinks.find((entry) => entry.id === "link-unrelated")?.state)
            .toBe("active");
        expect(final.memoryQueueItems.map((entry) => entry.id)).toEqual(["queue-other"]);
        expect(final.claims.find((entry) => entry.id === "claim-b")).toEqual(claimB);
        expect(new Set(cleanupCalls)).toEqual(new Set(["link-profile-target"]));
        expect(cleanupCalls).not.toContain("link-unrelated");
        const serialized = JSON.stringify(final);
        expect(serialized).not.toContain(secretBefore);
        expect(serialized).not.toContain(secretAfter);
        expect(serialized).not.toContain(secretPath);
    });

    it.each(["claim_redacted", "linked_copies_redacted"] as const)(
        "sanitizes pre-upgrade %s Forget state before retrying external cleanup",
        async (phase) => {
            const secretBefore = "Private pre-upgrade understanding";
            const secretAfter = "Corrected private pre-upgrade understanding";
            const secretPath = "private/pre-upgrade.md";
            const claimA = claim("claim-a", VAULT_A, {
                applicability: { kind: "current_note", paths: [secretPath] },
            });
            const state = createState({
                claims: [claimA],
                revisions: [revision("claim-a", secretBefore, "explicit_user", secretPath)],
                compatibility: true,
            });
            state.memoryQueueItems = [queueItem("queue-target", VAULT_A, secretBefore)];
            state.rollbackPayloadEntries.push(rollbackEntry(
                "base-queue-target",
                "queue-target",
                { kind: "memory_queue", item: legacyQueueItem(state.memoryQueueItems[0]) },
            ));
            const linkedCopiesAlreadyRedacted = phase === "linked_copies_redacted";
            state.projectionLinks = [{
                id: "link-profile-target",
                claimId: "claim-a",
                target: { kind: "type_a_profile", profileRecordId: "profile-target" },
                relation: "derived_copy",
                state: linkedCopiesAlreadyRedacted ? "redacted" : "active",
                sourceFingerprintId: "source-profile",
                ruleFingerprint: "rule-profile",
                createdAt: NOW.toISOString(),
            }, {
                id: "link-queue-target",
                claimId: "claim-a",
                target: { kind: "review_queue", itemId: "queue-target" },
                relation: "origin",
                state: linkedCopiesAlreadyRedacted ? "redacted" : "active",
                sourceFingerprintId: "source-queue",
                ruleFingerprint: "rule-queue",
                createdAt: NOW.toISOString(),
            }];
            const repo = repository(state);
            const cleanupPort: ExactMemoryProjectionCleanupPort = {
                cleanupExactProjection: () => new Promise<void>(() => undefined),
                prepareLegacyCompatibilityForget: () => new Promise<never>(() => undefined),
            };
            const coordinator = new MemoryGovernanceCoordinator({
                repository: repo,
                opaqueVaultKey: "vault-a",
                projectionCleanupPort: cleanupPort,
                now: () => NOW,
                idFactory: ids(`pre-upgrade-${phase}`),
                externalOperationTimeoutMs: 1,
            });
            await expect(coordinator.correct({
                claimId: "claim-a",
                summary: secretAfter,
                scopeAllowed: true,
                dataBoundaryAllowed: true,
            })).resolves.toMatchObject({ ok: true });
            await repo.transact((draft) => {
                const currentClaim = draft.claims.find((entry) => entry.id === "claim-a");
                if (!currentClaim) throw new Error("claim missing");
                currentClaim.lifecycle = "forget_pending";
                draft.pendingOperations = [{
                    id: `pending-${phase}`,
                    kind: "forget",
                    claimId: "claim-a",
                    partition: VAULT_A,
                    suppressionMarkerIds: [],
                    targets: [{
                        projectionLinkId: "link-profile-target",
                        state: linkedCopiesAlreadyRedacted ? "done" : "pending",
                    }, {
                        projectionLinkId: "link-queue-target",
                        state: linkedCopiesAlreadyRedacted ? "done" : "pending",
                    }],
                    phase,
                    attemptCount: 0,
                    createdAt: NOW.toISOString(),
                    updatedAt: NOW.toISOString(),
                    ...(linkedCopiesAlreadyRedacted ? {
                        legacyCompatibility: {
                            recordIdFingerprints: [
                                "legacy-id-v1:11111111111111111111111111111111",
                            ],
                            memoryQueueItemIdFingerprints: [],
                            state: "pending" as const,
                        },
                    } : {}),
                }];
            });

            await expect(coordinator.resumePendingForgets()).resolves.toEqual({
                ok: true,
                value: { completed: [], pending: ["claim-a"] },
            });

            const interrupted = await repo.initialize();
            expect(interrupted.claims[0]).toMatchObject({
                lifecycle: "forget_pending",
                applicability: { kind: "whole_vault" },
            });
            expect(interrupted.claims[0].activeRevisionId).toBeUndefined();
            expect(interrupted.revisions).toEqual([]);
            expect(interrupted.memoryQueueItems).toEqual([]);
            expect(interrupted.undoSnapshots).toEqual([]);
            expect(interrupted.rollbackPayloadEntries).toEqual([]);
            expect(interrupted.projectionLinks.find((entry) => (
                entry.id === "link-queue-target"
            ))?.state).toBe("redacted");
            expect(interrupted.pendingOperations).toContainEqual(expect.objectContaining({
                kind: "forget",
                claimId: "claim-a",
                phase,
                targets: expect.arrayContaining([{
                    projectionLinkId: "link-queue-target",
                    state: "done",
                }]),
                lastErrorCode: phase === "claim_redacted"
                    ? "projection_cleanup_failed"
                    : "legacy_compatibility_prepare_failed",
            }));
            expect(interrupted.migrationDeltas.every((entry) => (
                entry.payloadEntryId === undefined && entry.payloadChecksum === undefined
            ))).toBe(true);
            const serialized = JSON.stringify(interrupted);
            expect(serialized).not.toContain(secretBefore);
            expect(serialized).not.toContain(secretAfter);
            expect(serialized).not.toContain(secretPath);
        },
    );

    it("keeps Forget pending when an exact external cleanup never settles", async () => {
        jest.useFakeTimers();
        try {
            const state = createState({
                claims: [claim("claim-timeout")],
                revisions: [revision("claim-timeout", "Private timeout content")],
            });
            state.projectionLinks = [{
                id: "link-timeout",
                claimId: "claim-timeout",
                target: { kind: "type_a_profile", profileRecordId: "profile-timeout" },
                relation: "derived_copy",
                state: "active",
                sourceFingerprintId: "timeout-source",
                ruleFingerprint: "timeout-rule",
                createdAt: NOW.toISOString(),
            }];
            const repo = repository(state);
            const coordinator = new MemoryGovernanceCoordinator({
                repository: repo,
                opaqueVaultKey: "vault-a",
                projectionCleanupPort: {
                    cleanupExactProjection: () => new Promise<void>(() => undefined),
                },
                now: () => NOW,
                idFactory: ids("timeout"),
                externalOperationTimeoutMs: 25,
            });

            const result = coordinator.forget({ claimId: "claim-timeout" });
            await jest.advanceTimersByTimeAsync(25);

            await expect(result).resolves.toEqual({
                ok: false,
                reason: "projection_cleanup_failed",
                pending: true,
            });
            const interrupted = await repo.initialize();
            expect(interrupted.claims[0]).toMatchObject({ lifecycle: "forget_pending" });
            expect(interrupted.claims[0].activeRevisionId).toBeUndefined();
            expect(interrupted.revisions).toEqual([]);
            expect(interrupted.pendingOperations).toContainEqual(expect.objectContaining({
                kind: "forget",
                claimId: "claim-timeout",
                phase: "claim_redacted",
                lastErrorCode: "projection_cleanup_failed",
            }));
        } finally {
            jest.useRealTimers();
        }
    });
});
