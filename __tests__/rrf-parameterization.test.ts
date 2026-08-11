import { describe, expect, it } from '@jest/globals';

import { fuseRRF, RRF_K } from '../src/vss/rrf';

describe('parameterized RRF', () => {
    it('keeps the existing defaults backward compatible', () => {
        const result = fuseRRF([[10, 20], [20, 30]], 10);

        expect(result.get(10)).toBeCloseTo(1 / (RRF_K + 1), 12);
        expect(result.get(20)).toBeCloseTo(1 / (RRF_K + 2) + 1 / (RRF_K + 1), 12);
        expect(result.get(30)).toBeCloseTo(1 / (RRF_K + 2), 12);
    });

    it('applies a calibrated k and per-source weights without mutating rank lists', () => {
        const vector = Object.freeze([1, 2]);
        const lexical = Object.freeze([2, 3]);

        const result = fuseRRF([vector, lexical], 10, {
            k: 20,
            sourceWeights: [0.5, 2],
        });

        expect(result.get(1)).toBeCloseTo(0.5 / 21, 12);
        expect(result.get(2)).toBeCloseTo(0.5 / 22 + 2 / 21, 12);
        expect(result.get(3)).toBeCloseTo(2 / 22, 12);
        expect(vector).toEqual([1, 2]);
        expect(lexical).toEqual([2, 3]);
    });

    it('keeps exact-score ties stable under source-order permutation', () => {
        const vectorFirst = fuseRRF([[20, 10], [10, 20]], 10, {
            k: 30,
            sourceWeights: [1, 1],
        });
        const lexicalFirst = fuseRRF([[10, 20], [20, 10]], 10, {
            k: 30,
            sourceWeights: [1, 1],
        });

        expect([...vectorFirst.entries()]).toEqual([...lexicalFirst.entries()]);
        expect([...vectorFirst.keys()]).toEqual([10, 20]);
    });

    it('rejects misaligned or invalid calibration parameters', () => {
        expect(() => fuseRRF([[1], [2]], 2, { sourceWeights: [1] })).toThrow(/align/u);
        expect(() => fuseRRF([[1]], 1, { k: -1 })).toThrow(/non-negative/u);
        expect(() => fuseRRF([[1]], 1, { sourceWeights: [Number.NaN] })).toThrow(/finite/u);
    });

    it('omits a zero-weight source instead of emitting zero-score candidates', () => {
        const result = fuseRRF([[1, 2], [3]], 10, { sourceWeights: [0, 1] });

        expect([...result.keys()]).toEqual([3]);
    });
});
