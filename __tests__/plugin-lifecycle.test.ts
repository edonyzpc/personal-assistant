import { describe, expect, it, jest, afterEach } from "@jest/globals";
import { Notice } from "obsidian";
import { setPlatformMobile, resetPlatform } from "./helpers/platform-mock";

jest.mock("obsidian-callout-manager", () => ({ getApi: jest.fn() }));
jest.mock("../src/chat/chat-view", () => ({ VIEW_TYPE_LLM: "llm-view", LLMView: class {} }));
jest.mock("../src/share-card/share-card-modal", () => ({
    ShareCardModal: class {},
    closeAllShareCardModals: jest.fn(),
}));
jest.mock("../src/ai", () => ({ AssistantFeaturedImageHelper: class {}, AssistantHelper: class {} }));
jest.mock("../src/vss", () => ({ VSS: class {} }));
jest.mock("../src/memory-manager", () => ({ MemoryManager: class { startAutoMaintenance() {} } }));
jest.mock("../src/modal", () => ({ PluginControlModal: class {} }));
jest.mock("../src/batch-modal", () => ({ BatchPluginControlModal: class {} }));
jest.mock("../src/local-graph", () => ({ LocalGraph: class {} }));
jest.mock("../src/plugin-manifest", () => ({ PluginsUpdater: class {} }));
jest.mock("../src/theme-manifest", () => ({ ThemeUpdater: class {} }));

import { createPluginHarness } from "./helpers/plugin-harness";

