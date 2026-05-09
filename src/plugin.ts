/* Copyright 2023 edonyzpc */

import { type Debouncer, type MarkdownFileInfo, Editor, MarkdownView, Notice, Platform, Plugin, TFile, addIcon, debounce, normalizePath, setIcon } from 'obsidian';
import moment from 'moment';
import { type CalloutManager, getApi } from "obsidian-callout-manager";

import { VIEW_TYPE_LLM, LLMView } from "./chat-view";
import { AssistantFeaturedImageHelper, AssistantHelper } from "./ai";
import { VSS } from './vss'
import { PluginControlModal } from './modal'
import { BatchPluginControlModal } from './batch-modal'
import { SettingTab, type PluginManagerSettings, DEFAULT_SETTINGS } from './settings'
import { LocalGraph } from './local-graph';
import { CryptoHelper, icons, personalAssitant } from './utils';
import { PluginsUpdater } from './plugin-manifest';
import { ThemeUpdater } from './theme-manifest';
import { monkeyPatchConsole } from './obsidian-hack/obsidian-mobile-debug';
import { CalloutModal } from './callout';
import { RecordPreview, RECORD_PREVIEW_TYPE } from './preview';
import { STAT_PREVIEW_TYPE, Stat } from './stats-view'
import StatsManager from './stats/stats-manager'
import { pluginField, statusBarEditorPlugin, sectionWordCountEditorPlugin } from './stats/editor-plugin'
import { normalizeStatisticsView } from './stats/stats-store';
import { MemoryManager } from './memory-manager';

const CALLOUT_MANAGER_PLUGIN_ID = 'callout-manager';
const CALLOUT_MANAGER_READY_TIMEOUT_MS = 2000;
const CALLOUT_MANAGER_READY_POLL_MS = 50;
const MEMORY_STATUS_BAR_STATE_CLASSES = [
    "personal-assistant-ai-statusbar-ready",
    "personal-assistant-ai-statusbar-needs-update",
    "personal-assistant-ai-statusbar-needs-setup",
    "personal-assistant-ai-statusbar-unavailable",
    "personal-assistant-ai-statusbar-done",
] as const;

type MemoryStatusBarState = "ready" | "needs-update" | "needs-setup" | "unavailable";

interface ObsidianPluginRegistry {
    enabledPlugins?: Set<string>;
    plugins?: Record<string, unknown>;
}

const redactForLog = (value: unknown, seen = new WeakSet<object>()): unknown => {
    if (typeof value === 'string') {
        return value.replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-[redacted]');
    }
    if (!value || typeof value !== 'object') {
        return value;
    }
    if (seen.has(value)) {
        return '[Circular]';
    }
    seen.add(value);
    if (value instanceof Error) {
        return { name: value.name, message: redactForLog(value.message, seen) };
    }
    if (Array.isArray(value)) {
        return value.map((item) => redactForLog(item, seen));
    }
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
            if (/token|api[-_]?key|authorization|headers/i.test(key)) {
                return [key, '[redacted]'];
            }
            return [key, redactForLog(entry, seen)];
        }),
    );
};

const debug = (enabled: boolean, ...msg: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (enabled) console.log(...msg.map((item: unknown) => redactForLog(item)));
};

export class PluginManager extends Plugin {
    settings!: PluginManagerSettings
    private localGraph = new LocalGraph(this.app, this);
    calloutManager: CalloutManager<true> | undefined;
    private updateDebouncer!: Debouncer<[file: TFile | null], void>;
    private settingTab: SettingTab = new SettingTab(this.app, this);
    statsManager: StatsManager | undefined;
    vss!: VSS;
    memoryManager!: MemoryManager;
    vssCacheDir: string = this.join(this.app.vault.configDir, "plugins/personal-assistant/vss-cache");
    private isVssCached: boolean = false;
    cryptoHelper: CryptoHelper = new CryptoHelper();
    private token: string = "";
    private aiStatusBarItemEl: HTMLElement | null = null;


