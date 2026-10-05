import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { TFile, type App } from "obsidian";
import { TaskSourceConstraintState } from '../src/ai-services/task-source-constraint';

const mockHistoryManagerConstructor = jest.fn();
const mockImageAssetConstructor = jest.fn();
const mockImageGenerationConstructor = jest.fn();
const mockWritingVersionsConstructor = jest.fn();
const mockWritingSaveConstructor = jest.fn();
const mockWritingStyleConstructor = jest.fn();
const mockChatServiceConstructor = jest.fn();
const mockCreateChatHistoryStore = jest.fn();

jest.mock("../src/chat/chat-history-manager", () => ({
    ChatHistoryManager: class MockChatHistoryManager {
        initialize = jest.fn(async () => undefined);
        isAvailable = jest.fn(() => true);
        constructor(options: unknown) {
            mockHistoryManagerConstructor(options, this);
        }
    },
}));

jest.mock("../src/chat/image-processor", () => ({
    ImageProcessor: class MockImageProcessor {},
}));

jest.mock("../src/chat/image-assets", () => ({
    ImageAssetService: class MockImageAssetService {
        recoverPending = jest.fn(async () => undefined);
        dispose = jest.fn(async () => undefined);
        constructor(...args: unknown[]) {
            mockImageAssetConstructor(args, this);
        }
    },
}));

jest.mock("../src/chat/image-generation-service", () => ({
    ImageGenerationService: class MockImageGenerationService {
        recover = jest.fn(async () => undefined);
        dispose = jest.fn();
        constructor(options: unknown) {
            mockImageGenerationConstructor(options, this);
        }
    },
}));

jest.mock("../src/chat/chat-history-store", () => ({
    createChatHistoryStore: (...args: unknown[]) => mockCreateChatHistoryStore(...args),
}));

jest.mock("../src/chat/writing-versions", () => ({
    WritingVersionService: class MockWritingVersionService {
        dispose = jest.fn(async () => undefined);
        constructor(store: unknown) {
            mockWritingVersionsConstructor(store, this);
        }
    },
}));

jest.mock("../src/chat/writing-save-action", () => ({
    WritingSaveAction: class MockWritingSaveAction {
        dispose = jest.fn(async () => undefined);
        constructor(...args: unknown[]) {
            mockWritingSaveConstructor(args, this);
        }
    },
}));

jest.mock("../src/chat/writing-style-service", () => ({
    WritingStyleService: class MockWritingStyleService {
        dispose = jest.fn();
        constructor(options: unknown) {
            mockWritingStyleConstructor(options, this);
        }
    },
}));

jest.mock("../src/chat/writing-recovery-sources", () => ({
    prepareWritingRecoverySources: jest.fn(),
}));

jest.mock("../src/ai-services/chat-service", () => ({
    ChatService: class MockChatService {
        constructor(...args: unknown[]) {
            mockChatServiceConstructor(args, this);
        }
    },
}));

import {
    ChatPluginIntegration,
    type ChatPluginIntegrationDependencies,
} from "../src/chat/plugin-integration";
import type { PluginManagerSettings } from "../src/settings";

function createSettings(vaultId: string): PluginManagerSettings {
    return {
        statisticsVaultId: vaultId,
        dataBoundary: { mode: "all_notes", folderPath: "", tag: "" },
        featuredImageModel: "wan2.7-image-pro",
        numFeaturedImages: 3,
        featuredImagePath: "/attachments/ai/",
    } as unknown as PluginManagerSettings;
}

