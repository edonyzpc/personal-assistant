import { App, Notice } from "obsidian";

import { ViewType, ViewResize } from "./view";
import { PluginManager } from "./plugin";

export class Memos extends ViewResize {
    private app: App;

    constructor(app: App, plugin: PluginManager) {
        super(plugin, ViewType.MemosView);
        this.app = app;
    }

    async startup() {
        // reset the status
        this.resized = false;
        const enabledMemos = this.isEnabledPlugin('obsidian-memos');
        const enabledHover = this.isEnabledPlugin('obsidian-hover-editor');
        if (enabledMemos && enabledHover) {
            await (this.app as any).commands.executeCommandById("obsidian-memos:show-memos-in-popover"); // eslint-disable-line @typescript-eslint/no-explicit-any
        } else {
            const msg = enabledMemos === enabledHover ? "Memos and Hover are" : enabledMemos ? "Hover is" : "Memos is";
            new Notice(`Can't work correctly! Plugin ${msg} missing`);
        }
    }

    private isEnabledPlugin(name: string): boolean {
        return (this.app as any).plugins.enabledPlugins.has(name) ? true : false; // eslint-disable-line @typescript-eslint/no-explicit-any
    }
}