import { cloneScope, cloneSourceRef, stableHash } from "./helpers";
import { createDeterministicLegacyMigrationId } from "./memory-governance-migration";
import { checksumLegacyRollbackValue } from "./memory-governance-migration-coordinator";
import type {
    DeviceMemoryGovernanceStateV1,
    GovernedMemoryClaim,
    LegacyRollbackValue,
    MemoryClaimRevision,
    MemoryGovernanceRepository,
    MemoryMigrationState,
    MemoryPartitionKey,
} from "./memory-governance-persistence";
import { buildLegacyMemoryRollbackProjection } from "./memory-governance-rollback";
import {
    validateConfirmedMemoryRecord,
    type ConfirmedMemoryRecord,
    type MemoryGovernanceRecordRepository,
    type MemoryGovernanceState,
} from "./memory-governance-store";

export type DeviceMemoryGovernanceRecordRepositoryErrorCode =
    | "repository_disposed"
    | "invalid_vault_key"
    | "invalid_source_hash"
    | "migration_missing"
    | "migration_source_mismatch"
    | "migration_phase_blocked"
    | "rollback_projection_invalid"
    | "invalid_record"
    | "duplicate_record_id"
    | "record_removal_requires_forget"
    | "unsupported_lifecycle"
    | "stale_record_conflict"
    | "claim_mapping_missing"
    | "claim_mapping_ambiguous"
    | "claim_missing"
    | "claim_partition_mismatch"
    | "origin_queue_item_missing"
    | "entity_collision";

export class DeviceMemoryGovernanceRecordRepositoryError extends Error {
    constructor(readonly code: DeviceMemoryGovernanceRecordRepositoryErrorCode) {
        super(`Device Memory governance adapter failed: ${code}`);
        this.name = "DeviceMemoryGovernanceRecordRepositoryError";
    }
}

export interface DeviceMemoryGovernanceRecordRepositoryOptions {
    repository: MemoryGovernanceRepository;
    opaqueVaultKey: string;
    expectedSourceHash: string;
    now?: () => Date;
}

interface CompatibilityContext {
    migration: MemoryMigrationState;
    records: ConfirmedMemoryRecord[];
    entityIdByRecordId: Map<string, string>;
}

type RecordWriteIntent =
    | { kind: "add"; next: ConfirmedMemoryRecord }
    | {
        kind: "change";
        base: ConfirmedMemoryRecord;
        baseChecksum: string;
        next: ConfirmedMemoryRecord;
    }
    | {
        kind: "forget";
        base: ConfirmedMemoryRecord;
        baseChecksum: string;
        next: ConfirmedMemoryRecord;
    };

interface TransactionResult {
    records: ConfirmedMemoryRecord[];
    commitSequence: number;
}

/**
 * Compatibility-window adapter for the synchronous legacy domain store.
 * The Markdown vault remains the source of truth; this adapter only projects
 * the current vault's confirmed records into the device-local V1 repository.
 */
export class DeviceMemoryGovernanceRecordRepository implements MemoryGovernanceRecordRepository {
    private readonly repository: MemoryGovernanceRepository;
    private readonly opaqueVaultKey: string;
    private readonly expectedSourceHash: string;
    private readonly now: () => Date;
    private readonly unsubscribe: () => void;
    private records: ConfirmedMemoryRecord[] = [];
    private cachedCommitSequence = -1;
    private highestObservedCommitSequence = -1;
    private stale = true;
    private disposed = false;
    private operationTail: Promise<void> = Promise.resolve();

    constructor(options: DeviceMemoryGovernanceRecordRepositoryOptions) {
        this.repository = options.repository;
        this.opaqueVaultKey = options.opaqueVaultKey.trim();
        this.expectedSourceHash = options.expectedSourceHash.trim();
        this.now = options.now ?? (() => new Date());
        if (!this.opaqueVaultKey) throw adapterError("invalid_vault_key");
        if (!this.expectedSourceHash) throw adapterError("invalid_source_hash");
        this.unsubscribe = this.repository.subscribe((commitSequence) => {
            this.highestObservedCommitSequence = Math.max(
                this.highestObservedCommitSequence,
                commitSequence,
            );
            if (commitSequence > this.cachedCommitSequence) this.stale = true;
        });
    }

    read(): MemoryGovernanceState {
        this.assertActive();
        return { records: cloneRecords(this.records) };
    }

