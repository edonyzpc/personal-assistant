/* Copyright 2023 edonyzpc */

import { App, Modal, Notice, PluginSettingTab, SecretComponent, Setting, debounce, setIcon } from "obsidian";
import Picker from "vanilla-picker";

import type { PluginManager } from "./plugin"
import { BUNDLED_SKILL_CATALOG, BUNDLED_SKILL_IDS } from "./ai-services/bundled-skill-catalog";
import { getDashScopeImageSynthesisUrl, isDashScopeCompatibleBaseURL } from "./ai-services/ai-utils";
import { STAT_PREVIEW_TYPE } from './stats-view'
import { normalizeStatisticsView } from './stats/stats-store'
import { confirmUserAction } from "./confirm";

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
    /** @deprecated legacy data.json token migrated to SecretStorage on load */
    apiToken?: string;
    baseURL: string;
    chatModelName: string;
    policyModelName: string;
    embeddingModelName: string;
    embeddingV4MigrationNoticeDismissed: boolean;
    memoryEnabled: boolean;
    memoryAutoCheckBeforeChat: boolean;
    memoryApprovalPolicy: "always" | "auto-refresh-after-prepare";
    showAdvancedMemoryControls: boolean;
    nativeToolPlanningSmokeEnabled: boolean;
    qwenThinkingEnabled: boolean;
    webSearchEnabled: boolean;
    shareAnonymousCapabilityUsage: boolean;
    skillContextEnabled: boolean;
    enabledSkillIds: string[];
    // 兼容旧版本
    modelName: string;
    featuredImagePath: string;
    numFeaturedImages: number;
    vssCacheExcludePath: string[];
}

