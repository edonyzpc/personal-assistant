import { App, Notice, type PluginManifest, normalizePath, request } from "obsidian";
import { PluginManager } from "plugin";
import { gt, prerelease } from "semver";

import { ProgressBar } from "./progressBar";
import { downloadZipFile, extractFile } from "./utils";

interface Manifest {
    id: string,
    version: string,
    toUpdate?: {
        needUpdate: boolean,
        repo: string,
        targetVersion: string,
        isZipFile: boolean,
    },
}

interface ObsidianManifest {
    items: Manifest[],
    URLCDN: string,
    getRepo(ID: string): Promise<string | null>,
    isNeedToUpdate(m: Manifest): Promise<boolean>,
    update(): Promise<void>,
}

interface PluginReleaseFiles {
    mainJs:     string | null;
    manifest:   string | null;
    styles:     string | null;
}

interface ThemeReleaseFiles {
    manifest:   string | null;
    theme:     string | null;
}

export class PluginsUpdater implements ObsidianManifest {
    items: Manifest[];
    URLCDN: string;
    app: App;
    private TagName = 'tag_name';
    private commandPlugin: PluginManager;
    private log: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    private notice: Notice;
    private noticeEl: DocumentFragment;
    private totalPlugins: number;
    private checkedPlugins: number;
    // json object of obsidian community plugins,
    // and source is in https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json
    private communityPlugins: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    private progressBar: ProgressBar;

    constructor(app: App, plugin: PluginManager) {
        this.app = app;
        this.commandPlugin = plugin;
        this.log = (...msg: any) => plugin.log(...msg); // eslint-disable-line @typescript-eslint/no-explicit-any
        this.URLCDN = `https://cdn.jsdelivr.net/gh/obsidianmd/obsidian-releases/community-plugins.json`;
        this.items = [];
        for (const m of Object.values((app as any).plugins.manifests)) { // eslint-disable-line @typescript-eslint/no-explicit-any
            const i:Manifest = {
                id: (m as PluginManifest).id,
                version: (m as PluginManifest).version,
            };
            this.items.push(i);
        }
        this.totalPlugins = 0;
        this.checkedPlugins = 0;

        this.progressBar = new ProgressBar(plugin, "plugin-updating", this.totalPlugins);
    }

    private async getCommunityPluginsJson(): Promise<string|null> {
        try {
            const response = await request({ url: this.URLCDN });
            return (response === "404: Not Found" ? null : response);
        } catch (error) {
            this.log("error in getCommunityPlugins", error)
            return null;
        }
    }

