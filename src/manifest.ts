import { App, Notice, PluginManifest, normalizePath, addIcon, setIcon, request } from "obsidian";
import { PluginManager } from "plugin";
import { gt } from "semver";

import { icons } from "./utils";

interface Manifest {
    id: string,
    version: string,
    toUpdate?: {
        needUpdate: boolean,
        repo: string,
        targetVersion: string,
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

        this.noticeEl = document.createDocumentFragment();
        // add progress bar:
        // ```
        // <div class='progress-bar-grid' >
        //   <div class='meter' >
        //     <span style='width:39.3%' > </span>
        //   </div >
        //   <div class='progress-bar-number' > 39.3 % </div > 
        // </div >
        // ```
        const divPluginUpdateProgressBarGrid = this.noticeEl.createEl("div", { attr: { id: `div-plugin-updating-progress-bar-grid` } });
        divPluginUpdateProgressBarGrid.addClass('progress-bar-grid');
        const divProgressBarMeter = divPluginUpdateProgressBarGrid.createEl("div", { attr: { id: `div-plugin-updating-progress-bar` } });
        divProgressBarMeter.addClass('meter');
        divProgressBarMeter.createEl('span', { attr: { style: `width: 0%`, id: `span-plugin-updating-progress-bar` } });
        const divProgressBarText = divPluginUpdateProgressBarGrid.createEl("div", { attr: { id: `div-plugin-updating-progress-bar-text` } });
        divProgressBarText.addClass('progress-bar-number');
        divProgressBarText.setText(`0%`);
        addIcon('PLUGIN_UPDATE_STATUS', icons['PLUGIN_UPDATE_STATUS']);
        addIcon('PLUGIN_UPDATED_STATUS', icons['PLUGIN_UPDATED_STATUS']);
        addIcon('SWITCH_ON_STATUS', icons['SWITCH_ON_STATUS']);
        addIcon('SWITCH_OFF_STATUS', icons['SWITCH_OFF_STATUS']);
    }

    async getRepo(pluginID: string): Promise<string | null> {
        try {
            const response = await request({ url: this.URLCDN });
            const getPluginRepo = (r: string): string | null => {
                const lists = JSON.parse(r);
                for (let i = 0; i < lists.length; i++) {
                    const { id, repo } = lists[i];
                    if (id === pluginID) {
                        return repo;
                    }
                }
                return null;
            };
            return (response === "404: Not Found" ? null : getPluginRepo(response));
        } catch (error) {
            this.log("error in getPluginRepo", error)
            return null;
        }
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
                this.log(`error in grabManifestJsonFromRepository for ${URL}`, error);
            }
            return null;
        }
    }

    private getLatestTag(latest: JSON | null): string | null {
        if (!latest) {
            this.log("JSON is null");
            return null;
        }
        for (let index = 0; index < Object.getOwnPropertyNames(latest).length; index++) {
            if (this.TagName === Object.getOwnPropertyNames(latest)[index]) {
                return Object(latest)[this.TagName] as string;
            }
        }

        this.log("final return null");
        return null;
    }

    async isNeedToUpdate(m: Manifest): Promise<boolean> {
        const repo = await this.getRepo(m.id);
        if (repo) {
            this.log("checking need to update for "+repo);
            const latestRelease = await this.getLatestRelease(repo);
            if (latestRelease) {
                let tag = this.getLatestTag(latestRelease);
                this.log("tag ==== ", tag);
                if (tag) {
                    this.log("tag == " + tag);
                    if (tag.startsWith('v')) tag = tag.split('v')[1];
                    this.log("tag = " + tag, "current tag: " + m.version);
                    // /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)((-)(alpha|beta|rc)(\d+))?((\+)(\d+))?$/gm
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
                };
                const div = this.noticeEl.createEl("div", { attr: { style: `color: red`, id: `div-${plugin.id}` } });
                setIcon(div, 'SWITCH_OFF_STATUS');
                div.createSpan({ text: `update ${plugin.id} to ${tag}`, attr: { style: "color: var(--text-normal);display: inline-block; height: 18px;top: 0.24em" } });
                div.querySelector('svg')?.addClass("plugin-update-svg");
            }
        }
        new Notice(this.noticeEl, 0);
        this.items.forEach(async (plugin) => {
            this.log("start to update " + plugin.id);
            if (plugin.toUpdate?.needUpdate) {
                this.log("updateing plugin " + plugin.id, 10);
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
                this.checkedPlugins++;
                const spanProgressBar = document.getElementById(`span-plugin-updating-progress-bar`);
                spanProgressBar?.setAttr("style", `width:${100 * (this.checkedPlugins / this.totalPlugins)}%`);
                const divProgressBarText = document.getElementById(`div-plugin-updating-progress-bar-text`);
                divProgressBarText?.setText(`${100 * (this.checkedPlugins / this.totalPlugins)}%`);
                const div2Display = document.getElementById(`div-${plugin.id}`);
                if (div2Display) {
                    const spanItem = div2Display.getElementsByTagName('span').item(0);
                    if (spanItem) {
                        div2Display.removeChild(spanItem);
                    }
                    const svgItem = div2Display.getElementsByTagName('svg').item(0);
                    if (svgItem) {
                        div2Display.removeChild(svgItem);
                    }
                    setIcon(div2Display, 'SWITCH_ON_STATUS');
                    div2Display.createSpan({ text: `update ${plugin.id} to ${tag}`, attr: { style: "color: var(--text-normal);display: inline-block; height: 18px;top: 0.24em" } });
                    div2Display.querySelector('svg')?.addClass("plugin-update-svg");
                    //setIcon(div2Display, 'PLUGIN_UPDATED_STATUS');
                }
            }
        })
    }
}

export class ThemeUpdater implements ObsidianManifest {
    items: Manifest[];
    URLCDN: string;
    app: App;
    private commandPlugin: PluginManager;
    private log: any; // eslint-disable-line @typescript-eslint/no-explicit-any

    public async init(app: App, plugin:PluginManager): Promise<ThemeUpdater> {
        const themeUpdater = new ThemeUpdater(app, plugin);
        themeUpdater.items = await this.listThemes(this.app);
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

    private constructor(app: App, plugin: PluginManager) {
        this.app = app;
        this.URLCDN = `https://cdn.jsdelivr.net/gh/obsidianmd/obsidian-releases/community-css-themes.json`;
        this.commandPlugin = plugin;
        this.log = (...msg: any) => plugin.log(...msg); // eslint-disable-line @typescript-eslint/no-explicit-any
    }

    async getRepo(pluginID: string): Promise<string | null> {
        return null;
    }

    async isNeedToUpdate(m: Manifest): Promise<boolean> {
        return false;
    }

    async update(): Promise<void> {
        const files: ThemeReleaseFiles = {
            manifest: "",
            theme: ""
        };
        this.log(files.manifest);
        return;
    }
}
