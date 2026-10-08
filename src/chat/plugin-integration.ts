import { TFile, getFrontMatterInfo, type App } from "obsidian";

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
import type { OperationsReviewSession } from "../ai-services/operations/operations-review-session";
import { prepareFeaturedImagePrompt } from "../ai-services/prepare-featured-image-prompt";
import { normalizeFeaturedImageFolderPath } from "../ai-services/featured-image-path";
import { normalizeFeaturedImageCount, normalizeFeaturedImageModel } from "../settings";
import { MemoryGovernanceCoordinator } from "../pa/memory-governance-coordinator";
import type { ImageGenerationConnection } from "../ai-services/image-generation-connection";
import type { OperationsSession } from "../ai-services/operations";
import type { AISetupInput, AISetupResult, ChatHost } from "./ChatHost";
import type { PluginManagerSettings } from "../settings";
import type {
    ChatTurnMemoryMetadata,
    ChatWritingRecovery,
} from "../ai-services/chat-types";
import type { MessageImage } from "./image-types";
import { captureComposerImageNoteSource, type ComposerImageGenerationOptions, type ComposerImageTextSource } from "./composer-draft";
import { ImagePreacceptError } from './image-generation-types';
import { throwIfAborted } from '../ai-services/chat-utils';
import { checkpointTaskSourceRead, type TaskSourceReadGuard } from '../ai-services/task-source-read-guard';
import type { WritingRecoverySourceReceipt } from "./writing-recovery-sources";
import type { ChatSourceScope } from "../ai-services/chat-source-scope";
import type { WritingScene } from "./writing-types";
import type { MemoryStatusPort } from "../memory/MemoryStatusPort";

type WritingRecoveryInput = Parameters<typeof prepareWritingRecoverySources>[0];

export interface ChatPluginSourceCapability {
    isDataBoundaryAllowedPath(path: string): boolean;
    isDataBoundaryAllowedFile(file: TFile): boolean;
    getDataBoundaryTags(file: TFile): string[];
}

export interface ChatHostActions {
    openAgentDebug?: ChatHost["openAgentDebug"];
    recordAgentDebugTextCommitted?: ChatHost["recordAgentDebugTextCommitted"];
    isOperationsAgentEnabled(): boolean;
    log(message: string, ...args: unknown[]): void;
    getAISetupIssue(): string | null;
    getAIReadiness(scope?: Parameters<NonNullable<ChatHost["getAIReadiness"]>>[0]): ReturnType<NonNullable<ChatHost["getAIReadiness"]>>;
    refreshAPITokenPresence(): ReturnType<NonNullable<ChatHost["refreshAPITokenPresence"]>>;
    confirmImageGenerationFirstUse(): Promise<boolean>;
    confirmFeaturedImageTextPreparationFirstUse?(): Promise<boolean>;
    rememberWritingStyle(versionId: string, scene: WritingScene): Promise<void>;
    readWritingStyleReferences: NonNullable<ChatHost["readWritingStyleReferences"]>;
    onWritingReferencesChanged(listener: () => void): () => void;
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
    getProviderConfigurationRevision(): number;
    getTokenRevision(): number;
    hasActiveAIProviderCredentialTransition(): boolean;
    showImageSyncNotice(receipt: { directory: string }): void;
    createOperationsSession(): OperationsSession;
    registerOperationsReviewSession?(session: OperationsReviewSession): void;
    openOperationsReview?(reviewId: string): void | Promise<void>;
    invalidateOperationsReviewSession?(reviewId: string): void;
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

    private imageTextSourceFile(source: { path: string }): TFile | null {
        const file = this.dependencies.app.vault.getAbstractFileByPath(source.path);
        return file instanceof TFile && file.extension === 'md'
            && this.dependencies.source.isDataBoundaryAllowedFile(file) ? file : null;
    }

    async resolveImageNoteSource(path: string, guard: TaskSourceReadGuard | undefined,
        signal?: AbortSignal): Promise<ComposerImageTextSource> {
        const checkSource = async () => {
            throwIfAborted(signal);
            await checkpointTaskSourceRead(guard, signal);
            if (!guard || guard.isNoteDomainAllowed?.() !== true || !guard.isPathAllowed(path)
                || !this.dependencies.isChatRuntimeCurrent()) {
                throw new ImagePreacceptError('source_unavailable');
            }
        };
        await checkSource();
        const file = this.imageTextSourceFile({ path });
        if (!file) throw new ImagePreacceptError('source_unavailable');
        const documentText = await this.dependencies.app.vault.cachedRead(file);
        await checkSource();
        if (this.imageTextSourceFile({ path }) !== file) {
            throw new ImagePreacceptError('source_changed', 'stale');
        }
        const source = captureComposerImageNoteSource(file, documentText);
        if (!source) throw new ImagePreacceptError('source_unavailable');
        return source;
    }

