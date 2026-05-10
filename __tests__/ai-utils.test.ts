import { describe, expect, it, jest } from '@jest/globals';

import {
    AIUtils,
    DEFAULT_NATIVE_TOOL_CALLING_VALIDATIONS,
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
    it('starts with an empty default rollout table', () => {
        expect(DEFAULT_NATIVE_TOOL_CALLING_VALIDATIONS).toEqual([]);
    });

    it('keeps smoke validations separate from the default rollout table', () => {
        expect(SMOKE_NATIVE_TOOL_CALLING_VALIDATIONS).toEqual([{
            provider: 'qwen',
            model: 'qwen-plus',
            baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        }]);
        expect(DEFAULT_NATIVE_TOOL_CALLING_VALIDATIONS).toEqual([]);
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
