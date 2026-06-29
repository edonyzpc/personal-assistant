import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
    getFeaturedImageSavePath,
    normalizeFeaturedImageFolderPath,
} from '../src/ai-services/featured-image-path';

jest.mock('obsidian');
jest.mock('nanoid', () => ({ nanoid: () => 'test-id' }));
jest.mock('../src/settings', () => ({
    normalizeFeaturedImageModel: (value: unknown) => (
        value === 'wan2.7-image' || value === 'wan2.7-image-pro' ? value : 'wan2.7-image'
    ),
    normalizeFeaturedImageCount: (value: unknown) => {
        const numericValue = typeof value === 'number'
            ? value
            : typeof value === 'string' && value.trim() !== ''
                ? Number(value)
                : Number.NaN;
        if (!Number.isFinite(numericValue)) return 1;
        return Math.min(Math.max(Math.floor(numericValue), 1), 4);
    },
}));

const { requestUrl: rawRequestUrl, Notice: MockNotice } = require('obsidian') as {
    requestUrl: unknown;
    Notice: { messages: Array<{ message?: unknown; timeout?: number }> };
};
const requestUrl = rawRequestUrl as jest.MockedFunction<(options: unknown) => Promise<unknown>>;
const noticeMessages = MockNotice.messages;
const { AIService, mergeFrontmatterTags, parseSummaryResponse } = require('../src/ai-services/service') as typeof import('../src/ai-services/service');

beforeEach(() => {
    jest.useRealTimers();
    requestUrl.mockReset();
    noticeMessages.length = 0;
});

function createFeaturedImageService(settings: {
    baseURL?: string;
    featuredImageModel?: string;
    numFeaturedImages?: number;
} = {}) {
    const plugin = {
        settings: {
            aiProvider: 'qwen',
            baseURL: settings.baseURL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            featuredImageModel: settings.featuredImageModel ?? 'wan2.7-image',
            numFeaturedImages: settings.numFeaturedImages ?? 1,
        },
        app: {
            plugins: {
                manifests: {},
                enabledPlugins: new Set<string>(),
            },
        },
        getAPIToken: jest.fn(async () => 'test-token'),
        log: jest.fn(),
    };
    const service = new AIService(plugin as never) as unknown as {
        generateFeaturedImageUrls: (prompt: string) => Promise<Array<{ url: string }> | null>;
    };
    return { plugin, service };
}

function createMockNoticeElement(): {
    querySelector: jest.MockedFunction<() => null>;
    createDiv: jest.MockedFunction<() => { createSpan: jest.MockedFunction<() => void>; empty: jest.MockedFunction<() => void> }>;
} {
    return {
        querySelector: jest.fn(() => null),
        createDiv: jest.fn(() => ({
            createSpan: jest.fn(),
            empty: jest.fn(),
        })),
    };
}

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

