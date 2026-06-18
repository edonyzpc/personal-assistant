import { Platform, TFile, debounce, moment as obsidianMoment, type Debouncer, type Vault, type Workspace } from "obsidian";
import type {
    ActivityCounts,
    FileStat,
    ModifiedFiles,
    SnapshotCounts,
    StatsDashboardData,
    StatsDeviceShard,
} from "./stats-types";
import {
    createEmptyDashboardData,
    createStatsShard,
    emptyActivityCounts,
    emptySnapshotCounts,
} from "./stats-store";
import { createStatsRepository, type StatsRepository, type StatsRepositoryBundle } from "./stats-repository";
import {
    getCharacterCount,
    getSentenceCount,
    getPageCount,
    getWordCount,
    getCitationCount,
    getFootnoteCount,
    cleanComments,
} from "./stats-utils";
import type { FileCountCacheEntry, StatsLocalStore } from "./stats-local-store";
import { SchemaIntegrityError } from "./stats-local-store";
import { clearPlatformTimeout, setPlatformTimeout, type PlatformTimeoutHandle } from "../platform-dom";
import type { StatsHost } from "./StatsHost";

const moment = obsidianMoment as unknown as () => { format: (format: string) => string };

type TextProvider = () => string;

type PendingTextChange = {
    filePath: string;
    currentText: string;
    previousText?: string;
};

type CancelCheck = () => boolean;

const SAMPLE_SIZE = 5;
const SAMPLE_DEVIATION_THRESHOLD = 0.05;
const CACHE_SIZE_RATIO_THRESHOLD = 1.5;
// Per-file sampling only fires when the cache is big enough for it to be
// statistically meaningful — sampling 1 of 1 file just doubles I/O for no
// drift-detection power.
const SAMPLE_MIN_CACHE_SIZE = 5;
type TimeoutHandle = PlatformTimeoutHandle;

export function getStatsWriteDelayMs(isMobile: boolean): number {
    return isMobile ? 3000 : 1500;
}

export function getStatsSnapshotRefreshDelayMs(isMobile: boolean): number {
    return isMobile ? 30000 : 5000;
}

export function combineActivityCounts(base: ActivityCounts, session: ActivityCounts): ActivityCounts {
    return {
        words: base.words + session.words,
        characters: base.characters + session.characters,
        sentences: base.sentences + session.sentences,
        pages: Number((base.pages + session.pages).toFixed(1)),
        footnotes: base.footnotes + session.footnotes,
        citations: base.citations + session.citations,
    };
}

export default class StatsManager {
    private vault: Vault;
    private workspace: Workspace;
    private host: StatsHost;
    private store: StatsRepository;
    private fileCountStore: StatsLocalStore;
    private modifiedFiles: ModifiedFiles = {};
    private baseActivity: ActivityCounts = emptyActivityCounts();
    private today: string;
    private currentShard: StatsDeviceShard | null = null;
    private initialized = false;
    private pendingChanges: PendingTextChange[] = [];
    private pendingWrite: Promise<void> | null = null;
    private writeGeneration = 0;
    private persistedWriteGeneration = 0;
    private stateGeneration = 0;
    private snapshotRefreshTimer: TimeoutHandle | null = null;
    private isDisposed = false;
    private ready: Promise<void>;
    private dirtyFileCountPaths = new Set<string>();
    private pendingCacheDeletes = new Set<string>();
    private pendingCachePuts = new Map<string, FileCountCacheEntry>();
    private fileCountCacheMap = new Map<string, FileCountCacheEntry>();
    private fileCountCacheReady = false;
    private fileCountCacheUnavailable = false;
    private sampleValidated = false;
    private fileCountMutationGeneration = 0;
    public debounceChange: Debouncer<[filePath: string | undefined, currentText: TextProvider, previousText?: TextProvider], Promise<void>>;
    private debounceWrite: Debouncer<[], Promise<void>>;

