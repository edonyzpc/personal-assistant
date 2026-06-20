const LEGACY_CONFIG_DIR_PREFIX = ".";
const LEGACY_CONFIG_DIR_NAME = "obsidian";

export const LEGACY_CONFIG_DIR = `${LEGACY_CONFIG_DIR_PREFIX}${LEGACY_CONFIG_DIR_NAME}`;

function normalizeVaultPath(path: string): string {
    return path
        .replace(/\\/g, "/")
        .replace(/\/+/g, "/")
        .replace(/^\.\//, "")
        .replace(/\/+$/, "");
}

export function normalizeVaultConfigDir(configDir: string | undefined): string {
    return normalizeVaultPath(configDir?.trim() || LEGACY_CONFIG_DIR);
}

export function getVaultConfigDir(vault: { configDir?: string } | undefined): string {
    return normalizeVaultConfigDir(vault?.configDir);
}

export function getVaultConfigDirStorageScope(vault: { configDir?: string } | undefined): string {
    return vault?.configDir?.trim() || LEGACY_CONFIG_DIR;
}

export function joinVaultConfigPath(configDir: string, childPath: string): string {
    return normalizeVaultPath(`${configDir}/${childPath}`);
}

export function uniqueNormalizedPaths(paths: string[]): string[] {
    return Array.from(new Set(paths.map((path) => normalizeVaultPath(path))));
}

function foldVaultPathForConfigCheck(path: string): string {
    return normalizeVaultPath(path)
        .split("/")
        .map((segment) => segment.normalize("NFC").toLowerCase())
        .join("/");
}

export function isVaultPathInConfigDir(path: string, configDir: string): boolean {
    const normalizedPath = foldVaultPathForConfigCheck(path);
    const normalizedConfigDir = foldVaultPathForConfigCheck(normalizeVaultConfigDir(configDir));
    return normalizedPath === normalizedConfigDir
        || normalizedPath.startsWith(`${normalizedConfigDir}/`);
}
