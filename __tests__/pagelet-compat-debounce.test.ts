/* Copyright 2023 edonyzpc */

/**
 * Track B · B5 unit tests for debounce + idempotency (R2).
 *
 * Coverage matrix:
 *  - Constants surfaced match the SDD / brief defaults.
 *  - Lifecycle: scheduled → running → completed, with the SAME promise
 *    returned for coalesced / in-flight / TTL-cached callers.
 *  - TTL eviction: requests outside the window re-schedule a fresh run.
 *  - Failures: errors are NOT cached — the next request re-fires.
 *  - `clear()` rejects pending schedules with `PageletCoalescerClearedError`.
 *  - `peek` / `size` return consistent snapshots without mutating state.
 *  - Distinct keys are independent (one note's run does not satisfy another).
 *
 * We deliberately avoid `jest.useFakeTimers` — the coalescer accepts a
 * `setTimer` / `clearTimer` seam, so manual control yields cleaner
 * assertions and faster suites.
 */

import { describe, expect, it } from "@jest/globals";

import {
    PAGELET_DEFAULT_DEBOUNCE_MS,
    PAGELET_DEFAULT_IDEMPOTENCY_TTL_MS,
    PageletCoalescerClearedError,
    PageletReviewCoalescer,
} from "../src/pagelet/compat/debounce";

// ---------------------------------------------------------------------------
// Test fixture: a manual timer harness — `flush()` fires the most recent
// pending callback exactly once, mirroring how the real `setTimeout` would
// resolve when the debounce window expires.
// ---------------------------------------------------------------------------

interface TimerHandle {
    id: number;
    cb: () => void;
    cleared: boolean;
}

function makeManualTimers() {
    const handles: TimerHandle[] = [];
    let nextId = 1;
    const setTimer = (cb: () => void): unknown => {
        const handle: TimerHandle = { id: nextId++, cb, cleared: false };
        handles.push(handle);
        return handle;
    };
    const clearTimer = (handle: unknown): void => {
        (handle as TimerHandle).cleared = true;
    };
    const pending = (): TimerHandle[] => handles.filter((h) => !h.cleared);
    const flushLast = (): void => {
        const live = pending();
        if (live.length === 0) throw new Error("no pending timer to flush");
        const h = live[live.length - 1];
        h.cleared = true;
        h.cb();
    };
    return { setTimer, clearTimer, pending, flushLast };
}