    constructor(host: StatsHost) {
        this.vault = host.app.vault;
        this.workspace = host.app.workspace;
        this.host = host;
        this.today = moment().format("YYYY-MM-DD");
        const bundle = this.createStore(this.host.settings.statisticsSyncEnabled);
        this.store = bundle.repository;
        this.fileCountStore = bundle.fileCountStore;
        this.debounceChange = debounce(
            (filePath: string | undefined, currentText: TextProvider, previousText?: TextProvider) =>
                this.change(filePath, currentText, previousText),
            50,
            false
        );
        this.debounceWrite = debounce(
            () => this.writeCurrentShard(),
            getStatsWriteDelayMs(Platform.isMobile),
            true
        );
        this.host.registerEvent(
            this.vault.on("rename", (newFile, oldPath) => {
                this.invalidateDashboardCacheForPath(newFile.path);
                this.invalidateDashboardCacheForPath(oldPath);
                if (Object.prototype.hasOwnProperty.call(this.modifiedFiles, oldPath)) {
                    const content = this.modifiedFiles[oldPath];
                    delete this.modifiedFiles[oldPath];
                    this.modifiedFiles[newFile.path] = content;
                }
                if (isTFileLike(newFile) && this.handleRenameForFileCountCache(newFile, oldPath)) {
                    this.scheduleSnapshotRefresh(getStatsSnapshotRefreshDelayMs(Platform.isMobile));
                }
            })
        );

        this.host.registerEvent(
            this.vault.on("delete", (deletedFile) => {
                this.invalidateDashboardCacheForPath(deletedFile.path);
                if (Object.prototype.hasOwnProperty.call(this.modifiedFiles, deletedFile.path)) {
                    delete this.modifiedFiles[deletedFile.path];
                }
                if (this.handleDeleteForFileCountCache(deletedFile.path)) {
                    this.scheduleSnapshotRefresh(getStatsSnapshotRefreshDelayMs(Platform.isMobile));
                }
            })
        );

        this.host.registerEvent(
            this.vault.on("create", (createdFile) => {
                this.invalidateDashboardCacheForPath(createdFile.path);
                if (isTFileLike(createdFile) && this.handleCreateForFileCountCache(createdFile)) {
                    this.scheduleSnapshotRefresh(getStatsSnapshotRefreshDelayMs(Platform.isMobile));
                }
            })
        );

        this.host.registerEvent(
            this.vault.on("modify", (modifiedFile) => {
                this.invalidateDashboardCacheForPath(modifiedFile.path);
                if (this.handleModifyForFileCountCache(modifiedFile.path)) {
                    this.scheduleSnapshotRefresh(getStatsSnapshotRefreshDelayMs(Platform.isMobile));
                }
            })
        );

        this.ready = this.initialize();
    }

    async getDashboardData(): Promise<StatsDashboardData> {
        try {
            await this.ready;
            return await this.store.readDashboardData();
        } catch (error) {
            return {
                ...createEmptyDashboardData(this.store.getDeviceId()),
                errors: [{
                    path: this.host.settings.statsPath,
                    message: error instanceof Error ? error.message : String(error),
                }],
            };
        }
    }

    async update(): Promise<void> {
        await this.flush();
    }

    async setStatisticsSyncEnabled(enabled: boolean): Promise<void> {
        await this.flushLocalOnly();
        const previousStore = this.store;
        const previousFileCountStore = this.fileCountStore;
        const previousInitialized = this.initialized;
        const previousCurrentShard = this.currentShard;
        const previousBaseActivity = { ...this.baseActivity };
        const previousReady = this.ready;
        this.stateGeneration += 1;
        const bundle = this.createStore(enabled);
        this.store = bundle.repository;
        this.fileCountStore = bundle.fileCountStore;
        this.initialized = false;
        this.currentShard = null;
        this.baseActivity = emptyActivityCounts();
        this.ready = this.initialize();
        try {
            await this.ready;
            if (enabled) {
                await this.store.checkpointSync();
            }
        } catch (error) {
            this.stateGeneration += 1;
            this.store = previousStore;
            this.fileCountStore = previousFileCountStore;
            this.initialized = previousInitialized;
            this.currentShard = previousCurrentShard;
            this.baseActivity = previousBaseActivity;
            this.ready = previousReady;
            throw error;
        }
    }

    async updateToday(): Promise<void> {
        await this.ensureToday();
        if (!this.currentShard) return;
        await this.clearFileCountCacheState();
        const snapshot = await this.calcSnapshotIncremental();
        if (!snapshot) return;
        this.currentShard.snapshot = snapshot;
        this.currentShard.updatedAt = new Date().toISOString();
        await this.writeCurrentShardNow();
        await this.checkpointSync();
    }

