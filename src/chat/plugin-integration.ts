import { TFile, type App } from "obsidian";

import { decideDataBoundaryForSource } from "../pa/contracts";
import { ImageProcessor } from "./image-processor";
import { ImageAssetService } from "./image-assets";
import { ImageGenerationService } from "./image-generation-service";
import { ChatHistoryManager } from "./chat-history-manager";
import { createChatHistoryStore, type ChatHistoryStore } from "./chat-history-store";
import { WritingVersionService } from "./writing-versions";
import { WritingSaveAction } from "./writing-save-action";
import { WritingStyleService } from "./writing-style-service";
import { prepareWritingRecoverySources } from "./writing-recovery-sources";
import { ChatService } from "../ai-services/chat-service";
import { MemoryGovernanceCoordinator } from "../pa/memory-governance-coordinator";
import type { ImageGenerationConnection } from "../ai-services/image-generation-connection";
import type { OperationsSession } from "../ai-services/operations";
import type { AISetupInput, AISetupResult, ChatHost } from "./ChatHost";
import type { PluginManagerSettings } from "../settings";
import type {
    ChatTurnMemoryMetadata,
    ChatWritingRecovery,
    ChatWritingStylePreparation,
    ChatWritingStyleResult,
} from "../ai-services/chat-types";
import type { MessageImage } from "./image-types";
import type { WritingRecoverySourceReceipt } from "./writing-recovery-sources";
import type { WritingScene } from "./writing-types";
import type { MemoryStatusPort } from "../memory/MemoryStatusPort";

type WritingRecoveryInput = Parameters<typeof prepareWritingRecoverySources>[0];

export interface ChatPluginSourceCapability {
    isDataBoundaryAllowedPath(path: string): boolean;
    isDataBoundaryAllowedFile(file: TFile): boolean;
    getDataBoundaryTags(file: TFile): string[];
}

export interface ChatHostActions {
    isOperationsAgentEnabled(): boolean;
    log(message: string, ...args: unknown[]): void;
    getAISetupIssue(): string | null;
    getAIReadiness(scope?: Parameters<NonNullable<ChatHost["getAIReadiness"]>>[0]): ReturnType<NonNullable<ChatHost["getAIReadiness"]>>;
    refreshAPITokenPresence(): ReturnType<NonNullable<ChatHost["refreshAPITokenPresence"]>>;
    confirmImageGenerationFirstUse(): Promise<boolean>;
    rememberWritingStyle(versionId: string, scene: WritingScene): Promise<void>;
    readWritingStyleReferences: NonNullable<ChatHost["readWritingStyleReferences"]>;
    onWritingReferencesChanged(listener: () => void): () => void;
    prepareWritingStyle(
        prompt: string,
        parentScene: WritingScene | undefined,
        budget: Parameters<ChatWritingStylePreparation>[0],
    ): Promise<ChatWritingStyleResult>;
    prepareWritingStyleForScene: WritingStyleService["prepare"];
    createMemoryStatus(): MemoryStatusPort;
    onSettingsChanged(listener: () => void | Promise<void>): () => void;
    scheduleMemoryExtractionAfterChatTurn(conversationId: string, turnCount: number): void;
    openMemorySettings(claimId?: string): void;
    completeAISetup(input: AISetupInput): Promise<AISetupResult>;
}

export interface WritingStyleRuntimeDependencies {
    getCoordinator(): MemoryGovernanceCoordinator | undefined;
    isOwnerCurrent(): boolean;
    isRuntimeEnabled(coordinator: MemoryGovernanceCoordinator): boolean;
    canManage(coordinator: MemoryGovernanceCoordinator): boolean;
    getStateSnapshot(): WritingStyleStateSnapshot;
    verifyNoteSource(
        ref: { path: string; contentHash?: string },
        signal?: AbortSignal,
    ): Promise<{ allowed: boolean; isCurrent(): boolean }>;
}

export interface WritingRecoveryDependencies {
    isMemoryEnabled(): boolean;
    verifyNote: WritingRecoveryInput["verifyNote"];
    verifyGenerationSource: WritingRecoveryInput["verifyGenerationSource"];
}