    async write(state: MemoryGovernanceState): Promise<void> {
        this.assertActive();
        const nextRecords = normalizeRecords(state?.records);
        const intents = buildWriteIntents(this.records, nextRecords);
        await this.enqueue(async () => this.writeUnlocked(intents));
    }

    refresh(): Promise<MemoryGovernanceState> {
        this.assertActive();
        return this.enqueue(async () => this.refreshUnlocked());
    }

    isStale(): boolean {
        this.assertActive();
        return this.stale;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.unsubscribe();
    }

    private async refreshUnlocked(): Promise<MemoryGovernanceState> {
        this.assertActive();
        const state = await this.repository.initialize();
        const context = requireCompatibilityContext(
            state,
            this.opaqueVaultKey,
            this.expectedSourceHash,
            this.now(),
        );
        this.records = cloneRecords(context.records);
        this.cachedCommitSequence = state.commitSequence;
        this.stale = this.highestObservedCommitSequence > this.cachedCommitSequence;
        return { records: cloneRecords(this.records) };
    }

    private async writeUnlocked(intents: readonly RecordWriteIntent[]): Promise<void> {
        this.assertActive();
        const transactionTime = this.now();

        // Force a fresh read without advancing the adapter cache. The same
        // checks run again inside the transaction to close the race window.
        const fresh = await this.repository.initialize();
        requireCompatibilityContext(
            fresh,
            this.opaqueVaultKey,
            this.expectedSourceHash,
            transactionTime,
        );

        const result = await this.repository.transact((draft) => {
            const context = requireCompatibilityContext(
                draft,
                this.opaqueVaultKey,
                this.expectedSourceHash,
                transactionTime,
            );
            const currentById = new Map(context.records.map((record) => [record.id, record]));
            const entityIdByRecordId = new Map(context.entityIdByRecordId);
            let nextDeltaSequence = nextMigrationDeltaSequence(
                draft,
                context.migration.migrationRunId,
            );
            const committedAt = transactionTime.toISOString();

            for (const intent of intents) {
                const current = currentById.get(intent.next.id);
                const nextChecksum = recordChecksum(intent.next);

                if (intent.kind === "add") {
                    if (current) {
                        if (recordChecksum(current) === nextChecksum) continue;
                        throw adapterError("stale_record_conflict");
                    }
                    if (intent.next.lifecycle === "forgotten_tombstone") continue;
                    const claimId = applyAddOrChange({
                        draft,
                        migration: context.migration,
                        opaqueVaultKey: this.opaqueVaultKey,
                        expectedSourceHash: this.expectedSourceHash,
                        record: intent.next,
                        baseRecord: undefined,
                        claimId: undefined,
                        deltaSequence: nextDeltaSequence,
                        committedAt,
                    });
                    entityIdByRecordId.set(intent.next.id, claimId);
                    currentById.set(intent.next.id, cloneRecord(intent.next));
                    nextDeltaSequence += 1;
                    continue;
                }

                if (!current) {
                    if (intent.kind === "forget") continue;
                    throw adapterError("stale_record_conflict");
                }
                if (recordChecksum(current) === nextChecksum) continue;
                if (recordChecksum(current) !== intent.baseChecksum) {
                    throw adapterError("stale_record_conflict");
                }
                const claimId = entityIdByRecordId.get(intent.next.id);
                if (!claimId) throw adapterError("claim_mapping_missing");

                if (intent.kind === "forget") {
                    applyForget({
                        draft,
                        migration: context.migration,
                        opaqueVaultKey: this.opaqueVaultKey,
                        claimId,
                        recordId: intent.next.id,
                        tombstone: intent.next,
                        deltaSequence: nextDeltaSequence,
                        committedAt,
                    });
                    currentById.delete(intent.next.id);
                    entityIdByRecordId.delete(intent.next.id);
                } else {
                    applyAddOrChange({
                        draft,
                        migration: context.migration,
                        opaqueVaultKey: this.opaqueVaultKey,
                        expectedSourceHash: this.expectedSourceHash,
                        record: intent.next,
                        baseRecord: intent.base,
                        claimId,
                        deltaSequence: nextDeltaSequence,
                        committedAt,
                    });
                    currentById.set(intent.next.id, cloneRecord(intent.next));
                }
                nextDeltaSequence += 1;
            }

            const verified = requireCompatibilityContext(
                draft,
                this.opaqueVaultKey,
                this.expectedSourceHash,
                transactionTime,
            );
            return {
                records: cloneRecords(verified.records),
                commitSequence: draft.commitSequence + 1,
            } satisfies TransactionResult;
        });

        this.records = cloneRecords(result.records);
        this.cachedCommitSequence = result.commitSequence;
        this.stale = this.highestObservedCommitSequence > this.cachedCommitSequence;
    }

    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.operationTail.then(operation, operation);
        this.operationTail = result.then(() => undefined, () => undefined);
        return result;
    }

    private assertActive(): void {
        if (this.disposed) throw adapterError("repository_disposed");
    }
}

