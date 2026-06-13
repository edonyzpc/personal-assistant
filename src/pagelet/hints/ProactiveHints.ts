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
        if (config.enabled !== undefined) this._config.enabled = config.enabled;
        if (config.cooldownMinutes !== undefined) this._config.cooldownMinutes = config.cooldownMinutes;
        if (config.quietHours !== undefined) this._config.quietHours = config.quietHours;
    }

    /** Called when background preparation engine produces new insights */
    onInsightsReady(): boolean {
        if (!this._config.enabled) return false;
        if (!this._isCooldownElapsed()) return false;
        if (this._isInQuietHours()) return false;

        this._pendingInsights = true;
        return true;
    }

    /** Called when the user views the Bubble — clears the pending hint */
    onHintViewed(): void {
        if (this._pendingInsights) {
            this._lastHintAt = Date.now();
            this._pendingInsights = false;
        }
    }

    get hasPendingHint(): boolean {
        return this._pendingInsights;
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
        if (this._lastHintAt === null) return true;
        const cooldownMs = this._config.cooldownMinutes * 60 * 1000;
        return Date.now() - this._lastHintAt >= cooldownMs;
    }
}
