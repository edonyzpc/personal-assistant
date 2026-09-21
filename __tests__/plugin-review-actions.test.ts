import { describe, expect, it, jest } from "@jest/globals";
import { TFile } from "obsidian";

import {
    RetainedReviewPluginIntegration,
    type RetainedReviewPluginIntegrationDependencies,
} from "../src/pagelet/plugin-review-actions";

jest.mock("obsidian", () => ({
    TFile: class MockTFile {
        path: string;
        extension = "md";
        basename: string;
        stat: { ctime: number; mtime: number; size: number };

        constructor(path: string) {
            this.path = path;
            this.basename = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
            this.stat = { ctime: 1, mtime: 1, size: 10 };
        }
    },
    Notice: class {},
    normalizePath: (path: string) => path,
}));

const settings = {
    enabled: true,
    temperature: 0.2,
    maxInputTokens: 8_000,
    maxOutputTokens: 2_000,
    foregroundPerHourCap: 3,
    foregroundPerDayCap: 9,
    outputLanguage: "auto" as const,
};

const createDependencies = () => {
    const FileCtor = TFile as unknown as { new(path: string): TFile };
    const file = new FileCtor("notes/current.md") as TFile & {
        stat: { ctime: number; mtime: number; size: number };
    };
    const dependencies: RetainedReviewPluginIntegrationDependencies = {
        app: {
            vault: {
                cachedRead: async () => "# Current",
                getAbstractFileByPath: (path: string) => path === file.path ? file : null,
            },
            workspace: { getActiveFile: () => file },
        },
        source: { isPageletProviderSourceAllowedFile: jest.fn(() => true) },
        getSettings: () => ({
            pagelet: settings,
            mergedPagelet: settings,
            provider: "openai",
            model: "model",
            embeddingModel: "embedding",
        }),
        getLocale: () => "en",
        isRuntimeCurrent: () => true,
        getScopeRecapAuthorizationContextId: () => "policy",
        getScopeRecapProviderInfo: () => ({
            provider: "openai",
            model: "model",
            endpoint: "endpoint",
        }),
        getProviderCallAdmission: jest.fn(() => ({} as never)),
        getCostTracker: jest.fn(() => ({ record: jest.fn() }) as never),
        requestHighRiskDecision: jest.fn(async (): Promise<"run"> => "run"),
        getVaultStorageScope: () => "vault",
        createRateLimitStorage: jest.fn(() => ({ load: () => null, save: () => undefined })),
        getRateLimitStorageKey: jest.fn((scope: string | null) => `foreground:${scope}`),
        findRelatedNotes: jest.fn(async () => []),
        createChatModel: jest.fn(async () => ({}) as never),
        log: jest.fn(),
    };
    return { dependencies, file };
};

describe("RetainedReviewPluginIntegration", () => {
    it("owns one foreground limiter and invalidates it on feature resource release", () => {
        const { dependencies } = createDependencies();
        const owner = new RetainedReviewPluginIntegration(dependencies);
        const first = owner.getRateLimiter();

        expect(owner.getRateLimiter()).toBe(first);
        owner.invalidateLimiter();
        expect(owner.getRateLimiter()).not.toBe(first);
        expect(dependencies.createRateLimitStorage).toHaveBeenCalledTimes(2);
    });

    it("reads only admitted exact sources and rejects identity drift before provider use", async () => {
        const { dependencies, file } = createDependencies();
        const owner = new RetainedReviewPluginIntegration(dependencies);
        const contents = await owner.readNoteContents([file], 8_000);
        expect(contents).toHaveLength(1);

        const snapshots = owner.captureSourceSnapshots(contents);
        expect(snapshots).toEqual([{ path: file.path, mtime: file.stat.mtime, size: file.stat.size }]);
        expect(owner.sourceSnapshotsAreCurrent(snapshots ?? [], file.path)).toBe(true);

        file.stat.mtime += 1;
        expect(owner.sourceSnapshotsAreCurrent(snapshots ?? [], file.path)).toBe(false);
    });
});