    async onload() {
        await this.loadSettings();

        // 迁移旧版本设置
        this.migrateSettings();

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

        if (Platform.isDesktop) {
            // This adds a status bar item to the bottom of the app.
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
            // status bar for ai
            const aiStatusBarItemEl = this.addStatusBarItem();
            aiStatusBarItemEl.addClass('personal-assistant-ai-statusbar');
            aiStatusBarItemEl.setAttribute("id", `personal-assistant-ai-statusbar`);
            addIcon('PLUGIN_AI_BRAIN', icons['PLUGIN_AI_BRAIN']);
            this.aiStatusBarItemEl = aiStatusBarItemEl;
            this.setMemoryStatusBarStatus("Memory needs setup", "needs-setup");
            // ai status bar event handling
            aiStatusBarItemEl.onClickEvent((e) => {
                // prepare memory from notes
                (this.app as any).commands.executeCommandById("personal-assistant:init-vss");// eslint-disable-line @typescript-eslint/no-explicit-any
            });
        }

        this.vss = this.initVss();
        this.memoryManager = new MemoryManager(this);
        this.memoryManager.startAutoMaintenance();
        await this.updateMemoryStatusBar();

        this.app.workspace.onLayoutReady(() => {
            this.registerView(
                RECORD_PREVIEW_TYPE,
                (leaf) => { return new RecordPreview(this.app, this, leaf); }
            );
            this.registerView(
                STAT_PREVIEW_TYPE,
                (leaf) => { return new Stat(this.app, this, leaf); }
            );
            this.registerView(
                VIEW_TYPE_LLM,
                (leaf) => {
                    return new LLMView(leaf, this, this.vss);
                }
            );
            void this.initializeCalloutManager();
        });
        this.statsManager = new StatsManager(this.app, this);

        this.addCommand({
            id: 'startup-recording',
            name: 'Create or open record note in configured folder',
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
            name: "Preview records from configured folder",
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

                this.log("AI Summary invoked", { selectionLength: sel.length, documentLength: v.length });
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

                this.log("AI Featured Images invoked", { selectionLength: sel.length, documentLength: v.length });
                if (view instanceof MarkdownView) {
                    this.log("invoking LLM");
                    const helper = new AssistantFeaturedImageHelper(this.app, this, editor, view);
                    await helper.generate();
                }
            }
        });

        this.addCommand({
            id: "init-vss",
            name: "Prepare Memory",
            callback: async () => {
                await this.memoryManager.prepareFromCommand();
            }
        })

        this.registerAdvancedMemoryCommands();

        this.addCommand({
            id: 'open-chat',
            name: 'Open Chat in Sidebar',
            callback: async () => {
                this.activeChatView();
            }
        });

        // VSS lifecycle events mark local state dirty; approved memory can then maintain itself in the background.
        this.registerEvent(
            this.app.vault.on("create", async (file) => {
                if (file instanceof TFile && await this.vss.markDirtyIfEligible(file)) {
                    this.memoryManager.scheduleAutoFlush("vault-create");
                }
            })
        );
        this.registerEvent(
            this.app.vault.on("modify", async (file) => {
                if (file instanceof TFile && await this.vss.markDirtyIfEligible(file)) {
                    this.memoryManager.scheduleAutoFlush("vault-modify");
                }
            })
        );
        this.registerEvent(
            this.app.vault.on("rename", async (file, oldPath) => {
                if (file instanceof TFile && await this.vss.handleRename(file, oldPath)) {
                    this.memoryManager.scheduleAutoFlush("vault-rename");
                }
            })
        );
        this.registerEvent(
            this.app.vault.on("delete", async (file) => {
                if (file instanceof TFile) {
                    await this.vss.handleDelete(file);
                    await this.updateMemoryStatusBar();
                }
            })
        );
        this.registerEvent(
            this.app.workspace.on("active-leaf-change", async () => {
                await this.vss.handleActiveLeafChange();
            })
        );
        this.registerEvent(
            this.app.workspace.on("file-open", async (file) => {
                if (await this.vss.handleFileOpen(file)) {
                    this.memoryManager.scheduleAutoFlush("file-open");
                }
            })
        );
        // Handle the Editor Plugins
        this.registerEditorExtension([pluginField.init(() => this), statusBarEditorPlugin, sectionWordCountEditorPlugin]);

