/* Copyright 2023 edonyzpc */

import { TFile, type App, type TAbstractFile } from "obsidian";
import { LEARNING_DEFAULTS_VERSION, type PluginManagerSettings } from "../settings";
import type { ChatHistoryManager } from "../chat/chat-history-manager";
import type { PaAgentInjectedContext } from "../ai-services/context/PaAgentContextProjector";
import {
    MemoryExtractionScheduler,
    sanitizeUserProfileSnapshot,
    type ExistingUserProfileReader,
    type TypeAAdmissionBatch,
    type TypeAAdmissionResult,
    type UserProfileSnapshot,
    type UserProfileStore,
} from "../ai-services/memory-extraction";
import type { VaultInsightsSourceReceipt } from "../ai-services/memory-extraction/extraction-scheduler";
import type { MemoryHost } from "./MemoryHost";
import { MemoryManager } from "../memory-manager";
import { VSS } from "../vss";
import { MemoryStatusNotifier } from "../plugin/memory-status";

type ProfileStoreMode = "legacy" | "governed";

export interface MemoryPluginIntegrationOptions {
    getApp: () => App;
    getPluginId: () => string;
    getSettings: () => PluginManagerSettings;
    isUnloading: () => boolean;
    getChatHistoryManager: () => ChatHistoryManager | undefined;
    hasConfirmedExtractionConsent: () => boolean;
    hasGovernedProjection: () => boolean;
    getGovernanceUiMode: () => string;
    getLegacyProfileScope: () => string;
    getDataBoundaryFingerprint: () => string;
    shouldHandleVaultEvent: (file: TFile) => boolean;
    createLegacyProfileStore: () => UserProfileStore;
    createGovernedProfileStore: () => UserProfileStore;
    createExistingProfileReader: () => ExistingUserProfileReader;
    createExtractionModel: () => Promise<{ invoke: (prompt: string) => Promise<string> } | null>;
    admitTypeACandidates: (batch: TypeAAdmissionBatch) => Promise<TypeAAdmissionResult>;
    captureTypeAAdmissionBaseline: NonNullable<ConstructorParameters<typeof MemoryExtractionScheduler>[0]["captureTypeAAdmissionBaseline"]>;
    getTypeAProcessedTurn: NonNullable<ConstructorParameters<typeof MemoryExtractionScheduler>[0]["getTypeAProcessedTurn"]>;
    surfaceExtractionEnabledNotice: () => void;
    surfaceVaultInsightsInjectionNotice: () => void;
    createStatusNotifier: () => MemoryStatusNotifier;
    log: (message: string, error?: unknown) => void;
}

/**
 * Shell owner for Memory, VSS, and extraction integration state.
 * Domain behavior remains in MemoryManager, VSS, and MemoryExtractionScheduler.
 */
export class MemoryPluginIntegration {
    private vss: VSS | null = null;
    private memoryManager: MemoryManager | null = null;
    private manualActionInFlight = false;
    private extractionScheduler: MemoryExtractionScheduler | null = null;
    private extractionProfileStore: ProfileStoreMode = "legacy";
    private extractionAdmissionStopped = false;
    private vaultInsightsSourceOwner: object | undefined;
    private vaultInsightsSource: VaultInsightsSourceReceipt | null = null;
    private injectionNoticeSurfacedThisBoot = false;
    private legacyProfileContext: { scope: string; snapshot: UserProfileSnapshot } | null = null;
    private legacyProfileReadEpoch = 0;
    private legacyProfileRead: { scope: string; promise: Promise<void> } | null = null;
    private legacyProfileMutationCount = 0;
    private legacyProfileSourceIdentity: object = {};
    private statusNotifier: MemoryStatusNotifier;

    constructor(private readonly options: MemoryPluginIntegrationOptions) {
        this.statusNotifier = options.createStatusNotifier();
    }

    get vssCacheDir(): string {
        return `${this.options.getApp().vault.configDir}/plugins/${this.options.getPluginId()}/vss-cache`
            .replace(/\/{2,}/g, "/");
    }