    public async change(filePath: string | undefined, currentText: TextProvider, previousText?: TextProvider): Promise<void> {
        if (!filePath) {
            return;
        }

        const change = {
            filePath,
            currentText: currentText(),
            previousText: previousText?.(),
        };

        if (!this.initialized) {
            this.queuePendingChange(change);
            return;
        }

        await this.applyChange(change);
    }

    private async applyChange(change: PendingTextChange): Promise<void> {
        await this.ensureToday();

        if (!this.currentShard) {
            return;
        }

        const currentCounts = this.countText(change.currentText);
        const previousCounts = change.previousText === undefined ? currentCounts : this.countText(change.previousText);
        const modFiles = this.modifiedFiles;
        let previousSnapshotCounts = previousCounts;

        if (Object.prototype.hasOwnProperty.call(modFiles, change.filePath)) {
            previousSnapshotCounts = this.getCurrentCounts(modFiles[change.filePath]);
            modFiles[change.filePath].words.current = currentCounts.words;
            modFiles[change.filePath].characters.current = currentCounts.characters;
            modFiles[change.filePath].sentences.current = currentCounts.sentences;
            modFiles[change.filePath].footnotes.current = currentCounts.footnotes;
            modFiles[change.filePath].citations.current = currentCounts.citations;
            modFiles[change.filePath].pages.current = currentCounts.pages;
        } else {
            modFiles[change.filePath] = this.createFileStat(previousCounts, currentCounts);
        }

        this.currentShard.activity = combineActivityCounts(
            this.baseActivity,
            this.calculateActivity(modFiles)
        );
        this.currentShard.snapshot = this.applySnapshotDelta(
            this.currentShard.snapshot,
            previousSnapshotCounts,
            currentCounts
        );
        this.currentShard.updatedAt = new Date().toISOString();
        this.scheduleWrite();

        // Mark the file as dirty so the next incremental snapshot re-reads it from disk
        // and refreshes mtime/size. Do NOT write to fileCountCache here: file.stat is
        // refreshed asynchronously by Obsidian after editor flush, so its mtime/size may
        // still be stale relative to change.currentText, producing a poisoned cache entry.
        this.handleModifyForFileCountCache(change.filePath);
    }

    public async recalcTotals(): Promise<void> {
        await this.ready;
        await this.ensureToday();
        if (!this.currentShard) return;
        await this.clearFileCountCacheState();
        const snapshot = await this.calcSnapshotIncremental();
        if (!snapshot) return;
        this.currentShard.snapshot = snapshot;
        this.currentShard.updatedAt = new Date().toISOString();
        await this.writeCurrentShardNow();
        await this.checkpointSync();
    }

    public async flush(): Promise<void> {
        await this.flushLocalOnly();
        await this.checkpointSync();
    }

    private async flushLocalOnly(): Promise<void> {
        const pendingChange = this.debounceChange.run();
        if (pendingChange) await pendingChange;

        await this.ready;

        const pendingWrite = this.debounceWrite.run();
        if (pendingWrite) await pendingWrite;
        if (this.pendingWrite) await this.pendingWrite;
        if (this.hasUnpersistedWrite()) await this.writeCurrentShard();
    }

    public dispose(): void {
        this.isDisposed = true;
        if (this.snapshotRefreshTimer) {
            clearStatsTimeout(this.snapshotRefreshTimer);
            this.snapshotRefreshTimer = null;
        }
        this.debounceChange.cancel();
        this.debounceWrite.cancel();
    }

    public getDailyWords(): number {
        return this.currentShard?.activity.words ?? 0;
    }

    public getDailyCharacters(): number {
        return this.currentShard?.activity.characters ?? 0;
    }

    public getDailySentences(): number {
        return this.currentShard?.activity.sentences ?? 0;
    }

    public getDailyFootnotes(): number {
        return this.currentShard?.activity.footnotes ?? 0;
    }

    public getDailyCitations(): number {
        return this.currentShard?.activity.citations ?? 0;
    }

    public getDailyPages(): number {
        return this.currentShard?.activity.pages ?? 0;
    }

    public getTotalFiles(): number {
        return this.vault.getMarkdownFiles().length;
    }

