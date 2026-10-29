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
import type { PageletChatHandoffPreparationResult } from "../src/ai-services/pagelet-handoff";
import type { OnboardingNudge } from "../src/pagelet/bubble/BubbleContent";
import type { DeliveryReceipt } from "../src/pagelet/attention";
import {
    PAGELET_DEEP_DISCOVER_PIPELINE_VERSION,
    type PageletDeepDiscoverControllerResult,
    type PageletDeepDiscoverTriggerReason,
} from "../src/pagelet/agent/types";
import type { PageletAgentDeliveryCandidate } from "../src/pagelet/agent/delivery-adapter";
import type { PanelFinding, PanelLayoutType, PanelOpenExtra } from "../src/pagelet/panel/types";
import type { PageletDetailPayload } from "../src/pagelet/tab/types";
import type {
    ConfirmedMemoryRecord,
    PatternDetectionResult,
    MaintenanceReviewRunResult,
    ReviewQueueItem,
    SavedInsight,
} from "../src/pa";

type PanelOpen = (layout: PanelLayoutType, findings: PanelFinding[], extra?: PanelOpenExtra) => void;

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
            ): void;
        };
    }).bubbleCoordinator.showBubble(bubbleView, petView);
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
                pageletProviderFirstUseNotified: false,
            },
            contextPager: {
                enabled: true,
            },
            focusMode: false,
            confirmedMemoryCount: 0,
        },
        log: jest.fn(),
        registerEvent: jest.fn(),
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
        getDeepDiscoverPolicyIdentity: () => "policy:v1",
        validateDeepDiscoverInsight: async () => true,
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
): Extract<PageletDeepDiscoverControllerResult, { status: "verified" }> {
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
            pipelineVersion: PAGELET_DEEP_DISCOVER_PIPELINE_VERSION,
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
    it("keeps a pending reader selection through an unrelated source recheck", async () => {
        const result = makeVerifiedDeepDiscoverResult();
        const second = { ...result.insight, insightId: "second-reading", body: "The complete second reading." };
        result.collection.insights = [result.insight, second];
        let selecting = false;
        let finishSelection!: (valid: boolean) => void;
        const validateDeepDiscoverInsight = jest.fn<NonNullable<PageletHost["validateDeepDiscoverInsight"]>>(identity =>
            selecting && identity.insightId === second.insightId
                ? new Promise(resolve => { finishSelection = resolve; }) : Promise.resolve(true));
        const host = makeHost({
            readDeepDiscover: async () => ({ ...result, status: "cache-hit" }),
            validateDeepDiscoverInsight,
        });
        const orchestrator = new PageletOrchestrator(host);
        const panelView = { open: jest.fn<PanelOpen>(), close: jest.fn(), isOpen: true };
        const internals = orchestrator as unknown as {
            panelView: typeof panelView;
            panelReading: { selectedId: string };
            invalidateAgentInsightForPaths(paths: readonly string[]): void;
        };
        internals.panelView = panelView;
        await orchestrator.openPanel();
        selecting = true;
        const next = panelView.open.mock.calls.at(-1)?.[1][0].actions?.find(action => action.label === "Next result");
        expect(next).toBeDefined();
        next!.callback();
        expect(finishSelection).toBeDefined();
        internals.invalidateAgentInsightForPaths(["notes/unrelated.md"]);
        await flushAsyncWork();
        finishSelection(true);
        await flushAsyncWork();
        expect(internals.panelReading.selectedId).toBe(second.insightId);
        expect(panelView.open.mock.calls.at(-1)?.[1][0].insightText).toBe(second.body);
        expect(panelView.close).not.toHaveBeenCalled();
    });

    it("B-176 ignores a late pure read for A after reading B without running or cancelling analysis", async () => {
        let activePath = 'notes/a.md';
        let finishA!: (result: Awaited<ReturnType<NonNullable<PageletHost['readDeepDiscover']>>>) => void;
        const runDeepDiscover = jest.fn<NonNullable<PageletHost['runDeepDiscover']>>();
        const cancelDeepDiscover = jest.fn();
        const ready = (path: string) => ({ ...makeVerifiedDeepDiscoverResult('explicit', path), status: 'cache-hit' as const });
        const readDeepDiscover = jest.fn<NonNullable<PageletHost['readDeepDiscover']>>(input => input.path === 'notes/a.md'
            ? new Promise(resolve => { finishA = resolve; }) : Promise.resolve(ready(input.path)));
        const host = makeHost({ runDeepDiscover, cancelDeepDiscover, readDeepDiscover });
        jest.mocked(host.app.workspace.getActiveFile).mockImplementation(() => makeTFile(activePath));
        const orchestrator = new PageletOrchestrator(host);
        const panelView = { open: jest.fn<PanelOpen>(), close: jest.fn(), isOpen: true };
        (orchestrator as unknown as { panelView: typeof panelView }).panelView = panelView;
        const pendingA = orchestrator.openPanel();
        await flushAsyncWork();
        activePath = 'notes/b.md';
        await orchestrator.openPanel();
        const bodyB = panelView.open.mock.calls.at(-1)?.[1][0].insightText;
        expect(bodyB).toContain('notes/b.md');
        finishA(ready('notes/a.md'));
        await pendingA;
        expect(panelView.open.mock.calls.at(-1)?.[1][0].insightText).toBe(bodyB);
        expect(runDeepDiscover).not.toHaveBeenCalled();
        expect(cancelDeepDiscover).not.toHaveBeenCalled();
    });

    it("B-176 retains A's selected reading when only B's last reminder source becomes invalid", async () => {
        const pathA = 'notes/a.md';
        const oldA = makeVerifiedDeepDiscoverResult('explicit', pathA);
        const newA = makeVerifiedDeepDiscoverResult('edit-idle', pathA);
        if (oldA.status !== 'verified' || newA.status !== 'verified') throw new Error('fixture');
        oldA.insights = [oldA.insight, {
            ...oldA.insight, insightId: 'a-reading-second', body: '## Original A second text\nKeep this complete text.',
        }];
        oldA.collection.insights = oldA.insights;
        newA.insight = { ...newA.insight, insightId: 'a-newer-collection', body: '## Newer A\nDo not replace the recent reading.' };
        newA.insights = [newA.insight];
        newA.collection.insights = newA.insights;
        let cachedA = oldA;
        const readDeepDiscover = jest.fn<NonNullable<PageletHost['readDeepDiscover']>>(async () => ({
            ...cachedA, status: 'cache-hit',
        }));
        const host = makeHost({ readDeepDiscover });
        jest.mocked(host.app.workspace.getActiveFile).mockImplementation(() => makeTFile(pathA));
        const orchestrator = new PageletOrchestrator(host);
        let position = { scrollTop: 0, sourcesExpanded: [false] };
        const panelView = {
            open: jest.fn<PanelOpen>(), close: jest.fn(), destroy: jest.fn(), isOpen: true,
            getReadingPosition: () => position,
            restoreReadingPosition: jest.fn((next: typeof position) => { position = next; }),
        };
        const internals = orchestrator as unknown as {
            panelView: typeof panelView;
            panelReading: { selectedId: string; candidates: PageletAgentDeliveryCandidate[] };
            agentInsightCandidate: PageletAgentDeliveryCandidate | null;
            clearPanelSession(): void;
            acceptDeepDiscoverResult(result: PageletDeepDiscoverControllerResult, options: { path: string; proactive: boolean }): unknown;
            invalidateAgentInsightForPaths(paths: readonly string[]): void;
        };
        internals.panelView = panelView;
        await orchestrator.openPanel();
        panelView.open.mock.calls.at(-1)?.[1][0].actions?.find((action: { label: string }) => action.label === 'Next result')?.callback();
        await flushAsyncWork();
        position = { scrollTop: 93, sourcesExpanded: [true] };
        internals.clearPanelSession();

        cachedA = newA;
        internals.acceptDeepDiscoverResult(newA, { path: pathA, proactive: true });
        internals.acceptDeepDiscoverResult(makeVerifiedDeepDiscoverResult('edit-idle', 'notes/b.md'), {
            path: 'notes/b.md', proactive: true,
        });
        expect(internals.agentInsightCandidate?.pageletAgent.handoff.anchor.path).toBe('notes/b.md');
        internals.invalidateAgentInsightForPaths(['notes/b.md']);
        expect(internals.agentInsightCandidate).toBeNull();

        await orchestrator.openPanel();
        expect(internals.panelReading.selectedId).toBe('a-reading-second');
        expect(panelView.open.mock.calls.at(-1)?.[1][0].insightText).toBe(oldA.insights[1].body);
        expect(panelView.restoreReadingPosition).toHaveBeenLastCalledWith({ scrollTop: 93, sourcesExpanded: [true] });
        expect(readDeepDiscover).toHaveBeenCalledTimes(1);
    });

    it("B-176 restores seen reading and position by anchor after a newer collection arrives", async () => {
        let activePath = 'notes/a.md';
        const resultA = makeVerifiedDeepDiscoverResult('explicit', activePath);
        if (resultA.status !== 'verified') throw new Error('fixture');
        resultA.insights = [resultA.insight, { ...resultA.insight, insightId: 'a-second', body: '## Second full text\nThe complete second body.' }];
        resultA.collection.insights = resultA.insights;
        const resultB = makeVerifiedDeepDiscoverResult('explicit', 'notes/b.md');
        const readDeepDiscover = jest.fn<NonNullable<PageletHost['readDeepDiscover']>>(async input => ({
            ...(input.path === 'notes/a.md' ? resultA : resultB), status: 'cache-hit',
        }));
        let activityListener: ((path: string) => void) | undefined;
        let phase: 'idle' | 'running' = 'idle';
        const invalid = new Set<string>();
        const host = makeHost({
            readDeepDiscover,
            validateDeepDiscoverInsight: async identity => !invalid.has(identity.insightId),
            getDeepDiscoverActivity: () => ({ phase, requestId: 'request-a' }),
            subscribeDeepDiscoverActivity: listener => { activityListener = listener; return () => undefined; },
        });
        jest.mocked(host.app.workspace.getActiveFile).mockImplementation(() => makeTFile(activePath));
        const orchestrator = new PageletOrchestrator(host);
        let position = { scrollTop: 0, sourcesExpanded: [false] };
        const panelView = {
            open: jest.fn<PanelOpen>(), isOpen: true, close: jest.fn(), updateReadingControls: jest.fn(),
            getReadingPosition: () => position,
            restoreReadingPosition: jest.fn((next: typeof position) => { position = next; }),
        };
        const internals = orchestrator as unknown as {
            panelView: typeof panelView; clearPanelSession(): void;
            acceptDeepDiscoverResult(result: PageletDeepDiscoverControllerResult, options: { path: string; proactive: boolean }): unknown;
            panelReading: { candidates: PageletAgentDeliveryCandidate[] };
            attentionStore: { isSeen(receipt: DeliveryReceipt): boolean };
        };
        internals.panelView = panelView;
        await orchestrator.openPanel();
        const originalCandidates = [...internals.panelReading.candidates];
        expect(internals.attentionStore.isSeen(originalCandidates[0].deliveryReceipt!)).toBe(true);
        expect(internals.attentionStore.isSeen(originalCandidates[1].deliveryReceipt!)).toBe(false);
        panelView.open.mock.calls.at(-1)?.[1][0].actions?.find((action: { label: string }) => action.label === 'Next result')?.callback();
        await flushAsyncWork();
        position = { scrollTop: 87, sourcesExpanded: [true] };
        const beforeActivity = panelView.open.mock.calls.length;
        phase = 'running';
        activityListener?.('notes/a.md');
        expect(panelView.open).toHaveBeenCalledTimes(beforeActivity);
        expect(panelView.updateReadingControls).toHaveBeenLastCalledWith(expect.objectContaining({ label: 'Analyzing this note…' }));
        expect(position).toEqual({ scrollTop: 87, sourcesExpanded: [true] });
        internals.clearPanelSession();
        activePath = 'notes/b.md';
        await orchestrator.openPanel();
        internals.clearPanelSession();
        const newer = makeVerifiedDeepDiscoverResult('edit-idle', 'notes/a.md');
        if (newer.status !== 'verified') throw new Error('fixture');
        newer.insight = { ...newer.insight, insightId: 'a-new', body: '## New collection\nNew full body.' };
        newer.insights = [newer.insight]; newer.collection.insights = newer.insights;
        internals.acceptDeepDiscoverResult(newer, { path: 'notes/a.md', proactive: false });
        invalid.add(originalCandidates[0].id);
        activePath = 'notes/a.md';
        await orchestrator.openPanel();
        expect(panelView.open.mock.calls.at(-1)?.[1][0].insightText).toBe('## Second full text\nThe complete second body.');
        expect(panelView.restoreReadingPosition).toHaveBeenLastCalledWith({ scrollTop: 87, sourcesExpanded: [true] });
        expect(readDeepDiscover).toHaveBeenCalledTimes(2);
        expect(internals.panelReading.candidates.map(candidate => [candidate.id, candidate.staleStatus])).toEqual([
            ['deep-notes/a.md', 'stale'], ['a-second', 'fresh'],
        ]);
        const controls = panelView.open.mock.calls.at(-1)?.[2]?.reading;
        if (!controls) throw new Error("expected controls for the restored reading");
        controls.actions?.find((action: { label: string }) => action.label === 'Show new results')?.callback();
        await flushAsyncWork();
        expect(panelView.open.mock.calls.at(-1)?.[1][0].insightText).toBe(newer.insight.body);
    });

    it("B-176 does not fill waiting R2 with an earlier R1 result or its cache", async () => {
        const first = makeVerifiedDeepDiscoverResult('edit-idle');
        const second = makeVerifiedDeepDiscoverResult('open-changed-note');
        if (first.status !== 'verified' || second.status !== 'verified') throw new Error('fixture');
        first.requestId = 'request-r1';
        second.requestId = 'request-r2';
        second.insight = { ...second.insight, insightId: 'r2-completed-text', body: '## R2 completed text\nOnly this request may fill its waiting reader.' };
        second.insights = [second.insight];
        second.collection.insights = second.insights;
        second.runtimeCompletion = {
            loopStatus: 'incomplete', endReason: 'max-turns', diagnosticTypes: [],
            lastTurnStatus: null, providerStopReason: null, finalTextState: 'empty',
            citationCoverage: 'not-applicable', turnCount: 3, toolCallCount: 4,
            insightDraftCount: 1, emptyFinalAnswerRetryCount: 0,
        };
        let activity: ReturnType<NonNullable<PageletHost['getDeepDiscoverActivity']>> = {
            phase: 'queued', requestId: 'request-r2',
        };
        let activityListener: ((path: string) => void) | undefined;
        const readDeepDiscover = jest.fn<NonNullable<PageletHost['readDeepDiscover']>>()
            .mockResolvedValueOnce({ status: 'empty' })
            .mockResolvedValue({ ...first, status: 'cache-hit' });
        const host = makeHost({
            readDeepDiscover,
            getDeepDiscoverActivity: () => activity,
            subscribeDeepDiscoverActivity: listener => { activityListener = listener; return () => undefined; },
        });
        const orchestrator = new PageletOrchestrator(host);
        const panelView = { open: jest.fn<PanelOpen>(), close: jest.fn(), isOpen: true, updateReadingControls: jest.fn() };
        const internals = orchestrator as unknown as {
            panelView: typeof panelView;
            acceptDeepDiscoverResult(result: PageletDeepDiscoverControllerResult, options: { path: string; proactive: boolean }): unknown;
        };
        internals.panelView = panelView;
        await orchestrator.openPanel();
        // Both requests use the same note snapshot; R2 is queued while R1 completes.
        internals.acceptDeepDiscoverResult(first, { path: 'notes/current.md', proactive: true });
        expect(panelView.open.mock.calls.at(-1)?.[1]).toHaveLength(0);

        // R2 can retain staged results without replacing R1 in the cache.
        activity = { phase: 'idle', requestId: 'request-r2', terminal: {
            status: 'verified', runtimeCompletion: second.runtimeCompletion,
        } };
        activityListener?.('notes/current.md');
        await flushAsyncWork();
        expect(panelView.open.mock.calls.at(-1)?.[1]).toHaveLength(0);
        expect(readDeepDiscover).toHaveBeenCalledTimes(1);

        internals.acceptDeepDiscoverResult(second, { path: 'notes/current.md', proactive: true });
        expect(panelView.open.mock.calls.at(-1)?.[1][0].insightText).toBe(second.insight.body);
    });

    it.each([true, false])("B-176 fills an empty reading only for the awaited request identity: %s", async sameRequest => {
        let phase: 'idle' | 'running' = 'running';
        let requestId = 'request-1';
        const host = makeHost({
            readDeepDiscover: async () => ({ status: 'empty' }),
            getDeepDiscoverActivity: () => ({ phase, requestId }),
        });
        const orchestrator = new PageletOrchestrator(host);
        const panelView = { open: jest.fn<PanelOpen>(), close: jest.fn(), isOpen: true, updateReadingControls: jest.fn() };
        const internals = orchestrator as unknown as {
            panelView: typeof panelView;
            acceptDeepDiscoverResult(result: PageletDeepDiscoverControllerResult, options: { path: string; proactive: boolean }): unknown;
        };
        internals.panelView = panelView;
        await orchestrator.openPanel();
        phase = 'idle';
        if (!sameRequest) requestId = 'request-2';
        const result = makeVerifiedDeepDiscoverResult();
        result.requestId = 'request-1';
        internals.acceptDeepDiscoverResult(result, { path: 'notes/current.md', proactive: true });
        await flushAsyncWork();
        const findings = panelView.open.mock.calls.at(-1)?.[1];
        if (!findings) throw new Error("expected the reading Panel to render");
        expect(findings.length > 0).toBe(sameRequest);
    });

    it("B-176 keeps a closed reading intent closed when explicit analysis finishes", async () => {
        let finish!: (result: PageletDeepDiscoverControllerResult) => void;
        const runDeepDiscover = jest.fn<NonNullable<PageletHost['runDeepDiscover']>>(() => new Promise(resolve => { finish = resolve; }));
        const orchestrator = new PageletOrchestrator(makeHost({ runDeepDiscover }));
        const panelView = { open: jest.fn<PanelOpen>(), close: jest.fn(), isOpen: true };
        const internals = orchestrator as unknown as {
            panelView: typeof panelView;
            clearPanelSession(): void;
        };
        internals.panelView = panelView;
        const pending = Promise.resolve(orchestrator.getCommandCallbacks().onDiscoverConnections());
        panelView.open.mockClear();
        panelView.isOpen = false;
        internals.clearPanelSession();
        finish(makeVerifiedDeepDiscoverResult());
        await pending;
        expect(panelView.open).not.toHaveBeenCalled();
        expect(runDeepDiscover).toHaveBeenCalledTimes(1);
        await orchestrator.openPanel();
        expect(panelView.open.mock.calls.at(-1)?.[1][0].insightText).toContain('Release assumptions conflict');
        expect(runDeepDiscover).toHaveBeenCalledTimes(1);
    });

    it("runs explicit discovery again with an existing result and keeps viewing provider-free", async () => {
        const runDeepDiscover = jest.fn<NonNullable<PageletHost["runDeepDiscover"]>>()
            .mockResolvedValueOnce(makeVerifiedDeepDiscoverResult())
            .mockResolvedValueOnce({ status: "error", reason: "provider-failed" });
        const orchestrator = new PageletOrchestrator(makeHost({ runDeepDiscover }));
        const panelView = {
            open: jest.fn<(layout: string, findings: PanelFinding[]) => void>(),
            close: jest.fn(), isOpen: true,
        };
        (orchestrator as unknown as { panelView: typeof panelView }).panelView = panelView;

        await Promise.resolve(orchestrator.getCommandCallbacks().onDiscoverConnections());
        const originalBody = panelView.open.mock.calls.at(-1)?.[1][0].insightText;
        await orchestrator.openPanel();
        expect(runDeepDiscover).toHaveBeenCalledTimes(1);
        await Promise.resolve(orchestrator.getCommandCallbacks().onDiscoverConnections());
        expect(runDeepDiscover).toHaveBeenCalledTimes(2);
        await orchestrator.openPanel();
        expect(runDeepDiscover).toHaveBeenCalledTimes(2);
        expect(panelView.open.mock.calls.at(-1)?.[1][0].insightText).toBe(originalBody);
    });

    it("opens the Panel reading without a deep-discover reader or provider run", async () => {
        const runDeepDiscover = jest.fn<NonNullable<PageletHost["runDeepDiscover"]>>();
        const orchestrator = new PageletOrchestrator(makeHost({
            runDeepDiscover,
            readDeepDiscover: undefined,
            getDeepDiscoverPolicyIdentity: undefined,
        }));
        const panelView = {
            open: jest.fn<PanelOpen>(),
            close: jest.fn(),
            destroy: jest.fn(),
            isOpen: true,
        };
        (orchestrator as unknown as { panelView: typeof panelView }).panelView = panelView;

        try {
            await orchestrator.openPanel();

            expect(runDeepDiscover).not.toHaveBeenCalled();
            const [layout, findings, extra] = panelView.open.mock.calls.at(-1) ?? [];
            expect(layout).toBe("discover");
            expect(findings).toEqual([]);
            expect(extra?.sourcePath).toBe("notes/current.md");
            expect(extra?.reading?.label).toContain("No content is available for this note yet.");
        } finally {
            orchestrator.destroy();
        }
    });

    it("makes every completed text reachable after a partial run without another provider call", async () => {
        const result = makeVerifiedDeepDiscoverResult();
        if (result.status !== "verified") throw new Error("expected verified fixture");
        result.insights = Array.from({ length: 3 }, (_, index) => ({
            ...result.insight,
            insightId: `complete-text-${index}`,
            body: `## Completed text ${index}\n\nFull body ${index}.\n\n### Another finding\nKept intact.`,
        }));
        result.insight = result.insights[0];
        result.collection.insights = result.insights;
        result.runtimeCompletion = {
            loopStatus: "incomplete", endReason: "max-turns", diagnosticTypes: [],
            lastTurnStatus: null, providerStopReason: null, finalTextState: "empty",
            citationCoverage: "not-applicable", turnCount: 3, toolCallCount: 4,
            insightDraftCount: 3, emptyFinalAnswerRetryCount: 0,
        };
        const runDeepDiscover = jest.fn<NonNullable<PageletHost["runDeepDiscover"]>>(async () => result);
        const orchestrator = new PageletOrchestrator(makeHost({ runDeepDiscover }));
        const panelView = {
            open: jest.fn<(layout: string, findings: PanelFinding[]) => void>(),
            close: jest.fn(), isOpen: true,
        };
        (orchestrator as unknown as { panelView: typeof panelView }).panelView = panelView;

        await Promise.resolve(orchestrator.getCommandCallbacks().onDiscoverConnections());
        for (const insight of result.insights) {
            const finding = panelView.open.mock.calls.at(-1)?.[1][0] as {
                insightText: string;
                actionStatus: { detail: string };
                actions: Array<{ label: string; callback(): void }>;
            };
            expect(finding.insightText).toBe(insight.body);
            expect(finding.actionStatus.detail).toContain("did not finish");
            expect(finding.actions.some((action) => action.label.startsWith("Link "))).toBe(false);
            finding.actions.find((action) => action.label === "Next result")?.callback();
            await flushAsyncWork();
        }
        expect(runDeepDiscover).toHaveBeenCalledTimes(1);
        expect(panelView.open.mock.calls.at(-1)?.[1][0].actions?.some(
            (action: { label: string }) => action.label === "Next result",
        )).toBe(false);
    });

    it.each([
        [{ status: "quiet", reason: "no-insight" }, "No findings in this analysis."],
        [{ status: "quiet", reason: "empty" }, "The analysis could not finish."],
        [{ status: "quiet", reason: "duplicate" }, "This analysis has no new results to show."],
        [{ status: "quiet", reason: "aborted" }, "Analysis cancelled."],
        [{ status: "stale", reason: "source-changed" }, "The sources or permissions changed. Run the analysis again."],
    ] as const)("reports the actual explicit terminal outcome: %o", async (result, message) => {
        const orchestrator = new PageletOrchestrator(makeHost({ runDeepDiscover: async () => result }));
        await Promise.resolve(orchestrator.getCommandCallbacks().onDiscoverConnections());
        expect(Notice).toHaveBeenCalledWith(message, 5000);
    });

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

        await Promise.resolve(orchestrator.getCommandCallbacks().onDiscoverConnections());

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

        await Promise.resolve(orchestrator.getCommandCallbacks().onDiscoverConnections());

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

        const pending = Promise.resolve(orchestrator.getCommandCallbacks().onDiscoverConnections());
        await Promise.resolve();
        (orchestrator as unknown as { foregroundRouteToken: number }).foregroundRouteToken += 1;
        finishRun?.(result);
        await pending;

        expect(discardDeepDiscoverResult).toHaveBeenCalledWith(result);
        expect(acknowledgeDeepDiscoverResult).not.toHaveBeenCalled();
    });

    it("routes the discovery command to its controller without legacy providers or command callbacks", async () => {
        const runDeepDiscover = jest.fn<NonNullable<PageletHost["runDeepDiscover"]>>(async () => ({
            status: "quiet",
            reason: "no-insight",
        } as const));
        const host = makeHost({ runDeepDiscover });
        const legacyDiscovery = jest.spyOn(host, "discoverConnections");
        const orchestrator = new PageletOrchestrator(host);
        const callbacks = orchestrator.getCommandCallbacks();

        await Promise.resolve(callbacks.onDiscoverConnections());

        for (const retired of [
            "onOpenPreparedReview", "onReviewCurrent", "onQuickReview",
            "onQuietRecall", "onScopeRecap", "onClearScopeRecapCache",
        ]) {
            expect(callbacks).not.toHaveProperty(retired);
        }
        expect(runDeepDiscover).toHaveBeenCalledTimes(1);
        for (const [request] of runDeepDiscover.mock.calls) {
            expect(request).toEqual({
                path: "notes/current.md",
                triggerReason: "explicit",
                force: true,
            });
        }
        expect(legacyDiscovery).not.toHaveBeenCalled();
        expect(Notice).toHaveBeenCalledTimes(1);
        expect(Notice).toHaveBeenCalledWith("No findings in this analysis.", 5000);
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

    it("keeps the selected Panel reading stale when an uncited input changes and leaves its sibling usable", async () => {
        let changed = false;
        const host = makeHost({ validateDeepDiscoverInsight: async identity => !changed || identity.insightId === "independent-sibling" });
        const orchestrator = new PageletOrchestrator(host);
        const panelView = {
            open: jest.fn<PanelOpen>(),
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
            openAgentInsightCandidate: PageletAgentDeliveryCandidate | null;
            panelReading: { candidates: PageletAgentDeliveryCandidate[] };
        };
        internals.panelView = panelView;
        const result = makeVerifiedDeepDiscoverResult();
        const hidden = { ...result.insight.anchor, path: "notes/uncited.md" };
        result.insight = {
            ...result.insight,
            inputEvidence: {
                lineage: { schemaVersion: 1, completeness: "complete", dependencies: [
                    { kind: "vault", via: "pagelet", path: result.insight.anchor.path },
                    { kind: "vault", via: "note", path: hidden.path },
                ] },
                sourceRecords: [], sourceSnapshots: [result.insight.anchor, hidden], vaultObservations: [],
            },
        };
        const sibling = { ...makeVerifiedDeepDiscoverResult().insight, insightId: "independent-sibling", body: "An independent result." };
        result.insights = [result.insight, sibling];
        result.collection.insights = result.insights;
        const candidate = internals.acceptDeepDiscoverResult(
            result,
            { path: "notes/current.md", proactive: false },
        );
        expect(candidate).not.toBeNull();
        internals.openAgentInsightPanel(candidate!);

        changed = true;
        internals.invalidateAgentInsightForPaths([hidden.path]);
        await flushAsyncWork();
        expect(internals.openAgentInsightCandidate?.id).toBe(result.insight.insightId);
        expect(internals.openAgentInsightCandidate?.staleStatus).toBe("stale");
        expect(panelView.close).not.toHaveBeenCalled();
        const finding = panelView.open.mock.calls.at(-1)?.[1][0];
        expect(finding?.insightText).toBe(result.insight.body);
        expect(finding?.actionStatus?.label).toContain("out of date");
        expect(finding?.actions?.find(action => action.label === "Discuss in Chat")?.disabled).toBe(true);
        expect(internals.panelReading.candidates).toHaveLength(2);
        finding?.actions?.find(action => action.label === "Next result")?.callback();
        await flushAsyncWork();
        expect(internals.openAgentInsightCandidate?.id).toBe(sibling.insightId);
        expect(panelView.open.mock.calls.at(-1)?.[1][0].actions?.find(action => action.label === "Discuss in Chat")?.disabled).not.toBe(true);
    });

    it.each([false, true])("rechecks a cache-hit through the full reading validator before displaying it: %s", async valid => {
        const cached = makeVerifiedDeepDiscoverResult();
        const validateDeepDiscoverInsight = jest.fn<NonNullable<PageletHost["validateDeepDiscoverInsight"]>>().mockResolvedValue(valid);
        const host = makeHost({
            readDeepDiscover: async () => ({ ...cached, status: "cache-hit" }),
            validateDeepDiscoverInsight,
            getDeepDiscoverPolicyIdentity: () => "current-policy",
        });
        const orchestrator = new PageletOrchestrator(host);
        const panelView = { open: jest.fn<PanelOpen>(), close: jest.fn(), isOpen: true };
        (orchestrator as unknown as { panelView: typeof panelView }).panelView = panelView;
        await orchestrator.openPanel();
        expect(validateDeepDiscoverInsight).toHaveBeenCalledTimes(1);
        const findings = panelView.open.mock.calls.at(-1)?.[1] ?? [];
        if (valid) expect(findings[0]?.insightText).toBe(cached.insight.body);
        else expect(findings).toEqual([]);
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
        expect(Notice).toHaveBeenCalledWith("No findings in this analysis.", 5000);
    });

    it("keeps local Maintenance and Graph available beyond old foreground caps while mutually exclusive", async () => {
        const runMaintenanceReview = jest.fn<NonNullable<PageletHost["runMaintenanceReview"]>>(
            () => new Promise((resolve) => {
                finishMaintenance = resolve;
            }),
        );
        const runGraphDiscovery = jest.fn<NonNullable<PageletHost["runGraphDiscovery"]>>(
            async () => ({
                generatedAt: "2026-06-29T12:00:00.000Z",
                totalCount: 0,
                items: [],
                skippedSourceCount: 0,
            }),
        );
        let finishMaintenance!: (value: Awaited<ReturnType<NonNullable<PageletHost["runMaintenanceReview"]>>>) => void;
        const host = makeHost({ runMaintenanceReview, runGraphDiscovery });
        host.settings.pagelet.foregroundPerHourCap = 0;
        host.settings.pagelet.foregroundPerDayCap = 0;
        const orchestrator = new PageletOrchestrator(host);

        const maintenance = orchestrator.runMaintenanceReview();
        await Promise.resolve();
        await orchestrator.runGraphDiscovery();

        expect(runMaintenanceReview).toHaveBeenCalledTimes(1);
        expect(runGraphDiscovery).not.toHaveBeenCalled();
        expect(Notice).toHaveBeenCalledWith("Pagelet is already reviewing. Please wait for it to finish.", 4000);
        expect(Notice).not.toHaveBeenCalledWith("Foreground review limit reached. Try again later.", 5000);

        finishMaintenance({
            generatedAt: "2026-06-28T12:00:00.000Z",
            previewOnly: true,
            weeklyScanEnabled: false,
            totalCount: 0,
            categories: [],
            proposals: [],
        });
        await maintenance;
        await orchestrator.runGraphDiscovery();
        expect(runGraphDiscovery).toHaveBeenCalledTimes(1);
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

    it("opens a validated full Pagelet handoff without sending from the Panel", async () => {
        const openPageletChatHandoff = jest.fn<NonNullable<PageletHost["openPageletChatHandoff"]>>(
            async () => ({ status: "prepared" as const }),
        );
        const validateDeepDiscoverInsight = jest.fn<NonNullable<PageletHost["validateDeepDiscoverInsight"]>>(
            async () => true,
        );
        const host = makeHost({
            validateDeepDiscoverInsight,
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

    it.each([
        ["busy", "Chat is busy. Finish the current response, then try again."],
        ["draft-conflict", "Chat already has a draft. Send or clear it before opening this insight."],
    ] as const)("keeps the reading and permits retry after a %s Chat handoff", async (status, message) => {
        const openPageletChatHandoff = jest.fn<NonNullable<PageletHost["openPageletChatHandoff"]>>()
            .mockResolvedValueOnce({ status })
            .mockResolvedValue({ status: "prepared" });
        const orchestrator = new PageletOrchestrator(makeHost({
            validateDeepDiscoverInsight: async () => true,
            openPageletChatHandoff,
        }));
        const panelView = {
            open: jest.fn<PanelOpen>(),
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
        const latestFinding = () => panelView.open.mock.calls.at(-1)![1][0];

        expect(latestFinding().actions?.map((action) => action.label)).toEqual(["Discuss in Chat"]);
        latestFinding().actions?.[0].callback();
        await flushAsyncWork();

        expect(latestFinding().actionStatus).toMatchObject({ label: message, tone: "error" });
        expect(panelView.close).not.toHaveBeenCalled();
        latestFinding().actions?.[0].callback();
        await flushAsyncWork();

        expect(openPageletChatHandoff).toHaveBeenCalledTimes(2);
        expect(panelView.close).toHaveBeenCalledTimes(1);
    });

    it.each(["panel close", "source change"] as const)("aborts a late Pagelet Chat handoff after %s and ignores duplicate clicks", async (cancellation) => {
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
        const validateDeepDiscoverInsight = jest.fn(async () => true);
        const host = makeHost({
            validateDeepDiscoverInsight,
            openPageletChatHandoff,
        });
        const orchestrator = new PageletOrchestrator(host);
        const panelView = {
            open: jest.fn<(layout: string, findings: unknown[], extra?: unknown) => void>(),
            close: jest.fn(),
            destroy: jest.fn(),
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
            handleMarkdownModify(path: string): void;
        };
        internals.panelView = panelView;
        try {
            const candidate = internals.acceptDeepDiscoverResult(
                makeVerifiedDeepDiscoverResult(),
                { path: "notes/current.md", proactive: false },
            );
            internals.openAgentInsightPanel(candidate);
            const finding = panelView.open.mock.calls.at(-1)?.[1][0] as {
                actions: Array<{ label: string; callback(): void }>;
            };

            const discuss = finding.actions.find((action) => action.label === "Discuss in Chat");
            discuss?.callback();
            discuss?.callback();
            await flushAsyncWork();
            discuss?.callback();
            expect(validateDeepDiscoverInsight).toHaveBeenCalledTimes(1);
            expect(openPageletChatHandoff).toHaveBeenCalledTimes(1);
            expect(observedSignal?.aborted).toBe(false);

            if (cancellation === "panel close") {
                internals.clearPanelSession();
                expect(internals.openAgentInsightCandidate).toBeNull();
            } else {
                validateDeepDiscoverInsight.mockResolvedValue(false);
                internals.handleMarkdownModify("notes/related.md");
            }
            expect(observedSignal?.aborted).toBe(true);
            releaseHandoff?.({ status: "prepared" });
            await flushAsyncWork();

            expect(panelView.close).not.toHaveBeenCalled();
        } finally {
            orchestrator.destroy();
        }
    });

    it("explains the daily limit only for an explicit trigger", async () => {
        jest.mocked(Notice).mockClear();
        const host = makeHost({
            runDeepDiscover: async () => ({ status: "limit", reason: "limit" }),
        });
        const orchestrator = new PageletOrchestrator(host);

        await Promise.resolve(orchestrator.getCommandCallbacks().onDiscoverConnections());

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

        await Promise.resolve(orchestrator.getCommandCallbacks().onDiscoverConnections());

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

        await Promise.resolve(orchestrator.getCommandCallbacks().onDiscoverConnections());

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

        await Promise.resolve(orchestrator.getCommandCallbacks().onDiscoverConnections());

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
    it("B-177 routes Pet reading to per-note Details and only reveals an existing live note", async () => {
        let activePath = "notes/a.md";
        const detailStates = new Map<string, "live" | "restored-placeholder">();
        const openedPayloads: PageletDetailPayload[] = [];
        const revealedPaths: string[] = [];
        const readDeepDiscover = jest.fn<NonNullable<PageletHost["readDeepDiscover"]>>(async input => ({
            ...makeVerifiedDeepDiscoverResult("explicit", input.path),
            status: "cache-hit",
        }));
        const runDeepDiscover = jest.fn<NonNullable<PageletHost["runDeepDiscover"]>>();
        const host = makeHost({
            readDeepDiscover,
            runDeepDiscover,
            openPageletDetailView: payload => {
                openedPayloads.push(payload);
                const path = payload.reading?.anchorPath ?? payload.sourcePath;
                if (path) detailStates.set(path, "live");
            },
        });
        Object.assign(host, {
            getPageletDetailPathState: (path: string) => detailStates.get(path) ?? "none",
            revealPageletDetailViewForPath: async (path: string) => {
                revealedPaths.push(path);
                return detailStates.get(path) === "live";
            },
        });
        jest.mocked(host.app.workspace.getActiveFile).mockImplementation(() => makeTFile(activePath));
        const orchestrator = new PageletOrchestrator(host);
        const panelView = {
            open: jest.fn<PanelOpen>(), close: jest.fn(), destroy: jest.fn(), isOpen: true,
        };
        const internals = orchestrator as unknown as {
            panelView: typeof panelView;
            handlePetClick(): void;
        };
        internals.panelView = panelView;

        internals.handlePetClick();
        await flushAsyncWork();
        activePath = "notes/b.md";
        internals.handlePetClick();
        await flushAsyncWork();
        expect(openedPayloads.map(payload => payload.reading?.anchorPath)).toEqual(["notes/a.md", "notes/b.md"]);
        expect(panelView.open).not.toHaveBeenCalled();
        expect(runDeepDiscover).not.toHaveBeenCalled();

        activePath = "notes/a.md";
        internals.handlePetClick();
        await flushAsyncWork();
        expect(revealedPaths).toEqual(["notes/a.md"]);
        expect(openedPayloads).toHaveLength(2);
        expect(readDeepDiscover).toHaveBeenCalledTimes(2);
        orchestrator.destroy();
    });

    it("B-177 suppresses artificial discovery between a note and its own anchored Detail", () => {
        const markdownA = {
            view: {
                getViewType: () => "markdown",
                file: makeTFile("notes/a.md"),
                contentEl: {},
            },
        };
        const markdownB = {
            view: {
                getViewType: () => "markdown",
                file: makeTFile("notes/b.md"),
                contentEl: {},
            },
        };
        const detailA = { view: { getViewType: () => "pa-pagelet-detail-view" } };
        const runDeepDiscover = jest.fn<NonNullable<PageletHost["runDeepDiscover"]>>(
            async () => ({ status: "quiet", reason: "no-insight" }),
        );
        const host = makeHost({ runDeepDiscover });
        Object.assign(host, {
            getPageletDetailLeafAnchorPath: (leaf: unknown) => leaf === detailA ? "notes/a.md" : null,
        });
        host.settings.pagelet.petVisible = false;
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            currentMarkdownAnchorPath: string | null;
            handleLeafChange(leaf: unknown): void;
        };
        internals.currentMarkdownAnchorPath = "notes/a.md";

        internals.handleLeafChange(detailA);
        expect(internals.currentMarkdownAnchorPath).toBe("notes/a.md");
        internals.handleLeafChange(markdownA);
        expect(internals.currentMarkdownAnchorPath).toBe("notes/a.md");
        expect(runDeepDiscover).not.toHaveBeenCalled();

        internals.handleLeafChange(markdownB);
        expect(runDeepDiscover.mock.calls.map(([input]) => [input.path, input.triggerReason])).toEqual([
            ["notes/a.md", "leave-note"],
            ["notes/b.md", "open-changed-note"],
        ]);
        orchestrator.destroy();
    });

    it("B-177 leaves an accepted waiting Detail intact when its superseded pure read finishes", async () => {
        let finishOldRead!: (result: Awaited<ReturnType<NonNullable<PageletHost["readDeepDiscover"]>>>) => void;
        let activityRequestId = "request-r";
        const detailStates = new Map<string, "live" | "restored-placeholder">();
        let openedReading: PageletDetailPayload["reading"] | undefined;
        const readDeepDiscover = jest.fn<NonNullable<PageletHost["readDeepDiscover"]>>(
            () => new Promise(resolve => { finishOldRead = resolve; }),
        );
        const host = makeHost({
            readDeepDiscover,
            getDeepDiscoverActivity: () => ({ phase: "running", requestId: activityRequestId }),
            runDeepDiscover: jest.fn<NonNullable<PageletHost["runDeepDiscover"]>>(),
            openPageletDetailView: payload => {
                openedReading = payload.reading;
                detailStates.set(payload.reading?.anchorPath ?? "", "live");
            },
        });
        Object.assign(host, {
            getPageletDetailPathState: (path: string) => detailStates.get(path) ?? "none",
        });
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            handlePetClick(): void;
            acceptDeepDiscoverResult(result: PageletDeepDiscoverControllerResult, options: { path: string; proactive: boolean }): unknown;
        };

        internals.handlePetClick();
        await flushAsyncWork();
        expect(readDeepDiscover).toHaveBeenCalledTimes(1);
        expect(openedReading?.candidates).toEqual([]);

        const verified = makeVerifiedDeepDiscoverResult("explicit", "notes/current.md");
        verified.requestId = "request-r";
        internals.acceptDeepDiscoverResult(verified, { path: "notes/current.md", proactive: false });
        await flushAsyncWork();
        expect(openedReading?.candidates.map(candidate => candidate.id)).toEqual([verified.insight.insightId]);
        expect(openedReading?.selectedId).toBe(verified.insight.insightId);

        finishOldRead({ status: "empty" });
        await flushAsyncWork();
        expect(openedReading?.candidates.map(candidate => candidate.id)).toEqual([verified.insight.insightId]);
        expect(openedReading?.selectedId).toBe(verified.insight.insightId);
        expect(openedReading?.getReadingControls().label).not.toContain("No content is available for this note yet");
        orchestrator.destroy();
    });

    it("B-177 fills only its waiting Detail and keeps new-result cues attributed to that note", async () => {
        let activePath = "notes/a.md";
        let activityRequestId = "request-a";
        const detailStates = new Map<string, "live" | "restored-placeholder">();
        let openedReading: PageletDetailPayload["reading"] | undefined;
        const markedNewResults: Array<[string, boolean]> = [];
        const host = makeHost({
            readDeepDiscover: async () => ({ status: "empty" }),
            getDeepDiscoverActivity: () => ({ phase: "running", requestId: activityRequestId }),
            runDeepDiscover: jest.fn<NonNullable<PageletHost["runDeepDiscover"]>>(),
            openPageletDetailView: payload => {
                openedReading = payload.reading;
                const path = payload.reading?.anchorPath ?? payload.sourcePath;
                if (path) detailStates.set(path, "live");
            },
        });
        Object.assign(host, {
            getPageletDetailPathState: (path: string) => detailStates.get(path) ?? "none",
            markPageletDetailNewResults: (path: string, hasNewResults: boolean) => {
                markedNewResults.push([path, hasNewResults]);
            },
        });
        host.settings.pagelet.proactiveHints = true;
        jest.mocked(host.app.workspace.getActiveFile).mockImplementation(() => makeTFile(activePath));
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            currentMarkdownAnchorPath: string | null;
            handlePetClick(): void;
            acceptDeepDiscoverResult(result: PageletDeepDiscoverControllerResult, options: { path: string; proactive: boolean }): unknown;
            currentAdmittedNudgeTickets(): unknown[];
            handlePageletDetailClosed(path: string): void;
        };
        internals.handlePetClick();
        await flushAsyncWork();
        expect(openedReading?.candidates).toEqual([]);
        expect(openedReading?.anchorPath).toBe("notes/a.md");
        openedReading?.subscribe(() => undefined);

        internals.currentMarkdownAnchorPath = "notes/b.md";
        const result = makeVerifiedDeepDiscoverResult("edit-idle", "notes/a.md");
        result.requestId = "request-a";
        internals.acceptDeepDiscoverResult(result, { path: "notes/a.md", proactive: true });
        await flushAsyncWork();
        expect(openedReading?.candidates.map(candidate => candidate.id)).toEqual([result.insight.insightId]);
        expect(markedNewResults).toEqual([["notes/a.md", true]]);
        expect(internals.currentAdmittedNudgeTickets()).toEqual([]);

        internals.acceptDeepDiscoverResult(result, { path: "notes/a.md", proactive: true });
        await flushAsyncWork();
        expect(markedNewResults).toEqual([["notes/a.md", true]]);

        activityRequestId = "request-b";
        const changedResult = makeVerifiedDeepDiscoverResult("edit-idle", "notes/a.md");
        changedResult.insight = {
            ...changedResult.insight,
            insightId: "a-changed-result",
            body: "## Changed A result\nThis is a genuinely different collection.",
        };
        changedResult.insights = [changedResult.insight];
        changedResult.collection.insights = changedResult.insights;
        changedResult.requestId = "request-b";
        internals.acceptDeepDiscoverResult(changedResult, { path: "notes/a.md", proactive: true });
        await flushAsyncWork();
        expect(markedNewResults).toEqual([
            ["notes/a.md", true],
            ["notes/a.md", true],
        ]);
        internals.acceptDeepDiscoverResult(changedResult, { path: "notes/a.md", proactive: true });
        await flushAsyncWork();
        expect(markedNewResults).toEqual([
            ["notes/a.md", true],
            ["notes/a.md", true],
        ]);

        const bResult = makeVerifiedDeepDiscoverResult("edit-idle", "notes/b.md");
        bResult.requestId = "request-b";
        internals.acceptDeepDiscoverResult(bResult, { path: "notes/b.md", proactive: true });
        await flushAsyncWork();

        detailStates.delete("notes/a.md");
        internals.currentMarkdownAnchorPath = "notes/a.md";
        expect(internals.currentAdmittedNudgeTickets()).toHaveLength(1);
        internals.handlePageletDetailClosed("notes/a.md");
        expect(internals.currentAdmittedNudgeTickets()).toHaveLength(1);
        detailStates.set("notes/a.md", "live");
        expect(internals.currentAdmittedNudgeTickets()).toEqual([]);
        orchestrator.destroy();
    });

    it("B-177 accepts the full Show-new collection while an old member remains a local selection", async () => {
        let activityRequestId = "request-a";
        const detailStates = new Map<string, "live" | "restored-placeholder">();
        let openedReading: PageletDetailPayload["reading"] | undefined;
        const markedNewResults: Array<[string, boolean]> = [];
        const host = makeHost({
            readDeepDiscover: async () => ({ status: "empty" }),
            getDeepDiscoverActivity: () => ({ phase: "running", requestId: activityRequestId }),
            openPageletDetailView: payload => {
                openedReading = payload.reading;
                detailStates.set(payload.reading?.anchorPath ?? "", "live");
            },
        });
        Object.assign(host, {
            getPageletDetailPathState: (path: string) => detailStates.get(path) ?? "none",
            markPageletDetailNewResults: (path: string, hasNewResults: boolean) => {
                markedNewResults.push([path, hasNewResults]);
            },
        });
        const orchestrator = new PageletOrchestrator(host);
        const internals = orchestrator as unknown as {
            recentReadings: Map<string, { candidates: PageletAgentDeliveryCandidate[] }>;
            handlePetClick(): void;
            acceptDeepDiscoverResult(result: PageletDeepDiscoverControllerResult, options: { path: string; proactive: boolean }): unknown;
        };
        internals.handlePetClick();
        await flushAsyncWork();
        const first = makeVerifiedDeepDiscoverResult("edit-idle", "notes/current.md");
        first.requestId = "request-a";
        internals.acceptDeepDiscoverResult(first, { path: "notes/current.md", proactive: false });

        activityRequestId = "request-b";
        const newer = makeVerifiedDeepDiscoverResult("edit-idle", "notes/current.md");
        const second = {
            ...newer.insight,
            insightId: "current-second",
            body: "## Second current result\nOnly the full Show-new set accepts this collection.",
        };
        newer.insights = [newer.insight, second];
        newer.collection.insights = newer.insights;
        newer.requestId = "request-b";
        internals.acceptDeepDiscoverResult(newer, { path: "notes/current.md", proactive: false });
        const oldMember = openedReading?.candidates[0];
        const latest = openedReading?.getLatestCandidates();
        if (!oldMember || !latest || latest.length !== 2) throw new Error("Expected an old member and full latest set");

        openedReading?.onSelect(oldMember);
        expect(markedNewResults).toEqual([
            ["notes/current.md", true],
            ["notes/current.md", true],
        ]);
        expect(internals.recentReadings.get("notes/current.md")?.candidates).toEqual([oldMember]);

        openedReading?.onSelect(oldMember, latest);
        expect(markedNewResults[markedNewResults.length - 1]).toEqual(["notes/current.md", false]);
        expect(internals.recentReadings.get("notes/current.md")?.candidates).toEqual(latest);
        expect(openedReading?.candidates).toEqual(latest);
        orchestrator.destroy();
    });

    it("makes an in-flight cache read available after the empty Panel expands into Detail", async () => {
        let finishRead!: (result: Awaited<ReturnType<NonNullable<PageletHost["readDeepDiscover"]>>>) => void;
        const readDeepDiscover = jest.fn<NonNullable<PageletHost["readDeepDiscover"]>>(
            () => new Promise(resolve => { finishRead = resolve; }),
        );
        const openPageletDetailView = jest.fn<NonNullable<PageletHost["openPageletDetailView"]>>();
        const runDeepDiscover = jest.fn<NonNullable<PageletHost["runDeepDiscover"]>>();
        const host = makeHost({ readDeepDiscover, openPageletDetailView, runDeepDiscover });
        const orchestrator = new PageletOrchestrator(host);
        const panelView = {
            currentLayoutType: "discover" as const, currentVisibleFindings: [], currentPanelExtra: undefined,
            open: jest.fn<PanelOpen>(), close: jest.fn(() => { panelView.isOpen = false; }), isOpen: true,
        };
        const internals = orchestrator as unknown as {
            panelView: typeof panelView;
            expandPanelToTab(): Promise<void>;
            acceptDeepDiscoverResult(result: PageletDeepDiscoverControllerResult, options: { path: string; proactive: boolean }): unknown;
        };
        internals.panelView = panelView;
        const loading = orchestrator.openPanel();
        await flushAsyncWork();
        expect(readDeepDiscover).toHaveBeenCalledTimes(1);
        await internals.expandPanelToTab();
        const reading = openPageletDetailView.mock.calls[0]?.[0].reading;
        if (!reading) throw new Error("Expected a Detail reading payload");
        expect(reading.candidates).toEqual([]);
        const changed = jest.fn();
        const unsubscribe = reading.subscribe(changed);
        const panelRenderCount = panelView.open.mock.calls.length;
        const result = makeVerifiedDeepDiscoverResult();
        finishRead({ ...result, status: "cache-hit" });
        await loading;
        expect(reading.getLatestCandidates().map(candidate => candidate.id)).toEqual([result.insight.insightId]);
        expect(reading.getReadingControls().label).toContain("New results are available.");
        expect(reading.getReadingControls().label).not.toContain("Checking available content");
        expect(changed).toHaveBeenCalled();
        expect(panelView.open).toHaveBeenCalledTimes(panelRenderCount);
        expect(panelView.isOpen).toBe(false);
        expect(runDeepDiscover).not.toHaveBeenCalled();
        unsubscribe();

        // The same valid cache read must not replace a newer collection accepted
        // while its full source validation is still awaiting completion.
        const path = "notes/racing.md";
        jest.mocked(host.app.workspace.getActiveFile).mockReturnValue(makeTFile(path));
        const older = makeVerifiedDeepDiscoverResult("explicit", path);
        let finishValidation!: (valid: boolean) => void;
        host.validateDeepDiscoverInsight = identity => identity.insightId === older.insight.insightId
            ? new Promise(resolve => { finishValidation = resolve; }) : Promise.resolve(true);
        panelView.isOpen = true;
        const racingRead = orchestrator.openPanel();
        await flushAsyncWork();
        await internals.expandPanelToTab();
        const racingDetail = openPageletDetailView.mock.calls.at(-1)?.[0].reading;
        if (!racingDetail) throw new Error("Expected the second Detail reading payload");
        finishRead({ ...older, status: "cache-hit" });
        await flushAsyncWork();
        expect(finishValidation).toBeDefined();
        const newer = makeVerifiedDeepDiscoverResult("explicit", path);
        newer.insight = { ...newer.insight, insightId: "newer-than-cache", body: "The newly discovered reading." };
        newer.insights = [newer.insight];
        newer.collection.insights = newer.insights;
        internals.acceptDeepDiscoverResult(newer, { path, proactive: false });
        const accepted = racingDetail.getLatestCandidates()[0];
        expect(accepted?.id).toBe(newer.insight.insightId);
        const rendersBeforeValidation = panelView.open.mock.calls.length;
        finishValidation(true);
        await racingRead;
        expect(racingDetail.getLatestCandidates()).toEqual([accepted]);
        expect(racingDetail.getReadingControls().label).not.toContain("Checking available content");
        expect(panelView.open).toHaveBeenCalledTimes(rendersBeforeValidation);
        expect(panelView.isOpen).toBe(false);
    });

    it("keeps a result completed during empty Detail expansion reachable from that Detail snapshot", async () => {
        let finishOpen!: () => void;
        const openPageletDetailView = jest.fn<NonNullable<PageletHost["openPageletDetailView"]>>(
            () => new Promise<void>(resolve => { finishOpen = resolve; }),
        );
        const runDeepDiscover = jest.fn<NonNullable<PageletHost["runDeepDiscover"]>>();
        const host = makeHost({
            openPageletDetailView, runDeepDiscover,
            readDeepDiscover: async () => ({ status: "empty" }),
            getDeepDiscoverActivity: () => ({ phase: "running", requestId: "waiting-request" }),
        });
        const orchestrator = new PageletOrchestrator(host);
        const panelView = {
            currentLayoutType: "discover" as const,
            currentVisibleFindings: [], currentPanelExtra: undefined,
            open: jest.fn<PanelOpen>(), close: jest.fn(), isOpen: true,
        };
        const internals = orchestrator as unknown as {
            panelView: typeof panelView;
            expandPanelToTab(): Promise<void>;
            acceptDeepDiscoverResult(result: PageletDeepDiscoverControllerResult, options: { path: string; proactive: boolean }): unknown;
        };
        internals.panelView = panelView;
        await orchestrator.openPanel();
        const pending = internals.expandPanelToTab();
        const payload = openPageletDetailView.mock.calls[0]?.[0];
        expect(payload?.reading?.candidates).toEqual([]);
        const result = makeVerifiedDeepDiscoverResult();
        result.requestId = "waiting-request";
        internals.acceptDeepDiscoverResult(result, { path: "notes/current.md", proactive: false });
        finishOpen();
        await pending;
        expect(payload?.reading?.getLatestCandidates().map(candidate => candidate.id)).toEqual([result.insight.insightId]);
        expect(runDeepDiscover).not.toHaveBeenCalled();
    });

    it("B-176 keeps the Panel intact until the Detail target accepts the payload", async () => {
        let rejectOpen!: (error: Error) => void;
        const openPageletDetailView = jest.fn<NonNullable<PageletHost['openPageletDetailView']>>(() => new Promise((_resolve, reject) => { rejectOpen = reject; }));
        const orchestrator = new PageletOrchestrator(makeHost({ openPageletDetailView }));
        const panelView = {
            currentLayoutType: 'discover' as const,
            currentVisibleFindings: [{ title: 'Read me', description: 'Full body', insightText: 'Full body' }],
            currentPanelExtra: { sourcePath: 'notes/current.md' },
            close: jest.fn(), isOpen: true,
        };
        const internals = orchestrator as unknown as { panelView: typeof panelView; expandPanelToTab(): void | Promise<void> };
        internals.panelView = panelView;
        const pending = internals.expandPanelToTab();
        expect(panelView.close).not.toHaveBeenCalled();
        rejectOpen(new Error('leaf unavailable'));
        await pending;
        await flushAsyncWork();
        expect(panelView.close).not.toHaveBeenCalled();
    });

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
            patternDetectionNudgeAdmissionKey: string | null;
            onboardingNudgeAdmissionKey: string | null;
        };
        internals.patternDetectionNudgeAdmissionKey = "pattern:admitted";
        internals.onboardingNudgeAdmissionKey = "onboarding:admitted";

        orchestrator.getCommandCallbacks().onToggleProactiveHints();

        expect(internals.patternDetectionNudgeAdmissionKey).toBeNull();
        expect(internals.onboardingNudgeAdmissionKey).toBeNull();
        orchestrator.destroy();
    });



























    afterEach(() => { jest.useRealTimers(); });



















    it("suppresses open-note proactive preparation in Focus Mode", async () => {
        const host = makeHost();
        host.settings.pagelet.proactiveHints = true;
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

        orchestrator.destroy();
    });




});

describe("PageletOrchestrator review panel context flow", () => {

    it("adds current-scope Review Queue items through the host without starting provider work", () => {
        const listReviewQueueItems = jest.fn((filter: { scopePaths?: readonly string[] } = {}) => {
            return filter.scopePaths?.includes("notes/current.md")
                ? [makeReviewQueueItem()]
                : [];
        });
        const host = makeHost({ listReviewQueueItems });
        const orchestrator = new PageletOrchestrator(host);
        const panelView = { open: jest.fn() };
        (orchestrator as unknown as { panelView: typeof panelView }).panelView = panelView;

        (orchestrator as unknown as { handleExpandPanel(type: string): void }).handleExpandPanel("review");

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

        (orchestrator as unknown as { handleExpandPanel(type: string): void }).handleExpandPanel("review");

        expect(panelView.open).toHaveBeenCalledWith(
            "review",
            [],
            undefined,
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

        (orchestrator as unknown as { handleExpandPanel(type: string): void }).handleExpandPanel("review");

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

        (orchestrator as unknown as { handleExpandPanel(type: string): void }).handleExpandPanel("review");

        expect(panelView.open).toHaveBeenCalledWith(
            "review",
            [],
            undefined,
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
        source: "workspace" | "vault" | "metadata";
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
            source: "workspace" | "vault" | "metadata",
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
            metadataCache: {
                getFileCache: jest.fn(() => null),
                on: jest.fn((event: string, callback: (...args: unknown[]) => void) => (
                    record("metadata", event, callback)
                )),
            },
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

    it("detaches every feature event ref including create when the feature is disabled", () => {
        const harness = createLifecycleHarness();
        const orchestrator = harness.createOrchestrator();
        orchestrator.initialize();
        expect(harness.refs.map(ref => ref.event)).toContain("create");

        orchestrator.destroy();
        harness.releaseFeatureScope();

        expect(harness.refs.every(ref => ref.detached)).toBe(true);
        harness.releaseFeatureScope();
        expect(harness.refs.every(ref => ref.detached)).toBe(true);
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
            const panelView = { open: jest.fn<PanelOpen>(), close: jest.fn(), destroy: jest.fn(), isOpen: true };
            const state = orchestrator as unknown as {
                panelView: typeof panelView;
                openAgentInsightCandidate: PageletAgentDeliveryCandidate;
                acceptDeepDiscoverResult(result: PageletDeepDiscoverControllerResult, options: { path: string; proactive: boolean }): PageletAgentDeliveryCandidate;
                openAgentInsightPanel(candidate: PageletAgentDeliveryCandidate): void;
            };
            state.panelView = panelView;
            state.openAgentInsightPanel(state.acceptDeepDiscoverResult(makeVerifiedDeepDiscoverResult("explicit", "notes/open.md"), {
                path: "notes/open.md", proactive: false,
            }));

            const modify = harness.refs.find(({ event }) => event === "modify");
            modify?.callback(makeTFile("notes/current.md"));
            await jest.advanceTimersByTimeAsync(5_000);
            expect(harness.host.runDeepDiscover).toHaveBeenCalledWith({
                path: "notes/current.md",
                triggerReason: "edit-idle",
            });

            const deleted = harness.refs.find(({ event }) => event === "delete");
            deleted?.callback(makeTFile("notes/open.md"));
            expect(state.openAgentInsightCandidate.staleStatus).toBe("stale");
            expect(panelView.close).not.toHaveBeenCalled();
            orchestrator.destroy();
        } finally {
            jest.useRealTimers();
        }
    });

    it("clears retained reading when delayed metadata reveals a revoked source", async () => {
        const harness = createLifecycleHarness();
        const orchestrator = harness.createOrchestrator();
        orchestrator.initialize();
        try {
            const panelView = { open: jest.fn<PanelOpen>(), close: jest.fn(), destroy: jest.fn(), isOpen: true };
            const state = orchestrator as unknown as {
                panelView: typeof panelView;
                openAgentInsightCandidate: PageletAgentDeliveryCandidate | null;
                acceptDeepDiscoverResult(result: PageletDeepDiscoverControllerResult, options: { path: string; proactive: boolean }): PageletAgentDeliveryCandidate;
                openAgentInsightPanel(candidate: PageletAgentDeliveryCandidate): void;
            };
            state.panelView = panelView;
            const candidate = state.acceptDeepDiscoverResult(makeVerifiedDeepDiscoverResult("explicit", "notes/open.md"), {
                path: "notes/open.md", proactive: false,
            });
            state.openAgentInsightPanel(candidate);
            harness.host.validateDeepDiscoverInsight = jest.fn(async () => false);

            harness.refs.find(({ event }) => event === "modify")?.callback(makeTFile("notes/open.md"));
            await flushAsyncWork();
            expect(candidate.staleStatus).toBe("stale");
            expect(panelView.close).not.toHaveBeenCalled();

            harness.host.isPathAllowedForPagelet = path => path !== "notes/open.md";
            harness.refs.find(({ source, event }) => source === "metadata" && event === "changed")
                ?.callback(makeTFile("notes/open.md"));
            expect(candidate.staleStatus).toBe("boundary-changed");
            expect(state.openAgentInsightCandidate).toBeNull();
            expect(panelView.close).toHaveBeenCalledTimes(1);
        } finally {
            orchestrator.destroy();
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
            expect(harness.host.runDeepDiscover).not.toHaveBeenCalled();
            expect(panelView.close).not.toHaveBeenCalled();
            orchestrator.destroy();
        } finally {
            jest.useRealTimers();
        }
    });
});
