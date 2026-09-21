import { TFile } from "obsidian";

import { PluginManager } from "../../src/plugin";
import { SourceAccess } from "../../src/plugin/source-access";
import { VaultEventBridge } from "../../src/plugin/vault-event-bridge";
import { QuietRecallPluginIntegration } from "../../src/pagelet/plugin-quiet-recall";
import { ScopeRecapPluginIntegration } from "../../src/pagelet/plugin-scope-recap";
import { DeepDiscoverPluginIntegration } from "../../src/pagelet/plugin-deep-discover";
import { RetainedReviewPluginIntegration } from "../../src/pagelet/plugin-review-actions";
import { PageletOperationsPluginIntegration } from "../../src/pagelet/plugin-operations-integration";
import { PageletFeatureIntegration } from "../../src/pagelet/plugin-integration";
import { PageletOrchestrator } from "../../src/pagelet/orchestrator";
import { ChatPluginIntegration } from "../../src/chat/plugin-integration";
import { hashWritingText } from "../../src/chat/writing-types";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { confirmUserAction } from "../../src/confirm";
import { addPaRelatedLink } from "../../src/pa/frontmatter-link";

export interface PluginHarnessOptions {
    initialData?: Record<string, unknown> | null;
    secretStorageValues?: Record<string, string | null>;
    configDir?: string;
}

