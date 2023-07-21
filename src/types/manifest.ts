export interface Manifest {
    id: string,
    version: string,
    toUpdate?: {
        needUpdate: boolean,
        repo: string,
        targetVersion: string,
        isZipFile: boolean,
    },
}

export interface UpdateStatus {
    needUpdate: boolean,
    targetVersion: string,
}

export interface ObsidianManifest {
    items: Manifest[],
    URLCDN: string,
    getRepo(ID: string): Promise<string | null>,
    isNeedToUpdate(latestRelease: JSON, currentVersion: string): Promise<UpdateStatus>,
    update(): Promise<void>,
}

export interface PluginReleaseFiles {
    mainJs:     string | null;
    manifest:   string | null;
    styles:     string | null;
}

export interface ThemeReleaseFiles {
    manifest:   string | null;
    theme:     string | null;
}