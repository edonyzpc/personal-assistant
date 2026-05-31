/* Copyright 2023 edonyzpc */
import { Notice, Platform, TAbstractFile, TFile } from 'obsidian';
import { Document } from "@langchain/core/documents";
import { MarkdownTextSplitter } from '@langchain/textsplitters';

import { AIService } from './ai-services/service';
import { AIUtils, type CreateEmbeddingsOptions } from './ai-services/ai-utils';
import { PluginManager } from './plugin';
import { computeContentHash, selectFlushCandidates, DirtyTimestamps } from './vss-helpers';
import { createInlineSqliteWorker, getInlineSqliteWasmUrl } from './vss/sqlite-inline-assets';
import { SqliteVectorIndex } from './vss/sqlite-vector-index';
import { getVSSDeviceId } from './vss/state';
import { createVSSIndexStateStore, type VSSIndexStateStore } from './vss/local-state-store';
import {
    getEmbeddingProfileSignature,
    VSS_DEFAULT_DIMENSIONS,
    VSS_DEFAULT_DISTANCE_METRIC,
    VSS_SCHEMA_VERSION,
    type EmbeddingProfile,
    type VectorIndex,
    type VectorIndexStatus,
    type VectorSearchResult,
    type VSSChunk,
    type VSSFileRecord,
    type VSSIndexMarker,
    type VSSIndexStats,
} from './vss/types';
import type { MemoryMaintenancePlan } from './memory-manager';
import { confirmUserAction } from './confirm';
import { buildFtsQuery } from './vss/fts-query-builder';

const VSS_PARAMS = {
    quietWindow: 30 * 1000,
    maxDelay: 10 * 60 * 1000,
    maxPerMinute: 5,
    largeFileThreshold: 1_000_000,
    dirtyJournal: "dirty.json",
};
const VSS_OPFS_ROOT = "/personal-assistant-vss-v2";
const VSS_LEGACY_OPFS_ROOT = "/personal-assistant-vss";
const EMBEDDING_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000];
const QWEN_TEXT_EMBEDDING_SAFE_TPM = 900_000;
const VSS_RECONCILE_BATCH_SIZE = 250;
const VSS_RECONCILE_MAX_METADATA_PER_RUN = 2_000;
const VSS_ROLLING_HASH_VERIFY_LIMIT = 50;
const VSS_DESKTOP_VERIFY_MAX_FILES = 20;
const VSS_DESKTOP_VERIFY_MAX_BYTES = 5 * 1024 * 1024;
const VSS_DESKTOP_VERIFY_MAX_WALL_CLOCK_MS = 500;
const VSS_DESKTOP_CHAT_VERIFY_MAX_FILES = 5;
const VSS_DESKTOP_CHAT_VERIFY_MAX_BYTES = 1 * 1024 * 1024;
const VSS_DESKTOP_CHAT_VERIFY_MAX_WALL_CLOCK_MS = 100;
const VSS_MOBILE_VERIFY_MAX_FILES = 3;
const VSS_MOBILE_VERIFY_MAX_BYTES = 512 * 1024;
const VSS_MOBILE_VERIFY_MAX_WALL_CLOCK_MS = 100;
const VSS_MOBILE_CHAT_VERIFY_MAX_FILES = 1;
const VSS_MOBILE_CHAT_VERIFY_MAX_BYTES = 512 * 1024;
const VSS_MOBILE_CHAT_VERIFY_MAX_WALL_CLOCK_MS = 100;
const VSS_FOREGROUND_LOCKED_WAIT_MS = 1_500;
const VSS_MANUAL_LOCKED_WAIT_MS = 3_000;
const VSS_INDEX_DISPOSE_TIMEOUT_MS = 4_000;
const VSS_RECOVERY_COOLDOWN_MS = 5_000;
const VSS_GLOBAL_SHUTDOWN_KEY = "__personalAssistantVssShutdownBarriers";
const VSS_LOCAL_STATE_UNAVAILABLE_CODE = "vss-local-state-unavailable";

export type VSSRefreshStatus = 'updated' | 'unchanged' | 'metadata-synced' | 'removed' | 'skipped';

