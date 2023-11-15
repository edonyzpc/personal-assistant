/* Copyright 2023 edonyzpc */

import { App, type PluginManifest, normalizePath, request } from 'obsidian';
import { gt, prerelease } from "semver";
import { PluginManager } from "./plugin";
import type { ObsidianManifest, Manifest, UpdateStatus, PluginReleaseFiles } from "./types/manifest";
import { ProgressBar } from "./progressBar";


export class PluginsUpdater implements ObsidianManifest {
    items: Manifest[];
    URLCDN: string;
    app: App;
    private TagName = 'tag_name';
    private commandPlugin: PluginManager;
    private log: any; // eslint-disable-line @typescript-eslint/no-explicit-any
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
        this.URLCDN = `https://cdn.jsdelivr.net/gh/obsidianmd/obsidian-releases@master/community-plugins.json`;
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
            this.log("error in getCommunityPlugins", error);
            return null;
        }
    }

    async getRepo(pluginID: string): Promise<string | null> {
        if (this.commandPlugin.settings.cachePluginRepo[pluginID]) {
            this.log(`found ${pluginID} which cached in data.json`);
            return this.commandPlugin.settings.cachePluginRepo[pluginID];
        }
        if (!this.communityPlugins) {
            // cache the community plugins json
            const communityPluginsJson = await this.getCommunityPluginsJson();
            if (communityPluginsJson) {
                this.communityPlugins = JSON.parse(communityPluginsJson);
            } else {
                this.log("fail to get commnity plugin json file from jsdelivr");
                return null;
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

        this.log("fail to find plugin in community-plugins.json");
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

    async isNeedToUpdate(latestRelease: JSON|null, currentVersion: string): Promise<UpdateStatus> {
        if (latestRelease) {
            let tag = this.getLatestTag(latestRelease);
            if (tag) {
                if (tag.startsWith('v')) tag = tag.split('v')[1];
                this.log("latest tag: " + tag, "current tag: " + currentVersion);
                // /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)((-)(alpha|beta|rc)(\d+))?((\+)(\d+))?$/gm
                const pre = prerelease(tag);
                if (pre) {
                    if (pre.length > 0) {
                        // do not update pre-release version
                        return {
                            needUpdate: false,
                            targetVersion: currentVersion,
                        }
                    }
                }
                if (gt(tag, currentVersion)) {
                    return {
                        needUpdate: true,
                        targetVersion: tag,
                    };
                }
            }
        }
        return {
            needUpdate: false,
            targetVersion: currentVersion,
        }
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
            this.log(`checking updating status for ${plugin.id}`);
            const need2Update = await this.isNeedToUpdate(latestRlease, plugin.version);
            if (repo && latestRlease && need2Update.needUpdate) {
                this.totalPlugins++;
                this.items[i].toUpdate = {
                    needUpdate: need2Update.needUpdate,
                    repo: repo,
                    targetVersion: need2Update.targetVersion,
                    // plugin release has `main.js + styles.css + manifest.json`
                    isZipFile: false,
                };
                this.progressBar.addDiv(plugin.id, `update ${plugin.id} to ${need2Update.targetVersion}`);
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