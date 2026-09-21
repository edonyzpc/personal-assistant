import { clearPlatformTimeout, setPlatformTimeout, type PlatformTimeoutHandle } from "../platform-dom";
import { MemoryAdmissionCoordinator } from "../pa/memory-admission-coordinator";
import {
    MemoryGovernanceCoordinator,
    type ExactMemoryProjectionCleanupPort,
    type MemoryGovernanceActionIdentity,
} from "../pa/memory-governance-coordinator";
import type {
    DeviceMemoryGovernanceStateV1,
    MemoryGovernanceRepository,
} from "../pa/memory-governance-persistence";
import {
    MemoryProfileProjectionWorker,
    type MemoryProfileProjectionWorkerOptions,
} from "../pa/memory-profile-projection-worker";
import type { PanelMemoryGovernanceRecord } from "../pagelet/panel/types";
import type { MemoryRecordActionResult } from "../pagelet/tab/sections/types";
import type { PageletLookupKey } from "../locales/pagelet";
import type { PluginMessageKey } from "../locales/plugin";
import {
    memoryActionFingerprint,
    memoryActionIdentity,
    type MemoryActionPortInput,
} from "../ai-services/memory-action-types";
import type { MemoryActionGovernanceResult } from "../pa/memory-action-port";

const MEMORY_FORGET_RETRY_INITIAL_MS = 1_000;
const MEMORY_FORGET_RETRY_MAX_MS = 60_000;
const MEMORY_PROFILE_PROJECTION_RETRY_INITIAL_MS = 1_000;
const MEMORY_PROFILE_PROJECTION_RETRY_MAX_MS = 60_000;
const MEMORY_GOVERNANCE_GARBAGE_COLLECTION_RETRY_MS = 60_000;
const MEMORY_GOVERNANCE_COMPLETED_HISTORY_RETENTION_MS = 7 * 24 * 60 * 60_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

interface PluginGovernanceActionsOptions {
    isUnloading: () => boolean;
    isRuntimeReady: () => boolean;
    getCurrentState: () => DeviceMemoryGovernanceStateV1 | null;
    refreshActionState: () => Promise<void>;
    notifySettingsChanged: () => Promise<void>;
    readActionBoundary: (claimId: string) => Promise<boolean | null>;
    readCommittedState: () => Promise<DeviceMemoryGovernanceStateV1 | undefined>;
    getPanelRecord: (claimId: string) => PanelMemoryGovernanceRecord | undefined;
    pageletMessage: (key: PageletLookupKey) => string;
    pluginMessage: (key: PluginMessageKey) => string;
    log: (message: string, detail?: unknown) => void;
}

export type GovernanceLifecycleAction = "correct" | "pause" | "resume" | "apply_device_wide"
    | "limit_to_current_vault" | "forget" | "undo";

type GovernanceLifecycleOperationResult = {
    ok: boolean;
    reason?: string;
    pending?: boolean;
    value?: {
        claimId: string;
        eventId: string;
        undoExpiresAt?: string;
        superseded?: boolean;
    };
};

export interface GovernanceActionRuntime {
    coordinator: MemoryGovernanceCoordinator;
    admissionCoordinator: MemoryAdmissionCoordinator;
    profileProjectionWorker: MemoryProfileProjectionWorker;
}

export interface PrepareGovernanceActionRuntimeInput {
    repository: MemoryGovernanceRepository;
    opaqueVaultKey: string;
    projectionCleanupPort: ExactMemoryProjectionCleanupPort;
    applyProjection: MemoryProfileProjectionWorkerOptions["applyProjection"];
    removeProjection: NonNullable<MemoryProfileProjectionWorkerOptions["removeProjection"]>;
}

/** Owns governance action serialization and all action-owned background resources. */
export class PluginGovernanceActions {
    private coordinator: MemoryGovernanceCoordinator | null = null;
    private admissionCoordinator: MemoryAdmissionCoordinator | null = null;
    private profileProjectionWorker: MemoryProfileProjectionWorker | null = null;
    private forgetRetryTimer: PlatformTimeoutHandle | null = null;
    private forgetRetryDelayMs = MEMORY_FORGET_RETRY_INITIAL_MS;
    private profileProjectionRetryTimer: PlatformTimeoutHandle | null = null;
    private profileProjectionRetryDelayMs = MEMORY_PROFILE_PROJECTION_RETRY_INITIAL_MS;
    private garbageCollectionTimer: PlatformTimeoutHandle | null = null;
    private garbageCollectionDueAt: number | null = null;
    private lifecycleMutationTail: Promise<void> = Promise.resolve();
    private queueAuditPromise: Promise<void> | null = null;
    private runtimeGeneration = 0;

