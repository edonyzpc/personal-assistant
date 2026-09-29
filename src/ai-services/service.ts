/* Copyright 2023 eddiezpc */
import { Editor, MarkdownView, Notice, type App } from 'obsidian';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

import { AIUtils, type AIUtilsHost } from './ai-utils';
import { getPluginUiLanguage, pluginT } from '../locales/plugin';

interface SummaryResponse {
    summary: string;
    keywords: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const normalizeTag = (tag: string): string => tag.trim();

const normalizeFrontmatterTags = (tags: unknown): string[] => {
    if (Array.isArray(tags)) {
        return tags
            .filter((tag): tag is string => typeof tag === 'string')
            .map(normalizeTag)
            .filter(Boolean);
    }

    if (typeof tags === 'string') {
        return tags
            .split(/[\s,]+/)
            .map(normalizeTag)
            .filter(Boolean);
    }

    return [];
};

export const mergeFrontmatterTags = (currentTags: unknown, keywords: string[]): string[] => {
    const mergedTags: string[] = [];
    const seen = new Set<string>();

    for (const tag of [...normalizeFrontmatterTags(currentTags), ...keywords]) {
        const normalized = normalizeTag(tag);
        if (!normalized) continue;

        const dedupeKey = normalized.replace(/^#/, '').toLowerCase();
        if (seen.has(dedupeKey)) continue;

        seen.add(dedupeKey);
        mergedTags.push(normalized);
    }

    return mergedTags;
};

function findBalancedJsonObject(text: string): string | null {
    const start = text.indexOf('{');
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < text.length; index++) {
        const char = text[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }

        if (char === '"') inString = true;
        else if (char === '{') depth += 1;
        else if (char === '}') {
            depth -= 1;
            if (depth === 0) return text.slice(start, index + 1);
        }
    }

    return null;
}

function extractJsonPayload(raw: string): string | null {
    const trimmed = raw.trim();
    const fencedJson = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fencedJson) return fencedJson[1].trim();

    if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
    return findBalancedJsonObject(trimmed);
}

export const parseSummaryResponse = (raw: string): SummaryResponse | null => {
    const jsonPayload = extractJsonPayload(raw);
    if (!jsonPayload) return null;

    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonPayload);
    } catch {
        return null;
    }

    if (!isRecord(parsed) || typeof parsed.summary !== 'string' || !Array.isArray(parsed.keywords)) return null;

    const summary = parsed.summary.trim();
    const keywords = parsed.keywords
        .filter((keyword): keyword is string => typeof keyword === 'string')
        .map(normalizeTag)
        .filter(Boolean);

    if (!summary) return null;
    return { summary, keywords };
};

export interface AIServiceHost extends AIUtilsHost {
    readonly app: App;
}

/** Summary remains the only synchronous editor helper in this legacy service. */
export class AIService {
    private readonly aiUtils: AIUtils;
    private readonly plugin: AIServiceHost;

    constructor(plugin: AIServiceHost) {
        this.plugin = plugin;
        this.aiUtils = new AIUtils(plugin);
    }

    private t(key: string, params?: Readonly<Record<string, string | number>>): string {
        return pluginT(key, getPluginUiLanguage(), params);
    }

    private formatErrorMessage(error: unknown): string {
        if (error instanceof Error) return error.message;
        if (typeof error === 'string') return error;
        return this.t('plugin.ai.error.unknown');
    }

    async generateSummary(editor: Editor, view: MarkdownView): Promise<void> {
        const { notice } = this.aiUtils.createAIThinkingNotice();
        try {
            const markdown = editor.getValue();
            const { content } = this.aiUtils.getDocumentContent(markdown);
            const result = await this.callLLM(content, this.getSummaryPrompt());
            if (!result) {
                new Notice(this.t('plugin.ai.notice.unavailable'));
                return;
            }

            const summaryResponse = parseSummaryResponse(result);
            if (!summaryResponse) {
                new Notice(this.t('plugin.ai.notice.invalidSummary'), 5000);
                return;
            }

            if (view.file) {
                await this.plugin.app.fileManager.processFrontMatter(view.file, frontmatter => {
                    frontmatter['AI Summary'] = summaryResponse.summary;
                    frontmatter['tags'] = mergeFrontmatterTags(frontmatter['tags'], summaryResponse.keywords);
                });
            }
        } catch (error) {
            this.plugin.log('AI Summary failed', error);
            new Notice(this.t('plugin.ai.notice.summaryFailed', {
                error: this.formatErrorMessage(error),
            }), 5000);
        } finally {
            notice.hide();
        }
    }

    private async callLLM(query: string, systemPrompt: string): Promise<string> {
        const model = await this.aiUtils.createChatModel(0.8);
        const response = await model.invoke([
            new SystemMessage(systemPrompt),
            new HumanMessage(`**文字内容：**${query}`),
        ]);
        const content = stringifyMessageContent(response.content);
        this.plugin.log('LLM response received', { contentLength: content.length });
        return content;
    }

    private getSummaryPrompt(): string {
        return `你是一个专业编辑，擅长文字总结、概括等工作。
**你的任务是：**
1. 跟根据给出的文字内容进行概括总结
2. 根据文字内容提炼最能体现文字内容的关键词

**要求：**
- 概括总结的字数要求不超过120字
- 提炼的关键词数目要求是3个左右
- 提炼的关键词要求是英文
- 关键词只能使用：英文字母、数字、连字符，不可以使用其他字符
- 输出结果的格式为：
{
  "summary": "...",
  "keywords": ["...", "..."]
}`;
    }
}

function stringifyMessageContent(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map(part => {
            if (typeof part === 'string') return part;
            if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') return part.text;
            return '';
        }).join('\n').trim();
    }
    return '';
}
