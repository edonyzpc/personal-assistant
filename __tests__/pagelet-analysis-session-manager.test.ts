import { describe, expect, it } from "@jest/globals";

import { AnalysisSessionManager } from "../src/pagelet/AnalysisSessionManager";

describe("AnalysisSessionManager", () => {
    it("keeps the local foreground route lifecycle without a count budget", () => {
        const manager = new AnalysisSessionManager();

        expect(manager.isForegroundRunInProgress).toBe(false);
        manager.beginForegroundRouteRun();
        expect(manager.isForegroundRunInProgress).toBe(true);
        manager.finishForegroundReviewRun();
        expect(manager.isForegroundRunInProgress).toBe(false);
    });
});
