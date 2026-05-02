/* Copyright 2023 edonyzpc */
import { Notice, TAbstractFile, TFile } from 'obsidian';
import { Document } from "@langchain/core/documents";
import { MarkdownTextSplitter } from '@langchain/textsplitters';

import { AIService } from './ai-services/service';
import { AIUtils } from './ai-services/ai-utils';
import { PluginManager } from './plugin';
import { computeContentHash, selectFlushCandidates, shouldRespectRateGap, DirtyTimestamps } from './vss-helpers';
import { MemoryVectorIndex } from './vss/memory-vector-index';
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
    rateGap: 3000,
    maxPerMinute: 5,
    largeFileThreshold: 1_000_000,
    dirtyJournal: "dirty.json",
    embedBatchSize: 3,
    embedBatchDelayMs: 3000,
};

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

export class VSS {
    private plugin: PluginManager;
    private vssCacheDir: string;
    private aiService: AIService;
    private aiUtils: AIUtils;
    private dirty = new Map<string, DirtyTimestamps>();
    private isFlushing = false;
    private lastProcessedAt: number | null = null;
    private processedWindow = { count: 0, windowStart: 0 };
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

    async markDirtyIfEligible(file: TAbstractFile) {
        if (!(file instanceof TFile)) return;
        if (!this.isEligible(file)) return;
        const now = Date.now();
        const existing = this.dirty.get(file.path);
        const updated: DirtyTimestamps = existing
            ? { first: existing.first, last: now }
            : { first: now, last: now };
        this.dirty.set(file.path, updated);
        await this.persistDirtyJournal();
    }

    async handleDelete(file: TFile) {
        this.dirty.delete(file.path);
        await this.persistDirtyJournal();
        await this.initialize();
        if (this.index) {
            await this.index.deleteFile(file.path);
            await this.writeIndexStateFiles();
        }
        this.plugin.log("delete VSS entry", file.path);
    }

    async handleActiveLeafChange() {
        await this.persistDirtyJournal();
    }

    async handleFileOpen(file: TFile | null) {
        if (file instanceof TFile && this.isEligible(file)) {
            await this.markDirtyIfEligible(file);
        }
    }

