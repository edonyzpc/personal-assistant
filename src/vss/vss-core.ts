/* Copyright 2023 edonyzpc */
import { Notice, Platform, TAbstractFile, TFile } from 'obsidian';
import { Document } from "@langchain/core/documents";

import { AIUtils, type CreateEmbeddingsOptions } from '../ai-services/ai-utils';
import type { MemoryHost } from '../memory';
import { computeContentHash, selectFlushCandidates, DirtyTimestamps } from '../vss-helpers';
import { createInlineSqliteWorker, getInlineSqliteWasmUrl } from './sqlite-inline-assets';
import { SqliteVectorIndex } from './sqlite-vector-index';
import { getVSSDeviceId } from './state';
import { createVSSIndexStateStore, type VSSIndexStateStore } from './local-state-store';
import { toError } from '../error-utils';
import { getPlatformCrypto, getPlatformNavigatorStorage } from '../platform-dom';
import {
    getEmbeddingProfileSignature,
    VSS_DEFAULT_DIMENSIONS,
    VSS_DEFAULT_DISTANCE_METRIC,
    VSS_SCHEMA_VERSION,
    type EmbeddingProfile,
    type LexicalIndexStatus,
    type LexicalSearchStatus,
    type PathEvidenceGenerationRef,
    type PathEvidenceGenerationLookupOptions,
    type PathEvidenceGenerationStatus,
    type PathEvidenceGenerationStatusResult,
    type QueryEmbeddingInput,
    type QueryEmbeddingOutput,
    type RankGraphCandidatesOptions,
    type RankedPathRequestControl,
    type RankedPathRequestResult,
    type VectorIndex,
    type VectorIndexPathLookupOptions,
    type VectorIndexStatus,
    type VectorSearchResult,
    type VSSChunk,
    type VSSFileRecord,
    type VSSIndexMarker,
    type VSSIndexStats,
    type VSSMemoryStatus,
    type VSSMemoryStatusSnapshot,
} from './types';
import type { MemoryMaintenancePlan } from '../memory-manager';
import { confirmUserAction } from '../confirm';
import { buildFtsQuery } from './fts-query-builder';
import { CHAR_PHRASE_PROFILE_ID, getCharPhraseRuntimeCanaryFingerprint } from './lexical-normalizer';
import {
    RETRIEVAL_CALIBRATION_PROFILE,
    selectRetrievalSearchRuntimeParameters,
    type RetrievalCalibrationMode,
    type RetrievalSearchRuntimeParameters,
} from './retrieval-calibration';
import { createAbortError, throwIfAborted } from '../ai-services/chat-utils';
import { getPluginUiLanguage, pluginT } from '../locales/plugin';
import { createHeadingAwareMarkdownChunks } from './markdown-chunker';
import { normalizeVaultPath, stableHash } from '../pa/helpers';
import { errorMessage } from "../ai-services/agent-utils";
import { resolveB125RetrievalOptimizationFlags } from '../retrieval-optimization-platform-policy';
import {
    EMBEDDING_RETRY_DELAYS_MS,
    QWEN_TEXT_EMBEDDING_SAFE_TPM,
    estimateEmbeddingTokens,
    estimateEmbeddingTokensForTexts,
    formatBytes,
    getProgressFileName,
    getProgressPathName,
    isMissingFileError,
    isRetryableEmbeddingError,
    sleep,
    withTimeout,
    type EmbeddingBatchPolicy,
    type EmbeddingsModel,
    type EmbeddingsModelProvider,
    type RebuildChunkWorkItem,
    type RebuildFileState,
} from './vss-indexer';
import {
    VSS_DESKTOP_CHAT_VERIFY_MAX_BYTES,
    VSS_DESKTOP_CHAT_VERIFY_MAX_FILES,
    VSS_DESKTOP_CHAT_VERIFY_MAX_WALL_CLOCK_MS,
    VSS_DESKTOP_VERIFY_MAX_BYTES,
    VSS_DESKTOP_VERIFY_MAX_FILES,
    VSS_DESKTOP_VERIFY_MAX_WALL_CLOCK_MS,
    VSS_MOBILE_CHAT_VERIFY_MAX_BYTES,
    VSS_MOBILE_CHAT_VERIFY_MAX_FILES,
    VSS_MOBILE_CHAT_VERIFY_MAX_WALL_CLOCK_MS,
    VSS_MOBILE_VERIFY_MAX_BYTES,
    VSS_MOBILE_VERIFY_MAX_FILES,
    VSS_MOBILE_VERIFY_MAX_WALL_CLOCK_MS,
    VSS_RECONCILE_BATCH_SIZE,
    VSS_RECONCILE_MAX_METADATA_PER_RUN,
    VSS_ROLLING_HASH_VERIFY_LIMIT,
    rotateByCursor,
    type VSSReconcileOptions,
    type VSSReconcileSummary,
    type VSSVerifyOptions,
    type VSSVerifySummary,
    type VerifyReason,
    type VerifyRecord,
} from './vss-reconciler';
import {
    VSS_PARAMS,
    createEmptyOperationSummary,
    type VSSFlushOptions,
    type VSSOperationOptions,
    type VSSOperationSummary,
    type VSSProgressEvent,
    type VSSProgressPhase,
    type VSSLexicalRebuildOptions,
    type VSSLexicalRebuildSummary,
} from './vss-maintenance';

const VSS_OPFS_ROOT = "/personal-assistant-vss-v2";
const VSS_LEGACY_OPFS_ROOT = "/personal-assistant-vss";
const VSS_FOREGROUND_LOCKED_WAIT_MS = 3_000;
const VSS_MANUAL_LOCKED_WAIT_MS = 3_000;
const VSS_INDEX_DISPOSE_TIMEOUT_MS = 4_000;
const VSS_SHUTDOWN_DRAIN_TIMEOUT_MS = 750;
const VSS_RECOVERY_COOLDOWN_MS = 5_000;
const VSS_LOCAL_STATE_UNAVAILABLE_CODE = "vss-local-state-unavailable";

function vssT(key: string, params?: Readonly<Record<string, string | number>>, fallback?: string): string {
    return pluginT(key, getPluginUiLanguage(), params, fallback);
}

export type VSSRefreshStatus = 'updated' | 'unchanged' | 'metadata-synced' | 'removed' | 'skipped';
export type VSSChangeObservation =
    | { kind: "ignored"; path?: string; reason?: string }
    | { kind: "verify-candidate"; path: string; reason: string }
    | { kind: "confirmed-dirty"; path: string; reason: string };

interface VSSChangeObservationOptions {
    verifyMatchingMetadata?: boolean;
}

interface VSSFileMetadataSnapshot {
    path: string;
    capturedAt: number;
    ctime: number;
    mtime: number;
    size: number;
}

interface VSSFileContentSnapshot extends VSSFileMetadataSnapshot {
    cleanedContent: string;
    contentHash: string | null;
    tooLarge: boolean;
    changedDuringCapture: boolean;
}

export type {
    VSSFlushOptions,
    VSSOperationOptions,
    VSSOperationSummary,
    VSSProgressEvent,
    VSSProgressPhase,
} from './vss-maintenance';
export type {
    VSSReconcileOptions,
    VSSReconcileSummary,
    VSSVerifyOptions,
    VSSVerifySummary,
} from './vss-reconciler';

interface StoragePersistenceStatus {
    persisted: boolean;
    usage?: number;
    quota?: number;
}

interface LegacyJsonSummary {
    fileCount: number;
    bytes: number;
    paths: string[];
}

export type VSSIndexOpenMode = "foreground" | "manual";

interface VSSEnsureIndexOptions {
    allowFallback: boolean;
    allowMissingIndexRecovery?: boolean;
    mode?: VSSIndexOpenMode;
}

interface VSSShutdownEntry {
    ownerId: string;
    promise: Promise<void>;
    startedAt: number;
}

type VSSOperationPriority = "foreground" | "maintenance";

interface VSSQueuedOperation {
    run: () => Promise<void>;
    started: boolean;
}

type LexicalCapableVectorIndex = SqliteVectorIndex;

const vssShutdownBarriers = new Map<string, VSSShutdownEntry>();

async function waitForAbortablePromise<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    throwIfAborted(signal);
    return new Promise<T>((resolve, reject) => {
        const cleanup = () => {
            signal.removeEventListener("abort", onAbort);
        };
        const onAbort = () => {
            cleanup();
            try {
                throwIfAborted(signal);
            } catch (error) {
                reject(toError(error));
            }
        };
        signal.addEventListener("abort", onAbort, { once: true });
        try {
            throwIfAborted(signal);
        } catch (error) {
            cleanup();
            reject(toError(error));
            return;
        }
        promise.then(
            (value) => {
                cleanup();
                resolve(value);
            },
            (error) => {
                cleanup();
                reject(toError(error));
            },
        );
    });
}

export class VSS {
    private host: MemoryHost;
    private vssCacheDir: string;
    private aiUtils: AIUtils;
    private dirty = new Map<string, DirtyTimestamps>();
    private verifyQueue = new Map<string, VerifyRecord>();
    private dirtyEpochCounter = 0;
    private isFlushing = false;
    private operationActive = false;
    private readonly foregroundOperations: VSSQueuedOperation[] = [];
    private readonly maintenanceOperations: VSSQueuedOperation[] = [];
    private stateWriteChain: Promise<void> = Promise.resolve();
    private initializationPromise: Promise<void> | null = null;
    private ensureIndexPromise: Promise<void> | null = null;
    private disposePromise: Promise<void> | null = null;
    private processedWindow = { count: 0, windowStart: 0 };
    private nextEmbeddingRequestAt = 0;
    private recordReconcileCursor = 0;
    private reconcileCursor = 0;
    private reconcilePhase: "records" | "files" = "records";
    private hashVerifyCursor = 0;
    private initialized = false;
    private disposed = false;
    private index: VectorIndex | null = null;
    private status: VectorIndexStatus = "uninitialized";
    private deviceId = "";
    private profile: EmbeddingProfile | null = null;
    private marker: VSSIndexMarker | null = null;
    private storageStatus: StoragePersistenceStatus = { persisted: false };
    private localStateReady = false;
    private localStateHydrated = false;
    private localStateClearPending = false;
    private dirtyJournalWritePending = false;
    private markerWritePending = false;
    private markerRecoverySuppressed = false;
    private stateGeneration = 0;
    private lastMissingIndexNoticeAt = 0;
    private readonly ownerId = createIndexId();
    private lastErrorCode: string | undefined;
    private sqliteRecoveryPromise: Promise<void> | null = null;
    private nextSqliteRecoveryAt = 0;
    private lexicalStatus: LexicalIndexStatus | null = null;
    private lastLexicalSearchStatus: LexicalSearchStatus | null = null;
    private readonly pageletQueryEmbeddingCache = new Map<string, number[]>();
    private readonly pageletQueryEmbeddingInFlight = new Map<string, Promise<number[]>>();

    constructor(
        host: MemoryHost,
        vssCacheDir: string,
        private readonly stateStore: VSSIndexStateStore = createDefaultVSSIndexStateStore(host),
    ) {
        this.host = host;
        this.vssCacheDir = vssCacheDir;
        this.aiUtils = new AIUtils(host);
    }

    async initialize() {
        if (this.disposed) return;
        if (this.initialized) {
            await this.retryLocalStateStore();
            return;
        }
        this.initializationPromise ??= this.initializeUnlocked().finally(() => {
            this.initializationPromise = null;
        });
        return this.initializationPromise;
    }

    private async initializeUnlocked(): Promise<void> {
        if (this.disposed) return;
        this.deviceId = getVSSDeviceId();
        this.profile = this.createEmbeddingProfile();
        if (await this.ensureLocalStateStoreReady()) {
            await this.hydrateLocalStateFromStore();
        }
        this.storageStatus = await this.getStoragePersistenceStatus();
        if (this.disposed) return;

        if (!this.marker) {
            this.status = "uninitialized";
            this.initialized = true;
            return;
        }
        if (this.status === "stale") {
            this.initialized = true;
            return;
        }

        await this.ensureIndex({ allowFallback: false, mode: "foreground" });
        if (this.disposed) return;
        this.initialized = true;
    }

    private async ensureLocalStateStoreReady(): Promise<boolean> {
        if (this.localStateReady) return true;
        try {
            await this.stateStore.initialize();
            this.localStateReady = true;
            if (this.lastErrorCode === VSS_LOCAL_STATE_UNAVAILABLE_CODE) {
                this.lastErrorCode = undefined;
            }
        } catch (error) {
            this.localStateReady = false;
            this.lastErrorCode = VSS_LOCAL_STATE_UNAVAILABLE_CODE;
            this.host.log("Memory local state store unavailable", error);
            return false;
        }
        return true;
    }

    private async retryLocalStateStore(): Promise<void> {
        if (this.disposed) return;
        if (!this.localStateReady) {
            if (!await this.ensureLocalStateStoreReady()) return;
        }
        if (this.localStateClearPending) {
            await this.clearLocalStateStore(this.stateGeneration);
        }
        if (!this.localStateHydrated && !this.hasPendingLocalStateWrites()) {
            await this.hydrateLocalStateFromStore();
        }
        if (!this.marker) {
            this.status = "uninitialized";
        }
        await this.flushPendingLocalStateWrites();
        if (this.marker && !this.index && this.status === "uninitialized") {
            await this.ensureIndex({ allowFallback: false, mode: "foreground" });
        }
    }

    private hasPendingLocalStateWrites(): boolean {
        return this.localStateClearPending || this.dirtyJournalWritePending || this.markerWritePending;
    }

    private async hydrateLocalStateFromStore(): Promise<void> {
        if (this.disposed || !this.localStateReady || this.localStateHydrated) return;
        await this.loadDirtyJournal();
        if (this.disposed) return;
        const marker = await this.readLocalMarker();
        if (!this.marker) {
            this.marker = marker;
        }
        if (this.marker) {
            this.markerRecoverySuppressed = false;
        }
        this.localStateHydrated = true;
    }

    private async flushPendingLocalStateWrites(): Promise<void> {
        if (this.disposed || !this.localStateReady) return;
        if (this.localStateClearPending) {
            await this.clearLocalStateStore(this.stateGeneration);
        }
        if (this.dirtyJournalWritePending) {
            await this.persistDirtyJournal();
        }
        if (this.markerWritePending && this.marker) {
            await this.persistMarkerSnapshot(this.marker, this.stateGeneration);
        }
    }

    dispose(): Promise<void> {
        return this.disposeAfter(Promise.resolve());
    }

    /** Register the storage shutdown barrier immediately, then drain a bounded caller-owned task. */
    disposeAfter(pendingTask: Promise<unknown>): Promise<void> {
        if (this.disposePromise) return this.disposePromise;
        const pendingInitialization = this.initializationPromise;
        const pendingEnsureIndex = this.ensureIndexPromise;
        const pendingRecovery = this.sqliteRecoveryPromise;
        // Enter shutdown synchronously so no search or write can race the drain window.
        this.disposed = true;
        this.initialized = false;
        this.pageletQueryEmbeddingCache.clear();
        this.pageletQueryEmbeddingInFlight.clear();
        this.disposePromise = (async () => {
            await withTimeout(pendingTask, VSS_SHUTDOWN_DRAIN_TIMEOUT_MS).catch((error) => {
                this.host.log("Failed to drain Memory maintenance before shutdown", error);
            });
            this.initializationPromise = null;
            this.ensureIndexPromise = null;
            this.sqliteRecoveryPromise = null;
            await this.disposeUnlocked([
                pendingInitialization,
                pendingEnsureIndex,
                pendingRecovery,
            ]);
        })();
        this.registerShutdownBarrier(this.disposePromise);
        return this.disposePromise;
    }

    private async disposeUnlocked(pendingOperations: Array<Promise<unknown> | null>): Promise<void> {
        await Promise.allSettled(pendingOperations.filter((operation): operation is Promise<unknown> => Boolean(operation)));
        const index = this.index;
        this.index = null;
        this.status = "uninitialized";
        if (index) {
            await withTimeout(index.dispose(), VSS_INDEX_DISPOSE_TIMEOUT_MS).catch((error) => {
                this.host.log("Failed to dispose VSS index", error);
            });
        }
        await this.stateWriteChain.catch(() => undefined);
        await this.stateStore.dispose().catch((error) => {
            this.host.log("Failed to dispose Memory local state store", error);
        });
    }

    private async readLocalMarker(): Promise<VSSIndexMarker | null> {
        const marker = await this.stateStore.getMarker();
        if (!marker) return null;
        if (marker.deviceId !== this.deviceId) return null;
        if (marker.schemaVersion !== VSS_SCHEMA_VERSION) {
            this.status = "stale";
        }
        const opfsScope = this.getVaultStorageScope().safeName;
        if (marker.opfsScope && marker.opfsScope !== opfsScope) return null;
        const profile = this.profile ?? this.createEmbeddingProfile();
        if (marker.profileSignature !== getEmbeddingProfileSignature(profile)) {
            this.status = "stale";
        }
        return marker;
    }

