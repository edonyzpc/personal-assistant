import type { Vault } from "obsidian";
import { getVaultConfigDirStorageScope } from "../obsidian-paths";
import { getPlatformIDBKeyRange, getPlatformIndexedDB } from "../platform-dom";
import type {
    ChatContextUsedItem,
    ChatRuntimeWarning,
    ChatTurnMemoryMetadata,
    SourceRecord,
    TurnEndStatus,
} from "../ai-services/chat-types";

export const CHAT_HISTORY_SCHEMA_VERSION = 1;
export const CHAT_HISTORY_IDB_VERSION = 1;
export const MAX_CONVERSATIONS = 50;

const CONVERSATIONS_STORE = "conversations";
const TURNS_STORE = "turns";
const METADATA_STORE = "metadata";
const ACTIVE_CONVERSATION_KEY = "active-conversation";
const SCHEMA_VERSION_KEY = "schema-version";
const PLUGIN_STORAGE_SCOPE = "personal-assistant-chat-history-v1";
const TURN_KEY_SEPARATOR = " ";
const TURN_INDEX_PAD_WIDTH = 10;

export interface PersistedConversation {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    turnCount: number;
    preview: string;
}

export interface PersistedChatMessage {
    role: "user" | "assistant";
    content: string;
    sourceRecords?: SourceRecord[];
    runtimeWarnings?: ChatRuntimeWarning[];
    turnStatus?: TurnEndStatus;
}

export interface PersistedTurn {
    conversationId: string;
    turnIndex: number;
    user: PersistedChatMessage;
    assistant: PersistedChatMessage;
    memoryMetadata?: ChatTurnMemoryMetadata;
    contextUsed?: ChatContextUsedItem[];
    activityDetails?: string[];
    providerReasoningObserved?: boolean;
}

export interface ChatHistoryStore {
    initialize(): Promise<void>;

    listConversations(): Promise<PersistedConversation[]>;
    getConversation(id: string): Promise<PersistedConversation | null>;
    upsertConversation(conversation: PersistedConversation): Promise<void>;
    deleteConversation(id: string): Promise<void>;

    getTurns(conversationId: string): Promise<PersistedTurn[]>;
    appendTurn(turn: PersistedTurn): Promise<void>;
    appendTurnAndUpdateConversation(
        turn: PersistedTurn,
        conversation: PersistedConversation,
    ): Promise<void>;
    deleteTurn(conversationId: string, turnIndex: number): Promise<void>;
    deleteTurnsForConversation(conversationId: string): Promise<void>;

    pruneOldConversations(maxConversations: number): Promise<string[]>;

    getActiveConversationId(): Promise<string | null>;
    setActiveConversationId(id: string | null): Promise<void>;

    getSchemaVersion(): Promise<number | null>;
    setSchemaVersion(version: number): Promise<void>;

    dispose(): Promise<void>;
}

export function buildTurnRecordKey(conversationId: string, turnIndex: number): string {
    return `${conversationId}${TURN_KEY_SEPARATOR}${padTurnIndex(turnIndex)}`;
}

function padTurnIndex(turnIndex: number): string {
    return Math.max(0, Math.floor(turnIndex)).toString().padStart(TURN_INDEX_PAD_WIDTH, "0");
}

function turnPrefix(conversationId: string): string {
    return `${conversationId}${TURN_KEY_SEPARATOR}`;
}

function turnUpperBound(conversationId: string): string {
    return `${conversationId}${String.fromCharCode(TURN_KEY_SEPARATOR.charCodeAt(0) + 1)}`;
}

export class MemoryChatHistoryStore implements ChatHistoryStore {
    private readonly conversations = new Map<string, PersistedConversation>();
    private readonly turns = new Map<string, PersistedTurn>();
    private activeConversationId: string | null = null;
    private schemaVersion: number | null = null;

    async initialize(): Promise<void> {
        // Memory store is ready immediately.
    }

    async listConversations(): Promise<PersistedConversation[]> {
        return Array.from(this.conversations.values()).map(cloneConversation);
    }

    async getConversation(id: string): Promise<PersistedConversation | null> {
        const value = this.conversations.get(id);
        return value ? cloneConversation(value) : null;
    }

