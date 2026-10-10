import type { App } from "obsidian";
import type {
    AIReadinessScope,
    AIReadinessSnapshot,
    APITokenCacheState,
} from "../ai-services/ai-utils";
import type { ChatService } from "../ai-services/chat-service";
import type { MemoryStatusPort } from "../memory/MemoryStatusPort";
import type { ChatHistoryManager } from "./chat-history-manager";
import type { ImageAssetService } from "./image-assets";
import type { ImageGenerationService } from "./image-generation-service";
import type { WritingVersionService } from "./writing-versions";
import type { WritingSaveAction } from "./writing-save-action";
import type { WritingScene } from "./writing-types";
import type { WritingStyleReference, WritingStyleService } from './writing-style-service';
import type { ChatTurnMemoryMetadata, ChatWritingRecovery } from '../ai-services/chat-types';
import type { MessageImage } from './image-types';
import type { ComposerImageGenerationOptions, ComposerImageTextSource } from './composer-draft';
import type { ImageGenerationPromptOrigin } from './image-generation-types';
import type { WritingRecoverySourceReceipt } from './writing-recovery-sources';
import type { ChatSourceScope } from '../ai-services/chat-source-scope';
import type { PrepareFeaturedImagePromptInput,
    PrepareFeaturedImagePromptRuntime } from '../ai-services/prepare-featured-image-prompt';
import type { OperationsReviewSession } from '../ai-services/operations/operations-review-session';
import type { DebugContent, DebugTracePage, DebugTraceQuery } from '../agent-debug/types';
import type { AgentDebugRouteTarget } from '../agent-debug/view';

export type AISetupFailureCode =
    | "invalid_configuration"
    | "token_required"
    | "token_save_failed"
    | "settings_save_failed"
    | "compensation_failed";

export type AISetupResult =
    | { ok: true }
    | { ok: false; code: AISetupFailureCode };

export interface AISetupInput {
    presetKey?: string;
    token?: string;
}

export interface ChatHost {
    createGhostPublishingBinding?(request: import('../ghost-publishing/host-integration').GhostChatBindingRequest): import('../ai-services/chat-tool-types').GhostHostBinding | undefined;
    readGhostContextReceipt?(operationId: string): Promise<{
        operationId: string;
        revision: number;
        state: import('../ghost-publishing/state-schema').GhostLocalOperation['state'];
        verified: boolean;
    } | undefined>;
    clearGhostContextPersistence?(conversationId: string): void;
    openAgentDebug?(target?: string | AgentDebugRouteTarget): void | Promise<void>;
    recordAgentDebugTextCommitted?(runtimeRunId: string): void;
    readAgentDebugTrace?(captureId: string, query?: DebugTraceQuery): Promise<DebugTracePage>;
    readAgentDebugContents?(captureId: string, nodeId: string): Promise<DebugContent[]>;
    subscribeAgentDebug?(listener: (change?: { invalidated?: boolean }) => void): () => void;
    readonly app: App;
    readonly settings: {
        debug: boolean;
        memoryEnabled: boolean;
        aiProvider: string;
        baseURL: string;
        chatModelName: string;
        embeddingModelName?: string;
        operationsAgentEnabled: boolean;
        operationsProactiveSaveSuggestionsEnabled: boolean;
    };
    readonly isOperationsAgentEnabled: boolean;
    log(message: string, ...args: unknown[]): void;
    getAISetupIssue(): string | null;
    getAIReadiness?(scope?: AIReadinessScope): AIReadinessSnapshot;
    refreshAPITokenPresence?(): APITokenCacheState;
    readonly chatHistoryManager: ChatHistoryManager | undefined;
    readonly imageAssetService?: ImageAssetService;
    readonly imageGenerationService?: ImageGenerationService;
    confirmImageGenerationFirstUse?(this: void): Promise<boolean>;
    confirmFeaturedImageTextPreparationFirstUse?(this: void): Promise<boolean>;
    verifyImageTextSource?(source: ComposerImageTextSource, phase: 'before-send'): Promise<void>;
    isImageTextSourceCurrent?(source: ComposerImageTextSource): boolean;
    resolveImageNoteSource?(path: string, guard: import('../ai-services/task-source-read-guard').TaskSourceReadGuard | undefined,
        signal?: AbortSignal): Promise<ComposerImageTextSource>;
    isImagePromptOriginCurrent?(origin: ImageGenerationPromptOrigin): boolean;
    prepareFeaturedImagePrompt?(input: PrepareFeaturedImagePromptInput,
        runtime?: PrepareFeaturedImagePromptRuntime): Promise<string>;
    captureImageGenerationConnection?(): import('../ai-services/image-generation-connection').ImageGenerationConnection | null;
    getImageGenerationOptions?(): ComposerImageGenerationOptions;
    readonly writingVersions?: WritingVersionService;
    /** Host compatibility candidate; set only for the validated native rollout. */
    readonly writingOutputProtocol?: 'native';
    readonly writingSave?: WritingSaveAction;
    rememberWritingStyle?(versionId: string, scene: WritingScene): Promise<void>;
    readWritingStyleReferences?(revisionIds: readonly string[], signal?: AbortSignal): Promise<WritingStyleReference[]>;
    prepareWritingRecoverySources?(recovery: ChatWritingRecovery, images: readonly MessageImage[],
        conversationId: string, metadata?: ChatTurnMemoryMetadata,
        scope?: ChatSourceScope): Promise<WritingRecoverySourceReceipt>;
    onWritingReferencesChanged?(listener: () => void): () => void;
    prepareWritingStyleForScene?: WritingStyleService['prepare'];
    readonly memoryStatus: MemoryStatusPort;
    createChatService(): ChatService;
    registerOperationsReviewSession?(session: OperationsReviewSession): void;
    openOperationsReview?(reviewId: string): void | Promise<void>;
    invalidateOperationsReviewSession?(reviewId: string): void;
    onSettingsChanged(listener: () => void | Promise<void>): () => void;
    scheduleMemoryExtractionAfterChatTurn(conversationId: string, turnCount: number): void;
    openMemorySettings?(claimId?: string): void;
    completeAISetup?(input: AISetupInput): Promise<AISetupResult>;
}
