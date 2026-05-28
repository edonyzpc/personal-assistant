import { App, Modal, Notice, Setting, ToggleComponent } from 'obsidian'

import { type Plugin } from './modal'
import { getInternalPlugins } from './obsidian-internals';

export class BatchPluginControlModal extends Modal {
    private readonly obsidianPlugins;
    constructor(app: App) {
        super(app);
        this.obsidianPlugins = getInternalPlugins(app);
        this.contentEl.createEl('h3', { text: 'Batch Plugin Management', attr: { 'style': 'text-align:center;' } });

        if (!this.obsidianPlugins) {
            this.contentEl.createEl('p', { text: 'Plugin list unavailable.' });
            return;
        }

        const disabledPlugins: Plugin[] = [];
        const enabledPlugins: Plugin[] = [];
        const plugins: Plugin[] = [];
        const desiredPluginStates = new Map<string, { plugin: Plugin, enabled: boolean }>();
        const toggles: ToggleComponent[] = [];
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

        for (const plugin of plugins) {
            new Setting(this.contentEl)
                .setName(plugin.name)
                .setDesc(plugin.desc)
                .addToggle(toggle => {
                    toggles.push(toggle);
                    toggle.setValue(plugin.enbaled)
                        .onChange((value) => {
                            if (value === plugin.enbaled) {
                                desiredPluginStates.delete(plugin.id);
                            } else {
                                desiredPluginStates.set(plugin.id, { plugin, enabled: value });
                            }
                        });
                });
        }

        new Setting(this.contentEl)
            .addButton((btn) =>
                btn.setButtonText('OK')
                    .setCta()
                    .onClick(async () => {
                        const pluginStates = Array.from(desiredPluginStates.values());

                        if (pluginStates.length === 0) {
                            new Notice("No plugin changes to apply");
                            this.close();
                            return;
                        }

                        btn.setDisabled(true);
                        toggles.forEach((toggle) => toggle.setDisabled(true));
                        let failedCount = 0;

                        for (const { plugin, enabled } of pluginStates) {
                            const action = enabled ? "enable" : "disable";
                            try {
                                console.log(`${action} ${plugin.name}`);
                                const result = enabled
                                    ? await this.obsidianPlugins?.enablePluginAndSave(plugin.id)
                                    : await this.obsidianPlugins?.disablePluginAndSave(plugin.id);

                                if (result === false) {
                                    failedCount += 1;
                                } else {
                                    desiredPluginStates.delete(plugin.id);
                                }
                            } catch (error) {
                                failedCount += 1;
                                console.error(`${action} plugin[${plugin.name}] failed`, error);
                            }
                        }

                        if (failedCount > 0) {
                            btn.setDisabled(false);
                            toggles.forEach((toggle) => toggle.setDisabled(false));
                            new Notice(`Failed to update ${failedCount} plugin${failedCount > 1 ? "s" : ""}, try it again`);
                            return;
                        }

                        new Notice(`Updated ${pluginStates.length} plugin${pluginStates.length > 1 ? "s" : ""} successfully`);
                        this.close();
                    }));
    }
}
