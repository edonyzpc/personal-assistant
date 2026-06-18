import type { App } from "obsidian";
import type StatsManager from "./stats-manager";

export interface EditorPluginHost {
    readonly app: App;
    readonly settings: {
        displaySectionCounts: boolean;
        countComments: boolean;
    };
    readonly statsManager: StatsManager | undefined;
}
