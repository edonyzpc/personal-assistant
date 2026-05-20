import { describe, expect, it, jest } from "@jest/globals";
import {
    getDefaultStatsRange,
    getStatisticsEmptyStateMessage,
    getStatisticsIssueMessage,
    selectRangeDays,
    shouldShowDevicesMetric,
} from "../src/components/Statistics";

jest.mock("obsidian");

describe("statistics dashboard helpers", () => {
    it("defaults compact containers to 30 days and wider containers to 90 days", () => {
        expect(getDefaultStatsRange(320)).toBe("30d");
        expect(getDefaultStatsRange(480)).toBe("30d");
        expect(getDefaultStatsRange(481)).toBe("90d");
        expect(getDefaultStatsRange(1024)).toBe("90d");
    });

    it("selects ranged chart days without trimming the all view", () => {
        const days = Array.from({ length: 100 }, (_, index) => index + 1);

        expect(selectRangeDays(days, "30d")).toEqual(days.slice(-30));
        expect(selectRangeDays(days, "90d")).toEqual(days.slice(-90));
        expect(selectRangeDays(days, "all")).toEqual(days);
    });

    it("shows device metrics only when sync has multi-device data", () => {
        expect(shouldShowDevicesMetric(false, 3)).toBe(false);
        expect(shouldShowDevicesMetric(true, 0)).toBe(false);
        expect(shouldShowDevicesMetric(true, 1)).toBe(false);
        expect(shouldShowDevicesMetric(true, 2)).toBe(true);
    });

    it("uses low-noise issue copy without storage internals", () => {
        expect(getStatisticsIssueMessage(0)).toBeNull();
        expect(getStatisticsIssueMessage(1)).toBe("1 Statistics history issue needs attention. Some writing history could not be loaded, so this view may be incomplete. Your notes are not affected.");
        expect(getStatisticsIssueMessage(2)).toBe("2 Statistics history issues need attention. Some writing history could not be loaded, so this view may be incomplete. Your notes are not affected.");
        expect(getStatisticsIssueMessage(2)).not.toMatch(/file|v2|shard|indexeddb|deviceid|jsonl/i);
    });

    it("distinguishes unavailable history from normal first use", () => {
        expect(getStatisticsEmptyStateMessage(0)).toBe("No statistics yet.");
        expect(getStatisticsEmptyStateMessage(1)).toBe("Statistics history is unavailable right now. Your notes are not affected.");
    });
});
