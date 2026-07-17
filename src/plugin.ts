/* Copyright 2023 edonyzpc */

import { type Debouncer, type MarkdownFileInfo, Component, Editor, MarkdownRenderer, MarkdownView, Modal, Notice, Platform, Plugin, TFile, addIcon, debounce, moment as obsidianMoment, normalizePath, setIcon } from 'obsidian';
import { type CalloutManager, getApi } from "obsidian-callout-manager";

import { PA_CHAT_SUBAGENT_ICON, VIEW_TYPE_LLM, LLMView } from "./chat/chat-view";
import { AssistantFeaturedImageHelper, AssistantHelper } from "./ai";
import { AIUtils, getDashScopeImageGenerationEndpoint } from "./ai-services/ai-utils";
import { stableStringify } from "./ai-services/agent-utils";
import { ChatService } from "./ai-services/chat-service";
import { VSS } from './vss'
import { PluginControlModal } from './modal'
import { BatchPluginControlModal } from './batch-modal'
import { SettingTab, type PluginManagerSettings, DEFAULT_SETTINGS, normalizeEnabledSkillIds, mergeLoadedSettings, isFreshInstall, isLegacyV1Install, normalizeFeaturedImageModel, normalizeFeaturedImageCount, normalizeConfirmedMemoryCount, isMemoryExtractionConsentConfirmed, MEMORY_EXTRACTION_CONSENT_VERSION } from './settings'
import { OPERATIONS_AGENT_RUNTIME_ENABLED } from "./operations-agent-flags";
import { LocalGraph } from './local-graph';
import { openSettings, openSettingsTab } from './obsidian-internals';
import { KEYCHAIN_API_TOKEN_ID, getVaultApiTokenId, hasSecretValue, icons } from './utils';
import { PluginsUpdater } from './plugin-manifest';
import { ThemeUpdater } from './theme-manifest';
import { CalloutModal } from './callout';
import { RecordPreview, RECORD_PREVIEW_TYPE } from './preview';
import { STAT_PREVIEW_TYPE, Stat } from './stats-view'
import StatsManager from './stats/stats-manager'
import { pluginField, statusBarEditorPlugin, sectionWordCountEditorPlugin } from './stats/editor-plugin'
import { normalizeStatisticsView } from './stats/stats-store';
import type { EditorPluginHost } from './stats/EditorPluginHost';
import type { StatsHost } from './stats/StatsHost';
import { MemoryManager, type MemoryPreparationStatus } from './memory-manager';
import { getVaultConfigDir, getVaultConfigDirStorageScope, joinVaultConfigPath, LEGACY_CONFIG_DIR, uniqueNormalizedPaths } from './obsidian-paths';
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
    clearPageletDetailSessionCache,
    registerPageletDetailIcon,
    type PageletDetailPayload,
} from './pagelet/tab';
import type { AnalyzeCallback } from './pagelet/preload/types';
import type {
    DiscoveryResult,
    PanelMemoryActionPolicy,
    PanelMemoryGovernanceRecord,
    PanelMemoryGovernanceState,
    PanelMemoryRecentChange,
    PanelMemoryUseStatus,
} from './pagelet/panel/types';
import type { MemoryRecordActionResult } from './pagelet/tab/sections/types';
import { buildDiscoveryPrompt, buildPreloadPrompt, parseStructuredResponse } from './pagelet/llm';
import { buildDiscoveryResultFromFindings } from './pagelet/DiscoveryAnalyzer';
import { buildPageletRelatedNotesQuery } from './pagelet/related-notes-query';
import {
    MemoryExtractionScheduler,
    SerializedProfileGovernancePort,
    createExistingUserProfileReader,
    createUserProfileStore,
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
import type { PaAgentInjectedContext } from './ai-services/context';
import type { MemoryHost } from './memory';
import type { ChatHost } from './chat/ChatHost';
import {
    QUICK_CAPTURE_COMMAND_ID,
    QUICK_CAPTURE_COMMAND_NAME,
    QuickCaptureService,
    type QuickCapturePostProcessInput,
} from './quick-capture';
import { runQuickCaptureEnrichment } from './quick-capture-enrichment';
import {
    ActiveVaultIndexer,
    CallbackMemoryGovernanceRecordRepository,
    CallbackReviewQueueRepository,
    MemoryGovernanceStore,
    RetrievalHabitProfileStore,
    ReviewQueueStore,
    SavedInsightStore,
    type ConfirmedMemoryRecord,
    type GraphDiscoveryNote,
    type GraphDiscoveryRunResult,
    type MaintenanceReviewNote,
    type MaintenanceReviewRunResult,
    type MaintenanceMoveActionLogEntry,
    type MaintenanceMoveApplyResult,
    type MaintenanceMoveUndoResult,
    type MemoryGovernanceRecordRepository,
    type MemoryGovernanceState,
    type PatternDetectionInput,
    type PatternDetectionResult,
    type QuietRecallCandidate,
    type QuietRecallRelatedNote,
    type QuietRecallRunResult,
    type QuietRecallSaveResult,
    type QuietRecallVaultNote,
    type RetrievalHabitFeedbackKind,
    type RetrievalHabitProfileRecordResult,
    type ReviewQueueCreateInput,
    type ReviewQueueItem,
    type ReviewQueueListFilter,
    type ReviewQueueResult,
    type ReviewQueueRepository,
    type ReviewQueueState,
    type ReviewQueueStatus,
    type SavedInsight,
    type ScopeRecapRunResult,
    type ScopeRecapSourceNote,
    addPaRelatedLink,
    applyMaintenanceMoveProposal,
    applyRetrievalHabitProfileToRecallCandidates,
    buildQuietRecallCandidates,
    buildQuietRecallWithLlm,
    buildRecallRelevancePrompt,
    buildRecapInsightsPrompt,
    buildScopeRecapWithLlm,
    detectLanguageMismatch,
    parseRecallRelevanceResponse,
    parseRecapInsightsResponse,
    type GenerateRecapInsightsCallback,
    type RecallRelevanceEvaluator,
    QUIET_RECALL_BUBBLE_MIN_SCORE,
    canAutoConfirmMemoryCandidate,
    coerceQuietRecallSaveResult,
    detectCrossNotePatterns,
    findMaintenanceActionLogEntry,
    discoverLightweightGraphItems,
    graphDiscoveryItemToReviewQueueInput,
    maintenanceProposalToReviewQueueInput,
    memoryCandidateFromQueueItem,
    quietRecallLinkTargetPath,
    quietRecallCandidateToSavedInsightInput,
    scanMaintenanceReview,
    undoMaintenanceMoveAction,
    type MaintenanceProposal,
} from './pa';
import { classifyLegacyTypeAAdoption } from './pa/legacy-type-a-adoption';
import {
    MemoryAdmissionCoordinator,
    readTypeATargetGeneration,
    type GovernedMemoryAdmissionInput,
    type TypeAAdmissionBaseline,
} from './pa/memory-admission-coordinator';
import { LegacyMemoryCompatibilityBarrier } from './pa/memory-governance-compatibility';
import {
    MemoryGovernanceFinalizationCoordinator,
    previewMemoryGovernanceFinalization,
    type LegacyMemoryFinalizationSourceSnapshot,
} from './pa/memory-governance-finalization';
import {
    MemoryGovernanceMigrationCoordinator,
    checksumLegacyRollbackValue,
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
    type LegacyRollbackValue,
    type MemoryClaimRevision,
    type MemoryGovernanceRepository,
    type MemoryPartitionKey,
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
import {
    MemoryGovernanceCoordinator,
    type ExactMemoryProjectionCleanupPort,
    type LegacyCompatibilityForgetPrepareResult,
} from './pa/memory-governance-coordinator';
import { withMemoryExternalOperationTimeout } from './pa/memory-external-operation-timeout';
import { MemoryProfileProjectionWorker } from './pa/memory-profile-projection-worker';
import { buildGovernedMemoryViewSnapshot } from './pa/memory-governance-view';
import {
    createMemoryReviewQueueRepository,
    type MemoryReviewQueueRepository,
} from './pa/memory-review-queue-repository';
import {
    decideDataBoundaryForSource,
    MEMORY_SENSITIVITIES,
    MEMORY_TYPES,
    type DataBoundaryDecision,
    type MemorySensitivity,
    type MemoryType,
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
import {
    selectGovernedMemoryUse,
    type MemorySuppressionFingerprintRef,
} from './pa/memory-use-projection';
import { includesString, stableHash } from './pa/helpers';
import { getMemoryTrustLevel } from './pa/memory-trust-level';

const CALLOUT_MANAGER_PLUGIN_ID = 'callout-manager';
const CALLOUT_MANAGER_READY_TIMEOUT_MS = 2000;
const CALLOUT_MANAGER_READY_POLL_MS = 50;
const MEMORY_STARTUP_EVENT_REPLAY_WINDOW_MS = 90_000;
const MEMORY_STARTUP_EVENT_MTIME_GRACE_MS = 5_000;
const QUIET_RECALL_MAX_VAULT_CANDIDATE_NOTES = 40;
const PATTERN_DETECTION_RECENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const PATTERN_DETECTION_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;
const PATTERN_DETECTION_MIN_ACTIVE_NOTES = 5;
const PATTERN_DETECTION_MAX_SOURCE_NOTES = 80;
const PAGELET_MAINTENANCE_ONBOARDING_MIN_NOTES = 50;
const MEMORY_GOVERNANCE_OPAQUE_KEY_VERSION = "memory-governance-v1";
// The repository passed the Memory control-center SDD's real two-vault
// Obsidian probe: one device-shared IndexedDB, distinct opaque vault keys,
// monotonic cross-window commits/invalidation, and vault-partition isolation.
// Scope widening still requires the explicit user action enforced below.
const DEVICE_COLLABORATION_SCOPE_VALIDATED = true;

type MemoryGovernanceBootstrapState = "not_started" | "ready" | "failed";

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

type MemoryGovernanceBootstrapErrorCode =
    | "legacy_save_collision"
    | "migration_failed"
    | "profile_read_failed"
    | "profile_readback_mismatch"
    | "memory_mutation_blocked"
    | "policy_state_invalid"
    | "vault_identity_unavailable";

class MemoryGovernanceBootstrapError extends Error {
    constructor(readonly code: MemoryGovernanceBootstrapErrorCode) {
        super(`Memory governance bootstrap failed: ${code}`);
        this.name = "MemoryGovernanceBootstrapError";
    }
}

export function createMemoryGovernanceOpaqueVaultKey(
    statisticsVaultId: string,
    deviceVaultScope: string,
): string {
    const normalizedDeviceScope = deviceVaultScope.trim();
    if (!normalizedDeviceScope) {
        throw new Error("A device-local vault scope is required.");
    }
    const source = [
        statisticsVaultId.trim() || "default-vault",
        normalizedDeviceScope,
    ].join("\n");
    const digest = ["0", "1", "2", "3"]
        .map((lane) => stableHash(`${MEMORY_GOVERNANCE_OPAQUE_KEY_VERSION}:${lane}:${source}`))
        .join("");
    return `vault-${digest}`;
}

function getMemoryGovernanceVaultDeviceScope(vault: {
    configDir?: string;
    getName?: () => string;
    adapter?: unknown;
}): string | null {
    let localPath = "";
    const adapter = vault.adapter as {
        getBasePath?: () => string;
        getFullPath?: (path: string) => string;
    } | undefined;
    try {
        if (typeof adapter?.getBasePath === "function") {
            localPath = adapter.getBasePath();
        } else if (typeof adapter?.getFullPath === "function") {
            localPath = adapter.getFullPath("");
        }
    } catch {
        // A guessed name/config-dir identity could collide after a vault copy.
        // The caller keeps governed device-local state disabled instead.
    }
    const normalizedLocalPath = localPath.trim();
    return normalizedLocalPath || null;
}

interface QuietRecallVaultNoteCollection {
    vaultNotes: QuietRecallVaultNote[];
    relatedNotes: QuietRecallRelatedNote[];
}

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

function parentFolder(path: string): string {
    const normalized = normalizePath(path).replace(/^\.\//, "");
    const slash = normalized.lastIndexOf("/");
    return slash > 0 ? normalized.slice(0, slash) : "";
}

export function buildMemoryDataBoundaryFingerprint(
    settings: Readonly<PluginManagerSettings["dataBoundary"]>,
): string {
    const canonical = {
        excludedFolders: [...settings.excludedFolders].map((value) => value.trim()).filter(Boolean).sort(),
        excludedTags: [...settings.excludedTags]
            .map((value) => value.trim().replace(/^#+/, "").toLowerCase())
            .filter(Boolean)
            .sort(),
        generatedNotePolicy: settings.generatedNotePolicy,
        providerDisclosureReasons: [...settings.providerDisclosureReasons].sort(),
        cleanupGroups: [...settings.cleanupGroups].sort(),
    };
    return `data_boundary:${stableHash(JSON.stringify(canonical))}`;
}

function collectStringValues(value: unknown, output: Set<string>): void {
    if (Array.isArray(value)) {
        value.forEach((entry) => collectStringValues(entry, output));
        return;
    }
    if (typeof value === "string" && value.trim()) {
        output.add(value.trim());
    }
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
const PAGELET_FOREGROUND_REVIEW_TIMEOUT_MS = 120_000;
const VAULT_INSIGHTS_INJECTION_NOTICE_KEY = "pa-vault-insights-injection-notice";
const PAGELET_RATE_LIMIT_STORAGE_KEY_PREFIX = "pa-pagelet-rate-limit";
const PAGELET_RELATED_NOTES_TIMEOUT_MS = 8000;
const MEMORY_FORGET_RETRY_INITIAL_MS = 1_000;
const MEMORY_FORGET_RETRY_MAX_MS = 60_000;
const MEMORY_PROFILE_PROJECTION_RETRY_INITIAL_MS = 1_000;
const MEMORY_PROFILE_PROJECTION_RETRY_MAX_MS = 60_000;
const MEMORY_GOVERNANCE_GARBAGE_COLLECTION_RETRY_MS = 60_000;
const MEMORY_GOVERNANCE_COMPLETED_HISTORY_RETENTION_MS = 7 * 24 * 60 * 60_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
type TimeoutHandle = PlatformTimeoutHandle;
type IntervalHandle = PlatformIntervalHandle;

function nextMemoryGovernanceGarbageCollectionAt(
    state: DeviceMemoryGovernanceStateV1,
): number | null {
    const expirations: number[] = [];
    const retainedUndoSnapshotIds = new Set(state.undoSnapshots.map((snapshot) => snapshot.id));
    for (const snapshot of state.undoSnapshots) {
        const expiresAt = Date.parse(snapshot.expiresAt);
        if (Number.isFinite(expiresAt)) expirations.push(expiresAt);
    }
    const now = Date.now();
    const eventById = new Map(state.changeEvents.map((event) => [event.id, event]));
    const retainedEventIds = new Set<string>();
    const eventDeadlines = new Map<string, number>();
    for (const event of state.changeEvents) {
        const occurredAt = Date.parse(event.occurredAt);
        if (!Number.isFinite(occurredAt)) {
            retainedEventIds.add(event.id);
            continue;
        }
        const deadline = occurredAt + MEMORY_GOVERNANCE_COMPLETED_HISTORY_RETENTION_MS;
        eventDeadlines.set(event.id, deadline);
        if (deadline >= now
            || (event.undoSnapshotId && retainedUndoSnapshotIds.has(event.undoSnapshotId))) {
            retainedEventIds.add(event.id);
        }
    }
    const pendingAncestors = [...retainedEventIds];
    while (pendingAncestors.length > 0) {
        const retained = eventById.get(pendingAncestors.pop()!);
        if (!retained?.undoesEventId || retainedEventIds.has(retained.undoesEventId)) continue;
        retainedEventIds.add(retained.undoesEventId);
        pendingAncestors.push(retained.undoesEventId);
    }
    for (const event of state.changeEvents) {
        const deadline = eventDeadlines.get(event.id);
        if (deadline === undefined) continue;
        const protectedBySnapshot = Boolean(
            event.undoSnapshotId && retainedUndoSnapshotIds.has(event.undoSnapshotId),
        );
        if (protectedBySnapshot) continue;
        if (deadline >= now || !retainedEventIds.has(event.id)) {
            expirations.push(deadline);
        }
    }
    for (const operation of state.pendingOperations) {
        if (operation.kind !== "profile_projection" || operation.state !== "applied") continue;
        const updatedAt = Date.parse(operation.updatedAt);
        if (Number.isFinite(updatedAt)) {
            expirations.push(updatedAt + MEMORY_GOVERNANCE_COMPLETED_HISTORY_RETENTION_MS);
        }
    }
    for (const [vaultKey, migration] of Object.entries(state.migrationStates)) {
        if (migration.phase === "finalizing" || migration.phase === "rolling_back") continue;
        const policy = state.policyStates[vaultKey];
        if (migration.phase === "compatibility"
            && (!policy
                || policy.contextProjectionMode !== "governed"
                || policy.mode !== "effect_based")) continue;
        if (!migration.rollbackExpiresAt) continue;
        const expiresAt = Date.parse(migration.rollbackExpiresAt);
        if (Number.isFinite(expiresAt)) expirations.push(expiresAt);
    }
    return expirations.length > 0 ? Math.min(...expirations) : null;
}

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

function readCurrentLocalMemoryPolicy(
    state: DeviceMemoryGovernanceStateV1,
    opaqueVaultKey: string,
    expectedSourceHash: string,
): { confirmedMemoryCount: number; memoryAutoAcceptPaused: boolean } {
    const migration = state.migrationStates[opaqueVaultKey];
    const policy = state.policyStates[opaqueVaultKey];
    const baseline = policy?.legacyBaseline;
    if (!migration
        || (migration.phase !== "compatibility"
            && migration.phase !== "finalizing"
            && migration.phase !== "finalized")
        || migration.sourceHash !== expectedSourceHash
        || (migration.phase !== "finalizing" && migration.lastErrorCode)
        || (policy?.mode !== "legacy_threshold" && policy?.mode !== "effect_based")
        || !baseline
        || baseline.importedFromSourceHash !== expectedSourceHash
        || !Number.isSafeInteger(baseline.confirmedCount)
        || baseline.confirmedCount < 0
        || typeof baseline.autoAcceptPaused !== "boolean") {
        throw new MemoryGovernanceBootstrapError("policy_state_invalid");
    }
    return {
        confirmedMemoryCount: baseline.confirmedCount,
        memoryAutoAcceptPaused: baseline.autoAcceptPaused,
    };
}

function writeCurrentLocalMemoryPolicy(
    state: DeviceMemoryGovernanceStateV1,
    opaqueVaultKey: string,
    expectedSourceHash: string,
    next: Partial<{ confirmedMemoryCount: number; memoryAutoAcceptPaused: boolean }>,
    now: Date,
): { confirmedMemoryCount: number; memoryAutoAcceptPaused: boolean } {
    const current = readCurrentLocalMemoryPolicy(state, opaqueVaultKey, expectedSourceHash);
    const migration = state.migrationStates[opaqueVaultKey];
    const policy = state.policyStates[opaqueVaultKey];
    const baseline = policy.legacyBaseline!;
    const confirmedMemoryCount = next.confirmedMemoryCount ?? current.confirmedMemoryCount;
    const memoryAutoAcceptPaused = next.memoryAutoAcceptPaused ?? current.memoryAutoAcceptPaused;
    if (!Number.isSafeInteger(confirmedMemoryCount) || confirmedMemoryCount < 0) {
        throw new MemoryGovernanceBootstrapError("policy_state_invalid");
    }

    const rollbackExpiresAt = Date.parse(migration.rollbackExpiresAt ?? "");
    const rollbackJournalActive = migration.phase === "compatibility"
        && Number.isFinite(rollbackExpiresAt)
        && rollbackExpiresAt >= now.getTime();
    if (!rollbackJournalActive) {
        if (policy.contextProjectionMode !== "governed"
            || (migration.phase !== "compatibility" && migration.phase !== "finalized")) {
            throw new MemoryGovernanceBootstrapError("policy_state_invalid");
        }
        baseline.confirmedCount = confirmedMemoryCount;
        baseline.autoAcceptPaused = memoryAutoAcceptPaused;
        return { confirmedMemoryCount, memoryAutoAcceptPaused };
    }
    if (!buildLegacyMemoryRollbackProjection(state, opaqueVaultKey, now).ok) {
        throw new MemoryGovernanceBootstrapError("policy_state_invalid");
    }

    const partition: MemoryPartitionKey = { kind: "vault", key: opaqueVaultKey };
    const policyEntityIds = new Set(state.rollbackPayloadEntries
        .filter((entry) => entry.migrationRunId === migration.migrationRunId
            && entry.partition.kind === "vault"
            && entry.partition.key === opaqueVaultKey
            && entry.value.kind === "policy")
        .map((entry) => entry.entityId));
    if (policyEntityIds.size !== 1 || !migration.rollbackExpiresAt) {
        throw new MemoryGovernanceBootstrapError("policy_state_invalid");
    }
    const deltas = state.migrationDeltas
        .filter((delta) => delta.migrationRunId === migration.migrationRunId)
        .sort((left, right) => left.sequence - right.sequence);
    deltas.forEach((delta, index) => {
        if (delta.sequence !== index + 1
            || delta.partition.kind !== "vault"
            || delta.partition.key !== opaqueVaultKey) {
            throw new MemoryGovernanceBootstrapError("policy_state_invalid");
        }
    });
    const sequence = deltas.length + 1;
    const value: LegacyRollbackValue = {
        kind: "policy",
        confirmedMemoryCount,
        memoryAutoAcceptPaused,
    };
    const checksum = checksumLegacyRollbackValue(value);
    const entityId = [...policyEntityIds][0];
    const payloadId = [
        "memory-policy-rollback",
        stableHash(migration.migrationRunId),
        sequence,
        stableHash(`${entityId}:${checksum}`),
    ].join("-");
    if (state.rollbackPayloadEntries.some((entry) => entry.id === payloadId)) {
        throw new MemoryGovernanceBootstrapError("policy_state_invalid");
    }

    baseline.confirmedCount = confirmedMemoryCount;
    baseline.autoAcceptPaused = memoryAutoAcceptPaused;
    state.rollbackPayloadEntries.push({
        id: payloadId,
        migrationRunId: migration.migrationRunId,
        partition,
        entityId,
        value,
        checksum,
        expiresAt: migration.rollbackExpiresAt,
    });
    state.migrationDeltas.push({
        sequence,
        migrationRunId: migration.migrationRunId,
        partition,
        committedAt: now.toISOString(),
        kind: "policy_changed",
        entityId,
        payloadEntryId: payloadId,
        payloadChecksum: checksum,
    });
    if (!buildLegacyMemoryRollbackProjection(state, opaqueVaultKey, now).ok) {
        throw new MemoryGovernanceBootstrapError("policy_state_invalid");
    }
    return { confirmedMemoryCount, memoryAutoAcceptPaused };
}

function createFailClosedMemoryRecordRepository(
    records: readonly ConfirmedMemoryRecord[],
): MemoryGovernanceRecordRepository {
    const snapshot = cloneSerializable({ records: [...records] } satisfies MemoryGovernanceState);
    return {
        read: () => cloneSerializable(snapshot),
        write: async () => {
            throw new MemoryGovernanceBootstrapError("memory_mutation_blocked");
        },
    };
}

function createFailClosedReviewQueueRepository(
    items: readonly ReviewQueueItem[],
    persist: (state: ReviewQueueState) => Promise<void>,
): ReviewQueueRepository {
    let snapshot: ReviewQueueState = cloneSerializable({ items: [...items] });
    return {
        read: () => cloneSerializable(snapshot),
        write: async (next) => {
            const nextState = cloneSerializable(next);
            if (memoryQueueFingerprint(snapshot.items) !== memoryQueueFingerprint(nextState.items)) {
                throw new MemoryGovernanceBootstrapError("memory_mutation_blocked");
            }
            await persist(nextState);
            snapshot = nextState;
        },
    };
}

function memoryQueueFingerprint(items: readonly ReviewQueueItem[]): string {
    return JSON.stringify(items
        .filter((item) => item.type === "memory_candidate" || item.type === "memory_conflict")
        .map((item) => cloneSerializable(item))
        .sort((left, right) => left.id.localeCompare(right.id)));
}

function cloneSerializable<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
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
    private manualMemoryActionInFlight = false;
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
    private reviewQueueStore: ReviewQueueStore | null = null;
    private savedInsightStore: SavedInsightStore | null = null;
    private memoryGovernanceStore: MemoryGovernanceStore | null = null;
    private legacyMemoryCompatibilityBarrier: LegacyMemoryCompatibilityBarrier | null = null;
    private legacyMemoryPayload: LegacyMemoryPayload | null = null;
    private memoryGovernanceBootstrapState: MemoryGovernanceBootstrapState = "not_started";
    private memoryGovernanceBootstrapErrorCode: string | null = null;
    private memoryGovernanceOpaqueVaultKey: string | null = null;
    private memoryGovernanceSourceHash: string | null = null;
    private deviceMemoryGovernanceRepository: MemoryGovernanceRepository | null = null;
    private currentDeviceMemoryGovernanceState: DeviceMemoryGovernanceStateV1 | null = null;
    private memoryGovernanceCoordinator: MemoryGovernanceCoordinator | null = null;
    private memoryAdmissionCoordinator: MemoryAdmissionCoordinator | null = null;
    private memoryProfileProjectionWorker: MemoryProfileProjectionWorker | null = null;
    private memoryForgetRetryTimer: TimeoutHandle | null = null;
    private memoryForgetRetryDelayMs = MEMORY_FORGET_RETRY_INITIAL_MS;
    private memoryProfileProjectionRetryTimer: TimeoutHandle | null = null;
    private memoryProfileProjectionRetryDelayMs = MEMORY_PROFILE_PROJECTION_RETRY_INITIAL_MS;
    private memoryGovernanceGarbageCollectionTimer: TimeoutHandle | null = null;
    private memoryGovernanceGarbageCollectionDueAt: number | null = null;
    private memoryLifecycleMutationTail: Promise<void> = Promise.resolve();
    private deviceMemoryRecordRepository: DeviceMemoryGovernanceRecordRepository | null = null;
    private deviceMemoryReviewQueueRepository: MemoryReviewQueueRepository | null = null;
    private memoryGovernanceRecordRepository: MemoryGovernanceRecordRepository | null = null;
    private reviewQueueRepository: ReviewQueueRepository | null = null;
    private settingsReviewQueueRepository: ReviewQueueRepository | null = null;
    private memoryGovernanceRepositoryUnsubscribe: (() => void) | null = null;
    private deviceMemoryCacheRefreshPromise: Promise<void> | null = null;
    private deviceMemoryCacheRefreshTargetSequence = 0;
    private currentLocalConfirmedMemoryCount: number | null = null;
    private currentLocalMemoryAutoAcceptPaused: boolean | null = null;
    private retrievalHabitProfileStore: RetrievalHabitProfileStore | null = null;
    private quickCaptureService: QuickCaptureService | null = null;
    private quickCaptureDraft = "";
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
    private pendingMemoryExtractionConsentMigration = false;
    vssCacheDir: string = this.join(this.app.vault.configDir, "plugins/personal-assistant/vss-cache");
    private isVssCached: boolean = false;
    private backlinkMapCache: { map: Map<string, string[]>; builtAt: number } | null = null;
    private static readonly BACKLINK_MAP_TTL_MS = 30_000;
    private token: string = "";
    private memoryStatusListeners = new Set<() => void | Promise<void>>();
    private settingsChangeListeners = new Set<() => void | Promise<void>>();
    private settingsSaveTail: Promise<void> | null = null;
    private memoryQueueAuditPromise: Promise<void> | null = null;
    private hoverPopoverObserver: MutationObserver | null = null;
    private resizeDebounceTimer: TimeoutHandle | null = null;
    private phase3Handle: PlatformTimeoutHandle | null = null;
    private unloading = false;
    private memoryEventGateStartedAt = Date.now();
    private debouncedStatusBarUpdate = debounce(() => {
        void this.updateMemoryStatusBar();
    }, 300, true);

    private get localGraph(): LocalGraph {
        return (this._localGraph ??= new LocalGraph(this.app, this));
    }

    private t(key: PluginMessageKey, params?: Readonly<Record<string, string | number>>, fallback?: string): string {
        return pluginT(key, getPluginUiLanguage(), params, fallback);
    }

    async onload() {
        this.memoryEventGateStartedAt = Date.now();
        await this.loadSettings();
        void this.cleanupLegacyMobileDebugLog();

        // 迁移旧版本设置
        try {
            await this.migrateSettings();
        } catch (error) {
            if (!(error instanceof MemoryGovernanceBootstrapError)
                || error.code !== "legacy_save_collision") throw error;
            this.failMemoryGovernanceBootstrap(
                this.memoryGovernanceBootstrapErrorCode ?? error.code,
            );
        }
        if (this.memoryGovernanceBootstrapState !== "failed") {
            await this.initializeMemoryGovernanceBootstrap();
        }

        // Surface the one-time Pagelet reviewsFolder migration Notice, if
        // `loadSettings` flagged a coerced value. We fire here (not in
        // `loadSettings`) so the Notice is bound to plugin onload and respects
        // the user's installed locale.
        this.surfacePendingPageletReviewsFolderMigration();
        this.surfacePendingMemoryExtractionConsentMigration();

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
            id: QUICK_CAPTURE_COMMAND_ID,
            name: QUICK_CAPTURE_COMMAND_NAME,
            callback: () => {
                this.openQuickCaptureModal();
            }
        });

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
                if (this.settings.aiProvider !== 'qwen' || !getDashScopeImageGenerationEndpoint(this.settings.baseURL)) return false;
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
        void this.reconcileMemoryQueueAudit();
        void this.maybeShowNextOnboardingNudge();
        void this.maybeRunPatternDetectionNudge();
        this.syncMemoryExtractionRuntime();
    }

    private async maybeShowNextOnboardingNudge(): Promise<void> {
        await this.maybeShowMaintenanceScanOnboardingNudge();
        if (this.pageletOrchestrator?.hasActiveOnboardingNudge) return;
        await this.maybeShowQuickCaptureOnboardingNudge();
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
                            void this.localGraph.resize().catch((error) => {
                                this.log("Failed to resize hover local graph", error);
                            });
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
            void this.reconcileMemoryQueueAudit();
        });
    }

    private registerVaultEventDispatch(): void {
        // VSS lifecycle events observe possible local changes; approved Memory can then maintain itself in the background.
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
                    await this.handleMemoryVaultChange(file, "vault-create");
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
                    await this.handleMemoryVaultChange(file, "vault-modify");
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

    private async handleMemoryVaultChange(file: TFile, reason: "vault-create" | "vault-modify"): Promise<void> {
        const isStartupReplay = this.isLikelyStartupReplayMemoryEvent(file);
        const observation = await this.vss?.observeChangedFile(file, reason, "metadata-drift", {
            verifyMatchingMetadata: reason === "vault-modify" && !isStartupReplay,
        });
        if (!observation) return;
        if (observation.kind === "confirmed-dirty") {
            this.memoryManager?.scheduleAutoFlush(reason);
            this.debouncedStatusBarUpdate();
        } else if (observation.kind === "verify-candidate") {
            this.memoryManager?.scheduleVerify(reason);
        }
    }

    private isLikelyStartupReplayMemoryEvent(file: TFile): boolean {
        if (typeof this.memoryEventGateStartedAt !== "number" || !Number.isFinite(this.memoryEventGateStartedAt)) {
            this.memoryEventGateStartedAt = Date.now();
        }
        if (Date.now() - this.memoryEventGateStartedAt > MEMORY_STARTUP_EVENT_REPLAY_WINDOW_MS) {
            return false;
        }
        const mtime = file.stat?.mtime;
        return typeof mtime === "number"
            && mtime < this.memoryEventGateStartedAt - MEMORY_STARTUP_EVENT_MTIME_GRACE_MS;
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

    private hasConfirmedMemoryExtractionConsent(): boolean {
        return isMemoryExtractionConsentConfirmed(this.settings.memoryExtractionConsent);
    }

    private canRunMemoryExtractionRuntime(): boolean {
        return this.settings.memoryEnabled === true
            && this.settings.memoryExtractionEnabled
            && this.hasConfirmedMemoryExtractionConsent();
    }

    private syncMemoryExtractionRuntime(): void {
        if (this.canRunMemoryExtractionRuntime() && this.chatHistoryManager) {
            const includeVaultInsights = this.settings.memoryExtractionIncludeVaultInsights === true;
            if (!this.memoryExtractionScheduler) {
                this.memoryExtractionScheduler = new MemoryExtractionScheduler({
                    app: this.app,
                    chatHistoryManager: this.chatHistoryManager,
                    userProfileStore: this.createUserProfileStore(),
                    log: (message, error) => this.log(message, error),
                    includeVaultInsightsInPrompt: includeVaultInsights,
                    shouldHandleVaultEvent: (file) => this.isDataBoundaryAllowedFile(file),
                    getDataBoundaryFingerprint: () => this.getMemoryDataBoundaryFingerprint(),
                    ...(this.getGovernedMemoryProjectionSnapshot() ? {
                        admitTypeACandidates: (batch: TypeAAdmissionBatch) => (
                            this.admitGovernedTypeABatch(batch)
                        ),
                        captureTypeAAdmissionBaseline: () => this.captureGovernedTypeAAdmissionBaseline(),
                        getTypeAProcessedTurn: (conversationId: string) => (
                            this.getGovernedTypeAProcessedTurn(conversationId)
                        ),
                    } : {}),
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

    private async admitGovernedTypeABatch(
        batch: TypeAAdmissionBatch,
    ): Promise<TypeAAdmissionResult> {
        // A settings change may race an already-running extraction batch.
        // Recheck the master switch at the durable admission boundary.
        if (this.settings.memoryEnabled !== true) return { status: "retry" };
        const coordinator = this.memoryAdmissionCoordinator;
        const vaultKey = this.memoryGovernanceOpaqueVaultKey;
        if (!coordinator || !vaultKey || !batch.baseline || !this.getGovernedMemoryProjectionSnapshot()) {
            return { status: "retry" };
        }
        return this.serializeGovernedMemoryLifecycle(async () => {
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
            for (const record of changed) {
                const admission = this.buildGovernedTypeAAdmission(
                    vaultKey,
                    record,
                    batch.baseline!,
                    batch.evidence,
                );
                if (!admission) {
                    this.log("Type-A governed admission skipped", {
                        code: "invalid_exact_profile_evidence",
                    });
                    continue;
                }
                const result = await coordinator.admit(admission);
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
            if (shouldRetry) return { status: "retry" };

            if (stateChanged) {
                const projection = await this.memoryProfileProjectionWorker?.resumePending();
                if (projection && projection.pending.length > 0) {
                    this.log("Type-A Profile projection remains pending after admission", {
                        count: projection.pending.length,
                    });
                    await this.refreshGovernedMemoryActionState();
                    await this.notifySettingsChanged();
                    return { status: "retry" };
                }
                await this.refreshGovernedMemoryActionState();
                await this.notifySettingsChanged();
            }
            await this.persistGovernedTypeAProcessedTurn(vaultKey, batch.evidence);
            return { status: "processed" };
        });
    }

    private buildGovernedTypeAAdmission(
        vaultKey: string,
        record: UserProfileRecord,
        baseline: TypeAAdmissionBaseline,
        evidence: TypeAAdmissionBatch["evidence"],
    ): GovernedMemoryAdmissionInput | null {
        const profileRecordId = record.profileRecordId?.trim();
        const conversationIds = [...new Set([
            record.conversationId,
            ...(record.conversationIds ?? []),
        ].map((id) => id?.trim()).filter((id): id is string => Boolean(id)))].sort();
        if (!profileRecordId || conversationIds.length === 0 || !record.text.trim()) return null;

        const classification = classifyLegacyTypeAAdoption({
            opaqueVaultKey: vaultKey,
            record,
        });
        const authority = classification.status === "adopt"
            ? classification.authority
            : record.kind === "user_correction"
                ? "user_correction" as const
                : record.kind === "user_explicit"
                    ? "explicit_user" as const
                    : "pa_inference" as const;
        const sensitivity: MemorySensitivity = classification.status === "adopt"
            ? "low"
            : classification.reason === "unknown_sensitivity" ? "high" : "medium";
        const provenance: PersistedMemoryProvenance[] = classification.status === "adopt"
            ? classification.provenance.map((entry) => cloneSerializable(entry))
            : [{
                kind: "conversation",
                conversationIds,
                observedAt: record.observedAt,
            }];
        const sourceFingerprintId = `memory-source-${stableHash(JSON.stringify([
            "type-a-source-v1",
            profileRecordId,
            conversationIds,
            evidence.conversationId,
            evidence.throughTurnIndex,
        ]))}`;
        const ruleFingerprint = "type-a-effect-admission-v1";
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
            return {
                version: 1,
                capturedCommitSequence: state.commitSequence,
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
    ): Promise<void> {
        const repository = this.deviceMemoryGovernanceRepository;
        if (!repository) throw new Error("Governed Type-A repository is unavailable.");
        const key = this.typeAConversationCursorKey(evidence.conversationId);
        await repository.transact((draft) => {
            const policy = draft.policyStates[vaultKey];
            if (!policy || policy.mode !== "effect_based" || policy.contextProjectionMode !== "governed") {
                throw new Error("Governed Type-A policy is unavailable.");
            }
            const previous = policy.typeAProcessedTurns?.[key] ?? -1;
            policy.typeAProcessedTurns = {
                ...(policy.typeAProcessedTurns ?? {}),
                [key]: Math.max(previous, evidence.throughTurnIndex),
            };
        });
    }

    private typeAConversationCursorKey(conversationId: string): string {
        return `conversation-${stableHash(`type-a-cursor-v1\u0000${conversationId}`)}`;
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
        this.reviewQueueStore = null;
        this.savedInsightStore = null;
        this.memoryGovernanceStore = null;
        this.retrievalHabitProfileStore = null;
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
            onMaintenanceReview: () => dispatch((callbacks) => callbacks.onMaintenanceReview()),
            onQuietRecall: () => dispatch((callbacks) => callbacks.onQuietRecall()),
            onGraphDiscovery: () => dispatch((callbacks) => callbacks.onGraphDiscovery()),
            onScopeRecap: () => dispatch((callbacks) => callbacks.onScopeRecap()),
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
            registerEvent: (ref) => this.registerEvent(ref),
            saveSettings: () => this.saveSettings(),
            openQuickCapture: () => this.openQuickCaptureModal(),
            createPreloadAnalyzeCallback: (): AnalyzeCallback => {
                return async (files, config) => {
                    const noteContents = await this.readPageletNoteContents(
                        files,
                        config.tokenBudget.input,
                    );
                    if (noteContents.length === 0) {
                        return {
                            findings: [],
                            analyzedFiles: [],
                            analyzedAt: Date.now(),
                            tokenCost: { input: 0, output: 0 },
                            usedGovernedMemoryClaimIds: [],
                        };
                    }
                    const relatedNotes = await this.findPageletRelatedNotes(
                        noteContents[0]?.path ?? "",
                        noteContents,
                        noteContents.map((entry) => entry.path),
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
                            sourceFile: f.sourceFile || noteContents[0]?.path || "",
                            sourceTitle: f.sourceTitle || noteContents[0]?.path.split("/").pop()?.replace(/\.md$/, "") || "",
                        })),
                        analyzedFiles: noteContents.map((entry) => entry.path),
                        analyzedAt: Date.now(),
                        tokenCost: { input: inputTokens, output: outputTokens },
                        usedGovernedMemoryClaimIds: [],
                    };
                };
            },
            createForegroundAnalyzeCallback: (): AnalyzeCallback => {
                return async (files, config) => {
                    const noteContents = await this.readPageletNoteContents(
                        files,
                        config.tokenBudget.input,
                    );
                    if (noteContents.length === 0) {
                        return {
                            findings: [],
                            analyzedFiles: [],
                            analyzedAt: Date.now(),
                            tokenCost: { input: 0, output: 0 },
                            usedGovernedMemoryClaimIds: [],
                        };
                    }
                    const primarySourcePath = noteContents[0]?.path ?? "";
                    const bundle = buildPageletScopeReviewBundle({
                        entries: noteContents,
                        primarySourcePath,
                        range: config.range ?? "current",
                        settings: this.getPageletSettingsWithDataBoundary(),
                        uiLanguage: this.getPageletLocale(),
                    });
                    if (!bundle) {
                        return {
                            findings: [],
                            analyzedFiles: files.map((f) => f.path),
                            analyzedAt: Date.now(),
                            tokenCost: { input: 0, output: 0 },
                            usedGovernedMemoryClaimIds: [],
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
                            reviewTimeoutMs: PAGELET_FOREGROUND_REVIEW_TIMEOUT_MS,
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
                        usedGovernedMemoryClaimIds: [],
                    };
                };
            },
            updatePageletSetting: <K extends keyof PageletSettings>(key: K, value: PageletSettings[K]) => {
                this.settings.pagelet[key] = value;
                void this.saveSettings();
            },
            prepareMemoryForPagelet: () => this.memoryManager?.prepareFromCommand() ?? Promise.resolve(),
            getMemoryPreparationStatus: () => this.memoryManager?.getActivePreparationStatus() ?? null,
            isPathAllowedForPagelet: (path) => this.isDataBoundaryAllowedPath(path),
            openPageletSettings: () => {
                openSettings(this.app);
                openSettingsTab(this.app, 'personal-assistant');
            },
            writeReviewNote: (note: GeneratedReviewNote) => this.writePageletReviewNote(note),
            openPageletDetailView: (payload: PageletDetailPayload) => this.openPageletDetailView(payload),
            findRelatedNotes: (primarySourcePath, noteContents, sourcePaths) =>
                this.findPageletRelatedNotes(primarySourcePath, noteContents, sourcePaths),
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
            runScopeRecap: () => this.runScopeRecap(),
            runQuietRecall: () => this.runQuietRecall(),
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

    private async runMaintenanceReview(options: {
        enqueueProposals?: boolean;
        scopePaths?: readonly string[];
        maxFiles?: number;
        maxProposalsPerCategory?: number;
        includeWholeVault?: boolean;
    } = {}): Promise<MaintenanceReviewRunResult> {
        const notes: MaintenanceReviewNote[] = [];
        for (const file of this.collectMaintenanceReviewFiles(options)) {
            const decision = decideDataBoundaryForSource(
                {
                    path: file.path,
                    tags: this.getDataBoundaryTags(file),
                    isGenerated: this.isGeneratedDataBoundaryFile(file),
                },
                this.settings.dataBoundary,
            );
            if (decision.decision !== "allow") continue;
            try {
                notes.push({
                    path: file.path,
                    basename: file.basename,
                    content: await this.app.vault.cachedRead(file),
                    dataBoundarySnapshotId: `data_boundary:${decision.reason}`,
                });
            } catch (error) {
                this.log("Failed to read note for Maintenance Review", { path: file.path, error });
            }
        }

        const quickCaptureInboxPath = normalizePath(this.settings.quickCapture.inboxPath ?? "")
            .replace(/^\.\//, "");
        const inboxFolderSlash = quickCaptureInboxPath.lastIndexOf("/");
        const quickCaptureInboxFolder = inboxFolderSlash > 0
            ? quickCaptureInboxPath.slice(0, inboxFolderSlash)
            : "";
        const result = scanMaintenanceReview(notes, {
            inboxFolders: quickCaptureInboxFolder ? [quickCaptureInboxFolder] : [],
            weeklyScanEnabled: this.settings.maintenanceReview.weeklyScanEnabled,
            scopePaths: options.scopePaths,
            maxProposalsPerCategory: options.maxProposalsPerCategory,
        });

        if (options.enqueueProposals === true) {
            for (const proposal of result.proposals) {
                const queueResult = await this.createReviewQueueItem(maintenanceProposalToReviewQueueInput(proposal, {
                    admissionReason: "maintenance_action_ready",
                }));
                if (!queueResult.ok) {
                    this.log("Failed to enqueue Maintenance Review proposal", {
                        id: proposal.id,
                        reason: queueResult.reason,
                    });
                }
            }
        }

        return result;
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

    private async runScopeRecap(): Promise<ScopeRecapRunResult> {
        const notes = await this.collectScopeRecapSourceNotes();
        const activeFile = this.app.workspace.getActiveFile();
        const options = {
            now: new Date(),
            isPathAllowed: (path: string) => this.isDataBoundaryAllowedPath(path),
            scope: activeFile instanceof TFile && activeFile.extension === "md"
                ? { kind: "folder" as const, label: parentFolder(activeFile.path) || activeFile.basename, paths: notes.map((note) => note.path) }
                : { kind: "selected_notes" as const, paths: notes.map((note) => note.path) },
            dataBoundarySnapshotId: "data_boundary:scope_recap",
        };

        const generateInsights: GenerateRecapInsightsCallback = async (input) => {
            const model = await this.createChatModel(
                this.settings.pagelet.temperature,
                { maxTokens: this.settings.pagelet.maxOutputTokens },
            );
            if (!model) return null;
            const prompt = buildRecapInsightsPrompt(input);
            try {
                const result = await model.invoke(prompt);
                const text = coerceModelResultToString(result);
                this.pageletCostTracker.record({
                    inputTokens: estimateTokens(prompt),
                    outputTokens: estimateTokens(text),
                    provider: this.settings.aiProvider,
                    model: this.settings.chatModelName,
                });
                return parseRecapInsightsResponse(text);
            } catch (error) {
                this.log("Scope Recap LLM insights failed", error);
                return null;
            }
        };

        return buildScopeRecapWithLlm(notes, generateInsights, options);
    }

    private async collectScopeRecapSourceNotes(): Promise<ScopeRecapSourceNote[]> {
        const graphNotes = await this.collectGraphDiscoveryNotes();
        return graphNotes.map((note) => ({
            path: note.path,
            title: note.title,
            content: note.content,
            tags: note.tags,
            modifiedAt: note.modifiedAt,
            isGenerated: note.path.startsWith(".pagelet/") || note.path.startsWith("pagelet-generated/"),
            sourceRefs: note.sourceRefs,
        }));
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
        if (this.unloading || !this.pageletOrchestrator) return;
        const pageletSettings = this.settings.pagelet;
        if (!pageletSettings?.enabled || !pageletSettings.proactiveHints || this.settings.focusMode) return;

        const now = new Date();
        const lastDetectionAt = Date.parse(this.settings.lastPatternDetectionAt ?? "");
        if (Number.isFinite(lastDetectionAt) && now.getTime() - lastDetectionAt < PATTERN_DETECTION_INTERVAL_MS) {
            return;
        }

        const result = await this.detectCrossNotePatternsForPagelet(now);
        if (this.unloading || !this.pageletOrchestrator || !result) return;

        this.settings.lastPatternDetectionAt = now.toISOString();
        await this.saveSettings();
        if (result.totalCount > 0) {
            this.pageletOrchestrator?.setPatternDetectionNudge(result);
        }
    }

    private async maybeShowMaintenanceScanOnboardingNudge(): Promise<void> {
        if (this.unloading || !this.pageletOrchestrator) return;
        const pageletSettings = this.settings.pagelet;
        if (!pageletSettings?.enabled || !pageletSettings.proactiveHints || this.settings.focusMode) return;
        if (pageletSettings.maintenanceScanSuggested) return;
        if (this.app.vault.getMarkdownFiles().length <= PAGELET_MAINTENANCE_ONBOARDING_MIN_NOTES) return;

        const surfaced = this.pageletOrchestrator?.setOnboardingNudge("maintenance_scan") === true;
        if (!surfaced) return;
        pageletSettings.maintenanceScanSuggested = true;
        await this.saveSettings();
    }

    private async maybeShowQuickCaptureOnboardingNudge(): Promise<void> {
        if (this.unloading) return;
        const pageletSettings = this.settings.pagelet;
        if (!pageletSettings?.enabled || !pageletSettings.proactiveHints || this.settings.focusMode) return;
        if (pageletSettings.quickCaptureExplained) return;
        this.syncPageletRuntime();
        if (!this.pageletOrchestrator) return;

        const surfaced = this.pageletOrchestrator?.setOnboardingNudge("quick_capture") === true;
        if (!surfaced) return;
        pageletSettings.quickCaptureExplained = true;
        await this.saveSettings();
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
    ): Promise<QuietRecallVaultNoteCollection> {
        if (await this.isPageletMemorySearchReady()) {
            const relatedNotes = await this.findPageletRelatedNotes(
                activeFile.path,
                [{ path: activeFile.path, content: currentContent }],
                [activeFile.path],
                QUIET_RECALL_MAX_VAULT_CANDIDATE_NOTES,
            );
            return this.collectQuietRecallVaultNotesFromRelatedNotes(relatedNotes);
        }
        return this.collectQuietRecallVaultNotesFromMetadata(activeFile);
    }

    private async collectQuietRecallVaultNotesFromRelatedNotes(
        relatedNotes: Array<{ path: string; content: string; score?: number; headingPath?: string[] }>,
    ): Promise<QuietRecallVaultNoteCollection> {
        const backlinkMap = this.buildGraphDiscoveryBacklinkMap();
        const vaultNotes: QuietRecallVaultNote[] = [];
        const recallRelatedNotes: QuietRecallRelatedNote[] = [];
        for (const related of relatedNotes.slice(0, QUIET_RECALL_MAX_VAULT_CANDIDATE_NOTES)) {
            const path = normalizePath(related.path).replace(/^\.\//, "");
            const file = this.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile) || file.extension !== "md") continue;
            if (!this.isDataBoundaryAllowedFile(file)) continue;
            const note = await this.readQuietRecallVaultNote(file, backlinkMap, related.content);
            if (!note) continue;
            vaultNotes.push(note);
            recallRelatedNotes.push({
                path: file.path,
                score: related.score ?? 0.5,
                headingPath: related.headingPath,
            });
        }
        return { vaultNotes, relatedNotes: recallRelatedNotes };
    }

    private async collectQuietRecallVaultNotesFromMetadata(activeFile: TFile): Promise<QuietRecallVaultNoteCollection> {
        const backlinkMap = this.buildGraphDiscoveryBacklinkMap();
        const candidates = this.rankQuietRecallMetadataCandidates(activeFile, backlinkMap)
            .slice(0, QUIET_RECALL_MAX_VAULT_CANDIDATE_NOTES);
        const vaultNotes: QuietRecallVaultNote[] = [];
        const relatedNotes: QuietRecallRelatedNote[] = [];
        for (const candidate of candidates) {
            const note = await this.readQuietRecallVaultNote(candidate.file, backlinkMap);
            if (!note) continue;
            vaultNotes.push(note);
            relatedNotes.push({
                path: candidate.file.path,
                score: candidate.score,
            });
        }
        return { vaultNotes, relatedNotes };
    }

    private rankQuietRecallMetadataCandidates(
        activeFile: TFile,
        backlinkMap: Map<string, string[]>,
    ): Array<{ file: TFile; score: number }> {
        const activePath = normalizePath(activeFile.path);
        const activeFolder = parentFolder(activeFile.path);
        const activeTags = new Set(this.getDataBoundaryTags(activeFile));
        const activeResolvedLinks = new Set(this.getResolvedOutgoingLinks(activeFile.path));
        const activeBacklinks = new Set(backlinkMap.get(activePath) ?? []);
        const scores = new Map<string, { file: TFile; score: number }>();

        const addScore = (file: TFile | null | undefined, amount: number): void => {
            if (!(file instanceof TFile) || file.extension !== "md") return;
            if (file.path === activeFile.path) return;
            if (!this.isDataBoundaryAllowedFile(file)) return;
            const existing = scores.get(file.path);
            const score = Math.min(0.95, (existing?.score ?? 0) + amount);
            scores.set(file.path, { file, score });
        };

        for (const path of activeResolvedLinks) {
            addScore(this.app.vault.getAbstractFileByPath(path) as TFile | null, 0.5);
        }
        for (const path of activeBacklinks) {
            addScore(this.app.vault.getAbstractFileByPath(path) as TFile | null, 0.45);
        }

        const resolvedLinks = this.app.metadataCache?.resolvedLinks as
            Record<string, Record<string, number>> | undefined;
        for (const file of this.app.vault.getMarkdownFiles()) {
            if (file.path === activeFile.path || !this.isDataBoundaryAllowedFile(file)) continue;
            if (parentFolder(file.path) === activeFolder) addScore(file, 0.18);
            const tags = this.getDataBoundaryTags(file);
            const sharedTagCount = tags.filter((tag) => activeTags.has(tag)).length;
            if (sharedTagCount > 0) addScore(file, Math.min(0.36, sharedTagCount * 0.12));
            const fileLinks = resolvedLinks?.[file.path];
            if (fileLinks && Number(fileLinks[activePath] ?? 0) > 0) addScore(file, 0.35);
            if (fileLinks) {
                for (const linkedPath of Object.keys(fileLinks)) {
                    if (Number(fileLinks[linkedPath]) > 0 && activeResolvedLinks.has(linkedPath)) {
                        addScore(file, 0.12);
                        break;
                    }
                }
            }
        }

        return [...scores.values()]
            .filter((entry) => entry.score > 0)
            .sort((left, right) => {
                if (right.score !== left.score) return right.score - left.score;
                return right.file.stat.mtime - left.file.stat.mtime;
            });
    }

    private async readQuietRecallVaultNote(
        file: TFile,
        backlinkMap: Map<string, string[]>,
        contentOverride?: string,
    ): Promise<QuietRecallVaultNote | null> {
        try {
            const content = contentOverride ?? await this.app.vault.cachedRead(file);
            return {
                path: file.path,
                title: file.basename,
                content,
                tags: this.getDataBoundaryTags(file),
                links: this.getGraphDiscoveryLinks(file),
                backlinks: backlinkMap.get(normalizePath(file.path)) ?? [],
                modifiedAt: new Date(file.stat.mtime).toISOString(),
                createdAt: new Date(file.stat.ctime).toISOString(),
            };
        } catch (error) {
            this.log("Failed to read note for Quiet Recall", { path: file.path, error });
            return null;
        }
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
        if (proposal.actionType !== "move") {
            return {
                ok: false,
                reason: "unsupported_action",
                message: pageletT("pagelet.maintenance.apply.unsupported", this.getPageletLocale()),
            };
        }
        const oldPath = proposal.preview.oldPath ?? proposal.preview.sourcePath;
        const newPath = proposal.preview.newPath;
        const confirmed = await confirmUserAction(this.app, {
            title: pageletT("pagelet.maintenance.apply.confirmTitle", this.getPageletLocale()),
            message: pageletT("pagelet.maintenance.apply.confirmMessage", this.getPageletLocale(), {
                oldPath: oldPath ?? "",
                newPath: newPath ?? "",
            }),
            confirmText: pageletT("pagelet.maintenance.apply.confirm", this.getPageletLocale()),
        });
        if (!confirmed) {
            return {
                ok: false,
                reason: "cancelled",
                message: pageletT("pagelet.maintenance.apply.cancelled", this.getPageletLocale()),
            };
        }

        const queueItem = this.findMaintenanceQueueItem(proposal.id);
        const result = await applyMaintenanceMoveProposal(proposal, {
            exists: (path) => this.app.vault.adapter.exists(normalizePath(path).replace(/^\.\//, "")),
            rename: async (from, to) => {
                const source = this.app.vault.getAbstractFileByPath(normalizePath(from).replace(/^\.\//, ""));
                if (!(source instanceof TFile)) {
                    throw new Error("source_missing");
                }
                await this.app.vault.rename(source, normalizePath(to).replace(/^\.\//, ""));
            },
            isPathAllowed: (path) => this.isMaintenanceMovePathAllowed(path),
            now: () => new Date(),
            idFactory: () => this.maintenanceActionId(),
        }, {
            reviewQueueItemId: queueItem?.id,
        });

        if (!result.ok) {
            new Notice(result.message, 5000);
            return result;
        }

        try {
            await this.appendMaintenanceActionLog(result.action);
        } catch (error) {
            this.log("Maintenance apply persistence failed after rename; attempting rollback", error);
            const rollback = await this.rollbackAppliedMaintenanceMove(result.action).catch((rollbackError) => {
                this.log("Maintenance apply rollback failed", rollbackError);
                return false;
            });
            const message = rollback
                ? "Move was rolled back because PA could not save the action log. Please try again."
                : "Move succeeded, but PA could not save the action log or roll it back. Please inspect the note location before continuing.";
            new Notice(message, 8000);
            return { ok: false, reason: "action_log_persist_failed", message };
        }
        if (queueItem) {
            await this.updateMaintenanceQueueStatus(queueItem.id, "applied");
        }
        new Notice(result.message, 5000);
        return result;
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
        const entry = findMaintenanceActionLogEntry(this.settings.maintenanceReview.actionLog ?? [], actionId);
        if (!entry) {
            return {
                ok: false,
                reason: "not_found",
                message: pageletT("pagelet.maintenance.undo.notFound", this.getPageletLocale()),
            };
        }
        const confirmed = await confirmUserAction(this.app, {
            title: pageletT("pagelet.maintenance.undo.confirmTitle", this.getPageletLocale()),
            message: pageletT("pagelet.maintenance.undo.confirmMessage", this.getPageletLocale(), {
                oldPath: entry.oldPath,
                newPath: entry.newPath,
            }),
            confirmText: pageletT("pagelet.maintenance.undo.confirm", this.getPageletLocale()),
        });
        if (!confirmed) {
            return {
                ok: false,
                reason: "cancelled",
                message: pageletT("pagelet.maintenance.undo.cancelled", this.getPageletLocale()),
            };
        }

        const result = await undoMaintenanceMoveAction(entry, {
            exists: (path) => this.app.vault.adapter.exists(normalizePath(path).replace(/^\.\//, "")),
            rename: async (from, to) => {
                const source = this.app.vault.getAbstractFileByPath(normalizePath(from).replace(/^\.\//, ""));
                if (!(source instanceof TFile)) {
                    throw new Error("source_missing");
                }
                await this.app.vault.rename(source, normalizePath(to).replace(/^\.\//, ""));
            },
            isPathAllowed: (path) => this.isMaintenanceMovePathAllowed(path),
            now: () => new Date(),
            idFactory: () => this.maintenanceActionId(),
        });

        if (!result.ok) {
            new Notice(result.message, 5000);
            return result;
        }

        try {
            await this.replaceMaintenanceActionLog(result.action);
        } catch (error) {
            this.log("Maintenance undo persistence failed after move; attempting rollback", error);
            const rollback = await this.rollbackUndoneMaintenanceMove(entry).catch((rollbackError) => {
                this.log("Maintenance undo rollback failed", rollbackError);
                return false;
            });
            const message = rollback
                ? "Undo was rolled back because PA could not save the action log. Please try again."
                : "Undo moved the note back, but PA could not save the action log or roll it back. Please inspect the note location before continuing.";
            new Notice(message, 8000);
            return { ok: false, reason: "action_log_persist_failed", message };
        }
        if (entry.reviewQueueItemId) {
            await this.updateMaintenanceQueueStatus(entry.reviewQueueItemId, "undone");
        }
        new Notice(result.message, 5000);
        return result;
    }

    private _lastRecallLlmEvalAt = 0;
    private static readonly RECALL_LLM_COOLDOWN_MS = 60_000;

    private async runQuietRecall(): Promise<QuietRecallRunResult> {
        const locale = this.getPageletLocale();
        if (!this.settings.quietRecall.enabled) {
            return buildQuietRecallCandidates({ now: new Date(), locale });
        }

        const activeFile = this.app.workspace.getActiveFile();
        if (!(activeFile instanceof TFile) || activeFile.extension !== "md") {
            return buildQuietRecallCandidates({ now: new Date(), locale });
        }
        if (!this.isDataBoundaryAllowedFile(activeFile)) {
            return buildQuietRecallCandidates({ now: new Date(), locale });
        }

        const content = await this.app.vault.cachedRead(activeFile);
        const collectedVaultNotes = await this.collectQuietRecallVaultNotes(activeFile, content).catch((error) => {
            this.log("Quiet Recall vault-note collection skipped", error);
            return { vaultNotes: [], relatedNotes: [] } satisfies QuietRecallVaultNoteCollection;
        });
        const relatedNotes = collectedVaultNotes.relatedNotes
            .filter((note) => this.isDataBoundaryAllowedPath(note.path));
        const vaultNotes = collectedVaultNotes.vaultNotes
            .filter((note) => this.isDataBoundaryAllowedPath(note.path));

        const now = Date.now();
        const useLlm = now - this._lastRecallLlmEvalAt >= PluginManager.RECALL_LLM_COOLDOWN_MS;

        const baseInput = {
            now: new Date(),
            locale,
            currentNote: {
                path: activeFile.path,
                title: activeFile.basename,
                content,
            },
            relatedNotes,
            vaultNotes,
            savedInsights: this.listDataBoundaryAllowedSavedInsights(),
        };

        let recall: QuietRecallRunResult;
        if (useLlm) {
            const evaluateRelevance: RecallRelevanceEvaluator = async (input) => {
                const model = await this.createChatModel(
                    this.settings.pagelet.temperature,
                    { maxTokens: 300 },
                );
                if (!model) return { isConvincing: false, whyNow: null };
                const prompt = buildRecallRelevancePrompt(input);
                try {
                    const result = await model.invoke(prompt);
                    const text = coerceModelResultToString(result);
                    this.pageletCostTracker.record({
                        inputTokens: estimateTokens(prompt),
                        outputTokens: estimateTokens(text),
                        provider: this.settings.aiProvider,
                        model: this.settings.chatModelName,
                    });
                    const parsed = parseRecallRelevanceResponse(text);
                    if (parsed.isConvincing && parsed.whyNow && detectLanguageMismatch(parsed.whyNow, content)) {
                        const retryResult = await model.invoke(prompt + "\n\nIMPORTANT: Your previous response was in the wrong language. Respond in the same language as the notes above.");
                        const retryText = coerceModelResultToString(retryResult);
                        this.pageletCostTracker.record({
                            inputTokens: estimateTokens(prompt),
                            outputTokens: estimateTokens(retryText),
                            provider: this.settings.aiProvider,
                            model: this.settings.chatModelName,
                        });
                        return parseRecallRelevanceResponse(retryText);
                    }
                    return parsed;
                } catch (error) {
                    this.log("Quiet Recall LLM evaluation failed", error);
                    return { isConvincing: false, whyNow: null };
                }
            };

            this._lastRecallLlmEvalAt = now;
            recall = await buildQuietRecallWithLlm({
                ...baseInput,
                evaluateRelevance,
                scoreThreshold: QUIET_RECALL_BUBBLE_MIN_SCORE,
            });
        } else {
            recall = buildQuietRecallCandidates(baseInput);
        }

        const candidates = applyRetrievalHabitProfileToRecallCandidates(
            recall.candidates,
            this.settings.retrievalHabitProfile,
        );
        return {
            ...recall,
            totalCount: candidates.length,
            candidates,
        };
    }

    private async saveQuietRecallAsInsight(candidate: QuietRecallCandidate): Promise<QuietRecallSaveResult> {
        if (!this.settings.quietRecall.enabled) {
            return {
                ok: false as const,
                reason: "disabled",
                message: pageletT("pagelet.recall.save.disabled", this.getPageletLocale()),
            };
        }
        const input = quietRecallCandidateToSavedInsightInput(candidate);
        const result = await this.getSavedInsightStore().create(input);
        const coerced = coerceQuietRecallSaveResult(result);
        if (coerced.ok) {
            void this.recordQuietRecallFeedback(candidate, "accept").catch((error) => {
                this.log("Quiet Recall accept feedback skipped", error);
            });
            new Notice(pageletT("pagelet.recall.save.saved", this.getPageletLocale()), 4000);
            return {
                ...coerced,
                message: pageletT("pagelet.recall.save.saved", this.getPageletLocale()),
            };
        } else {
            const message = pageletT("pagelet.recall.save.failed", this.getPageletLocale());
            new Notice(message, 5000);
            return { ...coerced, message };
        }
    }

    private async linkQuietRecallCandidateFromActiveNote(
        candidate: QuietRecallCandidate,
        currentPath?: string,
    ): Promise<{ ok: boolean; message: string }> {
        const sourcePath = currentPath ? normalizePath(currentPath).replace(/^\.\//, "") : "";
        const activeFile = this.app.workspace.getActiveFile();
        const resolvedSourcePath = sourcePath || (activeFile instanceof TFile && activeFile.extension === "md" ? activeFile.path : "");
        if (!resolvedSourcePath) {
            return {
                ok: false,
                message: pageletT("pagelet.tab.recall.linkNoActiveNote", this.getPageletLocale()),
            };
        }
        const candidatePath = quietRecallLinkTargetPath(candidate, resolvedSourcePath);
        if (!candidatePath) {
            return {
                ok: false,
                message: pageletT("pagelet.tab.recall.linkNoDistinctSource", this.getPageletLocale()),
            };
        }
        return this.linkRecallCandidate(resolvedSourcePath, candidatePath);
    }

    private async linkRecallCandidate(currentPath: string, candidatePath: string): Promise<{ ok: boolean; message: string }> {
        const locale = this.getPageletLocale();
        const normalizedCurrentPath = normalizePath(currentPath).replace(/^\.\//, "");
        const normalizedCandidatePath = normalizePath(candidatePath).replace(/^\.\//, "");
        if (!normalizedCurrentPath || normalizedCurrentPath === normalizedCandidatePath) {
            return {
                ok: false,
                message: pageletT("pagelet.tab.recall.linkNoDistinctSource", locale),
            };
        }
        const currentFile = this.app.vault.getAbstractFileByPath(normalizedCurrentPath);
        const candidateFile = this.app.vault.getAbstractFileByPath(normalizedCandidatePath);
        if (
            !(currentFile instanceof TFile)
            || currentFile.extension !== "md"
            || !(candidateFile instanceof TFile)
            || candidateFile.extension !== "md"
        ) {
            return {
                ok: false,
                message: this.quietRecallLinkFailureMessage("file-not-found"),
            };
        }
        if (!this.isDataBoundaryAllowedPath(currentFile.path) || !this.isDataBoundaryAllowedPath(candidateFile.path)) {
            return {
                ok: false,
                message: pageletT("pagelet.tab.recall.linkBlocked", locale),
            };
        }

        const confirmed = await confirmUserAction(this.app, {
            title: pageletT("pagelet.tab.recall.linkConfirmTitle", locale),
            message: pageletT("pagelet.tab.recall.linkConfirmMessage", locale, {
                currentPath: currentFile.path,
                candidatePath: candidateFile.path,
            }),
            confirmText: pageletT("pagelet.tab.recall.linkConfirm", locale),
        });
        if (!confirmed) {
            return {
                ok: false,
                message: pageletT("pagelet.tab.recall.linkCancelled", locale),
            };
        }

        const result = await addPaRelatedLink(this.app, currentFile.path, candidateFile.path);
        if (!result.ok) {
            return {
                ok: false,
                message: this.quietRecallLinkFailureMessage(result.reason),
            };
        }
        void this.recordQuietRecallFeedback({
            id: `quiet-recall-link:${currentFile.path}:${candidateFile.path}`,
            title: candidateFile.basename,
            summary: `Linked ${currentFile.path} and ${candidateFile.path}.`,
            sourceRefs: [{ path: candidateFile.path, evidenceStrength: "medium" }],
            whyNow: [],
            nextAction: "",
            relation: "related",
            score: 0,
            generatedAt: new Date().toISOString(),
        }, "accept").catch((error) => {
            this.log("Quiet Recall link feedback skipped", error);
        });
        return {
            ok: true,
            message: result.changed
                ? pageletT("pagelet.tab.recall.linked", locale)
                : pageletT("pagelet.tab.recall.alreadyLinked", locale),
        };
    }

    private quietRecallLinkFailureMessage(reason: string): string {
        const locale = this.getPageletLocale();
        switch (reason) {
            case "file-not-found":
                return pageletT("pagelet.tab.recall.linkFailed.fileMissing", locale);
            case "frontmatter-unavailable":
                return pageletT("pagelet.tab.recall.linkFailed.frontmatterUnavailable", locale);
            case "frontmatter-write-failed":
                return pageletT("pagelet.tab.recall.linkFailed.writeFailed", locale);
            default:
                return pageletT("pagelet.tab.recall.linkFailed", locale);
        }
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
        return this.getRetrievalHabitProfileStore().recordRecallFeedback(candidate, feedback);
    }

    private getSavedInsightStore(): SavedInsightStore {
        if (!this.savedInsightStore) {
            this.savedInsightStore = new SavedInsightStore({
                items: this.settings.savedInsights.items,
                persist: (state) => this.persistPaSettingsSlice(
                    () => this.settings.savedInsights.items,
                    (items) => { this.settings.savedInsights.items = items; },
                    state.items,
                ),
            });
        }
        return this.savedInsightStore;
    }

    private listSavedInsights(): SavedInsight[] {
        return this.getSavedInsightStore().list();
    }

    private listDataBoundaryAllowedSavedInsights(): SavedInsight[] {
        return this.listSavedInsights().filter((insight) => this.isSavedInsightAllowedByDataBoundary(insight));
    }

    private isSavedInsightAllowedByDataBoundary(insight: SavedInsight): boolean {
        const paths = [
            ...insight.sourceRefs.map((ref) => ref.path),
            ...(insight.scope.paths ?? []),
        ];
        return paths.length > 0 && paths.every((path) => this.isDataBoundaryAllowedPath(path));
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
                effect: projection.effect,
                useStatus: projection.useStatus,
                durableUseStatus: projection.durableUseStatus,
                actionPolicy: { ...projection.actionPolicy },
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
        if (action === "correct") return this.correctGovernedMemory(current, summary ?? "");
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
    ): Promise<MemoryRecordActionResult> {
        return this.runGovernedMemoryLifecycleAction(
            record.id,
            "correct",
            (coordinator, dataBoundaryAllowed) => coordinator.correct({
                claimId: record.id,
                summary,
                scopeAllowed: true,
                dataBoundaryAllowed,
            }),
        );
    }

    private pauseGovernedMemory(record: ConfirmedMemoryRecord): Promise<MemoryRecordActionResult> {
        return this.runGovernedMemoryLifecycleAction(
            record.id,
            "pause",
            (coordinator) => coordinator.pauseUse({ claimId: record.id }),
        );
    }

    private resumeGovernedMemory(record: ConfirmedMemoryRecord): Promise<MemoryRecordActionResult> {
        return this.runGovernedMemoryLifecycleAction(
            record.id,
            "resume",
            (coordinator, dataBoundaryAllowed) => coordinator.resumeUse({
                claimId: record.id,
                scopeAllowed: true,
                dataBoundaryAllowed,
            }),
        );
    }

    private async applyGovernedMemoryDeviceWide(
        record: ConfirmedMemoryRecord,
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
            return {
                ok: false,
                message: this.t("plugin.settings.memoryControlCenter.scope.cancelled"),
            };
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
            }),
        );
    }

    private limitGovernedMemoryToCurrentVault(
        record: ConfirmedMemoryRecord,
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
            }),
        );
    }

    private async forgetGovernedMemory(record: ConfirmedMemoryRecord): Promise<MemoryRecordActionResult> {
        const confirmed = await confirmUserAction(this.app, {
            title: pageletT("pagelet.tab.memory.forgetConfirmTitle", this.getPageletLocale()),
            message: pageletT("pagelet.tab.memory.forgetConfirmMessage", this.getPageletLocale()),
            confirmText: pageletT("pagelet.tab.memory.forgetConfirm", this.getPageletLocale()),
        });
        if (!confirmed) {
            return {
                ok: false,
                message: pageletT("pagelet.tab.memory.forgetCancelled", this.getPageletLocale()),
            };
        }
        return this.runGovernedMemoryLifecycleAction(
            record.id,
            "forget",
            (coordinator) => coordinator.forget({ claimId: record.id }),
        );
    }

    private undoGovernedMemoryChange(change: PanelMemoryRecentChange): Promise<MemoryRecordActionResult> {
        return this.runGovernedMemoryLifecycleAction(
            change.claimId,
            "undo",
            (coordinator) => coordinator.undoRecentChange({ eventId: change.id }),
        );
    }

    private retryPendingForget(claimId: string): Promise<MemoryRecordActionResult> {
        return this.serializeGovernedMemoryLifecycle(async () => {
            const coordinator = this.memoryGovernanceCoordinator;
            const repository = this.deviceMemoryGovernanceRepository;
            const vaultKey = this.memoryGovernanceOpaqueVaultKey;
            if (!coordinator || !repository || !vaultKey) {
                return {
                    ok: false,
                    message: this.t("plugin.settings.memoryControlCenter.pendingForget.retryUnavailable"),
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
                };
            }
            return {
                ok: true,
                message: this.t("plugin.settings.memoryControlCenter.pendingForget.retryComplete"),
            };
        });
    }

    runMemoryControlCenterAction(
        action: "correct" | "pause_use" | "resume_use" | "apply_device_wide"
            | "limit_to_current_vault" | "forget" | "retry_forget" | "undo_recent_change",
        targetId: string,
        summary?: string,
    ): Promise<MemoryRecordActionResult> {
        if (action === "retry_forget") return this.retryPendingForget(targetId);
        if (action === "undo_recent_change") {
            const change = this.getMemoryGovernancePanelState().recentChanges
                ?.find((candidate) => candidate.id === targetId);
            return change
                ? this.undoGovernedMemoryChange(change)
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
        if (action === "correct") return this.correctGovernedMemory(record, summary ?? "");
        if (action === "pause_use") return this.pauseGovernedMemory(record);
        if (action === "resume_use") return this.resumeGovernedMemory(record);
        if (action === "apply_device_wide") return this.applyGovernedMemoryDeviceWide(record);
        if (action === "limit_to_current_vault") return this.limitGovernedMemoryToCurrentVault(record);
        return this.forgetGovernedMemory(record);
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
        this.cancelMemoryForgetRetry();
        this.cancelMemoryProfileProjectionRetry();
        this.cancelMemoryGovernanceGarbageCollection();
        this.memoryGovernanceRepositoryUnsubscribe?.();
        this.memoryGovernanceRepositoryUnsubscribe = null;
        this.deviceMemoryRecordRepository?.dispose();
        this.memoryGovernanceOpaqueVaultKey = opaqueVaultKey;
        this.memoryGovernanceSourceHash = sourceHash;
        this.deviceMemoryGovernanceRepository = repository;
        this.currentDeviceMemoryGovernanceState = cloneSerializable(state);
        this.memoryGovernanceCoordinator = null;
        this.memoryAdmissionCoordinator = null;
        this.memoryProfileProjectionWorker = null;
        this.deviceMemoryRecordRepository = null;
        this.deviceMemoryReviewQueueRepository = null;
        this.memoryGovernanceRecordRepository = new CallbackMemoryGovernanceRecordRepository(
            this.settings.memoryGovernance.records,
            (next) => this.persistPaSettingsSlice(
                () => this.settings.memoryGovernance.records,
                (records) => { this.settings.memoryGovernance.records = records; },
                next.records,
            ),
        );
        this.settingsReviewQueueRepository = null;
        this.reviewQueueRepository = this.getOrCreateSettingsReviewQueueRepository();
        this.currentLocalConfirmedMemoryCount = normalizeConfirmedMemoryCount(
            this.settings.confirmedMemoryCount,
        );
        this.currentLocalMemoryAutoAcceptPaused = this.settings.memoryAutoAcceptPaused === true;
        this.memoryGovernanceBootstrapState = "ready";
        this.memoryGovernanceBootstrapErrorCode = null;
        this.memoryGovernanceStore = null;
        this.reviewQueueStore = null;
    }

    private runGovernedMemoryLifecycleAction(
        claimId: string,
        action: "correct" | "pause" | "resume" | "apply_device_wide"
            | "limit_to_current_vault" | "forget" | "undo",
        operation: (
            coordinator: MemoryGovernanceCoordinator,
            dataBoundaryAllowed: boolean,
        ) => Promise<{ ok: boolean; reason?: string; pending?: boolean }>,
    ): Promise<MemoryRecordActionResult> {
        return this.serializeGovernedMemoryLifecycle(async () => {
            const coordinator = this.memoryGovernanceCoordinator;
            if (!coordinator) return this.governedMemoryActionFailure(action, "coordinator_unavailable");
            const boundary = await this.readGovernedMemoryActionBoundary(claimId);
            if (boundary === null) return this.governedMemoryActionFailure(action, "claim_unavailable");

            let result: Awaited<ReturnType<typeof operation>>;
            try {
                result = await operation(coordinator, boundary);
            } catch (error) {
                this.log("Governed Memory lifecycle action threw", { action, claimId, error });
                return this.governedMemoryActionFailure(action, "operation_threw");
            }
            if (!result.ok) {
                this.log("Governed Memory lifecycle action failed", {
                    action,
                    claimId,
                    reason: result.reason ?? "unknown",
                    pending: result.pending === true,
                });
                if (result.pending === true) this.scheduleMemoryForgetRetry();
                return this.governedMemoryActionFailure(
                    action,
                    result.reason ?? "unknown",
                    result.pending === true,
                );
            }

            if (action === "correct" || action === "undo"
                || action === "apply_device_wide" || action === "limit_to_current_vault") {
                const recovery = await this.memoryProfileProjectionWorker?.resumePending();
                if (recovery && recovery.pending.length > 0) {
                    this.log("Memory Profile projection remains pending after lifecycle action", {
                        action,
                        claimId,
                        count: recovery.pending.length,
                    });
                    this.scheduleMemoryProfileProjectionRetry();
                    if (action === "undo" && recovery.pending.includes(claimId)) {
                        await this.refreshGovernedMemoryActionState();
                        await this.notifySettingsChanged();
                        return this.governedMemoryActionFailure(action, "undo_cleanup_pending", true);
                    }
                    if (action === "apply_device_wide" && recovery.pending.includes(claimId)) {
                        await this.refreshGovernedMemoryActionState();
                        await this.notifySettingsChanged();
                        return this.governedMemoryActionFailure(action, "scope_cleanup_pending", true);
                    }
                }
            }
            await this.refreshGovernedMemoryActionState();
            await this.notifySettingsChanged();
            const nextRecord = this.getMemoryGovernancePanelState().records
                .find((record) => record.id === claimId);
            return {
                ok: true,
                message: this.governedMemoryActionSuccessMessage(action),
                ...(nextRecord ? { record: cloneSerializable(nextRecord) } : {}),
            };
        });
    }

    private serializeGovernedMemoryLifecycle<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.memoryLifecycleMutationTail.then(operation, operation);
        this.memoryLifecycleMutationTail = result.then(() => undefined, () => undefined);
        return result;
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
        if (this.unloading || this.memoryForgetRetryTimer !== null
            || this.memoryGovernanceBootstrapState !== "ready"
            || !this.memoryGovernanceCoordinator) return;
        const delay = this.memoryForgetRetryDelayMs;
        this.memoryForgetRetryTimer = setPluginTimeout(() => {
            this.memoryForgetRetryTimer = null;
            void this.serializeGovernedMemoryLifecycle(async () => {
                const coordinator = this.memoryGovernanceCoordinator;
                if (!coordinator || this.unloading
                    || this.memoryGovernanceBootstrapState !== "ready") return;
                const recovery = await coordinator.resumePendingForgets();
                await this.refreshGovernedMemoryActionState();
                await this.notifySettingsChanged();
                if (recovery.ok && recovery.value.pending.length === 0) {
                    this.cancelMemoryForgetRetry();
                    return;
                }
                if (!recovery.ok) {
                    this.log("Memory Forget background retry remains pending", {
                        ok: false,
                    });
                }
                this.memoryForgetRetryDelayMs = Math.min(
                    delay * 2,
                    MEMORY_FORGET_RETRY_MAX_MS,
                );
                this.scheduleMemoryForgetRetry();
            }).catch((error) => {
                this.log("Memory Forget background retry failed", {
                    errorType: error instanceof Error ? "error" : "unknown_error",
                });
                this.memoryForgetRetryDelayMs = Math.min(
                    delay * 2,
                    MEMORY_FORGET_RETRY_MAX_MS,
                );
                this.scheduleMemoryForgetRetry();
            });
        }, delay);
    }

    private cancelMemoryForgetRetry(): void {
        if (this.memoryForgetRetryTimer !== null) {
            clearPluginTimeout(this.memoryForgetRetryTimer);
            this.memoryForgetRetryTimer = null;
        }
        this.memoryForgetRetryDelayMs = MEMORY_FORGET_RETRY_INITIAL_MS;
    }

    private scheduleMemoryProfileProjectionRetry(): void {
        if (this.unloading || this.memoryProfileProjectionRetryTimer !== null
            || !this.memoryProfileProjectionWorker) return;
        const delay = this.memoryProfileProjectionRetryDelayMs;
        this.memoryProfileProjectionRetryTimer = setPluginTimeout(() => {
            this.memoryProfileProjectionRetryTimer = null;
            void this.serializeGovernedMemoryLifecycle(async () => {
                const worker = this.memoryProfileProjectionWorker;
                if (!worker) return;
                const recovery = await worker.resumePending();
                await this.refreshGovernedMemoryActionState();
                await this.notifySettingsChanged();
                if (recovery.pending.length === 0) {
                    this.memoryProfileProjectionRetryDelayMs = MEMORY_PROFILE_PROJECTION_RETRY_INITIAL_MS;
                    return;
                }
                this.memoryProfileProjectionRetryDelayMs = Math.min(
                    delay * 2,
                    MEMORY_PROFILE_PROJECTION_RETRY_MAX_MS,
                );
                this.scheduleMemoryProfileProjectionRetry();
            }).catch((error) => {
                this.log("Memory Profile projection background retry failed", error);
                this.memoryProfileProjectionRetryDelayMs = Math.min(
                    delay * 2,
                    MEMORY_PROFILE_PROJECTION_RETRY_MAX_MS,
                );
                this.scheduleMemoryProfileProjectionRetry();
            });
        }, delay);
    }

    private cancelMemoryProfileProjectionRetry(): void {
        if (this.memoryProfileProjectionRetryTimer !== null) {
            clearPluginTimeout(this.memoryProfileProjectionRetryTimer);
            this.memoryProfileProjectionRetryTimer = null;
        }
        this.memoryProfileProjectionRetryDelayMs = MEMORY_PROFILE_PROJECTION_RETRY_INITIAL_MS;
    }

    private scheduleMemoryGovernanceGarbageCollection(minimumDelayMs = 0): void {
        const state = this.currentDeviceMemoryGovernanceState;
        if (this.unloading
            || this.memoryGovernanceBootstrapState !== "ready"
            || !this.memoryGovernanceCoordinator
            || !state) {
            this.cancelMemoryGovernanceGarbageCollection();
            return;
        }
        const expiresAt = nextMemoryGovernanceGarbageCollectionAt(state);
        if (expiresAt === null) {
            this.cancelMemoryGovernanceGarbageCollection();
            return;
        }
        // GC uses a strict expiry comparison so the documented seven-day
        // window remains available through the exact boundary millisecond.
        const dueAt = Math.max(expiresAt + 1, Date.now() + Math.max(0, minimumDelayMs));
        if (this.memoryGovernanceGarbageCollectionTimer != null
            && this.memoryGovernanceGarbageCollectionDueAt === dueAt) return;
        this.cancelMemoryGovernanceGarbageCollection();
        this.memoryGovernanceGarbageCollectionDueAt = dueAt;
        this.memoryGovernanceGarbageCollectionTimer = setPluginTimeout(() => {
            this.memoryGovernanceGarbageCollectionTimer = null;
            this.memoryGovernanceGarbageCollectionDueAt = null;
            void this.serializeGovernedMemoryLifecycle(async () => {
                const coordinator = this.memoryGovernanceCoordinator;
                if (this.unloading
                    || this.memoryGovernanceBootstrapState !== "ready"
                    || !coordinator) return;
                const result = await coordinator.collectGarbage();
                if (!result.ok) {
                    throw new Error(`Memory governance garbage collection failed: ${result.reason}`);
                }
                await this.refreshGovernedMemoryActionState();
                await this.notifySettingsChanged();
                const nextAt = this.currentDeviceMemoryGovernanceState
                    ? nextMemoryGovernanceGarbageCollectionAt(this.currentDeviceMemoryGovernanceState)
                    : null;
                this.scheduleMemoryGovernanceGarbageCollection(
                    nextAt !== null && nextAt < Date.now()
                        ? MEMORY_GOVERNANCE_GARBAGE_COLLECTION_RETRY_MS
                        : 0,
                );
            }).catch((error) => {
                this.log("Memory governance garbage collection failed", error);
                this.scheduleMemoryGovernanceGarbageCollection(
                    MEMORY_GOVERNANCE_GARBAGE_COLLECTION_RETRY_MS,
                );
            });
        }, Math.min(Math.max(0, dueAt - Date.now()), MAX_TIMER_DELAY_MS));
    }

    private cancelMemoryGovernanceGarbageCollection(): void {
        if (this.memoryGovernanceGarbageCollectionTimer != null) {
            clearPluginTimeout(this.memoryGovernanceGarbageCollectionTimer);
            this.memoryGovernanceGarbageCollectionTimer = null;
        }
        this.memoryGovernanceGarbageCollectionDueAt = null;
    }

    private governedMemoryActionSuccessMessage(
        action: "correct" | "pause" | "resume" | "apply_device_wide"
            | "limit_to_current_vault" | "forget" | "undo",
    ): string {
        switch (action) {
            case "correct":
                return pageletT("pagelet.tab.memory.corrected", this.getPageletLocale());
            case "pause":
                return pageletT("pagelet.tab.memory.paused", this.getPageletLocale());
            case "resume":
                return pageletT("pagelet.tab.memory.resumed", this.getPageletLocale());
            case "apply_device_wide":
                return this.t("plugin.settings.memoryControlCenter.scope.deviceApplied");
            case "limit_to_current_vault":
                return this.t("plugin.settings.memoryControlCenter.scope.vaultApplied");
            case "forget":
                return pageletT("pagelet.tab.memory.removed", this.getPageletLocale());
            case "undo":
                return pageletT("pagelet.tab.memory.undone", this.getPageletLocale());
        }
    }

    private governedMemoryActionFailure(
        action: "correct" | "pause" | "resume" | "apply_device_wide"
            | "limit_to_current_vault" | "forget" | "undo",
        reason: string,
        pending = false,
    ): MemoryRecordActionResult {
        this.log("Governed Memory lifecycle action unavailable", { action, reason, pending });
        return {
            ok: false,
            message: pending
                ? action === "forget"
                    ? pageletT("pagelet.tab.memory.forgetPending", this.getPageletLocale())
                    : action === "undo"
                        ? pageletT("pagelet.tab.memory.undoCleanupPending", this.getPageletLocale())
                        : action === "apply_device_wide"
                            ? this.t("plugin.settings.memoryControlCenter.scope.cleanupPending")
                        : pageletT("pagelet.tab.memory.actionUnavailable", this.getPageletLocale())
                : pageletT("pagelet.tab.memory.actionUnavailable", this.getPageletLocale()),
        };
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
            const result = await coordinator.confirmQueueItem({
                queueItemId: item.id,
                dataBoundaryAllowed,
            });
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
        try {
            forgotten = await this.getMemoryGovernanceStore().forget(current.id, "user_remove");
        } catch (error) {
            this.log("Confirmed Memory removal persist failed", { id: current.id, error });
            return {
                ok: false,
                message: pageletT("pagelet.tab.memory.removeFailed", this.getPageletLocale(), {
                    reason: "persist_failed",
                }),
            };
        }
        if (!forgotten.ok) {
            return {
                ok: false,
                message: pageletT("pagelet.tab.memory.removeFailed", this.getPageletLocale(), {
                    reason: forgotten.reason,
                }),
            };
        }

        await this.reconcileMemoryQueueAudit();

        return {
            ok: true,
            message: pageletT("pagelet.tab.memory.removed", this.getPageletLocale()),
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
        if (this.unloading) return Promise.resolve();
        if (this.memoryQueueAuditPromise) return this.memoryQueueAuditPromise;
        const result = this.runMemoryQueueAuditReconciliation();
        this.memoryQueueAuditPromise = result;
        void result.then(
            () => {
                if (this.memoryQueueAuditPromise === result) {
                    this.memoryQueueAuditPromise = null;
                }
            },
            () => {
                if (this.memoryQueueAuditPromise === result) {
                    this.memoryQueueAuditPromise = null;
                }
            },
        );
        return result;
    }

    private async runMemoryQueueAuditReconciliation(): Promise<void> {
        try {
            const records = this.getMemoryGovernanceStore().list()
                .filter((record) => Boolean(record.originReviewQueueItemId));
            if (records.length === 0) return;
            const queueStore = this.getReviewQueueStore();
            for (const record of records) {
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
            isDataBoundaryAllowedPath: (path) => this.isDataBoundaryAllowedPath(path),
        };
    }

    createChatService(): ChatService {
        return new ChatService(this.createAiServiceHost());
    }

    private openQuickCaptureModal(): void {
        if (!this.settings.quickCapture.enabled) {
            new Notice(this.t("plugin.quickCapture.notice.disabled"), 3000);
            return;
        }
        this.createQuickCaptureService().openModal();
    }

    private createQuickCaptureService(): QuickCaptureService {
        if (this.quickCaptureService) return this.quickCaptureService;
        this.quickCaptureService = new QuickCaptureService({
            app: this.app,
            settings: this.settings,
            formatDate: (format: string) => moment().format(format),
            now: () => new Date(),
            log: (...args: unknown[]) => this.log(args[0] as string, ...args.slice(1)),
            draft: {
                get: () => this.quickCaptureDraft,
                set: (value) => { this.quickCaptureDraft = value; },
                clear: () => { this.quickCaptureDraft = ""; },
            },
            onCaptureSaved: () => {
                void this.maybeShowQuickCaptureOnboardingNudge();
            },
            postProcessCapture: (input) => this.postProcessQuickCapture(input),
        });
        return this.quickCaptureService;
    }

    private async postProcessQuickCapture(input: QuickCapturePostProcessInput): Promise<void> {
        if (!this.settings.quickCapture.postProcessingEnabled) return;
        const boundaryDecision = this.decideDataBoundaryForPath(input.path);
        if (boundaryDecision.decision === "deny") {
            this.log("Quick Capture post-processing skipped by Data Boundary", boundaryDecision.reason, input.path);
            return;
        }
        const requiresRunDisclosure = boundaryDecision.decision === "ask";
        await runQuickCaptureEnrichment(input, {
            disclosureAccepted: this.settings.quickCapture.postProcessingDisclosureAccepted && !requiresRunDisclosure,
            dataBoundarySnapshotId: boundaryDecision.reason,
            provider: this.settings.aiProvider,
            model: this.settings.chatModelName,
            requestDisclosure: () => confirmUserAction(this.app, {
                title: this.t("plugin.quickCapture.disclosure.title"),
                message: this.t("plugin.quickCapture.disclosure.message"),
                confirmText: this.t("plugin.quickCapture.disclosure.confirm"),
            }),
            markDisclosureAccepted: async () => {
                if (this.settings.quickCapture.postProcessingDisclosureAccepted) return;
                this.settings.quickCapture.postProcessingDisclosureAccepted = true;
                await this.saveSettings();
            },
            invokeModel: async (prompt) => {
                const model = await this.createChatModel(0.2, { maxTokens: 800 });
                if (!model) return null;
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
            createReviewQueueItem: (queueInput) => this.createReviewQueueItem(queueInput),
            now: () => new Date(),
            log: (...args) => this.log(args[0] as string, ...args.slice(1)),
        });
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
                prepareFromCommand: () => this.runManualMemoryAction(
                    () => this.memoryManager?.prepareFromCommand() ?? Promise.resolve(),
                ),
                updateFromCommand: () => this.runManualMemoryAction(
                    () => this.memoryManager?.updateFromCommand() ?? Promise.resolve(),
                ),
                showTechnicalStatus: () => void this.showTechnicalMemoryStatus(),
                onStatusChanged: (listener) => this.onMemoryStatusChanged(listener),
            },
            createChatService: () => new ChatService(this.createAiServiceHost()),
            onSettingsChanged: (listener) => this.onSettingsChanged(listener),
            scheduleMemoryExtractionAfterChatTurn: (conversationId, turnCount) =>
                this.scheduleMemoryExtractionAfterChatTurn(conversationId, turnCount),
            openMemorySettings: (claimId) => this.openMemorySettings(claimId),
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
            encodeURIComponent(getVaultConfigDirStorageScope(this.app.vault)),
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
        const allowedFiles = files.filter((file) => this.isDataBoundaryAllowedFile(file));
        if (allowedFiles.length === 0) return [];
        const maxFiles = Math.max(
            1,
            Math.min(allowedFiles.length, 20, Math.floor(Math.max(1, inputTokenBudget) / 100)),
        );
        const selectedFiles = allowedFiles.slice(0, maxFiles);
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
        limit = 6,
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
            const indexer = new ActiveVaultIndexer({
                searchHybrid: (searchQuery, searchOptions) =>
                    this.vss!.searchHybrid(searchQuery, searchOptions),
            });
            const result = await indexer.retrieveSemantic(query, {
                taskKind: "pagelet-related-notes",
                scope: "pagelet-current",
                excludedPaths: [...excluded],
                isPathAllowed: (path) => this.isDataBoundaryAllowedPath(path),
                retrievalHabitProfile: this.settings.retrievalHabitProfile,
                ftsQueryOverride: null,
                signal: controller.signal,
                limit: Math.max(1, Math.min(limit, QUIET_RECALL_MAX_VAULT_CANDIDATE_NOTES)),
            });
            return result.evidence.map((entry) => ({
                path: entry.path,
                content: entry.content.slice(0, 1200),
                score: entry.score,
                headingPath: entry.headingPath,
            }));
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
        this.cancelMemoryForgetRetry();
        this.cancelMemoryProfileProjectionRetry();
        this.cancelMemoryGovernanceGarbageCollection();
        this.memoryGovernanceRepositoryUnsubscribe?.();
        this.memoryGovernanceRepositoryUnsubscribe = null;
        this.deviceMemoryRecordRepository?.dispose();
        this.deviceMemoryRecordRepository = null;
        const deviceMemoryGovernanceRepository = this.deviceMemoryGovernanceRepository;
        this.deviceMemoryGovernanceRepository = null;
        this.currentDeviceMemoryGovernanceState = null;
        this.memoryGovernanceCoordinator = null;
        this.memoryAdmissionCoordinator = null;
        this.memoryProfileProjectionWorker = null;
        this.memoryLifecycleMutationTail = Promise.resolve();
        if (deviceMemoryGovernanceRepository) {
            await deviceMemoryGovernanceRepository.dispose().catch((error) => {
                this.log("Failed to dispose Memory governance repository", error);
            });
        }
        this.deviceMemoryReviewQueueRepository = null;
        this.memoryGovernanceRecordRepository = null;
        this.reviewQueueRepository = null;
        this.settingsReviewQueueRepository = null;
        this.deviceMemoryCacheRefreshPromise = null;
        this.deviceMemoryCacheRefreshTargetSequence = 0;
        this.currentLocalConfirmedMemoryCount = null;
        this.currentLocalMemoryAutoAcceptPaused = null;
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
        this.reviewQueueStore = null;
        this.savedInsightStore = null;
        this.memoryGovernanceStore = null;
        this.retrievalHabitProfileStore = null;
        this.quickCaptureService = null;
        this.pageletRateLimiterInstance = null;
        clearPageletDetailSessionCache();
    }

    getMemoryExtractionPromptContext(): PaAgentInjectedContext {
        const governedSnapshot = this.getGovernedMemoryProjectionSnapshot();
        if (!governedSnapshot) return this.getLegacyMemoryExtractionPromptContext();
        if (!this.canRunMemoryExtractionRuntime()) {
            // Governed cutover must preserve the same master/extraction/consent
            // boundary as the legacy reader. An empty explicit mode prevents
            // the projector from reviving legacy context as a fallback.
            return { memoryContextMode: "governed" };
        }

        const { state, vaultScopeKey } = governedSnapshot;
        const currentDataBoundaryFingerprint = this.getMemoryDataBoundaryFingerprint();
        const includeVaultInsights = this.settings.memoryExtractionIncludeVaultInsights === true;
        try {
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
                vaultInsights: this.readGovernedVaultInsightsSnapshot(includeVaultInsights),
                currentDataBoundaryFingerprint,
                dataBoundaryAllowed: (revision) => this.isGovernedMemoryRevisionAllowed(
                    revision,
                    currentDataBoundaryFingerprint,
                ),
            });
            return {
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

    private getLegacyMemoryExtractionPromptContext(): PaAgentInjectedContext {
        if (!this.canRunMemoryExtractionRuntime()) return { memoryContextMode: "legacy" };
        const context = this.memoryExtractionScheduler?.getPromptContext() ?? {};
        if (this.settings.memoryExtractionIncludeVaultInsights
            && this.hasConfirmedMemoryExtractionConsent()) {
            return { memoryContextMode: "legacy", ...context };
        }
        const { userProfile } = context;
        return {
            memoryContextMode: "legacy",
            ...(userProfile ? { userProfile } : {}),
        };
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
            || (migration.phase !== "compatibility" && migration.phase !== "finalized")
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
                ?? this.canRunMemoryExtractionRuntime(),
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
            ...(profileLink?.target.kind === "type_a_profile"
                ? { profileRecordId: profileLink.target.profileRecordId }
                : {}),
            label: projection.lifecycle === "forgotten_marker" ? "" : entry.record.summary,
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
        const featureEnabled = this.canRunMemoryExtractionRuntime();
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
        return buildMemoryDataBoundaryFingerprint(this.settings.dataBoundary);
    }

    scheduleMemoryExtractionAfterChatTurn(conversationId: string, turnCount: number): void {
        if (!this.canRunMemoryExtractionRuntime()) return;
        this.memoryExtractionScheduler?.scheduleTypeAExtraction(conversationId, turnCount);
    }

    private async initializeMemoryGovernanceBootstrap(): Promise<void> {
        if (this.memoryGovernanceBootstrapState === "ready" || this.unloading) return;
        const rawPayload = this.legacyMemoryPayload;
        if (!rawPayload) {
            this.failMemoryGovernanceBootstrap("legacy_payload_missing");
            return;
        }
        const compatibilityCheck = this.legacyMemoryCompatibilityBarrier?.composeForSave(this.settings);
        if (compatibilityCheck && !compatibilityCheck.ok) {
            this.failMemoryGovernanceBootstrap(compatibilityCheck.errorCode);
            return;
        }
        const payload = rawPayload;

        const deviceVaultScope = getMemoryGovernanceVaultDeviceScope(this.app.vault);
        if (!deviceVaultScope) {
            this.failMemoryGovernanceBootstrap("vault_identity_unavailable");
            return;
        }
        const opaqueVaultKey = createMemoryGovernanceOpaqueVaultKey(
            this.settings.statisticsVaultId || "default-vault",
            deviceVaultScope,
        );
        const repository = this.createMemoryGovernanceDeviceRepository();
        let recordRepository: DeviceMemoryGovernanceRecordRepository | null = null;
        try {
            const expectedSourceHash = hashLegacyMemoryPayload(payload);
            const existingState = await repository.initialize();
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
            if (existingMigration?.phase === "finalizing" && existingMigration.sourceHash) {
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
                cleanupExactProjection: (input) => this.cleanupExactMemoryProjection(input.projectionLink),
                prepareLegacyCompatibilityForget: (input) => (
                    this.prepareLegacyCompatibilityForget(input)
                ),
                commitLegacyCompatibilityForget: (input) => (
                    this.commitLegacyCompatibilityForget(input)
                ),
            };
            const coordinator = new MemoryGovernanceCoordinator({
                repository,
                opaqueVaultKey,
                projectionCleanupPort: cleanupPort,
            });
            const garbageCollection = await coordinator.collectGarbage();
            if (!garbageCollection.ok) {
                throw new MemoryGovernanceBootstrapError("migration_failed");
            }
            state = await repository.initialize();
            const admissionCoordinator = new MemoryAdmissionCoordinator({
                repository,
                opaqueVaultKey,
            });
            const profileProjectionWorker = new MemoryProfileProjectionWorker({
                repository,
                opaqueVaultKey,
                applyProjection: (input) => this.applyExactProfileProjection(
                    input.profileRecordId,
                    input.summary,
                    input.occurredAt,
                    input.claimId,
                ),
                removeProjection: (input) => this.mutateExactProfileRecord(
                    input.profileRecordId,
                    () => null,
                    true,
                ),
            });
            // Publish the repository/worker boundary before recovery so an
            // upsert that crashed before creating its Profile row can still
            // read exact revision provenance and reconstruct that row.
            this.memoryGovernanceOpaqueVaultKey = opaqueVaultKey;
            this.memoryGovernanceSourceHash = sourceHash;
            this.deviceMemoryGovernanceRepository = repository;
            this.memoryGovernanceCoordinator = coordinator;
            this.memoryAdmissionCoordinator = admissionCoordinator;
            this.memoryProfileProjectionWorker = profileProjectionWorker;
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
                const profileRecovery = await profileProjectionWorker.resumePending();
                if (profileRecovery.pending.length > 0) {
                    profileRecoveryPending = true;
                    this.log("Memory profile projection recovery remains pending", {
                        count: profileRecovery.pending.length,
                    });
                }
                state = await repository.initialize();
            }
            const localPolicy = readCurrentLocalMemoryPolicy(
                state,
                opaqueVaultKey,
                sourceHash,
            );

            this.memoryGovernanceOpaqueVaultKey = opaqueVaultKey;
            this.memoryGovernanceSourceHash = sourceHash;
            this.deviceMemoryGovernanceRepository = repository;
            this.currentDeviceMemoryGovernanceState = cloneSerializable(state);
            this.memoryGovernanceCoordinator = coordinator;
            this.memoryAdmissionCoordinator = admissionCoordinator;
            this.memoryProfileProjectionWorker = profileProjectionWorker;
            this.deviceMemoryRecordRepository = recordRepository;
            this.deviceMemoryReviewQueueRepository = queueRepository;
            this.memoryGovernanceRecordRepository = recordRepository
                ?? createFailClosedMemoryRecordRepository(
                    buildGovernedMemoryViewSnapshot(state, opaqueVaultKey).records
                        .map((entry) => entry.record),
                );
            this.reviewQueueRepository = queueRepository;
            this.currentLocalConfirmedMemoryCount = localPolicy.confirmedMemoryCount;
            this.currentLocalMemoryAutoAcceptPaused = localPolicy.memoryAutoAcceptPaused;
            if (state.migrationStates[opaqueVaultKey]?.phase === "compatibility") {
                this.settings.confirmedMemoryCount = localPolicy.confirmedMemoryCount;
                this.settings.memoryAutoAcceptPaused = localPolicy.memoryAutoAcceptPaused;
            }
            this.memoryGovernanceBootstrapState = "ready";
            this.memoryGovernanceBootstrapErrorCode = null;
            this.memoryGovernanceStore = null;
            this.reviewQueueStore = null;
            this.deviceMemoryCacheRefreshTargetSequence = state.commitSequence;
            this.memoryGovernanceRepositoryUnsubscribe = repository.subscribe((commitSequence) => {
                this.scheduleDeviceMemoryCacheRefresh(commitSequence);
            });
            if (forgetRecoveryPending) this.scheduleMemoryForgetRetry();
            if (profileRecoveryPending) this.scheduleMemoryProfileProjectionRetry();
            this.scheduleMemoryGovernanceGarbageCollection();
        } catch (error) {
            recordRepository?.dispose();
            await repository.dispose().catch(() => undefined);
            this.failMemoryGovernanceBootstrap(
                this.memoryGovernanceBootstrapErrorCode
                    ?? (error instanceof MemoryGovernanceBootstrapError
                        ? error.code
                        : error instanceof Error ? error.name : "bootstrap_failed"),
            );
        }
    }

    private createMemoryGovernanceDeviceRepository(): MemoryGovernanceRepository {
        const pluginId = (this.manifest as { id?: string } | undefined)?.id ?? "personal-assistant";
        return createDeviceMemoryGovernanceRepository(pluginId);
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
        await this.mutateExactProfileRecord(link.target.profileRecordId, () => null, true);
    }

    private async applyExactProfileProjection(
        profileRecordId: string,
        summary: string,
        occurredAt: string,
        claimId: string,
    ): Promise<void> {
        const normalizedSummary = summary.trim();
        if (!profileRecordId.trim() || !normalizedSummary) {
            throw new Error("Invalid exact Profile projection input.");
        }
        const repository = this.deviceMemoryGovernanceRepository;
        const snapshot = repository ? await repository.initialize() : null;
        const claim = snapshot?.claims.find((candidate) => candidate.id === claimId);
        const revision = claim?.activeRevisionId
            ? snapshot?.revisions.find((candidate) => (
                candidate.id === claim.activeRevisionId && candidate.claimId === claim.id
            ))
            : undefined;
        const conversation = revision?.provenance.find((entry) => entry.kind === "conversation");
        const conversationIds = conversation?.kind === "conversation"
            ? [...conversation.conversationIds]
            : [];
        const observedAt = conversation?.kind === "conversation"
            ? conversation.observedAt
            : occurredAt;
        await this.mutateExactProfileRecord(profileRecordId, (record) => ({
            ...record,
            text: normalizedSummary,
            kind: "user_correction",
            confidence: "high",
            confirmed: true,
            observedAt: occurredAt,
        }), false, () => {
            if (conversationIds.length === 0) {
                throw new Error("Exact Profile projection conversation evidence is missing.");
            }
            return {
                profileRecordId,
                key: `governed-${claimId}`,
                text: normalizedSummary,
                kind: revision?.authority === "user_correction"
                    ? "user_correction"
                    : "user_explicit",
                confidence: "high",
                conversationId: conversationIds[0],
                observedAt,
                occurrences: Math.max(1, conversationIds.length),
                conversationIds,
                confirmed: true,
            };
        });
    }

    private async mutateExactProfileRecord(
        profileRecordId: string,
        transform: (record: UserProfileRecord) => UserProfileRecord | null,
        allowMissing: boolean,
        createMissing?: () => UserProfileRecord,
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

        if (this.memoryExtractionScheduler) {
            await this.memoryExtractionScheduler.mutateUserProfile(mutation);
            return;
        }
        const port = new SerializedProfileGovernancePort(this.createUserProfileStore(), () => now);
        try {
            await port.initialize();
            await port.mutate(mutation);
        } finally {
            await port.dispose().catch(() => undefined);
        }
    }

    private failMemoryGovernanceBootstrap(errorCode: string): void {
        this.cancelMemoryForgetRetry();
        this.cancelMemoryProfileProjectionRetry();
        this.cancelMemoryGovernanceGarbageCollection();
        this.memoryGovernanceBootstrapState = "failed";
        this.memoryGovernanceBootstrapErrorCode = errorCode;
        this.memoryGovernanceOpaqueVaultKey = null;
        this.memoryGovernanceSourceHash = null;
        this.deviceMemoryGovernanceRepository = null;
        this.currentDeviceMemoryGovernanceState = null;
        this.memoryGovernanceCoordinator = null;
        this.memoryAdmissionCoordinator = null;
        this.memoryProfileProjectionWorker = null;
        this.deviceMemoryRecordRepository = null;
        this.deviceMemoryReviewQueueRepository = null;
        this.currentLocalConfirmedMemoryCount = null;
        this.currentLocalMemoryAutoAcceptPaused = null;
        this.deviceMemoryCacheRefreshTargetSequence = 0;
        this.memoryGovernanceRecordRepository = createFailClosedMemoryRecordRepository(
            this.settings.memoryGovernance?.records ?? [],
        );
        this.reviewQueueRepository = createFailClosedReviewQueueRepository(
            this.settings.reviewQueue?.items ?? [],
            (state) => this.persistPaSettingsSlice(
                () => this.settings.reviewQueue.items,
                (items) => { this.settings.reviewQueue.items = items; },
                state.items,
            ),
        );
        this.memoryGovernanceStore = null;
        this.reviewQueueStore = null;
        try {
            this.log("Memory governance bootstrap unavailable", { code: errorCode });
        } catch {
            // Bootstrap failure must not prevent the legacy prompt path.
        }
    }

    private getOrCreateSettingsReviewQueueRepository(): ReviewQueueRepository {
        if (!this.settingsReviewQueueRepository) {
            this.settingsReviewQueueRepository = new CallbackReviewQueueRepository(
                this.settings.reviewQueue.items,
                (state) => this.persistPaSettingsSlice(
                    () => this.settings.reviewQueue.items,
                    (items) => { this.settings.reviewQueue.items = items; },
                    state.items,
                ),
            );
        }
        return this.settingsReviewQueueRepository;
    }

    private scheduleDeviceMemoryCacheRefresh(commitSequence: number): void {
        this.deviceMemoryCacheRefreshTargetSequence = Math.max(
            this.deviceMemoryCacheRefreshTargetSequence,
            commitSequence,
        );
        if (this.unloading
            || this.memoryGovernanceBootstrapState !== "ready"
            || this.deviceMemoryCacheRefreshPromise) return;
        const refresh = Promise.resolve().then(async () => {
            while (!this.unloading && this.memoryGovernanceBootstrapState === "ready") {
                await this.refreshDeviceMemoryCaches();
                const observed = this.currentDeviceMemoryGovernanceState?.commitSequence ?? 0;
                if (observed >= this.deviceMemoryCacheRefreshTargetSequence) return;
            }
        });
        this.deviceMemoryCacheRefreshPromise = refresh;
        void refresh.then(
            () => {
                if (this.deviceMemoryCacheRefreshPromise === refresh) {
                    this.deviceMemoryCacheRefreshPromise = null;
                }
            },
            (error) => {
                if (this.deviceMemoryCacheRefreshPromise === refresh) {
                    this.deviceMemoryCacheRefreshPromise = null;
                }
                try {
                    this.log("Memory governance cache refresh failed", error);
                } catch {
                    // Repository notifications must never block callers.
                }
            },
        );
    }

    private async refreshDeviceMemoryCaches(): Promise<void> {
        const repository = this.deviceMemoryGovernanceRepository;
        const recordRepository = this.deviceMemoryRecordRepository;
        const opaqueVaultKey = this.memoryGovernanceOpaqueVaultKey;
        const sourceHash = this.memoryGovernanceSourceHash;
        if (!repository || !opaqueVaultKey || !sourceHash || this.unloading) return;

        const state = await repository.initialize();
        const localPolicy = readCurrentLocalMemoryPolicy(state, opaqueVaultKey, sourceHash);
        if (recordRepository
            && state.migrationStates[opaqueVaultKey]?.phase === "compatibility"
            && buildLegacyMemoryRollbackProjection(state, opaqueVaultKey).ok) {
            await recordRepository.refresh();
        }
        const queueRepository = await createMemoryReviewQueueRepository({
            repository,
            settingsRepository: this.getOrCreateSettingsReviewQueueRepository(),
            opaqueVaultKey,
        });
        if (this.unloading || this.memoryGovernanceBootstrapState !== "ready") return;
        this.currentDeviceMemoryGovernanceState = cloneSerializable(state);
        this.currentLocalConfirmedMemoryCount = localPolicy.confirmedMemoryCount;
        this.currentLocalMemoryAutoAcceptPaused = localPolicy.memoryAutoAcceptPaused;
        if (state.migrationStates[opaqueVaultKey]?.phase === "compatibility") {
            this.settings.confirmedMemoryCount = localPolicy.confirmedMemoryCount;
            this.settings.memoryAutoAcceptPaused = localPolicy.memoryAutoAcceptPaused;
        }
        this.deviceMemoryReviewQueueRepository = queueRepository;
        this.reviewQueueRepository = queueRepository;
        this.memoryGovernanceStore = null;
        this.reviewQueueStore = null;
        this.scheduleMemoryGovernanceGarbageCollection();
    }

    private async updateCurrentLocalMemoryPolicy(
        next: Partial<{ confirmedMemoryCount: number; memoryAutoAcceptPaused: boolean }>,
    ): Promise<void> {
        const repository = this.deviceMemoryGovernanceRepository;
        const opaqueVaultKey = this.memoryGovernanceOpaqueVaultKey;
        const sourceHash = this.memoryGovernanceSourceHash;
        if (this.memoryGovernanceBootstrapState !== "ready"
            || !repository
            || !opaqueVaultKey
            || !sourceHash) {
            throw new MemoryGovernanceBootstrapError("memory_mutation_blocked");
        }
        const updated = await repository.transact((draft) => writeCurrentLocalMemoryPolicy(
            draft,
            opaqueVaultKey,
            sourceHash,
            next,
            new Date(),
        ));
        this.currentLocalConfirmedMemoryCount = updated.confirmedMemoryCount;
        this.currentLocalMemoryAutoAcceptPaused = updated.memoryAutoAcceptPaused;
        this.settings.confirmedMemoryCount = updated.confirmedMemoryCount;
        this.settings.memoryAutoAcceptPaused = updated.memoryAutoAcceptPaused;
    }

    async loadSettings() {
        const loaded = await this.loadData();
        this.legacyMemoryCompatibilityBarrier = new LegacyMemoryCompatibilityBarrier(loaded);
        this.legacyMemoryPayload = this.legacyMemoryCompatibilityBarrier.snapshot();
        const fresh = isFreshInstall(loaded);
        this.needsLegacyAiProviderMigration = isLegacyV1Install(loaded);
        const rawMemoryExtractionEnabled = (typeof loaded === "object" && loaded !== null)
            ? (loaded as Record<string, unknown>).memoryExtractionEnabled
            : undefined;
        this.settings = mergeLoadedSettings(loaded);
        if (rawMemoryExtractionEnabled === true && !this.settings.memoryExtractionEnabled) {
            this.settings.memoryExtractionConsent = {
                state: "confirmed",
                version: MEMORY_EXTRACTION_CONSENT_VERSION,
                confirmedAt: new Date().toISOString(),
            };
            this.settings.memoryExtractionEnabled = true;
            this.pendingMemoryExtractionConsentMigration = true;
        }
        if (fresh) {
            // Force an explicit provider choice on first run instead of
            // defaulting to qwen. The Settings UI renders a "Choose your
            // AI provider" prompt while aiProvider is empty.
            this.settings.aiProvider = "";
        }
        // Detect when a pre-existing `pagelet.reviewsFolder` was just coerced
        // by the now-stricter validator (e.g. an early-beta user stored a path
        // under the Obsidian config dir or "C:\\notes"). The
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
            const inspection = normalizeReviewsFolder(rawReviewsFolder, {
                configDir: getVaultConfigDir(this.app.vault),
            });
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
        const saved = await this.enqueueSettingsWrite(async () => {
            if (this.unloading) return false;
            await this.saveSettingsData();
            return true;
        });
        if (saved) await this.notifySettingsChanged();
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

    private async persistPaSettingsSlice<T>(
        read: () => T,
        write: (value: T) => void,
        next: T,
    ): Promise<void> {
        const saved = await this.enqueueSettingsWrite(async () => {
            if (this.unloading) return false;
            const previous = read();
            write(next);
            try {
                await this.saveSettingsData();
                return true;
            } catch (error) {
                write(previous);
                throw error;
            }
        });
        if (saved) await this.notifySettingsChanged();
    }

    private async saveSettingsData(): Promise<void> {
        const barrier = this.legacyMemoryCompatibilityBarrier;
        if (!barrier) {
            await this.saveData(this.settings);
            return;
        }
        if (!barrier.isActive() && !barrier.isFinalizing()) {
            await this.saveData(this.settings);
            return;
        }
        const processed = await this.processPluginDataJson((persisted) => {
            const composed = barrier.composeForSave(this.settings, persisted);
            if (!composed.ok) {
                this.memoryGovernanceBootstrapErrorCode = composed.errorCode;
                throw new MemoryGovernanceBootstrapError("legacy_save_collision");
            }
            return composed.payload;
        });
        if (!barrier.refreshFromPersisted(processed.readback)) {
            throw new MemoryGovernanceBootstrapError("legacy_save_collision");
        }
        this.legacyMemoryPayload = barrier.snapshot();
        await this.synchronizeNonMemoryQueueFromPersisted(processed.readback);
    }

    private async synchronizeNonMemoryQueueFromPersisted(raw: unknown): Promise<void> {
        const items = buildLegacyReviewQueuePassthrough(
            captureLegacyMemoryPayload(raw).reviewQueue,
        ).liveNonMemoryItems.map(cloneSerializable);
        this.settings.reviewQueue.items = items;
        if (!this.settingsReviewQueueRepository && !this.deviceMemoryGovernanceRepository) return;
        this.settingsReviewQueueRepository = new CallbackReviewQueueRepository(
            items,
            (state) => this.persistPaSettingsSlice(
                () => this.settings.reviewQueue.items,
                (next) => { this.settings.reviewQueue.items = next; },
                state.items,
            ),
        );
        const repository = this.deviceMemoryGovernanceRepository;
        const vaultKey = this.memoryGovernanceOpaqueVaultKey;
        if (repository && vaultKey && this.memoryGovernanceBootstrapState === "ready") {
            const combined = await createMemoryReviewQueueRepository({
                repository,
                settingsRepository: this.settingsReviewQueueRepository,
                opaqueVaultKey: vaultKey,
            });
            this.deviceMemoryReviewQueueRepository = combined;
            this.reviewQueueRepository = combined;
        } else {
            this.reviewQueueRepository = this.settingsReviewQueueRepository;
        }
        this.reviewQueueStore = null;
    }

    private getPluginDataJsonPath(): string {
        const manifestDir = this.manifest?.dir?.trim();
        const pluginDir = manifestDir
            ? normalizePath(manifestDir)
            : joinVaultConfigPath(
                getVaultConfigDir(this.app.vault),
                `plugins/${this.manifest?.id?.trim() || "personal-assistant"}`,
            );
        return normalizePath(`${pluginDir}/data.json`);
    }

    private async processPluginDataJson(
        mutate: (persisted: Record<string, unknown>) => Record<string, unknown>,
    ): Promise<{
        written: Record<string, unknown>;
        readback: Record<string, unknown>;
    }> {
        const adapter = this.app.vault.adapter;
        if (typeof adapter.process !== "function" || typeof adapter.read !== "function") {
            throw new MemoryGovernanceBootstrapError("legacy_save_collision");
        }
        const path = this.getPluginDataJsonPath();
        return withMemoryExternalOperationTimeout(
            "plugin_data_json_transaction",
            async () => {
                const writtenText = await adapter.process(path, (currentText) => {
                    const current = this.parsePluginDataJson(currentText);
                    return JSON.stringify(mutate(current), null, 2);
                });
                const written = this.parsePluginDataJson(writtenText);
                const readback = this.parsePluginDataJson(await adapter.read(path));
                return { written, readback };
            },
        );
    }

    private async readPluginDataJson(): Promise<Record<string, unknown>> {
        const adapter = this.app.vault.adapter;
        if (typeof adapter.read !== "function") {
            throw new MemoryGovernanceBootstrapError("legacy_save_collision");
        }
        return this.parsePluginDataJson(await adapter.read(this.getPluginDataJsonPath()));
    }

    private parsePluginDataJson(value: string): Record<string, unknown> {
        let parsed: unknown;
        try {
            parsed = value.trim() ? JSON.parse(value) : {};
        } catch {
            throw new MemoryGovernanceBootstrapError("legacy_save_collision");
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new MemoryGovernanceBootstrapError("legacy_save_collision");
        }
        return parsed as Record<string, unknown>;
    }

    private enqueueSettingsWrite<T>(operation: () => Promise<T>): Promise<T> {
        this.settingsSaveTail ??= Promise.resolve();
        const result = this.settingsSaveTail.then(operation, operation);
        this.settingsSaveTail = result.then(() => undefined, () => undefined);
        return result;
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

    private surfacePendingMemoryExtractionConsentMigration(): void {
        if (!this.pendingMemoryExtractionConsentMigration) return;
        this.pendingMemoryExtractionConsentMigration = false;
        const message = this.t("plugin.migration.memoryExtractionConsent");
        try {
            new Notice(message, 10000);
        } catch (error) {
            this.log("Failed to fire memory extraction consent migration Notice", error);
        }
        this.log("Memory extraction consent migration: feature was enabled but consent is unconfirmed; emitted one-time Notice");
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

    private async waitForEnabledPluginInstance(pluginId: string, timeoutMs: number): Promise<unknown> {
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
                    void this.app.fileManager.processFrontMatter(file, (frontmatter) => {
                        for (const key of Object.getOwnPropertyNames(frontmatter)) {
                            for (const metaConfig of this.settings.metadatas) {
                                if (key === metaConfig.key) {
                                    this.log(frontmatter[key]);
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
                                    frontmatter[key] = valut2Change;
                                }
                            }
                        }
                        setPluginTimeout(() => {
                            this.updateDebouncer.cancel();
                        }, 100);
                    }).catch((error) => {
                        this.log("Failed to update metadata frontmatter", error);
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
            await workspace.revealLeaf(leaf);
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
        const files = this.app.vault.getMarkdownFiles();
        const normalizedExcludePaths = (this.settings.vssCacheExcludePath ?? [])
            .map((path) => path.trim())
            .filter(Boolean);
        return files.filter((file) =>
            !normalizedExcludePaths.some((prefix) => file.path.startsWith(prefix))
            && this.isDataBoundaryAllowedFile(file)
        );
    }

    private decideDataBoundaryForPath(path: string): DataBoundaryDecision {
        const normalizedPath = normalizePath(path).replace(/^\.\//, "");
        const file = this.app.vault.getAbstractFileByPath?.(normalizedPath);
        if (file instanceof TFile) {
            return decideDataBoundaryForSource(
                {
                    path: file.path,
                    tags: this.getDataBoundaryTags(file),
                    isGenerated: this.isGeneratedDataBoundaryFile(file),
                },
                this.settings.dataBoundary,
            );
        }
        const isGenerated = normalizedPath.startsWith(".pagelet/")
            || normalizedPath === ".pagelet"
            || normalizedPath.startsWith("pagelet-generated/")
            || normalizedPath === "pagelet-generated";
        return decideDataBoundaryForSource(
            { path: normalizedPath, isGenerated },
            this.settings.dataBoundary,
        );
    }

    private isDataBoundaryAllowedPath(path: string): boolean {
        const decision = this.decideDataBoundaryForPath(path);
        return decision.decision === "allow";
    }

    private isDataBoundaryAllowedFile(file: TFile): boolean {
        const decision = decideDataBoundaryForSource(
            {
                path: file.path,
                tags: this.getDataBoundaryTags(file),
                isGenerated: this.isGeneratedDataBoundaryFile(file),
            },
            this.settings.dataBoundary,
        );
        return decision.decision === "allow";
    }

    private getDataBoundaryTags(file: TFile): string[] {
        const tags = new Set<string>();
        const cache = this.app.metadataCache?.getFileCache(file);
        const metadataTags = Array.isArray(cache?.tags) ? cache.tags : [];
        for (const tag of metadataTags) {
            if (typeof tag === "string") {
                this.collectDataBoundaryTag(tag, tags);
            } else if (tag && typeof tag === "object" && typeof (tag as { tag?: unknown }).tag === "string") {
                this.collectDataBoundaryTag((tag as { tag: string }).tag, tags);
            }
        }
        const frontmatter = cache?.frontmatter as Record<string, unknown> | undefined;
        this.collectDataBoundaryTags(frontmatter?.tags, tags);
        this.collectDataBoundaryTags(frontmatter?.tag, tags);
        return [...tags];
    }

    private collectDataBoundaryTags(value: unknown, tags: Set<string>): void {
        if (Array.isArray(value)) {
            value.forEach((entry) => this.collectDataBoundaryTags(entry, tags));
            return;
        }
        if (typeof value !== "string") return;
        value
            .split(/[,\s]+/)
            .map((tag) => tag.trim().replace(/^#+/, "").toLowerCase())
            .filter(Boolean)
            .forEach((tag) => tags.add(tag));
    }

    private collectDataBoundaryTag(value: string, tags: Set<string>): void {
        const tag = value.trim().replace(/^#+/, "").toLowerCase();
        if (tag) tags.add(tag);
    }

    private isGeneratedDataBoundaryFile(file: TFile): boolean {
        const frontmatter = this.app.metadataCache?.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
        return frontmatter?.pagelet === true;
    }

    private getPageletSettingsWithDataBoundary(): PageletSettings {
        const dataBoundaryGeneratedFolders = this.settings.dataBoundary.generatedNotePolicy === "include-generated"
            ? []
            : [".pagelet", "pagelet-generated"];
        return {
            ...this.settings.pagelet,
            excludedFolders: this.uniqueSettingList([
                ...this.settings.pagelet.excludedFolders,
                ...this.settings.dataBoundary.excludedFolders,
                ...dataBoundaryGeneratedFolders,
            ]),
            excludedTags: this.uniqueSettingList([
                ...this.settings.pagelet.excludedTags,
                ...this.settings.dataBoundary.excludedTags.map((tag) => tag.replace(/^#+/, "").toLowerCase()),
            ]),
        };
    }

    private uniqueSettingList(values: readonly string[]): string[] {
        const seen = new Set<string>();
        const result: string[] = [];
        for (const value of values) {
            const normalized = value.trim();
            if (!normalized || seen.has(normalized)) continue;
            seen.add(normalized);
            result.push(normalized);
        }
        return result;
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

    createExistingUserProfileReader(): ExistingUserProfileReader {
        const manifest = this.manifest as { id?: string } | undefined;
        return createExistingUserProfileReader(
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
        if (this.manualMemoryActionInFlight) {
            new Notice(this.t("plugin.memory.notice.actionAlreadyRunning"), 4000);
            return;
        }
        this.manualMemoryActionInFlight = true;
        try {
            await action();
        } finally {
            this.manualMemoryActionInFlight = false;
        }
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
            void this.runManualMemoryAction(action).catch((error) => {
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
            const normalizedFeaturedImageModel = normalizeFeaturedImageModel(this.settings.featuredImageModel);
            if (this.settings.featuredImageModel !== normalizedFeaturedImageModel) {
                this.settings.featuredImageModel = normalizedFeaturedImageModel;
                changed = true;
            }
            const normalizedNumFeaturedImages = normalizeFeaturedImageCount(this.settings.numFeaturedImages);
            if (this.settings.numFeaturedImages !== normalizedNumFeaturedImages) {
                this.settings.numFeaturedImages = normalizedNumFeaturedImages;
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
                if (this.settings.pagelet) {
                    const pageletFolder = normalizeReviewsFolder(this.settings.pagelet.reviewsFolder, { configDir });
                    if (pageletFolder.error) {
                        if (!readPageletMigrationFlag()) {
                            this.pendingPageletReviewsFolderMigration = {
                                input: pageletFolder.input ?? this.settings.pagelet.reviewsFolder,
                                error: pageletFolder.error,
                            };
                        }
                        this.settings.pagelet.reviewsFolder = pageletFolder.value;
                        changed = true;
                    } else if (this.settings.pagelet.reviewsFolder !== pageletFolder.value) {
                        this.settings.pagelet.reviewsFolder = pageletFolder.value;
                        changed = true;
                    }
                }
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

    private getAPITokenSecretCandidateIds(): string[] {
        const currentId = this.getAPITokenSecretId();
        const defaultScopedId = getVaultApiTokenId("default-vault");
        return [currentId, defaultScopedId, KEYCHAIN_API_TOKEN_ID]
            .filter((id, index, ids) => ids.indexOf(id) === index);
    }

    getConfiguredAPITokenSecret(): string | null {
        const currentId = this.getAPITokenSecretId();
        const currentToken = this.app.secretStorage.getSecret(currentId);
        if (hasSecretValue(currentToken)) return currentToken;

        for (const legacyId of this.getAPITokenSecretCandidateIds()) {
            if (legacyId === currentId) continue;
            const legacyToken = this.app.secretStorage.getSecret(legacyId);
            if (!hasSecretValue(legacyToken)) continue;
            return legacyToken;
        }

        return null;
    }

    setAPITokenSecret(value: string): void {
        const currentId = this.getAPITokenSecretId();
        this.app.secretStorage.setSecret(currentId, value);
        if (value === "") {
            for (const legacyId of this.getAPITokenSecretCandidateIds()) {
                if (legacyId !== currentId) {
                    this.app.secretStorage.setSecret(legacyId, "");
                }
            }
        }
        this.clearTokenCache();
    }

    hasConfiguredAPIToken(): boolean {
        return hasSecretValue(this.getConfiguredAPITokenSecret());
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
        const token = this.getConfiguredAPITokenSecret();
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
