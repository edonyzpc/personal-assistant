export const RRF_K = 60;

export function fuseRRF(
    sources: number[][],
    topK: number,
): Map<number, number> {
    const scores = new Map<number, number>();
    for (const source of sources) {
        for (let rank = 0; rank < source.length; rank++) {
            const id = source[rank];
            scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank + 1));
        }
    }
    return new Map(
        [...scores.entries()]
            .sort(([, a], [, b]) => b - a)
            .slice(0, topK),
    );
}
