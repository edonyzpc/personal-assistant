import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { VSS } from '../src/vss';
import { DirtyTimestamps } from '../src/vss-helpers';
import { TFile } from 'obsidian';

jest.mock('obsidian', () => {
    class MockTFile {
        path: string;
        stat: any; // eslint-disable-line @typescript-eslint/no-explicit-any
        extension: string;
        name: string;
        constructor(path: string, stat: any = {}, extension: string = 'md', name: string = path) { // eslint-disable-line @typescript-eslint/no-explicit-any
            this.path = path;
            this.stat = stat;
            this.extension = extension;
            this.name = name;
        }
    }
    return {
        TFile: MockTFile,
        TAbstractFile: MockTFile,
        Notice: class { },
        normalizePath: (p: string) => p,
    };
});

jest.mock('../src/ai-services/service', () => {
    return {
        AIService: class {
            constructor(..._args: any[]) { } // eslint-disable-line @typescript-eslint/no-explicit-any
            vectorizeDocument = jest.fn(async () => true);
            searchSimilarDocuments = jest.fn();
            ['aiUtils'] = { createEmbeddings: jest.fn() };
        }
    };
});

jest.mock('../src/ai-services/ai-utils', () => {
    return {
        AIUtils: class {
            constructor(..._args: any[]) { } // eslint-disable-line @typescript-eslint/no-explicit-any
            getDocumentContent(markdown: string) { return { content: markdown }; }
            cleanMarkdownContent(content: string) { return content; }
        }
    };
});

jest.mock('@langchain/classic/vectorstores/memory', () => {
    return {
        MemoryVectorStore: class {
            memoryVectors: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
            constructor(..._args: any[]) { } // eslint-disable-line @typescript-eslint/no-explicit-any
        }
    };
});

const createPlugin = (overrides: Record<string, unknown> = {}) => {
    const mockAdapter = {
        write: jest.fn<(path: string, data: string) => Promise<void>>(),
        read: jest.fn<(path: string) => Promise<string>>(),
        exists: jest.fn<(path: string) => Promise<boolean>>(),
        list: jest.fn<(path: string) => Promise<{ files: string[]; folders: string[] }>>(),
        remove: jest.fn<(path: string) => Promise<void>>(),
        mkdir: jest.fn<(path: string) => Promise<void>>(),
    };

    const mockVault = {
        adapter: mockAdapter,
        getAbstractFileByPath: jest.fn<(path: string) => TFile | null>(),
        getMarkdownFiles: jest.fn(() => []),
    };

    const plugin: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
        settings: {
            apiToken: 'token',
            vssCacheExcludePath: [],
            aiProvider: 'openai',
            embeddingModelName: 'model',
            baseURL: '',
            chatModelName: '',
        },
        app: { vault: mockVault },
        join: (...parts: string[]) => parts.join('/'),
        getVSSFiles: jest.fn(() => []),
        log: jest.fn(),
        ...overrides,
    };

    return { plugin, mockAdapter, mockVault };
};

const createTFile = (path: string, stat: any = {}, extension: string = 'md', name: string = path): TFile => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const FileCtor = TFile as unknown as { new(path: string, stat: any, extension?: string, name?: string): TFile }; // eslint-disable-line @typescript-eslint/no-explicit-any
    return new FileCtor(path, stat, extension, name);
};

