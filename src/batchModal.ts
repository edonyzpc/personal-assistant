import { App, Modal, Setting } from 'obsidian'

import { type Plugin } from './modal'

export class BatchPluginControlModal extends Modal {
    private obsidianPlugins: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    constructor(app: App) {
        super(app);
        this.obsidianPlugins = (app as any).plugins; // eslint-disable-line @typescript-eslint/no-explicit-any
        this.contentEl.createEl('h3', { text: 'Batch Plugin Management', attr: { 'style': 'text-align:center;' } });

        const disabledPlugins: Plugin[] = [];
        const enabledPlugins: Plugin[] = [];
        const plugins: Plugin[] = [];
        const toToggledPlugins: Plugin[] = [];
        const toDisablePlugins: Plugin[] = [];
        for (const key of Object.keys((this.app as any).plugins.manifests)) { // eslint-disable-line @typescript-eslint/no-explicit-any
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

        for (const plugin of plugins) {
            new Setting(this.contentEl)
                .setName(plugin.name)
                .setDesc(plugin.desc)
                .addToggle(toggle => {
                    toggle.setValue(plugin.enbaled)
                        .onChange(async (value) => {
                            if (value) {
                                // change to enable plugin
                                toToggledPlugins.push(plugin);
                            } else {
                                // change to disable plugin
                                toDisablePlugins.push(plugin);
                            }
                        });
                });
        }

        new Setting(this.contentEl)
            .addButton((btn) =>
                btn.setButtonText('OK')
                    .setCta()
                    .onClick(() => {
                        for (const plugin of toToggledPlugins) {
                            console.log(`enable ${plugin.name}`);
                            this.obsidianPlugins.enablePlugin(plugin.id);
                        }

                        for (const plugin of toDisablePlugins) {
                            console.log(`disable ${plugin.name}`);
                            this.obsidianPlugins.disablePlugin(plugin.id);
                        }
                        this.close();
                    }));
    }
}