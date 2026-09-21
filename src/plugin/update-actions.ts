import type { PluginsUpdater } from "../plugin-manifest";
import type { ThemeUpdater } from "../theme-manifest";

export type UpdaterAction = () => Promise<void>;

export function createPluginUpdaterAction(
    createUpdater: () => PluginsUpdater,
): UpdaterAction {
    return async () => {
        const updater = createUpdater();
        await updater.update();
    };
}

export function createThemeUpdaterAction(
    createUpdater: () => Promise<ThemeUpdater>,
): UpdaterAction {
    return async () => {
        const updater = await createUpdater();
        await updater.update();
    };
}