    async upsertConversation(conversation: PersistedConversation): Promise<void> {
        this.conversations.set(conversation.id, cloneConversation(conversation));
    }

    async deleteConversation(id: string): Promise<void> {
        this.conversations.delete(id);
        if (this.activeConversationId === id) {
            this.activeConversationId = null;
        }
    }

    async getTurns(conversationId: string): Promise<PersistedTurn[]> {
        const lower = turnPrefix(conversationId);
        const upper = turnUpperBound(conversationId);
        const matched: PersistedTurn[] = [];
        for (const [key, turn] of this.turns) {
            if (key >= lower && key < upper) {
                matched.push(cloneTurn(turn));
            }
        }
        matched.sort((a, b) => a.turnIndex - b.turnIndex);
        return matched;
    }

    async appendTurn(turn: PersistedTurn): Promise<void> {
        this.turns.set(buildTurnRecordKey(turn.conversationId, turn.turnIndex), cloneTurn(turn));
    }

    async appendTurnAndUpdateConversation(
        turn: PersistedTurn,
        conversation: PersistedConversation,
    ): Promise<void> {
        this.turns.set(buildTurnRecordKey(turn.conversationId, turn.turnIndex), cloneTurn(turn));
        this.conversations.set(conversation.id, cloneConversation(conversation));
    }

    async deleteTurn(conversationId: string, turnIndex: number): Promise<void> {
        this.turns.delete(buildTurnRecordKey(conversationId, turnIndex));
    }

    async deleteTurnsForConversation(conversationId: string): Promise<void> {
        const lower = turnPrefix(conversationId);
        const upper = turnUpperBound(conversationId);
        for (const key of Array.from(this.turns.keys())) {
            if (key >= lower && key < upper) {
                this.turns.delete(key);
            }
        }
    }

    async pruneOldConversations(maxConversations: number): Promise<string[]> {
        if (this.conversations.size <= maxConversations) return [];
        const sorted = Array.from(this.conversations.values()).sort(
            (a, b) => a.updatedAt.localeCompare(b.updatedAt),
        );
        const removeCount = sorted.length - maxConversations;
        const removed: string[] = [];
        for (let i = 0; i < removeCount; i++) {
            const id = sorted[i].id;
            await this.deleteTurnsForConversation(id);
            this.conversations.delete(id);
            if (this.activeConversationId === id) {
                this.activeConversationId = null;
            }
            removed.push(id);
        }
        return removed;
    }

    async getActiveConversationId(): Promise<string | null> {
        return this.activeConversationId;
    }

    async setActiveConversationId(id: string | null): Promise<void> {
        this.activeConversationId = id;
    }

    async getSchemaVersion(): Promise<number | null> {
        return this.schemaVersion;
    }

    async setSchemaVersion(version: number): Promise<void> {
        this.schemaVersion = version;
    }

    async dispose(): Promise<void> {
        // Nothing to close.
    }
}

export class IndexedDbChatHistoryStore implements ChatHistoryStore {
    private db: IDBDatabase | null = null;
    private initializing: Promise<void> | null = null;

    constructor(private readonly dbName: string, private readonly indexedDb: IDBFactory) { }

    async initialize(): Promise<void> {
        if (this.db) return;
        if (!this.initializing) {
            this.initializing = this.openDatabase()
                .then((db) => {
                    this.db = db;
                })
                .catch((error) => {
                    this.initializing = null;
                    throw error;
                });
        }
        await this.initializing;
    }

    async listConversations(): Promise<PersistedConversation[]> {
        const store = this.getStore(CONVERSATIONS_STORE, "readonly");
        const records = await requestToPromise<PersistedConversation[]>(store.getAll());
        return records.map(cloneConversation);
    }

    async getConversation(id: string): Promise<PersistedConversation | null> {
        const store = this.getStore(CONVERSATIONS_STORE, "readonly");
        const record = await requestToPromise<PersistedConversation | undefined>(store.get(id));
        return record ? cloneConversation(record) : null;
    }

