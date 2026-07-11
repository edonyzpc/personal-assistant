import type { PersistedSourceRef, ReviewQueueScope } from "./contracts";
import { cloneScope, cloneSourceRef } from "./helpers";
import {
    createTypeATargetSuppressionFingerprint,
    LEGACY_TYPE_A_ADOPTION_RULE_FINGERPRINT,
    TYPE_A_TARGET_SUPPRESSION_RULE_FINGERPRINT,
} from "./memory-governance-migration-coordinator";
import { checksumLegacyRollbackValue } from "./memory-governance-rollback-checksum";
import {
    MEMORY_EXTERNAL_OPERATION_TIMEOUT_MS,
    withMemoryExternalOperationTimeout,
} from "./memory-external-operation-timeout";
import {
    validateConfirmedMemoryRecord,
    type ConfirmedMemoryRecord,
} from "./memory-governance-store";
import {
    createEmptyDeviceMemoryGovernanceStateV1,
    normalizeDeviceMemoryGovernanceStateV1,
    type DeviceMemoryQueueItem,
    type DeviceMemoryGovernanceStateV1,
    type GovernedMemoryClaim,
    type LegacyRollbackValue,
    type MemoryChangeEvent,
    type MemoryClaimRevision,
    type MemoryForgetOperation,
    type MemoryGovernanceRepository,
    type MemoryMigrationState,
    type MemoryPartitionKey,
    type MemoryProjectionLink,
    type MemoryRollbackPayloadEntry,
    type MemoryUndoSnapshot,
    type PersistedMemoryProvenance,
} from "./memory-governance-persistence";

const UNDO_RETENTION_MS = 7 * 24 * 60 * 60_000;
const COMPLETED_HISTORY_RETENTION_MS = 7 * 24 * 60 * 60_000;
const MAX_FORGET_TRANSITIONS_PER_RUN = 10_000;

export interface ExactMemoryProjectionCleanupPort {
    /**
     * Removes one projection selected only by its persisted opaque link. The
     * implementation must be idempotent because a crash can repeat a
     * successful external cleanup before its local `done` commit.
     */
    cleanupExactProjection(input: {
        claimId: string;
        projectionLink: MemoryProjectionLink;
    }): Promise<void>;
    /**
     * Redacts exact syncable compatibility entities. The implementation is
     * CAS-guarded and idempotent across a crash after the external write.
     */
    prepareLegacyCompatibilityForget?(input: {
        operationId: string;
        claimId: string;
        recordIdFingerprints: string[];
        memoryQueueItemIdFingerprints: string[];
        trustedSourceHash: string;
        pendingSourceHash?: string;
    }): Promise<LegacyCompatibilityForgetPrepareResult>;
    commitLegacyCompatibilityForget?(input: {
        operationId: string;
        claimId: string;
        recordIdFingerprints: string[];
        memoryQueueItemIdFingerprints: string[];
        expectedSourceHash: string;
        resultingSourceHash: string;
    }): Promise<LegacyCompatibilityForgetCommitResult>;
}

export type LegacyCompatibilityForgetCommitResult =
    | { ok: true; sourceHash: string }
    | { ok: false; reason: "source_changed"; sourceHash: string };

export type LegacyCompatibilityForgetPrepareResult =
    | {
        ok: true;
        expectedSourceHash: string;
        resultingSourceHash: string;
        preservePendingReconciliation: boolean;
    }
    | { ok: false; reason: "source_changed"; sourceHash: string };

export interface MemoryGovernanceCoordinatorOptions {
    repository: MemoryGovernanceRepository;
    opaqueVaultKey: string;
    projectionCleanupPort?: ExactMemoryProjectionCleanupPort;
    now?: () => Date;
    idFactory?: () => string;
    externalOperationTimeoutMs?: number;
}

export type MemoryGovernanceCoordinatorResult<T> =
    | { ok: true; value: T }
    | { ok: false; reason: string; pending?: boolean };

export interface MemoryGovernanceActionReceipt {
    claimId: string;
    eventId: string;
    undoExpiresAt?: string;
}

export interface MemoryForgetReceipt {
    claimId: string;
    eventId: string;
}

export interface MemoryForgetResumeReceipt {
    completed: string[];
    pending: string[];
}

export interface MemoryUndoGarbageCollectionReceipt {
    removedSnapshotIds: string[];
    removedRollbackPayloadEntryIds?: string[];
    removedMigrationDeltaCount?: number;
    removedChangeEventCount?: number;
    removedAppliedProfileOperationCount?: number;
}

class CoordinatorError extends Error {
    constructor(readonly code: string) {
        super(`Memory governance lifecycle failed: ${code}`);
        this.name = "CoordinatorError";
    }
}

/**
 * Serialized lifecycle boundary for governed Memory. All authoritative local
 * state is committed before an external exact-link cleanup is attempted.
 */
export class MemoryGovernanceCoordinator {
    private readonly repository: MemoryGovernanceRepository;
    private readonly opaqueVaultKey: string;
    private readonly projectionCleanupPort: ExactMemoryProjectionCleanupPort | undefined;
    private readonly now: () => Date;
    private readonly idFactory: () => string;
    private readonly externalOperationTimeoutMs: number;
    private mutationTail: Promise<void> = Promise.resolve();

