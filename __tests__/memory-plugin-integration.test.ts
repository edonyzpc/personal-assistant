import { describe, expect, it, jest } from "@jest/globals";
import type { App, Debouncer } from "obsidian";
import { DEFAULT_SETTINGS, type PluginManagerSettings } from "../src/settings";
import { MemoryUserProfileStore } from "../src/ai-services/memory-extraction";
import { MemoryStatusNotifier } from "../src/plugin/memory-status";
import { MemoryPluginIntegration } from "../src/memory/plugin-integration";

function createStatusNotifier(): MemoryStatusNotifier {
    return new MemoryStatusNotifier({
        createDebounce: ((callback: () => void) => {
            const debounced = Object.assign(() => callback(), { cancel: jest.fn() });
            return debounced as unknown as Debouncer<[], void>;
        }) as never,
    });
}

describe("MemoryPluginIntegration", () => {
    it("owns one scheduler and stops extraction admission before late resource disposal", async () => {
        jest.useFakeTimers();
        const settings = {
            ...DEFAULT_SETTINGS,
            memoryEnabled: true,
            memoryExtractionEnabled: true,
            memoryExtractionConsent: { state: "confirmed" as const, version: 1 },
            memoryExtractionIncludeVaultInsights: false,
            memoryExtractionNoticeDismissed: true,
        } as PluginManagerSettings;
        const invoke = jest.fn(async () => "[]");
        const createExtractionModel = jest.fn(async () => ({ invoke }));
        const app = {
            vault: {
                configDir: ".obsidian",
                getMarkdownFiles: () => [],
                getAbstractFileByPath: () => null,
            },
        } as unknown as App;
        const integration = new MemoryPluginIntegration({
            getApp: () => app,
            getPluginId: () => "personal-assistant",
            getSettings: () => settings,
            isUnloading: () => false,
            getChatHistoryManager: () => ({
                findConversation: jest.fn(async () => ({ id: "chat-1", title: "Chat", turnCount: 1 })),
                getTurns: jest.fn(async () => [{
                    conversationId: "chat-1",
                    turnIndex: 1,
                    user: { role: "user", content: "Prefer concise answers." },
                    assistant: { role: "assistant", content: "Understood." },
                }]),
            }) as never,
            hasConfirmedExtractionConsent: () => true,
            hasGovernedProjection: () => false,
            getGovernanceUiMode: () => "legacy_threshold",
            getLegacyProfileScope: () => "profile-scope",
            getDataBoundaryFingerprint: () => "boundary",
            shouldHandleVaultEvent: () => true,
            createLegacyProfileStore: () => new MemoryUserProfileStore(),
            createGovernedProfileStore: () => new MemoryUserProfileStore(),
            createExistingProfileReader: () => ({ read: async () => ({ state: "not_present" }) }),
            createExtractionModel,
            admitTypeACandidates: async () => ({ status: "processed" }),
            captureTypeAAdmissionBaseline: async () => ({
                version: 1,
                capturedCommitSequence: 0,
                targets: {},
                profileRecordIdsByKey: {},
            }),
            getTypeAProcessedTurn: async () => undefined,
            surfaceExtractionEnabledNotice: jest.fn(),
            surfaceVaultInsightsInjectionNotice: jest.fn(),
            createStatusNotifier,
            log: jest.fn(),
        });

        try {
            expect(integration.vssCacheDir).toBe(".obsidian/plugins/personal-assistant/vss-cache");
            integration.syncExtractionRuntime();
            const scheduler = integration.getExtractionScheduler();
            expect(scheduler).not.toBeNull();
            integration.syncExtractionRuntime();
            expect(integration.getExtractionScheduler()).toBe(scheduler);

            integration.scheduleExtractionAfterChatTurn("chat-1", 1);
            integration.stopExtractionAdmission();
            integration.syncExtractionRuntime();
            expect(integration.getExtractionScheduler()).toBe(scheduler);
            await jest.advanceTimersByTimeAsync(2_000);
            expect(createExtractionModel).not.toHaveBeenCalled();
            expect(invoke).not.toHaveBeenCalled();

            integration.disposeExtractionResources();
            expect(integration.getExtractionScheduler()).toBeNull();
        } finally {
            integration.disposeExtractionResources();
            jest.useRealTimers();
        }
    });
});
