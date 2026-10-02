import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type PreparedModelInvoke = (
    messages: Array<{ content: unknown }>,
    options?: { signal?: AbortSignal },
) => Promise<{ content: unknown }>;
const createChatModel = jest.fn<(temperature?: unknown, options?: unknown) => Promise<{ invoke: PreparedModelInvoke }>>();
jest.mock('../src/ai-services/ai-utils', () => {
    const actual = jest.requireActual('../src/ai-services/ai-utils') as Record<string, unknown>;
    return { ...actual, AIUtils: jest.fn().mockImplementation(() => ({ createChatModel })) };
});

import { AIUtils } from '../src/ai-services/ai-utils';
import { getFeaturedImagePrompt } from '../src/ai-services/featured-image-prompt';
import {
    prepareFeaturedImagePrompt,
} from '../src/ai-services/prepare-featured-image-prompt';
import { PaAgentRunUsageLedger } from '../src/ai-services/agent-usage-ledger';

const host = {
    settings: {
        debug: false,
        aiProvider: 'openai',
        baseURL: 'https://provider.example',
        chatModelName: 'text-model',
        embeddingModelName: 'embedding-model',
    },
    getAPIToken: jest.fn(async () => 'token'),
    log: jest.fn(),
};

beforeEach(() => {
    createChatModel.mockReset();
    host.settings.chatModelName = 'text-model';
    host.settings.aiProvider = 'openai';
    host.settings.baseURL = 'https://provider.example';
    host.getAPIToken.mockClear();
    host.log.mockClear();
    (AIUtils as unknown as jest.Mock).mockClear();
});

