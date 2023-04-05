import { App, Notice, Modal, SuggestModal } from 'obsidian'

export class SampleModal extends Modal {
    constructor(app: App) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.setText('Woah!');
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

interface Plugin {
    name: string;
    id: string;
    desc: string;
    enbaled: boolean;
}

const ALL_DISABLED_PLUGIN = [
    {
        id: "How to Take Smart Notes",
        desc: "Sönke Ahrens",
    },
    {
        id: "Thinking, Fast and Slow",
        desc: "Daniel Kahneman",
    },
    {
        id: "Deep Work",
        desc: "Cal Newport",
    },
];

export const OpenPlugin = true;
export const ClosePlugin = false;

export class PluginControlModal extends SuggestModal<Plugin> {
    private obsidianPlugins: any;
    private toEnablePlugin: boolean;

    constructor(app: App, toEnable: boolean) {
        super(app);
        this.obsidianPlugins = (app as any).plugins;
        this.toEnablePlugin = toEnable;
    }

    // Returns all available suggestions.
    getSuggestions(query: string): Plugin[] {
        'use strict'
        const disabledPlugins: Plugin[] = [];
        const enabledPlugins: Plugin[] = [];
        for (const key of Object.keys((window.app as any).plugins.manifests)) {
            // find disabled plugins
            if (!this.obsidianPlugins.enabledPlugins.has(this.obsidianPlugins.manifests[key].id)) {
                disabledPlugins.push({
                    name: this.obsidianPlugins.manifests[key].name,
                    id: this.obsidianPlugins.manifests[key].id,
                    desc: this.obsidianPlugins.manifests[key].description,
                    enbaled: false,
                });
            } else {
                enabledPlugins.push({
                    name: this.obsidianPlugins.manifests[key].name,
                    id: this.obsidianPlugins.manifests[key].id,
                    desc: this.obsidianPlugins.manifests[key].description,
                    enbaled: true,
                });
            }
        }
        return this.toEnablePlugin ? disabledPlugins : enabledPlugins;
    }

    // Renders each suggestion item.
    renderSuggestion(plugin: Plugin, el: HTMLElement) {
        el.createEl("div", { text: plugin.name });
        el.createEl("small", { text: plugin.desc });
    }

    // Perform action on the selected suggestion.
    onChooseSuggestion(plugin: Plugin, evt: MouseEvent | KeyboardEvent) {
        'use strict'
        if (this.toEnablePlugin) {
            if (this.obsidianPlugins.enablePluginAndSave(plugin.id)) {
                new Notice(`enable plugin[${plugin.name}] successfully`);
            } else {
                new Notice(`enable plugin[${plugin.name}] failed, try it again`);
            }
        } else {
            if (this.obsidianPlugins.disablePluginAndSave(plugin.id)) {
                new Notice(`disable plugin[${plugin.name}] successfully`);
            } else {
                new Notice(`disable plugin[${plugin.name}] failed, try it again`);
            }
        }
    }
}