    public async getTotalWords(): Promise<number> {
        return (await this.getSnapshot()).totalWords;
    }

    public async getTotalCharacters(): Promise<number> {
        return (await this.getSnapshot()).totalCharacters;
    }

    public async getTotalSentences(): Promise<number> {
        return (await this.getSnapshot()).totalSentences;
    }

    public async getTotalFootnotes(): Promise<number> {
        return (await this.getSnapshot()).totalFootnotes;
    }

    public async getTotalCitations(): Promise<number> {
        return (await this.getSnapshot()).totalCitations;
    }

    public async getTotalPages(): Promise<number> {
        return (await this.getSnapshot()).totalPages;
    }

    private async initialize(): Promise<void> {
        await this.store.initialize();
        await this.ensureToday();
        this.initialized = true;
        await this.flushPendingChanges();
        this.scheduleSnapshotRefresh();
    }

    private async ensureToday(): Promise<void> {
        const currentDate = moment().format("YYYY-MM-DD");
        if (this.today !== currentDate) {
            await this.flushCurrentShardBeforeRollover();
            this.today = currentDate;
            this.modifiedFiles = {};
            this.baseActivity = emptyActivityCounts();
            this.currentShard = null;
        }

        if (this.currentShard) return;

        let existing: StatsDeviceShard | null = null;
        try {
            existing = await this.store.readOwnShard(this.today);
        } catch (error) {
            this.host.log("Skipping statistics writes for a damaged shard", error);
            this.currentShard = null;
            return;
        }

        this.currentShard = existing ?? createStatsShard(
            this.today,
            this.store.getDeviceId(),
            emptyActivityCounts(),
            await this.getInitialSnapshot(),
        );
        this.baseActivity = { ...this.currentShard.activity };

        if (!existing) {
            this.scheduleWrite();
            this.scheduleSnapshotRefresh();
        }
    }

    private async getInitialSnapshot(): Promise<SnapshotCounts> {
        const latestSnapshot = await this.store.readLatestSnapshot();
        if (!latestSnapshot) return emptySnapshotCounts();
        return {
            ...latestSnapshot,
            files: this.getTotalFiles(),
        };
    }

    private invalidateDashboardCacheForPath(path: string): void {
        if (this.store.isStatsStorePath(path)) {
            this.store.invalidateDashboardCache();
        }
    }

    private countText(text: string): ActivityCounts {
        const countableText = this.host.settings.countComments ? text : cleanComments(text);
        return {
            words: getWordCount(countableText),
            characters: getCharacterCount(countableText),
            sentences: getSentenceCount(countableText),
            pages: getPageCount(countableText, 300),
            footnotes: getFootnoteCount(countableText),
            citations: getCitationCount(countableText),
        };
    }

    private createFileStat(initial: ActivityCounts, current: ActivityCounts): FileStat {
        return {
            words: { initial: initial.words, current: current.words },
            characters: { initial: initial.characters, current: current.characters },
            sentences: { initial: initial.sentences, current: current.sentences },
            footnotes: { initial: initial.footnotes, current: current.footnotes },
            citations: { initial: initial.citations, current: current.citations },
            pages: { initial: initial.pages, current: current.pages },
        };
    }

    private queuePendingChange(change: PendingTextChange): void {
        const existing = this.pendingChanges.find((pending) => pending.filePath === change.filePath);
        if (existing) {
            existing.currentText = change.currentText;
            return;
        }
        this.pendingChanges.push(change);
    }

    private async flushPendingChanges(): Promise<void> {
        const changes = this.pendingChanges;
        this.pendingChanges = [];
        for (const change of changes) {
            await this.applyChange(change);
        }
    }

    private scheduleWrite(): void {
        this.writeGeneration += 1;
        if (this.isDisposed) return;
        this.debounceWrite();
    }

    private async writeCurrentShardNow(): Promise<void> {
        this.debounceWrite.cancel();
        await this.writeCurrentShard();
    }

    private async writeCurrentShard(): Promise<void> {
        if (!this.currentShard) return;
        const generation = this.writeGeneration;
        const write = this.store.writeOwnShard(this.currentShard);
        this.pendingWrite = write;
        try {
            await write;
            this.persistedWriteGeneration = Math.max(this.persistedWriteGeneration, generation);
            await this.checkpointSync();
        } finally {
            if (this.pendingWrite === write) {
                this.pendingWrite = null;
            }
        }
    }

