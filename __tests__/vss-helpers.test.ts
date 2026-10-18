import { describe, it, expect } from '@jest/globals';
import { createHash } from 'node:crypto';
import { computeContentHash, selectFlushCandidates, DirtyTimestamps } from '../src/vss-helpers';

describe('computeContentHash', () => {
    it('returns stable hash for identical input', async () => {
        const a = await computeContentHash('hello');
        const b = await computeContentHash('hello');
        expect(a).toBe(b);
        expect(a).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d');
    });

    it('returns different hash for different input', async () => {
        const a = await computeContentHash('hello');
        const b = await computeContentHash('world');
        expect(a).not.toBe(b);
    });

    it('preserves UTF-8 digest across chunk boundaries, including surrogate pairs and lone surrogates', async () => {
        const input = ('x'.repeat(16_383) + '😀笔记\ud800\n').repeat(90);
        let inputHandled = false;
        setTimeout(() => { inputHandled = true; }, 0);
        expect(await computeContentHash(input)).toBe(createHash('sha1').update(input).digest('hex'));
        expect(inputHandled).toBe(true);
    });

    it('observes caller cancellation while encoding a large input', async () => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 0);
        await expect(computeContentHash('笔记😀'.repeat(300_000), controller.signal))
            .rejects.toMatchObject({ name: 'AbortError' });
    });
});

describe('selectFlushCandidates', () => {
    it('applies the quiet-window boundary before applying the flush limit', () => {
        const now = 1_800_000_000_000;
        const dirty = new Map<string, DirtyTimestamps>([
            ['almost-quiet.md', { first: now - 29_999, last: now - 29_999 }],
            ['older.md', { first: now - 40_000, last: now - 40_000 }],
            ['quiet.md', { first: now - 30_000, last: now - 30_000 }],
            ['third-eligible.md', { first: now - 35_000, last: now - 35_000 }],
        ]);

        expect(selectFlushCandidates(dirty, now, 30_000, 600_000, 2)).toEqual(['older.md', 'quiet.md']);
    });

    it('applies the max-delay boundary while a file is still being edited', () => {
        const now = 1_800_000_000_000;
        const dirty = new Map<string, DirtyTimestamps>([
            ['almost-max-delay.md', { first: now - 599_999, last: now - 1_000 }],
            ['max-delay.md', { first: now - 600_000, last: now - 1_000 }],
        ]);

        expect(selectFlushCandidates(dirty, now, 30_000, 600_000, 5)).toEqual(['max-delay.md']);
    });
});
