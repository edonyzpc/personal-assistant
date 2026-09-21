import { normalizePath, Platform, TFile } from "obsidian";

import {
    AIUtils,
    isDashScopeCompatibleBaseURL,
    type CreateChatModelOptions,
    type QwenRequestOptions,
} from "../ai-services/ai-utils";
import { stableStringify } from "../ai-services/agent-utils";
import {
    getBailianWebSearchEndpointForBaseURL,
} from "../ai-services/chat-service";
import { probeDashScopeFunctionCalling } from "./agent/dashscope-model-capability";
import {
    BuiltinWebSearchProvider,
    createBailianWebSearchNetworkPolicy,
    requestBailianWebSearchMcp,
} from "../ai-services/builtin-web-search-provider";
import type {
    AgentCapability,
    AgentRuntimePlatform,
} from "../ai-services/capability-types";
import {
    MemorySearchTool,
    createRelaxedMemorySearchInvocation,
    createStandardMemorySearchInvocation,
    runWithMemorySearchInvocation,
} from "../ai-services/memory-search-tool";
import type { AiServiceHost } from "../ai-services/AiServiceHost";
import type { AgentRunLease } from "../ai-services/agent-run-coordinator";
import type { GraphBoundarySnapshotSource } from "../graph/graph-boundary-snapshot";
import { getPlatformLocalStorage } from "../platform-dom";
import { stableHash } from "../pa/helpers";
import type { PageletCostEntry, PageletCostTracker } from "./pa-review-cost";
import { PageletRateLimiter, type PageletRateLimitStorage } from "./pa-review-rate-limit";
import type { PageletProviderCallAdmission } from "./provider-call-admission";
import {
    PageletDeepDiscoverController,
    PageletDeepDiscoverScheduler,
    PageletDeepDiscoverSmokeEvidenceStore,
    anchorSnapshotIdentity,
    capturePageletAnchorSnapshot,
    capturePageletSourceMaterial,
    createPageletAgentCacheIdentity,
    createPageletInsightCollectionId,
    createPageletInsightId,
    createPageletAgentRuntime,
    createPageletNativeModel,
    pageletAgentInsightToDeliveryCandidate,
    hashPageletInsightBody,
    hashPageletInsightClaim,
    normalizePageletInsightClaim,
    pageletAgentPolicyIdentityKey,
    pageletDeepDiscoverCommitSealIsCurrent,
    type PageletAgentPolicyIdentity,
    type PageletAgentDeliveryCandidate,
    type PageletAgentSourceSnapshot,
    type PageletAgentSourceMaterial,
    type PageletAgentVerifiedInsightCollection,
    type PageletAnchorSnapshot,
    type PageletDeepDiscoverCommitSeal,
    type PageletDeepDiscoverControllerRequest,
    type PageletDeepDiscoverControllerResult,
    type PageletDeepDiscoverSmokeSnapshot,
} from "./agent";
import { AttentionAwareDeliveryStore } from "./attention";
import { resolveB125RetrievalOptimizationFlags } from "../retrieval-optimization-platform-policy";

export const DEEP_DISCOVER_CALL_LIMITS = Object.freeze({ hourly: 12, daily: 36 });

export interface DeepDiscoverSourceCapability {
    isPageletProviderPathAllowed(path: string): boolean;
    isMemoryProviderPathAllowed(path: string): boolean;
    isPageletProviderSourceAllowedFile(file: TFile, markdown?: string): boolean;
    captureLatestMemorySource(
        path: string,
        isPathAllowed: (path: string) => boolean,
        consumer: "pagelet",
        signal?: AbortSignal,
    ): Promise<import("../plugin/source-access").LatestMemorySource | null>;
}

export interface DeepDiscoverGraphCapability {
    getMemoryGraphTopologyEpoch(): string;
    createMemoryGraphBoundarySnapshotSource(): GraphBoundarySnapshotSource | undefined;
    getResolvedOutgoingLinks(path: string): string[];
    buildGraphDiscoveryBacklinkMap(): Map<string, string[]>;
}

export interface DeepDiscoverPolicySnapshot {
    pagelet: {
        excludedFolders: string[];
        excludedTags: string[];
        excludedPatterns: string[];
        reviewsFolder: string;
    };
    provider: string;
    providerPreset: string | null;
    endpoint: string;
    webSearchEnabled: boolean;
    licenseTier: string;
    platform: AgentRuntimePlatform;
    retrievalOptimizationFlags: ReturnType<typeof resolveB125RetrievalOptimizationFlags>;
    chatModel: string;
    policyModel: string;
    embeddingModel: string;
    qwenThinkingEnabled: boolean;
    locale: "zh" | "en";
}

export interface DeepDiscoverCostRecorder {
    record(entry: Parameters<PageletCostTracker["record"]>[0]): PageletCostEntry;
}

export interface DeepDiscoverAttentionStorage {
    load(): string | null;
    save(state: string): void;
}

