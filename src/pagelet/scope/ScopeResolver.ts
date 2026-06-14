/* Copyright 2023 edonyzpc */

import type { App, CachedMetadata, TFile } from "obsidian";

import type { ExclusionReason, ScopeCandidate, ScopeConfig, ScopeResult } from "./types";

const DEFAULT_MAX_FILE_SIZE_BYTES = 100 * 1024;

export class ScopeResolver {
    constructor(
        private app: App,
        private config: ScopeConfig,
    ) {}

    updateConfig(config: Partial<ScopeConfig>): void {
        this.config = { ...this.config, ...config };
    }

    resolveCurrentNote(activeFile: TFile | null): ScopeResult {
        if (!activeFile) return { included: [], excluded: [] };
        const reason = this.shouldExclude(activeFile);
        if (reason) {
            return { included: [], excluded: [{ file: activeFile, reason }] };
        }
        return {
            included: [toCandidate(activeFile)],
            excluded: [],
        };
    }

    resolveTimeRange(days: number): ScopeResult {
        const cutoff = Date.now() - days * 86_400_000;
        return this.resolveFiles(
            this.getMarkdownFiles().filter((f) => f.stat.mtime >= cutoff),
        );
    }

    resolveChangedSince(sinceTimestamp: number): ScopeResult {
        return this.resolveFiles(
            this.getMarkdownFiles().filter((f) => f.stat.mtime > sinceTimestamp),
        );
    }

    private resolveFiles(files: TFile[]): ScopeResult {
        const included: ScopeCandidate[] = [];
        const excluded: Array<{ file: TFile; reason: ExclusionReason }> = [];
        for (const file of files) {
            const reason = this.shouldExclude(file);
            if (reason) {
                excluded.push({ file, reason });
            } else {
                included.push(toCandidate(file));
            }
        }
        return { included, excluded };
    }

    private shouldExclude(file: TFile): ExclusionReason | null {
        const path = file.path;

        if (path.startsWith(".trash/") || path === ".trash") return "trash";

        if (hasHiddenSegment(path)) return "hidden-folder";

        if (path.startsWith(".obsidian/") || path.startsWith("node_modules/")) {
            return "plugin-generated";
        }

        if (/(?:^|\/)templates(?:\/|$)/i.test(path)) return "template";

        if (file.extension !== "md") return "non-markdown";

        if (file.stat.size === 0) return "empty";

        const maxSize = this.config.maxFileSizeBytes || DEFAULT_MAX_FILE_SIZE_BYTES;
        if (file.stat.size > maxSize) return "too-large";

        const reviewsFolder = normalizeFolder(this.config.reviewsFolder);
        if (reviewsFolder && isUnderFolder(path, reviewsFolder)) return "pagelet-output";

        if (this.isExcludedFolder(path)) return "excluded-folder";

        const metadata = this.app.metadataCache.getFileCache(file);
        if (metadata) {
            if (hasPageletFrontmatter(metadata)) return "pagelet-frontmatter";
            if (this.hasExcludedTag(metadata)) return "excluded-tag";
        }

        if (this.matchesExcludedPattern(path)) return "excluded-pattern";

        return null;
    }

    private isExcludedFolder(path: string): boolean {
        for (const folder of this.config.excludedFolders) {
            const normalized = normalizeFolder(folder);
            if (normalized && isUnderFolder(path, normalized)) return true;
        }
        return false;
    }

    private hasExcludedTag(metadata: CachedMetadata): boolean {
        const fileTags = collectTags(metadata);
        if (fileTags.size === 0) return false;
        if (fileTags.has("#no-ai") || fileTags.has("#no-review")) return true;
        for (const tag of this.config.excludedTags) {
            if (fileTags.has(normalizeTag(tag))) return true;
        }
        return false;
    }

    private matchesExcludedPattern(path: string): boolean {
        for (const pattern of this.config.excludedPatterns) {
            if (!pattern) continue;
            if (path.includes(pattern)) return true;
        }
        return false;
    }

    private getMarkdownFiles(): TFile[] {
        return this.app.vault.getMarkdownFiles();
    }
}

function toCandidate(file: TFile): ScopeCandidate {
    return { file, mtime: file.stat.mtime, sizeBytes: file.stat.size };
}

function hasHiddenSegment(path: string): boolean {
    return path.split("/").some((s) => s.startsWith(".") && s.length > 1);
}

function normalizeFolder(folder: string): string {
    return (folder || "").replace(/^\/+|\/+$/g, "");
}

function isUnderFolder(path: string, folder: string): boolean {
    if (!folder) return false;
    return path === folder || path.startsWith(`${folder}/`);
}

function hasPageletFrontmatter(metadata: CachedMetadata): boolean {
    const value = metadata.frontmatter?.pagelet;
    return value === true || value === "true";
}

function collectTags(metadata: CachedMetadata): Set<string> {
    const tags = new Set<string>();
    if (metadata.tags) {
        for (const entry of metadata.tags) {
            if (entry.tag) tags.add(normalizeTag(entry.tag));
        }
    }
    const fmTags = metadata.frontmatter?.tags;
    collectFrontmatterTags(fmTags, tags);
    collectFrontmatterTags(metadata.frontmatter?.tag, tags);
    return tags;
}

function collectFrontmatterTags(value: unknown, tags: Set<string>): void {
    if (!value) return;
    if (typeof value === "string") {
        for (const part of value.split(/[,\s]+/)) {
            if (part.trim()) tags.add(normalizeTag(part));
        }
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) collectFrontmatterTags(item, tags);
    }
}

function normalizeTag(tag: string): string {
    const trimmed = tag.trim().toLowerCase();
    return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}
