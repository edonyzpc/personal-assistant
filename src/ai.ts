/* Copyright 2023 edonyzpc */
import { Editor, MarkdownView, Notice, addIcon, setIcon } from 'obsidian'
import fetch, { Headers, Request, Response } from "node-fetch";
import { EditorView } from '@codemirror/view'
import { StateEffect } from '@codemirror/state'
import { nanoid } from 'nanoid'

import { ChatAlibabaTongyi } from "@langchain/community/chat_models/alibaba_tongyi";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

import { PluginManager } from './plugin'
import { icons } from './utils';

export class AssistantHelper {
    private editor: Editor

    private view: EditorView

    private query: string = ''

    private plugin: PluginManager

    constructor(
        plugin: PluginManager,
        editor: Editor,
        view: MarkdownView,
    ) {
        this.plugin = plugin
        this.editor = editor
        this.query = this.editor.getValue()
        // @ts-expect-error, not typed
        this.view = view.editor.cm
    }

    async generate() {
        const noticeEl = document.createDocumentFragment();
        const div = noticeEl.createEl("div", { attr: { id: "ai-breahting-icon" } });
        div.addClass("personal-assistant-statusbar-breathing");
        addIcon('PluginAST_STATUSBAR', icons['PluginAST_STATUSBAR']);
        setIcon(div, 'PluginAST_STATUSBAR');
        const divInfo = noticeEl.createEl("div", { attr: { id: "ai-breahting-icon" } });
        divInfo.innerHTML = `<span style="color: #fff;font-weight:bold;">AI is Thinking...</span>`;
        const notice = new Notice(noticeEl, 0);

        const result = await this.qwenLLM(this.query)
        const { summary, keywords } = JSON.parse(result)
        console.log(summary);
        console.log(keywords[0]);

        const url = `https://webhook.worker.edony.ink/unsplash?query=${encodeURI(keywords[0])}&X-Api-Auth=36fb38ddc202fec`
        console.log(url)
        const imgSearchRes = await fetch(url)
        const imageURL = await imgSearchRes.text()
        console.log(imageURL)

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
        const lastNum = this.editor.lastLine();
        const counts = this.editor.lineCount();
        console.log(`lastNum: ${lastNum} counts: ${counts}`)
        const line = this.view.state.doc.lineAt(0);
        // append line breaks
        this.view.dispatch({
            changes: [
                {
                    from: line.from,
                    // insert a callout block
                    insert: `\n\n>[!personal-assistant]+ AI\n> ![](${imageURL})\n> \n> ${summary}\n\n`,
                },
            ],
            effects: [addAI.of({ from: line.to, to: line.to, id })],
        })

        notice.hide();
    }

    private async qwenLLM(query: string) {
        const qwenMax = new ChatAlibabaTongyi({
            model: "qwen-max", // Available models: qwen-turbo, qwen-plus, qwen-max
            temperature: 0.8,
            alibabaApiKey: "API-KEY", // In Node.js defaults to process.env.ALIBABA_API_KEY
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

        console.log(res.content)
        return res.content.toString()
    }
}