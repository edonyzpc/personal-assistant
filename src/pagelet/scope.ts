/* Copyright 2023 edonyzpc */

import { normalizePath } from "obsidian";

import { pageletT, type PageletLocale } from "../locales/pagelet";
import { detectNoteLanguage } from "../locales/pagelet/language-detect";
import type { PageletSettings } from "../settings/pagelet";

import {
    PAGELET_DEFAULT_TARGET_SUGGESTIONS,
    resolvePageletTargetSuggestionCount,
    type PageletLanguageCode,
    type PageletReviewInput,
    type PageletSegment,
} from "./pa-review-schemas";

export type PageletReviewRange = "current" | "yesterday" | "last3" | "last7";

export type PageletScopeCandidateReason = "active" | "modified" | "daily-note-date";

export type PageletScopeSkippedReason =
    | "outside-range"
    | "review-output"
    | "overflow"
    | "unchecked"
    | "missing-file"
    | "empty-note"
    | "hidden-folder"
    | "excluded-folder"
    | "excluded-frontmatter"
    | "excluded-tag"
    | "excluded-pattern";

export interface PageletScopeFileLike {
    path: string;
    extension?: string;
    stat?: {
        mtime?: number;
        ctime?: number;
        size?: number;
    };
}

export interface PageletScopeCandidate {
    path: string;
    reason: PageletScopeCandidateReason;
    included: boolean;
    locked?: boolean;
    skippedReason?: PageletScopeSkippedReason;
    modifiedAt: number;
    createdAt: number;
}

export interface PageletScopePlan {
    range: PageletReviewRange;
    activePath: string;
    rangeStartMs: number;
    rangeEndMs: number;
    candidates: PageletScopeCandidate[];
    excludedReviewOutputCount?: number;
    estimatedInputTokens?: number;
}

export interface PageletScopeSelection {
    range: PageletReviewRange;
    activePath?: string;
    paths: string[];
}

export interface PageletScopeMetadataLike {
    frontmatter?: Record<string, unknown>;
    tags?: readonly ({ tag?: string } | string)[];
}

export interface PageletScopeSourceReference {
    sourceId: string;
    path: string;
    segmentIndex: number;
    label: string;
}

export interface PageletScopeReviewBundle {
    input: PageletReviewInput;
    sourceReferences: PageletScopeSourceReference[];
    primarySourcePath: string;
    sourcePaths: string[];
    sourceLabel: string;
    detectedLanguage: PageletLanguageCode;
}

export interface BuildPageletScopePlanOptions {
    files: readonly PageletScopeFileLike[];
    activePath: string;
    range: PageletReviewRange;
    reviewsFolder: string;
    excludedFolders?: readonly string[];
    excludedTags?: readonly string[];
    excludedPatterns?: readonly string[];
    now?: Date;
    maxIncluded?: number;
    reviewOutputCount?: number;
    getMetadata?: (path: string) => PageletScopeMetadataLike | undefined;
}

export interface BuildPageletScopeReviewBundleOptions {
    entries: readonly {
        path: string;
        content: string;
    }[];
    primarySourcePath: string;
    range: PageletReviewRange;
    settings: Pick<PageletSettings, "maxInputTokens" | "outputLanguage">;
    uiLanguage: PageletLanguageCode;
    targetSuggestionCount?: number;
}

export const PAGELET_SCOPE_DEFAULT_MAX_INCLUDED = 20;
export const PAGELET_SEGMENT_TARGET_CHARS = 1800;
export const PAGELET_APPROX_CHARS_PER_TOKEN = 4;

const RANGE_DAYS: Record<PageletReviewRange, number> = {
    current: 0,
    yesterday: 1,
    last3: 3,
    last7: 7,
};

