/* Copyright 2023 edonyzpc */

import { App, Platform, Notice, WorkspaceLeaf, normalizePath } from "obsidian";

import { PluginManager } from "./plugin"
import { ViewType, ViewResize } from "./view";


/**
 * A class for managing the local graph view.
 */
export class LocalGraph extends ViewResize {
    private app: App;

    /**
     * Creates an instance of LocalGraph.
     * @param app - The app instance.
     * @param plugin - The PluginManager instance.
     */
    constructor(app: App, plugin: PluginManager) {
        super(plugin, ViewType.LocalGraphView);
        this.app = app;
    }

    /**
     * Startups the local graph view.
     */
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
        // only hover local graph in desktop
        if (Platform.isDesktop && this.plugin.settings.localGraph.type === "popover") {
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

    /**
     * Syncs the global graph settings to the local graph.
     * @private
     */
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

    /**
     * Gets all local graph leaves.
     * @returns An array of local graph leaves.
     * @private
     */
    private getLocalGraphLeaves() {
        return this.app.workspace.getLeavesOfType('localgraph');
    }

    /**
     * Sets the color groups for a local graph leaf.
     * @param localGraphLeaf - The local graph leaf.
     * @param colorGroups - The color groups to set.
     * @private
     */
    private async setColorGroups(localGraphLeaf: WorkspaceLeaf, colorGroups: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        const viewState = localGraphLeaf.getViewState();
        this.log("view state", viewState.state);
        /* eslint-disable @typescript-eslint/no-explicit-any */
        (viewState.state?.options as any).colorGroups = colorGroups;
        (viewState.state?.options as any).localJumps = this.plugin.settings.localGraph.depth;
        (viewState.state?.options as any).showTags = this.plugin.settings.localGraph.showTags;
        (viewState.state?.options as any).showAttachments = this.plugin.settings.localGraph.showAttach;
        (viewState.state?.options as any).localInterlinks = this.plugin.settings.localGraph.showNeighbor;
        (viewState.state?.options as any).showArrow = true;
        (viewState.state?.options as any).close = this.plugin.settings.localGraph.collapse;
        (viewState.state?.options as any).scale = 1.0;
        await localGraphLeaf.setViewState(viewState);
    }

    /**
     * Updates the graph colors.
     */
    async updateGraphColors() {
        const configDir = this.app.vault.configDir;
        const graphConfigPath = normalizePath(configDir + '/graph.json');
        const graphConfigJson = await this.app.vault.adapter.read(graphConfigPath);
        const graphConfig = JSON.parse(graphConfigJson);
        const graphColorsToSet = this.plugin.settings.colorGroups;
        graphColorsToSet.forEach(color => graphConfig.colorGroups.push(color));

        this.app.workspace.getLeavesOfType('localgraph').forEach(async (leaf: WorkspaceLeaf) => {
            this.plugin.log("setting colors");
            const viewState = leaf.getViewState();
            this.plugin.log(viewState.state?.options);
            (viewState.state?.options as any).colorGroups = graphColorsToSet;
            await leaf.setViewState(viewState);
        })
    }
}
