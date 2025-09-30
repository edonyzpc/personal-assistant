/**
 * @file This file contains types related to plugin and theme manifests.
 * @copyright Copyright (c) 2023 edonyzpc
 */

/**
 * Represents a plugin or theme manifest.
 */
export interface Manifest {
    /** The ID of the plugin or theme. */
    id: string,
    /** The version of the plugin or theme. */
    version: string,
    /** Information about the update status. */
    toUpdate?: {
        /** Whether an update is needed. */
        needUpdate: boolean,
        /** The repository of the plugin or theme. */
        repo: string,
        /** The target version for the update. */
        targetVersion: string,
        /** Whether the release is a zip file. */
        isZipFile: boolean,
    },
}

/**
 * Represents the update status of a plugin or theme.
 */
export interface UpdateStatus {
    /** Whether an update is needed. */
    needUpdate: boolean,
    /** The target version for the update. */
    targetVersion: string,
}

/**
 * Represents the interface for an Obsidian manifest.
 */
export interface ObsidianManifest {
    /** The list of manifests. */
    items: Manifest[],
    /** The URL for the CDN. */
    URLCDN: string,
    /**
     * Gets the repository for a given ID.
     * @param ID - The ID of the plugin or theme.
     * @returns The repository of the plugin or theme, or null if it fails.
     */
    getRepo(ID: string): Promise<string | null>,
    /**
     * Checks if a plugin or theme needs to be updated.
     * @param latestRelease - The latest release of the plugin or theme.
     * @param currentVersion - The current version of the plugin or theme.
     * @returns The update status of the plugin or theme.
     */
    isNeedToUpdate(latestRelease: JSON, currentVersion: string): Promise<UpdateStatus>,
    /**
     * Updates all plugins or themes that need to be updated.
     */
    update(): Promise<void>,
}

/**
 * Represents the release files for a plugin.
 */
export interface PluginReleaseFiles {
    /** The main JavaScript file. */
    mainJs:     string | null;
    /** The manifest file. */
    manifest:   string | null;
    /** The styles file. */
    styles:     string | null;
}

/**
 * Represents the release files for a theme.
 */
export interface ThemeReleaseFiles {
    /** The manifest file. */
    manifest:   string | null;
    /** The theme file. */
    theme:     string | null;
}