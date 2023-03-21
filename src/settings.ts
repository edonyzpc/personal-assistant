import { App, PluginSettingTab, Setting } from "obsidian";

import { PluginManager } from "./plugin"

export interface PluginManagerSettings {
    debug: boolean;
    targetPath: string;
    fileFormat: string;
}

export const DEFAULT_SETTINGS: PluginManagerSettings = {
    debug: true,
    targetPath: "2.fleeting/fleeting-thoughts/",
    fileFormat: "YYYY-MM-DD"
}

// [obsidian-link-archive](https://github.com/tomzorz/obsidian-link-archive/blob/master/settings.ts)
// [obsidian-dev-tools](https://github.com/KjellConnelly/obsidian-dev-tools)
export class SettingTab extends PluginSettingTab {
    plugin: PluginManager;

    constructor(app: App, plugin: PluginManager) {
        super(app, plugin);
        this.plugin = plugin;
        this.plugin.settings = DEFAULT_SETTINGS;
    }

    display(): void {
        const plugin: PluginManager = this.plugin;
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl('h1', { text: 'Settings for Plugin Manager' });
        containerEl.createEl("p", { text: "Obsidian Management by Shadow Walker" });
        containerEl.createEl("a", { text: "Open GitHub repository", href: "https://github.com/edonyzpc/obsidian-plugins-mng" });

        new Setting(containerEl).setName("Debug").addToggle((cb) =>
            cb.setValue(this.plugin.settings.debug)
                .onChange((value) => {
                    this.plugin.settings.debug = value;
                    this.plugin.saveSettings();
                }));

        containerEl.createEl('h2', { text: 'Settings for Record' });
        containerEl.createEl("p", { text: "Obsidian Management for Recording in Mobile" });
        new Setting(containerEl).setName('Target Path')
            .setDesc('Target directory to do recording')
            .addText(text => text
                .setPlaceholder('2.fleeting/fleeting-thoughts/')
                .setValue(this.plugin.settings.targetPath)
                .onChange(async (value) => {
                    this.plugin.log('target path: ' + value);
                    plugin.settings.targetPath = value;
                    await this.plugin.saveSettings();
                }));
        const desc_format = document.createDocumentFragment();
        desc_format.createEl('p', undefined, (p) => {
            p.innerText = "File format which is like Diary setting.\nFor more syntax details, ";
            p.createEl('a', undefined, (link) => {
                link.innerText = 'please check moment format.';
                link.href = 'https://momentjs.com/docs/#/displaying/format/';
            });
        });
        new Setting(containerEl).setName('File Format')
            .setDesc(desc_format)
            .addText(text => text
                .setPlaceholder('YYYY-MM-DD')
                .setValue(this.plugin.settings.fileFormat)
                .onChange(async (value) => {
                    this.plugin.log('format setting: ' + value);
                    plugin.settings.fileFormat = value;
                    await this.plugin.saveSettings();
                }));
    }

}
