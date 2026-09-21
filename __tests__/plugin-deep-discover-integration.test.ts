import { describe, expect, it, jest } from "@jest/globals";

import {
    DeepDiscoverPluginIntegration,
    type DeepDiscoverPluginIntegrationDependencies,
} from "../src/pagelet/plugin-deep-discover";
import type { PageletDeepDiscoverScheduler } from "../src/pagelet/agent";

jest.mock("../src/pagelet/agent", () => {
    const actual = jest.requireActual<typeof import("../src/pagelet/agent")>("../src/pagelet/agent");
    return {
        ...actual,
        createPageletAgentRuntime: jest.fn(() => ({ runtime: "synthetic" })),
        PageletDeepDiscoverController: jest.fn(() => ({ controller: "synthetic" })),
    };
});

import { createPageletAgentRuntime, PageletDeepDiscoverController } from "../src/pagelet/agent";

type OwnerState = {
    rateLimiter: unknown;
    attentionStore: unknown;
    smokeEvidence: { clear: jest.Mock };
    scheduler: PageletDeepDiscoverScheduler | null;
    controllerPolicyIdentitySnapshot: string | null;
    initialization: Promise<PageletDeepDiscoverScheduler | null> | null;
    initializationIdentity: string | null;
    controllerEpoch: number;
};

const createDependencies = () => {
    const dependencies: DeepDiscoverPluginIntegrationDependencies = {
        app: {
            vault: { getAbstractFileByPath: jest.fn(() => null) },
        },
        source: {
            isPageletProviderPathAllowed: jest.fn(() => true),
            isMemoryProviderPathAllowed: jest.fn(() => true),
            isPageletProviderSourceAllowedFile: jest.fn(() => true),
            captureLatestMemorySource: jest.fn(async () => null),
        },
        graph: {
            getMemoryGraphTopologyEpoch: jest.fn(() => "graph-epoch"),
            createMemoryGraphBoundarySnapshotSource: jest.fn(() => undefined),
            getResolvedOutgoingLinks: jest.fn(() => []),
            buildGraphDiscoveryBacklinkMap: jest.fn(() => new Map()),
        },
        getPolicySnapshot: () => ({
            pagelet: {
                excludedFolders: [],
                excludedTags: [],
                excludedPatterns: [],
                reviewsFolder: ".pagelet",
            },
            provider: "openai",
            providerPreset: "openai",
            endpoint: "https://api.openai.com/v1",
            webSearchEnabled: false,
            licenseTier: "free",
            platform: "desktop" as const,
            retrievalOptimizationFlags: {
                lexicalProfile: false,
                strictReranker: false,
                graphPpr: false,
                relaxedRecovery: false,
            },
            chatModel: "gpt-4o-mini",
            policyModel: "gpt-4o-mini",
            embeddingModel: "text-embedding-3-small",
            qwenThinkingEnabled: false,
            locale: "en" as const,
        }),
        getDataBoundaryFingerprint: () => "data_boundary:test",
        createLiveHost: jest.fn(() => ({}) as never),
        isRuntimeCurrent: () => true,
        isPageletEnabled: () => true,
        getBackgroundDiscoveryState: () => ({ enabled: true, epoch: 1 }),
        ensureAIConfigured: jest.fn(() => true),
        getAISetupIssue: () => null,
        getAPIToken: jest.fn(async () => "token"),
        getProviderCallAdmission: jest.fn(() => ({} as never)),
        getCostTracker: jest.fn(() => ({ record: jest.fn() }) as never),
        acquirePageletTurnLease: jest.fn((() => ({})) as never),
        createRateLimitStorage: jest.fn((_vaultStorageScope: string | null) => ({
            load: () => null,
            save: () => undefined,
        })),
        getVaultStorageScope: () => "test-vault",
        getRateLimitStorageKey: jest.fn((scope: string | null) => `deep-discover:${scope}`),
        createAttentionStorage: jest.fn(() => ({
            load: () => null,
            save: () => undefined,
        })),
        log: jest.fn(),
    };
    return dependencies;
};

