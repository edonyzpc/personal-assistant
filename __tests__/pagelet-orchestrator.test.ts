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
    QuietRecallEvaluationDiagnostics,
    MaintenanceReviewRunResult,
    QuietRecallRunResult,
    ReviewQueueItem,
    SavedInsight,
    ScopeRecapLocalOverview,
    ScopeRecapAttemptStatus,
    ScopeRecapPreparationResult,
    ScopeRecapRunResult,
} from "../src/pa";

function makeTFile(path: string, stat: { size?: number; mtime?: number; ctime?: number } = {}): TFile {
    const FileCtor = TFile as unknown as {
        new(path: string, stat?: { size?: number; mtime?: number; ctime?: number }): TFile;
    };
    return new FileCtor(path, stat);
}

async function flushAsyncWork(): Promise<void> {
    for (let index = 0; index < 8; index += 1) {
        await Promise.resolve();
    }
}

function persistPageletSettingUpdates(host: PageletHost) {
    const update = jest.fn((key: keyof PageletHost["settings"]["pagelet"], value: unknown) => {
        const settings = host.settings.pagelet as unknown as Record<string, unknown>;
        settings[key] = value;
    });
    host.updatePageletSetting = update as PageletHost["updatePageletSetting"];
    return update;
}

function makeHost(overrides: Partial<PageletHost> = {}): PageletHost {
    const activeFile = makeTFile("notes/current.md", { size: 100, mtime: Date.now() });
    const host: PageletHost = {
        app: {
            workspace: {
                getActiveFile: jest.fn(() => activeFile),
                getMostRecentLeaf: jest.fn(() => null),
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
                scopeRecapPreparationEnabled: true,
                scopeRecapBackgroundAuthorization: "authorized-v1",
                scopeRecapAuthorizationContextId: "scope-recap-auth-test",
                scopeRecapHighValueHints: true,
                scopeRecapNudgeSuppressions: [],
                scopeRecapLastAttempt: null,
                quietRecallLastDiagnostics: null,
                quietRecallLastAcceptedCount: 0,
                outputLanguage: "auto",
                temperature: 0.2,
                foregroundPerHourCap: 999,
                foregroundPerDayCap: 999,
                maxInputTokens: 8000,
                maxOutputTokens: 2000,
                reviewsFolder: ".pagelet",
                excludedFolders: [],
                excludedTags: [],
                excludedPatterns: [],
                onboardingShown: true,
                maintenanceScanSuggested: false,
                quickCaptureExplained: false,
                quietRecallExplained: false,
                quietAcknowledged: false,
            },
            contextPager: {
                enabled: true,
            },
            quietRecall: {
                enabled: true,
                bubbleNudgesEnabled: false,
            },
            focusMode: false,
            confirmedMemoryCount: 0,
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
        writeReviewNote: async () => ({ success: true, filePath: ".pagelet/test.md" }),
        saveSettings: () => undefined,
        prepareMemoryForPagelet: () => undefined,
        getMemoryPreparationStatus: () => null,
        isPathAllowedForPagelet: () => true,
        openPageletSettings: () => undefined,
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
        detectCrossNotePatterns: async () => null,
        buildScopeRecapLocalOverview: async () => ({
            kind: "local_scope_overview",
            generatedAt: new Date().toISOString(),
            scope: { kind: "current_note", paths: ["notes/current.md"] },
            sourceSnapshotId: "scope-snapshot-test",
            dataBoundarySnapshotId: "data_boundary:scope_recap",
            sourceCoverage: {
                totalSourceCount: 2,
                includedSourceCount: 2,
                skippedSourceCount: 0,
                coverageRatio: 1,
            },
            includedSources: [
                { path: "notes/current.md", title: "current", changed: false },
                { path: "notes/related.md", title: "related", changed: false },
            ],
            skippedSources: [],
        }),
        isScopeRecapProviderConfigured: () => true,
        getScopeRecapProviderInfo: () => ({
            provider: "test",
            model: "test",
            endpoint: "https://example.test/v1",
        }),
        getScopeRecapAuthorizationContextId: () => "scope-recap-auth-test",
        getScopeRecapDataBoundarySnapshotId: () => "data_boundary:scope_recap",
        requestScopeRecapBackgroundAuthorization: async () => "run",
        runScopeRecap: async () => {
            const generatedAt = new Date().toISOString();
            const sourceRefs = [
                { path: "notes/current.md", evidenceStrength: "medium" as const },
                { path: "notes/related.md", evidenceStrength: "medium" as const },
            ];
            const scope = { kind: "current_note" as const, paths: ["notes/current.md"] };
            const localOverview = await host.buildScopeRecapLocalOverview();
            const artifact = {
                id: "recap-test",
                scope,
                sourceSnapshotId: "scope-snapshot-test",
                generatedAt,
                ttlDays: 30,
                staleStatus: "fresh" as const,
                sourceCoverage: localOverview.sourceCoverage,
                skippedSources: [],
                summary: {
                    id: "recap-summary",
                    section: "summary" as const,
                    title: "Scope summary",
                    summary: "Derived helper.",
                    sourceRefs,
                    generatedAt,
                    generatedHelper: true as const,
                    status: "candidate" as const,
                },
                themes: [{
                    id: "recap-theme",
                    section: "theme" as const,
                    title: "Trust is becoming the shared design constraint",
                    summary: "Both notes connect instant value with source-backed trust.",
                    whyItMatters: "This shared constraint should decide which interaction ships next.",
                    sourceRefs,
                    generatedAt,
                    generatedHelper: true as const,
                    status: "candidate" as const,
                }],
                tensions: [],
                openQuestions: [],
                nextReviewActions: [],
                sourceRefs,
                dataBoundarySnapshotId: "data_boundary:scope_recap",
            };
            return {
                status: "ready" as const,
                artifact,
                attempt: {
                    attemptedAt: generatedAt,
                    outcome: "success" as const,
                    scope,
                    sourceSnapshotId: "scope-snapshot-test",
                    dataBoundarySnapshotId: "data_boundary:scope_recap",
                    providerCallMade: true,
                    includedSourceCount: 2,
                },
                localOverview,
            };
        },
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
        linkRecallCandidate: async () => ({ ok: false, message: "not configured" }),
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
        const tokenAfterFirstAcceptedRun = (orchestrator as unknown as { foregroundRouteToken: number }).foregroundRouteToken;
        const second = orchestrator.reviewCurrentNote();

        await second;
        expect(callCount).toBe(1);
        expect((orchestrator as unknown as { foregroundRouteToken: number }).foregroundRouteToken)
            .toBe(tokenAfterFirstAcceptedRun);

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
    it("keeps cached generic findings out of Bubble without triggering a provider call", async () => {
        const foregroundAnalyze = jest.fn(async () => ({
            findings: [],
            analyzedFiles: ["notes/current.md"],
            analyzedAt: Date.now(),
            tokenCost: { input: 0, output: 0 },
        }));
        const host = makeHost({
            createForegroundAnalyzeCallback: () => foregroundAnalyze,
        });
        host.settings.pagelet.proactiveHints = true;
        const orchestrator = new PageletOrchestrator(host);
        const bubbleView = {
            show: jest.fn(() => { bubbleView.bubbleState = "visible"; }),
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
        await flushAsyncWork();

        const [content] = bubbleView.show.mock.calls[bubbleView.show.mock.calls.length - 1] as unknown as [{
            type: string;
            findings: Array<{ text: string; sourceLink?: string; sourceTitle?: string }>;
            actions: Array<{ label: string; callback: () => void }>;
        }, HTMLElement];
        expect(content.type).toBe("ready-empty");
        expect(JSON.stringify(content.findings)).not.toContain("Recent note has a possible follow-up.");
        expect(content.actions.map((action) => action.label)).toEqual(["Find related old notes"]);
        expect(panelView.open).not.toHaveBeenCalled();
        expect(foregroundAnalyze).not.toHaveBeenCalled();
    });

    it("shows ready-empty Bubble without a review-current launcher", async () => {
        const foregroundAnalyze = jest.fn(async () => ({
            findings: [],
            analyzedFiles: ["notes/current.md"],
            analyzedAt: Date.now(),
            tokenCost: { input: 0, output: 0 },
        }));
        const host = makeHost({
            createForegroundAnalyzeCallback: () => foregroundAnalyze,
        });
        host.settings.pagelet.proactiveHints = true;
        const orchestrator = new PageletOrchestrator(host);
        const bubbleView = {
            show: jest.fn(() => { bubbleView.bubbleState = "visible"; }),
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
        await flushAsyncWork();

        const [content] = bubbleView.show.mock.calls[bubbleView.show.mock.calls.length - 1] as unknown as [{
            type: string;
            actions: Array<{ label: string; callback: () => void }>;
        }, HTMLElement];
        expect(content.type).toBe("ready-empty");
        expect(content.actions.map((action) => action.label)).toEqual(["Find related old notes"]);
        expect(foregroundAnalyze).not.toHaveBeenCalled();
    });

    it("sends the Needs Setup review fallback to the Panel instead of rendering review results in Bubble", async () => {
        const foregroundAnalyze = jest.fn(async () => ({
            findings: [{
                text: "Current note has a possible issue.",
                sourceFile: "notes/current.md",
                sourceTitle: "current",
            }],
            analyzedFiles: ["notes/current.md"],
            analyzedAt: Date.now(),
            tokenCost: { input: 10, output: 5 },
        }));
        const host = makeHost({
            createForegroundAnalyzeCallback: () => foregroundAnalyze,
            isMemoryReadyForPageletDiscovery: async () => false,
        });
        const orchestrator = new PageletOrchestrator(host);
        const bubbleView = {
            show: jest.fn(() => { bubbleView.bubbleState = "visible"; }),
            close: jest.fn(() => { bubbleView.bubbleState = "hidden"; }),
            bubbleState: "hidden",
        };
        const panelView = { open: jest.fn() };

        (orchestrator as unknown as {
            petView: { rootEl: HTMLElement; stateMachine: { transition: jest.Mock } };
            bubbleView: typeof bubbleView;
            panelView: typeof panelView;
        }).petView = {
            rootEl: {} as HTMLElement,
            stateMachine: { transition: jest.fn() },
        };
        (orchestrator as unknown as { bubbleView: typeof bubbleView }).bubbleView = bubbleView;
        (orchestrator as unknown as { panelView: typeof panelView }).panelView = panelView;

        (orchestrator as unknown as { showBubble(): void }).showBubble();
        const [content] = bubbleView.show.mock.calls[0] as unknown as [{
            type: string;
            actions: Array<{ label: string; callback: () => void }>;
        }, HTMLElement];
        expect(content.type).toBe("needs-setup");

        content.actions[1].callback();
        await flushAsyncWork();

        expect(foregroundAnalyze).toHaveBeenCalledTimes(1);
        expect(panelView.open.mock.calls[0]?.[0]).toBe("current");
        expect(panelView.open.mock.calls[0]?.[1]).toEqual(
            expect.arrayContaining([expect.objectContaining({ sourceFile: "notes/current.md" })]),
        );
        expect(bubbleView.show).toHaveBeenCalledTimes(1);
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

    it("mounts the Pet when a markdown file opens in the current leaf", () => {
        const contentEl = {} as HTMLElement;
        const leaf = {
            view: {
                getViewType: () => "markdown",
                file: makeTFile("notes/current.md"),
                contentEl,
            },
        };
        const host = makeHost();
        (host.app.workspace as unknown as { getMostRecentLeaf: jest.Mock }).getMostRecentLeaf = jest.fn(() => leaf);
        const orchestrator = new PageletOrchestrator(host);
        const petView = {
            unmount: jest.fn(),
            mount: jest.fn(),
            destroy: jest.fn(),
            stateMachine: {
                proactiveHintsEnabled: false,
                transition: jest.fn(),
            },
            setTaskKind: jest.fn(),
        };
        const bubbleView = { close: jest.fn(), destroy: jest.fn() };
        const internals = orchestrator as unknown as {
            petView: typeof petView;
            bubbleView: typeof bubbleView;
            handleFileOpen(): void;
        };
        internals.petView = petView;
        internals.bubbleView = bubbleView;

        internals.handleFileOpen();

        expect(petView.unmount).toHaveBeenCalledTimes(1);
        expect(bubbleView.close).toHaveBeenCalledTimes(1);
        expect(petView.mount).toHaveBeenCalledWith(contentEl);
        orchestrator.destroy();
    });

    it("prefers the focused markdown leaf when the most-recent leaf is stale Pagelet detail", () => {
        const contentEl = {} as HTMLElement;
        const focusedLeaf = {
            view: {
                getViewType: () => "markdown",
                file: makeTFile("notes/current.md"),
                contentEl,
            },
        };
        const staleDetailLeaf = {
            view: {
                getViewType: () => "pa-pagelet-detail-view",
            },
        };
        const host = makeHost();
        const workspace = host.app.workspace as unknown as {
            activeLeaf: typeof focusedLeaf;
            getMostRecentLeaf: jest.Mock;
        };
        workspace.activeLeaf = focusedLeaf;
        workspace.getMostRecentLeaf = jest.fn(() => staleDetailLeaf);
        const orchestrator = new PageletOrchestrator(host);
        const petView = {
            unmount: jest.fn(),
            mount: jest.fn(),
            destroy: jest.fn(),
            stateMachine: {
                proactiveHintsEnabled: false,
                transition: jest.fn(),
            },
            setTaskKind: jest.fn(),
        };
        const bubbleView = { close: jest.fn(), destroy: jest.fn() };
        const internals = orchestrator as unknown as {
            petView: typeof petView;
            bubbleView: typeof bubbleView;
            handleFileOpen(): void;
        };
        internals.petView = petView;
        internals.bubbleView = bubbleView;

        internals.handleFileOpen();

        expect(petView.mount).toHaveBeenCalledWith(contentEl);
        expect(workspace.getMostRecentLeaf).not.toHaveBeenCalled();
        orchestrator.destroy();
    });
});

describe("PageletOrchestrator detail expansion", () => {
    it("maps Recap themes and tensions to insight and comparison card styles", async () => {
        const host = makeHost();
        const preparation = await host.runScopeRecap({ mode: "foreground-retry" });
        if (preparation.status !== "ready") throw new Error("expected ready Recap fixture");
        const theme = preparation.artifact.themes[0];
        if (!theme) throw new Error("expected Recap theme fixture");
        const recap: ScopeRecapRunResult = {
            ...preparation.artifact,
            tensions: [{
                ...theme,
                id: "recap-tension",
                section: "tension",
                title: "Speed and trust pull in different directions",
            }],
        };
        const orchestrator = new PageletOrchestrator(host);
        const payload = (orchestrator as unknown as {
            buildPreparedRecapPayload(recap: ScopeRecapRunResult): PageletDetailPayload;
        }).buildPreparedRecapPayload(recap);
        const cards = payload.content.flatMap((section) => (
            "cards" in section ? section.cards : []
        ));

        expect(cards.find((card) => card.title === theme.title)).toEqual(expect.objectContaining({
            cardStyle: "insight",
        }));
        expect(cards.find((card) => card.title === "Speed and trust pull in different directions"))
            .toEqual(expect.objectContaining({ cardStyle: "comparison" }));
    });

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
        expect(openPageletDetailView).toHaveBeenCalledWith(expect.objectContaining({
            title: "Pagelet — Detail View",
            content: findings,
            locale: "en",
            layoutType: "discover",
            sourcePath: "2.fleeting/Test-2023-04-08.md",
        }));
    });

    it("passes the current recap markdown payload to the detail tab", () => {
        const openPageletDetailView = jest.fn<(_payload: PageletDetailPayload) => void>();
        const host = makeHost({ openPageletDetailView });
        const orchestrator = new PageletOrchestrator(host);
        const markdown = "# Scope Recap\n\nA concise source-backed recap.";
        const findings = [{
            title: "scope-recap.md",
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
            fileName: "scope-recap.md",
            markdown,
            targetFolder: ".pagelet",
            targetPath: ".pagelet/scope-recap.md",
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
        expect(internals.saveFlow.pending?.targetPath).toBe(".pagelet/scope-recap.md");
        expect(openPageletDetailView).toHaveBeenCalledWith(expect.objectContaining({
            title: "Pagelet — Detail View",
            content: findings,
            locale: "en",
            layoutType: "summary",
            sourcePath: ".pagelet/scope-recap.md",
            summarySaveNote: pendingNote,
        }));
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

    it("strips governed records, Recent changes, and the legacy count before opening effect-based Pagelet", () => {
        const openPageletDetailView = jest.fn<(_payload: PageletDetailPayload) => void>();
        const candidate = makeReviewQueueItem({
            id: "rq-effect-review",
            type: "memory_candidate",
            title: "Review preference",
            claim: "Prefer concise planning notes.",
            metadata: { memoryType: "preference", sensitivity: "low" },
        });
        const listReviewQueueItems: PageletHost["listReviewQueueItems"] = (filter) => (
            filter?.types?.includes("memory_candidate") ? [candidate] : []
        );
        const host = makeHost({
            openPageletDetailView,
            listReviewQueueItems,
            getMemoryGovernancePanelState: () => ({
                governanceMode: "effect_based",
                records: [makeMemoryRecord({ summary: "DURABLE RECORD MUST STAY IN SETTINGS" })],
                recentChanges: [{
                    id: "event-private",
                    claimId: "mem-1",
                    kind: "correct",
                    occurredAt: "2026-07-10T12:00:00.000Z",
                    summary: "RECENT CHANGE MUST STAY IN SETTINGS",
                    undoAvailable: true,
                }],
                totalCount: 31,
                confirmedMemoryCount: 30,
            }),
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

        const payload = openPageletDetailView.mock.calls[0]?.[0];
        const memory = payload?.extra?.memoryGovernance;
        expect(memory).toMatchObject({
            governanceMode: "effect_based",
            records: [],
            candidates: [expect.objectContaining({ id: "rq-effect-review" })],
            totalCount: 1,
        });
        expect(memory?.recentChanges).toBeUndefined();
        expect(memory?.confirmedMemoryCount).toBeUndefined();
        expect(JSON.stringify(memory)).not.toContain("DURABLE RECORD MUST STAY IN SETTINGS");
        expect(JSON.stringify(memory)).not.toContain("RECENT CHANGE MUST STAY IN SETTINGS");
    });

    it("routes only exact governed claims that participated in the Pagelet result", () => {
        const openPageletDetailView = jest.fn<(_payload: PageletDetailPayload) => void>();
        const candidate = makeReviewQueueItem({
            id: "rq-contextual-review",
            type: "memory_candidate",
        });
        const listReviewQueueItems: PageletHost["listReviewQueueItems"] = (filter) => (
            filter?.types?.includes("memory_candidate") ? [candidate] : []
        );
        const gateAwareRecord = (id: string) => ({
            ...makeMemoryRecord({ id, summary: `Contextual ${id}` }),
            effect: "future_answers" as const,
            useStatus: "active" as const,
            durableUseStatus: "active" as const,
            actionPolicy: {
                correct: true,
                pause: true,
                resume: true,
                forget: true,
            },
        });
        const host = makeHost({
            openPageletDetailView,
            listReviewQueueItems,
            getMemoryGovernancePanelState: () => ({
                governanceMode: "effect_based",
                records: [gateAwareRecord("mem-1"), gateAwareRecord("mem-2")],
                recentChanges: [{
                    id: "recent-global-only",
                    claimId: "mem-1",
                    kind: "correct",
                    occurredAt: "2026-07-10T12:00:00.000Z",
                    summary: "Must remain in Settings",
                    undoAvailable: true,
                }],
                totalCount: 2,
            }),
        });
        const orchestrator = new PageletOrchestrator(host);
        const panelView = {
            currentLayoutType: "review" as const,
            currentVisibleFindings: [],
            currentPanelExtra: { usedGovernedMemoryClaimIds: ["mem-1"] },
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

        const memory = openPageletDetailView.mock.calls[0]?.[0].extra?.memoryGovernance;
        expect(memory).toMatchObject({
            governanceMode: "effect_based",
            contextual: true,
            records: [expect.objectContaining({
                id: "mem-1",
                summary: "Contextual mem-1",
                actionPolicy: {
                    correct: true,
                    pause: false,
                    resume: false,
                    forget: false,
                },
            })],
            candidates: [expect.objectContaining({ id: "rq-contextual-review" })],
            totalCount: 2,
        });
        expect(memory?.records.some((record) => record.id === "mem-2")).toBe(false);
        expect(memory?.recentChanges).toBeUndefined();
        expect(JSON.stringify(memory)).not.toContain("Must remain in Settings");
    });

    it.each([
        ["empty", []],
        ["unknown", ["mem-missing"]],
        ["duplicate", ["mem-1", "mem-1"]],
        ["non-exact", [" mem-1"]],
    ])("fails %s contextual governed claim IDs closed", (_label, usedGovernedMemoryClaimIds) => {
        const openPageletDetailView = jest.fn<(_payload: PageletDetailPayload) => void>();
        const candidate = makeReviewQueueItem({
            id: "rq-fail-closed-review",
            type: "memory_candidate",
        });
        const host = makeHost({
            openPageletDetailView,
            listReviewQueueItems: (filter) => (
                filter?.types?.includes("memory_candidate") ? [candidate] : []
            ),
            getMemoryGovernancePanelState: () => ({
                governanceMode: "effect_based",
                records: [{
                    ...makeMemoryRecord({ id: "mem-1" }),
                    effect: "future_answers",
                    useStatus: "active",
                    durableUseStatus: "active",
                    actionPolicy: {
                        correct: true,
                        pause: true,
                        resume: true,
                        forget: true,
                    },
                }],
                totalCount: 1,
            }),
        });
        const orchestrator = new PageletOrchestrator(host);
        const panelView = {
            currentLayoutType: "review" as const,
            currentVisibleFindings: [],
            currentPanelExtra: { usedGovernedMemoryClaimIds },
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

        expect(openPageletDetailView.mock.calls[0]?.[0].extra?.memoryGovernance).toMatchObject({
            governanceMode: "effect_based",
            contextual: true,
            records: [],
            candidates: [expect.objectContaining({ id: "rq-fail-closed-review" })],
            totalCount: 1,
        });
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
            listReviewQueueItems: (filter?: Parameters<PageletHost["listReviewQueueItems"]>[0]) => {
                // Return empty for memory-candidate/memory-conflict filter
                // (withGlobalLedgerExtra queries these separately)
                if (filter?.types?.includes("memory_candidate")) return [];
                return [
                    makeReviewQueueItem({
                        id: "rq-maintenance",
                        type: "maintenance_proposal",
                        title: "Review inbox note destination",
                        claim: "Preview only.",
                        originSurface: "maintenance",
                    }),
                ];
            },
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
                    routedItems: [expect.objectContaining({ id: "rq-maintenance", type: "maintenance_proposal" })],
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

    it("resets a mismatched Recap authorization context and makes no provider call without a new Run choice", async () => {
        jest.useFakeTimers();
        const requestAuthorization = jest.fn(async () => "adjust" as const);
        const providerRun = jest.fn(async () => {
            throw new Error("provider must stay gated");
        });
        const clearScopeRecapDetailSessionCache = jest.fn();
        const host = makeHost({
            getScopeRecapAuthorizationContextId: () => "scope-recap-auth-new",
            requestScopeRecapBackgroundAuthorization: requestAuthorization,
            runScopeRecap: providerRun,
            clearScopeRecapDetailSessionCache,
        });
        host.settings.pagelet.preloadEnabled = false;
        host.settings.pagelet.scopeRecapAuthorizationContextId = "scope-recap-auth-old";
        const updatePageletSetting = persistPageletSettingUpdates(host);
        const orchestrator = new PageletOrchestrator(host);

        orchestrator.syncSettings();
        jest.runOnlyPendingTimers();
        await flushAsyncWork();

        expect(host.settings.pagelet).toMatchObject({
            scopeRecapBackgroundAuthorization: "pending",
            scopeRecapPreparationEnabled: false,
            scopeRecapAuthorizationContextId: null,
        });
        expect(updatePageletSetting).toHaveBeenCalledWith(
            "scopeRecapBackgroundAuthorization",
            "pending",
        );
        expect(updatePageletSetting).toHaveBeenCalledWith("scopeRecapPreparationEnabled", false);
        expect(updatePageletSetting).toHaveBeenCalledWith("scopeRecapAuthorizationContextId", null);
        expect(requestAuthorization).toHaveBeenCalledTimes(1);
        expect(providerRun).not.toHaveBeenCalled();
        expect(clearScopeRecapDetailSessionCache).toHaveBeenCalled();
        orchestrator.destroy();
    });

    it("persists the current Recap authorization context before the Run choice reaches the provider", async () => {
        const host = makeHost();
        host.settings.pagelet.scopeRecapBackgroundAuthorization = "pending";
        host.settings.pagelet.scopeRecapPreparationEnabled = false;
        host.settings.pagelet.scopeRecapAuthorizationContextId = null;
        persistPageletSettingUpdates(host);
        const saveSettings = jest.fn(async () => undefined);
        host.saveSettings = saveSettings;
        const defaultProviderRun = host.runScopeRecap;
        const providerRun = jest.fn(defaultProviderRun);
        host.runScopeRecap = providerRun;
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            prepareRecapDelivery(reason: "pagelet-open"): Promise<void>;
        };

        await internals.prepareRecapDelivery("pagelet-open");

        expect(host.settings.pagelet).toMatchObject({
            scopeRecapBackgroundAuthorization: "authorized-v1",
            scopeRecapPreparationEnabled: true,
            scopeRecapAuthorizationContextId: "scope-recap-auth-test",
        });
        expect(saveSettings).toHaveBeenCalledTimes(1);
        expect(providerRun).toHaveBeenCalledTimes(1);
        expect(providerRun).toHaveBeenCalledWith(expect.objectContaining({
            mode: "background",
            expectedSourceSnapshotId: "scope-snapshot-test",
            expectedDataBoundarySnapshotId: "data_boundary:scope_recap",
            expectedAuthorizationContextId: "scope-recap-auth-test",
        }));
    });

    it("surfaces a high-value nudge through the actual background preparation path", async () => {
        const host = makeHost();
        persistPageletSettingUpdates(host);
        const defaultRunScopeRecap = host.runScopeRecap;
        const runScopeRecap = jest.fn(defaultRunScopeRecap);
        host.runScopeRecap = runScopeRecap;
        const forceState = jest.fn();
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            prepareRecapDelivery(reason: "pagelet-open"): Promise<void>;
            petView: {
                stateMachine: { forceState: (state: string) => void };
                destroy(): void;
            };
        };
        internals.petView = { stateMachine: { forceState }, destroy: jest.fn() };

        await internals.prepareRecapDelivery("pagelet-open");
        await internals.prepareRecapDelivery("pagelet-open");

        expect(runScopeRecap).toHaveBeenCalledTimes(1);
        expect(runScopeRecap).toHaveBeenCalledWith(expect.objectContaining({ mode: "background" }));
        expect(forceState).toHaveBeenCalledTimes(1);
        expect(forceState).toHaveBeenCalledWith("nudge");
        expect(host.settings.pagelet.scopeRecapNudgeSuppressions).toEqual([
            expect.objectContaining({
                fingerprint: expect.stringMatching(/^recap-insight-/),
                shownAt: expect.any(Number),
            }),
        ]);
        orchestrator.destroy();
    });

    it("keeps an authorized single-source scope out of background provider preparation", async () => {
        const host = makeHost();
        host.buildScopeRecapLocalOverview = async () => ({
            kind: "local_scope_overview",
            generatedAt: new Date().toISOString(),
            scope: { kind: "current_note", paths: ["notes/current.md"] },
            sourceSnapshotId: "scope-snapshot-single",
            dataBoundarySnapshotId: "data_boundary:scope_recap",
            sourceCoverage: {
                totalSourceCount: 1,
                includedSourceCount: 1,
                skippedSourceCount: 0,
                coverageRatio: 1,
            },
            includedSources: [{ path: "notes/current.md", title: "current", changed: false }],
            skippedSources: [],
        });
        const defaultRunScopeRecap = host.runScopeRecap;
        const runScopeRecap = jest.fn(defaultRunScopeRecap);
        host.runScopeRecap = runScopeRecap;
        const forceState = jest.fn();
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            prepareRecapDelivery(reason: "pagelet-open"): Promise<void>;
            preparedRecapArtifact: ScopeRecapRunResult | null;
            petView: {
                stateMachine: { forceState: (state: string) => void };
                destroy(): void;
            };
        };
        internals.petView = { stateMachine: { forceState }, destroy: jest.fn() };

        await internals.prepareRecapDelivery("pagelet-open");

        expect(runScopeRecap).not.toHaveBeenCalled();
        expect(forceState).not.toHaveBeenCalled();
        expect(internals.preparedRecapArtifact).toBeNull();
        orchestrator.destroy();
    });

    it("reuses a current ready Recap after the debounce window when the full source snapshot is unchanged", async () => {
        const host = makeHost();
        persistPageletSettingUpdates(host);
        const defaultRunScopeRecap = host.runScopeRecap;
        const runScopeRecap = jest.fn(defaultRunScopeRecap);
        host.runScopeRecap = runScopeRecap;
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            prepareRecapDelivery(reason: "idle"): Promise<void>;
            lastRecapPreparationAttemptAt: number;
            preparedRecapArtifact: ScopeRecapRunResult | null;
        };

        await internals.prepareRecapDelivery("idle");
        expect(runScopeRecap).toHaveBeenCalledTimes(1);
        expect(internals.preparedRecapArtifact).not.toBeNull();

        internals.lastRecapPreparationAttemptAt = Date.now() - 6 * 60 * 1000;
        await internals.prepareRecapDelivery("idle");

        expect(runScopeRecap).toHaveBeenCalledTimes(1);
        expect(internals.preparedRecapArtifact).not.toBeNull();
        orchestrator.destroy();
    });

    it("reruns a background Recap when the matching ready artifact has expired", async () => {
        const host = makeHost();
        persistPageletSettingUpdates(host);
        const defaultRunScopeRecap = host.runScopeRecap;
        const runScopeRecap = jest.fn(defaultRunScopeRecap);
        host.runScopeRecap = runScopeRecap;
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            prepareRecapDelivery(reason: "idle"): Promise<void>;
            lastRecapPreparationAttemptAt: number;
            preparedRecapArtifact: ScopeRecapRunResult | null;
        };

        await internals.prepareRecapDelivery("idle");
        if (!internals.preparedRecapArtifact) throw new Error("expected ready Recap");
        internals.preparedRecapArtifact.generatedAt = new Date(
            Date.now() - 31 * 24 * 60 * 60 * 1000,
        ).toISOString();
        internals.lastRecapPreparationAttemptAt = Date.now() - 6 * 60 * 1000;

        await internals.prepareRecapDelivery("idle");

        expect(runScopeRecap).toHaveBeenCalledTimes(2);
        orchestrator.destroy();
    });

    it("does not call the Recap provider when the disclosed scope changes before Run", async () => {
        let resolveChoice!: (choice: "run") => void;
        const choiceGate = new Promise<"run">((resolve) => { resolveChoice = resolve; });
        let snapshotId = "scope-snapshot-a";
        const buildScopeRecapLocalOverview = jest.fn(async (): Promise<ScopeRecapLocalOverview> => ({
            kind: "local_scope_overview",
            generatedAt: new Date().toISOString(),
            scope: { kind: "folder", paths: ["notes/current.md", "notes/related.md"] },
            sourceSnapshotId: snapshotId,
            dataBoundarySnapshotId: "data_boundary:scope_recap",
            sourceCoverage: {
                totalSourceCount: 2,
                includedSourceCount: 2,
                skippedSourceCount: 0,
                coverageRatio: 1,
            },
            includedSources: [
                { path: "notes/current.md", title: "current", changed: false },
                { path: "notes/related.md", title: "related", changed: false },
            ],
            skippedSources: [],
        }));
        const providerRun = jest.fn(makeHost().runScopeRecap);
        const host = makeHost({
            buildScopeRecapLocalOverview,
            requestScopeRecapBackgroundAuthorization: () => choiceGate,
            runScopeRecap: providerRun,
        });
        host.settings.pagelet.scopeRecapBackgroundAuthorization = "pending";
        host.settings.pagelet.scopeRecapPreparationEnabled = false;
        host.settings.pagelet.scopeRecapAuthorizationContextId = null;
        persistPageletSettingUpdates(host);
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            prepareRecapDelivery(reason: "pagelet-open"): Promise<void>;
        };

        const preparation = internals.prepareRecapDelivery("pagelet-open");
        await flushAsyncWork();
        snapshotId = "scope-snapshot-b";
        resolveChoice("run");
        await preparation;

        expect(providerRun).not.toHaveBeenCalled();
        expect(host.settings.pagelet).toMatchObject({
            scopeRecapBackgroundAuthorization: "pending",
            scopeRecapPreparationEnabled: false,
            scopeRecapAuthorizationContextId: null,
        });
        orchestrator.destroy();
    });

    it("allows Adjust to re-disclose in the same session after settings synchronization", async () => {
        jest.useFakeTimers();
        const requestAuthorization = jest.fn<PageletHost["requestScopeRecapBackgroundAuthorization"]>()
            .mockResolvedValueOnce("adjust")
            .mockResolvedValueOnce("run");
        const openPageletSettings = jest.fn();
        const refreshPageletSettings = jest.fn();
        const host = makeHost({
            requestScopeRecapBackgroundAuthorization: requestAuthorization,
            openPageletSettings,
            refreshPageletSettings,
        });
        host.settings.pagelet.preloadEnabled = false;
        host.settings.pagelet.scopeRecapBackgroundAuthorization = "pending";
        host.settings.pagelet.scopeRecapPreparationEnabled = true;
        host.settings.pagelet.scopeRecapAuthorizationContextId = null;
        persistPageletSettingUpdates(host);
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            ensureScopeRecapBackgroundAuthorization(): Promise<ScopeRecapLocalOverview | null>;
        };

        await expect(internals.ensureScopeRecapBackgroundAuthorization()).resolves.toBeNull();
        expect(openPageletSettings).toHaveBeenCalledTimes(1);
        expect(refreshPageletSettings).toHaveBeenCalledTimes(1);
        expect(host.settings.pagelet).toMatchObject({
            preloadEnabled: false,
            scopeRecapBackgroundAuthorization: "pending",
            scopeRecapPreparationEnabled: false,
            scopeRecapAuthorizationContextId: null,
        });

        orchestrator.syncSettings();
        await expect(internals.ensureScopeRecapBackgroundAuthorization()).resolves.toEqual(
            expect.objectContaining({ sourceSnapshotId: "scope-snapshot-test" }),
        );

        expect(requestAuthorization).toHaveBeenCalledTimes(2);
        expect(host.settings.pagelet).toMatchObject({
            scopeRecapBackgroundAuthorization: "authorized-v1",
            scopeRecapPreparationEnabled: true,
            scopeRecapAuthorizationContextId: "scope-recap-auth-test",
        });
        orchestrator.destroy();
    });

    it("keeps Cancel disabled and clears its authorization context across later checks", async () => {
        const requestAuthorization = jest.fn(async () => "cancel" as const);
        const defaultHost = makeHost();
        const providerRun = jest.fn(defaultHost.runScopeRecap);
        const openPageletSettings = jest.fn();
        const refreshPageletSettings = jest.fn();
        const host = makeHost({
            requestScopeRecapBackgroundAuthorization: requestAuthorization,
            runScopeRecap: providerRun,
            openPageletSettings,
            refreshPageletSettings,
        });
        host.settings.pagelet.scopeRecapBackgroundAuthorization = "pending";
        host.settings.pagelet.scopeRecapPreparationEnabled = true;
        host.settings.pagelet.scopeRecapAuthorizationContextId = "stale-context";
        persistPageletSettingUpdates(host);
        const saveSettings = jest.fn(async () => undefined);
        host.saveSettings = saveSettings;
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            ensureScopeRecapBackgroundAuthorization(): Promise<ScopeRecapLocalOverview | null>;
        };

        await expect(internals.ensureScopeRecapBackgroundAuthorization()).resolves.toBeNull();
        await expect(internals.ensureScopeRecapBackgroundAuthorization()).resolves.toBeNull();

        expect(host.settings.pagelet).toMatchObject({
            scopeRecapBackgroundAuthorization: "declined-v1",
            scopeRecapPreparationEnabled: false,
            scopeRecapAuthorizationContextId: null,
        });
        expect(requestAuthorization).toHaveBeenCalledTimes(1);
        expect(saveSettings).toHaveBeenCalledTimes(1);
        expect(providerRun).not.toHaveBeenCalled();
        expect(openPageletSettings).not.toHaveBeenCalled();
        expect(refreshPageletSettings).toHaveBeenCalledTimes(1);
    });

    it.each([
        ["run", "authorized-v1", true, 1, 0],
        ["adjust", "pending", false, 0, 1],
        ["cancel", "declined-v1", false, 0, 0],
    ] as const)(
        "re-discloses after Cancel when the user re-enables preparation, then handles %s",
        async (nextChoice, expectedAuthorization, expectedEnabled, expectedProviderCalls, expectedSettingsOpens) => {
            jest.useFakeTimers();
            const requestAuthorization = jest.fn<PageletHost["requestScopeRecapBackgroundAuthorization"]>()
                .mockResolvedValueOnce("cancel")
                .mockResolvedValueOnce(nextChoice);
            const defaultHost = makeHost();
            const providerRun = jest.fn(defaultHost.runScopeRecap);
            const openPageletSettings = jest.fn();
            const host = makeHost({
                requestScopeRecapBackgroundAuthorization: requestAuthorization,
                runScopeRecap: providerRun,
                openPageletSettings,
            });
            host.settings.pagelet.preloadEnabled = false;
            host.settings.pagelet.scopeRecapBackgroundAuthorization = "pending";
            host.settings.pagelet.scopeRecapPreparationEnabled = true;
            host.settings.pagelet.scopeRecapAuthorizationContextId = null;
            persistPageletSettingUpdates(host);
            const orchestrator = new PageletOrchestrator(host);
            const internals = orchestrator as unknown as {
                prepareRecapDelivery(reason: "pagelet-open"): Promise<void>;
            };

            await internals.prepareRecapDelivery("pagelet-open");

            expect(requestAuthorization).toHaveBeenCalledTimes(1);
            expect(providerRun).not.toHaveBeenCalled();
            expect(host.settings.pagelet).toMatchObject({
                scopeRecapBackgroundAuthorization: "declined-v1",
                scopeRecapPreparationEnabled: false,
                scopeRecapAuthorizationContextId: null,
            });

            // Mirrors the Settings toggle's explicit declined -> pending/on transition.
            host.settings.pagelet.scopeRecapBackgroundAuthorization = "pending";
            host.settings.pagelet.scopeRecapPreparationEnabled = true;
            orchestrator.syncSettings();

            expect(providerRun).not.toHaveBeenCalled();
            jest.runOnlyPendingTimers();
            await flushAsyncWork();

            expect(requestAuthorization).toHaveBeenCalledTimes(2);
            expect(providerRun).toHaveBeenCalledTimes(expectedProviderCalls);
            expect(openPageletSettings).toHaveBeenCalledTimes(expectedSettingsOpens);
            expect(host.settings.pagelet).toMatchObject({
                scopeRecapBackgroundAuthorization: expectedAuthorization,
                scopeRecapPreparationEnabled: expectedEnabled,
                scopeRecapAuthorizationContextId: nextChoice === "run"
                    ? "scope-recap-auth-test"
                    : null,
            });
            orchestrator.destroy();
        },
    );

    it("opens an immediate local Scope Recap explanation, then performs provider work only after Retry", async () => {
        const openPageletDetailView = jest.fn<(_payload: PageletDetailPayload) => void>();
        const host = makeHost({ openPageletDetailView });
        const defaultRunScopeRecap = host.runScopeRecap;
        const runScopeRecap = jest.fn(defaultRunScopeRecap);
        host.runScopeRecap = runScopeRecap;
        const orchestrator = new PageletOrchestrator(host);

        await orchestrator.getCommandCallbacks().onScopeRecap();

        expect(runScopeRecap).not.toHaveBeenCalled();
        expect(openPageletDetailView).toHaveBeenCalledWith(expect.objectContaining({
            title: "Scope Recap",
            content: expect.arrayContaining([
                expect.objectContaining({
                    cards: expect.arrayContaining([
                        expect.objectContaining({ actionLabel: "Retry" }),
                    ]),
                }),
            ]),
            layoutType: "review",
            sourcePath: "notes/current.md",
        }));

        const explanationPayload = openPageletDetailView.mock.calls[0]?.[0];
        const retryCard = explanationPayload?.content
            .flatMap((section) => ("cards" in section ? section.cards : []))
            .find((card) => card.actionLabel === "Retry");
        expect(retryCard?.actionCallback).toBeDefined();
        retryCard?.actionCallback?.();
        await flushAsyncWork();

        expect(runScopeRecap).toHaveBeenCalledWith(expect.objectContaining({
            mode: "foreground-retry",
            expectedSourceSnapshotId: "scope-snapshot-test",
            expectedDataBoundarySnapshotId: "data_boundary:scope_recap",
            expectedAuthorizationContextId: "scope-recap-auth-test",
        }));
        expect(openPageletDetailView).toHaveBeenLastCalledWith(expect.objectContaining({
            title: "Scope Recap",
            layoutType: "review",
            extra: expect.objectContaining({
                scopeRecap: expect.objectContaining({
                    id: "recap-test",
                    sourceCoverage: expect.objectContaining({ includedSourceCount: 2 }),
                }),
            }),
            content: expect.arrayContaining([
                expect.objectContaining({
                    cards: expect.arrayContaining([
                        expect.objectContaining({
                            title: "Trust is becoming the shared design constraint",
                            body: expect.stringContaining("Both notes connect instant value with source-backed trust."),
                        }),
                    ]),
                }),
            ]),
        }));

        const bubbleView = {
            bubbleState: "hidden",
            show: jest.fn(),
            close: jest.fn(),
        };
        (orchestrator as unknown as {
            bubbleView: typeof bubbleView;
            petView: { rootEl: HTMLElement };
            showBubble(): void;
        }).bubbleView = bubbleView;
        (orchestrator as unknown as {
            petView: { rootEl: HTMLElement };
        }).petView = { rootEl: {} as HTMLElement };

        (orchestrator as unknown as { showBubble(): void }).showBubble();

        const [content] = bubbleView.show.mock.calls[0] as unknown as [{
            type: string;
            actions: Array<{ label: string }>;
        }, HTMLElement];
        expect(content.type).toBe("recap-delivery");
        expect(content.actions.map((action) => action.label)).toEqual(["View recap", "Later"]);
    });

    it("routes Retry to provider settings without provider, duplicate detail, or write side effects", async () => {
        const openPageletDetailView = jest.fn<(_payload: PageletDetailPayload) => void>();
        const openPageletSettings = jest.fn();
        const runScopeRecap = jest.fn(makeHost().runScopeRecap);
        const writeReviewNote = jest.fn(async () => ({
            success: true as const,
            filePath: ".pagelet/unexpected.md",
        }));
        const saveSettings = jest.fn(async () => undefined);
        const host = makeHost({
            isScopeRecapProviderConfigured: () => false,
            openPageletDetailView,
            openPageletSettings,
            runScopeRecap,
            writeReviewNote,
            saveSettings,
        });
        const orchestrator = new PageletOrchestrator(host);

        await orchestrator.getCommandCallbacks().onScopeRecap();

        const explanationPayload = openPageletDetailView.mock.calls[0]?.[0];
        const retryCard = explanationPayload?.content
            .flatMap((section) => ("cards" in section ? section.cards : []))
            .find((card) => card.actionLabel === "Retry");
        expect(retryCard?.actionCallback).toBeDefined();

        retryCard?.actionCallback?.();
        await flushAsyncWork();

        expect(openPageletSettings).toHaveBeenCalledTimes(1);
        expect(Notice).toHaveBeenCalledWith(
            "Set up an AI provider before retrying Scope Recap.",
            5000,
        );
        expect(runScopeRecap).not.toHaveBeenCalled();
        expect(openPageletDetailView).toHaveBeenCalledTimes(1);
        expect(writeReviewNote).not.toHaveBeenCalled();
        expect(saveSettings).not.toHaveBeenCalled();
        expect(host.updatePageletSetting).not.toHaveBeenCalled();
    });

    it("renders recent source and time-range facts in the local Recap fallback without a provider call", async () => {
        const openPageletDetailView = jest.fn<(_payload: PageletDetailPayload) => void>();
        const runScopeRecap = jest.fn(makeHost().runScopeRecap);
        const host = makeHost({
            openPageletDetailView,
            runScopeRecap,
            buildScopeRecapLocalOverview: async () => ({
                kind: "local_scope_overview",
                generatedAt: "2026-07-18T12:00:00.000Z",
                scope: { kind: "folder", label: "notes", paths: ["notes/current.md", "notes/related.md"] },
                sourceSnapshotId: "scope-snapshot-changed",
                dataBoundarySnapshotId: "data_boundary:scope_recap",
                sourceCoverage: {
                    totalSourceCount: 2,
                    includedSourceCount: 2,
                    skippedSourceCount: 0,
                    coverageRatio: 1,
                },
                includedSources: [{
                    path: "notes/current.md",
                    title: "current",
                    modifiedAt: "2026-07-18T09:00:00.000Z",
                    changed: true,
                }, {
                    path: "notes/related.md",
                    title: "related",
                    modifiedAt: "2026-06-01T09:00:00.000Z",
                    changed: false,
                }],
                skippedSources: [],
            }),
        });
        const orchestrator = new PageletOrchestrator(host);

        await orchestrator.getCommandCallbacks().onScopeRecap();

        expect(runScopeRecap).not.toHaveBeenCalled();
        const payload = openPageletDetailView.mock.calls[0]?.[0];
        const changes = payload?.content.find(
            (section) => section.title === "Recently updated sources",
        );
        expect(changes).toEqual(expect.objectContaining({
            cards: [expect.objectContaining({
                body: expect.stringContaining("1 source note"),
                sourceLinks: [{ path: "notes/current.md", title: "current" }],
            })],
        }));
        expect(JSON.stringify(changes)).not.toContain("notes/related.md");
        orchestrator.destroy();
    });

    it("restores content-free Recap and Recall diagnostics after orchestrator reload", () => {
        const host = makeHost();
        persistPageletSettingUpdates(host);
        const recapAttempt: ScopeRecapAttemptStatus = {
            attemptedAt: "2026-07-18T10:00:00.000Z",
            outcome: "success",
            scope: { kind: "folder" },
            sourceSnapshotId: "recap-snapshot-hash",
            dataBoundarySnapshotId: "boundary-hash",
            providerCallMade: true,
            includedSourceCount: 2,
            cost: {
                inputTokens: 100,
                outputTokens: 20,
                estimatedCost: 0.001,
                currency: "USD",
                pricingKnown: true,
            },
        };
        const recallDiagnostics: QuietRecallEvaluationDiagnostics = {
            roundId: "round-hash",
            startedAt: Date.parse("2026-07-18T10:01:00.000Z"),
            contextFingerprint: "context-hash",
            candidateCount: 1,
            evaluatedCandidateCount: 1,
            providerCalls: 1,
            initialCalls: 1,
            languageRetryCalls: 0,
            cacheHits: 0,
            inFlightHits: 0,
            estimatedCost: 0.002,
            pricingKnown: true,
            attempts: [],
        };
        const first = new PageletOrchestrator(host);
        const firstInternals = first as unknown as {
            recordScopeRecapAttempt(attempt: ScopeRecapAttemptStatus): void;
            recordQuietRecallDiagnostics(result: QuietRecallRunResult): void;
        };
        firstInternals.recordScopeRecapAttempt(recapAttempt);
        firstInternals.recordQuietRecallDiagnostics({
            generatedAt: "2026-07-18T10:01:00.000Z",
            currentPath: "private/current.md",
            totalCount: 1,
            candidates: [{
                id: "candidate-hash",
                title: "Private candidate title",
                summary: "Private excerpt",
                score: 0.99,
                sourceRefs: [{ path: "private/source.md", evidenceStrength: "medium" }],
                whyNow: ["Private why now"],
                nextAction: "Review it",
                relation: "related",
                generatedAt: "2026-07-18T10:01:00.000Z",
                evaluationProvenance: "ai",
                evaluationFingerprint: "candidate-fingerprint",
            }],
            evaluationDiagnostics: recallDiagnostics,
        });
        first.destroy();

        const reloaded = new PageletOrchestrator(host) as unknown as {
            lastRecapAttempt: ScopeRecapAttemptStatus | null;
            lastQuietRecallDiagnostics: QuietRecallEvaluationDiagnostics | null;
            lastQuietRecallAcceptedCount: number;
        };

        expect(reloaded.lastRecapAttempt).toEqual(recapAttempt);
        expect(reloaded.lastQuietRecallDiagnostics).toEqual(recallDiagnostics);
        expect(reloaded.lastQuietRecallAcceptedCount).toBe(1);
        const persisted = JSON.stringify({
            recap: host.settings.pagelet.scopeRecapLastAttempt,
            recall: host.settings.pagelet.quietRecallLastDiagnostics,
        });
        expect(persisted).not.toContain("private/");
        expect(persisted).not.toContain("Private");
    });

    it("does not deliver a prepared Recap after the active note changes", async () => {
        const currentFile = makeTFile("notes/current.md", { size: 100, mtime: 1000 });
        const otherFile = makeTFile("notes/other.md", { size: 100, mtime: 1000 });
        const host = makeHost();
        (host.app.workspace.getActiveFile as jest.Mock).mockReturnValue(currentFile);
        const orchestrator = new PageletOrchestrator(host);

        await orchestrator.getCommandCallbacks().onScopeRecap();

        const bubbleView = {
            bubbleState: "hidden",
            show: jest.fn(),
            close: jest.fn(),
        };
        (orchestrator as unknown as {
            bubbleView: typeof bubbleView;
            petView: { rootEl: HTMLElement };
            showBubble(): void;
        }).bubbleView = bubbleView;
        (orchestrator as unknown as {
            petView: { rootEl: HTMLElement };
        }).petView = { rootEl: {} as HTMLElement };

        (host.app.workspace.getActiveFile as jest.Mock).mockReturnValue(otherFile);
        (orchestrator as unknown as { showBubble(): void }).showBubble();

        const [content] = bubbleView.show.mock.calls[0] as unknown as [{ type: string }, HTMLElement];
        expect(content.type).not.toBe("recap-delivery");
    });

    it("does not deliver a prepared Recap after the active note snapshot changes", async () => {
        const currentFile = makeTFile("notes/current.md", { size: 100, mtime: 1000 });
        const editedFile = makeTFile("notes/current.md", { size: 120, mtime: 2000 });
        const host = makeHost();
        (host.app.workspace.getActiveFile as jest.Mock).mockReturnValue(currentFile);
        const orchestrator = new PageletOrchestrator(host);

        await orchestrator.getCommandCallbacks().onScopeRecap();

        const bubbleView = {
            bubbleState: "hidden",
            show: jest.fn(),
            close: jest.fn(),
        };
        (orchestrator as unknown as {
            bubbleView: typeof bubbleView;
            petView: { rootEl: HTMLElement };
            showBubble(): void;
        }).bubbleView = bubbleView;
        (orchestrator as unknown as {
            petView: { rootEl: HTMLElement };
        }).petView = { rootEl: {} as HTMLElement };

        (host.app.workspace.getActiveFile as jest.Mock).mockReturnValue(editedFile);
        (orchestrator as unknown as { showBubble(): void }).showBubble();

        const [content] = bubbleView.show.mock.calls[0] as unknown as [{ type: string }, HTMLElement];
        expect(content.type).not.toBe("recap-delivery");
    });

    it("persists Later suppression across reloads while explicit Recap still opens", async () => {
        const openPageletDetailView = jest.fn<(_payload: PageletDetailPayload) => void>();
        const host = makeHost({ openPageletDetailView });
        persistPageletSettingUpdates(host);
        const preparation = await host.runScopeRecap({ mode: "foreground-retry" });
        if (preparation.status !== "ready") throw new Error("expected ready Recap fixture");

        const first = new PageletOrchestrator(host);
        const firstBubble = {
            bubbleState: "hidden",
            show: jest.fn(),
            close: jest.fn(),
        };
        const firstInternals = first as unknown as {
            currentRecapScopeKey(): string | null;
            storePreparedRecap(
                recap: typeof preparation.artifact,
                overview: typeof preparation.localOverview,
                options: { allowNudge?: boolean },
                scopeKey: string | null,
            ): PageletDetailPayload;
            bubbleView: typeof firstBubble;
            petView: { rootEl: HTMLElement };
            showBubble(): void;
        };
        firstInternals.storePreparedRecap(
            preparation.artifact,
            preparation.localOverview,
            {},
            firstInternals.currentRecapScopeKey(),
        );
        firstInternals.bubbleView = firstBubble;
        firstInternals.petView = { rootEl: {} as HTMLElement };

        firstInternals.showBubble();
        const [firstContent] = firstBubble.show.mock.calls[0] as unknown as [{
            type: string;
            actions: Array<{ label: string; callback: () => void }>;
        }, HTMLElement];
        expect(firstContent.type).toBe("recap-delivery");
        firstContent.actions.find((action) => action.label === "Later")?.callback();

        expect(host.settings.pagelet.scopeRecapNudgeSuppressions).toEqual([
            expect.objectContaining({
                fingerprint: expect.stringMatching(/^recap-insight-/),
                snoozedUntil: expect.any(Number),
            }),
        ]);

        const reloaded = new PageletOrchestrator(host);
        const reloadedBubble = {
            bubbleState: "hidden",
            show: jest.fn(),
            close: jest.fn(),
        };
        const reloadedInternals = reloaded as unknown as {
            currentRecapScopeKey(): string | null;
            storePreparedRecap(
                recap: typeof preparation.artifact,
                overview: typeof preparation.localOverview,
                options: { allowNudge?: boolean },
                scopeKey: string | null,
            ): PageletDetailPayload;
            bubbleView: typeof reloadedBubble;
            petView: { rootEl: HTMLElement };
            showBubble(): void;
        };
        reloadedInternals.storePreparedRecap(
            preparation.artifact,
            preparation.localOverview,
            {},
            reloadedInternals.currentRecapScopeKey(),
        );
        reloadedInternals.bubbleView = reloadedBubble;
        reloadedInternals.petView = { rootEl: {} as HTMLElement };

        reloadedInternals.showBubble();

        const [suppressedContent] = reloadedBubble.show.mock.calls[0] as unknown as [{ type: string }, HTMLElement];
        expect(suppressedContent.type).not.toBe("recap-delivery");

        await reloaded.getCommandCallbacks().onScopeRecap();
        expect(openPageletDetailView).toHaveBeenCalledWith(expect.objectContaining({
            extra: expect.objectContaining({
                scopeRecap: expect.objectContaining({ id: "recap-test" }),
            }),
        }));
    });

    it("surfaces one high-value prepared Recap nudge and suppresses the same fingerprint", async () => {
        const host = makeHost();
        persistPageletSettingUpdates(host);
        const preparation = await host.runScopeRecap({ mode: "background" });
        if (preparation.status !== "ready") throw new Error("expected ready Recap fixture");
        const forceState = jest.fn();
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            currentRecapScopeKey(): string | null;
            storePreparedRecap(
                recap: typeof preparation.artifact,
                overview: typeof preparation.localOverview,
                options: { allowNudge?: boolean },
                scopeKey: string | null,
            ): PageletDetailPayload;
            petView: { stateMachine: { forceState: (state: string) => void } };
        };
        internals.petView = { stateMachine: { forceState } };

        internals.storePreparedRecap(
            preparation.artifact,
            preparation.localOverview,
            { allowNudge: true },
            internals.currentRecapScopeKey(),
        );
        internals.storePreparedRecap(
            preparation.artifact,
            preparation.localOverview,
            { allowNudge: true },
            internals.currentRecapScopeKey(),
        );

        expect(forceState).toHaveBeenCalledTimes(1);
        expect(forceState).toHaveBeenCalledWith("nudge");
        expect(host.settings.pagelet.scopeRecapNudgeSuppressions).toEqual([
            expect.objectContaining({
                fingerprint: expect.stringMatching(/^recap-insight-/),
                shownAt: expect.any(Number),
            }),
        ]);
    });

    it.each([
        ["the Recap hint is disabled", (host: PageletHost) => {
            host.settings.pagelet.scopeRecapHighValueHints = false;
        }],
        ["Focus Mode is active", (host: PageletHost) => {
            host.settings.focusMode = true;
        }],
        ["the Pet is hidden", (host: PageletHost) => {
            host.settings.pagelet.petVisible = false;
        }],
    ])("keeps a high-value prepared Recap silent when %s", async (_label, configure) => {
        const host = makeHost();
        configure(host);
        const preparation = await host.runScopeRecap({ mode: "background" });
        if (preparation.status !== "ready") throw new Error("expected ready Recap fixture");
        const forceState = jest.fn();
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            currentRecapScopeKey(): string | null;
            storePreparedRecap(
                recap: typeof preparation.artifact,
                overview: typeof preparation.localOverview,
                options: { allowNudge?: boolean },
                scopeKey: string | null,
            ): PageletDetailPayload;
            petView: { stateMachine: { forceState: (state: string) => void } };
        };
        internals.petView = { stateMachine: { forceState } };

        internals.storePreparedRecap(
            preparation.artifact,
            preparation.localOverview,
            { allowNudge: true },
            internals.currentRecapScopeKey(),
        );

        expect(forceState).not.toHaveBeenCalled();
    });

    it("keeps a high-value prepared Recap silent during quiet hours", async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date(2026, 6, 19, 12, 0, 0));
        const host = makeHost();
        host.settings.pagelet.proactiveHintsQuietHours = {
            enabled: true,
            start: "11:00",
            end: "13:00",
        };
        const preparation = await host.runScopeRecap({ mode: "background" });
        if (preparation.status !== "ready") throw new Error("expected ready Recap fixture");
        const forceState = jest.fn();
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            currentRecapScopeKey(): string | null;
            storePreparedRecap(
                recap: typeof preparation.artifact,
                overview: typeof preparation.localOverview,
                options: { allowNudge?: boolean },
                scopeKey: string | null,
            ): PageletDetailPayload;
            petView: { stateMachine: { forceState: (state: string) => void } };
        };
        internals.petView = { stateMachine: { forceState } };

        internals.storePreparedRecap(
            preparation.artifact,
            preparation.localOverview,
            { allowNudge: true },
            internals.currentRecapScopeKey(),
        );

        expect(forceState).not.toHaveBeenCalled();
    });

    it("discards a late background Recap after a sibling note revises the scope", async () => {
        const seed = await makeHost().runScopeRecap({ mode: "background" });
        let resolveProvider!: (value: ScopeRecapPreparationResult) => void;
        const providerGate = new Promise<ScopeRecapPreparationResult>((resolve) => {
            resolveProvider = resolve;
        });
        const providerRun = jest.fn((_options: { mode: "background" | "foreground-retry" }) => providerGate);
        const host = makeHost({ runScopeRecap: providerRun });
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            prepareRecapDelivery(reason: "note-activity"): Promise<void>;
            invalidatePreparedRecapScope(): void;
            preparedRecapArtifact: unknown;
            preparedRecapPayload: unknown;
        };

        const inFlight = internals.prepareRecapDelivery("note-activity");
        await flushAsyncWork();
        expect(providerRun).toHaveBeenCalledTimes(1);

        internals.invalidatePreparedRecapScope();
        resolveProvider(seed);
        await inFlight;

        expect(internals.preparedRecapArtifact).toBeNull();
        orchestrator.destroy();
        expect(internals.preparedRecapPayload).toBeNull();
    });

    it("does not accept or immediately rebuild a Recap cleared while its provider call is in flight", async () => {
        jest.useFakeTimers();
        const seed = await makeHost().runScopeRecap({ mode: "background" });
        let resolveProvider!: (value: ScopeRecapPreparationResult) => void;
        const providerGate = new Promise<ScopeRecapPreparationResult>((resolve) => {
            resolveProvider = resolve;
        });
        const providerRun = jest.fn(() => providerGate);
        const host = makeHost({ runScopeRecap: providerRun });
        persistPageletSettingUpdates(host);
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            prepareRecapDelivery(reason: "idle"): Promise<void>;
            preparedRecapArtifact: unknown;
            preparedRecapPayload: unknown;
        };

        const inFlight = internals.prepareRecapDelivery("idle");
        await flushAsyncWork();
        expect(providerRun).toHaveBeenCalledTimes(1);

        orchestrator.clearScopeRecapCache();
        orchestrator.syncSettings();
        jest.runOnlyPendingTimers();
        resolveProvider(seed);
        await inFlight;
        await flushAsyncWork();

        expect(internals.preparedRecapArtifact).toBeNull();
        expect(internals.preparedRecapPayload).toBeNull();
        expect(providerRun).toHaveBeenCalledTimes(1);
        orchestrator.destroy();
    });

    it("does not accept a late background Recap after preparation is disabled", async () => {
        const seed = await makeHost().runScopeRecap({ mode: "background" });
        let resolveProvider!: (value: ScopeRecapPreparationResult) => void;
        const providerGate = new Promise<ScopeRecapPreparationResult>((resolve) => {
            resolveProvider = resolve;
        });
        const host = makeHost({ runScopeRecap: () => providerGate });
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            prepareRecapDelivery(reason: "idle"): Promise<void>;
            preparedRecapArtifact: unknown;
        };

        const inFlight = internals.prepareRecapDelivery("idle");
        await flushAsyncWork();
        host.settings.pagelet.scopeRecapPreparationEnabled = false;
        orchestrator.syncSettings();
        resolveProvider(seed);
        await inFlight;

        expect(internals.preparedRecapArtifact).toBeNull();
        orchestrator.destroy();
    });

    it("drains the latest pending Recap scope after an older scope finishes", async () => {
        jest.useFakeTimers();
        const seed = await makeHost().runScopeRecap({ mode: "background" });
        let resolveFirst!: (value: ScopeRecapPreparationResult) => void;
        const firstGate = new Promise<ScopeRecapPreparationResult>((resolve) => {
            resolveFirst = resolve;
        });
        const providerRun = jest.fn<() => Promise<ScopeRecapPreparationResult>>()
            .mockImplementationOnce(() => firstGate)
            .mockResolvedValueOnce(seed);
        const host = makeHost({ runScopeRecap: providerRun });
        const activeA = makeTFile("notes/a.md", { mtime: 1000, size: 100 });
        const activeB = makeTFile("notes/b.md", { mtime: 2000, size: 120 });
        (host.app.workspace.getActiveFile as jest.Mock).mockReturnValue(activeA);
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            prepareRecapDelivery(reason: "note-activity"): Promise<void>;
            invalidatePreparedRecapScope(): void;
            preparedRecapArtifact: ScopeRecapPreparationResult extends { artifact: infer T } ? T : unknown;
        };

        const first = internals.prepareRecapDelivery("note-activity");
        await flushAsyncWork();
        (host.app.workspace.getActiveFile as jest.Mock).mockReturnValue(activeB);
        internals.invalidatePreparedRecapScope();
        await internals.prepareRecapDelivery("note-activity");

        resolveFirst(seed);
        await first;
        jest.runOnlyPendingTimers();
        await flushAsyncWork();

        expect(providerRun).toHaveBeenCalledTimes(2);
        expect(internals.preparedRecapArtifact).not.toBeNull();
        orchestrator.destroy();
    });

    it("single-flights foreground Retry with an in-flight background Recap for the same scope", async () => {
        const seed = await makeHost().runScopeRecap({ mode: "background" });
        let resolveProvider!: (value: ScopeRecapPreparationResult) => void;
        const providerGate = new Promise<ScopeRecapPreparationResult>((resolve) => {
            resolveProvider = resolve;
        });
        const providerRun = jest.fn((_options: { mode: "background" | "foreground-retry" }) => providerGate);
        const openPageletDetailView = jest.fn<(_payload: PageletDetailPayload) => void>();
        const host = makeHost({ runScopeRecap: providerRun, openPageletDetailView });
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            prepareRecapDelivery(reason: "idle"): Promise<void>;
        };

        const background = internals.prepareRecapDelivery("idle");
        await flushAsyncWork();
        expect(providerRun).toHaveBeenCalledWith(expect.objectContaining({
            mode: "background",
            expectedSourceSnapshotId: "scope-snapshot-test",
            expectedDataBoundarySnapshotId: "data_boundary:scope_recap",
            expectedAuthorizationContextId: "scope-recap-auth-test",
        }));

        await orchestrator.getCommandCallbacks().onScopeRecap();
        const explanation = openPageletDetailView.mock.calls.at(-1)?.[0];
        const retry = explanation?.content
            .flatMap((section) => ("cards" in section ? section.cards : []))
            .find((card) => card.actionLabel === "Retry");
        retry?.actionCallback?.();
        await flushAsyncWork();

        expect(providerRun).toHaveBeenCalledTimes(1);
        resolveProvider(seed);
        await background;
        await flushAsyncWork();

        expect(providerRun).toHaveBeenCalledTimes(1);
        expect(openPageletDetailView).toHaveBeenLastCalledWith(expect.objectContaining({
            extra: expect.objectContaining({
                scopeRecap: expect.objectContaining({ id: "recap-test" }),
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
                context: { kind: "note_retrieval" },
                evaluationProvenance: "ai",
                evaluationFingerprint: "eval-qr-ins-1",
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
        const payload = openPageletDetailView.mock.calls[0]?.[0];
        expect(payload?.extra?.memoryGovernance).toBeUndefined();
        expect(payload?.extra?.quietRecall?.candidates[0]).toMatchObject({
            context: { kind: "note_retrieval" },
            sourceRefs: [expect.objectContaining({ path: "notes/current.md" })],
            whyNow: ["Source matches the note you are looking at."],
        });
    });

    it.each([
        ["active path changes", () => makeTFile("notes/other.md", { size: 100, mtime: 1000 })],
        ["the same note is edited", () => makeTFile("notes/current.md", { size: 140, mtime: 2000 })],
    ])("does not publish stale foreground Quiet Recall when %s", async (_label, nextFile) => {
        const initialFile = makeTFile("notes/current.md", { size: 100, mtime: 1000 });
        let resolveRecall!: (value: QuietRecallRunResult) => void;
        const recallGate = new Promise<QuietRecallRunResult>((resolve) => {
            resolveRecall = resolve;
        });
        const runQuietRecall = jest.fn(() => recallGate);
        const openPageletDetailView = jest.fn<(_payload: PageletDetailPayload) => void>();
        const host = makeHost({ runQuietRecall, openPageletDetailView });
        (host.app.workspace.getActiveFile as jest.Mock).mockReturnValue(initialFile);
        const orchestrator = new PageletOrchestrator(host);

        const inFlight = orchestrator.runQuietRecall();
        await flushAsyncWork();
        (host.app.workspace.getActiveFile as jest.Mock).mockReturnValue(nextFile());
        resolveRecall({
            generatedAt: "2026-06-29T12:00:00.000Z",
            currentPath: initialFile.path,
            totalCount: 0,
            candidates: [],
        });
        await inFlight;

        expect(openPageletDetailView).not.toHaveBeenCalled();
        expect(host.log).toHaveBeenCalledWith(
            "Discarded stale Quiet Recall foreground result",
            expect.any(Object),
        );
    });

    it("does not publish foreground Quiet Recall after a source or policy snapshot becomes stale", async () => {
        const initialFile = makeTFile("notes/current.md", { size: 100, mtime: 1000 });
        const quietRecall: QuietRecallRunResult = {
            generatedAt: "2026-06-29T12:00:00.000Z",
            currentPath: initialFile.path,
            sourceSnapshotId: "recall-snapshot-old",
            dataBoundarySnapshotId: "data_boundary:scope_recap",
            evaluationPolicySnapshotId: "policy-old",
            totalCount: 0,
            candidates: [],
        };
        const openPageletDetailView = jest.fn<(_payload: PageletDetailPayload) => void>();
        const host = makeHost({
            runQuietRecall: async () => quietRecall,
            isQuietRecallRunCurrent: () => false,
            openPageletDetailView,
        });
        (host.app.workspace.getActiveFile as jest.Mock).mockReturnValue(initialFile);

        const orchestrator = new PageletOrchestrator(host);
        await orchestrator.runQuietRecall();

        expect(openPageletDetailView).not.toHaveBeenCalled();
        expect(host.log).toHaveBeenCalledWith(
            "Discarded stale Quiet Recall foreground result",
            { reason: "source_or_policy_changed" },
        );
        orchestrator.destroy();
    });

    it("keeps local Quiet Recall matches Discover-only in the explicit detail tab", async () => {
        const localCandidate: QuietRecallCandidate = {
            id: "qr-local",
            title: "Recall: Local",
            summary: "Local similarity only.",
            sourceRefs: [{ path: "notes/local.md" }],
            whyNow: ["A local ranking template."],
            nextAction: "Discover the source.",
            relation: "related",
            score: 90,
            generatedAt: "2026-06-29T12:00:00.000Z",
            evaluationProvenance: "local",
        };
        const aiCandidate: QuietRecallCandidate = {
            ...localCandidate,
            id: "qr-ai",
            whyNow: ["This older decision resolves the question in the note you are viewing."],
            evaluationProvenance: "ai",
            evaluationFingerprint: "eval-qr-ai",
        };
        const openPageletDetailView = jest.fn<(_payload: PageletDetailPayload) => void>();
        const host = makeHost({
            runQuietRecall: async () => ({
                generatedAt: "2026-06-29T12:00:00.000Z",
                currentPath: "notes/current.md",
                totalCount: 2,
                candidates: [localCandidate, aiCandidate],
                discoverCandidates: [localCandidate],
            }),
            openPageletDetailView,
        });

        await new PageletOrchestrator(host).getCommandCallbacks().onQuietRecall();

        const delivered = openPageletDetailView.mock.calls[0]?.[0].extra?.quietRecall;
        expect(delivered?.totalCount).toBe(2);
        expect(delivered?.candidates.map((candidate) => candidate.id)).toEqual(["qr-local", "qr-ai"]);
        expect(delivered?.discoverCandidates?.map((candidate) => candidate.id)).toEqual(["qr-local"]);
    });

    afterEach(() => { jest.useRealTimers(); });

    it("rejects local-only proactive Recall and counts Discover minus AI accepted", async () => {
        const localCandidate: QuietRecallCandidate = {
            id: "qr-local-proactive",
            title: "Recall: Local",
            summary: "Local similarity only.",
            sourceRefs: [{ path: "notes/local.md" }],
            whyNow: ["A local ranking template."],
            nextAction: "Discover the source.",
            relation: "related",
            score: 95,
            generatedAt: "2026-06-29T12:00:00.000Z",
            evaluationProvenance: "local",
        };
        const openPageletDetailView = jest.fn<(_payload: PageletDetailPayload) => void>();
        const host = makeHost({
            runQuietRecall: async () => ({
                generatedAt: "2026-06-29T12:00:00.000Z",
                currentPath: "notes/current.md",
                totalCount: 1,
                candidates: [localCandidate],
                discoverCandidates: [localCandidate, { ...localCandidate, id: "qr-local-2" }],
            }),
            openPageletDetailView,
        });
        host.settings.pagelet.proactiveHints = true;
        host.settings.quietRecall.bubbleNudgesEnabled = true;
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            prepareQuietRecallBubbleNudge(): Promise<void>;
            quietRecallBubbleNudge: QuietRecallBubbleNudge | null;
            unconvincingRecallCount: number;
            openQuietRecallDiscoverFallback(): Promise<void>;
            invalidateQuietRecallBubbleNudge(): void;
        };

        await internals.prepareQuietRecallBubbleNudge();

        expect(internals.quietRecallBubbleNudge).toBeNull();
        expect(internals.unconvincingRecallCount).toBe(2);

        await internals.openQuietRecallDiscoverFallback();
        expect(openPageletDetailView).toHaveBeenCalledWith(expect.objectContaining({
            entryReason: "quiet-recall",
            extra: expect.objectContaining({
                quietRecall: expect.objectContaining({
                    candidates: [
                        expect.objectContaining({ id: "qr-local-proactive" }),
                        expect.objectContaining({ id: "qr-local-2" }),
                    ],
                    discoverCandidates: [
                        expect.objectContaining({ id: "qr-local-proactive" }),
                        expect.objectContaining({ id: "qr-local-2" }),
                    ],
                }),
            }),
        }));

        internals.invalidateQuietRecallBubbleNudge();
        expect(internals.unconvincingRecallCount).toBe(0);
        orchestrator.destroy();
    });

    it("keeps only unaccepted local candidates in the Discover fallback", async () => {
        const localAccepted: QuietRecallCandidate = {
            id: "qr-shared",
            title: "Recall: Shared local candidate",
            summary: "Local candidate later accepted by AI.",
            sourceRefs: [{ path: "notes/shared.md" }],
            whyNow: ["LOCAL SHARED TEMPLATE"],
            nextAction: "Discover the source.",
            relation: "related",
            score: 95,
            generatedAt: "2026-07-19T10:00:00.000Z",
            evaluationProvenance: "local",
        };
        const localRejected: QuietRecallCandidate = {
            ...localAccepted,
            id: "qr-local-rejected",
            title: "Recall: Rejected local candidate",
            summary: "This remains a local clue.",
            sourceRefs: [{ path: "notes/local-rejected.md" }],
            whyNow: ["LOCAL REJECTED TEMPLATE"],
        };
        const acceptedSameId: QuietRecallCandidate = {
            ...localAccepted,
            whyNow: ["AI accepted the shared candidate for the current context."],
            evaluationProvenance: "ai",
            evaluationFingerprint: "eval-shared",
        };
        const acceptedDifferentId: QuietRecallCandidate = {
            ...acceptedSameId,
            id: "qr-ai-different",
            sourceRefs: [{ path: "notes/ai-different.md" }],
            whyNow: ["AI accepted a different candidate too."],
            evaluationFingerprint: "eval-different",
        };
        const openPageletDetailView = jest.fn<(_payload: PageletDetailPayload) => void>();
        const host = makeHost({
            runQuietRecall: async () => ({
                generatedAt: localAccepted.generatedAt,
                currentPath: "notes/current.md",
                totalCount: 2,
                candidates: [acceptedSameId, acceptedDifferentId],
                discoverCandidates: [localAccepted, localRejected],
            }),
            openPageletDetailView,
        });
        host.settings.pagelet.proactiveHints = true;
        host.settings.quietRecall.bubbleNudgesEnabled = true;
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            prepareQuietRecallBubbleNudge(): Promise<void>;
            unconvincingRecallCount: number;
            openQuietRecallDiscoverFallback(): Promise<void>;
        };

        await internals.prepareQuietRecallBubbleNudge();

        expect(internals.unconvincingRecallCount).toBe(1);
        await internals.openQuietRecallDiscoverFallback();

        const fallback = openPageletDetailView.mock.calls[0]?.[0].extra?.quietRecall;
        expect(fallback?.totalCount).toBe(1);
        expect(fallback?.candidates.map((candidate) => candidate.id)).toEqual([
            "qr-local-rejected",
        ]);
        expect(fallback?.discoverCandidates?.map((candidate) => candidate.id)).toEqual([
            "qr-local-rejected",
        ]);
        expect(JSON.stringify(fallback)).not.toContain("AI accepted the shared candidate");
        expect(JSON.stringify(fallback)).not.toContain("qr-ai-different");
        orchestrator.destroy();
    });

    it("prepares a Quiet Recall Bubble nudge after opening a markdown note", async () => {
        jest.useFakeTimers();
        const candidate: QuietRecallCandidate = {
            id: "qr-vault-beta",
            title: "Recall: Beta",
            summary: "Beta may be useful again.",
            sourceRefs: [{ path: "notes/beta.md", evidenceStrength: "medium" }],
            whyNow: ["This note appears related to the note you are viewing."],
            nextAction: "Open this note and decide whether the connection still matters.",
            relation: "related",
            score: 70,
            generatedAt: "2026-06-29T12:00:00.000Z",
            evaluationProvenance: "ai",
            evaluationFingerprint: "eval-qr-vault-beta",
        };
        const runQuietRecall = jest.fn(async (): Promise<QuietRecallRunResult> => ({
            generatedAt: "2026-06-29T12:00:00.000Z",
            currentPath: "notes/current.md",
            totalCount: 1,
            candidates: [candidate],
        }));
        const host = makeHost({ runQuietRecall });
        host.settings.pagelet.proactiveHints = true;
        host.settings.quietRecall.bubbleNudgesEnabled = true;
        const orchestrator = new PageletOrchestrator(host);
        const petView = {
            unmount: jest.fn(),
            mount: jest.fn(),
            destroy: jest.fn(),
            stateMachine: {
                proactiveHintsEnabled: true,
                forceState: jest.fn(),
                transition: jest.fn(),
            },
            setTaskKind: jest.fn(),
        };
        const bubbleView = { close: jest.fn() };
        const internals = orchestrator as unknown as {
            petView: typeof petView;
            bubbleView: typeof bubbleView;
            quietRecallBubbleNudge: QuietRecallBubbleNudge | null;
            handleLeafChange(leaf: unknown): void;
        };
        internals.petView = petView;
        internals.bubbleView = bubbleView;

        internals.handleLeafChange({
            view: {
                getViewType: () => "markdown",
                file: makeTFile("notes/current.md"),
                contentEl: {} as HTMLElement,
            },
        });
        jest.advanceTimersByTime(300);
        await flushAsyncWork();

        expect(runQuietRecall).toHaveBeenCalledTimes(1);
        expect(internals.quietRecallBubbleNudge).toEqual({
            candidateId: "qr-vault-beta",
            currentPath: "notes/current.md",
            relation: "related",
            generatedAt: "2026-06-29T12:00:00.000Z",
            onboardingExplanation: true,
        });
        expect(petView.stateMachine.forceState).toHaveBeenCalledWith("nudge");
        expect(host.updatePageletSetting).toHaveBeenCalledWith("quietRecallExplained", true);
    });

    it("keeps proactive Quiet Recall quiet below the Bubble score threshold", async () => {
        jest.useFakeTimers();
        const runQuietRecall = jest.fn(async (): Promise<QuietRecallRunResult> => ({
            generatedAt: "2026-06-29T12:00:00.000Z",
            currentPath: "notes/current.md",
            totalCount: 1,
            candidates: [{
                id: "qr-vault-low-signal",
                title: "Recall: Low signal",
                summary: "This connection is not strong enough to interrupt.",
                sourceRefs: [{ path: "notes/low-signal.md", evidenceStrength: "weak" }],
                whyNow: ["A weak structural overlap was found."],
                nextAction: "Open only when useful.",
                relation: "related",
                score: 64,
                generatedAt: "2026-06-29T12:00:00.000Z",
                evaluationProvenance: "ai",
                evaluationFingerprint: "eval-qr-vault-low-signal",
            }],
        }));
        const host = makeHost({ runQuietRecall });
        host.settings.pagelet.proactiveHints = true;
        host.settings.quietRecall.bubbleNudgesEnabled = true;
        const orchestrator = new PageletOrchestrator(host);
        const petView = {
            unmount: jest.fn(),
            mount: jest.fn(),
            destroy: jest.fn(),
            stateMachine: {
                proactiveHintsEnabled: true,
                forceState: jest.fn(),
                transition: jest.fn(),
            },
            setTaskKind: jest.fn(),
        };
        const internals = orchestrator as unknown as {
            petView: typeof petView;
            quietRecallBubbleNudge: QuietRecallBubbleNudge | null;
            handleLeafChange(leaf: unknown): void;
        };
        internals.petView = petView;

        internals.handleLeafChange({
            view: {
                getViewType: () => "markdown",
                file: makeTFile("notes/current.md"),
                contentEl: {} as HTMLElement,
            },
        });
        jest.advanceTimersByTime(300);
        await flushAsyncWork();

        expect(runQuietRecall).toHaveBeenCalledTimes(1);
        expect(internals.quietRecallBubbleNudge).toBeNull();
        expect(petView.stateMachine.forceState).not.toHaveBeenCalled();
        expect(host.updatePageletSetting).not.toHaveBeenCalledWith("quietRecallExplained", true);
    });

    it("keeps Quiet Recall onboarding explanation pending when quiet hours block the nudge", async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-06-29T12:00:00.000Z"));
        const candidate: QuietRecallCandidate = {
            id: "qr-vault-quiet-hours",
            title: "Recall: Quiet",
            summary: "Quiet-hours note may be useful.",
            sourceRefs: [{ path: "notes/quiet.md", evidenceStrength: "medium" }],
            whyNow: ["This note appears related to the note you are viewing."],
            nextAction: "Open this note and decide whether the connection still matters.",
            relation: "related",
            score: 70,
            generatedAt: "2026-06-29T12:00:00.000Z",
            evaluationProvenance: "ai",
            evaluationFingerprint: "eval-qr-vault-quiet-hours",
        };
        const runQuietRecall = jest.fn(async (): Promise<QuietRecallRunResult> => ({
            generatedAt: "2026-06-29T12:00:00.000Z",
            currentPath: "notes/current.md",
            totalCount: 1,
            candidates: [candidate],
        }));
        const host = makeHost({ runQuietRecall });
        host.settings.pagelet.proactiveHints = true;
        host.settings.pagelet.proactiveHintsQuietHours = { enabled: true, start: "00:00", end: "23:59" };
        host.settings.quietRecall.bubbleNudgesEnabled = true;
        const orchestrator = new PageletOrchestrator(host);
        const petView = {
            unmount: jest.fn(),
            mount: jest.fn(),
            destroy: jest.fn(),
            stateMachine: {
                proactiveHintsEnabled: true,
                forceState: jest.fn(),
                transition: jest.fn(),
            },
            setTaskKind: jest.fn(),
        };
        const internals = orchestrator as unknown as {
            petView: typeof petView;
            quietRecallBubbleNudge: QuietRecallBubbleNudge | null;
            handleLeafChange(leaf: unknown): void;
        };
        internals.petView = petView;

        internals.handleLeafChange({
            view: {
                getViewType: () => "markdown",
                file: makeTFile("notes/current.md"),
                contentEl: {} as HTMLElement,
            },
        });
        jest.advanceTimersByTime(300);
        await flushAsyncWork();

        expect(internals.quietRecallBubbleNudge).toEqual(expect.objectContaining({
            candidateId: "qr-vault-quiet-hours",
            onboardingExplanation: true,
        }));
        expect(petView.stateMachine.forceState).not.toHaveBeenCalled();
        expect(host.updatePageletSetting).not.toHaveBeenCalledWith("quietRecallExplained", true);
    });

    it("deduplicates rapid note switches via debounce and runs Quiet Recall only once", async () => {
        jest.useFakeTimers();
        const candidate: QuietRecallCandidate = {
            id: "qr-vault-latest",
            title: "Recall: Latest",
            summary: "Latest note may be useful.",
            sourceRefs: [{ path: "notes/latest.md", evidenceStrength: "medium" }],
            whyNow: ["This note appears related to the note you are viewing."],
            nextAction: "Open this note and decide whether the connection still matters.",
            relation: "related",
            score: 70,
            generatedAt: "2026-06-29T12:01:00.000Z",
            evaluationProvenance: "ai",
            evaluationFingerprint: "eval-qr-vault-latest",
        };
        const runQuietRecall = jest.fn(async (): Promise<QuietRecallRunResult> => ({
            generatedAt: "2026-06-29T12:01:00.000Z",
            currentPath: "notes/current.md",
            totalCount: 1,
            candidates: [candidate],
        }));
        const host = makeHost({ runQuietRecall });
        host.settings.pagelet.proactiveHints = true;
        host.settings.quietRecall.bubbleNudgesEnabled = true;
        const orchestrator = new PageletOrchestrator(host);
        const petView = {
            unmount: jest.fn(),
            mount: jest.fn(),
            destroy: jest.fn(),
            stateMachine: {
                proactiveHintsEnabled: true,
                forceState: jest.fn(),
                transition: jest.fn(),
            },
            setTaskKind: jest.fn(),
        };
        const internals = orchestrator as unknown as {
            petView: typeof petView;
            quietRecallBubbleNudge: QuietRecallBubbleNudge | null;
            handleLeafChange(leaf: unknown): void;
        };
        internals.petView = petView;

        const leaf = {
            view: {
                getViewType: () => "markdown",
                file: makeTFile("notes/current.md"),
                contentEl: {} as HTMLElement,
            },
        };
        internals.handleLeafChange(leaf);
        internals.handleLeafChange(leaf);
        internals.handleLeafChange(leaf);
        jest.advanceTimersByTime(300);
        await flushAsyncWork();

        expect(runQuietRecall).toHaveBeenCalledTimes(1);
        expect(internals.quietRecallBubbleNudge?.candidateId).toBe("qr-vault-latest");
    });

    it("invalidates in-flight Quiet Recall Bubble nudges when the active note changes", async () => {
        jest.useFakeTimers();
        let resolveFirstRun: (value: QuietRecallRunResult) => void = () => undefined;
        const firstRun = new Promise<QuietRecallRunResult>((resolve) => {
            resolveFirstRun = resolve;
        });
        const staleCandidate: QuietRecallCandidate = {
            id: "qr-stale",
            title: "Recall: Stale",
            summary: "Old note result should not be shown.",
            sourceRefs: [{ path: "notes/stale.md", evidenceStrength: "medium" }],
            whyNow: ["This was prepared for the previous active note."],
            nextAction: "Ignore stale results.",
            relation: "related",
            score: 60,
            generatedAt: "2026-06-29T12:00:00.000Z",
            evaluationProvenance: "ai",
            evaluationFingerprint: "eval-qr-stale",
        };
        const latestCandidate: QuietRecallCandidate = {
            id: "qr-latest",
            title: "Recall: Latest",
            summary: "Latest note result should be shown.",
            sourceRefs: [{ path: "notes/latest.md", evidenceStrength: "medium" }],
            whyNow: ["This was prepared after the active note changed."],
            nextAction: "Open the latest note.",
            relation: "related",
            score: 80,
            generatedAt: "2026-06-29T12:01:00.000Z",
            evaluationProvenance: "ai",
            evaluationFingerprint: "eval-qr-latest",
        };
        const runQuietRecall = jest.fn<() => Promise<QuietRecallRunResult>>()
            .mockImplementationOnce(() => firstRun)
            .mockImplementationOnce(async (): Promise<QuietRecallRunResult> => ({
                generatedAt: "2026-06-29T12:01:00.000Z",
                currentPath: "notes/latest.md",
                totalCount: 1,
                candidates: [latestCandidate],
            }));
        const host = makeHost({ runQuietRecall });
        host.settings.pagelet.proactiveHints = true;
        host.settings.quietRecall.bubbleNudgesEnabled = true;
        const orchestrator = new PageletOrchestrator(host);
        const petView = {
            unmount: jest.fn(),
            mount: jest.fn(),
            stateMachine: {
                proactiveHintsEnabled: true,
                forceState: jest.fn(),
                transition: jest.fn(),
            },
            setTaskKind: jest.fn(),
        };
        const internals = orchestrator as unknown as {
            petView: typeof petView;
            quietRecallBubbleNudge: QuietRecallBubbleNudge | null;
            handleLeafChange(leaf: unknown): void;
        };
        internals.petView = petView;

        internals.handleLeafChange({
            view: {
                getViewType: () => "markdown",
                file: makeTFile("notes/stale.md"),
                contentEl: {} as HTMLElement,
            },
        });
        jest.advanceTimersByTime(300);
        await flushAsyncWork();
        expect(runQuietRecall).toHaveBeenCalledTimes(1);

        internals.handleLeafChange({
            view: {
                getViewType: () => "markdown",
                file: makeTFile("notes/latest.md"),
                contentEl: {} as HTMLElement,
            },
        });
        resolveFirstRun({
            generatedAt: "2026-06-29T12:00:00.000Z",
            currentPath: "notes/stale.md",
            totalCount: 1,
            candidates: [staleCandidate],
        });
        await flushAsyncWork();
        expect(internals.quietRecallBubbleNudge).toBeNull();

        jest.advanceTimersByTime(300);
        await flushAsyncWork();

        expect(runQuietRecall).toHaveBeenCalledTimes(2);
        expect(internals.quietRecallBubbleNudge?.candidateId).toBe("qr-latest");
    });

    it("suppresses open-note Quiet Recall preparation in Focus Mode", async () => {
        const runQuietRecall = jest.fn(async (): Promise<QuietRecallRunResult> => ({
            generatedAt: "2026-06-29T12:00:00.000Z",
            currentPath: "notes/current.md",
            totalCount: 0,
            candidates: [],
        }));
        const host = makeHost({ runQuietRecall });
        host.settings.pagelet.proactiveHints = true;
        host.settings.quietRecall.bubbleNudgesEnabled = true;
        host.settings.focusMode = true;
        const orchestrator = new PageletOrchestrator(host);
        const petView = {
            unmount: jest.fn(),
            mount: jest.fn(),
            destroy: jest.fn(),
            stateMachine: {
                proactiveHintsEnabled: true,
                forceState: jest.fn(),
                transition: jest.fn(),
            },
            setTaskKind: jest.fn(),
        };
        const internals = orchestrator as unknown as {
            petView: typeof petView;
            handleLeafChange(leaf: unknown): void;
        };
        internals.petView = petView;

        internals.handleLeafChange({
            view: {
                getViewType: () => "markdown",
                file: makeTFile("notes/current.md"),
                contentEl: {} as HTMLElement,
            },
        });
        await flushAsyncWork();

        expect(runQuietRecall).not.toHaveBeenCalled();
        orchestrator.destroy();
    });

    it("runs Quiet Recall on double Ctrl but ignores a single Ctrl press", async () => {
        const runQuietRecall = jest.fn(async (): Promise<QuietRecallRunResult> => ({
            generatedAt: "2026-06-29T12:00:00.000Z",
            currentPath: "notes/current.md",
            totalCount: 0,
            candidates: [],
        }));
        const openPageletDetailView = jest.fn<(_payload: PageletDetailPayload) => void>();
        const host = makeHost({ runQuietRecall, openPageletDetailView });
        const orchestrator = new PageletOrchestrator(host);
        const preventDefault = jest.fn();
        const internals = orchestrator as unknown as {
            handleQuietRecallShortcut(event: Partial<KeyboardEvent> & { preventDefault: () => void }): void;
        };

        internals.handleQuietRecallShortcut({ key: "Control", preventDefault });
        await flushAsyncWork();
        expect(runQuietRecall).not.toHaveBeenCalled();

        internals.handleQuietRecallShortcut({ key: "Control", preventDefault });
        await flushAsyncWork();

        expect(preventDefault).toHaveBeenCalledTimes(1);
        expect(runQuietRecall).toHaveBeenCalledTimes(1);
        expect(openPageletDetailView).toHaveBeenCalledWith(expect.objectContaining({
            title: "Quiet Recall",
        }));
    });

    it("rejects a second foreground route while one is already in-flight", async () => {
        const maintenanceReview: MaintenanceReviewRunResult = {
            generatedAt: "2026-06-29T12:00:00.000Z",
            previewOnly: true,
            weeklyScanEnabled: false,
            totalCount: 0,
            categories: [
                { category: "inbox_cleanup", label: "inbox_cleanup", count: 0 },
                { category: "better_titles", label: "better_titles", count: 0 },
                { category: "weak_links", label: "weak_links", count: 0 },
            ],
            proposals: [],
        };
        let resolveMaintenance!: (value: MaintenanceReviewRunResult) => void;
        const maintenanceGate = new Promise<MaintenanceReviewRunResult>((resolve) => {
            resolveMaintenance = resolve;
        });
        const runMaintenanceReview = jest.fn(() => maintenanceGate);
        const runQuietRecall = jest.fn(async (): Promise<QuietRecallRunResult> => ({
            generatedAt: "2026-06-29T12:01:00.000Z",
            currentPath: "notes/current.md",
            totalCount: 0,
            candidates: [],
        }));
        const openPageletDetailView = jest.fn<(_payload: PageletDetailPayload) => void>();
        const host = makeHost({
            runMaintenanceReview,
            runQuietRecall,
            openPageletDetailView,
        });
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            runMaintenanceReview(): Promise<void>;
            runQuietRecall(): Promise<void>;
        };

        const maintenanceRun = internals.runMaintenanceReview();
        await Promise.resolve();
        await internals.runQuietRecall();
        resolveMaintenance(maintenanceReview);
        await maintenanceRun;

        expect(runQuietRecall).not.toHaveBeenCalled();
        expect(openPageletDetailView).toHaveBeenCalledTimes(1);
        expect(openPageletDetailView).toHaveBeenCalledWith(expect.objectContaining({
            title: "Maintenance Review",
            extra: expect.objectContaining({ maintenanceReview }),
        }));
    });

    it("reports authorization-aware runtime state, feature usage, round diagnostics, and cost", async () => {
        jest.mocked(Notice).mockClear();
        const getPageletFeatureRateLimitStatus = jest.fn(async () => ({
            scopeRecap: {
                hourlyUsed: 1,
                hourlyCap: 2,
                hourlyRemaining: 1,
                dailyUsed: 4,
                dailyCap: 10,
                dailyRemaining: 6,
                dailyResetAt: Date.parse("2026-07-19T00:00:00.000Z"),
            },
            quietRecall: {
                hourlyUsed: 3,
                hourlyCap: 10,
                hourlyRemaining: 7,
                dailyUsed: 8,
                dailyCap: 50,
                dailyRemaining: 42,
                dailyResetAt: Date.parse("2026-07-19T00:00:00.000Z"),
            },
        }));
        const host = makeHost({ getPageletFeatureRateLimitStatus });
        host.settings.pagelet.scopeRecapBackgroundAuthorization = "pending";
        host.settings.pagelet.scopeRecapPreparationEnabled = true;
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            lastRecapAttempt: ScopeRecapPreparationResult["attempt"];
            lastQuietRecallDiagnostics: QuietRecallEvaluationDiagnostics;
            lastQuietRecallAcceptedCount: number;
        };
        internals.lastRecapAttempt = {
            attemptedAt: "2026-07-18T08:30:00.000Z",
            outcome: "success",
            scope: { kind: "folder" },
            sourceSnapshotId: "scope-snapshot",
            dataBoundarySnapshotId: "boundary-snapshot",
            providerCallMade: true,
            includedSourceCount: 2,
            cost: {
                inputTokens: 100,
                outputTokens: 20,
                estimatedCost: 0.001,
                currency: "USD",
                pricingKnown: true,
            },
        };
        internals.lastQuietRecallDiagnostics = {
            roundId: "round-12345678",
            startedAt: Date.parse("2026-07-18T08:31:00.000Z"),
            contextFingerprint: "context-fingerprint",
            candidateCount: 1,
            evaluatedCandidateCount: 1,
            providerCalls: 1,
            initialCalls: 1,
            languageRetryCalls: 0,
            cacheHits: 0,
            inFlightHits: 0,
            estimatedCost: 0.002,
            pricingKnown: true,
            limiterUsage: {
                hourlyUsed: 3,
                hourlyCap: 10,
                hourlyRemaining: 7,
                dailyUsed: 8,
                dailyCap: 50,
                dailyRemaining: 42,
            },
            attempts: [],
        };
        internals.lastQuietRecallAcceptedCount = 1;

        orchestrator.getCommandCallbacks().onShowBackgroundPreparationStatus();
        await flushAsyncWork();

        expect(getPageletFeatureRateLimitStatus).toHaveBeenCalledTimes(1);
        const message = jest.mocked(Notice).mock.calls.at(-1)?.[0] as string;
        expect(message).toContain("Scope Recap preparation: Stopped");
        expect(message).toContain("actual AI call yes");
        expect(message).toContain("estimated cost $0.001000");
        expect(message).toContain("Quiet Recall evaluation: round round-12");
        expect(message).toContain("estimated cost $0.002000");
        expect(message).toContain("Scope Recap 1/2 this hour and 4/10 today");
        expect(message).toContain("Quiet Recall 3/10 this hour and 8/50 today");
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

    it("keeps selected review failures visible in the panel", async () => {
        const now = Date.now();
        const activeFile = makeTFile("notes/current.md", { size: 100, mtime: now });
        const panelView = { open: jest.fn(), showReviewError: jest.fn() };
        const foregroundAnalyze = jest.fn(async () => {
            throw new Error("Pagelet review timed out. Try again, or shorten the note before retrying.");
        });
        const host = makeHost({
            app: {
                workspace: {
                    getActiveFile: jest.fn(() => activeFile),
                },
                vault: {
                    getMarkdownFiles: jest.fn(() => [activeFile]),
                    getAbstractFileByPath: jest.fn((path: string) => (
                        path === activeFile.path ? activeFile : null
                    )),
                },
                metadataCache: {
                    getFileCache: jest.fn(() => null),
                },
            } as unknown as PageletHost["app"],
            createForegroundAnalyzeCallback: () => foregroundAnalyze,
        });
        const orchestrator = new PageletOrchestrator(host);
        (orchestrator as unknown as { panelView: typeof panelView }).panelView = panelView;

        await (orchestrator as unknown as { reviewSelectedScope(): Promise<void> }).reviewSelectedScope();

        expect(foregroundAnalyze).toHaveBeenCalledTimes(1);
        expect(panelView.open).not.toHaveBeenCalled();
        expect(panelView.showReviewError).toHaveBeenCalledWith(
            "Pagelet review timed out. Try again, or shorten the note before retrying.",
        );
        expect(Notice).toHaveBeenCalledWith(
            "Pagelet review timed out. Try again, or shorten the note before retrying.",
            5000,
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

    it("allows Discovery AI enrichment to run past the old 60s foreground ceiling", async () => {
        jest.useFakeTimers();
        try {
            const currentFile = makeTFile("notes/current.md");
            const linkedFile = makeTFile("notes/linked.md");
            const panelView = { open: jest.fn() };
            const log = jest.fn();
            const discoverConnections = jest.fn<PageletHost["discoverConnections"]>(async () => {
                await new Promise((resolve) => setTimeout(resolve, 61_000));
                return {
                    connections: [{
                        fromNote: "notes/current.md",
                        toNote: "notes/linked.md",
                        strength: "medium" as const,
                        sharedConcepts: ["AI enriched thread"],
                    }],
                    themes: [],
                    gaps: [],
                };
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

            const run = (orchestrator as unknown as { discoverConnections(): Promise<void> }).discoverConnections();
            await flushAsyncWork();
            jest.advanceTimersByTime(61_000);
            await flushAsyncWork();
            await run;

            expect(log).not.toHaveBeenCalledWith(
                "Discovery AI analysis failed; showing explicit wikilinks",
                expect.anything(),
            );
            expect(panelView.open).toHaveBeenCalledWith(
                "discover",
                expect.any(Array),
                expect.objectContaining({
                    connections: expect.arrayContaining([
                        expect.objectContaining({
                            sharedConcepts: expect.arrayContaining(["AI enriched thread"]),
                        }),
                    ]),
                }),
            );
        } finally {
            jest.useRealTimers();
        }
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

    it("clears stale recap pending state before saving Discovery findings", async () => {
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
            fileName: "pagelet-scope-recap.md",
            markdown: "# Old recap",
            targetFolder: ".pagelet",
            targetPath: ".pagelet/pagelet-scope-recap.md",
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
            targetPath: ".pagelet/pagelet-scope-recap.md",
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

    it("links Quiet Recall Bubble candidates only when the active note still matches the nudge source", async () => {
        const recordQuietRecallFeedback = jest.fn(async (
            _candidate: QuietRecallCandidate,
            _feedback: "view" | "accept" | "dismiss" | "later" | "not_relevant",
        ) => ({ ok: false as const, reason: "disabled" as const }));
        const candidate: QuietRecallCandidate = {
            id: "qr-link",
            title: "Recall: Link",
            summary: "Linkable note.",
            sourceRefs: [{ path: "notes/related.md", evidenceStrength: "medium" }],
            whyNow: ["This note appears related to the note you are viewing."],
            nextAction: "Open this note and decide whether the connection still matters.",
            relation: "related",
            score: 80,
            generatedAt: "2026-06-29T12:00:00.000Z",
        };
        const productionOwnerCandidate: QuietRecallCandidate = {
            ...candidate,
            id: "quiet-recall-link:notes/current.md:notes/related.md",
        };
        const linkRecallCandidate = jest.fn(async (_currentPath: string, _candidatePath: string) => {
            await recordQuietRecallFeedback(productionOwnerCandidate, "accept");
            return {
                ok: true,
                message: "Linked",
            };
        });
        const nudge: QuietRecallBubbleNudge = {
            candidateId: candidate.id,
            currentPath: "notes/current.md",
            relation: candidate.relation,
            generatedAt: candidate.generatedAt,
        };
        const host = makeHost({ linkRecallCandidate, recordQuietRecallFeedback });
        const orchestrator = new PageletOrchestrator(host);
        const bubbleView = { close: jest.fn() };
        const internals = orchestrator as unknown as {
            bubbleView: typeof bubbleView;
            quietRecallNudgeCandidate: QuietRecallCandidate | null;
            quietRecallBubbleNudge: QuietRecallBubbleNudge | null;
            handleQuietRecallBubbleLink(nudge: QuietRecallBubbleNudge): Promise<void>;
        };
        internals.bubbleView = bubbleView;
        internals.quietRecallNudgeCandidate = candidate;
        internals.quietRecallBubbleNudge = nudge;

        await internals.handleQuietRecallBubbleLink(nudge);

        expect(linkRecallCandidate).toHaveBeenCalledWith("notes/current.md", "notes/related.md");
        expect(recordQuietRecallFeedback).toHaveBeenCalledTimes(1);
        expect(recordQuietRecallFeedback).toHaveBeenCalledWith(productionOwnerCandidate, "accept");
        expect(internals.quietRecallBubbleNudge).toBeNull();
        expect(bubbleView.close).toHaveBeenCalledTimes(1);

        linkRecallCandidate.mockClear();
        recordQuietRecallFeedback.mockClear();
        bubbleView.close.mockClear();
        (host.app.workspace.getActiveFile as jest.Mock).mockReturnValue(makeTFile("notes/other.md"));
        internals.quietRecallNudgeCandidate = candidate;
        internals.quietRecallBubbleNudge = nudge;

        await internals.handleQuietRecallBubbleLink(nudge);

        expect(linkRecallCandidate).not.toHaveBeenCalled();
        expect(recordQuietRecallFeedback).not.toHaveBeenCalled();
        expect(internals.quietRecallBubbleNudge).toBe(nudge);
        expect(bubbleView.close).not.toHaveBeenCalled();
        expect(Notice).toHaveBeenCalledWith("Open a Markdown note before linking.", 4000);

        linkRecallCandidate.mockClear();
        jest.mocked(Notice).mockClear();
        (host.app.workspace.getActiveFile as jest.Mock).mockReturnValue(makeTFile("notes/current.md"));
        internals.quietRecallNudgeCandidate = {
            ...candidate,
            id: "qr-self-only",
            sourceRefs: [{ path: "notes/current.md", evidenceStrength: "medium" }],
            relation: "current",
        };
        internals.quietRecallBubbleNudge = {
            ...nudge,
            candidateId: "qr-self-only",
            relation: "current",
        };

        await internals.handleQuietRecallBubbleLink(internals.quietRecallBubbleNudge);

        expect(linkRecallCandidate).not.toHaveBeenCalled();
        expect(Notice).toHaveBeenCalledWith(
            "This recall does not have another note to link.",
            4000,
        );
    });
});
