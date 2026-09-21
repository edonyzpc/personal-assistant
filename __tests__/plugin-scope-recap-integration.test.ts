import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { TFile } from "obsidian";

import {
    ScopeRecapPluginIntegration,
    SCOPE_RECAP_CALL_LIMITS,
    type ScopeRecapPluginIntegrationDependencies,
} from "../src/pagelet/plugin-scope-recap";
import { PageletProviderCallAdmission } from "../src/pagelet/provider-call-admission";
import type { PageletCostRecordInput } from "../src/pagelet/pa-review-cost";

type FakeFile = TFile;
type FakeResolver = { id: "resolver" };
type ScopeSource = ScopeRecapPluginIntegrationDependencies["source"];

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

const createFile = (path: string, mtime = 1_000, size = 100): FakeFile => {
    const FileCtor = TFile as unknown as { new(path: string): FakeFile };
    const file = new FileCtor(path);
    file.stat = { ctime: mtime, mtime, size };
    return file;
};

const validRecapResponse = () => JSON.stringify([{
    title: "The plan and pause decision now conflict",
    summary: "Current commits to ship while Related records a pause for the same feature.",
    whyItMatters: "The owner should resolve the conflict before the next release step.",
    sourceNoteTitles: ["Current", "Related"],
    section: "tension",
}]);

const createHarness = (options: {
    invoke?: (prompt: string) => Promise<unknown> | unknown;
    includeExcluded?: boolean;
} = {}) => {
    const activeFile = createFile("Projects/PA/Current.md", 2_000);
    const relatedFile = createFile("Projects/PA/Related.md", 1_900);
    const pageletExcluded = createFile("Projects/PA/pagelet-secret.md", 1_800);
    const boundaryExcluded = createFile("Projects/PA/boundary-secret.md", 1_700);
    const files = options.includeExcluded === false
        ? [activeFile, relatedFile]
        : [activeFile, relatedFile, pageletExcluded, boundaryExcluded];
    const contents = new Map([
        [activeFile.path, "# Current\n\nShould we keep the Redis cache?"],
        [relatedFile.path, "# Related\n\nThe previous benchmark supports keeping Redis."],
        [pageletExcluded.path, "# Pagelet secret\n\nPAGELET-SECRET-PAYLOAD"],
        [boundaryExcluded.path, "# Boundary secret\n\nBOUNDARY-SECRET-PAYLOAD"],
    ]);
    const resolver: FakeResolver = { id: "resolver" };
    const settings = {
        provider: "openai",
        providerPreset: "openai" as string | null,
        model: "gpt-4o-mini",
        embeddingModel: "text-embedding-3-small",
        endpoint: "https://api.openai.com/v1",
        pagelet: {
            enabled: true,
            temperature: 0.2,
            maxOutputTokens: 2_000,
            outputLanguage: "en" as const,
            reviewsFolder: ".pagelet",
            excludedFolders: [],
            excludedTags: [],
            excludedPatterns: ["pagelet-secret"],
            scopeRecapPreparationEnabled: true,
            scopeRecapBackgroundAuthorization: "authorized-v1" as const,
        },
        mergedPagelet: {
            reviewsFolder: ".pagelet",
            excludedFolders: ["pagelet-secret"],
            excludedTags: ["boundary-private"],
            excludedPatterns: [],
        },
    };
    let runtimeCurrent = true;
    const source: ScopeSource = {
        createPageletProviderSourceResolver: jest.fn(() => resolver as never),
        isPageletProviderSourceAllowedByResolver: jest.fn((file: FakeFile) => (
            file !== pageletExcluded && file !== boundaryExcluded
        )),
        getDataBoundaryTags: jest.fn((file: FakeFile) => (
            file === boundaryExcluded ? ["boundary-private"] : []
        )),
        isGeneratedDataBoundaryFile: jest.fn(() => false),
        getLatestPageletContentBoundary: jest.fn((_path: string, content: string) => ({
            allowed: !content.includes("BOUNDARY-SECRET-PAYLOAD"),
            tags: [] as string[],
            isGenerated: false,
        })),
    };
    const providerCalls: string[] = [];
    const createModel = jest.fn(async (
        _temperature: number,
        _options: { maxTokens: number; qwenRequestOptions?: { enableThinking: false } },
    ) => ({
        invoke: options.invoke ?? ((prompt: string) => {
            providerCalls.push(prompt);
            return Promise.resolve(validRecapResponse());
        }),
    }));
    const costEntries: unknown[] = [];
    const dependencies: ScopeRecapPluginIntegrationDependencies = {
        app: {
            workspace: { getActiveFile: () => activeFile },
            vault: {
                getMarkdownFiles: () => files,
                getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
                cachedRead: async (file: FakeFile) => contents.get(file.path) ?? "",
            },
        },
        source,
        getSettings: () => settings,
        getDataBoundaryFingerprint: () => "data_boundary:test",
        isRuntimeCurrent: () => runtimeCurrent,
        getProviderCallAdmission: () => providerCallAdmission,
        getCostTracker: () => ({
            record: (entry: PageletCostRecordInput) => {
                costEntries.push(entry);
                return {
                    inputTokens: 100,
                    outputTokens: 20,
                    totalTokens: 120,
                    estimatedCost: 0.001,
                    currency: "USD",
                    pricingKnown: true,
                    at: 1_000,
                };
            },
        }),
        createRateLimitStorage: () => ({
            load: () => null,
            save: () => undefined,
        }),
        getVaultStorageScope: () => "test-vault",
        getRateLimitStorageKey: (scope) => `scope-recap:${scope}`,
        createModel,
        log: jest.fn(),
    };
    const providerCallAdmission = new PageletProviderCallAdmission({
        isFirstUseNotified: () => false,
        markFirstUseNotified: () => undefined,
        showStandardFirstUseNotice: () => notices.push("first-use"),
    });
    return {
        owner: new ScopeRecapPluginIntegration(dependencies),
        dependencies,
        settings,
        activeFile,
        relatedFile,
        pageletExcluded,
        boundaryExcluded,
        files,
        contents,
        source,
        createModel,
        providerCalls,
        costEntries,
        setRuntimeCurrent(value: boolean) { runtimeCurrent = value; },
    };
};

