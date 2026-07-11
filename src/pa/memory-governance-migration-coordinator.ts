import type { ReviewQueueScope } from "./contracts";
import { cloneScope, cloneSourceRef, stableHash } from "./helpers";
import {
    createDeterministicLegacyMigrationId,
    createMigrationOwnedLegacyMemoryPayload,
    createLegacyClaimMigrationId,
    createLegacyMemoryQueueMigrationId,
    createLegacyMigrationRunId,
    createLegacyPolicyMigrationId,
    createLegacyRevisionMigrationId,
    fingerprintLegacyMemoryEntityId,
    hashLegacyMemoryPayload,
    normalizeLegacyMemoryPolicy,
    parseLegacyMemoryPayload,
    type LegacyMemoryParseResult,
    type LegacyMemoryPayload,
} from "./memory-governance-migration";
import type { ConfirmedMemoryRecord } from "./memory-governance-store";
import {
    buildLegacyMemoryRollbackProjection,
    type LegacyMemoryRollbackProjection,
} from "./memory-governance-rollback";
import { checksumLegacyRollbackValue } from "./memory-governance-rollback-checksum";
import type {
    DeviceMemoryGovernanceStateV1,
    DeviceMemoryQueueItem,
    GovernedMemoryClaim,
    LegacyRollbackValue,
    MemoryAdmissionPolicyState,
    MemoryClaimRevision,
    MemoryGovernanceRepository,
    MemoryMigrationState,
    MemoryPartitionKey,
    MemoryPendingOperation,
    MemoryProjectionLink,
    MemoryRollbackPayloadEntry,
    PersistedMemoryProvenance,
} from "./memory-governance-persistence";

export { checksumLegacyRollbackValue } from "./memory-governance-rollback-checksum";

const ROLLBACK_WINDOW_MS = 7 * 24 * 60 * 60_000;

export const LEGACY_TYPE_A_ADOPTION_RULE_FINGERPRINT = "legacy-type-a-adoption-v1";
export const TYPE_A_TARGET_SUPPRESSION_RULE_FINGERPRINT = "type-a-target-suppression-v1";

/**
 * Fail-closed target lineage for migrated Type-A rows. Legacy Profile records
 * predate the governed extraction turn cursor, so they cannot reproduce the
 * newer evidence fingerprint. This opaque target fingerprint lets a legacy
 * Correct/Forget suppress that immutable Profile target until the user clears
 * the marker explicitly, without persisting claim text or conversation IDs.
 */
export function createTypeATargetSuppressionFingerprint(
    opaqueVaultKey: string,
    profileRecordId: string,
): string {
    return `memory-type-a-target-${stableHash(JSON.stringify([
        "type-a-target-suppression-v1",
        opaqueVaultKey.trim(),
        profileRecordId.trim(),
    ]))}`;
}

export type LegacyTypeAAdoptionBlockedReason =
    | "unsupported_kind"
    | "unknown_sensitivity"
    | "invalid_conversation_evidence"
    | "not_positive_allowlist";

export type ClassifiedLegacyTypeAAdoption =
    | {
        status: "adopt";
        profileRecordId: string;
        summary: string;
        applicability: ReviewQueueScope;
        authority: "explicit_user" | "user_correction";
        provenance: PersistedMemoryProvenance[];
        observedAt: string;
        /** Applied only after ProfileStore contains this immutable exact ID. */
        profileProjectionState?: "pending" | "applied";
    }
    | {
        status: "adoption_blocked";
        profileRecordId: string;
        reason: LegacyTypeAAdoptionBlockedReason;
    };

export interface MemoryGovernanceMigrationCoordinatorOptions {
    repository: MemoryGovernanceRepository;
    opaqueVaultKey: string;
    payload: LegacyMemoryPayload;
    typeAAdoptions?: readonly ClassifiedLegacyTypeAAdoption[];
    now?: () => Date;
}

export interface MemoryGovernanceMigrationCounts {
    acceptedClaims: number;
    acceptedMemoryQueueItems: number;
    adoptedTypeA: number;
    blockedTypeA: number;
    rejected: number;
}

export type MemoryGovernanceMigrationCoordinatorResult =
    | {
        ok: true;
        phase: "compatibility" | "finalized";
        sourceHash: string;
        migrationRunId: string;
        cutoverSequence: number;
        alreadyMigrated: boolean;
        contextProjectionMode: "legacy" | "governed";
        reconciliationRequired?: "legacy_source_changed";
        counts: MemoryGovernanceMigrationCounts;
    }
    | {
        ok: false;
        phase: "compatibility" | "failed";
        sourceHash: string;
        migrationRunId: string;
        reason: string;
        counts: MemoryGovernanceMigrationCounts;
    };

interface MigrationImportPlan {
    sourceHash: string;
    migrationRunId: string;
    partition: MemoryPartitionKey;
    rollbackExpiresAt: string;
    claims: GovernedMemoryClaim[];
    revisions: MemoryClaimRevision[];
    memoryQueueItems: DeviceMemoryQueueItem[];
    projectionLinks: MemoryProjectionLink[];
    pendingOperations: MemoryPendingOperation[];
    rollbackPayloadEntries: MemoryRollbackPayloadEntry[];
    importPolicy: MemoryAdmissionPolicyState;
    cutoverContextProjectionMode: "legacy" | "governed";
    counts: MemoryGovernanceMigrationCounts;
}

class MigrationCoordinatorError extends Error {
    constructor(readonly code: string) {
        super(`Memory migration failed: ${code}`);
        this.name = "MigrationCoordinatorError";
    }
}

export class MemoryGovernanceMigrationCoordinator {
    private readonly repository: MemoryGovernanceRepository;
    private readonly opaqueVaultKey: string;
    private readonly rawPayload: LegacyMemoryPayload;
    private readonly payload: LegacyMemoryPayload;
    private readonly typeAAdoptions: readonly ClassifiedLegacyTypeAAdoption[] | undefined;
    private readonly now: () => Date;