function createHarness() {
    const file = Object.assign(new TFile(), { path: "notes/current.md", extension: "md" });
    let documentText = "---\ntitle: source\n---\nSOURCE-BODY";
    const app = {
        vault: {
            getAbstractFileByPath: jest.fn(() => file),
            cachedRead: jest.fn(async () => documentText),
        },
    } as unknown as App;
    let settings = createSettings("vault-a");
    let ownerCurrent = true;
    let runtimeEnabled = true;
    let canManage = true;
    const coordinator = { id: "coordinator" };
    const sessions: object[] = [];
    const aiHosts: object[] = [];
    const memoryStatus = { id: "memory-status" };
    const dependencies = {
        app,
        getSettings: () => settings,
        getPluginId: () => "personal-assistant",
        source: {
            isDataBoundaryAllowedPath: () => true,
            isDataBoundaryAllowedFile: () => true,
            getDataBoundaryTags: () => [],
        },
        getImageGenerationConnection: () => null,
        getImageToken: async () => null,
        getProviderConfigurationRevision: () => 1,
        getTokenRevision: () => 2,
        hasActiveAIProviderCredentialTransition: () => false,
        showImageSyncNotice: jest.fn(),
        createOperationsSession: () => {
            const session = { id: `session-${sessions.length + 1}` };
            sessions.push(session);
            return session;
        },
        createAiServiceHost: () => {
            const host = { id: `host-${aiHosts.length + 1}` };
            aiHosts.push(host);
            return host;
        },
        hostActions: {
            isOperationsAgentEnabled: () => true,
            log: jest.fn(),
            getAISetupIssue: () => null,
            getAIReadiness: jest.fn(),
            refreshAPITokenPresence: jest.fn(),
            confirmImageGenerationFirstUse: async () => true,
            rememberWritingStyle: async () => undefined,
            readWritingStyleReferences: async () => [],
            onWritingReferencesChanged: () => () => undefined,
            prepareWritingStyleForScene: jest.fn(),
            createMemoryStatus: () => memoryStatus,
            onSettingsChanged: () => () => undefined,
            scheduleMemoryExtractionAfterChatTurn: jest.fn(),
            openMemorySettings: jest.fn(),
            completeAISetup: jest.fn(),
        },
        writingStyleRuntime: {
            getCoordinator: () => coordinator,
            isOwnerCurrent: () => ownerCurrent,
            isRuntimeEnabled: () => runtimeEnabled,
            canManage: () => canManage,
            getStateSnapshot: () => null,
            verifyNoteSource: async () => ({ allowed: false, isCurrent: () => false }),
        },
        writingRecovery: {
            isMemoryEnabled: () => true,
            verifyNote: jest.fn(),
            verifyGenerationSource: jest.fn(),
        },
        isChatRuntimeCurrent: () => true,
        log: jest.fn(),
    } as unknown as ChatPluginIntegrationDependencies;
    const owner = new ChatPluginIntegration(dependencies);

    return {
        owner,
        app,
        dependencies,
        sessions,
        aiHosts,
        coordinator,
        setSettings: (next: PluginManagerSettings) => { settings = next; },
        setOwnerCurrent: (value: boolean) => { ownerCurrent = value; },
        setRuntimeEnabled: (value: boolean) => { runtimeEnabled = value; },
        setCanManage: (value: boolean) => { canManage = value; },
        setDocumentText: (value: string) => { documentText = value; },
        sourceFile: file,
    };
}

