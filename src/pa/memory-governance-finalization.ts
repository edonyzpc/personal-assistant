import { cloneScope, cloneSourceRef, stableHash } from "./helpers";
import { validateConfirmedMemoryRecord, type ConfirmedMemoryRecord } from "./memory-governance-store";
import {
    buildLegacyMemoryRollbackProjection,
    type LegacyMemoryRollbackProjection,
} from "./memory-governance-rollback";
import { checksumLegacyRollbackValue } from "./memory-governance-rollback-checksum";
import {
    MEMORY_EXTERNAL_OPERATION_TIMEOUT_MS,
    withMemoryExternalOperationTimeout,
} from "./memory-external-operation-timeout";
import { validateReviewQueueItem, type ReviewQueueItem } from "./review-queue-store";
import type {
    DeviceMemoryGovernanceStateV1,
    LegacyRollbackValue,
    MemoryGovernanceRepository,
    MemoryMigrationState,
    MemoryRollbackPayloadEntry,
    PersistedMemoryProvenance,
} from "./memory-governance-persistence";

const FRESH_RESTORE_PROOF_WINDOW_MS = 7 * 24 * 60 * 60_000;

export interface MemoryGovernanceFinalizationPreview {
    eligible: boolean;
    confirmationToken?: string;
    migrationRunId?: string;
    rollbackExpiresAt?: string;
    legacyRecordCount: number;
    legacyMemoryQueueCount: number;
    warningCode: "other_devices_may_still_depend_on_legacy_data";
    requiresFreshRestoreProof?: boolean;
    blockedReason?: string;
}

export interface MemoryGovernanceFinalizationCoordinatorOptions {
    repository: MemoryGovernanceRepository;
    opaqueVaultKey: string;
    /** Returns false when the persisted source changed immediately before the write. */
    clearLegacyMemorySlices: (expectedSourceHash: string) => Promise<boolean | void>;
    readLegacySourceSnapshot: () => Promise<LegacyMemoryFinalizationSourceSnapshot>;
    now?: () => Date;
    externalOperationTimeoutMs?: number;
}

export interface LegacyMemoryFinalizationSourceSnapshot {
    sourceHash: string;
    projection: LegacyMemoryRollbackProjection;
}

export type MemoryGovernanceFinalizationResult =
    | { ok: true; phase: "finalized" }
    | { ok: false; phase: "compatibility" | "finalizing"; reason: string };

class FinalizationError extends Error {
    constructor(readonly code: string) {
        super(`Memory finalization failed: ${code}`);
        this.name = "FinalizationError";
    }
}

interface FinalizationLock {
    runId: string;
    previousMigration: MemoryMigrationState;
    freshRestoreProofInstalled: boolean;
}

type FreshLegacyRestoreProjectionResult =
    | { ok: true; projection: LegacyMemoryRollbackProjection }
    | { ok: false; reason: string };

