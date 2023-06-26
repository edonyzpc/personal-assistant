import RecordList from './components/RecordList.svelte'

import { App, ItemView, WorkspaceLeaf } from "obsidian";

import { PluginManager } from './plugin';

export const VIEW_TYPE_EXAMPLE = "example-view";

export class ExampleView extends ItemView {
    component: RecordList;
    app: App;
    plugin: PluginManager;

    constructor(app: App, plugin: PluginManager, leaf: WorkspaceLeaf) {
        super(leaf);
        this.app = app;
        this.plugin = plugin;
    }

    getViewType() {
        return VIEW_TYPE_EXAMPLE;
    }

    getDisplayText() {
        return "Example view";
    }

    async onOpen() {
        console.log("opening...");
        this.component = new RecordList({
            target: this.contentEl,
            props: {
                variable: 1,
                app: this.app,
                plugin: this.plugin,
                fileName: "Diary-2023-04-03.md",
                container: this.containerEl,
            }
        });
    }

    async onClose() {
        this.component.$destroy();
    }
}