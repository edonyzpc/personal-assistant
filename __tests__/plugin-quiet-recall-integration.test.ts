import { describe, expect, it, jest } from "@jest/globals";
import { TFile } from "obsidian";

import {
    QuietRecallPluginIntegration,
    QUIET_RECALL_CALL_LIMITS,
    type QuietRecallPluginIntegrationDependencies,
} from "../src/pagelet/plugin-quiet-recall";
import type { QuietRecallCandidate } from "../src/pa/quiet-recall";

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
    Notice: class {},
    normalizePath: (path: string) => path,
}));

const createFile = (path: string, size = 100): TFile => {
    const FileCtor = TFile as unknown as { new(path: string, size?: number): TFile };
    const file = new FileCtor(path);
    file.stat = { ctime: 1_000, mtime: 1_000, size };
    return file;
};

const candidate: QuietRecallCandidate = {
    id: "quiet-recall-candidate",
    title: "Related note",
    summary: "A related note may matter now.",
    sourceRefs: [{ path: "notes/related.md", evidenceStrength: "medium" }],
    whyNow: ["Related to the current note."],
    nextAction: "Compare the notes.",
    relation: "related",
    score: 0.9,
    generatedAt: "2026-07-10T08:00:00.000Z",
};

const createHarness = () => {
    const activeFile = createFile("notes/current.md");
    const relatedFile = createFile("notes/related.md", 120);
    const files = new Map([
        [activeFile.path, activeFile],
        [relatedFile.path, relatedFile],
    ]);
    const dependencies: QuietRecallPluginIntegrationDependencies = {
        app: {
            workspace: { getActiveFile: () => activeFile },
            vault: {
                read: jest.fn(async (file: TFile) => (
                    file.path === activeFile.path ? "# Current" : "# Related"
                )),
                cachedRead: jest.fn(async (file: TFile) => (
                    file.path === activeFile.path ? "# Current" : "# Related"
                )),
                getAbstractFileByPath: (path: string) => files.get(path) ?? null,
                getMarkdownFiles: () => [...files.values()],
            },
            metadataCache: { getFileCache: () => null, resolvedLinks: {} },
        },
        source: {
            isPageletProviderSourceAllowedFile: jest.fn(() => true),
            isPageletProviderPathAllowed: jest.fn(() => true),
            isDataBoundaryAllowedPath: jest.fn(() => true),
            getDataBoundaryTags: jest.fn(() => []),
            getLatestPageletContentBoundary: jest.fn(() => ({
                allowed: true,
                tags: [],
                isGenerated: false,
            })),
        },
        getSettings: () => ({
            provider: "openai",
            providerPreset: "openai",
            model: "model",
            embeddingModel: "embedding",
            endpoint: "endpoint",
            quietRecall: { enabled: true, bubbleNudgesEnabled: true, quietRecallMode: "on" },
            pagelet: {
                enabled: true,
                temperature: 0.2,
                maxOutputTokens: 2_000,
                outputLanguage: "auto",
                reviewsFolder: ".pagelet",
                excludedFolders: [],
                excludedTags: [],
                excludedPatterns: [],
            },
            retrievalHabitProfile: { enabled: false, state: { aggregates: [] } },
            savedInsights: [],
        }),
        getLocale: () => "en",
        getDataBoundaryFingerprint: () => "boundary",
        isRuntimeCurrent: () => true,
        isMemorySearchReady: jest.fn(async () => false),
        findRelatedNotes: jest.fn(async () => []),
        getGraphDiscoveryBacklinkMap: () => new Map(),
        getResolvedOutgoingLinks: () => [],
        getGraphDiscoveryLinks: () => [],
        createRateLimitStorage: jest.fn(() => ({ load: () => null, save: () => undefined })),
        getVaultStorageScope: () => "vault",
        getRateLimitStorageKey: (scope: string | null) => `quiet-recall:${scope}`,
        listSavedInsights: () => [],
        createSavedInsight: jest.fn(async () => ({
            ok: true as const,
            value: {
                id: "saved",
                text: "saved",
                sourceRefs: [],
                scope: { paths: [] },
                status: "active" as const,
                createdAt: "2026-07-10T08:00:00.000Z",
                updatedAt: "2026-07-10T08:00:00.000Z",
            },
        })) as never,
        confirmLink: jest.fn(async () => true),
        addRelatedLink: jest.fn(async () => ({ ok: true as const })) as never,
        recordFeedback: jest.fn(async () => ({ ok: true as const })) as never,
        log: jest.fn(),
    };
    return { dependencies, owner: new QuietRecallPluginIntegration(dependencies), relatedFile };
};

describe("QuietRecallPluginIntegration retained capabilities", () => {
    it("keeps the legacy provider-call status reader bucket without an evaluator", async () => {
        const { owner } = createHarness();
        const limiter = owner.getRateLimiter();

        expect(owner.getRateLimiter()).toBe(limiter);
        await expect(owner.getFeatureRateSnapshot()).resolves.toEqual(expect.objectContaining({
            hourlyCap: QUIET_RECALL_CALL_LIMITS.hourly,
            dailyCap: QUIET_RECALL_CALL_LIMITS.daily,
            hourlyUsed: 0,
            dailyUsed: 0,
        }));
    });

    it("re-reads and validates every related source before returning semantic candidates", async () => {
        const { owner } = createHarness();
        const collection = await owner.collectQuietRecallVaultNotesFromRelatedNotes([
            { path: "notes/related.md", content: "# Stale ranking copy" },
        ]);

        expect(collection.retrievalMode).toBe("semantic");
        expect(collection.vaultNotes).toHaveLength(1);
        expect(collection.sourceSnapshots).toEqual([
            { path: "notes/related.md", mtime: 1_000, size: 120 },
        ]);
        expect(owner.quietRecallSourceSnapshotsAreCurrent(collection.sourceSnapshots ?? [])).toBe(true);
    });

    it("rejects a captured related source after identity drift", async () => {
        const { owner, relatedFile } = createHarness();
        const collection = await owner.collectQuietRecallVaultNotesFromRelatedNotes([
            { path: "notes/related.md", content: "# Related" },
        ]);

        relatedFile.stat.mtime += 1;
        expect(owner.quietRecallSourceSnapshotsAreCurrent(collection.sourceSnapshots ?? [])).toBe(false);
    });

    it("keeps Saved Insight, link, and feedback compatibility actions", async () => {
        const { dependencies, owner } = createHarness();

        await expect(owner.saveQuietRecallAsInsight(candidate)).resolves.toEqual(
            expect.objectContaining({ ok: true }),
        );
        await expect(owner.linkQuietRecallCandidateFromActiveNote(candidate)).resolves.toEqual(
            expect.objectContaining({ ok: true }),
        );
        expect(dependencies.createSavedInsight).toHaveBeenCalled();
        expect(dependencies.recordFeedback).toHaveBeenCalledWith(candidate, "accept");
        expect(dependencies.addRelatedLink).toHaveBeenCalledWith(
            "notes/current.md",
            "notes/related.md",
        );
    });
});
