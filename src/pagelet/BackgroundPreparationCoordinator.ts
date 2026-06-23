/* Copyright 2023 edonyzpc */

/**
 * BackgroundPreparationCoordinator -- owns the PreloadEngine lifecycle.
 *
 * Extracted from {@link PageletOrchestrator} so background preparation
 * setup / config / event handling does not pollute the main coordination
 * layer.
 *
 * Exposes a minimal surface: start(), destroy(), syncConfig(),
 * noteActivity(), and status().
 */

import type { PreloadCache } from "./preload/PreloadCache";
import type { PreloadBudget } from "./preload/PreloadBudget";
import { PreloadEngine } from "./preload/PreloadEngine";
import type { PreloadConfig, PreloadEvent } from "./preload/types";
import type { ChangeDetector } from "./scope/ChangeDetector";
import type { ScopeResolver } from "./scope/ScopeResolver";
import type { PageletHost } from "./PageletHost";

// ---------------------------------------------------------------------------
// Callbacks the coordinator fires back at the orchestrator
// ---------------------------------------------------------------------------

export interface BackgroundPreparationCallbacks {
    /** Pet state machine transition. */
    onPetTransition(event: "analysis-start" | "analysis-done" | "insights-ready"): void;
    /** Flash an error on the Pet. */
    onPetFlashError(): void;
    /** Check proactive hints cooldown after insights are ready. */
    onInsightsReady(): boolean;
}

// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------

export class BackgroundPreparationCoordinator {
    private engine: PreloadEngine | null = null;
    private unsubscribe: (() => void) | null = null;

    constructor(
        private readonly host: PageletHost,
        private readonly preloadCache: PreloadCache,
        private readonly preloadBudget: PreloadBudget,
        private readonly changeDetector: ChangeDetector,
        private readonly scopeResolver: ScopeResolver,
        private readonly callbacks: BackgroundPreparationCallbacks,
    ) {}

    // ======================================================================
    // Public API
    // ======================================================================

    /** Create (or reconfigure) and start the background preparation engine. */
    start(): void {
        if (this.engine) {
            this.engine.updateConfig(this.buildConfig());
            return;
        }

        this.engine = new PreloadEngine(
            this.host.app,
            this.buildConfig(),
            this.preloadCache,
            this.preloadBudget,
            this.changeDetector,
            this.scopeResolver,
            this.host.createPreloadAnalyzeCallback(),
        );

        // Background preparation events drive the Pet state machine
        this.unsubscribe = this.engine.on((event: PreloadEvent) => {
            this.handleEvent(event);
        });

        this.engine.start();
    }

    /** Tear down the engine and unsubscribe from events. */
    destroy(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.engine?.destroy();
        this.engine = null;
    }

    /**
     * Synchronize the engine configuration with the latest settings.
     * If the engine is not running yet, starts it when preloadEnabled is true.
     */
    syncConfig(): void {
        const s = this.host.settings.pagelet;

        if (!s.preloadEnabled) {
            this.engine?.updateConfig(this.buildConfig());
            return;
        }
        if (!this.engine) {
            this.start();
            return;
        }
        this.engine.updateConfig(this.buildConfig());
    }

    /** Forward note-activity events to the engine. */
    noteActivity(): void {
        this.engine?.noteActivity();
    }

    /** Return engine diagnostics (for the status command). */
    status(): ReturnType<PreloadEngine["status"]> | undefined {
        return this.engine?.status?.();
    }

    // ======================================================================
    // Private
    // ======================================================================

    private buildConfig(): PreloadConfig {
        const s = this.host.settings.pagelet;
        return {
            enabled: s.preloadEnabled,
            intervalMinutes: s.preloadInterval,
            perHourCap: s.preloadPerHourCap,
            perDayCap: s.preloadPerDayCap,
            tokenBudget: { ...s.preloadTokenBudget },
        };
    }

    /** Map preload lifecycle events to Pet state transitions. */
    private handleEvent(event: PreloadEvent): void {
        switch (event.type) {
            case "cycle-start":
                this.callbacks.onPetTransition("analysis-start");
                break;

            case "cycle-complete":
                if (event.result.findings.length > 0 && this.callbacks.onInsightsReady()) {
                    this.callbacks.onPetTransition("insights-ready");
                } else {
                    this.callbacks.onPetTransition("analysis-done");
                }
                break;

            case "cycle-error":
                this.callbacks.onPetTransition("analysis-done");
                this.callbacks.onPetFlashError();
                this.host.log("Preload cycle error", event.error);
                break;

            case "cycle-skip":
                // Skips are silent -- no state change, no user notification
                break;
        }
    }
}
