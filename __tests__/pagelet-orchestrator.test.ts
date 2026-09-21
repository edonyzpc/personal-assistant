import { beforeAll, afterAll, describe, expect, it, jest } from "@jest/globals";

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

    class MockMarkdownView {}

    const getFrontMatterInfo = (markdown: string) => {
        const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
        return {
            contentStart: match?.[0].length ?? 0,
            exists: match !== null,
            frontmatter: match?.[1] ?? "",
        };
    };

    return {
        getFrontMatterInfo,
        MarkdownView: MockMarkdownView,
        Notice: jest.fn(),
        parseYaml: (yaml: string) => {
            if (yaml.includes("[unfinished")) throw new Error("Invalid YAML");
            return {};
        },
        TFile: MockTFile,
        normalizePath: (path: string) => path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/g, ""),
    };
});

jest.mock("../src/share-card/share-card-modal", () => ({
    ShareCardModal: jest.fn().mockImplementation(() => ({ open: jest.fn() })),
}));
jest.mock("../src/pagelet/bubble/BubbleView", () => ({
    BubbleView: class {
        mount() {}
        close() {}
        destroy() {}
    },
}));
jest.mock("../src/pagelet/panel/PanelView", () => ({
    PanelView: class {
        isOpen = false;
        mount() {}
        close() {}
        destroy() {}
    },
}));

import { Notice, TFile } from "obsidian";

import { PageletOrchestrator, type PageletHost } from "../src/pagelet/orchestrator";
import { ShareCardModal } from "../src/share-card/share-card-modal";
import { NudgeOwner, type NudgeTicket } from "../src/pagelet/BubbleCoordinator";
import type {
    OperationsExecutionResult,
    OperationsIntent,
    UndoResult,
} from "../src/ai-services/operations/types";
import type { PageletChatHandoffPreparationResult } from "../src/ai-services/pagelet-handoff";
import type { OnboardingNudge } from "../src/pagelet/bubble/BubbleContent";
import { quietRecallCandidateToDeliveryCandidate } from "../src/pagelet/bubble/recall-card";
import { scopeRecapToDeliveryCandidate } from "../src/pagelet/bubble/recap-card";
import type { DeliveryReceipt } from "../src/pagelet/attention";
import type {
    PageletDeepDiscoverControllerResult,
    PageletDeepDiscoverTriggerReason,
} from "../src/pagelet/agent/types";
import type { PageletAgentDeliveryCandidate } from "../src/pagelet/agent/delivery-adapter";
import type { PageletDetailPayload } from "../src/pagelet/tab/types";
import type {
    ConfirmedMemoryRecord,
    PatternDetectionResult,
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

function showOrchestratorBubble(
    orchestrator: PageletOrchestrator,
    bubbleView: unknown,
    petView: unknown,
): void {
    (orchestrator as unknown as {
        bubbleCoordinator: {
            showBubble(
                bubbleView: unknown,
                petView: unknown,
                options: { entry: "quick-review" },
            ): void;
        };
    }).bubbleCoordinator.showBubble(bubbleView, petView, { entry: "quick-review" });
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
        pageletFeatureScope: {},
        isFeatureScopeCurrent: () => true,
        settings: {
            pagelet: {
                enabled: true,
                petVisible: true,
                petCorner: "bottom-right",
                proactiveHints: false,
                proactiveHintsCooldown: 30,
                proactiveHintsQuietHours: { enabled: false, start: "22:00", end: "08:00" },
                backgroundDiscoveryEnabled: true,
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
                pageletProviderFirstUseNotified: false,
            },
            contextPager: {
                enabled: true,
            },
            quietRecall: {
                enabled: true,
                bubbleNudgesEnabled: false,
                quietRecallMode: "off",
            },
            focusMode: false,
            confirmedMemoryCount: 0,
        },
        log: jest.fn(),
        registerEvent: jest.fn(),
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
        getDeepDiscoverPolicyIdentity: () => "policy:v1",
        isDeepDiscoverCommitSealCurrent: (seal) => (
            seal.schemaVersion === 1
            && seal.controllerEpoch === 1
            && seal.evidenceEpoch === "evidence-1"
            && seal.policyIdentityKey === "policy:v1"
        ),
        createReviewQueueItem: async () => ({ ok: false, reason: "not_configured" }),
        dismissReviewQueueItem: async () => ({ ok: false, reason: "not_configured" }),
        ...overrides,
    };
    return host;
}

function makeVerifiedDeepDiscoverResult(
    triggerReason: PageletDeepDiscoverTriggerReason = "explicit",
    anchorPath = "notes/current.md",
): PageletDeepDiscoverControllerResult {
    const anchor = {
        path: anchorPath,
        mtime: 100,
        size: 100,
        contentHash: "a".repeat(64),
    };
    const related = {
        path: "notes/related.md",
        mtime: 101,
        size: 120,
        contentHash: "b".repeat(64),
    };
    const insightId = `deep-${anchorPath}`;
    const collectionId = `collection-${anchorPath}`;
    const insight = {
        insightId,
        collectionId,
        body: [
            "## Release assumptions conflict",
            `\`${anchorPath}\` requires feedback before release, while`,
            "`notes/related.md` shows that direct release amplifies risk.",
        ].join("\n"),
        normalizedBody: "release assumptions conflict",
        normalizedClaim: "release assumptions conflict",
        bodyHash: "body-hash",
        claimHash: "claim-hash",
        anchor,
        sources: [anchor, related],
        sourceRefs: [{ path: anchorPath }, { path: related.path }],
        cacheIdentity: {
            pipelineVersion: "pagelet-deep-discover-v2" as const,
            anchor,
            sources: [anchor, related],
            dataBoundaryIdentity: "boundary-test",
            providerPolicyIdentity: "provider-test",
            modelIdentity: "test:model",
            locale: "en",
        },
        cacheIdentityHash: `deep-${anchorPath}`,
        triggerReason,
        preparedAt: Date.parse("2026-07-31T00:00:00.000Z"),
        metrics: {
            modelTurns: 3,
            toolCalls: 9,
            wallTimeMs: 1_200,
        },
        webObservations: [],
    };
    return {
        status: "verified",
        commitSeal: {
            schemaVersion: 1,
            controllerEpoch: 1,
            evidenceEpoch: "evidence-1",
            policyIdentityKey: "policy:v1",
        },
        insight,
        insights: [insight],
        collection: {
            collectionId,
            anchor,
            insights: [insight],
            preparedAt: insight.preparedAt,
        },
    };
}

function makePageletOperationsIntent(): OperationsIntent {
    return {
        id: "intent-pagelet-1",
        runId: "pagelet:deep-notes-current",
        turnId: "pagelet-action:deep-notes-current",
        createdAt: 1_000,
        expiresAt: 61_000,
        state: "pending",
        operations: [{
            id: "operation-pagelet-1",
            toolCallId: "pagelet-link:deep-notes-current",
            name: "frontmatter_update",
            input: {
                path: "notes/current.md",
                set: { "pa-related": ["[[notes/related]]"] },
            },
            path: "notes/current.md",
            expectedBefore: "# Current",
            expectedAfter: "---\npa-related:\n  - '[[notes/related]]'\n---\n# Current",
        }],
    };
}

function makePageletOperationsResult(): OperationsExecutionResult {
    return {
        intentId: "intent-pagelet-1",
        state: "completed",
        operations: [{
            operationId: "operation-pagelet-1",
            toolCallId: "pagelet-link:deep-notes-current",
            name: "frontmatter_update",
            path: "notes/current.md",
            status: "succeeded",
            receiptId: "receipt-pagelet-1",
        }],
    };
}

