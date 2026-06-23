/* Copyright 2023 edonyzpc */

import { App, Modal, Notice, PluginSettingTab, SecretComponent, Setting, debounce, setIcon } from "obsidian";

import type { PluginManager } from "./plugin"
import { BUNDLED_SKILL_CATALOG, BUNDLED_SKILL_IDS } from "./ai-services/bundled-skill-catalog";
import { getDashScopeImageSynthesisUrl, isDashScopeCompatibleBaseURL } from "./ai-services/ai-utils";
import { STAT_PREVIEW_TYPE } from './stats-view'
import { normalizeStatisticsView } from './stats/stats-store'
import { confirmUserAction } from "./confirm";
import { hasSecretValue } from "./utils";
import {
    PAGELET_DEFAULTS,
    mergePageletSettings,
    renderPageletSection,
    type PageletSettings,
    type PageletSettingFactory,
} from "./settings/pagelet";
import { getPageletUiLanguage } from "./locales/pagelet";
import { getPluginUiLanguage, pluginT, type PluginMessageKey } from "./locales/plugin";
import { OPERATIONS_AGENT_RUNTIME_ENABLED } from "./operations-agent-flags";
import { LEGACY_CONFIG_DIR } from "./obsidian-paths";
import { getPlatformDocument, setPlatformTimeout } from "./platform-dom";
import { MOCK_LICENSE_TIER, type AgentCapabilityTier } from "./ai-services/capability-types";

export interface ResizeStyle {
    width: number,
    height: number,
}

export interface PluginManagerSettings {
    debug: boolean;
    targetPath: string;
    fileFormat: string;
    previewLimits: number;
    previewTags: string[];
    localGraph: {
        notice: string,
        type: string,
        depth: number,
        showTags: boolean,
        showAttach: boolean,
        showNeighbor: boolean,
        collapse: boolean,
        autoColors: boolean,
        resizeStyle: ResizeStyle,
    };
    enableGraphColors: boolean;
    colorGroups: {
        query: string,
        color: {
            a: number,
            rgb: number,
        }
    }[];
    enableMetadataUpdating: boolean;
    metadatas: { key: string, value: any, t: string }[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    metadataExcludePath: string[];
    cachePluginRepo: { [key: string]: any; }; // eslint-disable-line @typescript-eslint/no-explicit-any
    cacheThemeRepo: { [key: string]: any; }; // eslint-disable-line @typescript-eslint/no-explicit-any
    statisticsType: string;
    statsPath: string;
    statisticsVaultId: string;
    statisticsSyncEnabled: boolean;
    displaySectionCounts: boolean;
    countComments: boolean;
    animation: boolean;
    // AI模型配置
    aiProvider: string; // 'qwen' | 'openai'
    aiProviderPreset?: string;
    baseURL: string;
    chatModelName: string;
    policyModelName: string;
    embeddingModelName: string;
    embeddingV4MigrationNoticeDismissed: boolean;
    memoryEnabled: boolean;
    memoryAutoCheckBeforeChat: boolean;
    memoryApprovalPolicy: "always" | "auto-refresh-after-prepare";
    showAdvancedMemoryControls: boolean;
    qwenThinkingEnabled: boolean;
    webSearchEnabled: boolean;
    licenseTier: AgentCapabilityTier;
    shareAnonymousCapabilityUsage: boolean;
    skillContextEnabled: boolean;
    enabledSkillIds: string[];
    featuredImagePath: string;
    numFeaturedImages: number;
    memoryExtractionEnabled: boolean;
    memoryExtractionNoticeDismissed: boolean;
    memoryExtractionIncludeVaultInsights: boolean;
    vssCacheExcludePath: string[];
    /** Operations Agent mode (Beta): enable AI to append content to the active note. */
    operationsAgentEnabled: boolean;
    /**
     * Pagelet (Review Assistant) namespace. Owned by `src/settings/pagelet/`;
     * merged + rendered through the helpers exported from that module so
     * future Pagelet fields stay localized to one file.
     */
    pagelet: PageletSettings;
}

export const DEFAULT_SETTINGS: PluginManagerSettings = {
    debug: false,
    targetPath: ".",
    fileFormat: "YYYY-MM-DD",
    previewLimits: 5,
    previewTags: [],
    localGraph: {
        notice: "Opened local graph for current note.",
        type: "popover",
        depth: 2,
        showTags: true,
        showAttach: true,
        showNeighbor: true,
        collapse: false,
        autoColors: false,
        resizeStyle: {
            width: 550,
            height: 500,
        }
    },
    enableGraphColors: false,
    colorGroups: [
        {
            query: "path:/",
            color: {
                a: 1,
                rgb: 6617700,
            }
        }
    ],
    enableMetadataUpdating: false,
    metadatas: [
        { key: "modify", value: "YYYY-MM-DD HH:mm:ss", t: "moment" },
    ],
    metadataExcludePath: [],
    cachePluginRepo: {
        "personal-assistant": "edonyzpc/personal-assistant",
    },
    cacheThemeRepo: {
        "Minimal": "kepano/obsidian-minimal",
    },
    statisticsType: "overview",
    statsPath: "",
    statisticsVaultId: "",
    statisticsSyncEnabled: false,
    displaySectionCounts: false,
    countComments: false,
    animation: false,
    // AI模型配置
    aiProvider: "qwen",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    chatModelName: "qwen3.6-plus",
    policyModelName: "",
    embeddingModelName: "text-embedding-v4",
    embeddingV4MigrationNoticeDismissed: false,
    memoryEnabled: true,
    memoryAutoCheckBeforeChat: true,
    memoryApprovalPolicy: "always",
    showAdvancedMemoryControls: false,
    qwenThinkingEnabled: false,
    webSearchEnabled: false,
    licenseTier: MOCK_LICENSE_TIER,
    shareAnonymousCapabilityUsage: false,
    skillContextEnabled: true,
    enabledSkillIds: [...BUNDLED_SKILL_IDS],
    featuredImagePath: "",
    numFeaturedImages: 2,
    memoryExtractionEnabled: true,
    memoryExtractionNoticeDismissed: false,
    memoryExtractionIncludeVaultInsights: true,
    // Generic default — the prior list ("8.template", "9.src", "a.subjects",
    // "b.notion") was the original developer's vault layout and made no sense
    // as a fresh-install default. mergeLoadedSettings preserves any persisted
    // value, so existing users keep their configured exclusions.
    vssCacheExcludePath: [LEGACY_CONFIG_DIR],
    operationsAgentEnabled: false,
    // Pagelet defaults live next to the Pagelet settings module so adding a
    // field there does not require a parallel edit here.
    pagelet: { ...PAGELET_DEFAULTS },
}

interface GraphColor {
    query: string;
    color: {
        a: number,
        rgb: number,
    }
}

const DEFAULT_GRAPH_COLOR: GraphColor = {
    query: "path:/",
    color: {
        a: 1,
        rgb: 6617700,
    }
}

const QWEN_RESPONSE_OPTIONS_DASHSCOPE_DESC =
    "Qwen thinking and builtin WebSearch require Alibaba Cloud DashScope. They do not change Memory from your notes.";
const QWEN_RESPONSE_OPTIONS_NON_DASHSCOPE_DESC =
    "Qwen thinking and builtin WebSearch are available only with the DashScope OpenAI-compatible base URL.";
export const STATISTICS_SYNC_SETTING_DESC =
    "Creates Statistics history files inside this plugin's vault folder so writing history can sync across devices. Leave off to avoid ongoing Git changes from synced history.";
const PREVIEW_LIMITS_MAX = 100;
const LOCAL_GRAPH_DEPTH_MAX = 6;
const LOCAL_GRAPH_DIMENSION_MAX = 2000;
const FEATURED_IMAGE_COUNT_MAX = 4;
const PA_LEGAL_REPO_URL = "https://github.com/edonyzpc/personal-assistant";

export function buildPaLegalLinks(releaseTag: string) {
    const tag = releaseTag.trim() || "master";
    return Object.freeze({
        source: `${PA_LEGAL_REPO_URL}/tree/${tag}`,
        sourceArchive: `${PA_LEGAL_REPO_URL}/archive/refs/tags/${tag}.zip`,
        license: `${PA_LEGAL_REPO_URL}/blob/${tag}/LICENSE`,
        notice: `${PA_LEGAL_REPO_URL}/blob/${tag}/NOTICE`,
        thirdPartyNotices: `${PA_LEGAL_REPO_URL}/blob/${tag}/THIRD_PARTY_NOTICES.md`,
        networkPrivacyEn: `${PA_LEGAL_REPO_URL}/blob/${tag}/README.md#network-and-privacy-note`,
        networkPrivacyZh: `${PA_LEGAL_REPO_URL}/blob/${tag}/README-CN.md#网络与隐私说明`,
    });
}

function formatGraphColorHex(rgb: number): string {
    const normalized = Number.isFinite(rgb) ? rgb : DEFAULT_GRAPH_COLOR.color.rgb;
    return `#${(normalized & 0xffffff).toString(16).padStart(6, "0")}`;
}

function normalizeGraphColorInput(value: string): string | null {
    const match = value.trim().match(/^#?([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/);
    return match?.[1]?.toLowerCase() ?? null;
}

/**
 * Parse an integer from user input, falling back to a known-valid value when
 * the input is empty, non-numeric, or below `min`. Prevents NaN / 0 / negative
 * values from being persisted to data.json, which downstream consumers (Local
 * Graph dimensions, preview limits, featured image counts) cannot tolerate.
 */
export function safeParseInt(value: string, fallback: number, min = 0, max?: number): number {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < min) return fallback;
    return typeof max === "number" ? Math.min(parsed, max) : parsed;
}

/**
 * Merge data.json contents with DEFAULT_SETTINGS, preserving default values
 * for nested object fields whose siblings the user never customized.
 *
 * Object.assign is shallow, so `localGraph: { depth: 3 }` in data.json would
 * otherwise replace the entire DEFAULT_SETTINGS.localGraph object and lose
 * defaults for showTags / showAttach / autoColors / resizeStyle. Arrays are
 * shallow-normalized so malformed data.json values cannot crash settings render.
 */
export function mergeLoadedSettings(loaded: unknown): PluginManagerSettings {
    const loadedObject = isRecord(loaded) ? loaded : {};
    const merged = Object.assign({}, DEFAULT_SETTINGS, loadedObject) as PluginManagerSettings;
    const loadedLocalGraph = isRecord(loadedObject.localGraph)
        ? loadedObject.localGraph as Partial<typeof DEFAULT_SETTINGS.localGraph>
        : undefined;
    const loadedResizeStyle = isRecord(loadedLocalGraph?.resizeStyle)
        ? loadedLocalGraph.resizeStyle as Partial<typeof DEFAULT_SETTINGS.localGraph.resizeStyle>
        : undefined;
    merged.localGraph = {
        ...DEFAULT_SETTINGS.localGraph,
        ...(loadedLocalGraph ?? {}),
        resizeStyle: {
            ...DEFAULT_SETTINGS.localGraph.resizeStyle,
            ...(loadedResizeStyle ?? {}),
        },
    };
    merged.previewTags = normalizeStringArray(loadedObject.previewTags, DEFAULT_SETTINGS.previewTags);
    merged.metadataExcludePath = normalizeStringArray(loadedObject.metadataExcludePath, DEFAULT_SETTINGS.metadataExcludePath);
    merged.vssCacheExcludePath = normalizeStringArray(loadedObject.vssCacheExcludePath, DEFAULT_SETTINGS.vssCacheExcludePath);
    merged.colorGroups = normalizeGraphColorArray(loadedObject.colorGroups, DEFAULT_SETTINGS.colorGroups);
    merged.metadatas = normalizeMetadataArray(loadedObject.metadatas, DEFAULT_SETTINGS.metadatas);
    merged.enabledSkillIds = normalizeEnabledSkillIds(loadedObject.enabledSkillIds);
    // Current builds use a mock paid entitlement so all paid-capability
    // architecture stays enabled until a real authorization source is wired in.
    // Do not trust persisted data.json for this field.
    merged.licenseTier = MOCK_LICENSE_TIER;
    merged.operationsAgentEnabled = OPERATIONS_AGENT_RUNTIME_ENABLED;
    // Pagelet has its own per-field normalizer (8 fields, mixed types).
    // Delegating keeps the legacy merge focused on settings that predate
    // Pagelet and avoids polluting this file with Pagelet-specific bounds.
    merged.pagelet = mergePageletSettings(loadedObject.pagelet);
    return merged;
}

export interface ProviderPreset {
    label: string;
    baseURL: string;
    chatModelName: string;
    embeddingModelName: string;
    description: string;
    runtimeProvider: "qwen" | "openai";
}

/**
 * Catalog of supported AI providers shown in the Provider dropdown. The
 * dropdown key is a *display* preset (qwen / qwen-intl / openai / custom);
 * the persisted `aiProvider` field stays one of "qwen" / "openai" via
 * `runtimeProvider`. Two qwen variants share a runtime provider but render
 * as separate options because users on the international DashScope endpoint
 * cannot reach the China-region URL and vice versa.
 */
export const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
    qwen: {
        label: "Qwen (Alibaba Cloud DashScope)",
        baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        chatModelName: "qwen3.6-plus",
        embeddingModelName: "text-embedding-v4",
        description: "Qwen models via Alibaba Cloud. Also hosts DeepSeek, Kimi, GLM, and other models.",
        runtimeProvider: "qwen",
    },
    "qwen-intl": {
        label: "Qwen (DashScope International)",
        baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        chatModelName: "qwen3.6-plus",
        embeddingModelName: "text-embedding-v4",
        description: "Qwen models via the DashScope International endpoint.",
        runtimeProvider: "qwen",
    },
    openai: {
        label: "OpenAI",
        baseURL: "https://api.openai.com/v1",
        chatModelName: "gpt-4o-mini",
        embeddingModelName: "text-embedding-3-small",
        description: "OpenAI models via the official API.",
        runtimeProvider: "openai",
    },
    custom: {
        label: "Custom (OpenAI-compatible)",
        baseURL: "",
        chatModelName: "",
        embeddingModelName: "",
        description: "Any OpenAI-compatible API endpoint.",
        runtimeProvider: "qwen",
    },
};

