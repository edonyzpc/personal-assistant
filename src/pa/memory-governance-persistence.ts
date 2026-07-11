import {
    clearPlatformTimeout,
    getPlatformIndexedDB,
    setPlatformTimeout,
} from "../platform-dom";
import {
    MEMORY_SENSITIVITIES,
    MEMORY_TYPES,
    REVIEW_QUEUE_SCOPE_KINDS,
    hasForbiddenPersistedTextFields,
    validateReviewQueueItemBase,
    validateSourceRefPathShape,
    type MemorySensitivity,
    type MemoryType,
    type PersistedSourceRef,
    type ReviewQueueScope,
} from "./contracts";
import { cloneScope, cloneSourceRef, includesString, isRecord } from "./helpers";
import {
    validateConfirmedMemoryRecord,
    type ConfirmedMemoryRecord,
} from "./memory-governance-store";
import type {
    MemoryControlCenterAuthority,
    MemoryControlCenterEffect,
} from "./memory-control-center";
import type { ReviewQueueItem } from "./review-queue-store";

export const MEMORY_GOVERNANCE_SCHEMA_VERSION = 1 as const;
export const MEMORY_GOVERNANCE_INDEXED_DB_VERSION = 1;
export const MEMORY_GOVERNANCE_DEFAULT_DB_NAME = "personal-assistant-memory-governance-device-v1";

const META_STORE = "meta";
const META_KEY = "device-state-v1";
const DEFAULT_OPEN_TIMEOUT_MS = 10_000;
const DEFAULT_COMMIT_RETRIES = 8;

export const MEMORY_GOVERNANCE_LOGICAL_STORES = [
    "claims",
    "revisions",
    "memoryQueueItems",
    "projectionLinks",
    "changeEvents",
    "undoSnapshots",
    "suppressionMarkers",
    "pendingOperations",
    "policyStates",
    "migrationStates",
    "migrationDeltas",
    "rollbackPayloadEntries",
] as const;

type MemoryGovernanceLogicalStore = typeof MEMORY_GOVERNANCE_LOGICAL_STORES[number];

const ARRAY_STORES = [
    "claims",
    "revisions",
    "memoryQueueItems",
    "projectionLinks",
    "changeEvents",
    "undoSnapshots",
    "suppressionMarkers",
    "pendingOperations",
    "migrationDeltas",
    "rollbackPayloadEntries",
] as const satisfies readonly MemoryGovernanceLogicalStore[];

const MAP_STORES = [
    "policyStates",
    "migrationStates",
] as const satisfies readonly MemoryGovernanceLogicalStore[];

const ALL_INDEXED_DB_STORES = [META_STORE, ...MEMORY_GOVERNANCE_LOGICAL_STORES] as const;

const EFFECTS = [
    "none",
    "stored_not_in_use",
    "retrieval_only",
    "future_answers",
    "collaboration_default",
] as const satisfies readonly MemoryControlCenterEffect[];

const AUTHORITIES = [
    "source_observation",
    "pa_inference",
    "explicit_user",
    "user_correction",
] as const satisfies readonly MemoryControlCenterAuthority[];

const CLAIM_LIFECYCLES = [
    "active",
    "archived",
    "paused",
    "stale",
    "forget_pending",
    "forgotten_tombstone",
    "undone_add_tombstone",
] as const;

const MIGRATION_PHASES = [
    "not_started",
    "source_captured",
    "local_writing",
    "local_verifying",
    "cutover_ready",
    "compatibility",
    "finalizing",
    "finalized",
    "rolling_back",
    "rolled_back",
    "failed",
] as const;

const CHANGE_KINDS = [
    "add",
    "replace",
    "auto_remove",
    "correct",
    "pause",
    "resume",
    "forget",
    "undo",
    "change_scope",
] as const;

const DELTA_KINDS = [
    "claim_added",
    "claim_changed",
    "claim_forgotten",
    "claim_removed",
    "queue_changed",
    "queue_removed",
    "policy_changed",
] as const;

export type OpaqueVaultKey = string;

export type MemoryPartitionKey =
    | { kind: "vault"; key: string }
    | { kind: "device_collaboration"; key: "device" };

/** Opaque legacy IDs retained without content so Forget can redact syncable compatibility state. */
export interface LegacyMemoryCompatibilityIdentity {
    recordIdFingerprints: string[];
    memoryQueueItemIdFingerprints: string[];
}

export interface GovernedMemoryClaim {
    id: string;
    partition: MemoryPartitionKey;
    memoryType: MemoryType;
    sensitivity: MemorySensitivity;
    applicability: ReviewQueueScope;
    activeRevisionId?: string;
    effect: MemoryControlCenterEffect;
    lifecycle: typeof CLAIM_LIFECYCLES[number];
    createdAt: string;
    updatedAt: string;
    legacyCompatibility?: LegacyMemoryCompatibilityIdentity;
}

export type PersistedMemoryProvenance =
    | { kind: "note"; sourceRef: PersistedSourceRef }
    | {
        kind: "conversation";
        conversationIds: string[];
        observedAt: string;
    }
    | { kind: "explicit_setting"; settingKey: string }
    | {
        kind: "vault_aggregate";
        generatedAt: string;
        dataBoundaryFingerprint: string;
        includedFileCount: number;
        coverage: "exact" | "representative" | "aggregate_only";
        representativeSourceRefs: PersistedSourceRef[];
    };

export interface MemoryClaimRevision {
    id: string;
    claimId: string;
    summary: string;
    provenance: PersistedMemoryProvenance[];
    authority: MemoryControlCenterAuthority;
    supersedesRevisionId?: string;
    createdAt: string;
}

export interface MemoryQueueAdmissionEnvelope {
    version: 1;
    origin: "type_a" | "memory_candidate";
    memoryType: MemoryType;
    sensitivity: MemorySensitivity;
    authority: MemoryControlCenterAuthority;
    effect: MemoryControlCenterEffect;
    applicability: ReviewQueueScope;
    provenance: PersistedMemoryProvenance[];
    sourceFingerprintId: string;
    ruleFingerprint: string;
    admissionKey: string;
    profileRecordId?: string;
}

export interface DeviceMemoryQueueItem extends ReviewQueueItem {
    type: "memory_candidate" | "memory_conflict";
    partition: MemoryPartitionKey;
    /** Internal typed recovery data; stripped from the ordinary Queue view. */
    governanceAdmission?: MemoryQueueAdmissionEnvelope;
    /** Exact original syncable queue ID; internal and text-free. */
    legacyCompatibilityItemFingerprint?: string;
}

export type MemoryProjectionTarget =
    | { kind: "review_queue"; itemId: string }
    | { kind: "type_a_profile"; profileRecordId: string }
    | { kind: "prompt_projection"; projectionId: string };

export interface MemoryProjectionLink {
    id: string;
    claimId: string;
    target: MemoryProjectionTarget;
    relation: "origin" | "derived_copy" | "corrects" | "supersedes";
    state: "active" | "redacted";
    sourceFingerprintId?: string;
    /** Exact admission-rule lineage; never derived from summary text. */
    ruleFingerprint?: string;
    createdAt: string;
}

export interface MemoryChangeEvent {
    id: string;
    claimId: string;
    kind: typeof CHANGE_KINDS[number];
    scopeKey: string;
    effect: MemoryControlCenterEffect;
    occurredAt: string;
    undoSnapshotId?: string;
    /** Exact original event for an idempotent Undo receipt. */
    undoesEventId?: string;
}

interface MemoryUndoSnapshotBase {
    id: string;
    claimId: string;
    eventId: string;
    partition: MemoryPartitionKey;
    createdAt: string;
    expiresAt: string;
}

/** Protected, bounded recovery state for restoring an existing claim. */
export interface MemoryRestoreExistingUndoSnapshot extends MemoryUndoSnapshotBase {
    /** Missing on snapshots written before this discriminator was introduced. */
    restoreMode?: "restore_existing";
    claim: GovernedMemoryClaim;
    revisions: MemoryClaimRevision[];
    projectionLinks: MemoryProjectionLink[];
}

/**
 * Text-free recovery state for an automatic addition. Undo restores the prior
 * absence by retracting the added claim and cleaning its exact projections.
 */
export interface MemoryRemoveAddedClaimUndoSnapshot extends MemoryUndoSnapshotBase {
    restoreMode: "remove_added_claim";
    revisions: [];
    /** Exact, text-free projection instructions created by this addition. */
    projectionLinks: MemoryProjectionLink[];
}

export type MemoryUndoSnapshot =
    | MemoryRestoreExistingUndoSnapshot
    | MemoryRemoveAddedClaimUndoSnapshot;

/** Text-free source/rule-bound marker used to prevent unchanged relearning. */
export interface MemorySuppressionMarker {
    id: string;
    partition: MemoryPartitionKey;
    sourceFingerprintId: string;
    ruleFingerprint: string;
    reason: "forgotten" | "rejected" | "corrected";
    createdAt: string;
    updatedAt: string;
}

export interface MemoryForgetOperation {
    id: string;
    kind: "forget";
    claimId: string;
    partition: MemoryPartitionKey;
    suppressionMarkerIds: string[];
    targets: Array<{ projectionLinkId: string; state: "pending" | "done" }>;
    phase: "blocked" | "claim_redacted" | "linked_copies_redacted"
        | "recovery_payloads_redacted" | "projections_reconciled";
    attemptCount: number;
    createdAt: string;
    updatedAt: string;
    lastErrorCode?: string;
    legacyCompatibility?: LegacyMemoryCompatibilityIdentity & {
        state: "pending" | "prepared" | "done";
        expectedSourceHash?: string;
        resultingSourceHash?: string;
        preservePendingReconciliation?: boolean;
    };
}

interface MemoryProfileProjectionOperationBase {
    id: string;
    kind: "profile_projection";
    claimId: string;
    profileRecordId: string;
    state: "pending" | "applied";
    attemptCount: number;
    createdAt: string;
    updatedAt: string;
    lastErrorCode?: string;
}

