import type { ChatMessage } from "../ai-services/chat-service";
import type { TimelineEntry } from "./types";
import type { ChatHistoryManager } from "./chat-history-manager";
import type { PersistedConversation, PersistedTurn } from "./chat-history-store";

export interface HydratedConversation {
    chatHistory: ChatMessage[];
    timelineEntries: TimelineEntry[];
}

export interface LoadedConversation {
    conversation: PersistedConversation;
    turns: PersistedTurn[];
}

export interface ConversationPersistenceOptions {
    getManager: () => ChatHistoryManager | undefined;
    log: (message: string, error?: unknown) => void;
    scheduleMemoryExtractionAfterChatTurn?: (conversationId: string, turnCount: number) => void;
}

export class ConversationPersistence {
    private activeConversation: PersistedConversation | null = null;
    private activeId: string | null = null;
    private nextTurnIndex = 0;
    private persistedTurnIndexByEntry = new WeakMap<TimelineEntry, number>();
    private persistChain: Promise<void> = Promise.resolve();

    constructor(private readonly options: ConversationPersistenceOptions) {}

    get activeConversationId(): string | null {
        return this.activeId;
    }

    async waitForPendingWrites(): Promise<void> {
        await this.persistChain.catch(() => undefined);
    }

    resetActiveConversationState(): void {
        this.activeConversation = null;
        this.activeId = null;
        this.nextTurnIndex = 0;
        this.persistedTurnIndexByEntry = new WeakMap<TimelineEntry, number>();
    }

    async getReadyManager(): Promise<ChatHistoryManager | null> {
        const manager = this.options.getManager();
        if (!manager) return null;
        await manager.initialize();
        return manager.isAvailable() ? manager : null;
    }

    async listConversations(): Promise<PersistedConversation[] | null> {
        const manager = await this.getReadyManager();
        if (!manager) return null;
        return manager.listConversations();
    }

    async loadActiveConversation(): Promise<LoadedConversation | null> {
        const manager = await this.getReadyManager();
        if (!manager) return null;
        const activeId = await manager.getActiveConversationId();
        if (!activeId) return null;
        const conversation = await manager.findConversation(activeId);
        if (!conversation) {
            await manager.setActiveConversationId(null);
            return null;
        }
        const turns = await manager.getTurns(activeId);
        return { conversation, turns };
    }

    async loadConversation(conversationId: string): Promise<LoadedConversation | null> {
        const manager = await this.getReadyManager();
        if (!manager) return null;
        const conversation = await manager.findConversation(conversationId);
        if (!conversation) return null;
        const turns = await manager.getTurns(conversationId);
        return { conversation, turns };
    }

    async commitActiveConversationPointer(
        conversationId: string,
        canCommit: () => boolean,
    ): Promise<boolean> {
        const manager = await this.getReadyManager();
        if (!manager || !canCommit()) return false;
        await manager.setActiveConversationId(conversationId);
        return true;
    }

    async clearActiveConversationPointer(): Promise<void> {
        const manager = await this.getReadyManager();
        if (!manager) return;
        try {
            await manager.setActiveConversationId(null);
        } catch (error) {
            this.options.log("Failed to clear active conversation pointer", error);
        }
    }

    async deleteConversation(conversationId: string): Promise<void> {
        const manager = await this.getReadyManager();
        if (!manager) return;
        try {
            await manager.deleteConversation(conversationId);
        } catch (error) {
            this.options.log("Failed to delete chat conversation", error);
        }
    }

    hydrateConversation(
        conversation: PersistedConversation,
        turns: PersistedTurn[],
    ): HydratedConversation | null {
        const manager = this.options.getManager();
        if (!manager) return null;

        const chatHistory: ChatMessage[] = [];
        const timelineEntries: TimelineEntry[] = [];
        let maxTurnIndex = -1;
        const persistedTurnIndexByEntry = new WeakMap<TimelineEntry, number>();

        for (const turn of turns) {
            const rehydrated = manager.deserializeTurn(turn);
            chatHistory.push(rehydrated.userMessage, rehydrated.assistantMessage);
            timelineEntries.push(rehydrated.historyEntry);
            persistedTurnIndexByEntry.set(rehydrated.historyEntry, turn.turnIndex);
            if (turn.turnIndex > maxTurnIndex) maxTurnIndex = turn.turnIndex;
        }

        this.activeConversation = conversation;
        this.activeId = conversation.id;
        this.nextTurnIndex = maxTurnIndex + 1;
        this.persistedTurnIndexByEntry = persistedTurnIndexByEntry;

        return { chatHistory, timelineEntries };
    }

    persistFinalizedTurn(prompt: string, entry: TimelineEntry): Promise<void> {
        const next = this.persistChain
            .catch(() => undefined)
            .then(() => this.runPersistFinalizedTurn(prompt, entry));
        this.persistChain = next;
        return next;
    }

    private async runPersistFinalizedTurn(prompt: string, entry: TimelineEntry): Promise<void> {
        if (entry.kind !== 'history') return;
        const manager = await this.getReadyManager();
        if (!manager) return;

        try {
            let conversation = this.activeConversation;
            let conversationId = this.activeId;
            if (!conversation || !conversationId) {
                const created = await manager.startConversation(prompt);
                conversation = created;
                conversationId = created.id;
                this.activeConversation = conversation;
                this.activeId = conversationId;
                this.nextTurnIndex = 0;
            }
            const turnIndex = this.nextTurnIndex;
            const updated = await manager.recordTurn({
                conversationId,
                turnIndex,
                entry,
                userPrompt: prompt,
                conversation,
            });
            this.activeConversation = updated;
            this.nextTurnIndex = turnIndex + 1;
            this.persistedTurnIndexByEntry.set(entry, turnIndex);
            this.options.scheduleMemoryExtractionAfterChatTurn?.(conversationId, updated.turnCount);
            await manager.maybePrune();
        } catch (error) {
            this.options.log("Failed to persist chat turn", error);
        }
    }

    async deletePersistedTurnForEntry(entry: TimelineEntry): Promise<void> {
        if (entry.kind !== 'history') return;
        const manager = await this.getReadyManager();
        if (!manager) return;
        const conversationId = this.activeId;
        if (!conversationId) return;
        const turnIndex = this.persistedTurnIndexByEntry.get(entry);
        if (turnIndex === undefined) return;
        try {
            await manager.deleteTurn(conversationId, turnIndex);
            this.persistedTurnIndexByEntry.delete(entry);
        } catch (error) {
            this.options.log("Failed to delete persisted chat turn", error);
        }
    }
}
