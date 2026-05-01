/* Copyright 2023 edonyzpc */
import { TAbstractFile, TFile } from 'obsidian';
import { AIService } from './ai-services/service';
import { AIUtils } from './ai-services/ai-utils';
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { PluginManager } from './plugin';
import { computeContentHash, selectFlushCandidates, shouldRespectRateGap, DirtyTimestamps } from './vss-helpers';

const VSS_PARAMS = {
    quietWindow: 30 * 1000,
    maxDelay: 10 * 60 * 1000,
    flushInterval: 2 * 60 * 1000,
    rateGap: 3000,
    maxPerMinute: 5,
    cacheExistsConcurrency: 50,
    startupMaxFiles: 1000,
    largeFileThreshold: 1_000_000,
    dirtyJournal: "dirty.json",
};

export type VSSRefreshStatus = 'updated' | 'unchanged' | 'removed' | 'skipped';

export class VSS {
    private plugin: PluginManager;
    private encryptedToken: string;
    private vssCacheDir: string;
    private vectorStore!: MemoryVectorStore;
    private aiService: AIService;
    private aiUtils: AIUtils;
    private dirty = new Map<string, DirtyTimestamps>();
    private flushIntervalId: ReturnType<typeof setInterval> | null = null;
    private isFlushing = false;
    private lastProcessedAt: number | null = null;
    private processedWindow = { count: 0, windowStart: 0 };
    private initialized = false;
    private lastActiveFile: TFile | null = null;
    private startupTimeoutIds: ReturnType<typeof setTimeout>[] = [];
    private disposed = false;

    constructor(
        plugin: PluginManager,
        vssCacheDir: string,
    ) {
        this.plugin = plugin;
        this.encryptedToken = this.plugin.settings.apiToken;
        this.vssCacheDir = vssCacheDir;
        this.aiService = new AIService(plugin);
        this.aiUtils = new AIUtils(plugin);
    }

    async initialize() {
        if (this.initialized) return;
        this.disposed = false;
        await this.loadDirtyJournal();
        await this.loadExistingVectorStore();
        this.startFlushTimer();
        this.scheduleStartupScan();
        this.initialized = true;
    }

    dispose() {
        this.disposed = true;
        if (this.flushIntervalId) {
            clearInterval(this.flushIntervalId);
            this.flushIntervalId = null;
        }
        for (const timeoutId of this.startupTimeoutIds) {
            clearTimeout(timeoutId);
        }
        this.startupTimeoutIds = [];
        this.initialized = false;
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
        await this.removeCacheForFile(file);
        this.plugin.log("delete", this.plugin.join(this.vssCacheDir, file.path + ".json"));
    }

    async handleActiveLeafChange() {
        if (this.lastActiveFile) {
            await this.flush({ reason: "leaf-change", limit: VSS_PARAMS.maxPerMinute });
        }
    }

    async handleFileOpen(file: TFile | null) {
        if (file instanceof TFile && this.isEligible(file)) {
            this.lastActiveFile = file;
            await this.flush({ reason: "file-open", limit: VSS_PARAMS.maxPerMinute });
        }
    }

    async flush(options: { force?: boolean; reason?: string; limit?: number } = {}) {
        if (this.isFlushing) return;
        this.isFlushing = true;
        try {
            const now = Date.now();
            if (now - this.processedWindow.windowStart > 60 * 1000) {
                this.processedWindow = { count: 0, windowStart: now };
            }

            const quiet = options.force ? 0 : VSS_PARAMS.quietWindow;
            const limit = options.limit ?? VSS_PARAMS.maxPerMinute;
            const candidates = selectFlushCandidates(this.dirty, now, quiet, VSS_PARAMS.maxDelay, limit);
            let dirtyChanged = false;

            for (const path of candidates) {
                if (!options.force && this.processedWindow.count >= VSS_PARAMS.maxPerMinute) break;

                let loopNow = Date.now();
                const last = this.lastProcessedAt;
                if (!shouldRespectRateGap(last, loopNow, VSS_PARAMS.rateGap) && last !== null) {
                    const waitMs = VSS_PARAMS.rateGap - (loopNow - last);
                    await new Promise(res => setTimeout(res, waitMs));
                    loopNow = Date.now();
                }

                const file = this.plugin.app.vault.getAbstractFileByPath(path);
                if (!file || !(file instanceof TFile)) {
                    this.dirty.delete(path);
                    dirtyChanged = true;
                    continue;
                }

                let status: VSSRefreshStatus;
                try {
                    status = await this.refreshFileCache(file);
                } catch (e) {
                    this.plugin.log("Failed to refresh VSS cache", { path, error: e });
                    continue;
                }

                if (status === 'updated') {
                    this.processedWindow.count++;
                }
                this.lastProcessedAt = loopNow;

                // remove from dirty queue after inspection to avoid repeated work
                this.dirty.delete(path);
                dirtyChanged = true;
            }
            if (dirtyChanged) {
                await this.persistDirtyJournal();
            }
        } finally {
            this.isFlushing = false;
        }
    }

