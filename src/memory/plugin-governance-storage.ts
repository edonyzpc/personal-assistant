import type { PluginManagerSettings } from "../settings";
import { normalizeConfirmedMemoryCount } from "../settings";
import { stableHash } from "../pa/helpers";
import { LegacyMemoryCompatibilityBarrier } from "../pa/memory-governance-compatibility";
import {
    buildLegacyReviewQueuePassthrough,
    captureLegacyMemoryPayload,
    hashLegacyMemoryPayload,
    type LegacyMemoryPayload,
} from "../pa/memory-governance-migration";
import { checksumLegacyRollbackValue } from "../pa/memory-governance-migration-coordinator";
import {
    createDeviceMemoryGovernanceRepository,
    type DeviceMemoryGovernanceStateV1,
    type LegacyRollbackValue,
    type MemoryGovernanceRepository,
    type MemoryPartitionKey,
} from "../pa/memory-governance-persistence";
import type { DeviceMemoryGovernanceRecordRepository } from "../pa/memory-governance-record-repository";
import { buildLegacyMemoryRollbackProjection } from "../pa/memory-governance-rollback";
import {
    createMemoryReviewQueueRepository,
    type MemoryReviewQueueRepository,
} from "../pa/memory-review-queue-repository";
import { buildGovernedMemoryViewSnapshot } from "../pa/memory-governance-view";
import {
    CallbackMemoryGovernanceRecordRepository,
    MemoryGovernanceStore,
    type ConfirmedMemoryRecord,
    type MemoryGovernanceRecordRepository,
    type MemoryGovernanceState,
} from "../pa/memory-governance-store";
import {
    CallbackReviewQueueRepository,
    ReviewQueueStore,
    type ReviewQueueItem,
    type ReviewQueueRepository,
    type ReviewQueueState,
} from "../pa/review-queue-store";

const MEMORY_GOVERNANCE_OPAQUE_KEY_VERSION = "memory-governance-v1";

export type MemoryGovernanceBootstrapState = "not_started" | "ready" | "failed";
export type PluginGovernanceStorageState =
    | "uninitialized"
    | "bootstrapping"
    | "governed"
    | "legacy_rolled_back"
    | "failed"
    | "disposed";

export type MemoryGovernanceBootstrapErrorCode =
    | "legacy_payload_missing"
    | "legacy_save_collision"
    | "migration_failed"
    | "profile_read_failed"
    | "profile_readback_mismatch"
    | "memory_mutation_blocked"
    | "policy_state_invalid"
    | "vault_identity_unavailable";

export class MemoryGovernanceBootstrapError extends Error {
    constructor(readonly code: MemoryGovernanceBootstrapErrorCode) {
        super(`Memory governance bootstrap failed: ${code}`);
        this.name = "MemoryGovernanceBootstrapError";
    }
}

export type MemoryGovernanceSmokeCapability = {
    schemaVersion: 1;
    mode: "blocked";
    reason: "durable_governance" | "bootstrap_unknown" | "bootstrap_failed" | "unavailable";
};

export interface GovernanceStoragePreparedHandle {
    readonly generation: number;
    readonly repository: MemoryGovernanceRepository;
    readonly opaqueVaultKey: string;
    readonly expectedSourceHash: string;
    readonly existingState: DeviceMemoryGovernanceStateV1;
    readonly payload: LegacyMemoryPayload;
}

export interface PublishGovernedRuntimeInput {
    state: DeviceMemoryGovernanceStateV1;
    sourceHash: string;
    recordRepository: DeviceMemoryGovernanceRecordRepository | null;
    reviewQueueRepository: MemoryReviewQueueRepository;
}

interface PluginGovernanceStorageOptions {
    getSettings: () => PluginManagerSettings;
    getVault: () => {
        configDir?: string;
        getName?: () => string;
        adapter?: unknown;
    };
    getPluginId: () => string;
    isUnloading: () => boolean;
    createRepository?: () => MemoryGovernanceRepository;
    persistSettingsSlice: <T>(
        read: () => T,
        write: (value: T) => void,
        next: T,
        requireCommit?: boolean,
    ) => Promise<void>;
    scheduleGarbageCollection: () => void;
    cancelGarbageCollection: () => void;
    log: (message: string, detail?: unknown) => void;
}

