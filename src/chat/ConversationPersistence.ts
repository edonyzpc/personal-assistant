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
    private unpersistedFinalizedEntries = new Set<TimelineEntry>();

    constructor(private readonly options: ConversationPersistenceOptions) {}

    get activeConversationId(): string | null {
        return this.activeId;
    }

    get activeConversationTurnCount(): number {
        return this.activeConversation?.turnCount ?? 0;
    }

    get operationsSaveSuggestionState(): "offered" | "accepted" | "declined" | undefined {
        return this.activeConversation?.operationsSaveSuggestionState;
    }

    async setOperationsSaveSuggestionState(
        state: "offered" | "accepted" | "declined",
    ): Promise<void> {
        const conversationId = this.activeId;
        const manager = await this.getReadyManager();
        if (!manager || !conversationId) return;
        try {
            const updated = await manager.updateOperationsSaveSuggestionState(conversationId, state);
            if (updated && this.activeId === conversationId) this.activeConversation = updated;
        } catch (error) {
            this.options.log("Failed to persist Operations save suggestion state", error);
        }
    }

    async waitForPendingWrites(): Promise<void> {
        await this.persistChain.catch(() => undefined);
    }

    resetActiveConversationState(): void {
        this.activeConversation = null;
        this.activeId = null;
        this.nextTurnIndex = 0;
        this.persistedTurnIndexByEntry = new WeakMap<TimelineEntry, number>();
        this.unpersistedFinalizedEntries.clear();
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

    async clearActiveConversationPointer(): Promise<boolean> {
        const manager = await this.getReadyManager();
        if (!manager) return false;
        try {
            await manager.setActiveConversationId(null);
            return true;
        } catch (error) {
            this.options.log("Failed to clear active conversation pointer", error);
            return false;
        }
    }

    async clearActiveConversationPointerForHandoff(input: {
        hasVisibleConversation: boolean;
        canCommit: () => boolean;
        commit: () => void;
    }): Promise<boolean> {
        await this.waitForPendingWrites();
        if (!input.canCommit()) return false;

        let manager: ChatHistoryManager | null;
        try {
            manager = await this.getReadyManager();
        } catch (error) {
            this.options.log("Failed to verify chat history before Pagelet handoff", error);
            return false;
        }

        if (!input.canCommit()) return false;
        if (!manager) {
            if (input.hasVisibleConversation || !input.canCommit()) return false;
            try {
                input.commit();
                return true;
            } catch (error) {
                this.options.log("Failed to commit Pagelet handoff without chat persistence", error);
                return false;
            }
        }
        if (
            input.hasVisibleConversation
            && (
                !this.activeId
                || this.unpersistedFinalizedEntries.size > 0
            )
        ) {
            return false;
        }

        let previousActiveConversationId: string | null;
        try {
            previousActiveConversationId = await manager.getActiveConversationId();
            if (!input.canCommit()) return false;
            await manager.setActiveConversationId(null);
        } catch (error) {
            this.options.log("Failed to clear active conversation pointer for Pagelet handoff", error);
            return false;
        }

        if (!input.canCommit()) {
            await this.restoreActiveConversationPointerAfterCancelledHandoff(
                manager,
                previousActiveConversationId,
            );
            return false;
        }

        try {
            input.commit();
            return true;
        } catch (error) {
            this.options.log("Failed to commit Pagelet handoff after clearing chat pointer", error);
            await this.restoreActiveConversationPointerAfterCancelledHandoff(
                manager,
                previousActiveConversationId,
            );
            return false;
        }
    }

    private async restoreActiveConversationPointerAfterCancelledHandoff(
        manager: ChatHistoryManager,
        conversationId: string | null,
    ): Promise<void> {
        try {
            await manager.setActiveConversationId(conversationId);
        } catch (error) {
            this.options.log("Failed to restore active conversation pointer after cancelled Pagelet handoff", error);
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
        this.unpersistedFinalizedEntries.clear();

        return { chatHistory, timelineEntries };
    }

    persistFinalizedTurn(prompt: string, entry: TimelineEntry): Promise<boolean> {
        if (entry.kind !== 'history') return Promise.resolve(true);
        this.unpersistedFinalizedEntries.add(entry);
        let persisted = false;
        const next = this.persistChain
            .catch(() => undefined)
            .then(async () => {
                persisted = await this.runPersistFinalizedTurn(prompt, entry);
            });
        this.persistChain = next;
        return next.then(() => persisted);
    }

    private async runPersistFinalizedTurn(prompt: string, entry: TimelineEntry): Promise<boolean> {
        if (entry.kind !== 'history') return true;
        const manager = await this.getReadyManager();
        if (!manager) return false;

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
            this.unpersistedFinalizedEntries.delete(entry);
            try {
                this.options.scheduleMemoryExtractionAfterChatTurn?.(conversationId, updated.turnCount);
            } catch (error) {
                this.options.log("Failed to schedule Memory extraction after chat turn", error);
            }
            try {
                await manager.maybePrune();
            } catch (error) {
                this.options.log("Failed to prune chat conversations after persisting turn", error);
            }
            return true;
        } catch (error) {
            this.options.log("Failed to persist chat turn", error);
            return false;
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
