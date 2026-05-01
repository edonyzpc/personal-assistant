/* Copyright 2023 edonyzpc */

import { App, Notice, normalizePath, request } from 'obsidian';
import { gt, prerelease, valid } from "semver";
import type { PluginManager } from "./plugin";
import type { ObsidianManifest, Manifest, UpdateStatus, ThemeReleaseFiles } from "./types/manifest";
import { ProgressBar } from "./progress-bar";
import { downloadZipFile, extractFile } from "./utils";

interface ThemeReleaseAsset {
    name?: string;
    browser_download_url?: string;
}

interface ThemeRelease {
    tag_name?: string;
    assets?: ThemeReleaseAsset[];
}

interface ThemeManifest extends Manifest {
    latestRelease?: ThemeRelease;
}

interface ObsidianCustomCss {
    readThemes?: (reloadTheme?: boolean) => Promise<void> | void;
    reloadTheme?: () => Promise<void> | void;
}

export class ThemeUpdater implements ObsidianManifest {
    items: ThemeManifest[];
    URLCDN: string;
    app: App;
    private commandPlugin: PluginManager;
    private log: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    private communityThemes: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    private TagName = 'tag_name';
    private totalThemes: number;
    private checkedThemes: number;
    private progressBar: ProgressBar;
    private versionRegex = /^\d+(\.\d+)*$/;

    static async init(app: App, plugin: PluginManager): Promise<ThemeUpdater> {
        const themeUpdater = new ThemeUpdater(app, plugin);
        themeUpdater.items = await themeUpdater.listThemes(themeUpdater.app);
        const themeJson = await themeUpdater.getCommunityThemesJson();
        if (themeJson) {
            themeUpdater.communityThemes = JSON.parse(themeJson);
        } else {
            new Notice("got some network issue when accessing github.com", 500);
        }
        return themeUpdater;
    }

    // list obsidian themes
    private async listThemes(app: App): Promise<ThemeManifest[]> {
        const themesPath = normalizePath(app.vault.configDir + '/themes');
        let themeDirs;
        try {
            themeDirs = await app.vault.adapter.list(themesPath);
        } catch (error) {
            this.log(`skip listing themes from ${themesPath}`, error);
            return [];
        }

        const themes = await Promise.all(themeDirs.folders.map(async (f) => {
            const themeFile = normalizePath(f + '/manifest.json');
            try {
                const m = await app.vault.adapter.read(themeFile);
                const object = JSON.parse(m) as { name?: unknown; version?: unknown };
                if (typeof object.name !== "string" ||
                    typeof object.version !== "string" ||
                    !object.name ||
                    !object.version) {
                    this.log(`skip invalid theme manifest: ${themeFile}`);
                    return null;
                }

                return {
                    id: object.name,
                    version: object.version,
                };
            } catch (error) {
                this.log(`skip unreadable theme manifest: ${themeFile}`, error);
                return null;
            }
        }));

        return themes.filter((theme): theme is ThemeManifest => theme !== null);
    }

    private async getCommunityThemesJson(): Promise<string | null> {
        try {
            const response = await request({ url: this.URLCDN });
            return (response === "404: Not Found" ? null : response);
        } catch (error) {
            this.log("error in getCommunityThemes", error)
            return null;
        }
    }

    private constructor(app: App, plugin: PluginManager) {
        this.app = app;
        this.URLCDN = `https://cdn.jsdelivr.net/gh/obsidianmd/obsidian-releases@master/community-css-themes.json`;
        this.commandPlugin = plugin;
        this.log = (...msg: any) => plugin.log(...msg); // eslint-disable-line @typescript-eslint/no-explicit-any
        this.totalThemes = 0;
        this.checkedThemes = 0;
        this.items = [];

        this.progressBar = new ProgressBar(plugin, "theme-updating", this.totalThemes);
    }

