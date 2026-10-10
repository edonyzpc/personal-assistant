import { describe, expect, it, jest } from "@jest/globals";
import { ChatHistoryManager } from "../src/chat/chat-history-manager";
import { MemoryChatHistoryStore, type PersistedConversation, type PersistedTurn } from "../src/chat/chat-history-store";
import { ConversationPersistence } from "../src/chat/ConversationPersistence";
import type { TerminalTurnEntry, TimelineEntry } from "../src/chat/types";
import { completeInputLineage } from '../src/ai-services/input-lineage';
import type { PaAgentActionState } from '../src/ai-services/pa-agent-result-facts';

const conversation: PersistedConversation = {
    id: "conv-1",
    title: "Conversation",
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z",
    turnCount: 1,
    preview: "hello",
};

const turns: PersistedTurn[] = [
    {
        conversationId: "conv-1",
        turnIndex: 0,
        user: { role: "user", content: "hello" },
        assistant: { role: "assistant", content: "hi" },
    },
];

const historyEntry: TimelineEntry = {
    kind: "history",
    user: { role: "user", content: "hello" },
    assistant: { role: "assistant", content: "hi" },
};

function makeManager() {
    return {
        initialize: jest.fn(async () => undefined),
        isAvailable: jest.fn(() => true),
        findConversation: jest.fn(async () => conversation),
        getTurns: jest.fn(async () => turns),
        setActiveConversationId: jest.fn(async () => undefined),
    } as unknown as ChatHistoryManager & {
        setActiveConversationId: jest.Mock<(id: string | null) => Promise<void>>;
    };
}

function makePersistence(manager: ChatHistoryManager) {
    return new ConversationPersistence({
        getManager: () => manager,
        log: jest.fn(),
    });
}

