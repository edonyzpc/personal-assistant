/* Copyright 2023 edonyzpc */
import { Notice, getFrontMatterInfo, type FrontMatterInfo, TFile } from 'obsidian'
import fetch, { Headers, Request, Response } from "node-fetch";
import { ChatAlibabaTongyi } from "@langchain/community/chat_models/alibaba_tongyi";
import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI, type ChatOpenAICallOptions } from '@langchain/openai';
import { OpenAIEmbeddings } from '@langchain/openai';
import { OllamaEmbeddings } from "@langchain/ollama";
import { Notification } from '@svelteuidev/core';

import type { PluginManager } from '../plugin'

/**
 * A utility class for AI-related functionalities.
 * Provides common AI features for the plugin.
 */
export class AIUtils {
    private plugin: PluginManager;

    /**
     * Creates an instance of AIUtils.
     * @param plugin - The PluginManager instance.
     */
    constructor(plugin: PluginManager) {
        this.plugin = plugin;
    }

    /**
     * Gets the API token for the AI service.
     * @returns The API token.
     */
    async getAPIToken(): Promise<string> {
        return await this.plugin.getAPIToken();
    }

    /**
     * Creates a notification to indicate that the AI is thinking.
     * @returns An object containing the notice and notification elements.
     */
    createAIThinkingNotice(): { notice: Notice; notification: Notification } {
        const noticeEl = document.createDocumentFragment();
        const div = noticeEl.createEl("div", { attr: { id: "ai-breathing-icon", style: "background: white;" } });
        const notification = new Notification({
            target: div,
            props: {
                title: "AI is Thinking...",
                color: "green",
                loading: true,
                withCloseButton: false,
                override: {
                    "border-width": "0px",
                    "color": "white !important",
                },
            }
        });
        const notice = new Notice(noticeEl, 0);
        // keep the same theme of notice and notification
        notice.noticeEl.style.backgroundColor = "white";
        notice.noticeEl.parentElement?.setCssStyles({
            "backgroundColor": "white",
        });

        return { notice, notification };
    }

    /**
     * Creates a notification to indicate that the AI is generating featured images.
     * @returns An object containing the notice and notification elements.
     */
    createAIFeaturedImageNotice(): { notice: Notice; notification: Notification } {
        const noticeEl = document.createDocumentFragment();
        const div = noticeEl.createEl("div", { attr: { id: "ai-breahting-icon", style: "background: white;" } });
        const notification = new Notification({
            target: div,
            props: {
                title: "AI is Generating Featured Images...",
                color: "green",
                loading: true,
                withCloseButton: false,
                override: {
                    "border-width": "0px",
                    "color": "white !important",
                },
            }
        });
        const notice = new Notice(noticeEl, 0);
        // keep the same theme of notice and notification
        notice.noticeEl.style.backgroundColor = "white";
        notice.noticeEl.parentElement?.setCssStyles({
            "backgroundColor": "white",
        });
        notice.noticeEl.createEl("hr", { attr: { id: "ai-featured-image-progress-hr", style: "margin:unset;" } });

        return { notice, notification };
    }

    /**
     * Creates a chat model instance based on the configured AI provider.
     * @param temperature - The temperature for the chat model.
     * @returns A chat model instance.
     */
    async createChatModel(temperature: number = 0.8): Promise<ChatAlibabaTongyi | ChatOpenAI<ChatOpenAICallOptions> | ChatOllama> {
        const provider = this.plugin.settings.aiProvider;
        const modelName = this.plugin.settings.chatModelName;
        const baseURL = this.plugin.settings.baseURL;

        switch (provider) {
            case 'qwen': {
                const token = await this.getAPIToken();
                return new ChatOpenAI({
                    model: modelName,
                    apiKey: token,
                    configuration: {
                        baseURL: baseURL,
                    },
                    temperature: temperature,
                });
            }

            case 'openai': {
                const openaiToken = await this.getAPIToken();
                return new ChatOpenAI({
                    model: modelName,
                    apiKey: openaiToken,
                    configuration: {
                        baseURL: baseURL,
                    },
                    temperature: temperature,
                });
            }

            case 'ollama':
                return new ChatOllama({
                    model: modelName,
                    baseUrl: baseURL,
                    temperature: temperature,
                });

            default:
                throw new Error(`Unsupported AI provider: ${provider}`);
        }
    }

    /**
     * Creates an embeddings model instance based on the configured AI provider.
     * @param dimensions - The dimensions for the embeddings.
     * @returns An embeddings model instance.
     */
    async createEmbeddings(dimensions?: number): Promise<OpenAIEmbeddings | OllamaEmbeddings> {
        const provider = this.plugin.settings.aiProvider;
        const modelName = this.plugin.settings.embeddingModelName;
        const baseURL = this.plugin.settings.baseURL;

        switch (provider) {
            case 'qwen':
            case 'openai': {
                const token = await this.getAPIToken();
                return new OpenAIEmbeddings({
                    model: modelName,
                    dimensions: dimensions,
                    apiKey: token,
                    configuration: {
                        baseURL: baseURL,
                    }
                });
            }

            case 'ollama':
                return new OllamaEmbeddings({
                    model: modelName,
                    baseUrl: baseURL,
                });

            default:
                throw new Error(`Unsupported AI provider: ${provider}`);
        }
    }

