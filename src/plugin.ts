/* Copyright 2023 edonyzpc */

import { type Debouncer, type MarkdownFileInfo, Editor, MarkdownView, Notice, Plugin, TFile, addIcon, debounce, normalizePath, setIcon } from 'obsidian';
import moment from 'moment';
import { type CalloutManager, getApi } from "obsidian-callout-manager";

import { AssistantFeaturedImageHelper, AssistantHelper, SimilaritySearch } from "./ai"
import { PluginControlModal } from './modal'
import { BatchPluginControlModal } from './batchModal'
import { SettingTab, type PluginManagerSettings, DEFAULT_SETTINGS } from './settings'
import { LocalGraph } from './localGraph';
import { icons } from './utils';
import { PluginsUpdater } from './pluginManifest';
import { ThemeUpdater } from './themeManifest';
import { monkeyPatchConsole } from './obsidian-hack/obsidian-mobile-debug';
import { CalloutModal } from './callout';
import { RecordPreview, RECORD_PREVIEW_TYPE } from './preview';
import { STAT_PREVIEW_TYPE, Stat } from './statsView'
import StatsManager from './stats/StatsManager'
import { pluginField, statusBarEditorPlugin, sectionWordCountEditorPlugin } from './stats/EditorPlugin'
import AIWindow from './components/AIWindow.svelte'

const debug = (debug: boolean, ...msg: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (debug) console.log(...msg);
};

export class PluginManager extends Plugin {
    settings!: PluginManagerSettings
    private localGraph = new LocalGraph(this.app, this);
    calloutManager: CalloutManager<true> | undefined;
    private updateDebouncer!: Debouncer<[file: TFile | null], void>;
    private settingTab: SettingTab = new SettingTab(this.app, this);
    statsManager: StatsManager | undefined;
    private aiFloatingHelper: AIWindow | undefined;

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
            this.registerView(
                STAT_PREVIEW_TYPE,
                (leaf) => { return new Stat(this.app, this, leaf); }
            )
        });
        this.statsManager = new StatsManager(this.app, this);

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
            id: "batch-switch-on-or-off-plugins",
            name: "Batch switch on/off plugins according to their status",
            callback: () => {
                const modal = new BatchPluginControlModal(this.app);
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

        this.addCommand({
            id: "show-statistics",
            name: "Show statistics",
            callback: async () => {
                await this.activeStatView();
            }
        })

        this.addCommand({
            id: 'ai-assistant-summary',
            name: 'AI Summary',
            editorCallback: async (editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
                const sel = editor.getSelection();
                const v = editor.getValue();

                this.log(`You have selected: ${sel}`);
                this.log(`You have value: ${v}`);
                if (view instanceof MarkdownView) {
                    this.log("invoking LLM");
                    const helper = new AssistantHelper(this, editor, view);
                    await helper.generate();
                }
            }
        });

        this.addCommand({
            id: 'ai-assistant-featured-images',
            name: 'AI Featured Images',
            editorCallback: async (editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
                const sel = editor.getSelection();
                const v = editor.getValue();

                this.log(`You have selected: ${sel}`);
                this.log(`You have value: ${v}`);
                if (view instanceof MarkdownView) {
                    this.log("invoking LLM");
                    const helper = new AssistantFeaturedImageHelper(this.app, this, editor, view);
                    await helper.generate();
                }
            }
        });

        this.addCommand({
            id: "ai-assistant-floating",
            name: "AI Auto Robot",
            editorCallback: async (editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
                const aiEl = document.getElementById("floating-ai");
                if (aiEl && this.aiFloatingHelper) {
                    this.aiFloatingHelper.$destroy();
                    this.aiFloatingHelper = undefined;
                } else {
                    const sel = editor.getSelection();
                    if (view instanceof MarkdownView) {
                        this.aiFloatingHelper = new AIWindow({
                            target: globalThis.document.getElementsByClassName('app-container')[0],
                            props: {
                                plugin: this,
                                editor: editor,
                                view: view,
                                app: this.app,
                                selectedQuery: sel
                            }
                        });
                    }
                }
            }
        });

        this.addCommand({
            id: "ai-assistant-similarity-search",
            name: "AI Similarity Search",
            editorCallback: async (editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
                const sel = editor.getSelection();
                const v = editor.getValue();
                const { vault } = this.app;
                const configDir = vault.configDir;
                const dbPath = this.join(configDir, "vss-cache.json");
                console.log("dbPath: ", dbPath);
                this.log(`You have selected: ${sel}`);
                this.log(`You have value: ${v}`);
                if (view instanceof MarkdownView) {
                    this.log("invoking LLM");
                    const search = new SimilaritySearch(dbPath, this, editor, view);
                    await search.vectorStore();
                }
            }
        });

        // Handle the Editor Plugins
        this.registerEditorExtension([pluginField.init(() => this), statusBarEditorPlugin, sectionWordCountEditorPlugin]);

        this.registerEvent(
            this.app.workspace.on("active-leaf-change", async (leaf) => {
                if (this.statsManager)
                    await this.statsManager.recalcTotals();
            })
        );
        this.registerEvent(
            this.app.vault.on("delete", async () => {
                if (this.statsManager)
                    await this.statsManager.recalcTotals();
            })
        );

        // This adds a settings tab so the user can configure various aspects of the plugin
        this.addSettingTab(this.settingTab);
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
        } catch (error: unknown) {
            new Notice((error as Error).toString());
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

    private updateMetadata = (file: TFile | null) => {
        if (file instanceof TFile) {
            if ((file as TFile).extension === 'md') {
                let filterPath = file.path;
                // filter with excluding setting paths
                for (const path of this.settings.metadataExcludePath) {
                    if (path !== "" && file.path.startsWith(path)) {
                        this.log(`filtered ${file.path} in ${path}`)
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

        await this.app.workspace.revealLeaf(viewLeaf);
    }

    async activeStatView() {
        this.app.workspace.detachLeavesOfType(STAT_PREVIEW_TYPE);

        const viewLeaf = this.app.workspace.getLeaf('tab');
        await viewLeaf.setViewState({
            type: STAT_PREVIEW_TYPE,
            active: true,
        });

        await this.app.workspace.revealLeaf(viewLeaf);
    }
}

