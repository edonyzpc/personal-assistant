import { describe, expect, it, jest } from "@jest/globals";

import { PreloadBudget } from "../src/pagelet/preload/PreloadBudget";
import { PreloadCache } from "../src/pagelet/preload/PreloadCache";
import { PreloadEngine } from "../src/pagelet/preload/PreloadEngine";
import { ChangeDetector } from "../src/pagelet/scope/ChangeDetector";
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
            perHourCap: 10,
            perDayCap: 100,
            tokenBudget: { input: 10_000, output: 1_000 },
        };
        const engine = new PreloadEngine(
            app as never,
            config,
            new PreloadCache(),
            new PreloadBudget(10, 100),
            new ChangeDetector(),
            new ScopeResolver(app as never, {
                excludedFolders: [],
                excludedTags: [],
                excludedPatterns: [],
                maxFileSizeBytes: 100 * 1024,
                reviewsFolder: ".pagelet",
            }),
            async (batch) => {
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
});