    constructor(options: MemoryGovernanceMigrationCoordinatorOptions) {
        this.repository = options.repository;
        this.opaqueVaultKey = options.opaqueVaultKey.trim();
        this.rawPayload = options.payload;
        this.payload = createMigrationOwnedLegacyMemoryPayload(options.payload);
        this.typeAAdoptions = options.typeAAdoptions;
        this.now = options.now ?? (() => new Date());
        if (!this.opaqueVaultKey) throw new MigrationCoordinatorError("invalid_vault_key");
    }

    async run(): Promise<MemoryGovernanceMigrationCoordinatorResult> {
        const parsed = parseLegacyMemoryPayload(this.rawPayload);
        const sourceHash = parsed.sourceHash;
        const migrationRunId = createLegacyMigrationRunId(this.opaqueVaultKey, sourceHash);
        let snapshot = await this.repository.initialize();
        const initialMigration = snapshot.migrationStates[this.opaqueVaultKey];
        const currentLegacySourceHash = initialMigration?.legacySourceStateHash
            ?? initialMigration?.sourceHash;

        if (initialMigration?.phase === "finalized") {
            if (!initialMigration.sourceHash) {
                return this.failureResult(
                    "migration_readback_mismatch",
                    "failed",
                    parsed,
                    migrationRunId,
                );
            }
            if (!legacyMemorySourceIsEmpty(parsed, this.payload)) {
                return this.failureResult(
                    "legacy_source_changed",
                    "failed",
                    parsed,
                    initialMigration.migrationRunId,
                );
            }
            return this.successResult(
                {
                    sourceHash: initialMigration.sourceHash,
                    migrationRunId: initialMigration.migrationRunId,
                    counts: getMigrationCounts(parsed, this.typeAAdoptions),
                },
                initialMigration,
                true,
                "governed",
            );
        }

        if (currentLegacySourceHash && currentLegacySourceHash !== sourceHash) {
            if (initialMigration.phase === "compatibility") {
                const importedSourceHash = initialMigration.sourceHash;
                if (!importedSourceHash) {
                    return this.failureResult(
                        "migration_readback_mismatch",
                        "compatibility",
                        parsed,
                        initialMigration.migrationRunId,
                    );
                }
                if (isExpiredProofCompatibilityRestart(
                    snapshot,
                    this.opaqueVaultKey,
                    importedSourceHash,
                    initialMigration.migrationRunId,
                )) {
                    await this.updatePendingLegacySource(
                        sourceHash,
                        initialMigration.pendingLegacySourceHash,
                    );
                    return this.successResult(
                        {
                            sourceHash: importedSourceHash,
                            migrationRunId: initialMigration.migrationRunId,
                            counts: getMigrationCounts(parsed, this.typeAAdoptions),
                        },
                        initialMigration,
                        true,
                        "governed",
                        "legacy_source_changed",
                    );
                }
                try {
                    const verified = verifyCompatibilityRestart(
                        snapshot,
                        this.opaqueVaultKey,
                        importedSourceHash,
                        initialMigration.migrationRunId,
                    );
                    const sourceIsEquivalent = legacySourceMatchesRollbackProjection(
                        parsed,
                        this.payload,
                        verified.rollbackProjection,
                    );
                    await this.updatePendingLegacySource(
                        sourceIsEquivalent ? undefined : sourceHash,
                        initialMigration.pendingLegacySourceHash,
                    );
                    return this.successResult(
                        {
                            sourceHash: importedSourceHash,
                            migrationRunId: initialMigration.migrationRunId,
                            counts: getMigrationCounts(parsed, this.typeAAdoptions),
                        },
                        initialMigration,
                        true,
                        verified.contextProjectionMode,
                        sourceIsEquivalent ? undefined : "legacy_source_changed",
                    );
                } catch (error) {
                    if (!(error instanceof MigrationCoordinatorError)) throw error;
                    return this.failureResult(
                        error.code,
                        "compatibility",
                        parsed,
                        initialMigration.migrationRunId,
                    );
                }
            }
            await this.recordPreCutoverSourceChanged();
            return this.failureResult("legacy_source_changed", "failed", parsed, migrationRunId);
        }
        if (initialMigration?.phase === "compatibility" && initialMigration.lastErrorCode) {
            return this.failureResult(
                initialMigration.lastErrorCode,
                "compatibility",
                parsed,
                migrationRunId,
            );
        }
        if (initialMigration?.phase === "failed") {
            return this.failureResult(
                initialMigration.lastErrorCode ?? "migration_failed",
                "failed",
                parsed,
                migrationRunId,
            );
        }
        if (initialMigration?.phase === "rolled_back" || initialMigration?.phase === "rolling_back") {
            return this.failureResult(
                "migration_rollback_in_progress",
                "failed",
                parsed,
                migrationRunId,
            );
        }

        if (initialMigration?.phase === "compatibility") {
            const importedSourceHash = initialMigration.sourceHash;
            const importedRunId = initialMigration.migrationRunId;
            if (!importedSourceHash || !importedRunId) {
                return this.failureResult(
                    "migration_readback_mismatch",
                    "compatibility",
                    parsed,
                    migrationRunId,
                );
            }
            if (isExpiredProofCompatibilityRestart(
                snapshot,
                this.opaqueVaultKey,
                importedSourceHash,
                importedRunId,
            )) {
                await this.updatePendingLegacySource(
                    undefined,
                    initialMigration.pendingLegacySourceHash,
                );
                return this.successResult(
                    {
                        sourceHash: importedSourceHash,
                        migrationRunId: importedRunId,
                        counts: getMigrationCounts(parsed, this.typeAAdoptions),
                    },
                    initialMigration,
                    true,
                    "governed",
                );
            }
            try {
                const verified = verifyCompatibilityRestart(
                    snapshot,
                    this.opaqueVaultKey,
                    importedSourceHash,
                    importedRunId,
                );
                await this.updatePendingLegacySource(
                    undefined,
                    initialMigration.pendingLegacySourceHash,
                );
                return this.successResult(
                    {
                        sourceHash: importedSourceHash,
                        migrationRunId: importedRunId,
                        counts: getMigrationCounts(parsed, this.typeAAdoptions),
                    },
                    initialMigration,
                    true,
                    verified.contextProjectionMode,
                );
            } catch (error) {
                if (!(error instanceof MigrationCoordinatorError)) throw error;
                // The governed reader remains authoritative when its rollback
                // projection cannot be proven safe; switching readers here
                // would bypass the verified rollback coordinator.
                return this.failureResult(error.code, "compatibility", parsed, importedRunId);
            }
        }

        const rollbackExpiresAt = initialMigration?.rollbackExpiresAt
            ?? new Date(this.now().getTime() + ROLLBACK_WINDOW_MS).toISOString();
        let plan: MigrationImportPlan;
        try {
            plan = buildMigrationImportPlan({
                parsed,
                payload: this.payload,
                opaqueVaultKey: this.opaqueVaultKey,
                migrationRunId,
                rollbackExpiresAt,
                typeAAdoptions: this.typeAAdoptions,
            });
        } catch (error) {
            if (error instanceof MigrationCoordinatorError) {
                return this.failureResult(error.code, "failed", parsed, migrationRunId);
            }
            throw error;
        }

        if (!initialMigration) {
            try {
                await this.repository.transact((draft) => {
                    const current = draft.migrationStates[this.opaqueVaultKey];
                    if (current?.sourceHash && current.sourceHash !== sourceHash) {
                        throw new MigrationCoordinatorError("legacy_source_changed");
                    }
                    if (!current) {
                        draft.migrationStates[this.opaqueVaultKey] = {
                            migrationRunId,
                            phase: "source_captured",
                            sourceHash,
                            legacySourceStateHash: sourceHash,
                        };
                    }
                });
            } catch (error) {
                if (!(error instanceof MigrationCoordinatorError)) throw error;
                await this.recordPreCutoverSourceChanged();
                return this.failureResult(error.code, "compatibility", parsed, migrationRunId);
            }
            snapshot = await this.repository.initialize();
        }

        let migration = snapshot.migrationStates[this.opaqueVaultKey];
        if (!migration || migration.sourceHash !== sourceHash) {
            await this.recordPreCutoverSourceChanged();
            return this.failureResult(
                "legacy_source_changed",
                "compatibility",
                parsed,
                migrationRunId,
            );
        }

        if (migration.phase === "source_captured" || migration.phase === "local_writing") {
            try {
                await this.repository.transact((draft) => {
                    const state = requireMatchingMigrationState(
                        draft,
                        this.opaqueVaultKey,
                        sourceHash,
                        migrationRunId,
                    );
                    if (state.phase === "local_verifying"
                        || state.phase === "cutover_ready"
                        || state.phase === "compatibility") return;
                    if (state.phase !== "source_captured" && state.phase !== "local_writing") {
                        throw new MigrationCoordinatorError("migration_phase_invalid");
                    }
                    state.phase = "local_writing";
                    importPlanIntoDraft(draft, this.opaqueVaultKey, plan);
                    state.phase = "local_verifying";
                    state.rollbackExpiresAt = plan.rollbackExpiresAt;
                    delete state.lastErrorCode;
                });
            } catch (error) {
                if (!(error instanceof MigrationCoordinatorError)) throw error;
                await this.recordFailure(error.code, sourceHash, migrationRunId);
                return this.failureResult(error.code, "failed", parsed, migrationRunId);
            }
            snapshot = await this.repository.initialize();
            migration = snapshot.migrationStates[this.opaqueVaultKey];
        }

        if (migration.phase === "local_verifying") {
            try {
                await this.repository.transact((draft) => {
                    const state = requireMatchingMigrationState(
                        draft,
                        this.opaqueVaultKey,
                        sourceHash,
                        migrationRunId,
                    );
                    if (state.phase === "cutover_ready" || state.phase === "compatibility") return;
                    if (state.phase !== "local_verifying") {
                        throw new MigrationCoordinatorError("migration_phase_invalid");
                    }
                    verifyMigrationReadback(draft, plan, "legacy");
                    const policy = draft.policyStates[this.opaqueVaultKey];
                    if (!policy) throw new MigrationCoordinatorError("migration_readback_mismatch");
                    policy.contextProjectionMode = plan.cutoverContextProjectionMode;
                    policy.mode = plan.cutoverContextProjectionMode === "governed"
                        ? "effect_based"
                        : "legacy_threshold";
                    state.phase = "cutover_ready";
                    state.cutoverSequence = draft.commitSequence + 1;
                    state.rollbackExpiresAt = plan.rollbackExpiresAt;
                    delete state.lastErrorCode;
                });
            } catch (error) {
                if (!(error instanceof MigrationCoordinatorError)) throw error;
                await this.recordFailure(error.code, sourceHash, migrationRunId);
                return this.failureResult(error.code, "failed", parsed, migrationRunId);
            }
            snapshot = await this.repository.initialize();
            migration = snapshot.migrationStates[this.opaqueVaultKey];
        }

        if (migration.phase === "cutover_ready") {
            try {
                await this.repository.transact((draft) => {
                    const state = requireMatchingMigrationState(
                        draft,
                        this.opaqueVaultKey,
                        sourceHash,
                        migrationRunId,
                    );
                    if (state.phase === "compatibility") return;
                    if (state.phase !== "cutover_ready") {
                        throw new MigrationCoordinatorError("migration_phase_invalid");
                    }
                    verifyMigrationReadback(draft, plan, plan.cutoverContextProjectionMode);
                    if (!state.cutoverSequence || !state.rollbackExpiresAt) {
                        throw new MigrationCoordinatorError("migration_readback_mismatch");
                    }
                    state.phase = "compatibility";
                    delete state.lastErrorCode;
                });
            } catch (error) {
                if (!(error instanceof MigrationCoordinatorError)) throw error;
                await this.recordFailure(error.code, sourceHash, migrationRunId);
                return this.failureResult(error.code, "failed", parsed, migrationRunId);
            }
            snapshot = await this.repository.initialize();
            migration = snapshot.migrationStates[this.opaqueVaultKey];
        }

        if (migration.phase !== "compatibility") {
            await this.recordFailure("migration_phase_invalid", sourceHash, migrationRunId);
            return this.failureResult("migration_phase_invalid", "failed", parsed, migrationRunId);
        }
        return this.successResult(
            plan,
            migration,
            false,
            plan.cutoverContextProjectionMode,
        );
    }

