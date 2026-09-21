import { describe, expect, it } from "@jest/globals";

import { AgentRunCoordinator } from "../src/ai-services/agent-run-coordinator";

describe("AgentRunCoordinator", () => {
    it("keeps capacity at one within each lane", async () => {
        const coordinator = new AgentRunCoordinator();
        const first = await coordinator.acquirePageletTurnLease();
        let secondGranted = false;
        const secondPromise = coordinator.acquirePageletTurnLease().then((lease) => {
            secondGranted = true;
            return lease;
        });

        await Promise.resolve();
        expect(secondGranted).toBe(false);

        first.release();
        const second = await secondPromise;
        expect(secondGranted).toBe(true);
        second.release();
    });

    it("lets Chat and Pagelet progress concurrently while keeping Pagelet FIFO", async () => {
        const coordinator = new AgentRunCoordinator();
        const currentPageletTurn = await coordinator.acquirePageletTurnLease();
        let nextPageletGranted = false;
        const nextPageletPromise = coordinator.acquirePageletTurnLease().then((lease) => {
            nextPageletGranted = true;
            return lease;
        });
        const chat = await coordinator.acquireChatLease();
        expect(nextPageletGranted).toBe(false);

        currentPageletTurn.release();
        const nextPageletTurn = await nextPageletPromise;
        expect(nextPageletGranted).toBe(true);
        chat.release();
        nextPageletTurn.release();
    });

    it("removes an aborted waiter without leaking capacity", async () => {
        const coordinator = new AgentRunCoordinator();
        const currentChat = await coordinator.acquireChatLease();
        const controller = new AbortController();
        const waitingChat = coordinator.acquireChatLease(controller.signal);

        controller.abort();

        await expect(waitingChat).rejects.toMatchObject({ name: "AbortError" });
        currentChat.release();
        const nextChat = await coordinator.acquireChatLease();
        nextChat.release();
    });

    it("rejects an already-aborted acquisition with AbortError", async () => {
        const coordinator = new AgentRunCoordinator();
        const controller = new AbortController();
        controller.abort();

        await expect(coordinator.acquireChatLease(controller.signal)).rejects.toMatchObject({
            name: "AbortError",
        });
    });
});
