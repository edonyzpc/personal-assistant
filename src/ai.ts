/* Copyright 2023 edonyzpc */
import { App, Editor, MarkdownView, Notice, getFrontMatterInfo, type FrontMatterInfo } from 'obsidian'
import fetch, { Headers, Request, Response } from "node-fetch";
import { EditorView } from '@codemirror/view'
import { StateEffect } from '@codemirror/state'
import { nanoid } from 'nanoid'

import { Notification } from '@svelteuidev/core';

import { ChatAlibabaTongyi } from "@langchain/community/chat_models/alibaba_tongyi";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

import { PluginManager } from './plugin'
import { CryptoHelper, personalAssitant, queryAI } from './utils';

export class AssistantHelper {
    private editor: Editor

    private view: EditorView

    private query: string = ''

    private plugin: PluginManager

    private fontmatterInfo: FrontMatterInfo

    constructor(
        plugin: PluginManager,
        editor: Editor,
        view: MarkdownView,
    ) {
        this.plugin = plugin
        this.editor = editor
        const markdown = this.editor.getValue()
        this.fontmatterInfo = getFrontMatterInfo(markdown);
        this.query = markdown.slice(this.fontmatterInfo.contentStart);
        // @ts-expect-error, not typed
        this.view = view.editor.cm
    }

    async generate() {
        const noticeEl = document.createDocumentFragment();
        const div = noticeEl.createEl("div", { attr: { id: "ai-breahting-icon", style: "background: white;" } });
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

        const result = await this.qwenLLM(this.query)
        if (result.length <= 0) {
            notification.$destroy();
            notice.hide();
            new Notice("AI is not available.");
            return;
        }
        const { summary, keywords } = JSON.parse(result)
        const url = `https://webhook.worker.edony.ink/unsplash?query=${encodeURI(keywords[0])}&${queryAI}`
        const imgSearchRes = await fetch(url)
        const imageURL = await imgSearchRes.text()

        const addAI = StateEffect.define<{
            id: string
            from: number
            to: number
        }>({
            map: (value, change) => {
                return {
                    from: change.mapPos(value.from),
                    to: change.mapPos(value.to, 1),
                    id: value.id,
                }
            },
        });
        const id = nanoid();
        let line;
        if (this.fontmatterInfo.exists) {
            line = this.view.state.doc.lineAt(this.fontmatterInfo.contentStart);
        } else {
            line = this.view.state.doc.lineAt(0);
        }
        // append line breaks
        this.view.dispatch({
            changes: [
                {
                    from: line.from,
                    // insert a callout block
                    insert: `\n>[!personal-assistant]+ AI\n> ![](${imageURL})\n> \n> ${summary}\n\n`,
                },
            ],
            effects: [addAI.of({ from: line.to, to: line.to, id })],
        })

        notice.hide();
    }

    private async qwenLLM(query: string) {
        const encryptedToken = this.plugin.settings.apiToken;
        const crypto = new CryptoHelper();
        const token = await crypto.decryptFromBase64(encryptedToken, personalAssitant);
        if (!token) {
            new Notice("Prepare LLM failed!", 3000);
            return "";
        }
        const qwenMax = new ChatAlibabaTongyi({
            model: "qwen-max", // Available models: qwen-turbo, qwen-plus, qwen-max
            temperature: 0.8,
            alibabaApiKey: token, // In Node.js defaults to process.env.ALIBABA_API_KEY
        });

        const systemTemplate = `你是一个专业编辑，擅长文字总结、概括等工作。
**你的任务是：**
1. 跟根据给出的文字内容进行概括总结
2. 根据文字内容提炼最能体现文字内容的关键词

**要求：**
- 概括总结的字数要求不超过120字
- 提炼的关键词数目要求是2个
- 提炼的关键词要求是英文
- 输出结果的格式为：
{
  "summary": "...",
  "keywords": ["...", "..."]
}
`
        const systemMessage = new SystemMessage(systemTemplate)
        const generateMessageTemplate = `**文字内容：**${query}`
        const generateMessage = new HumanMessage(generateMessageTemplate)
        const messages = [systemMessage, generateMessage];

        const originFetch = globalThis.fetch
        const originHeaders = globalThis.Headers
        const originRequest = globalThis.Request
        const originResponse = globalThis.Response
        // @ts-ignore
        globalThis.fetch = fetch
        // @ts-ignore
        globalThis.Headers = Headers
        // @ts-ignore
        globalThis.Request = Request
        // @ts-ignore
        globalThis.Response = Response
        const res = await qwenMax.invoke(messages);
        globalThis.fetch = originFetch
        globalThis.Headers = originHeaders
        globalThis.Request = originRequest
        globalThis.Response = originResponse

        this.plugin.log(res.content)
        return res.content.toString()
    }
}