/**
 * Map persisted (aiProvider, baseURL) back to the preset key used by the
 * dropdown. Used to (a) initialize the dropdown on render and (b) revert
 * the selection when the user cancels a switch confirmation.
 */
export function deriveDisplayPreset(
    settings: Pick<PluginManagerSettings, "aiProvider" | "baseURL" | "aiProviderPreset">,
): string {
    if (settings.aiProviderPreset === "custom") return "custom";
    if (settings.aiProvider === "openai" && settings.baseURL === PROVIDER_PRESETS.openai.baseURL) {
        return "openai";
    }
    if (settings.aiProvider === "qwen") {
        if (settings.baseURL === PROVIDER_PRESETS.qwen.baseURL) return "qwen";
        if (settings.baseURL === PROVIDER_PRESETS["qwen-intl"].baseURL) return "qwen-intl";
    }
    return "custom";
}

/**
 * True when the persisted data blob is missing or empty — the user has
 * never opened settings in this vault. Used to force an explicit provider
 * choice instead of silently defaulting to qwen on fresh installs.
 *
 * Arrays are not considered fresh installs even when empty: a persisted `[]`
 * would be a malformed blob, not an absence of data, and treating it as
 * fresh would silently wipe whatever migration logic the loader runs.
 */
export function isFreshInstall(loaded: unknown): boolean {
    if (loaded == null) return true;
    if (typeof loaded !== "object") return false;
    if (Array.isArray(loaded)) return false;
    return Object.keys(loaded).length === 0;
}

/**
 * True when the persisted data blob is from a legacy v1.x install — it has
 * data but is missing the `aiProvider` field that Provider-aware versions
 * always write. Used by migrateSettings to apply the qwen default exactly
 * once on the first launch after upgrade, instead of every time aiProvider
 * happens to be empty (which is also a valid Phase 3 state on fresh installs).
 */
export function isLegacyV1Install(loaded: unknown): boolean {
    if (loaded == null) return false;
    if (typeof loaded !== "object") return false;
    if (Array.isArray(loaded)) return false;
    const obj = loaded as Record<string, unknown>;
    if (Object.keys(obj).length === 0) return false;
    return obj.aiProvider === undefined;
}

