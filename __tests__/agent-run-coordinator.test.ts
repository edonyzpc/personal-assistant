import { describe, expect, it } from "@jest/globals";

import { AgentRunCoordinator } from "../src/ai-services/agent-run-coordinator";

describe("AgentRunCoordinator", () => {
    it("keeps capacity at one", async () => {
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

    it("lets queued Chat run before the next Pagelet turn", async () => {
        const coordinator = new AgentRunCoordinator();
        const currentPageletTurn = await coordinator.acquirePageletTurnLease();
        let nextPageletGranted = false;
        const nextPageletPromise = coordinator.acquirePageletTurnLease().then((lease) => {
            nextPageletGranted = true;
            return lease;
        });
        const chatPromise = coordinator.acquireChatLease();

        currentPageletTurn.release();
        const chat = await chatPromise;
        expect(nextPageletGranted).toBe(false);

        chat.release();
        const nextPageletTurn = await nextPageletPromise;
        expect(nextPageletGranted).toBe(true);
        nextPageletTurn.release();
    });

    it("removes an aborted waiter without leaking capacity", async () => {
        const coordinator = new AgentRunCoordinator();
        const currentPageletTurn = await coordinator.acquirePageletTurnLease();
        const controller = new AbortController();
        const waitingChat = coordinator.acquireChatLease(controller.signal);

        controller.abort();

        await expect(waitingChat).rejects.toMatchObject({ name: "AbortError" });
        currentPageletTurn.release();
        const nextPageletTurn = await coordinator.acquirePageletTurnLease();
        nextPageletTurn.release();
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
