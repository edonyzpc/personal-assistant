import { describe, expect, it, jest } from "@jest/globals";

jest.mock("obsidian", () => {
    class MockTFile {
        path: string;
        basename: string;
        extension: string;
        stat: { size: number; mtime: number; ctime: number };

        constructor(path: string, stat: { size?: number; mtime?: number; ctime?: number } = {}) {
            this.path = path;
            const name = path.split("/").pop() ?? path;
            this.extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
            this.basename = this.extension ? name.slice(0, -this.extension.length - 1) : name;
            this.stat = {
                size: stat.size ?? 100,
                mtime: stat.mtime ?? Date.now(),
                ctime: stat.ctime ?? Date.now(),
            };
        }
    }

    return {
        Notice: jest.fn(),
        TFile: MockTFile,
        normalizePath: (path: string) => path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/g, ""),
    };
});

import { Notice, TFile } from "obsidian";

import { PageletOrchestrator, type PageletHost } from "../src/pagelet/orchestrator";
import type { PageletDetailPayload } from "../src/pagelet/tab/types";
import type {
    ConfirmedMemoryRecord,
    QuietRecallBubbleNudge,
    QuietRecallCandidate,
    MaintenanceReviewRunResult,
    QuietRecallRunResult,
    ReviewQueueItem,
    SavedInsight,
    WeeklyReviewRunResult,
} from "../src/pa";

function makeTFile(path: string, stat: { size?: number; mtime?: number; ctime?: number } = {}): TFile {
    const FileCtor = TFile as unknown as {
        new(path: string, stat?: { size?: number; mtime?: number; ctime?: number }): TFile;
    };
    return new FileCtor(path, stat);
}

function makeHost(overrides: Partial<PageletHost> = {}): PageletHost {
    const activeFile = makeTFile("notes/current.md", { size: 100, mtime: Date.now() });
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
                foregroundPerHourCap: 999,
                foregroundPerDayCap: 999,
                maxInputTokens: 8000,
                maxOutputTokens: 2000,
                reviewsFolder: ".pagelet",
                periodicSummaryScope: "7d",
                excludedFolders: [],
                excludedTags: [],
                excludedPatterns: [],
                onboardingShown: true,
            },
            contextPager: {
                enabled: true,
            },
            quietRecall: {
                enabled: true,
                bubbleNudgesEnabled: false,
            },
            focusMode: false,
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
        openQuickCapture: () => undefined,
        updatePageletSetting: jest.fn(),
        openPageletDetailView: () => undefined,
        findRelatedNotes: async () => [],
        isMemoryReadyForPageletDiscovery: async () => true,
        discoverConnections: async () => null,
        listReviewQueueItems: () => [],
        listSavedInsights: () => [],
        listConfirmedMemories: () => [],
        runMaintenanceReview: async () => ({
            generatedAt: "2026-06-28T12:00:00.000Z",
            previewOnly: true,
            weeklyScanEnabled: false,
            totalCount: 0,
            categories: [
                { category: "inbox_cleanup", label: "inbox_cleanup", count: 0 },
                { category: "better_titles", label: "better_titles", count: 0 },
                { category: "weak_links", label: "weak_links", count: 0 },
            ],
            proposals: [],
        }),
        runGraphDiscovery: async () => ({
            generatedAt: "2026-06-29T12:00:00.000Z",
            totalCount: 0,
            items: [],
            skippedSourceCount: 0,
        }),
        runScopeRecap: async () => ({
            id: "recap-test",
            scope: { kind: "current_note", paths: ["notes/current.md"] },
            generatedAt: "2026-06-29T12:00:00.000Z",
            ttlDays: 30,
            staleStatus: "fresh",
            sourceCoverage: {
                totalSourceCount: 1,
                includedSourceCount: 1,
                skippedSourceCount: 0,
                coverageRatio: 1,
            },
            skippedSources: [],
            summary: {
                id: "recap-summary",
                section: "summary",
                title: "Scope summary",
                summary: "Derived helper.",
                sourceRefs: [{ path: "notes/current.md", evidenceStrength: "medium" }],
                generatedAt: "2026-06-29T12:00:00.000Z",
                generatedHelper: true,
                status: "candidate",
            },
            themes: [],
            tensions: [],
            openQuestions: [],
            nextReviewActions: [],
            sourceRefs: [{ path: "notes/current.md", evidenceStrength: "medium" }],
            dataBoundarySnapshotId: "data_boundary:scope_recap",
        }),
        runWeeklyReview: async () => ({
            generatedAt: "2026-06-29T12:00:00.000Z",
            range: {
                startDate: "2026-06-23",
                endDate: "2026-06-29",
                days: 7,
                label: "2026-06-23 to 2026-06-29",
            },
            totalCount: 0,
            sections: [],
        }),
        saveWeeklyReviewNote: async () => ({ success: true, filePath: ".pagelet/pagelet-weekly-review.md" }),
        runQuietRecall: async () => ({
            generatedAt: "2026-06-29T12:00:00.000Z",
            currentPath: "notes/current.md",
            totalCount: 0,
            candidates: [],
        }),
        saveQuietRecallAsInsight: async () => ({
            ok: false,
            reason: "not_configured",
            message: "not configured",
        }),
        recordQuietRecallFeedback: async () => ({ ok: false, reason: "disabled" }),
        createReviewQueueItem: async () => ({ ok: false, reason: "not_configured" }),
        dismissReviewQueueItem: async () => ({ ok: false, reason: "not_configured" }),
        ...overrides,
    };
    return host;
}

function makeReviewQueueItem(overrides: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
    return {
        id: overrides.id ?? "rq-current",
        type: overrides.type ?? "evidence_insight",
        title: overrides.title ?? "Current note insight",
        claim: overrides.claim ?? "This note has a saved suggestion.",
        scope: overrides.scope ?? { kind: "current_note", paths: ["notes/current.md"] },
        sourceRefs: overrides.sourceRefs ?? [{
            path: "notes/current.md",
            excerptHash: "abc123",
            whyShown: ["Saved from Pagelet review"],
            evidenceStrength: "medium",
        }],
        originSurface: overrides.originSurface ?? "pagelet",
        priority: overrides.priority ?? "normal",
        status: overrides.status ?? "suggested",
        createdAt: overrides.createdAt ?? "2026-06-28T12:00:00.000Z",
        updatedAt: overrides.updatedAt ?? "2026-06-28T12:00:00.000Z",
        whyShown: overrides.whyShown ?? ["Saved from Pagelet review"],
        dataBoundarySnapshotId: overrides.dataBoundarySnapshotId ?? "boundary-test",
        admissionReason: overrides.admissionReason ?? "user_kept_for_later",
        replayRef: overrides.replayRef,
        metadata: overrides.metadata,
        snoozedUntil: overrides.snoozedUntil,
    };
}

