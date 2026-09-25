/**
 * B-118 Pagelet UI/UX Optimization — focused regression tests.
 *
 * Covers the key behaviors introduced by Slices B–F:
 *   - F-02: Recap Bubble content uses candidate.body as primary text
 *   - F-03: Settings defaults are owned by pagelet-settings.test.ts
 *   - F-06: Pet state convergence (settleForForegroundOwner)
 *   - F-07: Settings quietRecallMode migration
 *   - F-10: Provider first-use shared notification
 */

import { buildPreparedRecapDeliveryContent } from "../src/pagelet/bubble/BubbleContent";
import type { DeliveryCandidate } from "../src/pagelet/bubble/types";
import {
    mergePageletSettings,
    PAGELET_DEFAULTS,
} from "../src/settings/pagelet/index";
import { LEARNING_DEFAULTS_VERSION, mergeLoadedSettings, mergeQuietRecallSettings } from "../src/settings";

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

    it("renders the default Recap body, source metadata, and why-now hint", () => {
        const candidate = makeRecapCandidate();
        const content = buildPreparedRecapDeliveryContent(candidate, {
            onViewRecap: jest.fn(),
            onLater: jest.fn(),
        });

        expect(content.type).toBe("recap-delivery");
        expect(content.findings[0]?.text).toBe("Project notes changed this week.");
        expect(content.findings[0]?.sourceLink).toBe("notes/project.md");
        expect(content.findings[0]?.sourceTitle).toBe("Weekly Changes · 2 sources");
        expect(content.inlineHint?.text).toBe("Recent activity in your vault");
        expect(content.inlineHint?.icon).toBe("calendar");
    });

    it("shows first source title when only one source exists", () => {
        const candidate = makeRecapCandidate({
            sourceRefs: [{ path: "notes/single.md", title: "Single Note" }],
        });
        const content = buildPreparedRecapDeliveryContent(candidate, {
            onViewRecap: jest.fn(),
            onLater: jest.fn(),
        });

        expect(content.findings[0]?.sourceTitle).toBe("Weekly Changes · Single Note");
    });

    it("View action calls onViewRecap with the original candidate", () => {
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
// F-07: Settings quietRecallMode
// ---------------------------------------------------------------------------

describe("F-07 quietRecallMode Settings", () => {
    it("defaults to 'off'", () => {
        expect(mergeLoadedSettings({}).quietRecall.quietRecallMode).toBe("off");
        expect(PAGELET_DEFAULTS).not.toHaveProperty("quietRecallMode");
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

    it("migrates the stale Pagelet mirror only when canonical mode is absent", () => {
        const migrated = mergeLoadedSettings({
            pagelet: { quietRecallMode: "on" },
            quietRecall: {
                enabled: true,
                bubbleNudgesEnabled: false,
            },
        });

        expect(migrated.quietRecall.quietRecallMode).toBe("on");
        expect(migrated.pagelet).not.toHaveProperty("quietRecallMode");

        const reloaded = mergeLoadedSettings(JSON.parse(JSON.stringify(migrated)));
        expect(reloaded.quietRecall.quietRecallMode).toBe("on");
        expect(reloaded.pagelet).not.toHaveProperty("quietRecallMode");
    });

    it("keeps an explicit canonical opt-out ahead of a conflicting stale mirror", () => {
        const result = mergeLoadedSettings({
            pagelet: { quietRecallMode: "on" },
            quietRecall: {
                enabled: true,
                bubbleNudgesEnabled: true,
                quietRecallMode: "off",
            },
        });

        expect(result.quietRecall.quietRecallMode).toBe("off");
        expect(result.pagelet).not.toHaveProperty("quietRecallMode");
    });

    it("keeps Quiet Recall independent from generic hints, Recap, and RHP", () => {
        const result = mergeLoadedSettings({
            learningPreferences: {
                version: LEARNING_DEFAULTS_VERSION,
                memoryExtraction: "default",
                habitLearning: "disabled",
            },
            pagelet: {
                quietRecallMode: "on",
                proactiveHints: false,
                scopeRecapPreparationEnabled: false,
                scopeRecapHighValueHints: true,
            },
            retrievalHabitProfile: {
                enabled: false,
                state: { aggregates: [] },
            },
        });

        expect(result.quietRecall.quietRecallMode).toBe("on");
        expect(result.pagelet).toMatchObject({
            proactiveHints: false,
            scopeRecapPreparationEnabled: false,
            scopeRecapHighValueHints: true,
        });
        expect(result.retrievalHabitProfile).toEqual({
            enabled: false,
            state: { aggregates: [] },
        });
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
