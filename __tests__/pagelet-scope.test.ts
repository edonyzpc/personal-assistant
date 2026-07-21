/* Copyright 2023 edonyzpc */

import { describe, expect, it } from "@jest/globals";

import {
    applyPageletScopeToggle,
    buildPageletScopePlan,
    buildPageletScopeReviewBundle,
    selectPageletScope,
    type PageletScopeFileLike,
} from "../src/pagelet/scope";
import { PAGELET_DEFAULT_TARGET_SUGGESTIONS } from "../src/pagelet/pa-review-schemas";
import { ScopeResolver } from "../src/pagelet/scope/ScopeResolver";

function file(path: string, mtime: string): PageletScopeFileLike {
    const ms = new Date(mtime).getTime();
    return {
        path,
        extension: "md",
        stat: { mtime: ms, ctime: ms, size: 100 },
    };
}

describe("buildPageletScopePlan", () => {
    it("keeps current-note scope limited to the active markdown file", () => {
        const plan = buildPageletScopePlan({
            files: [
                file("notes/active.md", "2026-06-06T10:00:00+08:00"),
                file("notes/other.md", "2026-06-06T11:00:00+08:00"),
            ],
            activePath: "notes/active.md",
            range: "current",
            reviewsFolder: ".pagelet",
            now: new Date("2026-06-06T12:00:00+08:00"),
        });

        expect(selectPageletScope(plan).paths).toEqual(["notes/active.md"]);
    });

    it("selects recent modified files and daily-note dated files for last3", () => {
        const plan = buildPageletScopePlan({
            files: [
                file("projects/current.md", "2026-06-06T10:00:00+08:00"),
                file("daily/2026-06-04.md", "2026-05-01T10:00:00+08:00"),
                file("notes/touched.md", "2026-06-05T10:00:00+08:00"),
                file("notes/old.md", "2026-05-20T10:00:00+08:00"),
            ],
            activePath: "projects/current.md",
            range: "last3",
            reviewsFolder: ".pagelet",
            now: new Date("2026-06-06T12:00:00+08:00"),
        });

        expect(selectPageletScope(plan).paths).toEqual([
            "projects/current.md",
            "notes/touched.md",
            "daily/2026-06-04.md",
        ]);
        expect(plan.candidates.find((candidate) => candidate.path === "daily/2026-06-04.md")?.reason)
            .toBe("daily-note-date");
    });

    it("summarizes review-output notes without listing individual paths", () => {
        const plan = buildPageletScopePlan({
            files: [
                file("active.md", "2026-06-06T10:00:00+08:00"),
                file(".pagelet/active-pagelet-review-2026-06-06.md", "2026-06-06T10:00:00+08:00"),
            ],
            activePath: "active.md",
            range: "last7",
            reviewsFolder: ".pagelet",
            now: new Date("2026-06-06T12:00:00+08:00"),
        });

        expect(selectPageletScope(plan).paths).toEqual(["active.md"]);
        expect(plan.candidates.find((candidate) => candidate.path.startsWith(".pagelet/")))
            .toBeUndefined();
        expect(plan.excludedReviewOutputCount).toBe(1);
    });

    it("can summarize review outputs omitted from Obsidian's markdown file list", () => {
        const plan = buildPageletScopePlan({
            files: [
                file("active.md", "2026-06-06T10:00:00+08:00"),
            ],
            activePath: "active.md",
            range: "last7",
            reviewsFolder: ".pagelet",
            reviewOutputCount: 3,
            now: new Date("2026-06-06T12:00:00+08:00"),
        });

        expect(selectPageletScope(plan).paths).toEqual(["active.md"]);
        expect(plan.excludedReviewOutputCount).toBe(3);
    });

    it("allows manual include/exclude toggles for unlocked candidates", () => {
        const plan = buildPageletScopePlan({
            files: [
                file("active.md", "2026-06-06T10:00:00+08:00"),
                file("recent.md", "2026-06-05T10:00:00+08:00"),
            ],
            activePath: "active.md",
            range: "last3",
            reviewsFolder: ".pagelet",
            now: new Date("2026-06-06T12:00:00+08:00"),
        });

        const updated = applyPageletScopeToggle(plan, "recent.md", false);

        expect(selectPageletScope(updated).paths).toEqual(["active.md"]);
        expect(updated.candidates.find((candidate) => candidate.path === "recent.md"))
            .toMatchObject({ included: false, skippedReason: "unchecked" });
    });

    it("returns the active path with the selected scope", () => {
        const plan = buildPageletScopePlan({
            files: [file("active.md", "2026-06-06T10:00:00+08:00")],
            activePath: "active.md",
            range: "current",
            reviewsFolder: ".pagelet",
            now: new Date("2026-06-06T12:00:00+08:00"),
        });

        expect(selectPageletScope(plan)).toEqual({
            range: "current",
            activePath: "active.md",
            paths: ["active.md"],
        });
    });

    it("locks conservative privacy exclusions before provider review", () => {
        const plan = buildPageletScopePlan({
            files: [
                file("active.md", "2026-06-06T10:00:00+08:00"),
                file(".trash/deleted.md", "2026-06-06T10:00:00+08:00"),
                file("notes/generated.md", "2026-06-06T10:00:00+08:00"),
                file("notes/private.md", "2026-06-06T10:00:00+08:00"),
                { ...file("notes/empty.md", "2026-06-06T10:00:00+08:00"), stat: { mtime: new Date("2026-06-06T10:00:00+08:00").getTime(), ctime: new Date("2026-06-06T10:00:00+08:00").getTime(), size: 0 } },
            ],
            activePath: "active.md",
            range: "last7",
            reviewsFolder: ".pagelet",
            now: new Date("2026-06-06T12:00:00+08:00"),
            getMetadata: (path) => {
                if (path === "notes/generated.md") return { frontmatter: { pagelet: true } };
                if (path === "notes/private.md") return { tags: [{ tag: "#no-ai" }] };
                return undefined;
            },
        });

        expect(selectPageletScope(plan).paths).toEqual(["active.md"]);
        expect(plan.candidates.find((candidate) => candidate.path === ".trash/deleted.md"))
            .toBeUndefined();
        expect(plan.candidates.find((candidate) => candidate.path === "notes/generated.md"))
            .toMatchObject({ included: false, locked: true, skippedReason: "excluded-frontmatter" });
        expect(plan.candidates.find((candidate) => candidate.path === "notes/private.md"))
            .toMatchObject({ included: false, locked: true, skippedReason: "excluded-tag" });
        expect(plan.candidates.find((candidate) => candidate.path === "notes/empty.md"))
            .toMatchObject({ included: false, locked: true, skippedReason: "empty-note" });
    });

    it("applies user-configured exclusions before provider review", () => {
        const plan = buildPageletScopePlan({
            files: [
                file("active.md", "2026-06-06T10:00:00+08:00"),
                file("private/plan.md", "2026-06-06T10:00:00+08:00"),
                file("notes/tagged.md", "2026-06-06T10:00:00+08:00"),
                file("notes/vendor-draft.md", "2026-06-06T10:00:00+08:00"),
            ],
            activePath: "active.md",
            range: "last7",
            reviewsFolder: ".pagelet",
            excludedFolders: ["private"],
            excludedTags: ["secret"],
            excludedPatterns: ["vendor"],
            now: new Date("2026-06-06T12:00:00+08:00"),
            getMetadata: (path) => {
                if (path === "notes/tagged.md") return { frontmatter: { tags: ["secret"] } };
                return undefined;
            },
        });

        expect(selectPageletScope(plan).paths).toEqual(["active.md"]);
        expect(plan.candidates.find((candidate) => candidate.path === "private/plan.md"))
            .toMatchObject({ included: false, locked: true, skippedReason: "excluded-folder" });
        expect(plan.candidates.find((candidate) => candidate.path === "notes/tagged.md"))
            .toMatchObject({ included: false, locked: true, skippedReason: "excluded-tag" });
        expect(plan.candidates.find((candidate) => candidate.path === "notes/vendor-draft.md"))
            .toMatchObject({ included: false, locked: true, skippedReason: "excluded-pattern" });
    });

    it("keeps preview inclusion aligned with runtime hard exclusions", () => {
        const now = new Date();
        const files = [
            file("notes/active.md", now.toISOString()),
            { ...file("notes/at-limit.md", now.toISOString()), stat: { mtime: now.getTime(), ctime: now.getTime(), size: 100 * 1024 } },
            file("Templates/daily.md", now.toISOString()),
            file("node_modules/package/readme.md", now.toISOString()),
            { ...file("notes/too-large.md", now.toISOString()), stat: { mtime: now.getTime(), ctime: now.getTime(), size: 100 * 1024 + 1 } },
        ];
        const app = {
            vault: {
                configDir: ".obsidian",
                getMarkdownFiles: () => files,
            },
            metadataCache: { getFileCache: () => null },
        };
        const resolver = new ScopeResolver(app as never, {
            excludedFolders: [],
            excludedTags: [],
            excludedPatterns: [],
            maxFileSizeBytes: 100 * 1024,
            reviewsFolder: ".pagelet",
        });
        const plan = buildPageletScopePlan({
            files,
            activePath: "notes/active.md",
            range: "last7",
            reviewsFolder: ".pagelet",
            now,
        });

        const previewPaths = selectPageletScope(plan).paths.slice().sort();
        const runtime = resolver.resolveTimeRange(7);
        const runtimePaths = runtime.included.map((candidate) => candidate.file.path).sort();

        expect(previewPaths).toEqual(runtimePaths);
        expect(previewPaths).toEqual(["notes/active.md", "notes/at-limit.md"]);
        expect(runtime.excluded.map(({ file: excludedFile, reason }) => [excludedFile.path, reason]))
            .toEqual([
                ["Templates/daily.md", "template"],
                ["node_modules/package/readme.md", "plugin-generated"],
                ["notes/too-large.md", "too-large"],
            ]);
        expect(plan.candidates.find((candidate) => candidate.path === "notes/too-large.md"))
            .toMatchObject({ included: false, locked: true, skippedReason: "overflow" });
    });

    it("includes notes modified yesterday and excludes today and day-before", () => {
        const plan = buildPageletScopePlan({
            files: [
                file("active.md", "2026-06-07T10:00:00+08:00"),
                file("notes/yesterday.md", "2026-06-06T15:00:00+08:00"),
                file("notes/today.md", "2026-06-07T08:00:00+08:00"),
                file("notes/old.md", "2026-06-05T23:00:00+08:00"),
            ],
            activePath: "active.md",
            range: "yesterday",
            reviewsFolder: ".pagelet",
            now: new Date("2026-06-07T12:00:00+08:00"),
        });

        const selected = selectPageletScope(plan).paths;
        expect(selected).toContain("notes/yesterday.md");
        expect(selected).not.toContain("notes/today.md");
        expect(selected).not.toContain("notes/old.md");
    });

    it("locks overflow candidates so maxIncluded remains a real cap", () => {
        const plan = buildPageletScopePlan({
            files: [
                file("active.md", "2026-06-06T10:00:00+08:00"),
                file("recent.md", "2026-06-06T09:00:00+08:00"),
            ],
            activePath: "active.md",
            range: "last7",
            reviewsFolder: ".pagelet",
            now: new Date("2026-06-06T12:00:00+08:00"),
            maxIncluded: 1,
        });

        const overflow = plan.candidates.find((candidate) => candidate.path === "recent.md");
        expect(overflow).toMatchObject({ included: false, locked: true, skippedReason: "overflow" });
        const toggled = applyPageletScopeToggle(plan, "recent.md", true);
        expect(selectPageletScope(toggled).paths).toEqual(["active.md"]);
    });
});

