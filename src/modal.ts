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
    // Returns all available suggestions.
    getSuggestions(query: string): DisabledPlugin[] {
        'use strict'
        const disabledPlugins: DisabledPlugin[] = [];
        for (const key of Object.keys((window.app as any).plugins.manifests)) {
            new Notice(key);
            if (!(window.app as any).plugins.enabledPlugins.has((window.app as any).plugins.manifests[key].id)) {
                disabledPlugins.push({
                    id: (window.app as any).plugins.manifests[key].id,
                    desc: (window.app as any).plugins.manifests[key].description,
                });
            }
        }
        console.log(disabledPlugins);
        return disabledPlugins;
    }

    // Renders each suggestion item.
    renderSuggestion(plugin: DisabledPlugin, el: HTMLElement) {
        el.createEl("div", { text: plugin.id });
        el.createEl("small", { text: plugin.desc });
    }

    // Perform action on the selected suggestion.
    onChooseSuggestion(plugin: DisabledPlugin, evt: MouseEvent | KeyboardEvent) {
        new Notice(`Selected ${plugin.id}`);
    }
}