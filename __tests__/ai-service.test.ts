import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
    getFeaturedImageSavePath,
    normalizeFeaturedImageFolderPath,
} from '../src/ai-services/featured-image-path';
import { AIUtils, getDashScopeImageGenerationEndpoint } from '../src/ai-services/ai-utils';
import { freezeFeaturedImageRunOptions, type FeaturedImageRunOptions } from '../src/ai-services/featured-image-options';

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
    jest.restoreAllMocks();
    jest.useRealTimers();
    requestUrl.mockReset();
    noticeMessages.length = 0;
});

function createFeaturedImageService(settings: {
    baseURL?: string;
    featuredImageModel?: string;
    numFeaturedImages?: number;
    featuredImagePath?: string;
} = {}) {
    const plugin = {
        settings: {
            aiProvider: 'qwen',
            chatModelName: 'qwen-plus',
            embeddingModelName: 'text-embedding-v4',
            baseURL: settings.baseURL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            featuredImageModel: settings.featuredImageModel ?? 'wan2.7-image',
            numFeaturedImages: settings.numFeaturedImages ?? 1,
            featuredImagePath: settings.featuredImagePath ?? '',
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
        generateFeaturedImageUrls: (prompt: string, options: FeaturedImageRunOptions) => Promise<Array<{ url: string }> | null>;
    };
    const options = freezeFeaturedImageRunOptions({
        connection: { ...plugin.settings },
        featuredImageModel: plugin.settings.featuredImageModel as FeaturedImageRunOptions['featuredImageModel'],
        numFeaturedImages: plugin.settings.numFeaturedImages,
        featuredImagePath: plugin.settings.featuredImagePath,
        imageEndpoint: getDashScopeImageGenerationEndpoint(plugin.settings.baseURL) ?? '',
        isCurrent: () => true,
    });
    return { plugin, service, options };
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

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

function createFeaturedImageRun() {
    const fixture = createFeaturedImageService({ featuredImagePath: 'images', numFeaturedImages: 2 });
    let current = true;
    const options: FeaturedImageRunOptions = { ...fixture.options, isCurrent: () => current };
    const noticeElement = createMockNoticeElement();
    const dispatch = jest.fn();
    const editor = { getValue: () => 'note body' };
    const view = { editor: { cm: { state: { doc: { length: 9, lineAt: () => ({ from: 0, to: 0 }) } }, dispatch } } };
    const vault = {
        getAbstractFileByPath: jest.fn(() => null),
        createFolder: jest.fn(async (_path: string) => undefined),
        createBinary: jest.fn(async (_path: string, _bytes: ArrayBuffer) => undefined),
    };
    Object.assign(fixture.plugin.app, { vault });
    const service = fixture.service as unknown as {
        generateFeaturedImage(editor: unknown, view: unknown, options: FeaturedImageRunOptions): Promise<void>;
        generateFeaturedImageUrls(prompt: string, options: FeaturedImageRunOptions): Promise<Array<{ url: string }> | null>;
        callLLM(query: string, prompt: string, options: FeaturedImageRunOptions): Promise<string>;
        downloadImageToVault(app: unknown, url: string, path: string, options: FeaturedImageRunOptions): Promise<string>;
    };
    Object.assign(service, {
        aiUtils: {
            createAIFeaturedImageNotice: () => ({ notice: { messageEl: noticeElement, hide: jest.fn() } }),
            getDocumentContent: (markdown: string) => ({ content: markdown, frontmatterInfo: { exists: false, contentStart: 0 } }),
        },
    });
    return { ...fixture, service, options, editor, view, vault, dispatch, invalidate: () => { current = false; } };
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
    it('uses frozen image defaults while later edits change the global defaults', async () => {
        const run = createFeaturedImageRun();
        const prompt = deferred<string>();
        jest.spyOn(run.service, 'callLLM').mockReturnValue(prompt.promise);
        requestUrl.mockResolvedValueOnce({ status: 200, json: { output: { choices: [
            { message: { content: [{ image: 'https://example.com/first.png' }] } },
        ] } } });
        requestUrl.mockResolvedValueOnce({ status: 200, arrayBuffer: new ArrayBuffer(1) });
        const generating = run.service.generateFeaturedImage(run.editor, run.view, run.options);
        run.plugin.settings.featuredImageModel = 'wan2.7-image-pro';
        run.plugin.settings.numFeaturedImages = 4;
        run.plugin.settings.featuredImagePath = 'changed-folder';
        prompt.resolve('A quiet library');
        await generating;
        expect(JSON.parse((requestUrl.mock.calls[0][0] as { body: string }).body)).toMatchObject({
            model: 'wan2.7-image', parameters: { n: 2 },
        });
        expect(run.vault.createBinary).toHaveBeenCalledWith('images/first.png', expect.any(ArrayBuffer));
        expect(run.dispatch).toHaveBeenCalledTimes(1);
    });

    it('stops before image generation when the prompt finishes after invalidation', async () => {
        const run = createFeaturedImageRun();
        const prompt = deferred<string>();
        jest.spyOn(run.service, 'callLLM').mockReturnValue(prompt.promise);
        const generating = run.service.generateFeaturedImage(run.editor, run.view, run.options);
        run.invalidate();
        prompt.resolve('A quiet library');
        await generating;
        expect(run.plugin.getAPIToken).not.toHaveBeenCalled();
        expect(requestUrl).not.toHaveBeenCalled();
        expect(run.dispatch).not.toHaveBeenCalled();
    });

    it('rechecks image admission after awaiting the existing credential gate', async () => {
        const run = createFeaturedImageRun();
        const token = deferred<string>();
        run.plugin.getAPIToken.mockReturnValue(token.promise);
        const result = run.service.generateFeaturedImageUrls('prompt', run.options);
        run.invalidate();
        token.resolve('new-token');
        await expect(result).rejects.toMatchObject({ name: 'FeaturedImageRunInvalidatedError' });
        expect(requestUrl).not.toHaveBeenCalled();
    });

    it('does not send an image request with a missing token or a rejected credential gate', async () => {
        const run = createFeaturedImageRun();
        run.plugin.getAPIToken.mockResolvedValueOnce('   ').mockRejectedValueOnce(new Error('credential transition'));
        await expect(run.service.generateFeaturedImageUrls('prompt', run.options)).resolves.toBeNull();
        await expect(run.service.generateFeaturedImageUrls('prompt', run.options)).resolves.toBeNull();
        expect(requestUrl).not.toHaveBeenCalled();
    });

    it('guards prompt-model token resolution without mixing a new token with the captured connection', async () => {
        const run = createFeaturedImageRun();
        const token = deferred<string>();
        run.plugin.getAPIToken.mockReturnValue(token.promise);
        const result = run.service.callLLM('note', 'describe', run.options);
        run.invalidate();
        token.resolve('new-token');
        await expect(result).rejects.toMatchObject({ name: 'FeaturedImageRunInvalidatedError' });
        expect(requestUrl).not.toHaveBeenCalled();
    });

    it('uses the captured prompt-model connection through the real SDK transport', async () => {
        const run = createFeaturedImageRun();
        const body = JSON.stringify({ id: 'test', object: 'chat.completion', created: 1, model: 'qwen-plus',
            choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'generated prompt' } }] });
        requestUrl.mockResolvedValueOnce({ status: 200, headers: { 'content-type': 'application/json' },
            arrayBuffer: new TextEncoder().encode(body).buffer, text: body, json: null });
        run.plugin.settings.baseURL = 'https://other.example/v1';
        run.plugin.settings.chatModelName = 'changed-model';
        await expect(run.service.callLLM('note', 'describe', run.options)).resolves.toBe('generated prompt');
        const sent = requestUrl.mock.calls[0][0] as { url: string; body: string };
        expect(sent.url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
        expect(JSON.parse(sent.body).model).toBe('qwen-plus');
    });

    it('stops a real SDK retry before another provider request after invalidation', async () => {
        jest.useFakeTimers();
        const run = createFeaturedImageRun();
        requestUrl.mockImplementationOnce(async () => {
            run.invalidate();
            const body = JSON.stringify({ error: { message: 'Try later', type: 'rate_limit', code: 'rate_limit' } });
            return { status: 429, headers: { 'content-type': 'application/json' },
                arrayBuffer: new TextEncoder().encode(body).buffer, text: body, json: null };
        });
        const result = run.service.callLLM('note', 'describe', run.options);
        const stopped = expect(result).rejects.toMatchObject({ name: 'FeaturedImageRunInvalidatedError' });
        await jest.runAllTimersAsync();
        await stopped;
        expect(requestUrl).toHaveBeenCalledTimes(1);
    });

    it('passes prompt request guards to the existing SDK transport for every send and retry', async () => {
        const run = createFeaturedImageRun();
        let requestStarts = 0;
        jest.spyOn(AIUtils.prototype, 'createChatModel').mockImplementation(async (_temperature, options) => ({
            invoke: async () => {
                options?.onProviderRequestStart?.();
                requestStarts++;
                run.invalidate();
                options?.onProviderRequestStart?.();
                requestStarts++;
                return { content: 'prompt' };
            },
        }) as never);
        await expect(run.service.callLLM('note', 'describe', run.options)).rejects.toMatchObject({ name: 'FeaturedImageRunInvalidatedError' });
        expect(requestStarts).toBe(1);
    });

    it('stops after folder creation if the target changed before download admission', async () => {
        const run = createFeaturedImageRun();
        const folder = deferred<undefined>();
        run.vault.createFolder.mockReturnValue(folder.promise);
        const result = run.service.downloadImageToVault(run.plugin.app, 'https://example.com/first.png', 'images', run.options);
        run.invalidate();
        folder.resolve(undefined);
        await expect(result).rejects.toMatchObject({ name: 'FeaturedImageRunInvalidatedError' });
        expect(requestUrl).not.toHaveBeenCalled();
        expect(run.vault.createBinary).not.toHaveBeenCalled();
    });

    it('does not save downloaded bytes after the original target becomes invalid', async () => {
        const run = createFeaturedImageRun();
        requestUrl.mockImplementationOnce(async () => {
            run.invalidate();
            return { status: 200, arrayBuffer: new ArrayBuffer(1) };
        });
        await expect(run.service.downloadImageToVault(run.plugin.app, 'https://example.com/first.png', 'images', run.options))
            .rejects.toMatchObject({ name: 'FeaturedImageRunInvalidatedError' });
        expect(requestUrl).toHaveBeenCalledTimes(1);
        expect(run.vault.createBinary).not.toHaveBeenCalled();
    });

    it('stops subsequent downloads and insertion after an already-admitted file write loses its target', async () => {
        const run = createFeaturedImageRun();
        jest.spyOn(run.service, 'callLLM').mockResolvedValue('prompt');
        jest.spyOn(run.service, 'generateFeaturedImageUrls').mockResolvedValue([
            { url: 'https://example.com/first.png' }, { url: 'https://example.com/second.png' },
        ]);
        requestUrl.mockResolvedValue({ status: 200, arrayBuffer: new ArrayBuffer(1) });
        run.vault.createBinary.mockImplementationOnce(async () => { run.invalidate(); });
        await run.service.generateFeaturedImage(run.editor, run.view, run.options);
        expect(requestUrl).toHaveBeenCalledTimes(1);
        expect(run.vault.createBinary).toHaveBeenCalledTimes(1);
        expect(run.dispatch).not.toHaveBeenCalled();
        expect(run.plugin.log).toHaveBeenCalledWith('Featured image run stopped because its note or AI connection changed');
    });

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
        const { service, options } = createFeaturedImageService();

        await expect(service.generateFeaturedImageUrls('A quiet library', options)).resolves.toEqual([
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
        const { service, options } = createFeaturedImageService({
            featuredImageModel: 'wan2.7-image-pro',
            numFeaturedImages: 99,
        });

        await expect(service.generateFeaturedImageUrls('prompt', options)).resolves.toEqual([
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
        const { service, options } = createFeaturedImageService({
            baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/',
        });

        await service.generateFeaturedImageUrls('prompt', options);

        expect((requestUrl.mock.calls[0][0] as { url: string }).url).toBe(
            'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
        );
    });

    it('does not call the image endpoint for unsupported base URLs', async () => {
        const { service, options } = createFeaturedImageService({
            baseURL: 'https://example.invalid/compatible-mode/v1',
        });

        await expect(service.generateFeaturedImageUrls('prompt', options)).resolves.toBeNull();

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
        const { plugin, service, options } = createFeaturedImageService();

        await expect(service.generateFeaturedImageUrls('private prompt', options)).resolves.toBeNull();

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
        await expect(errored.service.generateFeaturedImageUrls('prompt', errored.options)).resolves.toBeNull();
        expect(errored.plugin.log).toHaveBeenCalledWith('Image generation provider returned an error', expect.objectContaining({
            message: '[provider message omitted]',
        }));

        requestUrl.mockResolvedValueOnce({
            status: 200,
            json: { output: { choices: [null, { message: { content: [] } }] } },
        });
        const empty = createFeaturedImageService();
        await expect(empty.service.generateFeaturedImageUrls('prompt', empty.options)).resolves.toBeNull();
        expect(empty.plugin.log).toHaveBeenCalledWith('Image generation response did not include image URLs', expect.any(Object));
    });

    it('times out stalled image generation requests', async () => {
        jest.useFakeTimers();
        requestUrl.mockImplementationOnce(() => new Promise(() => { }));
        const { plugin, service, options } = createFeaturedImageService();

        const generation = service.generateFeaturedImageUrls('private prompt', options);
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
        const { plugin, service, options } = createFeaturedImageService();
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
            generateFeaturedImage: (editor: unknown, view: unknown, options: FeaturedImageRunOptions) => Promise<void>;
        }).generateFeaturedImage(
            { getValue: () => 'note body' },
            { editor: { cm: {} } },
            options,
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
        const { plugin, service, options } = createFeaturedImageService();
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
            generateFeaturedImage: (editor: unknown, view: unknown, options: FeaturedImageRunOptions) => Promise<void>;
        }).generateFeaturedImage(
            { getValue: () => 'note body' },
            { editor: { cm: {} } },
            options,
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
        const { plugin, service, options } = createFeaturedImageService();
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
            generateFeaturedImage: (editor: unknown, view: unknown, options: FeaturedImageRunOptions) => Promise<void>;
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
            options,
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