export function buildPageletScopePlan(options: BuildPageletScopePlanOptions): PageletScopePlan {
    const now = options.now ?? new Date();
    const activePath = normalizePath(options.activePath);
    const maxIncluded = options.maxIncluded ?? PAGELET_SCOPE_DEFAULT_MAX_INCLUDED;
    const { startMs, endMs } = resolveRangeWindow(options.range, now);
    const reviewFolder = normalizeFolderPrefix(options.reviewsFolder);
    const candidates: PageletScopeCandidate[] = [];
    let visibleReviewOutputCount = 0;

    for (const file of options.files) {
        const path = normalizePath(file.path);
        if (!isMarkdownPath(path, file.extension)) continue;
        const modifiedAt = finiteNumber(file.stat?.mtime) ?? 0;
        const createdAt = finiteNumber(file.stat?.ctime) ?? modifiedAt;
        const reason = chooseCandidateReason(path, activePath, modifiedAt, startMs, endMs);
        const skippedReason = scopeExcludedReason({
            path,
            reviewFolder,
            excludedFolders: options.excludedFolders ?? [],
            excludedTags: options.excludedTags ?? [],
            excludedPatterns: options.excludedPatterns ?? [],
            size: finiteNumber(file.stat?.size),
            metadata: options.getMetadata?.(path),
        });
        if (skippedReason) {
            if (skippedReason === "review-output") {
                if (reason) visibleReviewOutputCount += 1;
                continue;
            }
            if (skippedReason === "hidden-folder") continue;
            if (!reason) continue;
            candidates.push({
                path,
                reason,
                included: false,
                locked: true,
                skippedReason,
                modifiedAt,
                createdAt,
            });
            continue;
        }

        if (!reason) continue;
        candidates.push({
            path,
            reason,
            included: true,
            modifiedAt,
            createdAt,
        });
    }

    candidates.sort((left, right) => {
        if (left.path === activePath) return -1;
        if (right.path === activePath) return 1;
        if (left.included !== right.included) return left.included ? -1 : 1;
        return right.modifiedAt - left.modifiedAt || left.path.localeCompare(right.path);
    });

    let includedCount = 0;
    for (const candidate of candidates) {
        if (!candidate.included || candidate.locked) continue;
        includedCount += 1;
        if (includedCount > maxIncluded) {
            candidate.included = false;
            candidate.locked = true;
            candidate.skippedReason = "overflow";
        }
    }

    const excludedReviewOutputCount = Math.max(
        options.reviewOutputCount ?? 0,
        visibleReviewOutputCount,
    );

    let totalIncludedBytes = 0;
    for (const file of options.files) {
        const path = normalizePath(file.path);
        const candidate = candidates.find((c) => c.path === path);
        if (candidate?.included) {
            totalIncludedBytes += finiteNumber(file.stat?.size) ?? 0;
        }
    }
    const APPROX_BYTES_PER_TOKEN = 3;
    const estimatedInputTokens = totalIncludedBytes > 0
        ? Math.ceil(totalIncludedBytes / APPROX_BYTES_PER_TOKEN)
        : undefined;

    return {
        range: options.range,
        activePath,
        rangeStartMs: startMs,
        rangeEndMs: endMs,
        candidates,
        ...(excludedReviewOutputCount > 0 ? { excludedReviewOutputCount } : {}),
        ...(estimatedInputTokens ? { estimatedInputTokens } : {}),
    };
}

export function selectPageletScope(plan: PageletScopePlan): PageletScopeSelection {
    return {
        range: plan.range,
        activePath: plan.activePath,
        paths: plan.candidates
            .filter((candidate) => candidate.included)
            .map((candidate) => candidate.path),
    };
}

export function applyPageletScopeToggle(
    plan: PageletScopePlan,
    path: string,
    included: boolean,
): PageletScopePlan {
    const target = normalizePath(path);
    return {
        ...plan,
        candidates: plan.candidates.map((candidate) => {
            if (candidate.path !== target || candidate.locked) return candidate;
            return {
                ...candidate,
                included,
                skippedReason: included ? undefined : "unchecked",
            };
        }),
    };
}

