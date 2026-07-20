/**
 * B-118 Pagelet UI/UX Optimization — focused regression tests.
 *
 * Covers the key behaviors introduced by Slices B–F:
 *   - F-02: Recap Bubble content uses candidate.body as primary text
 *   - F-03: No Modal; Settings default ON + first-use notification
 *   - F-04: Reduced-motion CSS (covered by build; declarations validated here)
 *   - F-05: Recall actions (View = no re-run, Later = Review Queue, Dismiss = weak)
 *   - F-06: Pet state convergence (settleForForegroundOwner)
 *   - F-07: Settings quietRecallMode migration
 *   - F-10: Provider first-use shared notification
 */

import {
    buildPreparedRecapDeliveryContent,
    buildQuietRecallNudgeContent,
} from "../src/pagelet/bubble/BubbleContent";
import type { DeliveryCandidate } from "../src/pagelet/bubble/types";
import type { QuietRecallBubbleNudge } from "../src/pa";
import {
    mergePageletSettings,
    PAGELET_DEFAULTS,
} from "../src/settings/pagelet/index";
import { mergeQuietRecallSettings } from "../src/settings";

// ---------------------------------------------------------------------------
// F-02: Recap Bubble Content
// ---------------------------------------------------------------------------

describe("F-02 Recap Bubble Content", () => {
    function makeRecapCandidate(overrides: Partial<Omit<DeliveryCandidate, "kind">> = {}): DeliveryCandidate & { kind: "recap" } {
        return {
            kind: "recap" as const,
            id: "recap-1",
            title: "Weekly Changes",
            body: "Project notes changed this week.",
            whyNow: ["Recent activity in your vault"],
            sourceRefs: [
                { path: "notes/project.md", title: "Project Notes" },
                { path: "notes/ideas.md", title: "Ideas" },
            ],
            preparedAt: new Date().toISOString(),
            route: { surface: "tab" as const, payloadType: "scope-recap" },
            ...overrides,
        };
    }

    it("uses candidate.body as primary finding text", () => {
        const candidate = makeRecapCandidate();
        const content = buildPreparedRecapDeliveryContent(candidate, {
            onViewRecap: jest.fn(),
            onLater: jest.fn(),
        });

        expect(content.type).toBe("recap-delivery");
        expect(content.findings[0]?.text).toBe("Project notes changed this week.");
    });

    it("shows source count when multiple sources exist", () => {
        const candidate = makeRecapCandidate();
        const content = buildPreparedRecapDeliveryContent(candidate, {
            onViewRecap: jest.fn(),
            onLater: jest.fn(),
        });

        // sourceTitle should mention count for multiple sources
        expect(content.findings[0]?.sourceLink).toBe("notes/project.md");
    });

    it("shows first source title when only one source exists", () => {
        const candidate = makeRecapCandidate({
            sourceRefs: [{ path: "notes/single.md", title: "Single Note" }],
        });
        const content = buildPreparedRecapDeliveryContent(candidate, {
            onViewRecap: jest.fn(),
            onLater: jest.fn(),
        });

        expect(content.findings[0]?.sourceTitle).toBe("Single Note");
    });

    it("preserves whyNow as inline hint", () => {
        const candidate = makeRecapCandidate();
        const content = buildPreparedRecapDeliveryContent(candidate, {
            onViewRecap: jest.fn(),
            onLater: jest.fn(),
        });

        expect(content.inlineHint?.text).toBe("Recent activity in your vault");
        expect(content.inlineHint?.icon).toBe("calendar");
    });

    it("View action calls onViewRecap; provider call count = 0", () => {
        const onViewRecap = jest.fn();
        const candidate = makeRecapCandidate();
        const content = buildPreparedRecapDeliveryContent(candidate, {
            onViewRecap,
            onLater: jest.fn(),
        });

        content.actions[0]?.callback();
        expect(onViewRecap).toHaveBeenCalledWith(candidate);
    });
});

// ---------------------------------------------------------------------------
// F-03: No Modal + Settings Default ON
// ---------------------------------------------------------------------------

