/* Copyright 2023 edonyzpc */
import { Editor, MarkdownView, Notice, getFrontMatterInfo, TFile, type FrontMatterInfo } from 'obsidian'
import fetch, { Headers, Request, Response } from "node-fetch";
import { EditorView } from '@codemirror/view'

import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Document } from "@langchain/core/documents";
import { OpenAIEmbeddings } from '@langchain/openai';
import { MarkdownTextSplitter } from '@langchain/textsplitters';


import { PluginManager } from './plugin'

export class VSS {
    private plugin: PluginManager;
    private encryptedToken: string;
    private mdSplitter: MarkdownTextSplitter
    private vssCacheDir: string;
    private vectorStore!: MemoryVectorStore;
    constructor(
        plugin: PluginManager,
        vssCacheDir: string,
    ) {
        this.plugin = plugin;
        this.encryptedToken = this.plugin.settings.apiToken;
        // text-embedding-v3 max token is 8192
        this.mdSplitter = new MarkdownTextSplitter({ chunkSize: 4000, chunkOverlap: 80 });
        this.vssCacheDir = vssCacheDir;
    }

    async cacheFileVectorStore(cacheFile: TFile): Promise<boolean> {
        const token = await this.plugin.getAPIToken();

        const embeddings = new OpenAIEmbeddings({
            model: "text-embedding-v3",
            dimensions: 512, // 指定向量维度（仅 text-embedding-v3 支持该参数）
            apiKey: token,
            configuration: {
                baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            }
        });

        const documents = [];
        const markdown = await this.plugin.app.vault.adapter.read(cacheFile.path);
        const fontmatterInfo = getFrontMatterInfo(markdown);
        let mdStr = markdown.slice(fontmatterInfo.contentStart);
        //filter codeblock string which is not knowledge that AI should care about
        const cleanMarkdown = (md: string) =>
            md.replace(/^```.*?$(?:\n.*?)*^```$/gm, '');
        const cleanComment = (md: string) =>
            md.replace(/%%[\s\S]*?%%/g, '');
        const cleanFileRef = (mdStr: string) => {
            return mdStr.replace(/\[\[[\w-]+\.[a-z]{1,}\]\]/g, '');
        }
        mdStr = cleanMarkdown(mdStr);
        mdStr = cleanComment(mdStr);
        mdStr = cleanFileRef(mdStr);
        if (mdStr.length === 0) {
            // no content to process
            return false;
        }
        const subStrList = await this.mdSplitter.splitText(mdStr);
        const metadata = {
            path: cacheFile.path,
            created: cacheFile.stat.ctime,
            lastModified: cacheFile.stat.mtime,
        };
        for (const subStr of subStrList) {
            documents.push(new Document({
                pageContent: subStr,
                metadata: metadata,
            }));
        }

        const childDir = this.plugin.join(this.vssCacheDir, cacheFile.path.split(cacheFile.name)[0]);
        if (!await this.plugin.app.vault.adapter.exists(childDir)) {
            await this.plugin.app.vault.adapter.mkdir(childDir);
        }
        const vssFile = this.plugin.join(this.vssCacheDir, cacheFile.path + ".json");
        if (await this.plugin.app.vault.adapter.exists(vssFile)) {
            try {
                const cachedVSSFile = await this.plugin.app.vault.adapter.read(vssFile);
                const cachedVectors = JSON.parse(cachedVSSFile);
                if (cacheFile.stat.mtime - cachedVectors[0]["metadata"]["lastModified"] <= 1000) {
                    // according the vss cache file record, if file is not modified in 1 seconds, skip
                    this.plugin.log(`skip ${vssFile}`);
                    return false;
                }
            } catch (e) {
                console.error(e, vssFile);
            }
        }

        const vectorStore = new MemoryVectorStore(embeddings);
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

        globalThis.fetch = originFetch
        globalThis.Headers = originHeaders
        globalThis.Request = originRequest
        globalThis.Response = originResponse

        const objStr = JSON.stringify(vectorStore.memoryVectors, null, 0);
        await this.plugin.app.vault.adapter.write(vssFile, objStr);
        // clear the cache vector store
        //vectorStore.delete();

        // cache vector store with LLM service
        return true;
    }

    async loadVectorStore(vssFiles: TFile[], isDelete: boolean = false) {
        const token = await this.plugin.getAPIToken();

        const embeddings = new OpenAIEmbeddings({
            model: "text-embedding-v3",
            dimensions: 512, // 指定向量维度（仅 text-embedding-v3 支持该参数）
            apiKey: token,
            configuration: {
                baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            }
        });

        if (!this.vectorStore) {
            this.vectorStore = new MemoryVectorStore(embeddings);
        }
        for (const f of vssFiles) {
            if (isDelete) {
                for (const v of this.vectorStore.memoryVectors) {
                    // delete old vectors record
                    if (v.metadata.path === f.path) {
                        this.vectorStore.memoryVectors.remove(v);
                    }
                }
            } else {
                try {
                    const fpath = this.plugin.join(this.vssCacheDir, f.path + ".json")
                    const readStr = await this.plugin.app.vault.adapter.read(fpath);
                    const memoryVectors2 = JSON.parse(readStr);
                    for (const v of this.vectorStore.memoryVectors) {
                        // remove old vectors
                        if (v.metadata.path === f.path) {
                            this.vectorStore.memoryVectors.remove(v);
                        }
                    }
                    this.vectorStore.memoryVectors = this.vectorStore.memoryVectors.concat(memoryVectors2);
                } catch (e) {
                    console.error(e);
                }
            }
        }
    }

    async searchSimilarity(prompt: string) {
        if (!this.vectorStore) {
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
        // similarity search to find the most relevance
        const similaritySearchWithScoreResults =
            await this.vectorStore.similaritySearchWithScore(prompt, 8);

        const content = [];
        for (const [doc, score] of similaritySearchWithScoreResults) {
            this.plugin.log(
                `* [SIM=${score.toFixed(3)}] [${JSON.stringify(doc.metadata)}]`
            );
            content.push({ "score": score, "doc": doc });
        }

        return content;
    }

}