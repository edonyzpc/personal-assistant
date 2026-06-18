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
                cachedRead: jest.fn(async () => "Current note body"),
                getAbstractFileByPath: jest.fn((path: string) => (
                    path === activeFile.path ? activeFile : null
                )),
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
                onboardingShown: true,
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
        updatePageletSetting: jest.fn(),
        openPageletDetailView: () => undefined,
        findRelatedNotes: async () => [],
        isMemoryReadyForPageletDiscovery: async () => true,
        discoverConnections: async () => null,
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

describe("PageletOrchestrator quick review command", () => {
    it("opens cached findings in the Bubble without triggering a provider call", () => {
        const foregroundAnalyze = jest.fn(async () => ({
            findings: [],
            analyzedFiles: ["notes/current.md"],
            analyzedAt: Date.now(),
            tokenCost: { input: 0, output: 0 },
        }));
        const host = makeHost({
            createForegroundAnalyzeCallback: () => foregroundAnalyze,
        });
        const orchestrator = new PageletOrchestrator(host);
        const bubbleView = {
            show: jest.fn(),
            close: jest.fn(),
            bubbleState: "hidden",
        };

        (orchestrator as unknown as {
            petView: { rootEl: HTMLElement };
            bubbleView: typeof bubbleView;
            preloadCache: {
                set(result: {
                    findings: Array<{ text: string; sourceFile: string; sourceTitle: string }>;
                    analyzedFiles: string[];
                    analyzedAt: number;
                    tokenCost: { input: number; output: number };
                }): void;
            };
        }).petView = { rootEl: {} as HTMLElement };
        (orchestrator as unknown as { bubbleView: typeof bubbleView }).bubbleView = bubbleView;
        (orchestrator as unknown as {
            preloadCache: {
                set(result: {
                    findings: Array<{ text: string; sourceFile: string; sourceTitle: string }>;
                    analyzedFiles: string[];
                    analyzedAt: number;
                    tokenCost: { input: number; output: number };
                }): void;
            };
        }).preloadCache.set({
            findings: [{
                text: "Recent note has a possible follow-up.",
                sourceFile: "notes/current.md",
                sourceTitle: "current",
            }],
            analyzedFiles: ["notes/current.md"],
            analyzedAt: Date.now(),
            tokenCost: { input: 10, output: 5 },
        });

        orchestrator.getCommandCallbacks().onQuickReview();

        expect(bubbleView.show).toHaveBeenCalledTimes(1);
        const [content] = bubbleView.show.mock.calls[0] as [{
            type: string;
            findings: Array<{ text: string; sourceLink?: string; sourceTitle?: string }>;
        }, HTMLElement];
        expect(content.type).toBe("quick-review");
        expect(content.findings).toEqual([{
            text: "Recent note has a possible follow-up.",
            sourceLink: "notes/current.md",
            sourceTitle: "current",
        }]);
        expect(foregroundAnalyze).not.toHaveBeenCalled();
    });
});