export interface DeepDiscoverPluginIntegrationDependencies {
    app: {
        vault: {
            getAbstractFileByPath(path: string): unknown;
        };
    };
    source: DeepDiscoverSourceCapability;
    graph: DeepDiscoverGraphCapability;
    getPolicySnapshot(): DeepDiscoverPolicySnapshot;
    getDataBoundaryFingerprint(): string;
    createLiveHost(): AiServiceHost;
    isRuntimeCurrent(): boolean;
    isPageletEnabled(): boolean;
    getBackgroundDiscoveryState(): { enabled: boolean; epoch: number };
    ensureAIConfigured(): boolean;
    getAISetupIssue(): string | null;
    getAPIToken(): Promise<string>;
    getProviderCallAdmission(): PageletProviderCallAdmission;
    getCostTracker(): DeepDiscoverCostRecorder;
    acquirePageletTurnLease(signal?: AbortSignal): AgentRunLease | PromiseLike<AgentRunLease>;
    createRateLimitStorage(vaultStorageScope: string | null): PageletRateLimitStorage;
    getVaultStorageScope(): string | null;
    getRateLimitStorageKey(vaultStorageScope: string | null): string;
    createAttentionStorage(): DeepDiscoverAttentionStorage | null | undefined;
    log(message: string, detail?: unknown): void;
}

function normalizeDeepDiscoverUsageCount(value: unknown): number {
    return typeof value === "number"
        && Number.isSafeInteger(value)
        && value >= 0
        ? value
        : 0;
}

function createPageletProviderAbortError(): Error {
    const error = new Error("Pagelet provider call aborted");
    error.name = "PageletProviderCallAbortError";
    return error;
}

export class DeepDiscoverPluginIntegration {
    private rateLimiter: PageletRateLimiter | null = null;
    private attentionStore: AttentionAwareDeliveryStore | null = null;
    private smokeEvidence: PageletDeepDiscoverSmokeEvidenceStore | undefined =
        new PageletDeepDiscoverSmokeEvidenceStore();
    private scheduler: PageletDeepDiscoverScheduler | null = null;
    private controllerPolicyIdentitySnapshot: string | null = null;
    private initialization: Promise<PageletDeepDiscoverScheduler | null> | null = null;
    private initializationIdentity: string | null = null;
    private controllerEpoch = 0;

    constructor(private readonly dependencies: DeepDiscoverPluginIntegrationDependencies) {}

    getSmokeEvidence(): PageletDeepDiscoverSmokeEvidenceStore {
        return (this.smokeEvidence ??= new PageletDeepDiscoverSmokeEvidenceStore());
    }

    getSmokeSnapshot(): Promise<PageletDeepDiscoverSmokeSnapshot | null> {
        return this.getSmokeEvidence().snapshot();
    }

    async validateInsight(
        identity: Parameters<PageletDeepDiscoverScheduler["validateInsight"]>[0],
        signal?: AbortSignal,
    ): Promise<boolean> {
        if (
            !this.scheduler
            || this.controllerPolicyIdentitySnapshot !== this.getPolicyIdentityKey()
        ) return false;
        return await this.scheduler.validateInsight(identity, signal);
    }

    acknowledgeOrchestratorResult(
        result: PageletDeepDiscoverControllerResult,
        acceptedCandidates: readonly PageletAgentDeliveryCandidate[],
    ): void {
        this.getSmokeEvidence().acknowledgeOrchestratorResult(result, acceptedCandidates);
    }

    discardOrchestratorResult(result: PageletDeepDiscoverControllerResult): void {
        this.smokeEvidence?.discardOrchestratorResult(result);
    }

    setAutomaticEnabled(enabled: boolean): void {
        this.scheduler?.setAutomaticEnabled(enabled);
    }

    resetForFeatureDisable(): void {
        this.resetController();
    }

    disposeFeature(): void {
        this.rateLimiter = null;
    }

    getRateLimiter(): PageletRateLimiter {
        if (!this.rateLimiter) {
            const vaultStorageScope = this.dependencies.getVaultStorageScope();
            this.rateLimiter = new PageletRateLimiter({
                storage: this.dependencies.createRateLimitStorage(vaultStorageScope),
                ...(vaultStorageScope ? {
                    coordinationKey: this.dependencies.getRateLimitStorageKey(vaultStorageScope),
                } : {}),
                config: {
                    hourlyCap: DEEP_DISCOVER_CALL_LIMITS.hourly,
                    dailyCap: DEEP_DISCOVER_CALL_LIMITS.daily,
                },
            });
        }
        return this.rateLimiter;
    }

