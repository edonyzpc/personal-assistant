/* Copyright 2023 edonyzpc */

import type { App } from "obsidian";

import type { ChangeDetector } from "../scope/ChangeDetector";
import type { ScopeResolver } from "../scope/ScopeResolver";

import type { PreloadCache } from "./PreloadCache";
import type { PreloadBudget } from "./PreloadBudget";
import type { AnalyzeCallback, PreloadConfig, PreloadErrorCategory, PreloadEvent } from "./types";

export class PreloadEngine {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private listeners: Set<(event: PreloadEvent) => void> = new Set();
    private lastCycleAt: number | null = null;
    private running = false;
    private cycleInProgress = false;
    private startedAt: number | null = null;
    private visibilityHandler: (() => void) | null = null;

    // Adaptive interval state
    private lastActivityAt: number = Date.now();

    // Circuit breaker state
    private consecutiveErrors: number = 0;
    private consecutiveSuccesses: number = 0;
    private static readonly MAX_BACKOFF_MULTIPLIER = 8;
    private static readonly ERROR_RESET_THRESHOLD = 2;

    constructor(
        private app: App,
        private config: PreloadConfig,
        private cache: PreloadCache,
        private budget: PreloadBudget,
        private changeDetector: ChangeDetector,
        private scopeResolver: ScopeResolver,
        private analyzeCallback: AnalyzeCallback,
    ) {}

    start(): void {
        if (this.timer) return;
        this.running = true;
        this.startedAt = Date.now();
        this.scheduleNextCycle();

        // Fix 4: On mobile, setTimeout is suspended when backgrounded.
        // Trigger a catch-up cycle when the app returns to foreground.
        this.visibilityHandler = () => {
            if (document.visibilityState !== "visible") return;
            if (!this.running) return;
            const elapsed = Date.now() - (this.lastCycleAt ?? this.startedAt ?? 0);
            if (elapsed >= this.computeBackoffInterval()) {
                void this.runCycle();
            }
        };
        document.addEventListener("visibilitychange", this.visibilityHandler);
    }