        this.registerEvent(
            this.app.workspace.on("active-leaf-change", async (leaf) => {
                if (this.statsManager)
                    await this.statsManager.flush();
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
        const statsManager = this.statsManager;
        this.memoryManager?.stopAutoMaintenance();
        this.vss?.dispose();
        if (statsManager) {
            const flush = statsManager.flush();
            statsManager.dispose();
            void flush.catch((error) => this.log("Failed to flush statistics during unload", error));
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        this.log("Settings loaded", this.settings);
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    log(...msg: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        debug(this.settings.debug, ...msg);
    }

    private async initializeCalloutManager() {
        try {
            const pluginInstance = await this.waitForEnabledPluginInstance(
                CALLOUT_MANAGER_PLUGIN_ID,
                CALLOUT_MANAGER_READY_TIMEOUT_MS,
            );
            if (pluginInstance === undefined) {
                this.calloutManager = undefined;
                this.log('Callout Manager is unavailable; using default callouts.');
                return;
            }
            this.calloutManager = await getApi(this);
        } catch (error) {
            this.calloutManager = undefined;
            this.log('Failed to initialize Callout Manager API', error);
        }
    }

    private async waitForEnabledPluginInstance(pluginId: string, timeoutMs: number): Promise<unknown | undefined> {
        const pluginRegistry = (this.app as unknown as { plugins?: ObsidianPluginRegistry }).plugins;
        if (!pluginRegistry?.enabledPlugins?.has(pluginId)) {
            return undefined;
        }

        const loadedPlugin = pluginRegistry.plugins?.[pluginId];
        if (loadedPlugin !== undefined) {
            return loadedPlugin;
        }

        return new Promise((resolve) => {
            const interval = setInterval(() => {
                const pluginInstance = pluginRegistry.plugins?.[pluginId];
                if (pluginInstance !== undefined) {
                    clearTimeout(timeout);
                    clearInterval(interval);
                    resolve(pluginInstance);
                }
            }, CALLOUT_MANAGER_READY_POLL_MS);
            const timeout = setTimeout(() => {
                clearInterval(interval);
                resolve(undefined);
            }, timeoutMs);
        });
    }

    // the following is referenced from https://github.com/vanadium23/obsidian-advanced-new-file/blob/master/src/CreateNoteModal.ts#L102
    private isVaultRootPath(path: string): boolean {
        const normalizedPath = this.join(path);
        return normalizedPath === "" || normalizedPath === "." || normalizedPath === "/";
    }

    private async createDirectory(dir: string): Promise<void> {
        const { vault } = this.app;
        const directoryPath = this.join(dir);
        if (this.isVaultRootPath(directoryPath)) {
            return;
        }
        /**
         * NOTE: `getAbstractFileByPath` will return TAbstractFile or null,
         * so, to check if the directory is exists, compare the return
         * value by using `==`.
         **/
        if (vault.getAbstractFileByPath(directoryPath) == undefined && !(await vault.adapter.exists(directoryPath))) {
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
        const normalizedTargetPath = this.join(targetPath);
        const directoryPath = this.isVaultRootPath(normalizedTargetPath) ? "" : normalizedTargetPath;
        const filePath = directoryPath === "" ? this.join(`${fileName}.md`) : this.join(directoryPath, `${fileName}.md`);

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
    join(...strings: string[]): string {
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
        if (this.statsManager) {
            await this.statsManager.flush();
        }
        this.app.workspace.detachLeavesOfType(STAT_PREVIEW_TYPE);

        const viewLeaf = this.app.workspace.getLeaf('tab');
        await viewLeaf.setViewState({
            type: STAT_PREVIEW_TYPE,
            active: true,
        });

        await this.app.workspace.revealLeaf(viewLeaf);
    }

    async activeChatView() {
        const { workspace } = this.app;

        let leaf = workspace.getLeavesOfType(VIEW_TYPE_LLM)[0];

        if (!leaf) {
            const newLeaf = workspace.getRightLeaf(false);
            if (newLeaf) {
                leaf = newLeaf;
                await leaf.setViewState({
                    type: VIEW_TYPE_LLM,
                    active: true,
                });
            }
        }

        if (leaf) {
            workspace.revealLeaf(leaf);
        }

    }

    getVSSFiles() {
        const files = this.app.vault.getMarkdownFiles();
        const excludePaths = this.settings.vssCacheExcludePath || [];
        const normalizedExcludePaths = excludePaths.map((path) => path.trim()).filter(Boolean);
        const excludeFiles: TFile[] = [];
        // filter all markdown files which are in exclude-paths
        for (const file of files) {
            for (const exclude of normalizedExcludePaths) {
                if (file.path.startsWith(exclude)) {
                    excludeFiles.push(file);
                }
            }
        }
        const vssFiles = files.filter(file => !excludeFiles.includes(file));

        return vssFiles;
    }

    private initVss() {
        if (this.vss) {
            return this.vss;
        }

        return new VSS(this, this.vssCacheDir);
    }

    private async ensureVssCacheDir() {
        if (!await this.app.vault.adapter.exists(this.vssCacheDir)) {
            await this.app.vault.adapter.mkdir(this.vssCacheDir);
        }
    }

    private async cacheVectors() {
        if (this.vss) {
            const statusBar = document.getElementById("personal-assistant-ai-statusbar");
            statusBar?.addClass("personal-assistant-ai-breathing");
            try {
                await this.vss.rebuildLocalIndex({ silent: true });
                this.isVssCached = true;
                await this.updateMemoryStatusBar();
            } catch (error) {
                this.isVssCached = false;
                this.log("Failed to rebuild local VSS index", error);
                new Notice("Could not prepare memory.", 7000);
            } finally {
                statusBar?.removeClass("personal-assistant-ai-breathing");
            }
        }
    }

    async updateMemoryStatusBar() {
        if (!Platform.isDesktop || !this.aiStatusBarItemEl || !this.vss) return;
        const stats = await this.vss.getStats();
        if (stats.status === "ready" || stats.status === "fallback") {
            this.setMemoryStatusBarStatus("Memory ready", "ready");
            return;
        }
        if (stats.status === "stale") {
            this.setMemoryStatusBarStatus("Memory needs update", "needs-update");
            return;
        }
        if (stats.status === "missing-local-index") {
            this.setMemoryStatusBarStatus("Memory needs setup", "needs-setup");
            return;
        }
        if (stats.status === "disabled" || stats.status === "error") {
            this.setMemoryStatusBarStatus("Memory unavailable", "unavailable");
            return;
        }
        this.setMemoryStatusBarStatus("Memory needs setup", "needs-setup");
    }

    async showTechnicalMemoryStatus() {
        if (!this.vss) {
            new Notice("Diagnostic details: memory service is not initialized.", 5000);
            return;
        }

        const stats = await this.vss.getStats();
        const statusText = (() => {
            if (stats.status === "ready" || stats.status === "fallback") {
                return `Ready: ${stats.chunkCount} chunks across ${stats.fileCount} files`;
            }
            if (stats.status === "stale") return "Index stale";
            if (stats.status === "missing-local-index") return "VSS index missing";
            if (stats.status === "disabled" || stats.status === "error") return "VSS disabled";
            return "VSS not initialized";
        })();
        const storageText = stats.storagePersisted === false ? "best-effort storage" : "persistent storage";
        const performanceText = this.getVssPerformanceNotice(stats.chunkCount);
        new Notice(`Diagnostic details: ${statusText}. Backend: ${stats.backend}. Storage: ${storageText}.${performanceText}`, 7000);
    }

    private setMemoryStatusBarStatus(text: string, state: MemoryStatusBarState) {
        if (!this.aiStatusBarItemEl) return;
        this.aiStatusBarItemEl.empty();
        setIcon(this.aiStatusBarItemEl, 'PLUGIN_AI_BRAIN');
        this.aiStatusBarItemEl.classList.remove(...MEMORY_STATUS_BAR_STATE_CLASSES);
        this.aiStatusBarItemEl.addClass(`personal-assistant-ai-statusbar-${state}`);
        this.aiStatusBarItemEl.setAttribute("title", text);
        this.aiStatusBarItemEl.setAttribute("aria-label", text);
    }

    private getVssPerformanceNotice(chunkCount: number): string {
        if (chunkCount > 100_000) {
            return " Performance note: exact search may be slow above 100k chunks; consider a future quantized or ANN backend, which is not enabled automatically.";
        }
        if (chunkCount > 50_000) {
            return " Performance note: exact search may be slower above 50k chunks.";
        }
        return "";
    }

    private registerAdvancedMemoryCommands() {
        this.addCommand({
            id: "flush-vss-cache",
            name: "Update memory now",
            checkCallback: (checking) => this.runAdvancedMemoryCommand(checking, async () => {
                await this.memoryManager.updateFromCommand();
                await this.updateMemoryStatusBar();
            }),
        })

        this.addCommand({
            id: "reset-vss-index",
            name: "Reset local memory copy",
            checkCallback: (checking) => this.runAdvancedMemoryCommand(checking, async () => {
                const confirmed = typeof globalThis.confirm === "function"
                    ? globalThis.confirm("Reset the local memory copy? Your notes will not be deleted.")
                    : true;
                if (!confirmed) return;
                await this.vss.resetLocalIndex();
                await this.updateMemoryStatusBar();
            }),
        })

        this.addCommand({
            id: "clean-legacy-vss-json-cache",
            name: "Clean old memory cache",
            checkCallback: (checking) => this.runAdvancedMemoryCommand(checking, async () => {
                await this.vss.cleanLegacyJsonCache();
                await this.updateMemoryStatusBar();
            }),
        })

        this.addCommand({
            id: "show-vss-index-status",
            name: "Show technical memory status",
            checkCallback: (checking) => this.runAdvancedMemoryCommand(checking, async () => {
                await this.showTechnicalMemoryStatus();
            }),
        })
    }

    private runAdvancedMemoryCommand(checking: boolean, action: () => Promise<void>): boolean {
        if (!this.settings.showAdvancedMemoryControls) return false;
        if (!checking) {
            void action().catch((error) => {
                this.log("Advanced memory command failed", error);
                new Notice("Could not complete memory action.", 5000);
            });
        }
        return true;
    }

    /**
     * 迁移旧版本设置到新版本
     */
    private migrateSettings() {
        try {
            let changed = false;
            // 如果aiProvider未设置，说明是旧版本，进行迁移
            if (!this.settings.aiProvider) {
                this.log("Migrating settings from old version");
                this.settings.aiProvider = 'qwen';
                this.settings.baseURL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
                this.settings.chatModelName = this.settings.modelName || 'qwen-plus';
                this.settings.embeddingModelName = 'text-embedding-v3';
                changed = true;
            }
            const normalizedStatisticsType = normalizeStatisticsView(this.settings.statisticsType);
            if (this.settings.statisticsType !== normalizedStatisticsType) {
                this.settings.statisticsType = normalizedStatisticsType;
                changed = true;
            }
            if (typeof this.settings.memoryEnabled !== "boolean") {
                this.settings.memoryEnabled = true;
                changed = true;
            }
            if (typeof this.settings.memoryAutoCheckBeforeChat !== "boolean") {
                this.settings.memoryAutoCheckBeforeChat = true;
                changed = true;
            }
            if (!["always", "auto-refresh-after-prepare"].includes(this.settings.memoryApprovalPolicy)) {
                this.settings.memoryApprovalPolicy = "always";
                changed = true;
            }
            if (typeof this.settings.showAdvancedMemoryControls !== "boolean") {
                this.settings.showAdvancedMemoryControls = false;
                changed = true;
            }
            if (
                this.settings.aiProvider === 'qwen'
                && this.settings.embeddingModelName === 'text-embedding-v3'
                && !this.settings.embeddingV4MigrationNoticeDismissed
            ) {
                new Notice(
                    "Qwen's newer memory model is recommended for new memory copies. Your existing memory model setting was preserved.",
                    10000,
                );
                this.settings.embeddingV4MigrationNoticeDismissed = true;
                changed = true;
            }
            if (changed) {
                this.saveSettings();
                this.log("Settings migration completed");
            }
        } catch (error) {
            this.log("Error during settings migration:", error);
        }
    }

    async getAPIToken() {
        // Ollama不需要API Token
        if (this.settings.aiProvider === 'ollama') {
            return "";
        }

        if (this.token !== "") {
            return this.token;
        }
        const encryptedToken = this.settings.apiToken;
        const token = await this.cryptoHelper.decryptFromBase64(encryptedToken, personalAssitant);
        if (!token) {
            new Notice("Prepare LLM failed!", 3000);
            return "";
        }
        this.token = token;

        return token;
    }
}
