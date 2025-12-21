import { createHash } from 'crypto';

export type DirtyTimestamps = {
    first: number; // first time the file was marked dirty after last flush
    last: number;  // most recent time the file was marked dirty
};

export type DirtyRecord = Record<string, DirtyTimestamps>;

export const computeContentHash = (input: string): string => {
    return createHash('sha1').update(input).digest('hex');
};

export const selectFlushCandidates = (
    dirty: Map<string, DirtyTimestamps>,
    now: number,
    quietWindow: number,
    maxDelay: number,
    limit: number,
): string[] => {
    const result: string[] = [];
    for (const [path, ts] of dirty.entries()) {
        if (result.length >= limit) break;
        const idleSinceLastUpdate = now - ts.last;
        const dirtyDuration = now - ts.first;
        if (idleSinceLastUpdate >= quietWindow || dirtyDuration >= maxDelay) {
            result.push(path);
        }
    }
    return result;
};

export const shouldRespectRateGap = (lastProcessedAt: number | null, now: number, rateGap: number): boolean => {
    if (lastProcessedAt === null) return true;
    return now - lastProcessedAt >= rateGap;
};
