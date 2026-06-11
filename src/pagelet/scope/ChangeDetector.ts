/* Copyright 2023 edonyzpc */

import type { TFile } from "obsidian";

export class ChangeDetector {
    private lastAnalyzedTimestamps: Map<string, number> = new Map();

    markAnalyzed(filePath: string, timestamp?: number): void {
        this.lastAnalyzedTimestamps.set(filePath, timestamp ?? Date.now());
    }

    getChangedFiles(allFiles: TFile[]): TFile[] {
        const currentPaths = new Set(allFiles.map(f => f.path));
        // Prune entries for files that no longer exist (renamed/deleted)
        for (const path of this.lastAnalyzedTimestamps.keys()) {
            if (!currentPaths.has(path)) {
                this.lastAnalyzedTimestamps.delete(path);
            }
        }
        return allFiles.filter((file) => {
            const lastAnalyzed = this.lastAnalyzedTimestamps.get(file.path);
            if (lastAnalyzed === undefined) return true;
            return file.stat.mtime > lastAnalyzed;
        });
    }

    clear(): void {
        this.lastAnalyzedTimestamps.clear();
    }

    getLastAnalysisTime(): number | null {
        if (this.lastAnalyzedTimestamps.size === 0) return null;
        let max = -Infinity;
        for (const ts of this.lastAnalyzedTimestamps.values()) {
            if (ts > max) max = ts;
        }
        return max;
    }
}