    private async flushCurrentShardBeforeRollover(): Promise<void> {
        this.debounceWrite.cancel();
        if (this.pendingWrite) await this.pendingWrite;
        if (this.hasUnpersistedWrite()) {
            await this.writeCurrentShard();
        }
    }

    private hasUnpersistedWrite(): boolean {
        return this.writeGeneration > this.persistedWriteGeneration;
    }

    private async checkpointSync(): Promise<void> {
        if (!this.host.settings.statisticsSyncEnabled) return;
        try {
            await this.store.checkpointSync();
        } catch (error) {
            this.host.log("Failed to sync statistics history", error);
        }
    }

    private createStore(syncEnabled: boolean): StatsRepositoryBundle {
        return createStatsRepository(this.vault, {
            legacyStatsPath: this.host.settings.statsPath,
            vaultId: this.host.settings.statisticsVaultId,
            syncEnabled,
        });
    }

    private scheduleSnapshotRefresh(delayMs = 3000): void {
        if (this.isDisposed) return;
        if (this.snapshotRefreshTimer) return;
        this.snapshotRefreshTimer = setStatsTimeout(() => {
            this.snapshotRefreshTimer = null;
            void this.refreshSnapshotInBackground();
        }, delayMs);
    }

    private async refreshSnapshotInBackground(): Promise<void> {
        try {
            const generation = this.stateGeneration;
            if (this.isDisposed) return;
            await this.ensureToday();
            if (this.isDisposed || generation !== this.stateGeneration || !this.currentShard) return;
            const shard = this.currentShard;
            const snapshot = await this.calcSnapshotIncremental(() => this.isDisposed || generation !== this.stateGeneration);
            if (!snapshot) return;
            if (this.isDisposed || generation !== this.stateGeneration || this.currentShard !== shard) return;
            shard.snapshot = snapshot;
            shard.updatedAt = new Date().toISOString();
            this.scheduleWrite();
        } catch (error) {
            if (!this.isDisposed) {
                this.host.log("Failed to refresh statistics snapshot", error);
            }
        }
    }

    private getCurrentCounts(fileStat: FileStat): ActivityCounts {
        return {
            words: fileStat.words.current,
            characters: fileStat.characters.current,
            sentences: fileStat.sentences.current,
            pages: fileStat.pages.current,
            footnotes: fileStat.footnotes.current,
            citations: fileStat.citations.current,
        };
    }

    private calculateActivity(modFiles: ModifiedFiles): ActivityCounts {
        const activity = Object.values(modFiles).reduce((counts, file) => {
            counts.words += Math.max(0, file.words.current - file.words.initial);
            counts.characters += Math.max(0, file.characters.current - file.characters.initial);
            counts.sentences += Math.max(0, file.sentences.current - file.sentences.initial);
            counts.pages += Math.max(0, file.pages.current - file.pages.initial);
            counts.footnotes += Math.max(0, file.footnotes.current - file.footnotes.initial);
            counts.citations += Math.max(0, file.citations.current - file.citations.initial);
            return counts;
        }, emptyActivityCounts());

        activity.pages = Number(activity.pages.toFixed(1));
        return activity;
    }

    private async getSnapshot(): Promise<SnapshotCounts> {
        await this.ready;
        await this.ensureToday();
        return this.currentShard?.snapshot ?? emptySnapshotCounts();
    }

    private applySnapshotDelta(snapshot: SnapshotCounts, previous: ActivityCounts, current: ActivityCounts): SnapshotCounts {
        return {
            totalWords: Math.max(0, snapshot.totalWords + current.words - previous.words),
            totalCharacters: Math.max(0, snapshot.totalCharacters + current.characters - previous.characters),
            totalSentences: Math.max(0, snapshot.totalSentences + current.sentences - previous.sentences),
            totalFootnotes: Math.max(0, snapshot.totalFootnotes + current.footnotes - previous.footnotes),
            totalCitations: Math.max(0, snapshot.totalCitations + current.citations - previous.citations),
            totalPages: Number(Math.max(0, snapshot.totalPages + current.pages - previous.pages).toFixed(1)),
            files: this.getTotalFiles(),
        };
    }

