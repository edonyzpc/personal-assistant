import { createHash } from 'crypto';

export type DirtyRecord = Record<string, number>;

export const computeContentHash = (input: string): string => {
    return createHash('sha1').update(input).digest('hex');
};

export const selectFlushCandidates = (
    dirty: Map<string, number>,
    now: number,
    quietWindow: number,
    maxDelay: number,
    limit: number,
): string[] => {
    const result: string[] = [];
    for (const [path, ts] of dirty.entries()) {
        if (result.length >= limit) break;
        const idle = now - ts;
        if (idle >= quietWindow || idle >= maxDelay) {
            result.push(path);
        }
    }
    return result;
};

export const shouldRespectRateGap = (lastProcessedAt: number | null, now: number, rateGap: number): boolean => {
    if (lastProcessedAt === null) return true;
    return now - lastProcessedAt >= rateGap;
};
