import type { Vault } from "obsidian";
import { getVaultConfigDirStorageScope } from "../obsidian-paths";
import { getPlatformIDBKeyRange, getPlatformIndexedDB } from "../platform-dom";
import { cloneContextReductionReceipt } from "../pa/contracts/context-trace";
import { cloneChatHostProvenance, type ChatHostProvenance } from "../ai-services/chat-provenance";
import { cloneWritingVersion, hashWritingText, writingSceneSchema, type WritingVersion } from "./writing-types";
import { cloneSaveReceipt, assertSaveReceiptUpdate, type SaveReceipt } from "./save-receipt-types";
import { hasForbiddenPersistedTextFields, validateSourceRefPathShape, type PersistedSourceRef } from '../pa/contracts/source-ref';
import { cloneImageAsset, cloneImageRef, cloneImageVariant, cloneMessageImages, imageTurnOwnerId, validateImagePath,
    type ImageAsset, type ImageAssetOwner, type ImageRef, type ImageVariantRecord,
    type MessageImage } from "./image-types";
import type {
    ChatContextUsedItem,
    ChatRuntimeWarning,
    ChatTurnMemoryMetadata,
    SourceRecord,
    TurnEndStatus,
    ChatWritingRecovery,
} from "../ai-services/chat-types";

export const CHAT_HISTORY_SCHEMA_VERSION = 2;
export const CHAT_HISTORY_IDB_VERSION = 2;
export const MAX_CONVERSATIONS = 50;

const CONVERSATIONS_STORE = "conversations";
const TURNS_STORE = "turns";
const METADATA_STORE = "metadata";
const ASSETS_STORE = "assets";
const VARIANTS_STORE = "variants";
const WRITING_VERSIONS_STORE = "writingVersions";
const SAVE_RECEIPTS_STORE = "saveReceipts";
const ACTIVE_CONVERSATION_KEY = "active-conversation";
const SCHEMA_VERSION_KEY = "schema-version";
const PLUGIN_STORAGE_SCOPE = "personal-assistant-chat-history-v1";
const TURN_KEY_SEPARATOR = " ";
const TURN_INDEX_PAD_WIDTH = 10;

export interface ConversationImageAnchor { path: string; kind: 'logical_root' | 'existing_note'; }
export function cloneConversationImageAnchor(value: unknown): ConversationImageAnchor {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid conversation image anchor');
    const anchor = value as Record<string, unknown>;
    if ((anchor.kind !== 'logical_root' && anchor.kind !== 'existing_note')
        || Object.keys(anchor).some((key) => key !== 'path' && key !== 'kind')) throw new Error('Invalid conversation image anchor');
    const path = validateImagePath(anchor.path);
    if (anchor.kind === 'logical_root' && path !== 'PA Chat.md') throw new Error('Invalid logical conversation image anchor');
    return { path, kind: anchor.kind };
}

export interface PersistedConversation {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    turnCount: number;
    preview: string;
    operationsSaveSuggestionState?: "offered" | "accepted" | "declined";
    imageAnchor?: ConversationImageAnchor;
}

export interface PersistedChatMessage {
    role: "user" | "assistant";
    content: string;
    shareCardEligible?: boolean;
    sourceRecords?: SourceRecord[];
    runtimeWarnings?: ChatRuntimeWarning[];
    turnStatus?: TurnEndStatus;
    images?: MessageImage[];
    hostProvenance?: ChatHostProvenance;
    writingVersionId?: string;
    writingRecovery?: ChatWritingRecovery;
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
    renameConversationImageAnchors(oldPath: string, newPath: string): Promise<void>;

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