export function createMemoryGovernanceOpaqueVaultKey(
    statisticsVaultId: string,
    deviceVaultScope: string,
): string {
    const normalizedDeviceScope = deviceVaultScope.trim();
    if (!normalizedDeviceScope) throw new Error("A device-local vault scope is required.");
    const source = [statisticsVaultId.trim() || "default-vault", normalizedDeviceScope].join("\n");
    const digest = ["0", "1", "2", "3"]
        .map((lane) => stableHash(`${MEMORY_GOVERNANCE_OPAQUE_KEY_VERSION}:${lane}:${source}`))
        .join("");
    return `vault-${digest}`;
}

export function getMemoryGovernanceVaultDeviceScope(vault: {
    adapter?: unknown;
}): string | null {
    let localPath = "";
    const adapter = vault.adapter as {
        getBasePath?: () => string;
        getFullPath?: (path: string) => string;
    } | undefined;
    try {
        if (typeof adapter?.getBasePath === "function") localPath = adapter.getBasePath();
        else if (typeof adapter?.getFullPath === "function") localPath = adapter.getFullPath("");
    } catch {
        // A guessed name/config-dir identity could collide after a vault copy.
    }
    return localPath.trim() || null;
}

export class PluginGovernanceStorage {
    private runtimeState: PluginGovernanceStorageState = "uninitialized";
    private bootstrapErrorCode: string | null = null;
    private legacyBarrier: LegacyMemoryCompatibilityBarrier | null = null;
    private legacyPayload: LegacyMemoryPayload | null = null;
    private repository: MemoryGovernanceRepository | null = null;
    private currentState: DeviceMemoryGovernanceStateV1 | null = null;
    private opaqueVaultKey: string | null = null;
    private sourceHash: string | null = null;
    private recordRepository: DeviceMemoryGovernanceRecordRepository | null = null;
    private deviceReviewQueueRepository: MemoryReviewQueueRepository | null = null;
    private recordViewRepository: MemoryGovernanceRecordRepository | null = null;
    private reviewQueueRepository: ReviewQueueRepository | null = null;
    private settingsReviewQueueRepository: ReviewQueueRepository | null = null;
    private memoryGovernanceStore: MemoryGovernanceStore | null = null;
    private reviewQueueStore: ReviewQueueStore | null = null;
    private unsubscribe: (() => void) | null = null;
    private refreshPromise: Promise<void> | null = null;
    private refreshTargetSequence = 0;
    private localConfirmedMemoryCount: number | null = null;
    private localMemoryAutoAcceptPaused: boolean | null = null;
    private generation = 0;
    private preparedHandle: GovernanceStoragePreparedHandle | null = null;

    constructor(private readonly options: PluginGovernanceStorageOptions) {}

    initializeLegacyCompatibility(raw: unknown): void {
        this.legacyBarrier = new LegacyMemoryCompatibilityBarrier(raw);
        this.legacyPayload = this.legacyBarrier.snapshot();
    }

    getLegacyBarrier(): LegacyMemoryCompatibilityBarrier | null {
        return this.legacyBarrier;
    }

    setLegacyBarrierForCompatibility(value: LegacyMemoryCompatibilityBarrier | null): void {
        this.legacyBarrier = value;
    }

    getLegacyPayload(): LegacyMemoryPayload | null {
        return this.legacyPayload ? cloneSerializable(this.legacyPayload) : null;
    }

    setLegacyPayload(value: LegacyMemoryPayload | null): void {
        this.legacyPayload = value ? cloneSerializable(value) : null;
    }

    async prepareBootstrap(): Promise<GovernanceStoragePreparedHandle> {
        if (this.runtimeState === "disposed") {
            throw new MemoryGovernanceBootstrapError("memory_mutation_blocked");
        }
        const payload = this.legacyPayload;
        if (!payload) throw new MemoryGovernanceBootstrapError("legacy_payload_missing");
        const compatibilityCheck = this.legacyBarrier?.composeForSave(this.options.getSettings());
        if (compatibilityCheck && !compatibilityCheck.ok) {
            throw new MemoryGovernanceBootstrapError("legacy_save_collision");
        }
        const deviceVaultScope = getMemoryGovernanceVaultDeviceScope(this.options.getVault());
        if (!deviceVaultScope) throw new MemoryGovernanceBootstrapError("vault_identity_unavailable");
        const settings = this.options.getSettings();
        const opaqueVaultKey = createMemoryGovernanceOpaqueVaultKey(
            settings.statisticsVaultId || "default-vault",
            deviceVaultScope,
        );
        const repository = this.options.createRepository?.()
            ?? createDeviceMemoryGovernanceRepository(this.options.getPluginId());
        const generation = this.invalidateRuntime("bootstrapping");
        try {
            const existingState = await repository.initialize();
            const handle: GovernanceStoragePreparedHandle = {
                generation,
                repository,
                opaqueVaultKey,
                expectedSourceHash: hashLegacyMemoryPayload(payload),
                existingState: cloneSerializable(existingState),
                payload: cloneSerializable(payload),
            };
            if (this.generation !== generation || this.runtimeState !== "bootstrapping") {
                throw new MemoryGovernanceBootstrapError("memory_mutation_blocked");
            }
            this.preparedHandle = handle;
            return handle;
        } catch (error) {
            await repository.dispose().catch(() => undefined);
            if (this.generation === generation && this.runtimeState === "bootstrapping") {
                this.preparedHandle = null;
            }
            throw error;
        }
    }

