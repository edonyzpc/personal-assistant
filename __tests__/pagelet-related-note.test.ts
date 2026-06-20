/* Copyright 2023 edonyzpc */

import { describe, expect, it, jest } from "@jest/globals";

import {
    normalizeRelatedNoteName,
    resolveRelatedMarkdownNote,
} from "../src/pagelet/related-note";

function makeMarkdownFile(path: string) {
    const basename = path.replace(/\.md$/i, "").split("/").pop() ?? path;
    return {
        path,
        basename,
        extension: "md",
    };
}

describe("Pagelet related note resolution", () => {
    it("normalizes wikilinks, aliases, headings, and whitespace", () => {
        expect(normalizeRelatedNoteName(" [[Folder/Note#Heading|Alias]] ")).toBe("Folder/Note");
        expect(normalizeRelatedNoteName("[[Folder/Note|Alias]]")).toBe("Folder/Note");
        expect(normalizeRelatedNoteName("Folder/Note#Heading")).toBe("Folder/Note");
    });

    it("prefers direct markdown paths", () => {
        const direct = makeMarkdownFile("Folder/Note.md");
        const app = {
            vault: {
                getAbstractFileByPath: jest.fn((path: string) => (
                    path === "Folder/Note.md" ? direct : null
                )),
            },
            metadataCache: {
                getFirstLinkpathDest: jest.fn(),
            },
        };

        expect(resolveRelatedMarkdownNote(app as never, "[[Folder/Note|Alias]]")).toBe(direct);
        expect(app.vault.getAbstractFileByPath).toHaveBeenCalledWith("Folder/Note.md");
        expect(app.metadataCache.getFirstLinkpathDest).not.toHaveBeenCalled();
    });

    it("uses the source path when resolving Obsidian linkpaths", () => {
        const resolved = makeMarkdownFile("Projects/Note.md");
        const app = {
            vault: {
                getAbstractFileByPath: jest.fn(() => null),
            },
            metadataCache: {
                getFirstLinkpathDest: jest.fn((linkpath: string, sourcePath: string) => (
                    linkpath === "Folder/Note" && sourcePath === "Areas/Current.md"
                        ? resolved
                        : null
                )),
            },
        };

        expect(resolveRelatedMarkdownNote(
            app as never,
            "Folder/Note#Heading",
            "Areas/Current.md",
        )).toBe(resolved);
        expect(app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
            "Folder/Note",
            "Areas/Current.md",
        );
    });

    it("falls back to Obsidian linkpath resolution by basename", () => {
        const resolved = makeMarkdownFile("Archive/Note.md");
        const app = {
            vault: {
                getAbstractFileByPath: jest.fn(() => null),
            },
            metadataCache: {
                getFirstLinkpathDest: jest.fn((linkpath: string, _sourcePath: string) => (
                    linkpath === "Note" ? resolved : null
                )),
            },
        };

        expect(resolveRelatedMarkdownNote(app as never, "Folder/Note#Heading")).toBe(resolved);
        expect(app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith("Folder/Note", "");
        expect(app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith("Note", "");
    });
});
