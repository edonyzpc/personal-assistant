/* Copyright 2023 edonyzpc */

import { App, Modal, Notice, PluginSettingTab, SecretComponent, Setting, debounce, setIcon } from "obsidian";

import type { PluginManager } from "./plugin"
import { BUNDLED_SKILL_CATALOG, BUNDLED_SKILL_IDS } from "./ai-services/bundled-skill-catalog";
import { getDashScopeImageGenerationEndpoint, isDashScopeCompatibleBaseURL } from "./ai-services/ai-utils";
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
import {
    QUICK_CAPTURE_DEFAULTS,
    mergeQuickCaptureSettings,
    normalizeQuickCaptureDestination,
    normalizeQuickCaptureInboxPath,
    type QuickCaptureSettings,
} from "./quick-capture";
import { normalizeReviewQueueState, type ReviewQueueItem } from "./pa/review-queue-store";
import {
    normalizeMemoryGovernanceState,
    type ConfirmedMemoryRecord,
} from "./pa/memory-governance-store";
import { getMemoryTrustLevel } from "./pa/memory-trust-level";
import type {
    MemoryControlCenterEffect,
    MemoryControlCenterItem,
    MemoryControlCenterLifecycle,
    MemoryControlCenterOrigin,
    MemoryControlCenterSnapshot,
} from "./pa/memory-control-center";
import {
    normalizeMaintenanceMoveActionLog,
    type MaintenanceMoveActionLogEntry,
} from "./pa/maintenance-review-apply";
import {
    normalizeSavedInsightState,
    type SavedInsight,
} from "./pa/saved-insight-store";
import {
    normalizeRetrievalHabitProfileSettings,
    RETRIEVAL_HABIT_PROFILE_DEFAULTS,
    type RetrievalHabitProfileSettings,
} from "./pa/retrieval-habit-profile";
import {
    DATA_CLEANUP_GROUPS,
    DEFAULT_DATA_BOUNDARY_POLICY,
    PROVIDER_DISCLOSURE_REASONS,
    type DataCleanupGroup,
    type GeneratedNotePolicy,
    type ProviderDisclosureReason,
} from "./pa/contracts";

export interface ResizeStyle {
    width: number,
    height: number,
}

export type FeaturedImageModel = "wan2.7-image" | "wan2.7-image-pro";

const FEATURED_IMAGE_MODELS: readonly FeaturedImageModel[] = [
    "wan2.7-image",
    "wan2.7-image-pro",
];
const FEATURED_IMAGE_COUNT_MAX = 4;

export interface DataBoundarySettings {
    excludedFolders: string[];
    excludedTags: string[];
    generatedNotePolicy: GeneratedNotePolicy;
    providerDisclosureReasons: ProviderDisclosureReason[];
    cleanupGroups: DataCleanupGroup[];
}

export interface ReviewQueueSettings {
    enabled: boolean;
    items: ReviewQueueItem[];
}

export const REVIEW_QUEUE_DEFAULTS: Readonly<ReviewQueueSettings> = Object.freeze({
    enabled: true,
    items: [],
});

export interface ContextPagerSettings {
    enabled: boolean;
}

export const CONTEXT_PAGER_DEFAULTS: Readonly<ContextPagerSettings> = Object.freeze({
    enabled: true,
});

export interface SavedInsightSettings {
    items: SavedInsight[];
}

export const SAVED_INSIGHT_DEFAULTS: Readonly<SavedInsightSettings> = Object.freeze({
    items: [],
});

export interface MemoryGovernanceSettings {
    records: ConfirmedMemoryRecord[];
}

export const MEMORY_GOVERNANCE_DEFAULTS: Readonly<MemoryGovernanceSettings> = Object.freeze({
    records: [],
});

export interface MaintenanceReviewSettings {
    weeklyScanEnabled: boolean;
    actionLog: MaintenanceMoveActionLogEntry[];
}

export const MAINTENANCE_REVIEW_DEFAULTS: Readonly<MaintenanceReviewSettings> = Object.freeze({
    weeklyScanEnabled: false,
    actionLog: [],
});

/** @deprecated Weekly Review is retired as a standalone runtime feature. */
export interface WeeklyReviewSettings {
    enabled: boolean;
    preparedReviewEnabled: boolean;
}

/** @deprecated Kept only to preserve existing persisted settings. */
export const WEEKLY_REVIEW_DEFAULTS: Readonly<WeeklyReviewSettings> = Object.freeze({
    enabled: true,
    preparedReviewEnabled: false,
});

/** SG-01: Off/On two-tier, no frequency cap. */
export type QuietRecallMode = "off" | "on";

export interface QuietRecallSettings {
    enabled: boolean;
    /** @deprecated Use quietRecallMode instead. Kept for migration. */
    bubbleNudgesEnabled: boolean;
    /** SG-01: User-facing Off/On toggle. Default "off". */
    quietRecallMode: QuietRecallMode;
}

export const QUIET_RECALL_DEFAULTS: Readonly<QuietRecallSettings> = Object.freeze({
    enabled: true,
    bubbleNudgesEnabled: false,
    quietRecallMode: "off",
});

export const DATA_BOUNDARY_DEFAULTS: Readonly<DataBoundarySettings> = Object.freeze({
    excludedFolders: [...DEFAULT_DATA_BOUNDARY_POLICY.excludedFolders],
    excludedTags: [...DEFAULT_DATA_BOUNDARY_POLICY.excludedTags],
    generatedNotePolicy: DEFAULT_DATA_BOUNDARY_POLICY.generatedNotePolicy,
    providerDisclosureReasons: [...PROVIDER_DISCLOSURE_REASONS],
    cleanupGroups: [...DATA_CLEANUP_GROUPS],
});

export interface MemoryExtractionConsentSettings {
    state: "unconfirmed" | "confirmed" | "paused";
    version: 1;
    confirmedAt?: string;
}

export const MEMORY_EXTRACTION_CONSENT_VERSION = 1;

export const MEMORY_EXTRACTION_CONSENT_DEFAULTS: Readonly<MemoryExtractionConsentSettings> = Object.freeze({
    state: "unconfirmed",
    version: MEMORY_EXTRACTION_CONSENT_VERSION,
});

const DATA_BOUNDARY_CLEANUP_LABEL_KEYS: Record<DataCleanupGroup, PluginMessageKey> = {
    cache: "plugin.settings.dataBoundary.cleanup.cache.name",
    queue: "plugin.settings.dataBoundary.cleanup.queue.name",
    replay: "plugin.settings.dataBoundary.cleanup.replay.name",
    candidates: "plugin.settings.dataBoundary.cleanup.candidates.name",
    confirmed_memory: "plugin.settings.dataBoundary.cleanup.confirmedMemory.name",
    tombstones: "plugin.settings.dataBoundary.cleanup.tombstones.name",
};


export function normalizeFeaturedImageModel(value: unknown): FeaturedImageModel {
    return FEATURED_IMAGE_MODELS.includes(value as FeaturedImageModel)
        ? value as FeaturedImageModel
        : "wan2.7-image";
}

export function normalizeFeaturedImageCount(value: unknown): number {
    const numericValue = typeof value === "number"
        ? value
        : typeof value === "string" && value.trim() !== ""
            ? Number(value)
            : Number.NaN;

    if (!Number.isFinite(numericValue)) {
        return 1;
    }

    return Math.min(Math.max(Math.floor(numericValue), 1), FEATURED_IMAGE_COUNT_MAX);
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
    confirmedMemoryCount: number;
    /** User-controlled pause for Level 2 automatic Memory; trust count remains monotonic. */
    memoryAutoAcceptPaused: boolean;
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
    featuredImageModel: FeaturedImageModel;
    numFeaturedImages: number;
    memoryExtractionEnabled: boolean;
    memoryExtractionNoticeDismissed: boolean;
    memoryExtractionIncludeVaultInsights: boolean;
    memoryExtractionConsent: MemoryExtractionConsentSettings;
    vssCacheExcludePath: string[];
    /** Operations Agent mode (Beta): enable AI to append content to the active note. */
    operationsAgentEnabled: boolean;
    /** Low-friction raw note capture. AI post-processing stays disabled until its slice is complete. */
    quickCapture: QuickCaptureSettings;
    /** Shared Data Boundary policy for source selection and provider disclosure. */
    dataBoundary: DataBoundarySettings;
    /** Local shared Review Queue state. Stored in plugin data, never Markdown. */
    reviewQueue: ReviewQueueSettings;
    /** User-readable read-only trace of sources and memories used for a run. */
    contextPager: ContextPagerSettings;
    /** Local Saved Insight ledger state. */
    savedInsights: SavedInsightSettings;
    /** Local Confirmed Memory governance shell state. */
    memoryGovernance: MemoryGovernanceSettings;
    /** Pagelet Maintenance Review preview shell. Weekly scans remain disabled until approved. */
    maintenanceReview: MaintenanceReviewSettings;
    /** Manual Weekly Review loop. Prepared weekly review remains opt-in. */
    weeklyReview: WeeklyReviewSettings;
    /** Quiet Recall surfaces. Bubble nudges remain disabled until the later slice. */
    quietRecall: QuietRecallSettings;
    /** Last structure-based cross-note pattern detection run timestamp. */
    lastPatternDetectionAt?: string;
    /** Global Focus Mode: suppress all PA-initiated proactive behavior. */
    focusMode: boolean;
    /** Opt-in local aggregate recall feedback profile. */
    retrievalHabitProfile: RetrievalHabitProfileSettings;
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
    confirmedMemoryCount: 0,
    memoryAutoAcceptPaused: false,
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
    featuredImageModel: "wan2.7-image",
    numFeaturedImages: 1,
    memoryExtractionEnabled: false,
    memoryExtractionNoticeDismissed: false,
    memoryExtractionIncludeVaultInsights: false,
    memoryExtractionConsent: { ...MEMORY_EXTRACTION_CONSENT_DEFAULTS },
    // Generic default — the prior list ("8.template", "9.src", "a.subjects",
    // "b.notion") was the original developer's vault layout and made no sense
    // as a fresh-install default. mergeLoadedSettings preserves any persisted
    // value, so existing users keep their configured exclusions.
    vssCacheExcludePath: [LEGACY_CONFIG_DIR],
    operationsAgentEnabled: false,
    quickCapture: { ...QUICK_CAPTURE_DEFAULTS },
    dataBoundary: {
        excludedFolders: [...DATA_BOUNDARY_DEFAULTS.excludedFolders],
        excludedTags: [...DATA_BOUNDARY_DEFAULTS.excludedTags],
        generatedNotePolicy: DATA_BOUNDARY_DEFAULTS.generatedNotePolicy,
        providerDisclosureReasons: [...DATA_BOUNDARY_DEFAULTS.providerDisclosureReasons],
        cleanupGroups: [...DATA_BOUNDARY_DEFAULTS.cleanupGroups],
    },
    reviewQueue: {
        enabled: REVIEW_QUEUE_DEFAULTS.enabled,
        items: [],
    },
    contextPager: {
        enabled: CONTEXT_PAGER_DEFAULTS.enabled,
    },
    savedInsights: {
        items: [],
    },
    memoryGovernance: {
        records: [],
    },
    maintenanceReview: {
        weeklyScanEnabled: MAINTENANCE_REVIEW_DEFAULTS.weeklyScanEnabled,
        actionLog: [],
    },
    weeklyReview: { ...WEEKLY_REVIEW_DEFAULTS },
    quietRecall: { ...QUIET_RECALL_DEFAULTS },
    lastPatternDetectionAt: undefined,
    focusMode: false,
    retrievalHabitProfile: {
        enabled: RETRIEVAL_HABIT_PROFILE_DEFAULTS.enabled,
        state: { aggregates: [] },
    },
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

export function normalizeConfirmedMemoryCount(value: unknown): number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
        ? value
        : DEFAULT_SETTINGS.confirmedMemoryCount;
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
    merged.confirmedMemoryCount = normalizeConfirmedMemoryCount(loadedObject.confirmedMemoryCount);
    merged.memoryAutoAcceptPaused = typeof loadedObject.memoryAutoAcceptPaused === "boolean"
        ? loadedObject.memoryAutoAcceptPaused
        : DEFAULT_SETTINGS.memoryAutoAcceptPaused;
    merged.featuredImageModel = normalizeFeaturedImageModel(loadedObject.featuredImageModel);
    merged.numFeaturedImages = normalizeFeaturedImageCount(loadedObject.numFeaturedImages);
    // Current builds use a mock paid entitlement so all paid-capability
    // architecture stays enabled until a real authorization source is wired in.
    // Do not trust persisted data.json for this field.
    merged.licenseTier = MOCK_LICENSE_TIER;
    merged.operationsAgentEnabled = OPERATIONS_AGENT_RUNTIME_ENABLED;
    // Pagelet has its own per-field normalizer (8 fields, mixed types).
    // Delegating keeps the legacy merge focused on settings that predate
    // Pagelet and avoids polluting this file with Pagelet-specific bounds.
    merged.pagelet = mergePageletSettings(loadedObject.pagelet);
    merged.quickCapture = mergeQuickCaptureSettings(loadedObject.quickCapture);
    merged.dataBoundary = mergeDataBoundarySettings(loadedObject.dataBoundary);
    merged.reviewQueue = mergeReviewQueueSettings(loadedObject.reviewQueue);
    merged.contextPager = mergeContextPagerSettings(loadedObject.contextPager);
    merged.savedInsights = mergeSavedInsightSettings(loadedObject.savedInsights);
    merged.memoryGovernance = mergeMemoryGovernanceSettings(loadedObject.memoryGovernance);
    merged.maintenanceReview = mergeMaintenanceReviewSettings(loadedObject.maintenanceReview);
    merged.weeklyReview = mergeWeeklyReviewSettings(loadedObject.weeklyReview);
    merged.quietRecall = mergeQuietRecallSettings(loadedObject.quietRecall);
    merged.lastPatternDetectionAt = typeof loadedObject.lastPatternDetectionAt === "string"
        && loadedObject.lastPatternDetectionAt.trim()
        ? loadedObject.lastPatternDetectionAt.trim()
        : undefined;
    merged.focusMode = typeof loadedObject.focusMode === "boolean" ? loadedObject.focusMode : false;
    merged.retrievalHabitProfile = mergeRetrievalHabitProfileSettings(loadedObject.retrievalHabitProfile);
    merged.memoryExtractionConsent = mergeMemoryExtractionConsentSettings(loadedObject.memoryExtractionConsent);
    if (!isMemoryExtractionConsentConfirmed(merged.memoryExtractionConsent)) {
        merged.memoryExtractionEnabled = false;
        merged.memoryExtractionIncludeVaultInsights = false;
    } else {
        merged.memoryExtractionEnabled = typeof loadedObject.memoryExtractionEnabled === "boolean"
            ? loadedObject.memoryExtractionEnabled
            : DEFAULT_SETTINGS.memoryExtractionEnabled;
        merged.memoryExtractionIncludeVaultInsights = typeof loadedObject.memoryExtractionIncludeVaultInsights === "boolean"
            ? loadedObject.memoryExtractionIncludeVaultInsights
            : DEFAULT_SETTINGS.memoryExtractionIncludeVaultInsights;
    }
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
    const normalized = new Set(value
        .filter((entry): entry is string => typeof entry === "string")
        .filter((entry) => knownSkillIds.has(entry)));
    return BUNDLED_SKILL_IDS.filter((id) => normalized.has(id));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeTrimmedStringArray(value: unknown, fallback: string[]): string[] {
    if (!Array.isArray(value)) return [...fallback];
    return [...new Set(value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean))];
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
    if (!Array.isArray(value)) return [...fallback];
    return value.filter((entry): entry is string => typeof entry === "string");
}