describe("ScopeRecapPluginIntegration", () => {
    afterEach(() => {
        notices.length = 0;
        jest.useRealTimers();
    });

    it("collects the active folder, filters excluded sources, and prepares a ready artifact", async () => {
        const harness = createHarness();
        const result = await harness.owner.runScopeRecap({ mode: "background" });

        expect(result.status).toBe("ready");
        expect(result.artifact?.providerInfo).toEqual({
            provider: "openai",
            model: "gpt-4o-mini",
            endpoint: "https://api.openai.com/v1",
        });
        expect(harness.providerCalls[0]).toContain("The previous benchmark supports keeping Redis.");
        expect(harness.providerCalls[0]).not.toContain("PAGELET-SECRET-PAYLOAD");
        expect(harness.providerCalls[0]).not.toContain("BOUNDARY-SECRET-PAYLOAD");
        expect(notices.filter((message) => message === "first-use")).toHaveLength(1);
    });

    it("keeps excluded/out-of-scope metadata out of provider content and counts full folder coverage", async () => {
        const harness = createHarness();
        const extra = Array.from({ length: 12 }, (_, index) => createFile(
            `Projects/PA/Extra-${String(index + 1).padStart(2, "0")}.md`,
            1_000 - index,
        ));
        extra.forEach((file, index) => harness.contents.set(file.path, `Extra ${index} evidence.`));
        harness.files.push(...extra);
        harness.dependencies.app.vault.getMarkdownFiles = () => harness.files;

        const result = await harness.owner.runScopeRecap({ mode: "background" });

        expect(result.localOverview?.sourceCoverage).toEqual({
            totalSourceCount: 16,
            includedSourceCount: 12,
            skippedSourceCount: 4,
            coverageRatio: 0.75,
        });
        expect(harness.providerCalls[0]).not.toContain("Extra-12");
    });

    it("rejects before model setup when the background runtime gate is disabled", async () => {
        const harness = createHarness();
        harness.settings.pagelet.scopeRecapPreparationEnabled = false;

        const result = await harness.owner.runScopeRecap({ mode: "background" });

        expect(result.status).toBe("no_reliable_insight");
        expect(result.attempt).toMatchObject({
            outcome: "quality_rejected",
            providerCallMade: false,
        });
        expect(harness.createModel).not.toHaveBeenCalled();
        expect(notices).toEqual([]);
    });

    it("returns provider unavailable without first-use or cost when model setup returns null", async () => {
        const harness = createHarness();
        harness.dependencies.createModel = async () => null;

        const result = await harness.owner.runScopeRecap({ mode: "background" });

        expect(result.status).toBe("no_reliable_insight");
        expect(result.attempt.providerCallMade).toBe(false);
        expect(harness.costEntries).toHaveLength(0);
        expect(notices).toEqual([]);
    });

    it("blocks before shared first-use when the domain limiter rejects the lease", async () => {
        const harness = createHarness();
        harness.owner.getRateLimiter = jest.fn(() => ({
            reserveLeaseIf: async () => ({ ok: false as const, reason: "hr-cap" as const }),
        }) as never);

        const result = await harness.owner.runScopeRecap({ mode: "background" });

        expect(result.attempt).toMatchObject({
            outcome: "budget_blocked",
            providerCallMade: false,
        });
        expect(harness.providerCalls).toHaveLength(0);
        expect(notices).toEqual([]);
    });

    it("classifies provider errors and keeps the committed attempt attributed", async () => {
        const harness = createHarness({
            invoke: async () => { throw new Error("provider unavailable"); },
        });

        const result = await harness.owner.runScopeRecap({ mode: "background" });

        expect(result.attempt).toMatchObject({
            outcome: "provider_error",
            providerCallMade: true,
        });
        expect(harness.costEntries).toHaveLength(1);
    });

    it("times out a provider call at sixty seconds without a refund", async () => {
        jest.useFakeTimers();
        const harness = createHarness({
            invoke: () => new Promise<never>(() => undefined),
        });
        const pending = harness.owner.runScopeRecap({ mode: "background" });
        await jest.advanceTimersByTimeAsync(60_000);
        const result = await pending;

        expect(result.attempt).toMatchObject({
            outcome: "timeout",
            providerCallMade: true,
        });
    });

    it("classifies an empty final answer separately from reasoning content", async () => {
        const harness = createHarness({
            invoke: async () => ({
                content: "",
                additional_kwargs: { reasoning_content: "provider reasoning" },
            }),
        });
        const result = await harness.owner.runScopeRecap({ mode: "background" });

        expect(result.attempt).toMatchObject({
            outcome: "empty",
            providerCallMade: true,
        });
    });

    it("classifies non-empty invalid JSON as malformed", async () => {
        const harness = createHarness({ invoke: async () => "not json" });
        const result = await harness.owner.runScopeRecap({ mode: "background" });

        expect(result.attempt).toMatchObject({
            outcome: "malformed",
            providerCallMade: true,
        });
    });

    it("rejects an expected source, boundary, or authorization identity before provider work", async () => {
        const harness = createHarness();
        const sourceSnapshotId = (await harness.owner.buildScopeRecapLocalOverview()).sourceSnapshotId;
        const identities = [
            { expectedSourceSnapshotId: "stale-source" },
            { expectedDataBoundarySnapshotId: "stale-boundary" },
            { expectedAuthorizationContextId: "stale-auth" },
        ];
        for (const identity of identities) {
            const result = await harness.owner.runScopeRecap({
                mode: "background",
                expectedSourceSnapshotId: sourceSnapshotId,
                expectedDataBoundarySnapshotId: "data_boundary:test",
                ...identity,
            });
            expect(result.attempt).toMatchObject({
                outcome: "quality_rejected",
                providerCallMade: false,
            });
        }
        expect(harness.createModel).not.toHaveBeenCalled();
    });

    it("re-collects complete source identity at the provider boundary and rejects content drift", async () => {
        const harness = createHarness();
        const originalRead = harness.dependencies.app.vault.cachedRead;
        let mutated = false;
        harness.dependencies.app.vault.cachedRead = async (file: FakeFile) => {
            const content = await originalRead(file);
            if (mutated && file === harness.relatedFile) harness.relatedFile.stat.mtime += 1;
            return content;
        };
        const snapshotId = (await harness.owner.buildScopeRecapLocalOverview()).sourceSnapshotId;
        harness.dependencies.createModel = async () => {
            mutated = true;
            return { invoke: async () => validRecapResponse() };
        };

        const result = await harness.owner.runScopeRecap({
            mode: "background",
            expectedSourceSnapshotId: snapshotId,
        });

        expect(result.attempt).toMatchObject({
            outcome: "quality_rejected",
            providerCallMade: false,
        });
        expect(harness.providerCalls).toHaveLength(0);
        expect(notices).toEqual([]);
    });

    it("rolls back a provisional lease when source identity drifts after reservation", async () => {
        const harness = createHarness();
        const rollback = jest.fn(async () => undefined);
        const commit = jest.fn();
        harness.owner.getRateLimiter = jest.fn(() => ({
            reserveLeaseIf: async (condition: () => Promise<boolean>) => {
                expect(await condition()).toBe(true);
                harness.relatedFile.stat.mtime += 1;
                return {
                    ok: true as const,
                    reservation: { commit, rollback },
                };
            },
        }) as never);
        const result = await harness.owner.runScopeRecap({ mode: "background" });
        expect(result.attempt.providerCallMade).toBe(false);
        expect(rollback).toHaveBeenCalledTimes(1);
        expect(commit).not.toHaveBeenCalled();
        expect(harness.providerCalls).toHaveLength(0);
    });

    it("captures provider/model identity at call start for cost attribution", async () => {
        const harness = createHarness({
            invoke: async () => {
                harness.settings.provider = "qwen";
                harness.settings.model = "later-model";
                return validRecapResponse();
            },
        });
        const result = await harness.owner.runScopeRecap({ mode: "background" });
        expect(result.status).toBe("ready");
        expect(harness.costEntries[0]).toMatchObject({
            feature: "scope-recap",
            provider: "openai",
            model: "gpt-4o-mini",
        });
    });

    it("passes the DashScope short-JSON options at model setup", async () => {
        const harness = createHarness();
        harness.settings.provider = "qwen";
        harness.settings.model = "deepseek-v4-flash";
        harness.settings.endpoint = "https://dashscope.aliyuncs.com/compatible-mode/v1";
        await harness.owner.runScopeRecap({ mode: "background" });
        expect(harness.createModel).toHaveBeenCalledWith(0.2, {
            maxTokens: 1_000,
            qwenRequestOptions: { enableThinking: false },
        });
    });

    it("uses one scope-recap limiter with 2/10 caps and disposes only domain state", async () => {
        const harness = createHarness();
        const first = harness.owner.getRateLimiter();
        expect(harness.owner.getRateLimiter()).toBe(first);
        await expect(harness.owner.getFeatureRateSnapshot()).resolves.toEqual(expect.objectContaining({
            hourlyCap: SCOPE_RECAP_CALL_LIMITS.hourly,
            dailyCap: SCOPE_RECAP_CALL_LIMITS.daily,
            hourlyUsed: 0,
            dailyUsed: 0,
        }));

        harness.owner.dispose();
        expect(harness.owner.getRateLimiter()).not.toBe(first);
        expect(harness.dependencies.getProviderCallAdmission())
            .toBe(harness.dependencies.getProviderCallAdmission());
    });
});
