/* Copyright 2023 edonyzpc */

import { type Debouncer, type MarkdownFileInfo, Component, Editor, MarkdownRenderer, MarkdownView, Modal, Notice, Platform, Plugin, TFile, addIcon, debounce, moment as obsidianMoment, normalizePath, setIcon } from 'obsidian';
import { type CalloutManager, getApi } from "obsidian-callout-manager";

import { PA_CHAT_SUBAGENT_ICON, VIEW_TYPE_LLM, LLMView } from "./chat/chat-view";
import { AssistantFeaturedImageHelper, AssistantHelper } from "./ai";
import { AIUtils, getDashScopeImageSynthesisUrl } from "./ai-services/ai-utils";
import { ChatService } from "./ai-services/chat-service";
import { VSS } from './vss'
import { PluginControlModal } from './modal'
import { BatchPluginControlModal } from './batch-modal'
import { SettingTab, type PluginManagerSettings, DEFAULT_SETTINGS, normalizeEnabledSkillIds, mergeLoadedSettings, isFreshInstall, isLegacyV1Install } from './settings'
import { OPERATIONS_AGENT_RUNTIME_ENABLED } from "./operations-agent-flags";
import { LocalGraph } from './local-graph';
import { openSettings, openSettingsTab } from './obsidian-internals';
import { getVaultApiTokenId, hasSecretValue, icons } from './utils';
import { PluginsUpdater } from './plugin-manifest';
import { ThemeUpdater } from './theme-manifest';
import { monkeyPatchConsole } from './obsidian-hack/obsidian-mobile-debug';
import { CalloutModal } from './callout';
import { RecordPreview, RECORD_PREVIEW_TYPE } from './preview';
import { STAT_PREVIEW_TYPE, Stat } from './stats-view'
import StatsManager from './stats/stats-manager'
import { pluginField, statusBarEditorPlugin, sectionWordCountEditorPlugin } from './stats/editor-plugin'
import { normalizeStatisticsView } from './stats/stats-store';
import type { EditorPluginHost } from './stats/EditorPluginHost';
import type { StatsHost } from './stats/StatsHost';
import { MemoryManager } from './memory-manager';
import { getVaultConfigDir, joinVaultConfigPath, LEGACY_CONFIG_DIR, uniqueNormalizedPaths } from './obsidian-paths';
import { confirmUserAction } from './confirm';
import { createVSSIndexStateStore, type VSSIndexStateStore } from './vss/local-state-store';
import { createChatHistoryStore, type ChatHistoryStore } from './chat/chat-history-store';
import { ChatHistoryManager } from './chat/chat-history-manager';
import {
    PAGELET_FOCUS_LATEST_COMMAND_ID,
    PAGELET_FOCUS_LATEST_DEFAULT_HOTKEY,
    PageletReviewModel,
    PageletCostTracker,
    PageletRateLimiter,
    buildPageletScopeReviewBundle,
    createPaReviewRuntime,
    estimateTokens,
    registerPageletFocusCommand,
    type GeneratedReviewNote,
    type PageletRateLimitStorage,
    type PageletRateLimitState,
    type PaReviewRuntime,
    type WriteResult,
} from './pagelet';
import { getPageletUiLanguage, pageletT } from './locales/pagelet';
import { getPluginUiLanguage, pluginT, type PluginMessageKey } from './locales/plugin';
import {
    clearPlatformInterval,
    clearPlatformTimeout,
    getPlatformCrypto,
    getPlatformDocument,
    getPlatformLocalStorage,
    setPlatformInterval,
    setPlatformTimeout,
    type PlatformIntervalHandle,
    type PlatformTimeoutHandle,
} from './platform-dom';
import { normalizeReviewsFolder, type PageletReviewsFolderError, type PageletSettings } from './settings/pagelet';
import { PageletOrchestrator, type PageletHost } from './pagelet/orchestrator';
import { registerPageletCommands, type PageletCommandCallbacks } from './pagelet/commands';
import {
    PAGELET_DETAIL_VIEW_TYPE,
    PageletDetailView,
    registerPageletDetailIcon,
    type PageletDetailPayload,
} from './pagelet/tab';
import type { AnalyzeCallback } from './pagelet/preload/types';
import type { DiscoveryResult } from './pagelet/panel/types';
import { buildDiscoveryPrompt, buildPreloadPrompt, parseStructuredResponse } from './pagelet/llm';
import { buildDiscoveryResultFromFindings } from './pagelet/DiscoveryAnalyzer';
import { buildPageletRelatedNotesQuery } from './pagelet/related-notes-query';
import {
    MemoryExtractionScheduler,
    createUserProfileStore,
    type MemoryExtractionPromptContext,
    type UserProfileStore,
} from './ai-services/memory-extraction';
import type { AiServiceHost } from './ai-services/AiServiceHost';
import type { MemoryHost } from './memory';
import type { ChatHost } from './chat/ChatHost';

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

/**
 * localStorage key guarding the one-time Notice fired when a stored
 * `pagelet.reviewsFolder` is coerced by the validator. Set to "1" after the
 * Notice fires so subsequent boots stay silent. Vault-scoped (Obsidian
 * isolates localStorage per vault), so a user can opt into the Notice
 * separately for each vault.
 */
const PAGELET_MIGRATION_NOTICE_KEY = "pa-pagelet-reviews-folder-migration";
const PAGELET_BACKGROUND_PREPARATION_NOTICE_KEY = "pa-pagelet-background-preparation-notice";
const VAULT_INSIGHTS_INJECTION_NOTICE_KEY = "pa-vault-insights-injection-notice";
const PAGELET_RATE_LIMIT_STORAGE_KEY_PREFIX = "pa-pagelet-rate-limit";
const PAGELET_RELATED_NOTES_TIMEOUT_MS = 8000;
type TimeoutHandle = PlatformTimeoutHandle;
type IntervalHandle = PlatformIntervalHandle;

function readPageletMigrationFlag(): boolean {
    try {
        return getPlatformLocalStorage()?.getItem(PAGELET_MIGRATION_NOTICE_KEY) === "1";
    } catch {
        return false;
    }
}

function writePageletMigrationFlag(): void {
    try {
        getPlatformLocalStorage()?.setItem(PAGELET_MIGRATION_NOTICE_KEY, "1");
    } catch {
        /* localStorage unavailable (private mode, mobile webview restrictions) — silently skip */
    }
}

function readPageletBackgroundPreparationNoticeFlag(): boolean {
    try {
        return getPlatformLocalStorage()?.getItem(PAGELET_BACKGROUND_PREPARATION_NOTICE_KEY) === "1";
    } catch {
        return false;
    }
}

function writePageletBackgroundPreparationNoticeFlag(): void {
    try {
        getPlatformLocalStorage()?.setItem(PAGELET_BACKGROUND_PREPARATION_NOTICE_KEY, "1");
    } catch {
        /* localStorage unavailable (private mode, mobile webview restrictions) — silently skip */
    }
}

function readVaultInsightsInjectionNoticeFlag(): boolean {
    try {
        return getPlatformLocalStorage()?.getItem(VAULT_INSIGHTS_INJECTION_NOTICE_KEY) === "1";
    } catch {
        return false;
    }
}

function writeVaultInsightsInjectionNoticeFlag(): void {
    try {
        getPlatformLocalStorage()?.setItem(VAULT_INSIGHTS_INJECTION_NOTICE_KEY, "1");
    } catch {
        /* localStorage unavailable — silently skip */
    }
}

export class PluginManager extends Plugin {
    settings!: PluginManagerSettings
    private _localGraph: LocalGraph | null = null;
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
    vss: VSS | null = null;
    memoryManager: MemoryManager | null = null;
    chatHistoryStore: ChatHistoryStore | undefined;
    chatHistoryManager: ChatHistoryManager | undefined;
    private memoryExtractionScheduler: MemoryExtractionScheduler | null = null;
    /**
     * Pagelet (Review Assistant) per-plugin runtime — lazy-constructed on
     * first review trigger so cold-start cost stays zero for users who never
     * enable Pagelet. Owned by the plugin so the framework's self-write
     * registry can outlive any individual PaAgentRuntime turn (which lives
     * per-streamTurn inside chat-service.ts).
     */
    private pageletRuntime: PaReviewRuntime | null = null;
    readonly pageletCostTracker = new PageletCostTracker();
    private pageletOrchestrator: PageletOrchestrator | null = null;
    private pageletSettingsUnsubscribe: (() => void) | null = null;
    private pageletCommandsRegistered = false;
    private pageletFocusCommandRegistered = false;
    private pageletBackgroundPreparationNoticeSurfacedThisBoot = false;
    private vaultInsightsInjectionNoticeSurfacedThisBoot = false;
    private pageletRateLimiterInstance: PageletRateLimiter | null = null;
    /**
     * Set by {@link loadSettings} when a pre-existing `pagelet.reviewsFolder`
     * was coerced to the default by the now-stricter validator. Consumed once
     * by {@link onload} to fire a one-time Notice so the user knows their
     * folder was reset (orphaned reviews on disk are unmoved). Cleared after
     * the Notice is dispatched. Persists across the boot via localStorage
     * key {@link PAGELET_MIGRATION_NOTICE_KEY} so the Notice only fires once.
     */
    private pendingPageletReviewsFolderMigration: {
        input: string;
        error: PageletReviewsFolderError;
    } | null = null;
    vssCacheDir: string = this.join(this.app.vault.configDir, "plugins/personal-assistant/vss-cache");
    private isVssCached: boolean = false;
    private token: string = "";
    private memoryStatusListeners = new Set<() => void | Promise<void>>();
    private settingsChangeListeners = new Set<() => void | Promise<void>>();
    private hoverPopoverObserver: MutationObserver | null = null;
    private resizeDebounceTimer: TimeoutHandle | null = null;
    private phase3Handle: PlatformTimeoutHandle | null = null;
    private unloading = false;
    private debouncedStatusBarUpdate = debounce(() => {
        void this.updateMemoryStatusBar();
    }, 300, true);