/** Read-only preview. Calling it never changes local or legacy state. */
export function previewMemoryGovernanceFinalization(
    state: DeviceMemoryGovernanceStateV1,
    opaqueVaultKey: string,
    now = new Date(),
): MemoryGovernanceFinalizationPreview {
    const warningCode = "other_devices_may_still_depend_on_legacy_data" as const;
    const vaultKey = opaqueVaultKey.trim();
    const migration = state.migrationStates[vaultKey];
    if (!vaultKey || !migration || (migration.phase !== "compatibility" && migration.phase !== "finalizing")) {
        return {
            eligible: false,
            legacyRecordCount: 0,
            legacyMemoryQueueCount: 0,
            warningCode,
            blockedReason: "finalization_not_available",
        };
    }
    const policy = state.policyStates[vaultKey];
    if (!policy || policy.mode !== "effect_based" || policy.contextProjectionMode !== "governed") {
        return {
            eligible: false,
            migrationRunId: migration.migrationRunId,
            rollbackExpiresAt: migration.rollbackExpiresAt,
            legacyRecordCount: 0,
            legacyMemoryQueueCount: 0,
            warningCode,
            blockedReason: "governed_cutover_incomplete",
        };
    }
    if (migration.pendingLegacySourceHash) {
        return {
            eligible: false,
            migrationRunId: migration.migrationRunId,
            rollbackExpiresAt: migration.rollbackExpiresAt,
            legacyRecordCount: 0,
            legacyMemoryQueueCount: 0,
            warningCode,
            blockedReason: "legacy_source_reconciliation_required",
        };
    }
    if (hasPendingFinalizationOperation(state, vaultKey)) {
        return {
            eligible: false,
            migrationRunId: migration.migrationRunId,
            rollbackExpiresAt: migration.rollbackExpiresAt,
            legacyRecordCount: 0,
            legacyMemoryQueueCount: 0,
            warningCode,
            blockedReason: "finalization_pending_operations",
        };
    }
    const rollbackExpiry = Date.parse(migration.rollbackExpiresAt ?? "");
    const verificationTime = migration.phase === "finalizing" && Number.isFinite(rollbackExpiry)
        ? new Date(Math.min(now.getTime(), rollbackExpiry - 1))
        : now;
    const rollback = buildLegacyMemoryRollbackProjection(state, vaultKey, verificationTime);
    if (!rollback.ok && rollback.reason === "rollback_window_expired"
        && migration.phase === "compatibility") {
        const fresh = buildFreshLegacyRestoreProjection(state, vaultKey);
        if (fresh.ok) {
            return {
                eligible: true,
                confirmationToken: buildFreshConfirmationToken(state, vaultKey, fresh.projection),
                migrationRunId: migration.migrationRunId,
                rollbackExpiresAt: migration.rollbackExpiresAt,
                legacyRecordCount: fresh.projection.records.length,
                legacyMemoryQueueCount: fresh.projection.memoryQueueItems.length,
                warningCode,
                requiresFreshRestoreProof: true,
            };
        }
        return {
            eligible: false,
            migrationRunId: migration.migrationRunId,
            rollbackExpiresAt: migration.rollbackExpiresAt,
            legacyRecordCount: 0,
            legacyMemoryQueueCount: 0,
            warningCode,
            blockedReason: fresh.reason,
        };
    }
    if (!rollback.ok) {
        return {
            eligible: false,
            migrationRunId: migration.migrationRunId,
            rollbackExpiresAt: migration.rollbackExpiresAt,
            legacyRecordCount: 0,
            legacyMemoryQueueCount: 0,
            warningCode,
            blockedReason: rollback.reason,
        };
    }
    return {
        eligible: true,
        confirmationToken: buildConfirmationToken(state, vaultKey, rollback.projection),
        migrationRunId: migration.migrationRunId,
        rollbackExpiresAt: migration.rollbackExpiresAt,
        legacyRecordCount: rollback.projection.records.length,
        legacyMemoryQueueCount: rollback.projection.memoryQueueItems.length,
        warningCode,
    };
}

/**
 * Destructive compatibility cleanup that can run only with a current preview
 * token. Local restore data is verified before cleanup and retained until the
 * legacy readback proves empty.
 */
export class MemoryGovernanceFinalizationCoordinator {
    private readonly repository: MemoryGovernanceRepository;
    private readonly opaqueVaultKey: string;
    private readonly clearLegacyMemorySlices: MemoryGovernanceFinalizationCoordinatorOptions["clearLegacyMemorySlices"];
    private readonly readLegacySourceSnapshot: MemoryGovernanceFinalizationCoordinatorOptions["readLegacySourceSnapshot"];
    private readonly now: () => Date;
    private readonly externalOperationTimeoutMs: number;

    constructor(options: MemoryGovernanceFinalizationCoordinatorOptions) {
        this.repository = options.repository;
        this.opaqueVaultKey = options.opaqueVaultKey.trim();
        this.clearLegacyMemorySlices = options.clearLegacyMemorySlices;
        this.readLegacySourceSnapshot = options.readLegacySourceSnapshot;
        this.now = options.now ?? (() => new Date());
        this.externalOperationTimeoutMs = Math.max(
            1,
            options.externalOperationTimeoutMs ?? MEMORY_EXTERNAL_OPERATION_TIMEOUT_MS,
        );
    }

    async preview(): Promise<MemoryGovernanceFinalizationPreview> {
        return previewMemoryGovernanceFinalization(
            await this.repository.initialize(),
            this.opaqueVaultKey,
            this.now(),
        );
    }

