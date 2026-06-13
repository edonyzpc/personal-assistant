import { describe, expect, it, jest } from "@jest/globals";

jest.mock("obsidian", () => ({
    Notice: jest.fn(),
    normalizePath: (path: string) => path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/g, ""),
}));

import { PageletOrchestrator, type PageletHost } from "../src/pagelet/orchestrator";

function makeHost(overrides: Partial<PageletHost> = {}): PageletHost {
    const activeFile = {
        path: "notes/current.md",
        basename: "current",
        extension: "md",
        stat: { size: 100, mtime: Date.now() },
    };
    const host: PageletHost = {
        app: {
            workspace: {
                getActiveFile: jest.fn(() => activeFile),
            },
            vault: {
                getMarkdownFiles: jest.fn(() => [activeFile]),
            },
            metadataCache: {
                getFileCache: jest.fn(() => null),
            },
        } as unknown as PageletHost["app"],
        settings: {
            pagelet: {
                enabled: true,
                petVisible: true,
                petCorner: "bottom-right",
                proactiveHints: false,
                proactiveHintsCooldown: 30,
                proactiveHintsQuietHours: { enabled: false, start: "22:00", end: "08:00" },
                preloadEnabled: true,
                preloadInterval: 30,
                preloadPerHourCap: 2,
                preloadPerDayCap: 20,
                preloadTokenBudget: { input: 4000, output: 1000 },
                outputLanguage: "auto",
                temperature: 0.2,
                foregroundPerHourCap: 10,
                foregroundPerDayCap: 100,
                maxInputTokens: 8000,
                maxOutputTokens: 2000,
                reviewsFolder: ".pagelet",
                periodicSummaryScope: "7d",
                excludedFolders: [],
                excludedTags: [],
                excludedPatterns: [],
            },
        },
        log: jest.fn(),
        registerEvent: jest.fn(),
        createPreloadAnalyzeCallback: () => async () => ({
            findings: [],
            analyzedFiles: [],
            analyzedAt: Date.now(),
            tokenCost: { input: 0, output: 0 },
        }),
        createForegroundAnalyzeCallback: () => async () => ({
            findings: [],
            analyzedFiles: [],
            analyzedAt: Date.now(),
            tokenCost: { input: 0, output: 0 },
        }),
        createGenerateCallback: () => async () => ({
            text: "",
            tokenCost: { input: 0, output: 0 },
        }),
        writeReviewNote: async () => ({ success: true, filePath: ".pagelet/test.md" }),
        saveSettings: () => undefined,
        openPageletDetailView: () => undefined,
        ...overrides,
    };
    return host;
}

describe("PageletOrchestrator foreground review concurrency", () => {
    it("uses the foreground analysis callback for current-note reviews", async () => {
        const preloadAnalyze = jest.fn(async () => ({
            findings: [],
            analyzedFiles: [],
            analyzedAt: Date.now(),
            tokenCost: { input: 0, output: 0 },
        }));
        const foregroundAnalyze = jest.fn(async () => ({
            findings: [],
            analyzedFiles: ["notes/current.md"],
            analyzedAt: Date.now(),
            tokenCost: { input: 0, output: 0 },
        }));
        const host = makeHost({
            createPreloadAnalyzeCallback: () => preloadAnalyze,
            createForegroundAnalyzeCallback: () => foregroundAnalyze,
        });
        const orchestrator = new PageletOrchestrator(host);

        await orchestrator.reviewCurrentNote();

        expect(foregroundAnalyze).toHaveBeenCalledTimes(1);
        expect(preloadAnalyze).not.toHaveBeenCalled();
    });

    it("coalesces repeated current-note reviews while a provider call is in flight", async () => {
        let releaseFirst!: () => void;
        const firstGate = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        let callCount = 0;
        const host = makeHost({
            createForegroundAnalyzeCallback: () => async () => {
                callCount++;
                if (callCount === 1) {
                    await firstGate;
                }
                return {
                    findings: [],
                    analyzedFiles: ["notes/current.md"],
                    analyzedAt: Date.now(),
                    tokenCost: { input: 0, output: 0 },
                };
            },
        });
        const orchestrator = new PageletOrchestrator(host);

        const first = orchestrator.reviewCurrentNote();
        const second = orchestrator.reviewCurrentNote();

        await second;
        expect(callCount).toBe(1);

        releaseFirst();
        await first;

        await orchestrator.reviewCurrentNote();
        expect(callCount).toBe(2);
    });

    it("coalesces repeated save-as-review-note clicks while a write is in flight", async () => {
        let releaseFirst!: () => void;
        const firstGate = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        const writeReviewNote = jest.fn(async () => {
            await firstGate;
            return { success: true, filePath: ".pagelet/test.md" };
        });
        const host = makeHost({ writeReviewNote });
        const orchestrator = new PageletOrchestrator(host);
        const save = (orchestrator as unknown as {
            saveFindingsAsReviewNote(findings: Array<{ title: string; description: string }>): Promise<void>;
        }).saveFindingsAsReviewNote.bind(orchestrator);

        const findings = [{ title: "Review finding", description: "Use this finding to improve the note." }];
        const first = save(findings);
        const second = save(findings);

        await second;
        expect(writeReviewNote).toHaveBeenCalledTimes(1);

        releaseFirst();
        await first;
    });
});
