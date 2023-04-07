import { App, Notice, WorkspaceLeaf } from "obsidian";

import { PluginManager } from "./plugin"

export class ViewResize {
    resized: boolean;
    log: any;

    constructor(plugin: PluginManager) {
        this.resized = false;
        this.log = (msg: any) => plugin.log(msg);
    }

    async resize(type: string): Promise<void> {
        if (this.resized) return;
        // resize the popover
        const hovers = document.querySelectorAll("body .popover.hover-editor");
        hovers.forEach((hover) => {
            this.log("iterating hovers...");
            if (hover.querySelector(`[data-type="${type}"]`)) {
                this.log("setting hover editor attribute...");
                // add some offset to show multiple views
                const t = (10 + Math.random() * 100) + 255;
                const l = (10 + Math.random() * 100) + 475;
                hover.setAttribute("style", `height: 500px; width: 550px; top: ${t}px; left: ${l}px; cursor: move;`);
                this.resized = true;
            }
        });
    }
}

export class LocalGraph extends ViewResize {
    private app: App;
    private plugin: PluginManager;

    constructor(app: App, plugin: PluginManager) {
        super(plugin);
        this.plugin = plugin;
        this.app = app;
    }

    async startup() {
        // reset the status
        this.resized = false;
        const t = this.app.workspace;
        const n = t.getActiveFile();
        if (n) {
            await t.getLeaf(true).setViewState({
                type: "localgraph",
                active: true,
                state: {
                    file: n.path
                }
            });

            await this.syncGlobalToLocal();
        }
        if (this.plugin.settings.localGraph.type === "popover") {
            const ret = await (this.app as any).commands.executeCommandById("obsidian-hover-editor:convert-active-pane-to-popover");
            if (!ret) {
                new Notice("hover local graph failed");
                return;
            }

            // notice the command executed
            new Notice(this.plugin.settings.localGraph.notice);
        }
    }

    private async syncGlobalToLocal() {
        const configDir = this.app.vault.configDir;
        this.log(configDir);
        const graphConfigPath = configDir + '/graph.json';

        // this.app.vault.getAbstractFileByPath('.obsidian/graph.json') would return null
        // So we're doing it the less safe way
        const graphConfigJson = await this.app.vault.adapter.read(graphConfigPath);
        const graphConfig = JSON.parse(graphConfigJson);
        const graphColorGroups = graphConfig.colorGroups;
        this.getLocalGraphLeaves().forEach((leaf: WorkspaceLeaf) => {
            this.setColorGroups(leaf, graphColorGroups);
        })

    }

    private getLocalGraphLeaves() {
        return this.app.workspace.getLeavesOfType('localgraph');
    }

    private setColorGroups(localGraphLeaf: WorkspaceLeaf, colorGroups: any) {
        const viewState = localGraphLeaf.getViewState();
        this.log(viewState.state.options);
        viewState.state.options.colorGroups = colorGroups;
        viewState.state.options.localJumps = this.plugin.settings.localGraph.depth;
        viewState.state.options.showTags = this.plugin.settings.localGraph.showTags;
        viewState.state.options.showAttachments = this.plugin.settings.localGraph.showAttach;
        viewState.state.options.localInterlinks = this.plugin.settings.localGraph.showNeighbor;
        viewState.state.options.showArrow = true;
        viewState.state.options.close = this.plugin.settings.localGraph.collapse;
        viewState.state.options.scale = 0.38;
        localGraphLeaf.setViewState(viewState);
    }
}
