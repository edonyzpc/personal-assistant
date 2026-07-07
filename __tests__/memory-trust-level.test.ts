import { getMemoryTrustLevel, MEMORY_TRUST_THRESHOLDS } from "../src/pa/memory-trust-level";

describe("memory trust level", () => {
    it("returns level 0 for counts below level1 threshold", () => {
        expect(getMemoryTrustLevel(0)).toBe(0);
        expect(getMemoryTrustLevel(1)).toBe(0);
        expect(getMemoryTrustLevel(9)).toBe(0);
    });

    it("returns level 1 for counts at or above level1 but below level2", () => {
        expect(getMemoryTrustLevel(10)).toBe(1);
        expect(getMemoryTrustLevel(15)).toBe(1);
        expect(getMemoryTrustLevel(29)).toBe(1);
    });

    it("returns level 2 for counts at or above level2", () => {
        expect(getMemoryTrustLevel(30)).toBe(2);
        expect(getMemoryTrustLevel(100)).toBe(2);
        expect(getMemoryTrustLevel(999)).toBe(2);
    });

    it("boundary: level1 threshold is exactly 10", () => {
        expect(getMemoryTrustLevel(MEMORY_TRUST_THRESHOLDS.level1 - 1)).toBe(0);
        expect(getMemoryTrustLevel(MEMORY_TRUST_THRESHOLDS.level1)).toBe(1);
    });

    it("boundary: level2 threshold is exactly 30", () => {
        expect(getMemoryTrustLevel(MEMORY_TRUST_THRESHOLDS.level2 - 1)).toBe(1);
        expect(getMemoryTrustLevel(MEMORY_TRUST_THRESHOLDS.level2)).toBe(2);
    });
});
