/* Copyright 2023 edonyzpc */
import { App, Editor, MarkdownView, Notice, getFrontMatterInfo, type FrontMatterInfo } from 'obsidian'
import fetch, { Headers, Request, Response } from "node-fetch";
import { EditorView } from '@codemirror/view'
import { StateEffect } from '@codemirror/state'
import { nanoid } from 'nanoid'

import { Notification } from '@svelteuidev/core';

import { ChatAlibabaTongyi } from "@langchain/community/chat_models/alibaba_tongyi";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { AlibabaTongyiEmbeddings } from "@langchain/community/embeddings/alibaba_tongyi";
import type { Document } from "@langchain/core/documents";


import { PluginManager } from './plugin'
import { CryptoHelper, personalAssitant } from './utils';

export class AssistantHelper {
    private editor: Editor

    private view: EditorView

    private query: string = ''

    private plugin: PluginManager

    private fontmatterInfo: FrontMatterInfo

    private readonly markdownView: MarkdownView;

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
        this.view = view.editor.cm;
        this.markdownView = view;
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
        notice.noticeEl.parentElement?.setCssStyles({
            "backgroundColor": "white",
        });

        const result = await this.qwenLLM(this.query)
        if (result.length <= 0) {
            notification.$destroy();
            notice.hide();
            new Notice("AI is not available.");
            return;
        }
        const { summary, keywords } = JSON.parse(result)
        /*
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
        */
        if (this.markdownView.file) {
            this.plugin.app.fileManager.processFrontMatter(this.markdownView.file, (frontmatter) => {
                frontmatter["AI Summary"] = summary;
                const oldTags = frontmatter["tags"] || [];
                frontmatter["tags"] = oldTags.concat(keywords);
            })
        }

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
- 提炼的关键词数目要求是3个左右
- 提炼的关键词要求是英文
- 关键词只能使用：英文字母、数字、连字符，不可以使用其他字符
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


interface ImageGenerationResult {
    output: {
        task_status: string;
        task_id: string;
    };
    request_id: string;
    code: string;
    message: string;
}

interface TaskData {
    request_id: string;
    output: {
        task_id: string;
        task_status: string;
        task_metrics: {
            TOTAL: number;
            SUCCEEDED: number;
            FAILED: number;
        };
        results: Array<{
            url: string;
            code: string;
            message: string;
        }>;
    };
    usage: {
        image_count: number;
    };
    code: string;
    message: string;
}
export class AssistantFeaturedImageHelper {
    private app: App;

    private editor: Editor

    private view: EditorView

    private query: string = ''

    private plugin: PluginManager

    private fontmatterInfo: FrontMatterInfo

    private log: any; // eslint-disable-line @typescript-eslint/no-explicit-any

    constructor(
        app: App,
        plugin: PluginManager,
        editor: Editor,
        view: MarkdownView,
    ) {
        this.app = app;
        this.plugin = plugin;
        this.log = plugin.log;
        this.editor = editor;
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
        const progress1Div = notice.noticeEl.createEl("div", { attr: { id: "ai-featured-image-progress-1", style: "background: white;color: black;margin-top: 4px;" } });
        progress1Div.setText("    🚧   Agent Generating Prompt...");
        const result = await this.qwenLLMImageDes(this.query)
        if (result.length <= 0) {
            notification.$destroy();
            notice.hide();
            new Notice("AI is not available.");
            return;
        }
        progress1Div.setText("    ✅   Generating Prompt Success!");
        const progress2Div = notice.noticeEl.createEl("div", { attr: { id: "ai-featured-image-progress-2", style: "background: white;color: black;margin-top: 4px;" } });
        progress2Div.setText("    🚧   Agent Generating Images...");
        const imagesGen = await this.generateImage(result);
        progress2Div.setText("    ✅   Generating Images Success!");
        const progress3Div = notice.noticeEl.createEl("div", { attr: { id: "ai-featured-image-progress-3", style: "background: white;color: black;margin-top: 4px;" } });
        progress3Div.setText("    🚧   Agent Downloading Images...");

        if (imagesGen) {
            const imageUrls = await this.getImage(imagesGen);
            if (imageUrls) {
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
                let imagesCallout = "";
                const featuredImagePath = this.plugin.settings.featuredImagePath;
                for (let i = 0; i < imageUrls.length; i++) {
                    const imageUrlStr = imageUrls[i].url;
                    const response = await this.downloadImageToVault(this.app, imageUrlStr, featuredImagePath);
                    if (response) {
                        imagesCallout += `![[${response}]]\n> `;
                    }
                }
                progress3Div.setText("    ✅   Downloading Images Success!");
                // append line breaks
                imagesCallout += "\n\n";
                this.view.dispatch({
                    changes: [
                        {
                            from: line.from,
                            // insert a callout block
                            insert: `\n>[!personal-assistant]+ Featured Images\n> ${imagesCallout}`,
                        },
                    ],
                    effects: [addAI.of({ from: line.to, to: line.to, id })],
                })
                const progress4Div = notice.noticeEl.createEl("div", { attr: { id: "ai-featured-image-progress-4", style: "background: white;color: black;margin-top: 4px;" } });
                progress4Div.setText("    ✅   Generating Featured Images Success!");
                notification.$destroy();
                notice.hide();
            }
        } else {
            notification.$destroy();
            notice.hide();
            new Notice("AI feautured image generation failed.");
            return;
        }
    }

