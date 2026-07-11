import { hashLegacyMemoryPayload } from "./memory-governance-migration";
import { checksumLegacyRollbackValue } from "./memory-governance-migration-coordinator";
import { buildLegacyMemoryRollbackProjection } from "./memory-governance-rollback";
import type {
    DeviceMemoryGovernanceStateV1,
    DeviceMemoryQueueItem,
    MemoryGovernanceRepository,
    MemoryPartitionKey,
    MemoryRollbackPayloadEntry,
} from "./memory-governance-persistence";
import {
    normalizeReviewQueueState,
    type ReviewQueueItem,
    type ReviewQueueRepository,
    type ReviewQueueState,
} from "./review-queue-store";

export type MemoryReviewQueueRepositoryErrorCode =
    | "invalid_vault_key"
    | "invalid_queue_state"
    | "queue_id_collision"
    | "stale_queue_conflict"
    | "cross_partition_write_not_atomic"
    | "memory_queue_delete_not_representable"
    | "memory_migration_not_writable"
    | "memory_migration_rolling_back"
    | "memory_migration_finalized"
    | "rollback_window_expired"
    | "rollback_projection_invalid"
    | "rollback_delta_sequence_invalid"
    | "rollback_queue_lineage_invalid"
    | "rollback_payload_id_collision";

export class MemoryReviewQueueRepositoryError extends Error {
    constructor(readonly code: MemoryReviewQueueRepositoryErrorCode) {
        super(`Memory review queue repository failed: ${code}`);
        this.name = "MemoryReviewQueueRepositoryError";
    }
}

export interface MemoryReviewQueueRepositoryOptions {
    repository: MemoryGovernanceRepository;
    settingsRepository: ReviewQueueRepository;
    opaqueVaultKey: string;
    now?: () => Date;
}

/**
 * Composite queue adapter. Memory Candidate/conflict items are device-local;
 * every other queue type remains in the settings callback repository.
 */
export class MemoryReviewQueueRepository implements ReviewQueueRepository {
    private state: ReviewQueueState;
    private mutationTail: Promise<void> = Promise.resolve();

    private constructor(
        private readonly repository: MemoryGovernanceRepository,
        private readonly settingsRepository: ReviewQueueRepository,
        private readonly opaqueVaultKey: string,
        private readonly now: () => Date,
        initialItems: readonly ReviewQueueItem[],
    ) {
        this.state = { items: initialItems.map(cloneReviewQueueItem) };
    }

    static async initialize(
        options: MemoryReviewQueueRepositoryOptions,
    ): Promise<MemoryReviewQueueRepository> {
        const opaqueVaultKey = options.opaqueVaultKey.trim();
        if (!opaqueVaultKey) throw new MemoryReviewQueueRepositoryError("invalid_vault_key");
        const deviceState = await options.repository.initialize();
        const settingsItems = normalizeQueueStateStrict(options.settingsRepository.read());
        const liveNonMemoryItems = settingsItems.filter((item) => !isMemoryQueueItem(item));
        const localMemoryItems = deviceState.memoryQueueItems
            .filter((item) => isVaultPartition(item.partition, opaqueVaultKey))
            .map(fromDeviceMemoryQueueItem);
        assertUniqueQueueIds([...liveNonMemoryItems, ...localMemoryItems]);
        return new MemoryReviewQueueRepository(
            options.repository,
            options.settingsRepository,
            opaqueVaultKey,
            options.now ?? (() => new Date()),
            [...liveNonMemoryItems, ...localMemoryItems],
        );
    }

    read(): ReviewQueueState {
        return { items: this.state.items.map(cloneReviewQueueItem) };
    }

    write(state: ReviewQueueState): Promise<void> {
        return this.serializeMutation(async () => {
            const nextItems = normalizeQueueStateStrict(state);
            assertUniqueQueueIds(nextItems);
            const currentMemory = this.state.items.filter(isMemoryQueueItem);
            const currentNonMemory = this.state.items.filter((item) => !isMemoryQueueItem(item));
            const nextMemory = nextItems.filter(isMemoryQueueItem);
            const nextNonMemory = nextItems.filter((item) => !isMemoryQueueItem(item));
            const memoryChanged = queueItemsFingerprint(currentMemory) !== queueItemsFingerprint(nextMemory);
            const nonMemoryChanged = queueItemsFingerprint(currentNonMemory) !== queueItemsFingerprint(nextNonMemory);

            if (memoryChanged && nonMemoryChanged) {
                throw new MemoryReviewQueueRepositoryError("cross_partition_write_not_atomic");
            }
            let committedItems = nextItems;
            if (memoryChanged) {
                const committedMemory = await this.writeMemoryPartition(currentMemory, nextMemory);
                const committedMemoryById = new Map(committedMemory.map((item) => [item.id, item]));
                const includedIds = new Set<string>();
                committedItems = nextItems.flatMap((item) => {
                    if (!isMemoryQueueItem(item)) return [item];
                    const committed = committedMemoryById.get(item.id);
                    if (!committed) return [];
                    includedIds.add(item.id);
                    return [committed];
                });
                committedItems.push(...committedMemory.filter((item) => !includedIds.has(item.id)));
            } else if (nonMemoryChanged) {
                await this.settingsRepository.write({
                    items: nextNonMemory.map(cloneReviewQueueItem),
                });
            }
            this.state = { items: committedItems.map(cloneReviewQueueItem) };
        });
    }

