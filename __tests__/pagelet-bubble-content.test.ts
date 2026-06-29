import { describe, expect, it, jest } from "@jest/globals";

import {
    buildDiscoveryContent,
    buildEmptyContent,
    buildNudgeContent,
    buildQuickReviewContent,
    buildQuietRecallNudgeContent,
    buildReviewQueueNudgeContent,
    buildWeeklyReviewNudgeContent,
} from "../src/pagelet/bubble/BubbleContent";
import type { BubbleQuickAccessCallbacks } from "../src/pagelet/bubble/types";

function makeCallbacks(): BubbleQuickAccessCallbacks {
    return {
        onExpandPanel: jest.fn(),
        onSourceClick: jest.fn(),
        onDismiss: jest.fn(),
        onReviewCurrentNote: jest.fn(),
        onDiscoverConnections: jest.fn(),
        onPeriodicSummary: jest.fn(),
        onWeeklyReview: jest.fn(),
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

    it("keeps Review Queue bubbles lightweight while preserving quick access actions", () => {
        const callbacks = makeCallbacks();
        const content = buildReviewQueueNudgeContent(3, callbacks, "en");

        expect(content.findings).toEqual([{
            text: "You kept 3 items for later.",
        }]);
        expect(content.findings[0].text).not.toContain("fullProviderOutput");
        expect(content.findings[0].text).not.toContain("Review Queue");
        expect(content.actions.map((action) => action.label)).toEqual([
            "View later items",
            "Later",
            "Review current note",
            "Discover connections",
            "Generate summary",
        ]);
        expect(content.actions[0]).toMatchObject({
            description: "Open the items you kept",
            icon: "bookmark-check",
            primary: true,
        });
        expect(content.actions[1]).toMatchObject({
            variant: "compact",
        });
        expect(content.actions[2].primary).toBe(false);

        content.actions[0].callback();
        content.actions[1].callback();
        content.actions[2].callback();
        content.actions[3].callback();
        content.actions[4].callback();

        expect(callbacks.onExpandPanel).toHaveBeenCalledWith("review");
        expect(callbacks.onDismiss).toHaveBeenCalledTimes(1);
        expect(callbacks.onReviewCurrentNote).toHaveBeenCalledTimes(1);
        expect(callbacks.onDiscoverConnections).toHaveBeenCalledTimes(1);
        expect(callbacks.onPeriodicSummary).toHaveBeenCalledTimes(1);
    });

    it("does not offer prepared suggestions when a nudge has no findings", () => {
        const callbacks = makeCallbacks();
        const content = buildNudgeContent([], callbacks, "en");

        expect(content.actions.map((action) => action.label)).toEqual(["Later"]);

        content.actions[0].callback();

        expect(callbacks.onExpandPanel).not.toHaveBeenCalled();
        expect(callbacks.onDismiss).toHaveBeenCalledTimes(1);
    });

    it("shows Weekly Review hints only after opt-in and routes to the detail tab command", () => {
        const callbacks = makeCallbacks();

        expect(buildWeeklyReviewNudgeContent({
            pageletEnabled: true,
            preparedReviewEnabled: false,
            proactiveHints: true,
            count: 3,
        }, callbacks, "en")).toBeNull();
        expect(buildWeeklyReviewNudgeContent({
            pageletEnabled: true,
            preparedReviewEnabled: true,
            proactiveHints: false,
            count: 3,
        }, callbacks, "en")).toBeNull();
        expect(buildWeeklyReviewNudgeContent({
            pageletEnabled: true,
            preparedReviewEnabled: true,
            proactiveHints: true,
            quietHoursActive: true,
            count: 3,
        }, callbacks, "en")).toBeNull();

        const content = buildWeeklyReviewNudgeContent({
            pageletEnabled: true,
            preparedReviewEnabled: true,
            proactiveHints: true,
            count: 3,
        }, callbacks, "en");

        expect(content?.findings).toEqual([{ text: "Weekly Review is ready with 3 items." }]);
        expect(content?.findings[0].text).not.toContain("Saved insights");
        expect(content?.actions[0]).toMatchObject({
            label: "Open Weekly Review",
            description: "Review selected-only sections in Pagelet",
            icon: "calendar-check",
            primary: true,
        });
        expect(content?.actions.map((action) => action.label)).toEqual([
            "Open Weekly Review",
            "Later",
            "Review current note",
            "Discover connections",
            "Generate summary",
        ]);

        content?.actions[0].callback();
        content?.actions[1].callback();
        content?.actions[2].callback();
        content?.actions[3].callback();
        content?.actions[4].callback();

        expect(callbacks.onWeeklyReview).toHaveBeenCalledTimes(1);
        expect(callbacks.onExpandPanel).not.toHaveBeenCalled();
        expect(callbacks.onDismiss).toHaveBeenCalledTimes(1);
        expect(callbacks.onReviewCurrentNote).toHaveBeenCalledTimes(1);
        expect(callbacks.onDiscoverConnections).toHaveBeenCalledTimes(1);
        expect(callbacks.onPeriodicSummary).toHaveBeenCalledTimes(1);
    });

    it("keeps Quiet Recall Bubble nudges disabled by default and gated by proactive hints", () => {
        const candidate = {
            candidateId: "qr-ins-1",
            sourceInsightId: "ins-1",
            relation: "current" as const,
            generatedAt: "2026-06-29T12:00:00.000Z",
        };
        const recallCallbacks = {
            onView: jest.fn(),
            onDismiss: jest.fn(),
            onLater: jest.fn(),
        };

        expect(buildQuietRecallNudgeContent({
            pageletEnabled: true,
            quietRecallEnabled: true,
            bubbleNudgesEnabled: false,
            proactiveHints: true,
            candidate,
        }, recallCallbacks, "en")).toBeNull();
        expect(buildQuietRecallNudgeContent({
            pageletEnabled: true,
            quietRecallEnabled: true,
            bubbleNudgesEnabled: true,
            proactiveHints: false,
            candidate,
        }, recallCallbacks, "en")).toBeNull();
        expect(buildQuietRecallNudgeContent({
            pageletEnabled: true,
            quietRecallEnabled: true,
            bubbleNudgesEnabled: true,
            proactiveHints: true,
            quietHoursActive: true,
            candidate,
        }, recallCallbacks, "en")).toBeNull();
    });

    it("renders Quiet Recall nudges as route-only View, Dismiss, and Later actions", () => {
        const candidate = {
            candidateId: "qr-ins-1",
            sourceInsightId: "ins-1",
            relation: "related" as const,
            generatedAt: "2026-06-29T12:00:00.000Z",
        };
        const recallCallbacks = {
            onView: jest.fn(),
            onDismiss: jest.fn(),
            onLater: jest.fn(),
        };

        const content = buildQuietRecallNudgeContent({
            pageletEnabled: true,
            quietRecallEnabled: true,
            bubbleNudgesEnabled: true,
            proactiveHints: true,
            candidate,
        }, recallCallbacks, "en");

        expect(content?.findings).toEqual([{
            text: "A saved insight may connect to nearby notes.",
        }]);
        expect(JSON.stringify(content)).not.toContain("Projects/Alpha.md");
        expect(JSON.stringify(content)).not.toContain("Small weekly rituals");
        expect(content?.actions.map((action) => action.label)).toEqual([
            "View",
            "Dismiss",
            "Later",
        ]);

        content?.actions[0].callback();
        content?.actions[1].callback();
        content?.actions[2].callback();

        expect(recallCallbacks.onView).toHaveBeenCalledWith(candidate);
        expect(recallCallbacks.onDismiss).toHaveBeenCalledWith(candidate);
        expect(recallCallbacks.onLater).toHaveBeenCalledWith(candidate);
    });
});
