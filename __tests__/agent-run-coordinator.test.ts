import { describe, expect, it } from "@jest/globals";
import { setImmediate } from "node:timers";

import { AgentRunCoordinator } from "../src/ai-services/agent-run-coordinator";

const waitForEventLoopPhase = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("AgentRunCoordinator", () => {
    it("lets Chat and Pagelet progress concurrently while keeping Pagelet FIFO at capacity one", async () => {
        const coordinator = new AgentRunCoordinator();
        const currentPageletTurn = await coordinator.acquirePageletTurnLease();
        const nextPageletNames: string[] = [];
        const acquirePagelet = (name: string) =>
            coordinator.acquirePageletTurnLease().then((lease) => {
                nextPageletNames.push(name);
                return lease;
            });
        const firstPageletPromise = acquirePagelet("first");
        const secondPageletPromise = acquirePagelet("second");

        const chat = await coordinator.acquireChatLease();
        expect(nextPageletNames).toEqual([]);

        currentPageletTurn.release();
        const firstPageletTurn = await firstPageletPromise;
        expect(nextPageletNames).toEqual(["first"]);

        // A stale release must not drain the lane and grant another waiter.
        currentPageletTurn.release();
        await waitForEventLoopPhase();
        expect(nextPageletNames).toEqual(["first"]);

        firstPageletTurn.release();
        const secondPageletTurn = await secondPageletPromise;
        expect(nextPageletNames).toEqual(["first", "second"]);

        // The Chat lease remained usable throughout Pagelet serialization.
        chat.release();
        secondPageletTurn.release();
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
