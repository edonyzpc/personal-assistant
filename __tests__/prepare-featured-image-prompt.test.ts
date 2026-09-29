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
    FeaturedImagePromptPreparationError,
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
        expect(messages[0].content).toBe(getFeaturedImagePrompt());
        expect(messages[1].content).toContain('用户本轮要求：');
        expect(messages[1].content).toContain('不要文字，偏水彩');
        expect(messages[1].content).toContain('文字内容：');
        expect(messages[1].content).toContain('INSIDE-SELECTION sentinel');
        expect(messages[1].content).not.toContain('OUTSIDE-SELECTION sentinel');
        expect(sourceCurrent.mock.calls.every(Boolean)).toBe(true);
    });

    it('rejects oversized source or result without a model call', async () => {
        await expect(prepareFeaturedImagePrompt(host, {
            sourceText: 'x'.repeat(120_001),
            userRequest: '',
            signal: new AbortController().signal,
            isSourceCurrent: () => true,
        })).rejects.toBeInstanceOf(FeaturedImagePromptPreparationError);
        expect(createChatModel).not.toHaveBeenCalled();

        createChatModel.mockResolvedValueOnce({ invoke: async () => ({ content: 'x'.repeat(5_001) }) });
        await expect(prepareFeaturedImagePrompt(host, {
            sourceText: 'source',
            userRequest: '',
            signal: new AbortController().signal,
            isSourceCurrent: () => true,
        })).rejects.toMatchObject({ code: 'result_too_large' });
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
        null,
        { refusal: 'I will not answer' },
        [{ type: 'refusal', refusal: 'no' }],
        [{ type: 'text', text: 'usable', refusal: 'contradictory refusal' }],
    ] as const)(
        'rejects nontext model output without serializing it',
        async content => {
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

    it('checks cancellation and source authority before and after the physical request', async () => {
        const controller = new AbortController();
        let rejectRequest: ((value: unknown) => void) | undefined;
        createChatModel.mockResolvedValueOnce({
            invoke: () => new Promise((_resolve, reject) => { rejectRequest = reject; }),
        });
        const preparation = prepareFeaturedImagePrompt(host, {
            sourceText: 'source',
            userRequest: '',
            signal: controller.signal,
            isSourceCurrent: () => true,
        });
        await flushPromises();
        controller.abort();
        rejectRequest?.(new Error('transport stopped'));
        await expect(preparation).rejects.toMatchObject({ code: 'cancelled' });

        createChatModel.mockResolvedValueOnce({ invoke: async () => ({ content: 'late result' }) });
        await expect(prepareFeaturedImagePrompt(host, {
            sourceText: 'source',
            userRequest: '',
            signal: new AbortController().signal,
            isSourceCurrent: () => false,
        })).rejects.toMatchObject({ code: 'source_changed' });
        expect(createChatModel).toHaveBeenCalledTimes(1);
    });

    it('rejects a late result after the text provider connection changes', async () => {
        let finishRequest!: (value: { content: string }) => void;
        const request = new Promise<{ content: string }>(resolve => { finishRequest = resolve; });
        createChatModel.mockResolvedValueOnce({ invoke: async () => request });
        const preparation = prepareFeaturedImagePrompt(host, {
            sourceText: 'source',
            userRequest: '',
            signal: new AbortController().signal,
            isSourceCurrent: () => true,
        });
        await flushPromises();
        host.settings.chatModelName = 'changed-model';
        finishRequest({ content: 'late result' });
        await expect(preparation).rejects.toMatchObject({ code: 'connection_changed' });
    });
});

function flushPromises() {
    return new Promise<void>(resolve => setImmediate(resolve));
}
