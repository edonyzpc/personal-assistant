import { App, ItemView, WorkspaceLeaf, addIcon } from "obsidian";

import { PluginManager } from './plugin';
import RecordList from './components/RecordList.svelte'
import { icons } from './utils';

export const RECORD_PREVIEW_TYPE = "record-preview";

export class RecordPreview extends ItemView {
    component: RecordList;
    app: App;
    plugin: PluginManager;
    files: string[];

    constructor(app: App, plugin: PluginManager, leaf: WorkspaceLeaf, files: string[]) {
        super(leaf);
        addIcon('PluginAST_PREVIEW', icons['PluginAST_PREVIEW']);
        super.icon = 'PluginAST_PREVIEW';
        super.navigation = false;
        this.app = app;
        this.plugin = plugin;
        this.files = files;
    }

    getViewType() {
        return RECORD_PREVIEW_TYPE;
    }

    getDisplayText() {
        return "Records Preview";
    }

    async onOpen() {
        let limits = this.plugin.settings.previewLimits;
        if (limits > this.files.length) limits = this.files.length;
        this.component = new RecordList({
            target: this.contentEl,
            props: {
                app: this.app,
                plugin: this.plugin,
                fileNames: this.files.reverse().slice(0, limits),
                container: this.containerEl,
            }
        });
    }

    async onClose() {
        this.component.$destroy();
    }
}