function normalizeDataBoundaryGeneratedNotePolicy(value: unknown): GeneratedNotePolicy {
    return value === "exclude-generated" || value === "include-generated"
        ? value as GeneratedNotePolicy
        : DATA_BOUNDARY_DEFAULTS.generatedNotePolicy;
}

function normalizeEnumStringArray<T extends readonly string[]>(
    value: unknown,
    allowed: T,
    fallback: readonly T[number][],
): T[number][] {
    if (!Array.isArray(value)) return [...fallback];
    const allowedSet = new Set<string>(allowed);
    const normalized = value
        .filter((entry): entry is string => typeof entry === "string" && allowedSet.has(entry));
    return [...new Set(normalized)] as T[number][];
}

export function mergeDataBoundarySettings(loaded: unknown): DataBoundarySettings {
    const loadedObject = isRecord(loaded) ? loaded : {};
    return {
        excludedFolders: normalizeTrimmedStringArray(loadedObject.excludedFolders, DATA_BOUNDARY_DEFAULTS.excludedFolders),
        excludedTags: normalizeTrimmedStringArray(loadedObject.excludedTags, DATA_BOUNDARY_DEFAULTS.excludedTags),
        generatedNotePolicy: normalizeDataBoundaryGeneratedNotePolicy(loadedObject.generatedNotePolicy),
        providerDisclosureReasons: normalizeEnumStringArray(
            loadedObject.providerDisclosureReasons,
            PROVIDER_DISCLOSURE_REASONS,
            DATA_BOUNDARY_DEFAULTS.providerDisclosureReasons,
        ),
        cleanupGroups: normalizeEnumStringArray(
            loadedObject.cleanupGroups,
            DATA_CLEANUP_GROUPS,
            DATA_BOUNDARY_DEFAULTS.cleanupGroups,
        ),
    };
}

export function mergeReviewQueueSettings(loaded: unknown): ReviewQueueSettings {
    const loadedObject = isRecord(loaded) ? loaded : {};
    return {
        enabled: typeof loadedObject.enabled === "boolean"
            ? loadedObject.enabled
            : REVIEW_QUEUE_DEFAULTS.enabled,
        items: normalizeReviewQueueState(loadedObject).items,
    };
}

export function mergeContextPagerSettings(loaded: unknown): ContextPagerSettings {
    const loadedObject = isRecord(loaded) ? loaded : {};
    return {
        enabled: typeof loadedObject.enabled === "boolean"
            ? loadedObject.enabled
            : CONTEXT_PAGER_DEFAULTS.enabled,
    };
}

export function mergeSavedInsightSettings(loaded: unknown): SavedInsightSettings {
    return {
        items: normalizeSavedInsightState(loaded).items,
    };
}

export function mergeMemoryGovernanceSettings(loaded: unknown): MemoryGovernanceSettings {
    return {
        records: normalizeMemoryGovernanceState(loaded).records,
    };
}

export function mergeMaintenanceReviewSettings(loaded: unknown): MaintenanceReviewSettings {
    const loadedObject = isRecord(loaded) ? loaded : {};
    return {
        weeklyScanEnabled: typeof loadedObject.weeklyScanEnabled === "boolean"
            ? loadedObject.weeklyScanEnabled
            : MAINTENANCE_REVIEW_DEFAULTS.weeklyScanEnabled,
        actionLog: normalizeMaintenanceMoveActionLog(loadedObject.actionLog),
    };
}

export function mergeWeeklyReviewSettings(loaded: unknown): WeeklyReviewSettings {
    const loadedObject = isRecord(loaded) ? loaded : {};
    return {
        enabled: typeof loadedObject.enabled === "boolean"
            ? loadedObject.enabled
            : WEEKLY_REVIEW_DEFAULTS.enabled,
        preparedReviewEnabled: typeof loadedObject.preparedReviewEnabled === "boolean"
            ? loadedObject.preparedReviewEnabled
            : WEEKLY_REVIEW_DEFAULTS.preparedReviewEnabled,
    };
}

export function mergeQuietRecallSettings(loaded: unknown): QuietRecallSettings {
    const loadedObject = isRecord(loaded) ? loaded : {};
    const bubbleNudgesEnabled = typeof loadedObject.bubbleNudgesEnabled === "boolean"
        ? loadedObject.bubbleNudgesEnabled
        : QUIET_RECALL_DEFAULTS.bubbleNudgesEnabled;
    // SG-01 migration: old bubbleNudgesEnabled: true → "on"; false/missing → "off"
    let quietRecallMode: QuietRecallMode;
    if (loadedObject.quietRecallMode === "on" || loadedObject.quietRecallMode === "off") {
        quietRecallMode = loadedObject.quietRecallMode;
    } else {
        quietRecallMode = bubbleNudgesEnabled ? "on" : "off";
    }
    return {
        enabled: typeof loadedObject.enabled === "boolean"
            ? loadedObject.enabled
            : QUIET_RECALL_DEFAULTS.enabled,
        bubbleNudgesEnabled,
        quietRecallMode,
    };
}

export function mergeRetrievalHabitProfileSettings(loaded: unknown): RetrievalHabitProfileSettings {
    return normalizeRetrievalHabitProfileSettings(loaded);
}

export function mergeMemoryExtractionConsentSettings(loaded: unknown): MemoryExtractionConsentSettings {
    const loadedObject = isRecord(loaded) ? loaded : {};
    const state = loadedObject.state === "confirmed" || loadedObject.state === "paused"
        ? loadedObject.state
        : "unconfirmed";
    const consent: MemoryExtractionConsentSettings = {
        state,
        version: MEMORY_EXTRACTION_CONSENT_VERSION,
    };
    if (state === "confirmed" && typeof loadedObject.confirmedAt === "string" && loadedObject.confirmedAt.trim()) {
        consent.confirmedAt = loadedObject.confirmedAt.trim();
    }
    return consent;
}

