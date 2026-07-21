/* Copyright 2023 edonyzpc */

export interface ProactiveHintsConfig {
    enabled: boolean;
    cooldownMinutes: number;
    quietHours: {
        enabled: boolean;
        start: string; // "HH:mm"
        end: string;   // "HH:mm"
    };
}

export class ProactiveHints {
    private _config: ProactiveHintsConfig;
    private _lastHintAt: number | null = null;
    private _pendingInsights = false;

    constructor(config: ProactiveHintsConfig) {
        this._config = {
            ...config,
            quietHours: config.quietHours ?? { enabled: false, start: "22:00", end: "08:00" },
        };
    }

    get enabled(): boolean {
        return this._config.enabled;
    }

    toggle(): boolean {
        this._config.enabled = !this._config.enabled;
        if (!this._config.enabled) {
            this._pendingInsights = false;
        }
        return this._config.enabled;
    }

    setEnabled(enabled: boolean): void {
        this._config.enabled = enabled;
        if (!enabled) {
            this._pendingInsights = false;
        }
    }

    updateConfig(config: Partial<ProactiveHintsConfig>): void {
        if (config.enabled !== undefined) {
            this._config.enabled = config.enabled;
            if (!config.enabled) this._pendingInsights = false;
        }
        if (config.cooldownMinutes !== undefined) this._config.cooldownMinutes = config.cooldownMinutes;
        if (config.quietHours !== undefined) this._config.quietHours = config.quietHours;
    }

    /**
     * Called when a feature produces a new insight. A narrowly-scoped feature
     * may supply its own persisted enablement while still sharing the global
     * quiet-hours and cooldown clock.
     */
    onInsightsReady(options: { enabled?: boolean } = {}): boolean {
        if (!(options.enabled ?? this._config.enabled)) return false;
        if (!this._isCooldownElapsed()) return false;
        if (this._isInQuietHours()) return false;

        this._pendingInsights = true;
        return true;
    }

    /** Advance the shared clock only after an admitted hint is actually shown. */
    recordHintPresented(): void {
        this._lastHintAt = Date.now();
        this._pendingInsights = false;
    }

    /** @deprecated Use recordHintPresented at the successful presentation seam. */
    onHintViewed(): void {
        if (this._pendingInsights) this.recordHintPresented();
    }

    /** Drop an unrenderable pending signal without advancing the cooldown. */
    discardPendingHint(): void {
        this._pendingInsights = false;
    }

    get hasPendingHint(): boolean {
        return this._pendingInsights;
    }

    get quietHoursActive(): boolean {
        return this._isInQuietHours();
    }

    /** Read-only delay until a hint can next enter the shared clock. */
    delayUntilEligibleMs(options: { enabled?: boolean } = {}): number | null {
        if (!(options.enabled ?? this._config.enabled)) return null;
        return Math.max(this._cooldownRemainingMs(), this._quietHoursRemainingMs());
    }

    private _isInQuietHours(): boolean {
        if (!this._config.quietHours.enabled) return false;
        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        const [startH, startM] = this._config.quietHours.start.split(":").map(Number);
        const [endH, endM] = this._config.quietHours.end.split(":").map(Number);
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;

        if (startMinutes <= endMinutes) {
            return currentMinutes >= startMinutes && currentMinutes < endMinutes;
        }
        // Wraps midnight (e.g., 22:00 - 06:00)
        return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }

    private _isCooldownElapsed(): boolean {
        return this._cooldownRemainingMs() === 0;
    }

    private _cooldownRemainingMs(): number {
        if (this._lastHintAt === null) return 0;
        const cooldownMs = this._config.cooldownMinutes * 60 * 1000;
        return Math.max(0, cooldownMs - (Date.now() - this._lastHintAt));
    }

    private _quietHoursRemainingMs(): number {
        if (!this._isInQuietHours()) return 0;
        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        const [startH, startM] = this._config.quietHours.start.split(":").map(Number);
        const [endH, endM] = this._config.quietHours.end.split(":").map(Number);
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;
        const end = new Date(now);
        end.setHours(endH, endM, 0, 0);
        if (startMinutes > endMinutes && currentMinutes >= startMinutes) {
            end.setDate(end.getDate() + 1);
        }
        return Math.max(0, end.getTime() - now.getTime());
    }
}
