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

    constructor(app: App, plugin: PluginManager, leaf: WorkspaceLeaf) {
        super(leaf);
        addIcon('PluginAST_PREVIEW', icons['PluginAST_PREVIEW']);
        super.icon = 'PluginAST_PREVIEW';
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
        const dir = await this.app.vault.adapter.list(this.plugin.settings.targetPath);
        const formattedFiles = dir.files.sort().filter((fileName, idx, _) => {
            const reg = RegExp(/\[(.*)\]/, "i");
            const formattedName = reg.exec(this.plugin.settings.fileFormat);
            if (formattedName && formattedName.length > 1) {
                // find the formatted files which format style is set in `setting.fileFormat`
                const fileNameWithoutPath = fileName.substring(fileName.lastIndexOf('/')+1);
                return fileNameWithoutPath.endsWith(".md") && fileNameWithoutPath.includes(formattedName[1]);
            } else {
                // no foramtted files
                return false;
            }
        });
        const nonformattedFiles = dir.files.sort().filter((fileName, idx, _) => {
            return fileName.endsWith(".md") && !formattedFiles.contains(fileName);
        });
        this.files = formattedFiles.reverse().concat(...nonformattedFiles.reverse());
        let limits = this.plugin.settings.previewLimits;
        if (limits > this.files.length) limits = this.files.length;
        this.component = new RecordList({
            target: this.contentEl,
            props: {
                app: this.app,
                plugin: this.plugin,
                fileNames: this.files.slice(0, limits),
                container: this.containerEl,
            }
        });
    }

    async onClose() {
        this.component.$destroy();
    }
}