describe("Plugin lifecycle integration", () => {

    describe("loadSettings with null data.json", () => {
        it("initializes missing data.json and produces valid settings", async () => {
            const { plugin, readPersisted } = createPluginHarness({ initialData: null });

            await plugin.loadSettings();

            expect(plugin.settings).toBeDefined();
            expect(plugin.settings.aiProvider).toBe("");
            const persisted = readPersisted();
            expect(persisted).not.toBeNull();
        });

        it("keeps token presence unknown on fresh install", async () => {
            const { plugin } = createPluginHarness({ initialData: null });

            await plugin.loadSettings();

            expect(plugin.getAPITokenCacheState()).toBe("unknown");
            expect(plugin.hasTokenCachedValue()).toBeNull();
        });

        it("recognizes a retained SecretStorage token after provider selection", async () => {
            const { plugin, secretStorage } = createPluginHarness({
                initialData: null,
                secretStorageValues: { "pa-api-token": "sk-retained" },
            });

            await plugin.loadSettings();
            expect(secretStorage.getSecret).not.toHaveBeenCalled();
            plugin.settings.aiProvider = "openai";
            plugin.settings.baseURL = "https://api.openai.com/v1";
            plugin.settings.chatModelName = "gpt-4o-mini";

            expect(plugin.refreshAPITokenPresence()).toBe("present");
            const readsAfterRefresh = secretStorage.getSecret.mock.calls.length;
            expect(plugin.getAISetupIssue()).toBeNull();
            expect(plugin.getAISetupIssue()).toBeNull();
            expect(secretStorage.getSecret).toHaveBeenCalledTimes(readsAfterRefresh);
        });

        it("does not probe SecretStorage during passive layout-ready startup", async () => {
            const { plugin, secretStorage } = createPluginHarness({
                initialData: {
                    aiProvider: "openai",
                    baseURL: "https://api.openai.com/v1",
                    chatModelName: "gpt-4o-mini",
                },
                secretStorageValues: { "pa-api-token": "sk-retained" },
            });
            await plugin.loadSettings();
            const onSettingsChanged = jest.fn<() => void>();
            plugin.onSettingsChanged(onSettingsChanged);
            (plugin as unknown as { setupHoverPopoverObserver: () => void }).setupHoverPopoverObserver = jest.fn();
            (plugin as unknown as { initializeMemorySubsystem: () => Promise<void> }).initializeMemorySubsystem = jest.fn(async () => {
                (plugin as unknown as { unloading: boolean }).unloading = true;
            });

            await (plugin as unknown as { onLayoutReady(): Promise<void> }).onLayoutReady();

            expect(secretStorage.getSecret).not.toHaveBeenCalled();
            expect(plugin.getAPITokenCacheState()).toBe("unknown");
            expect(onSettingsChanged).not.toHaveBeenCalled();
        });
    });

    describe("loadSettings with corrupt data.json", () => {
        it("handles non-object loadData result gracefully", async () => {
            const { plugin } = createPluginHarness({ initialData: null });
            plugin.loadData = jest.fn(async () => "not-an-object") as never;

            await plugin.loadSettings();

            expect(plugin.settings).toBeDefined();
            expect(plugin.settings.memoryEnabled).toBe(true);
        });

        it("handles array loadData result gracefully", async () => {
            const { plugin } = createPluginHarness({ initialData: null });
            plugin.loadData = jest.fn(async () => [1, 2, 3]) as never;

            await plugin.loadSettings();

            expect(plugin.settings).toBeDefined();
            expect(typeof plugin.settings.aiProvider).toBe("string");
        });
    });

    describe("legacy AI provider migration", () => {
        const migrateSettings = (plugin: unknown) => (
            plugin as { migrateSettings(): Promise<void> }
        ).migrateSettings();

        it.each([
            ["qwen", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen3.6-plus", "text-embedding-v4"],
            ["openai", "https://api.openai.com/v1", "gpt-4o-mini", "text-embedding-3-small"],
        ])(
            "preserves the explicitly persisted supported provider %s",
            async (aiProvider, baseURL, chatModelName, embeddingModelName) => {
                const { plugin, readPersisted, secretStorage } = createPluginHarness({
                    initialData: { aiProvider, baseURL, chatModelName, embeddingModelName },
                    secretStorageValues: { "pa-api-token": "sk-retained" },
                });

                await plugin.loadSettings();
                await migrateSettings(plugin);

                expect(plugin.settings).toMatchObject({
                    aiProvider,
                    baseURL,
                    chatModelName,
                    embeddingModelName,
                });
                expect(readPersisted()).toMatchObject({ aiProvider, baseURL });
                expect(secretStorage.getSecret).not.toHaveBeenCalled();
            },
        );

        it.each(["qwen-plus", "qwen-max", "qwen-turbo"])(
            "grandfathers the exact pre-Provider Qwen model %s",
            async (modelName) => {
                const { plugin, readPersisted, secretStorage } = createPluginHarness({
                    initialData: { debug: false, modelName },
                    secretStorageValues: { "pa-api-token": "sk-retained" },
                });

                await plugin.loadSettings();
                await migrateSettings(plugin);

                expect(plugin.settings).toMatchObject({
                    aiProvider: "qwen",
                    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
                    chatModelName: modelName,
                    embeddingModelName: "text-embedding-v3",
                });
                expect(readPersisted()).toMatchObject({ aiProvider: "qwen" });
                expect(secretStorage.getSecret).not.toHaveBeenCalled();
            },
        );

        it.each([" qwen-plus ", "gpt-4o"])(
            "fails closed for the unproven provider-less legacy model %p",
            async (modelName) => {
                const first = createPluginHarness({
                    initialData: { debug: false, modelName },
                    secretStorageValues: { "pa-api-token": "sk-retained" },
                });

                await first.plugin.loadSettings();
                await migrateSettings(first.plugin);

                expect(first.plugin.settings.aiProvider).toBe("");
                expect(first.plugin.getAIReadiness().issue).toBe("provider_missing");
                expect(first.secretStorage.getSecret).not.toHaveBeenCalled();
                expect(first.secretStorage.setSecret).not.toHaveBeenCalled();
                expect(first.readPersisted()).toMatchObject({ aiProvider: "" });

                const reloaded = createPluginHarness({
                    initialData: first.readPersisted(),
                    secretStorageValues: { "pa-api-token": "sk-retained" },
                });
                await reloaded.plugin.loadSettings();
                await migrateSettings(reloaded.plugin);
                expect(reloaded.plugin.settings.aiProvider).toBe("");
                expect(reloaded.secretStorage.getSecret).not.toHaveBeenCalled();
            },
        );

        it("requires a current provider choice for Ollama while reusing its retained token", async () => {
            const { plugin, readPersisted, secretStorage } = createPluginHarness({
                initialData: {
                    aiProvider: "ollama",
                    baseURL: "http://localhost:11434",
                    chatModelName: "llama3.1",
                    embeddingModelName: "mxbai-embed-large",
                },
                secretStorageValues: { "pa-api-token": "sk-retained" },
            });

            await plugin.loadSettings();
            await migrateSettings(plugin);

            expect(plugin.settings).toMatchObject({
                aiProvider: "",
                baseURL: "http://localhost:11434",
                chatModelName: "llama3.1",
                embeddingModelName: "mxbai-embed-large",
            });
            expect(plugin.getAIReadiness().issue).toBe("provider_missing");
            expect(secretStorage.getSecret).not.toHaveBeenCalled();
            expect(secretStorage.setSecret).not.toHaveBeenCalled();
            expect(readPersisted()).toMatchObject({ aiProvider: "" });

            await expect((plugin as unknown as {
                completeAISetup(input: { presetKey: string }): Promise<{ ok: boolean }>;
            }).completeAISetup({ presetKey: "openai" })).resolves.toEqual({ ok: true });
            expect(plugin.settings.aiProvider).toBe("openai");
            expect(secretStorage.getSecret).toHaveBeenCalled();
            expect(secretStorage.setSecret).not.toHaveBeenCalled();
        });
    });

    describe("hasTokenCached lifecycle", () => {
        it("returns null before any token access", () => {
            const { plugin } = createPluginHarness({
                initialData: { aiProvider: "qwen", baseURL: "https://example.com/v1", chatModelName: "model" },
            });

            expect(plugin.hasTokenCachedValue()).toBeNull();
            expect(plugin.getAPITokenCacheState()).toBe("unknown");
        });

        it("setAPITokenSecret updates cache to true", () => {
            const { plugin } = createPluginHarness({
                initialData: { aiProvider: "qwen", baseURL: "https://example.com/v1", chatModelName: "model" },
            });

            plugin.setAPITokenSecret("sk-test-token");

            expect(plugin.hasTokenCachedValue()).toBe(true);
            expect(plugin.getAPITokenCacheState()).toBe("present");
        });

        it("setAPITokenSecret with empty value updates cache to false", () => {
            const { plugin } = createPluginHarness({ initialData: { aiProvider: "qwen" } });

            plugin.setAPITokenSecret("");

            expect(plugin.hasTokenCachedValue()).toBe(false);
            expect(plugin.getAPITokenCacheState()).toBe("missing");
        });

        it("clearTokenCache resets cache to null", () => {
            const { plugin } = createPluginHarness({ initialData: { aiProvider: "qwen" } });
            plugin.setAPITokenSecret("sk-test");

            plugin.clearTokenCache();

            expect(plugin.hasTokenCachedValue()).toBeNull();
            expect(plugin.getAPITokenCacheState()).toBe("unknown");
        });

        it("treats a whitespace-only token as missing", () => {
            const { plugin } = createPluginHarness({ initialData: { aiProvider: "qwen" } });

            plugin.setAPITokenSecret("   ");

            expect(plugin.getAPITokenCacheState()).toBe("missing");
        });

        it("cancels active Memory before writing a token", () => {
            const { plugin, secretStorage } = createPluginHarness({ initialData: { aiProvider: "qwen" } });
            const cancelActivePreparation = jest.fn();
            (plugin as unknown as { memoryManager: unknown }).memoryManager = { cancelActivePreparation };
            secretStorage.setSecret.mockImplementation(() => {
                expect(cancelActivePreparation).toHaveBeenCalledTimes(1);
            });

            plugin.setAPITokenSecret("sk-test");

            expect(cancelActivePreparation).toHaveBeenCalledTimes(1);
        });

        it("invalidates a stale cache and notifies unknown when an add persists before throwing", async () => {
            const { plugin, secretStorage } = createPluginHarness({
                initialData: {
                    aiProvider: "qwen",
                    baseURL: "https://example.com/v1",
                    chatModelName: "model",
                    embeddingModelName: "embed",
                },
            });
            await plugin.loadSettings();
            const currentSecretId = plugin.getAPITokenSecretId();
            const defaultSetSecret = secretStorage.setSecret.getMockImplementation();
            expect(defaultSetSecret).toBeDefined();
            (plugin as unknown as { token: string; tokenCacheState: string }).token = "sk-stale";
            (plugin as unknown as { tokenCacheState: string }).tokenCacheState = "present";
            (plugin as unknown as { aiTokenRevision: number }).aiTokenRevision = 4;
            (plugin as unknown as { aiExternalSettingsMutationEpoch: number })
                .aiExternalSettingsMutationEpoch = 8;
            secretStorage.setSecret.mockImplementationOnce((id: string, value: string) => {
                defaultSetSecret!(id, value);
                throw new Error("write failed after persistence");
            });
            const observedIssues: Array<string | null> = [];
            plugin.onSettingsChanged(() => { observedIssues.push(plugin.getAIReadiness().issue); });

            expect(() => plugin.setAPITokenSecret("sk-new")).toThrow("write failed after persistence");

            expect((plugin as unknown as { token: string }).token).toBe("");
            expect(plugin.getAPITokenCacheState()).toBe("unknown");
            expect(plugin.hasTokenCachedValue()).toBeNull();
            expect((plugin as unknown as { aiTokenRevision: number }).aiTokenRevision).toBe(5);
            expect((plugin as unknown as { aiExternalSettingsMutationEpoch: number })
                .aiExternalSettingsMutationEpoch).toBe(9);
            await plugin.notifyAIReadinessChanged();
            expect(observedIssues).toEqual(["token_unknown"]);
            expect(plugin.getConfiguredAPITokenSecret()).toBe("sk-new");

            const reloaded = createPluginHarness({
                initialData: {
                    aiProvider: "qwen",
                    baseURL: "https://example.com/v1",
                    chatModelName: "model",
                    embeddingModelName: "embed",
                },
                secretStorageValues: { [currentSecretId]: "sk-new" },
            });
            await reloaded.plugin.loadSettings();
            expect(reloaded.plugin.refreshAPITokenPresence()).toBe("present");
            expect(reloaded.plugin.getConfiguredAPITokenSecret()).toBe("sk-new");
        });

        it("invalidates a cached token and reloads missing when removal persists before throwing", async () => {
            const currentSecretId = "pa-api-token-vault-test";
            const { plugin, secretStorage } = createPluginHarness({
                initialData: {
                    statisticsVaultId: "vault-test",
                    aiProvider: "qwen",
                    baseURL: "https://example.com/v1",
                    chatModelName: "model",
                    embeddingModelName: "embed",
                },
                secretStorageValues: { [currentSecretId]: "sk-old" },
            });
            await plugin.loadSettings();
            expect(await plugin.getAPIToken()).toBe("sk-old");
            const defaultSetSecret = secretStorage.setSecret.getMockImplementation();
            expect(defaultSetSecret).toBeDefined();
            (plugin as unknown as { aiTokenRevision: number }).aiTokenRevision = 12;
            (plugin as unknown as { aiExternalSettingsMutationEpoch: number })
                .aiExternalSettingsMutationEpoch = 20;
            secretStorage.setSecret.mockImplementationOnce((id: string, value: string) => {
                defaultSetSecret!(id, value);
                throw new Error("delete failed after persistence");
            });
            const observedIssues: Array<string | null> = [];
            plugin.onSettingsChanged(() => { observedIssues.push(plugin.getAIReadiness().issue); });

            expect(() => plugin.setAPITokenSecret("")).toThrow("delete failed after persistence");

            expect((plugin as unknown as { token: string }).token).toBe("");
            expect(plugin.getAPITokenCacheState()).toBe("unknown");
            expect((plugin as unknown as { aiTokenRevision: number }).aiTokenRevision).toBe(13);
            expect((plugin as unknown as { aiExternalSettingsMutationEpoch: number })
                .aiExternalSettingsMutationEpoch).toBe(21);
            await plugin.notifyAIReadinessChanged();
            expect(observedIssues).toEqual(["token_unknown"]);
            expect(plugin.getConfiguredAPITokenSecret()).toBeNull();

            const reloaded = createPluginHarness({
                initialData: {
                    statisticsVaultId: "vault-test",
                    aiProvider: "qwen",
                    baseURL: "https://example.com/v1",
                    chatModelName: "model",
                    embeddingModelName: "embed",
                },
            });
            await reloaded.plugin.loadSettings();
            expect(reloaded.plugin.refreshAPITokenPresence()).toBe("missing");
            expect(reloaded.plugin.getAIReadiness().issue).toBe("token_missing");
        });
    });

    describe("mobile platform behavior", () => {
        afterEach(resetPlatform);

        it("plugin harness works on mobile platform", () => {
            setPlatformMobile();
            const { plugin } = createPluginHarness({
                initialData: { aiProvider: "qwen", baseURL: "https://example.com/v1", chatModelName: "m" },
            });
            expect(plugin.hasTokenCachedValue()).toBeNull();
            expect(plugin.settings).toBeDefined();
        });
    });
});

describe("AI readiness gate", () => {
    it("keeps local Memory status readable and probes a retained token only for a manual action", async () => {
        const { plugin, secretStorage } = createPluginHarness({
            initialData: {
                aiProvider: "openai",
                baseURL: "https://api.openai.com/v1",
                chatModelName: "gpt-4o-mini",
                embeddingModelName: "text-embedding-3-small",
            },
            secretStorageValues: { "pa-api-token": "sk-retained" },
        });
        await plugin.loadSettings();
        const getMaintenancePlan = jest.fn(async () => ({
            reason: "ready" as const,
            action: "none" as const,
            notesToCheck: 2,
            requiresApproval: false,
            canAnswerNow: true,
        }));
        const prepareFromCommand = jest.fn(async () => undefined);
        (plugin as unknown as { memoryManager: unknown }).memoryManager = {
            getMaintenancePlan,
            prepareFromCommand,
        };
        const settingsChanged = jest.fn<() => void>();
        const memoryStatusChanged = jest.fn<() => void>();
        plugin.onSettingsChanged(settingsChanged);
        plugin.onMemoryStatusChanged(memoryStatusChanged);
        const host = (plugin as unknown as { createChatHost(): { memoryStatus: {
            getMaintenancePlan(): Promise<{ reason: string }>;
            prepareFromCommand(): Promise<void>;
        } } }).createChatHost();

        await expect(host.memoryStatus.getMaintenancePlan()).resolves.toMatchObject({ reason: "ready" });
        expect(getMaintenancePlan).toHaveBeenCalledTimes(1);
        expect(secretStorage.getSecret).not.toHaveBeenCalled();
        expect(plugin.getAPITokenCacheState()).toBe("unknown");

        await host.memoryStatus.prepareFromCommand();
        await Promise.resolve();

        expect(secretStorage.getSecret).toHaveBeenCalled();
        expect(plugin.getAPITokenCacheState()).toBe("present");
        expect(prepareFromCommand).toHaveBeenCalledTimes(1);
        expect(settingsChanged).toHaveBeenCalledTimes(1);
        expect(memoryStatusChanged).toHaveBeenCalledTimes(1);
    });

    it("probes a retained token through the explicit AI command gate", async () => {
        const { plugin, secretStorage } = createPluginHarness({
            initialData: {
                aiProvider: "openai",
                baseURL: "https://api.openai.com/v1",
                chatModelName: "gpt-4o-mini",
                embeddingModelName: "text-embedding-3-small",
            },
            secretStorageValues: { "pa-api-token": "sk-retained" },
        });
        await plugin.loadSettings();
        const settingsChanged = jest.fn<() => void>();
        const memoryStatusChanged = jest.fn<() => void>();
        plugin.onSettingsChanged(settingsChanged);
        plugin.onMemoryStatusChanged(memoryStatusChanged);

        expect(secretStorage.getSecret).not.toHaveBeenCalled();
        expect((plugin as unknown as { ensureAIConfigured(): boolean }).ensureAIConfigured()).toBe(true);
        await Promise.resolve();
        expect(secretStorage.getSecret).toHaveBeenCalled();
        expect(plugin.getAPITokenCacheState()).toBe("present");
        expect(settingsChanged).toHaveBeenCalledTimes(1);
        expect(memoryStatusChanged).toHaveBeenCalledTimes(1);
    });

    it("keeps a raw token presence probe local so inline setup draft state is not re-rendered", async () => {
        const { plugin, secretStorage } = createPluginHarness({
            initialData: {
                aiProvider: "openai",
                baseURL: "https://api.openai.com/v1",
                chatModelName: "gpt-4o-mini",
                embeddingModelName: "text-embedding-3-small",
            },
            secretStorageValues: { "pa-api-token": "sk-retained" },
        });
        await plugin.loadSettings();
        const settingsChanged = jest.fn<() => void>();
        const memoryStatusChanged = jest.fn<() => void>();
        plugin.onSettingsChanged(settingsChanged);
        plugin.onMemoryStatusChanged(memoryStatusChanged);

        expect(plugin.refreshAPITokenPresence()).toBe("present");
        await Promise.resolve();

        expect(secretStorage.getSecret).toHaveBeenCalled();
        expect(settingsChanged).not.toHaveBeenCalled();
        expect(memoryStatusChanged).not.toHaveBeenCalled();
    });

    it("shows a setup issue when an explicit Memory action finds no saved token", async () => {
        const { plugin, secretStorage } = createPluginHarness({
            initialData: {
                aiProvider: "openai",
                baseURL: "https://api.openai.com/v1",
                chatModelName: "gpt-4o-mini",
                embeddingModelName: "text-embedding-3-small",
            },
        });
        await plugin.loadSettings();
        const prepareFromCommand = jest.fn(async () => undefined);
        (plugin as unknown as { memoryManager: unknown }).memoryManager = {
            getMaintenancePlan: jest.fn(async () => ({
                reason: "ready" as const,
                action: "none" as const,
                notesToCheck: 0,
                requiresApproval: false,
                canAnswerNow: true,
            })),
            prepareFromCommand,
        };
        const host = (plugin as unknown as { createChatHost(): { memoryStatus: {
            prepareFromCommand(): Promise<void>;
        } } }).createChatHost();
        const messages = (Notice as unknown as { messages: Array<{ message?: unknown }> }).messages;
        messages.length = 0;

        await host.memoryStatus.prepareFromCommand();

        expect(secretStorage.getSecret).toHaveBeenCalled();
        expect(plugin.getAPITokenCacheState()).toBe("missing");
        expect(prepareFromCommand).not.toHaveBeenCalled();
        expect(messages.at(-1)?.message).toBe("Add your API token in Settings first.");
    });

    it("createChatModel throws when aiProvider is empty", async () => {
        const { AIUtils } = await import("../src/ai-services/ai-utils");
        const host = {
            settings: { aiProvider: "", baseURL: "", chatModelName: "", embeddingModelName: "" },
            getAPIToken: jest.fn(async () => ""),
            log: jest.fn(),
        };
        const aiUtils = new AIUtils(host as never);

        await expect(aiUtils.createChatModel()).rejects.toThrow("AI provider not configured");
    });

    it("createEmbeddings throws when aiProvider is empty", async () => {
        const { AIUtils } = await import("../src/ai-services/ai-utils");
        const host = {
            settings: { aiProvider: "", baseURL: "", chatModelName: "", embeddingModelName: "" },
            getAPIToken: jest.fn(async () => ""),
            log: jest.fn(),
        };
        const aiUtils = new AIUtils(host as never);

        await expect(aiUtils.createEmbeddings()).rejects.toThrow("AI provider not configured");
    });

    it("separates Chat readiness from Memory embedding readiness", async () => {
        const { plugin } = createPluginHarness({
            initialData: {
                aiProvider: "openai",
                baseURL: "https://api.openai.com/v1",
                chatModelName: "gpt-4o-mini",
                embeddingModelName: "",
            },
        });
        await plugin.loadSettings();
        plugin.setAPITokenSecret("sk-test");

        expect(plugin.getAIReadiness("chat")).toMatchObject({ ready: true, issue: null });
        expect(plugin.getAIReadiness("memory")).toMatchObject({
            ready: false,
            issue: "embedding_model_missing",
        });
    });

    it("rejects whitespace-only configuration before reading the token", async () => {
        const { AIUtils } = await import("../src/ai-services/ai-utils");
        const getAPIToken = jest.fn(async () => "sk-test");
        const aiUtils = new AIUtils({
            settings: {
                aiProvider: " qwen ",
                baseURL: "   ",
                chatModelName: "   ",
                embeddingModelName: "   ",
            },
            getAPIToken,
            log: jest.fn(),
        });

        await expect(aiUtils.createChatModel()).rejects.toThrow("configuration incomplete");
        await expect(aiUtils.createEmbeddings()).rejects.toThrow("configuration incomplete");
        expect(getAPIToken).not.toHaveBeenCalled();
    });

    it("rejects an unsupported provider before reading the token", async () => {
        const { AIUtils } = await import("../src/ai-services/ai-utils");
        const getAPIToken = jest.fn(async () => "sk-test");
        const aiUtils = new AIUtils({
            settings: {
                aiProvider: "ollama",
                baseURL: "http://localhost:11434/v1",
                chatModelName: "model",
                embeddingModelName: "embed",
            },
            getAPIToken,
            log: jest.fn(),
        });

        await expect(aiUtils.createChatModel()).rejects.toThrow("Unsupported AI provider: ollama");
        expect(getAPIToken).not.toHaveBeenCalled();
    });

    it("rejects an empty runtime token before constructing a model", async () => {
        const { AIUtils } = await import("../src/ai-services/ai-utils");
        const getAPIToken = jest.fn(async () => "   ");
        const aiUtils = new AIUtils({
            settings: {
                aiProvider: "openai",
                baseURL: "https://api.openai.com/v1",
                chatModelName: "gpt-4o-mini",
                embeddingModelName: "text-embedding-3-small",
            },
            getAPIToken,
            log: jest.fn(),
        });

        await expect(aiUtils.createChatModel()).rejects.toThrow("API token not configured");
    });
});

describe("inline AI setup coordinator", () => {
    const completeSetup = (plugin: unknown, input: { presetKey?: string; token?: string }) => (
        plugin as { completeAISetup(value: typeof input): Promise<{ ok: boolean; code?: string }> }
    ).completeAISetup(input);
    const prepareForUnload = (plugin: unknown) => {
        const internals = plugin as Record<string, unknown>;
        internals.memoryManager = {
            cancelActivePreparation: jest.fn(),
            stopAutoMaintenance: jest.fn(),
            waitForIdle: jest.fn(async () => undefined),
        };
        const dispose = jest.fn(async () => undefined);
        internals.vss = { dispose };
        internals.phase3Handle = null;
        internals.resizeDebounceTimer = null;
        internals.hoverPopoverObserver = null;
        internals.debouncedStatusBarUpdate = { cancel: jest.fn() };
        internals.resetDeepDiscoverController = jest.fn();
        internals.cancelMemoryForgetRetry = jest.fn();
        internals.cancelMemoryProfileProjectionRetry = jest.fn();
        internals.cancelMemoryGovernanceGarbageCollection = jest.fn();
        return dispose;
    };

    it("reuses an existing token while completing a partial provider tuple", async () => {
        const { plugin, secretStorage, readPersisted } = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                baseURL: "",
                chatModelName: "",
                embeddingModelName: "",
            },
            secretStorageValues: { "pa-api-token": "sk-existing" },
        });
        await plugin.loadSettings();
        secretStorage.setSecret.mockClear();

        await expect(completeSetup(plugin, { presetKey: "openai" })).resolves.toEqual({ ok: true });

        expect(secretStorage.getSecret).toHaveBeenCalled();
        expect(secretStorage.setSecret).not.toHaveBeenCalled();
        expect(plugin.settings.aiProvider).toBe("openai");
        expect(plugin.settings.aiProviderPreset).toBe("openai");
        expect(readPersisted()?.aiProviderPreset).toBe("openai");
    });

    it("preserves a complete custom provider when only the token is missing", async () => {
        const { plugin, readPersisted } = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://custom.example/v1",
                chatModelName: "custom-chat",
                embeddingModelName: "custom-embed",
            },
        });
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        const saveData = jest.fn(async () => { throw new Error("data.json must not be written"); });
        plugin.saveData = saveData as never;
        (plugin as unknown as { aiProviderConfigurationRevision: number }).aiProviderConfigurationRevision = 17;

        await expect(completeSetup(plugin, { token: "sk-custom" })).resolves.toEqual({ ok: true });

        expect(plugin.settings).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "custom",
            baseURL: "https://custom.example/v1",
            chatModelName: "custom-chat",
            embeddingModelName: "custom-embed",
        });
        expect(readPersisted()).toMatchObject({
            aiProviderPreset: "custom",
            baseURL: "https://custom.example/v1",
        });
        expect(saveData).not.toHaveBeenCalled();
        expect((plugin as unknown as { aiProviderConfigurationRevision: number })
            .aiProviderConfigurationRevision).toBe(17);
        expect(plugin.getConfiguredAPITokenSecret()).toBe("sk-custom");
        expect(plugin.getAPITokenCacheState()).toBe("present");
    });

    it("blocks new Chat and Memory credential admission until a new provider-token pair commits", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "qwen",
                baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
                chatModelName: "qwen3.6-plus",
                embeddingModelName: "text-embedding-v4",
            },
        });
        const { plugin, secretStorage } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        expect(plugin.getAIReadiness()).toMatchObject({ issue: "token_missing" });
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let releaseProviderSave!: () => void;
        let markProviderSaveStarted!: () => void;
        const providerSaveStarted = new Promise<void>((resolve) => { markProviderSaveStarted = resolve; });
        const providerSaveGate = new Promise<void>((resolve) => { releaseProviderSave = resolve; });
        plugin.saveData = jest.fn(async (next: unknown) => {
            markProviderSaveStarted();
            await providerSaveGate;
            harness.writePersisted(JSON.parse(JSON.stringify(next)) as Record<string, unknown>);
        }) as never;
        const observedIssues: Array<string | null> = [];
        plugin.onSettingsChanged(() => { observedIssues.push(plugin.getAIReadiness().issue); });

        const setup = completeSetup(plugin, { presetKey: "openai", token: "sk-new" });
        await providerSaveStarted;
        const tokenReadsBeforeConsumers = secretStorage.getSecret.mock.calls.length;
        expect(plugin.refreshAPITokenPresence()).toBe("unknown");
        expect(secretStorage.getSecret).toHaveBeenCalledTimes(tokenReadsBeforeConsumers);
        const providerRequests = jest.fn();
        const { AIUtils } = await import("../src/ai-services/ai-utils");
        const aiUtils = new AIUtils(plugin);
        const chatAttempt = plugin.createChatModel(0.2)
            .then((model) => providerRequests("chat", model));
        const memoryAttempt = aiUtils.createEmbeddings()
            .then((model) => providerRequests("memory", model));

        expect(plugin.getAIReadiness("chat")).toMatchObject({
            ready: false,
            issue: "token_unknown",
            aiProvider: "qwen",
            baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        });
        expect(plugin.getAIReadiness("memory")).toMatchObject({
            ready: false,
            issue: "token_unknown",
        });
        await expect(chatAttempt).rejects.toThrow("AI provider configuration is being updated");
        await expect(memoryAttempt).rejects.toThrow("AI provider configuration is being updated");
        expect(secretStorage.getSecret).toHaveBeenCalledTimes(tokenReadsBeforeConsumers);
        expect(providerRequests).not.toHaveBeenCalled();
        expect(observedIssues).toEqual([]);

        releaseProviderSave();
        await expect(setup).resolves.toEqual({ ok: true });

        expect(plugin.settings).toMatchObject({
            aiProvider: "openai",
            aiProviderPreset: "openai",
            baseURL: "https://api.openai.com/v1",
        });
        expect(plugin.getConfiguredAPITokenSecret()).toBe("sk-new");
        expect(plugin.getAIReadiness("chat")).toMatchObject({ ready: true, issue: null });
        await expect(plugin.getAPIToken()).resolves.toBe("sk-new");
        expect(observedIssues).toEqual([null]);
    });

    it("keeps the old stable provider and missing token after a guarded setup save fails", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "qwen",
                baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
                chatModelName: "qwen3.6-plus",
                embeddingModelName: "text-embedding-v4",
            },
        });
        const { plugin, secretStorage } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let releaseProviderFailure!: () => void;
        let markProviderSaveStarted!: () => void;
        const providerSaveStarted = new Promise<void>((resolve) => { markProviderSaveStarted = resolve; });
        const providerFailureGate = new Promise<void>((resolve) => { releaseProviderFailure = resolve; });
        let saveAttempt = 0;
        plugin.saveData = jest.fn(async (next: unknown) => {
            saveAttempt++;
            if (saveAttempt === 1) {
                markProviderSaveStarted();
                await providerFailureGate;
                throw new Error("provider save failed");
            }
            harness.writePersisted(JSON.parse(JSON.stringify(next)) as Record<string, unknown>);
        }) as never;
        const observedIssues: Array<string | null> = [];
        plugin.onSettingsChanged(() => { observedIssues.push(plugin.getAIReadiness().issue); });

        const setup = completeSetup(plugin, { presetKey: "openai", token: "sk-new" });
        await providerSaveStarted;
        const tokenReadsBeforeConsumer = secretStorage.getSecret.mock.calls.length;
        const providerRequests = jest.fn();
        const chatAttempt = plugin.createChatModel(0.2)
            .then((model) => providerRequests("chat", model));

        await expect(chatAttempt).rejects.toThrow("AI provider configuration is being updated");
        expect(secretStorage.getSecret).toHaveBeenCalledTimes(tokenReadsBeforeConsumer);
        expect(providerRequests).not.toHaveBeenCalled();
        expect(observedIssues).toEqual([]);

        releaseProviderFailure();
        await expect(setup).resolves.toEqual({ ok: false, code: "settings_save_failed" });

        expect(plugin.settings).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "qwen",
            baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        });
        expect(plugin.getConfiguredAPITokenSecret()).toBeNull();
        expect(plugin.getAIReadiness()).toMatchObject({
            ready: false,
            issue: "token_missing",
        });
        expect(harness.readPersisted()).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "qwen",
        });
        expect(observedIssues).toEqual(["token_missing"]);
    });

    it("does not mutate provider settings when the token write fails", async () => {
        const { plugin, secretStorage } = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
            },
        });
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        secretStorage.setSecret.mockImplementationOnce(() => { throw new Error("write failed"); });

        const result = await completeSetup(plugin, { presetKey: "openai", token: "sk-new" });

        expect(result).toEqual({ ok: false, code: "token_save_failed" });
        expect(plugin.settings).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "custom",
            baseURL: "https://old.example/v1",
            chatModelName: "old-chat",
            embeddingModelName: "old-embed",
        });
    });

    it("returns a structured failure without writing when the previous token cannot be read", async () => {
        const { plugin, secretStorage } = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
            },
        });
        await plugin.loadSettings();
        secretStorage.getSecret.mockImplementation(() => { throw new Error("read failed"); });

        await expect(completeSetup(plugin, {
            presetKey: "openai",
            token: "sk-new",
        })).resolves.toEqual({ ok: false, code: "token_save_failed" });

        expect(secretStorage.setSecret).not.toHaveBeenCalled();
        expect(plugin.getAPITokenCacheState()).toBe("unknown");
        expect(plugin.settings).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "custom",
            baseURL: "https://old.example/v1",
            chatModelName: "old-chat",
            embeddingModelName: "old-embed",
        });
    });

    it("restores the previous token and provider settings when saving fails", async () => {
        const { plugin, secretStorage } = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        const settingsChanged = jest.fn<() => void>();
        plugin.onSettingsChanged(settingsChanged);
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        const saveData = jest.fn<() => Promise<void>>()
            .mockRejectedValueOnce(new Error("save failed"))
            .mockResolvedValue(undefined);
        plugin.saveData = saveData as never;

        const result = await completeSetup(plugin, { presetKey: "openai", token: "sk-new" });

        expect(result).toEqual({ ok: false, code: "settings_save_failed" });
        expect(plugin.settings).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "custom",
            baseURL: "https://old.example/v1",
            chatModelName: "old-chat",
            embeddingModelName: "old-embed",
        });
        expect(secretStorage.setSecret).toHaveBeenNthCalledWith(1, expect.any(String), "sk-new");
        expect(secretStorage.setSecret).toHaveBeenNthCalledWith(2, expect.any(String), "sk-old");
        expect(settingsChanged).not.toHaveBeenCalled();
    });

    it("serializes setup mutation and compensation so an older failure cannot overwrite a newer success", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin, secretStorage } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let releaseFirstSave!: () => void;
        let markFirstSaveStarted!: () => void;
        const firstSaveStarted = new Promise<void>((resolve) => { markFirstSaveStarted = resolve; });
        const firstSaveGate = new Promise<void>((resolve) => { releaseFirstSave = resolve; });
        let saveAttempt = 0;
        plugin.saveData = jest.fn(async (next: unknown) => {
            saveAttempt++;
            if (saveAttempt === 1) {
                markFirstSaveStarted();
                await firstSaveGate;
                throw new Error("first save failed");
            }
            harness.writePersisted(next as Record<string, unknown>);
        }) as never;

        const first = completeSetup(plugin, { presetKey: "openai", token: "sk-first" });
        await firstSaveStarted;
        const second = completeSetup(plugin, { presetKey: "qwen", token: "sk-second" });
        await Promise.resolve();
        await Promise.resolve();

        expect(secretStorage.setSecret).toHaveBeenCalledTimes(1);
        expect(plugin.settings.aiProvider).toBe("qwen");

        releaseFirstSave();
        await expect(first).resolves.toEqual({ ok: false, code: "settings_save_failed" });
        await expect(second).resolves.toEqual({ ok: true });

        expect(secretStorage.setSecret).toHaveBeenNthCalledWith(1, expect.any(String), "sk-first");
        expect(secretStorage.setSecret).toHaveBeenNthCalledWith(2, expect.any(String), "sk-old");
        expect(secretStorage.setSecret).toHaveBeenNthCalledWith(3, expect.any(String), "sk-second");
        expect(plugin.settings).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "qwen",
            baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        });
        expect(harness.readPersisted()).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "qwen",
        });
        expect(plugin.getConfiguredAPITokenSecret()).toBe("sk-second");
    });

    it("waits for an ordinary settings save before staging a provider update that later fails", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
                debug: false,
            },
        });
        const { plugin } = harness;
        await plugin.loadSettings();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let releaseOrdinarySave!: () => void;
        let markOrdinarySaveStarted!: () => void;
        const ordinarySaveStarted = new Promise<void>((resolve) => { markOrdinarySaveStarted = resolve; });
        const ordinarySaveGate = new Promise<void>((resolve) => { releaseOrdinarySave = resolve; });
        let saveAttempt = 0;
        plugin.saveData = jest.fn(async (next: unknown) => {
            saveAttempt++;
            const snapshot = JSON.parse(JSON.stringify(next)) as Record<string, unknown>;
            if (saveAttempt === 1) {
                markOrdinarySaveStarted();
                await ordinarySaveGate;
                harness.writePersisted(snapshot);
                return;
            }
            if (saveAttempt === 2) {
                throw new Error("provider save failed");
            }
            harness.writePersisted(snapshot);
        }) as never;
        const observedProviders: string[] = [];
        plugin.onSettingsChanged(() => { observedProviders.push(plugin.settings.aiProvider); });
        plugin.settings.debug = true;

        const ordinarySave = plugin.saveSettings();
        await ordinarySaveStarted;
        const host = (plugin as unknown as { createChatHost(): { settings: {
            aiProvider: string;
            baseURL: string;
        } } }).createChatHost();
        const epoch = plugin.beginAIProviderConfigurationMutation();
        const providerUpdate = plugin.updateAIProviderConfiguration({
            aiProvider: "openai",
            aiProviderPreset: "openai",
            baseURL: "https://staged.example/v1",
            chatModelName: "staged-chat",
            embeddingModelName: "staged-embed",
        }, epoch);
        await Promise.resolve();
        await Promise.resolve();

        expect(saveAttempt).toBe(1);
        expect(host.settings).toMatchObject({
            aiProvider: "qwen",
            baseURL: "https://old.example/v1",
        });
        expect(plugin.settings.aiProvider).toBe("qwen");
        expect(harness.readPersisted()).toMatchObject({
            aiProvider: "qwen",
            baseURL: "https://old.example/v1",
        });

        releaseOrdinarySave();
        await ordinarySave;
        await expect(providerUpdate).resolves.toEqual({ ok: false, code: "settings_save_failed" });

        expect(saveAttempt).toBe(3);
        expect(plugin.settings).toMatchObject({
            aiProvider: "qwen",
            baseURL: "https://old.example/v1",
            debug: true,
        });
        expect(harness.readPersisted()).toMatchObject({
            aiProvider: "qwen",
            baseURL: "https://old.example/v1",
            debug: true,
        });
        expect(observedProviders).toEqual(["qwen"]);
    });

    it("keeps Chat and Memory consumers on the stable tuple while a provider save is pending", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
                debug: false,
            },
        });
        const { plugin } = harness;
        await plugin.loadSettings();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let releaseProviderSave!: () => void;
        let markProviderSaveStarted!: () => void;
        const providerSaveStarted = new Promise<void>((resolve) => { markProviderSaveStarted = resolve; });
        const providerSaveGate = new Promise<void>((resolve) => { releaseProviderSave = resolve; });
        let saveAttempt = 0;
        plugin.saveData = jest.fn(async (next: unknown) => {
            saveAttempt++;
            const snapshot = JSON.parse(JSON.stringify(next)) as Record<string, unknown>;
            if (saveAttempt === 1) {
                markProviderSaveStarted();
                await providerSaveGate;
                throw new Error("provider save failed");
            }
            harness.writePersisted(snapshot);
        }) as never;
        const observations: Array<{ provider: string; baseURL: string }> = [];
        plugin.onSettingsChanged(() => {
            observations.push({
                provider: plugin.settings.aiProvider,
                baseURL: plugin.settings.baseURL,
            });
        });

        const epoch = plugin.beginAIProviderConfigurationMutation();
        const providerUpdate = plugin.updateAIProviderConfiguration({
            aiProvider: "openai",
            aiProviderPreset: "openai",
            baseURL: "https://staged.example/v1",
            chatModelName: "staged-chat",
            embeddingModelName: "staged-embed",
        }, epoch);
        await providerSaveStarted;
        const chatHost = (plugin as unknown as { createChatHost(): { settings: {
            aiProvider: string;
            baseURL: string;
        } } }).createChatHost();
        const memoryHost = (plugin as unknown as { createMemoryHost(): { settings: {
            aiProvider: string;
            baseURL: string;
        } } }).createMemoryHost();

        expect(chatHost.settings).toMatchObject({
            aiProvider: "qwen",
            baseURL: "https://old.example/v1",
        });
        expect(memoryHost.settings).toMatchObject({
            aiProvider: "qwen",
            baseURL: "https://old.example/v1",
        });
        expect(harness.readPersisted()).toMatchObject({
            aiProvider: "qwen",
            baseURL: "https://old.example/v1",
        });

        plugin.settings.debug = true;
        const ordinarySave = plugin.saveSettings();
        await Promise.resolve();
        await Promise.resolve();
        expect(saveAttempt).toBe(1);
        expect(observations).toEqual([]);

        releaseProviderSave();
        await expect(providerUpdate).resolves.toEqual({ ok: false, code: "settings_save_failed" });
        await ordinarySave;

        expect(saveAttempt).toBe(3);
        expect(plugin.settings).toMatchObject({
            aiProvider: "qwen",
            baseURL: "https://old.example/v1",
            debug: true,
        });
        expect(harness.readPersisted()).toMatchObject({
            aiProvider: "qwen",
            baseURL: "https://old.example/v1",
            debug: true,
        });
        expect(observations).toEqual([{
            provider: "qwen",
            baseURL: "https://old.example/v1",
        }]);
    });

    it("blocks consumers until a pending Settings provider and standalone token edit commit together", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "qwen",
                baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
                chatModelName: "qwen3.6-plus",
                embeddingModelName: "text-embedding-v4",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin, secretStorage } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        expect(await plugin.getAPIToken()).toBe("sk-old");
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let releaseProviderSave!: () => void;
        let markProviderSaveStarted!: () => void;
        const providerSaveStarted = new Promise<void>((resolve) => { markProviderSaveStarted = resolve; });
        const providerSaveGate = new Promise<void>((resolve) => { releaseProviderSave = resolve; });
        plugin.saveData = jest.fn(async (next: unknown) => {
            markProviderSaveStarted();
            await providerSaveGate;
            harness.writePersisted(JSON.parse(JSON.stringify(next)) as Record<string, unknown>);
        }) as never;
        const observations: Array<{ provider: string; issue: string | null }> = [];
        plugin.onSettingsChanged(() => {
            observations.push({
                provider: plugin.settings.aiProvider,
                issue: plugin.getAIReadiness().issue,
            });
        });

        const epoch = plugin.beginAIProviderConfigurationMutation();
        const providerUpdate = plugin.updateAIProviderConfiguration({
            aiProvider: "openai",
            aiProviderPreset: "openai",
            baseURL: "https://api.openai.com/v1",
            chatModelName: "gpt-4o-mini",
            embeddingModelName: "text-embedding-3-small",
        }, epoch);
        await providerSaveStarted;
        plugin.setAPITokenSecret("sk-new");
        const tokenNotification = plugin.notifyAIReadinessChanged();
        const tokenReadsBeforeConsumers = secretStorage.getSecret.mock.calls.length;
        const providerRequests = jest.fn();
        const { AIUtils } = await import("../src/ai-services/ai-utils");
        const memoryUtils = new AIUtils(plugin);
        const chatAttempt = plugin.createChatModel(0.2)
            .then((model) => providerRequests("chat", model));
        const memoryAttempt = memoryUtils.createEmbeddings()
            .then((model) => providerRequests("memory", model));

        await expect(chatAttempt).rejects.toThrow("AI provider configuration is being updated");
        await expect(memoryAttempt).rejects.toThrow("AI provider configuration is being updated");
        expect(secretStorage.getSecret).toHaveBeenCalledTimes(tokenReadsBeforeConsumers);
        expect(providerRequests).not.toHaveBeenCalled();
        expect(plugin.getAIReadiness()).toMatchObject({ ready: false, issue: "token_unknown" });
        expect(observations).toEqual([]);

        releaseProviderSave();
        await expect(providerUpdate).resolves.toEqual({ ok: true });
        await tokenNotification;

        expect(plugin.settings).toMatchObject({
            aiProvider: "openai",
            aiProviderPreset: "openai",
            baseURL: "https://api.openai.com/v1",
        });
        expect(plugin.getConfiguredAPITokenSecret()).toBe("sk-new");
        expect(plugin.getAIReadiness()).toMatchObject({ ready: true, issue: null });
        await expect(plugin.getAPIToken()).resolves.toBe("sk-new");
        expect(observations.length).toBeGreaterThan(0);
        expect(observations.every(({ provider, issue }) => provider === "openai" && issue === null)).toBe(true);
    });

    it("fails provider-missing when a pending Settings provider save fails after a token mutation", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "qwen",
                baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
                chatModelName: "qwen3.6-plus",
                embeddingModelName: "text-embedding-v4",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let releaseProviderFailure!: () => void;
        let markProviderSaveStarted!: () => void;
        const providerSaveStarted = new Promise<void>((resolve) => { markProviderSaveStarted = resolve; });
        const providerFailureGate = new Promise<void>((resolve) => { releaseProviderFailure = resolve; });
        let saveAttempt = 0;
        plugin.saveData = jest.fn(async (next: unknown) => {
            saveAttempt++;
            if (saveAttempt === 1) {
                markProviderSaveStarted();
                await providerFailureGate;
                throw new Error("provider save failed");
            }
            harness.writePersisted(JSON.parse(JSON.stringify(next)) as Record<string, unknown>);
        }) as never;
        const observedIssues: Array<string | null> = [];
        plugin.onSettingsChanged(() => { observedIssues.push(plugin.getAIReadiness().issue); });

        const epoch = plugin.beginAIProviderConfigurationMutation();
        const providerUpdate = plugin.updateAIProviderConfiguration({
            aiProvider: "openai",
            aiProviderPreset: "openai",
            baseURL: "https://api.openai.com/v1",
            chatModelName: "gpt-4o-mini",
            embeddingModelName: "text-embedding-3-small",
        }, epoch);
        await providerSaveStarted;
        plugin.setAPITokenSecret("sk-new");
        const tokenNotification = plugin.notifyAIReadinessChanged();
        expect(plugin.getAIReadiness().issue).toBe("token_unknown");

        releaseProviderFailure();
        await expect(providerUpdate).resolves.toEqual({ ok: false, code: "compensation_failed" });
        await tokenNotification;

        expect(plugin.settings.aiProvider).toBe("");
        expect(plugin.getConfiguredAPITokenSecret()).toBe("sk-new");
        expect(plugin.getAIReadiness().issue).toBe("provider_missing");
        expect(harness.readPersisted()).toMatchObject({ aiProvider: "" });
        expect(observedIssues.length).toBeGreaterThan(0);
        expect(observedIssues.every((issue) => issue === "provider_missing")).toBe(true);

        const reloaded = createPluginHarness({
            initialData: harness.readPersisted(),
            secretStorageValues: { "pa-api-token-default-vault": "sk-new" },
        });
        await reloaded.plugin.loadSettings();
        reloaded.plugin.refreshAPITokenPresence();
        expect(reloaded.plugin.getAIReadiness().issue).toBe("provider_missing");
    });

    it("keeps the credential gate closed until the last queued provider transaction settles", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "qwen",
                baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
                chatModelName: "qwen3.6-plus",
                embeddingModelName: "text-embedding-v4",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let releaseFirstSave!: () => void;
        let markFirstSaveStarted!: () => void;
        let releaseSecondSave!: () => void;
        let markSecondSaveStarted!: () => void;
        const firstSaveStarted = new Promise<void>((resolve) => { markFirstSaveStarted = resolve; });
        const firstSaveGate = new Promise<void>((resolve) => { releaseFirstSave = resolve; });
        const secondSaveStarted = new Promise<void>((resolve) => { markSecondSaveStarted = resolve; });
        const secondSaveGate = new Promise<void>((resolve) => { releaseSecondSave = resolve; });
        let saveAttempt = 0;
        plugin.saveData = jest.fn(async (next: unknown) => {
            saveAttempt++;
            if (saveAttempt === 1) {
                markFirstSaveStarted();
                await firstSaveGate;
            } else if (saveAttempt === 2) {
                markSecondSaveStarted();
                await secondSaveGate;
            }
            harness.writePersisted(JSON.parse(JSON.stringify(next)) as Record<string, unknown>);
        }) as never;
        const observedProviders: string[] = [];
        plugin.onSettingsChanged(() => { observedProviders.push(plugin.settings.aiProviderPreset ?? ""); });

        const firstEpoch = plugin.beginAIProviderConfigurationMutation();
        const first = plugin.updateAIProviderConfiguration({
            aiProvider: "openai",
            aiProviderPreset: "openai",
            baseURL: "https://api.openai.com/v1",
            chatModelName: "gpt-4o-mini",
            embeddingModelName: "text-embedding-3-small",
        }, firstEpoch);
        await firstSaveStarted;
        const secondEpoch = plugin.beginAIProviderConfigurationMutation();
        const second = plugin.updateAIProviderConfiguration({
            aiProvider: "qwen",
            aiProviderPreset: "qwen-intl",
            baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
            chatModelName: "qwen3.6-plus",
            embeddingModelName: "text-embedding-v4",
        }, secondEpoch);

        releaseFirstSave();
        await expect(first).resolves.toEqual({ ok: true });
        await secondSaveStarted;

        expect(plugin.settings.aiProviderPreset).toBe("openai");
        expect(plugin.getAIReadiness()).toMatchObject({ ready: false, issue: "token_unknown" });
        await expect(plugin.getAPIToken()).rejects.toThrow("AI provider configuration is being updated");
        expect(observedProviders).toEqual([]);

        releaseSecondSave();
        await expect(second).resolves.toEqual({ ok: true });

        expect(plugin.settings.aiProviderPreset).toBe("qwen-intl");
        expect(plugin.getAIReadiness()).toMatchObject({ ready: true, issue: null });
        expect(observedProviders).toEqual(["qwen-intl"]);
    });

    it("rejects a queued Chat setup submitted before a later successful Settings provider and token change", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin, secretStorage } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let releaseFirstChatSave!: () => void;
        let markFirstChatSaveStarted!: () => void;
        const firstChatSaveStarted = new Promise<void>((resolve) => { markFirstChatSaveStarted = resolve; });
        const firstChatSaveGate = new Promise<void>((resolve) => { releaseFirstChatSave = resolve; });
        let saveAttempt = 0;
        plugin.saveData = jest.fn(async (next: unknown) => {
            saveAttempt++;
            const snapshot = JSON.parse(JSON.stringify(next)) as Record<string, unknown>;
            if (saveAttempt === 1) {
                markFirstChatSaveStarted();
                await firstChatSaveGate;
            }
            harness.writePersisted(snapshot);
        }) as never;

        const firstChat = completeSetup(plugin, { presetKey: "openai", token: "sk-chat-a" });
        await firstChatSaveStarted;
        const queuedChat = completeSetup(plugin, { presetKey: "qwen", token: "sk-chat-b" });

        plugin.setAPITokenSecret("sk-settings");
        const settingsEpoch = plugin.beginAIProviderConfigurationMutation();
        const settingsSave = plugin.updateAIProviderConfiguration({
            aiProvider: "qwen",
            aiProviderPreset: "qwen-intl",
            baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
            chatModelName: "qwen3.6-plus",
            embeddingModelName: "text-embedding-v4",
        }, settingsEpoch);
        releaseFirstChatSave();

        await expect(firstChat).resolves.toEqual({ ok: true });
        await expect(queuedChat).resolves.toEqual({ ok: false, code: "settings_save_failed" });
        await expect(settingsSave).resolves.toEqual({ ok: true });
        expect(plugin.settings).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "qwen-intl",
            baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        });
        expect(harness.readPersisted()).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "qwen-intl",
            baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        });
        expect(plugin.getConfiguredAPITokenSecret()).toBe("sk-settings");
        expect(secretStorage.setSecret).toHaveBeenCalledTimes(2);
        expect(secretStorage.setSecret).toHaveBeenNthCalledWith(1, expect.any(String), "sk-chat-a");
        expect(secretStorage.setSecret).toHaveBeenNthCalledWith(2, expect.any(String), "sk-settings");
    });

    it("rejects Chat submitted after a text provider draft but before its debounced flush", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin, secretStorage } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;

        const draftEpoch = plugin.beginAIProviderConfigurationMutation();
        const chatSetup = completeSetup(plugin, { presetKey: "openai", token: "sk-chat" });

        await expect(chatSetup).resolves.toEqual({ ok: false, code: "settings_save_failed" });
        expect(secretStorage.setSecret).not.toHaveBeenCalled();

        await expect(plugin.updateAIProviderConfiguration({
            aiProviderPreset: "custom",
            baseURL: "https://draft.example/v1",
        }, draftEpoch)).resolves.toEqual({ ok: true });
        expect(plugin.settings.baseURL).toBe("https://draft.example/v1");
        expect(harness.readPersisted()?.baseURL).toBe("https://draft.example/v1");
    });

    it("fails closed when Chat token compensation precedes a queued Settings save failure", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        const settingsChanged = jest.fn<() => void>();
        plugin.onSettingsChanged(settingsChanged);
        let releaseChatSave!: () => void;
        let markChatSaveStarted!: () => void;
        const chatSaveStarted = new Promise<void>((resolve) => { markChatSaveStarted = resolve; });
        const chatSaveGate = new Promise<void>((resolve) => { releaseChatSave = resolve; });
        let saveAttempt = 0;
        plugin.saveData = jest.fn(async (next: unknown) => {
            saveAttempt++;
            const snapshot = JSON.parse(JSON.stringify(next)) as Record<string, unknown>;
            if (saveAttempt === 1) {
                markChatSaveStarted();
                await chatSaveGate;
                throw new Error("chat save failed");
            }
            if (saveAttempt === 3) {
                throw new Error("settings save failed");
            }
            harness.writePersisted(snapshot);
        }) as never;

        const chatSetup = completeSetup(plugin, { presetKey: "openai", token: "sk-chat" });
        await chatSaveStarted;
        const settingsEpoch = plugin.beginAIProviderConfigurationMutation();
        const settingsSave = plugin.updateAIProviderConfiguration({
            aiProvider: "qwen",
            aiProviderPreset: "qwen-intl",
            baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
            chatModelName: "qwen3.6-plus",
            embeddingModelName: "text-embedding-v4",
        }, settingsEpoch);
        releaseChatSave();

        await expect(chatSetup).resolves.toEqual({ ok: false, code: "settings_save_failed" });
        await expect(settingsSave).resolves.toEqual({ ok: false, code: "compensation_failed" });
        expect(saveAttempt).toBe(4);
        expect(plugin.settings.aiProvider).toBe("");
        expect(plugin.settings.aiProviderPreset).toBeUndefined();
        expect(plugin.getConfiguredAPITokenSecret()).toBe("sk-old");
        expect(harness.readPersisted()).toMatchObject({ aiProvider: "" });
        expect(settingsChanged).toHaveBeenCalledTimes(1);

        const reloaded = createPluginHarness({
            initialData: harness.readPersisted(),
            secretStorageValues: { "pa-api-token": plugin.getConfiguredAPITokenSecret() },
        });
        await reloaded.plugin.loadSettings();
        expect(reloaded.plugin.settings.aiProvider).toBe("");
        expect(reloaded.plugin.getAIReadiness().issue).toBe("provider_missing");
        expect(reloaded.plugin.getConfiguredAPITokenSecret()).toBe("sk-old");
    });

    it("persists an incomplete provider when Settings rollback persistence also fails", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        plugin.saveData = jest.fn<(next: unknown) => Promise<void>>()
            .mockRejectedValueOnce(new Error("settings save failed"))
            .mockRejectedValueOnce(new Error("rollback save failed"))
            .mockImplementationOnce(async (next: unknown) => {
                harness.writePersisted(JSON.parse(JSON.stringify(next)) as Record<string, unknown>);
            }) as never;

        const settingsEpoch = plugin.beginAIProviderConfigurationMutation();
        await expect(plugin.updateAIProviderConfiguration({
            aiProvider: "openai",
            aiProviderPreset: "openai",
            baseURL: "https://api.openai.com/v1",
            chatModelName: "gpt-4o-mini",
            embeddingModelName: "text-embedding-3-small",
        }, settingsEpoch)).resolves.toEqual({ ok: false, code: "compensation_failed" });

        expect(plugin.settings.aiProvider).toBe("");
        expect(plugin.settings.aiProviderPreset).toBeUndefined();
        expect(harness.readPersisted()).toMatchObject({ aiProvider: "" });
        expect(plugin.getAIReadiness().issue).toBe("provider_missing");

        const reloaded = createPluginHarness({
            initialData: harness.readPersisted(),
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        await reloaded.plugin.loadSettings();
        expect(reloaded.plugin.settings.aiProvider).toBe("");
        expect(reloaded.plugin.getAIReadiness().issue).toBe("provider_missing");
    });

    it("restores the old provider but preserves a standalone token saved while Chat persistence is pending", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin, secretStorage } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let releaseChatSave!: () => void;
        let markChatSaveStarted!: () => void;
        const chatSaveStarted = new Promise<void>((resolve) => { markChatSaveStarted = resolve; });
        const chatSaveGate = new Promise<void>((resolve) => { releaseChatSave = resolve; });
        let saveAttempt = 0;
        plugin.saveData = jest.fn(async (next: unknown) => {
            saveAttempt++;
            if (saveAttempt === 1) {
                markChatSaveStarted();
                await chatSaveGate;
                throw new Error("chat save failed");
            }
            harness.writePersisted(next as Record<string, unknown>);
        }) as never;
        const observedProviders: string[] = [];
        plugin.onSettingsChanged(() => {
            observedProviders.push(plugin.settings.aiProvider);
        });

        const chatSetup = completeSetup(plugin, { presetKey: "openai", token: "sk-chat" });
        await chatSaveStarted;
        plugin.setAPITokenSecret("sk-settings");
        const readinessNotification = plugin.notifyAIReadinessChanged();
        await Promise.resolve();
        expect(observedProviders).toEqual([]);
        releaseChatSave();

        await expect(chatSetup).resolves.toEqual({ ok: false, code: "settings_save_failed" });
        await readinessNotification;
        expect(plugin.settings).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "custom",
            baseURL: "https://old.example/v1",
        });
        expect(harness.readPersisted()).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "custom",
        });
        expect(plugin.getConfiguredAPITokenSecret()).toBe("sk-settings");
        expect(secretStorage.setSecret).toHaveBeenCalledTimes(2);
        expect(secretStorage.setSecret).toHaveBeenNthCalledWith(1, expect.any(String), "sk-chat");
        expect(secretStorage.setSecret).toHaveBeenNthCalledWith(2, expect.any(String), "sk-settings");
        expect(observedProviders).toEqual(["qwen"]);
    });

    it("runs a Settings provider choice after the older Chat failure is fully compensated", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin, secretStorage } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let releaseChatSave!: () => void;
        let markChatSaveStarted!: () => void;
        const chatSaveStarted = new Promise<void>((resolve) => { markChatSaveStarted = resolve; });
        const chatSaveGate = new Promise<void>((resolve) => { releaseChatSave = resolve; });
        let saveAttempt = 0;
        plugin.saveData = jest.fn(async (next: unknown) => {
            saveAttempt++;
            if (saveAttempt === 1) {
                markChatSaveStarted();
                await chatSaveGate;
                throw new Error("chat save failed");
            }
            harness.writePersisted(next as Record<string, unknown>);
        }) as never;

        const chatSetup = completeSetup(plugin, { presetKey: "openai", token: "sk-chat" });
        await chatSaveStarted;
        const settingsEpoch = plugin.beginAIProviderConfigurationMutation();
        const settingsSave = plugin.updateAIProviderConfiguration({
            aiProvider: "qwen",
            aiProviderPreset: "qwen-intl",
            baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
            chatModelName: "qwen3.6-plus",
            embeddingModelName: "text-embedding-v4",
        }, settingsEpoch);
        releaseChatSave();

        await expect(chatSetup).resolves.toEqual({ ok: false, code: "settings_save_failed" });
        await expect(settingsSave).resolves.toEqual({ ok: true });
        expect(plugin.settings).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "qwen-intl",
            baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        });
        expect(harness.readPersisted()).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "qwen-intl",
            baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        });
        expect(plugin.getConfiguredAPITokenSecret()).toBe("sk-old");
        expect(secretStorage.setSecret).toHaveBeenCalledTimes(2);
    });

    it("persists provider-missing and keeps the new token when token rollback fails", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin, secretStorage } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        const defaultSetSecret = secretStorage.setSecret.getMockImplementation();
        expect(defaultSetSecret).toBeDefined();
        secretStorage.setSecret
            .mockImplementationOnce(defaultSetSecret!)
            .mockImplementationOnce(() => { throw new Error("restore failed"); });
        let saveAttempt = 0;
        plugin.saveData = jest.fn(async (next: unknown) => {
            saveAttempt++;
            if (saveAttempt === 1) throw new Error("save failed");
            harness.writePersisted(JSON.parse(JSON.stringify(next)) as Record<string, unknown>);
        }) as never;
        const observedProviders: string[] = [];
        plugin.onSettingsChanged(() => { observedProviders.push(plugin.settings.aiProvider); });

        const result = await completeSetup(plugin, { presetKey: "openai", token: "sk-new" });

        expect(result).toEqual({ ok: false, code: "compensation_failed" });
        expect(plugin.getAPITokenCacheState()).toBe("unknown");
        expect(plugin.getConfiguredAPITokenSecret()).toBe("sk-new");
        expect(plugin.settings.aiProvider).toBe("");
        expect(harness.readPersisted()).toMatchObject({ aiProvider: "" });
        expect(observedProviders).toEqual([""]);

        const reloaded = createPluginHarness({
            initialData: harness.readPersisted(),
            secretStorageValues: { "pa-api-token": "sk-new" },
        });
        await reloaded.plugin.loadSettings();
        reloaded.plugin.refreshAPITokenPresence();
        expect(reloaded.plugin.getAIReadiness().issue).toBe("provider_missing");
    });

    it("fails closed on reload when both an initial token write and its restore throw", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin, secretStorage } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        const defaultSetSecret = secretStorage.setSecret.getMockImplementation();
        expect(defaultSetSecret).toBeDefined();
        secretStorage.setSecret
            .mockImplementationOnce((id: string, value: string) => {
                defaultSetSecret!(id, value);
                throw new Error("write surfaced a failure after persistence");
            })
            .mockImplementationOnce(() => { throw new Error("restore failed"); });
        plugin.saveData = jest.fn(async (next: unknown) => {
            harness.writePersisted(JSON.parse(JSON.stringify(next)) as Record<string, unknown>);
        }) as never;
        const observedProviders: string[] = [];
        plugin.onSettingsChanged(() => { observedProviders.push(plugin.settings.aiProvider); });

        await expect(completeSetup(plugin, {
            presetKey: "openai",
            token: "sk-new",
        })).resolves.toEqual({ ok: false, code: "compensation_failed" });

        expect(plugin.getConfiguredAPITokenSecret()).toBe("sk-new");
        expect(plugin.settings.aiProvider).toBe("");
        expect(harness.readPersisted()).toMatchObject({ aiProvider: "" });
        expect(observedProviders).toEqual([""]);

        const reloaded = createPluginHarness({
            initialData: harness.readPersisted(),
            secretStorageValues: { "pa-api-token": "sk-new" },
        });
        await reloaded.plugin.loadSettings();
        reloaded.plugin.refreshAPITokenPresence();
        expect(reloaded.plugin.getAIReadiness().issue).toBe("provider_missing");
    });

    it("does not start Memory preparation when the embedding model is missing", async () => {
        const { plugin } = createPluginHarness({
            initialData: {
                aiProvider: "openai",
                baseURL: "https://api.openai.com/v1",
                chatModelName: "gpt-4o-mini",
                embeddingModelName: "",
            },
        });
        await plugin.loadSettings();
        plugin.setAPITokenSecret("sk-test");
        const getMaintenancePlan = jest.fn(async () => ({
            reason: "first-use" as const,
            action: "rebuild" as const,
            notesToCheck: 1,
            requiresApproval: false,
            canAnswerNow: true,
        }));
        const prepareFromCommand = jest.fn(async () => undefined);
        const ensureReadyForChat = jest.fn(async () => ({ decision: "use-memory" as const }));
        (plugin as unknown as { memoryManager: unknown }).memoryManager = {
            getMaintenancePlan,
            prepareFromCommand,
            ensureReadyForChat,
        };
        const host = (plugin as unknown as { createChatHost(): { memoryStatus: {
            getMaintenancePlan(): Promise<{ reason: string }>;
            prepareFromCommand(): Promise<void>;
        } } }).createChatHost();

        await expect(host.memoryStatus.getMaintenancePlan()).resolves.toMatchObject({ reason: "unavailable" });
        await host.memoryStatus.prepareFromCommand();
        await expect((plugin as unknown as {
            ensureMemoryReadyForChat(query?: string): Promise<{ decision: string }>;
        }).ensureMemoryReadyForChat("question")).resolves.toEqual({ decision: "answer-now" });
        expect(getMaintenancePlan).not.toHaveBeenCalled();
        expect(prepareFromCommand).not.toHaveBeenCalled();
        expect(ensureReadyForChat).not.toHaveBeenCalled();
    });

    it("persists Memory admission compensation during unload and reloads the prior policy", async () => {
        const harness = createPluginHarness({
            initialData: { memoryApprovalPolicy: "always" },
        });
        const { plugin } = harness;
        await plugin.loadSettings();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        (plugin as unknown as { settingsMigrationBaselineFingerprint: null }).settingsMigrationBaselineFingerprint = null;
        let saveAttempt = 0;
        plugin.saveData = jest.fn(async (next: unknown) => {
            harness.writePersisted(next as Record<string, unknown>);
            saveAttempt++;
            if (saveAttempt === 1) throw new Error("write completed before failure surfaced");
        }) as never;
        const host = (plugin as unknown as { createMemoryHost(): {
            updateMemorySetting(key: "memoryApprovalPolicy", value: string): void;
            persistMemoryAdmissionSettings(): Promise<void>;
        } }).createMemoryHost();

        host.updateMemorySetting("memoryApprovalPolicy", "auto-refresh-after-prepare");
        await expect(host.persistMemoryAdmissionSettings()).rejects.toThrow("write completed before failure surfaced");
        expect(harness.readPersisted()?.memoryApprovalPolicy).toBe("auto-refresh-after-prepare");

        (plugin as unknown as { unloading: boolean }).unloading = true;
        host.updateMemorySetting("memoryApprovalPolicy", "always");
        await expect(host.persistMemoryAdmissionSettings()).resolves.toBeUndefined();
        expect(harness.readPersisted()?.memoryApprovalPolicy).toBe("always");

        const reloaded = createPluginHarness({ initialData: harness.readPersisted() });
        await reloaded.plugin.loadSettings();
        expect(reloaded.plugin.settings.memoryApprovalPolicy).toBe("always");
    });

    it("drains cancelled Memory work before disposing VSS during unload", async () => {
        const { plugin } = createPluginHarness();
        const order: string[] = [];
        let releaseIdle!: () => void;
        const idle = new Promise<void>((resolve) => { releaseIdle = resolve; });
        const stopAutoMaintenance = jest.fn(() => { order.push("stop"); });
        const waitForIdle = jest.fn(async () => {
            order.push("drain-start");
            await idle;
            order.push("drain-finished");
        });
        const dispose = jest.fn(async () => { order.push("dispose"); });
        const internals = plugin as unknown as Record<string, unknown>;
        internals.memoryManager = { stopAutoMaintenance, waitForIdle };
        internals.vss = { dispose };
        internals.phase3Handle = null;
        internals.resizeDebounceTimer = null;
        internals.hoverPopoverObserver = null;
        internals.debouncedStatusBarUpdate = { cancel: jest.fn() };
        internals.resetDeepDiscoverController = jest.fn();
        internals.cancelMemoryForgetRetry = jest.fn();
        internals.cancelMemoryProfileProjectionRetry = jest.fn();
        internals.cancelMemoryGovernanceGarbageCollection = jest.fn();

        const unloading = (plugin as unknown as { unloadAsync(): Promise<void> }).unloadAsync();
        await Promise.resolve();
        await Promise.resolve();

        expect(order).toEqual(["stop", "drain-start"]);
        expect(dispose).not.toHaveBeenCalled();
        releaseIdle();
        await unloading;

        expect(order).toEqual(["stop", "drain-start", "drain-finished", "dispose"]);
    });

    it("drains a Settings provider update accepted immediately before unload", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "qwen",
                baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
                chatModelName: "qwen3.6-plus",
                embeddingModelName: "text-embedding-v4",
            },
        });
        const { plugin } = harness;
        await plugin.loadSettings();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let releaseSave!: () => void;
        let markSaveStarted!: () => void;
        const saveStarted = new Promise<void>((resolve) => { markSaveStarted = resolve; });
        const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
        plugin.saveData = jest.fn(async (next: unknown) => {
            markSaveStarted();
            await saveGate;
            harness.writePersisted(JSON.parse(JSON.stringify(next)) as Record<string, unknown>);
        }) as never;
        const dispose = prepareForUnload(plugin);

        const epoch = plugin.beginAIProviderConfigurationMutation();
        const update = plugin.updateAIProviderConfiguration({
            aiProvider: "openai",
            aiProviderPreset: "openai",
            baseURL: "https://api.openai.com/v1",
            chatModelName: "gpt-4o-mini",
            embeddingModelName: "text-embedding-3-small",
        }, epoch);
        const unloading = (plugin as unknown as { unloadAsync(): Promise<void> }).unloadAsync();

        await saveStarted;
        expect(dispose).not.toHaveBeenCalled();
        releaseSave();
        await expect(update).resolves.toEqual({ ok: true });
        await unloading;

        expect(dispose).toHaveBeenCalledTimes(1);
        expect(harness.readPersisted()).toMatchObject({
            aiProvider: "openai",
            aiProviderPreset: "openai",
        });
    });

    it("drains Chat setup submitted immediately before unload even if it has not started", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "qwen",
                baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
                chatModelName: "qwen3.6-plus",
                embeddingModelName: "text-embedding-v4",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let releaseSave!: () => void;
        let markSaveStarted!: () => void;
        const saveStarted = new Promise<void>((resolve) => { markSaveStarted = resolve; });
        const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
        plugin.saveData = jest.fn(async (next: unknown) => {
            markSaveStarted();
            await saveGate;
            harness.writePersisted(JSON.parse(JSON.stringify(next)) as Record<string, unknown>);
        }) as never;
        const dispose = prepareForUnload(plugin);

        const setup = completeSetup(plugin, { presetKey: "openai", token: "sk-new" });
        const unloading = (plugin as unknown as { unloadAsync(): Promise<void> }).unloadAsync();

        await saveStarted;
        expect(dispose).not.toHaveBeenCalled();
        releaseSave();
        await expect(setup).resolves.toEqual({ ok: true });
        await unloading;

        expect(dispose).toHaveBeenCalledTimes(1);
        expect(harness.readPersisted()).toMatchObject({
            aiProvider: "openai",
            aiProviderPreset: "openai",
        });
    });

    it("drains a queued inline setup save before unload and reloads a consistent provider token", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin, secretStorage } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let releaseSave!: () => void;
        let markSaveStarted!: () => void;
        const saveStarted = new Promise<void>((resolve) => { markSaveStarted = resolve; });
        const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
        plugin.saveData = jest.fn(async (next: unknown) => {
            markSaveStarted();
            await saveGate;
            harness.writePersisted(next as Record<string, unknown>);
        }) as never;
        const internals = plugin as unknown as Record<string, unknown>;
        internals.memoryManager = {
            cancelActivePreparation: jest.fn(),
            stopAutoMaintenance: jest.fn(),
            waitForIdle: jest.fn(async () => undefined),
        };
        const dispose = jest.fn(async () => undefined);
        internals.vss = { dispose };
        internals.phase3Handle = null;
        internals.resizeDebounceTimer = null;
        internals.hoverPopoverObserver = null;
        internals.debouncedStatusBarUpdate = { cancel: jest.fn() };
        internals.resetDeepDiscoverController = jest.fn();
        internals.cancelMemoryForgetRetry = jest.fn();
        internals.cancelMemoryProfileProjectionRetry = jest.fn();
        internals.cancelMemoryGovernanceGarbageCollection = jest.fn();

        const setup = completeSetup(plugin, { presetKey: "openai", token: "sk-new" });
        await saveStarted;
        const unloading = (plugin as unknown as { unloadAsync(): Promise<void> }).unloadAsync();
        await Promise.resolve();
        expect(dispose).not.toHaveBeenCalled();

        releaseSave();
        await expect(setup).resolves.toEqual({ ok: true });
        await unloading;
        expect(dispose).toHaveBeenCalledTimes(1);

        const persisted = harness.readPersisted();
        expect(persisted).toMatchObject({
            aiProvider: "openai",
            aiProviderPreset: "openai",
        });
        const persistedToken = secretStorage.getSecret("pa-api-token") as string;
        const reloaded = createPluginHarness({
            initialData: persisted,
            secretStorageValues: { "pa-api-token": persistedToken },
        });
        await reloaded.plugin.loadSettings();
        reloaded.plugin.refreshAPITokenPresence();
        expect(reloaded.plugin.settings.aiProvider).toBe("openai");
        expect(reloaded.plugin.getAPITokenCacheState()).toBe("present");
    });

    it("waits for inline setup compensation after a persisted save rejects during unload", async () => {
        const harness = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                aiProviderPreset: "custom",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        const { plugin, secretStorage } = harness;
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        let markFirstPersisted!: () => void;
        let releaseFirstFailure!: () => void;
        let markCompensationStarted!: () => void;
        let releaseCompensation!: () => void;
        const firstPersisted = new Promise<void>((resolve) => { markFirstPersisted = resolve; });
        const firstFailureGate = new Promise<void>((resolve) => { releaseFirstFailure = resolve; });
        const compensationStarted = new Promise<void>((resolve) => { markCompensationStarted = resolve; });
        const compensationGate = new Promise<void>((resolve) => { releaseCompensation = resolve; });
        let saveAttempt = 0;
        plugin.saveData = jest.fn(async (next: unknown) => {
            saveAttempt++;
            if (saveAttempt === 1) {
                harness.writePersisted(next as Record<string, unknown>);
                markFirstPersisted();
                await firstFailureGate;
                throw new Error("save rejected after persistence");
            }
            markCompensationStarted();
            await compensationGate;
            harness.writePersisted(next as Record<string, unknown>);
        }) as never;
        const internals = plugin as unknown as Record<string, unknown>;
        internals.memoryManager = {
            cancelActivePreparation: jest.fn(),
            stopAutoMaintenance: jest.fn(),
            waitForIdle: jest.fn(async () => undefined),
        };
        const dispose = jest.fn(async () => undefined);
        internals.vss = { dispose };
        internals.phase3Handle = null;
        internals.resizeDebounceTimer = null;
        internals.hoverPopoverObserver = null;
        internals.debouncedStatusBarUpdate = { cancel: jest.fn() };
        internals.resetDeepDiscoverController = jest.fn();
        internals.cancelMemoryForgetRetry = jest.fn();
        internals.cancelMemoryProfileProjectionRetry = jest.fn();
        internals.cancelMemoryGovernanceGarbageCollection = jest.fn();

        const setup = completeSetup(plugin, { presetKey: "openai", token: "sk-new" });
        await firstPersisted;
        expect(harness.readPersisted()).toMatchObject({ aiProvider: "openai" });
        const unloading = (plugin as unknown as { unloadAsync(): Promise<void> }).unloadAsync();
        releaseFirstFailure();
        await compensationStarted;

        expect(dispose).not.toHaveBeenCalled();
        expect(secretStorage.getSecret("pa-api-token")).toBe("sk-old");
        expect(harness.readPersisted()).toMatchObject({ aiProvider: "openai" });

        releaseCompensation();
        await expect(setup).resolves.toEqual({ ok: false, code: "settings_save_failed" });
        await unloading;
        expect(dispose).toHaveBeenCalledTimes(1);
        expect(harness.readPersisted()).toMatchObject({
            aiProvider: "qwen",
            aiProviderPreset: "custom",
        });

        const reloaded = createPluginHarness({
            initialData: harness.readPersisted(),
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        await reloaded.plugin.loadSettings();
        reloaded.plugin.refreshAPITokenPresence();
        expect(reloaded.plugin.settings.aiProvider).toBe("qwen");
        expect(reloaded.plugin.getAPITokenCacheState()).toBe("present");
    });

    it("rejects inline setup started after unload without writing the token", async () => {
        const { plugin, secretStorage } = createPluginHarness({
            initialData: { aiProvider: "" },
        });
        await plugin.loadSettings();
        (plugin as unknown as { unloading: boolean }).unloading = true;

        await expect(completeSetup(plugin, {
            presetKey: "openai",
            token: "sk-should-not-write",
        })).resolves.toEqual({ ok: false, code: "settings_save_failed" });

        expect(secretStorage.setSecret).not.toHaveBeenCalled();
    });
});
