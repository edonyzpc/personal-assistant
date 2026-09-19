import { describe, expect, it, jest } from "@jest/globals";

jest.mock("obsidian", () => ({
    MarkdownView: class {},
    Notice: jest.fn(),
    TFile: class {},
    normalizePath: (path: string) => path,
}));

jest.mock("../src/share-card/share-card-modal", () => ({
    ShareCardModal: jest.fn().mockImplementation(() => ({ open: jest.fn() })),
}));

import { TFile } from "obsidian";

import { PageletOrchestrator, type PageletHost } from "../src/pagelet/orchestrator";

function makeHost(overrides: Partial<PageletHost> = {}): PageletHost {
    const activeFile = new TFile() as unknown as { path: string; extension: string };
    activeFile.path = "notes/current.md";
    activeFile.extension = "md";
    return {
        app: {
            workspace: {
                getActiveFile: jest.fn(() => activeFile),
                getMostRecentLeaf: jest.fn(() => null),
            },
            vault: {
                getMarkdownFiles: jest.fn(() => [activeFile]),
                getAbstractFileByPath: jest.fn(() => activeFile),
            },
            metadataCache: {},
        },
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
                scopeRecapAuthorizationContextId: null,
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
            contextPager: { enabled: true },
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
        createForegroundAnalyzeCallback: () => jest.fn(),
        writeReviewNote: jest.fn(async () => ({ success: true, filePath: ".pagelet/test.md" })),
        saveSettings: jest.fn(),
        prepareMemoryForPagelet: jest.fn(),
        getMemoryPreparationStatus: jest.fn(() => null),
        isPathAllowedForPagelet: jest.fn(() => true),
        openPageletSettings: jest.fn(),
        openQuickCapture: jest.fn(),
        updatePageletSetting: jest.fn(),
        openPageletDetailView: jest.fn(),
        findRelatedNotes: jest.fn(async () => []),
        isMemoryReadyForPageletDiscovery: jest.fn(async () => true),
        discoverConnections: jest.fn(async () => null),
        listReviewQueueItems: jest.fn(() => []),
        listSavedInsights: jest.fn(() => []),
        listConfirmedMemories: jest.fn(() => []),
        runMaintenanceReview: jest.fn(),
        runGraphDiscovery: jest.fn(),
        detectCrossNotePatterns: jest.fn(async () => null),
        buildScopeRecapLocalOverview: jest.fn(),
        isScopeRecapProviderConfigured: jest.fn(() => true),
        getScopeRecapProviderInfo: jest.fn(),
        getScopeRecapAuthorizationContextId: jest.fn(() => "test-context"),
        getScopeRecapDataBoundarySnapshotId: jest.fn(() => "test-boundary"),
        runScopeRecap: jest.fn(),
        runQuietRecall: jest.fn(),
        getPageletProviderCallAdmission: jest.fn(),
        createPageletAttentionStorage: jest.fn(() => undefined),
        getDeepDiscoverUsage: jest.fn(),
        isDeepDiscoverCommitSealCurrent: jest.fn(() => true),
        ...overrides,
    } as unknown as PageletHost;
}

describe("B-136 P2 retired Pagelet scope and legacy closures", () => {
    it("opens the legacy Panel command without starting a provider run", () => {
        const runDeepDiscover = jest.fn<NonNullable<PageletHost["runDeepDiscover"]>>(
            async () => ({ status: "quiet", reason: "no-insight" }),
        );
        const orchestrator = new PageletOrchestrator(makeHost({ runDeepDiscover }));

        orchestrator.openPanel();

        expect(runDeepDiscover).not.toHaveBeenCalled();
    });
});
