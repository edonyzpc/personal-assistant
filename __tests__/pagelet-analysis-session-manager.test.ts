/* Copyright 2023 edonyzpc */

import { describe, expect, it, jest } from "@jest/globals";

jest.mock("obsidian", () => ({
    Notice: jest.fn(),
    normalizePath: (path: string) => path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/g, ""),
}));

import {
    AnalysisSessionManager,
    type AnalysisSessionHost,
} from "../src/pagelet/AnalysisSessionManager";
import { PreloadBudget } from "../src/pagelet/preload/PreloadBudget";
import type { PreloadFinding } from "../src/pagelet/preload/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHost(overrides: Partial<AnalysisSessionHost> = {}): AnalysisSessionHost {
    const activeFile = {
        path: "notes/current.md",
        basename: "current",
        extension: "md",
        stat: { size: 100, mtime: Date.now(), ctime: Date.now() },
    };

    return {
        app: {
            workspace: {
                getActiveFile: jest.fn(() => activeFile),
            },
            vault: {
                getMarkdownFiles: jest.fn(() => [activeFile]),
                getAbstractFileByPath: jest.fn((path: string) =>
                    path === activeFile.path ? activeFile : null,
                ),
            },
            metadataCache: {
                getFileCache: jest.fn(() => null),
            },
        } as unknown as AnalysisSessionHost["app"],
        settings: {
            pagelet: {
                foregroundPerHourCap: 10,
                foregroundPerDayCap: 100,
                maxInputTokens: 8000,
                maxOutputTokens: 2000,
                reviewsFolder: ".pagelet",
                excludedFolders: [],
                excludedTags: [],
                excludedPatterns: [],
            },
        },
        log: jest.fn(),
        createForegroundAnalyzeCallback: () => async () => ({
            findings: [] as PreloadFinding[],
            analyzedFiles: [] as string[],
            analyzedAt: Date.now(),
            tokenCost: { input: 0, output: 0 },
        }),
        ...overrides,
    };
}

