import { describe, expect, it, jest } from "@jest/globals";
import type { ChatHistoryManager } from "../src/chat/chat-history-manager";
import type { PersistedConversation, PersistedTurn } from "../src/chat/chat-history-store";
import { ConversationPersistence } from "../src/chat/ConversationPersistence";
import type { TimelineEntry } from "../src/chat/types";

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
    it("loads a conversation without committing the active conversation pointer", async () => {
        const manager = makeManager();
        const persistence = makePersistence(manager);

        await expect(persistence.loadConversation("conv-1")).resolves.toEqual({
            conversation,
            turns,
        });

        expect(manager.setActiveConversationId).not.toHaveBeenCalled();
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