    private handleModifyForFileCountCache(path: string): boolean {
        if (!isMarkdownPath(path)) return false;
        this.fileCountMutationGeneration += 1;
        this.fileCountCacheMap.delete(path);
        this.pendingCachePuts.delete(path);
        this.dirtyFileCountPaths.add(path);
        return true;
    }

    private handleCreateForFileCountCache(file: TFile): boolean {
        if (!isMarkdownPath(file.path)) return false;
        this.fileCountMutationGeneration += 1;
        this.dirtyFileCountPaths.add(file.path);
        return true;
    }

    private handleDeleteForFileCountCache(path: string): boolean {
        if (!isMarkdownPath(path)) return false;
        this.fileCountMutationGeneration += 1;
        this.fileCountCacheMap.delete(path);
        this.pendingCachePuts.delete(path);
        this.dirtyFileCountPaths.delete(path);
        this.pendingCacheDeletes.add(path);
        return true;
    }

    private handleRenameForFileCountCache(newFile: TFile, oldPath: string): boolean {
        const oldWasMd = isMarkdownPath(oldPath);
        const newIsMd = isMarkdownPath(newFile.path);
        if (!oldWasMd && !newIsMd) return false;
        this.fileCountMutationGeneration += 1;

        const oldEntry = oldWasMd ? this.fileCountCacheMap.get(oldPath) : undefined;
        if (oldWasMd) {
            this.fileCountCacheMap.delete(oldPath);
            this.pendingCachePuts.delete(oldPath);
            this.dirtyFileCountPaths.delete(oldPath);
            this.pendingCacheDeletes.add(oldPath);
        }
        if (!newIsMd) return true;

        if (oldEntry) {
            const movedEntry: FileCountCacheEntry = { ...oldEntry, path: newFile.path };
            this.fileCountCacheMap.set(newFile.path, movedEntry);
            this.pendingCachePuts.set(newFile.path, movedEntry);
            this.pendingCacheDeletes.delete(newFile.path);
        } else {
            this.dirtyFileCountPaths.add(newFile.path);
        }
        return true;
    }

    private async clearFileCountCacheState(): Promise<void> {
        this.fileCountCacheMap.clear();
        this.dirtyFileCountPaths.clear();
        this.pendingCacheDeletes.clear();
        this.pendingCachePuts.clear();
        this.fileCountCacheReady = false;
        this.sampleValidated = false;
        if (this.fileCountCacheUnavailable) return;
        try {
            await this.fileCountStore.clearFileCountCache();
        } catch (error) {
            this.host.log("Failed to clear file count cache", error);
            this.fileCountCacheUnavailable = true;
        }
    }

    private async loadFileCountCacheIfNeeded(): Promise<boolean> {
        if (this.fileCountCacheReady) return true;
        if (this.fileCountCacheUnavailable) return false;
        try {
            const entries = await this.fileCountStore.getAllFileCountEntries();
            const loaded = new Map<string, FileCountCacheEntry>();
            for (const entry of entries) {
                loaded.set(entry.path, entry);
            }
            // Vault events may have mutated the in-memory map while loading; reconcile by
            // preferring any pre-existing in-memory entries / deletions.
            for (const [path, entry] of this.fileCountCacheMap.entries()) {
                loaded.set(path, entry);
            }
            for (const path of this.pendingCacheDeletes) {
                loaded.delete(path);
            }
            this.fileCountCacheMap = loaded;
            this.fileCountCacheReady = true;
            return true;
        } catch (error) {
            if (error instanceof SchemaIntegrityError) {
                this.host.log("Statistics file count cache schema incompatible; disabling incremental snapshot.", error);
            } else {
                this.host.log("Failed to load file count cache", error);
            }
            this.fileCountCacheUnavailable = true;
            return false;
        }
    }

