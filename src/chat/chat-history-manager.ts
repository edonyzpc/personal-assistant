import type {
    ChatContextUsedItem,
    ChatMessage,
    ChatRuntimeWarning,
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
import { getPlatformCrypto } from "../platform-dom";
import { cloneContextReductionReceipt } from "../pa/contracts/context-trace";
import { cloneChatHostProvenance } from "../ai-services/chat-provenance";
import { cloneGenerationInputSnapshot } from "../ai-services/generation-input-snapshot";
import { cloneMessageImages } from "./image-types";

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
    private sourceEpoch = 0;
    private readonly sourceRevisions = new Map<string, number>();
    private readonly sourceMutations = new Map<string, number>();
    private pruningSources = 0;
    private readonly sourceObservers = new Map<string, Set<AbortController>>();

    /** Short external-write lease; callers must release it when the write settles. */
    observeSourceLifetime(conversationId: string): { isCurrent: () => boolean; signal: AbortSignal; release: () => void } {
        const isCurrent = this.captureSourceLifetime(conversationId);
        const controller = new AbortController();
        const observers = this.sourceObservers.get(conversationId) ?? new Set<AbortController>();
        observers.add(controller);
        this.sourceObservers.set(conversationId, observers);
        if (!isCurrent()) controller.abort();
        return { isCurrent: () => !controller.signal.aborted && isCurrent(), signal: controller.signal,
            release: () => {
                observers.delete(controller);
                if (observers.size === 0 && this.sourceObservers.get(conversationId) === observers) {
                    this.sourceObservers.delete(conversationId);
                }
            } };
    }

    /** Capture before reading: an in-flight mutation cannot grant a valid source lease. */
    captureSourceLifetime(conversationId: string): () => boolean {
        const epoch = this.sourceEpoch;
        const revision = this.sourceRevisions.get(conversationId) ?? 0;
        const admitted = this.isAvailable() && this.pruningSources === 0
            && !this.sourceMutations.has(conversationId);
        return () => admitted && this.isAvailable() && this.pruningSources === 0
            && !this.sourceMutations.has(conversationId) && this.sourceEpoch === epoch
            && (this.sourceRevisions.get(conversationId) ?? 0) === revision;
    }

    private async mutateSources<T>(conversationId: string, mutation: () => Promise<T>): Promise<T> {
        this.sourceRevisions.set(conversationId, (this.sourceRevisions.get(conversationId) ?? 0) + 1);
        this.sourceMutations.set(conversationId, (this.sourceMutations.get(conversationId) ?? 0) + 1);
        for (const observer of this.sourceObservers.get(conversationId) ?? []) observer.abort();
        try {
            return await mutation();
        } finally {
            const remaining = (this.sourceMutations.get(conversationId) ?? 1) - 1;
            if (remaining > 0) this.sourceMutations.set(conversationId, remaining);
            else this.sourceMutations.delete(conversationId);
        }
    }

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
                    if (existing === null || existing < CHAT_HISTORY_SCHEMA_VERSION) {
                        await this.store.setSchemaVersion(CHAT_HISTORY_SCHEMA_VERSION);
                    } else if (existing > CHAT_HISTORY_SCHEMA_VERSION) {
                        throw new Error("Chat history was created by a newer plugin version");
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
        await this.mutateSources(id, async () => {
            await this.store.deleteTurnsForConversation(id);
            await this.store.deleteConversation(id);
        });
    }

    async startConversation(firstUserMessage: string, imageAnchor?: PersistedConversation['imageAnchor']): Promise<PersistedConversation> {
        const id = this.generateId();
        const timestamp = this.toIso(this.now());
        const conversation: PersistedConversation = {
            id,
            title: deriveTitle(firstUserMessage),
            createdAt: timestamp,
            updatedAt: timestamp,
            turnCount: 0,
            preview: derivePreview(firstUserMessage),
            ...(imageAnchor ? { imageAnchor: { ...imageAnchor } } : {}),
        };
        if (this.isAvailable()) {
            await this.mutateSources(id, async () => {
                await this.store.upsertConversation(conversation);
                await this.store.setActiveConversationId(id);
            });
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
        await this.mutateSources(input.conversationId, () => this.store.appendTurnAndUpdateConversation(turn, updated));
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
        await this.mutateSources(conversationId, async () => {
            await this.store.deleteTurn(conversationId, turnIndex);
            const conversation = await this.store.getConversation(conversationId);
            if (conversation) {
                await this.store.upsertConversation({
                    ...conversation,
                    updatedAt: this.toIso(this.now()),
                    turnCount: Math.max(0, conversation.turnCount - 1),
                });
            }
        });
    }

    async findConversation(id: string): Promise<PersistedConversation | null> {
        if (!this.isAvailable()) return null;
        return this.store.getConversation(id);
    }

    async updateOperationsSaveSuggestionState(
        conversationId: string,
        state: "offered" | "accepted" | "declined",
    ): Promise<PersistedConversation | null> {
        if (!this.isAvailable()) return null;
        const conversation = await this.store.getConversation(conversationId);
        if (!conversation) return null;
        const updated: PersistedConversation = {
            ...conversation,
            operationsSaveSuggestionState: state,
            updatedAt: this.toIso(this.now()),
        };
        await this.store.upsertConversation(updated);
        return updated;
    }

    async removeTurnsFromIndex(conversationId: string, fromIndex: number): Promise<void> {
        if (!this.isAvailable()) return;
        await this.mutateSources(conversationId, async () => {
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
        });
    }

    async prune(): Promise<string[]> {
        if (!this.isAvailable()) return [];
        this.sourceEpoch += 1;
        this.sourceRevisions.clear();
        this.pruningSources += 1;
        for (const observers of this.sourceObservers.values()) {
            for (const observer of observers) observer.abort();
        }
        try {
            return await this.store.pruneOldConversations(this.maxConversations);
        } catch (error) {
            this.log("Failed to prune chat conversations", error);
            return [];
        } finally {
            this.pruningSources -= 1;
        }
    }

    serializeTurn(
        entry: HistoryTurnEntry,
        conversationId: string,
        turnIndex: number,
    ): PersistedTurn {
        const assistantCanonical = entry.assistant.canonicalTurn;
        const assistantTurnStatus = assistantCanonical?.status
            ?? (entry.assistant.runtimeWarnings?.some((warning) => warning.type === "user_abort")
                ? "aborted"
                : undefined);
        const userMessage: PersistedChatMessage = {
            role: "user",
            content: entry.user.content,
            ...(entry.user.images ? { images: cloneMessageImages(entry.user.images) } : {}),
            ...(entry.user.hostProvenance !== undefined ? { hostProvenance: cloneChatHostProvenance(entry.user.hostProvenance) } : {}),
            ...(entry.user.runtimeWarnings && entry.user.runtimeWarnings.length > 0
                ? { runtimeWarnings: entry.user.runtimeWarnings.map(cloneRuntimeWarning) }
                : {}),
        };
        const assistantSourceRecords = assistantCanonical?.sourceRecords
            ?? entry.assistant.memoryMetadata?.sourceRecords;
        const assistantMessage: PersistedChatMessage = {
            role: "assistant",
            content: entry.assistant.content,
            ...(entry.assistant.writingVersionId !== undefined ? { writingVersionId: entry.assistant.writingVersionId } : {}),
            ...(entry.assistant.writingRecovery !== undefined ? { writingRecovery: { ...entry.assistant.writingRecovery,
                ...(entry.assistant.writingRecovery.generationInput
                    ? { generationInput: cloneGenerationInputSnapshot(entry.assistant.writingRecovery.generationInput) } : {}) } } : {}),
            ...(entry.assistant.images ? { images: cloneMessageImages(entry.assistant.images) } : {}),
            ...(entry.assistant.hostProvenance !== undefined ? { hostProvenance: cloneChatHostProvenance(entry.assistant.hostProvenance) } : {}),
            ...(entry.assistant.shareCardEligible !== undefined
                ? { shareCardEligible: entry.assistant.shareCardEligible }
                : {}),
            ...(assistantSourceRecords && assistantSourceRecords.length > 0
                ? { sourceRecords: assistantSourceRecords.map(cloneSourceRecord) }
                : {}),
            ...(entry.assistant.runtimeWarnings && entry.assistant.runtimeWarnings.length > 0
                ? { runtimeWarnings: entry.assistant.runtimeWarnings.map(cloneRuntimeWarning) }
                : {}),
            ...(assistantTurnStatus ? { turnStatus: assistantTurnStatus } : {}),
        };
        const memoryMetadata = entry.assistant.memoryMetadata ?? entry.memoryMetadata;
        return {
            conversationId,
            turnIndex,
            user: userMessage,
            assistant: assistantMessage,
            ...(memoryMetadata ? { memoryMetadata: cloneMemoryMetadata(memoryMetadata) } : {}),
            ...(entry.contextUsedItems && entry.contextUsedItems.length > 0
                ? { contextUsed: entry.contextUsedItems.map(cloneContextUsedItem) }
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
            ...(turn.user.images ? { images: cloneMessageImages(turn.user.images) } : {}),
            ...(turn.user.hostProvenance !== undefined ? { hostProvenance: cloneChatHostProvenance(turn.user.hostProvenance) } : {}),
            ...(turn.user.runtimeWarnings && turn.user.runtimeWarnings.length > 0
                ? { runtimeWarnings: turn.user.runtimeWarnings.map(cloneRuntimeWarning) }
                : {}),
        };
        const memoryMetadata = turn.memoryMetadata ? cloneMemoryMetadata(turn.memoryMetadata) : undefined;
        const status = turn.assistant.turnStatus
            ?? (turn.assistant.runtimeWarnings?.some((warning) => warning.type === "user_abort")
                ? "aborted"
                : "completed");
        const canonicalTurn = rebuildCanonicalTurn({
            conversationId: turn.conversationId,
            turnIndex: turn.turnIndex,
            sourceRecords: turn.assistant.sourceRecords,
            contextUsed: turn.contextUsed?.map(cloneContextUsedItem),
            status,
        });
        const assistantMessage: ChatMessage = {
            role: "assistant",
            content: turn.assistant.content,
            ...(turn.assistant.writingVersionId !== undefined ? { writingVersionId: turn.assistant.writingVersionId } : {}),
            ...(turn.assistant.writingRecovery !== undefined ? { writingRecovery: { ...turn.assistant.writingRecovery,
                ...(turn.assistant.writingRecovery.generationInput
                    ? { generationInput: cloneGenerationInputSnapshot(turn.assistant.writingRecovery.generationInput) } : {}) } } : {}),
            ...(turn.assistant.images ? { images: cloneMessageImages(turn.assistant.images) } : {}),
            ...(turn.assistant.hostProvenance !== undefined ? { hostProvenance: cloneChatHostProvenance(turn.assistant.hostProvenance) } : {}),
            canonicalTurn,
            ...(turn.assistant.shareCardEligible !== undefined
                ? { shareCardEligible: turn.assistant.shareCardEligible }
                : {}),
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
                ? { contextUsedItems: turn.contextUsed.map(cloneContextUsedItem) }
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
            ? { contextUsed: input.contextUsed.map(cloneContextUsedItem) }
            : {}),
        messages: [],
    };
}

function cloneMemoryMetadata(metadata: ChatTurnMemoryMetadata): ChatTurnMemoryMetadata {
    return {
        hasMemoryContent: metadata.hasMemoryContent,
        allowedMemorySourcePaths: [...metadata.allowedMemorySourcePaths],
        ...(metadata.contextUsed
            ? { contextUsed: metadata.contextUsed.map(cloneContextUsedItem) }
            : {}),
        ...(metadata.sourceRecords
            ? { sourceRecords: metadata.sourceRecords.map(cloneSourceRecord) }
            : {}),
        ...(metadata.contextTrace ? { contextTrace: cloneContextTrace(metadata.contextTrace) } : {}),
    };
}

function cloneContextUsedItem(item: ChatContextUsedItem): ChatContextUsedItem {
    const copy: ChatContextUsedItem = { ...item };
    if (item.memoryClaimId) {
        delete copy.sources;
    } else if (item.sources) {
        copy.sources = item.sources.map((source) => ({ ...source }));
    }
    return copy;
}

function cloneContextTrace(trace: NonNullable<ChatTurnMemoryMetadata["contextTrace"]>): NonNullable<ChatTurnMemoryMetadata["contextTrace"]> {
    const { reduction: rawReduction, ...rest } = trace;
    const reduction = cloneContextReductionReceipt(rawReduction);
    return {
        ...rest,
        ...(reduction ? { reduction } : {}),
        usedSourceRefs: trace.usedSourceRefs.map((ref) => ({
            ...ref,
            whyShown: ref.whyShown ? [...ref.whyShown] : undefined,
        })),
        skippedSourceRefs: trace.skippedSourceRefs.map((ref) => ({
            ...ref,
            whyShown: ref.whyShown ? [...ref.whyShown] : undefined,
        })),
        usedMemoryRefs: trace.usedMemoryRefs.map((ref) => ({ ...ref })),
        droppedMemoryRefs: trace.droppedMemoryRefs.map((ref) => ({ ...ref })),
    };
}

function cloneSourceRecord(record: SourceRecord): SourceRecord {
    return {
        ...record,
        metadata: record.metadata ? { ...record.metadata } : undefined,
    };
}

function cloneRuntimeWarning(warning: ChatRuntimeWarning): ChatRuntimeWarning {
    return {
        ...warning,
        metadata:
            warning.metadata && typeof warning.metadata === "object"
                ? { ...warning.metadata }
                : undefined,
    };
}

function generateUuid(): string {
    const cryptoApi = getPlatformCrypto() as (Crypto & { randomUUID?: () => string }) | undefined;
    if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
        try {
            return cryptoApi.randomUUID();
        } catch {
            // Fall through to manual fallback below.
        }
    }
    return `pa-chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
