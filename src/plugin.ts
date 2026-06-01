/* Copyright 2023 edonyzpc */

import { type Debouncer, type MarkdownFileInfo, Editor, MarkdownView, Notice, Platform, Plugin, TFile, addIcon, debounce, moment as obsidianMoment, normalizePath, setIcon } from 'obsidian';
import { type CalloutManager, getApi } from "obsidian-callout-manager";

import { VIEW_TYPE_LLM, LLMView } from "./chat/chat-view";
import { AssistantFeaturedImageHelper, AssistantHelper } from "./ai";
import { VSS } from './vss'
import { PluginControlModal } from './modal'
import { BatchPluginControlModal } from './batch-modal'
import { SettingTab, type PluginManagerSettings, DEFAULT_SETTINGS, normalizeEnabledSkillIds, mergeLoadedSettings, isFreshInstall, isLegacyV1Install } from './settings'
import { LocalGraph } from './local-graph';
import { openSettings, openSettingsTab } from './obsidian-internals';
import { CryptoHelper, KEYCHAIN_API_TOKEN_ID, getVaultApiTokenId, hasSecretValue, icons, personalAssitant } from './utils';
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
import { getVaultConfigDir, joinVaultConfigPath, LEGACY_CONFIG_DIR, uniqueNormalizedPaths } from './obsidian-paths';
import { confirmUserAction } from './confirm';
import { createVSSIndexStateStore, type VSSIndexStateStore } from './vss/local-state-store';
import { createChatHistoryStore, type ChatHistoryStore } from './chat/chat-history-store';
import { ChatHistoryManager } from './chat/chat-history-manager';

const CALLOUT_MANAGER_PLUGIN_ID = 'callout-manager';
const CALLOUT_MANAGER_READY_TIMEOUT_MS = 2000;
const CALLOUT_MANAGER_READY_POLL_MS = 50;

interface TechnicalMemoryDetail {
    label: string;
    value: string;
    tone?: "warning" | "danger";
}

interface TechnicalMemoryNoticeModel {
    title: string;
    summary: string;
    summaryTone?: TechnicalMemoryDetail["tone"];
    details: TechnicalMemoryDetail[];
    notes: string[];
}

type TechnicalMemoryStats = Awaited<ReturnType<VSS["getStats"]>>;
type TechnicalMemoryMaintenance = ReturnType<VSS["getMaintenanceState"]>;

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

const moment = obsidianMoment as unknown as (...args: unknown[]) => { format: (format: string) => string };

