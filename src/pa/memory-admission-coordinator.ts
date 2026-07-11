import {
    MEMORY_SENSITIVITIES,
    MEMORY_TYPES,
    REVIEW_QUEUE_SCOPE_KINDS,
    validateSourceRefPathShape,
    type MemorySensitivity,
    type MemoryType,
    type PersistedSourceRef,
    type ReviewQueueScope,
} from "./contracts";
import { cloneScope, cloneSourceRef, includesString, isRecord, stableHash } from "./helpers";
import {
    decideMemoryAdmission,
    type MemoryAdmissionDecision,
    type MemoryAdmissionPolicyInput,
} from "./memory-admission-policy";
import type {
    MemoryControlCenterAuthority,
    MemoryControlCenterEffect,
} from "./memory-control-center";
import {
    type DeviceMemoryGovernanceStateV1,
    type DeviceMemoryQueueItem,
    type GovernedMemoryClaim,
    type LegacyRollbackValue,
    type MemoryClaimRevision,
    type MemoryGovernanceRepository,
    type MemoryMigrationState,
    type MemoryPartitionKey,
    type MemoryProjectionLink,
    type MemoryQueueAdmissionEnvelope,
    type MemoryRollbackPayloadEntry,
    type MemoryUndoSnapshot,
    type PersistedMemoryProvenance,
} from "./memory-governance-persistence";
import {
    createTypeATargetSuppressionFingerprint,
    TYPE_A_TARGET_SUPPRESSION_RULE_FINGERPRINT,
} from "./memory-governance-migration-coordinator";
import { checksumLegacyRollbackValue } from "./memory-governance-rollback-checksum";
import { buildLegacyMemoryRollbackProjection } from "./memory-governance-rollback";
import {
    validateConfirmedMemoryRecord,
    type ConfirmedMemoryRecord,
} from "./memory-governance-store";
import {
    validateReviewQueueItem,
    type ReviewQueueCreateInput,
    type ReviewQueueItem,
} from "./review-queue-store";

const UNDO_RETENTION_MS = 7 * 24 * 60 * 60_000;
const AUTHORITIES = [
    "source_observation",
    "pa_inference",
    "explicit_user",
    "user_correction",
] as const satisfies readonly MemoryControlCenterAuthority[];
const EFFECTS = [
    "none",
    "stored_not_in_use",
    "retrieval_only",
    "future_answers",
    "collaboration_default",
] as const satisfies readonly MemoryControlCenterEffect[];

export interface GovernedMemoryAdmissionInput {
    policy: Omit<
        MemoryAdmissionPolicyInput,
        "reversibility" | "suppression" | "changeEventSupport" | "recoverySupport" | "atomicCommitSupport"
    >;
    summary: string;
    memoryType: MemoryType;
    sensitivity: MemorySensitivity;
    authority: MemoryControlCenterAuthority;
    effect: MemoryControlCenterEffect;
    applicability: ReviewQueueScope;
    provenance: PersistedMemoryProvenance[];
    sourceFingerprintId: string;
    ruleFingerprint: string;
    admissionKey: string;
    queueInput: ReviewQueueCreateInput;
    profileRecordId?: string;
    /** Required for Type-A; compared transactionally before any durable write. */
    expectedTargetState?: TypeATargetGeneration;
}

export type TypeATargetGeneration =
    | { state: "absent"; profileRecordId: string }
    | {
        state: "present";
        profileRecordId: string;
        claimId: string;
        activeRevisionId: string | null;
        lifecycle: GovernedMemoryClaim["lifecycle"];
        latestChangeEventId: string | null;
    };

export interface TypeAAdmissionBaseline {
    version: 1;
    capturedCommitSequence: number;
    targets: Record<string, TypeATargetGeneration>;
}

export interface GovernedMemoryAdmissionReceipt {
    decision: MemoryAdmissionDecision;
    claimId?: string;
    queueItem?: ReviewQueueItem;
}

export interface GovernedMemoryConfirmationReceipt {
    claimId: string;
    queueItem: ReviewQueueItem;
}

export interface GovernedMemoryDismissalReceipt {
    markerId: string;
    queueItem: ReviewQueueItem;
}

export type MemoryAdmissionCoordinatorResult<T> =
    | { ok: true; value: T }
    | { ok: false; reason: string };

export interface MemoryAdmissionCoordinatorOptions {
    repository: MemoryGovernanceRepository;
    opaqueVaultKey: string;
    now?: () => Date;
    idFactory?: () => string;
}

type PersistedAdmissionEnvelope = MemoryQueueAdmissionEnvelope;

class AdmissionError extends Error {
    constructor(readonly code: string) {
        super(`Memory admission failed: ${code}`);
        this.name = "AdmissionError";
    }
}

/**
 * Atomic effect-admission boundary for Type-A and Memory Candidate producers.
 * The policy decision and suppression recheck run inside the repository
 * transaction so an unchanged forgotten source cannot race back into use.
 */
export class MemoryAdmissionCoordinator {
    private readonly repository: MemoryGovernanceRepository;
    private readonly opaqueVaultKey: string;
    private readonly now: () => Date;
    private readonly idFactory: () => string;
    private mutationTail: Promise<void> = Promise.resolve();