    async runPageletDeepDiscover(
        input: PageletDeepDiscoverControllerRequest,
    ): Promise<PageletDeepDiscoverControllerResult> {
        const automaticEpoch = this.dependencies.getBackgroundDiscoveryState().epoch;
        const isAutomaticRequestCurrent = () => input.triggerReason === "explicit" || (
            this.dependencies.getBackgroundDiscoveryState().enabled
            && automaticEpoch === (this.dependencies.getBackgroundDiscoveryState().epoch)
            && input.isAutomaticRequestCurrent?.() !== false
        );
        // Only a new forced foreground attempt invalidates older smoke
        // evidence. Automatic runs are product work, not smoke candidates.
        if (input.triggerReason === "explicit" && input.force === true) {
            this.smokeEvidence?.clear();
        }
        if (input.signal?.aborted) return { status: "quiet", reason: "aborted" };
        if (
            !this.dependencies.isRuntimeCurrent()
            || !this.dependencies.isPageletEnabled()
            || !isAutomaticRequestCurrent()
        ) {
            return { status: "limit", reason: "unavailable" };
        }

        // Startup deliberately leaves SecretStorage unread so passive Pagelet
        // work cannot surface a Keychain prompt. A user-triggered Pagelet run
        // is an explicit provider action, though, and must resolve the retained
        // token exactly as Chat and manual Memory actions do. Automatic runs
        // stay silent and fail closed until another explicit surface has
        // established readiness.
        if (input.triggerReason === "explicit") {
            if (!this.dependencies.ensureAIConfigured()) {
                return { status: "limit", reason: "unavailable" };
            }
        } else if (this.dependencies.getAISetupIssue() !== null) {
            return { status: "limit", reason: "unavailable" };
        }

        const path = normalizePath(input.path);
        if (!this.dependencies.source.isPageletProviderPathAllowed(path)) {
            return { status: "denied", reason: "data-boundary" };
        }
        const snapshotHost = this.dependencies.createLiveHost();
        const anchorSnapshot = await this.captureAnchorSnapshot(
            snapshotHost,
            path,
            (candidatePath) => this.dependencies.source.isPageletProviderPathAllowed(candidatePath),
            input.signal,
        );
        if (!anchorSnapshot) {
            return { status: "stale", reason: "anchor-snapshot-unavailable" };
        }
        if (input.signal?.aborted) return { status: "quiet", reason: "aborted" };
        if (!isAutomaticRequestCurrent()) return { status: "quiet", reason: "aborted" };
        const scheduler = await this.getOrCreateScheduler();
        if (!scheduler) return { status: "limit", reason: "unavailable" };
        if (!isAutomaticRequestCurrent()) return { status: "quiet", reason: "aborted" };

        const request: PageletDeepDiscoverControllerRequest = {
            ...input,
            path,
            anchorSnapshot,
            ...(input.triggerReason !== "explicit" ? { isAutomaticRequestCurrent } : {}),
        };
        if (input.triggerReason === "explicit") {
            return scheduler.runNow({
                ...request,
                force: true,
            });
        }
        return scheduler.schedule(request);
    }

    syncControllerIdentity(): void {
        if (
            !this.dependencies.isPageletEnabled()
        ) {
            if (
                this.scheduler
                || this.initialization
            ) {
                this.resetController();
            }
            return;
        }
        const identity = this.getPolicyIdentityKey();
        if (
            (
                this.controllerPolicyIdentitySnapshot !== null
                && this.controllerPolicyIdentitySnapshot !== identity
            )
            || (
                this.initializationIdentity !== null
                && this.initializationIdentity !== identity
            )
        ) {
            this.resetController();
        }
        this.scheduler?.setAutomaticEnabled(this.dependencies.getBackgroundDiscoveryState().enabled);
    }

    resetController(): void {
        this.controllerEpoch += 1;
        this.smokeEvidence?.clear();
        this.scheduler?.dispose();
        this.scheduler = null;
        this.controllerPolicyIdentitySnapshot = null;
        this.initialization = null;
        this.initializationIdentity = null;
    }

    async getOrCreateScheduler(): Promise<PageletDeepDiscoverScheduler | null> {
        if (this.dependencies.getAISetupIssue() !== null) return null;
        const identity = this.getPolicyIdentityKey();
        if (
            this.scheduler
            && this.controllerPolicyIdentitySnapshot === identity
        ) {
            this.scheduler.setAutomaticEnabled(this.dependencies.getBackgroundDiscoveryState().enabled);
            return this.scheduler;
        }
        if (
            this.scheduler
            || (
                this.initializationIdentity !== null
                && this.initializationIdentity !== identity
            )
        ) {
            this.resetController();
        }
        if (
            this.initialization
            && this.initializationIdentity === identity
        ) {
            return this.initialization;
        }

        const epoch = this.controllerEpoch;
        const initialization = this.createScheduler(identity, epoch)
            .catch((error) => {
                this.dependencies.log("Pagelet Deep Discover runtime initialization failed", {
                    errorType: error instanceof Error ? error.name : "unknown",
                });
                return null;
            });
        this.initialization = initialization;
        this.initializationIdentity = identity;
        try {
            const scheduler = await initialization;
            if (!scheduler) return null;
            if (
                epoch !== this.controllerEpoch
                || !this.dependencies.isRuntimeCurrent()
                || !this.dependencies.isPageletEnabled()
                || identity !== this.getPolicyIdentityKey()
            ) {
                scheduler.dispose();
                return null;
            }
            this.scheduler = scheduler;
            scheduler.setAutomaticEnabled(this.dependencies.getBackgroundDiscoveryState().enabled);
            this.controllerPolicyIdentitySnapshot = identity;
            return scheduler;
        } finally {
            if (this.initialization === initialization) {
                this.initialization = null;
                this.initializationIdentity = null;
            }
        }
    }