    constructor(private readonly options: PluginGovernanceActionsOptions) {}

    prepareRuntime(input: PrepareGovernanceActionRuntimeInput): GovernanceActionRuntime {
        this.clearRuntime();
        const runtime = {
            coordinator: new MemoryGovernanceCoordinator({
                repository: input.repository,
                opaqueVaultKey: input.opaqueVaultKey,
                projectionCleanupPort: input.projectionCleanupPort,
            }),
            admissionCoordinator: new MemoryAdmissionCoordinator({
                repository: input.repository,
                opaqueVaultKey: input.opaqueVaultKey,
            }),
            profileProjectionWorker: new MemoryProfileProjectionWorker({
                repository: input.repository,
                opaqueVaultKey: input.opaqueVaultKey,
                applyProjection: input.applyProjection,
                removeProjection: input.removeProjection,
            }),
        };
        this.installRuntime(runtime);
        return runtime;
    }

    installRuntime(runtime: GovernanceActionRuntime): void {
        this.coordinator = runtime.coordinator;
        this.admissionCoordinator = runtime.admissionCoordinator;
        this.profileProjectionWorker = runtime.profileProjectionWorker;
    }

    clearRuntime(): void {
        this.runtimeGeneration += 1;
        this.cancelForgetRetry();
        this.cancelProfileProjectionRetry();
        this.cancelGarbageCollection();
        this.coordinator = null;
        this.admissionCoordinator = null;
        this.profileProjectionWorker = null;
    }

    dispose(): void {
        this.clearRuntime();
        this.lifecycleMutationTail = Promise.resolve();
        this.queueAuditPromise = null;
    }

