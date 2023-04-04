import { App, Notice, WorkspaceLeaf } from "obsidian";

import { PluginManager } from "./plugin"

export class LocalGraph {
    private app: App;
    private plugin: PluginManager;
    constructor(app: App, plugin: PluginManager) {
        this.plugin = plugin;
        this.app = app;
    }

    async startup() {
        const t = this.app.workspace;
        const n = t.getActiveFile();
        if (n) {
            await t.getLeaf("split", "vertical").setViewState({
                type: "localgraph",
                active: true,
                state: {
                    file: n.path
                }
            });

            await this.syncGlobalToLocal();
        }
        if (this.plugin.settings.localGraph.type === "popover") {
            this.app.workspace.iterateAllLeaves((leaf) => {
                this.plugin.log(leaf.getViewState());
                // if (leaf.containerEl.hasClass("graph-controls")) {
                //     debug("setting active leaf!!!");
                //     this.app.workspace.setActiveLeaf(leaf);
                // }
            });
            await (this.app as any).commands.executeCommandById("obsidian-hover-editor:convert-active-pane-to-popover");
        }

        // resize the popover
        const hovers = document.querySelectorAll("body .popover.hover-editor");
        hovers.forEach((hover) => {
            console.log(hover);
            if (hover.querySelector('[data-type="localgraph"]')) {
                hover.setAttribute("style", "height:250px;width:190px;top:180px;left:180px");
                hover.setAttribute("data-x", "290");
                hover.setAttribute("data-y", "175");
            }
        })
        // $("body .popover.hover-editor").setAttribute("style", "height:250px;width:190px;top:180px;left:180px");

        // notice the command executed
        new Notice(this.plugin.settings.localGraph.notice);
    }

    private async syncGlobalToLocal() {
        const configDir = this.app.vault.configDir;
        this.plugin.log(configDir);
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
        this.plugin.log(viewState.state.options);
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