    getImageAsset(id: string): Promise<ImageAsset | null>;
    listImageAssets(): Promise<ImageAsset[]>;
    /** State/path updates preserve the owners maintained by turn/save transactions. */
    putImageAsset(asset: ImageAsset): Promise<void>;
    updateImageAssetOwner(ref: ImageRef, owner: ImageAssetOwner, add: boolean): Promise<void>;
    getImageVariant(id: string): Promise<ImageVariantRecord | null>;
    listImageVariants(): Promise<ImageVariantRecord[]>;
    putImageVariant(variant: ImageVariantRecord, maxBytes: number, pinnedIds: readonly string[]): Promise<void>;
    clearImageVariants(assetId?: string): Promise<void>;
    getImageSetting<T>(key: string): Promise<T | null>;
    setImageSetting(key: string, value: unknown): Promise<void>;
    getWritingVersion(id: string): Promise<WritingVersion | null>;
    putWritingVersion(version: WritingVersion, assertSourceCurrent?: () => void): Promise<void>;
    listWritingVersions(conversationId: string): Promise<WritingVersion[]>;
    getSaveReceipt(id: string): Promise<SaveReceipt | null>;
    putSaveReceipt(receipt: SaveReceipt): Promise<void>;
    listSaveReceipts(writingVersionId?: string): Promise<SaveReceipt[]>;

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
    private readonly assets = new Map<string, ImageAsset>();
    private readonly variants = new Map<string, ImageVariantRecord>();
    private readonly imageSettings = new Map<string, unknown>();
    private readonly writingVersions = new Map<string, WritingVersion>();
    private readonly saveReceipts = new Map<string, SaveReceipt>();
    private readonly prunableWritingVersions = new Set<string>();

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
        this.conversations.set(conversation.id, preserveConversationAnchor(conversation, this.conversations.get(conversation.id)));
    }

    async renameConversationImageAnchors(oldPath: string, newPath: string): Promise<void> {
        validateImagePath(oldPath); validateImagePath(newPath);
        for (const [id, conversation] of this.conversations) this.conversations.set(id, renameConversationAnchor(conversation, oldPath, newPath));
    }

    async deleteConversation(id: string): Promise<void> {
        await this.deleteTurnsForConversation(id);
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
        this.commitTurn(turn);
    }

    private commitTurn(turn: PersistedTurn): void {
        const copy = cloneTurn(turn);
        assertTurnWritingVersions(copy, (id) => this.writingVersions.get(id));
        const assets = applyTurnAssetOwners([...this.assets.values()], copy);
        for (const asset of assets) this.assets.set(asset.id, asset);
        this.turns.set(buildTurnRecordKey(turn.conversationId, turn.turnIndex), copy);
    }

    async appendTurnAndUpdateConversation(
        turn: PersistedTurn,
        conversation: PersistedConversation,
    ): Promise<void> {
        const copy = preserveConversationAnchor(conversation, this.conversations.get(conversation.id));
        this.commitTurn(turn);
        this.conversations.set(copy.id, copy);
    }

    async deleteTurn(conversationId: string, turnIndex: number): Promise<void> {
        this.turns.delete(buildTurnRecordKey(conversationId, turnIndex));
        this.releaseTurnOwners(new Set([imageTurnOwnerId(conversationId, turnIndex)]));
        this.pruneWriting(conversationId, turnIndex);
    }

    async deleteTurnsForConversation(conversationId: string): Promise<void> {
        const lower = turnPrefix(conversationId);
        const upper = turnUpperBound(conversationId);
        const owners = new Set<string>();
        for (const [key, turn] of Array.from(this.turns.entries())) {
            if (key >= lower && key < upper) {
                owners.add(imageTurnOwnerId(conversationId, turn.turnIndex));
                this.turns.delete(key);
            }
        }
        this.releaseTurnOwners(owners);
        this.pruneWriting(conversationId);
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

    async getImageAsset(id: string): Promise<ImageAsset | null> {
        const value = this.assets.get(id);
        return value ? cloneImageAsset(value) : null;
    }

    async listImageAssets(): Promise<ImageAsset[]> { return [...this.assets.values()].map(cloneImageAsset); }

    async putImageAsset(asset: ImageAsset): Promise<void> {
        const copy = cloneImageAsset(asset);
        assertAssetIdentity(this.assets.get(copy.id), copy);
        copy.owners = this.assets.get(copy.id)?.owners.map((owner) => ({ ...owner })) ?? [];
        this.assets.set(copy.id, copy);
    }

    async updateImageAssetOwner(ref: ImageRef, owner: ImageAssetOwner, add: boolean): Promise<void> {
        const current = requireImageAsset(this.assets.get(ref.assetId), ref);
        this.assets.set(current.id, changeAssetOwner(current, owner, add));
    }

    async getImageVariant(id: string): Promise<ImageVariantRecord | null> {
        const value = this.variants.get(id);
        return value ? cloneImageVariant(value) : null;
    }

    async listImageVariants(): Promise<ImageVariantRecord[]> { return [...this.variants.values()].map(cloneImageVariant); }

    async putImageVariant(variant: ImageVariantRecord, maxBytes: number, pinnedIds: readonly string[]): Promise<void> {
        const copy = cloneImageVariant(variant);
        requireImageAsset(this.assets.get(copy.assetId), { assetId: copy.assetId, contentHash: copy.contentHash });
        const remove = variantEvictions([...this.variants.values()], copy, maxBytes, pinnedIds);
        for (const id of remove) this.variants.delete(id);
        this.variants.set(copy.id, copy);
    }

    async clearImageVariants(assetId?: string): Promise<void> {
        for (const [id, variant] of this.variants) if (!assetId || variant.assetId === assetId) this.variants.delete(id);
    }

    async getImageSetting<T>(key: string): Promise<T | null> {
        const value = this.imageSettings.get(key);
        return value === undefined ? null : JSON.parse(JSON.stringify(value)) as T;
    }
    async setImageSetting(key: string, value: unknown): Promise<void> {
        this.imageSettings.set(key, JSON.parse(JSON.stringify(value)));
    }

    async getWritingVersion(id: string): Promise<WritingVersion | null> {
        const value = this.writingVersions.get(id); return value ? cloneWritingVersion(value) : null;
    }
    async listWritingVersions(conversationId: string): Promise<WritingVersion[]> {
        return [...this.writingVersions.values()].filter((v) => v.conversationId === conversationId).map(cloneWritingVersion);
    }
    async putWritingVersion(version: WritingVersion, assertSourceCurrent?: () => void): Promise<void> {
        const copy = cloneWritingVersion(version);
        if (await hashWritingText(copy.text) !== copy.textHash) throw new Error('Writing text hash mismatch');
        assertWritingVersionUpdate(this.writingVersions.get(copy.id), copy);
        assertWritingParent(copy, copy.parentVersionId ? this.writingVersions.get(copy.parentVersionId) : undefined);
        const changed = addImageOwners([...this.assets.values()], copy.associatedImages.map((i) => i.ref), { kind: 'writing', id: copy.id });
        assertSourceCurrent?.();
        for (const asset of changed) this.assets.set(asset.id, asset);
        this.writingVersions.set(copy.id, copy);
    }
    async getSaveReceipt(id: string): Promise<SaveReceipt | null> {
        const value = this.saveReceipts.get(id); return value ? cloneSaveReceipt(value) : null;
    }
    async listSaveReceipts(writingVersionId?: string): Promise<SaveReceipt[]> {
        return [...this.saveReceipts.values()].filter((r) => !writingVersionId || r.writingVersionId === writingVersionId).map(cloneSaveReceipt);
    }
    async putSaveReceipt(receipt: SaveReceipt): Promise<void> {
        const copy = cloneSaveReceipt(receipt), old = this.saveReceipts.get(copy.id);
        if (old) assertSaveReceiptUpdate(old, copy);
        assertReceiptVersion(copy, this.writingVersions.get(copy.writingVersionId));
        const changed = addImageOwners([...this.assets.values()], copy.attachments.map((a) => a.ref), { kind: 'save', id: copy.id });
        for (const asset of changed) this.assets.set(asset.id, asset);
        this.saveReceipts.set(copy.id, copy);
        if (copy.state === 'completed' && this.prunableWritingVersions.has(copy.writingVersionId)) {
            const version = this.writingVersions.get(copy.writingVersionId)!;
            this.pruneWriting(version.conversationId, version.turnIndex);
        }
    }

    private releaseTurnOwners(ids: Set<string>): void {
        for (const [id, asset] of this.assets) {
            this.assets.set(id, { ...asset, owners: asset.owners.filter((owner) => owner.kind !== "turn" || !ids.has(owner.id)) });
        }
    }

    private pruneWriting(conversationId: string, turnIndex?: number): void {
        const recoveryPins = [...this.turns.values()].flatMap((turn) => [turn.user.writingRecovery?.parentVersionId, turn.assistant.writingRecovery?.parentVersionId])
            .filter((id): id is string => !!id);
        const plan = writingPrunePlan([...this.writingVersions.values()], [...this.saveReceipts.values()], conversationId, turnIndex,
            recoveryPins, this.prunableWritingVersions);
        for (const id of plan.candidates) this.prunableWritingVersions.add(id);
        for (const id of plan.versions) { this.writingVersions.delete(id); this.prunableWritingVersions.delete(id); }
        for (const id of plan.receipts) this.saveReceipts.delete(id);
        for (const [id, asset] of this.assets) this.assets.set(id, { ...asset, owners: asset.owners.filter((owner) =>
            !(owner.kind === 'writing' && plan.versions.has(owner.id)) && !(owner.kind === 'save' && plan.receipts.has(owner.id))) });
    }

    async dispose(): Promise<void> {
        // Nothing to close.
    }
}