    private successResult(
        plan: Pick<MigrationImportPlan, "sourceHash" | "migrationRunId" | "counts">,
        migration: MemoryMigrationState,
        alreadyMigrated: boolean,
        contextProjectionMode: "legacy" | "governed",
        reconciliationRequired?: "legacy_source_changed",
    ): MemoryGovernanceMigrationCoordinatorResult {
        if (!migration.cutoverSequence) {
            return {
                ok: false,
                phase: "failed",
                sourceHash: plan.sourceHash,
                migrationRunId: plan.migrationRunId,
                reason: "migration_readback_mismatch",
                counts: plan.counts,
            };
        }
        return {
            ok: true,
            phase: migration.phase === "finalized" ? "finalized" : "compatibility",
            sourceHash: plan.sourceHash,
            migrationRunId: plan.migrationRunId,
            cutoverSequence: migration.cutoverSequence,
            alreadyMigrated,
            contextProjectionMode,
            ...(reconciliationRequired ? { reconciliationRequired } : {}),
            counts: plan.counts,
        };
    }

    private failureResult(
        reason: string,
        phase: "compatibility" | "failed",
        parsed: LegacyMemoryParseResult,
        migrationRunId: string,
    ): MemoryGovernanceMigrationCoordinatorResult {
        return {
            ok: false,
            phase,
            sourceHash: parsed.sourceHash,
            migrationRunId,
            reason,
            counts: getMigrationCounts(parsed, this.typeAAdoptions),
        };
    }

