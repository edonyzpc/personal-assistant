import { App, Notice, WorkspaceLeaf, normalizePath } from "obsidian";

import { PluginManager } from "./plugin"
import { ViewType, ViewResize } from "./view";


export class LocalGraph extends ViewResize {
    private app: App;

    constructor(app: App, plugin: PluginManager) {
        super(plugin, ViewType.LocalGraphView);
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
            const ret = await (this.app as any).commands.executeCommandById("obsidian-hover-editor:convert-active-pane-to-popover"); // eslint-disable-line @typescript-eslint/no-explicit-any
            if (!ret) {
                new Notice("hover local graph failed");
                return;
            }

            // notice the command executed
            new Notice(this.plugin.settings.localGraph.notice);
        }

        if (this.plugin.settings.localGraph.autoColors && this.plugin.settings.enableGraphColors) {
            // auto-set colors of local graph view when grap color configuration is enabled
            await this.updateGraphColors();
        }
    }

    private async syncGlobalToLocal() {
        const configDir = this.app.vault.configDir;
        this.log(configDir);
        const graphConfigPath = normalizePath(configDir + '/graph.json');

        // **NOTE**:
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

    private setColorGroups(localGraphLeaf: WorkspaceLeaf, colorGroups: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        const viewState = localGraphLeaf.getViewState();
        this.log(viewState.state.options);
        viewState.state.options.colorGroups = colorGroups;
        viewState.state.options.localJumps = this.plugin.settings.localGraph.depth;
        viewState.state.options.showTags = this.plugin.settings.localGraph.showTags;
        viewState.state.options.showAttachments = this.plugin.settings.localGraph.showAttach;
        viewState.state.options.localInterlinks = this.plugin.settings.localGraph.showNeighbor;
        viewState.state.options.showArrow = true;
        viewState.state.options.close = this.plugin.settings.localGraph.collapse;
        viewState.state.options.scale = 1.0;
        localGraphLeaf.setViewState(viewState);
    }

    async updateGraphColors() {
        const configDir = this.app.vault.configDir;
        const graphConfigPath = normalizePath(configDir + '/graph.json');
        const graphConfigJson = await this.app.vault.adapter.read(graphConfigPath);
        const graphConfig = JSON.parse(graphConfigJson);
        const graphColorsToSet = this.plugin.settings.colorGroups;
        graphColorsToSet.forEach(color => graphConfig.colorGroups.push(color));

        this.app.workspace.getLeavesOfType('localgraph').forEach((leaf: WorkspaceLeaf) => {
            this.plugin.log("setting colors");
            const viewState = leaf.getViewState();
            this.plugin.log(viewState.state.options);
            viewState.state.options.colorGroups = graphColorsToSet;
            leaf.setViewState(viewState);
        })
    }
}
