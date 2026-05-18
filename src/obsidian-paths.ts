import { normalizePath, type Vault } from "obsidian";

export const LEGACY_CONFIG_DIR = ".obsidian";

export function getVaultConfigDir(vault: Pick<Vault, "configDir"> | undefined): string {
    return normalizePath(vault?.configDir?.trim() || LEGACY_CONFIG_DIR);
}

export function joinVaultConfigPath(configDir: string, childPath: string): string {
    return normalizePath(`${configDir}/${childPath}`);
}

export function uniqueNormalizedPaths(paths: string[]): string[] {
    return Array.from(new Set(paths.map((path) => normalizePath(path))));
}
