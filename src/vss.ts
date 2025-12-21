/* Copyright 2023 edonyzpc */
import { TAbstractFile, TFile } from 'obsidian';
import { AIService } from './ai-services/service';
import { AIUtils } from './ai-services/ai-utils';
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { PluginManager } from './plugin';
import { computeContentHash, selectFlushCandidates, shouldRespectRateGap } from './vss-helpers';

const VSS_PARAMS = {
    quietWindow: 30 * 1000,
    maxDelay: 10 * 60 * 1000,
    flushInterval: 2 * 60 * 1000,
    rateGap: 3000,
    maxPerMinute: 5,
    startupMaxFiles: 1000,
    largeFileThreshold: 1_000_000,
    dirtyJournal: "dirty.json",
};

export class VSS {
    private plugin: PluginManager;
    private encryptedToken: string;
    private vssCacheDir: string;
    private vectorStore!: MemoryVectorStore;
    private aiService: AIService;
    private aiUtils: AIUtils;
    private dirty = new Map<string, number>();
    private flushIntervalId: ReturnType<typeof setInterval> | null = null;
    private isFlushing = false;
    private lastProcessedAt: number | null = null;
    private processedWindow = { count: 0, windowStart: 0 };
    private initialized = false;
    private lastActiveFile: TFile | null = null;

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
        await this.loadDirtyJournal();
        this.startFlushTimer();
        this.scheduleStartupScan();
        this.initialized = true;
    }

    async markDirtyIfEligible(file: TAbstractFile) {
        if (!(file instanceof TFile)) return;
        if (!this.isEligible(file)) return;
        this.dirty.set(file.path, Date.now());
        await this.persistDirtyJournal();
    }

    async handleDelete(file: TFile) {
        this.dirty.delete(file.path);
        await this.persistDirtyJournal();
        const vssFile = this.plugin.join(this.vssCacheDir, file.path + ".json");
        await this.plugin.app.vault.adapter.remove(vssFile);
        this.plugin.log("delete", vssFile);
        await this.loadVectorStore([file], true);
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

            for (const path of candidates) {
                if (!options.force && this.processedWindow.count >= VSS_PARAMS.maxPerMinute) break;

                if (!shouldRespectRateGap(this.lastProcessedAt, Date.now(), VSS_PARAMS.rateGap)) {
                    const waitMs = VSS_PARAMS.rateGap - (Date.now() - (this.lastProcessedAt as number));
                    await new Promise(res => setTimeout(res, waitMs));
                }

                const file = this.plugin.app.vault.getAbstractFileByPath(path);
                if (!file || !(file instanceof TFile)) {
                    this.dirty.delete(path);
                    await this.persistDirtyJournal();
                    continue;
                }

                const updated = await this.rebuildCacheIfNeeded(file);
                if (updated) {
                    this.processedWindow.count++;
                }
                this.lastProcessedAt = Date.now();

                if (updated || options.force) {
                    this.dirty.delete(path);
                }
                await this.persistDirtyJournal();
            }
        } finally {
            this.isFlushing = false;
        }
    }

    async cacheFileVectorStore(cacheFile: TFile): Promise<boolean> {
        return await this.aiService.vectorizeDocument(cacheFile, this.vssCacheDir);
    }

    async loadVectorStore(vssFiles: TFile[], isDelete: boolean = false) {
        if (!this.vectorStore) {
            const embeddings = await this.aiService['aiUtils'].createEmbeddings();
            this.vectorStore = new MemoryVectorStore(embeddings);
        }

        for (const f of vssFiles) {
            if (isDelete) {
                for (const v of this.vectorStore.memoryVectors) {
                    if (v.metadata.path === f.path) {
                        this.vectorStore.memoryVectors.remove(v);
                    }
                }
            } else {
                try {
                    const fpath = this.plugin.join(this.vssCacheDir, f.path + ".json")
                    const readStr = await this.plugin.app.vault.adapter.read(fpath);
                    const memoryVectors2 = JSON.parse(readStr);
                    for (const v of this.vectorStore.memoryVectors) {
                        if (v.metadata.path === f.path) {
                            this.vectorStore.memoryVectors.remove(v);
                        }
                    }
                    this.vectorStore.memoryVectors = this.vectorStore.memoryVectors.concat(memoryVectors2);
                } catch (e) {
                    console.error(e);
                }
            }
        }
    }

    async searchSimilarity(prompt: string) {
        return await this.aiService.searchSimilarDocuments(prompt, this.vectorStore);
    }

    private async rebuildCacheIfNeeded(file: TFile): Promise<boolean> {
        const cachePath = this.plugin.join(this.vssCacheDir, file.path + ".json");
        const currentHash = await this.computeFileHash(file);
        if (!currentHash) {
            return false;
        }
        const cachedHash = await this.readCachedHash(cachePath);

        if (cachedHash && cachedHash === currentHash) {
            return false;
        }

        const updated = await this.cacheFileVectorStore(file);
        if (updated) {
            await this.loadVectorStore([file]);
        }
        return updated;
    }

    private async computeFileHash(file: TFile): Promise<string | null> {
        if (file.stat.size > VSS_PARAMS.largeFileThreshold) {
            // 延后处理大文件
            return null;
        }
        const markdown = await this.plugin.app.vault.adapter.read(file.path);
        const { content } = this.aiUtils.getDocumentContent(markdown);
        const cleanedContent = this.aiUtils.cleanMarkdownContent(content);
        if (!cleanedContent) return null;
        return computeContentHash(cleanedContent);
    }

    private async readCachedHash(cachePath: string): Promise<string | null> {
        try {
            const cached = await this.plugin.app.vault.adapter.read(cachePath);
            const vectors = JSON.parse(cached);
            return vectors?.[0]?.metadata?.contentHash ?? null;
        } catch {
            return null;
        }
    }

    private startFlushTimer() {
        if (this.flushIntervalId) return;
        this.flushIntervalId = setInterval(() => {
            this.flush({ reason: "interval" });
        }, VSS_PARAMS.flushInterval);
    }

    private async loadDirtyJournal() {
        const path = this.plugin.join(this.vssCacheDir, VSS_PARAMS.dirtyJournal);
        try {
            const raw = await this.plugin.app.vault.adapter.read(path);
            const parsed = JSON.parse(raw);
            Object.entries(parsed || {}).forEach(([p, ts]) => {
                if (typeof ts === 'number') {
                    this.dirty.set(p, ts);
                }
            });
        } catch {
            // ignore if file not exist
        }
    }

    private async persistDirtyJournal() {
        const path = this.plugin.join(this.vssCacheDir, VSS_PARAMS.dirtyJournal);
        const record = Object.fromEntries(this.dirty);
        await this.plugin.app.vault.adapter.write(path, JSON.stringify(record));
    }

    private scheduleStartupScan() {
        // 处理上次残留的 dirty
        setTimeout(() => {
            this.flush({ limit: VSS_PARAMS.startupMaxFiles, reason: "startup-dirty" });
        }, 0);

        // 延迟兜底扫描
        setTimeout(() => {
            this.scanAndQueueOutdated(VSS_PARAMS.startupMaxFiles);
        }, 5000);
    }

    private async scanAndQueueOutdated(limit: number) {
        const files = this.plugin.getVSSFiles();
        let checked = 0;
        for (const file of files) {
            if (checked >= limit) break;
            if (this.dirty.has(file.path)) continue;
            const cachePath = this.plugin.join(this.vssCacheDir, file.path + ".json");
            const cacheExist = await this.plugin.app.vault.adapter.exists(cachePath);
            if (!cacheExist) {
                this.dirty.set(file.path, Date.now() - VSS_PARAMS.maxDelay);
                checked++;
                continue;
            }
            const hash = await this.computeFileHash(file);
            if (!hash) continue;
            const cachedHash = await this.readCachedHash(cachePath);
            if (!cachedHash || cachedHash !== hash) {
                this.dirty.set(file.path, Date.now() - VSS_PARAMS.maxDelay);
                checked++;
            }
        }
        await this.persistDirtyJournal();
        await this.flush({ limit, reason: "startup-scan" });
    }

    private isEligible(file: TFile) {
        if (file.extension !== 'md') return false;
        const exclude = this.plugin.settings.vssCacheExcludePath || [];
        for (const path of exclude) {
            if (path && file.path.startsWith(path)) {
                return false;
            }
        }
        return true;
    }
}