    getVss(): VSS | null { return this.vss; }
    setVss(value: VSS | null): void { this.vss = value; }
    getMemoryManager(): MemoryManager | null { return this.memoryManager; }
    setMemoryManager(value: MemoryManager | null): void { this.memoryManager = value; }
    getExtractionScheduler(): MemoryExtractionScheduler | null { return this.extractionScheduler; }
    setExtractionScheduler(value: MemoryExtractionScheduler | null): void { this.extractionScheduler = value; }
    getExtractionProfileStore(): ProfileStoreMode { return this.extractionProfileStore; }
    setExtractionProfileStore(value: ProfileStoreMode): void { this.extractionProfileStore = value; }
    getVaultInsightsSourceOwner(): object | undefined { return this.vaultInsightsSourceOwner; }
    setVaultInsightsSourceOwner(value: object | undefined): void { this.vaultInsightsSourceOwner = value; }
    getVaultInsightsSource(): VaultInsightsSourceReceipt | null { return this.vaultInsightsSource; }
    setVaultInsightsSource(value: VaultInsightsSourceReceipt | null): void { this.vaultInsightsSource = value; }
    getStatusNotifier(): MemoryStatusNotifier { return this.statusNotifier; }
    setStatusNotifier(value: MemoryStatusNotifier): void { this.statusNotifier = value; }
    getInjectionNoticeSurfaced(): boolean { return this.injectionNoticeSurfacedThisBoot; }
    setInjectionNoticeSurfaced(value: boolean): void { this.injectionNoticeSurfacedThisBoot = value; }
    getLegacyProfileContext(): { scope: string; snapshot: UserProfileSnapshot } | null { return this.legacyProfileContext; }
    setLegacyProfileContext(value: { scope: string; snapshot: UserProfileSnapshot } | null): void { this.legacyProfileContext = value; }
    getLegacyProfileReadEpoch(): number { return this.legacyProfileReadEpoch; }
    setLegacyProfileReadEpoch(value: number): void { this.legacyProfileReadEpoch = value; }
    getLegacyProfileRead(): { scope: string; promise: Promise<void> } | null { return this.legacyProfileRead; }
    setLegacyProfileRead(value: { scope: string; promise: Promise<void> } | null): void { this.legacyProfileRead = value; }
    getLegacyProfileMutationCount(): number { return this.legacyProfileMutationCount; }
    setLegacyProfileMutationCount(value: number): void { this.legacyProfileMutationCount = value; }
    getLegacyProfileSourceIdentity(): object { return this.legacyProfileSourceIdentity; }
    setLegacyProfileSourceIdentity(value: object): void { this.legacyProfileSourceIdentity = value; }

    initializeSubsystem(
        host: MemoryHost,
        createVss: (host: MemoryHost, cacheDir: string) => VSS,
        updateStatus: () => Promise<void>,
    ): Promise<void> {
        if (this.vss && this.memoryManager) {
            return updateStatus();
        }
        if (!this.vss) this.vss = createVss(host, this.vssCacheDir);
        if (!this.memoryManager) {
            this.memoryManager = new MemoryManager(host, this.vss);
            this.memoryManager.startAutoMaintenance();
        }
        return updateStatus();
    }

    stopMaintenance(): void { this.memoryManager?.stopAutoMaintenance(); }
    waitForMemoryIdle(): Promise<void> { return this.memoryManager?.waitForIdle() ?? Promise.resolve(); }
    async disposeVss(): Promise<void> { await this.vss?.dispose(); }

    canRunExtraction(): boolean {
        const settings = this.options.getSettings();
        const preferences = settings.learningPreferences;
        return !this.options.isUnloading()
            && !this.extractionAdmissionStopped
            && settings.memoryEnabled === true
            && settings.memoryExtractionEnabled
            && settings.memoryExtractionConsent?.state !== "paused"
            && (preferences && preferences.version === LEARNING_DEFAULTS_VERSION
                ? preferences.memoryExtraction !== "disabled"
                : this.options.hasConfirmedExtractionConsent());
    }

    syncExtractionRuntime(): void {
        const settings = this.options.getSettings();
        if (settings.memoryEnabled !== true || settings.memoryExtractionIncludeVaultInsights !== true) {
            this.vaultInsightsSource = null;
        }
        if (!this.canRunExtraction()) {
            if (!this.extractionAdmissionStopped && this.extractionScheduler) {
                this.extractionScheduler.dispose();
                this.extractionScheduler = null;
            }
            return;
        }
        const chatHistoryManager = this.options.getChatHistoryManager();
        if (!chatHistoryManager) return;
        const profileStore: ProfileStoreMode = this.options.hasGovernedProjection() ? "governed" : "legacy";
        if (this.extractionScheduler && this.extractionProfileStore !== profileStore) {
            this.extractionScheduler.dispose();
            this.extractionScheduler = null;
        }
        const includeVaultInsights = settings.memoryExtractionIncludeVaultInsights === true
            && this.options.hasConfirmedExtractionConsent();
        if (!this.extractionScheduler) {
            this.extractionProfileStore = profileStore;
            const scheduler = new MemoryExtractionScheduler({
                app: this.options.getApp(),
                chatHistoryManager,
                userProfileStore: profileStore === "governed"
                    ? this.options.createGovernedProfileStore()
                    : this.options.createLegacyProfileStore(),
                log: this.options.log,
                includeVaultInsightsInPrompt: includeVaultInsights,
                onVaultInsightsSourceChanged: this.createVaultInsightsSourceListener(),
                shouldHandleVaultEvent: this.options.shouldHandleVaultEvent,
                getDataBoundaryFingerprint: this.options.getDataBoundaryFingerprint,
                ...(profileStore === "governed" ? {
                    semanticTypeA: true,
                    admitTypeACandidates: this.options.admitTypeACandidates,
                    captureTypeAAdmissionBaseline: this.options.captureTypeAAdmissionBaseline,
                    getTypeAProcessedTurn: this.options.getTypeAProcessedTurn,
                } : {}),
                createModelForExtraction: this.options.createExtractionModel,
            });
            this.extractionScheduler = scheduler;
            if (this.vss) scheduler.setSemanticClusterProvider((maxClusters) => this.vss!.clusterVectors(maxClusters));
            scheduler.start();
            if (!settings.memoryExtractionNoticeDismissed) this.options.surfaceExtractionEnabledNotice();
            this.options.surfaceVaultInsightsInjectionNotice();
            return;
        }
        this.extractionScheduler.setIncludeVaultInsightsInPrompt(includeVaultInsights);
        this.options.surfaceVaultInsightsInjectionNotice();
    }