    serialize<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.lifecycleMutationTail.then(operation, operation);
        this.lifecycleMutationTail = result.then(() => undefined, () => undefined);
        return result;
    }

    runLifecycleAction(
        claimId: string,
        action: GovernanceLifecycleAction,
        operation: (
            coordinator: MemoryGovernanceCoordinator,
            dataBoundaryAllowed: boolean,
        ) => Promise<GovernanceLifecycleOperationResult>,
        includeActionReceipt = false,
    ): Promise<MemoryRecordActionResult> {
        const result: Promise<MemoryRecordActionResult> = this.serialize(async () => {
            const coordinator = this.coordinator;
            if (!coordinator) return this.failureResult(action, "coordinator_unavailable");
            const boundary = await this.options.readActionBoundary(claimId);
            if (boundary === null) return this.failureResult(action, "claim_unavailable");

            let actionResult: GovernanceLifecycleOperationResult;
            try {
                actionResult = await operation(coordinator, boundary);
            } catch (error) {
                this.options.log("Governed Memory lifecycle action threw", { action, claimId, error });
                return this.failureResult(action, "operation_threw");
            }
            if (!actionResult.ok) {
                this.options.log("Governed Memory lifecycle action failed", {
                    action,
                    claimId,
                    reason: actionResult.reason ?? "unknown",
                    pending: actionResult.pending === true,
                });
                if (actionResult.pending === true) this.scheduleForgetRetry();
                return this.failureResult(
                    action,
                    actionResult.reason ?? "unknown",
                    actionResult.pending === true,
                );
            }

            const projectsProfile = action === "correct" || action === "undo"
                || action === "apply_device_wide" || action === "limit_to_current_vault";
            let projectionPending = false;
            let committedState: DeviceMemoryGovernanceStateV1 | undefined;
            if (projectsProfile) {
                try {
                    const recovery = await this.profileProjectionWorker?.resumePending();
                    projectionPending = recovery?.pending.includes(claimId) === true;
                } catch (error) {
                    projectionPending = true;
                    this.options.log("Memory Profile projection failed after lifecycle commit", {
                        action,
                        claimId,
                        error,
                    });
                }
                try {
                    committedState = await this.options.readCommittedState();
                    projectionPending = projectionPending || committedState?.pendingOperations.some((candidate) => (
                        candidate.kind === "profile_projection"
                        && candidate.claimId === claimId
                        && candidate.state === "pending"
                    )) === true;
                } catch (error) {
                    this.options.log("Memory Profile projection state is unavailable after lifecycle commit", {
                        action,
                        claimId,
                        error,
                    });
                }
                if (projectionPending) {
                    this.options.log("Memory Profile projection remains pending after lifecycle action", {
                        action,
                        claimId,
                    });
                    this.scheduleProfileProjectionRetry();
                }
            }
            try {
                await this.options.refreshActionState();
                await this.options.notifySettingsChanged();
            } catch (error) {
                this.options.log("Governed Memory lifecycle action committed before UI state refresh", {
                    action,
                    claimId,
                    error,
                });
            }
            let nextRecord: PanelMemoryGovernanceRecord | undefined;
            try {
                nextRecord = this.options.getPanelRecord(claimId);
            } catch {
                nextRecord = undefined;
            }
            const committedRevisionId = committedState?.claims
                .find((claim) => claim.id === claimId)
                ?.activeRevisionId;
            const receiptDetails = actionResult.value ? {
                claimId: actionResult.value.claimId,
                eventId: actionResult.value.eventId,
                ...(actionResult.value.undoExpiresAt
                    ? { undoExpiresAt: actionResult.value.undoExpiresAt }
                    : {}),
                ...(committedRevisionId || nextRecord?.revisionId
                    ? { revisionId: committedRevisionId ?? nextRecord?.revisionId }
                    : {}),
            } : nextRecord?.revisionId ? { revisionId: nextRecord.revisionId } : {};
            if (projectionPending) {
                const reason = action === "undo"
                    ? "undo_cleanup_pending"
                    : action === "apply_device_wide" || action === "limit_to_current_vault"
                        ? "scope_cleanup_pending"
                        : "profile_projection_pending";
                return {
                    ...this.failureResult(action, reason, true),
                    ...receiptDetails,
                    ...(nextRecord ? { record: cloneSerializable(nextRecord) } : {}),
                };
            }
            return {
                ok: true,
                message: this.successMessage(action),
                actionStatus: actionResult.value?.superseded === true ? "failed" : "applied",
                ...(actionResult.value?.superseded === true ? { reason: "action_superseded" } : {}),
                ...receiptDetails,
                ...(nextRecord ? { record: cloneSerializable(nextRecord) } : {}),
            };
        });
        return includeActionReceipt
            ? result
            : result.then((value) => this.stripActionReceipt(value));
    }

    successMessage(action: GovernanceLifecycleAction): string {
        switch (action) {
            case "correct": return this.options.pageletMessage("pagelet.tab.memory.corrected");
            case "pause": return this.options.pageletMessage("pagelet.tab.memory.paused");
            case "resume": return this.options.pageletMessage("pagelet.tab.memory.resumed");
            case "apply_device_wide":
                return this.options.pluginMessage("plugin.settings.memoryControlCenter.scope.deviceApplied");
            case "limit_to_current_vault":
                return this.options.pluginMessage("plugin.settings.memoryControlCenter.scope.vaultApplied");
            case "forget": return this.options.pageletMessage("pagelet.tab.memory.removed");
            case "undo": return this.options.pageletMessage("pagelet.tab.memory.undone");
        }
    }

    failureResult(
        action: GovernanceLifecycleAction,
        reason: string,
        pending = false,
    ): MemoryRecordActionResult {
        this.options.log("Governed Memory lifecycle action unavailable", { action, reason, pending });
        return {
            ok: false,
            message: pending
                ? action === "forget"
                    ? this.options.pageletMessage("pagelet.tab.memory.forgetPending")
                    : action === "undo"
                        ? this.options.pageletMessage("pagelet.tab.memory.undoCleanupPending")
                        : action === "apply_device_wide"
                            ? this.options.pluginMessage("plugin.settings.memoryControlCenter.scope.cleanupPending")
                            : this.options.pageletMessage("pagelet.tab.memory.actionUnavailable")
                : this.options.pageletMessage("pagelet.tab.memory.actionUnavailable"),
            actionStatus: pending ? "pending" : "failed",
            reason,
            retryScheduled: pending,
        };
    }

    stripActionReceipt(result: MemoryRecordActionResult): MemoryRecordActionResult {
        return {
            ok: result.ok,
            message: result.message,
            ...(result.record ? { record: result.record } : {}),
        };
    }

    async executeActionForPort(
        input: MemoryActionPortInput,
        route: (
            action: Exclude<MemoryActionPortInput["action"], "remember">,
            targetId: string,
            content: string | undefined,
            options: { expectedRevisionId?: string; eventId?: string } | undefined,
            domainAction: MemoryGovernanceActionIdentity,
            isCurrent: () => boolean,
        ) => Promise<MemoryRecordActionResult>,
    ): Promise<MemoryActionGovernanceResult> {
        if (input.action === "remember") {
            return { status: "failed", reason: "action_not_routable" };
        }
        const actionIdentity = memoryActionIdentity(input);
        const actionFingerprint = memoryActionFingerprint(input);
        const result = await route(
            input.action,
            input.targetId!,
            input.content,
            input.expectedRevisionId || input.eventId ? {
                ...(input.expectedRevisionId ? { expectedRevisionId: input.expectedRevisionId } : {}),
                ...(input.eventId ? { eventId: input.eventId } : {}),
            } : undefined,
            { actionIdentity, actionFingerprint },
            input.binding.isCurrent,
        );
        const status = result.actionStatus ?? (result.ok ? "applied" : "failed");
        return {
            status,
            ...(result.reason ? { reason: result.reason } : {}),
            ...(result.claimId ? { claimId: result.claimId } : {}),
            ...(result.revisionId ? { revisionId: result.revisionId } : {}),
            ...(result.eventId ? { eventId: result.eventId } : {}),
            ...(result.queueItemId ? { queueItemId: result.queueItemId } : {}),
            ...(result.undoExpiresAt ? { undoExpiresAt: result.undoExpiresAt } : {}),
            ...(result.retryScheduled ? { retryScheduled: true } : {}),
        };
    }

    reconcileQueueAudit(operation: (isCurrent: () => boolean) => Promise<void>): Promise<void> {
        if (this.options.isUnloading()) return Promise.resolve();
        if (this.queueAuditPromise) return this.queueAuditPromise;
        const generation = this.runtimeGeneration;
        const result = operation(() => !this.options.isUnloading()
            && this.runtimeGeneration === generation);
        this.queueAuditPromise = result;
        void result.then(
            () => { if (this.queueAuditPromise === result) this.queueAuditPromise = null; },
            () => { if (this.queueAuditPromise === result) this.queueAuditPromise = null; },
        );
        return result;
    }

    scheduleForgetRetry(): void {
        if (this.options.isUnloading() || this.forgetRetryTimer !== null
            || !this.options.isRuntimeReady() || !this.coordinator) return;
        const delay = this.forgetRetryDelayMs;
        this.forgetRetryTimer = setPlatformTimeout(() => {
            this.forgetRetryTimer = null;
            void this.serialize(async () => {
                const coordinator = this.coordinator;
                if (!coordinator || this.options.isUnloading() || !this.options.isRuntimeReady()) return;
                const recovery = await coordinator.resumePendingForgets();
                await this.options.refreshActionState();
                await this.options.notifySettingsChanged();
                if (recovery.ok && recovery.value.pending.length === 0) {
                    this.cancelForgetRetry();
                    return;
                }
                if (!recovery.ok) {
                    this.options.log("Memory Forget background retry remains pending", { ok: false });
                }
                this.forgetRetryDelayMs = Math.min(delay * 2, MEMORY_FORGET_RETRY_MAX_MS);
                this.scheduleForgetRetry();
            }).catch((error) => {
                this.options.log("Memory Forget background retry failed", {
                    errorType: error instanceof Error ? "error" : "unknown_error",
                });
                this.forgetRetryDelayMs = Math.min(delay * 2, MEMORY_FORGET_RETRY_MAX_MS);
                this.scheduleForgetRetry();
            });
        }, delay);
    }

    cancelForgetRetry(): void {
        if (this.forgetRetryTimer !== null) {
            clearPlatformTimeout(this.forgetRetryTimer);
            this.forgetRetryTimer = null;
        }
        this.forgetRetryDelayMs = MEMORY_FORGET_RETRY_INITIAL_MS;
    }

    scheduleProfileProjectionRetry(): void {
        if (this.options.isUnloading() || this.profileProjectionRetryTimer !== null
            || !this.profileProjectionWorker) return;
        const delay = this.profileProjectionRetryDelayMs;
        this.profileProjectionRetryTimer = setPlatformTimeout(() => {
            this.profileProjectionRetryTimer = null;
            void this.serialize(async () => {
                const worker = this.profileProjectionWorker;
                if (!worker) return;
                const recovery = await worker.resumePending();
                await this.options.refreshActionState();
                await this.options.notifySettingsChanged();
                if (recovery.pending.length === 0) {
                    this.profileProjectionRetryDelayMs = MEMORY_PROFILE_PROJECTION_RETRY_INITIAL_MS;
                    return;
                }
                this.profileProjectionRetryDelayMs = Math.min(
                    delay * 2,
                    MEMORY_PROFILE_PROJECTION_RETRY_MAX_MS,
                );
                this.scheduleProfileProjectionRetry();
            }).catch((error) => {
                this.options.log("Memory Profile projection background retry failed", error);
                this.profileProjectionRetryDelayMs = Math.min(
                    delay * 2,
                    MEMORY_PROFILE_PROJECTION_RETRY_MAX_MS,
                );
                this.scheduleProfileProjectionRetry();
            });
        }, delay);
    }

    cancelProfileProjectionRetry(): void {
        if (this.profileProjectionRetryTimer !== null) {
            clearPlatformTimeout(this.profileProjectionRetryTimer);
            this.profileProjectionRetryTimer = null;
        }
        this.profileProjectionRetryDelayMs = MEMORY_PROFILE_PROJECTION_RETRY_INITIAL_MS;
    }

    scheduleGarbageCollection(minimumDelayMs = 0): void {
        const state = this.options.getCurrentState();
        if (this.options.isUnloading() || !this.options.isRuntimeReady()
            || !this.coordinator || !state) {
            this.cancelGarbageCollection();
            return;
        }
        const expiresAt = nextMemoryGovernanceGarbageCollectionAt(state);
        if (expiresAt === null) {
            this.cancelGarbageCollection();
            return;
        }
        const dueAt = Math.max(expiresAt + 1, Date.now() + Math.max(0, minimumDelayMs));
        if (this.garbageCollectionTimer !== null && this.garbageCollectionDueAt === dueAt) return;
        this.cancelGarbageCollection();
        this.garbageCollectionDueAt = dueAt;
        this.garbageCollectionTimer = setPlatformTimeout(() => {
            this.garbageCollectionTimer = null;
            this.garbageCollectionDueAt = null;
            void this.serialize(async () => {
                const coordinator = this.coordinator;
                if (this.options.isUnloading() || !this.options.isRuntimeReady() || !coordinator) return;
                const result = await coordinator.collectGarbage();
                if (!result.ok) {
                    throw new Error(`Memory governance garbage collection failed: ${result.reason}`);
                }
                await this.options.refreshActionState();
                await this.options.notifySettingsChanged();
                const currentState = this.options.getCurrentState();
                const nextAt = currentState
                    ? nextMemoryGovernanceGarbageCollectionAt(currentState)
                    : null;
                this.scheduleGarbageCollection(
                    nextAt !== null && nextAt < Date.now()
                        ? MEMORY_GOVERNANCE_GARBAGE_COLLECTION_RETRY_MS
                        : 0,
                );
            }).catch((error) => {
                this.options.log("Memory governance garbage collection failed", error);
                this.scheduleGarbageCollection(MEMORY_GOVERNANCE_GARBAGE_COLLECTION_RETRY_MS);
            });
        }, Math.min(Math.max(0, dueAt - Date.now()), MAX_TIMER_DELAY_MS));
    }

    cancelGarbageCollection(): void {
        if (this.garbageCollectionTimer !== null) {
            clearPlatformTimeout(this.garbageCollectionTimer);
            this.garbageCollectionTimer = null;
        }
        this.garbageCollectionDueAt = null;
    }

    get governanceCoordinator(): MemoryGovernanceCoordinator | null { return this.coordinator; }
    set governanceCoordinator(value: MemoryGovernanceCoordinator | null) { this.coordinator = value; }
    get admission(): MemoryAdmissionCoordinator | null { return this.admissionCoordinator; }
    set admission(value: MemoryAdmissionCoordinator | null) { this.admissionCoordinator = value; }
    get projectionWorker(): MemoryProfileProjectionWorker | null { return this.profileProjectionWorker; }
    set projectionWorker(value: MemoryProfileProjectionWorker | null) { this.profileProjectionWorker = value; }
    get forgetTimer(): PlatformTimeoutHandle | null { return this.forgetRetryTimer; }
    set forgetTimer(value: PlatformTimeoutHandle | null) { this.forgetRetryTimer = value; }
    get forgetDelayMs(): number { return this.forgetRetryDelayMs; }
    set forgetDelayMs(value: number) { this.forgetRetryDelayMs = value; }
    get projectionRetryTimer(): PlatformTimeoutHandle | null { return this.profileProjectionRetryTimer; }
    set projectionRetryTimer(value: PlatformTimeoutHandle | null) { this.profileProjectionRetryTimer = value; }
    get projectionRetryDelayMs(): number { return this.profileProjectionRetryDelayMs; }
    set projectionRetryDelayMs(value: number) { this.profileProjectionRetryDelayMs = value; }
    get gcTimer(): PlatformTimeoutHandle | null { return this.garbageCollectionTimer; }
    set gcTimer(value: PlatformTimeoutHandle | null) { this.garbageCollectionTimer = value; }
    get gcDueAt(): number | null { return this.garbageCollectionDueAt; }
    set gcDueAt(value: number | null) { this.garbageCollectionDueAt = value; }
    get mutationTail(): Promise<void> { return this.lifecycleMutationTail; }
    set mutationTail(value: Promise<void>) { this.lifecycleMutationTail = value; }
    get auditPromise(): Promise<void> | null { return this.queueAuditPromise; }
    set auditPromise(value: Promise<void> | null) { this.queueAuditPromise = value; }
}