export async function createDeviceMemoryGovernanceRecordRepository(
    options: DeviceMemoryGovernanceRecordRepositoryOptions,
): Promise<DeviceMemoryGovernanceRecordRepository> {
    const adapter = new DeviceMemoryGovernanceRecordRepository(options);
    try {
        await adapter.refresh();
        return adapter;
    } catch (error) {
        adapter.dispose();
        throw error;
    }
}

function buildWriteIntents(
    currentRecords: readonly ConfirmedMemoryRecord[],
    nextRecords: readonly ConfirmedMemoryRecord[],
): RecordWriteIntent[] {
    const currentById = new Map(currentRecords.map((record) => [record.id, record]));
    const nextById = new Map(nextRecords.map((record) => [record.id, record]));
    const intents: RecordWriteIntent[] = [];

    for (const current of currentRecords) {
        if (!nextById.has(current.id)) throw adapterError("record_removal_requires_forget");
    }
    for (const next of nextRecords) {
        const current = currentById.get(next.id);
        if (!current) {
            intents.push({ kind: "add", next: cloneRecord(next) });
            continue;
        }
        const baseChecksum = recordChecksum(current);
        if (baseChecksum === recordChecksum(next)) continue;
        intents.push({
            kind: next.lifecycle === "forgotten_tombstone" ? "forget" : "change",
            base: cloneRecord(current),
            baseChecksum,
            next: cloneRecord(next),
        });
    }
    return intents;
}

function requireCompatibilityContext(
    state: DeviceMemoryGovernanceStateV1,
    opaqueVaultKey: string,
    expectedSourceHash: string,
    now: Date,
): CompatibilityContext {
    const migration = state.migrationStates[opaqueVaultKey];
    if (!migration) throw adapterError("migration_missing");
    if (migration.sourceHash !== expectedSourceHash) {
        throw adapterError("migration_source_mismatch");
    }
    if (migration.phase !== "compatibility" || migration.lastErrorCode) {
        throw adapterError("migration_phase_blocked");
    }
    const projection = buildLegacyMemoryRollbackProjection(state, opaqueVaultKey, now);
    if (!projection.ok) throw adapterError("rollback_projection_invalid");
    return {
        migration,
        records: cloneRecords(projection.projection.records),
        entityIdByRecordId: buildRecordEntityIndex(state, migration, opaqueVaultKey),
    };
}

function buildRecordEntityIndex(
    state: DeviceMemoryGovernanceStateV1,
    migration: MemoryMigrationState,
    opaqueVaultKey: string,
): Map<string, string> {
    const indexed = new Map<string, string>();
    for (const entry of state.rollbackPayloadEntries) {
        if (entry.migrationRunId !== migration.migrationRunId
            || entry.partition.kind !== "vault"
            || entry.partition.key !== opaqueVaultKey
            || entry.value.kind !== "claim") continue;
        const recordId = entry.value.record.id;
        const existing = indexed.get(recordId);
        if (existing && existing !== entry.entityId) {
            throw adapterError("claim_mapping_ambiguous");
        }
        indexed.set(recordId, entry.entityId);
    }
    return indexed;
}