export interface ChatPluginIntegrationDependencies {
    app: App;
    getSettings(): PluginManagerSettings;
    getPluginId(): string;
    source: ChatPluginSourceCapability;
    getImageGenerationConnection(): ImageGenerationConnection | null;
    getImageToken(mode: ImageGenerationConnection["mode"]): Promise<string | null>;
    showImageSyncNotice(receipt: { directory: string }): void;
    createOperationsSession(): OperationsSession;
    createAiServiceHost(): ConstructorParameters<typeof ChatService>[0];
    hostActions: ChatHostActions;
    writingStyleRuntime: WritingStyleRuntimeDependencies;
    writingRecovery: WritingRecoveryDependencies;
    isChatRuntimeCurrent(): boolean;
    log(message: string, detail?: unknown): void;
}

type WritingStyleStateSnapshot = ReturnType<NonNullable<
    ConstructorParameters<typeof WritingStyleService>[0]["getStateSnapshot"]
>>;

export class ChatPluginIntegration {
    private chatHistoryStore: ChatHistoryStore | undefined;
    private chatHistoryManager: ChatHistoryManager | undefined;
    private imageAssetService: ImageAssetService | undefined;
    private imageGenerationService: ImageGenerationService | undefined;
    private writingVersions: WritingVersionService | undefined;
    private writingSave: WritingSaveAction | undefined;
    private writingStyleService: WritingStyleService | undefined;
    private writingStyleCoordinator: MemoryGovernanceCoordinator | undefined;
    private layoutRecoveryStarted = false;

    constructor(private readonly dependencies: ChatPluginIntegrationDependencies) {}

    initialize(): void {
        this.layoutRecoveryStarted = false;
        this.chatHistoryStore = this.createChatHistoryStore();
        this.chatHistoryManager = new ChatHistoryManager({
            store: this.chatHistoryStore,
            log: (message, error) => this.dependencies.log(message, error),
        });
        this.imageAssetService = new ImageAssetService(this.dependencies.app, this.chatHistoryStore, {
            processor: new ImageProcessor(this.dependencies.app),
            isPathAllowed: (path) => {
                const file = this.dependencies.app.vault.getAbstractFileByPath(path);
                return file instanceof TFile
                    ? this.dependencies.source.isDataBoundaryAllowedFile(file)
                    : this.dependencies.source.isDataBoundaryAllowedPath(path);
            },
        });
        this.imageGenerationService = new ImageGenerationService({
            store: this.chatHistoryStore,
            assets: this.imageAssetService,
            resolveConnection: () => this.dependencies.getImageGenerationConnection(),
            getToken: (mode) => this.dependencies.getImageToken(mode),
            log: (message, error) => this.dependencies.log(message, error),
            onSyncNotice: (receipt) => this.dependencies.showImageSyncNotice(receipt),
        });
        this.writingVersions = new WritingVersionService(this.chatHistoryStore);
        this.writingSave = new WritingSaveAction(
            this.dependencies.app,
            this.chatHistoryStore,
            this.imageAssetService,
            {
                isPathAllowed: (path) => {
                    const file = this.dependencies.app.vault.getAbstractFileByPath(path);
                    return decideDataBoundaryForSource({
                        path,
                        tags: file instanceof TFile ? this.dependencies.source.getDataBoundaryTags(file) : [],
                        isGenerated: false,
                    }, this.dependencies.getSettings().dataBoundary).decision === "allow";
                },
            },
        );
    }

    recoverAfterLayoutReady(isUnloading: () => boolean): void {
        if (this.layoutRecoveryStarted) return;
        this.layoutRecoveryStarted = true;
        void this.chatHistoryManager?.initialize().then(async () => {
            if (isUnloading() || !this.chatHistoryManager?.isAvailable()) return;
            await this.imageAssetService?.recoverPending();
            await this.imageGenerationService?.recover();
        }).catch((error) => this.dependencies.log(
            "Failed to recover registered image imports",
            error,
        ));
    }

