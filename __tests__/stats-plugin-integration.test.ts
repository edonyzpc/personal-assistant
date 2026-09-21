import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { App, EventRef } from "obsidian";

const mockFieldExtension = { id: "plugin-field" };
const mockStatusExtension = { id: "status-bar" };
const mockSectionExtension = { id: "section-count" };
const mockPluginFieldInit = jest.fn((callback: () => unknown) => ({
    id: "plugin-field-init",
    callback,
}));
const mockStatsManagerConstructor = jest.fn();

jest.mock("../src/stats/stats-manager", () => ({
    __esModule: true,
    default: class MockStatsManager {
        constructor(...args: unknown[]) {
            mockStatsManagerConstructor(args[0], this);
        }
    },
}));

jest.mock("../src/stats/editor-plugin", () => ({
    pluginField: { init: (callback: () => unknown) => mockPluginFieldInit(callback) },
    statusBarEditorPlugin: mockStatusExtension,
    sectionWordCountEditorPlugin: mockSectionExtension,
}));

import { StatsPluginIntegration, type StatsPluginIntegrationDependencies } from "../src/stats/plugin-integration";
import type StatsManager from "../src/stats/stats-manager";
import type { StatsHost } from "../src/stats/StatsHost";

interface MockManager extends StatsManager {
    flush: jest.Mock<() => Promise<void>>;
    dispose: jest.Mock<() => void>;
}

type IntegrationSettings = ReturnType<StatsPluginIntegrationDependencies["getSettings"]>;

function createSettings(debug = false): IntegrationSettings {
    return {
        debug,
        statsPath: "stats.md",
        statisticsVaultId: "stats-vault",
        statisticsSyncEnabled: false,
        countComments: true,
        displaySectionCounts: true,
    };
}

function createHarness(settings = createSettings()) {
    const app = {
        workspace: {
            detachLeavesOfType: jest.fn(),
            getLeaf: jest.fn(() => ({
                setViewState: jest.fn(async () => undefined),
            })),
            revealLeaf: jest.fn(async () => undefined),
        },
    } as unknown as App;
    const registerEvent = jest.fn<(eventRef: EventRef) => void>();
    const log = jest.fn<(message: string, ...args: unknown[]) => void>();
    let currentSettings = settings;
    const owner = new StatsPluginIntegration({
        app,
        statViewType: "stat-preview",
        getSettings: () => currentSettings,
        registerEvent,
        log,
    });

    return {
        owner,
        app,
        settings,
        setSettings: (next: IntegrationSettings) => {
            currentSettings = next;
        },
        registerEvent,
        log,
    };
}

describe("StatsPluginIntegration", () => {
    beforeEach(() => {
        mockStatsManagerConstructor.mockClear();
        mockPluginFieldInit.mockClear();
    });

    it("owns one manager and exposes live StatsHost and EditorPluginHost settings", () => {
        const initialSettings = createSettings(false);
        const harness = createHarness(initialSettings);

        expect(harness.owner.statsManager).toBeUndefined();
        expect(mockPluginFieldInit).not.toHaveBeenCalled();
        const firstExtensions = harness.owner.getEditorExtensions();
        const secondExtensions = harness.owner.getEditorExtensions();
        expect(firstExtensions).toBe(secondExtensions);
        expect(mockPluginFieldInit).toHaveBeenCalledTimes(1);
        expect(firstExtensions).toEqual([
            expect.objectContaining({ id: "plugin-field-init" }),
            mockStatusExtension,
            mockSectionExtension,
        ]);

        harness.owner.initialize();
        harness.owner.initialize();
        const editorHost = mockPluginFieldInit.mock.calls[0]?.[0]();

        expect(mockStatsManagerConstructor).toHaveBeenCalledTimes(1);
        const manager = harness.owner.statsManager as MockManager;
        expect(manager).toBeDefined();
        const host = mockStatsManagerConstructor.mock.calls[0]?.[0] as StatsHost;
        expect(host.app).toBe(harness.app);
        expect(host.settings).toBe(initialSettings);
        expect(editorHost).toMatchObject({ app: harness.app, statsManager: manager });
        expect((editorHost as { settings: StatsHost["settings"] }).settings).toBe(initialSettings);

        const nextSettings = createSettings(true);
        harness.setSettings(nextSettings);
        expect(host.settings).toBe(nextSettings);
        expect((editorHost as { settings: StatsHost["settings"] }).settings).toBe(nextSettings);

        host.log("stats failed", { reason: "test" });
        expect(harness.log).toHaveBeenCalledWith("stats failed", { reason: "test" });
        const eventRef = {} as EventRef;
        host.registerEvent(eventRef);
        expect(harness.registerEvent).toHaveBeenCalledWith(eventRef);
        expect(firstExtensions[0]).toMatchObject({ id: "plugin-field-init" });
    });

    it("flushes the owning manager for active-leaf changes", async () => {
        const harness = createHarness();
        harness.owner.initialize();
        const manager = harness.owner.statsManager as MockManager;
        manager.flush = jest.fn(async () => undefined);

        await harness.owner.flush();

        expect(manager.flush).toHaveBeenCalledTimes(1);
    });

    it("flushes before disposing on the statistics unload step and retains the manager reference", async () => {
        const harness = createHarness();
        const order: string[] = [];
        const failure = new Error("flush failed");
        harness.owner.initialize();
        const manager = harness.owner.statsManager as MockManager;
        manager.flush = jest.fn(() => {
            order.push("flush");
            return Promise.reject(failure);
        });
        manager.dispose = jest.fn(() => {
            order.push("dispose");
        });

        harness.owner.unloadStatistics();
        await Promise.resolve();

        expect(order).toEqual(["flush", "dispose"]);
        expect(harness.owner.statsManager).toBe(manager);
        expect(harness.log).toHaveBeenCalledWith("Failed to flush statistics during unload", failure);
    });

    it("keeps the statistics view open operation order", async () => {
        const harness = createHarness();
        const order: string[] = [];
        const viewLeaf = {
            setViewState: jest.fn(async (_viewState: unknown) => {
                order.push("set-view-state");
            }) as jest.Mock<(viewState: unknown) => Promise<void>>,
        };
        (harness.app.workspace as unknown as {
            detachLeavesOfType: jest.Mock;
            getLeaf: jest.Mock;
            revealLeaf: jest.Mock;
        }).detachLeavesOfType.mockImplementation(() => {
            order.push("detach");
        });
        (harness.app.workspace as unknown as { getLeaf: jest.Mock }).getLeaf.mockImplementation(() => viewLeaf);
        (harness.app.workspace as unknown as { revealLeaf: jest.Mock }).revealLeaf.mockImplementation(async () => {
            order.push("reveal");
        });
        harness.owner.initialize();
        const manager = harness.owner.statsManager as MockManager;
        manager.flush = jest.fn(async () => {
            order.push("flush");
        });

        await harness.owner.activateView();

        expect(order).toEqual(["flush", "detach", "set-view-state", "reveal"]);
        expect((harness.app.workspace as unknown as { detachLeavesOfType: jest.Mock }).detachLeavesOfType)
            .toHaveBeenCalledWith("stat-preview");
        expect(viewLeaf.setViewState).toHaveBeenCalledWith({ type: "stat-preview", active: true });
    });
});