function makeSavedInsight(overrides: Partial<SavedInsight> = {}): SavedInsight {
    return {
        id: overrides.id ?? "ins-1",
        type: overrides.type ?? "theme",
        text: overrides.text ?? "Pricing notes keep coming back.",
        origin: overrides.origin ?? "pa-generated",
        sourceRefs: overrides.sourceRefs ?? [{
            path: "notes/current.md",
            excerptHash: "abc123",
            whyShown: ["Recurring theme"],
            evidenceStrength: "medium",
        }],
        whyShown: overrides.whyShown ?? ["Recurring theme"],
        scope: overrides.scope ?? { kind: "current_note", paths: ["notes/current.md"] },
        status: overrides.status ?? "active",
        influencePolicy: "weak-only",
        createdAt: overrides.createdAt ?? "2026-06-28T12:00:00.000Z",
        updatedAt: overrides.updatedAt ?? "2026-06-28T12:00:00.000Z",
        dataBoundarySnapshotId: overrides.dataBoundarySnapshotId,
        replayRef: overrides.replayRef,
        promotedTo: overrides.promotedTo,
    };
}

function makeMemoryRecord(overrides: Partial<ConfirmedMemoryRecord> = {}): ConfirmedMemoryRecord {
    return {
        id: overrides.id ?? "mem-1",
        type: overrides.type ?? "preference",
        lifecycle: overrides.lifecycle ?? "active",
        sensitivity: overrides.sensitivity ?? "low",
        summary: overrides.summary ?? "Prefers concise weekly planning.",
        sourceRefs: overrides.sourceRefs ?? [{
            path: "notes/current.md",
            excerptHash: "def456",
            whyShown: ["Confirmed by user"],
            evidenceStrength: "strong",
        }],
        scope: overrides.scope ?? { kind: "current_note", paths: ["notes/current.md"], label: "Current note" },
        createdAt: overrides.createdAt ?? "2026-06-28T12:00:00.000Z",
        updatedAt: overrides.updatedAt ?? "2026-06-28T12:00:00.000Z",
        confirmedAt: overrides.confirmedAt,
        archivedAt: overrides.archivedAt,
        forgottenAt: overrides.forgottenAt,
        validFrom: overrides.validFrom,
        validUntil: overrides.validUntil,
        lastVerified: overrides.lastVerified,
        updatePolicy: overrides.updatePolicy,
        confirmationStrength: overrides.confirmationStrength,
        confirmationSource: overrides.confirmationSource,
        tombstoneReason: overrides.tombstoneReason,
    };
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

    it("restores the pet state when a current-note review becomes stale", async () => {
        const activeFile = makeTFile("notes/current.md", { size: 100, mtime: Date.now() });
        const otherFile = makeTFile("notes/other.md", { size: 100, mtime: Date.now() });
        let currentActive = activeFile;
        const foregroundAnalyze = jest.fn(async () => {
            currentActive = otherFile;
            return {
                findings: [{
                    text: "Stale result",
                    sourceFile: "notes/current.md",
                    sourceTitle: "current",
                }],
                analyzedFiles: ["notes/current.md"],
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
                    getMarkdownFiles: jest.fn(() => [activeFile, otherFile]),
                    cachedRead: jest.fn(async () => "Current note body"),
                    getAbstractFileByPath: jest.fn((path: string) => (
                        [activeFile, otherFile].find((file) => file.path === path) ?? null
                    )),
                },
                metadataCache: {
                    getFileCache: jest.fn(() => null),
                },
            } as unknown as PageletHost["app"],
            createForegroundAnalyzeCallback: () => foregroundAnalyze,
        });
        const orchestrator = new PageletOrchestrator(host);
        const transition = jest.fn();
        (orchestrator as unknown as {
            petView: { stateMachine: { transition: typeof transition } };
        }).petView = {
            stateMachine: { transition },
        };

        await orchestrator.reviewCurrentNote();

        expect(foregroundAnalyze).toHaveBeenCalledTimes(1);
        expect(transition).toHaveBeenCalledWith("analysis-start");
        expect(transition).toHaveBeenCalledWith("analysis-done");
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
        const panelView = { open: jest.fn() };

        (orchestrator as unknown as {
            petView: { rootEl: HTMLElement };
            bubbleView: typeof bubbleView;
            panelView: typeof panelView;
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
            actions: Array<{ callback: () => void }>;
        }, HTMLElement];
        expect(content.type).toBe("quick-review");
        expect(content.findings).toEqual([{
            text: "Recent note has a possible follow-up.",
            sourceLink: "notes/current.md",
            sourceTitle: "current",
        }]);

        content.actions[0].callback();

        expect(bubbleView.close).toHaveBeenCalledTimes(1);
        expect(panelView.open).toHaveBeenCalledWith(
            "review",
            [expect.objectContaining({
                description: "Recent note has a possible follow-up.",
                sourceFile: "notes/current.md",
                sourceTitle: "current",
            })],
            undefined,
        );
        expect(foregroundAnalyze).not.toHaveBeenCalled();
    });

    it("closes the empty Bubble before starting review-current analysis", () => {
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
            petView: { rootEl: HTMLElement; stateMachine: { transition: jest.Mock } };
            bubbleView: typeof bubbleView;
        }).petView = {
            rootEl: {} as HTMLElement,
            stateMachine: { transition: jest.fn() },
        };
        (orchestrator as unknown as { bubbleView: typeof bubbleView }).bubbleView = bubbleView;

        orchestrator.getCommandCallbacks().onQuickReview();

        const [content] = bubbleView.show.mock.calls[0] as [{
            type: string;
            actions: Array<{ callback: () => void }>;
        }, HTMLElement];
        expect(content.type).toBe("empty");

        content.actions[0].callback();

        expect(bubbleView.close).toHaveBeenCalledTimes(1);
        expect(foregroundAnalyze).toHaveBeenCalledTimes(1);
    });
});

describe("PageletOrchestrator pet task visuals", () => {
    it("sets the task kind when a working transition starts", () => {
        const host = makeHost();
        const orchestrator = new PageletOrchestrator(host);
        const setTaskKind = jest.fn();
        const transition = jest.fn();
        const internals = orchestrator as unknown as {
            petView: {
                setTaskKind: typeof setTaskKind;
                stateMachine: { transition: typeof transition };
            };
            transitionPet(event: "analysis-start" | "analysis-done" | "insights-ready", taskKind?: "review" | "connection" | "summary" | "background"): void;
        };
        internals.petView = {
            setTaskKind,
            stateMachine: { transition },
        };

        internals.transitionPet("analysis-start", "summary");

        expect(setTaskKind).toHaveBeenCalledWith("summary");
        expect(transition).toHaveBeenCalledWith("analysis-start");
    });
});