export interface VSSOperationSummary {
    aborted: boolean;
    updated: number;
    unchanged: number;
    removed: number;
    skipped: number;
    failed: number;
    metadataSynced: number;
    verificationQueued: number;
    verificationChecked: number;
    dirtyConfirmed: number;
    storagePersisted?: boolean;
}

export type VSSProgressPhase = "scanning" | "embedding" | "writing" | "retrying" | "ready";

export interface VSSProgressEvent {
    phase: VSSProgressPhase;
    filesTotal?: number;
    filesDone?: number;
    filesUpdated?: number;
    chunksTotal?: number;
    chunksEmbedded?: number;
    failed?: number;
    currentFile?: string;
    retryDelayMs?: number;
}

interface VSSOperationOptions {
    silent?: boolean;
    onProgress?: (event: VSSProgressEvent) => void;
}

interface VSSFlushOptions extends VSSOperationOptions {
    force?: boolean;
    reason?: string;
    limit?: number;
}

export interface VSSReconcileOptions {
    reason?: string;
    batchSize?: number;
    maxMetadataItems?: number;
    verifyHashLimit?: number;
}

export interface VSSReconcileSummary extends VSSOperationSummary {
    scanned: number;
    markedDirty: number;
    verified: number;
    hasMore: boolean;
}

export interface VSSVerifyOptions {
    reason?: string;
    maxFiles?: number;
    maxBytes?: number;
    maxWallClockMs?: number;
    fastPath?: boolean;
}

export interface VSSVerifySummary extends VSSOperationSummary {
    markedDirty: number;
    hasMore: boolean;
    bytesReadEstimate: number;
}

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

type EmbeddingsModel = Awaited<ReturnType<AIUtils["createEmbeddings"]>>;
type EmbeddingsModelProvider = () => Promise<EmbeddingsModel>;

interface EmbeddingBatchPolicy {
    maxBatchItems: number;
    minRequestGapMs: number;
    safeTokensPerMinute?: number;
    retryDelaysMs: number[];
    createOptions: CreateEmbeddingsOptions;
}

interface RebuildFileState {
    file: TFile;
    contentHash: string;
    chunks: VSSChunk[];
    embeddings: number[][];
    remaining: number;
    failed: boolean;
}

interface RebuildChunkWorkItem {
    state: RebuildFileState;
    chunkIndex: number;
    text: string;
}

type VerifyReason = "metadata-drift" | "file-open" | "rolling-check";

interface VerifyRecord {
    path: string;
    first: number;
    last: number;
    reason: VerifyReason;
    observedMtime: number;
    observedSize: number;
    contentHash: string;
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

type VSSGlobalScope = typeof globalThis & {
    [VSS_GLOBAL_SHUTDOWN_KEY]?: Map<string, VSSShutdownEntry>;
};

export class VSS {
    private plugin: PluginManager;
    private vssCacheDir: string;
    private aiService: AIService;
    private aiUtils: AIUtils;
    private dirty = new Map<string, DirtyTimestamps>();
    private verifyQueue = new Map<string, VerifyRecord>();
    private dirtyEpochCounter = 0;
    private isFlushing = false;
    private operationQueue: Promise<void> = Promise.resolve();
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

