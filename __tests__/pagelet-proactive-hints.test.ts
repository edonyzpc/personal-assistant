/* Copyright 2023 edonyzpc */

import { describe, expect, it, beforeEach, afterEach, jest } from "@jest/globals";

import { ProactiveHints } from "../src/pagelet/hints/ProactiveHints";

describe("ProactiveHints", () => {
    function setLocalClock(hour: number, minute = 0) {
        jest.useFakeTimers();
        jest.setSystemTime(new Date(2026, 5, 18, hour, minute, 0, 0));
    }

    afterEach(() => {
        jest.useRealTimers();
    });

    /** Helper: build a default-enabled config with no quiet hours and generous cooldown. */
    function makeHints(overrides: Record<string, unknown> = {}) {
        return new ProactiveHints({
            enabled: true,
            cooldownMinutes: 0,
            quietHours: { enabled: false, start: "22:00", end: "06:00" },
            ...overrides,
        } as any);
    }

    describe("toggle", () => {
        it("toggles enabled state", () => {
            const h = makeHints({ enabled: true });
            expect(h.enabled).toBe(true);
            h.toggle();
            expect(h.enabled).toBe(false);
            h.toggle();
            expect(h.enabled).toBe(true);
        });

        it("returns new state", () => {
            const h = makeHints({ enabled: true });
            expect(h.toggle()).toBe(false);
            expect(h.toggle()).toBe(true);
        });

        it("clears pending when disabled", () => {
            const h = makeHints({ enabled: true });
            h.onInsightsReady(); // sets pending
            expect(h.hasPendingHint).toBe(true);
            h.toggle(); // disables -> clears pending
            expect(h.hasPendingHint).toBe(false);
        });
    });

    describe("onInsightsReady", () => {
        it("returns true when enabled and cooldown elapsed", () => {
            const h = makeHints({ enabled: true, cooldownMinutes: 0 });
            expect(h.onInsightsReady()).toBe(true);
        });

        it("returns false when disabled", () => {
            const h = makeHints({ enabled: false });
            expect(h.onInsightsReady()).toBe(false);
        });

        it("returns false when cooldown not elapsed", () => {
            const h = makeHints({ enabled: true, cooldownMinutes: 60 });
            // Force a lastHintAt by calling onInsightsReady + onHintViewed
            h.onInsightsReady();
            h.onHintViewed(); // sets lastHintAt to Date.now()
            // Immediately call again -- cooldown (60 min) not elapsed
            expect(h.onInsightsReady()).toBe(false);
        });

        it("returns false during quiet hours", () => {
            setLocalClock(12);
            const h = makeHints({
                enabled: true,
                cooldownMinutes: 0,
                quietHours: { enabled: true, start: "00:00", end: "23:59" },
            });
            expect(h.onInsightsReady()).toBe(false);
        });

        it("sets pendingInsights flag", () => {
            const h = makeHints({ enabled: true, cooldownMinutes: 0 });
            expect(h.hasPendingHint).toBe(false);
            h.onInsightsReady();
            expect(h.hasPendingHint).toBe(true);
        });
    });

    describe("onHintViewed", () => {
        it("clears pending flag", () => {
            const h = makeHints();
            h.onInsightsReady();
            expect(h.hasPendingHint).toBe(true);
            h.onHintViewed();
            expect(h.hasPendingHint).toBe(false);
        });

        it("updates lastHintAt timestamp", () => {
            const h = makeHints({ cooldownMinutes: 999 });
            // First insight always passes (lastHintAt null)
            expect(h.onInsightsReady()).toBe(true);
            h.onHintViewed(); // sets lastHintAt = Date.now()
            // Second insight should fail because cooldown is 999 min
            expect(h.onInsightsReady()).toBe(false);
        });
    });

    describe("quiet hours", () => {
        it("same-day range (09:00-17:00): blocks during, allows outside", () => {
            setLocalClock(12);
            expect(makeHints({
                quietHours: { enabled: true, start: "09:00", end: "17:00" },
            }).onInsightsReady()).toBe(false);

            setLocalClock(18);
            expect(makeHints({
                quietHours: { enabled: true, start: "09:00", end: "17:00" },
            }).onInsightsReady()).toBe(true);
        });

        it("midnight-wrap (22:00-06:00): blocks during, allows outside", () => {
            setLocalClock(23);
            expect(makeHints({
                quietHours: { enabled: true, start: "22:00", end: "06:00" },
            }).onInsightsReady()).toBe(false);

            setLocalClock(12);
            expect(makeHints({
                quietHours: { enabled: true, start: "22:00", end: "06:00" },
            }).onInsightsReady()).toBe(true);
        });

        it("disabled quiet hours: never blocks", () => {
            const h = makeHints({
                quietHours: { enabled: false, start: "00:00", end: "23:59" },
            });
            // Even with a range that covers all day, disabled means no blocking
            expect(h.onInsightsReady()).toBe(true);
        });
    });

    describe("cooldown", () => {
        it("respects cooldownMinutes setting", () => {
            const realDateNow = Date.now;
            let fakeNow = 1_000_000_000_000;
            Date.now = () => fakeNow;

            try {
                const h = makeHints({ cooldownMinutes: 10 });
                h.onInsightsReady();
                h.onHintViewed(); // sets lastHintAt

                // Immediately: cooldown not elapsed
                expect(h.onInsightsReady()).toBe(false);

                // Advance 9 minutes: still blocked
                fakeNow += 9 * 60 * 1000;
                expect(h.onInsightsReady()).toBe(false);

                // Advance to 10 minutes total: cooldown elapsed
                fakeNow += 1 * 60 * 1000;
                expect(h.onInsightsReady()).toBe(true);
            } finally {
                Date.now = realDateNow;
            }
        });

        it("first hint always passes (lastHintAt null)", () => {
            const h = makeHints({ cooldownMinutes: 999 });
            // No prior hint viewed, so lastHintAt is null -> cooldown passes
            expect(h.onInsightsReady()).toBe(true);
        });
    });
});