    createChatHistoryStore(): ChatHistoryStore {
        return createChatHistoryStore(
            this.dependencies.app.vault,
            this.dependencies.getSettings().statisticsVaultId || "default-vault",
            this.dependencies.getPluginId(),
        );
    }

    createChatService(): ChatService {
        return new ChatService(
            this.dependencies.createAiServiceHost(),
            this.dependencies.createOperationsSession(),
        );
    }

    getHistoryManager(): ChatHistoryManager | undefined {
        return this.chatHistoryManager;
    }

    getHistoryStore(): ChatHistoryStore | undefined {
        return this.chatHistoryStore;
    }

    setHistoryStoreForCompatibility(value: ChatHistoryStore | undefined): void {
        this.chatHistoryStore = value;
    }

    setHistoryManagerForCompatibility(value: ChatHistoryManager | undefined): void {
        this.chatHistoryManager = value;
    }

    getImageAssetService(): ImageAssetService | undefined {
        return this.imageAssetService;
    }

    setImageAssetServiceForCompatibility(value: ImageAssetService | undefined): void {
        this.imageAssetService = value;
    }

    getImageGenerationService(): ImageGenerationService | undefined {
        return this.imageGenerationService;
    }

    setImageGenerationServiceForCompatibility(value: ImageGenerationService | undefined): void {
        this.imageGenerationService = value;
    }

    getWritingVersions(): WritingVersionService | undefined {
        return this.writingVersions;
    }

    setWritingVersionsForCompatibility(value: WritingVersionService | undefined): void {
        this.writingVersions = value;
    }

    getWritingSave(): WritingSaveAction | undefined {
        return this.writingSave;
    }

    setWritingSaveForCompatibility(value: WritingSaveAction | undefined): void {
        this.writingSave = value;
    }

    getWritingStyleService(): WritingStyleService | undefined {
        const coordinator = this.dependencies.writingStyleRuntime.getCoordinator();
        if (!coordinator || !this.writingVersions || !this.dependencies.writingStyleRuntime.isOwnerCurrent()) {
            return undefined;
        }
        if (this.writingStyleService && this.writingStyleCoordinator === coordinator) {
            return this.writingStyleService;
        }
        this.writingStyleService?.dispose();
        this.writingStyleCoordinator = coordinator;
        this.writingStyleService = new WritingStyleService({
            versions: this.writingVersions,
            coordinator,
            getStateSnapshot: () => this.dependencies.writingStyleRuntime.getStateSnapshot(),
            isRuntimeEnabled: () => this.dependencies.writingStyleRuntime.isRuntimeEnabled(coordinator),
            canManage: () => this.dependencies.writingStyleRuntime.canManage(coordinator),
            verifyNoteSource: (ref, signal) => this.dependencies.writingStyleRuntime.verifyNoteSource(ref, signal),
        });
        return this.writingStyleService;
    }

    setWritingStyleServiceForCompatibility(value: WritingStyleService | undefined): void {
        this.writingStyleService = value;
    }

    getWritingStyleCoordinator(): MemoryGovernanceCoordinator | undefined {
        return this.writingStyleCoordinator;
    }

    setWritingStyleCoordinatorForCompatibility(value: MemoryGovernanceCoordinator | undefined): void {
        this.writingStyleCoordinator = value;
    }

