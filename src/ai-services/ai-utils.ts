/* Copyright 2023 edonyzpc */
import { Notice, Platform, getFrontMatterInfo, type FrontMatterInfo } from 'obsidian'
import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI, type ChatOpenAICallOptions, type ClientOptions } from '@langchain/openai';
import { OpenAIEmbeddings } from '@langchain/openai';
import { OllamaEmbeddings } from "@langchain/ollama";

import type { PluginManager } from '../plugin'
import { computeContentHash } from '../vss-helpers';
import { obsidianFetch } from './obsidian-fetch';

type ChatTransport = 'obsidian' | 'native';

export type NativeToolCallingCapabilityStatus = "disabled" | "unsupported" | "supported";

export interface NativeToolCallingCapability {
    supported: boolean;
    status: NativeToolCallingCapabilityStatus;
    provider: string;
    model: string;
    baseURL: string;
    reason: string;
}

export interface NativeToolCallingValidation {
    provider: string;
    model: string;
    baseURL: string;
}

export interface NativeToolCallingCapabilityOptions {
    internalGate?: boolean;
    validatedModels?: readonly NativeToolCallingValidation[];
}

const QWEN_PLUS_DASHSCOPE_NATIVE_TOOL_CALLING_VALIDATION: NativeToolCallingValidation = {
    provider: "qwen",
    model: "qwen-plus",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
};

export const DEFAULT_NATIVE_TOOL_CALLING_VALIDATIONS: readonly NativeToolCallingValidation[] = [
    QWEN_PLUS_DASHSCOPE_NATIVE_TOOL_CALLING_VALIDATION,
];
export const SMOKE_NATIVE_TOOL_CALLING_VALIDATIONS: readonly NativeToolCallingValidation[] = [
    QWEN_PLUS_DASHSCOPE_NATIVE_TOOL_CALLING_VALIDATION,
];

interface CreateChatModelOptions {
    transport?: ChatTransport;
}

