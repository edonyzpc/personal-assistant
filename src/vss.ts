/* Copyright 2023 edonyzpc */
import { Notice, TAbstractFile, TFile } from 'obsidian';
import { Document } from "@langchain/core/documents";
import { MarkdownTextSplitter } from '@langchain/textsplitters';

import { AIService } from './ai-services/service';
import { AIUtils, type CreateEmbeddingsOptions } from './ai-services/ai-utils';
import { PluginManager } from './plugin';
import { computeContentHash, selectFlushCandidates, DirtyTimestamps } from './vss-helpers';
import { MemoryVectorIndex } from './vss/memory-vector-index';
import { createInlineSqliteWorker, getInlineSqliteWasmUrl } from './vss/sqlite-inline-assets';
import { SqliteVectorIndex } from './vss/sqlite-vector-index';
import {
    ensureVSSIndexStateDir,
    getVSSDeviceId,
    readVSSManifest,
    readVSSMarker,
    removeVSSManifest,
    removeVSSMarker,
    shouldEnableMemoryFallback,
    writeVSSManifest,
    writeVSSMarker,
} from './vss/state';
import {
    estimateVectorMemoryBytes,
    getEmbeddingProfileSignature,
    VSS_DEFAULT_DIMENSIONS,
    VSS_DEFAULT_DISTANCE_METRIC,
    VSS_SCHEMA_VERSION,
    type EmbeddingProfile,
    type VectorIndex,
    type VectorIndexStatus,
    type VectorSearchResult,
    type VSSChunk,
    type VSSIndexManifest,
    type VSSIndexMarker,
    type VSSIndexStats,
} from './vss/types';
import type { MemoryMaintenancePlan } from './memory-manager';

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

export type VSSRefreshStatus = 'updated' | 'unchanged' | 'removed' | 'skipped';

export interface VSSOperationSummary {
    aborted: boolean;
    updated: number;
    unchanged: number;
    removed: number;
    skipped: number;
    failed: number;
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

export class VSS {
    private plugin: PluginManager;
    private vssCacheDir: string;
    private aiService: AIService;
    private aiUtils: AIUtils;
    private dirty = new Map<string, DirtyTimestamps>();
    private isFlushing = false;
    private operationQueue: Promise<void> = Promise.resolve();
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
    private manifest: VSSIndexManifest | null = null;
    private storageStatus: StoragePersistenceStatus = { persisted: false };
    private lastMissingIndexNoticeAt = 0;

    constructor(
        plugin: PluginManager,
        vssCacheDir: string,
    ) {
        this.plugin = plugin;
        this.vssCacheDir = vssCacheDir;
        this.aiService = new AIService(plugin);
        this.aiUtils = new AIUtils(plugin);
    }

    async initialize() {
        if (this.initialized) return;
        this.disposed = false;
        this.deviceId = getVSSDeviceId();
        this.profile = this.createEmbeddingProfile();
        this.storageStatus = await this.getStoragePersistenceStatus();
        await ensureVSSIndexStateDir(this.plugin.app.vault, this.deviceId);
        await this.loadDirtyJournal();
        this.marker = await readVSSMarker(this.plugin.app.vault, this.deviceId);
        this.manifest = await readVSSManifest(this.plugin.app.vault, this.deviceId);

        if (!this.marker) {
            this.status = "uninitialized";
            this.initialized = true;
            return;
        }

        await this.ensureIndex({ allowFallback: true });
        this.initialized = true;
    }

    dispose() {
        this.disposed = true;
        this.initialized = false;
        void this.index?.dispose().catch((error) => this.plugin.log("Failed to dispose VSS index", error));
        this.index = null;
        this.status = "uninitialized";
    }

    async markDirtyIfEligible(file: TAbstractFile): Promise<boolean> {
        if (!(file instanceof TFile)) return false;
        if (!this.isEligible(file)) return false;
        const changed = this.markDirtyPath(file.path);
        if (changed) {
            await this.persistDirtyJournal();
        }
        return changed;
    }