    async run(confirmationToken: string): Promise<MemoryGovernanceFinalizationResult> {
        const initial = await this.repository.initialize();
        const preview = previewMemoryGovernanceFinalization(initial, this.opaqueVaultKey, this.now());
        const initialMigration = initial.migrationStates[this.opaqueVaultKey];
        const initialPhase = initialMigration?.phase;
        if (!preview.eligible || !preview.confirmationToken) {
            return {
                ok: false,
                phase: initialPhase === "finalizing" ? "finalizing" : "compatibility",
                reason: preview.blockedReason ?? "finalization_not_available",
            };
        }
        if (!confirmationToken || confirmationToken !== preview.confirmationToken) {
            return {
                ok: false,
                phase: initialPhase === "finalizing" ? "finalizing" : "compatibility",
                reason: "finalization_confirmation_stale",
            };
        }
        const expectedLegacySourceHash = initialMigration?.legacySourceStateHash
            ?? initialMigration?.sourceHash;
        if (!initialMigration?.sourceHash || !expectedLegacySourceHash) {
            return {
                ok: false,
                phase: initialPhase === "finalizing" ? "finalizing" : "compatibility",
                reason: "legacy_source_verification_failed",
            };
        }

        let sourceBeforeLock: LegacyMemoryFinalizationSourceSnapshot;
        try {
            sourceBeforeLock = await this.runExternal(
                "finalization_source_before_lock",
                this.readLegacySourceSnapshot,
            );
            assertLegacySourceSnapshot(sourceBeforeLock);
        } catch {
            return {
                ok: false,
                phase: initialPhase === "finalizing" ? "finalizing" : "compatibility",
                reason: "legacy_source_verification_failed",
            };
        }
        const sourceWasAlreadyEmpty = legacyProjectionIsEmpty(sourceBeforeLock.projection);
        const sourceMatchesCapturedMigration = sourceBeforeLock.sourceHash === expectedLegacySourceHash;
        if (!sourceMatchesCapturedMigration
            && !(initialPhase === "finalizing" && sourceWasAlreadyEmpty)) {
            await this.markLegacySourceChanged(preview.migrationRunId!, sourceBeforeLock.sourceHash);
            return {
                ok: false,
                phase: "compatibility",
                reason: "legacy_source_reconciliation_required",
            };
        }

        let lock: FinalizationLock;

        try {
            const lockedAt = this.now();
            lock = await this.repository.transact((draft) => {
                const migration = draft.migrationStates[this.opaqueVaultKey];
                if (!migration || migration.migrationRunId !== preview.migrationRunId
                    || (migration.phase !== "compatibility" && migration.phase !== "finalizing")) {
                    throw new FinalizationError("finalization_state_changed");
                }
                const authoritativePreview = previewMemoryGovernanceFinalization(
                    draft,
                    this.opaqueVaultKey,
                    this.now(),
                );
                if (!authoritativePreview.eligible
                    || authoritativePreview.confirmationToken !== confirmationToken) {
                    throw new FinalizationError("finalization_confirmation_stale");
                }
                const previousMigration = cloneMigrationState(migration);
                let freshRestoreProofInstalled = false;
                if (authoritativePreview.requiresFreshRestoreProof) {
                    installFreshRestoreProof(
                        draft,
                        this.opaqueVaultKey,
                        confirmationToken,
                        lockedAt,
                    );
                    freshRestoreProofInstalled = true;
                }
                const lockedMigration = draft.migrationStates[this.opaqueVaultKey];
                if (!lockedMigration) throw new FinalizationError("finalization_state_changed");
                lockedMigration.phase = "finalizing";
                delete lockedMigration.lastErrorCode;
                return {
                    runId: lockedMigration.migrationRunId,
                    previousMigration,
                    freshRestoreProofInstalled,
                };
            });
        } catch (error) {
            const reason = error instanceof FinalizationError
                ? error.code
                : "finalization_lock_failed";
            return {
                ok: false,
                phase: initialPhase === "finalizing" ? "finalizing" : "compatibility",
                reason,
            };
        }

        let sourceBeforeClear: LegacyMemoryFinalizationSourceSnapshot;
        try {
            sourceBeforeClear = await this.runExternal(
                "finalization_source_before_clear",
                this.readLegacySourceSnapshot,
            );
            assertLegacySourceSnapshot(sourceBeforeClear);
        } catch {
            await this.recordRetryableFailure(lock.runId, "legacy_source_verification_failed");
            return {
                ok: false,
                phase: "finalizing",
                reason: "legacy_source_verification_failed",
            };
        }

        const sourceIsEmptyBeforeClear = legacyProjectionIsEmpty(sourceBeforeClear.projection);
        const unchangedClearableSource = !sourceWasAlreadyEmpty
            && sourceBeforeClear.sourceHash === sourceBeforeLock.sourceHash
            && sourceBeforeClear.sourceHash === expectedLegacySourceHash;
        if (!sourceIsEmptyBeforeClear && !unchangedClearableSource) {
            await this.releaseLockForChangedSource(lock, sourceBeforeClear.sourceHash);
            return {
                ok: false,
                phase: "compatibility",
                reason: "legacy_source_reconciliation_required",
            };
        }

        try {
            if (!sourceIsEmptyBeforeClear) {
                const cleared = await this.runExternal(
                    "finalization_clear_legacy",
                    () => this.clearLegacyMemorySlices(expectedLegacySourceHash),
                );
                if (cleared === false) {
                    let changedSourceHash = sourceBeforeClear.sourceHash;
                    try {
                        const changed = await this.runExternal(
                            "finalization_changed_source",
                            this.readLegacySourceSnapshot,
                        );
                        assertLegacySourceSnapshot(changed);
                        changedSourceHash = changed.sourceHash;
                    } catch {
                        // The guarded write did not run, so recovery proof remains intact.
                    }
                    await this.releaseLockForChangedSource(lock, changedSourceHash);
                    return {
                        ok: false,
                        phase: "compatibility",
                        reason: "legacy_source_reconciliation_required",
                    };
                }
            }
            const readback = await this.runExternal(
                "finalization_readback",
                this.readLegacySourceSnapshot,
            );
            assertLegacySourceSnapshot(readback);
            if (!legacyProjectionIsEmpty(readback.projection)) {
                throw new FinalizationError("finalization_readback_not_empty");
            }
        } catch (error) {
            const reason = error instanceof FinalizationError
                ? error.code
                : "finalization_cleanup_failed";
            await this.recordRetryableFailure(lock.runId, reason);
            return { ok: false, phase: "finalizing", reason };
        }

        try {
            await this.repository.transact((draft) => {
                const migration = draft.migrationStates[this.opaqueVaultKey];
                if (!migration || migration.migrationRunId !== lock.runId || migration.phase !== "finalizing") {
                    throw new FinalizationError("finalization_state_changed");
                }
                migration.phase = "finalized";
                delete migration.rollbackExpiresAt;
                delete migration.lastAppliedDeltaSequence;
                delete migration.lastErrorCode;
                delete migration.legacySourceStateHash;
                delete migration.pendingLegacySourceHash;
                for (const claim of draft.claims) delete claim.legacyCompatibility;
                draft.rollbackPayloadEntries = draft.rollbackPayloadEntries
                    .filter((entry) => entry.migrationRunId !== lock.runId);
                draft.migrationDeltas = draft.migrationDeltas
                    .filter((delta) => delta.migrationRunId !== lock.runId);
            });
        } catch (error) {
            const reason = error instanceof FinalizationError
                ? error.code
                : "finalization_commit_failed";
            await this.recordRetryableFailure(lock.runId, reason);
            return { ok: false, phase: "finalizing", reason };
        }
        return { ok: true, phase: "finalized" };
    }

