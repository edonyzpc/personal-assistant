/* Copyright 2023 edonyzpc */

import { getFrontMatterInfo, parseYaml } from "obsidian";

import type { ShareCardData } from "./share-card-types";

export function stripValidShareCardYamlFrontmatter(markdown: string): string {
    const info = getFrontMatterInfo(markdown);
    if (!info.exists) return markdown;
    try {
        parseYaml(info.frontmatter);
    } catch {
        return markdown;
    }
    const contentStart = Math.min(
        markdown.length,
        Math.max(0, info.contentStart ?? 0),
    );
    return markdown.slice(contentStart);
}

export function createShareCardSelectionData(
    selection: string,
    basePath?: string,
): ShareCardData | null {
    if (selection.trim().length === 0) return null;
    return {
        content: selection,
        source: "selection",
        ...(basePath ? { resourceContext: { basePath } } : {}),
    };
}

export function createShareCardNoteData(
    rawNote: string,
    basename: string,
    basePath?: string,
): ShareCardData | null {
    const content = stripValidShareCardYamlFrontmatter(rawNote);
    if (content.trim().length === 0) return null;
    return {
        content,
        source: "note",
        sourceLabel: basename,
        ...(basePath ? { resourceContext: { basePath } } : {}),
    };
}