    async upsertConversation(conversation: PersistedConversation): Promise<void> {
        const transaction = this.getTransaction(CONVERSATIONS_STORE, "readwrite");
        transaction.objectStore(CONVERSATIONS_STORE).put(cloneConversation(conversation));
        await transactionDone(transaction);
    }

    async deleteConversation(id: string): Promise<void> {
        const transaction = this.getTransaction([CONVERSATIONS_STORE, METADATA_STORE], "readwrite");
        transaction.objectStore(CONVERSATIONS_STORE).delete(id);
        const metadataStore = transaction.objectStore(METADATA_STORE);
        const entry = await requestToPromise<{ key: string; value: string | null } | undefined>(
            metadataStore.get(ACTIVE_CONVERSATION_KEY),
        );
        if (entry && entry.value === id) {
            metadataStore.delete(ACTIVE_CONVERSATION_KEY);
        }
        await transactionDone(transaction);
    }

    async getTurns(conversationId: string): Promise<PersistedTurn[]> {
        const store = this.getStore(TURNS_STORE, "readonly");
        const range = makeIDBKeyRange().bound(turnPrefix(conversationId), turnUpperBound(conversationId), false, true);
        const records = await requestToPromise<Array<TurnRecord>>(store.getAll(range));
        return records
            .map((record) => cloneTurn(record.turn))
            .sort((a, b) => a.turnIndex - b.turnIndex);
    }

    async appendTurn(turn: PersistedTurn): Promise<void> {
        const transaction = this.getTransaction(TURNS_STORE, "readwrite");
        transaction.objectStore(TURNS_STORE).put({
            key: buildTurnRecordKey(turn.conversationId, turn.turnIndex),
            turn: cloneTurn(turn),
        } satisfies TurnRecord);
        await transactionDone(transaction);
    }

    async appendTurnAndUpdateConversation(
        turn: PersistedTurn,
        conversation: PersistedConversation,
    ): Promise<void> {
        const transaction = this.getTransaction([TURNS_STORE, CONVERSATIONS_STORE], "readwrite");
        transaction.objectStore(TURNS_STORE).put({
            key: buildTurnRecordKey(turn.conversationId, turn.turnIndex),
            turn: cloneTurn(turn),
        } satisfies TurnRecord);
        transaction.objectStore(CONVERSATIONS_STORE).put(cloneConversation(conversation));
        await transactionDone(transaction);
    }

    async deleteTurn(conversationId: string, turnIndex: number): Promise<void> {
        const transaction = this.getTransaction(TURNS_STORE, "readwrite");
        transaction.objectStore(TURNS_STORE).delete(buildTurnRecordKey(conversationId, turnIndex));
        await transactionDone(transaction);
    }

    async deleteTurnsForConversation(conversationId: string): Promise<void> {
        const transaction = this.getTransaction(TURNS_STORE, "readwrite");
        const store = transaction.objectStore(TURNS_STORE);
        const range = makeIDBKeyRange().bound(turnPrefix(conversationId), turnUpperBound(conversationId), false, true);
        store.delete(range);
        await transactionDone(transaction);
    }

    async pruneOldConversations(maxConversations: number): Promise<string[]> {
        const conversations = await this.listConversations();
        if (conversations.length <= maxConversations) return [];
        const sorted = [...conversations].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
        const toRemove = sorted.slice(0, sorted.length - maxConversations);
        const removed: string[] = [];
        for (const conversation of toRemove) {
            await this.deleteTurnsForConversation(conversation.id);
            await this.deleteConversation(conversation.id);
            removed.push(conversation.id);
        }
        return removed;
    }

    async getActiveConversationId(): Promise<string | null> {
        const entry = await this.getMetadataEntry<string | null>(ACTIVE_CONVERSATION_KEY);
        return typeof entry === "string" ? entry : null;
    }

    async setActiveConversationId(id: string | null): Promise<void> {
        const transaction = this.getTransaction(METADATA_STORE, "readwrite");
        const store = transaction.objectStore(METADATA_STORE);
        if (id === null) {
            store.delete(ACTIVE_CONVERSATION_KEY);
        } else {
            store.put({ key: ACTIVE_CONVERSATION_KEY, value: id });
        }
        await transactionDone(transaction);
    }