function makePetWorkProbe() {
    const transitions: string[] = [];
    const stateMachine = {
        state: "idle" as "idle" | "working" | "nudge" | "resting",
        proactiveHintsEnabled: true,
        transition: jest.fn((event: "analysis-start" | "analysis-done" | "insights-ready") => {
            transitions.push(event);
            if (event === "analysis-start") stateMachine.state = "working";
            if (event === "analysis-done") stateMachine.state = "idle";
            if (event === "insights-ready") stateMachine.state = "nudge";
        }),
        forceState: jest.fn((state: "idle" | "working" | "nudge" | "resting") => {
            stateMachine.state = state;
        }),
    };
    const petView = {
        rootEl: {} as HTMLElement,
        taskKind: "review" as "review" | "connection" | "summary" | "background",
        setTaskKind: jest.fn((taskKind: "review" | "connection" | "summary" | "background") => {
            petView.taskKind = taskKind;
        }),
        stateMachine,
        destroy: jest.fn(),
    };
    return { petView, stateMachine, transitions };
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

describe("PageletOrchestrator Deep Discover migration", () => {
    it("acknowledges the exact candidates accepted on the current foreground route", async () => {
        const result = makeVerifiedDeepDiscoverResult();
        const acknowledgeDeepDiscoverResult = jest.fn<NonNullable<
            PageletHost["acknowledgeDeepDiscoverResult"]
        >>();
        const host = makeHost({
            runDeepDiscover: async () => result,
            acknowledgeDeepDiscoverResult,
        });
        const orchestrator = new PageletOrchestrator(host);

        await Promise.resolve(orchestrator.getCommandCallbacks().onReviewCurrent());

        expect(acknowledgeDeepDiscoverResult).toHaveBeenCalledTimes(1);
        const [acknowledgedResult, candidates] = acknowledgeDeepDiscoverResult.mock.calls[0]!;
        expect(acknowledgedResult).toBe(result);
        expect(candidates).toHaveLength(1);
        expect(candidates[0]).toMatchObject({
            id: result.status === "verified" ? result.insight.insightId : "unreachable",
            deliveryReceipt: { kind: "review" },
        });
    });

    it.each([
        [{ status: "quiet", reason: "no-insight" } as const],
        [{ status: "stale", reason: "evidence-epoch-changed" } as const],
        [{ status: "denied", reason: "data-boundary" } as const],
        [{ status: "limit", reason: "limit" } as const],
    ])("acknowledges a current-route terminal outcome without candidates: %o", async (result) => {
        const acknowledgeDeepDiscoverResult = jest.fn<NonNullable<
            PageletHost["acknowledgeDeepDiscoverResult"]
        >>();
        const host = makeHost({
            runDeepDiscover: async () => result,
            acknowledgeDeepDiscoverResult,
        });
        const orchestrator = new PageletOrchestrator(host);

        await Promise.resolve(orchestrator.getCommandCallbacks().onReviewCurrent());

        expect(acknowledgeDeepDiscoverResult).toHaveBeenCalledWith(result, []);
    });

    it("discards a controller result superseded before foreground acceptance", async () => {
        let finishRun: ((result: PageletDeepDiscoverControllerResult) => void) | undefined;
        const result = makeVerifiedDeepDiscoverResult();
        const runDeepDiscover = jest.fn<NonNullable<PageletHost["runDeepDiscover"]>>(() => (
            new Promise((resolve) => { finishRun = resolve; })
        ));
        const acknowledgeDeepDiscoverResult = jest.fn<NonNullable<
            PageletHost["acknowledgeDeepDiscoverResult"]
        >>();
        const discardDeepDiscoverResult = jest.fn<NonNullable<
            PageletHost["discardDeepDiscoverResult"]
        >>();
        const host = makeHost({
            runDeepDiscover,
            acknowledgeDeepDiscoverResult,
            discardDeepDiscoverResult,
        });
        const orchestrator = new PageletOrchestrator(host);

        const pending = Promise.resolve(orchestrator.getCommandCallbacks().onReviewCurrent());
        await Promise.resolve();
        (orchestrator as unknown as { foregroundRouteToken: number }).foregroundRouteToken += 1;
        finishRun?.(result);
        await pending;

        expect(discardDeepDiscoverResult).toHaveBeenCalledWith(result);
        expect(acknowledgeDeepDiscoverResult).not.toHaveBeenCalled();
    });

    it("routes every stable provider-backed entry to one controller and never calls legacy providers", async () => {
        const runDeepDiscover = jest.fn<NonNullable<PageletHost["runDeepDiscover"]>>(async () => ({
            status: "quiet",
            reason: "no-insight",
        } as const));
        const host = makeHost({ runDeepDiscover });
        const foregroundAnalyze = jest.fn();
        host.createForegroundAnalyzeCallback = () => foregroundAnalyze as never;
        const legacyDiscovery = jest.spyOn(host, "discoverConnections");
        const legacyRecap = jest.spyOn(host, "runScopeRecap");
        const legacyRecall = jest.spyOn(host, "runQuietRecall");
        const orchestrator = new PageletOrchestrator(host);
        const callbacks = orchestrator.getCommandCallbacks();

        await Promise.resolve(callbacks.onReviewCurrent());
        await Promise.resolve(callbacks.onQuickReview());
        await Promise.resolve(callbacks.onDiscoverConnections());
        await Promise.resolve(callbacks.onQuietRecall());
        await Promise.resolve(callbacks.onScopeRecap());
        callbacks.onOpenPreparedReview();
        await flushAsyncWork();

        expect(runDeepDiscover).toHaveBeenCalledTimes(6);
        for (const [request] of runDeepDiscover.mock.calls) {
            expect(request).toEqual({
                path: "notes/current.md",
                triggerReason: "explicit",
                force: true,
            });
        }
        expect(foregroundAnalyze).not.toHaveBeenCalled();
        expect(legacyDiscovery).not.toHaveBeenCalled();
        expect(legacyRecap).not.toHaveBeenCalled();
        expect(legacyRecall).not.toHaveBeenCalled();
    });

    it("uses the exact leave, changed-open, and edited paths for automatic triggers", async () => {
        jest.useFakeTimers();
        try {
            const runDeepDiscover = jest.fn<NonNullable<PageletHost["runDeepDiscover"]>>(async () => ({
                status: "quiet",
                reason: "no-insight",
            } as const));
            const host = makeHost({ runDeepDiscover });
            host.settings.pagelet.petVisible = false;
            const orchestrator = new PageletOrchestrator(host);
            const internals = orchestrator as unknown as {
                handleLeafChange(leaf: unknown): void;
                handleNoteActivity(path: string): void;
            };
            const leaf = (path: string) => ({
                view: {
                    getViewType: () => "markdown",
                    file: makeTFile(path),
                    contentEl: {} as HTMLElement,
                },
            });

            internals.handleLeafChange(leaf("notes/a.md"));
            internals.handleLeafChange(leaf("notes/b.md"));
            internals.handleNoteActivity("notes/edited.md");
            internals.handleNoteActivity("notes/another-edited.md");
            jest.advanceTimersByTime(5_000);
            await flushAsyncWork();

            expect(runDeepDiscover.mock.calls.map(([request]) => request)).toEqual([
                {
                    path: "notes/a.md",
                    triggerReason: "open-changed-note",
                },
                {
                    path: "notes/a.md",
                    triggerReason: "leave-note",
                },
                {
                    path: "notes/b.md",
                    triggerReason: "open-changed-note",
                },
                {
                    path: "notes/edited.md",
                    triggerReason: "edit-idle",
                },
                {
                    path: "notes/another-edited.md",
                    triggerReason: "edit-idle",
                },
            ]);
        } finally {
            jest.useRealTimers();
        }
    });

    it("invalidates a candidate and its open Panel when any cited source changes", async () => {
        const host = makeHost();
        const orchestrator = new PageletOrchestrator(host);
        const panelView = {
            open: jest.fn(),
            close: jest.fn(),
            isOpen: true,
        };
        const internals = orchestrator as unknown as {
            panelView: typeof panelView;
            acceptDeepDiscoverResult(
                result: PageletDeepDiscoverControllerResult,
                options: { path: string; proactive: boolean },
            ): { kind: "review"; sourceRefs: Array<{ path: string }> } | null;
            openAgentInsightPanel(
                candidate: { kind: "review"; sourceRefs: Array<{ path: string }> },
            ): void;
            invalidateAgentInsightForPaths(paths: readonly string[]): void;
            agentInsightCandidate: unknown;
            openAgentInsightCandidate: unknown;
        };
        internals.panelView = panelView;
        const candidate = internals.acceptDeepDiscoverResult(
            makeVerifiedDeepDiscoverResult(),
            { path: "notes/current.md", proactive: false },
        );
        expect(candidate).not.toBeNull();
        internals.openAgentInsightPanel(candidate!);

        internals.invalidateAgentInsightForPaths(["notes/related.md"]);

        expect(internals.agentInsightCandidate).toBeNull();
        expect(internals.openAgentInsightCandidate).toBeNull();
        expect(panelView.close).toHaveBeenCalledTimes(1);
    });

    it("invalidates a candidate and its open Panel when policy identity changes", () => {
        let policyIdentity = "policy:v1";
        const host = makeHost({
            getDeepDiscoverPolicyIdentity: () => policyIdentity,
        });
        const orchestrator = new PageletOrchestrator(host);
        const panelView = {
            open: jest.fn(),
            close: jest.fn(),
            isOpen: true,
        };
        const internals = orchestrator as unknown as {
            panelView: typeof panelView;
            acceptDeepDiscoverResult(
                result: PageletDeepDiscoverControllerResult,
                options: { path: string; proactive: boolean },
            ): { kind: "review"; sourceRefs: Array<{ path: string }> } | null;
            openAgentInsightPanel(
                candidate: { kind: "review"; sourceRefs: Array<{ path: string }> },
            ): void;
            currentAgentInsightCandidate(): unknown;
            agentInsightCandidate: unknown;
            openAgentInsightCandidate: unknown;
        };
        internals.panelView = panelView;
        const candidate = internals.acceptDeepDiscoverResult(
            makeVerifiedDeepDiscoverResult(),
            { path: "notes/current.md", proactive: false },
        );
        internals.openAgentInsightPanel(candidate!);

        policyIdentity = "policy:v2";
        expect(internals.currentAgentInsightCandidate()).toBeNull();

        expect(internals.agentInsightCandidate).toBeNull();
        expect(internals.openAgentInsightCandidate).toBeNull();
        expect(panelView.close).toHaveBeenCalledTimes(1);
    });

    it.each([
        ["verified", { evidenceEpoch: "evidence-2" }],
        ["cache-hit", { controllerEpoch: 2 }],
        ["verified", { policyIdentityKey: "policy:v2" }],
    ] as const)(
        "rejects a %s result whose commit seal is no longer current",
        (status, staleSeal) => {
            const discardDeepDiscoverResult = jest.fn<NonNullable<
                PageletHost["discardDeepDiscoverResult"]
            >>();
            const host = makeHost({ discardDeepDiscoverResult });
            host.settings.pagelet.proactiveHints = true;
            const orchestrator = new PageletOrchestrator(host);
            const internals = orchestrator as unknown as {
                acceptDeepDiscoverResult(
                    result: PageletDeepDiscoverControllerResult,
                    options: { path: string; proactive: boolean },
                ): PageletAgentDeliveryCandidate | null;
                currentAgentInsightCandidate(): PageletAgentDeliveryCandidate | null;
                currentAdmittedNudgeTickets(): NudgeTicket[];
            };
            const current = makeVerifiedDeepDiscoverResult("edit-idle");
            const admitted = internals.acceptDeepDiscoverResult(current, {
                path: "notes/current.md",
                proactive: true,
            });
            expect(admitted).not.toBeNull();
            const staleBase = makeVerifiedDeepDiscoverResult("edit-idle");
            if (staleBase.status !== "verified") throw new Error("expected verified fixture");
            staleBase.insight.insightId = "deep-stale-result";
            staleBase.insights = [staleBase.insight];
            staleBase.collection.insights = staleBase.insights;
            const stale = {
                ...staleBase,
                status,
                commitSeal: { ...staleBase.commitSeal, ...staleSeal },
            } as PageletDeepDiscoverControllerResult;

            expect(internals.acceptDeepDiscoverResult(stale, {
                path: "notes/current.md",
                proactive: true,
            })).toBeNull();
            expect(internals.currentAgentInsightCandidate()?.id).toBe(admitted?.id);
            expect(internals.currentAdmittedNudgeTickets()).toHaveLength(1);
            expect(discardDeepDiscoverResult).toHaveBeenCalledTimes(1);
            expect(discardDeepDiscoverResult).toHaveBeenCalledWith(stale);
        },
    );

    it("discards a stale sealed foreground result without acknowledging smoke evidence", async () => {
        const result = makeVerifiedDeepDiscoverResult();
        const acknowledgeDeepDiscoverResult = jest.fn<NonNullable<
            PageletHost["acknowledgeDeepDiscoverResult"]
        >>();
        const discardDeepDiscoverResult = jest.fn<NonNullable<
            PageletHost["discardDeepDiscoverResult"]
        >>();
        const host = makeHost({
            runDeepDiscover: async () => result,
            isDeepDiscoverCommitSealCurrent: () => false,
            acknowledgeDeepDiscoverResult,
            discardDeepDiscoverResult,
        });
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            runExplicitDeepDiscover(): Promise<void>;
        };

        await internals.runExplicitDeepDiscover();

        expect(discardDeepDiscoverResult).toHaveBeenCalledTimes(1);
        expect(discardDeepDiscoverResult).toHaveBeenCalledWith(result);
        expect(acknowledgeDeepDiscoverResult).not.toHaveBeenCalled();
    });

    it("admits a verified automatic insight as one AgentInsight ticket", async () => {
        const runDeepDiscover = jest.fn<NonNullable<PageletHost["runDeepDiscover"]>>(async () => (
            makeVerifiedDeepDiscoverResult("edit-idle")
        ));
        const acknowledgeDeepDiscoverResult = jest.fn<NonNullable<
            PageletHost["acknowledgeDeepDiscoverResult"]
        >>();
        const discardDeepDiscoverResult = jest.fn<NonNullable<
            PageletHost["discardDeepDiscoverResult"]
        >>();
        const host = makeHost({
            runDeepDiscover,
            acknowledgeDeepDiscoverResult,
            discardDeepDiscoverResult,
        });
        host.settings.pagelet.proactiveHints = true;
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            runAutomaticDeepDiscover(path: string, reason: "edit-idle"): Promise<void>;
            currentAdmittedNudgeTickets(): NudgeTicket[];
            agentInsightCandidate: { kind: string; sourceRefs: Array<{ path: string }> } | null;
        };

        await internals.runAutomaticDeepDiscover("notes/current.md", "edit-idle");

        expect(internals.agentInsightCandidate).toEqual(expect.objectContaining({
            kind: "review",
            sourceRefs: [
                expect.objectContaining({ path: "notes/current.md" }),
                expect.objectContaining({ path: "notes/related.md" }),
            ],
        }));
        expect(internals.currentAdmittedNudgeTickets()).toEqual([
            expect.objectContaining({
                owner: NudgeOwner.AgentInsight,
                candidate: expect.objectContaining({ kind: "review" }),
            }),
        ]);
        expect(acknowledgeDeepDiscoverResult).not.toHaveBeenCalled();
        expect(discardDeepDiscoverResult).not.toHaveBeenCalled();
        expect(Notice).not.toHaveBeenCalled();
    });

    it("keeps manual discovery available while automatic discovery is paused", async () => {
        const runDeepDiscover = jest.fn<NonNullable<PageletHost["runDeepDiscover"]>>(async () => ({
            status: "quiet",
            reason: "no-insight",
        }));
        const cancelDeepDiscover = jest.fn();
        const host = makeHost({ runDeepDiscover, cancelDeepDiscover });
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            runAutomaticDeepDiscover(path: string, reason: "edit-idle"): Promise<void>;
            runExplicitDeepDiscover(): Promise<void>;
        };
        host.settings.pagelet.backgroundDiscoveryEnabled = false;
        orchestrator.syncSettings();
        await internals.runAutomaticDeepDiscover("notes/current.md", "edit-idle");
        await internals.runExplicitDeepDiscover();
        expect(cancelDeepDiscover).not.toHaveBeenCalled();
        expect(runDeepDiscover).toHaveBeenCalledTimes(1);
        expect(runDeepDiscover).toHaveBeenCalledWith({
            path: "notes/current.md",
            triggerReason: "explicit",
            force: true,
        });
        expect(Notice).not.toHaveBeenCalled();
    });

    it.each([false, true])("discards a late automatic result after pause, resumed=%s", async (resume) => {
        const result = makeVerifiedDeepDiscoverResult("edit-idle");
        let finish: ((value: PageletDeepDiscoverControllerResult) => void) | undefined;
        const discardDeepDiscoverResult = jest.fn();
        const host = makeHost({
            runDeepDiscover: () => new Promise((resolve) => { finish = resolve; }),
            discardDeepDiscoverResult,
        });
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            runAutomaticDeepDiscover(path: string, reason: "edit-idle"): Promise<void>;
            agentInsightCandidate: unknown;
        };
        const pending = internals.runAutomaticDeepDiscover("notes/current.md", "edit-idle");
        host.settings.pagelet.backgroundDiscoveryEnabled = false;
        orchestrator.syncSettings();
        if (resume) {
            host.settings.pagelet.backgroundDiscoveryEnabled = true;
            orchestrator.syncSettings();
        }
        finish?.(result);
        await pending;
        expect(discardDeepDiscoverResult).toHaveBeenCalledWith(result);
        expect(internals.agentInsightCandidate).toBeNull();
    });

    it("keeps two collection insights on independent candidate and seen state", () => {
        const host = makeHost();
        host.settings.pagelet.proactiveHints = true;
        const orchestrator = new PageletOrchestrator(host);
        const result = makeVerifiedDeepDiscoverResult("edit-idle");
        if (result.status !== "verified") throw new Error("expected verified fixture");
        const collectionId = "collection-two-independent";
        result.insight.collectionId = collectionId;
        const second = {
            ...result.insight,
            insightId: "deep-notes/current.md-second",
            collectionId,
            body: "## Rollback gap\n`notes/current.md` and `notes/related.md` reveal a distinct rollback risk.",
            normalizedBody: "rollback gap distinct rollback risk",
            normalizedClaim: "rollback gap distinct rollback risk",
            bodyHash: "second-body",
            claimHash: "second-claim",
        };
        result.insights = [result.insight, second];
        result.collection = {
            collectionId,
            anchor: result.insight.anchor,
            insights: result.insights,
            preparedAt: result.insight.preparedAt,
        };
        const internals = orchestrator as unknown as {
            acceptDeepDiscoverResult(
                result: PageletDeepDiscoverControllerResult,
                options: { path: string; proactive: boolean },
            ): PageletAgentDeliveryCandidate | null;
            currentAgentInsightCandidate(): PageletAgentDeliveryCandidate | null;
            currentAdmittedNudgeTickets(): NudgeTicket[];
            dismissAgentInsightNudge(candidate: PageletAgentDeliveryCandidate): void;
            pendingAgentInsightCandidates: PageletAgentDeliveryCandidate[];
            bubbleCoordinator: {
                currentNudgeTickets(): NudgeTicket[];
            };
            attentionStore: {
                markSeen(receipt: NonNullable<PageletAgentDeliveryCandidate["deliveryReceipt"]>, source: "detail"): void;
            };
        };

        const first = internals.acceptDeepDiscoverResult(result, {
            path: "notes/current.md",
            proactive: true,
        });
        expect(first?.id).toBe(result.insight.insightId);
        expect(internals.pendingAgentInsightCandidates.map((candidate) => candidate.id)).toEqual([
            second.insightId,
        ]);
        expect(first?.deliveryReceipt).not.toEqual(
            internals.pendingAgentInsightCandidates[0]?.deliveryReceipt,
        );
        expect(internals.currentAdmittedNudgeTickets().map((ticket) => (
            ticket.owner === NudgeOwner.AgentInsight ? ticket.candidate.id : ticket.key
        ))).toEqual([result.insight.insightId, second.insightId]);
        expect(internals.bubbleCoordinator.currentNudgeTickets().map((ticket) => ticket.key)).toEqual([
            `${NudgeOwner.AgentInsight}:${result.insight.insightId}`,
            `${NudgeOwner.AgentInsight}:${second.insightId}`,
        ]);
        internals.dismissAgentInsightNudge(first!);
        expect(internals.currentAgentInsightCandidate()?.id).toBe(result.insight.insightId);
        expect(internals.bubbleCoordinator.currentNudgeTickets()).toEqual([
            expect.objectContaining({
                owner: NudgeOwner.AgentInsight,
                candidate: expect.objectContaining({ id: second.insightId }),
            }),
        ]);
        if (!first?.deliveryReceipt) throw new Error("expected first delivery receipt");
        internals.attentionStore.markSeen(first.deliveryReceipt, "detail");

        expect(internals.currentAgentInsightCandidate()?.id).toBe(second.insightId);
        expect(internals.pendingAgentInsightCandidates).toHaveLength(0);
        expect(internals.currentAdmittedNudgeTickets()).toEqual([
            expect.objectContaining({
                owner: NudgeOwner.AgentInsight,
                candidate: expect.objectContaining({ id: second.insightId }),
            }),
        ]);
        expect(internals.bubbleCoordinator.currentNudgeTickets()).toEqual([
            expect.objectContaining({
                owner: NudgeOwner.AgentInsight,
                candidate: expect.objectContaining({ id: second.insightId }),
            }),
        ]);

        internals.dismissAgentInsightNudge(
            internals.currentAgentInsightCandidate()!,
        );
        expect(internals.currentAdmittedNudgeTickets()).toHaveLength(0);
        expect(internals.currentAgentInsightCandidate()?.id).toBe(second.insightId);
    });

    it("keeps the first admitted insight when only the second delivery becomes stale", () => {
        const host = makeHost();
        const orchestrator = new PageletOrchestrator(host);
        const result = makeVerifiedDeepDiscoverResult("edit-idle");
        if (result.status !== "verified") throw new Error("expected verified fixture");
        const collectionId = "collection-independent-stale-second";
        result.insight.collectionId = collectionId;
        const third = {
            path: "notes/third.md",
            mtime: 102,
            size: 130,
            contentHash: "c".repeat(64),
        };
        const second = {
            ...result.insight,
            insightId: "deep-notes/current.md-second-stale",
            collectionId,
            body: "## Rollback gap\n`notes/current.md` and `notes/third.md` reveal a distinct rollback risk.",
            normalizedBody: "rollback gap distinct rollback risk",
            normalizedClaim: "rollback gap distinct rollback risk",
            bodyHash: "second-stale-body",
            claimHash: "second-stale-claim",
            sources: [result.insight.anchor, third],
            sourceRefs: [{ path: result.insight.anchor.path }, { path: third.path }],
            cacheIdentity: {
                ...result.insight.cacheIdentity,
                sources: [result.insight.anchor, third],
            },
        };
        result.insights = [result.insight, second];
        result.collection = {
            collectionId,
            anchor: result.insight.anchor,
            insights: result.insights,
            preparedAt: result.insight.preparedAt,
        };
        const internals = orchestrator as unknown as {
            acceptDeepDiscoverResult(
                result: PageletDeepDiscoverControllerResult,
                options: { path: string; proactive: boolean },
            ): PageletAgentDeliveryCandidate | null;
            invalidateAgentInsightForPaths(paths: readonly string[]): void;
            currentAgentInsightCandidate(): PageletAgentDeliveryCandidate | null;
            pendingAgentInsightCandidates: PageletAgentDeliveryCandidate[];
        };

        const first = internals.acceptDeepDiscoverResult(result, {
            path: "notes/current.md",
            proactive: true,
        });
        internals.invalidateAgentInsightForPaths([third.path]);

        expect(internals.currentAgentInsightCandidate()?.id).toBe(first?.id);
        expect(internals.pendingAgentInsightCandidates).toHaveLength(0);
    });

    it("opens verified explicit free-form output in a read-only Panel with every source", async () => {
        const runDeepDiscover = jest.fn<NonNullable<PageletHost["runDeepDiscover"]>>(
            async () => makeVerifiedDeepDiscoverResult(),
        );
        const host = makeHost({ runDeepDiscover });
        const orchestrator = new PageletOrchestrator(host);
        const panelView = {
            open: jest.fn(),
            close: jest.fn(),
            isOpen: true,
        };
        (orchestrator as unknown as { panelView: typeof panelView }).panelView = panelView;

        await Promise.resolve(orchestrator.getCommandCallbacks().onDiscoverConnections());

        expect(panelView.open).toHaveBeenCalledWith(
            "discover",
            expect.arrayContaining([
                expect.objectContaining({ sourceFile: "notes/current.md" }),
                expect.objectContaining({ sourceFile: "notes/related.md" }),
            ]),
            expect.objectContaining({
                sourcePath: "notes/current.md",
            }),
        );
    });

    it("stages the context-specific link first, then confirms once and keeps result through its own modify event", async () => {
        const intent = makePageletOperationsIntent();
        const result = makePageletOperationsResult();
        const validateDeepDiscoverInsight = jest.fn<NonNullable<PageletHost["validateDeepDiscoverInsight"]>>(
            async () => true,
        );
        const stagePageletInsightLink = jest.fn<NonNullable<PageletHost["stagePageletInsightLink"]>>(
            async () => intent,
        );
        const confirmPageletOperationsIntent = jest.fn<NonNullable<PageletHost["confirmPageletOperationsIntent"]>>(
            async () => result,
        );
        const cancelPageletOperationsIntent = jest.fn<NonNullable<PageletHost["cancelPageletOperationsIntent"]>>();
        const undoPageletOperationsReceipts = jest.fn<NonNullable<PageletHost["undoPageletOperationsReceipts"]>>(
            async (): Promise<UndoResult[]> => [{
            receiptId: "receipt-pagelet-1",
            operationId: "operation-pagelet-1",
            path: "notes/current.md",
            status: "undone",
        }]);
        const consumePageletOperationsSelfWrite = jest.fn<NonNullable<PageletHost["consumePageletOperationsSelfWrite"]>>()
            .mockReturnValueOnce(true)
            .mockReturnValue(false);
        const host = makeHost({
            validateDeepDiscoverInsight,
            isOperationsAvailable: () => true,
            stagePageletInsightLink,
            confirmPageletOperationsIntent,
            cancelPageletOperationsIntent,
            undoPageletOperationsReceipts,
            consumePageletOperationsSelfWrite,
        });
        const orchestrator = new PageletOrchestrator(host);
        const panelView = {
            open: jest.fn<(layout: string, findings: unknown[], extra?: unknown) => void>(),
            close: jest.fn(),
            isOpen: true,
        };
        const handleNoteActivity = jest.fn();
        const internals = orchestrator as unknown as {
            panelView: typeof panelView;
            acceptDeepDiscoverResult(
                result: PageletDeepDiscoverControllerResult,
                options: { path: string; proactive: boolean },
            ): PageletAgentDeliveryCandidate;
            openAgentInsightPanel(candidate: PageletAgentDeliveryCandidate): void;
            handleMarkdownModify(path: string): void;
            handleNoteActivity: typeof handleNoteActivity;
            openAgentInsightCandidate: unknown;
        };
        internals.panelView = panelView;
        internals.handleNoteActivity = handleNoteActivity;
        const candidate = internals.acceptDeepDiscoverResult(
            makeVerifiedDeepDiscoverResult(),
            { path: "notes/current.md", proactive: false },
        );
        internals.openAgentInsightPanel(candidate);
        const latestFirstFinding = () => panelView.open.mock.calls.at(-1)?.[1][0] as {
            actionStatus?: { label: string; preview?: string };
            actions: Array<{ label: string; callback(): void }>;
        };

        expect(latestFirstFinding().actions.map((action) => action.label)).toEqual([
            "Link “related” from “current”",
            "Discuss in Chat",
        ]);
        latestFirstFinding().actions[0].callback();
        await flushAsyncWork();

        expect(validateDeepDiscoverInsight).toHaveBeenCalledTimes(1);
        expect(stagePageletInsightLink).toHaveBeenCalledWith({
            candidateId: "deep-notes/current.md",
            anchorPath: "notes/current.md",
            sourcePath: "notes/related.md",
        }, expect.any(AbortSignal));
        expect(confirmPageletOperationsIntent).not.toHaveBeenCalled();
        expect(latestFirstFinding().actionStatus?.preview).toContain("Set pa-related");

        latestFirstFinding().actions.find((action) => action.label === "Confirm")?.callback();
        await flushAsyncWork();

        expect(confirmPageletOperationsIntent).toHaveBeenCalledTimes(1);
        expect(latestFirstFinding().actionStatus?.label).toBe("The related-note link was added.");
        expect(latestFirstFinding().actions[0].label).toBe("Undo");

        latestFirstFinding().actions[0].callback();
        await flushAsyncWork();

        expect(undoPageletOperationsReceipts).toHaveBeenCalledWith(["receipt-pagelet-1"]);
        expect(latestFirstFinding().actionStatus?.label).toBe("The change was undone.");

        internals.handleMarkdownModify("notes/current.md");
        expect(internals.openAgentInsightCandidate).not.toBeNull();
        expect(panelView.close).not.toHaveBeenCalled();
        expect(handleNoteActivity).toHaveBeenCalledWith("notes/current.md");

        internals.handleMarkdownModify("notes/current.md");
        expect(internals.openAgentInsightCandidate).toBeNull();
        expect(panelView.close).toHaveBeenCalledTimes(1);
    });

    it("cancels a staged Pagelet intent on inline Cancel and Panel session close", async () => {
        const intent = makePageletOperationsIntent();
        const cancelPageletOperationsIntent = jest.fn<NonNullable<PageletHost["cancelPageletOperationsIntent"]>>();
        const host = makeHost({
            validateDeepDiscoverInsight: async () => true,
            isOperationsAvailable: () => true,
            stagePageletInsightLink: async () => intent,
            confirmPageletOperationsIntent: jest.fn(async () => makePageletOperationsResult()),
            cancelPageletOperationsIntent,
            undoPageletOperationsReceipts: async () => [],
        });
        const orchestrator = new PageletOrchestrator(host);
        const panelView = {
            open: jest.fn<(layout: string, findings: unknown[], extra?: unknown) => void>(),
            close: jest.fn(),
            isOpen: true,
        };
        const internals = orchestrator as unknown as {
            panelView: typeof panelView;
            acceptDeepDiscoverResult(
                result: PageletDeepDiscoverControllerResult,
                options: { path: string; proactive: boolean },
            ): PageletAgentDeliveryCandidate;
            openAgentInsightPanel(candidate: PageletAgentDeliveryCandidate): void;
            clearPanelSession(): void;
        };
        internals.panelView = panelView;
        const candidate = internals.acceptDeepDiscoverResult(
            makeVerifiedDeepDiscoverResult(),
            { path: "notes/current.md", proactive: false },
        );
        internals.openAgentInsightPanel(candidate);
        const actions = () => (panelView.open.mock.calls.at(-1)?.[1][0] as {
            actions: Array<{ label: string; callback(): void }>;
        }).actions;

        actions()[0].callback();
        await flushAsyncWork();
        actions().find((action) => action.label === "Cancel")?.callback();
        expect(cancelPageletOperationsIntent).toHaveBeenCalledWith(intent.id);

        actions()[0].callback();
        await flushAsyncWork();
        internals.clearPanelSession();
        expect(cancelPageletOperationsIntent).toHaveBeenCalledTimes(2);
    });

    it("refreshes open idle/error controls on Operations setting changes and cancels a disabled pending intent", async () => {
        const intent = makePageletOperationsIntent();
        let operationsAvailable = false;
        const cancelPageletOperationsIntent = jest.fn<NonNullable<PageletHost["cancelPageletOperationsIntent"]>>();
        const host = makeHost({
            validateDeepDiscoverInsight: async () => true,
            isOperationsAvailable: () => operationsAvailable,
            stagePageletInsightLink: async () => intent,
            confirmPageletOperationsIntent: async () => makePageletOperationsResult(),
            cancelPageletOperationsIntent,
            undoPageletOperationsReceipts: async () => [],
        });
        const orchestrator = new PageletOrchestrator(host);
        const panelView = {
            open: jest.fn<(layout: string, findings: unknown[], extra?: unknown) => void>(),
            close: jest.fn(),
            isOpen: true,
        };
        const internals = orchestrator as unknown as {
            panelView: typeof panelView;
            agentInsightActionState: {
                kind: "error";
                candidateId: string;
                error: "operations-unavailable";
            } | { kind: "idle" };
            acceptDeepDiscoverResult(
                result: PageletDeepDiscoverControllerResult,
                options: { path: string; proactive: boolean },
            ): PageletAgentDeliveryCandidate;
            openAgentInsightPanel(candidate: PageletAgentDeliveryCandidate): void;
        };
        internals.panelView = panelView;
        const candidate = internals.acceptDeepDiscoverResult(
            makeVerifiedDeepDiscoverResult(),
            { path: "notes/current.md", proactive: false },
        );
        internals.openAgentInsightPanel(candidate);
        const latest = () => panelView.open.mock.calls.at(-1)?.[1][0] as {
            actionStatus?: { label: string };
            actions: Array<{ label: string; disabled?: boolean; callback(): void }>;
        };

        expect(latest().actions[0]).toMatchObject({
            label: "Link “related” from “current”",
            disabled: true,
        });

        internals.agentInsightActionState = {
            kind: "error",
            candidateId: candidate.id,
            error: "operations-unavailable",
        };
        operationsAvailable = true;
        orchestrator.syncSettings();
        expect(latest().actionStatus).toBeUndefined();
        expect(latest().actions[0]?.disabled).toBe(false);

        latest().actions[0]?.callback();
        await flushAsyncWork();
        expect(latest().actions.map((action) => action.label)).toEqual(["Confirm", "Cancel"]);

        operationsAvailable = false;
        orchestrator.syncSettings();
        expect(cancelPageletOperationsIntent).toHaveBeenCalledWith(intent.id);
        expect(latest().actionStatus?.label).toBe(
            "Turn on Operations in Settings to confirm note changes.",
        );
        expect(latest().actions[0]?.disabled).toBe(true);
    });

    it("retains Confirm and Undo results when the Panel closes after either operation starts", async () => {
        let resolveConfirm!: (result: OperationsExecutionResult) => void;
        let resolveUndo!: (results: UndoResult[]) => void;
        const confirmPageletOperationsIntent = jest.fn<NonNullable<PageletHost["confirmPageletOperationsIntent"]>>(
            async () => await new Promise<OperationsExecutionResult>((resolve) => {
                resolveConfirm = resolve;
            }),
        );
        const undoPageletOperationsReceipts = jest.fn<NonNullable<PageletHost["undoPageletOperationsReceipts"]>>(
            async () => await new Promise<UndoResult[]>((resolve) => {
                resolveUndo = resolve;
            }),
        );
        const cancelPageletOperationsIntent = jest.fn<NonNullable<PageletHost["cancelPageletOperationsIntent"]>>();
        const host = makeHost({
            validateDeepDiscoverInsight: async () => true,
            isOperationsAvailable: () => true,
            stagePageletInsightLink: async () => makePageletOperationsIntent(),
            confirmPageletOperationsIntent,
            cancelPageletOperationsIntent,
            undoPageletOperationsReceipts,
        });
        const orchestrator = new PageletOrchestrator(host);
        const panelView = {
            open: jest.fn<(layout: string, findings: unknown[], extra?: unknown) => void>(),
            close: jest.fn(),
            isOpen: true,
        };
        panelView.open.mockImplementation(() => {
            panelView.isOpen = true;
        });
        const internals = orchestrator as unknown as {
            panelView: typeof panelView;
            agentInsightCandidate: PageletAgentDeliveryCandidate | null;
            openAgentInsightCandidate: PageletAgentDeliveryCandidate | null;
            agentInsightActionState: { kind: string; result?: OperationsExecutionResult };
            acceptDeepDiscoverResult(
                result: PageletDeepDiscoverControllerResult,
                options: { path: string; proactive: boolean },
            ): PageletAgentDeliveryCandidate;
            openAgentInsightPanel(candidate: PageletAgentDeliveryCandidate): void;
            clearPanelSession(): void;
        };
        internals.panelView = panelView;
        const candidate = internals.acceptDeepDiscoverResult(
            makeVerifiedDeepDiscoverResult(),
            { path: "notes/current.md", proactive: true },
        );
        internals.openAgentInsightPanel(candidate);
        const actions = () => (panelView.open.mock.calls.at(-1)?.[1][0] as {
            actionStatus?: { label: string };
            actions: Array<{ label: string; callback(): void }>;
        });

        actions().actions[0]?.callback();
        await flushAsyncWork();
        actions().actions.find((action) => action.label === "Confirm")?.callback();
        await flushAsyncWork();
        expect(confirmPageletOperationsIntent).toHaveBeenCalledTimes(1);

        panelView.isOpen = false;
        const renderCountBeforeConfirmClose = panelView.open.mock.calls.length;
        internals.clearPanelSession();
        expect(cancelPageletOperationsIntent).not.toHaveBeenCalled();
        expect(panelView.isOpen).toBe(true);
        expect(panelView.open).toHaveBeenCalledTimes(renderCountBeforeConfirmClose + 1);
        expect(internals.openAgentInsightCandidate?.id).toBe(candidate.id);
        resolveConfirm(makePageletOperationsResult());
        await flushAsyncWork();

        expect(internals.agentInsightCandidate).toBeNull();
        expect(internals.agentInsightActionState).toMatchObject({
            kind: "result",
            result: expect.objectContaining({ intentId: "intent-pagelet-1" }),
        });
        expect(actions().actionStatus?.label).toBe("The related-note link was added.");

        const changedResult = makeVerifiedDeepDiscoverResult();
        if (changedResult.status !== "verified") throw new Error("expected verified fixture");
        changedResult.insight.insightId = "deep-notes/current.md-after-write";
        changedResult.insight.collectionId = "collection-notes/current.md-after-write";
        changedResult.collection.collectionId = changedResult.insight.collectionId;
        changedResult.insight.cacheIdentityHash = "deep-notes/current.md-after-write";
        changedResult.insight.anchor = {
            ...changedResult.insight.anchor,
            mtime: 200,
            contentHash: "c".repeat(64),
        };
        changedResult.insight.cacheIdentity = {
            ...changedResult.insight.cacheIdentity,
            anchor: changedResult.insight.anchor,
        };
        const changedCandidate = internals.acceptDeepDiscoverResult(
            changedResult,
            { path: "notes/current.md", proactive: true },
        );
        expect(changedCandidate.id).not.toBe(candidate.id);
        expect(internals.agentInsightActionState.kind).toBe("result");
        expect(actions().actions.some((action) => action.label === "Undo")).toBe(true);

        actions().actions.find((action) => action.label === "Undo")?.callback();
        await flushAsyncWork();
        expect(undoPageletOperationsReceipts).toHaveBeenCalledWith(["receipt-pagelet-1"]);

        panelView.isOpen = false;
        const renderCountBeforeUndoClose = panelView.open.mock.calls.length;
        internals.clearPanelSession();
        expect(panelView.isOpen).toBe(true);
        expect(panelView.open).toHaveBeenCalledTimes(renderCountBeforeUndoClose + 1);
        expect(internals.openAgentInsightCandidate?.id).toBe(candidate.id);
        resolveUndo([{
            receiptId: "receipt-pagelet-1",
            operationId: "operation-pagelet-1",
            path: "notes/current.md",
            status: "undone",
        }]);
        await flushAsyncWork();

        expect(internals.agentInsightActionState.kind).toBe("undone");
        expect(actions().actionStatus?.label).toBe("The change was undone.");
    });

    it("shows a distinct stale Undo result and leaves the related-note link in place", async () => {
        const persistedAnchor = "---\npa-related:\n  - '[[notes/related]]'\n---\n# Current";
        const undoPageletOperationsReceipts = jest.fn<NonNullable<PageletHost["undoPageletOperationsReceipts"]>>(
            async (): Promise<UndoResult[]> => [{
                receiptId: "receipt-pagelet-1",
                operationId: "operation-pagelet-1",
                path: "notes/current.md",
                status: "stale",
                failureCategory: "stale_target",
            }],
        );
        const host = makeHost({
            validateDeepDiscoverInsight: async () => true,
            isOperationsAvailable: () => true,
            stagePageletInsightLink: async () => makePageletOperationsIntent(),
            confirmPageletOperationsIntent: async () => makePageletOperationsResult(),
            cancelPageletOperationsIntent: () => undefined,
            undoPageletOperationsReceipts,
        });
        const orchestrator = new PageletOrchestrator(host);
        const panelView = {
            open: jest.fn<(layout: string, findings: unknown[], extra?: unknown) => void>(),
            close: jest.fn(),
            isOpen: true,
        };
        const internals = orchestrator as unknown as {
            panelView: typeof panelView;
            acceptDeepDiscoverResult(
                result: PageletDeepDiscoverControllerResult,
                options: { path: string; proactive: boolean },
            ): PageletAgentDeliveryCandidate;
            openAgentInsightPanel(candidate: PageletAgentDeliveryCandidate): void;
        };
        internals.panelView = panelView;
        const candidate = internals.acceptDeepDiscoverResult(
            makeVerifiedDeepDiscoverResult(),
            { path: "notes/current.md", proactive: false },
        );
        internals.openAgentInsightPanel(candidate);
        const latest = () => panelView.open.mock.calls.at(-1)?.[1][0] as {
            actionStatus?: { label: string };
            actions: Array<{ label: string; callback(): void }>;
        };

        latest().actions[0]?.callback();
        await flushAsyncWork();
        latest().actions.find((action) => action.label === "Confirm")?.callback();
        await flushAsyncWork();
        latest().actions.find((action) => action.label === "Undo")?.callback();
        await flushAsyncWork();

        expect(undoPageletOperationsReceipts).toHaveBeenCalledWith(["receipt-pagelet-1"]);
        expect(latest().actionStatus?.label).toBe(
            "Undo stopped because the note changed. The related-note link was left in place.",
        );
        expect(persistedAnchor).toContain("[[notes/related]]");
    });

    it("localizes the Pagelet frontmatter preview without changing the shared English default", async () => {
        const globalScope = globalThis as unknown as { window?: unknown };
        const originalWindow = globalScope.window;
        globalScope.window = { i18next: { language: "zh-CN" } };
        try {
            const host = makeHost({
                validateDeepDiscoverInsight: async () => true,
                isOperationsAvailable: () => true,
                stagePageletInsightLink: async () => makePageletOperationsIntent(),
                confirmPageletOperationsIntent: async () => makePageletOperationsResult(),
                cancelPageletOperationsIntent: () => undefined,
                undoPageletOperationsReceipts: async () => [],
            });
            const orchestrator = new PageletOrchestrator(host);
            const panelView = {
                open: jest.fn<(layout: string, findings: unknown[], extra?: unknown) => void>(),
                close: jest.fn(),
                isOpen: true,
            };
            const internals = orchestrator as unknown as {
                panelView: typeof panelView;
                acceptDeepDiscoverResult(
                    result: PageletDeepDiscoverControllerResult,
                    options: { path: string; proactive: boolean },
                ): PageletAgentDeliveryCandidate;
                openAgentInsightPanel(candidate: PageletAgentDeliveryCandidate): void;
            };
            internals.panelView = panelView;
            const candidate = internals.acceptDeepDiscoverResult(
                makeVerifiedDeepDiscoverResult(),
                { path: "notes/current.md", proactive: false },
            );
            internals.openAgentInsightPanel(candidate);
            const latest = () => panelView.open.mock.calls.at(-1)?.[1][0] as {
                actionStatus?: { preview?: string };
                actions: Array<{ callback(): void }>;
            };

            latest().actions[0]?.callback();
            await flushAsyncWork();
            expect(latest().actionStatus?.preview).toBe(
                "设置 pa-related：[\"[[notes/related]]\"]",
            );
        } finally {
            if (originalWindow === undefined) {
                Reflect.deleteProperty(globalThis, "window");
            } else {
                globalScope.window = originalWindow;
            }
        }
    });

    it("opens a validated full Pagelet handoff without sending from the Panel", async () => {
        const openPageletChatHandoff = jest.fn<NonNullable<PageletHost["openPageletChatHandoff"]>>(
            async () => ({ status: "prepared" as const }),
        );
        const validateDeepDiscoverInsight = jest.fn<NonNullable<PageletHost["validateDeepDiscoverInsight"]>>(
            async () => true,
        );
        const host = makeHost({
            validateDeepDiscoverInsight,
            isOperationsAvailable: () => false,
            openPageletChatHandoff,
        });
        const orchestrator = new PageletOrchestrator(host);
        const panelView = {
            open: jest.fn<(layout: string, findings: unknown[], extra?: unknown) => void>(),
            close: jest.fn(),
            isOpen: true,
        };
        const internals = orchestrator as unknown as {
            panelView: typeof panelView;
            acceptDeepDiscoverResult(
                result: PageletDeepDiscoverControllerResult,
                options: { path: string; proactive: boolean },
            ): PageletAgentDeliveryCandidate;
            openAgentInsightPanel(candidate: PageletAgentDeliveryCandidate): void;
        };
        internals.panelView = panelView;
        const candidate = internals.acceptDeepDiscoverResult(
            makeVerifiedDeepDiscoverResult(),
            { path: "notes/current.md", proactive: false },
        );
        internals.openAgentInsightPanel(candidate);
        const finding = panelView.open.mock.calls.at(-1)?.[1][0] as {
            actions: Array<{ label: string; callback(): void }>;
        };

        finding.actions.find((action) => action.label === "Discuss in Chat")?.callback();
        await flushAsyncWork();

        expect(validateDeepDiscoverInsight).toHaveBeenCalledTimes(1);
        expect(openPageletChatHandoff).toHaveBeenCalledTimes(1);
        const [handoff, signal] = openPageletChatHandoff.mock.calls[0];
        expect(handoff).toEqual(expect.objectContaining({
            version: 1,
            id: "deep-notes/current.md",
            body: expect.stringContaining("Release assumptions conflict"),
            anchor: expect.objectContaining({ path: "notes/current.md" }),
            sources: expect.arrayContaining([
                expect.objectContaining({ path: "notes/current.md" }),
                expect.objectContaining({ path: "notes/related.md" }),
            ]),
        }));
        expect(signal?.aborted).toBe(false);
        expect(panelView.close).toHaveBeenCalledTimes(1);
    });

    it("aborts a late Pagelet Chat handoff when the Panel session closes", async () => {
        let releaseHandoff: ((result: PageletChatHandoffPreparationResult) => void) | undefined;
        let observedSignal: AbortSignal | undefined;
        const handoffGate = new Promise<PageletChatHandoffPreparationResult>((resolve) => {
            releaseHandoff = resolve;
        });
        const openPageletChatHandoff = jest.fn<NonNullable<PageletHost["openPageletChatHandoff"]>>(
            async (_context, signal) => {
                observedSignal = signal;
                return await handoffGate;
            },
        );
        const host = makeHost({
            validateDeepDiscoverInsight: async () => true,
            isOperationsAvailable: () => false,
            openPageletChatHandoff,
        });
        const orchestrator = new PageletOrchestrator(host);
        const panelView = {
            open: jest.fn<(layout: string, findings: unknown[], extra?: unknown) => void>(),
            close: jest.fn(),
            isOpen: true,
        };
        const internals = orchestrator as unknown as {
            panelView: typeof panelView;
            openAgentInsightCandidate: PageletAgentDeliveryCandidate | null;
            acceptDeepDiscoverResult(
                result: PageletDeepDiscoverControllerResult,
                options: { path: string; proactive: boolean },
            ): PageletAgentDeliveryCandidate;
            openAgentInsightPanel(candidate: PageletAgentDeliveryCandidate): void;
            clearPanelSession(): void;
        };
        internals.panelView = panelView;
        const candidate = internals.acceptDeepDiscoverResult(
            makeVerifiedDeepDiscoverResult(),
            { path: "notes/current.md", proactive: false },
        );
        internals.openAgentInsightPanel(candidate);
        const finding = panelView.open.mock.calls.at(-1)?.[1][0] as {
            actions: Array<{ label: string; callback(): void }>;
        };

        finding.actions.find((action) => action.label === "Discuss in Chat")?.callback();
        await flushAsyncWork();
        expect(openPageletChatHandoff).toHaveBeenCalledTimes(1);
        expect(observedSignal?.aborted).toBe(false);

        internals.clearPanelSession();
        expect(observedSignal?.aborted).toBe(true);
        expect(internals.openAgentInsightCandidate).toBeNull();
        releaseHandoff?.({ status: "prepared" });
        await flushAsyncWork();

        expect(panelView.close).not.toHaveBeenCalled();
    });

    it("explains the daily limit only for an explicit trigger", async () => {
        jest.mocked(Notice).mockClear();
        const host = makeHost({
            runDeepDiscover: async () => ({ status: "limit", reason: "limit" }),
        });
        const orchestrator = new PageletOrchestrator(host);

        await Promise.resolve(orchestrator.getCommandCallbacks().onReviewCurrent());

        expect(Notice).toHaveBeenCalledWith(
            "Deep Discover has reached today's 36-run limit. It will resume tomorrow.",
            5000,
        );
    });

    it("explains a provider-confirmed Function Calling rejection on explicit Review", async () => {
        jest.mocked(Notice).mockClear();
        const orchestrator = new PageletOrchestrator(makeHost({
            runDeepDiscover: async () => ({ status: "error", reason: "function-calling-unsupported" }),
        }));

        await Promise.resolve(orchestrator.getCommandCallbacks().onReviewCurrent());

        expect(Notice).toHaveBeenCalledWith(
            "The current model does not support Function Calling, so Deep Discover could not finish. Choose a model that supports it.",
            5000,
        );
    });

    it("warns about missing tool use only after an incomplete explicit run", async () => {
        jest.mocked(Notice).mockClear();
        const orchestrator = new PageletOrchestrator(makeHost({
            runDeepDiscover: async () => ({
                status: "quiet", reason: "runtime-incomplete",
                metrics: { modelTurns: 2, toolCalls: 0, wallTimeMs: 100 },
            }),
        }));

        await Promise.resolve(orchestrator.getCommandCallbacks().onReviewCurrent());

        expect(Notice).toHaveBeenCalledWith(
            "The model did not use any tools in this attempt, so Deep Discover could not finish. A model that follows tool calls may work better.",
            5000,
        );
    });

    it("uses catalog evidence only after an incomplete run with no tool calls", async () => {
        jest.mocked(Notice).mockClear();
        const getDeepDiscoverFunctionCallingCapability = jest.fn(async () => "unsupported" as const);
        const orchestrator = new PageletOrchestrator(makeHost({
            runDeepDiscover: async () => ({
                status: "quiet", reason: "runtime-incomplete",
                metrics: { modelTurns: 2, toolCalls: 0, wallTimeMs: 100 },
            }),
            getDeepDiscoverFunctionCallingCapability,
        }));

        await Promise.resolve(orchestrator.getCommandCallbacks().onReviewCurrent());

        expect(getDeepDiscoverFunctionCallingCapability).toHaveBeenCalledTimes(1);
        expect(Notice).toHaveBeenCalledWith(
            "The current model does not support Function Calling, so Deep Discover could not finish. Choose a model that supports it.",
            5000,
        );
    });
});