    isPreparedHandleCurrent(handle: GovernanceStoragePreparedHandle): boolean {
        return this.runtimeState !== "disposed"
            && this.generation === handle.generation
            && this.preparedHandle === handle;
    }

    getCurrentHandle(): GovernanceStoragePreparedHandle | null {
        return this.preparedHandle;
    }

    publishGovernedRuntime(
        handle: GovernanceStoragePreparedHandle,
        input: PublishGovernedRuntimeInput,
    ): void {
        this.assertPreparedHandleCurrent(handle);
        if (this.runtimeState !== "bootstrapping") {
            throw new MemoryGovernanceBootstrapError("memory_mutation_blocked");
        }
        const localPolicy = readCurrentLocalMemoryPolicy(
            input.state,
            handle.opaqueVaultKey,
            input.sourceHash,
        );
        this.disposePublishedAdapters();
        this.repository = handle.repository;
        this.opaqueVaultKey = handle.opaqueVaultKey;
        this.sourceHash = input.sourceHash;
        this.currentState = cloneSerializable(input.state);
        this.recordRepository = input.recordRepository;
        this.deviceReviewQueueRepository = input.reviewQueueRepository;
        this.recordViewRepository = input.recordRepository
            ?? createFailClosedMemoryRecordRepository(
                buildGovernedMemoryViewSnapshot(input.state, handle.opaqueVaultKey).records
                    .map((entry) => entry.record),
            );
        this.reviewQueueRepository = input.reviewQueueRepository;
        this.localConfirmedMemoryCount = localPolicy.confirmedMemoryCount;
        this.localMemoryAutoAcceptPaused = localPolicy.memoryAutoAcceptPaused;
        if (input.state.migrationStates[handle.opaqueVaultKey]?.phase === "compatibility") {
            const settings = this.options.getSettings();
            settings.confirmedMemoryCount = localPolicy.confirmedMemoryCount;
            settings.memoryAutoAcceptPaused = localPolicy.memoryAutoAcceptPaused;
        }
        this.runtimeState = "governed";
        this.bootstrapErrorCode = null;
        this.memoryGovernanceStore = null;
        this.reviewQueueStore = null;
        this.refreshTargetSequence = input.state.commitSequence;
        this.unsubscribe = handle.repository.subscribe((commitSequence) => {
            this.scheduleRefresh(commitSequence);
        });
    }

    installLegacyRuntime(
        handle: GovernanceStoragePreparedHandle,
        state: DeviceMemoryGovernanceStateV1,
        sourceHash: string,
    ): void {
        this.assertPreparedHandleCurrent(handle);
        this.invalidateRuntime("legacy_rolled_back", false);
        this.options.cancelGarbageCollection();
        this.disposePublishedAdapters();
        this.repository = handle.repository;
        this.opaqueVaultKey = handle.opaqueVaultKey;
        this.sourceHash = sourceHash;
        this.currentState = cloneSerializable(state);
        this.recordRepository = null;
        this.deviceReviewQueueRepository = null;
        const settings = this.options.getSettings();
        this.recordViewRepository = new CallbackMemoryGovernanceRecordRepository(
            settings.memoryGovernance.records,
            (next) => this.options.persistSettingsSlice(
                () => this.options.getSettings().memoryGovernance.records,
                (records) => { this.options.getSettings().memoryGovernance.records = records; },
                next.records,
            ),
        );
        this.settingsReviewQueueRepository = null;
        this.reviewQueueRepository = this.getOrCreateSettingsReviewQueueRepository();
        this.localConfirmedMemoryCount = normalizeConfirmedMemoryCount(settings.confirmedMemoryCount);
        this.localMemoryAutoAcceptPaused = settings.memoryAutoAcceptPaused === true;
        this.runtimeState = "legacy_rolled_back";
        this.bootstrapErrorCode = null;
        this.memoryGovernanceStore = null;
        this.reviewQueueStore = null;
        this.preparedHandle = {
            ...handle,
            generation: this.generation,
            existingState: cloneSerializable(state),
        };
    }

