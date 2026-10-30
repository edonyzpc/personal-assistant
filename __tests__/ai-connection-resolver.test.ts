import { describe, expect, it } from "@jest/globals";

import { resolveAIConnection } from "../src/ai-services/ai-connection-resolver";
import type { AIConnection, AIConnectionsSettings, AIPurpose, ResolvedAIConnection } from "../src/ai-services/ai-connection-types";
import { createConnectionDefaults, getProviderDefinition } from "../src/ai-services/provider-definitions";

function savedConnection(providerId: string, id = providerId, changes: Partial<AIConnection> = {}): AIConnection {
    return {
        ...createConnectionDefaults(providerId),
        id,
        name: id,
        secretRef: `pa-${id}-key`,
        revision: 1,
        ...changes,
    };
}

function settings(...connections: AIConnection[]): AIConnectionsSettings {
    return {
        schemaVersion: 1,
        connections,
        defaultConnectionId: connections[0]?.id ?? null,
        bindings: { chat: { mode: "inherit" }, embedding: { mode: "inherit" }, image: { mode: "inherit" } },
        memorySelection: { revision: "initial", cause: "initial-setup" },
        migrationVersion: 1,
    };
}

function resolved(configuration: AIConnectionsSettings, purpose: AIPurpose): ResolvedAIConnection {
    const result = resolveAIConnection(configuration, purpose);
    if (!result.ok) throw new Error(`Unexpected resolution issue: ${result.issue}`);
    return result.connection;
}

describe("saved AI connection defaults", () => {
    it("keeps separate service regions, supported image protocols and new-connection model defaults", () => {
        const openai = createConnectionDefaults("openai");
        expect(openai.models).toMatchObject({
            chat: "gpt-4o-mini", embedding: "text-embedding-3-small", image: "gpt-image-2.5-flare",
        });
        expect(openai.options.embeddingDimensions).toBe(1024);
        expect(createConnectionDefaults("dashscope-cn").endpoints.chat)
            .toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
        expect(createConnectionDefaults("dashscope-intl").endpoints.chat)
            .toBe("https://dashscope-intl.aliyuncs.com/compatible-mode/v1");
        expect(getProviderDefinition("custom")?.adapters.image).toBeUndefined();
    });

    it("does not let editing a new account's defaults change another account", () => {
        const first = createConnectionDefaults("openai");
        first.endpoints.chat = "https://another.example/v1";
        first.models.chat = "user-selected-model";
        first.options.embeddingDimensions = 512;
        const next = createConnectionDefaults("openai");
        expect(next.endpoints.chat).toBe("https://api.openai.com/v1");
        expect(next.models.chat).toBe("gpt-4o-mini");
        expect(next.options.embeddingDimensions).toBe(1024);
    });

    it("requires a known provider without accepting old aliases or object property names", () => {
        expect(getProviderDefinition("qwen")).toBeUndefined();
        expect(getProviderDefinition("__proto__")).toBeUndefined();
        expect(() => createConnectionDefaults("future-provider")).toThrow("Unknown AI provider");
    });
});

describe("AI connection selection", () => {
    it("resolves all three inherited purposes directly from the default connection", () => {
        const configuration = settings(savedConnection("openai"));
        for (const purpose of ["chat", "embedding", "image"] as const) {
            expect(resolved(configuration, purpose)).toMatchObject({
                connectionId: "openai", providerId: "openai", secretRef: "pa-openai-key",
                endpoint: "https://api.openai.com/v1",
            });
        }
    });

    it("keeps independent Chat separate from the default for both other purposes", () => {
        const configuration = settings(savedConnection("openai"), savedConnection("dashscope-cn"), savedConnection("dashscope-intl"));
        configuration.bindings.chat = { mode: "connection", connectionId: "dashscope-cn" };
        expect(resolved(configuration, "chat").connectionId).toBe("dashscope-cn");
        expect(resolved(configuration, "embedding").connectionId).toBe("openai");
        expect(resolved(configuration, "image").connectionId).toBe("openai");
        configuration.defaultConnectionId = "dashscope-intl";
        expect(resolved(configuration, "chat").connectionId).toBe("dashscope-cn");
        expect(resolved(configuration, "embedding").connectionId).toBe("dashscope-intl");
        expect(resolved(configuration, "image").connectionId).toBe("dashscope-intl");
    });

    it.each<AIPurpose>(["chat", "embedding", "image"])("uses the exact independently selected account for %s", purpose => {
        const configuration = settings(savedConnection("openai", "personal"), savedConnection("openai", "work"));
        configuration.bindings[purpose] = { mode: "connection", connectionId: "work" };
        expect(resolved(configuration, purpose)).toMatchObject({ connectionId: "work", secretRef: "pa-work-key" });
        configuration.bindings[purpose] = { mode: "inherit" };
        expect(resolved(configuration, purpose).connectionId).toBe("personal");
    });

    it("leaves explicit unconfigured and missing selections unavailable instead of falling back", () => {
        const configuration = settings(savedConnection("openai"));
        configuration.bindings.image = { mode: "unconfigured" };
        expect(resolveAIConnection(configuration, "image")).toEqual({ ok: false, issue: "connection_unconfigured" });
        configuration.bindings.image = { mode: "connection", connectionId: "removed" };
        expect(resolveAIConnection(configuration, "image"))
            .toEqual({ ok: false, issue: "connection_missing", connectionId: "removed" });
        expect(resolveAIConnection(undefined, "chat")).toEqual({ ok: false, issue: "connection_unconfigured" });
    });

    it("can retain an independent purpose when the default connection has been removed", () => {
        const configuration = settings(savedConnection("openai", "retained"));
        configuration.defaultConnectionId = null;
        configuration.bindings.embedding = { mode: "connection", connectionId: "retained" };
        expect(resolveAIConnection(configuration, "chat")).toEqual({ ok: false, issue: "connection_unconfigured" });
        expect(resolved(configuration, "embedding").connectionId).toBe("retained");
    });

    it.each([
        ["openai", "openai-image", "api.openai.com"],
        ["dashscope-cn", "wan", "dashscope.aliyuncs.com"],
        ["dashscope-intl", "wan", "dashscope-intl.aliyuncs.com"],
    ])("routes %s images to the correct protocol and original region", (providerId, adapter, hostname) => {
        const image = resolved(settings(savedConnection(providerId)), "image");
        expect(image.adapter).toBe(adapter);
        expect(new URL(image.endpoint).hostname).toBe(hostname);
    });

    it("does not infer Custom image authority from an OpenAI-looking endpoint", () => {
        const custom = savedConnection("custom", "gateway", {
            endpoints: { chat: "http://localhost:8080/v1", embedding: "http://localhost:8080/v1", image: "https://api.openai.com/v1" },
            models: { chat: "local-chat", embedding: "local-search", image: "gpt-image-2.5-flare" },
        });
        const configuration = settings(custom);
        expect(resolved(configuration, "chat")).toMatchObject({ adapter: "openai-compatible", model: "local-chat" });
        expect(resolved(configuration, "embedding").model).toBe("local-search");
        expect(resolveAIConnection(configuration, "image"))
            .toEqual({ ok: false, issue: "capability_unsupported", connectionId: "gateway" });
    });
});

