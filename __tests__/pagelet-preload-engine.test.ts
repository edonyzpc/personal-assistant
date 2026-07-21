import { describe, expect, it, jest } from "@jest/globals";

import { PreloadBudget } from "../src/pagelet/preload/PreloadBudget";
import { PreloadCache } from "../src/pagelet/preload/PreloadCache";
import { PreloadEngine } from "../src/pagelet/preload/PreloadEngine";
import {
    ChangeDetector,
    InMemoryChangeDetectorStorage,
} from "../src/pagelet/scope/ChangeDetector";
import { ScopeResolver } from "../src/pagelet/scope/ScopeResolver";
import type { PreloadConfig } from "../src/pagelet/preload/types";

function makeFile(path: string, mtime: number) {
    return {
        path,
        basename: path.replace(/\.md$/, ""),
        extension: "md",
        stat: { mtime, size: 100 },
    };
}

describe("PreloadEngine", () => {
    it("continues processing capped backlog files in later cycles", async () => {
        const now = Date.now();
        const files = Array.from({ length: 25 }, (_, index) =>
            makeFile(`notes/${String(index + 1).padStart(2, "0")}.md`, now - index));
        const app = {
            vault: {
                getMarkdownFiles: jest.fn(() => files),
            },
            metadataCache: {
                getFileCache: jest.fn(() => null),
            },
        };
        const analyzedBatches: string[][] = [];
        const config: PreloadConfig = {
            enabled: true,
            intervalMinutes: 30,
            perHourCap: 2,
            perDayCap: 20,
            tokenBudget: { input: 4_000, output: 1_000 },
        };
        const engine = new PreloadEngine(
            app as never,
            config,
            new PreloadCache(),
            new PreloadBudget(2, 20),
            new ChangeDetector(),
            new ScopeResolver(app as never, {
                excludedFolders: [],
                excludedTags: [],
                excludedPatterns: [],
                maxFileSizeBytes: 100 * 1024,
                reviewsFolder: ".pagelet",
            }),
            async (batch, _config, context) => {
                expect(context?.backgroundEnvelope).toEqual({
                    kind: "generic-changed-only",
                    rangeDays: 7,
                    allowWrite: false,
                    wholeVault: false,
                    excludedScopeOverride: false,
                });
                expect(context?.remainingProviderCalls().hourly).toBeGreaterThan(0);
                const reservation = context?.reserveProviderCall();
                expect(reservation).not.toBe(false);
                if (typeof reservation === "object") reservation.commit();
                analyzedBatches.push(batch.map((file) => file.path));
                return {
                    findings: [],
                    analyzedFiles: batch.map((file) => file.path),
                    analyzedAt: Date.now(),
                    tokenCost: { input: 0, output: 0 },
                };
            },
        );

        await engine.runCycle();
        await engine.runCycle();

        expect(analyzedBatches[0]).toHaveLength(20);
        expect(analyzedBatches[1]).toEqual(files.slice(20).map((file) => file.path));
    });

    it.each([
        ["input", { tokenBudget: { input: 4_001, output: 1_000 } }],
        ["output", { tokenBudget: { input: 4_000, output: 1_001 } }],
        ["hourly cap", { perHourCap: 3 }],
        ["daily cap", { perDayCap: 21 }],
        ["non-generic range", { range: "last3" as const }],
    ])("skips an out-of-envelope %s without analysis or budget reservation", async (_label, override) => {
        const now = Date.now();
        const file = makeFile("notes/changed.md", now);
        const app = {
            vault: { getMarkdownFiles: jest.fn(() => [file]) },
            metadataCache: { getFileCache: jest.fn(() => null) },
        };
        const config: PreloadConfig = {
            enabled: true,
            intervalMinutes: 30,
            perHourCap: 2,
            perDayCap: 20,
            tokenBudget: { input: 4_000, output: 1_000 },
            ...override,
        };
        const budget = new PreloadBudget(2, 20);
        const analyze = jest.fn(async () => ({
            findings: [],
            analyzedFiles: [],
            analyzedAt: now,
            tokenCost: { input: 0, output: 0 },
        }));
        const events: string[] = [];
        const engine = new PreloadEngine(
            app as never,
            config,
            new PreloadCache(),
            budget,
            new ChangeDetector(),
            new ScopeResolver(app as never, {
                excludedFolders: [],
                excludedTags: [],
                excludedPatterns: [],
                maxFileSizeBytes: 100 * 1024,
                reviewsFolder: ".pagelet",
            }),
            analyze,
        );
        engine.on((event) => {
            if (event.type === "cycle-skip") events.push(event.reason);
        });

        await engine.runCycle();

        expect(analyze).not.toHaveBeenCalled();
        expect(budget.remaining()).toEqual({ hourly: 2, daily: 20 });
        expect(events).toEqual(["outside-standard-envelope"]);
    });

    it("keeps a no-call result retryable without replacing the last valid cache", async () => {
        const now = Date.now();
        const file = makeFile("notes/changed.md", now);
        const app = {
            vault: { getMarkdownFiles: jest.fn(() => [file]) },
            metadataCache: { getFileCache: jest.fn(() => null) },
        };
        const cache = new PreloadCache();
        const previous = {
            findings: [{ text: "kept", sourceFile: file.path, sourceTitle: "changed" }],
            analyzedFiles: [file.path],
            analyzedAt: now - 1,
            tokenCost: { input: 10, output: 2 },
        };
        cache.set(previous);
        const analyze = jest.fn(async () => ({
            findings: [],
            analyzedFiles: [],
            analyzedAt: now,
            tokenCost: { input: 0, output: 0 },
        }));
        const engine = new PreloadEngine(
            app as never,
            {
                enabled: true,
                intervalMinutes: 30,
                perHourCap: 2,
                perDayCap: 20,
                tokenBudget: { input: 4_000, output: 1_000 },
            },
            cache,
            new PreloadBudget(2, 20),
            new ChangeDetector(),
            new ScopeResolver(app as never, {
                excludedFolders: [],
                excludedTags: [],
                excludedPatterns: [],
                maxFileSizeBytes: 100 * 1024,
                reviewsFolder: ".pagelet",
            }),
            analyze,
        );

        await engine.runCycle();
        await engine.runCycle();

        expect(analyze).toHaveBeenCalledTimes(2);
        expect(cache.get()?.result).toEqual(previous);
    });

    it("keeps unchanged notes provider-free after reload and admits a newer mtime", async () => {
        const now = Date.now();
        const file = makeFile("notes/changed.md", now);
        const app = {
            vault: { getMarkdownFiles: jest.fn(() => [file]) },
            metadataCache: { getFileCache: jest.fn(() => null) },
        };
        const storage = new InMemoryChangeDetectorStorage();
        const analyze = jest.fn(async (batch: Array<{ path: string }>) => ({
            findings: [],
            analyzedFiles: batch.map((entry) => entry.path),
            analyzedAt: now,
            tokenCost: { input: 0, output: 0 },
        }));
        const makeEngine = () => new PreloadEngine(
            app as never,
            {
                enabled: true,
                intervalMinutes: 30,
                perHourCap: 2,
                perDayCap: 20,
                tokenBudget: { input: 4_000, output: 1_000 },
            },
            new PreloadCache(),
            new PreloadBudget(2, 20),
            new ChangeDetector(storage),
            new ScopeResolver(app as never, {
                excludedFolders: [],
                excludedTags: [],
                excludedPatterns: [],
                maxFileSizeBytes: 100 * 1024,
                reviewsFolder: ".pagelet",
            }),
            analyze as never,
        );

        const firstEngine = makeEngine();
        await firstEngine.runCycle();
        firstEngine.destroy();
        await makeEngine().runCycle();
        expect(analyze).toHaveBeenCalledTimes(1);

        file.stat.mtime = now + 1;
        await makeEngine().runCycle();
        expect(analyze).toHaveBeenCalledTimes(2);
    });

    it("keeps a note changed during post-analysis handoff retryable", async () => {
        const now = Date.now();
        const file = makeFile("notes/raced.md", now);
        const app = {
            vault: { getMarkdownFiles: jest.fn(() => [file]) },
            metadataCache: { getFileCache: jest.fn(() => null) },
        };
        const analyze = jest.fn(async (batch: Array<{ path: string }>) => {
            if (analyze.mock.calls.length === 1) file.stat.mtime = now + 1;
            return {
                findings: [],
                analyzedFiles: batch.map((entry) => entry.path),
                analyzedAt: now,
                tokenCost: { input: 0, output: 0 },
            };
        });
        const engine = new PreloadEngine(
            app as never,
            {
                enabled: true,
                intervalMinutes: 30,
                perHourCap: 2,
                perDayCap: 20,
                tokenBudget: { input: 4_000, output: 1_000 },
            },
            new PreloadCache(),
            new PreloadBudget(2, 20),
            new ChangeDetector(),
            new ScopeResolver(app as never, {
                excludedFolders: [],
                excludedTags: [],
                excludedPatterns: [],
                maxFileSizeBytes: 100 * 1024,
                reviewsFolder: ".pagelet",
            }),
            analyze as never,
        );

        await engine.runCycle();
        await engine.runCycle();
        await engine.runCycle();

        expect(analyze).toHaveBeenCalledTimes(2);
    });
});