export function nextMemoryGovernanceGarbageCollectionAt(
    state: DeviceMemoryGovernanceStateV1,
): number | null {
    const expirations: number[] = [];
    const retainedUndoSnapshotIds = new Set(state.undoSnapshots.map((snapshot) => snapshot.id));
    for (const snapshot of state.undoSnapshots) {
        const expiresAt = Date.parse(snapshot.expiresAt);
        if (Number.isFinite(expiresAt)) expirations.push(expiresAt);
    }
    const now = Date.now();
    const eventById = new Map(state.changeEvents.map((event) => [event.id, event]));
    const retainedEventIds = new Set<string>();
    const eventDeadlines = new Map<string, number>();
    for (const event of state.changeEvents) {
        const occurredAt = Date.parse(event.occurredAt);
        if (!Number.isFinite(occurredAt)) {
            retainedEventIds.add(event.id);
            continue;
        }
        const deadline = occurredAt + MEMORY_GOVERNANCE_COMPLETED_HISTORY_RETENTION_MS;
        eventDeadlines.set(event.id, deadline);
        if (deadline >= now
            || (event.undoSnapshotId && retainedUndoSnapshotIds.has(event.undoSnapshotId))) {
            retainedEventIds.add(event.id);
        }
    }
    const pendingAncestors = [...retainedEventIds];
    while (pendingAncestors.length > 0) {
        const retained = eventById.get(pendingAncestors.pop()!);
        if (!retained?.undoesEventId || retainedEventIds.has(retained.undoesEventId)) continue;
        retainedEventIds.add(retained.undoesEventId);
        pendingAncestors.push(retained.undoesEventId);
    }
    for (const event of state.changeEvents) {
        const deadline = eventDeadlines.get(event.id);
        if (deadline === undefined) continue;
        const protectedBySnapshot = Boolean(
            event.undoSnapshotId && retainedUndoSnapshotIds.has(event.undoSnapshotId),
        );
        if (protectedBySnapshot) continue;
        if (deadline >= now || !retainedEventIds.has(event.id)) expirations.push(deadline);
    }
    for (const operation of state.pendingOperations) {
        if (operation.kind !== "profile_projection" || operation.state !== "applied") continue;
        const updatedAt = Date.parse(operation.updatedAt);
        if (Number.isFinite(updatedAt)) {
            expirations.push(updatedAt + MEMORY_GOVERNANCE_COMPLETED_HISTORY_RETENTION_MS);
        }
    }
    for (const [vaultKey, migration] of Object.entries(state.migrationStates)) {
        if (migration.phase === "finalizing" || migration.phase === "rolling_back"
            || migration.phase === "governed_preserving_legacy") continue;
        const policy = state.policyStates[vaultKey];
        if (migration.phase === "compatibility"
            && (!policy
                || policy.contextProjectionMode !== "governed"
                || policy.mode !== "effect_based")) continue;
        if (!migration.rollbackExpiresAt) continue;
        const expiresAt = Date.parse(migration.rollbackExpiresAt);
        if (Number.isFinite(expiresAt)) expirations.push(expiresAt);
    }
    return expirations.length > 0 ? Math.min(...expirations) : null;
}

function cloneSerializable<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}
