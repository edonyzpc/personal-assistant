import { App, ItemView, WorkspaceLeaf, addIcon } from "obsidian";

import { PluginManager } from "./plugin";
import Statistics from './components/Statistics.svelte'
import { icons } from './utils'
import { PluginAST_STAT_ICON, STATS_FILE_NAME } from './constant'

/**
 * The view type for the statistics preview.
 */
export const STAT_PREVIEW_TYPE = "vault-statistics-preview";

/**
 * A view for displaying vault statistics.
 */
export class Stat extends ItemView {
    component!: Statistics;
    app: App;
    plugin: PluginManager;
    staticsFileData: string;

    /**
     * Creates an instance of Stat.
     * @param app - The app instance.
     * @param plugin - The PluginManager instance.
     * @param leaf - The workspace leaf.
     */
    constructor(app: App, plugin: PluginManager, leaf: WorkspaceLeaf) {
        super(leaf);
        this.app = app;
        this.plugin = plugin;
        this.staticsFileData = "";
        addIcon(PluginAST_STAT_ICON, icons[PluginAST_STAT_ICON]);
    }

    /**
     * Gets the view type.
     * @returns The view type.
     */
    getViewType() {
        return STAT_PREVIEW_TYPE;
    }

    /**
     * Gets the display text.
     * @returns The display text.
     */
    getDisplayText() {
        return "Vault Statistics Preview";
    }

    /**
     * Gets the icon.
     * @returns The icon.
     */
    getIcon(): string {
        return PluginAST_STAT_ICON;
    }

    /**
     * Called when the view is opened.
     */
    async onOpen() {
        const staticsDataDir = this.app.vault.configDir + "/" + STATS_FILE_NAME;
        this.staticsFileData = await this.app.vault.adapter.read(staticsDataDir);
        const el = this.containerEl.getElementsByClassName("view-content");
        this.component = new Statistics({
            target: el[0],
            props: {
                app: this.app,
                plugin: this.plugin,
                staticsFileData: this.staticsFileData
            },
        })

        const charts = this.containerEl.getElementsByTagName("canvas");
        charts[0].setAttribute("style", "position: absolute;top: 50%;left: 50%;transform: translate(-50%, -50%);")
    }

    /**
     * Called when the view is closed.
     */
    async onClose() {
        this.component.$destroy();
    }

    /**
     * Called when the view is resized.
     */
    onResize(): void {
        this.component.$destroy();
        const el = this.containerEl.getElementsByClassName("view-content");
        this.component = new Statistics({
            target: el[0],
            props: {
                app: this.app,
                plugin: this.plugin,
                staticsFileData: this.staticsFileData
            },
        })

        const charts = this.containerEl.getElementsByTagName("canvas");
        charts[0].setAttribute("style", "position: absolute;top: 50%;left: 50%;transform: translate(-50%, -50%);")
    }
}