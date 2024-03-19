import { App, ItemView, WorkspaceLeaf, addIcon } from "obsidian";

import { PluginManager } from "./plugin";
import Statistics from './components/Statistics.svelte'
import { icons } from './utils'

export const STAT_PREVIEW_TYPE = "vault-statistics-preview";

export class Stat extends ItemView {
    component!: Statistics;
    app: App;
    plugin: PluginManager;
    staticsFileData: string;

    constructor(app: App, plugin: PluginManager, leaf: WorkspaceLeaf, staticsFileData: string) {
        super(leaf);
        this.app = app;
        this.plugin = plugin;
        this.staticsFileData = staticsFileData;
        addIcon('PluginAST_STAT', icons['PluginAST_STAT']);
    }

    getViewType() {
        return STAT_PREVIEW_TYPE;
    }

    getDisplayText() {
        return "Vault Statistics Preview";
    }

    getIcon(): string {
        return "PluginAST_STAT";
    }

    async onOpen() {
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

    async onClose() {
        this.component.$destroy();
    }

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