export interface MemoryProfileProjectionUpsertOperation extends MemoryProfileProjectionOperationBase {
    /** Missing on legacy outbox rows, which are always upserts. */
    action?: "upsert";
    targetRevisionId: string;
}

export interface MemoryProfileProjectionRemoveOperation extends MemoryProfileProjectionOperationBase {
    action: "remove";
    projectionLinkId: string;
    /** Vault-local Profile store that owns the exact external copy. */
    ownerVaultKey?: string;
}

export type MemoryProfileProjectionOperation =
    | MemoryProfileProjectionUpsertOperation
    | MemoryProfileProjectionRemoveOperation;

export type MemoryPendingOperation = MemoryForgetOperation | MemoryProfileProjectionOperation;

export interface MemoryAdmissionPolicyState {
    version: 1;
    mode: "legacy_threshold" | "effect_based";
    contextProjectionMode: "legacy" | "governed";
    legacyBaseline?: {
        confirmedCount: number;
        threshold: 30;
        autoAcceptPaused: boolean;
        importedFromSourceHash: string;
    };
    /** Opaque conversation fingerprint -> last fully processed turn index. */
    typeAProcessedTurns?: Record<string, number>;
}

export interface MemoryMigrationState {
    migrationRunId: string;
    phase: typeof MIGRATION_PHASES[number];
    sourceHash?: string;
    /** Hash of the current verified compatibility source after exact redactions. */
    legacySourceStateHash?: string;
    cutoverSequence?: number;
    rollbackExpiresAt?: string;
    lastAppliedDeltaSequence?: number;
    /** New syncable legacy source awaiting explicit deterministic reconciliation. */
    pendingLegacySourceHash?: string;
    lastErrorCode?: string;
}

export interface MemoryMigrationDelta {
    sequence: number;
    migrationRunId: string;
    partition: MemoryPartitionKey;
    committedAt: string;
    kind: typeof DELTA_KINDS[number];
    entityId: string;
    payloadEntryId?: string;
    payloadChecksum?: string;
}

export type LegacyRollbackValue =
    | { kind: "claim"; record: ConfirmedMemoryRecord }
    | { kind: "memory_queue"; item: ReviewQueueItem }
    | {
        kind: "policy";
        confirmedMemoryCount: number;
        memoryAutoAcceptPaused: boolean;
    };

export interface MemoryRollbackPayloadEntry {
    id: string;
    migrationRunId: string;
    partition: MemoryPartitionKey;
    entityId: string;
    value: LegacyRollbackValue;
    checksum: string;
    expiresAt: string;
}

export interface DeviceMemoryGovernanceStateV1 {
    schemaVersion: 1;
    commitSequence: number;
    claims: GovernedMemoryClaim[];
    revisions: MemoryClaimRevision[];
    memoryQueueItems: DeviceMemoryQueueItem[];
    projectionLinks: MemoryProjectionLink[];
    changeEvents: MemoryChangeEvent[];
    undoSnapshots: MemoryUndoSnapshot[];
    suppressionMarkers: MemorySuppressionMarker[];
    pendingOperations: MemoryPendingOperation[];
    policyStates: Record<OpaqueVaultKey, MemoryAdmissionPolicyState>;
    migrationStates: Record<OpaqueVaultKey, MemoryMigrationState>;
    migrationDeltas: MemoryMigrationDelta[];
    rollbackPayloadEntries: MemoryRollbackPayloadEntry[];
}

/**
 * The callback may be re-run after a cross-connection CAS conflict. It must be
 * retry-safe and limit side effects to the supplied draft.
 */
export type MemoryGovernanceTransaction<T> = (
    draft: DeviceMemoryGovernanceStateV1,
) => T | Promise<T>;

export interface MemoryGovernanceRepository {
    initialize(): Promise<DeviceMemoryGovernanceStateV1>;
    transact<T>(operation: MemoryGovernanceTransaction<T>): Promise<T>;
    subscribe(listener: (commitSequence: number) => void): () => void;
    dispose(): Promise<void>;
}

export type DeviceMemoryGovernanceStateValidationResult =
    | { ok: true }
    | { ok: false; reason: string };

export type MemoryGovernancePersistenceErrorCode =
    | "repository_disposed"
    | "storage_unavailable"
    | "database_open_failed"
    | "database_open_blocked"
    | "database_open_timeout"
    | "database_read_failed"
    | "database_write_failed"
    | "commit_conflict"
    | "invalid_state";

export class MemoryGovernancePersistenceError extends Error {
    constructor(readonly code: MemoryGovernancePersistenceErrorCode) {
        super(`Memory governance persistence failed: ${code}`);
        this.name = "MemoryGovernancePersistenceError";
    }
}

export function createEmptyDeviceMemoryGovernanceStateV1(): DeviceMemoryGovernanceStateV1 {
    return {
        schemaVersion: MEMORY_GOVERNANCE_SCHEMA_VERSION,
        commitSequence: 0,
        claims: [],
        revisions: [],
        memoryQueueItems: [],
        projectionLinks: [],
        changeEvents: [],
        undoSnapshots: [],
        suppressionMarkers: [],
        pendingOperations: [],
        policyStates: {},
        migrationStates: {},
        migrationDeltas: [],
        rollbackPayloadEntries: [],
    };
}

export function normalizeDeviceMemoryGovernanceStateV1(
    value: unknown,
): DeviceMemoryGovernanceStateV1 | null {
    const parsed = parseDeviceMemoryGovernanceStateV1(value);
    return parsed.ok ? parsed.value : null;
}

export function validateDeviceMemoryGovernanceStateV1(
    value: unknown,
): DeviceMemoryGovernanceStateValidationResult {
    const parsed = parseDeviceMemoryGovernanceStateV1(value);
    return parsed.ok ? { ok: true } : { ok: false, reason: parsed.reason };
}