    private runExternal<T>(operation: string, task: () => Promise<T>): Promise<T> {
        return withMemoryExternalOperationTimeout(
            operation,
            task,
            this.externalOperationTimeoutMs,
        );
    }

    private async markLegacySourceChanged(runId: string, sourceHash: string): Promise<void> {
        try {
            await this.repository.transact((draft) => {
                const migration = draft.migrationStates[this.opaqueVaultKey];
                if (!migration || migration.migrationRunId !== runId
                    || (migration.phase !== "compatibility" && migration.phase !== "finalizing")) return;
                migration.phase = "compatibility";
                migration.pendingLegacySourceHash = sourceHash;
                delete migration.lastErrorCode;
            });
        } catch {
            // A later bootstrap/source reconciliation pass will rediscover it.
        }
    }

    private async releaseLockForChangedSource(
        lock: FinalizationLock,
        sourceHash: string,
    ): Promise<void> {
        try {
            await this.repository.transact((draft) => {
                const migration = draft.migrationStates[this.opaqueVaultKey];
                if (!migration || migration.migrationRunId !== lock.runId
                    || migration.phase !== "finalizing") return;
                if (lock.freshRestoreProofInstalled) {
                    draft.rollbackPayloadEntries = draft.rollbackPayloadEntries
                        .filter((entry) => entry.migrationRunId !== lock.runId);
                    draft.migrationDeltas = draft.migrationDeltas
                        .filter((delta) => delta.migrationRunId !== lock.runId);
                    draft.migrationStates[this.opaqueVaultKey] = {
                        ...cloneMigrationState(lock.previousMigration),
                        phase: "compatibility",
                        pendingLegacySourceHash: sourceHash,
                    };
                    delete draft.migrationStates[this.opaqueVaultKey].lastErrorCode;
                    return;
                }
                migration.phase = "compatibility";
                migration.pendingLegacySourceHash = sourceHash;
                delete migration.lastErrorCode;
            });
        } catch {
            // The lock/proof remains fail-closed if the release itself cannot commit.
        }
    }

