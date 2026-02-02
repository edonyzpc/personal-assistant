/* Copyright 2023 edonyzpc */

import { App, Notice, normalizePath, request } from 'obsidian';
import { gt, prerelease, valid } from "semver";
import { PluginManager } from "./plugin";
import type { ObsidianManifest, Manifest, UpdateStatus, ThemeReleaseFiles } from "./types/manifest";
import { ProgressBar } from "./progress-bar";
import { downloadZipFile, extractFile } from "./utils";

export class ThemeUpdater implements ObsidianManifest {
    items: Manifest[];
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
    private async listThemes(app: App): Promise<Manifest[]> {
        const themes: Manifest[] = [];
        const themeDirs = await app.vault.adapter.list(app.vault.configDir + '/themes');
        themeDirs.folders.forEach(async (f) => {
            const themeFile = normalizePath(f + '/manifest.json');
            const m = await app.vault.adapter.read(themeFile);
            const object = JSON.parse(m);
            themes.push({
                id: object.name,
                version: object.version,
            });
        })
        return themes;
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

    private async getLatestRelease(repo: string | null): Promise<JSON | null> {
        if (!repo) {
            this.log("repo is null");
            return null;
        }
        const URL = `https://api.github.com/repos/${repo}/releases/latest`;
        try {
            const response = await request({ url: URL });
            return (response === "404: Not Found" ? null : await JSON.parse(response));
        } catch (error) {
            if (error != "Error: Request failed, status 404") { //normal error, ignore
                this.log(`error in getLatestRelease for ${URL}`, error);
            }
            return null;
        }
    }

    private getLatestTag(latest: JSON | null): string | null {
        if (!latest) {
            this.log("the input JSON for getLatestTag is null");
            return null;
        }
        for (let index = 0; index < Object.getOwnPropertyNames(latest).length; index++) {
            if (this.TagName === Object.getOwnPropertyNames(latest)[index]) {
                return Object(latest)[this.TagName] as string;
            }
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

    async isNeedToUpdate(latestRelease: JSON | null, currentVersion: string): Promise<UpdateStatus> {
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

    async onlyHaveZipFile(m: Manifest): Promise<boolean> {
        const repo = await this.getRepo(m.id);
        if (repo) {
            this.log("checking need to only has zip file for " + repo);
            const latestRelease = await this.getLatestRelease(repo);
            if (latestRelease) {
                for (let index = 0; index < Object.getOwnPropertyNames(latestRelease).length; index++) {
                    if ("assets" === Object.getOwnPropertyNames(latestRelease)[index]) {
                        // if the object has `assets: []`, it means the theme release only has zip/tar file
                        if ((Object(latestRelease)["assets"] as Array<string>).length > 0) {
                            return false;
                        }
                    }
                }
                return true;
            }
        }

        return false;
    }

    async update(): Promise<void> {
        const getReleaseFile = async (repo: string | null, version: string | null, fileName: string) => {
            const URL = `https://github.com/${repo}/releases/download/${version}/${fileName}`;
            try {
                const download = await request({ url: URL });
                return ((download === "Not Found" || download === `{"error":"Not Found"}`) ? null : download);
            } catch (error) {
                this.log("error in grabReleaseFileFromRepository", URL, error);
                return null;
            }
        };
        const getReleaseZipFile = async (repo: string | null, version: string | null) => {
            const ZIPURL = `https://github.com/${repo}/archive/refs/tags/${version}.zip`;
            try {
                return await downloadZipFile(ZIPURL);
            } catch (error) {
                this.log("error in grabReleaseFileFromRepository", ZIPURL, error);
                return null;
            }
        };
        const writeToThemeFolder = async (themeID: string, files: ThemeReleaseFiles): Promise<void> => {
            const themeTargetFolderPath = normalizePath(this.app.vault.configDir + "/themes/" + themeID) + "/";
            const adapter = this.app.vault.adapter;
            if (!files.theme || !files.manifest) {
                this.log("downloaded files are empty");
                return;
            }
            if (await adapter.exists(themeTargetFolderPath) === false ||
                !(await adapter.exists(themeTargetFolderPath + "manifest.json"))) {
                // if plugin folder doesnt exist or manifest.json doesn't exist, create it and save the plugin files
                await adapter.mkdir(themeTargetFolderPath);
            }
            await adapter.write(themeTargetFolderPath + "theme.css", files.theme);
            await adapter.write(themeTargetFolderPath + "manifest.json", files.manifest);
            this.log(`updated theme[${themeID}]`);
        };

        this.progressBar.show();
        for (let i = 0; i < this.items.length; i++) {
            const theme = this.items[i];
            const repo = await this.getRepo(theme.id);
            const latestRlease = await this.getLatestRelease(repo);
            const need2Update = await this.isNeedToUpdate(latestRlease, theme.version);
            if (repo && latestRlease && need2Update.needUpdate) {
                this.totalThemes++;
                const isZip = await this.onlyHaveZipFile(this.items[i]);
                this.items[i].toUpdate = {
                    needUpdate: need2Update.needUpdate,
                    repo: repo,
                    targetVersion: need2Update.targetVersion,
                    isZipFile: isZip
                };
                this.progressBar.addDiv(theme.id, `update ${theme.id} to ${need2Update.targetVersion}`);
            }
        }

        const promiseThemesUpdating = this.items.map(async (theme) => {
            if (theme.toUpdate?.needUpdate) {
                this.log("updating theme " + theme.id);
                const releases: ThemeReleaseFiles = {
                    manifest: null,
                    theme: null,
                };
                const repo = theme.toUpdate.repo;
                const tag = theme.toUpdate.targetVersion;
                if (theme.toUpdate.isZipFile) {
                    const zipBytes = await getReleaseZipFile(repo, tag);
                    if (zipBytes) {
                        releases.theme = await extractFile(zipBytes, `theme.css`);
                        releases.manifest = await extractFile(zipBytes, `manifest.json`);
                    }
                } else {
                    releases.theme = await getReleaseFile(repo, tag, 'theme.css');
                    releases.manifest = await getReleaseFile(repo, tag, 'manifest.json');
                }
                await writeToThemeFolder(theme.id, releases);
                // update notice display
                this.progressBar.stepin(theme.id, `update ${theme.id} to ${tag}`, this.totalThemes);
                this.checkedThemes++;
            }
        });
        await Promise.all(promiseThemesUpdating);
        this.log('All async theme updating completed')
        // finally plugin updating has been done, whether there are plugins that need to be updated
        this.progressBar.updateProgress(100);
        // hide notice
        setInterval(() => { this.progressBar.hide(); }, 2000);
        // TODO: reload theme after updated
    }
}