    private async tryRecoverMarkerFromSqlite(mode: VSSIndexOpenMode): Promise<void> {
        if (!this.profile || this.disposed) {
            this.status = "uninitialized";
            return;
        }
        let sqliteIndex: SqliteVectorIndex | null = null;
        try {
            const opened = await this.openSqliteIndex(this.profile, mode);
            sqliteIndex = opened.index;
            this.assertActive();
            if (opened.status === "stale") {
                this.index = sqliteIndex;
                sqliteIndex = null;
                this.status = "stale";
                return;
            }
            const stats = await sqliteIndex.getStats();
            this.assertActive();
            if (stats.status === "ready" && stats.chunkCount > 0) {
                this.index = sqliteIndex;
                sqliteIndex = null;
                this.status = "ready";
                await this.writeLocalIndexState();
                return;
            }
            await this.disposeIndex(sqliteIndex);
            sqliteIndex = null;
            this.status = "uninitialized";
        } catch (error) {
            if (sqliteIndex) {
                await this.disposeIndex(sqliteIndex);
            }
            if (this.disposed || getErrorCode(error) === "vss-disposed") {
                return;
            }
            this.recordIndexError(error);
            this.status = "disabled";
            this.host.log("Could not recover Memory state from local index", error);
        }
    }

    async markDirtyIfEligible(file: TAbstractFile): Promise<boolean> {
        if (this.disposed) return false;
        if (!(file instanceof TFile)) return false;
        if (!this.isEligible(file)) return false;
        const changed = this.markDirtyPath(file.path);
        if (changed) {
            await this.persistDirtyJournal();
        }
        return changed;
    }

    async observeChangedFile(
        file: TAbstractFile | null,
        reason = "vault-event",
        verifyReason: VerifyReason = "metadata-drift",
        options: VSSChangeObservationOptions = {},
    ): Promise<VSSChangeObservation> {
        if (this.disposed) return { kind: "ignored", reason: "disposed" };
        if (!(file instanceof TFile)) return { kind: "ignored", reason: "not-file" };
        if (!this.isEligible(file)) {
            await this.initialize();
            if (this.index && this.status === "ready") {
                await this.runExclusive(async () => {
                    if (!this.index) return;
                    const existing = await this.index.getFileRecord(file.path);
                    if (!existing) return;
                    await this.deleteFileFromIndex(this.index, file.path);
                    this.dirty.delete(file.path);
                    this.verifyQueue.delete(file.path);
                    await this.writeLocalIndexState();
                });
            }
            return { kind: "ignored", path: file.path, reason: "ineligible-removed" };
        }
        await this.initialize();
        if (!this.index || !await this.isDurableReady()) {
            return { kind: "ignored", path: file.path, reason: "not-ready" };
        }

        const record = await this.index.getFileRecord(file.path);
        const verifyMatchingMetadata = options.verifyMatchingMetadata ?? reason === "vault-modify";
        if (!record) {
            const changed = this.markDirtyPath(file.path);
            if (changed) {
                await this.persistDirtyJournal();
            }
            return { kind: "confirmed-dirty", path: file.path, reason: "missing-index-record" };
        }

        if (record.mtime === file.stat.mtime && record.size === file.stat.size) {
            if (this.clearStaleDirtyForSyncedRecord(file.path, record)) {
                await this.persistDirtyJournal();
            }
            if (this.dirty.has(file.path)) {
                return { kind: "confirmed-dirty", path: file.path, reason: "already-dirty" };
            }
            if (verifyMatchingMetadata) {
                this.enqueueVerifyPath(file, record, verifyReason);
                return { kind: "verify-candidate", path: file.path, reason };
            }
            this.verifyQueue.delete(file.path);
            return { kind: "ignored", path: file.path, reason: "metadata-match" };
        }

        if (this.dirty.has(file.path)) {
            return { kind: "confirmed-dirty", path: file.path, reason: "already-dirty" };
        }

        this.enqueueVerifyPath(file, record, verifyReason);
        return { kind: "verify-candidate", path: file.path, reason };
    }

    async markDirtyIfIndexedMetadataChanged(file: TFile | null): Promise<boolean> {
        const observation = await this.observeChangedFile(file, "file-open", "file-open");
        return observation.kind !== "ignored";
    }

    async handleDelete(file: TFile): Promise<void> {
        if (this.disposed) return;
        await this.runExclusive(() => this.deleteIndexedPath(file.path));
        this.host.log("delete VSS entry", file.path);
    }

    async handleRename(file: TFile, oldPath: string): Promise<boolean> {
        if (this.disposed) return false;
        return this.runExclusive(async () => {
            if (oldPath && oldPath !== file.path) {
                await this.deleteIndexedPath(oldPath);
            }
            if (!this.isEligible(file)) return false;
            const changed = this.markDirtyPath(file.path);
            if (changed) {
                await this.persistDirtyJournal();
            }
            return changed;
        });
    }

    async handleActiveLeafChange() {
        if (this.disposed) return;
        await this.persistDirtyJournal();
    }

    async handleFileOpen(file: TFile | null): Promise<boolean> {
        if (this.disposed) return false;
        return this.markDirtyIfIndexedMetadataChanged(file);
    }

    hasDirtyChanges(): boolean {
        return this.dirty.size > 0;
    }

    hasPendingVerification(): boolean {
        return this.verifyQueue.size > 0;
    }

    getMaintenanceState(): { dirtyCount: number; verificationPending: number } {
        return {
            dirtyCount: this.dirty.size,
            verificationPending: this.verifyQueue.size,
        };
    }

    getMemoryStatusSnapshot(): VSSMemoryStatusSnapshot {
        const snapshot: VSSMemoryStatusSnapshot = {
            status: this.getCachedMemoryStatus(),
            dirtyCount: this.dirty.size,
            verificationPending: this.verifyQueue.size,
            lexicalProfileState: this.lexicalStatus?.state,
            lexicalFallbackReason: this.lexicalStatus?.reason,
            lexicalSearchAttempted: this.lastLexicalSearchStatus?.attempted,
            lexicalSearchState: this.lastLexicalSearchStatus?.state,
            lexicalSearchReason: this.lastLexicalSearchStatus?.reason,
            lexicalSearchDurationMs: this.lastLexicalSearchStatus?.durationMs,
            lexicalSearchMatchedRows: this.lastLexicalSearchStatus?.matchedRows,
        };
        if (this.localStateHydrated && this.marker) {
            snapshot.indexedDocumentCount = this.marker.fileCount;
        }
        if (this.lastErrorCode) {
            snapshot.lastErrorCode = this.lastErrorCode;
        }
        return snapshot;
    }

    private getCachedMemoryStatus(): VSSMemoryStatus {
        if (this.disposed) return "error";
        if (this.initializationPromise || this.status === "initializing") return "unknown";
        if (!this.localStateHydrated) {
            return this.initialized && this.lastErrorCode ? "error" : "unknown";
        }
        switch (this.status) {
            case "ready":
                return "ready";
            case "stale":
                return "stale";
            case "uninitialized":
            case "missing-local-index":
                return "unprepared";
            case "disabled":
            case "error":
                return "error";
        }
    }

    async canAutoMaintain(): Promise<boolean> {
        if (this.disposed) return false;
        await this.initialize();
        if (this.index) {
            await this.ensureIndex({ allowFallback: false, mode: "foreground" });
        }
        return await this.isDurableReady();
    }

    async flush(options: VSSFlushOptions = {}): Promise<VSSOperationSummary> {
        if (this.disposed) return { ...createEmptyOperationSummary(), aborted: true };
        return this.runExclusive(() => this.flushUnlocked(options));
    }

    private async flushUnlocked(options: VSSFlushOptions = {}): Promise<VSSOperationSummary> {
        this.assertActive();
        const summary = createEmptyOperationSummary();
        if (this.isFlushing) {
            summary.aborted = true;
            return summary;
        }
        await this.initialize();
        this.assertActive();
        await this.ensureIndex({ allowFallback: false, allowMissingIndexRecovery: options.force === true, mode: "manual" });
        if (!this.index || this.status === "disabled" || this.status === "missing-local-index" || this.status === "stale") {
            if (!options.silent) {
                new Notice(vssT("plugin.memory.notice.notReadyPrepareFirst"), 5000);
            }
            summary.aborted = true;
            return summary;
        }
        if (options.reason === "auto-refresh" && !await this.isDurableReady()) {
            summary.aborted = true;
            return summary;
        }

        this.isFlushing = true;
        try {
            const now = Date.now();
            if (now - this.processedWindow.windowStart > 60 * 1000) {
                this.processedWindow = { count: 0, windowStart: now };
            }

            let dirtyChanged = false;
            let indexStateChanged = false;
            const quiet = options.force ? 0 : VSS_PARAMS.quietWindow;
            const limit = options.limit ?? VSS_PARAMS.maxPerMinute;
            const currentPaths = options.force
                ? new Set(this.host.getVSSFiles().map(file => file.path))
                : null;
            const candidates = currentPaths
                ? Array.from(currentPaths)
                : selectFlushCandidates(this.dirty, now, quiet, VSS_PARAMS.maxDelay, limit);
            const getEmbeddingsModel = this.createEmbeddingsModelProvider(this.getEmbeddingBatchPolicy().createOptions);
            const filesTotal = candidates.length;
            let filesDone = 0;
            let filesUpdated = 0;
            const emitProgress = (phase: VSSProgressPhase, overrides: Partial<VSSProgressEvent> = {}) => {
                options.onProgress?.({
                    phase,
                    filesTotal,
                    filesDone,
                    filesUpdated,
                    failed: summary.failed,
                    ...overrides,
                });
            };

            emitProgress("scanning");
            if (currentPaths && this.index) {
                const indexedPaths = await this.index.listFilePaths();
                for (const indexedPath of indexedPaths) {
                    if (!currentPaths.has(indexedPath)) {
                        await this.deleteFileFromIndex(this.index, indexedPath);
                        this.dirty.delete(indexedPath);
                        this.verifyQueue.delete(indexedPath);
                        dirtyChanged = true;
                        indexStateChanged = true;
                        summary.removed++;
                    }
                }
            }

            for (const path of candidates) {
                this.assertActive();
                if (!options.force && this.processedWindow.count >= VSS_PARAMS.maxPerMinute) break;

                const dirtyStamp = this.getDirtyStamp(path);
                const file = this.host.app.vault.getAbstractFileByPath(path);
                emitProgress("scanning", { currentFile: file instanceof TFile ? getProgressFileName(file) : getProgressPathName(path) });
                if (!file || !(file instanceof TFile)) {
                    if (this.clearDirtyIfStampMatches(path, dirtyStamp)) {
                        dirtyChanged = true;
                    }
                    this.verifyQueue.delete(path);
                    if (this.index) await this.deleteFileFromIndex(this.index, path);
                    indexStateChanged = true;
                    summary.removed++;
                    filesDone++;
                    emitProgress("writing", { currentFile: getProgressPathName(path) });
                    continue;
                }

                let status: VSSRefreshStatus;
                try {
                    status = await this.refreshFileCacheUnlocked(file, getEmbeddingsModel);
                } catch (e) {
                    summary.failed++;
                    this.host.log("Failed to refresh VSS index", { path, error: e });
                    filesDone++;
                    emitProgress("writing", { currentFile: getProgressFileName(file) });
                    continue;
                }

                if (status === 'unchanged') summary.unchanged++;
                if (status === 'metadata-synced') summary.metadataSynced++;
                if (status === 'removed') {
                    summary.removed++;
                    indexStateChanged = true;
                }
                if (status === 'skipped') {
                    summary.skipped++;
                    indexStateChanged = true;
                }
                if (status === 'updated') {
                    summary.updated++;
                    filesUpdated++;
                    this.processedWindow.count++;
                    indexStateChanged = true;
                }
                filesDone++;
                emitProgress("writing", { currentFile: getProgressFileName(file) });

                if (this.clearDirtyIfStampMatches(path, dirtyStamp)) {
                    dirtyChanged = true;
                }
            }
            if (dirtyChanged) {
                await this.persistDirtyJournal();
            }
            if (indexStateChanged) {
                await this.writeLocalIndexState();
            }
            emitProgress("ready", { filesDone });
        } finally {
            this.isFlushing = false;
        }
        return summary;
    }

    async rebuildLocalIndex(options: VSSOperationOptions = {}): Promise<VSSOperationSummary> {
        if (this.disposed) return { ...createEmptyOperationSummary(), aborted: true };
        return this.runExclusive(() => this.rebuildLocalIndexUnlocked(options));
    }

    private async rebuildLocalIndexUnlocked(options: VSSOperationOptions = {}): Promise<VSSOperationSummary> {
        this.assertActive();
        await this.initialize();
        this.assertActive();
        this.storageStatus = await this.requestPersistentStorage();
        if (!this.storageStatus.persisted && !options.silent) {
            new Notice(vssT("plugin.memory.notice.prepareAgainLater"), 7000);
        }
        await this.ensureIndex({ allowFallback: false, mode: "manual" });
        if (!this.index || this.status === "disabled") {
            throw new Error("Memory is unavailable.");
        }

        const index = this.index;
        await index.reset();
        this.status = "initializing";
        this.dirty.clear();
        this.verifyQueue.clear();
        this.nextEmbeddingRequestAt = 0;
        const files = this.host.getVSSFiles();
        const summary = createEmptyOperationSummary();
        summary.storagePersisted = this.storageStatus.persisted;
        const embeddingPolicy = this.getEmbeddingBatchPolicy();
        const getEmbeddingsModel = this.createEmbeddingsModelProvider(embeddingPolicy.createOptions);
        const pendingFiles = new Map<string, RebuildFileState>();
        let currentBatch: RebuildChunkWorkItem[] = [];
        let filesScanned = 0;
        let filesFinalized = 0;
        let filesUpdated = 0;
        let chunksTotal = 0;
        let chunksEmbedded = 0;

        const emitProgress = (phase: VSSProgressPhase, overrides: Partial<VSSProgressEvent> = {}) => {
            options.onProgress?.({
                phase,
                filesTotal: files.length,
                filesDone: phase === "scanning" ? filesScanned : filesFinalized,
                filesUpdated,
                chunksTotal,
                chunksEmbedded,
                failed: summary.failed,
                ...overrides,
            });
        };

        const finalizeReadyFiles = async (states: Iterable<RebuildFileState>) => {
            const readyStates = Array.from(new Set(states))
                .filter(state => state.remaining === 0 && pendingFiles.has(state.path));

            for (const state of readyStates) {
                pendingFiles.delete(state.path);
                emitProgress("writing", { currentFile: getProgressFileName(state.file) });
                if (state.failed) {
                    summary.failed++;
                    filesFinalized++;
                    this.host.log("Skipped rebuilding VSS file after embedding failure", { path: state.file.path });
                    emitProgress("writing", { currentFile: getProgressFileName(state.file) });
                    continue;
                }
                if (state.skipped) {
                    summary.skipped++;
                    filesFinalized++;
                    this.host.log("Skipped rebuilding Memory file because it changed before embedding", { path: state.file.path });
                    emitProgress("writing", { currentFile: getProgressFileName(state.file) });
                    continue;
                }

                try {
                    if (!this.isFileSnapshotCurrent(state.file, state) || !this.isEligible(state.file)) {
                        if (this.markDirtyPath(state.file.path)) {
                            this.host.log("Skipped rebuilding Memory file because it changed before index write", { path: state.path, currentPath: state.file.path });
                        }
                        summary.skipped++;
                        filesFinalized++;
                        emitProgress("writing", { currentFile: getProgressFileName(state.file) });
                        continue;
                    }

                    await index.upsertFile({
                        path: state.path,
                        contentHash: state.contentHash,
                        mtime: state.mtime,
                        size: state.size,
                        lexicalEligible: true,
                        lexicalMaintenanceEnabled: this.isLexicalProfileEnabled(),
                        lexicalBoundaryFingerprint: this.getLexicalBoundaryFingerprint(),
                    }, state.chunks, state.embeddings);
                    if (this.markDirtyIfSnapshotChanged(state.file, state)) {
                        this.host.log("Marked Memory file dirty after rebuild because it changed during index write", { path: state.path, currentPath: state.file.path });
                    }
                    summary.updated++;
                    filesUpdated++;
                } catch (error) {
                    summary.failed++;
                    this.host.log("Failed to write rebuilt VSS file", { path: state.file.path, error });
                }
                filesFinalized++;
                emitProgress("writing", { currentFile: getProgressFileName(state.file) });
            }
        };

        const processBatch = async () => {
            this.assertActive();
            if (currentBatch.length === 0) return;
            const batch = currentBatch;
            currentBatch = [];
            const currentFile = getProgressFileName(batch[0].state.file);
            emitProgress("embedding", { currentFile });
            const skippedStates = new Set<RebuildFileState>();
            const activeBatch = batch.filter((item) => {
                if (this.isFileSnapshotCurrent(item.state.file, item.state)) return true;
                skippedStates.add(item.state);
                return false;
            });
            for (const state of skippedStates) {
                if (!pendingFiles.has(state.path)) continue;
                if (this.markDirtyPath(state.file.path)) {
                    this.host.log("Skipped rebuilding Memory file because it changed before embedding", { path: state.path, currentPath: state.file.path });
                }
                state.skipped = true;
                state.remaining = 0;
            }
            if (activeBatch.length === 0) {
                await finalizeReadyFiles(skippedStates);
                emitProgress("embedding", { currentFile });
                return;
            }
            try {
                const embeddings = await this.embedDocumentsWithRetry(
                    activeBatch.map(item => item.text),
                    getEmbeddingsModel,
                    embeddingPolicy,
                    (retryDelayMs) => emitProgress("retrying", { currentFile, retryDelayMs }),
                );
                if (embeddings.length !== activeBatch.length) {
                    throw new Error(`Embedding count ${embeddings.length} does not match batch size ${activeBatch.length}.`);
                }
                for (let index = 0; index < activeBatch.length; index++) {
                    const item = activeBatch[index];
                    item.state.embeddings[item.chunkIndex] = embeddings[index];
                    item.state.remaining--;
                }
                chunksEmbedded += embeddings.length;
            } catch (error) {
                const affectedStates = Array.from(new Set(activeBatch.map(item => item.state)));
                const affectedFiles = affectedStates.map(state => state.file.path);
                this.host.log("Failed to embed rebuilt VSS batch", { paths: affectedFiles, error });
                for (const state of affectedStates) {
                    state.failed = true;
                    state.remaining = 0;
                }
            }
            await finalizeReadyFiles([
                ...activeBatch.map(item => item.state),
                ...skippedStates,
            ]);
            emitProgress("embedding", { currentFile });
        };

        emitProgress("scanning");
        for (const file of files) {
            this.assertActive();
            filesScanned++;
            emitProgress("scanning", { currentFile: getProgressFileName(file) });
            try {
                const snapshot = await this.readFileContentSnapshot(file);

                if (snapshot.changedDuringCapture) {
                    if (this.markDirtyPath(file.path)) {
                        this.host.log("Skipped rebuilding Memory file because it changed while being read", { path: file.path });
                    }
                    summary.skipped++;
                    filesFinalized++;
                    emitProgress("scanning", { currentFile: getProgressFileName(file) });
                    continue;
                }

                if (snapshot.tooLarge) {
                    if (!await this.deleteSnapshotFileFromIndex(file, snapshot, "rebuild-large-file")) {
                        summary.skipped++;
                        filesFinalized++;
                        emitProgress("scanning", { currentFile: getProgressFileName(file) });
                        continue;
                    }
                    summary.skipped++;
                    filesFinalized++;
                    this.host.log(`Skipped VSS index for large file ${file.path}`);
                    emitProgress("scanning", { currentFile: getProgressFileName(file) });
                    continue;
                }

                if (!snapshot.contentHash) {
                    if (!await this.deleteSnapshotFileFromIndex(file, snapshot, "rebuild-empty-file")) {
                        summary.skipped++;
                        filesFinalized++;
                        emitProgress("scanning", { currentFile: getProgressFileName(file) });
                        continue;
                    }
                    summary.removed++;
                    filesFinalized++;
                    emitProgress("scanning", { currentFile: getProgressFileName(file) });
                    continue;
                }

                const chunks = await this.prepareFileChunks(file, snapshot.contentHash, snapshot.cleanedContent, snapshot);
                if (chunks.length === 0) {
                    if (!await this.deleteSnapshotFileFromIndex(file, snapshot, "rebuild-empty-chunks")) {
                        summary.skipped++;
                        filesFinalized++;
                        emitProgress("scanning", { currentFile: getProgressFileName(file) });
                        continue;
                    }
                    summary.removed++;
                    filesFinalized++;
                    emitProgress("scanning", { currentFile: getProgressFileName(file) });
                    continue;
                }

                const state: RebuildFileState = {
                    file,
                    path: snapshot.path,
                    capturedAt: snapshot.capturedAt,
                    contentHash: snapshot.contentHash,
                    ctime: snapshot.ctime,
                    mtime: snapshot.mtime,
                    size: snapshot.size,
                    chunks,
                    embeddings: new Array(chunks.length) as number[][],
                    remaining: chunks.length,
                    failed: false,
                };
                pendingFiles.set(snapshot.path, state);
                chunksTotal += chunks.length;
                for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
                    if (state.failed || state.skipped || !pendingFiles.has(state.path)) break;
                    currentBatch.push({ state, chunkIndex, text: chunks[chunkIndex].content });
                    if (currentBatch.length >= embeddingPolicy.maxBatchItems) {
                        await processBatch();
                        if (state.failed || state.skipped || !pendingFiles.has(state.path)) break;
                    }
                }
            } catch (error) {
                summary.failed++;
                filesFinalized++;
                this.host.log("Failed to scan rebuilt VSS file", { path: file.path, error });
                emitProgress("scanning", { currentFile: getProgressFileName(file) });
            }
        }

