/* Copyright 2023 edonyzpc */

import { App, Notice, SuggestModal, addIcon, setIcon } from 'obsidian'

import { icons } from './utils';
import { getInternalPlugins } from './obsidian-internals';

export interface Plugin {
    name: string;
    id: string;
    desc: string;
    enbaled: boolean;
}

export class PluginControlModal extends SuggestModal<Plugin> {
    private readonly obsidianPlugins;
    private enabledColor = "green";
    private disabledColor = "red";

    constructor(app: App) {
        super(app);
        this.obsidianPlugins = getInternalPlugins(app);
        if (!this.obsidianPlugins) {
            new Notice('Plugin list unavailable');
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
                enbaled: false
            };
            // find disabled plugins
            if (!this.obsidianPlugins.enabledPlugins.has(this.obsidianPlugins.manifests[key].id)) {
                pluginObject.enbaled = false;
                disabledPlugins.push(pluginObject);
            } else {
                pluginObject.enbaled = true;
                enabledPlugins.push(pluginObject);
            }
            plugins.push(pluginObject);
        }
        //return this.toEnablePlugin ? disabledPlugins.filter((plugin) => plugin.name.toLowerCase().includes(query.toLowerCase())) : enabledPlugins.filter((plugin) => plugin.name.toLowerCase().includes(query.toLowerCase()));
        return plugins.filter((plugin) => plugin.name.toLowerCase().includes(query.toLowerCase()));
    }

    // Renders each suggestion item.
    renderSuggestion(plugin: Plugin, el: HTMLElement) {
        const color = plugin.enbaled ? this.enabledColor : this.disabledColor;

        addIcon('SWITCH_ON_STATUS', icons['SWITCH_ON_STATUS']);
        addIcon('SWITCH_OFF_STATUS', icons['SWITCH_OFF_STATUS']);
        const div = el.createEl("div", { attr: { style: `color: ${color}` } });
        if (plugin.enbaled) {
            setIcon(div, 'SWITCH_ON_STATUS');
        } else {
            setIcon(div, 'SWITCH_OFF_STATUS');
        }
        div.querySelector('svg')?.addClass("plugin-switch-on-off-svg");
        div.createSpan({ text: plugin.name, attr: { style: "color: var(--text-normal)" } });
        el.createEl("small", { text: plugin.desc });
    }

    // Perform action on the selected suggestion.
    async onChooseSuggestion(plugin: Plugin, evt: MouseEvent | KeyboardEvent) {
        const action = plugin.enbaled ? "disable" : "enable";

        try {
            const result = plugin.enbaled
                ? await this.obsidianPlugins?.disablePluginAndSave(plugin.id)
                : await this.obsidianPlugins?.enablePluginAndSave(plugin.id);

            if (result === false) {
                new Notice(`${action} plugin[${plugin.name}] failed, try it again`);
                return;
            }

            new Notice(`${action} plugin[${plugin.name}] successfully`);
        } catch (error) {
            console.error(`${action} plugin[${plugin.name}] failed`, error);
            new Notice(`${action} plugin[${plugin.name}] failed, try it again`);
        }
    }
}
