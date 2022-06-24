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
        return ALL_DISABLED_PLUGIN.filter((plugin) =>
            plugin.id.toLowerCase().includes(query.toLowerCase())
        );
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