    private async qwenLLMImageDes(query: string): Promise<string> {
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

        const systemTemplate = `你是一个精通文字编辑和图片处理的专家，你会根据我给出的文字内容生成一段图片描述，该图片会作为给出的文字内容的特色图片（特色图片featured image代表博客或页面的文字内容，情绪或主题，并在整个网站中使用），要求：
1. 该描述能够帮助AI理解并生成与文字内容相关的图片；
2. 该描述能够概括出文字内容中的主要信息和主题，为了让图片更有创意性，你可适当的增加天马行空的元素和描述；
3. 你会从图片专家的角度思考，描述中尽量包括图片中心主题，环境信息，图片中的物体位置、图片中的物体大小、图片中的物体颜色、图片中的物体形状、图片中的物体材质、图片中的物体风格、图片中的物体数量、图片中的物体关系等等；
4. 同时你还会给出图片艺术风格的描述，具体图片艺术风格你可以根据自己对给出的文字内容的理解自行决定，图片风格你只可以从如下选项中选择：
    - <photography>：摄影。
    - <portrait>：人像写真。
    - <3d cartoon>：3D卡通。
    - <anime>：动画。
    - <oil painting>：油画。
    - <watercolor>：水彩。
    - <sketch>：素描。
    - <chinese painting>：中国画。
    - <flat illustration>：扁平插画。；
5. 你会从图片专家的角度思考，给出一些用于AI生成图片时可以利用的技术参数从而让图片变得更加美观，你可以根据自身对图片以及美观的理解自行选择需要设置的图片技术参数例如近景镜头、半身特写、锐化等等；`
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

    private async generateImage(genMsg: string) {
        const encryptedToken = this.plugin.settings.apiToken;
        const crypto = new CryptoHelper();
        const token = await crypto.decryptFromBase64(encryptedToken, personalAssitant);
        if (!token) {
            new Notice("Prepare LLM failed!", 3000);
            return null;
        }
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
        const resp = await globalThis.fetch(
            "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-DashScope-Async": "enable",
                    "Authorization": "Bearer " + token,
                },
                body: JSON.stringify({
                    "model": "wanx2.1-t2i-plus",
                    "input": {
                        "prompt": genMsg,
                    },
                    "parameters": {
                        "size": "1024*1024",
                        "n": this.plugin.settings.numFeaturedImages,
                        "seed": 42,
                        "prompt_extend": true,
                        "watermark": false,
                    }
                })
            },
        );
        globalThis.fetch = originFetch;
        globalThis.Headers = originHeaders;
        globalThis.Request = originRequest;
        globalThis.Response = originResponse;

        if (resp.ok) {
            const result: ImageGenerationResult = await resp.json();
            this.plugin.log(result);
            return result;
        } else {
            return null;
        }
    }


    private async getImage(generateResult: ImageGenerationResult) {
        const encryptedToken = this.plugin.settings.apiToken;
        const crypto = new CryptoHelper();
        const token = await crypto.decryptFromBase64(encryptedToken, personalAssitant);
        if (!token) {
            new Notice("Prepare LLM failed!", 3000);
            return null;
        }

        const taskID = generateResult.output.task_id;

        const pollTaskStatus = async (taskId: string, baseUrl: string, timeoutMs = 300000) => {
            const startTime = Date.now();

            while (Date.now() - startTime <= timeoutMs) {
                // 检查是否超时
                try {
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
                    const response = await fetch(`${baseUrl}/${taskId}`, { method: "GET", headers: { "Authorization": "Bearer " + token } });
                    globalThis.fetch = originFetch;
                    globalThis.Headers = originHeaders;
                    globalThis.Request = originRequest;
                    globalThis.Response = originResponse;
                    if (response.ok) {
                        const data = await response.json() as TaskData;
                        if (data.output.task_status === 'SUCCEEDED') {
                            return data;
                        }
                    }

                    // 等待60秒
                    await new Promise(resolve => setTimeout(resolve, 60000));

                } catch (error) {
                    console.error('Error polling task:', error);
                    throw error;
                }
            }

            return null;
        }

        const baseUrl = 'https://dashscope.aliyuncs.com/api/v1/tasks';
        const taskId = taskID;
        const timeout = 10 * 60 * 1000; // 10分钟超时

        const imagesTaskData = await pollTaskStatus(taskId, baseUrl, timeout);

        if (imagesTaskData && imagesTaskData.output.task_status === 'SUCCEEDED') {
            // 处理成功的情况
            this.plugin.log(imagesTaskData);
            return imagesTaskData.output.results; // 假设返回的结果在 output.result 中
        } else {
            new Notice("Failed to get image: Task did not succeed or timed out.", 3000);
            return null;
        }
    }

