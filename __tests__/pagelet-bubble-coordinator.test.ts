import { describe, expect, it, jest } from "@jest/globals";

import { BubbleCoordinator } from "../src/pagelet/BubbleCoordinator";
import type { BubbleContent } from "../src/pagelet/bubble/types";
import type { BubbleView } from "../src/pagelet/bubble/BubbleView";
import type { PageletHost } from "../src/pagelet/PageletHost";
import type { PetView } from "../src/pagelet/pet/PetView";
import { ProactiveHints } from "../src/pagelet/hints/ProactiveHints";
import { PreloadCache } from "../src/pagelet/preload/PreloadCache";
import type { ReviewQueueListFilter, ReviewQueueItem } from "../src/pa";

function makeHost(
    listReviewQueueItems: (filter?: ReviewQueueListFilter) => ReviewQueueItem[],
): PageletHost {
    return {
        settings: {
            pagelet: {
                enabled: true,
                onboardingShown: true,
                proactiveHints: true,
            },
            quietRecall: {
                enabled: true,
                bubbleNudgesEnabled: false,
            },
        },
        listReviewQueueItems,
        updatePageletSetting: jest.fn(),
    } as unknown as PageletHost;
}

function makeBubbleView(): BubbleView {
    return {
        bubbleState: "hidden",
        show: jest.fn(),
        close: jest.fn(),
    } as unknown as BubbleView;
}

function makePetView(): PetView {
    return {
        rootEl: {} as HTMLElement,
    } as unknown as PetView;
}

function makeCoordinator(
    listReviewQueueItems: (filter?: ReviewQueueListFilter) => ReviewQueueItem[],
): BubbleCoordinator {
    return new BubbleCoordinator(
        makeHost(listReviewQueueItems),
        new PreloadCache(),
        new ProactiveHints({
            enabled: true,
            cooldownMinutes: 30,
            quietHours: { enabled: false, start: "22:00", end: "08:00" },
        }),
        {
            onExpandPanel: jest.fn(),
            onSourceClick: jest.fn(),
            onDismiss: jest.fn(),
            onReviewCurrentNote: jest.fn(),
            onDiscoverConnections: jest.fn(),
            onPeriodicSummary: jest.fn(),
            getOnboardingNudge: () => null,
            onOnboardingNudgeDismiss: jest.fn(),
            getQuietRecallNudge: () => null,
            onQuietRecallView: jest.fn(),
            onQuietRecallLink: jest.fn(),
            onQuietRecallDismiss: jest.fn(),
            onQuietRecallLater: jest.fn(),
            getPatternDetectionNudge: () => null,
            onPatternDetectionView: jest.fn(),
            onPatternDetectionDismiss: jest.fn(),
        },
    );
}

function shownContent(bubbleView: BubbleView): BubbleContent {
    const show = bubbleView.show as unknown as jest.Mock;
    return show.mock.calls[0][0] as BubbleContent;
}

describe("BubbleCoordinator Review Queue reminders", () => {
    it("does not turn suggested Review Queue items into Bubble work", () => {
        const listReviewQueueItems = jest.fn((filter?: ReviewQueueListFilter) => {
            expect(filter?.statuses).toEqual(["accepted", "edited", "snoozed"]);
            return [];
        });
        const coordinator = makeCoordinator(listReviewQueueItems);
        const bubbleView = makeBubbleView();

        coordinator.showBubble(bubbleView, makePetView());

        const content = shownContent(bubbleView);
        expect(content.type).toBe("empty");
        expect(content.findings[0]?.text).not.toContain("Review Queue");
        expect(content.findings[0]?.text).not.toContain("waiting");
        expect(listReviewQueueItems).toHaveBeenCalledTimes(1);
    });

    it("shows a soft later-items reminder only for user-kept Review Queue states", () => {
        const listReviewQueueItems = jest.fn((filter?: ReviewQueueListFilter) => {
            expect(filter?.statuses).toEqual(["accepted", "edited", "snoozed"]);
            return [
                { id: "rq-accepted", status: "accepted", admissionReason: "user_kept_for_later" },
                { id: "rq-snoozed", status: "snoozed", admissionReason: "user_kept_for_later" },
                { id: "rq-legacy", status: "snoozed", admissionReason: "legacy_pre_refactor" },
            ] as ReviewQueueItem[];
        });
        const coordinator = makeCoordinator(listReviewQueueItems);
        const bubbleView = makeBubbleView();

        coordinator.showBubble(bubbleView, makePetView());

        const content = shownContent(bubbleView);
        expect(content.type).toBe("nudge");
        expect(content.findings).toEqual([{ text: "You kept 2 items for later." }]);
        expect(content.findings[0]?.text).not.toContain("Review Queue");
        expect(content.actions[0]).toMatchObject({
            label: "View later items",
            description: "Open the items you kept",
            primary: true,
        });
    });
});