export class AssistantRobot {
    private editor: Editor

    private view: EditorView

    private query: string = ''

    private selected: string = ''

    private plugin: PluginManager

    private fontmatterInfo: FrontMatterInfo

    private tags: string[]

    constructor(
        plugin: PluginManager,
        editor: Editor,
        view: MarkdownView,
        app: App,
        selected: string
    ) {
        this.plugin = plugin
        this.editor = editor
        const markdown = this.editor.getValue()
        this.fontmatterInfo = getFrontMatterInfo(markdown);
        this.query = markdown.slice(this.fontmatterInfo.contentStart);
        // @ts-expect-error, not typed
        this.view = view.editor.cm;
        this.selected = selected;
        this.tags = Object.keys((app.metadataCache as any).getTags()); // eslint-disable-line @typescript-eslint/no-explicit-any
    }

    async assitantTags() {
        const systemTemplate = `你是一个专业编辑，擅长文字总结、概括等工作。
**你的任务是：**
对给出的文字内容进行分析和总结，在给出的标签列表中找到3个最能表达文字内容的标签


**要求：**
- 给出的标签内容如果能在给定的列表中找到，则要求输出内容跟列表一致
- 如果最能体现文字内容的关键词不在给定的列表中，可以自己增加标签内容，标签的格式必须是：'''#<<关键词>>'''
- 输出结果的格式为：
["#<<关键词1>>", "#<<关键词2>>", "#<<关键词3>>", ...]
`
        const messageTemplate = `**文字内容：**${this.query}\n**标签列表：**${this.tags}`
        const systemMessage = new SystemMessage(systemTemplate)
        const generateMessage = new HumanMessage(messageTemplate)
        const messages = [systemMessage, generateMessage];

        const res = await this.qwenLLM(messages);
        const tags: string[] = JSON.parse(res);

        const addAI = StateEffect.define<{
            id: string
            from: number
            to: number
        }>({
            map: (value, change) => {
                return {
                    from: change.mapPos(value.from),
                    to: change.mapPos(value.to, 1),
                    id: value.id,
                }
            },
        });
        const id = nanoid();
        const line = this.view.state.doc.lineAt(this.view.state.doc.length);
        const tagStr = tags.join(" ");

        // append line breaks
        this.view.dispatch({
            changes: [
                {
                    from: line.to,
                    // insert a callout block
                    insert: `\n\n ${tagStr} `,
                },
            ],
            effects: [addAI.of({ from: line.to, to: line.to, id })],
        })

        return tagStr
    }

    private async qwenLLM(messages: (SystemMessage | HumanMessage)[]) {
        const encryptedToken = this.plugin.settings.apiToken;
        const crypto = new CryptoHelper();
        const token = await crypto.decryptFromBase64(encryptedToken, personalAssitant);
        if (!token) {
            new Notice("Prepare LLM failed!", 3000);
            return "";
        }
        const qwenMax = new ChatAlibabaTongyi({
            model: "qwen-max", // Available models: qwen-turbo, qwen-plus, qwen-max
            temperature: 0.8,
            alibabaApiKey: token, // In Node.js defaults to process.env.ALIBABA_API_KEY
        });

        const originFetch = globalThis.fetch
        const originHeaders = globalThis.Headers
        const originRequest = globalThis.Request
        const originResponse = globalThis.Response
        // @ts-ignore
        globalThis.fetch = fetch
        // @ts-ignore
        globalThis.Headers = Headers
        // @ts-ignore
        globalThis.Request = Request
        // @ts-ignore
        globalThis.Response = Response
        const res = await qwenMax.invoke(messages);
        globalThis.fetch = originFetch
        globalThis.Headers = originHeaders
        globalThis.Request = originRequest
        globalThis.Response = originResponse

        this.plugin.log(res.content)
        return res.content.toString()
    }
}