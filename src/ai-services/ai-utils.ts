/* Copyright 2023 edonyzpc */
import { Notice, getFrontMatterInfo, type FrontMatterInfo } from 'obsidian'
import { ChatOpenAI, type ChatOpenAICallOptions, type ClientOptions } from '@langchain/openai';
import { OpenAIEmbeddings } from '@langchain/openai';

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

// Tool-calling protocol matrix (canonical PA streaming support, v2.0.0):
//   provider=openai  → transport=openai-compatible-stream, streamingToolCalls=true, preservesToolCallId=true,
//                      earliest observable shape = AIMessageChunk.tool_call_chunks or additional_kwargs.tool_calls.
//   provider=qwen    → transport=openai-compatible-stream, streamingToolCalls=true, preservesToolCallId=true,
//                      earliest observable shape = AIMessageChunk.tool_call_chunks from DashScope OpenAI-compatible
//                      streaming. Only validated DashScope-compatible model/baseURL combinations (see
//                      DASHSCOPE_NATIVE_TOOL_CALLING_MODELS below) enter PA streamed tool-call mode.
//   Unsupported providers (e.g. Ollama) must error out rather than fall back — the legacy json-planning-loop /
//   non-streaming-transport paths were removed with v2.0.0 (see PaAgentRuntime path; no rollback flag remains).
//   Historical record: this matrix used to live in `src/ai-services/tool-calling-protocol.ts` (deleted v2.0.0
//   cleanup) and is preserved here for grep-ability and architecture-plan §38-48 cross-reference.

export const DASHSCOPE_COMPATIBLE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
export const DASHSCOPE_INTL_COMPATIBLE_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
export const DASHSCOPE_COMPATIBLE_BASE_URLS: readonly string[] = [
    DASHSCOPE_COMPATIBLE_BASE_URL,
    DASHSCOPE_INTL_COMPATIBLE_BASE_URL,
];

export const DASHSCOPE_NATIVE_TOOL_CALLING_MODELS: readonly string[] = [
    "qwen3.6-*",
    "qwen3.5-*",
    "qwen3-*",
    "qwen2.5-*",
    "qwen-max*",
    "qwen-plus*",
    "qwen-flash*",
    "qwen-coder*",
    "qwen-turbo*",
    "deepseek-v4-pro",
    "deepseek-v4-flash",
    "deepseek-v3.2",
    "deepseek-v3.2-exp",
    "deepseek-v3.1",
    "deepseek-r1",
    "deepseek-r1-0528",
    "deepseek-v3",
    "siliconflow/deepseek-v3.2",
    "siliconflow/deepseek-v3.1-terminus",
    "siliconflow/deepseek-r1-0528",
    "siliconflow/deepseek-v3-0324",
    "vanchin/deepseek-v3.2-think",
    "vanchin/deepseek-v3.1-terminus",
    "vanchin/deepseek-r1",
    "vanchin/deepseek-v3",
    "glm-5.1",
    "glm-5",
    "glm-4.7",
    "glm-4.6",
    "glm-4.5",
    "glm-4.5-air",
    "kimi-k2.6",
    "kimi-k2.5",
    "kimi-k2-thinking",
    "moonshot-kimi-k2-instruct",
    "kimi/kimi-k2.6",
    "kimi/kimi-k2.5",
    "minimax-m2.5",
    "minimax-m2.1",
    "minimax/minimax-m2.7",
    "minimax/minimax-m2.5",
    "minimax/minimax-m2.1",
];

const DASH_SCOPE_NATIVE_TOOL_CALLING_UNSUPPORTED_MODEL_SIGNALS = [
    "character",
    "embedding",
    "qwen-long",
    "qwen-mt",
    "qwen-omni-turbo",
    "qwen2.5-omni",
    "qwen2.5-vl",
    "rerank",
    "asr",
    "ocr",
    "tts",
];

export const DEFAULT_NATIVE_TOOL_CALLING_VALIDATIONS: readonly NativeToolCallingValidation[] =
    buildDashScopeNativeToolCallingValidations(DASHSCOPE_NATIVE_TOOL_CALLING_MODELS);
export const SMOKE_NATIVE_TOOL_CALLING_VALIDATIONS: readonly NativeToolCallingValidation[] =
    DEFAULT_NATIVE_TOOL_CALLING_VALIDATIONS;