describe("ScopeResolver privacy exclusions", () => {
    it("excludes files under the current Vault#configDir", () => {
        const configNote = makeFile("vault-config/plugins/personal-assistant/data.md", Date.now());
        const app = {
            vault: {
                configDir: "vault-config",
                getMarkdownFiles: jest.fn(() => [configNote]),
            },
            metadataCache: {
                getFileCache: jest.fn(() => null),
            },
        };
        const resolver = new ScopeResolver(app as never, {
            excludedFolders: [],
            excludedTags: [],
            excludedPatterns: [],
            maxFileSizeBytes: 100 * 1024,
            reviewsFolder: ".pagelet",
        });

        expect(resolver.resolveCurrentNote(configNote as never)).toMatchObject({
            included: [],
            excluded: [{ reason: "plugin-generated" }],
        });
    });

    it("hard-excludes no-ai and no-review tags even when excludedTags is empty", () => {
        const noAi = makeFile("notes/private.md", Date.now());
        const noReview = makeFile("notes/no-review.md", Date.now());
        const app = {
            vault: {
                getMarkdownFiles: jest.fn(() => [noAi, noReview]),
            },
            metadataCache: {
                getFileCache: jest.fn((file: { path: string }) => {
                    if (file.path === "notes/private.md") {
                        return { frontmatter: { tag: "#no-ai" } };
                    }
                    if (file.path === "notes/no-review.md") {
                        return { frontmatter: { tags: ["no-review"] } };
                    }
                    return null;
                }),
            },
        };
        const resolver = new ScopeResolver(app as never, {
            excludedFolders: [],
            excludedTags: [],
            excludedPatterns: [],
            maxFileSizeBytes: 100 * 1024,
            reviewsFolder: ".pagelet",
        });

        expect(resolver.resolveCurrentNote(noAi as never)).toMatchObject({
            included: [],
            excluded: [{ reason: "excluded-tag" }],
        });
        expect(resolver.resolveCurrentNote(noReview as never)).toMatchObject({
            included: [],
            excluded: [{ reason: "excluded-tag" }],
        });
    });
});