function makeManager(
    hostOverrides: Partial<AnalysisSessionHost> = {},
    budget?: PreloadBudget,
): { manager: AnalysisSessionManager; host: AnalysisSessionHost; budget: PreloadBudget } {
    const host = makeHost(hostOverrides);
    const b = budget ?? new PreloadBudget(10, 100);
    const manager = new AnalysisSessionManager(host, b);
    return { manager, host, budget: b };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AnalysisSessionManager", () => {
    describe("beginForegroundReviewRun concurrency guard", () => {
        it("allows the first call", () => {
            const { manager } = makeManager();
            expect(manager.beginForegroundReviewRun()).toBe(true);
            expect(manager.isForegroundRunInProgress).toBe(true);
        });

        it("rejects a second concurrent call", () => {
            const { manager } = makeManager();
            expect(manager.beginForegroundReviewRun()).toBe(true);
            expect(manager.beginForegroundReviewRun()).toBe(false);
        });

        it("allows a new call after finishing the previous run", () => {
            const { manager } = makeManager();
            expect(manager.beginForegroundReviewRun()).toBe(true);
            manager.finishForegroundReviewRun();
            expect(manager.isForegroundRunInProgress).toBe(false);
            expect(manager.beginForegroundReviewRun()).toBe(true);
        });

        it("rejects when budget is exhausted", () => {
            // Budget limits are synced from host settings on each call,
            // so we set the host settings to 0 caps.
            const { manager } = makeManager({
                settings: {
                    pagelet: {
                        foregroundPerHourCap: 0,
                        foregroundPerDayCap: 0,
                        maxInputTokens: 8000,
                        maxOutputTokens: 2000,
                        reviewsFolder: ".pagelet",
                        excludedFolders: [],
                        excludedTags: [],
                        excludedPatterns: [],
                    },
                },
            });
            expect(manager.beginForegroundReviewRun()).toBe(false);
            expect(manager.isForegroundRunInProgress).toBe(false);
        });
    });

    describe("analyzeFiles stale detection", () => {
        it("returns findings on successful analysis", async () => {
            const finding: PreloadFinding = {
                text: "Improve structure",
                sourceFile: "notes/current.md",
                sourceTitle: "current",
                suggestion: {
                    source_id: "seg-1",
                    kind: "expand",
                    rationale: "This note could benefit from more detail about the topic.",
                    proposed_action: "Add a section covering implementation details.",
                    related_notes: [],
                },
            };
            const { manager } = makeManager({
                createForegroundAnalyzeCallback: () => async () => ({
                    findings: [finding],
                    analyzedFiles: ["notes/current.md"],
                    analyzedAt: Date.now(),
                    tokenCost: { input: 100, output: 50 },
                }),
            });

            const result = await manager.analyzeFiles(
                [{ path: "notes/current.md" } as any],
                { range: "current", expectedActivePath: "notes/current.md" },
                () => false,
            );

            expect(result).not.toBeNull();
            expect(result!.findings).toHaveLength(1);
            expect(result!.findings[0].title).toBeDefined();
            expect(result!.rawFindings).toEqual([finding]);
        });

        it("returns null when destroyed during analysis", async () => {
            let destroyed = false;
            const { manager } = makeManager({
                createForegroundAnalyzeCallback: () => async () => {
                    destroyed = true;
                    return {
                        findings: [],
                        analyzedFiles: ["notes/current.md"],
                        analyzedAt: Date.now(),
                        tokenCost: { input: 0, output: 0 },
                    };
                },
            });

            const result = await manager.analyzeFiles(
                [{ path: "notes/current.md" } as any],
                { range: "current" },
                () => destroyed,
            );

            expect(result).toBeNull();
        });

        it("returns null when active path changes during analysis (stale)", async () => {
            let activeFilePath = "notes/current.md";
            const { manager } = makeManager({
                app: {
                    workspace: {
                        getActiveFile: jest.fn(() => ({
                            path: activeFilePath,
                            extension: "md",
                        })),
                    },
                    vault: {
                        getMarkdownFiles: jest.fn(() => []),
                        getAbstractFileByPath: jest.fn(() => null),
                    },
                    metadataCache: { getFileCache: jest.fn(() => null) },
                } as unknown as AnalysisSessionHost["app"],
                createForegroundAnalyzeCallback: () => async () => {
                    // Simulate user navigating to a different note during analysis
                    activeFilePath = "notes/other.md";
                    return {
                        findings: [{ text: "stale", sourceFile: "notes/current.md", sourceTitle: "current" }],
                        analyzedFiles: ["notes/current.md"],
                        analyzedAt: Date.now(),
                        tokenCost: { input: 1, output: 1 },
                    };
                },
            });

            const result = await manager.analyzeFiles(
                [{ path: "notes/current.md" } as any],
                { range: "current", expectedActivePath: "notes/current.md" },
                () => false,
            );

            expect(result).toBeNull();
        });

        it("returns null for empty file list", async () => {
            const { manager } = makeManager();
            const result = await manager.analyzeFiles([], { range: "current" }, () => false);
            expect(result).toBeNull();
        });

        it("supersedes earlier run when a new analyzeFiles call starts", async () => {
            let resolveFirst!: () => void;
            const firstGate = new Promise<void>((r) => { resolveFirst = r; });

            const { manager } = makeManager({
                createForegroundAnalyzeCallback: () => async () => {
                    await firstGate;
                    return {
                        findings: [],
                        analyzedFiles: ["notes/current.md"],
                        analyzedAt: Date.now(),
                        tokenCost: { input: 0, output: 0 },
                    };
                },
            });

            // Start first analysis but don't resolve it yet
            const first = manager.analyzeFiles(
                [{ path: "notes/current.md" } as any],
                { range: "current" },
                () => false,
            );

            // Start second analysis immediately (increments foregroundRunSeq)
            const second = manager.analyzeFiles(
                [{ path: "notes/current.md" } as any],
                { range: "current" },
                () => false,
            );

            // Resolve the gate so both can complete
            resolveFirst();

            // First should be superseded (null), second should succeed
            const [firstResult, secondResult] = await Promise.all([first, second]);
            expect(firstResult).toBeNull();
            // Second result depends on implementation timing but shouldn't throw
            expect(secondResult).toBeDefined();
        });
    });

    describe("discardAnalysisSessionIfStale", () => {
        it("returns false when there is no cached analysis", () => {
            const { manager } = makeManager();
            expect(manager.discardAnalysisSessionIfStale("notes/any.md")).toBe(false);
        });

        it("returns false when active path matches the analysis source", async () => {
            const { manager } = makeManager({
                createForegroundAnalyzeCallback: () => async () => ({
                    findings: [{ text: "finding", sourceFile: "notes/current.md", sourceTitle: "current" }],
                    analyzedFiles: ["notes/current.md"],
                    analyzedAt: Date.now(),
                    tokenCost: { input: 1, output: 1 },
                }),
            });

            await manager.analyzeFiles(
                [{ path: "notes/current.md" } as any],
                { range: "current", expectedActivePath: "notes/current.md" },
                () => false,
            );

            expect(manager.discardAnalysisSessionIfStale("notes/current.md")).toBe(false);
        });

        it("returns true and clears session when active path differs", async () => {
            const { manager } = makeManager({
                createForegroundAnalyzeCallback: () => async () => ({
                    findings: [{ text: "finding", sourceFile: "notes/current.md", sourceTitle: "current" }],
                    analyzedFiles: ["notes/current.md"],
                    analyzedAt: Date.now(),
                    tokenCost: { input: 1, output: 1 },
                }),
            });

            await manager.analyzeFiles(
                [{ path: "notes/current.md" } as any],
                { range: "current", expectedActivePath: "notes/current.md" },
                () => false,
            );

            expect(manager.discardAnalysisSessionIfStale("notes/other.md")).toBe(true);
            // Session should be cleared
            expect(manager.currentAnalysisFindings()).toEqual([]);
        });
    });

    describe("syncBudget", () => {
        it("updates budget limits from host settings", () => {
            const budget = new PreloadBudget(10, 100);
            const { manager, host } = makeManager({}, budget);

            // Change settings
            host.settings.pagelet.foregroundPerHourCap = 5;
            host.settings.pagelet.foregroundPerDayCap = 50;
            manager.syncBudget();

            // After syncing, the budget should reflect the new limits.
            // We verify indirectly: if we exhaust the new (lower) limit,
            // beginForegroundReviewRun should reject.
            for (let i = 0; i < 5; i++) {
                expect(manager.beginForegroundReviewRun()).toBe(true);
                manager.finishForegroundReviewRun();
            }
            // 6th call within the hour should be rejected (hourly cap = 5)
            expect(manager.beginForegroundReviewRun()).toBe(false);
        });
    });

    describe("handleScopeRangeChange", () => {
        it("updates scope range and clears analysis session", async () => {
            const { manager } = makeManager({
                createForegroundAnalyzeCallback: () => async () => ({
                    findings: [{ text: "finding", sourceFile: "notes/current.md", sourceTitle: "current" }],
                    analyzedFiles: ["notes/current.md"],
                    analyzedAt: Date.now(),
                    tokenCost: { input: 1, output: 1 },
                }),
            });

            // Run an analysis to populate session
            await manager.analyzeFiles(
                [{ path: "notes/current.md" } as any],
                { range: "current", expectedActivePath: "notes/current.md" },
                () => false,
            );
            expect(manager.currentAnalysisFindings()).toHaveLength(1);

            // Change scope range
            manager.handleScopeRangeChange("last7");

            expect(manager.scopeRange).toBe("last7");
            expect(manager.currentAnalysisFindings()).toEqual([]);
        });
    });

    describe("complete lifecycle", () => {
        it("begin -> analyze -> finish produces expected state transitions", async () => {
            const finding: PreloadFinding = {
                text: "Consider adding links",
                sourceFile: "notes/current.md",
                sourceTitle: "current",
                suggestion: {
                    source_id: "seg-1",
                    kind: "link",
                    rationale: "This note mentions concepts covered in other notes.",
                    proposed_action: "Add wikilinks to related notes for better connectivity.",
                    related_notes: ["other-note"],
                },
            };
            const { manager } = makeManager({
                createForegroundAnalyzeCallback: () => async () => ({
                    findings: [finding],
                    analyzedFiles: ["notes/current.md"],
                    analyzedAt: Date.now(),
                    tokenCost: { input: 200, output: 100 },
                }),
            });

            // 1. Begin
            expect(manager.isForegroundRunInProgress).toBe(false);
            expect(manager.beginForegroundReviewRun()).toBe(true);
            expect(manager.isForegroundRunInProgress).toBe(true);

            // 2. Analyze
            const result = await manager.analyzeFiles(
                [{ path: "notes/current.md" } as any],
                { range: "current", expectedActivePath: "notes/current.md" },
                () => false,
            );
            expect(result).not.toBeNull();
            expect(result!.findings).toHaveLength(1);
            expect(manager.analysisSourcePath).toBe("notes/current.md");

            // 3. Findings available via accessor
            expect(manager.currentAnalysisFindings()).toHaveLength(1);

            // 4. Finish
            manager.finishForegroundReviewRun();
            expect(manager.isForegroundRunInProgress).toBe(false);

            // 5. Findings still available after finishing
            expect(manager.currentAnalysisFindings()).toHaveLength(1);

            // 6. Clear
            manager.clearAnalysisSession();
            expect(manager.currentAnalysisFindings()).toEqual([]);
            expect(manager.analysisSourcePath).toBeNull();
        });
    });

    describe("toPanelFindings", () => {
        it("maps PreloadFinding with suggestion to PanelFinding", () => {
            const { manager } = makeManager();
            const findings: PreloadFinding[] = [{
                text: "raw text",
                sourceFile: "notes/test.md",
                sourceTitle: "test",
                suggestion: {
                    source_id: "seg-1",
                    kind: "clarify",
                    rationale: "The introduction is vague and could be more specific.",
                    proposed_action: "Rewrite the opening paragraph with concrete examples.",
                    related_notes: [],
                },
            }];

            const panelFindings = manager.toPanelFindings(findings);

            expect(panelFindings).toHaveLength(1);
            expect(panelFindings[0].description).toBe("Rewrite the opening paragraph with concrete examples.");
            expect(panelFindings[0].insightText).toBe("The introduction is vague and could be more specific.");
            expect(panelFindings[0].sourceFile).toBe("notes/test.md");
            expect(panelFindings[0].suggestion).toBeDefined();
        });

        it("maps PreloadFinding without suggestion using sourceTitle as title", () => {
            const { manager } = makeManager();
            const findings: PreloadFinding[] = [{
                text: "raw finding text",
                sourceFile: "notes/test.md",
                sourceTitle: "test note",
            }];

            const panelFindings = manager.toPanelFindings(findings);

            expect(panelFindings).toHaveLength(1);
            expect(panelFindings[0].title).toBe("test note");
            expect(panelFindings[0].description).toBe("raw finding text");
        });
    });

    describe("scope accessors", () => {
        it("defaults to 'current' scope range", () => {
            const { manager } = makeManager();
            expect(manager.scopeRange).toBe("current");
        });

        it("allows setting scope range directly", () => {
            const { manager } = makeManager();
            manager.scopeRange = "last3";
            expect(manager.scopeRange).toBe("last3");
        });
    });
});
