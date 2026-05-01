import { App, ItemView, WorkspaceLeaf, addIcon } from "obsidian";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { PluginManager } from "./plugin";
import Statistics from './components/Statistics'
import { icons } from './utils'
import { PluginAST_STAT_ICON } from './constant'
import { createEmptyDashboardData } from "./stats/stats-store";
import type { StatsDashboardData } from "./stats/stats-types";

export const STAT_PREVIEW_TYPE = "vault-statistics-preview";

export class Stat extends ItemView {
    componentRoot: Root | null = null;
    app: App;
    plugin: PluginManager;
    dashboardData: StatsDashboardData;

    constructor(app: App, plugin: PluginManager, leaf: WorkspaceLeaf) {
        super(leaf);
        this.app = app;
        this.plugin = plugin;
        this.dashboardData = createEmptyDashboardData();
        addIcon(PluginAST_STAT_ICON, icons[PluginAST_STAT_ICON]);
    }

    getViewType() {
        return STAT_PREVIEW_TYPE;
    }

    getDisplayText() {
        return "Vault Statistics Preview";
    }

    getIcon(): string {
        return PluginAST_STAT_ICON;
    }

    async onOpen() {
        this.dashboardData = await this.loadDashboardData();
        const el = this.containerEl.getElementsByClassName("view-content")[0] as HTMLElement;
        this.componentRoot = createRoot(el);
        this.renderStatistics();
    }

    async onClose() {
        this.componentRoot?.unmount();
        this.componentRoot = null;
    }

    onResize(): void {
        const el = this.containerEl.getElementsByClassName("view-content")[0] as HTMLElement;
        if (!this.componentRoot) {
            this.componentRoot = createRoot(el);
        }
        this.renderStatistics();
    }

    private async loadDashboardData(): Promise<StatsDashboardData> {
        if (!this.plugin.statsManager) {
            return createEmptyDashboardData();
        }
        return this.plugin.statsManager.getDashboardData();
    }

    private renderStatistics(): void {
        if (!this.componentRoot) return;
        this.componentRoot.render(
            createElement(Statistics, {
                app: this.app,
                plugin: this.plugin,
                dashboardData: this.dashboardData
            })
        );
    }
}