    private async updatePendingLegacySource(
        pendingSourceHash: string | undefined,
        currentPendingSourceHash: string | undefined,
    ): Promise<void> {
        if (pendingSourceHash === currentPendingSourceHash) return;
        await this.repository.transact((draft) => {
            const migration = draft.migrationStates[this.opaqueVaultKey];
            if (!migration || migration.phase !== "compatibility") return;
            if (pendingSourceHash) migration.pendingLegacySourceHash = pendingSourceHash;
            else delete migration.pendingLegacySourceHash;
        });
    }

    private async recordPreCutoverSourceChanged(): Promise<void> {
        await this.repository.transact((draft) => {
            const migration = draft.migrationStates[this.opaqueVaultKey];
            if (!migration || migration.phase === "compatibility") return;
            migration.phase = "failed";
            migration.lastErrorCode = "legacy_source_changed";
            const policy = draft.policyStates[this.opaqueVaultKey];
            if (policy) policy.contextProjectionMode = "legacy";
        });
    }

    private async recordFailure(
        errorCode: string,
        sourceHash: string,
        migrationRunId: string,
    ): Promise<void> {
        await this.repository.transact((draft) => {
            const migration = draft.migrationStates[this.opaqueVaultKey];
            if (!migration) {
                draft.migrationStates[this.opaqueVaultKey] = {
                    migrationRunId,
                    sourceHash,
                    legacySourceStateHash: sourceHash,
                    phase: "failed",
                    lastErrorCode: errorCode,
                };
            } else if (migration.sourceHash === sourceHash) {
                migration.phase = "failed";
                migration.lastErrorCode = errorCode;
            }
            const policy = draft.policyStates[this.opaqueVaultKey];
            if (policy) policy.contextProjectionMode = "legacy";
        });
    }
}