    private async recordRetryableFailure(runId: string, errorCode: string): Promise<void> {
        try {
            await this.repository.transact((draft) => {
                const migration = draft.migrationStates[this.opaqueVaultKey];
                if (!migration || migration.migrationRunId !== runId || migration.phase !== "finalizing") return;
                migration.lastErrorCode = errorCode;
            });
        } catch {
            // The next explicit retry re-reads the authoritative repository.
        }
    }
}

function hasPendingFinalizationOperation(
    state: DeviceMemoryGovernanceStateV1,
    vaultKey: string,
): boolean {
    for (const claim of state.claims) {
        if (claim.lifecycle === "forget_pending" && partitionTouchesVault(claim.partition, vaultKey)) {
            return true;
        }
    }
    for (const operation of state.pendingOperations) {
        if (operation.kind === "forget") {
            if (partitionTouchesVault(operation.partition, vaultKey)) return true;
            continue;
        }
        if (operation.state !== "pending") continue;
        const claim = state.claims.find((candidate) => candidate.id === operation.claimId);
        if (!claim) return true;
        if (partitionTouchesVault(claim.partition, vaultKey)) return true;
        if (operation.action === "remove" && operation.ownerVaultKey === vaultKey) return true;
    }
    return false;
}

function buildFreshLegacyRestoreProjection(
    state: DeviceMemoryGovernanceStateV1,
    vaultKey: string,
): FreshLegacyRestoreProjectionResult {
    const migration = state.migrationStates[vaultKey];
    const policy = state.policyStates[vaultKey];
    const baseline = policy?.legacyBaseline;
    if (!migration?.sourceHash
        || migration.phase !== "compatibility"
        || migration.pendingLegacySourceHash
        || policy?.mode !== "effect_based"
        || policy.contextProjectionMode !== "governed"
        || !baseline
        || baseline.importedFromSourceHash !== migration.sourceHash) {
        return { ok: false, reason: "fresh_restore_state_invalid" };
    }

    const partitionClaims = state.claims
        .filter((claim) => claim.partition.kind === "vault" && claim.partition.key === vaultKey)
        .sort((left, right) => left.id.localeCompare(right.id));
    const excludedClaimIds = new Set<string>();
    const excludedQueueIds = new Set<string>();
    const records: ConfirmedMemoryRecord[] = [];

    for (const claim of partitionClaims) {
        const claimLinks = state.projectionLinks.filter((link) => link.claimId === claim.id);
        const unchangedMigratedTypeA = claim.updatedAt === claim.createdAt
            && claimLinks.some((link) => (
                link.target.kind === "type_a_profile"
                && link.ruleFingerprint === "legacy-type-a-adoption-v1"
            ));
        if (claim.lifecycle === "undone_add_tombstone" || unchangedMigratedTypeA) {
            excludedClaimIds.add(claim.id);
            addReviewQueueTargets(claimLinks, excludedQueueIds);
            continue;
        }
        if (claim.lifecycle === "forget_pending") {
            return { ok: false, reason: "finalization_pending_operations" };
        }
        if (claim.lifecycle === "forgotten_tombstone") {
            const importedTombstone = Boolean(
                claim.legacyCompatibility?.recordIdFingerprints.length,
            ) && claimLinks.some((link) => (
                link.state === "active"
                && link.target.kind === "prompt_projection"
                && link.ruleFingerprint === "legacy-confirmed-memory-v1"
            ));
            if (!importedTombstone) {
                excludedClaimIds.add(claim.id);
                addReviewQueueTargets(claimLinks, excludedQueueIds);
                continue;
            }
            const tombstone: ConfirmedMemoryRecord = {
                id: claim.id,
                type: claim.memoryType,
                lifecycle: "forgotten_tombstone",
                sensitivity: claim.sensitivity,
                scope: cloneScope(claim.applicability),
                summary: "",
                sourceRefs: [],
                createdAt: claim.createdAt,
                updatedAt: claim.updatedAt,
            };
            const validation = validateConfirmedMemoryRecord(tombstone);
            if (!validation.ok) return { ok: false, reason: "fresh_restore_claim_invalid" };
            records.push(validation.value);
            continue;
        }

        const lifecycle = claim.lifecycle === "paused" || claim.lifecycle === "archived"
            ? "archived" as const
            : claim.lifecycle === "stale"
                ? "stale" as const
                : claim.lifecycle === "active"
                    ? "active" as const
                    : null;
        if (!lifecycle || !claim.activeRevisionId) {
            return { ok: false, reason: "fresh_restore_claim_invalid" };
        }
        const revision = state.revisions.find((candidate) => (
            candidate.id === claim.activeRevisionId && candidate.claimId === claim.id
        ));
        if (!revision) return { ok: false, reason: "fresh_restore_revision_missing" };
        const activeOrigins = claimLinks
            .filter((link) => link.state === "active" && link.target.kind === "review_queue")
            .filter((link) => state.memoryQueueItems.some((item) => (
                item.id === (link.target.kind === "review_queue" ? link.target.itemId : "")
                && item.partition.kind === "vault"
                && item.partition.key === vaultKey
            )))
            .sort((left, right) => left.id.localeCompare(right.id));
        if (activeOrigins.length > 1) {
            return { ok: false, reason: "fresh_restore_origin_collision" };
        }
        const originReviewQueueItemId = activeOrigins[0]?.target.kind === "review_queue"
            ? activeOrigins[0].target.itemId
            : undefined;
        const record: ConfirmedMemoryRecord = {
            id: claim.id,
            type: claim.memoryType,
            lifecycle,
            sensitivity: claim.sensitivity,
            scope: cloneScope(claim.applicability),
            summary: revision.summary,
            sourceRefs: sourceRefsFromProvenance(revision.provenance),
            createdAt: claim.createdAt,
            updatedAt: claim.updatedAt,
            confirmedAt: revision.createdAt,
            ...(lifecycle === "archived" ? { archivedAt: claim.updatedAt } : {}),
            confirmationStrength: revision.authority === "pa_inference" ? "auto" : "explicit",
            confirmationSource: revision.authority === "pa_inference" ? "chat" : "memory_panel",
            updatePolicy: claim.memoryType === "task_constraint"
                ? "ask-before-cross-scope-use"
                : "manual-only",
            ...(originReviewQueueItemId ? { originReviewQueueItemId } : {}),
        };
        const validation = validateConfirmedMemoryRecord(record);
        if (!validation.ok) return { ok: false, reason: "fresh_restore_claim_invalid" };
        records.push(validation.value);
    }

    for (const operation of state.pendingOperations) {
        if (operation.kind !== "forget" || !partitionTouchesVault(operation.partition, vaultKey)) continue;
        excludedClaimIds.add(operation.claimId);
        for (const target of operation.targets) {
            const link = state.projectionLinks.find((candidate) => (
                candidate.id === target.projectionLinkId && candidate.claimId === operation.claimId
            ));
            if (link?.target.kind === "review_queue") excludedQueueIds.add(link.target.itemId);
        }
    }
    for (const claimId of excludedClaimIds) {
        addReviewQueueTargets(
            state.projectionLinks.filter((link) => link.claimId === claimId),
            excludedQueueIds,
        );
    }

    const memoryQueueItems: ReviewQueueItem[] = [];
    for (const item of state.memoryQueueItems
        .filter((candidate) => candidate.partition.kind === "vault" && candidate.partition.key === vaultKey)
        .filter((candidate) => !excludedQueueIds.has(candidate.id))
        .sort((left, right) => left.id.localeCompare(right.id))) {
        const legacyItem = cloneJson(item) as unknown as Record<string, unknown>;
        delete legacyItem.partition;
        delete legacyItem.governanceAdmission;
        delete legacyItem.legacyCompatibilityItemFingerprint;
        const validation = validateReviewQueueItem(legacyItem as unknown as ReviewQueueItem);
        if (!validation.ok
            || (validation.value.type !== "memory_candidate"
                && validation.value.type !== "memory_conflict")) {
            return { ok: false, reason: "fresh_restore_queue_invalid" };
        }
        memoryQueueItems.push(validation.value);
    }

    return {
        ok: true,
        projection: {
            records: records.sort((left, right) => left.id.localeCompare(right.id)),
            memoryQueueItems,
            confirmedMemoryCount: baseline.confirmedCount,
            memoryAutoAcceptPaused: baseline.autoAcceptPaused,
        },
    };
}

