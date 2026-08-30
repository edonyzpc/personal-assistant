export const RRF_K = 60;

export interface RRFOptions {
    /** Rank constant. Defaults to the production-compatible {@link RRF_K}. */
    k?: number;
    /** Per-source multiplier in the same order as `sources`. Defaults to `1`. */
    sourceWeights?: readonly number[];
}

export function fuseRRF(
    sources: readonly (readonly number[])[],
    topK: number,
    options: RRFOptions = {},
): Map<number, number> {
    const k = options.k ?? RRF_K;
    if (!Number.isFinite(k) || k < 0) {
        throw new RangeError("RRF k must be a finite, non-negative number.");
    }
    if (options.sourceWeights && options.sourceWeights.length !== sources.length) {
        throw new RangeError("RRF sourceWeights must align with sources.");
    }

    const limit = Number.isNaN(topK) ? 0 : Math.max(0, Math.floor(topK));
    const scores = new Map<number, number>();
    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
        const source = sources[sourceIndex];
        const weight = options.sourceWeights?.[sourceIndex] ?? 1;
        if (!Number.isFinite(weight) || weight < 0) {
            throw new RangeError("RRF source weights must be finite, non-negative numbers.");
        }
        if (weight === 0) continue;
        for (let rank = 0; rank < source.length; rank++) {
            const id = source[rank];
            scores.set(id, (scores.get(id) ?? 0) + weight / (k + rank + 1));
        }
    }
    return new Map(
        [...scores.entries()]
            .sort(([leftId, leftScore], [rightId, rightScore]) => (
                rightScore - leftScore || leftId - rightId
            ))
            .slice(0, limit),
    );
}
