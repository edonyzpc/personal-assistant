import type { App, PluginManifest } from 'obsidian';

interface ObsidianInternalPlugins {
    manifests: Record<string, PluginManifest>;
    enabledPlugins: Set<string>;
    enablePluginAndSave(id: string): Promise<boolean | void>;
    disablePluginAndSave(id: string): Promise<boolean | void>;
    loadPlugin(id: string): Promise<void>;
}

interface ObsidianInternalSetting {
    open(): void;
    openTabById(id: string): void;
}

interface ObsidianInternalCommands {
    executeCommandById(id: string): boolean;
}

export function getInternalPlugins(app: App): ObsidianInternalPlugins | undefined {
    const internal = app as unknown as Record<string, unknown>;
    const plugins = internal.plugins;
    if (plugins && typeof plugins === 'object' && 'manifests' in plugins) {
        return plugins as unknown as ObsidianInternalPlugins;
    }
    return undefined;
}

export function getPluginManifests(app: App): Record<string, PluginManifest> {
    return getInternalPlugins(app)?.manifests ?? {};
}

export function isPluginEnabled(app: App, pluginId: string): boolean {
    const plugins = getInternalPlugins(app);
    if (!plugins) return false;
    return pluginId in plugins.manifests && plugins.enabledPlugins.has(pluginId);
}

export async function enablePluginAndSave(app: App, pluginId: string): Promise<boolean | void> {
    return getInternalPlugins(app)?.enablePluginAndSave(pluginId);
}

export function getInternalSetting(app: App): ObsidianInternalSetting | undefined {
    const internal = app as unknown as Record<string, unknown>;
    const setting = internal.setting;
    if (setting && typeof setting === 'object' && 'open' in setting && 'openTabById' in setting) {
        return setting as unknown as ObsidianInternalSetting;
    }
    return undefined;
}

export function openSettings(app: App): void {
    getInternalSetting(app)?.open();
}

export function openSettingsTab(app: App, tabId: string): void {
    getInternalSetting(app)?.openTabById(tabId);
}

export function executeCommandById(app: App, commandId: string): boolean {
    const internal = app as unknown as Record<string, unknown>;
    const commands = internal.commands;
    if (commands && typeof commands === 'object' && 'executeCommandById' in commands) {
        return (commands as unknown as ObsidianInternalCommands).executeCommandById(commandId);
    }
    return false;
}

export function getVaultTags(app: App): Record<string, number> {
    const cache = app.metadataCache as unknown as Record<string, unknown>;
    if (typeof cache.getTags === 'function') {
        return (cache.getTags as () => Record<string, number>)();
    }
    return {};
}