    async cacheFileVectorStore(cacheFile: TFile): Promise<boolean> {
        return await this.aiService.vectorizeDocument(cacheFile, this.vssCacheDir);
    }

    async refreshFileCache(file: TFile): Promise<VSSRefreshStatus> {
        const cachePath = this.plugin.join(this.vssCacheDir, file.path + ".json");
        const fileState = await this.computeFileHash(file);

        if (fileState.tooLarge) {
            await this.removeCacheForFile(file);
            this.plugin.log(`Skipped VSS cache for large file ${file.path}`);
            return 'skipped';
        }

        if (!fileState.hash) {
            const removed = await this.removeCacheForFile(file);
            return removed ? 'removed' : 'unchanged';
        }

        const cachedHash = await this.readCachedHash(cachePath);
        if (cachedHash && cachedHash === fileState.hash) {
            return 'unchanged';
        }

        const updated = await this.cacheFileVectorStore(file);
        if (updated) {
            await this.loadVectorStore([file]);
            return 'updated';
        }

        return 'skipped';
    }

    async loadVectorStore(vssFiles: TFile[], isDelete: boolean = false) {
        if (!this.vectorStore) {
            const embeddings = await this.aiService['aiUtils'].createEmbeddings();
            this.vectorStore = new MemoryVectorStore(embeddings);
        }

        for (const f of vssFiles) {
            if (isDelete) {
                this.vectorStore.memoryVectors = this.vectorStore.memoryVectors.filter(
                    (v) => v.metadata.path !== f.path
                );
            } else {
                try {
                    const fpath = this.plugin.join(this.vssCacheDir, f.path + ".json")
                    const readStr = await this.plugin.app.vault.adapter.read(fpath);
                    const memoryVectors2 = JSON.parse(readStr);
                    this.vectorStore.memoryVectors = this.vectorStore.memoryVectors
                        .filter((v) => v.metadata.path !== f.path)
                        .concat(memoryVectors2);
                } catch (e) {
                    console.error(e);
                }
            }
        }
    }

    async searchSimilarity(prompt: string) {
        if (!this.vectorStore) {
            return [];
        }
        return await this.aiService.searchSimilarDocuments(prompt, this.vectorStore);
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

    private async readCachedHash(cachePath: string): Promise<string | null> {
        try {
            const cached = await this.plugin.app.vault.adapter.read(cachePath);
            const vectors = JSON.parse(cached);
            return vectors?.[0]?.metadata?.contentHash ?? null;
        } catch (e) {
            if (e.code !== 'ENOENT') {
                this.plugin.log(`Could not read VSS cache hash for ${cachePath}:`, e);
            }
            return null;
        }
    }

    private startFlushTimer() {
        if (this.flushIntervalId) return;
        this.flushIntervalId = setInterval(() => {
            void this.flush({ reason: "interval" }).catch((e) => {
                this.plugin.log("Error flushing VSS cache:", e);
            });
        }, VSS_PARAMS.flushInterval);
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
            // It's okay if the file doesn't exist on first run.
            // We should log other errors.
            if (e.code !== 'ENOENT') {
                this.plugin.log("Error loading VSS dirty journal:", e);
            }
        }
    }

    private async persistDirtyJournal() {
        const path = this.plugin.join(this.vssCacheDir, VSS_PARAMS.dirtyJournal);
        const record = Object.fromEntries(this.dirty);
        await this.plugin.app.vault.adapter.write(path, JSON.stringify(record));
    }

    private scheduleStartupScan() {
        // 处理上次残留的 dirty
        const dirtyTimeoutId = setTimeout(() => {
            if (this.disposed) return;
            void this.flush({ limit: VSS_PARAMS.startupMaxFiles, reason: "startup-dirty" }).catch((e) => {
                this.plugin.log("Error flushing startup VSS dirty queue:", e);
            });
        }, 0);
        this.startupTimeoutIds.push(dirtyTimeoutId);

        // 延迟兜底扫描
        const scanTimeoutId = setTimeout(() => {
            if (this.disposed) return;
            void this.scanAndQueueOutdated(VSS_PARAMS.startupMaxFiles).catch((e) => {
                this.plugin.log("Error scanning VSS cache on startup:", e);
            });
        }, 5000);
        this.startupTimeoutIds.push(scanTimeoutId);
    }

