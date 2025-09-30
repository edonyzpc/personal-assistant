/* Copyright 2023 edonyzpc */
import { TFile } from 'obsidian'
import { AIService } from './ai-services/service';
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { PluginManager } from './plugin'

/**
 * A class for managing the vector store.
 */
export class VSS {
    private plugin: PluginManager;
    private encryptedToken: string;
    private vssCacheDir: string;
    private vectorStore!: MemoryVectorStore;
    private aiService: AIService;

    /**
     * Creates an instance of VSS.
     * @param plugin - The PluginManager instance.
     * @param vssCacheDir - The directory for the VSS cache.
     */
    constructor(
        plugin: PluginManager,
        vssCacheDir: string,
    ) {
        this.plugin = plugin;
        this.encryptedToken = this.plugin.settings.apiToken;
        this.vssCacheDir = vssCacheDir;
        this.aiService = new AIService(plugin);
    }

    /**
     * Caches the vector store for a file.
     * @param cacheFile - The file to cache.
     * @returns A boolean indicating whether the file was cached.
     */
    async cacheFileVectorStore(cacheFile: TFile): Promise<boolean> {
        return await this.aiService.vectorizeDocument(cacheFile, this.vssCacheDir);
    }

    /**
     * Loads the vector store.
     * @param vssFiles - The files to load.
     * @param isDelete - Whether to delete the files from the vector store.
     */
    async loadVectorStore(vssFiles: TFile[], isDelete: boolean = false) {
        if (!this.vectorStore) {
            const embeddings = await this.aiService['aiUtils'].createEmbeddings();
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

    /**
     * Searches for similar documents.
     * @param prompt - The prompt to search for.
     * @returns An array of similar documents.
     */
    async searchSimilarity(prompt: string) {
        return await this.aiService.searchSimilarDocuments(prompt, this.vectorStore);
    }
}