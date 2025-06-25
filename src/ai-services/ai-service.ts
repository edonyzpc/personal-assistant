/* Copyright 2023 edonyzpc */
import { App, Editor, MarkdownView, Notice, TFile } from 'obsidian'
import { EditorView } from '@codemirror/view'
import { StateEffect } from '@codemirror/state'
import { nanoid } from 'nanoid'
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { Document } from "@langchain/core/documents";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { MarkdownTextSplitter } from '@langchain/textsplitters';

import { AIUtils } from './ai-utils';
import type { PluginManager } from '../plugin'

/**
 * AI服务类，提供统一的AI功能接口
 */
export class AIService {
    private aiUtils: AIUtils;
    private plugin: PluginManager;

    constructor(plugin: PluginManager) {
        this.plugin = plugin;
        this.aiUtils = new AIUtils(plugin);
    }

    /**
     * 生成文档摘要和关键词
     */
    async generateSummary(editor: Editor, view: MarkdownView): Promise<void> {
        const { notice, notification } = this.aiUtils.createAIThinkingNotice();

        try {
            const markdown = editor.getValue();
            const { content } = this.aiUtils.getDocumentContent(markdown);

            const result = await this.callQwenLLM(content, this.getSummaryPrompt());
            if (result.length <= 0) {
                new Notice("AI is not available.");
                return;
            }

            const { summary, keywords } = JSON.parse(result);

            // 更新frontmatter
            if (view.file) {
                this.plugin.app.fileManager.processFrontMatter(view.file, (frontmatter) => {
                    frontmatter["AI Summary"] = summary;
                    const oldTags = frontmatter["tags"] || [];
                    frontmatter["tags"] = oldTags.concat(keywords);
                });
            }
        } finally {
            notice.hide();
        }
    }

    /**
     * 生成标签建议
     */
    async generateTags(editor: Editor, view: MarkdownView, app: App): Promise<string[]> {
        const markdown = editor.getValue();
        const { content } = this.aiUtils.getDocumentContent(markdown);
        const tags = Object.keys((app.metadataCache as any).getTags());

        const prompt = this.getTagsPrompt(content, tags);
        const result = await this.callQwenLLM(content, prompt);
        return JSON.parse(result);
    }

    /**
     * 生成特色图片
     */
    async generateFeaturedImage(editor: Editor, view: MarkdownView): Promise<string | null> {
        const { notice, notification } = this.aiUtils.createAIThinkingNotice();

        try {
            const markdown = editor.getValue();
            const { content } = this.aiUtils.getDocumentContent(markdown);

            // 生成图片描述
            const imageDesc = await this.callQwenLLM(content, this.getImageDescriptionPrompt());
            if (!imageDesc) return null;

            // 生成图片
            const imageUrl = await this.generateImage(imageDesc);
            return imageUrl;
        } finally {
            notice.hide();
        }
    }

    /**
     * 向量化文档
     */
    async vectorizeDocument(file: TFile, cacheDir: string): Promise<boolean> {
        const embeddings = await this.aiUtils.createOpenAIEmbeddings();
        const mdSplitter = new MarkdownTextSplitter({ chunkSize: 4000, chunkOverlap: 80 });

        const markdown = await this.plugin.app.vault.adapter.read(file.path);
        const { content } = this.aiUtils.getDocumentContent(markdown);
        const cleanedContent = this.aiUtils.cleanMarkdownContent(content);

        if (cleanedContent.length === 0) {
            return false;
        }

        const subStrList = await mdSplitter.splitText(cleanedContent);
        const documents = subStrList.map(subStr => new Document({
            pageContent: subStr,
            metadata: {
                path: file.path,
                created: file.stat.ctime,
                lastModified: file.stat.mtime,
            },
        }));

        const vssFile = this.plugin.join(cacheDir, file.path + ".json");
        const shouldUpdate = await this.aiUtils.shouldUpdateFile(file.path, vssFile);
        if (!shouldUpdate) {
            this.plugin.log(`skip ${vssFile}`);
            return false;
        }

        const vectorStore = new MemoryVectorStore(embeddings);

        await this.aiUtils.withFetchPolyfill(async () => {
            if (documents.length > 3) {
                // 每3个document做一次addDocument
                for (let i = 0; i < documents.length; i += 3) {
                    const chunk = documents.slice(i, i + 3);
                    await vectorStore.addDocuments(chunk);
                    // stop 3s for rate limit
                    await new Promise(f => setTimeout(f, 3000));
                }
            } else {
                await vectorStore.addDocuments(documents);
            }
        });

        const objStr = JSON.stringify(vectorStore.memoryVectors, null, 0);
        await this.plugin.app.vault.adapter.write(vssFile, objStr);

        return true;
    }

    /**
     * 搜索相似文档
     */
    async searchSimilarDocuments(prompt: string, vectorStore: MemoryVectorStore): Promise<Array<{ score: number; doc: Document }>> {
        if (!vectorStore) {
            new Notice("Please wait for the vector store to be loaded.");
            return [];
        }

        const similaritySearchWithScoreResults = await vectorStore.similaritySearchWithScore(prompt, 8);

        const content = [];
        for (const [doc, score] of similaritySearchWithScoreResults) {
            this.plugin.log(`* [SIM=${score.toFixed(3)}] [${JSON.stringify(doc.metadata)}]`);
            content.push({ "score": score, "doc": doc });
        }

        return content;
    }

    /**
     * 调用通义千问LLM
     */
    private async callQwenLLM(query: string, systemPrompt: string): Promise<string> {
        const qwenLLM = await this.aiUtils.createQwenLLM();
        const systemMessage = new SystemMessage(systemPrompt);
        const generateMessage = new HumanMessage(`**文字内容：**${query}`);
        const messages = [systemMessage, generateMessage];

        const res = await this.aiUtils.withFetchPolyfill(async () => {
            return await qwenLLM.invoke(messages);
        });

        this.plugin.log(res.content);
        return res.content.toString();
    }

    /**
     * 生成图片
     */
    private async generateImage(description: string): Promise<string | null> {
        // 这里实现图片生成逻辑
        // 由于原代码中的图片生成逻辑比较复杂，这里只是占位
        // 实际实现时需要根据具体的图片生成API来完成
        return null;
    }

    /**
     * 获取摘要生成的提示词
     */
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

    /**
     * 获取标签生成的提示词
     */
    private getTagsPrompt(content: string, tags: string[]): string {
        return `你是一个专业编辑，擅长文字总结、概括等工作。
**你的任务是：**
对给出的文字内容进行分析和总结，在给出的标签列表中找到3个最能表达文字内容的标签

**要求：**
- 给出的标签内容如果能在给定的列表中找到，则要求输出内容跟列表一致
- 如果最能体现文字内容的关键词不在给定的列表中，可以自己增加标签内容，标签的格式必须是：'''#<<关键词>>'''
- 输出结果的格式为：
["#<<关键词1>>", "#<<关键词2>>", "#<<关键词3>>", ...]`;
    }

    /**
     * 获取图片描述的提示词
     */
    private getImageDescriptionPrompt(): string {
        return `你是一个专业的图片描述生成专家。
**你的任务是：**
根据给出的文字内容，生成一个简洁的图片描述，用于生成相关的特色图片。

**要求：**
- 描述要简洁明了，不超过50个字符
- 描述要能体现文字内容的核心主题
- 描述要适合用于图片生成
- 直接输出描述文本，不需要其他格式`;
    }
} 