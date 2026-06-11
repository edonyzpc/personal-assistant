/* Copyright 2023 edonyzpc */

import { describe, expect, it, beforeEach } from "@jest/globals";

import { PreloadBudget } from "../src/pagelet/preload/PreloadBudget";

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

describe("PreloadBudget", () => {
    let clock: number;
    let budget: PreloadBudget;

    beforeEach(() => {
        clock = 1_000_000_000_000; // arbitrary epoch
        budget = new PreloadBudget(2, 20, () => clock);
    });

    describe("canPreload", () => {
        it("allows when under both caps", () => {
            expect(budget.canPreload()).toBe(true);
        });

        it("blocks when hourly cap reached", () => {
            budget.recordCall();
            budget.recordCall();
            expect(budget.canPreload()).toBe(false);
        });

        it("blocks when daily cap reached", () => {
            const perDayCap = 5;
            budget = new PreloadBudget(10, perDayCap, () => clock);
            for (let i = 0; i < perDayCap; i++) {
                budget.recordCall();
                // advance within the hour so hourly cap doesn't interfere
                clock += 2 * ONE_HOUR_MS;
            }
            expect(budget.canPreload()).toBe(false);
        });

        it("allows after hourly window passes", () => {
            budget.recordCall();
            budget.recordCall();
            expect(budget.canPreload()).toBe(false);

            // advance past the 1-hour window
            clock += ONE_HOUR_MS + 1;
            expect(budget.canPreload()).toBe(true);
        });
    });

    describe("recordCall", () => {
        it("increments call count", () => {
            expect(budget.remaining().hourly).toBe(2);
            budget.recordCall();
            expect(budget.remaining().hourly).toBe(1);
        });

        it("successive calls eventually hit cap", () => {
            budget.recordCall();
            expect(budget.canPreload()).toBe(true);
            budget.recordCall();
            expect(budget.canPreload()).toBe(false);
        });
    });

    describe("remaining", () => {
        it("returns correct hourly and daily remaining", () => {
            const r = budget.remaining();
            expect(r.hourly).toBe(2);
            expect(r.daily).toBe(20);
        });

        it("decrements after recordCall", () => {
            budget.recordCall();
            const r = budget.remaining();
            expect(r.hourly).toBe(1);
            expect(r.daily).toBe(19);
        });
    });

    describe("prune / expiry", () => {
        it("old timestamps are pruned", () => {
            budget.recordCall();
            expect(budget.remaining().daily).toBe(19);

            // advance past 24 hours
            clock += ONE_DAY_MS + 1;
            // prune happens inside remaining() / canPreload()
            expect(budget.remaining().daily).toBe(20);
        });

        it("after 1 hour, hourly budget is restored", () => {
            budget.recordCall();
            budget.recordCall();
            expect(budget.canPreload()).toBe(false);

            clock += ONE_HOUR_MS + 1;
            expect(budget.remaining().hourly).toBe(2);
            expect(budget.canPreload()).toBe(true);
        });

        it("after 24 hours, daily budget is restored", () => {
            // fill daily budget
            const perDayCap = 3;
            budget = new PreloadBudget(100, perDayCap, () => clock);
            for (let i = 0; i < perDayCap; i++) {
                budget.recordCall();
            }
            expect(budget.canPreload()).toBe(false);

            clock += ONE_DAY_MS + 1;
            expect(budget.remaining().daily).toBe(perDayCap);
            expect(budget.canPreload()).toBe(true);
        });
    });
});
