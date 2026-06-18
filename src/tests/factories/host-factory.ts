/* Copyright 2023 edonyzpc */

import type { App, EventRef, TFile } from "obsidian";

import type { AiServiceHost } from "../../ai-services/AiServiceHost";
import { MOCK_LICENSE_TIER } from "../../ai-services/capability-types";
import type { ChatHost } from "../../chat/ChatHost";
import type { MemoryHost } from "../../memory";

export type MemoryHostFixtureOverrides = Partial<Omit<MemoryHost, "settings">> & {
    settings?: Partial<MemoryHost["settings"]>;
};

export type AiServiceHostFixtureOverrides = Partial<Omit<AiServiceHost, "settings" | "memorySearch">> & {
    settings?: Partial<AiServiceHost["settings"]>;
    memorySearch?: Partial<AiServiceHost["memorySearch"]>;
};

export type ChatHostFixtureOverrides = Partial<Omit<ChatHost, "settings" | "memoryStatus">> & {
    settings?: Partial<ChatHost["settings"]>;
    memoryStatus?: Partial<ChatHost["memoryStatus"]>;
};

export function createMemoryHost(
    overrides: MemoryHostFixtureOverrides = {},
): MemoryHost {
    const { settings: settingsOverrides, ...hostOverrides } = overrides;
    const settings: MemoryHost["settings"] = {
        memoryEnabled: true,
        memoryAutoCheckBeforeChat: true,
        memoryApprovalPolicy: "always",
        vssCacheExcludePath: [],
        debug: false,
        aiProvider: "openai",
        chatModelName: "gpt-4o-mini",
        embeddingModelName: "text-embedding-3-small",
        baseURL: "https://api.openai.com/v1",
        statisticsVaultId: "test-vault",
        ...settingsOverrides,
    };

    return {
        app: {} as App,
        pluginId: "personal-assistant",
        settings,
        log: () => undefined,
        registerEvent: (_ref: EventRef) => undefined,
        saveSettings: async () => undefined,
        getVSSFiles: () => [] as TFile[],
        getAPIToken: async () => "test-token",
        notifyStatusChanged: () => undefined,
        updateMemorySetting: (key, value) => {
            settings[key] = value;
        },
        ...hostOverrides,
    };
}

export function createAiServiceHost(
    overrides: AiServiceHostFixtureOverrides = {},
): AiServiceHost {
    const {
        settings: settingsOverrides,
        memorySearch: memorySearchOverrides,
        ...hostOverrides
    } = overrides;
    const settings: AiServiceHost["settings"] = {
        debug: false,
        aiProvider: "openai",
        baseURL: "https://api.openai.com/v1",
        chatModelName: "gpt-4o-mini",
        policyModelName: "",
        embeddingModelName: "text-embedding-3-small",
        shareAnonymousCapabilityUsage: false,
        skillContextEnabled: true,
        enabledSkillIds: [],
        qwenThinkingEnabled: false,
        webSearchEnabled: false,
        licenseTier: MOCK_LICENSE_TIER,
        memoryEnabled: true,
        operationsAgentEnabled: false,
        statisticsVaultId: "test-vault",
        ...settingsOverrides,
    };
    const memorySearch: AiServiceHost["memorySearch"] = {
        ensureReadyForChat: async () => ({ decision: "use-memory" }),
        searchHybrid: async () => [],
        getChunksByPath: async () => [],
        ...memorySearchOverrides,
    };

    return {
        app: {} as App,
        settings,
        log: () => undefined,
        getAPIToken: async () => "test-token",
        isOperationsAgentEnabled: settings.operationsAgentEnabled,
        getMemoryExtractionPromptContext: () => undefined,
        memorySearch,
        getResolvedLinks: () => undefined,
        ...hostOverrides,
    };
}

export function createChatHost(
    overrides: ChatHostFixtureOverrides = {},
): ChatHost {
    const {
        settings: settingsOverrides,
        memoryStatus: memoryStatusOverrides,
        ...hostOverrides
    } = overrides;
    const settings: ChatHost["settings"] = {
        debug: false,
        skillContextEnabled: true,
        enabledSkillIds: [],
        memoryEnabled: true,
        aiProvider: "openai",
        baseURL: "https://api.openai.com/v1",
        chatModelName: "gpt-4o-mini",
        ...settingsOverrides,
    };
    const memoryStatus: ChatHost["memoryStatus"] = {
        getMaintenancePlan: async () => ({
            reason: "ready",
            action: "none",
            notesToCheck: 0,
            requiresApproval: false,
            canAnswerNow: true,
        }),
        prepareFromCommand: async () => undefined,
        updateFromCommand: async () => undefined,
        showTechnicalStatus: () => undefined,
        onStatusChanged: () => () => undefined,
        ...memoryStatusOverrides,
    };

    return {
        app: {} as App,
        settings,
        log: () => undefined,
        getAISetupIssue: () => null,
        chatHistoryManager: undefined,
        memoryStatus,
        createChatService: () => ({} as ReturnType<ChatHost["createChatService"]>),
        onSettingsChanged: () => () => undefined,
        scheduleMemoryExtractionAfterChatTurn: () => undefined,
        ...hostOverrides,
    };
}
