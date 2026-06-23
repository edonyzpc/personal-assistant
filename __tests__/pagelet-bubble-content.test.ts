import { describe, expect, it, jest } from "@jest/globals";

import { buildDiscoveryContent, buildEmptyContent, buildNudgeContent, buildQuickReviewContent } from "../src/pagelet/bubble/BubbleContent";
import type { BubbleQuickAccessCallbacks } from "../src/pagelet/bubble/types";

function makeCallbacks(): BubbleQuickAccessCallbacks {
    return {
        onExpandPanel: jest.fn(),
        onSourceClick: jest.fn(),
        onDismiss: jest.fn(),
        onReviewCurrentNote: jest.fn(),
        onDiscoverConnections: jest.fn(),
        onPeriodicSummary: jest.fn(),
    };
}

describe("Pagelet Bubble quick access content", () => {
    it.each([
        ["discovery", (callbacks: BubbleQuickAccessCallbacks) => buildDiscoveryContent([{
            text: "Related note found",
            sourceLink: "notes/related.md",
            sourceTitle: "related",
        }], callbacks, "en")],
        ["empty", (callbacks: BubbleQuickAccessCallbacks) => buildEmptyContent(callbacks, "en")],
    ])("adds the three primary Pagelet quick actions to %s bubbles", (_name, buildContent) => {
        const callbacks = makeCallbacks();
        const content = buildContent(callbacks);

        expect(content.actions.map((action) => action.label)).toEqual([
            "Review current note",
            "Discover connections",
            "Generate summary",
        ]);
        expect(content.actions.map((action) => action.description)).toEqual([
            "Scan the active note now",
            "Find related notes",
            "Use AI to summarize recent changes",
        ]);
        expect(content.actions.map((action) => action.icon)).toEqual([
            "search",
            "link",
            "calendar",
        ]);

        content.actions[0].callback();
        content.actions[1].callback();
        content.actions[2].callback();

        expect(callbacks.onReviewCurrentNote).toHaveBeenCalledTimes(1);
        expect(callbacks.onDiscoverConnections).toHaveBeenCalledTimes(1);
        expect(callbacks.onPeriodicSummary).toHaveBeenCalledTimes(1);
    });

    it("keeps cached findings inspectable before offering launch actions", () => {
        const callbacks = makeCallbacks();
        const content = buildQuickReviewContent([{
            text: "Cached finding",
            sourceLink: "notes/current.md",
            sourceTitle: "current",
        }], callbacks, "en");

        expect(content.actions.map((action) => action.label)).toEqual([
            "View details",
            "Review current note",
            "Discover connections",
            "Generate summary",
        ]);
        expect(content.actions[0]).toMatchObject({
            description: "Open prepared findings",
            icon: "panel-right-open",
            primary: true,
        });
        expect(content.actions[1].primary).toBe(false);

        content.actions[0].callback();
        content.actions[1].callback();
        content.actions[2].callback();
        content.actions[3].callback();

        expect(callbacks.onExpandPanel).toHaveBeenCalledWith("prepared");
        expect(callbacks.onReviewCurrentNote).toHaveBeenCalledTimes(1);
        expect(callbacks.onDiscoverConnections).toHaveBeenCalledTimes(1);
        expect(callbacks.onPeriodicSummary).toHaveBeenCalledTimes(1);
    });

    it("opens nudge suggestions through the prepared findings route", () => {
        const callbacks = makeCallbacks();
        const content = buildNudgeContent([{
            text: "Prepared suggestion",
            sourceLink: "notes/source.md",
            sourceTitle: "source",
        }], callbacks, "en");

        content.actions[0].callback();

        expect(callbacks.onExpandPanel).toHaveBeenCalledWith("prepared");
    });

    it("does not offer prepared suggestions when a nudge has no findings", () => {
        const callbacks = makeCallbacks();
        const content = buildNudgeContent([], callbacks, "en");

        expect(content.actions.map((action) => action.label)).toEqual(["Later"]);

        content.actions[0].callback();

        expect(callbacks.onExpandPanel).not.toHaveBeenCalled();
        expect(callbacks.onDismiss).toHaveBeenCalledTimes(1);
    });
});
