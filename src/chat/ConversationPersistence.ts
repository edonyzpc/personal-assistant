import type { ChatMessage } from "../ai-services/chat-service";
import type { TimelineEntry } from "./types";
import type { ChatHistoryManager } from "./chat-history-manager";
import type { PersistedConversation, PersistedTurn } from "./chat-history-store";
import type { WritingVersionService } from './writing-versions';
import { cloneWritingVersion, type WritingVersion } from './writing-types';
import { throwIfAborted } from '../ai-services/chat-utils';
import { conservativeLegacySourceSelection, isChatSourceScope, newConversationSourceSelection,
    parseConversationSourceSelection, type ChatSourceScope, type ConversationSourceSelection,
    type RunSourceSelection } from '../ai-services/chat-source-scope';

let sourceSelectionInstanceSequence = 0;

interface PendingSourceSelection {
    selection: ConversationSourceSelection;
    selectionId: string;
    saveFailed: boolean;
}

export interface WritingCandidateSnapshot {
    conversationId: string | null;
    candidates: WritingVersion[];
    isParentCurrent(parent: WritingVersion): boolean;
    isParentSourceCurrent(parent: WritingVersion): boolean;
}

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
    private reservedConversationId: string | null = null;
    private nextTurnIndex = 0;
    private initialImageAnchor?: PersistedConversation['imageAnchor'];
    private persistedTurnIndexByEntry = new WeakMap<TimelineEntry, number>();
    private persistChain: Promise<void> = Promise.resolve();
    private unpersistedFinalizedEntries = new Set<TimelineEntry>();
    private pendingTurnIndexByRunId = new Map<string, number>();
    private readonly sourceSelectionInstanceId = ++sourceSelectionInstanceSequence;
    private sourceSelectionSequence = 0;
    private draftSequence = 0;
    private sourceSelection: ConversationSourceSelection = newConversationSourceSelection();
    private sourceSelectionId = this.nextSourceSelectionId();
    private persistedSourceSelectionRevision: number | undefined;
    private knownSourceSelectionRevision = 0;
    private pendingSourceSelectionId: string | null = null;
    private readonly pendingSourceSelections = new Map<string, PendingSourceSelection>();
    private readonly sourceSelectionPersistChains = new Map<string, Promise<void>>();
    private readonly sourceSelectionAttempts = new Map<string, Promise<boolean>>();
    private sourceSelectionSaveFailed = false;
    private subscribedManager: ChatHistoryManager | null = null;
    private unsubscribeSourceSelection: (() => void) | null = null;

    constructor(private readonly options: ConversationPersistenceOptions) {}

    get activeConversationId(): string | null {
        return this.activeId;
    }

    get currentSourceSelection(): Pick<ConversationSourceSelection, 'scope' | 'basis'> {
        return { scope: this.sourceSelection.scope, basis: this.sourceSelection.basis };
    }

    get isSourceSelectionPending(): boolean { return this.pendingSourceSelectionId !== null; }
    get didSourceSelectionSaveFail(): boolean { return this.sourceSelectionSaveFailed; }

    /** Synchronous: the run uses this exact choice even if a save is still pending. */
    captureRunSourceSelection(userMessageId: string): RunSourceSelection {
        const selection: RunSourceSelection = {
            schemaVersion: 1,
            scope: this.sourceSelection.scope,
            selectionId: this.sourceSelectionId,
            userMessageId,
            ...(this.pendingSourceSelectionId === null && this.persistedSourceSelectionRevision !== undefined
                ? { persistedSelectionRevision: this.persistedSourceSelectionRevision } : {}),
        };
        return Object.freeze(selection);
    }

    /** A future scope control calls this synchronously; durable metadata follows independently of turn writes. */
    selectSourceScope(scope: ChatSourceScope): Promise<boolean> {
        if (!isChatSourceScope(scope)) throw new Error('Invalid Chat source scope');
        if (scope === this.sourceSelection.scope && this.pendingSourceSelectionId === null
            && this.persistedSourceSelectionRevision !== undefined) return Promise.resolve(true);
        this.sourceSelectionId = this.nextSourceSelectionId();
        this.sourceSelection = { schemaVersion: 1, scope,
            revision: this.knownSourceSelectionRevision, basis: 'user' };
        this.persistedSourceSelectionRevision = undefined;
        this.pendingSourceSelectionId = this.sourceSelectionId;
        this.sourceSelectionSaveFailed = false;
        if (this.activeId) this.pendingSourceSelections.set(this.activeId, {
            selection: { ...this.sourceSelection }, selectionId: this.sourceSelectionId, saveFailed: false,
        });
        return this.activeId ? this.persistSourceSelection(this.activeId, this.sourceSelectionId, scope) : Promise.resolve(false);
    }

    retryPendingSourceSelection(): Promise<boolean> {
        const id = this.activeId, selectionId = this.pendingSourceSelectionId;
        if (!id || !selectionId) return Promise.resolve(false);
        return this.persistSourceSelection(id, selectionId, this.sourceSelection.scope);
    }

    dispose(): void {
        this.unsubscribeSourceSelection?.();
        this.unsubscribeSourceSelection = null;
        this.subscribedManager = null;
    }

    private nextSourceSelectionId(): string {
        const owner = this.activeId ?? `draft-${this.draftSequence}`;
        return `${owner}:selection:${this.sourceSelectionInstanceId}:${++this.sourceSelectionSequence}`;
    }

    private committedSourceSelectionId(conversationId: string, revision: number): string {
        return `${conversationId}:selection:revision:${revision}`;
    }

    private observeSourceSelection(conversationId: string, selection: ConversationSourceSelection): void {
        if (this.activeId !== conversationId || selection.revision <= this.knownSourceSelectionRevision) return;
        this.knownSourceSelectionRevision = selection.revision;
        if (this.activeConversation) this.activeConversation = {
            ...this.activeConversation, sourceSelection: { ...selection },
        };
        // A different view's earlier commit must not overwrite a newer local pending choice.
        if (this.pendingSourceSelectionId !== null) return;
        this.sourceSelection = { ...selection };
        this.sourceSelectionId = this.committedSourceSelectionId(conversationId, selection.revision);
        this.persistedSourceSelectionRevision = selection.revision;
    }

    private persistSourceSelection(conversationId: string, selectionId: string, scope: ChatSourceScope): Promise<boolean> {
        const existing = this.sourceSelectionAttempts.get(selectionId);
        if (existing) return existing;
        let committed = false;
        const previous = this.sourceSelectionPersistChains.get(conversationId) ?? Promise.resolve();
        const next = previous.catch(() => undefined).then(async () => {
            const manager = await this.getReadyManager();
            if (!manager) throw new Error('Chat history unavailable');
            const selection = await manager.updateConversationSourceSelection(conversationId, scope);
            if (!selection) throw new Error('Chat conversation no longer exists');
            committed = true;
            if (this.pendingSourceSelections.get(conversationId)?.selectionId !== selectionId) return;
            this.pendingSourceSelections.delete(conversationId);
            if (this.activeId !== conversationId || this.pendingSourceSelectionId !== selectionId) return;
            const observed = manager.latestConversationSourceSelection(conversationId);
            const latest = observed && observed.revision > selection.revision ? observed : selection;
            this.observeSourceSelection(conversationId, latest);
            this.sourceSelection = { ...latest };
            this.sourceSelectionId = latest.revision === selection.revision
                ? selectionId : this.committedSourceSelectionId(conversationId, latest.revision);
            this.persistedSourceSelectionRevision = latest.revision;
            this.pendingSourceSelectionId = null;
            this.sourceSelectionSaveFailed = false;
        }).catch(error => {
            const pending = this.pendingSourceSelections.get(conversationId);
            if (pending?.selectionId === selectionId) pending.saveFailed = true;
            if (this.activeId === conversationId && this.pendingSourceSelectionId === selectionId) this.sourceSelectionSaveFailed = true;
            this.options.log('Failed to persist Chat source selection', error);
        });
        this.sourceSelectionPersistChains.set(conversationId, next);
        const result = next.then(() => committed);
        this.sourceSelectionAttempts.set(selectionId, result);
        void result.finally(() => {
            if (this.sourceSelectionAttempts.get(selectionId) === result) this.sourceSelectionAttempts.delete(selectionId);
            if (this.sourceSelectionPersistChains.get(conversationId) === next) this.sourceSelectionPersistChains.delete(conversationId);
        });
        return result;
    }

    async prepareWritingCandidates(versions: Pick<WritingVersionService, 'get'>, input: {
        getAllowedVersionIds(): readonly string[];
        isCurrent(): boolean;
        signal?: AbortSignal;
    }): Promise<WritingCandidateSnapshot> {
        const conversationId = this.activeId;
        const assertCurrent = () => {
            throwIfAborted(input.signal);
            if (!input.isCurrent() || this.activeId !== conversationId) throw new Error('Writing conversation changed');
        };
        assertCurrent();
        if (!conversationId) return { conversationId: null, candidates: [], isParentCurrent: () => false, isParentSourceCurrent: () => false };
        const manager = await this.getReadyManager();
        assertCurrent();
        if (!manager) throw new Error('Writing history unavailable');
        const sourceCurrent = manager.captureSourceLifetime(conversationId);
        const capturedIds = new Set(input.getAllowedVersionIds());
        const entryIndices = this.persistedTurnIndexByEntry;
        const stillAllowed = (id: string) => input.isCurrent() && this.activeId === conversationId
            && this.options.getManager() === manager && sourceCurrent()
            && capturedIds.has(id) && input.getAllowedVersionIds().includes(id);
        const candidates: WritingVersion[] = [];
        for (const id of capturedIds) {
            assertCurrent();
            if (!stillAllowed(id)) throw new Error('Writing candidate scope changed');
            const version = await versions.get(id);
            assertCurrent();
            if (!stillAllowed(id)) throw new Error('Writing candidate scope changed');
            if (version && version.conversationId === conversationId) candidates.push(cloneWritingVersion(version));
        }
        assertCurrent();
        if (!sourceCurrent() || this.options.getManager() !== manager || candidates.some(version => !stillAllowed(version.id))) {
            throw new Error('Writing candidate scope changed');
        }
        const identities = new Map(candidates.map(version => [version.id, JSON.stringify(version)]));
        const isParentSourceCurrent = (parent: WritingVersion): boolean => {
            try { return this.persistedTurnIndexByEntry === entryIndices && this.activeId === conversationId
                && this.options.getManager() === manager && sourceCurrent()
                && capturedIds.has(parent.id) && input.getAllowedVersionIds().includes(parent.id)
                && identities.get(parent.id) === JSON.stringify(cloneWritingVersion(parent)); }
            catch { return false; }
        };
        return {
            conversationId, candidates: candidates.map(cloneWritingVersion),
            isParentSourceCurrent,
            isParentCurrent: parent => {
                try { return stillAllowed(parent.id) && identities.get(parent.id) === JSON.stringify(cloneWritingVersion(parent)); }
                catch { return false; }
            },
        };
    }

    get imageAnchor(): PersistedConversation['imageAnchor'] {
        const anchor = this.activeConversation?.imageAnchor ?? this.initialImageAnchor;
        return anchor ? { ...anchor } : undefined;
    }

    setImageAnchor(anchor: NonNullable<PersistedConversation['imageAnchor']>): void {
        this.initialImageAnchor = { ...anchor };
        if (this.activeConversation) this.activeConversation = { ...this.activeConversation, imageAnchor: { ...anchor } };
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
        this.initialImageAnchor = undefined;
        this.persistedTurnIndexByEntry = new WeakMap<TimelineEntry, number>();
        this.unpersistedFinalizedEntries.clear();
        this.pendingTurnIndexByRunId.clear();
        this.reservedConversationId = null;
        this.draftSequence += 1;
        this.sourceSelection = newConversationSourceSelection();
        this.sourceSelectionId = this.nextSourceSelectionId();
        this.persistedSourceSelectionRevision = undefined;
        this.knownSourceSelectionRevision = 0;
        this.pendingSourceSelectionId = null;
        this.sourceSelectionSaveFailed = false;
    }

    /**
     * Reserve the first turn's final conversation identity without creating an
     * empty persisted conversation. A new reservation replaces an unused one.
     */
    async reserveConversationId(_firstUserMessage: string): Promise<string | null> {
        this.reservedConversationId = null;
        if (this.activeId) return this.activeId;
        const manager = await this.getReadyManager();
        if (!manager) return null;
        const reserved = manager.reserveConversationId();
        if (!reserved.trim()) return null;
        this.reservedConversationId = reserved;
        return reserved;
    }

    /** A paid image task needs a durable conversation anchor before provider submission. */
    async ensureConversationForImageRequest(prompt: string): Promise<string | null> {
        if (this.activeId) return this.activeId;
        const manager = await this.getReadyManager();
        if (!manager || !this.reservedConversationId) return null;
        const reservedId = this.reservedConversationId;
        const selectionId = this.sourceSelectionId;
        const created = await manager.startConversation(prompt, this.initialImageAnchor, reservedId, this.sourceSelection);
        this.adoptCreatedConversation(created, selectionId);
        return created.id;
    }

    private adoptCreatedConversation(created: PersistedConversation, startedSelectionId: string): void {
        this.activeConversation = created;
        this.activeId = created.id;
        this.nextTurnIndex = 0;
        this.reservedConversationId = null;
        const committed = parseConversationSourceSelection(created.sourceSelection);
        if (this.sourceSelectionId === startedSelectionId && committed) {
            this.sourceSelection = committed;
            this.persistedSourceSelectionRevision = committed.revision;
            this.pendingSourceSelectionId = null;
            this.sourceSelectionSaveFailed = false;
            this.knownSourceSelectionRevision = committed.revision;
        } else if (this.pendingSourceSelectionId) {
            this.pendingSourceSelections.set(created.id, {
                selection: { ...this.sourceSelection }, selectionId: this.pendingSourceSelectionId,
                saveFailed: this.sourceSelectionSaveFailed,
            });
            void this.retryPendingSourceSelection();
        }
    }

    private retainLatestSourceSelection(updated: PersistedConversation): PersistedConversation {
        const local = parseConversationSourceSelection(this.activeConversation?.sourceSelection);
        const returned = parseConversationSourceSelection(updated.sourceSelection);
        return local && (!returned || local.revision > returned.revision)
            ? { ...updated, sourceSelection: local } : updated;
    }

    async getReadyManager(): Promise<ChatHistoryManager | null> {
        const manager = this.options.getManager();
        if (!manager) return null;
        await manager.initialize();
        if (!manager.isAvailable()) return null;
        if (manager !== this.subscribedManager) {
            this.unsubscribeSourceSelection?.();
            this.subscribedManager = manager;
            this.unsubscribeSourceSelection = manager.subscribeConversationSourceSelection?.((event) => {
                this.observeSourceSelection(event.conversationId, event.selection);
            }) ?? null;
        }
        return manager;
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
            this.pendingSourceSelections.delete(conversationId);
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

        const sameConversation = this.activeId === conversation.id;
        const pending = this.pendingSourceSelections.get(conversation.id);
        const storedSelection = parseConversationSourceSelection(conversation.sourceSelection);
        const observedSelection = manager.latestConversationSourceSelection?.(conversation.id);
        const restoredSelection = observedSelection && (!storedSelection || observedSelection.revision > storedSelection.revision)
            ? observedSelection : storedSelection;
        this.activeConversation = { ...conversation,
            ...(restoredSelection ? { sourceSelection: { ...restoredSelection } } : {}),
        };
        this.activeId = conversation.id;
        if (pending) {
            this.sourceSelection = { ...pending.selection };
            this.sourceSelectionId = pending.selectionId;
            this.pendingSourceSelectionId = pending.selectionId;
            this.persistedSourceSelectionRevision = undefined;
            this.sourceSelectionSaveFailed = pending.saveFailed;
        } else {
            this.sourceSelection = restoredSelection ?? conservativeLegacySourceSelection();
            this.sourceSelectionId = restoredSelection
                ? this.committedSourceSelectionId(conversation.id, restoredSelection.revision)
                : this.nextSourceSelectionId();
            this.persistedSourceSelectionRevision = restoredSelection?.revision;
            this.pendingSourceSelectionId = null;
            this.sourceSelectionSaveFailed = false;
        }
        this.knownSourceSelectionRevision = sameConversation && pending
            ? Math.max(this.knownSourceSelectionRevision, restoredSelection?.revision ?? 0)
            : restoredSelection?.revision ?? 0;
        this.initialImageAnchor = conversation.imageAnchor ? { ...conversation.imageAnchor } : undefined;
        this.nextTurnIndex = maxTurnIndex + 1;
        this.persistedTurnIndexByEntry = persistedTurnIndexByEntry;
        this.unpersistedFinalizedEntries.clear();
        this.pendingTurnIndexByRunId.clear();

        return { chatHistory, timelineEntries };
    }

    persistFinalizedTurn(
        prompt: string,
        entry: TimelineEntry,
        beforeRecord?: (context: { conversationId: string; turnIndex: number }, isCurrent: () => boolean) => Promise<void>,
        pendingRunId?: string,
    ): Promise<boolean> {
        if (entry.kind !== 'history') return Promise.resolve(true);
        this.unpersistedFinalizedEntries.add(entry);
        const entryIndices = this.persistedTurnIndexByEntry;
        const manager = this.options.getManager();
        const isCurrent = () => this.persistedTurnIndexByEntry === entryIndices && this.options.getManager() === manager;
        let persisted = false;
        const next = this.persistChain
            .catch(() => undefined)
            .then(async () => {
                persisted = await this.runPersistFinalizedTurn(prompt, entry, entryIndices, isCurrent, beforeRecord, pendingRunId);
            });
        this.persistChain = next;
        return next.then(() => persisted);
    }

    private async runPersistFinalizedTurn(
        prompt: string,
        entry: TimelineEntry,
        entryIndices: WeakMap<TimelineEntry, number>,
        isCurrent: () => boolean,
        beforeRecord?: (context: { conversationId: string; turnIndex: number }, isCurrent: () => boolean) => Promise<void>,
        pendingRunId?: string,
    ): Promise<boolean> {
        if (entry.kind !== 'history') return true;
        if (!isCurrent()) return false;
        const manager = await this.getReadyManager();
        if (!manager || !isCurrent()) return false;

        try {
            let conversation = this.activeConversation;
            let conversationId = this.activeId;
            if (!conversation || !conversationId) {
                const startedSelectionId = this.sourceSelectionId;
                const created = await manager.startConversation(prompt, this.initialImageAnchor,
                    this.reservedConversationId ?? undefined, this.sourceSelection);
                if (!isCurrent()) return false;
                conversation = created;
                conversationId = created.id;
                this.adoptCreatedConversation(created, startedSelectionId);
            }
            const pendingTurnIndex = pendingRunId ? this.pendingTurnIndexByRunId.get(pendingRunId) : undefined;
            const turnIndex = pendingTurnIndex ?? this.nextTurnIndex;
            if (beforeRecord) await beforeRecord({ conversationId, turnIndex }, isCurrent);
            if (!isCurrent()) return false;
            const persistedEntry: TimelineEntry = pendingRunId ? {
                ...entry,
                user: { ...entry.user },
                assistant: {
                    ...entry.assistant,
                    agentExecution: {
                        runId: pendingRunId,
                        state: persistedExecutionState(entry.assistant),
                    },
                },
            } : entry;
            const updated = await manager.recordTurn({
                conversationId,
                turnIndex,
                entry: persistedEntry,
                userPrompt: prompt,
                conversation,
            });
            // A write already admitted may finish after a view reopens. Keep its
            // durable result without moving the newly hydrated conversation cursor.
            if (isCurrent()) {
                this.activeConversation = this.retainLatestSourceSelection(updated);
                this.nextTurnIndex = Math.max(this.nextTurnIndex, turnIndex + 1);
            } else if (this.options.getManager() === manager && this.activeId === conversationId && this.activeConversation) {
                // Reopening this same conversation can hydrate before the admitted
                // write finishes. Reserve its committed index without replacing
                // the reopened view's metadata with the older snapshot.
                this.nextTurnIndex = Math.max(this.nextTurnIndex, turnIndex + 1);
                this.activeConversation = { ...this.activeConversation,
                    turnCount: Math.max(this.activeConversation.turnCount, updated.turnCount) };
            }
            entryIndices.set(entry, turnIndex);
            if (pendingRunId) this.pendingTurnIndexByRunId.delete(pendingRunId);
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

    persistRunningTurn(prompt: string, runId: string, user: ChatMessage): Promise<boolean> {
        if (this.sourceSelectionSaveFailed && this.pendingSourceSelectionId) void this.retryPendingSourceSelection();
        let persisted = false;
        const next = this.persistChain.catch(() => undefined).then(async () => {
            const manager = await this.getReadyManager();
            if (!manager || this.pendingTurnIndexByRunId.has(runId)) return;
            let conversation = this.activeConversation;
            let conversationId = this.activeId;
            if (!conversation || !conversationId) {
                const startedSelectionId = this.sourceSelectionId;
                conversation = await manager.startConversation(prompt, this.initialImageAnchor,
                    this.reservedConversationId ?? undefined, this.sourceSelection);
                conversationId = conversation.id;
                this.adoptCreatedConversation(conversation, startedSelectionId);
            }
            const turnIndex = this.nextTurnIndex;
            const entry: TimelineEntry = {
                kind: "history",
                user: { ...user },
                assistant: {
                    role: "assistant",
                    content: "",
                    shareCardEligible: false,
                    agentExecution: { runId, state: "running" },
                },
            };
            const updated = await manager.recordTurn({
                conversationId,
                turnIndex,
                entry,
                userPrompt: prompt,
                conversation,
            });
            this.activeConversation = this.retainLatestSourceSelection(updated);
            this.nextTurnIndex = turnIndex + 1;
            this.pendingTurnIndexByRunId.set(runId, turnIndex);
            persisted = true;
        }).catch((error) => this.options.log("Failed to persist running chat turn", error));
        this.persistChain = next;
        return next.then(() => persisted);
    }

    persistTerminalTurn(input: {
        prompt: string;
        runId: string;
        user: ChatMessage;
        content: string;
        state: "failed" | "cancelled";
    }): Promise<boolean> {
        let persisted = false;
        const next = this.persistChain.catch(() => undefined).then(async () => {
            const manager = await this.getReadyManager();
            const turnIndex = this.pendingTurnIndexByRunId.get(input.runId);
            const conversation = this.activeConversation;
            const conversationId = this.activeId;
            if (!manager || turnIndex === undefined || !conversation || !conversationId) return;
            const entry: TimelineEntry = {
                kind: "history",
                user: { ...input.user },
                assistant: {
                    role: "assistant",
                    content: input.content,
                    shareCardEligible: false,
                    agentExecution: { runId: input.runId, state: input.state },
                },
            };
            const updated = await manager.recordTurn({
                conversationId,
                turnIndex,
                entry,
                userPrompt: input.prompt,
                conversation,
            });
            this.activeConversation = this.retainLatestSourceSelection(updated);
            this.nextTurnIndex = Math.max(this.nextTurnIndex, turnIndex + 1);
            this.pendingTurnIndexByRunId.delete(input.runId);
            persisted = true;
        }).catch((error) => this.options.log("Failed to persist terminal chat turn", error));
        this.persistChain = next;
        return next.then(() => persisted);
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

    /** Attach an explicitly recovered version to the existing turn, without a new chat or extraction event. */
    reviseFinalizedTurn(
        entry: TimelineEntry,
        prepare: (context: { conversationId: string; turnIndex: number }, isCurrent: () => boolean) => Promise<void>,
    ): Promise<boolean> {
        if (entry.kind !== 'history') return Promise.resolve(false);
        const conversationId = this.activeId;
        const entryIndices = this.persistedTurnIndexByEntry;
        const originalManager = this.options.getManager();
        const turnIndex = this.persistedTurnIndexByEntry.get(entry);
        if (!conversationId || turnIndex === undefined) return Promise.resolve(false);
        const isCurrent = () => this.persistedTurnIndexByEntry === entryIndices
            && this.activeId === conversationId && this.options.getManager() === originalManager
            && entryIndices.get(entry) === turnIndex;
        let persisted = false;
        const next = this.persistChain.catch(() => undefined).then(async () => {
            if (!isCurrent()) return;
            const manager = await this.getReadyManager();
            if (!manager || !isCurrent()) return;
            const conversation = await manager.findConversation(conversationId);
            if (!conversation || !isCurrent()) return;
            await prepare({ conversationId, turnIndex }, isCurrent);
            if (!isCurrent()) return;
            const updated = await manager.recordTurn({ conversationId, turnIndex, entry,
                userPrompt: entry.user.content, conversation });
            if (isCurrent()) this.activeConversation = this.retainLatestSourceSelection(updated);
            persisted = true;
        }).catch((error) => this.options.log('Failed to attach recovered writing version', error));
        this.persistChain = next;
        return next.then(() => persisted);
    }
}

function persistedExecutionState(message: ChatMessage): "awaiting_user" | "completed" | "partial" | "failed" | "cancelled" {
    const status = message.canonicalTurn?.status;
    if (status === 'needs_user') return 'awaiting_user';
    if (status === "aborted" || message.runtimeWarnings?.some((warning) => warning.type === "user_abort")) {
        return "cancelled";
    }
    if (status === "error") return "failed";
    if (status === "incomplete" || status === "completed_with_warning"
        || message.runtimeWarnings?.some((warning) => warning.type === "partial_output_error")) {
        return "partial";
    }
    return "completed";
}
