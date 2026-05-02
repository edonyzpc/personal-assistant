import { describe, expect, it } from '@jest/globals';
import { MemoryVectorIndex } from '../src/vss/memory-vector-index';
import type { EmbeddingProfile } from '../src/vss/types';

const profile: EmbeddingProfile = {
    provider: 'openai',
    baseURL: '',
    model: 'model',
    dimensions: 2,
    distanceMetric: 'COSINE',
};

describe('MemoryVectorIndex fallback', () => {
    it('searches vectors by distance and returns normalized scores', async () => {
        const index = new MemoryVectorIndex();
        await index.initialize(profile);
        await index.upsertFile({
            path: 'note.md',
            contentHash: 'hash',
            mtime: 1,
            size: 2,
        }, [
            {
                path: 'note.md',
                chunkIndex: 0,
                content: 'near',
                contentHash: 'hash',
                created: 1,
                lastModified: 1,
                metadata: { path: 'note.md', chunkIndex: 0 },
            },
            {
                path: 'note.md',
                chunkIndex: 1,
                content: 'far',
                contentHash: 'hash',
                created: 1,
                lastModified: 1,
                metadata: { path: 'note.md', chunkIndex: 1 },
            },
        ], [
            [1, 0],
            [0, 1],
        ]);

        const results = await index.search([1, 0], 2);

        expect(results[0].doc.pageContent).toBe('near');
        expect(results[0].score).toBeCloseTo(1);
        expect(results[1].doc.pageContent).toBe('far');
        expect(results[1].score).toBeCloseTo(0);
    });
});