    private async scanAndQueueOutdated(limit: number) {
        if (this.disposed) return;
        const files = this.plugin.getVSSFiles();
        let checked = 0;
        for (const file of files) {
            if (checked >= limit) break;
            if (this.dirty.has(file.path)) continue;
            const cachePath = this.plugin.join(this.vssCacheDir, file.path + ".json");
            const cacheExist = await this.plugin.app.vault.adapter.exists(cachePath);
            if (!cacheExist) {
                const ts = Date.now() - VSS_PARAMS.maxDelay;
                this.dirty.set(file.path, { first: ts, last: ts });
                checked++;
                continue;
            }
            const { hash, tooLarge } = await this.computeFileHash(file);
            if (tooLarge) {
                await this.removeCacheForFile(file);
                continue;
            }
            if (!hash) {
                await this.removeCacheForFile(file);
                continue;
            }
            const cachedHash = await this.readCachedHash(cachePath);
            if (!cachedHash || cachedHash !== hash) {
                const ts = Date.now() - VSS_PARAMS.maxDelay;
                this.dirty.set(file.path, { first: ts, last: ts });
                checked++;
            }
        }
        await this.persistDirtyJournal();
        await this.flush({ limit, reason: "startup-scan" });
    }

    private async loadExistingVectorStore() {
        const vssFiles = this.plugin.getVSSFiles();
        const filesByCachePath = new Map<string, TFile>();
        for (const file of vssFiles) {
            const cachePath = this.plugin.join(this.vssCacheDir, file.path + ".json");
            filesByCachePath.set(cachePath, file);
        }

        const cachedPaths = await this.listCacheFilePaths();
        const filesWithCache = cachedPaths
            ? Array.from(cachedPaths, (cachePath) => filesByCachePath.get(cachePath)).filter((file): file is TFile => file instanceof TFile)
            : await this.findFilesWithCacheByExists(vssFiles);

        if (filesWithCache.length > 0) {
            await this.loadVectorStore(filesWithCache);
        }
    }

    private async listCacheFilePaths(): Promise<Set<string> | null> {
        const cacheFiles = new Set<string>();
        const pendingFolders = [this.vssCacheDir];

        try {
            while (pendingFolders.length > 0) {
                const folder = pendingFolders.shift() as string;
                const listed = await this.plugin.app.vault.adapter.list(folder);
                for (const file of listed.files) {
                    if (file.endsWith(".json")) {
                        cacheFiles.add(file);
                    }
                }
                pendingFolders.push(...listed.folders);
            }
            return cacheFiles;
        } catch (e) {
            this.plugin.log("Could not list VSS cache directory; falling back to cache path checks:", e);
            return null;
        }
    }

    private async findFilesWithCacheByExists(vssFiles: TFile[]): Promise<TFile[]> {
        const filesWithCache: TFile[] = [];
        for (let i = 0; i < vssFiles.length; i += VSS_PARAMS.cacheExistsConcurrency) {
            const chunk = vssFiles.slice(i, i + VSS_PARAMS.cacheExistsConcurrency);
            const hits = await Promise.all(chunk.map(async (file) => {
                const cachePath = this.plugin.join(this.vssCacheDir, file.path + ".json");
                return await this.plugin.app.vault.adapter.exists(cachePath) ? file : null;
            }));
            filesWithCache.push(...hits.filter((file): file is TFile => file instanceof TFile));
        }
        return filesWithCache;
    }

    private async removeCacheForFile(file: TFile): Promise<boolean> {
        let removed = false;
        const vssFile = this.plugin.join(this.vssCacheDir, file.path + ".json");
        if (await this.plugin.app.vault.adapter.exists(vssFile)) {
            await this.plugin.app.vault.adapter.remove(vssFile);
            removed = true;
        }
        if (this.vectorStore) {
            const before = this.vectorStore.memoryVectors.length;
            this.vectorStore.memoryVectors = this.vectorStore.memoryVectors.filter(
                (v) => v.metadata.path !== file.path
            );
            removed = removed || before !== this.vectorStore.memoryVectors.length;
        }
        return removed;
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