describe('prepareFeaturedImagePrompt', () => {
    it('sends only the exact source and current user request with the Featured system prompt', async () => {
        const invoke = jest.fn<PreparedModelInvoke>(async () => ({
            content: [{ type: 'text', text: 'PREPARED-IMAGE-SENTINEL' }],
        }));
        createChatModel.mockResolvedValueOnce({ invoke });
        const sourceCurrent = jest.fn(() => true);

        await expect(prepareFeaturedImagePrompt(host, {
            sourceText: 'INSIDE-SELECTION sentinel',
            userRequest: '不要文字，偏水彩',
            signal: new AbortController().signal,
            isSourceCurrent: sourceCurrent,
        })).resolves.toBe('PREPARED-IMAGE-SENTINEL');

        const messages = invoke.mock.calls[0]![0];
        expect(createChatModel).toHaveBeenCalledTimes(1);
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(messages).toHaveLength(2);
        expect(messages[0].content).toBe(getFeaturedImagePrompt());
        expect(messages[1].content).toContain('用户本轮要求：');
        expect(messages[1].content).toContain('不要文字，偏水彩');
        expect(messages[1].content).toContain('文字内容：');
        expect(messages[1].content).toContain('INSIDE-SELECTION sentinel');
        expect(messages[1].content).not.toContain('OUTSIDE-SELECTION sentinel');
        expect(sourceCurrent).toHaveBeenCalled();
    });

    it('rejects oversized input before creating a model', async () => {
        await expect(prepareFeaturedImagePrompt(host, {
            sourceText: 'x'.repeat(120_001),
            userRequest: '',
            signal: new AbortController().signal,
            isSourceCurrent: () => true,
        })).rejects.toMatchObject({ code: 'input_too_large' });
        expect(createChatModel).not.toHaveBeenCalled();
    });

    it('rejects an oversized result after exactly one model invocation', async () => {
        const invoke = jest.fn<PreparedModelInvoke>(async () => ({ content: 'x'.repeat(5_001) }));
        createChatModel.mockResolvedValueOnce({ invoke });
        await expect(prepareFeaturedImagePrompt(host, {
            sourceText: 'source',
            userRequest: '',
            signal: new AbortController().signal,
            isSourceCurrent: () => true,
        })).rejects.toMatchObject({ code: 'result_too_large' });
        expect(createChatModel).toHaveBeenCalledTimes(1);
        expect(invoke).toHaveBeenCalledTimes(1);
    });

    it('uses the configured deepseek envelope instead of an arbitrary 120k source cap', async () => {
        host.settings.aiProvider = 'qwen';
        host.settings.chatModelName = 'deepseek-v4-pro';
        host.settings.baseURL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
        createChatModel.mockResolvedValueOnce({ invoke: async () => ({
            content: [{ type: 'text', text: 'DEEPSEEK-PREPARED-SENTINEL' }],
        }) });
        await expect(prepareFeaturedImagePrompt(host, {
            sourceText: 'A'.repeat(130_000),
            userRequest: '使用清晰构图',
            signal: new AbortController().signal,
            isSourceCurrent: () => true,
        })).resolves.toBe('DEEPSEEK-PREPARED-SENTINEL');
    });

    it.each([
        ['null content', null],
        ['refusal object', { refusal: 'I will not answer' }],
        ['refusal part', [{ type: 'refusal', refusal: 'no' }]],
        ['text carrying a refusal', [{ type: 'text', text: 'usable', refusal: 'contradictory refusal' }]],
    ] as const)(
        'rejects %s without serializing it as an image description',
        async (_name, content) => {
            createChatModel.mockResolvedValueOnce({ invoke: async () => ({ content }) });
            await expect(prepareFeaturedImagePrompt(host, {
                sourceText: 'source',
                userRequest: '',
                signal: new AbortController().signal,
                isSourceCurrent: () => true,
            })).rejects.toMatchObject({ code: 'nontext_result' });
        },
    );

    it('binds the preparation to Agent Debug and the current usage ledger', async () => {
        const observations: unknown[] = [];
        const recorder = {
            captureId: 'image-debug',
            enabled: () => true,
            bindRun: jest.fn(),
            observe: jest.fn((event: unknown) => observations.push(event)),
            finish: jest.fn(),
        };
        const usageLedger = new PaAgentRunUsageLedger();
        createChatModel.mockResolvedValueOnce({ invoke: async () => ({
            content: 'PREPARED',
            usage_metadata: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
        }) });
        await expect(prepareFeaturedImagePrompt(host, {
            sourceText: 'source',
            userRequest: '',
            signal: new AbortController().signal,
            isSourceCurrent: () => true,
        }, { recorder, usageLedger, parentId: 'turn:image-tool', turnId: 'turn:image-tool' }))
            .resolves.toBe('PREPARED');
        expect(createChatModel.mock.calls[0]![1]).toMatchObject({
            agentDebugCall: { purpose: 'image_preparation' },
        });
        expect(observations).toEqual(expect.arrayContaining([
            expect.objectContaining({ purpose: 'image_preparation', phase: 'prepare' }),
            expect.objectContaining({ purpose: 'image_preparation', phase: 'dispatch' }),
            expect.objectContaining({ purpose: 'image_preparation', phase: 'consumer_end' }),
        ]));
        expect(usageLedger.snapshot().logicalCalls).toEqual([
            expect.objectContaining({
                purpose: 'image_preparation', totalTokens: 18, complete: true,
            }),
        ]);
    });

    it('rejects an already stale source before creating a model', async () => {
        await expect(prepareFeaturedImagePrompt(host, {
            sourceText: 'source',
            userRequest: '',
            signal: new AbortController().signal,
            isSourceCurrent: () => false,
        })).rejects.toMatchObject({ code: 'source_changed' });
        expect(createChatModel).not.toHaveBeenCalled();
    });

    it('reports cancellation when a pending provider request rejects after Stop', async () => {
        const controller = new AbortController();
        const started = deferred<void>();
        const request = deferred<{ content: unknown }>();
        createChatModel.mockResolvedValueOnce({
            invoke: () => { started.resolve(); return request.promise; },
        });
        const preparation = prepareFeaturedImagePrompt(host, {
            sourceText: 'source',
            userRequest: '',
            signal: controller.signal,
            isSourceCurrent: () => true,
        });
        await started.promise;
        controller.abort();
        request.reject(new Error('transport stopped'));
        await expect(preparation).rejects.toMatchObject({ code: 'cancelled' });
        expect(createChatModel).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['source revocation', 'source_changed'],
        ['Stop', 'cancelled'],
    ] as const)('rejects a resolved description after %s during the physical request', async (change, code) => {
        const controller = new AbortController();
        const started = deferred<void>();
        const request = deferred<{ content: unknown }>();
        let sourceCurrent = true;
        const invoke = jest.fn<PreparedModelInvoke>(() => {
            started.resolve();
            return request.promise;
        });
        createChatModel.mockResolvedValueOnce({ invoke });
        const preparation = prepareFeaturedImagePrompt(host, {
            sourceText: 'source',
            userRequest: '',
            signal: controller.signal,
            isSourceCurrent: () => sourceCurrent,
        });
        await started.promise;
        if (change === 'Stop') controller.abort();
        else sourceCurrent = false;
        request.resolve({ content: 'late result' });
        await expect(preparation).rejects.toMatchObject({ code });
        expect(createChatModel).toHaveBeenCalledTimes(1);
        expect(invoke).toHaveBeenCalledTimes(1);
    });

    it('rejects a late result after the text provider connection changes', async () => {
        const started = deferred<void>();
        const request = deferred<{ content: unknown }>();
        createChatModel.mockResolvedValueOnce({
            invoke: () => { started.resolve(); return request.promise; },
        });
        const preparation = prepareFeaturedImagePrompt(host, {
            sourceText: 'source',
            userRequest: '',
            signal: new AbortController().signal,
            isSourceCurrent: () => true,
        });
        await started.promise;
        host.settings.chatModelName = 'changed-model';
        request.resolve({ content: 'late result' });
        await expect(preparation).rejects.toMatchObject({ code: 'connection_changed' });
    });
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}