    async failBootstrap(
        handle: GovernanceStoragePreparedHandle | null,
        errorCode: string,
    ): Promise<void> {
        const repository = handle?.repository ?? this.repository;
        if (handle && !this.isPreparedHandleCurrent(handle)) return;
        this.invalidateRuntime("failed");
        this.options.cancelGarbageCollection();
        this.disposePublishedAdapters();
        const repositoryDisposal = repository?.dispose().catch(() => undefined);
        this.repository = null;
        this.opaqueVaultKey = null;
        this.sourceHash = null;
        this.currentState = null;
        this.localConfirmedMemoryCount = null;
        this.localMemoryAutoAcceptPaused = null;
        this.refreshTargetSequence = 0;
        const settings = this.options.getSettings();
        this.recordViewRepository = createFailClosedMemoryRecordRepository(
            settings.memoryGovernance?.records ?? [],
        );
        this.reviewQueueRepository = createFailClosedReviewQueueRepository(
            settings.reviewQueue?.items ?? [],
            (state) => this.options.persistSettingsSlice(
                () => this.options.getSettings().reviewQueue.items,
                (items) => { this.options.getSettings().reviewQueue.items = items; },
                state.items,
                true,
            ),
        );
        this.bootstrapErrorCode = errorCode;
        this.memoryGovernanceStore = null;
        this.reviewQueueStore = null;
        try {
            this.options.log("Memory governance bootstrap unavailable", { code: errorCode });
        } catch {
            // Logging cannot make the fail-closed transition fail.
        }
        await repositoryDisposal;
    }

    scheduleRefresh(commitSequence: number): void {
        this.refreshTargetSequence = Math.max(this.refreshTargetSequence, commitSequence);
        if (this.options.isUnloading()
            || this.runtimeState !== "governed"
            || this.refreshPromise) return;
        const refresh = Promise.resolve().then(async () => {
            while (!this.options.isUnloading() && this.runtimeState === "governed") {
                await this.refreshCaches();
                const observed = this.currentState?.commitSequence ?? 0;
                if (observed >= this.refreshTargetSequence) return;
            }
        });
        this.refreshPromise = refresh;
        void refresh.then(
            () => { if (this.refreshPromise === refresh) this.refreshPromise = null; },
            (error) => {
                if (this.refreshPromise === refresh) this.refreshPromise = null;
                try {
                    this.options.log("Memory governance cache refresh failed", error);
                } catch {
                    // Repository notifications must never block callers.
                }
            },
        );
    }

    async refreshCaches(): Promise<void> {
        const repository = this.repository;
        const recordRepository = this.recordRepository;
        const opaqueVaultKey = this.opaqueVaultKey;
        const sourceHash = this.sourceHash;
        const generation = this.generation;
        if (!repository || !opaqueVaultKey || !sourceHash || this.options.isUnloading()) return;
        const isCurrent = () => !this.options.isUnloading()
            && this.runtimeState === "governed"
            && this.generation === generation
            && this.repository === repository
            && this.opaqueVaultKey === opaqueVaultKey
            && this.sourceHash === sourceHash;
        const state = await repository.initialize();
        if (!isCurrent()) return;
        const localPolicy = readCurrentLocalMemoryPolicy(state, opaqueVaultKey, sourceHash);
        if (recordRepository && state.migrationStates[opaqueVaultKey]?.phase === "governed_preserving_legacy") {
            if (this.recordRepository !== recordRepository) return;
            recordRepository.dispose();
            this.recordRepository = null;
            this.recordViewRepository = createFailClosedMemoryRecordRepository(
                buildGovernedMemoryViewSnapshot(state, opaqueVaultKey).records.map((entry) => entry.record),
            );
        }
        if (recordRepository
            && state.migrationStates[opaqueVaultKey]?.phase === "compatibility"
            && buildLegacyMemoryRollbackProjection(state, opaqueVaultKey).ok) {
            if (this.recordRepository !== recordRepository) return;
            await recordRepository.refresh();
            if (!isCurrent()) return;
        }
        const queueRepository = await createMemoryReviewQueueRepository({
            repository,
            settingsRepository: this.getOrCreateSettingsReviewQueueRepository(),
            opaqueVaultKey,
        });
        if (!isCurrent()) return;
        this.currentState = cloneSerializable(state);
        this.localConfirmedMemoryCount = localPolicy.confirmedMemoryCount;
        this.localMemoryAutoAcceptPaused = localPolicy.memoryAutoAcceptPaused;
        if (state.migrationStates[opaqueVaultKey]?.phase === "compatibility") {
            const settings = this.options.getSettings();
            settings.confirmedMemoryCount = localPolicy.confirmedMemoryCount;
            settings.memoryAutoAcceptPaused = localPolicy.memoryAutoAcceptPaused;
        }
        this.deviceReviewQueueRepository = queueRepository;
        this.reviewQueueRepository = queueRepository;
        this.memoryGovernanceStore = null;
        this.reviewQueueStore = null;
        this.options.scheduleGarbageCollection();
    }

