import { App, ItemView, WorkspaceLeaf } from "obsidian";

import { PluginManager } from "./plugin";
import RecordList from './components/RecordList.svelte'
import Statistics from './components/Statistics.svelte'

export const STAT_PREVIEW_TYPE = "vault-statistics-preview";

export class Stat extends ItemView {
    component!: RecordList;
    app: App;
    plugin: PluginManager;

    constructor(app: App, plugin: PluginManager, leaf: WorkspaceLeaf) {
        super(leaf);
        this.app = app;
        this.plugin = plugin;
    }

    getViewType() {
        return STAT_PREVIEW_TYPE;
    }

    getDisplayText() {
        return "Vault Statistics Preview";
    }

    async onOpen() {
        this.component = new Statistics()
    }

    async onClose() {
        this.component.$destroy();
    }
}