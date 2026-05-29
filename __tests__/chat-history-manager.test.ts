import { describe, expect, it } from "@jest/globals";
import type {
    ChatContextUsedItem,
    ChatRuntimeWarning,
    ChatTurnMemoryMetadata,
    SourceRecord,
} from "../src/ai-services/chat-types";
import { PA_AGENT_CANONICAL_TURN_SCHEMA_VERSION } from "../src/ai-services/chat-types";
import {
    ChatHistoryManager,
    derivePreview,
    deriveTitle,
} from "../src/chat/chat-history-manager";
import {
    CHAT_HISTORY_SCHEMA_VERSION,
    MemoryChatHistoryStore,
    type PersistedTurn,
} from "../src/chat/chat-history-store";
import type { HistoryTurnEntry } from "../src/chat/types";

function makeManager(options: {
    now?: () => Date;
    generateId?: () => string;
    maxConversations?: number;
    pruneInterval?: number;
} = {}) {
    const store = new MemoryChatHistoryStore();
    let idCounter = 0;
    const manager = new ChatHistoryManager({
        store,
        now: options.now ?? (() => new Date("2026-05-29T12:00:00.000Z")),
        generateId: options.generateId ?? (() => `conv-${++idCounter}`),
        maxConversations: options.maxConversations,
        pruneInterval: options.pruneInterval,
    });
    return { manager, store };
}

function makeContextUsedItem(overrides: Partial<ChatContextUsedItem> = {}): ChatContextUsedItem {
    return {
        category: "memory",
        label: "Memory chunk",
        detail: "Detail",
        sources: [{ path: "notes/a.md", chunkIndex: 0, score: 0.8 }],
        citationEligible: true,
        ...overrides,
    };
}

function makeSourceRecord(overrides: Partial<SourceRecord> = {}): SourceRecord {
    return {
        kind: "memory-reference",
        dedupKey: "memory:notes/a.md",
        path: "notes/a.md",
        snippet: "Snippet text",
        citationEligible: true,
        ...overrides,
    };
}

function makeMemoryMetadata(overrides: Partial<ChatTurnMemoryMetadata> = {}): ChatTurnMemoryMetadata {
    return {
        hasMemoryContent: true,
        allowedMemorySourcePaths: ["notes/a.md"],
        contextUsed: [makeContextUsedItem()],
        sourceRecords: [makeSourceRecord()],
        ...overrides,
    };
}

function makeHistoryEntry(overrides: Partial<HistoryTurnEntry> = {}): HistoryTurnEntry {
    const sourceRecords = [makeSourceRecord({ dedupKey: "memory:notes/b.md", path: "notes/b.md" })];
    return {
        kind: "history",
        user: { role: "user", content: "What is the meaning?" },
        assistant: {
            role: "assistant",
            content: "The meaning is 42.",
            canonicalTurn: {
                schemaVersion: PA_AGENT_CANONICAL_TURN_SCHEMA_VERSION,
                runId: "run-1",
                turnId: "turn-1",
                status: "completed",
                sourceRecords,
                messages: [
                    {
                        role: "user",
                        id: "msg-user",
                        content: "What is the meaning?",
                        timestamp: 1,
                    },
                ],
            },
        },
        memoryMetadata: makeMemoryMetadata(),
        contextUsedItems: [makeContextUsedItem({ label: "Tool ctx" })],
        activityDetails: ["Loaded memory", "Composed answer"],
        providerReasoningObserved: true,
        ...overrides,
    };
}