    async updateCurrentLocalPolicy(
        next: Partial<{ confirmedMemoryCount: number; memoryAutoAcceptPaused: boolean }>,
    ): Promise<void> {
        const repository = this.repository;
        const opaqueVaultKey = this.opaqueVaultKey;
        const sourceHash = this.sourceHash;
        const generation = this.generation;
        if (this.runtimeState !== "governed" || !repository || !opaqueVaultKey || !sourceHash) {
            throw new MemoryGovernanceBootstrapError("memory_mutation_blocked");
        }
        const updated = await repository.transact((draft) => writeCurrentLocalMemoryPolicy(
            draft, opaqueVaultKey, sourceHash, next, new Date(),
        ));
        if (this.runtimeState !== "governed"
            || this.generation !== generation
            || this.repository !== repository
            || this.opaqueVaultKey !== opaqueVaultKey
            || this.sourceHash !== sourceHash) {
            throw new MemoryGovernanceBootstrapError("memory_mutation_blocked");
        }
        this.localConfirmedMemoryCount = updated.confirmedMemoryCount;
        this.localMemoryAutoAcceptPaused = updated.memoryAutoAcceptPaused;
        const settings = this.options.getSettings();
        settings.confirmedMemoryCount = updated.confirmedMemoryCount;
        settings.memoryAutoAcceptPaused = updated.memoryAutoAcceptPaused;
    }

    async synchronizeNonMemoryQueue(raw: unknown): Promise<void> {
        const payload = captureLegacyMemoryPayload(raw);
        const items = buildLegacyReviewQueuePassthrough(payload.reviewQueue)
            .liveNonMemoryItems.map(cloneSerializable);
        const settings = this.options.getSettings();
        settings.reviewQueue.items = items;
        if (!this.settingsReviewQueueRepository && !this.repository) return;
        this.settingsReviewQueueRepository = this.createSettingsReviewQueueRepository(items);
        if (this.repository && this.opaqueVaultKey && this.runtimeState === "governed") {
            const generation = this.generation;
            const combined = await createMemoryReviewQueueRepository({
                repository: this.repository,
                settingsRepository: this.settingsReviewQueueRepository,
                opaqueVaultKey: this.opaqueVaultKey,
            });
            if (generation !== this.generation || this.runtimeState !== "governed") return;
            this.deviceReviewQueueRepository = combined;
            this.reviewQueueRepository = combined;
        } else {
            this.reviewQueueRepository = this.settingsReviewQueueRepository;
        }
        this.reviewQueueStore = null;
    }

    getSmokeCapability(): MemoryGovernanceSmokeCapability {
        if (this.runtimeState === "governed" || this.runtimeState === "legacy_rolled_back") {
            return { schemaVersion: 1, mode: "blocked", reason: "durable_governance" };
        }
        if (this.runtimeState === "failed") {
            return { schemaVersion: 1, mode: "blocked", reason: "bootstrap_failed" };
        }
        if (this.runtimeState === "uninitialized" || this.runtimeState === "bootstrapping") {
            return { schemaVersion: 1, mode: "blocked", reason: "bootstrap_unknown" };
        }
        return { schemaVersion: 1, mode: "blocked", reason: "unavailable" };
    }