    async createScheduler(
        expectedPolicyIdentity: string,
        controllerEpoch: number,
    ): Promise<PageletDeepDiscoverScheduler | null> {
        const liveHost = this.dependencies.createLiveHost();
        const isPageletMemoryPathAllowed = (path: string) => (
            this.dependencies.source.isMemoryProviderPathAllowed(path)
            && this.dependencies.source.isPageletProviderPathAllowed(path)
        );
        const runtimeHost: AiServiceHost = {
            ...liveHost,
            settings: { ...liveHost.settings },
            isDataBoundaryAllowedPath: isPageletMemoryPathAllowed,
            getMemoryEvidenceEpoch: () => this.dependencies.graph.getMemoryGraphTopologyEpoch(),
            getGraphBoundarySnapshotSource: () => this.dependencies.graph.createMemoryGraphBoundarySnapshotSource(),
            readLatestMemorySource: (path, signal) => this.dependencies.source.captureLatestMemorySource(
                path,
                isPageletMemoryPathAllowed,
                "pagelet",
                signal,
            ),
        };
        const aiUtils = new AIUtils(runtimeHost);
        const runtimePlatform: AgentRuntimePlatform = Platform.isMobile
            ? "mobile"
            : "desktop";
        const webCapabilities = await this.loadWebCapabilities(
            aiUtils,
            runtimeHost,
            runtimePlatform,
        );
        const memorySearch = new MemorySearchTool(runtimeHost, aiUtils, "pagelet");
        const providerResponseDelivery = aiUtils
            .resolveChatTransport("native")
            .responseDelivery;
        const qwenRequestOptions = this.qwenRequestOptions(
            runtimeHost.settings,
        );
        const isPathAllowed = isPageletMemoryPathAllowed;
        const handleRuntimeResult = this.createRuntimeResultHandler(runtimeHost);
        const runtime = createPageletAgentRuntime({
            host: runtimeHost,
            providerResponseDelivery,
            createModel: (context) => createPageletNativeModel({
                registry: context.registry,
                allowedToolNames: context.allowedToolNames,
                schemas: context.schemas,
                toolDefinitions: context.toolDefinitions,
                providerRequestScope: context.providerRequestScope,
                bindVaultObservationProjection: context.bindVaultObservationProjection,
                recordPromptProjection: context.recordPromptProjection,
                createChatModel: (temperature, requestOptions) => (
                    this.createChatModel(
                        aiUtils,
                        runtimeHost.settings,
                        qwenRequestOptions,
                        temperature,
                        requestOptions,
                    )
                ),
                signal: context.signal,
            }),
            executeMemorySearch: (input, context, control) => {
                const signal = context.signal ?? new AbortController().signal;
                return runWithMemorySearchInvocation(
                    createStandardMemorySearchInvocation({
                        temporalIntent: "none",
                        captureRecoverySeed:
                            resolveB125RetrievalOptimizationFlags(
                                runtimeHost.getRetrievalOptimizationFlags?.()
                                ?? runtimeHost.settings.retrievalOptimizationFlags,
                            ).relaxedRecovery,
                        ...(control?.runEpoch ? { runEpoch: control.runEpoch } : {}),
                        ...(control?.absoluteDeadlineMs !== undefined
                            ? { absoluteDeadlineMs: control.absoluteDeadlineMs }
                            : {}),
                        ...(control?.providerRequestScope
                            ? { providerRequestScope: control.providerRequestScope }
                            : {}),
                        ...(control?.memoryPreparationOwnerSignal
                            ? { memoryPreparationOwnerSignal: control.memoryPreparationOwnerSignal }
                            : {}),
                    }),
                    signal,
                    () => memorySearch.search(
                        input.query,
                        signal,
                        context.onBeforeVssSearch,
                    ),
                );
            },
            executeRelaxedMemorySearch: (seed, context, _goal, control) => {
                if (!seed.recoverySeed) return Promise.resolve(seed);
                const signal = context.signal ?? new AbortController().signal;
                return runWithMemorySearchInvocation(
                    createRelaxedMemorySearchInvocation(seed.recoverySeed, {
                        ...(control?.runEpoch ? { runEpoch: control.runEpoch } : {}),
                        ...(control?.absoluteDeadlineMs !== undefined
                            ? { absoluteDeadlineMs: control.absoluteDeadlineMs }
                            : {}),
                        ...(control?.providerRequestScope
                            ? { providerRequestScope: control.providerRequestScope }
                            : {}),
                        ...(control?.memoryPreparationOwnerSignal
                            ? { memoryPreparationOwnerSignal: control.memoryPreparationOwnerSignal }
                            : {}),
                    }),
                    signal,
                    () => memorySearch.search(
                        seed.query,
                        signal,
                        context.onBeforeVssSearch,
                    ),
                );
            },
            revalidateMemorySearch: (result, signal) => (
                memorySearch.revalidateForProvider(result, signal)
            ),
            captureSourceMaterial: (path, signal) => (
                this.captureSourceMaterial(
                    runtimeHost,
                    path,
                    isPathAllowed,
                    signal,
                )
            ),
            isPathAllowed,
            webCapabilities,
            runtimePlatform,
            turnLeaseProvider: ({ signal }) => (
                this.dependencies.acquirePageletTurnLease(signal)
            ),
        });
        const controller = new PageletDeepDiscoverController({
            runtime,
            captureSnapshot: (path, signal) => this.captureAnchorSnapshot(
                runtimeHost,
                path,
                isPathAllowed,
                signal,
            ),
            captureSourceMaterial: (path, signal) => this.captureSourceMaterial(
                runtimeHost,
                path,
                isPathAllowed,
                signal,
            ),
            getPolicyIdentity: () => this.getPolicyIdentity(),
            getEvidenceEpoch: () => runtimeHost.getMemoryEvidenceEpoch?.() ?? "",
            controllerEpoch,
            isPathAllowed,
            admitRun: (input) => this.admitRun(
                expectedPolicyIdentity,
                input,
            ),
            getAnchorRelations: (path) => this.getAnchorRelations(path),
            isSeen: (input) => this.isDeliverySeen(input),
            onRunStart: (run) => {
                this.getSmokeEvidence().begin(run);
            },
            onRunComplete: (result, _request, run) => {
                this.getSmokeEvidence().stageControllerResult(run, result);
            },
            onResult: handleRuntimeResult,
        });
        return new PageletDeepDiscoverScheduler({
            controller,
            delayMs: 3_000,
        });
    }

