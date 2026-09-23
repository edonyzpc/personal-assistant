/* Copyright 2023 edonyzpc */

import { type Command, type MarkdownFileInfo, type TAbstractFile, Component, Editor, ItemView, MarkdownRenderer, MarkdownView, type Menu, Modal, Notice, Platform, Plugin, TFile, type View, type WorkspaceLeaf, addIcon, apiVersion, debounce, moment as obsidianMoment, normalizePath, setIcon } from 'obsidian';
import { getApi } from "obsidian-callout-manager";

import { PA_CHAT_SUBAGENT_ICON, VIEW_TYPE_LLM, LLMView } from "./chat/chat-view";
import { AgentDebugPluginIntegration } from './agent-debug/plugin-integration';
import { AgentDebugView, AGENT_DEBUG_VIEW_TYPE } from './agent-debug/view';
import { AssistantFeaturedImageHelper, AssistantHelper } from "./ai";
import {
    AIUtils,
    type AIReadinessScope,
    type AIReadinessSnapshot,
    type APITokenCacheState,
    type QwenRequestOptions,
} from "./ai-services/ai-utils";
import { stableStringify } from "./ai-services/agent-utils";
import {
    ChatService,
} from "./ai-services/chat-service";
import { AgentRunCoordinator } from "./ai-services/agent-run-coordinator";
import {
} from "./ai-services/builtin-web-search-provider";
import type {
    AgentCapability,
    AgentRuntimePlatform,
} from "./ai-services/capability-types";
import {
} from "./ai-services/memory-search-tool";
import {
    OperationsService,
    type OperationsExecutionResult,
    type OperationsIntent,
    type OperationsSession,
    type UndoResult,
    type OperationsVault,
} from "./ai-services/operations";
import { VSS } from './vss'
import { PluginControlModal } from './modal'
import { BatchPluginControlModal } from './batch-modal'
import { SettingTab, type PluginManagerSettings, DEFAULT_SETTINGS, normalizeConfirmedMemoryCount, isMemoryExtractionConsentConfirmed } from './settings'
import { LocalGraph } from './local-graph';
import { GraphOptionsModal, type GraphOptions } from './settings/graph-options-modal';
import { FeaturedImageOptionsModal, type FeaturedImageOptionsModalHost } from './settings/featured-image-options-modal';
import type { FeaturedImageDefaults } from './ai-services/featured-image-options';
import type { ImageGenerationConnection } from './ai-services/image-generation-connection';
import { openSettings, openSettingsTab } from './obsidian-internals';
import { icons } from './utils';
import { PluginsUpdater } from './plugin-manifest';
import { ThemeUpdater } from './theme-manifest';
import { CalloutModal } from './callout';
import { RecordPreview, RECORD_PREVIEW_TYPE } from './preview';
import { registerObsidianCommands, registerObsidianViews } from './plugin/obsidian-registration';
import { RecordActions } from './plugin/record-actions';
import { MetadataUpdater } from './plugin/metadata-updater';
import { CalloutIntegration } from './plugin/callout-integration';
import { MemoryStatusNotifier } from './plugin/memory-status';
import { LocalGraphIntegration } from './plugin/local-graph-integration';
import { createPluginUpdaterAction, createThemeUpdaterAction } from './plugin/update-actions';
import { AIActions } from './plugin/ai-actions';
import { SettingsPersistence, type SettingsPermissionPatch } from './plugin/settings-persistence';
import {
    PluginAIConfiguration,
    type AIProviderConfigurationPatch,
    type ImageGenerationConnectionPatch,
} from './ai-services/plugin-configuration';
import {
    PluginGovernanceStorage,
    MemoryGovernanceBootstrapError,
    type GovernanceStoragePreparedHandle,
    type MemoryGovernanceBootstrapState,
    type MemoryGovernanceSmokeCapability,
} from './memory/plugin-governance-storage';
import {
    PluginGovernanceActions,
} from './memory/plugin-governance-actions';
import { MemoryPluginIntegration } from './memory/plugin-integration';
import { QuickCapturePluginIntegration } from './capture/plugin-integration';
import { STAT_PREVIEW_TYPE, Stat } from './stats-view'
import type StatsManager from './stats/stats-manager'
import { StatsPluginIntegration } from './stats/plugin-integration'
import {
    MemoryManager,
    type MemoryDecisionResult,
    type MemoryPreparationStatus,
} from './memory-manager';
import { getVaultConfigDirStorageScope } from './obsidian-paths';
import { confirmUserAction } from './confirm';
import { createVSSIndexStateStore, type VSSIndexStateStore } from './vss/local-state-store';
import type { ChatHistoryStore } from './chat/chat-history-store';
import type { ChatHistoryManager } from './chat/chat-history-manager';
import type { ImageAssetService } from './chat/image-assets';
import type { ImageGenerationService } from './chat/image-generation-service';
import type { WritingVersionService } from './chat/writing-versions';
import {
    type WritingRecoveryGenerationSource,
    type WritingRecoverySourceReceipt,
} from './chat/writing-recovery-sources';
import type { WritingSaveAction } from './chat/writing-save-action';
import { WritingStyleUnavailableError, inferWritingScene, type WritingStyleService } from './chat/writing-style-service';
import { hashWritingText, type WritingScene } from './chat/writing-types';
import type { ChatTurnMemoryMetadata, ChatWritingRecovery, ChatWritingStylePreparation, ChatWritingStyleResult } from './ai-services/chat-types';
import type { MessageImage } from './chat/image-types';
import { collectChatMemorySemanticSources, isChatMemoryRecordAdmissible, projectChatMemorySemanticText } from './pa/chat-memory-admission';
import { CHAT_MEMORY_SEMANTIC_RULE, chatMemorySemanticSourceFingerprint,
    verifyChatMemorySemanticReceipt, type ChatMemorySemanticReceipt } from './pa/chat-memory-semantic-receipt';
import type { ProfileWriteGuard } from './ai-services/memory-extraction/profile-store';
import type { VaultInsightsSourceReceipt } from './ai-services/memory-extraction/extraction-scheduler';
import {
    PAGELET_FOCUS_LATEST_COMMAND_ID,
    PAGELET_FOCUS_LATEST_DEFAULT_HOTKEY,
    PageletCostTracker,
    PageletRateLimiter,
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
import type { ScopeResolver } from './pagelet/scope/ScopeResolver';
import { getPluginUiLanguage, pluginT, type PluginMessageKey } from './locales/plugin';
import {
    clearPlatformTimeout,
    getPlatformCrypto,
    getPlatformDocument,
    getPlatformLocalStorage,
    setPlatformTimeout,
    type PlatformTimeoutHandle,
} from './platform-dom';
import type { PageletSettings } from './settings/pagelet';
import { PageletOrchestrator, type PageletHost } from './pagelet/orchestrator';
import {
    QuietRecallPluginIntegration,
    type QuietRecallLimiterUsage,
    type QuietRecallProviderModel,
    type QuietRecallSavedInsightCollection,
} from './pagelet/plugin-quiet-recall';
import { ScopeRecapPluginIntegration } from './pagelet/plugin-scope-recap';
import { DeepDiscoverPluginIntegration } from './pagelet/plugin-deep-discover';
import { RetainedReviewPluginIntegration } from './pagelet/plugin-review-actions';
import { PageletOperationsPluginIntegration } from './pagelet/plugin-operations-integration';
import { PageletActionPluginIntegration } from './pagelet/plugin-pagelet-actions';
import { PageletFeatureIntegration } from './pagelet/plugin-integration';
import { ChatPluginIntegration } from './chat/plugin-integration';
import {
    PageletDeepDiscoverScheduler,
    normalizeSnapshotPath,
    PAGELET_DEEP_DISCOVER_PIPELINE_VERSION,
    type PageletAgentPolicyIdentity,
    type PageletAgentSourceMaterial,
    type PageletAgentVerifiedInsightCollection,
    type PageletAnchorSnapshot,
    type PageletDeepDiscoverCommitSeal,
    type PageletDeepDiscoverControllerRequest,
    type PageletDeepDiscoverControllerResult,
    type PageletDeepDiscoverSmokeSnapshot,
} from './pagelet/agent';
import {
    PageletProviderCallAdmission,
    PageletProviderCallControlError,
    type PageletProviderCallReservation,
} from './pagelet/provider-call-admission';
import {
    requestPageletReviewHighRiskDecision,
    type PageletReviewHighRiskSummary,
} from './pagelet/ReviewHighRiskModal';
import { registerPageletCommands, type PageletCommandCallbacks } from './pagelet/commands';
import {
    PAGELET_DETAIL_VIEW_TYPE,
    PageletDetailView,
    clearPageletDetailSessionCache,
    clearScopeRecapPageletDetailSessionCache,
    registerPageletDetailIcon,
    type PageletDetailPayload,
} from './pagelet/tab';
import type {
    DiscoveryResult,
    PanelMemoryActionPolicy,
    PanelMemoryGovernanceRecord,
    PanelMemoryGovernanceState,
    PanelMemoryRecentChange,
    PanelMemoryUseStatus,
} from './pagelet/panel/types';
import type { MemoryRecordActionResult } from './pagelet/tab/sections/types';
import { buildDiscoveryPrompt, parseStructuredResponse } from './pagelet/llm';
import { buildDiscoveryResultFromFindings } from './pagelet/DiscoveryAnalyzer';
import { buildPageletRelatedNotesQuery } from './pagelet/related-notes-query';
import {
    MemoryExtractionScheduler,
    SerializedProfileGovernancePort,
    createExistingUserProfileReader,
    createExistingGovernedUserProfileReader,
    createGovernedUserProfileStore,
    deriveSemanticProfileKey,
    createUserProfileStore,
    getUserProfileDbName,
    renderUserProfileMarkdown,
    sanitizeUserProfileSnapshot,
    type ExistingUserProfileReader,
    type TypeAAdmissionBatch,
    type TypeAAdmissionResult,
    type UserProfileRecord,
    type UserProfileSnapshot,
    type UserProfileStore,
} from './ai-services/memory-extraction';
import type { AiServiceHost } from './ai-services/AiServiceHost';
import { revalidateVaultObservationFromApp } from './ai-services/vault-observation-evidence';
import {
    RetrievalDiagnosticsController,
    type RetrievalCancellationProbeAck,
    type RetrievalDiagnosticsSessionIdentity,
    type RetrievalDiagnosticsSnapshot,
    type RetrievalDiagnosticSurface,
} from './ai-services/retrieval-diagnostics';
import {
    resolveB125RetrievalOptimizationPolicySnapshot,
    type B125RetrievalOptimizationPolicySnapshot,
} from './retrieval-optimization-platform-policy';
import type { GraphBoundarySnapshotSource } from './graph/graph-boundary-snapshot';
import type { GraphPathClass } from './graph/personalized-pagerank';
import type { PaAgentInjectedContext } from './ai-services/context';
import type { MemoryHost } from './memory';
import type { AISetupInput, AISetupResult, ChatHost } from './chat/ChatHost';
import { getCharPhraseRuntimeCanaryFingerprint } from './vss/lexical-normalizer';
import {
    QUICK_CAPTURE_COMMAND_ID,
    QUICK_CAPTURE_COMMAND_NAME,
} from './quick-capture';
import {
    closeAllShareCardModals,
    ShareCardModal,
} from './share-card/share-card-modal';
import { ShareCardActions } from './plugin/share-card-actions';
import { SourceAccess } from './plugin/source-access';
import { VaultEventBridge } from './plugin/vault-event-bridge';

export { buildMemoryDataBoundaryFingerprint } from './plugin/source-access';
import {
    ActiveVaultIndexer,
    CallbackMemoryGovernanceRecordRepository,
    MemoryGovernanceStore,
    RetrievalHabitProfileStore,
    ReviewQueueStore,
    SavedInsightStore,
    type ConfirmedMemoryRecord,
    type GraphDiscoveryNote,
    type GraphDiscoveryRunResult,
    type MaintenanceReviewRunResult,
    type MaintenanceMoveActionLogEntry,
    type MaintenanceMoveApplyResult,
    type MaintenanceMoveUndoResult,
    type MemoryGovernanceRecordRepository,
    type PatternDetectionInput,
    type PatternDetectionResult,
    type QuietRecallCandidate,
    type QuietRecallEvaluationAttempt,
    type QuietRecallEvaluationDecision,
    type QuietRecallRunResult,
    type QuietRecallSaveResult,
    type RetrievalHabitFeedbackKind,
    type RetrievalHabitProfileRecordResult,
    type ReviewQueueCreateInput,
    type ReviewQueueItem,
    type ReviewQueueListFilter,
    type ReviewQueueResult,
    type ReviewQueueRepository,
    type ReviewQueueStatus,
    type SavedInsight,
    type ScopeRecapLocalOverview,
    type ScopeRecapPreparationResult,
    type ScopeRecapSourceNote,
    addPaRelatedLink,
    resolveOutputLanguage,
    QuietRecallEvaluationCoordinator,
    canAutoConfirmMemoryCandidate,
    detectCrossNotePatterns,
    discoverLightweightGraphItems,
    graphDiscoveryItemToReviewQueueInput,
    memoryCandidateFromQueueItem,
    type MaintenanceProposal,
} from './pa';
import { classifyLegacyTypeAAdoption } from './pa/legacy-type-a-adoption';
import { createMemoryActionPort } from './pa/memory-action-port';
import {
    readTypeATargetGeneration,
    type MemoryAdmissionCoordinator,
    type GovernedMemoryAdmissionInput,
    type ChatSemanticAdmissionEvidence,
    type TypeAAdmissionBaseline,
} from './pa/memory-admission-coordinator';
import type { MemoryGovernanceActionIdentity } from './pa/memory-governance-coordinator';
import { LegacyMemoryCompatibilityBarrier } from './pa/memory-governance-compatibility';
import { MemoryGovernanceUpgradeCoordinator } from './pa/memory-governance-upgrade';
import {
    MemoryGovernanceFinalizationCoordinator,
    previewMemoryGovernanceFinalization,
    type LegacyMemoryFinalizationSourceSnapshot,
} from './pa/memory-governance-finalization';
import {
    MemoryGovernanceMigrationCoordinator,
    type ClassifiedLegacyTypeAAdoption,
} from './pa/memory-governance-migration-coordinator';
import {
    buildLegacyReviewQueuePassthrough,
    captureLegacyMemoryPayload,
    hashLegacyMemoryPayload,
    normalizeLegacyMemoryPolicy,
    parseLegacyMemoryPayload,
    redactExactLegacyMemoryPayload,
    type LegacyMemoryPayload,
} from './pa/memory-governance-migration';
import {
    createDeviceMemoryGovernanceRepository,
    type DeviceMemoryGovernanceStateV1,
    type MemoryClaimRevision,
    type MemoryGovernanceRepository,
    type MemoryProjectionLink,
    type PersistedMemoryProvenance,
} from './pa/memory-governance-persistence';
import {
    createDeviceMemoryGovernanceRecordRepository,
    type DeviceMemoryGovernanceRecordRepository,
} from './pa/memory-governance-record-repository';
import {
    buildLegacyMemoryRollbackProjection,
    MemoryGovernanceRollbackCoordinator,
    type LegacyMemoryRollbackProjection,
    type LegacyMemoryRollbackWriteResult,
} from './pa/memory-governance-rollback';
import type {
    MemoryGovernanceCoordinator,
    ExactMemoryProjectionCleanupPort,
    LegacyCompatibilityForgetPrepareResult,
} from './pa/memory-governance-coordinator';
import type { MemoryProfileProjectionWorker } from './pa/memory-profile-projection-worker';
import { buildGovernedMemoryViewSnapshot } from './pa/memory-governance-view';
import {
    createMemoryReviewQueueRepository,
    type MemoryReviewQueueRepository,
} from './pa/memory-review-queue-repository';
import {
    MEMORY_SENSITIVITIES,
    MEMORY_TYPES,
    type DataBoundaryDecision,
    type MemorySensitivity,
    type MemoryType,
    type PersistedSourceRef,
    type ReviewQueueScope,
} from './pa/contracts';
import {
    buildMemoryControlCenterSnapshot,
    type MemoryControlCenterProfileInput,
    type MemoryControlCenterItem,
    type MemoryControlCenterProvenance,
    type MemoryControlCenterRecentChange,
    type MemoryControlCenterSnapshot,
    type MemoryControlCenterSourceError,
    type MemoryControlCenterVaultInsightsInput,
    type VaultInsightsReadSnapshot,
} from './pa/memory-control-center';
import { createMemoryManagementReadPort } from './pa/memory-management-read';
import { createInsightReadPort } from './pa/insight-read-port';
import { createInsightActionPort } from './pa/insight-action-port';
import { computeContentHash } from './vss-helpers';
import {
    selectGovernedMemoryUse,
    type MemorySuppressionFingerprintRef,
} from './pa/memory-use-projection';
import { includesString, stableHash, parentFolder } from './pa/helpers';
import { getMemoryTrustLevel } from './pa/memory-trust-level';

const QUIET_RECALL_MAX_VAULT_CANDIDATE_NOTES = 40;
const PATTERN_DETECTION_RECENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const PATTERN_DETECTION_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;
const PATTERN_DETECTION_MIN_ACTIVE_NOTES = 5;
const PATTERN_DETECTION_MAX_SOURCE_NOTES = 80;
const PAGELET_MAINTENANCE_ONBOARDING_MIN_NOTES = 50;
// The repository passed the Memory control-center SDD's real two-vault
// Obsidian probe: one device-shared IndexedDB, distinct opaque vault keys,
// monotonic cross-window commits/invalidation, and vault-partition isolation.
// Scope widening still requires the explicit user action enforced below.
const DEVICE_COLLABORATION_SCOPE_VALIDATED = true;

interface AiInsightsMemoryTarget {
    claimId: string;
    summary: string;
    effect: "future_answers" | "collaboration_default";
}

interface GovernedMemoryUiGateInput {
    runtimeUseEnabled: boolean;
    sourceEligible: boolean;
    hasPendingOperation: boolean;
    coordinatorAvailable: boolean;
}

interface GovernedMemoryUiProjection {
    lifecycle: MemoryControlCenterItem["lifecycle"];
    effect: MemoryControlCenterItem["effect"];
    useStatus: PanelMemoryUseStatus;
    durableUseStatus: PanelMemoryUseStatus;
    actionPolicy: PanelMemoryActionPolicy;
}

function projectGovernedMemoryUiState(
    entry: ReturnType<typeof buildGovernedMemoryViewSnapshot>["records"][number],
    gates: GovernedMemoryUiGateInput,
): GovernedMemoryUiProjection {
    const lifecycle = entry.record.lifecycle === "forgotten_tombstone"
        ? "forgotten_marker" as const
        : entry.useStatus === "paused"
            ? "paused" as const
            : entry.record.lifecycle === "stale"
                ? "stale" as const
                : entry.record.lifecycle === "archived"
                    ? "archived" as const
                    : "active" as const;
    const hasAnswerEffect = entry.effect === "future_answers"
        || entry.effect === "collaboration_default";
    const currentlyUsed = hasAnswerEffect
        && entry.useStatus === "active"
        && gates.runtimeUseEnabled
        && gates.sourceEligible
        && !gates.hasPendingOperation;
    const useStatus: PanelMemoryUseStatus = entry.useStatus === "paused"
        ? "paused"
        : currentlyUsed
            ? "active"
            : "stored_not_in_use";
    const effect = hasAnswerEffect && !currentlyUsed
        ? "stored_not_in_use" as const
        : entry.effect;
    const lifecycleActionable = lifecycle === "active" || lifecycle === "paused";
    const actionBase = gates.coordinatorAvailable
        && lifecycleActionable
        && !gates.hasPendingOperation;
    return {
        lifecycle,
        effect,
        useStatus,
        durableUseStatus: entry.useStatus,
        actionPolicy: {
            correct: actionBase && gates.sourceEligible,
            pause: actionBase,
            resume: actionBase && gates.runtimeUseEnabled && gates.sourceEligible,
            forget: actionBase,
        },
    };
}

export { createMemoryGovernanceOpaqueVaultKey } from './memory/plugin-governance-storage';

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

const debug = (enabled: boolean, ...msg: unknown[]) => {
    if (enabled) console.log(...msg.map((item: unknown) => redactForLog(item)));
};

const moment = obsidianMoment as unknown as (...args: unknown[]) => { format: (format: string) => string };

function collectStringValues(value: unknown, output: Set<string>): void {
    if (Array.isArray(value)) {
        value.forEach((entry) => collectStringValues(entry, output));
        return;
    }
    if (typeof value === "string" && value.trim()) {
        output.add(value.trim());
    }
}

const VAULT_INSIGHTS_INJECTION_NOTICE_KEY = "pa-vault-insights-injection-notice";
const PAGELET_RATE_LIMIT_STORAGE_KEY_PREFIX = "pa-pagelet-rate-limit";
const PAGELET_ATTENTION_STORAGE_KEY_PREFIX = "pa-pagelet-attention";
const PAGELET_RELATED_NOTES_TIMEOUT_MS = 8000;
const PAGELET_DISCOVERY_MAX_RELATED_NOTES = 6;
function classifyProfileForGovernedAdoption(
    opaqueVaultKey: string,
    record: UserProfileRecord,
): ClassifiedLegacyTypeAAdoption {
    const profileRecordId = record.profileRecordId;
    if (!profileRecordId) {
        throw new MemoryGovernanceBootstrapError("profile_readback_mismatch");
    }
    const decision = classifyLegacyTypeAAdoption({ opaqueVaultKey, record });
    if (decision.status === "adoption_blocked") {
        return {
            status: "adoption_blocked",
            profileRecordId,
            reason: decision.reason,
        };
    }
    return {
        status: "adopt",
        profileRecordId,
        summary: record.text,
        applicability: decision.applicability,
        authority: decision.authority,
        provenance: decision.provenance,
        observedAt: record.observedAt,
        profileProjectionState: "applied",
    };
}

function userProfileSnapshotsEqual(
    left: UserProfileSnapshot,
    right: UserProfileSnapshot,
): boolean {
    // IndexedDB structured-clone readback may preserve every value while
    // returning object keys in a different insertion order. Readback
    // verification must compare the JSON value, not serialization order.
    return stableStringify(left) === stableStringify(right);
}

function legacyMemoryRollbackProjectionsEqual(
    left: LegacyMemoryRollbackProjection,
    right: LegacyMemoryRollbackProjection,
): boolean {
    const fingerprint = (projection: LegacyMemoryRollbackProjection) => hashLegacyMemoryPayload({
        memoryGovernance: {
            records: [...projection.records].sort((a, b) => a.id.localeCompare(b.id)),
        },
        reviewQueue: {
            items: [...projection.memoryQueueItems].sort((a, b) => a.id.localeCompare(b.id)),
        },
        confirmedMemoryCount: projection.confirmedMemoryCount,
        memoryAutoAcceptPaused: projection.memoryAutoAcceptPaused,
    });
    return fingerprint(left) === fingerprint(right);
}

function cloneSerializable<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
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
    private createSettingsPersistence(): SettingsPersistence {
        return new SettingsPersistence({
            onSourcePermissionRevoking: () => this.agentDebugIntegration?.sourcePermissionRevoking(),
            onSourcePermissionCommitted: () => this.agentDebugIntegration?.sourcePermissionCommitted(),
            onSourcePermissionFailed: () => this.agentDebugIntegration?.sourcePermissionFailed(),
            loadData: () => this.loadData(),
            saveData: (data) => this.saveData(data),
            getAdapter: () => this.app.vault.adapter,
            getManifest: () => this.manifest,
            getVault: () => this.app.vault,
            isUnloading: () => this.unloading,
            clearTokenCache: () => this.clearTokenCache(),
            initializeLegacyMemoryCompatibility: (loaded) => (
                this.governanceStorage.initializeLegacyCompatibility(loaded)
            ),
            getLegacyMemoryCompatibilityBarrier: () => this.governanceStorage.getLegacyBarrier(),
            updateLegacyMemoryPayload: (payload) => this.governanceStorage.setLegacyPayload(
                payload as LegacyMemoryPayload,
            ),
            markMemoryGovernanceBootstrapError: (errorCode) => {
                this.governanceStorage.bootstrapError = errorCode;
            },
            createLegacySaveCollisionError: () => new MemoryGovernanceBootstrapError("legacy_save_collision"),
            synchronizeNonMemoryQueueFromPersisted: (raw) => (
                this.governanceStorage.synchronizeNonMemoryQueue(raw)
            ),
            syncMemoryExtractionRuntime: () => this.syncMemoryExtractionRuntime(),
            setStatisticsRuntimeEnabled: (enabled) => this.statsManager?.setStatisticsSyncEnabled(enabled),
            setBackgroundDiscoveryRuntimeEnabled: (enabled) => {
                this.deepDiscoverIntegration.setAutomaticEnabled(enabled);
            },
            shouldDeferSettingsNotification: () => this.aiConfiguration.hasActiveCredentialTransition(),
            deferSettingsNotification: () => this.aiConfiguration.deferSettingsNotification(),
            refreshRetrievalEpoch: () => {
                this.getRetrievalOptimizationEpoch();
            },
            showNotice: (message, duration) => {
                new Notice(message, duration);
            },
            translateQwenMemoryModelRecommended: () => this.t("plugin.notice.qwenMemoryModelRecommended"),
            getPageletLocale: () => this.getPageletLocale(),
            createStatisticsVaultId,
            log: (message, detail) => this.log(message, detail),
        });
    }

    private readonly settingsPersistence = this.createSettingsPersistence();
    private readonly aiConfiguration = this.createAIConfiguration();
    private readonly governanceStorage = this.createGovernanceStorage();
    private readonly governanceActions = this.createGovernanceActions();
    private readonly memoryIntegration = this.createMemoryIntegration();

    private createMemoryIntegration(): MemoryPluginIntegration {
        return new MemoryPluginIntegration({
            getApp: () => this.app,
            getPluginId: () => this.manifest?.id ?? "personal-assistant",
            getSettings: () => this.settings,
            isUnloading: () => this.unloading,
            getChatHistoryManager: () => this.chatHistoryManager,
            hasConfirmedExtractionConsent: () => this.hasConfirmedMemoryExtractionConsent(),
            hasGovernedProjection: () => Boolean(this.getGovernedMemoryProjectionSnapshot()),
            getGovernanceUiMode: () => this.getMemoryGovernanceUiMode(),
            getLegacyProfileScope: () => this.getLegacyProfileScope(),
            getDataBoundaryFingerprint: () => this.getMemoryDataBoundaryFingerprint(),
            shouldHandleVaultEvent: (file) => this.isDataBoundaryAllowedFile(file),
            createLegacyProfileStore: () => this.createUserProfileStore(),
            createGovernedProfileStore: () => this.createGovernedUserProfileStore(),
            createExistingProfileReader: () => this.createExistingUserProfileReader(),
            createExtractionModel: async () => {
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
            admitTypeACandidates: (batch) => this.admitGovernedTypeABatch(batch),
            captureTypeAAdmissionBaseline: () => this.captureGovernedTypeAAdmissionBaseline(),
            getTypeAProcessedTurn: (conversationId) => this.getGovernedTypeAProcessedTurn(conversationId),
            surfaceExtractionEnabledNotice: () => {
                new Notice(this.t("plugin.memoryExtraction.enabledNotice"));
                this.settings.memoryExtractionNoticeDismissed = true;
                void this.saveSettings();
            },
            surfaceVaultInsightsInjectionNotice: () => this.surfaceVaultInsightsInjectionNotice(),
            createStatusNotifier: () => new MemoryStatusNotifier({ createDebounce: debounce }),
            log: (message, error) => this.log(message, error),
        });
    }

    private createGovernanceStorage(): PluginGovernanceStorage {
        return new PluginGovernanceStorage({
            getSettings: () => this.settings,
            getVault: () => this.app.vault,
            getPluginId: () => (this.manifest as { id?: string } | undefined)?.id
                ?? "personal-assistant",
            isUnloading: () => this.unloading,
            createRepository: () => this.createMemoryGovernanceDeviceRepository(),
            persistSettingsSlice: (read, write, next, requireCommit) => (
                this.settingsPersistence.persistSettingsSlice(read, write, next, requireCommit)
            ),
            scheduleGarbageCollection: () => this.scheduleMemoryGovernanceGarbageCollection(),
            cancelGarbageCollection: () => this.cancelMemoryGovernanceGarbageCollection(),
            log: (message, detail) => this.log(message, detail),
        });
    }

    private createGovernanceActions(): PluginGovernanceActions {
        return new PluginGovernanceActions({
            isUnloading: () => this.unloading,
            isRuntimeReady: () => this.memoryGovernanceBootstrapState === "ready",
            getCurrentState: () => this.currentDeviceMemoryGovernanceState,
            refreshActionState: () => this.refreshGovernedMemoryActionState(),
            notifySettingsChanged: () => this.notifySettingsChanged(),
            readActionBoundary: (claimId) => this.readGovernedMemoryActionBoundary(claimId),
            readCommittedState: () => this.deviceMemoryGovernanceRepository?.initialize()
                ?? Promise.resolve(undefined),
            getPanelRecord: (claimId) => this.getMemoryGovernancePanelState().records
                .find((record) => record.id === claimId) as PanelMemoryGovernanceRecord | undefined,
            pageletMessage: (key) => pageletT(key, this.getPageletLocale()),
            pluginMessage: (key) => this.t(key),
            log: (message, detail) => this.log(message, detail),
        });
    }

    private createAIConfiguration(): PluginAIConfiguration {
        return new PluginAIConfiguration({
            getSettings: () => this.settings,
            isUnloading: () => this.unloading,
            getSecretStorage: () => this.app.secretStorage,
            enqueueSettingsWrite: (operation) => this.settingsPersistence.enqueueWrite(operation),
            saveSettingsData: (snapshot) => this.settingsPersistence.saveSettingsData(snapshot),
            trackRequiredSettingsTransaction: (operation) => (
                this.settingsPersistence.trackRequiredTransaction(operation)
            ),
            notifySettingsChanged: () => this.settingsPersistence.notifySettingsChanged(),
            cancelActivePreparation: () => this.cancelActiveMemoryPreparation(),
            translateSetupIssue: (issue) => {
                switch (issue) {
                    case "provider_missing":
                        return this.t("plugin.aiSetup.chooseProvider");
                    case "provider_unsupported":
                        return this.t("plugin.aiSetup.unsupportedProvider");
                    case "embedding_model_missing":
                        return this.t("plugin.aiSetup.completeMemoryProvider");
                    case "token_unknown":
                        return this.t("plugin.aiSetup.checkToken");
                    case "token_missing":
                        return this.t("plugin.aiSetup.addToken");
                    default:
                        return this.t("plugin.aiSetup.completeProvider");
                }
            },
            showTokenMissingNotice: () => {
                new Notice(this.t("plugin.notice.apiTokenNotConfigured"), 5000);
            },
            log: (message, detail) => this.log(message, detail),
        });
    }

    get settings(): PluginManagerSettings {
        return this.settingsPersistence.currentSettings;
    }

    set settings(value: PluginManagerSettings) {
        this.settingsPersistence.setCurrentSettingsForCompatibility(value);
    }

    private get token(): string {
        return this.aiConfiguration.getTokenForCompatibility();
    }

    private set token(value: string) {
        this.aiConfiguration.setTokenForCompatibility(value);
    }

    private get tokenCacheState(): APITokenCacheState {
        return this.aiConfiguration.getTokenCacheState();
    }

    private set tokenCacheState(value: APITokenCacheState) {
        this.aiConfiguration.setTokenCacheStateForCompatibility(value);
    }

    private get aiSetupTransactionTail(): Promise<void> | null {
        return this.aiConfiguration.getTransactionTailForCompatibility();
    }

    private set aiSetupTransactionTail(value: Promise<void> | null) {
        this.aiConfiguration.setTransactionTailForCompatibility(value);
    }

    private get aiProviderConfigurationRevision(): number {
        return this.aiConfiguration.getProviderConfigurationRevision();
    }

    private set aiProviderConfigurationRevision(value: number) {
        this.aiConfiguration.setProviderConfigurationRevisionForCompatibility(value);
    }

    private get aiTokenRevision(): number {
        return this.aiConfiguration.getTokenRevision();
    }

    private set aiTokenRevision(value: number) {
        this.aiConfiguration.setTokenRevisionForCompatibility(value);
    }

    private get aiExternalSettingsMutationEpoch(): number {
        return this.aiConfiguration.getExternalSettingsMutationEpochForCompatibility();
    }

    private set aiExternalSettingsMutationEpoch(value: number) {
        this.aiConfiguration.setExternalSettingsMutationEpochForCompatibility(value);
    }

    private get aiPendingExternalProviderMutationEpoch(): number | null {
        return this.aiConfiguration.getPendingExternalProviderMutationEpochForCompatibility();
    }

    private set aiPendingExternalProviderMutationEpoch(value: number | null) {
        this.aiConfiguration.setPendingExternalProviderMutationEpochForCompatibility(value);
    }

    private get aiReadinessFailureRevision(): number {
        return this.aiConfiguration.getReadinessFailureRevisionForCompatibility();
    }

    private set aiReadinessFailureRevision(value: number) {
        this.aiConfiguration.setReadinessFailureRevisionForCompatibility(value);
    }

    private get aiProviderCredentialTransitionCount(): number {
        return this.aiConfiguration.getCredentialTransitionCountForCompatibility();
    }

    private set aiProviderCredentialTransitionCount(value: number) {
        this.aiConfiguration.setCredentialTransitionCountForCompatibility(value);
    }

    private get aiSettingsNotificationDeferredDuringCredentialTransaction(): boolean {
        return this.aiConfiguration.getNotificationDeferredForCompatibility();
    }

    private set aiSettingsNotificationDeferredDuringCredentialTransaction(value: boolean) {
        this.aiConfiguration.setNotificationDeferredForCompatibility(value);
    }

    private get settingsSaveTail(): Promise<void> | null {
        return this.settingsPersistence.getSettingsSaveTailForCompatibility();
    }

    private set settingsSaveTail(value: Promise<void> | null) {
        this.settingsPersistence.setSettingsSaveTailForCompatibility(value);
    }

    private get settingsChangeListeners(): Set<() => void | Promise<void>> {
        return this.settingsPersistence.getSettingsChangeListenersForCompatibility();
    }

    private set settingsChangeListeners(value: Set<() => void | Promise<void>>) {
        this.settingsPersistence.setSettingsChangeListenersForCompatibility(value);
    }

    private get settingsMigrationBaselineFingerprint(): string | null {
        return this.settingsPersistence.getSettingsMigrationBaselineFingerprintForCompatibility();
    }

    private set settingsMigrationBaselineFingerprint(value: string | null) {
        this.settingsPersistence.setSettingsMigrationBaselineFingerprintForCompatibility(value);
    }

    private get pendingLearningPreferencesMigration(): boolean {
        return this.settingsPersistence.getPendingLearningPreferencesMigrationForCompatibility();
    }

    private set pendingLearningPreferencesMigration(value: boolean) {
        this.settingsPersistence.setPendingLearningPreferencesMigrationForCompatibility(value);
    }

    private get pendingSimpleSettingsCanonicalization(): boolean {
        return this.settingsPersistence.getPendingSimpleSettingsCanonicalizationForCompatibility();
    }

    private set pendingSimpleSettingsCanonicalization(value: boolean) {
        this.settingsPersistence.setPendingSimpleSettingsCanonicalizationForCompatibility(value);
    }

    private get backgroundDiscoveryEpoch(): number {
        return this.settingsPersistence.getBackgroundDiscoveryEpoch();
    }

    private set backgroundDiscoveryEpoch(value: number) {
        this.settingsPersistence.setBackgroundDiscoveryEpochForCompatibility(value);
    }

    private get backgroundDiscoveryPersistenceUncertain(): boolean {
        return this.settingsPersistence.getBackgroundDiscoveryPersistenceUncertainForCompatibility();
    }

    private set backgroundDiscoveryPersistenceUncertain(value: boolean) {
        this.settingsPersistence.setBackgroundDiscoveryPersistenceUncertainForCompatibility(value);
    }
    private readonly recordActions = new RecordActions({
        app: this.app,
        getSettings: () => this.settings,
        log: (message, ...args) => this.log(message, ...args),
    });
    private readonly metadataUpdater = new MetadataUpdater({
        workspace: this.app.workspace,
        metadataCache: this.app.metadataCache,
        fileManager: this.app.fileManager,
        getSettings: () => this.settings,
        log: (message, ...args) => this.log(message, ...args),
        setActive: (active) => {
            const statusBar = getPlatformDocument().getElementById("personal-assistant-statusbar");
            statusBar?.removeClass("personal-assistant-statusbar-breathing");
            if (active) statusBar?.addClass("personal-assistant-statusbar-breathing");
        },
        notifyDisabled: () => {
            new Notice(this.t("plugin.notice.metadataCommandDisabled"));
        },
        registerEvent: (eventRef) => {
            this.registerEvent(eventRef);
        },
    });
    private readonly calloutIntegration = new CalloutIntegration({
        pluginId: 'callout-manager',
        registry: {
            isPluginEnabled: (pluginId) => {
                const registry = (this.app as unknown as {
                    plugins?: { enabledPlugins?: Set<string> };
                }).plugins;
                return registry?.enabledPlugins?.has(pluginId) ?? false;
            },
            getPluginInstance: (pluginId) => {
                const registry = (this.app as unknown as {
                    plugins?: { plugins?: Record<string, unknown> };
                }).plugins;
                return registry?.plugins?.[pluginId];
            },
        },
        getApi: () => getApi(this),
        log: (message, ...args) => this.log(message, ...args),
    });
    private readonly calloutHost = {
        getCallouts: () => this.calloutIntegration.getCallouts(),
        log: (message: string, ...args: unknown[]) => this.log(message, ...args),
    };
    private readonly statsIntegration = new StatsPluginIntegration({
        app: this.app,
        statViewType: STAT_PREVIEW_TYPE,
        getSettings: () => this.settings,
        registerEvent: (eventRef) => this.registerEvent(eventRef),
        log: (message, ...args) => this.log(message, ...args),
    });
    private readonly sourceAccess = new SourceAccess({
        app: {
            vault: this.app.vault,
            metadataCache: this.app.metadataCache,
        },
        getSettings: () => ({
            dataBoundary: this.settings?.dataBoundary ?? DEFAULT_SETTINGS.dataBoundary,
            memoryExcludePrefixes: this.settings?.vssCacheExcludePath ?? DEFAULT_SETTINGS.vssCacheExcludePath,
            pagelet: this.settings?.pagelet ?? DEFAULT_SETTINGS.pagelet,
        }),
        log: (message, detail) => this.log(message, detail),
    });
    private readonly pageletIntegration = new PageletFeatureIntegration({
        createFeatureScope: () => this.createPageletFeatureScope(),
        releaseFeatureScope: (expectedScope) => this.releasePageletFeatureScope(expectedScope),
        isFeatureScopeCurrent: (scope) => this.isPageletFeatureScopeCurrent(scope),
        syncDeepDiscoverIdentity: () => this.syncPageletDeepDiscoverControllerIdentity(),
        syncQuietRecallPolicy: () => this.quietRecallIntegration.syncPolicyIdentity(),
        registerCommandsOnce: () => this.registerPageletCommandsOnce(),
        registerFocusCommandOnce: () => this.registerPageletFocusCommandOnce(),
        createOrchestrator: (featureScope) => new PageletOrchestrator(
            this.createPageletHost(featureScope),
        ),
        stopDeepDiscover: () => this.deepDiscoverIntegration.resetForFeatureDisable(),
        disposeDeepDiscoverFeatureResources: () => this.deepDiscoverIntegration.disposeFeature(),
        invalidateRetainedReviewLimiter: () => this.retainedReviewIntegration.invalidateLimiter(),
        disposeScopeRecap: () => this.scopeRecapIntegration.dispose(),
        disposeQuietRecall: () => this.quietRecallIntegration.dispose(),
        retireOperations: () => this.pageletOperationsIntegration.disposeFeature(),
        createRuntime: () => {
            if (!this.settings.pagelet?.enabled) return null;
            if (!this.pageletIntegration.currentOrchestrator) return null;
            const runtime = createPaReviewRuntime({
                app: this.app,
                getPageletSettings: () => this.settings.pagelet,
                getLocale: () => this.getPageletLocale(),
                licenseTier: this.settings.licenseTier,
                debug: this.settings.debug,
            });
            this.log("Pagelet runtime initialized");
            return runtime;
        },
        log: (message, detail) => this.log(message, detail),
    });
    private get pageletOrchestrator(): PageletOrchestrator | null {
        return this.pageletIntegration.currentOrchestrator;
    }

    private set pageletOrchestrator(value: PageletOrchestrator | null) {
        this.pageletIntegration.setOrchestratorForCompatibility(value);
    }

    private get pageletRuntime(): PaReviewRuntime | null {
        return this.pageletIntegration.currentRuntime;
    }

    private set pageletRuntime(value: PaReviewRuntime | null) {
        this.pageletIntegration.setRuntimeForCompatibility(value);
    }
    private agentDebugIntegration: AgentDebugPluginIntegration | undefined;

    private getAgentDebugIntegration(): AgentDebugPluginIntegration {
        return this.agentDebugIntegration ??= new AgentDebugPluginIntegration({
            vault: this.app.vault,
            settings: () => this.settings,
            history: () => this.chatIntegration.getHistoryStore(),
            recordSourceRevocation: () => this.settingsPersistence.recordSourceRevocation(),
            readForgetState: async () => {
                const state = await this.deviceMemoryGovernanceRepository?.initialize();
                return {
                    claims: (state?.claims ?? [])
                        .filter(claim => claim.partition.kind === 'device_collaboration'
                            || claim.partition.key === this.memoryGovernanceOpaqueVaultKey)
                        .filter(claim => claim.lifecycle === 'forgotten_tombstone' || claim.lifecycle === 'forget_pending')
                        .map(claim => ({ id: claim.id, deviceWide: claim.partition.kind === 'device_collaboration' })),
                    legacyRecordIds: this.getMemoryGovernanceStore().list()
                        .filter(record => record.lifecycle === 'forgotten_tombstone').map(record => record.id),
                };
            },
        });
    }

    private async openAgentDebug(conversationId?: string): Promise<void> {
        const existing = this.app.workspace.getLeavesOfType(AGENT_DEBUG_VIEW_TYPE)[0];
        const leaf = existing ?? this.app.workspace.getLeaf('tab');
        if (!existing) await leaf.setViewState({ type: AGENT_DEBUG_VIEW_TYPE, active: true });
        if (leaf.view instanceof AgentDebugView) leaf.view.revealConversation(conversationId);
        await this.app.workspace.revealLeaf(leaf);
        // On mobile, revealLeaf does not dismiss an open Chat drawer; it would
        // otherwise cover the newly opened Debug tab completely.
        if (Platform.isMobile) this.app.workspace.rightSplit.collapse();
    }

    private readonly chatIntegration = new ChatPluginIntegration({
        app: this.app,
        getSettings: () => this.settings,
        getPluginId: () => this.manifest?.id ?? "personal-assistant",
        source: {
            isDataBoundaryAllowedPath: (path) => this.isDataBoundaryAllowedPath(path),
            isDataBoundaryAllowedFile: (file) => this.isDataBoundaryAllowedFile(file),
            getDataBoundaryTags: (file) => this.getDataBoundaryTags(file),
        },
        getImageGenerationConnection: () => this.getImageGenerationConnection(),
        getImageToken: async (mode) => mode === "dedicated-wan"
            ? this.getConfiguredImageAPITokenSecret()
            : await this.getAPIToken(),
        showImageSyncNotice: (receipt) => new Notice(this.t("plugin.chat.images.sync", {
            directory: receipt.directory,
        }), 12000),
        createOperationsSession: () => this.getOperationsService().createSession({ surface: "chat" }),
        createAiServiceHost: () => this.createAiServiceHost("chat"),
        hostActions: {
            openAgentDebug: (conversationId) => this.openAgentDebug(conversationId),
            recordAgentDebugTextCommitted: (runId) => this.agentDebugIntegration?.service.recordTextCommitted(runId),
            isOperationsAgentEnabled: () => this.isOperationsAgentEnabled,
            log: (message, ...args) => this.log(message, ...args),
            getAISetupIssue: () => this.getAISetupIssue(),
            getAIReadiness: (scope) => this.getAIReadiness(scope),
            refreshAPITokenPresence: () => this.refreshAPITokenPresence(),
            confirmImageGenerationFirstUse: () => this.confirmImageGenerationFirstUse(),
            rememberWritingStyle: (versionId, scene) => this.rememberWritingStyle(versionId, scene),
            readWritingStyleReferences: (revisionIds, signal) => this.getWritingStyleService()
                ?.readReferences(revisionIds, signal) ?? Promise.resolve([]),
            onWritingReferencesChanged: (listener) => {
                let active = true;
                const notify = () => { if (active) listener(); };
                const settings = this.onSettingsChanged(notify);
                const repository = this.deviceMemoryGovernanceRepository?.subscribe(() => {
                    notify();
                    void this.deviceMemoryCacheRefreshPromise?.then(notify, notify);
                });
                return () => { active = false; settings(); repository?.(); };
            },
            prepareWritingStyle: (prompt, parentScene, budget) => this.prepareWritingStyle(
                prompt,
                parentScene,
                budget,
            ),
            prepareWritingStyleForScene: (scene, budget) => this.prepareWritingStyleForScene(scene, budget),
            createMemoryStatus: () => ({
                getMaintenancePlan: () => this.hasStructuralAIConfiguration("memory")
                    ? this.memoryManager?.getMaintenancePlan() ?? Promise.resolve(this.unavailableMemoryPlan())
                    : Promise.resolve(this.unavailableMemoryPlan()),
                prepareFromCommand: () => this.ensureAIConfigured("memory")
                    ? this.runManualMemoryAction(
                        () => this.memoryManager?.prepareFromCommand() ?? Promise.resolve(),
                    )
                    : Promise.resolve(),
                updateFromCommand: () => this.ensureAIConfigured("memory")
                    ? this.runManualMemoryAction(
                        () => this.memoryManager?.updateFromCommand() ?? Promise.resolve(),
                    )
                    : Promise.resolve(),
                showTechnicalStatus: () => void this.showTechnicalMemoryStatus(),
                onStatusChanged: (listener) => this.onMemoryStatusChanged(listener),
            }),
            onSettingsChanged: (listener) => this.onSettingsChanged(listener),
            scheduleMemoryExtractionAfterChatTurn: (conversationId, turnCount) =>
                this.scheduleMemoryExtractionAfterChatTurn(conversationId, turnCount),
            openMemorySettings: (claimId) => this.openMemorySettings(claimId),
            completeAISetup: (input) => this.completeAISetup(input),
        },
        writingStyleRuntime: {
            getCoordinator: () => this.memoryGovernanceCoordinator ?? undefined,
            isOwnerCurrent: () => !this.unloading,
            isRuntimeEnabled: (coordinator) => !this.unloading
                && this.memoryGovernanceCoordinator === coordinator
                && this.settings.memoryEnabled === true
                && this.getMemoryGovernanceUiMode() === "effect_based",
            canManage: (coordinator) => !this.unloading
                && this.memoryGovernanceCoordinator === coordinator
                && this.getMemoryGovernanceUiMode() === "effect_based",
            getStateSnapshot: () => {
                const snapshot = this.getGovernedMemoryProjectionSnapshot();
                return snapshot && snapshot.state.commitSequence >= this.deviceMemoryCacheRefreshTargetSequence
                    ? snapshot
                    : null;
            },
            verifyNoteSource: async (ref, signal) => {
                const denied = { allowed: false, isCurrent: () => false };
                if (!ref.contentHash) return denied;
                const epoch = this.getMemoryGraphTopologyEpoch("chat");
                const source = await this.captureLatestMemorySource(
                    ref.path,
                    (path) => this.isMemoryProviderPathAllowed(path),
                    "chat",
                    signal,
                );
                if (!source || await hashWritingText(source.markdown) !== ref.contentHash) return denied;
                const file = this.app.vault.getAbstractFileByPath(source.path);
                if (!(file instanceof TFile)) return denied;
                const isCurrent = () => !this.unloading
                    && this.getMemoryGraphTopologyEpoch("chat") === epoch
                    && this.app.vault.getAbstractFileByPath(source.path) === file
                    && file.stat.mtime === source.mtime
                    && file.stat.size === source.size
                    && this.isMemoryProviderPathAllowed(file.path);
                return { allowed: !signal?.aborted && isCurrent(), isCurrent };
            },
        },
        writingRecovery: {
            isMemoryEnabled: () => this.settings.memoryEnabled === true,
            verifyNote: (ref, memory) => this.verifyWritingRecoveryNote(ref, memory),
            verifyGenerationSource: (source) => this.verifyWritingRecoveryGenerationSource(source),
        },
        isChatRuntimeCurrent: () => !this.unloading,
        log: (message, detail) => this.log(message, detail),
    });
    private readonly deepDiscoverIntegration = new DeepDiscoverPluginIntegration({
        app: {
            vault: this.app.vault,
        },
        source: this.sourceAccess,
        graph: {
            getMemoryGraphTopologyEpoch: () => this.getMemoryGraphTopologyEpoch("pagelet"),
            createMemoryGraphBoundarySnapshotSource: () => this.createMemoryGraphBoundarySnapshotSource("pagelet"),
            getResolvedOutgoingLinks: (path) => this.getResolvedOutgoingLinks(path),
            buildGraphDiscoveryBacklinkMap: () => this.buildGraphDiscoveryBacklinkMap(),
        },
        getPolicySnapshot: () => ({
            pagelet: this.getPageletSettingsWithDataBoundary(),
            provider: this.settings.aiProvider,
            providerPreset: this.settings.aiProviderPreset ?? null,
            endpoint: this.settings.baseURL ?? "",
            webSearchEnabled: this.settings.webSearchEnabled === true,
            licenseTier: this.settings.licenseTier,
            platform: Platform.isMobile ? "mobile" as const : "desktop" as const,
            retrievalOptimizationFlags: this.getEffectiveRetrievalOptimizationFlags(),
            chatModel: this.settings.chatModelName,
            policyModel: this.settings.policyModelName,
            embeddingModel: this.settings.embeddingModelName,
            qwenThinkingEnabled: this.settings.qwenThinkingEnabled === true,
            locale: this.getPageletLocale(),
        }),
        getDataBoundaryFingerprint: () => this.getMemoryDataBoundaryFingerprint(),
        createLiveHost: () => this.createAiServiceHost("pagelet"),
        isRuntimeCurrent: () => !this.unloading,
        isPageletEnabled: () => this.settings.pagelet?.enabled === true,
        getBackgroundDiscoveryState: () => ({
            enabled: this.isBackgroundDiscoveryEnabled(),
            epoch: this.backgroundDiscoveryEpoch ?? 0,
        }),
        ensureAIConfigured: () => this.ensureAIConfigured(),
        getAISetupIssue: () => this.getAISetupIssue(),
        getAPIToken: () => this.getAPIToken(),
        getProviderCallAdmission: () => this.getPageletProviderCallAdmission(),
        getCostTracker: () => this.pageletCostTracker,
        acquirePageletTurnLease: (signal) => this.agentRunCoordinator.acquirePageletTurnLease(signal),
        createRateLimitStorage: (vaultStorageScope) => this.createPageletRateLimitStorage(
            "deep-discover",
            vaultStorageScope,
        ),
        getVaultStorageScope: () => this.pageletVaultStorageScope(),
        getRateLimitStorageKey: (vaultStorageScope) => this.pageletRateLimitStorageKey(
            "deep-discover",
            vaultStorageScope,
        ),
        createAttentionStorage: () => this.createPageletAttentionStorage(),
        log: (message, detail) => this.log(message, detail),
    });
    private readonly retainedReviewIntegration = new RetainedReviewPluginIntegration({
        app: this.app,
        source: {
            isPageletProviderSourceAllowedFile: (file, markdown) => this.isPageletProviderSourceAllowedFile(file, markdown),
        },
        getSettings: () => ({
            pagelet: this.settings.pagelet,
            mergedPagelet: this.getPageletSettingsWithDataBoundary(),
            provider: this.settings.aiProvider,
            model: this.settings.chatModelName,
            embeddingModel: this.settings.embeddingModelName,
        }),
        getLocale: () => this.getPageletLocale(),
        isRuntimeCurrent: () => !this.unloading,
        getScopeRecapAuthorizationContextId: () => this.getScopeRecapAuthorizationContextId(),
        getScopeRecapProviderInfo: () => this.getScopeRecapProviderInfo(),
        getProviderCallAdmission: () => this.getPageletProviderCallAdmission(),
        getCostTracker: () => this.pageletCostTracker,
        requestHighRiskDecision: (summary, signal) => this.requestForegroundReviewHighRiskDecision(
            summary,
            signal,
        ),
        getVaultStorageScope: () => this.pageletVaultStorageScope(),
        createRateLimitStorage: (vaultStorageScope) => this.createPageletRateLimitStorage(
            "foreground-review",
            vaultStorageScope,
        ),
        getRateLimitStorageKey: (vaultStorageScope) => this.pageletRateLimitStorageKey(
            "foreground-review",
            vaultStorageScope,
        ),
        findRelatedNotes: (primarySourcePath, noteContents, sourcePaths, options) => this.findPageletRelatedNotes(
            primarySourcePath,
            noteContents,
            sourcePaths,
            options,
        ),
        createChatModel: (temperature, options) => this.createChatModel(temperature, options),
        log: (message, detail) => this.log(message, detail),
    });
    private readonly pageletOperationsIntegration = new PageletOperationsPluginIntegration({
        vault: this.app.vault,
        isOperationsAgentEnabled: () => this.isOperationsAgentEnabled,
        isPathAllowed: (path) => this.isPageletProviderPathAllowed(path),
        createSession: (options) => this.getOperationsService().createSession(options),
        now: () => Date.now(),
        log: (message, detail) => this.log(message, detail),
    });
    private readonly pageletActionIntegration = new PageletActionPluginIntegration({
        getLocale: () => this.getPageletLocale(),
        getSettings: () => ({
            dataBoundary: this.settings.dataBoundary,
            quickCaptureInboxPath: this.settings.quickCapture.inboxPath,
            maintenanceActionLog: this.settings.maintenanceReview.actionLog,
        }),
        collectMaintenanceReviewFiles: (options) => this.collectMaintenanceReviewFiles(options),
        readCached: (file) => this.app.vault.cachedRead(file),
        getDataBoundaryTags: (file) => this.getDataBoundaryTags(file),
        isGeneratedDataBoundaryFile: (file) => this.isGeneratedDataBoundaryFile(file),
        createReviewQueueItem: (input) => this.createReviewQueueItem(input),
        confirm: (input) => confirmUserAction(this.app, input),
        findMaintenanceQueueItem: (proposalId) => this.findMaintenanceQueueItem(proposalId),
        exists: (path) => this.app.vault.adapter.exists(normalizePath(path).replace(/^\.\//, "")),
        rename: async (from, to) => {
            const source = this.app.vault.getAbstractFileByPath(normalizePath(from).replace(/^\.\//, ""));
            if (!(source instanceof TFile)) throw new Error("source_missing");
            await this.app.vault.rename(source, normalizePath(to).replace(/^\.\//, ""));
        },
        getFile: (path) => {
            const file = this.app.vault.getAbstractFileByPath(path);
            return file instanceof TFile ? file : null;
        },
        isMaintenanceMovePathAllowed: (path) => this.isMaintenanceMovePathAllowed(path),
        now: () => new Date(),
        idFactory: () => this.maintenanceActionId(),
        appendMaintenanceActionLog: (action) => this.appendMaintenanceActionLog(action),
        replaceMaintenanceActionLog: (action) => this.replaceMaintenanceActionLog(action),
        updateMaintenanceQueueStatus: (id, status) => this.updateMaintenanceQueueStatus(id, status),
        mintNonCollidingPageletPath: (basePath) => this.mintNonCollidingPageletPath(basePath),
        captureReviewNoteWriter: () => {
            const runtime = this.getOrCreatePageletRuntime();
            if (!runtime) return null;
            return async ({ generatedNote, targetPath }) => {
                const result = await runtime.actionExecutor.execute(
                    runtime.toolProvider.capability,
                    { generatedNote, targetPath },
                    {
                        host: this.createAiServiceHost("pagelet"),
                        turnId: `pagelet-review-note-${Date.now()}`,
                    },
                );
                if (result.status === "ok") {
                    return {
                        status: "ok" as const,
                        observation: result.observation as { createdPath?: unknown },
                    };
                }
                return {
                    status: "error" as const,
                    userSafeMessage: result.userSafeMessage,
                    error: result.error,
                };
            };
        },
        log: (message, detail) => this.log(message, detail),
    });
    private readonly quietRecallIntegration = new QuietRecallPluginIntegration({
        app: this.app,
        source: this.sourceAccess,
        getSettings: () => ({
            provider: this.settings.aiProvider,
            providerPreset: this.settings.aiProviderPreset ?? null,
            model: this.settings.chatModelName,
            embeddingModel: this.settings.embeddingModelName,
            endpoint: this.settings.baseURL ?? "",
            quietRecall: this.settings.quietRecall,
            pagelet: this.settings.pagelet,
            retrievalHabitProfile: this.settings.retrievalHabitProfile,
            savedInsights: this.settings.savedInsights?.items ?? [],
        }),
        getLocale: () => this.getPageletLocale(),
        getDataBoundaryFingerprint: () => this.getMemoryDataBoundaryFingerprint(),
        isRuntimeCurrent: () => !this.unloading,
        isMemorySearchReady: () => this.isPageletMemorySearchReady(),
        findRelatedNotes: (activePath, contents, excludedPaths, options) => this.findPageletRelatedNotes(
            activePath,
            contents,
            excludedPaths,
            options,
        ),
        getGraphDiscoveryBacklinkMap: () => this.buildGraphDiscoveryBacklinkMap(),
        getResolvedOutgoingLinks: (path) => this.getResolvedOutgoingLinks(path),
        getGraphDiscoveryLinks: (file) => this.getGraphDiscoveryLinks(file),
        getProviderCallAdmission: () => this.getPageletProviderCallAdmission(),
        getCostTracker: () => this.pageletCostTracker,
        createRateLimitStorage: () => this.createPageletRateLimitStorage(
            "quiet-recall",
            this.pageletVaultStorageScope(),
        ),
        getVaultStorageScope: () => this.pageletVaultStorageScope(),
        getRateLimitStorageKey: (vaultStorageScope) => this.pageletRateLimitStorageKey(
            "quiet-recall",
            vaultStorageScope,
        ),
        getAISetupIssue: () => this.getAISetupIssue(),
        createModel: (temperature, options) => this.createChatModel(temperature, options),
        listSavedInsights: () => this.listSavedInsights(),
        createSavedInsight: (input) => this.getSavedInsightStore().create(input),
        confirmLink: async (input) => confirmUserAction(this.app, input),
        addRelatedLink: (currentPath, candidatePath) => addPaRelatedLink(
            this.app,
            currentPath,
            candidatePath,
        ),
        recordFeedback: (candidate, feedback) => this.getRetrievalHabitProfileStore()
            .recordRecallFeedback(candidate, feedback),
        log: (message, detail) => this.log(message, detail),
    });
    private readonly scopeRecapIntegration = new ScopeRecapPluginIntegration({
        app: this.app,
        source: this.sourceAccess,
        getSettings: () => ({
            provider: this.settings.aiProvider,
            providerPreset: this.settings.aiProviderPreset ?? null,
            model: this.settings.chatModelName,
            embeddingModel: this.settings.embeddingModelName,
            endpoint: this.settings.baseURL ?? "",
            pagelet: this.settings.pagelet,
            mergedPagelet: this.getPageletSettingsWithDataBoundary(),
        }),
        getDataBoundaryFingerprint: () => this.getMemoryDataBoundaryFingerprint(),
        isRuntimeCurrent: () => !this.unloading,
        getProviderCallAdmission: () => this.getPageletProviderCallAdmission(),
        getCostTracker: () => this.pageletCostTracker,
        createRateLimitStorage: () => this.createPageletRateLimitStorage(
            "scope-recap",
            this.pageletVaultStorageScope(),
        ),
        getVaultStorageScope: () => this.pageletVaultStorageScope(),
        getRateLimitStorageKey: (vaultStorageScope) => this.pageletRateLimitStorageKey(
            "scope-recap",
            vaultStorageScope,
        ),
        createModel: (temperature, options) => this.createChatModel(temperature, options),
        log: (message, detail) => this.log(message, detail),
    });
    private readonly vaultEventBridge = new VaultEventBridge({
        registerEvent: (eventRef) => this.registerEvent(eventRef),
        onMetadataEvent: (event, callback) => event === "resolved"
            ? this.app.metadataCache.on("resolved", callback)
            : this.app.metadataCache.on("changed", callback),
        onVaultEvent: (event, callback) => {
            if (event === "create") return this.app.vault.on("create", callback);
            if (event === "modify") return this.app.vault.on("modify", callback);
            if (event === "rename") return this.app.vault.on("rename", callback);
            return this.app.vault.on("delete", callback);
        },
        onWorkspaceActiveLeafChange: (callback) => this.app.workspace.on("active-leaf-change", callback),
        onWorkspaceFileOpen: (callback) => this.app.workspace.on("file-open", callback),
        invalidateVaultInsightsSource: (file, oldPath) => this.invalidateVaultInsightsSourceForFile(file, oldPath),
        invalidateMemoryGraphTopology: () => this.sourceAccess.invalidateMemoryGraphTopology(),
        getVss: () => this.vss,
        getMemoryManager: () => this.memoryManager,
        getMemoryExtractionScheduler: () => this.memoryExtractionScheduler,
        isRecentPageletSelfWrite: (path) => this.pageletIntegration.currentRuntime?.isRecentSelfWrite(path) === true,
        scheduleMemoryStatus: () => this.memoryStatusNotifier.schedule(),
    });
    private activeFeatureOptionsModal: Modal | null = null;
    private readonly localGraphIntegration = new LocalGraphIntegration({
        createGraph: () => new LocalGraph(this.app, this),
        isDesktop: () => Platform.isDesktop,
        createMutationObserver: (callback) => new MutationObserver(callback),
        getObservedBody: () => getPlatformDocument().body,
        setTimer: (callback, ms) => setPlatformTimeout(callback, ms),
        clearTimer: clearPlatformTimeout,
        log: (message, ...args) => this.log(message, ...args),
    });
    private readonly updateActions = {
        updatePlugins: createPluginUpdaterAction(() => new PluginsUpdater(this.app, this)),
        updateThemes: createThemeUpdaterAction(() => ThemeUpdater.init(this.app, this)),
    };
    private readonly aiActions = new AIActions({
        ensureAIConfigured: () => this.ensureAIConfigured(),
        getImageGenerationConnection: () => this.getImageGenerationConnection(),
        getProviderConnection: () => ({
            aiProvider: this.settings.aiProvider,
            baseURL: this.settings.baseURL,
            chatModelName: this.settings.chatModelName,
            embeddingModelName: this.settings.embeddingModelName,
        }),
        getFeaturedImageDefaults: () => ({
            featuredImageModel: this.settings.featuredImageModel,
            numFeaturedImages: this.settings.numFeaturedImages,
            featuredImagePath: this.settings.featuredImagePath,
        }),
        isUnloading: () => this.unloading,
        hasActiveAIProviderCredentialTransition: () => this.hasActiveAIProviderCredentialTransition(),
        getProviderConfigurationRevision: () => this.aiProviderConfigurationRevision,
        getTokenRevision: () => this.aiTokenRevision,
        getFileByPath: (path) => this.app.vault.getAbstractFileByPath(path),
        getConfiguredImageAPITokenSecret: () => this.getConfiguredImageAPITokenSecret(),
        getAPIToken: () => this.getAPIToken(),
        saveFeaturedImageDefaults: (options) => this.saveFeaturedImageDefaults(options),
        createSummaryHelper: (editor, view) => new AssistantHelper(this, editor, view),
        createFeaturedImageHelper: (editor, view) => new AssistantFeaturedImageHelper(this.app, this, editor, view),
        openSharedFeatureModal: (host) => this.openSharedFeatureModal(host),
        log: (message, ...args) => this.log(message, ...args),
    });
    private readonly shareCardActions = new ShareCardActions({
        createModal: (data) => new ShareCardModal(this.app, data),
        closeAllModals: () => closeAllShareCardModals(),
        getMenuTitle: () => this.t('plugin.menu.shareSelectionAsCard'),
        menuIcon: 'image',
    });
    private settingTab: SettingTab = new SettingTab(this.app, this);
    get statsManager(): StatsManager | undefined {
        return this.statsIntegration.statsManager;
    }
    get vss(): VSS | null { return this.memoryIntegration.getVss(); }
    set vss(value: VSS | null) { this.memoryIntegration.setVss(value); }
    get memoryManager(): MemoryManager | null { return this.memoryIntegration.getMemoryManager(); }
    set memoryManager(value: MemoryManager | null) { this.memoryIntegration.setMemoryManager(value); }
    /** Monotonic policy clock for live retrieval rollout flags. */
    private retrievalOptimizationEpoch = 0;
    private retrievalOptimizationSignature = "";
    /** In-memory and inert until the isolated device harness explicitly starts it. */
    private readonly retrievalDiagnostics = new RetrievalDiagnosticsController();
    /** Shared capacity-one lane: Chat owns run-level priority over Pagelet turns. */
    private readonly agentRunCoordinator = new AgentRunCoordinator();
    /** Shared provider/policy composition root; mutable intent state stays per surface. */
    private operationsService: OperationsService | null = null;
    get chatHistoryStore(): ChatHistoryStore | undefined {
        return this.chatIntegration.getHistoryStore();
    }

    set chatHistoryStore(value: ChatHistoryStore | undefined) {
        this.chatIntegration.setHistoryStoreForCompatibility(value);
    }

    get chatHistoryManager(): ChatHistoryManager | undefined {
        return this.chatIntegration.getHistoryManager();
    }

    set chatHistoryManager(value: ChatHistoryManager | undefined) {
        this.chatIntegration.setHistoryManagerForCompatibility(value);
    }

    get imageAssetService(): ImageAssetService | undefined {
        return this.chatIntegration.getImageAssetService();
    }

    set imageAssetService(value: ImageAssetService | undefined) {
        this.chatIntegration.setImageAssetServiceForCompatibility(value);
    }

    get imageGenerationService(): ImageGenerationService | undefined {
        return this.chatIntegration.getImageGenerationService();
    }

    set imageGenerationService(value: ImageGenerationService | undefined) {
        this.chatIntegration.setImageGenerationServiceForCompatibility(value);
    }

    get writingVersions(): WritingVersionService | undefined {
        return this.chatIntegration.getWritingVersions();
    }

    set writingVersions(value: WritingVersionService | undefined) {
        this.chatIntegration.setWritingVersionsForCompatibility(value);
    }

    get writingSave(): WritingSaveAction | undefined {
        return this.chatIntegration.getWritingSave();
    }

    set writingSave(value: WritingSaveAction | undefined) {
        this.chatIntegration.setWritingSaveForCompatibility(value);
    }

    private get writingStyleService(): WritingStyleService | undefined {
        return this.chatIntegration.getWritingStyleService();
    }

    private set writingStyleService(value: WritingStyleService | undefined) {
        this.chatIntegration.setWritingStyleServiceForCompatibility(value);
    }

    private get writingStyleCoordinator(): MemoryGovernanceCoordinator | undefined {
        return this.chatIntegration.getWritingStyleCoordinator();
    }

    private set writingStyleCoordinator(value: MemoryGovernanceCoordinator | undefined) {
        this.chatIntegration.setWritingStyleCoordinatorForCompatibility(value);
    }
    private get memoryExtractionScheduler(): MemoryExtractionScheduler | null {
        return this.memoryIntegration.getExtractionScheduler();
    }
    private set memoryExtractionScheduler(value: MemoryExtractionScheduler | null) {
        this.memoryIntegration.setExtractionScheduler(value);
    }
    private get vaultInsightsSourceOwner(): object | undefined {
        return this.memoryIntegration.getVaultInsightsSourceOwner();
    }
    private set vaultInsightsSourceOwner(value: object | undefined) {
        this.memoryIntegration.setVaultInsightsSourceOwner(value);
    }
    private get vaultInsightsSource(): VaultInsightsSourceReceipt | null {
        return this.memoryIntegration.getVaultInsightsSource();
    }
    private set vaultInsightsSource(value: VaultInsightsSourceReceipt | null) {
        this.memoryIntegration.setVaultInsightsSource(value);
    }
    private get memoryExtractionProfileStore(): "legacy" | "governed" {
        return this.memoryIntegration.getExtractionProfileStore();
    }
    private set memoryExtractionProfileStore(value: "legacy" | "governed") {
        this.memoryIntegration.setExtractionProfileStore(value);
    }
    /**
     * Pagelet (Review Assistant) per-plugin runtime — lazy-constructed on
     * first review trigger so cold-start cost stays zero for users who never
     * enable Pagelet. Owned by the plugin so the framework's self-write
     * registry can outlive any individual PaAgentRuntime turn (which lives
     * per-streamTurn inside chat-service.ts).
     */
    readonly pageletCostTracker = new PageletCostTracker();
    private readonly quickCaptureIntegration = new QuickCapturePluginIntegration({
        app: this.app,
        getSettings: () => this.settings,
        translate: (key, params, fallback) => this.t(key, params, fallback),
        log: (message, ...args) => this.log(message, ...args),
        decideDataBoundaryForPath: (path) => this.decideDataBoundaryForPath(path),
        createChatModel: () => this.createChatModel(0.2, { maxTokens: 800 }),
        recordProviderCost: (usage) => this.pageletCostTracker.record(usage),
        createReviewQueueItem: (input) => this.createReviewQueueItem(input),
        saveSettings: () => this.saveSettings(),
        maybeShowOnboardingNudge: () => this.maybeShowQuickCaptureOnboardingNudge(),
    });
    private pageletFeatureScope: Component | null = null;
    private pageletSettingsUnsubscribe: (() => void) | null = null;
    private pageletCommandsRegistered = false;
    private pageletFocusCommandRegistered = false;
    private get vaultInsightsInjectionNoticeSurfacedThisBoot(): boolean {
        return this.memoryIntegration.getInjectionNoticeSurfaced();
    }
    private set vaultInsightsInjectionNoticeSurfacedThisBoot(value: boolean) {
        this.memoryIntegration.setInjectionNoticeSurfaced(value);
    }
    private pageletProviderCallAdmissionInstance: PageletProviderCallAdmission | null = null;
    private savedInsightStore: SavedInsightStore | null = null;
    private insightActionPort: ReturnType<typeof createInsightActionPort> | null = null;
    private get reviewQueueStore(): ReviewQueueStore | null { return this.governanceStorage.queueStore; }
    private set reviewQueueStore(value: ReviewQueueStore | null) { this.governanceStorage.queueStore = value; }
    private get memoryGovernanceStore(): MemoryGovernanceStore | null {
        return this.governanceStorage.governanceStore;
    }
    private set memoryGovernanceStore(value: MemoryGovernanceStore | null) {
        this.governanceStorage.governanceStore = value;
    }
    private get legacyMemoryCompatibilityBarrier(): LegacyMemoryCompatibilityBarrier | null {
        return this.governanceStorage.getLegacyBarrier();
    }
    private set legacyMemoryCompatibilityBarrier(value: LegacyMemoryCompatibilityBarrier | null) {
        this.governanceStorage.setLegacyBarrierForCompatibility(value);
    }
    private get legacyMemoryPayload(): LegacyMemoryPayload | null {
        return this.governanceStorage.getLegacyPayload();
    }
    private set legacyMemoryPayload(value: LegacyMemoryPayload | null) {
        this.governanceStorage.setLegacyPayload(value);
    }
    private get memoryGovernanceBootstrapState(): MemoryGovernanceBootstrapState {
        return this.governanceStorage.bootstrapState;
    }
    private set memoryGovernanceBootstrapState(value: MemoryGovernanceBootstrapState) {
        this.governanceStorage.bootstrapState = value;
    }
    private get memoryGovernanceBootstrapErrorCode(): string | null {
        return this.governanceStorage.bootstrapError;
    }
    private set memoryGovernanceBootstrapErrorCode(value: string | null) {
        this.governanceStorage.bootstrapError = value;
    }
    private get memoryGovernanceOpaqueVaultKey(): string | null {
        return this.governanceStorage.vaultKey;
    }
    private set memoryGovernanceOpaqueVaultKey(value: string | null) {
        this.governanceStorage.vaultKey = value;
    }
    private get memoryGovernanceSourceHash(): string | null {
        return this.governanceStorage.currentSourceHash;
    }
    private set memoryGovernanceSourceHash(value: string | null) {
        this.governanceStorage.currentSourceHash = value;
    }
    private get legacyProfileContext(): { scope: string; snapshot: UserProfileSnapshot } | null {
        return this.memoryIntegration.getLegacyProfileContext();
    }
    private set legacyProfileContext(value: { scope: string; snapshot: UserProfileSnapshot } | null) {
        this.memoryIntegration.setLegacyProfileContext(value);
    }
    private get legacyProfileReadEpoch(): number { return this.memoryIntegration.getLegacyProfileReadEpoch(); }
    private set legacyProfileReadEpoch(value: number) { this.memoryIntegration.setLegacyProfileReadEpoch(value); }
    private get legacyProfileRead(): { scope: string; promise: Promise<void> } | null {
        return this.memoryIntegration.getLegacyProfileRead();
    }
    private set legacyProfileRead(value: { scope: string; promise: Promise<void> } | null) {
        this.memoryIntegration.setLegacyProfileRead(value);
    }
    private get legacyProfileMutationCount(): number { return this.memoryIntegration.getLegacyProfileMutationCount(); }
    private set legacyProfileMutationCount(value: number) { this.memoryIntegration.setLegacyProfileMutationCount(value); }
    /** In-memory source identity: ordinary cache refresh is not a source mutation. */
    private get legacyProfileSourceIdentity(): object { return this.memoryIntegration.getLegacyProfileSourceIdentity(); }
    private set legacyProfileSourceIdentity(value: object) { this.memoryIntegration.setLegacyProfileSourceIdentity(value); }
    private get deviceMemoryGovernanceRepository(): MemoryGovernanceRepository | null {
        return this.governanceStorage.deviceRepository;
    }
    private set deviceMemoryGovernanceRepository(value: MemoryGovernanceRepository | null) {
        this.governanceStorage.deviceRepository = value;
    }
    private get currentDeviceMemoryGovernanceState(): DeviceMemoryGovernanceStateV1 | null {
        return this.governanceStorage.stateSnapshot;
    }
    private set currentDeviceMemoryGovernanceState(value: DeviceMemoryGovernanceStateV1 | null) {
        this.governanceStorage.stateSnapshot = value;
    }
    private get memoryGovernanceCoordinator(): MemoryGovernanceCoordinator | null {
        return this.governanceActions.governanceCoordinator;
    }
    private set memoryGovernanceCoordinator(value: MemoryGovernanceCoordinator | null) {
        this.governanceActions.governanceCoordinator = value;
    }
    private get memoryAdmissionCoordinator(): MemoryAdmissionCoordinator | null {
        return this.governanceActions.admission;
    }
    private set memoryAdmissionCoordinator(value: MemoryAdmissionCoordinator | null) {
        this.governanceActions.admission = value;
    }
    private get memoryProfileProjectionWorker(): MemoryProfileProjectionWorker | null {
        return this.governanceActions.projectionWorker;
    }
    private set memoryProfileProjectionWorker(value: MemoryProfileProjectionWorker | null) {
        this.governanceActions.projectionWorker = value;
    }
    private get memoryForgetRetryTimer(): PlatformTimeoutHandle | null {
        return this.governanceActions.forgetTimer;
    }
    private set memoryForgetRetryTimer(value: PlatformTimeoutHandle | null) {
        this.governanceActions.forgetTimer = value;
    }
    private get memoryForgetRetryDelayMs(): number { return this.governanceActions.forgetDelayMs; }
    private set memoryForgetRetryDelayMs(value: number) { this.governanceActions.forgetDelayMs = value; }
    private get memoryProfileProjectionRetryTimer(): PlatformTimeoutHandle | null {
        return this.governanceActions.projectionRetryTimer;
    }
    private set memoryProfileProjectionRetryTimer(value: PlatformTimeoutHandle | null) {
        this.governanceActions.projectionRetryTimer = value;
    }
    private get memoryProfileProjectionRetryDelayMs(): number {
        return this.governanceActions.projectionRetryDelayMs;
    }
    private set memoryProfileProjectionRetryDelayMs(value: number) {
        this.governanceActions.projectionRetryDelayMs = value;
    }
    private get memoryGovernanceGarbageCollectionTimer(): PlatformTimeoutHandle | null {
        return this.governanceActions.gcTimer;
    }
    private set memoryGovernanceGarbageCollectionTimer(value: PlatformTimeoutHandle | null) {
        this.governanceActions.gcTimer = value;
    }
    private get memoryGovernanceGarbageCollectionDueAt(): number | null {
        return this.governanceActions.gcDueAt;
    }
    private set memoryGovernanceGarbageCollectionDueAt(value: number | null) {
        this.governanceActions.gcDueAt = value;
    }
    private get memoryLifecycleMutationTail(): Promise<void> {
        return this.governanceActions.mutationTail;
    }
    private set memoryLifecycleMutationTail(value: Promise<void>) {
        this.governanceActions.mutationTail = value;
    }
    private get deviceMemoryRecordRepository(): DeviceMemoryGovernanceRecordRepository | null {
        return this.governanceStorage.deviceRecordRepository;
    }
    private set deviceMemoryRecordRepository(value: DeviceMemoryGovernanceRecordRepository | null) {
        this.governanceStorage.deviceRecordRepository = value;
    }
    private get deviceMemoryReviewQueueRepository(): MemoryReviewQueueRepository | null {
        return this.governanceStorage.deviceQueueRepository;
    }
    private set deviceMemoryReviewQueueRepository(value: MemoryReviewQueueRepository | null) {
        this.governanceStorage.deviceQueueRepository = value;
    }
    private get memoryGovernanceRecordRepository(): MemoryGovernanceRecordRepository | null {
        return this.governanceStorage.recordRepositoryView;
    }
    private set memoryGovernanceRecordRepository(value: MemoryGovernanceRecordRepository | null) {
        this.governanceStorage.recordRepositoryView = value;
    }
    private get reviewQueueRepository(): ReviewQueueRepository | null {
        return this.governanceStorage.queueRepositoryView;
    }
    private set reviewQueueRepository(value: ReviewQueueRepository | null) {
        this.governanceStorage.queueRepositoryView = value;
    }
    private get settingsReviewQueueRepository(): ReviewQueueRepository | null {
        return this.governanceStorage.settingsQueueRepository;
    }
    private set settingsReviewQueueRepository(value: ReviewQueueRepository | null) {
        this.governanceStorage.settingsQueueRepository = value;
    }
    private get memoryGovernanceRepositoryUnsubscribe(): (() => void) | null {
        return this.governanceStorage.repositoryUnsubscribe;
    }
    private set memoryGovernanceRepositoryUnsubscribe(value: (() => void) | null) {
        this.governanceStorage.repositoryUnsubscribe = value;
    }
    private get deviceMemoryCacheRefreshPromise(): Promise<void> | null {
        return this.governanceStorage.cacheRefreshPromise;
    }
    private set deviceMemoryCacheRefreshPromise(value: Promise<void> | null) {
        this.governanceStorage.cacheRefreshPromise = value;
    }
    private get deviceMemoryCacheRefreshTargetSequence(): number {
        return this.governanceStorage.cacheRefreshTargetSequence;
    }
    private set deviceMemoryCacheRefreshTargetSequence(value: number) {
        this.governanceStorage.cacheRefreshTargetSequence = value;
    }
    private get memoryGovernanceRuntimeGeneration(): number {
        return this.governanceStorage.runtimeGeneration;
    }
    private set memoryGovernanceRuntimeGeneration(value: number) {
        this.governanceStorage.runtimeGeneration = value;
    }
    private get currentLocalConfirmedMemoryCount(): number | null {
        return this.governanceStorage.confirmedMemoryCount;
    }
    private set currentLocalConfirmedMemoryCount(value: number | null) {
        this.governanceStorage.confirmedMemoryCount = value;
    }
    private get currentLocalMemoryAutoAcceptPaused(): boolean | null {
        return this.governanceStorage.autoAcceptPaused;
    }
    private set currentLocalMemoryAutoAcceptPaused(value: boolean | null) {
        this.governanceStorage.autoAcceptPaused = value;
    }
    private retrievalHabitProfileStore: RetrievalHabitProfileStore | null = null;
    private loadedPluginBuildIdentityPromise: Promise<{
        schemaVersion: 1;
        pluginId: string;
        pluginVersion: string;
        pluginArtifactPath: string;
        loadedPluginArtifactSha256: string | null;
        lexicalProfileRuntimeFingerprint: string;
        capturedAtPluginLoad: string;
        identitySource: "plugin-onload-cached-main-js";
        blocker: "loaded_plugin_artifact_unavailable" | null;
    }> | null = null;
    get vssCacheDir(): string { return this.memoryIntegration.vssCacheDir; }
    private backlinkMapCache: { map: Map<string, string[]>; builtAt: number } | null = null;
    private static readonly BACKLINK_MAP_TTL_MS = 30_000;
    private get memoryStatusNotifier(): MemoryStatusNotifier { return this.memoryIntegration.getStatusNotifier(); }
    private set memoryStatusNotifier(value: MemoryStatusNotifier) { this.memoryIntegration.setStatusNotifier(value); }
    private get memoryQueueAuditPromise(): Promise<void> | null {
        return this.governanceActions.auditPromise;
    }
    private set memoryQueueAuditPromise(value: Promise<void> | null) {
        this.governanceActions.auditPromise = value;
    }
    private phase3Handle: PlatformTimeoutHandle | null = null;
    private unloading = false;

    startRetrievalDiagnostics(): RetrievalDiagnosticsSessionIdentity {
        return this.retrievalDiagnostics.start();
    }

    armRetrievalCancellationProbe(sessionId: string): RetrievalCancellationProbeAck {
        return this.retrievalDiagnostics.armCancellationProbe(sessionId);
    }

    getRetrievalDiagnostics(sessionId: string): RetrievalDiagnosticsSnapshot {
        return this.retrievalDiagnostics.snapshot(sessionId);
    }

    stopRetrievalDiagnostics(sessionId: string): RetrievalDiagnosticsSnapshot {
        return this.retrievalDiagnostics.stop(sessionId);
    }

    /** Latest real, content-free Pagelet controller/delivery projection for local app smoke. */
    getPageletDeepDiscoverSmokeSnapshot(): Promise<PageletDeepDiscoverSmokeSnapshot | null> {
        return this.deepDiscoverIntegration.getSmokeSnapshot();
    }

    /** Content-free runtime identity seam for exact local smoke evidence. */
    getObsidianRuntimeIdentity(): {
        loadedAppVersion: string;
        loadedAppVersionSource: "obsidian.apiVersion";
    } {
        return {
            loadedAppVersion: apiVersion,
            loadedAppVersionSource: "obsidian.apiVersion",
        };
    }

    /**
     * Content-free build identity captured from the plugin artifact when this
     * instance starts. Keeping the first read lets an external verifier detect
     * a newer main.js copied over an older still-loaded instance.
     */
    getLoadedPluginBuildIdentity(): Promise<{
        schemaVersion: 1;
        pluginId: string;
        pluginVersion: string;
        pluginArtifactPath: string;
        loadedPluginArtifactSha256: string | null;
        lexicalProfileRuntimeFingerprint: string;
        capturedAtPluginLoad: string;
        identitySource: "plugin-onload-cached-main-js";
        blocker: "loaded_plugin_artifact_unavailable" | null;
    }> {
        return this.ensureLoadedPluginBuildIdentity();
    }

    private ensureLoadedPluginBuildIdentity(): NonNullable<PluginManager["loadedPluginBuildIdentityPromise"]> {
        if (this.loadedPluginBuildIdentityPromise) return this.loadedPluginBuildIdentityPromise;
        const capturedAtPluginLoad = new Date().toISOString();
        const pluginId = this.manifest?.id ?? "personal-assistant";
        const pluginVersion = this.manifest?.version ?? "";
        const pluginArtifactPath = this.join(
            this.app.vault.configDir,
            `plugins/${pluginId}/main.js`,
        );
        this.loadedPluginBuildIdentityPromise = (async () => {
            let loadedPluginArtifactSha256: string | null = null;
            try {
                const artifact = await this.app.vault.adapter.read(pluginArtifactPath);
                const platformCrypto = getPlatformCrypto();
                if (!platformCrypto?.subtle) throw new Error("Web Crypto is unavailable.");
                const digest = await platformCrypto.subtle.digest(
                    "SHA-256",
                    new TextEncoder().encode(artifact),
                );
                loadedPluginArtifactSha256 = [...new Uint8Array(digest)]
                    .map((byte) => byte.toString(16).padStart(2, "0"))
                    .join("");
            } catch {
                loadedPluginArtifactSha256 = null;
            }
            return {
                schemaVersion: 1,
                pluginId,
                pluginVersion,
                pluginArtifactPath,
                loadedPluginArtifactSha256,
                lexicalProfileRuntimeFingerprint: getCharPhraseRuntimeCanaryFingerprint(),
                capturedAtPluginLoad,
                identitySource: "plugin-onload-cached-main-js",
                blocker: loadedPluginArtifactSha256 === null
                    ? "loaded_plugin_artifact_unavailable"
                    : null,
            };
        })();
        return this.loadedPluginBuildIdentityPromise;
    }

    private t(key: PluginMessageKey, params?: Readonly<Record<string, string | number>>, fallback?: string): string {
        return pluginT(key, getPluginUiLanguage(), params, fallback);
    }

    async onload() {
        void this.ensureLoadedPluginBuildIdentity();
        this.vaultEventBridge.resetStartupEventGate();
        await this.loadSettings();
        void this.cleanupLegacyMobileDebugLog();

        // 迁移旧版本设置
        try {
            await this.migrateSettings();
        } catch (error) {
            if (!(error instanceof MemoryGovernanceBootstrapError)
                || error.code !== "legacy_save_collision") throw error;
            await this.failMemoryGovernanceBootstrap(
                this.memoryGovernanceBootstrapErrorCode ?? error.code,
            );
        }
        if (this.memoryGovernanceBootstrapState !== "failed") {
            await this.initializeMemoryGovernanceBootstrap();
        }
        await this.refreshLegacyProfileContext();

        // Surface the one-time Pagelet reviewsFolder migration Notice, if
        // `loadSettings` flagged a coerced value. We fire here (not in
        // `loadSettings`) so the Notice is bound to plugin onload and respects
        // the user's installed locale.
        this.surfacePendingPageletReviewsFolderMigration();

        // showup notification of plugin starting when it is in debug mode
        if (this.settings.debug) {
            new Notice(this.t("plugin.notice.starting"));
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

        this.chatIntegration.initialize();
        await this.initializeMemorySubsystem();
        if (this.unloading) return;
        const agentDebug = this.getAgentDebugIntegration();
        void agentDebug.initialize();
        this.register(this.onSettingsChanged(() => agentDebug.settingsChanged()));
        const deniedDebugSources = new Set<string>();
        const observeDebugSourcePermission = (file: TFile): void => {
            if (file.extension !== 'md') return;
            if (this.isDataBoundaryAllowedFile(file)) {
                deniedDebugSources.delete(file.path);
            } else if (!deniedDebugSources.has(file.path)) {
                deniedDebugSources.add(file.path);
                agentDebug.sourceRevoked();
            }
        };
        this.registerEvent(this.app.metadataCache.on('changed', observeDebugSourcePermission));
        this.registerEvent(this.app.vault.on('rename', (file) => {
            if (file instanceof TFile) observeDebugSourcePermission(file);
        }));
        this.registerEvent(this.app.vault.on('delete', (file) => {
            if (file instanceof TFile && file.extension === 'md') agentDebug.sourceRevoked();
        }));
        this.statsIntegration.initialize();
        const obsidianRegistration = {
            registerView: (viewType: string, factory: (leaf: WorkspaceLeaf) => View) => {
                this.registerView(viewType, factory);
            },
            addCommand: (command: Command) => {
                this.addCommand(command);
            },
        };
        registerObsidianViews(obsidianRegistration, [
            {
                viewType: AGENT_DEBUG_VIEW_TYPE,
                createView: (leaf) => new AgentDebugView(leaf, agentDebug.viewHost()),
            },
            {
                viewType: RECORD_PREVIEW_TYPE,
                createView: (leaf) => { return new RecordPreview(this.app, this, leaf); },
            },
            {
                viewType: STAT_PREVIEW_TYPE,
                createView: (leaf) => { return new Stat(this.app, this, leaf); },
            },
            {
                viewType: VIEW_TYPE_LLM,
                createView: (leaf) => {
                    return new LLMView(leaf, this.createChatHost());
                },
            },
        ]);
        registerPageletDetailIcon();
        registerObsidianViews(obsidianRegistration, [{
            viewType: PAGELET_DETAIL_VIEW_TYPE,
            createView: (leaf) => {
                return new PageletDetailView(
                    leaf,
                    () => this.getPageletLocale(),
                    (note) => this.savePageletSummaryNote(note),
                    (proposal) => this.applyMaintenanceProposal(proposal),
                    (actionId) => this.undoMaintenanceMove(actionId),
                    (item) => this.confirmMemoryCandidateFromQueueItem(item),
                    (item) => this.dismissMemoryCandidateFromQueueItem(item),
                    (record) => this.forgetConfirmedMemory(record),
                    (candidate) => this.saveQuietRecallAsInsight(candidate),
                    (candidate) => this.linkQuietRecallCandidateFromActiveNote(candidate),
                    () => { openSettings(this.app); openSettingsTab(this.app, 'personal-assistant'); },
                    {
                        onCorrect: (record, summary) => this.runPageletGovernedMemoryAction(
                            "correct",
                            record,
                            summary,
                        ),
                        onPauseUse: (record) => this.runPageletGovernedMemoryAction("pause", record),
                        onResumeUse: (record) => this.runPageletGovernedMemoryAction("resume", record),
                        onForget: (record) => this.forgetMemoryFromPagelet(record),
                        onUndoRecentChange: (change) => this.undoMemoryFromPagelet(change),
                        onOpenSource: (path) => { void this.openMemorySource(path); },
                        onOpenMemorySettings: (targetId) => this.openMemorySettings(targetId),
                        resolveContextualMemory: () => this.getMemoryGovernancePanelState(),
                    },
                );
            },
        }]);

        registerObsidianCommands(obsidianRegistration, [{
            id: 'startup-recording',
            name: this.t("plugin.command.recordNote"),
            callback: async () => {
                const fileFormat = moment().format(this.settings.fileFormat);
                const targetDir = this.settings.targetPath;
                this.log(targetDir, fileFormat);
                await this.createNewNote(targetDir, fileFormat);
            }
        },
        {
            id: QUICK_CAPTURE_COMMAND_ID,
            name: QUICK_CAPTURE_COMMAND_NAME,
            callback: () => {
                this.openQuickCaptureModal();
            }
        }, {
            id: 'open-agent-debug-history',
            name: this.t('plugin.agentDebug.open'),
            callback: () => { void this.openAgentDebug(); },
        }]);

        this.addCommand({
            id: "pa-toggle-focus-mode",
            name: this.t("plugin.command.focusMode"),
            callback: () => {
                this.settings.focusMode = !this.settings.focusMode;
                void this.saveSettings();
                const message = this.settings.focusMode
                    ? this.t("plugin.focusMode.enabled")
                    : this.t("plugin.focusMode.disabled");
                new Notice(message, 3000);
            },
        });

        this.addCommand({
            id: 'local-graph',
            name: this.t("plugin.command.hoverLocalGraph"),
            callback: async () => {
                await this.localGraphIntegration.startup();
            }
        });

        this.addCommand({
            id: "pa-graph-options",
            name: this.t("plugin.settings.graph.options.title"),
            checkCallback: (checking) => {
                if (this.app.workspace.getActiveViewOfType(ItemView)?.getViewType() !== "localgraph") return false;
                if (!checking) this.openGraphOptions();
                return true;
            },
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
                await this.localGraphIntegration.updateGraphColors();
            }
        });

        registerObsidianCommands(obsidianRegistration, [{
            id: 'update-plugins',
            name: this.t("plugin.command.updatePlugins"),
            callback: async () => {
                await this.updateActions.updatePlugins();
            },
        },
        {
            id: 'update-themes',
            name: this.t("plugin.command.updateThemes"),
            callback: async () => {
                await this.updateActions.updateThemes();
            },
        },
        {
            id: 'update-metadata',
            name: this.t("plugin.command.updateMetadata"),
            callback: async () => {
                this.metadataUpdater.toggle();
            },
        }]);


        registerObsidianCommands(obsidianRegistration, [{
            id: "list-callouts",
            name: this.t("plugin.command.listCallouts"),
            callback: () => {
                new CalloutModal(this.app, this.calloutHost).open();
            },
        }]);

        registerObsidianCommands(obsidianRegistration, [{
            id: "preview-records",
            name: this.t("plugin.command.previewRecords"),
            callback: () => {
                void this.activateView();
            },
        }]);

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
                await this.aiActions.summarize(editor, view);
            }
        });

        this.addCommand({
            id: 'ai-assistant-featured-images',
            name: this.t("plugin.command.aiFeaturedImages"),
            editorCheckCallback: (checking, editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
                return this.aiActions.checkFeaturedImage(checking, editor, view);
            }
        });

        this.addCommand({
            id: 'share-selection-as-card',
            name: this.t("plugin.command.shareSelectionAsCard"),
            editorCheckCallback: (checking, editor: Editor, view: MarkdownView | MarkdownFileInfo) => {
                return this.shareCardActions.checkShareSelection(checking, editor, view);
            },
        });

        this.registerEvent(this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
            this.shareCardActions.handleEditorMenu(menu, editor, info);
        }));

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
        this.registerEditorExtension(this.statsIntegration.getEditorExtensions());

        this.registerEvent(
            this.app.workspace.on("active-leaf-change", async (leaf) => {
                await this.statsIntegration.flush();
            })
        );
        // This adds a settings tab so the user can configure various aspects of the plugin
        this.addSettingTab(this.settingTab);

        this.app.workspace.onLayoutReady(() => {
            void this.onLayoutReady();
        });
    }

    private async cleanupLegacyMobileDebugLog(): Promise<void> {
        const pluginDir = this.manifest?.dir;
        if (!pluginDir) return;
        const logPath = normalizePath(`${pluginDir}/logs.txt`);
        let exists: boolean;
        try {
            exists = await this.app.vault.adapter.exists(logPath);
        } catch {
            try {
                this.log("Legacy mobile Debug log cleanup failed", { stage: "exists" });
            } catch {
                // Cleanup must never make plugin startup fail.
            }
            return;
        }
        if (!exists) return;
        try {
            await this.app.vault.adapter.remove(logPath);
        } catch {
            try {
                this.log("Legacy mobile Debug log cleanup failed", { stage: "remove" });
            } catch {
                // Cleanup must never make plugin startup fail.
            }
        }
    }

    private async onLayoutReady(): Promise<void> {
        if (this.unloading) return;

        this.localGraphIntegration.setupObserver();
        await this.initializeMemorySubsystem();
        if (this.unloading) return;

        this.chatIntegration.recoverAfterLayoutReady(() => this.unloading);
        this.statsIntegration.initialize();
        void this.calloutIntegration.initialize();
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
        void this.reconcileMemoryQueueAudit();
        void this.maybeShowNextOnboardingNudge();
        void this.maybeRunPatternDetectionNudge();
        this.syncMemoryExtractionRuntime();
    }

    private async maybeShowNextOnboardingNudge(): Promise<void> {
        await this.maybeShowMaintenanceScanOnboardingNudge();
        if (this.pageletIntegration.currentOrchestrator?.hasActiveOnboardingNudge) return;
        await this.maybeShowQuickCaptureOnboardingNudge();
    }

    private initializeMemorySubsystem(): Promise<void> {
        const memoryHost = this.createMemoryHost();
        return this.memoryIntegration.initializeSubsystem(
            memoryHost,
            (host, cacheDir) => this.initVss(host, cacheDir),
            () => this.updateMemoryStatusBar(),
        );
    }

    private setupSettingsWatcher(): void {
        this.pageletSettingsUnsubscribe?.();
        this.pageletSettingsUnsubscribe = this.onSettingsChanged(async () => {
            this.syncPageletRuntime();
            this.syncMemoryExtractionRuntime();
            void this.reconcileMemoryQueueAudit();
            if (!this.settings.memoryEnabled) {
                this.memoryManager?.cancelActivePreparation();
            }
            await this.refreshLegacyProfileContext();
        });
    }

    private registerVaultEventDispatch(): void {
        this.vaultEventBridge.registerEventDispatch();
    }

    private async handleMemoryVaultChange(file: TFile, reason: "vault-create" | "vault-modify"): Promise<void> {
        return this.vaultEventBridge.handleMemoryVaultChange(file, reason);
    }

    private isLikelyStartupReplayMemoryEvent(file: TFile): boolean {
        return this.vaultEventBridge.isLikelyStartupReplayMemoryEvent(file);
    }

    private syncPageletRuntime(): void {
        if (!this.settings.pagelet?.enabled) {
            this.destroyPageletRuntime();
            return;
        }
        this.pageletIntegration.sync(true);
    }

    private getQuietRecallEvaluationPolicyIdentity(): string {
        return this.quietRecallIntegration.getPolicyIdentity();
    }

    private hasConfirmedMemoryExtractionConsent(): boolean {
        return isMemoryExtractionConsentConfirmed(this.settings.memoryExtractionConsent);
    }

    private canRunMemoryExtractionRuntime(): boolean {
        return this.memoryIntegration.canRunExtraction();
    }

    private syncMemoryExtractionRuntime(): void {
        this.memoryIntegration.syncExtractionRuntime();
    }

    private createVaultInsightsSourceListener(): (source: VaultInsightsSourceReceipt | null) => void {
        return this.memoryIntegration.createVaultInsightsSourceListener();
    }

    private captureVaultInsightsSourceValidity(): () => boolean {
        return this.memoryIntegration.captureVaultInsightsSourceValidity();
    }

    private invalidateVaultInsightsSourceForFile(file: TAbstractFile, oldPath?: string): void {
        this.memoryIntegration.invalidateVaultInsightsSourceForFile(file, oldPath);
    }

    private async admitGovernedTypeABatch(
        batch: TypeAAdmissionBatch,
    ): Promise<TypeAAdmissionResult> {
        const coordinator = this.memoryAdmissionCoordinator;
        const vaultKey = this.memoryGovernanceOpaqueVaultKey;
        const isCurrent = () => !this.unloading && this.canRunMemoryExtractionRuntime()
            && this.memoryAdmissionCoordinator === coordinator
            && this.memoryGovernanceOpaqueVaultKey === vaultKey
            && Boolean(this.getGovernedMemoryProjectionSnapshot())
            && batch.isCurrent?.() !== false && !batch.signal?.aborted;
        if (!isCurrent()) return { status: "retry" };
        if (!coordinator || !vaultKey || !batch.baseline || !this.getGovernedMemoryProjectionSnapshot()) {
            return { status: "retry" };
        }
        return this.serializeGovernedMemoryLifecycle(async () => {
            if (!isCurrent()) return { status: "retry" };
            const currentById = new Map(
                (batch.current?.records ?? [])
                    .filter((record) => Boolean(record.profileRecordId))
                    .map((record) => [record.profileRecordId!, record]),
            );
            const changed = batch.proposed.records.filter((record) => {
                const current = record.profileRecordId
                    ? currentById.get(record.profileRecordId)
                    : undefined;
                return !current || JSON.stringify(current) !== JSON.stringify(record);
            });
            let stateChanged = false;
            let shouldRetry = false;
            const retryWithCommittedProjection = (): TypeAAdmissionResult => {
                // This resumes only durable outbox entries, never the expired batch.
                if (stateChanged) this.scheduleMemoryProfileProjectionRetry();
                return { status: "retry" };
            };
            for (const record of changed) {
                if (!isCurrent()) return retryWithCommittedProjection();
                if (record.chatSemanticReceipt !== undefined || batch.semanticProjections !== undefined) {
                    if (!batch.isCurrent || !batch.semanticProjections || !verifyChatMemorySemanticReceipt(
                        record.chatSemanticReceipt, record, batch.evidence.conversationId, batch.semanticProjections,
                    )) return retryWithCommittedProjection();
                } else if (!isChatMemoryRecordAdmissible(record, batch.evidence)) continue;
                const admission = this.buildGovernedTypeAAdmission(
                    vaultKey,
                    record,
                    batch.baseline!,
                    batch.evidence,
                    batch.semanticProjections,
                );
                if (!admission) {
                    this.log("Type-A governed admission skipped", {
                        code: "invalid_exact_profile_evidence",
                    });
                    continue;
                }
                const result = await coordinator.admit(admission, { isCurrent, signal: batch.signal });
                if (!result.ok) {
                    this.log("Type-A governed admission failed", { reason: result.reason });
                    if (![
                        "stale_type_a_batch",
                        "user_authority_preserved",
                        "claim_not_admissible",
                    ].includes(result.reason)) {
                        shouldRetry = true;
                    }
                    continue;
                }
                if (result.value.decision === "silent_durable"
                    || result.value.decision === "require_prior_review") {
                    stateChanged = true;
                }
            }
            if (shouldRetry || !isCurrent()) return retryWithCommittedProjection();

            if (stateChanged) {
                const projection = await this.memoryProfileProjectionWorker?.resumePending();
                if (projection && projection.pending.length > 0) {
                    this.log("Type-A Profile projection remains pending after admission", {
                        count: projection.pending.length,
                    });
                    await this.refreshGovernedMemoryActionState();
                    await this.notifySettingsChanged();
                    return retryWithCommittedProjection();
                }
                await this.refreshGovernedMemoryActionState();
                await this.notifySettingsChanged();
            }
            if (!isCurrent()) return { status: "retry" };
            await this.persistGovernedTypeAProcessedTurn(vaultKey, batch.evidence, { isCurrent, signal: batch.signal });
            return { status: "processed" };
        });
    }

    private buildGovernedTypeAAdmission(
        vaultKey: string,
        record: UserProfileRecord,
        baseline: TypeAAdmissionBaseline,
        evidence: TypeAAdmissionBatch["evidence"],
        semanticProjections?: TypeAAdmissionBatch["semanticProjections"],
    ): GovernedMemoryAdmissionInput | null {
        const semanticReceipt = record.chatSemanticReceipt === undefined ? undefined
            : verifyChatMemorySemanticReceipt(record.chatSemanticReceipt, record, evidence.conversationId,
                semanticProjections ?? []) ? record.chatSemanticReceipt : undefined;
        if ((record.chatSemanticReceipt !== undefined || semanticProjections !== undefined) && !semanticReceipt) return null;
        const profileRecordId = record.profileRecordId?.trim();
        const conversationIds = semanticReceipt ? [evidence.conversationId] : [...new Set([
            record.conversationId,
            ...(record.conversationIds ?? []),
        ].map((id) => id?.trim()).filter((id): id is string => Boolean(id)))].sort();
        if (!profileRecordId || conversationIds.length === 0 || !record.text.trim()) return null;

        const classification = classifyLegacyTypeAAdoption({
            opaqueVaultKey: vaultKey,
            record,
        });
        const authority = !semanticReceipt && classification.status === "adopt"
            ? classification.authority
            : record.kind === "user_correction"
                ? "user_correction" as const
                : record.kind === "user_explicit"
                    ? "explicit_user" as const
                    : "pa_inference" as const;
        const sensitivity: MemorySensitivity = classification.status === "adopt"
            ? "low"
            : classification.reason === "unknown_sensitivity" ? "high" : "medium";
        const provenance: PersistedMemoryProvenance[] = !semanticReceipt && classification.status === "adopt"
            ? classification.provenance.map((entry) => cloneSerializable(entry))
            : [{
                kind: "conversation",
                conversationIds,
                observedAt: record.observedAt,
            }];
        const sourceFingerprintId = semanticReceipt ? chatMemorySemanticSourceFingerprint(semanticReceipt) : `memory-source-${stableHash(JSON.stringify([
            "type-a-source-v1",
            profileRecordId,
            conversationIds,
            evidence.conversationId,
            evidence.throughTurnIndex,
        ]))}`;
        const ruleFingerprint = semanticReceipt ? CHAT_MEMORY_SEMANTIC_RULE : "type-a-effect-admission-v1";
        const memoryType = "preference" as const;
        const effect = "future_answers" as const;
        return {
            policy: {
                origin: "type_a",
                memoryType,
                authority,
                persistenceIntent: "durable",
                effect,
                provenanceValidity: Number.isFinite(Date.parse(record.observedAt)) ? "valid" : "invalid",
                sourceBacking: conversationIds.length > 0 ? "source_backed" : "unbacked",
                sensitivity,
                scope: "current_vault",
                conflict: "absent",
                durableTaskConstraint: "absent",
                dataBoundary: "allowed",
                writeAuthority: "none",
                networkAuthority: "none",
                externalActionAuthority: "none",
                policyCompliance: "allowed",
                ephemeralContextEligibility: "eligible",
            },
            summary: record.text,
            memoryType,
            sensitivity,
            authority,
            effect,
            applicability: { kind: "whole_vault" },
            provenance,
            sourceFingerprintId,
            ruleFingerprint,
            ...(semanticReceipt ? { chatSemanticReceipt: semanticReceipt,
                profileKey: record.key,
                chatSemanticEvidence: { conversationId: evidence.conversationId,
                    candidate: { text: record.text, meaning: record.meaning, kind: record.kind, confidence: record.confidence },
                    projections: semanticProjections! } } : {}),
            admissionKey: `type-a:${profileRecordId}`,
            profileRecordId,
            expectedTargetState: baseline.targets[profileRecordId] ?? {
                state: "absent",
                profileRecordId,
            },
            queueInput: {
                type: "memory_candidate",
                title: pageletT("pagelet.tab.memory.typeAReviewTitle", this.getPageletLocale()),
                claim: record.text,
                scope: { kind: "whole_vault" },
                sourceRefs: [],
                originSurface: "memory",
                priority: sensitivity === "high" ? "high" : "normal",
                whyShown: [pageletT("pagelet.tab.memory.typeAReviewReason", this.getPageletLocale())],
                dataBoundarySnapshotId: this.getMemoryDataBoundaryFingerprint(),
                admissionReason: "memory_confirmation_required",
                replayRef: conversationIds[0],
                metadata: {
                    memoryType,
                    sensitivity,
                    memorySource: "interactions",
                    memoryScope: "current_vault",
                    memoryEffect: effect,
                    evidenceKind: record.kind,
                    confidence: record.confidence,
                    occurrences: record.occurrences,
                    profileRecordId,
                    throughTurnIndex: evidence.throughTurnIndex,
                },
            },
        };
    }

    private captureGovernedTypeAAdmissionBaseline(): Promise<TypeAAdmissionBaseline> {
        return this.serializeGovernedMemoryLifecycle(async () => {
            const repository = this.deviceMemoryGovernanceRepository;
            const vaultKey = this.memoryGovernanceOpaqueVaultKey;
            if (!repository || !vaultKey || !this.getGovernedMemoryProjectionSnapshot()) {
                throw new Error("Governed Type-A baseline is unavailable.");
            }
            const state = await repository.initialize();
            const currentVaultClaimIds = new Set(state.claims.flatMap((claim) => (
                claim.partition.kind === "vault" && claim.partition.key === vaultKey
                    ? [claim.id]
                    : []
            )));
            const profileRecordIds = new Set(state.projectionLinks.flatMap((link) => (
                currentVaultClaimIds.has(link.claimId) && link.target.kind === "type_a_profile"
                    ? [link.target.profileRecordId]
                    : []
            )));
            const partition = { kind: "vault" as const, key: vaultKey };
            const profileRecordIdsByKey: Record<string, string> = Object.create(null);
            const addIdentity = (key: string | undefined, id: string | undefined) => {
                if (!key || !id) return;
                if (profileRecordIdsByKey[key] && profileRecordIdsByKey[key] !== id) {
                    throw new Error("Governed Profile key has conflicting target identities.");
                }
                profileRecordIdsByKey[key] = id;
            };
            for (const link of state.projectionLinks) {
                if (currentVaultClaimIds.has(link.claimId) && link.target.kind === "type_a_profile"
                    && link.target.store === "governed") addIdentity(link.target.profileKey, link.target.profileRecordId);
            }
            for (const item of state.memoryQueueItems) {
                if (item.partition.kind === "vault" && item.partition.key === vaultKey
                    && item.governanceAdmission?.chatSemanticReceipt) {
                    addIdentity(item.governanceAdmission.profileKey, item.governanceAdmission.profileRecordId);
                }
            }
            // Reuse an existing legacy target only when its exact current projection still
            // matches canonical governance; a downgraded client cannot redefine that mapping.
            const legacyTargets = state.projectionLinks.filter((link) => currentVaultClaimIds.has(link.claimId)
                && link.state === "active" && link.target.kind === "type_a_profile" && link.target.store === undefined);
            if (legacyTargets.length > 0) {
                const legacy = await this.createExistingUserProfileReader().read();
                if (legacy.state === "ready") {
                    for (const link of legacyTargets) {
                        if (link.target.kind !== "type_a_profile") continue;
                        const id = link.target.profileRecordId;
                        const row = legacy.snapshot?.records.find((candidate) => candidate.profileRecordId === id);
                        const claim = state.claims.find((candidate) => candidate.id === link.claimId);
                        const revision = state.revisions.find((candidate) => candidate.claimId === claim?.id
                            && candidate.id === claim?.activeRevisionId);
                        if (row && revision && row.text.trim() === revision.summary.trim()) {
                            addIdentity(deriveSemanticProfileKey(row.text), id);
                        }
                    }
                }
            }
            return {
                version: 1,
                capturedCommitSequence: state.commitSequence,
                profileRecordIdsByKey,
                targets: Object.fromEntries([...profileRecordIds]
                    .sort()
                    .map((profileRecordId) => [
                        profileRecordId,
                        readTypeATargetGeneration(state, profileRecordId, partition),
                    ])),
            };
        });
    }

    private async getGovernedTypeAProcessedTurn(conversationId: string): Promise<number | undefined> {
        const repository = this.deviceMemoryGovernanceRepository;
        const vaultKey = this.memoryGovernanceOpaqueVaultKey;
        if (!repository || !vaultKey) return undefined;
        const state = await repository.initialize();
        return state.policyStates[vaultKey]?.typeAProcessedTurns?.[
            this.typeAConversationCursorKey(conversationId)
        ];
    }

    private async persistGovernedTypeAProcessedTurn(
        vaultKey: string,
        evidence: TypeAAdmissionBatch["evidence"],
        lifetime: { isCurrent: () => boolean; signal?: AbortSignal },
    ): Promise<void> {
        const repository = this.deviceMemoryGovernanceRepository;
        if (!repository) throw new Error("Governed Type-A repository is unavailable.");
        const key = this.typeAConversationCursorKey(evidence.conversationId);
        const assertCurrent = Object.assign(() => {
            if (!lifetime.isCurrent() || lifetime.signal?.aborted) throw new Error("Type-A producer is no longer current.");
        }, { signal: lifetime.signal });
        await repository.transact((draft) => {
            assertCurrent();
            const policy = draft.policyStates[vaultKey];
            if (!policy || policy.mode !== "effect_based" || policy.contextProjectionMode !== "governed") {
                throw new Error("Governed Type-A policy is unavailable.");
            }
            const previous = policy.typeAProcessedTurns?.[key] ?? -1;
            policy.typeAProcessedTurns = {
                ...(policy.typeAProcessedTurns ?? {}),
                [key]: Math.max(previous, evidence.throughTurnIndex),
            };
        }, assertCurrent);
    }

    private typeAConversationCursorKey(conversationId: string): string {
        return `conversation-${stableHash(`type-a-cursor-v1\u0000${conversationId}`)}`;
    }

    private destroyPageletRuntime(): void {
        this.pageletIntegration.disableFeature();
        this.reviewQueueStore = null;
        this.savedInsightStore = null;
        this.memoryGovernanceStore = null;
        this.retrievalHabitProfileStore = null;
    }

    private pageletCommandCallbacks(): PageletCommandCallbacks {
        const dispatch = <T>(run: (callbacks: PageletCommandCallbacks) => T): T | undefined => {
            if (!this.settings.pagelet?.enabled) {
                new Notice(pageletT("pagelet.notice.disabled", this.getPageletLocale()), 4000);
                return undefined;
            }
            this.syncPageletRuntime();
            const callbacks = this.pageletIntegration.currentOrchestrator?.getCommandCallbacks();
            if (!callbacks) return undefined;
            return run(callbacks);
        };
        return {
            onOpenPanel: () => dispatch((callbacks) => callbacks.onOpenPanel()),
            onOpenPreparedReview: () => dispatch((callbacks) => callbacks.onOpenPreparedReview()),
            onReviewCurrent: () => dispatch((callbacks) => callbacks.onReviewCurrent()),
            onQuickReview: () => dispatch((callbacks) => callbacks.onQuickReview()),
            onDiscoverConnections: () => dispatch((callbacks) => callbacks.onDiscoverConnections()),
            onMaintenanceReview: () => dispatch((callbacks) => callbacks.onMaintenanceReview()),
            onQuietRecall: () => dispatch((callbacks) => callbacks.onQuietRecall()),
            onGraphDiscovery: () => dispatch((callbacks) => callbacks.onGraphDiscovery()),
            onScopeRecap: () => dispatch((callbacks) => callbacks.onScopeRecap()),
            onClearScopeRecapCache: () => dispatch((callbacks) => callbacks.onClearScopeRecapCache()),
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

    private createPageletFeatureScope(): Component {
        const scope = new Component();
        this.addChild(scope);
        this.pageletFeatureScope = scope;
        return scope;
    }

    private releasePageletFeatureScope(expectedScope?: Component | null): void {
        if (expectedScope === null) return;
        const scope = expectedScope ?? this.pageletFeatureScope;
        if (!scope) return;
        if (this.pageletFeatureScope === scope) this.pageletFeatureScope = null;
        this.removeChild(scope);
    }

    private isPageletFeatureScopeCurrent(scope: object): boolean {
        return !this.unloading && this.pageletFeatureScope === scope;
    }

    private createPageletHost(featureScope: Component): PageletHost {
        const getPageletSettings = () => this.getPageletSettingsWithDataBoundary();
        const getContextPagerSettings = () => this.settings.contextPager;
        const getQuietRecallSettings = () => this.settings.quietRecall;
        const getFocusMode = () => this.settings.focusMode;
        const getConfirmedMemoryCount = () => this.getCurrentConfirmedMemoryCount();
        return {
            app: this.app,
            settings: {
                get pagelet() {
                    return getPageletSettings();
                },
                get contextPager() {
                    return {
                        enabled: getContextPagerSettings().enabled,
                    };
                },
                get quietRecall() {
                    return getQuietRecallSettings();
                },
                get focusMode() {
                    return getFocusMode();
                },
                get confirmedMemoryCount() {
                    return getConfirmedMemoryCount();
                },
            },
            log: (...args: unknown[]) => this.log(args[0] as string, ...args.slice(1)),
            pageletFeatureScope: featureScope,
            isFeatureScopeCurrent: (scope: object) => this.isPageletFeatureScopeCurrent(scope),
            registerEvent: (ref) => featureScope.registerEvent(ref),
            saveSettings: () => this.saveSettings(),
            createPageletAttentionStorage: () => this.createPageletAttentionStorage(),
            runDeepDiscover: (input) => this.runPageletDeepDiscover(input),
            getDeepDiscoverFunctionCallingCapability: () => (
                this.getPageletDeepDiscoverFunctionCallingCapability()
            ),
            acknowledgeDeepDiscoverResult: (result, acceptedCandidates) => {
                this.deepDiscoverIntegration.acknowledgeOrchestratorResult(
                    result,
                    acceptedCandidates,
                );
            },
            discardDeepDiscoverResult: (result) => {
                this.deepDiscoverIntegration.discardOrchestratorResult(result);
            },
            cancelDeepDiscover: () => this.resetDeepDiscoverController(),
            getDeepDiscoverUsage: () => this.getDeepDiscoverUsage(),
            getDeepDiscoverPolicyIdentity: () => this.pageletDeepDiscoverPolicyIdentityKey(),
            isDeepDiscoverCommitSealCurrent: (seal, collection) => (
                this.isPageletDeepDiscoverCommitSealCurrent(seal, collection)
            ),
            validateDeepDiscoverInsight: async (identity, signal) => {
                return await this.deepDiscoverIntegration.validateInsight(identity, signal);
            },
            isOperationsAvailable: () => this.isOperationsAgentEnabled,
            stagePageletInsightLink: (input, signal) => (
                this.stagePageletInsightLink(input, signal)
            ),
            confirmPageletOperationsIntent: (intentId) => (
                this.confirmPageletOperationsIntent(intentId)
            ),
            cancelPageletOperationsIntent: (intentId) => {
                this.cancelPageletOperationsIntent(intentId);
            },
            undoPageletOperationsReceipts: (receiptIds) => (
                this.undoPageletOperationsReceipts(receiptIds)
            ),
            consumePageletOperationsSelfWrite: (path) => (
                this.consumePageletOperationsSelfWrite(path)
            ),
            openPageletChatHandoff: async (context, signal) => {
                if (signal?.aborted) return { status: "unavailable" };
                const view = await this.activeChatView();
                if (signal?.aborted) return { status: "unavailable" };
                return view
                    ? await view.preparePageletHandoff(context, signal)
                    : { status: "unavailable" };
            },
            openQuickCapture: () => this.openQuickCaptureModal(),
            createForegroundAnalyzeCallback: () => this.retainedReviewIntegration.createAnalyzeCallback(),
            updatePageletSetting: <K extends keyof PageletSettings>(key: K, value: PageletSettings[K]) => {
                this.settings.pagelet[key] = value;
                void this.saveSettings();
            },
            prepareMemoryForPagelet: () => this.memoryManager?.prepareFromCommand() ?? Promise.resolve(),
            getMemoryPreparationStatus: () => this.memoryManager?.getActivePreparationStatus() ?? null,
            isPathAllowedForPagelet: (path) => this.isPageletProviderPathAllowed(path),
            openPageletSettings: () => {
                openSettings(this.app);
                openSettingsTab(this.app, 'personal-assistant');
            },
            refreshPageletSettings: () => {
                this.settingTab.refreshPageletSettingsIfVisible();
            },
            writeReviewNote: (note: GeneratedReviewNote) => this.writePageletReviewNote(note),
            openPageletDetailView: (payload: PageletDetailPayload) => this.openPageletDetailView(payload),
            clearScopeRecapDetailSessionCache: () => clearScopeRecapPageletDetailSessionCache(),
            findRelatedNotes: (primarySourcePath, noteContents, sourcePaths) =>
                this.findPageletRelatedNotes(
                    primarySourcePath,
                    noteContents,
                    sourcePaths,
                    { limit: PAGELET_DISCOVERY_MAX_RELATED_NOTES },
                ),
            isMemoryReadyForPageletDiscovery: () =>
                this.isPageletMemorySearchReady(),
            discoverConnections: async (currentNote, relatedNotes) =>
                this.runDiscoveryAnalysis(currentNote, relatedNotes),
            listReviewQueueItems: (filter) => this.listReviewQueueItems(filter),
            createReviewQueueItem: (input) => this.createReviewQueueItem(input),
            dismissReviewQueueItem: (id) => this.dismissReviewQueueItem(id),
            runMaintenanceReview: (options) => this.runMaintenanceReview(options),
            runGraphDiscovery: (options) => this.runGraphDiscovery(options),
            detectCrossNotePatterns: () => this.detectCrossNotePatternsForPagelet(),
            buildScopeRecapLocalOverview: () => this.buildScopeRecapLocalOverview(),
            isScopeRecapProviderConfigured: () => this.getAISetupIssue() === null,
            getScopeRecapProviderInfo: () => this.getScopeRecapProviderInfo(),
            getScopeRecapAuthorizationContextId: () => this.getScopeRecapAuthorizationContextId(),
            getPageletFeatureRateLimitStatus: () => this.getPageletFeatureRateLimitStatus(),
            getScopeRecapDataBoundarySnapshotId: () => this.getMemoryDataBoundaryFingerprint(),
            runScopeRecap: (options) => this.runScopeRecap(options),
            runQuietRecall: () => this.runQuietRecall(),
            isQuietRecallRunCurrent: (result) => this.isQuietRecallRunCurrent(result),
            getQuietRecallEvaluationPolicySnapshotId: () => this.getQuietRecallEvaluationPolicyIdentity(),
            saveQuietRecallAsInsight: (candidate) => this.saveQuietRecallAsInsight(candidate),
            linkRecallCandidate: (currentPath, candidatePath) => this.linkRecallCandidate(currentPath, candidatePath),
            recordQuietRecallFeedback: (candidate, feedback) =>
                this.recordQuietRecallFeedback(candidate, feedback),
            listSavedInsights: () => this.listSavedInsights(),
            listConfirmedMemories: () => this.listConfirmedMemories(),
            getMemoryGovernancePanelState: () => this.getMemoryGovernancePanelState(),
        };
    }

    private getReviewQueueStore(): ReviewQueueStore {
        if (!this.reviewQueueStore) {
            this.reviewQueueStore = new ReviewQueueStore({
                repository: this.reviewQueueRepository ?? this.getOrCreateSettingsReviewQueueRepository(),
            });
        }
        return this.reviewQueueStore;
    }

    private listReviewQueueItems(filter: ReviewQueueListFilter = {}): ReviewQueueItem[] {
        if (!this.settings.reviewQueue.enabled) return [];
        return this.getReviewQueueStore().list(filter);
    }

    private getReviewQueueItemById(id: string): ReviewQueueItem | null {
        if (!this.settings.reviewQueue.enabled) return null;
        return this.getReviewQueueStore().list().find((item) => item.id === id) ?? null;
    }

    private async createReviewQueueItem(input: ReviewQueueCreateInput): Promise<ReviewQueueResult<ReviewQueueItem>> {
        if (!this.settings.reviewQueue.enabled) {
            return { ok: false, reason: "disabled" };
        }
        if (input.type === "memory_candidate"
            && this.memoryAdmissionCoordinator
            && this.getGovernedMemoryProjectionSnapshot()) {
            return this.admitGovernedMemoryQueueInput(input);
        }
        const result = await this.getReviewQueueStore().create(input);
        if (!result.ok || result.value.type !== "memory_candidate" || !this.shouldAutoConfirmMemoryCandidates()) {
            return result;
        }
        const autoConfirmed = await this.autoConfirmMemoryCandidateFromQueueItem(result.value);
        if (!autoConfirmed) return result;
        return {
            ok: true,
            value: this.getReviewQueueItemById(result.value.id) ?? result.value,
        };
    }

    private admitGovernedMemoryQueueInput(
        input: ReviewQueueCreateInput,
    ): Promise<ReviewQueueResult<ReviewQueueItem>> {
        return this.serializeGovernedMemoryLifecycle(async () => {
            const coordinator = this.memoryAdmissionCoordinator;
            if (!coordinator) return { ok: false, reason: "admission_unavailable" };
            const admission = this.buildGovernedMemoryQueueAdmission(input);
            if (!admission.ok) return admission;
            const result = await coordinator.admit(admission.value);
            if (!result.ok) {
                this.log("Governed Memory candidate admission failed", { reason: result.reason });
                return { ok: false, reason: result.reason };
            }
            if (result.value.decision === "reject") return { ok: false, reason: "admission_rejected" };
            if (result.value.decision === "ephemeral_only") return { ok: false, reason: "ephemeral_only" };
            if (!result.value.queueItem) return { ok: false, reason: "queue_item_missing" };
            await this.refreshGovernedMemoryActionState();
            await this.notifySettingsChanged();
            return { ok: true, value: cloneSerializable(result.value.queueItem) };
        });
    }

    private buildGovernedMemoryQueueAdmission(
        input: ReviewQueueCreateInput,
    ): ReviewQueueResult<GovernedMemoryAdmissionInput> {
        const memoryTypeValue = input.metadata?.memoryType;
        const sensitivityValue = input.metadata?.sensitivity;
        if (!includesString(MEMORY_TYPES, memoryTypeValue)) {
            return { ok: false, reason: "missing_memory_type" };
        }
        if (!includesString(MEMORY_SENSITIVITIES, sensitivityValue)) {
            return { ok: false, reason: "missing_sensitivity" };
        }
        const memoryType: MemoryType = memoryTypeValue;
        const sensitivity: MemorySensitivity = sensitivityValue;
        const effect = memoryType === "preference" || memoryType === "project_context"
            ? "future_answers" as const
            : "stored_not_in_use" as const;
        const provenance: PersistedMemoryProvenance[] = input.sourceRefs.map((sourceRef) => ({
            kind: "note" as const,
            sourceRef: cloneSerializable(sourceRef),
        }));
        const sourceFingerprintId = this.buildMemoryCandidateSourceFingerprint(input);
        const ruleFingerprint = `memory-candidate-effect-admission-v1:${memoryType}`;
        const dataBoundaryAllowed = input.sourceRefs.length > 0
            && input.sourceRefs.every((sourceRef) => this.isDataBoundaryAllowedPath(sourceRef.path));
        const authority = "pa_inference" as const;
        const admissionKey = [
            input.originSurface,
            sourceFingerprintId,
            ruleFingerprint,
        ].join(":");
        const queueInput = cloneSerializable(input);
        queueInput.metadata = {
            ...(queueInput.metadata ?? {}),
            memorySource: input.sourceRefs.length > 0 ? "notes" : "unknown",
            memoryScope: "current_vault",
            memoryEffect: effect,
        };
        return {
            ok: true,
            value: {
                policy: {
                    origin: "memory_candidate",
                    memoryType,
                    authority,
                    // The Memory master switch removes permission for quiet
                    // durability without turning an intentional candidate into
                    // routine review debt. It remains available for explicit
                    // confirmation on the existing review surface.
                    persistenceIntent: this.settings.memoryEnabled === true
                        ? "durable"
                        : "unknown",
                    effect,
                    provenanceValidity: provenance.length > 0 ? "valid" : "invalid",
                    sourceBacking: provenance.length > 0 ? "source_backed" : "unbacked",
                    sensitivity,
                    scope: "current_vault",
                    conflict: "absent",
                    durableTaskConstraint: memoryType === "task_constraint" ? "present" : "absent",
                    dataBoundary: dataBoundaryAllowed ? "allowed" : "denied",
                    writeAuthority: "none",
                    networkAuthority: "none",
                    externalActionAuthority: "none",
                    policyCompliance: "allowed",
                    ephemeralContextEligibility: "eligible",
                },
                summary: input.claim,
                memoryType,
                sensitivity,
                authority,
                effect,
                applicability: cloneSerializable(input.scope),
                provenance,
                sourceFingerprintId,
                ruleFingerprint,
                admissionKey,
                queueInput,
            },
        };
    }

    private buildMemoryCandidateSourceFingerprint(input: ReviewQueueCreateInput): string {
        const producerEvidence = {
            sourceRefs: input.sourceRefs.map((sourceRef) => ({
                path: normalizePath(sourceRef.path).replace(/^\.\//, ""),
                sourceId: sourceRef.sourceId ?? null,
                excerptHash: sourceRef.excerptHash ?? null,
                heading: sourceRef.heading ?? null,
                blockId: sourceRef.blockId ?? null,
            })),
            replayRef: input.replayRef ?? null,
            dataBoundarySnapshotId: input.dataBoundarySnapshotId,
            captureId: input.metadata?.captureId ?? null,
            suggestionType: input.metadata?.suggestionType ?? null,
        };
        return `memory-source-${stableHash(JSON.stringify(producerEvidence))}`;
    }

    private dismissReviewQueueItem(id: string): Promise<ReviewQueueResult<ReviewQueueItem>> {
        if (!this.settings.reviewQueue.enabled) {
            return Promise.resolve({ ok: false, reason: "disabled" });
        }
        return this.getReviewQueueStore().dismiss(id);
    }

    private updateReviewQueueItemStatus(id: string, status: ReviewQueueStatus): Promise<ReviewQueueResult<ReviewQueueItem>> {
        if (!this.settings.reviewQueue.enabled) {
            return Promise.resolve({ ok: false, reason: "disabled" });
        }
        return this.getReviewQueueStore().updateStatus(id, status);
    }

    private async runMaintenanceReview(options: Parameters<PageletActionPluginIntegration["runMaintenanceReview"]>[0]): Promise<MaintenanceReviewRunResult> {
        return this.pageletActionIntegration.runMaintenanceReview(options);
    }

    private collectMaintenanceReviewFiles(options: {
        scopePaths?: readonly string[];
        maxFiles?: number;
        includeWholeVault?: boolean;
    } = {}): TFile[] {
        const allFiles = this.app.vault.getMarkdownFiles();
        const maxFiles = Math.max(1, options.maxFiles ?? 50);
        const scopePaths = options.scopePaths
            ? new Set(options.scopePaths.map((path) => normalizePath(path)))
            : null;
        if (scopePaths) {
            return allFiles
                .filter((file) => scopePaths.has(normalizePath(file.path)))
                .slice(0, maxFiles);
        }
        if (options.includeWholeVault) {
            return allFiles.slice(0, maxFiles);
        }

        const activeFile = this.app.workspace.getActiveFile();
        const activeFolder = activeFile instanceof TFile && activeFile.extension === "md"
            ? this.parentFolderPath(activeFile.path)
            : "";
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        return allFiles
            .filter((file) => {
                if (activeFile instanceof TFile && file.path === activeFile.path) return true;
                if (activeFolder && this.parentFolderPath(file.path) === activeFolder) return true;
                return typeof file.stat?.mtime === "number" && file.stat.mtime >= sevenDaysAgo;
            })
            .sort((left, right) => (right.stat?.mtime ?? 0) - (left.stat?.mtime ?? 0))
            .slice(0, maxFiles);
    }

    private parentFolderPath(path: string): string {
        const normalized = normalizePath(path);
        const slash = normalized.lastIndexOf("/");
        return slash > 0 ? normalized.slice(0, slash) : "";
    }

    private async runGraphDiscovery(options: { enqueueItems?: boolean } = {}): Promise<GraphDiscoveryRunResult> {
        const notes = await this.collectGraphDiscoveryNotes();
        const activeFile = this.app.workspace.getActiveFile();
        const scopePaths = activeFile instanceof TFile && activeFile.extension === "md"
            ? [activeFile.path]
            : notes.slice(0, 1).map((note) => note.path);
        const result = discoverLightweightGraphItems(notes, {
            now: new Date(),
            isPathAllowed: (path) => this.isDataBoundaryAllowedPath(path),
            scope: {
                kind: scopePaths.length === 1 ? "current_note" : "selected_notes",
                paths: scopePaths,
            },
            dataBoundarySnapshotId: "data_boundary:graph_discovery",
        });

        if (options.enqueueItems === true) {
            for (const item of result.items) {
                const queueResult = await this.createReviewQueueItem(graphDiscoveryItemToReviewQueueInput(item, {
                    dataBoundarySnapshotId: "data_boundary:graph_discovery",
                    admissionReason: item.type === "conflict_pair"
                        ? "conflict_resolution_required"
                        : "user_kept_for_later",
                }));
                if (!queueResult.ok) {
                    this.log("Failed to enqueue graph discovery item", {
                        id: item.id,
                        type: item.type,
                        reason: queueResult.reason,
                    });
                }
            }
        }
        return result;
    }

    private async buildScopeRecapLocalOverview(): Promise<ScopeRecapLocalOverview> {
        return this.scopeRecapIntegration.buildScopeRecapLocalOverview();
    }

    private async runScopeRecap(
        options: Parameters<ScopeRecapPluginIntegration["runScopeRecap"]>[0],
    ): Promise<ScopeRecapPreparationResult> {
        return this.scopeRecapIntegration.runScopeRecap(options);
    }

    private getScopeRecapProviderInfo(): { provider: string; model: string; endpoint: string } {
        return this.scopeRecapIntegration.getScopeRecapProviderInfo();
    }

    private scopeRecapEndpointIdentity(): string {
        return this.scopeRecapIntegration.scopeRecapEndpointIdentity();
    }

    private scopeRecapEndpointDisplay(): string {
        return this.scopeRecapIntegration.scopeRecapEndpointDisplay();
    }

    private getScopeRecapAuthorizationContextId(): string {
        return this.scopeRecapIntegration.getScopeRecapAuthorizationContextId();
    }

    private scopeRecapBuildOptions(
        notes: readonly ScopeRecapSourceNote[],
        options: { includeRecentChanges?: boolean } = {},
    ) {
        return this.scopeRecapIntegration.scopeRecapBuildOptions(notes, options);
    }

    private async collectScopeRecapSourceNotes(
        options: { includeContent: boolean } = { includeContent: true },
    ): Promise<ScopeRecapSourceNote[]> {
        return this.scopeRecapIntegration.collectScopeRecapSourceNotes(options);
    }

    private createPageletProviderSourceResolver(): ScopeResolver {
        return this.sourceAccess.createPageletProviderSourceResolver();
    }

    private isPageletProviderSourceAllowedByResolver(file: TFile, resolver: ScopeResolver): boolean {
        return this.sourceAccess.isPageletProviderSourceAllowedByResolver(file, resolver);
    }

    private async collectGraphDiscoveryNotes(): Promise<GraphDiscoveryNote[]> {
        const activeFile = this.app.workspace.getActiveFile();
        if (!(activeFile instanceof TFile) || activeFile.extension !== "md") return [];
        const activeFolder = parentFolder(activeFile.path);
        const files = this.app.vault.getMarkdownFiles()
            .filter((file) => parentFolder(file.path) === activeFolder)
            .filter((file) => this.isDataBoundaryAllowedFile(file))
            .sort((left, right) => {
                if (left.path === activeFile.path) return -1;
                if (right.path === activeFile.path) return 1;
                return right.stat.mtime - left.stat.mtime;
            })
            .slice(0, 40);
        const backlinkMap = this.buildGraphDiscoveryBacklinkMap();
        const notes: GraphDiscoveryNote[] = [];
        for (const file of files) {
            try {
                const content = await this.app.vault.cachedRead(file);
                notes.push({
                    path: file.path,
                    title: file.basename,
                    content,
                    tags: this.getDataBoundaryTags(file),
                    links: this.getGraphDiscoveryLinks(file),
                    backlinks: backlinkMap.get(normalizePath(file.path)) ?? [],
                    aliases: this.getGraphDiscoveryAliases(file),
                    folder: parentFolder(file.path),
                    modifiedAt: new Date(file.stat.mtime).toISOString(),
                });
            } catch (error) {
                this.log("Failed to read note for graph discovery", { path: file.path, error });
            }
        }
        return notes;
    }

    private async maybeRunPatternDetectionNudge(): Promise<void> {
        if (this.unloading || !this.pageletIntegration.currentOrchestrator) return;
        const pageletSettings = this.settings.pagelet;
        if (!pageletSettings?.enabled || !pageletSettings.proactiveHints || this.settings.focusMode) return;

        const now = new Date();
        const lastDetectionAt = Date.parse(this.settings.lastPatternDetectionAt ?? "");
        if (Number.isFinite(lastDetectionAt) && now.getTime() - lastDetectionAt < PATTERN_DETECTION_INTERVAL_MS) {
            return;
        }

        const result = await this.detectCrossNotePatternsForPagelet(now);
        if (this.unloading || !this.pageletIntegration.currentOrchestrator || !result) return;

        this.settings.lastPatternDetectionAt = now.toISOString();
        await this.saveSettings();
        if (result.totalCount > 0) {
            this.pageletIntegration.currentOrchestrator?.setPatternDetectionNudge(result);
        }
    }

    private async maybeShowMaintenanceScanOnboardingNudge(): Promise<void> {
        if (this.unloading || !this.pageletIntegration.currentOrchestrator) return;
        const pageletSettings = this.settings.pagelet;
        if (!pageletSettings?.enabled || !pageletSettings.proactiveHints || this.settings.focusMode) return;
        if (pageletSettings.maintenanceScanSuggested) return;
        if (this.app.vault.getMarkdownFiles().length <= PAGELET_MAINTENANCE_ONBOARDING_MIN_NOTES) return;

        this.pageletIntegration.currentOrchestrator.setOnboardingNudge("maintenance_scan");
    }

    private async maybeShowQuickCaptureOnboardingNudge(): Promise<void> {
        if (this.unloading) return;
        const pageletSettings = this.settings.pagelet;
        if (!pageletSettings?.enabled || !pageletSettings.proactiveHints || this.settings.focusMode) return;
        if (pageletSettings.quickCaptureExplained) return;
        this.syncPageletRuntime();
        if (!this.pageletIntegration.currentOrchestrator) return;

        this.pageletIntegration.currentOrchestrator.setOnboardingNudge("quick_capture");
    }

    private async detectCrossNotePatternsForPagelet(now = new Date()): Promise<PatternDetectionResult | null> {
        const notes = await this.collectPatternDetectionNotes(now);
        if (notes.length < PATTERN_DETECTION_MIN_ACTIVE_NOTES) return null;
        return detectCrossNotePatterns(notes, {
            now,
            minActiveNotes: PATTERN_DETECTION_MIN_ACTIVE_NOTES,
        });
    }

    private async collectPatternDetectionNotes(now: Date): Promise<PatternDetectionInput[]> {
        const cutoff = now.getTime() - PATTERN_DETECTION_RECENT_WINDOW_MS;
        const files = this.app.vault.getMarkdownFiles()
            .filter((file) => file.stat.mtime >= cutoff)
            .filter((file) => this.isDataBoundaryAllowedFile(file))
            .sort((left, right) => right.stat.mtime - left.stat.mtime)
            .slice(0, PATTERN_DETECTION_MAX_SOURCE_NOTES);
        const backlinkMap = this.buildGraphDiscoveryBacklinkMap();
        const notes: PatternDetectionInput[] = [];
        for (const file of files) {
            try {
                const content = await this.app.vault.cachedRead(file);
                const resolvedLinks = this.getResolvedOutgoingLinks(file.path);
                notes.push({
                    path: file.path,
                    title: file.basename,
                    content,
                    tags: this.getDataBoundaryTags(file),
                    links: resolvedLinks.length > 0 ? resolvedLinks : this.getGraphDiscoveryLinks(file),
                    backlinks: backlinkMap.get(normalizePath(file.path)) ?? [],
                    folder: parentFolder(file.path),
                    modifiedAt: new Date(file.stat.mtime).toISOString(),
                });
            } catch (error) {
                this.log("Failed to read note for pattern detection", { path: file.path, error });
            }
        }
        return notes;
    }

    private async collectQuietRecallVaultNotes(
        activeFile: TFile,
        currentContent: string,
        options: Parameters<QuietRecallPluginIntegration["collectQuietRecallVaultNotes"]>[2],
    ): Promise<ReturnType<QuietRecallPluginIntegration["collectQuietRecallVaultNotes"]>> {
        return this.quietRecallIntegration.collectQuietRecallVaultNotes(activeFile, currentContent, options);
    }

    private async collectQuietRecallVaultNotesFromRelatedNotes(
        relatedNotes: Parameters<QuietRecallPluginIntegration["collectQuietRecallVaultNotesFromRelatedNotes"]>[0],
    ): Promise<ReturnType<QuietRecallPluginIntegration["collectQuietRecallVaultNotesFromRelatedNotes"]>> {
        return this.quietRecallIntegration.collectQuietRecallVaultNotesFromRelatedNotes(relatedNotes);
    }

    private async collectQuietRecallVaultNotesFromMetadata(
        activeFile: TFile,
    ): Promise<ReturnType<QuietRecallPluginIntegration["collectQuietRecallVaultNotesFromMetadata"]>> {
        return this.quietRecallIntegration.collectQuietRecallVaultNotesFromMetadata(activeFile);
    }

    private async readQuietRecallVaultNote(
        file: TFile,
        backlinkMap: Map<string, string[]>,
    ): Promise<ReturnType<QuietRecallPluginIntegration["readQuietRecallVaultNote"]>> {
        return this.quietRecallIntegration.readQuietRecallVaultNote(file, backlinkMap);
    }

    private quietRecallSourceSnapshotsAreCurrent(
        snapshots: Parameters<QuietRecallPluginIntegration["quietRecallSourceSnapshotsAreCurrent"]>[0],
    ): ReturnType<QuietRecallPluginIntegration["quietRecallSourceSnapshotsAreCurrent"]> {
        return this.quietRecallIntegration.quietRecallSourceSnapshotsAreCurrent(snapshots);
    }

    private getGraphDiscoveryLinks(file: TFile): string[] {
        const cache = this.app.metadataCache?.getFileCache(file) as {
            links?: Array<{ link?: unknown }>;
            embeds?: Array<{ link?: unknown }>;
        } | null | undefined;
        return [
            ...(cache?.links ?? []),
            ...(cache?.embeds ?? []),
        ].flatMap((entry) => typeof entry.link === "string" && entry.link.trim()
            ? [normalizePath(entry.link.trim())]
            : []);
    }

    private getResolvedOutgoingLinks(path: string): string[] {
        const resolvedLinks = this.app.metadataCache?.resolvedLinks as Record<string, Record<string, number>> | undefined;
        const targets = resolvedLinks?.[normalizePath(path)];
        if (!targets) return [];
        return Object.entries(targets).flatMap(([targetPath, count]) =>
            count > 0 ? [normalizePath(targetPath)] : []);
    }

    private buildGraphDiscoveryBacklinkMap(): Map<string, string[]> {
        const now = Date.now();
        if (this.backlinkMapCache && (now - this.backlinkMapCache.builtAt) < PluginManager.BACKLINK_MAP_TTL_MS) {
            return this.backlinkMapCache.map;
        }
        const resolvedLinks = this.app.metadataCache?.resolvedLinks as Record<string, Record<string, number>> | undefined;
        const map = new Map<string, string[]>();
        if (!resolvedLinks) return map;
        for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
            const normalizedSource = normalizePath(sourcePath);
            for (const [targetPath, count] of Object.entries(targets)) {
                if (count <= 0) continue;
                const normalizedTarget = normalizePath(targetPath);
                const list = map.get(normalizedTarget);
                if (list) list.push(normalizedSource);
                else map.set(normalizedTarget, [normalizedSource]);
            }
        }
        this.backlinkMapCache = { map, builtAt: now };
        return map;
    }

    private getGraphDiscoveryAliases(file: TFile): string[] {
        const frontmatter = this.app.metadataCache?.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
        const aliases = new Set<string>();
        collectStringValues(frontmatter?.aliases, aliases);
        collectStringValues(frontmatter?.alias, aliases);
        return [...aliases];
    }

    private maintenanceActionId(): string {
        const cryptoProvider = getPlatformCrypto();
        if (typeof cryptoProvider?.randomUUID === "function") {
            return `maint-action-${cryptoProvider.randomUUID()}`;
        }
        return `maint-action-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }

    private findMaintenanceQueueItem(proposalId: string): ReviewQueueItem | null {
        return this.listReviewQueueItems({ types: ["maintenance_proposal"] })
            .find((item) => item.metadata?.maintenanceProposalId === proposalId) ?? null;
    }

    private appendMaintenanceActionLog(entry: MaintenanceMoveActionLogEntry): Promise<void> {
        const existing = [...(this.settings.maintenanceReview.actionLog ?? [])];
        this.settings.maintenanceReview.actionLog = [
            entry,
            ...existing.filter((candidate) => candidate.id !== entry.id),
        ].slice(0, 100);
        return Promise.resolve(this.saveSettings()).catch((error) => {
            this.settings.maintenanceReview.actionLog = existing;
            throw error;
        });
    }

    private replaceMaintenanceActionLog(entry: MaintenanceMoveActionLogEntry): Promise<void> {
        const existing = [...(this.settings.maintenanceReview.actionLog ?? [])];
        this.settings.maintenanceReview.actionLog = existing.map((candidate) =>
            candidate.id === entry.id ? entry : candidate);
        if (!this.settings.maintenanceReview.actionLog.some((candidate) => candidate.id === entry.id)) {
            this.settings.maintenanceReview.actionLog = [entry, ...this.settings.maintenanceReview.actionLog].slice(0, 100);
        }
        return Promise.resolve(this.saveSettings()).catch((error) => {
            this.settings.maintenanceReview.actionLog = existing;
            throw error;
        });
    }

    private isMaintenanceMovePathAllowed(path: string): boolean {
        const decision = this.decideDataBoundaryForPath(path);
        return decision.decision === "allow";
    }

    private async applyMaintenanceProposal(proposal: MaintenanceProposal): Promise<MaintenanceMoveApplyResult> {
        return this.pageletActionIntegration.applyMaintenanceProposal(proposal);
    }

    private async rollbackAppliedMaintenanceMove(action: MaintenanceMoveActionLogEntry): Promise<boolean> {
        const currentPath = normalizePath(action.newPath).replace(/^\.\//, "");
        const originalPath = normalizePath(action.oldPath).replace(/^\.\//, "");
        const currentFile = this.app.vault.getAbstractFileByPath(currentPath);
        if (!(currentFile instanceof TFile)) return false;
        const originalExists = await this.app.vault.adapter.exists(originalPath);
        if (originalExists) return false;
        await this.app.vault.rename(currentFile, originalPath);
        return true;
    }

    private async rollbackUndoneMaintenanceMove(action: MaintenanceMoveActionLogEntry): Promise<boolean> {
        const originalPath = normalizePath(action.oldPath).replace(/^\.\//, "");
        const movedPath = normalizePath(action.newPath).replace(/^\.\//, "");
        const originalFile = this.app.vault.getAbstractFileByPath(originalPath);
        if (!(originalFile instanceof TFile)) return false;
        const movedExists = await this.app.vault.adapter.exists(movedPath);
        if (movedExists) return false;
        await this.app.vault.rename(originalFile, movedPath);
        return true;
    }

    private async updateMaintenanceQueueStatus(id: string, status: ReviewQueueStatus): Promise<void> {
        try {
            const queueResult = await this.updateReviewQueueItemStatus(id, status);
            if (!queueResult.ok) {
                this.log("Failed to update Maintenance Review queue item status", {
                    id,
                    status,
                    reason: queueResult.reason,
                });
            }
        } catch (error) {
            this.log("Failed to persist Maintenance Review queue item status", { id, status, error });
        }
    }

    private async undoMaintenanceMove(actionId: string): Promise<MaintenanceMoveUndoResult> {
        return this.pageletActionIntegration.undoMaintenanceMove(actionId);
    }

    private async runQuietRecall(): Promise<QuietRecallRunResult> {
        return this.quietRecallIntegration.runQuietRecall();
    }

    private quietRecallCandidateSourcesAreCurrent(
        candidate: QuietRecallCandidate,
    ): boolean {
        return this.quietRecallIntegration.quietRecallCandidateSourcesAreCurrent(candidate);
    }

    private resolveQuietRecallRunSourceSnapshots(
        activeSnapshot: Parameters<QuietRecallPluginIntegration["resolveQuietRecallRunSourceSnapshots"]>[0],
        capturedCandidateSnapshots: Parameters<QuietRecallPluginIntegration["resolveQuietRecallRunSourceSnapshots"]>[1],
        candidates: Parameters<QuietRecallPluginIntegration["resolveQuietRecallRunSourceSnapshots"]>[2],
    ): ReturnType<QuietRecallPluginIntegration["resolveQuietRecallRunSourceSnapshots"]> {
        return this.quietRecallIntegration.resolveQuietRecallRunSourceSnapshots(
            activeSnapshot,
            capturedCandidateSnapshots,
            candidates,
        );
    }

    private async reserveQuietRecallProviderCall(options: {
        roundStarted: boolean;
        revalidate: () => boolean;
    }) {
        return this.quietRecallIntegration.reserveQuietRecallProviderCall(options);
    }

    private async getQuietRecallLimiterUsage(
        limiter: PageletRateLimiter,
    ): Promise<{ limiterUsage?: QuietRecallLimiterUsage }> {
        return this.quietRecallIntegration.getQuietRecallLimiterUsage(limiter);
    }

    private buildQuietRecallRunSourceSnapshotId(
        currentPath: string,
        candidates: readonly QuietRecallCandidate[],
        capturedSourcePaths?: readonly string[],
    ): string | null {
        return this.quietRecallIntegration.buildQuietRecallRunSourceSnapshotId(
            currentPath,
            candidates,
            capturedSourcePaths,
        );
    }

    private isQuietRecallRunCurrent(result: QuietRecallRunResult): boolean {
        return this.quietRecallIntegration.isQuietRecallRunCurrent(result);
    }

    private async evaluateQuietRecallProviderAttempt(
        model: QuietRecallProviderModel,
        prompt: string,
        currentNoteContent: string,
        attemptKind: QuietRecallEvaluationAttempt["kind"],
        pricingIdentity: { provider: string; model: string },
        revalidate: () => boolean,
        providerCallReservation?: PageletProviderCallReservation,
    ): Promise<QuietRecallEvaluationDecision> {
        return this.quietRecallIntegration.evaluateQuietRecallProviderAttempt(
            model,
            prompt,
            currentNoteContent,
            attemptKind,
            pricingIdentity,
            revalidate,
            providerCallReservation,
        );
    }

    private async saveQuietRecallAsInsight(candidate: QuietRecallCandidate): Promise<QuietRecallSaveResult> {
        return this.quietRecallIntegration.saveQuietRecallAsInsight(candidate);
    }

    private async linkQuietRecallCandidateFromActiveNote(
        candidate: QuietRecallCandidate,
        currentPath?: string,
    ): Promise<{ ok: boolean; message: string }> {
        return this.quietRecallIntegration.linkQuietRecallCandidateFromActiveNote(candidate, currentPath);
    }

    private async linkRecallCandidate(currentPath: string, candidatePath: string): Promise<{ ok: boolean; message: string }> {
        return this.quietRecallIntegration.linkRecallCandidate(currentPath, candidatePath);
    }

    private quietRecallLinkFailureMessage(reason: string): string {
        return this.quietRecallIntegration.quietRecallLinkFailureMessage(reason);
    }

    private getRetrievalHabitProfileStore(): RetrievalHabitProfileStore {
        if (!this.retrievalHabitProfileStore) {
            this.retrievalHabitProfileStore = new RetrievalHabitProfileStore({
                settings: this.settings.retrievalHabitProfile,
                persist: async (settings) => {
                    this.settings.retrievalHabitProfile = settings;
                    await this.saveSettings();
                },
                isSourceAllowed: (ref) => this.isDataBoundaryAllowedPath(ref.path),
            });
        }
        return this.retrievalHabitProfileStore;
    }

    private recordQuietRecallFeedback(
        candidate: QuietRecallCandidate,
        feedback: RetrievalHabitFeedbackKind,
    ): Promise<RetrievalHabitProfileRecordResult> {
        return this.quietRecallIntegration.recordQuietRecallFeedback(candidate, feedback);
    }

    private getSavedInsightStore(): SavedInsightStore {
        if (!this.savedInsightStore) {
            this.savedInsightStore = new SavedInsightStore({
                items: this.settings.savedInsights.items,
                persist: (state) => this.persistPaSettingsSlice(
                    () => this.settings.savedInsights.items,
                    (items) => { this.settings.savedInsights.items = items; },
                    state.items,
                    true,
                ),
            });
        }
        return this.savedInsightStore;
    }

    private listSavedInsights(): SavedInsight[] {
        return this.getSavedInsightStore().list();
    }

    private getInsightActionPort(): ReturnType<typeof createInsightActionPort> {
        if (!this.insightActionPort) {
            this.insightActionPort = createInsightActionPort({
                getSavedStore: () => this.getSavedInsightStore(),
                getReviewStore: () => this.settings.reviewQueue.enabled ? this.getReviewQueueStore() : null,
                getBoundary: () => this.getMemoryDataBoundaryFingerprint(),
                isRuntimeCurrent: () => !this.unloading,
                isItemAllowed: item => [...(item.scope.paths ?? []), ...item.sourceRefs.map(ref => ref.path)]
                    .every(path => {
                        const file = this.app.vault.getAbstractFileByPath(path);
                        return file instanceof TFile && this.isDataBoundaryAllowedFile(file);
                    }),
                validateSource: async (path, sourceVersion) => {
                    const file = this.app.vault.getAbstractFileByPath(path);
                    if (!(file instanceof TFile) || file.extension !== 'md' || !this.isDataBoundaryAllowedFile(file)) return null;
                    const boundary = this.getMemoryDataBoundaryFingerprint();
                    const { mtime, ctime, size } = file.stat;
                    const isCurrent = () => !this.unloading && this.getMemoryDataBoundaryFingerprint() === boundary
                        && this.app.vault.getAbstractFileByPath(path) === file && file.path === path
                        && file.stat.mtime === mtime && file.stat.ctime === ctime && file.stat.size === size
                        && this.isDataBoundaryAllowedFile(file);
                    const content = await this.app.vault.cachedRead(file);
                    if (!isCurrent() || await computeContentHash(content) !== sourceVersion || !isCurrent()) return null;
                    return { ref: { path, contentHash: sourceVersion }, isCurrent };
                },
            });
        }
        return this.insightActionPort;
    }

    private async collectPageletProviderAllowedSavedInsights(): Promise<QuietRecallSavedInsightCollection> {
        return this.quietRecallIntegration.collectPageletProviderAllowedSavedInsights();
    }

    private getMemoryGovernanceStore(): MemoryGovernanceStore {
        if (!this.memoryGovernanceStore) {
            this.memoryGovernanceStore = new MemoryGovernanceStore({
                repository: this.memoryGovernanceRecordRepository
                    ?? new CallbackMemoryGovernanceRecordRepository(
                        this.settings.memoryGovernance.records,
                        (state) => this.persistPaSettingsSlice(
                    () => this.settings.memoryGovernance.records,
                    (records) => { this.settings.memoryGovernance.records = records; },
                    state.records,
                        ),
                    ),
            });
        }
        return this.memoryGovernanceStore;
    }

    private listConfirmedMemories(): ConfirmedMemoryRecord[] {
        const governed = this.getGovernedMemoryViewSnapshot();
        return governed
            ? governed.records.map((entry) => cloneSerializable(entry.record))
            : this.getMemoryGovernanceStore().list();
    }

    private getMemoryGovernancePanelState(): PanelMemoryGovernanceState {
        const governanceMode = this.getMemoryGovernanceUiMode();
        const governedProjection = this.getGovernedMemoryProjectionSnapshot();
        const governed = governedProjection
            ? buildGovernedMemoryViewSnapshot(
                governedProjection.state,
                governedProjection.vaultScopeKey,
            )
            : null;
        if (!governed) {
            if (governanceMode !== "legacy_threshold") {
                return { governanceMode, records: [], totalCount: 0 };
            }
            const records = this.getMemoryGovernanceStore().list();
            return { governanceMode, records, totalCount: records.length };
        }
        const records = governed.records.map((entry) => {
            const projection = this.projectGovernedMemoryUiEntry(
                entry,
                governedProjection!.state,
            );
            return {
                ...cloneSerializable(entry.record),
                ...(entry.revisionId ? { revisionId: entry.revisionId } : {}),
                effect: projection.effect,
                useStatus: projection.useStatus,
                durableUseStatus: projection.durableUseStatus,
                actionPolicy: { ...projection.actionPolicy },
                ...(entry.writingStyle ? { writingStyle: cloneSerializable(entry.writingStyle) } : {}),
            };
        });
        const recentChanges: PanelMemoryRecentChange[] = governed.recentChanges.map((change) => ({
            id: change.id,
            claimId: change.claimId,
            kind: change.kind,
            occurredAt: change.occurredAt,
            ...(change.redacted ? {} : {
                ...(change.summary ? { summary: change.summary } : {}),
                ...(change.sourcePath ? { sourcePath: change.sourcePath } : {}),
                ...(change.scope ? {
                    scopeLabel: change.scope.label
                        ?? change.scope.paths?.[0]
                        ?? change.scope.tags?.[0]
                        ?? pageletT("pagelet.tab.memory.scope.currentVault", this.getPageletLocale()),
                } : {}),
                ...(change.effect ? { effect: change.effect } : {}),
            }),
            ...(change.status ? { status: change.status } : {}),
            undoAvailable: change.undoAvailable,
        }));
        return {
            governanceMode,
            records,
            recentChanges,
            totalCount: records.length,
        };
    }

    private runPageletGovernedMemoryAction(
        action: "correct" | "pause" | "resume",
        record: ConfirmedMemoryRecord,
        summary?: string,
    ): Promise<MemoryRecordActionResult> {
        if (this.getMemoryGovernanceUiMode() !== "effect_based") {
            return Promise.resolve(this.governedMemoryActionFailure(action, "mode_unavailable"));
        }
        const current = this.getMemoryGovernancePanelState().records
            .find((candidate) => candidate.id === record.id);
        if (!current || current.actionPolicy?.[action] !== true) {
            return Promise.resolve(this.governedMemoryActionFailure(action, "action_unavailable"));
        }
        if (action === "correct") {
            const submittedRecord = record as PanelMemoryGovernanceRecord;
            return this.correctGovernedMemory(record, summary ?? "", submittedRecord.revisionId);
        }
        if (action === "pause") return this.pauseGovernedMemory(current);
        return this.resumeGovernedMemory(current);
    }

    private forgetMemoryFromPagelet(
        record: ConfirmedMemoryRecord,
    ): Promise<MemoryRecordActionResult> {
        const mode = this.getMemoryGovernanceUiMode();
        if (mode === "effect_based") {
            const current = this.getMemoryGovernancePanelState().records
                .find((candidate) => candidate.id === record.id);
            if (!current || current.actionPolicy?.forget !== true) {
                return Promise.resolve(this.governedMemoryActionFailure(
                    "forget",
                    "action_unavailable",
                ));
            }
            return this.forgetGovernedMemory(current);
        }
        const projected = record as PanelMemoryGovernanceRecord;
        if (mode === "legacy_threshold"
            && projected.actionPolicy === undefined
            && projected.effect === undefined
            && projected.useStatus === undefined
            && projected.durableUseStatus === undefined) {
            const current = this.getMemoryGovernancePanelState().records
                .find((candidate) => candidate.id === record.id);
            return current
                ? this.forgetConfirmedMemory(current)
                : Promise.resolve(this.governedMemoryActionFailure("forget", "claim_unavailable"));
        }
        return Promise.resolve(this.governedMemoryActionFailure("forget", "mode_unavailable"));
    }

    private undoMemoryFromPagelet(
        change: PanelMemoryRecentChange,
    ): Promise<MemoryRecordActionResult> {
        if (this.getMemoryGovernanceUiMode() !== "effect_based") {
            return Promise.resolve(this.governedMemoryActionFailure("undo", "mode_unavailable"));
        }
        const current = this.getMemoryGovernancePanelState().recentChanges
            ?.find((candidate) => candidate.id === change.id && candidate.undoAvailable === true);
        return current
            ? this.undoGovernedMemoryChange(current)
            : Promise.resolve(this.governedMemoryActionFailure("undo", "change_unavailable"));
    }

    private correctGovernedMemory(
        record: ConfirmedMemoryRecord,
        summary: string,
        expectedRevisionId?: string,
        action?: MemoryGovernanceActionIdentity,
        isCurrent?: () => boolean,
    ): Promise<MemoryRecordActionResult> {
        const displayedRevisionId = expectedRevisionId
            ?? (record as PanelMemoryGovernanceRecord).revisionId;
        if (!displayedRevisionId) {
            return Promise.resolve(this.governedMemoryActionFailure("correct", "revision_unavailable"));
        }
        return this.runGovernedMemoryLifecycleAction(
            record.id,
            "correct",
            (coordinator, dataBoundaryAllowed) => coordinator.correct({
                claimId: record.id,
                summary,
                scopeAllowed: true,
                dataBoundaryAllowed,
                expectedRevisionId: displayedRevisionId,
                action,
                isCurrent,
            }),
            ...(action !== undefined ? [true] as const : []),
        );
    }

    correctWritingStyleMemory(claimId: string, exactText: string, scene: WritingScene): Promise<MemoryRecordActionResult> {
        return this.serializeGovernedMemoryLifecycle(async () => {
            const current = this.getMemoryGovernancePanelState().records.find((record) => record.id === claimId);
            const service = this.getWritingStyleService();
            const crypto = getPlatformCrypto();
            if (!current?.writingStyle || current.actionPolicy?.correct !== true || !service || !crypto?.randomUUID) {
                return this.governedMemoryActionFailure('correct', 'action_unavailable');
            }
            try {
                await service.correct(claimId, exactText, scene, `writing_style_${crypto.randomUUID().replace(/-/g, '')}`);
                await this.refreshGovernedMemoryActionState();
                await this.notifySettingsChanged();
                const record = this.getMemoryGovernancePanelState().records.find((item) => item.id === claimId);
                return { ok: true, message: this.governedMemoryActionSuccessMessage('correct'), ...(record ? { record: cloneSerializable(record) } : {}) };
            } catch { return this.governedMemoryActionFailure('correct', 'operation_threw'); }
        });
    }

    private pauseGovernedMemory(
        record: ConfirmedMemoryRecord,
        action?: MemoryGovernanceActionIdentity,
        isCurrent?: () => boolean,
    ): Promise<MemoryRecordActionResult> {
        return this.runGovernedMemoryLifecycleAction(
            record.id,
            "pause",
            (coordinator) => coordinator.pauseUse({ claimId: record.id, action, isCurrent }),
            ...(action !== undefined ? [true] as const : []),
        );
    }

    private resumeGovernedMemory(
        record: ConfirmedMemoryRecord,
        action?: MemoryGovernanceActionIdentity,
        isCurrent?: () => boolean,
    ): Promise<MemoryRecordActionResult> {
        return this.runGovernedMemoryLifecycleAction(
            record.id,
            "resume",
            (coordinator, dataBoundaryAllowed) => coordinator.resumeUse({
                claimId: record.id,
                scopeAllowed: true,
                dataBoundaryAllowed,
                action,
                isCurrent,
            }),
            ...(action !== undefined ? [true] as const : []),
        );
    }

    private async applyGovernedMemoryDeviceWide(
        record: ConfirmedMemoryRecord,
        action?: MemoryGovernanceActionIdentity,
        isCurrent?: () => boolean,
    ): Promise<MemoryRecordActionResult> {
        if (this.getGovernedMemoryScopeAction(record.id) !== "apply_device_wide") {
            return this.governedMemoryActionFailure("apply_device_wide", "scope_action_unavailable");
        }
        const confirmed = await confirmUserAction(this.app, {
            title: this.t("plugin.settings.memoryControlCenter.scope.deviceConfirmTitle"),
            message: this.t("plugin.settings.memoryControlCenter.scope.deviceConfirmMessage"),
            confirmText: this.t("plugin.settings.memoryControlCenter.action.apply_device_wide"),
        });
        if (!confirmed) {
            const result: MemoryRecordActionResult = {
                ok: false,
                message: this.t("plugin.settings.memoryControlCenter.scope.cancelled"),
                actionStatus: "cancelled",
                reason: "cancelled",
            };
            return action ? result : this.withoutMemoryActionReceipt(result);
        }
        return this.runGovernedMemoryLifecycleAction(
            record.id,
            "apply_device_wide",
            (coordinator, dataBoundaryAllowed) => coordinator.changeScope({
                claimId: record.id,
                applicability: { kind: "whole_vault" },
                partition: { kind: "device_collaboration", key: "device" },
                explicitDeviceScope: true,
                scopeAllowed: true,
                dataBoundaryAllowed,
                action,
                isCurrent,
            }),
            ...(action !== undefined ? [true] as const : []),
        );
    }

    private limitGovernedMemoryToCurrentVault(
        record: ConfirmedMemoryRecord,
        action?: MemoryGovernanceActionIdentity,
        isCurrent?: () => boolean,
    ): Promise<MemoryRecordActionResult> {
        if (this.getGovernedMemoryScopeAction(record.id) !== "limit_to_current_vault") {
            return Promise.resolve(this.governedMemoryActionFailure(
                "limit_to_current_vault",
                "scope_action_unavailable",
            ));
        }
        const opaqueVaultKey = this.memoryGovernanceOpaqueVaultKey;
        if (!opaqueVaultKey) {
            return Promise.resolve(this.governedMemoryActionFailure(
                "limit_to_current_vault",
                "vault_identity_unavailable",
            ));
        }
        return this.runGovernedMemoryLifecycleAction(
            record.id,
            "limit_to_current_vault",
            (coordinator, dataBoundaryAllowed) => coordinator.changeScope({
                claimId: record.id,
                applicability: { kind: "whole_vault" },
                partition: { kind: "vault", key: opaqueVaultKey },
                scopeAllowed: true,
                dataBoundaryAllowed,
                action,
                isCurrent,
            }),
            ...(action !== undefined ? [true] as const : []),
        );
    }

    private async forgetGovernedMemory(
        record: ConfirmedMemoryRecord,
        action?: MemoryGovernanceActionIdentity,
        isCurrent?: () => boolean,
    ): Promise<MemoryRecordActionResult> {
        const confirmed = await confirmUserAction(this.app, {
            title: pageletT("pagelet.tab.memory.forgetConfirmTitle", this.getPageletLocale()),
            message: pageletT("pagelet.tab.memory.forgetConfirmMessage", this.getPageletLocale()),
            confirmText: pageletT("pagelet.tab.memory.forgetConfirm", this.getPageletLocale()),
        });
        if (!confirmed) {
            const result: MemoryRecordActionResult = {
                ok: false,
                message: pageletT("pagelet.tab.memory.forgetCancelled", this.getPageletLocale()),
                actionStatus: "cancelled",
                reason: "cancelled",
            };
            return action ? result : this.withoutMemoryActionReceipt(result);
        }
        return this.runGovernedMemoryLifecycleAction(
            record.id,
            "forget",
            (coordinator) => coordinator.forget({ claimId: record.id, action, isCurrent }),
            ...(action !== undefined ? [true] as const : []),
        );
    }

    private undoGovernedMemoryChange(
        change: PanelMemoryRecentChange,
        action?: MemoryGovernanceActionIdentity,
        isCurrent?: () => boolean,
    ): Promise<MemoryRecordActionResult> {
        return this.runGovernedMemoryLifecycleAction(
            change.claimId,
            "undo",
            (coordinator) => coordinator.undoRecentChange({ eventId: change.id, action, isCurrent }),
            ...(action !== undefined ? [true] as const : []),
        );
    }

    private retryPendingForget(
        claimId: string,
        isCurrent?: () => boolean,
    ): Promise<MemoryRecordActionResult> {
        return this.serializeGovernedMemoryLifecycle(async () => {
            if (isCurrent && !isCurrent()) {
                return this.governedMemoryActionFailure("forget", "action_request_not_current");
            }
            const coordinator = this.memoryGovernanceCoordinator;
            const repository = this.deviceMemoryGovernanceRepository;
            const vaultKey = this.memoryGovernanceOpaqueVaultKey;
            if (!coordinator || !repository || !vaultKey) {
                return {
                    ok: false,
                    message: this.t("plugin.settings.memoryControlCenter.pendingForget.retryUnavailable"),
                    actionStatus: "failed",
                    reason: "retry_unavailable",
                };
            }
            const before = await repository.initialize();
            const pending = before.pendingOperations.some((operation) => (
                operation.kind === "forget"
                && operation.claimId === claimId
                && (operation.partition.kind === "device_collaboration"
                    || operation.partition.key === vaultKey)
            ));
            if (!pending) {
                return {
                    ok: false,
                    message: this.t("plugin.settings.memoryControlCenter.pendingForget.retryUnavailable"),
                    actionStatus: "failed",
                    reason: "retry_unavailable",
                };
            }
            const result = await coordinator.resumePendingForgets();
            await this.refreshGovernedMemoryActionState();
            await this.notifySettingsChanged();
            if (!result.ok || result.value.pending.length > 0) {
                this.scheduleMemoryForgetRetry();
            } else {
                this.cancelMemoryForgetRetry();
            }
            if (!result.ok || result.value.pending.includes(claimId)) {
                return {
                    ok: false,
                    message: this.t("plugin.settings.memoryControlCenter.pendingForget.retryPending"),
                    actionStatus: "pending",
                    reason: "forget_retry_pending",
                    retryScheduled: true,
                    claimId,
                };
            }
            return {
                ok: true,
                message: this.t("plugin.settings.memoryControlCenter.pendingForget.retryComplete"),
                actionStatus: "applied",
                claimId,
            };
        });
    }

    runMemoryControlCenterAction(
        action: "correct" | "pause_use" | "resume_use" | "apply_device_wide"
            | "limit_to_current_vault" | "forget" | "retry_forget" | "undo_recent_change",
        targetId: string,
        summary?: string,
        options?: { expectedRevisionId?: string; eventId?: string },
    ): Promise<MemoryRecordActionResult> {
        return this.runMemoryControlCenterActionInternal(action, targetId, summary, options)
            .then((result) => this.withoutMemoryActionReceipt(result));
    }

    private runMemoryControlCenterActionInternal(
        action: "correct" | "pause_use" | "resume_use" | "apply_device_wide"
            | "limit_to_current_vault" | "forget" | "retry_forget" | "undo_recent_change",
        targetId: string,
        summary?: string,
        options?: { expectedRevisionId?: string; eventId?: string },
        domainAction?: MemoryGovernanceActionIdentity,
        isCurrent?: () => boolean,
    ): Promise<MemoryRecordActionResult> {
        if (action === "retry_forget") return this.retryPendingForget(targetId, isCurrent);
        if (action === "undo_recent_change") {
            const change = this.getMemoryGovernancePanelState().recentChanges
                ?.find((candidate) => options?.eventId
                    ? candidate.id === options.eventId && candidate.claimId === targetId
                    : candidate.id === targetId);
            return change
                ? domainAction
                    ? this.undoGovernedMemoryChange(change, domainAction, isCurrent)
                    : this.undoGovernedMemoryChange(change)
                : Promise.resolve(this.governedMemoryActionFailure("undo", "change_unavailable"));
        }
        const record = this.getMemoryGovernancePanelState().records
            .find((candidate) => candidate.id === targetId);
        if (!record) {
            const lifecycleAction = action === "pause_use"
                ? "pause"
                : action === "resume_use" ? "resume" : action;
            return Promise.resolve(this.governedMemoryActionFailure(lifecycleAction, "claim_unavailable"));
        }
        if (action === "correct") {
            if (!options?.expectedRevisionId) {
                return Promise.resolve(this.governedMemoryActionFailure(
                    "correct",
                    "revision_unavailable",
                ));
            }
            return domainAction
                ? this.correctGovernedMemory(
                    record,
                    summary ?? "",
                    options.expectedRevisionId,
                    domainAction,
                    isCurrent,
                )
                : this.correctGovernedMemory(record, summary ?? "", options.expectedRevisionId);
        }
        if (action === "pause_use") {
            return domainAction
                ? this.pauseGovernedMemory(record, domainAction, isCurrent)
                : this.pauseGovernedMemory(record);
        }
        if (action === "resume_use") {
            return domainAction
                ? this.resumeGovernedMemory(record, domainAction, isCurrent)
                : this.resumeGovernedMemory(record);
        }
        if (action === "apply_device_wide") {
            return domainAction
                ? this.applyGovernedMemoryDeviceWide(record, domainAction, isCurrent)
                : this.applyGovernedMemoryDeviceWide(record);
        }
        if (action === "limit_to_current_vault") {
            return domainAction
                ? this.limitGovernedMemoryToCurrentVault(record, domainAction, isCurrent)
                : this.limitGovernedMemoryToCurrentVault(record);
        }
        return domainAction
            ? this.forgetGovernedMemory(record, domainAction, isCurrent)
            : this.forgetGovernedMemory(record);
    }

    private withoutMemoryActionReceipt(result: MemoryRecordActionResult): MemoryRecordActionResult {
        return this.governanceActions.stripActionReceipt(result);
    }

    private async executeMemoryGovernanceActionForPort(
        input: import("./ai-services/memory-action-types").MemoryActionPortInput,
    ): Promise<import("./pa/memory-action-port").MemoryActionGovernanceResult> {
        return this.governanceActions.executeActionForPort(
            input,
            (action, targetId, content, options, domainAction, isCurrent) => (
                this.runMemoryControlCenterActionInternal(
                    action,
                    targetId,
                    content,
                    options,
                    domainAction,
                    isCurrent,
                )
            ),
        );
    }

    getMemorySuppressionMarkerCount(): number {
        const snapshot = this.getGovernedMemoryProjectionSnapshot();
        if (!snapshot) return 0;
        const protectedMarkerIds = new Set(snapshot.state.pendingOperations.flatMap((operation) => (
            operation.kind === "forget" ? operation.suppressionMarkerIds : []
        )));
        return snapshot.state.suppressionMarkers.filter((marker) => (
            marker.partition.kind === "vault"
            && marker.partition.key === snapshot.vaultScopeKey
            && !protectedMarkerIds.has(marker.id)
        )).length;
    }

    clearMemorySuppressionMarkers(): Promise<{ ok: boolean; message: string; clearedCount: number }> {
        return this.serializeGovernedMemoryLifecycle(async () => {
            const repository = this.deviceMemoryGovernanceRepository;
            const vaultKey = this.memoryGovernanceOpaqueVaultKey;
            if (!repository || !vaultKey || !this.getGovernedMemoryProjectionSnapshot()) {
                return {
                    ok: false,
                    message: this.t("plugin.settings.memoryControlCenter.dataRecovery.prevention.unavailable"),
                    clearedCount: 0,
                };
            }
            let clearedCount = 0;
            await repository.transact((draft) => {
                const protectedMarkerIds = new Set(draft.pendingOperations.flatMap((operation) => (
                    operation.kind === "forget" ? operation.suppressionMarkerIds : []
                )));
                const retained = draft.suppressionMarkers.filter((marker) => {
                    const shouldClear = marker.partition.kind === "vault"
                        && marker.partition.key === vaultKey
                        && !protectedMarkerIds.has(marker.id);
                    if (shouldClear) clearedCount += 1;
                    return !shouldClear;
                });
                draft.suppressionMarkers = retained;
            });
            await this.refreshGovernedMemoryActionState();
            await this.notifySettingsChanged();
            return {
                ok: true,
                message: this.t("plugin.settings.memoryControlCenter.dataRecovery.prevention.done", {
                    count: clearedCount,
                }),
                clearedCount,
            };
        });
    }

    getMemoryRollbackStatusMessage(reason?: string): string {
        switch (reason) {
            case "rollback_pending_operations":
                return this.t("plugin.settings.memoryControlCenter.dataRecovery.rollback.pending");
            case "rollback_window_expired":
            case "rollback_not_available":
                return this.t("plugin.settings.memoryControlCenter.dataRecovery.rollback.unavailable");
            default:
                return this.t("plugin.settings.memoryControlCenter.dataRecovery.rollback.failed");
        }
    }

    rollbackMemoryGovernance(): Promise<{ ok: boolean; message: string }> {
        return this.serializeGovernedMemoryLifecycle(async () => {
            const repository = this.deviceMemoryGovernanceRepository;
            const vaultKey = this.memoryGovernanceOpaqueVaultKey;
            const barrier = this.legacyMemoryCompatibilityBarrier;
            if (!repository || !vaultKey || !barrier) {
                return {
                    ok: false,
                    message: this.t("plugin.settings.memoryControlCenter.dataRecovery.rollback.unavailable"),
                };
            }
            let before = await repository.initialize();
            before = await this.clearResolvedLegacySourceReconciliation(
                repository,
                vaultKey,
                before,
            );
            const migration = before.migrationStates[vaultKey];
            if (migration?.phase === "rolled_back") {
                this.completeLegacyMemoryRollbackRuntime(
                    barrier,
                    repository,
                    before,
                    vaultKey,
                    migration.sourceHash ?? this.memoryGovernanceSourceHash ?? "",
                );
                await this.notifySettingsChanged();
                return {
                    ok: true,
                    message: this.t("plugin.settings.memoryControlCenter.dataRecovery.rollback.complete"),
                };
            }
            const expectedSourceHash = migration?.legacySourceStateHash ?? migration?.sourceHash;
            if (!migration || !expectedSourceHash
                || (migration.phase !== "compatibility" && migration.phase !== "rolling_back")) {
                return {
                    ok: false,
                    message: this.t("plugin.settings.memoryControlCenter.dataRecovery.rollback.unavailable"),
                };
            }
            const rollback = new MemoryGovernanceRollbackCoordinator({
                repository,
                opaqueVaultKey: vaultKey,
                writeLegacyProjection: (projection) => this.writeLegacyMemoryProjectionForRollback(
                    barrier,
                    projection,
                    expectedSourceHash,
                ),
                readLegacyProjection: () => this.readPersistedLegacyMemoryProjection(),
            });
            const result = await rollback.run();
            if (!result.ok) {
                this.log("Memory governance rollback did not complete", { reason: result.reason });
                if (result.phase === "rolling_back") {
                    // The normal cache refresh intentionally rejects the
                    // write-blocking rolling_back phase. Keep enough current
                    // state for Settings to expose Retry without turning this
                    // typed, recoverable outcome into a rejected promise.
                    this.currentDeviceMemoryGovernanceState = cloneSerializable(
                        await repository.initialize(),
                    );
                    this.cancelMemoryGovernanceGarbageCollection();
                } else {
                    await this.refreshGovernedMemoryActionState();
                }
                await this.notifySettingsChanged();
                return { ok: false, message: this.getMemoryRollbackStatusMessage(result.reason) };
            }
            const rolledBackState = await repository.initialize();
            this.completeLegacyMemoryRollbackRuntime(
                barrier,
                repository,
                rolledBackState,
                vaultKey,
                migration.sourceHash ?? expectedSourceHash,
            );
            await this.notifySettingsChanged();
            return {
                ok: true,
                message: this.t("plugin.settings.memoryControlCenter.dataRecovery.rollback.complete"),
            };
        });
    }

    getMemoryFinalizationStatusMessage(reason?: string): string {
        switch (reason) {
            case "finalization_pending_operations":
                return this.t("plugin.settings.memoryControlCenter.finalization.blocked.pending");
            case "legacy_source_reconciliation_required":
                return this.t("plugin.settings.memoryControlCenter.finalization.blocked.reconcile");
            case "finalization_not_available":
            case "governed_cutover_incomplete":
            case "finalization_confirmation_stale":
            case "finalization_state_changed":
                return this.t("plugin.settings.memoryControlCenter.finalization.blocked.notReady");
            case "rollback_window_expired":
            case "legacy_source_verification_failed":
            case "finalization_cleanup_failed":
            case "finalization_lock_failed":
            case "finalization_readback_not_empty":
            case "finalization_commit_failed":
            case "fresh_restore_state_invalid":
            case "fresh_restore_claim_invalid":
            case "fresh_restore_revision_missing":
            case "fresh_restore_origin_collision":
            case "fresh_restore_queue_invalid":
            case "fresh_restore_entry_collision":
            case "fresh_restore_readback_mismatch":
                return this.t("plugin.settings.memoryControlCenter.finalization.blocked.recovery");
            default:
                return this.t("plugin.settings.memoryControlCenter.finalization.failed");
        }
    }

    /** One explicit local action; failure never repairs or filters the old Profile. */
    checkAndUpgradeMemoryGovernance(): Promise<{ ok: boolean; message: string }> {
        return this.serializeGovernedMemoryLifecycle(async () => {
            const result = await this.enqueueSettingsWrite(async () => {
                const repository = this.deviceMemoryGovernanceRepository;
                const vaultKey = this.memoryGovernanceOpaqueVaultKey;
                const barrier = this.legacyMemoryCompatibilityBarrier;
                const history = this.chatHistoryStore;
                const vault = this.app.vault;
                const localVaultId = this.settings.statisticsVaultId;
                const configScope = getVaultConfigDirStorageScope(vault);
                if (!repository || !vaultKey || !barrier?.isActive() || this.unloading
                    || this.memoryGovernanceBootstrapState !== "ready") return { ok: false as const, reason: "upgrade_not_available" };
                const epoch = this.getMemoryGraphTopologyEpoch("chat");
                const compatibilityFingerprint = hashLegacyMemoryPayload(barrier.snapshot());
                const coordinator = new MemoryGovernanceUpgradeCoordinator({
                    repository, opaqueVaultKey: vaultKey, profileReader: this.createExistingUserProfileReader(),
                    readLegacySource: () => this.readPersistedLegacyMemorySourceSnapshot(),
                    readConversation: async (id) => {
                        if (!history || !(await history.getConversation(id))) return undefined;
                        return history.getTurns(id);
                    },
                    isPathAllowed: (path) => this.isDataBoundaryAllowedPath(path),
                    isCurrent: () => !this.unloading && this.deviceMemoryGovernanceRepository === repository
                        && this.app.vault === vault && this.settings.statisticsVaultId === localVaultId
                        && getVaultConfigDirStorageScope(this.app.vault) === configScope
                        && this.memoryGovernanceOpaqueVaultKey === vaultKey && this.chatHistoryStore === history
                        && this.legacyMemoryCompatibilityBarrier === barrier && barrier.isActive()
                        && hashLegacyMemoryPayload(barrier.snapshot()) === compatibilityFingerprint
                        && this.getMemoryGraphTopologyEpoch("chat") === epoch,
                });
                return coordinator.run();
            });
            if (!result.ok) {
                this.log("Memory compatibility upgrade left existing data unchanged", { reason: result.reason });
                return { ok: false, message: this.getMemoryUpgradeStatusMessage(result.reason) };
            }
            try {
                await this.refreshGovernedMemoryActionState();
                await this.notifySettingsChanged();
            } catch (error) {
                this.log("Memory upgrade committed; local display refresh remains pending", error);
                return { ok: true, message: this.t("plugin.settings.memoryControlCenter.upgrade.refreshPending") };
            }
            return { ok: true, message: this.t("plugin.settings.memoryControlCenter.upgrade.complete", { count: result.adoptedCount }) };
        });
    }

    getMemoryUpgradeStatusMessage(reason: string): string {
        if (reason === "pending_operations") return this.t("plugin.settings.memoryControlCenter.upgrade.pending");
        if (reason === "source_suppressed") return this.t("plugin.settings.memoryControlCenter.upgrade.suppressed");
        if (reason === "conversation_missing" || reason === "conversation_evidence_mismatch" || reason === "profile_evidence_unsupported") {
            return this.t("plugin.settings.memoryControlCenter.upgrade.evidence");
        }
        if (reason === "source_excluded") return this.t("plugin.settings.memoryControlCenter.upgrade.excluded");
        if (reason === "profile_invalid" || reason === "profile_projection_mismatch" || reason === "legacy_projection_mismatch") {
            return this.t("plugin.settings.memoryControlCenter.upgrade.mismatch");
        }
        if (reason === "profile_absence_unlocked") return this.t("plugin.settings.memoryControlCenter.upgrade.absent");
        if (reason === "source_changed" || reason === "profile_changed" || reason === "governance_changed" || reason === "legacy_source_changed") {
            return this.t("plugin.settings.memoryControlCenter.upgrade.changed");
        }
        return this.t("plugin.settings.memoryControlCenter.upgrade.unavailable");
    }

    finalizeMemoryGovernance(
        confirmationToken: string,
    ): Promise<{ ok: boolean; message: string }> {
        return this.serializeGovernedMemoryLifecycle(async () => {
            const repository = this.deviceMemoryGovernanceRepository;
            const vaultKey = this.memoryGovernanceOpaqueVaultKey;
            const barrier = this.legacyMemoryCompatibilityBarrier;
            if (!repository || !vaultKey || !barrier || !confirmationToken.trim()) {
                return {
                    ok: false,
                    message: this.t("plugin.settings.memoryControlCenter.finalization.unavailable"),
                };
            }
            const coordinator = new MemoryGovernanceFinalizationCoordinator({
                repository,
                opaqueVaultKey: vaultKey,
                clearLegacyMemorySlices: (expectedSourceHash) => (
                    this.clearLegacyMemorySlicesForFinalization(barrier, expectedSourceHash)
                ),
                readLegacySourceSnapshot: () => this.readPersistedLegacyMemorySourceSnapshot(),
            });
            const result = await coordinator.run(confirmationToken);
            if (!result.ok) {
                this.log("Memory finalization did not complete", { reason: result.reason });
                await this.cancelLegacyMemoryFinalizationIfCompatible(
                    repository,
                    vaultKey,
                    barrier,
                );
                await this.refreshGovernedMemoryActionState();
                await this.notifySettingsChanged();
                return {
                    ok: false,
                    message: this.getMemoryFinalizationStatusMessage(result.reason),
                };
            }
            barrier.finalize();
            this.legacyMemoryPayload = captureLegacyMemoryPayload(this.settings);
            await this.refreshGovernedMemoryActionState();
            await this.notifySettingsChanged();
            return {
                ok: true,
                message: this.t("plugin.settings.memoryControlCenter.finalization.complete"),
            };
        });
    }

    private async cancelLegacyMemoryFinalizationIfCompatible(
        repository: MemoryGovernanceRepository,
        vaultKey: string,
        barrier: LegacyMemoryCompatibilityBarrier,
    ): Promise<void> {
        try {
            const state = await repository.initialize();
            const migration = state.migrationStates[vaultKey];
            if (!migration || migration.phase !== "compatibility") return;
            const persisted = await this.loadData();
            const payload = captureLegacyMemoryPayload(persisted);
            const liveSourceHash = hashLegacyMemoryPayload(payload);
            const expectedSourceHash = migration.pendingLegacySourceHash
                ?? migration.legacySourceStateHash
                ?? migration.sourceHash;
            if (!expectedSourceHash || liveSourceHash !== expectedSourceHash) return;
            if (this.legacyMemoryCompatibilityBarrier !== barrier) return;
            if (!barrier.cancelFinalization(persisted)) return;
            this.legacyMemoryPayload = barrier.snapshot();
        } catch (error) {
            // Keep the barrier finalizing so ordinary saves fail closed until a
            // later explicit retry can prove the compatibility source again.
            this.log("Memory finalization compatibility barrier remains blocked", error);
        }
    }

    private async clearLegacyMemorySlicesForFinalization(
        barrier: LegacyMemoryCompatibilityBarrier,
        expectedSourceHash: string,
    ): Promise<boolean> {
        let cleared = false;
        await this.enqueueSettingsWrite(async () => {
            if (this.unloading) throw new Error("Memory finalization stopped during plugin unload.");
            const processed = await this.processPluginDataJson((persisted) => {
                const liveSourceHash = hashLegacyMemoryPayload(captureLegacyMemoryPayload(persisted));
                if (liveSourceHash !== expectedSourceHash) return persisted;
                const composed = barrier.composeForFinalization(persisted);
                if (!composed.ok) {
                    throw new Error(`Memory finalization compose failed: ${composed.errorCode}`);
                }
                barrier.beginFinalization();
                cleared = true;
                return composed.payload;
            });
            if (!cleared) return;
            const readbackHash = hashLegacyMemoryPayload(
                captureLegacyMemoryPayload(processed.readback),
            );
            if (readbackHash === expectedSourceHash) {
                throw new Error("Memory finalization readback was not cleared.");
            }
            const reviewQueue = processed.written.reviewQueue;
            const reviewQueueItems = reviewQueue && typeof reviewQueue === "object"
                && Array.isArray((reviewQueue as { items?: unknown }).items)
                ? (reviewQueue as { items: ReviewQueueItem[] }).items.map(cloneSerializable)
                : [];
            this.settings.memoryGovernance.records = [];
            this.settings.reviewQueue.items = reviewQueueItems;
            this.settings.confirmedMemoryCount = 0;
            this.settings.memoryAutoAcceptPaused = false;
            this.currentLocalConfirmedMemoryCount = 0;
            this.currentLocalMemoryAutoAcceptPaused = false;
        });
        return cleared;
    }

    private async readPersistedLegacyMemoryProjection(): Promise<LegacyMemoryRollbackProjection> {
        return (await this.readPersistedLegacyMemorySourceSnapshot()).projection;
    }

    private async readPersistedLegacyMemorySourceSnapshot(): Promise<LegacyMemoryFinalizationSourceSnapshot> {
        return this.buildLegacyMemorySourceSnapshot(await this.loadData());
    }

    private buildLegacyMemorySourceSnapshot(raw: unknown): LegacyMemoryFinalizationSourceSnapshot {
        const payload = captureLegacyMemoryPayload(raw);
        const parsed = parseLegacyMemoryPayload(payload);
        const policy = normalizeLegacyMemoryPolicy(payload).baseline;
        if (parsed.rejected.length > 0) {
            throw new Error("Memory finalization readback is invalid.");
        }
        return {
            sourceHash: parsed.sourceHash,
            projection: {
                records: parsed.acceptedClaims.map(cloneSerializable),
                memoryQueueItems: parsed.acceptedMemoryQueueItems.map(cloneSerializable),
                confirmedMemoryCount: policy.confirmedCount,
                memoryAutoAcceptPaused: policy.autoAcceptPaused,
            },
        };
    }

    private async writeLegacyMemoryProjectionForRollback(
        barrier: LegacyMemoryCompatibilityBarrier,
        projection: LegacyMemoryRollbackProjection,
        expectedSourceHash: string,
    ): Promise<LegacyMemoryRollbackWriteResult> {
        return this.enqueueSettingsWrite(async () => {
            if (this.unloading) throw new Error("Memory rollback stopped during plugin unload.");
            let changedSourceHash: string | null = null;
            const processed = await this.processPluginDataJson((persisted) => {
                const current = this.buildLegacyMemorySourceSnapshot(persisted);
                if (current.sourceHash !== expectedSourceHash) {
                    if (legacyMemoryRollbackProjectionsEqual(current.projection, projection)) {
                        return persisted;
                    }
                    changedSourceHash = current.sourceHash;
                    return persisted;
                }
                return this.composeLegacyMemoryRollbackPayload(persisted, projection);
            });
            if (changedSourceHash) {
                return {
                    ok: false,
                    reason: "legacy_source_changed",
                    sourceHash: changedSourceHash,
                };
            }
            const verified = this.buildLegacyMemorySourceSnapshot(processed.readback);
            if (!legacyMemoryRollbackProjectionsEqual(verified.projection, projection)) {
                return {
                    ok: false,
                    reason: "legacy_source_changed",
                    sourceHash: verified.sourceHash,
                };
            }
            const reviewQueue = processed.readback.reviewQueue;
            const nextItems = reviewQueue && typeof reviewQueue === "object"
                && Array.isArray((reviewQueue as { items?: unknown }).items)
                ? (reviewQueue as { items: ReviewQueueItem[] }).items.map(cloneSerializable)
                : [];
            this.settings.memoryGovernance.records = projection.records.map(cloneSerializable);
            this.settings.reviewQueue.items = nextItems.map(cloneSerializable);
            this.settings.confirmedMemoryCount = projection.confirmedMemoryCount;
            this.settings.memoryAutoAcceptPaused = projection.memoryAutoAcceptPaused;
            return { ok: true };
        });
    }

    private async clearResolvedLegacySourceReconciliation(
        repository: MemoryGovernanceRepository,
        vaultKey: string,
        state: DeviceMemoryGovernanceStateV1,
    ): Promise<DeviceMemoryGovernanceStateV1> {
        const migration = state.migrationStates[vaultKey];
        const trustedSourceHash = migration?.legacySourceStateHash ?? migration?.sourceHash;
        if (!migration?.pendingLegacySourceHash || migration.phase !== "compatibility"
            || !trustedSourceHash) return state;
        const live = await this.readPersistedLegacyMemorySourceSnapshot();
        if (live.sourceHash !== trustedSourceHash) return state;
        const pendingSourceHash = migration.pendingLegacySourceHash;
        await repository.transact((draft) => {
            const current = draft.migrationStates[vaultKey];
            const currentTrustedHash = current?.legacySourceStateHash ?? current?.sourceHash;
            if (!current || current.phase !== "compatibility"
                || current.pendingLegacySourceHash !== pendingSourceHash
                || currentTrustedHash !== trustedSourceHash) return;
            delete current.pendingLegacySourceHash;
            delete current.lastErrorCode;
        });
        return repository.initialize();
    }

    private completeLegacyMemoryRollbackRuntime(
        barrier: LegacyMemoryCompatibilityBarrier,
        repository: MemoryGovernanceRepository,
        state: DeviceMemoryGovernanceStateV1,
        vaultKey: string,
        sourceHash: string,
    ): void {
        if (!sourceHash.trim() || state.migrationStates[vaultKey]?.phase !== "rolled_back") {
            throw new MemoryGovernanceBootstrapError("migration_failed");
        }
        barrier.finalize();
        this.legacyMemoryPayload = captureLegacyMemoryPayload(this.settings);
        this.installLegacyMemoryRuntimeAfterRollback(
            repository,
            state,
            vaultKey,
            sourceHash,
        );
    }

    private composeLegacyMemoryRollbackPayload(
        persisted: Record<string, unknown>,
        projection: LegacyMemoryRollbackProjection,
    ): Record<string, unknown> {
        const passthrough = buildLegacyReviewQueuePassthrough(persisted.reviewQueue);
        const preserved = passthrough.preservedRawEntries
            .filter((entry) => entry.reason !== "memory_item")
            .sort((left, right) => left.originalIndex - right.originalIndex);
        const nextItems: unknown[] = [
            ...projection.memoryQueueItems.map(cloneSerializable),
            ...passthrough.liveNonMemoryItems.map(cloneSerializable),
        ];
        const knownIds = new Set(nextItems.flatMap((item) => (
            typeof item === "object" && item !== null && typeof (item as { id?: unknown }).id === "string"
                ? [(item as { id: string }).id]
                : []
        )));
        if (knownIds.size !== nextItems.length) {
            throw new Error("Memory rollback queue IDs collide.");
        }
        for (const entry of preserved) {
            if (entry.id && knownIds.has(entry.id)) {
                throw new Error("Memory rollback queue IDs collide.");
            }
            if (entry.id) knownIds.add(entry.id);
            const index = Math.max(0, Math.min(entry.originalIndex, nextItems.length));
            nextItems.splice(index, 0, cloneSerializable(entry.value));
        }
        const payload = cloneSerializable(persisted);
        payload.memoryGovernance = {
            ...(payload.memoryGovernance && typeof payload.memoryGovernance === "object"
                && !Array.isArray(payload.memoryGovernance)
                ? payload.memoryGovernance as Record<string, unknown>
                : {}),
            records: projection.records.map(cloneSerializable),
        };
        payload.reviewQueue = {
            ...(payload.reviewQueue && typeof payload.reviewQueue === "object"
                && !Array.isArray(payload.reviewQueue)
                ? payload.reviewQueue as Record<string, unknown>
                : {}),
            items: nextItems,
        };
        payload.confirmedMemoryCount = projection.confirmedMemoryCount;
        payload.memoryAutoAcceptPaused = projection.memoryAutoAcceptPaused;
        return payload;
    }

    private installLegacyMemoryRuntimeAfterRollback(
        repository: MemoryGovernanceRepository,
        state: DeviceMemoryGovernanceStateV1,
        opaqueVaultKey: string,
        sourceHash: string,
    ): void {
        const handle = this.governanceStorage.getCurrentHandle();
        if (!handle
            || handle.repository !== repository
            || handle.opaqueVaultKey !== opaqueVaultKey) {
            throw new MemoryGovernanceBootstrapError("memory_mutation_blocked");
        }
        this.governanceActions.clearRuntime();
        this.governanceStorage.installLegacyRuntime(handle, state, sourceHash);
    }

    private runGovernedMemoryLifecycleAction(
        claimId: string,
        action: "correct" | "pause" | "resume" | "apply_device_wide"
            | "limit_to_current_vault" | "forget" | "undo",
        operation: (
            coordinator: MemoryGovernanceCoordinator,
            dataBoundaryAllowed: boolean,
        ) => Promise<{
            ok: boolean;
            reason?: string;
            pending?: boolean;
            value?: {
                claimId: string;
                eventId: string;
                undoExpiresAt?: string;
                superseded?: boolean;
            };
        }>,
        includeActionReceipt = false,
    ): Promise<MemoryRecordActionResult> {
        return this.governanceActions.runLifecycleAction(
            claimId,
            action,
            operation,
            includeActionReceipt,
        );
    }

    private serializeGovernedMemoryLifecycle<T>(operation: () => Promise<T>): Promise<T> {
        return this.governanceActions.serialize(operation);
    }

    private async readGovernedMemoryActionBoundary(claimId: string): Promise<boolean | null> {
        const repository = this.deviceMemoryGovernanceRepository;
        const vaultKey = this.memoryGovernanceOpaqueVaultKey;
        if (this.memoryGovernanceBootstrapState !== "ready" || !repository || !vaultKey) return null;
        const state = await repository.initialize();
        const claim = state.claims.find((candidate) => candidate.id === claimId);
        if (!claim || (claim.partition.kind === "vault"
            ? claim.partition.key !== vaultKey
            : claim.partition.kind !== "device_collaboration" || claim.partition.key !== "device")) {
            return null;
        }
        const revision = claim.activeRevisionId
            ? state.revisions.find((candidate) => (
                candidate.id === claim.activeRevisionId && candidate.claimId === claim.id
            ))
            : undefined;
        if (!revision) return null;
        this.currentDeviceMemoryGovernanceState = cloneSerializable(state);
        return this.isGovernedMemoryRevisionAllowed(
            revision,
            this.getMemoryDataBoundaryFingerprint(),
        );
    }

    private async refreshGovernedMemoryActionState(): Promise<void> {
        const scheduledRefresh = this.deviceMemoryCacheRefreshPromise;
        if (scheduledRefresh) await scheduledRefresh;
        await this.refreshDeviceMemoryCaches();
    }

    private scheduleMemoryForgetRetry(): void {
        this.governanceActions.scheduleForgetRetry();
    }

    private cancelMemoryForgetRetry(): void {
        this.governanceActions.cancelForgetRetry();
    }

    private scheduleMemoryProfileProjectionRetry(): void {
        this.governanceActions.scheduleProfileProjectionRetry();
    }

    private cancelMemoryProfileProjectionRetry(): void {
        this.governanceActions.cancelProfileProjectionRetry();
    }

    private scheduleMemoryGovernanceGarbageCollection(minimumDelayMs = 0): void {
        this.governanceActions.scheduleGarbageCollection(minimumDelayMs);
    }

    private cancelMemoryGovernanceGarbageCollection(): void {
        this.governanceActions.cancelGarbageCollection();
    }

    private governedMemoryActionSuccessMessage(
        action: "correct" | "pause" | "resume" | "apply_device_wide"
            | "limit_to_current_vault" | "forget" | "undo",
    ): string {
        return this.governanceActions.successMessage(action);
    }

    private governedMemoryActionFailure(
        action: "correct" | "pause" | "resume" | "apply_device_wide"
            | "limit_to_current_vault" | "forget" | "undo",
        reason: string,
        pending = false,
    ): MemoryRecordActionResult {
        return this.governanceActions.failureResult(action, reason, pending);
    }

    private async openMemorySource(path: string): Promise<void> {
        const normalizedPath = normalizePath(path).replace(/^\.\//, "");
        const file = this.app.vault.getAbstractFileByPath(normalizedPath);
        if (!(file instanceof TFile)) {
            new Notice(pageletT("pagelet.tab.memory.sourceUnavailable", this.getPageletLocale()));
            return;
        }
        await this.app.workspace.getLeaf(false).openFile(file);
    }

    private openMemorySettings(targetId?: string): void {
        openSettings(this.app);
        openSettingsTab(this.app, "personal-assistant");
        this.settingTab.openGroup("memory-personalization", targetId);
        setPlatformTimeout(() => this.settingTab.openGroup("memory-personalization", targetId), 0);
    }

    private getCurrentConfirmedMemoryCount(): number {
        return this.currentLocalConfirmedMemoryCount
            ?? normalizeConfirmedMemoryCount(this.settings.confirmedMemoryCount);
    }

    private getCurrentMemoryAutoAcceptPaused(): boolean {
        return this.currentLocalMemoryAutoAcceptPaused
            ?? this.settings.memoryAutoAcceptPaused === true;
    }

    private shouldAutoConfirmMemoryCandidates(): boolean {
        return this.getMemoryGovernanceUiMode() === "legacy_threshold"
            && this.settings.memoryEnabled === true
            && getMemoryTrustLevel(this.getCurrentConfirmedMemoryCount()) >= 2
            && !this.getCurrentMemoryAutoAcceptPaused();
    }

    private async autoConfirmMemoryCandidateFromQueueItem(item: ReviewQueueItem): Promise<boolean> {
        if (!this.shouldAutoConfirmMemoryCandidates()) return false;
        const currentItem = this.getReviewQueueItemById(item.id);
        if (!currentItem || currentItem.status !== "suggested") return false;
        const candidate = memoryCandidateFromQueueItem(currentItem);
        if (!candidate.ok) {
            this.log("Memory candidate auto-confirm skipped", { id: currentItem.id, reason: candidate.reason });
            return false;
        }
        if (!canAutoConfirmMemoryCandidate(candidate.value)) return false;
        const result = await this.confirmMemoryCandidateQueueItem(currentItem, {
            confirmationStrength: "auto",
            failureStatus: "suggested",
            logContext: "auto-confirm",
        });
        if (!result.ok) {
            this.log("Memory candidate auto-confirm failed", { id: currentItem.id, message: result.message });
            return false;
        }
        return true;
    }

    private async confirmMemoryCandidateFromQueueItem(item: ReviewQueueItem): Promise<{ ok: boolean; message: string }> {
        const result = await this.confirmMemoryCandidateQueueItem(item, {
            confirmationStrength: "explicit",
            failureStatus: "failed",
            logContext: "manual-confirm",
        });
        return { ok: result.ok, message: result.message };
    }

    private async confirmMemoryCandidateQueueItem(
        item: ReviewQueueItem,
        options: {
            confirmationStrength: NonNullable<ConfirmedMemoryRecord["confirmationStrength"]>;
            failureStatus: "failed" | "suggested";
            logContext: string;
        },
    ): Promise<{ ok: boolean; message: string }> {
        const currentItem = this.getReviewQueueItemById(item.id);
        if (!currentItem) {
            return {
                ok: false,
                message: pageletT("pagelet.tab.memory.confirmFailed", this.getPageletLocale(), {
                    reason: "not_found",
                }),
            };
        }
        if (currentItem.status !== "suggested") {
            return {
                ok: false,
                message: pageletT("pagelet.tab.memory.confirmFailed", this.getPageletLocale(), {
                    reason: `already_${currentItem.status}`,
                }),
            };
        }

        const candidate = memoryCandidateFromQueueItem(currentItem);
        if (!candidate.ok) {
            return {
                ok: false,
                message: pageletT("pagelet.tab.memory.confirmFailed", this.getPageletLocale(), {
                    reason: candidate.reason,
                }),
            };
        }
        if (this.memoryAdmissionCoordinator && this.getGovernedMemoryProjectionSnapshot()) {
            return this.confirmGovernedMemoryQueueItem(currentItem);
        }
        let reserveResult: ReviewQueueResult<ReviewQueueItem>;
        try {
            reserveResult = await this.updateReviewQueueItemStatus(currentItem.id, "accepted");
        } catch (error) {
            this.log("Memory candidate queue reserve failed", { id: currentItem.id, error });
            return {
                ok: false,
                message: pageletT("pagelet.tab.memory.confirmFailed", this.getPageletLocale(), {
                    reason: "queue_reserve_failed",
                }),
            };
        }
        if (!reserveResult.ok) {
            return {
                ok: false,
                message: pageletT("pagelet.tab.memory.confirmFailed", this.getPageletLocale(), {
                    reason: reserveResult.reason,
                }),
            };
        }
        let result: Awaited<ReturnType<MemoryGovernanceStore["confirmCandidate"]>>;
        try {
            result = await this.getMemoryGovernanceStore().confirmCandidate(candidate.value, {
                scope: reserveResult.value.scope,
                confirmationSource: "pagelet",
                confirmationStrength: options.confirmationStrength,
                originReviewQueueItemId: currentItem.id,
            });
        } catch (error) {
            this.log("Memory candidate confirmation threw", {
                id: currentItem.id,
                context: options.logContext,
                error,
            });
            result = { ok: false, reason: "confirmation_threw" };
        }
        if (!result.ok) {
            await this.recoverMemoryCandidateQueueFailure(currentItem.id, options);
            return {
                ok: false,
                message: pageletT("pagelet.tab.memory.confirmFailed", this.getPageletLocale(), {
                    reason: result.reason,
                }),
            };
        }
        try {
            const queueResult = await this.updateReviewQueueItemStatus(currentItem.id, "applied");
            if (!queueResult.ok && this.getReviewQueueItemById(currentItem.id)?.status !== "applied") {
                this.log("Memory candidate confirmed but queue status update failed", {
                    id: currentItem.id,
                    reason: queueResult.reason,
                });
            }
        } catch (error) {
            this.log("Memory candidate confirmed but queue status persist threw", {
                id: currentItem.id,
                error,
            });
        }
        await this.reconcileMemoryQueueAudit();
        try {
            if (this.memoryGovernanceBootstrapState === "ready") {
                await this.updateCurrentLocalMemoryPolicy({
                    confirmedMemoryCount: this.getCurrentConfirmedMemoryCount() + 1,
                });
                await this.notifySettingsChanged();
            } else {
                this.settings.confirmedMemoryCount = normalizeConfirmedMemoryCount(
                    this.settings.confirmedMemoryCount,
                ) + 1;
                await this.saveSettings();
            }
        } catch (error) {
            this.log("Memory candidate confirmed but confirmed count persist threw", {
                id: currentItem.id,
                context: options.logContext,
                error,
            });
        }
        return {
            ok: true,
            message: pageletT("pagelet.tab.memory.confirmed", this.getPageletLocale()),
        };
    }

    private confirmGovernedMemoryQueueItem(
        item: ReviewQueueItem,
    ): Promise<{ ok: boolean; message: string }> {
        return this.serializeGovernedMemoryLifecycle(async () => {
            const coordinator = this.memoryAdmissionCoordinator;
            if (!coordinator) {
                return {
                    ok: false,
                    message: pageletT("pagelet.tab.memory.actionUnavailable", this.getPageletLocale()),
                };
            }
            const dataBoundaryAllowed = item.sourceRefs.length === 0
                || item.sourceRefs.every((sourceRef) => this.isDataBoundaryAllowedPath(sourceRef.path));
            const stored = (await this.deviceMemoryGovernanceRepository?.initialize())?.memoryQueueItems.find(
                (candidate) => candidate.id === item.id,
            );
            const receipt = stored?.governanceAdmission?.chatSemanticReceipt;
            const source = receipt ? await this.prepareChatSemanticSourceEvidence(receipt, stored!.claim) : null;
            if (receipt && !source) {
                return { ok: false, message: pageletT("pagelet.tab.memory.actionUnavailable", this.getPageletLocale()) };
            }
            let result;
            try {
                result = await coordinator.confirmQueueItem({
                queueItemId: item.id,
                dataBoundaryAllowed,
                    ...(source ? { chatSemanticEvidence: source.evidence,
                        lifetime: { isCurrent: source.isCurrent, signal: source.guard.signal } } : {}),
                });
            } finally {
                source?.release();
            }
            if (!result.ok) {
                this.log("Governed Memory candidate confirmation failed", {
                    id: item.id,
                    reason: result.reason,
                });
                return {
                    ok: false,
                    message: pageletT("pagelet.tab.memory.confirmFailed", this.getPageletLocale(), {
                        reason: result.reason,
                    }),
                };
            }
            const projection = await this.memoryProfileProjectionWorker?.resumePending();
            if (projection && projection.pending.length > 0) {
                this.log("Memory Profile projection remains pending after confirmation", {
                    count: projection.pending.length,
                });
            }
            await this.refreshGovernedMemoryActionState();
            await this.notifySettingsChanged();
            return {
                ok: true,
                message: pageletT("pagelet.tab.memory.confirmed", this.getPageletLocale()),
            };
        });
    }

    private async recoverMemoryCandidateQueueFailure(
        itemId: string,
        options: {
            failureStatus: "failed" | "suggested";
            logContext: string;
        },
    ): Promise<void> {
        try {
            const failedResult = await this.updateReviewQueueItemStatus(itemId, "failed");
            if (!failedResult.ok) {
                this.log("Memory candidate confirmation failed and queue failure status update failed", {
                    id: itemId,
                    context: options.logContext,
                    reason: failedResult.reason,
                });
                return;
            }
            if (options.failureStatus !== "suggested") return;
            const retryResult = await this.updateReviewQueueItemStatus(itemId, "suggested");
            if (!retryResult.ok) {
                this.log("Memory candidate confirmation failed and queue suggested recovery failed", {
                    id: itemId,
                    context: options.logContext,
                    reason: retryResult.reason,
                });
            }
        } catch (error) {
            this.log("Memory candidate confirmation failed and queue recovery status persist threw", {
                id: itemId,
                context: options.logContext,
                error,
            });
        }
    }

    private async dismissMemoryCandidateFromQueueItem(item: ReviewQueueItem): Promise<{ ok: boolean; message: string }> {
        if (this.memoryAdmissionCoordinator && this.getGovernedMemoryProjectionSnapshot()) {
            return this.serializeGovernedMemoryLifecycle(async () => {
                const result = await this.memoryAdmissionCoordinator!.dismissQueueItem({
                    queueItemId: item.id,
                });
                if (!result.ok) {
                    this.log("Governed Memory candidate dismissal failed", {
                        id: item.id,
                        reason: result.reason,
                    });
                    return {
                        ok: false,
                        message: pageletT("pagelet.tab.memory.dismissFailed", this.getPageletLocale(), {
                            reason: result.reason,
                        }),
                    };
                }
                await this.refreshGovernedMemoryActionState();
                await this.notifySettingsChanged();
                return {
                    ok: true,
                    message: pageletT("pagelet.tab.memory.dismissed", this.getPageletLocale()),
                };
            });
        }
        const result = await this.dismissReviewQueueItem(item.id);
        if (!result.ok) {
            return {
                ok: false,
                message: pageletT("pagelet.tab.memory.dismissFailed", this.getPageletLocale(), {
                    reason: result.reason,
                }),
            };
        }
        return {
            ok: true,
            message: pageletT("pagelet.tab.memory.dismissed", this.getPageletLocale()),
        };
    }

    private async forgetConfirmedMemory(record: ConfirmedMemoryRecord): Promise<{
        ok: boolean;
        message: string;
        record?: ConfirmedMemoryRecord;
    }> {
        const current = this.getMemoryGovernanceStore().list().find((candidate) => candidate.id === record.id);
        if (!current || current.lifecycle === "forgotten_tombstone") {
            return {
                ok: false,
                message: pageletT("pagelet.tab.memory.removeFailed", this.getPageletLocale(), {
                    reason: current ? "already_removed" : "not_found",
                }),
            };
        }

        let forgotten: Awaited<ReturnType<MemoryGovernanceStore["forget"]>>;
        const finishDebugForget = this.getAgentDebugIntegration().beginLegacyForget();
        try {
            forgotten = await this.getMemoryGovernanceStore().forget(current.id, "user_remove");
        } catch (error) {
            finishDebugForget();
            this.log("Confirmed Memory removal persist failed", { id: current.id, error });
            return {
                ok: false,
                message: pageletT("pagelet.tab.memory.removeFailed", this.getPageletLocale(), {
                    reason: "persist_failed",
                }),
            };
        }
        if (!forgotten.ok) {
            finishDebugForget();
            return {
                ok: false,
                message: pageletT("pagelet.tab.memory.removeFailed", this.getPageletLocale(), {
                    reason: forgotten.reason,
                }),
            };
        }

        let debugCleanupPending = false;
        try {
            await this.getAgentDebugIntegration().forgetLegacyRecord(current.id);
        } catch {
            debugCleanupPending = true;
        } finally {
            finishDebugForget();
        }

        await this.reconcileMemoryQueueAudit();

        return {
            ok: true,
            message: debugCleanupPending ? this.t('plugin.agentDebug.cleanupPending')
                : pageletT("pagelet.tab.memory.removed", this.getPageletLocale()),
            record: forgotten.value,
        };
    }

    /**
     * Canonical Memory records are durable retry markers for their exact linked
     * Review Queue audit entries. This intentionally bypasses the user-facing
     * `reviewQueue.enabled` gate: disabling the queue must not strand an active
     * record at `accepted` or a removed record at `accepted`/`applied`.
     */
    private reconcileMemoryQueueAudit(): Promise<void> {
        return this.governanceActions.reconcileQueueAudit(
            (isCurrent) => this.runMemoryQueueAuditReconciliation(isCurrent),
        );
    }

    private async runMemoryQueueAuditReconciliation(
        isCurrent: () => boolean = () => true,
    ): Promise<void> {
        try {
            if (!isCurrent()) return;
            const records = this.getMemoryGovernanceStore().list()
                .filter((record) => Boolean(record.originReviewQueueItemId));
            if (records.length === 0) return;
            const queueStore = this.getReviewQueueStore();
            for (const record of records) {
                if (!isCurrent()) return;
                const queueItemId = record.originReviewQueueItemId;
                if (!queueItemId) continue;
                const queueItem = queueStore.list().find((item) => item.id === queueItemId);
                if (!queueItem) continue;
                const isTombstone = record.lifecycle === "forgotten_tombstone";
                if ((!isTombstone && queueItem.status === "applied")
                    || (isTombstone && queueItem.status === "undone")) continue;
                let auditStatus = queueItem.status;
                if (auditStatus === "accepted") {
                    try {
                        const appliedResult = await queueStore.updateStatus(queueItemId, "applied");
                        if (!isCurrent()) return;
                        if (!appliedResult.ok) {
                            const latestStatus = queueStore.list().find((item) => item.id === queueItemId)?.status;
                            if (latestStatus !== "applied") {
                                this.log("Memory queue audit apply reconciliation failed", {
                                    id: record.id,
                                    queueItemId,
                                    reason: appliedResult.reason,
                                });
                                continue;
                            }
                        }
                        auditStatus = "applied";
                    } catch (error) {
                        this.log("Memory queue audit apply reconciliation threw", {
                            id: record.id,
                            queueItemId,
                            error,
                        });
                        continue;
                    }
                }
                if (!isTombstone && auditStatus === "applied") continue;
                if (auditStatus !== "applied") {
                    this.log("Memory queue audit requires manual reconciliation", {
                        id: record.id,
                        queueItemId,
                        status: auditStatus,
                    });
                    continue;
                }
                try {
                    const queueResult = await queueStore.updateStatus(queueItemId, "undone");
                    if (!isCurrent()) return;
                    if (!queueResult.ok
                        && queueStore.list().find((item) => item.id === queueItemId)?.status !== "undone") {
                        this.log("Memory queue audit reconciliation failed", {
                            id: record.id,
                            queueItemId,
                            reason: queueResult.reason,
                        });
                    }
                } catch (error) {
                    this.log("Memory queue audit reconciliation threw", {
                        id: record.id,
                        queueItemId,
                        error,
                    });
                }
            }
        } catch (error) {
            this.log("Memory queue audit scan failed", error);
        }
    }

    /**
     * Content-free runtime policy identity for diagnostics and smoke evidence.
     * Raw sparse overrides remain private settings data; callers receive only
     * the resolved rollout, platform mask, and effective flags.
     */
    getRetrievalOptimizationPolicySnapshot(): B125RetrievalOptimizationPolicySnapshot {
        return resolveB125RetrievalOptimizationPolicySnapshot(
            this.settings.retrievalOptimizationFlags,
        );
    }

    private getEffectiveRetrievalOptimizationFlags() {
        return this.getRetrievalOptimizationPolicySnapshot().effectiveFlags;
    }

    private createMemoryHost(): MemoryHost {
        const getSettings = () => this.settings;
        return {
            app: this.app,
            pluginId: this.manifest?.id ?? "personal-assistant",
            get settings() { return getSettings(); },
            log: (...args: unknown[]) => this.log(args[0] as string, ...args.slice(1)),
            registerEvent: (ref) => this.registerEvent(ref),
            saveSettings: () => this.saveSettings(),
            persistMemoryAdmissionSettings: () => this.persistMemoryAdmissionSettings(),
            getVSSFiles: () => this.getVSSFiles(),
            isVSSFileEligible: (file, markdown) => this.isVSSFileEligible(file, markdown),
            isDataBoundaryAllowedPath: (path) => this.isDataBoundaryAllowedPath(path),
            getAPIToken: () => this.getAPIToken(),
            getRetrievalOptimizationFlags: () => this.getEffectiveRetrievalOptimizationFlags(),
            notifyStatusChanged: () => this.memoryStatusNotifier.schedule(),
            updateMemorySetting: (key, value) => {
                (this.settings as unknown as Record<string, unknown>)[key] = value;
            },
        };
    }

    private createAiServiceHost(surface: RetrievalDiagnosticSurface): AiServiceHost {
        const getOperationsAgentEnabled = () => this.isOperationsAgentEnabled;
        const retrievalDiagnostics = this.retrievalDiagnostics.bindSurface(surface);
        const host: AiServiceHost = {
            ...(surface === 'chat' ? { agentDebug: this.getAgentDebugIntegration().service } : {}),
            app: this.app,
            settings: this.settings,
            log: (...args: unknown[]) => this.log(args[0] as string, ...args.slice(1)),
            recordRetrievalDiagnostic: retrievalDiagnostics.record,
            createRetrievalDiagnosticRecorder: retrievalDiagnostics.createRecorder,
            scheduleArmedGraphWorkerCancellation:
                retrievalDiagnostics.scheduleArmedGraphWorkerCancellation,
            isGraphPprEnabled: () => this.getEffectiveRetrievalOptimizationFlags().graphPpr,
            getRetrievalOptimizationFlags: () => this.getEffectiveRetrievalOptimizationFlags(),
            getRetrievalOptimizationEpoch: () => this.getRetrievalOptimizationEpoch(),
            onSettingsChanged: (listener) => this.onSettingsChanged(listener),
            getAPIToken: () => this.getAPIToken(),
            get isOperationsAgentEnabled() {
                return getOperationsAgentEnabled();
            },
            getMemoryExtractionPromptContext: () =>
                this.getMemoryExtractionPromptContext() as unknown as Record<string, unknown>,
            memorySearch: {
                ensureReadyForChat: (query, signal, preparationOwnerSignal, options) => (
                    this.ensureMemoryReadyForChat(query, signal, preparationOwnerSignal, options)
                ),
                searchHybrid: (query, opts) =>
                    this.vss?.searchHybrid(query, opts) ?? Promise.resolve([]),
                getChunksByPath: (paths, opts) =>
                    this.vss?.getChunksByPath(paths, opts) ?? Promise.resolve([]),
                rankGraphCandidates: (queryEmbedding, paths, control, opts) => {
                    if (!this.vss) {
                        return Promise.reject(new Error("Memory graph ranking is unavailable."));
                    }
                    return this.vss.rankGraphCandidates(queryEmbedding, paths, control, opts);
                },
                cancelGraphCandidateRank: (requestId, runEpoch) => {
                    this.vss?.cancelGraphCandidateRank(requestId, runEpoch);
                },
                getPathEvidenceGenerations: (paths, opts) => {
                    if (!this.vss) {
                        return Promise.reject(new Error("Memory evidence generations are unavailable."));
                    }
                    return this.vss.getPathEvidenceGenerations(paths, opts);
                },
            },
            insightRead: createInsightReadPort({
                isRuntimeCurrent: () => !this.unloading,
                getVaultInsights: () => {
                    const enabled = this.canRunMemoryExtractionRuntime()
                        && this.settings.memoryExtractionIncludeVaultInsights === true;
                    const scheduler = this.memoryExtractionScheduler;
                    const isSourceCurrent = this.captureVaultInsightsSourceValidity();
                    return {
                        status: enabled ? (scheduler?.getVaultInsightsStatus() ?? "not_loaded") : "disabled",
                        snapshot: enabled ? (scheduler?.getVaultInsightsSnapshot()?.snapshot ?? null) : null,
                        boundary: this.getMemoryDataBoundaryFingerprint(),
                        sourceIdentity: this.vaultInsightsSource ?? undefined,
                        isSourceCurrent,
                    };
                },
                listSavedInsights: () => this.listSavedInsights(),
                getBoundary: () => this.getMemoryDataBoundaryFingerprint(),
                isPathAllowed: path => this.isDataBoundaryAllowedPath(path),
                getSourceRevision: path => {
                    const file = this.app.vault.getAbstractFileByPath(path);
                    return file instanceof TFile && this.isDataBoundaryAllowedFile(file)
                        ? { identity: file, mtime: file.stat.mtime, ctime: file.stat.ctime, size: file.stat.size }
                        : null;
                },
            }),
            insightActions: this.getInsightActionPort(),
            memoryManagement: createMemoryManagementReadPort({
                isRuntimeCurrent: () => !this.unloading,
                captureLegacySourceValidity: () => this.captureMemoryManagementLegacySourceValidity(),
                getSettings: () => ({
                    memoryEnabled: this.settings.memoryEnabled === true,
                    learningEnabled: this.canRunMemoryExtractionRuntime(),
                    learningStatus: this.canRunMemoryExtractionRuntime() ? "enabled" : "paused",
                    existingUnderstandingAvailable: this.settings.memoryEnabled === true,
                }),
                getControlCenterSnapshot: () => this.getMemoryControlCenterSnapshot(),
                getGovernedState: () => this.getGovernedMemoryProjectionSnapshot()?.state ?? null,
                getCacheTarget: () => this.deviceMemoryCacheRefreshTargetSequence,
                getVaultKey: () => this.memoryGovernanceOpaqueVaultKey,
                getDataBoundaryFingerprint: () => this.getMemoryDataBoundaryFingerprint(),
                isDataBoundaryAllowedPath: path => this.isMemoryProviderPathAllowed(path),
                getHistoryManager: () => this.chatHistoryManager,
                getWritingVersions: () => this.writingVersions,
            }),
            memoryActions: createMemoryActionPort({
                isRuntimeCurrent: () => !this.unloading,
                getSettings: () => ({
                    memoryEnabled: this.settings.memoryEnabled === true,
                    learningEnabled: this.canRunMemoryExtractionRuntime(),
                }),
                getAdmissionCoordinator: () => this.memoryAdmissionCoordinator,
                getRepository: () => this.deviceMemoryGovernanceRepository,
                getProfileProjectionWorker: () => this.memoryProfileProjectionWorker,
                captureTypeABaseline: () => this.captureGovernedTypeAAdmissionBaseline(),
                getDataBoundaryFingerprint: () => this.getMemoryDataBoundaryFingerprint(),
                executeGovernedAction: input => this.executeMemoryGovernanceActionForPort(input),
                refreshState: async () => {
                    await this.refreshGovernedMemoryActionState();
                    await this.notifySettingsChanged();
                },
                scheduleProfileProjectionRetry: () => this.scheduleMemoryProfileProjectionRetry(),
                log: (message, metadata) => this.log(message, metadata),
            }),
            getMemoryEvidenceEpoch: () => this.getMemoryGraphTopologyEpoch("chat"),
            getGraphBoundarySnapshotSource: () => this.createMemoryGraphBoundarySnapshotSource("chat"),
            isDataBoundaryAllowedPath: (path) => this.isMemoryProviderPathAllowed(path),
            readLatestMemorySource: (path, signal) => this.captureLatestMemorySource(
                path,
                (candidatePath) => this.isMemoryProviderPathAllowed(candidatePath),
                "chat",
                signal,
            ),
            agentRunCoordinator: this.agentRunCoordinator,
        };
        host.revalidateVaultObservation = (evidence, options) => revalidateVaultObservationFromApp(
            host,
            evidence,
            options,
        );
        return host;
    }

    private ensureMemoryReadyForChat(
        query?: string,
        signal?: AbortSignal,
        preparationOwnerSignal?: AbortSignal,
        options?: { existingOnly?: boolean },
    ): Promise<MemoryDecisionResult> {
        // This bridge is reached only by an admitted AI run. Heal the same
        // retained-token reload state here as a defence in depth for direct
        // callers that do not come through Chat's composer or Pagelet's
        // explicit-action gate. Passive startup still never calls this path.
        if (this.getAIReadiness("memory").issue === "token_unknown") {
            this.refreshAPITokenPresence();
        }
        if (!this.getAIReadiness("memory").ready) {
            return Promise.resolve({ decision: "answer-now" });
        }
        return this.memoryManager?.ensureReadyForChat(query, signal, preparationOwnerSignal, ...(options ? [options] : []))
            ?? Promise.resolve({ decision: "answer-now" });
    }

    private invalidateMemoryGraphTopology(): void {
        this.sourceAccess.invalidateMemoryGraphTopology();
    }

    private getRetrievalOptimizationEpoch(): string {
        const snapshot = this.getRetrievalOptimizationPolicySnapshot();
        const signature = stableStringify(snapshot);
        if (signature !== this.retrievalOptimizationSignature) {
            this.retrievalOptimizationSignature = signature;
            this.retrievalOptimizationEpoch = this.retrievalOptimizationEpoch >= Number.MAX_SAFE_INTEGER
                ? 1
                : this.retrievalOptimizationEpoch + 1;
        }
        return `retrieval-flags:${this.retrievalOptimizationEpoch}:${stableHash(signature)}`;
    }

    private createMemoryGraphBoundarySnapshotSource(
        consumer: "chat" | "pagelet",
    ): GraphBoundarySnapshotSource | undefined {
        return this.sourceAccess.createMemoryGraphBoundarySnapshotSource(consumer);
    }

    private getMemoryGraphTopologyEpoch(consumer: "chat" | "pagelet"): string {
        return this.sourceAccess.getMemoryGraphTopologyEpoch(consumer);
    }

    private classifyMemoryGraphPath(
        path: string,
        consumer: "chat" | "pagelet",
        pageletResolver?: ScopeResolver,
    ): GraphPathClass {
        return this.sourceAccess.classifyMemoryGraphPath(path, consumer, pageletResolver);
    }

    private canonicalizeMemoryGraphPath(path: string): string | null {
        return this.sourceAccess.canonicalizeMemoryGraphPath(path);
    }

    private getOperationsService(): OperationsService {
        if (this.operationsService) return this.operationsService;
        const vault = this.app.vault as unknown as OperationsVault;
        this.operationsService = new OperationsService({
            vault,
            trashFile: async (file) => {
                await this.app.fileManager.trashFile(file as unknown as TAbstractFile);
            },
            isOperationsAgentEnabled: () => this.isOperationsAgentEnabled,
            audit: {
                includeContent: () => this.settings.operationsAuditIncludeContent,
                retentionDays: () => this.settings.operationsAuditRetentionDays,
            },
            isPathAllowed: (path) => this.isDataBoundaryAllowedPath(path),
            log: (message, ...args) => this.log(message, ...args),
        });
        return this.operationsService;
    }

    private getPageletOperationsSession(): OperationsSession {
        return this.pageletOperationsIntegration.getSession();
    }

    private retirePageletOperationsSession(): void {
        this.pageletOperationsIntegration.retireCurrentSession();
    }

    private async stagePageletInsightLink(input: {
        candidateId: string;
        anchorPath: string;
        sourcePath: string;
    }, signal?: AbortSignal): Promise<OperationsIntent> {
        return this.pageletOperationsIntegration.stageInsightLink(input, signal);
    }

    private async confirmPageletOperationsIntent(
        intentId: string,
    ): Promise<OperationsExecutionResult> {
        return this.pageletOperationsIntegration.confirmIntent(intentId);
    }

    private cancelPageletOperationsIntent(intentId: string): void {
        this.pageletOperationsIntegration.cancelIntent(intentId);
    }

    private async undoPageletOperationsReceipts(
        receiptIds: readonly string[],
    ): Promise<UndoResult[]> {
        return this.pageletOperationsIntegration.undoReceipts(receiptIds);
    }

    private consumePageletOperationsSelfWrite(path: string): boolean {
        return this.pageletOperationsIntegration.consumeSelfWrite(path);
    }

    createChatService(): ChatService {
        return this.chatIntegration.createChatService();
    }

    private getWritingStyleService(): WritingStyleService | undefined {
        return this.chatIntegration.getWritingStyleService();
    }

    private rememberWritingStyle(versionId: string, scene: WritingScene): Promise<void> {
        return this.serializeGovernedMemoryLifecycle(async () => {
            const mode = this.getMemoryGovernanceUiMode();
            if (mode !== 'effect_based') {
                throw new WritingStyleUnavailableError(mode === 'legacy_threshold' ? 'legacy_memory' : 'governance_unavailable');
            }
            const service = this.getWritingStyleService();
            const crypto = getPlatformCrypto();
            if (!service || !crypto?.randomUUID) throw new Error('Writing style unavailable');
            await service.remember(versionId, scene, `writing_style_${crypto.randomUUID().replace(/-/g, '')}`);
            await this.refreshGovernedMemoryActionState();
            await this.notifySettingsChanged();
        });
    }

    private async prepareWritingStyle(prompt: string, parentScene: WritingScene | undefined,
        budget: Parameters<ChatWritingStylePreparation>[0]): Promise<ChatWritingStyleResult> {
        return this.prepareWritingStyleForScene(inferWritingScene(prompt, parentScene), budget);
    }

    private async prepareWritingStyleForScene(scene: Parameters<WritingStyleService['prepare']>[0],
        budget: Parameters<WritingStyleService['prepare']>[1]): Promise<ChatWritingStyleResult> {
        if (this.deviceMemoryCacheRefreshPromise) await this.deviceMemoryCacheRefreshPromise;
        const service = this.getWritingStyleService();
        if (!service) return { context: '', revisionIds: [], isCurrent: () => true };
        return service.prepare(scene, budget);
    }

    private async verifyWritingRecoveryNote(
        ref: PersistedSourceRef,
        memory: boolean,
        expectedRevision?: { mtime: number; size: number },
    ): Promise<WritingRecoverySourceReceipt> {
        const isPathAllowed = (path: string) => memory
            ? this.settings.memoryEnabled === true && this.isMemoryProviderPathAllowed(path)
            : this.isDataBoundaryAllowedPath(path);
        const source = await this.captureLatestMemorySource(ref.path, isPathAllowed, 'chat');
        if (!source || expectedRevision
            && (source.mtime !== expectedRevision.mtime || source.size !== expectedRevision.size)) {
            throw new Error('Writing source unavailable');
        }
        // Generic PersistedSourceRef hashes have no uniform body/algorithm
        // contract (some hash a path or a summary). Snapshot task revisions use
        // exact stat fields; image and parent bodies have dedicated hashes.
        const file = this.app.vault.getAbstractFileByPath(source.path);
        if (!(file instanceof TFile)) throw new Error('Writing source unavailable');
        const ctime = file.stat.ctime;
        return { isCurrent: () => !this.unloading
            && this.app.vault.getAbstractFileByPath(source.path) === file && file.path === source.path
            && file.stat.ctime === ctime && file.stat.mtime === source.mtime && file.stat.size === source.size
            && (!expectedRevision || file.stat.mtime === expectedRevision.mtime
                && file.stat.size === expectedRevision.size)
            && isPathAllowed(source.path)
            && this.getLatestMemoryContentBoundary(source.path, source.markdown, 'chat')?.allowed === true };
    }

    private verifyWritingRecoveryCanvas(
        path: string,
        expectedRevision: { mtime: number; size: number },
    ): WritingRecoverySourceReceipt {
        if (normalizeSnapshotPath(path) !== path || !path.toLowerCase().endsWith('.canvas')) {
            throw new Error('Writing Canvas source unavailable');
        }
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'canvas'
            || file.stat.mtime !== expectedRevision.mtime || file.stat.size !== expectedRevision.size
            || !this.isDataBoundaryAllowedPath(path)) {
            throw new Error('Writing Canvas source unavailable');
        }
        const ctime = file.stat.ctime;
        const isCurrent = () => !this.unloading
            && this.app.vault.getAbstractFileByPath(path) === file && file.path === path
            && file.stat.ctime === ctime && file.stat.mtime === expectedRevision.mtime
            && file.stat.size === expectedRevision.size && this.isDataBoundaryAllowedPath(path);
        return { isCurrent };
    }

    private async verifyWritingRecoveryPageletNote(
        snapshot: { path: string; mtime: number; size: number },
    ): Promise<WritingRecoverySourceReceipt> {
        if (normalizeSnapshotPath(snapshot.path) !== snapshot.path) {
            throw new Error('Writing Pagelet source unavailable');
        }
        const source = await this.captureLatestMemorySource(
            snapshot.path,
            path => this.isPageletProviderPathAllowed(path),
            'pagelet',
        );
        if (!source || source.mtime !== snapshot.mtime || source.size !== snapshot.size) {
            throw new Error('Writing Pagelet source unavailable');
        }
        const file = this.app.vault.getAbstractFileByPath(source.path);
        if (!(file instanceof TFile)) throw new Error('Writing Pagelet source unavailable');
        const ctime = file.stat.ctime;
        const isCurrent = () => !this.unloading
            && this.app.vault.getAbstractFileByPath(source.path) === file && file.path === source.path
            && file.stat.ctime === ctime && file.stat.mtime === source.mtime && file.stat.size === source.size
            && this.isPageletProviderSourceAllowedFile(file, source.markdown);
        return { isCurrent };
    }

    private writingRecoveryPersonalSourceCurrent(
        source: Extract<WritingRecoveryGenerationSource, { kind: 'personal' }>['source'],
    ): boolean {
        if (this.unloading || this.settings.memoryEnabled !== true) return false;
        if (source.state === 'unknown') {
            return this.getMemoryGovernanceUiMode() === (source.mode === 'governed' ? 'effect_based' : 'legacy_threshold');
        }
        const snapshot = this.getGovernedMemoryProjectionSnapshot();
        if (!snapshot || snapshot.state.commitSequence < this.deviceMemoryCacheRefreshTargetSequence) return false;
        const boundary = this.getMemoryDataBoundaryFingerprint();
        return source.revisions.every(({ claimId, revisionId }) => {
            const claims = snapshot.state.claims.filter(candidate => candidate.id === claimId);
            const revisions = snapshot.state.revisions.filter(candidate => candidate.id === revisionId
                && candidate.claimId === claimId);
            if (claims.length !== 1 || revisions.length !== 1) return false;
            const claim = claims[0], revision = revisions[0];
            let currentScope: { notePath?: string; folderPath?: string; tags: string[] } = { tags: [] };
            const paths = claim.applicability.paths ?? [];
            if (claim.applicability.kind === 'current_note' || claim.applicability.kind === 'selected_notes') {
                currentScope = { notePath: paths[0], tags: [] };
            } else if (claim.applicability.kind === 'folder') {
                currentScope = { folderPath: paths[0], tags: [] };
            } else if (claim.applicability.kind === 'tag') {
                currentScope = { tags: claim.applicability.tags?.slice(0, 1) ?? [] };
            }
            try {
                const selected = selectGovernedMemoryUse({
                    vaultScopeKey: snapshot.vaultScopeKey,
                    currentScope,
                    claims: [claim],
                    revisions: [revision],
                    suppressionMarkers: snapshot.state.suppressionMarkers,
                    pendingOperations: snapshot.state.pendingOperations.filter(operation => operation.claimId === claim.id),
                    claimSuppressionFingerprints: this.buildClaimSuppressionFingerprints(
                        snapshot.state.projectionLinks.filter(link => link.claimId === claim.id),
                    ),
                    includeVaultInsights: false,
                    vaultInsights: null,
                    currentDataBoundaryFingerprint: boundary,
                    dataBoundaryAllowed: candidate => this.isGovernedMemoryRevisionAllowed(candidate, boundary),
                });
                return claim.activeRevisionId === revision.id && selected.usedClaimIds.length === 1
                    && selected.usedClaimIds[0] === claim.id;
            } catch {
                return false;
            }
        });
    }

    private async verifyWritingRecoveryGenerationSource(
        input: WritingRecoveryGenerationSource,
    ): Promise<WritingRecoverySourceReceipt> {
        if (input.kind === 'task') {
            const source = input.source;
            if (source.kind === 'web-source' || source.boundary === 'web') {
                const isCurrent = () => !this.unloading && this.settings.webSearchEnabled === true;
                if (!isCurrent()) throw new Error('Writing web source unavailable');
                return { isCurrent };
            }
            const memory = source.kind === 'memory-reference' || source.boundary === 'memory';
            const path = source.revision.path;
            if (path && source.boundary !== 'skill-context') {
                if (!memory && source.kind === 'context-used' && source.boundary === 'read-only-tool'
                    && source.capabilityName === 'read_canvas_summary' && source.revision.state === 'identified') {
                    return this.verifyWritingRecoveryCanvas(path, source.revision);
                }
                return this.verifyWritingRecoveryNote({ path }, memory,
                    source.revision.state === 'identified'
                        ? { mtime: source.revision.mtime, size: source.revision.size } : undefined);
            }
            const isCurrent = () => !this.unloading && (!memory || this.settings.memoryEnabled === true);
            if (!isCurrent()) throw new Error('Writing task source unavailable');
            return { isCurrent };
        }
        if (input.kind === 'personal') {
            if (this.deviceMemoryCacheRefreshPromise) await this.deviceMemoryCacheRefreshPromise;
            const isCurrent = () => this.writingRecoveryPersonalSourceCurrent(input.source);
            if (!isCurrent()) throw new Error('Writing Personal source unavailable');
            return { isCurrent };
        }
        if (input.kind === 'insights') {
            const expectedMode = input.source.state === 'unknown' && input.source.mode === 'governed'
                ? 'effect_based' : 'legacy_threshold';
            const scope = this.getLegacyProfileScope();
            const boundary = this.getMemoryDataBoundaryFingerprint();
            const isCurrent = () => !this.unloading && this.canRunMemoryExtractionRuntime()
                && this.hasConfirmedMemoryExtractionConsent()
                && this.settings.memoryExtractionIncludeVaultInsights === true
                && this.getMemoryGovernanceUiMode() === expectedMode
                && this.getLegacyProfileScope() === scope
                && this.getMemoryDataBoundaryFingerprint() === boundary;
            if (!isCurrent()) throw new Error('Writing Insights source unavailable');
            return { isCurrent };
        }
        if (input.kind === 'style') {
            if (input.source.state === 'unknown') {
                const isCurrent = () => !this.unloading && this.settings.memoryEnabled === true
                    && this.getMemoryGovernanceUiMode() === 'effect_based';
                if (!isCurrent()) throw new Error('Writing style source unavailable');
                return { isCurrent };
            }
            if (this.deviceMemoryCacheRefreshPromise) await this.deviceMemoryCacheRefreshPromise;
            const service = this.getWritingStyleService();
            if (!service) throw new Error('Writing style source unavailable');
            return service.captureGenerationSourceValidity(input.source.revisionIds);
        }
        const snapshots = [input.source.anchor, ...input.source.sources];
        const pageletCurrent = () => !this.unloading && this.settings.pagelet.enabled === true
            && input.source.pipelineVersion === PAGELET_DEEP_DISCOVER_PIPELINE_VERSION;
        if (!pageletCurrent()) throw new Error('Writing Pagelet source unavailable');
        const receipts = await Promise.all(snapshots.map(snapshot => this.verifyWritingRecoveryPageletNote(snapshot)));
        const isCurrent = () => pageletCurrent() && receipts.every(receipt => receipt.isCurrent());
        if (!isCurrent()) throw new Error('Writing Pagelet source unavailable');
        return { isCurrent };
    }

    private prepareWritingRecoverySources(
        recovery: ChatWritingRecovery,
        images: readonly MessageImage[],
        conversationId: string,
        metadata?: ChatTurnMemoryMetadata,
    ) {
        return this.chatIntegration.prepareWritingRecoverySources(
            recovery,
            images,
            conversationId,
            metadata,
        );
    }

    private openQuickCaptureModal(): void {
        this.quickCaptureIntegration.openModal();
    }

    private createChatHost(): ChatHost {
        return this.chatIntegration.createChatHost();
    }

    private unavailableMemoryPlan() {
        return {
            reason: "unavailable" as const,
            action: "none" as const,
            notesToCheck: 0,
            requiresApproval: false,
            canAnswerNow: true,
        };
    }

    private getPageletRateLimiter(): PageletRateLimiter {
        return this.retainedReviewIntegration.getRateLimiter();
    }

    private getScopeRecapRateLimiter(): PageletRateLimiter {
        return this.scopeRecapIntegration.getRateLimiter();
    }

    private getQuietRecallRateLimiter(): PageletRateLimiter {
        return this.quietRecallIntegration.getRateLimiter();
    }

    private getDeepDiscoverRateLimiter(): PageletRateLimiter {
        return this.deepDiscoverIntegration.getRateLimiter();
    }

    private async runPageletDeepDiscover(
        input: PageletDeepDiscoverControllerRequest,
    ): Promise<PageletDeepDiscoverControllerResult> {
        return this.deepDiscoverIntegration.runPageletDeepDiscover(input);
    }

    private syncPageletDeepDiscoverControllerIdentity(): void {
        this.deepDiscoverIntegration.syncControllerIdentity();
    }

    private resetDeepDiscoverController(): void {
        this.deepDiscoverIntegration.resetForFeatureDisable();
    }

    private async getOrCreatePageletDeepDiscoverScheduler(): Promise<PageletDeepDiscoverScheduler | null> {
        return this.deepDiscoverIntegration.getOrCreateScheduler();
    }

    private async createPageletDeepDiscoverScheduler(
        expectedPolicyIdentity: string,
        controllerEpoch: number,
    ): Promise<PageletDeepDiscoverScheduler | null> {
        return this.deepDiscoverIntegration.createScheduler(expectedPolicyIdentity, controllerEpoch);
    }

    private async loadPageletDeepDiscoverWebCapabilities(
        aiUtils: AIUtils,
        host: AiServiceHost,
        runtimePlatform: AgentRuntimePlatform,
    ): Promise<AgentCapability[]> {
        return this.deepDiscoverIntegration.loadWebCapabilities(aiUtils, host, runtimePlatform);
    }

    private pageletDeepDiscoverQwenRequestOptions(
        settings: AiServiceHost["settings"],
    ): QwenRequestOptions | undefined {
        return this.deepDiscoverIntegration.qwenRequestOptions(settings);
    }

    private async getPageletDeepDiscoverFunctionCallingCapability(): Promise<
        "supported" | "unsupported" | "unknown"
    > {
        return this.deepDiscoverIntegration.getFunctionCallingCapability();
    }

    private createPageletDeepDiscoverChatModel(
        aiUtils: Pick<AIUtils, "createChatModel">,
        settings: AiServiceHost["settings"],
        qwenRequestOptions: QwenRequestOptions | undefined,
        temperature: number,
        options: Record<string, unknown>,
    ) {
        return this.deepDiscoverIntegration.createChatModel(
            aiUtils,
            settings,
            qwenRequestOptions,
            temperature,
            options,
        );
    }

    private async capturePageletDeepDiscoverAnchorSnapshot(
        host: AiServiceHost,
        path: string,
        isPathAllowed: (path: string) => boolean,
        signal?: AbortSignal,
    ): Promise<PageletAnchorSnapshot | null> {
        return this.deepDiscoverIntegration.captureAnchorSnapshot(host, path, isPathAllowed, signal);
    }

    private async capturePageletDeepDiscoverSourceMaterial(
        host: AiServiceHost,
        path: string,
        isPathAllowed: (path: string) => boolean,
        signal?: AbortSignal,
    ): Promise<PageletAgentSourceMaterial | null> {
        return this.deepDiscoverIntegration.captureSourceMaterial(host, path, isPathAllowed, signal);
    }

    private getPageletDeepDiscoverPolicyIdentity(): PageletAgentPolicyIdentity {
        return this.deepDiscoverIntegration.getPolicyIdentity();
    }

    private pageletDeepDiscoverPolicyIdentityKey(): string {
        return this.deepDiscoverIntegration.getPolicyIdentityKey();
    }

    private isPageletDeepDiscoverCommitSealCurrent(
        seal: PageletDeepDiscoverCommitSeal,
        collection: PageletAgentVerifiedInsightCollection,
    ): boolean {
        return this.deepDiscoverIntegration.isCommitSealCurrent(seal, collection);
    }

    private async admitPageletDeepDiscoverRun(
        expectedPolicyIdentity: string,
        input: Parameters<DeepDiscoverPluginIntegration["admitRun"]>[1],
    ): Promise<{ ok: true } | { ok: false; reason: "limit" | "unavailable" }> {
        return this.deepDiscoverIntegration.admitRun(expectedPolicyIdentity, input);
    }

    private pageletDeepDiscoverAdmissionIsCurrent(
        expectedPolicyIdentity: string,
        input: Parameters<DeepDiscoverPluginIntegration["admissionIsCurrent"]>[1],
    ): boolean {
        return this.deepDiscoverIntegration.admissionIsCurrent(expectedPolicyIdentity, input);
    }

    private getPageletDeepDiscoverAnchorRelations(path: string): {
        explicitLinks: string[];
        backlinks: string[];
    } {
        return this.deepDiscoverIntegration.getAnchorRelations(path);
    }

    private isPageletDeepDiscoverDeliverySeen(input: Parameters<DeepDiscoverPluginIntegration["isDeliverySeen"]>[0]): boolean {
        return this.deepDiscoverIntegration.isDeliverySeen(input);
    }

    private handlePageletDeepDiscoverResult(
        result: PageletDeepDiscoverControllerResult,
        request: PageletDeepDiscoverControllerRequest,
    ): void {
        this.deepDiscoverIntegration.handleResult(result, request);
    }

    async getDeepDiscoverUsage(): Promise<{
        runs: number;
        dailyCap: number;
        modelTurns: number;
        toolCalls: number;
    }> {
        return this.deepDiscoverIntegration.getDeepDiscoverUsage();
    }

    private async recordDeepDiscoverUsageMetrics(metrics: {
        modelTurns?: number;
        toolCalls?: number;
    }): Promise<void> {
        return this.deepDiscoverIntegration.recordUsageMetrics(metrics);
    }

    private readDeepDiscoverUsageMetrics(dailyResetAt: number): {
        modelTurns: number;
        toolCalls: number;
    } {
        return this.deepDiscoverIntegration.readUsageMetrics(dailyResetAt);
    }

    private deepDiscoverUsageStorageKey(): string | null {
        return this.deepDiscoverIntegration.usageStorageKey();
    }

    private getPageletProviderCallAdmission(): PageletProviderCallAdmission {
        if (!this.pageletProviderCallAdmissionInstance) {
            this.pageletProviderCallAdmissionInstance = new PageletProviderCallAdmission({
                isFirstUseNotified: () => (
                    this.settings.pagelet.pageletProviderFirstUseNotified === true
                ),
                markFirstUseNotified: () => {
                    if (this.settings.pagelet.pageletProviderFirstUseNotified) return;
                    this.settings.pagelet.pageletProviderFirstUseNotified = true;
                    void Promise.resolve(this.saveSettings()).catch((error) => {
                        this.log("Pagelet provider first-use state persistence failed", error);
                    });
                },
                showStandardFirstUseNotice: () => {
                    const provider = this.getScopeRecapProviderInfo().provider;
                    new Notice(pageletT(
                        "pagelet.provider.firstUseNotification",
                        this.getPageletLocale(),
                        { provider },
                    ), 6000);
                },
            });
        }
        return this.pageletProviderCallAdmissionInstance;
    }

    private requestForegroundReviewHighRiskDecision(
        summary: PageletReviewHighRiskSummary,
        signal?: AbortSignal,
    ) {
        return requestPageletReviewHighRiskDecision(
            this.app,
            summary,
            this.getPageletLocale(),
            signal,
        );
    }

    private async getPageletFeatureRateLimitStatus() {
        const [scopeRecap, quietRecall] = await Promise.all([
            this.scopeRecapIntegration.getFeatureRateSnapshot(),
            this.quietRecallIntegration.getFeatureRateSnapshot(),
        ]);
        return {
            scopeRecap,
            quietRecall,
        };
    }

    private getQuietRecallEvaluationCoordinator(): QuietRecallEvaluationCoordinator {
        return this.quietRecallIntegration.getEvaluationCoordinator();
    }

    private createPageletRateLimitStorage(
        bucket: "foreground-review" | "scope-recap" | "quiet-recall" | "deep-discover",
        vaultStorageScope: string | null = this.pageletVaultStorageScope(),
    ): PageletRateLimitStorage {
        const key = this.pageletRateLimitStorageKey(bucket, vaultStorageScope);
        const failClosed = bucket !== "foreground-review";
        return {
            load: (): PageletRateLimitState | null => {
                if (failClosed) {
                    if (!vaultStorageScope) {
                        throw new Error(`${bucket} rate-limit vault identity unavailable`);
                    }
                    const storage = getPlatformLocalStorage();
                    if (!storage) throw new Error(`${bucket} rate-limit storage unavailable`);
                    const raw = storage.getItem(key);
                    if (raw === null) return null;
                    const parsed = JSON.parse(raw) as Partial<PageletRateLimitState> | null;
                    if (
                        !parsed
                        || typeof parsed !== "object"
                        || !Array.isArray(parsed.hourlyTimestamps)
                        || !parsed.hourlyTimestamps.every((value) => (
                            typeof value === "number"
                            && Number.isFinite(value)
                            && Number.isInteger(value)
                            && value >= 0
                        ))
                        || typeof parsed.dailyCount !== "number"
                        || !Number.isFinite(parsed.dailyCount)
                        || !Number.isInteger(parsed.dailyCount)
                        || parsed.dailyCount < 0
                        || typeof parsed.dailyResetAt !== "number"
                        || !Number.isFinite(parsed.dailyResetAt)
                        || !Number.isInteger(parsed.dailyResetAt)
                        || parsed.dailyResetAt <= 0
                    ) {
                        throw new Error(`${bucket} rate-limit state is malformed`);
                    }
                    return parsed as PageletRateLimitState;
                }
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
                if (failClosed) {
                    if (!vaultStorageScope) {
                        throw new Error(`${bucket} rate-limit vault identity unavailable`);
                    }
                    const storage = getPlatformLocalStorage();
                    if (!storage) throw new Error(`${bucket} rate-limit storage unavailable`);
                    storage.setItem(key, JSON.stringify(state));
                    return;
                }
                try {
                    getPlatformLocalStorage()?.setItem(key, JSON.stringify(state));
                } catch {
                    /* localStorage unavailable — PageletRateLimiter will still gate within this call. */
                }
            },
        };
    }

    private pageletRateLimitStorageKey(
        bucket: "foreground-review" | "scope-recap" | "quiet-recall" | "background-review" | "deep-discover",
        vaultStorageScope: string | null = this.pageletVaultStorageScope(),
    ): string {
        return [
            PAGELET_RATE_LIMIT_STORAGE_KEY_PREFIX,
            bucket,
            vaultStorageScope ?? "unavailable",
        ].join(":");
    }

    private createPageletAttentionStorage(): import("./pagelet/attention").PageletAttentionStorage | undefined {
        const vaultStorageScope = this.pageletVaultStorageScope();
        if (!vaultStorageScope) return undefined;
        const key = [PAGELET_ATTENTION_STORAGE_KEY_PREFIX, "v1", vaultStorageScope].join(":");
        return {
            load: (): string | null => {
                const storage = getPlatformLocalStorage();
                if (!storage) throw new Error("Pagelet attention storage unavailable");
                return storage.getItem(key);
            },
            save: (serialized: string): void => {
                const storage = getPlatformLocalStorage();
                if (!storage) throw new Error("Pagelet attention storage unavailable");
                storage.setItem(key, serialized);
            },
        };
    }

    /** Stable device-local identity prevents same-name vaults sharing quotas or watermarks. */
    private pageletVaultStorageScope(): string | null {
        const vault = this.app.vault;
        const adapter = vault.adapter as {
            getBasePath?: () => string;
            getFullPath?: (path: string) => string;
        };
        let localPath: string | undefined;
        try {
            if (typeof adapter.getBasePath === "function") {
                localPath = adapter.getBasePath();
            } else if (typeof adapter.getFullPath === "function") {
                localPath = adapter.getFullPath("");
            }
        } catch {
            return null;
        }
        if (!localPath?.trim()) return null;
        const vaultName = typeof vault.getName === "function" ? vault.getName() : "vault";
        return stableHash([
            vaultName,
            getVaultConfigDirStorageScope(vault),
            localPath,
        ].join("\n"));
    }

    private async reservePageletRateLimitSlot(
        revalidate?: () => boolean | PromiseLike<boolean>,
    ): Promise<PageletProviderCallReservation> {
        const limiter = this.getPageletRateLimiter();
        const decision = revalidate
            ? await limiter.reserveLeaseIf(revalidate)
            : await limiter.reserveLeaseIf(() => true);
        if (decision.ok) return decision.reservation;
        if (decision.reason === "condition") {
            throw new Error("pagelet_provider_call_stale");
        }
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
        return this.pageletIntegration.getOrCreateRuntime();
    }

    private async readPageletNoteContents(
        files: TFile[],
        inputTokenBudget: number,
    ): Promise<Array<{ path: string; content: string; mtime: number; size: number }>> {
        return this.retainedReviewIntegration.readNoteContents(files, inputTokenBudget);
    }

    private capturePageletSourceSnapshots(
        notes: readonly { path: string; mtime?: number; size?: number }[],
    ): Array<{ path: string; mtime: number; size: number }> | null {
        return this.retainedReviewIntegration.captureSourceSnapshots(notes);
    }

    private pageletSourceSnapshotsAreCurrent(
        snapshots: readonly { path: string; mtime: number; size: number }[],
        requiredActivePath?: string,
    ): boolean {
        return this.retainedReviewIntegration.sourceSnapshotsAreCurrent(
            snapshots,
            requiredActivePath,
        );
    }

    private async findPageletRelatedNotes(
        primarySourcePath: string,
        noteContents: Array<{ path: string; content: string }>,
        sourcePaths: readonly string[],
        options: {
            limit?: number;
            requireActivePrimary?: boolean;
            reserveProviderCall?: () =>
                | boolean
                | PageletProviderCallReservation
                | PromiseLike<boolean | PageletProviderCallReservation>;
            additionalCurrentCheck?: () => boolean;
            onProviderInvoke?: () => void;
            onSearchOutcome?: (outcome: "completed" | "failed") => void;
            executeProviderCall?: <TResult>(
                invoke: () => Promise<TResult>,
                options: { signal: AbortSignal },
            ) => Promise<TResult>;
        } = {},
    ): Promise<Array<{
        path: string;
        content: string;
        score?: number;
        headingPath?: string[];
        mtime: number;
        size: number;
    }>> {
        if (!this.vss || noteContents.length === 0) return [];
        if (!this.isPageletProviderPathAllowed(primarySourcePath)) return [];
        const expectedProviderPolicyIdentity = this.getScopeRecapAuthorizationContextId();
        const limit = options.limit ?? PAGELET_DISCOVERY_MAX_RELATED_NOTES;
        const requireActivePrimary = options.requireActivePrimary ?? true;
        if (!(await this.isPageletMemorySearchReady())) return [];
        const excluded = new Set(sourcePaths.map((path) => normalizePath(path)));
        const normalizedPrimaryPath = normalizePath(primarySourcePath);
        const primaryFile = this.app.vault.getAbstractFileByPath(normalizedPrimaryPath);
        if (
            !(primaryFile instanceof TFile)
            || primaryFile.extension !== "md"
            || !this.isPageletProviderSourceAllowedFile(primaryFile)
        ) return [];
        const primarySnapshot = {
            mtime: primaryFile.stat.mtime,
            size: primaryFile.stat.size,
        };
        let primaryContent: string;
        try {
            primaryContent = await this.app.vault.cachedRead(primaryFile);
        } catch (error) {
            this.log("Pagelet related-note primary source read skipped", error);
            return [];
        }
        const currentPrimaryFile = this.app.vault.getAbstractFileByPath(normalizedPrimaryPath);
        if (
            !(currentPrimaryFile instanceof TFile)
            || currentPrimaryFile.extension !== "md"
            || currentPrimaryFile.stat.mtime !== primarySnapshot.mtime
            || currentPrimaryFile.stat.size !== primarySnapshot.size
            || !this.isPageletProviderSourceAllowedFile(currentPrimaryFile, primaryContent)
        ) return [];
        const primary = { path: currentPrimaryFile.path, content: primaryContent };
        const query = buildPageletRelatedNotesQuery(primary);
        if (!query.trim()) return [];
        const controller = new AbortController();
        const timeout = setPlatformTimeout(() => controller.abort(), PAGELET_RELATED_NOTES_TIMEOUT_MS);
        const requestIsCurrent = () => {
            const activeFile = this.app.workspace.getActiveFile();
            const currentPrimary = this.app.vault.getAbstractFileByPath(normalizedPrimaryPath);
            return !controller.signal.aborted
                && !this.unloading
                && this.settings.pagelet.enabled === true
                && expectedProviderPolicyIdentity === this.getScopeRecapAuthorizationContextId()
                && (options.additionalCurrentCheck?.() ?? true)
                && currentPrimary instanceof TFile
                && currentPrimary.extension === "md"
                && currentPrimary.stat.mtime === primarySnapshot.mtime
                && currentPrimary.stat.size === primarySnapshot.size
                && this.isPageletProviderSourceAllowedFile(currentPrimary)
                && (!requireActivePrimary || (
                    activeFile instanceof TFile
                    && normalizePath(activeFile.path) === normalizedPrimaryPath
                ));
        };
        try {
            const indexer = new ActiveVaultIndexer({
                searchHybrid: (searchQuery, searchOptions) =>
                    this.vss!.searchHybrid(searchQuery, searchOptions),
            });
            const result = await indexer.retrieveSemantic(query, {
                taskKind: "pagelet-related-notes",
                scope: "pagelet-current",
                excludedPaths: [...excluded],
                isPathAllowed: (path) => this.isPageletProviderPathAllowed(path),
                retrievalHabitProfile: this.settings.retrievalHabitProfile,
                ftsQueryOverride: null,
                signal: controller.signal,
                executeEmbeddingInvoke: async (invoke) => {
                    if (!requestIsCurrent()) throw new Error("pagelet_related_notes_request_stale");
                    if (options.executeProviderCall) {
                        return options.executeProviderCall(
                            () => {
                                options.onProviderInvoke?.();
                                return invoke();
                            },
                            { signal: controller.signal },
                        );
                    }
                    return this.getPageletProviderCallAdmission().executeStandardCall(
                        () => {
                            options.onProviderInvoke?.();
                            return invoke();
                        },
                        {
                            revalidate: requestIsCurrent,
                            reserve: options.reserveProviderCall
                                ?? (() => this.reservePageletRateLimitSlot(requestIsCurrent)),
                            signal: controller.signal,
                        },
                    );
                },
                canCacheEmbeddingResult: requestIsCurrent,
                limit: Math.max(1, Math.min(limit, QUIET_RECALL_MAX_VAULT_CANDIDATE_NOTES)),
            });
            if (!requestIsCurrent()) throw new Error("pagelet_related_notes_request_stale");
            options.onSearchOutcome?.("completed");
            const relatedNotes: Array<{
                path: string;
                content: string;
                score?: number;
                headingPath?: string[];
                mtime: number;
                size: number;
            }> = [];
            for (const entry of result.evidence) {
                const path = normalizePath(entry.path);
                const file = this.app.vault.getAbstractFileByPath(path);
                if (
                    !(file instanceof TFile)
                    || file.extension !== "md"
                    || !this.isPageletProviderSourceAllowedFile(file)
                ) continue;
                const snapshot = { mtime: file.stat.mtime, size: file.stat.size };
                try {
                    const content = await this.app.vault.cachedRead(file);
                    const current = this.app.vault.getAbstractFileByPath(path);
                    if (
                        !(current instanceof TFile)
                        || current.extension !== "md"
                        || current.stat.mtime !== snapshot.mtime
                        || current.stat.size !== snapshot.size
                        || !this.isPageletProviderSourceAllowedFile(current, content)
                    ) continue;
                    relatedNotes.push({
                        path: current.path,
                        content: content.slice(0, 1200),
                        score: entry.score,
                        headingPath: entry.headingPath,
                        mtime: snapshot.mtime,
                        size: snapshot.size,
                    });
                } catch (error) {
                    this.log("Pagelet related-note live source read skipped", { path, error });
                }
            }
            return relatedNotes;
        } catch (error) {
            options.onSearchOutcome?.("failed");
            if (error instanceof PageletProviderCallControlError) throw error;
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
        const expectedProviderPolicyIdentity = this.getScopeRecapAuthorizationContextId();
        const admittedProvider = this.settings.aiProvider;
        const admittedModel = this.settings.chatModelName;
        const liveSources = await this.readLivePageletDiscoverySources(
            currentNote.path,
            relatedNotes.map((note) => note.path),
        );
        if (!liveSources) return null;
        const discoveryLanguage = resolveOutputLanguage(
            this.settings.pagelet.outputLanguage,
            liveSources.currentNote.content,
        );
        const prompt = buildDiscoveryPrompt(liveSources.currentNote, liveSources.relatedNotes, {
            input: this.settings.pagelet.maxInputTokens,
            output: this.settings.pagelet.maxOutputTokens,
        }, discoveryLanguage);
        const model = await this.createChatModel(0.3, {
            maxTokens: prompt.maxOutputTokens,
        });
        if (!model) return null;
        const requestIsCurrent = () => (
            liveSources.isCurrent()
            && expectedProviderPolicyIdentity === this.getScopeRecapAuthorizationContextId()
        );
        if (!requestIsCurrent()) return null;
        try {
            const fullPrompt = prompt.systemPrompt + "\n\n" + prompt.userPrompt;
            const result = await this.getPageletProviderCallAdmission().executeStandardCall(() => (
                model.invoke(fullPrompt)
            ), {
                revalidate: requestIsCurrent,
                reserve: () => this.reservePageletRateLimitSlot(requestIsCurrent),
            });
            const text = coerceModelResultToString(result);
            const inputTokens = estimateTokens(fullPrompt);
            const outputTokens = estimateTokens(text);
            this.pageletCostTracker.record({
                inputTokens,
                outputTokens,
                provider: admittedProvider,
                model: admittedModel,
            });
            if (!requestIsCurrent()) return null;
            const parsed = parseStructuredResponse(text);
            return buildDiscoveryResultFromFindings(parsed.findings, currentNote.path, relatedNotes);
        } catch (error) {
            this.log("Discovery analysis failed", error);
            return null;
        }
    }

    private async readLivePageletDiscoverySources(
        currentPath: string,
        relatedPaths: readonly string[],
    ): Promise<{
        currentNote: { path: string; content: string };
        relatedNotes: Array<{ path: string; content: string }>;
        isCurrent: () => boolean;
    } | null> {
        const normalizedCurrentPath = normalizePath(currentPath);
        const normalizedRelatedPaths = [...new Set(relatedPaths.map((path) => normalizePath(path)))]
            .filter((path) => path && path !== normalizedCurrentPath);
        if (
            normalizedRelatedPaths.length === 0
            || normalizedRelatedPaths.length > PAGELET_DISCOVERY_MAX_RELATED_NOTES
        ) return null;
        const paths = [normalizedCurrentPath, ...normalizedRelatedPaths];
        const snapshots: Array<{ path: string; mtime: number; size: number; file: TFile }> = [];
        for (const path of paths) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (
                !(file instanceof TFile)
                || file.extension !== "md"
                || !this.isPageletProviderSourceAllowedFile(file)
            ) return null;
            snapshots.push({
                path: file.path,
                mtime: file.stat.mtime,
                size: file.stat.size,
                file,
            });
        }

        let contents: string[];
        try {
            contents = await Promise.all(snapshots.map(({ file }) => this.app.vault.cachedRead(file)));
        } catch (error) {
            this.log("Pagelet Discover live source read skipped", error);
            return null;
        }
        const isCurrent = () => {
            if (this.unloading || this.settings.pagelet.enabled !== true) return false;
            const activeFile = this.app.workspace.getActiveFile();
            if (
                !(activeFile instanceof TFile)
                || normalizePath(activeFile.path) !== normalizedCurrentPath
            ) return false;
            return snapshots.every((snapshot) => {
                const file = this.app.vault.getAbstractFileByPath(snapshot.path);
                return file instanceof TFile
                    && file.extension === "md"
                    && file.stat.mtime === snapshot.mtime
                    && file.stat.size === snapshot.size
                    && this.isPageletProviderSourceAllowedFile(file);
            });
        };
        if (!isCurrent()) return null;
        if (!snapshots.every((snapshot, index) => (
            this.isPageletProviderSourceAllowedFile(
                snapshot.file,
                contents[index] ?? "",
            )
        ))) return null;
        return {
            currentNote: { path: snapshots[0]!.path, content: contents[0] ?? "" },
            relatedNotes: snapshots.slice(1).map((snapshot, index) => ({
                path: snapshot.path,
                content: (contents[index + 1] ?? "").slice(0, 1200),
            })),
            isCurrent,
        };
    }

    private async writePageletReviewNote(note: GeneratedReviewNote): Promise<WriteResult> {
        return this.pageletActionIntegration.writeReviewNote(note);
    }

    private async savePageletSummaryNote(note: GeneratedReviewNote): Promise<WriteResult> {
        if (note.confirmationPrompt) {
            const confirmed = await confirmUserAction(this.app, note.confirmationPrompt);
            if (!confirmed) {
                return { success: false, error: pageletT("pagelet.summary.save.cancelled", this.getPageletLocale()) };
            }
        }
        return this.writePageletReviewNote(note);
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

    onunload(): void {
        void this.unloadAsync().catch((error) => {
            this.log("Error during plugin unload:", error);
        });
    }

    private async unloadAsync(): Promise<void> {
        this.unloading = true;
        this.agentDebugIntegration?.beginUnload();
        this.pageletIntegration.beginUnload();
        this.metadataUpdater.dispose();
        this.calloutIntegration.dispose();
        this.invalidateLegacyProfileContext();
        this.activeFeatureOptionsModal?.close();
        this.activeFeatureOptionsModal = null;
        this.retrievalDiagnostics?.clear();
        this.shareCardActions.closeAll();
        if (this.phase3Handle !== null) {
            clearPlatformTimeout(this.phase3Handle);
            this.phase3Handle = null;
        }
        this.memoryStatusNotifier.cancelPending();
        this.localGraphIntegration.disposeObserver();
        this.memoryIntegration.stopExtractionAdmission();
        this.memoryIntegration.stopMaintenance();
        await this.memoryIntegration.waitForMemoryIdle().catch((error) => {
            this.log("Failed to drain Memory maintenance during unload", error);
        });
        await this.drainSettingsWrites();
        await this.agentDebugIntegration?.dispose();
        await this.memoryIntegration.disposeVss().catch((error) => this.log("Failed to dispose Memory local index", error));
        this.statsIntegration.unloadStatistics();
        await this.chatIntegration.drainWriting();
        await this.chatIntegration.disposeImages();
        this.chatIntegration.releaseHistory();
        this.memoryIntegration.disposeExtractionResources();
        this.governanceActions.dispose();
        await this.governanceStorage.dispose();
        this.pageletSettingsUnsubscribe?.();
        this.pageletSettingsUnsubscribe = null;
        this.pageletIntegration.destroyUnloadedRuntime();
        if (this.operationsService) {
            try {
                this.operationsService.dispose();
            } catch (error) {
                this.log("Failed to dispose Operations service", error);
            }
            this.operationsService = null;
        }
        this.pageletIntegration.finishUnloadAfterSharedService();
        this.reviewQueueStore = null;
        this.savedInsightStore = null;
        this.memoryGovernanceStore = null;
        this.retrievalHabitProfileStore = null;
        this.quickCaptureIntegration.reset();
        clearPageletDetailSessionCache();
    }

    getMemoryExtractionPromptContext(): PaAgentInjectedContext {
        const governedSnapshot = this.getGovernedMemoryProjectionSnapshot();
        if (!governedSnapshot) return this.getLegacyMemoryExtractionPromptContext();
        if (this.settings.memoryEnabled !== true) {
            // Stopping new extraction does not revoke existing Personal.
            // Keep the master boundary and explicit mode so legacy fallback
            // cannot revive disabled context.
            return { memoryContextMode: "governed" };
        }

        const { state, vaultScopeKey } = governedSnapshot;
        const currentDataBoundaryFingerprint = this.getMemoryDataBoundaryFingerprint();
        const includeVaultInsights = this.canRunMemoryExtractionRuntime()
            && this.hasConfirmedMemoryExtractionConsent()
            && this.settings.memoryExtractionIncludeVaultInsights === true;
        try {
            const vaultInsights = this.readGovernedVaultInsightsSnapshot(includeVaultInsights);
            const governed = selectGovernedMemoryUse({
                vaultScopeKey,
                currentScope: this.getGovernedMemoryCurrentScope(),
                claims: state.claims,
                revisions: state.revisions,
                suppressionMarkers: state.suppressionMarkers,
                pendingOperations: state.pendingOperations,
                claimSuppressionFingerprints: this.buildClaimSuppressionFingerprints(
                    state.projectionLinks,
                ),
                includeVaultInsights,
                vaultInsights,
                currentDataBoundaryFingerprint,
                dataBoundaryAllowed: (revision) => this.isGovernedMemoryRevisionAllowed(
                    revision,
                    currentDataBoundaryFingerprint,
                ),
            });
            const insightsCurrent = governed.usedVaultInsights ? this.captureVaultInsightsSourceValidity() : undefined;
            const context: PaAgentInjectedContext = {
                memoryContextMode: "governed",
                ...(governed.boundedContext
                    ? { governedMemoryContext: governed.boundedContext }
                    : {}),
                ...(governed.usedClaimIds.length > 0 ? {
                    governedMemoryTrace: governed.usedClaimIds.flatMap((claimId) => {
                        const trace = this.buildGovernedMemoryTrace(state, claimId);
                        return trace ? [trace] : [];
                    }),
                } : {}),
            };
            if (!governed.boundedContext) return context;
            const selectedRevisionRefs = governed.usedClaimIds.flatMap(claimId => {
                const claim = state.claims.find(candidate => candidate.id === claimId);
                return claim?.activeRevisionId ? [{ claimId, revisionId: claim.activeRevisionId }] : [];
            });
            this.withGenerationInputSources(context, {
                personal: governed.usedClaimIds.length === 0
                    ? { state: 'none' }
                    : selectedRevisionRefs.length === governed.usedClaimIds.length
                        ? { state: 'identified', mode: 'governed', revisions: selectedRevisionRefs }
                        : { state: 'unknown', mode: 'governed' },
                insights: governed.usedVaultInsights
                    ? { state: 'unknown', mode: 'governed' }
                    : { state: 'none' },
            });
            const selectedSourceIdentity = (snapshot: DeviceMemoryGovernanceStateV1, claimId: string): string => {
                const claim = snapshot.claims.find(candidate => candidate.id === claimId);
                const links = snapshot.projectionLinks.filter(link => link.claimId === claimId);
                return JSON.stringify({
                    claim,
                    revision: snapshot.revisions.find(revision => revision.id === claim?.activeRevisionId && revision.claimId === claimId),
                    links,
                    pending: snapshot.pendingOperations.filter(operation => operation.claimId === claimId
                        && !(operation.kind === 'profile_projection' && operation.state === 'applied')),
                    suppressions: snapshot.suppressionMarkers.filter(marker => marker.partition.key === claim?.partition.key
                        && links.some(link => link.sourceFingerprintId === marker.sourceFingerprintId
                            && link.ruleFingerprint === marker.ruleFingerprint)),
                });
            };
            const selectedRevisions = governed.usedClaimIds.map(claimId => {
                const claim = state.claims.find(candidate => candidate.id === claimId);
                return {
                    claimId,
                    revisionId: claim?.activeRevisionId,
                    identity: selectedSourceIdentity(state, claimId),
                    eventIds: new Set(state.changeEvents.filter(event => event.claimId === claimId).map(event => event.id)),
                };
            });
            const scope = JSON.stringify(this.getGovernedMemoryCurrentScope());
            return this.withMemoryContextSourceGuard(context, () => {
                if (this.unloading || this.settings.memoryEnabled !== true
                    || this.getMemoryDataBoundaryFingerprint() !== currentDataBoundaryFingerprint
                    || JSON.stringify(this.getGovernedMemoryCurrentScope()) !== scope) return false;
                const latest = this.getGovernedMemoryProjectionSnapshot();
                if (!latest || latest.vaultScopeKey !== vaultScopeKey) return false;
                if (insightsCurrent && !insightsCurrent()) return false;
                return selectedRevisions.every(({ claimId, revisionId, identity, eventIds }) => {
                    const claim = latest.state.claims.find(candidate => candidate.id === claimId);
                    const revision = latest.state.revisions.find(candidate => candidate.id === revisionId && candidate.claimId === claimId);
                    return selectedSourceIdentity(latest.state, claimId) === identity
                        // New events distinguish same-text Pause/Resume or Undo,
                        // including equal timestamps. Expiry of old history is harmless.
                        && latest.state.changeEvents.every(event => event.claimId !== claimId || eventIds.has(event.id))
                        && claim?.lifecycle === 'active' && claim.activeRevisionId === revisionId && !!revision
                        && this.isGovernedMemoryRevisionAllowed(revision, currentDataBoundaryFingerprint);
                });
            });
        } catch {
            // Once cut over, selector failure must not revive a legacy source.
            // The explicit mode also prevents projector fallback on an empty result.
            this.log("Governed Memory prompt projection unavailable", {
                code: "governed_projection_failed",
            });
            return { memoryContextMode: "governed" };
        }
    }

    private buildGovernedMemoryTrace(
        state: DeviceMemoryGovernanceStateV1,
        claimId: string,
    ): NonNullable<PaAgentInjectedContext["governedMemoryTrace"]>[number] | null {
        const claim = state.claims.find((candidate) => candidate.id === claimId);
        if (!claim || (claim.effect !== "future_answers" && claim.effect !== "collaboration_default")) {
            return null;
        }
        const revision = claim.activeRevisionId
            ? state.revisions.find((candidate) => (
                candidate.id === claim.activeRevisionId && candidate.claimId === claim.id
            ))
            : undefined;
        if (!revision) return null;
        const sourcePaths: string[] = [];
        let hasNotes = false;
        let hasInteractions = false;
        let hasSettings = false;
        for (const provenance of revision.provenance) {
            if (provenance.kind === "note") {
                hasNotes = true;
                sourcePaths.push(provenance.sourceRef.path);
            } else if (provenance.kind === "vault_aggregate") {
                hasNotes = true;
                sourcePaths.push(...provenance.representativeSourceRefs.map((source) => source.path));
            } else if (provenance.kind === "conversation") {
                hasInteractions = true;
            } else if (provenance.kind === "explicit_setting") {
                hasSettings = true;
            }
        }
        const source = hasNotes && (hasInteractions || hasSettings)
            || hasInteractions && hasSettings
            ? "mixed" as const
            : hasNotes
                ? "notes" as const
                : hasInteractions
                    ? "interactions" as const
                    : "settings" as const;
        return {
            claimId,
            effect: claim.effect,
            source,
            scope: claim.partition.kind === "device_collaboration"
                ? "same_device"
                : "current_vault",
            sourcePaths: [...new Set(sourcePaths)],
        };
    }

    private getLegacyProfileScope(): string {
        return getUserProfileDbName(this.app.vault, this.settings.statisticsVaultId || 'default-vault',
            this.manifest?.id ?? 'personal-assistant');
    }

    private captureMemoryManagementLegacySourceValidity(): (() => boolean) | null {
        // Governed records use commitSequence admission. Only a legacy Control
        // Center source needs the host's non-serializable legacy source receipt.
        if (this.getGovernedMemoryProjectionSnapshot()
            || this.getMemoryGovernanceUiMode() !== "legacy_threshold") return null;
        const sourceIdentity = this.legacyProfileSourceIdentity;
        const mutationCount = this.legacyProfileMutationCount;
        const scope = this.getLegacyProfileScope();
        const boundary = this.getMemoryDataBoundaryFingerprint();
        const originalSnapshot = this.memoryExtractionScheduler?.getUserProfileSnapshot?.()
            ?? this.legacyProfileContext?.snapshot;
        const originalProfileIdentity = originalSnapshot
            ? JSON.stringify(originalSnapshot.records) : undefined;
        return () => {
            if (this.unloading
                || this.legacyProfileSourceIdentity !== sourceIdentity
                || this.legacyProfileMutationCount !== mutationCount
                || this.getLegacyProfileScope() !== scope
                || this.getMemoryDataBoundaryFingerprint() !== boundary
                || this.getGovernedMemoryProjectionSnapshot()) return false;
            if (originalProfileIdentity === undefined) return true;
            const latestSnapshot = this.memoryExtractionScheduler?.getUserProfileSnapshot?.()
                ?? this.legacyProfileContext?.snapshot;
            if (latestSnapshot === undefined) {
                return this.legacyProfileRead?.scope === scope;
            }
            return (latestSnapshot ? JSON.stringify(latestSnapshot.records) : undefined)
                === originalProfileIdentity;
        };
    }

    private withMemoryContextSourceGuard(context: PaAgentInjectedContext, guard: () => boolean): PaAgentInjectedContext {
        // Keep a callable host receipt without copying it into ordinary metadata
        // spreads or serializable prompt/history objects.
        Object.defineProperty(context, 'isSourceCurrent', { value: () => {
            try { return guard(); } catch { return false; }
        } });
        return context;
    }

    private withGenerationInputSources(
        context: PaAgentInjectedContext,
        sources: NonNullable<PaAgentInjectedContext['generationInputSources']>,
    ): PaAgentInjectedContext {
        Object.defineProperty(context, 'generationInputSources', { value: sources });
        return context;
    }

    private invalidateLegacyProfileContext(): void {
        this.memoryIntegration.invalidateLegacyProfileContext();
    }

    private async refreshLegacyProfileContext(): Promise<void> {
        await this.memoryIntegration.refreshLegacyProfileContext();
    }

    private getLegacyMemoryExtractionPromptContext(): PaAgentInjectedContext {
        return this.memoryIntegration.getLegacyPromptContext(this.canRunMemoryExtractionRuntime());
    }

    private getGovernedMemoryProjectionSnapshot(): {
        state: DeviceMemoryGovernanceStateV1;
        vaultScopeKey: string;
    } | null {
        if (this.memoryGovernanceBootstrapState !== "ready") return null;
        const state = this.currentDeviceMemoryGovernanceState;
        const vaultScopeKey = this.memoryGovernanceOpaqueVaultKey;
        const sourceHash = this.memoryGovernanceSourceHash;
        if (!state || !vaultScopeKey || !sourceHash) return null;

        const migration = state.migrationStates[vaultScopeKey];
        const policy = state.policyStates[vaultScopeKey];
        if (!migration
            || (migration.phase !== "compatibility" && migration.phase !== "finalized"
                && migration.phase !== "governed_preserving_legacy")
            || migration.sourceHash !== sourceHash
            || migration.lastErrorCode
            || !policy
            || policy.mode !== "effect_based"
            || policy.contextProjectionMode !== "governed") return null;
        return { state, vaultScopeKey };
    }

    getMemoryGovernanceUiMode(): "effect_based" | "legacy_threshold" | "unavailable" {
        if (this.getGovernedMemoryProjectionSnapshot()) return "effect_based";
        if (this.memoryGovernanceBootstrapState !== "ready") return "unavailable";
        const state = this.currentDeviceMemoryGovernanceState;
        const vaultKey = this.memoryGovernanceOpaqueVaultKey;
        if (!state || !vaultKey) return "unavailable";
        const policy = state.policyStates[vaultKey];
        const migration = state.migrationStates[vaultKey];
        return policy?.mode === "legacy_threshold"
            && policy.contextProjectionMode === "legacy"
            && migration?.phase !== "rolling_back"
            && !migration?.lastErrorCode
            ? "legacy_threshold"
            : "unavailable";
    }

    private getGovernedMemoryViewSnapshot() {
        const governed = this.getGovernedMemoryProjectionSnapshot();
        return governed
            ? buildGovernedMemoryViewSnapshot(governed.state, governed.vaultScopeKey)
            : null;
    }

    private projectGovernedMemoryUiEntry(
        entry: ReturnType<typeof buildGovernedMemoryViewSnapshot>["records"][number],
        state: DeviceMemoryGovernanceStateV1,
        overrides: Partial<Pick<
            GovernedMemoryUiGateInput,
            "runtimeUseEnabled" | "sourceEligible"
        >> = {},
    ): GovernedMemoryUiProjection {
        const claim = state.claims.find((candidate) => candidate.id === entry.claimId);
        const revision = claim?.activeRevisionId
            ? state.revisions.find((candidate) => (
                candidate.id === claim.activeRevisionId && candidate.claimId === claim.id
            ))
            : undefined;
        let sourceEligible = overrides.sourceEligible ?? false;
        if (overrides.sourceEligible === undefined && revision) {
            try {
                sourceEligible = this.isGovernedMemoryRevisionAllowed(
                    revision,
                    this.getMemoryDataBoundaryFingerprint(),
                );
            } catch {
                // Settings and Pagelet both fail closed during a boundary/cache race.
            }
        }
        const hasPendingOperation = state.pendingOperations.some((operation) => (
            operation.claimId === entry.claimId
            && (operation.kind === "forget" || operation.state === "pending")
        ));
        return projectGovernedMemoryUiState(entry, {
            runtimeUseEnabled: overrides.runtimeUseEnabled
                ?? (this.settings.memoryEnabled === true && this.getMemoryGovernanceUiMode() === 'effect_based'),
            sourceEligible,
            hasPendingOperation,
            coordinatorAvailable: Boolean(this.memoryGovernanceCoordinator),
        });
    }

    private getGovernedMemoryCurrentScope(): {
        notePath?: string;
        folderPath?: string;
        tags: string[];
    } {
        let activeFile: TFile | null = null;
        try {
            activeFile = this.app.workspace?.getActiveFile?.() ?? null;
        } catch {
            return { tags: [] };
        }
        if (!activeFile || typeof activeFile.path !== "string") return { tags: [] };
        const notePath = normalizePath(activeFile.path).replace(/^\.\//, "");
        if (!notePath) return { tags: [] };
        let tags: string[] = [];
        try {
            tags = this.getDataBoundaryTags(activeFile);
        } catch {
            // A metadata-cache race hides tag-scoped claims without affecting
            // otherwise eligible whole-vault or path-scoped siblings.
        }
        const folderPath = parentFolder(notePath);
        return {
            notePath,
            ...(folderPath ? { folderPath } : {}),
            tags,
        };
    }

    private buildClaimSuppressionFingerprints(
        links: readonly MemoryProjectionLink[],
    ): Readonly<Record<string, MemorySuppressionFingerprintRef | undefined>> {
        const byClaim = new Map<string, MemorySuppressionFingerprintRef | null>();
        for (const link of links) {
            if (link.state !== "active") continue;
            const sourceFingerprintId = link.sourceFingerprintId?.trim();
            const ruleFingerprint = link.ruleFingerprint?.trim();
            if (!sourceFingerprintId || !ruleFingerprint) continue;
            const prior = byClaim.get(link.claimId);
            if (prior === null) continue;
            if (prior && (
                prior.sourceFingerprintId !== sourceFingerprintId
                || prior.ruleFingerprint !== ruleFingerprint
            )) {
                byClaim.set(link.claimId, null);
                continue;
            }
            byClaim.set(link.claimId, { sourceFingerprintId, ruleFingerprint });
        }

        const result = Object.create(null) as Record<
            string,
            MemorySuppressionFingerprintRef | undefined
        >;
        for (const [claimId, fingerprint] of byClaim) {
            if (fingerprint) result[claimId] = fingerprint;
        }
        return result;
    }

    private readGovernedVaultInsightsSnapshot(
        enabled: boolean,
    ): VaultInsightsReadSnapshot | null {
        if (!enabled) return null;
        try {
            // Stale aggregates may remain available to the viewer while a
            // background refresh is pending. New Chat input uses only evidence
            // that is valid now, so omitted Insights cannot poison Personal.
            if (!this.captureVaultInsightsSourceValidity()()) return null;
            const snapshot = this.memoryExtractionScheduler?.getVaultInsightsSnapshot() ?? null;
            if (!snapshot) return null;
            return {
                snapshot: snapshot.snapshot,
                dataBoundaryFingerprint: snapshot.dataBoundaryFingerprint,
                representativeSourceRefs: snapshot.representativePaths.map((path) => ({
                    path,
                    generatedAt: snapshot.snapshot.generatedAt,
                })),
            };
        } catch {
            return null;
        }
    }

    private isGovernedMemoryRevisionAllowed(
        revision: MemoryClaimRevision,
        currentDataBoundaryFingerprint: string,
    ): boolean {
        if (!Array.isArray(revision.provenance) || revision.provenance.length === 0) return false;
        return revision.provenance.every((provenance) => {
            switch (provenance.kind) {
                case "note":
                    return this.isDataBoundaryAllowedPath(provenance.sourceRef.path);
                case "vault_aggregate":
                    return provenance.dataBoundaryFingerprint === currentDataBoundaryFingerprint
                        && provenance.representativeSourceRefs.every(
                            (sourceRef) => this.isDataBoundaryAllowedPath(sourceRef.path),
                        );
                case "conversation":
                case "explicit_setting":
                case "host_user_request":
                    return true;
                default:
                    return false;
            }
        });
    }

    async getMemoryControlCenterSnapshot(): Promise<MemoryControlCenterSnapshot> {
        const sourceErrors: MemoryControlCenterSourceError[] = [];
        const noteStatus = this.memoryManager?.getStatusSnapshot() ?? {
            enabled: this.settings.memoryEnabled === true,
            status: this.settings.memoryEnabled === true ? "unknown" as const : "disabled" as const,
            dirtyCount: 0,
            verificationPending: 0,
        };
        if (noteStatus.lastErrorCode) {
            sourceErrors.push({ source: "note_memory", code: noteStatus.lastErrorCode });
        }
        const profile = await this.readMemoryControlCenterProfile(sourceErrors);
        const vaultInsights = this.readMemoryControlCenterVaultInsights();
        const governedProjection = this.getGovernedMemoryProjectionSnapshot();
        const governanceMode = this.getMemoryGovernanceUiMode();
        const governanceState = this.memoryGovernanceBootstrapState === "ready"
            ? this.currentDeviceMemoryGovernanceState
            : null;
        const governanceVaultKey = this.memoryGovernanceOpaqueVaultKey;
        const migration = governanceState && governanceVaultKey
            ? governanceState.migrationStates[governanceVaultKey]
            : undefined;
        const deviceLocalProven = migration?.phase === "finalized";
        const deviceCollaborationAvailable = this.isDeviceCollaborationScopeAvailable();
        const finalizationPreview = governanceState && governanceVaultKey
            && (migration?.phase === "compatibility" || migration?.phase === "finalizing")
            ? previewMemoryGovernanceFinalization(governanceState, governanceVaultKey, new Date())
            : undefined;
        const rollbackProjection = governanceState && governanceVaultKey
            && (migration?.phase === "compatibility" || migration?.phase === "rolling_back")
            ? buildLegacyMemoryRollbackProjection(governanceState, governanceVaultKey, new Date())
            : undefined;
        const rollbackHasPendingOperations = governanceState && governanceVaultKey
            ? governanceState.pendingOperations.some((operation) => {
                if (operation.kind === "forget") {
                    return operation.partition.kind === "device_collaboration"
                        || operation.partition.key === governanceVaultKey;
                }
                if (operation.state !== "pending") return false;
                const claim = governanceState.claims.find(
                    (candidate) => candidate.id === operation.claimId,
                );
                return claim?.partition.kind === "device_collaboration"
                    || (claim?.partition.kind === "vault"
                        && claim.partition.key === governanceVaultKey)
                    || (operation.action === "remove"
                        && operation.ownerVaultKey === governanceVaultKey);
            })
            : false;

        const base = buildMemoryControlCenterSnapshot({
            now: new Date(),
            noteMemory: {
                enabled: noteStatus.enabled,
                status: noteStatus.status,
                ...(noteStatus.indexedDocumentCount !== undefined
                    ? { indexedDocumentCount: noteStatus.indexedDocumentCount }
                    : {}),
            },
            vaultInsights,
            profile,
            confirmedRecords: !governedProjection && Array.isArray(this.settings.memoryGovernance?.records)
                ? this.settings.memoryGovernance.records
                : [],
            boundary: {
                vaultScopeLabel: this.app.vault.getName?.() || this.t("plugin.settings.memoryControlCenter.currentVault"),
                deviceLocalProven,
                explanationKey: deviceLocalProven
                    ? deviceCollaborationAvailable
                        ? "plugin.settings.memoryControlCenter.boundary.deviceLocal"
                        : "plugin.settings.memoryControlCenter.boundary.deviceLocalVaultOnly"
                    : "plugin.settings.memoryControlCenter.boundary.compatibility",
            },
            capabilities: {
                correct: false,
                undoRecentChange: false,
                pauseUse: false,
                resumeUse: false,
                forget: false,
            },
            sourceErrors,
        });
        const compatibilityFinalization = finalizationPreview && migration
            ? {
                phase: migration.phase as "compatibility" | "finalizing",
                eligible: finalizationPreview.eligible,
                ...(finalizationPreview.confirmationToken
                    ? { confirmationToken: finalizationPreview.confirmationToken }
                    : {}),
                legacyRecordCount: finalizationPreview.legacyRecordCount,
                legacyMemoryQueueCount: finalizationPreview.legacyMemoryQueueCount,
                warningCode: finalizationPreview.warningCode,
                ...(finalizationPreview.requiresFreshRestoreProof
                    ? { requiresFreshRestoreProof: true }
                    : {}),
                ...(finalizationPreview.blockedReason
                    ? { blockedReason: finalizationPreview.blockedReason }
                    : {}),
            }
            : undefined;
        const compatibilityRollback = rollbackProjection && migration
            && (migration.phase === "compatibility" || migration.phase === "rolling_back")
            ? {
                phase: migration.phase,
                eligible: rollbackProjection.ok && !rollbackHasPendingOperations,
                legacyRecordCount: rollbackProjection.ok
                    ? rollbackProjection.projection.records.length
                    : 0,
                legacyMemoryQueueCount: rollbackProjection.ok
                    ? rollbackProjection.projection.memoryQueueItems.length
                    : 0,
                ...(migration.rollbackExpiresAt
                    ? { rollbackExpiresAt: migration.rollbackExpiresAt }
                    : {}),
                ...(!rollbackProjection.ok || rollbackHasPendingOperations ? {
                    blockedReason: rollbackHasPendingOperations
                        ? "rollback_pending_operations"
                        : rollbackProjection.ok ? undefined : rollbackProjection.reason,
                } : {}),
            }
            : undefined;
        if (!governedProjection) {
            return {
                ...base,
                governanceMode,
                ...(compatibilityFinalization ? { compatibilityFinalization } : {}),
                ...(compatibilityRollback ? { compatibilityRollback } : {}),
            };
        }

        const governed = buildGovernedMemoryViewSnapshot(
            governedProjection.state,
            governedProjection.vaultScopeKey,
        );
        const linkedProfileRecordIds = new Set(governedProjection.state.projectionLinks.flatMap((link) => (
            link.target.kind === "type_a_profile" ? [link.target.profileRecordId] : []
        )));
        const governedItems = governed.records.map((entry) => this.toMemoryControlCenterItem(
            entry,
            undefined,
            governedProjection.state,
        ));
        const pendingForgetItems = governed.pendingForgets.map((pending): MemoryControlCenterItem => ({
            id: pending.claimId,
            claimId: pending.claimId,
            label: "",
            origin: "confirmed_memory",
            authority: "source_observation",
            scopeLabel: "",
            effect: "none",
            lifecycle: "forget_pending",
            provenance: [],
            updatedAt: pending.updatedAt,
            supportedActions: this.memoryGovernanceCoordinator ? ["retry_forget"] : [],
        }));
        const retainedBaseItems = base.items.filter((item) => (
            item.origin !== "confirmed_memory"
            && (!item.profileRecordId || !linkedProfileRecordIds.has(item.profileRecordId))
        ));
        const recentChanges = governed.recentChanges.map((change): MemoryControlCenterRecentChange => ({
            id: change.id,
            claimId: change.claimId,
            kind: change.kind,
            occurredAt: change.occurredAt,
            ...(change.redacted ? {} : {
                ...(change.summary ? { label: change.summary } : {}),
                ...(change.sourcePath ? { sourcePath: change.sourcePath } : {}),
                ...(change.scope ? {
                    scopeLabel: change.effect === "collaboration_default"
                        ? this.t("plugin.settings.memoryControlCenter.deviceVaults")
                        : this.memoryScopeLabel(change.scope),
                } : {}),
                ...(change.effect ? { effect: change.effect } : {}),
            }),
            ...(change.status ? { status: change.status } : {}),
            redacted: change.redacted,
            supportedActions: change.undoAvailable ? ["undo_recent_change"] : [],
        }));
        return {
            ...base,
            governanceMode,
            ...(compatibilityFinalization ? { compatibilityFinalization } : {}),
            ...(compatibilityRollback ? { compatibilityRollback } : {}),
            durable: {
                activeCount: governedItems.filter((item) => item.lifecycle === "active").length,
                pausedCount: governedItems.filter((item) => item.lifecycle === "paused").length,
                staleCount: governedItems.filter((item) => item.lifecycle === "stale").length,
            },
            items: [...retainedBaseItems, ...governedItems, ...pendingForgetItems],
            recentChanges,
        };
    }

    private toMemoryControlCenterItem(
        entry: ReturnType<typeof buildGovernedMemoryViewSnapshot>["records"][number],
        useGateOverrides?: {
            runtimeUseEnabled: boolean;
            sourceEligible: boolean;
        },
        stateOverride?: DeviceMemoryGovernanceStateV1,
    ): MemoryControlCenterItem {
        const state = stateOverride ?? this.currentDeviceMemoryGovernanceState;
        const projection = state
            ? this.projectGovernedMemoryUiEntry(entry, state, useGateOverrides)
            : projectGovernedMemoryUiState(entry, {
                runtimeUseEnabled: useGateOverrides?.runtimeUseEnabled ?? false,
                sourceEligible: useGateOverrides?.sourceEligible ?? false,
                hasPendingOperation: false,
                coordinatorAvailable: Boolean(this.memoryGovernanceCoordinator),
            });
        const profileLink = entry.projectionLinks.find((link) => link.target.kind === "type_a_profile");
        const supportedActions: MemoryControlCenterItem["supportedActions"] = [];
        if (projection.actionPolicy.correct) supportedActions.push("correct");
        if (projection.durableUseStatus === "active" && projection.actionPolicy.pause) {
            supportedActions.push("pause_use");
        }
        if (projection.durableUseStatus === "paused" && projection.actionPolicy.resume) {
            supportedActions.push("resume_use");
        }
        if (projection.actionPolicy.correct) {
            const scopeAction = this.getGovernedMemoryScopeAction(entry.claimId);
            if (scopeAction) supportedActions.push(scopeAction);
        }
        if (projection.actionPolicy.forget) supportedActions.push("forget");
        return {
            id: entry.claimId,
            claimId: entry.claimId,
            ...(entry.revisionId ? { revisionId: entry.revisionId } : {}),
            ...(profileLink?.target.kind === "type_a_profile"
                ? { profileRecordId: profileLink.target.profileRecordId }
                : {}),
            label: projection.lifecycle === "forgotten_marker" ? "" : entry.record.summary,
            ...(entry.writingStyle && projection.lifecycle !== 'forgotten_marker' ? { writingStyle: cloneSerializable(entry.writingStyle) } : {}),
            origin: profileLink
                ? "user_profile"
                : entry.effect === "collaboration_default"
                    ? "collaboration_preference"
                    : "confirmed_memory",
            authority: entry.authority,
            scopeLabel: projection.lifecycle === "forgotten_marker"
                ? ""
                : entry.effect === "collaboration_default"
                    ? this.t("plugin.settings.memoryControlCenter.deviceVaults")
                    : this.memoryScopeLabel(entry.record.scope),
            effect: projection.effect,
            lifecycle: projection.lifecycle,
            provenance: entry.provenance.flatMap((provenance): MemoryControlCenterProvenance[] => {
                if (provenance.kind === "note") {
                    return [{ kind: "note", sourceRef: cloneSerializable(provenance.sourceRef) }];
                }
                if (provenance.kind === "conversation") {
                    return provenance.conversationIds.map((conversationId) => ({
                        kind: "conversation",
                        conversationId,
                        observedAt: provenance.observedAt,
                    }));
                }
                if (provenance.kind === "explicit_setting") return [{ ...provenance }];
                if (provenance.kind === "host_user_request") return [{ ...provenance }];
                return [{
                    ...provenance,
                    representativeSourceRefs: provenance.representativeSourceRefs.map(
                        (sourceRef) => cloneSerializable(sourceRef),
                    ),
                }];
            }),
            observedAt: entry.record.confirmedAt ?? entry.record.createdAt,
            updatedAt: entry.record.updatedAt,
            supportedActions,
        };
    }

    private getGovernedMemoryScopeAction(
        claimId: string,
    ): "apply_device_wide" | "limit_to_current_vault" | null {
        const governed = this.getGovernedMemoryProjectionSnapshot();
        if (!governed) return null;
        const claim = governed.state.claims.find((candidate) => candidate.id === claimId);
        if (!claim || (claim.lifecycle !== "active" && claim.lifecycle !== "paused")) return null;
        if (governed.state.pendingOperations.some((operation) => (
            operation.claimId === claimId
            && (operation.kind === "forget" || operation.state === "pending")
        ))) return null;
        if (claim.partition.kind === "device_collaboration" && claim.partition.key === "device") {
            return claim.effect === "collaboration_default"
                ? "limit_to_current_vault"
                : null;
        }
        if (!this.isDeviceCollaborationScopeAvailable()) return null;
        if (claim.partition.kind !== "vault" || claim.partition.key !== governed.vaultScopeKey) return null;
        if (governed.state.migrationStates[governed.vaultScopeKey]?.phase !== "finalized") return null;
        if (claim.memoryType !== "preference"
            || claim.sensitivity !== "low"
            || claim.applicability.kind !== "whole_vault"
            || claim.effect !== "future_answers"
            || !claim.activeRevisionId) return null;
        const revision = governed.state.revisions.find((candidate) => (
            candidate.id === claim.activeRevisionId && candidate.claimId === claim.id
        ));
        if (!revision
            || (revision.authority !== "explicit_user" && revision.authority !== "user_correction")
            || revision.provenance.length === 0
            || revision.provenance.some((source) => (
                source.kind !== "conversation" && source.kind !== "explicit_setting"
            ))) return null;
        return "apply_device_wide";
    }

    private isDeviceCollaborationScopeAvailable(): boolean {
        return DEVICE_COLLABORATION_SCOPE_VALIDATED;
    }

    private memoryScopeLabel(scope: ReviewQueueScope): string {
        return scope.label?.trim()
            || scope.paths?.[0]
            || scope.tags?.[0]
            || this.app.vault.getName?.()
            || this.t("plugin.settings.memoryControlCenter.currentVault");
    }

    private async readMemoryControlCenterProfile(
        sourceErrors: MemoryControlCenterSourceError[],
    ): Promise<MemoryControlCenterProfileInput> {
        const featureEnabled = this.settings.memoryEnabled === true;
        const loadedSnapshot = this.memoryExtractionScheduler?.getUserProfileSnapshot() ?? null;
        if (loadedSnapshot) {
            return { featureEnabled, storageState: "ready", snapshot: loadedSnapshot };
        }

        try {
            const result = await this.createExistingUserProfileReader().read();
            switch (result.state) {
                case "ready":
                    return {
                        featureEnabled,
                        storageState: result.snapshot ? "ready" : "empty",
                        snapshot: result.snapshot,
                    };
                case "not_present":
                    return { featureEnabled, storageState: "empty", snapshot: null };
                case "unknown":
                case "blocked":
                case "unavailable":
                    return { featureEnabled, storageState: result.state, snapshot: null };
                case "error":
                    sourceErrors.push({ source: "user_profile", code: result.errorCode });
                    return { featureEnabled, storageState: "error", snapshot: null };
            }
        } catch {
            sourceErrors.push({ source: "user_profile", code: "profile_read_failed" });
            return { featureEnabled, storageState: "error", snapshot: null };
        }
    }

    private readMemoryControlCenterVaultInsights(): MemoryControlCenterVaultInsightsInput {
        const enabled = this.canRunMemoryExtractionRuntime()
            && this.settings.memoryExtractionIncludeVaultInsights === true;
        const currentDataBoundaryFingerprint = this.getMemoryDataBoundaryFingerprint();
        if (!enabled) {
            return {
                enabled: false,
                storageState: "not_loaded",
                currentDataBoundaryFingerprint,
                snapshot: null,
            };
        }

        const schedulerSnapshot = this.memoryExtractionScheduler?.getVaultInsightsSnapshot() ?? null;
        const schedulerStatus = this.memoryExtractionScheduler?.getVaultInsightsStatus() ?? "not_loaded";
        return {
            enabled: true,
            storageState: schedulerStatus === "stale_boundary"
                ? "stale_boundary"
                : schedulerStatus === "ready"
                    ? "ready"
                    : schedulerStatus === "error"
                        ? "error"
                        : "not_loaded",
            currentDataBoundaryFingerprint,
            snapshot: schedulerSnapshot ? {
                snapshot: schedulerSnapshot.snapshot,
                dataBoundaryFingerprint: schedulerSnapshot.dataBoundaryFingerprint,
                representativeSourceRefs: schedulerSnapshot.representativePaths.map((path) => ({
                    path,
                    generatedAt: schedulerSnapshot.snapshot.generatedAt,
                })),
            } : null,
        };
    }

    private getMemoryDataBoundaryFingerprint(): string {
        return this.sourceAccess.getMemoryDataBoundaryFingerprint();
    }

    scheduleMemoryExtractionAfterChatTurn(conversationId: string, turnCount: number): void {
        this.memoryIntegration.scheduleExtractionAfterChatTurn(conversationId, turnCount);
    }

    private async initializeMemoryGovernanceBootstrap(): Promise<void> {
        if (this.memoryGovernanceBootstrapState === "ready" || this.unloading) return;
        let prepared: GovernanceStoragePreparedHandle | null = null;
        let recordRepository: DeviceMemoryGovernanceRecordRepository | null = null;
        try {
            prepared = await this.governanceStorage.prepareBootstrap();
            const {
                repository,
                opaqueVaultKey,
                expectedSourceHash,
                existingState,
                payload,
            } = prepared;
            const existingMigration = existingState.migrationStates[opaqueVaultKey];
            let sourceHash = expectedSourceHash;
            if (existingMigration?.phase === "rolling_back") {
                const barrier = this.legacyMemoryCompatibilityBarrier;
                if (!barrier || !existingMigration.sourceHash) {
                    throw new MemoryGovernanceBootstrapError("migration_failed");
                }
                sourceHash = existingMigration.sourceHash;
                const rollback = new MemoryGovernanceRollbackCoordinator({
                    repository,
                    opaqueVaultKey,
                    writeLegacyProjection: (projection) => this.writeLegacyMemoryProjectionForRollback(
                        barrier,
                        projection,
                        existingMigration.legacySourceStateHash ?? existingMigration.sourceHash!,
                    ),
                    readLegacyProjection: () => this.readPersistedLegacyMemoryProjection(),
                });
                const recovered = await rollback.run();
                if (!recovered.ok) {
                    this.memoryGovernanceBootstrapErrorCode = recovered.reason;
                    throw new MemoryGovernanceBootstrapError("migration_failed");
                }
                barrier.finalize();
                this.legacyMemoryPayload = captureLegacyMemoryPayload(this.settings);
                const rolledBackState = await repository.initialize();
                this.installLegacyMemoryRuntimeAfterRollback(
                    repository,
                    rolledBackState,
                    opaqueVaultKey,
                    sourceHash,
                );
                return;
            }
            if (existingMigration?.phase === "rolled_back") {
                sourceHash = existingMigration.sourceHash ?? expectedSourceHash;
                this.legacyMemoryCompatibilityBarrier?.finalize();
                this.installLegacyMemoryRuntimeAfterRollback(
                    repository,
                    existingState,
                    opaqueVaultKey,
                    sourceHash,
                );
                return;
            }
            if (existingMigration?.phase === "governed_preserving_legacy") {
                // This format retains old settings without importing them over current governance.
                // The migration coordinator records changed legacy input separately.
                const migration = await new MemoryGovernanceMigrationCoordinator({
                    repository, opaqueVaultKey, payload,
                }).run();
                if (!migration.ok) throw new MemoryGovernanceBootstrapError("migration_failed");
                sourceHash = migration.sourceHash;
            } else if (existingMigration?.phase === "finalizing" && existingMigration.sourceHash) {
                sourceHash = existingMigration.sourceHash;
            } else if (existingMigration?.phase === "compatibility"
                && existingMigration.sourceHash
                && (existingMigration.legacySourceStateHash ?? existingMigration.sourceHash)
                    === expectedSourceHash
                && !existingMigration.lastErrorCode
                && buildLegacyMemoryRollbackProjection(existingState, opaqueVaultKey).ok) {
                sourceHash = existingMigration.sourceHash;
            } else {
                const typeAAdoptions = await this.prepareLegacyTypeAAdoptions(opaqueVaultKey);
                const migration = await new MemoryGovernanceMigrationCoordinator({
                    repository,
                    opaqueVaultKey,
                    payload,
                    typeAAdoptions,
                }).run();
                if (!migration.ok) {
                    this.memoryGovernanceBootstrapErrorCode = migration.reason;
                    throw new MemoryGovernanceBootstrapError("migration_failed");
                }
                sourceHash = migration.sourceHash;
            }

            let state = await repository.initialize();
            if (state.migrationStates[opaqueVaultKey]?.phase === "finalizing") {
                const barrier = this.legacyMemoryCompatibilityBarrier;
                if (!barrier) throw new MemoryGovernanceBootstrapError("memory_mutation_blocked");
                const finalization = new MemoryGovernanceFinalizationCoordinator({
                    repository,
                    opaqueVaultKey,
                    clearLegacyMemorySlices: (expectedSourceHash) => (
                        this.clearLegacyMemorySlicesForFinalization(barrier, expectedSourceHash)
                    ),
                    readLegacySourceSnapshot: () => this.readPersistedLegacyMemorySourceSnapshot(),
                });
                const preview = await finalization.preview();
                if (preview.eligible && preview.confirmationToken) {
                    const recovered = await finalization.run(preview.confirmationToken);
                    if (recovered.ok) {
                        barrier.finalize();
                        this.legacyMemoryPayload = captureLegacyMemoryPayload(this.settings);
                    } else {
                        await this.cancelLegacyMemoryFinalizationIfCompatible(
                            repository,
                            opaqueVaultKey,
                            barrier,
                        );
                        this.log("Memory finalization recovery remains pending", recovered);
                    }
                }
                state = await repository.initialize();
            }
            const migrationAtBootstrap = state.migrationStates[opaqueVaultKey];
            const compatibilityProjectionAvailable = migrationAtBootstrap?.phase === "compatibility"
                && buildLegacyMemoryRollbackProjection(state, opaqueVaultKey).ok;
            if (compatibilityProjectionAvailable) {
                recordRepository = await createDeviceMemoryGovernanceRecordRepository({
                    repository,
                    opaqueVaultKey,
                    expectedSourceHash: sourceHash,
                });
            }
            const settingsQueueRepository = this.getOrCreateSettingsReviewQueueRepository();
            const queueRepository = await createMemoryReviewQueueRepository({
                repository,
                settingsRepository: settingsQueueRepository,
                opaqueVaultKey,
            });
            if (state.policyStates[opaqueVaultKey]?.contextProjectionMode === "governed"
                && state.policyStates[opaqueVaultKey]?.mode === "legacy_threshold") {
                await repository.transact((draft) => {
                    const policy = draft.policyStates[opaqueVaultKey];
                    if (!policy || policy.contextProjectionMode !== "governed") return;
                    policy.mode = "effect_based";
                });
                state = await repository.initialize();
            }
            const cleanupPort: ExactMemoryProjectionCleanupPort = {
                cleanupDebugCopies: ({ claimId, partition }) => this.getAgentDebugIntegration()
                    .forgetClaim(claimId, partition.kind === 'device_collaboration'),
                cleanupExactProjection: (input) => this.cleanupExactMemoryProjection(input.projectionLink),
                prepareLegacyCompatibilityForget: (input) => (
                    this.prepareLegacyCompatibilityForget(input)
                ),
                commitLegacyCompatibilityForget: (input) => (
                    this.commitLegacyCompatibilityForget(input)
                ),
            };
            const { coordinator, profileProjectionWorker } = this.governanceActions.prepareRuntime({
                repository,
                opaqueVaultKey,
                projectionCleanupPort: cleanupPort,
                applyProjection: (input) => this.applyExactProfileProjection(
                    input.profileRecordId,
                    input.summary,
                    input.occurredAt,
                    input.claimId,
                    input.targetRevisionId,
                    input.profileStore,
                    input.profileKey,
                ),
                removeProjection: (input) => input.profileStore === "governed"
                    ? this.mutateExactProfileRecord(input.profileRecordId, () => null, true,
                        undefined, undefined, "governed")
                    : this.mutateExactProfileRecord(input.profileRecordId, () => null, true),
            });
            const garbageCollection = await coordinator.collectGarbage();
            if (!garbageCollection.ok) {
                throw new MemoryGovernanceBootstrapError("migration_failed");
            }
            state = await repository.initialize();
            let forgetRecoveryPending = false;
            let profileRecoveryPending = false;
            if (state.policyStates[opaqueVaultKey]?.contextProjectionMode === "governed") {
                const forgetRecovery = await coordinator.resumePendingForgets();
                if (!forgetRecovery.ok || forgetRecovery.value.pending.length > 0) {
                    forgetRecoveryPending = true;
                    this.log("Memory Forget recovery remains pending", forgetRecovery.ok
                        ? { ok: true, pendingCount: forgetRecovery.value.pending.length }
                        : { ok: false });
                }
                state = await repository.initialize();
            }
            this.governanceStorage.publishGovernedRuntime(prepared, {
                state,
                sourceHash,
                recordRepository,
                reviewQueueRepository: queueRepository,
            });
            if (state.policyStates[opaqueVaultKey]?.contextProjectionMode === "governed") {
                await this.reconcileGovernedProfileCache();
                const profileRecovery = await profileProjectionWorker.resumePending();
                profileRecoveryPending = profileRecovery.pending.length > 0;
                if (profileRecoveryPending) this.log("Memory profile projection recovery remains pending", {
                    count: profileRecovery.pending.length,
                });
                await this.refreshDeviceMemoryCaches();
            }
            if (forgetRecoveryPending) this.scheduleMemoryForgetRetry();
            if (profileRecoveryPending) this.scheduleMemoryProfileProjectionRetry();
            this.scheduleMemoryGovernanceGarbageCollection();
        } catch (error) {
            recordRepository?.dispose();
            await this.failMemoryGovernanceBootstrap(
                this.memoryGovernanceBootstrapErrorCode
                    ?? (error instanceof MemoryGovernanceBootstrapError
                        ? error.code
                        : error instanceof Error ? error.name : "bootstrap_failed"),
                prepared,
            );
        }
    }

    private createMemoryGovernanceDeviceRepository(): MemoryGovernanceRepository {
        const pluginId = (this.manifest as { id?: string } | undefined)?.id ?? "personal-assistant";
        return createDeviceMemoryGovernanceRepository(pluginId);
    }

    /** Rebuild a missing derived copy from canonical targets, never from the old Profile database. */
    private async reconcileGovernedProfileCache(): Promise<void> {
        const repository = this.deviceMemoryGovernanceRepository;
        const vaultKey = this.memoryGovernanceOpaqueVaultKey;
        if (!repository || !vaultKey) return;
        const snapshot = await repository.initialize();
        if (!snapshot.projectionLinks.some((link) => link.state === "active"
            && link.target.kind === "type_a_profile" && link.target.store === "governed")) return;
        const cache = await this.createExistingGovernedUserProfileReader().read();
        if (cache.state !== "ready" && cache.state !== "not_present") return;
        const rows = cache.state === "ready" ? cache.snapshot?.records ?? [] : [];
        const repairs = snapshot.projectionLinks.flatMap((link) => {
            if (link.state !== "active" || link.target.kind !== "type_a_profile" || link.target.store !== "governed") return [];
            const target = link.target;
            const claim = snapshot.claims.find((candidate) => candidate.id === link.claimId
                && candidate.partition.kind === "vault" && candidate.partition.key === vaultKey);
            if (!claim || claim.lifecycle === "forget_pending" || claim.lifecycle === "forgotten_tombstone") return [];
            const revision = snapshot.revisions.find((candidate) => candidate.id === claim.activeRevisionId && candidate.claimId === claim.id);
            if (!revision || !target.profileKey) return [];
            const row = rows.find((candidate) => candidate.profileRecordId === target.profileRecordId);
            const legacyPending = snapshot.pendingOperations.some((operation) => operation.kind === "profile_projection"
                && operation.action !== "remove" && operation.state === "pending" && operation.profileStore === undefined
                && operation.claimId === claim.id && operation.profileRecordId === target.profileRecordId
                && operation.targetRevisionId === revision.id);
            return row?.key === target.profileKey && row.text === revision.summary.trim() && !legacyPending ? []
                : [{ linkId: link.id, claimId: claim.id, targetRevisionId: revision.id,
                    profileRecordId: target.profileRecordId, profileKey: target.profileKey }];
        });
        if (repairs.length === 0) return;
        await repository.transact((draft) => {
            for (const repair of repairs) {
                const claim = draft.claims.find((candidate) => candidate.id === repair.claimId);
                const link = draft.projectionLinks.find((candidate) => candidate.id === repair.linkId);
                if (!claim || claim.activeRevisionId !== repair.targetRevisionId || claim.lifecycle === "forget_pending"
                    || claim.lifecycle === "forgotten_tombstone" || !link || link.state !== "active"
                    || link.target.kind !== "type_a_profile" || link.target.store !== "governed"
                    || link.target.profileRecordId !== repair.profileRecordId || link.target.profileKey !== repair.profileKey) continue;
                for (const operation of draft.pendingOperations) {
                    if (operation.kind === "profile_projection" && operation.action !== "remove"
                        && operation.state === "pending" && operation.profileStore === undefined
                        && operation.claimId === repair.claimId && operation.profileRecordId === repair.profileRecordId
                        && operation.targetRevisionId === repair.targetRevisionId) {
                        operation.profileStore = "governed";
                        operation.profileKey = repair.profileKey;
                    }
                }
                const current = draft.pendingOperations.find((operation) => operation.kind === "profile_projection"
                    && operation.action !== "remove" && operation.claimId === repair.claimId
                    && operation.targetRevisionId === repair.targetRevisionId && operation.profileStore === "governed"
                    && operation.profileRecordId === repair.profileRecordId && operation.profileKey === repair.profileKey);
                if (current?.kind === "profile_projection") {
                    current.state = "pending";
                    current.updatedAt = new Date().toISOString();
                } else {
                    const occurredAt = new Date().toISOString();
                    draft.pendingOperations.push({ id: `profile-cache-repair:${repair.linkId}:${repair.targetRevisionId}`,
                        kind: "profile_projection", action: "upsert", claimId: repair.claimId,
                        targetRevisionId: repair.targetRevisionId, profileRecordId: repair.profileRecordId,
                        profileKey: repair.profileKey, profileStore: "governed", state: "pending", attemptCount: 0,
                        createdAt: occurredAt, updatedAt: occurredAt });
                }
            }
        });
    }

    private async prepareLegacyTypeAAdoptions(
        opaqueVaultKey: string,
    ): Promise<ClassifiedLegacyTypeAAdoption[] | undefined> {
        const existing = await this.createExistingUserProfileReader().read();
        if (existing.state === "error") {
            throw new MemoryGovernanceBootstrapError("profile_read_failed");
        }
        if (existing.state === "not_present") return [];
        if (existing.state !== "ready") return undefined;
        if (!existing.snapshot) return [];

        const sanitized = sanitizeUserProfileSnapshot(existing.snapshot, new Date());
        if (!sanitized) return undefined;
        const profileStore = this.createUserProfileStore();
        try {
            await profileStore.initialize();
            await profileStore.setProfile(sanitized);
            const readback = await profileStore.getProfile();
            if (!readback || !userProfileSnapshotsEqual(sanitized, readback)) {
                throw new MemoryGovernanceBootstrapError("profile_readback_mismatch");
            }
        } finally {
            await profileStore.dispose().catch(() => undefined);
        }
        return sanitized.records.map((record) => classifyProfileForGovernedAdoption(
            opaqueVaultKey,
            record,
        ));
    }

    private async prepareLegacyCompatibilityForget(input: {
        recordIdFingerprints: string[];
        memoryQueueItemIdFingerprints: string[];
        trustedSourceHash: string;
        pendingSourceHash?: string;
    }): Promise<LegacyCompatibilityForgetPrepareResult> {
        const persisted = await this.readPluginDataJson();
        const payload = captureLegacyMemoryPayload(persisted);
        const expectedSourceHash = hashLegacyMemoryPayload(payload);
        const matchesTrusted = expectedSourceHash === input.trustedSourceHash;
        const matchesPending = Boolean(input.pendingSourceHash)
            && expectedSourceHash === input.pendingSourceHash;
        const redacted = redactExactLegacyMemoryPayload(payload, {
            recordIdFingerprints: input.recordIdFingerprints,
            memoryQueueItemIdFingerprints: input.memoryQueueItemIdFingerprints,
        });
        if (!redacted.ok) {
            throw new Error(`Legacy Memory Forget preparation failed: ${redacted.reason}`);
        }
        if (!matchesTrusted && !matchesPending) {
            return { ok: false, reason: 'source_changed', sourceHash: expectedSourceHash };
        }
        return {
            ok: true,
            expectedSourceHash,
            resultingSourceHash: redacted.sourceHash,
            preservePendingReconciliation: !matchesTrusted && matchesPending,
        };
    }

    private commitLegacyCompatibilityForget(input: {
        recordIdFingerprints: string[];
        memoryQueueItemIdFingerprints: string[];
        expectedSourceHash: string;
        resultingSourceHash: string;
    }): Promise<
        | { ok: true; sourceHash: string }
        | { ok: false; reason: "source_changed"; sourceHash: string }
    > {
        return this.enqueueSettingsWrite(async () => {
            const barrier = this.legacyMemoryCompatibilityBarrier;
            if (!barrier?.isActive() || this.unloading) {
                throw new Error("Legacy Memory compatibility write is unavailable.");
            }
            let sourceChanged = false;
            const processed = await this.processPluginDataJson((persisted) => {
                const payload = captureLegacyMemoryPayload(persisted);
                const currentSourceHash = hashLegacyMemoryPayload(payload);
                const redacted = redactExactLegacyMemoryPayload(payload, {
                    recordIdFingerprints: input.recordIdFingerprints,
                    memoryQueueItemIdFingerprints: input.memoryQueueItemIdFingerprints,
                });
                if (!redacted.ok) {
                    throw new Error(`Legacy Memory Forget failed: ${redacted.reason}`);
                }
                if (currentSourceHash === input.resultingSourceHash) {
                    if (redacted.changed || redacted.sourceHash !== input.resultingSourceHash) {
                        throw new Error("Legacy Memory Forget readback is inconsistent.");
                    }
                    return persisted;
                }
                if (currentSourceHash !== input.expectedSourceHash
                    || redacted.sourceHash !== input.resultingSourceHash) {
                    sourceChanged = true;
                    return persisted;
                }
                const next = cloneSerializable(persisted);
                next.memoryGovernance = cloneSerializable(redacted.payload.memoryGovernance);
                next.reviewQueue = cloneSerializable(redacted.payload.reviewQueue);
                return next;
            });
            const readbackPayload = captureLegacyMemoryPayload(processed.readback);
            const readbackHash = hashLegacyMemoryPayload(readbackPayload);
            if (sourceChanged && readbackHash !== input.resultingSourceHash) {
                if (!barrier.refreshFromPersisted(processed.readback)) {
                    throw new Error("Legacy Memory compatibility snapshot refresh failed.");
                }
                this.legacyMemoryPayload = barrier.snapshot();
                await this.synchronizeNonMemoryQueueFromPersisted(processed.readback);
                return { ok: false, reason: "source_changed", sourceHash: readbackHash };
            }
            const readbackRedaction = redactExactLegacyMemoryPayload(readbackPayload, {
                recordIdFingerprints: input.recordIdFingerprints,
                memoryQueueItemIdFingerprints: input.memoryQueueItemIdFingerprints,
            });
            if (readbackHash !== input.resultingSourceHash
                || !readbackRedaction.ok
                || readbackRedaction.changed) {
                throw new Error("Legacy Memory Forget readback verification failed.");
            }
            if (!barrier.refreshFromPersisted(processed.readback)) {
                throw new Error("Legacy Memory compatibility snapshot refresh failed.");
            }
            this.legacyMemoryPayload = barrier.snapshot();
            await this.synchronizeNonMemoryQueueFromPersisted(processed.readback);
            return { ok: true, sourceHash: readbackHash };
        });
    }

    private async cleanupExactMemoryProjection(link: MemoryProjectionLink): Promise<void> {
        if (link.target.kind === "review_queue" || link.target.kind === "prompt_projection") {
            // Both are committed/redacted by the same governance transaction;
            // the cleanup port is only the external derived-store boundary.
            return;
        }
        if (link.target.store === "governed") {
            await this.mutateExactProfileRecord(link.target.profileRecordId, () => null, true,
                undefined, undefined, "governed");
        } else {
            await this.mutateExactProfileRecord(link.target.profileRecordId, () => null, true);
        }
    }

    private async prepareChatSemanticSourceEvidence(receipt: ChatMemorySemanticReceipt, text: string): Promise<{
        evidence: ChatSemanticAdmissionEvidence;
        isCurrent: () => boolean;
        guard: ProfileWriteGuard;
        release: () => void;
    } | null> {
        const manager = this.chatHistoryManager;
        const repository = this.deviceMemoryGovernanceRepository;
        const vaultKey = this.memoryGovernanceOpaqueVaultKey;
        const conversationId = receipt.sources[0]?.conversationId;
        if (!manager || !conversationId || typeof manager.observeSourceLifetime !== "function") return null;
        const lease = manager.observeSourceLifetime(conversationId);
        const isCurrent = () => lease.isCurrent() && !this.unloading && this.settings.memoryEnabled === true
            && this.chatHistoryManager === manager && this.deviceMemoryGovernanceRepository === repository
            && this.memoryGovernanceOpaqueVaultKey === vaultKey && Boolean(this.getGovernedMemoryProjectionSnapshot());
        let handedOff = false;
        try {
            if (!isCurrent() || !await manager.findConversation(conversationId)) return null;
            const sources = collectChatMemorySemanticSources(conversationId, await manager.getTurns(conversationId));
            const projections = receipt.sources.flatMap((quoted) => {
                const source = sources.find((candidate) => candidate.messageId === quoted.messageId);
                return source ? [{ source, presentedText: projectChatMemorySemanticText(source, quoted.projectionChars) }] : [];
            });
            const evidence: ChatSemanticAdmissionEvidence = { conversationId, projections,
                candidate: { text, meaning: receipt.meaning, kind: receipt.kind, confidence: receipt.confidence } };
            if (!isCurrent() || !verifyChatMemorySemanticReceipt(receipt, evidence.candidate, conversationId, projections)) return null;
            const guard: ProfileWriteGuard = () => {
                if (!isCurrent()) throw new Error("Semantic Profile source is no longer current.");
            };
            guard.signal = lease.signal;
            handedOff = true;
            return { evidence, isCurrent, guard, release: lease.release };
        } finally {
            // Invalid snapshots never retain an observer; successful callers release after their write.
            if (!handedOff) lease.release();
        }
    }

    private async applyExactProfileProjection(
        profileRecordId: string,
        summary: string,
        occurredAt: string,
        claimId: string,
        targetRevisionId: string,
        profileStore?: "governed",
        profileKey?: string,
    ): Promise<void> {
        if (!profileRecordId.trim() || !claimId.trim() || !targetRevisionId.trim() || !summary.trim()) {
            throw new Error("Invalid exact Profile projection input.");
        }
        const repository = this.deviceMemoryGovernanceRepository;
        const snapshot = repository ? await repository.initialize() : null;
        const claim = snapshot?.claims.find((candidate) => candidate.id === claimId);
        const revision = snapshot?.revisions.find((candidate) => (
            candidate.id === targetRevisionId && candidate.claimId === claimId
        ));
        const exactLink = snapshot?.projectionLinks.some((link) => (
            link.claimId === claimId && link.state === "active"
            && link.target.kind === "type_a_profile" && link.target.profileRecordId === profileRecordId
            && link.target.store === profileStore && link.target.profileKey === profileKey
        ));
        // The worker's snapshot can be superseded before this external write.
        // Keep the outbox pending instead of combining an old body with newer evidence.
        if (!claim || claim.activeRevisionId !== targetRevisionId
            || claim.lifecycle === "forget_pending" || claim.lifecycle === "forgotten_tombstone"
            || !revision || !exactLink || revision.summary !== summary) {
            throw new Error("Exact Profile projection revision is no longer current.");
        }
        if (revision.chatSemanticReceipt && profileStore !== "governed") {
            throw new Error("Semantic Profile requires an isolated governed target.");
        }
        if (profileStore === "governed" && !profileKey?.trim()) {
            throw new Error("Governed Profile extraction key is missing.");
        }
        const normalizedSummary = revision.summary.trim();
        const conversation = revision.provenance.find((entry) => entry.kind === "conversation");
        const conversationIds = conversation?.kind === "conversation"
            ? [...conversation.conversationIds]
            : [];
        const observedAt = conversation?.kind === "conversation"
            ? conversation.observedAt
            : occurredAt;
        const source = revision.chatSemanticReceipt
            ? await this.prepareChatSemanticSourceEvidence(revision.chatSemanticReceipt, normalizedSummary) : null;
        if (revision.chatSemanticReceipt && !source) throw new Error("Semantic Profile source is unavailable.");
        const semanticFields = revision.chatSemanticReceipt ? {
            kind: revision.chatSemanticReceipt.kind,
            confidence: revision.chatSemanticReceipt.confidence,
            confirmed: false,
            conversationId: conversationIds[0],
            conversationIds,
            occurrences: 1,
            chatEvidence: undefined,
            chatSemanticReceipt: undefined,
            meaning: undefined,
        } : {};
        try {
            if (profileStore === "governed") {
                await this.repairGovernedProfileIdentity(profileRecordId, profileKey!, snapshot!, source?.guard);
            }
            await this.mutateExactProfileRecord(profileRecordId, (record) => ({
                ...record,
                ...(profileStore === "governed" ? { key: profileKey! } : {}),
                text: normalizedSummary,
                kind: "user_correction",
                confidence: "high",
                confirmed: true,
                observedAt: occurredAt,
                ...semanticFields,
            }), false, () => {
                if (conversationIds.length === 0) {
                    throw new Error("Exact Profile projection conversation evidence is missing.");
                }
                return {
                    profileRecordId,
                    key: profileKey ?? `governed-${claimId}`,
                    text: normalizedSummary,
                    kind: revision.authority === "user_correction"
                        ? "user_correction"
                        : "user_explicit",
                    confidence: "high",
                    conversationId: conversationIds[0],
                    observedAt,
                    occurrences: Math.max(1, conversationIds.length),
                    conversationIds,
                    confirmed: true,
                    ...semanticFields,
                };
            }, source?.guard, profileStore);
        } finally {
            source?.release();
        }
    }

    private async repairGovernedProfileIdentity(
        profileRecordId: string,
        profileKey: string,
        canonical: DeviceMemoryGovernanceStateV1,
        guard?: ProfileWriteGuard,
    ): Promise<void> {
        const cache = await this.createExistingGovernedUserProfileReader().read();
        if (cache.state !== "ready" || !cache.snapshot) return;
        const conflicting = cache.snapshot.records.filter((row) => row.key === profileKey
            && row.profileRecordId && row.profileRecordId !== profileRecordId);
        const vaultClaimIds = new Set(canonical.claims.filter((claim) => claim.partition.kind === "vault"
            && claim.partition.key === this.memoryGovernanceOpaqueVaultKey).map((claim) => claim.id));
        for (const row of conflicting) {
            if (canonical.projectionLinks.some((link) => link.state === "active" && vaultClaimIds.has(link.claimId)
                && link.target.kind === "type_a_profile" && link.target.store === "governed"
                && link.target.profileRecordId === row.profileRecordId)) {
                throw new Error("Governed Profile cache identity conflicts with another canonical target.");
            }
        }
        // Remove only an unowned, corrupt derived identity. The legacy port's immutable
        // ID rule stays intact; a failed subsequent upsert remains a real pending repair.
        for (const row of conflicting) {
            await this.mutateExactProfileRecord(row.profileRecordId!,
                (current) => current.key === profileKey ? null : current, true, undefined, guard, "governed");
        }
    }

    private async mutateExactProfileRecord(
        profileRecordId: string,
        transform: (record: UserProfileRecord) => UserProfileRecord | null,
        allowMissing: boolean,
        createMissing?: () => UserProfileRecord,
        guard?: ProfileWriteGuard,
        profileStore?: "governed",
    ): Promise<void> {
        const now = new Date();
        const mutation = (current: UserProfileSnapshot | null): UserProfileSnapshot => {
            const records = current?.records ?? [];
            const index = records.findIndex((record) => record.profileRecordId === profileRecordId);
            if (index < 0) {
                if (createMissing) {
                    const nextRecords = [createMissing(), ...records.map((record) => ({
                        ...record,
                        conversationIds: [...record.conversationIds],
                    }))];
                    return {
                        updatedAt: now.toISOString(),
                        records: nextRecords,
                        markdown: renderUserProfileMarkdown(nextRecords, now),
                    };
                }
                if (!allowMissing) throw new Error("Exact Profile projection is missing.");
                return current ?? {
                    updatedAt: now.toISOString(),
                    records: [],
                    markdown: renderUserProfileMarkdown([], now),
                };
            }
            const nextRecords = records.map((record) => ({
                ...record,
                conversationIds: [...record.conversationIds],
            }));
            const nextRecord = transform(nextRecords[index]);
            if (nextRecord) nextRecords[index] = nextRecord;
            else nextRecords.splice(index, 1);
            return {
                updatedAt: now.toISOString(),
                records: nextRecords,
                markdown: renderUserProfileMarkdown(nextRecords, now),
            };
        };

        this.memoryIntegration.beginLegacyProfileMutation(profileStore ?? "legacy");
        let committed = false;
        try {
            if (this.memoryExtractionScheduler
                && (this.memoryExtractionProfileStore ?? "legacy") === (profileStore ?? "legacy")) {
                await this.memoryExtractionScheduler.mutateUserProfile(mutation, guard);
            } else {
                const store = profileStore === "governed" ? this.createGovernedUserProfileStore() : this.createUserProfileStore();
                const port = new SerializedProfileGovernancePort(store, () => now);
                try {
                    await port.initialize();
                    await port.mutate(mutation, guard);
                } finally {
                    await port.dispose().catch(() => undefined);
                }
            }
            committed = true;
        } finally {
            await this.memoryIntegration.finishLegacyProfileMutation(committed);
        }
    }

    private failMemoryGovernanceBootstrap(
        errorCode: string,
        handle: GovernanceStoragePreparedHandle | null = null,
    ): Promise<void> {
        this.governanceActions.clearRuntime();
        return this.governanceStorage.failBootstrap(handle, errorCode);
    }

    private getOrCreateSettingsReviewQueueRepository(): ReviewQueueRepository {
        return this.governanceStorage.getOrCreateSettingsReviewQueueRepository();
    }

    private scheduleDeviceMemoryCacheRefresh(commitSequence: number): void {
        this.governanceStorage.scheduleRefresh(commitSequence);
    }

    private async refreshDeviceMemoryCaches(): Promise<void> {
        await this.governanceStorage.refreshCaches();
    }

    private async updateCurrentLocalMemoryPolicy(
        next: Partial<{ confirmedMemoryCount: number; memoryAutoAcceptPaused: boolean }>,
    ): Promise<void> {
        await this.governanceStorage.updateCurrentLocalPolicy(next);
    }

    async loadSettings(): Promise<void> {
        await this.settingsPersistence.loadSettings();
    }

    async saveSettings(): Promise<void> {
        await this.settingsPersistence.saveSettings();
    }

    getMemoryGovernanceSmokeCapability(): MemoryGovernanceSmokeCapability {
        return this.governanceStorage.getSmokeCapability();
    }

    openGraphOptions(): Modal {
        this.activeFeatureOptionsModal?.close();
        const modal = new GraphOptionsModal(this.app, {
            readOptions: () => ({ localGraph: this.settings.localGraph,
                enableGraphColors: this.settings.enableGraphColors, colorGroups: this.settings.colorGroups }),
            saveOptions: (options) => this.saveGraphOptions(options),
            applyOptions: () => this.localGraphIntegration.applyOptionsToOpenGraphs(),
        });
        this.activeFeatureOptionsModal = modal;
        modal.open();
        return modal;
    }

    async saveGraphOptions(options: GraphOptions): Promise<void> {
        await this.settingsPersistence.saveGraphOptions(options);
    }

    openFeaturedImageOptions(editor?: Editor, view?: MarkdownView): Modal | null {
        return this.aiActions.openFeaturedImageOptions(editor, view);
    }

    private openSharedFeatureModal(host: FeaturedImageOptionsModalHost): Modal {
        this.activeFeatureOptionsModal?.close();
        const modal = new FeaturedImageOptionsModal(this.app, host);
        this.activeFeatureOptionsModal = modal;
        modal.open();
        return modal;
    }

    async saveFeaturedImageDefaults(options: FeaturedImageDefaults): Promise<void> {
        await this.settingsPersistence.saveFeaturedImageDefaults(options);
    }

    /** Permission edits become effective only after their queued snapshot is saved. */
    async saveSettingsPermissions(patch: SettingsPermissionPatch): Promise<void> {
        await this.settingsPersistence.saveSettingsPermissions(patch);
    }

    async setStatisticsSyncEnabled(enabled: boolean): Promise<void> {
        await this.settingsPersistence.setStatisticsSyncEnabled(enabled);
    }

    private async persistMemoryAdmissionSettings(): Promise<void> {
        await this.settingsPersistence.persistMemoryAdmissionSettings();
    }

    private async persistRequiredSettings(options: { notify?: boolean } = {}): Promise<void> {
        await this.settingsPersistence.persistRequiredSettings(options);
    }

    async setMemoryAutoAcceptPaused(paused: boolean): Promise<void> {
        if (this.memoryGovernanceBootstrapState === "ready") {
            await this.updateCurrentLocalMemoryPolicy({ memoryAutoAcceptPaused: paused });
            await this.notifySettingsChanged();
            return;
        }
        if (this.memoryGovernanceBootstrapState === "failed") {
            throw new MemoryGovernanceBootstrapError("memory_mutation_blocked");
        }
        await this.persistPaSettingsSlice(
            () => this.settings.memoryAutoAcceptPaused,
            (value) => { this.settings.memoryAutoAcceptPaused = value; },
            paused,
        );
    }

    /** Publish only a committed preference; pending saves cannot open provider admission. */
    async setBackgroundDiscoveryEnabled(enabled: boolean): Promise<void> {
        await this.settingsPersistence.setBackgroundDiscoveryEnabled(enabled);
    }

    private isBackgroundDiscoveryEnabled(): boolean {
        return this.settingsPersistence.isBackgroundDiscoveryEnabled();
    }

    private async persistPaSettingsSlice<T>(
        read: () => T,
        write: (value: T) => void,
        next: T,
        requireCommit = false,
    ): Promise<void> {
        await this.settingsPersistence.persistSettingsSlice(read, write, next, requireCommit);
    }

    private async saveSettingsData(settingsSnapshot: PluginManagerSettings = this.settings): Promise<void> {
        await this.settingsPersistence.saveSettingsData(settingsSnapshot);
    }

    private async synchronizeNonMemoryQueueFromPersisted(raw: unknown): Promise<void> {
        await this.governanceStorage.synchronizeNonMemoryQueue(raw);
    }

    private async processPluginDataJson(
        mutate: (persisted: Record<string, unknown>) => Record<string, unknown>,
    ): Promise<{
        written: Record<string, unknown>;
        readback: Record<string, unknown>;
    }> {
        return this.settingsPersistence.processPluginDataJson(mutate);
    }

    private async readPluginDataJson(): Promise<Record<string, unknown>> {
        return this.settingsPersistence.readPluginDataJson();
    }

    private enqueueSettingsWrite<T>(operation: () => Promise<T>): Promise<T> {
        return this.settingsPersistence.enqueueWrite(operation);
    }

    private async drainSettingsWrites(): Promise<void> {
        await this.settingsPersistence.drainWrites();
    }

    private trackRequiredSettingsTransaction<T>(operation: Promise<T>): Promise<T> {
        return this.settingsPersistence.trackRequiredTransaction(operation);
    }

    /**
     * One-shot: fire the migration Notice queued by {@link loadSettings} if
     * any, then persist the localStorage flag so subsequent boots are silent.
     * Idempotent — runs at most once per boot and at most once per vault
     * lifetime regardless of how many times it is invoked.
     */
    private surfacePendingPageletReviewsFolderMigration(): void {
        this.settingsPersistence.surfacePendingPageletReviewsFolderMigration();
    }

    log(...msg: unknown[]): void {
        debug(this.settings.debug, ...msg);
    }

    // the following is referenced from https://github.com/vanadium23/obsidian-advanced-new-file/blob/master/src/CreateNoteModal.ts#L102
    /**
     * Handles creating the new note
     * A new markdown file will be created at the given file path (`input`)
     * in the specified parent folder (`this.folder`)
     **/
    async createNewNote(targetPath: string, fileName: string, timestamp: Date = new Date()): Promise<void> {
        await this.recordActions.createNewNote(targetPath, fileName, timestamp);
    }

    /**
     * Joins multiple strings into a path using Obsidian's preferred format.
     * The resulting path is normalized with Obsidian's `normalizePath` func.
     * - Converts path separators to '/' on all platforms
     * - Removes duplicate separators
     * - Removes trailing slash
     **/
    join(...strings: string[]): string {
        return this.recordActions.join(...strings);
    }

    async activateView() {
        await this.recordActions.activatePreview();
    }

    async activeStatView() {
        await this.statsIntegration.activateView();
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
            if (typeof leaf.detach === "function") {
                leaf.detach();
                leaf = workspace.getLeaf('tab');
            }
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
            await leaf.loadIfDeferred?.();
            if (!(leaf.view instanceof LLMView)) {
                await leaf.setViewState({
                    type: VIEW_TYPE_LLM,
                    active: true,
                });
                await leaf.loadIfDeferred?.();
            }
            await workspace.revealLeaf(leaf);
        }

        return leaf?.view instanceof LLMView ? leaf.view : null;
    }

    /**
     * Effective Operations host availability. The persisted legacy field remains
     * private compatibility data and no longer gates action admission.
     */
    get isOperationsAgentEnabled(): boolean {
        return !this.unloading;
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
        options?: {
            modelName?: string;
            transport?: string;
            maxTokens?: number;
            qwenRequestOptions?: QwenRequestOptions;
        },
    ) {
        const aiUtils = new AIUtils(this);
        return aiUtils.createChatModel(temperature, {
            modelName: options?.modelName,
            transport: options?.transport as "obsidian" | "native" | undefined,
            maxTokens: options?.maxTokens,
            qwenRequestOptions: options?.qwenRequestOptions,
        });
    }

    private surfaceVaultInsightsInjectionNotice(): void {
        if (this.vaultInsightsInjectionNoticeSurfacedThisBoot) return;
        if (!this.hasConfirmedMemoryExtractionConsent()) return;
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
        return this.sourceAccess.getVSSFiles();
    }

    private isVSSFileEligible(file: TFile, markdown?: string): boolean {
        return this.sourceAccess.isVSSFileEligible(file, markdown);
    }

    private decideDataBoundaryForPath(path: string): DataBoundaryDecision {
        return this.sourceAccess.decideDataBoundaryForPath(path);
    }

    private isDataBoundaryAllowedPath(path: string): boolean {
        return this.sourceAccess.isDataBoundaryAllowedPath(path);
    }

    private isMemoryProviderPathAllowed(path: string): boolean {
        return this.sourceAccess.isMemoryProviderPathAllowed(path);
    }

    private isDataBoundaryAllowedFile(file: TFile): boolean {
        return this.sourceAccess.isDataBoundaryAllowedFile(file);
    }

    /** Pagelet provider sources must satisfy both shared and Pagelet-local scope rules. */
    private isPageletProviderPathAllowed(path: string): boolean {
        return this.sourceAccess.isPageletProviderPathAllowed(path);
    }

    private isPageletProviderSourceAllowedFile(file: TFile, markdown?: string): boolean {
        return this.sourceAccess.isPageletProviderSourceAllowedFile(file, markdown);
    }

    private async captureLatestMemorySource(
        path: string,
        isPathAllowed: (path: string) => boolean,
        consumer: "chat" | "pagelet",
        signal?: AbortSignal,
    ) {
        return this.sourceAccess.captureLatestMemorySource(path, isPathAllowed, consumer, signal);
    }

    /** Re-check explicit boundary markers from the exact body sent to a provider. */
    private getLatestPageletContentBoundary(
        path: string,
        markdown: string,
    ): { allowed: boolean; tags: string[]; isGenerated: boolean } | null {
        return this.sourceAccess.getLatestPageletContentBoundary(path, markdown);
    }

    /** Re-check the shared Data Boundary from the exact Markdown body. */
    private getLatestDataBoundaryContentBoundary(
        path: string,
        markdown: string,
    ): { allowed: boolean; tags: string[]; isGenerated: boolean } | null {
        return this.sourceAccess.getLatestDataBoundaryContentBoundary(path, markdown);
    }

    private getLatestMemoryContentBoundary(
        path: string,
        markdown: string,
        consumer: "chat" | "pagelet",
    ): { allowed: boolean; tags: string[]; isGenerated: boolean } | null {
        return this.sourceAccess.getLatestMemoryContentBoundary(path, markdown, consumer);
    }

    private getDataBoundaryTags(file: TFile): string[] {
        return this.sourceAccess.getDataBoundaryTags(file);
    }

    private isGeneratedDataBoundaryFile(file: TFile): boolean {
        return this.sourceAccess.isGeneratedDataBoundaryFile(file);
    }

    private getPageletSettingsWithDataBoundary(): PageletSettings {
        return this.sourceAccess.getPageletSettingsWithDataBoundary();
    }

    private initVss(memoryHost: MemoryHost, cacheDir = this.vssCacheDir) {
        if (this.vss) {
            return this.vss;
        }

        return new VSS(memoryHost, cacheDir, this.createVSSIndexStateStore());
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
        return this.chatIntegration.createChatHistoryStore();
    }

    createUserProfileStore(): UserProfileStore {
        const manifest = this.manifest as { id?: string } | undefined;
        return createUserProfileStore(
            this.app.vault,
            this.settings.statisticsVaultId || "default-vault",
            manifest?.id ?? "personal-assistant",
        );
    }

    createGovernedUserProfileStore(): UserProfileStore {
        return createGovernedUserProfileStore(this.app.vault,
            this.settings.statisticsVaultId || "default-vault", this.manifest?.id ?? "personal-assistant");
    }

    createExistingGovernedUserProfileReader(): ExistingUserProfileReader {
        return createExistingGovernedUserProfileReader(this.app.vault,
            this.settings.statisticsVaultId || "default-vault", this.manifest?.id ?? "personal-assistant");
    }

    createExistingUserProfileReader(): ExistingUserProfileReader {
        const manifest = this.manifest as { id?: string } | undefined;
        return createExistingUserProfileReader(
            this.app.vault,
            this.settings.statisticsVaultId || "default-vault",
            manifest?.id ?? "personal-assistant",
        );
    }

    onMemoryStatusChanged(listener: () => void | Promise<void>): () => void {
        return this.memoryStatusNotifier.subscribe(listener);
    }

    onSettingsChanged(listener: () => void | Promise<void>): () => void {
        return this.settingsPersistence.onSettingsChanged(listener);
    }

    private async notifySettingsChanged(): Promise<void> {
        await this.settingsPersistence.notifySettingsChanged();
    }

    async notifyAIReadinessChanged(): Promise<void> {
        await this.aiConfiguration.notifyReadinessChanged();
    }

    /** Mark a Settings provider edit at invocation time so older queued Chat setup becomes stale. */
    beginAIProviderConfigurationMutation(): number {
        return this.aiConfiguration.beginProviderConfigurationMutation();
    }

    private hasActiveAIProviderCredentialTransition(): boolean {
        return this.aiConfiguration.hasActiveCredentialTransition();
    }

    async updateMemoryStatusBar() {
        await this.memoryStatusNotifier.notifyNow();
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

        const activePreparation = this.memoryManager?.getActivePreparationStatus() ?? null;
        if (activePreparation) {
            this.showTechnicalMemoryNotice(
                this.buildTechnicalMemoryInProgressModel(activePreparation, this.vss.getMaintenanceState()),
                5000,
            );
            return;
        }

        const stats = await this.vss.getStats({ mode: "manual" });
        const maintenance = this.vss.getMaintenanceState();
        this.showTechnicalMemoryNotice(this.buildTechnicalMemoryStatusModel(stats, maintenance), 7000);
    }

    async runManualMemoryAction(action: () => Promise<void>): Promise<void> {
        await this.memoryIntegration.runManualAction(action, () => {
            new Notice(this.t("plugin.memory.notice.actionAlreadyRunning"), 4000);
        });
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

        if (stats.lexicalProfileState) {
            details.push({
                label: this.t("plugin.memory.diagnostics.lexicalIndex"),
                value: stats.lexicalProfileState,
                tone: stats.lexicalProfileState === "failed" ? "danger"
                    : stats.lexicalProfileState === "awaiting_confirmation"
                        || stats.lexicalProfileState === "stale"
                        || stats.lexicalProfileState === "rebuilding" ? "warning" : undefined,
            });
        }
        if (stats.lexicalFallbackReason) {
            details.push({
                label: this.t("plugin.memory.diagnostics.lexicalReason"),
                value: stats.lexicalFallbackReason,
            });
        }

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

    private buildTechnicalMemoryInProgressModel(
        activePreparation: MemoryPreparationStatus,
        maintenance: TechnicalMemoryMaintenance,
    ): TechnicalMemoryNoticeModel {
        const maintenanceText = this.formatTechnicalMaintenanceState(maintenance);
        const details: TechnicalMemoryDetail[] = [
            {
                label: this.t("plugin.memory.diagnostics.activeOperation"),
                value: activePreparation.action === "refresh"
                    ? this.t("plugin.memory.diagnostics.operation.update")
                    : this.t("plugin.memory.diagnostics.operation.prepare"),
                tone: "warning",
            },
            {
                label: this.t("plugin.memory.diagnostics.progress"),
                value: activePreparation.message,
                tone: "warning",
            },
            {
                label: this.t("plugin.memory.diagnostics.maintenance"),
                value: maintenanceText,
                tone: maintenanceText === this.t("plugin.memory.diagnostics.maintenance.upToDate") ? undefined : "warning",
            },
        ];

        return {
            title: this.t("plugin.memory.diagnostics.title"),
            summary: this.t("plugin.memory.diagnostics.status.inProgress"),
            summaryTone: "warning",
            details,
            notes: [this.t("plugin.memory.diagnostics.inProgressNote")],
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
        notice.messageEl.addClass("pa-notice-shell");
        notice.messageEl.parentElement?.addClass("pa-notice-shell");
        notice.messageEl.setCssStyles({
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
            && this.hasConfirmedMemoryExtractionConsent()
            && this.getAISetupIssue() === null;
    }

    showAiInsights(): void {
        if (!this.canShowAiInsights()) return;
        const rawContext = this.memoryExtractionScheduler?.getInsightsViewerContext() ?? {};
        const memoryTargets = this.getAiInsightsMemoryTargets();
        const context = this.getMemoryGovernanceUiMode() === "legacy_threshold"
            ? rawContext
            : rawContext.vaultInsights
                ? { vaultInsights: rawContext.vaultInsights }
                : {};
        this.openInsightsViewer(context, memoryTargets);
    }

    private getAiInsightsMemoryTargets(): AiInsightsMemoryTarget[] {
        const governed = this.getGovernedMemoryViewSnapshot();
        if (!governed) return [];
        return governed.records.flatMap((entry): AiInsightsMemoryTarget[] => {
            if (entry.record.lifecycle === "forgotten_tombstone"
                || entry.useStatus !== "active"
                || (entry.effect !== "future_answers" && entry.effect !== "collaboration_default")
                || !entry.projectionLinks.some((link) => (
                    link.target.kind === "type_a_profile"
                ))) return [];
            return [{
                claimId: entry.claimId,
                summary: entry.record.summary,
                effect: entry.effect,
            }];
        });
    }

    private openInsightsViewer(
        context: { userProfile?: string; vaultInsights?: string },
        memoryTargets: readonly AiInsightsMemoryTarget[] = [],
    ): void {
        const title = this.t("plugin.insightsViewer.title");
        const emptyText = this.t("plugin.insightsViewer.noInsights");
        const traceTitle = this.t("plugin.insightsViewer.savedUnderstanding.title");
        const traceSource = this.t("plugin.insightsViewer.savedUnderstanding.source");
        const openTargetText = this.t("plugin.insightsViewer.savedUnderstanding.openTarget");
        const openOverviewText = this.t("plugin.insightsViewer.savedUnderstanding.openOverview");
        const effectFutureAnswers = this.t("plugin.insightsViewer.savedUnderstanding.effect.futureAnswers");
        const effectCollaboration = this.t(
            "plugin.insightsViewer.savedUnderstanding.effect.collaborationDefault",
        );
        const app = this.app;
        const openMemorySettings = (targetId?: string) => this.openMemorySettings(targetId);
        const logRenderError = (message: string, error: unknown) => this.log(message, error);
        const modal = new class extends Modal {
            private renderHost = new Component();

            onOpen(): void {
                this.renderHost.load();
                this.contentEl.empty();
                this.contentEl.addClass("pa-insights-viewer");
                this.contentEl.createEl("h2", { text: title });

                if (!context.userProfile && !context.vaultInsights && memoryTargets.length === 0) {
                    this.contentEl.createEl("p", {
                        cls: "pa-insights-viewer__empty",
                        text: emptyText,
                    });
                    return;
                }

                if (context.userProfile) {
                    const section = this.contentEl.createDiv({ cls: "pa-insights-viewer__section" });
                    void Promise.resolve(MarkdownRenderer.render(app, context.userProfile, section, "", this.renderHost)).catch((error) => {
                        logRenderError("Failed to render user profile insights", error);
                    });
                }
                if (context.vaultInsights) {
                    const section = this.contentEl.createDiv({ cls: "pa-insights-viewer__section" });
                    void Promise.resolve(MarkdownRenderer.render(app, context.vaultInsights, section, "", this.renderHost)).catch((error) => {
                        logRenderError("Failed to render vault insights", error);
                    });
                }
                if (memoryTargets.length > 0) {
                    const section = this.contentEl.createDiv({ cls: "pa-insights-viewer__section" });
                    section.createEl("h3", { text: traceTitle });
                    for (const target of memoryTargets) {
                        const row = section.createDiv({ cls: "pa-insights-viewer__memory-trace" });
                        row.createEl("p", { text: target.summary });
                        row.createEl("p", {
                            text: `${traceSource} · ${target.effect === "collaboration_default"
                                ? effectCollaboration
                                : effectFutureAnswers}`,
                        });
                        const button = row.createEl("button", {
                            text: openTargetText,
                            attr: { type: "button" },
                        });
                        button.addEventListener("click", () => {
                            this.close();
                            openMemorySettings(target.claimId);
                        });
                    }
                }
                if (context.vaultInsights) {
                    const button = this.contentEl.createEl("button", {
                        text: openOverviewText,
                        attr: { type: "button" },
                    });
                    button.addEventListener("click", () => {
                        this.close();
                        openMemorySettings();
                    });
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
        if (checking) return this.hasStructuralAIConfiguration("memory");
        if (!this.ensureAIConfigured("memory")) return true;
        void this.runManualMemoryAction(action).catch((error) => {
            this.log("Memory command failed", error);
            new Notice(this.t("plugin.notice.memoryActionFailed"), 5000);
        });
        return true;
    }

    private hasStructuralAIConfiguration(scope: AIReadinessScope): boolean {
        const issue = this.getAIReadiness(scope).issue;
        return issue === null || issue === "token_unknown" || issue === "token_missing";
    }

    private ensureAIConfigured(scope: AIReadinessScope = "chat"): boolean {
        if (this.hasActiveAIProviderCredentialTransition()) {
            const issue = this.getAISetupIssue(scope);
            if (issue) new Notice(issue, 5000);
            return false;
        }
        if (this.getAIReadiness(scope).issue === "token_unknown") {
            this.refreshAPITokenPresence();
            void this.notifySettingsChanged();
            void this.updateMemoryStatusBar();
        }
        const issue = this.getAISetupIssue(scope);
        if (!issue) return true;
        new Notice(issue, 5000);
        return false;
    }

    /**
     * 迁移旧版本设置到新版本
     */
    private async migrateSettings(): Promise<void> {
        await this.settingsPersistence.migrateSettings();
    }

    getAPITokenSecretId(): string {
        return this.aiConfiguration.getAPITokenSecretId();
    }

    getImageAPITokenSecretId(): string {
        return this.aiConfiguration.getImageAPITokenSecretId();
    }

    getImageGenerationConnection(): ImageGenerationConnection | null {
        return this.aiConfiguration.getImageGenerationConnection();
    }

    getConfiguredImageAPITokenSecret(): string | null {
        return this.aiConfiguration.getConfiguredImageAPITokenSecret();
    }

    private async confirmImageGenerationFirstUse(): Promise<boolean> {
        if (this.settings.imageGenerationFirstUseNoticeShown) return true;
        const approved = await confirmUserAction(this.app, {
            title: this.t('plugin.imageGeneration.firstUseTitle'),
            message: this.t('plugin.imageGeneration.firstUseMessage'),
            confirmText: this.t('plugin.imageGeneration.firstUseConfirm'),
        });
        if (!approved) return false;
        await this.enqueueSettingsWrite(async () => {
            if (this.unloading) throw new Error('Plugin is unloading');
            await this.saveSettingsData({ ...this.settings, imageGenerationFirstUseNoticeShown: true });
            this.settings.imageGenerationFirstUseNoticeShown = true;
        });
        return true;
    }

    async setImageAPITokenSecret(value: string): Promise<void> {
        await this.aiConfiguration.setImageAPITokenSecret(value);
    }

    async saveImageGenerationConnectionSettings(patch: ImageGenerationConnectionPatch): Promise<void> {
        await this.aiConfiguration.saveImageGenerationConnectionSettings(patch);
    }

    getConfiguredAPITokenSecret(): string | null {
        return this.aiConfiguration.getConfiguredAPITokenSecret();
    }

    setAPITokenSecret(value: string, origin: "settings" | "inline-setup" = "settings"): void {
        this.aiConfiguration.setAPITokenSecret(value, origin);
    }

    hasConfiguredAPIToken(): boolean {
        return this.aiConfiguration.hasConfiguredAPIToken();
    }

    hasTokenCachedValue(): boolean | null {
        return this.aiConfiguration.hasTokenCachedValue();
    }

    getAPITokenCacheState(): APITokenCacheState {
        return this.aiConfiguration.getTokenCacheState();
    }

    refreshAPITokenPresence(): APITokenCacheState {
        return this.aiConfiguration.refreshAPITokenPresence();
    }

    getAIReadiness(scope: AIReadinessScope = "chat"): AIReadinessSnapshot {
        return this.aiConfiguration.getAIReadiness(scope);
    }

    getAISetupIssue(scope: AIReadinessScope = "chat"): string | null {
        return this.aiConfiguration.getAISetupIssue(scope);
    }

    async getAPIToken(): Promise<string> {
        return this.aiConfiguration.getAPIToken();
    }

    clearTokenCache(): void {
        this.aiConfiguration.clearTokenCache();
    }

    cancelActiveMemoryPreparation(): void {
        this.memoryManager?.cancelActivePreparation();
    }

    updateAIProviderConfiguration(
        patch: AIProviderConfigurationPatch,
        invocationEpoch: number,
    ): Promise<AISetupResult> {
        return this.aiConfiguration.updateAIProviderConfiguration(patch, invocationEpoch);
    }

    private completeAISetup(input: AISetupInput): Promise<AISetupResult> {
        return this.aiConfiguration.completeAISetup(input);
    }
}

function coerceModelResultToString(result: unknown): string {
    if (typeof result === "string") return result;
    const content = (result as { content?: unknown })?.content;
    return content != null ? String(content) : String(result);
}



function createStatisticsVaultId(): string {
    const cryptoApi = getPlatformCrypto() as (Crypto & { randomUUID?: () => string }) | undefined;
    if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
        return cryptoApi.randomUUID();
    }
    return `statistics-vault-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