function makeClock(start = 1_000) {
    let t = start;
    return {
        now: (): number => t,
        advance: (ms: number): void => {
            t += ms;
        },
    };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("PAGELET_DEFAULT_* constants", () => {
    it("debounce default = 300ms per SDD §6.1 R2", () => {
        expect(PAGELET_DEFAULT_DEBOUNCE_MS).toBe(300);
    });

    it("idempotency TTL default = 30_000ms per B5 brief", () => {
        expect(PAGELET_DEFAULT_IDEMPOTENCY_TTL_MS).toBe(30_000);
    });
});

// ---------------------------------------------------------------------------
// Lifecycle: scheduled → running → completed
// ---------------------------------------------------------------------------

describe("PageletReviewCoalescer — scheduling + coalesce", () => {
    it("schedules a fresh runner on the first request", () => {
        const timers = makeManualTimers();
        const clock = makeClock();
        const coalescer = new PageletReviewCoalescer<string>({
            setTimer: timers.setTimer,
            clearTimer: timers.clearTimer,
            now: clock.now,
        });

        let runCount = 0;
        const promise = coalescer.request(
            { notePath: "a.md", contentHash: "h1" },
            async () => {
                runCount += 1;
                return "result-1";
            },
        );

        expect(promise).toBeInstanceOf(Promise);
        expect(coalescer.size()).toBe(1);
        expect(coalescer.peek({ notePath: "a.md", contentHash: "h1" })?.state).toBe("scheduled");
        // Timer is pending — runner not invoked yet.
        expect(timers.pending()).toHaveLength(1);
        expect(runCount).toBe(0);
    });

    it("returns the same promise for repeat requests during the debounce window", () => {
        const timers = makeManualTimers();
        const coalescer = new PageletReviewCoalescer<string>({
            setTimer: timers.setTimer,
            clearTimer: timers.clearTimer,
        });

        let runCount = 0;
        const key = { notePath: "a.md", contentHash: "h1" };
        const p1 = coalescer.request(key, async () => {
            runCount += 1;
            return "first";
        });
        const p2 = coalescer.request(key, async () => {
            runCount += 1;
            return "SECOND-should-not-run";
        });
        const p3 = coalescer.request(key, async () => "THIRD");

        // Same key → exact same promise instance.
        expect(p1).toBe(p2);
        expect(p2).toBe(p3);
        // Only ONE timer scheduled across the three requests.
        expect(timers.pending()).toHaveLength(1);
        // Coalescer holds a single entry.
        expect(coalescer.size()).toBe(1);
        // Original runner is the one we'll invoke; later runners are dropped.
        expect(runCount).toBe(0);
    });

    it("transitions to running then completed and resolves the original promise", async () => {
        const timers = makeManualTimers();
        const clock = makeClock();
        const coalescer = new PageletReviewCoalescer<string>({
            setTimer: timers.setTimer,
            clearTimer: timers.clearTimer,
            now: clock.now,
        });

        const promise = coalescer.request(
            { notePath: "a.md", contentHash: "h1" },
            async () => "done!",
        );
        // Fire the debounce timer — runner is invoked synchronously, but
        // its returned promise resolves on the next microtask tick.
        clock.advance(PAGELET_DEFAULT_DEBOUNCE_MS);
        timers.flushLast();
        // Wait for the resolution chain to settle.
        await expect(promise).resolves.toBe("done!");
        // Entry is now in the "completed" state for TTL caching.
        const snap = coalescer.peek({ notePath: "a.md", contentHash: "h1" });
        expect(snap?.state).toBe("completed");
        expect(snap?.value).toBe("done!");
        expect(snap?.completedAt).toBe(clock.now());
    });
});

// ---------------------------------------------------------------------------
// In-flight dedup
// ---------------------------------------------------------------------------

describe("PageletReviewCoalescer — in-flight dedup", () => {
    it("returns the same promise while the runner is still in-flight", async () => {
        const timers = makeManualTimers();
        const coalescer = new PageletReviewCoalescer<string>({
            setTimer: timers.setTimer,
            clearTimer: timers.clearTimer,
        });

        // Latch a runner that we control via an outer promise.
        let resolveRunner!: (v: string) => void;
        const runnerPromise = new Promise<string>((res) => {
            resolveRunner = res;
        });
        const key = { notePath: "a.md", contentHash: "h1" };
        const p1 = coalescer.request(key, () => runnerPromise);
        timers.flushLast();
        // Now in "running" state.
        expect(coalescer.peek(key)?.state).toBe("running");

        // A second request during running should yield the same promise.
        const p2 = coalescer.request(key, async () => "should-not-run");
        expect(p1).toBe(p2);

        // Resolving the runner satisfies both callers.
        resolveRunner("only-result");
        await expect(p1).resolves.toBe("only-result");
        await expect(p2).resolves.toBe("only-result");
    });
});

// ---------------------------------------------------------------------------
// TTL caching
// ---------------------------------------------------------------------------

describe("PageletReviewCoalescer — TTL caching", () => {
    it("returns the cached promise for repeat requests inside the TTL", async () => {
        const timers = makeManualTimers();
        const clock = makeClock();
        const coalescer = new PageletReviewCoalescer<string>({
            setTimer: timers.setTimer,
            clearTimer: timers.clearTimer,
            now: clock.now,
            ttlMs: 30_000,
        });

        let runCount = 0;
        const key = { notePath: "a.md", contentHash: "h1" };
        const p1 = coalescer.request(key, async () => {
            runCount += 1;
            return "v1";
        });
        clock.advance(PAGELET_DEFAULT_DEBOUNCE_MS);
        timers.flushLast();
        await p1;
        expect(runCount).toBe(1);

        // Within the TTL window — the cached promise is returned, runner unused.
        clock.advance(10_000);
        const p2 = coalescer.request(key, async () => {
            runCount += 1;
            return "v2-should-not-run";
        });
        await expect(p2).resolves.toBe("v1");
        expect(runCount).toBe(1);
        expect(timers.pending()).toHaveLength(0);
    });

    it("re-schedules a fresh run when the TTL has expired", async () => {
        const timers = makeManualTimers();
        const clock = makeClock();
        const coalescer = new PageletReviewCoalescer<string>({
            setTimer: timers.setTimer,
            clearTimer: timers.clearTimer,
            now: clock.now,
            ttlMs: 1_000,
        });

        const key = { notePath: "a.md", contentHash: "h1" };
        const p1 = coalescer.request(key, async () => "v1");
        clock.advance(PAGELET_DEFAULT_DEBOUNCE_MS);
        timers.flushLast();
        await p1;

        // Push past the TTL.
        clock.advance(2_000);
        const p2 = coalescer.request(key, async () => "v2");
        expect(p2).not.toBe(p1);
        // New schedule produced a new timer.
        expect(timers.pending()).toHaveLength(1);
        clock.advance(PAGELET_DEFAULT_DEBOUNCE_MS);
        timers.flushLast();
        await expect(p2).resolves.toBe("v2");
    });
});

// ---------------------------------------------------------------------------
// Distinct keys are independent
// ---------------------------------------------------------------------------

describe("PageletReviewCoalescer — key independence", () => {
    it("treats different notePath as separate requests", () => {
        const timers = makeManualTimers();
        const coalescer = new PageletReviewCoalescer<string>({
            setTimer: timers.setTimer,
            clearTimer: timers.clearTimer,
        });

        const pA = coalescer.request(
            { notePath: "a.md", contentHash: "h1" },
            async () => "A",
        );
        const pB = coalescer.request(
            { notePath: "b.md", contentHash: "h1" },
            async () => "B",
        );
        expect(pA).not.toBe(pB);
        expect(coalescer.size()).toBe(2);
        expect(timers.pending()).toHaveLength(2);
    });

    it("treats different contentHash for the same path as separate requests", () => {
        const timers = makeManualTimers();
        const coalescer = new PageletReviewCoalescer<string>({
            setTimer: timers.setTimer,
            clearTimer: timers.clearTimer,
        });

        const p1 = coalescer.request(
            { notePath: "a.md", contentHash: "h1" },
            async () => "v1",
        );
        const p2 = coalescer.request(
            { notePath: "a.md", contentHash: "h2" },
            async () => "v2",
        );
        expect(p1).not.toBe(p2);
        expect(coalescer.size()).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Error handling — failures are NOT cached
// ---------------------------------------------------------------------------

describe("PageletReviewCoalescer — error handling", () => {
    it("rejects the promise and drops the entry so the next request retries", async () => {
        const timers = makeManualTimers();
        const coalescer = new PageletReviewCoalescer<string>({
            setTimer: timers.setTimer,
            clearTimer: timers.clearTimer,
        });

        const key = { notePath: "a.md", contentHash: "h1" };
        let attempt = 0;
        const p1 = coalescer.request(key, async () => {
            attempt += 1;
            throw new Error("boom");
        });
        timers.flushLast();
        await expect(p1).rejects.toThrow("boom");
        // Entry should be dropped — failed runs are not cached.
        expect(coalescer.peek(key)).toBeNull();

        // A retry must invoke the runner again.
        const p2 = coalescer.request(key, async () => {
            attempt += 1;
            return "ok";
        });
        timers.flushLast();
        await expect(p2).resolves.toBe("ok");
        expect(attempt).toBe(2);
    });

    it("handles a synchronously-throwing runner — promise rejects + entry is dropped", async () => {
        // Regression: a non-async runner that throws BEFORE returning a
        // promise must not strand the entry in "running". A bare
        // `runner().then(...)` would let the sync throw escape ahead of
        // the rejection handler, leaving the entry pending forever and
        // causing the next request to dedup onto a never-settling promise.
        const timers = makeManualTimers();
        const coalescer = new PageletReviewCoalescer<string>({
            setTimer: timers.setTimer,
            clearTimer: timers.clearTimer,
        });

        const key = { notePath: "a.md", contentHash: "h1" };
        // Cast through unknown to satisfy the typed runner signature while
        // still exercising the sync-throw path the bug allowed in practice
        // (TS does not stop a JS caller from passing such a function).
        const syncThrowRunner = (() => { throw new Error("sync boom"); }) as unknown as () => Promise<string>;
        const p1 = coalescer.request(key, syncThrowRunner);
        timers.flushLast();
        await expect(p1).rejects.toThrow("sync boom");
        // Entry must be dropped — otherwise the next request would dedup
        // onto a dead promise.
        expect(coalescer.peek(key)).toBeNull();

        // Retry with a real runner must produce a fresh promise.
        let retried = false;
        const p2 = coalescer.request(key, async () => {
            retried = true;
            return "ok";
        });
        expect(p2).not.toBe(p1);
        timers.flushLast();
        await expect(p2).resolves.toBe("ok");
        expect(retried).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// clear() semantics
// ---------------------------------------------------------------------------

describe("PageletReviewCoalescer — clear()", () => {
    it("rejects scheduled requests with PageletCoalescerClearedError", async () => {
        const timers = makeManualTimers();
        const coalescer = new PageletReviewCoalescer<string>({
            setTimer: timers.setTimer,
            clearTimer: timers.clearTimer,
        });

        const promise = coalescer.request(
            { notePath: "a.md", contentHash: "h1" },
            async () => "never",
        );
        const pendingBefore = timers.pending().length;
        coalescer.clear();
        // Pending timer is cleared.
        expect(timers.pending().length).toBeLessThan(pendingBefore);
        await expect(promise).rejects.toBeInstanceOf(PageletCoalescerClearedError);
        expect(coalescer.size()).toBe(0);
    });

    it("drops completed entries so the next request schedules anew", async () => {
        const timers = makeManualTimers();
        const coalescer = new PageletReviewCoalescer<string>({
            setTimer: timers.setTimer,
            clearTimer: timers.clearTimer,
        });

        const key = { notePath: "a.md", contentHash: "h1" };
        const p1 = coalescer.request(key, async () => "v1");
        timers.flushLast();
        await p1;
        expect(coalescer.peek(key)?.state).toBe("completed");

        coalescer.clear();
        expect(coalescer.size()).toBe(0);

        const p2 = coalescer.request(key, async () => "v2");
        expect(p2).not.toBe(p1);
        timers.flushLast();
        await expect(p2).resolves.toBe("v2");
    });

    it("does not affect in-flight runners; they still resolve but are not cached", async () => {
        const timers = makeManualTimers();
        const coalescer = new PageletReviewCoalescer<string>({
            setTimer: timers.setTimer,
            clearTimer: timers.clearTimer,
        });
        let resolveRunner!: (v: string) => void;
        const runnerPromise = new Promise<string>((res) => {
            resolveRunner = res;
        });
        const key = { notePath: "a.md", contentHash: "h1" };
        const p1 = coalescer.request(key, () => runnerPromise);
        timers.flushLast();
        // Running.
        expect(coalescer.peek(key)?.state).toBe("running");

        coalescer.clear();
        // No cached entry after clear; the in-flight promise still completes.
        expect(coalescer.peek(key)).toBeNull();
        resolveRunner("hi");
        await expect(p1).resolves.toBe("hi");
        // Even after resolution there's nothing cached — clear pre-empted it.
        expect(coalescer.peek(key)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// peek / size — snapshot semantics
// ---------------------------------------------------------------------------

describe("PageletReviewCoalescer — peek + size", () => {
    it("peek returns null for unknown keys without mutating state", () => {
        const coalescer = new PageletReviewCoalescer<string>();
        expect(coalescer.peek({ notePath: "x.md", contentHash: "z" })).toBeNull();
        expect(coalescer.size()).toBe(0);
    });

    it("peek snapshot reflects the right state transitions", async () => {
        const timers = makeManualTimers();
        const clock = makeClock();
        const coalescer = new PageletReviewCoalescer<string>({
            setTimer: timers.setTimer,
            clearTimer: timers.clearTimer,
            now: clock.now,
        });
        const key = { notePath: "a.md", contentHash: "h1" };
        const p = coalescer.request(key, async () => "v");
        expect(coalescer.peek(key)?.state).toBe("scheduled");
        expect(coalescer.peek(key)?.completedAt).toBeNull();
        expect(coalescer.peek(key)?.value).toBeNull();

        timers.flushLast();
        // The running snapshot may be captured between the sync transition
        // and the microtask resolution. We can't safely race for it here;
        // jumping straight to completed is the deterministic check.
        await p;
        const snap = coalescer.peek(key);
        expect(snap?.state).toBe("completed");
        expect(snap?.value).toBe("v");
        expect(snap?.completedAt).toBe(clock.now());
    });
});

// ---------------------------------------------------------------------------
// PageletCoalescerClearedError — identity / message
// ---------------------------------------------------------------------------

describe("PageletCoalescerClearedError", () => {
    it("has the correct name + message for downstream UX detection", () => {
        const err = new PageletCoalescerClearedError();
        expect(err.name).toBe("PageletCoalescerClearedError");
        expect(err.message).toMatch(/cleared/i);
        expect(err).toBeInstanceOf(Error);
    });
});