    constructor(options: MemoryGovernanceCoordinatorOptions) {
        this.repository = options.repository;
        this.opaqueVaultKey = options.opaqueVaultKey.trim();
        this.projectionCleanupPort = options.projectionCleanupPort;
        this.now = options.now ?? (() => new Date());
        this.externalOperationTimeoutMs = Math.max(
            1,
            options.externalOperationTimeoutMs ?? MEMORY_EXTERNAL_OPERATION_TIMEOUT_MS,
        );
        this.idFactory = options.idFactory
            ?? (() => `memory-lifecycle-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
    }

    correct(input: {
        claimId: string;
        summary: string;
        scopeAllowed: boolean;
        dataBoundaryAllowed: boolean;
    }): Promise<MemoryGovernanceCoordinatorResult<MemoryGovernanceActionReceipt>> {
        return this.serialize(async () => {
            const revisionId = this.idFactory();
            const eventId = this.idFactory();
            const snapshotId = this.idFactory();
            const payloadEntryId = this.idFactory();
            const occurredAt = this.nowIso();
            const summary = input.summary.trim();
            if (!summary) return failure("empty_correction");
            if (!input.scopeAllowed) return failure("scope_not_allowed");
            if (!input.dataBoundaryAllowed) return failure("data_boundary_denied");

            return this.runDomainMutation(async () => {
                return this.repository.transact((draft) => {
                    const migration = this.assertMutationEnvelope(draft, occurredAt);
                    const claim = this.requireClaimInScope(draft, input.claimId);
                    if (claim.lifecycle !== "active" && claim.lifecycle !== "paused") {
                        throw new CoordinatorError("claim_not_correctable");
                    }
                    this.assertNoPendingOperation(draft, claim.id);
                    const previousRevision = this.requireActiveRevision(draft, claim);
                    this.assertGovernableClaim(claim, previousRevision);
                    if (previousRevision.summary.trim() === summary) {
                        throw new CoordinatorError("no_effect");
                    }
                    const event = this.createUndoableEvent(
                        draft,
                        claim,
                        "correct",
                        eventId,
                        snapshotId,
                        occurredAt,
                    );
                    addSuppressionMarkers(
                        draft,
                        claim.partition,
                        collectActiveClaimFingerprints(draft, claim),
                        "corrected",
                        occurredAt,
                        this.idFactory,
                    );
                    addLegacyTypeATargetSuppressionMarkers(
                        draft,
                        claim,
                        this.opaqueVaultKey,
                        "corrected",
                        occurredAt,
                        this.idFactory,
                    );
                    const revision: MemoryClaimRevision = {
                        id: revisionId,
                        claimId: claim.id,
                        summary,
                        provenance: cloneProvenance(previousRevision.provenance),
                        authority: "user_correction",
                        supersedesRevisionId: previousRevision.id,
                        createdAt: occurredAt,
                    };
                    draft.revisions.push(revision);
                    claim.activeRevisionId = revision.id;
                    claim.updatedAt = occurredAt;
                    replaceActiveClaimFingerprints(
                        draft,
                        claim.id,
                        `memory-user-correction-${revision.id}`,
                        "user-correction-v1",
                    );
                    scheduleProfileProjectionOperations(draft, claim, revision, occurredAt);
                    this.appendCompatibilityClaimDelta(
                        draft,
                        migration,
                        claim,
                        revision,
                        payloadEntryId,
                        occurredAt,
                    );
                    return receipt(claim.id, event);
                });
            });
        });
    }

    pauseUse(input: {
        claimId: string;
    }): Promise<MemoryGovernanceCoordinatorResult<MemoryGovernanceActionReceipt>> {
        return this.serialize(async () => {
            const eventId = this.idFactory();
            const snapshotId = this.idFactory();
            const payloadEntryId = this.idFactory();
            const occurredAt = this.nowIso();
            return this.runDomainMutation(async () => {
                return this.repository.transact((draft) => {
                    const migration = this.assertMutationEnvelope(draft, occurredAt);
                    const claim = this.requireClaimInScope(draft, input.claimId);
                    if (claim.lifecycle !== "active") throw new CoordinatorError("no_effect");
                    this.assertNoPendingOperation(draft, claim.id);
                    const revision = this.requireActiveRevision(draft, claim);
                    this.assertPotentialUseEffect(claim, revision, true);
                    const event = this.createUndoableEvent(
                        draft,
                        claim,
                        "pause",
                        eventId,
                        snapshotId,
                        occurredAt,
                    );
                    claim.lifecycle = "paused";
                    claim.updatedAt = occurredAt;
                    this.appendCompatibilityClaimDelta(
                        draft,
                        migration,
                        claim,
                        revision,
                        payloadEntryId,
                        occurredAt,
                    );
                    return receipt(claim.id, event);
                });
            });
        });
    }

    autoRemove(input: {
        claimId: string;
        expectedActiveRevisionId: string;
    }): Promise<MemoryGovernanceCoordinatorResult<MemoryGovernanceActionReceipt>> {
        return this.serialize(async () => {
            const eventId = this.idFactory();
            const snapshotId = this.idFactory();
            const payloadEntryId = this.idFactory();
            const occurredAt = this.nowIso();
            return this.runDomainMutation(async () => {
                return this.repository.transact((draft) => {
                    const migration = this.assertMutationEnvelope(draft, occurredAt);
                    const claim = this.requireClaimInScope(draft, input.claimId);
                    if (claim.lifecycle !== "active") throw new CoordinatorError("no_effect");
                    if (!input.expectedActiveRevisionId.trim()
                        || claim.activeRevisionId !== input.expectedActiveRevisionId) {
                        throw new CoordinatorError("stale_automatic_change");
                    }
                    this.assertNoPendingOperation(draft, claim.id);
                    const revision = this.requireActiveRevision(draft, claim);
                    this.assertPotentialUseEffect(claim, revision, false);
                    const event = this.createUndoableEvent(
                        draft,
                        claim,
                        "auto_remove",
                        eventId,
                        snapshotId,
                        occurredAt,
                    );
                    claim.lifecycle = "paused";
                    claim.updatedAt = occurredAt;
                    this.appendCompatibilityClaimDelta(
                        draft,
                        migration,
                        claim,
                        revision,
                        payloadEntryId,
                        occurredAt,
                    );
                    return receipt(claim.id, event);
                });
            });
        });
    }

    resumeUse(input: {
        claimId: string;
        scopeAllowed: boolean;
        dataBoundaryAllowed: boolean;
    }): Promise<MemoryGovernanceCoordinatorResult<MemoryGovernanceActionReceipt>> {
        return this.serialize(async () => {
            if (!input.scopeAllowed) return failure("scope_not_allowed");
            if (!input.dataBoundaryAllowed) return failure("data_boundary_denied");
            const eventId = this.idFactory();
            const snapshotId = this.idFactory();
            const payloadEntryId = this.idFactory();
            const occurredAt = this.nowIso();
            return this.runDomainMutation(async () => {
                return this.repository.transact((draft) => {
                    const migration = this.assertMutationEnvelope(draft, occurredAt);
                    const claim = this.requireClaimInScope(draft, input.claimId);
                    if (claim.lifecycle !== "paused") throw new CoordinatorError("no_effect");
                    this.assertNoPendingOperation(draft, claim.id);
                    const revision = this.requireActiveRevision(draft, claim);
                    this.assertPotentialUseEffect(claim, revision, true);
                    const event = this.createUndoableEvent(
                        draft,
                        claim,
                        "resume",
                        eventId,
                        snapshotId,
                        occurredAt,
                    );
                    claim.lifecycle = "active";
                    claim.updatedAt = occurredAt;
                    this.appendCompatibilityClaimDelta(
                        draft,
                        migration,
                        claim,
                        revision,
                        payloadEntryId,
                        occurredAt,
                    );
                    return receipt(claim.id, event);
                });
            });
        });
    }

    changeScope(input: {
        claimId: string;
        applicability: ReviewQueueScope;
        partition?: MemoryPartitionKey;
        explicitDeviceScope?: boolean;
        scopeAllowed: boolean;
        dataBoundaryAllowed: boolean;
    }): Promise<MemoryGovernanceCoordinatorResult<MemoryGovernanceActionReceipt>> {
        return this.serialize(async () => {
            if (!input.scopeAllowed) return failure("scope_not_allowed");
            if (!input.dataBoundaryAllowed) return failure("data_boundary_denied");
            if (!isUsableScope(input.applicability)) return failure("invalid_scope");
            const eventId = this.idFactory();
            const snapshotId = this.idFactory();
            const revisionId = this.idFactory();
            const payloadEntryId = this.idFactory();
            const occurredAt = this.nowIso();
            return this.runDomainMutation(async () => {
                return this.repository.transact((draft) => {
                    const migration = this.assertMutationEnvelope(draft, occurredAt);
                    const claim = this.requireClaimInScope(draft, input.claimId);
                    if (claim.lifecycle !== "active" && claim.lifecycle !== "paused") {
                        throw new CoordinatorError("claim_not_scope_changeable");
                    }
                    this.assertNoPendingOperation(draft, claim.id);
                    const previousRevision = this.requireActiveRevision(draft, claim);
                    this.assertGovernableClaim(claim, previousRevision);
                    const nextPartition = input.partition
                        ? clonePartition(input.partition)
                        : clonePartition(claim.partition);
                    this.assertScopeTransitionAllowed(
                        claim,
                        previousRevision,
                        nextPartition,
                        input.applicability,
                        input.explicitDeviceScope === true,
                    );
                    const migrationState = draft.migrationStates[this.opaqueVaultKey];
                    if (nextPartition.kind === "device_collaboration"
                        && migrationState?.phase !== "finalized") {
                        throw new CoordinatorError("device_scope_not_ready");
                    }
                    if (partitionsEqual(claim.partition, nextPartition)
                        && scopesEqual(claim.applicability, input.applicability)) {
                        throw new CoordinatorError("no_effect");
                    }
                    const event = this.createUndoableEvent(
                        draft,
                        claim,
                        "change_scope",
                        eventId,
                        snapshotId,
                        occurredAt,
                    );
                    const revision: MemoryClaimRevision = {
                        id: revisionId,
                        claimId: claim.id,
                        summary: previousRevision.summary,
                        provenance: cloneProvenance(previousRevision.provenance),
                        authority: "user_correction",
                        supersedesRevisionId: previousRevision.id,
                        createdAt: occurredAt,
                    };
                    draft.revisions.push(revision);
                    const previousPartition = clonePartition(claim.partition);
                    claim.partition = nextPartition;
                    claim.applicability = cloneScope(input.applicability);
                    claim.effect = nextPartition.kind === "device_collaboration"
                        ? "collaboration_default"
                        : claim.effect === "collaboration_default"
                            ? "future_answers"
                            : claim.effect;
                    claim.activeRevisionId = revision.id;
                    claim.updatedAt = occurredAt;
                    event.scopeKey = partitionScopeKey(nextPartition);
                    event.effect = claim.effect;
                    if (nextPartition.kind === "device_collaboration") {
                        this.scheduleProfileProjectionRemovalOperations(
                            draft,
                            claim.id,
                            occurredAt,
                            event.id,
                            false,
                        );
                    } else if (previousPartition.kind === "device_collaboration") {
                        for (const link of draft.projectionLinks) {
                            if (link.claimId === claim.id && link.target.kind === "type_a_profile") {
                                link.state = "active";
                            }
                        }
                        scheduleProfileProjectionOperations(draft, claim, revision, occurredAt);
                    }
                    this.appendCompatibilityClaimDelta(
                        draft,
                        migration,
                        claim,
                        revision,
                        payloadEntryId,
                        occurredAt,
                    );
                    return receipt(claim.id, event);
                });
            });
        });
    }

    undoRecentChange(input: {
        eventId: string;
    }): Promise<MemoryGovernanceCoordinatorResult<MemoryGovernanceActionReceipt>> {
        return this.serialize(async () => {
            const undoEventId = this.idFactory();
            const payloadEntryId = this.idFactory();
            const occurredAt = this.nowIso();
            return this.runDomainMutation(async () => {
                return this.repository.transact((draft) => {
                    const migration = this.assertMutationEnvelope(draft, occurredAt);
                    const event = draft.changeEvents.find((candidate) => candidate.id === input.eventId);
                    if (!event) throw new CoordinatorError("undo_not_available");
                    if (!event.undoSnapshotId) {
                        const completed = draft.changeEvents.find((candidate) => (
                            candidate.kind === "undo"
                            && candidate.claimId === event.claimId
                            && candidate.undoesEventId === event.id
                        ));
                        if (!completed) throw new CoordinatorError("undo_not_available");
                        const completedClaim = this.requireClaimInScope(draft, completed.claimId);
                        return receipt(completedClaim.id, completed);
                    }
                    const claim = this.requireClaimInScope(draft, event.claimId);
                    if (claim.lifecycle === "forget_pending" || claim.lifecycle === "forgotten_tombstone") {
                        throw new CoordinatorError("undo_not_available");
                    }
                    this.assertNoPendingOperation(draft, claim.id);
                    const latestEvent = draft.changeEvents.filter((candidate) => candidate.claimId === claim.id).at(-1);
                    if (!latestEvent || latestEvent.id !== event.id) {
                        throw new CoordinatorError("undo_not_latest");
                    }
                    const snapshot = draft.undoSnapshots.find(
                        (candidate) => candidate.id === event.undoSnapshotId,
                    );
                    if (!snapshot || snapshot.eventId !== event.id || snapshot.claimId !== claim.id) {
                        throw new CoordinatorError("undo_snapshot_missing");
                    }
                    if (!isUnexpired(snapshot.expiresAt, occurredAt)) {
                        throw new CoordinatorError("undo_expired");
                    }
                    if (!this.partitionIsInScope(snapshot.partition)) {
                        throw new CoordinatorError("claim_not_in_scope");
                    }

                    if (snapshot.restoreMode === "remove_added_claim") {
                        return this.undoAutomaticAddition(
                            draft,
                            migration,
                            claim,
                            event,
                            snapshot,
                            undoEventId,
                            occurredAt,
                        );
                    }

                    if (event.kind === "correct") {
                        removeCorrectionSuppressionMarkers(
                            draft,
                            snapshot,
                            event.occurredAt,
                            this.opaqueVaultKey,
                        );
                    }

                    const claimIndex = draft.claims.findIndex((candidate) => candidate.id === claim.id);
                    draft.claims[claimIndex] = cloneClaim(snapshot.claim);
                    replaceClaimRevisions(draft, claim.id, snapshot.revisions);
                    replaceClaimLinks(draft, claim.id, snapshot.projectionLinks);
                    draft.pendingOperations = draft.pendingOperations.filter(
                        (operation) => operation.claimId !== claim.id,
                    );
                    draft.undoSnapshots = draft.undoSnapshots.filter(
                        (candidate) => candidate.id !== snapshot.id,
                    );
                    delete event.undoSnapshotId;
                    const restoredClaim = draft.claims[claimIndex];
                    const restoredRevision = this.requireActiveRevision(draft, restoredClaim);
                    if (event.kind === "change_scope"
                        && restoredClaim.partition.kind === "device_collaboration") {
                        this.scheduleProfileProjectionRemovalOperations(
                            draft,
                            restoredClaim.id,
                            occurredAt,
                            undoEventId,
                            true,
                        );
                    } else {
                        scheduleProfileProjectionOperations(
                            draft,
                            restoredClaim,
                            restoredRevision,
                            occurredAt,
                        );
                    }
                    const undoEvent: MemoryChangeEvent = {
                        id: undoEventId,
                        claimId: restoredClaim.id,
                        kind: "undo",
                        scopeKey: partitionScopeKey(restoredClaim.partition),
                        effect: restoredClaim.effect,
                        occurredAt,
                        undoesEventId: event.id,
                    };
                    draft.changeEvents.push(undoEvent);
                    this.appendCompatibilityClaimDelta(
                        draft,
                        migration,
                        restoredClaim,
                        restoredRevision,
                        payloadEntryId,
                        occurredAt,
                    );
                    return receipt(restoredClaim.id, undoEvent);
                });
            });
        });
    }

    private undoAutomaticAddition(
        draft: DeviceMemoryGovernanceStateV1,
        migration: MemoryMigrationState | null,
        claim: GovernedMemoryClaim,
        event: MemoryChangeEvent,
        snapshot: Extract<MemoryUndoSnapshot, { restoreMode: "remove_added_claim" }>,
        undoEventId: string,
        occurredAt: string,
    ): MemoryGovernanceActionReceipt {
        if (event.kind !== "add") throw new CoordinatorError("undo_snapshot_invalid");
        const links = snapshot.projectionLinks.map((snapshotLink) => {
            const current = draft.projectionLinks.find((link) => link.id === snapshotLink.id);
            if (!current || !projectionLinksEqual(current, snapshotLink) || current.state !== "active") {
                throw new CoordinatorError("undo_projection_link_changed");
            }
            return current;
        });
        if (draft.projectionLinks.some((link) => (
            link.claimId === claim.id
            && link.state === "active"
            && !links.some((snapshotLink) => snapshotLink.id === link.id)
        ))) {
            throw new CoordinatorError("undo_projection_link_changed");
        }
        const fingerprintPairs = new Map<string, { sourceFingerprintId: string; ruleFingerprint: string }>();
        for (const link of links) {
            if (!link.sourceFingerprintId || !link.ruleFingerprint) continue;
            fingerprintPairs.set(`${link.sourceFingerprintId}\u0000${link.ruleFingerprint}`, {
                sourceFingerprintId: link.sourceFingerprintId,
                ruleFingerprint: link.ruleFingerprint,
            });
        }
        for (const pair of fingerprintPairs.values()) {
            const exists = draft.suppressionMarkers.some((marker) => (
                partitionsEqual(marker.partition, claim.partition)
                && marker.sourceFingerprintId === pair.sourceFingerprintId
                && marker.ruleFingerprint === pair.ruleFingerprint
            ));
            if (exists) continue;
            draft.suppressionMarkers.push({
                id: this.idFactory(),
                partition: clonePartition(claim.partition),
                sourceFingerprintId: pair.sourceFingerprintId,
                ruleFingerprint: pair.ruleFingerprint,
                reason: "rejected",
                createdAt: occurredAt,
                updatedAt: occurredAt,
            });
        }

        const profileLinks = links.filter((link) => link.target.kind === "type_a_profile");
        draft.pendingOperations = draft.pendingOperations.filter(
            (operation) => operation.claimId !== claim.id,
        );
        for (const link of profileLinks) {
            if (link.target.kind !== "type_a_profile") continue;
            draft.pendingOperations.push({
                id: `profile-projection-remove:${undoEventId}:${link.id}`,
                kind: "profile_projection",
                action: "remove",
                claimId: claim.id,
                profileRecordId: link.target.profileRecordId,
                projectionLinkId: link.id,
                state: "pending",
                attemptCount: 0,
                createdAt: occurredAt,
                updatedAt: occurredAt,
            });
        }

        for (const link of links) link.state = "redacted";
        const queueIds = new Set(links.flatMap((link) => (
            link.target.kind === "review_queue" ? [link.target.itemId] : []
        )));
        for (const queueId of queueIds) {
            const itemIndex = draft.memoryQueueItems.findIndex((candidate) => candidate.id === queueId);
            const item = draft.memoryQueueItems[itemIndex];
            if (!item) continue;
            draft.memoryQueueItems.splice(itemIndex, 1);
            if (migration) this.appendTextFreeQueueRemovalDelta(draft, migration, item, occurredAt);
        }

        draft.revisions = draft.revisions.filter((revision) => revision.claimId !== claim.id);
        delete claim.activeRevisionId;
        claim.lifecycle = "undone_add_tombstone";
        claim.effect = "none";
        claim.updatedAt = occurredAt;
        draft.undoSnapshots = draft.undoSnapshots.filter((candidate) => candidate.id !== snapshot.id);
        delete event.undoSnapshotId;
        const undoEvent: MemoryChangeEvent = {
            id: undoEventId,
            claimId: claim.id,
            kind: "undo",
            scopeKey: partitionScopeKey(claim.partition),
            effect: "none",
            occurredAt,
            undoesEventId: event.id,
        };
        draft.changeEvents.push(undoEvent);
        if (migration) this.appendTextFreeClaimRemovalDelta(draft, migration, claim, occurredAt, "claim_removed");
        return receipt(claim.id, undoEvent);
    }

    collectGarbage(): Promise<MemoryGovernanceCoordinatorResult<MemoryUndoGarbageCollectionReceipt>> {
        return this.serialize(async () => {
            const now = this.nowIso();
            return this.runDomainMutation(async () => {
                return this.repository.transact((draft) => {
                    const removedSnapshotIds = draft.undoSnapshots
                        .filter((snapshot) => isExpiredForGarbageCollection(snapshot.expiresAt, now))
                        .map((snapshot) => snapshot.id);
                    const removed = new Set(removedSnapshotIds);
                    if (removed.size > 0) {
                        draft.undoSnapshots = draft.undoSnapshots.filter((snapshot) => !removed.has(snapshot.id));
                        for (const event of draft.changeEvents) {
                            if (event.undoSnapshotId && removed.has(event.undoSnapshotId)) {
                                delete event.undoSnapshotId;
                            }
                        }
                    }

                    const expiredRunIds = new Set<string>();
                    for (const [vaultKey, migration] of Object.entries(draft.migrationStates)) {
                        if (migration.phase === "finalizing" || migration.phase === "rolling_back") continue;
                        const policy = draft.policyStates[vaultKey];
                        if (migration.phase === "compatibility"
                            && (!policy
                                || policy.contextProjectionMode !== "governed"
                                || policy.mode !== "effect_based")) continue;
                        if (!migration.rollbackExpiresAt
                            || !isExpiredForGarbageCollection(migration.rollbackExpiresAt, now)) continue;
                        expiredRunIds.add(migration.migrationRunId);
                        delete migration.rollbackExpiresAt;
                        delete migration.lastAppliedDeltaSequence;
                    }
                    const removedRollbackPayloadEntryIds = draft.rollbackPayloadEntries
                        .filter((entry) => expiredRunIds.has(entry.migrationRunId))
                        .map((entry) => entry.id);
                    const previousDeltaCount = draft.migrationDeltas.length;
                    if (expiredRunIds.size > 0) {
                        draft.rollbackPayloadEntries = draft.rollbackPayloadEntries
                            .filter((entry) => !expiredRunIds.has(entry.migrationRunId));
                        draft.migrationDeltas = draft.migrationDeltas
                            .filter((delta) => !expiredRunIds.has(delta.migrationRunId));
                    }
                    const removedMigrationDeltaCount = previousDeltaCount - draft.migrationDeltas.length;
                    const cutoff = Date.parse(now) - COMPLETED_HISTORY_RETENTION_MS;
                    const retainedUndoSnapshotIds = new Set(
                        draft.undoSnapshots.map((snapshot) => snapshot.id),
                    );
                    const retainedEventIds = new Set(draft.changeEvents
                        .filter((event) => {
                            const occurredAt = Date.parse(event.occurredAt);
                            return !Number.isFinite(occurredAt)
                                || occurredAt >= cutoff
                                || (event.undoSnapshotId !== undefined
                                    && retainedUndoSnapshotIds.has(event.undoSnapshotId));
                        })
                        .map((event) => event.id));
                    let expanded = true;
                    while (expanded) {
                        expanded = false;
                        for (const event of draft.changeEvents) {
                            if (!retainedEventIds.has(event.id) || !event.undoesEventId
                                || retainedEventIds.has(event.undoesEventId)) continue;
                            retainedEventIds.add(event.undoesEventId);
                            expanded = true;
                        }
                    }
                    const previousChangeEventCount = draft.changeEvents.length;
                    draft.changeEvents = draft.changeEvents.filter(
                        (event) => retainedEventIds.has(event.id),
                    );
                    const removedChangeEventCount = previousChangeEventCount
                        - draft.changeEvents.length;

                    const previousPendingOperationCount = draft.pendingOperations.length;
                    draft.pendingOperations = draft.pendingOperations.filter((operation) => {
                        if (operation.kind !== "profile_projection" || operation.state !== "applied") {
                            return true;
                        }
                        const updatedAt = Date.parse(operation.updatedAt);
                        return !Number.isFinite(updatedAt) || updatedAt >= cutoff;
                    });
                    const removedAppliedProfileOperationCount = previousPendingOperationCount
                        - draft.pendingOperations.length;
                    return {
                        removedSnapshotIds,
                        ...(removedRollbackPayloadEntryIds.length > 0
                            ? { removedRollbackPayloadEntryIds }
                            : {}),
                        ...(removedMigrationDeltaCount > 0 ? { removedMigrationDeltaCount } : {}),
                        ...(removedChangeEventCount > 0 ? { removedChangeEventCount } : {}),
                        ...(removedAppliedProfileOperationCount > 0
                            ? { removedAppliedProfileOperationCount }
                            : {}),
                    };
                });
            });
        });
    }

    forget(input: {
        claimId: string;
    }): Promise<MemoryGovernanceCoordinatorResult<MemoryForgetReceipt>> {
        return this.serialize(async () => {
            const operationId = this.idFactory();
            const payloadEntryId = this.idFactory();
            const startedAt = this.nowIso();
            const started = await this.runDomainMutation(async () => {
                return this.repository.transact((draft) => {
                    const migration = this.assertMutationEnvelope(draft, startedAt);
                    const claim = this.requireClaimInScope(draft, input.claimId);
                    if (claim.lifecycle === "forgotten_tombstone") {
                        throw new CoordinatorError("no_effect");
                    }
                    const existing = draft.pendingOperations.find(
                        (operation): operation is MemoryForgetOperation => (
                            operation.kind === "forget" && operation.claimId === claim.id
                        ),
                    );
                    if (existing) return { operationId: existing.id };
                    if (claim.lifecycle === "forget_pending") {
                        throw new CoordinatorError("forget_operation_missing");
                    }
                    this.assertNoPendingOperation(draft, claim.id);

                    const activeRevision = claim.activeRevisionId
                        ? this.requireActiveRevision(draft, claim)
                        : undefined;
                    if (migration) {
                        if (!activeRevision) throw new CoordinatorError("legacy_projection_unavailable");
                        this.appendCompatibilityClaimDelta(
                            draft,
                            migration,
                            claim,
                            activeRevision,
                            payloadEntryId,
                            startedAt,
                        );
                    }
                    const activeLinks = draft.projectionLinks
                        .filter((link) => link.claimId === claim.id && link.state === "active");
                    if (activeLinks.length === 0 || activeLinks.some((link) => (
                        !link.sourceFingerprintId?.trim() || !link.ruleFingerprint?.trim()
                    ))) {
                        throw new CoordinatorError("exact_fingerprint_required");
                    }
                    const fingerprints = new Map<string, {
                        sourceFingerprintId: string;
                        ruleFingerprint: string;
                    }>();
                    for (const link of activeLinks) {
                        const sourceFingerprintId = link.sourceFingerprintId!.trim();
                        const ruleFingerprint = link.ruleFingerprint!.trim();
                        fingerprints.set(`${sourceFingerprintId}\u0000${ruleFingerprint}`, {
                            sourceFingerprintId,
                            ruleFingerprint,
                        });
                    }
                    for (const link of draft.projectionLinks) {
                        if (link.claimId !== claim.id
                            || link.target.kind !== "type_a_profile"
                            || link.ruleFingerprint !== LEGACY_TYPE_A_ADOPTION_RULE_FINGERPRINT) continue;
                        const sourceFingerprintId = createTypeATargetSuppressionFingerprint(
                            this.opaqueVaultKey,
                            link.target.profileRecordId,
                        );
                        fingerprints.set(
                            `${sourceFingerprintId}\u0000${TYPE_A_TARGET_SUPPRESSION_RULE_FINGERPRINT}`,
                            {
                                sourceFingerprintId,
                                ruleFingerprint: TYPE_A_TARGET_SUPPRESSION_RULE_FINGERPRINT,
                            },
                        );
                    }
                    const suppressionMarkerIds: string[] = [];
                    for (const fingerprint of fingerprints.values()) {
                        const matchingMarker = draft.suppressionMarkers.find((marker) => (
                            partitionsEqual(marker.partition, claim.partition)
                            && marker.sourceFingerprintId === fingerprint.sourceFingerprintId
                            && marker.ruleFingerprint === fingerprint.ruleFingerprint
                            && marker.reason === "forgotten"
                        ));
                        if (matchingMarker) {
                            suppressionMarkerIds.push(matchingMarker.id);
                            continue;
                        }
                        const markerId = this.idFactory();
                        draft.suppressionMarkers.push({
                            id: markerId,
                            partition: clonePartition(claim.partition),
                            sourceFingerprintId: fingerprint.sourceFingerprintId,
                            ruleFingerprint: fingerprint.ruleFingerprint,
                            reason: "forgotten",
                            createdAt: startedAt,
                            updatedAt: startedAt,
                        });
                        suppressionMarkerIds.push(markerId);
                    }
                    const targets = activeLinks.map((link) => ({
                        projectionLinkId: link.id,
                        state: "pending" as const,
                    }));
                    const compatibilityMigration = draft.migrationStates[this.opaqueVaultKey];
                    const legacyRecordIdFingerprints = new Set(
                        claim.legacyCompatibility?.recordIdFingerprints ?? [],
                    );
                    const legacyMemoryQueueItemIdFingerprints = new Set(
                        claim.legacyCompatibility?.memoryQueueItemIdFingerprints ?? [],
                    );
                    for (const link of draft.projectionLinks) {
                        if (link.claimId !== claim.id || link.target.kind !== "review_queue") continue;
                        const queueItemId = link.target.itemId;
                        const queueItem = draft.memoryQueueItems.find(
                            (item) => item.id === queueItemId,
                        );
                        if (queueItem?.legacyCompatibilityItemFingerprint) {
                            legacyMemoryQueueItemIdFingerprints.add(
                                queueItem.legacyCompatibilityItemFingerprint,
                            );
                        }
                    }
                    const legacyCompatibility = compatibilityMigration?.phase === "compatibility"
                        && legacyRecordIdFingerprints.size
                            + legacyMemoryQueueItemIdFingerprints.size > 0
                        ? {
                            recordIdFingerprints: [...legacyRecordIdFingerprints].sort(),
                            memoryQueueItemIdFingerprints: [
                                ...legacyMemoryQueueItemIdFingerprints,
                            ].sort(),
                            state: "pending" as const,
                        }
                        : undefined;
                    draft.pendingOperations = draft.pendingOperations.filter(
                        (operation) => operation.claimId !== claim.id,
                    );
                    const pending: MemoryForgetOperation = {
                        id: operationId,
                        kind: "forget",
                        claimId: claim.id,
                        partition: clonePartition(claim.partition),
                        suppressionMarkerIds,
                        targets,
                        phase: "blocked",
                        attemptCount: 0,
                        createdAt: startedAt,
                        updatedAt: startedAt,
                        ...(legacyCompatibility ? { legacyCompatibility } : {}),
                    };
                    draft.pendingOperations.push(pending);
                    claim.lifecycle = "forget_pending";
                    claim.updatedAt = startedAt;
                    this.redactClaimAndRecoveryForForget(draft, pending);
                    pending.phase = "claim_redacted";
                    if (migration) this.assertDeltaJournalConsistent(draft, migration);
                    return { operationId };
                });
            });
            if (!started.ok) return started;
            return this.runForgetOperation(started.value.operationId);
        });
    }

    resumePendingForgets(): Promise<MemoryGovernanceCoordinatorResult<MemoryForgetResumeReceipt>> {
        return this.serialize(async () => {
            const snapshot = await this.repository.initialize();
            const operations = snapshot.pendingOperations.filter(
                (operation): operation is MemoryForgetOperation => operation.kind === "forget"
                    && this.partitionIsInScope(operation.partition),
            );
            const completed: string[] = [];
            const pending: string[] = [];
            for (const operation of operations) {
                const result = await this.runForgetOperation(operation.id);
                if (result.ok) completed.push(result.value.claimId);
                else pending.push(operation.claimId);
            }
            return { ok: true, value: { completed, pending } };
        });
    }

    private async runForgetOperation(
        operationId: string,
    ): Promise<MemoryGovernanceCoordinatorResult<MemoryForgetReceipt>> {
        for (let transition = 0; transition < MAX_FORGET_TRANSITIONS_PER_RUN; transition += 1) {
            const snapshot = await this.repository.initialize();
            const operation = snapshot.pendingOperations.find(
                (candidate): candidate is MemoryForgetOperation => (
                    candidate.kind === "forget" && candidate.id === operationId
                ),
            );
            if (!operation) {
                const event = snapshot.changeEvents.find(
                    (candidate) => candidate.id === forgetEventId(operationId),
                );
                return event
                    ? { ok: true, value: { claimId: event.claimId, eventId: event.id } }
                    : failure("forget_operation_missing");
            }
            if (!this.partitionIsInScope(operation.partition)) return failure("claim_not_in_scope");
            const timestamp = this.nowIso();

            if (forgetNeedsLocalRedaction(snapshot, operation)) {
                const normalized = await this.runDomainMutation(async () => {
                    return this.repository.transact((draft) => {
                        const migration = this.assertMutationEnvelope(draft, timestamp);
                        const pending = requireForgetOperation(
                            draft,
                            operationId,
                            operation.phase,
                        );
                        const claim = this.requireClaimInScope(draft, pending.claimId);
                        if (claim.lifecycle !== "forget_pending") {
                            throw new CoordinatorError("forget_state_mismatch");
                        }
                        this.redactClaimAndRecoveryForForget(draft, pending);
                        if (pending.phase === "blocked") pending.phase = "claim_redacted";
                        pending.updatedAt = timestamp;
                        delete pending.lastErrorCode;
                        if (migration) this.assertDeltaJournalConsistent(draft, migration);
                        return pending.id;
                    });
                });
                if (!normalized.ok) return normalized;
                continue;
            }

            if (operation.phase === "blocked") {
                const result = await this.runDomainMutation(async () => {
                    return this.repository.transact((draft) => {
                        this.assertMutationEnvelope(draft, timestamp);
                        const pending = requireForgetOperation(draft, operationId, "blocked");
                        const claim = this.requireClaimInScope(draft, pending.claimId);
                        if (claim.lifecycle !== "forget_pending") {
                            throw new CoordinatorError("forget_state_mismatch");
                        }
                        const migration = draft.migrationStates[this.opaqueVaultKey];
                        this.redactClaimAndRecoveryForForget(draft, pending);
                        if (migration) this.assertDeltaJournalConsistent(draft, migration);
                        pending.phase = "claim_redacted";
                        pending.updatedAt = timestamp;
                        delete pending.lastErrorCode;
                        return pending.id;
                    });
                });
                if (!result.ok) return result;
                continue;
            }

            if (operation.phase === "claim_redacted") {
                const target = operation.targets.find((candidate) => candidate.state === "pending");
                if (!target) {
                    const advanced = await this.runDomainMutation(async () => {
                        return this.repository.transact((draft) => {
                            this.assertMutationEnvelope(draft, timestamp);
                            const pending = requireForgetOperation(draft, operationId, "claim_redacted");
                            if (pending.targets.some((candidate) => candidate.state !== "done")) {
                                throw new CoordinatorError("forget_target_state_changed");
                            }
                            pending.phase = "linked_copies_redacted";
                            pending.updatedAt = timestamp;
                            delete pending.lastErrorCode;
                            return pending.id;
                        });
                    });
                    if (!advanced.ok) return advanced;
                    continue;
                }
                const link = snapshot.projectionLinks.find(
                    (candidate) => candidate.id === target.projectionLinkId
                        && candidate.claimId === operation.claimId,
                );
                if (!link) return failure("exact_projection_link_missing", true);
                if (!this.projectionCleanupPort) {
                    await this.recordForgetFailure(operationId, "projection_cleanup_unavailable", timestamp);
                    return failure("projection_cleanup_unavailable", true);
                }
                try {
                    await withMemoryExternalOperationTimeout(
                        "forget_projection_cleanup",
                        () => this.projectionCleanupPort!.cleanupExactProjection({
                            claimId: operation.claimId,
                            projectionLink: cloneProjectionLink(link),
                        }),
                        this.externalOperationTimeoutMs,
                    );
                } catch {
                    await this.recordForgetFailure(operationId, "projection_cleanup_failed", timestamp);
                    return failure("projection_cleanup_failed", true);
                }
                const recorded = await this.runDomainMutation(async () => {
                    return this.repository.transact((draft) => {
                        this.assertMutationEnvelope(draft, timestamp);
                        const pending = requireForgetOperation(draft, operationId, "claim_redacted");
                        const currentTarget = pending.targets.find(
                            (candidate) => candidate.projectionLinkId === target.projectionLinkId,
                        );
                        if (!currentTarget) throw new CoordinatorError("exact_projection_link_missing");
                        if (currentTarget.state === "done") return pending.id;
                        const currentLink = draft.projectionLinks.find(
                            (candidate) => candidate.id === currentTarget.projectionLinkId
                                && candidate.claimId === pending.claimId,
                        );
                        if (!currentLink) throw new CoordinatorError("exact_projection_link_missing");
                        currentLink.state = "redacted";
                        if (currentLink.target.kind === "review_queue") {
                            const itemId = currentLink.target.itemId;
                            draft.memoryQueueItems = draft.memoryQueueItems.filter(
                                (item) => item.id !== itemId,
                            );
                        }
                        currentTarget.state = "done";
                        pending.attemptCount += 1;
                        pending.updatedAt = timestamp;
                        delete pending.lastErrorCode;
                        return pending.id;
                    });
                });
                if (!recorded.ok) return recorded;
                continue;
            }

            if (operation.phase === "linked_copies_redacted") {
                const legacy = operation.legacyCompatibility;
                if (legacy && legacy.state === "pending") {
                    const migration = snapshot.migrationStates[this.opaqueVaultKey];
                    const trustedSourceHash = migration?.legacySourceStateHash
                        ?? migration?.sourceHash;
                    const prepare = this.projectionCleanupPort?.prepareLegacyCompatibilityForget;
                    if (!migration || migration.phase !== "compatibility" || !trustedSourceHash) {
                        await this.recordForgetFailure(
                            operationId,
                            "legacy_compatibility_state_unavailable",
                            timestamp,
                        );
                        return failure("legacy_compatibility_state_unavailable", true);
                    }
                    if (!prepare) {
                        await this.recordForgetFailure(
                            operationId,
                            "legacy_compatibility_cleanup_unavailable",
                            timestamp,
                        );
                        return failure("legacy_compatibility_cleanup_unavailable", true);
                    }
                    let plan: Awaited<ReturnType<typeof prepare>>;
                    try {
                        plan = await withMemoryExternalOperationTimeout(
                            "forget_legacy_prepare",
                            () => prepare({
                                operationId,
                                claimId: operation.claimId,
                                recordIdFingerprints: [...legacy.recordIdFingerprints],
                                memoryQueueItemIdFingerprints: [
                                    ...legacy.memoryQueueItemIdFingerprints,
                                ],
                                trustedSourceHash,
                                ...(migration.pendingLegacySourceHash ? {
                                    pendingSourceHash: migration.pendingLegacySourceHash,
                                } : {}),
                            }),
                            this.externalOperationTimeoutMs,
                        );
                    } catch {
                        await this.recordForgetFailure(
                            operationId,
                            "legacy_compatibility_prepare_failed",
                            timestamp,
                        );
                        return failure("legacy_compatibility_prepare_failed", true);
                    }
                    if (!plan.ok) {
                        const replanned = await this.replanLegacyCompatibilityForget(
                            operationId,
                            plan.sourceHash,
                            timestamp,
                        );
                        if (!replanned.ok) return replanned;
                        continue;
                    }
                    const prepared = await this.runDomainMutation(async () => {
                        return this.repository.transact((draft) => {
                            const pending = requireForgetOperation(
                                draft,
                                operationId,
                                "linked_copies_redacted",
                            );
                            const current = pending.legacyCompatibility;
                            if (!current || current.state !== "pending") {
                                throw new CoordinatorError("legacy_compatibility_plan_changed");
                            }
                            const currentMigration = draft.migrationStates[this.opaqueVaultKey];
                            const currentTrustedHash = currentMigration?.legacySourceStateHash
                                ?? currentMigration?.sourceHash;
                            if (!currentMigration || currentMigration.phase !== "compatibility"
                                || currentTrustedHash !== trustedSourceHash
                                || currentMigration.pendingLegacySourceHash
                                    !== migration.pendingLegacySourceHash) {
                                throw new CoordinatorError("legacy_compatibility_source_changed");
                            }
                            if (draft.pendingOperations.some((candidate) => (
                                candidate.id !== pending.id
                                && candidate.kind === "forget"
                                && candidate.partition.kind === "vault"
                                && candidate.partition.key === this.opaqueVaultKey
                                && candidate.legacyCompatibility?.state === "prepared"
                            ))) {
                                throw new CoordinatorError("legacy_compatibility_mutation_busy");
                            }
                            current.state = "prepared";
                            current.expectedSourceHash = plan.expectedSourceHash;
                            current.resultingSourceHash = plan.resultingSourceHash;
                            current.preservePendingReconciliation = plan.preservePendingReconciliation;
                            pending.updatedAt = timestamp;
                            delete pending.lastErrorCode;
                            return pending.id;
                        });
                    });
                    if (!prepared.ok) return prepared;
                    continue;
                }
                if (legacy && legacy.state === "prepared") {
                    const commit = this.projectionCleanupPort?.commitLegacyCompatibilityForget;
                    if (!commit || !legacy.expectedSourceHash || !legacy.resultingSourceHash) {
                        await this.recordForgetFailure(
                            operationId,
                            "legacy_compatibility_cleanup_unavailable",
                            timestamp,
                        );
                        return failure("legacy_compatibility_cleanup_unavailable", true);
                    }
                    const expectedSourceHash = legacy.expectedSourceHash;
                    const resultingSourceHash = legacy.resultingSourceHash;
                    let committed: Awaited<ReturnType<typeof commit>>;
                    try {
                        committed = await withMemoryExternalOperationTimeout(
                            "forget_legacy_commit",
                            () => commit({
                                operationId,
                                claimId: operation.claimId,
                                recordIdFingerprints: [...legacy.recordIdFingerprints],
                                memoryQueueItemIdFingerprints: [
                                    ...legacy.memoryQueueItemIdFingerprints,
                                ],
                                expectedSourceHash,
                                resultingSourceHash,
                            }),
                            this.externalOperationTimeoutMs,
                        );
                    } catch {
                        await this.recordForgetFailure(
                            operationId,
                            "legacy_compatibility_cleanup_failed",
                            timestamp,
                        );
                        return failure("legacy_compatibility_cleanup_failed", true);
                    }
                    if (!committed.ok) {
                        const replanned = await this.replanLegacyCompatibilityForget(
                            operationId,
                            committed.sourceHash,
                            timestamp,
                            {
                                expectedSourceHash: legacy.expectedSourceHash,
                                resultingSourceHash: legacy.resultingSourceHash,
                            },
                        );
                        if (!replanned.ok) return replanned;
                        continue;
                    }
                    const acknowledged = await this.runDomainMutation(async () => {
                        return this.repository.transact((draft) => {
                            const pending = requireForgetOperation(
                                draft,
                                operationId,
                                "linked_copies_redacted",
                            );
                            const current = pending.legacyCompatibility;
                            if (!current || current.state !== "prepared"
                                || current.expectedSourceHash !== legacy.expectedSourceHash
                                || current.resultingSourceHash !== legacy.resultingSourceHash
                                || committed.sourceHash !== current.resultingSourceHash) {
                                throw new CoordinatorError("legacy_compatibility_plan_changed");
                            }
                            const migration = draft.migrationStates[this.opaqueVaultKey];
                            if (!migration || migration.phase !== "compatibility") {
                                throw new CoordinatorError("legacy_compatibility_state_unavailable");
                            }
                            if (current.preservePendingReconciliation) {
                                migration.pendingLegacySourceHash = committed.sourceHash;
                            } else {
                                migration.legacySourceStateHash = committed.sourceHash;
                                delete migration.pendingLegacySourceHash;
                            }
                            current.state = "done";
                            pending.updatedAt = timestamp;
                            delete pending.lastErrorCode;
                            return pending.id;
                        });
                    });
                    if (!acknowledged.ok) return acknowledged;
                    continue;
                }
                const result = await this.runDomainMutation(async () => {
                    return this.repository.transact((draft) => {
                        const migration = this.assertMutationEnvelope(draft, timestamp);
                        const pending = requireForgetOperation(draft, operationId, "linked_copies_redacted");
                        if (pending.legacyCompatibility
                            && pending.legacyCompatibility.state !== "done") {
                            throw new CoordinatorError("legacy_compatibility_cleanup_pending");
                        }
                        redactRecoveryContent(draft, pending);
                        if (migration) this.assertDeltaJournalConsistent(draft, migration);
                        pending.phase = "recovery_payloads_redacted";
                        pending.updatedAt = timestamp;
                        delete pending.lastErrorCode;
                        return pending.id;
                    });
                });
                if (!result.ok) return result;
                continue;
            }

            if (operation.phase === "recovery_payloads_redacted") {
                const result = await this.runDomainMutation(async () => {
                    return this.repository.transact((draft) => {
                        this.assertMutationEnvelope(draft, timestamp);
                        const pending = requireForgetOperation(
                            draft,
                            operationId,
                            "recovery_payloads_redacted",
                        );
                        assertForgetContentRedacted(draft, pending);
                        pending.phase = "projections_reconciled";
                        pending.updatedAt = timestamp;
                        delete pending.lastErrorCode;
                        return pending.id;
                    });
                });
                if (!result.ok) return result;
                continue;
            }

            const finalized = await this.runDomainMutation(async () => {
                return this.repository.transact((draft) => {
                    const migration = this.assertMutationEnvelope(draft, timestamp);
                    const pending = requireForgetOperation(draft, operationId, "projections_reconciled");
                    assertForgetContentRedacted(draft, pending);
                    const claim = this.requireClaimInScope(draft, pending.claimId);
                    delete claim.activeRevisionId;
                    delete claim.legacyCompatibility;
                    claim.lifecycle = "forgotten_tombstone";
                    claim.applicability = { kind: "whole_vault" };
                    claim.updatedAt = timestamp;
                    const event: MemoryChangeEvent = {
                        id: forgetEventId(operationId),
                        claimId: claim.id,
                        kind: "forget",
                        scopeKey: partitionScopeKey(pending.partition),
                        effect: claim.effect,
                        occurredAt: timestamp,
                    };
                    if (draft.changeEvents.some((candidate) => candidate.id === event.id)) {
                        throw new CoordinatorError("forget_event_collision");
                    }
                    draft.changeEvents.push(event);
                    if (migration) {
                        this.appendTextFreeClaimRemovalDelta(draft, migration, claim, timestamp);
                    }
                    draft.pendingOperations = draft.pendingOperations.filter(
                        (candidate) => candidate.id !== pending.id,
                    );
                    return { claimId: claim.id, eventId: event.id };
                });
            });
            return finalized;
        }
        return failure("forget_retry_required", true);
    }

    private redactClaimAndRecoveryForForget(
        draft: DeviceMemoryGovernanceStateV1,
        pending: MemoryForgetOperation,
    ): void {
        const claim = this.requireClaimInScope(draft, pending.claimId);
        delete claim.activeRevisionId;
        claim.applicability = { kind: "whole_vault" };
        draft.revisions = draft.revisions.filter(
            (revision) => revision.claimId !== claim.id,
        );
        draft.pendingOperations = draft.pendingOperations.filter(
            (candidate) => candidate.kind === "forget" || candidate.claimId !== claim.id,
        );
        for (const target of pending.targets) {
            const link = draft.projectionLinks.find(
                (candidate) => candidate.id === target.projectionLinkId
                    && candidate.claimId === pending.claimId,
            );
            if (link?.target.kind !== "review_queue") continue;
            const itemId = link.target.itemId;
            draft.memoryQueueItems = draft.memoryQueueItems.filter(
                (item) => item.id !== itemId,
            );
            link.state = "redacted";
            target.state = "done";
        }
        redactRecoveryContent(draft, pending);
    }

    private async replanLegacyCompatibilityForget(
        operationId: string,
        sourceHashInput: string,
        timestamp: string,
        preparedPlan?: {
            expectedSourceHash: string;
            resultingSourceHash: string;
        },
    ): Promise<MemoryGovernanceCoordinatorResult<string>> {
        const sourceHash = sourceHashInput.trim();
        if (!sourceHash) {
            await this.recordForgetFailure(
                operationId,
                "legacy_compatibility_source_changed",
                timestamp,
            );
            return failure("legacy_compatibility_source_changed", true);
        }
        return this.runDomainMutation(async () => {
            return this.repository.transact((draft) => {
                const pending = requireForgetOperation(
                    draft,
                    operationId,
                    "linked_copies_redacted",
                );
                const current = pending.legacyCompatibility;
                if (!current) {
                    throw new CoordinatorError("legacy_compatibility_plan_changed");
                }
                if (preparedPlan) {
                    if (current.state !== "prepared"
                        || current.expectedSourceHash !== preparedPlan.expectedSourceHash
                        || current.resultingSourceHash !== preparedPlan.resultingSourceHash) {
                        throw new CoordinatorError("legacy_compatibility_plan_changed");
                    }
                    current.state = "pending";
                    delete current.expectedSourceHash;
                    delete current.resultingSourceHash;
                    delete current.preservePendingReconciliation;
                } else if (current.state !== "pending") {
                    throw new CoordinatorError("legacy_compatibility_plan_changed");
                }
                const migration = draft.migrationStates[this.opaqueVaultKey];
                const trustedSourceHash = migration?.legacySourceStateHash
                    ?? migration?.sourceHash;
                if (!migration || migration.phase !== "compatibility" || !trustedSourceHash) {
                    throw new CoordinatorError("legacy_compatibility_state_unavailable");
                }
                if (sourceHash === trustedSourceHash) {
                    delete migration.pendingLegacySourceHash;
                } else {
                    migration.pendingLegacySourceHash = sourceHash;
                }
                delete migration.lastErrorCode;
                pending.attemptCount += 1;
                pending.updatedAt = timestamp;
                delete pending.lastErrorCode;
                return pending.id;
            });
        });
    }

    private async recordForgetFailure(
        operationId: string,
        errorCode: string,
        timestamp: string,
    ): Promise<void> {
        await this.repository.transact((draft) => {
            const operation = draft.pendingOperations.find(
                (candidate): candidate is MemoryForgetOperation => (
                    candidate.kind === "forget" && candidate.id === operationId
                ),
            );
            if (!operation) return;
            operation.attemptCount += 1;
            operation.updatedAt = timestamp;
            operation.lastErrorCode = errorCode;
        });
    }

    private createUndoableEvent(
        draft: DeviceMemoryGovernanceStateV1,
        claim: GovernedMemoryClaim,
        kind: "auto_remove" | "correct" | "pause" | "resume" | "change_scope",
        eventId: string,
        snapshotId: string,
        occurredAt: string,
    ): MemoryChangeEvent {
        const expiresAt = new Date(Date.parse(occurredAt) + UNDO_RETENTION_MS).toISOString();
        invalidatePriorUndoSnapshots(draft, claim.id);
        const event: MemoryChangeEvent = {
            id: eventId,
            claimId: claim.id,
            kind,
            scopeKey: partitionScopeKey(claim.partition),
            effect: claim.effect,
            occurredAt,
            undoSnapshotId: snapshotId,
        };
        const snapshot: MemoryUndoSnapshot = {
            id: snapshotId,
            claimId: claim.id,
            eventId,
            partition: clonePartition(claim.partition),
            claim: cloneClaim(claim),
            revisions: draft.revisions
                .filter((revision) => revision.claimId === claim.id)
                .map(cloneRevision),
            projectionLinks: draft.projectionLinks
                .filter((link) => link.claimId === claim.id)
                .map(cloneProjectionLink),
            createdAt: occurredAt,
            expiresAt,
        };
        draft.changeEvents.push(event);
        draft.undoSnapshots.push(snapshot);
        return event;
    }

    private scheduleProfileProjectionRemovalOperations(
        draft: DeviceMemoryGovernanceStateV1,
        claimId: string,
        occurredAt: string,
        operationSeed: string,
        includeRedacted: boolean,
    ): void {
        const links = draft.projectionLinks.filter((link) => (
            link.claimId === claimId
            && link.target.kind === "type_a_profile"
            && (includeRedacted || link.state === "active")
        ));
        for (const link of links) {
            if (link.target.kind !== "type_a_profile") continue;
            const operationId = `profile-projection-remove:${operationSeed}:${link.id}`;
            const existing = draft.pendingOperations.find((operation) => operation.id === operationId);
            if (existing) {
                if (existing.kind !== "profile_projection"
                    || existing.action !== "remove"
                    || existing.claimId !== claimId
                    || existing.profileRecordId !== link.target.profileRecordId
                    || existing.projectionLinkId !== link.id
                    || existing.ownerVaultKey !== this.opaqueVaultKey) {
                    throw new CoordinatorError("profile_projection_operation_collision");
                }
                continue;
            }
            draft.pendingOperations.push({
                id: operationId,
                kind: "profile_projection",
                action: "remove",
                claimId,
                profileRecordId: link.target.profileRecordId,
                projectionLinkId: link.id,
                ownerVaultKey: this.opaqueVaultKey,
                state: "pending",
                attemptCount: 0,
                createdAt: occurredAt,
                updatedAt: occurredAt,
            });
        }
    }

    private appendCompatibilityClaimDelta(
        draft: DeviceMemoryGovernanceStateV1,
        migration: MemoryMigrationState | null,
        claim: GovernedMemoryClaim,
        revision: MemoryClaimRevision,
        payloadEntryId: string,
        occurredAt: string,
    ): void {
        if (!migration) return;
        const partition: MemoryPartitionKey = { kind: "vault", key: this.opaqueVaultKey };
        const rawValue: LegacyRollbackValue = {
            kind: "claim",
            record: buildLegacyClaimProjection(draft, migration, claim, revision, occurredAt),
        };
        // Persistence adds canonical optional fields (for example paths/tags
        // and source-ref arrays). Checksum exactly the normalized typed value
        // that will survive a repository round trip.
        const value = canonicalizeLegacyRollbackValue(rawValue);
        const checksum = checksumLegacyRollbackValue(value);
        const sequence = this.nextDeltaSequence(draft, migration);
        const entry: MemoryRollbackPayloadEntry = {
            id: payloadEntryId,
            migrationRunId: migration.migrationRunId,
            partition,
            entityId: claim.id,
            value,
            checksum,
            expiresAt: requireRollbackExpiry(migration, occurredAt),
        };
        draft.rollbackPayloadEntries.push(entry);
        draft.migrationDeltas.push({
            sequence,
            migrationRunId: migration.migrationRunId,
            partition,
            committedAt: occurredAt,
            kind: "claim_changed",
            entityId: claim.id,
            payloadEntryId: entry.id,
            payloadChecksum: checksum,
        });
    }

    private appendTextFreeQueueRemovalDelta(
        draft: DeviceMemoryGovernanceStateV1,
        migration: MemoryMigrationState,
        item: DeviceMemoryQueueItem,
        occurredAt: string,
    ): void {
        const sequence = this.nextDeltaSequence(draft, migration);
        draft.migrationDeltas.push({
            sequence,
            migrationRunId: migration.migrationRunId,
            partition: clonePartition(item.partition),
            committedAt: occurredAt,
            kind: "queue_removed",
            entityId: item.id,
        });
    }

    private appendTextFreeClaimRemovalDelta(
        draft: DeviceMemoryGovernanceStateV1,
        migration: MemoryMigrationState,
        claim: GovernedMemoryClaim,
        occurredAt: string,
        kind: "claim_forgotten" | "claim_removed" = "claim_forgotten",
    ): void {
        const sequence = this.nextDeltaSequence(draft, migration);
        draft.migrationDeltas.push({
            sequence,
            migrationRunId: migration.migrationRunId,
            partition: { kind: "vault", key: this.opaqueVaultKey },
            committedAt: occurredAt,
            kind,
            entityId: claim.id,
        });
    }

    private nextDeltaSequence(
        draft: DeviceMemoryGovernanceStateV1,
        migration: MemoryMigrationState,
    ): number {
        return this.assertDeltaJournalConsistent(draft, migration) + 1;
    }

    private assertDeltaJournalConsistent(
        draft: DeviceMemoryGovernanceStateV1,
        migration: MemoryMigrationState,
    ): number {
        const deltas = draft.migrationDeltas
            .filter((delta) => delta.migrationRunId === migration.migrationRunId)
            .sort((left, right) => left.sequence - right.sequence);
        deltas.forEach((delta, index) => {
            if (delta.sequence !== index + 1
                || delta.partition.kind !== "vault"
                || delta.partition.key !== this.opaqueVaultKey) {
                throw new CoordinatorError("migration_delta_journal_invalid");
            }
        });
        const lastSequence = deltas.at(-1)?.sequence ?? 0;
        return lastSequence;
    }

    private assertMutationEnvelope(
        draft: DeviceMemoryGovernanceStateV1,
        occurredAt: string,
    ): MemoryMigrationState | null {
        if (!this.opaqueVaultKey) throw new CoordinatorError("invalid_vault_key");
        const policy = draft.policyStates[this.opaqueVaultKey];
        if (!policy || policy.contextProjectionMode !== "governed") {
            throw new CoordinatorError("governed_context_required");
        }
        const migration = draft.migrationStates[this.opaqueVaultKey];
        if (!migration) return null;
        if (migration.phase === "rolling_back") {
            throw new CoordinatorError("migration_rolling_back");
        }
        if (migration.phase === "finalized") return null;
        if (migration.phase !== "compatibility") {
            throw new CoordinatorError("migration_phase_blocks_mutation");
        }
        if (!migration.rollbackExpiresAt || !isUnexpired(migration.rollbackExpiresAt, occurredAt)) {
            // The seven-day rollback journal is a temporary compatibility
            // guarantee, not a lifetime limit on user control. Once it
            // expires, governed state remains authoritative and lifecycle
            // mutations continue without creating unreplayable legacy deltas.
            return null;
        }
        this.assertDeltaJournalConsistent(draft, migration);
        return migration;
    }

    private requireClaimInScope(
        draft: DeviceMemoryGovernanceStateV1,
        claimId: string,
    ): GovernedMemoryClaim {
        const claim = draft.claims.find((candidate) => candidate.id === claimId);
        if (!claim) throw new CoordinatorError("claim_not_found");
        if (!this.partitionIsInScope(claim.partition)) {
            throw new CoordinatorError("claim_not_in_scope");
        }
        return claim;
    }

    private partitionIsInScope(partition: MemoryPartitionKey): boolean {
        return partition.kind === "device_collaboration"
            || (partition.kind === "vault" && partition.key === this.opaqueVaultKey);
    }

    private requireActiveRevision(
        draft: DeviceMemoryGovernanceStateV1,
        claim: GovernedMemoryClaim,
    ): MemoryClaimRevision {
        if (!claim.activeRevisionId) throw new CoordinatorError("active_revision_missing");
        const revision = draft.revisions.find(
            (candidate) => candidate.id === claim.activeRevisionId && candidate.claimId === claim.id,
        );
        if (!revision) throw new CoordinatorError("active_revision_missing");
        return revision;
    }

    private assertNoPendingOperation(
        draft: DeviceMemoryGovernanceStateV1,
        claimId: string,
    ): void {
        if (draft.pendingOperations.some((operation) => operation.claimId === claimId
            && (operation.kind === "forget" || operation.state === "pending"))) {
            throw new CoordinatorError("claim_operation_pending");
        }
    }

    private assertPotentialUseEffect(
        claim: GovernedMemoryClaim,
        revision: MemoryClaimRevision,
        requireCurrentAuthority: boolean,
    ): void {
        if (claim.effect !== "future_answers" && claim.effect !== "collaboration_default") {
            throw new CoordinatorError("no_effect");
        }
        if (claim.sensitivity !== "low" || !isUsableScope(claim.applicability)
            || revision.provenance.length === 0) {
            throw new CoordinatorError("no_effect");
        }
        if (claim.partition.kind === "vault" && claim.partition.key !== this.opaqueVaultKey) {
            throw new CoordinatorError("claim_not_in_scope");
        }
        if (claim.partition.kind === "device_collaboration" && (
            claim.partition.key !== "device"
            || claim.effect !== "collaboration_default"
            || claim.applicability.kind !== "whole_vault"
        )) {
            throw new CoordinatorError("no_effect");
        }
        if (requireCurrentAuthority && claim.effect === "collaboration_default"
            && revision.authority !== "explicit_user"
            && revision.authority !== "user_correction") {
            throw new CoordinatorError("no_effect");
        }
    }

    private assertGovernableClaim(
        claim: GovernedMemoryClaim,
        revision: MemoryClaimRevision,
    ): void {
        if (!isUsableScope(claim.applicability) || revision.provenance.length === 0) {
            throw new CoordinatorError("claim_not_governable");
        }
        if (claim.partition.kind === "vault" && claim.partition.key !== this.opaqueVaultKey) {
            throw new CoordinatorError("claim_not_in_scope");
        }
        if (claim.partition.kind === "device_collaboration" && (
            claim.partition.key !== "device"
            || claim.effect !== "collaboration_default"
            || claim.applicability.kind !== "whole_vault"
        )) {
            throw new CoordinatorError("claim_not_governable");
        }
    }

    private assertScopeTransitionAllowed(
        claim: GovernedMemoryClaim,
        revision: MemoryClaimRevision,
        partition: MemoryPartitionKey,
        applicability: ReviewQueueScope,
        explicitDeviceScope: boolean,
    ): void {
        if (partition.kind === "vault") {
            if (partition.key !== this.opaqueVaultKey) {
                throw new CoordinatorError("cross_vault_scope_forbidden");
            }
            return;
        }
        if (!explicitDeviceScope
            || partition.key !== "device"
            || claim.memoryType !== "preference"
            || claim.sensitivity !== "low"
            || applicability.kind !== "whole_vault"
            || (revision.authority !== "explicit_user" && revision.authority !== "user_correction")
            || revision.provenance.length === 0
            || revision.provenance.some((entry) => (
                entry.kind !== "conversation" && entry.kind !== "explicit_setting"
            ))) {
            throw new CoordinatorError("explicit_device_scope_required");
        }
    }

    private runDomainMutation<T>(
        operation: () => Promise<T>,
    ): Promise<MemoryGovernanceCoordinatorResult<T>> {
        return operation().then(
            (value) => ({ ok: true, value }),
            (error: unknown) => {
                if (error instanceof CoordinatorError) return failure(error.code);
                throw error;
            },
        );
    }

    private serialize<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.mutationTail.then(operation, operation);
        this.mutationTail = result.then(() => undefined, () => undefined);
        return result;
    }

    private nowIso(): string {
        const now = this.now();
        if (!Number.isFinite(now.getTime())) throw new CoordinatorError("invalid_clock");
        return now.toISOString();
    }
}

function receipt(
    claimId: string,
    event: MemoryChangeEvent,
): MemoryGovernanceActionReceipt {
    return {
        claimId,
        eventId: event.id,
        ...(event.undoSnapshotId ? {
            undoExpiresAt: new Date(Date.parse(event.occurredAt) + UNDO_RETENTION_MS).toISOString(),
        } : {}),
    };
}

function failure<T = never>(
    reason: string,
    pending = false,
): MemoryGovernanceCoordinatorResult<T> {
    return { ok: false, reason, ...(pending ? { pending: true } : {}) };
}

function clonePartition(partition: MemoryPartitionKey): MemoryPartitionKey {
    return partition.kind === "vault"
        ? { kind: "vault", key: partition.key }
        : { kind: "device_collaboration", key: "device" };
}

function cloneClaim(claim: GovernedMemoryClaim): GovernedMemoryClaim {
    return {
        ...claim,
        partition: clonePartition(claim.partition),
        applicability: cloneScope(claim.applicability),
        ...(claim.legacyCompatibility ? {
            legacyCompatibility: {
                recordIdFingerprints: [...claim.legacyCompatibility.recordIdFingerprints],
                memoryQueueItemIdFingerprints: [
                    ...claim.legacyCompatibility.memoryQueueItemIdFingerprints,
                ],
            },
        } : {}),
    };
}

function cloneRevision(revision: MemoryClaimRevision): MemoryClaimRevision {
    return {
        ...revision,
        provenance: cloneProvenance(revision.provenance),
    };
}

function cloneProjectionLink(link: MemoryProjectionLink): MemoryProjectionLink {
    return {
        ...link,
        target: { ...link.target },
    };
}

interface SuppressionFingerprintPair {
    sourceFingerprintId: string;
    ruleFingerprint: string;
}

function collectActiveClaimFingerprints(
    state: DeviceMemoryGovernanceStateV1,
    claim: GovernedMemoryClaim,
): SuppressionFingerprintPair[] {
    const pairs = new Map<string, SuppressionFingerprintPair>();
    for (const link of state.projectionLinks) {
        if (link.claimId !== claim.id || link.state !== "active") continue;
        const sourceFingerprintId = link.sourceFingerprintId?.trim();
        const ruleFingerprint = link.ruleFingerprint?.trim();
        if (!sourceFingerprintId || !ruleFingerprint) continue;
        pairs.set(`${sourceFingerprintId}\u0000${ruleFingerprint}`, {
            sourceFingerprintId,
            ruleFingerprint,
        });
    }
    return [...pairs.values()];
}

function addSuppressionMarkers(
    state: DeviceMemoryGovernanceStateV1,
    partition: MemoryPartitionKey,
    fingerprints: readonly SuppressionFingerprintPair[],
    reason: "forgotten" | "rejected" | "corrected",
    occurredAt: string,
    idFactory: () => string,
): void {
    for (const fingerprint of fingerprints) {
        const existing = state.suppressionMarkers.find((marker) => (
            partitionsEqual(marker.partition, partition)
            && marker.sourceFingerprintId === fingerprint.sourceFingerprintId
            && marker.ruleFingerprint === fingerprint.ruleFingerprint
            && marker.reason === reason
        ));
        if (existing) continue;
        state.suppressionMarkers.push({
            id: idFactory(),
            partition: clonePartition(partition),
            sourceFingerprintId: fingerprint.sourceFingerprintId,
            ruleFingerprint: fingerprint.ruleFingerprint,
            reason,
            createdAt: occurredAt,
            updatedAt: occurredAt,
        });
    }
}

function legacyTypeATargetFingerprints(
    state: DeviceMemoryGovernanceStateV1,
    claimId: string,
    opaqueVaultKey: string,
): SuppressionFingerprintPair[] {
    const pairs = new Map<string, SuppressionFingerprintPair>();
    for (const link of state.projectionLinks) {
        if (link.claimId !== claimId
            || link.target.kind !== "type_a_profile"
            || link.ruleFingerprint !== LEGACY_TYPE_A_ADOPTION_RULE_FINGERPRINT) continue;
        const sourceFingerprintId = createTypeATargetSuppressionFingerprint(
            opaqueVaultKey,
            link.target.profileRecordId,
        );
        pairs.set(sourceFingerprintId, {
            sourceFingerprintId,
            ruleFingerprint: TYPE_A_TARGET_SUPPRESSION_RULE_FINGERPRINT,
        });
    }
    return [...pairs.values()];
}

function addLegacyTypeATargetSuppressionMarkers(
    state: DeviceMemoryGovernanceStateV1,
    claim: GovernedMemoryClaim,
    opaqueVaultKey: string,
    reason: "forgotten" | "corrected",
    occurredAt: string,
    idFactory: () => string,
): void {
    addSuppressionMarkers(
        state,
        claim.partition,
        legacyTypeATargetFingerprints(state, claim.id, opaqueVaultKey),
        reason,
        occurredAt,
        idFactory,
    );
}

function replaceActiveClaimFingerprints(
    state: DeviceMemoryGovernanceStateV1,
    claimId: string,
    sourceFingerprintId: string,
    ruleFingerprint: string,
): void {
    for (const link of state.projectionLinks) {
        if (link.claimId !== claimId || link.state !== "active") continue;
        link.sourceFingerprintId = sourceFingerprintId;
        link.ruleFingerprint = ruleFingerprint;
    }
}

function removeCorrectionSuppressionMarkers(
    state: DeviceMemoryGovernanceStateV1,
    snapshot: Extract<MemoryUndoSnapshot, { restoreMode?: "restore_existing" }>,
    correctionOccurredAt: string,
    opaqueVaultKey: string,
): void {
    const pairs = new Set([
        ...snapshot.projectionLinks
            .filter((link) => link.state === "active"
                && Boolean(link.sourceFingerprintId?.trim())
                && Boolean(link.ruleFingerprint?.trim()))
            .map((link) => `${link.sourceFingerprintId!.trim()}\u0000${link.ruleFingerprint!.trim()}`),
        ...legacyTypeATargetFingerprints(
            { ...state, projectionLinks: snapshot.projectionLinks },
            snapshot.claim.id,
            opaqueVaultKey,
        ).map((pair) => `${pair.sourceFingerprintId}\u0000${pair.ruleFingerprint}`),
    ]);
    state.suppressionMarkers = state.suppressionMarkers.filter((marker) => !(
        marker.reason === "corrected"
        && marker.createdAt === correctionOccurredAt
        && partitionsEqual(marker.partition, snapshot.partition)
        && pairs.has(`${marker.sourceFingerprintId}\u0000${marker.ruleFingerprint}`)
    ));
}

function cloneProvenance(
    provenance: readonly PersistedMemoryProvenance[],
): PersistedMemoryProvenance[] {
    return provenance.map((entry) => {
        if (entry.kind === "note") {
            return { kind: "note", sourceRef: cloneSourceRef(entry.sourceRef) };
        }
        if (entry.kind === "conversation") {
            return {
                kind: "conversation",
                conversationIds: [...entry.conversationIds],
                observedAt: entry.observedAt,
            };
        }
        if (entry.kind === "explicit_setting") return { ...entry };
        return {
            ...entry,
            representativeSourceRefs: entry.representativeSourceRefs.map(cloneSourceRef),
        };
    });
}

function scheduleProfileProjectionOperations(
    draft: DeviceMemoryGovernanceStateV1,
    claim: GovernedMemoryClaim,
    revision: MemoryClaimRevision,
    occurredAt: string,
): void {
    const profileLinks = draft.projectionLinks.filter((link) => (
        link.claimId === claim.id
        && link.state === "active"
        && link.target.kind === "type_a_profile"
    ));
    for (const link of profileLinks) {
        const profileRecordId = link.target.kind === "type_a_profile"
            ? link.target.profileRecordId
            : "";
        const operationId = `profile-projection:${revision.id}:${link.id}`;
        const existing = draft.pendingOperations.find((operation) => operation.id === operationId);
        if (existing) {
            if (existing.kind !== "profile_projection"
                || existing.action === "remove"
                || existing.claimId !== claim.id
                || existing.profileRecordId !== profileRecordId
                || existing.targetRevisionId !== revision.id) {
                throw new CoordinatorError("profile_projection_collision");
            }
            existing.state = "pending";
            existing.updatedAt = occurredAt;
            delete existing.lastErrorCode;
            continue;
        }
        draft.pendingOperations.push({
            id: operationId,
            kind: "profile_projection",
            claimId: claim.id,
            profileRecordId,
            targetRevisionId: revision.id,
            state: "pending",
            attemptCount: 0,
            createdAt: occurredAt,
            updatedAt: occurredAt,
        });
    }
}

function replaceClaimRevisions(
    draft: DeviceMemoryGovernanceStateV1,
    claimId: string,
    revisions: readonly MemoryClaimRevision[],
): void {
    draft.revisions = [
        ...draft.revisions.filter((revision) => revision.claimId !== claimId),
        ...revisions.map(cloneRevision),
    ];
}

function replaceClaimLinks(
    draft: DeviceMemoryGovernanceStateV1,
    claimId: string,
    links: readonly MemoryProjectionLink[],
): void {
    draft.projectionLinks = [
        ...draft.projectionLinks.filter((link) => link.claimId !== claimId),
        ...links.map(cloneProjectionLink),
    ];
}

function isUsableScope(scope: ReviewQueueScope): boolean {
    if (!scope || typeof scope.kind !== "string") return false;
    if (scope.label !== undefined && typeof scope.label !== "string") return false;
    if (scope.paths !== undefined && (!Array.isArray(scope.paths)
        || scope.paths.some((path) => typeof path !== "string" || !path.trim()))) return false;
    if (scope.tags !== undefined && (!Array.isArray(scope.tags)
        || scope.tags.some((tag) => typeof tag !== "string" || !tag.trim()))) return false;
    switch (scope.kind) {
        case "whole_vault": return true;
        case "current_note":
        case "selected_notes":
        case "folder": return Boolean(scope.paths?.length);
        case "tag": return Boolean(scope.tags?.length);
        case "custom": return false;
        default: return false;
    }
}

function scopesEqual(left: ReviewQueueScope, right: ReviewQueueScope): boolean {
    return JSON.stringify(canonicalScope(left)) === JSON.stringify(canonicalScope(right));
}

function canonicalScope(scope: ReviewQueueScope): ReviewQueueScope {
    return {
        kind: scope.kind,
        ...(scope.label !== undefined ? { label: scope.label } : {}),
        ...(scope.paths !== undefined ? { paths: [...scope.paths] } : {}),
        ...(scope.tags !== undefined ? { tags: [...scope.tags] } : {}),
    };
}

function partitionsEqual(left: MemoryPartitionKey, right: MemoryPartitionKey): boolean {
    return left.kind === right.kind && left.key === right.key;
}

function projectionLinksEqual(left: MemoryProjectionLink, right: MemoryProjectionLink): boolean {
    return left.id === right.id
        && left.claimId === right.claimId
        && left.relation === right.relation
        && left.state === right.state
        && left.sourceFingerprintId === right.sourceFingerprintId
        && left.ruleFingerprint === right.ruleFingerprint
        && left.createdAt === right.createdAt
        && JSON.stringify(left.target) === JSON.stringify(right.target);
}

function invalidatePriorUndoSnapshots(state: DeviceMemoryGovernanceStateV1, claimId: string): void {
    const obsoleteIds = new Set(state.undoSnapshots
        .filter((snapshot) => snapshot.claimId === claimId)
        .map((snapshot) => snapshot.id));
    if (obsoleteIds.size === 0) return;
    state.undoSnapshots = state.undoSnapshots.filter((snapshot) => !obsoleteIds.has(snapshot.id));
    for (const event of state.changeEvents) {
        if (event.undoSnapshotId && obsoleteIds.has(event.undoSnapshotId)) delete event.undoSnapshotId;
    }
}

function partitionScopeKey(partition: MemoryPartitionKey): string {
    return partition.kind === "vault" ? partition.key : "device";
}

function requireRollbackExpiry(migration: MemoryMigrationState, occurredAt: string): string {
    if (!migration.rollbackExpiresAt || !isUnexpired(migration.rollbackExpiresAt, occurredAt)) {
        throw new CoordinatorError("rollback_window_expired");
    }
    return migration.rollbackExpiresAt;
}

function isUnexpired(expiresAt: string, now: string): boolean {
    const expiry = Date.parse(expiresAt);
    const current = Date.parse(now);
    return Number.isFinite(expiry) && Number.isFinite(current) && expiry >= current;
}

function isExpiredForGarbageCollection(expiresAt: string, now: string): boolean {
    const expiry = Date.parse(expiresAt);
    const current = Date.parse(now);
    return !Number.isFinite(expiry) || !Number.isFinite(current) || expiry < current;
}

function requireForgetOperation(
    draft: DeviceMemoryGovernanceStateV1,
    operationId: string,
    phase: MemoryForgetOperation["phase"],
): MemoryForgetOperation {
    const operation = draft.pendingOperations.find(
        (candidate): candidate is MemoryForgetOperation => (
            candidate.kind === "forget" && candidate.id === operationId
        ),
    );
    if (!operation) throw new CoordinatorError("forget_operation_missing");
    if (operation.phase !== phase) throw new CoordinatorError("forget_phase_changed");
    return operation;
}

function forgetEventId(operationId: string): string {
    return `forget-event:${operationId}`;
}

function redactRecoveryContent(
    draft: DeviceMemoryGovernanceStateV1,
    operation: MemoryForgetOperation,
): void {
    const exactRecoveryEntityIds = collectForgetRecoveryEntityIds(draft, operation);
    const snapshotIds = new Set(
        draft.undoSnapshots
            .filter((snapshot) => snapshot.claimId === operation.claimId)
            .map((snapshot) => snapshot.id),
    );
    draft.undoSnapshots = draft.undoSnapshots.filter(
        (snapshot) => snapshot.claimId !== operation.claimId,
    );
    for (const event of draft.changeEvents) {
        if (event.undoSnapshotId && snapshotIds.has(event.undoSnapshotId)) {
            delete event.undoSnapshotId;
        }
    }

    const payloadIds = new Set<string>();
    for (const delta of draft.migrationDeltas) {
        if (!exactRecoveryEntityIds.has(delta.entityId)) continue;
        if (delta.payloadEntryId) payloadIds.add(delta.payloadEntryId);
        delta.kind = delta.entityId === operation.claimId ? "claim_forgotten" : "queue_removed";
        delete delta.payloadEntryId;
        delete delta.payloadChecksum;
    }
    draft.rollbackPayloadEntries = draft.rollbackPayloadEntries.filter((entry) => (
        !exactRecoveryEntityIds.has(entry.entityId) && !payloadIds.has(entry.id)
    ));
}

function collectForgetRecoveryEntityIds(
    state: DeviceMemoryGovernanceStateV1,
    operation: MemoryForgetOperation,
): Set<string> {
    const exactRecoveryEntityIds = new Set<string>([operation.claimId]);
    for (const target of operation.targets) {
        const link = state.projectionLinks.find(
            (candidate) => candidate.id === target.projectionLinkId
                && candidate.claimId === operation.claimId,
        );
        if (link?.target.kind === "review_queue") {
            exactRecoveryEntityIds.add(link.target.itemId);
        }
    }
    return exactRecoveryEntityIds;
}

function forgetNeedsLocalRedaction(
    state: DeviceMemoryGovernanceStateV1,
    operation: MemoryForgetOperation,
): boolean {
    const claim = state.claims.find((candidate) => candidate.id === operation.claimId);
    if (claim && (claim.activeRevisionId !== undefined
        || claim.applicability.kind !== "whole_vault")) {
        return true;
    }
    if (state.revisions.some((revision) => revision.claimId === operation.claimId)
        || state.undoSnapshots.some((snapshot) => snapshot.claimId === operation.claimId)
        || state.pendingOperations.some((candidate) => (
            candidate.kind !== "forget" && candidate.claimId === operation.claimId
        ))) {
        return true;
    }

    for (const target of operation.targets) {
        const link = state.projectionLinks.find(
            (candidate) => candidate.id === target.projectionLinkId
                && candidate.claimId === operation.claimId,
        );
        if (link?.target.kind !== "review_queue") continue;
        const itemId = link.target.itemId;
        if (target.state !== "done" || link.state !== "redacted"
            || state.memoryQueueItems.some((item) => item.id === itemId)) {
            return true;
        }
    }

    const exactRecoveryEntityIds = collectForgetRecoveryEntityIds(state, operation);
    for (const delta of state.migrationDeltas) {
        if (!exactRecoveryEntityIds.has(delta.entityId)) continue;
        if (delta.payloadEntryId !== undefined || delta.payloadChecksum !== undefined) return true;
    }
    return state.rollbackPayloadEntries.some((entry) => exactRecoveryEntityIds.has(entry.entityId));
}

function assertForgetContentRedacted(
    draft: DeviceMemoryGovernanceStateV1,
    operation: MemoryForgetOperation,
): void {
    if (operation.legacyCompatibility && operation.legacyCompatibility.state !== "done") {
        throw new CoordinatorError("legacy_compatibility_cleanup_pending");
    }
    if (draft.revisions.some((revision) => revision.claimId === operation.claimId)) {
        throw new CoordinatorError("forget_revision_not_redacted");
    }
    const claim = draft.claims.find((candidate) => candidate.id === operation.claimId);
    if (!claim || claim.activeRevisionId !== undefined || claim.applicability.kind !== "whole_vault") {
        throw new CoordinatorError("forget_claim_not_redacted");
    }
    if (draft.undoSnapshots.some((snapshot) => snapshot.claimId === operation.claimId)) {
        throw new CoordinatorError("forget_snapshot_not_redacted");
    }
    if (draft.rollbackPayloadEntries.some((entry) => entry.entityId === operation.claimId)) {
        throw new CoordinatorError("forget_rollback_not_redacted");
    }
    if (draft.migrationDeltas.some((delta) => delta.entityId === operation.claimId
        && (delta.payloadEntryId !== undefined || delta.payloadChecksum !== undefined))) {
        throw new CoordinatorError("forget_delta_not_redacted");
    }
    for (const target of operation.targets) {
        if (target.state !== "done") throw new CoordinatorError("forget_target_not_redacted");
        const link = draft.projectionLinks.find(
            (candidate) => candidate.id === target.projectionLinkId
                && candidate.claimId === operation.claimId,
        );
        if (!link || link.state !== "redacted") {
            throw new CoordinatorError("forget_link_not_redacted");
        }
        if (link.target.kind === "review_queue") {
            const itemId = link.target.itemId;
            if (draft.memoryQueueItems.some((item) => item.id === itemId)) {
                throw new CoordinatorError("forget_queue_target_not_redacted");
            }
            if (draft.rollbackPayloadEntries.some((entry) => entry.entityId === itemId)
                || draft.migrationDeltas.some((delta) => delta.entityId === itemId
                    && (delta.payloadEntryId !== undefined || delta.payloadChecksum !== undefined))) {
                throw new CoordinatorError("forget_queue_recovery_not_redacted");
            }
        }
    }
}

function buildLegacyClaimProjection(
    draft: DeviceMemoryGovernanceStateV1,
    migration: MemoryMigrationState,
    claim: GovernedMemoryClaim,
    revision: MemoryClaimRevision,
    occurredAt: string,
): ConfirmedMemoryRecord {
    const template = findLatestLegacyClaimTemplate(draft, migration, claim.id);
    const lifecycle = claim.lifecycle === "paused" || claim.lifecycle === "archived"
        ? "archived"
        : claim.lifecycle === "stale"
            ? "stale"
            : claim.lifecycle === "active"
                ? "active"
                : null;
    if (!lifecycle) throw new CoordinatorError("legacy_projection_unavailable");
    const record: ConfirmedMemoryRecord = {
        id: template?.id ?? claim.id,
        type: claim.memoryType,
        lifecycle,
        sensitivity: claim.sensitivity,
        scope: cloneScope(claim.applicability),
        summary: revision.summary,
        sourceRefs: sourceRefsFromProvenance(revision.provenance),
        createdAt: template?.createdAt ?? claim.createdAt,
        updatedAt: occurredAt,
        confirmedAt: template?.confirmedAt ?? revision.createdAt,
        ...(lifecycle === "archived" ? { archivedAt: occurredAt } : {}),
        ...(template?.validFrom !== undefined ? { validFrom: template.validFrom } : {}),
        ...(template?.validUntil !== undefined ? { validUntil: template.validUntil } : {}),
        ...(template?.lastVerified !== undefined ? { lastVerified: template.lastVerified } : {}),
        ...(template?.updatePolicy !== undefined ? { updatePolicy: template.updatePolicy } : {}),
        ...(template?.confirmationStrength !== undefined
            ? { confirmationStrength: template.confirmationStrength }
            : {}),
        ...(template?.confirmationSource !== undefined
            ? { confirmationSource: template.confirmationSource }
            : {}),
        ...(template?.originReviewQueueItemId !== undefined
            ? { originReviewQueueItemId: template.originReviewQueueItemId }
            : {}),
    };
    const validation = validateConfirmedMemoryRecord(record);
    if (!validation.ok) throw new CoordinatorError("legacy_projection_unavailable");
    return validation.value;
}

function findLatestLegacyClaimTemplate(
    draft: DeviceMemoryGovernanceStateV1,
    migration: MemoryMigrationState,
    claimId: string,
): ConfirmedMemoryRecord | undefined {
    const payloadById = new Map(
        draft.rollbackPayloadEntries
            .filter((entry) => entry.migrationRunId === migration.migrationRunId)
            .map((entry) => [entry.id, entry]),
    );
    const deltaPayloads = draft.migrationDeltas
        .filter((delta) => delta.migrationRunId === migration.migrationRunId
            && delta.entityId === claimId
            && delta.payloadEntryId)
        .sort((left, right) => right.sequence - left.sequence);
    for (const delta of deltaPayloads) {
        const entry = payloadById.get(delta.payloadEntryId!);
        if (entry?.value.kind === "claim") return entry.value.record;
    }
    const base = draft.rollbackPayloadEntries.find((entry) => (
        entry.migrationRunId === migration.migrationRunId
        && entry.entityId === claimId
        && entry.value.kind === "claim"
    ));
    return base?.value.kind === "claim" ? base.value.record : undefined;
}

function sourceRefsFromProvenance(
    provenance: readonly PersistedMemoryProvenance[],
): PersistedSourceRef[] {
    const refs: PersistedSourceRef[] = [];
    const seen = new Set<string>();
    const add = (sourceRef: PersistedSourceRef): void => {
        const cloned = cloneSourceRef(sourceRef);
        const key = JSON.stringify(cloned);
        if (seen.has(key)) return;
        seen.add(key);
        refs.push(cloned);
    };
    for (const entry of provenance) {
        if (entry.kind === "note") add(entry.sourceRef);
        if (entry.kind === "vault_aggregate") entry.representativeSourceRefs.forEach(add);
    }
    return refs;
}

function canonicalizeLegacyRollbackValue(value: LegacyRollbackValue): LegacyRollbackValue {
    const state = createEmptyDeviceMemoryGovernanceStateV1();
    const partition: MemoryPartitionKey = { kind: "vault", key: "canonical" };
    state.rollbackPayloadEntries.push({
        id: "canonical-payload",
        migrationRunId: "canonical-run",
        partition,
        entityId: "canonical-entity",
        value,
        checksum: "canonical-checksum",
        expiresAt: "9999-12-31T23:59:59.999Z",
    });
    state.migrationDeltas.push({
        sequence: 1,
        migrationRunId: "canonical-run",
        partition,
        committedAt: "1970-01-01T00:00:00.000Z",
        kind: "claim_changed",
        entityId: "canonical-entity",
        payloadEntryId: "canonical-payload",
        payloadChecksum: "canonical-checksum",
    });
    const normalized = normalizeDeviceMemoryGovernanceStateV1(state);
    const canonical = normalized?.rollbackPayloadEntries[0]?.value;
    if (!canonical) throw new CoordinatorError("rollback_payload_invalid");
    return canonical;
}