        await processBatch();
        emitProgress("writing");
        await this.persistDirtyJournal();
        await this.writeLocalIndexState();
        emitProgress("ready", { filesDone: filesFinalized });
        if (!options.silent) {
            new Notice(summary.failed > 0 ? vssT("plugin.memory.notice.readyPartial") : vssT("plugin.memory.notice.readyNotesUnchanged"), 5000);
        }
        return summary;
    }

    async refreshLocalIndex(options: VSSOperationOptions = {}): Promise<VSSOperationSummary> {
        const summary = await this.flush({
            force: true,
            reason: "manual-refresh",
            limit: Number.MAX_SAFE_INTEGER,
            silent: options.silent,
            onProgress: options.onProgress,
        });
        if (!summary.aborted && !options.silent) {
            new Notice(summary.failed > 0 ? vssT("plugin.memory.notice.updatedPartial") : vssT("plugin.memory.notice.readyNotesUnchanged"), 3000);
        }
        return summary;
    }

    async resetLocalIndex(): Promise<void> {
        if (this.disposed) return;
        await this.runExclusive(() => this.resetLocalIndexUnlocked());
    }

    private async resetLocalIndexUnlocked(): Promise<void> {
        this.assertActive();
        await this.initialize();
        if (this.index) {
            const index = this.index;
            await index.reset();
            await this.disposeIndex(index, "Failed to dispose reset VSS index");
            this.index = null;
        }
        await this.stateWriteChain.catch(() => undefined);
        this.stateGeneration++;
        this.localStateClearPending = true;
        this.markerWritePending = false;
        this.dirtyJournalWritePending = false;
        this.markerRecoverySuppressed = true;
        this.marker = null;
        this.status = "uninitialized";
        this.dirty.clear();
        this.verifyQueue.clear();
        await this.clearLocalStateStore(this.stateGeneration);
        new Notice(vssT("plugin.memory.notice.localCopyReset"), 3000);
    }

    async reconcileLocalFiles(options: VSSReconcileOptions = {}): Promise<VSSReconcileSummary> {
        if (this.disposed) return {
            ...createEmptyOperationSummary(),
            scanned: 0,
            markedDirty: 0,
            verified: 0,
            hasMore: false,
            aborted: true,
        };
        return this.runExclusive(() => this.reconcileLocalFilesUnlocked(options));
    }

    private async reconcileLocalFilesUnlocked(options: VSSReconcileOptions = {}): Promise<VSSReconcileSummary> {
        this.assertActive();
        const summary: VSSReconcileSummary = {
            ...createEmptyOperationSummary(),
            scanned: 0,
            markedDirty: 0,
            verified: 0,
            hasMore: false,
        };
        await this.initialize();
        this.assertActive();
        await this.ensureIndex({ allowFallback: false, mode: "manual" });
        if (!this.index || !await this.isDurableReady()) {
            summary.aborted = true;
            return summary;
        }
        const index = this.index;

        const batchSize = Math.max(1, options.batchSize ?? VSS_RECONCILE_BATCH_SIZE);
        const maxMetadataItems = Math.max(1, options.maxMetadataItems ?? VSS_RECONCILE_MAX_METADATA_PER_RUN);
        const verifyHashLimit = Math.max(0, options.verifyHashLimit ?? (options.reason === "periodic" ? VSS_ROLLING_HASH_VERIFY_LIMIT : 0));
        const files = this.host.getVSSFiles();
        const fileByPath = new Map(files.map((file) => [file.path, file]));
        const records = await index.listFileRecords();
        const recordByPath = new Map(records.map((record) => [record.path, record]));
        let dirtyChanged = false;
        let indexChanged = false;

        const maybeYield = async () => {
            if (summary.scanned > 0 && summary.scanned % batchSize === 0) {
                await sleep(0);
            }
        };

        const hasBudget = () => summary.scanned < maxMetadataItems;
        const processIndexedRecords = async (): Promise<boolean> => {
            if (records.length === 0) {
                this.recordReconcileCursor = 0;
                return true;
            }
            if (this.recordReconcileCursor >= records.length) {
                this.recordReconcileCursor = 0;
            }
            while (hasBudget() && this.recordReconcileCursor < records.length) {
                this.assertActive();
                const record = records[this.recordReconcileCursor];
                this.recordReconcileCursor++;
                summary.scanned++;
                if (!fileByPath.has(record.path)) {
                    await this.deleteFileFromIndex(index, record.path);
                    this.verifyQueue.delete(record.path);
                    if (this.dirty.delete(record.path)) {
                        dirtyChanged = true;
                    }
                    indexChanged = true;
                    summary.removed++;
                }
                await maybeYield();
            }
            if (this.recordReconcileCursor >= records.length) {
                this.recordReconcileCursor = 0;
                return true;
            }
            return false;
        };

        const processVaultFiles = async (): Promise<boolean> => {
            if (files.length === 0) {
                this.reconcileCursor = 0;
                return true;
            }
            if (this.reconcileCursor >= files.length) {
                this.reconcileCursor = 0;
            }
            while (hasBudget() && this.reconcileCursor < files.length) {
                this.assertActive();
                const file = files[this.reconcileCursor];
                this.reconcileCursor++;
                summary.scanned++;
                const record = recordByPath.get(file.path);
                if (!record) {
                    try {
                        const snapshot = await this.readFileContentSnapshot(file);
                        if (snapshot.changedDuringCapture || !this.isFileSnapshotCurrent(file, snapshot)) {
                            if (this.markDirtyPath(file.path)) {
                                dirtyChanged = true;
                                summary.markedDirty++;
                            }
                        } else if (snapshot.tooLarge || !snapshot.contentHash) {
                            this.clearVerifyRecordIfNotNewerThanSnapshot(file.path, snapshot);
                            if (this.dirty.delete(file.path)) {
                                dirtyChanged = true;
                            }
                            if (snapshot.tooLarge) {
                                summary.skipped++;
                            } else {
                                summary.removed++;
                            }
                        } else if (this.markDirtyPath(file.path)) {
                            dirtyChanged = true;
                            summary.markedDirty++;
                        }
                    } catch (error) {
                        this.host.log("Failed to inspect missing Memory index record", { path: file.path, error });
                        if (this.markDirtyPath(file.path)) {
                            dirtyChanged = true;
                            summary.markedDirty++;
                        }
                    }
                } else if (record.mtime !== file.stat.mtime || record.size !== file.stat.size) {
                    if (this.enqueueVerifyPath(file, record, "metadata-drift")) {
                        summary.verificationQueued++;
                    }
                } else {
                    if (this.clearStaleDirtyForSyncedRecord(file.path, record)) {
                        dirtyChanged = true;
                    }
                    summary.unchanged++;
                }
                await maybeYield();
            }
            if (this.reconcileCursor >= files.length) {
                this.reconcileCursor = 0;
                return true;
            }
            return false;
        };

        if (this.reconcilePhase === "records") {
            const recordsComplete = await processIndexedRecords();
            if (!recordsComplete) {
                summary.hasMore = true;
            } else {
                this.reconcilePhase = "files";
                const filesComplete = await processVaultFiles();
                if (!filesComplete) {
                    summary.hasMore = true;
                } else {
                    this.reconcilePhase = "records";
                }
            }
        } else {
            const filesComplete = await processVaultFiles();
            if (!filesComplete) {
                summary.hasMore = true;
            } else {
                this.reconcilePhase = "records";
            }
        }

        if (!summary.hasMore && verifyHashLimit > 0 && summary.scanned < maxMetadataItems && files.length > 0) {
            const filesToVerify = rotateByCursor(files, this.hashVerifyCursor);
            for (let index = 0; index < filesToVerify.length && summary.verified < verifyHashLimit && summary.scanned < maxMetadataItems; index++) {
                this.assertActive();
                const file = filesToVerify[index];
                this.hashVerifyCursor = (this.hashVerifyCursor + 1) % files.length;
                const record = recordByPath.get(file.path);
                if (!record || record.mtime !== file.stat.mtime || record.size !== file.stat.size || this.dirty.has(file.path)) {
                    continue;
                }
                summary.scanned++;
                summary.verified++;
                if (this.enqueueVerifyPath(file, record, "rolling-check")) {
                    summary.verificationQueued++;
                }
                await maybeYield();
            }
        }

        if (dirtyChanged) {
            await this.persistDirtyJournal();
        }
        if (indexChanged) {
            await this.writeLocalIndexState();
        }
        return summary;
    }

    async verifyPendingChanges(options: VSSVerifyOptions = {}): Promise<VSSVerifySummary> {
        const summary: VSSVerifySummary = {
            ...createEmptyOperationSummary(),
            markedDirty: 0,
            hasMore: false,
            bytesReadEstimate: 0,
        };
        if (this.disposed) {
            summary.aborted = true;
            return summary;
        }

        await this.initialize();
        this.assertActive();
        await this.ensureIndex({ allowFallback: false, mode: "manual" });
        if (!this.index || !await this.isDurableReady()) {
            summary.aborted = true;
            return summary;
        }

        const budget = this.getVerifyBudget(options);
        const startedAt = performance.now();
        const candidates = Array.from(this.verifyQueue.values());

        for (const candidate of candidates) {
            this.assertActive();
            if (summary.verificationChecked >= budget.maxFiles) {
                summary.hasMore = true;
                break;
            }
            if (
                summary.verificationChecked > 0
                && performance.now() - startedAt >= budget.maxWallClockMs
            ) {
                summary.hasMore = true;
                break;
            }

            const file = this.host.app.vault.getAbstractFileByPath(candidate.path);
            if (!file || !(file instanceof TFile) || !this.isEligible(file)) {
                summary.verificationChecked++;
                await this.runExclusive(async () => {
                    if (!this.isCurrentVerifyRecord(candidate)) return;
                    this.verifyQueue.delete(candidate.path);
                    if (this.index) {
                        await this.deleteFileFromIndex(this.index, candidate.path);
                        await this.writeLocalIndexState();
                    }
                });
                summary.removed++;
                continue;
            }

            const estimatedBytes = Math.min(file.stat.size, VSS_PARAMS.largeFileThreshold);
            if (
                summary.verificationChecked > 0
                && summary.bytesReadEstimate + estimatedBytes > budget.maxBytes
            ) {
                summary.hasMore = true;
                break;
            }
            summary.bytesReadEstimate += estimatedBytes;

            const dirtyStamp = this.getDirtyStamp(candidate.path);
            let snapshot: VSSFileContentSnapshot;
            summary.verificationChecked++;
            try {
                snapshot = await this.readFileContentSnapshot(file);
            } catch (error) {
                summary.failed++;
                this.host.log("Could not verify Memory file hash", { path: candidate.path, error });
                continue;
            }

            if (snapshot.changedDuringCapture) {
                await this.runExclusive(async () => {
                    if (!this.isCurrentVerifyRecord(candidate)) return;
                    if (this.markDirtyPath(candidate.path)) {
                        summary.dirtyConfirmed++;
                        summary.markedDirty++;
                        await this.persistDirtyJournal();
                    }
                });
                continue;
            }

            if (snapshot.tooLarge || !snapshot.contentHash) {
                let deleted = false;
                await this.runExclusive(async () => {
                    if (!this.isCurrentVerifyRecord(candidate)) return;
                    if (!this.isFileSnapshotCurrent(file, snapshot)) {
                        if (this.markDirtyPath(candidate.path)) {
                            summary.dirtyConfirmed++;
                            summary.markedDirty++;
                            await this.persistDirtyJournal();
                        }
                        return;
                    }
                    this.verifyQueue.delete(candidate.path);
                    if (this.index) {
                        await this.deleteFileFromIndex(this.index, candidate.path);
                        await this.writeLocalIndexState();
                        deleted = true;
                    }
                    if (this.clearDirtyIfStampMatches(candidate.path, dirtyStamp)) {
                        await this.persistDirtyJournal();
                    }
                });
                if (deleted) {
                    if (snapshot.tooLarge) {
                        summary.skipped++;
                    } else {
                        summary.removed++;
                    }
                }
                continue;
            }

            if (snapshot.contentHash !== candidate.contentHash) {
                await this.runExclusive(async () => {
                    if (!this.isCurrentVerifyRecord(candidate)) return;
                    if (this.markDirtyPath(candidate.path)) {
                        summary.dirtyConfirmed++;
                        summary.markedDirty++;
                        await this.persistDirtyJournal();
                    }
                });
                continue;
            }

            const verifiedHash = snapshot.contentHash;
            await this.runExclusive(async () => {
                if (!this.isCurrentVerifyRecord(candidate)) return;
                if (!this.index) return;
                if (!this.isVerifyCandidateMetadataCurrent(file, candidate)) {
                    if (this.markDirtyPath(candidate.path)) {
                        summary.dirtyConfirmed++;
                        summary.markedDirty++;
                        await this.persistDirtyJournal();
                    }
                    return;
                }
                await this.index.updateFileMetadata({
                    path: file.path,
                    contentHash: verifiedHash,
                    mtime: candidate.observedMtime,
                    size: candidate.observedSize,
                });
                if (!this.isCurrentVerifyRecord(candidate)) return;
                this.verifyQueue.delete(candidate.path);
                if (this.clearDirtyIfStampMatches(candidate.path, dirtyStamp)) {
                    await this.persistDirtyJournal();
                }
                summary.metadataSynced++;
            });

            await sleep(0);
        }

        summary.hasMore = summary.hasMore || this.verifyQueue.size > 0;
        return summary;
    }

    private getVerifyBudget(options: VSSVerifyOptions): Required<Pick<VSSVerifyOptions, "maxFiles" | "maxBytes" | "maxWallClockMs">> {
        if (options.maxFiles !== undefined && options.maxBytes !== undefined && options.maxWallClockMs !== undefined) {
            return {
                maxFiles: Math.max(1, options.maxFiles),
                maxBytes: Math.max(1, options.maxBytes),
                maxWallClockMs: Math.max(1, options.maxWallClockMs),
            };
        }
        if (options.fastPath) {
            if (Platform.isMobile) {
                return {
                    maxFiles: VSS_MOBILE_CHAT_VERIFY_MAX_FILES,
                    maxBytes: VSS_MOBILE_CHAT_VERIFY_MAX_BYTES,
                    maxWallClockMs: VSS_MOBILE_CHAT_VERIFY_MAX_WALL_CLOCK_MS,
                };
            }
            return {
                maxFiles: VSS_DESKTOP_CHAT_VERIFY_MAX_FILES,
                maxBytes: VSS_DESKTOP_CHAT_VERIFY_MAX_BYTES,
                maxWallClockMs: VSS_DESKTOP_CHAT_VERIFY_MAX_WALL_CLOCK_MS,
            };
        }
        if (Platform.isMobile) {
            return {
                maxFiles: VSS_MOBILE_VERIFY_MAX_FILES,
                maxBytes: VSS_MOBILE_VERIFY_MAX_BYTES,
                maxWallClockMs: VSS_MOBILE_VERIFY_MAX_WALL_CLOCK_MS,
            };
        }
        return {
            maxFiles: VSS_DESKTOP_VERIFY_MAX_FILES,
            maxBytes: VSS_DESKTOP_VERIFY_MAX_BYTES,
            maxWallClockMs: VSS_DESKTOP_VERIFY_MAX_WALL_CLOCK_MS,
        };
    }

    private isCurrentVerifyRecord(record: VerifyRecord): boolean {
        const current = this.verifyQueue.get(record.path);
        return Boolean(current
            && current.last === record.last
            && current.contentHash === record.contentHash
            && current.observedMtime === record.observedMtime
            && current.observedSize === record.observedSize);
    }

    async cleanLegacyJsonCache(): Promise<void> {
        if (this.disposed) return;
        await this.initialize();
        if (!this.index || this.status !== "ready") {
            new Notice(vssT("plugin.memory.legacy.cleanup.onlyReady"), 5000);
            return;
        }
        const stats = await this.index.getStats();
        if (stats.status !== "ready" || stats.chunkCount <= 0 || stats.lastErrorCode) {
            new Notice(vssT("plugin.memory.legacy.cleanup.notSafelyReady"), 5000);
            return;
        }
        const marker = this.marker;
        const profileSignature = this.profile ? getEmbeddingProfileSignature(this.profile) : "";
        if (!marker || marker.profileSignature !== profileSignature) {
            new Notice(vssT("plugin.memory.legacy.cleanup.stateNotSafe"), 5000);
            return;
        }
        const summary = await this.getLegacyJsonCacheSummary();
        if (summary.fileCount === 0) {
            new Notice(vssT("plugin.memory.legacy.cleanup.noneFound"), 3000);
            return;
        }

        const cleanupGeneration = this.stateGeneration;
        const confirmed = await confirmUserAction(this.host.app, {
            title: vssT("plugin.memory.legacy.cleanup.title"),
            message: vssT("plugin.memory.legacy.cleanup.message", {
                count: summary.fileCount,
                bytes: formatBytes(summary.bytes),
            }),
            confirmText: vssT("plugin.chat.action.delete"),
        });
        if (!confirmed) return;
        if (this.disposed || cleanupGeneration !== this.stateGeneration || !this.index || this.status !== "ready") {
            new Notice(vssT("plugin.memory.legacy.cleanup.stateChanged"), 5000);
            return;
        }

        for (const path of summary.paths) {
            await this.host.app.vault.adapter.remove(path);
        }
        await this.writeLocalIndexState(cleanupGeneration);
        new Notice(vssT("plugin.memory.legacy.cleanup.deleted", { count: summary.fileCount }), 5000);
    }

    async cacheFileVectorStore(cacheFile: TFile): Promise<boolean> {
        if (this.disposed) return false;
        return (await this.refreshFileCache(cacheFile)) === "updated";
    }

    async refreshFileCache(file: TFile, getEmbeddingsModel?: EmbeddingsModelProvider): Promise<VSSRefreshStatus> {
        if (this.disposed) return "skipped";
        return this.runExclusive(() => this.refreshFileCacheUnlocked(file, getEmbeddingsModel));
    }

    private async refreshFileCacheUnlocked(file: TFile, getEmbeddingsModel?: EmbeddingsModelProvider): Promise<VSSRefreshStatus> {
        this.assertActive();
        await this.initialize();
        await this.ensureIndex({ allowFallback: false, mode: "manual" });
        if (!this.index || this.status === "disabled" || this.status === "missing-local-index" || this.status === "stale") {
            throw new Error("VSS index is unavailable.");
        }

        if (!this.isEligible(file)) {
            await this.deleteFileFromIndex(this.index, file.path);
            this.dirty.delete(file.path);
            this.verifyQueue.delete(file.path);
            await this.writeLocalIndexState();
            return "removed";
        }

        const snapshot = await this.readFileContentSnapshot(file);

        if (snapshot.changedDuringCapture) {
            await this.deferSnapshotRefresh(file, snapshot, "read");
            return 'skipped';
        }

        if (snapshot.tooLarge) {
            if (!await this.deleteSnapshotFileFromIndex(file, snapshot, "large-file")) {
                return 'skipped';
            }
            this.host.log(`Skipped VSS index for large file ${file.path}`);
            return 'skipped';
        }

        if (!snapshot.contentHash) {
            if (!await this.deleteSnapshotFileFromIndex(file, snapshot, "empty-file")) {
                return 'skipped';
            }
            return 'removed';
        }

        const cached = await this.index.getFileRecord(file.path);
        if (cached && cached.contentHash === snapshot.contentHash) {
            if (cached.mtime !== snapshot.mtime || cached.size !== snapshot.size) {
                if (await this.deferSnapshotRefresh(file, snapshot, "metadata-sync")) {
                    return 'skipped';
                }
                await this.index.updateFileMetadata({
                    path: file.path,
                    contentHash: snapshot.contentHash,
                    mtime: snapshot.mtime,
                    size: snapshot.size,
                });
                await this.markDirtyIfSnapshotChangedAndPersist(file, snapshot, "metadata-sync");
                this.clearVerifyRecordIfNotNewerThanSnapshot(file.path, snapshot);
                return 'metadata-synced';
            }
            if (await this.deferSnapshotRefresh(file, snapshot, "unchanged")) {
                return 'skipped';
            }
            this.clearVerifyRecordIfNotNewerThanSnapshot(file.path, snapshot);
            return 'unchanged';
        }

        if (await this.deferSnapshotRefresh(file, snapshot, "pre-embeddings")) {
            return 'skipped';
        }
        const prepared = await this.prepareFileVectors(file, snapshot, getEmbeddingsModel);
        if (prepared.deferred) {
            return 'skipped';
        }
        if (prepared.chunks.length === 0) {
            if (!await this.deleteSnapshotFileFromIndex(file, snapshot, "empty-chunks")) {
                return 'skipped';
            }
            return 'removed';
        }

        if (await this.deferSnapshotRefresh(file, snapshot, "vector-upsert")) {
            return 'skipped';
        }
        await this.index.upsertFile({
            path: file.path,
            contentHash: snapshot.contentHash,
            mtime: snapshot.mtime,
            size: snapshot.size,
            lexicalEligible: this.isEligible(file),
            lexicalMaintenanceEnabled: this.isLexicalProfileEnabled(),
            lexicalBoundaryFingerprint: this.getLexicalBoundaryFingerprint(),
        }, prepared.chunks, prepared.embeddings);
        await this.markDirtyIfSnapshotChangedAndPersist(file, snapshot, "vector-upsert");
        this.clearVerifyRecordIfNotNewerThanSnapshot(file.path, snapshot);
        return 'updated';
    }

    async loadVectorStore(_vssFiles: TFile[], _isDelete: boolean = false) {
        // Legacy no-op: the SQLite/WASM design does not load JSON vectors into memory.
    }

    async searchSimilarity(prompt: string) {
        if (this.disposed) return [];
        await this.initialize();
        if (this.index) {
            await this.ensureIndex({ allowFallback: false, mode: "foreground" });
        }
        if (!this.index || this.status === "uninitialized") {
            return [];
        }
        if (this.status === "missing-local-index") {
            this.showMissingIndexNotice();
            return [];
        }
        if (this.status !== "ready") {
            return [];
        }

        const profile = this.profile ?? this.createEmbeddingProfile();
        const profileSignature = getEmbeddingProfileSignature(profile);
        const embeddings = await this.aiUtils.createEmbeddings(profile.dimensions);
        const queryEmbedding = await embeddings.embedQuery(prompt);
        return this.runExclusive(async () => {
            if (this.disposed) return [];
            if (this.index) {
                await this.ensureIndex({ allowFallback: false, mode: "foreground" });
            }
            if (!this.index || this.status !== "ready" || !this.profile) return [];
            if (getEmbeddingProfileSignature(this.profile) !== profileSignature) return [];
            const results = await this.index.search(queryEmbedding, 8);
            return results.map(normalizeSearchResult);
        }, "foreground").catch((error) => {
            if (this.disposed || getErrorCode(error) === "vss-disposed") return [];
            throw error;
        });
    }

    async searchHybrid(
        prompt: string,
        options?: {
            ftsQueryOverride?: string | null;
            /**
             * Optional promise yielding an FTS query override that runs concurrently with
             * embedding. If both this and ftsQueryOverride are provided, the promise wins.
             * Reject and `null`-resolve are both treated as "no override" (fall back to prompt).
             */
            ftsQueryOverridePromise?: Promise<string | null>;
            temporalFilter?: { since?: number; until?: number };
            temporalFilterPromise?: Promise<{ since?: number; until?: number } | null>;
            signal?: AbortSignal;
            /** Pagelet-only wrapper that admits and immediately invokes query embedding. */
            executeEmbeddingInvoke?: (invoke: () => Promise<number[]>) => Promise<number[]>;
            /** Current-run proof required before a successful Pagelet embedding is cached. */
            canCacheEmbeddingResult?: () => boolean;
            /** Invocation-owned output; cleared first and never retained on VSS. */
            queryEmbeddingOut?: QueryEmbeddingOutput;
            /** Same-run reuse only; avoids a second provider call during recovery. */
            queryEmbeddingOverride?: QueryEmbeddingInput;
            /** Bounded direct-leg overfetch controls; callers still own the 12-path cap. */
            candidateDepth?: number;
            resultLimit?: number;
            /** Selects the frozen standard or recovery retrieval envelope. */
            retrievalMode?: RetrievalCalibrationMode;
            /** Only current matching generations are pushed down before vector/FTS caps. */
            excludeUnchangedPathGenerations?: readonly PathEvidenceGenerationRef[];
        },
    ) {
        const lexicalCandidateEnabled = this.isLexicalProfileEnabled();
        const retrievalMode = options?.retrievalMode ?? "standard";
        const usesLegacyDepthOverrides = options?.candidateDepth !== undefined
            || options?.resultLimit !== undefined;
        const selectedRetrieval = selectRetrievalSearchRuntimeParameters(
            lexicalCandidateEnabled,
            retrievalMode,
        );
        // Explicit depth overrides predate the versioned profile. Keep their
        // old strict/equal semantics and omit profile identity rather than
        // mislabelling an ad-hoc combination as the frozen EC-02 candidate.
        const retrieval = usesLegacyDepthOverrides
            ? applyLegacyRetrievalDepthOverrides(
                selectRetrievalSearchRuntimeParameters(false, retrievalMode),
                options?.candidateDepth,
                options?.resultLimit,
            )
            : selectedRetrieval;
        const vectorOnlyRetrieval = usesLegacyDepthOverrides
            ? retrieval
            : selectRetrievalSearchRuntimeParameters(false, retrievalMode);
        if (options?.queryEmbeddingOut) {
            options.queryEmbeddingOut.value = undefined;
            options.queryEmbeddingOut.profileSignature = undefined;
            options.queryEmbeddingOut.sourceEpoch = undefined;
        }
        const safeOverridePromise: Promise<string | null> = options?.ftsQueryOverridePromise
            ? options.ftsQueryOverridePromise.catch(() => null)
            : Promise.resolve(options?.ftsQueryOverride ?? null);
        const safeTemporalPromise: Promise<{ since?: number; until?: number } | null> = options?.temporalFilterPromise
            ? options.temporalFilterPromise.catch(() => null)
            : Promise.resolve(options?.temporalFilter ?? null);
        const signal = options?.signal;
        throwIfAborted(signal);
        if (this.disposed) return [];
        await this.initialize();
        throwIfAborted(signal);
        if (this.index) {
            await this.ensureIndex({ allowFallback: false, mode: "foreground" });
        }
        throwIfAborted(signal);
        if (!this.index || this.status === "uninitialized") {
            return [];
        }
        if (this.status === "missing-local-index") {
            this.showMissingIndexNotice();
            return [];
        }
        if (this.status !== "ready") {
            return [];
        }

        const profile = this.profile ?? this.createEmbeddingProfile();
        const profileSignature = getEmbeddingProfileSignature(profile);
        const queryEmbeddingPromise = (async () => {
            throwIfAborted(signal);
            if (options?.queryEmbeddingOverride) {
                const override = options.queryEmbeddingOverride;
                if (
                    override.profileSignature !== profileSignature
                    || override.value.length !== profile.dimensions
                    || override.value.some((value) => !Number.isFinite(value))
                ) {
                    throw Object.assign(new Error("The reused Memory query embedding no longer matches current settings."), {
                        code: "query-embedding-override-invalid",
                    });
                }
                return [...override.value];
            }
            const embeddings = await this.aiUtils.createEmbeddings(profile.dimensions);
            const invoke = () => embeddings.embedQuery(prompt);
            if (!options?.executeEmbeddingInvoke) return invoke();
            const cacheKey = stableHash(`${profileSignature}\u0000${prompt}`);
            return this.getOrCreatePageletQueryEmbedding(
                cacheKey,
                () => options.executeEmbeddingInvoke!(invoke),
                () => !signal?.aborted && (options.canCacheEmbeddingResult?.() ?? true),
            );
        })();
        // Parallel: kick off both rewrite override and embed; tolerate rewrite failures.
        // Precedence: when both ftsQueryOverridePromise and ftsQueryOverride are passed,
        // the promise wins (caller explicitly opted into parallel rewrite).
        const [ftsOverride, temporalFilter, queryEmbedding] = await waitForAbortablePromise(Promise.all([
            safeOverridePromise,
            safeTemporalPromise,
            queryEmbeddingPromise,
        ]), signal);
        // Provider rewrite/embedding latency belongs to the caller's turn
        // budget, not the bounded local lexical/Worker phase. Start one local
        // deadline only after those inputs settle, then share it across every
        // local rerun in this search invocation.
        const lexicalBudgetStartedAtMs = Date.now();
        const lexicalBudget = {
            startedAtMs: lexicalBudgetStartedAtMs,
            deadlineAtMs: lexicalBudgetStartedAtMs
                + RETRIEVAL_CALIBRATION_PROFILE.lexicalRuntime.searchBudgetMs,
        };
        let ftsQuery: string | null = null;
        if (lexicalCandidateEnabled && this.isLexicalProfileEnabled()) {
            try {
                const lexicalInput = ftsOverride != null ? ftsOverride : prompt;
                ftsQuery = retrieval.queryMode === "strict_AND"
                    ? buildFtsQuery(lexicalInput)
                    : buildFtsQuery(lexicalInput, retrieval.queryMode);
            } catch (error) {
                this.host.log("Lexical Memory query is unavailable; continuing with vector search", error);
            }
        }

        return this.runExclusive(async () => {
            const assertInvocationActive = () => {
                throwIfAborted(signal);
                this.assertActive();
            };
            assertInvocationActive();
            if (this.disposed) return [];
            if (this.index) {
                await this.ensureIndex({ allowFallback: false, mode: "foreground" });
            }
            assertInvocationActive();
            if (!this.index || this.status !== "ready" || !this.profile) return [];
            const invocationIndex = this.index;
            const assertInvocationIndexCurrent = () => {
                assertInvocationActive();
                if (
                    this.index !== invocationIndex
                    || this.status !== "ready"
                    || !this.profile
                    || getEmbeddingProfileSignature(this.profile) !== profileSignature
                ) {
                    throw Object.assign(new Error("The Memory search index changed during the invocation."), {
                        code: "vss-search-invocation-changed",
                    });
                }
            };
            if (getEmbeddingProfileSignature(this.profile) !== profileSignature) return [];
            if (options?.queryEmbeddingOut) {
                options.queryEmbeddingOut.value = [...queryEmbedding];
                options.queryEmbeddingOut.profileSignature = profileSignature;
            }

            if (!(invocationIndex instanceof SqliteVectorIndex)) {
                const results = await invocationIndex.search(queryEmbedding, 8);
                assertInvocationIndexCurrent();
                return results.map(normalizeSearchResult);
            }

            const safeExclusions = options?.excludeUnchangedPathGenerations?.length
                ? (await this.getPathEvidenceGenerationStatusesUnlocked(
                    options.excludeUnchangedPathGenerations.map((entry) => entry.path),
                )).paths
                    .filter((entry) => entry.current)
                    .flatMap((entry): PathEvidenceGenerationRef[] => {
                        const requested = options.excludeUnchangedPathGenerations!.find((candidate) => candidate.path === entry.path);
                        return requested && requested.generation === entry.generation ? [requested] : [];
                    })
                : [];
            assertInvocationIndexCurrent();
            const index = invocationIndex;
            const searchDetailed = (
                lexicalEnabled: boolean,
                exclusions: PathEvidenceGenerationRef[],
            ) => {
                const activeRetrieval = lexicalEnabled ? retrieval : vectorOnlyRetrieval;
                return index.searchHybridDetailed(
                    queryEmbedding,
                    lexicalEnabled ? ftsQuery : null,
                    activeRetrieval.vectorRaw,
                    activeRetrieval.fusionRaw,
                    temporalFilter ?? undefined,
                    lexicalEnabled ? undefined : "feature_disabled",
                    this.getLexicalBoundaryFingerprint(),
                    lexicalBudget,
                    exclusions,
                    usesLegacyDepthOverrides ? undefined : activeRetrieval,
                    { signal },
                );
            };
            let lexicalEnabledForAttempt = lexicalCandidateEnabled
                && this.isLexicalProfileEnabled();
            let activeExclusions = safeExclusions;
            let acceptedLexicalStatus: LexicalIndexStatus | null = null;
            let result = await searchDetailed(lexicalEnabledForAttempt, activeExclusions);
            assertInvocationIndexCurrent();
            let exclusionsStillCurrent = true;
            if (safeExclusions.length > 0) {
                exclusionsStillCurrent = await this.arePathEvidenceExclusionsStillCurrent(safeExclusions);
                assertInvocationIndexCurrent();
            }
            if (!exclusionsStillCurrent) {
                // A note became dirty while the Worker was ranking. Re-run the
                // local legs once with no early exclusions and the same query
                // embedding; changed evidence must not be hidden as a repeat.
                activeExclusions = [];
                lexicalEnabledForAttempt = lexicalEnabledForAttempt
                    && this.isLexicalProfileEnabled();
                result = await searchDetailed(lexicalEnabledForAttempt, activeExclusions);
                assertInvocationIndexCurrent();
            }
            const runVectorOnlyFallback = async () => {
                // The rollout flag is live authority. A result fused while it
                // was enabled cannot cross the boundary after a mid-flight
                // disable; reuse the embedding and rerun only the local vector
                // leg under the baseline envelope. Drop early exclusions for
                // this second query so a concurrent note change cannot remain
                // hidden behind an already-validated generation snapshot.
                lexicalEnabledForAttempt = false;
                activeExclusions = [];
                result = await searchDetailed(false, activeExclusions);
                assertInvocationIndexCurrent();
            };
            if (lexicalEnabledForAttempt && !this.isLexicalProfileEnabled()) {
                await runVectorOnlyFallback();
            }
            if (
                lexicalEnabledForAttempt
                && (
                    !this.lexicalStatus
                    || this.lexicalStatus.state !== result.lexical.state
                    || this.lexicalStatus.reason !== result.lexical.reason
                )
            ) {
                // Status refresh is another async boundary. Re-check the live
                // flag afterwards before accepting a lexical-fused result.
                const lexicalStatus = await this.readLexicalStatusFromIndex();
                assertInvocationIndexCurrent();
                acceptedLexicalStatus = lexicalStatus;
                if (lexicalEnabledForAttempt && !this.isLexicalProfileEnabled()) {
                    await runVectorOnlyFallback();
                }
            }
            const effectiveLexicalStatus = acceptedLexicalStatus ?? this.lexicalStatus;
            if (
                !effectiveLexicalStatus
                || effectiveLexicalStatus.state !== result.lexical.state
                || effectiveLexicalStatus.reason !== result.lexical.reason
            ) {
                const lexicalStatus = await this.readLexicalStatusFromIndex();
                assertInvocationIndexCurrent();
                acceptedLexicalStatus = lexicalStatus;
                if (lexicalEnabledForAttempt && !this.isLexicalProfileEnabled()) {
                    await runVectorOnlyFallback();
                }
            }
            // This is the linearization point for the live rollout flag. When
            // it remains enabled there is no await between this check and the
            // result/status commit, so a late disable cannot cross the boundary.
            if (lexicalEnabledForAttempt && !this.isLexicalProfileEnabled()) {
                await runVectorOnlyFallback();
            }
            assertInvocationIndexCurrent();
            if (options?.queryEmbeddingOut) {
                options.queryEmbeddingOut.sourceEpoch = result.sourceEpoch;
            }
            if (acceptedLexicalStatus) {
                this.lexicalStatus = acceptedLexicalStatus;
            }
            this.lastLexicalSearchStatus = { ...result.lexical };
            if (!result.lexical.attempted || result.lexical.reason) {
                this.host.log("Lexical Memory search used vector fallback", {
                    state: result.lexical.state,
                    reason: result.lexical.reason,
                    attempted: result.lexical.attempted,
                    durationMs: result.lexical.durationMs,
                });
            }
            return result.results.map(normalizeSearchResult);
        }, "foreground", false, signal).catch((error) => {
            const errorCode = getErrorCode(error);
            const invocationInvalid = signal?.aborted
                || this.disposed
                || errorCode === "vss-disposed"
                || errorCode === "sqlite-vector-index-disposed"
                || errorCode === "vss-search-invocation-changed";
            if (invocationInvalid && options?.queryEmbeddingOut) {
                options.queryEmbeddingOut.value = undefined;
                options.queryEmbeddingOut.profileSignature = undefined;
                options.queryEmbeddingOut.sourceEpoch = undefined;
            }
            if (this.disposed || errorCode === "vss-disposed") return [];
            throw error;
        });
    }

    /** Rank an already Boundary-approved graph workset using an invocation-owned embedding. */
    async rankGraphCandidates(
        queryEmbedding: number[],
        paths: string[],
        control: RankedPathRequestControl,
        options: RankGraphCandidatesOptions = {},
    ): Promise<RankedPathRequestResult> {
        const signal = options.signal;
        throwIfAborted(signal);
        if (this.disposed) throw createVssDisposedError();
        await this.initialize();
        throwIfAborted(signal);
        if (this.index) {
            await this.ensureIndex({ allowFallback: false, mode: "foreground" });
        }
        throwIfAborted(signal);
        if (!(this.index instanceof SqliteVectorIndex) || this.status !== "ready" || !this.profile) {
            throw Object.assign(new Error("Graph candidate ranking requires ready local Memory."), {
                code: "graph-rank-unavailable",
            });
        }

        const profileSignature = getEmbeddingProfileSignature(this.profile);
        const operation = this.runExclusive(async () => {
            throwIfAborted(signal);
            if (this.disposed) throw createVssDisposedError();
            if (this.index) {
                await this.ensureIndex({ allowFallback: false, mode: "foreground" });
            }
            throwIfAborted(signal);
            if (
                !(this.index instanceof SqliteVectorIndex)
                || this.status !== "ready"
                || !this.profile
                || getEmbeddingProfileSignature(this.profile) !== profileSignature
            ) {
                throw Object.assign(new Error("Graph candidate ranking index changed during the invocation."), {
                    code: "graph-rank-epoch-mismatch",
                });
            }
            return this.index.rankGraphCandidates(queryEmbedding, paths, control, options);
        }, "foreground", false, signal);
        return waitForAbortablePromise(operation, signal);
    }

    /** Immediate cancellation bypasses VSS and index data queues. */
    cancelGraphCandidateRank(requestId: string, runEpoch: string): void {
        if (this.index instanceof SqliteVectorIndex) {
            this.index.cancelGraphRank(requestId, runEpoch);
        }
    }

    /**
     * Return query-independent complete-path evidence generations only when
     * both the SQLite row and the live vault source are current. Unknown or
     * dirty paths remain explicit fail-open statuses.
     */
    async getPathEvidenceGenerations(
        paths: string[],
        options: PathEvidenceGenerationLookupOptions = {},
    ): Promise<PathEvidenceGenerationStatusResult> {
        const signal = options.signal;
        throwIfAborted(signal);
        const uniquePaths = [...new Set(paths
            .map((path) => normalizeVaultPath(path))
            .filter((path) => path.length > 0))]
            .sort(compareCodePoint);
        if (uniquePaths.length === 0) return { sourceEpoch: "", paths: [] };
        if (this.disposed) throw createVssDisposedError();
        await this.initialize();
        throwIfAborted(signal);
        if (this.index) {
            await this.ensureIndex({ allowFallback: false, mode: "foreground" });
        }
        throwIfAborted(signal);
        if (!(this.index instanceof SqliteVectorIndex) || this.status !== "ready") {
            throw Object.assign(new Error("Path evidence generation requires ready local Memory."), {
                code: "path-evidence-unavailable",
            });
        }
        const maxPathsPerBatch = clampInteger(
            options.maxPathsPerBatch ?? RETRIEVAL_CALIBRATION_PROFILE.graph.maxPathsPerBatch,
            1,
            RETRIEVAL_CALIBRATION_PROFILE.graph.maxPathsPerBatch,
        );
        const maxChunksScanned = clampInteger(
            options.maxChunksScanned ?? RETRIEVAL_CALIBRATION_PROFILE.graph.maxChunksScanned,
            1,
            RETRIEVAL_CALIBRATION_PROFILE.graph.maxChunksScanned,
        );
        return waitForAbortablePromise(this.runExclusive(async () => {
            throwIfAborted(signal);
            if (!(this.index instanceof SqliteVectorIndex) || this.status !== "ready") {
                throw Object.assign(new Error("Path evidence generation index changed during the invocation."), {
                    code: "path-evidence-unavailable",
                });
            }
            return this.getPathEvidenceGenerationStatusesUnlocked(
                uniquePaths,
                maxPathsPerBatch,
                maxChunksScanned,
            );
        }, "foreground", false, signal), signal);
    }

    private async getPathEvidenceGenerationStatusesUnlocked(
        paths: readonly string[],
        maxPathsPerBatch: number = RETRIEVAL_CALIBRATION_PROFILE.graph.maxPathsPerBatch,
        maxChunksScanned: number = RETRIEVAL_CALIBRATION_PROFILE.graph.maxChunksScanned,
    ): Promise<PathEvidenceGenerationStatusResult> {
        if (!(this.index instanceof SqliteVectorIndex) || this.status !== "ready") {
            throw Object.assign(new Error("Path evidence generation requires ready local Memory."), {
                code: "path-evidence-unavailable",
            });
        }
        const uniquePaths = [...new Set(paths
            .map((path) => normalizeVaultPath(path))
            .filter((path) => path.length > 0))]
            .sort(compareCodePoint);
        const sourceByPath = new Map(uniquePaths.map((path) => [
            path,
            this.host.app.vault.getAbstractFileByPath(path),
        ]));
        // Do not materialize a complete legacy chunk inventory for paths that
        // are already known to be outside the current read/currentness gate.
        const lookupPaths = uniquePaths.filter((path) => {
            const source = sourceByPath.get(path);
            return source instanceof TFile
                && this.isEligible(source)
                && !this.dirty.has(path)
                && !this.verifyQueue.has(path);
        });
        const indexed = await this.index.getPathEvidenceGenerations(
            lookupPaths,
            maxPathsPerBatch,
            maxChunksScanned,
        );
        const indexedByPath = new Map(indexed.paths.map((entry) => [entry.path, entry]));
        const statuses: PathEvidenceGenerationStatus[] = uniquePaths.map((path) => {
            const source = sourceByPath.get(path);
            const record = indexedByPath.get(path);
            if (!(source instanceof TFile)) {
                return { path, current: false, reason: "missing" };
            }
            if (!this.isEligible(source)) {
                return { path, current: false, reason: "boundary_denied" };
            }
            if (this.dirty.has(path)) {
                return { ...record, path, current: false, reason: "dirty" };
            }
            if (this.verifyQueue.has(path)) {
                return { ...record, path, current: false, reason: "verification_pending" };
            }
            if (!record?.generation) {
                return { path, current: false, reason: "generation_unavailable" };
            }
            if (record.mtime !== source.stat.mtime || record.size !== source.stat.size) {
                return { ...record, path, current: false, reason: "source_revision_mismatch" };
            }
            return { ...record, path, current: true, reason: "current" };
        });
        return { sourceEpoch: indexed.sourceEpoch, paths: statuses };
    }

    private async arePathEvidenceExclusionsStillCurrent(
        exclusions: readonly PathEvidenceGenerationRef[],
    ): Promise<boolean> {
        const statuses = await this.getPathEvidenceGenerationStatusesUnlocked(
            exclusions.map((entry) => entry.path),
            Math.min(
                RETRIEVAL_CALIBRATION_PROFILE.graph.maxPathsPerBatch,
                Math.max(1, exclusions.length),
            ),
        );
        const requested = new Map(exclusions.map((entry) => [entry.path, entry.generation]));
        return statuses.paths.length === requested.size
            && statuses.paths.every((entry) => (
                entry.current
                && typeof entry.generation === "string"
                && requested.get(entry.path) === entry.generation
            ));
    }

    async getChunksByPath(paths: string[], options: VectorIndexPathLookupOptions = {}) {
        const signal = options.signal;
        throwIfAborted(signal);
        const uniquePaths = [...new Set(paths.filter((path) => path.length > 0))];
        if (uniquePaths.length === 0) return [];
        if (this.disposed) return [];
        await this.initialize();
        throwIfAborted(signal);
        if (this.index) {
            await this.ensureIndex({ allowFallback: false, mode: "foreground" });
        }
        throwIfAborted(signal);
        if (!this.index || this.status === "uninitialized") {
            return [];
        }
        if (this.status === "missing-local-index") {
            this.showMissingIndexNotice();
            return [];
        }
        if (this.status !== "ready") {
            return [];
        }

        return this.runExclusive(async () => {
            throwIfAborted(signal);
            if (this.disposed) return [];
            if (this.index) {
                await this.ensureIndex({ allowFallback: false, mode: "foreground" });
            }
            throwIfAborted(signal);
            if (!this.index || this.status !== "ready") return [];

            const results = await waitForAbortablePromise(
                this.index.getChunksByPath(uniquePaths, {
                    limitPerPath: options.limitPerPath,
                    signal,
                }),
                signal,
            );
            return results.map(normalizeSearchResult);
        }, "foreground", false, signal).catch((error) => {
            if (this.disposed || getErrorCode(error) === "vss-disposed") return [];
            throw error;
        });
    }

    async clusterVectors(maxClusters: number): Promise<Array<{ clusterId: number; label: string; paths: string[] }>> {
        if (this.disposed || !this.index || !(this.index instanceof SqliteVectorIndex)) return [];
        if (this.status !== "ready") return [];
        try {
            return await this.index.clusterVectors(maxClusters);
        } catch {
            return [];
        }
    }

    async getStats(options: { mode?: VSSIndexOpenMode } = {}): Promise<VSSIndexStats> {
        if (this.disposed) {
            return this.createUnavailableStats("uninitialized");
        }
        const mode = options.mode ?? "foreground";
        await this.initialize();
        if (this.shouldRecoverMarkerForStats(mode)) {
            await this.tryRecoverMarkerFromSqlite(mode);
        }
        if (this.index || this.shouldEnsureStatsIndex(mode)) {
            await this.ensureIndex({ allowFallback: false, mode });
        }
        if (!this.index) {
            return this.createUnavailableStats(this.status);
        }
        const stats = await this.index.getStats();
        if (stats.lexicalProfileState) {
            this.lexicalStatus = await this.readLexicalStatusFromIndex();
        }
        const effectiveLexicalStatus = this.lexicalStatus;
        return {
            ...stats,
            status: this.status === "ready" ? stats.status : this.status,
            storagePersisted: this.storageStatus.persisted,
            storageUsage: this.storageStatus.usage,
            storageQuota: this.storageStatus.quota,
            lastErrorCode: stats.lastErrorCode ?? this.lastErrorCode,
            databaseName: this.getDatabaseName(),
            opfsDirectory: this.getOpfsDirectory(),
            opfsVfsName: this.getOpfsVfsName(),
            indexId: this.marker?.indexId,
            indexBuiltAt: this.marker?.builtAt,
            lexicalProfileState: effectiveLexicalStatus?.state ?? stats.lexicalProfileState,
            lexicalProfileId: effectiveLexicalStatus?.marker?.profileId ?? stats.lexicalProfileId,
            lexicalGeneration: effectiveLexicalStatus?.marker?.generation ?? stats.lexicalGeneration,
            lexicalFallbackReason: effectiveLexicalStatus
                ? effectiveLexicalStatus.reason
                : stats.lexicalFallbackReason,
            lexicalSearchAttempted: this.lastLexicalSearchStatus?.attempted,
            lexicalSearchState: this.lastLexicalSearchStatus?.state,
            lexicalSearchReason: this.lastLexicalSearchStatus?.reason,
            lexicalSearchDurationMs: this.lastLexicalSearchStatus?.durationMs,
            lexicalSearchMatchedRows: this.lastLexicalSearchStatus?.matchedRows,
        };
    }

    private shouldRecoverMarkerForStats(mode: VSSIndexOpenMode): boolean {
        return mode === "manual"
            && !this.index
            && !this.marker
            && !this.markerRecoverySuppressed
            && (this.status === "uninitialized" || this.status === "disabled" || this.status === "error");
    }

    private shouldEnsureStatsIndex(mode: VSSIndexOpenMode): boolean {
        return mode === "manual"
            && Boolean(this.marker)
            && (this.status === "disabled" || this.status === "error");
    }

    async getMemoryReadiness(): Promise<MemoryMaintenancePlan> {
        if (this.disposed) {
            return {
                reason: "unavailable",
                action: "none",
                notesToCheck: 0,
                requiresApproval: false,
                canAnswerNow: true,
            };
        }
        await this.initialize();
        if (this.index) {
            await this.ensureIndex({ allowFallback: false, mode: "foreground" });
        }

        const notesToCheck = this.host.getVSSFiles().length;
        const dirtyCount = this.dirty.size;
        const verificationPending = this.verifyQueue.size;
        const status = this.status;

        if (status === "ready" && this.isLexicalProfileEnabled() && isLexicalCapableVectorIndex(this.index)) {
            const lexicalStatus = await this.readLexicalStatusFromIndex();
            this.lexicalStatus = lexicalStatus;
            if (
                lexicalStatus.state === "awaiting_confirmation"
                || lexicalStatus.state === "stale"
                || lexicalStatus.state === "failed"
                // A Worker opened while the rollout flag was off reports this
                // state. Enabling the flag live must enter the same explicit
                // lexical-only approval flow without reopening the vector DB.
                || (
                    lexicalStatus.state === "unavailable"
                    && lexicalStatus.reason === "feature_disabled"
                )
            ) {
                return {
                    reason: "lexical-profile-stale",
                    action: "rebuild-lexical",
                    notesToCheck,
                    requiresApproval: true,
                    canAnswerNow: true,
                };
            }
        }

        if (status === "ready" && dirtyCount > 0) {
            return {
                reason: "changed-notes",
                action: "refresh",
                notesToCheck,
                notesLikelyToUpdate: dirtyCount,
                verificationPending,
                requiresApproval: true,
                canAnswerNow: true,
            };
        }

        if (status === "ready") {
            return {
                reason: "ready",
                action: "none",
                notesToCheck,
                verificationPending,
                requiresApproval: false,
                canAnswerNow: true,
            };
        }

        if (status === "missing-local-index") {
            return {
                reason: "local-memory-missing",
                action: "rebuild",
                notesToCheck,
                notesLikelyToUpdate: notesToCheck,
                requiresApproval: true,
                canAnswerNow: true,
            };
        }

        if (status === "stale") {
            return {
                reason: "settings-changed",
                action: "rebuild",
                notesToCheck,
                notesLikelyToUpdate: notesToCheck,
                requiresApproval: true,
                canAnswerNow: true,
            };
        }

        if (status === "uninitialized") {
            return {
                reason: "first-use",
                action: "rebuild",
                notesToCheck,
                notesLikelyToUpdate: notesToCheck,
                requiresApproval: true,
                canAnswerNow: true,
            };
        }

        return {
            reason: "unavailable",
            action: "none",
            notesToCheck,
            requiresApproval: false,
            canAnswerNow: true,
        };
    }

    async getLexicalStatus(): Promise<LexicalIndexStatus> {
        if (this.disposed) {
            return createUnavailableLexicalStatus("vss_disposed");
        }
        await this.initialize();
        if (this.index) {
            await this.ensureIndex({ allowFallback: false, mode: "foreground" });
        }
        this.lexicalStatus = await this.readLexicalStatusFromIndex();
        return this.lexicalStatus;
    }

    async rebuildLexicalIndex(options: VSSLexicalRebuildOptions = {}): Promise<VSSLexicalRebuildSummary> {
        const signal = options.signal;
        const batchSize = Math.max(1, Math.min(
            RETRIEVAL_CALIBRATION_PROFILE.lexicalRuntime.maxRebuildBatchSize,
            Math.floor(options.batchSize ?? RETRIEVAL_CALIBRATION_PROFILE.lexicalRuntime.rebuildBatchSize),
        ));
        this.assertLexicalRebuildAuthorized(signal);
        if (this.disposed) {
            return { aborted: true, rowsProcessed: 0, rowsTotal: 0, reason: "vss_disposed" };
        }
        await this.initialize();
        if (this.index) {
            await this.ensureIndex({ allowFallback: false, mode: "manual" });
        }
        if (!isLexicalCapableVectorIndex(this.index) || this.status !== "ready") {
            throw new Error("Lexical Memory search cannot be rebuilt until local Memory is ready.");
        }
        const index = this.index;
        const allowedPaths = this.getLexicalAllowedPaths();
        const allowedPathSetFingerprint = stableHash(allowedPaths.join("\u0000"));
        const lexicalBoundaryFingerprint = this.getLexicalBoundaryFingerprint()
            ?? `allowed_paths:${allowedPathSetFingerprint}`;
        const runtimeCanaryFingerprint = getCharPhraseRuntimeCanaryFingerprint();
        let rebuildId: string | null = null;
        let rowsProcessed = 0;
        let rowsTotal = 0;
        let generation: number | undefined;
        try {
            const started = await this.runExclusive(
                () => {
                    this.assertLexicalRebuildAuthorized(signal);
                    return index.beginLexicalRebuild(
                        CHAR_PHRASE_PROFILE_ID,
                        runtimeCanaryFingerprint,
                        lexicalBoundaryFingerprint,
                        allowedPaths.length,
                    );
                },
            );
            rebuildId = started.rebuildId;
            rowsTotal = started.totalRows;
            generation = started.generation;

            for (let offset = 0; offset < allowedPaths.length; offset += batchSize) {
                this.assertLexicalRebuildAuthorized(signal);
                const scopeBatch = allowedPaths.slice(offset, offset + batchSize);
                const scope = await this.runExclusive(
                    () => {
                        this.assertLexicalRebuildAuthorized(signal);
                        return index.appendLexicalScopeBatch(rebuildId!, scopeBatch);
                    },
                );
                if (scope.sealed) {
                    rowsTotal = scope.totalRows;
                }
            }
            options.onProgress?.({
                phase: "lexical-rebuilding",
                lexicalRowsDone: 0,
                lexicalRowsTotal: rowsTotal,
            });

            let afterRowId = 0;
            let done = rowsTotal === 0;
            while (!done) {
                this.assertLexicalRebuildAuthorized(signal);
                const batch = await this.runExclusive(
                    () => {
                        this.assertLexicalRebuildAuthorized(signal);
                        return index.appendLexicalRebuildBatch(rebuildId!, afterRowId, batchSize);
                    },
                );
                rowsProcessed = batch.processedRows;
                afterRowId = batch.nextRowId;
                done = batch.done;
                options.onProgress?.({
                    phase: "lexical-rebuilding",
                    lexicalRowsDone: rowsProcessed,
                    lexicalRowsTotal: rowsTotal,
                });
                if (!done) {
                    await sleep(0);
                }
            }

            this.assertLexicalRebuildAuthorized(signal);
            options.onProgress?.({
                phase: "finalizing",
                lexicalRowsDone: rowsTotal,
                lexicalRowsTotal: rowsTotal,
            });
            this.lexicalStatus = await this.runExclusive(async () => {
                this.assertLexicalRebuildAuthorized(signal);
                if (
                    allowedPathSetFingerprint !== this.getLexicalAllowedPathSetFingerprint()
                    || lexicalBoundaryFingerprint !== (
                        this.getLexicalBoundaryFingerprint()
                        ?? `allowed_paths:${this.getLexicalAllowedPathSetFingerprint()}`
                    )
                ) {
                    throw new Error("Memory note eligibility changed during lexical rebuild.");
                }
                return index.finalizeLexicalRebuild(rebuildId!);
            });
            options.onProgress?.({
                phase: "ready",
                lexicalRowsDone: rowsTotal,
                lexicalRowsTotal: rowsTotal,
            });
            return { aborted: false, rowsProcessed: rowsTotal, rowsTotal, generation };
        } catch (error) {
            const errorCode = getErrorCode(error);
            const disabled = errorCode === "lexical-profile-disabled";
            const aborted = Boolean(signal?.aborted) || disabled || errorCode === "vss-disposed";
            let cleanupError: unknown;
            if (aborted) {
                options.onProgress?.({
                    phase: "cancelling",
                    lexicalRowsDone: rowsProcessed,
                    lexicalRowsTotal: rowsTotal,
                });
            }
            if (rebuildId) {
                await this.runExclusive(() => index.abortLexicalRebuild(
                    rebuildId!,
                    aborted ? undefined : getErrorCode(error) ?? "lexical_rebuild_failed",
                ), "maintenance", true).catch((abortError) => {
                    cleanupError = abortError;
                    this.host.log("Failed to clean the interrupted lexical Memory rebuild", abortError);
                });
            }
            this.lexicalStatus = await this.readLexicalStatusFromIndex();
            if (aborted) {
                if (cleanupError) throw cleanupError;
                return {
                    aborted: true,
                    rowsProcessed,
                    rowsTotal,
                    generation,
                    reason: disabled ? "feature_disabled" : "aborted",
                };
            }
            throw error;
        }
    }

    private async readLexicalStatusFromIndex(): Promise<LexicalIndexStatus> {
        if (!isLexicalCapableVectorIndex(this.index) || this.status !== "ready") {
            return createUnavailableLexicalStatus("sqlite_index_unavailable");
        }
        try {
            const status = await this.index.getLexicalStatus();
            const boundaryFingerprint = this.getLexicalBoundaryFingerprint();
            if (
                status.state === "ready"
                && boundaryFingerprint
                && status.marker?.scopeFingerprint !== boundaryFingerprint
            ) {
                return {
                    ...status,
                    state: "stale",
                    reason: "scope_changed",
                };
            }
            return status;
        } catch (error) {
            if (getErrorCode(error) === "sqlite-vector-index-disposed") {
                throw error;
            }
            this.host.log("Could not read lexical Memory status", error);
            return createUnavailableLexicalStatus(getErrorCode(error) ?? "status_unavailable");
        }
    }

    private getLexicalAllowedPathSetFingerprint(): string {
        return stableHash(this.getLexicalAllowedPaths().join("\u0000"));
    }

    private getLexicalAllowedPaths(): string[] {
        return this.host.getVSSFiles().map((file) => file.path).sort();
    }

    private isLexicalProfileEnabled(): boolean {
        return resolveB125RetrievalOptimizationFlags(
            this.host.getRetrievalOptimizationFlags?.()
            ?? this.host.settings.retrievalOptimizationFlags,
        ).lexicalProfile;
    }

    private getLexicalBoundaryFingerprint(): string | undefined {
        const policy = this.host.settings.dataBoundary;
        if (!policy) return undefined;
        const canonical = {
            excludedFolders: [...policy.excludedFolders]
                // Keep this normalization identical to the shared Data Boundary
                // folder predicate. A leading slash is semantically meaningful;
                // collapsing it here could leave an old lexical generation ready
                // after the effective allowlist changed.
                .map((value) => normalizeVaultPath(value).replace(/\/$/, ""))
                .filter(Boolean)
                .sort(),
            excludedTags: [...policy.excludedTags]
                .map((value) => value.trim().replace(/^#+/, "").toLowerCase())
                .filter(Boolean)
                .sort(),
            generatedNotePolicy: policy.generatedNotePolicy,
            vssCacheExcludePath: [...(this.host.settings.vssCacheExcludePath ?? [])]
                // VSS eligibility uses trim + startsWith verbatim. Preserve the
                // trailing slash because `private/` and `private` exclude
                // different path sets.
                .map((value) => value.trim())
                .filter(Boolean)
                .sort(),
        };
        return `lexical_boundary:${stableHash(JSON.stringify(canonical))}`;
    }

    private deleteFileFromIndex(index: VectorIndex, path: string): Promise<void> {
        return index.deleteFile(path, {
            lexicalMaintenanceEnabled: this.isLexicalProfileEnabled(),
            lexicalBoundaryFingerprint: this.getLexicalBoundaryFingerprint(),
        });
    }

    private assertLexicalRebuildAuthorized(signal?: AbortSignal): void {
        throwIfAborted(signal);
        if (this.disposed) throw createVssDisposedError();
        if (!this.isLexicalProfileEnabled()) {
            throw Object.assign(new Error("The lexical Memory search feature is disabled."), {
                code: "lexical-profile-disabled",
            });
        }
    }

    private runExclusive<T>(
        operation: () => Promise<T>,
        priority: VSSOperationPriority = "maintenance",
        allowDuringShutdown = false,
        signal?: AbortSignal,
    ): Promise<T> {
        if (this.disposed && !allowDuringShutdown) {
            return Promise.reject(createVssDisposedError());
        }
        if (signal?.aborted) {
            return Promise.reject(createAbortError());
        }
        return new Promise<T>((resolve, reject) => {
            let callerSettled = false;
            const settleResolve = (value: T) => {
                if (callerSettled) return;
                callerSettled = true;
                resolve(value);
            };
            const settleReject = (error: unknown) => {
                if (callerSettled) return;
                callerSettled = true;
                reject(error);
            };
            const queued: VSSQueuedOperation = {
                started: false,
                run: async () => {
                    queued.started = true;
                    try {
                        throwIfAborted(signal);
                        if (!allowDuringShutdown) this.assertActive();
                        settleResolve(await operation());
                    } catch (error) {
                        settleReject(error);
                    } finally {
                        signal?.removeEventListener("abort", onAbort);
                    }
                },
            };
            const onAbort = () => {
                signal?.removeEventListener("abort", onAbort);
                if (!queued.started) {
                    this.removeQueuedOperation(queued);
                }
                // An active operation retains queue ownership until its
                // signal-aware local work rejects or its late result drains.
                settleReject(createAbortError());
            };
            signal?.addEventListener("abort", onAbort, { once: true });
            if (signal?.aborted) {
                onAbort();
                return;
            }
            if (priority === "foreground") {
                this.foregroundOperations.push(queued);
            } else {
                this.maintenanceOperations.push(queued);
            }
            this.drainOperationQueue();
        });
    }

    private removeQueuedOperation(operation: VSSQueuedOperation): void {
        for (const queue of [this.foregroundOperations, this.maintenanceOperations]) {
            const index = queue.indexOf(operation);
            if (index >= 0) {
                queue.splice(index, 1);
                return;
            }
        }
    }

    private drainOperationQueue(): void {
        if (this.operationActive) return;
        const next = this.foregroundOperations.shift() ?? this.maintenanceOperations.shift();
        if (!next) return;
        this.operationActive = true;
        void next.run().finally(() => {
            this.operationActive = false;
            this.drainOperationQueue();
        });
    }

    private isShuttingDown(): boolean {
        return this.disposed;
    }

    private assertActive(): void {
        if (this.isShuttingDown()) {
            throw createVssDisposedError();
        }
    }

    private async sleepActive(ms: number): Promise<void> {
        this.assertActive();
        await sleep(ms);
        this.assertActive();
    }

    private createUnavailableStats(status: VectorIndexStatus): VSSIndexStats {
        return {
            status,
            backend: "none",
            chunkCount: 0,
            fileCount: 0,
            fallbackMode: false,
            storagePersisted: this.storageStatus.persisted,
            storageUsage: this.storageStatus.usage,
            storageQuota: this.storageStatus.quota,
            lastErrorCode: this.lastErrorCode,
            databaseName: this.getDatabaseName(),
            opfsDirectory: this.getOpfsDirectory(),
            opfsVfsName: this.getOpfsVfsName(),
        };
    }

    private recordIndexError(error: unknown): void {
        const code = getErrorCode(error);
        if (code) {
            this.lastErrorCode = code;
        }
    }

    private async disposeIndex(index: VectorIndex, logMessage?: string): Promise<void> {
        await withTimeout(index.dispose(), VSS_INDEX_DISPOSE_TIMEOUT_MS).catch((error) => {
            if (logMessage) {
                this.host.log(logMessage, error);
            }
        });
    }

    private registerShutdownBarrier(promise: Promise<void>): void {
        const key = this.getStorageScopeKey();
        const barriers = getVssShutdownBarriers();
        const entry: VSSShutdownEntry = {
            ownerId: this.ownerId,
            promise: promise.catch(() => undefined),
            startedAt: Date.now(),
        };
        barriers.set(key, entry);
        void entry.promise.finally(() => {
            if (barriers.get(key) === entry) {
                barriers.delete(key);
            }
        });
    }

    private async waitForScopedShutdown(timeoutMs: number): Promise<void> {
        const entry = getVssShutdownBarriers().get(this.getStorageScopeKey());
        if (!entry || entry.ownerId === this.ownerId) return;
        await withTimeout(entry.promise, timeoutMs).catch(() => undefined);
    }

    private getStorageScopeKey(): string {
        return [
            this.getPluginId(),
            this.getDatabaseName(),
            this.getOpfsDirectory(),
            this.getOpfsVfsName(),
        ].join("|");
    }

    private getPluginId(): string {
        return this.host.pluginId;
    }

    private enqueueVerifyPath(file: TFile, record: VSSFileRecord, reason: VerifyReason, now = Date.now()): boolean {
        if (this.dirty.has(file.path)) return false;
        const existing = this.verifyQueue.get(file.path);
        const updated: VerifyRecord = existing
            ? {
                ...existing,
                last: now,
                reason,
                observedMtime: file.stat.mtime,
                observedSize: file.stat.size,
                contentHash: record.contentHash,
            }
            : {
                path: file.path,
                first: now,
                last: now,
                reason,
                observedMtime: file.stat.mtime,
                observedSize: file.stat.size,
                contentHash: record.contentHash,
            };
        const changed = !existing
            || existing.last !== updated.last
            || existing.reason !== updated.reason
            || existing.observedMtime !== updated.observedMtime
            || existing.observedSize !== updated.observedSize
            || existing.contentHash !== updated.contentHash;
        this.verifyQueue.set(file.path, updated);
        return changed;
    }

    private markDirtyPath(path: string, now = Date.now()): boolean {
        const existing = this.dirty.get(path);
        const epoch = ++this.dirtyEpochCounter;
        const updated: DirtyTimestamps = existing
            ? { first: existing.first, last: now, epoch }
            : { first: now, last: now, epoch };
        this.dirty.set(path, updated);
        this.verifyQueue.delete(path);
        return true;
    }

    private getDirtyStamp(path: string): number | undefined {
        const dirty = this.dirty.get(path);
        return dirty ? dirty.epoch ?? dirty.last : undefined;
    }

    private clearDirtyIfStampMatches(path: string, stamp: number | undefined): boolean {
        const dirty = this.dirty.get(path);
        if (!dirty) return false;
        const currentStamp = dirty.epoch ?? dirty.last;
        if (stamp === undefined || currentStamp !== stamp) return false;
        return this.dirty.delete(path);
    }

    private clearStaleDirtyForSyncedRecord(path: string, record: VSSFileRecord): boolean {
        const dirty = this.dirty.get(path);
        if (!dirty) return false;
        const lastDirtyAt = dirty.last ?? dirty.first ?? 0;
        if (lastDirtyAt > record.updatedAt) return false;
        return this.dirty.delete(path);
    }

    private async deleteIndexedPath(path: string): Promise<void> {
        await this.initialize();
        if (!await this.isDurableReady()) {
            if (path.endsWith(".md") && this.markDirtyPath(path)) {
                await this.persistDirtyJournal();
            }
            return;
        }

        this.verifyQueue.delete(path);
        const dirtyChanged = this.dirty.delete(path);
        if (this.index) {
            await this.deleteFileFromIndex(this.index, path);
            await this.writeLocalIndexState();
        }
        if (dirtyChanged) {
            await this.persistDirtyJournal();
        }
    }

    private async isDurableReady(): Promise<boolean> {
        if (!this.index || this.status !== "ready") return false;
        const stats = await this.index.getStats();
        return stats.status === "ready"
            && !stats.fallbackMode
            && stats.backend === "sqlite-wasm-opfs-sahpool";
    }

    private async ensureIndex(options: VSSEnsureIndexOptions): Promise<void> {
        if (this.disposed) return;
        if (this.ensureIndexPromise) {
            await this.ensureIndexPromise;
            if (!this.disposed && this.shouldRetryEnsureIndex(options)) {
                await this.ensureIndexUnlocked(options);
            }
            return;
        }

        const run = this.ensureIndexUnlocked(options).finally(() => {
            if (this.ensureIndexPromise === run) {
                this.ensureIndexPromise = null;
            }
        });
        this.ensureIndexPromise = run;
        return run;
    }

    private shouldRetryEnsureIndex(options: VSSEnsureIndexOptions): boolean {
        if (options.mode !== "manual") return false;
        return !this.index && (this.status === "disabled" || this.status === "error");
    }

    private async ensureIndexUnlocked(options: VSSEnsureIndexOptions): Promise<void> {
        this.assertActive();
        const mode = options.mode ?? "foreground";
        const { profile, profileSignature } = await this.refreshEmbeddingProfile();
        this.assertActive();

        if (this.index && (this.status === "ready" || this.status === "stale")) {
            return;
        }
        if (this.index && this.status === "initializing") {
            return;
        }
        if (this.index && this.status === "missing-local-index") {
            if (options.allowMissingIndexRecovery) {
                this.status = "ready";
            }
            return;
        }

        const marker = this.marker;
        this.assertActive();
        if (marker && marker.schemaVersion !== VSS_SCHEMA_VERSION) {
            this.status = "stale";
            if (mode !== "manual") {
                return;
            }
        }

        let sqliteIndex: SqliteVectorIndex | null = null;
        try {
            const opened = await this.openSqliteIndex(profile, mode);
            sqliteIndex = opened.index;
            const status = opened.status;
            this.assertActive();
            this.index = sqliteIndex;
            this.status = status;
            this.lastErrorCode = undefined;

            if (status === "stale") {
                return;
            }

            const stats = await sqliteIndex.getStats();
            if (marker && marker.profileSignature === profileSignature && marker.chunkCount > 0 && stats.chunkCount === 0) {
                this.status = "missing-local-index";
                return;
            }

            this.status = "ready";
            return;
        } catch (error) {
            if (sqliteIndex) {
                await this.disposeIndex(sqliteIndex);
            }
            if (this.disposed || getErrorCode(error) === "vss-disposed") {
                return;
            }
            this.recordIndexError(error);
            this.host.log("SQLite VSS index unavailable", error);
            if (mode === "manual" && !options.allowFallback) {
                this.index = null;
                this.status = "error";
                throw error;
            }
            if (isOpfsSahpoolLockedError(error)) {
                this.index = null;
                this.status = "disabled";
                this.scheduleSqliteRecovery(profileSignature, profile);
                return;
            }
        }

        this.index = null;
        this.status = "disabled";
    }

    private async openSqliteIndex(
        profile: EmbeddingProfile,
        mode: VSSIndexOpenMode,
    ): Promise<{ index: SqliteVectorIndex; status: VectorIndexStatus }> {
        const waitMs = mode === "manual" ? VSS_MANUAL_LOCKED_WAIT_MS : VSS_FOREGROUND_LOCKED_WAIT_MS;
        await this.waitForScopedShutdown(waitMs);
        this.assertActive();

        const deadline = Date.now() + waitMs;
        let lastError: unknown;
        // eslint-disable-next-line no-constant-condition -- Retry termination is governed by success and deadline exits inside the loop.
        while (true) {
            const sqliteIndex = this.createSqliteIndex();
            try {
                const status = await sqliteIndex.initialize(profile);
                this.assertActive();
                return { index: sqliteIndex, status };
            } catch (error) {
                lastError = error;
                await this.disposeIndex(sqliteIndex);
                if (!this.disposed) {
                    this.recordIndexError(error);
                }
                if (this.disposed || getErrorCode(error) === "vss-disposed") {
                    throw error;
                }
                if (!isOpfsSahpoolLockedError(error) || mode === "foreground") {
                    throw error;
                }
                const remaining = deadline - Date.now();
                if (remaining <= 0) {
                    throw error;
                }
                await this.sleepActive(Math.min(100, remaining));
            }
        }
        throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }

    private createSqliteIndex(): SqliteVectorIndex {
        return new SqliteVectorIndex({
            workerUrl: "inline:personal-assistant-vss-worker",
            wasmUrl: getInlineSqliteWasmUrl(),
            databaseName: this.getDatabaseName(),
            opfsDirectory: this.getOpfsDirectory(),
            legacyOpfsDirectory: VSS_LEGACY_OPFS_ROOT,
            opfsVfsName: this.getOpfsVfsName(),
            workerFactory: createInlineSqliteWorker,
            lexicalProfileEnabled: this.isLexicalProfileEnabled(),
            lexicalBoundaryFingerprint: this.getLexicalBoundaryFingerprint(),
        });
    }

    private scheduleSqliteRecovery(profileSignature: string, profile: EmbeddingProfile): void {
        if (this.disposed || this.sqliteRecoveryPromise) return;
        const now = Date.now();
        if (now < this.nextSqliteRecoveryAt) return;
        this.nextSqliteRecoveryAt = now + VSS_RECOVERY_COOLDOWN_MS;
        this.sqliteRecoveryPromise = this.runExclusive(() => this.recoverSqliteIndex(profileSignature, profile))
            .catch((error) => {
                if (!this.disposed) {
                    this.recordIndexError(error);
                    this.host.log("SQLite VSS recovery failed", error);
                }
            })
            .finally(() => {
                this.sqliteRecoveryPromise = null;
            });
        void this.sqliteRecoveryPromise;
    }

    private async recoverSqliteIndex(profileSignature: string, profile: EmbeddingProfile): Promise<void> {
        if (this.disposed || this.status === "ready" || this.status === "stale") return;
        const marker = this.marker;
        if (!marker || marker.profileSignature !== profileSignature) return;

        const previousIndex = this.index;
        const opened = await this.openSqliteIndex(profile, "manual");
        const sqliteIndex = opened.index;
        try {
            this.assertActive();
            const stats = await sqliteIndex.getStats();
            this.assertActive();
            if (opened.status === "stale") {
                this.index = sqliteIndex;
                this.status = "stale";
            } else if (marker.chunkCount > 0 && stats.chunkCount === 0) {
                await this.disposeIndex(sqliteIndex);
                this.index = previousIndex;
                this.status = "missing-local-index";
                return;
            } else {
                this.index = sqliteIndex;
                this.status = "ready";
            }
            this.lastErrorCode = undefined;
            if (previousIndex && previousIndex !== sqliteIndex) {
                await this.disposeIndex(previousIndex, "Failed to dispose recovered VSS index");
            }
        } catch (error) {
            await this.disposeIndex(sqliteIndex);
            throw error;
        }
    }

    private async prepareFileVectors(
        file: TFile,
        snapshot: VSSFileContentSnapshot,
        getEmbeddingsModel?: EmbeddingsModelProvider,
    ): Promise<{ chunks: VSSChunk[]; embeddings: number[][]; deferred: boolean }> {
        this.assertActive();
        const chunks = await this.prepareFileChunks(file, snapshot.contentHash ?? "", snapshot.cleanedContent, snapshot);
        if (chunks.length === 0) {
            return { chunks, embeddings: [], deferred: false };
        }
        if (await this.deferSnapshotRefresh(file, snapshot, "pre-embedding-request")) {
            return { chunks, embeddings: [], deferred: true };
        }
        const embeddings = await this.embedTexts(
            chunks.map(chunk => chunk.content),
            getEmbeddingsModel,
        );
        return { chunks, embeddings, deferred: false };
    }

    private async prepareFileChunks(
        file: TFile,
        contentHash: string,
        cleanedContent?: string,
        metadata?: VSSFileMetadataSnapshot,
    ): Promise<VSSChunk[]> {
        this.assertActive();
        const content = cleanedContent ?? this.aiUtils.cleanMarkdownContent(await this.readVaultFile(file));

        if (content.trim().length === 0) {
            return [];
        }

        return createHeadingAwareMarkdownChunks({
            path: file.path,
            markdown: content,
            contentHash,
            created: metadata?.ctime ?? file.stat.ctime,
            lastModified: metadata?.mtime ?? file.stat.mtime,
        });
    }

    private async embedTexts(
        texts: string[],
        getEmbeddingsModel?: EmbeddingsModelProvider,
    ): Promise<number[][]> {
        const policy = this.getEmbeddingBatchPolicy();
        const embeddingsModelProvider = getEmbeddingsModel ?? this.createEmbeddingsModelProvider(policy.createOptions);
        const embeddings: number[][] = [];
        for (let i = 0; i < texts.length; i += policy.maxBatchItems) {
            this.assertActive();
            const batch = texts.slice(i, i + policy.maxBatchItems);
            embeddings.push(...await this.embedDocumentsWithRetry(batch, embeddingsModelProvider, policy));
            this.assertActive();
        }
        return embeddings;
    }

    private async embedDocumentsWithRetry(
        texts: string[],
        getEmbeddingsModel: EmbeddingsModelProvider,
        policy: EmbeddingBatchPolicy,
        onRetry?: (retryDelayMs: number) => void,
    ): Promise<number[][]> {
        let lastError: unknown;
        for (let attempt = 0; attempt <= policy.retryDelaysMs.length; attempt++) {
            this.assertActive();
            await this.waitForEmbeddingThrottle(texts, policy);
            this.assertActive();
            try {
                const embeddingsModel = await getEmbeddingsModel();
                this.assertActive();
                return await embeddingsModel.embedDocuments(texts);
            } catch (error) {
                lastError = error;
                if (!isRetryableEmbeddingError(error) || attempt >= policy.retryDelaysMs.length) {
                    throw error;
                }
                const retryDelayMs = policy.retryDelaysMs[attempt];
                onRetry?.(retryDelayMs);
                await this.sleepActive(retryDelayMs);
            }
        }
        throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }

    private async waitForEmbeddingThrottle(texts: string[], policy: EmbeddingBatchPolicy): Promise<void> {
        const now = Date.now();
        const delayMs = Math.max(0, this.nextEmbeddingRequestAt - now);
        if (delayMs > 0) {
            await this.sleepActive(delayMs);
        }

        const scheduledAt = Math.max(Date.now(), this.nextEmbeddingRequestAt);
        const estimatedTokens = estimateEmbeddingTokensForTexts(texts);
        const tokenDelayMs = policy.safeTokensPerMinute
            ? Math.ceil((estimatedTokens / policy.safeTokensPerMinute) * 60_000)
            : 0;
        this.nextEmbeddingRequestAt = scheduledAt + Math.max(policy.minRequestGapMs, tokenDelayMs);
    }

    private getEmbeddingBatchPolicy(): EmbeddingBatchPolicy {
        const profile = this.profile ?? this.createEmbeddingProfile();
        const provider = profile.provider.toLowerCase();
        const model = profile.model.toLowerCase();
        const retryDelaysMs = EMBEDDING_RETRY_DELAYS_MS;

        if (provider === "qwen" && (model.includes("text-embedding-v4") || model.includes("text-embedding-v3"))) {
            return {
                maxBatchItems: 10,
                minRequestGapMs: 100,
                safeTokensPerMinute: QWEN_TEXT_EMBEDDING_SAFE_TPM,
                retryDelaysMs,
                createOptions: {
                    batchSize: 10,
                    maxConcurrency: 1,
                    maxRetries: 0,
                },
            };
        }

        return {
            maxBatchItems: 8,
            minRequestGapMs: 100,
            retryDelaysMs,
            createOptions: {
                batchSize: 8,
                maxConcurrency: 1,
                maxRetries: 0,
            },
        };
    }

    private createEmbeddingsModelProvider(options?: CreateEmbeddingsOptions): EmbeddingsModelProvider {
        let embeddingsPromise: Promise<EmbeddingsModel> | null = null;
        return () => {
            embeddingsPromise ??= this.createOperationEmbeddingsModel(options);
            return embeddingsPromise;
        };
    }

    private async createOperationEmbeddingsModel(options?: CreateEmbeddingsOptions): Promise<EmbeddingsModel> {
        this.assertActive();
        const profile = this.profile ?? this.createEmbeddingProfile();
        const embeddings = await this.aiUtils.createEmbeddings(profile.dimensions, options);
        this.assertActive();
        return embeddings;
    }

    private async computeFileHash(file: TFile): Promise<{ hash: string | null; tooLarge: boolean }> {
        const snapshot = await this.readFileContentSnapshot(file);
        return { hash: snapshot.contentHash, tooLarge: snapshot.tooLarge };
    }

    private async readFileContentSnapshot(file: TFile): Promise<VSSFileContentSnapshot> {
        this.assertActive();
        const metadata = this.captureFileMetadata(file);
        if (metadata.size > VSS_PARAMS.largeFileThreshold) {
            return {
                ...metadata,
                cleanedContent: "",
                contentHash: null,
                tooLarge: true,
                changedDuringCapture: !this.isFileSnapshotCurrent(file, metadata),
            };
        }
        const markdown = await this.readVaultFile(file);
        const cleanedContent = this.aiUtils.cleanMarkdownContent(markdown);
        const contentHash = cleanedContent.trim()
            ? await computeContentHash(cleanedContent)
            : null;
        return {
            ...metadata,
            cleanedContent,
            contentHash,
            tooLarge: false,
            changedDuringCapture: !this.isFileSnapshotCurrent(file, metadata),
        };
    }

    private captureFileMetadata(file: TFile): VSSFileMetadataSnapshot {
        return {
            path: file.path,
            capturedAt: Date.now(),
            ctime: file.stat.ctime,
            mtime: file.stat.mtime,
            size: file.stat.size,
        };
    }

    private isFileSnapshotCurrent(file: TFile, snapshot: VSSFileMetadataSnapshot): boolean {
        return file.path === snapshot.path
            && file.stat.mtime === snapshot.mtime
            && file.stat.size === snapshot.size;
    }

    private isVerifyCandidateMetadataCurrent(file: TFile, candidate: VerifyRecord): boolean {
        return file.path === candidate.path
            && file.stat.mtime === candidate.observedMtime
            && file.stat.size === candidate.observedSize;
    }

    private isVerifyRecordNewerThanSnapshot(record: VerifyRecord, snapshot: VSSFileMetadataSnapshot): boolean {
        return record.last > snapshot.capturedAt
            || record.observedMtime > snapshot.mtime;
    }

    private clearVerifyRecordIfNotNewerThanSnapshot(path: string, snapshot: VSSFileMetadataSnapshot): boolean {
        const current = this.verifyQueue.get(path);
        if (!current || this.isVerifyRecordNewerThanSnapshot(current, snapshot)) return false;
        return this.verifyQueue.delete(path);
    }

    private async deferSnapshotRefresh(file: TFile, snapshot: VSSFileMetadataSnapshot, phase: string): Promise<boolean> {
        if (this.isFileSnapshotCurrent(file, snapshot)) return false;
        if (this.markDirtyPath(snapshot.path)) {
            await this.persistDirtyJournal();
        }
        this.host.log("Deferred Memory index write because the note changed during refresh", {
            path: snapshot.path,
            phase,
        });
        return true;
    }

    private async deleteSnapshotFileFromIndex(file: TFile, snapshot: VSSFileMetadataSnapshot, phase: string): Promise<boolean> {
        if (!this.index) return false;
        if (await this.deferSnapshotRefresh(file, snapshot, `${phase}-delete`)) return false;
        await this.deleteFileFromIndex(this.index, snapshot.path);
        if (this.isFileSnapshotCurrent(file, snapshot)) {
            this.clearVerifyRecordIfNotNewerThanSnapshot(snapshot.path, snapshot);
            return true;
        }
        await this.markDirtyIfSnapshotChangedAndPersist(file, snapshot, `${phase}-deleted`);
        return true;
    }

    private async readVaultFile(file: TFile): Promise<string> {
        return this.host.app.vault.read(file);
    }

    private markDirtyIfSnapshotChanged(file: TFile, snapshot: VSSFileMetadataSnapshot): boolean {
        if (this.isFileSnapshotCurrent(file, snapshot)) return false;
        return this.markDirtyPath(snapshot.path);
    }

    private async markDirtyIfSnapshotChangedAndPersist(file: TFile, snapshot: VSSFileMetadataSnapshot, phase: string): Promise<void> {
        if (!this.markDirtyIfSnapshotChanged(file, snapshot)) return;
        await this.persistDirtyJournal();
        this.host.log("Marked Memory file dirty because the note changed during index write", {
            path: snapshot.path,
            phase,
        });
    }

    private async loadDirtyJournal() {
        if (this.disposed) return;
        try {
            const dirty = await this.stateStore.getDirtyJournal();
            const pending = new Map(this.dirty);
            this.dirty.clear();
            for (const [path, timestamps] of dirty) {
                this.dirty.set(path, {
                    first: timestamps.first,
                    last: timestamps.last,
                    epoch: ++this.dirtyEpochCounter,
                });
            }
            for (const [path, timestamps] of pending) {
                this.dirty.set(path, timestamps);
            }
        } catch (e) {
            this.host.log("Error loading Memory dirty journal:", e);
        }
    }

    private async persistDirtyJournal() {
        if (this.disposed) return;
        if (!await this.ensureLocalStateStoreReady()) {
            this.dirtyJournalWritePending = true;
            return;
        }
        const generation = this.stateGeneration;
        const write = this.stateWriteChain.catch(() => undefined).then(async () => {
            if (this.disposed || generation !== this.stateGeneration) return;
            const snapshot = await this.createDirtyJournalSnapshotForWrite();
            await this.stateStore.setDirtyJournal(snapshot);
        });
        this.stateWriteChain = write.then(() => undefined, () => undefined);
        try {
            await write;
            if (!this.disposed && generation === this.stateGeneration) {
                this.dirtyJournalWritePending = false;
            }
        } catch (error) {
            this.dirtyJournalWritePending = true;
            this.localStateReady = false;
            this.host.log("Error persisting Memory dirty journal:", error);
        }
    }

    private async createDirtyJournalSnapshotForWrite(): Promise<Map<string, DirtyTimestamps>> {
        if (this.localStateHydrated || this.localStateClearPending) {
            return new Map(this.dirty);
        }
        const persisted = await this.stateStore.getDirtyJournal();
        for (const [path, timestamps] of this.dirty) {
            persisted.set(path, timestamps);
        }
        return persisted;
    }

    private async writeLocalIndexState(generation = this.stateGeneration): Promise<void> {
        if (this.disposed) return;
        if (!this.index || !this.profile) return;
        const stats = await this.index.getStats();
        if (this.disposed || generation !== this.stateGeneration) return;
        this.storageStatus = await this.getStoragePersistenceStatus();
        if (this.disposed || generation !== this.stateGeneration) return;
        const now = new Date().toISOString();
        const profileSignature = getEmbeddingProfileSignature(this.profile);
        const previousMarker = this.marker?.profileSignature === profileSignature ? this.marker : null;
        const marker: VSSIndexMarker = {
            schemaVersion: VSS_SCHEMA_VERSION,
            deviceId: this.deviceId,
            indexId: previousMarker?.indexId ?? createIndexId(),
            profileSignature,
            opfsScope: this.getVaultStorageScope().safeName,
            backend: stats.backend,
            chunkCount: stats.chunkCount,
            fileCount: stats.fileCount,
            builtAt: previousMarker?.builtAt ?? now,
            lastVerifiedAt: now,
            storagePersisted: this.storageStatus.persisted,
            estimatedDbBytes: stats.estimatedDbBytes,
            estimatedEmbeddingTokens: estimateEmbeddingTokens(stats.chunkCount),
        };
        this.marker = marker;
        this.markerRecoverySuppressed = false;
        this.status = stats.status === "stale" ? "stale" : "ready";
        await this.persistMarkerSnapshot(marker, generation);
    }

    private async persistMarkerSnapshot(marker: VSSIndexMarker, generation: number): Promise<void> {
        if (this.disposed) return;
        if (!await this.ensureLocalStateStoreReady()) {
            this.markerWritePending = true;
            return;
        }
        const snapshot = { ...marker };
        const write = this.stateWriteChain.catch(() => undefined).then(async () => {
            if (this.disposed || generation !== this.stateGeneration) return;
            await this.stateStore.setMarker(snapshot);
        });
        this.stateWriteChain = write.then(() => undefined, () => undefined);
        try {
            await write;
            if (!this.disposed && generation === this.stateGeneration) {
                this.markerWritePending = false;
            }
        } catch (error) {
            this.markerWritePending = true;
            this.localStateReady = false;
            this.host.log("Error persisting Memory local marker:", error);
        }
    }

    private async clearLocalStateStore(generation: number): Promise<void> {
        if (this.disposed || generation !== this.stateGeneration) return;
        if (!await this.ensureLocalStateStoreReady()) {
            this.localStateClearPending = true;
            return;
        }
        const write = this.stateWriteChain.catch(() => undefined).then(async () => {
            if (this.disposed || generation !== this.stateGeneration) return;
            await this.stateStore.removeMarker();
            await this.stateStore.clearDirtyJournal();
        });
        this.stateWriteChain = write.then(() => undefined, () => undefined);
        try {
            await write;
            if (!this.disposed && generation === this.stateGeneration) {
                this.localStateClearPending = false;
                this.localStateHydrated = true;
                this.dirtyJournalWritePending = false;
                this.markerWritePending = false;
            }
        } catch (error) {
            this.localStateClearPending = true;
            this.localStateReady = false;
            this.host.log("Failed to clear Memory local state during reset", error);
        }
    }

    private async getLegacyJsonCacheSummary(): Promise<LegacyJsonSummary> {
        const paths: string[] = [];
        let bytes = 0;
        const pendingFolders = [this.vssCacheDir];

        try {
            while (pendingFolders.length > 0) {
                const folder = pendingFolders.shift() as string;
                const listed = await this.host.app.vault.adapter.list(folder);
                for (const file of listed.files) {
                    if (!file.endsWith(".json") || file.endsWith(`/${VSS_PARAMS.dirtyJournal}`)) continue;
                    paths.push(file);
                    try {
                        const raw = await this.host.app.vault.adapter.read(file);
                        bytes += raw.length;
                    } catch {
                        // Ignore unreadable legacy cache files in size estimates.
                    }
                }
                pendingFolders.push(...listed.folders);
            }
        } catch (error) {
            if (!isMissingFileError(error)) {
                this.host.log("Could not list legacy VSS cache directory", error);
            }
        }

        return { fileCount: paths.length, bytes, paths };
    }

    private createEmbeddingProfile(): EmbeddingProfile {
        return {
            provider: this.host.settings.aiProvider,
            baseURL: this.host.settings.baseURL,
            model: this.host.settings.embeddingModelName,
            dimensions: VSS_DEFAULT_DIMENSIONS,
            distanceMetric: VSS_DEFAULT_DISTANCE_METRIC,
        };
    }

    private async refreshEmbeddingProfile(): Promise<{ profile: EmbeddingProfile; profileSignature: string }> {
        const profile = this.createEmbeddingProfile();
        const profileSignature = getEmbeddingProfileSignature(profile);
        const previousSignature = this.profile ? getEmbeddingProfileSignature(this.profile) : null;

        if (previousSignature && previousSignature !== profileSignature) {
            this.pageletQueryEmbeddingCache.clear();
            this.pageletQueryEmbeddingInFlight.clear();
            if (this.index) {
                await this.disposeIndex(this.index, "Failed to dispose stale VSS index");
                this.index = null;
            }
            this.status = "uninitialized";
        }

        this.profile = profile;
        return { profile, profileSignature };
    }

    private getOrCreatePageletQueryEmbedding(
        cacheKey: string,
        invoke: () => Promise<number[]>,
        canCache: () => boolean,
    ): Promise<number[]> {
        const cached = this.pageletQueryEmbeddingCache.get(cacheKey);
        if (cached) {
            // Refresh insertion order so the bounded map behaves as an LRU.
            this.pageletQueryEmbeddingCache.delete(cacheKey);
            this.pageletQueryEmbeddingCache.set(cacheKey, cached);
            return Promise.resolve(cached);
        }
        const inFlight = this.pageletQueryEmbeddingInFlight.get(cacheKey);
        if (inFlight) return inFlight;

        // The provider work and its successful cache entry are shared. A
        // caller's AbortSignal is applied by searchHybrid while it waits, so
        // one stale waiter cannot reject the operation for other current ones.
        const operation = (async () => {
            const embedding = await invoke();
            if (!this.disposed && canCache()) {
                this.pageletQueryEmbeddingCache.set(cacheKey, embedding);
                while (this.pageletQueryEmbeddingCache.size > 16) {
                    const oldest = this.pageletQueryEmbeddingCache.keys().next().value as string | undefined;
                    if (!oldest) break;
                    this.pageletQueryEmbeddingCache.delete(oldest);
                }
            }
            return embedding;
        })().finally(() => {
            if (this.pageletQueryEmbeddingInFlight.get(cacheKey) === operation) {
                this.pageletQueryEmbeddingInFlight.delete(cacheKey);
            }
        });
        this.pageletQueryEmbeddingInFlight.set(cacheKey, operation);
        return operation;
    }

    private async requestPersistentStorage(): Promise<StoragePersistenceStatus> {
        return this.getStoragePersistenceStatus({ requestPersistence: true });
    }

    private async getStoragePersistenceStatus(options: { requestPersistence?: boolean } = {}): Promise<StoragePersistenceStatus> {
        const storage = getPlatformNavigatorStorage();
        if (!storage) return { persisted: false };

        let persisted = false;
        try {
            persisted = typeof storage.persisted === "function" ? await storage.persisted() : false;
            if (!persisted && options.requestPersistence && typeof storage.persist === "function") {
                persisted = await storage.persist();
            }
        } catch (error) {
            this.host.log("Persistent storage status check failed", error);
        }

        try {
            const estimate = typeof storage.estimate === "function" ? await storage.estimate() : {};
            return {
                persisted,
                usage: estimate.usage,
                quota: estimate.quota,
            };
        } catch {
            return { persisted };
        }
    }

    private getDatabaseName(): string {
        return getVaultScopedDatabaseName(this.getVaultStorageScope());
    }

    private getOpfsDirectory(): string {
        return `${VSS_OPFS_ROOT}/${this.getVaultStorageScope().safeName}`;
    }

    private getOpfsVfsName(): string {
        return `opfs-sahpool-${this.getVaultStorageScope().safeName}`.slice(0, 120);
    }

    private getVaultStorageScope(): VaultStorageScope {
        return getVaultStorageScope(this.host.app.vault.getName(), this.getVaultLocalPath());
    }

    private getVaultLocalPath(): string | undefined {
        const adapter = this.host.app.vault.adapter as {
            getBasePath?: () => string;
            getFullPath?: (path: string) => string;
        };
        try {
            if (typeof adapter.getBasePath === "function") {
                return adapter.getBasePath();
            }
            if (typeof adapter.getFullPath === "function") {
                return adapter.getFullPath("");
            }
        } catch {
            return undefined;
        }
        return undefined;
    }

    private showMissingIndexNotice(): void {
        const now = Date.now();
        if (now - this.lastMissingIndexNoticeAt < 60_000) return;
        this.lastMissingIndexNoticeAt = now;
        new Notice(vssT("plugin.memory.notice.needsPrepareAgain"), 7000);
    }

    private isEligible(file: TFile) {
        if (file.extension !== 'md') return false;
        if (this.host.isDataBoundaryAllowedPath && !this.host.isDataBoundaryAllowedPath(file.path)) {
            return false;
        }
        const exclude = (this.host.settings.vssCacheExcludePath || []).map(path => path.trim()).filter(Boolean);
        for (const path of exclude) {
            if (file.path.startsWith(path)) {
                return false;
            }
        }
        return true;
    }
}

function normalizeSearchResult(result: VectorSearchResult): { score: number; doc: Document } {
    const rawDoc = result.doc as Document | { pageContent: string; metadata: Record<string, unknown> };
    return {
        score: result.score,
        doc: rawDoc instanceof Document
            ? rawDoc
            : new Document({
                pageContent: rawDoc.pageContent,
                metadata: rawDoc.metadata,
            }),
    };
}

function applyLegacyRetrievalDepthOverrides(
    selected: RetrievalSearchRuntimeParameters,
    candidateDepth: number | undefined,
    resultLimit: number | undefined,
): RetrievalSearchRuntimeParameters {
    if (candidateDepth === undefined && resultLimit === undefined) return selected;
    const resolvedCandidateDepth = candidateDepth === undefined
        ? selected.vectorRaw
        : clampInteger(candidateDepth, 1, 96);
    return Object.freeze({
        ...selected,
        vectorRaw: resolvedCandidateDepth,
        lexicalRaw: resolvedCandidateDepth,
        fusionRaw: resultLimit === undefined
            ? selected.fusionRaw
            : clampInteger(resultLimit, 1, 72),
    });
}

function clampInteger(value: number, minimum: number, maximum: number): number {
    if (!Number.isFinite(value)) return minimum;
    return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}

function compareCodePoint(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function createDefaultVSSIndexStateStore(host: MemoryHost): VSSIndexStateStore {
    const hostLike = host as MemoryHost & {
        createVSSIndexStateStore?: () => VSSIndexStateStore;
    };
    if (typeof hostLike.createVSSIndexStateStore === "function") {
        return hostLike.createVSSIndexStateStore();
    }
    return createVSSIndexStateStore(
        host.app.vault,
        host.settings.statisticsVaultId || "default-vault",
        host.pluginId,
    );
}

function createIndexId(): string {
    const cryptoApi = getPlatformCrypto() as (Crypto & { randomUUID?: () => string }) | undefined;
    if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
        return cryptoApi.randomUUID();
    }
    return `vss-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createVssDisposedError(): Error {
    return Object.assign(new Error("VSS has been disposed."), { code: "vss-disposed" });
}

function createUnavailableLexicalStatus(reason: string): LexicalIndexStatus {
    return {
        state: "unavailable",
        reason,
        chunkCount: 0,
        lexicalRowCount: 0,
    };
}

function isLexicalCapableVectorIndex(index: VectorIndex | null): index is LexicalCapableVectorIndex {
    if (!index) return false;
    const candidate = index as Partial<LexicalCapableVectorIndex>;
    return typeof candidate.getLexicalStatus === "function"
        && typeof candidate.beginLexicalRebuild === "function"
        && typeof candidate.appendLexicalScopeBatch === "function"
        && typeof candidate.appendLexicalRebuildBatch === "function"
        && typeof candidate.finalizeLexicalRebuild === "function"
        && typeof candidate.abortLexicalRebuild === "function";
}

function getErrorCode(error: unknown): string | undefined {
    if (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string") {
        return (error as { code: string }).code;
    }
    return undefined;
}

function isOpfsSahpoolLockedError(error: unknown): boolean {
    if (getErrorCode(error) === "opfs-sahpool-locked") {
        return true;
    }
    return errorMessage(error).includes("Local memory storage is busy");
}

function getVssShutdownBarriers(): Map<string, VSSShutdownEntry> {
    return vssShutdownBarriers;
}

interface VaultStorageScope {
    safeName: string;
}

function getVaultStorageScope(vaultName: string, vaultLocalPath?: string): VaultStorageScope {
    const normalizedName = vaultName.trim() || "vault";
    const scopeSource = `${normalizedName}\n${vaultLocalPath?.trim() ?? ""}`;
    const hash = hashStorageScope(scopeSource);
    const encodedName = encodeURIComponent(normalizedName).replace(/%/g, "_");
    const safeName = `${encodedName.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "vault"}-${hash}`;
    return { safeName };
}

function getVaultScopedDatabaseName(scope: VaultStorageScope): string {
    return `personal-assistant-vss-${scope.safeName}.sqlite3`;
}

function hashStorageScope(value: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}


export { buildFtsQuery } from './fts-query-builder';
