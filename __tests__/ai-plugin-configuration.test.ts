import { describe, expect, it, jest } from "@jest/globals";

import {
    PluginAIConfiguration,
    type PluginAIConfigurationDependencies,
} from "../src/ai-services/plugin-configuration";
import { DEFAULT_SETTINGS, type PluginManagerSettings } from "../src/settings";

function cloneSettings(): PluginManagerSettings {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as PluginManagerSettings;
}

function createFixture() {
    const settings = cloneSettings();
    settings.aiProvider = "openai";
    settings.baseURL = "https://api.openai.com/v1";
    settings.chatModelName = "gpt-4o-mini";
    settings.embeddingModelName = "text-embedding-3-small";
    settings.statisticsVaultId = "ai-owner";
    const secrets = new Map<string, string | null>();
    let failSave = false;
    const saveSettingsData = jest.fn(async (_snapshot: PluginManagerSettings) => {
        if (failSave) throw new Error("synthetic settings failure");
    });
    const secretStorage = {
        getSecret: jest.fn((id: string) => secrets.get(id) ?? null),
        setSecret: jest.fn((id: string, value: string) => { secrets.set(id, value); }),
    };
    const dependencies: PluginAIConfigurationDependencies = {
        getSettings: () => settings,
        isUnloading: () => false,
        getSecretStorage: () => secretStorage,
        enqueueSettingsWrite: (operation) => operation(),
        saveSettingsData,
        trackRequiredSettingsTransaction: (operation) => operation,
        notifySettingsChanged: jest.fn(async () => undefined),
        cancelActivePreparation: jest.fn(),
        translateSetupIssue: (issue) => issue,
        showTokenMissingNotice: jest.fn(),
        log: jest.fn(),
    };
    const owner = new PluginAIConfiguration(dependencies);
    return {
        owner,
        settings,
        secrets,
        secretStorage,
        dependencies,
        saveSettingsData,
        failNextSave: () => { failSave = true; },
    };
}

describe("B-143 AI plugin configuration owner", () => {
    it("keeps construction and passive readiness checks free of SecretStorage reads", () => {
        const { owner, secretStorage } = createFixture();

        expect(owner.getAIReadiness()).toMatchObject({ ready: false, issue: "token_unknown" });
        owner.getImageGenerationConnection();
        expect(secretStorage.getSecret).not.toHaveBeenCalled();
    });

    it("persists a provider tuple before publishing it and settles one stable notification", async () => {
        const { owner, settings, dependencies, saveSettingsData } = createFixture();
        const epoch = owner.beginProviderConfigurationMutation();
        saveSettingsData.mockImplementationOnce(async (snapshot) => {
            expect(settings.aiProvider).toBe("openai");
            expect(snapshot.aiProvider).toBe("qwen");
            expect(owner.getAIReadiness().issue).toBe("token_unknown");
        });

        await expect(owner.updateAIProviderConfiguration({
            aiProvider: "qwen",
            baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
            chatModelName: "qwen-plus",
            embeddingModelName: "text-embedding-v4",
        }, epoch)).resolves.toEqual({ ok: true });

        expect(settings.aiProvider).toBe("qwen");
        expect(dependencies.notifySettingsChanged).toHaveBeenCalledTimes(1);
        expect(owner.hasActiveCredentialTransition()).toBe(false);
    });

    it("keeps dedicated image secret rollback outside the AI transaction tail", async () => {
        const { owner, settings, secrets, failNextSave } = createFixture();
        settings.imageGenerationConnectionMode = "dedicated-wan";
        settings.imageGenerationBaseURL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
        const secretId = owner.getImageAPITokenSecretId();
        secrets.set(secretId, "previous-image-token");
        failNextSave();

        await expect(owner.setImageAPITokenSecret("replacement-image-token"))
            .rejects.toThrow("synthetic settings failure");

        expect(secrets.get(secretId)).toBe("previous-image-token");
        expect(owner.getTransactionTailForCompatibility()).toBeNull();
    });
});