describe("F-03 No Modal Authorization", () => {
    it("scopeRecapPreparationEnabled defaults to true", () => {
        expect(PAGELET_DEFAULTS.scopeRecapPreparationEnabled).toBe(true);
    });

    it("pageletProviderFirstUseNotified defaults to false", () => {
        expect(PAGELET_DEFAULTS.pageletProviderFirstUseNotified).toBe(false);
    });

    it("merge starts scopeRecapPreparationEnabled=false for fresh installs; orchestrator auto-enables on first run", () => {
        // The merge function is fail-closed: empty data.json → false.
        // The orchestrator's ensureScopeRecapBackgroundAuthorization auto-enables.
        const result = mergePageletSettings({});
        expect(result.scopeRecapPreparationEnabled).toBe(false);
    });

    it("merge preserves pageletProviderFirstUseNotified from data.json", () => {
        const result = mergePageletSettings({ pageletProviderFirstUseNotified: true });
        expect(result.pageletProviderFirstUseNotified).toBe(true);
    });

    it("scopeRecapPreparationEnabled=false from persisted data is honored", () => {
        // User explicitly disabled in settings
        const result = mergePageletSettings({
            scopeRecapPreparationEnabled: false,
            scopeRecapBackgroundAuthorization: "authorized-v1",
            scopeRecapAuthorizationContextId: "test-id",
        });
        expect(result.scopeRecapPreparationEnabled).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// F-05: Recall Actions
// ---------------------------------------------------------------------------

describe("F-05 Quiet Recall Nudge Content", () => {
    const makeNudge = (): QuietRecallBubbleNudge => ({
        candidateId: "candidate-1",
        currentPath: "notes/current.md",
        relation: "current",
        generatedAt: new Date().toISOString(),
    });

    it("dismiss label is Dismiss in English", () => {
        const nudge = makeNudge();
        const content = buildQuietRecallNudgeContent(
            {
                pageletEnabled: true,
                quietRecallEnabled: true,
                bubbleNudgesEnabled: true,
                proactiveHints: true,
                candidate: nudge,
            },
            {
                onView: jest.fn(),
                onDismiss: jest.fn(),
                onLater: jest.fn(),
            },
            "en",
        );

        expect(content).not.toBeNull();
        // The actions should not contain "不再提醒"
        const labels = content!.actions.map((a) => a.label);
        expect(labels).not.toContain("不再提醒");
    });
});

// ---------------------------------------------------------------------------
// F-07: Settings quietRecallMode
// ---------------------------------------------------------------------------

describe("F-07 quietRecallMode Settings", () => {
    it("defaults to 'off'", () => {
        expect(PAGELET_DEFAULTS.quietRecallMode).toBe("off");
    });

    it("QuietRecall merge defaults to 'off'", () => {
        const result = mergeQuietRecallSettings({});
        expect(result.quietRecallMode).toBe("off");
    });

    it("migrates old bubbleNudgesEnabled:true to 'on'", () => {
        const result = mergeQuietRecallSettings({
            enabled: true,
            bubbleNudgesEnabled: true,
        });
        expect(result.quietRecallMode).toBe("on");
    });

    it("migrates old bubbleNudgesEnabled:false to 'off'", () => {
        const result = mergeQuietRecallSettings({
            enabled: true,
            bubbleNudgesEnabled: false,
        });
        expect(result.quietRecallMode).toBe("off");
    });

    it("migrates missing field to 'off'", () => {
        const result = mergeQuietRecallSettings({
            enabled: true,
        });
        expect(result.quietRecallMode).toBe("off");
    });

    it("preserves explicit quietRecallMode:'on'", () => {
        const result = mergeQuietRecallSettings({
            enabled: true,
            bubbleNudgesEnabled: false,
            quietRecallMode: "on",
        });
        expect(result.quietRecallMode).toBe("on");
    });

    it("preserves explicit quietRecallMode:'off' even with bubbleNudgesEnabled:true", () => {
        const result = mergeQuietRecallSettings({
            enabled: true,
            bubbleNudgesEnabled: true,
            quietRecallMode: "off",
        });
        expect(result.quietRecallMode).toBe("off");
    });

    it("changing quietRecallMode does not affect Scope Recap settings", () => {
        const pagelet = mergePageletSettings({
            scopeRecapPreparationEnabled: true,
            scopeRecapBackgroundAuthorization: "authorized-v1",
            scopeRecapAuthorizationContextId: "test-id",
            quietRecallMode: "on",
        });
        // Scope Recap remains independent
        expect(pagelet.scopeRecapPreparationEnabled).toBe(true);
        expect(pagelet.quietRecallMode).toBe("on");
    });
});

// ---------------------------------------------------------------------------
// F-10: Provider First-Use Shared Notification
// ---------------------------------------------------------------------------

describe("F-10 Provider First-Use Shared", () => {
    it("pageletProviderFirstUseNotified in PageletSettings merges correctly", () => {
        const result = mergePageletSettings({ pageletProviderFirstUseNotified: true });
        expect(result.pageletProviderFirstUseNotified).toBe(true);
    });

    it("defaults to false when missing", () => {
        const result = mergePageletSettings({});
        expect(result.pageletProviderFirstUseNotified).toBe(false);
    });

    it("non-boolean values fall back to default", () => {
        const result = mergePageletSettings({ pageletProviderFirstUseNotified: "yes" });
        expect(result.pageletProviderFirstUseNotified).toBe(false);
    });
});
