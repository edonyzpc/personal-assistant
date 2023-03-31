import { App, PluginSettingTab, Setting } from "obsidian";

import { PluginManager } from "./plugin"

export class LocalGraph {
    private prefix: string;
    constructor(app: App, plugin: PluginManager) {
        super(app, plugin);
        this.plugin = plugin;
    }
}

/*
'use strict'

const OPTION_NOTICE = "Message";
const OPTION_POPOVER = "Type";
const OPTION_DEBUG = "Debug";
const OPTION_JUMP_DEPTH = "Depth";
const OPTION_SHOW_TAGS = "ShowTags";
const OPTION_SHOW_ATTACH = "ShowAttachments";
const OPTION_SHOW_NEIGHBOR = "ShowNeighbors";
const OPTION_ARROW = "ShowArrow";
const OPTION_COLLAPSE = "Collapse";
const debug = (msg) => {
    if (DEBUG) console.log(msg);
};

var DEBUG = false;

module.exports = {
    entry: start,
    settings: {
        name: "Startup Memos Quickly for Noting",
        options: {
            [OPTION_NOTICE]: {
                type: "text",
                defaultValue: "show current note grah view",
            },
            [OPTION_POPOVER]: {
                type: "text",
                // show memo in popver pane if the value if "popover",
                // and other values will be the default split display.
                defaultValue: "popover",
            },
            [OPTION_DEBUG]: {
                type: "toggle",
                defaultValue: false,
            },
            [OPTION_JUMP_DEPTH]: {
                type: "text",
                defaultValue: 1,
            },
            [OPTION_SHOW_TAGS]: {
                type: "toggle",
                defaultValue: false,
            },
            [OPTION_SHOW_ATTACH]: {
                type: "toggle",
                defaultValue: false,
            },
            [OPTION_SHOW_NEIGHBOR]: {
                type: "toggle",
                defaultValue: false,
            },
            [OPTION_ARROW]: {
                type: "toggle",
                defaultValue: false,
            },
            [OPTION_COLLAPSE]: {
                type: "toggle",
                defaultValue: false,
            }
        },
    },
};

async function start(params, settings) {
    // init debug setting
    DEBUG = settings[OPTION_DEBUG];
    // debug logging
    debug(settings);

    // openup local graph of active note
    //await params.app.commands.executeCommandById("graph:open-local");
    var t = params.app.workspace
        , n = t.getActiveFile();
    if (n) {
        debug(t.activeLeaf);
        await t.splitActiveLeaf("vertical").setViewState({
            type: "localgraph",
            active: true,
            group: t.activeLeaf,
            state: {
                file: n.path
            }
        });

        await syncGlobalToLocal(params, settings);
    }
    if (settings[OPTION_POPOVER] === "popover") {
        params.app.workspace.iterateAllLeaves((leaf) => {
            debug(leaf.getViewState());
            // if (leaf.containerEl.hasClass("graph-controls")) {
            //     debug("setting active leaf!!!");
            //     this.app.workspace.setActiveLeaf(leaf);
            // }
        });
        await params.app.commands.executeCommandById("obsidian-hover-editor:convert-active-pane-to-popover");
    }

    // resize the popover
    let hovers = document.querySelectorAll("body .popover.hover-editor");
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
    new Notice(settings[OPTION_NOTICE]);
}

async function syncGlobalToLocal(params, settings) {
    const configDir = params.app.vault.configDir;
    debug(configDir);
    const graphConfigPath = configDir + '/graph.json';

    // this.app.vault.getAbstractFileByPath('.obsidian/graph.json') would return null
    // So we're doing it the less safe way
    // const graphConfigJson = await this.app.vault.adapter.read(graphConfigPath);
    // const graphConfigFile = app.vault.getAbstractFileByPath(graphConfigPath);
    // if (graphConfigFile instanceof TFile) {
    if (true) {
        // const graphConfigJson = await app.vault.read(graphConfigFile);
        const graphConfigJson = await params.app.vault.adapter.read(graphConfigPath);
        const graphConfig = JSON.parse(graphConfigJson);
        const graphColorGroups = graphConfig.colorGroups;
        getLocalGraphLeaves(params).forEach((leaf) => {
            setColorGroups(leaf, graphColorGroups, settings);
        })
    } else {
        // console.log(graphConfigPath);
        // console.log(graphConfigFile);
    }
}

function getLocalGraphLeaves(params) {
    return params.app.workspace.getLeavesOfType('localgraph');
}

function setColorGroups(localGraphLeaf, colorGroups, settings) {
    const viewState = localGraphLeaf.getViewState();
    debug(viewState.state.options);
    viewState.state.options.colorGroups = colorGroups;
    viewState.state.options.localJumps = settings[OPTION_JUMP_DEPTH];
    viewState.state.options.showTags = settings[OPTION_SHOW_TAGS];
    viewState.state.options.showAttachments = settings[OPTION_SHOW_ATTACH];
    viewState.state.options.localInterlinks = settings[OPTION_SHOW_NEIGHBOR];
    viewState.state.options.showArrow = settings[OPTION_ARROW];
    viewState.state.options.close = settings[OPTION_COLLAPSE];
    viewState.state.options.scale = 0.38;
    localGraphLeaf.setViewState(viewState);
}
*/