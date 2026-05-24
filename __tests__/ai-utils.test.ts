import { describe, expect, it, jest } from '@jest/globals';

import {
    AIUtils,
    buildQwenModelKwargs,
    DASHSCOPE_COMPATIBLE_BASE_URLS,
    DASHSCOPE_NATIVE_TOOL_CALLING_MODELS,
    DEFAULT_NATIVE_TOOL_CALLING_VALIDATIONS,
    isDashScopeCompatibleBaseURL,
    SMOKE_NATIVE_TOOL_CALLING_VALIDATIONS,
} from '../src/ai-services/ai-utils';

jest.mock('obsidian');

function createPlugin(settings: {
    aiProvider?: string;
    chatModelName?: string;
    baseURL?: string;
}) {
    return {
        settings: {
            aiProvider: settings.aiProvider ?? 'qwen',
            chatModelName: settings.chatModelName ?? 'qwen-plus',
            baseURL: settings.baseURL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        },
    };
}

describe('native tool calling capability', () => {
    it('promotes the official DashScope Function Calling models into the default rollout table', () => {
        expect(DASHSCOPE_NATIVE_TOOL_CALLING_MODELS).toEqual([
            'qwen3.6-*',
            'qwen3.5-*',
            'qwen3-*',
            'qwen2.5-*',
            'qwen-max*',
            'qwen-plus*',
            'qwen-flash*',
            'qwen-coder*',
            'qwen-turbo*',
            'deepseek-v4-pro',
            'deepseek-v4-flash',
            'deepseek-v3.2',
            'deepseek-v3.2-exp',
            'deepseek-v3.1',
            'deepseek-r1',
            'deepseek-r1-0528',
            'deepseek-v3',
            'siliconflow/deepseek-v3.2',
            'siliconflow/deepseek-v3.1-terminus',
            'siliconflow/deepseek-r1-0528',
            'siliconflow/deepseek-v3-0324',
            'vanchin/deepseek-v3.2-think',
            'vanchin/deepseek-v3.1-terminus',
            'vanchin/deepseek-r1',
            'vanchin/deepseek-v3',
            'glm-5.1',
            'glm-5',
            'glm-4.7',
            'glm-4.6',
            'glm-4.5',
            'glm-4.5-air',
            'kimi-k2.6',
            'kimi-k2.5',
            'kimi-k2-thinking',
            'moonshot-kimi-k2-instruct',
            'kimi/kimi-k2.6',
            'kimi/kimi-k2.5',
            'minimax-m2.5',
            'minimax-m2.1',
            'minimax/minimax-m2.7',
            'minimax/minimax-m2.5',
            'minimax/minimax-m2.1',
        ]);
        expect(DEFAULT_NATIVE_TOOL_CALLING_VALIDATIONS).toHaveLength(
            DASHSCOPE_NATIVE_TOOL_CALLING_MODELS.length * DASHSCOPE_COMPATIBLE_BASE_URLS.length,
        );
        expect(DEFAULT_NATIVE_TOOL_CALLING_VALIDATIONS).toEqual(expect.arrayContaining([
            {
                provider: 'qwen',
                model: 'qwen3-*',
                baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            },
            {
                provider: 'qwen',
                model: 'deepseek-v4-pro',
                baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            },
            {
                provider: 'qwen',
                model: 'minimax/minimax-m2.7',
                baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
            },
        ]));
    });

    it('keeps smoke validations explicit for provider canary runs', () => {
        expect(SMOKE_NATIVE_TOOL_CALLING_VALIDATIONS).toEqual(DEFAULT_NATIVE_TOOL_CALLING_VALIDATIONS);
    });

    it('defaults to disabled behind the internal gate', () => {
        const aiUtils = new AIUtils(createPlugin({}) as never);

        expect(aiUtils.getNativeToolCallingCapability()).toEqual({
            supported: false,
            status: 'disabled',
            provider: 'qwen',
            model: 'qwen-plus',
            baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            reason: 'Native tool calling is disabled by the internal gate.',
        });
    });

    it('supports qwen native tool calling by documented model family when the internal gate is enabled', () => {
        const aiUtils = new AIUtils(createPlugin({}) as never);

        expect(aiUtils.getNativeToolCallingCapability({ internalGate: true })).toEqual({
            supported: true,
            status: 'supported',
            provider: 'qwen',
            model: 'qwen-plus',
            baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            reason: 'Provider/model/baseURL is validated for native tool calling.',
        });
    });

    it.each([
        'qwen3.6-max',
        'qwen3-max-preview',
        'qwen3-vl-plus',
        'qwen3.5-omni-plus',
        'qwen2.5-72b-instruct',
        'qwen-max-latest',
        'qwen-coder-plus',
        'deepseek-v4-pro',
        'deepseek-v3.2-exp',
        'siliconflow/deepseek-v3.2',
        'vanchin/deepseek-v3.2-think',
        'glm-4.5-air',
        'kimi/kimi-k2.6',
        'minimax/minimax-m2.7',
    ])('supports official DashScope Function Calling model %s', (chatModelName) => {
        const aiUtils = new AIUtils(createPlugin({ chatModelName }) as never);

        expect(aiUtils.getNativeToolCallingCapability({ internalGate: true })).toMatchObject({
            supported: true,
            status: 'supported',
            provider: 'qwen',
            model: chatModelName.toLowerCase(),
            baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            reason: 'Provider/model/baseURL is validated for native tool calling.',
        });
    });

    it('supports official DashScope Function Calling models on the Singapore endpoint', () => {
        const aiUtils = new AIUtils(createPlugin({
            chatModelName: 'glm-5.1',
            baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/',
        }) as never);

        expect(aiUtils.getNativeToolCallingCapability({ internalGate: true })).toMatchObject({
            supported: true,
            status: 'supported',
            provider: 'qwen',
            model: 'glm-5.1',
            baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        });
    });

    it.each([
        'qwen-plus-character',
        'qwen-flash-character-2026-02-26',
        'qwen2.5-vl-72b-instruct',
        'qwen2.5-omni-7b',
        'qwen3-rerank',
        'qwen3-tts-instruct-flash',
        'qwen3-asr-flash',
    ])('does not allow unsupported specialized qwen model %s through broad documented families', (chatModelName) => {
        const aiUtils = new AIUtils(createPlugin({ chatModelName }) as never);

        expect(aiUtils.getNativeToolCallingCapability({ internalGate: true })).toMatchObject({
            supported: false,
            status: 'unsupported',
            reason: 'Provider/model/baseURL is not validated for native tool calling.',
        });
    });

    it('treats unknown providers as unsupported when the gate is enabled', () => {
        const aiUtils = new AIUtils(createPlugin({
            aiProvider: 'custom',
            chatModelName: 'custom-model',
            baseURL: 'https://example.invalid/v1/',
        }) as never);

        expect(aiUtils.getNativeToolCallingCapability({ internalGate: true })).toMatchObject({
            supported: false,
            status: 'unsupported',
            provider: 'custom',
            model: 'custom-model',
            baseURL: 'https://example.invalid/v1',
            reason: 'Unknown AI provider; native tool calling defaults to unsupported.',
        });
    });

    it('requires an explicit validated provider/model/baseURL tuple', () => {
        const aiUtils = new AIUtils(createPlugin({
            aiProvider: 'openai',
            chatModelName: 'gpt-test',
            baseURL: 'https://api.openai.com/v1/',
        }) as never);

        expect(aiUtils.getNativeToolCallingCapability({ internalGate: true })).toMatchObject({
            supported: false,
            status: 'unsupported',
            reason: 'Provider/model/baseURL is not validated for native tool calling.',
        });

        expect(aiUtils.getNativeToolCallingCapability({
            internalGate: true,
            validatedModels: [{
                provider: 'openai',
                model: 'gpt-test',
                baseURL: 'https://api.openai.com/v1',
            }],
        })).toMatchObject({
            supported: true,
            status: 'supported',
            provider: 'openai',
            model: 'gpt-test',
            baseURL: 'https://api.openai.com/v1',
            reason: 'Provider/model/baseURL is validated for native tool calling.',
        });
    });

    it('does not treat provider/model validation as a custom baseURL wildcard', () => {
        const aiUtils = new AIUtils(createPlugin({
            aiProvider: 'openai',
            chatModelName: 'gpt-test',
            baseURL: 'https://custom-openai-compatible.example/v1',
        }) as never);

        expect(aiUtils.getNativeToolCallingCapability({
            internalGate: true,
            validatedModels: [{
                provider: 'openai',
                model: 'gpt-test',
                baseURL: 'https://api.openai.com/v1',
            }],
        })).toMatchObject({
            supported: false,
            status: 'unsupported',
            baseURL: 'https://custom-openai-compatible.example/v1',
            reason: 'Provider/model/baseURL is not validated for native tool calling.',
        });
    });
});

