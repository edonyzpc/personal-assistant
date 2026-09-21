import { describe, expect, it, jest } from "@jest/globals";

import {
    PageletFeatureIntegration,
    type PageletFeatureIntegrationDependencies,
} from "../src/pagelet/plugin-integration";

const createDependencies = () => {
    const order: string[] = [];
    const scope = { id: "scope", unload: () => order.push("release-scope") };
    const orchestrator = {
        initialize: jest.fn(() => order.push("initialize")),
        syncSettings: jest.fn(() => order.push("sync-settings")),
        destroy: jest.fn(() => order.push("destroy-orchestrator")),
    };
    const runtime = { dispose: jest.fn(() => order.push("dispose-runtime")) };
    const dependencies: PageletFeatureIntegrationDependencies = {
        createFeatureScope: () => {
            order.push("create-scope");
            return scope as never;
        },
        releaseFeatureScope: () => {
            order.push("release-scope");
        },
        isFeatureScopeCurrent: () => true,
        syncDeepDiscoverIdentity: () => order.push("sync-deep"),
        syncQuietRecallPolicy: () => order.push("sync-recall"),
        registerCommandsOnce: () => order.push("register-commands"),
        registerFocusCommandOnce: () => order.push("register-focus"),
        createOrchestrator: () => orchestrator as never,
        stopDeepDiscover: () => order.push("stop-deep"),
        disposeDeepDiscoverFeatureResources: () => order.push("dispose-deep"),
        invalidateRetainedReviewLimiter: () => order.push("invalidate-review"),
        disposeScopeRecap: () => order.push("dispose-recap"),
        disposeQuietRecall: () => order.push("dispose-quiet"),
        retireOperations: () => order.push("retire-operations"),
        createRuntime: () => runtime as never,
        log: jest.fn(),
    };
    return { dependencies, order, orchestrator, scope };
};

describe("PageletFeatureIntegration", () => {
    it("creates a feature-bound orchestrator once and reuses it on later syncs", () => {
        const harness = createDependencies();
        const owner = new PageletFeatureIntegration(harness.dependencies);

        owner.sync(true);
        owner.sync(true);

        expect(harness.orchestrator.initialize).toHaveBeenCalledTimes(1);
        expect(harness.orchestrator.syncSettings).toHaveBeenCalledTimes(1);
        expect(harness.order.filter((entry) => entry === "create-scope")).toHaveLength(1);
    });

    it("destroys a stale initializer without publishing its orchestrator", () => {
        const harness = createDependencies();
        harness.dependencies.isFeatureScopeCurrent = () => false;
        const owner = new PageletFeatureIntegration(harness.dependencies);

        owner.sync(true);

        expect(harness.orchestrator.initialize).toHaveBeenCalledTimes(1);
        expect(harness.orchestrator.destroy).toHaveBeenCalledTimes(1);
        expect(owner.currentOrchestrator).toBeNull();
        expect(harness.order).toContain("release-scope");
    });

    it("tears a feature down in the accepted lifecycle order", () => {
        const harness = createDependencies();
        const owner = new PageletFeatureIntegration(harness.dependencies);
        owner.sync(true);
        owner.getOrCreateRuntime();
        harness.order.length = 0;

        owner.disableFeature();

        expect(harness.order).toEqual([
            "release-scope",
            "stop-deep",
            "destroy-orchestrator",
            "dispose-runtime",
            "retire-operations",
            "invalidate-review",
            "dispose-recap",
            "dispose-quiet",
            "dispose-deep",
        ]);
    });

    it("splits root unload stop from post-drain destruction", () => {
        const harness = createDependencies();
        const owner = new PageletFeatureIntegration(harness.dependencies);
        owner.sync(true);
        owner.getOrCreateRuntime();
        harness.order.length = 0;

        owner.beginUnload();
        expect(harness.order).toEqual(["release-scope", "stop-deep"]);
        expect(harness.orchestrator.destroy).not.toHaveBeenCalled();

        owner.destroyAfterUnloadDrains();
        expect(harness.order.slice(2)).toEqual([
            "destroy-orchestrator",
            "dispose-runtime",
            "retire-operations",
            "invalidate-review",
            "dispose-recap",
            "dispose-quiet",
            "dispose-deep",
        ]);
    });
});
