import type { App } from "obsidian";
import type {
    AIReadinessScope,
    AIReadinessSnapshot,
    APITokenCacheState,
} from "../ai-services/ai-utils";
import type { ChatService } from "../ai-services/chat-service";
import type { MemoryStatusPort } from "../memory/MemoryStatusPort";
import type { ChatHistoryManager } from "./chat-history-manager";

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
        skillContextEnabled: boolean;
        enabledSkillIds: string[];
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
    readonly memoryStatus: MemoryStatusPort;
    createChatService(): ChatService;
    onSettingsChanged(listener: () => void | Promise<void>): () => void;
    scheduleMemoryExtractionAfterChatTurn(conversationId: string, turnCount: number): void;
    openMemorySettings?(claimId?: string): void;
    completeAISetup?(input: AISetupInput): Promise<AISetupResult>;
}