function buildFreshConfirmationToken(
    state: DeviceMemoryGovernanceStateV1,
    vaultKey: string,
    projection: LegacyMemoryRollbackProjection,
): string {
    const migration = state.migrationStates[vaultKey];
    const projectionEvidence = projectionFingerprint(projection);
    const source = JSON.stringify([
        "memory-finalization-fresh-v1",
        vaultKey,
        migration.migrationRunId,
        migration.sourceHash,
        migration.legacySourceStateHash ?? migration.sourceHash,
        migration.cutoverSequence,
        projectionEvidence,
    ]);
    return `finalize-fresh-${opaqueDigest(source)}`;
}

function installFreshRestoreProof(
    state: DeviceMemoryGovernanceStateV1,
    vaultKey: string,
    confirmationToken: string,
    now: Date,
): void {
    const fresh = buildFreshLegacyRestoreProjection(state, vaultKey);
    if (!fresh.ok) throw new FinalizationError(fresh.reason);
    if (buildFreshConfirmationToken(state, vaultKey, fresh.projection) !== confirmationToken) {
        throw new FinalizationError("finalization_confirmation_stale");
    }
    const migration = state.migrationStates[vaultKey];
    if (!migration || migration.phase !== "compatibility") {
        throw new FinalizationError("finalization_state_changed");
    }
    const oldRunId = migration.migrationRunId;
    const nowIso = now.toISOString();
    const freshRunId = `memory-finalization-${opaqueDigest(JSON.stringify([
        oldRunId,
        confirmationToken,
        nowIso,
    ]))}`;
    const expiresAt = new Date(now.getTime() + FRESH_RESTORE_PROOF_WINDOW_MS).toISOString();
    const partition = { kind: "vault" as const, key: vaultKey };
    const values: Array<{ entityId: string; value: LegacyRollbackValue }> = [
        ...fresh.projection.records.map((record) => ({
            entityId: record.id,
            value: { kind: "claim" as const, record: cloneJson(record) },
        })),
        ...fresh.projection.memoryQueueItems.map((item) => ({
            entityId: item.id,
            value: { kind: "memory_queue" as const, item: cloneJson(item) },
        })),
        {
            entityId: `policy:${vaultKey}`,
            value: {
                kind: "policy" as const,
                confirmedMemoryCount: fresh.projection.confirmedMemoryCount,
                memoryAutoAcceptPaused: fresh.projection.memoryAutoAcceptPaused,
            },
        },
    ];
    const entries: MemoryRollbackPayloadEntry[] = values.map(({ entityId, value }) => {
        const checksum = checksumLegacyRollbackValue(value);
        return {
            id: `memory-finalization-proof-${opaqueDigest(JSON.stringify([
                freshRunId,
                value.kind,
                entityId,
                checksum,
            ]))}`,
            migrationRunId: freshRunId,
            partition,
            entityId,
            value,
            checksum,
            expiresAt,
        };
    });
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
        throw new FinalizationError("fresh_restore_entry_collision");
    }

    state.rollbackPayloadEntries = state.rollbackPayloadEntries
        .filter((entry) => entry.migrationRunId !== oldRunId);
    state.migrationDeltas = state.migrationDeltas
        .filter((delta) => delta.migrationRunId !== oldRunId);
    state.rollbackPayloadEntries.push(...entries);
    migration.migrationRunId = freshRunId;
    migration.rollbackExpiresAt = expiresAt;
    migration.cutoverSequence = state.commitSequence + 1;
    delete migration.lastAppliedDeltaSequence;
    delete migration.lastErrorCode;

    const verified = buildLegacyMemoryRollbackProjection(state, vaultKey, now);
    if (!verified.ok
        || projectionFingerprint(verified.projection) !== projectionFingerprint(fresh.projection)) {
        throw new FinalizationError(verified.ok ? "fresh_restore_readback_mismatch" : verified.reason);
    }
}

