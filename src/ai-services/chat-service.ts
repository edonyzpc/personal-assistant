/* Copyright 2023 edonyzpc */
import { ChatPromptTemplate, SystemMessagePromptTemplate, HumanMessagePromptTemplate } from "@langchain/core/prompts";

import { AIUtils } from './ai-utils';
import type { PluginManager } from '../plugin'

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

/**
 * 聊天服务类，提供聊天相关的功能
 */
export class ChatService {
    private aiUtils: AIUtils;
    private plugin: PluginManager;

    constructor(plugin: PluginManager) {
        this.plugin = plugin;
        this.aiUtils = new AIUtils(plugin);
    }

    /**
     * 流式LLM调用
     */
    async streamLLM(
        prompt: string,
        onChunk: (chunk: string) => void,
        signal?: AbortSignal,
        chatHistory?: ChatMessage[]
    ): Promise<void> {
        const llm = await this.aiUtils.createOpenAICompatibleLLM();

        const systemTemplate = `你是一个专业的AI助手，擅长回答各种问题。
请根据用户的问题提供准确、有用的回答。
如果用户提到了vault中的内容，请结合相关内容进行回答。`;

        const systemMessagePrompt = SystemMessagePromptTemplate.fromTemplate(systemTemplate);
        const humanMessagePrompt = HumanMessagePromptTemplate.fromTemplate("{input}");

        const chatPrompt = ChatPromptTemplate.fromMessages([
            systemMessagePrompt,
            humanMessagePrompt,
        ]);

        const formattedPrompt = await chatPrompt.formatMessages({
            input: prompt,
        });

        const stream = await llm.stream(formattedPrompt, {
            signal: signal,
        });

        let fullResponse = '';
        for await (const chunk of stream) {
            if (signal?.aborted) {
                break;
            }
            const content = chunk.content;
            if (typeof content === 'string') {
                fullResponse += content;
                onChunk(fullResponse);
            }
        }
    }
} 