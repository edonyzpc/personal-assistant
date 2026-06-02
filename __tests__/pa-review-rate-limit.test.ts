/* Copyright 2023 edonyzpc */

/**
 * Track B · B4 unit tests for the Pagelet rate-limit module.
 *
 * Coverage matrix (mapped to SDD §7.2 + D019 / D020 / D021):
 *  - `prune`: sliding hourly window eviction; daily reset boundary.
 *  - `decide`: ok / hr-cap / day-cap outcomes; resumeAt arithmetic.
 *  - `PageletRateLimiter.reserve`: atomic check + commit; persistence.
 *  - `PageletRateLimiter.peek`: non-committing check returns the same
 *    decision but doesn't persist.
 *  - Storage seam: pluggable storage (in-memory + custom mock); cache
 *    behaviour on first load; invalidate().
 *  - Default constants match D020 (10/hr, 100/day).
 *
 * Test isolation: every assertion uses a fresh limiter + injected clock
 * + injected `nextLocalMidnight`. No tests rely on real time or on the
 * runtime's local timezone — the daily-window arithmetic is the same
 * whether you're in UTC, JST, or PT.
 */

import { describe, expect, it } from "@jest/globals";

import {
    InMemoryRateLimitStorage,
    PAGELET_RATE_LIMIT_DEFAULTS,
    PageletRateLimiter,
    decide as decideRateLimit,
    prune as pruneRateLimitState,
    type PageletRateLimitState,
    type PageletRateLimitStorage,
} from "../src/pagelet/pa-review-rate-limit";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function freshState(now: number, dailyResetAt: number): PageletRateLimitState {
    return { hourlyTimestamps: [], dailyCount: 0, dailyResetAt };
}

function midnightAfter(now: number): number {
    // Deterministic "midnight" for tests: 12 hours past `now`. Real
    // production uses local midnight (Date arithmetic); the limiter doesn't
    // care which calculator it uses.
    return now + 12 * HOUR;
}

describe("PAGELET_RATE_LIMIT_DEFAULTS (D020 contract)", () => {
    it("matches the D020 frozen caps (10/hr, 100/day)", () => {
        expect(PAGELET_RATE_LIMIT_DEFAULTS.hourly).toBe(10);
        expect(PAGELET_RATE_LIMIT_DEFAULTS.daily).toBe(100);
        expect(PAGELET_RATE_LIMIT_DEFAULTS.hourMs).toBe(HOUR);
    });

    it("is frozen", () => {
        expect(Object.isFrozen(PAGELET_RATE_LIMIT_DEFAULTS)).toBe(true);
    });
});

describe("prune (sliding hourly + daily reset)", () => {
    it("drops timestamps older than 1 hour", () => {
        const now = 10 * HOUR;
        const state: PageletRateLimitState = {
            hourlyTimestamps: [
                now - 90 * 60 * 1000, // 1.5h old → evict
                now - 30 * 60 * 1000, // 0.5h old → keep
                now,                  // just now → keep
            ],
            dailyCount: 3,
            dailyResetAt: now + DAY,
        };
        pruneRateLimitState(state, now);
        expect(state.hourlyTimestamps).toEqual([now - 30 * 60 * 1000, now]);
    });

    it("keeps timestamp exactly at the cutoff edge as evicted (cutoff is now - 1h)", () => {
        const now = 100_000_000;
        const onHourAgo = now - HOUR;
        const state: PageletRateLimitState = {
            hourlyTimestamps: [onHourAgo, onHourAgo + 1, now],
            dailyCount: 3,
            dailyResetAt: now + DAY,
        };
        pruneRateLimitState(state, now);
        // Strictly older than the 1h cutoff are evicted; exactly 1h ago is
        // also evicted (the gate uses `> cutoff` retain, so equality drops).
        expect(state.hourlyTimestamps).toEqual([onHourAgo + 1, now]);
    });

    it("zeroes the daily counter and rolls reset when now >= dailyResetAt", () => {
        const state: PageletRateLimitState = {
            hourlyTimestamps: [],
            dailyCount: 50,
            dailyResetAt: 1_000, // already in the past
        };
        pruneRateLimitState(state, 2_000, midnightAfter);
        expect(state.dailyCount).toBe(0);
        // midnightAfter(2_000) = 2_000 + 12h
        expect(state.dailyResetAt).toBe(2_000 + 12 * HOUR);
    });

    it("preserves the daily counter while still inside the window", () => {
        const state: PageletRateLimitState = {
            hourlyTimestamps: [],
            dailyCount: 50,
            dailyResetAt: 10_000,
        };
        pruneRateLimitState(state, 5_000, midnightAfter);
        expect(state.dailyCount).toBe(50);
        expect(state.dailyResetAt).toBe(10_000);
    });

    it("does nothing on an already-clean state", () => {
        const state: PageletRateLimitState = {
            hourlyTimestamps: [],
            dailyCount: 0,
            dailyResetAt: 1_000_000,
        };
        pruneRateLimitState(state, 500, midnightAfter);
        expect(state).toEqual({
            hourlyTimestamps: [],
            dailyCount: 0,
            dailyResetAt: 1_000_000,
        });
    });
});