export interface CreateEmbeddingsOptions {
    batchSize?: number;
    maxConcurrency?: number;
    maxRetries?: number;
}

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

    private createOpenAIClientOptions(baseURL: string, transport: ChatTransport = 'obsidian'): ClientOptions {
        const options: ClientOptions = {
            baseURL: baseURL,
            dangerouslyAllowBrowser: true,
        };

        if (transport === 'obsidian') {
            options.fetch = obsidianFetch;
        }

        return options;
    }

    /**
     * 创建聊天模型实例
     */
    async createChatModel(
        temperature: number = 0.8,
        options: CreateChatModelOptions = {},
    ): Promise<ChatOpenAI<ChatOpenAICallOptions> | ChatOllama> {
        const provider = this.plugin.settings.aiProvider;
        const modelName = this.plugin.settings.chatModelName;
        const baseURL = this.plugin.settings.baseURL;
        const transport = options.transport ?? 'obsidian';

        switch (provider) {
            case 'qwen': {
                const token = await this.getAPIToken();
                return new ChatOpenAI({
                    model: modelName,
                    apiKey: token,
                    configuration: this.createOpenAIClientOptions(baseURL, transport),
                    temperature: temperature,
                });
            }

            case 'openai': {
                const openaiToken = await this.getAPIToken();
                return new ChatOpenAI({
                    model: modelName,
                    apiKey: openaiToken,
                    configuration: this.createOpenAIClientOptions(baseURL, transport),
                    temperature: temperature,
                });
            }

            case 'ollama': {
                if (!Platform.isDesktop) {
                    throw new Error('Ollama provider is only available on Obsidian Desktop.');
                }
                return new ChatOllama({
                    model: modelName,
                    baseUrl: baseURL,
                    temperature: temperature,
                });
            }

            default:
                throw new Error(`Unsupported AI provider: ${provider}`);
        }
    }

    getNativeToolCallingCapability(
        options: NativeToolCallingCapabilityOptions = {},
    ): NativeToolCallingCapability {
        const provider = normalizeCapabilityValue(this.plugin.settings.aiProvider);
        const model = normalizeCapabilityValue(this.plugin.settings.chatModelName);
        const baseURL = normalizeBaseURL(this.plugin.settings.baseURL);

        if (!options.internalGate) {
            return {
                supported: false,
                status: "disabled",
                provider,
                model,
                baseURL,
                reason: "Native tool calling is disabled by the internal gate.",
            };
        }

        if (!isKnownNativeToolProvider(provider)) {
            return {
                supported: false,
                status: "unsupported",
                provider,
                model,
                baseURL,
                reason: "Unknown AI provider; native tool calling defaults to unsupported.",
            };
        }

        if (!model) {
            return {
                supported: false,
                status: "unsupported",
                provider,
                model,
                baseURL,
                reason: "Chat model is not configured for native tool calling validation.",
            };
        }

        const validatedModels = options.validatedModels ?? DEFAULT_NATIVE_TOOL_CALLING_VALIDATIONS;
        const validated = validatedModels.some((entry) => {
            return normalizeCapabilityValue(entry.provider) === provider
                && normalizeCapabilityValue(entry.model) === model
                && normalizeBaseURL(entry.baseURL) === baseURL;
        });

        if (!validated) {
            return {
                supported: false,
                status: "unsupported",
                provider,
                model,
                baseURL,
                reason: "Provider/model/baseURL is not validated for native tool calling.",
            };
        }

        return {
            supported: true,
            status: "supported",
            provider,
            model,
            baseURL,
            reason: "Provider/model/baseURL is validated for native tool calling.",
        };
    }

    /**
     * 创建嵌入模型实例
     */
    async createEmbeddings(dimensions?: number, options: CreateEmbeddingsOptions = {}): Promise<OpenAIEmbeddings | OllamaEmbeddings> {
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
                    configuration: this.createOpenAIClientOptions(baseURL, 'obsidian'),
                    batchSize: options.batchSize,
                    maxConcurrency: options.maxConcurrency,
                    maxRetries: options.maxRetries,
                });
            }

            case 'ollama': {
                if (!Platform.isDesktop) {
                    throw new Error('Ollama embeddings are only available on Obsidian Desktop.');
                }
                return new OllamaEmbeddings({
                    model: modelName,
                    baseUrl: baseURL,
                    maxConcurrency: options.maxConcurrency,
                    maxRetries: options.maxRetries,
                });
            }

            default:
                throw new Error(`Unsupported AI provider: ${provider}`);
        }
    }

    /**
     * 创建OpenAI兼容的LLM实例（兼容旧版本）
     */
    async createOpenAICompatibleLLM(model: string = "qwen-max", temperature: number = 0.8): Promise<ChatOpenAI<ChatOpenAICallOptions>> {
        const token = await this.getAPIToken();
        return new ChatOpenAI({
            model: model,
            apiKey: token,
            configuration: this.createOpenAIClientOptions('https://dashscope.aliyuncs.com/compatible-mode/v1'),
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
            configuration: this.createOpenAIClientOptions('https://dashscope.aliyuncs.com/compatible-mode/v1'),
        });
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

    async hashContent(content: string): Promise<string> {
        return await computeContentHash(content);
    }

    /**
     * 获取文档内容（去除frontmatter）
     */
    getDocumentContent(markdown: string): { content: string; frontmatterInfo: FrontMatterInfo } {
        const frontmatterInfo = getFrontMatterInfo(markdown);
        const content = markdown.slice(frontmatterInfo.contentStart);
        return { content, frontmatterInfo };
    }
}

function normalizeCapabilityValue(value: unknown): string {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeBaseURL(value: unknown): string {
    const normalized = normalizeCapabilityValue(value);
    return normalized.replace(/\/+$/, "");
}

function isKnownNativeToolProvider(provider: string): boolean {
    return provider === "openai" || provider === "qwen" || provider === "ollama";
}