function buildMigrationImportPlan(input: {
    parsed: LegacyMemoryParseResult;
    payload: LegacyMemoryPayload;
    opaqueVaultKey: string;
    migrationRunId: string;
    rollbackExpiresAt: string;
    typeAAdoptions?: readonly ClassifiedLegacyTypeAAdoption[];
}): MigrationImportPlan {
    const { parsed, opaqueVaultKey, migrationRunId, rollbackExpiresAt } = input;
    const partition: MemoryPartitionKey = { kind: "vault", key: opaqueVaultKey };
    const claims: GovernedMemoryClaim[] = [];
    const revisions: MemoryClaimRevision[] = [];
    const memoryQueueItems: DeviceMemoryQueueItem[] = [];
    const projectionLinks: MemoryProjectionLink[] = [];
    const pendingOperations: MemoryPendingOperation[] = [];
    const rollbackPayloadEntries: MemoryRollbackPayloadEntry[] = [];
    const queueIdByLegacyId = new Map<string, string>();

    parsed.acceptedMemoryQueueItems.forEach((item, acceptedIndex) => {
        const sourceIndex = findRawItemIndex(input.payload.reviewQueue, item.id, acceptedIndex);
        const id = createLegacyMemoryQueueMigrationId({
            opaqueVaultKey,
            sourceHash: parsed.sourceHash,
            sourceIndex,
            legacyId: `review-queue:${item.id}`,
        });
        const imported: DeviceMemoryQueueItem = {
            ...cloneReviewQueueItem(item),
            id,
            type: item.type as DeviceMemoryQueueItem["type"],
            partition,
            legacyCompatibilityItemFingerprint: fingerprintLegacyMemoryEntityId(
                "memory_queue",
                item.id,
            ),
        };
        memoryQueueItems.push(imported);
        queueIdByLegacyId.set(item.id, id);
        rollbackPayloadEntries.push(createRollbackEntry({
            migrationRunId,
            partition,
            entityId: id,
            value: { kind: "memory_queue", item: cloneReviewQueueItem(item) },
            expiresAt: rollbackExpiresAt,
            opaqueVaultKey,
            sourceHash: parsed.sourceHash,
        }));
    });

    parsed.acceptedClaims.forEach((record, acceptedIndex) => {
        const sourceIndex = findRawItemIndex(input.payload.memoryGovernance, record.id, acceptedIndex, "records");
        const lifecycle = mapLegacyLifecycle(record.lifecycle);
        const claimId = createLegacyClaimMigrationId({
            opaqueVaultKey,
            sourceHash: parsed.sourceHash,
            sourceIndex,
            legacyId: `governance:${record.id}`,
        });
        const revisionId = lifecycle === "forgotten_tombstone"
            ? undefined
            : createLegacyRevisionMigrationId({
                opaqueVaultKey,
                sourceHash: parsed.sourceHash,
                sourceIndex,
                legacyId: `governance:${record.id}`,
            });
        const localQueueId = record.originReviewQueueItemId
            ? queueIdByLegacyId.get(record.originReviewQueueItemId)
            : undefined;
        const claim: GovernedMemoryClaim = {
            id: claimId,
            partition,
            memoryType: record.type,
            sensitivity: record.sensitivity,
            applicability: cloneScope(record.scope),
            ...(revisionId ? { activeRevisionId: revisionId } : {}),
            effect: "stored_not_in_use",
            lifecycle,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            legacyCompatibility: {
                recordIdFingerprints: [fingerprintLegacyMemoryEntityId("record", record.id)],
                memoryQueueItemIdFingerprints: record.originReviewQueueItemId
                    ? [fingerprintLegacyMemoryEntityId(
                        "memory_queue",
                        record.originReviewQueueItemId,
                    )]
                    : [],
            },
        };
        claims.push(claim);
        projectionLinks.push({
            id: createAuxiliaryMigrationId("link", opaqueVaultKey, parsed.sourceHash, {
                claimId,
                targetKind: "prompt_projection",
                targetId: claimId,
            }),
            claimId,
            target: { kind: "prompt_projection", projectionId: claimId },
            relation: "derived_copy",
            state: "active",
            sourceFingerprintId: claimId,
            ruleFingerprint: "legacy-confirmed-memory-v1",
            createdAt: record.confirmedAt ?? record.createdAt,
        });
        if (revisionId) {
            revisions.push({
                id: revisionId,
                claimId,
                summary: record.summary,
                provenance: record.sourceRefs.map((sourceRef) => ({
                    kind: "note" as const,
                    sourceRef: cloneSourceRef(sourceRef),
                })),
                authority: legacyClaimAuthority(record),
                createdAt: record.confirmedAt ?? record.createdAt,
            });
        }
        if (localQueueId) {
            projectionLinks.push({
                id: createAuxiliaryMigrationId("link", opaqueVaultKey, parsed.sourceHash, {
                    claimId,
                    targetKind: "review_queue",
                    targetId: localQueueId,
                }),
                claimId,
                target: { kind: "review_queue", itemId: localQueueId },
                relation: "origin",
                state: "active",
                sourceFingerprintId: claimId,
                ruleFingerprint: "legacy-confirmed-memory-v1",
                createdAt: record.confirmedAt ?? record.createdAt,
            });
        }
        rollbackPayloadEntries.push(createRollbackEntry({
            migrationRunId,
            partition,
            entityId: claimId,
            value: { kind: "claim", record: cloneConfirmedMemoryRecord(record) },
            expiresAt: rollbackExpiresAt,
            opaqueVaultKey,
            sourceHash: parsed.sourceHash,
        }));
    });

    const typeAAdoptions = input.typeAAdoptions;
    const adopted = typeAAdoptions?.filter(
        (entry): entry is Extract<ClassifiedLegacyTypeAAdoption, { status: "adopt" }> => entry.status === "adopt",
    ) ?? [];
    const blockedTypeA = typeAAdoptions?.filter((entry) => entry.status === "adoption_blocked").length ?? 0;
    const typeAContextReady = typeAAdoptions !== undefined
        && blockedTypeA === 0
        && adopted.every((entry) => entry.profileProjectionState === "applied");
    const profileIds = new Set<string>();
    adopted.forEach((adoption) => {
        validateTypeAAdoption(adoption, profileIds);
        const claimId = createDeterministicLegacyMigrationId({
            kind: "claim",
            opaqueVaultKey,
            sourceHash: parsed.sourceHash,
            legacyId: `type-a:${adoption.profileRecordId}`,
        });
        const revisionId = createDeterministicLegacyMigrationId({
            kind: "revision",
            opaqueVaultKey,
            sourceHash: parsed.sourceHash,
            legacyId: `type-a:${adoption.profileRecordId}`,
        });
        claims.push({
            id: claimId,
            partition,
            memoryType: "preference",
            sensitivity: "low",
            applicability: cloneScope(adoption.applicability),
            activeRevisionId: revisionId,
            effect: "future_answers",
            lifecycle: "active",
            createdAt: adoption.observedAt,
            updatedAt: adoption.observedAt,
        });
        revisions.push({
            id: revisionId,
            claimId,
            summary: adoption.summary,
            provenance: cloneProvenance(adoption.provenance),
            authority: adoption.authority,
            createdAt: adoption.observedAt,
        });
        projectionLinks.push({
            id: createAuxiliaryMigrationId("link", opaqueVaultKey, parsed.sourceHash, {
                claimId,
                targetKind: "type_a_profile",
                targetId: adoption.profileRecordId,
            }),
            claimId,
            target: { kind: "type_a_profile", profileRecordId: adoption.profileRecordId },
            relation: "origin",
            state: "active",
            sourceFingerprintId: claimId,
            ruleFingerprint: LEGACY_TYPE_A_ADOPTION_RULE_FINGERPRINT,
            createdAt: adoption.observedAt,
        });
        if (typeAContextReady) {
            projectionLinks.push({
                id: createAuxiliaryMigrationId("link", opaqueVaultKey, parsed.sourceHash, {
                    claimId,
                    targetKind: "prompt_projection",
                    targetId: claimId,
                }),
                claimId,
                target: { kind: "prompt_projection", projectionId: `prompt:${claimId}` },
                relation: "derived_copy",
                state: "active",
                sourceFingerprintId: claimId,
                ruleFingerprint: LEGACY_TYPE_A_ADOPTION_RULE_FINGERPRINT,
                createdAt: adoption.observedAt,
            });
        }
        pendingOperations.push({
            id: createAuxiliaryMigrationId("profile-op", opaqueVaultKey, parsed.sourceHash, {
                claimId,
                profileRecordId: adoption.profileRecordId,
                revisionId,
            }),
            kind: "profile_projection",
            claimId,
            profileRecordId: adoption.profileRecordId,
            targetRevisionId: revisionId,
            state: adoption.profileProjectionState ?? "pending",
            attemptCount: 0,
            createdAt: adoption.observedAt,
            updatedAt: adoption.observedAt,
        });
    });

    const policy = normalizeLegacyMemoryPolicy(input.payload);
    const policyEntityId = createLegacyPolicyMigrationId(opaqueVaultKey, parsed.sourceHash);
    rollbackPayloadEntries.push(createRollbackEntry({
        migrationRunId,
        partition,
        entityId: policyEntityId,
        value: {
            kind: "policy",
            confirmedMemoryCount: policy.baseline.confirmedCount,
            memoryAutoAcceptPaused: policy.baseline.autoAcceptPaused,
        },
        expiresAt: rollbackExpiresAt,
        opaqueVaultKey,
        sourceHash: parsed.sourceHash,
    }));
    const cutoverContextProjectionMode = typeAContextReady ? "governed" : "legacy";
    const importPolicy: MemoryAdmissionPolicyState = {
        version: 1,
        mode: "legacy_threshold",
        contextProjectionMode: "legacy",
        legacyBaseline: {
            confirmedCount: policy.baseline.confirmedCount,
            threshold: 30,
            autoAcceptPaused: policy.baseline.autoAcceptPaused,
            importedFromSourceHash: parsed.sourceHash,
        },
    };

    assertUniqueIds(claims, "migration_claim_id_collision");
    assertUniqueIds(revisions, "migration_revision_id_collision");
    assertUniqueIds(memoryQueueItems, "migration_queue_id_collision");
    assertUniqueIds(projectionLinks, "migration_link_id_collision");
    assertUniqueIds(pendingOperations, "migration_operation_id_collision");
    assertUniqueIds(rollbackPayloadEntries, "migration_rollback_id_collision");

    return {
        sourceHash: parsed.sourceHash,
        migrationRunId,
        partition,
        rollbackExpiresAt,
        claims,
        revisions,
        memoryQueueItems,
        projectionLinks,
        pendingOperations,
        rollbackPayloadEntries,
        importPolicy,
        cutoverContextProjectionMode,
        counts: {
            ...getMigrationCounts(parsed, typeAAdoptions),
            adoptedTypeA: adopted.length,
            blockedTypeA,
        },
    };
}

