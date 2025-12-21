import { describe, it, expect } from '@jest/globals';
import { computeContentHash, selectFlushCandidates, shouldRespectRateGap, DirtyTimestamps } from '../src/vss-helpers';

describe('computeContentHash', () => {
    it('returns stable hash for identical input', () => {
        const a = computeContentHash('hello');
        const b = computeContentHash('hello');
        expect(a).toBe(b);
    });

    it('returns different hash for different input', () => {
        const a = computeContentHash('hello');
        const b = computeContentHash('world');
        expect(a).not.toBe(b);
    });
});

describe('selectFlushCandidates', () => {
    it('respects quiet window and max delay with limit', () => {
        const now = Date.now();
        const dirty = new Map<string, DirtyTimestamps>([
            ['recent.md', { first: now - 5_000, last: now - 5_000 }],           // should be skipped by quiet window
            ['old.md', { first: now - 40_000, last: now - 40_000 }],           // should pass quiet window
            ['stale.md', { first: now - 700_000, last: now - 700_000 }],       // should pass maxDelay
            ['another.md', { first: now - 35_000, last: now - 35_000 }],       // should pass but may be limited
        ]);

        const candidates = selectFlushCandidates(dirty, now, 30_000, 600_000, 2);
        expect(candidates).toContain('old.md');
        expect(candidates).toContain('stale.md');
        expect(candidates).not.toContain('recent.md');
        expect(candidates.length).toBe(2); // limited to 2
    });

    it('flushes frequently edited files once maxDelay is reached', () => {
        const now = Date.now();
        const dirty = new Map<string, DirtyTimestamps>([
            ['busy.md', { first: now - 700_000, last: now - 1_000 }], // quiet window not met, but maxDelay exceeded
        ]);

        const candidates = selectFlushCandidates(dirty, now, 30_000, 600_000, 5);
        expect(candidates).toContain('busy.md');
    });
});

describe('shouldRespectRateGap', () => {
    it('allows first run when no previous timestamp', () => {
        expect(shouldRespectRateGap(null, Date.now(), 3000)).toBe(true);
    });

    it('blocks when gap not met', () => {
        const now = 1_000_000;
        expect(shouldRespectRateGap(now, now + 1_000, 3_000)).toBe(false);
    });

    it('allows when gap exceeded', () => {
        const now = 1_000_000;
        expect(shouldRespectRateGap(now, now + 3_500, 3_000)).toBe(true);
    });
});
