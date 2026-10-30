import { describe, expect, it, jest } from "@jest/globals";

import {
    PluginAIConfiguration,
    type PluginAIConfigurationDependencies,
} from "../src/ai-services/plugin-configuration";
import { DEFAULT_SETTINGS, type PluginManagerSettings } from "../src/settings";
import type { AIConnectionsSettings } from "../src/ai-services/ai-connection-types";
import { KEYCHAIN_API_TOKEN_ID } from "../src/utils";

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
        listSecrets: jest.fn(() => [...secrets.keys()]),
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

describe("B-192 saved connection credentials", () => {
    it("preserves web search when updating only the thinking option", async () => {
        const { owner } = createFixture();
        const connection = await owner.createAIConnection({ providerId: "dashscope-cn",
            options: { chat: { enableThinking: false, webSearchEnabled: true } } }, "key", "default");
        await owner.updateAIConnection(connection.id, { options: { chat: { enableThinking: true } } });
        expect(owner.getAIConnections()!.connections[0].options.chat).toEqual({
            enableThinking: true, webSearchEnabled: true,
        });
    });

    it("keeps each connection's key and model while switching defaults and preserving explicit bindings", async () => {
        const { owner, secrets, secretStorage } = createFixture();
        expect(owner.getAIConnections()).toBeUndefined();
        expect(secretStorage.getSecret).not.toHaveBeenCalled();
        const a = await owner.createAIConnection({ providerId: "dashscope-cn" }, "key-a", "default");
        const b = await owner.createAIConnection({ providerId: "openai" }, "key-b");
        await owner.setAIPurposeBinding("embedding", { mode: "connection", connectionId: a.id });
        const selection = owner.getAIConnections()!.memorySelection;
        await owner.setDefaultAIConnection(b.id);
        expect(owner.getAIConnections()!.memorySelection).toEqual(selection);
        expect(owner.getAIConnections()!.bindings.embedding).toEqual({ mode: "connection", connectionId: a.id });
        expect(await owner.getAIConnectionToken(a.id)).toBe("key-a");
        expect(await owner.getAIConnectionToken(b.id)).toBe("key-b");
        expect(secrets.get(a.secretRef)).toBe("key-a");
        expect(a.secretRef).toMatch(/^pa-dashscope-cn-[a-z0-9]{10}$/);
        expect(a.secretRef).not.toContain("ai-owner");
        expect(a.secretRef).not.toBe(b.secretRef);
    });

    it("keeps a lease valid on rename but revokes only that connection on key replacement", async () => {
        const { owner, dependencies } = createFixture();
        const a = await owner.createAIConnection({ providerId: "openai" }, "key-a", "default");
        const b = await owner.createAIConnection({ providerId: "openai" }, "key-b");
        expect(b.name).not.toBe(a.name);
        const leaseA = await owner.acquireCredentialLease(a.id);
        const leaseB = await owner.acquireCredentialLease(b.id);
        const selection = owner.getAIConnections()!.memorySelection;
        dependencies.cancelActivePreparation = jest.fn();
        const renamed = await owner.updateAIConnection(a.id, { name: "Personal" });
        expect(renamed.secretRef).toBe(a.secretRef);
        expect(renamed.revision).toBe(a.revision);
        expect(leaseA.isCurrent()).toBe(true);
        expect(dependencies.cancelActivePreparation).not.toHaveBeenCalled();
        await owner.updateAIConnection(a.id, {}, "replacement");
        expect(leaseA.isCurrent()).toBe(false);
        expect(leaseB.isCurrent()).toBe(true);
        expect(owner.getAIConnections()!.memorySelection).toEqual(selection);
        expect(await owner.getAIConnectionToken(a.id)).toBe("replacement");
    });

    it("publishes the connection only after settings save, and compensates a failed key write transaction", async () => {
        const { owner, settings, secrets, saveSettingsData } = createFixture();
        saveSettingsData.mockImplementationOnce(async (snapshot) => {
            expect(owner.getAIConnections()).toBeUndefined();
            expect(JSON.stringify(snapshot)).not.toContain("private-key");
            throw new Error("synthetic settings failure");
        });
        await expect(owner.createAIConnection({ providerId: "openai" }, "private-key", "default"))
            .rejects.toThrow("settings");
        expect(owner.getAIConnections()).toBeUndefined();
        expect([...secrets.values()].filter(Boolean)).toEqual([]);
        expect(settings.aiProvider).toBe("openai");
    });

    it("records a new embedding selection in the same durable settings commit", async () => {
        const { owner, saveSettingsData } = createFixture();
        const a = await owner.createAIConnection({ providerId: "dashscope-cn" }, "a", "default");
        const b = await owner.createAIConnection({ providerId: "openai" }, "b");
        const previous = owner.getAIConnections()!.memorySelection.revision;
        await owner.setDefaultAIConnection(b.id);
        const snapshot = saveSettingsData.mock.calls.at(-1)![0] as PluginManagerSettings & { aiConnections: AIConnectionsSettings };
        expect(snapshot.aiConnections.defaultConnectionId).toBe(b.id);
        expect(snapshot.aiConnections.memorySelection).toMatchObject({ cause: "configuration-change" });
        expect(snapshot.aiConnections.memorySelection.revision).not.toBe(previous);
        await owner.setDefaultAIConnection(a.id);
        expect(owner.getAIConnections()!.memorySelection.cause).toBe("configuration-change");
    });

    it("preserves and associates the actual sole fallback slot without reading its value", async () => {
        const { owner, secrets, secretStorage } = createFixture();
        secrets.set(KEYCHAIN_API_TOKEN_ID, "legacy-private");
        const migrated = await owner.migrateLegacyAIConnections({ providerId: "openai" });
        expect(migrated.connections[0].secretRef).toBe(KEYCHAIN_API_TOKEN_ID);
        expect(secretStorage.getSecret).not.toHaveBeenCalled();
        expect(secretStorage.setSecret).not.toHaveBeenCalled();
        expect(migrated.connections[0].models.chat).toBe("gpt-4o-mini");
        expect(await owner.migrateLegacyAIConnections()).toEqual(migrated);
        expect(await owner.getAIConnectionToken(migrated.connections[0].id)).toBe("legacy-private");
    });

    it("does not guess legacy credential provider or choose among ambiguous old slots", async () => {
        const { owner, secrets, secretStorage } = createFixture();
        secrets.set(KEYCHAIN_API_TOKEN_ID, "old-global");
        await expect(owner.migrateLegacyAIConnections()).rejects.toThrow("provider");
        secrets.set(owner.getAPITokenSecretId(), "old-current");
        await expect(owner.migrateLegacyAIConnections({ providerId: "openai" })).rejects.toThrow("ambiguous");
        expect(owner.getAIConnections()).toBeUndefined();
        expect(secretStorage.getSecret).not.toHaveBeenCalled();
    });

    it("migrates an explicitly entered new key without reading or changing ambiguous old slots", async () => {
        const { owner, settings, secrets, secretStorage, saveSettingsData } = createFixture();
        secrets.set(KEYCHAIN_API_TOKEN_ID, "old-global");
        secrets.set(owner.getAPITokenSecretId(), "old-current");
        const migrated = await owner.migrateLegacyAIConnections({ providerId: "openai", key: " new-openai-key " });
        const connection = migrated.connections[0];
        expect(connection).toMatchObject({ providerId: "openai", secretOwned: true,
            endpoints: { chat: settings.baseURL, embedding: settings.baseURL },
            models: { chat: settings.chatModelName, embedding: settings.embeddingModelName } });
        expect(connection.secretRef).toMatch(/^pa-openai-[a-z0-9]{10}$/);
        expect(secrets.get(connection.secretRef)).toBe("new-openai-key");
        expect(secrets.get(KEYCHAIN_API_TOKEN_ID)).toBe("old-global");
        expect(secrets.get(owner.getAPITokenSecretId())).toBe("old-current");
        expect(secretStorage.getSecret).not.toHaveBeenCalled();
        expect(secretStorage.setSecret).toHaveBeenCalledTimes(1);
        expect(saveSettingsData).toHaveBeenCalledTimes(1);
    });

    it("detaches a shared legacy key durably without deleting another connection's credential", async () => {
        const { owner, settings, secrets, dependencies } = createFixture();
        secrets.set(KEYCHAIN_API_TOKEN_ID, "shared");
        const migrated = await owner.migrateLegacyAIConnections({ providerId: "openai" });
        const a = migrated.connections[0];
        const b = { ...a, id: "second-legacy", name: "Second" };
        (settings as PluginManagerSettings & { aiConnections: AIConnectionsSettings }).aiConnections.connections.push(b);
        const lease = await owner.acquireCredentialLease(a.id);
        await owner.removeAIConnectionKey(a.id);
        expect(lease.isCurrent()).toBe(false);
        expect(secrets.get(KEYCHAIN_API_TOKEN_ID)).toBe("shared");
        const reloaded = new PluginAIConfiguration(dependencies);
        expect(await reloaded.getAIConnectionToken(a.id)).toBe("");
        expect(await reloaded.getAIConnectionToken(b.id)).toBe("shared");
    });

    it("requires explicit replacement for referenced deletion and preserves unrelated credentials", async () => {
        const { owner, secrets } = createFixture();
        const a = await owner.createAIConnection({ providerId: "openai" }, "a", "default");
        const b = await owner.createAIConnection({ providerId: "openai" }, "b");
        await expect(owner.deleteAIConnection(a.id)).rejects.toThrow("referenced");
        await owner.deleteAIConnection(a.id, { defaultConnectionId: b.id });
        expect(owner.getAIConnections()!.defaultConnectionId).toBe(b.id);
        expect(secrets.get(a.secretRef)).toBe("");
        expect(await owner.getAIConnectionToken(b.id)).toBe("b");
    });

    it("fails closed when secret names cannot be enumerated and leaves blank replacement unchanged", async () => {
        const { owner, secretStorage } = createFixture();
        const a = await owner.createAIConnection({ providerId: "openai" }, "a", "default");
        await owner.updateAIConnection(a.id, {}, "  ");
        expect(await owner.getAIConnectionToken(a.id)).toBe("a");
        secretStorage.listSecrets.mockImplementationOnce(() => { throw new Error("locked"); });
        await expect(owner.createAIConnection({ providerId: "openai" }, "b")).rejects.toThrow("secret");
        expect(owner.getAIConnections()!.connections).toHaveLength(1);
    });

    it("uses purpose-specific readiness and invalidates Chat only when Chat's request actually changes", async () => {
        const { owner } = createFixture();
        const chat = await owner.createAIConnection({ providerId: "openai" }, "chat", "default");
        const memory = await owner.createAIConnection({ providerId: "dashscope-cn" }, undefined, "embedding");
        await owner.setAIPurposeBinding("chat", { mode: "connection", connectionId: chat.id });
        const revision = owner.getProviderConfigurationRevision();
        const tokenRevision = owner.getTokenRevision();
        await owner.setDefaultAIConnection(memory.id);
        await owner.updateAIConnection(chat.id, { models: { image: "new-image" }, options: { embeddingDimensions: 1536 } });
        expect(owner.getProviderConfigurationRevision()).toBe(revision);
        expect(owner.getTokenRevision()).toBe(tokenRevision);
        expect(owner.getAIReadiness("chat")).toMatchObject({ ready: true, chatModelName: chat.models.chat });
        expect(owner.getAIReadiness("memory")).toMatchObject({ ready: false, issue: "token_missing" });
        await owner.getAIConnectionToken(memory.id);
        expect(owner.getAIReadiness("memory").issue).toBe("token_missing");
        await owner.updateAIConnection(memory.id, {}, "memory");
        expect(owner.getTokenRevision()).toBe(tokenRevision);
        expect(owner.getAIReadiness("memory").ready).toBe(true);
        await owner.updateAIConnection(chat.id, { models: { chat: "new-chat" } });
        expect(owner.getProviderConfigurationRevision()).toBe(revision + 1);
    });

    it("copy-on-writes a legacy key and preserves dedicated Wan settings without exposing secrets", async () => {
        const { owner, settings, secrets, secretStorage } = createFixture();
        settings.imageGenerationConnectionMode = "dedicated-wan";
        settings.imageGenerationBaseURL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
        settings.policyModelName = "retained-policy";
        secrets.set(KEYCHAIN_API_TOKEN_ID, "shared-old");
        secrets.set(owner.getImageAPITokenSecretId(), "image-old");
        const migrated = await owner.migrateLegacyAIConnections({ providerId: "openai" });
        const chat = migrated.connections[0];
        expect(migrated.connections[1]).toMatchObject({ providerId: "dashscope-intl", secretRef: owner.getImageAPITokenSecretId() });
        expect(migrated.bindings.image).toEqual({ mode: "connection", connectionId: migrated.connections[1].id });
        expect(chat.models.policy).toBe("retained-policy");
        expect(secretStorage.getSecret).not.toHaveBeenCalled();
        const updated = await owner.updateAIConnection(chat.id, {}, "private-new");
        expect(updated.secretRef).not.toBe(chat.secretRef);
        expect(secrets.get(chat.secretRef)).toBe("shared-old");
        expect(await owner.getAIConnectionToken(chat.id)).toBe("private-new");
    });

    it("reports failed compensation and blocks the affected credential until an explicit successful repair", async () => {
        const { owner, saveSettingsData, secrets, secretStorage } = createFixture();
        const a = await owner.createAIConnection({ providerId: "openai" }, "previous", "default");
        const lease = await owner.acquireCredentialLease(a.id);
        saveSettingsData.mockRejectedValueOnce(new Error("disk unavailable"));
        secretStorage.setSecret.mockImplementationOnce((id, value) => { secrets.set(id, value); });
        secretStorage.setSecret.mockImplementationOnce(() => { throw new Error("locked during compensation"); });
        await expect(owner.updateAIConnection(a.id, {}, "replacement")).rejects.toThrow("compensation_failed");
        expect(lease.isCurrent()).toBe(false);
        await expect(owner.getAIConnectionToken(a.id)).rejects.toThrow("credential_unavailable");
        await owner.updateAIConnection(a.id, {}, "repaired");
        expect(await owner.getAIConnectionToken(a.id)).toBe("repaired");
    });

    it("notifies after the settings queue is released and never publishes an incomplete connection", async () => {
        const { owner, dependencies } = createFixture();
        let writing = false;
        dependencies.enqueueSettingsWrite = async operation => {
            writing = true;
            try { return await operation(); } finally { writing = false; }
        };
        dependencies.notifySettingsChanged = jest.fn(async () => {
            expect(writing).toBe(false);
            expect(owner.getAIConnections()!.connections).toHaveLength(1);
        });
        await owner.createAIConnection({ providerId: "openai" }, "key", "default");
        expect(dependencies.notifySettingsChanged).toHaveBeenCalledTimes(1);
    });

    it("does not migrate an unused Wan model into the newly available OpenAI image capability", async () => {
        const { owner, settings } = createFixture();
        settings.imageGenerationConnectionMode = "inherit-chat";
        settings.featuredImageModel = "wan2.7-image";
        const migrated = await owner.migrateLegacyAIConnections();
        expect(migrated.connections[0].models.image).toBe("gpt-image-2.5-flare");
        expect(migrated.connections[0].models.sourceImage).not.toBe("wan2.7-image");
        expect(settings.featuredImageModel).toBe("wan2.7-image");
    });

    it("recognizes the official DashScope endpoint despite a custom preset and preserves customized models", async () => {
        const { owner, settings, secrets } = createFixture();
        settings.aiProviderPreset = "custom";
        settings.baseURL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
        settings.chatModelName = "qwen-my-configured-model";
        settings.embeddingModelName = "text-embedding-v4";
        settings.imageGenerationConnectionMode = "inherit-chat";
        settings.featuredImageModel = "wan2.7-image-pro";
        secrets.set(KEYCHAIN_API_TOKEN_ID, "confirmed-dashscope-key");
        const migrated = await owner.migrateLegacyAIConnections({ providerId: "dashscope-cn" });
        expect(migrated.connections[0]).toMatchObject({
            providerId: "dashscope-cn", endpoints: { chat: settings.baseURL, image: settings.baseURL },
            models: { chat: "qwen-my-configured-model", embedding: "text-embedding-v4", image: "wan2.7-image-pro" },
        });
        expect(owner.getImageGenerationConnection()).toMatchObject({ adapter: "wan", model: "wan2.7-image-pro" });
    });

    it("uses an explicitly corrected legacy credential provider without sending it to the mistaken old address", async () => {
        const { owner, settings, secrets, secretStorage } = createFixture();
        secrets.set(KEYCHAIN_API_TOKEN_ID, "dashscope-key");
        const migrated = await owner.migrateLegacyAIConnections({ providerId: "dashscope-cn" });
        expect(migrated.connections[0]).toMatchObject({
            providerId: "dashscope-cn", secretRef: KEYCHAIN_API_TOKEN_ID,
            endpoints: { chat: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
            models: { chat: "qwen3.6-plus", embedding: "text-embedding-v4" },
        });
        expect(settings.baseURL).toBe("https://api.openai.com/v1");
        expect(settings.chatModelName).toBe("gpt-4o-mini");
        expect(secretStorage.getSecret).not.toHaveBeenCalled();
    });

    it("preserves a custom gateway and model choices when confirming the old key's provider", async () => {
        const { owner, settings, secrets, secretStorage } = createFixture();
        settings.baseURL = "https://gateway.example/v1";
        settings.chatModelName = "my-deployment";
        settings.policyModelName = "my-policy";
        settings.embeddingModelName = "my-embedding";
        secrets.set(KEYCHAIN_API_TOKEN_ID, "gateway-key");
        const migrated = await owner.migrateLegacyAIConnections({ providerId: "openai" });
        expect(migrated.connections[0]).toMatchObject({
            providerId: "openai", secretRef: KEYCHAIN_API_TOKEN_ID,
            endpoints: { chat: settings.baseURL, embedding: settings.baseURL },
            models: { chat: "my-deployment", policy: "my-policy", embedding: "my-embedding" },
        });
        expect(secretStorage.getSecret).not.toHaveBeenCalled();
        expect(secretStorage.setSecret).not.toHaveBeenCalled();
    });

    it("rejects malformed nonempty API addresses before writing but allows local HTTP and unused purposes", async () => {
        const { owner, saveSettingsData, secretStorage } = createFixture();
        await expect(owner.createAIConnection({ providerId: "custom", endpoints: { chat: "htps://host/v1" },
            models: { chat: "local-model" } }, "new-key", "default")).rejects.toThrow("endpoint_invalid");
        expect(owner.getAIConnections()).toBeUndefined();
        expect(saveSettingsData).not.toHaveBeenCalled();
        expect(secretStorage.setSecret).not.toHaveBeenCalled();
        const saved = await owner.createAIConnection({ providerId: "custom", endpoints: {
            chat: "http://localhost:1234/v1", embedding: "", image: "",
        }, models: { chat: "local-model" } }, "new-key", "default");
        expect(owner.resolveAIConnection("chat")).toMatchObject({ ok: true, connection: { connectionId: saved.id } });
        expect(owner.resolveAIConnection("embedding")).toMatchObject({ ok: false, issue: "endpoint_missing" });
    });

    it("revokes an affected lease immediately while its key change waits in the settings queue", async () => {
        const { owner, dependencies } = createFixture();
        const connection = await owner.createAIConnection({ providerId: "openai" }, "old", "default");
        const lease = await owner.acquireCredentialLease(connection.id);
        dependencies.notifySettingsChanged = jest.fn(async () => {
            expect(owner.getAIReadiness("chat").ready).toBe(true);
        });
        let release!: () => void;
        const barrier = new Promise<void>(resolve => { release = resolve; });
        dependencies.enqueueSettingsWrite = async operation => { await barrier; return operation(); };
        const updating = owner.updateAIConnection(connection.id, {}, "new");
        expect(lease.isCurrent()).toBe(false);
        await expect(owner.getAIConnectionToken(connection.id)).rejects.toThrow("credential_unavailable");
        release();
        await updating;
        expect(await owner.getAIConnectionToken(connection.id)).toBe("new");
        expect(dependencies.notifySettingsChanged).toHaveBeenCalledTimes(1);
    });

    it("retains a supported dedicated Wan workspace endpoint through migration and original-task lookup", async () => {
        const { owner, settings, secrets } = createFixture();
        settings.imageGenerationConnectionMode = 'dedicated-wan';
        settings.imageGenerationBaseURL = 'https://workspace-test.ap-southeast-1.maas.aliyuncs.com/api/v1';
        settings.imageGenerationConnectionRevision = 3;
        const slot = owner.getImageAPITokenSecretId();
        secrets.set(slot, 'workspace-key');
        const migrated = await owner.migrateLegacyAIConnections();
        const image = migrated.connections.find(item => item.id.startsWith('legacy-image-'))!;
        expect(image).toMatchObject({ providerId: 'dashscope-intl', secretRef: slot,
            endpoints: { image: settings.imageGenerationBaseURL } });
        const legacy = { mode: 'dedicated-wan' as const, endpointIdentity: settings.imageGenerationBaseURL,
            credentialSlot: slot, revision: 3 };
        await owner.setAIPurposeBinding('image', { mode: 'inherit' });
        await owner.updateAIConnection(image.id, {}, 'rotated-workspace-key');
        expect(owner.getImageGenerationConnection(undefined, legacy)).toMatchObject({ connectionId: image.id,
            baseURL: settings.imageGenerationBaseURL, providerId: 'dashscope-intl' });
        expect(owner.getImageGenerationConnection(undefined, { ...legacy, credentialSlot: 'unrelated-slot' })).toBeNull();
    });
});
