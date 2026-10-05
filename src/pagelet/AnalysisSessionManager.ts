/* Copyright 2023 edonyzpc */

/**
 * Owns mutual exclusion for the remaining local foreground routes.
 */
export class AnalysisSessionManager {
    private foregroundRunInProgress = false;

    get isForegroundRunInProgress(): boolean {
        return this.foregroundRunInProgress;
    }

    beginForegroundRouteRun(): void {
        this.foregroundRunInProgress = true;
    }

    finishForegroundReviewRun(): void {
        this.foregroundRunInProgress = false;
    }
}