function sourceRefsFromProvenance(
    provenance: readonly PersistedMemoryProvenance[],
): ReturnType<typeof cloneSourceRef>[] {
    const refs = new Map<string, ReturnType<typeof cloneSourceRef>>();
    const add = (sourceRef: ReturnType<typeof cloneSourceRef>): void => {
        refs.set(JSON.stringify(sourceRef), sourceRef);
    };
    for (const source of provenance) {
        if (source.kind === "note") {
            add(cloneSourceRef(source.sourceRef));
        } else if (source.kind === "vault_aggregate") {
            for (const sourceRef of source.representativeSourceRefs) {
                add(cloneSourceRef(sourceRef));
            }
        }
    }
    return [...refs.values()].sort((left, right) => (
        JSON.stringify(left).localeCompare(JSON.stringify(right))
    ));
}

function addReviewQueueTargets(
    links: readonly DeviceMemoryGovernanceStateV1["projectionLinks"][number][],
    target: Set<string>,
): void {
    for (const link of links) {
        if (link.target.kind === "review_queue") target.add(link.target.itemId);
    }
}

function partitionTouchesVault(
    partition: DeviceMemoryGovernanceStateV1["claims"][number]["partition"],
    vaultKey: string,
): boolean {
    return partition.kind === "device_collaboration"
        || (partition.kind === "vault" && partition.key === vaultKey);
}