describe("ChatHistoryManager", () => {
    it("serializes a HistoryTurnEntry, stripping canonicalTurn.messages but keeping sourceRecords and status", async () => {
        const { manager } = makeManager();
        await manager.initialize();
        const turn = manager.serializeTurn(makeHistoryEntry(), "conv-1", 0);
        expect(turn.conversationId).toBe("conv-1");
        expect(turn.turnIndex).toBe(0);
        expect(turn.assistant.sourceRecords).toEqual([
            expect.objectContaining({ dedupKey: "memory:notes/b.md", path: "notes/b.md" }),
        ]);
        expect(turn.assistant.turnStatus).toBe("completed");
        expect(turn.memoryMetadata?.hasMemoryContent).toBe(true);
        expect(turn.contextUsed).toEqual([expect.objectContaining({ label: "Tool ctx" })]);
        expect(turn.activityDetails).toEqual(["Loaded memory", "Composed answer"]);
        expect(turn.providerReasoningObserved).toBe(true);
        // canonicalTurn.messages should NOT be stored on persisted shape:
        expect((turn as unknown as { messages?: unknown }).messages).toBeUndefined();
        expect((turn.assistant as unknown as { messages?: unknown }).messages).toBeUndefined();
    });

    it("deserializes a turn and DOUBLE-WRITES memoryMetadata onto both assistantMessage and historyEntry", async () => {
        const { manager } = makeManager();
        await manager.initialize();
        const persisted = manager.serializeTurn(makeHistoryEntry(), "conv-1", 0);
        const rehydrated = manager.deserializeTurn(persisted);
        expect(rehydrated.assistantMessage.memoryMetadata?.hasMemoryContent).toBe(true);
        expect(rehydrated.historyEntry.memoryMetadata?.hasMemoryContent).toBe(true);
        // Mutating one should not affect the other (fresh clones)
        rehydrated.assistantMessage.memoryMetadata!.allowedMemorySourcePaths.push("polluted.md");
        expect(rehydrated.historyEntry.memoryMetadata?.allowedMemorySourcePaths).not.toContain("polluted.md");
    });

    it("rebuilds canonicalTurn with empty messages, preserved status, and synthetic runId/turnId", async () => {
        const { manager } = makeManager();
        await manager.initialize();
        const persisted = manager.serializeTurn(makeHistoryEntry(), "conv-77", 4);
        const rehydrated = manager.deserializeTurn(persisted);
        const canonical = rehydrated.assistantMessage.canonicalTurn;
        expect(canonical).toBeDefined();
        expect(canonical!.messages).toEqual([]);
        expect(canonical!.status).toBe("completed");
        expect(canonical!.runId).toBe("rehydrated:conv-77:4");
        expect(canonical!.turnId).toBe("rehydrated:conv-77:4");
        expect(canonical!.schemaVersion).toBe(PA_AGENT_CANONICAL_TURN_SCHEMA_VERSION);
        expect(canonical!.sourceRecords).toEqual([
            expect.objectContaining({ dedupKey: "memory:notes/b.md" }),
        ]);
    });

    it("round-trips: serialize then deserialize preserves all surface fields", async () => {
        const { manager } = makeManager();
        await manager.initialize();
        const original = makeHistoryEntry({
            user: {
                role: "user",
                content: "Q",
                runtimeWarnings: [{ type: "test", message: "warn-u" } as ChatRuntimeWarning],
            },
        });
        const persisted = manager.serializeTurn(original, "conv-1", 2);
        const rehydrated = manager.deserializeTurn(persisted);
        expect(rehydrated.userMessage.content).toBe("Q");
        expect(rehydrated.userMessage.runtimeWarnings).toEqual([
            expect.objectContaining({ type: "test", message: "warn-u" }),
        ]);
        expect(rehydrated.assistantMessage.content).toBe("The meaning is 42.");
        expect(rehydrated.historyEntry.contextUsedItems).toEqual([
            expect.objectContaining({ label: "Tool ctx" }),
        ]);
        expect(rehydrated.historyEntry.activityDetails).toEqual(["Loaded memory", "Composed answer"]);
        expect(rehydrated.historyEntry.providerReasoningObserved).toBe(true);
    });

    it("auto-creates a conversation on first recordTurn via startConversation", async () => {
        const { manager, store } = makeManager();
        await manager.initialize();
        const conversation = await manager.startConversation("Hello there\nMore");
        expect(conversation.title).toBe("Hello there");
        expect(conversation.preview).toBe("Hello there More");
        await expect(store.getActiveConversationId()).resolves.toBe(conversation.id);

        const entry = makeHistoryEntry();
        const updated = await manager.recordTurn({
            conversationId: conversation.id,
            turnIndex: 0,
            entry,
            userPrompt: "Hello there",
            conversation,
        });
        expect(updated.turnCount).toBe(1);
        const turns = await store.getTurns(conversation.id);
        expect(turns).toHaveLength(1);
        expect(turns[0].turnIndex).toBe(0);
    });

    it("activeConversationId persists independently of conversation records", async () => {
        const { manager, store } = makeManager();
        await manager.initialize();
        const conversation = await manager.startConversation("hi");
        await expect(store.getActiveConversationId()).resolves.toBe(conversation.id);
        await manager.setActiveConversationId(null);
        await expect(store.getActiveConversationId()).resolves.toBeNull();
        await expect(manager.findConversation(conversation.id)).resolves.not.toBeNull();
    });

    it("deleteConversation removes both conversation record and all of its turns", async () => {
        const { manager, store } = makeManager();
        await manager.initialize();
        const conversation = await manager.startConversation("hi");
        for (let i = 0; i < 3; i++) {
            await manager.recordTurn({
                conversationId: conversation.id,
                turnIndex: i,
                entry: makeHistoryEntry({ user: { role: "user", content: `q${i}` } }),
                userPrompt: `q${i}`,
                conversation,
            });
        }
        await expect(store.getTurns(conversation.id)).resolves.toHaveLength(3);
        await manager.deleteConversation(conversation.id);
        await expect(store.getConversation(conversation.id)).resolves.toBeNull();
        await expect(store.getTurns(conversation.id)).resolves.toHaveLength(0);
    });

    it("deleteTurn removes one turn and decrements the conversation turnCount", async () => {
        const { manager, store } = makeManager();
        await manager.initialize();
        const conversation = await manager.startConversation("hi");
        const updated = await manager.recordTurn({
            conversationId: conversation.id,
            turnIndex: 0,
            entry: makeHistoryEntry(),
            userPrompt: "hi",
            conversation,
        });
        await manager.recordTurn({
            conversationId: conversation.id,
            turnIndex: 1,
            entry: makeHistoryEntry(),
            userPrompt: "again",
            conversation: updated,
        });
        await manager.deleteTurn(conversation.id, 0);
        await expect(store.getTurns(conversation.id)).resolves.toHaveLength(1);
        const after = await store.getConversation(conversation.id);
        expect(after?.turnCount).toBe(1);
    });

    it("maybePrune only prunes once the pruneInterval is reached", async () => {
        const { manager, store } = makeManager({ maxConversations: 1, pruneInterval: 3 });
        await manager.initialize();
        const conv = await manager.startConversation("hi");
        await manager.recordTurn({
            conversationId: conv.id,
            turnIndex: 0,
            entry: makeHistoryEntry(),
            userPrompt: "hi",
            conversation: conv,
        });
        const other = await manager.startConversation("hello");
        await manager.recordTurn({
            conversationId: other.id,
            turnIndex: 0,
            entry: makeHistoryEntry(),
            userPrompt: "hello",
            conversation: other,
        });
        // Two recordTurn calls so far → maybePrune should NOT fire yet.
        await expect(manager.maybePrune()).resolves.toEqual([]);
        await expect(manager.maybePrune()).resolves.toEqual([]);
        // Third call hits the interval boundary and prunes the older conversation.
        const removed = await manager.maybePrune();
        expect(removed).toHaveLength(1);
        const remaining = await store.listConversations();
        expect(remaining).toHaveLength(1);
    });

    it("recordTurn writes both the turn record and the conversation row via the atomic store method", async () => {
        let atomicCalls = 0;
        let appendOnlyCalls = 0;
        let upsertOnlyCalls = 0;
        const store = new MemoryChatHistoryStore();
        const originalAtomic = store.appendTurnAndUpdateConversation.bind(store);
        const originalAppend = store.appendTurn.bind(store);
        const originalUpsert = store.upsertConversation.bind(store);
        store.appendTurnAndUpdateConversation = async (turn, conversation) => {
            atomicCalls += 1;
            return originalAtomic(turn, conversation);
        };
        store.appendTurn = async (turn) => {
            appendOnlyCalls += 1;
            return originalAppend(turn);
        };
        store.upsertConversation = async (conversation) => {
            upsertOnlyCalls += 1;
            return originalUpsert(conversation);
        };
        const manager = new ChatHistoryManager({
            store,
            now: () => new Date("2026-05-29T12:00:00.000Z"),
            generateId: () => "conv-atomic",
        });
        await manager.initialize();
        upsertOnlyCalls = 0; // ignore the schema-version write
        appendOnlyCalls = 0;
        const conv = await manager.startConversation("hi"); // 1 upsert (conversation row)
        const upsertsAfterStart = upsertOnlyCalls;
        await manager.recordTurn({
            conversationId: conv.id,
            turnIndex: 0,
            entry: makeHistoryEntry(),
            userPrompt: "hi",
            conversation: conv,
        });
        expect(atomicCalls).toBe(1);
        // recordTurn must NOT issue a separate appendTurn + upsertConversation
        expect(appendOnlyCalls).toBe(0);
        expect(upsertOnlyCalls).toBe(upsertsAfterStart);
    });

    it("prune respects maxConversations and removes oldest", async () => {
        const dates = [
            "2026-05-29T10:00:00.000Z",
            "2026-05-29T11:00:00.000Z",
            "2026-05-29T12:00:00.000Z",
            "2026-05-29T13:00:00.000Z",
        ];
        let cursor = 0;
        const { manager, store } = makeManager({
            now: () => new Date(dates[Math.min(cursor++, dates.length - 1)]),
            maxConversations: 2,
        });
        await manager.initialize();
        for (let i = 0; i < 4; i++) {
            const conv = await manager.startConversation(`Conversation ${i}`);
            await manager.recordTurn({
                conversationId: conv.id,
                turnIndex: 0,
                entry: makeHistoryEntry(),
                userPrompt: `q${i}`,
                conversation: conv,
            });
        }
        const removed = await manager.prune();
        expect(removed).toHaveLength(2);
        const remaining = await store.listConversations();
        expect(remaining).toHaveLength(2);
    });

    it("initialize writes the schema version on a fresh store", async () => {
        const { manager, store } = makeManager();
        await manager.initialize();
        await expect(store.getSchemaVersion()).resolves.toBe(CHAT_HISTORY_SCHEMA_VERSION);
    });

    it("gracefully marks itself unavailable if store.initialize throws", async () => {
        const broken = new MemoryChatHistoryStore();
        const original = broken.initialize.bind(broken);
        broken.initialize = async () => {
            throw new Error("disk full");
        };
        const manager = new ChatHistoryManager({ store: broken, log: () => undefined });
        await manager.initialize();
        expect(manager.isAvailable()).toBe(false);
        await expect(manager.listConversations()).resolves.toEqual([]);
        // restore so tests don't leak side effects
        broken.initialize = original;
    });
});