describe("decide (pure decision)", () => {
    it("returns ok when both counters are under their caps", () => {
        const state = freshState(0, DAY);
        expect(decideRateLimit(state, 10, 100, 0)).toEqual({ ok: true });
    });

    it("returns hr-cap when hourly timestamps fill the cap (resumeAt = oldest + 1h + 1ms)", () => {
        const now = 5 * HOUR;
        const timestamps = Array.from({ length: 10 }, (_, i) => now - 30 * 60 * 1000 + i * 100);
        const state: PageletRateLimitState = {
            hourlyTimestamps: timestamps,
            dailyCount: 50,
            dailyResetAt: now + DAY,
        };
        const decision = decideRateLimit(state, 10, 100, now);
        expect(decision.ok).toBe(false);
        if (decision.ok) return;
        expect(decision.reason).toBe("hr-cap");
        // resumeAt = oldest + 1h + 1ms
        expect(decision.resumeAt).toBe(timestamps[0] + HOUR + 1);
    });

    it("returns day-cap when dailyCount == cap (resumeAt = dailyResetAt)", () => {
        const now = HOUR;
        const state: PageletRateLimitState = {
            hourlyTimestamps: [now, now + 100],
            dailyCount: 100,
            dailyResetAt: now + DAY,
        };
        const decision = decideRateLimit(state, 10, 100, now);
        expect(decision.ok).toBe(false);
        if (decision.ok) return;
        expect(decision.reason).toBe("day-cap");
        expect(decision.resumeAt).toBe(now + DAY);
    });

    it("treats hr-cap as higher priority than day-cap when both fired", () => {
        // Construct a state where BOTH caps are simultaneously exceeded;
        // hr-cap fires first because the user-perceived wait time is shorter.
        const now = 10 * HOUR;
        const state: PageletRateLimitState = {
            hourlyTimestamps: Array.from({ length: 10 }, () => now - 1),
            dailyCount: 100,
            dailyResetAt: now + DAY,
        };
        const decision = decideRateLimit(state, 10, 100, now);
        expect(decision.ok).toBe(false);
        if (decision.ok) return;
        expect(decision.reason).toBe("hr-cap");
    });
});