describe("PageletOrchestrator review save concurrency", () => {
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

describe("PageletOrchestrator attention-aware delivery integration", () => {




    it("reconciles a pending nudge after every Action Ring close, but never during teardown", () => {
        const orchestrator = new PageletOrchestrator(makeHost());
        const internals = orchestrator as unknown as {
            bubbleCoordinator: {
                reconcileNudge(bubbleView: unknown, petView: unknown): void;
            };
            handleActionRingClosed(): void;
            reconcilePetNudge(): void;
        };
        const reconcile = jest.spyOn(internals.bubbleCoordinator, "reconcileNudge");

        // PetView uses this same callback for both "passive" and "action"
        // reasons, so Capture cannot strand a nudge that arrived while open.
        internals.handleActionRingClosed();
        expect(reconcile).toHaveBeenCalledTimes(1);

        orchestrator.destroy();
        reconcile.mockClear();
        internals.reconcilePetNudge();
        expect(reconcile).not.toHaveBeenCalled();
    });

    it("lets Escape dismiss an open Action Ring before an already open Panel", () => {
        const orchestrator = new PageletOrchestrator(makeHost());
        const dismissActionRingFromEscape = jest.fn();
        const panelView = {
            isOpen: true,
            close: jest.fn(),
        };
        const petView = {
            actionRingOpen: true,
            dismissActionRingFromEscape,
        };
        const internals = orchestrator as unknown as {
            petView: typeof petView;
            panelView: typeof panelView;
            handleEscape(event: KeyboardEvent): void;
        };
        internals.petView = petView;
        internals.panelView = panelView;
        const eventTarget = new EventTarget();
        const competingDocumentCaptureListener = jest.fn(() => panelView.close());
        eventTarget.addEventListener("keydown", internals.handleEscape as EventListener);
        eventTarget.addEventListener("keydown", competingDocumentCaptureListener);
        const firstEscape = new Event("keydown", {
            cancelable: true,
        }) as KeyboardEvent;
        Object.defineProperty(firstEscape, "key", { value: "Escape" });

        eventTarget.dispatchEvent(firstEscape);

        expect(dismissActionRingFromEscape).toHaveBeenCalledTimes(1);
        expect(firstEscape.defaultPrevented).toBe(true);
        expect(competingDocumentCaptureListener).not.toHaveBeenCalled();
        expect(panelView.close).not.toHaveBeenCalled();

        petView.actionRingOpen = false;
        const secondEscape = new Event("keydown", {
            cancelable: true,
        }) as KeyboardEvent;
        Object.defineProperty(secondEscape, "key", { value: "Escape" });

        eventTarget.dispatchEvent(secondEscape);

        expect(panelView.close).toHaveBeenCalledTimes(1);
        expect(secondEscape.defaultPrevented).toBe(true);
        expect(competingDocumentCaptureListener).not.toHaveBeenCalled();
    });
});

describe("Pagelet Share Card action", () => {
    type ShareEditor = {
        getSelection: jest.Mock<() => string>;
        getValue: jest.Mock<() => string>;
        focus: jest.Mock<() => void>;
    };

    function makeShareView(input: {
        selection?: string;
        note?: string;
        path?: string;
    } = {}): { editor: ShareEditor; file: TFile | null } {
        return {
            editor: {
                getSelection: jest.fn(() => input.selection ?? ""),
                getValue: jest.fn(() => input.note ?? ""),
                focus: jest.fn(),
            },
            file: makeTFile(input.path ?? "notes/current.md"),
        };
    }

    function shareInternals(host: PageletHost, view: unknown) {
        const workspace = host.app.workspace as unknown as {
            getActiveViewOfType: jest.Mock<() => unknown>;
        };
        workspace.getActiveViewOfType = jest.fn(() => view);
        return new PageletOrchestrator(host) as unknown as {
            petView: { rootEl: { focus(): void } | null } | null;
            shareActiveNoteOrSelectionAsCard(): void;
        };
    }

    it("preserves a non-empty raw editor selection and hides note identity", () => {
        jest.clearAllMocks();
        const rawSelection = "\n  selected **text**  \n";
        const host = makeHost();
        const view = makeShareView({
            selection: rawSelection,
            note: "unsaved whole note",
            path: "drafts/Private title.md",
        });
        const internals = shareInternals(host, view);

        internals.shareActiveNoteOrSelectionAsCard();

        const modalCalls = (ShareCardModal as unknown as jest.Mock).mock.calls;
        expect(modalCalls).toHaveLength(1);
        expect(modalCalls[0]?.[1]).toEqual({
            content: rawSelection,
            source: "selection",
            resourceContext: { basePath: "drafts/Private title.md" },
        });
        expect(modalCalls[0]?.[1]).not.toHaveProperty("sourceLabel");
    });

    it("shares the unsaved note body after valid YAML and shows only its basename", () => {
        jest.clearAllMocks();
        const host = makeHost();
        const view = makeShareView({
            note: "---\ntags: [private]\n---\n\n# Unsaved draft\nBody\n",
            path: "drafts/Today.md",
        });
        const internals = shareInternals(host, view);

        internals.shareActiveNoteOrSelectionAsCard();

        const data = (ShareCardModal as unknown as jest.Mock).mock.calls[0]?.[1];
        expect(data).toEqual({
            content: "\n# Unsaved draft\nBody\n",
            source: "note",
            sourceLabel: "Today",
            resourceContext: { basePath: "drafts/Today.md" },
        });
    });

    it("keeps malformed frontmatter-like text because Obsidian does not recognize it as YAML", () => {
        jest.clearAllMocks();
        const host = makeHost();
        const malformed = "---\ntags: [unfinished\n# Draft\n";
        const internals = shareInternals(host, makeShareView({ note: malformed }));

        internals.shareActiveNoteOrSelectionAsCard();

        expect((ShareCardModal as unknown as jest.Mock).mock.calls[0]?.[1]).toEqual(
            expect.objectContaining({ content: malformed, source: "note" }),
        );
    });

    it("keeps a closed frontmatter block when its YAML is invalid", () => {
        jest.clearAllMocks();
        const host = makeHost();
        const malformed = "---\ntags: [unfinished\n---\n# Draft\n";
        const internals = shareInternals(host, makeShareView({ note: malformed }));

        internals.shareActiveNoteOrSelectionAsCard();

        expect((ShareCardModal as unknown as jest.Mock).mock.calls[0]?.[1]).toEqual(
            expect.objectContaining({ content: malformed, source: "note" }),
        );
    });

    it("reports an empty or YAML-only note and restores editor focus", () => {
        jest.clearAllMocks();
        const host = makeHost();
        const view = makeShareView({ note: "---\ntags: [private]\n---\n \n\t" });
        const internals = shareInternals(host, view);

        internals.shareActiveNoteOrSelectionAsCard();

        expect(ShareCardModal).not.toHaveBeenCalled();
        expect(Notice).toHaveBeenCalledWith(
            "Add note text or select text before sharing it as a card.",
            4000,
        );
        expect(view.editor.focus).toHaveBeenCalledTimes(1);
    });

    it("reports a missing Markdown view and returns focus to the Pet", () => {
        jest.clearAllMocks();
        const host = makeHost();
        const internals = shareInternals(host, null);
        const focus = jest.fn();
        internals.petView = { rootEl: { focus } };

        internals.shareActiveNoteOrSelectionAsCard();

        expect(ShareCardModal).not.toHaveBeenCalled();
        expect(Notice).toHaveBeenCalledWith(
            "Open a Markdown note before sharing it as a card.",
            4000,
        );
        expect(focus).toHaveBeenCalledTimes(1);
    });

    it("treats a Markdown view without an active file as no Markdown note", () => {
        jest.clearAllMocks();
        const host = makeHost();
        const view = makeShareView({ note: "stale editor text" });
        view.file = null;
        const internals = shareInternals(host, view);
        const focus = jest.fn();
        internals.petView = { rootEl: { focus } };

        internals.shareActiveNoteOrSelectionAsCard();

        expect(ShareCardModal).not.toHaveBeenCalled();
        expect(Notice).toHaveBeenCalledWith(
            "Open a Markdown note before sharing it as a card.",
            4000,
        );
        expect(focus).toHaveBeenCalledTimes(1);
        expect(view.editor.focus).not.toHaveBeenCalled();
    });
});

describe("PageletOrchestrator quick review command", () => {


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

        showOrchestratorBubble(
            orchestrator,
            bubbleView,
            (orchestrator as unknown as { petView: unknown }).petView,
        );
        await flushAsyncWork();

        const [content] = bubbleView.show.mock.calls[bubbleView.show.mock.calls.length - 1] as unknown as [{
            type: string;
            actions: Array<{ label: string; callback: () => void }>;
        }, HTMLElement];
        expect(content.type).toBe("ready-empty");
        expect(content.actions.map((action) => action.label)).toEqual(["Find related old notes"]);
        expect(foregroundAnalyze).not.toHaveBeenCalled();
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
    it("reconciles pending tickets immediately when generic proactive hints are disabled", () => {
        const host = makeHost();
        host.settings.pagelet.proactiveHints = true;
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            bubbleCoordinator: { reconcileNudge: (...args: unknown[]) => void };
            petView: { stateMachine: { proactiveHintsEnabled: boolean } } | null;
        };
        const reconcileNudge = jest.spyOn(internals.bubbleCoordinator, "reconcileNudge");
        internals.petView = { stateMachine: { proactiveHintsEnabled: true } };

        orchestrator.getCommandCallbacks().onToggleProactiveHints();

        expect(internals.petView.stateMachine.proactiveHintsEnabled).toBe(false);
        expect(host.updatePageletSetting).toHaveBeenCalledWith("proactiveHints", false);
        expect(reconcileNudge).toHaveBeenCalledTimes(1);
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























































    it.each([
        ["maintenance_scan", "maintenanceScanSuggested"],
        ["quick_capture", "quickCaptureExplained"],
    ] as const)("commits %s onboarding only after a visible regular Bubble presentation", (kind, settingKey) => {
        const host = makeHost();
        host.settings.pagelet.proactiveHints = true;
        const updatePageletSetting = persistPageletSettingUpdates(host);
        const orchestrator = new PageletOrchestrator(host);
        const stateMachine = {
            state: "idle",
            proactiveHintsEnabled: true,
            forceState: jest.fn((state: string) => { stateMachine.state = state; }),
            transition: jest.fn(),
        };
        const bubbleView = {
            bubbleState: "hidden",
            show: jest.fn(() => { bubbleView.bubbleState = "visible"; }),
            close: jest.fn(() => { bubbleView.bubbleState = "hidden"; }),
        };
        const internals = orchestrator as unknown as {
            petView: { rootEl: HTMLElement; stateMachine: typeof stateMachine };
            bubbleView: typeof bubbleView;
            onboardingNudge: OnboardingNudge | null;
        };
        internals.petView = { rootEl: {} as HTMLElement, stateMachine };
        internals.bubbleView = bubbleView;

        expect(orchestrator.setOnboardingNudge(kind)).toBe(true);
        expect(updatePageletSetting).not.toHaveBeenCalledWith(settingKey, true);

        showOrchestratorBubble(orchestrator, bubbleView, internals.petView);

        const [firstContent] = bubbleView.show.mock.calls[0] as unknown as [{ type: string }];
        expect(firstContent.type).toBe("nudge");
        expect(updatePageletSetting).toHaveBeenCalledWith(settingKey, true);
        expect(internals.onboardingNudge).toBeNull();

        bubbleView.bubbleState = "hidden";
        showOrchestratorBubble(orchestrator, bubbleView, internals.petView);
        const [secondContent] = bubbleView.show.mock.calls[1] as unknown as [{ type: string }];
        expect(secondContent.type).not.toBe("nudge");
        expect(updatePageletSetting.mock.calls.filter(([key]) => key === settingKey)).toHaveLength(1);
    });

    it("does not re-admit rejected Pattern or Onboarding payloads after cooldown or re-enable", () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-07-05T12:00:00.000Z"));
        const host = makeHost();
        host.settings.pagelet.proactiveHints = true;
        host.settings.pagelet.proactiveHintsCooldown = 60;
        persistPageletSettingUpdates(host);
        const orchestrator = new PageletOrchestrator(host);
        const stateMachine = {
            state: "idle",
            proactiveHintsEnabled: true,
            forceState: jest.fn(),
        };
        const destroyPet = jest.fn();
        const pattern: PatternDetectionResult = {
            generatedAt: "2026-07-05T12:01:00.000Z",
            totalCount: 1,
            patterns: [],
        };
        const internals = orchestrator as unknown as {
            petView: { rootEl: HTMLElement; stateMachine: typeof stateMachine; destroy: typeof destroyPet };
            proactiveHints: {
                onInsightsReady(): boolean;
                recordHintPresented(): void;
            };
            currentAdmittedNudgeTickets(): NudgeTicket[];
            patternDetectionNudge: PatternDetectionResult | null;
            onboardingNudge: OnboardingNudge | null;
        };
        internals.petView = { rootEl: {} as HTMLElement, stateMachine, destroy: destroyPet };
        try {
            expect(internals.proactiveHints.onInsightsReady()).toBe(true);
            internals.proactiveHints.recordHintPresented();

            orchestrator.setPatternDetectionNudge(pattern);
            expect(orchestrator.setOnboardingNudge("quick_capture")).toBe(false);
            expect(internals.patternDetectionNudge).toEqual(pattern);
            expect(internals.onboardingNudge?.kind).toBe("quick_capture");
            expect(internals.currentAdmittedNudgeTickets()).toEqual([]);

            jest.advanceTimersByTime(60 * 60 * 1000);
            orchestrator.getCommandCallbacks().onToggleProactiveHints();
            orchestrator.getCommandCallbacks().onToggleProactiveHints();
            orchestrator.setPatternDetectionNudge(pattern);
            expect(orchestrator.setOnboardingNudge("quick_capture")).toBe(false);

            expect(internals.currentAdmittedNudgeTickets()).toEqual([]);
            expect(stateMachine.forceState).not.toHaveBeenCalledWith("nudge");
        } finally {
            orchestrator.destroy();
            jest.useRealTimers();
        }
    });

    it("clears only generic admissions when proactive hints are disabled", () => {
        const host = makeHost();
        host.settings.pagelet.proactiveHints = true;
        persistPageletSettingUpdates(host);
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            preparedRecapNudgeFingerprint: string | null;
            patternDetectionNudgeAdmissionKey: string | null;
            onboardingNudgeAdmissionKey: string | null;
        };
        internals.preparedRecapNudgeFingerprint = "recap-admission";
        internals.patternDetectionNudgeAdmissionKey = "pattern:admitted";
        internals.onboardingNudgeAdmissionKey = "onboarding:admitted";

        orchestrator.getCommandCallbacks().onToggleProactiveHints();

        expect(internals.patternDetectionNudgeAdmissionKey).toBeNull();
        expect(internals.onboardingNudgeAdmissionKey).toBeNull();
        expect(internals.preparedRecapNudgeFingerprint).toBe("recap-admission");
        orchestrator.destroy();
    });



























    afterEach(() => { jest.useRealTimers(); });



















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
        const runDeepDiscover = jest.fn<NonNullable<PageletHost["runDeepDiscover"]>>(async () => ({
            status: "quiet",
            reason: "no-insight",
        } as const));
        const openPageletDetailView = jest.fn<(_payload: PageletDetailPayload) => void>();
        const host = makeHost({ runQuietRecall, runDeepDiscover, openPageletDetailView });
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
        expect(runDeepDiscover).toHaveBeenCalledTimes(1);
        expect(runDeepDiscover).toHaveBeenCalledWith({
            path: "notes/current.md",
            triggerReason: "explicit",
            force: true,
        });
        expect(runQuietRecall).not.toHaveBeenCalled();
        expect(openPageletDetailView).not.toHaveBeenCalled();
    });




});

