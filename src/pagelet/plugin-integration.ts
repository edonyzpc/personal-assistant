import type { Component } from "obsidian";

import type { PageletOrchestrator } from "./orchestrator";
import type { PaReviewRuntime } from "./index";

export interface PageletFeatureIntegrationDependencies {
    createFeatureScope(): Component;
    releaseFeatureScope(expectedScope?: Component | null): void;
    isFeatureScopeCurrent(scope: object): boolean;
    syncDeepDiscoverIdentity(): void;
    syncQuietRecallPolicy(): void;
    registerCommandsOnce(): void;
    registerFocusCommandOnce(): void;
    createOrchestrator(featureScope: Component): PageletOrchestrator;
    stopDeepDiscover(): void;
    disposeDeepDiscoverFeatureResources(): void;
    invalidateRetainedReviewLimiter(): void;
    disposeScopeRecap(): void;
    disposeQuietRecall(): void;
    retireOperations(): void;
    createRuntime(): PaReviewRuntime | null;
    log(message: string, detail?: unknown): void;
}

export class PageletFeatureIntegration {
    private featureScope: Component | null = null;
    private orchestrator: PageletOrchestrator | null = null;
    private runtime: PaReviewRuntime | null = null;

    constructor(private readonly dependencies: PageletFeatureIntegrationDependencies) {}

    get currentOrchestrator(): PageletOrchestrator | null {
        return this.orchestrator;
    }

    get currentRuntime(): PaReviewRuntime | null {
        return this.runtime;
    }

    setOrchestratorForCompatibility(value: PageletOrchestrator | null): void {
        this.orchestrator = value;
    }

    setRuntimeForCompatibility(value: PaReviewRuntime | null): void {
        this.runtime = value;
    }

    get currentFeatureScope(): Component | null {
        return this.featureScope;
    }

    sync(enabled: boolean): void {
        if (!enabled) {
            this.disableFeature();
            return;
        }
        this.dependencies.syncDeepDiscoverIdentity();
        this.dependencies.syncQuietRecallPolicy();
        this.dependencies.registerCommandsOnce();
        this.dependencies.registerFocusCommandOnce();

        if (this.orchestrator) {
            this.dependencies.invalidateRetainedReviewLimiter();
            this.orchestrator.syncSettings();
            return;
        }

        let scope: Component | null = null;
        let orchestrator: PageletOrchestrator | null = null;
        try {
            scope = this.dependencies.createFeatureScope();
            orchestrator = this.dependencies.createOrchestrator(scope);
            orchestrator.initialize();
            if (!this.dependencies.isFeatureScopeCurrent(scope)) {
                this.dependencies.releaseFeatureScope(scope);
                orchestrator.destroy();
                return;
            }
            this.orchestrator = orchestrator;
        } catch (error) {
            this.dependencies.releaseFeatureScope(scope);
            orchestrator?.destroy();
            this.dependencies.log("Failed to initialize Pagelet", error);
        }
    }

    beginUnload(): void {
        this.dependencies.releaseFeatureScope();
        this.dependencies.stopDeepDiscover();
    }

    disableFeature(): void {
        this.dependencies.releaseFeatureScope();
        this.dependencies.stopDeepDiscover();
        this.destroyOrchestratorAndRuntime();
        this.dependencies.retireOperations();
        this.dependencies.invalidateRetainedReviewLimiter();
        this.dependencies.disposeScopeRecap();
        this.dependencies.disposeQuietRecall();
        this.dependencies.disposeDeepDiscoverFeatureResources();
    }

    destroyAfterUnloadDrains(): void {
        this.destroyUnloadedRuntime();
        this.dependencies.retireOperations();
        this.dependencies.invalidateRetainedReviewLimiter();
        this.dependencies.disposeScopeRecap();
        this.dependencies.disposeQuietRecall();
        this.dependencies.disposeDeepDiscoverFeatureResources();
    }

    destroyUnloadedRuntime(): void {
        this.destroyOrchestratorAndRuntime();
    }

    finishUnloadAfterSharedService(): void {
        this.dependencies.retireOperations();
        this.dependencies.invalidateRetainedReviewLimiter();
        this.dependencies.disposeScopeRecap();
        this.dependencies.disposeQuietRecall();
        this.dependencies.disposeDeepDiscoverFeatureResources();
    }

    getOrCreateRuntime(): PaReviewRuntime | null {
        if (!this.runtime) this.runtime = this.dependencies.createRuntime();
        return this.runtime;
    }

    private destroyOrchestratorAndRuntime(): void {
        if (this.orchestrator) {
            try {
                this.orchestrator.destroy();
            } catch (error) {
                this.dependencies.log("Failed to destroy Pagelet orchestrator", error);
            }
            this.orchestrator = null;
        }
        if (this.runtime) {
            try {
                this.runtime.dispose();
            } catch (error) {
                this.dependencies.log("Failed to dispose Pagelet runtime", error);
            }
            this.runtime = null;
        }
    }
}
