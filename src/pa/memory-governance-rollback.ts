import { checksumLegacyRollbackValue } from "./memory-governance-rollback-checksum";
import { validateConfirmedMemoryRecord, type ConfirmedMemoryRecord } from "./memory-governance-store";
import type {
    DeviceMemoryGovernanceStateV1,
    LegacyRollbackValue,
    MemoryGovernanceRepository,
    MemoryMigrationDelta,
    MemoryPartitionKey,
    MemoryRollbackPayloadEntry,
} from "./memory-governance-persistence";
import { validateReviewQueueItem, type ReviewQueueItem } from "./review-queue-store";

export interface LegacyMemoryRollbackProjection {
    records: ConfirmedMemoryRecord[];
    memoryQueueItems: ReviewQueueItem[];
    confirmedMemoryCount: number;
    memoryAutoAcceptPaused: boolean;
}

export type LegacyMemoryRollbackProjectionResult =
    | { ok: true; projection: LegacyMemoryRollbackProjection; lastDeltaSequence: number }
    | { ok: false; reason: string };

export interface MemoryGovernanceRollbackCoordinatorOptions {
    repository: MemoryGovernanceRepository;
    opaqueVaultKey: string;
    writeLegacyProjection: (
        projection: LegacyMemoryRollbackProjection,
    ) => Promise<void | LegacyMemoryRollbackWriteResult>;
    readLegacyProjection: () => Promise<LegacyMemoryRollbackProjection>;
    now?: () => Date;
}

export type LegacyMemoryRollbackWriteResult =
    | { ok: true }
    | { ok: false; reason: "legacy_source_changed"; sourceHash: string };

export type MemoryGovernanceRollbackResult =
    | { ok: true; phase: "rolled_back"; lastDeltaSequence: number }
    | { ok: false; phase: "compatibility" | "rolling_back"; reason: string };

class RollbackError extends Error {
    constructor(readonly code: string) {
        super(`Memory rollback failed: ${code}`);
        this.name = "RollbackError";
    }
}

/**
 * Rebuilds the legacy Memory projection from a verified base plus every
 * post-cutover delta. It is pure, deterministic, and never logs content.
 */