    async getSchemaVersion(): Promise<number | null> {
        const entry = await this.getMetadataEntry<number>(SCHEMA_VERSION_KEY);
        return typeof entry === "number" ? entry : null;
    }

    async setSchemaVersion(version: number): Promise<void> {
        const transaction = this.getTransaction(METADATA_STORE, "readwrite");
        transaction.objectStore(METADATA_STORE).put({ key: SCHEMA_VERSION_KEY, value: version });
        await transactionDone(transaction);
    }

    async dispose(): Promise<void> {
        if (this.db) {
            this.db.close();
            this.db = null;
            this.initializing = null;
        }
    }

    private async getMetadataEntry<T>(key: string): Promise<T | null> {
        const store = this.getStore(METADATA_STORE, "readonly");
        const entry = await requestToPromise<{ key: string; value: T } | undefined>(store.get(key));
        return entry ? entry.value : null;
    }

    private openDatabase(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = this.indexedDb.open(this.dbName, CHAT_HISTORY_IDB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(CONVERSATIONS_STORE)) {
                    db.createObjectStore(CONVERSATIONS_STORE, { keyPath: "id" });
                }
                if (!db.objectStoreNames.contains(TURNS_STORE)) {
                    db.createObjectStore(TURNS_STORE, { keyPath: "key" });
                }
                if (!db.objectStoreNames.contains(METADATA_STORE)) {
                    db.createObjectStore(METADATA_STORE, { keyPath: "key" });
                }
            };
            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => {
                    db.close();
                    if (this.db === db) {
                        this.db = null;
                        this.initializing = null;
                    }
                };
                resolve(db);
            };
            request.onerror = () => reject(request.error ?? new Error("Failed to open chat history store."));
            request.onblocked = () =>
                reject(new Error("Chat history store upgrade was blocked by another open connection."));
        });
    }

    private getStore(storeName: string, mode: IDBTransactionMode): IDBObjectStore {
        return this.getTransaction(storeName, mode).objectStore(storeName);
    }

    private getTransaction(storeNames: string | string[], mode: IDBTransactionMode): IDBTransaction {
        if (!this.db) {
            throw new Error("Chat history store is not initialized.");
        }
        return this.db.transaction(storeNames, mode);
    }
}

export class UnavailableChatHistoryStore implements ChatHistoryStore {
    private readonly error = new Error(
        "Chat history is unavailable because local app storage is not available.",
    );

    async initialize(): Promise<void> {
        throw this.error;
    }

    async listConversations(): Promise<PersistedConversation[]> {
        throw this.error;
    }

    async getConversation(_id: string): Promise<PersistedConversation | null> {
        throw this.error;
    }

    async upsertConversation(_conversation: PersistedConversation): Promise<void> {
        throw this.error;
    }

    async deleteConversation(_id: string): Promise<void> {
        throw this.error;
    }

    async getTurns(_conversationId: string): Promise<PersistedTurn[]> {
        throw this.error;
    }

    async appendTurn(_turn: PersistedTurn): Promise<void> {
        throw this.error;
    }

    async appendTurnAndUpdateConversation(
        _turn: PersistedTurn,
        _conversation: PersistedConversation,
    ): Promise<void> {
        throw this.error;
    }

    async deleteTurn(_conversationId: string, _turnIndex: number): Promise<void> {
        throw this.error;
    }

    async deleteTurnsForConversation(_conversationId: string): Promise<void> {
        throw this.error;
    }

    async pruneOldConversations(_maxConversations: number): Promise<string[]> {
        throw this.error;
    }

    async getActiveConversationId(): Promise<string | null> {
        throw this.error;
    }

    async setActiveConversationId(_id: string | null): Promise<void> {
        throw this.error;
    }

    async getSchemaVersion(): Promise<number | null> {
        throw this.error;
    }

    async setSchemaVersion(_version: number): Promise<void> {
        throw this.error;
    }

    async dispose(): Promise<void> {
        // Nothing to close.
    }
}

interface TurnRecord {
    key: string;
    turn: PersistedTurn;
}