    private async validateCacheIntegritySample(shouldCancel: CancelCheck): Promise<boolean> {
        const vaultFiles = this.vault.getMarkdownFiles();
        const cacheSize = this.fileCountCacheMap.size;
        if (cacheSize === 0) return true;
        if (vaultFiles.length === 0) return false;

        const ratio = Math.max(vaultFiles.length, cacheSize) / Math.max(1, Math.min(vaultFiles.length, cacheSize));
        if (ratio > CACHE_SIZE_RATIO_THRESHOLD) return false;
        if (cacheSize < SAMPLE_MIN_CACHE_SIZE) return true;

        const hits: TFile[] = [];
        for (const file of vaultFiles) {
            const cached = this.fileCountCacheMap.get(file.path);
            if (cached && cached.mtime === getFileMtime(file) && cached.size === getFileSize(file)) {
                hits.push(file);
            }
        }
        if (hits.length === 0) return true;

        const sample = pickRandomSample(hits, SAMPLE_SIZE);
        for (const file of sample) {
            if (shouldCancel()) return true;
            const cached = this.fileCountCacheMap.get(file.path);
            if (!cached) continue;
            const text = await this.vault.cachedRead(file);
            if (shouldCancel()) return true;
            const counts = this.countText(text);
            if (!isWithinSampleTolerance(cached.wordCount, counts.words)) {
                return false;
            }
        }
        return true;
    }

    private async calcSnapshotIncremental(shouldCancel: CancelCheck = () => false): Promise<SnapshotCounts | null> {
        const mutationGeneration = this.fileCountMutationGeneration;
        const shouldAbort = () => shouldCancel() || mutationGeneration !== this.fileCountMutationGeneration;
        const loaded = await this.loadFileCountCacheIfNeeded();
        if (shouldAbort()) return null;

        if (!loaded) {
            return this.calcSnapshot(shouldAbort);
        }

        if (!this.sampleValidated) {
            const sampleOk = await this.validateCacheIntegritySample(shouldAbort);
            if (shouldAbort()) return null;
            if (!sampleOk) {
                await this.clearFileCountCacheState();
                return this.calcSnapshotIncremental(shouldCancel);
            }
            this.sampleValidated = true;
        }

        const BATCH_SIZE = Platform.isMobile ? 20 : 50;
        const YIELD_MS = Platform.isMobile ? 16 : 50;

        const totals = emptySnapshotCounts();
        const needsCounting: TFile[] = [];
        const files = this.vault.getMarkdownFiles();
        const cacheView = new Map(this.fileCountCacheMap);

        for (const file of files) {
            const cached = cacheView.get(file.path);
            if (cached
                && cached.mtime === getFileMtime(file)
                && cached.size === getFileSize(file)
                && !this.dirtyFileCountPaths.has(file.path)) {
                accumulateFromCacheEntry(totals, cached);
                cacheView.delete(file.path);
            } else {
                needsCounting.push(file);
                cacheView.delete(file.path);
            }
        }
        const stalePaths = Array.from(cacheView.keys());

        const newEntries: FileCountCacheEntry[] = [];
        let processed = 0;
        for (const file of needsCounting) {
            if (shouldAbort()) return null;
            const text = await this.vault.cachedRead(file);
            if (shouldAbort()) return null;
            const counts = this.countText(text);
            accumulateFromCounts(totals, counts);
            const entry = buildFileCountEntry(file, counts);
            newEntries.push(entry);
            this.fileCountCacheMap.set(file.path, entry);
            this.dirtyFileCountPaths.delete(file.path);
            this.pendingCachePuts.delete(file.path);

            processed++;
            if (processed % BATCH_SIZE === 0) {
                await sleep(YIELD_MS);
                if (shouldAbort()) return null;
            }
        }
        if (shouldAbort()) return null;

        const renamePuts = Array.from(this.pendingCachePuts.values()).filter((entry) => {
            // Skip entries that were already covered by newEntries to avoid duplicate writes.
            return !newEntries.some((fresh) => fresh.path === entry.path);
        });
        this.pendingCachePuts.clear();
        const pendingDeletes = Array.from(this.pendingCacheDeletes);
        this.pendingCacheDeletes.clear();
        for (const path of stalePaths) {
            this.fileCountCacheMap.delete(path);
        }
        for (const path of pendingDeletes) {
            this.fileCountCacheMap.delete(path);
        }

        if (!this.fileCountCacheUnavailable) {
            try {
                const toPut = [...newEntries, ...renamePuts];
                if (toPut.length > 0) {
                    await this.fileCountStore.putFileCountEntries(toPut);
                }
                const toDelete = uniqueStrings([...stalePaths, ...pendingDeletes]);
                if (toDelete.length > 0) {
                    await this.fileCountStore.deleteFileCountEntries(toDelete);
                }
            } catch (error) {
                this.host.log("Failed to persist file count cache", error);
            }
        }

        totals.files = this.getTotalFiles();
        totals.totalPages = Number(totals.totalPages.toFixed(1));
        return totals;
    }

