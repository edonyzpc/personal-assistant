import { App, ItemView, WorkspaceLeaf, addIcon } from "obsidian";

import { PluginManager } from './plugin';
import RecordList from './components/RecordList.svelte'
import { icons } from './utils';

export const RECORD_PREVIEW_TYPE = "record-preview";

export class RecordPreview extends ItemView {
    component: RecordList;
    app: App;
    plugin: PluginManager;

    constructor(app: App, plugin: PluginManager, leaf: WorkspaceLeaf) {
        super(leaf);
        addIcon('PluginAST_STATUSBAR', icons['PluginAST_STATUSBAR']);
        super.icon = 'PluginAST_STATUSBAR';
        super.navigation = false;
        this.app = app;
        this.plugin = plugin;
    }

    getViewType() {
        return RECORD_PREVIEW_TYPE;
    }

    getDisplayText() {
        return "Records Preview";
    }

    async onOpen() {
        this.component = new RecordList({
            target: this.contentEl,
            props: {
                variable: 1,
                app: this.app,
                plugin: this.plugin,
                fileNames: ["Diary-2023-04-03.md", "Diary-2023-04-08.md"],
                container: this.containerEl,
            }
        });
    }

    async onClose() {
        this.component.$destroy();
    }
}