    /**
     * Creates a Qwen LLM instance (legacy method).
     * @param model - The model name.
     * @param temperature - The temperature for the chat model.
     * @returns A ChatAlibabaTongyi instance.
     * @deprecated Use `createChatModel` instead.
     */
    async createQwenLLM(model: string = "qwen-max", temperature: number = 0.8): Promise<ChatAlibabaTongyi> {
        const token = await this.getAPIToken();
        const llm = new ChatAlibabaTongyi({
            model: model,
            temperature: temperature,
            alibabaApiKey: token,
        });
        llm.apiUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
        return llm;
    }

    /**
     * Creates an OpenAI compatible LLM instance (legacy method).
     * @param model - The model name.
     * @param temperature - The temperature for the chat model.
     * @returns A ChatOpenAI instance.
     * @deprecated Use `createChatModel` instead.
     */
    async createOpenAICompatibleLLM(model: string = "qwen-max", temperature: number = 0.8): Promise<ChatOpenAI<ChatOpenAICallOptions>> {
        const token = await this.getAPIToken();
        return new ChatOpenAI({
            model: model,
            apiKey: token,
            configuration: {
                baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            },
            temperature: temperature,
        });
    }

    /**
     * Creates an OpenAI Embeddings instance (legacy method).
     * @param model - The model name.
     * @param dimensions - The dimensions for the embeddings.
     * @returns An OpenAIEmbeddings instance.
     * @deprecated Use `createEmbeddings` instead.
     */
    async createOpenAIEmbeddings(model: string = "text-embedding-v3", dimensions: number = 512): Promise<OpenAIEmbeddings> {
        const token = await this.getAPIToken();
        return new OpenAIEmbeddings({
            model: model,
            dimensions: dimensions,
            apiKey: token,
            configuration: {
                baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            }
        });
    }

    /**
     * Wraps a function with a fetch polyfill.
     * This is necessary because the default `fetch` implementation in Obsidian is not compatible with some libraries.
     * @param fn - The function to be wrapped.
     * @returns The result of the wrapped function.
     */
    async withFetchPolyfill<T>(fn: () => Promise<T>): Promise<T> {
        const originFetch = globalThis.fetch;
        const originHeaders = globalThis.Headers;
        const originRequest = globalThis.Request;
        const originResponse = globalThis.Response;

        // @ts-ignore
        globalThis.fetch = fetch;
        // @ts-ignore
        globalThis.Headers = Headers;
        // @ts-ignore
        globalThis.Request = Request;
        // @ts-ignore
        globalThis.Response = Response;

        try {
            return await fn();
        } finally {
            globalThis.fetch = originFetch;
            globalThis.Headers = originHeaders;
            globalThis.Request = originRequest;
            globalThis.Response = originResponse;
        }
    }

    /**
     * Cleans the markdown content by removing code blocks, comments, and file references.
     * @param markdown - The markdown content to be cleaned.
     * @returns The cleaned markdown content.
     */
    cleanMarkdownContent(markdown: string): string {
        // 过滤代码块
        let cleaned = markdown.replace(/^```.*?$(?:\n.*?)*^```$/gm, '');
        // 过滤注释
        cleaned = cleaned.replace(/%%[\s\S]*?%%/g, '');
        // 过滤文件引用
        cleaned = cleaned.replace(/\[\[[\w-]+\.[a-z]{1,}\]\]/g, '');
        return cleaned;
    }

    /**
     * Gets the content of a document, excluding the frontmatter.
     * @param markdown - The markdown content of the document.
     * @returns An object containing the content and frontmatter information.
     */
    getDocumentContent(markdown: string): { content: string; frontmatterInfo: FrontMatterInfo } {
        const frontmatterInfo = getFrontMatterInfo(markdown);
        const content = markdown.slice(frontmatterInfo.contentStart);
        return { content, frontmatterInfo };
    }

    /**
     * Checks if a file should be updated based on its modification time.
     * @param filePath - The path to the file.
     * @param cacheFilePath - The path to the cache file.
     * @param thresholdMs - The threshold in milliseconds.
     * @returns A boolean indicating whether the file should be updated.
     */
    async shouldUpdateFile(filePath: string, cacheFilePath: string, thresholdMs: number = 1000): Promise<boolean> {
        try {
            const cachedVSSFile = await this.plugin.app.vault.adapter.read(cacheFilePath);
            const cachedVectors = JSON.parse(cachedVSSFile);
            const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
            if (file && file instanceof TFile) {
                return file.stat.mtime - cachedVectors[0]["metadata"]["lastModified"] > thresholdMs;
            }
        } catch (e) {
            console.error(e, cacheFilePath);
        }
        return true;
    }
} 