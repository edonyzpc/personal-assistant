import { normalizePath, TFile } from "obsidian";

import { PageletRateLimiter } from "./pa-review-rate-limit";
import type { PageletRateLimitStorage } from "./pa-review-rate-limit";
import type { PageletSettings } from "../settings/pagelet";

export const PAGELET_DISCOVERY_MAX_RELATED_NOTES = 6;

export interface RetainedReviewSettingsSnapshot {
    pagelet: Pick<
        PageletSettings,
        "enabled"
        | "foregroundPerHourCap"
        | "foregroundPerDayCap"
    >;
}

export interface RetainedReviewSourceCapability {
    isPageletProviderSourceAllowedFile(file: TFile, markdown?: string): boolean;
}

export interface RetainedReviewAppHost {
    vault: {
        cachedRead(file: TFile): Promise<string>;
        getAbstractFileByPath(path: string): unknown;
    };
    workspace: { getActiveFile(): TFile | null };
}

export interface RetainedReviewPluginIntegrationDependencies {
    app: RetainedReviewAppHost;
    source: RetainedReviewSourceCapability;
    getSettings(): RetainedReviewSettingsSnapshot;
    isRuntimeCurrent(): boolean;
    getVaultStorageScope(): string | null;
    createRateLimitStorage(vaultStorageScope: string | null): PageletRateLimitStorage;
    getRateLimitStorageKey(vaultStorageScope: string | null): string;
    log(message: string, detail?: unknown): void;
}

export class RetainedReviewPluginIntegration {
    private rateLimiter: PageletRateLimiter | null = null;

    constructor(private readonly dependencies: RetainedReviewPluginIntegrationDependencies) {}

    invalidateLimiter(): void {
        this.rateLimiter = null;
    }

    getRateLimiter(): PageletRateLimiter {
        if (!this.rateLimiter) {
            const vaultStorageScope = this.dependencies.getVaultStorageScope();
            this.rateLimiter = new PageletRateLimiter({
                ...(vaultStorageScope ? {
                    storage: this.dependencies.createRateLimitStorage(vaultStorageScope),
                    coordinationKey: this.dependencies.getRateLimitStorageKey(vaultStorageScope),
                } : {}),
                config: {
                    hourlyCap: this.dependencies.getSettings().pagelet.foregroundPerHourCap,
                    dailyCap: this.dependencies.getSettings().pagelet.foregroundPerDayCap,
                },
            });
        }
        return this.rateLimiter;
    }

    async readNoteContents(
        files: TFile[],
        inputTokenBudget: number,
    ): Promise<Array<{ path: string; content: string; mtime: number; size: number }>> {
        const allowedFiles = files.filter((file) => this.dependencies.source.isPageletProviderSourceAllowedFile(file));
        if (allowedFiles.length === 0) return [];
        const maxFiles = Math.max(
            1,
            Math.min(allowedFiles.length, 20, Math.floor(Math.max(1, inputTokenBudget) / 100)),
        );
        const selectedFiles = allowedFiles.slice(0, maxFiles);
        const totalCharBudget = Math.max(1_000, Math.max(1, inputTokenBudget) * 4);
        const perFileCharBudget = Math.max(1_000, Math.floor(totalCharBudget / selectedFiles.length));
        const noteContents: Array<{ path: string; content: string; mtime: number; size: number }> = [];
        for (const file of selectedFiles) {
            try {
                const before = { mtime: file.stat.mtime, size: file.stat.size };
                const content = await this.dependencies.app.vault.cachedRead(file);
                const current = this.dependencies.app.vault.getAbstractFileByPath(file.path);
                if (
                    !(current instanceof TFile)
                    || current.extension !== "md"
                    || current.stat.mtime !== before.mtime
                    || current.stat.size !== before.size
                    || !this.dependencies.source.isPageletProviderSourceAllowedFile(current, content)
                ) continue;
                noteContents.push({
                    path: current.path,
                    content: content.length > perFileCharBudget
                        ? `${content.slice(0, perFileCharBudget)}\n[...truncated]`
                        : content,
                    mtime: before.mtime,
                    size: before.size,
                });
            } catch (error) {
                this.dependencies.log("Failed to read Pagelet note content", { path: file.path, error });
            }
        }
        return noteContents;
    }

    captureSourceSnapshots(
        notes: readonly { path: string; mtime?: number; size?: number }[],
    ): Array<{ path: string; mtime: number; size: number }> | null {
        const snapshots: Array<{ path: string; mtime: number; size: number }> = [];
        const seen = new Set<string>();
        for (const note of notes) {
            const path = normalizePath(note.path);
            if (seen.has(path)) continue;
            seen.add(path);
            const file = this.dependencies.app.vault.getAbstractFileByPath(path);
            if (
                !(file instanceof TFile)
                || file.extension !== "md"
                || !this.dependencies.source.isPageletProviderSourceAllowedFile(file)
            ) return null;
            const mtime = note.mtime ?? file.stat.mtime;
            const size = note.size ?? file.stat.size;
            if (file.stat.mtime !== mtime || file.stat.size !== size) return null;
            snapshots.push({ path: file.path, mtime, size });
        }
        return snapshots;
    }

    sourceSnapshotsAreCurrent(
        snapshots: readonly { path: string; mtime: number; size: number }[],
        requiredActivePath?: string,
    ): boolean {
        if (!this.dependencies.isRuntimeCurrent() || this.dependencies.getSettings().pagelet.enabled !== true) {
            return false;
        }
        if (requiredActivePath) {
            const activeFile = this.dependencies.app.workspace.getActiveFile();
            if (
                !(activeFile instanceof TFile)
                || normalizePath(activeFile.path) !== normalizePath(requiredActivePath)
            ) return false;
        }
        return snapshots.every((snapshot) => {
            const file = this.dependencies.app.vault.getAbstractFileByPath(snapshot.path);
            return file instanceof TFile
                && file.extension === "md"
                && file.stat.mtime === snapshot.mtime
                && file.stat.size === snapshot.size
                && this.dependencies.source.isPageletProviderSourceAllowedFile(file);
        });
    }
}
