/* Copyright 2023 edonyzpc */

import type { TFile } from "obsidian";

export interface ChangeDetectorState {
    version: 1;
    analyzedMtimes: Record<string, number>;
}

export interface ChangeDetectorStorage {
    load(): ChangeDetectorState | null;
    save(state: ChangeDetectorState): void;
}

/** Synchronous per-vault storage for content-free changed-only watermarks. */
export class LocalStorageChangeDetectorStorage implements ChangeDetectorStorage {
    constructor(
        private readonly getStorage: () => Storage | undefined,
        private readonly key: string,
    ) {}

    load(): ChangeDetectorState | null {
        const raw = this.requireStorage().getItem(this.key);
        return raw === null ? null : JSON.parse(raw) as ChangeDetectorState;
    }

    save(state: ChangeDetectorState): void {
        this.requireStorage().setItem(this.key, JSON.stringify(state));
    }

    private requireStorage(): Storage {
        const storage = this.getStorage();
        if (!storage) throw new Error("Pagelet change watermark storage unavailable");
        return storage;
    }
}

export class InMemoryChangeDetectorStorage implements ChangeDetectorStorage {
    private state: ChangeDetectorState | null = null;

    constructor(initial?: ChangeDetectorState) {
        if (initial) this.save(initial);
    }

    load(): ChangeDetectorState | null {
        return this.state
            ? { version: 1, analyzedMtimes: { ...this.state.analyzedMtimes } }
            : null;
    }

    save(state: ChangeDetectorState): void {
        this.state = { version: 1, analyzedMtimes: { ...state.analyzedMtimes } };
    }
}

export class ChangeDetector {
    private lastAnalyzedTimestamps: Map<string, number> = new Map();
    private initialized = false;
    private storageAvailable = true;

    constructor(private readonly storage?: ChangeDetectorStorage) {}

    markAnalyzed(filePath: string, timestamp?: number): void {
        this.markAnalyzedFiles([{
            path: filePath,
            mtime: timestamp ?? Date.now(),
        }]);
    }

    markAnalyzedFiles(files: ReadonlyArray<{ path: string; mtime: number }>): void {
        if (!this.ensureLoaded()) {
            throw new Error("Pagelet change watermark storage unavailable");
        }
        const previous = new Map(this.lastAnalyzedTimestamps);
        for (const file of files) {
            if (!file.path || !Number.isFinite(file.mtime) || file.mtime < 0) continue;
            this.lastAnalyzedTimestamps.set(file.path, file.mtime);
        }
        try {
            this.persist();
        } catch (error) {
            this.lastAnalyzedTimestamps = previous;
            this.storageAvailable = false;
            throw error;
        }
    }

    getChangedFiles(allFiles: TFile[]): TFile[] {
        // Unknown or malformed persisted state cannot prove changed-only, so
        // production fails closed instead of resending the recent scope.
        if (!this.ensureLoaded()) return [];
        const currentPaths = new Set(allFiles.map((file) => file.path));
        let pruned = false;
        for (const path of this.lastAnalyzedTimestamps.keys()) {
            if (!currentPaths.has(path)) {
                this.lastAnalyzedTimestamps.delete(path);
                pruned = true;
            }
        }
        if (pruned) {
            try {
                this.persist();
            } catch {
                this.storageAvailable = false;
                return [];
            }
        }
        return allFiles.filter((file) => {
            const lastAnalyzed = this.lastAnalyzedTimestamps.get(file.path);
            if (lastAnalyzed === undefined) return true;
            return file.stat.mtime > lastAnalyzed;
        });
    }

    clear(): void {
        this.initialized = true;
        this.storageAvailable = true;
        const previous = this.lastAnalyzedTimestamps;
        this.lastAnalyzedTimestamps = new Map();
        try {
            this.persist();
        } catch (error) {
            this.lastAnalyzedTimestamps = previous;
            this.storageAvailable = false;
            throw error;
        }
    }

    getLastAnalysisTime(): number | null {
        if (!this.ensureLoaded() || this.lastAnalyzedTimestamps.size === 0) return null;
        let max = -Infinity;
        for (const ts of this.lastAnalyzedTimestamps.values()) {
            if (ts > max) max = ts;
        }
        return max;
    }

    private ensureLoaded(): boolean {
        if (this.initialized) return this.storageAvailable;
        this.initialized = true;
        if (!this.storage) return true;
        try {
            const state = this.storage.load();
            if (state === null) return true;
            if (!isValidChangeDetectorState(state)) {
                throw new Error("Pagelet change watermark storage malformed");
            }
            this.lastAnalyzedTimestamps = new Map(Object.entries(state.analyzedMtimes));
            return true;
        } catch {
            this.lastAnalyzedTimestamps.clear();
            this.storageAvailable = false;
            return false;
        }
    }

    private persist(): void {
        this.storage?.save({
            version: 1,
            analyzedMtimes: Object.fromEntries(this.lastAnalyzedTimestamps),
        });
    }
}

function isValidChangeDetectorState(value: unknown): value is ChangeDetectorState {
    if (!value || typeof value !== "object") return false;
    const state = value as Partial<ChangeDetectorState>;
    if (
        state.version !== 1
        || !state.analyzedMtimes
        || typeof state.analyzedMtimes !== "object"
        || Array.isArray(state.analyzedMtimes)
    ) {
        return false;
    }
    return Object.entries(state.analyzedMtimes).every(([path, mtime]) => (
        path.length > 0
        && typeof mtime === "number"
        && Number.isFinite(mtime)
        && mtime >= 0
    ));
}