export function buildPageletScopeReviewBundle(
    options: BuildPageletScopeReviewBundleOptions,
): PageletScopeReviewBundle | null {
    const nonEmptyEntries = options.entries
        .map((entry) => ({
            path: normalizePath(entry.path),
            content: entry.content.trim(),
        }))
        .filter((entry) => entry.path.length > 0 && entry.content.length > 0);
    if (nonEmptyEntries.length === 0) return null;

    const maxChars = Math.max(
        1,
        Math.floor(options.settings.maxInputTokens || 1) * PAGELET_APPROX_CHARS_PER_TOKEN,
    );
    const segments: PageletSegment[] = [];
    const sourceReferences: PageletScopeSourceReference[] = [];
    let remaining = maxChars;

    for (let noteIndex = 0; noteIndex < nonEmptyEntries.length && remaining > 0; noteIndex++) {
        const entry = nonEmptyEntries[noteIndex];
        const prefix = nonEmptyEntries.length > 1
            ? `Source note: ${entry.path}\n`
            : "";
        let start = 0;
        let segmentIndex = 0;
        while (start < entry.content.length && remaining > 0) {
            const available = Math.min(
                PAGELET_SEGMENT_TARGET_CHARS,
                Math.max(0, remaining - prefix.length),
            );
            if (available <= 0) break;
            const slice = entry.content.slice(start, start + available);
            if (slice.length === 0) break;
            const sourceId = nonEmptyEntries.length > 1
                ? `note-${noteIndex + 1}-seg-${segmentIndex + 1}`
                : `seg-${segmentIndex + 1}`;
            const content = `${prefix}${slice}`;
            segments.push({ id: sourceId, content });
            sourceReferences.push({
                sourceId,
                path: entry.path,
                segmentIndex,
                label: `${entry.path} #${segmentIndex + 1}`,
            });
            remaining -= content.length;
            start += slice.length;
            segmentIndex += 1;
        }
    }

    if (segments.length === 0) return null;

    const combinedContent = segments.map((segment) => segment.content).join("\n\n");
    const detectedLanguage = detectNoteLanguage(combinedContent);
    const outputLanguage: PageletLanguageCode = options.settings.outputLanguage === "auto"
        ? detectedLanguage
        : options.settings.outputLanguage;
    const sourcePaths = [...new Set(sourceReferences.map((reference) => reference.path))];
    const primarySourcePath = normalizePath(options.primarySourcePath || nonEmptyEntries[0].path);
    const sourceLabel = sourcePaths.length === 1
        ? sourcePaths[0]
        : `${rangeLabel(options.range)} · ${sourcePaths.length} notes`;

    return {
        input: {
            notePath: sourceLabel,
            noteContent: combinedContent,
            detectedLanguage,
            mode: "basic",
            segments,
            uiLanguage: options.uiLanguage,
            targetSuggestionCount: resolvePageletTargetSuggestionCount(
                options.targetSuggestionCount ?? PAGELET_DEFAULT_TARGET_SUGGESTIONS,
            ),
            ...(options.settings.outputLanguage === "auto"
                ? {}
                : { outputLanguageOverride: outputLanguage }),
        },
        sourceReferences,
        primarySourcePath,
        sourcePaths,
        sourceLabel,
        detectedLanguage,
    };
}

export function rangeLabel(range: PageletReviewRange, locale: PageletLocale = "en"): string {
    return pageletT(`pagelet.panel.scope.${range}`, locale);
}

export function skippedReasonLabel(reason: PageletScopeSkippedReason, locale: PageletLocale = "en"): string {
    return pageletT(`pagelet.panel.scope.skipped.${reason}`, locale);
}

function scopeExcludedReason(options: {
    path: string;
    reviewFolder: string;
    excludedFolders: readonly string[];
    excludedTags: readonly string[];
    excludedPatterns: readonly string[];
    size: number | null;
    metadata?: PageletScopeMetadataLike;
}): PageletScopeSkippedReason | null {
    if (isUnderFolder(options.path, options.reviewFolder)) return "review-output";
    if (options.size === 0) return "empty-note";
    if (hasHiddenOrSystemSegment(options.path)) return "hidden-folder";
    if (isUnderAnyFolder(options.path, options.excludedFolders)) return "excluded-folder";
    if (isPageletFrontmatter(options.metadata?.frontmatter)) return "excluded-frontmatter";
    if (hasExcludedTag(options.metadata, options.excludedTags)) return "excluded-tag";
    if (matchesExcludedPattern(options.path, options.excludedPatterns)) return "excluded-pattern";
    return null;
}

