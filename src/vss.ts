/* Copyright 2023 edonyzpc */
import { TFile } from 'obsidian'
import { AIService } from './ai-services/service';
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { PluginManager } from './plugin'

export class VSS {
    private plugin: PluginManager;
    private encryptedToken: string;
    private vssCacheDir: string;
    private vectorStore!: MemoryVectorStore;
    private aiService: AIService;

    constructor(
        plugin: PluginManager,
        vssCacheDir: string,
    ) {
        this.plugin = plugin;
        this.encryptedToken = this.plugin.settings.apiToken;
        this.vssCacheDir = vssCacheDir;
        this.aiService = new AIService(plugin);
    }

    async cacheFileVectorStore(cacheFile: TFile): Promise<boolean> {
        return await this.aiService.vectorizeDocument(cacheFile, this.vssCacheDir);
    }

    async loadVectorStore(vssFiles: TFile[], isDelete: boolean = false) {
        if (!this.vectorStore) {
            const embeddings = await this.aiService['aiUtils'].createOpenAIEmbeddings();
            this.vectorStore = new MemoryVectorStore(embeddings);
        }

        for (const f of vssFiles) {
            if (isDelete) {
                for (const v of this.vectorStore.memoryVectors) {
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
        return await this.aiService.searchSimilarDocuments(prompt, this.vectorStore);
    }
}