describe("PageletOrchestrator review panel scope flow", () => {
    it("opens the review panel without treating preload findings as saveable review output", () => {
        const host = makeHost();
        const orchestrator = new PageletOrchestrator(host);
        const panelView = { open: jest.fn() };

        (orchestrator as unknown as { panelView: typeof panelView }).panelView = panelView;
        (orchestrator as unknown as {
            preloadCache: {
                set(result: {
                    findings: Array<{ text: string; sourceFile: string; sourceTitle: string }>;
                    analyzedFiles: string[];
                    analyzedAt: number;
                    tokenCost: { input: number; output: number };
                }): void;
            };
        }).preloadCache.set({
            findings: [{
                text: "Cached background finding.",
                sourceFile: "notes/current.md",
                sourceTitle: "current",
            }],
            analyzedFiles: ["notes/current.md"],
            analyzedAt: Date.now(),
            tokenCost: { input: 10, output: 5 },
        });

        orchestrator.openPanel();

        expect(panelView.open).toHaveBeenCalledWith(
            "review",
            [],
            expect.objectContaining({
                scope: expect.objectContaining({ includedCount: 1 }),
            }),
        );
    });

    it("keeps explicit multi-note selected review results after active note changes", async () => {
        const now = Date.now();
        const activeFile = {
            path: "notes/current.md",
            basename: "current",
            extension: "md",
            stat: { size: 100, mtime: now },
        };
        const recentFile = {
            path: "notes/recent.md",
            basename: "recent",
            extension: "md",
            stat: { size: 100, mtime: now - 86_400_000 },
        };
        const otherFile = {
            path: "notes/other.md",
            basename: "other",
            extension: "md",
            stat: { size: 100, mtime: now - 10 * 86_400_000 },
        };
        let currentActive = activeFile;
        const panelView = { open: jest.fn() };
        const foregroundAnalyze = jest.fn(async () => {
            currentActive = otherFile;
            return {
                findings: [{
                    text: "Review selected output.",
                    sourceFile: "notes/recent.md",
                    sourceTitle: "recent",
                }],
                analyzedFiles: ["notes/current.md", "notes/recent.md"],
                analyzedAt: Date.now(),
                tokenCost: { input: 1, output: 1 },
            };
        });
        const host = makeHost({
            app: {
                workspace: {
                    getActiveFile: jest.fn(() => currentActive),
                },
                vault: {
                    getMarkdownFiles: jest.fn(() => [activeFile, recentFile, otherFile]),
                    getAbstractFileByPath: jest.fn((path: string) => {
                        return [activeFile, recentFile, otherFile].find((file) => file.path === path) ?? null;
                    }),
                },
                metadataCache: {
                    getFileCache: jest.fn(() => null),
                },
            } as unknown as PageletHost["app"],
            createForegroundAnalyzeCallback: () => foregroundAnalyze,
        });
        const orchestrator = new PageletOrchestrator(host);
        (orchestrator as unknown as { panelView: typeof panelView }).panelView = panelView;
        (orchestrator as unknown as { currentScopeRange: string }).currentScopeRange = "last3";

        await (orchestrator as unknown as { reviewSelectedScope(): Promise<void> }).reviewSelectedScope();

        expect(foregroundAnalyze).toHaveBeenCalledTimes(1);
        expect(panelView.open).toHaveBeenCalledWith(
            "review",
            [expect.objectContaining({ description: "Review selected output." })],
            expect.objectContaining({
                scope: expect.objectContaining({ range: "last3" }),
            }),
        );
    });
});

describe("PageletOrchestrator connection discovery", () => {
    it("shows the Memory-not-ready empty state when related-note search is unavailable", async () => {
        const panelView = { open: jest.fn() };
        const discoverConnections = jest.fn(async () => null);
        const host = makeHost({
            findRelatedNotes: async () => [],
            isMemoryReadyForPageletDiscovery: async () => false,
            discoverConnections,
        });
        const orchestrator = new PageletOrchestrator(host);
        (orchestrator as unknown as { panelView: typeof panelView }).panelView = panelView;

        await (orchestrator as unknown as { discoverConnections(): Promise<void> }).discoverConnections();

        expect(discoverConnections).not.toHaveBeenCalled();
        expect(panelView.open).toHaveBeenCalledWith(
            "discover",
            [expect.objectContaining({
                title: "Enable Memory to Discover Connections",
                description: expect.stringContaining("Memory to be prepared"),
                sourceFile: "",
                sourceTitle: "",
            })],
            {},
        );
    });

    it("maps connection findings to the related note opened by Source", async () => {
        const panelView = { open: jest.fn() };
        const host = makeHost({
            findRelatedNotes: async () => [{
                path: "notes/related.md",
                content: "Related note body",
                score: 0.82,
            }],
            discoverConnections: async () => ({
                connections: [{
                    fromNote: "notes/current.md",
                    toNote: "notes/related.md",
                    strength: "medium" as const,
                    sharedConcepts: ["shared concept"],
                }],
                themes: [],
                gaps: [],
            }),
        });
        const orchestrator = new PageletOrchestrator(host);
        (orchestrator as unknown as { panelView: typeof panelView }).panelView = panelView;

        await (orchestrator as unknown as { discoverConnections(): Promise<void> }).discoverConnections();

        expect(panelView.open).toHaveBeenCalledWith(
            "discover",
            [expect.objectContaining({
                sourceFile: "notes/related.md",
                sourceTitle: "related",
            })],
            expect.objectContaining({
                connections: [expect.objectContaining({
                    fromNote: "notes/current.md",
                    toNote: "notes/related.md",
                })],
            }),
        );
    });
});