    async getRepo(themeID: string): Promise<string | null> {
        if (this.commandPlugin.settings.cacheThemeRepo[themeID]) {
            this.log(`found ${themeID} which cached in data.json`);
            return this.commandPlugin.settings.cacheThemeRepo[themeID];
        }
        if (!this.communityThemes) {
            // cache the community plugins json
            const communityThemesJson = await this.getCommunityThemesJson();
            if (communityThemesJson) {
                this.communityThemes = JSON.parse(communityThemesJson);
            } else {
                this.log("fail to get commnity theme json file");
                return null;
            }
        }
        for (let i = 0; i < this.communityThemes.length; i++) {
            const { name, repo } = this.communityThemes[i];
            if (name === themeID) {
                // cache the `repo <----> theme-id` into data.json for fast getting
                this.commandPlugin.settings.cacheThemeRepo[themeID] = repo;
                await this.commandPlugin.saveSettings();

                return repo;
            }
        }

        this.log("fail to find plugin from community-themes.json");
        return null;
    }

    private async getLatestRelease(repo: string | null): Promise<ThemeRelease | null> {
        if (!repo) {
            this.log("repo is null");
            return null;
        }
        const URL = `https://api.github.com/repos/${repo}/releases/latest`;
        try {
            const response = await request({ url: URL });
            return (response === "404: Not Found" ? null : await JSON.parse(response) as ThemeRelease);
        } catch (error) {
            if (error != "Error: Request failed, status 404") { //normal error, ignore
                this.log(`error in getLatestRelease for ${URL}`, error);
            }
            return null;
        }
    }

    private getLatestTag(latest: ThemeRelease | JSON | null): string | null {
        if (!latest) {
            this.log("the input JSON for getLatestTag is null");
            return null;
        }
        const release = latest as ThemeRelease;
        if (typeof release.tag_name === "string") {
            return release.tag_name;
        }

        this.log(`getLatestTag cannot find the object named ${this.TagName}`);
        return null;
    }

    private getVersionInfo(raw: string): {
        cleaned: string;
        semver: string | null;
        numericParts: number[] | null;
        isPrerelease: boolean;
    } {
        const trimmed = raw.trim();
        const cleaned = trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
        const semverVersion = valid(cleaned);
        const isPrerelease = semverVersion
            ? Boolean(prerelease(semverVersion)?.length)
            : cleaned.includes("-") || /[a-zA-Z]/.test(cleaned);
        const base = cleaned.split(/[+-]/)[0];
        let numericParts: number[] | null = null;
        if (this.versionRegex.test(base)) {
            numericParts = base.split(".").map((part) => Number(part));
            if (numericParts.some((part) => Number.isNaN(part))) {
                numericParts = null;
            }
        }

        return {
            cleaned,
            semver: semverVersion,
            numericParts,
            isPrerelease,
        };
    }

    private compareNumericParts(a: number[], b: number[]): number {
        const maxLen = Math.max(a.length, b.length);
        for (let i = 0; i < maxLen; i++) {
            const left = a[i] ?? 0;
            const right = b[i] ?? 0;
            if (left > right) return 1;
            if (left < right) return -1;
        }

        return 0;
    }

    async isNeedToUpdate(latestRelease: ThemeRelease | JSON | null, currentVersion: string): Promise<UpdateStatus> {
        if (latestRelease) {
            const originTag = this.getLatestTag(latestRelease);
            if (originTag) {
                const tagInfo = this.getVersionInfo(originTag);
                const currentInfo = this.getVersionInfo(currentVersion);
                this.log("latest tag: " + tagInfo.cleaned, "current tag: " + currentInfo.cleaned);
                // do not update pre-release version
                if (tagInfo.isPrerelease) {
                    return {
                        needUpdate: false,
                        targetVersion: currentVersion,
                    };
                }
                if (tagInfo.semver && currentInfo.semver) {
                    if (gt(tagInfo.semver, currentInfo.semver)) {
                        return {
                            needUpdate: true,
                            targetVersion: originTag,
                        };
                    }
                } else if (tagInfo.numericParts && currentInfo.numericParts) {
                    const compare = this.compareNumericParts(tagInfo.numericParts, currentInfo.numericParts);
                    if (compare > 0 || (compare === 0 && currentInfo.isPrerelease && !tagInfo.isPrerelease)) {
                        return {
                            needUpdate: true,
                            targetVersion: originTag,
                        };
                    }
                } else {
                    this.log(
                        `skip update: unsupported version format (latest: ${originTag}, current: ${currentVersion})`
                    );
                }
            }
        }
        return {
            needUpdate: false,
            targetVersion: currentVersion,
        };
    }