describe("PageletOrchestrator detail expansion", () => {
    it("passes the current Discovery panel payload to the detail tab", () => {
        const openPageletDetailView = jest.fn<(_payload: PageletDetailPayload) => void>();
        const host = makeHost({ openPageletDetailView });
        const orchestrator = new PageletOrchestrator(host);
        const findings = [{
            title: "Diary thread",
            description: "Shared diary thread",
            insightText: "Current note links to a related diary note.",
            sourceFile: "Diary-2023-04-03.md",
            sourceTitle: "Diary-2023-04-03",
        }];
        const extra = {
            connections: [{
                fromNote: "2.fleeting/Test-2023-04-08.md",
                toNote: "Diary-2023-04-03.md",
                strength: "medium" as const,
                sharedConcepts: ["diary thread"],
            }],
            sourcePath: "2.fleeting/Test-2023-04-08.md",
            scope: {
                range: "last7" as const,
                candidates: [],
                includedCount: 0,
                skippedCount: 0,
            },
        };
        const panelView = {
            currentLayoutType: "discover" as const,
            currentVisibleFindings: findings,
            currentPanelExtra: extra,
            close: jest.fn(),
        };
        const internals = orchestrator as unknown as {
            panelView: typeof panelView;
            currentPanelLayout: "discover";
            expandPanelToTab(): void;
        };
        internals.panelView = panelView;
        internals.currentPanelLayout = "discover";

        internals.expandPanelToTab();

        expect(panelView.close).toHaveBeenCalledTimes(1);
        expect(openPageletDetailView).toHaveBeenCalledWith({
            title: "Pagelet — Detail View",
            content: findings,
            locale: "en",
            layoutType: "discover",
            extra: {
                connections: extra.connections,
            },
            sourcePath: "2.fleeting/Test-2023-04-08.md",
        });
    });

    it("passes the current Periodic Summary markdown payload to the detail tab", () => {
        const openPageletDetailView = jest.fn<(_payload: PageletDetailPayload) => void>();
        const host = makeHost({ openPageletDetailView });
        const orchestrator = new PageletOrchestrator(host);
        const markdown = "# Periodic Summary\n\nA concise periodic summary.";
        const findings = [{
            title: "pagelet-weekly-review.md",
            description: markdown,
        }];
        const extra = {
            markdown,
            scope: {
                range: "last7" as const,
                candidates: [],
                includedCount: 0,
                skippedCount: 0,
            },
        };
        const pendingNote = {
            fileName: "pagelet-weekly-review.md",
            markdown,
            targetFolder: ".pagelet",
            targetPath: ".pagelet/pagelet-weekly-review.md",
            sources: ["notes/current.md"],
            tokenCost: { input: 1, output: 2 },
        };
        let onPanelClose = (): void => undefined;
        const panelView = {
            currentLayoutType: "summary" as const,
            currentVisibleFindings: findings,
            currentPanelExtra: extra,
            close: jest.fn(() => onPanelClose()),
        };
        const internals = orchestrator as unknown as {
            panelView: typeof panelView;
            currentPanelLayout: "summary";
            saveFlow: {
                pending: { targetPath: string } | null;
                setPending(note: {
                    fileName: string;
                    markdown: string;
                    targetFolder: string;
                    targetPath: string;
                    sources: string[];
                    tokenCost: { input: number; output: number };
                }): void;
            };
            expandPanelToTab(): void;
            clearPanelSession(): void;
        };
        internals.panelView = panelView;
        internals.currentPanelLayout = "summary";
        onPanelClose = () => internals.clearPanelSession();
        internals.saveFlow.setPending(pendingNote);

        internals.expandPanelToTab();

        expect(panelView.close).toHaveBeenCalledTimes(1);
        expect(internals.saveFlow.pending?.targetPath).toBe(".pagelet/pagelet-weekly-review.md");
        expect(openPageletDetailView).toHaveBeenCalledWith({
            title: "Pagelet — Detail View",
            content: findings,
            locale: "en",
            layoutType: "summary",
            extra: { markdown },
            sourcePath: ".pagelet/pagelet-weekly-review.md",
            summarySaveNote: pendingNote,
        });
    });

    it("attaches global Saved Insight and Memory ledgers when expanding to the detail tab", () => {
        const openPageletDetailView = jest.fn<(_payload: PageletDetailPayload) => void>();
        const listSavedInsights = jest.fn(() => [makeSavedInsight()]);
        const listConfirmedMemories = jest.fn(() => [makeMemoryRecord()]);
        const host = makeHost({
            openPageletDetailView,
            listSavedInsights,
            listConfirmedMemories,
        });
        const orchestrator = new PageletOrchestrator(host);
        const panelView = {
            currentLayoutType: "review" as const,
            currentVisibleFindings: [],
            currentPanelExtra: undefined,
            close: jest.fn(),
        };
        const internals = orchestrator as unknown as {
            panelView: typeof panelView;
            currentPanelLayout: "review";
            expandPanelToTab(): void;
        };
        internals.panelView = panelView;
        internals.currentPanelLayout = "review";

        internals.expandPanelToTab();

        expect(listSavedInsights).toHaveBeenCalledTimes(1);
        expect(listConfirmedMemories).toHaveBeenCalledTimes(1);
        expect(openPageletDetailView).toHaveBeenCalledWith(expect.objectContaining({
            extra: expect.objectContaining({
                savedInsights: expect.objectContaining({
                    totalCount: 1,
                    items: [expect.objectContaining({ id: "ins-1" })],
                }),
                memoryGovernance: expect.objectContaining({
                    totalCount: 1,
                    records: [expect.objectContaining({ id: "mem-1" })],
                }),
            }),
        }));
    });

    it("runs manual Maintenance Review and opens preview results in the native detail tab", async () => {
        const maintenanceReview: MaintenanceReviewRunResult = {
            generatedAt: "2026-06-28T12:00:00.000Z",
            previewOnly: true,
            weeklyScanEnabled: false,
            totalCount: 1,
            categories: [
                { category: "inbox_cleanup", label: "inbox_cleanup", count: 1 },
                { category: "better_titles", label: "better_titles", count: 0 },
                { category: "weak_links", label: "weak_links", count: 0 },
            ],
            proposals: [{
                id: "maint-1",
                category: "inbox_cleanup",
                actionType: "move",
                title: "Review inbox note destination",
                claim: "Inbox/Untitled.md appears to be in an inbox.",
                confidence: "medium",
                scope: { kind: "current_note", paths: ["Inbox/Untitled.md"] },
                sourceRefs: [{ path: "Inbox/Untitled.md", evidenceStrength: "medium" }],
                preview: {
                    summary: "Preview move.",
                    sourcePath: "Inbox/Untitled.md",
                    affectedPaths: ["Inbox/Untitled.md", "Notes/Untitled.md"],
                    oldPath: "Inbox/Untitled.md",
                    newPath: "Notes/Untitled.md",
                },
                undoMetadata: {
                    strategy: "move_back",
                    affectedPaths: ["Inbox/Untitled.md", "Notes/Untitled.md"],
                    oldPath: "Inbox/Untitled.md",
                    newPath: "Notes/Untitled.md",
                    reversible: true,
                },
                actionPlan: {
                    actionType: "move",
                    previewOnly: true,
                    applyBoundary: "blocked_until_user_approval",
                },
                whyShown: ["Inbox note"],
                dataBoundarySnapshotId: "boundary",
                generatedAt: "2026-06-28T12:00:00.000Z",
            }],
        };
        const runMaintenanceReview = jest.fn(async (_options?: { enqueueProposals?: boolean }) => maintenanceReview);
        const openPageletDetailView = jest.fn<(_payload: PageletDetailPayload) => void>();
        const createReviewQueueItem = jest.fn(async (_input: Parameters<PageletHost["createReviewQueueItem"]>[0]) => ({
            ok: true as const,
            value: makeReviewQueueItem({ id: "rq-maintenance" }),
        }));
        const host = makeHost({
            runMaintenanceReview,
            openPageletDetailView,
            createReviewQueueItem,
            listReviewQueueItems: () => [
                makeReviewQueueItem({
                    id: "rq-maintenance",
                    type: "maintenance_proposal",
                    title: "Review inbox note destination",
                    claim: "Preview only.",
                    originSurface: "maintenance",
                }),
            ],
        });
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            runMaintenanceReview(): Promise<void>;
        };

        await internals.runMaintenanceReview();

        expect(runMaintenanceReview).toHaveBeenCalledTimes(1);
        expect(runMaintenanceReview).toHaveBeenCalledWith({ enqueueProposals: false });
        expect(createReviewQueueItem).not.toHaveBeenCalled();
        expect(openPageletDetailView).toHaveBeenCalledWith(expect.objectContaining({
            title: "Maintenance Review",
            content: [],
            layoutType: "review",
            extra: expect.objectContaining({
                maintenanceReview: expect.objectContaining({
                    totalCount: 1,
                    previewOnly: true,
                    weeklyScanEnabled: false,
                }),
                reviewQueue: expect.objectContaining({
                    totalCount: 1,
                    items: [expect.objectContaining({ id: "rq-maintenance", type: "maintenance_proposal" })],
                }),
            }),
        }));
    });

    it("runs local Graph Discovery and opens preview suggestions in the native detail tab without queue growth", async () => {
        const runGraphDiscovery = jest.fn(async (_options?: { enqueueItems?: boolean }) => ({
            generatedAt: "2026-06-29T12:00:00.000Z",
            totalCount: 1,
            skippedSourceCount: 0,
            items: [{
                id: "graph-theme",
                type: "theme_chain" as const,
                title: "Theme chain: #pa",
                claim: "Review before turning this into durable structure.",
                scope: { kind: "selected_notes" as const, paths: ["notes/a.md", "notes/b.md"] },
                sourceRefs: [{ path: "notes/a.md", evidenceStrength: "medium" as const }],
                whyShown: ["#pa appears across several source notes."],
                edgeState: "suggested" as const,
                outcomeStatus: "reviewable" as const,
                generatedAt: "2026-06-29T12:00:00.000Z",
                metadata: {
                    graphDiscoveryType: "theme_chain",
                    edgeState: "suggested",
                    outcomeStatus: "reviewable",
                },
            }],
        }));
        const openPageletDetailView = jest.fn<(_payload: PageletDetailPayload) => void>();
        const host = makeHost({
            runGraphDiscovery,
            openPageletDetailView,
        });
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            runGraphDiscovery(): Promise<void>;
        };

        await internals.runGraphDiscovery();

        expect(runGraphDiscovery).toHaveBeenCalledTimes(1);
        expect(runGraphDiscovery).toHaveBeenCalledWith({ enqueueItems: false });
        expect(openPageletDetailView).toHaveBeenCalledWith(expect.objectContaining({
            title: "Graph Suggestions",
            content: [],
            layoutType: "review",
            extra: expect.objectContaining({
                graphDiscovery: expect.objectContaining({
                    totalCount: 1,
                    items: [expect.objectContaining({ id: "graph-theme", type: "theme_chain" })],
                }),
            }),
        }));
    });

    it("runs Scope Recap and opens a read-only summary preview until items are accepted", async () => {
        const runScopeRecap = jest.fn(async () => ({
            id: "recap-test",
            scope: { kind: "folder" as const, label: "notes", paths: ["notes/current.md", "notes/related.md"] },
            generatedAt: "2026-06-29T12:00:00.000Z",
            ttlDays: 30,
            staleStatus: "fresh" as const,
            sourceCoverage: {
                totalSourceCount: 2,
                includedSourceCount: 2,
                skippedSourceCount: 0,
                coverageRatio: 1,
            },
            skippedSources: [],
            summary: {
                id: "recap-summary",
                section: "summary" as const,
                title: "Scope summary",
                summary: "Derived helper.",
                sourceRefs: [{ path: "notes/current.md", evidenceStrength: "medium" as const }],
                generatedAt: "2026-06-29T12:00:00.000Z",
                generatedHelper: true as const,
                status: "candidate" as const,
            },
            themes: [{
                id: "recap-theme",
                section: "theme" as const,
                title: "Theme: #pa",
                summary: "#pa appears across source notes.",
                sourceRefs: [{ path: "notes/current.md", evidenceStrength: "medium" as const }],
                generatedAt: "2026-06-29T12:00:00.000Z",
                generatedHelper: true as const,
                status: "candidate" as const,
            }],
            tensions: [],
            openQuestions: [],
            nextReviewActions: [],
            sourceRefs: [{ path: "notes/current.md", evidenceStrength: "medium" as const }],
            dataBoundarySnapshotId: "data_boundary:scope_recap",
        }));
        const openPageletDetailView = jest.fn<(_payload: PageletDetailPayload) => void>();
        const host = makeHost({
            runScopeRecap,
            openPageletDetailView,
        });
        const orchestrator = new PageletOrchestrator(host);

        await orchestrator.getCommandCallbacks().onScopeRecap();

        expect(runScopeRecap).toHaveBeenCalledTimes(1);
        expect(openPageletDetailView).toHaveBeenCalledWith(expect.objectContaining({
            title: "Scope Recap",
            content: [],
            layoutType: "summary",
            sourcePath: "notes/current.md",
            extra: expect.objectContaining({
                markdown: expect.stringContaining("Coverage: 2/2 source notes"),
            }),
        }));
        const payload = openPageletDetailView.mock.calls[0]?.[0];
        expect(payload?.summarySaveNote).toBeUndefined();
        expect(payload?.extra?.markdown).not.toContain("Theme: #pa");
    });

    it("runs manual Weekly Review and opens selected-only review state in the native detail tab", async () => {
        const weeklyReview: WeeklyReviewRunResult = {
            generatedAt: "2026-06-29T12:00:00.000Z",
            range: {
                startDate: "2026-06-23",
                endDate: "2026-06-29",
                days: 7,
                label: "2026-06-23 to 2026-06-29",
            },
            totalCount: 1,
            sections: [{
                type: "saved_insights",
                title: "Saved insights",
                summary: "1 item",
                items: [{
                    id: "weekly-insight-1",
                    section: "saved_insights",
                    title: "theme",
                    summary: "Review cadence matters.",
                    status: "candidate",
                    sourceRefs: [{ path: "notes/current.md", evidenceStrength: "medium" }],
                    whyShown: ["Saved insight."],
                    generatedAt: "2026-06-29T12:00:00.000Z",
                    savedInsightId: "ins-1",
                }],
            }],
        };
        const runWeeklyReview = jest.fn(async () => weeklyReview);
        const openPageletDetailView = jest.fn<(_payload: PageletDetailPayload) => void>();
        const host = makeHost({
            runWeeklyReview,
            openPageletDetailView,
        });
        const orchestrator = new PageletOrchestrator(host);

        await orchestrator.getCommandCallbacks().onWeeklyReview();

        expect(runWeeklyReview).toHaveBeenCalledTimes(1);
        expect(openPageletDetailView).toHaveBeenCalledWith(expect.objectContaining({
            title: "Weekly Review",
            content: [],
            layoutType: "review",
            extra: expect.objectContaining({
                weeklyReview: expect.objectContaining({
                    totalCount: 1,
                    range: expect.objectContaining({ label: "2026-06-23 to 2026-06-29" }),
                }),
            }),
        }));
    });

    it("runs Quiet Recall and opens recall candidates in the native detail tab", async () => {
        const quietRecall: QuietRecallRunResult = {
            generatedAt: "2026-06-29T12:00:00.000Z",
            currentPath: "notes/current.md",
            totalCount: 1,
            candidates: [{
                id: "qr-ins-1",
                title: "Recall: current",
                summary: "A saved insight may matter now.",
                sourceInsightId: "ins-1",
                sourceRefs: [{ path: "notes/current.md", evidenceStrength: "medium" }],
                whyNow: ["Source matches the note you are looking at."],
                nextAction: "Compare this saved insight with the current note.",
                relation: "current",
                score: 90,
                generatedAt: "2026-06-29T12:00:00.000Z",
            }],
        };
        const runQuietRecall = jest.fn(async () => quietRecall);
        const openPageletDetailView = jest.fn<(_payload: PageletDetailPayload) => void>();
        const host = makeHost({
            runQuietRecall,
            openPageletDetailView,
        });
        const orchestrator = new PageletOrchestrator(host);

        await orchestrator.getCommandCallbacks().onQuietRecall();

        expect(runQuietRecall).toHaveBeenCalledTimes(1);
        expect(openPageletDetailView).toHaveBeenCalledWith(expect.objectContaining({
            title: "Quiet Recall",
            content: [],
            layoutType: "current",
            sourcePath: "notes/current.md",
            extra: expect.objectContaining({
                quietRecall: expect.objectContaining({
                    totalCount: 1,
                    candidates: [expect.objectContaining({ id: "qr-ins-1" })],
                }),
            }),
        }));
    });

    it("keeps slower stale foreground routes from replacing newer detail content", async () => {
        const weeklyReview: WeeklyReviewRunResult = {
            generatedAt: "2026-06-29T12:00:00.000Z",
            range: {
                startDate: "2026-06-23",
                endDate: "2026-06-29",
                days: 7,
                label: "2026-06-23 to 2026-06-29",
            },
            totalCount: 0,
            sections: [],
        };
        const quietRecall: QuietRecallRunResult = {
            generatedAt: "2026-06-29T12:01:00.000Z",
            currentPath: "notes/current.md",
            totalCount: 0,
            candidates: [],
        };
        let resolveWeekly!: (value: WeeklyReviewRunResult) => void;
        const weeklyGate = new Promise<WeeklyReviewRunResult>((resolve) => {
            resolveWeekly = resolve;
        });
        const runWeeklyReview = jest.fn(() => weeklyGate);
        const runQuietRecall = jest.fn(async () => quietRecall);
        const openPageletDetailView = jest.fn<(_payload: PageletDetailPayload) => void>();
        const host = makeHost({
            runWeeklyReview,
            runQuietRecall,
            openPageletDetailView,
        });
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            runWeeklyReview(): Promise<void>;
            runQuietRecall(): Promise<void>;
        };

        const oldWeeklyRun = internals.runWeeklyReview();
        await Promise.resolve();
        await internals.runQuietRecall();
        resolveWeekly(weeklyReview);
        await oldWeeklyRun;

        expect(openPageletDetailView).toHaveBeenCalledTimes(1);
        expect(openPageletDetailView).toHaveBeenCalledWith(expect.objectContaining({
            title: "Quiet Recall",
            extra: expect.objectContaining({ quietRecall }),
        }));
    });
});