    private async writeMemoryPartition(
        baseItems: readonly MemoryReviewQueueItem[],
        nextItems: readonly MemoryReviewQueueItem[],
    ): Promise<MemoryReviewQueueItem[]> {
        const partition: MemoryPartitionKey = { kind: "vault", key: this.opaqueVaultKey };
        const now = this.now();
        const committedAt = now.toISOString();
        return this.repository.transact((draft) => {
            const migration = requireWritableMigration(draft, this.opaqueVaultKey, now);
            if (migration) assertRollbackProjectionValid(draft, this.opaqueVaultKey, now);
            const currentItems = draft.memoryQueueItems.filter(
                (item) => isVaultPartition(item.partition, this.opaqueVaultKey),
            );
            if (migration) {
                for (const item of currentItems) {
                    if (!resolveLegacyQueueItemId(draft, migration.migrationRunId, item.id)) {
                        throw new MemoryReviewQueueRepositoryError("rollback_queue_lineage_invalid");
                    }
                }
            }
            const baseById = new Map(baseItems.map((item) => [item.id, item]));
            const requestedById = new Map(nextItems.map((item) => [item.id, item]));
            const changedIds = new Set([...baseById.keys(), ...requestedById.keys()].filter((id) => {
                const base = baseById.get(id);
                const requested = requestedById.get(id);
                return !base || !requested
                    || queueItemsFingerprint([base]) !== queueItemsFingerprint([requested]);
            }));
            const currentById = new Map(currentItems.map((item) => [item.id, item]));
            const changedItems: DeviceMemoryQueueItem[] = [];
            for (const id of changedIds) {
                const base = baseById.get(id);
                const requested = requestedById.get(id);
                const current = currentById.get(id);
                const currentFingerprint = current
                    ? queueItemsFingerprint([fromDeviceMemoryQueueItem(current)])
                    : null;
                const baseFingerprint = base ? queueItemsFingerprint([base]) : null;
                const requestedFingerprint = requested ? queueItemsFingerprint([requested]) : null;
                if (currentFingerprint !== baseFingerprint) {
                    if (currentFingerprint === requestedFingerprint) continue;
                    throw new MemoryReviewQueueRepositoryError("stale_queue_conflict");
                }
                if (!requested) {
                    if (migration) {
                        throw new MemoryReviewQueueRepositoryError("memory_queue_delete_not_representable");
                    }
                    currentById.delete(id);
                    continue;
                }
                const nextDeviceItem = toDeviceMemoryQueueItem(
                    requested,
                    partition,
                    current?.governanceAdmission,
                );
                currentById.set(id, nextDeviceItem);
                changedItems.push(nextDeviceItem);
            }
            let sequence = migration
                ? validateAndGetNextDeltaSequence(draft, migration.migrationRunId)
                : 0;
            for (const item of changedItems) {
                if (!migration) continue;
                const legacyItemId = resolveLegacyQueueItemId(
                    draft,
                    migration.migrationRunId,
                    item.id,
                ) ?? item.id;
                const rollbackItem = {
                    ...fromDeviceMemoryQueueItem(item),
                    id: legacyItemId,
                };
                const value = { kind: "memory_queue" as const, item: rollbackItem };
                const checksum = checksumLegacyRollbackValue(value);
                const payloadEntry = createQueueRollbackPayloadEntry({
                    migrationRunId: migration.migrationRunId,
                    partition,
                    entityId: item.id,
                    sequence,
                    value,
                    checksum,
                    expiresAt: migration.rollbackExpiresAt!,
                });
                if (draft.rollbackPayloadEntries.some((entry) => entry.id === payloadEntry.id)) {
                    throw new MemoryReviewQueueRepositoryError("rollback_payload_id_collision");
                }
                draft.rollbackPayloadEntries.push(payloadEntry);
                draft.migrationDeltas.push({
                    sequence,
                    migrationRunId: migration.migrationRunId,
                    partition,
                    committedAt,
                    kind: "queue_changed",
                    entityId: item.id,
                    payloadEntryId: payloadEntry.id,
                    payloadChecksum: checksum,
                });
                sequence += 1;
            }

            draft.memoryQueueItems = [
                ...draft.memoryQueueItems.filter(
                    (item) => !isVaultPartition(item.partition, this.opaqueVaultKey),
                ),
                ...currentById.values(),
            ];
            if (migration) assertRollbackProjectionValid(draft, this.opaqueVaultKey, now);
            return [...currentById.values()].map(fromDeviceMemoryQueueItem);
        });
    }