    async verifyImageTextSource(source: ComposerImageTextSource): Promise<void> {
        const file = this.imageTextSourceFile(source);
        if (!file || (source.file !== undefined && file !== source.file)) {
            throw new Error('image_generation:source_changed');
        }
        const documentText = await this.dependencies.app.vault.cachedRead(file);
        if (documentText !== source.documentText) throw new Error('image_generation:source_changed');
        if (source.kind === 'selection') {
            if (source.selection && documentText.slice(source.selection.from, source.selection.to) !== source.text) {
                throw new Error('image_generation:source_changed');
            }
        } else if (documentText.slice(getFrontMatterInfo(documentText).contentStart) !== source.text) {
            throw new Error('image_generation:source_changed');
        }
    }

    isImageTextSourceCurrent(source: ComposerImageTextSource): boolean {
        const file = this.imageTextSourceFile(source);
        return this.dependencies.isChatRuntimeCurrent() && file !== null
            && (source.file === undefined || file === source.file);
    }

    isImagePromptOriginCurrent(origin: { path: string }): boolean {
        return this.dependencies.isChatRuntimeCurrent() && this.imageTextSourceFile(origin) !== null;
    }

    getImageGenerationOptions(): ComposerImageGenerationOptions {
        const settings = this.dependencies.getSettings();
        return {
            model: normalizeFeaturedImageModel(settings.featuredImageModel),
            count: normalizeFeaturedImageCount(settings.numFeaturedImages),
            attachmentPathHint: normalizeFeaturedImageFolderPath(settings.featuredImagePath),
        };
    }

    captureImageGenerationConnection() {
        return this.dependencies.getImageGenerationConnection();
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

    invalidateWritingStyleGenerationClaim(claimId: string): void {
        this.writingStyleService?.invalidateGenerationClaim(claimId);
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
        scope?: ChatSourceScope,
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
        }, recovery, images, conversationId, metadata, scope);
    }

    createChatHost(): ChatHost {
        const actions = this.dependencies.hostActions;
        return {
            app: this.dependencies.app,
            openAgentDebug: actions.openAgentDebug,
            recordAgentDebugTextCommitted: actions.recordAgentDebugTextCommitted,
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
            ...(actions.confirmFeaturedImageTextPreparationFirstUse ? {
                confirmFeaturedImageTextPreparationFirstUse: () => actions.confirmFeaturedImageTextPreparationFirstUse!(),
            } : {}),
            verifyImageTextSource: (source, phase) => {
                if (phase !== 'before-send') throw new Error('Unsupported image source verification phase.');
                return this.verifyImageTextSource(source);
            },
            isImageTextSourceCurrent: source => this.isImageTextSourceCurrent(source),
            resolveImageNoteSource: (path, guard, signal) => this.resolveImageNoteSource(path, guard, signal),
            isImagePromptOriginCurrent: origin => this.isImagePromptOriginCurrent(origin),
            prepareFeaturedImagePrompt: (input, runtime) => {
                const providerRevision = this.dependencies.getProviderConfigurationRevision();
                const tokenRevision = this.dependencies.getTokenRevision();
                return prepareFeaturedImagePrompt(
                    this.dependencies.createAiServiceHost(),
                    {
                        ...input,
                        isSourceCurrent: () => this.dependencies.isChatRuntimeCurrent() && input.isSourceCurrent(),
                        isConnectionCurrent: () => !this.dependencies.hasActiveAIProviderCredentialTransition()
                            && this.dependencies.getProviderConfigurationRevision() === providerRevision
                            && this.dependencies.getTokenRevision() === tokenRevision
                            && this.dependencies.isChatRuntimeCurrent(),
                    },
                    runtime,
                );
            },
            captureImageGenerationConnection: () => this.captureImageGenerationConnection(),
            getImageGenerationOptions: () => this.getImageGenerationOptions(),
            writingVersions: this.writingVersions,
            writingOutputProtocol: "native",
            writingSave: this.writingSave,
            rememberWritingStyle: (versionId, scene) => actions.rememberWritingStyle(versionId, scene),
            readWritingStyleReferences: (revisionIds, signal) =>
                actions.readWritingStyleReferences(revisionIds, signal),
            prepareWritingRecoverySources: (recovery, images, conversationId, metadata, scope) =>
                this.prepareWritingRecoverySources(recovery, images, conversationId, metadata, scope),
            onWritingReferencesChanged: (listener) => actions.onWritingReferencesChanged(listener),
            prepareWritingStyleForScene: actions.prepareWritingStyleForScene,
            memoryStatus: actions.createMemoryStatus(),
            createChatService: () => this.createChatService(),
            ...(this.dependencies.registerOperationsReviewSession ? {
                registerOperationsReviewSession: (session) => this.dependencies.registerOperationsReviewSession?.(session),
            } : {}),
            ...(this.dependencies.openOperationsReview ? {
                openOperationsReview: (reviewId) => this.dependencies.openOperationsReview?.(reviewId),
            } : {}),
            ...(this.dependencies.invalidateOperationsReviewSession ? {
                invalidateOperationsReviewSession: (reviewId) => this.dependencies.invalidateOperationsReviewSession?.(reviewId),
            } : {}),
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
