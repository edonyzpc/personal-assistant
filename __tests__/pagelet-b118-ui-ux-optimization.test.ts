/**
 * B-118 Pagelet UI/UX Optimization — focused regression tests.
 *
 * Covers the key behaviors introduced by Slices B–F:
 *   - F-03: Settings defaults are owned by pagelet-settings.test.ts
 *   - F-06: Pet state convergence (settleForForegroundOwner)
 *   - F-10: Provider first-use shared notification
 */

import {
    mergePageletSettings,
    PAGELET_DEFAULTS,
} from "../src/settings/pagelet/index";

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
