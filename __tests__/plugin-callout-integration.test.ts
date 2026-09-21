import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { Callout, CalloutManager } from "obsidian-callout-manager";

import {
    CalloutIntegration,
    type CalloutIntegrationDependencies,
} from "../src/plugin/callout-integration";

type GetApi = CalloutIntegrationDependencies["getApi"];

function createManager(callouts: Callout[] = []): CalloutManager<true> {
    return {
        getCallouts: () => callouts,
    } as unknown as CalloutManager<true>;
}

function createHarness() {
    const managerCallouts: Callout[] = [{
        id: "managed",
        icon: "check",
        color: "0, 191, 188",
        sources: [{ type: "custom" }],
    }];
    const manager = createManager(managerCallouts);
    const registry = {
        enabledPlugins: new Set<string>(),
        plugins: {} as Record<string, unknown>,
    };
    const getApi = jest.fn<GetApi>(() => Promise.resolve(manager));
    const log = jest.fn();
    const owner = new CalloutIntegration({
        pluginId: "callout-manager",
        registry: {
            isPluginEnabled: (pluginId) => registry.enabledPlugins.has(pluginId),
            getPluginInstance: (pluginId) => registry.plugins[pluginId],
        },
        getApi,
        log,
    });

    return { owner, registry, getApi, log, manager, managerCallouts };
}

afterEach(() => {
    jest.useRealTimers();
});

describe("CalloutIntegration", () => {
    it("initializes through the public API when the enabled plugin instance is already loaded", async () => {
        const harness = createHarness();
        harness.registry.enabledPlugins.add("callout-manager");
        harness.registry.plugins["callout-manager"] = {};

        await harness.owner.initialize();

        expect(harness.getApi).toHaveBeenCalledTimes(1);
        expect(harness.owner.getCallouts()).toEqual(harness.managerCallouts);
        expect(harness.log).not.toHaveBeenCalled();
    });

    it("keeps the default-callout fallback when the third-party plugin is not enabled", async () => {
        const harness = createHarness();

        await harness.owner.initialize();

        expect(harness.owner.getCallouts()).toBeUndefined();
        expect(harness.getApi).not.toHaveBeenCalled();
        expect(harness.log).toHaveBeenCalledWith("Callout Manager is unavailable; using default callouts.");
    });

    it("times out after two seconds while the enabled plugin instance remains pending", async () => {
        jest.useFakeTimers();
        const harness = createHarness();
        harness.registry.enabledPlugins.add("callout-manager");
        const initialized = harness.owner.initialize();

        await jest.advanceTimersByTimeAsync(1_999);
        expect(harness.getApi).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(1);
        await initialized;

        expect(harness.owner.getCallouts()).toBeUndefined();
        expect(harness.getApi).not.toHaveBeenCalled();
        expect(harness.log).toHaveBeenCalledWith("Callout Manager is unavailable; using default callouts.");
    });

    it("polls until the enabled plugin instance loads, then requests the public API", async () => {
        jest.useFakeTimers();
        const harness = createHarness();
        harness.registry.enabledPlugins.add("callout-manager");
        const initialized = harness.owner.initialize();
        await Promise.resolve();

        harness.registry.plugins["callout-manager"] = {};
        await jest.advanceTimersByTimeAsync(50);
        await initialized;

        expect(harness.getApi).toHaveBeenCalledTimes(1);
        expect(harness.owner.getCallouts()).toEqual(harness.managerCallouts);
    });

    it("settles a pending poll immediately and clears its timers on dispose", async () => {
        jest.useFakeTimers();
        const harness = createHarness();
        harness.registry.enabledPlugins.add("callout-manager");
        const initialized = harness.owner.initialize();
        await Promise.resolve();

        harness.owner.dispose();
        let settledWithoutTimerAdvance = false;
        initialized.then(() => { settledWithoutTimerAdvance = true; });
        await Promise.resolve();
        await Promise.resolve();
        await jest.advanceTimersByTimeAsync(2_000);

        expect(settledWithoutTimerAdvance).toBe(true);
        expect(harness.getApi).not.toHaveBeenCalled();
        expect(harness.owner.getCallouts()).toBeUndefined();
    });

    it("discards a late public API result after dispose", async () => {
        const harness = createHarness();
        harness.registry.enabledPlugins.add("callout-manager");
        harness.registry.plugins["callout-manager"] = {};
        let resolveApi!: (manager: CalloutManager<true>) => void;
        harness.getApi.mockImplementationOnce(() => new Promise<CalloutManager<true>>((resolve) => {
            resolveApi = resolve;
        }));
        const initialized = harness.owner.initialize();
        await Promise.resolve();

        harness.owner.dispose();
        resolveApi(harness.manager);
        await initialized;

        expect(harness.owner.getCallouts()).toBeUndefined();
    });

    it("drops a superseded poll before it can update the newer generation", async () => {
        jest.useFakeTimers();
        const harness = createHarness();
        harness.registry.enabledPlugins.add("callout-manager");
        const firstInitialize = harness.owner.initialize();
        await Promise.resolve();
        const secondInitialize = harness.owner.initialize();
        await Promise.resolve();

        harness.registry.plugins["callout-manager"] = {};
        await jest.advanceTimersByTimeAsync(50);
        await Promise.all([firstInitialize, secondInitialize]);

        expect(harness.getApi).toHaveBeenCalledTimes(1);
        expect(harness.owner.getCallouts()).toEqual(harness.managerCallouts);
        expect(harness.log).not.toHaveBeenCalled();
    });

    it("drops an old generation API failure without affecting the newer result", async () => {
        const harness = createHarness();
        const failure = new Error("old generation API failure");
        harness.registry.enabledPlugins.add("callout-manager");
        harness.registry.plugins["callout-manager"] = {};
        let rejectFirstApi!: (error: Error) => void;
        harness.getApi.mockImplementationOnce(() => new Promise<never>((_, reject) => {
            rejectFirstApi = reject;
        }));
        const firstInitialize = harness.owner.initialize();
        await Promise.resolve();
        const secondInitialize = harness.owner.initialize();
        await Promise.resolve();

        rejectFirstApi(failure);
        await Promise.all([firstInitialize, secondInitialize]);

        expect(harness.getApi).toHaveBeenCalledTimes(2);
        expect(harness.owner.getCallouts()).toEqual(harness.managerCallouts);
        expect(harness.log).not.toHaveBeenCalledWith("Failed to initialize Callout Manager API", failure);
    });

    it("logs only the current generation when the public API fails", async () => {
        const harness = createHarness();
        const failure = new Error("callout API unavailable");
        harness.registry.enabledPlugins.add("callout-manager");
        harness.registry.plugins["callout-manager"] = {};
        harness.getApi.mockRejectedValueOnce(failure);

        await harness.owner.initialize();

        expect(harness.owner.getCallouts()).toBeUndefined();
        expect(harness.log).toHaveBeenCalledWith("Failed to initialize Callout Manager API", failure);
    });
});
