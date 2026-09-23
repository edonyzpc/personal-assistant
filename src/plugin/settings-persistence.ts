import { normalizePath } from "obsidian";

import { stableStringify } from "../ai-services/agent-utils";
import type { FeaturedImageDefaults } from "../ai-services/featured-image-options";
import { withMemoryExternalOperationTimeout } from "../pa/memory-external-operation-timeout";
import {
    DEFAULT_SETTINGS,
    hasDeprecatedSimpleSettingsFields,
    isFreshInstall,
    isLegacyV1Install,
    mergeLearningPreferences,
    mergeLoadedSettings,
    normalizeFeaturedImageCount,
    normalizeFeaturedImageModel,
    omitDeprecatedSimpleSettingsFields,
    type PluginManagerSettings,
} from "../settings";
import type { GraphOptions } from "../settings/graph-options-modal";
import { normalizeReviewsFolder, type PageletReviewsFolderError } from "../settings/pagelet";
import { normalizeStatisticsView } from "../stats/stats-store";
import {
    getVaultConfigDir,
    joinVaultConfigPath,
    LEGACY_CONFIG_DIR,
    uniqueNormalizedPaths,
} from "../obsidian-paths";
import { getPlatformLocalStorage } from "../platform-dom";
import { pageletT } from "../locales/pagelet";

export type SettingsPermissionPatch = Partial<Pick<PluginManagerSettings,
    | "memoryEnabled" | "memoryExtractionEnabled" | "memoryExtractionConsent"
    | "memoryExtractionIncludeVaultInsights" | "memoryApprovalPolicy"
    | "operationsAgentEnabled" | "operationsAuditIncludeContent"
    | "webSearchEnabled" | "shareAnonymousCapabilityUsage" | "enableMetadataUpdating"
    | "vssCacheExcludePath" | "metadataExcludePath" | "operationsAuditRetentionDays"
>> & {
    retrievalHabitProfile?: Partial<Pick<PluginManagerSettings["retrievalHabitProfile"], "enabled" | "state">>;
    quickCapture?: Partial<Pick<PluginManagerSettings["quickCapture"], "postProcessingEnabled">>;
    dataBoundary?: Partial<Pick<PluginManagerSettings["dataBoundary"], "generatedNotePolicy" | "excludedFolders" | "excludedTags">>;
    pagelet?: Partial<Pick<PluginManagerSettings["pagelet"], "excludedFolders" | "excludedTags" | "excludedPatterns">>;
};

interface SettingsDataAdapter {
    write(path: string, data: string): Promise<void>;
    copy(sourcePath: string, destinationPath: string): Promise<void>;
    remove(path: string): Promise<void>;
    process?(path: string, mutate: (data: string) => string): Promise<string>;
    read?(path: string): Promise<string>;
}

interface LegacyMemoryCompatibilityBarrierPort {
    isActive(): boolean;
    isFinalizing(): boolean;
    composeForSave(
        canonical: unknown,
        persisted: unknown,
    ): { ok: true; payload: Record<string, unknown> } | { ok: false; errorCode: string };
    refreshFromPersisted(raw: unknown): boolean;
    snapshot(): unknown;
}

export interface SettingsPersistenceDependencies {
    /** Synchronous invalidation only; observer failures must not block permission changes. */
    onSourcePermissionRevoking?(): void;
    onSourcePermissionCommitted?(): void;
    onSourcePermissionFailed?(): void;
    loadData(): Promise<unknown>;
    saveData(data: unknown): Promise<void>;
    getAdapter(): SettingsDataAdapter;
    getManifest(): { id?: string; dir?: string } | undefined;
    getVault(): Parameters<typeof getVaultConfigDir>[0];
    isUnloading(): boolean;
    clearTokenCache(): void;
    initializeLegacyMemoryCompatibility(loaded: unknown): void;
    getLegacyMemoryCompatibilityBarrier(): LegacyMemoryCompatibilityBarrierPort | null;
    updateLegacyMemoryPayload(payload: unknown): void;
    markMemoryGovernanceBootstrapError(errorCode: string): void;
    createLegacySaveCollisionError(): Error;
    synchronizeNonMemoryQueueFromPersisted(raw: unknown): Promise<void>;
    syncMemoryExtractionRuntime(): void;
    setStatisticsRuntimeEnabled(enabled: boolean): Promise<void> | undefined;
    setBackgroundDiscoveryRuntimeEnabled(enabled: boolean): void;
    shouldDeferSettingsNotification(): boolean;
    deferSettingsNotification(): void;
    refreshRetrievalEpoch(): void;
    showNotice(message: string, duration: number): void;
    translateQwenMemoryModelRecommended(): string;
    getPageletLocale(): "zh" | "en";
    createStatisticsVaultId(): string;
    log(message: string, detail?: unknown): void;
}

