import type {
    ChatMessage,
    ChatTurnMemoryMetadata,
    PaAgentPersistedTurn,
    SourceRecord,
    TurnEndStatus,
} from "../ai-services/chat-types";
import { PA_AGENT_CANONICAL_TURN_SCHEMA_VERSION } from "../ai-services/chat-types";
import type { HistoryTurnEntry } from "./types";
import {
    CHAT_HISTORY_SCHEMA_VERSION,
    MAX_CONVERSATIONS,
    type ChatHistoryStore,
    type PersistedConversation,
    type PersistedChatMessage,
    type PersistedTurn,
} from "./chat-history-store";

const TITLE_MAX_LENGTH = 60;
const PREVIEW_MAX_LENGTH = 200;
const DEFAULT_PRUNE_INTERVAL = 10;

export interface RehydratedTurn {
    userMessage: ChatMessage;
    assistantMessage: ChatMessage;
    historyEntry: HistoryTurnEntry;
}

export interface ChatHistoryManagerOptions {
    store: ChatHistoryStore;
    maxConversations?: number;
    pruneInterval?: number;
    generateId?: () => string;
    now?: () => Date;
    log?: (message: string, error?: unknown) => void;
}

export class ChatHistoryManager {
    private readonly store: ChatHistoryStore;
    private readonly maxConversations: number;
    private readonly pruneInterval: number;
    private readonly generateId: () => string;
    private readonly now: () => Date;
    private readonly log: (message: string, error?: unknown) => void;
    private initializing: Promise<void> | null = null;
    private initialized = false;
    private initializationFailed = false;
    private turnsSinceLastPrune = 0;

    constructor(options: ChatHistoryManagerOptions) {
        this.store = options.store;
        this.maxConversations = options.maxConversations ?? MAX_CONVERSATIONS;
        this.pruneInterval = Math.max(1, options.pruneInterval ?? DEFAULT_PRUNE_INTERVAL);
        this.generateId = options.generateId ?? generateUuid;
        this.now = options.now ?? (() => new Date());
        this.log = options.log ?? (() => undefined);
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;
        if (this.initializationFailed) return;
        if (!this.initializing) {
            this.initializing = this.store
                .initialize()
                .then(async () => {
                    const existing = await this.store.getSchemaVersion();
                    if (existing === null) {
                        await this.store.setSchemaVersion(CHAT_HISTORY_SCHEMA_VERSION);
                    } else if (existing > CHAT_HISTORY_SCHEMA_VERSION) {
                        this.log(
                            `Chat history schema version ${existing} is newer than ${CHAT_HISTORY_SCHEMA_VERSION}; reading anyway.`,
                        );
                    }
                    this.initialized = true;
                })
                .catch((error) => {
                    this.initializationFailed = true;
                    this.initializing = null;
                    this.log("Chat history store failed to initialize; persistence disabled.", error);
                });
        }
        await this.initializing;
    }

    isAvailable(): boolean {
        return this.initialized && !this.initializationFailed;
    }

    async listConversations(): Promise<PersistedConversation[]> {
        if (!this.isAvailable()) return [];
        return this.store.listConversations();
    }

    async getTurns(conversationId: string): Promise<PersistedTurn[]> {
        if (!this.isAvailable()) return [];
        return this.store.getTurns(conversationId);
    }

    async getActiveConversationId(): Promise<string | null> {
        if (!this.isAvailable()) return null;
        return this.store.getActiveConversationId();
    }

    async setActiveConversationId(id: string | null): Promise<void> {
        if (!this.isAvailable()) return;
        await this.store.setActiveConversationId(id);
    }

    async deleteConversation(id: string): Promise<void> {
        if (!this.isAvailable()) return;
        await this.store.deleteTurnsForConversation(id);
        await this.store.deleteConversation(id);
    }

    async startConversation(firstUserMessage: string): Promise<PersistedConversation> {
        const id = this.generateId();
        const timestamp = this.toIso(this.now());
        const conversation: PersistedConversation = {
            id,
            title: deriveTitle(firstUserMessage),
            createdAt: timestamp,
            updatedAt: timestamp,
            turnCount: 0,
            preview: derivePreview(firstUserMessage),
        };
        if (this.isAvailable()) {
            await this.store.upsertConversation(conversation);
            await this.store.setActiveConversationId(id);
        }
        return conversation;
    }

