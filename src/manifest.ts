import { App, PluginManifest, normalizePath, request } from "obsidian";

export class PluginUpdater {

    constructor(app: App) {
        //let rootPath = app.vault.configDir;
        //let plugins: PluginManifest[] = (app as any).plugins.manifests;
    }
}

// get all of the plugins whose manifests can be parsed
export function getPluginManifests(app: App): PluginManifest[] {
    const pluginManiftests:PluginManifest[] = [];
    for (const m of Object.values((app as any).plugins.manifests)) { // eslint-disable-line @typescript-eslint/no-explicit-any
        pluginManiftests.push(m as PluginManifest);
    }

    return pluginManiftests;
}

// get the latest release object from github
export async function graLatestRelease(repo: string | null): Promise<JSON | null> {
    if (!repo) return null;
    const URL = `https://api.github.com/repos/${repo}/releases/latest`;
    try {
        const response = await request({ url: URL });
        return (response === "404: Not Found" ? null : await JSON.parse(response));
    } catch (error) {
        if(error!="Error: Request failed, status 404")  { //normal error, ignore
            console.log(`error in grabManifestJsonFromRepository for ${URL}`, error);
        }
        return null;
    }
}

// get the latest tag from the latest release object
export function getLatestTag(latest: JSON | null): string | null {
    if (!latest) return null;
    Object.getOwnPropertyNames(latest).forEach(key => {
        if (key === 'tag_name') return  Object(latest)[key];
    })
    return null;
}

export async function getPluginRepo(ID: string): Promise<string|null> {
    // if use raw.githubcontent.com to download, timeout will occur frequently
    //const pluginListURL = `https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugins.json`;
    const pluginListURLCDN = `https://cdn.jsdelivr.net/gh/obsidianmd/obsidian-releases/community-plugins.json`;
    try {
        const response = await request({ url: pluginListURLCDN });
        const getRepo = (r:string): string|null => {
            const lists = JSON.parse(r);
            for (let i = 0; i < lists.length; i++) {
                const { id, repo } = lists[i];
                if (id === ID) {
                    return repo;
                }
            }
            return null;
        }
        return (response === "404: Not Found" ? null : getRepo(response));
    } catch (error) {
        console.log("error in getPluginRepo", error)
        return null;
    }
}

export async function isNeedToUpdate(m: PluginManifest): Promise<boolean> {
    const repo = await getPluginRepo(m.id);
    if (repo) {
        const latestRelease = await graLatestRelease(repo);
        if (latestRelease) {
            let tag = getLatestTag(latestRelease);
            if (tag) {
                if (tag.startsWith('v')) tag = tag.split('v')[1];
                if (tag > m.version) {
                    return true;
                }
            }
        }
    }

    return false;
}

export async function getReleaseFile(repo:string|null, version:string|null, fileName:string) {
    const URL = `https://github.com/${repo}/releases/download/${version}/${fileName}`;
    try {
        const download = await request({ url: URL });
        return ((download === "Not Found" || download === `{"error":"Not Found"}`) ? null : download);
    } catch (error) {
        console.log("error in grabReleaseFileFromRepository", URL, error)
        return null;
    }
}

interface ReleaseFiles {
    mainJs:     string | null;
    manifest:   string | null;
    styles:     string | null;
}
export async function writeReleaseFilesToPluginFolder(pluginID: string, files: ReleaseFiles): Promise<void> {
    const pluginTargetFolderPath = normalizePath(this.plugin.app.vault.configDir + "/plugins/" + pluginID) + "/";
    const adapter = this.plugin.app.vault.adapter;
    if (await adapter.exists(pluginTargetFolderPath) === false ||
        !(await adapter.exists(pluginTargetFolderPath + "manifest.json"))) {
        // if plugin folder doesnt exist or manifest.json doesn't exist, create it and save the plugin files
        await adapter.mkdir(pluginTargetFolderPath);
    }
    await adapter.write(pluginTargetFolderPath + "main.js", files.mainJs);
    await adapter.write(pluginTargetFolderPath + "manifest.json", files.manifest);
    if (files.styles) await adapter.write(pluginTargetFolderPath + "styles.css", files.styles);
}


export async function updatePlugins(app:App) {
    const plugins = getPluginManifests(app);
    plugins.forEach(async (plugin) => {
        const repo = await getPluginRepo(plugin.id);
        const latestRlease = await graLatestRelease(repo);
        const tag = getLatestTag(latestRlease);
        if (await isNeedToUpdate(plugin)) {
            const releases:ReleaseFiles = {
                mainJs:null,
                manifest:null,
                styles:null,
            }
            releases.mainJs = await getReleaseFile(repo, tag, 'main.js');
            releases.manifest = await getReleaseFile(repo, tag, 'manifest.json');
            releases.mainJs = await getReleaseFile(repo, tag, 'styles.css');
            await writeReleaseFilesToPluginFolder(plugin.id, releases);
        }
    })
}