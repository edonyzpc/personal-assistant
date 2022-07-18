import { App, PluginSettingTab, Setting } from "obsidian";

import {PluginManager} from "./plugin"

// [obsidian-link-archive](https://github.com/tomzorz/obsidian-link-archive/blob/master/settings.ts)
// [obsidian-dev-tools](https://github.com/KjellConnelly/obsidian-dev-tools)
export class SampleSettingTab extends PluginSettingTab {
    plugin: PluginManager;

    constructor(app: App, plugin: PluginManager) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const plugin: PluginManager = this.plugin;
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl('h2', { text: 'Settings for my awesome plugin.' });
        containerEl.createEl("p", { text: "This plugin archives links in your note so they're available to you even if the original site goes down or gets removed." });
        containerEl.createEl("a", { text: "Open GitHub repository", href: "https://github.com/tomzorz/obsidian-link-archive" });

        new Setting(containerEl)
            .setName('Setting #1')
            .setDesc('It\'s a secret')
            .addText(text => text
                .setPlaceholder('Enter your secret')
                .setValue(this.plugin.settings.mySetting)
                .onChange(async (value) => {
                    console.log('Secret: ' + value);
                    plugin.settings.mySetting = value;
                    await this.plugin.saveSettings();
                }));

    }

}