describe('VSS cache lifecycle', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('removes large files from cache and dirty queue instead of retrying forever', async () => {
        const baseTime = new Date('2025-01-01T00:00:00.000Z');
        jest.setSystemTime(baseTime);

        const { plugin, mockAdapter, mockVault } = createPlugin();
        mockAdapter.exists.mockResolvedValue(true);

        const vss = new VSS(plugin, 'cache');
        const largeFile = createTFile('large.md', { size: 2_000_000, mtime: Date.now(), ctime: Date.now() }, 'md', 'large.md');

        mockVault.getAbstractFileByPath.mockReturnValue(largeFile);

        const firstTs = Date.now() - 60_000;
        const dirtyMap = (vss as any).dirty as Map<string, DirtyTimestamps>; // eslint-disable-line @typescript-eslint/no-explicit-any
        dirtyMap.set(largeFile.path, { first: firstTs, last: firstTs });

        await vss.flush({ limit: 5, reason: 'test-large-file' });

        expect(dirtyMap.has(largeFile.path)).toBe(false);
        expect(mockAdapter.remove).toHaveBeenCalledWith('cache/large.md.json');
    });

    it('removes stale vectors when cleaned markdown content is empty', async () => {
        const { plugin, mockAdapter } = createPlugin();
        mockAdapter.read.mockResolvedValue('');
        mockAdapter.exists.mockResolvedValue(true);
        const vss = new VSS(plugin, 'cache');
        (vss as any).vectorStore = { // eslint-disable-line @typescript-eslint/no-explicit-any
            memoryVectors: [
                { metadata: { path: 'empty.md' } },
                { metadata: { path: 'keep.md' } },
            ],
        };
        const emptyFile = createTFile('empty.md', { size: 0, mtime: Date.now(), ctime: Date.now() }, 'md', 'empty.md');

        const status = await vss.refreshFileCache(emptyFile);

        expect(status).toBe('removed');
        expect(mockAdapter.remove).toHaveBeenCalledWith('cache/empty.md.json');
        expect((vss as any).vectorStore.memoryVectors).toEqual([ // eslint-disable-line @typescript-eslint/no-explicit-any
            { metadata: { path: 'keep.md' } },
        ]);
    });

    it('loads existing cached vectors during initialization by listing the cache tree', async () => {
        const cachedFile = createTFile('cached.md', { size: 5, mtime: Date.now(), ctime: Date.now() }, 'md', 'cached.md');
        const nestedFile = createTFile('folder/nested.md', { size: 5, mtime: Date.now(), ctime: Date.now() }, 'md', 'nested.md');
        const missingFile = createTFile('missing.md', { size: 5, mtime: Date.now(), ctime: Date.now() }, 'md', 'missing.md');
        const { plugin, mockAdapter } = createPlugin({
            getVSSFiles: jest.fn(() => [cachedFile, nestedFile, missingFile]),
        });
        const enoent = new Error('missing') as NodeJS.ErrnoException;
        enoent.code = 'ENOENT';
        mockAdapter.list.mockImplementation(async (path: string) => {
            if (path === 'cache') {
                return {
                    files: ['cache/cached.md.json', 'cache/dirty.json'],
                    folders: ['cache/folder'],
                };
            }
            if (path === 'cache/folder') {
                return {
                    files: ['cache/folder/nested.md.json'],
                    folders: [],
                };
            }
            return { files: [], folders: [] };
        });
        mockAdapter.read.mockImplementation(async (path: string) => {
            if (path === 'cache/dirty.json') throw enoent;
            if (path === 'cache/cached.md.json') {
                return JSON.stringify([{ metadata: { path: 'cached.md' }, content: 'cached', embedding: [0] }]);
            }
            if (path === 'cache/folder/nested.md.json') {
                return JSON.stringify([{ metadata: { path: 'folder/nested.md' }, content: 'nested', embedding: [1] }]);
            }
            throw enoent;
        });

        const vss = new VSS(plugin, 'cache');
        await vss.initialize();

        expect((vss as any).vectorStore.memoryVectors).toEqual([ // eslint-disable-line @typescript-eslint/no-explicit-any
            { metadata: { path: 'cached.md' }, content: 'cached', embedding: [0] },
            { metadata: { path: 'folder/nested.md' }, content: 'nested', embedding: [1] },
        ]);
        expect(mockAdapter.exists).not.toHaveBeenCalledWith('cache/cached.md.json');
        expect(mockAdapter.list).toHaveBeenCalledWith('cache');
        expect(mockAdapter.list).toHaveBeenCalledWith('cache/folder');
        vss.dispose();
    });

    it('falls back to batched cache existence checks when cache listing fails', async () => {
        const cachedFile = createTFile('cached.md', { size: 5, mtime: Date.now(), ctime: Date.now() }, 'md', 'cached.md');
        const missingFile = createTFile('missing.md', { size: 5, mtime: Date.now(), ctime: Date.now() }, 'md', 'missing.md');
        const { plugin, mockAdapter } = createPlugin({
            getVSSFiles: jest.fn(() => [cachedFile, missingFile]),
        });
        const enoent = new Error('missing') as NodeJS.ErrnoException;
        enoent.code = 'ENOENT';
        mockAdapter.list.mockRejectedValue(new Error('list unavailable'));
        mockAdapter.exists.mockImplementation(async (path: string) => path === 'cache/cached.md.json');
        mockAdapter.read.mockImplementation(async (path: string) => {
            if (path === 'cache/dirty.json') throw enoent;
            if (path === 'cache/cached.md.json') {
                return JSON.stringify([{ metadata: { path: 'cached.md' }, content: 'cached', embedding: [0] }]);
            }
            throw enoent;
        });

        const vss = new VSS(plugin, 'cache');
        await vss.initialize();

        expect((vss as any).vectorStore.memoryVectors).toEqual([ // eslint-disable-line @typescript-eslint/no-explicit-any
            { metadata: { path: 'cached.md' }, content: 'cached', embedding: [0] },
        ]);
        expect(mockAdapter.exists).toHaveBeenCalledWith('cache/cached.md.json');
        expect(mockAdapter.exists).toHaveBeenCalledWith('cache/missing.md.json');
        vss.dispose();
    });

    it('does not treat blank exclude paths as matching every file', async () => {
        const { plugin, mockAdapter } = createPlugin();
        plugin.settings.vssCacheExcludePath = [''];
        const vss = new VSS(plugin, 'cache');
        const file = createTFile('note.md', { size: 5, mtime: Date.now(), ctime: Date.now() }, 'md', 'note.md');

        await vss.markDirtyIfEligible(file);

        expect(((vss as any).dirty as Map<string, DirtyTimestamps>).has('note.md')).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(mockAdapter.write).toHaveBeenCalledWith('cache/dirty.json', expect.stringContaining('note.md'));
    });
});
