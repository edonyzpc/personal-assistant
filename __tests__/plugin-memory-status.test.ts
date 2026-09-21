import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { debounce, type Debouncer } from "obsidian";

import {
    MemoryStatusNotifier,
    type MemoryStatusDebounceFactory,
} from "../src/plugin/memory-status";

afterEach(() => {
    jest.useRealTimers();
});

describe("MemoryStatusNotifier", () => {
    it("creates the same Obsidian debounce contract and caches one pending update", async () => {
        const schedule = jest.fn<() => void>();
        const cancel = jest.fn<() => void>();
        const debouncer = Object.assign(schedule, { cancel }) as unknown as Debouncer<[], void>;
        let capturedCallback: (() => void) | undefined;
        const createDebounce = jest.fn<MemoryStatusDebounceFactory>((callback) => {
            capturedCallback = callback;
            return debouncer;
        });
        const listener = jest.fn<() => void>();
        const owner = new MemoryStatusNotifier({ createDebounce });
        owner.subscribe(listener);

        owner.schedule();
        owner.schedule();
        owner.cancelPending();

        expect(createDebounce).toHaveBeenCalledTimes(1);
        expect(createDebounce).toHaveBeenCalledWith(expect.any(Function), 300, true);
        expect(schedule).toHaveBeenCalledTimes(2);
        expect(cancel).toHaveBeenCalledTimes(1);

        expect(capturedCallback).toEqual(expect.any(Function));
        capturedCallback?.();
        await Promise.resolve();
        await Promise.resolve();
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("coalesces actual debounce invocations at three hundred milliseconds", async () => {
        jest.useFakeTimers();
        const owner = new MemoryStatusNotifier({ createDebounce: debounce });
        const listener = jest.fn<() => void>();
        owner.subscribe(listener);

        owner.schedule();
        owner.schedule();
        owner.schedule();
        await jest.advanceTimersByTimeAsync(299);
        expect(listener).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(1);
        expect(listener).toHaveBeenCalledTimes(1);

        owner.schedule();
        await jest.advanceTimersByTimeAsync(150);
        owner.cancelPending();
        await jest.advanceTimersByTimeAsync(150);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("removes only the subscribed listener and makes repeated unsubscribe safe", async () => {
        const owner = new MemoryStatusNotifier({ createDebounce: debounce });
        const first = jest.fn<() => void>();
        const second = jest.fn<() => void>();
        const unsubscribeFirst = owner.subscribe(first);
        const unsubscribeFirstAgain = owner.subscribe(first);
        owner.subscribe(second);

        await owner.notifyNow();
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);

        unsubscribeFirst();
        unsubscribeFirstAgain();
        await owner.notifyNow();
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(2);
    });

    it("absorbs synchronous throws and asynchronous rejections without blocking other listeners", async () => {
        const owner = new MemoryStatusNotifier({ createDebounce: debounce });
        const failure = new Error("listener failed");
        const throwing = jest.fn<() => void>(() => {
            throw failure;
        });
        const rejecting = jest.fn<() => Promise<void>>(async () => {
            throw failure;
        });
        const healthy = jest.fn<() => void>();
        owner.subscribe(throwing);
        owner.subscribe(rejecting);
        owner.subscribe(healthy);

        await expect(owner.notifyNow()).resolves.toBeUndefined();
        expect(throwing).toHaveBeenCalledTimes(1);
        expect(rejecting).toHaveBeenCalledTimes(1);
        expect(healthy).toHaveBeenCalledTimes(1);
    });
});