export function buildLegacyMemoryRollbackProjection(
    state: DeviceMemoryGovernanceStateV1,
    opaqueVaultKey: string,
    now = new Date(),
): LegacyMemoryRollbackProjectionResult {
    try {
        const vaultKey = opaqueVaultKey.trim();
        if (!vaultKey) throw new RollbackError("invalid_vault_key");
        const migration = state.migrationStates[vaultKey];
        if (!migration || ![
            "compatibility",
            "rolling_back",
            "finalizing",
        ].includes(migration.phase)) {
            throw new RollbackError("rollback_not_available");
        }
        if (migration.pendingLegacySourceHash) {
            throw new RollbackError("legacy_source_reconciliation_required");
        }
        if (!migration.rollbackExpiresAt || !isUnexpired(migration.rollbackExpiresAt, now)) {
            throw new RollbackError("rollback_window_expired");
        }
        const partition: MemoryPartitionKey = { kind: "vault", key: vaultKey };
        const runId = migration.migrationRunId;
        const deltas = state.migrationDeltas
            .filter((delta) => delta.migrationRunId === runId)
            .sort((left, right) => left.sequence - right.sequence);
        validateDeltaSequenceAndPartition(deltas, partition);

        const referencedPayloadIds = new Set(
            deltas.map((delta) => delta.payloadEntryId).filter((id): id is string => Boolean(id)),
        );
        const runEntries = state.rollbackPayloadEntries.filter((entry) => entry.migrationRunId === runId);
        const payloads = indexPayloadEntries(runEntries, partition, now);
        const baseEntries = runEntries.filter((entry) => !referencedPayloadIds.has(entry.id));
        const claims = new Map<string, ConfirmedMemoryRecord>();
        const queue = new Map<string, ReviewQueueItem>();
        let policy: Extract<LegacyRollbackValue, { kind: "policy" }> | null = null;

        for (const entry of baseEntries) {
            if (entry.value.kind === "claim") {
                if (claims.has(entry.entityId)) throw new RollbackError("rollback_base_entity_collision");
                const validation = validateConfirmedMemoryRecord(entry.value.record);
                if (!validation.ok) throw new RollbackError("rollback_claim_invalid");
                claims.set(entry.entityId, validation.value);
            } else if (entry.value.kind === "memory_queue") {
                if (queue.has(entry.entityId)) throw new RollbackError("rollback_base_entity_collision");
                const validation = validateReviewQueueItem(entry.value.item);
                if (!validation.ok || !isMemoryQueueType(validation.value.type)) {
                    throw new RollbackError("rollback_queue_invalid");
                }
                queue.set(entry.entityId, validation.value);
            } else {
                if (policy) throw new RollbackError("rollback_policy_collision");
                policy = normalizePolicy(entry.value);
            }
        }
        if (!policy) throw new RollbackError("rollback_policy_missing");

        for (const delta of deltas) {
            if (delta.kind === "claim_forgotten" || delta.kind === "claim_removed") {
                if (delta.payloadEntryId || delta.payloadChecksum) {
                    throw new RollbackError("claim_removal_delta_contains_payload");
                }
                claims.delete(delta.entityId);
                continue;
            }
            if (delta.kind === "queue_removed") {
                if (delta.payloadEntryId || delta.payloadChecksum) {
                    throw new RollbackError("queue_removal_delta_contains_payload");
                }
                queue.delete(delta.entityId);
                continue;
            }
            const entry = requireDeltaPayload(delta, payloads);
            if (delta.kind === "claim_added" || delta.kind === "claim_changed") {
                if (entry.value.kind !== "claim") throw new RollbackError("rollback_delta_kind_mismatch");
                const validation = validateConfirmedMemoryRecord(entry.value.record);
                if (!validation.ok) throw new RollbackError("rollback_claim_invalid");
                claims.set(delta.entityId, validation.value);
            } else if (delta.kind === "queue_changed") {
                if (entry.value.kind !== "memory_queue") throw new RollbackError("rollback_delta_kind_mismatch");
                const validation = validateReviewQueueItem(entry.value.item);
                if (!validation.ok || !isMemoryQueueType(validation.value.type)) {
                    throw new RollbackError("rollback_queue_invalid");
                }
                queue.set(delta.entityId, validation.value);
            } else if (delta.kind === "policy_changed") {
                if (entry.value.kind !== "policy") throw new RollbackError("rollback_delta_kind_mismatch");
                policy = normalizePolicy(entry.value);
            }
        }

        // A user-visible Forget blocks use before external cleanup finishes.
        // Rollback must preserve that intent even if the final text-free delta
        // has not been appended yet, otherwise a crash between phases could
        // resurrect the claim or its exact Review Queue copy in legacy state.
        for (const operation of state.pendingOperations) {
            if (operation.kind !== "forget" || !partitionsEqual(operation.partition, partition)) continue;
            claims.delete(operation.claimId);
            for (const target of operation.targets) {
                const link = state.projectionLinks.find((candidate) => (
                    candidate.id === target.projectionLinkId && candidate.claimId === operation.claimId
                ));
                if (link?.target.kind === "review_queue") queue.delete(link.target.itemId);
            }
        }

        return {
            ok: true,
            projection: {
                records: [...claims.values()].sort((left, right) => left.id.localeCompare(right.id)),
                memoryQueueItems: [...queue.values()].sort((left, right) => left.id.localeCompare(right.id)),
                confirmedMemoryCount: policy.confirmedMemoryCount,
                memoryAutoAcceptPaused: policy.memoryAutoAcceptPaused,
            },
            lastDeltaSequence: deltas.at(-1)?.sequence ?? 0,
        };
    } catch (error) {
        if (error instanceof RollbackError) return { ok: false, reason: error.code };
        return { ok: false, reason: "rollback_projection_failed" };
    }
}

/**
 * Crash-safe coordinator: `rolling_back` blocks new governed writes, legacy
 * readback is verified, and reader mode changes only in the final transaction.
 */
export class MemoryGovernanceRollbackCoordinator {
    private readonly repository: MemoryGovernanceRepository;
    private readonly opaqueVaultKey: string;
    private readonly writeLegacyProjection: MemoryGovernanceRollbackCoordinatorOptions["writeLegacyProjection"];
    private readonly readLegacyProjection: MemoryGovernanceRollbackCoordinatorOptions["readLegacyProjection"];
    private readonly now: () => Date;

    constructor(options: MemoryGovernanceRollbackCoordinatorOptions) {
        this.repository = options.repository;
        this.opaqueVaultKey = options.opaqueVaultKey.trim();
        this.writeLegacyProjection = options.writeLegacyProjection;
        this.readLegacyProjection = options.readLegacyProjection;
        this.now = options.now ?? (() => new Date());
    }