describe("persisted connection boundary", () => {
    it("reports an unsupported provider without trying the otherwise valid default", () => {
        const configuration = settings(savedConnection("openai"), savedConnection("openai", "future", { providerId: "new-service" }));
        configuration.bindings.embedding = { mode: "connection", connectionId: "future" };
        expect(resolveAIConnection(configuration, "embedding"))
            .toEqual({ ok: false, issue: "provider_unsupported", connectionId: "future" });
    });

    it.each([undefined, "", "  "])("does not repair a saved missing/empty model (%s) with a preset", model => {
        const connection = savedConnection("openai", "saved", { models: { chat: model } });
        expect(resolveAIConnection(settings(connection), "chat"))
            .toEqual({ ok: false, issue: "model_missing", connectionId: "saved" });
        expect(connection.models.chat).toBe(model);
    });

    it.each([undefined, ""])("does not repair a saved missing/empty endpoint (%s)", endpoint => {
        const connection = savedConnection("openai", "saved", { endpoints: { chat: endpoint } });
        expect(resolveAIConnection(settings(connection), "chat"))
            .toEqual({ ok: false, issue: "endpoint_missing", connectionId: "saved" });
    });

    it.each(["file:///private/data", "not-an-address", "https://user:password@example.com/v1"])(
        "rejects a non-HTTP or credential-bearing endpoint before request construction: %s", endpoint => {
            const connection = savedConnection("openai", "saved", { endpoints: { chat: endpoint } });
            expect(resolveAIConnection(settings(connection), "chat"))
                .toEqual({ ok: false, issue: "configuration_invalid", connectionId: "saved" });
        },
    );

    it("preserves an explicitly selected model and Policy, with blank Policy inheriting only Chat", () => {
        const connection = savedConnection("openai", "saved", { models: { chat: "selected-chat", policy: "selected-policy" } });
        const configuration = settings(connection);
        expect(resolved(configuration, "chat")).toMatchObject({ model: "selected-chat", policyModel: "selected-policy" });
        connection.models.policy = " ";
        expect(resolved(configuration, "chat")).toMatchObject({ model: "selected-chat", policyModel: "selected-chat" });
    });

    it("rejects ambiguous duplicate IDs instead of selecting an arbitrary account", () => {
        const configuration = settings(savedConnection("openai", "same"), savedConnection("dashscope-cn", "same"));
        expect(resolveAIConnection(configuration, "chat"))
            .toEqual({ ok: false, issue: "configuration_invalid", connectionId: "same" });
    });

    it.each([
        { schemaVersion: 2 },
        { connections: {} },
        { bindings: { chat: { mode: "unexpected" } } },
    ])("does not interpret malformed/future settings as inheritance: %j", changed => {
        const configuration = { ...settings(savedConnection("openai")), ...changed } as unknown as AIConnectionsSettings;
        expect(resolveAIConnection(configuration, "chat")).toEqual({ ok: false, issue: "configuration_invalid" });
    });

    it.each([0, 2.5])("rejects invalid saved embedding dimensions %s without choosing another value", embeddingDimensions => {
        const connection = savedConnection("openai", "saved", { options: { embeddingDimensions } });
        expect(resolveAIConnection(settings(connection), "embedding"))
            .toEqual({ ok: false, issue: "configuration_invalid", connectionId: "saved" });
        expect(resolved(settings(connection), "chat").model).toBe("gpt-4o-mini");
    });

    it("keeps the resolved request snapshot independent of later settings edits", () => {
        const connection = savedConnection("openai", "saved", {
            options: { embeddingDimensions: 512, chat: { thinking: { enabled: false } } },
        });
        const snapshot = resolved(settings(connection), "chat");
        connection.endpoints.chat = "https://another.example/v1";
        connection.models.chat = "another-model";
        (connection.options.chat!.thinking as { enabled: boolean }).enabled = true;
        expect(snapshot.endpoint).toBe("https://api.openai.com/v1");
        expect(snapshot.model).toBe("gpt-4o-mini");
        expect(snapshot.options.chat).toEqual({ thinking: { enabled: false } });
    });
});