function arraysEqual(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

export class PluginManager extends Plugin {
    settings!: PluginManagerSettings
    private localGraph = new LocalGraph(this.app, this);
    calloutManager: CalloutManager<true> | undefined;
    private updateDebouncer!: Debouncer<[file: TFile | null], void>;
    // Runtime-only state: tracks whether the "update-metadata" command has armed
    // the file-open listener for this session. Not persisted — restarting the
    // app should always start with the listener disarmed.
    private isEnabledMetadataUpdating: boolean = false;
    // True when the loaded data blob has the shape of a legacy v1.x install:
    // non-empty but missing the `aiProvider` field. Used by migrateSettings
    // to apply the qwen default exactly once on the upgrade path, rather
    // than every time aiProvider happens to be empty (which is also a
    // valid Phase 3 state on fresh installs and after the user clears it).
    private needsLegacyAiProviderMigration: boolean = false;
    private settingTab: SettingTab = new SettingTab(this.app, this);
    statsManager: StatsManager | undefined;
    vss!: VSS;
    memoryManager!: MemoryManager;
    chatHistoryStore: ChatHistoryStore | undefined;
    chatHistoryManager: ChatHistoryManager | undefined;
    vssCacheDir: string = this.join(this.app.vault.configDir, "plugins/personal-assistant/vss-cache");
    private isVssCached: boolean = false;
    /** @deprecated Remove after v2.5.0 — only used for one-time migration decryption */
    private cryptoHelper: CryptoHelper = new CryptoHelper();
    private token: string = "";
    private memoryStatusListeners = new Set<() => void | Promise<void>>();
    private hoverPopoverObserver: MutationObserver | null = null;
    private resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;


    async onload() {
        await this.loadSettings();

        // 迁移旧版本设置
        await this.migrateSettings();

        // showup notification of plugin starting when it is in debug mode
        if (this.settings.debug) {
            new Notice("starting obsidian assistant");
            // register mobile debug log
            monkeyPatchConsole(this);
        }
        // observe hover-editor popovers for local graph resize
        this.hoverPopoverObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of Array.from(mutation.addedNodes)) {
                    if (
                        node instanceof HTMLElement
                        && (node.matches('.popover.hover-popover.hover-editor')
                            || node.querySelector('.popover.hover-popover.hover-editor'))
                    ) {
                        if (this.resizeDebounceTimer !== null) clearTimeout(this.resizeDebounceTimer);
                        this.resizeDebounceTimer = setTimeout(() => {
                            this.resizeDebounceTimer = null;
                            this.localGraph.resize();
                        }, 150);
                        return;
                    }
                }
            }
        });
        this.hoverPopoverObserver.observe(document.body, {
            childList: true,
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
                openSettings(this.app);
                openSettingsTab(this.app, 'personal-assistant');
            });
        }

        this.vss = this.initVss();
        this.chatHistoryStore = this.createChatHistoryStore();
        this.chatHistoryManager = new ChatHistoryManager({
            store: this.chatHistoryStore,
            log: (message, error) => this.log(message, error),
        });
        void this.chatHistoryManager.initialize();
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

        this.memoryManager = new MemoryManager(this);
        this.memoryManager.startAutoMaintenance();
        await this.updateMemoryStatusBar();

        this.app.workspace.onLayoutReady(() => {
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
                    if (this.isEnabledMetadataUpdating) {
                        // if the command has already triggered, disable it and remove status
                        const statusBar = document.getElementById("personal-assistant-statusbar");
                        statusBar?.removeClass("personal-assistant-statusbar-breathing");
                        // empty debounce which will stop updating metadata
                        this.updateDebouncer = debounce((file) => { }, 100, true);
                        // update the command triggered status
                        this.isEnabledMetadataUpdating = false;
                    } else {
                        this.updateDebouncer = debounce(this.updateMetadata, 100, true);
                        // if updating metadata is enabled, set the status and monitor the events to update metadata
                        const statusBar = document.getElementById("personal-assistant-statusbar");
                        statusBar?.addClass("personal-assistant-statusbar-breathing");
                        this.registerEvent(this.app.workspace.on('file-open', (file) => {
                            this.updateDebouncer(file);
                        }));
                        // update the command triggered status
                        this.isEnabledMetadataUpdating = true;
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
                if (!this.ensureAIConfigured()) return;
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
                if (!this.ensureAIConfigured()) return;
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
            checkCallback: (checking) => this.runMemoryCommand(checking, async () => {
                await this.memoryManager.prepareFromCommand();
            }),
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
                    await this.updateMemoryStatusBar();
                }
            })
        );
        this.registerEvent(
            this.app.vault.on("modify", async (file) => {
                if (file instanceof TFile && await this.vss.markDirtyIfEligible(file)) {
                    this.memoryManager.scheduleAutoFlush("vault-modify");
                    await this.updateMemoryStatusBar();
                }
            })
        );
        this.registerEvent(
            this.app.vault.on("rename", async (file, oldPath) => {
                if (file instanceof TFile && await this.vss.handleRename(file, oldPath)) {
                    this.memoryManager.scheduleAutoFlush("vault-rename");
                    await this.updateMemoryStatusBar();
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
                    const state = this.vss.getMaintenanceState();
                    if (state.verificationPending > 0) {
                        this.memoryManager.scheduleVerify("file-open");
                    }
                    if (state.dirtyCount > 0) {
                        this.memoryManager.scheduleAutoFlush("file-open");
                    }
                    await this.updateMemoryStatusBar();
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

    async onunload() {
        const statsManager = this.statsManager;
        if (this.resizeDebounceTimer !== null) clearTimeout(this.resizeDebounceTimer);
        this.resizeDebounceTimer = null;
        this.hoverPopoverObserver?.disconnect();
        this.hoverPopoverObserver = null;
        this.memoryManager?.stopAutoMaintenance();
        await this.vss?.dispose().catch((error) => this.log("Failed to dispose Memory local index", error));
        if (statsManager) {
            const flush = statsManager.flush();
            statsManager.dispose();
            void flush.catch((error) => this.log("Failed to flush statistics during unload", error));
        }
        const chatHistoryStore = this.chatHistoryStore;
        if (chatHistoryStore) {
            void chatHistoryStore
                .dispose()
                .catch((error) => this.log("Failed to dispose chat history store", error));
        }
        this.chatHistoryStore = undefined;
        this.chatHistoryManager = undefined;
    }

    async loadSettings() {
        const loaded = await this.loadData();
        const fresh = isFreshInstall(loaded);
        this.needsLegacyAiProviderMigration = isLegacyV1Install(loaded);
        this.settings = mergeLoadedSettings(loaded);
        if (fresh) {
            // Force an explicit provider choice on first run instead of
            // defaulting to qwen. The Settings UI renders a "Choose your
            // AI provider" prompt while aiProvider is empty.
            this.settings.aiProvider = "";
        }
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
        const normalizedExcludePaths = (this.settings.vssCacheExcludePath ?? [])
            .map((path) => path.trim())
            .filter(Boolean);
        if (normalizedExcludePaths.length === 0) return files;
        return files.filter((file) =>
            !normalizedExcludePaths.some((prefix) => file.path.startsWith(prefix))
        );
    }

    private initVss() {
        if (this.vss) {
            return this.vss;
        }

        return new VSS(this, this.vssCacheDir, this.createVSSIndexStateStore());
    }

    createVSSIndexStateStore(): VSSIndexStateStore {
        const manifest = this.manifest as { id?: string } | undefined;
        return createVSSIndexStateStore(
            this.app.vault,
            this.settings.statisticsVaultId || "default-vault",
            manifest?.id ?? "personal-assistant",
        );
    }

    createChatHistoryStore(): ChatHistoryStore {
        const manifest = this.manifest as { id?: string } | undefined;
        return createChatHistoryStore(
            this.app.vault,
            this.settings.statisticsVaultId || "default-vault",
            manifest?.id ?? "personal-assistant",
        );
    }

    private async cacheVectors() {
        if (this.vss) {
            try {
                await this.vss.rebuildLocalIndex({ silent: true });
                this.isVssCached = true;
                await this.updateMemoryStatusBar();
            } catch (error) {
                this.isVssCached = false;
                this.log("Failed to rebuild local VSS index", error);
                new Notice("Could not prepare memory.", 7000);
            }
        }
    }

    onMemoryStatusChanged(listener: () => void | Promise<void>): () => void {
        this.memoryStatusListeners.add(listener);
        return () => {
            this.memoryStatusListeners.delete(listener);
        };
    }

    async updateMemoryStatusBar() {
        await Promise.allSettled(
            Array.from(this.memoryStatusListeners, (listener) => Promise.resolve().then(listener)),
        );
    }

    async showTechnicalMemoryStatus() {
        if (!this.vss) {
            this.showTechnicalMemoryNotice({
                title: "Memory diagnostics",
                summary: "Memory service is not initialized.",
                summaryTone: "warning",
                details: [],
                notes: [],
            }, 5000);
            return;
        }

        const stats = await this.vss.getStats({ mode: "manual" });
        const maintenance = this.vss.getMaintenanceState();
        this.showTechnicalMemoryNotice(this.buildTechnicalMemoryStatusModel(stats, maintenance), 7000);
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

    private buildTechnicalMemoryStatusModel(stats: TechnicalMemoryStats, maintenance: TechnicalMemoryMaintenance): TechnicalMemoryNoticeModel {
        const status = this.formatTechnicalMemoryStatus(stats);
        const maintenanceText = this.formatTechnicalMaintenanceState(maintenance);
        const details: TechnicalMemoryDetail[] = [
            { label: "Indexed", value: `${stats.chunkCount} chunks across ${stats.fileCount} files` },
            { label: "Backend", value: stats.backend },
            {
                label: "Storage",
                value: stats.storagePersisted === false ? "Best-effort storage" : "Persistent storage",
                tone: stats.storagePersisted === false ? "warning" : undefined,
            },
            {
                label: "Maintenance",
                value: maintenanceText,
                tone: maintenanceText === "Up to date" ? undefined : "warning",
            },
        ];

        if (stats.lastVerifiedAt) {
            details.push({ label: "Last verified", value: stats.lastVerifiedAt });
        }

        if (stats.lastErrorCode) {
            details.push({ label: "Last error", value: stats.lastErrorCode, tone: "danger" });
        }
        if (stats.lastErrorCode === "opfs-sahpool-locked" && stats.opfsDirectory) {
            details.push({ label: "OPFS scope", value: stats.opfsDirectory, tone: "warning" });
        }
        if (stats.lastErrorCode === "opfs-sahpool-locked" && stats.opfsVfsName) {
            details.push({ label: "OPFS VFS", value: stats.opfsVfsName, tone: "warning" });
        }

        const performanceText = this.getVssPerformanceNotice(stats.chunkCount).trim();

        return {
            title: "Memory diagnostics",
            summary: status.text,
            summaryTone: status.tone,
            details,
            notes: performanceText ? [performanceText] : [],
        };
    }

    private formatTechnicalMemoryStatus(stats: TechnicalMemoryStats): { text: string; tone?: TechnicalMemoryDetail["tone"] } {
        if (stats.status === "ready") {
            return { text: "Ready" };
        }
        if (stats.status === "stale") {
            return { text: "Index stale", tone: "warning" };
        }
        if (stats.status === "missing-local-index") {
            return { text: "Local index missing", tone: "warning" };
        }
        if (stats.status === "disabled" || stats.status === "error") {
            return { text: "Memory diagnostics unavailable", tone: "danger" };
        }
        return { text: "Memory diagnostics not initialized", tone: "warning" };
    }

    private formatTechnicalMaintenanceState(maintenance: TechnicalMemoryMaintenance): string {
        if (maintenance.dirtyCount <= 0 && maintenance.verificationPending <= 0) {
            return "Up to date";
        }

        const parts: string[] = [];
        if (maintenance.dirtyCount > 0) {
            parts.push(`${maintenance.dirtyCount} dirty`);
        }
        if (maintenance.verificationPending > 0) {
            parts.push(`${maintenance.verificationPending} verification pending`);
        }
        return parts.join(", ");
    }

    private showTechnicalMemoryNotice(model: TechnicalMemoryNoticeModel, timeout: number): void {
        const fragment = document.createDocumentFragment();
        const wrapper = fragment.createEl("div", { attr: { class: "pa-notice pa-notice--diagnostic" } });
        const header = wrapper.createDiv({ cls: "pa-notice__header" });
        const icon = header.createDiv({ cls: "pa-notice__icon" });
        setIcon(icon, "activity");
        header.createSpan({ text: model.title, attr: { class: "pa-notice__text" } });

        const summaryClasses = ["pa-notice__summary"];
        if (model.summaryTone) {
            summaryClasses.push(`pa-notice__summary--${model.summaryTone}`);
        }
        wrapper.createDiv({ cls: summaryClasses.join(" "), text: model.summary });

        if (model.details.length > 0) {
            const details = wrapper.createDiv({ cls: "pa-notice__details" });
            for (const item of model.details) {
                const rowClasses = ["pa-notice__detail"];
                if (item.tone) {
                    rowClasses.push(`pa-notice__detail--${item.tone}`);
                }
                const row = details.createDiv({ cls: rowClasses.join(" ") });
                row.createSpan({ cls: "pa-notice__detail-label", text: item.label });
                row.createSpan({ cls: "pa-notice__detail-value", text: item.value });
            }
        }

        if (model.notes.length > 0) {
            const body = wrapper.createDiv({ cls: "pa-notice__body pa-notice__body--compact" });
            for (const note of model.notes) {
                body.createDiv({ cls: "pa-notice__item pa-notice__item--note", text: note });
            }
        }

        const notice = new Notice(fragment, timeout);
        this.tuneStructuredNoticeShell(notice);
    }

    private tuneStructuredNoticeShell(notice: Notice): void {
        notice.noticeEl.addClass("pa-notice-shell");
        notice.noticeEl.parentElement?.addClass("pa-notice-shell");
        notice.noticeEl.setCssStyles({
            background: "transparent",
            boxShadow: "none",
            border: "none",
            padding: "0",
        });
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
                const confirmed = await confirmUserAction(this.app, {
                    title: "Reset local memory copy?",
                    message: "Your notes will not be changed or deleted. This device may need to prepare Memory again before using it.",
                    confirmText: "Reset",
                });
                if (!confirmed) return;
                await this.vss.resetLocalIndex();
                await this.updateMemoryStatusBar();
            }),
        })

        this.addCommand({
            id: "clean-legacy-vss-json-cache",
            name: "Delete old Memory cache files",
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
        if (!this.settings.memoryEnabled || !this.settings.showAdvancedMemoryControls) return false;
        return this.runMemoryCommand(checking, action);
    }

    private runMemoryCommand(checking: boolean, action: () => Promise<void>): boolean {
        if (!this.settings.memoryEnabled) return false;
        if (this.getAISetupIssue() !== null) return false;
        if (!checking) {
            void action().catch((error) => {
                this.log("Memory command failed", error);
                new Notice("Could not complete memory action.", 5000);
            });
        }
        return true;
    }

    private ensureAIConfigured(): boolean {
        const issue = this.getAISetupIssue();
        if (!issue) return true;
        new Notice(issue, 5000);
        return false;
    }

    /**
     * 迁移旧版本设置到新版本
     */
    private async migrateSettings(): Promise<void> {
        try {
            let changed = false;
            const settingsWithLegacyModel = this.settings as PluginManagerSettings & { modelName?: unknown };
            const legacyModelName = typeof settingsWithLegacyModel.modelName === "string"
                ? settingsWithLegacyModel.modelName.trim()
                : "";
            // Legacy v1.x migration: pre-Provider users had no aiProvider field
            // and stored their model in `modelName`. Detected by the *shape* of
            // the persisted blob (non-empty AND lacking aiProvider) rather than
            // a runtime "is empty now" check, so we don't re-trigger on every
            // launch where aiProvider happens to be "" (fresh install, or the
            // user intentionally cleared it via the new provider chooser).
            if (this.needsLegacyAiProviderMigration) {
                this.log("Migrating settings from old version");
                this.settings.aiProvider = 'qwen';
                this.settings.baseURL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
                this.settings.chatModelName = legacyModelName || DEFAULT_SETTINGS.chatModelName;
                this.settings.embeddingModelName = 'text-embedding-v3';
                this.needsLegacyAiProviderMigration = false;
                changed = true;
            }
            if (
                legacyModelName
                && legacyModelName !== "qwen-plus"
                && this.settings.chatModelName === DEFAULT_SETTINGS.chatModelName
            ) {
                this.settings.chatModelName = legacyModelName;
                changed = true;
            }
            if ("modelName" in settingsWithLegacyModel) {
                delete settingsWithLegacyModel.modelName;
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
                "nativeToolPlanningSmokeEnabled" in this.settings
                && typeof this.settings.nativeToolPlanningSmokeEnabled !== "boolean"
            ) {
                this.settings.nativeToolPlanningSmokeEnabled = false;
                changed = true;
            }
            if (typeof this.settings.qwenThinkingEnabled !== "boolean") {
                this.settings.qwenThinkingEnabled = false;
                changed = true;
            }
            if (typeof this.settings.webSearchEnabled !== "boolean") {
                this.settings.webSearchEnabled = false;
                changed = true;
            }
            if (typeof this.settings.policyModelName !== "string") {
                this.settings.policyModelName = "";
                changed = true;
            }
            if ("qwenWebSearchEnabled" in this.settings) {
                delete (this.settings as Partial<PluginManagerSettings> & { qwenWebSearchEnabled?: unknown }).qwenWebSearchEnabled;
                changed = true;
            }
            if ("paAgentAnswerStreamEnabled" in this.settings) {
                delete (this.settings as Partial<PluginManagerSettings> & { paAgentAnswerStreamEnabled?: unknown }).paAgentAnswerStreamEnabled;
                changed = true;
            }
            // isEnabledMetadataUpdating used to be persisted alongside the user-facing
            // enableMetadataUpdating toggle, but it is runtime state (whether the
            // file-open listener is armed for this session) and should not survive
            // restarts. Strip it from data.json on load.
            if ("isEnabledMetadataUpdating" in this.settings) {
                delete (this.settings as Partial<PluginManagerSettings> & { isEnabledMetadataUpdating?: unknown }).isEnabledMetadataUpdating;
                changed = true;
            }
            // v2.0.0 removed Ollama provider support. Users upgrading from v1.x with
            // `aiProvider: "ollama"` would otherwise hit a hard runtime throw on first
            // chat. Migrate them to the qwen default so the app remains usable; the v2.0.0
            // CHANGELOG break-change note instructs them to reconfigure their model.
            if (this.settings.aiProvider === "ollama") {
                this.settings.aiProvider = "qwen";
                this.settings.baseURL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
                this.settings.chatModelName = DEFAULT_SETTINGS.chatModelName;
                this.settings.embeddingModelName = "text-embedding-v4";
                changed = true;
            }
            if (typeof this.settings.shareAnonymousCapabilityUsage !== "boolean") {
                this.settings.shareAnonymousCapabilityUsage = false;
                changed = true;
            }
            if (typeof this.settings.skillContextEnabled !== "boolean") {
                this.settings.skillContextEnabled = true;
                changed = true;
            }
            const normalizedEnabledSkillIds = normalizeEnabledSkillIds(this.settings.enabledSkillIds);
            if (!Array.isArray(this.settings.enabledSkillIds) || !arraysEqual(this.settings.enabledSkillIds, normalizedEnabledSkillIds)) {
                this.settings.enabledSkillIds = normalizedEnabledSkillIds;
                changed = true;
            }
            if (!this.settings.statisticsVaultId) {
                this.settings.statisticsVaultId = createStatisticsVaultId();
                changed = true;
            }
            const vault = (this as { app?: { vault?: Parameters<typeof getVaultConfigDir>[0] } }).app?.vault;
            if (vault) {
                const configDir = getVaultConfigDir(vault);
                const defaultStatsPath = joinVaultConfigPath(configDir, "stats.json");
                if (!this.settings.statsPath || this.settings.statsPath === joinVaultConfigPath(LEGACY_CONFIG_DIR, "stats.json")) {
                    if (this.settings.statsPath !== defaultStatsPath) {
                        this.settings.statsPath = defaultStatsPath;
                        changed = true;
                    }
                }
                const hasConfiguredExcludes = Array.isArray(this.settings.vssCacheExcludePath);
                const currentExcludes = hasConfiguredExcludes
                    ? uniqueNormalizedPaths(this.settings.vssCacheExcludePath.map((path) => path.trim()).filter(Boolean))
                    : [];
                const configuredDefaultExcludes = Array.isArray(DEFAULT_SETTINGS.vssCacheExcludePath)
                    ? DEFAULT_SETTINGS.vssCacheExcludePath
                    : [];
                const legacyDefaultExcludes = uniqueNormalizedPaths([
                    LEGACY_CONFIG_DIR,
                    ...configuredDefaultExcludes,
                ]);
                if (
                    !hasConfiguredExcludes
                    || (configuredDefaultExcludes.length > 0 && arraysEqual(currentExcludes, configuredDefaultExcludes))
                    || arraysEqual(currentExcludes, legacyDefaultExcludes)
                ) {
                    const nextExcludes = uniqueNormalizedPaths([
                        configDir,
                        ...configuredDefaultExcludes,
                    ]);
                    if (!arraysEqual(currentExcludes, nextExcludes)) {
                        this.settings.vssCacheExcludePath = nextExcludes;
                        changed = true;
                    }
                }
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
            const rawApiToken = this.settings.apiToken;
            const scopedTokenId = this.getAPITokenSecretId();
            const legacySecretId = this.getLegacyAPITokenSecretId();
            if (rawApiToken && rawApiToken !== "sk-xxx") {
                const decrypted = await this.cryptoHelper.decryptFromBase64(rawApiToken, personalAssitant);
                if (decrypted) {
                    this.app.secretStorage.setSecret(scopedTokenId, decrypted);
                    delete this.settings.apiToken;
                    this.token = decrypted;
                    changed = true;
                    this.log("API token migrated to vault-scoped OS keychain");
                } else {
                    // Decryption failed — likely a key change, corrupted blob, or a
                    // pasted plaintext token. Clear the residual value so the
                    // ciphertext (or plaintext) does not stay on disk forever and
                    // re-trigger this Notice on every launch.
                    new Notice("API token migration failed. Please re-enter your token in Settings.", 8000);
                    delete this.settings.apiToken;
                    changed = true;
                    this.log("API token migration failed; cleared residual value from data.json");
                }
            } else if ("apiToken" in this.settings) {
                delete this.settings.apiToken;
                changed = true;
            }
            if (this.app.secretStorage.getSecret(scopedTokenId) === null) {
                const legacyToken = this.app.secretStorage.getSecret(legacySecretId);
                if (hasSecretValue(legacyToken)) {
                    this.app.secretStorage.setSecret(scopedTokenId, legacyToken);
                    this.token = legacyToken;
                    this.log("API token migrated from legacy keychain id to vault-scoped id");
                }
            }
            if (changed) {
                await this.saveSettings();
                this.log("Settings migration completed");
            }
        } catch (error) {
            this.log("Error during settings migration:", error);
            throw error;
        }
    }

    getAPITokenSecretId(): string {
        return getVaultApiTokenId(this.settings.statisticsVaultId || "default-vault");
    }

    getLegacyAPITokenSecretId(): string {
        return KEYCHAIN_API_TOKEN_ID;
    }

    hasConfiguredAPIToken(): boolean {
        const scopedToken = this.app.secretStorage.getSecret(this.getAPITokenSecretId());
        if (scopedToken !== null) return scopedToken !== "";
        return hasSecretValue(this.app.secretStorage.getSecret(this.getLegacyAPITokenSecretId()));
    }

    getAISetupIssue(): string | null {
        if (!this.settings.aiProvider) {
            return "Choose an AI provider in Settings first.";
        }
        if (!this.settings.baseURL || !this.settings.chatModelName) {
            return "Complete the AI provider URL and model in Settings first.";
        }
        if (!this.hasConfiguredAPIToken()) {
            return "Add your API token in Settings first.";
        }
        return null;
    }

    async getAPIToken() {
        if (this.token !== "") {
            return this.token;
        }
        const scopedTokenId = this.getAPITokenSecretId();
        const legacySecretId = this.getLegacyAPITokenSecretId();
        const scopedToken = this.app.secretStorage.getSecret(scopedTokenId);
        const token = scopedToken !== null
            ? scopedToken
            : this.app.secretStorage.getSecret(legacySecretId);
        if (!hasSecretValue(token)) {
            new Notice("API token not configured. Please set it in Settings → Personal Assistant.", 5000);
            return "";
        }
        if (scopedToken === null) {
            this.app.secretStorage.setSecret(scopedTokenId, token);
            this.log("API token copied from legacy keychain id to vault-scoped id");
        }
        this.token = token;
        return token;
    }

    clearTokenCache(): void {
        this.token = "";
    }
}

function createStatisticsVaultId(): string {
    const cryptoApi = globalThis.crypto as (Crypto & { randomUUID?: () => string }) | undefined;
    if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
        return cryptoApi.randomUUID();
    }
    return `statistics-vault-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