    private serializeMutation(operation: () => Promise<void>): Promise<void> {
        const result = this.mutationTail.then(operation, operation);
        this.mutationTail = result.then(() => undefined, () => undefined);
        return result;
    }
}

export function createMemoryReviewQueueRepository(
    options: MemoryReviewQueueRepositoryOptions,
): Promise<MemoryReviewQueueRepository> {
    return MemoryReviewQueueRepository.initialize(options);
}

type MemoryReviewQueueItem = ReviewQueueItem & {
    type: "memory_candidate" | "memory_conflict";
};

function requireWritableMigration(
    state: DeviceMemoryGovernanceStateV1,
    opaqueVaultKey: string,
    now: Date,
): DeviceMemoryGovernanceStateV1["migrationStates"][string] | null {
    const migration = state.migrationStates[opaqueVaultKey];
    const policy = state.policyStates[opaqueVaultKey];
    if (migration?.phase === "rolling_back") {
        throw new MemoryReviewQueueRepositoryError("memory_migration_rolling_back");
    }
    if (migration?.phase === "finalized") {
        if (policy?.contextProjectionMode !== "governed") {
            throw new MemoryReviewQueueRepositoryError("memory_migration_not_writable");
        }
        return null;
    }
    if (!migration || migration.phase !== "compatibility" || migration.lastErrorCode) {
        throw new MemoryReviewQueueRepositoryError("memory_migration_not_writable");
    }
    const rollbackExpiresAt = Date.parse(migration.rollbackExpiresAt ?? "");
    if (!Number.isFinite(rollbackExpiresAt) || rollbackExpiresAt < now.getTime()) {
        if (policy?.contextProjectionMode !== "governed") {
            throw new MemoryReviewQueueRepositoryError("memory_migration_not_writable");
        }
        return null;
    }
    return migration;
}

function validateAndGetNextDeltaSequence(
    state: DeviceMemoryGovernanceStateV1,
    migrationRunId: string,
): number {
    const deltas = state.migrationDeltas
        .filter((delta) => delta.migrationRunId === migrationRunId)
        .sort((left, right) => left.sequence - right.sequence);
    for (let index = 0; index < deltas.length; index += 1) {
        if (deltas[index].sequence !== index + 1) {
            throw new MemoryReviewQueueRepositoryError("rollback_delta_sequence_invalid");
        }
    }
    return deltas.length + 1;
}

function assertRollbackProjectionValid(
    state: DeviceMemoryGovernanceStateV1,
    opaqueVaultKey: string,
    now: Date,
): void {
    if (!buildLegacyMemoryRollbackProjection(state, opaqueVaultKey, now).ok) {
        throw new MemoryReviewQueueRepositoryError("rollback_projection_invalid");
    }
}

function resolveLegacyQueueItemId(
    state: DeviceMemoryGovernanceStateV1,
    migrationRunId: string,
    entityId: string,
): string | undefined {
    const queueDeltas = state.migrationDeltas
        .filter((delta) => delta.migrationRunId === migrationRunId
            && delta.kind === "queue_changed"
            && delta.entityId === entityId)
        .sort((left, right) => right.sequence - left.sequence);
    const referencedPayloadIds = new Set(
        state.migrationDeltas
            .filter((delta) => delta.migrationRunId === migrationRunId)
            .map((delta) => delta.payloadEntryId)
            .filter((id): id is string => Boolean(id)),
    );
    if (queueDeltas[0] && (!queueDeltas[0].payloadEntryId || !queueDeltas[0].payloadChecksum)) {
        throw new MemoryReviewQueueRepositoryError("rollback_queue_lineage_invalid");
    }
    const latestPayloadId = queueDeltas[0]?.payloadEntryId;
    const candidates = latestPayloadId
        ? state.rollbackPayloadEntries.filter((entry) => entry.id === latestPayloadId)
        : state.rollbackPayloadEntries.filter((entry) => entry.migrationRunId === migrationRunId
            && entry.entityId === entityId
            && entry.value.kind === "memory_queue"
            && !referencedPayloadIds.has(entry.id));
    if (candidates.length > 1) {
        throw new MemoryReviewQueueRepositoryError("rollback_queue_lineage_invalid");
    }
    const candidate = candidates[0];
    if (!candidate) return undefined;
    if (candidate.migrationRunId !== migrationRunId
        || candidate.entityId !== entityId
        || candidate.value.kind !== "memory_queue"
        || candidate.checksum !== checksumLegacyRollbackValue(candidate.value)) {
        throw new MemoryReviewQueueRepositoryError("rollback_queue_lineage_invalid");
    }
    return candidate.value.item.id;
}

