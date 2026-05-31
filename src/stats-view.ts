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
    private isOpen = false;
    private openRunId = 0;

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
        this.isOpen = true;
        const openRunId = ++this.openRunId;
        this.dashboardData = await this.loadDashboardData();
        if (!this.isOpen || openRunId !== this.openRunId) return;
        const el = this.containerEl.getElementsByClassName("view-content")[0] as HTMLElement;
        this.componentRoot = createRoot(el);
        this.renderStatistics();
    }

    async onClose() {
        this.isOpen = false;
        this.openRunId++;
        this.componentRoot?.unmount();
        this.componentRoot = null;
    }

    onResize(): void {
        // Chart.js and the Statistics component's ResizeObserver handle layout updates.
    }

    private async loadDashboardData(): Promise<StatsDashboardData> {
        if (!this.plugin.statsManager) {
            return createEmptyDashboardData();
        }
        await this.plugin.statsManager.flush();
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
