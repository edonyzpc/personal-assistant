/* Copyright 2023 edonyzpc */

import { App, Modal, Notice, PluginSettingTab, Setting, debounce } from "obsidian";
import type { ToggleComponent } from "obsidian";
import { createSourceScopeSettingState, renderSourceScopeSetting } from "./settings/source-scope-setting";

import type { AIProviderConfigurationPatch, PluginManager } from "./plugin"
import type { AISetupResult } from "./chat/ChatHost";
import { getWritingSceneDisplayValues, normalizeWritingScene } from './chat/writing-style-service';
import type { WritingStyleScene } from './pa/writing-style';
import { DEFAULT_NOTE_TEMPLATE } from "./note-template";
import { isRecord } from "./pa/helpers";
import { getDashScopeImageGenerationEndpoint, isDashScopeCompatibleBaseURL } from "./ai-services/ai-utils";
import { confirmUserAction } from "./confirm";
import {
    PAGELET_DEFAULTS,
    mergePageletSettings,
    renderPageletPreferences,
    renderPageletNotePrivacy,
    type PageletSettings,
    type PageletSettingFactory,
} from "./settings/pagelet";
import { getPageletUiLanguage } from "./locales/pagelet";
import { getPluginUiLanguage, pluginT, type PluginMessageKey } from "./locales/plugin";
import { LEGACY_CONFIG_DIR } from "./obsidian-paths";
import { getPlatformDocument } from "./platform-dom";
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
import SOURCE_HAN_SERIF_OFL_TEXT from "../licenses/source-han-serif-OFL-1.1.txt";

export const BUNDLED_SHARE_CARD_FONT_LICENSE_TEXT = SOURCE_HAN_SERIF_OFL_TEXT;

class BundledFontLicenseModal extends Modal {
    constructor(
        app: App,
        private readonly title: string,
    ) {
        super(app);
    }

