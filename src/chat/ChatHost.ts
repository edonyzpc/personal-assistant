import type { App } from "obsidian";
import type { ChatService } from "../ai-services/chat-service";
import type { MemoryStatusPort } from "../memory/MemoryStatusPort";
import type { ChatHistoryManager } from "./chat-history-manager";

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
    };
    log(message: string, ...args: unknown[]): void;
    getAISetupIssue(): string | null;
    readonly chatHistoryManager: ChatHistoryManager | undefined;
    readonly memoryStatus: MemoryStatusPort;
    createChatService(): ChatService;
    onSettingsChanged(listener: () => void | Promise<void>): () => void;
    scheduleMemoryExtractionAfterChatTurn(conversationId: string, turnCount: number): void;
}