function importPlanIntoDraft(
    draft: DeviceMemoryGovernanceStateV1,
    opaqueVaultKey: string,
    plan: MigrationImportPlan,
): void {
    upsertEntities(draft.claims, plan.claims, "migration_claim_collision");
    upsertEntities(draft.revisions, plan.revisions, "migration_revision_collision");
    upsertEntities(draft.memoryQueueItems, plan.memoryQueueItems, "migration_queue_collision");
    upsertEntities(draft.projectionLinks, plan.projectionLinks, "migration_link_collision");
    upsertEntities(draft.pendingOperations, plan.pendingOperations, "migration_operation_collision");
    upsertEntities(
        draft.rollbackPayloadEntries,
        plan.rollbackPayloadEntries,
        "migration_rollback_collision",
    );
    const existingPolicy = draft.policyStates[opaqueVaultKey];
    if (existingPolicy && checksumEntity(existingPolicy) !== checksumEntity(plan.importPolicy)) {
        throw new MigrationCoordinatorError("migration_policy_collision");
    }
    draft.policyStates[opaqueVaultKey] = cloneEntity(plan.importPolicy);
}

function verifyMigrationReadback(
    state: DeviceMemoryGovernanceStateV1,
    plan: MigrationImportPlan,
    expectedContextMode: "legacy" | "governed",
): void {
    const migration = state.migrationStates[plan.partition.kind === "vault" ? plan.partition.key : ""];
    if (!migration
        || migration.sourceHash !== plan.sourceHash
        || migration.migrationRunId !== plan.migrationRunId) {
        throw new MigrationCoordinatorError("migration_readback_mismatch");
    }
    verifyEntities(state.claims, plan.claims);
    verifyEntities(state.revisions, plan.revisions);
    verifyEntities(state.memoryQueueItems, plan.memoryQueueItems);
    verifyEntities(state.projectionLinks, plan.projectionLinks);
    verifyEntities(state.pendingOperations, plan.pendingOperations);
    verifyEntities(state.rollbackPayloadEntries, plan.rollbackPayloadEntries);

    const policy = state.policyStates[plan.partition.kind === "vault" ? plan.partition.key : ""];
    const expectedPolicyMode = expectedContextMode === "governed"
        ? "effect_based"
        : "legacy_threshold";
    if (!policy
        || policy.contextProjectionMode !== expectedContextMode
        || policy.mode !== expectedPolicyMode
        || policy.legacyBaseline?.importedFromSourceHash !== plan.sourceHash
        || policy.legacyBaseline.confirmedCount !== plan.importPolicy.legacyBaseline?.confirmedCount
        || policy.legacyBaseline.autoAcceptPaused !== plan.importPolicy.legacyBaseline?.autoAcceptPaused
        || policy.legacyBaseline.threshold !== 30) {
        throw new MigrationCoordinatorError("migration_readback_mismatch");
    }

    for (const claim of plan.claims) {
        if (!partitionsEqual(claim.partition, plan.partition)) {
            throw new MigrationCoordinatorError("migration_partition_mismatch");
        }
        if (claim.activeRevisionId) {
            const revision = state.revisions.find((entry) => entry.id === claim.activeRevisionId);
            if (!revision || revision.claimId !== claim.id) {
                throw new MigrationCoordinatorError("migration_reference_mismatch");
            }
        }
    }
    for (const item of plan.memoryQueueItems) {
        if (!partitionsEqual(item.partition, plan.partition)) {
            throw new MigrationCoordinatorError("migration_partition_mismatch");
        }
    }
    for (const link of plan.projectionLinks) {
        if (link.target.kind === "review_queue") {
            const itemId = link.target.itemId;
            if (!state.memoryQueueItems.some((item) => item.id === itemId)) {
                throw new MigrationCoordinatorError("migration_reference_mismatch");
            }
        }
    }
    const runPayloadEntries = state.rollbackPayloadEntries.filter(
        (entry) => entry.migrationRunId === plan.migrationRunId,
    );
    if (runPayloadEntries.length !== plan.rollbackPayloadEntries.length) {
        throw new MigrationCoordinatorError("migration_count_mismatch");
    }
    for (const entry of runPayloadEntries) {
        if (!partitionsEqual(entry.partition, plan.partition)
            || entry.expiresAt !== plan.rollbackExpiresAt
            || entry.checksum !== checksumLegacyRollbackValue(entry.value)) {
            throw new MigrationCoordinatorError("migration_checksum_mismatch");
        }
    }
}