export function cloneDeviceMemoryGovernanceStateV1(
    state: DeviceMemoryGovernanceStateV1,
): DeviceMemoryGovernanceStateV1 {
    const clone = normalizeDeviceMemoryGovernanceStateV1(state);
    if (!clone) throw new MemoryGovernancePersistenceError("invalid_state");
    return clone;
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

function parseDeviceMemoryGovernanceStateV1(value: unknown): ParseResult<DeviceMemoryGovernanceStateV1> {
    if (!isRecord(value)) return invalid("state_not_object");
    if (value.schemaVersion !== MEMORY_GOVERNANCE_SCHEMA_VERSION) return invalid("unsupported_schema_version");
    if (!isNonNegativeSafeInteger(value.commitSequence)) return invalid("invalid_commit_sequence");

    const claims = parseArray(value.claims, parseClaim, "invalid_claim");
    if (!claims.ok) return claims;
    const revisions = parseArray(value.revisions, parseRevision, "invalid_revision");
    if (!revisions.ok) return revisions;
    const memoryQueueItems = parseArray(value.memoryQueueItems, parseMemoryQueueItem, "invalid_memory_queue_item");
    if (!memoryQueueItems.ok) return memoryQueueItems;
    const projectionLinks = parseArray(value.projectionLinks, parseProjectionLink, "invalid_projection_link");
    if (!projectionLinks.ok) return projectionLinks;
    const changeEvents = parseArray(value.changeEvents, parseChangeEvent, "invalid_change_event");
    if (!changeEvents.ok) return changeEvents;
    const undoSnapshots = parseArray(value.undoSnapshots, parseUndoSnapshot, "invalid_undo_snapshot");
    if (!undoSnapshots.ok) return undoSnapshots;
    const suppressionMarkers = parseArray(value.suppressionMarkers, parseSuppressionMarker, "invalid_suppression_marker");
    if (!suppressionMarkers.ok) return suppressionMarkers;
    const pendingOperations = parseArray(value.pendingOperations, parsePendingOperation, "invalid_pending_operation");
    if (!pendingOperations.ok) return pendingOperations;
    const policyStates = parseRecordMap(value.policyStates, parsePolicyState, "invalid_policy_state");
    if (!policyStates.ok) return policyStates;
    const migrationStates = parseRecordMap(value.migrationStates, parseMigrationState, "invalid_migration_state");
    if (!migrationStates.ok) return migrationStates;
    const migrationDeltas = parseArray(value.migrationDeltas, parseMigrationDelta, "invalid_migration_delta");
    if (!migrationDeltas.ok) return migrationDeltas;
    const rollbackPayloadEntries = parseArray(value.rollbackPayloadEntries, parseRollbackPayloadEntry, "invalid_rollback_payload");
    if (!rollbackPayloadEntries.ok) return rollbackPayloadEntries;

    const state: DeviceMemoryGovernanceStateV1 = {
        schemaVersion: MEMORY_GOVERNANCE_SCHEMA_VERSION,
        commitSequence: value.commitSequence,
        claims: claims.value,
        revisions: revisions.value,
        memoryQueueItems: memoryQueueItems.value,
        projectionLinks: projectionLinks.value,
        changeEvents: changeEvents.value,
        undoSnapshots: undoSnapshots.value,
        suppressionMarkers: suppressionMarkers.value,
        pendingOperations: pendingOperations.value,
        policyStates: policyStates.value,
        migrationStates: migrationStates.value,
        migrationDeltas: migrationDeltas.value,
        rollbackPayloadEntries: rollbackPayloadEntries.value,
    };
    return validateStateIntegrity(state);
}

function validateStateIntegrity(state: DeviceMemoryGovernanceStateV1): ParseResult<DeviceMemoryGovernanceStateV1> {
    for (const [field, values] of [
        ["claims", state.claims],
        ["revisions", state.revisions],
        ["memory_queue_items", state.memoryQueueItems],
        ["projection_links", state.projectionLinks],
        ["change_events", state.changeEvents],
        ["undo_snapshots", state.undoSnapshots],
        ["suppression_markers", state.suppressionMarkers],
        ["pending_operations", state.pendingOperations],
        ["rollback_payload_entries", state.rollbackPayloadEntries],
    ] as const) {
        if (hasDuplicateStrings(values.map((entry) => entry.id))) return invalid(`${field}_duplicate_id`);
    }
    if (hasDuplicateStrings(state.migrationDeltas.map((delta) => `${delta.migrationRunId}\u0000${delta.sequence}`))) {
        return invalid("migration_deltas_duplicate_sequence");
    }

    const claimById = new Map(state.claims.map((claim) => [claim.id, claim]));
    const revisionById = new Map(state.revisions.map((revision) => [revision.id, revision]));
    const linkById = new Map(state.projectionLinks.map((link) => [link.id, link]));
    const eventById = new Map(state.changeEvents.map((event) => [event.id, event]));
    const undoById = new Map(state.undoSnapshots.map((snapshot) => [snapshot.id, snapshot]));
    const markerById = new Map(state.suppressionMarkers.map((marker) => [marker.id, marker]));
    const rollbackById = new Map(state.rollbackPayloadEntries.map((entry) => [entry.id, entry]));

    for (const claim of state.claims) {
        if (claim.lifecycle === "forgotten_tombstone" && claim.activeRevisionId) {
            return invalid("forgotten_claim_has_active_revision");
        }
        if (claim.lifecycle === "undone_add_tombstone" && claim.activeRevisionId) {
            return invalid("undone_add_claim_has_active_revision");
        }
        if (claim.activeRevisionId) {
            const revision = revisionById.get(claim.activeRevisionId);
            if (!revision || revision.claimId !== claim.id) return invalid("claim_active_revision_missing");
        }
    }
    for (const revision of state.revisions) {
        if (!claimById.has(revision.claimId)) return invalid("revision_claim_missing");
        if (claimById.get(revision.claimId)?.lifecycle === "undone_add_tombstone") {
            return invalid("undone_add_claim_has_revision");
        }
        if (revision.supersedesRevisionId) {
            const superseded = revisionById.get(revision.supersedesRevisionId);
            if (!superseded || superseded.claimId !== revision.claimId) {
                return invalid("revision_supersedes_missing");
            }
        }
    }
    for (const link of state.projectionLinks) {
        if (!claimById.has(link.claimId)) return invalid("projection_link_claim_missing");
        if (claimById.get(link.claimId)?.lifecycle === "undone_add_tombstone" && link.state === "active") {
            return invalid("undone_add_claim_has_active_link");
        }
    }
    for (const event of state.changeEvents) {
        if (!claimById.has(event.claimId)) return invalid("change_event_claim_missing");
        if (event.kind === "forget" && event.undoSnapshotId) return invalid("forget_event_has_undo_snapshot");
        if (event.undoSnapshotId) {
            const snapshot = undoById.get(event.undoSnapshotId);
            if (!snapshot || snapshot.eventId !== event.id || snapshot.claimId !== event.claimId) {
                return invalid("change_event_undo_snapshot_missing");
            }
            if (event.kind === "add" && snapshot.restoreMode !== "remove_added_claim") {
                return invalid("add_event_undo_snapshot_invalid");
            }
            if (snapshot.restoreMode === "remove_added_claim" && event.kind !== "add") {
                return invalid("remove_added_snapshot_event_invalid");
            }
        }
        if (event.undoesEventId) {
            const original = eventById.get(event.undoesEventId);
            if (event.kind !== "undo" || !original || original.claimId !== event.claimId
                || original.occurredAt > event.occurredAt) {
                return invalid("undo_event_original_missing");
            }
        }
    }
    for (const snapshot of state.undoSnapshots) {
        const event = eventById.get(snapshot.eventId);
        if (!event || event.claimId !== snapshot.claimId || event.undoSnapshotId !== snapshot.id) {
            return invalid("undo_snapshot_event_missing");
        }
        if (!claimById.has(snapshot.claimId)) return invalid("undo_snapshot_claim_missing");
    }
    const preparedLegacyMutationVaults = new Set<string>();
    for (const operation of state.pendingOperations) {
        if (!claimById.has(operation.claimId)) return invalid("pending_operation_claim_missing");
        if (operation.kind === "profile_projection") {
            if (operation.action === "remove") {
                const link = linkById.get(operation.projectionLinkId);
                if (!link || link.claimId !== operation.claimId
                    || link.target.kind !== "type_a_profile"
                    || link.target.profileRecordId !== operation.profileRecordId) {
                    return invalid("profile_remove_operation_link_missing");
                }
            } else {
                const revision = revisionById.get(operation.targetRevisionId);
                if (!revision || revision.claimId !== operation.claimId) {
                    return invalid("profile_operation_revision_missing");
                }
            }
        } else {
            if (operation.suppressionMarkerIds.some((id) => !markerById.has(id))) {
                return invalid("forget_operation_marker_missing");
            }
            if (operation.targets.some((target) => !linkById.has(target.projectionLinkId))) {
                return invalid("forget_operation_target_missing");
            }
            if (operation.legacyCompatibility?.state === "prepared") {
                if (operation.partition.kind !== "vault"
                    || preparedLegacyMutationVaults.has(operation.partition.key)) {
                    return invalid("legacy_mutation_lock_collision");
                }
                preparedLegacyMutationVaults.add(operation.partition.key);
            }
        }
    }
    for (const delta of state.migrationDeltas) {
        const isTextFreeRemoval = delta.kind === "claim_forgotten"
            || delta.kind === "claim_removed"
            || delta.kind === "queue_removed";
        if (isTextFreeRemoval && (delta.payloadEntryId || delta.payloadChecksum)) {
            return invalid("removal_delta_contains_payload");
        }
        if (!isTextFreeRemoval && (!delta.payloadEntryId || !delta.payloadChecksum)) {
            return invalid("migration_delta_payload_missing");
        }
        if ((delta.payloadEntryId === undefined) !== (delta.payloadChecksum === undefined)) {
            return invalid("migration_delta_payload_incomplete");
        }
        if (delta.payloadEntryId) {
            const payload = rollbackById.get(delta.payloadEntryId);
            if (!payload
                || payload.checksum !== delta.payloadChecksum
                || payload.migrationRunId !== delta.migrationRunId
                || payload.entityId !== delta.entityId
                || !partitionsEqual(payload.partition, delta.partition)) {
                return invalid("migration_delta_payload_mismatch");
            }
        }
    }
    return { ok: true, value: state };
}

function parseClaim(value: unknown): GovernedMemoryClaim | null {
    if (!isRecord(value) || hasForbiddenPersistedTextFields(value)) return null;
    const id = requiredString(value.id);
    const partition = parsePartition(value.partition);
    const applicability = parseScope(value.applicability);
    const createdAt = requiredString(value.createdAt);
    const updatedAt = requiredString(value.updatedAt);
    if (!id || !partition || !applicability || !createdAt || !updatedAt) return null;
    if (!includesString(MEMORY_TYPES, value.memoryType)) return null;
    if (!includesString(MEMORY_SENSITIVITIES, value.sensitivity)) return null;
    if (!includesString(EFFECTS, value.effect)) return null;
    if (!includesString(CLAIM_LIFECYCLES, value.lifecycle)) return null;
    const activeRevisionId = optionalString(value.activeRevisionId);
    if (value.activeRevisionId !== undefined && !activeRevisionId) return null;
    const legacyCompatibility = value.legacyCompatibility === undefined
        ? undefined
        : parseLegacyCompatibilityIdentity(value.legacyCompatibility);
    if (value.legacyCompatibility !== undefined && !legacyCompatibility) return null;
    return {
        id,
        partition,
        memoryType: value.memoryType,
        sensitivity: value.sensitivity,
        applicability,
        ...(activeRevisionId ? { activeRevisionId } : {}),
        effect: value.effect,
        lifecycle: value.lifecycle,
        createdAt,
        updatedAt,
        ...(legacyCompatibility ? { legacyCompatibility } : {}),
    };
}

function parseRevision(value: unknown): MemoryClaimRevision | null {
    if (!isRecord(value) || hasForbiddenPersistedTextFields(value)) return null;
    const id = requiredString(value.id);
    const claimId = requiredString(value.claimId);
    const createdAt = requiredString(value.createdAt);
    if (!id || !claimId || typeof value.summary !== "string" || !createdAt) return null;
    if (!includesString(AUTHORITIES, value.authority)) return null;
    const provenance = parseArray(value.provenance, parseProvenance, "invalid_provenance");
    if (!provenance.ok) return null;
    const supersedesRevisionId = optionalString(value.supersedesRevisionId);
    if (value.supersedesRevisionId !== undefined && !supersedesRevisionId) return null;
    return {
        id,
        claimId,
        summary: value.summary,
        provenance: provenance.value,
        authority: value.authority,
        ...(supersedesRevisionId ? { supersedesRevisionId } : {}),
        createdAt,
    };
}

function parseProvenance(value: unknown): PersistedMemoryProvenance | null {
    if (!isRecord(value) || hasForbiddenPersistedTextFields(value)) return null;
    if (value.kind === "note") {
        const sourceRef = parseSourceRef(value.sourceRef);
        return sourceRef ? { kind: "note", sourceRef } : null;
    }
    if (value.kind === "conversation") {
        const conversationIds = parseNonEmptyStringArray(value.conversationIds);
        const observedAt = requiredString(value.observedAt);
        return conversationIds && observedAt
            ? { kind: "conversation", conversationIds, observedAt }
            : null;
    }
    if (value.kind === "explicit_setting") {
        const settingKey = requiredString(value.settingKey);
        return settingKey ? { kind: "explicit_setting", settingKey } : null;
    }
    if (value.kind === "vault_aggregate") {
        const generatedAt = requiredString(value.generatedAt);
        const fingerprint = requiredString(value.dataBoundaryFingerprint);
        const sourceRefs = parseArray(value.representativeSourceRefs, parseSourceRef, "invalid_source_ref");
        if (!generatedAt || !fingerprint || !isNonNegativeSafeInteger(value.includedFileCount)
            || !includesString(["exact", "representative", "aggregate_only"] as const, value.coverage)
            || !sourceRefs.ok) return null;
        return {
            kind: "vault_aggregate",
            generatedAt,
            dataBoundaryFingerprint: fingerprint,
            includedFileCount: value.includedFileCount,
            coverage: value.coverage,
            representativeSourceRefs: sourceRefs.value,
        };
    }
    return null;
}

function parseMemoryQueueItem(value: unknown): DeviceMemoryQueueItem | null {
    if (!isRecord(value) || hasForbiddenPersistedTextFields(value)) return null;
    if (value.type !== "memory_candidate" && value.type !== "memory_conflict") return null;
    if (!validateReviewQueueItemBase(value).ok) return null;
    if (typeof value.title !== "string" || typeof value.claim !== "string") return null;
    const partition = parsePartition(value.partition);
    const scope = parseScope(value.scope);
    const sourceRefs = parseArray(value.sourceRefs, parseSourceRef, "invalid_source_ref");
    const whyShown = parseStringArray(value.whyShown);
    const metadata = parseMetadata(value.metadata);
    if (!partition || !scope || !sourceRefs.ok || !whyShown || metadata === null) return null;
    const item: DeviceMemoryQueueItem = {
        id: value.id as string,
        type: value.type,
        partition,
        title: value.title,
        claim: value.claim,
        scope,
        sourceRefs: sourceRefs.value,
        originSurface: value.originSurface as DeviceMemoryQueueItem["originSurface"],
        priority: value.priority as DeviceMemoryQueueItem["priority"],
        status: value.status as DeviceMemoryQueueItem["status"],
        createdAt: value.createdAt as string,
        updatedAt: value.updatedAt as string,
        whyShown,
        dataBoundarySnapshotId: value.dataBoundarySnapshotId as string,
    };
    if (value.admissionReason !== undefined) item.admissionReason = value.admissionReason as DeviceMemoryQueueItem["admissionReason"];
    if (value.replayRef !== undefined) item.replayRef = value.replayRef as string;
    if (metadata) item.metadata = metadata;
    if (value.governanceAdmission !== undefined) {
        const governanceAdmission = parseMemoryQueueAdmission(value.governanceAdmission);
        if (!governanceAdmission) return null;
        item.governanceAdmission = governanceAdmission;
    }
    if (value.legacyCompatibilityItemFingerprint !== undefined) {
        const fingerprint = optionalString(value.legacyCompatibilityItemFingerprint);
        if (!fingerprint || !/^legacy-id-v1:[a-f0-9]{32}$/.test(fingerprint)) return null;
        item.legacyCompatibilityItemFingerprint = fingerprint;
    }
    if (value.snoozedUntil !== undefined) {
        const snoozedUntil = optionalString(value.snoozedUntil);
        if (!snoozedUntil) return null;
        item.snoozedUntil = snoozedUntil;
    }
    return item;
}

function parseMemoryQueueAdmission(value: unknown): MemoryQueueAdmissionEnvelope | null {
    if (!isRecord(value) || value.version !== 1) return null;
    if (value.origin !== "type_a" && value.origin !== "memory_candidate") return null;
    if (!includesString(MEMORY_TYPES, value.memoryType)
        || !includesString(MEMORY_SENSITIVITIES, value.sensitivity)
        || !includesString(AUTHORITIES, value.authority)
        || !includesString(EFFECTS, value.effect)) return null;
    const applicability = parseScope(value.applicability);
    const provenance = parseArray(value.provenance, parseProvenance, "invalid_provenance");
    const sourceFingerprintId = requiredString(value.sourceFingerprintId);
    const ruleFingerprint = requiredString(value.ruleFingerprint);
    const admissionKey = requiredString(value.admissionKey);
    const profileRecordId = optionalString(value.profileRecordId);
    if (!applicability || !provenance.ok || provenance.value.length === 0
        || !sourceFingerprintId || !ruleFingerprint || !admissionKey
        || (value.profileRecordId !== undefined && !profileRecordId)) return null;
    return {
        version: 1,
        origin: value.origin,
        memoryType: value.memoryType,
        sensitivity: value.sensitivity,
        authority: value.authority,
        effect: value.effect,
        applicability,
        provenance: provenance.value,
        sourceFingerprintId,
        ruleFingerprint,
        admissionKey,
        ...(profileRecordId ? { profileRecordId } : {}),
    };
}

function parseProjectionLink(value: unknown): MemoryProjectionLink | null {
    if (!isRecord(value) || hasForbiddenPersistedTextFields(value)) return null;
    const id = requiredString(value.id);
    const claimId = requiredString(value.claimId);
    const target = parseProjectionTarget(value.target);
    const createdAt = requiredString(value.createdAt);
    if (!id || !claimId || !target || !createdAt) return null;
    if (!includesString(["origin", "derived_copy", "corrects", "supersedes"] as const, value.relation)) return null;
    if (!includesString(["active", "redacted"] as const, value.state)) return null;
    const sourceFingerprintId = optionalString(value.sourceFingerprintId);
    const ruleFingerprint = optionalString(value.ruleFingerprint);
    if (value.sourceFingerprintId !== undefined && !sourceFingerprintId) return null;
    if (value.ruleFingerprint !== undefined && !ruleFingerprint) return null;
    return {
        id,
        claimId,
        target,
        relation: value.relation,
        state: value.state,
        ...(sourceFingerprintId ? { sourceFingerprintId } : {}),
        ...(ruleFingerprint ? { ruleFingerprint } : {}),
        createdAt,
    };
}

function parseProjectionTarget(value: unknown): MemoryProjectionTarget | null {
    if (!isRecord(value)) return null;
    if (value.kind === "review_queue") {
        const itemId = requiredString(value.itemId);
        return itemId ? { kind: "review_queue", itemId } : null;
    }
    if (value.kind === "type_a_profile") {
        const profileRecordId = requiredString(value.profileRecordId);
        return profileRecordId ? { kind: "type_a_profile", profileRecordId } : null;
    }
    if (value.kind === "prompt_projection") {
        const projectionId = requiredString(value.projectionId);
        return projectionId ? { kind: "prompt_projection", projectionId } : null;
    }
    return null;
}

function parseChangeEvent(value: unknown): MemoryChangeEvent | null {
    if (!isRecord(value) || hasForbiddenPersistedTextFields(value)) return null;
    const id = requiredString(value.id);
    const claimId = requiredString(value.claimId);
    const scopeKey = requiredString(value.scopeKey);
    const occurredAt = requiredString(value.occurredAt);
    if (!id || !claimId || !scopeKey || !occurredAt) return null;
    if (!includesString(CHANGE_KINDS, value.kind) || !includesString(EFFECTS, value.effect)) return null;
    const undoSnapshotId = optionalString(value.undoSnapshotId);
    if (value.undoSnapshotId !== undefined && !undoSnapshotId) return null;
    const undoesEventId = optionalString(value.undoesEventId);
    if (value.undoesEventId !== undefined && !undoesEventId) return null;
    return {
        id,
        claimId,
        kind: value.kind,
        scopeKey,
        effect: value.effect,
        occurredAt,
        ...(undoSnapshotId ? { undoSnapshotId } : {}),
        ...(undoesEventId ? { undoesEventId } : {}),
    };
}

function parseUndoSnapshot(value: unknown): MemoryUndoSnapshot | null {
    if (!isRecord(value) || hasForbiddenPersistedTextFields(value)) return null;
    const id = requiredString(value.id);
    const claimId = requiredString(value.claimId);
    const eventId = requiredString(value.eventId);
    const partition = parsePartition(value.partition);
    const revisions = parseArray(value.revisions, parseRevision, "invalid_revision");
    const links = parseArray(value.projectionLinks, parseProjectionLink, "invalid_projection_link");
    const createdAt = requiredString(value.createdAt);
    const expiresAt = requiredString(value.expiresAt);
    if (!id || !claimId || !eventId || !partition || !revisions.ok || !links.ok
        || !createdAt || !expiresAt) return null;
    if (revisions.value.some((revision) => revision.claimId !== claimId)) return null;
    if (links.value.some((link) => link.claimId !== claimId)) return null;
    if (hasDuplicateStrings(revisions.value.map((revision) => revision.id))
        || hasDuplicateStrings(links.value.map((link) => link.id))) return null;

    if (value.restoreMode === "remove_added_claim") {
        if (value.claim !== undefined || revisions.value.length > 0 || links.value.length === 0) return null;
        if (links.value.some((link) => (
            link.claimId !== claimId
            || link.state !== "active"
            || !link.sourceFingerprintId
            || !link.ruleFingerprint
        ))) return null;
        return {
            id,
            claimId,
            eventId,
            partition,
            restoreMode: "remove_added_claim",
            revisions: [],
            projectionLinks: links.value,
            createdAt,
            expiresAt,
        };
    }
    if (value.restoreMode !== undefined && value.restoreMode !== "restore_existing") return null;
    const claim = parseClaim(value.claim);
    if (!claim || claim.id !== claimId || !partitionsEqual(partition, claim.partition)) return null;
    if (claim.activeRevisionId
        && !revisions.value.some((revision) => revision.id === claim.activeRevisionId)) return null;
    return {
        id,
        claimId,
        eventId,
        partition,
        ...(value.restoreMode === "restore_existing" ? { restoreMode: "restore_existing" as const } : {}),
        claim,
        revisions: revisions.value,
        projectionLinks: links.value,
        createdAt,
        expiresAt,
    };
}

function parseSuppressionMarker(value: unknown): MemorySuppressionMarker | null {
    if (!isRecord(value) || hasForbiddenPersistedTextFields(value)) return null;
    const id = requiredString(value.id);
    const partition = parsePartition(value.partition);
    const sourceFingerprintId = requiredString(value.sourceFingerprintId);
    const ruleFingerprint = requiredString(value.ruleFingerprint);
    const createdAt = requiredString(value.createdAt);
    const updatedAt = requiredString(value.updatedAt);
    if (!id || !partition || !sourceFingerprintId || !ruleFingerprint || !createdAt || !updatedAt) return null;
    if (!includesString(["forgotten", "rejected", "corrected"] as const, value.reason)) return null;
    return { id, partition, sourceFingerprintId, ruleFingerprint, reason: value.reason, createdAt, updatedAt };
}

function parsePendingOperation(value: unknown): MemoryPendingOperation | null {
    if (!isRecord(value) || hasForbiddenPersistedTextFields(value)) return null;
    const id = requiredString(value.id);
    const claimId = requiredString(value.claimId);
    const createdAt = requiredString(value.createdAt);
    const updatedAt = requiredString(value.updatedAt);
    if (!id || !claimId || !createdAt || !updatedAt || !isNonNegativeSafeInteger(value.attemptCount)) return null;
    const lastErrorCode = optionalString(value.lastErrorCode);
    if (value.lastErrorCode !== undefined && !lastErrorCode) return null;
    if (value.kind === "profile_projection") {
        const profileRecordId = requiredString(value.profileRecordId);
        if (!profileRecordId || !includesString(["pending", "applied"] as const, value.state)) return null;
        const base: MemoryProfileProjectionOperationBase = {
            id,
            kind: "profile_projection",
            claimId,
            profileRecordId,
            state: value.state,
            attemptCount: value.attemptCount,
            createdAt,
            updatedAt,
            ...(lastErrorCode ? { lastErrorCode } : {}),
        };
        if (value.action === "remove") {
            if (value.targetRevisionId !== undefined) return null;
            const projectionLinkId = requiredString(value.projectionLinkId);
            if (!projectionLinkId) return null;
            const ownerVaultKey = optionalString(value.ownerVaultKey);
            if (value.ownerVaultKey !== undefined && !ownerVaultKey) return null;
            return {
                ...base,
                action: "remove",
                projectionLinkId,
                ...(ownerVaultKey ? { ownerVaultKey } : {}),
            };
        }
        if (value.ownerVaultKey !== undefined) return null;
        if (value.projectionLinkId !== undefined) return null;
        if (value.action !== undefined && value.action !== "upsert") return null;
        const targetRevisionId = requiredString(value.targetRevisionId);
        if (!targetRevisionId) return null;
        return {
            ...base,
            ...(value.action === "upsert" ? { action: "upsert" as const } : {}),
            targetRevisionId,
        };
    }
    if (value.kind === "forget") {
        const partition = parsePartition(value.partition);
        const markerIds = parseNonEmptyStringArray(value.suppressionMarkerIds);
        const targets = parseArray(value.targets, parseForgetTarget, "invalid_forget_target");
        if (!partition || !markerIds || !targets.ok
            || !includesString(["blocked", "claim_redacted", "linked_copies_redacted", "recovery_payloads_redacted", "projections_reconciled"] as const, value.phase)) return null;
        const legacyCompatibility = value.legacyCompatibility === undefined
            ? undefined
            : parseForgetLegacyCompatibility(value.legacyCompatibility);
        if (value.legacyCompatibility !== undefined && !legacyCompatibility) return null;
        return {
            id,
            kind: "forget",
            claimId,
            partition,
            suppressionMarkerIds: markerIds,
            targets: targets.value,
            phase: value.phase,
            attemptCount: value.attemptCount,
            createdAt,
            updatedAt,
            ...(lastErrorCode ? { lastErrorCode } : {}),
            ...(legacyCompatibility ? { legacyCompatibility } : {}),
        };
    }
    return null;
}

function parseForgetTarget(value: unknown): MemoryForgetOperation["targets"][number] | null {
    if (!isRecord(value)) return null;
    const projectionLinkId = requiredString(value.projectionLinkId);
    if (!projectionLinkId || !includesString(["pending", "done"] as const, value.state)) return null;
    return { projectionLinkId, state: value.state };
}

function parseLegacyCompatibilityIdentity(
    value: unknown,
): LegacyMemoryCompatibilityIdentity | null {
    if (!isRecord(value) || hasForbiddenPersistedTextFields(value)) return null;
    const recordIdFingerprints = parseNonEmptyStringArray(value.recordIdFingerprints);
    const memoryQueueItemIdFingerprints = parseNonEmptyStringArray(
        value.memoryQueueItemIdFingerprints,
    );
    if (!recordIdFingerprints || !memoryQueueItemIdFingerprints
        || recordIdFingerprints.length + memoryQueueItemIdFingerprints.length === 0
        || hasDuplicateStrings(recordIdFingerprints)
        || hasDuplicateStrings(memoryQueueItemIdFingerprints)
        || [...recordIdFingerprints, ...memoryQueueItemIdFingerprints].some(
            (fingerprint) => !/^legacy-id-v1:[a-f0-9]{32}$/.test(fingerprint),
        )) return null;
    return { recordIdFingerprints, memoryQueueItemIdFingerprints };
}

function parseForgetLegacyCompatibility(
    value: unknown,
): NonNullable<MemoryForgetOperation["legacyCompatibility"]> | null {
    const identity = parseLegacyCompatibilityIdentity(value);
    if (!identity || !isRecord(value)
        || !includesString(["pending", "prepared", "done"] as const, value.state)) return null;
    const expectedSourceHash = optionalString(value.expectedSourceHash);
    const resultingSourceHash = optionalString(value.resultingSourceHash);
    if (value.expectedSourceHash !== undefined && !expectedSourceHash) return null;
    if (value.resultingSourceHash !== undefined && !resultingSourceHash) return null;
    if (value.preservePendingReconciliation !== undefined
        && typeof value.preservePendingReconciliation !== "boolean") return null;
    if (value.state === "prepared" && (!expectedSourceHash || !resultingSourceHash)) return null;
    if (value.state === "pending"
        && (expectedSourceHash || resultingSourceHash
            || value.preservePendingReconciliation !== undefined)) return null;
    if ((expectedSourceHash === undefined) !== (resultingSourceHash === undefined)) return null;
    return {
        ...identity,
        state: value.state,
        ...(expectedSourceHash ? { expectedSourceHash } : {}),
        ...(resultingSourceHash ? { resultingSourceHash } : {}),
        ...(value.preservePendingReconciliation !== undefined ? {
            preservePendingReconciliation: value.preservePendingReconciliation,
        } : {}),
    };
}

function parsePolicyState(value: unknown): MemoryAdmissionPolicyState | null {
    if (!isRecord(value) || hasForbiddenPersistedTextFields(value) || value.version !== 1) return null;
    if (!includesString(["legacy_threshold", "effect_based"] as const, value.mode)) return null;
    if (!includesString(["legacy", "governed"] as const, value.contextProjectionMode)) return null;
    const state: MemoryAdmissionPolicyState = {
        version: 1,
        mode: value.mode,
        contextProjectionMode: value.contextProjectionMode,
    };
    if (value.legacyBaseline !== undefined) {
        if (!isRecord(value.legacyBaseline)
            || !isNonNegativeSafeInteger(value.legacyBaseline.confirmedCount)
            || value.legacyBaseline.threshold !== 30
            || typeof value.legacyBaseline.autoAcceptPaused !== "boolean") return null;
        const importedFromSourceHash = requiredString(value.legacyBaseline.importedFromSourceHash);
        if (!importedFromSourceHash) return null;
        state.legacyBaseline = {
            confirmedCount: value.legacyBaseline.confirmedCount,
            threshold: 30,
            autoAcceptPaused: value.legacyBaseline.autoAcceptPaused,
            importedFromSourceHash,
        };
    }
    if (value.typeAProcessedTurns !== undefined) {
        if (!isRecord(value.typeAProcessedTurns)) return null;
        const entries = Object.entries(value.typeAProcessedTurns);
        if (entries.some(([key, throughTurnIndex]) => (
            !key.trim() || !isNonNegativeSafeInteger(throughTurnIndex)
        ))) return null;
        const processedTurns: Record<string, number> = {};
        for (const [key, throughTurnIndex] of entries.sort(([left], [right]) => left.localeCompare(right))) {
            processedTurns[key] = throughTurnIndex as number;
        }
        state.typeAProcessedTurns = processedTurns;
    }
    return state;
}

function parseMigrationState(value: unknown): MemoryMigrationState | null {
    if (!isRecord(value) || hasForbiddenPersistedTextFields(value)) return null;
    const migrationRunId = requiredString(value.migrationRunId);
    if (!migrationRunId || !includesString(MIGRATION_PHASES, value.phase)) return null;
    const result: MemoryMigrationState = { migrationRunId, phase: value.phase };
    for (const key of [
        "sourceHash",
        "legacySourceStateHash",
        "rollbackExpiresAt",
        "pendingLegacySourceHash",
        "lastErrorCode",
    ] as const) {
        if (value[key] !== undefined) {
            const normalized = optionalString(value[key]);
            if (!normalized) return null;
            result[key] = normalized;
        }
    }
    for (const key of ["cutoverSequence", "lastAppliedDeltaSequence"] as const) {
        if (value[key] !== undefined) {
            if (!isNonNegativeSafeInteger(value[key])) return null;
            result[key] = value[key];
        }
    }
    return result;
}

function parseMigrationDelta(value: unknown): MemoryMigrationDelta | null {
    if (!isRecord(value) || hasForbiddenPersistedTextFields(value)) return null;
    const migrationRunId = requiredString(value.migrationRunId);
    const partition = parsePartition(value.partition);
    const committedAt = requiredString(value.committedAt);
    const entityId = requiredString(value.entityId);
    if (!isNonNegativeSafeInteger(value.sequence) || !migrationRunId || !partition || !committedAt || !entityId
        || !includesString(DELTA_KINDS, value.kind)) return null;
    const payloadEntryId = optionalString(value.payloadEntryId);
    const payloadChecksum = optionalString(value.payloadChecksum);
    if ((value.payloadEntryId !== undefined && !payloadEntryId)
        || (value.payloadChecksum !== undefined && !payloadChecksum)) return null;
    return {
        sequence: value.sequence,
        migrationRunId,
        partition,
        committedAt,
        kind: value.kind,
        entityId,
        ...(payloadEntryId ? { payloadEntryId } : {}),
        ...(payloadChecksum ? { payloadChecksum } : {}),
    };
}

function parseRollbackPayloadEntry(value: unknown): MemoryRollbackPayloadEntry | null {
    if (!isRecord(value) || hasForbiddenPersistedTextFields(value)) return null;
    const id = requiredString(value.id);
    const migrationRunId = requiredString(value.migrationRunId);
    const partition = parsePartition(value.partition);
    const entityId = requiredString(value.entityId);
    const rollbackValue = parseRollbackValue(value.value);
    const checksum = requiredString(value.checksum);
    const expiresAt = requiredString(value.expiresAt);
    if (!id || !migrationRunId || !partition || !entityId || !rollbackValue || !checksum || !expiresAt) return null;
    return { id, migrationRunId, partition, entityId, value: rollbackValue, checksum, expiresAt };
}

function parseRollbackValue(value: unknown): LegacyRollbackValue | null {
    if (!isRecord(value) || hasForbiddenPersistedTextFields(value)) return null;
    if (value.kind === "policy") {
        if (!isNonNegativeSafeInteger(value.confirmedMemoryCount)
            || typeof value.memoryAutoAcceptPaused !== "boolean") return null;
        return {
            kind: "policy",
            confirmedMemoryCount: value.confirmedMemoryCount,
            memoryAutoAcceptPaused: value.memoryAutoAcceptPaused,
        };
    }
    if (value.kind === "claim") {
        const validation = validateConfirmedMemoryRecord(value.record as ConfirmedMemoryRecord);
        if (!validation.ok) return null;
        return {
            kind: "claim",
            record: {
                ...validation.value,
                scope: cloneScope(validation.value.scope),
                sourceRefs: validation.value.sourceRefs.map(cloneSourceRef),
            },
        };
    }
    if (value.kind === "memory_queue") {
        const item = parseReviewQueueItem(value.item);
        return item && (item.type === "memory_candidate" || item.type === "memory_conflict")
            ? { kind: "memory_queue", item }
            : null;
    }
    return null;
}

function parseReviewQueueItem(value: unknown): ReviewQueueItem | null {
    if (!isRecord(value) || hasForbiddenPersistedTextFields(value) || !validateReviewQueueItemBase(value).ok) return null;
    if (typeof value.title !== "string" || typeof value.claim !== "string") return null;
    const scope = parseScope(value.scope);
    const sourceRefs = parseArray(value.sourceRefs, parseSourceRef, "invalid_source_ref");
    const whyShown = parseStringArray(value.whyShown);
    const metadata = parseMetadata(value.metadata);
    if (!scope || !sourceRefs.ok || !whyShown || metadata === null) return null;
    const item: ReviewQueueItem = {
        id: value.id as string,
        type: value.type as ReviewQueueItem["type"],
        title: value.title,
        claim: value.claim,
        scope,
        sourceRefs: sourceRefs.value,
        originSurface: value.originSurface as ReviewQueueItem["originSurface"],
        priority: value.priority as ReviewQueueItem["priority"],
        status: value.status as ReviewQueueItem["status"],
        createdAt: value.createdAt as string,
        updatedAt: value.updatedAt as string,
        whyShown,
        dataBoundarySnapshotId: value.dataBoundarySnapshotId as string,
    };
    if (value.admissionReason !== undefined) item.admissionReason = value.admissionReason as ReviewQueueItem["admissionReason"];
    if (value.replayRef !== undefined) item.replayRef = value.replayRef as string;
    if (metadata) item.metadata = metadata;
    if (value.snoozedUntil !== undefined) {
        const snoozedUntil = optionalString(value.snoozedUntil);
        if (!snoozedUntil) return null;
        item.snoozedUntil = snoozedUntil;
    }
    return item;
}

function parsePartition(value: unknown): MemoryPartitionKey | null {
    if (!isRecord(value)) return null;
    if (value.kind === "vault") {
        const key = requiredString(value.key);
        return key ? { kind: "vault", key } : null;
    }
    if (value.kind === "device_collaboration" && value.key === "device") {
        return { kind: "device_collaboration", key: "device" };
    }
    return null;
}

function parseScope(value: unknown): ReviewQueueScope | null {
    if (!isRecord(value) || !includesString(REVIEW_QUEUE_SCOPE_KINDS, value.kind)) return null;
    const result: ReviewQueueScope = { kind: value.kind };
    if (value.label !== undefined) {
        if (typeof value.label !== "string") return null;
        result.label = value.label;
    }
    for (const key of ["paths", "tags"] as const) {
        if (value[key] !== undefined) {
            const values = parseStringArray(value[key]);
            if (!values) return null;
            result[key] = values;
        }
    }
    return result;
}

function parseSourceRef(value: unknown): PersistedSourceRef | null {
    return validateSourceRefPathShape(value).ok
        ? cloneSourceRef(value as PersistedSourceRef)
        : null;
}

function parseMetadata(value: unknown): Record<string, string | number | boolean | null> | null {
    if (value === undefined) return {};
    if (!isRecord(value)) return null;
    const result: Record<string, string | number | boolean | null> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (isUnsafeMapKey(key)) return null;
        if (entry !== null && typeof entry !== "string" && typeof entry !== "number" && typeof entry !== "boolean") {
            return null;
        }
        if (typeof entry === "number" && !Number.isFinite(entry)) return null;
        result[key] = entry;
    }
    return result;
}

