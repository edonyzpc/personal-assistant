import { describe, expect, it, jest } from "@jest/globals";
import { normalizeStatisticsView } from "../src/stats/stats-store";

jest.mock("obsidian");

describe("statistics view compatibility", () => {
    it("maps legacy statistics view names to dashboard views", () => {
        expect(normalizeStatisticsView("none")).toBe("overview");
        expect(normalizeStatisticsView("daily")).toBe("daily");
        expect(normalizeStatisticsView("total")).toBe("growth");
        expect(normalizeStatisticsView("composition")).toBe("composition");
    });
});