    async flush(options: { force?: boolean; reason?: string; limit?: number; silent?: boolean } = {}): Promise<VSSOperationSummary> {
        const summary = createEmptyOperationSummary();
        if (this.isFlushing) {
            summary.aborted = true;
            return summary;
        }
        await this.initialize();
        await this.ensureIndex({ allowFallback: false, allowMissingIndexRecovery: true });
        if (!this.index || this.status === "disabled" || this.status === "missing-local-index" || this.status === "stale") {
            if (!options.silent) {
                new Notice("Memory is not ready. Prepare memory first.", 5000);
            }
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
                if (!file || !(file instanceof TFile)) {
                    this.dirty.delete(path);
                    dirtyChanged = true;
                    if (this.index) await this.index.deleteFile(path);
                    summary.removed++;
                    continue;
                }

                let status: VSSRefreshStatus;
                try {
                    status = await this.refreshFileCache(file);
                } catch (e) {
                    summary.failed++;
                    this.plugin.log("Failed to refresh VSS index", { path, error: e });
                    continue;
                }

                if (status === 'unchanged') summary.unchanged++;
                if (status === 'removed') summary.removed++;
                if (status === 'skipped') summary.skipped++;
                if (status === 'updated') {
                    summary.updated++;
                    this.processedWindow.count++;
                }

                this.dirty.delete(path);
                dirtyChanged = true;
            }
            if (dirtyChanged) {
                await this.persistDirtyJournal();
                await this.writeIndexStateFiles();
            }
        } finally {
            this.isFlushing = false;
        }
        return summary;
    }

    async rebuildLocalIndex(options: { silent?: boolean } = {}): Promise<VSSOperationSummary> {
        await this.initialize();
        this.storageStatus = await this.requestPersistentStorage();
        if (!this.storageStatus.persisted && !options.silent) {
            new Notice("This device may need to prepare memory again later.", 7000);
        }
        await this.ensureIndex({ allowFallback: false });
        if (!this.index || this.status === "disabled") {
            throw new Error("Memory is unavailable.");
        }

        await this.index.reset();
        this.status = "ready";
        this.dirty.clear();
        const files = this.plugin.getVSSFiles();
        const summary = createEmptyOperationSummary();
        summary.storagePersisted = this.storageStatus.persisted;

        for (const file of files) {
            try {
                const status = await this.refreshFileCache(file);
                if (status === "updated") summary.updated++;
                if (status === "unchanged") summary.unchanged++;
                if (status === "removed") summary.removed++;
                if (status === "skipped") summary.skipped++;
            } catch (error) {
                summary.failed++;
                this.plugin.log("Failed to rebuild VSS file", { path: file.path, error });
            }
        }

        await this.persistDirtyJournal();
        await this.writeIndexStateFiles();
        if (!options.silent) {
            new Notice(summary.failed > 0 ? "Memory is ready, but some notes were skipped." : "Memory is ready. Your notes were not changed.", 5000);
        }
        return summary;
    }

    async refreshLocalIndex(options: { silent?: boolean } = {}): Promise<VSSOperationSummary> {
        const summary = await this.flush({ force: true, reason: "manual-refresh", limit: Number.MAX_SAFE_INTEGER, silent: options.silent });
        if (!summary.aborted && !options.silent) {
            new Notice(summary.failed > 0 ? "Memory was updated, but some notes were skipped." : "Memory is ready. Your notes were not changed.", 3000);
        }
        return summary;
    }

    async resetLocalIndex(): Promise<void> {
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

    async refreshFileCache(file: TFile): Promise<VSSRefreshStatus> {
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

        const prepared = await this.prepareFileVectors(file, fileState.hash);
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

    private async ensureIndex(options: { allowFallback: boolean; allowMissingIndexRecovery?: boolean }): Promise<void> {
        const { profile, profileSignature } = await this.refreshEmbeddingProfile();

        if (this.index && (this.status === "ready" || this.status === "fallback" || this.status === "stale")) {
            return;
        }
        if (this.index && this.status === "missing-local-index") {
            if (options.allowMissingIndexRecovery) {
                this.status = "ready";
            }
            return;
        }

        const marker = this.marker ?? await readVSSMarker(this.plugin.app.vault, this.deviceId);

        const sqliteIndex = new SqliteVectorIndex({
            workerUrl: this.getPluginAssetUrl("vss-sqlite-worker.js"),
            wasmUrl: this.getPluginAssetUrl("sqlite3.wasm"),
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

    private async prepareFileVectors(file: TFile, contentHash: string): Promise<{ chunks: VSSChunk[]; embeddings: number[][] }> {
        const profile = this.profile ?? this.createEmbeddingProfile();
        const markdown = await this.plugin.app.vault.adapter.read(file.path);
        const { content } = this.aiUtils.getDocumentContent(markdown);
        const cleanedContent = this.aiUtils.cleanMarkdownContent(content);

        if (cleanedContent.length === 0) {
            return { chunks: [], embeddings: [] };
        }

        const splitter = new MarkdownTextSplitter({ chunkSize: 4000, chunkOverlap: 80 });
        const texts = await splitter.splitText(cleanedContent);
        const chunks = texts.map((text, index): VSSChunk => ({
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

        const embeddingsModel = await this.aiUtils.createEmbeddings(profile.dimensions);
        const embeddings: number[][] = [];
        for (let i = 0; i < texts.length; i += VSS_PARAMS.embedBatchSize) {
            const batch = texts.slice(i, i + VSS_PARAMS.embedBatchSize);
            await this.waitForEmbeddingRateGap();
            embeddings.push(...await embeddingsModel.embedDocuments(batch));
            if (i + VSS_PARAMS.embedBatchSize < texts.length) {
                await new Promise(resolve => setTimeout(resolve, VSS_PARAMS.embedBatchDelayMs));
            }
        }
        return { chunks, embeddings };
    }

    private async waitForEmbeddingRateGap(): Promise<void> {
        const now = Date.now();
        const last = this.lastProcessedAt;
        if (last !== null && !shouldRespectRateGap(last, now, VSS_PARAMS.rateGap)) {
            await new Promise(resolve => setTimeout(resolve, VSS_PARAMS.rateGap - (now - last)));
        }
        this.lastProcessedAt = Date.now();
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

    private getPluginAssetUrl(filename: string): string {
        const manifestDir = this.plugin.manifest.dir;
        const path = manifestDir ? this.plugin.join(manifestDir, filename) : filename;
        const adapter = this.plugin.app.vault.adapter as typeof this.plugin.app.vault.adapter & {
            getResourcePath?: (path: string) => string;
        };
        return adapter.getResourcePath?.(path) ?? path;
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
