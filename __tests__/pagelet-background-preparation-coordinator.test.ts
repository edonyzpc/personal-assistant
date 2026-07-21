import { describe, expect, it, jest } from "@jest/globals";

import { BackgroundPreparationCoordinator } from "../src/pagelet/BackgroundPreparationCoordinator";
import type { PreloadEvent, PreloadResult } from "../src/pagelet/preload/types";

function makeCoordinator() {
    const callbacks = {
        onPetTransition: jest.fn(),
        onPetFlashError: jest.fn(),
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

        expect(callbacks.onPetTransition).toHaveBeenCalledWith("analysis-done");
        expect(callbacks.onPetTransition).not.toHaveBeenCalledWith("insights-ready");
    });

    it("keeps raw findings explicit-only instead of creating a proactive nudge", () => {
        const { callbacks, internals } = makeCoordinator();

        internals.handleEvent({
            type: "cycle-complete",
            result: preloadResult([{
                text: "Suppressed finding",
                sourceFile: "notes/current.md",
                sourceTitle: "current",
            }]),
        });

        expect(callbacks.onPetTransition).toHaveBeenCalledWith("analysis-done");
        expect(callbacks.onPetTransition).not.toHaveBeenCalledWith("insights-ready");
    });
});
