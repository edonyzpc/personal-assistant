import { describe, expect, it, jest } from "@jest/globals";

jest.mock("obsidian", () => ({
    normalizePath: (path: string) => path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/g, ""),
}));

import { addPaRelatedLink, removePaRelatedLink } from "../src/pa";

interface MockFile {
    path: string;
    extension: string;
}

function makeApp(
    initialFrontmatter: Record<string, Record<string, unknown>>,
    options: { failProcessFrontMatterFor?: readonly string[] } = {},
) {
    const files = new Map<string, MockFile>();
    const frontmatter = new Map<string, Record<string, unknown>>();
    const failPaths = new Set(options.failProcessFrontMatterFor ?? []);
    for (const [path, value] of Object.entries(initialFrontmatter)) {
        files.set(path, { path, extension: path.endsWith(".md") ? "md" : "" });
        frontmatter.set(path, { ...value });
    }
    const processFrontMatter = jest.fn(async (file: MockFile, callback: (frontmatter: Record<string, unknown>) => void) => {
        if (failPaths.has(file.path)) throw new Error("frontmatter write failed");
        const current = frontmatter.get(file.path);
        if (!current) throw new Error("missing frontmatter");
        callback(current);
    });
    return {
        app: {
            vault: {
                getAbstractFileByPath: (path: string) => files.get(path) ?? null,
            },
            fileManager: {
                processFrontMatter,
            },
        },
        frontmatter,
        processFrontMatter,
    };
}

describe("pa-related frontmatter links", () => {
    it("adds pa-related to a note without existing frontmatter fields", async () => {
        const { app, frontmatter } = makeApp({
            "Current.md": {},
            "Related.md": {},
        });

        const result = await addPaRelatedLink(app as never, "Current.md", "Related.md", { bidirectional: false });

        expect(result).toEqual({ ok: true, changed: true });
        expect(frontmatter.get("Current.md")).toEqual({
            "pa-related": ["[[Related.md]]"],
        });
        expect(frontmatter.get("Related.md")).toEqual({});
    });

    it("preserves existing frontmatter and creates a bidirectional link by default", async () => {
        const { app, frontmatter } = makeApp({
            "Current.md": { tags: ["project"] },
            "Related.md": { aliases: ["Old note"] },
        });

        const result = await addPaRelatedLink(app as never, "Current.md", "Related.md");

        expect(result).toEqual({ ok: true, changed: true });
        expect(frontmatter.get("Current.md")).toEqual({
            tags: ["project"],
            "pa-related": ["[[Related.md]]"],
        });
        expect(frontmatter.get("Related.md")).toEqual({
            aliases: ["Old note"],
            "pa-related": ["[[Current.md]]"],
        });
    });

    it("deduplicates existing pa-related entries", async () => {
        const { app, frontmatter } = makeApp({
            "Current.md": { "pa-related": ["[[Related.md]]"] },
            "Related.md": { "pa-related": ["[[Current.md]]"] },
        });

        const result = await addPaRelatedLink(app as never, "Current.md", "Related.md");

        expect(result).toEqual({ ok: true, changed: false });
        expect(frontmatter.get("Current.md")?.["pa-related"]).toEqual(["[[Related.md]]"]);
        expect(frontmatter.get("Related.md")?.["pa-related"]).toEqual(["[[Current.md]]"]);
    });

    it("coerces a scalar pa-related field into an array", async () => {
        const { app, frontmatter } = makeApp({
            "Current.md": { "pa-related": "[[Existing.md]]" },
            "Related.md": {},
        });

        const result = await addPaRelatedLink(app as never, "Current.md", "Related.md", { bidirectional: false });

        expect(result).toEqual({ ok: true, changed: true });
        expect(frontmatter.get("Current.md")?.["pa-related"]).toEqual([
            "[[Existing.md]]",
            "[[Related.md]]",
        ]);
    });

    it("removes a specific pa-related wikilink", async () => {
        const { app, frontmatter } = makeApp({
            "Current.md": { "pa-related": ["[[Related.md]]", "[[Keep.md]]"] },
            "Related.md": {},
        });

        const result = await removePaRelatedLink(app as never, "Current.md", "Related.md");

        expect(result).toEqual({ ok: true, changed: true });
        expect(frontmatter.get("Current.md")?.["pa-related"]).toEqual(["[[Keep.md]]"]);
    });

    it("returns file-not-found when the source note does not exist", async () => {
        const { app, processFrontMatter } = makeApp({
            "Related.md": {},
        });

        const result = await addPaRelatedLink(app as never, "Missing.md", "Related.md");

        expect(result).toEqual({ ok: false, reason: "file-not-found" });
        expect(processFrontMatter).not.toHaveBeenCalled();
    });

    it("preflights the target note before a bidirectional write", async () => {
        const { app, frontmatter, processFrontMatter } = makeApp({
            "Current.md": {},
        });

        const result = await addPaRelatedLink(app as never, "Current.md", "Missing.md");

        expect(result).toEqual({ ok: false, reason: "file-not-found" });
        expect(processFrontMatter).not.toHaveBeenCalled();
        expect(frontmatter.get("Current.md")).toEqual({});
    });

    it("rolls back the source link when the reverse frontmatter write fails", async () => {
        const { app, frontmatter } = makeApp({
            "Current.md": {},
            "Related.md": {},
        }, {
            failProcessFrontMatterFor: ["Related.md"],
        });

        const result = await addPaRelatedLink(app as never, "Current.md", "Related.md");

        expect(result).toEqual({ ok: false, reason: "frontmatter-write-failed" });
        expect(frontmatter.get("Current.md")).toEqual({ "pa-related": [] });
        expect(frontmatter.get("Related.md")).toEqual({});
    });
});