    async loadWebCapabilities(
        aiUtils: AIUtils,
        host: AiServiceHost,
        runtimePlatform: AgentRuntimePlatform,
    ): Promise<AgentCapability[]> {
        if (
            host.settings.aiProvider !== "qwen"
            || host.settings.webSearchEnabled !== true
            || !isDashScopeCompatibleBaseURL(host.settings.baseURL)
        ) {
            return [];
        }
        try {
            const apiKey = await aiUtils.getAPIToken();
            if (!apiKey) return [];
            const provider = new BuiltinWebSearchProvider({
                policy: createBailianWebSearchNetworkPolicy(
                    getBailianWebSearchEndpointForBaseURL(host.settings.baseURL),
                ),
                apiKey,
                request: requestBailianWebSearchMcp,
            });
            const loaded = await provider.load({
                turnId: "pagelet-deep-discover:capability-preload",
                platform: runtimePlatform,
                settings: host.settings as unknown as Record<string, unknown>,
            });
            if (loaded.status === "available") return loaded.capabilities;
            this.dependencies.log("Pagelet Deep Discover optional WebSearch unavailable", {
                providerId: provider.id,
                reason: loaded.unavailableReason,
            });
        } catch (error) {
            this.dependencies.log("Pagelet Deep Discover optional WebSearch initialization failed", {
                errorType: error instanceof Error ? error.name : "unknown",
            });
        }
        return [];
    }

    qwenRequestOptions(
        settings: AiServiceHost["settings"],
    ): QwenRequestOptions | undefined {
        if (
            settings.aiProvider !== "qwen"
            || settings.qwenThinkingEnabled !== true
            || !isDashScopeCompatibleBaseURL(settings.baseURL)
        ) {
            return undefined;
        }
        return { enableThinking: true };
    }

    async getFunctionCallingCapability(): Promise<
        "supported" | "unsupported" | "unknown"
    > {
        const { provider: aiProvider, endpoint: baseURL, chatModel: chatModelName } = this.dependencies.getPolicySnapshot();
        if (aiProvider !== "qwen" || !isDashScopeCompatibleBaseURL(baseURL)) {
            return "unknown";
        }
        try {
            return await probeDashScopeFunctionCalling({
                baseURL,
                model: chatModelName,
                apiKey: await this.dependencies.getAPIToken(),
            });
        } catch {
            return "unknown";
        }
    }

    createChatModel(
        aiUtils: Pick<AIUtils, "createChatModel">,
        settings: AiServiceHost["settings"],
        qwenRequestOptions: QwenRequestOptions | undefined,
        temperature: number,
        options: Record<string, unknown>,
    ) {
        const requestOptions = options as CreateChatModelOptions;
        return aiUtils.createChatModel(temperature, {
            ...requestOptions,
            modelName: settings.chatModelName,
            transport: "native",
            ...(qwenRequestOptions ? { qwenRequestOptions } : {}),
            providerRequestScope: requestOptions.providerRequestScope,
            onProviderRequestStart: requestOptions.onProviderRequestStart,
        });
    }

