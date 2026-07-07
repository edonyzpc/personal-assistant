/* Copyright 2023 edonyzpc */

import { App, Notice, SuggestModal, addIcon, setIcon } from 'obsidian'

import { icons } from './utils';
import { getInternalPlugins } from './obsidian-internals';
import { getPluginUiLanguage, pluginT } from './locales/plugin';

function modalT(key: string, params?: Readonly<Record<string, string | number>>): string {
    return pluginT(key, getPluginUiLanguage(), params);
}

export interface Plugin {
    name: string;
    id: string;
    desc: string;
    enabled: boolean;
}

export class PluginControlModal extends SuggestModal<Plugin> {
    private readonly obsidianPlugins;
    private enabledColor = "green";
    private disabledColor = "red";

    constructor(app: App) {
        super(app);
        this.obsidianPlugins = getInternalPlugins(app);
        if (!this.obsidianPlugins) {
            new Notice(modalT('plugin.modal.pluginListUnavailable'));
        }
    }

    getSuggestions(query: string): Plugin[] {
        'use strict'
        if (!this.obsidianPlugins) return [];
        const disabledPlugins: Plugin[] = [];
        const enabledPlugins: Plugin[] = [];
        const plugins: Plugin[] = [];
        for (const key of Object.keys(this.obsidianPlugins.manifests)) {
            const pluginObject: Plugin = {
                name: this.obsidianPlugins.manifests[key].name,
                id: this.obsidianPlugins.manifests[key].id,
                desc: this.obsidianPlugins.manifests[key].description,
                enabled: false
            };
            // find disabled plugins
            if (!this.obsidianPlugins.enabledPlugins.has(this.obsidianPlugins.manifests[key].id)) {
                pluginObject.enabled = false;
                disabledPlugins.push(pluginObject);
            } else {
                pluginObject.enabled = true;
                enabledPlugins.push(pluginObject);
            }
            plugins.push(pluginObject);
        }
        //return this.toEnablePlugin ? disabledPlugins.filter((plugin) => plugin.name.toLowerCase().includes(query.toLowerCase())) : enabledPlugins.filter((plugin) => plugin.name.toLowerCase().includes(query.toLowerCase()));
        return plugins.filter((plugin) => plugin.name.toLowerCase().includes(query.toLowerCase()));
    }

    // Renders each suggestion item.
    renderSuggestion(plugin: Plugin, el: HTMLElement) {
        const color = plugin.enabled ? this.enabledColor : this.disabledColor;

        addIcon('SWITCH_ON_STATUS', icons['SWITCH_ON_STATUS']);
        addIcon('SWITCH_OFF_STATUS', icons['SWITCH_OFF_STATUS']);
        const div = el.createEl("div");
        div.setCssStyles({ color });
        if (plugin.enabled) {
            setIcon(div, 'SWITCH_ON_STATUS');
        } else {
            setIcon(div, 'SWITCH_OFF_STATUS');
        }
        div.querySelector('svg')?.addClass("plugin-switch-on-off-svg");
        div.createSpan({ text: plugin.name, cls: "pa-plugin-suggestion-name" });
        el.createEl("small", { text: plugin.desc });
    }

    // Perform action on the selected suggestion.
    onChooseSuggestion(plugin: Plugin, _evt: MouseEvent | KeyboardEvent): void {
        void this.choosePlugin(plugin);
    }

    private async choosePlugin(plugin: Plugin): Promise<void> {
        const action = modalT(
            plugin.enabled
                ? "plugin.modal.pluginAction.disable"
                : "plugin.modal.pluginAction.enable"
        );

        try {
            const result = plugin.enabled
                ? await this.obsidianPlugins?.disablePluginAndSave(plugin.id)
                : await this.obsidianPlugins?.enablePluginAndSave(plugin.id);

            if (result === false) {
                new Notice(modalT("plugin.modal.pluginAction.failed", { action, name: plugin.name }));
                return;
            }

            new Notice(modalT("plugin.modal.pluginAction.success", { action, name: plugin.name }));
        } catch (error) {
            console.error(`${action} plugin[${plugin.name}] failed`, error);
            new Notice(modalT("plugin.modal.pluginAction.failed", { action, name: plugin.name }));
        }
    }
}