    constructor(options: MemoryAdmissionCoordinatorOptions) {
        this.repository = options.repository;
        this.opaqueVaultKey = options.opaqueVaultKey.trim();
        this.now = options.now ?? (() => new Date());
        this.idFactory = options.idFactory
            ?? (() => `memory-admission-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
    }

    admit(
        input: GovernedMemoryAdmissionInput,
    ): Promise<MemoryAdmissionCoordinatorResult<GovernedMemoryAdmissionReceipt>> {
        const prepared = prepareAdmission(input, this.opaqueVaultKey, this.now(), this.idFactory);
        if (!prepared.ok) return Promise.resolve(prepared);
        return this.serialize(async () => this.runDomainMutation(async () => {
            return this.repository.transact((draft) => {
                const journal = requireAdmissionEnvelope(draft, this.opaqueVaultKey, this.now());
                if (input.policy.origin === "type_a") {
                    if (!input.profileRecordId || !input.expectedTargetState) {
                        throw new AdmissionError("type_a_precondition_missing");
                    }
                    const actual = readTypeATargetGeneration(
                        draft,
                        input.profileRecordId,
                        prepared.value.partition,
                    );
                    if (!typeATargetGenerationsEqual(actual, input.expectedTargetState)) {
                        throw new AdmissionError("stale_type_a_batch");
                    }
                }
                const suppressionMatched = hasSuppressionMatch(
                    draft,
                    prepared.value.partition,
                    prepared.value.envelope.sourceFingerprintId,
                    prepared.value.envelope.ruleFingerprint,
                    prepared.value.envelope.profileRecordId,
                );
                const decision = decideMemoryAdmission({
                    ...input.policy,
                    // These guarantees are owned by this coordinator rather
                    // than accepted as producer assertions: event/link/outbox
                    // and compatibility state commit in this transaction.
                    reversibility: "reversible",
                    suppression: suppressionMatched ? "matched" : "absent",
                    changeEventSupport: "available",
                    recoverySupport: "available",
                    atomicCommitSupport: "available",
                });
                if (decision === "reject" || decision === "ephemeral_only") {
                    return { decision };
                }

                const queueItem = cloneDeviceQueueItem({
                    ...prepared.value.queueItem,
                    status: decision === "silent_durable" ? "applied" : "suggested",
                });
                const persistQueue = input.policy.origin === "memory_candidate"
                    || decision === "require_prior_review";
                const existingQueue = persistQueue
                    ? draft.memoryQueueItems.find((item) => item.id === queueItem.id)
                    : undefined;
                let persistedQueue = queueItem;
                if (persistQueue) {
                    if (existingQueue) {
                        const existingEnvelope = readAdmissionEnvelope(existingQueue);
                        if (!existingEnvelope
                            || existingEnvelope.admissionKey !== prepared.value.envelope.admissionKey) {
                            throw new AdmissionError("queue_id_collision");
                        }
                        if (queueItemContentFingerprint(existingQueue) !== queueItemContentFingerprint(queueItem)) {
                            if (existingQueue.status !== "suggested") {
                                throw new AdmissionError("queue_id_collision");
                            }
                            const replacement = cloneDeviceQueueItem({
                                ...queueItem,
                                createdAt: existingQueue.createdAt,
                                status: existingQueue.status,
                            });
                            draft.memoryQueueItems[draft.memoryQueueItems.indexOf(existingQueue)] = replacement;
                            appendQueueCompatibilityDelta(draft, journal, replacement, this.now());
                            persistedQueue = replacement;
                        } else {
                            persistedQueue = existingQueue;
                        }
                    }
                    if (!existingQueue) {
                        draft.memoryQueueItems.push(queueItem);
                        appendQueueCompatibilityDelta(draft, journal, queueItem, this.now());
                    }
                }

                if (decision === "require_prior_review") {
                    return {
                        decision,
                        queueItem: toReviewQueueItem(persistedQueue),
                    };
                }

                const admitted = upsertGovernedClaim({
                    draft,
                    journal,
                    opaqueVaultKey: this.opaqueVaultKey,
                    envelope: prepared.value.envelope,
                    summary: input.summary.trim(),
                    queueItemId: input.policy.origin === "memory_candidate" ? queueItem.id : undefined,
                    confirmationStrength: "auto",
                    now: this.now(),
                    idFactory: this.idFactory,
                });
                if (journal && !buildLegacyMemoryRollbackProjection(draft, this.opaqueVaultKey, this.now()).ok) {
                    throw new AdmissionError("rollback_projection_invalid");
                }
                return {
                    decision,
                    claimId: admitted.claimId,
                    ...(input.policy.origin === "memory_candidate"
                        ? { queueItem: toReviewQueueItem(persistedQueue) }
                        : {}),
                };
            });
        }));
    }

    confirmQueueItem(input: {
        queueItemId: string;
        dataBoundaryAllowed: boolean;
    }): Promise<MemoryAdmissionCoordinatorResult<GovernedMemoryConfirmationReceipt>> {
        const occurredAt = this.now();
        return this.serialize(async () => this.runDomainMutation(async () => {
            return this.repository.transact((draft) => {
                const journal = requireAdmissionEnvelope(draft, this.opaqueVaultKey, occurredAt);
                const item = draft.memoryQueueItems.find((candidate) => (
                    candidate.id === input.queueItemId
                    && candidate.partition.kind === "vault"
                    && candidate.partition.key === this.opaqueVaultKey
                ));
                if (!item) throw new AdmissionError("queue_item_missing");
                if (item.status === "applied") {
                    const envelope = readAdmissionEnvelope(item);
                    if (!envelope) throw new AdmissionError("admission_envelope_missing");
                    const claim = findExistingAdmissionClaim(
                        draft,
                        envelope,
                        { kind: "vault", key: this.opaqueVaultKey },
                    );
                    if (!claim) throw new AdmissionError("confirmed_claim_missing");
                    return { claimId: claim.id, queueItem: toReviewQueueItem(item) };
                }
                if (item.status !== "suggested" && item.status !== "edited") {
                    throw new AdmissionError("queue_item_not_reviewable");
                }
                const envelope = readAdmissionEnvelope(item);
                if (!envelope) throw new AdmissionError("admission_envelope_missing");
                if (!input.dataBoundaryAllowed) throw new AdmissionError("data_boundary_denied");
                const partition: MemoryPartitionKey = { kind: "vault", key: this.opaqueVaultKey };
                if (hasSuppressionMatch(
                    draft,
                    partition,
                    envelope.sourceFingerprintId,
                    envelope.ruleFingerprint,
                    envelope.profileRecordId,
                )) {
                    throw new AdmissionError("suppression_matched");
                }

                const priorQueue = cloneDeviceQueueItem(item);
                item.status = "applied";
                item.updatedAt = occurredAt.toISOString();
                appendQueueCompatibilityDelta(draft, journal, item, occurredAt);
                const admitted = upsertGovernedClaim({
                    draft,
                    journal,
                    opaqueVaultKey: this.opaqueVaultKey,
                    envelope: {
                        ...envelope,
                        authority: envelope.authority === "user_correction"
                            ? "user_correction"
                            : "explicit_user",
                    },
                    summary: item.claim.trim(),
                    queueItemId: item.id,
                    confirmationStrength: "explicit",
                    now: occurredAt,
                    idFactory: this.idFactory,
                });
                if (journal && !buildLegacyMemoryRollbackProjection(draft, this.opaqueVaultKey, occurredAt).ok) {
                    Object.assign(item, priorQueue);
                    throw new AdmissionError("rollback_projection_invalid");
                }
                return {
                    claimId: admitted.claimId,
                    queueItem: toReviewQueueItem(item),
                };
            });
        }));
    }

    dismissQueueItem(input: {
        queueItemId: string;
    }): Promise<MemoryAdmissionCoordinatorResult<GovernedMemoryDismissalReceipt>> {
        const occurredAt = this.now();
        return this.serialize(async () => this.runDomainMutation(async () => {
            return this.repository.transact((draft) => {
                const journal = requireAdmissionEnvelope(draft, this.opaqueVaultKey, occurredAt);
                const item = draft.memoryQueueItems.find((candidate) => (
                    candidate.id === input.queueItemId
                    && candidate.partition.kind === "vault"
                    && candidate.partition.key === this.opaqueVaultKey
                ));
                if (!item) throw new AdmissionError("queue_item_missing");
                if (item.status === "dismissed") {
                    const envelope = readAdmissionEnvelope(item);
                    if (!envelope) throw new AdmissionError("admission_envelope_missing");
                    const marker = draft.suppressionMarkers.find((candidate) => (
                        candidate.reason === "rejected"
                        && candidate.partition.kind === "vault"
                        && candidate.partition.key === this.opaqueVaultKey
                        && candidate.sourceFingerprintId === envelope.sourceFingerprintId
                        && candidate.ruleFingerprint === envelope.ruleFingerprint
                    ));
                    if (!marker) throw new AdmissionError("dismissal_marker_missing");
                    return { markerId: marker.id, queueItem: toReviewQueueItem(item) };
                }
                if (item.status !== "suggested" && item.status !== "failed" && item.status !== "snoozed") {
                    throw new AdmissionError("queue_item_not_dismissible");
                }
                const envelope = readAdmissionEnvelope(item);
                if (!envelope) throw new AdmissionError("admission_envelope_missing");
                const partition: MemoryPartitionKey = { kind: "vault", key: this.opaqueVaultKey };
                let marker = draft.suppressionMarkers.find((candidate) => (
                    candidate.reason === "rejected"
                    && partitionsEqual(candidate.partition, partition)
                    && candidate.sourceFingerprintId === envelope.sourceFingerprintId
                    && candidate.ruleFingerprint === envelope.ruleFingerprint
                ));
                if (!marker) {
                    marker = {
                        id: this.idFactory(),
                        partition,
                        sourceFingerprintId: envelope.sourceFingerprintId,
                        ruleFingerprint: envelope.ruleFingerprint,
                        reason: "rejected",
                        createdAt: occurredAt.toISOString(),
                        updatedAt: occurredAt.toISOString(),
                    };
                    draft.suppressionMarkers.push(marker);
                }
                item.status = "dismissed";
                item.updatedAt = occurredAt.toISOString();
                appendQueueCompatibilityDelta(draft, journal, item, occurredAt);
                if (journal && !buildLegacyMemoryRollbackProjection(draft, this.opaqueVaultKey, occurredAt).ok) {
                    throw new AdmissionError("rollback_projection_invalid");
                }
                return {
                    markerId: marker.id,
                    queueItem: toReviewQueueItem(item),
                };
            });
        }));
    }

    private serialize<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.mutationTail.then(operation, operation);
        this.mutationTail = result.then(() => undefined, () => undefined);
        return result;
    }

    private async runDomainMutation<T>(
        operation: () => Promise<T>,
    ): Promise<MemoryAdmissionCoordinatorResult<T>> {
        try {
            return { ok: true, value: await operation() };
        } catch (error) {
            return {
                ok: false,
                reason: error instanceof AdmissionError ? error.code : "persistence_failed",
            };
        }
    }
}

function prepareAdmission(
    input: GovernedMemoryAdmissionInput,
    opaqueVaultKey: string,
    now: Date,
    idFactory: () => string,
): MemoryAdmissionCoordinatorResult<{
    envelope: PersistedAdmissionEnvelope;
    partition: MemoryPartitionKey;
    queueItem: DeviceMemoryQueueItem;
}> {
    if (!opaqueVaultKey) return failure("invalid_vault_key");
    if (!input.summary.trim()) return failure("empty_summary");
    if (input.policy.origin !== "type_a" && input.policy.origin !== "memory_candidate") {
        return failure("invalid_origin");
    }
    if (input.policy.memoryType !== input.memoryType
        || input.policy.sensitivity !== input.sensitivity
        || input.policy.authority !== input.authority
        || input.policy.effect !== input.effect) {
        return failure("policy_input_mismatch");
    }
    const sourceFingerprintId = input.sourceFingerprintId.trim();
    const ruleFingerprint = input.ruleFingerprint.trim();
    const admissionKey = input.admissionKey.trim();
    if (!sourceFingerprintId || !ruleFingerprint || !admissionKey) {
        return failure("exact_fingerprint_required");
    }
    if (input.policy.origin === "type_a") {
        const profileRecordId = input.profileRecordId?.trim();
        if (!profileRecordId || !input.expectedTargetState
            || input.expectedTargetState.profileRecordId !== profileRecordId) {
            return failure("type_a_precondition_missing");
        }
    }
    const envelope: PersistedAdmissionEnvelope = {
        version: 1,
        origin: input.policy.origin,
        memoryType: input.memoryType,
        sensitivity: input.sensitivity,
        authority: input.authority,
        effect: input.effect,
        applicability: cloneScope(input.applicability),
        provenance: input.provenance.map(cloneProvenance),
        sourceFingerprintId,
        ruleFingerprint,
        admissionKey,
        ...(input.profileRecordId?.trim() ? { profileRecordId: input.profileRecordId.trim() } : {}),
    };
    if (!validateAdmissionEnvelope(envelope)) return failure("invalid_admission_envelope");
    const queueInput = input.queueInput;
    if (queueInput.type !== "memory_candidate" && queueInput.type !== "memory_conflict") {
        return failure("invalid_queue_type");
    }
    const timestamp = now.toISOString();
    const queueId = `memory-queue-${stableHash(`${opaqueVaultKey}\u0000${admissionKey}`).slice(0, 24)}`;
    const partition: MemoryPartitionKey = { kind: "vault", key: opaqueVaultKey };
    const queueItem: DeviceMemoryQueueItem = {
        id: queueId || idFactory(),
        type: queueInput.type,
        partition,
        title: queueInput.title.trim(),
        claim: input.summary.trim(),
        scope: cloneScope(queueInput.scope),
        sourceRefs: queueInput.sourceRefs.map(cloneSourceRef),
        originSurface: queueInput.originSurface,
        priority: queueInput.priority ?? "normal",
        status: "suggested",
        createdAt: timestamp,
        updatedAt: timestamp,
        whyShown: [...(queueInput.whyShown ?? [])],
        dataBoundarySnapshotId: queueInput.dataBoundarySnapshotId,
        admissionReason: queueInput.admissionReason,
        ...(queueInput.replayRef ? { replayRef: queueInput.replayRef } : {}),
        metadata: {
            ...(queueInput.metadata ?? {}),
            memoryType: input.memoryType,
            sensitivity: input.sensitivity,
        },
        governanceAdmission: cloneJson(envelope),
    };
    const queueValidation = validateReviewQueueItem(toReviewQueueItem(queueItem));
    if (!queueValidation.ok) return failure(queueValidation.reason);
    return { ok: true, value: { envelope, partition, queueItem } };
}

function requireAdmissionEnvelope(
    state: DeviceMemoryGovernanceStateV1,
    opaqueVaultKey: string,
    now: Date,
): MemoryMigrationState | null {
    const policy = state.policyStates[opaqueVaultKey];
    if (!policy || policy.mode !== "effect_based" || policy.contextProjectionMode !== "governed") {
        throw new AdmissionError("effect_policy_not_ready");
    }
    const migration = state.migrationStates[opaqueVaultKey];
    if (!migration) return null;
    if (migration.phase === "rolling_back") throw new AdmissionError("migration_rolling_back");
    if (migration.phase === "finalized") return null;
    if (migration.phase !== "compatibility" || migration.lastErrorCode) {
        throw new AdmissionError("migration_not_writable");
    }
    const expiresAt = Date.parse(migration.rollbackExpiresAt ?? "");
    if (!Number.isFinite(expiresAt) || expiresAt < now.getTime()) return null;
    if (!buildLegacyMemoryRollbackProjection(state, opaqueVaultKey, now).ok) {
        throw new AdmissionError("rollback_projection_invalid");
    }
    return migration;
}

function upsertGovernedClaim(input: {
    draft: DeviceMemoryGovernanceStateV1;
    journal: MemoryMigrationState | null;
    opaqueVaultKey: string;
    envelope: PersistedAdmissionEnvelope;
    summary: string;
    queueItemId?: string;
    confirmationStrength: "auto" | "explicit";
    now: Date;
    idFactory: () => string;
}): { claimId: string } {
    const partition: MemoryPartitionKey = { kind: "vault", key: input.opaqueVaultKey };
    const existingClaim = findExistingAdmissionClaim(input.draft, input.envelope, partition);
    const currentRevision = existingClaim?.activeRevisionId
        ? input.draft.revisions.find((revision) => (
            revision.id === existingClaim.activeRevisionId && revision.claimId === existingClaim.id
        ))
        : undefined;
    if ((currentRevision?.authority === "user_correction" || currentRevision?.authority === "explicit_user")
        && input.envelope.authority !== "user_correction"
        && input.envelope.authority !== "explicit_user") {
        throw new AdmissionError("user_authority_preserved");
    }
    if (existingClaim && currentRevision && admissionClaimIsCurrent(
        input.draft,
        existingClaim,
        currentRevision,
        input.envelope,
        input.summary,
        input.queueItemId,
    )) {
        return { claimId: existingClaim.id };
    }
    if (existingClaim && input.draft.pendingOperations.some((operation) => (
        operation.kind === "profile_projection"
        && operation.claimId === existingClaim.id
        && operation.state === "pending"
    ))) {
        throw new AdmissionError("claim_operation_pending");
    }
    const claimId = existingClaim?.id
        ?? `memory-claim-${stableHash(`${input.opaqueVaultKey}\u0000${input.envelope.admissionKey}`).slice(0, 24)}`;
    if (!existingClaim && input.draft.claims.some((claim) => claim.id === claimId)) {
        throw new AdmissionError("claim_id_collision");
    }
    const occurredAt = input.now.toISOString();
    const revisionId = input.idFactory();
    if (input.draft.revisions.some((revision) => revision.id === revisionId)) {
        throw new AdmissionError("revision_id_collision");
    }
    const revision: MemoryClaimRevision = {
        id: revisionId,
        claimId,
        summary: input.summary,
        provenance: input.envelope.provenance.map(cloneProvenance),
        authority: input.envelope.authority,
        ...(currentRevision ? { supersedesRevisionId: currentRevision.id } : {}),
        createdAt: occurredAt,
    };
    input.draft.revisions.push(revision);

    let claim: GovernedMemoryClaim;
    let automaticAddSnapshot: { id: string; eventId: string } | undefined;
    const isReplacement = Boolean(existingClaim && currentRevision);
    if (existingClaim && currentRevision) {
        if (existingClaim.lifecycle === "forget_pending" || existingClaim.lifecycle === "forgotten_tombstone") {
            throw new AdmissionError("claim_not_admissible");
        }
        const eventId = input.idFactory();
        const snapshotId = input.idFactory();
        invalidatePriorUndoSnapshots(input.draft, claimId);
        const event = {
            id: eventId,
            claimId,
            kind: "replace" as const,
            scopeKey: partitionScopeKey(existingClaim.partition),
            effect: input.envelope.effect,
            occurredAt,
            undoSnapshotId: snapshotId,
        };
        const snapshot: MemoryUndoSnapshot = {
            id: snapshotId,
            claimId,
            eventId,
            partition: clonePartition(existingClaim.partition),
            claim: cloneClaim(existingClaim),
            revisions: input.draft.revisions
                .filter((candidate) => candidate.claimId === claimId && candidate.id !== revision.id)
                .map(cloneRevision),
            projectionLinks: input.draft.projectionLinks
                .filter((link) => link.claimId === claimId)
                .map(cloneProjectionLink),
            createdAt: occurredAt,
            expiresAt: new Date(input.now.getTime() + UNDO_RETENTION_MS).toISOString(),
        };
        input.draft.changeEvents.push(event);
        input.draft.undoSnapshots.push(snapshot);
        claim = {
            ...existingClaim,
            memoryType: input.envelope.memoryType,
            sensitivity: input.envelope.sensitivity,
            applicability: cloneScope(input.envelope.applicability),
            activeRevisionId: revision.id,
            effect: input.envelope.effect,
            updatedAt: occurredAt,
        };
        input.draft.claims[input.draft.claims.indexOf(existingClaim)] = claim;
    } else {
        if (existingClaim) {
            if (existingClaim.lifecycle !== "undone_add_tombstone") {
                throw new AdmissionError("claim_not_admissible");
            }
            if (input.draft.pendingOperations.some((operation) => (
                operation.kind === "profile_projection"
                && operation.claimId === existingClaim.id
                && operation.action === "remove"
                && operation.state === "pending"
            ))) {
                throw new AdmissionError("claim_operation_pending");
            }
            claim = {
                ...existingClaim,
                partition,
                memoryType: input.envelope.memoryType,
                sensitivity: input.envelope.sensitivity,
                applicability: cloneScope(input.envelope.applicability),
                activeRevisionId: revision.id,
                effect: input.envelope.effect,
                lifecycle: "active",
                updatedAt: occurredAt,
            };
            input.draft.claims[input.draft.claims.indexOf(existingClaim)] = claim;
        } else {
            claim = {
                id: claimId,
                partition,
                memoryType: input.envelope.memoryType,
                sensitivity: input.envelope.sensitivity,
                applicability: cloneScope(input.envelope.applicability),
                activeRevisionId: revision.id,
                effect: input.envelope.effect,
                lifecycle: "active",
                createdAt: occurredAt,
                updatedAt: occurredAt,
            };
            input.draft.claims.push(claim);
        }
        const eventId = input.idFactory();
        const undoSnapshotId = input.confirmationStrength === "auto"
            ? input.idFactory()
            : undefined;
        invalidatePriorUndoSnapshots(input.draft, claimId);
        input.draft.changeEvents.push({
            id: eventId,
            claimId,
            kind: "add",
            scopeKey: partitionScopeKey(partition),
            effect: claim.effect,
            occurredAt,
            ...(undoSnapshotId ? { undoSnapshotId } : {}),
        });
        if (undoSnapshotId) {
            automaticAddSnapshot = { id: undoSnapshotId, eventId };
        }
    }

    const legacyQueueItemFingerprint = input.queueItemId
        ? input.draft.memoryQueueItems.find((item) => item.id === input.queueItemId)
            ?.legacyCompatibilityItemFingerprint
        : undefined;
    if (legacyQueueItemFingerprint) {
        const current = claim.legacyCompatibility ?? {
            recordIdFingerprints: [],
            memoryQueueItemIdFingerprints: [],
        };
        claim.legacyCompatibility = {
            recordIdFingerprints: [...new Set(current.recordIdFingerprints)],
            memoryQueueItemIdFingerprints: [...new Set([
                ...current.memoryQueueItemIdFingerprints,
                legacyQueueItemFingerprint,
            ])],
        };
    }

    const activeAdmissionLinks = syncAdmissionLinks(
        input.draft,
        claim,
        input.envelope,
        input.queueItemId,
        occurredAt,
        input.idFactory,
    );
    if (automaticAddSnapshot) {
        input.draft.undoSnapshots.push({
            id: automaticAddSnapshot.id,
            claimId,
            eventId: automaticAddSnapshot.eventId,
            partition: clonePartition(partition),
            restoreMode: "remove_added_claim",
            revisions: [],
            projectionLinks: activeAdmissionLinks.map(cloneProjectionLink),
            createdAt: occurredAt,
            expiresAt: new Date(input.now.getTime() + UNDO_RETENTION_MS).toISOString(),
        });
    }
    if (input.envelope.profileRecordId) {
        input.draft.pendingOperations = input.draft.pendingOperations.filter((operation) => (
            operation.kind !== "profile_projection"
            || operation.claimId !== claim.id
            || operation.state === "applied"
        ));
        input.draft.pendingOperations.push({
            id: input.idFactory(),
            kind: "profile_projection",
            claimId: claim.id,
            profileRecordId: input.envelope.profileRecordId,
            targetRevisionId: revision.id,
            state: "pending",
            attemptCount: 0,
            createdAt: occurredAt,
            updatedAt: occurredAt,
        });
    }

    const record = buildCompatibilityRecord(
        claim,
        revision,
        input.queueItemId,
        input.confirmationStrength,
    );
    appendClaimCompatibilityDelta(
        input.draft,
        input.journal,
        claim,
        record,
        isReplacement ? "claim_changed" : "claim_added",
        input.now,
    );
    return { claimId };
}

function syncAdmissionLinks(
    state: DeviceMemoryGovernanceStateV1,
    claim: GovernedMemoryClaim,
    envelope: PersistedAdmissionEnvelope,
    queueItemId: string | undefined,
    occurredAt: string,
    idFactory: () => string,
): MemoryProjectionLink[] {
    const desiredTargets: MemoryProjectionLink["target"][] = [
        { kind: "prompt_projection", projectionId: `prompt:${claim.id}` },
        ...(queueItemId ? [{ kind: "review_queue" as const, itemId: queueItemId }] : []),
        ...(envelope.profileRecordId
            ? [{ kind: "type_a_profile" as const, profileRecordId: envelope.profileRecordId }]
            : []),
    ];
    for (const link of state.projectionLinks) {
        if (link.claimId !== claim.id || link.state !== "active") continue;
        if (!desiredTargets.some((target) => targetsEqual(target, link.target))) {
            link.state = "redacted";
        }
    }
    const activeLinks: MemoryProjectionLink[] = [];
    for (const target of desiredTargets) {
        const existing = state.projectionLinks.find((link) => (
            link.claimId === claim.id && link.state === "active" && targetsEqual(link.target, target)
        ));
        if (existing) {
            existing.sourceFingerprintId = envelope.sourceFingerprintId;
            existing.ruleFingerprint = envelope.ruleFingerprint;
            activeLinks.push(existing);
            continue;
        }
        const link: MemoryProjectionLink = {
            id: idFactory(),
            claimId: claim.id,
            target,
            relation: target.kind === "review_queue" ? "origin" : "derived_copy",
            state: "active",
            sourceFingerprintId: envelope.sourceFingerprintId,
            ruleFingerprint: envelope.ruleFingerprint,
            createdAt: occurredAt,
        };
        state.projectionLinks.push(link);
        activeLinks.push(link);
    }
    return activeLinks;
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

function findExistingAdmissionClaim(
    state: DeviceMemoryGovernanceStateV1,
    envelope: PersistedAdmissionEnvelope,
    partition: MemoryPartitionKey,
): GovernedMemoryClaim | undefined {
    const linkBelongsToPartition = (link: MemoryProjectionLink): boolean => state.claims.some((claim) => (
        claim.id === link.claimId && partitionsEqual(claim.partition, partition)
    ));
    const targetClaimId = envelope.profileRecordId
        ? (state.projectionLinks.find((link) => (
            link.state === "active"
            && link.target.kind === "type_a_profile"
            && link.target.profileRecordId === envelope.profileRecordId
            && linkBelongsToPartition(link)
        )) ?? state.projectionLinks.find((link) => (
            link.target.kind === "type_a_profile"
            && link.target.profileRecordId === envelope.profileRecordId
            && linkBelongsToPartition(link)
        )))?.claimId
        : state.projectionLinks.find((link) => (
            link.state === "active"
            && link.sourceFingerprintId === envelope.sourceFingerprintId
            && link.ruleFingerprint === envelope.ruleFingerprint
            && linkBelongsToPartition(link)
        ))?.claimId;
    return targetClaimId
        ? state.claims.find((claim) => claim.id === targetClaimId && partitionsEqual(claim.partition, partition))
        : undefined;
}

export function readTypeATargetGeneration(
    state: DeviceMemoryGovernanceStateV1,
    profileRecordId: string,
    partition: MemoryPartitionKey,
): TypeATargetGeneration {
    const normalizedId = profileRecordId.trim();
    if (!normalizedId) return { state: "absent", profileRecordId: "" };
    const links = state.projectionLinks.filter((link) => (
        link.target.kind === "type_a_profile"
        && link.target.profileRecordId === normalizedId
        && state.claims.some((claim) => (
            claim.id === link.claimId && partitionsEqual(claim.partition, partition)
        ))
    ));
    const link = links.find((candidate) => candidate.state === "active") ?? links.at(-1);
    const claim = link ? state.claims.find((candidate) => candidate.id === link.claimId) : undefined;
    if (!claim) return { state: "absent", profileRecordId: normalizedId };
    const latestChangeEventId = state.changeEvents
        .filter((event) => event.claimId === claim.id)
        .at(-1)?.id ?? null;
    return {
        state: "present",
        profileRecordId: normalizedId,
        claimId: claim.id,
        activeRevisionId: claim.activeRevisionId ?? null,
        lifecycle: claim.lifecycle,
        latestChangeEventId,
    };
}

function typeATargetGenerationsEqual(
    left: TypeATargetGeneration,
    right: TypeATargetGeneration,
): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function appendQueueCompatibilityDelta(
    state: DeviceMemoryGovernanceStateV1,
    migration: MemoryMigrationState | null,
    item: DeviceMemoryQueueItem,
    now: Date,
): void {
    if (!migration) return;
    const value: LegacyRollbackValue = { kind: "memory_queue", item: toReviewQueueItem(item) };
    appendCompatibilityDelta(state, migration, item.partition, item.id, "queue_changed", value, now);
}

function appendClaimCompatibilityDelta(
    state: DeviceMemoryGovernanceStateV1,
    migration: MemoryMigrationState | null,
    claim: GovernedMemoryClaim,
    record: ConfirmedMemoryRecord,
    kind: "claim_added" | "claim_changed",
    now: Date,
): void {
    if (!migration) return;
    appendCompatibilityDelta(
        state,
        migration,
        claim.partition,
        claim.id,
        kind,
        { kind: "claim", record },
        now,
    );
}

function appendCompatibilityDelta(
    state: DeviceMemoryGovernanceStateV1,
    migration: MemoryMigrationState,
    partition: MemoryPartitionKey,
    entityId: string,
    kind: "claim_added" | "claim_changed" | "queue_changed",
    value: LegacyRollbackValue,
    now: Date,
): void {
    const sequence = nextDeltaSequence(state, migration.migrationRunId);
    const checksum = checksumLegacyRollbackValue(value);
    const payloadId = `memory-admission-rollback-${stableHash(
        `${migration.migrationRunId}\u0000${sequence}\u0000${entityId}\u0000${checksum}`,
    ).slice(0, 24)}`;
    if (state.rollbackPayloadEntries.some((entry) => entry.id === payloadId)) {
        throw new AdmissionError("rollback_payload_collision");
    }
    if (!migration.rollbackExpiresAt) throw new AdmissionError("rollback_expiry_missing");
    const entry: MemoryRollbackPayloadEntry = {
        id: payloadId,
        migrationRunId: migration.migrationRunId,
        partition: clonePartition(partition),
        entityId,
        value: cloneJson(value),
        checksum,
        expiresAt: migration.rollbackExpiresAt,
    };
    state.rollbackPayloadEntries.push(entry);
    state.migrationDeltas.push({
        sequence,
        migrationRunId: migration.migrationRunId,
        partition: clonePartition(partition),
        committedAt: now.toISOString(),
        kind,
        entityId,
        payloadEntryId: entry.id,
        payloadChecksum: checksum,
    });
}

function nextDeltaSequence(state: DeviceMemoryGovernanceStateV1, migrationRunId: string): number {
    const deltas = state.migrationDeltas
        .filter((delta) => delta.migrationRunId === migrationRunId)
        .sort((left, right) => left.sequence - right.sequence);
    deltas.forEach((delta, index) => {
        if (delta.sequence !== index + 1) throw new AdmissionError("rollback_delta_sequence_invalid");
    });
    return deltas.length + 1;
}

function buildCompatibilityRecord(
    claim: GovernedMemoryClaim,
    revision: MemoryClaimRevision,
    queueItemId: string | undefined,
    confirmationStrength: "auto" | "explicit",
): ConfirmedMemoryRecord {
    const record: ConfirmedMemoryRecord = {
        id: claim.id,
        type: claim.memoryType,
        lifecycle: claim.lifecycle === "paused" || claim.lifecycle === "archived"
            ? "archived"
            : claim.lifecycle === "stale" ? "stale" : "active",
        sensitivity: claim.sensitivity,
        scope: cloneScope(claim.applicability),
        sourceRefs: collectNoteSourceRefs(revision.provenance),
        summary: revision.summary,
        createdAt: claim.createdAt,
        updatedAt: claim.updatedAt,
        confirmedAt: claim.createdAt,
        confirmationStrength,
        confirmationSource: revision.authority === "pa_inference" ? "chat" : "memory_panel",
        updatePolicy: claim.memoryType === "task_constraint"
            ? "ask-before-cross-scope-use"
            : "manual-only",
        ...(queueItemId ? { originReviewQueueItemId: queueItemId } : {}),
    };
    const validation = validateConfirmedMemoryRecord(record);
    if (!validation.ok) throw new AdmissionError(`compatibility_record_${validation.reason}`);
    return record;
}

function collectNoteSourceRefs(provenance: readonly PersistedMemoryProvenance[]): PersistedSourceRef[] {
    const refs = new Map<string, PersistedSourceRef>();
    for (const entry of provenance) {
        if (entry.kind === "note") refs.set(entry.sourceRef.path, cloneSourceRef(entry.sourceRef));
        if (entry.kind === "vault_aggregate") {
            for (const sourceRef of entry.representativeSourceRefs) {
                refs.set(sourceRef.path, cloneSourceRef(sourceRef));
            }
        }
    }
    return [...refs.values()];
}

function readAdmissionEnvelope(item: DeviceMemoryQueueItem): PersistedAdmissionEnvelope | null {
    const value = item.governanceAdmission;
    return validateAdmissionEnvelope(value) ? cloneJson(value) : null;
}

function validateAdmissionEnvelope(value: unknown): value is PersistedAdmissionEnvelope {
    if (!isRecord(value) || value.version !== 1) return false;
    if (value.origin !== "type_a" && value.origin !== "memory_candidate") return false;
    if (!includesString(MEMORY_TYPES, value.memoryType)
        || !includesString(MEMORY_SENSITIVITIES, value.sensitivity)
        || !includesString(AUTHORITIES, value.authority)
        || !includesString(EFFECTS, value.effect)) return false;
    if (!isValidScope(value.applicability)) return false;
    if (!Array.isArray(value.provenance)
        || value.provenance.length === 0
        || value.provenance.some((entry) => !isValidProvenance(entry))) return false;
    if (typeof value.sourceFingerprintId !== "string" || !value.sourceFingerprintId.trim()
        || typeof value.ruleFingerprint !== "string" || !value.ruleFingerprint.trim()
        || typeof value.admissionKey !== "string" || !value.admissionKey.trim()) return false;
    if (value.profileRecordId !== undefined && (
        typeof value.profileRecordId !== "string" || !value.profileRecordId.trim()
    )) return false;
    return true;
}

function isValidProvenance(value: unknown): value is PersistedMemoryProvenance {
    if (!isRecord(value)) return false;
    if (value.kind === "note") return validateSourceRefPathShape(value.sourceRef).ok;
    if (value.kind === "conversation") {
        return Array.isArray(value.conversationIds)
            && value.conversationIds.length > 0
            && value.conversationIds.every((id) => typeof id === "string" && Boolean(id.trim()))
            && typeof value.observedAt === "string"
            && Boolean(value.observedAt.trim());
    }
    if (value.kind === "explicit_setting") {
        return typeof value.settingKey === "string" && Boolean(value.settingKey.trim());
    }
    if (value.kind === "vault_aggregate") {
        return typeof value.generatedAt === "string"
            && typeof value.dataBoundaryFingerprint === "string"
            && Number.isSafeInteger(value.includedFileCount)
            && (value.includedFileCount as number) >= 0
            && (value.coverage === "exact" || value.coverage === "representative" || value.coverage === "aggregate_only")
            && Array.isArray(value.representativeSourceRefs)
            && value.representativeSourceRefs.every((sourceRef) => validateSourceRefPathShape(sourceRef).ok);
    }
    return false;
}

function isValidScope(value: unknown): value is ReviewQueueScope {
    if (!isRecord(value) || !includesString(REVIEW_QUEUE_SCOPE_KINDS, value.kind)) return false;
    if (value.label !== undefined && typeof value.label !== "string") return false;
    return ["paths", "tags"].every((key) => value[key] === undefined
        || Array.isArray(value[key]) && (value[key] as unknown[]).every((entry) => typeof entry === "string"));
}

function hasSuppressionMatch(
    state: DeviceMemoryGovernanceStateV1,
    partition: MemoryPartitionKey,
    sourceFingerprintId: string,
    ruleFingerprint: string,
    profileRecordId?: string,
): boolean {
    const exactMatch = state.suppressionMarkers.some((marker) => (
        partitionsEqual(marker.partition, partition)
        && marker.sourceFingerprintId === sourceFingerprintId
        && marker.ruleFingerprint === ruleFingerprint
    ));
    if (exactMatch || !profileRecordId?.trim() || partition.kind !== "vault") return exactMatch;
    const targetFingerprint = createTypeATargetSuppressionFingerprint(
        partition.key,
        profileRecordId,
    );
    return state.suppressionMarkers.some((marker) => (
        partitionsEqual(marker.partition, partition)
        && marker.sourceFingerprintId === targetFingerprint
        && marker.ruleFingerprint === TYPE_A_TARGET_SUPPRESSION_RULE_FINGERPRINT
    ));
}

function targetsEqual(left: MemoryProjectionLink["target"], right: MemoryProjectionLink["target"]): boolean {
    if (left.kind !== right.kind) return false;
    if (left.kind === "review_queue" && right.kind === "review_queue") return left.itemId === right.itemId;
    if (left.kind === "type_a_profile" && right.kind === "type_a_profile") {
        return left.profileRecordId === right.profileRecordId;
    }
    return left.kind === "prompt_projection" && right.kind === "prompt_projection"
        && left.projectionId === right.projectionId;
}

function partitionScopeKey(partition: MemoryPartitionKey): string {
    return partition.kind === "vault" ? partition.key : "device";
}

function partitionsEqual(left: MemoryPartitionKey, right: MemoryPartitionKey): boolean {
    return left.kind === right.kind && left.key === right.key;
}

function clonePartition(partition: MemoryPartitionKey): MemoryPartitionKey {
    return partition.kind === "vault"
        ? { kind: "vault", key: partition.key }
        : { kind: "device_collaboration", key: "device" };
}

function cloneProvenance(provenance: PersistedMemoryProvenance): PersistedMemoryProvenance {
    if (provenance.kind === "note") return { kind: "note", sourceRef: cloneSourceRef(provenance.sourceRef) };
    if (provenance.kind === "conversation") {
        return {
            kind: "conversation",
            conversationIds: [...provenance.conversationIds],
            observedAt: provenance.observedAt,
        };
    }
    if (provenance.kind === "explicit_setting") {
        return { kind: "explicit_setting", settingKey: provenance.settingKey };
    }
    return {
        kind: "vault_aggregate",
        generatedAt: provenance.generatedAt,
        dataBoundaryFingerprint: provenance.dataBoundaryFingerprint,
        includedFileCount: provenance.includedFileCount,
        coverage: provenance.coverage,
        representativeSourceRefs: provenance.representativeSourceRefs.map(cloneSourceRef),
    };
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
        provenance: revision.provenance.map(cloneProvenance),
    };
}

function cloneProjectionLink(link: MemoryProjectionLink): MemoryProjectionLink {
    return cloneJson(link);
}

function cloneDeviceQueueItem(item: DeviceMemoryQueueItem): DeviceMemoryQueueItem {
    return cloneJson(item);
}

function toReviewQueueItem(item: DeviceMemoryQueueItem): ReviewQueueItem {
    const clone = cloneJson(item) as unknown as Record<string, unknown>;
    delete clone.partition;
    delete clone.governanceAdmission;
    delete clone.legacyCompatibilityItemFingerprint;
    return clone as unknown as ReviewQueueItem;
}

function queueItemContentFingerprint(item: DeviceMemoryQueueItem): string {
    const clone = cloneDeviceQueueItem(item) as unknown as Record<string, unknown>;
    delete clone.createdAt;
    delete clone.updatedAt;
    delete clone.status;
    return JSON.stringify(clone);
}

function admissionClaimIsCurrent(
    state: DeviceMemoryGovernanceStateV1,
    claim: GovernedMemoryClaim,
    revision: MemoryClaimRevision,
    envelope: PersistedAdmissionEnvelope,
    summary: string,
    queueItemId: string | undefined,
): boolean {
    const expectedTargets = [
        `prompt:prompt:${claim.id}`,
        ...(queueItemId ? [`queue:${queueItemId}`] : []),
        ...(envelope.profileRecordId ? [`profile:${envelope.profileRecordId}`] : []),
    ].sort();
    const activeLinks = state.projectionLinks
        .filter((link) => link.claimId === claim.id && link.state === "active")
        .map((link) => {
            if (link.target.kind === "prompt_projection") return `prompt:${link.target.projectionId}`;
            if (link.target.kind === "review_queue") return `queue:${link.target.itemId}`;
            return `profile:${link.target.profileRecordId}`;
        })
        .sort();
    const exactLineageIsCurrent = JSON.stringify(activeLinks) === JSON.stringify(expectedTargets)
        && state.projectionLinks
            .filter((link) => link.claimId === claim.id && link.state === "active")
            .every((link) => (
                link.sourceFingerprintId === envelope.sourceFingerprintId
                && link.ruleFingerprint === envelope.ruleFingerprint
            ));
    if (!exactLineageIsCurrent) return false;
    // A Type-A extraction turn may commit before its durable cursor advances.
    // Replaying that exact source/rule lineage must be idempotent even though
    // the extractor stamps a new observedAt or returns nondeterministic wording.
    if (envelope.profileRecordId) return true;
    return revision.summary === summary
        && revision.authority === envelope.authority
        && JSON.stringify(revision.provenance) === JSON.stringify(envelope.provenance)
        && claim.memoryType === envelope.memoryType
        && claim.sensitivity === envelope.sensitivity
        && claim.effect === envelope.effect
        && JSON.stringify(claim.applicability) === JSON.stringify(envelope.applicability);
}

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function failure<T>(reason: string): MemoryAdmissionCoordinatorResult<T> {
    return { ok: false, reason };
}
