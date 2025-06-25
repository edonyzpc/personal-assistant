/* Copyright 2023 edonyzpc */
import { App, Notice, getFrontMatterInfo, type FrontMatterInfo, TFile } from 'obsidian'
import fetch, { Headers, Request, Response } from "node-fetch";
import { ChatAlibabaTongyi } from "@langchain/community/chat_models/alibaba_tongyi";
import { ChatOpenAI, type ChatOpenAICallOptions } from '@langchain/openai';
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { OpenAIEmbeddings } from '@langchain/openai';
import { Notification } from '@svelteuidev/core';

import type { PluginManager } from '../plugin'

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

    /**
     * 创建AI思考中的通知
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
     * 创建通义千问LLM实例
     */
    async createQwenLLM(model: string = "qwen-max", temperature: number = 0.8): Promise<ChatAlibabaTongyi> {
        const token = await this.getAPIToken();
        return new ChatAlibabaTongyi({
            model: model,
            temperature: temperature,
            alibabaApiKey: token,
        });
    }

    /**
     * 创建OpenAI兼容的LLM实例
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
     * 创建OpenAI Embeddings实例
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