    prepareWritingRecoverySources(
        recovery: ChatWritingRecovery,
        images: readonly MessageImage[],
        conversationId: string,
        metadata?: ChatTurnMemoryMetadata,
    ): Promise<WritingRecoverySourceReceipt> {
        const manager = this.chatHistoryManager;
        const versions = this.writingVersions;
        const imageAssets = this.imageAssetService;
        return prepareWritingRecoverySources({
            versions,
            isMemoryAllowed: () => this.dependencies.writingRecovery.isMemoryEnabled(),
            captureLifetime: (id) => {
                const sourceCurrent = manager?.captureSourceLifetime(id);
                return () => this.chatHistoryManager === manager
                    && this.writingVersions === versions
                    && this.dependencies.isChatRuntimeCurrent()
                    && sourceCurrent?.() === true;
            },
            verifyNote: (ref, memory) => this.dependencies.writingRecovery.verifyNote(ref, memory),
            verifyImage: async (image) => {
                if (!imageAssets || this.imageAssetService !== imageAssets) {
                    throw new Error("Writing image unavailable");
                }
                const receipt = await imageAssets.verify(image.ref, "provider");
                return { isCurrent: () => this.imageAssetService === imageAssets && receipt.isCurrent() };
            },
            verifyGenerationSource: (source) => this.dependencies.writingRecovery.verifyGenerationSource(source),
        }, recovery, images, conversationId, metadata);
    }

    createChatHost(): ChatHost {
        const actions = this.dependencies.hostActions;
        return {
            app: this.dependencies.app,
            settings: this.dependencies.getSettings(),
            get isOperationsAgentEnabled() {
                return actions.isOperationsAgentEnabled();
            },
            log: (...args: unknown[]) => actions.log(args[0] as string, ...args.slice(1)),
            getAISetupIssue: () => actions.getAISetupIssue(),
            getAIReadiness: (scope) => actions.getAIReadiness(scope),
            refreshAPITokenPresence: () => actions.refreshAPITokenPresence(),
            chatHistoryManager: this.chatHistoryManager,
            imageAssetService: this.imageAssetService,
            imageGenerationService: this.imageGenerationService,
            confirmImageGenerationFirstUse: () => actions.confirmImageGenerationFirstUse(),
            writingVersions: this.writingVersions,
            writingOutputProtocol: "native",
            writingSave: this.writingSave,
            rememberWritingStyle: (versionId, scene) => actions.rememberWritingStyle(versionId, scene),
            readWritingStyleReferences: (revisionIds, signal) =>
                actions.readWritingStyleReferences(revisionIds, signal) as never,
            prepareWritingRecoverySources: (recovery, images, conversationId, metadata) =>
                this.prepareWritingRecoverySources(recovery, images, conversationId, metadata),
            onWritingReferencesChanged: (listener) => actions.onWritingReferencesChanged(listener),
            prepareWritingStyle: (prompt, parentScene, budget) =>
                actions.prepareWritingStyle(prompt, parentScene, budget),
            prepareWritingStyleForScene: actions.prepareWritingStyleForScene,
            memoryStatus: actions.createMemoryStatus(),
            createChatService: () => this.createChatService(),
            onSettingsChanged: (listener) => actions.onSettingsChanged(listener),
            scheduleMemoryExtractionAfterChatTurn: (conversationId, turnCount) =>
                actions.scheduleMemoryExtractionAfterChatTurn(conversationId, turnCount),
            openMemorySettings: (claimId) => actions.openMemorySettings(claimId),
            completeAISetup: (input) => actions.completeAISetup(input),
        };
    }

    async drainWriting(): Promise<void> {
        if (this.writingSave) {
            await this.writingSave.dispose().catch((error) => {
                this.dependencies.log("Failed to finish writing save cleanup", error);
            });
            this.writingSave = undefined;
        }
        this.writingStyleService?.dispose();
        this.writingStyleService = undefined;
        this.writingStyleCoordinator = undefined;
        if (this.writingVersions) {
            await this.writingVersions.dispose();
            this.writingVersions = undefined;
        }
    }

    async disposeImages(): Promise<void> {
        this.imageGenerationService?.dispose();
        this.imageGenerationService = undefined;
        if (this.imageAssetService) {
            await this.imageAssetService.dispose().catch((error) => {
                this.dependencies.log("Failed to dispose image resources", error);
            });
            this.imageAssetService = undefined;
        }
    }

    releaseHistory(): void {
        const store = this.chatHistoryStore;
        if (store) {
            void store.dispose().catch((error) => {
                this.dependencies.log("Failed to dispose chat history store", error);
            });
        }
        this.chatHistoryStore = undefined;
        this.chatHistoryManager = undefined;
    }
}