function verifyCompatibilityRestart(
    state: DeviceMemoryGovernanceStateV1,
    opaqueVaultKey: string,
    sourceHash: string,
    migrationRunId: string,
): {
    contextProjectionMode: "legacy" | "governed";
    rollbackProjection: LegacyMemoryRollbackProjection;
} {
    const migration = state.migrationStates[opaqueVaultKey];
    if (!migration
        || migration.phase !== "compatibility"
        || migration.sourceHash !== sourceHash
        || migration.migrationRunId !== migrationRunId
        || !migration.cutoverSequence
        || !migration.rollbackExpiresAt) {
        throw new MigrationCoordinatorError("migration_readback_mismatch");
    }
    const policy = state.policyStates[opaqueVaultKey];
    if (!policy) throw new MigrationCoordinatorError("migration_readback_mismatch");

    // Compatibility may intentionally outlive the rollback window. Validate
    // the retained base+journal at the inclusive expiry boundary so restart
    // checks integrity without incorrectly re-opening rollback eligibility.
    const validationTime = new Date(migration.rollbackExpiresAt);
    if (!Number.isFinite(validationTime.getTime())) {
        throw new MigrationCoordinatorError("migration_readback_mismatch");
    }
    const rollback = buildLegacyMemoryRollbackProjection(
        state,
        opaqueVaultKey,
        validationTime,
    );
    if (!rollback.ok) throw new MigrationCoordinatorError(rollback.reason);
    return {
        contextProjectionMode: policy.contextProjectionMode,
        rollbackProjection: rollback.projection,
    };
}

function isExpiredProofCompatibilityRestart(
    state: DeviceMemoryGovernanceStateV1,
    opaqueVaultKey: string,
    sourceHash: string,
    migrationRunId: string,
): boolean {
    const migration = state.migrationStates[opaqueVaultKey];
    const policy = state.policyStates[opaqueVaultKey];
    return Boolean(
        migration
        && migration.phase === "compatibility"
        && migration.sourceHash === sourceHash
        && migration.migrationRunId === migrationRunId
        && migration.cutoverSequence
        && !migration.rollbackExpiresAt
        && !migration.lastErrorCode
        && policy?.mode === "effect_based"
        && policy.contextProjectionMode === "governed"
        && policy.legacyBaseline?.importedFromSourceHash === sourceHash
        && !state.rollbackPayloadEntries.some((entry) => entry.migrationRunId === migrationRunId)
        && !state.migrationDeltas.some((delta) => delta.migrationRunId === migrationRunId)
    );
}

function legacySourceMatchesRollbackProjection(
    parsed: LegacyMemoryParseResult,
    payload: LegacyMemoryPayload,
    projection: LegacyMemoryRollbackProjection,
): boolean {
    const policy = normalizeLegacyMemoryPolicy(payload).baseline;
    const sourceFingerprint = legacyProjectionFingerprint({
        records: parsed.acceptedClaims,
        memoryQueueItems: parsed.acceptedMemoryQueueItems,
        confirmedMemoryCount: policy.confirmedCount,
        memoryAutoAcceptPaused: policy.autoAcceptPaused,
    });
    return sourceFingerprint === legacyProjectionFingerprint(projection);
}

function legacyMemorySourceIsEmpty(
    parsed: LegacyMemoryParseResult,
    payload: LegacyMemoryPayload,
): boolean {
    const policy = normalizeLegacyMemoryPolicy(payload).baseline;
    return parsed.rawCounts.governance === 0
        && parsed.rawCounts.memoryQueue === 0
        && parsed.rawCounts.rejected === 0
        && parsed.acceptedClaims.length === 0
        && parsed.acceptedMemoryQueueItems.length === 0
        && policy.confirmedCount === 0
        && policy.autoAcceptPaused === false;
}