    stop(): void {
        this.running = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.visibilityHandler) {
            document.removeEventListener("visibilitychange", this.visibilityHandler);
            this.visibilityHandler = null;
        }
        this.startedAt = null;
    }

    async runCycle(): Promise<void> {
        // Fix 2: Guard against concurrent cycle execution
        if (this.cycleInProgress) return;
        this.cycleInProgress = true;
        try {
            await this.executeCycle();
        } finally {
            this.cycleInProgress = false;
            if (this.running) {
                this.scheduleNextCycle();
            }
        }
    }

    private async executeCycle(): Promise<void> {
        if (!this.config.enabled) {
            this.emit({ type: "cycle-skip", reason: "disabled" });
            return;
        }

        if (!this.budget.canPreload()) {
            this.emit({ type: "cycle-skip", reason: "budget-exceeded" });
            return;
        }

        // Fix 3: Use scopeResolver directly (which calls getMarkdownFiles
        // internally) instead of a redundant changeDetector pre-check that
        // also scans the vault.
        const lastAnalysis = this.changeDetector.getLastAnalysisTime();
        const scope = lastAnalysis !== null
            ? this.scopeResolver.resolveChangedSince(lastAnalysis)
            : this.scopeResolver.resolveTimeRange(7);
        const filesToAnalyze = scope.included.map((c) => c.file);

        if (filesToAnalyze.length === 0) {
            this.emit({ type: "cycle-skip", reason: "no-changes" });
            return;
        }

        this.emit({ type: "cycle-start" });

        // Fix 1: Encompass all post-analysis operations in try/catch so
        // failures in recordCall / markAnalyzed / cache.set don't produce
        // unhandled rejections from the fire-and-forget runCycle() call.
        try {
            const result = await this.analyzeCallback(filesToAnalyze, this.config);

            this.budget.recordCall();
            const now = Date.now();
            for (const file of filesToAnalyze) {
                this.changeDetector.markAnalyzed(file.path, now);
            }
            this.cache.set(result);
            this.lastCycleAt = now;

            // Circuit breaker: track successes, reset errors after threshold
            this.consecutiveSuccesses++;
            if (this.consecutiveSuccesses >= PreloadEngine.ERROR_RESET_THRESHOLD) {
                this.consecutiveErrors = 0;
                this.consecutiveSuccesses = 0;
            }

            this.emit({ type: "cycle-complete", result });
        } catch (error) {
            const wrapped = error instanceof Error ? error : new Error(String(error));
            const category = this.categorizeError(error);

            // Circuit breaker: track errors
            this.consecutiveErrors++;
            this.consecutiveSuccesses = 0;

            this.emit({ type: "cycle-error", error: wrapped, category });

            const backoffMs = this.computeBackoffInterval();
            if (this.consecutiveErrors > 0) {
                this.emit({
                    type: "circuit-breaker",
                    backoffMs,
                    consecutiveErrors: this.consecutiveErrors,
                });
            }
        }
    }

    updateConfig(config: Partial<PreloadConfig>): void {
        const intervalChanged = config.intervalMinutes !== undefined
            && config.intervalMinutes !== this.config.intervalMinutes;

        Object.assign(this.config, config);

        if (intervalChanged && this.running) {
            this.stop();
            this.start();
        }
    }

    on(listener: (event: PreloadEvent) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /** Notify the engine of user activity (called from orchestrator). */
    noteActivity(): void {
        this.lastActivityAt = Date.now();
    }

    status(): {
        running: boolean;
        lastCycleAt: number | null;
        nextCycleAt: number | null;
        budgetRemaining: { hourly: number; daily: number };
        cacheHasResults: boolean;
        consecutiveErrors: number;
        adaptiveIntervalMs: number;
    } {
        const effectiveInterval = this.computeBackoffInterval();
        return {
            running: this.running,
            lastCycleAt: this.lastCycleAt,
            nextCycleAt: this.running
                ? (this.lastCycleAt ?? this.startedAt ?? Date.now()) + effectiveInterval
                : null,
            budgetRemaining: this.budget.remaining(),
            cacheHasResults: this.cache.has(),
            consecutiveErrors: this.consecutiveErrors,
            adaptiveIntervalMs: effectiveInterval,
        };
    }

    destroy(): void {
        this.stop();
        this.cache.clear();
        this.changeDetector.clear();
        this.listeners.clear();
    }

    // ── Adaptive interval ────────────────────────────────────────────

    private computeAdaptiveInterval(): number {
        const base = this.config.intervalMinutes * 60 * 1000;
        const idleMinutes = (Date.now() - this.lastActivityAt) / 60_000;

        if (idleMinutes < 5) {
            // Active: use shorter interval (half, min 5 minutes)
            return Math.max(5 * 60 * 1000, base / 2);
        } else if (idleMinutes > 30) {
            // Idle: use longer interval (double, max 4 hours)
            return Math.min(4 * 60 * 60 * 1000, base * 2);
        }
        return base;
    }

    // ── Circuit breaker ─────────────────────────────────────────────

    private computeBackoffInterval(): number {
        if (this.consecutiveErrors === 0) return this.computeAdaptiveInterval();
        const multiplier = Math.min(
            Math.pow(2, this.consecutiveErrors),
            PreloadEngine.MAX_BACKOFF_MULTIPLIER,
        );
        return this.computeAdaptiveInterval() * multiplier;
    }

    private categorizeError(error: unknown): PreloadErrorCategory {
        const msg = error instanceof Error
            ? error.message.toLowerCase()
            : String(error).toLowerCase();
        if (msg.includes("network") || msg.includes("fetch") || msg.includes("timeout")) return "network";
        if (msg.includes("auth") || msg.includes("api key") || msg.includes("401") || msg.includes("403")) return "auth";
        if (msg.includes("rate") || msg.includes("429") || msg.includes("quota")) return "rate-limit";
        if (msg.includes("parse") || msg.includes("json") || msg.includes("schema")) return "parse";
        return "unknown";
    }

    // ── Scheduling ──────────────────────────────────────────────────

    private scheduleNextCycle(): void {
        if (this.timer) {
            clearTimeout(this.timer);
        }
        const delay = this.computeBackoffInterval();
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.runCycle();
        }, delay);
    }

    private emit(event: PreloadEvent): void {
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch {
                // Listener errors must not break the engine cycle
            }
        }
    }
}