export function isMemoryExtractionConsentConfirmed(consent: unknown): consent is MemoryExtractionConsentSettings & { state: "confirmed" } {
    return isRecord(consent)
        && consent.state === "confirmed"
        && consent.version === MEMORY_EXTRACTION_CONSENT_VERSION;
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
    private memoryControlCenterGeneration = 0;
    private pendingMemoryControlCenterTargetId: string | null = null;
    private settingsNavigationButtons = new Map<string, HTMLButtonElement>();
    private settingsNavigationSelect: HTMLSelectElement | null = null;
    private settingsNavigationCount: HTMLElement | null = null;
    private settingsNavigationProgressSegments: HTMLElement[] = [];
    private settingsNavigationGroupIds: string[] = [];
    private settingsNavigationResizeObserver: ResizeObserver | null = null;
    private settingsNavigationMobileOffset = 72;
    private settingsGroupSummaries = new Map<string, HTMLElement>();
    private settingsScrollRoot: HTMLElement | null = null;
    private settingsScrollHandler: (() => void) | null = null;

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
    private hasPendingSettingsSave = false;
    private debouncedSaveRunner = debounce(() => {
        if (!this.hasPendingSettingsSave) return;
        this.hasPendingSettingsSave = false;
        void this.plugin.saveSettings().catch((error) => {
            this.hasPendingSettingsSave = true;
            this.log("Failed to persist delayed Settings changes", error);
        });
    }, 400, true);

    constructor(app: App, plugin: PluginManager) {
        super(app, plugin);
        this.plugin = plugin;
        this.log = (...msg: any) => plugin.log(...msg); // eslint-disable-line @typescript-eslint/no-explicit-any
    }

    openGroup(groupId: string, memoryTargetId?: string): void {
        const normalizedId = groupId.trim();
        if (!normalizedId) return;
        const normalizedTargetId = memoryTargetId?.trim();
        if (normalizedId === "memory-personalization" && normalizedTargetId) {
            this.pendingMemoryControlCenterTargetId = normalizedTargetId;
        }
        const details = this.containerEl.querySelector(`#pa-settings-group-${normalizedId}`);
        if (!details || details.tagName.toLowerCase() !== "details") return;
        (details as HTMLDetailsElement).open = true;
        this.persistGroupCollapseState(normalizedId, false);
        const summary = details.querySelector("summary");
        this.setActiveSettingsGroup(normalizedId);
        this.refreshSettingsNavigationMobileOffset(this.settingsScrollRoot ?? undefined);
        if (summary) {
            this.scrollSettingsSummaryIntoView(
                summary as HTMLElement,
                this.settingsScrollBehavior(),
            );
        }
        if (!normalizedTargetId) {
            (summary as HTMLElement | null)?.focus?.({ preventScroll: true });
        }
        this.settingsNavigationButtons.get(normalizedId)?.setAttr("aria-expanded", "true");
        this.focusPendingMemoryControlCenterTarget(false);
    }

    refreshPageletSettingsIfVisible(): boolean {
        const ownerDocument = (this.containerEl as HTMLElement).ownerDocument;
        if (!ownerDocument?.body?.classList.contains("pa-settings-tab-open")) return false;
        this.display();
        this.openGroup("features");
        return true;
    }

    private t(key: PluginMessageKey, params?: Readonly<Record<string, string | number>>, fallback?: string): string {
        return pluginT(key, getPluginUiLanguage(), params, fallback);
    }

    display(): void {
        const { containerEl } = this;
        const doc = (containerEl as HTMLElement).ownerDocument ?? getPlatformDocument();
        this.memoryControlCenterGeneration += 1;

        this.stopSettingsNavigation();
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

        const shell = containerEl.createDiv({ cls: "pa-settings-shell" });
        this.renderHeader(shell);

        const groups: Array<{ id: string; labelKey: string; sections: Array<(parent: HTMLElement) => void> }> = [
            { id: "ai-provider", labelKey: "plugin.settings.group.aiProvider", sections: [
                (p) => this.renderAISection(p),
                (p) => this.renderSkillsSection(p),
            ] },
            { id: "memory-personalization", labelKey: "plugin.settings.group.memoryPersonalization", sections: [
                (p) => this.renderMemoryControlCenterOverview(p),
                (p) => this.renderMemorySection(p),
            ] },
            { id: "data-privacy", labelKey: "plugin.settings.group.dataPrivacy", sections: [
                (p) => this.renderDataBoundarySection(p),
                (p) => this.renderOperationsAgentSection(p),
            ] },
            { id: "features", labelKey: "plugin.settings.group.features", sections: [
                (p) => this.renderPageletSection(p),
                (p) => this.renderQuickCaptureSection(p),
                (p) => this.renderStatisticsSection(p),
            ] },
            { id: "appearance", labelKey: "plugin.settings.group.appearance", sections: [
                (p) => this.renderRecordSection(p),
                (p) => this.renderGraphSection(p),
                (p) => this.renderGraphColorsSection(p),
                (p) => this.renderMetadataSection(p),
                (p) => this.renderFeaturedImageSection(p),
            ] },
            { id: "system", labelKey: "plugin.settings.group.system", sections: [
                (p) => this.renderAdvancedSection(p),
                (p) => this.renderLegalSection(p),
            ] },
        ];

        const layout = shell.createDiv({ cls: "pa-settings-layout" });
        const nav = layout.createEl("nav", {
            cls: "pa-settings-toc",
            attr: { "aria-label": this.t("plugin.settings.nav.ariaLabel") },
        });
        const content = layout.createDiv({ cls: "pa-settings-content" });
        const jump = content.createDiv({ cls: "pa-settings-jump" });
        const jumpLabel = jump.createEl("label", {
            cls: "pa-settings-jump-label",
            text: this.t("plugin.settings.nav.jumpLabel"),
            attr: { for: "pa-settings-jump-select" },
        });
        const jumpControl = jump.createDiv({ cls: "pa-settings-jump-control" });
        const jumpSelect = jumpControl.createEl("select", {
            cls: ["pa-settings-jump-select", "dropdown"],
            attr: {
                id: "pa-settings-jump-select",
            },
        });
        const jumpCount = jumpControl.createSpan({
            cls: "pa-settings-jump-count",
            text: `1/${groups.length}`,
            attr: { "aria-hidden": "true" },
        });
        const jumpProgress = jump.createDiv({
            cls: "pa-settings-jump-progress",
            attr: { "aria-hidden": "true" },
        });
        this.settingsNavigationSelect = jumpSelect;
        this.settingsNavigationCount = jumpCount;
        this.settingsNavigationGroupIds = groups.map((group) => group.id);
        jumpLabel.setAttr("for", "pa-settings-jump-select");

        for (const group of groups) {
            const detailsId = `pa-settings-group-${group.id}`;
            const summaryId = `pa-settings-nav-target-${group.id}`;
            const details = content.createEl("details", {
                cls: "pa-settings-group",
                attr: { id: detailsId, "aria-labelledby": summaryId },
            });
            (details as HTMLDetailsElement).open = !this.isGroupCollapsed(group.id);
            const summary = details.createEl("summary", {
                cls: "pa-settings-group-summary",
                text: this.t(group.labelKey as never),
                attr: { id: summaryId },
            });
            this.settingsGroupSummaries.set(group.id, summary);
            details.addEventListener("toggle", () => {
                this.persistGroupCollapseState(group.id, !details.open);
                this.settingsNavigationButtons.get(group.id)?.setAttr(
                    "aria-expanded",
                    String(details.open),
                );
            });
            const body = details.createDiv({ cls: "pa-settings-group__body" });
            for (const renderSection of group.sections) {
                renderSection(body);
            }

            const groupLabel = this.t(group.labelKey as never);
            const navItem = nav.createEl("button", {
                cls: "pa-settings-toc-item",
                attr: {
                    type: "button",
                    "aria-label": groupLabel,
                    "aria-controls": detailsId,
                    "aria-current": "false",
                    "aria-expanded": String(details.open),
                },
            });
            navItem.createSpan({
                cls: "pa-settings-toc-item__tick",
                attr: { "aria-hidden": "true" },
            });
            navItem.createSpan({
                cls: "pa-settings-toc-item__label",
                text: groupLabel,
            });
            this.settingsNavigationButtons.set(group.id, navItem);
            navItem.addEventListener("click", () => this.openGroup(group.id));

            jumpSelect.createEl("option", {
                text: groupLabel,
                attr: { value: group.id },
            });
            const progressSegment = jumpProgress.createSpan({
                cls: "pa-settings-jump-progress__segment",
                attr: { "data-current": "false" },
            });
            this.settingsNavigationProgressSegments.push(progressSegment);
        }
        jumpSelect.addEventListener("change", () => this.openGroup(jumpSelect.value));
        this.setActiveSettingsGroup(groups[0]?.id ?? "");
        this.startSettingsNavigation(groups.map((group) => group.id));
        this.startSettingsNavigationOffsetTracking(jump);
        this.markFormControlSettings(containerEl);
        this.startSecretPickerObserver();
    }

    hide(): void {
        // Obsidian invokes hide() when the user closes the settings tab.
        this.stopSettingsNavigation();
        this.stopSecretPickerObserver();
        this.memoryControlCenterGeneration += 1;
        const doc = (this.containerEl as HTMLElement).ownerDocument ?? getPlatformDocument();
        doc.body?.classList.remove("pa-settings-tab-open");
        this.debouncedSaveRunner.cancel();
        if (this.hasPendingSettingsSave) {
            this.hasPendingSettingsSave = false;
            void this.plugin.saveSettings().catch((error) => {
                this.hasPendingSettingsSave = true;
                this.log("Failed to persist Settings changes on close", error);
            });
        }
    }

    private debouncedSave(): void {
        this.hasPendingSettingsSave = true;
        this.debouncedSaveRunner();
    }

    private isGroupCollapsed(groupId: string): boolean {
        try {
            const raw = localStorage.getItem("pa-settings-collapsed");
            if (!raw) return false;
            const state = JSON.parse(raw) as Record<string, boolean>;
            return state[groupId] === true;
        } catch {
            return false;
        }
    }

    private persistGroupCollapseState(groupId: string, collapsed: boolean): void {
        try {
            const raw = localStorage.getItem("pa-settings-collapsed");
            const state: Record<string, boolean> = raw ? JSON.parse(raw) : {};
            if (collapsed) {
                state[groupId] = true;
            } else {
                delete state[groupId];
            }
            localStorage.setItem("pa-settings-collapsed", JSON.stringify(state));
        } catch { /* localStorage unavailable — graceful degradation */ }
    }

    private setActiveSettingsGroup(groupId: string): void {
        if (!groupId) return;
        this.settingsNavigationButtons.forEach((button, id) => {
            button.setAttr("aria-current", id === groupId ? "location" : "false");
        });
        if (this.settingsNavigationSelect) {
            this.settingsNavigationSelect.value = groupId;
        }
        const activeIndex = this.settingsNavigationGroupIds.indexOf(groupId);
        if (activeIndex >= 0) {
            this.settingsNavigationCount?.setText(
                `${activeIndex + 1}/${this.settingsNavigationGroupIds.length}`,
            );
            this.settingsNavigationProgressSegments.forEach((segment, index) => {
                segment.setAttr("data-current", String(index === activeIndex));
            });
        }
    }

    private settingsScrollBehavior(): ScrollBehavior {
        try {
            const win = getPlatformDocument().defaultView;
            return win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
        } catch {
            return "smooth";
        }
    }

    private scrollSettingsSummaryIntoView(
        summary: HTMLElement,
        behavior: ScrollBehavior,
    ): void {
        const root = this.settingsScrollRoot;
        const isMobile = root?.ownerDocument?.body?.classList.contains("is-mobile") === true;
        if (
            !isMobile
            || !root
            || typeof root.scrollTo !== "function"
            || typeof root.getBoundingClientRect !== "function"
            || typeof summary.getBoundingClientRect !== "function"
        ) {
            summary.scrollIntoView?.({ behavior, block: "start" });
            return;
        }
        const rootRect = root.getBoundingClientRect();
        const summaryRect = summary.getBoundingClientRect();
        const top = root.scrollTop
            + summaryRect.top
            - rootRect.top
            - this.settingsNavigationMobileOffset;
        root.scrollTo({ top: Math.max(0, top), behavior });
    }

    private findSettingsScrollRoot(): HTMLElement {
        const { containerEl } = this;
        const verticalTabContent = typeof containerEl.closest === "function"
            ? containerEl.closest<HTMLElement>(".vertical-tab-content")
            : null;
        const verticalTabContainer = typeof containerEl.closest === "function"
            ? containerEl.closest<HTMLElement>(".vertical-tab-content-container")
            : null;
        const candidates = [...new Set([
            verticalTabContent,
            verticalTabContainer,
            containerEl,
        ].filter((candidate): candidate is HTMLElement => Boolean(candidate)))];
        const scrollable = candidates.find((candidate) => {
            if (candidate.scrollHeight > candidate.clientHeight + 1) return true;
            try {
                const overflowY = candidate.ownerDocument.defaultView
                    ?.getComputedStyle(candidate).overflowY;
                return overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
            } catch {
                return false;
            }
        });
        return scrollable ?? verticalTabContent ?? containerEl;
    }

    private startSettingsNavigation(groupIds: string[]): void {
        const scrollRoot = this.findSettingsScrollRoot();
        if (
            typeof scrollRoot.addEventListener !== "function"
            || typeof scrollRoot.removeEventListener !== "function"
            || typeof scrollRoot.getBoundingClientRect !== "function"
        ) {
            return;
        }

        this.settingsScrollRoot = scrollRoot;
        this.settingsScrollHandler = () => this.syncActiveSettingsGroupFromScroll(groupIds);
        scrollRoot.addEventListener("scroll", this.settingsScrollHandler, { passive: true });
        this.syncActiveSettingsGroupFromScroll(groupIds);
    }

    private syncActiveSettingsGroupFromScroll(groupIds: string[]): void {
        const root = this.settingsScrollRoot;
        if (!root || typeof root.getBoundingClientRect !== "function") return;
        const rootRect = root.getBoundingClientRect();
        const activationLine = rootRect.top
            + this.settingsNavigationActivationOffset(root)
            + 2;
        let activeId = groupIds[0];

        for (const groupId of groupIds) {
            const summary = this.settingsGroupSummaries.get(groupId);
            if (!summary || typeof summary.getBoundingClientRect !== "function") continue;
            if (summary.getBoundingClientRect().top <= activationLine) {
                activeId = groupId;
            } else {
                break;
            }
        }

        const isAtBottom = root.scrollHeight > root.clientHeight + 8
            && root.scrollTop + root.clientHeight >= root.scrollHeight - 8;
        if (isAtBottom && groupIds.length > 0) {
            activeId = groupIds[groupIds.length - 1];
        }
        if (activeId) this.setActiveSettingsGroup(activeId);
    }

    private settingsNavigationActivationOffset(root: HTMLElement): number {
        if (!root.ownerDocument?.body?.classList.contains("is-mobile")) {
            return 24;
        }
        return this.settingsNavigationMobileOffset;
    }

    private refreshSettingsNavigationMobileOffset(
        root?: HTMLElement,
        jumpOverride?: HTMLElement,
    ): number {
        const jump = jumpOverride
            ?? this.containerEl.querySelector<HTMLElement>(".pa-settings-jump");
        let nextOffset = this.settingsNavigationMobileOffset;
        if (jump && typeof jump.getBoundingClientRect === "function") {
            const height = jump.getBoundingClientRect().height;
            if (Number.isFinite(height) && height > 0) {
                const doc = root?.ownerDocument ?? jump.ownerDocument;
                const win = doc?.defaultView;
                let stickyInset = 0;
                if (root && win && typeof win.getComputedStyle === "function") {
                    const rootStyle = win.getComputedStyle(root);
                    const jumpStyle = win.getComputedStyle(jump);
                    const paddingStart = Number.parseFloat(
                        rootStyle.paddingBlockStart || rootStyle.paddingTop,
                    );
                    const stickyTop = Number.parseFloat(jumpStyle.top);
                    stickyInset = (Number.isFinite(paddingStart) ? paddingStart : 0)
                        + (Number.isFinite(stickyTop) ? stickyTop : 0);
                }
                nextOffset = Math.max(72, Math.ceil(stickyInset + height + 12));
            }
        }
        const offsetChanged = nextOffset !== this.settingsNavigationMobileOffset;
        this.settingsNavigationMobileOffset = nextOffset;
        const doc = root?.ownerDocument ?? this.containerEl.ownerDocument;
        if (offsetChanged && doc?.body?.classList.contains("is-mobile")) {
            this.containerEl.style?.setProperty(
                "--pa-settings-mobile-nav-offset",
                `${this.settingsNavigationMobileOffset}px`,
            );
        }
        return this.settingsNavigationMobileOffset;
    }

    private startSettingsNavigationOffsetTracking(jump: HTMLElement): void {
        this.settingsNavigationResizeObserver?.disconnect();
        this.settingsNavigationResizeObserver = null;
        const refreshAndSync = () => {
            const previousOffset = this.settingsNavigationMobileOffset;
            this.refreshSettingsNavigationMobileOffset(
                this.settingsScrollRoot ?? undefined,
                jump,
            );
            if (this.settingsNavigationMobileOffset !== previousOffset) {
                this.settingsScrollHandler?.();
            }
        };
        refreshAndSync();
        const ResizeObserverCtor = jump.ownerDocument?.defaultView?.ResizeObserver;
        if (typeof ResizeObserverCtor !== "function") return;
        this.settingsNavigationResizeObserver = new ResizeObserverCtor(refreshAndSync);
        this.settingsNavigationResizeObserver.observe(jump);
    }

    private stopSettingsNavigation(): void {
        this.settingsNavigationResizeObserver?.disconnect();
        this.settingsNavigationResizeObserver = null;
        if (this.settingsScrollRoot && this.settingsScrollHandler) {
            this.settingsScrollRoot.removeEventListener("scroll", this.settingsScrollHandler);
        }
        this.settingsScrollRoot = null;
        this.settingsScrollHandler = null;
        this.settingsNavigationButtons.clear();
        this.settingsGroupSummaries.clear();
        this.settingsNavigationSelect = null;
        this.settingsNavigationCount = null;
        this.settingsNavigationProgressSegments = [];
        this.settingsNavigationGroupIds = [];
        this.settingsNavigationMobileOffset = 72;
        this.containerEl.style?.removeProperty("--pa-settings-mobile-nav-offset");
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
            const controls = controlEl.findAll("input, select, textarea, button")
                .filter((control) => (
                    !control.classList.contains("is-measuring")
                    && control.getAttribute("aria-hidden") !== "true"
                ));
            const customControls = controlEl.findAll(
                ".clickable-icon, .checkbox-container, .pa-settings-skill-picker",
            );
            const skillPicker = controlEl.querySelector<HTMLElement>(".pa-settings-skill-picker");
            if (!controls.length && !customControls.length) {
                return;
            }
            const modifierClasses = [
                "pa-setting-layout--field",
                "pa-setting-layout--compact",
                "pa-setting-layout--cluster",
                "pa-setting-layout--stacked",
            ];
            settingEl.classList.remove("pa-setting-has-form-control", ...modifierClasses);
            settingEl.classList.add("pa-setting-layout");
            settingEl.querySelector<HTMLElement>(".setting-item-info")?.classList.add("pa-setting-form-info");
            controlEl.classList.add("pa-setting-form-control");
            const primaryFields = controls.filter((control) => (
                control.matches(
                    "select, textarea, input:not([type]), input[type='text'], input[type='number'], "
                    + "input[type='password'], input[type='url'], input[type='email'], input[type='search']",
                )
            ));
            primaryFields.forEach((control) => control.classList.add("pa-setting-form-input"));
            let layoutClass = "pa-setting-layout--compact";
            if (skillPicker || controls.some((control) => control.matches("textarea"))) {
                layoutClass = "pa-setting-layout--stacked";
            } else if (controls.length > 1 || primaryFields.length > 1) {
                layoutClass = "pa-setting-layout--cluster";
            } else if (primaryFields.length === 1) {
                layoutClass = "pa-setting-layout--field";
            }
            settingEl.classList.add(layoutClass);
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

    private renderQuickCaptureSection(parentEl: HTMLElement): void {
        const plugin = this.plugin;
        parentEl.createEl("h2", { text: this.t("plugin.settings.quickCapture.title") });
        parentEl.createEl("p", {
            text: this.t("plugin.settings.quickCapture.desc"),
            cls: "pa-settings-section-desc-sm",
        });

        new Setting(parentEl).setName(this.t("plugin.settings.quickCapture.enabled.name"))
            .setDesc(this.t("plugin.settings.quickCapture.enabled.desc"))
            .addToggle(toggle => toggle
                .setValue(plugin.settings.quickCapture.enabled)
                .onChange((value) => {
                    plugin.settings.quickCapture.enabled = value;
                    void plugin.saveSettings();
                }));

        new Setting(parentEl).setName(this.t("plugin.settings.quickCapture.destination.name"))
            .setDesc(this.t("plugin.settings.quickCapture.destination.desc"))
            .addDropdown(dropdown => dropdown
                .addOption("daily", this.t("plugin.settings.quickCapture.destination.daily"))
                .addOption("inbox", this.t("plugin.settings.quickCapture.destination.inbox"))
                .addOption("current-file", this.t("plugin.settings.quickCapture.destination.currentFile"))
                .setValue(plugin.settings.quickCapture.destination)
                .onChange((value) => {
                    plugin.settings.quickCapture.destination = normalizeQuickCaptureDestination(value);
                    void plugin.saveSettings();
                }));

        new Setting(parentEl).setName(this.t("plugin.settings.quickCapture.inboxPath.name"))
            .setDesc(this.t("plugin.settings.quickCapture.inboxPath.desc"))
            .addText(text => text
                .setPlaceholder(QUICK_CAPTURE_DEFAULTS.inboxPath)
                .setValue(plugin.settings.quickCapture.inboxPath)
                .onChange((value) => {
                    plugin.settings.quickCapture.inboxPath = normalizeQuickCaptureInboxPath(value);
                    this.debouncedSave();
                }));

        new Setting(parentEl).setName(this.t("plugin.settings.quickCapture.postProcessing.name"))
            .setDesc(this.t("plugin.settings.quickCapture.postProcessing.desc"))
            .addToggle(toggle => toggle
                .setValue(plugin.settings.quickCapture.postProcessingEnabled)
                .onChange((value) => {
                    plugin.settings.quickCapture.postProcessingEnabled = value;
                    void plugin.saveSettings();
                }));
    }

    private renderDataBoundarySection(parentEl: HTMLElement): void {
        const plugin = this.plugin;
        parentEl.createEl("h2", { text: this.t("plugin.settings.dataBoundary.title") });
        parentEl.createEl("p", {
            text: this.t("plugin.settings.dataBoundary.desc"),
            cls: "pa-settings-section-desc-sm",
        });

        new Setting(parentEl)
            .setName(this.t("plugin.settings.dataBoundary.excludedFolders.name"))
            .setDesc(this.t("plugin.settings.dataBoundary.excludedFolders.desc"))
            .addText(text => text
                .setPlaceholder("private, archive/sensitive")
                .setValue(plugin.settings.dataBoundary.excludedFolders.join(", "))
                .onChange((value) => {
                    plugin.settings.dataBoundary.excludedFolders = normalizeTrimmedStringArray(value.split(","), []);
                    this.debouncedSave();
                }));

        new Setting(parentEl)
            .setName(this.t("plugin.settings.dataBoundary.excludedTags.name"))
            .setDesc(this.t("plugin.settings.dataBoundary.excludedTags.desc"))
            .addText(text => text
                .setPlaceholder("private, sensitive")
                .setValue(plugin.settings.dataBoundary.excludedTags.join(", "))
                .onChange((value) => {
                    plugin.settings.dataBoundary.excludedTags = normalizeTrimmedStringArray(value.split(","), [])
                        .map((tag) => tag.replace(/^#/, ""))
                        .filter(Boolean);
                    this.debouncedSave();
                }));

        new Setting(parentEl)
            .setName(this.t("plugin.settings.dataBoundary.generatedNotes.name"))
            .setDesc(this.t("plugin.settings.dataBoundary.generatedNotes.desc"))
            .addDropdown(dropdown => dropdown
                .addOption("exclude-generated", this.t("plugin.settings.dataBoundary.generatedNotes.exclude"))
                .addOption("include-generated", this.t("plugin.settings.dataBoundary.generatedNotes.include"))
                .setValue(plugin.settings.dataBoundary.generatedNotePolicy)
                .onChange((value) => {
                    plugin.settings.dataBoundary.generatedNotePolicy = normalizeDataBoundaryGeneratedNotePolicy(value);
                    void plugin.saveSettings();
                }));

        new Setting(parentEl)
            .setName(this.t("plugin.settings.dataBoundary.providerDisclosure.name"))
            .setDesc(this.t("plugin.settings.dataBoundary.providerDisclosure.desc"));

        parentEl.createEl("h3", { text: this.t("plugin.settings.retrievalHabit.title") });
        parentEl.createEl("p", {
            text: this.t("plugin.settings.retrievalHabit.desc"),
            cls: "pa-settings-section-desc-sm",
        });

        new Setting(parentEl)
            .setName(this.t("plugin.settings.retrievalHabit.enabled.name"))
            .setDesc(this.t("plugin.settings.retrievalHabit.enabled.desc"))
            .addToggle(toggle => toggle
                .setValue(plugin.settings.retrievalHabitProfile.enabled)
                .onChange(async (value) => {
                    if (value && !plugin.settings.retrievalHabitProfile.enabled) {
                        const confirmed = await confirmUserAction(this.app, {
                            title: this.t("plugin.settings.retrievalHabit.enableConfirm.title"),
                            message: this.t("plugin.settings.retrievalHabit.enableConfirm.message"),
                            confirmText: this.t("plugin.settings.retrievalHabit.enableConfirm.confirm"),
                        });
                        if (!confirmed) {
                            toggle.setValue(false);
                            return;
                        }
                    }
                    plugin.settings.retrievalHabitProfile.enabled = value;
                    await plugin.saveSettings();
                }));

        new Setting(parentEl)
            .setName(this.t("plugin.settings.retrievalHabit.clear.name"))
            .setDesc(this.t("plugin.settings.retrievalHabit.clear.desc"))
            .addButton(button => button
                .setButtonText(this.t("plugin.settings.retrievalHabit.clear.button"))
                .setDisabled(plugin.settings.retrievalHabitProfile.state.aggregates.length === 0)
                .onClick(async () => {
                    const confirmed = await confirmUserAction(this.app, {
                        title: this.t("plugin.settings.retrievalHabit.clearConfirm.title"),
                        message: this.t("plugin.settings.retrievalHabit.clearConfirm.message"),
                        confirmText: this.t("plugin.settings.retrievalHabit.clearConfirm.confirm"),
                    });
                    if (!confirmed) return;
                    plugin.settings.retrievalHabitProfile.state = {
                        aggregates: [],
                        clearedAt: new Date().toISOString(),
                    };
                    await plugin.saveSettings();
                    new Notice(this.t("plugin.settings.retrievalHabit.clear.done"), 4000);
                    this.display();
                }));

        parentEl.createEl("h3", { text: this.t("plugin.settings.dataBoundary.cleanup.title") });
        parentEl.createEl("p", {
            text: this.t("plugin.settings.dataBoundary.cleanup.desc"),
            cls: "pa-settings-section-desc-sm",
        });
        const cleanupCard = parentEl.createDiv({ cls: "pa-settings-info-card" });
        cleanupCard.createEl("p", {
            text: this.t("plugin.settings.dataBoundary.cleanup.infoCard"),
            cls: "pa-settings-info-card-text",
        });
        const cleanupList = cleanupCard.createEl("ul", { cls: "pa-settings-info-card-list" });
        for (const group of DATA_CLEANUP_GROUPS) {
            cleanupList.createEl("li", { text: this.t(DATA_BOUNDARY_CLEANUP_LABEL_KEYS[group]) });
        }
        new Setting(parentEl)
            .setName(this.t("plugin.settings.dataBoundary.cleanup.memoryControls.name"))
            .setDesc(this.t("plugin.settings.dataBoundary.cleanup.memoryControls.desc"))
            .addButton((button) => button
                .setButtonText(this.t("plugin.settings.dataBoundary.cleanup.memoryControls.button"))
                .onClick(() => this.openGroup("memory-personalization", "memory-data-recovery")));
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
        this.markFormControlSettings(container);
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
        parentEl.createEl('h3', { text: this.t("plugin.settings.skills.title") });
        parentEl.createEl("p", {
            text: this.t("plugin.settings.skills.desc"),
            cls: "pa-settings-section-desc-sm",
        });

        this.skillTogglesContainer = parentEl.createDiv({ cls: "pa-settings-skill-picker-host" });
        this.rebuildSkillToggles();
    }

    private rebuildSkillToggles(options: {
        open?: boolean;
        focusSkillId?: string;
        focusMaster?: boolean;
    } = {}): void {
        if (!this.skillTogglesContainer) return;
        this.skillTogglesContainer.empty();
        const plugin = this.plugin;
        const container = this.skillTogglesContainer;
        const enabledSkillIds = new Set(plugin.settings.enabledSkillIds);
        const enabledCount = BUNDLED_SKILL_CATALOG.filter((skill) => enabledSkillIds.has(skill.id)).length;
        const summary = this.formatSkillSelectionSummary(plugin.settings.skillContextEnabled, enabledCount);

        const pickerSetting = new Setting(container)
            .setName(this.t("plugin.settings.skills.selector.name"))
            .setDesc(this.t("plugin.settings.skills.selector.desc", { summary }));
        const componentEl = pickerSetting.controlEl.createDiv({ cls: "pa-settings-skill-picker" });
        const details = componentEl.createEl("details", {
            cls: "pa-settings-skill-picker__details",
        });
        details.open = options.open ?? false;
        const summaryEl = details.createEl("summary", {
            cls: "pa-settings-skill-picker__summary",
        });
        summaryEl.createSpan({
            cls: "pa-settings-skill-picker__summary-text",
            text: summary,
        });

        const panel = details.createDiv({ cls: "pa-settings-skill-picker__panel" });
        const masterLabel = panel.createEl("label", {
            cls: [
                "pa-settings-skill-picker__option",
                "pa-settings-skill-picker__option--master",
            ],
        });
        const masterInput = masterLabel.createEl("input", {
            attr: {
                type: "checkbox",
            },
        }) as HTMLInputElement;
        let focusTarget: HTMLInputElement | null = options.focusMaster ? masterInput : null;
        masterInput.dataset.paSkillToggle = "master";
        masterInput.checked = plugin.settings.skillContextEnabled;
        masterInput.addEventListener("change", async () => {
            const wasOpen = details.open;
            plugin.settings.skillContextEnabled = masterInput.checked;
            await plugin.saveSettings();
            this.rebuildSkillToggles({ open: wasOpen, focusMaster: true });
        });
        masterLabel.createSpan({
            cls: "pa-settings-skill-picker__option-text",
            text: this.t("plugin.settings.skills.enabled.name"),
        });

        const list = panel.createDiv({ cls: "pa-settings-skill-picker__list" });
        for (const skill of BUNDLED_SKILL_CATALOG) {
            const label = list.createEl("label", {
                cls: "pa-settings-skill-picker__option",
            });
            if (!plugin.settings.skillContextEnabled) {
                label.addClass("is-disabled");
            }
            const input = label.createEl("input", {
                attr: {
                    type: "checkbox",
                },
            }) as HTMLInputElement;
            input.dataset.paSkillToggle = skill.id;
            if (options.focusSkillId === skill.id) {
                focusTarget = input;
            }
            input.checked = enabledSkillIds.has(skill.id);
            input.disabled = !plugin.settings.skillContextEnabled;
            input.addEventListener("change", async () => {
                const wasOpen = details.open;
                const nextEnabledSkillIds = new Set(plugin.settings.enabledSkillIds);
                if (input.checked) {
                    nextEnabledSkillIds.add(skill.id);
                } else {
                    nextEnabledSkillIds.delete(skill.id);
                }
                plugin.settings.enabledSkillIds = normalizeEnabledSkillIds([...nextEnabledSkillIds]);
                await plugin.saveSettings();
                this.rebuildSkillToggles({ open: wasOpen, focusSkillId: skill.id });
            });

            const text = label.createSpan({ cls: "pa-settings-skill-picker__option-body" });
            text.createSpan({
                cls: "pa-settings-skill-picker__option-title",
                text: skill.label,
            });
            text.createSpan({
                cls: "pa-settings-skill-picker__option-desc",
                text: skill.description,
            });
        }
        this.markFormControlSettings(container);
        focusTarget?.focus();
    }

    private formatSkillSelectionSummary(enabled: boolean, enabledCount: number): string {
        const total = BUNDLED_SKILL_CATALOG.length;
        if (!enabled) {
            return this.t("plugin.settings.skills.summary.off");
        }
        if (enabledCount === total) {
            return this.t("plugin.settings.skills.summary.all");
        }
        if (enabledCount === 0) {
            return this.t("plugin.settings.skills.summary.none");
        }
        return this.t("plugin.settings.skills.summary.some", {
            count: enabledCount,
            total,
        });
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
        this.memorySubContainer = parentEl.createDiv({ cls: "pa-settings-nested pa-settings-nested--level-1" });
        this.rebuildMemorySubSettings();
    }

    private renderMemoryControlCenterOverview(parentEl: HTMLElement): void {
        const generation = this.memoryControlCenterGeneration;
        const section = parentEl.createDiv({ cls: "pa-memory-control-center" });
        section.createEl("h2", { text: this.t("plugin.settings.memoryControlCenter.title") });
        section.createEl("p", {
            text: this.t("plugin.settings.memoryControlCenter.desc"),
            cls: "pa-settings-section-desc-md",
        });
        const liveStatus = section.createEl("p", {
            cls: ["pa-sr-only", "pa-memory-control-center__live-status"],
            attr: {
                role: "status",
                "aria-live": "polite",
                "aria-atomic": "true",
                tabindex: "-1",
            },
        });
        const body = section.createDiv({
            cls: "pa-memory-control-center__body",
            attr: { "aria-busy": "true" },
        });

        const loadSnapshot = (focusStatus = false): void => {
            body.empty();
            body.setAttr("aria-busy", "true");
            liveStatus.setText(this.t("plugin.settings.memoryControlCenter.loading"));
            body.createEl("p", {
                text: this.t("plugin.settings.memoryControlCenter.loading"),
                cls: "pa-memory-control-center__loading",
            });
            if (focusStatus && liveStatus.isConnected !== false) {
                liveStatus.focus({ preventScroll: true });
            }

            void this.plugin.getMemoryControlCenterSnapshot()
                .then((snapshot) => {
                    if (generation !== this.memoryControlCenterGeneration || body.isConnected === false) return;
                    body.empty();
                    body.setAttr("aria-busy", "false");
                    this.renderMemoryControlCenterSnapshot(body, snapshot);
                    this.markFormControlSettings(body);
                    liveStatus.setText(this.t("plugin.settings.memoryControlCenter.loaded", {
                        count: snapshot.items.length,
                    }));
                })
                .catch((error) => {
                    if (generation !== this.memoryControlCenterGeneration || body.isConnected === false) return;
                    this.log("Failed to render Memory control center overview", error);
                    body.empty();
                    body.setAttr("aria-busy", "false");
                    const message = this.t("plugin.settings.memoryControlCenter.loadError");
                    liveStatus.setText(message);
                    body.createEl("p", {
                        text: message,
                        cls: "pa-memory-control-center__error",
                    });
                    const actions = body.createDiv({ cls: "pa-memory-control-center__actions" });
                    const retry = actions.createEl("button", {
                        text: this.t("plugin.settings.memoryControlCenter.retry"),
                        attr: { type: "button" },
                    });
                    retry.addEventListener("click", () => loadSnapshot(true));
                });
        };

        loadSnapshot();
    }

    private renderMemoryControlCenterSnapshot(
        parentEl: HTMLElement,
        snapshot: MemoryControlCenterSnapshot,
    ): void {
        const cards = parentEl.createDiv({ cls: "pa-memory-control-center__cards" });
        this.renderMemoryControlCenterCard(
            cards,
            this.t("plugin.settings.memoryControlCenter.noteMemory.title"),
            this.formatMemoryControlCenterStatus(snapshot.noteMemory.status),
            snapshot.noteMemory.indexedDocumentCount !== undefined
                ? this.t("plugin.settings.memoryControlCenter.indexedCount", {
                    count: snapshot.noteMemory.indexedDocumentCount,
                })
                : undefined,
        );
        this.renderMemoryControlCenterCard(
            cards,
            this.t("plugin.settings.memoryControlCenter.vaultInsights.title"),
            this.formatMemoryControlCenterStatus(snapshot.vaultInsights.status),
            snapshot.vaultInsights.fileCount !== undefined
                ? this.t("plugin.settings.memoryControlCenter.count", { count: snapshot.vaultInsights.fileCount })
                : undefined,
        );
        this.renderMemoryControlCenterCard(
            cards,
            this.t("plugin.settings.memoryControlCenter.profile.title"),
            this.formatMemoryControlCenterStatus(snapshot.profile.status),
            this.t("plugin.settings.memoryControlCenter.count", { count: snapshot.profile.itemCount }),
        );
        this.renderMemoryControlCenterCard(
            cards,
            this.t("plugin.settings.memoryControlCenter.durable.title"),
            this.t("plugin.settings.memoryControlCenter.durable.activeCount", {
                count: snapshot.durable.activeCount,
            }),
            this.t("plugin.settings.memoryControlCenter.durable.detail", {
                paused: snapshot.durable.pausedCount,
                stale: snapshot.durable.staleCount,
            }),
        );

        const boundary = parentEl.createDiv({ cls: "pa-memory-control-center__boundary" });
        boundary.createEl("h3", { text: this.t("plugin.settings.memoryControlCenter.boundary.title") });
        boundary.createEl("p", {
            text: snapshot.boundary.deviceLocalProven
                ? this.t(snapshot.boundary.explanationKey as PluginMessageKey, undefined, snapshot.boundary.explanationKey)
                : this.t("plugin.settings.memoryControlCenter.boundary.compatibility"),
        });
        this.renderMemoryControlCenterFinalization(parentEl, snapshot);

        if (snapshot.governanceMode === "unavailable") {
            parentEl.createEl("p", {
                text: this.t("plugin.settings.memoryControlCenter.governanceUnavailable"),
                cls: "pa-memory-control-center__warning",
                attr: { role: "status" },
            });
        }

        if (snapshot.degradedSources.length > 0) {
            parentEl.createEl("p", {
                text: this.t("plugin.settings.memoryControlCenter.partialUnavailable"),
                cls: "pa-memory-control-center__warning",
                attr: { role: "status" },
            });
        }

        if (snapshot.items.length === 0) {
            parentEl.createEl("p", {
                text: this.t("plugin.settings.memoryControlCenter.empty"),
                cls: "pa-memory-control-center__empty",
            });
        } else {
            const details = parentEl.createEl("details", { cls: "pa-memory-control-center__details" });
            details.createEl("summary", {
                text: this.t("plugin.settings.memoryControlCenter.details", { count: snapshot.items.length }),
            });
            const list = details.createDiv({ cls: "pa-memory-control-center__items" });
            for (const item of snapshot.items) {
                this.renderMemoryControlCenterItem(list, item);
            }
        }
        this.renderMemoryControlCenterRecentChanges(parentEl, snapshot);
        this.renderMemoryControlCenterDataRecovery(parentEl, snapshot);
        this.focusPendingMemoryControlCenterTarget(true);
    }

    private renderMemoryControlCenterDataRecovery(
        parentEl: HTMLElement,
        snapshot: MemoryControlCenterSnapshot,
    ): void {
        const section = parentEl.createEl("details", {
            cls: ["pa-memory-control-center__item", "pa-memory-control-center__recovery"],
        });
        section.dataset.paMemoryTargetId = "memory-data-recovery";
        section.open = snapshot.compatibilityRollback?.phase === "rolling_back"
            || this.pendingMemoryControlCenterTargetId === "memory-data-recovery";
        section.createEl("summary", {
            text: this.t("plugin.settings.memoryControlCenter.dataRecovery.title"),
        });
        const content = section.createDiv({ cls: "pa-memory-control-center__recovery-body" });
        content.createEl("p", {
            text: this.t("plugin.settings.memoryControlCenter.dataRecovery.desc"),
            cls: "pa-settings-section-desc-md",
        });
        const rollback = snapshot.compatibilityRollback;
        if (rollback) {
            const rollbackDescription = rollback.eligible
                ? this.t("plugin.settings.memoryControlCenter.dataRecovery.rollback.desc", {
                    records: rollback.legacyRecordCount,
                    queue: rollback.legacyMemoryQueueCount,
                })
                : this.plugin.getMemoryRollbackStatusMessage(rollback.blockedReason);
            new Setting(content)
                .setName(this.t("plugin.settings.memoryControlCenter.dataRecovery.rollback.name"))
                .setDesc(rollbackDescription)
                .addButton((button) => button
                    .setButtonText(this.t(
                        rollback.phase === "rolling_back"
                            ? "plugin.settings.memoryControlCenter.dataRecovery.rollback.retry"
                            : "plugin.settings.memoryControlCenter.dataRecovery.rollback.action",
                    ))
                    .setDisabled(!rollback.eligible)
                    .setWarning()
                    .onClick(async () => {
                        const generation = this.memoryControlCenterGeneration;
                        const confirmed = await confirmUserAction(this.app, {
                            title: this.t(
                                "plugin.settings.memoryControlCenter.dataRecovery.rollback.confirmTitle",
                            ),
                            message: this.t(
                                "plugin.settings.memoryControlCenter.dataRecovery.rollback.confirmMessage",
                            ),
                            confirmText: this.t(
                                "plugin.settings.memoryControlCenter.dataRecovery.rollback.action",
                            ),
                        });
                        if (!confirmed || generation !== this.memoryControlCenterGeneration) return;
                        try {
                            const result = await this.plugin.rollbackMemoryGovernance();
                            new Notice(result.message, result.ok ? 5000 : 7000);
                        } catch (error) {
                            this.log("Memory compatibility restore failed", error);
                            new Notice(
                                this.t(
                                    "plugin.settings.memoryControlCenter.dataRecovery.rollback.failed",
                                ),
                                7000,
                            );
                        }
                        if (generation !== this.memoryControlCenterGeneration) return;
                        this.display();
                        this.openGroup("memory-personalization", "memory-data-recovery");
                    }));
        }
        const markerCount = this.plugin.getMemorySuppressionMarkerCount();
        new Setting(content)
            .setName(this.t("plugin.settings.memoryControlCenter.dataRecovery.prevention.name"))
            .setDesc(this.t("plugin.settings.memoryControlCenter.dataRecovery.prevention.desc", {
                count: markerCount,
            }))
            .addButton((button) => button
                .setButtonText(this.t("plugin.settings.memoryControlCenter.dataRecovery.prevention.clear"))
                .setDisabled(markerCount === 0)
                .onClick(async () => {
                    const generation = this.memoryControlCenterGeneration;
                    const confirmed = await confirmUserAction(this.app, {
                        title: this.t("plugin.settings.memoryControlCenter.dataRecovery.prevention.confirmTitle"),
                        message: this.t("plugin.settings.memoryControlCenter.dataRecovery.prevention.confirmMessage"),
                        confirmText: this.t("plugin.settings.memoryControlCenter.dataRecovery.prevention.clear"),
                    });
                    if (!confirmed || generation !== this.memoryControlCenterGeneration) return;
                    try {
                        const result = await this.plugin.clearMemorySuppressionMarkers();
                        new Notice(result.message, result.ok ? 4000 : 6000);
                    } catch (error) {
                        this.log("Memory prevention-marker cleanup failed", error);
                        new Notice(
                            this.t("plugin.settings.memoryControlCenter.dataRecovery.prevention.unavailable"),
                            6000,
                        );
                    }
                    if (generation !== this.memoryControlCenterGeneration) return;
                    this.display();
                    this.openGroup("memory-personalization", "memory-data-recovery");
                }));
    }

    private renderMemoryControlCenterCard(
        parentEl: HTMLElement,
        title: string,
        status: string,
        detail?: string,
    ): void {
        const card = parentEl.createDiv({ cls: "pa-memory-control-center__card" });
        card.createEl("h3", { text: title });
        card.createEl("p", { text: status, cls: "pa-memory-control-center__card-status" });
        if (detail) card.createEl("p", { text: detail, cls: "pa-memory-control-center__card-detail" });
    }

    private renderMemoryControlCenterFinalization(
        parentEl: HTMLElement,
        snapshot: MemoryControlCenterSnapshot,
    ): void {
        const finalization = snapshot.compatibilityFinalization;
        if (!finalization) return;
        const section = parentEl.createEl("details", {
            cls: "pa-memory-control-center__finalization",
        });
        const hasLegacyData = finalization.legacyRecordCount > 0
            || finalization.legacyMemoryQueueCount > 0;
        const needsAttention = finalization.phase === "finalizing"
            || hasLegacyData
            || this.isMemoryFinalizationAttentionReason(finalization.blockedReason);
        if (needsAttention) {
            section.open = true;
        }
        section.createEl("summary", {
            text: this.t("plugin.settings.memoryControlCenter.finalization.title"),
        });
        section.createEl("p", {
            text: this.t("plugin.settings.memoryControlCenter.finalization.desc"),
            cls: "pa-settings-section-desc-md",
        });
        if (finalization.requiresFreshRestoreProof) {
            section.createEl("p", {
                text: this.t("plugin.settings.memoryControlCenter.finalization.freshProof"),
                cls: "pa-settings-section-desc-md",
            });
        }
        if (finalization.legacyRecordCount > 0 || finalization.legacyMemoryQueueCount > 0) {
            section.createEl("p", {
                text: this.t("plugin.settings.memoryControlCenter.finalization.warning", {
                    records: finalization.legacyRecordCount,
                    queue: finalization.legacyMemoryQueueCount,
                }),
                cls: "pa-memory-control-center__warning",
            });
        }
        if (!finalization.eligible || !finalization.confirmationToken) {
            if (needsAttention) {
                section.createEl("p", {
                    text: this.plugin.getMemoryFinalizationStatusMessage(finalization.blockedReason),
                    cls: "pa-memory-control-center__warning",
                    attr: { role: "status" },
                });
            }
            return;
        }
        const button = section.createEl("button", {
            text: this.t(finalization.phase === "finalizing"
                ? "plugin.settings.memoryControlCenter.finalization.retry"
                : "plugin.settings.memoryControlCenter.finalization.action"),
            attr: { type: "button" },
        });
        button.addEventListener("click", () => {
            const generation = this.memoryControlCenterGeneration;
            void (async () => {
                const confirmed = await confirmUserAction(this.app, {
                    title: this.t("plugin.settings.memoryControlCenter.finalization.confirmTitle"),
                    message: this.t("plugin.settings.memoryControlCenter.finalization.confirmMessage"),
                    confirmText: this.t("plugin.settings.memoryControlCenter.finalization.action"),
                });
                if (!confirmed || generation !== this.memoryControlCenterGeneration) return;
                button.disabled = true;
                const result = await this.plugin.finalizeMemoryGovernance(finalization.confirmationToken!);
                new Notice(result.message, result.ok ? 4000 : 6000);
                if (generation !== this.memoryControlCenterGeneration) return;
                this.display();
                this.openGroup("memory-personalization");
            })().catch((error) => {
                this.log("Memory finalization action failed", error);
                if (generation === this.memoryControlCenterGeneration) button.disabled = false;
                new Notice(this.t("plugin.settings.memoryControlCenter.finalization.unavailable"), 5000);
            });
        });
    }

    private isMemoryFinalizationAttentionReason(reason: string | undefined): boolean {
        if (!reason) return false;
        return reason !== "finalization_not_available"
            && reason !== "governed_cutover_incomplete"
            && reason !== "finalization_confirmation_stale"
            && reason !== "finalization_state_changed";
    }

    private renderMemoryControlCenterItem(parentEl: HTMLElement, item: MemoryControlCenterItem): void {
        const article = parentEl.createEl("article", { cls: "pa-memory-control-center__item" });
        article.dataset.paMemoryTargetId = item.claimId ?? item.id;
        article.createEl("h4", {
            text: item.lifecycle === "forget_pending"
                ? this.t("plugin.settings.memoryControlCenter.pendingForget.title")
                : item.origin === "vault_insights"
                ? this.t("plugin.settings.memoryControlCenter.vaultInsights.title")
                : item.lifecycle === "forgotten_marker"
                    ? this.t("plugin.settings.memoryControlCenter.status.forgotten")
                    : item.label,
        });
        const metadata = article.createEl("dl", { cls: "pa-memory-control-center__metadata" });
        if (item.lifecycle === "forget_pending") {
            article.createEl("p", {
                text: this.t("plugin.settings.memoryControlCenter.pendingForget.desc"),
                cls: "pa-memory-control-center__warning",
            });
            this.renderMemoryControlCenterMetadataRow(
                metadata,
                this.t("plugin.settings.memoryControlCenter.field.status"),
                this.t("plugin.settings.memoryControlCenter.status.forgetPending"),
            );
            if (item.updatedAt) {
                this.renderMemoryControlCenterMetadataRow(
                    metadata,
                    this.t("plugin.settings.memoryControlCenter.field.updated"),
                    this.formatMemoryControlCenterTimestamp(item.updatedAt),
                );
            }
            this.renderMemoryControlCenterItemActions(article, item);
            return;
        }
        if (item.lifecycle === "forgotten_marker") {
            const timestamp = item.updatedAt ?? item.observedAt;
            if (timestamp) {
                this.renderMemoryControlCenterMetadataRow(
                    metadata,
                    this.t("plugin.settings.memoryControlCenter.field.updated"),
                    this.formatMemoryControlCenterTimestamp(timestamp),
                );
            }
            return;
        }
        this.renderMemoryControlCenterMetadataRow(
            metadata,
            this.t("plugin.settings.memoryControlCenter.field.source"),
            this.formatMemoryControlCenterSource(item.origin),
        );
        this.renderMemoryControlCenterMetadataRow(
            metadata,
            this.t("plugin.settings.memoryControlCenter.field.authority"),
            this.formatMemoryControlCenterAuthority(item.authority),
        );
        this.renderMemoryControlCenterMetadataRow(
            metadata,
            this.t("plugin.settings.memoryControlCenter.field.scope"),
            item.scopeLabel,
        );
        this.renderMemoryControlCenterMetadataRow(
            metadata,
            this.t("plugin.settings.memoryControlCenter.field.effect"),
            this.formatMemoryControlCenterEffect(item.effect),
        );
        this.renderMemoryControlCenterMetadataRow(
            metadata,
            this.t("plugin.settings.memoryControlCenter.field.status"),
            this.formatMemoryControlCenterLifecycle(item.lifecycle),
        );
        const timestamp = item.updatedAt ?? item.observedAt;
        if (timestamp) {
            this.renderMemoryControlCenterMetadataRow(
                metadata,
                this.t("plugin.settings.memoryControlCenter.field.updated"),
                this.formatMemoryControlCenterTimestamp(timestamp),
            );
        }

        for (const provenance of item.provenance) {
            if (provenance.kind !== "vault_aggregate") continue;
            this.renderMemoryControlCenterMetadataRow(
                metadata,
                this.t("plugin.settings.memoryControlCenter.field.includedNotes"),
                this.t("plugin.settings.memoryControlCenter.includedCount", {
                    count: provenance.includedFileCount,
                }),
            );
            this.renderMemoryControlCenterMetadataRow(
                metadata,
                this.t("plugin.settings.memoryControlCenter.field.coverage"),
                this.formatMemoryControlCenterCoverage(provenance.coverage),
            );
        }

        const sourceLabels = this.collectMemoryControlCenterSourceLabels(item);
        if (sourceLabels.length > 0) {
            const sources = article.createEl("ul", { cls: "pa-memory-control-center__sources" });
            for (const label of sourceLabels) sources.createEl("li", { text: label });
        }
        this.renderMemoryControlCenterItemActions(article, item);
    }

    private renderMemoryControlCenterItemActions(
        article: HTMLElement,
        item: MemoryControlCenterItem,
    ): void {
        if (!item.claimId || item.supportedActions.length === 0) return;
        const actions = article.createDiv({ cls: "pa-memory-control-center__actions" });
        for (const action of item.supportedActions) {
            if (action === "undo_recent_change") continue;
            const button = actions.createEl("button", {
                text: this.t(`plugin.settings.memoryControlCenter.action.${action}` as PluginMessageKey),
                attr: { type: "button" },
            });
            button.addEventListener("click", () => {
                if (action === "correct") {
                    this.renderMemoryControlCenterCorrectionEditor(article, actions, item);
                    return;
                }
                void this.runMemoryControlCenterAction(button, action, item.claimId!);
            });
        }
    }

    private renderMemoryControlCenterCorrectionEditor(
        article: HTMLElement,
        actions: HTMLElement,
        item: MemoryControlCenterItem,
    ): void {
        if (article.querySelector(".pa-memory-control-center__correction")) return;
        const editor = article.createDiv({ cls: "pa-memory-control-center__correction" });
        const input = editor.createEl("textarea", {
            text: item.label,
            attr: {
                rows: "3",
                "aria-label": this.t("plugin.settings.memoryControlCenter.action.correct"),
            },
        });
        const buttons = editor.createDiv({ cls: "pa-memory-control-center__actions" });
        const save = buttons.createEl("button", {
            text: this.t("plugin.settings.memoryControlCenter.action.saveCorrection"),
            attr: { type: "button" },
        });
        const cancel = buttons.createEl("button", {
            text: this.t("plugin.settings.memoryControlCenter.action.cancel"),
            attr: { type: "button" },
        });
        const updateSaveAvailability = (): void => {
            const summary = input.value.trim();
            save.disabled = !summary || summary === item.label.trim();
        };
        input.addEventListener("input", updateSaveAvailability);
        updateSaveAvailability();
        save.addEventListener("click", () => {
            const summary = input.value.trim();
            if (!summary || summary === item.label.trim()) return;
            void this.runMemoryControlCenterAction(save, "correct", item.claimId!, summary, input);
        });
        cancel.addEventListener("click", () => editor.remove());
        actions.querySelectorAll("button").forEach((button) => { (button as HTMLButtonElement).disabled = true; });
        cancel.addEventListener("click", () => {
            actions.querySelectorAll("button").forEach((button) => { (button as HTMLButtonElement).disabled = false; });
        }, { once: true });
        input.focus();
    }

    private renderMemoryControlCenterRecentChanges(
        parentEl: HTMLElement,
        snapshot: MemoryControlCenterSnapshot,
    ): void {
        const section = parentEl.createDiv({ cls: "pa-memory-control-center__recent" });
        section.createEl("h3", { text: this.t("plugin.settings.memoryControlCenter.recent.title") });
        section.createEl("p", {
            text: this.t("plugin.settings.memoryControlCenter.recent.desc"),
            cls: "pa-settings-section-desc-md",
        });
        const changes = snapshot.recentChanges ?? [];
        if (changes.length === 0) {
            section.createEl("p", {
                text: this.t("plugin.settings.memoryControlCenter.recent.empty"),
                cls: "pa-memory-control-center__empty",
            });
            return;
        }
        const list = section.createDiv({ cls: "pa-memory-control-center__items" });
        for (const change of changes) {
            const article = list.createEl("article", { cls: "pa-memory-control-center__item" });
            article.dataset.paMemoryTargetId = change.id;
            article.createEl("h4", {
                text: this.t(
                    `plugin.settings.memoryControlCenter.recent.kind.${change.kind}` as PluginMessageKey,
                ),
            });
            if (!change.redacted && change.label) {
                article.createEl("p", {
                    text: change.label,
                    cls: "pa-memory-control-center__change-label",
                });
            }
            const metadata = article.createEl("dl", { cls: "pa-memory-control-center__metadata" });
            this.renderMemoryControlCenterMetadataRow(
                metadata,
                this.t("plugin.settings.memoryControlCenter.field.updated"),
                this.formatMemoryControlCenterTimestamp(change.occurredAt),
            );
            if (!change.redacted && change.scopeLabel) {
                this.renderMemoryControlCenterMetadataRow(
                    metadata,
                    this.t("plugin.settings.memoryControlCenter.field.scope"),
                    change.scopeLabel,
                );
            }
            if (!change.redacted && change.sourcePath) {
                this.renderMemoryControlCenterMetadataRow(
                    metadata,
                    this.t("plugin.settings.memoryControlCenter.field.source"),
                    this.t("plugin.settings.memoryControlCenter.source.note", { path: change.sourcePath }),
                );
            }
            if (!change.redacted && change.effect) {
                this.renderMemoryControlCenterMetadataRow(
                    metadata,
                    this.t("plugin.settings.memoryControlCenter.field.effect"),
                    this.formatMemoryControlCenterEffect(change.effect),
                );
            }
            if (!change.redacted && change.status) {
                this.renderMemoryControlCenterMetadataRow(
                    metadata,
                    this.t("plugin.settings.memoryControlCenter.field.status"),
                    change.status === "restored"
                        ? this.t("plugin.settings.memoryControlCenter.status.restored")
                        : this.formatMemoryControlCenterLifecycle(
                            change.status === "forgotten" ? "forgotten_marker" : change.status,
                        ),
                );
            }
            if (change.supportedActions.includes("undo_recent_change")) {
                const actions = article.createDiv({ cls: "pa-memory-control-center__actions" });
                const undo = actions.createEl("button", {
                    text: this.t("plugin.settings.memoryControlCenter.action.undo_recent_change"),
                    attr: { type: "button" },
                });
                undo.addEventListener("click", () => {
                    void this.runMemoryControlCenterAction(undo, "undo_recent_change", change.id);
                });
            }
        }
    }

    private async runMemoryControlCenterAction(
        button: HTMLButtonElement,
        action: "correct" | "pause_use" | "resume_use" | "apply_device_wide"
            | "limit_to_current_vault" | "forget" | "retry_forget" | "undo_recent_change",
        targetId: string,
        summary?: string,
        failureFocusEl?: HTMLElement,
    ): Promise<void> {
        const generation = this.memoryControlCenterGeneration;
        button.disabled = true;
        try {
            const result = await this.plugin.runMemoryControlCenterAction(action, targetId, summary);
            new Notice(result.message, result.ok ? 3000 : 5000);
            if (!result.ok) {
                if (generation === this.memoryControlCenterGeneration) {
                    button.disabled = false;
                    (failureFocusEl ?? button).focus?.({ preventScroll: true });
                }
                return;
            }
            if (generation !== this.memoryControlCenterGeneration) return;
            this.display();
            this.openGroup("memory-personalization", targetId);
        } catch (error) {
            this.log("Memory control-center action failed", error);
            new Notice(this.t("plugin.settings.memoryControlCenter.action.failed"), 5000);
            if (generation === this.memoryControlCenterGeneration) {
                button.disabled = false;
                (failureFocusEl ?? button).focus?.({ preventScroll: true });
            }
        }
    }

    private renderMemoryControlCenterMetadataRow(parentEl: HTMLElement, label: string, value: string): void {
        const row = parentEl.createDiv({ cls: "pa-memory-control-center__metadata-row" });
        row.createEl("dt", { text: label });
        row.createEl("dd", { text: value });
    }

    private focusPendingMemoryControlCenterTarget(consumeIfMissing: boolean): void {
        const targetId = this.pendingMemoryControlCenterTargetId;
        if (!targetId) return;
        const target = Array.from(this.containerEl.querySelectorAll<HTMLElement>(".pa-memory-control-center__item"))
            .find((element) => element.dataset.paMemoryTargetId === targetId);
        if (!target) {
            if (consumeIfMissing) this.pendingMemoryControlCenterTargetId = null;
            return;
        }
        const details = this.containerEl.querySelector(".pa-memory-control-center__details");
        if (details && details.tagName.toLowerCase() === "details") {
            (details as HTMLDetailsElement).open = true;
        }
        if (target.tagName.toLowerCase() === "details") {
            (target as HTMLDetailsElement).open = true;
        }
        target.setAttr("tabindex", "-1");
        (target as HTMLElement & { addClass?: (cls: string) => void })
            .addClass?.("pa-memory-control-center__item--targeted");
        target.classList?.add?.("pa-memory-control-center__item--targeted");
        target.scrollIntoView?.({ behavior: "smooth", block: "center" });
        target.focus?.({ preventScroll: true });
        this.pendingMemoryControlCenterTargetId = null;
    }

    private collectMemoryControlCenterSourceLabels(item: MemoryControlCenterItem): string[] {
        const labels: string[] = [];
        let hasConversationEvidence = false;
        for (const provenance of item.provenance) {
            if (provenance.kind === "note") {
                labels.push(this.t("plugin.settings.memoryControlCenter.source.note", {
                    path: provenance.sourceRef.path,
                }));
            } else if (provenance.kind === "conversation") {
                hasConversationEvidence = true;
            } else if (provenance.kind === "vault_aggregate") {
                for (const sourceRef of provenance.representativeSourceRefs.slice(0, 3)) {
                    labels.push(this.t("plugin.settings.memoryControlCenter.source.representativeNote", {
                        path: sourceRef.path,
                    }));
                }
            }
        }
        if (hasConversationEvidence) {
            labels.push(this.t("plugin.settings.memoryControlCenter.source.conversation"));
        }
        return [...new Set(labels)];
    }

    private formatMemoryControlCenterSource(origin: MemoryControlCenterOrigin): string {
        switch (origin) {
            case "vault_insights":
            case "note_memory":
                return this.t("plugin.settings.memoryControlCenter.source.vaultInsights");
            case "user_profile":
            case "collaboration_preference":
            case "recent_context":
                return this.t("plugin.settings.memoryControlCenter.source.userProfile");
            case "confirmed_memory":
                return this.t("plugin.settings.memoryControlCenter.source.confirmedMemory");
        }
    }

    private formatMemoryControlCenterEffect(effect: MemoryControlCenterEffect): string {
        switch (effect) {
            case "none":
                return this.t("plugin.settings.memoryControlCenter.effect.none");
            case "stored_not_in_use":
                return this.t("plugin.settings.memoryControlCenter.effect.storedNotInUse");
            case "retrieval_only":
                return this.t("plugin.settings.memoryControlCenter.effect.retrievalOnly");
            case "future_answers":
                return this.t("plugin.settings.memoryControlCenter.effect.futureAnswers");
            case "collaboration_default":
                return this.t("plugin.settings.memoryControlCenter.effect.collaborationDefault");
        }
    }

    private formatMemoryControlCenterAuthority(
        authority: MemoryControlCenterItem["authority"],
    ): string {
        switch (authority) {
            case "source_observation":
                return this.t("plugin.settings.memoryControlCenter.authority.sourceObservation");
            case "pa_inference":
                return this.t("plugin.settings.memoryControlCenter.authority.paInference");
            case "explicit_user":
                return this.t("plugin.settings.memoryControlCenter.authority.explicitUser");
            case "user_correction":
                return this.t("plugin.settings.memoryControlCenter.authority.userCorrection");
        }
    }

    private formatMemoryControlCenterCoverage(
        coverage: "exact" | "representative" | "aggregate_only",
    ): string {
        switch (coverage) {
            case "exact":
                return this.t("plugin.settings.memoryControlCenter.coverage.exact");
            case "representative":
                return this.t("plugin.settings.memoryControlCenter.coverage.representative");
            case "aggregate_only":
                return this.t("plugin.settings.memoryControlCenter.coverage.aggregateOnly");
        }
    }

    private formatMemoryControlCenterLifecycle(lifecycle: MemoryControlCenterLifecycle): string {
        switch (lifecycle) {
            case "derived": return this.t("plugin.settings.memoryControlCenter.status.derived");
            case "active": return this.t("plugin.settings.memoryControlCenter.status.active");
            case "archived": return this.t("plugin.settings.memoryControlCenter.status.archived");
            case "paused": return this.t("plugin.settings.memoryControlCenter.status.paused");
            case "forget_pending": return this.t("plugin.settings.memoryControlCenter.status.forgetPending");
            case "stale": return this.t("plugin.settings.memoryControlCenter.status.stale");
            case "exported": return this.t("plugin.settings.memoryControlCenter.status.exported");
            case "forgotten_marker": return this.t("plugin.settings.memoryControlCenter.status.forgotten");
        }
    }

    private formatMemoryControlCenterStatus(status: string): string {
        switch (status) {
            case "disabled": return this.t("plugin.settings.memoryControlCenter.status.disabled");
            case "unknown": return this.t("plugin.settings.memoryControlCenter.status.unknown");
            case "unprepared": return this.t("plugin.settings.memoryControlCenter.status.unprepared");
            case "preparing": return this.t("plugin.settings.memoryControlCenter.status.preparing");
            case "ready": return this.t("plugin.settings.memoryControlCenter.status.ready");
            case "stale": return this.t("plugin.settings.memoryControlCenter.status.stale");
            case "error": return this.t("plugin.settings.memoryControlCenter.status.error");
            case "not_loaded": return this.t("plugin.settings.memoryControlCenter.status.notLoaded");
            case "stale_boundary": return this.t("plugin.settings.memoryControlCenter.status.staleBoundary");
            case "loading": return this.t("plugin.settings.memoryControlCenter.status.loading");
            case "blocked": return this.t("plugin.settings.memoryControlCenter.status.blocked");
            case "unavailable": return this.t("plugin.settings.memoryControlCenter.status.unavailable");
            case "empty": return this.t("plugin.settings.memoryControlCenter.status.empty");
            default: return this.t("plugin.settings.memoryControlCenter.status.error");
        }
    }

    private formatMemoryControlCenterTimestamp(value: string): string {
        const date = new Date(value);
        if (!Number.isFinite(date.getTime())) return value;
        return new Intl.DateTimeFormat(getPluginUiLanguage() === "zh" ? "zh-CN" : "en", {
            dateStyle: "medium",
            timeStyle: "short",
        }).format(date);
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

        if ((plugin.getMemoryGovernanceUiMode?.() ?? "legacy_threshold") === "legacy_threshold"
            && getMemoryTrustLevel(normalizeConfirmedMemoryCount(plugin.settings.confirmedMemoryCount)) >= 2) {
            new Setting(container)
                .setName(this.t("plugin.settings.memory.autoAccept.name"))
                .setDesc(this.t("plugin.settings.memory.autoAccept.desc"))
                .addToggle((toggle) => {
                    toggle
                        .setValue(!plugin.settings.memoryAutoAcceptPaused)
                        .onChange(async (value) => {
                            const previousPaused = plugin.settings.memoryAutoAcceptPaused;
                            try {
                                await plugin.setMemoryAutoAcceptPaused(!value);
                            } catch (error) {
                                toggle.setValue(!previousPaused);
                                plugin.log("Failed to persist automatic Memory setting", error);
                                new Notice(this.t("plugin.settings.memory.autoAccept.saveFailed"), 5000);
                            }
                        });
                });
        }

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
                            plugin.settings.memoryExtractionConsent = {
                                state: "confirmed",
                                version: MEMORY_EXTRACTION_CONSENT_VERSION,
                                confirmedAt: new Date().toISOString(),
                            };
                        }
                        if (!value) {
                            plugin.settings.memoryExtractionConsent = {
                                state: "paused",
                                version: MEMORY_EXTRACTION_CONSENT_VERSION,
                                confirmedAt: plugin.settings.memoryExtractionConsent.confirmedAt,
                            };
                            plugin.settings.memoryExtractionIncludeVaultInsights = false;
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

        this.memoryAdvancedContainer = container.createDiv({ cls: "pa-settings-nested pa-settings-nested--level-2" });
        this.rebuildMemoryAdvanced();
        this.markFormControlSettings(container);
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
                    await plugin.showTechnicalMemoryStatus();
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
        if (!getDashScopeImageGenerationEndpoint(plugin.settings.baseURL)) return;

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
        new Setting(container)
            .setName(this.t("plugin.settings.featuredImage.model.name"))
            .setDesc(this.t("plugin.settings.featuredImage.model.desc"))
            .addDropdown((dropdown) => {
                dropdown
                    .addOption("wan2.7-image", this.t("plugin.settings.featuredImage.model.balanced"))
                    .addOption("wan2.7-image-pro", this.t("plugin.settings.featuredImage.model.quality"))
                    .setValue(normalizeFeaturedImageModel(plugin.settings.featuredImageModel))
                    .onChange((value) => {
                        plugin.settings.featuredImageModel = normalizeFeaturedImageModel(value);
                        this.debouncedSave();
                    });
            });
        new Setting(container).setName(this.t("plugin.settings.featuredImage.count.name"))
            .setDesc(this.t("plugin.settings.featuredImage.count.desc"))
            .addText(text => {
                text.setPlaceholder('1')
                    .setValue(normalizeFeaturedImageCount(plugin.settings.numFeaturedImages).toString())
                    .onChange((value) => {
                        plugin.settings.numFeaturedImages = normalizeFeaturedImageCount(value);
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
