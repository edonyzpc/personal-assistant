/* Copyright 2023 edonyzpc */
import { ChatPromptTemplate, SystemMessagePromptTemplate, HumanMessagePromptTemplate } from "@langchain/core/prompts";

import { AIUtils } from './ai-utils';
import type { PluginManager } from '../plugin'

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

const isAbortError = (error: unknown, signal?: AbortSignal): boolean => {
    if (signal?.aborted) return true;
    if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') {
        return true;
    }
    return error instanceof Error && error.name === 'AbortError';
};

export const canFallbackToNonStreaming = (
    error: unknown,
    receivedAnyChunk: boolean,
    signal?: AbortSignal,
): boolean => {
    return !receivedAnyChunk && !isAbortError(error, signal);
};

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
    async streamLLM(prompt: string, onChunk: (chunk: string) => void, signal?: AbortSignal, chatHistory?: ChatMessage[]): Promise<void> {
        // TODO: filter the RAG References from the history string
        const formattedHistory = (chatHistory || [])
            .map(msg => `${msg.role === 'user' ? 'Human' : 'Assistant'}: ${msg.role === 'assistant' ? msg.content.split("\n\n---\n> [!personal-assistant-ai]- RAG References")[0] : msg.content}`)
            .join('\n');

        const contextualPrompt = formattedHistory ?
            `${formattedHistory}\nHuman: ${prompt}\nAssistant:` :
            `Human: ${prompt}\nAssistant:`;

        const ragPrompt = ChatPromptTemplate.fromMessages([
            SystemMessagePromptTemplate.fromTemplate("你是一个严格根据知识库的内容回答问题的助手。\n\n** 知识库内容：**\n{rag_content}\n---\n"),
            HumanMessagePromptTemplate.fromTemplate(`{input}
**注意**：1. 最后以列表形式附上你回答问题中引用知识库内容的来源，即知识库内容中metadata中的path字段
2. 输出格式为：

---
> [!personal-assistant-ai]- RAG Referencs
> 
> 1. [[<metadata1.path>]]
> 2. [[<metadata2.path>]]
> 3. [[<metadata3.path>]]
> 4. ...
`),
        ]);

        const ragContents = await this.plugin.vss.searchSimilarity(prompt);
        // 将ragContents前两个元素中的doc用JSON.stringify拼接在一起并且以---分割
        const ragContent = ragContents
            .slice(0, 3)
            .map((doc) => JSON.stringify(doc, null, 0))
            .join("\n---\n");

        const chainInput = {
            rag_content: ragContent,
            input: contextualPrompt,
        };

        let fullResponse = '';
        let receivedAnyChunk = false;
        try {
            const llm = await this.aiUtils.createChatModel(0.8, { transport: 'native' });
            const chain = ragPrompt.pipe(llm);
            const response = await chain.stream(chainInput, { signal: signal });

            for await (const chunk of response) {
                receivedAnyChunk = true;
                try {
                    const data = chunk.content.toString();
                    fullResponse += data;
                    onChunk(fullResponse);
                    // trikcy, smooth the streaming display
                    await new Promise(f => setTimeout(f, 150));
                } catch (e) {
                    console.error('Error parsing chunk:', e);
                    throw e;
                }
            }
        } catch (error) {
            if (!canFallbackToNonStreaming(error, receivedAnyChunk, signal)) {
                throw error;
            }

            this.plugin.log("Streaming LLM failed before chunks; retrying without streaming.");
            const fallbackLlm = await this.aiUtils.createChatModel(0.8, { transport: 'obsidian' });
            const fallbackChain = ragPrompt.pipe(fallbackLlm);
            const response = await fallbackChain.invoke(chainInput, { signal: signal });
            onChunk(response.content.toString());
            return;
        }

        if (signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
        }
    }
}