    async captureAnchorSnapshot(
        host: AiServiceHost,
        path: string,
        isPathAllowed: (path: string) => boolean,
        signal?: AbortSignal,
    ): Promise<PageletAnchorSnapshot | null> {
        const snapshot = await capturePageletAnchorSnapshot({
            host,
            path,
            isPathAllowed,
            signal,
        });
        return snapshot && this.materialIsAllowed(snapshot)
            ? snapshot
            : null;
    }

    async captureSourceMaterial(
        host: AiServiceHost,
        path: string,
        isPathAllowed: (path: string) => boolean,
        signal?: AbortSignal,
    ): Promise<PageletAgentSourceMaterial | null> {
        const material = await capturePageletSourceMaterial({
            host,
            path,
            isPathAllowed,
            signal,
        });
        return material && this.materialIsAllowed(material)
            ? material
            : null;
    }

    materialIsAllowed(material: {
        path: string;
        content: string;
        mtime: number;
        size: number;
    }): boolean {
        const file = this.dependencies.app.vault.getAbstractFileByPath(normalizePath(material.path));
        return file instanceof TFile
            && file.extension === "md"
            && file.stat.mtime === material.mtime
            && file.stat.size === material.size
            && this.dependencies.source.isPageletProviderSourceAllowedFile(file, material.content);
    }

    getPolicyIdentity(): PageletAgentPolicyIdentity {
        const pagelet = this.dependencies.getPolicySnapshot().pagelet;
        const endpoint = (this.dependencies.getPolicySnapshot().endpoint ?? "").trim().replace(/\/+$/, "");
        const platform: AgentRuntimePlatform = this.dependencies.getPolicySnapshot().platform;
        const retrievalOptimizationFlags = this.dependencies.getPolicySnapshot().retrievalOptimizationFlags;
        return {
            dataBoundaryIdentity: `pagelet-agent-boundary:${stableHash(stableStringify({
                version: 1,
                shared: this.dependencies.getDataBoundaryFingerprint(),
                excludedFolders: [...pagelet.excludedFolders].sort(),
                excludedTags: [...pagelet.excludedTags].sort(),
                excludedPatterns: [...pagelet.excludedPatterns].sort(),
                reviewsFolder: pagelet.reviewsFolder,
            }))}`,
            providerPolicyIdentity: `pagelet-agent-provider:${stableHash(stableStringify({
                version: 2,
                provider: this.dependencies.getPolicySnapshot().provider,
                providerPreset: this.dependencies.getPolicySnapshot().providerPreset ?? null,
                endpoint,
                webSearchEnabled: this.dependencies.getPolicySnapshot().webSearchEnabled === true,
                licenseTier: this.dependencies.getPolicySnapshot().licenseTier,
                platform,
                retrievalOptimizationFlags: {
                    lexicalProfile: retrievalOptimizationFlags.lexicalProfile,
                    strictReranker: retrievalOptimizationFlags.strictReranker,
                    graphPpr: retrievalOptimizationFlags.graphPpr,
                    relaxedRecovery: retrievalOptimizationFlags.relaxedRecovery,
                },
            }))}`,
            modelIdentity: `pagelet-agent-model:${stableHash(stableStringify({
                version: 1,
                model: this.dependencies.getPolicySnapshot().chatModel,
                policyModel: this.dependencies.getPolicySnapshot().policyModel,
                embeddingModel: this.dependencies.getPolicySnapshot().embeddingModel,
                qwenThinkingEnabled: this.dependencies.getPolicySnapshot().qwenThinkingEnabled === true,
            }))}`,
            locale: this.dependencies.getPolicySnapshot().locale,
        };
    }

    getPolicyIdentityKey(): string {
        return pageletAgentPolicyIdentityKey(this.getPolicyIdentity());
    }

    isCommitSealCurrent(
        seal: PageletDeepDiscoverCommitSeal,
        collection: PageletAgentVerifiedInsightCollection,
    ): boolean {
        if (
            !this.dependencies.isRuntimeCurrent()
            || !this.dependencies.isPageletEnabled()
            || !this.scheduler
            || this.controllerPolicyIdentitySnapshot === null
        ) return false;
        return pageletDeepDiscoverCommitSealIsCurrent({
            seal,
            collection,
            controllerEpoch: this.controllerEpoch,
            evidenceEpoch: this.dependencies.graph.getMemoryGraphTopologyEpoch(),
            currentPolicyIdentityKey: this.getPolicyIdentityKey(),
            controllerPolicyIdentityKey: this.controllerPolicyIdentitySnapshot,
            isPathAllowed: (path) => this.dependencies.source.isPageletProviderPathAllowed(path),
        });
    }

