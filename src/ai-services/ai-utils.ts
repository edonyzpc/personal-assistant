/* Copyright 2023 edonyzpc */
import { Notice, getFrontMatterInfo, type FrontMatterInfo, TFile } from 'obsidian'
import fetch, { Headers, Request, Response } from "node-fetch";
import { ChatAlibabaTongyi } from "@langchain/community/chat_models/alibaba_tongyi";
import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI, type ChatOpenAICallOptions } from '@langchain/openai';
import { OpenAIEmbeddings } from '@langchain/openai';
import { OllamaEmbeddings } from "@langchain/ollama";

import type { PluginManager } from '../plugin'
import { computeContentHash } from '../vss-helpers';

/**
 * AI工具类，提供通用的AI功能
 */
export class AIUtils {
    private plugin: PluginManager;

    constructor(plugin: PluginManager) {
        this.plugin = plugin;
    }

    /**
     * 获取API token
     */
    async getAPIToken(): Promise<string> {
        return await this.plugin.getAPIToken();
    }

    private buildNoticeContent(title: string) {
        const fragment = document.createDocumentFragment();
        const wrapper = fragment.createEl("div", { attr: { class: "pa-notice" } });
        const header = wrapper.createDiv({ cls: "pa-notice__header" });
        const spinner = header.createDiv({ cls: "pa-notice__spinner" });
        spinner.createSpan({ text: "" });
        header.createSpan({ text: title, attr: { class: "pa-notice__text" } });
        wrapper.createDiv({ cls: "pa-notice__body" });
        return fragment;
    }

    /**
     * 创建AI思考中的通知
     */
    createAIThinkingNotice(): { notice: Notice } {
        const noticeEl = this.buildNoticeContent("AI is Thinking...");
        const notice = new Notice(noticeEl, 0);
        this.tuneNoticeShell(notice);
        return { notice };
    }

    /**
     * 创建AI生成图片的通知
     */
    createAIFeaturedImageNotice(): { notice: Notice } {
        const noticeEl = this.buildNoticeContent("AI is Generating Featured Images...");
        const notice = new Notice(noticeEl, 0);
        this.tuneNoticeShell(notice);
        notice.noticeEl.createEl("hr", { attr: { id: "ai-featured-image-progress-hr", style: "margin:unset;" } });
        return { notice };
    }

    private tuneNoticeShell(notice: Notice) {
        notice.noticeEl.addClass("pa-notice-shell");
        notice.noticeEl.parentElement?.addClass("pa-notice-shell");
        notice.noticeEl.setCssStyles({
            background: "transparent",
            boxShadow: "none",
            border: "none",
            padding: "0",
        });
    }

    /**
     * 创建聊天模型实例
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
     * 创建嵌入模型实例
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
     * 创建通义千问LLM实例（兼容旧版本）
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
     * 创建OpenAI兼容的LLM实例（兼容旧版本）
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
     * 创建OpenAI Embeddings实例（兼容旧版本）
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
     * 执行fetch polyfill包装
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
     * 清理markdown内容
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

    hashContent(content: string): string {
        return computeContentHash(content);
    }

    /**
     * 基于内容hash判断是否需要更新
     */
    async shouldUpdateFileByHash(filePath: string, cacheFilePath: string, contentHash: string, thresholdMs: number = 1000): Promise<boolean> {
        try {
            const cachedVSSFile = await this.plugin.app.vault.adapter.read(cacheFilePath);
            const cachedVectors = JSON.parse(cachedVSSFile);
            const cachedMeta = cachedVectors?.[0]?.metadata ?? {};
            const cachedHash = cachedMeta["contentHash"];

            if (cachedHash) {
                return cachedHash !== contentHash;
            }

            // 没有hash时回退到mtime判断
            const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
            if (file && file instanceof TFile) {
                return file.stat.mtime - (cachedMeta["lastModified"] ?? 0) > thresholdMs;
            }
        } catch (e) {
            console.error(e, cacheFilePath);
        }
        return true;
    }

    /**
     * 获取文档内容（去除frontmatter）
     */
    getDocumentContent(markdown: string): { content: string; frontmatterInfo: FrontMatterInfo } {
        const frontmatterInfo = getFrontMatterInfo(markdown);
        const content = markdown.slice(frontmatterInfo.contentStart);
        return { content, frontmatterInfo };
    }

    /**
     * 检查文件是否需要更新（基于修改时间）
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