describe('Qwen DashScope request options', () => {
    it('recognizes DashScope OpenAI-compatible base URLs with trailing slashes', () => {
        expect(isDashScopeCompatibleBaseURL('https://dashscope.aliyuncs.com/compatible-mode/v1/')).toBe(true);
        expect(isDashScopeCompatibleBaseURL('https://dashscope-intl.aliyuncs.com/compatible-mode/v1/')).toBe(true);
        expect(isDashScopeCompatibleBaseURL('https://example.invalid/compatible-mode/v1')).toBe(false);
    });

    it('builds Bailian thinking model kwargs only for DashScope qwen', () => {
        expect(buildQwenModelKwargs('qwen', 'https://dashscope.aliyuncs.com/compatible-mode/v1', {
            enableThinking: true,
        })).toEqual({
            enable_thinking: true,
        });
    });

    it('does not send Bailian kwargs by default or for non-DashScope providers', () => {
        expect(buildQwenModelKwargs('qwen', 'https://dashscope.aliyuncs.com/compatible-mode/v1')).toBeUndefined();
        expect(buildQwenModelKwargs('openai', 'https://dashscope.aliyuncs.com/compatible-mode/v1', {
            enableThinking: true,
        })).toBeUndefined();
        expect(buildQwenModelKwargs('qwen', 'https://example.invalid/v1', {
            enableThinking: true,
        })).toBeUndefined();
    });
});
