export type DirtyTimestamps = {
    first: number; // first time the file was marked dirty after last flush
    last: number;  // most recent time the file was marked dirty
    epoch?: number; // monotonic in-memory guard used to avoid clearing newer dirty work
};

export type DirtyRecord = Record<string, DirtyTimestamps>;

export const computeContentHash = async (input: string): Promise<string> => {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
        throw new Error('Web Crypto is required to compute VSS content hashes.');
    }

    const bytes = new TextEncoder().encode(input);
    const digest = await subtle.digest('SHA-1', bytes);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
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