describe("PageletRateLimiter.reserve (atomic check + commit)", () => {
    it("commits a slot on the first reservation and persists state", async () => {
        const storage = new InMemoryRateLimitStorage();
        const limiter = new PageletRateLimiter({
            storage,
            now: () => 1_000,
            nextLocalMidnight: midnightAfter,
        });
        const decision = await limiter.reserve();
        expect(decision.ok).toBe(true);
        expect(storage.saveCalls).toBe(1);
        const persisted = storage.peek();
        expect(persisted?.hourlyTimestamps).toEqual([1_000]);
        expect(persisted?.dailyCount).toBe(1);
    });

    it("rejects the 11th reservation in a 1-hour window with hr-cap", async () => {
        const storage = new InMemoryRateLimitStorage();
        let clock = 1_000;
        const limiter = new PageletRateLimiter({
            storage,
            now: () => clock,
            nextLocalMidnight: midnightAfter,
        });
        for (let i = 0; i < 10; i++) {
            const r = await limiter.reserve();
            expect(r.ok).toBe(true);
            clock += 10; // 10ms between calls; all within the 1h window
        }
        const r11 = await limiter.reserve();
        expect(r11.ok).toBe(false);
        if (r11.ok) return;
        expect(r11.reason).toBe("hr-cap");
        // resumeAt = first call (1000) + 1h + 1ms
        expect(r11.resumeAt).toBe(1_000 + HOUR + 1);
        // 11th rejection MUST NOT consume a slot — daily count stays at 10.
        const persisted = storage.peek();
        expect(persisted?.dailyCount).toBe(10);
        expect(persisted?.hourlyTimestamps.length).toBe(10);
    });

    it("recovers a slot after the oldest timestamp slides out", async () => {
        const storage = new InMemoryRateLimitStorage();
        let clock = 0;
        const limiter = new PageletRateLimiter({
            storage,
            now: () => clock,
            nextLocalMidnight: midnightAfter,
        });
        for (let i = 0; i < 10; i++) {
            clock = i * 100; // first call at t=0, last at t=900
            await limiter.reserve();
        }
        // Immediately after the 10th: rejected.
        clock = 1000;
        expect((await limiter.reserve()).ok).toBe(false);
        // Advance past the first timestamp's 1h window (+1ms for strict >).
        clock = HOUR + 2;
        const r = await limiter.reserve();
        expect(r.ok).toBe(true);
    });

    it("rejects with day-cap once dailyCount reaches the daily cap", async () => {
        const storage = new InMemoryRateLimitStorage();
        let clock = 1_000;
        const limiter = new PageletRateLimiter({
            storage,
            config: { hourlyCap: 1_000, dailyCap: 3 }, // shrink for testability
            now: () => clock,
            nextLocalMidnight: midnightAfter,
        });
        for (let i = 0; i < 3; i++) {
            await limiter.reserve();
            clock += 1;
        }
        const r4 = await limiter.reserve();
        expect(r4.ok).toBe(false);
        if (r4.ok) return;
        expect(r4.reason).toBe("day-cap");
    });

    it("zeroes the daily counter at midnight rollover and accepts again", async () => {
        const storage = new InMemoryRateLimitStorage();
        let clock = 1_000;
        const limiter = new PageletRateLimiter({
            storage,
            config: { hourlyCap: 1_000, dailyCap: 2 },
            now: () => clock,
            nextLocalMidnight: (n: number) => n + 100, // midnight is 100ms away
        });
        await limiter.reserve(); // dailyCount=1
        await limiter.reserve(); // dailyCount=2
        expect((await limiter.reserve()).ok).toBe(false); // capped

        // Jump past the midnight marker.
        clock = 1_200; // past the dailyResetAt of 1_100
        const r = await limiter.reserve();
        expect(r.ok).toBe(true);
        const persisted = storage.peek();
        expect(persisted?.dailyCount).toBe(1); // reset then incremented
    });
});

describe("PageletRateLimiter.peek (non-committing)", () => {
    it("returns the same decision but does NOT persist or increment", async () => {
        const storage = new InMemoryRateLimitStorage();
        const limiter = new PageletRateLimiter({
            storage,
            now: () => 1_000,
            nextLocalMidnight: midnightAfter,
        });
        // First peek loads (defaults), so saveCalls stays 0.
        const decision = await limiter.peek();
        expect(decision.ok).toBe(true);
        expect(storage.saveCalls).toBe(0);
        const persisted = storage.peek();
        // No state mutated — daily count still 0.
        expect(persisted).toBeNull();
    });

    it("agrees with reserve when at the cap (both return hr-cap)", async () => {
        const storage = new InMemoryRateLimitStorage();
        let clock = 1_000;
        const limiter = new PageletRateLimiter({
            storage,
            now: () => clock,
            nextLocalMidnight: midnightAfter,
        });
        for (let i = 0; i < 10; i++) {
            await limiter.reserve();
            clock += 10;
        }
        const peek = await limiter.peek();
        expect(peek.ok).toBe(false);
        if (peek.ok) return;
        expect(peek.reason).toBe("hr-cap");
    });
});