interface CreateChatModelOptions {
    transport?: ChatTransport;
    qwenRequestOptions?: QwenRequestOptions;
    modelName?: string;
}

export interface CreateEmbeddingsOptions {
    batchSize?: number;
    maxConcurrency?: number;
    maxRetries?: number;
}

export interface QwenRequestOptions {
    enableThinking?: boolean;
}

export interface QwenModelKwargs {
    enable_thinking?: boolean;
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
    ): Promise<ChatOpenAI<ChatOpenAICallOptions>> {
        const provider = this.plugin.settings.aiProvider;
        const modelName = options.modelName || this.plugin.settings.chatModelName;
        const baseURL = this.plugin.settings.baseURL;
        const transport = options.transport ?? 'obsidian';

        switch (provider) {
            case 'qwen': {
                const token = await this.getAPIToken();
                const modelKwargs = buildQwenModelKwargs(provider, baseURL, options.qwenRequestOptions);
                return new ChatOpenAI({
                    model: modelName,
                    apiKey: token,
                    configuration: this.createOpenAIClientOptions(baseURL, transport),
                    temperature: temperature,
                    ...(modelKwargs ? { modelKwargs } : {}),
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
        const validated = !hasUnsupportedNativeToolModelSignal(model) && validatedModels.some((entry) => {
            return normalizeCapabilityValue(entry.provider) === provider
                && matchesNativeToolValidationModel(entry.model, model)
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
    async createEmbeddings(dimensions?: number, options: CreateEmbeddingsOptions = {}): Promise<OpenAIEmbeddings> {
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

            default:
                throw new Error(`Unsupported AI provider: ${provider}`);
        }
    }

    /**
     * 清理markdown内容
     */
    cleanMarkdownContent(markdown: string): string {
        // 保护代码块区域，避免注释正则穿透 ``` 边界
        const codeBlockPlaceholders: string[] = [];
        let cleaned = markdown.replace(/^```.*?$(?:\n.*?)*^```$/gm, (match) => {
            codeBlockPlaceholders.push(match);
            return `\x00CB${codeBlockPlaceholders.length - 1}\x00`;
        });
        cleaned = cleaned.replace(/%%[\s\S]*?%%/g, '');
        cleaned = cleaned.replace(/\[\[[\w-]+\.[a-z]{1,}\]\]/g, '');
        // 恢复代码块 — \x00 用作私有占位符分隔符，不会与用户文档内容冲突
        // eslint-disable-next-line no-control-regex
        cleaned = cleaned.replace(/\x00CB(\d+)\x00/g, (_, i) => codeBlockPlaceholders[Number(i)]);
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

export function isDashScopeCompatibleBaseURL(value: unknown): boolean {
    const normalized = normalizeBaseURL(value);
    return DASHSCOPE_COMPATIBLE_BASE_URLS.some((baseURL) => normalizeBaseURL(baseURL) === normalized);
}

function buildDashScopeNativeToolCallingValidations(
    models: readonly string[],
): NativeToolCallingValidation[] {
    return DASHSCOPE_COMPATIBLE_BASE_URLS.flatMap((baseURL) => models.map((model) => ({
        provider: "qwen",
        model,
        baseURL,
    })));
}

function matchesNativeToolValidationModel(validationModel: string, model: string): boolean {
    const normalizedValidationModel = normalizeCapabilityValue(validationModel);
    if (!normalizedValidationModel.endsWith("*")) {
        return normalizedValidationModel === model;
    }
    const prefix = normalizedValidationModel.slice(0, -1);
    return Boolean(prefix) && model.startsWith(prefix);
}

function hasUnsupportedNativeToolModelSignal(model: string): boolean {
    return DASH_SCOPE_NATIVE_TOOL_CALLING_UNSUPPORTED_MODEL_SIGNALS.some((signal) => model.includes(signal));
}

export function buildQwenModelKwargs(
    provider: unknown,
    baseURL: unknown,
    options?: QwenRequestOptions,
): QwenModelKwargs | undefined {
    if (normalizeCapabilityValue(provider) !== "qwen") return undefined;
    if (!isDashScopeCompatibleBaseURL(baseURL)) return undefined;
    if (!options?.enableThinking) return undefined;

    const kwargs: QwenModelKwargs = {};
    if (options.enableThinking) {
        kwargs.enable_thinking = true;
    }
    return kwargs;
}

function isKnownNativeToolProvider(provider: string): boolean {
    return provider === "openai" || provider === "qwen";
}