    async update(): Promise<void> {
        const getReleaseFile = async (URL: string, label: string) => {
            try {
                const download = await request({ url: URL });
                return ((download === "Not Found" || download === `{"error":"Not Found"}`) ? null : download);
            } catch (error) {
                this.log(`error in grabbing release file ${label}`, URL, error);
                return null;
            }
        };

        const getReleaseZipFile = async (URL: string, label: string) => {
            try {
                return await downloadZipFile(URL);
            } catch (error) {
                this.log(`error in grabbing release zip ${label}`, URL, error);
                return null;
            }
        };

        const extractThemeFilesFromZip = async (zipBytes: ArrayBuffer): Promise<ThemeReleaseFiles> => {
            return {
                theme: await extractFile(zipBytes, "theme.css"),
                manifest: await extractFile(zipBytes, "manifest.json"),
            };
        };

        const fillMissingFiles = (target: ThemeReleaseFiles, source: ThemeReleaseFiles) => {
            target.theme = target.theme ?? source.theme;
            target.manifest = target.manifest ?? source.manifest;
        };

        const hasReleaseFiles = (files: ThemeReleaseFiles) => Boolean(files.theme && files.manifest);

        const downloadThemeReleaseFiles = async (
            repo: string,
            tag: string,
            latestRelease: ThemeRelease
        ): Promise<ThemeReleaseFiles> => {
            const files: ThemeReleaseFiles = {
                manifest: null,
                theme: null,
            };
            const assets = latestRelease.assets ?? [];
            const findAsset = (fileName: string) => assets.find((asset) =>
                asset.name?.toLowerCase() === fileName &&
                typeof asset.browser_download_url === "string"
            );
            const themeAsset = findAsset("theme.css");
            const manifestAsset = findAsset("manifest.json");
            if (themeAsset?.browser_download_url) {
                files.theme = await getReleaseFile(themeAsset.browser_download_url, themeAsset.name ?? "theme.css");
            }
            if (manifestAsset?.browser_download_url) {
                files.manifest = await getReleaseFile(manifestAsset.browser_download_url, manifestAsset.name ?? "manifest.json");
            }
            if (hasReleaseFiles(files)) {
                return files;
            }

            const zipAssets = assets.filter((asset) =>
                asset.name?.toLowerCase().endsWith(".zip") &&
                typeof asset.browser_download_url === "string"
            );
            for (const asset of zipAssets) {
                const zipBytes = await getReleaseZipFile(asset.browser_download_url as string, asset.name ?? "zip asset");
                if (zipBytes) {
                    fillMissingFiles(files, await extractThemeFilesFromZip(zipBytes));
                    if (hasReleaseFiles(files)) {
                        return files;
                    }
                }
            }

            const sourceZipUrl = `https://github.com/${repo}/archive/refs/tags/${tag}.zip`;
            const sourceZipBytes = await getReleaseZipFile(sourceZipUrl, `${repo}@${tag}`);
            if (sourceZipBytes) {
                fillMissingFiles(files, await extractThemeFilesFromZip(sourceZipBytes));
            }

            return files;
        };

        const writeToThemeFolder = async (themeID: string, files: ThemeReleaseFiles): Promise<boolean> => {
            const themeTargetFolderPath = normalizePath(this.app.vault.configDir + "/themes/" + themeID) + "/";
            const adapter = this.app.vault.adapter;
            if (!files.theme || !files.manifest) {
                this.log("downloaded files are empty");
                return false;
            }
            try {
                if (await adapter.exists(themeTargetFolderPath) === false) {
                    await adapter.mkdir(themeTargetFolderPath);
                }
                await adapter.write(themeTargetFolderPath + "theme.css", files.theme);
                await adapter.write(themeTargetFolderPath + "manifest.json", files.manifest);
                this.log(`updated theme[${themeID}]`);
                return true;
            } catch (error) {
                this.log(`failed to write theme[${themeID}]`, error);
                return false;
            }
        };

        const reloadCurrentTheme = async (updatedThemes: string[]) => {
            const currentTheme = (this.app.vault as typeof this.app.vault & {
                getConfig?: (key: string) => unknown;
            }).getConfig?.("cssTheme");
            if (typeof currentTheme !== "string" || !updatedThemes.includes(currentTheme)) {
                return;
            }

            const customCss = (this.app as App & { customCss?: ObsidianCustomCss }).customCss;
            if (customCss?.readThemes) {
                try {
                    await customCss.readThemes(true);
                    return;
                } catch (error) {
                    this.log(`failed to reload current theme[${currentTheme}] with readThemes`, error);
                }
            }
            if (customCss?.reloadTheme) {
                try {
                    await customCss.reloadTheme();
                    return;
                } catch (error) {
                    this.log(`failed to reload current theme[${currentTheme}] with reloadTheme`, error);
                }
            }

            this.log(`updated current theme[${currentTheme}] but Obsidian theme reload API is unavailable`);
            new Notice("Theme files updated. Switch themes or restart Obsidian to apply.", 5000);
        };

        const updatedThemes: string[] = [];
        this.progressBar.show();
        for (let i = 0; i < this.items.length; i++) {
            const theme = this.items[i];
            const repo = await this.getRepo(theme.id);
            const latestRelease = await this.getLatestRelease(repo);
            const need2Update = await this.isNeedToUpdate(latestRelease, theme.version);
            if (repo && latestRelease && need2Update.needUpdate) {
                this.totalThemes++;
                this.items[i].toUpdate = {
                    needUpdate: need2Update.needUpdate,
                    repo: repo,
                    targetVersion: need2Update.targetVersion,
                    isZipFile: false
                };
                this.items[i].latestRelease = latestRelease;
                this.progressBar.addDiv(theme.id, `update ${theme.id} to ${need2Update.targetVersion}`);
            }
        }

        const promiseThemesUpdating = this.items.map(async (theme) => {
            if (theme.toUpdate?.needUpdate) {
                this.log("updating theme " + theme.id);
                const repo = theme.toUpdate.repo;
                const tag = theme.toUpdate.targetVersion;
                const latestRelease = theme.latestRelease;
                if (!latestRelease) {
                    this.log(`skip updating theme[${theme.id}] because release data is missing`);
                    return;
                }
                const releases = await downloadThemeReleaseFiles(repo, tag, latestRelease);
                const updated = await writeToThemeFolder(theme.id, releases);
                if (updated) {
                    updatedThemes.push(theme.id);
                    // update notice display
                    this.progressBar.stepin(theme.id, `update ${theme.id} to ${tag}`, this.totalThemes);
                    this.checkedThemes++;
                } else {
                    this.log(`skip reloading theme[${theme.id}] because update did not write required files`);
                }
            }
        });
        await Promise.all(promiseThemesUpdating);
        await reloadCurrentTheme(updatedThemes);
        this.log('All async theme updating completed')
        // finally plugin updating has been done, whether there are plugins that need to be updated
        this.progressBar.updateProgress(100);
        // hide notice
        setTimeout(() => { this.progressBar.hide(); }, 2000);
    }
}