    async markDirtyIfIndexedMetadataChanged(file: TFile | null): Promise<boolean> {
        if (!(file instanceof TFile)) return false;
        if (!this.isEligible(file)) return false;
        await this.initialize();
        if (!this.index || (this.status !== "ready" && this.status !== "fallback")) {
            return false;
        }

        const record = await this.index.getFileRecord(file.path);
        if (record && record.mtime === file.stat.mtime && record.size === file.stat.size) {
            return false;
        }

        const changed = this.markDirtyPath(file.path);
        if (changed) {
            await this.persistDirtyJournal();
        }
        return changed;
    }

    async handleDelete(file: TFile): Promise<void> {
        await this.runExclusive(() => this.deleteIndexedPath(file.path));
        this.plugin.log("delete VSS entry", file.path);
    }

    async handleRename(file: TFile, oldPath: string): Promise<boolean> {
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
        await this.persistDirtyJournal();
    }

    async handleFileOpen(file: TFile | null): Promise<boolean> {
        return this.markDirtyIfIndexedMetadataChanged(file);
    }

    hasDirtyChanges(): boolean {
        return this.dirty.size > 0;
    }

    async canAutoMaintain(): Promise<boolean> {
        await this.initialize();
        if (this.index) {
            await this.ensureIndex({ allowFallback: true });
        }
        return await this.isDurableReady();
    }

    async flush(options: VSSFlushOptions = {}): Promise<VSSOperationSummary> {
        return this.runExclusive(() => this.flushUnlocked(options));
    }