type LegacyAiProviderMigration = "confirmed-qwen" | "provider-selection-required";

const LEGACY_QWEN_MODEL_NAMES = new Set(["qwen-max", "qwen-turbo", "qwen-plus"]);
const PAGELET_MIGRATION_NOTICE_KEY = "pa-pagelet-reviews-folder-migration";

class PluginDataJsonMigrationConflictError extends Error {
    constructor() {
        super("Plugin settings changed while startup migration was running.");
        this.name = "PluginDataJsonMigrationConflictError";
    }
}

function fingerprintPluginData(value: unknown): string {
    return value === undefined ? "undefined" : stableStringify(value);
}

function classifyLegacyAiProviderMigration(loaded: unknown): LegacyAiProviderMigration | null {
    if (isFreshInstall(loaded)) return null;
    if (!isLegacyV1Install(loaded)) {
        const hasExplicitProvider = typeof loaded === "object"
            && loaded !== null
            && !Array.isArray(loaded)
            && (loaded as Record<string, unknown>).aiProvider !== undefined;
        return hasExplicitProvider ? null : "provider-selection-required";
    }
    const legacyModelName = (loaded as Record<string, unknown>).modelName;
    return typeof legacyModelName === "string" && LEGACY_QWEN_MODEL_NAMES.has(legacyModelName)
        ? "confirmed-qwen"
        : "provider-selection-required";
}