    async admitRun(
        expectedPolicyIdentity: string,
        input: {
            path: string;
            signal?: AbortSignal;
            force?: boolean;
            triggerReason?: PageletDeepDiscoverControllerRequest["triggerReason"];
            isAutomaticRequestCurrent?: () => boolean;
        },
    ): Promise<{ ok: true } | { ok: false; reason: "limit" | "unavailable" }> {
        if (input.signal?.aborted) throw createPageletProviderAbortError();
        if (!this.admissionIsCurrent(expectedPolicyIdentity, input)) {
            return { ok: false, reason: "unavailable" };
        }
        let decision: Awaited<ReturnType<PageletRateLimiter["reserveLeaseIf"]>>;
        try {
            decision = await this.getRateLimiter().reserveLeaseIf(() => (
                this.admissionIsCurrent(expectedPolicyIdentity, input)
            ));
        } catch (error) {
            if (input.signal?.aborted) throw createPageletProviderAbortError();
            this.dependencies.log("Pagelet Deep Discover admission storage unavailable", {
                errorType: error instanceof Error ? error.name : "unknown",
            });
            return { ok: false, reason: "unavailable" };
        }
        if (input.signal?.aborted) {
            if (decision.ok) await decision.reservation.rollback();
            throw createPageletProviderAbortError();
        }
        if (!decision.ok) {
            return {
                ok: false,
                reason: decision.reason === "condition" ? "unavailable" : "limit",
            };
        }

        const reservation = decision.reservation;
        try {
            if (!this.admissionIsCurrent(expectedPolicyIdentity, input)) {
                await reservation.rollback();
                return { ok: false, reason: "unavailable" };
            }
            await this.dependencies.getProviderCallAdmission().admitStandardCall();
            if (input.signal?.aborted) throw createPageletProviderAbortError();
            if (!this.admissionIsCurrent(expectedPolicyIdentity, input)) {
                await reservation.rollback();
                return { ok: false, reason: "unavailable" };
            }
            reservation.commit();
            return { ok: true };
        } catch (error) {
            await reservation.rollback();
            if (input.signal?.aborted) throw createPageletProviderAbortError();
            this.dependencies.log("Pagelet Deep Discover provider admission failed", {
                errorType: error instanceof Error ? error.name : "unknown",
            });
            return { ok: false, reason: "unavailable" };
        }
    }

    admissionIsCurrent(
        expectedPolicyIdentity: string,
        input: {
            path: string;
            signal?: AbortSignal;
            triggerReason?: PageletDeepDiscoverControllerRequest["triggerReason"];
            isAutomaticRequestCurrent?: () => boolean;
        },
    ): boolean {
        if (
            input.signal?.aborted
            || !this.dependencies.isRuntimeCurrent()
            || !this.dependencies.isPageletEnabled()
            || input.isAutomaticRequestCurrent?.() === false
            || (input.triggerReason !== "explicit" && !this.dependencies.getBackgroundDiscoveryState().enabled)
            || this.dependencies.getAISetupIssue() !== null
            || expectedPolicyIdentity !== this.getPolicyIdentityKey()
            || !this.dependencies.source.isPageletProviderPathAllowed(input.path)
        ) {
            return false;
        }
        return true;
    }

    getAnchorRelations(path: string): {
        explicitLinks: string[];
        backlinks: string[];
    } {
        const allowed = (candidate: string) => this.dependencies.source.isPageletProviderPathAllowed(candidate);
        return {
            explicitLinks: this.dependencies.graph.getResolvedOutgoingLinks(path).filter(allowed),
            backlinks: (this.dependencies.graph.buildGraphDiscoveryBacklinkMap().get(normalizePath(path)) ?? [])
                .filter(allowed),
        };
    }

    isDeliverySeen(input: {
        anchor: PageletAnchorSnapshot;
        body: string;
        normalizedBody: string;
        sources: readonly PageletAgentSourceSnapshot[];
        triggerReason: PageletDeepDiscoverControllerRequest["triggerReason"];
    }): boolean {
        const policyIdentity = this.getPolicyIdentity();
        const cacheIdentity = createPageletAgentCacheIdentity({
            anchor: input.anchor,
            sources: input.sources,
            policyIdentity,
        });
        const normalizedClaim = normalizePageletInsightClaim(input.body);
        const anchorIdentity = anchorSnapshotIdentity(input.anchor);
        const insightId = createPageletInsightId({
            anchor: anchorIdentity,
            normalizedBody: input.normalizedBody,
            normalizedClaim,
            sources: input.sources,
        });
        const collectionId = createPageletInsightCollectionId([insightId]);
        const candidate = pageletAgentInsightToDeliveryCandidate({
            insightId,
            collectionId,
            body: input.body,
            normalizedBody: input.normalizedBody,
            normalizedClaim,
            bodyHash: hashPageletInsightBody(input.normalizedBody),
            claimHash: hashPageletInsightClaim(normalizedClaim),
            anchor: anchorIdentity,
            sources: input.sources.map((source) => ({ ...source })),
            sourceRefs: input.sources.map((source) => ({ path: source.path })),
            cacheIdentity,
            cacheIdentityHash: "seen-probe",
            triggerReason: input.triggerReason,
            preparedAt: 0,
            metrics: {
                modelTurns: 0,
                toolCalls: 0,
                wallTimeMs: 0,
            },
            webObservations: [],
        }, this.dependencies.getPolicySnapshot().locale);
        const receipt = candidate.deliveryReceipt;
        if (!receipt) return false;
        if (!this.attentionStore) {
            const storage = this.dependencies.createAttentionStorage();
            if (!storage) return false;
            this.attentionStore = new AttentionAwareDeliveryStore({ storage });
        }
        return this.attentionStore.isSeen(receipt);
    }

