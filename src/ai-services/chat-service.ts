/* Copyright 2023 edonyzpc */
import { ChatPromptTemplate, SystemMessagePromptTemplate, HumanMessagePromptTemplate } from "@langchain/core/prompts";

import { AIUtils } from './ai-utils';
import type { PluginManager } from '../plugin'

/**
 * Represents a message in the chat history.
 */
export interface ChatMessage {
    /** The role of the message sender. */
    role: 'user' | 'assistant';
    /** The content of the message. */
    content: string;
}

/**
 * A service class for chat-related functionalities.
 */
export class ChatService {
    private aiUtils: AIUtils;
    private plugin: PluginManager;

    /**
     * Creates an instance of ChatService.
     * @param plugin - The PluginManager instance.
     */
    constructor(plugin: PluginManager) {
        this.plugin = plugin;
        this.aiUtils = new AIUtils(plugin);
    }

    /**
     * Streams a response from the LLM.
     *
     * @param prompt - The user's prompt.
     * @param onChunk - A callback function to handle each chunk of the response.
     * @param signal - An optional AbortSignal to cancel the request.
     * @param chatHistory - An optional array of previous chat messages.
     */
    async streamLLM(prompt: string, onChunk: (chunk: string) => void, signal?: AbortSignal, chatHistory?: ChatMessage[]): Promise<void> {
        const llm = await this.aiUtils.createChatModel(0.8);
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

        const chain = ragPrompt.pipe(llm);
        const response = await chain.stream({
            rag_content: ragContent,
            input: contextualPrompt,
        }, { signal: signal });

        let fullResponse = '';
        for await (const chunk of response) {
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

        if (signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
        }
    }
} 