describe("ConversationPersistence", () => {
    it.each(["failed", "cancelled"] as const)(
        "revises the running execution summary in place for a %s terminal turn",
        async state => {
            const store = new MemoryChatHistoryStore();
            const manager = new ChatHistoryManager({ store, generateId: () => `terminal-${state}` });
            const persistence = makePersistence(manager);
            const user = { role: "user" as const, content: "request" };
            const initialSummary = {
                version: 1 as const,
                steps: [{ key: "prep", order: 0, kind: "preparation" as const, status: "active" as const }],
            };
            const terminalSummary = {
                version: 1 as const,
                elapsedMs: 1500,
                steps: [{ key: "prep", order: 0, kind: "preparation" as const, status: "succeeded" as const }],
            };
            expect(await persistence.persistRunningTurn("request", "pending-id", user, initialSummary)).toBe(true);
            expect(await persistence.persistTerminalTurn({
                prompt: "request", runId: "pending-id", user, content: state,
                state, executionSummary: terminalSummary,
            })).toBe(true);
            const turns = await manager.getTurns(`terminal-${state}`);
            expect(turns).toHaveLength(1);
            expect(turns[0]?.turnIndex).toBe(0);
            expect(turns[0]?.executionSummary).toEqual(terminalSummary);
            expect(manager.deserializeTurn(turns[0]!).historyEntry.executionSummary).toEqual(terminalSummary);
        },
    );

    it("retains the original terminal turn location when deletion fails and accepts a retry", async () => {
        const store = new MemoryChatHistoryStore();
        const manager = new ChatHistoryManager({ store, generateId: () => "terminal-delete-retry" });
        const persistence = makePersistence(manager);
        const user = { role: "user" as const, content: "request" };
        await persistence.persistRunningTurn("request", "pending-id", user, {
            version: 1,
            steps: [{ key: "prep", order: 0, kind: "preparation", status: "active" }],
        });
        await persistence.persistTerminalTurn({
            prompt: "request", runId: "pending-id", user, content: "failed",
            state: "failed", executionSummary: { version: 1, elapsedMs: 20, steps: [] },
        });
        const entry: TerminalTurnEntry = {
            kind: "terminal", id: 1, prompt: "request", content: "failed",
            terminalKind: "error", runId: "pending-id",
        };
        jest.spyOn(manager, "deleteTurn").mockRejectedValueOnce(new Error("storage unavailable"));

        await expect(persistence.deletePersistedTurnForEntry(entry)).resolves.toBe(false);
        expect((await manager.getTurns("terminal-delete-retry"))).toHaveLength(1);

        await expect(persistence.deletePersistedTurnForEntry(entry)).resolves.toBe(true);
        expect(await manager.getTurns("terminal-delete-retry")).toEqual([]);
    });

    it('binds a running action without changing source content or reviving a deleted request', async () => {
        const store = new MemoryChatHistoryStore();
        const manager = new ChatHistoryManager({ store, generateId: () => 'running-operations' });
        const persistence = makePersistence(manager);
        await persistence.persistRunningTurn('change note', 'original-user', { role: 'user', content: 'change note' });
        const original = (await manager.getTurns('running-operations'))[0];
        const sourceCurrent = manager.captureSourceLifetime('running-operations');
        const state: PaAgentActionState = { schemaVersion: 1, owner: 'operations', operationId: 'intent',
            phase: 'pending', revision: 0, origin: { runId: 'runtime-run', turnId: 'runtime-turn',
                assistantId: 'assistant', callId: 'call', resultId: 'result' },
            inputLineage: completeInputLineage([{ kind: 'user-text', messageId: 'original-user' }]),
            receipt: { kind: 'operations-staged', intentId: 'intent' } };
        expect(await persistence.persistRunningActionStates('running-operations', 'original-user', [state])).toBe(true);
        expect(sourceCurrent()).toBe(true);
        const saved = (await manager.getTurns('running-operations'))[0];
        expect(saved.user).toEqual(original.user);
        expect(saved.assistant).toEqual({ ...original.assistant, actionStates: [state], actionStateBinding: {
            conversationId: 'running-operations', turnIndex: 0, runId: 'runtime-run', turnId: 'runtime-turn',
        } });
        await manager.deleteTurn('running-operations', 0);
        expect(await persistence.persistRunningActionStates('running-operations', 'original-user', [state])).toBe(false);
        expect(await manager.getTurns('running-operations')).toEqual([]);
    });
    it('adds the real saved turn binding to the live message only after finalization succeeds', async () => {
        const store = new MemoryChatHistoryStore();
        const manager = new ChatHistoryManager({ store, generateId: () => 'bound-conversation' });
        const persistence = makePersistence(manager);
        const entry: TimelineEntry = { kind: 'history', user: { role: 'user', content: 'request' }, assistant: { role: 'assistant', content: 'draft',
            canonicalTurn: { schemaVersion: 1, runId: 'actual-run', turnId: 'actual-turn', messages: [] } },
            executionSummary: { version: 1, steps: [] } };
        jest.spyOn(manager, 'recordTurn').mockRejectedValueOnce(new Error('first write failed'));
        expect(await persistence.persistFinalizedTurn('request', entry)).toBe(false);
        expect(entry.assistant.actionStateBinding).toBeUndefined();
        expect(await persistence.persistFinalizedTurn('request', entry)).toBe(true);
        expect(entry.assistant.actionStateBinding).toEqual({ conversationId: 'bound-conversation', turnIndex: 0,
            runId: 'actual-run', turnId: 'actual-turn' });
        expect((await store.getTurns('bound-conversation'))[0].assistant.actionStateBinding).toEqual(entry.assistant.actionStateBinding);
        const updateElapsed = jest.spyOn(manager, 'updateExecutionElapsedMs');
        const revise = jest.spyOn(manager, 'reviseTurn');
        expect(await persistence.updateFinalizedExecutionElapsedMs(entry, 1900)).toBe(true);
        expect(updateElapsed).toHaveBeenCalledWith({ conversationId: 'bound-conversation', turnIndex: 0, entry }, 1900);
        expect(revise).not.toHaveBeenCalled();
        const reopened = makePersistence(manager).hydrateConversation(
            (await store.getConversation('bound-conversation'))!, await store.getTurns('bound-conversation'))!;
        expect(reopened.timelineEntries[0].kind).toBe('history');
        if (reopened.timelineEntries[0].kind !== 'history') throw new Error('Expected history');
        expect(reopened.timelineEntries[0].executionSummary?.elapsedMs).toBe(1900);
    });
    it('retries a pending finalized-turn revision after its first persistence failure', async () => {
        const store = new MemoryChatHistoryStore();
        const manager = new ChatHistoryManager({ store, generateId: () => 'hydrate-operations' });
        const persistence = makePersistence(manager);
        const initial: PaAgentActionState = { schemaVersion: 1, owner: 'operations', operationId: 'operation', revision: 0,
            phase: 'pending', receipt: { kind: 'operations-staged', intentId: 'operation' },
            origin: { runId: 'run', turnId: 'turn', assistantId: 'assistant', callId: 'call', resultId: 'result' },
            inputLineage: completeInputLineage([{ kind: 'user-text', messageId: 'user' }]) };
        const entry: TimelineEntry = { kind: 'history', user: { role: 'user', content: 'request' }, assistant: { role: 'assistant', content: 'reply',
            canonicalTurn: { schemaVersion: 1, runId: 'run', turnId: 'turn', messages: [], actionStates: [initial] } } };
        expect(await persistence.persistFinalizedTurn('request', entry)).toBe(true);
        const conversationId = persistence.activeConversationId!;
        const hydrated = persistence.hydrateConversation((await store.getConversation(conversationId))!, await store.getTurns(conversationId))!;
        const restored = hydrated.timelineEntries[0];
        if (restored.kind !== 'history') throw new Error('Expected history');
        const current: PaAgentActionState = { ...initial, phase: 'lost', revision: 1,
            receipt: { kind: 'operations-terminal', intentId: 'operation', state: 'lost' } };
        restored.assistant.actionStates = [current];
        restored.assistant.canonicalTurn!.actionStates = [current];
        const record = jest.spyOn(manager, 'reviseTurn').mockRejectedValueOnce(new Error('disk unavailable'));
        expect(await persistence.reviseFinalizedTurn(restored, async () => {})).toBe(false);
        expect(persistence.needsFinalizedTurnRevision(restored)).toBe(true);
        expect((await store.getTurns(conversationId))[0].assistant.actionStates?.[0].phase).toBe(initial.phase);
        // A later persistence attempt retries precisely this retained turn.
        if (persistence.needsFinalizedTurnRevision(restored)) await persistence.reviseFinalizedTurn(restored, async () => {});
        expect(persistence.needsFinalizedTurnRevision(restored)).toBe(false);
        expect((await store.getTurns(conversationId))[0].assistant.actionStates?.[0].phase).toBe(current.phase);
        expect(record).toHaveBeenCalledTimes(2);
    });
    it('drops a dirty old View revision after another persistence View deletes that turn', async () => {
        const store = new MemoryChatHistoryStore();
        const manager = new ChatHistoryManager({ store, generateId: () => 'shared-conversation' });
        const first = makePersistence(manager);
        const entry: TimelineEntry = { kind: 'history', user: { role: 'user', content: 'request' }, assistant: { role: 'assistant', content: 'original' } };
        await first.persistFinalizedTurn('request', entry);
        const conversationId = first.activeConversationId!;
        const other = makePersistence(manager);
        const hydrated = other.hydrateConversation((await store.getConversation(conversationId))!, await store.getTurns(conversationId))!;
        entry.assistant.content = 'new owner state';
        const revise = jest.spyOn(manager, 'reviseTurn').mockRejectedValueOnce(new Error('disk unavailable'));
        expect(await first.reviseFinalizedTurn(entry, async () => {})).toBe(false);
        expect(first.needsFinalizedTurnRevision(entry)).toBe(true);
        await other.deletePersistedTurnForEntry(hydrated.timelineEntries[0]);
        expect(await first.reviseFinalizedTurn(entry, async () => {})).toBe(false);
        expect(first.needsFinalizedTurnRevision(entry)).toBe(false);
        expect(await store.getTurns(conversationId)).toEqual([]);
        expect(await first.reviseFinalizedTurn(entry, async () => {})).toBe(false);
        expect(revise).toHaveBeenCalledTimes(2);
    });
    it('rejects unavailable domain updates instead of reporting a missing turn and cleaning the observer', async () => {
        const persistence = new ConversationPersistence({ getManager: () => undefined, log: jest.fn() });
        const transform = jest.fn((states: PaAgentActionState[]) => states);
        const cleanup = jest.fn();
        const update = persistence.updateActionStates('conv', 'run', 'turn', transform).then(result => {
            if (!result) cleanup();
        });
        await expect(update).rejects.toThrow('Conversation persistence unavailable');
        const operationUpdate = persistence.updateActionStatesForOperation('conv', 'run', 'ghost', 'operation', transform).then(result => {
            if (!result) cleanup();
        });
        await expect(operationUpdate).rejects.toThrow('Conversation persistence unavailable');
        expect(transform).not.toHaveBeenCalled();
        expect(cleanup).not.toHaveBeenCalled();
    });
    it('queues completion after finalization, updates the original inactive turn and reloads the result', async () => {
        const store = new MemoryChatHistoryStore();
        let nextId = 0;
        const manager = new ChatHistoryManager({ store, generateId: () => `context-${++nextId}` });
        const persistence = makePersistence(manager);
        await persistence.persistRunningTurn('make image', 'run-image', { role: 'user', content: 'make image' });
        const conversationId = persistence.activeConversationId!;
        const accepted: PaAgentActionState = { schemaVersion: 1, owner: 'image', operationId: 'task-image', phase: 'accepted', revision: 0,
            origin: { runId: 'run-image', turnId: 'turn-image', assistantId: 'assistant-image', callId: 'call-image', resultId: 'result-image' },
            inputLineage: completeInputLineage([{ kind: 'user-text', messageId: 'user-image' }]),
            receipt: { kind: 'image-accepted', taskId: 'task-image' } };
        const entry: TimelineEntry = { kind: 'history', user: { role: 'user', content: 'make image' },
            assistant: { role: 'assistant', content: 'accepted', canonicalTurn: { schemaVersion: 1,
                runId: 'run-image', turnId: 'turn-image', messages: [], actionStates: [accepted] } } };
        let release!: () => void;
        const barrier = new Promise<void>(resolve => { release = resolve; });
        const finalizing = persistence.persistFinalizedTurn('make image', entry, async () => { await barrier; }, 'run-image');
        const updating = persistence.updateActionStates(conversationId, 'run-image', 'turn-image', states =>
            states.map(state => ({ ...state, phase: 'completed', revision: 1,
                receipt: { kind: 'image-task', taskId: 'task-image', taskRevision: 2, state: 'completed' } })));
        release();
        expect(await finalizing).toBe(true);
        expect((await updating)?.[0].phase).toBe('completed');
        persistence.resetActiveConversationState();
        const reloaded = await manager.getTurns(conversationId);
        expect(reloaded).toHaveLength(1);
        expect(reloaded[0].assistant.actionStates?.[0].phase).toBe('completed');
        await persistence.updateActionStates(conversationId, 'run-image', 'turn-image', states => states);
        await manager.deleteConversation(conversationId);
        expect(await persistence.updateActionStates(conversationId, 'run-image', 'turn-image', states => states)).toBeUndefined();
        expect(await manager.getTurns(conversationId)).toEqual([]);
    });
    it("persists a running placeholder and overwrites the same turn when the run finalizes", async () => {
        const recorded: Array<{ turnIndex: number; entry: TimelineEntry }> = [];
        const manager = {
            initialize: jest.fn(async () => undefined), isAvailable: () => true,
            startConversation: jest.fn(async () => ({ ...conversation, turnCount: 0 })),
            recordTurn: jest.fn(async (input: { turnIndex: number; entry: TimelineEntry }) => {
                recorded.push({ turnIndex: input.turnIndex, entry: input.entry });
                return { ...conversation, turnCount: Math.max(conversation.turnCount, input.turnIndex + 1) };
            }),
            maybePrune: jest.fn(async () => []),
        } as unknown as ChatHistoryManager;
        const persistence = makePersistence(manager);

        await expect(persistence.persistRunningTurn("hello", "run-1", {
            role: "user", content: "hello",
        })).resolves.toBe(true);
        await expect(persistence.persistFinalizedTurn("hello", historyEntry, undefined, "run-1")).resolves.toBe(true);

        expect(recorded.map((entry) => entry.turnIndex)).toEqual([0, 0]);
        expect(recorded[0].entry.kind === "history" && recorded[0].entry.assistant.agentExecution)
            .toEqual({ runId: "run-1", state: "running" });
        expect(recorded[1].entry).toEqual({
            ...historyEntry,
            assistant: {
                ...historyEntry.assistant,
                agentExecution: { runId: "run-1", state: "completed" },
            },
        });
        expect(historyEntry.assistant.agentExecution).toBeUndefined();
    });

    it('persists a source decision as awaiting_user instead of task completion', async () => {
        const recorded: TimelineEntry[] = [];
        const manager = {
            initialize: jest.fn(async () => undefined), isAvailable: () => true,
            startConversation: jest.fn(async () => ({ ...conversation, turnCount: 0 })),
            recordTurn: jest.fn(async (input: { entry: TimelineEntry }) => {
                recorded.push(input.entry);
                return conversation;
            }),
            maybePrune: jest.fn(async () => []),
        } as unknown as ChatHistoryManager;
        const persistence = makePersistence(manager);
        const entry: TimelineEntry = { kind: 'history', user: { role: 'user', content: '只用当前笔记' },
            assistant: { role: 'assistant', content: '需要你决定是否读取其他笔记。',
                canonicalTurn: { schemaVersion: 1, runId: 'run-choice', turnId: 'turn-1',
                    status: 'needs_user', committedFinalText: '需要你决定是否读取其他笔记。', messages: [] } } };
        await expect(persistence.persistFinalizedTurn('只用当前笔记', entry, undefined, 'run-choice'))
            .resolves.toBe(true);
        expect(recorded[0].kind === 'history' && recorded[0].assistant.agentExecution)
            .toEqual({ runId: 'run-choice', state: 'awaiting_user' });
    });

    it("prepares version identity after creating the conversation but before the single turn commit", async () => {
        const order: string[] = [];
        const recordTurn = jest.fn(async () => { order.push('turn'); return conversation; });
        const manager = {
            initialize: jest.fn(async () => undefined), isAvailable: () => true,
            startConversation: jest.fn(async () => { order.push('conversation'); return { ...conversation, turnCount: 0 }; }),
            recordTurn, reviseTurn: recordTurn, maybePrune: jest.fn(async () => []), findConversation: jest.fn(async () => conversation),
        } as unknown as ChatHistoryManager;
        const extraction = jest.fn();
        const persistence = new ConversationPersistence({ getManager: () => manager, log: jest.fn(), scheduleMemoryExtractionAfterChatTurn: extraction });
        const entry: TimelineEntry = { kind: 'history', user: { role: 'user', content: 'caption' }, assistant: { role: 'assistant', content: 'body' } };
        await expect(persistence.persistFinalizedTurn('caption', entry, async (context) => {
            expect(context).toEqual({ conversationId: 'conv-1', turnIndex: 0 });
            order.push('version'); entry.assistant.writingVersionId = 'writing1';
        })).resolves.toBe(true);
        expect(order).toEqual(['conversation', 'version', 'turn']);
        await expect(persistence.reviseFinalizedTurn(entry, async (context) => {
            expect(context).toEqual({ conversationId: 'conv-1', turnIndex: 0 });
            entry.assistant.writingVersionId = 'recovered1';
        })).resolves.toBe(true);
        expect(recordTurn).toHaveBeenCalledTimes(2);
        expect(extraction).toHaveBeenCalledTimes(1);
    });

    it("loads a conversation without committing the active conversation pointer", async () => {
        const manager = makeManager();
        const persistence = makePersistence(manager);

        await expect(persistence.loadConversation("conv-1")).resolves.toEqual({
            conversation,
            turns,
        });

        expect(manager.setActiveConversationId).not.toHaveBeenCalled();
    });

    it("reuses a first-turn reserved conversation ID only for that turn's final persistence", async () => {
        const manager = {
            initialize: jest.fn(async () => undefined),
            isAvailable: jest.fn(() => true),
            reserveConversationId: jest.fn()
                .mockReturnValueOnce("reserved-conversation")
                .mockReturnValue("next-conversation"),
            findConversation: jest.fn(async () => null),
            startConversation: jest.fn(async (_prompt: string, _imageAnchor?: unknown, reservedId?: string) => ({
                ...conversation,
                id: reservedId ?? "new-conversation",
                turnCount: 0,
            })),
            recordTurn: jest.fn(async () => ({ ...conversation, id: "reserved-conversation" })),
            maybePrune: jest.fn(async () => []),
        } as unknown as ChatHistoryManager;
        const persistence = makePersistence(manager);

        await expect(persistence.reserveConversationId("hello")).resolves.toBe("reserved-conversation");
        await expect(persistence.persistFinalizedTurn("hello", historyEntry)).resolves.toBe(true);

        expect(manager.startConversation).toHaveBeenCalledWith("hello", undefined, "reserved-conversation",
            { schemaVersion: 1, scope: 'notes', revision: 0, basis: 'new-conversation' });
        expect(manager.reserveConversationId).toHaveBeenCalledTimes(1);
        expect(persistence.activeConversationId).toBe("reserved-conversation");
        persistence.resetActiveConversationState();
        await expect(persistence.reserveConversationId("next")).resolves.toBe("next-conversation");
        expect(manager.reserveConversationId).toHaveBeenCalledTimes(2);
    });

    it("durably anchors a paid image request before the turn and reuses that conversation on finalization", async () => {
        const manager = {
            initialize: jest.fn(async () => undefined), isAvailable: () => true,
            reserveConversationId: jest.fn(() => "image-conversation"),
            startConversation: jest.fn(async (_prompt: string, _anchor?: unknown, id?: string) => ({
                ...conversation, id: id ?? "unexpected", turnCount: 0,
            })),
            recordTurn: jest.fn(async () => ({ ...conversation, id: "image-conversation" })),
            maybePrune: jest.fn(async () => []),
        } as unknown as ChatHistoryManager;
        const persistence = makePersistence(manager);
        expect(await persistence.reserveConversationId("A watercolor bookstore")).toBe("image-conversation");
        expect(await persistence.ensureConversationForImageRequest("A watercolor bookstore")).toBe("image-conversation");
        expect(await persistence.persistFinalizedTurn("A watercolor bookstore", historyEntry)).toBe(true);
        expect(manager.startConversation).toHaveBeenCalledTimes(1);
        expect(manager.recordTurn).toHaveBeenCalledTimes(1);
        expect(persistence.activeConversationId).toBe("image-conversation");
    });

    it("does not commit a stale active conversation pointer", async () => {
        const manager = makeManager();
        const persistence = makePersistence(manager);

        await expect(
            persistence.commitActiveConversationPointer("conv-1", () => false),
        ).resolves.toBe(false);

        expect(manager.setActiveConversationId).not.toHaveBeenCalled();
    });

    it("commits the active conversation pointer when the session is current", async () => {
        const manager = makeManager();
        const persistence = makePersistence(manager);

        await expect(
            persistence.commitActiveConversationPointer("conv-1", () => true),
        ).resolves.toBe(true);

        expect(manager.setActiveConversationId).toHaveBeenCalledWith("conv-1");
    });

    it("fails a handoff reset when a visible finalized turn could not be persisted", async () => {
        const manager = {
            initialize: jest.fn(async () => undefined),
            isAvailable: jest.fn(() => true),
            startConversation: jest.fn(async () => ({ ...conversation, turnCount: 0 })),
            recordTurn: jest.fn(async () => {
                throw new Error("record failed");
            }),
            maybePrune: jest.fn(async () => []),
            getActiveConversationId: jest.fn(async () => "conv-1"),
            setActiveConversationId: jest.fn(async () => undefined),
        } as unknown as ChatHistoryManager;
        const persistence = makePersistence(manager);

        await expect(persistence.persistFinalizedTurn("hello", historyEntry)).resolves.toBe(false);
        await expect(persistence.clearActiveConversationPointerForHandoff({
            hasVisibleConversation: true,
            canCommit: () => true,
            commit: jest.fn(),
        })).resolves.toBe(false);

        expect(manager.setActiveConversationId).not.toHaveBeenCalled();
    });

    it("clears the active pointer before allowing a persisted visible conversation to be replaced", async () => {
        const manager = {
            initialize: jest.fn(async () => undefined),
            isAvailable: jest.fn(() => true),
            startConversation: jest.fn(async () => ({ ...conversation, turnCount: 0 })),
            recordTurn: jest.fn(async () => conversation),
            maybePrune: jest.fn(async () => []),
            getActiveConversationId: jest.fn(async () => "conv-1"),
            setActiveConversationId: jest.fn(async () => undefined),
        } as unknown as ChatHistoryManager;
        const persistence = makePersistence(manager);
        const commit = jest.fn();

        await expect(persistence.persistFinalizedTurn("hello", historyEntry)).resolves.toBe(true);
        await expect(persistence.clearActiveConversationPointerForHandoff({
            hasVisibleConversation: true,
            canCommit: () => true,
            commit,
        })).resolves.toBe(true);

        expect(manager.setActiveConversationId).toHaveBeenCalledWith(null);
        expect(commit).toHaveBeenCalledTimes(1);
    });

    it("fails a handoff reset without mutating state when clearing the pointer fails", async () => {
        const manager = {
            initialize: jest.fn(async () => undefined),
            isAvailable: jest.fn(() => true),
            startConversation: jest.fn(async () => ({ ...conversation, turnCount: 0 })),
            recordTurn: jest.fn(async () => conversation),
            maybePrune: jest.fn(async () => []),
            getActiveConversationId: jest.fn(async () => "conv-1"),
            setActiveConversationId: jest.fn(async () => {
                throw new Error("pointer failed");
            }),
        } as unknown as ChatHistoryManager;
        const persistence = makePersistence(manager);

        await expect(persistence.persistFinalizedTurn("hello", historyEntry)).resolves.toBe(true);
        await expect(persistence.clearActiveConversationPointerForHandoff({
            hasVisibleConversation: true,
            canCommit: () => true,
            commit: jest.fn(),
        })).resolves.toBe(false);

        expect(persistence.activeConversationId).toBe("conv-1");
    });

    it("restores the previous pointer when handoff eligibility changes during a deferred clear", async () => {
        let releaseClear: (() => void) | undefined;
        let markClearStarted: (() => void) | undefined;
        const clearGate = new Promise<void>((resolve) => {
            releaseClear = resolve;
        });
        const clearStarted = new Promise<void>((resolve) => {
            markClearStarted = resolve;
        });
        const setActiveConversationId = jest.fn(async (id: string | null) => {
            if (id !== null) return;
            markClearStarted?.();
            await clearGate;
        });
        const manager = {
            initialize: jest.fn(async () => undefined),
            isAvailable: jest.fn(() => true),
            startConversation: jest.fn(async () => ({ ...conversation, turnCount: 0 })),
            recordTurn: jest.fn(async () => conversation),
            maybePrune: jest.fn(async () => []),
            getActiveConversationId: jest.fn(async () => "conv-1"),
            setActiveConversationId,
        } as unknown as ChatHistoryManager;
        const persistence = makePersistence(manager);
        const commit = jest.fn();
        let canCommit = true;

        await expect(persistence.persistFinalizedTurn("hello", historyEntry)).resolves.toBe(true);
        const preparing = persistence.clearActiveConversationPointerForHandoff({
            hasVisibleConversation: true,
            canCommit: () => canCommit,
            commit,
        });
        await clearStarted;
        canCommit = false;
        releaseClear?.();

        await expect(preparing).resolves.toBe(false);
        expect(setActiveConversationId.mock.calls).toEqual([[null], ["conv-1"]]);
        expect(commit).not.toHaveBeenCalled();
        expect(persistence.activeConversationId).toBe("conv-1");
    });
});

