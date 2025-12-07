import { App, ItemView, WorkspaceLeaf, addIcon } from "obsidian";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { PluginManager } from "./plugin";
import Statistics from './components/Statistics'
import { icons } from './utils'
import { PluginAST_STAT_ICON, STATS_FILE_NAME } from './constant'

export const STAT_PREVIEW_TYPE = "vault-statistics-preview";

export class Stat extends ItemView {
    componentRoot: Root | null = null;
    app: App;
    plugin: PluginManager;
    staticsFileData: string;

    constructor(app: App, plugin: PluginManager, leaf: WorkspaceLeaf) {
        super(leaf);
        this.app = app;
        this.plugin = plugin;
        this.staticsFileData = "";
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
        const staticsDataDir = this.app.vault.configDir + "/" + STATS_FILE_NAME;
        this.staticsFileData = await this.app.vault.adapter.read(staticsDataDir);
        const el = this.containerEl.getElementsByClassName("view-content")[0] as HTMLElement;
        this.componentRoot = createRoot(el);
        this.componentRoot.render(
            createElement(Statistics, {
                app: this.app,
                plugin: this.plugin,
                staticsFileData: this.staticsFileData
            })
        );
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
        this.componentRoot.render(
            createElement(Statistics, {
                app: this.app,
                plugin: this.plugin,
                staticsFileData: this.staticsFileData
            })
        );
    }
}