function parseArray<T>(
    value: unknown,
    parser: (entry: unknown) => T | null,
    reason: string,
): ParseResult<T[]> {
    if (!Array.isArray(value)) return invalid(reason);
    const result: T[] = [];
    for (const entry of value) {
        const parsed = parser(entry);
        if (!parsed) return invalid(reason);
        result.push(parsed);
    }
    return { ok: true, value: result };
}

function parseRecordMap<T>(
    value: unknown,
    parser: (entry: unknown) => T | null,
    reason: string,
): ParseResult<Record<string, T>> {
    if (!isRecord(value)) return invalid(reason);
    const result: Record<string, T> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (!requiredString(key) || isUnsafeMapKey(key)) return invalid(reason);
        const parsed = parser(entry);
        if (!parsed) return invalid(reason);
        result[key] = parsed;
    }
    return { ok: true, value: result };
}

function parseStringArray(value: unknown): string[] | null {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return null;
    return [...value] as string[];
}

function parseNonEmptyStringArray(value: unknown): string[] | null {
    const values = parseStringArray(value);
    if (!values || values.some((entry) => !requiredString(entry))) return null;
    return values.map((entry) => entry.trim());
}

function requiredString(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function optionalString(value: unknown): string | null {
    return value === undefined ? null : requiredString(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function hasDuplicateStrings(values: readonly string[]): boolean {
    return new Set(values).size !== values.length;
}

function partitionsEqual(left: MemoryPartitionKey, right: MemoryPartitionKey): boolean {
    return left.kind === right.kind && left.key === right.key;
}

function isUnsafeMapKey(key: string): boolean {
    return key === "__proto__" || key === "prototype" || key === "constructor";
}

function invalid<T = never>(reason: string): ParseResult<T> {
    return { ok: false, reason };
}

type SharedBackendCommit<T> = {
    next: DeviceMemoryGovernanceStateV1;
    result: T;
};

export class InMemoryMemoryGovernanceBackend {
    private state: DeviceMemoryGovernanceStateV1;
    private mutationTail: Promise<void> = Promise.resolve();
    private readonly listeners = new Set<(commitSequence: number) => void>();

    constructor(initialState: unknown = createEmptyDeviceMemoryGovernanceStateV1()) {
        const normalized = normalizeDeviceMemoryGovernanceStateV1(initialState);
        if (!normalized) throw new MemoryGovernancePersistenceError("invalid_state");
        this.state = normalized;
    }

    read(): DeviceMemoryGovernanceStateV1 {
        return cloneDeviceMemoryGovernanceStateV1(this.state);
    }

    run<T>(operation: (current: DeviceMemoryGovernanceStateV1) => Promise<SharedBackendCommit<T>>): Promise<T> {
        const run = this.mutationTail.then(async () => {
            const commit = await operation(this.read());
            const next = cloneDeviceMemoryGovernanceStateV1(commit.next);
            this.state = next;
            this.notify(next.commitSequence);
            return commit.result;
        });
        this.mutationTail = run.then(() => undefined, () => undefined);
        return run;
    }

    subscribe(listener: (commitSequence: number) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify(commitSequence: number): void {
        for (const listener of [...this.listeners]) {
            try {
                listener(commitSequence);
            } catch {
                // A subscriber cannot roll back an already committed transaction.
            }
        }
    }
}

export class InMemoryMemoryGovernanceRepository implements MemoryGovernanceRepository {
    private disposed = false;
    private readonly subscriptions = new Set<() => void>();

    constructor(private readonly backend = new InMemoryMemoryGovernanceBackend()) {}

    async initialize(): Promise<DeviceMemoryGovernanceStateV1> {
        this.assertActive();
        return this.backend.read();
    }

    async transact<T>(operation: MemoryGovernanceTransaction<T>): Promise<T> {
        this.assertActive();
        return this.backend.run(async (current) => {
            this.assertActive();
            const draft = cloneDeviceMemoryGovernanceStateV1(current);
            const result = await operation(draft);
            this.assertActive();
            if (current.commitSequence >= Number.MAX_SAFE_INTEGER) {
                throw new MemoryGovernancePersistenceError("invalid_state");
            }
            draft.schemaVersion = MEMORY_GOVERNANCE_SCHEMA_VERSION;
            draft.commitSequence = current.commitSequence + 1;
            const next = normalizeDeviceMemoryGovernanceStateV1(draft);
            if (!next) throw new MemoryGovernancePersistenceError("invalid_state");
            return { next, result };
        });
    }

    subscribe(listener: (commitSequence: number) => void): () => void {
        this.assertActive();
        const unsubscribe = this.backend.subscribe((sequence) => {
            if (!this.disposed) listener(sequence);
        });
        const tracked = () => {
            unsubscribe();
            this.subscriptions.delete(tracked);
        };
        this.subscriptions.add(tracked);
        return tracked;
    }

    async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;
        for (const unsubscribe of [...this.subscriptions]) unsubscribe();
    }

    private assertActive(): void {
        if (this.disposed) throw new MemoryGovernancePersistenceError("repository_disposed");
    }
}

export interface MemoryGovernanceBroadcastChannel {
    onmessage: ((event: MessageEvent<unknown>) => void) | null;
    postMessage(message: unknown): void;
    close(): void;
}

export type MemoryGovernanceBroadcastChannelFactory = (
    name: string,
) => MemoryGovernanceBroadcastChannel;

export interface IndexedDbMemoryGovernanceRepositoryOptions {
    openTimeoutMs?: number;
    maxCommitRetries?: number;
    broadcastChannelFactory?: MemoryGovernanceBroadcastChannelFactory | null;
}

interface PersistedMetaRecord {
    schemaVersion: 1;
    commitSequence: number;
}

interface PersistedMapEntry<T> {
    key: string;
    value: T;
}

interface CommitNotification {
    dbName: string;
    sourceId: string;
    commitSequence: number;
}

type HubListener = (notification: CommitNotification) => void;
const LOCAL_NOTIFICATION_HUBS = new Map<string, Set<HubListener>>();

export class IndexedDbMemoryGovernanceRepository implements MemoryGovernanceRepository {
    private db: IDBDatabase | null = null;
    private openPromise: Promise<IDBDatabase> | null = null;
    private initializePromise: Promise<DeviceMemoryGovernanceStateV1> | null = null;
    private mutationTail: Promise<void> = Promise.resolve();
    private readonly activeTransactions = new Set<IDBTransaction>();
    private disposed = false;
    private disposePromise: Promise<void> | null = null;
    private notificationsAttached = false;
    private channel: MemoryGovernanceBroadcastChannel | null = null;
    private readonly listeners = new Set<(commitSequence: number) => void>();
    private lastNotifiedSequence = 0;
    private readonly sourceId = createRepositorySourceId();
    private readonly openTimeoutMs: number;
    private readonly maxCommitRetries: number;
    private readonly broadcastChannelFactory: MemoryGovernanceBroadcastChannelFactory | null;
    private readonly localHubListener: HubListener;

    constructor(
        private readonly dbName: string,
        private readonly indexedDb: IDBFactory,
        options: IndexedDbMemoryGovernanceRepositoryOptions = {},
    ) {
        if (!requiredString(dbName)) throw new MemoryGovernancePersistenceError("database_open_failed");
        this.openTimeoutMs = Math.max(1, options.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS);
        this.maxCommitRetries = Math.max(1, options.maxCommitRetries ?? DEFAULT_COMMIT_RETRIES);
        this.broadcastChannelFactory = options.broadcastChannelFactory === undefined
            ? getDefaultBroadcastChannelFactory()
            : options.broadcastChannelFactory;
        this.localHubListener = (notification) => this.handleCommitNotification(notification);
    }

    async initialize(): Promise<DeviceMemoryGovernanceStateV1> {
        this.assertActive();
        this.attachNotifications();
        if (!this.initializePromise) {
            const run = this.initializeUnlocked().finally(() => {
                if (this.initializePromise === run) this.initializePromise = null;
            });
            this.initializePromise = run;
        }
        return this.initializePromise.then(cloneDeviceMemoryGovernanceStateV1);
    }

    async transact<T>(operation: MemoryGovernanceTransaction<T>): Promise<T> {
        this.assertActive();
        const run = this.mutationTail.then(async () => {
            this.assertActive();
            await this.initialize();
            for (let attempt = 0; attempt < this.maxCommitRetries; attempt++) {
                this.assertActive();
                const current = await this.readState();
                const draft = cloneDeviceMemoryGovernanceStateV1(current);
                const result = await operation(draft);
                this.assertActive();
                if (current.commitSequence >= Number.MAX_SAFE_INTEGER) {
                    throw new MemoryGovernancePersistenceError("invalid_state");
                }
                draft.schemaVersion = MEMORY_GOVERNANCE_SCHEMA_VERSION;
                draft.commitSequence = current.commitSequence + 1;
                const next = normalizeDeviceMemoryGovernanceStateV1(draft);
                if (!next) throw new MemoryGovernancePersistenceError("invalid_state");
                const committed = await this.compareAndSwap(current.commitSequence, next);
                if (!committed) continue;
                this.publishCommit(next.commitSequence);
                return result;
            }
            throw new MemoryGovernancePersistenceError("commit_conflict");
        });
        this.mutationTail = run.then(() => undefined, () => undefined);
        return run;
    }

    subscribe(listener: (commitSequence: number) => void): () => void {
        this.assertActive();
        this.attachNotifications();
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    dispose(): Promise<void> {
        if (this.disposePromise) return this.disposePromise;
        this.disposed = true;
        this.detachNotifications();
        this.listeners.clear();
        const db = this.db;
        this.db = null;
        try {
            db?.close();
        } catch {
            // A stale connection may already be closed.
        }
        for (const transaction of [...this.activeTransactions]) {
            try {
                transaction.abort();
            } catch {
                // Completed transactions may reject a late abort.
            }
        }
        this.activeTransactions.clear();
        // Do not await an arbitrary user transaction callback here: it may be
        // suspended on caller-owned work. The disposed guard prevents any late
        // callback from reaching CAS, while open success and active IDB
        // transactions are independently closed/aborted above.
        this.disposePromise = Promise.resolve();
        return this.disposePromise;
    }

    private async initializeUnlocked(): Promise<DeviceMemoryGovernanceStateV1> {
        await this.ensureInitialState();
        this.assertActive();
        const state = await this.readState();
        this.lastNotifiedSequence = Math.max(this.lastNotifiedSequence, state.commitSequence);
        return state;
    }

    private async ensureInitialState(): Promise<void> {
        const db = await this.getDatabase();
        this.assertActive();
        await new Promise<void>((resolve, reject) => {
            let transaction: IDBTransaction;
            try {
                transaction = db.transaction(META_STORE, "readwrite");
            } catch {
                this.invalidateDatabase(db);
                reject(new MemoryGovernancePersistenceError("database_write_failed"));
                return;
            }
            this.activeTransactions.add(transaction);
            const store = transaction.objectStore(META_STORE);
            const request = store.get(META_KEY);
            request.onsuccess = () => {
                if (request.result === undefined) {
                    store.put({ schemaVersion: 1, commitSequence: 0 } satisfies PersistedMetaRecord, META_KEY);
                }
            };
            request.onerror = () => reject(new MemoryGovernancePersistenceError("database_read_failed"));
            transaction.oncomplete = () => {
                this.activeTransactions.delete(transaction);
                resolve();
            };
            transaction.onerror = () => {
                this.activeTransactions.delete(transaction);
                reject(new MemoryGovernancePersistenceError("database_write_failed"));
            };
            transaction.onabort = () => {
                this.activeTransactions.delete(transaction);
                reject(new MemoryGovernancePersistenceError("database_write_failed"));
            };
        });
    }

    private async readState(): Promise<DeviceMemoryGovernanceStateV1> {
        const db = await this.getDatabase();
        this.assertActive();
        let transaction: IDBTransaction;
        try {
            transaction = db.transaction([...ALL_INDEXED_DB_STORES], "readonly");
        } catch {
            this.invalidateDatabase(db);
            throw new MemoryGovernancePersistenceError("database_read_failed");
        }
        this.activeTransactions.add(transaction);
        try {
            const metaPromise = requestToPromise<PersistedMetaRecord | undefined>(
                transaction.objectStore(META_STORE).get(META_KEY),
            );
            const arrayPromises = ARRAY_STORES.map((storeName) =>
                requestToPromise<unknown[]>(transaction.objectStore(storeName).getAll()));
            const mapPromises = MAP_STORES.map((storeName) =>
                requestToPromise<Array<PersistedMapEntry<unknown>>>(transaction.objectStore(storeName).getAll()));
            const [meta, arrayValues, mapValues] = await Promise.all([
                metaPromise,
                Promise.all(arrayPromises),
                Promise.all(mapPromises),
                transactionDone(transaction),
            ]).then(([resolvedMeta, resolvedArrays, resolvedMaps]) => [resolvedMeta, resolvedArrays, resolvedMaps] as const);
            if (!meta) throw new MemoryGovernancePersistenceError("invalid_state");
            const raw: Record<string, unknown> = {
                schemaVersion: meta.schemaVersion,
                commitSequence: meta.commitSequence,
            };
            ARRAY_STORES.forEach((storeName, index) => { raw[storeName] = arrayValues[index]; });
            MAP_STORES.forEach((storeName, index) => {
                const entries = mapValues[index];
                const record: Record<string, unknown> = {};
                if (!Array.isArray(entries)) throw new MemoryGovernancePersistenceError("invalid_state");
                for (const entry of entries) {
                    if (!isRecord(entry) || !requiredString(entry.key) || isUnsafeMapKey(entry.key as string)) {
                        throw new MemoryGovernancePersistenceError("invalid_state");
                    }
                    record[entry.key as string] = entry.value;
                }
                raw[storeName] = record;
            });
            const normalized = normalizeDeviceMemoryGovernanceStateV1(raw);
            if (!normalized) throw new MemoryGovernancePersistenceError("invalid_state");
            return normalized;
        } catch (error) {
            if (error instanceof MemoryGovernancePersistenceError) throw error;
            throw new MemoryGovernancePersistenceError("database_read_failed");
        } finally {
            this.activeTransactions.delete(transaction);
        }
    }

    private async compareAndSwap(
        expectedCommitSequence: number,
        next: DeviceMemoryGovernanceStateV1,
    ): Promise<boolean> {
        const db = await this.getDatabase();
        this.assertActive();
        return new Promise<boolean>((resolve, reject) => {
            let transaction: IDBTransaction;
            try {
                transaction = db.transaction([...ALL_INDEXED_DB_STORES], "readwrite");
            } catch {
                this.invalidateDatabase(db);
                reject(new MemoryGovernancePersistenceError("database_write_failed"));
                return;
            }
            this.activeTransactions.add(transaction);
            let committed = false;
            const metaStore = transaction.objectStore(META_STORE);
            const request = metaStore.get(META_KEY);
            request.onsuccess = () => {
                const current = request.result as PersistedMetaRecord | undefined;
                if (!current || current.schemaVersion !== 1 || current.commitSequence !== expectedCommitSequence) {
                    return;
                }
                committed = true;
                metaStore.put({ schemaVersion: 1, commitSequence: next.commitSequence } satisfies PersistedMetaRecord, META_KEY);
                for (const storeName of ARRAY_STORES) {
                    const store = transaction.objectStore(storeName);
                    store.clear();
                    const values = next[storeName] as Array<{ id?: string }>;
                    for (const value of values) store.put(value, getArrayStorageKey(storeName, value));
                }
                for (const storeName of MAP_STORES) {
                    const store = transaction.objectStore(storeName);
                    store.clear();
                    for (const [key, value] of Object.entries(next[storeName])) {
                        store.put({ key, value } satisfies PersistedMapEntry<unknown>, key);
                    }
                }
            };
            request.onerror = () => reject(new MemoryGovernancePersistenceError("database_read_failed"));
            transaction.oncomplete = () => {
                this.activeTransactions.delete(transaction);
                resolve(committed);
            };
            transaction.onerror = () => {
                this.activeTransactions.delete(transaction);
                reject(new MemoryGovernancePersistenceError("database_write_failed"));
            };
            transaction.onabort = () => {
                this.activeTransactions.delete(transaction);
                reject(new MemoryGovernancePersistenceError("database_write_failed"));
            };
        });
    }

    private getDatabase(): Promise<IDBDatabase> {
        this.assertActive();
        if (this.db) return Promise.resolve(this.db);
        if (!this.openPromise) {
            const run = this.openDatabase().then((db) => {
                if (this.disposed) {
                    db.close();
                    throw new MemoryGovernancePersistenceError("repository_disposed");
                }
                this.db = db;
                return db;
            }).finally(() => {
                if (this.openPromise === run) this.openPromise = null;
            });
            this.openPromise = run;
        }
        return this.openPromise;
    }

    private openDatabase(): Promise<IDBDatabase> {
        return new Promise<IDBDatabase>((resolve, reject) => {
            let request: IDBOpenDBRequest;
            try {
                request = this.indexedDb.open(this.dbName, MEMORY_GOVERNANCE_INDEXED_DB_VERSION);
            } catch {
                reject(new MemoryGovernancePersistenceError("database_open_failed"));
                return;
            }
            let settled = false;
            const timer = setPlatformTimeout(() => {
                finishError(new MemoryGovernancePersistenceError("database_open_timeout"));
            }, this.openTimeoutMs);
            const finishError = (error: MemoryGovernancePersistenceError): void => {
                if (settled) return;
                settled = true;
                clearPlatformTimeout(timer);
                reject(error);
            };
            const finishSuccess = (db: IDBDatabase): void => {
                if (settled) {
                    db.close();
                    return;
                }
                settled = true;
                clearPlatformTimeout(timer);
                db.onversionchange = () => this.invalidateDatabase(db);
                resolve(db);
            };
            request.onupgradeneeded = () => {
                const db = request.result;
                for (const storeName of ALL_INDEXED_DB_STORES) {
                    if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
                }
            };
            request.onsuccess = () => finishSuccess(request.result);
            request.onerror = () => finishError(new MemoryGovernancePersistenceError("database_open_failed"));
            request.onblocked = () => finishError(new MemoryGovernancePersistenceError("database_open_blocked"));
        });
    }

    private invalidateDatabase(db: IDBDatabase): void {
        if (this.db === db) this.db = null;
        try {
            db.close();
        } catch {
            // Closing an already closed stale connection is harmless.
        }
    }

    private attachNotifications(): void {
        if (this.notificationsAttached) return;
        this.notificationsAttached = true;
        let hub = LOCAL_NOTIFICATION_HUBS.get(this.dbName);
        if (!hub) {
            hub = new Set();
            LOCAL_NOTIFICATION_HUBS.set(this.dbName, hub);
        }
        hub.add(this.localHubListener);
        if (this.broadcastChannelFactory) {
            try {
                this.channel = this.broadcastChannelFactory(getBroadcastChannelName(this.dbName));
                this.channel.onmessage = (event) => {
                    if (isCommitNotification(event.data)) this.handleCommitNotification(event.data);
                };
            } catch {
                this.channel = null;
            }
        }
    }

    private detachNotifications(): void {
        if (!this.notificationsAttached) return;
        this.notificationsAttached = false;
        const hub = LOCAL_NOTIFICATION_HUBS.get(this.dbName);
        hub?.delete(this.localHubListener);
        if (hub?.size === 0) LOCAL_NOTIFICATION_HUBS.delete(this.dbName);
        if (this.channel) {
            this.channel.onmessage = null;
            this.channel.close();
            this.channel = null;
        }
    }

    private publishCommit(commitSequence: number): void {
        const notification: CommitNotification = {
            dbName: this.dbName,
            sourceId: this.sourceId,
            commitSequence,
        };
        const hub = LOCAL_NOTIFICATION_HUBS.get(this.dbName);
        for (const listener of [...(hub ?? [])]) listener(notification);
        try {
            this.channel?.postMessage(notification);
        } catch {
            // IndexedDB commit remains authoritative when notification transport fails.
        }
    }

    private handleCommitNotification(notification: CommitNotification): void {
        if (this.disposed || notification.dbName !== this.dbName) return;
        if (!isNonNegativeSafeInteger(notification.commitSequence)) return;
        if (notification.commitSequence <= this.lastNotifiedSequence) return;
        this.lastNotifiedSequence = notification.commitSequence;
        for (const listener of [...this.listeners]) {
            try {
                listener(notification.commitSequence);
            } catch {
                // A subscriber cannot affect a committed transaction.
            }
        }
    }

    private assertActive(): void {
        if (this.disposed) throw new MemoryGovernancePersistenceError("repository_disposed");
    }
}

export class UnavailableMemoryGovernanceRepository implements MemoryGovernanceRepository {
    private unavailable(): never {
        throw new MemoryGovernancePersistenceError("storage_unavailable");
    }

    async initialize(): Promise<DeviceMemoryGovernanceStateV1> {
        return this.unavailable();
    }

    async transact<T>(_operation: MemoryGovernanceTransaction<T>): Promise<T> {
        return this.unavailable();
    }

    subscribe(_listener: (commitSequence: number) => void): () => void {
        return this.unavailable();
    }

    async dispose(): Promise<void> {
        // Nothing was opened.
    }
}

export function getMemoryGovernanceDeviceDbName(pluginId = "personal-assistant"): string {
    const normalized = pluginId.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    return normalized && normalized !== "personal-assistant"
        ? `${normalized}-memory-governance-device-v1`
        : MEMORY_GOVERNANCE_DEFAULT_DB_NAME;
}

export function createDeviceMemoryGovernanceRepository(
    pluginId = "personal-assistant",
    indexedDb: IDBFactory | undefined = getPlatformIndexedDB(),
    options: IndexedDbMemoryGovernanceRepositoryOptions = {},
): MemoryGovernanceRepository {
    return indexedDb
        ? new IndexedDbMemoryGovernanceRepository(getMemoryGovernanceDeviceDbName(pluginId), indexedDb, options)
        : new UnavailableMemoryGovernanceRepository();
}

function getArrayStorageKey(
    storeName: typeof ARRAY_STORES[number],
    value: { id?: string },
): IDBValidKey {
    if (storeName === "migrationDeltas") {
        const delta = value as unknown as MemoryMigrationDelta;
        return `${delta.migrationRunId}\u0000${delta.sequence}`;
    }
    if (!value.id) throw new MemoryGovernancePersistenceError("invalid_state");
    return value.id;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new MemoryGovernancePersistenceError("database_read_failed"));
    });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(new MemoryGovernancePersistenceError("database_read_failed"));
        transaction.onabort = () => reject(new MemoryGovernancePersistenceError("database_read_failed"));
    });
}

function createRepositorySourceId(): string {
    return `memory-repository-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getBroadcastChannelName(dbName: string): string {
    return `${dbName}:commits`;
}

function getDefaultBroadcastChannelFactory(): MemoryGovernanceBroadcastChannelFactory | null {
    const ctor = (globalThis as typeof globalThis & {
        BroadcastChannel?: new (name: string) => MemoryGovernanceBroadcastChannel;
    }).BroadcastChannel;
    return typeof ctor === "function" ? (name) => new ctor(name) : null;
}

function isCommitNotification(value: unknown): value is CommitNotification {
    return isRecord(value)
        && typeof value.dbName === "string"
        && typeof value.sourceId === "string"
        && isNonNegativeSafeInteger(value.commitSequence);
}
