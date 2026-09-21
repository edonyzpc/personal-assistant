import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { TFile } from "obsidian";

import {
    QuietRecallPluginIntegration,
    QUIET_RECALL_CALL_LIMITS,
    type QuietRecallPluginIntegrationDependencies,
} from "../src/pagelet/plugin-quiet-recall";
import { PageletProviderCallAdmission } from "../src/pagelet/provider-call-admission";
import type { QuietRecallSettings } from "../src/settings";
import type { PageletSettings } from "../src/settings/pagelet";
import type { SavedInsight } from "../src/pa/saved-insight-store";
import type { PageletCostEntry } from "../src/pagelet/pa-review-cost";
import type { QuietRecallRunResult } from "../src/pa/quiet-recall";
import type { PaRelatedLinkResult } from "../src/pa/frontmatter-link";

type FakeFile = TFile;
type RelatedSearchOptions = Parameters<QuietRecallPluginIntegrationDependencies["findRelatedNotes"]>[3];

const notices: string[] = [];
jest.mock("obsidian", () => ({
    TFile: class MockTFile {
        path: string;
        extension = "md";
        basename: string;
        stat: { ctime: number; mtime: number; size: number };

        constructor(path: string) {
            this.path = path;
            this.basename = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
            this.stat = { ctime: 1_000, mtime: 1_000, size: 100 };
        }
    },
    Notice: class {
        constructor(message: string) { notices.push(message); }
    },
    normalizePath: (path: string) => path,
}));

const createFile = (path: string, size = 100): FakeFile => {
    const FileCtor = TFile as unknown as { new(path: string, size?: number): FakeFile };
    const file = new FileCtor(path);
    file.stat = { ctime: 1_000, mtime: 1_000, size };
    return file;
};

const ownerState = (owner: QuietRecallPluginIntegration) => owner as unknown as {
    evaluationCoordinator: unknown;
    evaluationPolicyIdentitySnapshot: string | null;
    lastRecallLlmEvalAt: number;
};

const candidateFixture = {
    id: "quiet-recall-candidate",
    title: "Related note",
    summary: "A related note may matter now.",
    sourceRefs: [{ path: "notes/related.md", evidenceStrength: "medium" as const }],
    whyNow: ["Related to the current note."],
    nextAction: "Compare the notes.",
    relation: "related" as const,
    score: 0.9,
    generatedAt: "2026-07-10T08:00:00.000Z",
};

