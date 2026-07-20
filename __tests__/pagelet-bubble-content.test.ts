import { describe, expect, it, jest } from "@jest/globals";

import {
    buildDiscoveryContent,
    buildEmptyContent,
    buildPreparedRecapDeliveryContent,
    buildRecallDeliveryContent,
    buildNudgeContent,
    buildOnboardingNudgeContent,
    buildPatternDetectionNudgeContent,
    buildQuickReviewContent,
    buildQuietRecallNudgeContent,
    buildNeedsSetupContent,
    buildPreparingContent,
    buildContextLimitedContent,
    buildIntentionallyQuietContent,
    buildLocalDiscoveryClueContent,
} from "../src/pagelet/bubble/BubbleContent";
import {
    quietRecallCandidateToDeliveryCandidate,
    quietRecallCandidateToDiscoveryCandidate,
} from "../src/pagelet/bubble/recall-card";
import { scopeRecapToDeliveryCandidate } from "../src/pagelet/bubble/recap-card";
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
    it("adapts QuietRecallCandidate into a DeliveryCandidate", () => {
        const candidate = {
            id: "recall-1",
            title: "Recall: Alpha",
            summary: "Alpha may matter again.",
            sourceRefs: [{ path: "Projects/Alpha.md", generatedAt: "2026-07-05T12:00:00.000Z" }],
            whyNow: ["Source appears near the current note in Memory search."],
            nextAction: "Open the source note.",
            relation: "related" as const,
            score: 82,
            generatedAt: "2026-07-05T12:00:00.000Z",
            evaluationProvenance: "ai" as const,
            evaluationFingerprint: "recall-evaluation-1",
        };

        expect(quietRecallCandidateToDeliveryCandidate(candidate)).toEqual({
            id: "recall-1",
            kind: "recall",
            title: "Recall: Alpha",
            body: "Alpha may matter again.",
            sourceRefs: [{ path: "Projects/Alpha.md", title: "Alpha" }],
            whyNow: ["Source appears near the current note in Memory search."],
            preparedAt: "2026-07-05T12:00:00.000Z",
            staleStatus: "fresh",
            route: { surface: "tab", payloadType: "quiet-recall" },
        });
        expect(quietRecallCandidateToDiscoveryCandidate(candidate)).toBeNull();
    });

    it("fails closed when a Quiet Recall candidate has not passed AI evaluation", () => {
        const candidate = {
            id: "recall-local",
            title: "Recall: Local match",
            summary: "A local similarity match.",
            sourceRefs: [{ path: "Projects/Local.md" }],
            whyNow: ["A local ranking template."],
            nextAction: "Discover the source.",
            relation: "related" as const,
            score: 90,
            generatedAt: "2026-07-05T12:00:00.000Z",
            evaluationProvenance: "local" as const,
        };

        expect(quietRecallCandidateToDeliveryCandidate(candidate)).toBeNull();
        expect(quietRecallCandidateToDiscoveryCandidate(candidate)).toEqual({
            id: "recall-local",
            sourceRefs: [{ path: "Projects/Local.md", title: "Local" }],
            relation: "related",
            preparedAt: "2026-07-05T12:00:00.000Z",
        });
    });

    it("builds a provenance-labeled local Discover clue without Recall why-now or stack UI", () => {
        const candidate = quietRecallCandidateToDiscoveryCandidate({
            id: "recall-local",
            title: "Recall: Local match",
            summary: "LOCAL SUMMARY MUST NOT RENDER",
            sourceRefs: [{ path: "Projects/Local.md" }],
            whyNow: ["LOCAL WHY NOW MUST NOT RENDER"],
            nextAction: "LOCAL NEXT ACTION MUST NOT RENDER",
            relation: "related",
            score: 90,
            generatedAt: "2026-07-05T12:00:00.000Z",
            evaluationProvenance: "local",
        });
        expect(candidate).not.toBeNull();
        const callbacks = {
            onOpen: jest.fn(),
            onLinkToCurrent: jest.fn(),
            canLinkToCurrent: jest.fn(() => true),
            onLater: jest.fn(),
        };

        const en = buildLocalDiscoveryClueContent(candidate!, callbacks, "en");
        const zh = buildLocalDiscoveryClueContent(candidate!, callbacks, "zh");

        expect(en.type).toBe("discovery");
        expect(en.cards).toBeUndefined();
        expect(en.inlineHint).toBeUndefined();
        expect(en.findings).toEqual([
            { text: "Local related clue" },
            {
                text: "Related by local note signals.",
                sourceLink: "Projects/Local.md",
                sourceTitle: "Local",
            },
        ]);
        expect(zh.findings[0]?.text).toBe("本地关联线索");
        expect(zh.findings[1]?.text).toBe("由本地笔记信号关联。");
        expect(JSON.stringify(en)).not.toContain("LOCAL WHY NOW MUST NOT RENDER");
        expect(JSON.stringify(en)).not.toContain("LOCAL SUMMARY MUST NOT RENDER");
        expect(en.actions.map((action) => action.label)).toEqual([
            "Open source note",
            "Link",
            "Later",
        ]);
    });

    it("fails closed when AI provenance lacks its exact evaluation fingerprint", () => {
        expect(quietRecallCandidateToDeliveryCandidate({
            id: "recall-ai-without-fingerprint",
            title: "Recall: Unproven",
            summary: "This candidate cannot prove which evaluation accepted it.",
            whyNow: ["It should stay silent."],
            sourceRefs: [{ path: "notes/source.md" }],
            relation: "related",
            score: 90,
            nextAction: "Open the source note.",
            generatedAt: "2026-07-05T12:00:00.000Z",
            evaluationProvenance: "ai",
        })).toBeNull();
    });

    it("adapts fresh ScopeRecap artifacts into Recap Delivery candidates", () => {
        const recap = {
            id: "recap-1",
            scope: { kind: "folder" as const, label: "Projects/PA", paths: ["Projects/PA"] },
            sourceSnapshotId: "recap-snapshot-1",
            generatedAt: "2026-07-05T12:00:00.000Z",
            ttlDays: 7,
            staleStatus: "fresh" as const,
            sourceCoverage: {
                totalSourceCount: 2,
                includedSourceCount: 2,
                skippedSourceCount: 0,
                coverageRatio: 1,
            },
            skippedSources: [],
            summary: {
                id: "summary",
                section: "summary" as const,
                title: "Short recap",
                summary: "The project moved from feature menu to delivery.",
                sourceRefs: [{ path: "Projects/PA/A.md", generatedAt: "2026-07-05T12:00:00.000Z" }],
                generatedAt: "2026-07-05T12:00:00.000Z",
                generatedHelper: true as const,
                status: "candidate" as const,
            },
            themes: [],
            tensions: [{
                id: "tension",
                section: "tension" as const,
                title: "Delivery and menu designs conflict",
                summary: "A.md moves toward direct delivery while B.md still assumes a feature menu, so the interaction contract needs one decision.",
                whyItMatters: "Shipping both interaction models would make Pagelet feel unpredictable.",
                sourceRefs: [
                    { path: "Projects/PA/A.md", generatedAt: "2026-07-05T12:00:00.000Z" },
                    { path: "Projects/PA/B.md", generatedAt: "2026-07-05T12:00:00.000Z" },
                ],
                generatedAt: "2026-07-05T12:00:00.000Z",
                generatedHelper: true as const,
                status: "candidate" as const,
            }],
            openQuestions: [],
            nextReviewActions: [],
            sourceRefs: [
                { path: "Projects/PA/A.md", generatedAt: "2026-07-05T12:00:00.000Z" },
                { path: "Projects/PA/B.md", generatedAt: "2026-07-05T12:00:00.000Z" },
            ],
            dataBoundarySnapshotId: "data_boundary:scope_recap",
        };

        expect(scopeRecapToDeliveryCandidate(recap)).toMatchObject({
            id: expect.stringMatching(/^recap-insight-/),
            kind: "recap",
            title: "Delivery and menu designs conflict",
            body: "A.md moves toward direct delivery while B.md still assumes a feature menu, so the interaction contract needs one decision.",
            sourceRefs: [
                { path: "Projects/PA/A.md", title: "A" },
                { path: "Projects/PA/B.md", title: "B" },
            ],
            staleStatus: "fresh",
            route: { surface: "tab", payloadType: "scope-recap" },
        });

        expect(scopeRecapToDeliveryCandidate({
            ...recap,
            staleStatus: "stale",
        })).toBeNull();

        expect(scopeRecapToDeliveryCandidate({
            ...recap,
            tensions: [],
        })).toBeNull();

        expect(scopeRecapToDeliveryCandidate({
            ...recap,
            tensions: [{
                ...recap.tensions[0],
                sourceRefs: recap.tensions[0].sourceRefs.slice(0, 1),
            }],
        })).toMatchObject({
            kind: "recap",
            title: "Delivery and menu designs conflict",
            sourceRefs: [{ path: "Projects/PA/A.md", title: "A" }],
        });
    });

    it.each([
        ["discovery", (callbacks: BubbleStateCallbacks) => buildDiscoveryContent([{
            text: "Related note found",
            sourceLink: "notes/related.md",
            sourceTitle: "related",
        }], callbacks, "en")],
        ["empty", (callbacks: BubbleStateCallbacks) => buildEmptyContent(callbacks, "en")],
    ])("does not offer Generate summary from %s bubbles", (_name, buildContent) => {
        const callbacks = makeCallbacks();
        const content = buildContent(callbacks);

        expect(content.actions.map((action) => action.label)).not.toContain("Generate summary");
        expect(content.actions.map((action) => action.label)).toContain("Find related old notes");

        const discover = content.actions.find((action) => action.label === "Find related old notes");
        discover?.callback();

        expect(callbacks.onDiscoverConnections).toHaveBeenCalledTimes(1);
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
            "Find related old notes",
        ]);
        expect(content.actions[0]).toMatchObject({
            description: "Open prepared findings",
            icon: "panel-right-open",
            primary: true,
        });
        expect(content.actions[1].primary).toBe(false);

        content.actions[0].callback();
        content.actions[1].callback();

        expect(callbacks.onExpandPanel).toHaveBeenCalledWith("prepared");
        expect(callbacks.onDiscoverConnections).toHaveBeenCalledTimes(1);
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

    it("does not offer prepared suggestions when a nudge has no findings", () => {
        const callbacks = makeCallbacks();
        const content = buildNudgeContent([], callbacks, "en");

        expect(content.actions.map((action) => action.label)).toEqual(["Later"]);

        content.actions[0].callback();

        expect(callbacks.onExpandPanel).not.toHaveBeenCalled();
        expect(callbacks.onDismiss).toHaveBeenCalledTimes(1);
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
            onLink: jest.fn(),
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
            onLink: jest.fn(),
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
        expect(content?.type).toBe("recall-delivery");
        expect(content?.actions.map((action) => action.label)).toEqual([
            "View",
            "Link",
            "Later",
        ]);

        content?.actions[0].callback();
        content?.actions[1].callback();
        content?.actions[2].callback();

        expect(recallCallbacks.onView).toHaveBeenCalledWith(candidate);
        expect(recallCallbacks.onLink).toHaveBeenCalledWith(candidate);
        expect(recallCallbacks.onLater).toHaveBeenCalledWith(candidate);
    });

    it("builds source-backed Recall Delivery content from a delivery candidate", () => {
        const candidate = {
            id: "recall-1",
            kind: "recall" as const,
            title: "Old project decision",
            body: "This note may connect to an older decision.",
            sourceRefs: [{ path: "Projects/Decision.md", title: "Decision" }],
            whyNow: ["The current note mentions the same project."],
            preparedAt: "2026-07-05T12:00:00.000Z",
            route: { surface: "tab" as const, payloadType: "quiet-recall" },
        };
        const callbacks = {
            onOpen: jest.fn(),
            onLinkToCurrent: jest.fn(),
            onLater: jest.fn(),
        };

        const content = buildRecallDeliveryContent(candidate, callbacks, "en");

        expect(content.type).toBe("recall-delivery");
        expect(content.findings).toEqual([{
            text: "This note may connect to an older decision.",
            sourceLink: "Projects/Decision.md",
            sourceTitle: "Decision",
        }]);
        expect(content.inlineHint?.text).toBe("The current note mentions the same project.");
        expect(content.actions.map((action) => action.label)).toEqual([
            "Open source note",
            "Link",
            "Later",
        ]);

        content.actions[0].callback();
        content.actions[1].callback();
        content.actions[2].callback();

        expect(callbacks.onOpen).toHaveBeenCalledWith(candidate);
        expect(callbacks.onLinkToCurrent).toHaveBeenCalledWith(candidate);
        expect(callbacks.onLater).toHaveBeenCalledWith(candidate);
    });

    it("builds prepared Recap Delivery without foreground generation copy", () => {
        const candidate = {
            id: "recap-1",
            kind: "recap" as const,
            title: "Project recap",
            body: "Project notes changed this week.",
            sourceRefs: [{ path: "Projects/A.md", title: "A" }],
            whyNow: ["5 source notes changed in this scope."],
            preparedAt: "2026-07-05T12:00:00.000Z",
            staleStatus: "fresh" as const,
            route: { surface: "tab" as const, payloadType: "scope-recap" },
        };
        const callbacks = {
            onViewRecap: jest.fn(),
            onLater: jest.fn(),
        };

        const content = buildPreparedRecapDeliveryContent(candidate, callbacks, "en");

        expect(content.type).toBe("recap-delivery");
        expect(content.findings[0]?.text).toBe("Project notes changed this week.");
        expect(JSON.stringify(content)).not.toContain("Generate summary");
        expect(content.actions.map((action) => action.label)).toEqual(["View recap", "Later"]);

        content.actions[0].callback();
        content.actions[1].callback();

        expect(callbacks.onViewRecap).toHaveBeenCalledWith(candidate);
        expect(callbacks.onLater).toHaveBeenCalledWith(candidate);
    });

    it("adds the first-use Quiet Recall explanation when requested", () => {
        const candidate = {
            candidateId: "qr-vault-1",
            relation: "current" as const,
            generatedAt: "2026-07-02T12:00:00.000Z",
            onboardingExplanation: true,
        };
        const content = buildQuietRecallNudgeContent({
            pageletEnabled: true,
            quietRecallEnabled: true,
            bubbleNudgesEnabled: true,
            proactiveHints: true,
            candidate,
        }, {
            onView: jest.fn(),
            onLink: jest.fn(),
            onDismiss: jest.fn(),
            onLater: jest.fn(),
        }, "en");

        expect(content?.findings.map((finding) => finding.text)).toEqual([
            "A saved insight may fit the note you are viewing.",
            "PA found a note you wrote before that may be relevant now. Click to see why.",
        ]);
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
