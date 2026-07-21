/* Copyright 2023 edonyzpc */

import type { App, TFile } from "obsidian";

import { getVaultConfigDir } from "../../obsidian-paths";
import type { ExclusionReason, ScopeCandidate, ScopeConfig, ScopeResult } from "./types";

export const DEFAULT_MAX_FILE_SIZE_BYTES = 100 * 1024;

export interface ScopeExclusionMetadataLike {
    frontmatter?: Record<string, unknown>;
    tags?: readonly ({ tag?: string } | string)[];
}

export interface ScopeExclusionInput {
    path: string;
    extension?: string;
    size?: number;
    configDir?: string;
    maxFileSizeBytes?: number;
    reviewsFolder: string;
    excludedFolders: readonly string[];
    excludedTags: readonly string[];
    excludedPatterns: readonly string[];
    metadata?: ScopeExclusionMetadataLike;
}

/** Pure exclusion classifier shared by runtime resolution and scope preview. */
export function classifyScopeExclusion(input: ScopeExclusionInput): ExclusionReason | null {
    const path = input.path;

    if (path.startsWith(".trash/") || path === ".trash") return "trash";

    const reviewsFolder = normalizeFolder(input.reviewsFolder);
    if (reviewsFolder && isUnderFolder(path, reviewsFolder)) return "pagelet-output";

    if (hasHiddenSegment(path)) return "hidden-folder";

    const configDir = normalizeFolder(input.configDir ?? ".obsidian");
    if ((configDir && isUnderFolder(path, configDir)) || path.startsWith("node_modules/")) {
        return "plugin-generated";
    }

    if (/(?:^|\/)templates(?:\/|$)/i.test(path)) return "template";

    if (input.extension?.toLowerCase() !== "md" && !path.toLowerCase().endsWith(".md")) {
        return "non-markdown";
    }

    if (input.size === 0) return "empty";

    const maxSize = input.maxFileSizeBytes || DEFAULT_MAX_FILE_SIZE_BYTES;
    if (typeof input.size === "number" && input.size > maxSize) return "too-large";

    for (const folder of input.excludedFolders) {
        const normalized = normalizeFolder(folder);
        if (normalized && isUnderFolder(path, normalized)) return "excluded-folder";
    }

    if (input.metadata) {
        if (hasPageletFrontmatter(input.metadata)) return "pagelet-frontmatter";
        if (hasExcludedTag(input.metadata, input.excludedTags)) return "excluded-tag";
    }

    for (const pattern of input.excludedPatterns) {
        if (pattern && path.includes(pattern)) return "excluded-pattern";
    }

    return null;
}

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
        const metadata = this.app.metadataCache?.getFileCache?.(file);
        const configDir = getVaultConfigDir(this.app.vault);
        return classifyScopeExclusion({
            path: file.path,
            extension: file.extension,
            size: file.stat.size,
            configDir,
            maxFileSizeBytes: this.config.maxFileSizeBytes,
            reviewsFolder: this.config.reviewsFolder,
            excludedFolders: this.config.excludedFolders,
            excludedTags: this.config.excludedTags,
            excludedPatterns: this.config.excludedPatterns,
            metadata: metadata ?? undefined,
        });
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

function hasPageletFrontmatter(metadata: ScopeExclusionMetadataLike): boolean {
    const value = metadata.frontmatter?.pagelet;
    return value === true || value === "true";
}

function hasExcludedTag(
    metadata: ScopeExclusionMetadataLike,
    excludedTags: readonly string[],
): boolean {
    const fileTags = collectTags(metadata);
    if (fileTags.size === 0) return false;
    if (fileTags.has("#no-ai") || fileTags.has("#no-review")) return true;
    return excludedTags.some((tag) => fileTags.has(normalizeTag(tag)));
}

function collectTags(metadata: ScopeExclusionMetadataLike): Set<string> {
    const tags = new Set<string>();
    if (metadata.tags) {
        for (const entry of metadata.tags) {
            const tag = typeof entry === "string" ? entry : entry.tag;
            if (tag) tags.add(normalizeTag(tag));
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
