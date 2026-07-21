/* Copyright 2023 edonyzpc */

import { describe, expect, it, beforeEach } from "@jest/globals";

import {
    InMemoryPreloadBudgetStorage,
    LocalStoragePreloadBudgetStorage,
    PreloadBudget,
    type PreloadBudgetStorage,
} from "../src/pagelet/preload/PreloadBudget";

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

function makeLocalStorage(): Storage {
    const values = new Map<string, string>();
    return {
        get length() { return values.size; },
        clear: () => values.clear(),
        getItem: (key) => values.get(key) ?? null,
        key: (index) => [...values.keys()][index] ?? null,
        removeItem: (key) => { values.delete(key); },
        setItem: (key, value) => { values.set(key, value); },
    };
}

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

    describe("tryReserveCall", () => {
        it("counts actual attempts before their outcome and rejects at the cap", () => {
            expect(budget.tryReserveCall()).toBe(true);
            expect(budget.tryReserveCall()).toBe(true);
            expect(budget.tryReserveCall()).toBe(false);
            expect(budget.remaining()).toEqual({ hourly: 0, daily: 18 });
        });

        it("persists usage across reconstructed plugin budgets", () => {
            const storage = new InMemoryPreloadBudgetStorage();
            const firstInstance = new PreloadBudget(2, 20, () => clock, storage);
            expect(firstInstance.tryReserveCall()).toBe(true);
            expect(firstInstance.tryReserveCall()).toBe(true);

            const reloadedInstance = new PreloadBudget(2, 20, () => clock, storage);
            expect(reloadedInstance.tryReserveCall()).toBe(false);
            expect(reloadedInstance.remaining()).toEqual({ hourly: 0, daily: 18 });
        });

        it("coordinates synchronous reservations across live instances", () => {
            const storage = new InMemoryPreloadBudgetStorage();
            const firstInstance = new PreloadBudget(1, 20, () => clock, storage);
            const secondInstance = new PreloadBudget(1, 20, () => clock, storage);

            expect(firstInstance.tryReserveCall()).toBe(true);
            expect(secondInstance.tryReserveCall()).toBe(false);
        });

        it("round-trips the production JSON storage adapter", () => {
            const localStorage = makeLocalStorage();
            const firstStorage = new LocalStoragePreloadBudgetStorage(
                () => localStorage,
                "vault-budget",
            );
            expect(new PreloadBudget(1, 20, () => clock, firstStorage).tryReserveCall()).toBe(true);

            const reloadedStorage = new LocalStoragePreloadBudgetStorage(
                () => localStorage,
                "vault-budget",
            );
            expect(new PreloadBudget(1, 20, () => clock, reloadedStorage).tryReserveCall()).toBe(false);
        });

        it("fails closed when persistent storage is unavailable or malformed", () => {
            const unavailable: PreloadBudgetStorage = {
                load: () => { throw new Error("unavailable"); },
                save: () => { throw new Error("unavailable"); },
            };
            const malformed: PreloadBudgetStorage = {
                load: () => ({ version: 1, callTimestamps: [Number.NaN] }),
                save: () => { /* noop */ },
            };

            expect(new PreloadBudget(2, 20, () => clock, unavailable).tryReserveCall()).toBe(false);
            expect(new PreloadBudget(2, 20, () => clock, malformed).tryReserveCall()).toBe(false);
        });

        it("does not report a reservation when persistence fails", () => {
            const saveFails: PreloadBudgetStorage = {
                load: () => null,
                save: () => { throw new Error("quota"); },
            };
            const persistentBudget = new PreloadBudget(2, 20, () => clock, saveFails);

            expect(persistentBudget.tryReserveCall()).toBe(false);
            expect(persistentBudget.remaining()).toEqual({ hourly: 2, daily: 20 });
        });

        it("rolls back a provisional persisted slot when no provider call starts", () => {
            const storage = new InMemoryPreloadBudgetStorage();
            const persistentBudget = new PreloadBudget(2, 20, () => clock, storage);
            const reservation = persistentBudget.reserveCallLease();

            expect(reservation).not.toBe(false);
            expect(persistentBudget.remaining()).toEqual({ hourly: 1, daily: 19 });
            if (reservation) reservation.rollback();

            expect(persistentBudget.remaining()).toEqual({ hourly: 2, daily: 20 });
            expect(new PreloadBudget(2, 20, () => clock, storage).remaining()).toEqual({
                hourly: 2,
                daily: 20,
            });
        });

        it("keeps a committed provisional slot as one actual attempt", () => {
            const storage = new InMemoryPreloadBudgetStorage();
            const persistentBudget = new PreloadBudget(2, 20, () => clock, storage);
            const reservation = persistentBudget.reserveCallLease();

            expect(reservation).not.toBe(false);
            if (reservation) {
                reservation.commit();
                reservation.rollback();
            }

            expect(new PreloadBudget(2, 20, () => clock, storage).remaining()).toEqual({
                hourly: 1,
                daily: 19,
            });
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

        it("resets the daily cap at local midnight while preserving the rolling hour", () => {
            clock = new Date(2026, 6, 21, 23, 50, 0, 0).getTime();
            budget = new PreloadBudget(2, 1, () => clock);
            expect(budget.tryReserveCall()).toBe(true);
            expect(budget.canPreload()).toBe(false);

            clock = new Date(2026, 6, 22, 0, 1, 0, 0).getTime();
            expect(budget.remaining()).toEqual({ hourly: 1, daily: 1 });
            expect(budget.canPreload()).toBe(true);
        });

        it("counts a call made exactly at local midnight in the new local day", () => {
            clock = new Date(2026, 6, 22, 0, 0, 0, 0).getTime();
            budget = new PreloadBudget(2, 1, () => clock);

            expect(budget.tryReserveCall()).toBe(true);
            expect(budget.remaining().daily).toBe(0);
        });
    });
});