    async run(): Promise<MemoryGovernanceRollbackResult> {
        const initial = await this.repository.initialize();
        const initialPhase = initial.migrationStates[this.opaqueVaultKey]?.phase;
        if (initialPhase !== "compatibility" && initialPhase !== "rolling_back") {
            return { ok: false, phase: "compatibility", reason: "rollback_not_available" };
        }
        if (hasPendingRollbackBlocker(initial, this.opaqueVaultKey)) {
            return {
                ok: false,
                phase: initialPhase,
                reason: "rollback_pending_operations",
            };
        }
        const runId = initial.migrationStates[this.opaqueVaultKey]?.migrationRunId;
        if (!runId) return { ok: false, phase: "compatibility", reason: "rollback_not_available" };

        let built: Extract<LegacyMemoryRollbackProjectionResult, { ok: true }>;
        try {
            built = await this.repository.transact((draft) => {
                const migration = draft.migrationStates[this.opaqueVaultKey];
                if (!migration || migration.migrationRunId !== runId
                    || (migration.phase !== "compatibility" && migration.phase !== "rolling_back")) {
                    throw new RollbackError("rollback_state_changed");
                }
                if (hasPendingRollbackBlocker(draft, this.opaqueVaultKey)) {
                    throw new RollbackError("rollback_pending_operations");
                }
                migration.phase = "rolling_back";
                delete migration.lastErrorCode;
                const authoritative = buildLegacyMemoryRollbackProjection(
                    draft,
                    this.opaqueVaultKey,
                    this.now(),
                );
                if (!authoritative.ok) throw new RollbackError(authoritative.reason);
                return authoritative;
            });
        } catch (error) {
            const reason = error instanceof RollbackError ? error.code : "rollback_lock_failed";
            return {
                ok: false,
                phase: initialPhase === "rolling_back" ? "rolling_back" : "compatibility",
                reason,
            };
        }

        try {
            const writeResult = await this.writeLegacyProjection(cloneProjection(built.projection));
            if (writeResult?.ok === false) {
                const released = await this.releaseLockForChangedSource(
                    runId,
                    writeResult.sourceHash,
                );
                if (!released) {
                    const reason = "rollback_source_reconciliation_failed";
                    await this.recordRetryableFailure(runId, reason);
                    return { ok: false, phase: "rolling_back", reason };
                }
                return {
                    ok: false,
                    phase: "compatibility",
                    reason: "legacy_source_reconciliation_required",
                };
            }
            const readback = await this.readLegacyProjection();
            if (!projectionsEqual(built.projection, readback)) {
                throw new RollbackError("rollback_readback_mismatch");
            }
        } catch (error) {
            const reason = error instanceof RollbackError ? error.code : "rollback_legacy_write_failed";
            await this.recordRetryableFailure(runId, reason);
            return { ok: false, phase: "rolling_back", reason };
        }

        try {
            await this.repository.transact((draft) => {
                const migration = draft.migrationStates[this.opaqueVaultKey];
                if (!migration || migration.migrationRunId !== runId || migration.phase !== "rolling_back") {
                    throw new RollbackError("rollback_state_changed");
                }
                const policy = draft.policyStates[this.opaqueVaultKey];
                if (!policy) throw new RollbackError("rollback_policy_missing");
                policy.contextProjectionMode = "legacy";
                migration.phase = "rolled_back";
                migration.lastAppliedDeltaSequence = built.lastDeltaSequence;
                delete migration.lastErrorCode;
            });
        } catch (error) {
            const reason = error instanceof RollbackError
                ? error.code
                : "rollback_commit_failed";
            await this.recordRetryableFailure(runId, reason);
            return { ok: false, phase: "rolling_back", reason };
        }
        return { ok: true, phase: "rolled_back", lastDeltaSequence: built.lastDeltaSequence };
    }

    private async releaseLockForChangedSource(runId: string, sourceHash: string): Promise<boolean> {
        if (!sourceHash.trim()) return false;
        try {
            await this.repository.transact((draft) => {
                const migration = draft.migrationStates[this.opaqueVaultKey];
                if (!migration || migration.migrationRunId !== runId
                    || migration.phase !== "rolling_back") {
                    throw new RollbackError("rollback_state_changed");
                }
                migration.phase = "compatibility";
                migration.pendingLegacySourceHash = sourceHash;
                delete migration.lastErrorCode;
            });
            return true;
        } catch {
            return false;
        }
    }

    private async recordRetryableFailure(runId: string, errorCode: string): Promise<void> {
        try {
            await this.repository.transact((draft) => {
                const migration = draft.migrationStates[this.opaqueVaultKey];
                if (!migration || migration.migrationRunId !== runId || migration.phase !== "rolling_back") return;
                migration.lastErrorCode = errorCode;
            });
        } catch {
            // The durable rolling_back phase is itself sufficient for a later
            // retry when the diagnostic write is temporarily unavailable.
        }
    }
}

