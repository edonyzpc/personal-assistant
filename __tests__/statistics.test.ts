import { describe, expect, it, jest } from "@jest/globals";
import { getDefaultStatsRange, selectRangeDays } from "../src/components/Statistics";

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
});