describe("PageletOrchestrator background status command", () => {
    it("reports unified Deep Discover usage through the stable status command", async () => {
        jest.mocked(Notice).mockClear();
        const getDeepDiscoverUsage = jest.fn(async () => ({
            runs: 4,
            dailyCap: 36,
            modelTurns: 12,
            toolCalls: 31,
        }));
        const host = makeHost({ getDeepDiscoverUsage });
        const orchestrator = new PageletOrchestrator(host);

        orchestrator.getCommandCallbacks().onShowBackgroundPreparationStatus();
        await flushAsyncWork();

        expect(getDeepDiscoverUsage).toHaveBeenCalledTimes(1);
        const message = jest.mocked(Notice).mock.calls.at(-1)?.[0] as string;
        expect(message).toBe("Discoveries today: 4 of 36.");
    });
});

describe("PageletOrchestrator review panel context flow", () => {

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

    it("reports an excluded active Markdown note as a privacy boundary without using it", () => {
        const activeFile = makeTFile("private/secret.md");
        const baseHost = makeHost();
        const workspace = {
            getActiveFile: jest.fn(() => activeFile),
        } as unknown as PageletHost["app"]["workspace"];
        const host = makeHost({
            app: {
                ...baseHost.app,
                workspace,
            } as unknown as PageletHost["app"],
            isPathAllowedForPagelet: jest.fn(() => false),
        });
        const orchestrator = new PageletOrchestrator(host);
        const panelView = { open: jest.fn() };
        (orchestrator as unknown as { panelView: typeof panelView }).panelView = panelView;

        orchestrator.openPanel();

        expect(panelView.open).toHaveBeenCalledWith(
            "review",
            [],
            expect.objectContaining({
                contextPager: expect.objectContaining({
                    summary: expect.objectContaining({
                        usedSourceCount: 0,
                        skippedSourceCount: 1,
                    }),
                    usedSources: [],
                    skippedSources: [expect.objectContaining({
                        path: "private/secret.md",
                        reason: "privacy excluded",
                    })],
                }),
            }),
        );
    });

    it("does not create a Context Pager outcome for an active non-Markdown file", () => {
        const activeFile = makeTFile("assets/diagram.png");
        const baseHost = makeHost();
        const workspace = {
            getActiveFile: jest.fn(() => activeFile),
        } as unknown as PageletHost["app"]["workspace"];
        const host = makeHost({
            app: {
                ...baseHost.app,
                workspace,
            } as unknown as PageletHost["app"],
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




});

describe("PageletOrchestrator connection discovery", () => {





























});

describe("PageletOrchestrator Share Card gate", () => {
    it("rejects a stale request when the panel has no currently shareable findings", () => {
        jest.mocked(ShareCardModal).mockClear();
        const orchestrator = new PageletOrchestrator(makeHost());
        const findings = [{
            title: "Earlier result",
            description: "No longer visible while the review is pending or failed.",
        }];
        const panelView = {
            currentPanelExtra: { sourcePath: "notes/current.md" },
            currentShareCardFindings: [] as typeof findings,
        };
        const internals = orchestrator as unknown as {
            panelView: typeof panelView;
            sharePanelAsCard(request: { findings: typeof findings }): void;
        };
        internals.panelView = panelView;

        internals.sharePanelAsCard({ findings });

        expect(ShareCardModal).not.toHaveBeenCalled();

        panelView.currentShareCardFindings = findings;
        internals.sharePanelAsCard({ findings });

        expect(ShareCardModal).toHaveBeenCalledTimes(1);
        expect(ShareCardModal).toHaveBeenLastCalledWith(
            expect.anything(),
            {
                content: "## Earlier result\n\nNo longer visible while the review is pending or failed.",
                source: "pagelet",
                sourceLabel: "PA Pagelet",
                resourceContext: { basePath: "notes/current.md" },
            },
        );
    });
});

describe("PageletOrchestrator LC-01 feature event lifecycle", () => {
    interface RecordedEventRef {
        id: string;
        source: "workspace" | "vault";
        event: string;
        callback: (...args: unknown[]) => void;
        detached: boolean;
    }

    const originalDocument = (globalThis as { document?: unknown }).document;
    const originalHTMLElement = (globalThis as { HTMLElement?: unknown }).HTMLElement;
    beforeAll(() => {
        Object.defineProperty(globalThis, "HTMLElement", {
            configurable: true,
            value: class MockHTMLElement {},
        });
        Object.defineProperty(globalThis, "document", {
            configurable: true,
            value: {
                body: {},
                documentElement: {},
                querySelector: jest.fn(() => null),
                addEventListener: jest.fn(),
                removeEventListener: jest.fn(),
            },
        });
    });

    afterAll(() => {
        Object.defineProperty(globalThis, "document", {
            configurable: true,
            value: originalDocument,
        });
        Object.defineProperty(globalThis, "HTMLElement", {
            configurable: true,
            value: originalHTMLElement,
        });
    });

    function createLifecycleHarness() {
        const refs: RecordedEventRef[] = [];
        const featureScope = {};
        let featureScopeReleased = false;
        const registerEvent = jest.fn((ref: RecordedEventRef) => ref);
        const host = makeHost({
            registerEvent: registerEvent as never,
            runDeepDiscover: jest.fn(async () => undefined as never),
            consumePageletOperationsSelfWrite: jest.fn(() => false),
        });
        host.settings.pagelet.petVisible = false;
        host.settings.pagelet.backgroundDiscoveryEnabled = true;
        const mutableHost = host as unknown as {
            pageletFeatureScope: object;
            isFeatureScopeCurrent(scope: object): boolean;
        };
        mutableHost.pageletFeatureScope = featureScope;
        mutableHost.isFeatureScopeCurrent = (scope) => scope === featureScope && !featureScopeReleased;
        const record = (
            source: "workspace" | "vault",
            event: string,
            callback: (...args: unknown[]) => void,
        ) => {
            const ref: RecordedEventRef = {
                id: `${source}:${event}:${refs.length}`,
                source,
                event,
                callback,
                detached: false,
            };
            refs.push(ref);
            return ref;
        };
        const activeFile = makeTFile("notes/current.md");
        const leafFor = (path: string) => ({
            view: {
                getViewType: () => "markdown",
                file: { path },
            },
        });
        const workspace = {
            activeLeaf: null,
            containerEl: {},
            getActiveFile: jest.fn(() => activeFile),
            getMostRecentLeaf: jest.fn(() => null),
            on: jest.fn((event: string, callback: (...args: unknown[]) => void) => (
                record("workspace", event, callback)
            )),
        };
        const vault = {
            getMarkdownFiles: jest.fn(() => [activeFile]),
            cachedRead: jest.fn(async () => "Current note"),
            getAbstractFileByPath: jest.fn(() => activeFile),
            on: jest.fn((event: string, callback: (...args: unknown[]) => void) => (
                record("vault", event, callback)
            )),
        };
        (host as unknown as { app: PageletHost["app"] }).app = {
            workspace,
            vault,
            metadataCache: { getFileCache: jest.fn(() => null) },
        } as unknown as PageletHost["app"];

        return {
            host,
            refs,
            registerEvent,
            releaseFeatureScope: () => {
                featureScopeReleased = true;
                for (const ref of refs) ref.detached = true;
            },
            workspace,
            vault,
            leafFor,
            createOrchestrator: () => new PageletOrchestrator(host),
        };
    }

    it("detaches all five feature event refs when the feature is disabled", () => {
        const harness = createLifecycleHarness();
        const orchestrator = harness.createOrchestrator();
        orchestrator.initialize();
        expect(harness.registerEvent).toHaveBeenCalledTimes(5);

        orchestrator.destroy();
        harness.releaseFeatureScope();

        expect(harness.refs).toHaveLength(5);
        expect(harness.refs.map((ref) => ref.detached)).toEqual([true, true, true, true, true]);
        harness.releaseFeatureScope();
        expect(harness.refs.map((ref) => ref.detached)).toEqual([true, true, true, true, true]);
    });

    it("lets only the current generation receive an event after off/on", () => {
        const first = createLifecycleHarness();
        const second = createLifecycleHarness();
        const firstOrchestrator = first.createOrchestrator();
        firstOrchestrator.initialize();
        firstOrchestrator.destroy();
        first.releaseFeatureScope();
        const secondOrchestrator = second.createOrchestrator();
        secondOrchestrator.initialize();

        const firstLeaf = first.refs.find(({ event }) => event === "active-leaf-change");
        const secondLeaf = second.refs.find(({ event }) => event === "active-leaf-change");
        expect(firstLeaf).toBeDefined();
        expect(secondLeaf).toBeDefined();

        firstLeaf?.callback(first.leafFor("notes/old-generation.md"));
        secondLeaf?.callback(second.leafFor("notes/new-generation.md"));

        expect((firstOrchestrator as unknown as { currentMarkdownAnchorPath: string | null })
            .currentMarkdownAnchorPath).toBeNull();
        expect((secondOrchestrator as unknown as { currentMarkdownAnchorPath: string | null })
            .currentMarkdownAnchorPath).toBe("notes/new-generation.md");
        secondOrchestrator.destroy();
    });

    it("rejects a queued modify callback on a destroyed old instance", async () => {
        jest.useFakeTimers();
        try {
            const harness = createLifecycleHarness();
            const orchestrator = harness.createOrchestrator();
        orchestrator.initialize();
        orchestrator.destroy();
        harness.releaseFeatureScope();

            const modify = harness.refs.find(({ event }) => event === "modify");
            modify?.callback(makeTFile("notes/queued.md"));

            expect(harness.host.consumePageletOperationsSelfWrite).not.toHaveBeenCalled();
            await jest.advanceTimersByTimeAsync(10_000);
            expect(harness.host.runDeepDiscover).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });

    it("keeps normal current-instance modify and insight invalidation events active", async () => {
        jest.useFakeTimers();
        try {
            const harness = createLifecycleHarness();
            const orchestrator = harness.createOrchestrator();
            orchestrator.initialize();
            const panelView = { close: jest.fn(), destroy: jest.fn(), isOpen: true };
            const openCandidate = {
                pageletAgent: {
                    validationIdentity: {
                        cacheIdentity: { anchor: { path: "notes/open.md" }, sources: [] },
                },
            },
            };
            const state = orchestrator as unknown as {
                panelView: { close: jest.Mock; isOpen: boolean };
                openAgentInsightCandidate: unknown;
            };
            state.panelView = panelView;
            state.openAgentInsightCandidate = openCandidate;

            const modify = harness.refs.find(({ event }) => event === "modify");
            modify?.callback(makeTFile("notes/current.md"));
            await jest.advanceTimersByTimeAsync(5_000);
            expect(harness.host.runDeepDiscover).toHaveBeenCalledWith({
                path: "notes/current.md",
                triggerReason: "edit-idle",
            });

            const deleted = harness.refs.find(({ event }) => event === "delete");
            deleted?.callback(makeTFile("notes/open.md"));
            expect(panelView.close).toHaveBeenCalledTimes(1);
            orchestrator.destroy();
        } finally {
            jest.useRealTimers();
        }
    });

    it("rejects queued callbacks for every event entry on an old generation", async () => {
        jest.useFakeTimers();
        try {
            const harness = createLifecycleHarness();
            const orchestrator = harness.createOrchestrator();
            orchestrator.initialize();
            const panelView = { close: jest.fn(), destroy: jest.fn(), isOpen: true };
            const openCandidate = {
                pageletAgent: {
                    validationIdentity: {
                        cacheIdentity: { anchor: { path: "notes/open.md" }, sources: [] },
                    },
                },
            };
            const state = orchestrator as unknown as {
                panelView: { close: jest.Mock; isOpen: boolean };
                openAgentInsightCandidate: unknown;
                currentMarkdownAnchorPath: string | null;
            };
            state.panelView = panelView;
            state.openAgentInsightCandidate = openCandidate;
            harness.releaseFeatureScope();

            const eventFor = (name: string) => harness.refs.find(({ event }) => event === name);
            const callbacks = [
                eventFor("active-leaf-change"),
                eventFor("file-open"),
                eventFor("modify"),
                eventFor("delete"),
                eventFor("rename"),
            ];
            expect(callbacks.every(Boolean)).toBe(true);
            callbacks[0]?.callback(harness.leafFor("notes/old-leaf.md"));
            callbacks[1]?.callback();
            callbacks[2]?.callback(makeTFile("notes/old-modify.md"));
            callbacks[3]?.callback(makeTFile("notes/open.md"));
            callbacks[4]?.callback(makeTFile("notes/open-renamed.md"), "notes/open.md");
            await jest.advanceTimersByTimeAsync(10_000);

            expect(state.currentMarkdownAnchorPath).toBeNull();
            expect(harness.host.consumePageletOperationsSelfWrite).not.toHaveBeenCalled();
            expect(harness.host.runDeepDiscover).not.toHaveBeenCalled();
            expect(panelView.close).not.toHaveBeenCalled();
            orchestrator.destroy();
        } finally {
            jest.useRealTimers();
        }
    });
});