    stopExtractionAdmission(): void {
        if (this.extractionAdmissionStopped) return;
        this.extractionAdmissionStopped = true;
        this.vaultInsightsSourceOwner = undefined;
        this.vaultInsightsSource = null;
        this.extractionScheduler?.stopAdmission?.();
    }

    disposeExtractionResources(): void {
        this.extractionScheduler?.dispose();
        this.extractionScheduler = null;
    }

    scheduleExtractionAfterChatTurn(conversationId: string, turnCount: number): void {
        if (!this.canRunExtraction()) return;
        this.extractionScheduler?.scheduleTypeAExtraction(conversationId, turnCount);
    }

    createVaultInsightsSourceListener(): (source: VaultInsightsSourceReceipt | null) => void {
        const owner = {};
        this.vaultInsightsSourceOwner = owner;
        return source => {
            if (this.options.isUnloading() || this.extractionAdmissionStopped
                || this.vaultInsightsSourceOwner !== owner) return;
            this.vaultInsightsSource = source;
        };
    }

    captureVaultInsightsSourceValidity(): () => boolean {
        const source = this.vaultInsightsSource;
        const scope = this.options.getLegacyProfileScope();
        const boundary = this.options.getDataBoundaryFingerprint();
        return () => !!source && this.vaultInsightsSource === source
            && !this.options.isUnloading() && !this.extractionAdmissionStopped
            && this.options.getSettings().memoryEnabled === true
            && this.options.getSettings().memoryExtractionIncludeVaultInsights === true
            && this.options.getLegacyProfileScope() === scope
            && this.options.getDataBoundaryFingerprint() === boundary
            && source.isSourceCurrent();
    }

    invalidateVaultInsightsSourceForFile(file: TAbstractFile, oldPath?: string): void {
        this.extractionScheduler?.invalidateVaultInsightsSource?.(file);
        const source = this.vaultInsightsSource;
        if (!source) return;
        if (source.sourcePaths.some(path => path === file.path || path === oldPath
            || path.startsWith(`${file.path}/`) || (oldPath && path.startsWith(`${oldPath}/`)))
            || (file instanceof TFile && file.extension === "md" && this.options.shouldHandleVaultEvent(file))
            || (!(file instanceof TFile) && this.options.getApp().vault.getMarkdownFiles().some(candidate => (
                candidate.path.startsWith(`${file.path}/`) && this.options.shouldHandleVaultEvent(candidate)
            )))) this.vaultInsightsSource = null;
    }

    invalidateLegacyProfileContext(): void {
        this.legacyProfileReadEpoch++;
        this.legacyProfileContext = null;
        this.legacyProfileRead = null;
    }

    async refreshLegacyProfileContext(): Promise<void> {
        const settings = this.options.getSettings();
        if (this.options.isUnloading() || settings.memoryEnabled !== true
            || this.options.getGovernanceUiMode() !== "legacy_threshold"
            || this.legacyProfileMutationCount > 0) {
            this.invalidateLegacyProfileContext();
            return;
        }
        const scope = this.options.getLegacyProfileScope();
        if (this.legacyProfileRead?.scope === scope) return this.legacyProfileRead.promise;
        this.invalidateLegacyProfileContext();
        const epoch = this.legacyProfileReadEpoch;
        const promise = (async () => {
            try {
                const result = await this.options.createExistingProfileReader().read();
                if (epoch !== this.legacyProfileReadEpoch || this.options.isUnloading()
                    || this.options.getSettings().memoryEnabled !== true || this.legacyProfileMutationCount > 0
                    || scope !== this.options.getLegacyProfileScope()
                    || this.options.getGovernanceUiMode() !== "legacy_threshold") return;
                if (result.state !== "ready") return;
                const snapshot = sanitizeUserProfileSnapshot(result.snapshot);
                if (snapshot?.records.length) this.legacyProfileContext = { scope, snapshot };
            } catch {
                // Missing, unavailable, or malformed legacy storage provides no context.
            }
        })();
        this.legacyProfileRead = { scope, promise };
        await promise;
        if (this.legacyProfileRead?.promise === promise) this.legacyProfileRead = null;
    }