    private async downloadImageToVault(app: App, imageUrl: string, folderPath: string) {
        try {
            // 从 URL 中提取文件名
            const filename = imageUrl.split('/').pop()?.split('?')[0] || 'image.png';

            // 构建完整的保存路径
            const savePath = `${folderPath}/${filename}`;

            // 确保目标文件夹存在
            const folder = app.vault.getAbstractFileByPath(folderPath);
            if (!folder) {
                await app.vault.createFolder(folderPath);
            }

            // 下载图片
            const response = await fetch(imageUrl);
            if (!response.ok) {
                throw new Error(`Failed to download image: ${response.statusText}`);
            }

            // 将响应转换为 ArrayBuffer
            const buffer = await response.arrayBuffer();

            // 保存文件到 Obsidian vault
            await app.vault.createBinary(savePath, buffer);

            // 显示成功通知
            new Notice(`Image downloaded successfully to ${savePath}`);

            // 返回创建的文件路径
            return savePath;

        } catch (error) {
            new Notice(`Failed to download image: ${error}`);
            throw error;
        }
    }
}

export class SimilaritySearch {
    private editor: Editor

    private view: EditorView

    private query: string = ''

    private plugin: PluginManager

    private fontmatterInfo: FrontMatterInfo

    private readonly markdownView: MarkdownView;

    private dbFile: string
    constructor(
        dbFile: string,
        plugin: PluginManager,
        editor: Editor,
        view: MarkdownView,
    ) {
        this.dbFile = dbFile;
        this.plugin = plugin
        this.editor = editor
        const markdown = this.editor.getValue()
        this.fontmatterInfo = getFrontMatterInfo(markdown);
        this.query = markdown.slice(this.fontmatterInfo.contentStart);
        // @ts-expect-error, not typed
        this.view = view.editor.cm;
        this.markdownView = view;
    }

    async vectorStore() {
        const encryptedToken = this.plugin.settings.apiToken;
        const crypto = new CryptoHelper();
        const token = await crypto.decryptFromBase64(encryptedToken, personalAssitant);
        if (!token) {
            new Notice("Prepare LLM failed!", 3000);
            return "";
        }
        const embeddings = new AlibabaTongyiEmbeddings({
            apiKey: token,
            modelName: "text-embedding-v2",
        });


        const vectorStore = new MemoryVectorStore(embeddings);
        const document1: Document = {
            pageContent: "The powerhouse of the cell is the mitochondria",
            metadata: { source: "https://example.com" },
        };
        const document2: Document = {
            pageContent: "Buildings are made out of brick",
            metadata: { source: "https://example.com" },
        };
        const document3: Document = {
            pageContent: "Mitochondria are made out of lipids",
            metadata: { source: "https://example.com" },
        };

        const documents = [document1, document2, document3];

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
        await vectorStore.addDocuments(documents);
        console.log(vectorStore.memoryVectors);
        const objStr = JSON.stringify(vectorStore.memoryVectors, null, 0);
        await this.plugin.app.vault.adapter.write(this.dbFile, objStr);
        const filter = (doc: Document) => doc.metadata.source === "https://example.com";

        const readStr = await this.plugin.app.vault.adapter.read(this.dbFile);
        const memoryVectors2 = JSON.parse(readStr);
        const vectorStore2 = new MemoryVectorStore(embeddings);
        vectorStore2.memoryVectors = memoryVectors2;
        // MMR search to increase diversity and relevance
        const retriver = vectorStore2.asRetriever({
            k: 2,
            filter: filter,
            //tags: ['example', 'test'],
            verbose: true,
            searchType: 'mmr',
            searchKwargs: { fetchK: 4, lambda: 0.8 },
        });
        const doc = await retriver.invoke("biology")
        console.log(doc);

        // similarity search to find the most relevance
        const similaritySearchWithScoreResults =
            await vectorStore2.similaritySearchWithScore("biology", 2, filter);

        for (const [doc, score] of similaritySearchWithScoreResults) {
            console.log(
                `* [SIM=${score.toFixed(3)}] ${doc.pageContent} [${JSON.stringify(
                    doc.metadata
                )}]`
            );
        }

        globalThis.fetch = originFetch
        globalThis.Headers = originHeaders
        globalThis.Request = originRequest
        globalThis.Response = originResponse
    }
}