    async dispose(): Promise<void> {
        if (this.runtimeState === "disposed") return;
        this.invalidateRuntime("disposed");
        this.options.cancelGarbageCollection();
        this.disposePublishedAdapters();
        const repository = this.repository;
        this.repository = null;
        this.currentState = null;
        this.opaqueVaultKey = null;
        this.sourceHash = null;
        this.deviceReviewQueueRepository = null;
        this.recordViewRepository = null;
        this.reviewQueueRepository = null;
        this.settingsReviewQueueRepository = null;
        this.memoryGovernanceStore = null;
        this.reviewQueueStore = null;
        this.refreshPromise = null;
        this.refreshTargetSequence = 0;
        this.localConfirmedMemoryCount = null;
        this.localMemoryAutoAcceptPaused = null;
        if (repository) await repository.dispose().catch((error) => {
            this.options.log("Failed to dispose Memory governance repository", error);
        });
    }

    get bootstrapState(): MemoryGovernanceBootstrapState {
        if (this.runtimeState === "failed") return "failed";
        if (this.runtimeState === "governed" || this.runtimeState === "legacy_rolled_back") return "ready";
        return "not_started";
    }

    set bootstrapState(value: MemoryGovernanceBootstrapState) {
        if (value === "ready") this.runtimeState = "governed";
        else if (value === "failed") this.runtimeState = "failed";
        else this.runtimeState = "uninitialized";
    }

    get bootstrapError(): string | null { return this.bootstrapErrorCode; }
    set bootstrapError(value: string | null) { this.bootstrapErrorCode = value; }
    get vaultKey(): string | null { return this.opaqueVaultKey; }
    set vaultKey(value: string | null) { this.opaqueVaultKey = value; }
    get currentSourceHash(): string | null { return this.sourceHash; }
    set currentSourceHash(value: string | null) { this.sourceHash = value; }
    get deviceRepository(): MemoryGovernanceRepository | null { return this.repository; }
    set deviceRepository(value: MemoryGovernanceRepository | null) {
        this.repository = value;
        if (value && this.preparedHandle) {
            this.preparedHandle = { ...this.preparedHandle, repository: value };
        }
    }
    get stateSnapshot(): DeviceMemoryGovernanceStateV1 | null { return this.currentState; }
    set stateSnapshot(value: DeviceMemoryGovernanceStateV1 | null) { this.currentState = value; }
    get deviceRecordRepository(): DeviceMemoryGovernanceRecordRepository | null { return this.recordRepository; }
    set deviceRecordRepository(value: DeviceMemoryGovernanceRecordRepository | null) { this.recordRepository = value; }
    get deviceQueueRepository(): MemoryReviewQueueRepository | null { return this.deviceReviewQueueRepository; }
    set deviceQueueRepository(value: MemoryReviewQueueRepository | null) { this.deviceReviewQueueRepository = value; }
    get recordRepositoryView(): MemoryGovernanceRecordRepository | null { return this.recordViewRepository; }
    set recordRepositoryView(value: MemoryGovernanceRecordRepository | null) { this.recordViewRepository = value; }
    get queueRepositoryView(): ReviewQueueRepository | null { return this.reviewQueueRepository; }
    set queueRepositoryView(value: ReviewQueueRepository | null) { this.reviewQueueRepository = value; }
    get settingsQueueRepository(): ReviewQueueRepository | null { return this.settingsReviewQueueRepository; }
    set settingsQueueRepository(value: ReviewQueueRepository | null) { this.settingsReviewQueueRepository = value; }
    get repositoryUnsubscribe(): (() => void) | null { return this.unsubscribe; }
    set repositoryUnsubscribe(value: (() => void) | null) { this.unsubscribe = value; }
    get cacheRefreshPromise(): Promise<void> | null { return this.refreshPromise; }
    set cacheRefreshPromise(value: Promise<void> | null) { this.refreshPromise = value; }
    get cacheRefreshTargetSequence(): number { return this.refreshTargetSequence; }
    set cacheRefreshTargetSequence(value: number) { this.refreshTargetSequence = value; }
    get confirmedMemoryCount(): number | null { return this.localConfirmedMemoryCount; }
    set confirmedMemoryCount(value: number | null) { this.localConfirmedMemoryCount = value; }
    get autoAcceptPaused(): boolean | null { return this.localMemoryAutoAcceptPaused; }
    set autoAcceptPaused(value: boolean | null) { this.localMemoryAutoAcceptPaused = value; }
    get runtimeGeneration(): number { return this.generation; }
    set runtimeGeneration(value: number) { this.generation = value; }
    get governanceStore(): MemoryGovernanceStore | null { return this.memoryGovernanceStore; }
    set governanceStore(value: MemoryGovernanceStore | null) { this.memoryGovernanceStore = value; }
    get queueStore(): ReviewQueueStore | null { return this.reviewQueueStore; }
    set queueStore(value: ReviewQueueStore | null) { this.reviewQueueStore = value; }

