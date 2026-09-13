/* Copyright 2023 edonyzpc */

import { normalizePath } from "obsidian";

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

export interface BuildPageletScopeReviewBundleOptions {
    entries: readonly {
        path: string;
        content: string;
    }[];
    primarySourcePath: string;
    settings: Pick<PageletSettings, "maxInputTokens" | "outputLanguage">;
    uiLanguage: PageletLanguageCode;
    targetSuggestionCount?: number;
}

export const PAGELET_SEGMENT_TARGET_CHARS = 1800;
export const PAGELET_APPROX_CHARS_PER_TOKEN = 4;

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
        : `Selected notes (${sourcePaths.length})`;

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
