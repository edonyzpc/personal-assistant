import { type Debouncer, Notice, Plugin, TFile, addIcon, debounce, normalizePath, setIcon } from 'obsidian';
import moment from 'moment';
import { type CalloutManager, getApi} from "obsidian-callout-manager";

import { PluginControlModal } from './modal'
import { SettingTab, type PluginManagerSettings, DEFAULT_SETTINGS } from './settings'
import { LocalGraph } from './localGraph';
import { Memos } from './memos';
import { icons } from './utils';
import { PluginsUpdater } from './pluginManifest';
import { ThemeUpdater } from './themeManifest';
import { monkeyPatchConsole } from './obsidian-hack/obsidian-mobile-debug';
import { CalloutModal } from './callout';
import { RecordPreview, RECORD_PREVIEW_TYPE } from './preview';

const debug = (debug: boolean, ...msg: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (debug) console.log(...msg);
};

export class PluginManager extends Plugin {
    settings: PluginManagerSettings
    private localGraph = new LocalGraph(this.app, this);
    private memos = new Memos(this.app, this);
    calloutManager: CalloutManager<true> | undefined;
    private updateDebouncer:Debouncer<[file: TFile | null], void>;

    async onload() {
        await this.loadSettings();
        // showup notification of plugin starting when it is in debug mode
        if (this.settings.debug) {
            new Notice("starting obsidian assistant");
            // register mobile debug log
            monkeyPatchConsole(this);
        }
        // observe element which is concerned by commands
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if ((node instanceof HTMLElement)) {
                        document.querySelectorAll('.popover.hover-popover.hover-editor').forEach((el) => {
                            this.log("observing...")
                            this.localGraph.resize();
                            this.memos.resize();
                        })
                    }
                });
            });
        });
        observer.observe(document.body, {
            attributes: true,
            childList: true
        });

        // This creates an icon in the left ribbon.
        addIcon('PluginAST', icons['PluginAST']);
        const ribbonIconEl = this.addRibbonIcon('PluginAST', 'Obsidian Assistant', (evt: MouseEvent) => {
            // Called when the user clicks the icon.
            new PluginControlModal(this.app).open();
        });
        ribbonIconEl.addClass('plugin-manager-ribbon-class');

        // This adds a status bar item to the bottom of the app. Does not work on mobile apps.
        const statusBarItemEl = this.addStatusBarItem();
        // status bar style setting
        statusBarItemEl.addClass('personal-assistant-statusbar');
        statusBarItemEl.setAttribute("id", `personal-assistant-statusbar`);
        addIcon('PluginAST_STATUSBAR', icons['PluginAST_STATUSBAR']);
        setIcon(statusBarItemEl, 'PluginAST_STATUSBAR');
        // status bar event handling
        statusBarItemEl.onClickEvent((e) => {
            // showup setting tab of this plugin
            (this.app as any).setting.open(); // eslint-disable-line @typescript-eslint/no-explicit-any
            (this.app as any).setting.openTabById('personal-assistant'); // eslint-disable-line @typescript-eslint/no-explicit-any
        });

        // get callout manager api
        this.app.workspace.onLayoutReady(async () => {
            this.calloutManager = await getApi(this);
            // register preview view type after the layout is ready
            this.registerView(
                RECORD_PREVIEW_TYPE,
                (leaf) => { return new RecordPreview(this.app, this, leaf); }
            );
        })

        this.addCommand({
            id: 'startup-recording',
            name: 'Open specific note to record',
            callback: async () => {
                const fileFormat = moment().format(this.settings.fileFormat);
                const targetDir = this.settings.targetPath;
                this.log(targetDir, fileFormat);
                await this.createNewNote(targetDir, fileFormat);
            }
        });

        this.addCommand({
            id: 'memos',
            name: 'assistant hover memos',
            callback: async () => {
                await this.memos.startup();
            }
        });

        this.addCommand({
            id: 'local-graph',
            name: 'hover local graph',
            callback: async () => {
                await this.localGraph.startup();
            }
        });

        this.addCommand({
            id: 'switch-on-or-off-plugin',
            name: 'switch on/off plugin according to its status',
            callback: () => {
                const modal = new PluginControlModal(this.app);
                modal.setPlaceholder("Type plugin name to find it");
                modal.open();
            }
        });

        this.addCommand({
            id: 'set-local-graph-view-colors',
            name: 'Set graph view colors',
            callback: async () => {
                await this.localGraph.updateGraphColors();
            }
        });

        this.addCommand({
            id: 'update-plugins',
            name: "Update plugins with one command",
            callback: async () => {
                const pluginUpdater = new PluginsUpdater(this.app, this);
                await pluginUpdater.update();
            }
        })

        this.addCommand({
            id: 'update-themes',
            name: "Update themes with one command",
            callback: async () => {
                const themeUpdater = await ThemeUpdater.init(this.app, this);
                await themeUpdater.update();
            }
        })

        this.addCommand({
            id: 'update-metadata',
            name: "Update metadata with one command",
            callback: async () => {
                if (this.settings.enableMetadataUpdating) {
                    if (this.settings.isEnabledMetadataUpdating) {
                        // if the command has already triggered, disable it and remove status
                        const statusBar = document.getElementById("personal-assistant-statusbar");
                        statusBar?.removeClass("personal-assistant-statusbar-breathing");
                        // empty debounce which will stop updating metadata
                        this.updateDebouncer = debounce((file) => { }, 100, true);
                        // update the command triggered status
                        this.settings.isEnabledMetadataUpdating = false;
                    } else {
                        this.updateDebouncer = debounce(this.updateMetadata, 100, true);
                        // if updating metadata is enabled, set the status and monitor the events to update metadata
                        const statusBar = document.getElementById("personal-assistant-statusbar");
                        statusBar?.addClass("personal-assistant-statusbar-breathing");
                        this.registerEvent(this.app.workspace.on('file-open', (file) => {
                            this.updateDebouncer(file);
                        }));
                        // update the command triggered status
                        this.settings.isEnabledMetadataUpdating = true;
                    }
                } else {
                    new Notice("update metadata command is not enabled in setting tab");
                }
            }
        })


        this.addCommand({
            id: "list-callouts",
            name: "List callout for quickly insert",
            callback: () => {
                new CalloutModal(this.app, this).open();
            },
        });

        this.addCommand({
            id: "preview-records",
            name: "Preview records that are created by `startup-recording` command",
            callback: async () => {
                this.activateView();
            }
        })

        // This adds a settings tab so the user can configure various aspects of the plugin
        this.addSettingTab(new SettingTab(this.app, this));
    }

    onunload() {

    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        this.log("logging settings...", this.settings);
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    log(...msg: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        debug(this.settings.debug, ...msg);
    }

    // the following is referenced from https://github.com/vanadium23/obsidian-advanced-new-file/blob/master/src/CreateNoteModal.ts#L102
    private async createDirectory(dir: string): Promise<void> {
        const { vault } = this.app;
        const root = vault.getRoot().path;
        const directoryPath = this.join(root, dir);
        /**
         * NOTE: `getAbstractFileByPath` will return TAbstractFile or null,
         * so, to check if the directory is exists, compare the return
         * value by using `==`.
         **/
        if (vault.getAbstractFileByPath(directoryPath) == undefined) {
            await vault.createFolder(directoryPath);
        }
    }

    /**
     * Handles creating the new note
     * A new markdown file will be created at the given file path (`input`)
     * in the specified parent folder (`this.folder`)
     **/
    async createNewNote(targetPath: string, fileName: string): Promise<void> {
        const { vault } = this.app;
        const root = vault.getRoot().path;
        const directoryPath = this.join(root, targetPath);
        const filePath = this.join(directoryPath, `${fileName}.md`);

        try {
            if (this.app.vault.getAbstractFileByPath(filePath) instanceof TFile) {
                // If the file already exists, open it and send notification
                const files = vault.getMarkdownFiles();
                for (const file of files) {
                    if (file.path === filePath) {
                        const leaf = this.app.workspace.getLeaf('tab');
                        await leaf.openFile(file);
                        return;
                    }
                }
                throw new Error(`${filePath} already exists but fail to open`);
            }
            if (directoryPath !== '') {
                // If `input` includes a directory part, create it
                this.log("creating directory path: ", directoryPath);
                await this.createDirectory(directoryPath);
            }
            this.log("creating file: ", filePath);
            const File = await vault.create(filePath, '');
            // Create the file and open it in the active leaf
            const leaf = this.app.workspace.getLeaf('tab');
            await leaf.openFile(File);
        } catch (error) {
            new Notice(error.toString());
        }
    }

    /**
     * Joins multiple strings into a path using Obsidian's preferred format.
     * The resulting path is normalized with Obsidian's `normalizePath` func.
     * - Converts path separators to '/' on all platforms
     * - Removes duplicate separators
     * - Removes trailing slash
     **/
    private join(...strings: string[]): string {
        const parts = strings.map((s) => String(s).trim()).filter((s) => s != null);
        return normalizePath(parts.join('/'));
    }

    private updateMetadata = (file: TFile|null) => {
        if (file instanceof TFile) {
            if ((file as TFile).extension === 'md') {
                let filterPath = file.path;
                // filter with excluding setting paths
                for (const path of this.settings.metadataExcludePath) {
                    if (file.path.startsWith(path)) {
                        filterPath = "";
                        break;
                    }
                }
                // update metadata
                const meta = this.app.metadataCache.getCache(filterPath);
                if (meta && meta.frontmatter) {
                    this.app.fileManager.processFrontMatter(file, (frontmatter) => {
                        for (const key of Object.getOwnPropertyNames(frontmatter)) {
                            for (const metaConfig of this.settings.metadatas) {
                                if (key === metaConfig.key) {
                                    this.log((frontmatter as any)[key]); // eslint-disable-line @typescript-eslint/no-explicit-any
                                    let valut2Change: string;
                                    switch (metaConfig.t) {
                                        case 'moment':
                                            valut2Change = moment(new Date(file.stat.mtime)).format(metaConfig.value);
                                            break;
                                        case 'string':
                                            valut2Change = metaConfig.value;
                                            break;
                                        default:
                                            valut2Change = metaConfig.value;
                                            break;
                                    }
                                    (frontmatter as any)[key] = valut2Change; // eslint-disable-line @typescript-eslint/no-explicit-any
                                }
                            }
                        }
                        setTimeout(() => {
                            this.updateDebouncer.cancel();
                        }, 100);
                    });
                }
            }
        }
    };

    async activateView() {
        this.app.workspace.detachLeavesOfType(RECORD_PREVIEW_TYPE);

        const viewLeaf = this.app.workspace.getLeaf('tab');
        await viewLeaf.setViewState({
            type: RECORD_PREVIEW_TYPE,
            active: true,
        });

        this.app.workspace.revealLeaf(
            this.app.workspace.getLeavesOfType(RECORD_PREVIEW_TYPE)[0]
        );
  }
}