    getOrCreateSettingsReviewQueueRepository(): ReviewQueueRepository {
        if (!this.settingsReviewQueueRepository) {
            this.settingsReviewQueueRepository = this.createSettingsReviewQueueRepository(
                this.options.getSettings().reviewQueue.items,
            );
        }
        return this.settingsReviewQueueRepository;
    }

    private createSettingsReviewQueueRepository(items: readonly ReviewQueueItem[]): ReviewQueueRepository {
        return new CallbackReviewQueueRepository(
            items,
            (state) => this.options.persistSettingsSlice(
                () => this.options.getSettings().reviewQueue.items,
                (next) => { this.options.getSettings().reviewQueue.items = next; },
                state.items,
                true,
            ),
        );
    }

    private assertPreparedHandleCurrent(handle: GovernanceStoragePreparedHandle): void {
        if (!this.isPreparedHandleCurrent(handle)) {
            throw new MemoryGovernanceBootstrapError("memory_mutation_blocked");
        }
    }

    private invalidateRuntime(
        nextState: PluginGovernanceStorageState,
        clearPrepared = true,
    ): number {
        this.generation += 1;
        this.runtimeState = nextState;
        if (clearPrepared) this.preparedHandle = null;
        return this.generation;
    }

    private disposePublishedAdapters(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.recordRepository?.dispose();
        this.recordRepository = null;
        this.deviceReviewQueueRepository = null;
    }
}

function readCurrentLocalMemoryPolicy(
    state: DeviceMemoryGovernanceStateV1,
    opaqueVaultKey: string,
    expectedSourceHash: string,
): { confirmedMemoryCount: number; memoryAutoAcceptPaused: boolean } {
    const migration = state.migrationStates[opaqueVaultKey];
    const policy = state.policyStates[opaqueVaultKey];
    const baseline = policy?.legacyBaseline;
    if (!migration
        || (migration.phase !== "compatibility" && migration.phase !== "finalizing"
            && migration.phase !== "governed_preserving_legacy" && migration.phase !== "finalized")
        || migration.sourceHash !== expectedSourceHash
        || (migration.phase !== "finalizing" && migration.lastErrorCode)
        || (policy?.mode !== "legacy_threshold" && policy?.mode !== "effect_based")
        || !baseline || baseline.importedFromSourceHash !== expectedSourceHash
        || !Number.isSafeInteger(baseline.confirmedCount) || baseline.confirmedCount < 0
        || typeof baseline.autoAcceptPaused !== "boolean") {
        throw new MemoryGovernanceBootstrapError("policy_state_invalid");
    }
    return {
        confirmedMemoryCount: baseline.confirmedCount,
        memoryAutoAcceptPaused: baseline.autoAcceptPaused,
    };
}

