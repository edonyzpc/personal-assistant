import { Platform, debounce, type App, type Debouncer, type Vault, type Workspace } from "obsidian";
import moment from "moment";
import type PluginManager from "../main";
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
    STATS_STORE_ROOT,
    StatsStore,
} from "./stats-store";
import {
    getCharacterCount,
    getSentenceCount,
    getPageCount,
    getWordCount,
    getCitationCount,
    getFootnoteCount,
} from "./stats-utils";

type TextProvider = () => string;

type PendingTextChange = {
    filePath: string;
    currentText: string;
    previousText?: string;
};

type CancelCheck = () => boolean;

export function getStatsWriteDelayMs(isMobile: boolean): number {
    return isMobile ? 3000 : 1500;
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
    private plugin: PluginManager;
    private store: StatsStore;
    private modifiedFiles: ModifiedFiles = {};
    private baseActivity: ActivityCounts = emptyActivityCounts();
    private today: string;
    private currentShard: StatsDeviceShard | null = null;
    private initialized = false;
    private pendingChanges: PendingTextChange[] = [];
    private pendingWrite: Promise<void> | null = null;
    private hasPendingWrite = false;
    private snapshotRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    private isDisposed = false;
    private ready: Promise<void>;
    public debounceChange: Debouncer<[filePath: string | undefined, currentText: TextProvider, previousText?: TextProvider], Promise<void>>;
    private debounceWrite: Debouncer<[], Promise<void>>;

    constructor(app: App, plugin: PluginManager) {
        this.vault = app.vault;
        this.workspace = app.workspace;
        this.plugin = plugin;
        this.today = moment().format("YYYY-MM-DD");
        this.store = new StatsStore(this.vault, this.plugin.settings.statsPath);
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

        this.plugin.registerEvent(
            this.vault.on("rename", (newFile, oldPath) => {
                this.invalidateDashboardCacheForPath(newFile.path);
                this.invalidateDashboardCacheForPath(oldPath);
                if (this.modifiedFiles.hasOwnProperty(oldPath)) {
                    const content = this.modifiedFiles[oldPath];
                    delete this.modifiedFiles[oldPath];
                    this.modifiedFiles[newFile.path] = content;
                }
            })
        );

        this.plugin.registerEvent(
            this.vault.on("delete", (deletedFile) => {
                this.invalidateDashboardCacheForPath(deletedFile.path);
                if (this.modifiedFiles.hasOwnProperty(deletedFile.path)) {
                    delete this.modifiedFiles[deletedFile.path];
                }
            })
        );

        this.plugin.registerEvent(
            this.vault.on("create", (createdFile) => {
                this.invalidateDashboardCacheForPath(createdFile.path);
            })
        );

        this.plugin.registerEvent(
            this.vault.on("modify", (modifiedFile) => {
                this.invalidateDashboardCacheForPath(modifiedFile.path);
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
                    path: this.plugin.settings.statsPath,
                    message: error instanceof Error ? error.message : String(error),
                }],
            };
        }
    }

    async update(): Promise<void> {
        await this.flush();
    }

    async updateToday(): Promise<void> {
        await this.ensureToday();
        if (!this.currentShard) return;
        this.currentShard.snapshot = await this.calcSnapshot();
        this.currentShard.updatedAt = new Date().toISOString();
        await this.writeCurrentShardNow();
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

        if (modFiles.hasOwnProperty(change.filePath)) {
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
    }

    public async recalcTotals(): Promise<void> {
        await this.ready;
        await this.ensureToday();
        if (!this.currentShard) return;
        this.currentShard.snapshot = await this.calcSnapshot();
        this.currentShard.updatedAt = new Date().toISOString();
        await this.writeCurrentShardNow();
    }

    public async flush(): Promise<void> {
        const pendingChange = this.debounceChange.run();
        if (pendingChange) await pendingChange;

        await this.ready;

        const pendingWrite = this.debounceWrite.run();
        if (pendingWrite) await pendingWrite;
        if (this.pendingWrite) await this.pendingWrite;
        if (this.hasPendingWrite) await this.writeCurrentShard();
    }

    public dispose(): void {
        this.isDisposed = true;
        if (this.snapshotRefreshTimer) {
            clearTimeout(this.snapshotRefreshTimer);
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
            this.plugin.log("Skipping statistics writes for a damaged shard", error);
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
        if (path.startsWith(STATS_STORE_ROOT)) {
            this.store.invalidateDashboardCache();
        }
    }

    private countText(text: string): ActivityCounts {
        return {
            words: getWordCount(text),
            characters: getCharacterCount(text),
            sentences: getSentenceCount(text),
            pages: getPageCount(text, 300),
            footnotes: getFootnoteCount(text),
            citations: getCitationCount(text),
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
        this.hasPendingWrite = true;
        if (this.isDisposed) return;
        this.debounceWrite();
    }

    private async writeCurrentShardNow(): Promise<void> {
        this.debounceWrite.cancel();
        await this.writeCurrentShard();
    }

    private async writeCurrentShard(): Promise<void> {
        if (!this.currentShard) return;
        const write = this.store.writeOwnShard(this.currentShard);
        this.pendingWrite = write;
        try {
            await write;
            this.hasPendingWrite = false;
        } finally {
            if (this.pendingWrite === write) {
                this.pendingWrite = null;
            }
        }
    }

    private scheduleSnapshotRefresh(): void {
        if (this.isDisposed) return;
        if (this.snapshotRefreshTimer) return;
        this.snapshotRefreshTimer = setTimeout(() => {
            this.snapshotRefreshTimer = null;
            void this.refreshSnapshotInBackground();
        }, 3000);
    }

    private async refreshSnapshotInBackground(): Promise<void> {
        try {
            if (this.isDisposed) return;
            await this.ensureToday();
            if (!this.currentShard) return;
            const snapshot = await this.calcSnapshot(() => this.isDisposed);
            if (!snapshot) return;
            this.currentShard.snapshot = snapshot;
            if (this.isDisposed) return;
            this.currentShard.updatedAt = new Date().toISOString();
            this.scheduleWrite();
        } catch (error) {
            if (!this.isDisposed) {
                this.plugin.log("Failed to refresh statistics snapshot", error);
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

    private async calcSnapshot(): Promise<SnapshotCounts>;
    private async calcSnapshot(shouldCancel: CancelCheck): Promise<SnapshotCounts | null>;
    private async calcSnapshot(shouldCancel: CancelCheck = () => false): Promise<SnapshotCounts | null> {
        const totals = emptySnapshotCounts();

        for (const file of this.vault.getFiles()) {
            if (shouldCancel()) return null;
            if (file.extension !== "md") continue;
            const text = await this.vault.cachedRead(file);
            if (shouldCancel()) return null;
            const counts = this.countText(text);
            totals.totalWords += counts.words;
            totals.totalCharacters += counts.characters;
            totals.totalSentences += counts.sentences;
            totals.totalFootnotes += counts.footnotes;
            totals.totalCitations += counts.citations;
            totals.totalPages += counts.pages;
        }

        totals.files = this.getTotalFiles();
        totals.totalPages = Number(totals.totalPages.toFixed(1));
        return totals;
    }
}
