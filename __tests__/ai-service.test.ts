import { describe, expect, it, jest } from '@jest/globals';

import {
    getFeaturedImageSavePath,
    normalizeFeaturedImageFolderPath,
} from '../src/ai-services/featured-image-path';

jest.mock('obsidian');
jest.mock('nanoid', () => ({ nanoid: () => 'test-id' }));

const { AIService, mergeFrontmatterTags, parseSummaryResponse } = require('../src/ai-services/service') as typeof import('../src/ai-services/service');

describe('AI summary response parsing', () => {
    it('parses plain JSON responses', () => {
        expect(parseSummaryResponse('{"summary":" Short summary ","keywords":["alpha"," beta ",""]}')).toEqual({
            summary: 'Short summary',
            keywords: ['alpha', 'beta'],
        });
    });

    it('parses fenced JSON responses', () => {
        expect(parseSummaryResponse('```json\n{"summary":"Summary","keywords":["alpha"]}\n```')).toEqual({
            summary: 'Summary',
            keywords: ['alpha'],
        });
    });

    it('parses JSON embedded in extra text', () => {
        const response = 'Here is the result:\n{"summary":"Uses {braces} safely","keywords":["alpha"]}\nDone.';

        expect(parseSummaryResponse(response)).toEqual({
            summary: 'Uses {braces} safely',
            keywords: ['alpha'],
        });
    });

    it('rejects invalid summary payloads', () => {
        expect(parseSummaryResponse('{"summary":"","keywords":["alpha"]}')).toBeNull();
        expect(parseSummaryResponse('{"summary":"Summary","keywords":"alpha"}')).toBeNull();
        expect(parseSummaryResponse('not json')).toBeNull();
    });
});

describe('frontmatter tag merging', () => {
    it('normalizes string tags before merging keywords', () => {
        expect(mergeFrontmatterTags('daily, writing notes', ['summary'])).toEqual([
            'daily',
            'writing',
            'notes',
            'summary',
        ]);
    });

    it('deduplicates tags without stripping existing prefixes', () => {
        expect(mergeFrontmatterTags(['#daily', 'notes'], ['daily', 'Notes', 'summary'])).toEqual([
            '#daily',
            'notes',
            'summary',
        ]);
    });
});

describe('AI summary generation', () => {
    it('awaits frontmatter writes and stores normalized summary tags', async () => {
        const frontmatter: Record<string, unknown> = { tags: 'daily, notes' };
        let writeFinished = false;
        const processFrontMatter = jest.fn(async (_file: unknown, fn: (frontmatter: Record<string, unknown>) => void) => {
            await Promise.resolve();
            fn(frontmatter);
            writeFinished = true;
        });
        const plugin = {
            app: {
                fileManager: {
                    processFrontMatter,
                },
            },
            log: jest.fn(),
        };
        const service = new AIService(plugin as never);
        (service as unknown as {
            aiUtils: {
                createAIThinkingNotice: () => { notice: { hide: () => void } };
                getDocumentContent: (markdown: string) => { content: string };
            };
        }).aiUtils = {
            createAIThinkingNotice: () => ({ notice: { hide: jest.fn() } }),
            getDocumentContent: (markdown: string) => ({ content: markdown }),
        };
        (service as unknown as { callLLM: () => Promise<string> }).callLLM = jest.fn(async () => {
            return '```json\n{"summary":"Generated summary","keywords":["notes","ai"]}\n```';
        });

        await service.generateSummary(
            { getValue: () => 'note body' } as never,
            { file: { path: 'note.md' } } as never,
        );

        expect(writeFinished).toBe(true);
        expect(frontmatter).toEqual({
            "AI Summary": 'Generated summary',
            tags: ['daily', 'notes', 'ai'],
        });
    });
});

describe('AIService featured image vault paths', () => {
    it('saves to the vault root when the featured image folder is empty', () => {
        expect(normalizeFeaturedImageFolderPath('')).toBe('');
        expect(getFeaturedImageSavePath('', 'image.png')).toBe('image.png');
    });

    it('normalizes configured featured image folders as vault-relative paths', () => {
        expect(normalizeFeaturedImageFolderPath('/attachments/ai/')).toBe('attachments/ai');
        expect(getFeaturedImageSavePath('/attachments/ai/', 'image.png')).toBe('attachments/ai/image.png');
    });
});
