import { describe, it, expect } from "@jest/globals";
import { cosineDistance, l2Distance, bruteForceTopK } from "../src/vss/brute-force-search";

describe("cosineDistance", () => {
    it("returns 0 for identical vectors", () => {
        const v = new Float32Array([1, 2, 3]);
        expect(cosineDistance(v, v)).toBeCloseTo(0, 5);
    });

    it("returns 1 for orthogonal vectors", () => {
        const a = new Float32Array([1, 0]);
        const b = new Float32Array([0, 1]);
        expect(cosineDistance(a, b)).toBeCloseTo(1, 5);
    });

    it("returns 2 for opposite vectors", () => {
        const a = new Float32Array([1, 0, 0]);
        const b = new Float32Array([-1, 0, 0]);
        expect(cosineDistance(a, b)).toBeCloseTo(2, 5);
    });

    it("returns 1 when one vector is zero", () => {
        const a = new Float32Array([1, 2, 3]);
        const zero = new Float32Array([0, 0, 0]);
        expect(cosineDistance(a, zero)).toBe(1);
    });

    it("returns 1 when both vectors are zero", () => {
        const zero = new Float32Array([0, 0, 0]);
        expect(cosineDistance(zero, zero)).toBe(1);
    });

    it("handles negative components correctly", () => {
        const a = new Float32Array([1, -1]);
        const b = new Float32Array([-1, 1]);
        expect(cosineDistance(a, b)).toBeCloseTo(2, 5);
    });
});

describe("l2Distance", () => {
    it("returns 0 for identical vectors", () => {
        const v = new Float32Array([3, 4, 5]);
        expect(l2Distance(v, v)).toBe(0);
    });

    it("returns correct distance for unit vectors", () => {
        const a = new Float32Array([0, 0]);
        const b = new Float32Array([3, 4]);
        expect(l2Distance(a, b)).toBeCloseTo(5, 5);
    });

    it("returns correct distance for negative components", () => {
        const a = new Float32Array([-1, -1]);
        const b = new Float32Array([1, 1]);
        expect(l2Distance(a, b)).toBeCloseTo(Math.sqrt(8), 5);
    });

    it("handles zero vectors", () => {
        const zero = new Float32Array([0, 0, 0]);
        expect(l2Distance(zero, zero)).toBe(0);
    });
});

describe("bruteForceTopK", () => {
    function makeCache(vectors: number[][]): Map<number, Float32Array> {
        const cache = new Map<number, Float32Array>();
        vectors.forEach((v, i) => cache.set(i + 1, new Float32Array(v)));
        return cache;
    }

    it("returns top-k closest vectors by cosine distance", () => {
        const query = new Float32Array([1, 0, 0]);
        const cache = makeCache([
            [1, 0, 0],    // id=1, distance ~0
            [0, 1, 0],    // id=2, distance ~1
            [0.9, 0.1, 0], // id=3, distance small
            [-1, 0, 0],   // id=4, distance ~2
        ]);

        const results = bruteForceTopK(query, cache, 2, "COSINE");
        expect(results).toHaveLength(2);
        expect(results[0].id).toBe(1);
        expect(results[1].id).toBe(3);
    });

    it("returns top-k closest vectors by L2 distance", () => {
        const query = new Float32Array([0, 0]);
        const cache = makeCache([
            [1, 0],   // id=1, distance=1
            [3, 4],   // id=2, distance=5
            [0.5, 0], // id=3, distance=0.5
        ]);

        const results = bruteForceTopK(query, cache, 2, "L2");
        expect(results).toHaveLength(2);
        expect(results[0].id).toBe(3);
        expect(results[1].id).toBe(1);
    });

    it("returns results sorted by distance ascending", () => {
        const query = new Float32Array([1, 0]);
        const cache = makeCache([
            [0, 1],       // id=1
            [-1, 0],      // id=2
            [0.5, 0.5],   // id=3
            [0.9, 0.1],   // id=4
            [1, 0],       // id=5
        ]);

        const results = bruteForceTopK(query, cache, 5, "COSINE");
        for (let i = 1; i < results.length; i++) {
            expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
        }
    });

    it("handles k > cache size gracefully", () => {
        const query = new Float32Array([1, 0]);
        const cache = makeCache([
            [1, 0],
            [0, 1],
        ]);

        const results = bruteForceTopK(query, cache, 10, "COSINE");
        expect(results).toHaveLength(2);
    });

    it("handles k = 0", () => {
        const query = new Float32Array([1, 0]);
        const cache = makeCache([[1, 0]]);
        expect(bruteForceTopK(query, cache, 0, "COSINE")).toEqual([]);
    });

    it("handles empty cache", () => {
        const query = new Float32Array([1, 0]);
        const cache = new Map<number, Float32Array>();
        expect(bruteForceTopK(query, cache, 5, "COSINE")).toEqual([]);
    });

    it("handles zero query vector", () => {
        const query = new Float32Array([0, 0, 0]);
        const cache = makeCache([
            [1, 0, 0],
            [0, 1, 0],
        ]);

        const results = bruteForceTopK(query, cache, 2, "COSINE");
        expect(results).toHaveLength(2);
        results.forEach((r) => expect(r.distance).toBe(1));
    });

    it("handles identical vectors in cache (distance = 0)", () => {
        const query = new Float32Array([1, 2, 3]);
        const cache = new Map<number, Float32Array>();
        cache.set(10, new Float32Array([1, 2, 3]));
        cache.set(20, new Float32Array([1, 2, 3]));

        const results = bruteForceTopK(query, cache, 2, "COSINE");
        expect(results).toHaveLength(2);
        expect(results[0].distance).toBeCloseTo(0, 5);
        expect(results[1].distance).toBeCloseTo(0, 5);
    });

    it("defaults to COSINE metric", () => {
        const query = new Float32Array([1, 0]);
        const cache = makeCache([[0, 1], [1, 0]]);

        const results = bruteForceTopK(query, cache, 1);
        expect(results[0].id).toBe(2);
        expect(results[0].distance).toBeCloseTo(0, 5);
    });
});