    async recordTurn(input: {
        conversationId: string;
        turnIndex: number;
        entry: HistoryTurnEntry;
        userPrompt: string;
        conversation: PersistedConversation;
    }): Promise<PersistedConversation> {
        const updated: PersistedConversation = {
            ...input.conversation,
            updatedAt: this.toIso(this.now()),
            turnCount: input.turnIndex + 1,
            preview: input.conversation.preview || derivePreview(input.userPrompt),
            title: input.conversation.title || deriveTitle(input.userPrompt),
        };
        if (!this.isAvailable()) return updated;
        const turn = this.serializeTurn(input.entry, input.conversationId, input.turnIndex);
        await this.store.appendTurnAndUpdateConversation(turn, updated);
        return updated;
    }

    async maybePrune(): Promise<string[]> {
        if (!this.isAvailable()) return [];
        this.turnsSinceLastPrune += 1;
        if (this.turnsSinceLastPrune < this.pruneInterval) return [];
        this.turnsSinceLastPrune = 0;
        return this.prune();
    }

    async deleteTurn(conversationId: string, turnIndex: number): Promise<void> {
        if (!this.isAvailable()) return;
        await this.store.deleteTurn(conversationId, turnIndex);
        const conversation = await this.store.getConversation(conversationId);
        if (conversation) {
            await this.store.upsertConversation({
                ...conversation,
                updatedAt: this.toIso(this.now()),
                turnCount: Math.max(0, conversation.turnCount - 1),
            });
        }
    }

    async findConversation(id: string): Promise<PersistedConversation | null> {
        if (!this.isAvailable()) return null;
        return this.store.getConversation(id);
    }

    async removeTurnsFromIndex(conversationId: string, fromIndex: number): Promise<void> {
        if (!this.isAvailable()) return;
        const turns = await this.store.getTurns(conversationId);
        const surviving = turns.filter((turn) => turn.turnIndex < fromIndex);
        await this.store.deleteTurnsForConversation(conversationId);
        for (const turn of surviving) {
            await this.store.appendTurn(turn);
        }
        const conversation = await this.store.getConversation(conversationId);
        if (conversation) {
            await this.store.upsertConversation({
                ...conversation,
                updatedAt: this.toIso(this.now()),
                turnCount: surviving.length,
            });
        }
    }

    async prune(): Promise<string[]> {
        if (!this.isAvailable()) return [];
        try {
            return await this.store.pruneOldConversations(this.maxConversations);
        } catch (error) {
            this.log("Failed to prune chat conversations", error);
            return [];
        }
    }

    serializeTurn(
        entry: HistoryTurnEntry,
        conversationId: string,
        turnIndex: number,
    ): PersistedTurn {
        const assistantCanonical = entry.assistant.canonicalTurn;
        const userMessage: PersistedChatMessage = {
            role: "user",
            content: entry.user.content,
            ...(entry.user.runtimeWarnings && entry.user.runtimeWarnings.length > 0
                ? { runtimeWarnings: entry.user.runtimeWarnings.map(cloneRuntimeWarning) }
                : {}),
        };
        const assistantSourceRecords = assistantCanonical?.sourceRecords
            ?? entry.assistant.memoryMetadata?.sourceRecords;
        const assistantMessage: PersistedChatMessage = {
            role: "assistant",
            content: entry.assistant.content,
            ...(assistantSourceRecords && assistantSourceRecords.length > 0
                ? { sourceRecords: assistantSourceRecords.map(cloneSourceRecord) }
                : {}),
            ...(entry.assistant.runtimeWarnings && entry.assistant.runtimeWarnings.length > 0
                ? { runtimeWarnings: entry.assistant.runtimeWarnings.map(cloneRuntimeWarning) }
                : {}),
            ...(assistantCanonical?.status ? { turnStatus: assistantCanonical.status } : {}),
        };
        const memoryMetadata = entry.assistant.memoryMetadata ?? entry.memoryMetadata;
        return {
            conversationId,
            turnIndex,
            user: userMessage,
            assistant: assistantMessage,
            ...(memoryMetadata ? { memoryMetadata: cloneMemoryMetadata(memoryMetadata) } : {}),
            ...(entry.contextUsedItems && entry.contextUsedItems.length > 0
                ? { contextUsed: entry.contextUsedItems.map((item) => ({ ...item })) }
                : {}),
            ...(entry.activityDetails && entry.activityDetails.length > 0
                ? { activityDetails: [...entry.activityDetails] }
                : {}),
            ...(entry.providerReasoningObserved
                ? { providerReasoningObserved: entry.providerReasoningObserved }
                : {}),
        };
    }

