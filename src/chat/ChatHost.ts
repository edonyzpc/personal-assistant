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
import type { WritingVersionService } from "./writing-versions";
import type { WritingSaveAction } from "./writing-save-action";
import type { WritingScene } from "./writing-types";
import type { WritingStyleReference, WritingStyleService } from './writing-style-service';
import type { ChatWritingStylePreparation, ChatWritingStyleResult } from '../ai-services/chat-types';
import type { ChatTurnMemoryMetadata, ChatWritingRecovery } from '../ai-services/chat-types';
import type { MessageImage } from './image-types';
import type { WritingRecoverySourceReceipt } from './writing-recovery-sources';

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
    readonly writingVersions?: WritingVersionService;
    /** Host compatibility candidate; set only for the validated native rollout. */
    readonly writingOutputProtocol?: 'native';
    readonly writingSave?: WritingSaveAction;
    rememberWritingStyle?(versionId: string, scene: WritingScene): Promise<void>;
    readWritingStyleReferences?(revisionIds: readonly string[], signal?: AbortSignal): Promise<WritingStyleReference[]>;
    prepareWritingRecoverySources?(recovery: ChatWritingRecovery, images: readonly MessageImage[],
        conversationId: string, metadata?: ChatTurnMemoryMetadata): Promise<WritingRecoverySourceReceipt>;
    onWritingReferencesChanged?(listener: () => void): () => void;
    prepareWritingStyle?(prompt: string, parentScene: WritingScene | undefined,
        budget: Parameters<ChatWritingStylePreparation>[0]): Promise<ChatWritingStyleResult>;
    prepareWritingStyleForScene?: WritingStyleService['prepare'];
    readonly memoryStatus: MemoryStatusPort;
    createChatService(): ChatService;
    onSettingsChanged(listener: () => void | Promise<void>): () => void;
    scheduleMemoryExtractionAfterChatTurn(conversationId: string, turnCount: number): void;
    openMemorySettings?(claimId?: string): void;
    completeAISetup?(input: AISetupInput): Promise<AISetupResult>;
}
