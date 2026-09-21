import type { App, EventRef } from "obsidian";
import type { Extension } from "@codemirror/state";

import { pluginField, sectionWordCountEditorPlugin, statusBarEditorPlugin } from "./editor-plugin";
import type { EditorPluginHost } from "./EditorPluginHost";
import type { StatsHost } from "./StatsHost";
import StatsManager from "./stats-manager";

export interface StatsPluginIntegrationDependencies {
    readonly app: App;
    readonly statViewType: string;
    getSettings(): StatsHost["settings"] & Pick<EditorPluginHost["settings"], "displaySectionCounts">;
    registerEvent(eventRef: EventRef): void;
    log(message: string, ...args: unknown[]): void;
}

export class StatsPluginIntegration {
    private manager: StatsManager | undefined;
    private cachedEditorExtensions: readonly Extension[] | null = null;

    constructor(private readonly dependencies: StatsPluginIntegrationDependencies) {}

    get statsManager(): StatsManager | undefined {
        return this.manager;
    }

    getEditorExtensions(): readonly Extension[] {
        if (this.cachedEditorExtensions === null) {
            this.cachedEditorExtensions = [
                pluginField.init(() => this.createEditorPluginHost()),
                statusBarEditorPlugin,
                sectionWordCountEditorPlugin,
            ];
        }
        return this.cachedEditorExtensions;
    }

    initialize(): void {
        if (this.manager) return;
        this.manager = new StatsManager(this.createStatsHost());
    }

    async flush(): Promise<void> {
        await this.manager?.flush();
    }

    async activateView(): Promise<void> {
        if (this.manager) {
            await this.manager.flush();
        }
        this.dependencies.app.workspace.detachLeavesOfType(this.dependencies.statViewType);

        const viewLeaf = this.dependencies.app.workspace.getLeaf("tab");
        await viewLeaf.setViewState({
            type: this.dependencies.statViewType,
            active: true,
        });

        await this.dependencies.app.workspace.revealLeaf(viewLeaf);
    }

    unloadStatistics(): void {
        const manager = this.manager;
        if (!manager) return;
        const flush = manager.flush();
        manager.dispose();
        void flush.catch((error) => {
            this.dependencies.log("Failed to flush statistics during unload", error);
        });
    }

    private createStatsHost(): StatsHost {
        const dependencies = this.dependencies;
        return {
            app: dependencies.app,
            get settings() {
                return dependencies.getSettings() as StatsHost["settings"];
            },
            log: (message, ...args) => dependencies.log(message, ...args),
            registerEvent: (eventRef) => dependencies.registerEvent(eventRef),
        };
    }

    private createEditorPluginHost(): EditorPluginHost {
        const dependencies = this.dependencies;
        const getStatsManager = () => this.statsManager;
        return {
            app: dependencies.app,
            get settings() {
                return dependencies.getSettings();
            },
            get statsManager() {
                return getStatsManager();
            },
        };
    }
}