    deserializeTurn(turn: PersistedTurn): RehydratedTurn {
        const userMessage: ChatMessage = {
            role: "user",
            content: turn.user.content,
            ...(turn.user.runtimeWarnings && turn.user.runtimeWarnings.length > 0
                ? { runtimeWarnings: turn.user.runtimeWarnings.map(cloneRuntimeWarning) }
                : {}),
        };
        const memoryMetadata = turn.memoryMetadata ? cloneMemoryMetadata(turn.memoryMetadata) : undefined;
        const status = turn.assistant.turnStatus ?? "completed";
        const canonicalTurn = rebuildCanonicalTurn({
            conversationId: turn.conversationId,
            turnIndex: turn.turnIndex,
            sourceRecords: turn.assistant.sourceRecords,
            contextUsed: turn.contextUsed,
            status,
        });
        const assistantMessage: ChatMessage = {
            role: "assistant",
            content: turn.assistant.content,
            canonicalTurn,
            ...(memoryMetadata ? { memoryMetadata: cloneMemoryMetadata(memoryMetadata) } : {}),
            ...(turn.assistant.runtimeWarnings && turn.assistant.runtimeWarnings.length > 0
                ? { runtimeWarnings: turn.assistant.runtimeWarnings.map(cloneRuntimeWarning) }
                : {}),
        };
        const historyEntry: HistoryTurnEntry = {
            kind: "history",
            user: userMessage,
            assistant: assistantMessage,
            ...(memoryMetadata ? { memoryMetadata: cloneMemoryMetadata(memoryMetadata) } : {}),
            ...(turn.contextUsed && turn.contextUsed.length > 0
                ? { contextUsedItems: turn.contextUsed.map((item) => ({ ...item })) }
                : {}),
            ...(turn.activityDetails && turn.activityDetails.length > 0
                ? { activityDetails: [...turn.activityDetails] }
                : {}),
            ...(turn.providerReasoningObserved
                ? { providerReasoningObserved: true }
                : {}),
        };
        return { userMessage, assistantMessage, historyEntry };
    }

    private toIso(date: Date): string {
        try {
            return date.toISOString();
        } catch {
            return new Date().toISOString();
        }
    }
}

export function deriveTitle(message: string): string {
    const normalized = (message ?? "").trim();
    if (!normalized) return "New conversation";
    const firstLine = normalized.split(/\r?\n/, 1)[0]?.trim() ?? "";
    if (!firstLine) return "New conversation";
    if (firstLine.length <= TITLE_MAX_LENGTH) return firstLine;
    return `${firstLine.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}

export function derivePreview(message: string): string {
    const normalized = (message ?? "").trim().replace(/\s+/g, " ");
    if (!normalized) return "";
    if (normalized.length <= PREVIEW_MAX_LENGTH) return normalized;
    return `${normalized.slice(0, PREVIEW_MAX_LENGTH - 1).trimEnd()}…`;
}

function rebuildCanonicalTurn(input: {
    conversationId: string;
    turnIndex: number;
    sourceRecords?: SourceRecord[];
    contextUsed?: PersistedTurn["contextUsed"];
    status: TurnEndStatus;
}): PaAgentPersistedTurn {
    const turnId = `rehydrated:${input.conversationId}:${input.turnIndex}`;
    return {
        schemaVersion: PA_AGENT_CANONICAL_TURN_SCHEMA_VERSION,
        runId: turnId,
        turnId,
        status: input.status,
        ...(input.sourceRecords && input.sourceRecords.length > 0
            ? { sourceRecords: input.sourceRecords.map(cloneSourceRecord) }
            : {}),
        ...(input.contextUsed && input.contextUsed.length > 0
            ? { contextUsed: input.contextUsed.map((item) => ({ ...item })) }
            : {}),
        messages: [],
    };
}

function cloneMemoryMetadata(metadata: ChatTurnMemoryMetadata): ChatTurnMemoryMetadata {
    return {
        hasMemoryContent: metadata.hasMemoryContent,
        allowedMemorySourcePaths: [...metadata.allowedMemorySourcePaths],
        ...(metadata.contextUsed
            ? { contextUsed: metadata.contextUsed.map((item) => ({ ...item })) }
            : {}),
        ...(metadata.sourceRecords
            ? { sourceRecords: metadata.sourceRecords.map(cloneSourceRecord) }
            : {}),
    };
}

function cloneSourceRecord(record: SourceRecord): SourceRecord {
    return {
        ...record,
        metadata: record.metadata ? { ...record.metadata } : undefined,
    };
}

function cloneRuntimeWarning(warning: { type: string } & Record<string, unknown>) {
    return {
        ...warning,
        metadata:
            warning.metadata && typeof warning.metadata === "object"
                ? { ...(warning.metadata as Record<string, unknown>) }
                : undefined,
    } as typeof warning;
}

function generateUuid(): string {
    const cryptoApi = globalThis.crypto as (Crypto & { randomUUID?: () => string }) | undefined;
    if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
        try {
            return cryptoApi.randomUUID();
        } catch {
            // Fall through to manual fallback below.
        }
    }
    return `pa-chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