export function normalizeEnabledSkillIds(value: unknown): string[] {
    const knownSkillIds = new Set(BUNDLED_SKILL_IDS);
    if (!Array.isArray(value)) return [...BUNDLED_SKILL_IDS];
    const normalized = value
        .filter((entry): entry is string => typeof entry === "string")
        .filter((entry) => knownSkillIds.has(entry));
    return [...new Set(normalized)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
    if (!Array.isArray(value)) return [...fallback];
    return value.filter((entry): entry is string => typeof entry === "string");
}

function normalizeGraphColorArray(value: unknown, fallback: PluginManagerSettings["colorGroups"]): PluginManagerSettings["colorGroups"] {
    if (!Array.isArray(value)) return JSON.parse(JSON.stringify(fallback));
    return value
        .filter((entry): entry is GraphColor => {
            if (!isRecord(entry) || typeof entry.query !== "string" || !isRecord(entry.color)) return false;
            return typeof entry.color.a === "number" && typeof entry.color.rgb === "number";
        })
        .map((entry) => ({
            query: entry.query,
            color: {
                a: entry.color.a,
                rgb: entry.color.rgb,
            },
        }));
}

function normalizeMetadataArray(value: unknown, fallback: PluginManagerSettings["metadatas"]): PluginManagerSettings["metadatas"] {
    if (!Array.isArray(value)) return JSON.parse(JSON.stringify(fallback));
    return value
        .filter((entry): entry is { key: string; value: unknown; t: string } =>
            isRecord(entry) && typeof entry.key === "string" && typeof entry.t === "string")
        .map((entry) => ({
            key: entry.key,
            value: entry.value,
            t: entry.t,
        }));
}

interface QwenResponseOptionToggle {
    setDisabled(disabled: boolean): unknown;
}

interface QwenResponseOptionsDescription {
    setText(text: string): unknown;
}

interface QwenResponseOptionsCopy {
    dashScopeDescription: string;
    nonDashScopeDescription: string;
}

export function updateQwenResponseOptionAvailability(
    baseURL: unknown,
    descriptionEl: QwenResponseOptionsDescription,
    toggles: QwenResponseOptionToggle[],
    copy: QwenResponseOptionsCopy = {
        dashScopeDescription: QWEN_RESPONSE_OPTIONS_DASHSCOPE_DESC,
        nonDashScopeDescription: QWEN_RESPONSE_OPTIONS_NON_DASHSCOPE_DESC,
    },
): boolean {
    const isDashScopeCompatible = isDashScopeCompatibleBaseURL(baseURL);
    descriptionEl.setText(
        isDashScopeCompatible
            ? copy.dashScopeDescription
            : copy.nonDashScopeDescription
    );
    toggles.forEach((toggle) => toggle.setDisabled(!isDashScopeCompatible));
    return isDashScopeCompatible;
}


export class SettingTab extends PluginSettingTab {
    plugin: PluginManager;
    private log;

    // Sub-containers for incremental rebuilds (avoids full display() re-render).
    private providerConfigContainer: HTMLDivElement | null = null;
    private qwenOptionsContainer: HTMLDivElement | null = null;
    private skillTogglesContainer: HTMLDivElement | null = null;
    private memorySubContainer: HTMLDivElement | null = null;
    private memoryAdvancedContainer: HTMLDivElement | null = null;
    private graphColorsContainer: HTMLDivElement | null = null;
    private metadataContainer: HTMLDivElement | null = null;
    private featuredImageContainer: HTMLDivElement | null = null;
    private secretPickerObserver: MutationObserver | null = null;
    private patchedSecretPickerEditButtons = new WeakSet<HTMLElement>();
    private secretPickerEditClickHandler: ((event: MouseEvent) => void) | null = null;
    private secretPickerDocument: Document | null = null;

    // Set by rebuildQwenOptions(); invoked by Base URL onChange.
    private refreshQwenResponseOptionAvailability: (() => void) | null = null;

    // Coalesces saveSettings() across keystrokes in text inputs. Each addText
    // onChange mutates plugin.settings.* synchronously, then calls
    // debouncedSave(); the actual disk write is deferred 400ms past the last
    // keystroke. hide() cancels the timer and forces one final save so a user
    // who closes the tab mid-edit doesn't lose their input.
    //
    // Toggle / Dropdown / Button onChange handlers still save immediately —
    // those are discrete user actions where each value flip is meaningful and
    // some of them rebuild dependent UI (e.g. enableGraphColors,
    // enableMetadataUpdating, aiProvider).
    private debouncedSave = debounce(() => { void this.plugin.saveSettings(); }, 400, true);

    constructor(app: App, plugin: PluginManager) {
        super(app, plugin);
        this.plugin = plugin;
        this.log = (...msg: any) => plugin.log(...msg); // eslint-disable-line @typescript-eslint/no-explicit-any
    }

    private t(key: PluginMessageKey, params?: Readonly<Record<string, string | number>>, fallback?: string): string {
        return pluginT(key, getPluginUiLanguage(), params, fallback);
    }

    display(): void {
        const { containerEl } = this;
        const doc = getPlatformDocument();

        containerEl.empty();
        (containerEl as HTMLElement & { addClass?: (cls: string) => void }).addClass?.("pa-settings-tab");
        (containerEl as HTMLElement & { classList?: DOMTokenList }).classList?.add("pa-settings-tab");
        doc.body?.classList.add("pa-settings-tab-open");

        // Sub-container refs were children of containerEl; empty() detached them.
        this.providerConfigContainer = null;
        this.qwenOptionsContainer = null;
        this.skillTogglesContainer = null;
        this.memorySubContainer = null;
        this.memoryAdvancedContainer = null;
        this.graphColorsContainer = null;
        this.metadataContainer = null;
        this.featuredImageContainer = null;
        this.refreshQwenResponseOptionAvailability = null;

        // Section order matches the user's typical configuration flow:
        // pick a provider first (AI Assistant), then layer Memory + Skills,
        // then per-feature settings, with diagnostics at the bottom.
        this.renderHeader(containerEl);
        this.renderAISection(containerEl);
        this.renderSkillsSection(containerEl);
        this.renderMemorySection(containerEl);
        this.renderOperationsAgentSection(containerEl);
        this.renderPageletSection(containerEl);
        this.renderStatisticsSection(containerEl);
        this.renderRecordSection(containerEl);
        this.renderGraphSection(containerEl);
        this.renderGraphColorsSection(containerEl);
        this.renderMetadataSection(containerEl);
        this.renderFeaturedImageSection(containerEl);
        this.renderAdvancedSection(containerEl);
        this.renderLegalSection(containerEl);
        this.markFormControlSettings(containerEl);
        this.startSecretPickerObserver();
    }

    hide(): void {
        // Obsidian invokes hide() when the user closes the settings tab.
        this.stopSecretPickerObserver();
        getPlatformDocument().body?.classList.remove("pa-settings-tab-open");
        // Flush any pending text-input save: the onChange handlers have
        // already mutated plugin.settings.* synchronously, so persisting
        // the current settings object captures the user's latest input.
        this.debouncedSave.cancel();
        void this.plugin.saveSettings();
    }

    private startSecretPickerObserver(): void {
        this.stopSecretPickerObserver();
        const doc = getPlatformDocument();
        this.secretPickerEditClickHandler = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null;
            const action = target?.closest<HTMLElement>(".modal .suggestion-item .clickable-icon");
            const row = action?.closest<HTMLElement>(".suggestion-item");
            if (!action || !row || !this.isSecretPickerRow(row)) {
                return;
            }

            const actions = row.findAll(".clickable-icon");
            if (actions.length < 2 || action !== actions[actions.length - 1]) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            const secretId = this.getSecretIdFromPickerRow(row);
            if (!secretId) {
                new Notice(this.t("plugin.settings.secret.cannotDetermine"), 4000);
                return;
            }
            this.openSecretEditorViaAddSecret(secretId, row.closest<HTMLElement>(".modal"));
        };
        if (typeof doc.addEventListener === "function") {
            this.secretPickerDocument = doc;
            doc.addEventListener("click", this.secretPickerEditClickHandler, true);
        }
        if (!doc.body || typeof MutationObserver === "undefined") {
            return;
        }
        this.secretPickerObserver = new MutationObserver(() => {
            this.patchSecretPickerActions();
        });
        this.secretPickerObserver.observe(doc.body, {
            childList: true,
            subtree: true,
        });
        this.scheduleSecretPickerPatch();
    }

    private stopSecretPickerObserver(): void {
        this.secretPickerObserver?.disconnect();
        this.secretPickerObserver = null;
        if (this.secretPickerEditClickHandler) {
            if (typeof this.secretPickerDocument?.removeEventListener === "function") {
                this.secretPickerDocument.removeEventListener("click", this.secretPickerEditClickHandler, true);
            }
            this.secretPickerEditClickHandler = null;
        }
        this.secretPickerDocument = null;
        this.patchedSecretPickerEditButtons = new WeakSet<HTMLElement>();
    }

    private patchSecretPickerActions(): void {
        const rows = getPlatformDocument().body?.findAll(".modal .suggestion-item") ?? [];
        rows.forEach((row) => {
            if (!this.isSecretPickerRow(row)) {
                return;
            }
            this.markSecretPickerRow(row);
            const actions = row.findAll(".clickable-icon");
            if (actions.length < 2) {
                return;
            }
            const editAction = actions[actions.length - 1];
            if (!editAction) {
                return;
            }

            editAction.classList.add("pa-secret-edit-action");
            editAction.setAttribute("aria-label", this.t("plugin.settings.secret.edit"));
            editAction.setAttribute("title", this.t("plugin.settings.secret.edit"));
            if (!editAction.querySelector(".lucide-pencil, [data-icon='pencil']")) {
                editAction.replaceChildren();
                setIcon(editAction, "pencil");
            }
            if (this.patchedSecretPickerEditButtons.has(editAction)) {
                return;
            }

            this.patchedSecretPickerEditButtons.add(editAction);
            editAction.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                const secretId = this.getSecretIdFromPickerRow(row);
                if (!secretId) {
                    new Notice(this.t("plugin.settings.secret.cannotDetermine"), 4000);
                    return;
                }
                this.openSecretEditorViaAddSecret(secretId, row.closest<HTMLElement>(".modal"));
            }, true);
        });
    }

    private markFormControlSettings(containerEl: HTMLElement): void {
        const settings = containerEl.findAll(".setting-item");
        settings.forEach((settingEl) => {
            const controlEl = settingEl.querySelector<HTMLElement>(".setting-item-control");
            if (!controlEl) {
                return;
            }
            const controls = controlEl.findAll(
                "input[type='text'], input[type='number'], input:not([type]), select",
            );
            if (!controls.length) {
                return;
            }
            settingEl.classList.add("pa-setting-has-form-control");
            settingEl.querySelector<HTMLElement>(".setting-item-info")?.classList.add("pa-setting-form-info");
            controlEl.classList.add("pa-setting-form-control");
            controls.forEach((control) => control.classList.add("pa-setting-form-input"));
        });
    }

    private markSecretPickerRow(row: HTMLElement): void {
        row.classList.add("pa-secret-picker-row");
        row.closest<HTMLElement>(".modal")?.classList.add("pa-secret-picker-modal");
        if (row.querySelector(".lucide-eye, [data-icon='eye']")) {
            row.classList.add("pa-secret-row-has-eye");
        } else {
            row.classList.remove("pa-secret-row-has-eye");
        }
    }

    private scheduleSecretPickerPatch(): void {
        [0, 25, 75, 150, 300, 600, 1000].forEach((delay) => {
            setPlatformTimeout(() => this.patchSecretPickerActions(), delay);
        });
    }

    private isSecretPickerRow(row: HTMLElement): boolean {
        return row.classList.contains("suggestion-secret-key")
            || !!row.querySelector(".suggestion-secret-text")
            || /\bpa-api-token(?:-[a-z0-9-]+)?\b/.test(row.textContent ?? "");
    }

    private getSecretIdFromPickerRow(row: HTMLElement): string | null {
        const title = row.querySelector<HTMLElement>(".suggestion-title")?.textContent?.trim();
        if (title && /^[a-z0-9-]+$/.test(title)) {
            return title;
        }
        return row.textContent?.match(/\b[a-z0-9]+(?:-[a-z0-9]+)*\b/)?.[0] ?? null;
    }

    private openSecretEditorViaAddSecret(secretId: string, pickerModal?: HTMLElement | null): void {
        const secretValue = this.app.secretStorage.getSecret(secretId) ?? "";
        const modal = pickerModal ?? this.findSecretPickerModal();
        const addSecretButton = modal ? this.findAddSecretButton(modal) : null;
        if (!addSecretButton) {
            new Notice(this.t("plugin.settings.secret.openFailed", { secretId }), 4000);
            return;
        }

        addSecretButton.click();
        this.prefillAddSecretModal(secretId, secretValue, 0);
    }

    private findAddSecretButton(modal: HTMLElement): HTMLElement | null {
        return modal.findAll("button, .clickable-icon")
            .find((element) => {
                const text = element.textContent?.trim();
                return text === "Add secret..." || text === "Add secret…";
            }) ?? null;
    }

    private findSecretPickerModal(): HTMLElement | null {
        const body = getPlatformDocument().body;
        if (!body?.classList.contains("pa-settings-tab-open")) return null;
        const modal = body.findAll(".modal")
            .reverse()
            .find((modal) => modal.findAll(".suggestion-item").some((row) => this.isSecretPickerRow(row))) ?? null;
        modal?.classList.add("pa-secret-picker-modal");
        return modal;
    }

    private prefillAddSecretModal(secretId: string, secretValue: string, attempt: number): void {
        const maxAttempts = 12;
        const modal = this.findAddSecretModal();
        if (modal) {
            const inputs = this.findInputElements(modal);
            const idInput = this.findSecretIdInput(inputs);
            const secretInput = this.findSecretValueInput(inputs, idInput);
            if (idInput && secretInput) {
                this.setNativeInputValue(idInput, secretId);
                this.setNativeInputValue(secretInput, secretValue);
                idInput.readOnly = true;
                idInput.addClass("pa-secret-edit-id-input");
                secretInput.focus();
                secretInput.select();
                return;
            }
        }

        if (attempt >= maxAttempts) {
            new Notice(this.t("plugin.settings.secret.addOpened", { secretId }), 5000);
            return;
        }
        setPlatformTimeout(() => this.prefillAddSecretModal(secretId, secretValue, attempt + 1), 100);
    }

    private findAddSecretModal(): HTMLElement | null {
        return (getPlatformDocument().body?.findAll(".modal") ?? [])
            .reverse()
            .find((modal) => {
                const title = modal.querySelector("h1, h2, h3, .modal-title")?.textContent?.trim();
                const inputs = this.findInputElements(modal);
                const hasSecretIdInput = inputs.some((input) => input.placeholder === "secret-name");
                return inputs.length >= 2 && (hasSecretIdInput || title === "Add secret" || title === "Edit secret");
            }) ?? null;
    }

    private findInputElements(root: HTMLElement): HTMLInputElement[] {
        return root.findAll("input").filter((element): element is HTMLInputElement =>
            element.tagName.toLowerCase() === "input",
        );
    }

    private findSecretIdInput(inputs: HTMLInputElement[]): HTMLInputElement | null {
        return inputs.find((input) =>
            input.placeholder === "secret-name"
            || input.getAttr("aria-label")?.toLowerCase().includes("id")
        ) ?? inputs[0] ?? null;
    }

    private findSecretValueInput(
        inputs: HTMLInputElement[],
        idInput: HTMLInputElement | null,
    ): HTMLInputElement | null {
        return inputs.find((input) =>
            input !== idInput
            && (
                input.placeholder.startsWith("sk-")
                || input.type === "password"
                || input.getAttr("aria-label")?.toLowerCase().includes("secret")
            )
        ) ?? inputs.find((input) => input !== idInput) ?? null;
    }

    private setNativeInputValue(input: HTMLInputElement, value: string): void {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    private openApiTokenSecretEditor(): void {
        const plugin = this.plugin;
        const app = this.app;
        const secretId = plugin.getAPITokenSecretId();
        const existing = plugin.getConfiguredAPITokenSecret() ?? "";
        const translate = this.t.bind(this);
        const rebuildProviderConfig = () => this.rebuildProviderConfig();

        class ApiTokenSecretModal extends Modal {
            onOpen(): void {
                const { contentEl } = this;
                contentEl.empty();
                contentEl.addClass("pa-api-token-secret-modal");
                new Setting(contentEl)
                    .setName(existing
                        ? translate("plugin.settings.apiToken.modal.editTitle")
                        : translate("plugin.settings.apiToken.modal.addTitle"))
                    .setHeading();

                new Setting(contentEl)
                    .setName(translate("plugin.settings.apiToken.modal.id.name"))
                    .setDesc(translate("plugin.settings.apiToken.modal.id.desc"))
                    .addText((text) => {
                        text.setValue(secretId);
                        text.inputEl.readOnly = true;
                        text.inputEl.addClass("pa-secret-edit-id-input");
                    });

                let secretValue = existing;
                let secretInput: HTMLInputElement | null = null;
                let revealed = false;
                const secretSetting = new Setting(contentEl)
                    .setName(translate("plugin.settings.apiToken.modal.secret.name"))
                    .setDesc(translate("plugin.settings.apiToken.modal.secret.desc"))
                    .addText((text) => {
                        secretInput = text.inputEl;
                        text.inputEl.type = "password";
                        text.setPlaceholder("sk-...");
                        text.setValue(existing);
                        text.onChange((value) => {
                            secretValue = value;
                        });
                    });
                secretSetting.addExtraButton((button) => {
                    button
                        .setIcon("eye-off")
                        .setTooltip(translate("plugin.settings.apiToken.modal.showSecret"))
                        .onClick(() => {
                            if (!secretInput) {
                                return;
                            }
                            revealed = !revealed;
                            secretInput.type = revealed ? "text" : "password";
                            button.setIcon(revealed ? "eye" : "eye-off");
                            button.setTooltip(
                                revealed
                                    ? translate("plugin.settings.apiToken.modal.hideSecret")
                                    : translate("plugin.settings.apiToken.modal.showSecret")
                            );
                        });
                });

                new Setting(contentEl)
                    .addButton((button) => {
                        button
                            .setButtonText(translate("plugin.settings.apiToken.modal.save"))
                            .setCta()
                            .onClick(async () => {
                                const value = secretValue.trim();
                                if (value === "") {
                                    if (!existing) {
                                        this.close();
                                        return;
                                    }
                                    const confirmed = await confirmUserAction(app, {
                                        title: translate("plugin.settings.ai.apiToken.remove.title"),
                                        message: translate("plugin.settings.ai.apiToken.remove.message"),
                                        confirmText: translate("plugin.settings.ai.apiToken.remove.confirm"),
                                        cancelText: translate("plugin.settings.ai.apiToken.remove.cancel"),
                                    });
                                    if (!confirmed) {
                                        return;
                                    }
                                    plugin.setAPITokenSecret("");
                                    rebuildProviderConfig();
                                    this.close();
                                    return;
                                }
                                plugin.setAPITokenSecret(value);
                                rebuildProviderConfig();
                                this.close();
                                new Notice(translate("plugin.settings.apiToken.modal.saved"), 3000);
                            });
                    })
                    .addButton((button) => {
                        button
                            .setButtonText(translate("plugin.settings.apiToken.modal.cancel"))
                            .onClick(() => this.close());
                    });

                setPlatformTimeout(() => {
                    secretInput?.focus();
                    secretInput?.select();
                }, 0);
            }
        }

        new ApiTokenSecretModal(this.app).open();
    }

    private renameSecretComponentLinkButton(container: HTMLElement): void {
        const maybeContainer = container as HTMLElement & {
            addClass?: (cls: string) => void;
            closest?: (selector: string) => Element | null;
        };
        maybeContainer.addClass?.("pa-api-token-secret-component");

        const root = maybeContainer.closest?.(".setting-item") ?? container;

        const bindKeychainButton = (button: HTMLElement) => {
            if (button.dataset.paApiTokenKeychainPatched === "true") {
                return;
            }
            button.dataset.paApiTokenKeychainPatched = "true";
            button.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                this.openApiTokenSecretEditor();
            }, true);
        };

        const rename = () => {
            const keychainLabel = this.t("plugin.settings.apiToken.openKeychain");
            const candidates = root.findAll(
                "button, .clickable-icon, .setting-item-control *",
            );
            let renamed = false;
            candidates.forEach((element) => {
                const text = element.textContent?.trim();
                if (text !== "Link..." && text !== "Link…") {
                    return;
                }
                const button = element.closest("button") as HTMLElement | null ?? element;
                const setText = (button as HTMLElement & { setText?: (value: string) => void }).setText;
                if (setText) {
                    setText.call(button, keychainLabel);
                } else {
                    button.textContent = keychainLabel;
                }
                (button as HTMLElement & { addClass?: (cls: string) => void }).addClass?.("pa-api-token-keychain-button");
                (button as HTMLElement & { setAttr?: (name: string, value: string) => void }).setAttr?.("aria-label", keychainLabel);
                (button as HTMLElement & { setAttr?: (name: string, value: string) => void }).setAttr?.("title", keychainLabel);
                button.classList.add("pa-api-token-keychain-button");
                button.setAttribute("aria-label", keychainLabel);
                button.setAttribute("title", keychainLabel);
                bindKeychainButton(button);
                renamed = true;
            });
            const keychainButtons = candidates.filter((element) => element.textContent?.trim() === keychainLabel);
            keychainButtons.forEach((element) => bindKeychainButton(element.closest("button") as HTMLElement | null ?? element));
            return renamed || keychainButtons.length > 0;
        };

        rename();
        [0, 50, 150, 300, 600].forEach((delay) => {
            setPlatformTimeout(rename, delay);
        });

        if (typeof MutationObserver === "undefined") {
            return;
        }
        const observer = new MutationObserver(() => {
            if (rename()) {
                observer.disconnect();
            }
        });
        observer.observe(root, {
            childList: true,
            subtree: true,
            characterData: true,
        });
        setPlatformTimeout(() => observer.disconnect(), 1500);
    }

    private renderHeader(parentEl: HTMLElement): void {
        parentEl.createEl('h1', { text: this.t("plugin.settings.header.title") });
        const link = getPlatformDocument().createElement("a");
        link.setText(this.t("plugin.settings.header.repo"));
        link.href = "https://github.com/edonyzpc/personal-assistant";
        link.setAttr("class", "pa-settings-header-link");
        parentEl.createEl("p", { text: this.t("plugin.settings.header.byline") }).appendChild(link);
    }

    private renderRecordSection(parentEl: HTMLElement): void {
        const plugin = this.plugin;
        // settiong options for recording
        parentEl.createEl('h2', { text: this.t("plugin.settings.record.title") });
        parentEl.createEl("p", { text: this.t("plugin.settings.record.desc"), cls: "pa-settings-section-desc-sm" });
        new Setting(parentEl).setName(this.t("plugin.settings.record.targetPath.name"))
            .setDesc(this.t("plugin.settings.record.targetPath.desc"))
            .addText(text => text
                .setPlaceholder('.')
                .setValue(plugin.settings.targetPath)
                .onChange((value) => {
                    this.log('target path: ' + value);
                    plugin.settings.targetPath = value;
                    this.debouncedSave();
                }));
        const desc_format = getPlatformDocument().createDocumentFragment();
        desc_format.createEl('p', undefined, (p) => {
            p.innerText = this.t("plugin.settings.record.fileFormat.descPrefix");
            p.createEl('a', undefined, (link) => {
                link.innerText = this.t("plugin.settings.record.fileFormat.link");
                link.href = 'https://momentjs.com/docs/#/displaying/format/';
            });
        });
        new Setting(parentEl).setName(this.t("plugin.settings.record.fileFormat.name"))
            .setDesc(desc_format)
            .addText(text => text.setPlaceholder('YYYY-MM-DD')
                .setValue(plugin.settings.fileFormat)
                .onChange((value) => {
                    this.log('format setting: ' + value);
                    plugin.settings.fileFormat = value;
                    this.debouncedSave();
                }));
        new Setting(parentEl).setName(this.t("plugin.settings.record.previewNumber.name"))
            .setDesc(this.t("plugin.settings.record.previewNumber.desc"))
            .addText(text => {
                text.setPlaceholder('5')
                    .setValue(plugin.settings.previewLimits.toString())
                    .onChange((value) => {
                        plugin.settings.previewLimits = safeParseInt(value, plugin.settings.previewLimits, 1, PREVIEW_LIMITS_MAX);
                        this.debouncedSave();
                    })
            });
    }

    private renderGraphSection(parentEl: HTMLElement): void {
        const plugin = this.plugin;
        parentEl.createEl('h2', { text: this.t("plugin.settings.graph.title") });
        parentEl.createEl("p", { text: this.t("plugin.settings.graph.desc"), cls: "pa-settings-section-desc-sm" });
        new Setting(parentEl).setName(this.t("plugin.settings.graph.type.name"))
            .setDesc(this.t("plugin.settings.graph.type.desc"))
            .addText(text => {
                text.setPlaceholder('popover')
                    .setValue(plugin.settings.localGraph.type)
                    .onChange((value) => {
                        plugin.settings.localGraph.type = value;
                        this.debouncedSave();
                    })
            });
        new Setting(parentEl).setName(this.t("plugin.settings.graph.depth.name"))
            .setDesc(this.t("plugin.settings.graph.depth.desc"))
            .addText(text => {
                text.setPlaceholder('2')
                    .setValue(plugin.settings.localGraph.depth.toString())
                    .onChange((value) => {
                        plugin.settings.localGraph.depth = safeParseInt(value, plugin.settings.localGraph.depth, 1, LOCAL_GRAPH_DEPTH_MAX);
                        this.debouncedSave();
                    })
            });
        new Setting(parentEl).setName(this.t("plugin.settings.graph.showTags.name"))
            .setDesc(this.t("plugin.settings.graph.showTags.desc"))
            .addToggle(toggle => {
                toggle.setValue(plugin.settings.localGraph.showTags)
                    .onChange(async (value) => {
                        plugin.settings.localGraph.showTags = value;
                        await plugin.saveSettings();
                    })
            });
        new Setting(parentEl).setName(this.t("plugin.settings.graph.showAttachment.name"))
            .setDesc(this.t("plugin.settings.graph.showAttachment.desc"))
            .addToggle(toggle => {
                toggle.setValue(plugin.settings.localGraph.showAttach)
                    .onChange(async (value) => {
                        plugin.settings.localGraph.showAttach = value;
                        await plugin.saveSettings();
                    })
            });
        new Setting(parentEl).setName(this.t("plugin.settings.graph.showNeighbor.name"))
            .setDesc(this.t("plugin.settings.graph.showNeighbor.desc"))
            .addToggle(toggle => {
                toggle.setValue(plugin.settings.localGraph.showNeighbor)
                    .onChange(async (value) => {
                        plugin.settings.localGraph.showNeighbor = value;
                        await plugin.saveSettings();
                    })
            });
        new Setting(parentEl).setName(this.t("plugin.settings.graph.collapse.name"))
            .setDesc(this.t("plugin.settings.graph.collapse.desc"))
            .addToggle(toggle => {
                toggle.setValue(plugin.settings.localGraph.collapse)
                    .onChange(async (value) => {
                        plugin.settings.localGraph.collapse = value;
                        await plugin.saveSettings();
                    })
            });
        new Setting(parentEl).setName(this.t("plugin.settings.graph.autoColors.name"))
            .setDesc(this.t("plugin.settings.graph.autoColors.desc"))
            .addToggle(toggle => {
                toggle.setValue(plugin.settings.localGraph.autoColors).onChange(async value => {
                    plugin.settings.localGraph.autoColors = value;
                    await plugin.saveSettings();
                })
            });
        parentEl.createEl("p", { text: this.t("plugin.settings.graph.resize"), cls: "pa-settings-section-desc-md" });
        const doc = getPlatformDocument();
        const h = doc.createDocumentFragment();
        h.createEl('span', undefined, (p) => {
            p.innerText = this.t("plugin.settings.graph.height");
            p.setAttr("class", "pa-settings-resize-label");
        });
        const w = doc.createDocumentFragment();
        w.createEl('span', undefined, (p) => {
            p.innerText = this.t("plugin.settings.graph.width");
            p.setAttr("class", "pa-settings-resize-label");
        });
        new Setting(parentEl).setName(h)
            .addText(text => {
                text.setPlaceholder('height')
                    .setValue(plugin.settings.localGraph.resizeStyle.height.toString())
                    .onChange((value) => {
                        plugin.settings.localGraph.resizeStyle.height =
                            safeParseInt(value, plugin.settings.localGraph.resizeStyle.height, 1, LOCAL_GRAPH_DIMENSION_MAX);
                        this.debouncedSave();
                    })
            });
        new Setting(parentEl).setName(w)
            .addText(text => {
                text.setPlaceholder('width')
                    .setValue(plugin.settings.localGraph.resizeStyle.width.toString())
                    .onChange((value) => {
                        plugin.settings.localGraph.resizeStyle.width =
                            safeParseInt(value, plugin.settings.localGraph.resizeStyle.width, 1, LOCAL_GRAPH_DIMENSION_MAX);
                        this.debouncedSave();
                    })
            });
    }

    private renderGraphColorsSection(parentEl: HTMLElement): void {
        const plugin = this.plugin;
        parentEl.createEl('h2', { text: this.t("plugin.settings.graphColors.title") });
        new Setting(parentEl).setName(this.t("plugin.settings.graphColors.enabled.name"))
            .setDesc(this.t("plugin.settings.graphColors.enabled.desc"))
            .addToggle(toggle => {
                toggle.setValue(plugin.settings.enableGraphColors).onChange(async value => {
                    plugin.settings.enableGraphColors = value;
                    await plugin.saveSettings();
                    this.rebuildGraphColors();
                })
            });
        this.graphColorsContainer = parentEl.createDiv();
        this.rebuildGraphColors();
    }

    private rebuildGraphColors(): void {
        if (!this.graphColorsContainer) return;
        this.graphColorsContainer.empty();

        const plugin = this.plugin;
        if (!plugin.settings.enableGraphColors) return;

        const container = this.graphColorsContainer;
        // deep copy setting.colorGroups for rendering
        const colorGroups: { query: string, color: { a: number, rgb: number } }[] = JSON.parse(JSON.stringify(plugin.settings.colorGroups));
        colorGroups.forEach((colorGroup) => {
            // find if the item is exist in plugin.settings
            const index = this.findGraphColor(colorGroup);
            const color = formatGraphColorHex(colorGroup.color.rgb);
            const nameEl = getPlatformDocument().createDocumentFragment();
            nameEl.createSpan({ text: "●" }).setCssStyles({ color });
            nameEl.appendText(` ${this.t("plugin.settings.graphColors.colorFor", { query: colorGroup.query })}`);
            new Setting(container)
                .setName(nameEl)
                .setDesc(this.t("plugin.settings.graphColors.colorDesc"))
                .addText(text => {
                    text.setValue(plugin.settings.colorGroups[index].query)
                        .onChange((value) => {
                            if (index > -1) {
                                plugin.settings.colorGroups[index].query = value;
                                this.debouncedSave();
                            }
                        })
                })
                .addColorPicker(picker => {
                    picker.setValue(color).onChange(async (value) => {
                        if (index < 0) return;
                        const hexColor = normalizeGraphColorInput(value);
                        if (!hexColor) return;
                        plugin.settings.colorGroups[index].color.rgb = parseInt(hexColor, 16);
                        await plugin.saveSettings();
                        this.rebuildGraphColors();
                    });
                })
                .addExtraButton(btn => {
                    btn.setIcon("trash").setTooltip(this.t("plugin.settings.graphColors.remove")).onClick(async () => {
                        if (index > -1) {
                            this.log("removing color group", plugin.settings.colorGroups[index]);
                            plugin.settings.colorGroups.splice(index, 1);
                        }
                        await plugin.saveSettings();
                        this.rebuildGraphColors();
                    });
                })
                .addExtraButton(btn => {
                    btn.setIcon("reset").setTooltip(this.t("plugin.settings.graphColors.reset")).onClick(async () => {
                        if (index > -1) {
                            this.log("resetting color group", plugin.settings.colorGroups[index]);
                            plugin.settings.colorGroups[index] = JSON.parse(JSON.stringify(DEFAULT_GRAPH_COLOR));
                        }
                        await plugin.saveSettings();
                        this.rebuildGraphColors();
                    });
                });
        });
        new Setting(container)
            .addButton(btn => {
                btn.setButtonText(this.t("plugin.settings.graphColors.add")).onClick(async () => {
                    this.log("adding new color");
                    plugin.settings.colorGroups.push(JSON.parse(JSON.stringify(DEFAULT_GRAPH_COLOR)));
                    await plugin.saveSettings();
                    this.rebuildGraphColors();
                })
            });
        this.markFormControlSettings(container);
    }

    private renderMetadataSection(parentEl: HTMLElement): void {
        const plugin = this.plugin;
        // setting options for updating metadata
        parentEl.createEl('h2', { text: this.t("plugin.settings.metadata.title") });
        const descFormat = getPlatformDocument().createDocumentFragment();
        descFormat.createEl('p', undefined, (p) => {
            p.innerText = this.t("plugin.settings.metadata.descPrefix");
            p.createEl('a', undefined, (link) => {
                link.innerText = this.t("plugin.settings.metadata.descLink");
                link.href = 'https://momentjs.com/docs/#/displaying/format/';
            });
        });
        new Setting(parentEl).setName(this.t("plugin.settings.metadata.enabled.name"))
            .setDesc(descFormat)
            .addToggle(toggle => {
                toggle.setValue(plugin.settings.enableMetadataUpdating).onChange(async value => {
                    plugin.settings.enableMetadataUpdating = value;
                    await plugin.saveSettings();
                    this.rebuildMetadataList();
                })
            });
        this.metadataContainer = parentEl.createDiv();
        this.rebuildMetadataList();
    }

    private rebuildMetadataList(): void {
        if (!this.metadataContainer) return;
        this.metadataContainer.empty();
        const plugin = this.plugin;
        if (!plugin.settings.enableMetadataUpdating) return;

        const container = this.metadataContainer;
        // deep copy metadata for rendering
        const metas: { key: string, value: any }[] = JSON.parse(JSON.stringify(plugin.settings.metadatas)); // eslint-disable-line @typescript-eslint/no-explicit-any
        const doc = getPlatformDocument();
        const nameEl1 = doc.createDocumentFragment();
        nameEl1.createSpan({ text: "---" });
        new Setting(container).setName(nameEl1);
        for (let i = 0; i < metas.length; i++) {
            const index = this.findMetadata(metas[i].key);
            const nameEl = doc.createDocumentFragment();
            nameEl.appendText(`${metas[i].key}: `);
            new Setting(container)
                .setName(nameEl)
                .addText(text => {
                    text.setValue(plugin.settings.metadatas[index].value)
                        .onChange((value) => {
                            if (index > -1) {
                                plugin.settings.metadatas[index].value = value;
                                this.debouncedSave();
                            }
                        })
                })
                .addExtraButton(btn => {
                    btn.setIcon("trash").setTooltip(this.t("plugin.settings.graphColors.remove")).onClick(async () => {
                        if (index > -1) {
                            this.log("removing metadata rule", plugin.settings.metadatas[index]);
                            plugin.settings.metadatas.splice(index, 1);
                        }
                        await plugin.saveSettings();
                        this.rebuildMetadataList();
                    });
                })
        }
        const nameEl2 = doc.createDocumentFragment();
        nameEl2.createSpan({ text: "---" });
        new Setting(container).setName(nameEl2);

        // Initialize with the dropdown's first option ("string") so a user who
        // clicks Add without touching the dropdown gets a valid type instead of
        // undefined being persisted to data.json.
        let key = "";
        let value: any = ""; // eslint-disable-line @typescript-eslint/no-explicit-any
        let t = "string";
        // Track the input components so the Add handler can reset their visible
        // value after a successful save — otherwise the form retains the just-
        // submitted text and the next entry has to be typed over it.
        let keyInput: { setValue: (v: string) => unknown } | null = null;
        let valueInput: { setValue: (v: string) => unknown } | null = null;
        new Setting(container)
            .setName(this.t("plugin.settings.metadata.add.name"))
            .setDesc(this.t("plugin.settings.metadata.add.desc"))
            .addText(text => {
                keyInput = text;
                text.setPlaceholder('key')
                    .setValue(key)
                    .onChange(async (val) => {
                        key = val;
                    })
            })
            .addText(text => {
                valueInput = text;
                text.setPlaceholder('value')
                    .setValue(value)
                    .onChange(async (val) => {
                        value = val;
                    })
            })
            .addDropdown(dropDown => {
                dropDown.addOption('string', this.t("plugin.settings.metadata.dropdown.string"));
                dropDown.addOption('moment', this.t("plugin.settings.metadata.dropdown.moment"));
                dropDown.setValue(t);
                dropDown.onChange(async (value) => {
                    t = value;
                });
            })
            .addButton(btn => {
                btn.setButtonText(this.t("plugin.settings.metadata.add.button")).onClick(async () => {
                    const trimmedKey = key.trim();
                    if (!trimmedKey) {
                        new Notice(this.t("plugin.settings.metadata.keyRequired"), 4000);
                        return;
                    }
                    this.log("adding new frontmatter");
                    plugin.settings.metadatas.push({ key: trimmedKey, value: value, t: t });
                    await plugin.saveSettings();
                    // Reset the form so the next add starts blank. We update both
                    // the captured local vars (consumed by the next Add click)
                    // and the visible inputs (rebuildMetadataList will re-mount,
                    // but resetting first avoids a flash of stale text).
                    key = "";
                    value = "";
                    keyInput?.setValue("");
                    valueInput?.setValue("");
                    this.rebuildMetadataList();
                })
            });
        new Setting(container).setName(this.t("plugin.settings.metadata.excludePath.name"))
            .setDesc(this.t("plugin.settings.metadata.excludePath.desc"))
            .addText(text => {
                text.setPlaceholder('path strings with comma as separator, e.g. `tmp/,notes/templates`')
                    .setValue(plugin.settings.metadataExcludePath.join(','))
                    .onChange((value) => {
                        plugin.settings.metadataExcludePath = value.split(",");
                        this.debouncedSave();
                    })
            });
        this.markFormControlSettings(container);
    }

    private renderStatisticsSection(parentEl: HTMLElement): void {
        const plugin = this.plugin;
        // setting for show statistics
        parentEl.createEl('h2', { text: this.t("plugin.settings.statistics.title") });
        new Setting(parentEl).setName(this.t("plugin.settings.statistics.show.name"))
            .setDesc(this.t("plugin.settings.statistics.show.desc"))
            .addDropdown(dropDown => {
                dropDown.addOption('overview', this.t("plugin.settings.statistics.view.overview"));
                dropDown.addOption('daily', this.t("plugin.settings.statistics.view.daily"));
                dropDown.addOption('growth', this.t("plugin.settings.statistics.view.growth"));
                dropDown.addOption('composition', this.t("plugin.settings.statistics.view.composition"));
                dropDown.setValue(normalizeStatisticsView(plugin.settings.statisticsType));
                dropDown.onChange(async (value) => {
                    plugin.log("changing statistics type", value);
                    plugin.settings.statisticsType = value;
                    await plugin.saveSettings();

                    // popup view
                    const leaf = this.app.workspace.getLeaf("window");
                    await leaf.setViewState({
                        type: STAT_PREVIEW_TYPE,
                        active: false,
                    });
                    await this.app.workspace.revealLeaf(leaf);
                });
            });
        new Setting(parentEl).setName(this.t("plugin.settings.statistics.sync.name"))
            .setDesc(this.t("plugin.settings.statistics.sync.desc"))
            .addToggle((toggle) => {
                toggle.setValue(Boolean(plugin.settings.statisticsSyncEnabled))
                    .onChange(async (value) => {
                        const previousValue = Boolean(plugin.settings.statisticsSyncEnabled);
                        plugin.settings.statisticsSyncEnabled = value;
                        try {
                            await plugin.statsManager?.setStatisticsSyncEnabled(value);
                            await plugin.saveSettings();
                        } catch (error) {
                            plugin.settings.statisticsSyncEnabled = previousValue;
                            toggle.setValue(previousValue);
                            await plugin.saveSettings();
                            plugin.log("Failed to change Statistics sync setting", error);
                            new Notice(this.t("plugin.settings.statistics.sync.error"), 5000);
                        }
                    });
            });
        new Setting(parentEl).setName(this.t("plugin.settings.statistics.animation.name")).addToggle((cb) =>
            cb.setValue(plugin.settings.animation)
                .onChange((value) => {
                    plugin.settings.animation = value;
                    void plugin.saveSettings().catch((error) => {
                        plugin.log("Failed to save animation setting", error);
                    });
                })
        );

        new Setting(parentEl)
            .setName(this.t("plugin.settings.statistics.sectionCounts.name"))
            .setDesc(this.t("plugin.settings.statistics.sectionCounts.desc"))
            .addToggle((toggle) => {
                toggle
                    .setValue(plugin.settings.displaySectionCounts)
                    .onChange(async (value) => {
                        plugin.settings.displaySectionCounts = value;
                        await plugin.saveSettings();
                    });
            });

        new Setting(parentEl)
            .setName(this.t("plugin.settings.statistics.countComments.name"))
            .setDesc(this.t("plugin.settings.statistics.countComments.desc"))
            .addToggle((toggle) => {
                toggle
                    .setValue(plugin.settings.countComments)
                    .onChange(async (value) => {
                        plugin.settings.countComments = value;
                        await plugin.saveSettings();
                    });
            });
    }

    private renderAISection(parentEl: HTMLElement): void {
        const plugin = this.plugin;
        parentEl.createEl('h2', { text: this.t("plugin.settings.ai.title") });
        parentEl.createEl("p", {
            text: this.t("plugin.settings.ai.desc"),
            cls: "pa-settings-section-desc",
        });

        new Setting(parentEl).setName(this.t("plugin.settings.ai.provider.name"))
            .setDesc(this.t("plugin.settings.ai.provider.desc"))
            .addDropdown(dropDown => {
                if (!plugin.settings.aiProvider) {
                    dropDown.addOption('', this.t("plugin.settings.ai.provider.choose"));
                }
                for (const [key, preset] of Object.entries(PROVIDER_PRESETS)) {
                    dropDown.addOption(key, preset.label);
                }

                const initialPreset = plugin.settings.aiProvider
                    ? deriveDisplayPreset(plugin.settings)
                    : '';
                dropDown.setValue(initialPreset);

                dropDown.onChange(async (value) => {
                    plugin.log("changing AI provider preset", value);
                    if (!value) {
                        return;
                    }
                    const preset = PROVIDER_PRESETS[value];
                    if (!preset) {
                        return;
                    }

                    if (plugin.settings.aiProvider) {
                        const prevKey = deriveDisplayPreset(plugin.settings);
                        if (value !== prevKey) {
                            const prev = PROVIDER_PRESETS[prevKey];
                            const hasCustomURL = prevKey === "custom"
                                ? plugin.settings.baseURL !== ""
                                : Boolean(prev) && plugin.settings.baseURL !== prev.baseURL;
                            const hasCustomModel = prevKey === "custom"
                                ? plugin.settings.chatModelName !== ""
                                : Boolean(prev) && plugin.settings.chatModelName !== prev.chatModelName;
                            const hasCustomMemoryModel = prevKey === "custom"
                                ? plugin.settings.embeddingModelName !== ""
                                : Boolean(prev) && plugin.settings.embeddingModelName !== prev.embeddingModelName;
                            const confirmed = await confirmUserAction(this.app, {
                                title: this.t("plugin.settings.ai.provider.switch.title"),
                                message: value === "custom"
                                    ? this.t("plugin.settings.ai.provider.switch.customMessage")
                                    : this.t("plugin.settings.ai.provider.switch.presetMessage"),
                                confirmText: this.t("plugin.settings.ai.provider.switch.confirm"),
                            });
                            if (!confirmed) {
                                dropDown.setValue(prevKey);
                                return;
                            }
                            if (!hasCustomURL && !hasCustomModel && !hasCustomMemoryModel) {
                                plugin.log("Switching provider from unmodified preset", { from: prevKey, to: value });
                            }
                        }
                    }

                    plugin.settings.aiProvider = preset.runtimeProvider;
                    plugin.settings.aiProviderPreset = value;
                    if (value === "custom") {
                        // Custom keeps the current URL/model fields; the user can edit them below.
                    } else {
                        plugin.settings.baseURL = preset.baseURL;
                        plugin.settings.chatModelName = preset.chatModelName;
                        plugin.settings.embeddingModelName = preset.embeddingModelName;
                    }
                    await plugin.saveSettings();
                    this.rebuildProviderConfig();
                    this.rebuildQwenOptions();
                    this.rebuildFeaturedImage();
                });
            });

        this.providerConfigContainer = parentEl.createDiv();
        this.rebuildProviderConfig();

        this.qwenOptionsContainer = parentEl.createDiv();
        this.rebuildQwenOptions();
    }

    private rebuildProviderConfig(): void {
        if (!this.providerConfigContainer) return;
        this.providerConfigContainer.empty();
        const plugin = this.plugin;
        const container = this.providerConfigContainer;

        if (!plugin.settings.aiProvider) {
            // Fresh install: hide Token / URL / Model fields until the user
            // chooses a provider above. Without this guard the user is faced
            // with empty Token + Base URL + Model fields and no clue which
            // values belong with which provider.
            container.createEl("p", {
                text: this.t("plugin.settings.ai.provider.prompt"),
                cls: "pa-settings-provider-prompt",
            });
            return;
        }

        new Setting(container)
            .setName(this.t("plugin.settings.ai.apiToken.name"))
            .setDesc(this.t("plugin.settings.ai.apiToken.desc"))
            .addComponent((el) => {
                const secret = new SecretComponent(this.app, el);
                const existing = plugin.getConfiguredAPITokenSecret();
                if (hasSecretValue(existing)) {
                    secret.setValue(existing);
                }
                this.renameSecretComponentLinkButton(el);
                secret.onChange(async (value: string) => {
                    if (value === "") {
                        const stored = plugin.getConfiguredAPITokenSecret();
                        if (!hasSecretValue(stored)) {
                            return;
                        }
                        const confirmed = await confirmUserAction(this.app, {
                            title: this.t("plugin.settings.ai.apiToken.remove.title"),
                            message: this.t("plugin.settings.ai.apiToken.remove.message"),
                            confirmText: this.t("plugin.settings.ai.apiToken.remove.confirm"),
                            cancelText: this.t("plugin.settings.ai.apiToken.remove.cancel"),
                        });
                        if (!confirmed) {
                            secret.setValue(stored);
                            return;
                        }
                        // SecretStorage exposes only setSecret — writing "" is
                        // the equivalent of clearing the token.
                        plugin.setAPITokenSecret("");
                        return;
                    }
                    plugin.setAPITokenSecret(value);
                });
                return secret;
            });

        new Setting(container)
            .setName(this.t("plugin.settings.ai.baseUrl.name"))
            .setDesc(this.t("plugin.settings.ai.baseUrl.desc"))
            .addText((text) => {
                text.setPlaceholder("https://api.openai.com/v1");
                text.setValue(plugin.settings.baseURL);
                text.onChange((value: string) => {
                    plugin.settings.baseURL = value;
                    plugin.settings.aiProviderPreset = "custom";
                    this.debouncedSave();
                    // Visual sync (enabling/disabling DashScope-only toggles)
                    // is intentionally synchronous — it reflects the in-memory
                    // setting, not the persisted one, so debouncing the save
                    // does not delay it.
                    this.refreshQwenResponseOptionAvailability?.();
                    this.rebuildFeaturedImage();
                });
            });

        new Setting(container)
            .setName(this.t("plugin.settings.ai.chatModel.name"))
            .setDesc(this.t("plugin.settings.ai.chatModel.desc"))
            .addText((text) => {
                text.setPlaceholder("gpt-4o-mini");
                text.setValue(plugin.settings.chatModelName);
                text.onChange((value: string) => {
                    plugin.settings.chatModelName = value;
                    plugin.settings.aiProviderPreset = "custom";
                    this.debouncedSave();
                });
            });

        const policyModelSetting = new Setting(container);
        (policyModelSetting as Setting & { settingEl?: HTMLElement }).settingEl?.addClass("pa-policy-model-setting");
        policyModelSetting
            .setName(this.t("plugin.settings.ai.policyModel.name"))
            .setDesc(this.t("plugin.settings.ai.policyModel.desc"))
            .addText((text) => {
                text.setPlaceholder(plugin.settings.chatModelName || "optional");
                text.setValue(plugin.settings.policyModelName);
                text.onChange((value: string) => {
                    plugin.settings.policyModelName = value.trim();
                    this.debouncedSave();
                });
            });
        this.markFormControlSettings(container);
    }

    private rebuildQwenOptions(): void {
        if (!this.qwenOptionsContainer) return;
        this.qwenOptionsContainer.empty();
        this.refreshQwenResponseOptionAvailability = null;

        const plugin = this.plugin;
        if (plugin.settings.aiProvider !== 'qwen') return;

        const container = this.qwenOptionsContainer;
        const qwenOptionToggles: QwenResponseOptionToggle[] = [];
        container.createEl('h3', { text: this.t("plugin.settings.qwen.title") });
        const qwenOptionsDescriptionEl = container.createEl("p", { cls: "pa-settings-section-desc-sm" });
        this.refreshQwenResponseOptionAvailability = () => {
            updateQwenResponseOptionAvailability(
                plugin.settings.baseURL,
                qwenOptionsDescriptionEl,
                qwenOptionToggles,
                {
                    dashScopeDescription: this.t("plugin.qwen.desc.dashScope"),
                    nonDashScopeDescription: this.t("plugin.qwen.desc.nonDashScope"),
                },
            );
        };

        new Setting(container)
            .setName(this.t("plugin.settings.qwen.thinking.name"))
            .setDesc(this.t("plugin.settings.qwen.thinking.desc"))
            .addToggle((toggle) => {
                qwenOptionToggles.push(toggle);
                toggle
                    .setValue(plugin.settings.qwenThinkingEnabled)
                    .onChange(async (value) => {
                        plugin.settings.qwenThinkingEnabled = value;
                        await plugin.saveSettings();
                    });
            });

        new Setting(container)
            .setName(this.t("plugin.settings.qwen.webSearch.name"))
            .setDesc(this.t("plugin.settings.qwen.webSearch.desc"))
            .addToggle((toggle) => {
                qwenOptionToggles.push(toggle);
                toggle
                    .setValue(plugin.settings.webSearchEnabled)
                    .onChange(async (value) => {
                        plugin.settings.webSearchEnabled = value;
                        await plugin.saveSettings();
                    });
            });

        this.refreshQwenResponseOptionAvailability();
    }

    private renderAdvancedSection(parentEl: HTMLElement): void {
        const plugin = this.plugin;
        parentEl.createEl('h2', { text: this.t("plugin.settings.advanced.title") });
        parentEl.createEl("p", {
            text: this.t("plugin.settings.advanced.desc"),
            cls: "pa-settings-section-desc",
        });

        new Setting(parentEl).setName(this.t("plugin.settings.advanced.debug.name"))
            .setDesc(this.t("plugin.settings.advanced.debug.desc"))
            .addToggle((cb) =>
                cb.setValue(plugin.settings.debug)
                    .onChange((value) => {
                        plugin.settings.debug = value;
                        void plugin.saveSettings().catch((error) => {
                            plugin.log("Failed to save debug setting", error);
                        });
                    }));

        new Setting(parentEl)
            .setName(this.t("plugin.settings.advanced.shareUsage.name"))
            .setDesc(this.t("plugin.settings.advanced.shareUsage.desc"))
            .addToggle((toggle) => {
                toggle
                    .setValue(plugin.settings.shareAnonymousCapabilityUsage)
                    .onChange(async (value) => {
                        plugin.settings.shareAnonymousCapabilityUsage = value;
                        await plugin.saveSettings();
                    });
            });
    }

    private renderLegalSection(parentEl: HTMLElement): void {
        const releaseTag = this.plugin.manifest.version;
        const legalLinks = buildPaLegalLinks(releaseTag);
        parentEl.createEl('h2', { text: this.t("plugin.settings.legal.title") });
        parentEl.createEl("p", {
            text: this.t("plugin.settings.legal.desc", { version: releaseTag }),
            cls: "pa-settings-section-desc",
        });

        const locale = getPluginUiLanguage();
        const networkPrivacyUrl = locale === "zh"
            ? legalLinks.networkPrivacyZh
            : legalLinks.networkPrivacyEn;

        this.addLegalLink(
            parentEl,
            "plugin.settings.legal.source.name",
            "plugin.settings.legal.source.desc",
            legalLinks.source,
        );
        this.addLegalLink(
            parentEl,
            "plugin.settings.legal.sourceArchive.name",
            "plugin.settings.legal.sourceArchive.desc",
            legalLinks.sourceArchive,
        );
        this.addLegalLink(
            parentEl,
            "plugin.settings.legal.license.name",
            "plugin.settings.legal.license.desc",
            legalLinks.license,
        );
        this.addLegalLink(
            parentEl,
            "plugin.settings.legal.notice.name",
            "plugin.settings.legal.notice.desc",
            legalLinks.notice,
        );
        this.addLegalLink(
            parentEl,
            "plugin.settings.legal.thirdPartyNotices.name",
            "plugin.settings.legal.thirdPartyNotices.desc",
            legalLinks.thirdPartyNotices,
        );
        this.addLegalLink(
            parentEl,
            "plugin.settings.legal.networkPrivacy.name",
            "plugin.settings.legal.networkPrivacy.desc",
            networkPrivacyUrl,
        );
    }

    private addLegalLink(
        parentEl: HTMLElement,
        nameKey: PluginMessageKey,
        descKey: PluginMessageKey,
        url: string,
    ): void {
        new Setting(parentEl)
            .setName(this.t(nameKey))
            .setDesc(this.t(descKey))
            .addButton((button) => {
                button
                    .setButtonText(this.t("plugin.settings.legal.open"))
                    .onClick(() => {
                        window.open(url, "_blank", "noopener,noreferrer");
                    });
            });
    }

    private renderPageletSection(parentEl: HTMLElement): void {
        const plugin = this.plugin;
        // Adapt Obsidian's `Setting` constructor into the bare-bones factory
        // shape `renderPageletSection` expects. Keeping the factory thin lets
        // the Pagelet module stay free of any Obsidian dependency, which in
        // turn makes its unit tests trivial.
        const factory: PageletSettingFactory = {
            create: (containerEl) => new Setting(containerEl) as unknown as ReturnType<PageletSettingFactory["create"]>,
        };
        renderPageletSection(
            parentEl,
            plugin as unknown as Parameters<typeof renderPageletSection>[1],
            factory,
            getPageletUiLanguage(),
        );
    }

    private renderSkillsSection(parentEl: HTMLElement): void {
        const plugin = this.plugin;
        parentEl.createEl('h3', { text: this.t("plugin.settings.skills.title") });
        parentEl.createEl("p", {
            text: this.t("plugin.settings.skills.desc"),
            cls: "pa-settings-section-desc-sm",
        });

        new Setting(parentEl)
            .setName(this.t("plugin.settings.skills.enabled.name"))
            .setDesc(this.t("plugin.settings.skills.enabled.desc"))
            .addToggle((toggle) => {
                toggle
                    .setValue(plugin.settings.skillContextEnabled)
                    .onChange(async (value) => {
                        plugin.settings.skillContextEnabled = value;
                        await plugin.saveSettings();
                        this.rebuildSkillToggles();
                    });
            });

        this.skillTogglesContainer = parentEl.createDiv();
        this.rebuildSkillToggles();
    }

    private rebuildSkillToggles(): void {
        if (!this.skillTogglesContainer) return;
        this.skillTogglesContainer.empty();
        const plugin = this.plugin;
        const container = this.skillTogglesContainer;
        const enabledSkillIds = new Set(plugin.settings.enabledSkillIds);
        for (const skill of BUNDLED_SKILL_CATALOG) {
            new Setting(container)
                .setName(skill.label)
                .setDesc(skill.description)
                .addToggle((toggle) => {
                    toggle
                        .setValue(plugin.settings.skillContextEnabled && enabledSkillIds.has(skill.id))
                        .setDisabled(!plugin.settings.skillContextEnabled)
                        .onChange(async (value) => {
                            const nextEnabledSkillIds = new Set(plugin.settings.enabledSkillIds);
                            if (value) {
                                nextEnabledSkillIds.add(skill.id);
                            } else {
                                nextEnabledSkillIds.delete(skill.id);
                            }
                            plugin.settings.enabledSkillIds = normalizeEnabledSkillIds([...nextEnabledSkillIds]);
                            await plugin.saveSettings();
                        });
                });
        }
    }

    private renderMemorySection(parentEl: HTMLElement): void {
        const plugin = this.plugin;
        parentEl.createEl('h2', { text: this.t("plugin.settings.memory.title") });
        parentEl.createEl("p", {
            text: this.t("plugin.settings.memory.desc"),
            cls: "pa-settings-section-desc-md",
        });

        new Setting(parentEl)
            .setName(this.t("plugin.settings.memory.enabled.name"))
            .setDesc(this.t("plugin.settings.memory.enabled.desc"))
            .addToggle((toggle) => {
                toggle
                    .setValue(plugin.settings.memoryEnabled)
                    .onChange(async (value) => {
                        plugin.settings.memoryEnabled = value;
                        await plugin.saveSettings();
                        this.rebuildMemorySubSettings();
                    });
            });

        // Everything below the master toggle lives in a sub-container so we
        // can hide it entirely when memoryEnabled is off (mirroring the
        // enableGraphColors / enableMetadataUpdating pattern).
        this.memorySubContainer = parentEl.createDiv();
        this.rebuildMemorySubSettings();
    }

    private rebuildMemorySubSettings(): void {
        if (!this.memorySubContainer) return;
        this.memorySubContainer.empty();
        // Advanced sub-container is a child of the now-cleared memorySubContainer.
        this.memoryAdvancedContainer = null;

        const plugin = this.plugin;
        if (!plugin.settings.memoryEnabled) return;

        const container = this.memorySubContainer;

        new Setting(container)
            .setName(this.t("plugin.settings.memory.askCredits.name"))
            .setDesc(this.t("plugin.settings.memory.askCredits.desc"))
            .addToggle((toggle) => {
                toggle
                    .setValue(plugin.settings.memoryAutoCheckBeforeChat)
                    .onChange(async (value) => {
                        plugin.settings.memoryAutoCheckBeforeChat = value;
                        await plugin.saveSettings();
                    });
            });

        new Setting(container)
            .setName(this.t("plugin.settings.memory.advancedControls.name"))
            .setDesc(this.t("plugin.settings.memory.advancedControls.desc"))
            .addToggle((toggle) => {
                toggle
                    .setValue(plugin.settings.showAdvancedMemoryControls)
                    .onChange(async (value) => {
                        plugin.settings.showAdvancedMemoryControls = value;
                        await plugin.saveSettings();
                        this.rebuildMemoryAdvanced();
                    });
            });

        new Setting(container)
            .setName(this.t("plugin.memoryExtraction.settings.enabled.name"))
            .setDesc(this.t("plugin.memoryExtraction.settings.enabled.desc"))
            .addToggle((toggle) => {
                toggle
                    .setValue(plugin.settings.memoryExtractionEnabled)
                    .onChange(async (value) => {
                        if (value && !plugin.settings.memoryExtractionEnabled) {
                            const confirmed = await confirmUserAction(this.app, {
                                title: this.t("plugin.memoryExtraction.settings.enableConfirm.title"),
                                message: this.t("plugin.memoryExtraction.settings.enableConfirm.message"),
                                confirmText: this.t("plugin.memoryExtraction.settings.enableConfirm.confirm"),
                            });
                            if (!confirmed) {
                                toggle.setValue(false);
                                return;
                            }
                        }
                        plugin.settings.memoryExtractionEnabled = value;
                        await plugin.saveSettings();
                        this.rebuildMemorySubSettings();
                    });
            });

        if (plugin.settings.memoryExtractionEnabled) {
            new Setting(container)
                .setName(this.t("plugin.memoryExtraction.settings.viewInsights.name"))
                .setDesc(this.t("plugin.memoryExtraction.settings.viewInsights.desc"))
                .addButton((button) => {
                    button
                        .setButtonText(this.t("plugin.memoryExtraction.settings.viewInsights.button"))
                        .setCta()
                        .setDisabled(!plugin.canShowAiInsights())
                        .onClick(() => {
                            if (!plugin.canShowAiInsights()) return;
                            plugin.showAiInsights();
                        });
                });

            new Setting(container)
                .setName(this.t("plugin.memoryExtraction.settings.includeVaultInsights.name"))
                .setDesc(this.t("plugin.memoryExtraction.settings.includeVaultInsights.desc"))
                .addToggle((toggle) => {
                    toggle
                        .setValue(plugin.settings.memoryExtractionIncludeVaultInsights)
                        .onChange(async (value) => {
                            plugin.settings.memoryExtractionIncludeVaultInsights = value;
                            await plugin.saveSettings();
                        });
                });
        }

        this.memoryAdvancedContainer = container.createDiv();
        this.rebuildMemoryAdvanced();
    }

    private rebuildMemoryAdvanced(): void {
        if (!this.memoryAdvancedContainer) return;
        this.memoryAdvancedContainer.empty();
        const plugin = this.plugin;
        if (!plugin.settings.showAdvancedMemoryControls) return;

        const container = this.memoryAdvancedContainer;
        const showMemoryNotReadyNotice = () => {
            new Notice(this.t("plugin.memory.diagnostics.notInitializedSummary"), 5000);
        };
        const getMemoryManager = () => {
            if (plugin.memoryManager) return plugin.memoryManager;
            showMemoryNotReadyNotice();
            return null;
        };
        const getVss = () => {
            if (plugin.vss) return plugin.vss;
            showMemoryNotReadyNotice();
            return null;
        };

        new Setting(container)
            .setName(this.t("plugin.settings.memory.background.name"))
            .setDesc(this.t("plugin.settings.memory.background.desc"))
            .addToggle((toggle) => {
                toggle
                    .setValue(plugin.settings.memoryApprovalPolicy === "auto-refresh-after-prepare")
                    .onChange(async (value) => {
                        if (value) {
                            const confirmed = await confirmUserAction(this.app, {
                                title: this.t("plugin.settings.memory.background.title"),
                                message: this.t("plugin.settings.memory.background.message"),
                                confirmText: this.t("plugin.settings.memory.background.confirm"),
                            });
                            if (!confirmed) {
                                toggle.setValue(false);
                                return;
                            }
                        }
                        plugin.settings.memoryApprovalPolicy = value ? "auto-refresh-after-prepare" : "always";
                        await plugin.saveSettings();
                        if (value) {
                            const memoryManager = getMemoryManager();
                            memoryManager?.scheduleReconcile("settings");
                            memoryManager?.scheduleAutoFlush("settings");
                        }
                    });
            });

        new Setting(container)
            .setName(this.t("plugin.settings.memory.model.name"))
            .setDesc(this.t("plugin.settings.memory.model.desc"))
            .addText((text) => {
                text.setPlaceholder("model name");
                text.setValue(plugin.settings.embeddingModelName);
                text.onChange((value: string) => {
                    plugin.settings.embeddingModelName = value;
                    plugin.settings.aiProviderPreset = "custom";
                    this.debouncedSave();
                });
            });

        new Setting(container)
            .setName(this.t("plugin.settings.memory.update.name"))
            .setDesc(this.t("plugin.settings.memory.update.desc"))
            .addButton((button) => {
                button.setButtonText(this.t("plugin.settings.memory.update.button")).onClick(async () => {
                    await plugin.runManualMemoryAction(async () => {
                        const memoryManager = getMemoryManager();
                        if (!memoryManager) return;
                        await memoryManager.updateFromCommand();
                        await plugin.updateMemoryStatusBar();
                    });
                });
            });

        new Setting(container)
            .setName(this.t("plugin.settings.memory.rebuild.name"))
            .setDesc(this.t("plugin.settings.memory.rebuild.desc"))
            .addButton((button) => {
                button.setButtonText(this.t("plugin.settings.memory.rebuild.button")).onClick(async () => {
                    await plugin.runManualMemoryAction(async () => {
                        const memoryManager = getMemoryManager();
                        if (!memoryManager) return;
                        await memoryManager.prepareFromCommand();
                    });
                });
            });

        new Setting(container)
            .setName(this.t("plugin.settings.memory.reset.name"))
            .setDesc(this.t("plugin.settings.memory.reset.desc"))
            .addButton((button) => {
                button.setButtonText(this.t("plugin.settings.memory.reset.button")).onClick(async () => {
                    await plugin.runManualMemoryAction(async () => {
                        const confirmed = await confirmUserAction(this.app, {
                            title: this.t("plugin.memory.confirm.reset.title"),
                            message: this.t("plugin.memory.confirm.reset.message"),
                            confirmText: this.t("plugin.memory.confirm.reset.confirm"),
                        });
                        if (!confirmed) return;
                        const vss = getVss();
                        if (!vss) return;
                        await vss.resetLocalIndex();
                        await plugin.updateMemoryStatusBar();
                    });
                });
            });

        new Setting(container)
            .setName(this.t("plugin.settings.memory.deleteCache.name"))
            .setDesc(this.t("plugin.settings.memory.deleteCache.desc"))
            .addButton((button) => {
                button.setButtonText(this.t("plugin.settings.memory.deleteCache.button")).onClick(async () => {
                    await plugin.runManualMemoryAction(async () => {
                        const vss = getVss();
                        if (!vss) return;
                        await vss.cleanLegacyJsonCache();
                        await plugin.updateMemoryStatusBar();
                    });
                });
            });

        new Setting(container)
            .setName(this.t("plugin.settings.memory.technicalStatus.name"))
            .setDesc(this.t("plugin.settings.memory.technicalStatus.desc"))
            .addButton((button) => {
                button.setButtonText(this.t("plugin.settings.memory.technicalStatus.button")).onClick(async () => {
                    await plugin.runManualMemoryAction(async () => {
                        await plugin.showTechnicalMemoryStatus();
                    });
                });
            });

        new Setting(container).setName(this.t("plugin.settings.memory.excludePath.name"))
            .setDesc(this.t("plugin.settings.memory.excludePath.desc"))
            .addText(text => {
                text.setPlaceholder('tmp/,notes/templates')
                    .setValue(plugin.settings.vssCacheExcludePath.join(','))
                    .onChange((value) => {
                        plugin.settings.vssCacheExcludePath = value.split(",").map((path) => path.trim()).filter(Boolean);
                        this.debouncedSave();
                    })
            });
        this.markFormControlSettings(container);
    }

    private renderOperationsAgentSection(parentEl: HTMLElement): void {
        if (!OPERATIONS_AGENT_RUNTIME_ENABLED) return;
        const plugin = this.plugin;
        new Setting(parentEl)
            .setName(this.t("plugin.settings.operationsAgent.name"))
            .setDesc(this.t("plugin.settings.operationsAgent.desc"))
            .addToggle((toggle) => {
                toggle
                    .setValue(plugin.settings.operationsAgentEnabled)
                    .onChange(async (value) => {
                        plugin.settings.operationsAgentEnabled = value;
                        await plugin.saveSettings();
                    });
            });
    }

    private renderFeaturedImageSection(parentEl: HTMLElement): void {
        // 图片生成设置（仅Qwen支持）
        this.featuredImageContainer = parentEl.createDiv();
        this.rebuildFeaturedImage();
    }

    private rebuildFeaturedImage(): void {
        if (!this.featuredImageContainer) return;
        this.featuredImageContainer.empty();
        const plugin = this.plugin;
        if (plugin.settings.aiProvider !== 'qwen') return;
        if (!getDashScopeImageSynthesisUrl(plugin.settings.baseURL)) return;

        const container = this.featuredImageContainer;

        new Setting(container)
            .setName(this.t("plugin.settings.featuredImage.path.name"))
            .setDesc(this.t("plugin.settings.featuredImage.path.desc"))
            .addText((text) => {
                text.setPlaceholder("attachments/ai-images");
                text.setValue(plugin.settings.featuredImagePath.toString());
                text.onChange((value: string) => {
                    plugin.settings.featuredImagePath = value;
                    this.debouncedSave();
                });
            });
        new Setting(container).setName(this.t("plugin.settings.featuredImage.count.name"))
            .setDesc(this.t("plugin.settings.featuredImage.count.desc"))
            .addText(text => {
                text.setPlaceholder('2')
                    .setValue(plugin.settings.numFeaturedImages.toString())
                    .onChange((value) => {
                        plugin.settings.numFeaturedImages = safeParseInt(value, plugin.settings.numFeaturedImages, 1, FEATURED_IMAGE_COUNT_MAX);
                        this.debouncedSave();
                    })
            });
        this.markFormControlSettings(container);
    }

    private findGraphColor(graphColor: GraphColor): number {
        return this.plugin.settings.colorGroups.findIndex((color) => {
            return graphColor.query === color.query &&
                graphColor.color.a === color.color.a &&
                graphColor.color.rgb === color.color.rgb;
        });
    }

    private findMetadata(metaKey: string) {
        return this.plugin.settings.metadatas.findIndex((m) => {
            return m.key === metaKey;
        })
    }
}