    private get localGraph(): LocalGraph {
        return (this._localGraph ??= new LocalGraph(this.app, this));
    }

    private t(key: PluginMessageKey | string, params?: Readonly<Record<string, string | number>>, fallback?: string): string {
        return pluginT(key, getPluginUiLanguage(), params, fallback);
    }

    async onload() {
        await this.loadSettings();

        // 迁移旧版本设置
        await this.migrateSettings();

        // Surface the one-time Pagelet reviewsFolder migration Notice, if
        // `loadSettings` flagged a coerced value. We fire here (not in
        // `loadSettings`) so the Notice is bound to plugin onload and respects
        // the user's installed locale.
        this.surfacePendingPageletReviewsFolderMigration();

        // showup notification of plugin starting when it is in debug mode
        if (this.settings.debug) {
            new Notice(this.t("plugin.notice.starting"));
            // register mobile debug log
            monkeyPatchConsole(this);
        }

        // This creates an icon in the left ribbon.
        addIcon(PA_CHAT_SUBAGENT_ICON, icons[PA_CHAT_SUBAGENT_ICON]);
        addIcon('PluginAST', icons['PluginAST']);
        const ribbonIconEl = this.addRibbonIcon(PA_CHAT_SUBAGENT_ICON, this.t("plugin.ribbon.openChatControls"), () => {
            void this.activeChatView();
        });
        ribbonIconEl.addClass('plugin-manager-ribbon-class');
        ribbonIconEl.addEventListener('contextmenu', (evt: MouseEvent) => {
            evt.preventDefault();
            new PluginControlModal(this.app).open();
        });

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

        this.chatHistoryStore = this.createChatHistoryStore();
        this.chatHistoryManager = new ChatHistoryManager({
            store: this.chatHistoryStore,
            log: (message, error) => this.log(message, error),
        });
        await this.initializeMemorySubsystem();
        if (this.unloading) return;
        this.initializeStatsSubsystem();
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
                return new LLMView(leaf, this.createChatHost());
            }
        );
        registerPageletDetailIcon();
        this.registerView(
            PAGELET_DETAIL_VIEW_TYPE,
            (leaf) => {
                return new PageletDetailView(leaf, () => this.getPageletLocale());
            }
        );

        this.addCommand({
            id: 'startup-recording',
            name: this.t("plugin.command.recordNote"),
            callback: async () => {
                const fileFormat = moment().format(this.settings.fileFormat);
                const targetDir = this.settings.targetPath;
                this.log(targetDir, fileFormat);
                await this.createNewNote(targetDir, fileFormat);
            }
        });

        this.addCommand({
            id: 'local-graph',
            name: this.t("plugin.command.hoverLocalGraph"),
            callback: async () => {
                await this.localGraph.startup();
            }
        });

        this.addCommand({
            id: 'switch-on-or-off-plugin',
            name: this.t("plugin.command.openControls"),
            callback: () => {
                const modal = new PluginControlModal(this.app);
                modal.setPlaceholder("Type plugin name to find it");
                modal.open();
            }
        });

        this.addCommand({
            id: "batch-switch-on-or-off-plugins",
            name: this.t("plugin.command.batchPluginControls"),
            callback: () => {
                const modal = new BatchPluginControlModal(this.app);
                modal.open();
            }
        });

        this.addCommand({
            id: 'set-local-graph-view-colors',
            name: this.t("plugin.command.setGraphColors"),
            callback: async () => {
                await this.localGraph.updateGraphColors();
            }
        });

        this.addCommand({
            id: 'update-plugins',
            name: this.t("plugin.command.updatePlugins"),
            callback: async () => {
                const pluginUpdater = new PluginsUpdater(this.app, this);
                await pluginUpdater.update();
            }
        })

        this.addCommand({
            id: 'update-themes',
            name: this.t("plugin.command.updateThemes"),
            callback: async () => {
                const themeUpdater = await ThemeUpdater.init(this.app, this);
                await themeUpdater.update();
            }
        })

        this.addCommand({
            id: 'update-metadata',
            name: this.t("plugin.command.updateMetadata"),
            callback: async () => {
                if (this.settings.enableMetadataUpdating) {
                    if (this.isEnabledMetadataUpdating) {
                        // if the command has already triggered, disable it and remove status
                        const statusBar = getPlatformDocument().getElementById("personal-assistant-statusbar");
                        statusBar?.removeClass("personal-assistant-statusbar-breathing");
                        // empty debounce which will stop updating metadata
                        this.updateDebouncer = debounce((file) => { }, 100, true);
                        // update the command triggered status
                        this.isEnabledMetadataUpdating = false;
                    } else {
                        this.updateDebouncer = debounce(this.updateMetadata, 100, true);
                        // if updating metadata is enabled, set the status and monitor the events to update metadata
                        const statusBar = getPlatformDocument().getElementById("personal-assistant-statusbar");
                        statusBar?.addClass("personal-assistant-statusbar-breathing");
                        this.registerEvent(this.app.workspace.on('file-open', (file) => {
                            this.updateDebouncer(file);
                        }));
                        // update the command triggered status
                        this.isEnabledMetadataUpdating = true;
                    }
                } else {
                    new Notice(this.t("plugin.notice.metadataCommandDisabled"));
                }
            }
        })


        this.addCommand({
            id: "list-callouts",
            name: this.t("plugin.command.listCallouts"),
            callback: () => {
                new CalloutModal(this.app, this).open();
            },
        });

        this.addCommand({
            id: "preview-records",
            name: this.t("plugin.command.previewRecords"),
            callback: () => {
                void this.activateView();
            }
        })

        this.addCommand({
            id: "show-statistics",
            name: this.t("plugin.command.showStatistics"),
            callback: async () => {
                await this.activeStatView();
            }
        })

        this.addCommand({
            id: 'ai-assistant-summary',
            name: this.t("plugin.command.aiSummary"),
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
            name: this.t("plugin.command.aiFeaturedImages"),
            editorCheckCallback: (checking, editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
                if (this.settings.aiProvider !== 'qwen' || !getDashScopeImageSynthesisUrl(this.settings.baseURL)) return false;
                if (checking) return true;
                if (!this.ensureAIConfigured()) return;
                const sel = editor.getSelection();
                const v = editor.getValue();

                this.log("AI Featured Images invoked", { selectionLength: sel.length, documentLength: v.length });
                if (view instanceof MarkdownView) {
                    this.log("invoking LLM");
                    const helper = new AssistantFeaturedImageHelper(this.app, this, editor, view);
                    helper.generate().catch((e) => this.log("Featured image generation failed", e));
                }
            }
        });

        this.addCommand({
            id: "init-vss",
            name: this.t("plugin.command.prepareMemory"),
            checkCallback: (checking) => this.runMemoryCommand(checking, async () => {
                const memoryManager = this.memoryManager;
                if (!memoryManager) return;
                await memoryManager.prepareFromCommand();
            }),
        })

        this.registerAdvancedMemoryCommands();

        this.addCommand({
            id: 'open-chat',
            name: this.t("plugin.command.openChatSidebar"),
            callback: () => {
                void this.activeChatView();
            }
        });

        this.registerVaultEventDispatch();
        // Handle the Editor Plugins
        this.registerEditorExtension([pluginField.init(() => this.createEditorPluginHost()), statusBarEditorPlugin, sectionWordCountEditorPlugin]);

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

        this.app.workspace.onLayoutReady(() => {
            void this.onLayoutReady();
        });
    }

    private async onLayoutReady(): Promise<void> {
        if (this.unloading) return;

        this.setupHoverPopoverObserver();
        await this.initializeMemorySubsystem();
        if (this.unloading) return;

        void this.chatHistoryManager?.initialize();
        this.initializeStatsSubsystem();
        void this.initializeCalloutManager();
        if (this.unloading) return;

        this.setupSettingsWatcher();
        if (!this.phase3Handle) {
            this.phase3Handle = setPlatformTimeout(() => {
                this.phase3Handle = null;
                void this.onIdle();
            }, 0);
        }
    }

    private onIdle(): void {
        if (this.unloading) return;
        this.syncPageletRuntime();
        this.syncMemoryExtractionRuntime();
    }

    private setupHoverPopoverObserver(): void {
        if (!Platform.isDesktop || this.hoverPopoverObserver) return;

        // Observe hover-editor popovers for local graph resize.
        this.hoverPopoverObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of Array.from(mutation.addedNodes)) {
                    if (
                        node.instanceOf(HTMLElement)
                        && (node.matches('.popover.hover-popover.hover-editor')
                            || node.querySelector('.popover.hover-popover.hover-editor'))
                    ) {
                        if (this.resizeDebounceTimer !== null) clearPluginTimeout(this.resizeDebounceTimer);
                        this.resizeDebounceTimer = setPluginTimeout(() => {
                            this.resizeDebounceTimer = null;
                            if (!this.hoverPopoverObserver) return;
                            this.localGraph.resize();
                        }, 150);
                        return;
                    }
                }
            }
        });
        this.hoverPopoverObserver.observe(getPlatformDocument().body, {
            childList: true,
        });
    }

    private async initializeMemorySubsystem(): Promise<void> {
        if (this.vss && this.memoryManager) {
            await this.updateMemoryStatusBar();
            return;
        }

        const memoryHost = this.createMemoryHost();
        if (!this.vss) {
            this.vss = this.initVss(memoryHost);
        }
        if (!this.memoryManager) {
            this.memoryManager = new MemoryManager(memoryHost, this.vss);
            this.memoryManager.startAutoMaintenance();
        }
        await this.updateMemoryStatusBar();
    }

    private initializeStatsSubsystem(): void {
        if (this.statsManager) return;
        this.statsManager = new StatsManager(this.createStatsHost());
    }

    private setupSettingsWatcher(): void {
        this.pageletSettingsUnsubscribe?.();
        this.pageletSettingsUnsubscribe = this.onSettingsChanged(() => {
            this.syncPageletRuntime();
            this.syncMemoryExtractionRuntime();
        });
    }

    private registerVaultEventDispatch(): void {
        // VSS lifecycle events mark local state dirty; approved Memory can then maintain itself in the background.
        this.registerEvent(
            this.app.vault.on("create", async (file) => {
                if (file instanceof TFile) {
                    // Pagelet reentrancy guard (Write Action Framework SDD §5.3 / R3):
                    // Obsidian fires `create` (not `modify`) for a NEW file, so the
                    // first Pagelet write of a review note arrives here. Without the
                    // same guard applied to modify below, vss would index the
                    // freshly-written review note, triggering a ripple.
                    if (this.pageletRuntime?.isRecentSelfWrite(file.path)) {
                        return;
                    }
                    this.memoryExtractionScheduler?.handleVaultEvent(file, "vault-create");
                    if (await this.vss?.markDirtyIfEligible(file)) {
                        this.memoryManager?.scheduleAutoFlush("vault-create");
                        this.debouncedStatusBarUpdate();
                    }
                }
            })
        );
        this.registerEvent(
            this.app.vault.on("modify", async (file) => {
                if (file instanceof TFile) {
                    // Pagelet reentrancy guard (Write Action Framework SDD §5.3 / R3):
                    // when the modify event was triggered by Pagelet's own
                    // review-note write, skip downstream side-effects so the
                    // listener does not re-invoke another review or mark a
                    // freshly-written review note as dirty for VSS.
                    if (this.pageletRuntime?.isRecentSelfWrite(file.path)) {
                        return;
                    }
                    this.memoryExtractionScheduler?.handleVaultEvent(file, "vault-modify");
                    if (await this.vss?.markDirtyIfEligible(file)) {
                        this.memoryManager?.scheduleAutoFlush("vault-modify");
                        this.debouncedStatusBarUpdate();
                    }
                }
            })
        );
        this.registerEvent(
            this.app.vault.on("rename", async (file, oldPath) => {
                this.memoryExtractionScheduler?.handleVaultEvent(file, "vault-rename");
                if (file instanceof TFile && await this.vss?.handleRename(file, oldPath)) {
                    this.memoryManager?.scheduleAutoFlush("vault-rename");
                    this.debouncedStatusBarUpdate();
                }
            })
        );
        this.registerEvent(
            this.app.vault.on("delete", async (file) => {
                if (file instanceof TFile) {
                    this.memoryExtractionScheduler?.handleVaultEvent(file, "vault-delete");
                    await this.vss?.handleDelete(file);
                    this.debouncedStatusBarUpdate();
                }
            })
        );
        this.registerEvent(
            this.app.workspace.on("active-leaf-change", async () => {
                await this.vss?.handleActiveLeafChange();
            })
        );
        this.registerEvent(
            this.app.workspace.on("file-open", async (file) => {
                if (await this.vss?.handleFileOpen(file)) {
                    const state = this.vss?.getMaintenanceState();
                    if (!state) return;
                    if (state.verificationPending > 0) {
                        this.memoryManager?.scheduleVerify("file-open");
                    }
                    if (state.dirtyCount > 0) {
                        this.memoryManager?.scheduleAutoFlush("file-open");
                    }
                    this.debouncedStatusBarUpdate();
                }
            })
        );
    }

    private syncPageletRuntime(): void {
        if (!this.settings.pagelet?.enabled) {
            this.destroyPageletRuntime();
            return;
        }

        this.registerPageletCommandsOnce();
        this.registerPageletFocusCommandOnce();

        if (this.pageletOrchestrator) {
            this.pageletRateLimiterInstance = null;
            this.pageletOrchestrator.syncSettings();
            this.surfacePageletBackgroundPreparationNotice();
            return;
        }

        try {
            this.surfacePageletBackgroundPreparationNotice();
            this.pageletOrchestrator = new PageletOrchestrator(this.createPageletHost());
            this.pageletOrchestrator.initialize();
        } catch (error) {
            this.log("Failed to initialize Pagelet", error);
        }
    }

    private syncMemoryExtractionRuntime(): void {
        if (this.settings.memoryExtractionEnabled && this.chatHistoryManager) {
            const includeVaultInsights = this.settings.memoryExtractionIncludeVaultInsights === true;
            if (!this.memoryExtractionScheduler) {
                this.memoryExtractionScheduler = new MemoryExtractionScheduler({
                    app: this.app,
                    chatHistoryManager: this.chatHistoryManager,
                    userProfileStore: this.createUserProfileStore(),
                    log: (message, error) => this.log(message, error),
                    includeVaultInsightsInPrompt: includeVaultInsights,
                    createModelForExtraction: async () => {
                        const model = await this.createChatModel(0, { maxTokens: 256 });
                        if (!model) return null;
                        return {
                            invoke: async (prompt: string) => {
                                const result = await model.invoke(prompt);
                                const text = coerceModelResultToString(result);
                                this.pageletCostTracker.record({
                                    inputTokens: estimateTokens(prompt),
                                    outputTokens: estimateTokens(text),
                                    provider: this.settings.aiProvider,
                                    model: this.settings.chatModelName,
                                });
                                return text;
                            },
                        };
                    },
                });
                const vss = this.vss;
                if (vss) {
                    this.memoryExtractionScheduler.setSemanticClusterProvider(
                        (maxClusters) => vss.clusterVectors(maxClusters),
                    );
                }
                this.memoryExtractionScheduler.start();
                if (!this.settings.memoryExtractionNoticeDismissed) {
                    new Notice(this.t("plugin.memoryExtraction.enabledNotice"));
                    this.settings.memoryExtractionNoticeDismissed = true;
                    void this.saveSettings();
                }
                this.surfaceVaultInsightsInjectionNotice();
            } else {
                this.memoryExtractionScheduler.setIncludeVaultInsightsInPrompt(includeVaultInsights);
                this.surfaceVaultInsightsInjectionNotice();
            }
        } else {
            if (this.memoryExtractionScheduler) {
                this.memoryExtractionScheduler.dispose();
                this.memoryExtractionScheduler = null;
            }
        }
    }

    private destroyPageletRuntime(): void {
        if (this.pageletOrchestrator) {
            try {
                this.pageletOrchestrator.destroy();
            } catch (error) {
                this.log("Failed to destroy Pagelet orchestrator", error);
            }
            this.pageletOrchestrator = null;
        }
        if (this.pageletRuntime) {
            try {
                this.pageletRuntime.dispose();
            } catch (error) {
                this.log("Failed to dispose Pagelet runtime", error);
            }
            this.pageletRuntime = null;
        }
        this.pageletRateLimiterInstance = null;
    }

    private pageletCommandCallbacks(): PageletCommandCallbacks {
        const dispatch = <T>(run: (callbacks: PageletCommandCallbacks) => T): T | undefined => {
            if (!this.settings.pagelet?.enabled) {
                new Notice(pageletT("pagelet.notice.disabled", this.getPageletLocale()), 4000);
                return undefined;
            }
            this.syncPageletRuntime();
            const callbacks = this.pageletOrchestrator?.getCommandCallbacks();
            if (!callbacks) return undefined;
            return run(callbacks);
        };
        return {
            onOpenPanel: () => dispatch((callbacks) => callbacks.onOpenPanel()),
            onReviewCurrent: () => dispatch((callbacks) => callbacks.onReviewCurrent()),
            onQuickReview: () => dispatch((callbacks) => callbacks.onQuickReview()),
            onDiscoverConnections: () => dispatch((callbacks) => callbacks.onDiscoverConnections()),
            onPeriodicSummary: () => dispatch((callbacks) => callbacks.onPeriodicSummary()),
            onToggleProactiveHints: () => dispatch((callbacks) => callbacks.onToggleProactiveHints()),
            onShowBackgroundPreparationStatus: () => dispatch((callbacks) => callbacks.onShowBackgroundPreparationStatus()),
            onMovePetCorner: () => dispatch((callbacks) => callbacks.onMovePetCorner()),
            onTogglePetVisibility: () => dispatch((callbacks) => callbacks.onTogglePetVisibility()),
        };
    }

    private registerPageletCommandsOnce(): void {
        if (this.pageletCommandsRegistered) return;
        registerPageletCommands(
            this as unknown as Parameters<typeof registerPageletCommands>[0],
            this.pageletCommandCallbacks(),
            this.getPageletLocale(),
        );
        this.pageletCommandsRegistered = true;
    }

    private registerPageletFocusCommandOnce(): void {
        if (this.pageletFocusCommandRegistered) return;
        try {
            registerPageletFocusCommand(this as unknown as Parameters<typeof registerPageletFocusCommand>[0], {
                name: pageletT("pagelet.a11y.focusLatestCommand", this.getPageletLocale()),
                hotkeys: [PAGELET_FOCUS_LATEST_DEFAULT_HOTKEY],
            });
            this.pageletFocusCommandRegistered = true;
        } catch (error) {
            this.log("Failed to register Pagelet focus command", error);
        }
        void PAGELET_FOCUS_LATEST_COMMAND_ID;
    }

    private createStatsHost(): StatsHost {
        return {
            app: this.app,
            settings: this.settings,
            log: (...args: unknown[]) => this.log(args[0] as string, ...args.slice(1)),
            registerEvent: (ref) => this.registerEvent(ref),
        };
    }

    private createEditorPluginHost(): EditorPluginHost {
        const getStatsManager = () => this.statsManager;
        return {
            app: this.app,
            settings: this.settings,
            get statsManager() {
                return getStatsManager();
            },
        };
    }

    private createPageletHost(): PageletHost {
        return {
            app: this.app,
            settings: this.settings,
            log: (...args: unknown[]) => this.log(args[0] as string, ...args.slice(1)),
            registerEvent: (ref) => this.registerEvent(ref),
            saveSettings: () => this.saveSettings(),
            createPreloadAnalyzeCallback: (): AnalyzeCallback => {
                return async (files, config) => {
                    const noteContents = await this.readPageletNoteContents(
                        files,
                        config.tokenBudget.input,
                    );
                    const relatedNotes = await this.findPageletRelatedNotes(
                        files[0]?.path ?? "",
                        noteContents,
                        files.map((f) => f.path),
                    ).catch(() => []);
                    const relatedBudget = Math.floor(config.tokenBudget.input * 0.3);
                    const primaryBudget = { input: config.tokenBudget.input - relatedBudget, output: config.tokenBudget.output };
                    const truncatedRelated = relatedNotes.length > 0
                        ? relatedNotes.map((rn) => ({
                            path: rn.path,
                            content: rn.content.slice(0, Math.floor(relatedBudget / Math.max(1, relatedNotes.length))),
                        }))
                        : [];
                    const enrichedContents = [...noteContents, ...truncatedRelated];
                    const prompt = buildPreloadPrompt(enrichedContents, primaryBudget);
                    const model = await this.createChatModel(0.3, {
                        maxTokens: prompt.maxOutputTokens,
                    });
                    if (!model) {
                        throw new Error("No AI model configured");
                    }
                    const fullPrompt = prompt.systemPrompt + "\n\n" + prompt.userPrompt;
                    const result = await model.invoke(fullPrompt);
                    const text = coerceModelResultToString(result);
                    const parsed = parseStructuredResponse(text);
                    const inputTokens = estimateTokens(fullPrompt);
                    const outputTokens = estimateTokens(text);
                    this.pageletCostTracker.record({
                        inputTokens,
                        outputTokens,
                        provider: this.settings.aiProvider,
                        model: this.settings.chatModelName,
                    });
                    return {
                        findings: parsed.findings.map((f) => ({
                            text: f.text,
                            sourceFile: f.sourceFile || files[0]?.path || "",
                            sourceTitle: f.sourceTitle || files[0]?.basename || "",
                        })),
                        analyzedFiles: files.map((f) => f.path),
                        analyzedAt: Date.now(),
                        tokenCost: { input: inputTokens, output: outputTokens },
                    };
                };
            },
            createForegroundAnalyzeCallback: (): AnalyzeCallback => {
                return async (files, config) => {
                    const noteContents = await this.readPageletNoteContents(
                        files,
                        config.tokenBudget.input,
                    );
                    const primarySourcePath = files[0]?.path ?? noteContents[0]?.path ?? "";
                    const bundle = buildPageletScopeReviewBundle({
                        entries: noteContents,
                        primarySourcePath,
                        range: config.range ?? "current",
                        settings: this.settings.pagelet,
                        uiLanguage: this.getPageletLocale(),
                    });
                    if (!bundle) {
                        return {
                            findings: [],
                            analyzedFiles: files.map((f) => f.path),
                            analyzedAt: Date.now(),
                            tokenCost: { input: 0, output: 0 },
                        };
                    }

                    const relatedNotes = await this.findPageletRelatedNotes(
                        bundle.primarySourcePath,
                        noteContents,
                        bundle.sourcePaths,
                    );
                    const reviewInput = relatedNotes.length > 0
                        ? { ...bundle.input, relatedNotes }
                        : bundle.input;

                    const reviewModel = new PageletReviewModel(
                        (temperature, options) => this.createChatModel(temperature, {
                            modelName: options?.modelName,
                            maxTokens: config.tokenBudget.output,
                        }),
                        {
                            temperature: this.settings.pagelet.temperature,
                            modelName: this.settings.chatModelName,
                            costBudget: {
                                maxInputTokens: this.settings.pagelet.maxInputTokens,
                                maxOutputTokens: this.settings.pagelet.maxOutputTokens,
                            },
                            costTracker: this.pageletCostTracker,
                            rateLimiter: this.getPageletRateLimiter(),
                            providerForPricing: this.settings.aiProvider,
                            modelForPricing: this.settings.chatModelName,
                            userMessageLocale: this.getPageletLocale(),
                            reviewTimeoutMs: 60_000,
                        },
                    );

                    const outcome = await reviewModel.reviewNote(reviewInput);
                    if (outcome.status === "error") {
                        throw new Error(outcome.userMessage);
                    }

                    const sourceById = new Map(
                        bundle.sourceReferences.map((reference) => [reference.sourceId, reference]),
                    );
                    const findings = outcome.result.suggestions.map((suggestion) => {
                        const source = sourceById.get(suggestion.source_id);
                        const sourceFile = source?.path ?? bundle.primarySourcePath;
                        return {
                            text: suggestion.proposed_action,
                            sourceFile,
                            sourceTitle: sourceFile.split("/").pop()?.replace(/\.md$/, "") ?? sourceFile,
                            suggestion,
                            diagnostics: {
                                truncated: outcome.diagnostics.truncated,
                                partial: outcome.diagnostics.partial,
                                droppedSuggestionsCount: outcome.diagnostics.droppedSuggestionsCount,
                                costEntry: outcome.diagnostics.costEntry,
                            },
                        };
                    });
                    const costEntry = outcome.diagnostics.costEntry;
                    return {
                        findings,
                        analyzedFiles: bundle.sourcePaths,
                        analyzedAt: Date.now(),
                        tokenCost: {
                            input: costEntry?.inputTokens ?? outcome.diagnostics.estimatedInputTokens ?? 0,
                            output: costEntry?.outputTokens ?? 0,
                        },
                    };
                };
            },
            createGenerateCallback: () => {
                return async (prompt, noteContents, tokenBudget) => {
                    await this.reservePageletRateLimitSlot();
                    const model = await this.createChatModel(0.3, {
                        maxTokens: tokenBudget.output,
                    });
                    if (!model) {
                        throw new Error("No AI model configured");
                    }
                    const result = await model.invoke(prompt);
                    const text = coerceModelResultToString(result);
                    const inputTokens = estimateTokens(prompt);
                    const outputTokens = estimateTokens(text);
                    this.pageletCostTracker.record({
                        inputTokens,
                        outputTokens,
                        provider: this.settings.aiProvider,
                        model: this.settings.chatModelName,
                    });
                    return { text, tokenCost: { input: inputTokens, output: outputTokens } };
                };
            },
            updatePageletSetting: <K extends keyof PageletSettings>(key: K, value: PageletSettings[K]) => {
                this.settings.pagelet[key] = value;
                void this.saveSettings();
            },
            writeReviewNote: (note: GeneratedReviewNote) => this.writePageletReviewNote(note),
            openPageletDetailView: (payload: PageletDetailPayload) => this.openPageletDetailView(payload),
            findRelatedNotes: (primarySourcePath, noteContents, sourcePaths) =>
                this.findPageletRelatedNotes(primarySourcePath, noteContents, sourcePaths),
            isMemoryReadyForPageletDiscovery: () =>
                this.isPageletMemorySearchReady(),
            discoverConnections: async (currentNote, relatedNotes) =>
                this.runDiscoveryAnalysis(currentNote, relatedNotes),
        };
    }

    private createMemoryHost(): MemoryHost {
        return {
            app: this.app,
            pluginId: this.manifest?.id ?? "personal-assistant",
            settings: this.settings,
            log: (...args: unknown[]) => this.log(args[0] as string, ...args.slice(1)),
            registerEvent: (ref) => this.registerEvent(ref),
            saveSettings: () => this.saveSettings(),
            getVSSFiles: () => this.getVSSFiles(),
            getAPIToken: () => this.getAPIToken(),
            notifyStatusChanged: () => this.debouncedStatusBarUpdate(),
            updateMemorySetting: (key, value) => {
                (this.settings as unknown as Record<string, unknown>)[key] = value;
                void this.saveSettings();
            },
        };
    }

    private createAiServiceHost(): AiServiceHost {
        return {
            app: this.app,
            settings: this.settings,
            log: (...args: unknown[]) => this.log(args[0] as string, ...args.slice(1)),
            getAPIToken: () => this.getAPIToken(),
            isOperationsAgentEnabled: this.isOperationsAgentEnabled,
            getMemoryExtractionPromptContext: () =>
                this.getMemoryExtractionPromptContext() as unknown as Record<string, unknown>,
            memorySearch: {
                ensureReadyForChat: (query) =>
                    this.memoryManager?.ensureReadyForChat(query) ?? Promise.resolve({ decision: "answer-now" }),
                searchHybrid: (query, opts) =>
                    this.vss?.searchHybrid(query, opts) ?? Promise.resolve([]),
                getChunksByPath: (paths, opts) =>
                    this.vss?.getChunksByPath(paths, opts) ?? Promise.resolve([]),
            },
            getResolvedLinks: () =>
                this.app?.metadataCache?.resolvedLinks as Record<string, Record<string, number>> | undefined,
        };
    }

    createChatService(): ChatService {
        return new ChatService(this.createAiServiceHost());
    }

    private createChatHost(): ChatHost {
        return {
            app: this.app,
            settings: this.settings,
            log: (...args: unknown[]) => this.log(args[0] as string, ...args.slice(1)),
            getAISetupIssue: () => this.getAISetupIssue(),
            chatHistoryManager: this.chatHistoryManager,
            memoryStatus: {
                getMaintenancePlan: () => this.memoryManager?.getMaintenancePlan() ?? Promise.resolve({
                    reason: "unavailable",
                    action: "none",
                    notesToCheck: 0,
                    requiresApproval: false,
                    canAnswerNow: true,
                }),
                prepareFromCommand: () => this.memoryManager?.prepareFromCommand() ?? Promise.resolve(),
                updateFromCommand: () => this.memoryManager?.updateFromCommand() ?? Promise.resolve(),
                showTechnicalStatus: () => void this.showTechnicalMemoryStatus(),
                onStatusChanged: (listener) => this.onMemoryStatusChanged(listener),
            },
            createChatService: () => new ChatService(this.createAiServiceHost()),
            onSettingsChanged: (listener) => this.onSettingsChanged(listener),
            scheduleMemoryExtractionAfterChatTurn: (conversationId, turnCount) =>
                this.scheduleMemoryExtractionAfterChatTurn(conversationId, turnCount),
        };
    }

    private getPageletRateLimiter(): PageletRateLimiter {
        if (!this.pageletRateLimiterInstance) {
            this.pageletRateLimiterInstance = new PageletRateLimiter({
                storage: this.createPageletRateLimitStorage(),
                config: {
                    hourlyCap: this.settings.pagelet.foregroundPerHourCap,
                    dailyCap: this.settings.pagelet.foregroundPerDayCap,
                },
            });
        }
        return this.pageletRateLimiterInstance;
    }

    private createPageletRateLimitStorage(): PageletRateLimitStorage {
        const key = this.pageletRateLimitStorageKey();
        return {
            load: (): PageletRateLimitState | null => {
                try {
                    const raw = getPlatformLocalStorage()?.getItem(key);
                    if (!raw) return null;
                    const parsed = JSON.parse(raw) as PageletRateLimitState;
                    return parsed && typeof parsed === "object" ? parsed : null;
                } catch {
                    return null;
                }
            },
            save: (state: PageletRateLimitState): void => {
                try {
                    getPlatformLocalStorage()?.setItem(key, JSON.stringify(state));
                } catch {
                    /* localStorage unavailable — PageletRateLimiter will still gate within this call. */
                }
            },
        };
    }

    private pageletRateLimitStorageKey(): string {
        const vaultName = typeof this.app.vault.getName === "function"
            ? this.app.vault.getName()
            : "vault";
        return [
            PAGELET_RATE_LIMIT_STORAGE_KEY_PREFIX,
            encodeURIComponent(vaultName),
            encodeURIComponent(this.app.vault.configDir || ".obsidian"),
        ].join(":");
    }

    private async reservePageletRateLimitSlot(): Promise<void> {
        const decision = await this.getPageletRateLimiter().reserve();
        if (decision.ok) return;
        const key = decision.reason === "hr-cap"
            ? "pagelet.errors.rate_limit_hourly"
            : "pagelet.errors.rate_limit_daily";
        throw new Error(pageletT(key, this.getPageletLocale()));
    }

    /**
     * Lazy accessor for the Pagelet (Review Assistant) runtime.
     *
     * - Returns `null` when Pagelet is disabled in settings (commands or UI
     *   should never have called this, but be defensive).
     * - Otherwise constructs the runtime on first call, then returns the
     *   cached instance. Disposal happens in `onunload`.
     */
    getOrCreatePageletRuntime(): PaReviewRuntime | null {
        if (!this.settings.pagelet?.enabled) {
            return null;
        }
        if (!this.pageletRuntime) {
            if (!this.pageletOrchestrator) return null;
            this.pageletRuntime = createPaReviewRuntime({
                app: this.app,
                getPageletSettings: () => this.settings.pagelet,
                getLocale: () => this.getPageletLocale(),
                licenseTier: this.settings.licenseTier,
                debug: this.settings.debug,
            });
            this.log("Pagelet runtime initialized");
        }
        return this.pageletRuntime;
    }

    private async readPageletNoteContents(
        files: TFile[],
        inputTokenBudget: number,
    ): Promise<Array<{ path: string; content: string }>> {
        const maxFiles = Math.max(
            1,
            Math.min(files.length, 20, Math.floor(Math.max(1, inputTokenBudget) / 100)),
        );
        const selectedFiles = files.slice(0, maxFiles);
        const totalCharBudget = Math.max(1_000, Math.max(1, inputTokenBudget) * 4);
        const perFileCharBudget = Math.max(1_000, Math.floor(totalCharBudget / selectedFiles.length));
        const noteContents: Array<{ path: string; content: string }> = [];

        for (const file of selectedFiles) {
            try {
                const content = await this.app.vault.cachedRead(file);
                noteContents.push({
                    path: file.path,
                    content: content.length > perFileCharBudget
                        ? `${content.slice(0, perFileCharBudget)}\n[...truncated]`
                        : content,
                });
            } catch (error) {
                this.log("Failed to read Pagelet note content", { path: file.path, error });
            }
        }

        return noteContents;
    }

    private async findPageletRelatedNotes(
        primarySourcePath: string,
        noteContents: Array<{ path: string; content: string }>,
        sourcePaths: readonly string[],
    ): Promise<Array<{ path: string; content: string; score?: number; headingPath?: string[] }>> {
        if (!this.vss || noteContents.length === 0) return [];
        if (!(await this.isPageletMemorySearchReady())) return [];
        const excluded = new Set(sourcePaths.map((path) => normalizePath(path)));
        const primary = noteContents.find((entry) => normalizePath(entry.path) === normalizePath(primarySourcePath))
            ?? noteContents[0];
        const query = buildPageletRelatedNotesQuery(primary);
        if (!query.trim()) return [];
        const controller = new AbortController();
        const timeout = setPlatformTimeout(() => controller.abort(), PAGELET_RELATED_NOTES_TIMEOUT_MS);
        try {
            const raw = await this.vss.searchHybrid(query, {
                ftsQueryOverride: null,
                signal: controller.signal,
            }) as Array<{
                score?: unknown;
                doc?: { pageContent?: unknown; metadata?: Record<string, unknown> };
            }>;
            const seen = new Set<string>();
            const related: Array<{ path: string; content: string; score?: number; headingPath?: string[] }> = [];
            for (const result of raw) {
                const metadata = result.doc?.metadata ?? {};
                const path = typeof metadata.path === "string" ? normalizePath(metadata.path) : "";
                if (!path || excluded.has(path) || seen.has(path)) continue;
                seen.add(path);
                const content = typeof result.doc?.pageContent === "string"
                    ? result.doc.pageContent
                    : String(result.doc?.pageContent ?? "");
                related.push({
                    path,
                    content: content.slice(0, 1200),
                    score: typeof result.score === "number" ? result.score : undefined,
                    headingPath: Array.isArray(metadata.headingPath)
                        ? metadata.headingPath.filter((entry): entry is string => typeof entry === "string")
                        : undefined,
                });
                if (related.length >= 6) break;
            }
            return related;
        } catch (error) {
            if (!controller.signal.aborted) {
                this.log("Pagelet related-note Memory search skipped", error);
            }
            return [];
        } finally {
            clearPlatformTimeout(timeout);
        }
    }

    private async isPageletMemorySearchReady(): Promise<boolean> {
        if (!this.settings.memoryEnabled || !this.vss) return false;
        try {
            const stats = await this.vss.getStats({ mode: "foreground" });
            return stats.status === "ready" && stats.chunkCount > 0;
        } catch (error) {
            this.log("Pagelet related-note Memory readiness check skipped", error);
            return false;
        }
    }

    private async runDiscoveryAnalysis(
        currentNote: { path: string; content: string },
        relatedNotes: Array<{ path: string; content: string }>,
    ): Promise<DiscoveryResult | null> {
        const prompt = buildDiscoveryPrompt(currentNote, relatedNotes, {
            input: this.settings.pagelet.maxInputTokens,
            output: this.settings.pagelet.maxOutputTokens,
        });
        const model = await this.createChatModel(0.3, {
            maxTokens: prompt.maxOutputTokens,
        });
        if (!model) return null;
        try {
            const fullPrompt = prompt.systemPrompt + "\n\n" + prompt.userPrompt;
            const result = await model.invoke(fullPrompt);
            const text = coerceModelResultToString(result);
            const inputTokens = estimateTokens(fullPrompt);
            const outputTokens = estimateTokens(text);
            this.pageletCostTracker.record({
                inputTokens,
                outputTokens,
                provider: this.settings.aiProvider,
                model: this.settings.chatModelName,
            });
            const parsed = parseStructuredResponse(text);
            return buildDiscoveryResultFromFindings(parsed.findings, currentNote.path, relatedNotes);
        } catch (error) {
            this.log("Discovery analysis failed", error);
            return null;
        }
    }

    private async writePageletReviewNote(note: GeneratedReviewNote): Promise<WriteResult> {
        const runtime = this.getOrCreatePageletRuntime();
        if (!runtime) {
            return { success: false, error: "Pagelet write runtime is unavailable." };
        }

        const targetPath = await this.mintNonCollidingPageletPath(note.targetPath);
        const lastSlash = targetPath.lastIndexOf("/");
        const targetFolder = lastSlash >= 0 ? targetPath.slice(0, lastSlash) : "";
        const fileName = lastSlash >= 0 ? targetPath.slice(lastSlash + 1) : targetPath;
        const generatedNote: GeneratedReviewNote = {
            ...note,
            targetPath,
            targetFolder,
            fileName,
        };

        const result = await runtime.actionExecutor.execute(
            runtime.toolProvider.capability,
            {
                generatedNote,
                targetPath,
            },
            {
                host: this.createAiServiceHost(),
                turnId: `pagelet-review-note-${Date.now()}`,
            },
        );

        if (result.status === "ok") {
            const observation = result.observation as { createdPath?: unknown } | null;
            return {
                success: true,
                filePath: typeof observation?.createdPath === "string"
                    ? observation.createdPath
                    : targetPath,
            };
        }

        return {
            success: false,
            error: result.userSafeMessage ?? result.error ?? "Pagelet write failed.",
        };
    }

    private async mintNonCollidingPageletPath(basePath: string): Promise<string> {
        const normalized = normalizePath(basePath);
        if (!(await this.app.vault.adapter.exists(normalized))) {
            return normalized;
        }

        const extIndex = normalized.lastIndexOf(".");
        const slashIndex = normalized.lastIndexOf("/");
        const hasExtension = extIndex > slashIndex;
        const ext = hasExtension ? normalized.slice(extIndex) : "";
        const stem = hasExtension ? normalized.slice(0, extIndex) : normalized;
        for (let i = 2; i <= 100; i++) {
            const candidate = normalizePath(`${stem}-${i}${ext}`);
            if (!(await this.app.vault.adapter.exists(candidate))) {
                return candidate;
            }
        }

        const now = new Date();
        const hh = String(now.getUTCHours()).padStart(2, "0");
        const mm = String(now.getUTCMinutes()).padStart(2, "0");
        const ss = String(now.getUTCSeconds()).padStart(2, "0");
        return normalizePath(`${stem}-${hh}${mm}${ss}${ext}`);
    }

    /**
     * Resolve the Pagelet UI locale once per call. The detector reads from
     * Obsidian's `localStorage("language")` + browser fallbacks; cheap
     * enough to invoke per click / per render without caching.
     */
    private getPageletLocale(): "zh" | "en" {
        return getPageletUiLanguage();
    }

    async onunload() {
        this.unloading = true;
        if (this.phase3Handle !== null) {
            clearPlatformTimeout(this.phase3Handle);
            this.phase3Handle = null;
        }
        this.debouncedStatusBarUpdate.cancel();
        const statsManager = this.statsManager;
        if (this.resizeDebounceTimer !== null) clearPluginTimeout(this.resizeDebounceTimer);
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
        this.memoryExtractionScheduler?.dispose();
        this.memoryExtractionScheduler = null;
        this.pageletSettingsUnsubscribe?.();
        this.pageletSettingsUnsubscribe = null;
        if (this.pageletOrchestrator) {
            try {
                this.pageletOrchestrator.destroy();
            } catch (error) {
                this.log("Failed to destroy Pagelet orchestrator", error);
            }
            this.pageletOrchestrator = null;
        }
        if (this.pageletRuntime) {
            try {
                this.pageletRuntime.dispose();
            } catch (error) {
                this.log("Failed to dispose Pagelet runtime", error);
            }
            this.pageletRuntime = null;
        }
    }

    getMemoryExtractionPromptContext(): MemoryExtractionPromptContext {
        if (!this.settings.memoryExtractionEnabled) return {};
        const context = this.memoryExtractionScheduler?.getPromptContext() ?? {};
        if (this.settings.memoryExtractionIncludeVaultInsights) return context;
        const { userProfile } = context;
        return userProfile ? { userProfile } : {};
    }

    scheduleMemoryExtractionAfterChatTurn(conversationId: string, turnCount: number): void {
        this.memoryExtractionScheduler?.scheduleTypeAExtraction(conversationId, turnCount);
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
        // Detect when a pre-existing `pagelet.reviewsFolder` was just coerced
        // by the now-stricter validator (e.g. an early-beta user stored
        // ".obsidian/plugins/personal-assistant/reviews" or "C:\\notes"). The
        // merged value has already failed-closed to ".pagelet", but the user
        // deserves to know — their old reviews on disk are now orphaned. We
        // surface a Notice once via `onload`; the flag persists in localStorage
        // so the Notice never re-fires on subsequent boots.
        const rawPagelet = (typeof loaded === "object" && loaded !== null)
            ? (loaded as Record<string, unknown>).pagelet
            : undefined;
        const rawReviewsFolder = (typeof rawPagelet === "object" && rawPagelet !== null)
            ? (rawPagelet as Record<string, unknown>).reviewsFolder
            : undefined;
        if (typeof rawReviewsFolder === "string" && rawReviewsFolder.trim().length > 0) {
            const inspection = normalizeReviewsFolder(rawReviewsFolder);
            if (inspection.error && !readPageletMigrationFlag()) {
                this.pendingPageletReviewsFolderMigration = {
                    input: inspection.input ?? rawReviewsFolder,
                    error: inspection.error,
                };
            }
        }
        this.log("Settings loaded", this.settings);
    }

    async saveSettings() {
        await this.saveData(this.settings);
        await this.notifySettingsChanged();
    }

    /**
     * One-shot: fire the migration Notice queued by {@link loadSettings} if
     * any, then persist the localStorage flag so subsequent boots are silent.
     * Idempotent — runs at most once per boot and at most once per vault
     * lifetime regardless of how many times it is invoked.
     */
    private surfacePendingPageletReviewsFolderMigration(): void {
        const pending = this.pendingPageletReviewsFolderMigration;
        if (!pending) return;
        this.pendingPageletReviewsFolderMigration = null;
        const locale = this.getPageletLocale();
        // Body has the user's original input quoted back so they can re-point
        // their folder (or move files from the orphaned location) without
        // re-typing it. 10s timeout is long enough to read; clicking dismisses.
        const message = `${pageletT("pagelet.migration.reviewsFolderCoerced.title", locale)}\n${pending.input}`;
        try {
            new Notice(message, 10000);
        } catch (error) {
            this.log("Failed to fire Pagelet migration Notice", error);
        }
        writePageletMigrationFlag();
        this.log(
            "Pagelet reviewsFolder coerced on load; emitted one-time Notice",
            { error: pending.error, input: pending.input },
        );
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
            const interval = setPluginInterval(() => {
                const pluginInstance = pluginRegistry.plugins?.[pluginId];
                if (pluginInstance !== undefined) {
                    clearPluginTimeout(timeout);
                    clearPluginInterval(interval);
                    resolve(pluginInstance);
                }
            }, CALLOUT_MANAGER_READY_POLL_MS);
            const timeout = setPluginTimeout(() => {
                clearPluginInterval(interval);
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
            if (file.extension === 'md') {
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
                        setPluginTimeout(() => {
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

    async openPageletDetailView(payload: PageletDetailPayload): Promise<void> {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(PAGELET_DETAIL_VIEW_TYPE)[0];

        if (!leaf) {
            leaf = workspace.getLeaf('tab');
            await leaf.setViewState({
                type: PAGELET_DETAIL_VIEW_TYPE,
                active: true,
            });
        }

        await leaf.loadIfDeferred?.();
        if (!(leaf.view instanceof PageletDetailView)) {
            await leaf.setViewState({
                type: PAGELET_DETAIL_VIEW_TYPE,
                active: true,
            });
            await leaf.loadIfDeferred?.();
        }

        await workspace.revealLeaf(leaf);

        if (leaf.view instanceof PageletDetailView) {
            leaf.view.setPayload(payload);
            return;
        }

        throw new Error("Failed to initialize Pagelet detail view");
    }

    async activeChatView(): Promise<LLMView | null> {
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

        return leaf?.view instanceof LLMView ? leaf.view : null;
    }

    /**
     * Whether Operations Agent mode is enabled in the user's settings.
     * When true, the PA Agent runtime switches to "chat-with-actions"
     * policy and registers the AppendToolProvider so the model can
     * propose write actions that go through the 4-gate framework.
     */
    get isOperationsAgentEnabled(): boolean {
        return OPERATIONS_AGENT_RUNTIME_ENABLED;
    }

    /**
     * Opaque plugin reference for the orchestrator host contract.
     * Satisfies {@link AgentCapabilityContext['plugin']} at runtime
     * since PluginManager extends Plugin.
     */
    get capabilityPlugin(): PluginManager {
        return this;
    }

    /**
     * Chat-model factory for the orchestrator host contract.
     * Delegates to {@link AIUtils.createChatModel}.
     */
    async createChatModel(
        temperature: number,
        options?: { modelName?: string; transport?: string; maxTokens?: number },
    ) {
        const aiUtils = new AIUtils(this);
        return aiUtils.createChatModel(temperature, {
            modelName: options?.modelName,
            transport: options?.transport as "obsidian" | "native" | undefined,
            maxTokens: options?.maxTokens,
        });
    }

    private surfacePageletBackgroundPreparationNotice(): void {
        if (this.pageletBackgroundPreparationNoticeSurfacedThisBoot) return;
        if (!this.settings.pagelet?.enabled || !this.settings.pagelet.preloadEnabled) return;
        if (readPageletBackgroundPreparationNoticeFlag()) return;
        this.pageletBackgroundPreparationNoticeSurfacedThisBoot = true;
        const locale = this.getPageletLocale();
        try {
            new Notice(pageletT("pagelet.backgroundPreparation.startupNotice", locale), 10000);
        } catch (error) {
            this.log("Failed to fire Pagelet background preparation Notice", error);
        }
        writePageletBackgroundPreparationNoticeFlag();
    }

    private surfaceVaultInsightsInjectionNotice(): void {
        if (this.vaultInsightsInjectionNoticeSurfacedThisBoot) return;
        if (!this.settings.memoryExtractionIncludeVaultInsights) return;
        if (readVaultInsightsInjectionNoticeFlag()) return;
        this.vaultInsightsInjectionNoticeSurfacedThisBoot = true;
        try {
            new Notice(this.t("plugin.memoryExtraction.vaultInsightsInjection.onboardingNotice"), 10000);
        } catch (error) {
            this.log("Failed to fire vault insights injection Notice", error);
        }
        writeVaultInsightsInjectionNoticeFlag();
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

    private initVss(memoryHost: MemoryHost) {
        if (this.vss) {
            return this.vss;
        }

        return new VSS(memoryHost, this.vssCacheDir, this.createVSSIndexStateStore());
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

    createUserProfileStore(): UserProfileStore {
        const manifest = this.manifest as { id?: string } | undefined;
        return createUserProfileStore(
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
                new Notice(this.t("plugin.notice.memoryPrepareFailed"), 7000);
            }
        }
    }

    onMemoryStatusChanged(listener: () => void | Promise<void>): () => void {
        this.memoryStatusListeners ??= new Set();
        this.memoryStatusListeners.add(listener);
        return () => {
            this.memoryStatusListeners.delete(listener);
        };
    }

    onSettingsChanged(listener: () => void | Promise<void>): () => void {
        this.settingsChangeListeners ??= new Set();
        this.settingsChangeListeners.add(listener);
        return () => {
            this.settingsChangeListeners.delete(listener);
        };
    }

    private async notifySettingsChanged() {
        this.settingsChangeListeners ??= new Set();
        await Promise.allSettled(
            Array.from(this.settingsChangeListeners, (listener) => Promise.resolve().then(listener)),
        );
    }

    async updateMemoryStatusBar() {
        this.memoryStatusListeners ??= new Set();
        await Promise.allSettled(
            Array.from(this.memoryStatusListeners, (listener) => Promise.resolve().then(listener)),
        );
    }

    async showTechnicalMemoryStatus() {
        if (!this.vss) {
            this.showTechnicalMemoryNotice({
                title: this.t("plugin.memory.diagnostics.title"),
                summary: this.t("plugin.memory.diagnostics.notInitializedSummary"),
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
            return this.t("plugin.memory.diagnostics.performance100k");
        }
        if (chunkCount > 50_000) {
            return this.t("plugin.memory.diagnostics.performance50k");
        }
        return "";
    }

    private buildTechnicalMemoryStatusModel(stats: TechnicalMemoryStats, maintenance: TechnicalMemoryMaintenance): TechnicalMemoryNoticeModel {
        const status = this.formatTechnicalMemoryStatus(stats);
        const maintenanceText = this.formatTechnicalMaintenanceState(maintenance);
        const details: TechnicalMemoryDetail[] = [
            {
                label: this.t("plugin.memory.diagnostics.indexed"),
                value: this.t("plugin.memory.diagnostics.indexedValue", {
                    chunks: stats.chunkCount,
                    files: stats.fileCount,
                }),
            },
            { label: this.t("plugin.memory.diagnostics.backend"), value: stats.backend },
            {
                label: this.t("plugin.memory.diagnostics.storage"),
                value: stats.storagePersisted === false
                    ? this.t("plugin.memory.diagnostics.storageBestEffort")
                    : this.t("plugin.memory.diagnostics.storagePersistent"),
                tone: stats.storagePersisted === false ? "warning" : undefined,
            },
            {
                label: this.t("plugin.memory.diagnostics.maintenance"),
                value: maintenanceText,
                tone: maintenanceText === this.t("plugin.memory.diagnostics.maintenance.upToDate") ? undefined : "warning",
            },
        ];

        if (stats.lastVerifiedAt) {
            details.push({ label: this.t("plugin.memory.diagnostics.lastVerified"), value: stats.lastVerifiedAt });
        }

        if (stats.lastErrorCode) {
            details.push({ label: this.t("plugin.memory.diagnostics.lastError"), value: stats.lastErrorCode, tone: "danger" });
        }
        if (stats.lastErrorCode === "opfs-sahpool-locked" && stats.opfsDirectory) {
            details.push({ label: this.t("plugin.memory.diagnostics.opfsScope"), value: stats.opfsDirectory, tone: "warning" });
        }
        if (stats.lastErrorCode === "opfs-sahpool-locked" && stats.opfsVfsName) {
            details.push({ label: this.t("plugin.memory.diagnostics.opfsVfs"), value: stats.opfsVfsName, tone: "warning" });
        }

        const performanceText = this.getVssPerformanceNotice(stats.chunkCount).trim();

        return {
            title: this.t("plugin.memory.diagnostics.title"),
            summary: status.text,
            summaryTone: status.tone,
            details,
            notes: performanceText ? [performanceText] : [],
        };
    }

    private formatTechnicalMemoryStatus(stats: TechnicalMemoryStats): { text: string; tone?: TechnicalMemoryDetail["tone"] } {
        if (stats.status === "ready") {
            return { text: this.t("plugin.memory.diagnostics.status.ready") };
        }
        if (stats.status === "stale") {
            return { text: this.t("plugin.memory.diagnostics.status.stale"), tone: "warning" };
        }
        if (stats.status === "missing-local-index") {
            return { text: this.t("plugin.memory.diagnostics.status.missing"), tone: "warning" };
        }
        if (stats.status === "disabled" || stats.status === "error") {
            return { text: this.t("plugin.memory.diagnostics.status.unavailable"), tone: "danger" };
        }
        return { text: this.t("plugin.memory.diagnostics.status.notInitialized"), tone: "warning" };
    }

    private formatTechnicalMaintenanceState(maintenance: TechnicalMemoryMaintenance): string {
        if (maintenance.dirtyCount <= 0 && maintenance.verificationPending <= 0) {
            return this.t("plugin.memory.diagnostics.maintenance.upToDate");
        }

        const parts: string[] = [];
        if (maintenance.dirtyCount > 0) {
            parts.push(this.t("plugin.memory.diagnostics.maintenance.dirty", { count: maintenance.dirtyCount }));
        }
        if (maintenance.verificationPending > 0) {
            parts.push(this.t("plugin.memory.diagnostics.maintenance.verificationPending", { count: maintenance.verificationPending }));
        }
        return parts.join(", ");
    }

    private showTechnicalMemoryNotice(model: TechnicalMemoryNoticeModel, timeout: number): void {
        const fragment = getPlatformDocument().createDocumentFragment();
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
            name: this.t("plugin.command.updateMemoryNow"),
            checkCallback: (checking) => this.runAdvancedMemoryCommand(checking, async () => {
                const memoryManager = this.memoryManager;
                if (!memoryManager) return;
                await memoryManager.updateFromCommand();
                await this.updateMemoryStatusBar();
            }),
        })

        this.addCommand({
            id: "reset-vss-index",
            name: this.t("plugin.command.resetMemory"),
            checkCallback: (checking) => this.runAdvancedMemoryCommand(checking, async () => {
                const confirmed = await confirmUserAction(this.app, {
                    title: this.t("plugin.memory.confirm.reset.title"),
                    message: this.t("plugin.memory.confirm.reset.message"),
                    confirmText: this.t("plugin.memory.confirm.reset.confirm"),
                });
                if (!confirmed) return;
                const vss = this.vss;
                if (!vss) return;
                await vss.resetLocalIndex();
                await this.updateMemoryStatusBar();
            }),
        })

        this.addCommand({
            id: "clean-legacy-vss-json-cache",
            name: this.t("plugin.command.deleteOldMemoryCache"),
            checkCallback: (checking) => this.runAdvancedMemoryCommand(checking, async () => {
                const vss = this.vss;
                if (!vss) return;
                await vss.cleanLegacyJsonCache();
                await this.updateMemoryStatusBar();
            }),
        })

        this.addCommand({
            id: "show-vss-index-status",
            name: this.t("plugin.command.showTechnicalMemoryStatus"),
            checkCallback: (checking) => this.runAdvancedMemoryCommand(checking, async () => {
                await this.showTechnicalMemoryStatus();
            }),
        })

        this.addCommand({
            id: "show-ai-insights",
            name: this.t("plugin.command.showAiInsights"),
            checkCallback: (checking) => this.runMemoryExtractionCommand(checking, async () => {
                this.showAiInsights();
            }),
        })
    }

    canShowAiInsights(): boolean {
        return this.settings.memoryEnabled
            && this.settings.memoryExtractionEnabled
            && this.getAISetupIssue() === null;
    }

    showAiInsights(): void {
        const context = this.memoryExtractionScheduler?.getInsightsViewerContext() ?? {};
        this.openInsightsViewer(context);
    }

    private openInsightsViewer(context: { userProfile?: string; vaultInsights?: string }): void {
        const title = this.t("plugin.insightsViewer.title");
        const emptyText = this.t("plugin.insightsViewer.noInsights");
        const app = this.app;
        const modal = new class extends Modal {
            private renderHost = new Component();

            onOpen(): void {
                this.renderHost.load();
                this.contentEl.empty();
                this.contentEl.addClass("pa-insights-viewer");
                this.contentEl.createEl("h2", { text: title });

                if (!context.userProfile && !context.vaultInsights) {
                    this.contentEl.createEl("p", {
                        cls: "pa-insights-viewer__empty",
                        text: emptyText,
                    });
                    return;
                }

                if (context.userProfile) {
                    const section = this.contentEl.createDiv({ cls: "pa-insights-viewer__section" });
                    MarkdownRenderer.render(app, context.userProfile, section, "", this.renderHost);
                }
                if (context.vaultInsights) {
                    const section = this.contentEl.createDiv({ cls: "pa-insights-viewer__section" });
                    MarkdownRenderer.render(app, context.vaultInsights, section, "", this.renderHost);
                }
            }

            onClose(): void {
                this.renderHost.unload();
                this.contentEl.empty();
            }
        }(app);
        modal.open();
    }

    private runAdvancedMemoryCommand(checking: boolean, action: () => Promise<void>): boolean {
        if (!this.settings.memoryEnabled || !this.settings.showAdvancedMemoryControls) return false;
        return this.runMemoryCommand(checking, action);
    }

    private runMemoryExtractionCommand(checking: boolean, action: () => Promise<void>): boolean {
        if (!this.canShowAiInsights()) return false;
        if (!checking) {
            void action().catch((error) => {
                this.log("Memory extraction command failed", error);
                new Notice(this.t("plugin.notice.memoryActionFailed"), 5000);
            });
        }
        return true;
    }

    private runMemoryCommand(checking: boolean, action: () => Promise<void>): boolean {
        if (!this.settings.memoryEnabled) return false;
        if (!this.vss || !this.memoryManager) return false;
        if (this.getAISetupIssue() !== null) return false;
        if (!checking) {
            void action().catch((error) => {
                this.log("Memory command failed", error);
                new Notice(this.t("plugin.notice.memoryActionFailed"), 5000);
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
                    this.t("plugin.notice.qwenMemoryModelRecommended"),
                    10000,
                );
                this.settings.embeddingV4MigrationNoticeDismissed = true;
                changed = true;
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

    hasConfiguredAPIToken(): boolean {
        return hasSecretValue(this.app.secretStorage.getSecret(this.getAPITokenSecretId()));
    }

    getAISetupIssue(): string | null {
        if (!this.settings.aiProvider) {
            return this.t("plugin.aiSetup.chooseProvider");
        }
        if (!this.settings.baseURL || !this.settings.chatModelName) {
            return this.t("plugin.aiSetup.completeProvider");
        }
        if (!this.hasConfiguredAPIToken()) {
            return this.t("plugin.aiSetup.addToken");
        }
        return null;
    }

    async getAPIToken() {
        if (this.token !== "") {
            return this.token;
        }
        const token = this.app.secretStorage.getSecret(this.getAPITokenSecretId());
        if (!hasSecretValue(token)) {
            new Notice(this.t("plugin.notice.apiTokenNotConfigured"), 5000);
            return "";
        }
        this.token = token;
        return token;
    }

    clearTokenCache(): void {
        this.token = "";
    }
}

function coerceModelResultToString(result: unknown): string {
    if (typeof result === "string") return result;
    const content = (result as { content?: unknown })?.content;
    return content != null ? String(content) : String(result);
}

function setPluginTimeout(callback: () => void, ms: number): TimeoutHandle {
    return setPlatformTimeout(callback, ms);
}

function clearPluginTimeout(timeoutId: TimeoutHandle): void {
    clearPlatformTimeout(timeoutId);
}

function setPluginInterval(callback: () => void, ms: number): IntervalHandle {
    return setPlatformInterval(callback, ms);
}

function clearPluginInterval(intervalId: IntervalHandle): void {
    clearPlatformInterval(intervalId);
}

function createStatisticsVaultId(): string {
    const cryptoApi = getPlatformCrypto() as (Crypto & { randomUUID?: () => string }) | undefined;
    if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
        return cryptoApi.randomUUID();
    }
    return `statistics-vault-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