    private async flushUnlocked(options: VSSFlushOptions = {}): Promise<VSSOperationSummary> {
        const summary = createEmptyOperationSummary();
        if (this.isFlushing) {
            summary.aborted = true;
            return summary;
        }
        await this.initialize();
        await this.ensureIndex({ allowFallback: false, allowMissingIndexRecovery: options.force === true });
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
                        dirtyChanged = true;
                        summary.removed++;
                    }
                }
            }

            for (const path of candidates) {
                if (!options.force && this.processedWindow.count >= VSS_PARAMS.maxPerMinute) break;

                const file = this.plugin.app.vault.getAbstractFileByPath(path);
                emitProgress("scanning", { currentFile: file instanceof TFile ? getProgressFileName(file) : getProgressPathName(path) });
                if (!file || !(file instanceof TFile)) {
                    this.dirty.delete(path);
                    dirtyChanged = true;
                    if (this.index) await this.index.deleteFile(path);
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
                if (status === 'removed') summary.removed++;
                if (status === 'skipped') summary.skipped++;
                if (status === 'updated') {
                    summary.updated++;
                    filesUpdated++;
                    this.processedWindow.count++;
                }
                filesDone++;
                emitProgress("writing", { currentFile: getProgressFileName(file) });

                this.dirty.delete(path);
                dirtyChanged = true;
            }
            if (dirtyChanged) {
                await this.persistDirtyJournal();
                await this.writeIndexStateFiles();
            }
            emitProgress("ready", { filesDone });
        } finally {
            this.isFlushing = false;
        }
        return summary;
    }

    async rebuildLocalIndex(options: VSSOperationOptions = {}): Promise<VSSOperationSummary> {
        return this.runExclusive(() => this.rebuildLocalIndexUnlocked(options));
    }

    private async rebuildLocalIndexUnlocked(options: VSSOperationOptions = {}): Promise<VSSOperationSummary> {
        await this.initialize();
        this.storageStatus = await this.requestPersistentStorage();
        if (!this.storageStatus.persisted && !options.silent) {
            new Notice("This device may need to prepare memory again later.", 7000);
        }
        await this.ensureIndex({ allowFallback: false });
        if (!this.index || this.status === "disabled") {
            throw new Error("Memory is unavailable.");
        }

        const index = this.index;
        await index.reset();
        this.status = "ready";
        this.dirty.clear();
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
        await this.writeIndexStateFiles();
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
        await this.runExclusive(() => this.resetLocalIndexUnlocked());
    }

    private async resetLocalIndexUnlocked(): Promise<void> {
        await this.initialize();
        if (this.index) {
            const index = this.index;
            await index.reset();
            await index.dispose().catch((error) => this.plugin.log("Failed to dispose reset VSS index", error));
            this.index = null;
        }
        await removeVSSMarker(this.plugin.app.vault, this.deviceId);
        await removeVSSManifest(this.plugin.app.vault, this.deviceId);
        this.marker = null;
        this.manifest = null;
        this.status = "uninitialized";
        new Notice("Local memory copy reset.", 3000);
    }

    async reconcileLocalFiles(options: VSSReconcileOptions = {}): Promise<VSSReconcileSummary> {
        return this.runExclusive(() => this.reconcileLocalFilesUnlocked(options));
    }

    private async reconcileLocalFilesUnlocked(options: VSSReconcileOptions = {}): Promise<VSSReconcileSummary> {
        const summary: VSSReconcileSummary = {
            ...createEmptyOperationSummary(),
            scanned: 0,
            markedDirty: 0,
            verified: 0,
            hasMore: false,
        };
        await this.initialize();
        await this.ensureIndex({ allowFallback: false });
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
                const record = records[this.recordReconcileCursor];
                this.recordReconcileCursor++;
                summary.scanned++;
                if (!fileByPath.has(record.path)) {
                    await index.deleteFile(record.path);
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
                const file = files[this.reconcileCursor];
                this.reconcileCursor++;
                summary.scanned++;
                const record = recordByPath.get(file.path);
                if (!record || record.mtime !== file.stat.mtime || record.size !== file.stat.size) {
                    if (this.markDirtyPath(file.path)) {
                        dirtyChanged = true;
                        summary.markedDirty++;
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
                const file = filesToVerify[index];
                this.hashVerifyCursor = (this.hashVerifyCursor + 1) % files.length;
                const record = recordByPath.get(file.path);
                if (!record || record.mtime !== file.stat.mtime || record.size !== file.stat.size || this.dirty.has(file.path)) {
                    continue;
                }
                summary.scanned++;
                summary.verified++;
                const fileState = await this.computeFileHash(file);
                if (fileState.tooLarge || !fileState.hash || fileState.hash !== record.contentHash) {
                    if (this.markDirtyPath(file.path)) {
                        dirtyChanged = true;
                        summary.markedDirty++;
                    }
                }
                await maybeYield();
            }
        }

        if (dirtyChanged) {
            await this.persistDirtyJournal();
        }
        if (indexChanged) {
            await this.writeIndexStateFiles();
        }
        return summary;
    }

    async cleanLegacyJsonCache(): Promise<void> {
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
        const marker = await readVSSMarker(this.plugin.app.vault, this.deviceId);
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

        const message = `Delete ${summary.fileCount} old memory cache files (${formatBytes(summary.bytes)})? Notes will not be deleted.`;
        const confirmed = typeof globalThis.confirm === "function" ? globalThis.confirm(message) : true;
        if (!confirmed) return;

        for (const path of summary.paths) {
            await this.plugin.app.vault.adapter.remove(path);
        }
        await this.writeIndexStateFiles();
        new Notice(`Deleted ${summary.fileCount} old memory cache files.`, 5000);
    }

    async cacheFileVectorStore(cacheFile: TFile): Promise<boolean> {
        return (await this.refreshFileCache(cacheFile)) === "updated";
    }

    async refreshFileCache(file: TFile, getEmbeddingsModel?: EmbeddingsModelProvider): Promise<VSSRefreshStatus> {
        return this.runExclusive(() => this.refreshFileCacheUnlocked(file, getEmbeddingsModel));
    }

    private async refreshFileCacheUnlocked(file: TFile, getEmbeddingsModel?: EmbeddingsModelProvider): Promise<VSSRefreshStatus> {
        await this.initialize();
        await this.ensureIndex({ allowFallback: false });
        if (!this.index || this.status === "disabled" || this.status === "missing-local-index" || this.status === "stale") {
            throw new Error("VSS index is unavailable.");
        }

        const fileState = await this.computeFileHash(file);

        if (fileState.tooLarge) {
            await this.index.deleteFile(file.path);
            this.plugin.log(`Skipped VSS index for large file ${file.path}`);
            return 'skipped';
        }

        if (!fileState.hash) {
            await this.index.deleteFile(file.path);
            return 'removed';
        }

        const cached = await this.index.getFileRecord(file.path);
        if (cached && cached.contentHash === fileState.hash) {
            return 'unchanged';
        }

        const prepared = await this.prepareFileVectors(file, fileState.hash, getEmbeddingsModel);
        if (prepared.chunks.length === 0) {
            await this.index.deleteFile(file.path);
            return 'removed';
        }

        await this.index.upsertFile({
            path: file.path,
            contentHash: fileState.hash,
            mtime: file.stat.mtime,
            size: file.stat.size,
        }, prepared.chunks, prepared.embeddings);
        return 'updated';
    }

    async loadVectorStore(_vssFiles: TFile[], _isDelete: boolean = false) {
        // Legacy no-op: the SQLite/WASM design does not load JSON vectors into memory.
    }

    async searchSimilarity(prompt: string) {
        await this.initialize();
        if (this.index) {
            await this.ensureIndex({ allowFallback: true });
        }
        if (!this.index || this.status === "uninitialized") {
            return [];
        }
        if (this.status === "missing-local-index") {
            this.showMissingIndexNotice();
            return [];
        }
        if (this.status !== "ready" && this.status !== "fallback") {
            return [];
        }

        const profile = this.profile ?? this.createEmbeddingProfile();
        const embeddings = await this.aiUtils.createEmbeddings(profile.dimensions);
        const queryEmbedding = await embeddings.embedQuery(prompt);
        const results = await this.index.search(queryEmbedding, 8);
        return results.map(normalizeSearchResult);
    }

    async getStats(): Promise<VSSIndexStats> {
        await this.initialize();
        if (this.index) {
            await this.ensureIndex({ allowFallback: true });
        }
        if (!this.index) {
            return {
                status: this.status,
                backend: "none",
                chunkCount: 0,
                fileCount: 0,
                fallbackMode: false,
                storagePersisted: this.storageStatus.persisted,
                storageUsage: this.storageStatus.usage,
                storageQuota: this.storageStatus.quota,
            };
        }
        const stats = await this.index.getStats();
        return {
            ...stats,
            status: this.status === "ready" || this.status === "fallback" ? stats.status : this.status,
            storagePersisted: this.storageStatus.persisted,
            storageUsage: this.storageStatus.usage,
            storageQuota: this.storageStatus.quota,
        };
    }

    async getMemoryReadiness(): Promise<MemoryMaintenancePlan> {
        await this.initialize();
        if (this.index) {
            await this.ensureIndex({ allowFallback: true });
        }

        const notesToCheck = this.plugin.getVSSFiles().length;
        const dirtyCount = this.dirty.size;
        const status = this.status;

        if ((status === "ready" || status === "fallback") && dirtyCount > 0) {
            return {
                reason: "changed-notes",
                action: "refresh",
                notesToCheck,
                notesLikelyToUpdate: dirtyCount,
                requiresApproval: true,
                canAnswerNow: true,
            };
        }

        if (status === "ready" || status === "fallback") {
            return {
                reason: "ready",
                action: "none",
                notesToCheck,
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
        const run = this.operationQueue.then(operation, operation);
        this.operationQueue = run.then(() => undefined, () => undefined);
        return run;
    }

    private markDirtyPath(path: string, now = Date.now()): boolean {
        const existing = this.dirty.get(path);
        const updated: DirtyTimestamps = existing
            ? { first: existing.first, last: now }
            : { first: now, last: now };
        if (existing && existing.last === updated.last) {
            return false;
        }
        this.dirty.set(path, updated);
        return true;
    }

    private async deleteIndexedPath(path: string): Promise<void> {
        await this.initialize();
        if (!await this.isDurableReady()) {
            if (path.endsWith(".md") && this.markDirtyPath(path)) {
                await this.persistDirtyJournal();
            }
            return;
        }

        const dirtyChanged = this.dirty.delete(path);
        if (this.index) {
            await this.index.deleteFile(path);
            await this.writeIndexStateFiles();
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

    private async ensureIndex(options: { allowFallback: boolean; allowMissingIndexRecovery?: boolean }): Promise<void> {
        const { profile, profileSignature } = await this.refreshEmbeddingProfile();

        if (this.index && (this.status === "ready" || this.status === "stale" || (this.status === "fallback" && options.allowFallback))) {
            return;
        }
        if (this.index && this.status === "fallback" && !options.allowFallback) {
            await this.index.dispose().catch((error) => this.plugin.log("Failed to dispose fallback VSS index", error));
            this.index = null;
            this.status = "uninitialized";
        }
        if (this.index && this.status === "missing-local-index") {
            if (options.allowMissingIndexRecovery) {
                this.status = "ready";
            }
            return;
        }

        const marker = this.marker ?? await readVSSMarker(this.plugin.app.vault, this.deviceId);

        const sqliteIndex = new SqliteVectorIndex({
            workerUrl: "inline:personal-assistant-vss-worker",
            wasmUrl: getInlineSqliteWasmUrl(),
            databaseName: this.getDatabaseName(),
            opfsDirectory: this.getOpfsDirectory(),
            legacyOpfsDirectory: VSS_LEGACY_OPFS_ROOT,
            opfsVfsName: this.getOpfsVfsName(),
            workerFactory: createInlineSqliteWorker,
        });

        try {
            const status = await sqliteIndex.initialize(profile);
            this.index = sqliteIndex;
            this.status = status;

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
            await sqliteIndex.dispose().catch(() => undefined);
            this.plugin.log("SQLite VSS index unavailable", error);
            if (!options.allowFallback) {
                this.index = null;
                this.status = "error";
                throw error;
            }
        }

        if (options.allowFallback) {
            await this.tryInitializeMemoryFallback(profileSignature, profile);
            return;
        }

        this.index = null;
        this.status = "disabled";
    }

    private async tryInitializeMemoryFallback(profileSignature: string, profile: EmbeddingProfile): Promise<void> {
        const manifest = this.manifest ?? await readVSSManifest(this.plugin.app.vault, this.deviceId);
        if (!manifest || manifest.profileSignature !== profileSignature || !shouldEnableMemoryFallback(manifest)) {
            this.index = null;
            this.status = "disabled";
            return;
        }

        const memoryIndex = new MemoryVectorIndex();
        await memoryIndex.initialize(profile);
        await this.loadLegacyJsonIntoMemoryIndex(memoryIndex);
        this.index = memoryIndex;
        this.status = "fallback";
    }

    private async loadLegacyJsonIntoMemoryIndex(memoryIndex: MemoryVectorIndex): Promise<void> {
        const paths = (await this.getLegacyJsonCacheSummary()).paths;
        for (const path of paths) {
            try {
                const raw = await this.plugin.app.vault.adapter.read(path);
                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed) || parsed.length === 0) continue;
                const chunks: VSSChunk[] = [];
                const embeddings: number[][] = [];
                for (let i = 0; i < parsed.length; i++) {
                    const entry = parsed[i];
                    if (!entry || typeof entry !== "object" || !Array.isArray(entry.embedding)) continue;
                    const metadata = isObject(entry.metadata) ? entry.metadata : {};
                    const filePath = typeof metadata.path === "string" ? metadata.path : path.replace(`${this.vssCacheDir}/`, "").replace(/\.json$/, "");
                    chunks.push({
                        path: filePath,
                        chunkIndex: i,
                        content: typeof entry.content === "string" ? entry.content : "",
                        contentHash: typeof metadata.contentHash === "string" ? metadata.contentHash : "",
                        created: numberValue(metadata.created),
                        lastModified: numberValue(metadata.lastModified),
                        metadata,
                    });
                    embeddings.push(entry.embedding);
                }
                if (chunks.length === 0) continue;
                await memoryIndex.upsertFile({
                    path: chunks[0].path,
                    contentHash: chunks[0].contentHash,
                    mtime: chunks[0].lastModified,
                    size: 0,
                }, chunks, embeddings);
            } catch (error) {
                this.plugin.log("Failed to load legacy VSS JSON fallback", { path, error });
            }
        }
    }

    private async prepareFileVectors(
        file: TFile,
        contentHash: string,
        getEmbeddingsModel?: EmbeddingsModelProvider,
    ): Promise<{ chunks: VSSChunk[]; embeddings: number[][] }> {
        const chunks = await this.prepareFileChunks(file, contentHash);
        const embeddings = await this.embedTexts(
            chunks.map(chunk => chunk.content),
            getEmbeddingsModel,
        );
        return { chunks, embeddings };
    }

    private async prepareFileChunks(file: TFile, contentHash: string): Promise<VSSChunk[]> {
        const markdown = await this.plugin.app.vault.adapter.read(file.path);
        const { content } = this.aiUtils.getDocumentContent(markdown);
        const cleanedContent = this.aiUtils.cleanMarkdownContent(content);

        if (cleanedContent.length === 0) {
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
            const batch = texts.slice(i, i + policy.maxBatchItems);
            embeddings.push(...await this.embedDocumentsWithRetry(batch, embeddingsModelProvider, policy));
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
            await this.waitForEmbeddingThrottle(texts, policy);
            try {
                const embeddingsModel = await getEmbeddingsModel();
                return await embeddingsModel.embedDocuments(texts);
            } catch (error) {
                lastError = error;
                if (!isRetryableEmbeddingError(error) || attempt >= policy.retryDelaysMs.length) {
                    throw error;
                }
                const retryDelayMs = policy.retryDelaysMs[attempt];
                onRetry?.(retryDelayMs);
                await sleep(retryDelayMs);
            }
        }
        throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }

    private async waitForEmbeddingThrottle(texts: string[], policy: EmbeddingBatchPolicy): Promise<void> {
        const now = Date.now();
        const delayMs = Math.max(0, this.nextEmbeddingRequestAt - now);
        if (delayMs > 0) {
            await sleep(delayMs);
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

        if (provider === "ollama") {
            return {
                maxBatchItems: 3,
                minRequestGapMs: 0,
                retryDelaysMs,
                createOptions: {
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
        const profile = this.profile ?? this.createEmbeddingProfile();
        return await this.aiUtils.createEmbeddings(profile.dimensions, options);
    }

    private async computeFileHash(file: TFile): Promise<{ hash: string | null; tooLarge: boolean }> {
        if (file.stat.size > VSS_PARAMS.largeFileThreshold) {
            return { hash: null, tooLarge: true };
        }
        const markdown = await this.plugin.app.vault.adapter.read(file.path);
        const { content } = this.aiUtils.getDocumentContent(markdown);
        const cleanedContent = this.aiUtils.cleanMarkdownContent(content);
        if (!cleanedContent) return { hash: null, tooLarge: false };
        return { hash: await computeContentHash(cleanedContent), tooLarge: false };
    }

    private async loadDirtyJournal() {
        const path = this.plugin.join(this.vssCacheDir, VSS_PARAMS.dirtyJournal);
        try {
            const raw = await this.plugin.app.vault.adapter.read(path);
            const parsed = JSON.parse(raw);
            Object.entries(parsed || {}).forEach(([p, ts]) => {
                if (typeof ts === 'number') {
                    this.dirty.set(p, { first: ts, last: ts });
                    return;
                }
                if (ts && typeof ts === 'object') {
                    const record = ts as Partial<DirtyTimestamps>;
                    const first = typeof record.first === 'number' ? record.first : undefined;
                    const last = typeof record.last === 'number' ? record.last : undefined;
                    if (first !== undefined && last !== undefined) {
                        this.dirty.set(p, { first, last });
                    } else if (first !== undefined) {
                        this.dirty.set(p, { first, last: first });
                    } else if (last !== undefined) {
                        this.dirty.set(p, { first: last, last });
                    }
                }
            });
        } catch (e) {
            if (!isMissingFileError(e)) {
                this.plugin.log("Error loading VSS dirty journal:", e);
            }
        }
    }

    private async persistDirtyJournal() {
        const path = this.plugin.join(this.vssCacheDir, VSS_PARAMS.dirtyJournal);
        await this.ensureLegacyCacheDir();
        const record = Object.fromEntries(this.dirty);
        await this.plugin.app.vault.adapter.write(path, JSON.stringify(record));
    }

    private async ensureLegacyCacheDir(): Promise<void> {
        if (!await this.plugin.app.vault.adapter.exists(this.vssCacheDir)) {
            await this.plugin.app.vault.adapter.mkdir(this.vssCacheDir);
        }
    }

    private async writeIndexStateFiles(): Promise<void> {
        if (!this.index || !this.profile) return;
        const stats = await this.index.getStats();
        this.storageStatus = await this.getStoragePersistenceStatus();
        const now = new Date().toISOString();
        const profileSignature = getEmbeddingProfileSignature(this.profile);
        const legacySummary = await this.getLegacyJsonCacheSummary();
        const previousMarker = this.marker?.profileSignature === profileSignature ? this.marker : null;
        const marker: VSSIndexMarker = {
            schemaVersion: VSS_SCHEMA_VERSION,
            deviceId: this.deviceId,
            indexId: previousMarker?.indexId ?? createIndexId(),
            profileSignature,
            backend: stats.backend,
            chunkCount: stats.chunkCount,
            fileCount: stats.fileCount,
            builtAt: previousMarker?.builtAt ?? now,
            lastVerifiedAt: now,
            storagePersisted: this.storageStatus.persisted,
            estimatedDbBytes: stats.estimatedDbBytes,
            estimatedEmbeddingTokens: estimateEmbeddingTokens(stats.chunkCount),
        };
        const manifest: VSSIndexManifest = {
            schemaVersion: VSS_SCHEMA_VERSION,
            deviceId: this.deviceId,
            profileSignature,
            fileCount: stats.fileCount,
            chunkCount: stats.chunkCount,
            estimatedMemoryBytes: estimateVectorMemoryBytes(stats.chunkCount, this.profile.dimensions),
            legacyJsonCacheBytes: legacySummary.bytes,
            updatedAt: now,
        };
        await writeVSSMarker(this.plugin.app.vault, marker);
        await writeVSSManifest(this.plugin.app.vault, manifest);
        this.marker = marker;
        this.manifest = manifest;
        if (this.status !== "fallback") {
            this.status = stats.status === "stale" ? "stale" : "ready";
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
                await this.index.dispose().catch((error) => this.plugin.log("Failed to dispose stale VSS index", error));
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

function createEmptyOperationSummary(): VSSOperationSummary {
    return {
        aborted: false,
        updated: 0,
        unchanged: 0,
        removed: 0,
        skipped: 0,
        failed: 0,
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

function numberValue(value: unknown): number {
    return typeof value === "number" ? value : Number(value ?? 0);
}