describe("DeepDiscoverPluginIntegration ownership", () => {
    it("constructs without initializing a scheduler, model host, limiter, or provider call", () => {
        const dependencies = createDependencies();
        const owner = new DeepDiscoverPluginIntegration(dependencies);
        const state = owner as unknown as OwnerState;

        expect(state.scheduler).toBeNull();
        expect(state.rateLimiter).toBeNull();
        expect(state.controllerPolicyIdentitySnapshot).toBeNull();
        expect(dependencies.createLiveHost).not.toHaveBeenCalled();
        expect(dependencies.getProviderCallAdmission).not.toHaveBeenCalled();
        expect(dependencies.getCostTracker).not.toHaveBeenCalled();
    });

    it("deduplicates initialization by the current policy identity", async () => {
        const owner = new DeepDiscoverPluginIntegration(createDependencies());
        let resolveFirst!: (scheduler: PageletDeepDiscoverScheduler | null) => void;
        const firstScheduler = { setAutomaticEnabled: jest.fn() } as unknown as PageletDeepDiscoverScheduler;
        owner.createScheduler = jest.fn(() => new Promise<PageletDeepDiscoverScheduler | null>((resolve) => {
            resolveFirst = resolve;
        }));

        const first = owner.getOrCreateScheduler();
        const second = owner.getOrCreateScheduler();
        resolveFirst(firstScheduler);
        await expect(first).resolves.toBe(firstScheduler);
        await expect(second).resolves.toBe(firstScheduler);
        expect(owner.createScheduler).toHaveBeenCalledTimes(1);
    });

    it("invalidates and disposes a late initializer after reset without replacing a newer scheduler", async () => {
        const owner = new DeepDiscoverPluginIntegration(createDependencies());
        let resolveOld!: (scheduler: PageletDeepDiscoverScheduler | null) => void;
        const oldScheduler = { dispose: jest.fn() } as unknown as PageletDeepDiscoverScheduler;
        owner.createScheduler = jest.fn(() => new Promise<PageletDeepDiscoverScheduler | null>((resolve) => {
            resolveOld = resolve;
        }));
        const oldInitialization = owner.getOrCreateScheduler();

        owner.resetForFeatureDisable();
        resolveOld(oldScheduler);
        await expect(oldInitialization).resolves.toBeNull();
        expect(oldScheduler.dispose).toHaveBeenCalledTimes(1);
        expect((owner as unknown as OwnerState).scheduler).toBeNull();

        const newScheduler = { setAutomaticEnabled: jest.fn() } as unknown as PageletDeepDiscoverScheduler;
        owner.createScheduler = jest.fn(async () => newScheduler);
        await expect(owner.getOrCreateScheduler()).resolves.toBe(newScheduler);
        expect((owner as unknown as OwnerState).scheduler).toBe(newScheduler);
    });

    it("reset synchronously closes the current scheduler and smoke evidence but keeps quota and attention", () => {
        const owner = new DeepDiscoverPluginIntegration(createDependencies());
        const state = owner as unknown as OwnerState;
        const scheduler = { dispose: jest.fn() } as unknown as PageletDeepDiscoverScheduler;
        const clear = jest.fn();
        state.scheduler = scheduler;
        state.smokeEvidence = { clear };
        state.controllerEpoch = 3;
        state.controllerPolicyIdentitySnapshot = owner.getPolicyIdentityKey();
        const limiter = owner.getRateLimiter();
        const attention = {};
        state.attentionStore = attention;

        owner.resetForFeatureDisable();

        expect(scheduler.dispose).toHaveBeenCalledTimes(1);
        expect(clear).toHaveBeenCalledTimes(1);
        expect(state.scheduler).toBeNull();
        expect(state.controllerPolicyIdentitySnapshot).toBeNull();
        expect(state.controllerEpoch).toBe(4);
        expect(state.rateLimiter).toBe(limiter);
        expect(state.attentionStore).toBe(attention);
    });

    it("routes explicit runs to forced runNow and automatic runs to schedule after currentness checks", async () => {
        const owner = new DeepDiscoverPluginIntegration(createDependencies());
        const runNow = jest.fn(async (_input: unknown) => ({ status: "quiet" as const }));
        const schedule = jest.fn(async (_input: unknown) => ({ status: "quiet" as const }));
        const scheduler = { runNow, schedule } as unknown as PageletDeepDiscoverScheduler;
        const anchor = { path: "notes/current.md" };
        owner.captureAnchorSnapshot = jest.fn(async () => anchor as never);
        owner.getOrCreateScheduler = jest.fn(async () => scheduler);

        await owner.runPageletDeepDiscover({
            path: "notes/current.md",
            triggerReason: "explicit",
            force: true,
        });
        await owner.runPageletDeepDiscover({
            path: "notes/current.md",
            triggerReason: "leave-note",
        });

        expect(runNow).toHaveBeenCalledWith(expect.objectContaining({
            path: "notes/current.md",
            anchorSnapshot: anchor,
            force: true,
        }));
        expect(schedule).toHaveBeenCalledWith(expect.objectContaining({
            path: "notes/current.md",
            anchorSnapshot: anchor,
            isAutomaticRequestCurrent: expect.any(Function),
        }));
    });

    it("uses one limiter and reports the existing 12/36 usage shape", async () => {
        const owner = new DeepDiscoverPluginIntegration(createDependencies());
        const first = owner.getRateLimiter();
        expect(owner.getRateLimiter()).toBe(first);
        owner.readUsageMetrics = jest.fn(() => ({ modelTurns: 2, toolCalls: 5 }));
        first.getStateSnapshot = jest.fn(async () => ({
            hourlyTimestamps: [1],
            dailyCount: 3,
            dailyResetAt: 99,
        })) as never;

        await expect(owner.getDeepDiscoverUsage()).resolves.toEqual({
            runs: 3,
            dailyCap: 36,
            modelTurns: 2,
            toolCalls: 5,
        });
    });

    it("uses one captured vault scope for limiter storage and coordination key", () => {
        const dependencies = createDependencies();
        const owner = new DeepDiscoverPluginIntegration(dependencies);
        let scope = "first-vault";
        dependencies.getVaultStorageScope = () => scope;

        owner.getRateLimiter();
        scope = "second-vault";

        expect(dependencies.createRateLimitStorage).toHaveBeenCalledWith("first-vault");
        expect(dependencies.getRateLimitStorageKey).toHaveBeenCalledWith("first-vault");
    });

    it("computes the legacy usage key directly and keeps safe-integer count semantics", async () => {
        const owner = new DeepDiscoverPluginIntegration(createDependencies());
        const key = "pa-pagelet-deep-discover-usage:v1:test-vault";
        expect(owner.usageStorageKey()).toBe(key);

        const values = new Map<string, string>();
        const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
        Object.defineProperty(globalThis, "localStorage", {
            configurable: true,
            value: {
                getItem: (storageKey: string) => values.get(storageKey) ?? null,
                setItem: (storageKey: string, value: string) => { values.set(storageKey, value); },
                removeItem: (storageKey: string) => { values.delete(storageKey); },
            },
        });
        try {
            values.set(key, JSON.stringify({
                dailyResetAt: 99,
                modelTurns: 1.5,
                toolCalls: -2.5,
            }));
            expect(owner.readUsageMetrics(99)).toEqual({ modelTurns: 0, toolCalls: 0 });

            values.set(key, JSON.stringify({
                dailyResetAt: 99,
                modelTurns: 2,
                toolCalls: 3,
            }));
            owner.getRateLimiter().getStateSnapshot = jest.fn(async () => ({
                hourlyTimestamps: [],
                dailyCount: 0,
                dailyResetAt: 99,
            })) as never;
            await owner.recordUsageMetrics({
                modelTurns: Number.MAX_SAFE_INTEGER + 1,
                toolCalls: 2.5,
            });
            expect(JSON.parse(values.get(key) ?? "{}")).toEqual({
                dailyResetAt: 99,
                modelTurns: 2,
                toolCalls: 3,
            });
        } finally {
            if (previous) Object.defineProperty(globalThis, "localStorage", previous);
            else delete (globalThis as { localStorage?: unknown }).localStorage;
        }
    });

    it("captures provider identity at runtime assembly and keeps it for a late result", () => {
        const dependencies = createDependencies();
        const owner = new DeepDiscoverPluginIntegration(dependencies);
        const runtimeHost: { settings: { aiProvider: string; chatModelName: string; baseURL: string } } = {
            settings: {
                aiProvider: "openai",
                chatModelName: "old-model",
                baseURL: "https://old.example/v1",
            },
        };
        const handler = owner.createRuntimeResultHandler(runtimeHost as never);
        runtimeHost.settings.chatModelName = "new-model";
        runtimeHost.settings.aiProvider = "qwen";
        const record = jest.fn();
        dependencies.getCostTracker = () => ({ record }) as never;

        handler(
            {
                status: "quiet",
                metrics: {
                    modelTurns: 1,
                    toolCalls: 0,
                    wallTimeMs: 1,
                    tokenUsage: { inputTokens: 1, outputTokens: 1 },
                },
            } as never,
            { triggerReason: "explicit" } as never,
        );

        expect(record).toHaveBeenCalledWith(expect.objectContaining({
            provider: "openai",
            model: "old-model",
        }));
    });

    it("captures the production result handler once before controller/runtime construction", async () => {
        const dependencies = createDependencies();
        const owner = new DeepDiscoverPluginIntegration(dependencies);
        const runtimeHost = {
            settings: {
                aiProvider: "openai",
                chatModelName: "assembly-model",
                baseURL: "https://api.openai.com/v1",
                qwenThinkingEnabled: false,
            },
        };
        dependencies.createLiveHost = jest.fn(() => runtimeHost as never);
        owner.loadWebCapabilities = jest.fn(async () => []);
        const handlerSpy = jest.spyOn(owner, "createRuntimeResultHandler");

        await owner.createScheduler(owner.getPolicyIdentityKey(), 0);

        const handler = handlerSpy.mock.results[0]?.value;
        const controllerOptions = jest.mocked(PageletDeepDiscoverController)
            .mock.calls[0]?.[0] as { onResult: unknown };
        expect(handlerSpy).toHaveBeenCalledTimes(1);
        expect(handlerSpy.mock.invocationCallOrder[0])
            .toBeLessThan(jest.mocked(createPageletAgentRuntime).mock.invocationCallOrder[0]!);
        expect(handlerSpy.mock.invocationCallOrder[0])
            .toBeLessThan(jest.mocked(PageletDeepDiscoverController).mock.invocationCallOrder[0]!);
        expect(controllerOptions.onResult).toBe(handler);
    });

    it("feature disposal clears only the Deep Discover limiter", async () => {
        const owner = new DeepDiscoverPluginIntegration(createDependencies());
        const state = owner as unknown as OwnerState;
        const scheduler = { dispose: jest.fn() } as unknown as PageletDeepDiscoverScheduler;
        state.scheduler = scheduler;
        const limiter = owner.getRateLimiter();

        owner.disposeFeature();

        expect(state.rateLimiter).toBeNull();
        expect(owner.getRateLimiter()).not.toBe(limiter);
        expect(state.scheduler).toBe(scheduler);
        expect(scheduler.dispose).not.toHaveBeenCalled();
    });
});