const createHarness = (options: {
    currentContent?: string;
    relatedContent?: string;
    semanticReady?: boolean;
    invoke?: (prompt: string) => Promise<unknown>;
} = {}) => {
    const activeFile = createFile("notes/current.md");
    const relatedFile = createFile("notes/related.md", 120);
    const currentContent = options.currentContent
        ?? "# Current\n\nShould we keep the Redis cache?";
    const relatedContent = options.relatedContent
        ?? "# Redis decision\n\n## Benchmarks\n\nThe previous benchmark supports keeping Redis.";
    const files = [activeFile, relatedFile];
    const settings = {
        provider: "openai",
        providerPreset: "openai",
        model: "gpt-4o-mini",
        embeddingModel: "text-embedding-3-small",
        endpoint: "https://api.openai.com/v1",
        quietRecall: { enabled: true, bubbleNudgesEnabled: true } as QuietRecallSettings,
        pagelet: {
            enabled: true,
            temperature: 0.2,
            maxOutputTokens: 2_000,
            outputLanguage: "en",
            reviewsFolder: ".pagelet",
            excludedFolders: [],
            excludedTags: [],
            excludedPatterns: [],
        } as Pick<PageletSettings, "enabled" | "temperature" | "maxOutputTokens" | "outputLanguage" | "reviewsFolder" | "excludedFolders" | "excludedTags" | "excludedPatterns">,
        retrievalHabitProfile: { enabled: false, state: { aggregates: [] } },
        savedInsights: [],
    };
    const source = {
        isPageletProviderSourceAllowedFile: jest.fn(() => true),
        isPageletProviderPathAllowed: jest.fn(() => true),
        isDataBoundaryAllowedPath: jest.fn(() => true),
        getDataBoundaryTags: jest.fn(() => []),
        getLatestPageletContentBoundary: jest.fn(() => ({
            allowed: true,
            tags: [],
            isGenerated: false,
        })),
    } as QuietRecallPluginIntegrationDependencies["source"];
    const providerCalls: string[] = [];
    const providerCallAdmission = new PageletProviderCallAdmission({
        isFirstUseNotified: () => false,
        markFirstUseNotified: () => { settings.pagelet.enabled = true; },
        showStandardFirstUseNotice: () => { notices.push("first-use"); },
    });
    const costTracker = { record: jest.fn((): PageletCostEntry | null => null) };
    const findRelatedNotes = jest.fn(async (
        _activePath: string,
        _contents: Array<{ path: string; content: string }>,
        _excludedPaths: string[],
        searchOptions: Parameters<QuietRecallPluginIntegrationDependencies["findRelatedNotes"]>[3],
    ) => {
        const reservation = await searchOptions.reserveProviderCall();
        if (!reservation || reservation === true) throw new Error("reservation missing");
        reservation.commit();
        searchOptions.onProviderInvoke?.();
        searchOptions.onSearchOutcome?.("completed");
        return [{
            path: relatedFile.path,
            content: relatedContent,
            score: 0.95,
        }];
    });
    const dependencies: QuietRecallPluginIntegrationDependencies = {
        app: {
            workspace: { getActiveFile: () => activeFile },
            vault: {
                read: async (file: FakeFile) => file.path === activeFile.path ? currentContent : relatedContent,
                cachedRead: async (file: FakeFile) => file.path === activeFile.path ? currentContent : relatedContent,
                getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
                getMarkdownFiles: () => files,
            },
            metadataCache: {
                resolvedLinks: { "notes/current.md": { "notes/related.md": 1 } },
                getFileCache: () => null,
            },
        },
        source,
        getSettings: () => settings,
        getLocale: () => "en",
        getDataBoundaryFingerprint: () => "data_boundary:test",
        isRuntimeCurrent: () => true,
        isMemorySearchReady: async () => options.semanticReady ?? true,
        findRelatedNotes,
        getGraphDiscoveryBacklinkMap: () => new Map(),
        getResolvedOutgoingLinks: () => relatedFile.path ? [relatedFile.path] : [],
        getGraphDiscoveryLinks: () => [],
        getProviderCallAdmission: () => providerCallAdmission,
        getCostTracker: () => costTracker,
        createRateLimitStorage: () => ({
            state: null as never,
            load: () => null,
            save: () => undefined,
        }),
        getVaultStorageScope: () => "test-vault",
        getRateLimitStorageKey: (scope) => `quiet-recall:${scope}`,
        getAISetupIssue: () => null,
        createModel: async () => ({
            invoke: options.invoke ?? (async (prompt: string) => {
                providerCalls.push(prompt);
                return JSON.stringify({
                    isConvincing: true,
                    whyNow: "The older benchmark directly informs the current cache decision.",
                });
            }),
        }),
        listSavedInsights: () => [],
        createSavedInsight: jest.fn(async (): Promise<{ ok: true; value: SavedInsight }> => ({
            ok: true,
            value: { id: "saved" } as SavedInsight,
        })),
        confirmLink: jest.fn(async () => true),
        addRelatedLink: jest.fn(async (): Promise<PaRelatedLinkResult> => ({ ok: true, changed: true })),
        recordFeedback: jest.fn(async () => ({ ok: true as const, state: { aggregates: [] } })),
        log: jest.fn(),
    };
    return {
        owner: new QuietRecallPluginIntegration(dependencies),
        dependencies,
        settings,
        activeFile,
        relatedFile,
        files,
        providerCalls,
        costTracker,
        source,
    };
};