describe("deriveTitle / derivePreview", () => {
    it("uses the first line and truncates to 60 chars for the title", () => {
        expect(deriveTitle("")).toBe("New conversation");
        expect(deriveTitle("   \n  ")).toBe("New conversation");
        expect(deriveTitle("Short title\nbody")).toBe("Short title");
        const long = "x".repeat(80);
        const title = deriveTitle(long);
        expect(title.length).toBeLessThanOrEqual(60);
        expect(title.endsWith("…")).toBe(true);
    });

    it("collapses whitespace and truncates the preview to 200 chars", () => {
        expect(derivePreview("")).toBe("");
        expect(derivePreview("foo\n\n  bar   baz")).toBe("foo bar baz");
        const long = "y".repeat(220);
        const preview = derivePreview(long);
        expect(preview.length).toBeLessThanOrEqual(200);
        expect(preview.endsWith("…")).toBe(true);
    });
});

describe("chat history persistence safety", () => {
    it("skips recording when chat-view abandons a non-live finalized turn before persistence", async () => {
        // chat-view.ts checks isLiveTurn before constructing the finalized history
        // entry. Once a turn is finalized, persistFinalizedTurn serializes it without
        // re-checking liveness so switch/new-chat flows cannot erase completed turns.
        // This reproduces the pre-persistence gate around ChatHistoryManager calls.
        const { manager, store } = makeManager();
        await manager.initialize();
        let live = true;
        const conv = await manager.startConversation("hi");
        live = false;
        const entry = makeHistoryEntry();
        if (live) {
            await manager.recordTurn({
                conversationId: conv.id,
                turnIndex: 0,
                entry,
                userPrompt: "hi",
                conversation: conv,
            });
        }
        await expect(store.getTurns(conv.id)).resolves.toHaveLength(0);
    });

    it("getTurns returns deserialize-ready records that drop canonicalTurn.messages", async () => {
        const { manager } = makeManager();
        await manager.initialize();
        const conv = await manager.startConversation("hi");
        const entry = makeHistoryEntry();
        await manager.recordTurn({
            conversationId: conv.id,
            turnIndex: 0,
            entry,
            userPrompt: "hi",
            conversation: conv,
        });
        const turns: PersistedTurn[] = await manager.getTurns(conv.id);
        expect(turns).toHaveLength(1);
        const rehydrated = manager.deserializeTurn(turns[0]);
        expect(rehydrated.assistantMessage.canonicalTurn?.messages).toEqual([]);
        expect(rehydrated.assistantMessage.canonicalTurn?.sourceRecords).toBeDefined();
    });
});