function hasPendingRollbackBlocker(
    state: DeviceMemoryGovernanceStateV1,
    opaqueVaultKey: string,
): boolean {
    return state.pendingOperations.some((operation) => {
        if (operation.kind === "forget") {
            return operation.partition.kind === "device_collaboration"
                || operation.partition.key === opaqueVaultKey;
        }
        if (operation.state !== "pending") return false;
        const claim = state.claims.find((candidate) => candidate.id === operation.claimId);
        return claim?.partition.kind === "device_collaboration"
            || (claim?.partition.kind === "vault" && claim.partition.key === opaqueVaultKey)
            || (operation.action === "remove" && operation.ownerVaultKey === opaqueVaultKey);
    });
}

function validateDeltaSequenceAndPartition(
    deltas: readonly MemoryMigrationDelta[],
    partition: MemoryPartitionKey,
): void {
    let expected = 1;
    for (const delta of deltas) {
        if (delta.sequence !== expected++) throw new RollbackError("rollback_delta_sequence_invalid");
        if (!partitionsEqual(delta.partition, partition)) {
            throw new RollbackError("rollback_delta_partition_mismatch");
        }
    }
}

function indexPayloadEntries(
    entries: readonly MemoryRollbackPayloadEntry[],
    partition: MemoryPartitionKey,
    now: Date,
): Map<string, MemoryRollbackPayloadEntry> {
    const indexed = new Map<string, MemoryRollbackPayloadEntry>();
    for (const entry of entries) {
        if (!partitionsEqual(entry.partition, partition)) {
            throw new RollbackError("rollback_payload_partition_mismatch");
        }
        if (!isUnexpired(entry.expiresAt, now)) throw new RollbackError("rollback_payload_expired");
        if (indexed.has(entry.id)) throw new RollbackError("rollback_payload_id_collision");
        if (entry.checksum !== checksumLegacyRollbackValue(entry.value)) {
            throw new RollbackError("rollback_payload_checksum_mismatch");
        }
        indexed.set(entry.id, entry);
    }
    return indexed;
}

function requireDeltaPayload(
    delta: MemoryMigrationDelta,
    payloads: ReadonlyMap<string, MemoryRollbackPayloadEntry>,
): MemoryRollbackPayloadEntry {
    if (!delta.payloadEntryId || !delta.payloadChecksum) {
        throw new RollbackError("rollback_delta_payload_missing");
    }
    const entry = payloads.get(delta.payloadEntryId);
    if (!entry || entry.entityId !== delta.entityId
        || entry.checksum !== delta.payloadChecksum
        || entry.checksum !== checksumLegacyRollbackValue(entry.value)) {
        throw new RollbackError("rollback_delta_payload_mismatch");
    }
    return entry;
}

function normalizePolicy(
    value: Extract<LegacyRollbackValue, { kind: "policy" }>,
): Extract<LegacyRollbackValue, { kind: "policy" }> {
    if (!Number.isSafeInteger(value.confirmedMemoryCount) || value.confirmedMemoryCount < 0
        || typeof value.memoryAutoAcceptPaused !== "boolean") {
        throw new RollbackError("rollback_policy_invalid");
    }
    return { ...value };
}

function projectionsEqual(
    expected: LegacyMemoryRollbackProjection,
    actual: LegacyMemoryRollbackProjection,
): boolean {
    return projectionFingerprint(expected) === projectionFingerprint(actual);
}

function projectionFingerprint(projection: LegacyMemoryRollbackProjection): string {
    const recordFingerprints = projection.records
        .map((record) => `${record.id}:${checksumLegacyRollbackValue({ kind: "claim", record })}`)
        .sort();
    const queueFingerprints = projection.memoryQueueItems
        .map((item) => `${item.id}:${checksumLegacyRollbackValue({ kind: "memory_queue", item })}`)
        .sort();
    const policyFingerprint = checksumLegacyRollbackValue({
        kind: "policy",
        confirmedMemoryCount: projection.confirmedMemoryCount,
        memoryAutoAcceptPaused: projection.memoryAutoAcceptPaused,
    });
    return JSON.stringify([recordFingerprints, queueFingerprints, policyFingerprint]);
}

function cloneProjection(projection: LegacyMemoryRollbackProjection): LegacyMemoryRollbackProjection {
    return JSON.parse(JSON.stringify(projection)) as LegacyMemoryRollbackProjection;
}

function isMemoryQueueType(type: ReviewQueueItem["type"]): boolean {
    return type === "memory_candidate" || type === "memory_conflict";
}

function isUnexpired(value: string, now: Date): boolean {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && timestamp >= now.getTime();
}

function partitionsEqual(left: MemoryPartitionKey, right: MemoryPartitionKey): boolean {
    return left.kind === right.kind && left.key === right.key;
}