export function createChatHistoryStore(
    vault: Vault,
    vaultId: string,
    pluginId: string,
): ChatHistoryStore {
    const indexedDb = getPlatformIndexedDB();
    if (!indexedDb) {
        return new UnavailableChatHistoryStore();
    }
    return new IndexedDbChatHistoryStore(getChatHistoryDbName(vault, vaultId, pluginId), indexedDb);
}

export function getChatHistoryDbName(vault: Vault, vaultId: string, pluginId: string): string {
    const scopeSource = [
        pluginId || "personal-assistant",
        vaultId || "default-vault",
        getVaultConfigDirStorageScope(vault),
        getVaultLocalPath(vault) ?? "",
    ].join("\n");
    return `${PLUGIN_STORAGE_SCOPE}-${hashScope(scopeSource)}`;
}

function getVaultLocalPath(vault: Vault): string | undefined {
    const adapter = vault.adapter as {
        getBasePath?: () => string;
        getFullPath?: (path: string) => string;
    };
    try {
        if (typeof adapter.getBasePath === "function") {
            return adapter.getBasePath();
        }
        if (typeof adapter.getFullPath === "function") {
            return adapter.getFullPath("");
        }
    } catch {
        return undefined;
    }
    return undefined;
}

function makeIDBKeyRange(): typeof IDBKeyRange {
    const range = getPlatformIDBKeyRange();
    if (!range) {
        throw new Error("IDBKeyRange is not available in this environment.");
    }
    return range;
}

function cloneConversation(conversation: PersistedConversation): PersistedConversation {
    return { ...conversation };
}

function cloneTurn(turn: PersistedTurn): PersistedTurn {
    return {
        conversationId: turn.conversationId,
        turnIndex: turn.turnIndex,
        user: cloneMessage(turn.user),
        assistant: cloneMessage(turn.assistant),
        ...(turn.memoryMetadata ? { memoryMetadata: cloneMemoryMetadata(turn.memoryMetadata) } : {}),
        ...(turn.contextUsed ? { contextUsed: turn.contextUsed.map(cloneContextUsedItem) } : {}),
        ...(turn.activityDetails ? { activityDetails: [...turn.activityDetails] } : {}),
        ...(turn.providerReasoningObserved !== undefined
            ? { providerReasoningObserved: turn.providerReasoningObserved }
            : {}),
    };
}

function cloneMessage(message: PersistedChatMessage): PersistedChatMessage {
    return {
        role: message.role,
        content: message.content,
        ...(message.sourceRecords ? { sourceRecords: message.sourceRecords.map(cloneSourceRecord) } : {}),
        ...(message.runtimeWarnings ? { runtimeWarnings: message.runtimeWarnings.map(cloneRuntimeWarning) } : {}),
        ...(message.turnStatus ? { turnStatus: message.turnStatus } : {}),
    };
}

function cloneMemoryMetadata(metadata: ChatTurnMemoryMetadata): ChatTurnMemoryMetadata {
    return {
        hasMemoryContent: metadata.hasMemoryContent,
        allowedMemorySourcePaths: [...metadata.allowedMemorySourcePaths],
        ...(metadata.contextUsed ? { contextUsed: metadata.contextUsed.map(cloneContextUsedItem) } : {}),
        ...(metadata.sourceRecords ? { sourceRecords: metadata.sourceRecords.map(cloneSourceRecord) } : {}),
        ...(metadata.contextTrace ? { contextTrace: cloneContextTrace(metadata.contextTrace) } : {}),
    };
}

function cloneContextTrace(trace: NonNullable<ChatTurnMemoryMetadata["contextTrace"]>): NonNullable<ChatTurnMemoryMetadata["contextTrace"]> {
    return {
        ...trace,
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

function cloneContextUsedItem(item: ChatContextUsedItem): ChatContextUsedItem {
    return {
        ...item,
        sources: item.sources ? item.sources.map((source) => ({ ...source })) : undefined,
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
        metadata: warning.metadata ? { ...warning.metadata } : undefined,
    };
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Chat history store request failed."));
    });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () =>
            reject(transaction.error ?? new Error("Chat history store transaction failed."));
        transaction.onabort = () =>
            reject(transaction.error ?? new Error("Chat history store transaction aborted."));
    });
}

function hashScope(value: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}
