/* Copyright 2023 edonyzpc */

const ONE_HOUR_MS = 60 * 60 * 1000;

export interface PreloadBudgetState {
    version: 1;
    callTimestamps: number[];
}

export interface PreloadBudgetStorage {
    load(): PreloadBudgetState | null;
    save(state: PreloadBudgetState): void;
}

/** Persisted provisional slot paired with one imminent provider invocation. */
export interface PreloadBudgetReservation {
    commit(): void;
    rollback(): void;
}

/** Synchronous JSON storage used by the per-vault production budget. */
export class LocalStoragePreloadBudgetStorage implements PreloadBudgetStorage {
    constructor(
        private readonly getStorage: () => Storage | undefined,
        private readonly key: string,
    ) {}

    load(): PreloadBudgetState | null {
        const storage = this.requireStorage();
        const raw = storage.getItem(this.key);
        return raw === null ? null : JSON.parse(raw) as PreloadBudgetState;
    }

    save(state: PreloadBudgetState): void {
        this.requireStorage().setItem(this.key, JSON.stringify(state));
    }

    private requireStorage(): Storage {
        const storage = this.getStorage();
        if (!storage) throw new Error("Pagelet preload budget storage unavailable");
        return storage;
    }
}

/** Test double and non-persistent fallback for callers that do not supply storage. */
export class InMemoryPreloadBudgetStorage implements PreloadBudgetStorage {
    private state: PreloadBudgetState | null = null;

    constructor(initial?: PreloadBudgetState) {
        if (initial) this.save(initial);
    }

    load(): PreloadBudgetState | null {
        return this.state
            ? { version: 1, callTimestamps: [...this.state.callTimestamps] }
            : null;
    }

    save(state: PreloadBudgetState): void {
        this.state = { version: 1, callTimestamps: [...state.callTimestamps] };
    }
}

export class PreloadBudget {
    private callTimestamps: number[] = [];

    constructor(
        private perHourCap: number = 2,
        private perDayCap: number = 20,
        private now: () => number = Date.now,
        private readonly storage?: PreloadBudgetStorage,
        private readonly startOfLocalDay: (now: number) => number = defaultStartOfLocalDay,
    ) {}

    updateLimits(perHourCap: number, perDayCap: number): void {
        this.perHourCap = perHourCap;
        this.perDayCap = perDayCap;
    }

    canRun(): boolean {
        if (!this.refresh()) return false;
        return this.canRunLoaded();
    }

    private canRunLoaded(): boolean {
        const now = this.now();
        const hourlyCount = this.countSince(now - ONE_HOUR_MS);
        if (hourlyCount >= this.perHourCap) return false;
        const dailyCount = this.countSince(this.startOfLocalDay(now), true);
        return dailyCount < this.perDayCap;
    }

    canPreload(): boolean {
        return this.canRun();
    }

    /** Atomically check and consume one actual provider-call slot. */
    tryReserveCall(): boolean {
        const reservation = this.reserveCallLease();
        if (!reservation) return false;
        reservation.commit();
        return true;
    }

    /**
     * Persist a provisional slot. The caller commits it immediately before
     * invoking the provider or rolls it back if source/admission checks fail.
     */
    reserveCallLease(): PreloadBudgetReservation | false {
        // Storage is synchronous (localStorage in production), so reloading,
        // checking and saving cannot interleave with another JS task. A fresh
        // read also coordinates Pagelet instances across plugin reload/toggle.
        if (!this.refresh() || !this.canRunLoaded()) return false;
        const timestamp = this.now();
        this.callTimestamps.push(timestamp);
        if (!this.persistOrRollback()) return false;

        let settled = false;
        return {
            commit: () => {
                settled = true;
            },
            rollback: () => {
                if (settled) return;
                if (!this.refresh()) {
                    throw new Error("Pagelet preload budget storage unavailable");
                }
                const index = this.callTimestamps.lastIndexOf(timestamp);
                if (index >= 0) this.callTimestamps.splice(index, 1);
                try {
                    this.persist();
                    settled = true;
                } catch {
                    throw new Error("Pagelet preload budget storage unavailable");
                }
            },
        };
    }

    recordCall(): void {
        if (!this.refresh()) {
            throw new Error("Pagelet preload budget storage unavailable");
        }
        this.callTimestamps.push(this.now());
        if (!this.persistOrRollback()) {
            throw new Error("Pagelet preload budget storage unavailable");
        }
    }

    remaining(): { hourly: number; daily: number } {
        if (!this.refresh()) return { hourly: 0, daily: 0 };
        const now = this.now();
        const hourlyUsed = this.countSince(now - ONE_HOUR_MS);
        const dailyUsed = this.countSince(this.startOfLocalDay(now), true);
        return {
            hourly: Math.max(0, this.perHourCap - hourlyUsed),
            daily: Math.max(0, this.perDayCap - dailyUsed),
        };
    }

    reset(): void {
        const previous = this.callTimestamps;
        this.callTimestamps = [];
        try {
            this.persist();
        } catch (error) {
            this.callTimestamps = previous;
            throw error;
        }
    }

    private prune(): void {
        const now = this.now();
        // Keep the union of the rolling-hour window and current local day.
        // Just after midnight this intentionally retains calls from the
        // previous day that still belong to the rolling-hour window.
        const cutoff = Math.min(now - ONE_HOUR_MS, this.startOfLocalDay(now));
        let write = 0;
        for (let read = 0; read < this.callTimestamps.length; read++) {
            if (this.callTimestamps[read] >= cutoff) {
                this.callTimestamps[write] = this.callTimestamps[read];
                write++;
            }
        }
        this.callTimestamps.length = write;
    }

    private countSince(since: number, inclusive = false): number {
        let count = 0;
        for (const ts of this.callTimestamps) {
            if (inclusive ? ts >= since : ts > since) count++;
        }
        return count;
    }

    private refresh(): boolean {
        if (!this.storage) {
            this.prune();
            return true;
        }
        try {
            const loaded = this.storage.load();
            if (loaded === null) {
                this.callTimestamps = [];
            } else if (!isValidState(loaded)) {
                return false;
            } else {
                this.callTimestamps = [...loaded.callTimestamps];
            }
            this.prune();
            return true;
        } catch {
            return false;
        }
    }

    private persistOrRollback(): boolean {
        try {
            this.persist();
            return true;
        } catch {
            this.callTimestamps.pop();
            return false;
        }
    }

    private persist(): void {
        this.storage?.save({
            version: 1,
            callTimestamps: [...this.callTimestamps],
        });
    }
}

function defaultStartOfLocalDay(now: number): number {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start.getTime();
}

function isValidState(state: PreloadBudgetState): boolean {
    return state.version === 1
        && Array.isArray(state.callTimestamps)
        && state.callTimestamps.every((timestamp) => (
            typeof timestamp === "number"
            && Number.isFinite(timestamp)
            && Number.isInteger(timestamp)
            && timestamp >= 0
        ));
}