    onOpen(): void {
        this.modalEl.addClass("pa-bundled-font-license-modal-shell");
        this.titleEl.setText(this.title);
        const licenseEl = this.contentEl.createEl("pre", {
            cls: "pa-bundled-font-license-text",
        });
        licenseEl.textContent = BUNDLED_SHARE_CARD_FONT_LICENSE_TEXT;
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

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

interface WeeklyReviewSettings {
    enabled: boolean;
    preparedReviewEnabled: boolean;
}

const WEEKLY_REVIEW_DEFAULTS: Readonly<WeeklyReviewSettings> = Object.freeze({
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
    author: string;
    noteTemplate: string;
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
    metadatas: { key: string, value: string, t: string }[];
    metadataExcludePath: string[];
    cachePluginRepo: Record<string, string>;
    cacheThemeRepo: Record<string, string>;
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
    memoryApprovalPolicy: "always" | "auto-refresh-after-prepare";
    showAdvancedMemoryControls: boolean;
    qwenThinkingEnabled: boolean;
    webSearchEnabled: boolean;
    licenseTier: AgentCapabilityTier;
    shareAnonymousCapabilityUsage: boolean;
    featuredImagePath: string;
    featuredImageModel: FeaturedImageModel;
    numFeaturedImages: number;
    memoryExtractionEnabled: boolean;
    memoryExtractionNoticeDismissed: boolean;
    memoryExtractionIncludeVaultInsights: boolean;
    memoryExtractionConsent: MemoryExtractionConsentSettings;
    vssCacheExcludePath: string[];
    /** Internal rollback controls for B-125. Absent values use build defaults. */
    retrievalOptimizationFlags?: {
        lexicalProfile?: boolean;
        strictReranker?: boolean;
        graphPpr?: boolean;
        relaxedRecovery?: boolean;
    };
    /** Operations Agent mode (Beta): allow staged, user-confirmed core vault writes. */
    operationsAgentEnabled: boolean;
    /** Offer at most one quiet save suggestion in a qualifying conversation. */
    operationsProactiveSaveSuggestionsEnabled: boolean;
    /** Explicit privacy opt-in for before/after content in Operations audit files. */
    operationsAuditIncludeContent: boolean;
    /** Operations audit retention window. */
    operationsAuditRetentionDays: 30 | 90;
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
    author: "",
    noteTemplate: "",
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
    memoryApprovalPolicy: "always",
    showAdvancedMemoryControls: false,
    qwenThinkingEnabled: false,
    webSearchEnabled: false,
    licenseTier: MOCK_LICENSE_TIER,
    shareAnonymousCapabilityUsage: false,
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
    operationsProactiveSaveSuggestionsEnabled: true,
    operationsAuditIncludeContent: false,
    operationsAuditRetentionDays: 30,
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

const QWEN_RESPONSE_OPTIONS_DASHSCOPE_DESC =
    "Qwen thinking and builtin WebSearch require Alibaba Cloud DashScope. They do not change Memory from your notes.";
const QWEN_RESPONSE_OPTIONS_NON_DASHSCOPE_DESC =
    "Qwen thinking and builtin WebSearch are available only with the DashScope OpenAI-compatible base URL.";
export const STATISTICS_SYNC_SETTING_DESC =
    "Creates Statistics history files inside this plugin's vault folder so writing history can sync across devices. Leave off to avoid ongoing Git changes from synced history.";
const PREVIEW_LIMITS_MAX = 100;
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

const DEPRECATED_SIMPLE_SETTINGS_KEYS = [
    "memoryAutoCheckBeforeChat", "skillContextEnabled", "enabledSkillIds",
] as const;
const DEPRECATED_PAGELET_SETTINGS_KEYS = ["preloadEnabled", "deepDiscoverEnabled"] as const;

export function hasDeprecatedSimpleSettingsFields(value: unknown): boolean {
    if (!isRecord(value)) return false;
    return DEPRECATED_SIMPLE_SETTINGS_KEYS.some((key) => Object.prototype.hasOwnProperty.call(value, key))
        || (isRecord(value.pagelet)
            && DEPRECATED_PAGELET_SETTINGS_KEYS.some((key) => Object.prototype.hasOwnProperty.call(value.pagelet, key)));
}

/** Exact, idempotent save projection. Never normalize consent or unrelated data here. */
export function omitDeprecatedSimpleSettingsFields<T extends object>(settings: T): T {
    const canonical = { ...settings } as T & Record<string, unknown>;
    for (const key of DEPRECATED_SIMPLE_SETTINGS_KEYS) delete canonical[key];
    if (isRecord(canonical.pagelet)) {
        const pagelet = { ...canonical.pagelet };
        for (const key of DEPRECATED_PAGELET_SETTINGS_KEYS) delete pagelet[key];
        Object.assign(canonical, { pagelet });
    }
    return canonical;
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
    const loadedObject = omitDeprecatedSimpleSettingsFields(isRecord(loaded) ? loaded : {});
    const loadedPagelet = isRecord(loadedObject.pagelet) ? loadedObject.pagelet : {};
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
    const loadedRetrievalFlags = isRecord(loadedObject.retrievalOptimizationFlags)
        ? loadedObject.retrievalOptimizationFlags
        : undefined;
    merged.retrievalOptimizationFlags = loadedRetrievalFlags
        ? {
            lexicalProfile: typeof loadedRetrievalFlags.lexicalProfile === "boolean"
                ? loadedRetrievalFlags.lexicalProfile
                : undefined,
            strictReranker: typeof loadedRetrievalFlags.strictReranker === "boolean"
                ? loadedRetrievalFlags.strictReranker
                : undefined,
            graphPpr: typeof loadedRetrievalFlags.graphPpr === "boolean"
                ? loadedRetrievalFlags.graphPpr
                : undefined,
            relaxedRecovery: typeof loadedRetrievalFlags.relaxedRecovery === "boolean"
                ? loadedRetrievalFlags.relaxedRecovery
                : undefined,
        }
        : undefined;
    merged.colorGroups = normalizeGraphColorArray(loadedObject.colorGroups, DEFAULT_SETTINGS.colorGroups);
    merged.metadatas = normalizeMetadataArray(loadedObject.metadatas, DEFAULT_SETTINGS.metadatas);
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
    merged.operationsAgentEnabled = loadedObject.operationsAgentEnabled === true;
    merged.operationsProactiveSaveSuggestionsEnabled =
        typeof loadedObject.operationsProactiveSaveSuggestionsEnabled === "boolean"
            ? loadedObject.operationsProactiveSaveSuggestionsEnabled
            : DEFAULT_SETTINGS.operationsProactiveSaveSuggestionsEnabled;
    merged.operationsAuditIncludeContent = loadedObject.operationsAuditIncludeContent === true;
    merged.operationsAuditRetentionDays = loadedObject.operationsAuditRetentionDays === 90 ? 90 : 30;
    // Pagelet has its own per-field normalizer (8 fields, mixed types).
    // Delegating keeps the legacy merge focused on settings that predate
    // Pagelet and avoids polluting this file with Pagelet-specific bounds.
    merged.pagelet = mergePageletSettings(loadedPagelet);
    merged.quickCapture = mergeQuickCaptureSettings(loadedObject.quickCapture);
    merged.dataBoundary = mergeDataBoundarySettings(loadedObject.dataBoundary);
    merged.reviewQueue = mergeReviewQueueSettings(loadedObject.reviewQueue);
    merged.contextPager = mergeContextPagerSettings(loadedObject.contextPager);
    merged.savedInsights = mergeSavedInsightSettings(loadedObject.savedInsights);
    merged.memoryGovernance = mergeMemoryGovernanceSettings(loadedObject.memoryGovernance);
    merged.maintenanceReview = mergeMaintenanceReviewSettings(loadedObject.maintenanceReview);
    merged.weeklyReview = mergeWeeklyReviewSettings(loadedObject.weeklyReview);
    // A short-lived B-118 settings shape persisted the visible toggle under
    // `pagelet.quietRecallMode` while runtime consumed `quietRecall` instead.
    // An explicit canonical mode is authoritative. When that field is absent,
    // absorb the stale mirror before falling back to the older boolean
    // migration. `mergePageletSettings` deliberately drops the mirror, so the
    // next save leaves a single persisted source of truth.
    const migratedPageletQuietRecallMode = loadedPagelet.quietRecallMode === "on"
        || loadedPagelet.quietRecallMode === "off"
        ? loadedPagelet.quietRecallMode
        : undefined;
    merged.quietRecall = mergeQuietRecallSettings(
        loadedObject.quietRecall,
        migratedPageletQuietRecallMode,
    );
    merged.lastPatternDetectionAt = typeof loadedObject.lastPatternDetectionAt === "string"
        && loadedObject.lastPatternDetectionAt.trim()
        ? loadedObject.lastPatternDetectionAt.trim()
        : undefined;
    merged.focusMode = typeof loadedObject.focusMode === "boolean" ? loadedObject.focusMode : false;
    merged.author = typeof loadedObject.author === "string" ? loadedObject.author.trim() : "";
    merged.noteTemplate = typeof loadedObject.noteTemplate === "string" ? loadedObject.noteTemplate.trim() : "";
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
 * True when the persisted data blob is a legacy v1.x candidate — it has data
 * but is missing the `aiProvider` field that Provider-aware versions always
 * write. The caller must still classify provider provenance from the raw blob;
 * this shape alone does not prove an earlier Qwen choice.
 */
export function isLegacyV1Install(loaded: unknown): boolean {
    if (loaded == null) return false;
    if (typeof loaded !== "object") return false;
    if (Array.isArray(loaded)) return false;
    const obj = loaded as Record<string, unknown>;
    if (Object.keys(obj).length === 0) return false;
    return obj.aiProvider === undefined;
}

function normalizeTrimmedStringArray(value: unknown, fallback: string[]): string[] {
    if (!Array.isArray(value)) return [...fallback];
    return [...new Set(value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean))];
}

function addsExclusions(previous: readonly string[], next: readonly string[]): boolean {
    const previousSet = new Set(previous);
    return next.some((value) => !previousSet.has(value));
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

export function mergeQuietRecallSettings(
    loaded: unknown,
    legacyPageletMode?: QuietRecallMode,
): QuietRecallSettings {
    const loadedObject = isRecord(loaded) ? loaded : {};
    const legacyBubbleNudgesEnabled = typeof loadedObject.bubbleNudgesEnabled === "boolean"
        ? loadedObject.bubbleNudgesEnabled
        : undefined;
    const bubbleNudgesEnabled = legacyBubbleNudgesEnabled
        ?? QUIET_RECALL_DEFAULTS.bubbleNudgesEnabled;
    // SG-01 migration: old bubbleNudgesEnabled: true → "on"; false/missing → "off"
    let quietRecallMode: QuietRecallMode;
    if (loadedObject.quietRecallMode === "on" || loadedObject.quietRecallMode === "off") {
        quietRecallMode = loadedObject.quietRecallMode;
    } else if (legacyPageletMode === "on" || legacyPageletMode === "off") {
        quietRecallMode = legacyPageletMode;
    } else if (legacyBubbleNudgesEnabled !== undefined) {
        quietRecallMode = legacyBubbleNudgesEnabled ? "on" : "off";
    } else {
        quietRecallMode = QUIET_RECALL_DEFAULTS.quietRecallMode;
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
        .filter((entry): entry is { key: string; value: string; t: string } =>
            isRecord(entry)
            && typeof entry.key === "string"
            && typeof entry.value === "string"
            && typeof entry.t === "string")
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
    private log: (...msg: unknown[]) => void;

    // Sub-containers for incremental rebuilds (avoids full display() re-render).
    private providerConfigContainer: HTMLDivElement | null = null;
    private qwenOptionsContainer: HTMLDivElement | null = null;
    private memorySubContainer: HTMLDivElement | null = null;
    private memoryAdvancedContainer: HTMLDivElement | null = null;
    private metadataContainer: HTMLDivElement | null = null;
    private featuredImageContainer: HTMLDivElement | null = null;
    private featureOptionsModal: Modal | null = null;
    private pageletSaveLocationContainer: HTMLElement | null = null;
    private pageletSourceExclusionsContainer: HTMLElement | null = null;
    private memoryModelTextControl: { setValue(value: string): unknown } | null = null;
    private apiTokenSecretModal: (Modal & { closeSafely(): void }) | null = null;
    private memoryControlCenterGeneration = 0;
    // Replayed deep links may resolve absence only after the current snapshot renders.
    private memoryControlCenterSnapshotReady = false;
    private memoryControlCenterRefresh: (() => void) | null = null;
    private memoryRecoveryContainer: HTMLElement | null = null;
    private pageletPreferencesContainer: HTMLElement | null = null;
    private pendingSettingsGroup: { id: string; targetId?: string } | null = null;
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
    private aiProviderPresetDropdown: { setValue(value: string): unknown } | null = null;

    // Set by rebuildQwenOptions(); invoked by Base URL onChange.
    private refreshQwenResponseOptionAvailability: ((baseURL?: string) => void) | null = null;

    // Provider tuple fields use their own draft so typing stays responsive
    // without exposing an unpersisted tuple to Chat. The external mutation
    // epoch is claimed on every edit; the merged tuple enters the shared AI
    // configuration transaction queue after the normal 400ms debounce.
    private pendingAIProviderConfigurationPatch: AIProviderConfigurationPatch | null = null;
    private pendingAIProviderConfigurationEpoch: number | null = null;
    private latestAIProviderConfigurationDraft: AIProviderConfigurationPatch | null = null;
    private latestAIProviderConfigurationEpoch: number | null = null;
    private debouncedAIProviderSaveRunner = debounce(() => {
        this.flushPendingAIProviderConfiguration();
    }, 400, true);

    // Coalesces saveSettings() across keystrokes in non-provider text inputs.
    // Each onChange mutates plugin.settings.* synchronously, then calls
    // debouncedSave(); the actual disk write is deferred 400ms past the last
    // keystroke. hide() cancels the timer and forces one final save so a user
    // who closes the tab mid-edit doesn't lose their input.
    //
    // Toggle / Dropdown / Button onChange handlers still save immediately —
    // those are discrete user actions where each value flip is meaningful and
    // some of them rebuild dependent UI (e.g. enableGraphColors,
    // enableMetadataUpdating, aiProvider).
    private hasPendingSettingsSave = false;
    private settingsEditRevision = 0;
    private settingsSaveError = false;
    private providerSaveError = false;
    private settingsVisible = false;
    private metadataRenderRevision = 0;
    private settingsSaveFeedback: HTMLElement | null = null;
    private sourceScopeStates = {
        folders: createSourceScopeSettingState(),
        tags: createSourceScopeSettingState(),
        memory: createSourceScopeSettingState(),
        metadata: createSourceScopeSettingState(),
        pagelet: {
            excludedFolders: createSourceScopeSettingState(),
            excludedTags: createSourceScopeSettingState(),
            excludedPatterns: createSourceScopeSettingState(),
        },
    };
    // A pending permission belongs to this tab, not to one rendered control.
    // Reopening Settings must reflect the same transaction until it settles.
    private permissionControls = new Map<string, {
        saving: boolean;
        sync: (() => void) | null;
        refresh: (() => void) | null;
    }>();
    private debouncedSaveRunner = debounce(() => {
        void this.savePendingSettings();
    }, 400, true);

    constructor(app: App, plugin: PluginManager) {
        super(app, plugin);
        this.plugin = plugin;
        this.log = (...msg: unknown[]) => plugin.log(...msg);
    }

    openGroup(groupId: string, memoryTargetId?: string): void {
        const requestedId = groupId.trim();
        const normalizedTargetId = memoryTargetId?.trim();
        const normalizedId = requestedId === "memory-personalization"
            ? normalizedTargetId === "memory-data-recovery" ? "system" : "data-privacy"
            : requestedId === "appearance" ? "data-privacy" : requestedId;
        if (!normalizedId) return;
        if (normalizedTargetId) {
            this.pendingMemoryControlCenterTargetId = normalizedTargetId;
        }
        const details = this.containerEl.querySelector(`#pa-settings-group-${normalizedId}`);
        if (!details || details.tagName.toLowerCase() !== "details") {
            this.pendingSettingsGroup = { id: requestedId, targetId: normalizedTargetId };
            return;
        }
        this.pendingSettingsGroup = null;
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
        if (requestedId === "memory-personalization" && !normalizedTargetId) {
            this.expandSettingsTarget(this.containerEl.querySelector("#pa-settings-memory-management"));
        } else if (requestedId === "appearance") {
            this.expandSettingsTarget(this.containerEl.querySelector("#pa-settings-save-format"));
        }
        this.focusPendingMemoryControlCenterTarget(this.memoryControlCenterSnapshotReady);
    }

    refreshPageletSettingsIfVisible(): boolean {
        const ownerDocument = (this.containerEl as HTMLElement).ownerDocument;
        if (!ownerDocument?.body?.classList.contains("pa-settings-tab-open")) return false;
        if (!this.pageletPreferencesContainer?.isConnected) return false;
        this.pageletPreferencesContainer.empty();
        this.renderPageletSection(this.pageletPreferencesContainer);
        this.markFormControlSettings(this.pageletPreferencesContainer);
        return true;
    }

    private refreshMemoryControlCenter(): void {
        this.memoryControlCenterRefresh?.();
    }

    private createSettingsDetail(
        parent: HTMLElement,
        labelKey: PluginMessageKey,
        id?: string,
        legacyGroup?: string,
    ): HTMLDivElement {
        const details = parent.createEl("details", {
            cls: "pa-settings-detail",
            attr: id ? { id } : {},
        });
        details.open = legacyGroup ? !this.isGroupCollapsed(legacyGroup) : false;
        if (legacyGroup) details.addEventListener("toggle", () => {
            this.persistGroupCollapseState(legacyGroup, !details.open);
        });
        details.createEl("summary", { text: this.t(labelKey) });
        return details.createDiv({ cls: "pa-settings-detail__body" });
    }

    private expandSettingsTarget(target: Element | null): void {
        if (!target) return;
        let ancestor: Element | null = target;
        while (ancestor && ancestor !== this.containerEl) {
            if (ancestor.tagName.toLowerCase() === "details") {
                (ancestor as HTMLDetailsElement).open = true;
            }
            ancestor = ancestor.parentElement;
        }
        const focus = target.tagName.toLowerCase() === "details"
            ? target.querySelector("summary") : target;
        (focus as HTMLElement | null)?.focus?.({ preventScroll: true });
        (focus as HTMLElement | null)?.scrollIntoView?.({ behavior: this.settingsScrollBehavior(), block: "center" });
    }

    private t(key: PluginMessageKey, params?: Readonly<Record<string, string | number>>, fallback?: string): string {
        return pluginT(key, getPluginUiLanguage(), params, fallback);
    }

    display(): void {
        this.settingsVisible = true;
        const { containerEl } = this;
        const doc = (containerEl as HTMLElement).ownerDocument ?? getPlatformDocument();
        this.memoryControlCenterGeneration += 1;
        this.memoryControlCenterSnapshotReady = false;
        this.clearPermissionControlBindings();
        this.clearSourceScopeBindings();
        this.memoryControlCenterRefresh = null;
        this.memoryRecoveryContainer = null;
        this.pageletPreferencesContainer = null;
        this.pageletSaveLocationContainer = null;
        this.pageletSourceExclusionsContainer = null;

        this.stopSettingsNavigation();
        containerEl.empty();
        (containerEl as HTMLElement & { addClass?: (cls: string) => void }).addClass?.("pa-settings-tab");
        (containerEl as HTMLElement & { classList?: DOMTokenList }).classList?.add("pa-settings-tab");
        doc.body?.classList.add("pa-settings-tab-open");

        // Sub-container refs were children of containerEl; empty() detached them.
        this.providerConfigContainer = null;
        this.qwenOptionsContainer = null;
        this.memorySubContainer = null;
        this.memoryAdvancedContainer = null;
        this.metadataContainer = null;
        this.featuredImageContainer = null;
        this.memoryModelTextControl = null;
        this.aiProviderPresetDropdown = null;
        this.refreshQwenResponseOptionAvailability = null;

        const shell = containerEl.createDiv({ cls: "pa-settings-shell" });
        this.renderHeader(shell);
        this.settingsSaveFeedback = shell.createDiv({
            cls: "pa-settings-save-feedback",
            attr: { role: "status", "aria-live": "polite", "aria-atomic": "true" },
        });
        this.updateSettingsSaveFeedback();

        const groups: Array<{ id: string; labelKey: string; sections: Array<(parent: HTMLElement) => void> }> = [
            { id: "ai-provider", labelKey: "plugin.settings.group.aiProvider", sections: [
                (p) => this.renderAISection(p),
            ] },
            { id: "features", labelKey: "plugin.settings.group.features", sections: [
                (p) => {
                    this.pageletPreferencesContainer = p.createDiv();
                    this.renderPageletSection(this.pageletPreferencesContainer);
                },
                (p) => this.renderQuickCaptureSection(p),
                (p) => this.renderSaveSuggestionPreference(this.createSettingsDetail(p, "plugin.settings.simple.notifications")),
                (p) => this.renderStatisticsSection(this.createSettingsDetail(p, "plugin.settings.statistics.title")),
                (p) => this.renderGraphSection(p),
            ] },
            { id: "data-privacy", labelKey: "plugin.settings.group.dataPrivacy", sections: [
                (p) => this.renderMemorySection(p),
                (p) => this.renderRetrievalHabitSection(p),
                (p) => this.renderMemoryUpdatePreference(this.createSettingsDetail(p, "plugin.settings.memory.background.name")),
                (p) => this.renderMemoryControlCenterOverview(this.createSettingsDetail(
                    p, "plugin.settings.memoryControlCenter.title", "pa-settings-memory-management", "memory-personalization",
                )),
                (p) => {
                    const body = this.createSettingsDetail(p, "plugin.settings.dataBoundary.title");
                    this.renderDataBoundarySection(body);
                    this.pageletSourceExclusionsContainer = body.createDiv();
                },
                (p) => this.renderMemoryExclusions(this.createSettingsDetail(p, "plugin.settings.simple.memoryExclusions")),
                (p) => this.renderOperationsAgentSection(p),
                (p) => this.renderPrivacySharingSection(this.createSettingsDetail(p, "plugin.settings.simple.sharing")),
                (p) => {
                    const body = this.createSettingsDetail(p, "plugin.settings.simple.saveFormat", "pa-settings-save-format", "appearance");
                    this.renderRecordSection(body);
                    this.pageletSaveLocationContainer = body.createDiv();
                    this.renderFeaturedImageSection(body);
                },
            ] },
            { id: "system", labelKey: "plugin.settings.group.system", sections: [
                (p) => { this.memoryRecoveryContainer = p.createDiv(); },
                (p) => this.renderDataCleanupSection(this.createSettingsDetail(p, "plugin.settings.dataBoundary.cleanup.title")),
                (p) => {
                    this.memoryAdvancedContainer = this.createSettingsDetail(p, "plugin.settings.simple.memoryMaintenance");
                    this.rebuildMemoryAdvanced();
                },
                (p) => this.renderMetadataSection(this.createSettingsDetail(p, "plugin.settings.metadata.title")),
                (p) => this.renderAdvancedSection(this.createSettingsDetail(p, "plugin.settings.advanced.title")),
                (p) => this.renderLegalSection(this.createSettingsDetail(p, "plugin.settings.legal.title")),
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
        if (this.pageletSaveLocationContainer && this.pageletSourceExclusionsContainer) {
            const generation = this.memoryControlCenterGeneration;
            renderPageletNotePrivacy({ saveLocation: this.pageletSaveLocationContainer,
                sourceExclusions: this.pageletSourceExclusionsContainer }, this.plugin,
            { create: (container) => new Setting(container) as unknown as ReturnType<PageletSettingFactory["create"]> },
            getPageletUiLanguage(), { sourceScopeStates: this.sourceScopeStates.pagelet,
                isCurrent: () => this.settingsVisible && generation === this.memoryControlCenterGeneration });
        }
        this.setActiveSettingsGroup(groups[0]?.id ?? "");
        this.startSettingsNavigation(groups.map((group) => group.id));
        this.startSettingsNavigationOffsetTracking(jump);
        this.markFormControlSettings(containerEl);
        if (this.pendingSettingsGroup) {
            this.openGroup(this.pendingSettingsGroup.id, this.pendingSettingsGroup.targetId);
        }
    }

    hide(): void {
        this.settingsVisible = false;
        this.featureOptionsModal?.close();
        this.featureOptionsModal = null;
        // Obsidian invokes hide() when the user closes the settings tab.
        this.stopSettingsNavigation();
        const apiTokenSecretModal = this.apiTokenSecretModal;
        try {
            apiTokenSecretModal?.closeSafely();
        } catch {
            this.log("Failed to close API token editor with Settings");
        } finally {
            if (this.apiTokenSecretModal === apiTokenSecretModal) {
                this.apiTokenSecretModal = null;
            }
        }
        this.memoryControlCenterGeneration += 1;
        this.memoryControlCenterSnapshotReady = false;
        this.clearPermissionControlBindings();
        this.clearSourceScopeBindings();
        this.memoryControlCenterRefresh = null;
        const doc = (this.containerEl as HTMLElement).ownerDocument ?? getPlatformDocument();
        doc.body?.classList.remove("pa-settings-tab-open");
        this.debouncedSaveRunner.cancel();
        this.debouncedAIProviderSaveRunner.cancel();
        void this.savePendingSettings();
        this.flushPendingAIProviderConfiguration();
    }

    private debouncedSave(): void {
        this.settingsEditRevision += 1;
        this.hasPendingSettingsSave = true;
        this.settingsSaveError = false;
        this.updateSettingsSaveFeedback();
        this.debouncedSaveRunner();
    }

    private async savePendingSettings(): Promise<boolean> {
        if (!this.hasPendingSettingsSave) return true;
        const revision = this.settingsEditRevision;
        let saved = false;
        try {
            await this.plugin.saveSettings();
            saved = true;
            if (revision === this.settingsEditRevision) {
                this.hasPendingSettingsSave = false;
                this.settingsSaveError = false;
            }
        } catch (error) {
            if (revision === this.settingsEditRevision) this.settingsSaveError = true;
            this.log("Failed to persist Settings changes", error);
        }
        this.updateSettingsSaveFeedback();
        return saved;
    }

    private async saveImmediateSettings(): Promise<boolean> {
        this.settingsEditRevision += 1;
        this.hasPendingSettingsSave = true;
        this.settingsSaveError = false;
        this.updateSettingsSaveFeedback();
        return this.savePendingSettings();
    }

    private updateSettingsSaveFeedback(): void {
        const container = this.settingsSaveFeedback;
        if (!this.settingsVisible || !container || container.isConnected === false) return;
        container.empty();
        const failed = this.settingsSaveError || this.providerSaveError;
        const pending = this.hasPendingSettingsSave || this.latestAIProviderConfigurationDraft !== null;
        container.hidden = !failed && !pending;
        if (!failed && !pending) return;
        container.createSpan({ text: this.t(failed
            ? "plugin.settings.simple.saveFailed" : "plugin.settings.simple.saving") });
        if (!failed) return;
        const retry = container.createEl("button", {
            text: this.t("plugin.settings.memoryControlCenter.retry"), attr: { type: "button" },
        });
        retry.addEventListener("click", () => {
            retry.disabled = true;
            if (this.providerSaveError && this.latestAIProviderConfigurationDraft) {
                const pendingProvider = this.beginAIProviderConfigurationDraft(this.latestAIProviderConfigurationDraft);
                this.providerSaveError = false;
                void this.submitAIProviderConfiguration(pendingProvider.draft, pendingProvider.invocationEpoch);
            }
            if (this.settingsSaveError) {
                this.settingsSaveError = false;
                void this.savePendingSettings();
            }
            this.updateSettingsSaveFeedback();
        });
    }

    private configurePermissionToggle(
        key: string,
        toggle: ToggleComponent,
        read: () => boolean,
        save: (value: boolean) => Promise<void>,
        confirm?: (value: boolean) => Promise<boolean>,
        refresh?: () => void,
        disabled?: () => boolean,
    ): void {
        this.configurePermissionControl(key, toggle, read, save, confirm, refresh, disabled);
    }

    private clearPermissionControlBindings(): void {
        for (const state of this.permissionControls.values()) {
            state.sync = null;
            state.refresh = null;
        }
    }

    private clearSourceScopeBindings(): void {
        const { folders, tags, memory, metadata, pagelet } = this.sourceScopeStates;
        for (const state of [folders, tags, memory, metadata, ...Object.values(pagelet)]) {
            state.refresh = undefined;
        }
    }

    private configurePermissionControl<T extends boolean | string>(
        key: string,
        control: {
            setValue(value: T): unknown;
            setDisabled(disabled: boolean): unknown;
            onChange(callback: (value: T) => Promise<void>): unknown;
        },
        read: () => T,
        save: (value: T) => Promise<void>,
        confirm?: (value: T) => Promise<boolean>,
        refresh?: () => void,
        disabled?: () => boolean,
    ): void {
        const state = this.permissionControls.get(key) ?? { saving: false, sync: null, refresh: null };
        this.permissionControls.set(key, state);
        const generation = this.memoryControlCenterGeneration;
        let syncing = false;
        const sync = () => {
            if (generation !== this.memoryControlCenterGeneration) return;
            syncing = true;
            try {
                control.setValue(read());
                control.setDisabled(state.saving || Boolean(disabled?.()));
            } finally {
                syncing = false;
            }
        };
        state.sync = sync;
        state.refresh = refresh ?? null;
        sync();
        control.onChange(async (value) => {
            if (syncing || state.saving || disabled?.() || value === read()) return;
            state.saving = true;
            sync();
            try {
                if (confirm && !await confirm(value)) return;
                if (generation !== this.memoryControlCenterGeneration) return;
                await save(value);
                state.refresh?.();
            } catch (error) {
                this.log("Failed to save Settings permission", error);
                new Notice(this.t("plugin.settings.simple.permissionSaveFailed"), 5000);
            } finally {
                state.saving = false;
                state.sync?.();
            }
        });
    }

    private getEffectiveAIProviderConfiguration(): {
        aiProvider: string;
        aiProviderPreset?: string;
        baseURL: string;
        chatModelName: string;
        embeddingModelName: string;
    } {
        const draft = this.latestAIProviderConfigurationDraft;
        return {
            aiProvider: draft?.aiProvider ?? this.plugin.settings.aiProvider,
            aiProviderPreset: draft?.aiProviderPreset ?? this.plugin.settings.aiProviderPreset,
            baseURL: draft?.baseURL ?? this.plugin.settings.baseURL,
            chatModelName: draft?.chatModelName ?? this.plugin.settings.chatModelName,
            embeddingModelName: draft?.embeddingModelName ?? this.plugin.settings.embeddingModelName,
        };
    }

    private beginAIProviderConfigurationDraft(patch: AIProviderConfigurationPatch): {
        draft: AIProviderConfigurationPatch;
        invocationEpoch: number;
    } {
        const invocationEpoch = this.plugin.beginAIProviderConfigurationMutation();
        const draft = {
            ...this.getEffectiveAIProviderConfiguration(),
            ...patch,
        };
        this.latestAIProviderConfigurationDraft = draft;
        this.latestAIProviderConfigurationEpoch = invocationEpoch;
        this.providerSaveError = false;
        this.updateSettingsSaveFeedback();
        return { draft, invocationEpoch };
    }

    private queueAIProviderConfigurationPatch(patch: AIProviderConfigurationPatch): void {
        const pending = this.beginAIProviderConfigurationDraft(patch);
        this.pendingAIProviderConfigurationPatch = pending.draft;
        this.pendingAIProviderConfigurationEpoch = pending.invocationEpoch;
        this.debouncedAIProviderSaveRunner();
    }

    private flushPendingAIProviderConfiguration(): void {
        const patch = this.pendingAIProviderConfigurationPatch;
        const invocationEpoch = this.pendingAIProviderConfigurationEpoch;
        if (!patch || invocationEpoch === null) return;
        this.pendingAIProviderConfigurationPatch = null;
        this.pendingAIProviderConfigurationEpoch = null;
        void this.submitAIProviderConfiguration(patch, invocationEpoch);
    }

    private async submitAIProviderConfiguration(
        patch: AIProviderConfigurationPatch,
        invocationEpoch: number,
    ): Promise<AISetupResult> {
        let result: AISetupResult;
        try {
            result = await this.plugin.updateAIProviderConfiguration(patch, invocationEpoch);
        } catch (error) {
            this.log("Failed to persist AI provider changes", error);
            result = { ok: false, code: "settings_save_failed" };
        }
        this.settleAIProviderConfiguration(invocationEpoch, result);
        return result;
    }

    private settleAIProviderConfiguration(invocationEpoch: number, result: AISetupResult): void {
        if (this.latestAIProviderConfigurationEpoch !== invocationEpoch) return;
        if (result.ok) {
            this.latestAIProviderConfigurationDraft = null;
            this.latestAIProviderConfigurationEpoch = null;
            if (this.settingsVisible) this.refreshAIProviderConfigurationControls();
            this.updateSettingsSaveFeedback();
            return;
        }
        this.providerSaveError = true;
        this.updateSettingsSaveFeedback();

        this.log("Failed to persist AI provider changes", result.code);
        new Notice(this.t("plugin.settings.ai.provider.saveFailed"), 5000);
    }

    private refreshAIProviderConfigurationControls(): void {
        const settings = this.getEffectiveAIProviderConfiguration();
        this.aiProviderPresetDropdown?.setValue(
            settings.aiProvider ? deriveDisplayPreset(settings) : "",
        );
        this.rebuildProviderConfig();
        this.rebuildQwenOptions();
        // The embedding model is the only provider-dependent value inside the
        // Advanced Memory section. Preserve the rest of that section so an
        // in-flight confirmation keeps its live control and callback.
        this.memoryModelTextControl?.setValue(settings.embeddingModelName);
        this.rebuildFeaturedImage();
    }

    private isGroupCollapsed(groupId: string): boolean {
        const defaultCollapsed = groupId !== "ai-provider";
        try {
            const raw = localStorage.getItem("pa-settings-collapsed");
            if (!raw) return defaultCollapsed;
            const state = JSON.parse(raw) as unknown;
            if (!state || typeof state !== "object" || Array.isArray(state)) {
                return defaultCollapsed;
            }
            const collapsed = (state as Record<string, unknown>)[groupId];
            return typeof collapsed === "boolean" ? collapsed : defaultCollapsed;
        } catch {
            return defaultCollapsed;
        }
    }

    private persistGroupCollapseState(groupId: string, collapsed: boolean): void {
        try {
            const raw = localStorage.getItem("pa-settings-collapsed");
            const parsed = raw ? JSON.parse(raw) as unknown : null;
            const state: Record<string, boolean> = parsed
                && typeof parsed === "object"
                && !Array.isArray(parsed)
                ? parsed as Record<string, boolean>
                : {};
            state[groupId] = collapsed;
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
            const win = (this.containerEl.ownerDocument ?? getPlatformDocument()).defaultView;
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

    private openApiTokenSecretEditor(): void {
        if (this.apiTokenSecretModal) {
            return;
        }
        const plugin = this.plugin;
        const app = this.app;
        const secretId = plugin.getAPITokenSecretId();
        let existing = "";
        try {
            existing = plugin.getConfiguredAPITokenSecret() ?? "";
        } catch {
            plugin.clearTokenCache();
            plugin.log("Failed to read API token");
            new Notice(this.t("plugin.settings.apiToken.modal.loadFailed"), 4000);
            return;
        }
        const translate = this.t.bind(this);
        const rebuildProviderConfig = () => this.rebuildProviderConfig();
        const releaseModal = (modal: Modal) => {
            if (this.apiTokenSecretModal === modal) {
                this.apiTokenSecretModal = null;
            }
        };

        class ApiTokenSecretModal extends Modal {
            private disposed = false;

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
                        text.inputEl.autocomplete = "off";
                        text.inputEl.autocapitalize = "none";
                        text.inputEl.spellcheck = false;
                        text.inputEl.setAttribute("autocorrect", "off");
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
                        let saving = false;
                        let completed = false;
                        button
                            .setButtonText(translate("plugin.settings.apiToken.modal.save"))
                            .setCta()
                            .onClick(async () => {
                                if (saving || completed) {
                                    return;
                                }
                                saving = true;
                                button.setDisabled(true);
                                try {
                                    const value = secretValue.trim();
                                    if (value === "") {
                                        if (!existing) {
                                            this.closeSafely();
                                            return;
                                        }
                                        let confirmed = false;
                                        try {
                                            confirmed = await confirmUserAction(app, {
                                                title: translate("plugin.settings.ai.apiToken.remove.title"),
                                                message: translate("plugin.settings.ai.apiToken.remove.message"),
                                                confirmText: translate("plugin.settings.ai.apiToken.remove.confirm"),
                                                cancelText: translate("plugin.settings.ai.apiToken.remove.cancel"),
                                            });
                                        } catch {
                                            plugin.log("Failed to confirm API token removal");
                                            new Notice(translate("plugin.settings.apiToken.modal.saveFailed"), 4000);
                                            return;
                                        }
                                        if (!confirmed || this.disposed) {
                                            return;
                                        }
                                    }

                                    try {
                                        plugin.setAPITokenSecret(value);
                                    } catch {
                                        plugin.log("Failed to save API token");
                                        try {
                                            rebuildProviderConfig();
                                        } catch {
                                            plugin.log("Failed to refresh API token setting");
                                        }
                                        try {
                                            await plugin.notifyAIReadinessChanged();
                                        } catch {
                                            plugin.log("Failed to notify AI readiness after API token change");
                                        }
                                        new Notice(translate("plugin.settings.apiToken.modal.saveFailed"), 4000);
                                        return;
                                    }
                                    completed = true;
                                    try {
                                        rebuildProviderConfig();
                                    } catch {
                                        plugin.log("Failed to refresh API token setting");
                                    }
                                    try {
                                        await plugin.notifyAIReadinessChanged();
                                    } catch {
                                        plugin.log("Failed to notify AI readiness after API token change");
                                    }
                                    this.closeSafely();
                                    if (value !== "") {
                                        new Notice(translate("plugin.settings.apiToken.modal.saved"), 3000);
                                    }
                                } finally {
                                    saving = false;
                                    button.setDisabled(false);
                                }
                            });
                    })
                    .addButton((button) => {
                        button
                            .setButtonText(translate("plugin.settings.apiToken.modal.cancel"))
                            .onClick(() => this.closeSafely());
                    });
            }

            onClose(): void {
                this.disposed = true;
                this.contentEl.empty();
                releaseModal(this);
            }

            closeSafely(): void {
                this.disposed = true;
                try {
                    this.close();
                } catch {
                    this.contentEl.empty();
                    this.modalEl.remove();
                    this.containerEl.remove();
                    plugin.log("Failed to close API token editor");
                } finally {
                    releaseModal(this);
                }
            }
        }

        const modal = new ApiTokenSecretModal(this.app);
        this.apiTokenSecretModal = modal;
        try {
            modal.open();
        } catch {
            modal.closeSafely();
            releaseModal(modal);
            plugin.log("Failed to open API token editor");
            new Notice(translate("plugin.settings.apiToken.modal.openFailed"), 4000);
        }
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
        const fileFormatSetting = new Setting(parentEl).setName(this.t("plugin.settings.record.fileFormat.name"))
            .addText(text => text.setPlaceholder('YYYY-MM-DD')
                .setValue(plugin.settings.fileFormat)
                .onChange((value) => {
                    this.log('format setting: ' + value);
                    plugin.settings.fileFormat = value;
                    this.debouncedSave();
                }));
        fileFormatSetting.descEl.createEl('p', undefined, (p) => {
            p.innerText = this.t("plugin.settings.record.fileFormat.descPrefix");
            p.createEl('a', undefined, (link) => {
                link.innerText = this.t("plugin.settings.record.fileFormat.link");
                link.href = 'https://momentjs.com/docs/#/displaying/format/';
            });
        });
        new Setting(parentEl).setName(this.t("plugin.settings.record.author.name"))
            .setDesc(this.t("plugin.settings.record.author.desc"))
            .addText(text => text
                .setPlaceholder('')
                .setValue(plugin.settings.author)
                .onChange((value) => {
                    plugin.settings.author = value.trim();
                    this.debouncedSave();
                }));
        new Setting(parentEl).setName(this.t("plugin.settings.record.noteTemplate.name"))
            .setDesc(this.t("plugin.settings.record.noteTemplate.desc"))
            .addTextArea(text => {
                text.setPlaceholder(DEFAULT_NOTE_TEMPLATE)
                    .setValue(plugin.settings.noteTemplate)
                    .onChange((value) => {
                        plugin.settings.noteTemplate = value;
                        this.debouncedSave();
                    });
                text.inputEl.rows = 12;
            });
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

        const enabledSetting = new Setting(parentEl).setName(this.t("plugin.settings.quickCapture.enabled.name"))
            .setDesc(this.t("plugin.settings.quickCapture.enabled.desc"));
        const children = parentEl.createDiv({ cls: "pa-settings-nested" });
        children.hidden = !plugin.settings.quickCapture.enabled;
        enabledSetting
            .addToggle(toggle => toggle
                .setValue(plugin.settings.quickCapture.enabled)
                .onChange((value) => {
                    plugin.settings.quickCapture.enabled = value;
                    children.hidden = !value;
                    this.debouncedSave();
                }));

        const destinationSetting = new Setting(children).setName(this.t("plugin.settings.quickCapture.destination.name"))
            .setDesc(this.t("plugin.settings.quickCapture.destination.desc"));
        const inbox = children.createDiv();
        inbox.hidden = plugin.settings.quickCapture.destination !== "inbox";
        destinationSetting
            .addDropdown(dropdown => dropdown
                .addOption("daily", this.t("plugin.settings.quickCapture.destination.daily"))
                .addOption("inbox", this.t("plugin.settings.quickCapture.destination.inbox"))
                .addOption("current-file", this.t("plugin.settings.quickCapture.destination.currentFile"))
                .setValue(plugin.settings.quickCapture.destination)
                .onChange((value) => {
                    plugin.settings.quickCapture.destination = normalizeQuickCaptureDestination(value);
                    inbox.hidden = plugin.settings.quickCapture.destination !== "inbox";
                    this.debouncedSave();
                }));

        new Setting(inbox).setName(this.t("plugin.settings.quickCapture.inboxPath.name"))
            .setDesc(this.t("plugin.settings.quickCapture.inboxPath.desc"))
            .addText(text => text
                .setPlaceholder(QUICK_CAPTURE_DEFAULTS.inboxPath)
                .setValue(plugin.settings.quickCapture.inboxPath)
                .onChange((value) => {
                    plugin.settings.quickCapture.inboxPath = normalizeQuickCaptureInboxPath(value);
                    this.debouncedSave();
                }));

        new Setting(children).setName(this.t("plugin.settings.quickCapture.postProcessing.name"))
            .setDesc(this.t("plugin.settings.quickCapture.postProcessing.desc"))
            .addToggle(toggle => this.configurePermissionToggle("quickCapture.postProcessingEnabled", toggle,
                () => plugin.settings.quickCapture.postProcessingEnabled,
                (value) => plugin.saveSettingsPermissions({ quickCapture: { postProcessingEnabled: value } })));
    }

    private renderDataBoundarySection(parentEl: HTMLElement): void {
        const plugin = this.plugin;
        parentEl.createEl("h2", { text: this.t("plugin.settings.dataBoundary.title") });
        parentEl.createEl("p", {
            text: this.t("plugin.settings.dataBoundary.desc"),
            cls: "pa-settings-section-desc-sm",
        });

        this.renderSourceExclusion(parentEl, new Setting(parentEl)
            .setName(this.t("plugin.settings.dataBoundary.excludedFolders.name"))
            .setDesc(this.t("plugin.settings.dataBoundary.excludedFolders.desc")),
        this.sourceScopeStates.folders, "private, archive/sensitive",
        () => plugin.settings.dataBoundary.excludedFolders,
        (next) => plugin.saveSettingsPermissions({ dataBoundary: { excludedFolders: next } }));

        this.renderSourceExclusion(parentEl, new Setting(parentEl)
            .setName(this.t("plugin.settings.dataBoundary.excludedTags.name"))
            .setDesc(this.t("plugin.settings.dataBoundary.excludedTags.desc")),
        this.sourceScopeStates.tags, "private, sensitive",
        () => plugin.settings.dataBoundary.excludedTags,
        (next) => plugin.saveSettingsPermissions({ dataBoundary: { excludedTags: next } }),
        (value) => normalizeTrimmedStringArray(value.split(","), [])
            .map((tag) => tag.replace(/^#/, "")).filter(Boolean));

        new Setting(parentEl)
            .setName(this.t("plugin.settings.dataBoundary.generatedNotes.name"))
            .setDesc(this.t("plugin.settings.dataBoundary.generatedNotes.desc"))
            .addDropdown(dropdown => {
                dropdown.addOption("exclude-generated", this.t("plugin.settings.dataBoundary.generatedNotes.exclude"))
                    .addOption("include-generated", this.t("plugin.settings.dataBoundary.generatedNotes.include"));
                this.configurePermissionControl("dataBoundary.generatedNotePolicy", dropdown,
                    () => plugin.settings.dataBoundary.generatedNotePolicy,
                    async (value) => {
                    const next = normalizeDataBoundaryGeneratedNotePolicy(value);
                    if (plugin.settings.dataBoundary.generatedNotePolicy === "include-generated"
                        && next === "exclude-generated") {
                        plugin.cancelActiveMemoryPreparation();
                    }
                    await plugin.saveSettingsPermissions({ dataBoundary: { generatedNotePolicy: next } });
                });
            });

        new Setting(parentEl)
            .setName(this.t("plugin.settings.dataBoundary.providerDisclosure.name"))
            .setDesc(this.t("plugin.settings.dataBoundary.providerDisclosure.desc"));

    }

    private renderRetrievalHabitSection(parentEl: HTMLElement): void {
        const plugin = this.plugin;
        parentEl.createEl("h3", { text: this.t("plugin.settings.retrievalHabit.title") });
        parentEl.createEl("p", {
            text: this.t("plugin.settings.retrievalHabit.desc"),
            cls: "pa-settings-section-desc-sm",
        });

        new Setting(parentEl)
            .setName(this.t("plugin.settings.retrievalHabit.enabled.name"))
            .setDesc(this.t("plugin.settings.retrievalHabit.enabled.desc"))
            .addToggle(toggle => this.configurePermissionToggle("retrievalHabitProfile.enabled", toggle,
                () => plugin.settings.retrievalHabitProfile.enabled,
                (value) => plugin.saveSettingsPermissions({ retrievalHabitProfile: { enabled: value } }),
                async (value) => !value || confirmUserAction(this.app, {
                            title: this.t("plugin.settings.retrievalHabit.enableConfirm.title"),
                            message: this.t("plugin.settings.retrievalHabit.enableConfirm.message"),
                            confirmText: this.t("plugin.settings.retrievalHabit.enableConfirm.confirm"),
                })));

        new Setting(parentEl)
            .setName(this.t("plugin.settings.retrievalHabit.clear.name"))
            .setDesc(this.t("plugin.settings.retrievalHabit.clear.desc"))
            .addButton(button => button
                .setButtonText(this.t("plugin.settings.retrievalHabit.clear.button"))
                .setDisabled(plugin.settings.retrievalHabitProfile.state.aggregates.length === 0)
                .onClick(async () => {
                    const generation = this.memoryControlCenterGeneration;
                    const confirmed = await confirmUserAction(this.app, {
                        title: this.t("plugin.settings.retrievalHabit.clearConfirm.title"),
                        message: this.t("plugin.settings.retrievalHabit.clearConfirm.message"),
                        confirmText: this.t("plugin.settings.retrievalHabit.clearConfirm.confirm"),
                    });
                    if (!confirmed || generation !== this.memoryControlCenterGeneration) return;
                    button.setDisabled(true);
                    try {
                        await plugin.saveSettingsPermissions({ retrievalHabitProfile: {
                            state: { aggregates: [], clearedAt: new Date().toISOString() },
                        } });
                        new Notice(this.t("plugin.settings.retrievalHabit.clear.done"), 4000);
                        this.refreshMemoryControlCenter();
                    } catch (error) {
                        plugin.log("Failed to clear local learning", error);
                        new Notice(this.t("plugin.settings.simple.permissionSaveFailed"), 5000);
                        if (generation === this.memoryControlCenterGeneration) button.setDisabled(false);
                    }
                }));

    }

    private renderDataCleanupSection(parentEl: HTMLElement): void {
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
        new Setting(parentEl)
            .setName(this.t("plugin.settings.graph.options.title"))
            .setDesc(this.t("plugin.settings.graph.options.nextOpenDesc"))
            .addButton((button) => button
                .setButtonText(this.t("plugin.settings.legal.open"))
                .onClick(() => { this.featureOptionsModal = this.plugin.openGraphOptions(); }));
    }

    private renderMetadataSection(parentEl: HTMLElement): void {
        const plugin = this.plugin;
        // setting options for updating metadata
        parentEl.createEl('h2', { text: this.t("plugin.settings.metadata.title") });
        const metadataSetting = new Setting(parentEl).setName(this.t("plugin.settings.metadata.enabled.name"))
            .addToggle(toggle => this.configurePermissionToggle("enableMetadataUpdating", toggle,
                () => plugin.settings.enableMetadataUpdating,
                (value) => plugin.saveSettingsPermissions({ enableMetadataUpdating: value }),
                undefined, () => this.rebuildMetadataList()));
        metadataSetting.descEl.createEl('p', undefined, (p) => {
            p.innerText = this.t("plugin.settings.metadata.descPrefix");
            p.createEl('a', undefined, (link) => {
                link.innerText = this.t("plugin.settings.metadata.descLink");
                link.href = 'https://momentjs.com/docs/#/displaying/format/';
            });
        });
        this.metadataContainer = parentEl.createDiv();
        this.rebuildMetadataList();
    }

    private rebuildMetadataList(): void {
        if (!this.metadataContainer) return;
        const renderRevision = ++this.metadataRenderRevision;
        this.sourceScopeStates.metadata.refresh = undefined;
        this.metadataContainer.empty();
        const plugin = this.plugin;
        if (!plugin.settings.enableMetadataUpdating) return;

        const container = this.metadataContainer;
        // deep copy metadata for rendering
        const metas = JSON.parse(JSON.stringify(plugin.settings.metadatas)) as PluginManagerSettings["metadatas"];
        new Setting(container).setName("---");
        for (let i = 0; i < metas.length; i++) {
            const index = this.findMetadata(metas[i].key);
            new Setting(container)
                .setName(`${metas[i].key}: `)
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
                        const generation = this.memoryControlCenterGeneration;
                        btn.setDisabled(true);
                        if (index > -1) {
                            this.log("removing metadata rule", plugin.settings.metadatas[index]);
                            plugin.settings.metadatas.splice(index, 1);
                        }
                        await this.saveImmediateSettings();
                        if (generation !== this.memoryControlCenterGeneration || container !== this.metadataContainer
                            || renderRevision !== this.metadataRenderRevision) return;
                        this.rebuildMetadataList();
                    });
                })
        }
        new Setting(container).setName("---");

        // Initialize with the dropdown's first option ("string") so a user who
        // clicks Add without touching the dropdown gets a valid type instead of
        // undefined being persisted to data.json.
        let key = "";
        let value = "";
        let t = "string";
        let pendingAddition: PluginManagerSettings["metadatas"][number] | null = null;
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
                    const generation = this.memoryControlCenterGeneration;
                    const trimmedKey = key.trim();
                    if (!trimmedKey) {
                        new Notice(this.t("plugin.settings.metadata.keyRequired"), 4000);
                        return;
                    }
                    this.log("adding new frontmatter");
                    const submitted = { key: trimmedKey, value, t };
                    if (!pendingAddition || pendingAddition.key !== trimmedKey
                        || pendingAddition.value !== value || pendingAddition.t !== t
                        || !plugin.settings.metadatas.includes(pendingAddition)) {
                        pendingAddition = submitted;
                        plugin.settings.metadatas.push(pendingAddition);
                    }
                    btn.setDisabled(true);
                    const saved = await this.saveImmediateSettings();
                    if (generation !== this.memoryControlCenterGeneration || container !== this.metadataContainer
                        || renderRevision !== this.metadataRenderRevision) return;
                    btn.setDisabled(false);
                    if (!saved || key.trim() !== submitted.key || value !== submitted.value || t !== submitted.t) return;
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
        this.renderSourceExclusion(container, new Setting(container)
            .setName(this.t("plugin.settings.metadata.excludePath.name"))
            .setDesc(this.t("plugin.settings.metadata.excludePath.desc")),
        this.sourceScopeStates.metadata, "tmp/,notes/templates",
        () => plugin.settings.metadataExcludePath,
        (next) => plugin.saveSettingsPermissions({ metadataExcludePath: next }), undefined, false);
        this.markFormControlSettings(container);
    }

    private renderStatisticsSection(parentEl: HTMLElement): void {
        const plugin = this.plugin;
        // setting for show statistics
        parentEl.createEl('h2', { text: this.t("plugin.settings.statistics.title") });
        new Setting(parentEl).setName(this.t("plugin.settings.statistics.animation.name")).addToggle((cb) =>
            cb.setValue(plugin.settings.animation)
                .onChange((value) => {
                    plugin.settings.animation = value;
                    void this.saveImmediateSettings();
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
                        await this.saveImmediateSettings();
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
                        await this.saveImmediateSettings();
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
                this.aiProviderPresetDropdown = dropDown;
                const initialConfiguration = this.getEffectiveAIProviderConfiguration();
                if (!initialConfiguration.aiProvider) {
                    dropDown.addOption('', this.t("plugin.settings.ai.provider.choose"));
                }
                for (const [key, preset] of Object.entries(PROVIDER_PRESETS)) {
                    dropDown.addOption(key, preset.label);
                }

                const initialPreset = initialConfiguration.aiProvider
                    ? deriveDisplayPreset(initialConfiguration)
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

                    const currentConfiguration = this.getEffectiveAIProviderConfiguration();
                    if (currentConfiguration.aiProvider) {
                        const prevKey = deriveDisplayPreset(currentConfiguration);
                        if (value !== prevKey) {
                            const prev = PROVIDER_PRESETS[prevKey];
                            const hasCustomURL = prevKey === "custom"
                                ? currentConfiguration.baseURL !== ""
                                : Boolean(prev) && currentConfiguration.baseURL !== prev.baseURL;
                            const hasCustomModel = prevKey === "custom"
                                ? currentConfiguration.chatModelName !== ""
                                : Boolean(prev) && currentConfiguration.chatModelName !== prev.chatModelName;
                            const hasCustomMemoryModel = prevKey === "custom"
                                ? currentConfiguration.embeddingModelName !== ""
                                : Boolean(prev) && currentConfiguration.embeddingModelName !== prev.embeddingModelName;
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

                    if (plugin.getAPITokenCacheState() === "unknown") {
                        plugin.refreshAPITokenPresence();
                    }
                    plugin.cancelActiveMemoryPreparation();
                    this.debouncedAIProviderSaveRunner.cancel();
                    this.pendingAIProviderConfigurationPatch = null;
                    this.pendingAIProviderConfigurationEpoch = null;
                    const submission = this.beginAIProviderConfigurationDraft({
                        aiProvider: preset.runtimeProvider,
                        aiProviderPreset: value,
                        ...(value === "custom" ? {} : {
                            baseURL: preset.baseURL,
                            chatModelName: preset.chatModelName,
                            embeddingModelName: preset.embeddingModelName,
                        }),
                    });
                    await this.submitAIProviderConfiguration(
                        submission.draft,
                        submission.invocationEpoch,
                    );
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
        const root = this.providerConfigContainer;
        let container = root;
        const providerConfiguration = this.getEffectiveAIProviderConfiguration();

        if (!providerConfiguration.aiProvider) {
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
            .addButton((button) => {
                const tokenState = plugin.getAPITokenCacheState();
                const buttonKey = tokenState === "present"
                    ? "plugin.settings.apiToken.modal.editTitle"
                    : tokenState === "missing"
                        ? "plugin.settings.apiToken.modal.addTitle"
                        : "plugin.settings.apiToken.modal.manageTitle";
                button
                    .setButtonText(this.t(buttonKey))
                    .onClick(() => this.openApiTokenSecretEditor());
            });

        container = this.createSettingsDetail(root, "plugin.settings.simple.advancedConnection");
        const connectionDetails = container.parentElement as HTMLDetailsElement;
        connectionDetails.open = deriveDisplayPreset(providerConfiguration) === "custom";
        new Setting(container)
            .setName(this.t("plugin.settings.ai.baseUrl.name"))
            .setDesc(this.t("plugin.settings.ai.baseUrl.desc"))
            .addText((text) => {
                text.setPlaceholder("https://api.openai.com/v1");
                text.setValue(providerConfiguration.baseURL);
                text.onChange((value: string) => {
                    const current = this.getEffectiveAIProviderConfiguration();
                    const currentBaseURL = current.baseURL;
                    const currentPreset = current.aiProviderPreset;
                    if (value === currentBaseURL && currentPreset === "custom") return;
                    if (value !== currentBaseURL) {
                        plugin.cancelActiveMemoryPreparation();
                    }
                    this.queueAIProviderConfigurationPatch({
                        baseURL: value,
                        aiProviderPreset: "custom",
                    });
                    // Visual sync (enabling/disabling DashScope-only toggles)
                    // remains synchronous while the durable tuple is debounced.
                    this.refreshQwenResponseOptionAvailability?.(value);
                    this.rebuildFeaturedImage(value);
                });
            });

        new Setting(container)
            .setName(this.t("plugin.settings.ai.chatModel.name"))
            .setDesc(this.t("plugin.settings.ai.chatModel.desc"))
            .addText((text) => {
                text.setPlaceholder("gpt-4o-mini");
                text.setValue(providerConfiguration.chatModelName);
                text.onChange((value: string) => {
                    const current = this.getEffectiveAIProviderConfiguration();
                    const currentModel = current.chatModelName;
                    const currentPreset = current.aiProviderPreset;
                    if (value === currentModel && currentPreset === "custom") return;
                    this.queueAIProviderConfigurationPatch({
                        chatModelName: value,
                        aiProviderPreset: "custom",
                    });
                });
            });

        {
            const policyModelSetting = new Setting(container);
            (policyModelSetting as Setting & { settingEl?: HTMLElement }).settingEl?.addClass("pa-policy-model-setting");
            policyModelSetting
                .setName(this.t("plugin.settings.ai.policyModel.name"))
                .setDesc(this.t("plugin.settings.ai.policyModel.desc"))
                .addText((text) => {
                    text.setPlaceholder(providerConfiguration.chatModelName || "optional");
                    text.setValue(plugin.settings.policyModelName);
                    text.onChange((value: string) => {
                        plugin.settings.policyModelName = value.trim();
                        this.debouncedSave();
                    });
                });
        }
        this.renderMemoryModelField(container);
        this.markFormControlSettings(container);
    }

    private rebuildQwenOptions(): void {
        if (!this.qwenOptionsContainer) return;
        this.qwenOptionsContainer.empty();
        this.refreshQwenResponseOptionAvailability = null;

        const plugin = this.plugin;
        const providerConfiguration = this.getEffectiveAIProviderConfiguration();
        if (providerConfiguration.aiProvider !== 'qwen') return;

        const container = this.createSettingsDetail(this.qwenOptionsContainer, "plugin.settings.qwen.title");
        const qwenOptionToggles: QwenResponseOptionToggle[] = [];
        container.createEl('h3', { text: this.t("plugin.settings.qwen.title") });
        const qwenOptionsDescriptionEl = container.createEl("p", { cls: "pa-settings-section-desc-sm" });
        this.refreshQwenResponseOptionAvailability = (baseURL = providerConfiguration.baseURL) => {
            updateQwenResponseOptionAvailability(
                baseURL,
                qwenOptionsDescriptionEl,
                qwenOptionToggles,
                {
                    dashScopeDescription: this.t("plugin.qwen.desc.dashScope"),
                    nonDashScopeDescription: this.t("plugin.qwen.desc.nonDashScope"),
                },
            );
            this.permissionControls.get("webSearchEnabled")?.sync?.();
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
                        await this.saveImmediateSettings();
                    });
            });

        new Setting(container)
            .setName(this.t("plugin.settings.qwen.webSearch.name"))
            .setDesc(this.t("plugin.settings.qwen.webSearch.desc"))
            .addToggle((toggle) => {
                qwenOptionToggles.push(toggle);
                this.configurePermissionToggle("webSearchEnabled", toggle,
                    () => plugin.settings.webSearchEnabled,
                    (value) => plugin.saveSettingsPermissions({ webSearchEnabled: value }),
                    undefined, undefined,
                    () => !isDashScopeCompatibleBaseURL(this.getEffectiveAIProviderConfiguration().baseURL));
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
                        void this.saveImmediateSettings();
                    }));

    }

    private renderPrivacySharingSection(parentEl: HTMLElement): void {
        const plugin = this.plugin;
        new Setting(parentEl).setName(this.t("plugin.settings.statistics.sync.name"))
            .setDesc(this.t("plugin.settings.statistics.sync.desc"))
            .addToggle((toggle) => this.configurePermissionToggle("statisticsSyncEnabled", toggle,
                () => Boolean(plugin.settings.statisticsSyncEnabled),
                (value) => plugin.setStatisticsSyncEnabled(value)));
        new Setting(parentEl)
            .setName(this.t("plugin.settings.advanced.shareUsage.name"))
            .setDesc(this.t("plugin.settings.advanced.shareUsage.desc"))
            .addToggle((toggle) => this.configurePermissionToggle("shareAnonymousCapabilityUsage", toggle,
                () => plugin.settings.shareAnonymousCapabilityUsage,
                (value) => plugin.saveSettingsPermissions({ shareAnonymousCapabilityUsage: value })));
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
        new Setting(parentEl)
            .setName(this.t("plugin.settings.legal.fontLicense.name"))
            .setDesc(this.t("plugin.settings.legal.fontLicense.desc"))
            .addButton((button) => {
                button
                    .setButtonText(this.t("plugin.settings.legal.fontLicense.view"))
                    .onClick(() => {
                        new BundledFontLicenseModal(
                            this.app,
                            this.t("plugin.settings.legal.fontLicense.title"),
                        ).open();
                    });
            });
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
        renderPageletPreferences(
            parentEl,
            plugin as unknown as Parameters<typeof renderPageletPreferences>[1],
            factory,
            getPageletUiLanguage(),
        );
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
            .addToggle((toggle) => this.configurePermissionToggle("memoryEnabled", toggle,
                () => plugin.settings.memoryEnabled,
                async (value) => {
                    if (!value) plugin.cancelActiveMemoryPreparation();
                    await plugin.saveSettingsPermissions({ memoryEnabled: value });
                }, undefined, () => this.rebuildMemorySubSettings()));

        // Conversation learning is independent of using note Memory.
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

        let requestSequence = 0;
        const loadSnapshot = (focusStatus = false): void => {
            const request = ++requestSequence;
            this.memoryControlCenterSnapshotReady = false;
            const recovery = this.memoryRecoveryContainer;
            if (recovery) {
                recovery.empty();
                recovery.createEl("p", { text: this.t("plugin.settings.memoryControlCenter.loading"),
                    attr: { role: "status" } });
            }
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
                    if (generation !== this.memoryControlCenterGeneration || request !== requestSequence || body.isConnected === false) return;
                    body.empty();
                    body.setAttr("aria-busy", "false");
                    this.renderMemoryControlCenterSnapshot(body, snapshot);
                    const recovery = this.memoryRecoveryContainer;
                    if (recovery?.isConnected !== false && recovery) {
                        recovery.empty();
                        this.renderMemoryControlCenterUpgrade(recovery, snapshot);
                        this.renderMemoryControlCenterFinalization(recovery, snapshot);
                        this.renderMemoryControlCenterDataRecovery(recovery, snapshot);
                        this.markFormControlSettings(recovery);
                    }
                    this.memoryControlCenterSnapshotReady = true;
                    this.focusPendingMemoryControlCenterTarget(true);
                    this.markFormControlSettings(body);
                    liveStatus.setText(this.t("plugin.settings.memoryControlCenter.loaded", {
                        count: snapshot.items.length,
                    }));
                })
                .catch((error) => {
                    if (generation !== this.memoryControlCenterGeneration || request !== requestSequence || body.isConnected === false) return;
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
                    const recovery = this.memoryRecoveryContainer;
                    if (recovery) {
                        recovery.empty();
                        recovery.createEl("p", { text: message, attr: { role: "status" } });
                        recovery.createEl("button", {
                            text: this.t("plugin.settings.memoryControlCenter.retry"), attr: { type: "button" },
                        }).addEventListener("click", () => loadSnapshot(true));
                    }
                });
        };

        this.memoryControlCenterRefresh = () => loadSnapshot();
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
                        this.rebuildMemorySubSettings();
                        this.refreshMemoryControlCenter();
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
                    this.refreshMemoryControlCenter();
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

    private renderMemoryControlCenterUpgrade(parentEl: HTMLElement, snapshot: MemoryControlCenterSnapshot): void {
        if (snapshot.governanceMode !== "legacy_threshold") return;
        const section = parentEl.createDiv({ cls: "pa-memory-control-center__card" });
        section.createEl("h3", { text: this.t("plugin.settings.memoryControlCenter.upgrade.title") });
        section.createEl("p", { text: this.t("plugin.settings.memoryControlCenter.upgrade.desc") });
        const status = section.createEl("p", { attr: { role: "status", "aria-live": "polite" } });
        const button = section.createEl("button", { text: this.t("plugin.settings.memoryControlCenter.upgrade.action"), attr: { type: "button" } });
        button.addEventListener("click", () => {
            if (button.disabled) return;
            const generation = this.memoryControlCenterGeneration;
            button.disabled = true;
            status.textContent = this.t("plugin.settings.memoryControlCenter.upgrade.checking");
            void this.plugin.checkAndUpgradeMemoryGovernance().then((result) => {
                if (generation !== this.memoryControlCenterGeneration) return;
                status.textContent = result.message;
                if (result.ok) {
                    new Notice(result.message, 5000);
                    this.rebuildMemorySubSettings();
                    this.refreshMemoryControlCenter();
                    this.openGroup("memory-personalization");
                } else button.disabled = false;
            }).catch((error) => {
                this.log("Memory compatibility upgrade unavailable", error);
                if (generation !== this.memoryControlCenterGeneration) return;
                status.textContent = this.t("plugin.settings.memoryControlCenter.upgrade.unavailable");
                button.disabled = false;
            });
        });
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
                this.refreshMemoryControlCenter();
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
        if (item.writingStyle) {
            const details = article.createEl('details');
            details.createEl('summary', { text: getPluginUiLanguage() === 'zh' ? '风格样例' : 'Style example' });
            details.createEl('textarea', { text: item.writingStyle.exactText,
                cls: 'pa-memory-control-center__style-example', attr: { rows: '6', readonly: '', 'aria-label': getPluginUiLanguage() === 'zh' ? '完整风格样例' : 'Complete style example' } });
        }
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
            text: item.writingStyle?.exactText ?? item.label,
            attr: {
                rows: "3",
                "aria-label": this.t("plugin.settings.memoryControlCenter.action.correct"),
            },
        });
        const sceneInputs = {} as Record<keyof WritingStyleScene, HTMLInputElement>;
        if (item.writingStyle) {
            const displayScene = getWritingSceneDisplayValues(item.writingStyle.scene, getPluginUiLanguage());
            const labels = getPluginUiLanguage() === 'zh'
                ? { writingTask: '写作类型', purpose: '用途', audience: '读者', domain: '主题' }
                : { writingTask: 'Writing task', purpose: 'Purpose', audience: 'Audience', domain: 'Domain' };
            for (const key of Object.keys(labels) as Array<keyof WritingStyleScene>) {
                const label = editor.createEl('label', { text: labels[key] });
                sceneInputs[key] = label.createEl('input', { attr: { type: 'text', value: displayScene[key], maxlength: '64' } });
            }
        }
        const readScene = (): WritingStyleScene | null => item.writingStyle
            ? normalizeWritingScene(Object.fromEntries(Object.entries(sceneInputs).map(([key, value]) => [key, value.value]))) : null;
        const styleFeedback = item.writingStyle ? editor.createEl('p', { attr: { role: 'status' } }) : null;
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
            if (item.writingStyle) {
                const scene = readScene();
                const tooLong = new TextEncoder().encode(input.value).length > 8192;
                if (styleFeedback) styleFeedback.textContent = tooLong
                    ? getPluginUiLanguage() === 'zh' ? '风格样例过长，请缩短后保存。' : 'This style example is too long. Shorten it before saving.' : '';
                save.disabled = !input.value.trim() || tooLong || !scene
                    || (input.value === item.writingStyle.exactText && JSON.stringify(scene) === JSON.stringify(item.writingStyle.scene));
                return;
            }
            const summary = input.value.trim();
            save.disabled = !summary || summary === item.label.trim();
        };
        input.addEventListener("input", updateSaveAvailability);
        Object.values(sceneInputs).forEach((field) => field.addEventListener('input', updateSaveAvailability));
        updateSaveAvailability();
        save.addEventListener("click", () => {
            if (item.writingStyle) {
                const scene = readScene();
                if (!scene || save.disabled) return;
                void this.runMemoryControlCenterAction(save, 'correct', item.claimId!, input.value, input, scene);
                return;
            }
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
        writingStyleScene?: WritingStyleScene,
    ): Promise<void> {
        const generation = this.memoryControlCenterGeneration;
        button.disabled = true;
        try {
            const result = writingStyleScene && action === 'correct'
                ? await this.plugin.correctWritingStyleMemory(targetId, summary ?? '', writingStyleScene)
                : await this.plugin.runMemoryControlCenterAction(action, targetId, summary);
            new Notice(result.message, result.ok ? 3000 : 5000);
            if (!result.ok) {
                if (generation === this.memoryControlCenterGeneration) {
                    button.disabled = false;
                    (failureFocusEl ?? button).focus?.({ preventScroll: true });
                }
                return;
            }
            if (generation !== this.memoryControlCenterGeneration) return;
            this.refreshMemoryControlCenter();
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
            if (consumeIfMissing) {
                this.pendingMemoryControlCenterTargetId = null;
                this.openGroup("data-privacy");
                this.expandSettingsTarget(this.containerEl.querySelector("#pa-settings-memory-management"));
            }
            return;
        }
        this.expandSettingsTarget(target);
        target.setAttr("tabindex", "-1");
        (target as HTMLElement & { addClass?: (cls: string) => void })
            .addClass?.("pa-memory-control-center__item--targeted");
        target.classList?.add?.("pa-memory-control-center__item--targeted");
        target.scrollIntoView?.({ behavior: this.settingsScrollBehavior(), block: "center" });
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
        const plugin = this.plugin;

        const container = this.memorySubContainer;


        if (plugin.settings.memoryEnabled
            && (plugin.getMemoryGovernanceUiMode?.() ?? "legacy_threshold") === "legacy_threshold"
            && getMemoryTrustLevel(normalizeConfirmedMemoryCount(plugin.settings.confirmedMemoryCount)) >= 2) {
            new Setting(container)
                .setName(this.t("plugin.settings.memory.autoAccept.name"))
                .setDesc(this.t("plugin.settings.memory.autoAccept.desc"))
                .addToggle((toggle) => this.configurePermissionToggle("memoryAutoAcceptPaused", toggle,
                    () => !plugin.settings.memoryAutoAcceptPaused,
                    (value) => plugin.setMemoryAutoAcceptPaused(!value)));
        }

        new Setting(container)
            .setName(this.t("plugin.memoryExtraction.settings.enabled.name"))
            .setDesc(this.t("plugin.memoryExtraction.settings.enabled.desc")
                + (plugin.settings.memoryEnabled ? "" : ` ${this.t("plugin.settings.simple.learningPaused")}`))
            .addToggle((toggle) => this.configurePermissionToggle("memoryExtractionEnabled", toggle,
                () => plugin.settings.memoryExtractionEnabled,
                (value) => plugin.saveSettingsPermissions({
                    memoryExtractionEnabled: value,
                    memoryExtractionConsent: {
                        state: value ? "confirmed" : "paused",
                        version: MEMORY_EXTRACTION_CONSENT_VERSION,
                        confirmedAt: value ? new Date().toISOString() : plugin.settings.memoryExtractionConsent.confirmedAt,
                    },
                    ...(!value ? { memoryExtractionIncludeVaultInsights: false } : {}),
                }),
                async (value) => !value || confirmUserAction(this.app, {
                                title: this.t("plugin.memoryExtraction.settings.enableConfirm.title"),
                                message: this.t("plugin.memoryExtraction.settings.enableConfirm.message"),
                                confirmText: this.t("plugin.memoryExtraction.settings.enableConfirm.confirm"),
                }), () => this.rebuildMemorySubSettings()));

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
                .addToggle((toggle) => this.configurePermissionToggle("memoryExtractionIncludeVaultInsights", toggle,
                    () => plugin.settings.memoryExtractionIncludeVaultInsights,
                    (value) => plugin.saveSettingsPermissions({ memoryExtractionIncludeVaultInsights: value })));
        }

        this.markFormControlSettings(container);
    }

    private rebuildMemoryAdvanced(): void {
        if (!this.memoryAdvancedContainer) return;
        this.memoryAdvancedContainer.empty();
        const plugin = this.plugin;

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

        this.renderMemoryMaintenanceActions(container, getMemoryManager, getVss);
        this.markFormControlSettings(container);
    }

    private renderMemoryUpdatePreference(container: HTMLElement): void {
        const plugin = this.plugin;
        new Setting(container)
            .setName(this.t("plugin.settings.memory.background.name"))
            .setDesc(this.t("plugin.settings.memory.background.desc"))
            .addToggle((toggle) => this.configurePermissionToggle("memoryApprovalPolicy", toggle,
                () => plugin.settings.memoryApprovalPolicy === "auto-refresh-after-prepare",
                async (value) => {
                    await plugin.saveSettingsPermissions({ memoryApprovalPolicy: value ? "auto-refresh-after-prepare" : "always" });
                    if (value) {
                        plugin.memoryManager?.scheduleReconcile("settings");
                        plugin.memoryManager?.scheduleAutoFlush("settings");
                    }
                },
                async (value) => !value || confirmUserAction(this.app, {
                                title: this.t("plugin.settings.memory.background.title"),
                                message: this.t("plugin.settings.memory.background.message"),
                                confirmText: this.t("plugin.settings.memory.background.confirm"),
                })));
    }

    private renderMemoryModelField(container: HTMLElement): void {
        const plugin = this.plugin;
        const providerConfiguration = this.getEffectiveAIProviderConfiguration();
        new Setting(container)
            .setName(this.t("plugin.settings.memory.model.name"))
            .setDesc(this.t("plugin.settings.memory.model.desc"))
            .addText((text) => {
                this.memoryModelTextControl = text;
                text.setPlaceholder("model name");
                text.setValue(providerConfiguration.embeddingModelName);
                text.onChange((value: string) => {
                    const current = this.getEffectiveAIProviderConfiguration();
                    const currentModel = current.embeddingModelName;
                    const currentPreset = current.aiProviderPreset;
                    if (value === currentModel && currentPreset === "custom") return;
                    if (value !== currentModel) {
                        plugin.cancelActiveMemoryPreparation();
                    }
                    this.queueAIProviderConfigurationPatch({
                        embeddingModelName: value,
                        aiProviderPreset: "custom",
                    });
                });
            });
    }

    private renderMemoryMaintenanceActions(
        container: HTMLElement,
        getMemoryManager: () => PluginManager["memoryManager"] | null,
        getVss: () => PluginManager["vss"] | null,
    ): void {
        const plugin = this.plugin;
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

    }

    private renderMemoryExclusions(container: HTMLElement): void {
        const plugin = this.plugin;
        this.renderSourceExclusion(container, new Setting(container)
            .setName(this.t("plugin.settings.memory.excludePath.name"))
            .setDesc(this.t("plugin.settings.memory.excludePath.desc")),
        this.sourceScopeStates.memory, "tmp/,notes/templates",
        () => plugin.settings.vssCacheExcludePath,
        (next) => plugin.saveSettingsPermissions({ vssCacheExcludePath: next }));
        this.markFormControlSettings(container);
    }

    private renderSourceExclusion(
        parent: HTMLElement,
        setting: Setting,
        state: ReturnType<typeof createSourceScopeSettingState>,
        placeholder: string,
        read: () => string[],
        save: (next: string[]) => Promise<void>,
        parse = (value: string) => normalizeTrimmedStringArray(value.split(","), []),
        cancelMemoryPreparation = true,
    ): void {
        const generation = this.memoryControlCenterGeneration;
        renderSourceScopeSetting(parent, setting, {
            state, read, parse, placeholder,
            save: async (next) => {
                if (cancelMemoryPreparation && addsExclusions(read(), next)) this.plugin.cancelActiveMemoryPreparation();
                await save(next);
            },
            copy: {
                save: this.t("plugin.settings.sourceScope.save"),
                saving: this.t("plugin.settings.sourceScope.saving"),
                failed: this.t("plugin.settings.sourceScope.failed"),
                retry: this.t("plugin.settings.sourceScope.retry"),
            },
            isCurrent: () => this.settingsVisible && generation === this.memoryControlCenterGeneration,
            log: (error) => this.log("Failed to save source scope", error),
        });
    }

    private renderOperationsAgentSection(parentEl: HTMLElement): void {
        const plugin = this.plugin;
        new Setting(parentEl)
            .setName(this.t("plugin.settings.operationsAgent.name"))
            .setDesc(this.t("plugin.settings.operationsAgent.desc"))
            .addToggle((toggle) => this.configurePermissionToggle("operationsAgentEnabled", toggle,
                () => plugin.settings.operationsAgentEnabled,
                (value) => plugin.saveSettingsPermissions({ operationsAgentEnabled: value })));
        const audit = this.createSettingsDetail(parentEl, "plugin.settings.operationsAgent.auditContent.name");
        new Setting(audit)
            .setName(this.t("plugin.settings.operationsAgent.auditContent.name"))
            .setDesc(this.t("plugin.settings.operationsAgent.auditContent.desc"))
            .addToggle((toggle) => this.configurePermissionToggle("operationsAuditIncludeContent", toggle,
                () => plugin.settings.operationsAuditIncludeContent,
                (value) => plugin.saveSettingsPermissions({ operationsAuditIncludeContent: value })));
        new Setting(audit)
            .setName(this.t("plugin.settings.operationsAgent.auditRetention.name"))
            .setDesc(this.t("plugin.settings.operationsAgent.auditRetention.desc"))
            .addDropdown((dropdown) => {
                dropdown
                    .addOption("30", this.t("plugin.settings.operationsAgent.auditRetention.30"))
                    .addOption("90", this.t("plugin.settings.operationsAgent.auditRetention.90"));
                this.configurePermissionControl("operationsAuditRetentionDays", dropdown,
                    () => String(plugin.settings.operationsAuditRetentionDays),
                    (value) => plugin.saveSettingsPermissions({ operationsAuditRetentionDays: value === "90" ? 90 : 30 }));
            });
    }

    private renderSaveSuggestionPreference(parentEl: HTMLElement): void {
        const plugin = this.plugin;
        new Setting(parentEl)
            .setName(this.t("plugin.settings.operationsAgent.proactiveSave.name"))
            .setDesc(this.t("plugin.settings.operationsAgent.proactiveSave.desc"))
            .addToggle((toggle) => {
                toggle
                    .setValue(plugin.settings.operationsProactiveSaveSuggestionsEnabled)
                    .onChange((value) => {
                        plugin.settings.operationsProactiveSaveSuggestionsEnabled = value;
                        this.debouncedSave();
                    });
            });
    }

    private renderFeaturedImageSection(parentEl: HTMLElement): void {
        this.featuredImageContainer = parentEl.createDiv();
        this.rebuildFeaturedImage();
    }

    private rebuildFeaturedImage(baseURL = this.getEffectiveAIProviderConfiguration().baseURL): void {
        const container = this.featuredImageContainer;
        if (!container) return;
        container.empty();
        if (this.getEffectiveAIProviderConfiguration().aiProvider !== "qwen"
            || !getDashScopeImageGenerationEndpoint(baseURL)) return;
        new Setting(container)
            .setName(this.t("plugin.settings.featuredImage.options.title"))
            .setDesc(this.t("plugin.settings.featuredImage.path.desc"))
            .addButton((button) => button
                .setButtonText(this.t("plugin.settings.legal.open"))
                .onClick(() => { this.featureOptionsModal = this.plugin.openFeaturedImageOptions(); }));
        this.markFormControlSettings(container);
    }

    private findMetadata(metaKey: string) {
        return this.plugin.settings.metadatas.findIndex((m) => {
            return m.key === metaKey;
        })
    }
}