function projectionFingerprint(projection: LegacyMemoryRollbackProjection): string {
    const records = projection.records
        .map((record) => `${record.id}:${checksumLegacyRollbackValue({ kind: "claim", record })}`)
        .sort();
    const queue = projection.memoryQueueItems
        .map((item) => `${item.id}:${checksumLegacyRollbackValue({ kind: "memory_queue", item })}`)
        .sort();
    const policy = checksumLegacyRollbackValue({
        kind: "policy",
        confirmedMemoryCount: projection.confirmedMemoryCount,
        memoryAutoAcceptPaused: projection.memoryAutoAcceptPaused,
    });
    return JSON.stringify([records, queue, policy]);
}

function opaqueDigest(source: string): string {
    return ["0", "1", "2", "3"].map((salt) => stableHash(`${salt}:${source}`)).join("");
}

function assertLegacySourceSnapshot(
    snapshot: LegacyMemoryFinalizationSourceSnapshot,
): void {
    if (!snapshot || typeof snapshot.sourceHash !== "string" || !snapshot.sourceHash.trim()
        || !snapshot.projection
        || !Array.isArray(snapshot.projection.records)
        || !Array.isArray(snapshot.projection.memoryQueueItems)
        || !Number.isSafeInteger(snapshot.projection.confirmedMemoryCount)
        || snapshot.projection.confirmedMemoryCount < 0
        || typeof snapshot.projection.memoryAutoAcceptPaused !== "boolean") {
        throw new FinalizationError("legacy_source_verification_failed");
    }
}

function cloneMigrationState(state: MemoryMigrationState): MemoryMigrationState {
    return { ...state };
}

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function buildConfirmationToken(
    state: DeviceMemoryGovernanceStateV1,
    vaultKey: string,
    projection: LegacyMemoryRollbackProjection,
): string {
    const migration = state.migrationStates[vaultKey];
    const runEntries = state.rollbackPayloadEntries
        .filter((entry) => entry.migrationRunId === migration.migrationRunId)
        .map((entry) => `${entry.id}:${entry.checksum}`)
        .sort();
    const runDeltas = state.migrationDeltas
        .filter((delta) => delta.migrationRunId === migration.migrationRunId)
        .map((delta) => `${delta.sequence}:${delta.kind}:${delta.entityId}:${delta.payloadChecksum ?? ""}`)
        .sort();
    const source = JSON.stringify([
        "memory-finalization-v1",
        vaultKey,
        migration.migrationRunId,
        migration.sourceHash,
        migration.legacySourceStateHash ?? migration.sourceHash,
        migration.cutoverSequence,
        runEntries,
        runDeltas,
        projection.records.length,
        projection.memoryQueueItems.length,
    ]);
    return `finalize-${["0", "1", "2", "3"].map((salt) => stableHash(`${salt}:${source}`)).join("")}`;
}

function legacyProjectionIsEmpty(projection: LegacyMemoryRollbackProjection): boolean {
    return Array.isArray(projection.records)
        && projection.records.length === 0
        && Array.isArray(projection.memoryQueueItems)
        && projection.memoryQueueItems.length === 0
        && projection.confirmedMemoryCount === 0
        && projection.memoryAutoAcceptPaused === false;
}
