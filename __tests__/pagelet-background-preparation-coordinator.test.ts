import { describe, expect, it, jest } from "@jest/globals";

import { BackgroundPreparationCoordinator } from "../src/pagelet/BackgroundPreparationCoordinator";
import type { PreloadEvent, PreloadResult } from "../src/pagelet/preload/types";

function makeCoordinator() {
    const callbacks = {
        onPetTransition: jest.fn(),
        onPetFlashError: jest.fn(),
        onInsightsReady: jest.fn(() => true),
    };
    const coordinator = new BackgroundPreparationCoordinator(
        { log: jest.fn(), settings: { pagelet: {} } } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        callbacks,
    );
    const internals = coordinator as unknown as {
        handleEvent(event: PreloadEvent): void;
    };
    return { callbacks, internals };
}

function preloadResult(findings: PreloadResult["findings"]): PreloadResult {
    return {
        findings,
        analyzedFiles: ["notes/current.md"],
        analyzedAt: Date.now(),
        tokenCost: { input: 10, output: 5 },
    };
}

describe("BackgroundPreparationCoordinator", () => {
    it("does not enter nudge when a completed background cycle has no findings", () => {
        const { callbacks, internals } = makeCoordinator();

        internals.handleEvent({
            type: "cycle-complete",
            result: preloadResult([]),
        });

        expect(callbacks.onInsightsReady).not.toHaveBeenCalled();
        expect(callbacks.onPetTransition).toHaveBeenCalledWith("analysis-done");
        expect(callbacks.onPetTransition).not.toHaveBeenCalledWith("insights-ready");
    });

    it("falls back to analysis-done when findings exist but onInsightsReady returns false", () => {
        const { callbacks, internals } = makeCoordinator();
        callbacks.onInsightsReady.mockReturnValue(false);

        internals.handleEvent({
            type: "cycle-complete",
            result: preloadResult([{
                text: "Suppressed finding",
                sourceFile: "notes/current.md",
                sourceTitle: "current",
            }]),
        });

        expect(callbacks.onInsightsReady).toHaveBeenCalledTimes(1);
        expect(callbacks.onPetTransition).toHaveBeenCalledWith("analysis-done");
        expect(callbacks.onPetTransition).not.toHaveBeenCalledWith("insights-ready");
    });

    it("enters insights-ready only when findings exist and proactive hints accept them", () => {
        const { callbacks, internals } = makeCoordinator();

        internals.handleEvent({
            type: "cycle-complete",
            result: preloadResult([{
                text: "Prepared finding",
                sourceFile: "notes/current.md",
                sourceTitle: "current",
            }]),
        });

        expect(callbacks.onInsightsReady).toHaveBeenCalledTimes(1);
        expect(callbacks.onPetTransition).toHaveBeenCalledWith("insights-ready");
    });
});