describe("PageletRateLimiter storage seam", () => {
    it("uses an in-memory storage by default (no caller setup required)", async () => {
        const limiter = new PageletRateLimiter({
            now: () => 1,
            nextLocalMidnight: midnightAfter,
        });
        const r = await limiter.reserve();
        expect(r.ok).toBe(true);
    });

    it("loads existing state from storage on the first reservation", async () => {
        // Pre-seed storage with 9 hourly hits so the very next reserve()
        // triggers hr-cap. This proves the limiter doesn't blindly start
        // from a fresh state (which would be a privacy AND security bug —
        // user could close + reopen the plugin to dodge limits).
        const seedTs = [...Array(9)].map((_, i) => i * 100);
        const storage = new InMemoryRateLimitStorage({
            hourlyTimestamps: seedTs,
            dailyCount: 9,
            dailyResetAt: 24 * HOUR,
        });
        const limiter = new PageletRateLimiter({
            storage,
            now: () => 1_000,
            nextLocalMidnight: midnightAfter,
        });
        // 10th reservation slips in (since cap is 10 and we have 9 seeded).
        const r10 = await limiter.reserve();
        expect(r10.ok).toBe(true);
        // 11th rejected.
        const r11 = await limiter.reserve();
        expect(r11.ok).toBe(false);
    });

    it("tolerates a malformed state (defensive sanitiser)", async () => {
        const malformed = {
            hourlyTimestamps: ["bogus", 100, null, NaN, 200] as unknown as number[],
            dailyCount: -1,
            dailyResetAt: "tomorrow" as unknown as number,
        };
        const storage = new InMemoryRateLimitStorage(malformed);
        const limiter = new PageletRateLimiter({
            storage,
            now: () => 50,
            nextLocalMidnight: midnightAfter,
        });
        const r = await limiter.reserve();
        expect(r.ok).toBe(true);
        const snapshot = await limiter.getStateSnapshot();
        // Bogus timestamps dropped; dailyCount normalised to 0; resetAt
        // recomputed via midnight calc.
        expect(snapshot.hourlyTimestamps.every((t) => typeof t === "number")).toBe(true);
        expect(snapshot.dailyCount).toBeGreaterThanOrEqual(0);
    });

    it("accepts an async-storage adapter (mirrors plugin loadData/saveData)", async () => {
        const cell: { value: PageletRateLimitState | null } = { value: null };
        const asyncStorage: PageletRateLimitStorage = {
            async load() {
                return cell.value;
            },
            async save(state) {
                cell.value = state;
            },
        };
        const limiter = new PageletRateLimiter({
            storage: asyncStorage,
            now: () => 100,
            nextLocalMidnight: midnightAfter,
        });
        const r = await limiter.reserve();
        expect(r.ok).toBe(true);
        expect(cell.value?.dailyCount).toBe(1);
    });

    it("invalidate() forces a re-read on the next call (use when storage mutated externally)", async () => {
        let mem: PageletRateLimitState | null = null;
        const storage: PageletRateLimitStorage = {
            load() {
                return mem ? { ...mem, hourlyTimestamps: [...mem.hourlyTimestamps] } : null;
            },
            save(state) {
                mem = state;
            },
        };
        const limiter = new PageletRateLimiter({
            storage,
            now: () => 1_000,
            nextLocalMidnight: midnightAfter,
        });
        await limiter.reserve();
        // Simulate an external mutation: settings UI does "reset usage".
        mem = null;
        limiter.invalidate();
        const snapshot = await limiter.getStateSnapshot();
        // Re-read picks up the cleared storage.
        expect(snapshot.dailyCount).toBe(0);
        expect(snapshot.hourlyTimestamps.length).toBe(0);
    });
});

describe("InMemoryRateLimitStorage (test double + fallback)", () => {
    it("returns null on first load", () => {
        const s = new InMemoryRateLimitStorage();
        expect(s.load()).toBeNull();
    });

    it("round-trips state via save → load", () => {
        const s = new InMemoryRateLimitStorage();
        const seed: PageletRateLimitState = {
            hourlyTimestamps: [1, 2, 3],
            dailyCount: 5,
            dailyResetAt: 100,
        };
        s.save(seed);
        const loaded = s.load();
        expect(loaded).toEqual(seed);
    });

    it("deep-clones on load AND save so external mutation cannot leak in", () => {
        // The limiter mutates state in place; if storage didn't clone, the
        // limiter's mutation would silently update the seed state too.
        const seed: PageletRateLimitState = {
            hourlyTimestamps: [1, 2, 3],
            dailyCount: 5,
            dailyResetAt: 100,
        };
        const s = new InMemoryRateLimitStorage(seed);
        seed.hourlyTimestamps.push(999); // mutate AFTER passing in
        const loaded = s.load();
        expect(loaded?.hourlyTimestamps).toEqual([1, 2, 3]); // unaffected
    });

    it("counts load / save invocations for assertion", () => {
        const s = new InMemoryRateLimitStorage();
        s.load();
        s.load();
        s.save({ hourlyTimestamps: [], dailyCount: 0, dailyResetAt: 0 });
        expect(s.loadCalls).toBe(2);
        expect(s.saveCalls).toBe(1);
    });
});
