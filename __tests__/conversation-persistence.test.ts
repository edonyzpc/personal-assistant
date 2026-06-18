import { describe, expect, it, jest } from "@jest/globals";
import type { ChatHistoryManager } from "../src/chat/chat-history-manager";
import type { PersistedConversation, PersistedTurn } from "../src/chat/chat-history-store";
import { ConversationPersistence } from "../src/chat/ConversationPersistence";

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
});