    private async calcSnapshot(): Promise<SnapshotCounts>;
    private async calcSnapshot(shouldCancel: CancelCheck): Promise<SnapshotCounts | null>;
    private async calcSnapshot(shouldCancel: CancelCheck = () => false): Promise<SnapshotCounts | null> {
        const BATCH_SIZE = Platform.isMobile ? 20 : 50;
        const YIELD_MS = Platform.isMobile ? 16 : 50;
        const totals = emptySnapshotCounts();
        const files = this.vault.getFiles();

        let processed = 0;
        for (const file of files) {
            if (shouldCancel()) return null;
            if (file.extension !== "md") continue;
            const text = await this.vault.cachedRead(file);
            if (shouldCancel()) return null;
            const counts = this.countText(text);
            accumulateFromCounts(totals, counts);
            processed++;
            if (processed % BATCH_SIZE === 0) {
                await sleep(YIELD_MS);
                if (shouldCancel()) return null;
            }
        }

        totals.files = this.getTotalFiles();
        totals.totalPages = Number(totals.totalPages.toFixed(1));
        return totals;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setStatsTimeout(resolve, ms);
    });
}

function setStatsTimeout(callback: () => void, ms: number): TimeoutHandle {
    return setPlatformTimeout(callback, ms);
}

function clearStatsTimeout(timeoutId: TimeoutHandle): void {
    clearPlatformTimeout(timeoutId);
}

function isMarkdownPath(path: string): boolean {
    return path.toLowerCase().endsWith(".md");
}

function isTFileLike(file: unknown): file is TFile {
    if (typeof TFile === "function") return file instanceof TFile;
    return Boolean(
        file
        && typeof file === "object"
        && typeof (file as { path?: unknown }).path === "string"
        && typeof (file as { extension?: unknown }).extension === "string"
    );
}

function getFileMtime(file: TFile): number {
    return file.stat?.mtime ?? 0;
}

function getFileSize(file: TFile): number {
    return file.stat?.size ?? 0;
}

function buildFileCountEntry(file: TFile, counts: ActivityCounts): FileCountCacheEntry {
    return {
        path: file.path,
        mtime: getFileMtime(file),
        size: getFileSize(file),
        wordCount: counts.words,
        charCount: counts.characters,
        sentenceCount: counts.sentences,
        pageCount: counts.pages,
        footnoteCount: counts.footnotes,
        citationCount: counts.citations,
    };
}

function accumulateFromCacheEntry(totals: SnapshotCounts, entry: FileCountCacheEntry): void {
    totals.totalWords += entry.wordCount;
    totals.totalCharacters += entry.charCount;
    totals.totalSentences += entry.sentenceCount;
    totals.totalFootnotes += entry.footnoteCount;
    totals.totalCitations += entry.citationCount;
    totals.totalPages += entry.pageCount;
}

function accumulateFromCounts(totals: SnapshotCounts, counts: ActivityCounts): void {
    totals.totalWords += counts.words;
    totals.totalCharacters += counts.characters;
    totals.totalSentences += counts.sentences;
    totals.totalFootnotes += counts.footnotes;
    totals.totalCitations += counts.citations;
    totals.totalPages += counts.pages;
}

function pickRandomSample<T>(items: T[], size: number): T[] {
    if (items.length <= size) return items.slice();
    const pool = items.slice();
    const result: T[] = [];
    for (let i = 0; i < size; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        result.push(pool[idx]);
        pool[idx] = pool[pool.length - 1];
        pool.pop();
    }
    return result;
}

function isWithinSampleTolerance(cached: number, actual: number): boolean {
    if (cached === actual) return true;
    const denom = Math.max(cached, actual);
    if (denom === 0) return true;
    const deviation = Math.abs(cached - actual) / denom;
    return deviation <= SAMPLE_DEVIATION_THRESHOLD;
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values));
}