function writeCurrentLocalMemoryPolicy(
    state: DeviceMemoryGovernanceStateV1,
    opaqueVaultKey: string,
    expectedSourceHash: string,
    next: Partial<{ confirmedMemoryCount: number; memoryAutoAcceptPaused: boolean }>,
    now: Date,
): { confirmedMemoryCount: number; memoryAutoAcceptPaused: boolean } {
    const current = readCurrentLocalMemoryPolicy(state, opaqueVaultKey, expectedSourceHash);
    const migration = state.migrationStates[opaqueVaultKey];
    const policy = state.policyStates[opaqueVaultKey];
    const baseline = policy.legacyBaseline!;
    const confirmedMemoryCount = next.confirmedMemoryCount ?? current.confirmedMemoryCount;
    const memoryAutoAcceptPaused = next.memoryAutoAcceptPaused ?? current.memoryAutoAcceptPaused;
    if (!Number.isSafeInteger(confirmedMemoryCount) || confirmedMemoryCount < 0) {
        throw new MemoryGovernanceBootstrapError("policy_state_invalid");
    }
    const rollbackExpiresAt = Date.parse(migration.rollbackExpiresAt ?? "");
    const rollbackJournalActive = migration.phase === "compatibility"
        && Number.isFinite(rollbackExpiresAt) && rollbackExpiresAt >= now.getTime();
    if (!rollbackJournalActive) {
        if (policy.contextProjectionMode !== "governed"
            || (migration.phase !== "compatibility" && migration.phase !== "finalized"
                && migration.phase !== "governed_preserving_legacy")) {
            throw new MemoryGovernanceBootstrapError("policy_state_invalid");
        }
        baseline.confirmedCount = confirmedMemoryCount;
        baseline.autoAcceptPaused = memoryAutoAcceptPaused;
        return { confirmedMemoryCount, memoryAutoAcceptPaused };
    }
    if (!buildLegacyMemoryRollbackProjection(state, opaqueVaultKey, now).ok) {
        throw new MemoryGovernanceBootstrapError("policy_state_invalid");
    }
    const partition: MemoryPartitionKey = { kind: "vault", key: opaqueVaultKey };
    const policyEntityIds = new Set(state.rollbackPayloadEntries
        .filter((entry) => entry.migrationRunId === migration.migrationRunId
            && entry.partition.kind === "vault" && entry.partition.key === opaqueVaultKey
            && entry.value.kind === "policy")
        .map((entry) => entry.entityId));
    if (policyEntityIds.size !== 1 || !migration.rollbackExpiresAt) {
        throw new MemoryGovernanceBootstrapError("policy_state_invalid");
    }
    const deltas = state.migrationDeltas
        .filter((delta) => delta.migrationRunId === migration.migrationRunId)
        .sort((left, right) => left.sequence - right.sequence);
    deltas.forEach((delta, index) => {
        if (delta.sequence !== index + 1 || delta.partition.kind !== "vault"
            || delta.partition.key !== opaqueVaultKey) {
            throw new MemoryGovernanceBootstrapError("policy_state_invalid");
        }
    });
    const sequence = deltas.length + 1;
    const value: LegacyRollbackValue = {
        kind: "policy", confirmedMemoryCount, memoryAutoAcceptPaused,
    };
    const checksum = checksumLegacyRollbackValue(value);
    const entityId = [...policyEntityIds][0];
    const payloadId = ["memory-policy-rollback", stableHash(migration.migrationRunId), sequence,
        stableHash(`${entityId}:${checksum}`)].join("-");
    if (state.rollbackPayloadEntries.some((entry) => entry.id === payloadId)) {
        throw new MemoryGovernanceBootstrapError("policy_state_invalid");
    }
    baseline.confirmedCount = confirmedMemoryCount;
    baseline.autoAcceptPaused = memoryAutoAcceptPaused;
    state.rollbackPayloadEntries.push({
        id: payloadId, migrationRunId: migration.migrationRunId, partition, entityId,
        value, checksum, expiresAt: migration.rollbackExpiresAt,
    });
    state.migrationDeltas.push({
        sequence, migrationRunId: migration.migrationRunId, partition,
        committedAt: now.toISOString(), kind: "policy_changed", entityId,
        payloadEntryId: payloadId, payloadChecksum: checksum,
    });
    if (!buildLegacyMemoryRollbackProjection(state, opaqueVaultKey, now).ok) {
        throw new MemoryGovernanceBootstrapError("policy_state_invalid");
    }
    return { confirmedMemoryCount, memoryAutoAcceptPaused };
}

function createFailClosedMemoryRecordRepository(
    records: readonly ConfirmedMemoryRecord[],
): MemoryGovernanceRecordRepository {
    const snapshot = cloneSerializable({ records: [...records] } satisfies MemoryGovernanceState);
    return {
        read: () => cloneSerializable(snapshot),
        write: async () => { throw new MemoryGovernanceBootstrapError("memory_mutation_blocked"); },
    };
}

function createFailClosedReviewQueueRepository(
    items: readonly ReviewQueueItem[],
    persist: (state: ReviewQueueState) => Promise<void>,
): ReviewQueueRepository {
    let snapshot: ReviewQueueState = cloneSerializable({ items: [...items] });
    return {
        read: () => cloneSerializable(snapshot),
        write: async (next) => {
            const nextState = cloneSerializable(next);
            if (memoryQueueFingerprint(snapshot.items) !== memoryQueueFingerprint(nextState.items)) {
                throw new MemoryGovernanceBootstrapError("memory_mutation_blocked");
            }
            await persist(nextState);
            snapshot = nextState;
        },
    };
}

function memoryQueueFingerprint(items: readonly ReviewQueueItem[]): string {
    return JSON.stringify(items
        .filter((item) => item.type === "memory_candidate" || item.type === "memory_conflict")
        .map((item) => cloneSerializable(item))
        .sort((left, right) => left.id.localeCompare(right.id)));
}

function cloneSerializable<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}