export interface PluginHarness {
    plugin: PluginManager;
    adapter: {
        read: jest.Mock;
        write: jest.Mock;
        copy: jest.Mock;
        remove: jest.Mock;
        process: jest.Mock;
    };
    secretStorage: {
        getSecret: jest.Mock;
        setSecret: jest.Mock;
    };
    readPersisted: () => Record<string, unknown> | null;
    writePersisted: (data: Record<string, unknown>) => void;
    beforeNextCopy: (callback: () => void) => void;
    beforeNextProcess: (callback: () => void) => void;
    beforeNextRead: (callback: () => void) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function installChatPluginIntegration(plugin: any): void {
    plugin.chatIntegration = new ChatPluginIntegration({
        get app() { return plugin.app; },
        getSettings: () => plugin.settings,
        getPluginId: () => plugin.manifest?.id ?? "personal-assistant",
        source: {
            isDataBoundaryAllowedPath: (path) => plugin.isDataBoundaryAllowedPath(path),
            isDataBoundaryAllowedFile: (file) => plugin.isDataBoundaryAllowedFile(file),
            getDataBoundaryTags: (file) => plugin.getDataBoundaryTags(file),
        },
        getImageGenerationConnection: () => plugin.getImageGenerationConnection?.() ?? null,
        getImageToken: async (mode) => mode === "dedicated-wan"
            ? plugin.getConfiguredImageAPITokenSecret?.() ?? null
            : await plugin.getAPIToken(),
        showImageSyncNotice: () => undefined,
        createOperationsSession: () => plugin.getOperationsService().createSession({ surface: "chat" }),
        createAiServiceHost: () => plugin.createAiServiceHost("chat"),
        hostActions: {
            isOperationsAgentEnabled: () => plugin.isOperationsAgentEnabled,
            log: (message, ...args) => plugin.log(message, ...args),
            getAISetupIssue: () => plugin.getAISetupIssue(),
            getAIReadiness: (scope) => plugin.getAIReadiness(scope),
            refreshAPITokenPresence: () => plugin.refreshAPITokenPresence(),
            confirmImageGenerationFirstUse: () => plugin.confirmImageGenerationFirstUse(),
            rememberWritingStyle: (versionId, scene) => plugin.rememberWritingStyle(versionId, scene),
            readWritingStyleReferences: (revisionIds, signal) => plugin.getWritingStyleService()
                ?.readReferences(revisionIds, signal) ?? Promise.resolve([]),
            onWritingReferencesChanged: (listener) => {
                let active = true;
                const notify = () => { if (active) listener(); };
                const settings = plugin.onSettingsChanged(notify);
                const repository = plugin.deviceMemoryGovernanceRepository?.subscribe(() => {
                    notify();
                    void plugin.deviceMemoryCacheRefreshPromise?.then(notify, notify);
                });
                return () => { active = false; settings(); repository?.(); };
            },
            prepareWritingStyle: (prompt, parentScene, budget) =>
                plugin.prepareWritingStyle(prompt, parentScene, budget),
            prepareWritingStyleForScene: (scene, budget) =>
                plugin.prepareWritingStyleForScene(scene, budget),
            createMemoryStatus: () => ({
                getMaintenancePlan: () => plugin.hasStructuralAIConfiguration("memory")
                    ? plugin.memoryManager?.getMaintenancePlan() ?? Promise.resolve(plugin.unavailableMemoryPlan())
                    : Promise.resolve(plugin.unavailableMemoryPlan()),
                prepareFromCommand: () => plugin.ensureAIConfigured("memory")
                    ? plugin.runManualMemoryAction(
                        () => plugin.memoryManager?.prepareFromCommand() ?? Promise.resolve(),
                    )
                    : Promise.resolve(),
                updateFromCommand: () => plugin.ensureAIConfigured("memory")
                    ? plugin.runManualMemoryAction(
                        () => plugin.memoryManager?.updateFromCommand() ?? Promise.resolve(),
                    )
                    : Promise.resolve(),
                showTechnicalStatus: () => void plugin.showTechnicalMemoryStatus(),
                onStatusChanged: (listener) => plugin.onMemoryStatusChanged(listener),
            }),
            onSettingsChanged: (listener) => plugin.onSettingsChanged(listener),
            scheduleMemoryExtractionAfterChatTurn: (conversationId, turnCount) =>
                plugin.scheduleMemoryExtractionAfterChatTurn(conversationId, turnCount),
            openMemorySettings: (claimId) => plugin.openMemorySettings(claimId),
            completeAISetup: (input) => plugin.completeAISetup(input),
        },
        writingStyleRuntime: {
            getCoordinator: () => plugin.memoryGovernanceCoordinator ?? undefined,
            isOwnerCurrent: () => plugin.unloading !== true,
            isRuntimeEnabled: (coordinator) => plugin.unloading !== true
                && plugin.memoryGovernanceCoordinator === coordinator
                && plugin.settings.memoryEnabled === true
                && plugin.getMemoryGovernanceUiMode() === "effect_based",
            canManage: (coordinator) => plugin.unloading !== true
                && plugin.memoryGovernanceCoordinator === coordinator
                && plugin.getMemoryGovernanceUiMode() === "effect_based",
            getStateSnapshot: () => {
                const snapshot = plugin.getGovernedMemoryProjectionSnapshot();
                return snapshot && snapshot.state.commitSequence >= plugin.deviceMemoryCacheRefreshTargetSequence
                    ? snapshot
                    : null;
            },
            verifyNoteSource: async (ref, signal) => {
                const denied = { allowed: false, isCurrent: () => false };
                if (!ref.contentHash) return denied;
                const epoch = plugin.getMemoryGraphTopologyEpoch("chat");
                const source = await plugin.captureLatestMemorySource(
                    ref.path,
                    (path: string) => plugin.isMemoryProviderPathAllowed(path),
                    "chat",
                    signal,
                );
                if (!source || await hashWritingText(source.markdown) !== ref.contentHash) return denied;
                const file = plugin.app.vault.getAbstractFileByPath(source.path);
                if (!(file instanceof TFile)) return denied;
                const isCurrent = () => plugin.unloading !== true
                    && plugin.getMemoryGraphTopologyEpoch("chat") === epoch
                    && plugin.app.vault.getAbstractFileByPath(source.path) === file
                    && file.stat.mtime === source.mtime
                    && file.stat.size === source.size
                    && plugin.isMemoryProviderPathAllowed(file.path);
                return { allowed: !signal?.aborted && isCurrent(), isCurrent };
            },
        },
        writingRecovery: {
            isMemoryEnabled: () => plugin.settings.memoryEnabled === true,
            verifyNote: (ref, memory) => plugin.verifyWritingRecoveryNote(ref, memory),
            verifyGenerationSource: (source) => plugin.verifyWritingRecoveryGenerationSource(source),
        },
        isChatRuntimeCurrent: () => plugin.unloading !== true,
        log: (message, detail) => plugin.log(message, detail),
    });
}

export function createPluginHarness(options: PluginHarnessOptions = {}): PluginHarness {
    const { initialData = null, secretStorageValues = {}, configDir = ".obsidian" } = options;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plugin = Object.create(PluginManager.prototype) as any;
    plugin.settingsPersistence = plugin.createSettingsPersistence();
    plugin.aiConfiguration = plugin.createAIConfiguration();
    plugin.governanceStorage = plugin.createGovernanceStorage();
    plugin.governanceActions = plugin.createGovernanceActions();
    let persistedText = initialData === null ? null : JSON.stringify(initialData);
    const temporaryFiles = new Map<string, string>();
    let beforeCopy: (() => void) | null = null;
    let beforeProcess: (() => void) | null = null;
    let beforeRead: (() => void) | null = null;

    const missingFileError = () => Object.assign(new Error("data.json is missing"), { code: "ENOENT" });
    const existingFileError = () => Object.assign(new Error("data.json already exists"), { code: "EEXIST" });

    const adapter = {
        read: jest.fn(async () => {
            const callback = beforeRead;
            beforeRead = null;
            callback?.();
            if (persistedText === null) throw missingFileError();
            return persistedText;
        }),
        write: jest.fn(async (path: string, data: string) => {
            temporaryFiles.set(path, data);
        }),
        copy: jest.fn(async (sourcePath: string, _destinationPath: string) => {
            beforeCopy?.();
            beforeCopy = null;
            if (persistedText !== null) throw existingFileError();
            const source = temporaryFiles.get(sourcePath);
            if (source === undefined) throw missingFileError();
            persistedText = source;
        }),
        remove: jest.fn(async (path: string) => {
            temporaryFiles.delete(path);
        }),
        process: jest.fn(async (_path: string, mutate: (data: string) => string) => {
            const callback = beforeProcess;
            beforeProcess = null;
            callback?.();
            if (persistedText === null) throw missingFileError();
            persistedText = mutate(persistedText);
            return persistedText;
        }),
    };

    const secrets = new Map<string, string | null>(Object.entries(secretStorageValues));
    const secretStorage = {
        getSecret: jest.fn((id: string) => secrets.get(id) ?? null),
        setSecret: jest.fn((id: string, value: string) => { secrets.set(id, value); }),
    };

    plugin.app = {
        vault: { configDir, adapter },
        secretStorage,
    };
    plugin.manifest = {
        id: "personal-assistant",
        dir: `${configDir}/plugins/personal-assistant`,
    };
    plugin.loadData = jest.fn(async () => (
        persistedText === null ? null : JSON.parse(persistedText)
    ));
    plugin.saveData = jest.fn(async (next: unknown) => {
        persistedText = JSON.stringify(next);
    });
    plugin.log = jest.fn();
    plugin.settingsSaveTail = null;
    plugin.settingsChangeListeners = new Set();
    plugin.settingsMigrationBaselineFingerprint = null;
    plugin.token = "";
    plugin.tokenCacheState = "unknown";
    plugin.unloading = false;
    plugin.settings = { ...DEFAULT_SETTINGS };
    plugin.memoryIntegration = plugin.createMemoryIntegration();
    plugin.sourceAccess = new SourceAccess({
        app: {
            get vault() { return plugin.app.vault; },
            get metadataCache() { return plugin.app.metadataCache; },
        },
        getSettings: () => ({
            dataBoundary: plugin.settings.dataBoundary,
            memoryExcludePrefixes: plugin.settings.vssCacheExcludePath,
            pagelet: plugin.settings.pagelet,
        }),
        log: (message, detail) => plugin.log(message, detail),
    });
    plugin.vaultEventBridge = new VaultEventBridge({
        registerEvent: (eventRef) => plugin.registerEvent(eventRef),
        onMetadataEvent: (event, callback) => event === "resolved"
            ? plugin.app.metadataCache.on("resolved", callback)
            : plugin.app.metadataCache.on("changed", callback),
        onVaultEvent: (event, callback) => {
            if (event === "create") return plugin.app.vault.on("create", callback);
            if (event === "modify") return plugin.app.vault.on("modify", callback);
            if (event === "rename") return plugin.app.vault.on("rename", callback);
            return plugin.app.vault.on("delete", callback);
        },
        onWorkspaceActiveLeafChange: (callback) => plugin.app.workspace.on("active-leaf-change", callback),
        onWorkspaceFileOpen: (callback) => plugin.app.workspace.on("file-open", callback),
        invalidateVaultInsightsSource: (file, oldPath) => plugin.invalidateVaultInsightsSourceForFile(file, oldPath),
        invalidateMemoryGraphTopology: () => plugin.sourceAccess.invalidateMemoryGraphTopology(),
        getVss: () => plugin.vss,
        getMemoryManager: () => plugin.memoryManager,
        getMemoryExtractionScheduler: () => plugin.memoryExtractionScheduler,
        isRecentPageletSelfWrite: (path) => plugin.pageletRuntime?.isRecentSelfWrite(path) === true,
        scheduleMemoryStatus: () => plugin.memoryStatusNotifier.schedule(),
    });
    plugin.quietRecallIntegration = new QuietRecallPluginIntegration({
        app: {
            get workspace() { return plugin.app.workspace; },
            get vault() { return plugin.app.vault; },
            get metadataCache() { return plugin.app.metadataCache; },
        },
        source: plugin.sourceAccess,
        getSettings: () => ({
            provider: plugin.settings.aiProvider,
            providerPreset: plugin.settings.aiProviderPreset ?? null,
            model: plugin.settings.chatModelName,
            embeddingModel: plugin.settings.embeddingModelName,
            endpoint: plugin.settings.baseURL,
            quietRecall: plugin.settings.quietRecall,
            pagelet: plugin.settings.pagelet,
            retrievalHabitProfile: plugin.settings.retrievalHabitProfile,
            savedInsights: plugin.settings.savedInsights.items,
        }),
        getLocale: () => plugin.getPageletLocale(),
        getDataBoundaryFingerprint: () => plugin.getMemoryDataBoundaryFingerprint(),
        isRuntimeCurrent: () => !plugin.unloading,
        isMemorySearchReady: () => plugin.isPageletMemorySearchReady(),
        findRelatedNotes: (activePath, contents, excludedPaths, options) => plugin.findPageletRelatedNotes(
            activePath,
            contents,
            excludedPaths,
            options,
        ),
        getGraphDiscoveryBacklinkMap: () => plugin.buildGraphDiscoveryBacklinkMap(),
        getResolvedOutgoingLinks: (path) => plugin.getResolvedOutgoingLinks(path),
        getGraphDiscoveryLinks: (file) => plugin.getGraphDiscoveryLinks(file),
        getProviderCallAdmission: () => plugin.getPageletProviderCallAdmission(),
        getCostTracker: () => plugin.pageletCostTracker,
        createRateLimitStorage: () => plugin.createPageletRateLimitStorage(
            "quiet-recall",
            plugin.pageletVaultStorageScope(),
        ),
        getVaultStorageScope: () => plugin.pageletVaultStorageScope(),
        getRateLimitStorageKey: (scope) => plugin.pageletRateLimitStorageKey("quiet-recall", scope),
        getAISetupIssue: () => plugin.getAISetupIssue(),
        createModel: (temperature, options) => plugin.createChatModel(temperature, options),
        listSavedInsights: () => plugin.listSavedInsights(),
        createSavedInsight: (input) => plugin.getSavedInsightStore().create(input),
        confirmLink: (input) => confirmUserAction(plugin.app, input),
        addRelatedLink: (currentPath, candidatePath) => addPaRelatedLink(
            plugin.app,
            currentPath,
            candidatePath,
        ),
        recordFeedback: (candidate, feedback) => plugin.getRetrievalHabitProfileStore()
            .recordRecallFeedback(candidate, feedback),
        log: (message, detail) => plugin.log(message, detail),
    });
    plugin.scopeRecapIntegration = new ScopeRecapPluginIntegration({
        app: {
            get workspace() { return plugin.app.workspace; },
            get vault() { return plugin.app.vault; },
        },
        source: plugin.sourceAccess,
        getSettings: () => ({
            provider: plugin.settings.aiProvider,
            providerPreset: plugin.settings.aiProviderPreset ?? null,
            model: plugin.settings.chatModelName,
            embeddingModel: plugin.settings.embeddingModelName,
            endpoint: plugin.settings.baseURL,
            pagelet: plugin.settings.pagelet,
            mergedPagelet: plugin.sourceAccess.getPageletSettingsWithDataBoundary(),
        }),
        getDataBoundaryFingerprint: () => plugin.getMemoryDataBoundaryFingerprint(),
        isRuntimeCurrent: () => !plugin.unloading,
        getProviderCallAdmission: () => plugin.getPageletProviderCallAdmission(),
        getCostTracker: () => plugin.pageletCostTracker,
        createRateLimitStorage: () => plugin.createPageletRateLimitStorage(
            "scope-recap",
            plugin.pageletVaultStorageScope(),
        ),
        getVaultStorageScope: () => plugin.pageletVaultStorageScope(),
        getRateLimitStorageKey: (scope) => plugin.pageletRateLimitStorageKey("scope-recap", scope),
        createModel: (temperature, options) => plugin.createChatModel(temperature, options),
        log: (message, detail) => plugin.log(message, detail),
    });
    plugin.deepDiscoverIntegration = new DeepDiscoverPluginIntegration({
        app: {
            get vault() { return plugin.app.vault; },
        },
        source: {
            isPageletProviderPathAllowed: (path) => plugin.isPageletProviderPathAllowed(path),
            isMemoryProviderPathAllowed: (path) => plugin.isMemoryProviderPathAllowed(path),
            isPageletProviderSourceAllowedFile: (file, markdown) => plugin.isPageletProviderSourceAllowedFile(file, markdown),
            captureLatestMemorySource: (path, isPathAllowed, consumer, signal) => plugin.captureLatestMemorySource(
                path,
                isPathAllowed,
                consumer,
                signal,
            ),
        },
        graph: {
            getMemoryGraphTopologyEpoch: () => plugin.getMemoryGraphTopologyEpoch("pagelet"),
            createMemoryGraphBoundarySnapshotSource: () => plugin.createMemoryGraphBoundarySnapshotSource("pagelet"),
            getResolvedOutgoingLinks: (path) => plugin.getResolvedOutgoingLinks(path),
            buildGraphDiscoveryBacklinkMap: () => plugin.buildGraphDiscoveryBacklinkMap(),
        },
        getPolicySnapshot: () => ({
            pagelet: plugin.sourceAccess.getPageletSettingsWithDataBoundary(),
            provider: plugin.settings.aiProvider,
            providerPreset: plugin.settings.aiProviderPreset ?? null,
            endpoint: plugin.settings.baseURL,
            webSearchEnabled: plugin.settings.webSearchEnabled === true,
            licenseTier: plugin.settings.licenseTier,
            platform: "desktop" as const,
            retrievalOptimizationFlags: plugin.getEffectiveRetrievalOptimizationFlags(),
            chatModel: plugin.settings.chatModelName,
            policyModel: plugin.settings.policyModelName,
            embeddingModel: plugin.settings.embeddingModelName,
            qwenThinkingEnabled: plugin.settings.qwenThinkingEnabled === true,
            locale: plugin.getPageletLocale(),
        }),
        getDataBoundaryFingerprint: () => plugin.getMemoryDataBoundaryFingerprint(),
        createLiveHost: () => plugin.createAiServiceHost("pagelet"),
        isRuntimeCurrent: () => !plugin.unloading,
        isPageletEnabled: () => plugin.settings.pagelet?.enabled === true,
        getBackgroundDiscoveryState: () => ({
            enabled: plugin.isBackgroundDiscoveryEnabled(),
            epoch: plugin.backgroundDiscoveryEpoch ?? 0,
        }),
        ensureAIConfigured: () => plugin.ensureAIConfigured(),
        getAISetupIssue: () => plugin.getAISetupIssue(),
        getAPIToken: () => plugin.getAPIToken(),
        getProviderCallAdmission: () => plugin.getPageletProviderCallAdmission(),
        getCostTracker: () => plugin.pageletCostTracker,
        acquirePageletTurnLease: (signal) => plugin.agentRunCoordinator.acquirePageletTurnLease(signal),
        createRateLimitStorage: (vaultStorageScope) => plugin.createPageletRateLimitStorage(
            "deep-discover",
            vaultStorageScope,
        ),
        getVaultStorageScope: () => plugin.pageletVaultStorageScope(),
        getRateLimitStorageKey: (scope) => plugin.pageletRateLimitStorageKey("deep-discover", scope),
        createAttentionStorage: () => plugin.createPageletAttentionStorage(),
        log: (message, detail) => plugin.log(message, detail),
    });
    plugin.retainedReviewIntegration = new RetainedReviewPluginIntegration({
        app: {
            get vault() { return plugin.app.vault; },
            get workspace() { return plugin.app.workspace; },
        },
        source: {
            isPageletProviderSourceAllowedFile: (file, markdown) => plugin.isPageletProviderSourceAllowedFile(file, markdown),
        },
        getSettings: () => ({
            pagelet: plugin.settings.pagelet,
            mergedPagelet: plugin.sourceAccess.getPageletSettingsWithDataBoundary(),
            provider: plugin.settings.aiProvider,
            model: plugin.settings.chatModelName,
            embeddingModel: plugin.settings.embeddingModelName,
        }),
        getLocale: () => plugin.getPageletLocale(),
        isRuntimeCurrent: () => !plugin.unloading,
        getScopeRecapAuthorizationContextId: () => plugin.getScopeRecapAuthorizationContextId(),
        getScopeRecapProviderInfo: () => plugin.getScopeRecapProviderInfo(),
        getProviderCallAdmission: () => plugin.getPageletProviderCallAdmission(),
        getCostTracker: () => plugin.pageletCostTracker,
        requestHighRiskDecision: (summary, signal) => plugin.requestForegroundReviewHighRiskDecision(summary, signal),
        getVaultStorageScope: () => plugin.pageletVaultStorageScope(),
        createRateLimitStorage: (scope) => plugin.createPageletRateLimitStorage("foreground-review", scope),
        getRateLimitStorageKey: (scope) => plugin.pageletRateLimitStorageKey("foreground-review", scope),
        findRelatedNotes: (primarySourcePath, noteContents, sourcePaths, options) => plugin.findPageletRelatedNotes(
            primarySourcePath,
            noteContents,
            sourcePaths,
            options,
        ),
        createChatModel: (temperature, options) => plugin.createChatModel(temperature, options),
        log: (message, detail) => plugin.log(message, detail),
    });
    plugin.pageletOperationsIntegration = new PageletOperationsPluginIntegration({
        vault: {
            get read() { return plugin.app.vault.read.bind(plugin.app.vault); },
            get getAbstractFileByPath() { return plugin.app.vault.getAbstractFileByPath.bind(plugin.app.vault); },
        },
        isOperationsAgentEnabled: () => plugin.isOperationsAgentEnabled,
        isPathAllowed: (path) => plugin.isPageletProviderPathAllowed(path),
        createSession: (options) => plugin.getOperationsService().createSession(options),
        now: () => Date.now(),
        log: (message, detail) => plugin.log(message, detail),
    });
    plugin.pageletIntegration = new PageletFeatureIntegration({
        createFeatureScope: () => plugin.createPageletFeatureScope(),
        releaseFeatureScope: (expectedScope) => plugin.releasePageletFeatureScope(expectedScope),
        isFeatureScopeCurrent: (scope) => plugin.isPageletFeatureScopeCurrent(scope),
        syncDeepDiscoverIdentity: () => plugin.syncPageletDeepDiscoverControllerIdentity(),
        syncQuietRecallPolicy: () => plugin.quietRecallIntegration.syncPolicyIdentity(),
        registerCommandsOnce: () => plugin.registerPageletCommandsOnce(),
        registerFocusCommandOnce: () => plugin.registerPageletFocusCommandOnce(),
        createOrchestrator: (featureScope) => new PageletOrchestrator(
            plugin.createPageletHost(featureScope),
        ),
        stopDeepDiscover: () => plugin.deepDiscoverIntegration.resetForFeatureDisable(),
        disposeDeepDiscoverFeatureResources: () => plugin.deepDiscoverIntegration.disposeFeature(),
        invalidateRetainedReviewLimiter: () => plugin.retainedReviewIntegration.invalidateLimiter(),
        disposeScopeRecap: () => plugin.scopeRecapIntegration.dispose(),
        disposeQuietRecall: () => plugin.quietRecallIntegration.dispose(),
        retireOperations: () => plugin.pageletOperationsIntegration.disposeFeature(),
        createRuntime: () => null,
        log: (message, detail) => plugin.log(message, detail),
    });
    installChatPluginIntegration(plugin);

    return {
        plugin,
        adapter,
        secretStorage,
        readPersisted: () => persistedText === null ? null : JSON.parse(persistedText),
        writePersisted: (next) => { persistedText = JSON.stringify(next); },
        beforeNextCopy: (callback) => { beforeCopy = callback; },
        beforeNextProcess: (callback) => { beforeProcess = callback; },
        beforeNextRead: (callback) => { beforeRead = callback; },
    };
}
