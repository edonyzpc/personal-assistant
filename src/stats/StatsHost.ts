import type { App, EventRef } from "obsidian";

export interface StatsHost {
    readonly app: App;
    readonly settings: {
        debug: boolean;
        statsPath: string;
        statisticsVaultId: string;
        statisticsSyncEnabled: boolean;
        countComments: boolean;
    };
    log(message: string, ...args: unknown[]): void;
    registerEvent(ref: EventRef): void;
}