describe('AI featured image generation', () => {
    it('posts the Wan 2.7 synchronous request body and returns image URLs', async () => {
        requestUrl.mockResolvedValueOnce({
            status: 200,
            json: {
                request_id: 'req-1',
                output: {
                    choices: [{
                        finish_reason: 'stop',
                        message: { content: [{ image: 'https://example.com/image-1.png' }] },
                    }],
                },
            },
        });
        const { service } = createFeaturedImageService();

        await expect(service.generateFeaturedImageUrls('A quiet library')).resolves.toEqual([
            { url: 'https://example.com/image-1.png' },
        ]);

        expect(requestUrl).toHaveBeenCalledTimes(1);
        const request = requestUrl.mock.calls[0][0] as { url: string; headers: Record<string, string>; body: string };
        expect(request.url).toBe('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
        expect(request.headers).toEqual({ Authorization: 'Bearer test-token' });
        expect(request.headers).not.toHaveProperty('X-DashScope-Async');
        expect(JSON.parse(request.body)).toEqual({
            model: 'wan2.7-image',
            input: {
                messages: [{
                    role: 'user',
                    content: [{ text: 'A quiet library' }],
                }],
            },
            parameters: {
                size: '2K',
                n: 1,
                thinking_mode: true,
                watermark: false,
            },
        });
    });

    it('uses the configured Pro model and clamps image count for requests', async () => {
        requestUrl.mockResolvedValueOnce({
            status: 200,
            json: {
                output: {
                    choices: [
                        { message: { content: [{ image: 'https://example.com/image-1.png' }] } },
                        { message: { content: [{ image: 'https://example.com/image-2.png' }] } },
                    ],
                },
            },
        });
        const { service } = createFeaturedImageService({
            featuredImageModel: 'wan2.7-image-pro',
            numFeaturedImages: 99,
        });

        await expect(service.generateFeaturedImageUrls('prompt')).resolves.toEqual([
            { url: 'https://example.com/image-1.png' },
            { url: 'https://example.com/image-2.png' },
        ]);

        const body = JSON.parse((requestUrl.mock.calls[0][0] as { body: string }).body);
        expect(body.model).toBe('wan2.7-image-pro');
        expect(body.parameters.n).toBe(4);
    });

    it('uses the international image endpoint for DashScope international base URLs', async () => {
        requestUrl.mockResolvedValueOnce({
            status: 200,
            json: {
                output: {
                    choices: [{ message: { content: [{ image: 'https://example.com/image.png' }] } }],
                },
            },
        });
        const { service } = createFeaturedImageService({
            baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/',
        });

        await service.generateFeaturedImageUrls('prompt');

        expect((requestUrl.mock.calls[0][0] as { url: string }).url).toBe(
            'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
        );
    });

    it('does not call the image endpoint for unsupported base URLs', async () => {
        const { service } = createFeaturedImageService({
            baseURL: 'https://example.invalid/compatible-mode/v1',
        });

        await expect(service.generateFeaturedImageUrls('prompt')).resolves.toBeNull();

        expect(requestUrl).not.toHaveBeenCalled();
    });

    it('redacts provider messages when logging request failures', async () => {
        requestUrl.mockResolvedValueOnce({
            status: 400,
            json: {
                request_id: 'req-secret',
                code: 'InvalidParameter',
                message: 'provider detail that may include user prompt text',
            },
        });
        const { plugin, service } = createFeaturedImageService();

        await expect(service.generateFeaturedImageUrls('private prompt')).resolves.toBeNull();

        expect(plugin.log).toHaveBeenCalledWith('Image generation request failed', expect.objectContaining({
            requestId: 'req-secret',
            code: 'InvalidParameter',
            message: '[provider message omitted]',
            model: 'wan2.7-image',
        }));
        const serializedLogs = JSON.stringify(plugin.log.mock.calls);
        const serializedNotices = JSON.stringify(noticeMessages);
        expect(serializedLogs).not.toContain('provider detail that may include user prompt text');
        expect(serializedLogs).not.toContain('private prompt');
        expect(serializedLogs).not.toContain('test-token');
        expect(serializedNotices).not.toContain('provider detail that may include user prompt text');
        expect(serializedNotices).not.toContain('private prompt');
        expect(serializedNotices).not.toContain('test-token');
    });

    it('rejects body-level errors and empty image responses', async () => {
        requestUrl.mockResolvedValueOnce({
            status: 200,
            json: {
                request_id: 'req-error',
                status_code: 500,
                code: 'InternalError',
                message: 'provider failure',
            },
        });
        const errored = createFeaturedImageService();
        await expect(errored.service.generateFeaturedImageUrls('prompt')).resolves.toBeNull();
        expect(errored.plugin.log).toHaveBeenCalledWith('Image generation provider returned an error', expect.objectContaining({
            message: '[provider message omitted]',
        }));

        requestUrl.mockResolvedValueOnce({
            status: 200,
            json: { output: { choices: [null, { message: { content: [] } }] } },
        });
        const empty = createFeaturedImageService();
        await expect(empty.service.generateFeaturedImageUrls('prompt')).resolves.toBeNull();
        expect(empty.plugin.log).toHaveBeenCalledWith('Image generation response did not include image URLs', expect.any(Object));
    });

    it('times out stalled image generation requests', async () => {
        jest.useFakeTimers();
        requestUrl.mockImplementationOnce(() => new Promise(() => { }));
        const { plugin, service } = createFeaturedImageService();

        const generation = service.generateFeaturedImageUrls('private prompt');
        await Promise.resolve();
        await Promise.resolve();
        expect(requestUrl).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(300000);

        await expect(generation).resolves.toBeNull();
        expect(plugin.log).toHaveBeenCalledWith('Image generation request timed out', expect.objectContaining({
            errorName: 'FeaturedImageGenerationTimeoutError',
            model: 'wan2.7-image',
        }));
        expect(noticeMessages.map(({ message }) => message)).toContain(
            'AI featured image generation timed out. Try again with fewer images or the balanced model.',
        );
    });

    it('does not duplicate failure notices when public featured image generation fails', async () => {
        requestUrl.mockResolvedValueOnce({
            status: 400,
            json: {
                request_id: 'req-fail',
                code: 'InvalidParameter',
                message: 'provider detail that may include private prompt and test-token',
            },
        });
        const { plugin, service } = createFeaturedImageService();
        const noticeElement = createMockNoticeElement();
        (service as unknown as {
            aiUtils: {
                createAIFeaturedImageNotice: () => { notice: { messageEl: typeof noticeElement; hide: () => void } };
                getDocumentContent: (markdown: string) => { content: string; frontmatterInfo: { exists: boolean; contentStart: number } };
            };
            callLLM: () => Promise<string>;
        }).aiUtils = {
            createAIFeaturedImageNotice: () => ({ notice: { messageEl: noticeElement, hide: jest.fn() } }),
            getDocumentContent: (markdown: string) => ({
                content: markdown,
                frontmatterInfo: { exists: false, contentStart: 0 },
            }),
        };
        (service as unknown as { callLLM: () => Promise<string> }).callLLM = jest.fn(async () => 'private prompt');

        await (service as unknown as {
            generateFeaturedImage: (editor: unknown, view: unknown) => Promise<void>;
        }).generateFeaturedImage(
            { getValue: () => 'note body' },
            { editor: { cm: {} } },
        );

        expect(noticeMessages
            .map(({ message }) => message)
            .filter((message) => message === 'AI featured image generation failed.')).toHaveLength(1);
        const serializedLogs = JSON.stringify(plugin.log.mock.calls);
        const serializedNotices = JSON.stringify(noticeMessages);
        expect(serializedLogs).not.toContain('provider detail that may include private prompt and test-token');
        expect(serializedNotices).not.toContain('private prompt');
        expect(serializedNotices).not.toContain('test-token');
    });

    it('times out stalled LLM prompt generation during featured image flow', async () => {
        jest.useFakeTimers();
        const { plugin, service } = createFeaturedImageService();
        const noticeElement = createMockNoticeElement();

        (service as unknown as {
            aiUtils: {
                createAIFeaturedImageNotice: () => { notice: { messageEl: typeof noticeElement; hide: () => void } };
                getDocumentContent: (markdown: string) => { content: string; frontmatterInfo: { exists: boolean; contentStart: number } };
            };
            callLLM: () => Promise<string>;
        }).aiUtils = {
            createAIFeaturedImageNotice: () => ({ notice: { messageEl: noticeElement, hide: jest.fn() } }),
            getDocumentContent: (markdown: string) => ({
                content: markdown,
                frontmatterInfo: { exists: false, contentStart: 0 },
            }),
        };
        (service as unknown as { callLLM: () => Promise<string> }).callLLM = jest.fn(
            () => new Promise<string>(() => { }),
        );

        const generation = (service as unknown as {
            generateFeaturedImage: (editor: unknown, view: unknown) => Promise<void>;
        }).generateFeaturedImage(
            { getValue: () => 'note body' },
            { editor: { cm: {} } },
        );
        await Promise.resolve();
        await Promise.resolve();

        jest.advanceTimersByTime(300000);
        await generation;

        expect(noticeMessages.map(({ message }) => message)).toContain(
            'AI Featured Images failed: Featured image generation timed out after 300000ms.',
        );
        const serializedNotices = JSON.stringify(noticeMessages);
        expect(serializedNotices).not.toContain('note body');
    });

    it('inserts successfully downloaded featured images when one download fails', async () => {
        const { plugin, service } = createFeaturedImageService();
        const noticeElement = createMockNoticeElement();
        const dispatch = jest.fn();
        const lineAt = jest.fn(() => ({ from: 0, to: 0 }));

        (service as unknown as {
            aiUtils: {
                createAIFeaturedImageNotice: () => { notice: { messageEl: typeof noticeElement; hide: () => void } };
                getDocumentContent: (markdown: string) => { content: string; frontmatterInfo: { exists: boolean; contentStart: number } };
            };
            callLLM: () => Promise<string>;
            generateFeaturedImageUrls: () => Promise<Array<{ url: string }>>;
            downloadImageToVault: (_app: unknown, url: string) => Promise<string>;
        }).aiUtils = {
            createAIFeaturedImageNotice: () => ({ notice: { messageEl: noticeElement, hide: jest.fn() } }),
            getDocumentContent: (markdown: string) => ({
                content: markdown,
                frontmatterInfo: { exists: false, contentStart: 0 },
            }),
        };
        Object.assign(service as object, {
            callLLM: jest.fn(async () => 'generated prompt'),
            generateFeaturedImageUrls: jest.fn(async () => [
                { url: 'https://example.com/ok-1.png' },
                { url: 'https://example.com/fail.png' },
                { url: 'https://example.com/ok-2.png' },
            ]),
            downloadImageToVault: jest.fn(async (_app: unknown, url: string) => {
                if (url.includes('fail')) throw new Error('download failed');
                return url.includes('ok-1') ? '9.src/ok-1.png' : '9.src/ok-2.png';
            }),
        });

        await (service as unknown as {
            generateFeaturedImage: (editor: unknown, view: unknown) => Promise<void>;
        }).generateFeaturedImage(
            { getValue: () => 'note body' },
            {
                editor: {
                    cm: {
                        state: {
                            doc: {
                                length: 9,
                                lineAt,
                            },
                        },
                        dispatch,
                    },
                },
            },
        );

        expect(dispatch).toHaveBeenCalledTimes(1);
        const dispatchArg = dispatch.mock.calls[0][0] as { changes: Array<{ insert: string }> };
        expect(dispatchArg.changes[0].insert).toContain('![[9.src/ok-1.png]]');
        expect(dispatchArg.changes[0].insert).toContain('![[9.src/ok-2.png]]');
        expect(dispatchArg.changes[0].insert).not.toContain('fail.png');
        expect(plugin.log).toHaveBeenCalledWith('Failed to download featured image', expect.objectContaining({
            imageIndex: 1,
            errorName: 'Error',
        }));
        expect(plugin.log).toHaveBeenCalledWith('Featured image generation completed with download failures', {
            downloadedImageCount: 2,
            failedDownloadCount: 1,
        });
    });
});