function isUnderAnyFolder(path: string, folders: readonly string[]): boolean {
    for (const folder of folders) {
        const normalized = normalizeFolderPrefix(folder);
        if (normalized && isUnderFolder(path, normalized)) return true;
    }
    return false;
}

function matchesExcludedPattern(path: string, patterns: readonly string[]): boolean {
    for (const pattern of patterns) {
        if (pattern && path.includes(pattern)) return true;
    }
    return false;
}

function chooseCandidateReason(
    path: string,
    activePath: string,
    modifiedAt: number,
    startMs: number,
    endMs: number,
): PageletScopeCandidateReason | null {
    if (path === activePath) return "active";
    if (startMs === endMs) return null;
    const dailyDate = extractDailyDateMs(path);
    if (dailyDate !== null && dailyDate >= startMs && dailyDate < endMs) {
        return "daily-note-date";
    }
    if (modifiedAt >= startMs && modifiedAt < endMs) return "modified";
    return null;
}

function resolveRangeWindow(range: PageletReviewRange, now: Date): { startMs: number; endMs: number } {
    const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    const todayStart = new Date(y, m, d).getTime();
    if (range === "current") return { startMs: todayStart, endMs: todayStart };
    if (range === "yesterday") {
        return { startMs: new Date(y, m, d - 1).getTime(), endMs: todayStart };
    }
    const days = RANGE_DAYS[range];
    return {
        startMs: new Date(y, m, d - (days - 1)).getTime(),
        endMs: new Date(y, m, d + 1).getTime(),
    };
}

function extractDailyDateMs(path: string): number | null {
    const match = path.match(/(?:^|\/)(\d{4})-(\d{2})-(\d{2})(?:[^\d]|$)/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const candidate = new Date(year, month - 1, day);
    if (
        candidate.getFullYear() !== year
        || candidate.getMonth() !== month - 1
        || candidate.getDate() !== day
    ) {
        return null;
    }
    return candidate.getTime();
}

function normalizeFolderPrefix(folder: string): string {
    return normalizePath(folder || ".pagelet").replace(/^\/+|\/+$/g, "");
}

function isUnderFolder(path: string, folder: string): boolean {
    if (folder.length === 0) return false;
    return path === folder || path.startsWith(`${folder}/`);
}

function hasHiddenOrSystemSegment(path: string): boolean {
    return path
        .split("/")
        .some((segment) => segment.startsWith(".") && segment.length > 1);
}

function isPageletFrontmatter(frontmatter: Record<string, unknown> | undefined): boolean {
    const value = frontmatter?.pagelet;
    return value === true || value === "true";
}

function hasExcludedTag(
    metadata: PageletScopeMetadataLike | undefined,
    excludedTags: readonly string[],
): boolean {
    const tags = new Set<string>();
    for (const tag of metadata?.tags ?? []) {
        const raw = typeof tag === "string" ? tag : tag.tag;
        if (raw) tags.add(normalizeTag(raw));
    }
    const frontmatter = metadata?.frontmatter;
    collectFrontmatterTags(frontmatter?.tags, tags);
    collectFrontmatterTags(frontmatter?.tag, tags);
    if (tags.has("#no-ai") || tags.has("#no-review")) return true;
    return excludedTags.some((tag) => tags.has(normalizeTag(tag)));
}

function collectFrontmatterTags(value: unknown, tags: Set<string>): void {
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
    if (!trimmed) return "";
    return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function isMarkdownPath(path: string, extension?: string): boolean {
    return extension?.toLowerCase() === "md" || path.toLowerCase().endsWith(".md");
}

function finiteNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