function createQueueRollbackPayloadEntry(input: {
    migrationRunId: string;
    partition: MemoryPartitionKey;
    entityId: string;
    sequence: number;
    value: Extract<MemoryRollbackPayloadEntry["value"], { kind: "memory_queue" }>;
    checksum: string;
    expiresAt: string;
}): MemoryRollbackPayloadEntry {
    const digest = hashLegacyMemoryPayload({
        memoryGovernance: {
            kind: "memory_queue_delta_payload",
            migrationRunId: input.migrationRunId,
            entityId: input.entityId,
            sequence: input.sequence,
            checksum: input.checksum,
        },
        reviewQueue: undefined,
        confirmedMemoryCount: undefined,
        memoryAutoAcceptPaused: undefined,
    }).slice("legacy-v1:".length);
    return {
        id: `memory-queue-rollback-${digest.slice(0, 24)}`,
        migrationRunId: input.migrationRunId,
        partition: input.partition,
        entityId: input.entityId,
        value: cloneRollbackValue(input.value),
        checksum: input.checksum,
        expiresAt: input.expiresAt,
    };
}

function normalizeQueueStateStrict(state: ReviewQueueState): ReviewQueueItem[] {
    if (!state || !Array.isArray(state.items)) {
        throw new MemoryReviewQueueRepositoryError("invalid_queue_state");
    }
    const normalized = normalizeReviewQueueState({ items: state.items });
    if (normalized.items.length !== state.items.length) {
        throw new MemoryReviewQueueRepositoryError("invalid_queue_state");
    }
    return normalized.items.map(cloneReviewQueueItem);
}

function assertUniqueQueueIds(items: readonly ReviewQueueItem[]): void {
    const ids = new Set<string>();
    for (const item of items) {
        if (ids.has(item.id)) throw new MemoryReviewQueueRepositoryError("queue_id_collision");
        ids.add(item.id);
    }
}

function queueItemsFingerprint(items: readonly ReviewQueueItem[]): string {
    // This fingerprint compares either the Memory or non-Memory partition
    // after callers have already split them. The migration source hash
    // intentionally ignores valid non-Memory items, so it must not be reused
    // here or non-Memory writes would be mistaken for no-ops.
    return JSON.stringify(items.map(cloneReviewQueueItem));
}

function isMemoryQueueItem(item: ReviewQueueItem): item is MemoryReviewQueueItem {
    return item.type === "memory_candidate" || item.type === "memory_conflict";
}

function isVaultPartition(partition: MemoryPartitionKey, opaqueVaultKey: string): boolean {
    return partition.kind === "vault" && partition.key === opaqueVaultKey;
}

function toDeviceMemoryQueueItem(
    item: MemoryReviewQueueItem,
    partition: MemoryPartitionKey,
    governanceAdmission?: DeviceMemoryQueueItem["governanceAdmission"],
): DeviceMemoryQueueItem {
    return {
        ...cloneReviewQueueItem(item),
        type: item.type,
        partition: { ...partition },
        ...(governanceAdmission
            ? { governanceAdmission: JSON.parse(JSON.stringify(governanceAdmission)) }
            : {}),
    };
}

function fromDeviceMemoryQueueItem(item: DeviceMemoryQueueItem): MemoryReviewQueueItem {
    const queueItem = cloneReviewQueueItem(item) as unknown as Record<string, unknown>;
    delete queueItem.partition;
    delete queueItem.governanceAdmission;
    delete queueItem.legacyCompatibilityItemFingerprint;
    return queueItem as unknown as MemoryReviewQueueItem;
}

function cloneReviewQueueItem<T extends ReviewQueueItem>(item: T): T {
    return JSON.parse(JSON.stringify(item)) as T;
}

function cloneRollbackValue<T extends MemoryRollbackPayloadEntry["value"]>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}