describe('B-149 Chat source selection persistence', () => {
    function setup() {
        const store = new MemoryChatHistoryStore();
        let nextId = 0;
        const manager = new ChatHistoryManager({ store, generateId: () => `scope-${++nextId}` });
        const log = jest.fn();
        const create = () => new ConversationPersistence({ getManager: () => manager, log });
        return { store, manager, create, log };
    }

    it('starts each draft at notes, retains an early web choice, and restores each conversation separately', async () => {
        const { store, manager, create } = setup();
        const view = create();
        expect(view.currentSourceSelection).toMatchObject({ scope: 'notes', basis: 'new-conversation' });
        expect(view.captureRunSourceSelection('message-a')).toMatchObject({ scope: 'notes', userMessageId: 'message-a' });
        expect(await view.selectSourceScope('web')).toBe(false);
        const firstRun = view.captureRunSourceSelection('message-a');
        expect(firstRun).toMatchObject({ scope: 'web', userMessageId: 'message-a' });
        expect(firstRun).not.toHaveProperty('persistedSelectionRevision');
        await expect(view.persistRunningTurn('first', 'message-a', { role: 'user', content: 'first',
            runSourceSelection: firstRun })).resolves.toBe(true);
        const firstId = view.activeConversationId!;
        expect(await store.getConversation(firstId)).toMatchObject({ sourceSelection: {
            schemaVersion: 1, scope: 'web', revision: 0, basis: 'user',
        } });
        expect((await store.getTurns(firstId))[0].user.runSourceSelection).toEqual(firstRun);
        expect(view.captureRunSourceSelection('message-b')).toMatchObject({ scope: 'web', persistedSelectionRevision: 0 });

        view.resetActiveConversationState();
        expect(view.currentSourceSelection.scope).toBe('notes');
        const second = await manager.startConversation('second');
        view.hydrateConversation(second, []);
        expect(view.currentSourceSelection.scope).toBe('notes');
        view.hydrateConversation((await store.getConversation(firstId))!, await store.getTurns(firstId));
        expect(view.currentSourceSelection.scope).toBe('web');
        view.dispose();
    });

    it('sends from pending memory choice while its metadata save is suspended, then accepts only its real revision', async () => {
        const { store, manager, create } = setup();
        await manager.initialize();
        const initial = await manager.startConversation('first');
        const view = create();
        await view.getReadyManager();
        view.hydrateConversation(initial, []);
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const commit = manager.updateConversationSourceSelection.bind(manager);
        jest.spyOn(manager, 'updateConversationSourceSelection').mockImplementation(async (id, scope) => {
            await gate;
            return commit(id, scope);
        });
        const saving = view.selectSourceScope('web');
        const captured = view.captureRunSourceSelection('message-web');
        expect(captured).toMatchObject({ scope: 'web', userMessageId: 'message-web' });
        expect(captured).not.toHaveProperty('persistedSelectionRevision');
        await expect(view.persistRunningTurn('next', 'message-web', { role: 'user', content: 'next',
            runSourceSelection: captured })).resolves.toBe(true);
        expect(await store.getConversation(initial.id)).toMatchObject({ sourceSelection: { scope: 'notes', revision: 0 } });
        release();
        await expect(saving).resolves.toBe(true);
        expect(view.captureRunSourceSelection('message-after')).toMatchObject({ scope: 'web', persistedSelectionRevision: 1 });
        expect(captured).not.toHaveProperty('persistedSelectionRevision');
        expect(await store.getConversation(initial.id)).toMatchObject({ sourceSelection: { scope: 'web', revision: 1 } });
        view.dispose();
    });

    it('retains a failed choice for the next send and lets two views converge on committed order', async () => {
        const { store, manager, create } = setup();
        await manager.initialize();
        const initial = await manager.startConversation('first');
        const first = create(), second = create();
        await first.getReadyManager(); await second.getReadyManager();
        first.hydrateConversation(initial, []);
        second.hydrateConversation(initial, []);
        jest.spyOn(store, 'updateConversationSourceSelection').mockRejectedValueOnce(new Error('save failed'));
        await expect(first.selectSourceScope('web')).resolves.toBe(false);
        expect(first.didSourceSelectionSaveFail).toBe(true);
        expect(first.captureRunSourceSelection('pending')).toMatchObject({ scope: 'web' });
        expect(first.captureRunSourceSelection('pending')).not.toHaveProperty('persistedSelectionRevision');
        await expect(first.persistRunningTurn('new question', 'pending', { role: 'user', content: 'new question' }))
            .resolves.toBe(true);
        expect((await store.getConversation(initial.id))?.sourceSelection).toMatchObject({ scope: 'web', revision: 1 });
        expect(first.isSourceSelectionPending).toBe(false);
        expect(second.currentSourceSelection.scope).toBe('web');

        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const commit = manager.updateConversationSourceSelection.bind(manager);
        jest.spyOn(manager, 'updateConversationSourceSelection').mockImplementation(async (id, scope) => {
            if (scope === 'combined') await gate;
            return commit(id, scope);
        });
        const pendingCombined = first.selectSourceScope('combined');
        await expect(second.selectSourceScope('notes')).resolves.toBe(true);
        expect(first.currentSourceSelection.scope).toBe('combined');
        expect(first.captureRunSourceSelection('still-pending')).not.toHaveProperty('persistedSelectionRevision');
        release();
        await expect(pendingCombined).resolves.toBe(true);
        expect((await store.getConversation(initial.id))?.sourceSelection).toMatchObject({ scope: 'combined', revision: 3 });
        expect(second.currentSourceSelection.scope).toBe('combined');
        first.dispose(); second.dispose();
    });

    it('treats an old conversation without scope as conservative notes while keeping its turns', async () => {
        const { store, manager, create } = setup();
        await manager.initialize();
        const old = { ...conversation, id: 'legacy', sourceSelection: undefined };
        await store.upsertConversation(old);
        await store.appendTurn({ ...turns[0], conversationId: 'legacy' });
        const view = create();
        await view.getReadyManager();
        const loaded = await view.loadConversation('legacy');
        expect(loaded?.turns[0].assistant.content).toBe('hi');
        view.hydrateConversation(loaded!.conversation, loaded!.turns);
        expect(view.currentSourceSelection).toMatchObject({ scope: 'notes', basis: 'conservative-fallback' });
        expect(view.captureRunSourceSelection('new-message')).not.toHaveProperty('persistedSelectionRevision');
        view.dispose();
    });

    it('continues after reload as a new run under the current choice without replaying an interrupted run', async () => {
        const { store, create } = setup();
        const initial = create();
        const oldChoice = initial.captureRunSourceSelection('old-message');
        await expect(initial.persistRunningTurn('old task', 'old-message', { role: 'user', content: 'old task',
            runSourceSelection: oldChoice })).resolves.toBe(true);
        const conversationId = initial.activeConversationId!;
        initial.dispose();

        const reopened = create();
        await reopened.getReadyManager();
        const loaded = await reopened.loadConversation(conversationId);
        const hydrated = reopened.hydrateConversation(loaded!.conversation, loaded!.turns);
        expect(hydrated?.chatHistory[1].agentExecution?.state).toBe('interrupted');
        expect(reopened.currentSourceSelection.scope).toBe('notes');
        await expect(reopened.selectSourceScope('web')).resolves.toBe(true);
        const next = reopened.captureRunSourceSelection('new-message');
        expect(next).toMatchObject({ scope: 'web', persistedSelectionRevision: 1,
            userMessageId: 'new-message' });
        expect(next.selectionId).not.toBe(oldChoice.selectionId);
        expect((await store.getTurns(conversationId))).toHaveLength(1);
        await expect(reopened.persistRunningTurn('new task', 'new-message', { role: 'user', content: 'new task',
            runSourceSelection: next })).resolves.toBe(true);
        const saved = await store.getTurns(conversationId);
        expect(saved.map(turn => turn.user.runSourceSelection?.scope)).toEqual(['notes', 'web']);
        expect(saved[0].assistant.agentExecution?.state).toBe('running');
        reopened.dispose();
    });

    it('retains A pending choice across A→B→A and confines its late receipt to A', async () => {
        const { store, manager, create } = setup();
        await manager.initialize();
        const a = await manager.startConversation('A');
        const b = await manager.startConversation('B');
        const view = create();
        await view.getReadyManager();
        view.hydrateConversation(a, []);
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const commit = manager.updateConversationSourceSelection.bind(manager);
        jest.spyOn(manager, 'updateConversationSourceSelection').mockImplementation(async (id, scope) => {
            if (id === a.id) await gate;
            return commit(id, scope);
        });
        const savingA = view.selectSourceScope('web');
        const pendingA = view.captureRunSourceSelection('pending-A');
        view.hydrateConversation(b, []);
        expect(view.currentSourceSelection.scope).toBe('notes');
        await expect(view.selectSourceScope('combined')).resolves.toBe(true);
        expect((await store.getConversation(b.id))?.sourceSelection).toMatchObject({ scope: 'combined', revision: 1 });
        view.hydrateConversation((await store.getConversation(a.id))!, []);
        expect(view.captureRunSourceSelection('send-A')).toMatchObject({
            scope: 'web', selectionId: pendingA.selectionId,
        });
        expect(view.captureRunSourceSelection('send-A')).not.toHaveProperty('persistedSelectionRevision');
        expect(view.isSourceSelectionPending).toBe(true);
        view.hydrateConversation(b, []);
        release();
        await expect(savingA).resolves.toBe(true);
        expect(view.currentSourceSelection.scope).toBe('combined');
        view.hydrateConversation((await store.getConversation(a.id))!, []);
        expect(view.captureRunSourceSelection('after-A')).toMatchObject({ scope: 'web', persistedSelectionRevision: 1 });
        expect(view.isSourceSelectionPending).toBe(false);
        view.dispose();
    });

    it('retains A failed choice and retry identity across A→B→A before the next send', async () => {
        const { store, manager, create } = setup();
        await manager.initialize();
        const a = await manager.startConversation('A');
        const b = await manager.startConversation('B');
        const view = create();
        await view.getReadyManager();
        view.hydrateConversation(a, []);
        jest.spyOn(store, 'updateConversationSourceSelection').mockRejectedValueOnce(new Error('save failed'));
        await expect(view.selectSourceScope('web')).resolves.toBe(false);
        const failedA = view.captureRunSourceSelection('failed-A');
        view.hydrateConversation(b, []);
        view.hydrateConversation((await store.getConversation(a.id))!, []);
        expect(view.currentSourceSelection.scope).toBe('web');
        expect(view.captureRunSourceSelection('retry-A').selectionId).toBe(failedA.selectionId);
        expect(view.captureRunSourceSelection('retry-A')).not.toHaveProperty('persistedSelectionRevision');
        expect(view.didSourceSelectionSaveFail).toBe(true);
        expect(view.isSourceSelectionPending).toBe(true);
        await expect(view.persistRunningTurn('next A', 'retry-A', { role: 'user', content: 'next A' }))
            .resolves.toBe(true);
        expect((await store.getConversation(a.id))?.sourceSelection).toMatchObject({ scope: 'web', revision: 1 });
        view.dispose();
    });

    it('does not let a rev1 promise overwrite rev2 already observed from another view', async () => {
        const { store, manager, create } = setup();
        await manager.initialize();
        const a = await manager.startConversation('A');
        const first = create(), second = create();
        await first.getReadyManager(); await second.getReadyManager();
        first.hydrateConversation(a, []);
        second.hydrateConversation(a, []);
        let releaseOld!: () => void;
        let signalOldCommitted!: () => void;
        const oldReturnGate = new Promise<void>(resolve => { releaseOld = resolve; });
        const oldCommitted = new Promise<void>(resolve => { signalOldCommitted = resolve; });
        const commit = manager.updateConversationSourceSelection.bind(manager);
        jest.spyOn(manager, 'updateConversationSourceSelection').mockImplementation(async (id, scope) => {
            const selection = await commit(id, scope);
            if (scope === 'web') { signalOldCommitted(); await oldReturnGate; }
            return selection;
        });
        const oldSave = first.selectSourceScope('web');
        await oldCommitted;
        await expect(second.selectSourceScope('combined')).resolves.toBe(true);
        expect((await store.getConversation(a.id))?.sourceSelection).toMatchObject({ scope: 'combined', revision: 2 });
        releaseOld();
        await expect(oldSave).resolves.toBe(true);
        expect(first.currentSourceSelection.scope).toBe('combined');
        expect(first.captureRunSourceSelection('next')).toMatchObject({ scope: 'combined', persistedSelectionRevision: 2 });
        first.dispose(); second.dispose();
    });
});