    async getRepo(pluginID: string): Promise<string | null> {
        if (this.commandPlugin.settings.cachePluginRepo[pluginID]) {
            return this.commandPlugin.settings.cachePluginRepo[pluginID];
        }
        if (!this.communityPlugins) {
            // cache the community plugins json
            const communityPluginsJson = await this.getCommunityPluginsJson();
            if (communityPluginsJson) {
                this.communityPlugins = JSON.parse(communityPluginsJson);
            }
        }
        for (let i = 0; i < this.communityPlugins.length; i++) {
            const { id, repo } = this.communityPlugins[i];
            if (id === pluginID) {
                // cache the `repo <----> plugin-id` into data.json for fast getting
                this.commandPlugin.settings.cachePluginRepo[pluginID] = repo;
                await this.commandPlugin.saveSettings();
                return repo;
            }
        }
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
            if(error!="Error: Request failed, status 404")  { //normal error, ignore
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

    async isNeedToUpdate(m: Manifest): Promise<boolean> {
        const repo = await this.getRepo(m.id);
        if (repo) {
            this.log("checking need to update for "+repo);
            const latestRelease = await this.getLatestRelease(repo);
            if (latestRelease) {
                let tag = this.getLatestTag(latestRelease);
                if (tag) {
                    if (tag.startsWith('v')) tag = tag.split('v')[1];
                    this.log("latest tag: " + tag, "current tag: " + m.version);
                    // /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)((-)(alpha|beta|rc)(\d+))?((\+)(\d+))?$/gm
                    const pre = prerelease(tag);
                    if (pre) {
                        if (pre.length > 0) {
                            // do not update pre-release version
                            return false;
                        }
                    }
                    if (gt(tag, m.version)) {
                        return true;
                    }
                }
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
                this.log("error in grabReleaseFileFromRepository", URL, error)
                return null;
            }
        };
        const writeToPluginFolder = async (pluginID: string, files: PluginReleaseFiles): Promise<void> => {
            const pluginTargetFolderPath = normalizePath(this.app.vault.configDir + "/plugins/" + pluginID) + "/";
            const adapter = this.app.vault.adapter;
            if (!files.mainJs || !files.manifest) {
                this.log("downloaded files are empty");
                return;
            }
            if (await adapter.exists(pluginTargetFolderPath) === false ||
                !(await adapter.exists(pluginTargetFolderPath + "manifest.json"))) {
                // if plugin folder doesnt exist or manifest.json doesn't exist, create it and save the plugin files
                await adapter.mkdir(pluginTargetFolderPath);
            }
            await adapter.write(pluginTargetFolderPath + "main.js", files.mainJs);
            await adapter.write(pluginTargetFolderPath + "manifest.json", files.manifest);
            if (files.styles) await adapter.write(pluginTargetFolderPath + "styles.css", files.styles);
            this.log(`updated plugin[${pluginID}]`);
        };

        this.progressBar.show();
        for (let i = 0; i < this.items.length; i++) {
            const plugin = this.items[i];
            const repo = await this.getRepo(plugin.id);
            const latestRlease = await this.getLatestRelease(repo);
            const tag = this.getLatestTag(latestRlease);
            const need2Update = await this.isNeedToUpdate(plugin);
            if (need2Update && repo && tag) {
                this.totalPlugins++;
                this.items[i].toUpdate = {
                    needUpdate: true,
                    repo: repo,
                    targetVersion: tag,
                    // plugin release has `main.js + styles.css + manifest.json`
                    isZipFile: false,
                };
                this.progressBar.addDiv(plugin.id, `update ${plugin.id} to ${tag}`);
            }
        }

        const promisePluginsUpdating = this.items.map(async (plugin) => {
            if (plugin.toUpdate?.needUpdate) {
                this.log("updating plugin " + plugin.id);
                const releases: PluginReleaseFiles = {
                    mainJs: null,
                    manifest: null,
                    styles: null,
                };
                const repo = plugin.toUpdate.repo;
                const tag = plugin.toUpdate.targetVersion;
                releases.mainJs = await getReleaseFile(repo, tag, 'main.js');
                releases.manifest = await getReleaseFile(repo, tag, 'manifest.json');
                releases.styles = await getReleaseFile(repo, tag, 'styles.css');
                await writeToPluginFolder(plugin.id, releases);
                // reload plugins after updated
                (this.app as any).plugins.enablePluginAndSave(plugin.id); // eslint-disable-line @typescript-eslint/no-explicit-any
                // update notice display
                this.progressBar.stepin(plugin.id, `update ${plugin.id} to ${tag}`, this.totalPlugins);
                this.checkedPlugins++;
            }
        });
        await Promise.all(promisePluginsUpdating);
        this.log('All async plugin updating completed')
        // finally plugin updating has been done, whether there are plugins that need to be updated
        this.progressBar.updateProgress(100);
        // hide notice
        setInterval(() => { this.progressBar.hide(); }, 2000);
    }
}

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

    static async init(app: App, plugin:PluginManager): Promise<ThemeUpdater> {
        const themeUpdater = new ThemeUpdater(app, plugin);
        themeUpdater.items = await themeUpdater.listThemes(themeUpdater.app);
        const themeJson  = await themeUpdater.getCommunityThemesJson();
        if (themeJson) {
            themeUpdater.communityThemes = JSON.parse(themeJson);
        } else {
            new Notice("fail to get community themes", 1500);
        }
        return themeUpdater;
    }

    // list obsidian themes
    private async listThemes(app: App): Promise<Manifest[]> {
        const themes:Manifest[] = [];
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

    private async getCommunityThemesJson(): Promise<string|null> {
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
        this.URLCDN = `https://cdn.jsdelivr.net/gh/obsidianmd/obsidian-releases/community-css-themes.json`;
        this.commandPlugin = plugin;
        this.log = (...msg: any) => plugin.log(...msg); // eslint-disable-line @typescript-eslint/no-explicit-any
        this.totalThemes = 0;
        this.checkedThemes = 0;

        this.progressBar = new ProgressBar(plugin, "theme-updating", this.totalThemes);
    }

    async getRepo(themeID: string): Promise<string | null> {
        if (this.commandPlugin.settings.cacheThemeRepo[themeID]) {
            return this.commandPlugin.settings.cacheThemeRepo[themeID];
        }
        if (!this.communityThemes) {
            // cache the community plugins json
            const communityThemesJson = await this.getCommunityThemesJson();
            if (communityThemesJson) {
                this.communityThemes = JSON.parse(communityThemesJson);
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
            if(error!="Error: Request failed, status 404")  { //normal error, ignore
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

    async isNeedToUpdate(m: Manifest): Promise<boolean> {
        const repo = await this.getRepo(m.id);
        if (repo) {
            this.log("checking need to update for "+repo);
            const latestRelease = await this.getLatestRelease(repo);
            if (latestRelease) {
                let tag = this.getLatestTag(latestRelease);
                if (tag) {
                    if (tag.startsWith('v')) tag = tag.split('v')[1];
                    this.log("latest tag: " + tag, "current tag: " + m.version);
                    // /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)((-)(alpha|beta|rc)(\d+))?((\+)(\d+))?$/gm
                    const pre = prerelease(tag);
                    if (pre) {
                        if (pre.length > 0) {
                            // do not update pre-release version
                            return false;
                        }
                    }
                    if (gt(tag, m.version)) {
                        return true;
                    }
                }
            }
        }
        return false;
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
                this.log("error in grabReleaseFileFromRepository", URL, error)
                return null;
            }
        };
        const getReleaseZipFile = async (repo: string | null, version: string | null) => {
            const ZIPURL = `https://github.com/${repo}/archive/refs/tags/${version}.zip`;
            try {
                return await downloadZipFile(ZIPURL);
            } catch (error) {
                this.log("error in grabReleaseFileFromRepository", URL, error)
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
            const tag = this.getLatestTag(latestRlease);
            const need2Update = await this.isNeedToUpdate(theme);
            if (need2Update && repo && tag) {
                this.totalThemes++;
                const isZip = await this.onlyHaveZipFile(this.items[i]);
                this.items[i].toUpdate = {
                    needUpdate: true,
                    repo: repo,
                    targetVersion: tag,
                    isZipFile: isZip
                };
                this.progressBar.addDiv(theme.id, `update ${theme.id} to ${tag}`);
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
