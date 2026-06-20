/* Copyright 2023 edonyzpc */

import type { App, TFile } from "obsidian";

export function normalizeRelatedNoteName(noteName: string): string {
    let value = noteName.trim();
    if (value.startsWith("[[") && value.endsWith("]]")) {
        value = value.slice(2, -2);
    }
    const pipe = value.indexOf("|");
    if (pipe >= 0) value = value.slice(0, pipe);
    const heading = value.indexOf("#");
    if (heading >= 0) value = value.slice(0, heading);
    return value.trim();
}

export function resolveRelatedMarkdownNote(
    app: App,
    noteName: string,
    sourcePath = "",
): TFile | null {
    const normalized = normalizeRelatedNoteName(noteName);
    if (!normalized) return null;

    const directPath = normalized.endsWith(".md") ? normalized : `${normalized}.md`;
    const direct = app.vault.getAbstractFileByPath(directPath);
    if (isMarkdownFile(direct)) return direct;

    const linkpath = directPath.replace(/\.md$/i, "");
    const sourceAware = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
    if (isMarkdownFile(sourceAware)) return sourceAware;

    const basename = linkpath.split("/").pop() ?? "";
    if (!basename) return null;
    const basenameResolved = app.metadataCache.getFirstLinkpathDest(basename, sourcePath);
    if (isMarkdownFile(basenameResolved)) return basenameResolved;

    if (!sourcePath) return null;
    const fallback = app.metadataCache.getFirstLinkpathDest(basename, "");
    return isMarkdownFile(fallback) ? fallback : null;
}

function isMarkdownFile(value: unknown): value is TFile {
    return value !== null
        && typeof value === "object"
        && "extension" in value
        && value.extension === "md";
}
