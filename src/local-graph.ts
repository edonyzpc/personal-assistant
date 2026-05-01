/* Copyright 2023 edonyzpc */

import { Notice, Platform, normalizePath, type App, type WorkspaceLeaf } from "obsidian";

import type { PluginManager } from "./plugin"
import { ViewType, ViewResize } from "./view";

type GraphColorGroup = {
    query: string;
    color: {
        a: number,
        rgb: number,
    }
}

type GraphConfig = {
    colorGroups?: GraphColorGroup[];
}

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

    private async syncGlobalToLocal() {
        const graphColorGroups = await this.readGlobalGraphColorGroups();
        await Promise.all(this.getLocalGraphLeaves().map((leaf: WorkspaceLeaf) => {
            return this.setColorGroups(leaf, graphColorGroups);
        }));

    }

    private getLocalGraphLeaves() {
        return this.app.workspace.getLeavesOfType('localgraph');
    }

    private async setColorGroups(localGraphLeaf: WorkspaceLeaf, colorGroups: GraphColorGroup[]) {
        const viewState = localGraphLeaf.getViewState();
        this.log("view state", viewState.state);
        const state = viewState.state ?? {};
        const options = (state.options && typeof state.options === 'object') ? state.options as Record<string, unknown> : {};
        state.options = options;
        viewState.state = state;
        options.colorGroups = colorGroups;
        options.localJumps = this.plugin.settings.localGraph.depth;
        options.showTags = this.plugin.settings.localGraph.showTags;
        options.showAttachments = this.plugin.settings.localGraph.showAttach;
        options.localInterlinks = this.plugin.settings.localGraph.showNeighbor;
        options.showArrow = true;
        options.close = this.plugin.settings.localGraph.collapse;
        options.scale = 1.0;
        await localGraphLeaf.setViewState(viewState);
    }

    async updateGraphColors() {
        const graphColorsToSet = this.plugin.settings.colorGroups;

        await Promise.all(this.getLocalGraphLeaves().map((leaf: WorkspaceLeaf) => {
            this.plugin.log("setting colors");
            return this.setColorGroups(leaf, graphColorsToSet);
        }));
    }

    private async readGlobalGraphColorGroups(): Promise<GraphColorGroup[]> {
        const graphConfigPath = this.getGraphConfigPath();

        if (!await this.app.vault.adapter.exists(graphConfigPath)) {
            this.log("graph config not found", graphConfigPath);
            return [];
        }

        try {
            const graphConfigJson = await this.app.vault.adapter.read(graphConfigPath);
            const graphConfig = JSON.parse(graphConfigJson) as GraphConfig;
            return Array.isArray(graphConfig.colorGroups) ? graphConfig.colorGroups : [];
        } catch (error) {
            const fileError = error as NodeJS.ErrnoException;
            if (fileError.code === "ENOENT") {
                this.log("graph config not found", graphConfigPath);
                return [];
            }
            if (error instanceof SyntaxError) {
                this.log("graph config is invalid JSON", graphConfigPath);
                return [];
            }

            throw error;
        }
    }

    private getGraphConfigPath(): string {
        const configDir = this.app.vault.configDir;
        this.log(configDir);
        return normalizePath(configDir + '/graph.json');
    }
}