    constructor(
        plugin: PluginManager,
        vssCacheDir: string,
        private readonly stateStore: VSSIndexStateStore = createDefaultVSSIndexStateStore(plugin),
    ) {
        this.plugin = plugin;
        this.vssCacheDir = vssCacheDir;
        this.aiService = new AIService(plugin);
        this.aiUtils = new AIUtils(plugin);
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
            this.plugin.log("Memory local state store unavailable", error);
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
        if (this.disposePromise) return this.disposePromise;
        const pendingInitialization = this.initializationPromise;
        const pendingEnsureIndex = this.ensureIndexPromise;
        const pendingRecovery = this.sqliteRecoveryPromise;
        this.disposed = true;
        this.initialized = false;
        this.initializationPromise = null;
        this.ensureIndexPromise = null;
        this.sqliteRecoveryPromise = null;
        this.disposePromise = this.disposeUnlocked([
            pendingInitialization,
            pendingEnsureIndex,
            pendingRecovery,
        ]);
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
                this.plugin.log("Failed to dispose VSS index", error);
            });
        }
        await this.stateWriteChain.catch(() => undefined);
        await this.stateStore.dispose().catch((error) => {
            this.plugin.log("Failed to dispose Memory local state store", error);
        });
    }

    private async readLocalMarker(): Promise<VSSIndexMarker | null> {
        const marker = await this.stateStore.getMarker();
        if (!marker) return null;
        if (marker.deviceId !== this.deviceId) return null;
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
            this.plugin.log("Could not recover Memory state from local index", error);
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

    async markDirtyIfIndexedMetadataChanged(file: TFile | null): Promise<boolean> {
        if (this.disposed) return false;
        if (!(file instanceof TFile)) return false;
        if (!this.isEligible(file)) return false;
        await this.initialize();
        if (!this.index || this.status !== "ready") {
            return false;
        }

        const record = await this.index.getFileRecord(file.path);
        if (record && record.mtime === file.stat.mtime && record.size === file.stat.size) {
            return false;
        }

        if (!record) {
            const changed = this.markDirtyPath(file.path);
            if (changed) {
                await this.persistDirtyJournal();
            }
            return changed;
        }

        return this.enqueueVerifyPath(file, record, "file-open");
    }

    async handleDelete(file: TFile): Promise<void> {
        if (this.disposed) return;
        await this.runExclusive(() => this.deleteIndexedPath(file.path));
        this.plugin.log("delete VSS entry", file.path);
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
                new Notice("Memory is not ready. Prepare memory first.", 5000);
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
                ? new Set(this.plugin.getVSSFiles().map(file => file.path))
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
                        await this.index.deleteFile(indexedPath);
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
                const file = this.plugin.app.vault.getAbstractFileByPath(path);
                emitProgress("scanning", { currentFile: file instanceof TFile ? getProgressFileName(file) : getProgressPathName(path) });
                if (!file || !(file instanceof TFile)) {
                    if (this.clearDirtyIfStampMatches(path, dirtyStamp)) {
                        dirtyChanged = true;
                    }
                    this.verifyQueue.delete(path);
                    if (this.index) await this.index.deleteFile(path);
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
                    this.plugin.log("Failed to refresh VSS index", { path, error: e });
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
            new Notice("This device may need to prepare memory again later.", 7000);
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
        const files = this.plugin.getVSSFiles();
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
                .filter(state => state.remaining === 0 && pendingFiles.has(state.file.path));

            for (const state of readyStates) {
                pendingFiles.delete(state.file.path);
                emitProgress("writing", { currentFile: getProgressFileName(state.file) });
                if (state.failed) {
                    summary.failed++;
                    filesFinalized++;
                    this.plugin.log("Skipped rebuilding VSS file after embedding failure", { path: state.file.path });
                    emitProgress("writing", { currentFile: getProgressFileName(state.file) });
                    continue;
                }

                try {
                    await index.upsertFile({
                        path: state.file.path,
                        contentHash: state.contentHash,
                        mtime: state.file.stat.mtime,
                        size: state.file.stat.size,
                    }, state.chunks, state.embeddings);
                    summary.updated++;
                    filesUpdated++;
                } catch (error) {
                    summary.failed++;
                    this.plugin.log("Failed to write rebuilt VSS file", { path: state.file.path, error });
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
            try {
                const embeddings = await this.embedDocumentsWithRetry(
                    batch.map(item => item.text),
                    getEmbeddingsModel,
                    embeddingPolicy,
                    (retryDelayMs) => emitProgress("retrying", { currentFile, retryDelayMs }),
                );
                if (embeddings.length !== batch.length) {
                    throw new Error(`Embedding count ${embeddings.length} does not match batch size ${batch.length}.`);
                }
                for (let index = 0; index < batch.length; index++) {
                    const item = batch[index];
                    item.state.embeddings[item.chunkIndex] = embeddings[index];
                    item.state.remaining--;
                }
                chunksEmbedded += embeddings.length;
            } catch (error) {
                const affectedStates = Array.from(new Set(batch.map(item => item.state)));
                const affectedFiles = affectedStates.map(state => state.file.path);
                this.plugin.log("Failed to embed rebuilt VSS batch", { paths: affectedFiles, error });
                for (const state of affectedStates) {
                    state.failed = true;
                    state.remaining = 0;
                }
            }
            await finalizeReadyFiles(batch.map(item => item.state));
            emitProgress("embedding", { currentFile });
        };

        emitProgress("scanning");
        for (const file of files) {
            this.assertActive();
            filesScanned++;
            emitProgress("scanning", { currentFile: getProgressFileName(file) });
            try {
                const fileState = await this.computeFileHash(file);

                if (fileState.tooLarge) {
                    await index.deleteFile(file.path);
                    summary.skipped++;
                    filesFinalized++;
                    this.plugin.log(`Skipped VSS index for large file ${file.path}`);
                    emitProgress("scanning", { currentFile: getProgressFileName(file) });
                    continue;
                }

                if (!fileState.hash) {
                    await index.deleteFile(file.path);
                    summary.removed++;
                    filesFinalized++;
                    emitProgress("scanning", { currentFile: getProgressFileName(file) });
                    continue;
                }

                const chunks = await this.prepareFileChunks(file, fileState.hash);
                if (chunks.length === 0) {
                    await index.deleteFile(file.path);
                    summary.removed++;
                    filesFinalized++;
                    emitProgress("scanning", { currentFile: getProgressFileName(file) });
                    continue;
                }

                const state: RebuildFileState = {
                    file,
                    contentHash: fileState.hash,
                    chunks,
                    embeddings: new Array(chunks.length) as number[][],
                    remaining: chunks.length,
                    failed: false,
                };
                pendingFiles.set(file.path, state);
                chunksTotal += chunks.length;
                for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
                    if (state.failed || !pendingFiles.has(file.path)) break;
                    currentBatch.push({ state, chunkIndex, text: chunks[chunkIndex].content });
                    if (currentBatch.length >= embeddingPolicy.maxBatchItems) {
                        await processBatch();
                        if (state.failed || !pendingFiles.has(file.path)) break;
                    }
                }
            } catch (error) {
                summary.failed++;
                filesFinalized++;
                this.plugin.log("Failed to scan rebuilt VSS file", { path: file.path, error });
                emitProgress("scanning", { currentFile: getProgressFileName(file) });
            }
        }

        await processBatch();
        emitProgress("writing");
        await this.persistDirtyJournal();
        await this.writeLocalIndexState();
        emitProgress("ready", { filesDone: filesFinalized });
        if (!options.silent) {
            new Notice(summary.failed > 0 ? "Memory is ready, but some notes were skipped." : "Memory is ready. Your notes were not changed.", 5000);
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
            new Notice(summary.failed > 0 ? "Memory was updated, but some notes were skipped." : "Memory is ready. Your notes were not changed.", 3000);
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
        new Notice("Local memory copy reset.", 3000);
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
        const files = this.plugin.getVSSFiles();
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
                    await index.deleteFile(record.path);
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
                        const fileState = await this.computeFileHash(file);
                        if (fileState.tooLarge || !fileState.hash) {
                            this.verifyQueue.delete(file.path);
                            if (this.dirty.delete(file.path)) {
                                dirtyChanged = true;
                            }
                            if (fileState.tooLarge) {
                                summary.skipped++;
                            } else {
                                summary.removed++;
                            }
                        } else if (this.markDirtyPath(file.path)) {
                            dirtyChanged = true;
                            summary.markedDirty++;
                        }
                    } catch (error) {
                        this.plugin.log("Failed to inspect missing Memory index record", { path: file.path, error });
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

            const file = this.plugin.app.vault.getAbstractFileByPath(candidate.path);
            if (!file || !(file instanceof TFile) || !this.isEligible(file)) {
                summary.verificationChecked++;
                await this.runExclusive(async () => {
                    if (!this.isCurrentVerifyRecord(candidate)) return;
                    this.verifyQueue.delete(candidate.path);
                    if (this.index) {
                        await this.index.deleteFile(candidate.path);
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
            let fileState: { hash: string | null; tooLarge: boolean };
            summary.verificationChecked++;
            try {
                fileState = await this.computeFileHash(file);
            } catch (error) {
                summary.failed++;
                this.plugin.log("Could not verify Memory file hash", { path: candidate.path, error });
                continue;
            }

            if (fileState.tooLarge || !fileState.hash) {
                await this.runExclusive(async () => {
                    if (!this.isCurrentVerifyRecord(candidate)) return;
                    this.verifyQueue.delete(candidate.path);
                    if (this.index) {
                        await this.index.deleteFile(candidate.path);
                        await this.writeLocalIndexState();
                    }
                    if (this.clearDirtyIfStampMatches(candidate.path, dirtyStamp)) {
                        await this.persistDirtyJournal();
                    }
                });
                if (fileState.tooLarge) {
                    summary.skipped++;
                } else {
                    summary.removed++;
                }
                continue;
            }

            if (fileState.hash !== candidate.contentHash) {
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

            const verifiedHash = fileState.hash;
            await this.runExclusive(async () => {
                if (!this.isCurrentVerifyRecord(candidate)) return;
                if (!this.index) return;
                await this.index.updateFileMetadata({
                    path: file.path,
                    contentHash: verifiedHash,
                    mtime: file.stat.mtime,
                    size: file.stat.size,
                });
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
            new Notice("Old memory cache cleanup is available only after diagnostic status is ready.", 5000);
            return;
        }
        const stats = await this.index.getStats();
        if (stats.status !== "ready" || stats.chunkCount <= 0 || stats.lastErrorCode) {
            new Notice("Old memory cache was not cleaned because diagnostic status is not safely ready.", 5000);
            return;
        }
        const marker = this.marker;
        const profileSignature = this.profile ? getEmbeddingProfileSignature(this.profile) : "";
        if (!marker || marker.profileSignature !== profileSignature) {
            new Notice("Old memory cache was not cleaned because diagnostic state is not safely ready.", 5000);
            return;
        }
        const summary = await this.getLegacyJsonCacheSummary();
        if (summary.fileCount === 0) {
            new Notice("No old memory cache files found.", 3000);
            return;
        }

        const cleanupGeneration = this.stateGeneration;
        const confirmed = await confirmUserAction(this.plugin.app, {
            title: "Delete old Memory cache files?",
            message: `Delete ${summary.fileCount} old memory cache files (${formatBytes(summary.bytes)})? Notes will not be changed or deleted.`,
            confirmText: "Delete",
        });
        if (!confirmed) return;
        if (this.disposed || cleanupGeneration !== this.stateGeneration || !this.index || this.status !== "ready") {
            new Notice("Old memory cache was not cleaned because diagnostic state changed.", 5000);
            return;
        }

        for (const path of summary.paths) {
            await this.plugin.app.vault.adapter.remove(path);
        }
        await this.writeLocalIndexState(cleanupGeneration);
        new Notice(`Deleted ${summary.fileCount} old Memory cache files.`, 5000);
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

        const fileState = await this.computeFileHash(file);

        if (fileState.tooLarge) {
            await this.index.deleteFile(file.path);
            this.verifyQueue.delete(file.path);
            this.plugin.log(`Skipped VSS index for large file ${file.path}`);
            return 'skipped';
        }

        if (!fileState.hash) {
            await this.index.deleteFile(file.path);
            this.verifyQueue.delete(file.path);
            return 'removed';
        }

        const cached = await this.index.getFileRecord(file.path);
        if (cached && cached.contentHash === fileState.hash) {
            if (cached.mtime !== file.stat.mtime || cached.size !== file.stat.size) {
                await this.index.updateFileMetadata({
                    path: file.path,
                    contentHash: fileState.hash,
                    mtime: file.stat.mtime,
                    size: file.stat.size,
                });
                this.verifyQueue.delete(file.path);
                return 'metadata-synced';
            }
            this.verifyQueue.delete(file.path);
            return 'unchanged';
        }

        const prepared = await this.prepareFileVectors(file, fileState.hash, getEmbeddingsModel);
        if (prepared.chunks.length === 0) {
            await this.index.deleteFile(file.path);
            this.verifyQueue.delete(file.path);
            return 'removed';
        }

        await this.index.upsertFile({
            path: file.path,
            contentHash: fileState.hash,
            mtime: file.stat.mtime,
            size: file.stat.size,
        }, prepared.chunks, prepared.embeddings);
        this.verifyQueue.delete(file.path);
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
        }).catch((error) => {
            if (this.disposed || getErrorCode(error) === "vss-disposed") return [];
            throw error;
        });
    }

    async searchHybrid(prompt: string, options?: { ftsQueryOverride?: string | null }) {
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
        const ftsQuery = options?.ftsQueryOverride != null
            ? buildFtsQuery(options.ftsQueryOverride)
            : buildFtsQuery(prompt);
        const queryEmbedding = await embeddings.embedQuery(prompt);

        return this.runExclusive(async () => {
            if (this.disposed) return [];
            if (this.index) {
                await this.ensureIndex({ allowFallback: false, mode: "foreground" });
            }
            if (!this.index || this.status !== "ready" || !this.profile) return [];
            if (getEmbeddingProfileSignature(this.profile) !== profileSignature) return [];

            if (!(this.index instanceof SqliteVectorIndex)) {
                const results = await this.index.search(queryEmbedding, 8);
                return results.map(normalizeSearchResult);
            }

            const results = await this.index.searchHybrid(queryEmbedding, ftsQuery, 8, 12);
            return results.map(normalizeSearchResult);
        }).catch((error) => {
            if (this.disposed || getErrorCode(error) === "vss-disposed") return [];
            throw error;
        });
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

        const notesToCheck = this.plugin.getVSSFiles().length;
        const dirtyCount = this.dirty.size;
        const verificationPending = this.verifyQueue.size;
        const status = this.status;

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

    private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
        if (this.disposed) {
            return Promise.reject(createVssDisposedError());
        }
        const runOperation = () => {
            this.assertActive();
            return operation();
        };
        const run = this.operationQueue.then(runOperation, runOperation);
        this.operationQueue = run.then(() => undefined, () => undefined);
        return run;
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
                this.plugin.log(logMessage, error);
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
        const manifest = this.plugin.manifest as { id?: string } | undefined;
        return manifest?.id ?? "personal-assistant";
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
            await this.index.deleteFile(path);
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
            this.plugin.log("SQLite VSS index unavailable", error);
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
        // eslint-disable-next-line no-constant-condition
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
                    this.plugin.log("SQLite VSS recovery failed", error);
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
        contentHash: string,
        getEmbeddingsModel?: EmbeddingsModelProvider,
    ): Promise<{ chunks: VSSChunk[]; embeddings: number[][] }> {
        this.assertActive();
        const chunks = await this.prepareFileChunks(file, contentHash);
        const embeddings = await this.embedTexts(
            chunks.map(chunk => chunk.content),
            getEmbeddingsModel,
        );
        return { chunks, embeddings };
    }

    private async prepareFileChunks(file: TFile, contentHash: string): Promise<VSSChunk[]> {
        this.assertActive();
        const markdown = await this.plugin.app.vault.adapter.read(file.path);
        const { content } = this.aiUtils.getDocumentContent(markdown);
        const cleanedContent = this.aiUtils.cleanMarkdownContent(content);

        if (cleanedContent.trim().length === 0) {
            return [];
        }

        const splitter = new MarkdownTextSplitter({ chunkSize: 4000, chunkOverlap: 80 });
        const texts = await splitter.splitText(cleanedContent);
        return texts.map((text, index): VSSChunk => ({
            path: file.path,
            chunkIndex: index,
            content: text,
            contentHash,
            created: file.stat.ctime,
            lastModified: file.stat.mtime,
            metadata: {
                path: file.path,
                created: file.stat.ctime,
                lastModified: file.stat.mtime,
                contentHash,
                chunkIndex: index,
            },
        }));
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
        this.assertActive();
        if (file.stat.size > VSS_PARAMS.largeFileThreshold) {
            return { hash: null, tooLarge: true };
        }
        const markdown = await this.plugin.app.vault.adapter.read(file.path);
        const { content } = this.aiUtils.getDocumentContent(markdown);
        const cleanedContent = this.aiUtils.cleanMarkdownContent(content);
        if (!cleanedContent.trim()) return { hash: null, tooLarge: false };
        return { hash: await computeContentHash(cleanedContent), tooLarge: false };
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
            this.plugin.log("Error loading Memory dirty journal:", e);
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
            this.plugin.log("Error persisting Memory dirty journal:", error);
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
            this.plugin.log("Error persisting Memory local marker:", error);
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
            this.plugin.log("Failed to clear Memory local state during reset", error);
        }
    }

    private async getLegacyJsonCacheSummary(): Promise<LegacyJsonSummary> {
        const paths: string[] = [];
        let bytes = 0;
        const pendingFolders = [this.vssCacheDir];

        try {
            while (pendingFolders.length > 0) {
                const folder = pendingFolders.shift() as string;
                const listed = await this.plugin.app.vault.adapter.list(folder);
                for (const file of listed.files) {
                    if (!file.endsWith(".json") || file.endsWith(`/${VSS_PARAMS.dirtyJournal}`)) continue;
                    paths.push(file);
                    try {
                        const raw = await this.plugin.app.vault.adapter.read(file);
                        bytes += raw.length;
                    } catch {
                        // Ignore unreadable legacy cache files in size estimates.
                    }
                }
                pendingFolders.push(...listed.folders);
            }
        } catch (error) {
            if (!isMissingFileError(error)) {
                this.plugin.log("Could not list legacy VSS cache directory", error);
            }
        }

        return { fileCount: paths.length, bytes, paths };
    }

    private createEmbeddingProfile(): EmbeddingProfile {
        return {
            provider: this.plugin.settings.aiProvider,
            baseURL: this.plugin.settings.baseURL,
            model: this.plugin.settings.embeddingModelName,
            dimensions: VSS_DEFAULT_DIMENSIONS,
            distanceMetric: VSS_DEFAULT_DISTANCE_METRIC,
        };
    }

    private async refreshEmbeddingProfile(): Promise<{ profile: EmbeddingProfile; profileSignature: string }> {
        const profile = this.createEmbeddingProfile();
        const profileSignature = getEmbeddingProfileSignature(profile);
        const previousSignature = this.profile ? getEmbeddingProfileSignature(this.profile) : null;

        if (previousSignature && previousSignature !== profileSignature) {
            if (this.index) {
                await this.disposeIndex(this.index, "Failed to dispose stale VSS index");
                this.index = null;
            }
            this.status = "uninitialized";
        }

        this.profile = profile;
        return { profile, profileSignature };
    }

    private async requestPersistentStorage(): Promise<StoragePersistenceStatus> {
        return this.getStoragePersistenceStatus({ requestPersistence: true });
    }

    private async getStoragePersistenceStatus(options: { requestPersistence?: boolean } = {}): Promise<StoragePersistenceStatus> {
        const storage = globalThis.navigator?.storage;
        if (!storage) return { persisted: false };

        let persisted = false;
        try {
            persisted = typeof storage.persisted === "function" ? await storage.persisted() : false;
            if (!persisted && options.requestPersistence && typeof storage.persist === "function") {
                persisted = await storage.persist();
            }
        } catch (error) {
            this.plugin.log("Persistent storage status check failed", error);
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
        return getVaultStorageScope(this.plugin.app.vault.getName(), this.getVaultLocalPath());
    }

    private getVaultLocalPath(): string | undefined {
        const adapter = this.plugin.app.vault.adapter as {
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
        new Notice("Memory needs to be prepared again on this device.", 7000);
    }

    private isEligible(file: TFile) {
        if (file.extension !== 'md') return false;
        const exclude = (this.plugin.settings.vssCacheExcludePath || []).map(path => path.trim()).filter(Boolean);
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

function createDefaultVSSIndexStateStore(plugin: PluginManager): VSSIndexStateStore {
    const pluginLike = plugin as PluginManager & {
        createVSSIndexStateStore?: () => VSSIndexStateStore;
    };
    if (typeof pluginLike.createVSSIndexStateStore === "function") {
        return pluginLike.createVSSIndexStateStore();
    }
    const manifest = plugin.manifest as { id?: string } | undefined;
    const settings = plugin.settings as { statisticsVaultId?: string } | undefined;
    return createVSSIndexStateStore(
        plugin.app.vault,
        settings?.statisticsVaultId || "default-vault",
        manifest?.id ?? "personal-assistant",
    );
}

function createEmptyOperationSummary(): VSSOperationSummary {
    return {
        aborted: false,
        updated: 0,
        unchanged: 0,
        removed: 0,
        skipped: 0,
        failed: 0,
        metadataSynced: 0,
        verificationQueued: 0,
        verificationChecked: 0,
        dirtyConfirmed: 0,
    };
}

function createIndexId(): string {
    const cryptoApi = globalThis.crypto as (Crypto & { randomUUID?: () => string }) | undefined;
    if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
        return cryptoApi.randomUUID();
    }
    return `vss-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getProgressFileName(file: TFile): string {
    return file.name || file.path.split("/").pop() || file.path;
}

function getProgressPathName(path: string): string {
    return path.split("/").pop() || path;
}

function rotateByCursor<T>(items: T[], cursor: number): T[] {
    if (items.length === 0) return [];
    const normalized = Math.max(0, Math.min(items.length - 1, cursor % items.length));
    return normalized === 0
        ? items
        : items.slice(normalized).concat(items.slice(0, normalized));
}

function estimateEmbeddingTokensForTexts(texts: string[]): number {
    return texts.reduce((total, text) => total + estimateEmbeddingTokensForText(text), 0);
}

function estimateEmbeddingTokensForText(text: string): number {
    const cjkMatches = text.match(/[\u3400-\u9FFF\uF900-\uFAFF]/g);
    const cjkCount = cjkMatches?.length ?? 0;
    const nonCjkCount = Math.max(0, text.length - cjkCount);
    return Math.max(1, cjkCount + Math.ceil(nonCjkCount / 4));
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(
            () => reject(Object.assign(new Error(`VSS operation timed out after ${timeoutMs}ms.`), { code: "vss-timeout" })),
            timeoutMs,
        );
        promise.then(
            (value) => {
                clearTimeout(timeout);
                resolve(value);
            },
            (error) => {
                clearTimeout(timeout);
                reject(error);
            },
        );
    });
}

function createVssDisposedError(): Error {
    return Object.assign(new Error("VSS has been disposed."), { code: "vss-disposed" });
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
    return getErrorMessage(error).includes("Local memory storage is busy");
}

function getVssShutdownBarriers(): Map<string, VSSShutdownEntry> {
    const scope = globalThis as VSSGlobalScope;
    scope[VSS_GLOBAL_SHUTDOWN_KEY] ??= new Map<string, VSSShutdownEntry>();
    return scope[VSS_GLOBAL_SHUTDOWN_KEY];
}

function isRetryableEmbeddingError(error: unknown): boolean {
    const status = getErrorStatus(error);
    if (status === 408 || status === 429 || (status !== undefined && status >= 500)) {
        return true;
    }

    const message = getErrorMessage(error).toLowerCase();
    return [
        "rate limit",
        "too many requests",
        "requests rate limit exceeded",
        "you exceeded your current requests",
        "allocated quota exceeded",
        "you exceeded your current quota",
        "request rate increased too quickly",
        "timeout",
        "timed out",
        "network",
        "fetch failed",
        "econnreset",
        "econnaborted",
        "temporarily",
    ].some(fragment => message.includes(fragment));
}

function getErrorStatus(error: unknown): number | undefined {
    if (!isObject(error)) return undefined;
    const directStatus = numberValueOrUndefined(error.status) ?? numberValueOrUndefined(error.statusCode);
    if (directStatus !== undefined) return directStatus;
    const response = error.response;
    return isObject(response) ? numberValueOrUndefined(response.status) : undefined;
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (isObject(error) && typeof error.message === "string") return error.message;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

function numberValueOrUndefined(value: unknown): number | undefined {
    return typeof value === "number" ? value : undefined;
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

function estimateEmbeddingTokens(chunkCount: number): number {
    return chunkCount * 1_000;
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isMissingFileError(error: unknown): boolean {
    return error !== null
        && typeof error === "object"
        && "code" in error
        && (error as { code?: unknown }).code === "ENOENT";
}

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export { buildFtsQuery } from './vss/fts-query-builder';
