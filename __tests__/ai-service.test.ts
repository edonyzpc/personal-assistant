import { describe, expect, it, jest } from '@jest/globals';

import {
    getFeaturedImageSavePath,
    normalizeFeaturedImageFolderPath,
} from '../src/ai-services/featured-image-path';
import { AIService, mergeFrontmatterTags, parseSummaryResponse } from '../src/ai-services/service';

jest.mock('obsidian', () => ({
    normalizePath: (value: string) => value,
    Notice: class {
        constructor(public message: unknown, public timeout?: number) {}
    },
}));

describe('summary response parsing', () => {
    it('parses plain JSON responses', () => {
        expect(parseSummaryResponse('{"summary":"Short summary","keywords":["alpha","beta"]}')).toEqual({
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
        expect(parseSummaryResponse('prefix {"summary":"Uses {braces} safely","keywords":["alpha"]} suffix')).toEqual({
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
            'daily', 'writing', 'notes', 'summary',
        ]);
    });

    it('deduplicates tags without stripping existing prefixes', () => {
        expect(mergeFrontmatterTags(['#daily', 'notes'], ['daily', 'Notes', 'summary'])).toEqual([
            '#daily', 'notes', 'summary',
        ]);
    });
});

describe('AI summary generation', () => {
    it.each([false, true])('writes normalized summary tags to the command note (view changed=%s)', async viewChanges => {
        const frontmatter: Record<string, unknown> = { tags: 'daily, notes' };
        const commandFile = { path: 'note.md' };
        const view = { file: commandFile };
        let writeFinished = false;
        const processFrontMatter = jest.fn(async (_file: unknown, apply: (value: Record<string, unknown>) => void) => {
            await Promise.resolve();
            apply(frontmatter);
            writeFinished = true;
        });
        const service = new AIService({
            app: {
                fileManager: { processFrontMatter },
            },
            log: jest.fn(),
        } as never);
        (service as unknown as { aiUtils: unknown }).aiUtils = {
            createAIThinkingNotice: () => ({ notice: { hide: jest.fn() } }),
            getDocumentContent: (markdown: string) => ({ content: markdown }),
        };
        (service as unknown as { callLLM: () => Promise<string> }).callLLM = jest.fn(async () => {
            if (viewChanges) view.file = { path: 'another-note.md' };
            return '```json\n{"summary":"Generated summary","keywords":["notes","ai"]}\n```';
        });

        await service.generateSummary(
            { getValue: () => 'note body' } as never,
            view as never,
        );

        expect(writeFinished).toBe(true);
        expect(processFrontMatter).toHaveBeenCalledWith(commandFile, expect.any(Function));
        expect(frontmatter).toEqual({
            'AI Summary': 'Generated summary',
            tags: ['daily', 'notes', 'ai'],
        });
    });
});

describe('featured image vault paths', () => {
    it('normalizes empty and configured folders', () => {
        expect(normalizeFeaturedImageFolderPath('')).toBe('');
        expect(getFeaturedImageSavePath('', 'image.png')).toBe('image.png');
        expect(normalizeFeaturedImageFolderPath('/attachments/ai/')).toBe('attachments/ai');
        expect(getFeaturedImageSavePath('/attachments/ai/', 'image.png')).toBe('attachments/ai/image.png');
    });
});
