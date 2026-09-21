import type { Callout, CalloutManager } from "obsidian-callout-manager";

import {
    clearPlatformInterval,
    clearPlatformTimeout,
    setPlatformInterval,
    setPlatformTimeout,
    type PlatformIntervalHandle,
    type PlatformTimeoutHandle,
} from "../platform-dom";

type CalloutManagerApi = CalloutManager<true>;

export interface CalloutPluginRegistry {
    isPluginEnabled(pluginId: string): boolean;
    getPluginInstance(pluginId: string): unknown;
}

export interface CalloutIntegrationDependencies {
    pluginId: string;
    registry: CalloutPluginRegistry;
    getApi(): Promise<CalloutManagerApi | undefined>;
    log(message: string, ...args: unknown[]): void;
}

interface CalloutWaiter {
    generation: number;
    interval: PlatformIntervalHandle;
    timeout: PlatformTimeoutHandle;
    settle(value: unknown): void;
}

const CALLOUT_MANAGER_READY_TIMEOUT_MS = 2_000;
const CALLOUT_MANAGER_READY_POLL_MS = 50;

export class CalloutIntegration {
    private manager: CalloutManagerApi | undefined;
    private disposed = false;
    private generation = 0;
    private waiter: CalloutWaiter | null = null;

    constructor(private readonly dependencies: CalloutIntegrationDependencies) {}

    async initialize(): Promise<void> {
        if (this.disposed) return;

        const generation = this.beginGeneration();
        try {
            const pluginInstance = await this.waitForEnabledPluginInstance(generation);
            if (!this.isCurrentGeneration(generation)) return;

            if (pluginInstance === undefined) {
                this.manager = undefined;
                this.dependencies.log("Callout Manager is unavailable; using default callouts.");
                return;
            }

            const manager = await this.dependencies.getApi();
            if (!this.isCurrentGeneration(generation)) return;
            this.manager = manager;
        } catch (error) {
            if (!this.isCurrentGeneration(generation)) return;
            this.manager = undefined;
            this.dependencies.log("Failed to initialize Callout Manager API", error);
        }
    }

    getCallouts(): ReadonlyArray<Callout> | undefined {
        return this.manager?.getCallouts();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.generation += 1;
        this.settleWaiter(this.waiter, undefined);
        this.manager = undefined;
    }

    private beginGeneration(): number {
        this.settleWaiter(this.waiter, undefined);
        this.generation += 1;
        this.manager = undefined;
        return this.generation;
    }

    private waitForEnabledPluginInstance(generation: number): Promise<unknown> {
        if (!this.dependencies.registry.isPluginEnabled(this.dependencies.pluginId)) {
            return Promise.resolve(undefined);
        }

        const loadedPlugin = this.dependencies.registry.getPluginInstance(this.dependencies.pluginId);
        if (loadedPlugin !== undefined) {
            return Promise.resolve(loadedPlugin);
        }

        return new Promise((resolve) => {
            const waiter = {
                generation,
                interval: null as unknown as PlatformIntervalHandle,
                timeout: null as unknown as PlatformTimeoutHandle,
                settle: resolve,
            };
            waiter.interval = setPlatformInterval(() => {
                const pluginInstance = this.dependencies.registry.getPluginInstance(this.dependencies.pluginId);
                if (pluginInstance !== undefined) {
                    this.settleWaiter(waiter, pluginInstance);
                }
            }, CALLOUT_MANAGER_READY_POLL_MS);
            waiter.timeout = setPlatformTimeout(() => {
                this.settleWaiter(waiter, undefined);
            }, CALLOUT_MANAGER_READY_TIMEOUT_MS);
            this.waiter = waiter;
        });
    }

    private isCurrentGeneration(generation: number): boolean {
        return !this.disposed && generation === this.generation;
    }

    private settleWaiter(waiter: CalloutWaiter | null, value: unknown): void {
        if (!waiter || this.waiter !== waiter) return;

        clearPlatformInterval(waiter.interval);
        clearPlatformTimeout(waiter.timeout);
        this.waiter = null;
        waiter.settle(value);
    }
}