function applyAddOrChange(input: {
    draft: DeviceMemoryGovernanceStateV1;
    migration: MemoryMigrationState;
    opaqueVaultKey: string;
    expectedSourceHash: string;
    record: ConfirmedMemoryRecord;
    baseRecord: ConfirmedMemoryRecord | undefined;
    claimId: string | undefined;
    deltaSequence: number;
    committedAt: string;
}): string {
    const lifecycle = mapLifecycle(input.record.lifecycle);
    const partition: MemoryPartitionKey = { kind: "vault", key: input.opaqueVaultKey };
    const claimId = input.claimId ?? createDeterministicLegacyMigrationId({
        kind: "claim",
        opaqueVaultKey: input.opaqueVaultKey,
        sourceHash: input.expectedSourceHash,
        legacyId: `device-record:${input.record.id}`,
    });
    const existingClaimIndex = input.draft.claims.findIndex((claim) => claim.id === claimId);
    const existingClaim = existingClaimIndex >= 0
        ? input.draft.claims[existingClaimIndex]
        : undefined;
    if (input.claimId && !existingClaim) throw adapterError("claim_missing");
    if (!input.claimId && existingClaim) throw adapterError("entity_collision");
    if (existingClaim && !partitionsEqual(existingClaim.partition, partition)) {
        throw adapterError("claim_partition_mismatch");
    }
    if (input.baseRecord && !existingClaim?.activeRevisionId) {
        throw adapterError("claim_missing");
    }
    if (existingClaim?.activeRevisionId
        && !input.draft.revisions.some((revision) => (
            revision.id === existingClaim.activeRevisionId && revision.claimId === claimId
        ))) {
        throw adapterError("claim_missing");
    }

    const value: LegacyRollbackValue = {
        kind: "claim",
        record: cloneRecord(input.record),
    };
    const checksum = checksumLegacyRollbackValue(value);
    const revisionId = createDeterministicLegacyMigrationId({
        kind: "revision",
        opaqueVaultKey: input.opaqueVaultKey,
        sourceHash: input.expectedSourceHash,
        legacyId: `device-record:${input.record.id}:revision:${input.deltaSequence}:${checksum}`,
    });
    if (input.draft.revisions.some((revision) => revision.id === revisionId)) {
        throw adapterError("entity_collision");
    }
    const revision: MemoryClaimRevision = {
        id: revisionId,
        claimId,
        summary: input.record.summary,
        provenance: input.record.sourceRefs.map((sourceRef) => ({
            kind: "note" as const,
            sourceRef: cloneSourceRef(sourceRef),
        })),
        authority: authorityForRecord(input.record),
        ...(existingClaim?.activeRevisionId
            ? { supersedesRevisionId: existingClaim.activeRevisionId }
            : {}),
        createdAt: input.baseRecord
            ? input.record.updatedAt
            : input.record.confirmedAt ?? input.record.createdAt,
    };
    input.draft.revisions.push(revision);

    const claim: GovernedMemoryClaim = {
        id: claimId,
        partition,
        memoryType: input.record.type,
        sensitivity: input.record.sensitivity,
        applicability: cloneScope(input.record.scope),
        activeRevisionId: revisionId,
        effect: "stored_not_in_use",
        lifecycle,
        createdAt: existingClaim?.createdAt ?? input.record.createdAt,
        updatedAt: input.record.updatedAt,
        ...(existingClaim?.legacyCompatibility ? {
            legacyCompatibility: {
                recordIdFingerprints: [
                    ...existingClaim.legacyCompatibility.recordIdFingerprints,
                ],
                memoryQueueItemIdFingerprints: [
                    ...existingClaim.legacyCompatibility.memoryQueueItemIdFingerprints,
                ],
            },
        } : {}),
    };
    if (existingClaimIndex >= 0) input.draft.claims[existingClaimIndex] = claim;
    else input.draft.claims.push(claim);

    syncExactOriginLink({
        draft: input.draft,
        claimId,
        opaqueVaultKey: input.opaqueVaultKey,
        sourceHash: input.expectedSourceHash,
        baseRecord: input.baseRecord,
        nextRecord: input.record,
        deltaSequence: input.deltaSequence,
        committedAt: input.committedAt,
    });
    appendClaimDelta({
        draft: input.draft,
        migration: input.migration,
        partition,
        entityId: claimId,
        kind: input.baseRecord ? "claim_changed" : "claim_added",
        value,
        deltaSequence: input.deltaSequence,
        committedAt: input.committedAt,
    });
    return claimId;
}