describe("PageletOrchestrator review panel scope flow", () => {
    it("does not open an empty prepared-findings panel", () => {
        const host = makeHost();
        const orchestrator = new PageletOrchestrator(host);
        const panelView = { open: jest.fn() };
        (orchestrator as unknown as { panelView: typeof panelView }).panelView = panelView;

        (orchestrator as unknown as {
            handleExpandPanel(type?: string): void;
        }).handleExpandPanel("prepared");

        expect(panelView.open).not.toHaveBeenCalled();
        expect(Notice).toHaveBeenCalledWith("No background suggestions are available yet.", 4000);
    });

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

    it("adds current-scope Review Queue items through the host without starting provider work", () => {
        const foregroundAnalyze = jest.fn(async () => ({
            findings: [],
            analyzedFiles: ["notes/current.md"],
            analyzedAt: Date.now(),
            tokenCost: { input: 0, output: 0 },
        }));
        const listReviewQueueItems = jest.fn((filter: { scopePaths?: readonly string[] } = {}) => {
            return filter.scopePaths?.includes("notes/current.md")
                ? [makeReviewQueueItem()]
                : [];
        });
        const host = makeHost({
            createForegroundAnalyzeCallback: () => foregroundAnalyze,
            listReviewQueueItems,
        });
        const orchestrator = new PageletOrchestrator(host);
        const panelView = { open: jest.fn() };
        (orchestrator as unknown as { panelView: typeof panelView }).panelView = panelView;

        orchestrator.openPanel();

        expect(foregroundAnalyze).not.toHaveBeenCalled();
        expect(listReviewQueueItems).toHaveBeenCalledWith(expect.objectContaining({
            statuses: expect.arrayContaining(["suggested", "accepted", "edited", "snoozed", "failed"]),
            scopePaths: expect.arrayContaining(["notes/current.md"]),
        }));
        expect(panelView.open).toHaveBeenCalledWith(
            "review",
            [],
            expect.objectContaining({
                contextPager: expect.objectContaining({
                    summary: expect.objectContaining({ usedSourceCount: 1 }),
                }),
                reviewQueue: expect.objectContaining({
                    items: [expect.objectContaining({ id: "rq-current" })],
                }),
            }),
        );
    });

    it("does not attach Context Pager state when the setting is disabled", () => {
        const host = makeHost({
            settings: {
                ...makeHost().settings,
                contextPager: { enabled: false },
            },
        });
        const orchestrator = new PageletOrchestrator(host);
        const panelView = { open: jest.fn() };
        (orchestrator as unknown as { panelView: typeof panelView }).panelView = panelView;

        orchestrator.openPanel();

        expect(panelView.open).toHaveBeenCalledWith(
            "review",
            [],
            expect.not.objectContaining({
                contextPager: expect.anything(),
            }),
        );
    });

    it("saves Pagelet review notes without creating Review Queue work", async () => {
        const createReviewQueueItem = jest.fn(async (_input: unknown) => ({
            ok: true as const,
            value: makeReviewQueueItem(),
        }));
        const writeReviewNote = jest.fn(async () => ({ success: true as const, filePath: ".pagelet/current-review.md" }));
        const host = makeHost({
            createReviewQueueItem,
            writeReviewNote,
        });
        const orchestrator = new PageletOrchestrator(host);
        const save = (orchestrator as unknown as {
            saveFindingsAsReviewNote(findings: Array<{
                title: string;
                description: string;
                sourceFile?: string;
                sourceTitle?: string;
                suggestion?: {
                    source_id: string;
                    kind: string;
                    rationale: string;
                    proposed_action: string;
                    related_notes: string[];
                };
            }>): Promise<void>;
        }).saveFindingsAsReviewNote.bind(orchestrator);

        await save([{
            title: "Clarify evidence",
            description: "Add evidence to the claim.",
            sourceFile: "notes/current.md",
            sourceTitle: "current",
            suggestion: {
                source_id: "seg-1",
                kind: "evidence",
                rationale: "The claim needs a citation.",
                proposed_action: "Add a citation after the claim.",
                related_notes: [],
            },
        }]);

        expect(writeReviewNote).toHaveBeenCalledTimes(1);
        expect(createReviewQueueItem).not.toHaveBeenCalled();
    });

    it("keeps explicit multi-note selected review results after active note changes", async () => {
        const now = Date.now();
        const activeFile = makeTFile("notes/current.md", { size: 100, mtime: now });
        const recentFile = makeTFile("notes/recent.md", { size: 100, mtime: now - 86_400_000 });
        const otherFile = makeTFile("notes/other.md", { size: 100, mtime: now - 10 * 86_400_000 });
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
            expect.objectContaining({
                sourcePath: "notes/current.md",
                contextPager: expect.objectContaining({
                    summary: expect.objectContaining({ usedSourceCount: 1 }),
                }),
            }),
        );
    });

    it("uses explicit wikilinks as Discovery connections when Memory related-note search is unavailable", async () => {
        const currentFile = makeTFile("notes/current.md");
        const linkedFile = makeTFile("notes/linked.md");
        const panelView = { open: jest.fn() };
        const findRelatedNotes = jest.fn<PageletHost["findRelatedNotes"]>(async () => []);
        const discoverConnections = jest.fn<PageletHost["discoverConnections"]>(async () => null);
        const host = makeHost({
            app: {
                workspace: {
                    getActiveFile: jest.fn(() => currentFile),
                },
                vault: {
                    getMarkdownFiles: jest.fn(() => [currentFile, linkedFile]),
                    cachedRead: jest.fn(async (file: TFile) => (
                        file.path === linkedFile.path
                            ? "Linked note body"
                            : "Current note body with [[linked]]"
                    )),
                    getAbstractFileByPath: jest.fn((path: string) => (
                        [currentFile, linkedFile].find((file) => file.path === path) ?? null
                    )),
                },
                metadataCache: {
                    getFileCache: jest.fn((file: TFile) => (
                        file.path === currentFile.path
                            ? { links: [{ link: "linked", original: "[[linked]]" }] }
                            : null
                    )),
                    getFirstLinkpathDest: jest.fn((linkpath: string, sourcePath: string) => (
                        linkpath === "linked" && sourcePath === currentFile.path
                            ? linkedFile
                            : null
                    )),
                },
            } as unknown as PageletHost["app"],
            findRelatedNotes,
            isMemoryReadyForPageletDiscovery: async () => false,
            discoverConnections,
        });
        const orchestrator = new PageletOrchestrator(host);
        (orchestrator as unknown as { panelView: typeof panelView }).panelView = panelView;

        await (orchestrator as unknown as { discoverConnections(): Promise<void> }).discoverConnections();

        expect(findRelatedNotes).toHaveBeenCalledWith(
            "notes/current.md",
            [{ path: "notes/current.md", content: "Current note body with [[linked]]" }],
            ["notes/current.md", "notes/linked.md"],
        );
        expect(discoverConnections).toHaveBeenCalledWith(
            { path: "notes/current.md", content: "Current note body with [[linked]]" },
            [{ path: "notes/linked.md", content: "Linked note body" }],
        );
        expect(discoverConnections.mock.invocationCallOrder[0]).toBeLessThan(
            panelView.open.mock.invocationCallOrder[0],
        );
        expect(panelView.open).toHaveBeenCalledWith(
            "discover",
            [expect.objectContaining({
                title: "Existing wikilink",
                sourceFile: "notes/linked.md",
                sourceTitle: "linked",
            })],
            expect.objectContaining({
                connections: [expect.objectContaining({
                    fromNote: "notes/current.md",
                    toNote: "notes/linked.md",
                    strength: "strong",
                    sharedConcepts: ["Existing wikilink"],
                })],
                sourcePath: "notes/current.md",
            }),
        );
    });

    it("keeps explicit wikilink Discovery visible when AI enrichment fails", async () => {
        const currentFile = makeTFile("notes/current.md");
        const linkedFile = makeTFile("notes/linked.md");
        const panelView = { open: jest.fn() };
        const log = jest.fn();
        const discoverConnections = jest.fn<PageletHost["discoverConnections"]>(async () => {
            throw new Error("provider unavailable");
        });
        const host = makeHost({
            app: {
                workspace: {
                    getActiveFile: jest.fn(() => currentFile),
                },
                vault: {
                    getMarkdownFiles: jest.fn(() => [currentFile, linkedFile]),
                    cachedRead: jest.fn(async (file: TFile) => (
                        file.path === linkedFile.path
                            ? "Linked note body"
                            : "Current note body with [[linked]]"
                    )),
                    getAbstractFileByPath: jest.fn((path: string) => (
                        [currentFile, linkedFile].find((file) => file.path === path) ?? null
                    )),
                },
                metadataCache: {
                    getFileCache: jest.fn((file: TFile) => (
                        file.path === currentFile.path
                            ? { links: [{ link: "linked", original: "[[linked]]" }] }
                            : null
                    )),
                    getFirstLinkpathDest: jest.fn((linkpath: string, sourcePath: string) => (
                        linkpath === "linked" && sourcePath === currentFile.path
                            ? linkedFile
                            : null
                    )),
                },
            } as unknown as PageletHost["app"],
            findRelatedNotes: async () => [],
            log,
            discoverConnections,
        });
        const orchestrator = new PageletOrchestrator(host);
        (orchestrator as unknown as { panelView: typeof panelView }).panelView = panelView;

        await expect(
            (orchestrator as unknown as { discoverConnections(): Promise<void> }).discoverConnections(),
        ).resolves.toBeUndefined();

        expect(discoverConnections).toHaveBeenCalledTimes(1);
        expect(discoverConnections.mock.invocationCallOrder[0]).toBeLessThan(
            panelView.open.mock.invocationCallOrder[0],
        );
        expect(panelView.open).toHaveBeenCalledTimes(1);
        expect(panelView.open).toHaveBeenCalledWith(
            "discover",
            [expect.objectContaining({
                title: "Existing wikilink",
                sourceFile: "notes/linked.md",
                sourceTitle: "linked",
            })],
            expect.objectContaining({
                connections: [expect.objectContaining({
                    fromNote: "notes/current.md",
                    toNote: "notes/linked.md",
                    sharedConcepts: ["Existing wikilink"],
                })],
                sourcePath: "notes/current.md",
            }),
        );
        expect(log).toHaveBeenCalledWith("Discovery AI analysis failed; showing explicit wikilinks", expect.any(Error));
    });

    it("does not read explicit wikilink targets excluded by Pagelet scope", async () => {
        const currentFile = makeTFile("notes/current.md");
        const linkedFile = makeTFile("private/linked.md");
        const panelView = { open: jest.fn() };
        const cachedRead = jest.fn(async (file: TFile) => (
            file.path === linkedFile.path
                ? "Private linked note body"
                : "Current note body with [[linked]]"
        ));
        const discoverConnections = jest.fn<PageletHost["discoverConnections"]>(async () => null);
        const host = makeHost({
            app: {
                workspace: {
                    getActiveFile: jest.fn(() => currentFile),
                },
                vault: {
                    getMarkdownFiles: jest.fn(() => [currentFile, linkedFile]),
                    cachedRead,
                    getAbstractFileByPath: jest.fn((path: string) => (
                        [currentFile, linkedFile].find((file) => file.path === path) ?? null
                    )),
                },
                metadataCache: {
                    getFileCache: jest.fn((file: TFile) => {
                        if (file.path === currentFile.path) {
                            return { links: [{ link: "linked", original: "[[linked]]" }] };
                        }
                        if (file.path === linkedFile.path) {
                            return { tags: [{ tag: "#no-ai" }] };
                        }
                        return null;
                    }),
                    getFirstLinkpathDest: jest.fn((linkpath: string, sourcePath: string) => (
                        linkpath === "linked" && sourcePath === currentFile.path
                            ? linkedFile
                            : null
                    )),
                },
            } as unknown as PageletHost["app"],
            findRelatedNotes: async () => [],
            isMemoryReadyForPageletDiscovery: async () => false,
            discoverConnections,
        });
        const orchestrator = new PageletOrchestrator(host);
        (orchestrator as unknown as { panelView: typeof panelView }).panelView = panelView;

        await (orchestrator as unknown as { discoverConnections(): Promise<void> }).discoverConnections();

        expect(discoverConnections).not.toHaveBeenCalled();
        expect(cachedRead).toHaveBeenCalledTimes(1);
        expect(cachedRead).toHaveBeenCalledWith(currentFile);
        expect(panelView.open).toHaveBeenCalledWith(
            "discover",
            [expect.objectContaining({
                title: "Enable Memory to Discover Connections",
                sourceFile: "",
            })],
            expect.objectContaining({
                sourcePath: "notes/current.md",
                contextPager: expect.objectContaining({
                    summary: expect.objectContaining({ usedSourceCount: 1 }),
                }),
            }),
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
                sourcePath: "notes/current.md",
            }),
        );
    });

    it("coalesces repeated Discovery runs while provider work is in flight", async () => {
        let releaseFirst!: () => void;
        const firstGate = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        let markProviderStarted!: () => void;
        const providerStarted = new Promise<void>((resolve) => {
            markProviderStarted = resolve;
        });
        let callCount = 0;
        const host = makeHost({
            findRelatedNotes: async () => [{
                path: "notes/related.md",
                content: "Related note body",
                score: 0.82,
            }],
            discoverConnections: async () => {
                callCount++;
                markProviderStarted();
                if (callCount === 1) {
                    await firstGate;
                }
                return {
                    connections: [{
                        fromNote: "notes/current.md",
                        toNote: "notes/related.md",
                        strength: "medium" as const,
                        sharedConcepts: ["shared concept"],
                    }],
                    themes: [],
                    gaps: [],
                };
            },
        });
        const orchestrator = new PageletOrchestrator(host);

        const first = (orchestrator as unknown as {
            discoverConnections(): Promise<void>;
        }).discoverConnections();
        await providerStarted;
        const second = (orchestrator as unknown as {
            discoverConnections(): Promise<void>;
        }).discoverConnections();

        await second;
        expect(callCount).toBe(1);

        releaseFirst();
        await first;

        await (orchestrator as unknown as {
            discoverConnections(): Promise<void>;
        }).discoverConnections();
        expect(callCount).toBe(2);
    });

    it("drops Discovery results when the active note changes before publish", async () => {
        const currentFile = makeTFile("notes/current.md");
        const otherFile = makeTFile("notes/other.md");
        let activeFile = currentFile;
        const panelView = { open: jest.fn() };
        const host = makeHost({
            app: {
                workspace: {
                    getActiveFile: jest.fn(() => activeFile),
                },
                vault: {
                    getMarkdownFiles: jest.fn(() => [currentFile, otherFile]),
                    cachedRead: jest.fn(async () => "Current note body"),
                    getAbstractFileByPath: jest.fn((path: string) => (
                        [currentFile, otherFile].find((file) => file.path === path) ?? null
                    )),
                },
                metadataCache: {
                    getFileCache: jest.fn(() => null),
                },
            } as unknown as PageletHost["app"],
            findRelatedNotes: async () => {
                activeFile = otherFile;
                return [];
            },
            isMemoryReadyForPageletDiscovery: async () => true,
        });
        const orchestrator = new PageletOrchestrator(host);
        (orchestrator as unknown as { panelView: typeof panelView }).panelView = panelView;

        await (orchestrator as unknown as { discoverConnections(): Promise<void> }).discoverConnections();

        expect(panelView.open).not.toHaveBeenCalled();
    });

    it("clears stale periodic-summary pending state before saving Discovery findings", async () => {
        const writeReviewNote = jest.fn(async (_note: unknown) => ({ success: true, filePath: ".pagelet/discovery.md" }));
        const panelView = { open: jest.fn(), close: jest.fn() };
        const host = makeHost({
            writeReviewNote,
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
        const internals = orchestrator as unknown as {
            panelView: typeof panelView;
            currentPanelLayout: "summary" | "discover" | null;
            saveFlow: {
                pending: { targetPath: string } | null;
                setPending(note: {
                    fileName: string;
                    markdown: string;
                    targetFolder: string;
                    targetPath: string;
                    sources: string[];
                    tokenCost: { input: number; output: number };
                }): void;
            };
            discoverConnections(): Promise<void>;
            saveFindingsAsReviewNote(findings: Array<{
                title: string;
                description: string;
                sourceFile?: string;
                sourceTitle?: string;
            }>): Promise<void>;
        };
        internals.panelView = panelView;
        internals.currentPanelLayout = "summary";
        internals.saveFlow.setPending({
            fileName: "pagelet-weekly-review.md",
            markdown: "# Old summary",
            targetFolder: ".pagelet",
            targetPath: ".pagelet/pagelet-weekly-review.md",
            sources: ["notes/current.md"],
            tokenCost: { input: 1, output: 2 },
        });

        await internals.discoverConnections();
        await internals.saveFindingsAsReviewNote([{
            title: "shared concept",
            description: "shared concept",
            sourceFile: "notes/related.md",
            sourceTitle: "related",
        }]);

        expect(internals.currentPanelLayout).toBe("discover");
        expect(internals.saveFlow.pending).toBeNull();
        expect(writeReviewNote).toHaveBeenCalledWith(expect.objectContaining({
            fileName: expect.stringMatching(/^pagelet-discovery-current-/),
            targetPath: expect.stringContaining("pagelet-discovery-current-"),
        }));
        expect(writeReviewNote).not.toHaveBeenCalledWith(expect.objectContaining({
            targetPath: ".pagelet/pagelet-weekly-review.md",
        }));
    });

    it("keeps Quiet Recall Bubble dismiss and later as local UI state", () => {
        const recordQuietRecallFeedback = jest.fn(async (
            _candidate: QuietRecallCandidate,
            _feedback: "view" | "accept" | "dismiss" | "later" | "not_relevant",
        ) => ({ ok: false as const, reason: "disabled" as const }));
        const saveQuietRecallAsInsight = jest.fn(async () => ({
            ok: false as const,
            reason: "not_configured",
            message: "not configured",
        }));
        const createReviewQueueItem = jest.fn(async () => ({ ok: false as const, reason: "not_configured" }));
        const candidate: QuietRecallCandidate = {
            id: "qr-ins-local",
            title: "Recall: Local",
            summary: "Local detail should not move into Bubble state.",
            sourceInsightId: "ins-local",
            sourceRefs: [{ path: "notes/current.md", evidenceStrength: "medium" }],
            whyNow: ["Source matches the note you are looking at."],
            nextAction: "Compare this saved insight with the current note.",
            relation: "current",
            score: 88,
            generatedAt: "2026-06-29T12:00:00.000Z",
        };
        const nudge: QuietRecallBubbleNudge = {
            candidateId: candidate.id,
            sourceInsightId: candidate.sourceInsightId,
            relation: candidate.relation,
            generatedAt: candidate.generatedAt,
        };
        const host = makeHost({
            recordQuietRecallFeedback,
            saveQuietRecallAsInsight,
            createReviewQueueItem,
        });
        const orchestrator = new PageletOrchestrator(host);
        const bubbleView = { close: jest.fn() };
        const internals = orchestrator as unknown as {
            bubbleView: typeof bubbleView;
            quietRecallNudgeCandidate: QuietRecallCandidate | null;
            quietRecallBubbleNudge: QuietRecallBubbleNudge | null;
            handleQuietRecallBubbleDismiss(nudge: QuietRecallBubbleNudge): void;
            handleQuietRecallBubbleLater(nudge: QuietRecallBubbleNudge): void;
            isQuietRecallCandidateSuppressed(candidateId: string, now?: number): boolean;
        };

        internals.bubbleView = bubbleView;
        internals.quietRecallNudgeCandidate = candidate;
        internals.quietRecallBubbleNudge = nudge;
        internals.handleQuietRecallBubbleDismiss(nudge);

        expect(internals.isQuietRecallCandidateSuppressed(candidate.id)).toBe(true);
        expect(internals.quietRecallBubbleNudge).toBeNull();
        expect(bubbleView.close).toHaveBeenCalledTimes(1);
        expect(recordQuietRecallFeedback).toHaveBeenCalledWith(candidate, "dismiss");
        expect(saveQuietRecallAsInsight).not.toHaveBeenCalled();
        expect(createReviewQueueItem).not.toHaveBeenCalled();

        internals.quietRecallNudgeCandidate = candidate;
        internals.quietRecallBubbleNudge = nudge;
        internals.handleQuietRecallBubbleLater(nudge);

        expect(internals.isQuietRecallCandidateSuppressed(candidate.id)).toBe(true);
        expect(recordQuietRecallFeedback).toHaveBeenCalledWith(candidate, "later");
        expect(saveQuietRecallAsInsight).not.toHaveBeenCalled();
        expect(createReviewQueueItem).not.toHaveBeenCalled();
    });
});