    getLegacyPromptContext(canRunExtraction = this.canRunExtraction()): PaAgentInjectedContext {
        const settings = this.options.getSettings();
        if (settings.memoryEnabled !== true || this.options.isUnloading() || this.legacyProfileMutationCount > 0) {
            return { memoryContextMode: "legacy" };
        }
        if (!canRunExtraction && this.options.getGovernanceUiMode() !== "legacy_threshold") {
            return { memoryContextMode: "legacy" };
        }
        const scope = this.options.getLegacyProfileScope();
        const cachedProfile = this.legacyProfileContext
            && this.options.getGovernanceUiMode() === "legacy_threshold"
            && this.legacyProfileContext.scope === scope
            ? this.legacyProfileContext.snapshot.markdown : undefined;
        const schedulerContext = this.extractionScheduler?.getPromptContext()
            ?? (cachedProfile ? { userProfile: cachedProfile } : {});
        const attachGuard = (context: PaAgentInjectedContext): PaAgentInjectedContext => {
            Object.defineProperty(context, "generationInputSources", { value: {
                personal: context.userProfile ? { state: "unknown", mode: "legacy" } : { state: "none" },
                insights: context.vaultInsights ? { state: "unknown", mode: "legacy" } : { state: "none" },
            } });
            if (!context.userProfile && !context.vaultInsights) return context;
            const sourceIdentity = this.legacyProfileSourceIdentity;
            const boundary = this.options.getDataBoundaryFingerprint();
            const readProfile = () => this.extractionScheduler?.getUserProfileSnapshot?.()
                ?? this.legacyProfileContext?.snapshot;
            const profileIdentity = (snapshot: UserProfileSnapshot | null | undefined) => snapshot
                ? JSON.stringify(snapshot.records) : undefined;
            const originalProfile = profileIdentity(readProfile());
            const usesProfile = Boolean(context.userProfile);
            const insightsCurrent = context.vaultInsights ? this.captureVaultInsightsSourceValidity() : undefined;
            Object.defineProperty(context, "isSourceCurrent", { value: () => {
                try {
                    if (this.options.isUnloading() || this.options.getSettings().memoryEnabled !== true
                        || this.legacyProfileMutationCount > 0 || this.legacyProfileSourceIdentity !== sourceIdentity
                        || this.options.getLegacyProfileScope() !== scope
                        || this.options.getDataBoundaryFingerprint() !== boundary
                        || this.options.hasGovernedProjection()
                        || this.options.getGovernanceUiMode() !== "legacy_threshold") return false;
                    if (usesProfile) {
                        const latest = profileIdentity(readProfile());
                        if (!originalProfile || (latest !== originalProfile
                            && !(latest === undefined && this.legacyProfileRead?.scope === scope))) return false;
                    }
                    return !insightsCurrent || insightsCurrent();
                } catch { return false; }
            } });
            return context;
        };
        if (canRunExtraction && settings.memoryExtractionIncludeVaultInsights
            && this.options.hasConfirmedExtractionConsent()) {
            return attachGuard({ memoryContextMode: "legacy", ...schedulerContext });
        }
        return attachGuard({
            memoryContextMode: "legacy",
            ...(schedulerContext.userProfile ? { userProfile: schedulerContext.userProfile } : {}),
        });
    }

    beginLegacyProfileMutation(profileStore: ProfileStoreMode): void {
        this.legacyProfileMutationCount++;
        if (profileStore !== "governed") this.legacyProfileSourceIdentity = {};
        this.invalidateLegacyProfileContext();
    }

    async finishLegacyProfileMutation(committed: boolean): Promise<void> {
        this.legacyProfileMutationCount--;
        if (committed) await this.refreshLegacyProfileContext();
    }

    async runManualAction(action: () => Promise<void>, onBusy: () => void): Promise<void> {
        if (this.manualActionInFlight) {
            onBusy();
            return;
        }
        this.manualActionInFlight = true;
        try { await action(); }
        finally { this.manualActionInFlight = false; }
    }
}
