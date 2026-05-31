import { normalizePath } from "obsidian";

export function normalizeFeaturedImageFolderPath(folderPath: string): string {
    const normalized = normalizePath(folderPath.trim()).replace(/^\/+|\/+$/g, "");
    return normalized === "." ? "" : normalized;
}

export function getFeaturedImageSavePath(folderPath: string, filename: string): string {
    const folder = normalizeFeaturedImageFolderPath(folderPath);
    return folder ? normalizePath(`${folder}/${filename}`) : filename;
}