describe("ChatPluginIntegration", () => {
    it.each(['revocation', 'cancel', 'replacement'] as const)(
        'does not bind a natural note source when %s occurs during its read', async failure => {
            const harness = createHarness();
            const controller = new AbortController();
            let current = true;
            const state = new TaskSourceConstraintState({ runId: 'run', userMessageId: 'user',
                userText: 'Create an image from my note.', noteHandles: new Map(), sourceScope: 'notes' });
            const guard = state.createReadGuard(state.snapshot(),
                path => path === harness.sourceFile.path ? 'note-id' : undefined, () => current);
            jest.mocked(harness.app.vault.cachedRead).mockImplementation(async () => {
                if (failure === 'revocation') current = false;
                if (failure === 'cancel') controller.abort();
                if (failure === 'replacement') {
                    jest.mocked(harness.app.vault.getAbstractFileByPath).mockReturnValue(
                        Object.assign(new TFile(), { path: harness.sourceFile.path, extension: 'md' }));
                }
                return 'SOURCE-BODY';
            });
            await expect(harness.owner.resolveImageNoteSource(harness.sourceFile.path, guard, controller.signal))
                .rejects.toThrow();
            expect(harness.app.vault.cachedRead).toHaveBeenCalledTimes(1);
        });

    it('refuses an excluded natural note source before reading its body', async () => {
        const harness = createHarness();
        const state = new TaskSourceConstraintState({ runId: 'run', userMessageId: 'user',
            userText: 'Create an image from my note.', noteHandles: new Map(), sourceScope: 'notes' });
        const guard = state.createReadGuard(state.snapshot(), () => 'note-id', () => true);
        harness.dependencies.source.isDataBoundaryAllowedFile = () => false;
        await expect(harness.owner.resolveImageNoteSource(harness.sourceFile.path, guard))
            .rejects.toMatchObject({ code: 'source_unavailable' });
        expect(harness.app.vault.cachedRead).not.toHaveBeenCalled();
    });

    beforeEach(() => {
        mockHistoryManagerConstructor.mockClear();
        mockImageAssetConstructor.mockClear();
        mockImageGenerationConstructor.mockClear();
        mockWritingVersionsConstructor.mockClear();
        mockWritingSaveConstructor.mockClear();
        mockWritingStyleConstructor.mockClear();
        mockChatServiceConstructor.mockClear();
        mockCreateChatHistoryStore.mockReset();
    });

    it("admits an exact text source before send and exposes normalized request defaults", async () => {
        const harness = createHarness();
        const documentText = "---\ntitle: source\n---\nSOURCE-BODY";
        const source = {
            kind: "note" as const,
            path: "notes/current.md",
            displayName: "current",
            text: "SOURCE-BODY",
            documentText,
            file: harness.sourceFile,
            inputLineage: {
                schemaVersion: 1 as const,
                completeness: "complete" as const,
                dependencies: [{ kind: "vault" as const, path: "notes/current.md", via: "note" as const }],
            },
        };
        const host = harness.owner.createChatHost();
        await expect(host.verifyImageTextSource?.(source, "before-send")).resolves.toBeUndefined();
        expect(host.isImageTextSourceCurrent?.(source)).toBe(true);
        expect(harness.owner.isImagePromptOriginCurrent({ path: source.path })).toBe(true);
        harness.setDocumentText(`${documentText}\nchanged`);
        await expect(harness.owner.verifyImageTextSource(source))
            .rejects.toThrow("image_generation:source_changed");
        expect(harness.owner.isImageTextSourceCurrent(source)).toBe(true);
        harness.setDocumentText(documentText);
        (harness.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(null);
        expect(harness.owner.isImageTextSourceCurrent(source)).toBe(false);
        expect(harness.owner.isImagePromptOriginCurrent({ path: source.path })).toBe(false);
        (harness.app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue({ path: source.path });
        await expect(harness.owner.verifyImageTextSource(source)).rejects.toThrow("image_generation:source_changed");
        expect(host.getImageGenerationOptions?.()).toEqual({
            model: "wan2.7-image-pro",
            count: 3,
            attachmentPathHint: "attachments/ai",
        });
    });

    it("constructs the shared Chat resources from one store and snapshots each host", () => {
        const firstStore = { id: "store-1", dispose: jest.fn(async () => undefined) };
        const secondStore = { id: "store-2", dispose: jest.fn(async () => undefined) };
        mockCreateChatHistoryStore.mockReturnValueOnce(firstStore).mockReturnValueOnce(secondStore);
        const harness = createHarness();

        harness.owner.initialize();

        const manager = mockHistoryManagerConstructor.mock.calls[0]?.[1];
        const assets = mockImageAssetConstructor.mock.calls[0]?.[1];
        expect(mockHistoryManagerConstructor.mock.calls[0]?.[0]).toMatchObject({ store: firstStore });
        expect((mockImageAssetConstructor.mock.calls[0]?.[0] as unknown[])[1]).toBe(firstStore);
        expect(mockImageGenerationConstructor.mock.calls[0]?.[0]).toMatchObject({
            store: firstStore,
            assets,
        });
        expect(mockWritingVersionsConstructor.mock.calls[0]?.[0]).toBe(firstStore);
        expect((mockWritingSaveConstructor.mock.calls[0]?.[0] as unknown[]).slice(1, 3)).toEqual([
            firstStore,
            assets,
        ]);

        const firstSettings = harness.dependencies.getSettings();
        const firstHost = harness.owner.createChatHost();
        harness.setSettings(createSettings("vault-b"));
        const secondHost = harness.owner.createChatHost();

        expect(firstHost).toMatchObject({
            settings: firstSettings,
            chatHistoryManager: manager,
            imageAssetService: assets,
        });
        expect(secondHost.settings).toBe(harness.dependencies.getSettings());
        expect(firstHost.settings).not.toBe(secondHost.settings);
        expect(harness.owner.createChatHistoryStore()).toBe(secondStore);
        expect(mockCreateChatHistoryStore).toHaveBeenLastCalledWith(
            harness.app.vault,
            "vault-b",
            "personal-assistant",
        );
    });

    it("creates a fresh AI host and Operations session for every Chat service", () => {
        const harness = createHarness();

        const first = harness.owner.createChatService();
        const second = harness.owner.createChatService();

        expect(first).not.toBe(second);
        expect(harness.sessions).toHaveLength(2);
        expect(harness.aiHosts).toHaveLength(2);
        expect(mockChatServiceConstructor.mock.calls.map((call) => call[0])).toEqual([
            [harness.aiHosts[0], harness.sessions[0]],
            [harness.aiHosts[1], harness.sessions[1]],
        ]);
    });

    it("runs layout recovery once and preserves history, asset, generation order", async () => {
        const harness = createHarness();
        const order: string[] = [];
        const manager = {
            initialize: jest.fn(async () => { order.push("history"); }),
            isAvailable: jest.fn(() => true),
        };
        const assets = { recoverPending: jest.fn(async () => { order.push("assets"); }) };
        const generation = { recover: jest.fn(async () => { order.push("generation"); }) };
        harness.owner.setHistoryManagerForCompatibility(manager as never);
        harness.owner.setImageAssetServiceForCompatibility(assets as never);
        harness.owner.setImageGenerationServiceForCompatibility(generation as never);

        harness.owner.recoverAfterLayoutReady(() => false);
        harness.owner.recoverAfterLayoutReady(() => false);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(order).toEqual(["history", "assets", "generation"]);
        expect(manager.initialize).toHaveBeenCalledTimes(1);
    });

    it("skips image recovery when history is unavailable and isolates initialization failure", async () => {
        const unavailable = createHarness();
        const unavailableAssets = { recoverPending: jest.fn(async () => undefined) };
        const unavailableGeneration = { recover: jest.fn(async () => undefined) };
        unavailable.owner.setHistoryManagerForCompatibility({
            initialize: jest.fn(async () => undefined),
            isAvailable: jest.fn(() => false),
        } as never);
        unavailable.owner.setImageAssetServiceForCompatibility(unavailableAssets as never);
        unavailable.owner.setImageGenerationServiceForCompatibility(unavailableGeneration as never);

        unavailable.owner.recoverAfterLayoutReady(() => false);
        await Promise.resolve();
        await Promise.resolve();
        expect(unavailableAssets.recoverPending).not.toHaveBeenCalled();
        expect(unavailableGeneration.recover).not.toHaveBeenCalled();

        const failed = createHarness();
        const failure = new Error("history unavailable");
        failed.owner.setHistoryManagerForCompatibility({
            initialize: jest.fn(async () => { throw failure; }),
            isAvailable: jest.fn(() => true),
        } as never);
        failed.owner.recoverAfterLayoutReady(() => false);
        await Promise.resolve();
        await Promise.resolve();
        expect(failed.dependencies.log).toHaveBeenCalledWith(
            "Failed to recover registered image imports",
            failure,
        );
    });

    it("keeps Writing Style runtime and management gates separate", () => {
        const harness = createHarness();
        harness.owner.setWritingVersionsForCompatibility({} as never);

        const service = harness.owner.getWritingStyleService();
        const options = mockWritingStyleConstructor.mock.calls[0]?.[0] as {
            isRuntimeEnabled(): boolean;
            canManage(): boolean;
        };
        expect(service).toBeDefined();
        expect(options.isRuntimeEnabled()).toBe(true);
        expect(options.canManage()).toBe(true);

        harness.setRuntimeEnabled(false);
        expect(options.isRuntimeEnabled()).toBe(false);
        expect(options.canManage()).toBe(true);

        harness.setCanManage(false);
        expect(options.canManage()).toBe(false);
        harness.setOwnerCurrent(false);
        harness.owner.setWritingStyleCoordinatorForCompatibility(undefined);
        harness.owner.setWritingStyleServiceForCompatibility(undefined);
        expect(harness.owner.getWritingStyleService()).toBeUndefined();
    });

    it("tears down writing, images, and history in the accepted segmented order", async () => {
        const harness = createHarness();
        const order: string[] = [];
        const save = { dispose: jest.fn(async () => { order.push("save"); }) };
        const style = { dispose: jest.fn(() => { order.push("style"); }) };
        const versions = { dispose: jest.fn(async () => { order.push("versions"); }) };
        const generation = { dispose: jest.fn(() => { order.push("generation"); }) };
        const assets = { dispose: jest.fn(async () => { order.push("assets"); }) };
        const store = { dispose: jest.fn(async () => { order.push("history"); }) };
        harness.owner.setWritingSaveForCompatibility(save as never);
        harness.owner.setWritingStyleServiceForCompatibility(style as never);
        harness.owner.setWritingStyleCoordinatorForCompatibility(harness.coordinator as never);
        harness.owner.setWritingVersionsForCompatibility(versions as never);
        harness.owner.setImageGenerationServiceForCompatibility(generation as never);
        harness.owner.setImageAssetServiceForCompatibility(assets as never);
        harness.owner.setHistoryStoreForCompatibility(store as never);
        harness.owner.setHistoryManagerForCompatibility({} as never);

        await harness.owner.drainWriting();
        await harness.owner.disposeImages();
        harness.owner.releaseHistory();
        await Promise.resolve();

        expect(order).toEqual(["save", "style", "versions", "generation", "assets", "history"]);
        expect(harness.owner.getWritingSave()).toBeUndefined();
        expect(harness.owner.getWritingVersions()).toBeUndefined();
        expect(harness.owner.getImageGenerationService()).toBeUndefined();
        expect(harness.owner.getImageAssetService()).toBeUndefined();
        expect(harness.owner.getHistoryStore()).toBeUndefined();
        expect(harness.owner.getHistoryManager()).toBeUndefined();
    });
});