function applyForget(input: {
    draft: DeviceMemoryGovernanceStateV1;
    migration: MemoryMigrationState;
    opaqueVaultKey: string;
    claimId: string;
    recordId: string;
    tombstone: ConfirmedMemoryRecord;
    deltaSequence: number;
    committedAt: string;
}): void {
    const claimIndex = input.draft.claims.findIndex((claim) => claim.id === input.claimId);
    if (claimIndex < 0) throw adapterError("claim_missing");
    const existing = input.draft.claims[claimIndex];
    const partition: MemoryPartitionKey = { kind: "vault", key: input.opaqueVaultKey };
    if (!partitionsEqual(existing.partition, partition)) {
        throw adapterError("claim_partition_mismatch");
    }

    input.draft.claims[claimIndex] = {
        ...existing,
        applicability: { kind: "custom" },
        effect: "none",
        lifecycle: "forgotten_tombstone",
        updatedAt: input.tombstone.updatedAt,
    };
    delete input.draft.claims[claimIndex].activeRevisionId;
    input.draft.revisions = input.draft.revisions.filter(
        (revision) => revision.claimId !== input.claimId,
    );
    input.draft.projectionLinks = input.draft.projectionLinks.filter(
        (link) => link.claimId !== input.claimId,
    );
    input.draft.undoSnapshots = input.draft.undoSnapshots.filter(
        (snapshot) => snapshot.claimId !== input.claimId,
    );
    input.draft.pendingOperations = input.draft.pendingOperations.filter(
        (operation) => operation.claimId !== input.claimId,
    );
    input.draft.changeEvents = input.draft.changeEvents.map((event) => {
        if (event.claimId !== input.claimId) return event;
        const redacted = {
            ...event,
            kind: event.kind === "auto_remove" ? "forget" as const : event.kind,
            scopeKey: input.opaqueVaultKey,
            effect: "none" as const,
        };
        delete redacted.undoSnapshotId;
        return redacted;
    });

    const removedPayloadIds = new Set<string>();
    input.draft.rollbackPayloadEntries = input.draft.rollbackPayloadEntries.filter((entry) => {
        const belongsToClaim = entry.migrationRunId === input.migration.migrationRunId
            && entry.partition.kind === "vault"
            && entry.partition.key === input.opaqueVaultKey
            && (entry.entityId === input.claimId
                || (entry.value.kind === "claim" && entry.value.record.id === input.recordId));
        if (belongsToClaim) removedPayloadIds.add(entry.id);
        return !belongsToClaim;
    });
    input.draft.migrationDeltas = input.draft.migrationDeltas.map((delta) => {
        if (delta.migrationRunId !== input.migration.migrationRunId
            || (delta.entityId !== input.claimId
                && (!delta.payloadEntryId || !removedPayloadIds.has(delta.payloadEntryId)))) {
            return delta;
        }
        return {
            sequence: delta.sequence,
            migrationRunId: delta.migrationRunId,
            partition: delta.partition,
            committedAt: delta.committedAt,
            kind: "claim_forgotten" as const,
            entityId: input.claimId,
        };
    });
    input.draft.migrationDeltas.push({
        sequence: input.deltaSequence,
        migrationRunId: input.migration.migrationRunId,
        partition,
        committedAt: input.committedAt,
        kind: "claim_forgotten",
        entityId: input.claimId,
    });
}

function appendClaimDelta(input: {
    draft: DeviceMemoryGovernanceStateV1;
    migration: MemoryMigrationState;
    partition: MemoryPartitionKey;
    entityId: string;
    kind: "claim_added" | "claim_changed";
    value: Extract<LegacyRollbackValue, { kind: "claim" }>;
    deltaSequence: number;
    committedAt: string;
}): void {
    const checksum = checksumLegacyRollbackValue(input.value);
    const payloadId = [
        "memory-rollback",
        stableHash(input.migration.migrationRunId),
        input.deltaSequence,
        stableHash(`${input.entityId}:${checksum}`),
    ].join("-");
    if (input.draft.rollbackPayloadEntries.some((entry) => entry.id === payloadId)) {
        throw adapterError("entity_collision");
    }
    if (!input.migration.rollbackExpiresAt) {
        throw adapterError("rollback_projection_invalid");
    }
    input.draft.rollbackPayloadEntries.push({
        id: payloadId,
        migrationRunId: input.migration.migrationRunId,
        partition: input.partition,
        entityId: input.entityId,
        value: cloneJson(input.value),
        checksum,
        expiresAt: input.migration.rollbackExpiresAt,
    });
    input.draft.migrationDeltas.push({
        sequence: input.deltaSequence,
        migrationRunId: input.migration.migrationRunId,
        partition: input.partition,
        committedAt: input.committedAt,
        kind: input.kind,
        entityId: input.entityId,
        payloadEntryId: payloadId,
        payloadChecksum: checksum,
    });
}