    handleResult(
        result: PageletDeepDiscoverControllerResult,
        request: PageletDeepDiscoverControllerRequest,
        providerIdentity = {
            provider: this.dependencies.getPolicySnapshot().provider,
            model: this.dependencies.getPolicySnapshot().chatModel,
        },
    ): void {
        const metrics = result.status === "verified"
            ? result.insight.metrics
            : result.status === "quiet"
                ? result.metrics
                : undefined;
        if (!metrics) return;
        void this.recordUsageMetrics(metrics).catch((error) => {
            this.dependencies.log("Pagelet Deep Discover metrics persistence failed", {
                errorType: error instanceof Error ? error.name : "unknown",
            });
        });
        const inputTokens = normalizeDeepDiscoverUsageCount(metrics.tokenUsage?.inputTokens);
        const outputTokens = normalizeDeepDiscoverUsageCount(metrics.tokenUsage?.outputTokens);
        if (inputTokens > 0 || outputTokens > 0) {
            this.dependencies.getCostTracker().record({
                inputTokens,
                outputTokens,
                provider: providerIdentity.provider,
                model: providerIdentity.model,
            });
        }
        this.dependencies.log("Pagelet Deep Discover run completed", {
            status: result.status,
            triggerReason: request.triggerReason,
            modelTurns: metrics.modelTurns,
            toolCalls: metrics.toolCalls,
            wallTimeMs: metrics.wallTimeMs,
            inputTokens,
            outputTokens,
        });
    }

    async getDeepDiscoverUsage(): Promise<{
        runs: number;
        dailyCap: number;
        modelTurns: number;
        toolCalls: number;
    }> {
        const limiterState = await this.getRateLimiter().getStateSnapshot();
        const metrics = this.readUsageMetrics(limiterState.dailyResetAt);
        return {
            runs: limiterState.dailyCount,
            dailyCap: DEEP_DISCOVER_CALL_LIMITS.daily,
            modelTurns: metrics.modelTurns,
            toolCalls: metrics.toolCalls,
        };
    }

    async recordUsageMetrics(metrics: {
        modelTurns?: number;
        toolCalls?: number;
    }): Promise<void> {
        const limiterState = await this.getRateLimiter().getStateSnapshot();
        const current = this.readUsageMetrics(limiterState.dailyResetAt);
        const storage = getPlatformLocalStorage();
        const key = this.usageStorageKey();
        if (!storage || !key) return;
        storage.setItem(key, JSON.stringify({
            dailyResetAt: limiterState.dailyResetAt,
            modelTurns: current.modelTurns + normalizeDeepDiscoverUsageCount(metrics.modelTurns),
            toolCalls: current.toolCalls + normalizeDeepDiscoverUsageCount(metrics.toolCalls),
        }));
    }

    readUsageMetrics(dailyResetAt: number): {
        modelTurns: number;
        toolCalls: number;
    } {
        const storage = getPlatformLocalStorage();
        const key = this.usageStorageKey();
        if (!storage || !key) return { modelTurns: 0, toolCalls: 0 };
        try {
            const parsed = JSON.parse(storage.getItem(key) ?? "null") as {
                dailyResetAt?: unknown;
                modelTurns?: unknown;
                toolCalls?: unknown;
            } | null;
            if (!parsed || parsed.dailyResetAt !== dailyResetAt) {
                return { modelTurns: 0, toolCalls: 0 };
            }
            return {
                modelTurns: normalizeDeepDiscoverUsageCount(parsed.modelTurns),
                toolCalls: normalizeDeepDiscoverUsageCount(parsed.toolCalls),
            };
        } catch {
            return { modelTurns: 0, toolCalls: 0 };
        }
    }

    usageStorageKey(): string | null {
        const scope = this.dependencies.getVaultStorageScope();
        return scope
            ? ["pa-pagelet-deep-discover-usage", "v1", scope].join(":")
            : null;
    }

    createResultHandler(providerIdentity: {
        provider: string;
        model: string;
        endpoint: string;
    }): (result: PageletDeepDiscoverControllerResult, request: PageletDeepDiscoverControllerRequest) => void {
        return (result, request) => this.handleResult(result, request, providerIdentity);
    }

    createRuntimeResultHandler(runtimeHost: AiServiceHost): (
        result: PageletDeepDiscoverControllerResult,
        request: PageletDeepDiscoverControllerRequest,
    ) => void {
        return this.createResultHandler({
            provider: runtimeHost.settings.aiProvider,
            model: runtimeHost.settings.chatModelName,
            endpoint: runtimeHost.settings.baseURL,
        });
    }
}
