import { describe, expect, it, jest } from "@jest/globals";

import {
    buildAgentInsightDeliveryContent,
    buildOnboardingNudgeContent,
    buildPatternDetectionNudgeContent,
    buildNeedsSetupContent,
    buildPreparingContent,
    buildContextLimitedContent,
    buildIntentionallyQuietContent,
    buildReadyEmptyContent,
} from "../src/pagelet/bubble/BubbleContent";
import type { BubbleStateCallbacks } from "../src/pagelet/bubble/types";

function makeCallbacks(): BubbleStateCallbacks {
    return {
        onExpandPanel: jest.fn(),
        onSourceClick: jest.fn(),
        onDismiss: jest.fn(),
        onReviewCurrentNote: jest.fn(),
        onDiscoverConnections: jest.fn(),
        onPrepareMemory: jest.fn(),
        onQuickCapture: jest.fn(),
        onOpenSettings: jest.fn(),
    };
}

describe("Pagelet Bubble quick access content", () => {
    it("builds a source-backed Agent insight preview with the exact review receipt", () => {
        const candidate = {
            id: "agent-insight-1",
            kind: "review" as const,
            title: "Two project decisions now conflict",
            body: [
                "## Two project decisions now conflict",
                "The delivery decision and the older menu plan point in different directions.",
                "This full source-backed explanation is intentionally much longer than Bubble copy.",
            ].join("\n"),
            sourceRefs: [{ path: "Projects/Decision.md", title: "Decision" }],
            whyNow: ["This became visible after the anchor note changed."],
            preparedAt: "2026-07-31T12:00:00.000Z",
            staleStatus: "fresh" as const,
            route: { surface: "panel" as const, payloadType: "agent-insight" },
            deliveryReceipt: {
                version: 1 as const,
                kind: "review" as const,
                fingerprint: "v1:review:0000000000000121",
            },
        };
        const callbacks = {
            onView: jest.fn(),
            onLater: jest.fn(),
        };

        const content = buildAgentInsightDeliveryContent(candidate, callbacks, "en");

        expect(content).toMatchObject({
            type: "review-delivery",
            findings: [{
                text: candidate.title,
                sourceLink: "Projects/Decision.md",
                sourceTitle: "Decision",
            }],
            inlineHint: {
                text: candidate.whyNow[0],
                icon: "sparkles",
            },
            deliveryReceipt: candidate.deliveryReceipt,
        });
        expect(JSON.stringify(content.findings)).not.toContain(candidate.body);
        expect(content.actions.map((action) => action.label)).toEqual([
            "View insight",
            "Later",
        ]);

        content.actions[0]?.callback();
        content.actions[1]?.callback();
        expect(callbacks.onView).toHaveBeenCalledWith(candidate);
        expect(callbacks.onLater).toHaveBeenCalledWith(candidate);
    });

    it("builds Needs Setup with Prepare Memory and current-note fallback only", () => {
        const callbacks = makeCallbacks();
        const content = buildNeedsSetupContent(callbacks, "en");

        expect(content.actions.map((action) => action.label)).toEqual([
            "Prepare Memory",
            "Review this note",
        ]);
        expect(content.actions[0]).toMatchObject({
            primary: true,
        });

        content.actions[0].callback();
        content.actions[1].callback();

        expect(callbacks.onPrepareMemory).toHaveBeenCalledTimes(1);
        expect(callbacks.onReviewCurrentNote).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(content)).not.toContain("Generate summary");
        expect(JSON.stringify(content)).not.toContain("Review Queue");
    });

    it("builds preparing and context-limited explanation states", () => {
        const callbacks = makeCallbacks();
        const preparing = buildPreparingContent({ current: 47, total: 120 }, "en");
        const short = buildContextLimitedContent("short", callbacks, "en");
        const boundary = buildContextLimitedContent("boundary", callbacks, "en");

        expect(preparing.actions).toEqual([]);
        expect(preparing.findings[0].text).toContain("47/120");
        expect(short.actions.map((action) => action.label)).toEqual(["Capture a thought"]);
        expect(boundary.actions.map((action) => action.label)).toEqual(["View boundary settings"]);
    });

    it("shows Intentionally Quiet explanation once and can render minimal later", () => {
        const callbacks = makeCallbacks();
        const first = buildIntentionallyQuietContent(callbacks, false, "en");
        const later = buildIntentionallyQuietContent(callbacks, true, "en");

        expect(first.findings).toEqual([{ text: "PA is quiet unless you open it." }]);
        expect(later.findings).toEqual([]);
        expect(later.actions.map((action) => action.label)).toEqual(["Find related old notes"]);
    });

    it("renders Ready Empty teaching copy with the Discover action", () => {
        const callbacks = makeCallbacks();
        const first = buildReadyEmptyContent(callbacks, "en");

        expect(first.type).toBe("ready-empty");
        expect(first.findings).toHaveLength(2);
        expect(first.actions.map((action) => action.label)).toEqual(["Find related old notes"]);
    });

    it("renders one-time onboarding bridge nudges through Bubble content", () => {
        const nudge = {
            kind: "quick_capture" as const,
            generatedAt: "2026-07-02T12:00:00.000Z",
        };
        const callbacks = { onDismiss: jest.fn() };

        expect(buildOnboardingNudgeContent({
            pageletEnabled: true,
            proactiveHints: false,
            nudge,
        }, callbacks, "en")).toBeNull();

        const content = buildOnboardingNudgeContent({
            pageletEnabled: true,
            proactiveHints: true,
            nudge,
        }, callbacks, "en");

        expect(content?.findings).toEqual([{
            text: "Your thought is saved. PA will remind you when it becomes relevant to what you're writing.",
        }]);
        expect(content?.actions[0]).toMatchObject({
            label: "Got it",
            primary: true,
        });

        content?.actions[0].callback();
        expect(callbacks.onDismiss).toHaveBeenCalledWith(nudge);
    });

    it("renders pattern detection nudges only when enabled and routes to the pattern detail", () => {
        const result = {
            generatedAt: "2026-07-02T12:00:00.000Z",
            totalCount: 1,
            patterns: [{
                id: "pattern-recurring-tag",
                patternType: "recurring_tag" as const,
                title: "Recurring tag: #project",
                summary: "3 recent notes share #project.",
                sourceRefs: [{ path: "Projects/A.md", evidenceStrength: "medium" as const }],
                whyShown: ["At least 3 recent notes share #project."],
            }],
        };
        const callbacks = {
            onView: jest.fn(),
            onDismiss: jest.fn(),
        };

        expect(buildPatternDetectionNudgeContent({
            pageletEnabled: true,
            proactiveHints: false,
            result,
        }, callbacks, "en")).toBeNull();
        expect(buildPatternDetectionNudgeContent({
            pageletEnabled: true,
            proactiveHints: true,
            quietHoursActive: true,
            result,
        }, callbacks, "en")).toBeNull();

        const content = buildPatternDetectionNudgeContent({
            pageletEnabled: true,
            proactiveHints: true,
            result,
        }, callbacks, "en");

        expect(content?.findings).toEqual([{ text: "PA noticed 1 cross-note patterns." }]);
        expect(JSON.stringify(content)).not.toContain("Projects/A.md");
        expect(content?.actions.map((action) => action.label)).toEqual([
            "View patterns",
            "Dismiss",
        ]);

        content?.actions[0].callback();
        content?.actions[1].callback();

        expect(callbacks.onView).toHaveBeenCalledWith(result);
        expect(callbacks.onDismiss).toHaveBeenCalledWith(result);
    });
});