function arraysEqual(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

interface SourcePermissionSnapshot {
    excluded: string[];
    generated: PluginManagerSettings["dataBoundary"]["generatedNotePolicy"];
}

function sourcePermissionSnapshot(settings: PluginManagerSettings): SourcePermissionSnapshot {
    const boundary = settings.dataBoundary;
    return {
        excluded: [
            ...(boundary?.excludedFolders ?? []).map((value) => `folder:${value}`),
            ...(boundary?.excludedTags ?? []).map((value) => `tag:${value}`),
            ...(settings.vssCacheExcludePath ?? []).map((value) => `memory:${value}`),
        ],
        generated: boundary?.generatedNotePolicy ?? "ask",
    };
}

function sourcePermissionNarrowed(previous: SourcePermissionSnapshot, next: SourcePermissionSnapshot): boolean {
    const rank = { "include-generated": 0, ask: 1, "exclude-generated": 2 };
    return next.excluded.some((value) => !previous.excluded.includes(value))
        || rank[next.generated] > rank[previous.generated];
}

function newSourceRevocationEpoch(): string {
    return `source:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function readPageletMigrationFlag(): boolean {
    try {
        return getPlatformLocalStorage()?.getItem(PAGELET_MIGRATION_NOTICE_KEY) === "1";
    } catch {
        return false;
    }
}

function writePageletMigrationFlag(): void {
    try {
        getPlatformLocalStorage()?.setItem(PAGELET_MIGRATION_NOTICE_KEY, "1");
    } catch {
        // localStorage unavailable; the migration result remains valid.
    }
}

export class SettingsPersistence {
    private persistedSourcePermission: SourcePermissionSnapshot | undefined;
    private persistedSourceEpoch: string | undefined;
    private settings!: PluginManagerSettings;
    private settingsChangeListeners = new Set<() => void | Promise<void>>();
    private settingsSaveTail: Promise<void> | null = null;
    private requiredSettingsTransactions: Set<Promise<unknown>> | null = null;
    private settingsMigrationBaselineFingerprint: string | null = null;
    private legacyAiProviderMigration: LegacyAiProviderMigration | null = null;
    private pendingLearningPreferencesMigration = false;
    private pendingSimpleSettingsCanonicalization = false;
    private pendingPageletReviewsFolderMigration: {
        input: string;
        error: PageletReviewsFolderError;
    } | null = null;
    private backgroundDiscoveryEpoch = 0;
    private backgroundDiscoveryPersistenceUncertain = false;

    constructor(private readonly dependencies: SettingsPersistenceDependencies) {}

    get currentSettings(): PluginManagerSettings {
        return this.settings;
    }

    setCurrentSettingsForCompatibility(settings: PluginManagerSettings): void {
        this.settings = settings;
        this.persistedSourcePermission = sourcePermissionSnapshot(settings);
        this.persistedSourceEpoch = settings.dataBoundary?.sourceRevocationEpoch;
    }

    getSettingsSaveTailForCompatibility(): Promise<void> | null {
        return this.settingsSaveTail;
    }

    setSettingsSaveTailForCompatibility(value: Promise<void> | null): void {
        this.settingsSaveTail = value;
    }

    getSettingsChangeListenersForCompatibility(): Set<() => void | Promise<void>> {
        return this.settingsChangeListeners;
    }

    setSettingsChangeListenersForCompatibility(value: Set<() => void | Promise<void>>): void {
        this.settingsChangeListeners = value;
    }

    getSettingsMigrationBaselineFingerprintForCompatibility(): string | null {
        return this.settingsMigrationBaselineFingerprint;
    }

    setSettingsMigrationBaselineFingerprintForCompatibility(value: string | null): void {
        this.settingsMigrationBaselineFingerprint = value;
    }

    getPendingLearningPreferencesMigrationForCompatibility(): boolean {
        return this.pendingLearningPreferencesMigration;
    }

    setPendingLearningPreferencesMigrationForCompatibility(value: boolean): void {
        this.pendingLearningPreferencesMigration = value;
    }

    getPendingSimpleSettingsCanonicalizationForCompatibility(): boolean {
        return this.pendingSimpleSettingsCanonicalization;
    }

    setPendingSimpleSettingsCanonicalizationForCompatibility(value: boolean): void {
        this.pendingSimpleSettingsCanonicalization = value;
    }

    getBackgroundDiscoveryEpoch(): number {
        return this.backgroundDiscoveryEpoch;
    }

    setBackgroundDiscoveryEpochForCompatibility(value: number): void {
        this.backgroundDiscoveryEpoch = value;
    }

    getBackgroundDiscoveryPersistenceUncertainForCompatibility(): boolean {
        return this.backgroundDiscoveryPersistenceUncertain;
    }

    setBackgroundDiscoveryPersistenceUncertainForCompatibility(value: boolean): void {
        this.backgroundDiscoveryPersistenceUncertain = value;
    }

    async loadSettings(): Promise<void> {
        let loaded = await this.dependencies.loadData();
        if (loaded === null) {
            loaded = await this.initializeMissingPluginDataJson();
        }
        this.settingsMigrationBaselineFingerprint = fingerprintPluginData(loaded);
        this.dependencies.initializeLegacyMemoryCompatibility(loaded);
        const fresh = isFreshInstall(loaded);
        this.legacyAiProviderMigration = classifyLegacyAiProviderMigration(loaded);
        this.pendingSimpleSettingsCanonicalization = hasDeprecatedSimpleSettingsFields(loaded);
        this.settings = mergeLoadedSettings(loaded);
        this.persistedSourcePermission = sourcePermissionSnapshot(this.settings);
        this.persistedSourceEpoch = this.settings.dataBoundary?.sourceRevocationEpoch;
        const rawPreferences = loaded && typeof loaded === "object"
            ? (loaded as Record<string, unknown>).learningPreferences
            : undefined;
        this.pendingLearningPreferencesMigration = JSON.stringify(rawPreferences)
            !== JSON.stringify(this.settings.learningPreferences);
        this.backgroundDiscoveryPersistenceUncertain = false;
        this.backgroundDiscoveryEpoch += 1;
        if (fresh) {
            this.settings.aiProvider = "";
            this.dependencies.clearTokenCache();
        }
        const rawPagelet = typeof loaded === "object" && loaded !== null
            ? (loaded as Record<string, unknown>).pagelet
            : undefined;
        const rawReviewsFolder = typeof rawPagelet === "object" && rawPagelet !== null
            ? (rawPagelet as Record<string, unknown>).reviewsFolder
            : undefined;
        if (typeof rawReviewsFolder === "string" && rawReviewsFolder.trim().length > 0) {
            const inspection = normalizeReviewsFolder(rawReviewsFolder, {
                configDir: getVaultConfigDir(this.dependencies.getVault()),
            });
            if (inspection.error && !readPageletMigrationFlag()) {
                this.pendingPageletReviewsFolderMigration = {
                    input: inspection.input ?? rawReviewsFolder,
                    error: inspection.error,
                };
            }
        }
        this.dependencies.log("Settings loaded", this.settings);
    }

    async migrateSettings(): Promise<void> {
        const maxAttempts = 3;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            try {
                await this.migrateSettingsOnce();
                this.settingsMigrationBaselineFingerprint = null;
                return;
            } catch (error) {
                if (!(error instanceof PluginDataJsonMigrationConflictError)) {
                    this.settingsMigrationBaselineFingerprint = null;
                    throw error;
                }
                if (attempt === maxAttempts - 1) {
                    this.settingsMigrationBaselineFingerprint = null;
                    throw error;
                }
                await this.loadSettings();
            }
        }
    }

    async saveSettings(): Promise<void> {
        const saved = await this.enqueueWrite(async () => {
            if (this.dependencies.isUnloading()) return false;
            await this.saveSettingsData();
            return true;
        });
        if (saved) await this.notifySettingsChanged();
    }

    async saveGraphOptions(options: GraphOptions): Promise<void> {
        const requested = JSON.parse(JSON.stringify(options)) as GraphOptions;
        await this.enqueueWrite(async () => {
            if (this.dependencies.isUnloading()) throw new Error("Plugin is unloading");
            await this.saveSettingsData({ ...this.settings, ...requested });
            Object.assign(this.settings, requested);
        });
        await this.notifySettingsChanged();
    }

    async saveFeaturedImageDefaults(options: FeaturedImageDefaults): Promise<void> {
        const requested = { ...options };
        await this.enqueueWrite(async () => {
            if (this.dependencies.isUnloading()) throw new Error("Plugin is unloading");
            await this.saveSettingsData({ ...this.settings, ...requested });
            Object.assign(this.settings, requested);
        });
        await this.notifySettingsChanged();
    }

    async saveSettingsPermissions(patch: SettingsPermissionPatch): Promise<void> {
        const requested = JSON.parse(JSON.stringify(patch)) as SettingsPermissionPatch;
        await this.enqueueWrite(async () => {
            if (this.dependencies.isUnloading()) throw new Error("Plugin is unloading");
            const { retrievalHabitProfile, quickCapture, dataBoundary, pagelet, ...scalar } = requested;
            const snapshot: PluginManagerSettings = {
                ...this.settings,
                ...scalar,
                retrievalHabitProfile: { ...this.settings.retrievalHabitProfile, ...retrievalHabitProfile },
                quickCapture: { ...this.settings.quickCapture, ...quickCapture },
                dataBoundary: { ...this.settings.dataBoundary, ...dataBoundary },
                pagelet: { ...this.settings.pagelet, ...pagelet },
            };
            const learningPreferences = mergeLearningPreferences(this.settings.learningPreferences);
            if (typeof scalar.memoryExtractionEnabled === "boolean") {
                learningPreferences.memoryExtraction = scalar.memoryExtractionEnabled ? "enabled" : "disabled";
            }
            if (typeof retrievalHabitProfile?.enabled === "boolean") {
                learningPreferences.habitLearning = retrievalHabitProfile.enabled ? "enabled" : "disabled";
            }
            snapshot.learningPreferences = learningPreferences;
            await this.saveSettingsData(snapshot);
            Object.assign(this.settings, scalar);
            this.settings.learningPreferences = learningPreferences;
            if (retrievalHabitProfile) Object.assign(this.settings.retrievalHabitProfile, retrievalHabitProfile);
            if (quickCapture) Object.assign(this.settings.quickCapture, quickCapture);
            if (dataBoundary) Object.assign(this.settings.dataBoundary, dataBoundary);
            if (pagelet) Object.assign(this.settings.pagelet, pagelet);
            if (scalar.memoryEnabled === false || scalar.memoryExtractionEnabled === false
                || scalar.memoryExtractionConsent?.state === "paused") {
                this.dependencies.syncMemoryExtractionRuntime();
            }
        });
        await this.notifySettingsChanged();
    }

    /** File permission revocations survive a subsequent allow event and process restart. */
    async recordSourceRevocation(): Promise<void> {
        await this.enqueueWrite(async () => {
            if (this.dependencies.isUnloading()) throw new Error("Plugin is unloading");
            await this.saveSettingsData({
                ...this.settings,
                dataBoundary: { ...this.settings.dataBoundary, sourceRevocationEpoch: newSourceRevocationEpoch() },
            });
        });
        await this.notifySettingsChanged();
    }

    async setStatisticsSyncEnabled(enabled: boolean): Promise<void> {
        await this.enqueueWrite(async () => {
            if (this.dependencies.isUnloading()) throw new Error("Plugin is unloading");
            const previous = this.settings.statisticsSyncEnabled;
            await this.saveSettingsData({ ...this.settings, statisticsSyncEnabled: enabled });
            try {
                await this.dependencies.setStatisticsRuntimeEnabled(enabled);
            } catch (error) {
                await this.saveSettingsData({ ...this.settings, statisticsSyncEnabled: previous });
                throw error;
            }
            this.settings.statisticsSyncEnabled = enabled;
        });
        await this.notifySettingsChanged();
    }

    async persistMemoryAdmissionSettings(): Promise<void> {
        await this.trackRequiredTransaction(this.persistRequiredSettings());
    }

    async persistRequiredSettings(options: { notify?: boolean } = {}): Promise<void> {
        await this.enqueueWrite(async () => {
            await this.saveSettingsData();
        });
        if (options.notify !== false && !this.dependencies.isUnloading()) {
            await this.notifySettingsChanged();
        }
    }

    async setBackgroundDiscoveryEnabled(enabled: boolean): Promise<void> {
        await this.enqueueWrite(async () => {
            if (this.dependencies.isUnloading()) throw new Error("Plugin is unloading");
            const snapshot = {
                ...this.settings,
                pagelet: { ...this.settings.pagelet, backgroundDiscoveryEnabled: enabled },
            };
            try {
                await this.saveSettingsData(snapshot);
            } catch (error) {
                this.backgroundDiscoveryPersistenceUncertain = true;
                this.backgroundDiscoveryEpoch += 1;
                this.dependencies.setBackgroundDiscoveryRuntimeEnabled(false);
                throw error;
            }
            const changed = this.settings.pagelet.backgroundDiscoveryEnabled !== enabled
                || this.backgroundDiscoveryPersistenceUncertain;
            this.settings.pagelet.backgroundDiscoveryEnabled = enabled;
            this.backgroundDiscoveryPersistenceUncertain = false;
            if (changed) this.backgroundDiscoveryEpoch += 1;
            this.dependencies.setBackgroundDiscoveryRuntimeEnabled(enabled);
        });
        await this.notifySettingsChanged();
    }

    isBackgroundDiscoveryEnabled(): boolean {
        return this.settings.pagelet.backgroundDiscoveryEnabled
            && !this.backgroundDiscoveryPersistenceUncertain;
    }

    async persistSettingsSlice<T>(
        read: () => T,
        write: (value: T) => void,
        next: T,
        requireCommit = false,
    ): Promise<void> {
        const saved = await this.enqueueWrite(async () => {
            if (this.dependencies.isUnloading()) {
                if (requireCommit) throw new Error("Plugin is unloading");
                return false;
            }
            const previous = read();
            write(next);
            try {
                await this.saveSettingsData();
                return true;
            } catch (error) {
                write(previous);
                throw error;
            }
        });
        if (!saved && requireCommit) throw new Error("Settings write was not committed");
        if (saved) await this.notifySettingsChanged();
    }

    async saveSettingsData(settingsSnapshot: PluginManagerSettings = this.settings): Promise<void> {
        const permission = sourcePermissionSnapshot(settingsSnapshot);
        const narrowed = this.persistedSourcePermission !== undefined
            && sourcePermissionNarrowed(this.persistedSourcePermission, permission);
        const epoch = narrowed ? newSourceRevocationEpoch() : settingsSnapshot.dataBoundary?.sourceRevocationEpoch;
        const revoking = narrowed || epoch !== this.persistedSourceEpoch;
        if (revoking) {
            try { this.dependencies.onSourcePermissionRevoking?.(); } catch { /* Optional observer. */ }
        }
        const canonical = omitDeprecatedSimpleSettingsFields({
            ...settingsSnapshot,
            dataBoundary: { ...settingsSnapshot.dataBoundary, ...(epoch ? { sourceRevocationEpoch: epoch } : {}) },
        });
        const committed = () => {
            this.persistedSourcePermission = permission;
            this.persistedSourceEpoch = epoch;
            if (epoch) this.settings.dataBoundary.sourceRevocationEpoch = epoch;
            if (revoking) {
                try { this.dependencies.onSourcePermissionCommitted?.(); } catch { /* Optional observer. */ }
            }
        };
        try {
            await this.saveCanonicalSettings(canonical, committed);
        } catch (error) {
            if (revoking) {
                try { this.dependencies.onSourcePermissionFailed?.(); } catch { /* Optional observer. */ }
            }
            throw error;
        }
    }

    private async saveCanonicalSettings(
        canonical: ReturnType<typeof omitDeprecatedSimpleSettingsFields>,
        committed: () => void,
    ): Promise<void> {
        const barrier = this.dependencies.getLegacyMemoryCompatibilityBarrier();
        if (!barrier || !barrier.isActive() && !barrier.isFinalizing()) {
            await this.dependencies.saveData(canonical);
            committed();
            this.pendingSimpleSettingsCanonicalization = false;
            return;
        }
        const migrationBaseline = this.settingsMigrationBaselineFingerprint;
        const processed = await this.processPluginDataJson((persisted) => {
            if (migrationBaseline !== null
                && fingerprintPluginData(persisted) !== migrationBaseline) {
                throw new PluginDataJsonMigrationConflictError();
            }
            const composed = barrier.composeForSave(canonical, persisted);
            if (!composed.ok) {
                this.dependencies.markMemoryGovernanceBootstrapError(composed.errorCode);
                throw this.dependencies.createLegacySaveCollisionError();
            }
            return omitDeprecatedSimpleSettingsFields(composed.payload);
        });
        if (migrationBaseline !== null
            && fingerprintPluginData(processed.written) !== fingerprintPluginData(processed.readback)) {
            throw new PluginDataJsonMigrationConflictError();
        }
        if (!barrier.refreshFromPersisted(processed.readback)) {
            throw this.dependencies.createLegacySaveCollisionError();
        }
        this.dependencies.updateLegacyMemoryPayload(barrier.snapshot());
        await this.dependencies.synchronizeNonMemoryQueueFromPersisted(processed.readback);
        committed();
        this.pendingSimpleSettingsCanonicalization = false;
    }

    async processPluginDataJson(
        mutate: (persisted: Record<string, unknown>) => Record<string, unknown>,
    ): Promise<{ written: Record<string, unknown>; readback: Record<string, unknown> }> {
        const adapter = this.dependencies.getAdapter();
        if (typeof adapter.process !== "function" || typeof adapter.read !== "function") {
            throw this.dependencies.createLegacySaveCollisionError();
        }
        const path = this.getPluginDataJsonPath();
        return withMemoryExternalOperationTimeout(
            "plugin_data_json_transaction",
            async () => {
                const writtenText = await adapter.process!(path, (currentText) => {
                    const current = this.parsePluginDataJson(currentText);
                    return JSON.stringify(mutate(current), null, 2);
                });
                const written = this.parsePluginDataJson(writtenText);
                const readback = this.parsePluginDataJson(await adapter.read!(path));
                return { written, readback };
            },
        );
    }

    async readPluginDataJson(): Promise<Record<string, unknown>> {
        const adapter = this.dependencies.getAdapter();
        if (typeof adapter.read !== "function") {
            throw this.dependencies.createLegacySaveCollisionError();
        }
        return this.parsePluginDataJson(await adapter.read(this.getPluginDataJsonPath()));
    }

    enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
        this.settingsSaveTail ??= Promise.resolve();
        const result = this.settingsSaveTail.then(operation, operation);
        this.settingsSaveTail = result.then(() => undefined, () => undefined);
        return result;
    }

    async drainWrites(): Promise<void> {
        while (true) {
            const pendingTail = this.settingsSaveTail;
            const pendingTransactions = Array.from(this.requiredSettingsTransactions ?? []);
            if (!pendingTail && pendingTransactions.length === 0) return;
            await Promise.allSettled([
                ...(pendingTail ? [pendingTail] : []),
                ...pendingTransactions,
            ]);
            if (pendingTail === this.settingsSaveTail
                && (this.requiredSettingsTransactions?.size ?? 0) === 0) {
                return;
            }
        }
    }

    trackRequiredTransaction<T>(operation: Promise<T>): Promise<T> {
        this.requiredSettingsTransactions ??= new Set();
        this.requiredSettingsTransactions.add(operation);
        const remove = () => this.requiredSettingsTransactions?.delete(operation);
        void operation.then(remove, remove);
        return operation;
    }

    onSettingsChanged(listener: () => void | Promise<void>): () => void {
        this.settingsChangeListeners.add(listener);
        return () => {
            this.settingsChangeListeners.delete(listener);
        };
    }

    async notifySettingsChanged(): Promise<void> {
        if (this.dependencies.shouldDeferSettingsNotification()) {
            this.dependencies.deferSettingsNotification();
            return;
        }
        this.dependencies.refreshRetrievalEpoch();
        await Promise.allSettled(
            Array.from(this.settingsChangeListeners, (listener) => Promise.resolve().then(listener)),
        );
    }

    surfacePendingPageletReviewsFolderMigration(): void {
        const pending = this.pendingPageletReviewsFolderMigration;
        if (!pending) return;
        this.pendingPageletReviewsFolderMigration = null;
        const locale = this.dependencies.getPageletLocale();
        const message = `${pageletT("pagelet.migration.reviewsFolderCoerced.title", locale)}\n${pending.input}`;
        try {
            this.dependencies.showNotice(message, 10000);
        } catch (error) {
            this.dependencies.log("Failed to fire Pagelet migration Notice", error);
        }
        writePageletMigrationFlag();
        this.dependencies.log(
            "Pagelet reviewsFolder coerced on load; emitted one-time Notice",
            { error: pending.error, input: pending.input },
        );
    }

    private async initializeMissingPluginDataJson(): Promise<unknown> {
        const adapter = this.dependencies.getAdapter();
        const dataPath = this.getPluginDataJsonPath();
        const temporaryPath = normalizePath(
            `${dataPath}.init-${this.dependencies.createStatisticsVaultId()}.tmp`,
        );
        let temporaryWritten = false;
        try {
            await adapter.write(temporaryPath, "{}");
            temporaryWritten = true;
            try {
                await adapter.copy(temporaryPath, dataPath);
            } catch (error) {
                const concurrent = await this.dependencies.loadData();
                if (concurrent !== null && concurrent !== undefined) return concurrent;
                throw error;
            }
            const created = await this.dependencies.loadData();
            if (created === null || created === undefined) {
                throw new Error("Failed to initialize Personal Assistant settings storage.");
            }
            return created;
        } finally {
            if (temporaryWritten) {
                try {
                    await adapter.remove(temporaryPath);
                } catch (error) {
                    this.dependencies.log("Failed to clean up settings initialization file", error);
                }
            }
        }
    }

    private getPluginDataJsonPath(): string {
        const manifest = this.dependencies.getManifest();
        const manifestDir = manifest?.dir?.trim();
        const pluginDir = manifestDir
            ? normalizePath(manifestDir)
            : joinVaultConfigPath(
                getVaultConfigDir(this.dependencies.getVault()),
                `plugins/${manifest?.id?.trim() || "personal-assistant"}`,
            );
        return normalizePath(`${pluginDir}/data.json`);
    }

    private parsePluginDataJson(value: string): Record<string, unknown> {
        let parsed: unknown;
        try {
            parsed = value.trim() ? JSON.parse(value) : {};
        } catch {
            throw this.dependencies.createLegacySaveCollisionError();
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw this.dependencies.createLegacySaveCollisionError();
        }
        return parsed as Record<string, unknown>;
    }

    private async migrateSettingsOnce(): Promise<void> {
        try {
            let changed = this.pendingSimpleSettingsCanonicalization
                || this.pendingLearningPreferencesMigration;
            const settingsWithLegacyModel = this.settings as PluginManagerSettings & { modelName?: unknown };
            const legacyModelName = typeof settingsWithLegacyModel.modelName === "string"
                ? settingsWithLegacyModel.modelName.trim()
                : "";
            if (this.legacyAiProviderMigration === "confirmed-qwen") {
                this.dependencies.log("Migrating settings from old version");
                this.settings.aiProvider = "qwen";
                this.settings.baseURL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
                this.settings.chatModelName = legacyModelName || DEFAULT_SETTINGS.chatModelName;
                this.settings.embeddingModelName = "text-embedding-v3";
                this.legacyAiProviderMigration = null;
                changed = true;
            } else if (this.legacyAiProviderMigration === "provider-selection-required") {
                this.settings.aiProvider = "";
                delete this.settings.aiProviderPreset;
                this.legacyAiProviderMigration = null;
                changed = true;
            }
            if (legacyModelName
                && legacyModelName !== "qwen-plus"
                && this.settings.chatModelName === DEFAULT_SETTINGS.chatModelName) {
                this.settings.chatModelName = legacyModelName;
                changed = true;
            }
            if ("modelName" in settingsWithLegacyModel) {
                delete settingsWithLegacyModel.modelName;
                changed = true;
            }
            const normalizedStatisticsType = normalizeStatisticsView(this.settings.statisticsType);
            if (this.settings.statisticsType !== normalizedStatisticsType) {
                this.settings.statisticsType = normalizedStatisticsType;
                changed = true;
            }
            if (typeof this.settings.memoryEnabled !== "boolean") {
                this.settings.memoryEnabled = true;
                changed = true;
            }
            if (!["always", "auto-refresh-after-prepare"].includes(this.settings.memoryApprovalPolicy)) {
                this.settings.memoryApprovalPolicy = "always";
                changed = true;
            }
            if (typeof this.settings.showAdvancedMemoryControls !== "boolean") {
                this.settings.showAdvancedMemoryControls = false;
                changed = true;
            }
            if (typeof this.settings.qwenThinkingEnabled !== "boolean") {
                this.settings.qwenThinkingEnabled = false;
                changed = true;
            }
            if (typeof this.settings.webSearchEnabled !== "boolean") {
                this.settings.webSearchEnabled = false;
                changed = true;
            }
            if (typeof this.settings.policyModelName !== "string") {
                this.settings.policyModelName = "";
                changed = true;
            }
            const normalizedFeaturedImageModel = normalizeFeaturedImageModel(this.settings.featuredImageModel);
            if (this.settings.featuredImageModel !== normalizedFeaturedImageModel) {
                this.settings.featuredImageModel = normalizedFeaturedImageModel;
                changed = true;
            }
            const normalizedNumFeaturedImages = normalizeFeaturedImageCount(this.settings.numFeaturedImages);
            if (this.settings.numFeaturedImages !== normalizedNumFeaturedImages) {
                this.settings.numFeaturedImages = normalizedNumFeaturedImages;
                changed = true;
            }
            if ("qwenWebSearchEnabled" in this.settings) {
                delete (this.settings as Partial<PluginManagerSettings> & {
                    qwenWebSearchEnabled?: unknown;
                }).qwenWebSearchEnabled;
                changed = true;
            }
            if ("isEnabledMetadataUpdating" in this.settings) {
                delete (this.settings as Partial<PluginManagerSettings> & {
                    isEnabledMetadataUpdating?: unknown;
                }).isEnabledMetadataUpdating;
                changed = true;
            }
            if (this.settings.aiProvider === "ollama") {
                this.settings.aiProvider = "";
                delete this.settings.aiProviderPreset;
                changed = true;
            }
            if (typeof this.settings.shareAnonymousCapabilityUsage !== "boolean") {
                this.settings.shareAnonymousCapabilityUsage = false;
                changed = true;
            }
            if (!this.settings.statisticsVaultId) {
                this.settings.statisticsVaultId = this.dependencies.createStatisticsVaultId();
                changed = true;
            }
            const vault = this.dependencies.getVault();
            if (vault) {
                const configDir = getVaultConfigDir(vault);
                if (this.settings.pagelet) {
                    const pageletFolder = normalizeReviewsFolder(this.settings.pagelet.reviewsFolder, { configDir });
                    if (pageletFolder.error) {
                        if (!readPageletMigrationFlag()) {
                            this.pendingPageletReviewsFolderMigration = {
                                input: pageletFolder.input ?? this.settings.pagelet.reviewsFolder,
                                error: pageletFolder.error,
                            };
                        }
                        this.settings.pagelet.reviewsFolder = pageletFolder.value;
                        changed = true;
                    } else if (this.settings.pagelet.reviewsFolder !== pageletFolder.value) {
                        this.settings.pagelet.reviewsFolder = pageletFolder.value;
                        changed = true;
                    }
                }
                const defaultStatsPath = joinVaultConfigPath(configDir, "stats.json");
                if (!this.settings.statsPath
                    || this.settings.statsPath === joinVaultConfigPath(LEGACY_CONFIG_DIR, "stats.json")) {
                    if (this.settings.statsPath !== defaultStatsPath) {
                        this.settings.statsPath = defaultStatsPath;
                        changed = true;
                    }
                }
                const hasConfiguredExcludes = Array.isArray(this.settings.vssCacheExcludePath);
                const currentExcludes = hasConfiguredExcludes
                    ? uniqueNormalizedPaths(this.settings.vssCacheExcludePath.map((path) => path.trim()).filter(Boolean))
                    : [];
                const configuredDefaultExcludes = Array.isArray(DEFAULT_SETTINGS.vssCacheExcludePath)
                    ? DEFAULT_SETTINGS.vssCacheExcludePath
                    : [];
                const legacyDefaultExcludes = uniqueNormalizedPaths([
                    LEGACY_CONFIG_DIR,
                    ...configuredDefaultExcludes,
                ]);
                if (!hasConfiguredExcludes
                    || configuredDefaultExcludes.length > 0 && arraysEqual(currentExcludes, configuredDefaultExcludes)
                    || arraysEqual(currentExcludes, legacyDefaultExcludes)) {
                    const nextExcludes = uniqueNormalizedPaths([
                        configDir,
                        ...configuredDefaultExcludes,
                    ]);
                    if (!arraysEqual(currentExcludes, nextExcludes)) {
                        this.settings.vssCacheExcludePath = nextExcludes;
                        changed = true;
                    }
                }
            }
            if (this.settings.aiProvider === "qwen"
                && this.settings.embeddingModelName === "text-embedding-v3"
                && !this.settings.embeddingV4MigrationNoticeDismissed) {
                this.dependencies.showNotice(
                    this.dependencies.translateQwenMemoryModelRecommended(),
                    10000,
                );
                this.settings.embeddingV4MigrationNoticeDismissed = true;
                changed = true;
            }
            if (changed) {
                await this.saveSettings();
                this.pendingLearningPreferencesMigration = false;
                this.dependencies.log("Settings migration completed");
            }
        } catch (error) {
            this.dependencies.log("Error during settings migration:", error);
            throw error;
        }
    }
}
