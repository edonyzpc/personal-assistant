/* Copyright 2023 edonyzpc */

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

export class PreloadBudget {
    private callTimestamps: number[] = [];

    constructor(
        private perHourCap: number = 2,
        private perDayCap: number = 20,
        private now: () => number = Date.now,
    ) {}

    canPreload(): boolean {
        this.prune();
        const now = this.now();
        const hourlyCount = this.countSince(now - ONE_HOUR_MS);
        if (hourlyCount >= this.perHourCap) return false;
        const dailyCount = this.countSince(now - ONE_DAY_MS);
        return dailyCount < this.perDayCap;
    }

    recordCall(): void {
        this.callTimestamps.push(this.now());
    }

    remaining(): { hourly: number; daily: number } {
        this.prune();
        const now = this.now();
        const hourlyUsed = this.countSince(now - ONE_HOUR_MS);
        const dailyUsed = this.countSince(now - ONE_DAY_MS);
        return {
            hourly: Math.max(0, this.perHourCap - hourlyUsed),
            daily: Math.max(0, this.perDayCap - dailyUsed),
        };
    }

    reset(): void {
        this.callTimestamps = [];
    }

    private prune(): void {
        const cutoff = this.now() - ONE_DAY_MS;
        let write = 0;
        for (let read = 0; read < this.callTimestamps.length; read++) {
            if (this.callTimestamps[read] > cutoff) {
                this.callTimestamps[write] = this.callTimestamps[read];
                write++;
            }
        }
        this.callTimestamps.length = write;
    }

    private countSince(since: number): number {
        let count = 0;
        for (const ts of this.callTimestamps) {
            if (ts > since) count++;
        }
        return count;
    }
}