describe("QuietRecallPluginIntegration", () => {
    afterEach(() => {
        notices.length = 0;
        jest.useRealTimers();
    });

    it("runs a normal semantic round with live reads, two reservations, and one accepted candidate", async () => {
        const harness = createHarness();
        const result = await harness.owner.runQuietRecall();

        expect(result.candidates).toHaveLength(1);
        expect(result.evaluationDiagnostics).toEqual(expect.objectContaining({
            providerCalls: 1,
            semanticRetrievalCalls: 1,
            totalProviderCalls: 2,
            initialCalls: 1,
        }));
        expect(harness.providerCalls[0]).toContain("The previous benchmark supports keeping Redis.");
        expect(notices.filter((message) => message === "first-use")).toHaveLength(1);
        expect(harness.dependencies.source.isPageletProviderSourceAllowedFile)
            .toHaveBeenCalledWith(harness.relatedFile);
    });

    it("returns a local no-candidate result without constructing or invoking a model", async () => {
        const harness = createHarness({
            currentContent: "# Current\n\nWhat should I cook for dinner?",
            relatedContent: "# unrelated\n\nA list of projectors.",
        });
        const createModel = jest.fn(async () => ({ invoke: jest.fn() }));
        harness.dependencies.createModel = createModel;
        harness.dependencies.findRelatedNotes = jest.fn(async (
            _activePath,
            _contents,
            _excludedPaths,
            searchOptions: RelatedSearchOptions,
        ) => {
            searchOptions.onSearchOutcome?.("completed");
            return [];
        });

        const result = await harness.owner.runQuietRecall();

        expect(result.candidates).toHaveLength(0);
        expect(result.evaluationDiagnostics).toBeUndefined();
        expect(createModel).not.toHaveBeenCalled();
    });

    it("blocks evaluation without a model and leaves first-use/cost untouched", async () => {
        const harness = createHarness();
        harness.dependencies.createModel = async () => null;

        const result = await harness.owner.runQuietRecall();

        expect(result.candidates).toHaveLength(0);
        expect(result.evaluationDiagnostics?.blockedReason).toBe("provider_unavailable");
        expect(harness.costTracker.record).toHaveBeenCalledTimes(1);
        expect(notices).toEqual([]);
    });

    it("reports a budget block when the domain limiter rejects the provisional lease", async () => {
        const harness = createHarness();
        harness.owner.getRateLimiter = jest.fn(() => ({
            reserveLeaseIf: async () => ({ ok: false as const, reason: "hr-cap" as const }),
        }) as never);

        const result = await harness.owner.reserveQuietRecallProviderCall({
            roundStarted: false,
            revalidate: () => true,
        });

        expect(result).toEqual({ ok: false, reason: "budget" });
        expect(harness.costTracker.record).not.toHaveBeenCalled();
    });

    it("holds the first-round admission claim until commit and applies cooldown", async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-07-18T12:00:00Z"));
        const harness = createHarness();
        const first = await harness.owner.reserveQuietRecallProviderCall({
            roundStarted: false,
            revalidate: () => true,
        });
        expect(first.ok).toBe(true);

        let secondSettled = false;
        const secondPending = harness.owner.reserveQuietRecallProviderCall({
            roundStarted: false,
            revalidate: () => true,
        }).then((decision) => {
            secondSettled = true;
            return decision;
        });
        await Promise.resolve();
        expect(secondSettled).toBe(false);
        if (first.ok) first.reservation.commit();

        await expect(secondPending).resolves.toEqual({ ok: false, reason: "cooldown" });
    });

    it("releases the first-round claim after rollback so the waiter can reserve again", async () => {
        const harness = createHarness();
        const first = await harness.owner.reserveQuietRecallProviderCall({
            roundStarted: false,
            revalidate: () => true,
        });
        expect(first.ok).toBe(true);
        const secondPending = harness.owner.reserveQuietRecallProviderCall({
            roundStarted: false,
            revalidate: () => true,
        });
        if (first.ok) await first.reservation.rollback();

        await expect(secondPending).resolves.toEqual(expect.objectContaining({ ok: true }));
    });

    it("falls back to metadata collection when semantic search is unavailable", async () => {
        const harness = createHarness({ semanticReady: false });
        const result = await harness.owner.runQuietRecall();

        expect(harness.dependencies.findRelatedNotes).not.toHaveBeenCalled();
        expect((result.discoverCandidates ?? result.candidates).length).toBeGreaterThan(0);
        expect(result.evaluationDiagnostics).toBeUndefined();
    });

    it("retains retrieval diagnostics but rejects evaluation after active-source drift", async () => {
        const harness = createHarness();
        harness.dependencies.findRelatedNotes = jest.fn(async (
            _activePath,
            _contents,
            _excludedPaths,
            searchOptions: RelatedSearchOptions,
        ) => {
            const reservation = await searchOptions.reserveProviderCall();
            if (!reservation || reservation === true) throw new Error("reservation missing");
            reservation.commit();
            searchOptions.onProviderInvoke?.();
            harness.activeFile.stat.mtime += 1;
            searchOptions.onSearchOutcome?.("completed");
            return [{ path: harness.relatedFile.path, content: "related", score: 0.95 }];
        });

        const result = await harness.owner.runQuietRecall();

        expect(result.candidates).toHaveLength(0);
        expect(result.evaluationDiagnostics).toEqual(expect.objectContaining({
            semanticRetrievalCalls: 1,
            blockedReason: "invalid_context",
        }));
    });

    it("validates every captured source, including one never displayed", () => {
        const harness = createHarness();
        const unshown = createFile("notes/unshown.md", 80);
        harness.files.push(unshown);
        const base = {
            currentPath: harness.activeFile.path,
            candidates: [candidateFixture],
            sourcePaths: [harness.activeFile.path, harness.relatedFile.path, unshown.path],
            sourceSnapshotId: "snapshot",
            dataBoundarySnapshotId: "data_boundary:test",
            evaluationPolicySnapshotId: harness.owner.getPolicyIdentity(),
        };
        const snapshotId = harness.owner.buildQuietRecallRunSourceSnapshotId(
            base.currentPath,
            base.candidates,
            base.sourcePaths,
        );
        expect(harness.owner.isQuietRecallRunCurrent({
            ...base,
            sourceSnapshotId: snapshotId ?? "",
        } as QuietRecallRunResult))
            .toBe(true);

        unshown.stat.mtime += 1;
        expect(harness.owner.isQuietRecallRunCurrent({
            ...base,
            sourceSnapshotId: snapshotId ?? "",
        } as QuietRecallRunResult))
            .toBe(false);
    });

    it("retries one wrong-language response and attributes both real calls", async () => {
        let call = 0;
        const harness = createHarness({
            invoke: async () => {
                call += 1;
                return call === 1
                    ? JSON.stringify({ isConvincing: true, whyNow: "这条旧基准..." })
                    : JSON.stringify({
                        isConvincing: true,
                        whyNow: "The older benchmark directly informs the current decision.",
                    });
            },
        });

        const result = await harness.owner.runQuietRecall();

        expect(call).toBe(2);
        expect(result.evaluationDiagnostics).toEqual(expect.objectContaining({
            providerCalls: 2,
            initialCalls: 1,
            languageRetryCalls: 1,
        }));
    });

    it("times out a provider call at twenty seconds and keeps the committed slot", async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-07-18T12:00:00Z"));
        const harness = createHarness({
            invoke: () => new Promise<never>(() => undefined),
        });

        const pending = harness.owner.runQuietRecall();
        await jest.advanceTimersByTimeAsync(20_000);
        const result = await pending;

        expect(result.evaluationDiagnostics?.attempts[0]).toEqual(expect.objectContaining({
            outcome: "rejected",
            reason: "timeout",
        }));
        expect(ownerState(harness.owner).lastRecallLlmEvalAt).toBe(Date.now() - 20_000);
    });

    it("maps a provider error to a rejected evaluation without a refund", async () => {
        const harness = createHarness({
            invoke: async () => { throw new Error("provider unavailable"); },
        });

        const result = await harness.owner.runQuietRecall();

        expect(result.evaluationDiagnostics?.attempts[0]).toEqual(expect.objectContaining({
            outcome: "rejected",
            reason: "provider_error",
        }));
        expect(ownerState(harness.owner).lastRecallLlmEvalAt).toBeGreaterThan(0);
    });

    it("saves through the existing Saved Insight action and records accept feedback", async () => {
        const harness = createHarness();
        await harness.owner.saveQuietRecallAsInsight(candidateFixture);

        expect(harness.dependencies.createSavedInsight).toHaveBeenCalled();
        expect(harness.dependencies.recordFeedback).toHaveBeenCalledWith(candidateFixture, "accept");
    });

    it("links through the existing confirm/write actions and records local feedback", async () => {
        const harness = createHarness();
        const result = await harness.owner.linkQuietRecallCandidateFromActiveNote(candidateFixture);

        expect(result.ok).toBe(true);
        expect(harness.dependencies.confirmLink).toHaveBeenCalled();
        expect(harness.dependencies.addRelatedLink).toHaveBeenCalledWith(
            "notes/current.md",
            "notes/related.md",
        );
        expect(harness.dependencies.recordFeedback).toHaveBeenCalled();
    });

    it("uses one domain limiter with the existing bucket, scope, caps, and snapshot", async () => {
        const harness = createHarness();
        const first = harness.owner.getRateLimiter();
        expect(harness.owner.getRateLimiter()).toBe(first);
        const snapshot = await harness.owner.getFeatureRateSnapshot();
        expect(snapshot).toEqual(expect.objectContaining({
            hourlyCap: QUIET_RECALL_CALL_LIMITS.hourly,
            dailyCap: QUIET_RECALL_CALL_LIMITS.daily,
            hourlyUsed: 0,
            dailyUsed: 0,
        }));
    });

    it("clears old coordinators across policy A-to-B-to-A and replaces late-result ownership", () => {
        const harness = createHarness();
        const state = ownerState(harness.owner);
        const coordinatorA = { clear: jest.fn() };
        state.evaluationCoordinator = coordinatorA;
        harness.owner.syncPolicyIdentity();
        expect(coordinatorA.clear).not.toHaveBeenCalled();

        harness.settings.provider = "other";
        harness.owner.syncPolicyIdentity();
        expect(coordinatorA.clear).toHaveBeenCalledTimes(1);
        expect(state.evaluationCoordinator).toBeNull();
        const replacement = harness.owner.getEvaluationCoordinator();
        expect(replacement).not.toBe(coordinatorA);

        const coordinatorB = { clear: jest.fn() };
        state.evaluationCoordinator = coordinatorB;
        harness.settings.provider = "openai";
        harness.owner.syncPolicyIdentity();
        expect(coordinatorB.clear).toHaveBeenCalledTimes(1);
        expect(harness.owner.getEvaluationCoordinator()).not.toBe(coordinatorB);
    });

    it("disposes only domain state while shared admission and cost instances remain external", async () => {
        const harness = createHarness();
        const state = ownerState(harness.owner);
        const limiter = harness.owner.getRateLimiter();
        const coordinator = harness.owner.getEvaluationCoordinator();
        state.lastRecallLlmEvalAt = 123;

        harness.owner.dispose();

        expect(coordinator).toBeDefined();
        expect(state.evaluationCoordinator).toBeNull();
        expect(state.evaluationPolicyIdentitySnapshot).toBeNull();
        expect(state.lastRecallLlmEvalAt).toBe(0);
        expect(harness.owner.getRateLimiter()).not.toBe(limiter);
        expect(harness.dependencies.getProviderCallAdmission()).toBe(harness.dependencies.getProviderCallAdmission());
    });
});