function legacyProjectionFingerprint(projection: LegacyMemoryRollbackProjection): string {
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

function createRollbackEntry(input: {
    migrationRunId: string;
    partition: MemoryPartitionKey;
    entityId: string;
    value: LegacyRollbackValue;
    expiresAt: string;
    opaqueVaultKey: string;
    sourceHash: string;
}): MemoryRollbackPayloadEntry {
    const checksum = checksumLegacyRollbackValue(input.value);
    return {
        id: createAuxiliaryMigrationId("rollback", input.opaqueVaultKey, input.sourceHash, {
            migrationRunId: input.migrationRunId,
            entityId: input.entityId,
            checksum,
        }),
        migrationRunId: input.migrationRunId,
        partition: input.partition,
        entityId: input.entityId,
        value: cloneEntity(input.value),
        checksum,
        expiresAt: input.expiresAt,
    };
}

function createAuxiliaryMigrationId(
    prefix: "link" | "profile-op" | "rollback",
    opaqueVaultKey: string,
    sourceHash: string,
    identity: Record<string, unknown>,
): string {
    const digest = hashLegacyMemoryPayload({
        memoryGovernance: { prefix, opaqueVaultKey, sourceHash, identity },
        reviewQueue: undefined,
        confirmedMemoryCount: undefined,
        memoryAutoAcceptPaused: undefined,
    }).slice("legacy-v1:".length);
    return `legacy-${prefix}-${digest.slice(0, 24)}`;
}

function mapLegacyLifecycle(
    lifecycle: ConfirmedMemoryRecord["lifecycle"],
): GovernedMemoryClaim["lifecycle"] {
    switch (lifecycle) {
        case "active": return "active";
        case "archived": return "archived";
        case "stale": return "stale";
        case "forgotten_tombstone": return "forgotten_tombstone";
        case "candidate":
        case "exported":
            throw new MigrationCoordinatorError("unsupported_legacy_lifecycle");
    }
}

function legacyClaimAuthority(
    record: ConfirmedMemoryRecord,
): MemoryClaimRevision["authority"] {
    if (record.confirmationStrength === "auto") return "pa_inference";
    if (record.confirmationStrength === "light"
        || record.confirmationStrength === "explicit"
        || record.confirmationStrength === "special") return "explicit_user";
    return "source_observation";
}

function validateTypeAAdoption(
    adoption: Extract<ClassifiedLegacyTypeAAdoption, { status: "adopt" }>,
    profileIds: Set<string>,
): void {
    if (!adoption.profileRecordId.trim()
        || !adoption.summary.trim()
        || !adoption.observedAt.trim()
        || adoption.provenance.length === 0
        || profileIds.has(adoption.profileRecordId)) {
        throw new MigrationCoordinatorError("invalid_type_a_adoption");
    }
    profileIds.add(adoption.profileRecordId);
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

function cloneConfirmedMemoryRecord(record: ConfirmedMemoryRecord): ConfirmedMemoryRecord {
    return {
        ...record,
        scope: cloneScope(record.scope),
        sourceRefs: record.sourceRefs.map(cloneSourceRef),
    };
}

function cloneReviewQueueItem<T extends { scope: ReviewQueueScope; sourceRefs: ConfirmedMemoryRecord["sourceRefs"]; whyShown: string[]; metadata?: Record<string, string | number | boolean | null> }>(
    item: T,
): T {
    return {
        ...item,
        scope: cloneScope(item.scope),
        sourceRefs: item.sourceRefs.map(cloneSourceRef),
        whyShown: [...item.whyShown],
        metadata: { ...(item.metadata ?? {}) },
    };
}

function findRawItemIndex(
    container: unknown,
    id: string,
    fallback: number,
    field: "items" | "records" = "items",
): number {
    if (typeof container !== "object" || container === null || Array.isArray(container)) return fallback;
    const values = (container as Record<string, unknown>)[field];
    if (!Array.isArray(values)) return fallback;
    const index = values.findIndex((entry) => (
        typeof entry === "object"
        && entry !== null
        && !Array.isArray(entry)
        && (entry as Record<string, unknown>).id === id
    ));
    return index >= 0 ? index : fallback;
}

function requireMatchingMigrationState(
    draft: DeviceMemoryGovernanceStateV1,
    opaqueVaultKey: string,
    sourceHash: string,
    migrationRunId: string,
): MemoryMigrationState {
    const state = draft.migrationStates[opaqueVaultKey];
    if (!state || state.sourceHash !== sourceHash || state.migrationRunId !== migrationRunId) {
        throw new MigrationCoordinatorError("legacy_source_changed");
    }
    return state;
}

function getMigrationCounts(
    parsed: LegacyMemoryParseResult,
    typeAAdoptions: readonly ClassifiedLegacyTypeAAdoption[] | undefined,
): MemoryGovernanceMigrationCounts {
    return {
        acceptedClaims: parsed.acceptedClaims.length,
        acceptedMemoryQueueItems: parsed.acceptedMemoryQueueItems.length,
        adoptedTypeA: typeAAdoptions?.filter((entry) => entry.status === "adopt").length ?? 0,
        blockedTypeA: typeAAdoptions?.filter((entry) => entry.status === "adoption_blocked").length ?? 0,
        rejected: parsed.rejected.length,
    };
}

function upsertEntities<T extends { id: string }>(
    target: T[],
    expected: readonly T[],
    collisionCode: string,
): void {
    for (const entity of expected) {
        const existing = target.find((candidate) => candidate.id === entity.id);
        if (!existing) {
            target.push(cloneEntity(entity));
        } else if (checksumEntity(existing) !== checksumEntity(entity)) {
            throw new MigrationCoordinatorError(collisionCode);
        }
    }
}

function verifyEntities<T extends { id: string }>(actual: readonly T[], expected: readonly T[]): void {
    for (const entity of expected) {
        const found = actual.find((candidate) => candidate.id === entity.id);
        if (!found || checksumEntity(found) !== checksumEntity(entity)) {
            throw new MigrationCoordinatorError("migration_readback_mismatch");
        }
    }
}

function assertUniqueIds(values: readonly { id: string }[], errorCode: string): void {
    const ids = new Set<string>();
    for (const value of values) {
        if (ids.has(value.id)) throw new MigrationCoordinatorError(errorCode);
        ids.add(value.id);
    }
}

function checksumEntity(value: unknown): string {
    return hashLegacyMemoryPayload({
        memoryGovernance: cloneEntity(value),
        reviewQueue: undefined,
        confirmedMemoryCount: undefined,
        memoryAutoAcceptPaused: undefined,
    });
}

function cloneEntity<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function partitionsEqual(left: MemoryPartitionKey, right: MemoryPartitionKey): boolean {
    return left.kind === right.kind && left.key === right.key;
}