describe("buildPageletScopeReviewBundle", () => {
    it("builds multi-note source ids and references", () => {
        const bundle = buildPageletScopeReviewBundle({
            entries: [
                { path: "a.md", content: "Alpha note has a missing citation." },
                { path: "b.md", content: "Beta note needs a clearer recommendation." },
            ],
            primarySourcePath: "a.md",
            range: "last3",
            settings: {
                maxInputTokens: 1000,
                outputLanguage: "auto",
            },
            uiLanguage: "en",
        });

        expect(bundle).not.toBeNull();
        expect(bundle!.input.notePath).toBe("Last 3 days · 2 notes");
        expect(bundle!.input.targetSuggestionCount).toBe(PAGELET_DEFAULT_TARGET_SUGGESTIONS);
        expect(bundle!.input.segments.map((segment) => segment.id)).toEqual([
            "note-1-seg-1",
            "note-2-seg-1",
        ]);
        expect(bundle!.sourceReferences).toEqual([
            { sourceId: "note-1-seg-1", path: "a.md", segmentIndex: 0, label: "a.md #1" },
            { sourceId: "note-2-seg-1", path: "b.md", segmentIndex: 0, label: "b.md #1" },
        ]);
    });

    it("returns null when every selected note is empty", () => {
        const bundle = buildPageletScopeReviewBundle({
            entries: [{ path: "empty.md", content: "   " }],
            primarySourcePath: "empty.md",
            range: "current",
            settings: {
                maxInputTokens: 1000,
                outputLanguage: "auto",
            },
            uiLanguage: "en",
        });

        expect(bundle).toBeNull();
    });

    it("keeps multi-note segments inside the approximate input budget", () => {
        const bundle = buildPageletScopeReviewBundle({
            entries: [
                { path: "a.md", content: "A".repeat(20) },
                { path: "b.md", content: "B".repeat(20) },
            ],
            primarySourcePath: "a.md",
            range: "last3",
            settings: {
                maxInputTokens: 10,
                outputLanguage: "auto",
            },
            uiLanguage: "en",
        });

        expect(bundle).not.toBeNull();
        const totalChars = bundle!.input.segments
            .reduce((sum, segment) => sum + segment.content.length, 0);
        expect(totalChars).toBeLessThanOrEqual(40);
        expect(bundle!.sourcePaths).toEqual(["a.md"]);
        expect(bundle!.input.notePath).toBe("a.md");
    });

    it("passes through a lower target suggestion count", () => {
        const bundle = buildPageletScopeReviewBundle({
            entries: [{ path: "a.md", content: "Alpha note has a missing citation." }],
            primarySourcePath: "a.md",
            range: "current",
            settings: {
                maxInputTokens: 1000,
                outputLanguage: "auto",
            },
            uiLanguage: "en",
            targetSuggestionCount: 1,
        });

        expect(bundle).not.toBeNull();
        expect(bundle!.input.targetSuggestionCount).toBe(1);
    });
});