export const DEFAULT_SETTINGS: PluginManagerSettings = {
    debug: false,
    targetPath: ".",
    fileFormat: "YYYY-MM-DD",
    previewLimits: 5,
    previewTags: [],
    localGraph: {
        notice: "show current note grah view",
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
    chatModelName: "qwen-plus",
    policyModelName: "",
    embeddingModelName: "text-embedding-v4",
    embeddingV4MigrationNoticeDismissed: false,
    memoryEnabled: true,
    memoryAutoCheckBeforeChat: true,
    memoryApprovalPolicy: "always",
    showAdvancedMemoryControls: false,
    nativeToolPlanningSmokeEnabled: false,
    qwenThinkingEnabled: false,
    webSearchEnabled: false,
    shareAnonymousCapabilityUsage: false,
    skillContextEnabled: true,
    enabledSkillIds: [...BUNDLED_SKILL_IDS],
    // 兼容旧版本
    modelName: "qwen-plus",
    featuredImagePath: "",
    numFeaturedImages: 2,
    // Generic default — the prior list ("8.template", "9.src", "a.subjects",
    // "b.notion") was the original developer's vault layout and made no sense
    // as a fresh-install default. mergeLoadedSettings preserves any persisted
    // value, so existing users keep their configured exclusions.
    vssCacheExcludePath: [".obsidian"],
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
        chatModelName: "qwen-plus",
        embeddingModelName: "text-embedding-v4",
        description: "Qwen models via Alibaba Cloud. Also hosts DeepSeek, Kimi, GLM, and other models.",
        runtimeProvider: "qwen",
    },
    "qwen-intl": {
        label: "Qwen (DashScope International)",
        baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        chatModelName: "qwen-plus",
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
    return Object.keys(loaded as object).length === 0;
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

export function updateQwenResponseOptionAvailability(
    baseURL: unknown,
    descriptionEl: QwenResponseOptionsDescription,
    toggles: QwenResponseOptionToggle[],
): boolean {
    const isDashScopeCompatible = isDashScopeCompatibleBaseURL(baseURL);
    descriptionEl.setText(
        isDashScopeCompatible
            ? QWEN_RESPONSE_OPTIONS_DASHSCOPE_DESC
            : QWEN_RESPONSE_OPTIONS_NON_DASHSCOPE_DESC
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

    // vanilla-picker instances; destroyed before rebuilding graphColorsContainer.
    private activePickers: Picker[] = [];

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

    display(): void {
        const { containerEl } = this;

        this.destroyPickers();
        containerEl.empty();
        (containerEl as HTMLElement & { addClass?: (cls: string) => void }).addClass?.("pa-settings-tab");
        (containerEl as HTMLElement & { classList?: DOMTokenList }).classList?.add("pa-settings-tab");
        document.body?.classList.add("pa-settings-tab-open");

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
        this.renderStatisticsSection(containerEl);
        this.renderRecordSection(containerEl);
        this.renderGraphSection(containerEl);
        this.renderGraphColorsSection(containerEl);
        this.renderMetadataSection(containerEl);
        this.renderFeaturedImageSection(containerEl);
        this.renderAdvancedSection(containerEl);
    }

    hide(): void {
        // Obsidian invokes hide() when the user closes the settings tab.
        // Tear down Pickers explicitly so popup elements + listeners are not
        // orphaned when the tab DOM is detached.
        this.destroyPickers();
        this.stopSecretPickerObserver();
        document.body?.classList.remove("pa-settings-tab-open");
        // Flush any pending text-input save: the onChange handlers have
        // already mutated plugin.settings.* synchronously, so persisting
        // the current settings object captures the user's latest input.
        this.debouncedSave.cancel();
        void this.plugin.saveSettings();
    }

    private destroyPickers(): void {
        for (const picker of this.activePickers) {
            try { picker.destroy(); } catch { /* picker may already be torn down */ }
        }
        this.activePickers = [];
    }

    private startSecretPickerObserver(): void {
        this.stopSecretPickerObserver();
        this.secretPickerEditClickHandler = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null;
            const action = target?.closest<HTMLElement>(".modal .suggestion-item .clickable-icon");
            const row = action?.closest<HTMLElement>(".suggestion-item");
            if (!action || !row || !this.isSecretPickerRow(row)) {
                return;
            }

            const actions = Array.from(row.querySelectorAll<HTMLElement>(".clickable-icon"));
            if (actions.length < 2 || action !== actions[actions.length - 1]) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            const secretId = this.getSecretIdFromPickerRow(row);
            if (!secretId) {
                new Notice("Could not determine which secret to edit.", 4000);
                return;
            }
            this.openSecretEditorViaAddSecret(secretId, row.closest<HTMLElement>(".modal"));
        };
        if (typeof document.addEventListener === "function") {
            document.addEventListener("click", this.secretPickerEditClickHandler, true);
        }
        if (!document.body || typeof MutationObserver === "undefined") {
            return;
        }
        this.secretPickerObserver = new MutationObserver(() => {
            this.patchSecretPickerActions();
        });
        this.secretPickerObserver.observe(document.body, {
            childList: true,
            subtree: true,
        });
        this.scheduleSecretPickerPatch();
    }

    private stopSecretPickerObserver(): void {
        this.secretPickerObserver?.disconnect();
        this.secretPickerObserver = null;
        if (this.secretPickerEditClickHandler) {
            if (typeof document.removeEventListener === "function") {
                document.removeEventListener("click", this.secretPickerEditClickHandler, true);
            }
            this.secretPickerEditClickHandler = null;
        }
        this.patchedSecretPickerEditButtons = new WeakSet<HTMLElement>();
    }

    private patchSecretPickerActions(): void {
        const rows = document.querySelectorAll<HTMLElement>(
            ".modal .suggestion-item",
        );
        rows.forEach((row) => {
            if (!this.isSecretPickerRow(row)) {
                return;
            }
            const actions = Array.from(row.querySelectorAll<HTMLElement>(".clickable-icon"));
            if (actions.length < 2) {
                return;
            }
            const editAction = actions[actions.length - 1];
            if (!editAction) {
                return;
            }

            editAction.classList.add("pa-secret-edit-action");
            editAction.setAttribute("aria-label", "Edit secret");
            editAction.setAttribute("title", "Edit secret");
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
                    new Notice("Could not determine which secret to edit.", 4000);
                    return;
                }
                this.openSecretEditorViaAddSecret(secretId, row.closest<HTMLElement>(".modal"));
            }, true);
        });
    }

    private scheduleSecretPickerPatch(): void {
        [0, 25, 75, 150, 300, 600, 1000].forEach((delay) => {
            window.setTimeout(() => this.patchSecretPickerActions(), delay);
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
            new Notice(`Could not open the secret editor for ${secretId}.`, 4000);
            return;
        }

        addSecretButton.click();
        this.prefillAddSecretModal(secretId, secretValue, 0);
    }

    private findAddSecretButton(modal: HTMLElement): HTMLElement | null {
        return Array.from(modal.querySelectorAll<HTMLElement>("button, .clickable-icon"))
            .find((element) => {
                const text = element.textContent?.trim();
                return text === "Add secret..." || text === "Add secret…";
            }) ?? null;
    }

    private findSecretPickerModal(): HTMLElement | null {
        return Array.from(document.querySelectorAll<HTMLElement>("body.pa-settings-tab-open .modal"))
            .reverse()
            .find((modal) => Array.from(modal.querySelectorAll<HTMLElement>(".suggestion-item")).some((row) => this.isSecretPickerRow(row))) ?? null;
    }

    private prefillAddSecretModal(secretId: string, secretValue: string, attempt: number): void {
        const maxAttempts = 12;
        const modal = this.findAddSecretModal();
        if (modal) {
            const inputs = Array.from(modal.querySelectorAll<HTMLInputElement>("input"));
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
            new Notice(`Opened Add secret. Enter ${secretId} and update the secret value.`, 5000);
            return;
        }
        window.setTimeout(() => this.prefillAddSecretModal(secretId, secretValue, attempt + 1), 100);
    }

    private findAddSecretModal(): HTMLElement | null {
        return Array.from(document.querySelectorAll<HTMLElement>("body .modal"))
            .reverse()
            .find((modal) => {
                const title = modal.querySelector("h1, h2, h3, .modal-title")?.textContent?.trim();
                const inputs = modal.querySelectorAll("input");
                const hasSecretIdInput = Array.from(inputs).some((input) => input.placeholder === "secret-name");
                return inputs.length >= 2 && (hasSecretIdInput || title === "Add secret" || title === "Edit secret");
            }) ?? null;
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
        const legacySecretId = plugin.getLegacyAPITokenSecretId();
        const existing = app.secretStorage.getSecret(secretId)
            || app.secretStorage.getSecret(legacySecretId)
            || "";

        class ApiTokenSecretModal extends Modal {
            onOpen(): void {
                const { contentEl } = this;
                contentEl.empty();
                contentEl.addClass("pa-api-token-secret-modal");
                contentEl.createEl("h2", { text: existing ? "Edit API token" : "Add API token" });

                new Setting(contentEl)
                    .setName("ID")
                    .setDesc("Vault-scoped secret ID used by Personal Assistant.")
                    .addText((text) => {
                        text.setValue(secretId);
                        text.inputEl.readOnly = true;
                        text.inputEl.addClass("pa-secret-edit-id-input");
                    });

                let secretValue = existing;
                let secretInput: HTMLInputElement | null = null;
                let revealed = false;
                const secretSetting = new Setting(contentEl)
                    .setName("Secret")
                    .setDesc("Stored in your OS keychain. Leave empty and save to remove it.")
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
                        .setTooltip("Show secret")
                        .onClick(() => {
                            if (!secretInput) {
                                return;
                            }
                            revealed = !revealed;
                            secretInput.type = revealed ? "text" : "password";
                            button.setIcon(revealed ? "eye" : "eye-off");
                            button.setTooltip(revealed ? "Hide secret" : "Show secret");
                        });
                });

                new Setting(contentEl)
                    .addButton((button) => {
                        button
                            .setButtonText("Save")
                            .setCta()
                            .onClick(async () => {
                                const value = secretValue.trim();
                                if (value === "") {
                                    if (!existing) {
                                        this.close();
                                        return;
                                    }
                                    const confirmed = await confirmUserAction(app, {
                                        title: "Remove API token?",
                                        message: "This will remove the API token stored in your OS keychain for Personal Assistant. Existing notes and settings are not changed.",
                                        confirmText: "Remove token",
                                        cancelText: "Keep token",
                                    });
                                    if (!confirmed) {
                                        return;
                                    }
                                    app.secretStorage.setSecret(secretId, "");
                                    app.secretStorage.setSecret(legacySecretId, "");
                                    plugin.clearTokenCache();
                                    this.close();
                                    return;
                                }
                                app.secretStorage.setSecret(secretId, value);
                                if (legacySecretId !== secretId) {
                                    app.secretStorage.setSecret(legacySecretId, "");
                                }
                                plugin.clearTokenCache();
                                this.close();
                                new Notice("API token saved.", 3000);
                            });
                    })
                    .addButton((button) => {
                        button
                            .setButtonText("Cancel")
                            .onClick(() => this.close());
                    });

                window.setTimeout(() => {
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

        const root = (maybeContainer.closest?.(".setting-item") as HTMLElement | null) ?? container;
        const maybeRoot = root as HTMLElement & {
            querySelectorAll?: HTMLElement["querySelectorAll"];
        };
        if (typeof maybeRoot.querySelectorAll !== "function") {
            return;
        }

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
            const candidates = Array.from(maybeRoot.querySelectorAll<HTMLElement>(
                "button, .clickable-icon, .setting-item-control *",
            ));
            let renamed = false;
            candidates.forEach((element) => {
                const text = element.textContent?.trim();
                if (text !== "Link..." && text !== "Link…") {
                    return;
                }
                const button = element.closest("button") as HTMLElement | null ?? element;
                const setText = (button as HTMLElement & { setText?: (value: string) => void }).setText;
                if (setText) {
                    setText.call(button, "Keychain");
                } else {
                    button.textContent = "Keychain";
                }
                (button as HTMLElement & { addClass?: (cls: string) => void }).addClass?.("pa-api-token-keychain-button");
                (button as HTMLElement & { setAttr?: (name: string, value: string) => void }).setAttr?.("aria-label", "Open Keychain");
                (button as HTMLElement & { setAttr?: (name: string, value: string) => void }).setAttr?.("title", "Open Keychain");
                button.classList.add("pa-api-token-keychain-button");
                button.setAttribute("aria-label", "Open Keychain");
                button.setAttribute("title", "Open Keychain");
                bindKeychainButton(button);
                renamed = true;
            });
            const keychainButtons = candidates.filter((element) => element.textContent?.trim() === "Keychain");
            keychainButtons.forEach((element) => bindKeychainButton(element.closest("button") as HTMLElement | null ?? element));
            return renamed || keychainButtons.length > 0;
        };

        rename();
        [0, 50, 150, 300, 600].forEach((delay) => {
            window.setTimeout(rename, delay);
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
        window.setTimeout(() => observer.disconnect(), 1500);
    }

    private renderHeader(parentEl: HTMLElement): void {
        parentEl.createEl('h1', { text: 'Settings for Obsidian Assistant' });
        const link = document.createElement("a");
        link.setText("Open GitHub repository");
        link.href = "https://github.com/edonyzpc/personal-assistant";
        link.setAttr("style", "font-style: italic;");
        parentEl.createEl("p", { text: "Obsidian Assistant by Shadow Walker, " }).appendChild(link);
    }

    private renderRecordSection(parentEl: HTMLElement): void {
        const plugin = this.plugin;
        // settiong options for recording
        parentEl.createEl('h2', { text: 'Settings for Record' });
        parentEl.createEl("p", { text: "Obsidian Management for Recording in Specific Path" }).setAttr("style", "font-size:14px");
        new Setting(parentEl).setName('Target Path')
            .setDesc('Target directory to do recording')
            .addText(text => text
                .setPlaceholder('.')
                .setValue(plugin.settings.targetPath)
                .onChange((value) => {
                    this.log('target path: ' + value);
                    plugin.settings.targetPath = value;
                    this.debouncedSave();
                }));
        const desc_format = document.createDocumentFragment();
        desc_format.createEl('p', undefined, (p) => {
            p.innerText = "File format which is like Diary setting.\nFor more syntax details, ";
            p.createEl('a', undefined, (link) => {
                link.innerText = 'please check moment format.';
                link.href = 'https://momentjs.com/docs/#/displaying/format/';
            });
        });
        new Setting(parentEl).setName('File Format')
            .setDesc(desc_format)
            .addText(text => text.setPlaceholder('YYYY-MM-DD')
                .setValue(plugin.settings.fileFormat)
                .onChange((value) => {
                    this.log('format setting: ' + value);
                    plugin.settings.fileFormat = value;
                    this.debouncedSave();
                }));
        new Setting(parentEl).setName("Preview Number")
            .setDesc("File numbers to preview")
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
        parentEl.createEl('h2', { text: 'Settings for Hover Local Graph' });
        parentEl.createEl("p", { text: "Obsidian Management for Hover Local Graph" }).setAttr("style", "font-size:14px");
        new Setting(parentEl).setName('Type')
            .setDesc('Type of hover')
            .addText(text => {
                text.setPlaceholder('popover')
                    .setValue(plugin.settings.localGraph.type)
                    .onChange((value) => {
                        plugin.settings.localGraph.type = value;
                        this.debouncedSave();
                    })
            });
        new Setting(parentEl).setName('Depth')
            .setDesc('Depth of link jumps')
            .addText(text => {
                text.setPlaceholder('2')
                    .setValue(plugin.settings.localGraph.depth.toString())
                    .onChange((value) => {
                        plugin.settings.localGraph.depth = safeParseInt(value, plugin.settings.localGraph.depth, 1, LOCAL_GRAPH_DEPTH_MAX);
                        this.debouncedSave();
                    })
            });
        new Setting(parentEl).setName('Show Tags')
            .setDesc('Show tags in local graph view')
            .addToggle(toggle => {
                toggle.setValue(plugin.settings.localGraph.showTags)
                    .onChange(async (value) => {
                        plugin.settings.localGraph.showTags = value;
                        await plugin.saveSettings();
                    })
            });
        new Setting(parentEl).setName('Show Attachment')
            .setDesc('Show attachments in local graph view')
            .addToggle(toggle => {
                toggle.setValue(plugin.settings.localGraph.showAttach)
                    .onChange(async (value) => {
                        plugin.settings.localGraph.showAttach = value;
                        await plugin.saveSettings();
                    })
            });
        new Setting(parentEl).setName('Show Neighbor')
            .setDesc('Show neighbors in local graph view')
            .addToggle(toggle => {
                toggle.setValue(plugin.settings.localGraph.showNeighbor)
                    .onChange(async (value) => {
                        plugin.settings.localGraph.showNeighbor = value;
                        await plugin.saveSettings();
                    })
            });
        new Setting(parentEl).setName('Collapse')
            .setDesc('Collapse local graph view setting')
            .addToggle(toggle => {
                toggle.setValue(plugin.settings.localGraph.collapse)
                    .onChange(async (value) => {
                        plugin.settings.localGraph.collapse = value;
                        await plugin.saveSettings();
                    })
            });
        new Setting(parentEl).setName('Auto Local Graph Colors')
            .setDesc('Automatically set colors of local graph view.')
            .addToggle(toggle => {
                toggle.setValue(plugin.settings.localGraph.autoColors).onChange(async value => {
                    plugin.settings.localGraph.autoColors = value;
                    await plugin.saveSettings();
                })
            });
        parentEl.createEl("p", { text: "Graph Resize" }).setAttr("style", "font-size:15px");
        const h = document.createDocumentFragment();
        h.createEl('span', undefined, (p) => {
            p.innerText = "height";
            p.setAttr('style', 'margin:18px');
        });
        const w = document.createDocumentFragment();
        w.createEl('span', undefined, (p) => {
            p.innerText = "width";
            p.setAttr('style', 'margin:18px');
        });
        // Phase 5 will remove these now-unused fragments (kept here verbatim from the original to limit Phase 1 to pure restructuring).
        const t = document.createDocumentFragment();
        t.createEl('span', undefined, (p) => {
            p.innerText = "top";
            p.setAttr('style', 'margin:18px');
        });
        const l = document.createDocumentFragment();
        l.createEl('span', undefined, (p) => {
            p.innerText = "left";
            p.setAttr('style', 'margin:18px');
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
        parentEl.createEl('h2', { text: 'Graph Colors' });
        new Setting(parentEl).setName('Enable Graph Colors')
            .setDesc('Use personal assistant set colors of graph view.')
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
        // Tear down old Pickers before discarding their DOM hosts.
        this.destroyPickers();
        this.graphColorsContainer.empty();

        const plugin = this.plugin;
        if (!plugin.settings.enableGraphColors) return;

        const container = this.graphColorsContainer;
        // deep copy setting.colorGroups for rendering
        const colorGroups: { query: string, color: { a: number, rgb: number } }[] = JSON.parse(JSON.stringify(plugin.settings.colorGroups));
        colorGroups.forEach((colorGroup) => {
            // find if the item is exist in plugin.settings
            const index = this.findGraphColor(colorGroup);
            const color = `#${colorGroup.color.rgb.toString(16)}`;
            const hexToRGB = (hex: string) => {
                const r = parseInt(hex.slice(1, 3), 16);
                const g = parseInt(hex.slice(3, 5), 16);
                const b = parseInt(hex.slice(5, 7), 16);
                return "rgb(" + r + ", " + g + ", " + b + ")";
            };
            const colorRgb = hexToRGB(color);
            const nameEl = document.createDocumentFragment();
            nameEl.createSpan({ text: "●", attr: { style: `color: ${color}` } });
            nameEl.appendText(` Color for #${colorGroup.query}`);
            new Setting(container)
                .setName(nameEl)
                .setDesc('This will be the Color used in the graph view.')
                .addText(text => {
                    text.setValue(plugin.settings.colorGroups[index].query)
                        .onChange((value) => {
                            if (index > -1) {
                                plugin.settings.colorGroups[index].query = value;
                                this.debouncedSave();
                            }
                        })
                })
                .addButton(btn => {
                    btn.setButtonText("Change Color");
                    const picker = new Picker({
                        parent: btn.buttonEl,
                        onDone: async (color) => {
                            // hex format color: #00000000, [0] '#', [1-6] rgb, [7-8] alpha
                            let hexColor = color.hex.split('#')[1];
                            this.log(`origin hex color = ${hexColor}`);
                            // only get the color value without alpha, obsidian set alpha as 0xff by default
                            if (hexColor.length === 8) {
                                hexColor = hexColor.substring(0, 6);
                            }
                            this.log(`hexColor without alpha ${hexColor}`);
                            if (index > -1) {
                                plugin.settings.colorGroups[index].color.rgb = parseInt(hexColor, 16);
                                await plugin.saveSettings();
                                this.rebuildGraphColors();
                            }
                        },
                        popup: "left",
                        color: colorRgb,
                        alpha: false,
                    });
                    this.activePickers.push(picker);
                })
                .addExtraButton(btn => {
                    btn.setIcon("trash").setTooltip("Remove").onClick(async () => {
                        if (index > -1) {
                            this.log("removing color group", plugin.settings.colorGroups[index]);
                            plugin.settings.colorGroups.splice(index, 1);
                        }
                        await plugin.saveSettings();
                        this.rebuildGraphColors();
                    });
                })
                .addExtraButton(btn => {
                    btn.setIcon("reset").setTooltip("Reset to default").onClick(async () => {
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
                btn.setButtonText("Add Color").onClick(async () => {
                    this.log("adding new color");
                    plugin.settings.colorGroups.push(JSON.parse(JSON.stringify(DEFAULT_GRAPH_COLOR)));
                    await plugin.saveSettings();
                    this.rebuildGraphColors();
                })
            });
    }

    private renderMetadataSection(parentEl: HTMLElement): void {
        const plugin = this.plugin;
        // setting options for updating metadata
        parentEl.createEl('h2', { text: 'Metadata Management' });
        const descFormat = document.createDocumentFragment();
        descFormat.createEl('p', undefined, (p) => {
            p.innerText = "Auto updating metadata in frontmatter when file is modified.\nTimestamp format follows `moment.js` and syntax details, ";
            p.createEl('a', undefined, (link) => {
                link.innerText = 'please check moment format.';
                link.href = 'https://momentjs.com/docs/#/displaying/format/';
            });
        });
        new Setting(parentEl).setName('Enable Updating Metadata')
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
        const nameEl1 = document.createDocumentFragment();
        nameEl1.createSpan({ text: "---" });
        new Setting(container).setName(nameEl1);
        for (let i = 0; i < metas.length; i++) {
            const index = this.findMetadata(metas[i].key);
            const nameEl = document.createDocumentFragment();
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
                    btn.setIcon("trash").setTooltip("Remove").onClick(async () => {
                        if (index > -1) {
                            this.log("removing metadata rule", plugin.settings.metadatas[index]);
                            plugin.settings.metadatas.splice(index, 1);
                        }
                        await plugin.saveSettings();
                        this.rebuildMetadataList();
                    });
                })
        }
        const nameEl2 = document.createDocumentFragment();
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
            .setName("Add Key:Value in frontmatter")
            .setDesc('Value only supports formatted timestamp and regular string.')
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
                dropDown.addOption('string', 'Regular string');
                dropDown.addOption('moment', 'Formatted timestamp');
                dropDown.setValue(t);
                dropDown.onChange(async (value) => {
                    t = value;
                });
            })
            .addButton(btn => {
                btn.setButtonText("Add").onClick(async () => {
                    const trimmedKey = key.trim();
                    if (!trimmedKey) {
                        new Notice("Frontmatter key is required.", 4000);
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
        new Setting(container).setName("Meta Updating Exclude Path")
            .setDesc("Exclude files in the directory to update metadata")
            .addText(text => {
                text.setPlaceholder('path strings with comma as separator, e.g. `tmp/,notes/templates`')
                    .setValue(plugin.settings.metadataExcludePath.join(','))
                    .onChange((value) => {
                        plugin.settings.metadataExcludePath = value.split(",");
                        this.debouncedSave();
                    })
            });
    }

    private renderStatisticsSection(parentEl: HTMLElement): void {
        const plugin = this.plugin;
        // setting for show statistics
        parentEl.createEl('h2', { text: 'Vault Statistics' });
        new Setting(parentEl).setName("Show Statistics")
            .setDesc("Choose the default statistics dashboard view")
            .addDropdown(dropDown => {
                dropDown.addOption('overview', 'Overview');
                dropDown.addOption('daily', 'Daily Writing');
                dropDown.addOption('growth', 'Growth');
                dropDown.addOption('composition', 'Composition');
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
                    this.app.workspace.revealLeaf(leaf);
                });
            });
        new Setting(parentEl).setName("Sync statistics history across devices")
            .setDesc(STATISTICS_SYNC_SETTING_DESC)
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
                            new Notice("Could not change Statistics sync setting. Your notes are not affected.", 5000);
                        }
                    });
            });
        new Setting(parentEl).setName("Animation").addToggle((cb) =>
            cb.setValue(plugin.settings.animation)
                .onChange((value) => {
                    plugin.settings.animation = value;
                    plugin.saveSettings();
                })
        );

        new Setting(parentEl)
            .setName("Show section word counts")
            .setDesc("Display word counts under each heading while editing.")
            .addToggle((toggle) => {
                toggle
                    .setValue(plugin.settings.displaySectionCounts)
                    .onChange(async (value) => {
                        plugin.settings.displaySectionCounts = value;
                        await plugin.saveSettings();
                    });
            });

        new Setting(parentEl)
            .setName("Count comments in statistics")
            .setDesc("Include text inside HTML and Obsidian comments in word and character counts.")
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
        parentEl.createEl('h2', { text: 'AI Assistant' });
        parentEl.createEl("p", {
            text: 'AI Helper supports Qwen, OpenAI, and other OpenAI-compatible providers.',
            cls: "pa-settings-section-desc",
        });

        new Setting(parentEl).setName("AI Provider")
            .setDesc("Select the AI service provider. Presets fill recommended defaults; you can edit the URL and models after switching.")
            .addDropdown(dropDown => {
                if (!plugin.settings.aiProvider) {
                    dropDown.addOption('', '-- Choose your AI provider --');
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
                                title: "Switch AI provider?",
                                message: value === "custom"
                                    ? "Switching to Custom keeps your current Base URL, chat model, and Memory model so you can edit them manually. Your API token is kept but may need to be replaced."
                                    : "Switching providers replaces your Base URL, chat model, and Memory model with that preset's defaults. You can edit them afterward. Your API token is kept but may need to be replaced.",
                                confirmText: "Switch",
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
                text: "Choose an AI provider above to configure your API token, base URL, and model.",
                cls: "pa-settings-provider-prompt",
            });
            return;
        }

        new Setting(container)
            .setName("API Token")
            .setDesc("Stored securely in your OS keychain (macOS Keychain / iOS Keychain / Windows Credential Manager). Clear the field to remove it.")
            .addComponent((el) => {
                const secret = new SecretComponent(this.app, el);
                const secretId = plugin.getAPITokenSecretId();
                const legacySecretId = plugin.getLegacyAPITokenSecretId();
                const existing = this.app.secretStorage.getSecret(secretId)
                    || this.app.secretStorage.getSecret(legacySecretId);
                if (existing) {
                    secret.setValue(existing);
                }
                this.renameSecretComponentLinkButton(el);
                secret.onChange(async (value: string) => {
                    if (value === "") {
                        const stored = this.app.secretStorage.getSecret(secretId)
                            || this.app.secretStorage.getSecret(legacySecretId);
                        if (!stored) {
                            return;
                        }
                        const confirmed = await confirmUserAction(this.app, {
                            title: "Remove API token?",
                            message: "This will remove the API token stored in your OS keychain for Personal Assistant. Existing notes and settings are not changed.",
                            confirmText: "Remove token",
                            cancelText: "Keep token",
                        });
                        if (!confirmed) {
                            secret.setValue(stored);
                            return;
                        }
                        // SecretStorage exposes only setSecret — writing "" is
                        // the equivalent of clearing the token.
                        this.app.secretStorage.setSecret(secretId, "");
                        this.app.secretStorage.setSecret(legacySecretId, "");
                        plugin.clearTokenCache();
                        return;
                    }
                    this.app.secretStorage.setSecret(secretId, value);
                    plugin.clearTokenCache();
                });
                return secret;
            });

        new Setting(container)
            .setName("Base URL")
            .setDesc("API base URL for the selected provider")
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
            .setName("Chat Model Name")
            .setDesc("Name of the AI model to use")
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
            .setName("Policy model name")
            .setDesc("Optional router model for Memory/WebSearch decisions. Sends your request and explicit context to your AI provider; hidden vault content is not sent. Blank uses local fallback rules.")
            .addText((text) => {
                text.setPlaceholder(plugin.settings.chatModelName || "optional");
                text.setValue(plugin.settings.policyModelName);
                text.onChange((value: string) => {
                    plugin.settings.policyModelName = value.trim();
                    this.debouncedSave();
                });
            });
    }

    private rebuildQwenOptions(): void {
        if (!this.qwenOptionsContainer) return;
        this.qwenOptionsContainer.empty();
        this.refreshQwenResponseOptionAvailability = null;

        const plugin = this.plugin;
        if (plugin.settings.aiProvider !== 'qwen') return;

        const container = this.qwenOptionsContainer;
        const qwenOptionToggles: QwenResponseOptionToggle[] = [];
        container.createEl('h3', { text: 'Qwen response options' });
        const qwenOptionsDescriptionEl = container.createEl("p");
        qwenOptionsDescriptionEl.setAttr("style", "font-size:14px");
        this.refreshQwenResponseOptionAvailability = () => {
            updateQwenResponseOptionAvailability(
                plugin.settings.baseURL,
                qwenOptionsDescriptionEl,
                qwenOptionToggles,
            );
        };

        new Setting(container)
            .setName("Show Qwen model thinking")
            .setDesc("Show the model thinking text returned by DashScope in this chat session. It is not added to the final answer, notes, or Memory.")
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
            .setName("Enable builtin WebSearch tool")
            .setDesc("Allow PA Agent to call the read-only builtin WebSearch tool. Search queries may be sent to DashScope WebSearch MCP and can produce web sources.")
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
        parentEl.createEl('h2', { text: 'Advanced' });
        parentEl.createEl("p", {
            text: "Diagnostics, telemetry, and developer-facing toggles.",
            cls: "pa-settings-section-desc",
        });

        new Setting(parentEl).setName("Debug")
            .setDesc("Print plugin diagnostics to the developer console.")
            .addToggle((cb) =>
                cb.setValue(plugin.settings.debug)
                    .onChange((value) => {
                        plugin.settings.debug = value;
                        plugin.saveSettings();
                    }));

        new Setting(parentEl)
            .setName("Share anonymous capability usage")
            .setDesc("Share local PA Agent usage events for capability invoked, failed, skipped, or unavailable states. Events do not include prompts, note text, observations, or vault paths.")
            .addToggle((toggle) => {
                toggle
                    .setValue(plugin.settings.shareAnonymousCapabilityUsage)
                    .onChange(async (value) => {
                        plugin.settings.shareAnonymousCapabilityUsage = value;
                        await plugin.saveSettings();
                    });
            });
    }

    private renderSkillsSection(parentEl: HTMLElement): void {
        const plugin = this.plugin;
        parentEl.createEl('h3', { text: 'Skill guides' });
        parentEl.createEl("p", {
            text: "Let the assistant use bundled read-only skill guides for Obsidian formats and vault review tasks.",
        }).setAttr("style", "font-size:14px");

        new Setting(parentEl)
            .setName("Use skill guides")
            .setDesc("Skill guides add bounded reference context to chat answers. They do not add tools, write notes, run commands, or change Memory.")
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
        parentEl.createEl('h2', { text: 'Memory' });
        parentEl.createEl("p", {
            text: "Let the assistant use memory from your notes when answering.",
        }).setAttr("style", "font-size:15px");

        new Setting(parentEl)
            .setName("Use memory from my notes")
            .setDesc("The assistant asks before preparing Memory. After you approve and Memory is ready, changed notes may update in the background while the app is open.")
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
            .setName("Ask before using AI credits")
            .setDesc("The assistant will ask for your approval before preparing or updating Memory, which uses API calls.")
            .addToggle((toggle) => {
                toggle
                    .setValue(plugin.settings.memoryAutoCheckBeforeChat)
                    .onChange(async (value) => {
                        plugin.settings.memoryAutoCheckBeforeChat = value;
                        await plugin.saveSettings();
                    });
            });

        new Setting(container)
            .setName("Advanced memory controls")
            .setDesc("Show maintenance and diagnostic controls for the local memory copy.")
            .addToggle((toggle) => {
                toggle
                    .setValue(plugin.settings.showAdvancedMemoryControls)
                    .onChange(async (value) => {
                        plugin.settings.showAdvancedMemoryControls = value;
                        await plugin.saveSettings();
                        this.rebuildMemoryAdvanced();
                    });
            });

        this.memoryAdvancedContainer = container.createDiv();
        this.rebuildMemoryAdvanced();
    }

    private rebuildMemoryAdvanced(): void {
        if (!this.memoryAdvancedContainer) return;
        this.memoryAdvancedContainer.empty();
        const plugin = this.plugin;
        if (!plugin.settings.showAdvancedMemoryControls) return;

        const container = this.memoryAdvancedContainer;

        new Setting(container)
            .setName("Keep memory updated in background")
            .setDesc("After memory has been prepared, update changed notes automatically while the app is open. Changed note text may be sent to your configured AI provider.")
            .addToggle((toggle) => {
                toggle
                    .setValue(plugin.settings.memoryApprovalPolicy === "auto-refresh-after-prepare")
                    .onChange(async (value) => {
                        if (value) {
                            const confirmed = await confirmUserAction(this.app, {
                                title: "Keep memory updated in background?",
                                message: "Your notes will not be changed or deleted. Changed note text may be sent to your configured AI provider to prepare Memory. AI credits or API calls may be used; unchanged notes are skipped when possible.",
                                confirmText: "Keep updated",
                            });
                            if (!confirmed) {
                                toggle.setValue(false);
                                return;
                            }
                        }
                        plugin.settings.memoryApprovalPolicy = value ? "auto-refresh-after-prepare" : "always";
                        await plugin.saveSettings();
                        if (value) {
                            plugin.memoryManager.scheduleReconcile("settings");
                            plugin.memoryManager.scheduleAutoFlush("settings");
                        }
                    });
            });

        new Setting(container)
            .setName("Memory model")
            .setDesc("Advanced: model used to prepare memory from notes.")
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
            .setName("Update memory now")
            .setDesc("Update memory for changed notes.")
            .addButton((button) => {
                button.setButtonText("Update").onClick(async () => {
                    await plugin.memoryManager.updateFromCommand();
                    await plugin.updateMemoryStatusBar();
                });
            });

        new Setting(container)
            .setName("Rebuild memory on this device")
            .setDesc("Prepare memory again for this device. Your notes will not be changed or deleted.")
            .addButton((button) => {
                button.setButtonText("Rebuild").onClick(async () => {
                    await plugin.memoryManager.prepareFromCommand();
                });
            });

        new Setting(container)
            .setName("Reset local memory copy")
            .setDesc("Remove this device's local memory copy. Your notes will not be deleted.")
            .addButton((button) => {
                button.setButtonText("Reset").onClick(async () => {
                    const confirmed = await confirmUserAction(this.app, {
                        title: "Reset local memory copy?",
                        message: "Your notes will not be changed or deleted. This device may need to prepare Memory again before using it.",
                        confirmText: "Reset",
                    });
                    if (!confirmed) return;
                    await plugin.vss.resetLocalIndex();
                    await plugin.updateMemoryStatusBar();
                });
            });

        new Setting(container)
            .setName("Delete old Memory cache files")
            .setDesc("Delete old Memory cache files after Memory is ready. Your notes will not be deleted.")
            .addButton((button) => {
                button.setButtonText("Delete").onClick(async () => {
                    await plugin.vss.cleanLegacyJsonCache();
                    await plugin.updateMemoryStatusBar();
                });
            });

        new Setting(container)
            .setName("Show technical memory status")
            .setDesc("Diagnostic details for troubleshooting.")
            .addButton((button) => {
                button.setButtonText("Show").onClick(async () => {
                    await plugin.showTechnicalMemoryStatus();
                });
            });

        new Setting(container).setName("Memory Exclude Path")
            .setDesc("Exclude note folders from memory. Separate paths with commas.")
            .addText(text => {
                text.setPlaceholder('tmp/,notes/templates')
                    .setValue(plugin.settings.vssCacheExcludePath.join(','))
                    .onChange((value) => {
                        plugin.settings.vssCacheExcludePath = value.split(",").map((path) => path.trim()).filter(Boolean);
                        this.debouncedSave();
                    })
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
            .setName("AI Featured Image Path")
            .setDesc("AI feautured image helper will download the images and save them to this path.")
            .addText((text) => {
                text.setPlaceholder("9.src");
                text.setValue(plugin.settings.featuredImagePath.toString());
                text.onChange((value: string) => {
                    plugin.settings.featuredImagePath = value;
                    this.debouncedSave();
                });
            });
        new Setting(container).setName("AI Featured Images Generating Number")
            .setDesc("The number of images to generate when using AI Featured Image Helper.")
            .addText(text => {
                text.setPlaceholder('2')
                    .setValue(plugin.settings.numFeaturedImages.toString())
                    .onChange((value) => {
                        plugin.settings.numFeaturedImages = safeParseInt(value, plugin.settings.numFeaturedImages, 1, FEATURED_IMAGE_COUNT_MAX);
                        this.debouncedSave();
                    })
            });
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
