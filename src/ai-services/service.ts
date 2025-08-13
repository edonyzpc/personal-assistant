/* Copyright 2023 edonyzpc */
import { App, Editor, MarkdownView, Notice, TFile, type FrontMatterInfo } from 'obsidian'
import { StateEffect } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { nanoid } from 'nanoid'
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { Document } from "@langchain/core/documents";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { MarkdownTextSplitter } from '@langchain/textsplitters';
import fetch, { Headers, Request, Response } from "node-fetch";

import { AIUtils } from './ai-utils';
import type { PluginManager } from '../plugin'
import { isPluginEnabled } from 'utils';


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
        const { notice, notification } = this.aiUtils.createAIThinkingNotice(); // eslint-disable-line @typescript-eslint/no-unused-vars

        try {
            const markdown = editor.getValue();
            const { content } = this.aiUtils.getDocumentContent(markdown);

            const result = await this.callLLM(content, this.getSummaryPrompt());
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
        const tags = Object.keys((app.metadataCache as any).getTags()); // eslint-disable-line @typescript-eslint/no-explicit-any

        const prompt = this.getTagsPrompt(content, tags);
        const result = await this.callLLM(content, prompt);
        return JSON.parse(result);
    }

    /**
     * 生成特色图片
     */
    async generateFeaturedImage(editor: Editor, view: MarkdownView, fontmatterInfo: FrontMatterInfo): Promise<void> {
        // 检查是否支持图片生成（目前只支持Qwen）
        if (this.plugin.settings.aiProvider !== 'qwen') {
            new Notice("Featured image generation is only supported with Qwen provider.", 3000);
            return;
        }

        // @ts-expect-error, not typed
        const editorView: EditorView = view.editor.cm;
        const { notice, notification } = this.aiUtils.createAIFeaturedImageNotice();

        try {
            const markdown = editor.getValue();
            const { content } = this.aiUtils.getDocumentContent(markdown);

            // 生成图片描述
            const progress1Div = notice.noticeEl.createEl("div", { attr: { id: "ai-featured-image-progress-1", style: "background: white;color: black;margin-top: 4px;" } });
            progress1Div.setText("    🚧   Agent Generating Prompt...");
            const imageDesc = await this.callLLM(content, this.getImageDescriptionPrompt());
            if (imageDesc.length <= 0) {
                notification.$destroy();
                notice.hide();
                new Notice("AI is not available.");
                return;
            }
            progress1Div.setText("    ✅   Generating Prompt Success!");

            // 生成图片
            const progress2Div = notice.noticeEl.createEl("div", { attr: { id: "ai-featured-image-progress-2", style: "background: white;color: black;margin-top: 4px;" } });
            progress2Div.setText("    🚧   Agent Generating Images...");
            const imagesGen = await this.generateImage(imageDesc);
            progress2Div.setText("    ✅   Generating Images Success!");

            // 下载图片
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
                    if (fontmatterInfo.exists) {
                        line = editorView.state.doc.lineAt(fontmatterInfo.contentStart);
                    } else {
                        line = editorView.state.doc.lineAt(0);
                    }
                    let imagesCallout = "";
                    const featuredImagePath = this.plugin.settings.featuredImagePath;
                    let calloutImageSuffix = "";
                    if (isPluginEnabled(this.plugin.app, "image-converter")) {
                        // 如果image-converter插件启用，则resize图片到480px
                        calloutImageSuffix = "|480";
                    }
                    for (let i = 0; i < imageUrls.length; i++) {
                        const imageUrlStr = imageUrls[i].url;
                        const response = await this.downloadImageToVault(this.plugin.app, imageUrlStr, featuredImagePath);
                        if (response) {
                            imagesCallout += `![[${response}${calloutImageSuffix}]]\n> `;
                        }
                    }
                    progress3Div.setText("    ✅   Downloading Images Success!");
                    // append line breaks
                    imagesCallout += "\n\n";
                    editorView.dispatch({
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

        } finally {
            notice.hide();
        }
    }

    /**
     * 向量化文档
     */
    async vectorizeDocument(file: TFile, cacheDir: string): Promise<boolean> {
        const embeddings = await this.aiUtils.createEmbeddings();
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

        const childDir = this.plugin.join(cacheDir, file.path.split(file.name)[0]);
        if (!await this.plugin.app.vault.adapter.exists(childDir)) {
            await this.plugin.app.vault.adapter.mkdir(childDir);
        }
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

        /*
        // MMR search to increase diversity and relevance
        const retriver = this.vectorStore.asRetriever({
            k: 2,
            //filter: filter,
            //tags: ['example', 'test'],
            verbose: true,
            searchType: 'mmr',
            searchKwargs: { fetchK: 4, lambda: 0.8 },
        });
        const doc = await retriver.invoke("cat"); // eslint-disable-line @typescript-eslint/no-unused-vars
        */
        const similaritySearchWithScoreResults = await vectorStore.similaritySearchWithScore(prompt, 8);

        const content = [];
        for (const [doc, score] of similaritySearchWithScoreResults) {
            this.plugin.log(`* [SIM=${score.toFixed(3)}] [${JSON.stringify(doc.metadata)}]`);
            content.push({ "score": score, "doc": doc });
        }

        return content;
    }

    /**
     * 调用LLM
     */
    private async callLLM(query: string, systemPrompt: string): Promise<string> {
        const llm = await this.aiUtils.createChatModel(0.8);
        const systemMessage = new SystemMessage(systemPrompt);
        const generateMessage = new HumanMessage(`**文字内容：**${query}`);
        const messages = [systemMessage, generateMessage];

        const res = await this.aiUtils.withFetchPolyfill(async () => {
            return await llm.invoke(messages);
        });

        this.plugin.log(res.content);
        return res.content.toString();
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
- 如果最能体现文字内容的关键词不在给定的列表中，可以自己增加标签内容，标签的格式必须是：'''#关键词'''
- 输出结果的格式为：
["#关键词1", "#关键词2", "#关键词3", ...]`;
    }

    /**
     * 获取图片描述的提示词
     */
    private getImageDescriptionPrompt(): string {
        return `你是一个精通文字编辑和图片处理的专家，你会根据我给出的文字内容生成一段图片描述，该图片会作为给出的文字内容的特色图片（特色图片featured image代表博客或页面的文字内容，情绪或主题，并在整个网站中使用）。
## 任务要求：
1. 该描述能够帮助AI理解并生成与文字内容相关的图片；
2. 该描述能够概括出文字内容中的主要信息和主题，为了让图片更有创意性，你可适当的增加天马行空的元素和描述；
3. 你会从图片专家的角度思考，描述中尽量包括图片中心主题，环境信息，图片中的物体位置、图片中的物体大小、图片中的物体颜色、图片中的物体形状、图片中的物体材质、图片中的物体风格、图片中的物体数量、图片中的物体关系等等；
4. 同时你还会给出图片艺术风格的描述，具体图片艺术风格你可以根据自己对给出的文字内容的理解自行决定；
5. 你会从图片专家的角度思考，给出一些用于AI生成图片时可以利用的技术参数从而让图片变得更加美观，你可以根据自身对图片以及美观的理解自行选择需要设置的图片技术参数例如近景镜头、半身特写、锐化等等；

## 输出格式：
需要生成的图片描述格式为：主体（主体描述）+ 场景（场景描述）+ 风格（定义风格）+ 镜头语言 + 氛围词 + 细节修饰

- 主体描述：确定主体清晰地描述图像中的主体，包括其特征、动作等。例如，“一个可爱的10岁中国小女孩，穿着红色衣服”。
- 场景描述：场景描述是对主体所处环境特征细节的描述，可通过形容词或短句列举。
- 定义风格：定义风格是明确地描述图像所应具有的特定艺术风格、表现手法或视觉特征。例如，“水彩风格”、“漫画风格”常见风格化详见下方提示词词典。
- 镜头语言：镜头语言包含景别、视角等，常见镜头语言详见提示词词典。
- 氛围词：氛围词是对预期画面氛围的描述，例如“梦幻”、“孤独”、“宏伟”，常见氛围词详见提示词词典。
- 细节修饰：细节修饰是对画面进一步的精细化和优化，以增强图像的细节表现力、丰富度和美感。例如“光源的位置”、“道具搭配”、“环境细节”，“高分辨率”等。

**图片描述示例**：由羊毛毡制成的大熊猫，头戴大檐帽，穿着蓝色警服马甲，扎着腰带，携带警械装备，戴着蓝色手套，穿着皮鞋，大步奔跑姿态，毛毡效果，周围是动物王国城市街道商户，高级滤镜，路灯，动物王国，奇妙童趣，憨态可掬，夜晚，明亮，自然，可爱，4K，毛毡材质，摄影镜头，居中构图，毛毡风格，皮克斯风格，逆光。

## 提示词词典：
1. 景别

| 景别类型 | 提示词示例 |
|------|-------------|
| 特写   | 特写镜头 | 高清相机，情绪大片，日落，特写人像。 |
| 近景   | 近景镜头 | 近景镜头，18岁的中国女孩，古代服饰，圆脸，看着镜头，民族优雅的服装，商业摄影，室外，电影级光照，半身特写，精致的淡妆，锐利的边缘。|
| 中景   | 中景镜头 | 电影时尚魅力摄影，年轻亚洲女子，中国苗族女孩，圆脸，看着镜头，民族深色优雅的服装，中广角镜头，阳光明媚，乌托邦式，由高清相机拍摄。|
| 远景   | 远景镜头 | 展示了远景镜头，在壮丽的雪山背景下，两个小小的人影站在远处山顶，背对着镜头，静静地观赏着日落的美景。夕阳的余晖洒在雪山上，呈现出一片金黄色的光辉，与蔚蓝的天空形成鲜明对比。两人仿佛被这壮观的自然景象所吸引，整个画面充满了宁静与和谐。|

2. 视角

| 视角类型 | 提示词示例 |
|------|-------------|
| 平视   | 平视视角 | 图像展示了从平视视角捕捉到的草地景象，一群羊悠闲地在绿茵茵的草地上低头觅食，它们的羊毛在早晨微弱的阳光照耀下呈现出温暖的金色光泽，形成美丽的光影效果。|
| 俯视   | 俯视视角 | 我从空中俯瞰冰湖，中心有一艘小船，周围环绕着漩涡图案和充满活力的蓝色海水。螺旋深渊，该场景是从上方以自上而下的视角拍摄的，展示了复杂的细节，例如表面的波纹和积雪覆盖的地面下的层。眺望冰冷的广阔天地。营造出一种令人敬畏的宁静感。|
| 仰视   | 仰视视角 | 展示了热带地区的壮观景象，高大的椰子树如同参天巨人般耸立，枝叶茂盛，直指蓝天。镜头采用仰视视角，让观众仿佛置身树下，感受大自然的雄伟与生机。阳光透过树叶间隙洒落，形成斑驳光影，增添了几分神秘与浪漫。整个画面充满了热带风情，让人仿佛能闻到椰香，感受到微风拂面的惬意。|
| 航拍   | 航拍视角 | 展示了大雪，村庄，道路，灯火，树木。航拍视角，逼真效果。|

3. 镜头

| 镜头类型 | 提示词示例|
|------|------------|
| 微距   | 微距镜头 | cherries, carbonated water, macro, professional color grading, clean sharp focus, commercial high quality, magazine winning photography, hyper realistic, uhd, 8K |
| 超广角  | 超广角镜头 | 超广角镜头，碧海蓝天下的海岛，阳光透过树叶缝隙，洒下斑驳光影。|
| 长焦   | 长焦镜头 | 展示了长焦镜头下，一只猎豹在郁郁葱葱的森林中站立，面对镜头，背景被巧妙地虚化，猎豹的面部成为画面的绝对焦点。阳光透过树叶的缝隙，洒在猎豹身上，形成斑驳的光影效果，增强了视觉冲击力。|
| 鱼眼   | 鱼眼镜头 | 展示了在鱼眼镜头的特殊视角下，一位女性站立着并直视镜头的场景。她的形象在画面中心被夸张地放大，四周则呈现出强烈的扭曲效果，营造出一种独特的视觉冲击力。|

4. 风格

| 风格类型 | 提示词示例|
|------|------------|
| 3D卡通 | 网球女运动员，短发，白色网球服，黑色短裤，侧身回球，3D卡通风格。|
| 废土风  | 火星上的城市，废土风格。|
| 点彩画  | 一座白色的可爱的小房子，茅草房，一片被雪覆盖的草原，大胆使用点彩色画，莫奈感，清晰的笔触，边缘模糊，原始的边缘纹理，低饱和度的颜色，低对比度，莫兰迪色。|
| 超现实  | 深灰色大海中一条粉红色的发光河流，具有极简、美丽和审美的氛围，具有超现实风格的电影灯光。|
| 水彩   | 浅水彩，咖啡馆外，明亮的白色背景，更少细节，梦幻，吉卜力工作室。|
| 粘土   | 粘土风格，蓝色毛衣的小男孩，棕色卷发，深蓝色贝雷帽，画板，户外，海边，半身照。|
| 写实   | 篮子，葡萄，野餐布，超写实静物摄影，微距镜头，丁达尔效应。|
| 陶瓷   | 展示了高细节的瓷器小狗，它静静地躺在桌上，脖子上系着一个精致的铃铛。小狗的每一根毛发都被细腻地刻画出来，眼睛、鼻子和嘴巴的细节栩栩如生。|
| 3D   | 中国龙，可爱的中国龙睡在白云上，迷人的花园，在晨雾中，特写，正面，3D立体，C4D渲染，32k超高清，32k UHD，中国朋克，32k UHD，动物雕像，辛烷值渲染，超高清晰度。 |
| 水墨   | 兰花，水墨画，留白，意境，吴冠中风格，细腻的笔触，宣纸的纹理。|
| 折纸   | 折纸杰作，牛皮纸材质的熊猫，森林背景，中景，极简主义，背光，最佳品质。|
| 工笔   | 晨曦中，一枝寒梅傲立雪中，花瓣细腻如丝，露珠轻挂，展现工笔画之精致美|
| 国风水墨 | 国风水墨风格，一个长长黑发的男人，金色的发簪，飞舞着金色的蝴蝶，白色的服装，高细节，高质量，深蓝色背景，背景中有若隐若现的水墨竹林。|

5. 光线

| 光线类型 | 提示词示例 |
|------|-------------|
| 自然光  | 太阳光、月光、星光 | 图像展示了早晨的阳光洒在一片茂密森林的地面上，银白色的光芒穿透树梢，形成斑驳陆离的光影，营造出一种写实而静谧的氛围。|
| 逆光   | 逆光 | 展示了在逆光环境下，模特轮廓线条更加分明，金色的光线以及丝绸环绕在模特周围，形成梦幻般的光环效果。整个场景充满艺术气息，展现了高水准的摄影技术和创意。|
| 霓虹灯  | 霓虹灯 | 雨后的城市街景，霓虹灯光在湿润的地面上反射出绚丽多彩的光芒。行人撑伞匆匆走过，车辆在光怪陆离的街道上缓缓行驶，留下一道道彩色的尾迹。整个画面充满了都市夜晚的神秘与浪漫，仿佛每一滴雨水都在讲述着城市的故事。|
| 氛围光  | 氛围光 | 夜晚河边的浪漫艺术景象，氛围灯温柔地照亮了水面，一群莲花灯缓缓飘向河心，灯光与水面波光粼粼相互辉映，营造出梦幻般的视觉效果。|`;
    }

    /**
     * 生成图片
     */
    private async generateImage(genMsg: string) {
        const token = await this.plugin.getAPIToken();
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

    /** 
     * 获取图片
     */
    private async getImage(generateResult: ImageGenerationResult) {
        const token = await this.plugin.getAPIToken();

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

                    // 等待10秒
                    await new Promise(resolve => setTimeout(resolve, 10000));

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

    /**
     * 下载图片到本地
     */
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