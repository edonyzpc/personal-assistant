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

interface DisabledPlugin {
    name: string;
    id: string;
    desc: string;
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

export class PluginSuggestModal extends SuggestModal<DisabledPlugin> {
    obsidianPlugins = (window.app as any).plugins;
    // Returns all available suggestions.
    getSuggestions(query: string): DisabledPlugin[] {
        'use strict'
        const disabledPlugins: DisabledPlugin[] = [];
        for (const key of Object.keys((window.app as any).plugins.manifests)) {
            if (!this.obsidianPlugins.enabledPlugins.has(this.obsidianPlugins.manifests[key].id)) {
                disabledPlugins.push({
                    name: this.obsidianPlugins.manifests[key].name,
                    id: this.obsidianPlugins.manifests[key].id,
                    desc: this.obsidianPlugins.manifests[key].description,
                });
            }
        }
        return disabledPlugins;
    }

    // Renders each suggestion item.
    renderSuggestion(plugin: DisabledPlugin, el: HTMLElement) {
        el.createEl("div", { text: plugin.name });
        el.createEl("small", { text: plugin.desc });
    }

    // Perform action on the selected suggestion.
    onChooseSuggestion(plugin: DisabledPlugin, evt: MouseEvent | KeyboardEvent) {
        'use strict'
        new Notice(`enabling plugin ${plugin.name}`);
        if (this.obsidianPlugins.enablePlugin(plugin.id)) {
            new Notice(`enable plugin[${plugin.name}] successfully`);
        } else {
            new Notice(`enable plugin[${plugin.name}] failed, try it again`);
        }
    }
}