function syncExactOriginLink(input: {
    draft: DeviceMemoryGovernanceStateV1;
    claimId: string;
    opaqueVaultKey: string;
    sourceHash: string;
    baseRecord: ConfirmedMemoryRecord | undefined;
    nextRecord: ConfirmedMemoryRecord;
    deltaSequence: number;
    committedAt: string;
}): void {
    if (input.baseRecord
        && input.baseRecord.originReviewQueueItemId === input.nextRecord.originReviewQueueItemId) {
        return;
    }
    input.draft.projectionLinks = input.draft.projectionLinks.filter((link) => (
        link.claimId !== input.claimId
        || link.relation !== "origin"
        || link.target.kind !== "review_queue"
    ));
    const originId = input.nextRecord.originReviewQueueItemId;
    if (!originId) return;
    const queueItem = input.draft.memoryQueueItems.find((item) => item.id === originId);
    if (!queueItem
        || queueItem.partition.kind !== "vault"
        || queueItem.partition.key !== input.opaqueVaultKey) {
        throw adapterError("origin_queue_item_missing");
    }
    const linkId = [
        "memory-origin",
        stableHash(input.claimId),
        input.deltaSequence,
        stableHash(originId),
    ].join("-");
    if (input.draft.projectionLinks.some((link) => link.id === linkId)) {
        throw adapterError("entity_collision");
    }
    input.draft.projectionLinks.push({
        id: linkId,
        claimId: input.claimId,
        target: { kind: "review_queue", itemId: originId },
        relation: "origin",
        state: "active",
        sourceFingerprintId: input.sourceHash,
        createdAt: input.committedAt,
    });
}

function nextMigrationDeltaSequence(
    state: DeviceMemoryGovernanceStateV1,
    migrationRunId: string,
): number {
    return state.migrationDeltas
        .filter((delta) => delta.migrationRunId === migrationRunId)
        .reduce((highest, delta) => Math.max(highest, delta.sequence), 0) + 1;
}

function mapLifecycle(
    lifecycle: ConfirmedMemoryRecord["lifecycle"],
): GovernedMemoryClaim["lifecycle"] {
    switch (lifecycle) {
        case "active": return "active";
        case "archived": return "archived";
        case "stale": return "stale";
        case "candidate":
        case "exported":
        case "forgotten_tombstone":
            throw adapterError("unsupported_lifecycle");
    }
}

function authorityForRecord(record: ConfirmedMemoryRecord): MemoryClaimRevision["authority"] {
    if (record.confirmationStrength === "auto") return "pa_inference";
    if (record.confirmationStrength === "light"
        || record.confirmationStrength === "explicit"
        || record.confirmationStrength === "special") return "explicit_user";
    return "source_observation";
}

function normalizeRecords(value: unknown): ConfirmedMemoryRecord[] {
    if (!Array.isArray(value)) throw adapterError("invalid_record");
    const records: ConfirmedMemoryRecord[] = [];
    const ids = new Set<string>();
    for (const candidate of value) {
        const validation = validateConfirmedMemoryRecord(candidate as ConfirmedMemoryRecord);
        if (!validation.ok) throw adapterError("invalid_record");
        if (ids.has(validation.value.id)) throw adapterError("duplicate_record_id");
        ids.add(validation.value.id);
        records.push(cloneRecord(validation.value));
    }
    return records;
}

function recordChecksum(record: ConfirmedMemoryRecord): string {
    return checksumLegacyRollbackValue({ kind: "claim", record: cloneRecord(record) });
}

function cloneRecord(record: ConfirmedMemoryRecord): ConfirmedMemoryRecord {
    return {
        ...record,
        scope: cloneScope(record.scope),
        sourceRefs: record.sourceRefs.map(cloneSourceRef),
    };
}

function cloneRecords(records: readonly ConfirmedMemoryRecord[]): ConfirmedMemoryRecord[] {
    return records.map(cloneRecord);
}

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function partitionsEqual(left: MemoryPartitionKey, right: MemoryPartitionKey): boolean {
    return left.kind === right.kind && left.key === right.key;
}

function adapterError(
    code: DeviceMemoryGovernanceRecordRepositoryErrorCode,
): DeviceMemoryGovernanceRecordRepositoryError {
    return new DeviceMemoryGovernanceRecordRepositoryError(code);
}
