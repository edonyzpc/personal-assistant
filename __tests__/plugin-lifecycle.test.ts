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

    it("fails safe when token compensation also fails", async () => {
        const { plugin, secretStorage } = createPluginHarness({
            initialData: {
                aiProvider: "qwen",
                baseURL: "https://old.example/v1",
                chatModelName: "old-chat",
                embeddingModelName: "old-embed",
            },
            secretStorageValues: { "pa-api-token": "sk-old" },
        });
        await plugin.loadSettings();
        plugin.refreshAPITokenPresence();
        (plugin as unknown as { legacyMemoryCompatibilityBarrier: null }).legacyMemoryCompatibilityBarrier = null;
        secretStorage.setSecret
            .mockImplementationOnce(() => undefined)
            .mockImplementationOnce(() => { throw new Error("restore failed"); });
        const saveData = jest.fn<() => Promise<void>>()
            .mockRejectedValueOnce(new Error("save failed"))
            .mockResolvedValue(undefined);
        plugin.saveData = saveData as never;

        const result = await completeSetup(plugin, { presetKey: "openai", token: "sk-new" });

        expect(result).toEqual({ ok: false, code: "compensation_failed" });
        expect(plugin.getAPITokenCacheState()).toBe("unknown");
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
