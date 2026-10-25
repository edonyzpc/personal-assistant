/* Copyright 2023 edonyzpc */

import { describe, expect, it, afterEach, jest } from "@jest/globals";

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
            h.recordHintPresented();
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

    });

    describe("configuration updates", () => {
        it("blocks new admission when disabled through updateConfig", () => {
            const h = makeHints({ enabled: true });
            expect(h.onInsightsReady()).toBe(true);

            h.updateConfig({ enabled: false });

            expect(h.enabled).toBe(false);
            expect(h.onInsightsReady()).toBe(false);
            expect(h.delayUntilEligibleMs()).toBeNull();
        });
    });

    describe("recordHintPresented", () => {
        it("starts cooldown only when an admitted hint is presented", () => {
            const h = makeHints({ cooldownMinutes: 999 });
            // First insight always passes (lastHintAt null)
            expect(h.onInsightsReady()).toBe(true);
            expect(h.onInsightsReady()).toBe(true);
            h.recordHintPresented();
            // Second insight should fail because cooldown is 999 min
            expect(h.onInsightsReady()).toBe(false);
        });

        it("records presentation even after generic hints were disabled", () => {
            const h = makeHints({ enabled: true, cooldownMinutes: 60 });
            expect(h.onInsightsReady()).toBe(true);
            h.updateConfig({ enabled: false });

            h.recordHintPresented();
            h.updateConfig({ enabled: true });

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
                h.recordHintPresented();

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
            // No prior hint presented, so lastHintAt is null -> cooldown passes
            expect(h.onInsightsReady()).toBe(true);
        });
    });
});