export class IndexedDbChatHistoryStore implements ChatHistoryStore {
    private db: IDBDatabase | null = null;
    private initializing: Promise<void> | null = null;
    private generation = 0;

    constructor(private readonly dbName: string, private readonly indexedDb: IDBFactory) { }

    async initialize(): Promise<void> {
        if (this.db) return;
        if (!this.initializing) {
            const generation = this.generation;
            this.initializing = this.openDatabase()
                .then((db) => {
                    if (this.generation !== generation) { db.close(); throw new Error("Chat history initialization was cancelled."); }
                    this.db = db;
                })
                .catch((error) => {
                    if (this.generation === generation) this.initializing = null;
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
        const copy = cloneConversation(conversation);
        await this.writeTransaction([CONVERSATIONS_STORE], async (tx) => {
            const store = tx.objectStore(CONVERSATIONS_STORE);
            const previous = await requestToPromise<PersistedConversation | undefined>(store.get(copy.id));
            store.put(preserveConversationAnchor(copy, previous));
        });
    }

    async deleteConversation(id: string): Promise<void> {
        await this.writeTransaction([CONVERSATIONS_STORE, METADATA_STORE, TURNS_STORE, ASSETS_STORE, WRITING_VERSIONS_STORE, SAVE_RECEIPTS_STORE], async (transaction) => {
            await this.removeTurns(transaction, id);
            transaction.objectStore(CONVERSATIONS_STORE).delete(id);
            const metadataStore = transaction.objectStore(METADATA_STORE);
            const entry = await requestToPromise<{ key: string; value: string | null } | undefined>(metadataStore.get(ACTIVE_CONVERSATION_KEY));
            if (entry?.value === id) metadataStore.delete(ACTIVE_CONVERSATION_KEY);
        });
    }

    async renameConversationImageAnchors(oldPath: string, newPath: string): Promise<void> {
        validateImagePath(oldPath); validateImagePath(newPath);
        await this.writeTransaction([CONVERSATIONS_STORE], async (tx) => {
            const store = tx.objectStore(CONVERSATIONS_STORE);
            for (const conversation of await requestToPromise<PersistedConversation[]>(store.getAll())) {
                const next = renameConversationAnchor(conversation, oldPath, newPath);
                if (next.imageAnchor?.path !== conversation.imageAnchor?.path) store.put(next);
            }
        });
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
        const copy = cloneTurn(turn);
        await this.writeTransaction([TURNS_STORE, ASSETS_STORE, WRITING_VERSIONS_STORE], (transaction) => this.writeTurn(transaction, copy));
    }

    async appendTurnAndUpdateConversation(
        turn: PersistedTurn,
        conversation: PersistedConversation,
    ): Promise<void> {
        const copy = cloneTurn(turn);
        const conversationCopy = cloneConversation(conversation);
        await this.writeTransaction([TURNS_STORE, CONVERSATIONS_STORE, ASSETS_STORE, WRITING_VERSIONS_STORE], async (transaction) => {
            await this.writeTurn(transaction, copy);
            const store = transaction.objectStore(CONVERSATIONS_STORE);
            const previous = await requestToPromise<PersistedConversation | undefined>(store.get(conversationCopy.id));
            store.put(preserveConversationAnchor(conversationCopy, previous));
        });
    }

    async deleteTurn(conversationId: string, turnIndex: number): Promise<void> {
        await this.writeTransaction([TURNS_STORE, ASSETS_STORE, WRITING_VERSIONS_STORE, SAVE_RECEIPTS_STORE, METADATA_STORE], async (transaction) => {
            await this.removeTurnOwners(transaction, new Set([imageTurnOwnerId(conversationId, turnIndex)]));
            transaction.objectStore(TURNS_STORE).delete(buildTurnRecordKey(conversationId, turnIndex));
            await this.pruneWriting(transaction, conversationId, turnIndex);
        });
    }

    async deleteTurnsForConversation(conversationId: string): Promise<void> {
        await this.writeTransaction([TURNS_STORE, ASSETS_STORE, WRITING_VERSIONS_STORE, SAVE_RECEIPTS_STORE, METADATA_STORE], (transaction) => this.removeTurns(transaction, conversationId));
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

    async getImageAsset(id: string): Promise<ImageAsset | null> {
        const value = await requestToPromise<unknown>(this.getStore(ASSETS_STORE, "readonly").get(id));
        return value === undefined ? null : cloneImageAsset(value);
    }
    async listImageAssets(): Promise<ImageAsset[]> {
        return (await requestToPromise<unknown[]>(this.getStore(ASSETS_STORE, "readonly").getAll())).map(cloneImageAsset);
    }
    async putImageAsset(asset: ImageAsset): Promise<void> {
        const copy = cloneImageAsset(asset);
        await this.writeTransaction([ASSETS_STORE], async (transaction) => {
            const store = transaction.objectStore(ASSETS_STORE);
            const old = await requestToPromise<unknown>(store.get(copy.id));
            assertAssetIdentity(old ? cloneImageAsset(old) : undefined, copy);
            copy.owners = old ? cloneImageAsset(old).owners : [];
            store.put(copy);
        });
    }
    async updateImageAssetOwner(ref: ImageRef, owner: ImageAssetOwner, add: boolean): Promise<void> {
        const valid = cloneImageRef(ref);
        await this.writeTransaction([ASSETS_STORE], async (transaction) => {
            const store = transaction.objectStore(ASSETS_STORE);
            const asset = requireImageAsset(await requestToPromise<unknown>(store.get(valid.assetId)), valid);
            store.put(changeAssetOwner(asset, owner, add));
        });
    }
    async getImageVariant(id: string): Promise<ImageVariantRecord | null> {
        const value = await requestToPromise<unknown>(this.getStore(VARIANTS_STORE, "readonly").get(id));
        return value === undefined ? null : cloneImageVariant(value);
    }
    async listImageVariants(): Promise<ImageVariantRecord[]> {
        return (await requestToPromise<unknown[]>(this.getStore(VARIANTS_STORE, "readonly").getAll())).map(cloneImageVariant);
    }
    async putImageVariant(variant: ImageVariantRecord, maxBytes: number, pinnedIds: readonly string[]): Promise<void> {
        const copy = cloneImageVariant(variant);
        await this.writeTransaction([VARIANTS_STORE, ASSETS_STORE], async (transaction) => {
            requireImageAsset(await requestToPromise<unknown>(transaction.objectStore(ASSETS_STORE).get(copy.assetId)),
                { assetId: copy.assetId, contentHash: copy.contentHash });
            const store = transaction.objectStore(VARIANTS_STORE);
            const existing = (await requestToPromise<unknown[]>(store.getAll())).map(cloneImageVariant);
            for (const id of variantEvictions(existing, copy, maxBytes, pinnedIds)) store.delete(id);
            store.put(copy);
        });
    }
    async clearImageVariants(assetId?: string): Promise<void> {
        await this.writeTransaction([VARIANTS_STORE], async (transaction) => {
            const store = transaction.objectStore(VARIANTS_STORE);
            const records = (await requestToPromise<unknown[]>(store.getAll())).map(cloneImageVariant);
            for (const variant of records) if (!assetId || variant.assetId === assetId) store.delete(variant.id);
        });
    }
    async getImageSetting<T>(key: string): Promise<T | null> { return this.getMetadataEntry<T>(`image:${key}`); }
    async setImageSetting(key: string, value: unknown): Promise<void> {
        await this.writeTransaction([METADATA_STORE], async (transaction) => {
            transaction.objectStore(METADATA_STORE).put({ key: `image:${key}`, value });
        });
    }

    async getWritingVersion(id: string): Promise<WritingVersion | null> {
        const value = await requestToPromise<unknown>(this.getStore(WRITING_VERSIONS_STORE, 'readonly').get(id));
        return value === undefined ? null : cloneWritingVersion(value);
    }
    async listWritingVersions(conversationId: string): Promise<WritingVersion[]> {
        return (await requestToPromise<unknown[]>(this.getStore(WRITING_VERSIONS_STORE, 'readonly').getAll()))
            .map(cloneWritingVersion).filter((v) => v.conversationId === conversationId);
    }
    async putWritingVersion(version: WritingVersion, assertSourceCurrent?: () => void): Promise<void> {
        const copy = cloneWritingVersion(version);
        if (await hashWritingText(copy.text) !== copy.textHash) throw new Error('Writing text hash mismatch');
        assertSourceCurrent?.();
        await this.writeTransaction([WRITING_VERSIONS_STORE, ASSETS_STORE], async (tx) => {
            const versions = tx.objectStore(WRITING_VERSIONS_STORE);
            const previous = await requestToPromise<unknown>(versions.get(copy.id));
            assertWritingVersionUpdate(previous ? cloneWritingVersion(previous) : undefined, copy);
            const parent = copy.parentVersionId ? await requestToPromise<unknown>(versions.get(copy.parentVersionId)) : undefined;
            assertWritingParent(copy, parent ? cloneWritingVersion(parent) : undefined);
            await this.addOwners(tx, copy.associatedImages.map((i) => i.ref), { kind: 'writing', id: copy.id });
            // A rejection aborts the same transaction, including image owners.
            assertSourceCurrent?.();
            versions.put(copy);
        });
    }
    async getSaveReceipt(id: string): Promise<SaveReceipt | null> {
        const value = await requestToPromise<unknown>(this.getStore(SAVE_RECEIPTS_STORE, 'readonly').get(id));
        return value === undefined ? null : cloneSaveReceipt(value);
    }
    async listSaveReceipts(writingVersionId?: string): Promise<SaveReceipt[]> {
        return (await requestToPromise<unknown[]>(this.getStore(SAVE_RECEIPTS_STORE, 'readonly').getAll()))
            .map(cloneSaveReceipt).filter((r) => !writingVersionId || r.writingVersionId === writingVersionId);
    }
    async putSaveReceipt(receipt: SaveReceipt): Promise<void> {
        const copy = cloneSaveReceipt(receipt);
        await this.writeTransaction([SAVE_RECEIPTS_STORE, WRITING_VERSIONS_STORE, ASSETS_STORE, METADATA_STORE, TURNS_STORE], async (tx) => {
            const receipts = tx.objectStore(SAVE_RECEIPTS_STORE);
            const previous = await requestToPromise<unknown>(receipts.get(copy.id));
            if (previous) assertSaveReceiptUpdate(cloneSaveReceipt(previous), copy);
            const version = await requestToPromise<unknown>(tx.objectStore(WRITING_VERSIONS_STORE).get(copy.writingVersionId));
            assertReceiptVersion(copy, version ? cloneWritingVersion(version) : undefined);
            await this.addOwners(tx, copy.attachments.map((a) => a.ref), { kind: 'save', id: copy.id });
            receipts.put(copy);
            if (copy.state === 'completed') {
                const marker = await requestToPromise<unknown>(tx.objectStore(METADATA_STORE).get(`writing-prune:${copy.writingVersionId}`));
                if (marker && version) {
                    const writing = cloneWritingVersion(version);
                    await this.pruneWriting(tx, writing.conversationId, writing.turnIndex);
                }
            }
        });
    }

    async dispose(): Promise<void> {
        this.generation += 1;
        if (this.db) {
            this.db.close();
            this.db = null;
            this.initializing = null;
        }
        this.initializing = null;
    }

    private async getMetadataEntry<T>(key: string): Promise<T | null> {
        const store = this.getStore(METADATA_STORE, "readonly");
        const entry = await requestToPromise<{ key: string; value: T } | undefined>(store.get(key));
        return entry ? entry.value : null;
    }

    private openDatabase(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            let abandoned = false;
            const request = this.indexedDb.open(this.dbName, CHAT_HISTORY_IDB_VERSION);
            request.onupgradeneeded = () => {
                if (abandoned) { request.transaction?.abort(); return; }
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
                for (const name of [ASSETS_STORE, VARIANTS_STORE, WRITING_VERSIONS_STORE, SAVE_RECEIPTS_STORE]) {
                    if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
                }
            };
            request.onsuccess = () => {
                const db = request.result;
                if (abandoned) { db.close(); return; }
                db.onversionchange = () => {
                    db.close();
                    if (this.db === db) {
                        this.db = null;
                        this.initializing = null;
                    }
                };
                resolve(db);
            };
            request.onerror = () => { abandoned = true; reject(request.error ?? new Error("Failed to open chat history store.")); };
            request.onblocked = () => {
                abandoned = true;
                reject(new Error("Chat history store upgrade was blocked by another open connection. Reload Obsidian to continue."));
            };
        });
    }

    private async writeTransaction(stores: string[], work: (transaction: IDBTransaction) => Promise<void>): Promise<void> {
        const transaction = this.getTransaction(stores, "readwrite");
        const done = transactionDone(transaction);
        // Install the abort observer before awaiting requests; both the request
        // and transaction may fail, and neither rejection may escape unhandled.
        void done.catch(() => undefined);
        try { await work(transaction); await done; }
        catch (error) {
            try { transaction.abort(); } catch { /* Transaction already completed/aborted. */ }
            await done.catch(() => undefined);
            throw error;
        }
    }
    private async writeTurn(transaction: IDBTransaction, turn: PersistedTurn): Promise<void> {
        const versions = new Map<string, WritingVersion>();
        for (const message of [turn.user, turn.assistant]) for (const id of [message.writingVersionId, message.writingRecovery?.parentVersionId]) if (id) {
            const value = await requestToPromise<unknown>(transaction.objectStore(WRITING_VERSIONS_STORE).get(id));
            if (value) versions.set(id, cloneWritingVersion(value));
        }
        assertTurnWritingVersions(turn, (id) => versions.get(id));
        const store = transaction.objectStore(ASSETS_STORE);
        const assets = (await requestToPromise<unknown[]>(store.getAll())).map(cloneImageAsset);
        for (const asset of applyTurnAssetOwners(assets, turn)) store.put(asset);
        transaction.objectStore(TURNS_STORE).put({ key: buildTurnRecordKey(turn.conversationId, turn.turnIndex), turn } satisfies TurnRecord);
    }
    private async addOwners(transaction: IDBTransaction, refs: ImageRef[], owner: ImageAssetOwner): Promise<void> {
        const assets = transaction.objectStore(ASSETS_STORE);
        const values = (await requestToPromise<unknown[]>(assets.getAll())).map(cloneImageAsset);
        for (const asset of addImageOwners(values, refs, owner)) assets.put(asset);
    }
    private async removeTurnOwners(transaction: IDBTransaction, owners: Set<string>): Promise<void> {
        const store = transaction.objectStore(ASSETS_STORE);
        const assets = (await requestToPromise<unknown[]>(store.getAll())).map(cloneImageAsset);
        for (const asset of assets) {
            const retained = asset.owners.filter((owner) => owner.kind !== "turn" || !owners.has(owner.id));
            if (retained.length !== asset.owners.length) store.put({ ...asset, owners: retained });
        }
    }
    private async removeTurns(transaction: IDBTransaction, conversationId: string): Promise<void> {
        const store = transaction.objectStore(TURNS_STORE);
        const range = makeIDBKeyRange().bound(turnPrefix(conversationId), turnUpperBound(conversationId), false, true);
        const turns = await requestToPromise<TurnRecord[]>(store.getAll(range));
        await this.removeTurnOwners(transaction, new Set(turns.map(({ turn }) => imageTurnOwnerId(conversationId, turn.turnIndex))));
        store.delete(range);
        await this.pruneWriting(transaction, conversationId);
    }

    private async pruneWriting(transaction: IDBTransaction, conversationId: string, turnIndex?: number): Promise<void> {
        const versions = transaction.objectStore(WRITING_VERSIONS_STORE), receipts = transaction.objectStore(SAVE_RECEIPTS_STORE);
        const allVersions = (await requestToPromise<unknown[]>(versions.getAll())).map(cloneWritingVersion);
        const allReceipts = (await requestToPromise<unknown[]>(receipts.getAll())).map(cloneSaveReceipt);
        const metadata = transaction.objectStore(METADATA_STORE);
        const metadataRecords = await requestToPromise<Array<{ key: string; value: unknown }>>(metadata.getAll());
        const priorCandidates = new Set(metadataRecords.filter((entry) => typeof entry.key === 'string'
            && entry.key.startsWith('writing-prune:') && entry.value === true).map((entry) => entry.key.slice('writing-prune:'.length)));
        const turns = await requestToPromise<TurnRecord[]>(transaction.objectStore(TURNS_STORE).getAll());
        const recoveryPins = turns.flatMap(({ turn }) => [turn.user.writingRecovery?.parentVersionId, turn.assistant.writingRecovery?.parentVersionId])
            .filter((id): id is string => !!id);
        const plan = writingPrunePlan(allVersions, allReceipts, conversationId, turnIndex, recoveryPins, priorCandidates);
        for (const id of plan.candidates) metadata.put({ key: `writing-prune:${id}`, value: true });
        for (const id of plan.versions) { versions.delete(id); metadata.delete(`writing-prune:${id}`); }
        for (const id of plan.receipts) receipts.delete(id);
        if (!plan.versions.size && !plan.receipts.size) return;
        const assets = transaction.objectStore(ASSETS_STORE);
        for (const asset of (await requestToPromise<unknown[]>(assets.getAll())).map(cloneImageAsset)) {
            const owners = asset.owners.filter((owner) => !(owner.kind === 'writing' && plan.versions.has(owner.id))
                && !(owner.kind === 'save' && plan.receipts.has(owner.id)));
            if (owners.length !== asset.owners.length) assets.put({ ...asset, owners });
        }
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
    async renameConversationImageAnchors(_oldPath: string, _newPath: string): Promise<void> { throw this.error; }

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

    async getImageAsset(_id: string): Promise<ImageAsset | null> { throw this.error; }
    async listImageAssets(): Promise<ImageAsset[]> { throw this.error; }
    async putImageAsset(_asset: ImageAsset): Promise<void> { throw this.error; }
    async updateImageAssetOwner(_ref: ImageRef, _owner: ImageAssetOwner, _add: boolean): Promise<void> { throw this.error; }
    async getImageVariant(_id: string): Promise<ImageVariantRecord | null> { throw this.error; }
    async listImageVariants(): Promise<ImageVariantRecord[]> { throw this.error; }
    async putImageVariant(_variant: ImageVariantRecord, _maxBytes: number, _pinnedIds: readonly string[]): Promise<void> { throw this.error; }
    async clearImageVariants(_assetId?: string): Promise<void> { throw this.error; }
    async getImageSetting<T>(_key: string): Promise<T | null> { throw this.error; }
    async setImageSetting(_key: string, _value: unknown): Promise<void> { throw this.error; }
    async getWritingVersion(_id: string): Promise<WritingVersion | null> { throw this.error; }
    async listWritingVersions(_conversationId: string): Promise<WritingVersion[]> { throw this.error; }
    async putWritingVersion(_version: WritingVersion): Promise<void> { throw this.error; }
    async getSaveReceipt(_id: string): Promise<SaveReceipt | null> { throw this.error; }
    async listSaveReceipts(_writingVersionId?: string): Promise<SaveReceipt[]> { throw this.error; }
    async putSaveReceipt(_receipt: SaveReceipt): Promise<void> { throw this.error; }

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
    return { ...conversation, ...(conversation.imageAnchor !== undefined ? { imageAnchor: cloneConversationImageAnchor(conversation.imageAnchor) } : {}) };
}
function preserveConversationAnchor(incoming: PersistedConversation, previous?: PersistedConversation): PersistedConversation {
    const copy = cloneConversation(incoming);
    // Normal metadata/turn writes may carry a UI snapshot from before a rename.
    // Only the explicit rename transaction changes an already chosen anchor.
    if (previous?.imageAnchor !== undefined) copy.imageAnchor = cloneConversationImageAnchor(previous.imageAnchor);
    return copy;
}
function renameConversationAnchor(conversation: PersistedConversation, oldPath: string, newPath: string): PersistedConversation {
    const copy = cloneConversation(conversation), anchor = copy.imageAnchor;
    if (anchor?.kind === 'existing_note') {
        const path = anchor.path === oldPath ? newPath : anchor.path.startsWith(oldPath + '/') ? newPath + anchor.path.slice(oldPath.length) : anchor.path;
        copy.imageAnchor = cloneConversationImageAnchor({ ...anchor, path });
    }
    return copy;
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
        ...(message.shareCardEligible !== undefined
            ? { shareCardEligible: message.shareCardEligible }
            : {}),
        ...(message.sourceRecords ? { sourceRecords: message.sourceRecords.map(cloneSourceRecord) } : {}),
        ...(message.runtimeWarnings ? { runtimeWarnings: message.runtimeWarnings.map(cloneRuntimeWarning) } : {}),
        ...(message.turnStatus ? { turnStatus: message.turnStatus } : {}),
        ...(message.images !== undefined ? { images: cloneMessageImages(message.images) } : {}),
        ...(message.hostProvenance !== undefined ? { hostProvenance: cloneChatHostProvenance(message.hostProvenance) } : {}),
        ...(message.writingVersionId !== undefined ? { writingVersionId: validateWritingVersionId(message.writingVersionId) } : {}),
        ...(message.writingRecovery !== undefined ? { writingRecovery: cloneWritingRecovery(message.writingRecovery) } : {}),
    };
}

function assertAssetIdentity(old: ImageAsset | undefined, next: ImageAsset): void {
    if (old && (old.originalHash !== next.originalHash || (old.source !== next.source && !(old.source === 'imported' && next.source === 'vault_reference'))
        || old.byteLength !== next.byteLength || old.importDirectory !== next.importDirectory || old.anchorKind !== next.anchorKind)) {
        throw new Error("Image asset content identity cannot change.");
    }
}

function validateWritingVersionId(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error('Invalid writing version identity');
    return value;
}
function cloneWritingRecovery(value: unknown): ChatWritingRecovery {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid writing recovery');
    const recovery = value as Record<string, unknown>;
    if (typeof recovery.rawText !== 'string' || recovery.rawText.length > 1_000_000
        || !['incomplete', 'provider_incomplete', 'invalid_output', 'source_changed'].includes(String(recovery.reason))) throw new Error('Invalid writing recovery');
    return { requestId: validateWritingVersionId(recovery.requestId), rawText: recovery.rawText,
        reason: recovery.reason as ChatWritingRecovery['reason'],
        ...(recovery.scene !== undefined ? { scene: writingSceneSchema.parse(recovery.scene) } : {}),
        ...(recovery.parentVersionId !== undefined ? { parentVersionId: validateWritingVersionId(recovery.parentVersionId) } : {}),
        ...(recovery.backgroundSourceRefs !== undefined ? { backgroundSourceRefs: cloneWritingRecoverySources(recovery.backgroundSourceRefs) } : {}),
        ...(recovery.messageId !== undefined ? { messageId: validateWritingVersionId(recovery.messageId) } : {}) };
}
function cloneWritingRecoverySources(value: unknown): PersistedSourceRef[] {
    if (!Array.isArray(value) || value.length > 2048) throw new Error('Invalid writing recovery sources');
    return value.map((source) => {
        if (!validateSourceRefPathShape(source).ok || hasForbiddenPersistedTextFields(source)) throw new Error('Invalid writing recovery source');
        const ref = source as PersistedSourceRef;
        return { path: ref.path,
            ...(ref.heading !== undefined ? { heading: ref.heading } : {}),
            ...(ref.blockId !== undefined ? { blockId: ref.blockId } : {}),
            ...(ref.contentHash !== undefined ? { contentHash: ref.contentHash } : {}),
            ...(ref.sourceId !== undefined ? { sourceId: ref.sourceId } : {}),
            ...(ref.retrievalOutcomeId !== undefined ? { retrievalOutcomeId: ref.retrievalOutcomeId } : {}) };
    });
}
function writingPrunePlan(versions: WritingVersion[], receipts: SaveReceipt[], conversationId: string, turnIndex?: number,
    recoveryPins: string[] = [], priorCandidates = new Set<string>()): { versions: Set<string>; receipts: Set<string>; candidates: Set<string> } {
    const remove = new Set(versions.filter((v) => priorCandidates.has(v.id)
        || (v.conversationId === conversationId && (turnIndex === undefined || v.turnIndex === turnIndex))).map((v) => v.id));
    const candidates = new Set(remove);
    const pinned = new Set([...receipts.filter((r) => r.state !== 'completed').map((r) => r.writingVersionId), ...recoveryPins]);
    const byId = new Map(versions.map((v) => [v.id, v]));
    const retain = (id: string): void => {
        const visited = new Set<string>();
        let version = byId.get(id);
        while (version && !visited.has(version.id)) {
            visited.add(version.id); remove.delete(version.id);
            version = version.parentVersionId ? byId.get(version.parentVersionId) : undefined;
        }
    };
    for (const version of versions) if (!remove.has(version.id) || pinned.has(version.id)) retain(version.id);
    return { versions: remove, candidates, receipts: new Set(receipts.filter((r) => remove.has(r.writingVersionId) && r.state === 'completed').map((r) => r.id)) };
}
function assertWritingVersionUpdate(previous: WritingVersion | undefined, next: WritingVersion): void {
    if (previous && JSON.stringify(previous) !== JSON.stringify(next)) throw new Error('Writing version is immutable');
}
function assertWritingParent(version: WritingVersion, parent: WritingVersion | undefined): void {
    if (version.parentVersionId && (!parent || parent.conversationId !== version.conversationId)) throw new Error('Writing parent unavailable');
}
function assertTurnWritingVersions(turn: PersistedTurn, get: (id: string) => WritingVersion | undefined): void {
    for (const message of [turn.user, turn.assistant]) {
        if (message.writingVersionId) {
            const version = get(message.writingVersionId);
            if (!version || version.conversationId !== turn.conversationId || version.turnIndex !== turn.turnIndex) throw new Error('Writing turn reference mismatch');
        }
        if (message.writingRecovery?.parentVersionId) {
            const parent = get(message.writingRecovery.parentVersionId);
            if (!parent || parent.conversationId !== turn.conversationId) throw new Error('Writing recovery parent mismatch');
        }
    }
}
function assertReceiptVersion(receipt: SaveReceipt, version: WritingVersion | undefined): void {
    if (!version || version.textHash !== receipt.textHash || version.origin !== receipt.origin) throw new Error('Save version unavailable');
    const refs = new Set(version.associatedImages.map((i) => `${i.ref.assetId}:${i.ref.contentHash}`));
    if (receipt.attachments.some((a) => !refs.has(`${a.ref.assetId}:${a.ref.contentHash}`))) throw new Error('Save image is outside writing version');
}
function addImageOwners(assets: ImageAsset[], refs: ImageRef[], owner: ImageAssetOwner): ImageAsset[] {
    const indexed = new Map(assets.map((asset) => [asset.id, asset]));
    for (const ref of refs) requireImageAsset(indexed.get(ref.assetId), ref);
    return [...new Set(refs.map((r) => r.assetId))].map((id) => changeAssetOwner(indexed.get(id)!, owner, true));
}

function requireImageAsset(value: unknown, input: ImageRef): ImageAsset {
    const ref = cloneImageRef(input);
    if (!value) throw new Error("Image original has not been registered.");
    const asset = cloneImageAsset(value);
    if (asset.id !== ref.assetId || asset.originalHash !== ref.contentHash || asset.state === "preserving") {
        throw new Error("Image reference does not match a preserved original.");
    }
    return asset;
}

function changeAssetOwner(asset: ImageAsset, owner: ImageAssetOwner, add: boolean): ImageAsset {
    const owners = asset.owners.filter((entry) => entry.kind !== owner.kind || entry.id !== owner.id);
    if (add) owners.push({ ...owner });
    return cloneImageAsset({ ...asset, owners });
}

function applyTurnAssetOwners(assets: ImageAsset[], turn: PersistedTurn): ImageAsset[] {
    const refs = [...(turn.user.images ?? []), ...(turn.assistant.images ?? [])].map((image) => cloneImageRef(image.ref));
    const owner: ImageAssetOwner = { kind: "turn", id: imageTurnOwnerId(turn.conversationId, turn.turnIndex) };
    const indexed = new Map(assets.map((asset) => [asset.id, asset]));
    for (const ref of refs) requireImageAsset(indexed.get(ref.assetId), ref);
    const selected = new Set(refs.map((ref) => ref.assetId));
    return assets.filter((asset) => selected.has(asset.id) || asset.owners.some((entry) => entry.kind === owner.kind && entry.id === owner.id))
        .map((asset) => changeAssetOwner(asset, owner, selected.has(asset.id)));
}

function variantEvictions(existing: ImageVariantRecord[], incoming: ImageVariantRecord, maxBytes: number, pinnedIds: readonly string[]): string[] {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < incoming.byteLength) throw new Error("Image cache item exceeds its limit.");
    const previous = existing.filter((variant) => variant.id !== incoming.id);
    let size = previous.reduce((total, variant) => total + variant.byteLength, incoming.byteLength);
    const pins = new Set(pinnedIds);
    const remove: string[] = [];
    for (const variant of previous.sort((a, b) => a.lastUsedAt - b.lastUsedAt)) {
        if (size <= maxBytes) break;
        if (!pins.has(variant.id)) { remove.push(variant.id); size -= variant.byteLength; }
    }
    if (size > maxBytes) throw new Error("Image cache is currently in use.");
    return remove;
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

function cloneContextUsedItem(item: ChatContextUsedItem): ChatContextUsedItem {
    const copy: ChatContextUsedItem = { ...item };
    if (item.memoryClaimId) {
        delete copy.sources;
    } else if (item.sources) {
        copy.sources = item.sources.map((source) => ({ ...source }));
    }
    return copy;
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
